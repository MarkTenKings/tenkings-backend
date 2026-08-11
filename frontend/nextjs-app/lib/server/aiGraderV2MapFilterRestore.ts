import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import type { SpeedsterReviewActionSession } from "./aiGraderV2ReviewAction";
import { HttpError } from "./adminSessionAuthority";

export const SPEEDSTER_FILTER_CALIBRATION_MISTAKE_VERSION =
  "speedster-filter-calibration-mistake-v1" as const;

export function assertSpeedsterCompletedRestoreSnapshotUnchanged(before: unknown, after: unknown) {
  if (!isDeepStrictEqual(before, after)) {
    throw new Error("Completed Speedster history changed while its filter restore event was appended.");
  }
}

export type SpeedsterMapFilterRestoreEvent = Readonly<{
  id: string;
  decisionId: string;
  restoredByAdminId: string;
  sessionLifecycleState: string;
  outcome: "ACTIVE_REINTRODUCED" | "COMPLETED_CALIBRATION_ONLY";
  calibrationMistake: unknown;
  restoredAt: Date;
}>;

export type SpeedsterMapFilterRestoreDecision = Readonly<{
  id: string;
  sessionId: string;
  findingId: string;
  side: string;
  originalOrigin: string;
  proposedDefectType: string;
  findingSnapshot: unknown;
  mapId: string;
  mapRevisionId: string;
  zoneId: string;
  zoneType: string;
  zoneOverlap: unknown;
  filterPolicyVersion: string;
  ruleId: string;
  ruleInputs: unknown;
  detectorVersion: string;
  filteredAt: Date;
  restoreEvent: SpeedsterMapFilterRestoreEvent | null;
  session: SpeedsterReviewActionSession;
}>;

export type SpeedsterCompletedRestoreEvidence = Readonly<{
  sessionSha256: string;
  reviewedDefectsSha256: string;
  gradeReportSha256: string;
  publicReportSlug: string;
  labelSha256: string | null;
  permanentCardSha256: string | null;
  sessionUpdatedAt: string;
}>;

export type SpeedsterMapFilterRestoreDependencies = Readonly<{
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
}>;

const DECISION_ID = /^[a-z0-9-]{20,40}$/i;

export function speedsterFilterCalibrationMistake(
  decision: SpeedsterMapFilterRestoreDecision,
  sessionLifecycleState: string,
) {
  return {
    version: SPEEDSTER_FILTER_CALIBRATION_MISTAKE_VERSION,
    decisionId: decision.id,
    findingId: decision.findingId,
    sessionId: decision.sessionId,
    mapId: decision.mapId,
    mapRevisionId: decision.mapRevisionId,
    zoneId: decision.zoneId,
    zoneType: decision.zoneType,
    zoneOverlap: decision.zoneOverlap,
    filterPolicyVersion: decision.filterPolicyVersion,
    ruleId: decision.ruleId,
    ruleInputs: decision.ruleInputs,
    detectorVersion: decision.detectorVersion,
    filteredAt: decision.filteredAt.toISOString(),
    sessionLifecycleState,
    findingSnapshotSha256: createHash("sha256")
      .update(JSON.stringify(decision.findingSnapshot))
      .digest("hex"),
  } as const;
}

function existingResult(decision: SpeedsterMapFilterRestoreDecision) {
  const event = decision.restoreEvent;
  if (!event) return null;
  return {
    restored: true as const,
    idempotent: true,
    outcome: event.outcome,
    restoredAt: event.restoredAt.toISOString(),
    immutableEvidence: null,
  };
}

export async function restoreSpeedsterMapFilterDecision(input: {
  decisionId: string;
  restoredByAdminId: string;
}, deps: SpeedsterMapFilterRestoreDependencies) {
  if (!DECISION_ID.test(input.decisionId)) {
    throw new HttpError(400, "Invalid Speedster filter decision ID.");
  }
  const decision = await deps.loadDecision(input.decisionId);
  if (!decision) throw new HttpError(404, "Speedster filter decision not found.");
  const existing = existingResult(decision);
  if (existing) return existing;
  const lifecycle = decision.session.workflowState;
  const calibrationMistake = speedsterFilterCalibrationMistake(decision, lifecycle);

  if (lifecycle === "CAPTURED") {
    if (
      decision.session.mapRevisionId !== decision.mapRevisionId
      || decision.session.mapFilterPolicyVersion !== decision.filterPolicyVersion
    ) {
      throw new HttpError(409, "The active session no longer matches the saved filter decision.");
    }
    const remeasured = await deps.remeasureActive(decision);
    const persisted = await deps.persistActive({
      decision,
      restoredByAdminId: input.restoredByAdminId,
      calibrationMistake,
      ...remeasured,
    });
    return {
      restored: true as const,
      idempotent: !persisted.created,
      outcome: persisted.event.outcome,
      restoredAt: persisted.event.restoredAt.toISOString(),
      immutableEvidence: null,
    };
  }

  if (lifecycle !== "COMPLETED") {
    throw new HttpError(409, "Only an active or completed Speedster session can restore a filtered finding.");
  }
  const persisted = await deps.persistCompleted({
    decision,
    restoredByAdminId: input.restoredByAdminId,
    calibrationMistake,
  });
  return {
    restored: true as const,
    idempotent: !persisted.created,
    outcome: persisted.event.outcome,
    restoredAt: persisted.event.restoredAt.toISOString(),
    immutableEvidence: persisted.immutableEvidence,
  };
}
