import { createHash } from "node:crypto";

import { Prisma } from "@prisma/client";
import { prisma } from "@tenkings/database";
import type { NextApiRequest, NextApiResponse } from "next";

import { parseSpeedsterReviewFindings } from "../../../../../../lib/ai-grader-v2/review-findings";
import { requireAdminSession, toErrorResponse } from "../../../../../../lib/server/admin";
import {
  remeasureSpeedsterFilteredFindingRestore,
  type SpeedsterReviewActionDependencies,
} from "../../../../../../lib/server/aiGraderV2ReviewAction";
import {
  assertSpeedsterCompletedRestoreSnapshotUnchanged,
  restoreSpeedsterMapFilterDecision,
  type SpeedsterCompletedRestoreEvidence,
  type SpeedsterMapFilterRestoreDecision,
  type SpeedsterMapFilterRestoreEvent,
} from "../../../../../../lib/server/aiGraderV2MapFilterRestore";
import { HttpError } from "../../../../../../lib/server/adminSessionAuthority";
import { presignReadUrl } from "../../../../../../lib/server/storage";

const DECISION_ID = /^[a-z0-9-]{20,40}$/i;

type Dependencies = {
  requireAdminSession: typeof requireAdminSession;
  loadDecision: (decisionId: string) => Promise<SpeedsterMapFilterRestoreDecision | null>;
  remeasureActive: (
    decision: SpeedsterMapFilterRestoreDecision,
  ) => Promise<{ reviewedDefects: readonly unknown[]; gradeReport: unknown }>;
  persistActive: (input: {
    decision: SpeedsterMapFilterRestoreDecision;
    restoredByAdminId: string;
    calibrationMistake: unknown;
    reviewedDefects: readonly unknown[];
    gradeReport: unknown;
  }) => Promise<{ event: SpeedsterMapFilterRestoreEvent; created: boolean }>;
  persistCompleted: (input: {
    decision: SpeedsterMapFilterRestoreDecision;
    restoredByAdminId: string;
    calibrationMistake: unknown;
  }) => Promise<{
    event: SpeedsterMapFilterRestoreEvent;
    created: boolean;
    immutableEvidence: SpeedsterCompletedRestoreEvidence;
  }>;
};

