export const AI_GRADER_CAPTURE_TIMING_SCHEMA_VERSION = "ten-kings-ai-grader-capture-timing-v1" as const;

export type AiGraderCaptureTimingSide = "front" | "back";
export type AiGraderCaptureTimingProfile = "full_forensic" | "production_fast";
export type AiGraderCaptureTriggerMode = "operator" | "auto";

export const AI_GRADER_CAPTURE_PROFILE_VERSIONS: Record<AiGraderCaptureTimingProfile, string> = {
  full_forensic: "ten-kings-fixed-rig-full-forensic-v1",
  production_fast: "ten-kings-fixed-rig-production-fast-v1",
};

export type AiGraderCaptureTimingEventId =
  | "session_started"
  | "preview_stream_started"
  | "preview_ready"
  | "edge_detection_ready"
  | "capture_trigger"
  | "raw_capture_completed"
  | "side_processing_started"
  | "side_processing_completed"
  | "back_positioning_started"
  | "report_generation_started"
  | "report_ready"
  | "safely_queued";

export type AiGraderCaptureTimingPhaseId =
  | "lighting_profile"
  | "frame_capture"
  | "file_writes"
  | "file_hashes"
  | "crop_deskew"
  | "grading_forensic_runner"
  | "side_processing"
  | "report_generation";

export interface AiGraderCaptureTimingEvent {
  id: AiGraderCaptureTimingEventId;
  at: string;
  side?: AiGraderCaptureTimingSide;
  triggerMode?: AiGraderCaptureTriggerMode;
}

export interface AiGraderCaptureTimingPhase {
  id: AiGraderCaptureTimingPhaseId;
  durationMs: number;
  side?: AiGraderCaptureTimingSide;
  startedAt?: string;
  finishedAt?: string;
}

export interface AiGraderCaptureTimingSummary {
  previewReadyMs?: number;
  frontEdgeDetectionReadyMs?: number;
  backEdgeDetectionReadyMs?: number;
  frontPositioningMs?: number;
  backPositioningMs?: number;
  totalFrontMs?: number;
  totalBackMs?: number;
  frontProcessingMs?: number;
  backProcessingMs?: number;
  frontProcessingDuringFlipMs?: number;
  frontProcessingOverlappedFlip: boolean;
  reportGenerationMs?: number;
  totalCardMs?: number;
  reportReadyTotalMs?: number;
  safeQueueLatencyMs?: number;
}

export interface AiGraderCaptureTimingMetadata {
  schemaVersion: typeof AI_GRADER_CAPTURE_TIMING_SCHEMA_VERSION;
  captureProfile: AiGraderCaptureTimingProfile;
  targetSideMs: 5000;
  hardwareMeasurement: boolean;
  events: AiGraderCaptureTimingEvent[];
  phases: AiGraderCaptureTimingPhase[];
  summary: AiGraderCaptureTimingSummary;
  target: {
    frontWithinTarget?: boolean;
    backWithinTarget?: boolean;
    fiveSecondsPerSideProven: boolean;
    hardwareMeasurementRequired: boolean;
    note: string;
  };
}

function validIso(value: string | undefined): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function timestamp(value: string | undefined) {
  return validIso(value) ? Date.parse(value) : undefined;
}

function durationBetween(start: string | undefined, finish: string | undefined) {
  const startMs = timestamp(start);
  const finishMs = timestamp(finish);
  if (startMs === undefined || finishMs === undefined || finishMs < startMs) return undefined;
  return finishMs - startMs;
}

function eventAt(
  timing: AiGraderCaptureTimingMetadata,
  id: AiGraderCaptureTimingEventId,
  side?: AiGraderCaptureTimingSide
) {
  return timing.events.find((event) => event.id === id && (side === undefined || event.side === side))?.at;
}

function phaseDuration(
  timing: AiGraderCaptureTimingMetadata,
  id: AiGraderCaptureTimingPhaseId,
  side?: AiGraderCaptureTimingSide
) {
  const values = timing.phases
    .filter((phase) => phase.id === id && (side === undefined || phase.side === side))
    .map((phase) => phase.durationMs)
    .filter((value) => Number.isFinite(value) && value >= 0);
  if (!values.length) return undefined;
  return Math.round(values.reduce((sum, value) => sum + value, 0) * 10) / 10;
}

