import type { NextApiRequest, NextApiResponse } from "next";
import type {
  AiGraderProductionPersistResult,
  AiGraderProductionReleaseLike,
  AiGraderProductionReportBundleLike,
  AiGraderProductionStoragePlan,
} from "@tenkings/database";
import {
  buildAiGraderProductionStoragePlan,
  persistAiGraderProductionRelease,
} from "@tenkings/database";
import type { AdminSession } from "./admin";

export const AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV = "AI_GRADER_PRODUCTION_PUBLISH_ENABLED";
export const AI_GRADER_PRODUCTION_TENANT_ID_ENV = "AI_GRADER_PRODUCTION_TENANT_ID";
export const AI_GRADER_PUBLIC_REPORT_DB_ENABLED_ENV = "AI_GRADER_PUBLIC_REPORT_DB_ENABLED";

type JsonRecord = Record<string, unknown>;
type EnvLike = Record<string, string | undefined>;

export type AiGraderProductionUploadResult = {
  storageKey: string;
  publicUrl: string;
};

export type AiGraderProductionApiDependencies = {
  env?: EnvLike;
  requireAdminSession(req: NextApiRequest): Promise<AdminSession>;
  publicUrlFor(storageKey: string): string;
  uploadArtifact(input: {
    storageKey: string;
    body: string;
    contentType: string;
  }): Promise<AiGraderProductionUploadResult>;
  persist(input: {
    tenantId: string;
    reportBundle: AiGraderProductionReportBundleLike;
    productionRelease: AiGraderProductionReleaseLike;
    storagePlan: AiGraderProductionStoragePlan;
    publicationStatus: "draft" | "finalized" | "published" | "unpublished" | "revoked" | "error";
    operatorUserId?: string | null;
    cardAssetId?: string | null;
    itemId?: string | null;
  }): Promise<AiGraderProductionPersistResult>;
  listHistory?(): Promise<AiGraderProductionHistoryResult>;
};

export type AiGraderProductionHistoryItem = {
  reportId: string;
  gradingSessionId?: string | null;
  reportStatus: string;
  publicationStatus: string;
  visibilityStatus: string;
  publicReportUrl?: string | null;
  qrPayloadUrl?: string | null;
  finalOverallGrade?: number | null;
  confidence?: unknown;
  warnings?: unknown;
  cardAssetId?: string | null;
  itemId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  finalizedAt?: string | null;
  publishedAt?: string | null;
};

export type AiGraderProductionHistoryResult = {
  source: "persisted_records";
  items: AiGraderProductionHistoryItem[];
  stats: {
    total: number;
    published: number;
    finalized: number;
    draft: number;
    averageFinalGrade: number | null;
    gradeDistribution: Record<string, number>;
    warningCount: number;
  };
};

