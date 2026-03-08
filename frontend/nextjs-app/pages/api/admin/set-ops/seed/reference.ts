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
import { normalizeProgramId } from "../../../../../lib/server/taxonomyV2Utils";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const seedSchema = z.object({
  setId: z.string().min(1),
  datasetType: z.nativeEnum(SetDatasetType).default(SetDatasetType.PARALLEL_DB),
  draftVersionId: z.string().min(1).optional(),
  previewOnly: z.coerce.boolean().optional().default(false),
  targets: z
    .array(
      z.object({
        programId: z.string().trim().min(1).optional(),
        cardNumber: z.string().trim().min(1),
        parallelId: z.string().trim().min(1),
        playerSeed: z.string().trim().optional().nullable(),
        cardType: z.string().trim().optional().nullable(),
        query: z.string().trim().min(1),
      })
    )
    .max(500)
    .optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  startIndex: z.coerce.number().int().min(0).optional().default(0),
  maxTargets: z.coerce.number().int().min(1).max(500).optional(),
  concurrency: z.coerce.number().int().min(1).max(16).optional().default(6),
  tbs: z.string().trim().max(64).optional(),
  gl: z.string().trim().max(16).optional(),
  hl: z.string().trim().max(16).optional(),
});

type SeedTarget = {
  programId: string;
  cardNumber: string;
  parallelId: string;
  playerSeed: string | null;
  cardType: string | null;
  query: string;
};

type SeedReasonCounts = {
  no_hits: number;
  no_media: number;
  filtered_out: number;
  network: number;
};

