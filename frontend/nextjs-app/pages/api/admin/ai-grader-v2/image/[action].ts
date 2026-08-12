import type { NextApiRequest, NextApiResponse } from "next";
import { randomUUID } from "node:crypto";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import { presignReadUrl } from "../../../../../lib/server/storage";
import { sanitizeSpeedsterUnitQuad } from "../../../../../lib/ai-grader-v2/geometry";
import {
  parseSpeedsterReviewFindings,
  stripSpeedsterFindingPrivateFields,
} from "../../../../../lib/ai-grader-v2/review-findings";
import {
  decodeSpeedsterTraceBitmapWireV1,
  encodeSpeedsterTraceBitmapWireV1,
} from "../../../../../lib/ai-grader-v2/trace-bitmap-wire";
import {
  decodeSpeedsterTraceRleV1,
  encodeSpeedsterTraceRleV1,
  parseSpeedsterTraceRleV1,
} from "../../../../../lib/ai-grader-v2/trace-codec";
import { SPEEDSTER_REVIEW_VIEW_TYPES } from "../../../../../lib/ai-grader-v2/review-image-urls";
import {
  hashSpeedsterMapStorageEvidence,
  loadEffectiveActiveSpeedsterMapRevision,
  parseSpeedsterMapRegistration,
  speedsterPhysicalQuadHash,
} from "../../../../../lib/server/speedsterCardTypeMaps";
import { canonicalizeSpeedsterSessionIdentity } from "../../../../../lib/ai-grader-v2/identity";

const ACTIONS = new Set(["geometry", "prepare", "trace-proposal", "map-registration"]);
export const SPEEDSTER_IMAGE_UPSTREAM_TIMEOUT_MS = 55_000;

export class SpeedsterImageUpstreamTimeoutError extends Error {
  constructor(readonly action: string, readonly timeoutMs: number) {
    super(`Speedster ${action} upstream timed out after ${timeoutMs}ms.`);
    this.name = "SpeedsterImageUpstreamTimeoutError";
  }
}