function intervalOverlapMs(
  firstStart: string | undefined,
  firstFinish: string | undefined,
  secondStart: string | undefined,
  secondFinish: string | undefined
) {
  const starts = [timestamp(firstStart), timestamp(secondStart)];
  const finishes = [timestamp(firstFinish), timestamp(secondFinish)];
  if (starts.some((value) => value === undefined) || finishes.some((value) => value === undefined)) return undefined;
  const overlap = Math.min(finishes[0]!, finishes[1]!) - Math.max(starts[0]!, starts[1]!);
  return Math.max(0, overlap);
}

export function createAiGraderCaptureTimingMetadata(input: {
  captureProfile?: AiGraderCaptureTimingProfile;
  hardwareMeasurement?: boolean;
  startedAt?: string;
} = {}): AiGraderCaptureTimingMetadata {
  const startedAt = validIso(input.startedAt) ? new Date(input.startedAt).toISOString() : new Date().toISOString();
  const timing: AiGraderCaptureTimingMetadata = {
    schemaVersion: AI_GRADER_CAPTURE_TIMING_SCHEMA_VERSION,
    captureProfile: input.captureProfile ?? "full_forensic",
    targetSideMs: 5000,
    hardwareMeasurement: input.hardwareMeasurement === true,
    events: [{ id: "session_started", at: startedAt }],
    phases: [],
    summary: { frontProcessingOverlappedFlip: false },
    target: {
      fiveSecondsPerSideProven: false,
      hardwareMeasurementRequired: input.hardwareMeasurement !== true,
      note: "Five seconds per side is unproven until both sides are measured on the Dell with complete forensic evidence preserved.",
    },
  };
  return summarizeAiGraderCaptureTiming(timing);
}

export function recordAiGraderCaptureTimingEvent(
  timing: AiGraderCaptureTimingMetadata,
  input: {
    id: AiGraderCaptureTimingEventId;
    at?: string;
    side?: AiGraderCaptureTimingSide;
    triggerMode?: AiGraderCaptureTriggerMode;
    firstOnly?: boolean;
  }
) {
  const at = validIso(input.at) ? new Date(input.at).toISOString() : new Date().toISOString();
  if (
    input.firstOnly !== false &&
    timing.events.some((event) => event.id === input.id && event.side === input.side)
  ) {
    return summarizeAiGraderCaptureTiming(timing);
  }
  timing.events.push({
    id: input.id,
    at,
    ...(input.side ? { side: input.side } : {}),
    ...(input.triggerMode ? { triggerMode: input.triggerMode } : {}),
  });
  timing.events.sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
  return summarizeAiGraderCaptureTiming(timing);
}

export function recordAiGraderCaptureTimingPhase(
  timing: AiGraderCaptureTimingMetadata,
  input: AiGraderCaptureTimingPhase
) {
  if (!Number.isFinite(input.durationMs) || input.durationMs < 0) return summarizeAiGraderCaptureTiming(timing);
  const phase: AiGraderCaptureTimingPhase = {
    id: input.id,
    durationMs: Math.round(input.durationMs * 10) / 10,
    ...(input.side ? { side: input.side } : {}),
    ...(validIso(input.startedAt) ? { startedAt: new Date(input.startedAt).toISOString() } : {}),
    ...(validIso(input.finishedAt) ? { finishedAt: new Date(input.finishedAt).toISOString() } : {}),
  };
  const existingIndex = timing.phases.findIndex(
    (candidate) => candidate.id === phase.id && candidate.side === phase.side
  );
  if (existingIndex >= 0) timing.phases[existingIndex] = phase;
  else timing.phases.push(phase);
  return summarizeAiGraderCaptureTiming(timing);
}

