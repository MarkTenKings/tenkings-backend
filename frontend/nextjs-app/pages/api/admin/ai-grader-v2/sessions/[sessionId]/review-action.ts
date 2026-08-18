import type { NextApiRequest, NextApiResponse } from "next";
import { Prisma } from "@prisma/client";
import { prisma } from "@tenkings/database";
import { z } from "zod";

import { requireAdminSession, toErrorResponse } from "../../../../../../lib/server/admin";
import { HttpError } from "../../../../../../lib/server/adminSessionAuthority";
import {
  applySpeedsterReviewAction,
  type SpeedsterReviewActionDependencies,
} from "../../../../../../lib/server/aiGraderV2ReviewAction";
import {
  boundedDuration,
  boundedWorkerIdentity,
  SPEEDSTER_DETECT_TRANSPORT_FIELD,
  SpeedsterDetectUpstreamError,
} from "../../../../../../lib/server/aiGraderV2DetectTransport";
import {
  findSpeedsterPersistedTrace,
  parseSpeedsterReviewFindings,
} from "../../../../../../lib/ai-grader-v2/review-findings";
import {
  encodeSpeedsterTraceBitmapWireV1,
} from "../../../../../../lib/ai-grader-v2/trace-bitmap-wire";
import { decodeSpeedsterTraceRleV1 } from "../../../../../../lib/ai-grader-v2/trace-codec";
import { presignReadUrl } from "../../../../../../lib/server/storage";
import {
  speedsterLearningBankForDetectRequest,
  type SpeedsterLearningDetectClient,
} from "../../../../../../lib/server/aiGraderV2LearningBank";
import { loadPinnedSpeedsterMapRevision } from "../../../../../../lib/server/speedsterCardTypeMaps";
import { hashSpeedsterMapStorageEvidence } from "../../../../../../lib/server/speedsterCardTypeMaps";
import {
  insertSpeedsterInstrumentationEvents,
  insertSpeedsterInstrumentationEventWithConflictDetection,
} from "../../../../../../lib/server/aiGraderV2Instrumentation";
import {
  parseSpeedsterDetectionSideCheckpoint,
  sealSpeedsterDetectionSideCheckpoint,
  speedsterDetectionSideCheckpointEvent,
} from "../../../../../../lib/server/speedsterDetectionSideCheckpoint";

const SESSION_ID = /^[a-z0-9-]{20,40}$/i;
const FINDING_ID = z.string().trim().min(1).max(180);
const SHA256 = z.string().regex(/^[a-f0-9]{64}$/);
const defectType = z.enum([
  "FAINT_COLOR_VARIATION",
  "VISIBLE_WHITENING",
  "FRAYING",
  "CHIPPING_EXPOSED_STOCK",
  "LIFTING_DEFORMATION",
  "LIGHT_SCRATCH_SCUFF",
  "VISIBLE_SCRATCH_PRINT_COATING_LOSS",
  "DENT_MATERIAL_DAMAGE",
  "PEELING_HEAVY_DAMAGE",
]);
const traceWire = z.object({
  format: z.literal("TK_SPEEDSTER_TRACE_BITMAP_WIRE_V1"),
  width: z.literal(1270),
  height: z.literal(1778),
  origin: z.literal("TOP_LEFT"),
  order: z.literal("ROW_MAJOR_Y_X"),
  bitOrder: z.literal("MSB_FIRST"),
  byteLength: z.literal(282258),
  dataBase64: z.string().length(376344),
  rleSha256: SHA256,
}).strict();
const traceProvenance = z.object({
  version: z.literal("speedster-trace-provenance-v1"),
  sourceViewId: z.string().trim().min(1).max(180),
  cropTransform: z.object({
    version: z.literal("speedster-canonical-crop-affine-v1"),
    crop: z.object({
      x: z.number().finite(),
      y: z.number().finite(),
      width: z.number().finite(),
      height: z.number().finite(),
    }).strict(),
  }).strict(),
  highlighterStrokes: z.array(z.object({
    canonicalPoints: z.array(z.object({
      x: z.number().int().min(0).max(1269),
      y: z.number().int().min(0).max(1777),
    }).strict()).min(1),
    strokeWidthMm: z.number().finite().positive(),
  }).strict()),
  finalTraceSha256: SHA256,
}).strict();
const traceEdit = z.object({ traceWire, traceProvenance }).strict();
const action = z.union([
  z.object({ type: z.literal("INITIALIZE") }).strict(),
  z.object({
    type: z.literal("TRACE_SAVE"),
    side: z.enum(["FRONT", "BACK"]),
    findingId: FINDING_ID,
    trace: traceEdit,
  }).strict(),
  z.object({
    type: z.literal("TRACE_SAVE"),
    side: z.enum(["FRONT", "BACK"]),
    findingId: z.null(),
    trace: traceEdit.extend({
      id: FINDING_ID,
      defectType,
      sourceViewId: z.string().trim().min(1).max(180),
    }).strict(),
  }).strict(),
  z.object({ type: z.literal("REMOVE"), defectIds: z.array(FINDING_ID).min(1) }).strict(),
  z.object({ type: z.literal("UNDO"), defectIds: z.array(FINDING_ID).min(1) }).strict(),
  z.object({ type: z.literal("CHANGE_TYPE"), defectId: FINDING_ID, defectType }).strict(),
]);
const postSchema = z.object({ action }).strict();