export type AiGraderPublicReportApiDependencies = {
  env?: EnvLike;
  readPublishedBundle(reportId: string): Promise<AiGraderProductionReportBundleLike | null>;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function actionKey(req: NextApiRequest) {
  const action = req.query.action;
  if (Array.isArray(action)) return action.join("/");
  if (typeof action === "string") return action;
  return "status";
}

function isEnabled(env: EnvLike | undefined, key: string) {
  return env?.[key] === "true";
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function parsePublishBody(body: unknown) {
  if (!isRecord(body)) throw new Error("JSON object body is required.");
  if (!isRecord(body.reportBundle)) throw new Error("reportBundle is required.");
  if (!isRecord(body.productionRelease)) throw new Error("productionRelease is required.");
  const status = stringValue(body.publicationStatus, "published");
  if (!["draft", "finalized", "published", "unpublished", "revoked", "error"].includes(status)) {
    throw new Error("publicationStatus must be draft, finalized, published, unpublished, revoked, or error.");
  }
  return {
    reportBundle: body.reportBundle as AiGraderProductionReportBundleLike,
    productionRelease: body.productionRelease as AiGraderProductionReleaseLike,
    publicationStatus: status as "draft" | "finalized" | "published" | "unpublished" | "revoked" | "error",
    cardAssetId: typeof body.cardAssetId === "string" ? body.cardAssetId : undefined,
    itemId: typeof body.itemId === "string" ? body.itemId : undefined,
  };
}

function dateString(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return null;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function warningCount(value: unknown) {
  if (Array.isArray(value)) return value.length;
  if (isRecord(value)) return Object.keys(value).length;
  return value ? 1 : 0;
}

export function buildAiGraderProductionHistoryResult(rows: unknown[]): AiGraderProductionHistoryResult {
  const items = rows.filter(isRecord).map((row) => {
    const session = isRecord(row.session) ? row.session : {};
    return {
      reportId: stringValue(row.reportId, "unknown-report"),
      gradingSessionId: typeof session.gradingSessionId === "string" ? session.gradingSessionId : null,
      reportStatus: stringValue(row.reportStatus, "draft"),
      publicationStatus: stringValue(row.publicationStatus, "draft"),
      visibilityStatus: stringValue(row.visibilityStatus, "private"),
      publicReportUrl: typeof row.publicReportUrl === "string" ? row.publicReportUrl : null,
      qrPayloadUrl: typeof row.qrPayloadUrl === "string" ? row.qrPayloadUrl : null,
      finalOverallGrade: asNumber(row.finalOverallGrade),
      confidence: row.confidence,
      warnings: row.warnings,
      cardAssetId: typeof row.cardAssetId === "string" ? row.cardAssetId : null,
      itemId: typeof row.itemId === "string" ? row.itemId : null,
      createdAt: dateString(row.createdAt),
      updatedAt: dateString(row.updatedAt),
      finalizedAt: dateString(row.finalizedAt),
      publishedAt: dateString(row.publishedAt),
    };
  });
  const graded = items
    .map((item) => item.finalOverallGrade)
    .filter((grade): grade is number => typeof grade === "number" && Number.isFinite(grade));
  const gradeDistribution: Record<string, number> = {};
  for (const grade of graded) {
    const bucket = String(Math.floor(grade));
    gradeDistribution[bucket] = (gradeDistribution[bucket] ?? 0) + 1;
  }
  return {
    source: "persisted_records",
    items,
    stats: {
      total: items.length,
      published: items.filter((item) => item.publicationStatus === "published").length,
      finalized: items.filter((item) => item.publicationStatus === "finalized").length,
      draft: items.filter((item) => item.publicationStatus === "draft").length,
      averageFinalGrade: graded.length ? Number((graded.reduce((sum, grade) => sum + grade, 0) / graded.length).toFixed(2)) : null,
      gradeDistribution,
      warningCount: items.reduce((sum, item) => sum + warningCount(item.warnings), 0),
    },
  };
}

async function uploadPlanArtifacts(
  deps: AiGraderProductionApiDependencies,
  plan: AiGraderProductionStoragePlan
): Promise<AiGraderProductionStoragePlan> {
  const uploaded = [];
  for (const artifact of plan.artifacts) {
    const result = await deps.uploadArtifact({
      storageKey: artifact.storageKey,
      body: artifact.body,
      contentType: artifact.contentType,
    });
    uploaded.push({
      ...artifact,
      publicUrl: result.publicUrl,
    });
  }
  return {
    ...plan,
    artifacts: uploaded,
    assetManifest: uploaded.map((artifact) => ({
      artifactId: artifact.artifactId,
      kind: artifact.kind,
      storageKey: artifact.storageKey,
      checksumSha256: artifact.checksumSha256,
      byteSize: artifact.byteSize,
      publicUrl: artifact.publicUrl,
    })),
  };
}

export function createAiGraderProductionApiHandler(deps: AiGraderProductionApiDependencies) {
  const env = deps.env ?? process.env;
  return async function aiGraderProductionApiHandler(req: NextApiRequest, res: NextApiResponse) {
    const key = actionKey(req);
    if (key === "status") {
      if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        return res.status(405).json({ ok: false, message: "Method not allowed" });
      }
      return res.status(200).json({
        ok: true,
        enabled: isEnabled(env, AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV),
        service: "ai-grader-production-publication",
        writesRequireEnv: AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV,
        publicReportDbReadsEnabled: isEnabled(env, AI_GRADER_PUBLIC_REPORT_DB_ENABLED_ENV),
        noHardwareControls: true,
      });
    }

    if (key !== "publish" && key !== "history") {
      return res.status(404).json({ ok: false, message: "AI Grader production API route not found" });
    }
    const allow = key === "history" ? "GET" : "POST";
    if (req.method !== allow) {
      res.setHeader("Allow", allow);
      return res.status(405).json({ ok: false, message: "Method not allowed" });
    }
    if (!isEnabled(env, AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV)) {
      return res.status(503).json({
        ok: false,
        enabled: false,
        code: "AI_GRADER_PRODUCTION_PUBLISH_DISABLED",
        message: "AI Grader production persistence/upload is disabled. Set AI_GRADER_PRODUCTION_PUBLISH_ENABLED=true after migrations and storage are approved.",
      });
    }

    try {
      const admin = await deps.requireAdminSession(req);
      if (key === "history") {
        const result = deps.listHistory ? await deps.listHistory() : { status: "not_implemented", items: [] };
        return res.status(200).json({ ok: true, enabled: true, operation: "aiGraderProductionHistory", result });
      }
      const input = parsePublishBody(req.body);
      const tenantId = env[AI_GRADER_PRODUCTION_TENANT_ID_ENV] ?? "ten-kings";
      const initialPlan = buildAiGraderProductionStoragePlan({
        reportBundle: input.reportBundle,
        productionRelease: input.productionRelease,
        publicReportBaseUrl: "https://collect.tenkings.co",
        publicUrlFor: deps.publicUrlFor,
      });
      const uploadedPlan = await uploadPlanArtifacts(deps, initialPlan);
      const result = await deps.persist({
        tenantId,
        reportBundle: input.reportBundle,
        productionRelease: input.productionRelease,
        storagePlan: uploadedPlan,
        publicationStatus: input.publicationStatus,
        operatorUserId: admin.user.id,
        cardAssetId: input.cardAssetId,
        itemId: input.itemId,
      });
      return res.status(200).json({
        ok: true,
        enabled: true,
        operation: "aiGraderProductionPublish",
        result: {
          reportId: result.reportId,
          gradingSessionId: result.gradingSessionId,
          publicationStatus: result.publicationStatus,
          publicReportUrl: result.storagePlan.publicReportUrl,
          qrPayloadUrl: result.storagePlan.qrPayloadUrl,
          uploadedAssetCount: result.storagePlan.artifacts.length,
          evidenceAssetCount: result.evidenceAssetCount,
          cardAssetUpdatedCount: result.cardAssetUpdatedCount,
          itemUpdatedCount: result.itemUpdatedCount,
        },
      });
    } catch (error) {
      return res.status(400).json({
        ok: false,
        message: error instanceof Error ? error.message : "AI Grader production publish failed.",
      });
    }
  };
}

export function createAiGraderPublicReportApiHandler(deps: AiGraderPublicReportApiDependencies) {
  const env = deps.env ?? process.env;
  return async function aiGraderPublicReportApiHandler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ ok: false, message: "Method not allowed" });
    }
    if (!isEnabled(env, AI_GRADER_PUBLIC_REPORT_DB_ENABLED_ENV)) {
      return res.status(503).json({
        ok: false,
        enabled: false,
        code: "AI_GRADER_PUBLIC_REPORT_DB_DISABLED",
        message: "Persisted AI Grader public report reads are disabled until migrations/storage are approved.",
      });
    }
    const reportId = Array.isArray(req.query.reportId) ? req.query.reportId[0] : req.query.reportId;
    if (!reportId) return res.status(400).json({ ok: false, message: "reportId is required." });
    const bundle = await deps.readPublishedBundle(reportId);
    if (!bundle) return res.status(404).json({ ok: false, message: "Published AI Grader report not found." });
    return res.status(200).json({
      ok: true,
      reportId,
      bundle,
      readOnly: true,
      noHardwareControls: true,
    });
  };
}