export function summarizeAiGraderCaptureTiming(timing: AiGraderCaptureTimingMetadata) {
  const sessionStartedAt = eventAt(timing, "session_started");
  const previewStartedAt = eventAt(timing, "preview_stream_started");
  const previewReadyAt = eventAt(timing, "preview_ready");
  const frontTriggerAt = eventAt(timing, "capture_trigger", "front");
  const frontCapturedAt = eventAt(timing, "raw_capture_completed", "front");
  const backPositioningAt = eventAt(timing, "back_positioning_started", "back");
  const backTriggerAt = eventAt(timing, "capture_trigger", "back");
  const backCapturedAt = eventAt(timing, "raw_capture_completed", "back");
  const frontProcessingStartedAt = eventAt(timing, "side_processing_started", "front");
  const frontProcessingCompletedAt = eventAt(timing, "side_processing_completed", "front");
  const safelyQueuedAt = eventAt(timing, "safely_queued");
  const reportReadyAt = eventAt(timing, "report_ready");
  const operatorCycleCompletedAt = safelyQueuedAt ?? reportReadyAt;
  const totalFrontMs = durationBetween(frontTriggerAt, frontCapturedAt);
  const totalBackMs = durationBetween(backTriggerAt, backCapturedAt);
  const frontWithinTarget = totalFrontMs === undefined ? undefined : totalFrontMs <= timing.targetSideMs;
  const backWithinTarget = totalBackMs === undefined ? undefined : totalBackMs <= timing.targetSideMs;
  const fiveSecondsPerSideProven =
    timing.hardwareMeasurement && frontWithinTarget === true && backWithinTarget === true;
  const frontProcessingDuringFlipMs = intervalOverlapMs(
    frontProcessingStartedAt,
    frontProcessingCompletedAt,
    backPositioningAt,
    backTriggerAt
  );
  timing.summary = {
    previewReadyMs: durationBetween(previewStartedAt, previewReadyAt),
    frontEdgeDetectionReadyMs: durationBetween(
      previewStartedAt,
      eventAt(timing, "edge_detection_ready", "front")
    ),
    backEdgeDetectionReadyMs: durationBetween(
      backPositioningAt,
      eventAt(timing, "edge_detection_ready", "back")
    ),
    frontPositioningMs: durationBetween(previewReadyAt ?? sessionStartedAt, frontTriggerAt),
    backPositioningMs: durationBetween(backPositioningAt, backTriggerAt),
    totalFrontMs,
    totalBackMs,
    frontProcessingMs:
      phaseDuration(timing, "side_processing", "front") ??
      durationBetween(frontProcessingStartedAt, frontProcessingCompletedAt),
    backProcessingMs:
      phaseDuration(timing, "side_processing", "back") ??
      durationBetween(
        eventAt(timing, "side_processing_started", "back"),
        eventAt(timing, "side_processing_completed", "back")
      ),
    frontProcessingDuringFlipMs,
    frontProcessingOverlappedFlip: (frontProcessingDuringFlipMs ?? 0) > 0,
    reportGenerationMs:
      phaseDuration(timing, "report_generation") ??
      durationBetween(eventAt(timing, "report_generation_started"), eventAt(timing, "report_ready")),
    totalCardMs: durationBetween(frontTriggerAt ?? sessionStartedAt, operatorCycleCompletedAt),
    reportReadyTotalMs: durationBetween(frontTriggerAt ?? sessionStartedAt, reportReadyAt),
    safeQueueLatencyMs: durationBetween(backCapturedAt, safelyQueuedAt),
  };
  timing.target = {
    ...(frontWithinTarget !== undefined ? { frontWithinTarget } : {}),
    ...(backWithinTarget !== undefined ? { backWithinTarget } : {}),
    fiveSecondsPerSideProven,
    hardwareMeasurementRequired: !timing.hardwareMeasurement,
    note: fiveSecondsPerSideProven
      ? "Both sides met the five-second target in a recorded hardware run with the selected forensic profile."
      : timing.hardwareMeasurement
        ? "The hardware run did not prove five seconds for both sides; inspect file-write, frame-capture, and lighting/profile phases."
        : "Five seconds per side is unproven until both sides are measured on the Dell with complete forensic evidence preserved.",
  };
  return timing;
}

export function cloneAiGraderCaptureTiming(timing: AiGraderCaptureTimingMetadata) {
  return summarizeAiGraderCaptureTiming(structuredClone(timing));
}