type HandlerDependencies = SpeedsterReviewActionDependencies & {
  requireAdminSession: typeof requireAdminSession;
  findOwnedTraces: (sessionId: string, createdByUserId: string) => Promise<{ reviewedDefects: unknown } | null>;
};

function serviceHeaders() {
  const apiKey = process.env.AI_GRADER_SPEEDSTER_SERVICE_API_KEY?.trim();
  return {
    "Content-Type": "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

type SpeedsterDetectBody = Parameters<SpeedsterReviewActionDependencies["detect"]>[0];
type SpeedsterDetectFetch = (
  input: string,
  init: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "headers" | "json">>;

function suppliedWorkerIdentity(
  headers: Pick<Headers, "get">,
  payload: unknown,
) {
  const headerIdentity = [
    "x-runpod-worker-id",
    "runpod-worker-id",
    "x-worker-id",
  ].map((name) => headers.get(name)).find((value) => value?.trim());
  if (headerIdentity) return boundedWorkerIdentity(headerIdentity);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return boundedWorkerIdentity(null);
  }
  const record = payload as Record<string, unknown>;
  const instrumentation = record.instrumentation;
  const supplied = record.workerId
    ?? record.worker_id
    ?? (instrumentation && typeof instrumentation === "object" && !Array.isArray(instrumentation)
      ? (instrumentation as Record<string, unknown>).workerId
        ?? (instrumentation as Record<string, unknown>).worker_id
      : null);
  return boundedWorkerIdentity(supplied);
}

export async function fetchSpeedsterDetectUpstream(
  body: SpeedsterDetectBody,
  options: {
    serviceUrl: string;
    headers: Record<string, string>;
    fetchImpl?: SpeedsterDetectFetch;
    now?: () => number;
    signal?: AbortSignal;
  },
) {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const response = await (options.fetchImpl ?? fetch)(`${options.serviceUrl.replace(/\/$/, "")}/detect`, {
    method: "POST",
    headers: options.headers,
    body: JSON.stringify(body),
    signal: options.signal,
  });
  const payload = await response.json().catch(() => ({}));
  const upstreamDurationMs = boundedDuration(now() - startedAt);
  const workerIdentity = suppliedWorkerIdentity(response.headers, payload);
  if (!response.ok) {
    throw new SpeedsterDetectUpstreamError({
      side: body.side,
      requestTraceId: body.requestTraceId,
      upstreamStatus: response.status,
      workerIdentity,
      upstreamDurationMs,
    });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  return {
    ...payload,
    [SPEEDSTER_DETECT_TRANSPORT_FIELD]: {
      upstreamStatus: response.status,
      workerIdentity,
      upstreamDurationMs,
    },
  };
}

function detectionReceiptAuthority(env: NodeJS.ProcessEnv = process.env) {
  const keyId = env.AI_GRADER_SPEEDSTER_DETECTION_RECEIPT_HMAC_KEY_ID?.trim() ?? "";
  const secret = env.AI_GRADER_SPEEDSTER_DETECTION_RECEIPT_HMAC_SECRET?.trim() ?? "";
  if (!keyId || keyId.length > 80 || secret.length < 32) {
    throw new Error("Speedster detection side receipt authority is not configured.");
  }
  return { keyId, secret };
}

export function assertSpeedsterDetectionRuntimeAuthority(env: NodeJS.ProcessEnv = process.env) {
  detectionReceiptAuthority(env);
  if (env.AI_GRADER_SPEEDSTER_REQUIRE_DETECTOR_IDENTITY_V1?.trim().toLowerCase() !== "true") {
    throw new Error("AI_GRADER_SPEEDSTER_REQUIRE_DETECTOR_IDENTITY_V1 must be explicitly true.");
  }
  const previousJson = env.AI_GRADER_SPEEDSTER_DETECTION_RECEIPT_PREVIOUS_KEYS_JSON?.trim();
  if (!previousJson) return;
  let previous: unknown;
  try {
    previous = JSON.parse(previousJson);
  } catch {
    throw new Error("Speedster detection previous receipt-key configuration is malformed.");
  }
  if (!previous || typeof previous !== "object" || Array.isArray(previous)
    || Object.entries(previous).some(([keyId, secret]) => !keyId.trim() || keyId.length > 80
      || typeof secret !== "string" || secret.trim().length < 32)) {
    throw new Error("Speedster detection previous receipt-key configuration is malformed.");
  }
}

function detectionReceiptSecret(keyId: string): string | null {
  const current = detectionReceiptAuthority();
  if (keyId === current.keyId) return current.secret;
  const previousJson = process.env.AI_GRADER_SPEEDSTER_DETECTION_RECEIPT_PREVIOUS_KEYS_JSON?.trim();
  if (!previousJson) return null;
  let previous: unknown;
  try {
    previous = JSON.parse(previousJson);
  } catch {
    throw new Error("Speedster detection previous receipt-key configuration is malformed.");
  }
  if (!previous || typeof previous !== "object" || Array.isArray(previous)) return null;
  const candidate = (previous as Record<string, unknown>)[keyId];
  return typeof candidate === "string" && candidate.trim().length >= 32 ? candidate.trim() : null;
}

const dependencies: HandlerDependencies = {
  assertDetectionRuntimeAuthority: assertSpeedsterDetectionRuntimeAuthority,
  requireAdminSession,
  findOwnedTraces: (sessionId, createdByUserId) => prisma.aiGraderV2Session.findFirst({
    where: { id: sessionId, createdByUserId },
    select: { reviewedDefects: true },
  }),
  presignRead: presignReadUrl,
  loadOwnedSession: (identity) => prisma.aiGraderV2Session.findFirst({
    where: { id: identity.sessionId, createdByUserId: identity.createdByUserId },
    select: {
      id: true,
      createdByUserId: true,
      cardProfile: true,
      workflowState: true,
      identity: true,
      capture: true,
      reviewedDefects: true,
      gradeReport: true,
      mapRevisionId: true,
      mapFilterPolicyVersion: true,
      mapRegistration: true,
      updatedAt: true,
    },
  }),
  async loadPinnedMapFilter(session) {
    return {
      revision: await loadPinnedSpeedsterMapRevision({
        sessionId: session.id,
        mapRevisionId: session.mapRevisionId,
      }),
      registration: session.mapRegistration,
    };
  },
  learningBankForDetect: () => speedsterLearningBankForDetectRequest(
    prisma as unknown as SpeedsterLearningDetectClient,
    (error) => console.error("[Speedster] SAM Memory catch-up failed before server detect:", error),
  ),
  hashDetectionEvidence: hashSpeedsterMapStorageEvidence,
  async loadDetectionSideCheckpoints(lookup) {
    const rows = await prisma.aiGraderV2InstrumentationEvent.findMany({
      where: {
        sessionId: lookup.sessionId,
        createdByUserId: lookup.createdByUserId,
        category: "DETECTOR_CHECKPOINT",
        eventType: "DETECTOR_SIDE_RESULT_PRESERVED",
      },
      orderBy: { createdAt: "asc" },
      select: { details: true },
    });
    const sides: Partial<Record<"FRONT" | "BACK", ReturnType<typeof parseSpeedsterDetectionSideCheckpoint>>> = {};
    for (const row of rows) {
      const checkpoint = parseSpeedsterDetectionSideCheckpoint(row.details, detectionReceiptSecret);
      if (
        checkpoint.sessionRevision !== lookup.sessionRevision
        || checkpoint.captureBindingSha256 !== lookup.captureBindingSha256
        || checkpoint.operationId !== lookup.operationId
      ) continue;
      if (sides[checkpoint.side]) {
        throw new HttpError(409, `Speedster ${checkpoint.side} detector checkpoint is duplicated.`);
      }
      sides[checkpoint.side] = checkpoint;
    }
    return sides;
  },
  async persistDetectionSideCheckpoint(unsigned) {
    const checkpoint = sealSpeedsterDetectionSideCheckpoint(unsigned, detectionReceiptAuthority());
    await insertSpeedsterInstrumentationEventWithConflictDetection(
      prisma,
      speedsterDetectionSideCheckpointEvent(checkpoint),
    );
    return checkpoint;
  },
  detectionDeadlineMs: (() => {
    const raw = Number(process.env.AI_GRADER_SPEEDSTER_DETECT_DEADLINE_MS ?? 55_000);
    return Number.isSafeInteger(raw) ? Math.max(1_000, Math.min(120_000, raw)) : 55_000;
  })(),
  requireDetectorIdentityV1: true,
  async detect(body, request) {
    const serviceUrl = process.env.AI_GRADER_SPEEDSTER_SERVICE_URL?.replace(/\/$/, "");
    if (!serviceUrl) throw new HttpError(503, "AI_GRADER_SPEEDSTER_SERVICE_URL is not configured");
    return fetchSpeedsterDetectUpstream(body, {
      serviceUrl,
      headers: serviceHeaders(),
      signal: request?.signal,
    });
  },
  async measure(body) {
    const serviceUrl = process.env.AI_GRADER_SPEEDSTER_SERVICE_URL?.replace(/\/$/, "");
    if (!serviceUrl) throw new HttpError(503, "AI_GRADER_SPEEDSTER_SERVICE_URL is not configured");
    const response = await fetch(`${serviceUrl}/measure`, {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload && typeof payload === "object" && "detail" in payload
        ? JSON.stringify(payload.detail)
        : "Speedster measurement service failed.";
      throw new HttpError(response.status >= 500 ? 502 : 400, message);
    }
    return payload as { defects: unknown };
  },
  recordInstrumentation: (events) => insertSpeedsterInstrumentationEvents(prisma, events),
  persistReviewIfRevision: (identity, expectedUpdatedAt, data) => prisma.$transaction(async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "AiGraderV2Session" WHERE "id" = ${identity.sessionId} AND "createdByUserId" = ${identity.createdByUserId} FOR UPDATE`,
    );
    const current = await tx.aiGraderV2Session.findFirst({
      where: { id: identity.sessionId, createdByUserId: identity.createdByUserId },
      select: {
        workflowState: true,
        updatedAt: true,
        mapRevisionId: true,
        mapFilterPolicyVersion: true,
      },
    });
    if (
      !current || current.workflowState !== "CAPTURED" ||
      current.updatedAt.getTime() !== expectedUpdatedAt.getTime()
    ) {
      throw new HttpError(409, "Speedster review state changed before it could be saved");
    }
    if (data.filterDecisions) {
      if (
        !current.mapRevisionId
        || data.filterDecisions.some((decision) =>
          decision.mapRevisionId !== current.mapRevisionId
          || decision.filterPolicyVersion !== current.mapFilterPolicyVersion)
      ) {
        throw new HttpError(409, "Speedster pinned map state changed before filter decisions could be saved");
      }
    }
    if (data.detectorEvidenceEvents?.length) {
      const inserted = await insertSpeedsterInstrumentationEvents(tx, data.detectorEvidenceEvents);
      if (inserted !== data.detectorEvidenceEvents.length) {
        throw new HttpError(409, "Speedster detector evidence was not preserved exactly");
      }
    }
    if (data.detectionPair) {
      const eventKeys = (["FRONT", "BACK"] as const).map((side) => (
        `${identity.sessionId}:detection-side:${data.detectionPair!.operationId}:${side}`
      ));
      const rows = await tx.aiGraderV2InstrumentationEvent.findMany({
        where: { eventKey: { in: eventKeys } },
        select: { details: true },
      });
      if (rows.length !== 2) {
        throw new HttpError(409, "Speedster Front/Back detector checkpoints are incomplete.");
      }
      const checkpoints = rows.map((row) => (
        parseSpeedsterDetectionSideCheckpoint(row.details, detectionReceiptSecret)
      ));
      const front = checkpoints.find(({ side }) => side === "FRONT");
      const back = checkpoints.find(({ side }) => side === "BACK");
      if (
        !front || !back
        || front.sessionId !== identity.sessionId || back.sessionId !== identity.sessionId
        || front.createdByUserId !== identity.createdByUserId
        || back.createdByUserId !== identity.createdByUserId
        || front.sessionRevision !== expectedUpdatedAt.toISOString()
        || back.sessionRevision !== expectedUpdatedAt.toISOString()
        || front.captureBindingSha256 !== data.detectionPair.captureBindingSha256
        || back.captureBindingSha256 !== data.detectionPair.captureBindingSha256
        || front.memorySnapshotSha256 !== data.detectionPair.memorySnapshotSha256
        || back.memorySnapshotSha256 !== data.detectionPair.memorySnapshotSha256
        || front.detectorVersion !== back.detectorVersion
        || front.detectorIdentitySha256 !== back.detectorIdentitySha256
        || front.receipt.hmacSha256 !== data.detectionPair.frontReceiptHmacSha256
        || back.receipt.hmacSha256 !== data.detectionPair.backReceiptHmacSha256
      ) {
        throw new HttpError(409, "Speedster Front/Back detector checkpoints are incompatible.");
      }
    }
    const updated = await tx.aiGraderV2Session.updateMany({
      where: {
        id: identity.sessionId,
        createdByUserId: identity.createdByUserId,
        workflowState: "CAPTURED",
        updatedAt: expectedUpdatedAt,
      },
      data: {
        reviewedDefects: data.reviewedDefects as Prisma.InputJsonValue,
        gradeReport: data.gradeReport as Prisma.InputJsonValue,
      },
    });
    if (updated.count !== 1) {
      throw new HttpError(409, "Speedster review state changed before it could be saved");
    }
    if (data.filterDecisions?.length) {
      await tx.aiGraderV2MapFilterDecision.createMany({
        data: data.filterDecisions.map((decision) => ({
          sessionId: identity.sessionId,
          findingId: decision.finding.id,
          side: decision.finding.side,
          originalOrigin: decision.ruleInputs.findingOrigin,
          proposedDefectType: decision.finding.defectType,
          confidence: decision.finding.confidence,
          similarity: decision.finding.memoryProposal?.similarity ?? null,
          generatingExemplar: decision.finding.memoryProposal
            ? decision.finding.memoryProposal as Prisma.InputJsonValue
            : Prisma.JsonNull,
          sourceViewId: decision.finding.sourceViewId,
          supportingViewIds: decision.finding.supportingViewIds as Prisma.InputJsonValue,
          cardIdentity: decision.cardIdentity as Prisma.InputJsonValue,
          findingSnapshot: decision.finding as Prisma.InputJsonValue,
          mapId: decision.mapId,
          mapRevisionId: decision.mapRevisionId,
          zoneId: decision.zoneId,
          zoneType: decision.zoneType,
          zoneOverlap: decision.zoneOverlap as Prisma.InputJsonValue,
          filterPolicyVersion: decision.filterPolicyVersion,
          ruleId: decision.ruleId,
          ruleInputs: decision.ruleInputs as Prisma.InputJsonValue,
          detectorVersion: decision.detectorVersion,
        })),
      });
    }
  }, { isolationLevel: "Serializable" }),
};

const sessionIdFrom = (req: NextApiRequest) => {
  const value = Array.isArray(req.query.sessionId) ? req.query.sessionId[0] : req.query.sessionId;
  return typeof value === "string" && SESSION_ID.test(value) ? value : null;
};

export function createSpeedsterReviewActionHandler(deps: HandlerDependencies = dependencies) {
  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "POST" && req.method !== "GET") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ message: "Method not allowed" });
    }
    res.setHeader("Cache-Control", "private, no-store");
    try {
      const admin = await deps.requireAdminSession(req);
      const sessionId = sessionIdFrom(req);
      if (!sessionId) return res.status(400).json({ message: "Invalid Speedster session ID" });

      if (req.method === "GET") {
        const findingId = Array.isArray(req.query.findingId) ? req.query.findingId[0] : req.query.findingId;
        if (typeof findingId !== "string" || !findingId.trim()) {
          return res.status(400).json({ message: "Speedster finding ID is required" });
        }
        const row = await deps.findOwnedTraces(sessionId, admin.user.id);
        if (!row) return res.status(404).json({ message: "Speedster session not found" });
        const trace = findSpeedsterPersistedTrace(parseSpeedsterReviewFindings(row.reviewedDefects), findingId.trim());
        if (!trace) return res.status(404).json({ message: "Speedster trace not found" });
        return res.status(200).json({
          traceWire: encodeSpeedsterTraceBitmapWireV1(decodeSpeedsterTraceRleV1(trace), trace.sha256),
        });
      }

      const parsed = postSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ message: "Invalid Speedster review action" });
      const result = await applySpeedsterReviewAction({
        sessionId,
        createdByUserId: admin.user.id,
        action: parsed.data.action,
      }, deps);
      return res.status(200).json(result);
    } catch (error) {
      const mapped = toErrorResponse(error);
      return res.status(mapped.status).json({ message: mapped.message });
    }
  };
}

export default createSpeedsterReviewActionHandler();
