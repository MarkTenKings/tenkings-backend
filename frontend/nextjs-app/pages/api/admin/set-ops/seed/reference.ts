import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import {
  prisma,
  SetApprovalDecision,
  SetAuditStatus,
  SetDatasetType,
} from "@tenkings/database";
import { normalizeCardNumber, normalizeSetLabel } from "@tenkings/shared";
import { requireAdminSession, toErrorResponse, type AdminSession } from "../../../../../lib/server/admin";
import {
  canPerformSetOpsRole,
  roleDeniedMessage,
  writeSetOpsAuditEvent,
} from "../../../../../lib/server/setOps";
import { extractDraftRows } from "../../../../../lib/server/setOpsDrafts";
import {
  buildReferenceSeedQuery,
  canonicalSeedParallel,
  primarySeedPlayerLabel,
  ReferenceSeedError,
  seedVariantReferenceImages,
} from "../../../../../lib/server/referenceSeed";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const seedSchema = z.object({
  setId: z.string().min(1),
  datasetType: z.nativeEnum(SetDatasetType).default(SetDatasetType.PARALLEL_DB),
  draftVersionId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  tbs: z.string().trim().max(64).optional(),
  gl: z.string().trim().max(16).optional(),
  hl: z.string().trim().max(16).optional(),
});

type SeedTarget = {
  cardNumber: string;
  parallelId: string;
  playerSeed: string | null;
  query: string;
};

