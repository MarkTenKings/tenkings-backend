import { Prisma, type PrismaClient } from "@prisma/client";
import { HttpError } from "./adminSessionAuthority";
import type { SpeedsterReviewActionDependencies } from "./aiGraderV2ReviewAction";
import { boundedDuration, boundedWorkerIdentity, SPEEDSTER_DETECT_TRANSPORT_FIELD, speedsterDetectFailureEvidence, SpeedsterDetectUpstreamError } from "./aiGraderV2DetectTransport";
import { presignReadUrl, type openStorageObjectRead } from "./storage";
import { speedsterLearningBankForDetectRequest, type SpeedsterLearningDetectClient } from "./aiGraderV2LearningBank";
import { loadPinnedSpeedsterMapRevision, hashSpeedsterMapStorageEvidence, type SpeedsterMapLookupDependencies } from "./speedsterCardTypeMaps";
import { insertSpeedsterInstrumentationEvents, insertSpeedsterInstrumentationEventWithConflictDetection } from "./aiGraderV2Instrumentation";
import { parseSpeedsterDetectionSideCheckpoint, sealSpeedsterDetectionSideCheckpoint, speedsterDetectionSideCheckpointEvent } from "./speedsterDetectionSideCheckpoint";

type CommitArguments = Parameters<SpeedsterReviewActionDependencies["persistReviewIfRevision"]>;
export type SpeedsterReviewDependencyOptions = {
  /** Capture one host configuration for the complete operation and its receipts. */
  env?: Readonly<NodeJS.ProcessEnv>;
  serviceUrl?: string;
  serviceHeaders?: Readonly<Record<string, string>>;
  presignReadUrl?: typeof presignReadUrl;
  openEvidence?: typeof openStorageObjectRead;
  mapLookup?: SpeedsterMapLookupDependencies;
  beforeSessionLock?: (tx: Prisma.TransactionClient, ...args: CommitArguments) => Promise<void>;
  afterPersist?: (tx: Prisma.TransactionClient, ...args: CommitArguments) => Promise<void>;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
};

function serviceHeaders(env: Readonly<NodeJS.ProcessEnv>) {
  const apiKey = env.AI_GRADER_SPEEDSTER_SERVICE_API_KEY?.trim();
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
    const failureEvidence = speedsterDetectFailureEvidence(payload, {
      side: body.side,
      requestTraceId: body.requestTraceId,
    });
    throw new SpeedsterDetectUpstreamError({
      side: body.side,
      requestTraceId: body.requestTraceId,
      upstreamStatus: response.status,
      workerIdentity,
      upstreamDurationMs,
      failureEvidence,
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

function detectionReceiptAuthority(env: Readonly<NodeJS.ProcessEnv>) {
  const keyId = env.AI_GRADER_SPEEDSTER_DETECTION_RECEIPT_HMAC_KEY_ID?.trim() ?? "";
  const secret = env.AI_GRADER_SPEEDSTER_DETECTION_RECEIPT_HMAC_SECRET?.trim() ?? "";
  if (!keyId || keyId.length > 80 || secret.length < 32) {
    throw new Error("Speedster detection side receipt authority is not configured.");
  }
  return { keyId, secret };
}

export function assertSpeedsterDetectionRuntimeAuthority(env: Readonly<NodeJS.ProcessEnv> = process.env) {
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

function detectionReceiptSecret(keyId: string, env: Readonly<NodeJS.ProcessEnv>): string | null {
  const current = detectionReceiptAuthority(env);
  if (keyId === current.keyId) return current.secret;
  const previousJson = env.AI_GRADER_SPEEDSTER_DETECTION_RECEIPT_PREVIOUS_KEYS_JSON?.trim();
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


/** Server effects only. Callers supply their authenticated scope and client.
 * The existing review service still owns all worker/map/Memory/checkpoint checks.
 * Hooks run inside the same serializable review transaction, never around it. */
export function createSpeedsterReviewDependencies(prisma: PrismaClient, options: SpeedsterReviewDependencyOptions = {}): SpeedsterReviewActionDependencies {
  options = { ...options };
  const env = Object.freeze({ ...(options.env ?? process.env) });
  const serviceUrl = (options.serviceUrl ?? env.AI_GRADER_SPEEDSTER_SERVICE_URL)?.replace(/\/$/, "");
  const headers = Object.freeze(options.serviceHeaders
    ? { "Content-Type": "application/json", ...options.serviceHeaders }
    : serviceHeaders(env));
  const receiptSecret = (keyId: string) => detectionReceiptSecret(keyId, env);
  // A scoped caller supplies the same original parser with its own database
  // reads. Legacy callers retain the established default lookup and storage.
  const mapLookup = options.mapLookup ? { ...options.mapLookup } : undefined;
  return {
  assertDetectionRuntimeAuthority: () => assertSpeedsterDetectionRuntimeAuthority(env),
  presignRead: options.presignReadUrl ?? presignReadUrl,
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
      }, mapLookup),
      registration: session.mapRegistration,
    };
  },
  learningBankForDetect: () => speedsterLearningBankForDetectRequest(
    prisma as unknown as SpeedsterLearningDetectClient,
    (error) => console.error("[Speedster] SAM Memory catch-up failed before server detect:", error),
  ),
  hashDetectionEvidence: storageKey => hashSpeedsterMapStorageEvidence(storageKey, options.openEvidence),
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
      const checkpoint = parseSpeedsterDetectionSideCheckpoint(row.details, receiptSecret);
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
    const checkpoint = sealSpeedsterDetectionSideCheckpoint(unsigned, detectionReceiptAuthority(env));
    await insertSpeedsterInstrumentationEventWithConflictDetection(
      prisma,
      speedsterDetectionSideCheckpointEvent(checkpoint),
    );
    return checkpoint;
  },
  detectionDeadlineMs: (() => {
    const raw = Number(env.AI_GRADER_SPEEDSTER_DETECT_DEADLINE_MS ?? 55_000);
    return Number.isSafeInteger(raw) ? Math.max(1_000, Math.min(120_000, raw)) : 55_000;
  })(),
  async detect(body, request) {
    if (!serviceUrl) throw new HttpError(503, "AI_GRADER_SPEEDSTER_SERVICE_URL is not configured");
    return fetchSpeedsterDetectUpstream(body, {
      serviceUrl,
      headers,
      signal: options.signal && request?.signal ? AbortSignal.any([options.signal, request.signal]) : request?.signal ?? options.signal,
      fetchImpl: options.fetchImpl,
    });
  },
  async measure(body) {
    if (!serviceUrl) throw new HttpError(503, "AI_GRADER_SPEEDSTER_SERVICE_URL is not configured");
    const response = await (options.fetchImpl ?? fetch)(`${serviceUrl}/measure`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: options.signal,
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
    await options.beforeSessionLock?.(tx, identity, expectedUpdatedAt, data);
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
        parseSpeedsterDetectionSideCheckpoint(row.details, receiptSecret)
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
    if (options.afterPersist) {
      await options.afterPersist(tx, identity, expectedUpdatedAt, data);
      // Surface deferred ATLAS head/operation errors before returning success.
      await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
    }
  }, { isolationLevel: "Serializable" }),
  };
}
