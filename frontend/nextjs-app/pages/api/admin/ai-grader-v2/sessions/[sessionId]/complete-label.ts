import type { NextApiRequest, NextApiResponse } from "next";
import { createCardFromSpeedster, prisma, type Prisma } from "@tenkings/database";
import { z } from "zod";
import {
  HUMAN_GRADE_SHEET_CAPACITY,
  formatHumanGrade,
  formatHumanGradeCertificateNumber,
} from "../../../../../../lib/humanGrade";
import {
  updateSpeedsterLearningBank,
} from "../../../../../../lib/ai-grader-v2/learning";
import { requireAdminSession, toErrorResponse } from "../../../../../../lib/server/admin";
import { HttpError } from "../../../../../../lib/server/adminSessionAuthority";
import {
  afterDurableSpeedsterCompletion,
  catchUpSpeedsterLearningBankV2,
  dispatchSpeedsterLearningBank,
  speedsterLearningCompletionReadiness,
  type SpeedsterLearningCatchUpClient,
  type SpeedsterLearningCatchUpResult,
  type SpeedsterLearningCompletionReadiness,
} from "../../../../../../lib/server/aiGraderV2LearningBank";
import {
  calculateSpeedsterReview,
  completeSpeedsterReview,
  publicSpeedsterDefects,
} from "../../../../../../lib/ai-grader-v2/review";
import {
  harvestSpeedsterLearningSessionV2,
  speedsterLearningHarvestReceiptV2,
  type SpeedsterLearningHarvestReceiptV2,
} from "../../../../../../lib/ai-grader-v2/learning-harvest-v2";
import { speedsterHistoryFingerprintVersion } from "../../../../../../lib/ai-grader-v2/learning-articuno-dry-run-v2";
import {
  parsePersistedSpeedsterReviewFindings,
  parseSpeedsterReviewFindings,
} from "../../../../../../lib/ai-grader-v2/review-findings";
import type { SpeedsterCenteringBorders } from "../../../../../../lib/ai-grader-v2/scoring";
import {
  insertSpeedsterInstrumentationEvents,
  speedsterFindingFinalEvents,
  speedsterServerTimingEvent,
} from "../../../../../../lib/server/aiGraderV2Instrumentation";

const SESSION_ID = /^[a-z0-9-]{20,40}$/i;
const score = z.number().finite().min(1).max(10);
const balance = z.tuple([z.number().finite(), z.number().finite()]);
const condition = z.object({ weightedDamagePercent: z.number().finite().min(0), score }).passthrough();
const sideGrade = z
  .object({
    centering: z.object({ leftRightBalance: balance, topBottomBalance: balance, score }).passthrough(),
    corners: condition,
    edges: condition,
    surface: condition,
  })
  .passthrough();
const gradeReportSchema = z
  .object({
    front: sideGrade,
    back: sideGrade,
    subgrades: z.object({ centering: score, corners: score, edges: score, surface: score }).passthrough(),
    overall: z.object({ rawGrade: score, displayGrade: score }).passthrough(),
  })
  .passthrough();
const completeSchema = z
  .object({})
  .strict();
const optionalText = z.string().trim().max(120).optional().nullable();
const identitySchema = z
  .object({
    playerName: optionalText,
    cardName: optionalText,
    year: z.string().trim().min(1).max(24),
    manufacturer: optionalText,
    productSet: z.string().trim().min(1).max(120),
    parallel: optionalText,
    insert: optionalText,
    cardNumber: optionalText,
  })
  .passthrough();

type CompletionSession = {
  id: string;
  cardProfile: string;
  workflowState: string;
  publicReportSlug: string | null;
  identity: Prisma.JsonValue;
  capture?: Prisma.JsonValue;
  reviewedDefects?: Prisma.JsonValue;
  gradeReport?: Prisma.JsonValue;
};
type CompletionInput = {
  sessionId: string;
  createdByUserId: string;
};
type CompletionResult = {
  outcome: "CREATED" | "EXISTING";
  label: {
    id: string;
    sheetId: string;
    slot: number;
    certificateNumber: string;
    completionOrder: number;
  };
  publicReportSlug: string;
  card: {
    id: string;
    publicToken: string;
  };
  learning: SpeedsterLearningCompletionReadiness;
};
type DurableCompletionResult = Omit<CompletionResult, "learning"> & {
  learningHarvest: SpeedsterLearningHarvestReceiptV2;
};
type Dependencies = {
  requireAdminSession: (req: NextApiRequest) => Promise<{ user: { id: string } }>;
  completeSession: (input: CompletionInput) => Promise<CompletionResult>;
};

const optional = (value: string | null | undefined) => value?.trim() || null;

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

