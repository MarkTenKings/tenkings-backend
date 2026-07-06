import type { NextApiRequest, NextApiResponse } from "next";
import type {
  AiGraderCardItemSelection,
  AiGraderProductionPersistResult,
  AiGraderProductionReleaseLike,
  AiGraderProductionReportBundleLike,
  AiGraderProductionStoragePlan,
  AiGraderSlabbedPhotoSide,
  AiGraderValuationStatus,
} from "@tenkings/database";
import {
  aiGraderSha256,
  buildAiGraderCompsSearchQuery,
  buildAiGraderProductionStoragePlan,
  computeAiGraderValuationStatus,
  persistAiGraderSlabbedPhotoAsset,
  persistAiGraderProductionRelease,
  persistAiGraderValuationResult,
} from "@tenkings/database";
import type { AdminSession } from "./admin";
import type { UserSession } from "./session";
import {
  aiGraderProductionAuthStatus,
  requireAiGraderProductionActor,
  type AiGraderProductionAction,
  type AiGraderProductionActor,
  type AiGraderProductionActorAudit,
} from "./aiGraderProductionAuth";

export const AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV = "AI_GRADER_PRODUCTION_PUBLISH_ENABLED";
export const AI_GRADER_PRODUCTION_TENANT_ID_ENV = "AI_GRADER_PRODUCTION_TENANT_ID";
export const AI_GRADER_PUBLIC_REPORT_DB_ENABLED_ENV = "AI_GRADER_PUBLIC_REPORT_DB_ENABLED";
export const AI_GRADER_EBAY_COMPS_ENABLED_ENV = "AI_GRADER_EBAY_COMPS_ENABLED";

type JsonRecord = Record<string, unknown>;
type EnvLike = Record<string, string | undefined>;

export type AiGraderProductionUploadResult = {
  storageKey: string;
  publicUrl: string;
};

export type AiGraderCardItemSearchResult = AiGraderCardItemSelection & {
  displayTitle: string;
  subtitle?: string | null;
};

export type AiGraderSlabbedPhotoUploadResult = {
  reportId: string;
  side: AiGraderSlabbedPhotoSide;
  storageKey: string;
  publicUrl: string;
  byteSize: number;
  checksumSha256: string;
  persisted: boolean;
};

export type AiGraderCompsRunResult = {
  status: AiGraderValuationStatus;
  liveExecutionEnabled: boolean;
  searchQuery?: string;
  searchUrl?: string;
  compsRefs: unknown[];
  resultSummary?: unknown;
  persisted: boolean;
  message?: string;
};

