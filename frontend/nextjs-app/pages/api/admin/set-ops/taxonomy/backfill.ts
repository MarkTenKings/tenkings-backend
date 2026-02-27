import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { prisma, SetApprovalDecision, SetAuditStatus, SetDatasetType } from "@tenkings/database";
import { normalizeSetLabel } from "@tenkings/shared";
import { requireAdminSession, toErrorResponse, type AdminSession } from "../../../../../lib/server/admin";
import {
  canPerformSetOpsRole,
  roleDeniedMessage,
  writeSetOpsAuditEvent,
} from "../../../../../lib/server/setOps";
import { buildTaxonomyIngestRows, extractDraftRows } from "../../../../../lib/server/setOpsDrafts";
import { readTaxonomyV2Flags } from "../../../../../lib/server/taxonomyV2Flags";
import {
  backfillTaxonomyV2FromLegacyVariants,
  ingestTaxonomyV2FromIngestionJob,
} from "../../../../../lib/server/taxonomyV2Core";

type TaxonomySetCounts = {
  programs: number;
  parallels: number;
  scopes: number;
  odds: number;
  maps: number;
  variants: number;
};

type BackfillSetResult = {
  setId: string;
  draftId: string;
  approvalId: string | null;
  draftVersionId: string | null;
  datasetType: SetDatasetType | null;
  ingestionJobId: string | null;
  rowCount: number;
  eligibleRowCount: number;
  blockingRowCount: number;
  beforeCounts: TaxonomySetCounts;
  afterCounts: TaxonomySetCounts | null;
  applied: boolean;
  skippedReason: string | null;
  ingest: {
    applied: boolean;
    adapter: string;
    sourceId: string | null;
    sourceKind: string | null;
    artifactType: string | null;
    counts: {
      programs: number;
      cards: number;
      variations: number;
      parallels: number;
      scopes: number;
      oddsRows: number;
      conflicts: number;
      ambiguities: number;
      bridges: number;
    };
    skippedReason: string | null;
  } | null;
  legacyBootstrap: {
    applied: boolean;
    sourceId: string | null;
    counts: {
      programs: number;
      cards: number;
      parallels: number;
      scopes: number;
      bridges: number;
    };
    skippedReason: string | null;
  } | null;
};

type ResponseBody =
  | {
      dryRun: boolean;
      requestedSetIds: string[];
      processed: number;
      applied: number;
      skipped: number;
      results: BackfillSetResult[];
      audit: { id: string; status: string; action: string; createdAt: string } | null;
    }
  | { message: string };

const payloadSchema = z.object({
  setIds: z.array(z.string().min(1)).max(25).optional(),
  dryRun: z.boolean().optional(),
});

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseDatasetType(value: unknown): SetDatasetType | null {
  const text = String(value ?? "").trim().toUpperCase();
  if (text === SetDatasetType.PARALLEL_DB || text === SetDatasetType.PLAYER_WORKSHEET) {
    return text as SetDatasetType;
  }
  return null;
}