function serverOwnedReview(session: CompletionSession) {
  const capture = record(session.capture);
  const front = record(capture?.front);
  const back = record(capture?.back);
  const frontBorders = record(front?.centeringBorders);
  const backBorders = record(back?.centeringBorders);
  const persistedGrade = record(session.gradeReport);
  if (!frontBorders || !backBorders || typeof persistedGrade?.detectorVersion !== "string") {
    throw new HttpError(409, "Speedster server-owned review state is incomplete");
  }
  const defects = completeSpeedsterReview(parsePersistedSpeedsterReviewFindings(session.reviewedDefects));
  const review = calculateSpeedsterReview({
    front: { centeringBorders: frontBorders as SpeedsterCenteringBorders },
    back: { centeringBorders: backBorders as SpeedsterCenteringBorders },
  }, defects);
  return {
    reviewedDefects: publicSpeedsterDefects(review.defects),
    gradeReport: { ...review.grade, detectorVersion: persistedGrade.detectorVersion },
  };
}

export function buildSpeedsterLabelData(session: CompletionSession, report: z.infer<typeof gradeReportSchema>) {
  const parsedIdentity = identitySchema.safeParse(session.identity);
  if (!parsedIdentity.success || (session.cardProfile !== "SPORTS" && session.cardProfile !== "POKEMON")) {
    throw new HttpError(409, "Speedster label identity is incomplete");
  }
  const identity = parsedIdentity.data;
  if (session.cardProfile === "SPORTS" && (!optional(identity.playerName) || !optional(identity.manufacturer))) {
    throw new HttpError(409, "Speedster Sports label identity is incomplete");
  }
  if (session.cardProfile === "POKEMON" && !optional(identity.cardName)) {
    throw new HttpError(409, "Speedster Pokemon label identity is incomplete");
  }

  return {
    source: "SPEEDSTER" as const,
    sourceSessionId: session.id,
    gradingFormulaVersion: "EQUAL_25" as const,
    cardType: session.cardProfile as "SPORTS" | "POKEMON",
    playerName: session.cardProfile === "SPORTS" ? optional(identity.playerName) : null,
    cardName: session.cardProfile === "POKEMON" ? optional(identity.cardName) : null,
    year: identity.year.trim(),
    manufacturer: session.cardProfile === "SPORTS" ? optional(identity.manufacturer) : null,
    productSet: identity.productSet.trim(),
    parallel: optional(identity.parallel),
    insert: session.cardProfile === "SPORTS" ? optional(identity.insert) : null,
    cardNumber: optional(identity.cardNumber),
    centeringGrade: formatHumanGrade(report.subgrades.centering),
    cornersGrade: formatHumanGrade(report.subgrades.corners),
    edgesGrade: formatHumanGrade(report.subgrades.edges),
    surfaceGrade: formatHumanGrade(report.subgrades.surface),
    grade: formatHumanGrade(report.overall.displayGrade),
  };
}

export const speedsterReportSlug = (sessionId: string) => `speedster-${sessionId.toLowerCase()}`;

const labelResult = (label: {
  id: string;
  sheetId: string;
  slot: number;
  certificateSequence: number;
  certificateNumber: string | null;
}) => ({
  id: label.id,
  sheetId: label.sheetId,
  slot: label.slot,
  certificateNumber: label.certificateNumber ?? formatHumanGradeCertificateNumber(label.certificateSequence),
  completionOrder: label.certificateSequence,
});

const cardResult = (card: { id: string; publicToken: string }) => ({
  id: card.id,
  publicToken: card.publicToken,
});

const completionHarvestReceipt = (input: {
  sessionId: string;
  completedAt: Date;
  completionOrder: number;
  capture: unknown;
  gradeReport: unknown;
  reviewedDefects: unknown;
}) => speedsterLearningHarvestReceiptV2(harvestSpeedsterLearningSessionV2({
  sessionId: input.sessionId,
  completedAt: input.completedAt,
  completionOrder: input.completionOrder,
  fingerprintVersion: speedsterHistoryFingerprintVersion(input.capture, input.gradeReport),
  reviewedDefects: Array.isArray(input.reviewedDefects) ? input.reviewedDefects : [],
}).diagnostics);