type ResponseBody =
  | {
      targets: Array<{
        programId: string;
        cardNumber: string;
        parallelId: string;
        playerSeed: string | null;
        cardType: string | null;
        query: string;
      }>;
      summary: {
        setId: string;
        datasetType: SetDatasetType;
        draftVersionId: string;
        targetCount: number;
        generatedAt: string;
        scopedTargetCount?: number;
        startIndex?: number;
        concurrency?: number;
      };
    }
  | {
      summary: {
        setId: string;
        datasetType: SetDatasetType;
        draftVersionId: string;
        targetCount: number;
        generatedAt: string;
        scopedTargetCount?: number;
        startIndex?: number;
        concurrency?: number;
        processed: number;
        inserted: number;
        skipped: number;
        failed: number;
        reasonCounts: SeedReasonCounts;
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
  const targets: SeedTarget[] = [];

  for (const row of params.rows) {
    if (normalizeSetLabel(row.setId) !== params.setId) continue;
    if (hasBlockingError(row.errors)) continue;
    if (params.datasetType === SetDatasetType.PARALLEL_DB && !row.odds && !row.serial) continue;

    const cardNumber = normalizeCardNumber(row.cardNumber ?? "") || "ALL";
    const fallbackParallel = params.datasetType === SetDatasetType.PLAYER_WORKSHEET ? "base" : "";
    const parallelId = canonicalSeedParallel(row.parallel || fallbackParallel, cardNumber);
    if (!parallelId) continue;

    const playerSeed = primarySeedPlayerLabel(row.playerSeed || row.cardType || "") || null;
    const cardType =
      String(
        row.cardType ||
          (row.raw?.cardType ?? row.raw?.program ?? row.raw?.programLabel ?? row.raw?.subset ?? "") ||
          ""
      ).trim() || null;
    const programId = normalizeProgramId(cardType || "base");
    const query = buildReferenceSeedQuery({
      setId: params.setId,
      cardNumber,
      cardType,
      parallelId,
      playerSeed,
    });
    if (!query) continue;

    targets.push({
      programId,
      cardNumber,
      parallelId,
      playerSeed,
      cardType,
      query,
    });
  }

  return targets;
}

function normalizePostedSeedTargets(
  postedTargets: Array<{
    programId?: string;
    cardNumber: string;
    parallelId: string;
    playerSeed?: string | null;
    cardType?: string | null;
    query: string;
  }>
): SeedTarget[] {
  const normalized: SeedTarget[] = [];
  for (const row of postedTargets) {
    const cardNumber = normalizeCardNumber(row.cardNumber ?? "") || "ALL";
    const parallelId = canonicalSeedParallel(row.parallelId, cardNumber);
    if (!parallelId) continue;
    const cardType = String(row.cardType || "").trim() || null;
    const playerSeed = primarySeedPlayerLabel(row.playerSeed || cardType || "") || null;
    const programId = normalizeProgramId(String(row.programId || cardType || "base"));
    const query = String(row.query || "").trim();
    if (!query) continue;
    normalized.push({
      programId,
      cardNumber,
      parallelId,
      playerSeed,
      cardType,
      query,
    });
  }
  return normalized;
}

function isRetryableSeedStatus(statusCode: number | null) {
  return statusCode === 429 || statusCode === null || (statusCode != null && statusCode >= 500);
}

function seedRetryDelayMs(attempt: number, statusCode: number | null) {
  const base = statusCode === 429 ? 900 : 350;
  const jitter = Math.floor(Math.random() * 250);
  const exponential = base * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(6000, exponential + jitter);
}

function emptySeedReasonCounts(): SeedReasonCounts {
  return {
    no_hits: 0,
    no_media: 0,
    filtered_out: 0,
    network: 0,
  };
}

function coerceSeedReasonCounts(value: unknown): SeedReasonCounts {
  const record = asRecord(value);
  if (!record) return emptySeedReasonCounts();
  return {
    no_hits: Math.max(0, Number(record.no_hits ?? 0) || 0),
    no_media: Math.max(0, Number(record.no_media ?? 0) || 0),
    filtered_out: Math.max(0, Number(record.filtered_out ?? 0) || 0),
    network: Math.max(0, Number(record.network ?? 0) || 0),
  };
}

function mergeSeedReasonCounts(target: SeedReasonCounts, incoming: SeedReasonCounts) {
  target.no_hits += incoming.no_hits;
  target.no_media += incoming.no_media;
  target.filtered_out += incoming.filtered_out;
  target.network += incoming.network;
}

function isNetworkFailure(error: unknown, statusCode: number | null) {
  if (statusCode === 429) return true;
  if (statusCode != null && statusCode >= 500) return true;
  const message = error instanceof Error ? error.message : String(error || "");
  return /network|timeout|fetch|econn|socket|temporar|thrott|serpapi request failed/i.test(message);
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
    const derivedTargets = buildSeedTargets({
      setId,
      datasetType: payload.datasetType,
      rows,
    });
    const postedTargets = Array.isArray(payload.targets)
      ? normalizePostedSeedTargets(payload.targets as Array<{
          programId?: string;
          cardNumber: string;
          parallelId: string;
          playerSeed?: string | null;
          cardType?: string | null;
          query: string;
        }>)
      : [];
    const usingPostedTargets = postedTargets.length > 0;
    const targets = usingPostedTargets ? postedTargets : derivedTargets;

    if (targets.length < 1) {
      return res.status(400).json({ message: "No eligible draft rows found for reference seeding." });
    }

    if (payload.previewOnly) {
      return res.status(200).json({
        targets: targets.map((target) => ({
          programId: target.programId,
          cardNumber: target.cardNumber,
          parallelId: target.parallelId,
          playerSeed: target.playerSeed,
          cardType: target.cardType,
          query: target.query,
        })),
        summary: {
          setId,
          datasetType: payload.datasetType,
          draftVersionId: approvedVersion.draftVersion.id,
          targetCount: targets.length,
          generatedAt: new Date().toISOString(),
        },
      });
    }

    const requestStartIndex = Math.max(0, Number(payload.startIndex ?? 0) || 0);
    const maxTargets = payload.maxTargets ? Math.max(1, Number(payload.maxTargets)) : targets.length;
    const scopedTargets = usingPostedTargets ? targets : targets.slice(requestStartIndex, requestStartIndex + maxTargets);
    if (scopedTargets.length < 1) {
      return res.status(400).json({ message: "No scoped targets found for reference seeding." });
    }

    const workerCount = Math.min(Math.max(1, Number(payload.concurrency ?? 6) || 6), scopedTargets.length);
    const outcomes: Array<{
      inserted: number;
      skipped: number;
      failed: boolean;
      failureMessage: string;
      reasonCounts: SeedReasonCounts;
      target: SeedTarget;
    }> = new Array(scopedTargets.length);

    let cursor = 0;
    const runOne = async (target: SeedTarget) => {
      let lastFailureMessage = "";
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const seed = await seedVariantReferenceImages({
            setId,
            programId: target.programId,
            cardNumber: target.cardNumber,
            parallelId: target.parallelId,
            playerSeed: target.playerSeed,
            query: target.query,
            limit: payload.limit,
            tbs: payload.tbs,
            gl: payload.gl,
            hl: payload.hl,
          });
          return {
            inserted: Number(seed.inserted ?? 0),
            skipped: Number(seed.skipped ?? 0),
            failed: false,
            failureMessage: "",
            reasonCounts: coerceSeedReasonCounts(seed.reasonCounts),
            target,
          };
        } catch (error) {
          lastFailureMessage = error instanceof Error ? error.message : "Unknown seed failure";
          const statusCode = error instanceof ReferenceSeedError ? error.status : null;
          if (attempt < 3 && isRetryableSeedStatus(statusCode)) {
            await wait(seedRetryDelayMs(attempt, statusCode));
            continue;
          }
          return {
            inserted: 0,
            skipped: 0,
            failed: true,
            failureMessage: lastFailureMessage || "unknown error",
            reasonCounts: {
              ...emptySeedReasonCounts(),
              network: isNetworkFailure(error, statusCode) ? 1 : 0,
            },
            target,
          };
        }
      }
      return {
        inserted: 0,
        skipped: 0,
        failed: true,
        failureMessage: lastFailureMessage || "unknown error",
        reasonCounts: {
          ...emptySeedReasonCounts(),
          network: 1,
        },
        target,
      };
    };

    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (true) {
          const index = cursor;
          cursor += 1;
          if (index >= scopedTargets.length) break;
          outcomes[index] = await runOne(scopedTargets[index]);
        }
      })
    );

    let processed = 0;
    let inserted = 0;
    let skipped = 0;
    let failed = 0;
    const reasonCounts = emptySeedReasonCounts();
    const failures: string[] = [];
    for (const outcome of outcomes) {
      if (!outcome) continue;
      processed += 1;
      inserted += outcome.inserted;
      skipped += outcome.skipped;
      mergeSeedReasonCounts(reasonCounts, outcome.reasonCounts);
      if (outcome.failed) {
        failed += 1;
        if (failures.length < 8) {
          const target = outcome.target;
          failures.push(
            `${target.cardNumber} ${target.parallelId}${target.playerSeed ? ` (${target.playerSeed})` : ""}: ${
              outcome.failureMessage
            }`
          );
        }
      }
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
        startIndex: requestStartIndex,
        scopedTargetCount: scopedTargets.length,
        concurrency: workerCount,
        processed,
        inserted,
        skipped,
        failed,
        reasonCounts,
        failures,
      },
    });

    return res.status(200).json({
      summary: {
        setId,
        datasetType: payload.datasetType,
        draftVersionId: approvedVersion.draftVersion.id,
        targetCount: targets.length,
        generatedAt: new Date().toISOString(),
        scopedTargetCount: scopedTargets.length,
        startIndex: requestStartIndex,
        concurrency: workerCount,
        processed,
        inserted,
        skipped,
        failed,
        reasonCounts,
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