export async function persistProductionReleaseRuntime(input: {
  tenantId: string;
  reportBundle: AiGraderProductionReportBundleLike;
  productionRelease: AiGraderProductionReleaseLike;
  storagePlan: AiGraderProductionStoragePlan;
  publicationStatus: "draft" | "finalized" | "published" | "unpublished" | "revoked" | "error";
  operatorUserId?: string | null;
  cardAssetId?: string | null;
  itemId?: string | null;
}) {
  const { prisma } = await import("@tenkings/database");
  return persistAiGraderProductionRelease(prisma as any, input);
}

export async function listProductionReportHistoryRuntime(): Promise<AiGraderProductionHistoryResult> {
  const { prisma } = await import("@tenkings/database");
  const db = prisma as any;
  const rows = await db.aiGraderReport?.findMany?.({
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: {
      reportId: true,
      reportStatus: true,
      publicationStatus: true,
      visibilityStatus: true,
      publicReportUrl: true,
      qrPayloadUrl: true,
      finalOverallGrade: true,
      confidence: true,
      warnings: true,
      cardAssetId: true,
      itemId: true,
      createdAt: true,
      updatedAt: true,
      finalizedAt: true,
      publishedAt: true,
      session: {
        select: {
          gradingSessionId: true,
        },
      },
    },
  });
  return buildAiGraderProductionHistoryResult(Array.isArray(rows) ? rows : []);
}
