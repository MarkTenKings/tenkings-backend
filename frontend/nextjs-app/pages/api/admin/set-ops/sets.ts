import type { NextApiRequest, NextApiResponse } from "next";
import { Prisma } from "@prisma/client";
import { prisma, SetAuditStatus, SetDatasetType } from "@tenkings/database";
import { normalizeSetLabel } from "@tenkings/shared";
import { requireAdminSession, toErrorResponse, type AdminSession } from "../../../../lib/server/admin";
import {
  canPerformSetOpsRole,
  roleDeniedMessage,
  writeSetOpsAuditEvent,
} from "../../../../lib/server/setOps";

type SetSummaryRow = {
  setId: string;
  label: string;
  draftStatus: string | null;
  archived: boolean;
  variantCount: number;
  referenceCount: number;
  lastSeedStatus: string | null;
  lastSeedAt: string | null;
  updatedAt: string | null;
  checklistStatus: string | null;
  oddsStatus: string | null;
  hasChecklist: boolean;
  hasOdds: boolean;
};

function isDatasetConnected(status: string | null) {
  if (!status) return false;
  return status.toUpperCase() === "APPROVED";
}

type ResponseBody =
  | {
      sets: SetSummaryRow[];
      total: number;
    }
  | { message: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  let admin: AdminSession | null = null;

  try {
    admin = await requireAdminSession(req);

    if (!canPerformSetOpsRole(admin, "reviewer")) {
      await writeSetOpsAuditEvent({
        req,
        admin,
        action: "set_ops.sets.list",
        status: SetAuditStatus.DENIED,
        reason: roleDeniedMessage("reviewer"),
      });
      return res.status(403).json({ message: roleDeniedMessage("reviewer") });
    }

    const q = normalizeSetLabel(typeof req.query.q === "string" ? req.query.q : "");
    const includeArchived = String(req.query.includeArchived ?? "true").trim().toLowerCase() !== "false";
    const limit = Math.min(1000, Math.max(1, Number(req.query.limit ?? 200) || 200));

    const whereBySetId = q
      ? {
          setId: {
            contains: q,
            mode: Prisma.QueryMode.insensitive,
          },
        }
      : undefined;

    const [variantCounts, referenceCounts, drafts, seedJobs, ingestionJobs] = await Promise.all([
      prisma.cardVariant.groupBy({
        by: ["setId"],
        where: whereBySetId,
        _count: { _all: true },
      }),
      prisma.cardVariantReferenceImage.groupBy({
        by: ["setId"],
        where: whereBySetId,
        _count: { _all: true },
      }),
      prisma.setDraft.findMany({
        where: whereBySetId,
        select: {
          setId: true,
          normalizedLabel: true,
          status: true,
          archivedAt: true,
          updatedAt: true,
        },
      }),
      prisma.setSeedJob.findMany({
        where: q
          ? {
              draft: {
                setId: {
                  contains: q,
                  mode: Prisma.QueryMode.insensitive,
                },
              },
            }
          : undefined,
        orderBy: [{ createdAt: "desc" }],
        select: {
          status: true,
          createdAt: true,
          draft: { select: { setId: true } },
        },
        take: Math.max(limit * 8, 500),
      }),
      prisma.setIngestionJob.findMany({
        where: q
          ? {
              setId: {
                contains: q,
                mode: Prisma.QueryMode.insensitive,
              },
            }
          : undefined,
        orderBy: [{ createdAt: "desc" }],
        select: {
          setId: true,
          datasetType: true,
          status: true,
          updatedAt: true,
        },
        take: Math.max(limit * 16, 1000),
      }),
    ]);

    const variantBySet = new Map<string, number>();
    for (const entry of variantCounts) {
      variantBySet.set(entry.setId, entry._count._all);
    }

    const referenceBySet = new Map<string, number>();
    for (const entry of referenceCounts) {
      referenceBySet.set(entry.setId, entry._count._all);
    }

    const draftBySet = new Map<string, (typeof drafts)[number]>();
    for (const draft of drafts) {
      draftBySet.set(draft.setId, draft);
    }

    const seedBySet = new Map<string, { status: string; createdAt: Date }>();
    for (const seedJob of seedJobs) {
      const setId = seedJob.draft.setId;
      if (!seedBySet.has(setId)) {
        seedBySet.set(setId, {
          status: seedJob.status,
          createdAt: seedJob.createdAt,
        });
      }
    }

    const ingestionBySet = new Map<
      string,
      {
        checklistStatus: string | null;
        checklistUpdatedAt: Date | null;
        oddsStatus: string | null;
        oddsUpdatedAt: Date | null;
      }
    >();

    for (const job of ingestionJobs) {
      const existing = ingestionBySet.get(job.setId) ?? {
        checklistStatus: null,
        checklistUpdatedAt: null,
        oddsStatus: null,
        oddsUpdatedAt: null,
      };
      if (job.datasetType === SetDatasetType.PLAYER_WORKSHEET && !existing.checklistStatus) {
        existing.checklistStatus = job.status;
        existing.checklistUpdatedAt = job.updatedAt;
      }
      if (job.datasetType === SetDatasetType.PARALLEL_DB && !existing.oddsStatus) {
        existing.oddsStatus = job.status;
        existing.oddsUpdatedAt = job.updatedAt;
      }
      ingestionBySet.set(job.setId, existing);
    }

    const setIds = new Set<string>();
    for (const setId of variantBySet.keys()) setIds.add(setId);
    for (const setId of referenceBySet.keys()) setIds.add(setId);
    for (const setId of draftBySet.keys()) setIds.add(setId);
    for (const setId of seedBySet.keys()) setIds.add(setId);
    for (const setId of ingestionBySet.keys()) setIds.add(setId);

    const rows: SetSummaryRow[] = [];

    for (const setId of setIds) {
      const draft = draftBySet.get(setId) ?? null;
      const archived = Boolean(draft?.archivedAt || draft?.status === "ARCHIVED");
      if (!includeArchived && archived) {
        continue;
      }

      const lastSeed = seedBySet.get(setId) ?? null;
      const ingestion = ingestionBySet.get(setId) ?? {
        checklistStatus: null,
        checklistUpdatedAt: null,
        oddsStatus: null,
        oddsUpdatedAt: null,
      };
      const updatedCandidates = [draft?.updatedAt ?? null, lastSeed?.createdAt ?? null].filter(
        (value): value is Date => value instanceof Date
      );
      if (ingestion.checklistUpdatedAt instanceof Date) updatedCandidates.push(ingestion.checklistUpdatedAt);
      if (ingestion.oddsUpdatedAt instanceof Date) updatedCandidates.push(ingestion.oddsUpdatedAt);
      const updatedAt = updatedCandidates.length
        ? new Date(Math.max(...updatedCandidates.map((value) => value.getTime()))).toISOString()
        : null;

      rows.push({
        setId,
        label: draft?.normalizedLabel?.trim() || normalizeSetLabel(setId),
        draftStatus: draft?.status ?? null,
        archived,
        variantCount: variantBySet.get(setId) ?? 0,
        referenceCount: referenceBySet.get(setId) ?? 0,
        lastSeedStatus: lastSeed?.status ?? null,
        lastSeedAt: lastSeed?.createdAt ? lastSeed.createdAt.toISOString() : null,
        updatedAt,
        checklistStatus: ingestion.checklistStatus,
        oddsStatus: ingestion.oddsStatus,
        hasChecklist: isDatasetConnected(ingestion.checklistStatus),
        hasOdds: isDatasetConnected(ingestion.oddsStatus),
      });
    }

    rows.sort((a, b) => a.setId.localeCompare(b.setId));

    return res.status(200).json({
      sets: rows.slice(0, limit),
      total: rows.length,
    });
  } catch (error) {
    await writeSetOpsAuditEvent({
      req,
      admin,
      action: "set_ops.sets.list",
      status: SetAuditStatus.FAILURE,
      reason: error instanceof Error ? error.message : "Unknown failure",
      metadata: {
        query: typeof req.query.q === "string" ? req.query.q : null,
      },
    });

    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