export type AiGraderProductionApiDependencies = {
  env?: EnvLike;
  requireAdminSession(req: NextApiRequest): Promise<AdminSession>;
  requireUserSession?(req: NextApiRequest): Promise<UserSession>;
  requireProductionActor?(
    req: NextApiRequest,
    action: AiGraderProductionAction,
    env: EnvLike
  ): Promise<AiGraderProductionActor>;
  publicUrlFor(storageKey: string): string;
  uploadArtifact(input: {
    storageKey: string;
    body: string;
    bodyEncoding?: "utf8" | "base64";
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
    actorAudit?: AiGraderProductionActorAudit | null;
  }): Promise<AiGraderProductionPersistResult>;
  listHistory?(): Promise<AiGraderProductionHistoryResult>;
  searchCards?(input: {
    query: string;
    limit: number;
    admin?: AdminSession | null;
    actor: AiGraderProductionActor;
  }): Promise<AiGraderCardItemSearchResult[]>;
  uploadSlabbedPhoto?(input: {
    tenantId: string;
    reportId: string;
    side: AiGraderSlabbedPhotoSide;
    fileName: string;
    mimeType: string;
    body: Buffer;
    operatorUserId?: string | null;
    actorAudit?: AiGraderProductionActorAudit | null;
  }): Promise<AiGraderSlabbedPhotoUploadResult>;
  runComps?(input: {
    reportId: string;
    searchQuery: string;
    reportBundle: AiGraderProductionReportBundleLike;
    productionRelease: AiGraderProductionReleaseLike;
    limit: number;
    admin?: AdminSession | null;
    actor: AiGraderProductionActor;
  }): Promise<Omit<AiGraderCompsRunResult, "status" | "liveExecutionEnabled" | "persisted">>;
  persistComps?(input: {
    tenantId: string;
    reportId: string;
    status: AiGraderValuationStatus;
    searchQuery?: string | null;
    compsRefs?: unknown;
    resultSummary?: unknown;
    requestedByUserId?: string | null;
    actorAudit?: AiGraderProductionActorAudit | null;
  }): Promise<unknown>;
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

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function numericValue(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function errorStatus(error: unknown, fallback = 400) {
  if (isRecord(error) && typeof error.statusCode === "number" && Number.isFinite(error.statusCode)) {
    return Math.max(400, Math.min(599, Math.round(error.statusCode)));
  }
  return fallback;
}

function actorOperatorUserId(actor: AiGraderProductionActor) {
  return actor.type === "human_operator" ? actor.user.id : null;
}

function adminSessionForActor(actor: AiGraderProductionActor): AdminSession | null {
  if (actor.type !== "human_operator") return null;
  if (actor.adminSession) return actor.adminSession;
  return {
    sessionId: actor.sessionId,
    tokenHash: actor.tokenHash,
    user: {
      id: actor.user.id,
      phone: actor.user.phone,
      displayName: actor.user.displayName,
    },
  };
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

function parseCardSearchQuery(req: NextApiRequest) {
  const query = stringValue(Array.isArray(req.query.q) ? req.query.q[0] : req.query.q, "");
  const limit = Math.max(
    1,
    Math.min(25, Math.trunc(numericValue(Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit, 10)))
  );
  if (!query) throw new Error("q is required.");
  return { query, limit };
}

function parseDataUrlOrBase64(body: JsonRecord) {
  const raw = stringValue(body.dataUrl ?? body.base64, "");
  if (!raw) throw new Error("dataUrl or base64 is required.");
  const match = raw.match(/^data:([^;]+);base64,(.+)$/);
  const mimeType = match ? match[1] : optionalString(body.mimeType);
  const base64 = match ? match[2] : raw;
  if (!mimeType) throw new Error("mimeType is required.");
  if (!/^image\//i.test(mimeType)) throw new Error("Only image uploads are supported for slabbed photos.");
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length) throw new Error("Uploaded image body is empty.");
  return { buffer, mimeType };
}

function parseSlabbedPhotoBody(body: unknown) {
  if (!isRecord(body)) throw new Error("JSON object body is required.");
  const reportId = stringValue(body.reportId, "");
  const side = stringValue(body.side, "") as AiGraderSlabbedPhotoSide;
  const fileName = stringValue(body.fileName, `${side || "slabbed"}-photo.jpg`);
  if (!reportId) throw new Error("reportId is required.");
  if (side !== "front" && side !== "back") throw new Error("side must be front or back.");
  const parsed = parseDataUrlOrBase64(body);
  return {
    reportId,
    side,
    fileName,
    mimeType: parsed.mimeType,
    body: parsed.buffer,
  };
}

function parseCompsBody(body: unknown) {
  if (!isRecord(body)) throw new Error("JSON object body is required.");
  if (!isRecord(body.reportBundle)) throw new Error("reportBundle is required.");
  if (!isRecord(body.productionRelease)) throw new Error("productionRelease is required.");
  const reportBundle = body.reportBundle as AiGraderProductionReportBundleLike;
  const productionRelease = body.productionRelease as AiGraderProductionReleaseLike;
  const reportId = stringValue(body.reportId ?? productionRelease.reportId ?? reportBundle.reportId, "");
  if (!reportId) throw new Error("reportId is required.");
  const selection = isRecord(body.selection) ? (body.selection as AiGraderCardItemSelection) : null;
  const searchQuery =
    stringValue(body.searchQuery, "") ||
    buildAiGraderCompsSearchQuery({
      reportBundle,
      productionRelease,
      selection,
    });
  const limit = Math.max(1, Math.min(25, Math.trunc(numericValue(body.limit, 10))));
  return { reportId, reportBundle, productionRelease, searchQuery, limit };
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
      bodyEncoding: artifact.bodyEncoding,
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
        liveEbayCompsEnabled: isEnabled(env, AI_GRADER_EBAY_COMPS_ENABLED_ENV),
        actions: ["publish", "history", "card-search", "upload-slab-photo", "run-comps"],
        auth: aiGraderProductionAuthStatus(env),
        noHardwareControls: true,
      });
    }

    const allowedActions = ["publish", "history", "card-search", "upload-slab-photo", "run-comps"];
    if (!allowedActions.includes(key)) {
      return res.status(404).json({ ok: false, message: "AI Grader production API route not found" });
    }
    const allow = key === "history" || key === "card-search" ? "GET" : "POST";
    if (req.method !== allow) {
      res.setHeader("Allow", allow);
      return res.status(405).json({ ok: false, message: "Method not allowed" });
    }
    if (key !== "run-comps" && !isEnabled(env, AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV)) {
      return res.status(503).json({
        ok: false,
        enabled: false,
        code: "AI_GRADER_PRODUCTION_PUBLISH_DISABLED",
        message: "AI Grader production persistence/upload is disabled. Set AI_GRADER_PRODUCTION_PUBLISH_ENABLED=true after migrations and storage are approved.",
      });
    }

    try {
      const actor =
        deps.requireProductionActor?.(req, key as AiGraderProductionAction, env) ??
        requireAiGraderProductionActor(req, key as AiGraderProductionAction, {
          env,
          requireUserSession: deps.requireUserSession,
          requireAdminSession: deps.requireAdminSession,
        });
      const authorizedActor = await actor;
      const admin = adminSessionForActor(authorizedActor);
      if (key === "history") {
        const result = deps.listHistory ? await deps.listHistory() : { status: "not_implemented", items: [] };
        return res.status(200).json({ ok: true, enabled: true, operation: "aiGraderProductionHistory", result });
      }
      if (key === "card-search") {
        if (!deps.searchCards) throw new Error("AI Grader card/item search is not configured.");
        const query = parseCardSearchQuery(req);
        const results = await deps.searchCards({ ...query, admin, actor: authorizedActor });
        return res.status(200).json({
          ok: true,
          enabled: true,
          operation: "aiGraderCardItemSearch",
          result: {
            query: query.query,
            items: results,
            manualDraftAllowed: true,
          },
        });
      }
      if (key === "upload-slab-photo") {
        if (!deps.uploadSlabbedPhoto) throw new Error("AI Grader slabbed photo upload is not configured.");
        const input = parseSlabbedPhotoBody(req.body);
        const tenantId = env[AI_GRADER_PRODUCTION_TENANT_ID_ENV] ?? "ten-kings";
        const result = await deps.uploadSlabbedPhoto({
          tenantId,
          reportId: input.reportId,
          side: input.side,
          fileName: input.fileName,
          mimeType: input.mimeType,
          body: input.body,
          operatorUserId: actorOperatorUserId(authorizedActor),
          actorAudit: authorizedActor.audit,
        });
        return res.status(200).json({
          ok: true,
          enabled: true,
          operation: "aiGraderSlabbedPhotoUpload",
          result,
        });
      }
      if (key === "run-comps") {
        const input = parseCompsBody(req.body);
        const readiness = computeAiGraderValuationStatus({
          reportBundle: input.reportBundle,
          productionRelease: input.productionRelease,
        });
        if (readiness !== "ready") {
          return res.status(200).json({
            ok: true,
            enabled: true,
            operation: "aiGraderEbayComps",
            result: {
              status: readiness,
              liveExecutionEnabled: false,
              compsRefs: [],
              persisted: false,
              message:
                readiness === "not_ready_missing_grade"
                  ? "Final grade is required before comps execution."
                  : "Card identity is required before comps execution.",
            } satisfies AiGraderCompsRunResult,
          });
        }
        if (!input.searchQuery) {
          return res.status(200).json({
            ok: true,
            enabled: true,
            operation: "aiGraderEbayComps",
            result: {
              status: "not_ready_missing_identity",
              liveExecutionEnabled: false,
              compsRefs: [],
              persisted: false,
              message: "A searchable card identity is required before comps execution.",
            } satisfies AiGraderCompsRunResult,
          });
        }
        if (!isEnabled(env, AI_GRADER_EBAY_COMPS_ENABLED_ENV)) {
          return res.status(200).json({
            ok: true,
            enabled: true,
            operation: "aiGraderEbayComps",
            result: {
              status: "ready",
              liveExecutionEnabled: false,
              searchQuery: input.searchQuery,
              compsRefs: [],
              persisted: false,
              message: `Live eBay comps are ready but disabled. Set ${AI_GRADER_EBAY_COMPS_ENABLED_ENV}=true with SERPAPI_KEY and operator approval to execute.`,
            } satisfies AiGraderCompsRunResult,
          });
        }
        if (!deps.runComps) throw new Error("AI Grader eBay comps runner is not configured.");
        const comps = await deps.runComps({
          reportId: input.reportId,
          searchQuery: input.searchQuery,
          reportBundle: input.reportBundle,
          productionRelease: input.productionRelease,
          limit: input.limit,
          admin,
          actor: authorizedActor,
        });
        let persisted = false;
        if (deps.persistComps && isEnabled(env, AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV)) {
          const tenantId = env[AI_GRADER_PRODUCTION_TENANT_ID_ENV] ?? "ten-kings";
          await deps.persistComps({
            tenantId,
            reportId: input.reportId,
            status: "completed",
            searchQuery: input.searchQuery,
            compsRefs: comps.compsRefs,
            resultSummary: comps.resultSummary,
            requestedByUserId: actorOperatorUserId(authorizedActor),
            actorAudit: authorizedActor.audit,
          });
          persisted = true;
        }
        return res.status(200).json({
          ok: true,
          enabled: true,
          operation: "aiGraderEbayComps",
          result: {
            status: "completed",
            liveExecutionEnabled: true,
            searchQuery: input.searchQuery,
            searchUrl: comps.searchUrl,
            compsRefs: comps.compsRefs,
            resultSummary: comps.resultSummary,
            persisted,
            message: persisted
              ? "Comps completed and persisted."
              : "Comps completed; persistence skipped because production publish gate is disabled.",
          } satisfies AiGraderCompsRunResult,
        });
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
        operatorUserId: actorOperatorUserId(authorizedActor),
        cardAssetId: input.cardAssetId,
        itemId: input.itemId,
        actorAudit: authorizedActor.audit,
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
      return res.status(errorStatus(error)).json({
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
  actorAudit?: AiGraderProductionActorAudit | null;
}) {
  const { prisma } = await import("@tenkings/database");
  return persistAiGraderProductionRelease(prisma as any, input);
}

function safeStorageSegment(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "ai-grader"
  );
}

function sanitizeUploadFileName(value: string) {
  const fallback = "slabbed-photo.jpg";
  const cleaned = safeStorageSegment(value || fallback);
  return cleaned.includes(".") ? cleaned : `${cleaned}.jpg`;
}

function publicImageUrlFromCard(row: JsonRecord) {
  return optionalString(row.cdnThumbUrl) ?? optionalString(row.thumbnailUrl) ?? optionalString(row.cdnHdUrl) ?? optionalString(row.imageUrl) ?? null;
}

export async function searchAiGraderCardItemsRuntime(input: {
  query: string;
  limit: number;
  admin?: AdminSession | null;
  actor?: AiGraderProductionActor;
}): Promise<AiGraderCardItemSearchResult[]> {
  const { prisma } = await import("@tenkings/database");
  const db = prisma as any;
  const query = input.query.trim();
  const take = Math.max(1, Math.min(25, input.limit));
  const contains = { contains: query, mode: "insensitive" as const };
  const [cards, items] = await Promise.all([
    db.cardAsset?.findMany?.({
      where: {
        OR: [
          { customTitle: contains },
          { resolvedPlayerName: contains },
          { resolvedTeamName: contains },
          { fileName: contains },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take,
      select: {
        id: true,
        customTitle: true,
        resolvedPlayerName: true,
        resolvedTeamName: true,
        category: true,
        subCategory: true,
        imageUrl: true,
        thumbnailUrl: true,
        cdnHdUrl: true,
        cdnThumbUrl: true,
        classificationJson: true,
      },
    }) ?? [],
    db.item?.findMany?.({
      where: {
        OR: [{ name: contains }, { set: contains }, { number: contains }],
      },
      orderBy: { updatedAt: "desc" },
      take,
      select: {
        id: true,
        name: true,
        set: true,
        number: true,
        imageUrl: true,
        thumbnailUrl: true,
        cdnHdUrl: true,
        cdnThumbUrl: true,
        detailsJson: true,
      },
    }) ?? [],
  ]);
  const cardResults = (Array.isArray(cards) ? cards : []).map((row: JsonRecord) => {
    const title = optionalString(row.customTitle) ?? optionalString(row.resolvedPlayerName) ?? "Card asset";
    return {
      source: "card_asset" as const,
      cardAssetId: optionalString(row.id),
      title,
      category: optionalString(row.category) ?? optionalString(row.subCategory) ?? null,
      imageUrl: publicImageUrlFromCard(row),
      displayTitle: title,
      subtitle: [row.category, row.subCategory, row.resolvedTeamName].filter(Boolean).join(" / ") || "CardAsset",
      details: isRecord(row.classificationJson) ? row.classificationJson : undefined,
    };
  });
  const itemResults = (Array.isArray(items) ? items : []).map((row: JsonRecord) => {
    const title = optionalString(row.name) ?? "Inventory item";
    return {
      source: "item" as const,
      itemId: optionalString(row.id),
      title,
      set: optionalString(row.set) ?? null,
      cardNumber: optionalString(row.number) ?? null,
      imageUrl: publicImageUrlFromCard(row),
      displayTitle: title,
      subtitle: [row.set, row.number].filter(Boolean).join(" #") || "Item",
      details: isRecord(row.detailsJson) ? row.detailsJson : undefined,
    };
  });
  return [...cardResults, ...itemResults].slice(0, take);
}

export async function uploadAiGraderSlabbedPhotoRuntime(input: {
  tenantId: string;
  reportId: string;
  side: AiGraderSlabbedPhotoSide;
  fileName: string;
  mimeType: string;
  body: Buffer;
  operatorUserId?: string | null;
  actorAudit?: AiGraderProductionActorAudit | null;
}): Promise<AiGraderSlabbedPhotoUploadResult> {
  const { publicUrlFor, uploadBuffer } = await import("./storage");
  const reportSegment = safeStorageSegment(input.reportId);
  const fileName = sanitizeUploadFileName(input.fileName);
  const storageKey = `ai-grader/reports/${reportSegment}/slabbed/${input.side}-${Date.now()}-${fileName}`;
  const publicUrl = await uploadBuffer(storageKey, input.body, input.mimeType);
  const checksumSha256 = aiGraderSha256(input.body);
  const { prisma } = await import("@tenkings/database");
  await persistAiGraderSlabbedPhotoAsset(prisma as any, {
    tenantId: input.tenantId,
    reportId: input.reportId,
    side: input.side,
    storageKey,
    publicUrl: publicUrl || publicUrlFor(storageKey),
    mimeType: input.mimeType,
    byteSize: input.body.length,
    checksumSha256,
    operatorUserId: input.operatorUserId,
    actorAudit: input.actorAudit ?? null,
  });
  return {
    reportId: input.reportId,
    side: input.side,
    storageKey,
    publicUrl: publicUrl || publicUrlFor(storageKey),
    byteSize: input.body.length,
    checksumSha256,
    persisted: true,
  };
}

function parseCurrencyMinor(price: string | null | undefined) {
  if (!price) return null;
  const match = price.replace(/,/g, "").match(/([0-9]+(?:\.[0-9]{1,2})?)/);
  if (!match) return null;
  return Math.round(Number(match[1]) * 100);
}

export async function runAiGraderEbayCompsRuntime(input: {
  searchQuery: string;
  limit: number;
  admin?: AdminSession | null;
  actor?: AiGraderProductionActor;
}): Promise<Omit<AiGraderCompsRunResult, "status" | "liveExecutionEnabled" | "persisted">> {
  const { fetchKingsreviewEbaySoldCompPage } = await import("./kingsreviewEbayComps");
  const page = await fetchKingsreviewEbaySoldCompPage({
    query: input.searchQuery,
    limit: input.limit,
  });
  const compsRefs = page.comps.map((comp, index) => ({
    id: `ebay-sold-${index + 1}`,
    source: comp.source,
    title: comp.title,
    url: comp.url,
    price: comp.price,
    soldDate: comp.soldDate,
    matchScore: comp.matchScore ?? null,
    matchQuality: comp.matchQuality ?? null,
    listingImageUrl: comp.listingImageUrl ?? comp.thumbnail ?? null,
  }));
  const prices = page.comps.map((comp) => parseCurrencyMinor(comp.price)).filter((value): value is number => value != null);
  const valuationMinor = prices.length ? Math.round(prices.reduce((sum, value) => sum + value, 0) / prices.length) : null;
  return {
    searchQuery: input.searchQuery,
    searchUrl: page.searchUrl,
    compsRefs,
    resultSummary: {
      source: "ebay_sold",
      searchUrl: page.searchUrl,
      count: compsRefs.length,
      valuationMinor,
      valuationCurrency: "USD",
      comps: compsRefs,
    },
  };
}

export async function persistAiGraderCompsRuntime(input: {
  tenantId: string;
  reportId: string;
  status: AiGraderValuationStatus;
  searchQuery?: string | null;
  compsRefs?: unknown;
  resultSummary?: unknown;
  requestedByUserId?: string | null;
  actorAudit?: AiGraderProductionActorAudit | null;
}) {
  const { prisma } = await import("@tenkings/database");
  const resultSummary = isRecord(input.resultSummary) ? input.resultSummary : {};
  return persistAiGraderValuationResult(prisma as any, {
    tenantId: input.tenantId,
    reportId: input.reportId,
    status: input.status,
    source: "ebay_sold",
    searchQuery: input.searchQuery ?? null,
    compsRefs: input.compsRefs,
    resultSummary: input.resultSummary,
    valuationMinor: typeof resultSummary.valuationMinor === "number" ? resultSummary.valuationMinor : null,
    valuationCurrency: typeof resultSummary.valuationCurrency === "string" ? resultSummary.valuationCurrency : "USD",
    requestedByUserId: input.requestedByUserId ?? null,
    actorAudit: input.actorAudit ?? null,
    completedAt: input.status === "completed" ? new Date() : null,
  });
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