type ResponseBody =
  | {
      summary: {
        setId: string;
        datasetType: SetDatasetType;
        draftVersionId: string;
        targetCount: number;
        processed: number;
        inserted: number;
        skipped: number;
        failed: number;
        failures: string[];
      };
      audit: { id: string; status: string; action: string; createdAt: string } | null;
    }
  | { message: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function datasetTypeFromDraftData(dataJson: unknown): SetDatasetType | null {
  const record = asRecord(dataJson);
  if (!record) return null;
  const raw = String(record.datasetType ?? "").trim().toUpperCase();
  if (raw === SetDatasetType.PARALLEL_DB || raw === SetDatasetType.PLAYER_WORKSHEET) {
    return raw as SetDatasetType;
  }
  return null;
}

function hasBlockingError(errors: Array<{ blocking: boolean }> | null | undefined) {
  return Boolean(errors?.some((issue) => issue.blocking));
}

function buildSeedTargets(params: {
  setId: string;
  datasetType: SetDatasetType;
  rows: ReturnType<typeof extractDraftRows>;
}): SeedTarget[] {
  const seen = new Set<string>();
  const targets: SeedTarget[] = [];

  for (const row of params.rows) {
    if (normalizeSetLabel(row.setId) !== params.setId) continue;
    if (hasBlockingError(row.errors)) continue;
    if (params.datasetType === SetDatasetType.PARALLEL_DB && !row.odds && !row.serial) continue;

    const cardNumber = normalizeCardNumber(row.cardNumber ?? "") || "ALL";
    const parallelId = canonicalSeedParallel(row.parallel, cardNumber);
    if (!parallelId) continue;

    const playerSeed = primarySeedPlayerLabel(row.playerSeed || row.cardType || "") || null;
    const query = buildReferenceSeedQuery({
      setId: params.setId,
      cardNumber,
      parallelId,
      playerSeed,
    });
    if (!query) continue;

    const key = `${cardNumber.toUpperCase()}::${parallelId.toLowerCase()}::${String(playerSeed || "").toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    targets.push({
      cardNumber,
      parallelId,
      playerSeed,
      query,
    });
  }

  return targets;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  let admin: AdminSession | null = null;
  const attemptedSetId = normalizeSetLabel(String(req.body?.setId ?? ""));

  try {
    admin = await requireAdminSession(req);

    if (!canPerformSetOpsRole(admin, "approver")) {
      await writeSetOpsAuditEvent({
        req,
        admin,
        action: "set_ops.seed.reference",
        status: SetAuditStatus.DENIED,
        setId: attemptedSetId || null,
        reason: roleDeniedMessage("approver"),
      });
      return res.status(403).json({ message: roleDeniedMessage("approver") });
    }

    const payload = seedSchema.parse(req.body ?? {});
    const setId = normalizeSetLabel(payload.setId);
    if (!setId) {
      return res.status(400).json({ message: "setId is required" });
    }

    const draft = await prisma.setDraft.findUnique({
      where: { setId },
      select: { id: true },
    });
    if (!draft) {
      return res.status(404).json({ message: "Draft not found for set" });
    }

    const approvedVersionCandidates = await prisma.setApproval.findMany({
      where: {
        draftId: draft.id,
        decision: SetApprovalDecision.APPROVED,
        ...(payload.draftVersionId ? { draftVersionId: payload.draftVersionId } : {}),
      },
      orderBy: [{ createdAt: "desc" }],
      take: payload.draftVersionId ? 1 : 80,
      select: {
        id: true,
        draftVersionId: true,
        draftVersion: {
          select: {
            id: true,
            dataJson: true,
          },
        },
      },
    });

    const approvedVersion =
      approvedVersionCandidates.find(
        (entry) => datasetTypeFromDraftData(entry.draftVersion.dataJson) === payload.datasetType
      ) ?? null;

    if (!approvedVersion) {
      const missingScope = payload.draftVersionId
        ? "Requested draftVersionId is not approved for the requested dataset type."
        : `No approved ${payload.datasetType} draft version found for set.`;
      return res.status(400).json({ message: missingScope });
    }

    const rows = extractDraftRows(approvedVersion.draftVersion.dataJson);
    const targets = buildSeedTargets({
      setId,
      datasetType: payload.datasetType,
      rows,
    });

    if (targets.length < 1) {
      return res.status(400).json({ message: "No eligible draft rows found for reference seeding." });
    }

    let processed = 0;
    let inserted = 0;
    let skipped = 0;
    let failed = 0;
    const failures: string[] = [];

    for (const target of targets) {
      let success = false;
      let lastFailureMessage = "";

      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          const seed = await seedVariantReferenceImages({
            setId,
            cardNumber: target.cardNumber,
            parallelId: target.parallelId,
            playerSeed: target.playerSeed,
            query: target.query,
            limit: payload.limit,
            tbs: payload.tbs,
            gl: payload.gl,
            hl: payload.hl,
          });
          inserted += Number(seed.inserted ?? 0);
          skipped += Number(seed.skipped ?? 0);
          success = true;
          break;
        } catch (error) {
          lastFailureMessage = error instanceof Error ? error.message : "Unknown seed failure";
          const statusCode = error instanceof ReferenceSeedError ? error.status : null;
          const retryable = statusCode === 429 || statusCode === null || (statusCode != null && statusCode >= 500);
          if (attempt < 2 && retryable) {
            await wait(250 * attempt);
            continue;
          }
          break;
        }
      }

      if (!success) {
        failed += 1;
        if (failures.length < 8) {
          failures.push(
            `${target.cardNumber} ${target.parallelId}${target.playerSeed ? ` (${target.playerSeed})` : ""}: ${
              lastFailureMessage || "unknown error"
            }`
          );
        }
      }

      processed += 1;
    }

    const audit = await writeSetOpsAuditEvent({
      req,
      admin,
      action: "set_ops.seed.reference",
      status: failed > 0 ? SetAuditStatus.FAILURE : SetAuditStatus.SUCCESS,
      setId,
      draftId: draft.id,
      draftVersionId: approvedVersion.draftVersion.id,
      approvalId: approvedVersion.id,
      metadata: {
        datasetType: payload.datasetType,
        targetCount: targets.length,
        processed,
        inserted,
        skipped,
        failed,
        failures,
      },
    });

    return res.status(200).json({
      summary: {
        setId,
        datasetType: payload.datasetType,
        draftVersionId: approvedVersion.draftVersion.id,
        targetCount: targets.length,
        processed,
        inserted,
        skipped,
        failed,
        failures,
      },
      audit: audit
        ? {
            id: audit.id,
            status: audit.status,
            action: audit.action,
            createdAt: audit.createdAt.toISOString(),
          }
        : null,
    });
  } catch (error) {
    const isValidation = error instanceof z.ZodError || (error instanceof ReferenceSeedError && error.status < 500);

    await writeSetOpsAuditEvent({
      req,
      admin,
      action: "set_ops.seed.reference",
      status: isValidation ? SetAuditStatus.DENIED : SetAuditStatus.FAILURE,
      setId: attemptedSetId || null,
      reason: error instanceof Error ? error.message : "Unknown failure",
    });

    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: error.issues[0]?.message ?? "Invalid payload" });
    }
    if (error instanceof ReferenceSeedError) {
      return res.status(error.status).json({ message: error.message });
    }

    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
