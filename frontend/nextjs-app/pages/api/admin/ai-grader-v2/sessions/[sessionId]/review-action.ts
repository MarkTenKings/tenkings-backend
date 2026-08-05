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
  z.object({ type: z.literal("REMOVE"), defectId: FINDING_ID }).strict(),
  z.object({ type: z.literal("UNDO"), defectId: FINDING_ID }).strict(),
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

const dependencies: HandlerDependencies = {
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
      workflowState: true,
      capture: true,
      reviewedDefects: true,
      gradeReport: true,
      updatedAt: true,
    },
  }),
  learningBankForDetect: () => speedsterLearningBankForDetectRequest(
    prisma as unknown as SpeedsterLearningDetectClient,
    (error) => console.error("[Speedster] SAM Memory catch-up failed before server detect:", error),
  ),
  async detect(body) {
    const serviceUrl = process.env.AI_GRADER_SPEEDSTER_SERVICE_URL?.replace(/\/$/, "");
    if (!serviceUrl) throw new HttpError(503, "AI_GRADER_SPEEDSTER_SERVICE_URL is not configured");
    const response = await fetch(`${serviceUrl}/detect`, {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload && typeof payload === "object" && "detail" in payload
        ? JSON.stringify(payload.detail)
        : "Speedster detector service failed.";
      throw new HttpError(response.status >= 500 ? 502 : 400, message);
    }
    return payload as Awaited<ReturnType<SpeedsterReviewActionDependencies["detect"]>>;
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
  persistReviewIfRevision: (identity, expectedUpdatedAt, data) => prisma.$transaction(async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "AiGraderV2Session" WHERE "id" = ${identity.sessionId} AND "createdByUserId" = ${identity.createdByUserId} FOR UPDATE`,
    );
    const current = await tx.aiGraderV2Session.findFirst({
      where: { id: identity.sessionId, createdByUserId: identity.createdByUserId },
      select: { workflowState: true, updatedAt: true },
    });
    if (
      !current || current.workflowState !== "CAPTURED" ||
      current.updatedAt.getTime() !== expectedUpdatedAt.getTime()
    ) {
      throw new HttpError(409, "Speedster review state changed before it could be saved");
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