function serviceHeaders() {
  const apiKey = process.env.AI_GRADER_SPEEDSTER_SERVICE_API_KEY?.trim();
  return {
    "Content-Type": "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

const measure: SpeedsterReviewActionDependencies["measure"] = async (body) => {
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
};

function eventProjection(value: {
  id: string;
  decisionId: string;
  restoredByAdminId: string;
  sessionLifecycleState: string;
  outcome: string;
  calibrationMistake: unknown;
  restoredAt: Date;
}): SpeedsterMapFilterRestoreEvent {
  if (value.outcome !== "ACTIVE_REINTRODUCED" && value.outcome !== "COMPLETED_CALIBRATION_ONLY") {
    throw new Error("Persisted Speedster restore outcome is invalid.");
  }
  return { ...value, outcome: value.outcome };
}

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function completedSnapshot(tx: Prisma.TransactionClient, sessionId: string) {
  const [session, label, permanentCard] = await Promise.all([
    tx.aiGraderV2Session.findUniqueOrThrow({
      where: { id: sessionId },
    }),
    tx.humanGradeLabel.findUnique({ where: { sourceSessionId: sessionId } }),
    tx.collectibleCardV2.findUnique({ where: { speedsterSessionId: sessionId } }),
  ]);
  return { session, label, permanentCard };
}

function immutableEvidence(snapshot: Awaited<ReturnType<typeof completedSnapshot>>): SpeedsterCompletedRestoreEvidence {
  return {
    sessionSha256: hash(snapshot.session),
    reviewedDefectsSha256: hash(snapshot.session.reviewedDefects),
    gradeReportSha256: hash(snapshot.session.gradeReport),
    publicReportSlug: snapshot.session.publicReportSlug ?? "",
    labelSha256: snapshot.label ? hash(snapshot.label) : null,
    permanentCardSha256: snapshot.permanentCard ? hash(snapshot.permanentCard) : null,
    sessionUpdatedAt: snapshot.session.updatedAt.toISOString(),
  };
}

const dependencies: Dependencies = {
  requireAdminSession,
  loadDecision: (decisionId) => prisma.aiGraderV2MapFilterDecision.findUnique({
    where: { id: decisionId },
    include: {
      restoreEvent: true,
      session: {
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
      },
    },
  }) as unknown as Promise<SpeedsterMapFilterRestoreDecision | null>,
  remeasureActive: (decision) => remeasureSpeedsterFilteredFindingRestore({
    session: decision.session,
    findingSnapshot: decision.findingSnapshot,
    detectorVersion: decision.detectorVersion,
  }, { presignRead: presignReadUrl, measure }),
  persistActive: (input) => prisma.$transaction(async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "AiGraderV2MapFilterDecision" WHERE "id" = ${input.decision.id} FOR UPDATE`,
    );
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "AiGraderV2Session" WHERE "id" = ${input.decision.sessionId} FOR UPDATE`,
    );
    const existing = await tx.aiGraderV2MapFilterRestoreEvent.findUnique({
      where: { decisionId: input.decision.id },
    });
    if (existing) return { event: eventProjection(existing), created: false };
    const current = await tx.aiGraderV2Session.findUnique({
      where: { id: input.decision.sessionId },
      select: {
        workflowState: true,
        updatedAt: true,
        mapRevisionId: true,
        mapFilterPolicyVersion: true,
        reviewedDefects: true,
      },
    });
    if (
      !current
      || current.workflowState !== "CAPTURED"
      || current.updatedAt.getTime() !== input.decision.session.updatedAt.getTime()
      || current.mapRevisionId !== input.decision.mapRevisionId
      || current.mapFilterPolicyVersion !== input.decision.filterPolicyVersion
    ) {
      throw new HttpError(409, "Speedster review state changed before the restore could be saved.");
    }
    if (parseSpeedsterReviewFindings(current.reviewedDefects).some(({ id }) => id === input.decision.findingId)) {
      throw new HttpError(409, "The filtered finding is already present in active review.");
    }
    const updated = await tx.aiGraderV2Session.updateMany({
      where: {
        id: input.decision.sessionId,
        workflowState: "CAPTURED",
        updatedAt: input.decision.session.updatedAt,
      },
      data: {
        reviewedDefects: input.reviewedDefects as Prisma.InputJsonValue,
        gradeReport: input.gradeReport as Prisma.InputJsonValue,
      },
    });
    if (updated.count !== 1) {
      throw new HttpError(409, "Speedster review state changed before the restore could be saved.");
    }
    const event = await tx.aiGraderV2MapFilterRestoreEvent.create({
      data: {
        decisionId: input.decision.id,
        restoredByAdminId: input.restoredByAdminId,
        sessionLifecycleState: "CAPTURED",
        outcome: "ACTIVE_REINTRODUCED",
        calibrationMistake: input.calibrationMistake as Prisma.InputJsonValue,
      },
    });
    return { event: eventProjection(event), created: true };
  }, { isolationLevel: "Serializable" }),
  persistCompleted: (input) => prisma.$transaction(async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "AiGraderV2MapFilterDecision" WHERE "id" = ${input.decision.id} FOR UPDATE`,
    );
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "AiGraderV2Session" WHERE "id" = ${input.decision.sessionId} FOR UPDATE`,
    );
    const existing = await tx.aiGraderV2MapFilterRestoreEvent.findUnique({
      where: { decisionId: input.decision.id },
    });
    const before = await completedSnapshot(tx, input.decision.sessionId);
    if (before.session.workflowState !== "COMPLETED") {
      throw new HttpError(409, "The Speedster session is no longer completed.");
    }
    if (existing) {
      return {
        event: eventProjection(existing),
        created: false,
        immutableEvidence: immutableEvidence(before),
      };
    }
    const event = await tx.aiGraderV2MapFilterRestoreEvent.create({
      data: {
        decisionId: input.decision.id,
        restoredByAdminId: input.restoredByAdminId,
        sessionLifecycleState: "COMPLETED",
        outcome: "COMPLETED_CALIBRATION_ONLY",
        calibrationMistake: input.calibrationMistake as Prisma.InputJsonValue,
      },
    });
    const after = await completedSnapshot(tx, input.decision.sessionId);
    assertSpeedsterCompletedRestoreSnapshotUnchanged(before, after);
    return {
      event: eventProjection(event),
      created: true,
      immutableEvidence: immutableEvidence(after),
    };
  }, { isolationLevel: "Serializable" }),
};

function decisionIdFrom(req: NextApiRequest) {
  const value = Array.isArray(req.query.decisionId) ? req.query.decisionId[0] : req.query.decisionId;
  return typeof value === "string" && DECISION_ID.test(value) ? value : null;
}

export function createSpeedsterMapFilterRestoreHandler(deps: Dependencies = dependencies) {
  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ message: "Method not allowed" });
    }
    res.setHeader("Cache-Control", "private, no-store");
    try {
      const admin = await deps.requireAdminSession(req);
      const decisionId = decisionIdFrom(req);
      if (!decisionId) return res.status(400).json({ message: "Invalid Speedster filter decision ID" });
      const result = await restoreSpeedsterMapFilterDecision({
        decisionId,
        restoredByAdminId: admin.user.id,
      }, deps);
      return res.status(200).json(result);
    } catch (error) {
      const mapped = toErrorResponse(error);
      return res.status(mapped.status).json({ message: mapped.message });
    }
  };
}

export default createSpeedsterMapFilterRestoreHandler();