async function completeSession(input: CompletionInput): Promise<CompletionResult> {
  const completionStartedAt = Date.now();
  let catchUpResult: SpeedsterLearningCatchUpResult | null = null;
  let completedFindings = [] as ReturnType<typeof parseSpeedsterReviewFindings>;
  let gradeCalculationDurationMs = 0;
  let durableCompletedAt = completionStartedAt;
  let catchUpStartedAt = completionStartedAt;
  let catchUpEndedAt = completionStartedAt;
  const result = await afterDurableSpeedsterCompletion<DurableCompletionResult>(() => prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT "id"
      FROM "AiGraderV2Session"
      WHERE "id" = ${input.sessionId} AND "createdByUserId" = ${input.createdByUserId}
      FOR UPDATE
    `;
    const session = await tx.aiGraderV2Session.findFirst({
      where: { id: input.sessionId, createdByUserId: input.createdByUserId },
      select: {
        id: true,
        cardProfile: true,
        workflowState: true,
        publicReportSlug: true,
        identity: true,
        capture: true,
        reviewedDefects: true,
        gradeReport: true,
      },
    });
    if (!session) throw new HttpError(404, "Speedster session not found");

    if (session.workflowState === "COMPLETED") {
      completedFindings = parsePersistedSpeedsterReviewFindings(session.reviewedDefects);
      const existing = await tx.humanGradeLabel.findUnique({ where: { sourceSessionId: session.id } });
      if (!existing || !session.publicReportSlug) {
        throw new HttpError(409, "Completed Speedster session is missing its label identity");
      }
      const card = await createCardFromSpeedster(tx, session.id, existing.id);
      return {
        outcome: "EXISTING",
        label: labelResult(existing),
        publicReportSlug: session.publicReportSlug,
        card: cardResult(card),
        learningHarvest: completionHarvestReceipt({
          sessionId: session.id,
          completedAt: existing.createdAt,
          completionOrder: existing.certificateSequence,
          capture: session.capture,
          gradeReport: session.gradeReport,
          reviewedDefects: session.reviewedDefects,
        }),
      };
    }
    if (session.workflowState !== "CAPTURED") {
      throw new HttpError(409, "Only a CAPTURED Speedster session can be completed");
    }

    const gradeCalculationStartedAt = Date.now();
    const completedReview = serverOwnedReview(session);
    gradeCalculationDurationMs = Date.now() - gradeCalculationStartedAt;
    completedFindings = parseSpeedsterReviewFindings(completedReview.reviewedDefects);
    const labelData = buildSpeedsterLabelData(
      session,
      completedReview.gradeReport as unknown as z.infer<typeof gradeReportSchema>,
    );
    const publicReportSlug = session.publicReportSlug ?? speedsterReportSlug(session.id);
    const claimed = await tx.aiGraderV2Session.updateMany({
      where: {
        id: session.id,
        createdByUserId: input.createdByUserId,
        workflowState: "CAPTURED",
      },
      data: {
        workflowState: "COMPLETED",
        publicReportSlug,
        reviewedDefects: completedReview.reviewedDefects as Prisma.InputJsonValue,
        gradeReport: completedReview.gradeReport as Prisma.InputJsonValue,
      },
    });
    if (claimed.count === 0) {
      const existing = await tx.humanGradeLabel.findUnique({ where: { sourceSessionId: session.id } });
      if (!existing) throw new HttpError(409, "Speedster completion is already in progress");
      const card = await createCardFromSpeedster(tx, session.id, existing.id);
      return {
        outcome: "EXISTING",
        label: labelResult(existing),
        publicReportSlug,
        card: cardResult(card),
        learningHarvest: completionHarvestReceipt({
          sessionId: session.id,
          completedAt: existing.createdAt,
          completionOrder: existing.certificateSequence,
          capture: session.capture,
          gradeReport: completedReview.gradeReport,
          reviewedDefects: completedReview.reviewedDefects,
        }),
      };
    }

    await tx.$queryRaw`
      SELECT 1 AS "lockAcquired"
      FROM pg_advisory_xact_lock(hashtext('ten-kings-human-grade-label-slots'))
    `;
    const storedLearningBank = await tx.aiGraderV2LearningBank.findUnique({ where: { id: "GLOBAL" } });
    const learningBank = dispatchSpeedsterLearningBank(storedLearningBank?.state);
    // V1 remains byte-for-byte on its established completion path. V2 learns
    // after this durable grade+label transaction so a cache failure cannot
    // roll back the human-authoritative completion.
    if (learningBank.kind === "V1") {
      const nextLearningBank = updateSpeedsterLearningBank(learningBank.bank, completedReview.reviewedDefects);
      if (JSON.stringify(nextLearningBank) !== JSON.stringify(learningBank.bank)) {
        await tx.aiGraderV2LearningBank.upsert({
          where: { id: "GLOBAL" },
          create: { id: "GLOBAL", state: nextLearningBank as Prisma.InputJsonValue },
          update: { state: nextLearningBank as Prisma.InputJsonValue },
        });
      }
    }
    let sheet = await tx.humanGradeLabelSheet.findFirst({
      where: { status: "OPEN" },
      orderBy: { sheetNumber: "asc" },
      include: { labels: { select: { slot: true }, orderBy: { slot: "asc" } } },
    });
    if (sheet && sheet.labels.length >= HUMAN_GRADE_SHEET_CAPACITY) {
      await tx.humanGradeLabelSheet.update({
        where: { id: sheet.id },
        data: { status: "READY", readyAt: sheet.readyAt ?? new Date() },
      });
      sheet = null;
    }
    if (!sheet) {
      sheet = await tx.humanGradeLabelSheet.create({
        data: {},
        include: { labels: { select: { slot: true }, orderBy: { slot: "asc" } } },
      });
    }

    const slot = sheet.labels.length + 1;
    const created = await tx.humanGradeLabel.create({
      data: { sheetId: sheet.id, slot, createdByUserId: input.createdByUserId, ...labelData },
    });
    const certificateNumber = formatHumanGradeCertificateNumber(created.certificateSequence);
    const label = await tx.humanGradeLabel.update({
      where: { id: created.id },
      data: { certificateNumber },
    });
    if (slot === HUMAN_GRADE_SHEET_CAPACITY) {
      await tx.humanGradeLabelSheet.update({
        where: { id: sheet.id },
        data: { status: "READY", readyAt: new Date() },
      });
    }
    const card = await createCardFromSpeedster(tx, session.id, label.id);
    return {
      outcome: "CREATED",
      label: labelResult(label),
      publicReportSlug,
      card: cardResult(card),
      learningHarvest: completionHarvestReceipt({
        sessionId: session.id,
        completedAt: label.createdAt,
        completionOrder: label.certificateSequence,
        capture: session.capture,
        gradeReport: completedReview.gradeReport,
        reviewedDefects: completedReview.reviewedDefects,
      }),
    };
  }), async () => {
    durableCompletedAt = Date.now();
    catchUpStartedAt = durableCompletedAt;
    catchUpResult = await catchUpSpeedsterLearningBankV2(
      prisma as unknown as SpeedsterLearningCatchUpClient,
    );
    catchUpEndedAt = Date.now();
  }, (error) => {
    catchUpEndedAt = Date.now();
    console.error(`[Speedster] SAM Memory V2 catch-up failed after durable completion for ${input.sessionId}:`, error);
  });
  const { learningHarvest, ...completion } = result;
  const learning = speedsterLearningCompletionReadiness(
    result.label.completionOrder,
    catchUpResult,
    learningHarvest,
  );
  await insertSpeedsterInstrumentationEvents(prisma, [
    ...speedsterFindingFinalEvents({
      sessionId: input.sessionId,
      createdByUserId: input.createdByUserId,
      findings: completedFindings,
    }),
    speedsterServerTimingEvent({
      eventKey: `${input.sessionId}:server:grade-calculated`,
      sessionId: input.sessionId,
      createdByUserId: input.createdByUserId,
      eventType: "GRADE_CALCULATED",
      durationMs: gradeCalculationDurationMs,
    }),
    speedsterServerTimingEvent({
      eventKey: `${input.sessionId}:server:grade-durable-completion`,
      sessionId: input.sessionId,
      createdByUserId: input.createdByUserId,
      eventType: "GRADE_DURABLE_COMPLETION",
      durationMs: durableCompletedAt - completionStartedAt,
      details: { completionOrder: result.label.completionOrder, outcome: result.outcome },
    }),
    speedsterServerTimingEvent({
      eventKey: `${input.sessionId}:server:memory-readiness:${result.label.completionOrder}`,
      sessionId: input.sessionId,
      createdByUserId: input.createdByUserId,
      eventType: "MEMORY_COMPLETION_READINESS",
      durationMs: catchUpEndedAt - catchUpStartedAt,
      details: {
        ready: learning.ready,
        catchUpStatus: learning.catchUpStatus,
        completionReflected: learning.completionReflected,
        completionOrder: learning.completionOrder,
      },
    }),
  ]).catch((error) => {
    console.error(`[Speedster] Completion instrumentation failed for ${input.sessionId}:`, error);
    return 0;
  });
  return {
    ...completion,
    learning,
  };
}

const dependencies: Dependencies = {
  requireAdminSession,
  completeSession,
};

const sessionIdFrom = (req: NextApiRequest) => {
  const value = Array.isArray(req.query.sessionId) ? req.query.sessionId[0] : req.query.sessionId;
  return typeof value === "string" && SESSION_ID.test(value) ? value : null;
};

export function createAiGraderV2CompleteLabelHandler(deps: Dependencies = dependencies) {
  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ message: "Method not allowed" });
    }
    try {
      const admin = await deps.requireAdminSession(req);
      const sessionId = sessionIdFrom(req);
      if (!sessionId) return res.status(400).json({ message: "Invalid Speedster session ID" });
      const parsed = completeSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ message: "Invalid completed Speedster grade" });
      const result = await deps.completeSession({
        sessionId,
        createdByUserId: admin.user.id,
      });
      return res.status(result.outcome === "CREATED" ? 201 : 200).json(result);
    } catch (error) {
      const response = toErrorResponse(error);
      return res.status(response.status).json({ message: response.message });
    }
  };
}

export default createAiGraderV2CompleteLabelHandler();
