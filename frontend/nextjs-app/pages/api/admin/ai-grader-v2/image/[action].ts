import type { NextApiRequest, NextApiResponse } from "next";
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

const ACTIONS = new Set(["geometry", "prepare", "trace-proposal"]);

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
};

const traceEvidenceDependencies: TraceEvidenceDependencies = {
  findOwnedCapture: (sessionId, createdByUserId) => prisma.aiGraderV2Session.findFirst({
    where: { id: sessionId, createdByUserId },
    select: { capture: true, reviewedDefects: true },
  }),
  presignRead: presignReadUrl,
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

export async function speedsterServiceBody(
  action: string,
  body: Record<string, unknown>,
  createdByUserId?: string,
  evidenceDeps: TraceEvidenceDependencies = traceEvidenceDependencies,
) {
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
    };
  }
  return body;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const admin = await requireAdminSession(req);
    const action = Array.isArray(req.query.action) ? req.query.action[0] : req.query.action;
    if (!action || !ACTIONS.has(action)) {
      return res.status(404).json({ message: "Unknown Speedster image action" });
    }

    const serviceUrl = process.env.AI_GRADER_SPEEDSTER_SERVICE_URL?.replace(/\/$/, "");
    if (!serviceUrl) throw new Error("AI_GRADER_SPEEDSTER_SERVICE_URL is not configured");

    const response = await fetch(`${serviceUrl}/${action}`, {
      method: "POST",
      headers: speedsterServiceHeaders(),
      body: JSON.stringify(await speedsterServiceBody(action, req.body ?? {}, admin.user.id)),
    });
    const payload = await response.json();
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
        : payload;
    return res.status(response.status).json(safePayload);
  } catch (error) {
    const mapped = toErrorResponse(error);
    return res.status(mapped.status).json({ message: mapped.message });
  }
}
