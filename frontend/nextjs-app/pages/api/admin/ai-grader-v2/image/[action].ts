import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import {
  speedsterLearningBankForDetectRequest,
  type SpeedsterLearningDetectClient,
} from "../../../../../lib/server/aiGraderV2LearningBank";
import { presignReadUrl } from "../../../../../lib/server/storage";
import { sanitizeSpeedsterUnitQuad } from "../../../../../lib/ai-grader-v2/geometry";

const ACTIONS = new Set(["geometry", "prepare", "detect", "measure"]);

export function speedsterServiceHeaders() {
  const apiKey = process.env.AI_GRADER_SPEEDSTER_SERVICE_API_KEY?.trim();
  return {
    "Content-Type": "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

type MeasureEvidenceDependencies = {
  findOwnedCapture: (sessionId: string, createdByUserId: string) => Promise<{ capture: unknown } | null>;
  presignRead: (storageKey: string, expiresInSeconds: number) => Promise<string>;
};

type DetectLearningDependencies = {
  learningBankForDetect: () => Promise<unknown>;
};

const measureEvidenceDependencies: MeasureEvidenceDependencies = {
  findOwnedCapture: (sessionId, createdByUserId) => prisma.aiGraderV2Session.findFirst({
    where: { id: sessionId, createdByUserId },
    select: { capture: true },
  }),
  presignRead: presignReadUrl,
};

const detectLearningDependencies: DetectLearningDependencies = {
  learningBankForDetect: () => speedsterLearningBankForDetectRequest(
    prisma as unknown as SpeedsterLearningDetectClient,
    (error) => console.error("[Speedster] SAM Memory catch-up failed before detect:", error),
  ),
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function sanitizeSpeedsterGeometryPayload(payload: unknown): unknown {
  if (!isRecord(payload)) {
    throw new TypeError("Speedster geometry response was malformed.");
  }
  const corners = sanitizeSpeedsterUnitQuad(payload.corners);
  if (payload.corners !== null && corners === null) {
    throw new TypeError("Speedster geometry response was malformed.");
  }
  return {
    ...payload,
    corners,
  };
}

export async function freshSpeedsterMeasureEvidence(
  body: Record<string, unknown>,
  createdByUserId: string,
  deps: MeasureEvidenceDependencies = measureEvidenceDependencies,
) {
  const { sessionId, ...serviceBody } = body;
  const evidenceView = isRecord(serviceBody.evidenceView) ? serviceBody.evidenceView : null;
  const sideMatch = typeof evidenceView?.id === "string"
    ? /^(FRONT|BACK):ORIGINAL$/.exec(evidenceView.id)
    : null;
  const side = sideMatch?.[1];
  if (typeof sessionId !== "string" || !sessionId.trim() || !side || serviceBody.side !== side) {
    return serviceBody;
  }

  try {
    const ownedSessionId = sessionId.trim();
    const session = await deps.findOwnedCapture(ownedSessionId, createdByUserId);
    const capture = isRecord(session?.capture) ? session.capture : null;
    const persistedSide = capture && isRecord(capture[side.toLowerCase()])
      ? capture[side.toLowerCase()] as Record<string, unknown>
      : null;
    const storageKey = persistedSide?.inspectionStorageKey;
    const expectedStorageKey = `ai-grader-v2/${createdByUserId}/${ownedSessionId}/prepared/${side.toLowerCase()}/inspection.webp`;
    if (storageKey !== expectedStorageKey) return serviceBody;
    const imageUrl = await deps.presignRead(expectedStorageKey, 60 * 10);
    return {
      ...serviceBody,
      evidenceView: { ...evidenceView, imageUrl },
    };
  } catch {
    // Fingerprinting is optional. Preserve the existing nonblocking measure path
    // if storage lookup or fresh URL signing is temporarily unavailable.
    return serviceBody;
  }
}

export async function speedsterServiceBody(
  action: string,
  body: Record<string, unknown>,
  createdByUserId?: string,
  detectDeps: DetectLearningDependencies = detectLearningDependencies,
) {
  if (action === "measure" && createdByUserId) {
    return freshSpeedsterMeasureEvidence(body, createdByUserId);
  }
  if (action !== "detect") return body;
  return { ...body, learningBank: await detectDeps.learningBankForDetect() };
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
    let safePayload = payload;
    if (action === "geometry" && response.ok) {
      try {
        safePayload = sanitizeSpeedsterGeometryPayload(payload);
      } catch {
        return res.status(502).json({ message: "Speedster geometry response was malformed." });
      }
    }
    return res.status(response.status).json(safePayload);
  } catch (error) {
    const mapped = toErrorResponse(error);
    return res.status(mapped.status).json({ message: mapped.message });
  }
}
