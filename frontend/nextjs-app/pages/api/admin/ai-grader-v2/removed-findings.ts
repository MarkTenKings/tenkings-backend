import type { NextApiRequest, NextApiResponse } from "next";
import { prisma, type Prisma } from "@tenkings/database";

import type {
  SpeedsterCardSide,
  SpeedsterDefectType,
  SpeedsterDefectOrigin,
  SpeedsterMemoryProposal,
  SpeedsterReviewFinding,
  SpeedsterViewType,
} from "../../../../lib/ai-grader-v2/contracts";
import { isSpeedsterSourceMeasuredDefect } from "../../../../lib/ai-grader-v2/contracts";
import {
  parseSpeedsterInspectionFrame,
  type SpeedsterInspectionFrame,
} from "../../../../lib/ai-grader-v2/inspection-frame";
import {
  parseSpeedsterReviewFindings,
  speedsterFindingRegions,
} from "../../../../lib/ai-grader-v2/review-findings";
import { SPEEDSTER_REVIEW_VIEW_TYPES } from "../../../../lib/ai-grader-v2/review-image-urls";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import { presignReadUrl } from "../../../../lib/server/storage";

const SESSION_ID = /^[a-z0-9-]{20,40}$/i;
const SESSION_LIMIT = 500;
const ORIGINS = new Set<SpeedsterDefectOrigin>(["DETECTOR", "MEMORY", "SMART_MARK"]);
const DEFECT_TYPES = new Set<SpeedsterDefectType>([
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
const VIEWS = new Set<SpeedsterViewType>(SPEEDSTER_REVIEW_VIEW_TYPES);

type AuditSession = {
  id: string;
  createdByUserId: string;
  cardProfile: string;
  identity: Prisma.JsonValue;
  capture: Prisma.JsonValue;
  reviewedDefects: Prisma.JsonValue;
  publicReportSlug: string | null;
  collectibleCardV2: { lifecycleState: string } | null;
  createdAt: Date;
};

type AuditLabel = {
  sourceSessionId: string | null;
  certificateNumber: string | null;
};

type Dependencies = {
  requireAdminSession: (req: NextApiRequest) => Promise<{ user: { id: string } }>;
  listSessions: () => Promise<AuditSession[]>;
  findSession: (sessionId: string) => Promise<AuditSession | null>;
  listLabels: (sessionIds: string[]) => Promise<AuditLabel[]>;
  presignRead: (storageKey: string, expiresInSeconds: number) => Promise<string>;
};

const dependencies: Dependencies = {
  requireAdminSession,
  listSessions: () => prisma.aiGraderV2Session.findMany({
    where: { workflowState: "COMPLETED" },
    orderBy: { createdAt: "desc" },
    take: SESSION_LIMIT + 1,
    select: {
      id: true,
      createdByUserId: true,
      cardProfile: true,
      identity: true,
      capture: true,
      reviewedDefects: true,
      publicReportSlug: true,
      collectibleCardV2: { select: { lifecycleState: true } },
      createdAt: true,
    },
  }),
  findSession: (sessionId) => prisma.aiGraderV2Session.findFirst({
    where: { id: sessionId, workflowState: "COMPLETED" },
    select: {
      id: true,
      createdByUserId: true,
      cardProfile: true,
      identity: true,
      capture: true,
      reviewedDefects: true,
      publicReportSlug: true,
      collectibleCardV2: { select: { lifecycleState: true } },
      createdAt: true,
    },
  }),
  listLabels: (sessionIds) => prisma.humanGradeLabel.findMany({
    where: { sourceSessionId: { in: sessionIds } },
    select: { sourceSessionId: true, certificateNumber: true },
  }),
  presignRead: presignReadUrl,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const jsonRecord = (value: Prisma.JsonValue): Record<string, Prisma.JsonValue> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue>
    : {};

const text = (value: Prisma.JsonValue | undefined) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

function cardIdentity(session: AuditSession) {
  const identity = jsonRecord(session.identity);
  const title = text(session.cardProfile === "POKEMON" ? identity.cardName : identity.playerName)
    ?? "Ten Kings card";
  const details = [identity.year, identity.manufacturer, identity.productSet, identity.parallel, identity.cardNumber]
    .map(text)
    .filter((value): value is string => Boolean(value));
  return { title, details };
}

function savedRemovedFindings(reviewedDefects: Prisma.JsonValue) {
  try {
    return {
      dataStatus: "AVAILABLE" as const,
      findings: parseSpeedsterReviewFindings(reviewedDefects)
        .filter((finding) => finding.reviewResult === "REMOVED"),
    };
  } catch {
    return { dataStatus: "UNREADABLE" as const, findings: [] as SpeedsterReviewFinding[] };
  }
}

function normalizedOrigin(finding: SpeedsterReviewFinding): SpeedsterDefectOrigin {
  return typeof finding.origin === "string" && ORIGINS.has(finding.origin)
    ? finding.origin
    : "DETECTOR";
}

function safeMemoryProposal(value: unknown): SpeedsterMemoryProposal | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.lessonSessionId !== "string" || !value.lessonSessionId || value.lessonSessionId.length > 180 ||
    !Number.isSafeInteger(value.lessonCompletionOrder) || Number(value.lessonCompletionOrder) < 1 ||
    !Number.isSafeInteger(value.lessonProposalOrder) || Number(value.lessonProposalOrder) < 0 ||
    !Number.isSafeInteger(value.lessonOrder) || Number(value.lessonOrder) < 0 ||
    typeof value.lessonSourceViewId !== "string" || !VIEWS.has(value.lessonSourceViewId as SpeedsterViewType) ||
    typeof value.similarity !== "number" || !Number.isFinite(value.similarity) ||
    value.similarity < 0 || value.similarity > 1
  ) return null;
  return {
    lessonSessionId: value.lessonSessionId,
    lessonCompletionOrder: Number(value.lessonCompletionOrder),
    lessonProposalOrder: Number(value.lessonProposalOrder),
    lessonOrder: Number(value.lessonOrder),
    lessonSourceViewId: value.lessonSourceViewId as SpeedsterViewType,
    similarity: value.similarity,
  };
}

function originCounts(findings: readonly SpeedsterReviewFinding[]) {
  const counts: Record<SpeedsterDefectOrigin, number> = { DETECTOR: 0, MEMORY: 0, SMART_MARK: 0 };
  for (const finding of findings) counts[normalizedOrigin(finding)] += 1;
  return counts;
}

function cardProjection(session: AuditSession, label?: AuditLabel) {
  const removed = savedRemovedFindings(session.reviewedDefects);
  return {
    id: session.id,
    cardProfile: session.cardProfile,
    certificateNumber: label?.certificateNumber ?? null,
    ...cardIdentity(session),
    createdAt: session.createdAt.toISOString(),
    lifecycleState: session.collectibleCardV2?.lifecycleState ?? null,
    publicReportSlug: session.publicReportSlug,
    dataStatus: removed.dataStatus,
    removedCount: removed.findings.length,
    removedByOrigin: originCounts(removed.findings),
  };
}

function removedFindingProjection(finding: SpeedsterReviewFinding) {
  const regions = speedsterFindingRegions(finding).map((region) => ({
    zone: region.zone,
    canonicalContour: region.canonicalContour,
    measurement: region.measurement,
  }));
  const memoryProposal = safeMemoryProposal(finding.memoryProposal);
  const detectedDefectType = typeof finding.detectedDefectType === "string" &&
    DEFECT_TYPES.has(finding.detectedDefectType)
    ? finding.detectedDefectType
    : undefined;
  const common = {
    id: finding.id,
    side: finding.side,
    origin: normalizedOrigin(finding),
    defectType: finding.defectType,
    ...(detectedDefectType ? { detectedDefectType } : {}),
    confidence: finding.confidence,
    sourceViewId: finding.sourceViewId,
    supportingViewIds: finding.supportingViewIds,
    ...(memoryProposal ? { memoryProposal } : {}),
    reviewResult: "REMOVED" as const,
    zones: [...new Set(regions.map(({ zone }) => zone))],
    totalAreaMm2: regions.reduce((total, region) => total + region.measurement.areaMm2, 0),
  };
  if (isSpeedsterSourceMeasuredDefect(finding)) return { ...common, measurementRegions: regions };
  return {
    ...common,
    zone: regions[0].zone,
    canonicalContour: regions[0].canonicalContour,
    measurement: regions[0].measurement,
  };
}

function expectedStorageKeys(createdByUserId: string, sessionId: string, side: SpeedsterCardSide) {
  const prefix = `ai-grader-v2/${createdByUserId}/${sessionId}/prepared/${side.toLowerCase()}`;
  return {
    ORIGINAL: `${prefix}/inspection.webp`,
    NORMALIZED: `${prefix}/normalized.webp`,
    MICRO_DEFECT: `${prefix}/micro_defect.webp`,
    DIRECTIONAL: `${prefix}/directional.webp`,
  } as const;
}

function safeCaptureSide(
  session: AuditSession,
  side: SpeedsterCardSide,
): { frame: SpeedsterInspectionFrame; keys: Record<SpeedsterViewType, string> } | null {
  if (!isRecord(session.capture)) return null;
  const persisted = session.capture[side.toLowerCase()];
  if (!isRecord(persisted) || !isRecord(persisted.viewStorageKeys)) return null;
  const frame = parseSpeedsterInspectionFrame(persisted.inspectionFrame);
  if (!frame) return null;
  const expected = expectedStorageKeys(session.createdByUserId, session.id, side);
  const actual = {
    ORIGINAL: persisted.inspectionStorageKey,
    NORMALIZED: persisted.viewStorageKeys.NORMALIZED,
    MICRO_DEFECT: persisted.viewStorageKeys.MICRO_DEFECT,
    DIRECTIONAL: persisted.viewStorageKeys.DIRECTIONAL,
  };
  if (SPEEDSTER_REVIEW_VIEW_TYPES.some((view) => actual[view] !== expected[view])) return null;
  return { frame, keys: expected };
}

async function signedEvidence(session: AuditSession, presignRead: Dependencies["presignRead"]) {
  const front = safeCaptureSide(session, "FRONT");
  const back = safeCaptureSide(session, "BACK");
  const capture = isRecord(session.capture) ? session.capture : {};
  const cornerShape = capture.cornerShape === "ROUNDED_3_18_MM" ? "ROUNDED_3_18_MM" : "SQUARE";
  if (!front || !back) return { status: "UNAVAILABLE" as const, cornerShape, sides: null };
  try {
    const signSide = async (side: SpeedsterCardSide, value: typeof front) => {
      const urls = await Promise.all(SPEEDSTER_REVIEW_VIEW_TYPES.map((view) =>
        presignRead(value.keys[view], 60 * 10)));
      const views = Object.fromEntries(
        SPEEDSTER_REVIEW_VIEW_TYPES.map((view, index) => [`${side}:${view}`, urls[index]]),
      );
      return { masterImageUrl: urls[0], sourceImageUrls: views, inspectionFrame: value.frame };
    };
    const [signedFront, signedBack] = await Promise.all([
      signSide("FRONT", front),
      signSide("BACK", back),
    ]);
    return {
      status: "AVAILABLE" as const,
      cornerShape,
      sides: { FRONT: signedFront, BACK: signedBack },
    };
  } catch {
    return { status: "UNAVAILABLE" as const, cornerShape, sides: null };
  }
}

function sessionIdFrom(req: NextApiRequest) {
  const value = Array.isArray(req.query.sessionId) ? req.query.sessionId[0] : req.query.sessionId;
  if (value === undefined) return null;
  return typeof value === "string" && SESSION_ID.test(value) ? value : "INVALID";
}

export function createRemovedFindingsAuditHandler(deps: Dependencies = dependencies) {
  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ message: "Method not allowed" });
    }
    res.setHeader("Cache-Control", "private, no-store");
    try {
      await deps.requireAdminSession(req);
      const requestedSessionId = sessionIdFrom(req);
      if (requestedSessionId === "INVALID") {
        return res.status(400).json({ message: "Invalid Speedster session ID" });
      }
      if (requestedSessionId) {
        const session = await deps.findSession(requestedSessionId);
        if (!session) return res.status(404).json({ message: "Completed Speedster session not found" });
        const [label] = await deps.listLabels([session.id]);
        const removed = savedRemovedFindings(session.reviewedDefects);
        return res.status(200).json({
          card: cardProjection(session, label),
          removedFindings: removed.findings.map(removedFindingProjection),
          evidence: await signedEvidence(session, deps.presignRead),
        });
      }
      const listedSessions = await deps.listSessions();
      const truncated = listedSessions.length > SESSION_LIMIT;
      const sessions = listedSessions.slice(0, SESSION_LIMIT);
      const labels = sessions.length ? await deps.listLabels(sessions.map(({ id }) => id)) : [];
      const labelsBySession = new Map(labels.flatMap((label) =>
        label.sourceSessionId ? [[label.sourceSessionId, label] as const] : []));
      const cards = sessions.map((session) => cardProjection(session, labelsBySession.get(session.id)));
      const totalRemoved = cards.reduce((total, card) => total + card.removedCount, 0);
      const totalByOrigin = cards.reduce(
        (total, card) => ({
          DETECTOR: total.DETECTOR + card.removedByOrigin.DETECTOR,
          MEMORY: total.MEMORY + card.removedByOrigin.MEMORY,
          SMART_MARK: total.SMART_MARK + card.removedByOrigin.SMART_MARK,
        }),
        { DETECTOR: 0, MEMORY: 0, SMART_MARK: 0 },
      );
      const summary = {
        completedSessionsInspected: cards.length,
        sessionsWithRemovedFindings: cards.filter(({ removedCount }) => removedCount > 0).length,
        unreadableSessions: cards.filter(({ dataStatus }) => dataStatus === "UNREADABLE").length,
        totalRemovedFindings: totalRemoved,
        removedByOrigin: totalByOrigin,
        truncated,
      };
      return res.status(200).json({ summary, cards });
    } catch (error) {
      const response = toErrorResponse(error);
      return res.status(response.status).json({ message: response.message });
    }
  };
}

export default createRemovedFindingsAuditHandler();