function escapeSqlLiteral(value: string) {
  return value.replace(/'/g, "''");
}

async function loadTaxonomySetCounts(setId: string): Promise<TaxonomySetCounts> {
  const safeSetId = escapeSqlLiteral(setId);
  const rows = (await prisma.$queryRawUnsafe(`
    select
      (select count(*)::int from "SetProgram" where "setId" = '${safeSetId}') as programs,
      (select count(*)::int from "SetParallel" where "setId" = '${safeSetId}') as parallels,
      (select count(*)::int from "SetParallelScope" where "setId" = '${safeSetId}') as scopes,
      (select count(*)::int from "SetOddsByFormat" where "setId" = '${safeSetId}') as odds,
      (select count(*)::int from "CardVariantTaxonomyMap" where "setId" = '${safeSetId}') as maps,
      (select count(*)::int from "CardVariant" where "setId" = '${safeSetId}') as variants
  `)) as Array<{
    programs: number;
    parallels: number;
    scopes: number;
    odds: number;
    maps: number;
    variants: number;
  }>;

  const row = rows[0];
  if (!row) {
    return {
      programs: 0,
      parallels: 0,
      scopes: 0,
      odds: 0,
      maps: 0,
      variants: 0,
    };
  }

  return {
    programs: Number(row.programs || 0),
    parallels: Number(row.parallels || 0),
    scopes: Number(row.scopes || 0),
    odds: Number(row.odds || 0),
    maps: Number(row.maps || 0),
    variants: Number(row.variants || 0),
  };
}

function normalizeRequestedSetIds(values: string[] | undefined) {
  return Array.from(
    new Set(
      (values || [])
        .map((value) => normalizeSetLabel(value))
        .filter(Boolean)
    )
  );
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  let admin: AdminSession | null = null;

  try {
    admin = await requireAdminSession(req);

    if (!canPerformSetOpsRole(admin, "approver")) {
      await writeSetOpsAuditEvent({
        req,
        admin,
        action: "set_ops.taxonomy.backfill",
        status: SetAuditStatus.DENIED,
        reason: roleDeniedMessage("approver"),
      });
      return res.status(403).json({ message: roleDeniedMessage("approver") });
    }

    const flags = readTaxonomyV2Flags();
    if (!flags.ingest) {
      return res.status(400).json({ message: "Taxonomy V2 ingest flag is disabled" });
    }

    const payload = payloadSchema.parse(req.body ?? {});
    const dryRun = Boolean(payload.dryRun);
    const requestedSetIds = normalizeRequestedSetIds(payload.setIds);

    const approvedDrafts = await prisma.setDraft.findMany({
      where: {
        status: "APPROVED",
        archivedAt: null,
        ...(requestedSetIds.length ? { setId: { in: requestedSetIds } } : {}),
      },
      select: {
        id: true,
        setId: true,
      },
      orderBy: {
        setId: "asc",
      },
    });

    if (approvedDrafts.length < 1) {
      return res.status(404).json({ message: "No approved active drafts found for taxonomy backfill" });
    }

    const results: BackfillSetResult[] = [];

    for (const draft of approvedDrafts) {
      const beforeCounts = await loadTaxonomySetCounts(draft.setId);

      const approval = await prisma.setApproval.findFirst({
        where: {
          draftId: draft.id,
          decision: SetApprovalDecision.APPROVED,
        },
        orderBy: [{ createdAt: "desc" }],
        select: {
          id: true,
          draftVersionId: true,
          draftVersion: {
            select: {
              id: true,
              version: true,
              rowCount: true,
              blockingErrorCount: true,
              dataJson: true,
              sourceLinksJson: true,
            },
          },
        },
      });

      if (!approval || !approval.draftVersion) {
        results.push({
          setId: draft.setId,
          draftId: draft.id,
          approvalId: approval?.id ?? null,
          draftVersionId: approval?.draftVersionId ?? null,
          datasetType: null,
          ingestionJobId: null,
          rowCount: 0,
          eligibleRowCount: 0,
          blockingRowCount: 0,
          beforeCounts,
          afterCounts: null,
          applied: false,
          skippedReason: "No approved draft version found",
          ingest: null,
          legacyBootstrap: null,
        });
        continue;
      }

      const dataJsonRecord = asRecord(approval.draftVersion.dataJson);
      const versionDatasetType = parseDatasetType(dataJsonRecord?.datasetType);
      const sourceLinks = asRecord(approval.draftVersion.sourceLinksJson);
      const sourceLinkIngestionId = typeof sourceLinks?.ingestionJobId === "string" ? sourceLinks.ingestionJobId : null;
      const sourceLinkUrl = typeof sourceLinks?.sourceUrl === "string" ? sourceLinks.sourceUrl : null;

      const rows = extractDraftRows(approval.draftVersion.dataJson);
      const taxonomyRows = buildTaxonomyIngestRows(rows);
      const blockingRowCount = rows.length - taxonomyRows.length;

      const jobCandidates = await prisma.setIngestionJob.findMany({
        where: {
          setId: draft.setId,
        },
        select: {
          id: true,
          datasetType: true,
          status: true,
          sourceUrl: true,
          parserVersion: true,
          parseSummaryJson: true,
          reviewedAt: true,
          createdAt: true,
        },
        orderBy: [{ reviewedAt: "desc" }, { createdAt: "desc" }],
        take: 30,
      });

      const datasetType =
        versionDatasetType ??
        jobCandidates.find((job) => job.id === sourceLinkIngestionId)?.datasetType ??
        null;

      if (!datasetType) {
        results.push({
          setId: draft.setId,
          draftId: draft.id,
          approvalId: approval.id,
          draftVersionId: approval.draftVersion.id,
          datasetType: null,
          ingestionJobId: null,
          rowCount: rows.length,
          eligibleRowCount: taxonomyRows.length,
          blockingRowCount,
          beforeCounts,
          afterCounts: null,
          applied: false,
          skippedReason: "Unable to resolve dataset type from approved draft version",
          ingest: null,
          legacyBootstrap: null,
        });
        continue;
      }

      const datasetJobs = jobCandidates.filter((job) => job.datasetType === datasetType);
      const sourceJob =
        datasetJobs.find((job) => job.id === sourceLinkIngestionId) ??
        datasetJobs.find((job) => {
          const summary = asRecord(job.parseSummaryJson);
          return typeof summary?.draftVersionId === "string" && summary.draftVersionId === approval.draftVersion.id;
        }) ??
        datasetJobs[0] ??
        null;

      if (!sourceJob) {
        results.push({
          setId: draft.setId,
          draftId: draft.id,
          approvalId: approval.id,
          draftVersionId: approval.draftVersion.id,
          datasetType,
          ingestionJobId: null,
          rowCount: rows.length,
          eligibleRowCount: taxonomyRows.length,
          blockingRowCount,
          beforeCounts,
          afterCounts: null,
          applied: false,
          skippedReason: "No ingestion job found for approved draft dataset type",
          ingest: null,
          legacyBootstrap: null,
        });
        continue;
      }

      if (taxonomyRows.length < 1) {
        results.push({
          setId: draft.setId,
          draftId: draft.id,
          approvalId: approval.id,
          draftVersionId: approval.draftVersion.id,
          datasetType,
          ingestionJobId: sourceJob.id,
          rowCount: rows.length,
          eligibleRowCount: 0,
          blockingRowCount,
          beforeCounts,
          afterCounts: null,
          applied: false,
          skippedReason: "No eligible taxonomy rows after blocking-error filtering",
          ingest: null,
          legacyBootstrap: null,
        });
        continue;
      }

      if (dryRun) {
        results.push({
          setId: draft.setId,
          draftId: draft.id,
          approvalId: approval.id,
          draftVersionId: approval.draftVersion.id,
          datasetType,
          ingestionJobId: sourceJob.id,
          rowCount: rows.length,
          eligibleRowCount: taxonomyRows.length,
          blockingRowCount,
          beforeCounts,
          afterCounts: null,
          applied: false,
          skippedReason: null,
          ingest: null,
          legacyBootstrap: null,
        });
        continue;
      }

      const ingest = await ingestTaxonomyV2FromIngestionJob({
        setId: draft.setId,
        ingestionJobId: sourceJob.id,
        datasetType,
        rawPayload: taxonomyRows,
        sourceUrl: sourceJob.sourceUrl ?? sourceLinkUrl,
        parserVersion: sourceJob.parserVersion,
        parseSummary: asRecord(sourceJob.parseSummaryJson),
      });

      let afterCounts = await loadTaxonomySetCounts(draft.setId);
      let legacyBootstrap: BackfillSetResult["legacyBootstrap"] = null;

      if (afterCounts.programs < 1 || afterCounts.scopes < 1) {
        const bootstrap = await backfillTaxonomyV2FromLegacyVariants({
          setId: draft.setId,
          ingestionJobId: sourceJob.id,
          sourceLabel: "approved-draft-legacy-bootstrap",
        });
        legacyBootstrap = {
          applied: bootstrap.applied,
          sourceId: bootstrap.sourceId,
          counts: bootstrap.counts,
          skippedReason: bootstrap.skippedReason ?? null,
        };
        afterCounts = await loadTaxonomySetCounts(draft.setId);
      }

      await writeSetOpsAuditEvent({
        req,
        admin,
        action: "set_ops.taxonomy.backfill",
        status: SetAuditStatus.SUCCESS,
        setId: draft.setId,
        draftId: draft.id,
        draftVersionId: approval.draftVersion.id,
        ingestionJobId: sourceJob.id,
        metadata: {
          dryRun: false,
          rowCount: rows.length,
          eligibleRowCount: taxonomyRows.length,
          blockingRowCount,
          ingest: {
            applied: ingest.applied,
            adapter: ingest.adapter,
            sourceId: ingest.sourceId,
            sourceKind: ingest.sourceKind,
            artifactType: ingest.artifactType,
            counts: ingest.counts,
            skippedReason: ingest.skippedReason ?? null,
          },
          legacyBootstrap,
          beforeCounts,
          afterCounts,
        },
      });

      results.push({
        setId: draft.setId,
        draftId: draft.id,
        approvalId: approval.id,
        draftVersionId: approval.draftVersion.id,
        datasetType,
        ingestionJobId: sourceJob.id,
        rowCount: rows.length,
        eligibleRowCount: taxonomyRows.length,
        blockingRowCount,
        beforeCounts,
        afterCounts,
        applied: Boolean(ingest.applied),
        skippedReason: ingest.skippedReason ?? null,
        ingest: {
          applied: ingest.applied,
          adapter: ingest.adapter,
          sourceId: ingest.sourceId,
          sourceKind: ingest.sourceKind,
          artifactType: ingest.artifactType,
          counts: ingest.counts,
          skippedReason: ingest.skippedReason ?? null,
        },
        legacyBootstrap,
      });
    }

    const applied = results.filter((result) => result.applied).length;
    const skipped = results.length - applied;

    const audit = await writeSetOpsAuditEvent({
      req,
      admin,
      action: "set_ops.taxonomy.backfill.batch",
      status: SetAuditStatus.SUCCESS,
      metadata: {
        dryRun,
        requestedSetIds,
        processed: results.length,
        applied,
        skipped,
      },
    });

    return res.status(200).json({
      dryRun,
      requestedSetIds,
      processed: results.length,
      applied,
      skipped,
      results,
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
    await writeSetOpsAuditEvent({
      req,
      admin,
      action: "set_ops.taxonomy.backfill.batch",
      status: SetAuditStatus.FAILURE,
      reason: error instanceof Error ? error.message : "Unknown failure",
    });

    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: error.issues[0]?.message ?? "Invalid payload" });
    }

    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