export async function fetchSpeedsterImageUpstream(input: Readonly<{
  url: string;
  action: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}>): Promise<{ response: Response; payload: unknown }> {
  const timeoutMs = input.timeoutMs ?? SPEEDSTER_IMAGE_UPSTREAM_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  let rejectDeadline: ((reason: Error) => void) | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject;
  });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
    rejectDeadline?.(new SpeedsterImageUpstreamTimeoutError(input.action, timeoutMs));
  }, timeoutMs);
  try {
    return await Promise.race([
      (async () => {
        const response = await (input.fetchImpl ?? fetch)(input.url, {
          method: "POST",
          headers: input.headers,
          body: input.body,
          signal: controller.signal,
        });
        let payload: unknown;
        try {
          payload = await response.json();
        } catch (error) {
          if (controller.signal.aborted) throw error;
          payload = {};
        }
        return { response, payload };
      })(),
      deadline,
    ]);
  } catch (error) {
    if (timedOut) throw new SpeedsterImageUpstreamTimeoutError(input.action, timeoutMs);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function speedsterServiceHeaders() {
  const apiKey = process.env.AI_GRADER_SPEEDSTER_SERVICE_API_KEY?.trim();
  return {
    "Content-Type": "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

type TraceEvidenceDependencies = {
  findOwnedCapture: (
    sessionId: string,
    createdByUserId: string,
  ) => Promise<{ capture: unknown; reviewedDefects?: unknown } | null>;
  presignRead: (storageKey: string, expiresInSeconds: number) => Promise<string>;
  findOwnedMapSession?: (
    sessionId: string,
    createdByUserId: string,
  ) => Promise<{
    id: string;
    createdByUserId: string;
    cardProfile: string;
    workflowState: string;
    identity: unknown;
  } | null>;
  loadActiveMap?: typeof loadEffectiveActiveSpeedsterMapRevision;
  hashMapEvidence?: typeof hashSpeedsterMapStorageEvidence;
};

const traceEvidenceDependencies: TraceEvidenceDependencies = {
  findOwnedCapture: (sessionId, createdByUserId) => prisma.aiGraderV2Session.findFirst({
    where: { id: sessionId, createdByUserId },
    select: { capture: true, reviewedDefects: true },
  }),
  presignRead: presignReadUrl,
  findOwnedMapSession: (sessionId, createdByUserId) => prisma.aiGraderV2Session.findFirst({
    where: { id: sessionId, createdByUserId },
    select: {
      id: true,
      createdByUserId: true,
      cardProfile: true,
      workflowState: true,
      identity: true,
    },
  }),
  loadActiveMap: loadEffectiveActiveSpeedsterMapRevision,
  hashMapEvidence: hashSpeedsterMapStorageEvidence,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function sanitizeSpeedsterGeometryPayload(payload: unknown): unknown {
  if (!isRecord(payload)) return payload;
  return {
    ...payload,
    corners: sanitizeSpeedsterUnitQuad(payload.corners),
  };
}

function sanitizedUpstreamText(value: unknown, maximumLength: number) {
  if (typeof value !== "string") return undefined;
  const sanitized = value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\b(?:sk|sess|proj)-[A-Za-z0-9_-]{8,}\b/gi, "[redacted-credential]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted-credential]")
    .replace(/data:image\/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/=_-]+/gi, "[redacted-image]")
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximumLength);
  return sanitized || undefined;
}

export function sanitizeSpeedsterTraceProposalFailure(
  payload: unknown,
  requestId: string,
) {
  const fields = isRecord(payload) ? payload : {};
  const detail = isRecord(fields.detail) ? fields.detail : null;
  const upstream = sanitizedUpstreamText(
    detail?.message ?? fields.detail ?? fields.message,
    300,
  )?.replace(/[.]+$/, "");
  return {
    message: `SAM proposal failed: ${upstream ?? "upstream service error"} (request ${requestId}).`,
    requestId,
  };
}

export function sanitizeSpeedsterImageFailure(
  payload: unknown,
  action: string,
  requestId: string,
) {
  const fields = isRecord(payload) ? payload : {};
  const detail = isRecord(fields.detail) ? fields.detail : null;
  const upstream = sanitizedUpstreamText(
    detail?.message ?? fields.detail ?? fields.message,
    300,
  )?.replace(/[.]+$/, "");
  return {
    message: `Speedster ${action} failed: ${upstream ?? "upstream service error"} (request ${requestId}).`,
    requestId,
  };
}

export async function speedsterServiceBody(
  action: string,
  body: Record<string, unknown>,
  createdByUserId?: string,
  evidenceDeps: TraceEvidenceDependencies = traceEvidenceDependencies,
  requestTraceId?: string,
) {
  if (action === "map-registration" && createdByUserId) {
    const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    const side = body.side === "FRONT" || body.side === "BACK" ? body.side : null;
    const rawQuad = body.currentPhysicalQuad;
    const currentPhysicalQuad = sanitizeSpeedsterUnitQuad(rawQuad);
    if (!sessionId || !side || !currentPhysicalQuad || JSON.stringify(currentPhysicalQuad) !== JSON.stringify(rawQuad)) {
      throw new Error("Speedster map registration request is invalid.");
    }
    const findOwnedMapSession = evidenceDeps.findOwnedMapSession ?? traceEvidenceDependencies.findOwnedMapSession;
    const loadActiveMap = evidenceDeps.loadActiveMap ?? traceEvidenceDependencies.loadActiveMap;
    const hashMapEvidence = evidenceDeps.hashMapEvidence ?? traceEvidenceDependencies.hashMapEvidence;
    if (!findOwnedMapSession || !loadActiveMap || !hashMapEvidence) {
      throw new Error("Speedster map registration dependencies are unavailable.");
    }
    const session = await findOwnedMapSession(sessionId, createdByUserId);
    if (!session || (session.workflowState !== "DRAFT" && session.workflowState !== "CAPTURED")) {
      throw new Error("Speedster map registration session was not found.");
    }
    if (session.cardProfile !== "SPORTS" && session.cardProfile !== "POKEMON") {
      throw new Error("Speedster map registration category is unsupported.");
    }
    const identity = canonicalizeSpeedsterSessionIdentity(session.cardProfile, session.identity);
    const selectedMap = await loadActiveMap({ cardProfile: session.cardProfile, identity });
    if (!selectedMap) throw new Error("No active CARD MAP exists for this card identity.");
    const revision = selectedMap.revision;
    const mapSide = side === "FRONT" ? revision.frontMap : revision.backMap;
    if (mapSide.side !== side) throw new Error("Active TRAIN map side is incoherent.");
    const currentStorageKey = `ai-grader-v2/${createdByUserId}/${sessionId}/prepared/${side.toLowerCase()}/inspection.webp`;
    const [referenceSha256, currentInspectionSha256] = await Promise.all([
      hashMapEvidence(mapSide.referenceInspection.storageKey),
      hashMapEvidence(currentStorageKey),
    ]);
    if (referenceSha256 !== mapSide.referenceInspection.sha256) {
      throw new Error("Active TRAIN map reference evidence failed hash verification.");
    }
    return {
      referenceImage: {
        imageUrl: await evidenceDeps.presignRead(mapSide.referenceInspection.storageKey, 60 * 10),
      },
      currentImage: {
        imageUrl: await evidenceDeps.presignRead(currentStorageKey, 60 * 10),
      },
      mapId: revision.mapId,
      mapRevisionId: revision.revisionId,
      side,
      currentPhysicalQuadSha256: speedsterPhysicalQuadHash(currentPhysicalQuad),
      currentInspectionSha256,
      anchors: mapSide.anchors.map(({ id, point }) => ({ id, point })),
      designBoundary: mapSide.designBoundary,
      zones: mapSide.zones,
    };
  }
  if (action === "trace-proposal" && createdByUserId) {
    const { sessionId, currentTraceWire, ...proposal } = body;
    if (typeof sessionId !== "string" || !sessionId.trim()) {
      throw new Error("Speedster trace proposal requires an owned session.");
    }
    const side = proposal.side === "FRONT" || proposal.side === "BACK" ? proposal.side : null;
    if (!side) throw new Error("Speedster trace proposal side is invalid.");
    const owned = await evidenceDeps.findOwnedCapture(sessionId.trim(), createdByUserId);
    if (!owned) throw new Error("Speedster trace proposal session was not found.");
    const capture = isRecord(owned.capture) ? owned.capture : null;
    const cornerShape = capture?.cornerShape === "SQUARE" || capture?.cornerShape === "ROUNDED_3_18_MM"
      ? capture.cornerShape
      : null;
    const persistedSide = capture && isRecord(capture[side.toLowerCase()])
      ? capture[side.toLowerCase()] as Record<string, unknown>
      : null;
    const reviewedDefects = parseSpeedsterReviewFindings(owned.reviewedDefects ?? []);
    const findingId = proposal.findingId === null
      ? null
      : typeof proposal.findingId === "string" && proposal.findingId.trim()
        ? proposal.findingId.trim()
        : undefined;
    if (findingId === undefined) throw new Error("Speedster trace proposal finding ID is invalid.");
    const target = findingId === null
      ? null
      : reviewedDefects.find((finding) => finding.id === findingId);
    if (findingId !== null && (!target || target.side !== side || target.reviewResult === "REMOVED")) {
      throw new Error("Speedster trace proposal finding is not active on this side.");
    }
    const sourceViewId = target?.sourceViewId ?? `${side}:ORIGINAL`;
    const view = sourceViewId.startsWith(`${side}:`)
      ? sourceViewId.slice(side.length + 1)
      : null;
    if (!SPEEDSTER_REVIEW_VIEW_TYPES.includes(view as typeof SPEEDSTER_REVIEW_VIEW_TYPES[number])) {
      throw new Error("Speedster trace proposal source view is invalid.");
    }
    const prefix = `ai-grader-v2/${createdByUserId}/${sessionId.trim()}/prepared/${side.toLowerCase()}`;
    const expectedKeys = {
      ORIGINAL: `${prefix}/inspection.webp`,
      NORMALIZED: `${prefix}/normalized.webp`,
      MICRO_DEFECT: `${prefix}/micro_defect.webp`,
      DIRECTIONAL: `${prefix}/directional.webp`,
    } as const;
    const persistedViewKeys = isRecord(persistedSide?.viewStorageKeys) ? persistedSide.viewStorageKeys : null;
    const persistedKeys = {
      ORIGINAL: persistedSide?.inspectionStorageKey,
      NORMALIZED: persistedViewKeys?.NORMALIZED,
      MICRO_DEFECT: persistedViewKeys?.MICRO_DEFECT,
      DIRECTIONAL: persistedViewKeys?.DIRECTIONAL,
    };
    if (
      SPEEDSTER_REVIEW_VIEW_TYPES.some((candidate) => persistedKeys[candidate] !== expectedKeys[candidate]) ||
      !cornerShape || !isRecord(persistedSide?.inspectionFrame)
    ) {
      throw new Error("Speedster trace proposal evidence is not owned by this session.");
    }
    const expectedStorageKey = expectedKeys[view as keyof typeof expectedKeys];
    const currentTrace = currentTraceWire === null || currentTraceWire === undefined
      ? null
      : encodeSpeedsterTraceRleV1(decodeSpeedsterTraceBitmapWireV1(currentTraceWire));
    return {
      side,
      cornerShape,
      evidenceView: {
        id: sourceViewId,
        imageUrl: await evidenceDeps.presignRead(expectedStorageKey, 60 * 10),
        inspectionFrame: persistedSide.inspectionFrame,
      },
      findingId,
      sourceViewId,
      stroke: proposal.stroke,
      currentTrace,
      findings: reviewedDefects
        .filter((finding) => finding.side === side && finding.reviewResult !== "REMOVED" && finding.id !== findingId)
        .map(stripSpeedsterFindingPrivateFields),
      ...(requestTraceId ? { requestTraceId } : {}),
    };
  }
  return body;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  const requestTraceId = randomUUID();
  res.setHeader("X-Request-ID", requestTraceId);
  try {
    const admin = await requireAdminSession(req);
    const action = Array.isArray(req.query.action) ? req.query.action[0] : req.query.action;
    if (!action || !ACTIONS.has(action)) {
      return res.status(404).json({ message: "Unknown Speedster image action" });
    }

    const serviceUrl = process.env.AI_GRADER_SPEEDSTER_SERVICE_URL?.replace(/\/$/, "");
    if (!serviceUrl) throw new Error("AI_GRADER_SPEEDSTER_SERVICE_URL is not configured");

    const serviceRequestBody = await speedsterServiceBody(
      action,
      req.body ?? {},
      admin.user.id,
      traceEvidenceDependencies,
      action === "trace-proposal" ? requestTraceId : undefined,
    ) as Record<string, unknown>;
    const upstreamInput = {
      url: `${serviceUrl}/${action}`,
      headers: speedsterServiceHeaders(),
      body: JSON.stringify(serviceRequestBody),
    };
    const { response, payload } = action === "geometry"
      ? await fetchSpeedsterImageUpstream({ ...upstreamInput, action })
      : await (async () => {
          const response = await fetch(upstreamInput.url, {
            method: "POST",
            headers: upstreamInput.headers,
            body: upstreamInput.body,
          });
          return { response, payload: await response.json().catch(() => ({})) };
        })();
    if (action === "trace-proposal" && !response.ok) {
      return res.status(response.status).json(
        sanitizeSpeedsterTraceProposalFailure(payload, requestTraceId),
      );
    }
    if (!response.ok) {
      return res.status(response.status).json(
        sanitizeSpeedsterImageFailure(payload, action, requestTraceId),
      );
    }
    const safePayload = action === "geometry" && response.ok
      ? sanitizeSpeedsterGeometryPayload(payload)
      : action === "trace-proposal" && response.ok
        ? (() => {
            const trace = parseSpeedsterTraceRleV1(
              payload && typeof payload === "object" && "trace" in payload ? payload.trace : null,
            );
            return {
              traceWire: encodeSpeedsterTraceBitmapWireV1(
                decodeSpeedsterTraceRleV1(trace),
                trace.sha256,
              ),
            };
          })()
        : action === "map-registration" && response.ok
          ? parseSpeedsterMapRegistration(payload, {
              side: serviceRequestBody.side as "FRONT" | "BACK",
              mapRevisionId: serviceRequestBody.mapRevisionId as string,
              zones: serviceRequestBody.zones as Parameters<typeof parseSpeedsterMapRegistration>[1]["zones"],
            })
        : payload;
    return res.status(response.status).json(safePayload);
  } catch (error) {
    if (error instanceof SpeedsterImageUpstreamTimeoutError) {
      console.warn(JSON.stringify({
        event: "SPEEDSTER_IMAGE_UPSTREAM_TIMEOUT",
        action: error.action,
        timeoutMs: error.timeoutMs,
        requestId: requestTraceId,
      }));
      return res.status(504).json({
        message: `Speedster ${error.action} service did not respond in time. Your photos and current geometry are preserved; retry this step.`,
        requestId: requestTraceId,
      });
    }
    const mapped = toErrorResponse(error);
    return res.status(mapped.status).json({ message: mapped.message, requestId: requestTraceId });
  }
}
