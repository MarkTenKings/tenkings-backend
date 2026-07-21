import {
  AI_GRADER_PREVIEW_SNAPSHOT_MAX_AGE_MS,
  aiGraderPreviewDisplayedSnapshot,
  type AiGraderPreviewEpochBinding,
  type AiGraderPreviewEpochState,
} from "./aiGraderPreviewLifecycle";

export type AiGraderCalibrationConsoleAction =
  | "start_new"
  | "resume"
  | "capture_current_pose"
  | "retry_current_pose"
  | "replace_selected_pose"
  | "confirm_blank_reverse_flip"
  | "begin_or_resume_automatic_sweep"
  | "analyze"
  | "finalize"
  | "activate"
  | "reactivate"
  | "exit";

export type AiGraderCalibrationConsolePhase =
  | "no_session"
  | "checkerboard_poses"
  | "blank_reverse_flip"
  | "automatic_sweep"
  | "analyze"
  | "analysis_failed"
  | "finalize"
  | "finalized_pass"
  | "finalized_fail"
  | "activated";

export type AiGraderCalibrationPoint = { x: number; y: number };

export type AiGraderCalibrationPoseView = {
  poseNumber: 1 | 2 | 3 | 4;
  operationLabel: string;
  acceptedAt: string;
  evidenceSha256: string;
  centerXFraction: number;
  centerYFraction: number;
  rotationDegrees: number;
  coverageFraction: number;
  safetyMarginFraction: number;
  superseded: boolean;
  supersededByOperationLabel?: string;
};

export type AiGraderCalibrationAttemptView = {
  attemptLabel: string;
  failedAt: string;
  stepLabel: string;
  message: string;
  poseNumber?: 1 | 2 | 3 | 4;
};

export type AiGraderCalibrationHistoryView = {
  calibrationId: string;
  name: string;
  location: string;
  lightingLabel: string;
  status: "incomplete" | "failed" | "eligible" | "active" | "superseded" | "revoked";
  bundleSha256?: string;
  runtimeContextSha256?: string;
  rigCharacterizationSha256?: string;
  finalizedAt?: string;
  activatedAt?: string;
  gateSummary: string;
  eligibleForActivation: boolean;
  active: boolean;
};

export type AiGraderCalibrationActionAuthority = {
  available: boolean;
  reason: string;
  /** Opaque bridge/hosted authority; never generated or interpreted by the browser. */
  authorityPresent: boolean;
};

export type AiGraderCalibrationConsoleViewModel = {
  source: "authoritative_bridge" | "mocked_test_data" | "contract_unavailable";
  contractVersion?: string;
  sessionId?: string;
  sessionRevision?: string;
  eventHeadSha256?: string;
  /** Exact preview epoch issued by the local bridge; never derived in-browser. */
  previewBinding?: AiGraderPreviewEpochBinding;
  phase: AiGraderCalibrationConsolePhase;
  title: string;
  summary: string;
  hardFailure?: string;
  currentPoseNumber?: 1 | 2 | 3 | 4;
  currentPose: {
    valid: boolean;
    reasons: string[];
    exactTargetContour: AiGraderCalibrationPoint[] | null;
    centerXFraction: number | null;
    centerYFraction: number | null;
    rotationDegrees: number | null;
    coverageFraction: number | null;
    safetyMarginFraction: number | null;
  };
  aggregateDiversity: {
    xSpan: number;
    ySpan: number;
    rotationSpanDegrees: number;
    minimumXSpan: number;
    minimumYSpan: number;
    minimumRotationSpanDegrees: number;
    exactFinalGateSatisfied: boolean;
  };
  movementGuidance: string[];
  acceptedPoses: AiGraderCalibrationPoseView[];
  failedAttempts: AiGraderCalibrationAttemptView[];
  automaticSweep: {
    acceptedFrames: number;
    requiredFrames: number;
    currentLabel: string;
    resumed: boolean;
  };
  analysis: {
    status: "not_started" | "running" | "pass" | "fail";
    exactPass: boolean;
    summary: string;
    issues: string[];
  };
  finalization: {
    status: "not_started" | "running" | "pass" | "fail";
    exactPass: boolean;
    bundleSha256?: string;
    runtimeContextSha256?: string;
    rigCharacterizationSha256?: string;
    memberLedgerSha256?: string;
    memberCount?: number;
    summary: string;
  };
  calibrations: AiGraderCalibrationHistoryView[];
  actions: Record<AiGraderCalibrationConsoleAction, AiGraderCalibrationActionAuthority>;
};

const blocked = (reason: string): AiGraderCalibrationActionAuthority => ({
  available: false,
  reason,
  authorityPresent: false,
});

const unavailableActions = (reason: string): AiGraderCalibrationConsoleViewModel["actions"] => ({
  start_new: blocked(reason),
  resume: blocked(reason),
  capture_current_pose: blocked(reason),
  retry_current_pose: blocked(reason),
  replace_selected_pose: blocked(reason),
  confirm_blank_reverse_flip: blocked(reason),
  begin_or_resume_automatic_sweep: blocked(reason),
  analyze: blocked(reason),
  finalize: blocked(reason),
  activate: blocked(reason),
  reactivate: blocked(reason),
  exit: { available: true, reason: "Return to the grading station without changing calibration state.", authorityPresent: true },
});

export function unavailableAiGraderCalibrationConsole(
  message = "The reviewed Mathematical Calibration V1.2 console contract is not available from the paired bridge.",
): AiGraderCalibrationConsoleViewModel {
  return {
    source: "contract_unavailable",
    phase: "no_session",
    title: "Calibration console unavailable",
    summary: "Calibration remains fail-closed. No operation identity, capture step, threshold, bundle, or activation authority was inferred in the browser.",
    hardFailure: message,
    currentPose: {
      valid: false,
      reasons: ["No authoritative expected-step projection is available."],
      exactTargetContour: null,
      centerXFraction: null,
      centerYFraction: null,
      rotationDegrees: null,
      coverageFraction: null,
      safetyMarginFraction: null,
    },
    aggregateDiversity: {
      xSpan: 0,
      ySpan: 0,
      rotationSpanDegrees: 0,
      minimumXSpan: 0,
      minimumYSpan: 0,
      minimumRotationSpanDegrees: 0,
      exactFinalGateSatisfied: false,
    },
    movementGuidance: ["Start or resume is unavailable until the paired helper exports the reviewed exact session contract."],
    acceptedPoses: [],
    failedAttempts: [],
    automaticSweep: { acceptedFrames: 0, requiredFrames: 72, currentLabel: "Not started", resumed: false },
    analysis: { status: "not_started", exactPass: false, summary: "Analysis has not run.", issues: [] },
    finalization: { status: "not_started", exactPass: false, summary: "No finalized twelve-member bundle exists." },
    calibrations: [],
    actions: unavailableActions(message),
  };
}

export function aiGraderCalibrationPreviewFresh(state: AiGraderPreviewEpochState, nowMs: number): boolean {
  const displayed = aiGraderPreviewDisplayedSnapshot(state);
  if (!displayed || !displayed.imageLoaded || state.phase !== "live") return false;
  return Number.isFinite(displayed.receivedAtMs)
    && nowMs >= displayed.receivedAtMs
    && nowMs - displayed.receivedAtMs <= AI_GRADER_PREVIEW_SNAPSHOT_MAX_AGE_MS;
}

export function aiGraderCalibrationActionEnabled(input: {
  model: AiGraderCalibrationConsoleViewModel;
  action: AiGraderCalibrationConsoleAction;
  previewFresh: boolean;
  selectedPoseNumber?: number;
  replacementWarningConfirmed?: boolean;
}) {
  const authority = input.model.actions[input.action];
  if (!authority.available || !authority.authorityPresent) return false;
  if (input.action === "capture_current_pose" || input.action === "retry_current_pose") {
    return input.previewFresh && input.model.currentPose.valid;
  }
  if (input.action === "replace_selected_pose") {
    return input.previewFresh
      && input.model.currentPose.valid
      && Boolean(input.replacementWarningConfirmed)
      && input.model.acceptedPoses.some((pose) => !pose.superseded && pose.poseNumber === input.selectedPoseNumber);
  }
  if (input.action === "activate") {
    return input.model.analysis.exactPass
      && input.model.finalization.exactPass
      && input.model.finalization.memberCount === 12;
  }
  return true;
}

function authority(available: boolean, reason: string): AiGraderCalibrationActionAuthority {
  return { available, reason, authorityPresent: true };
}

export function buildMockAiGraderCalibrationConsole(
  scenario: "incomplete" | "failed" | "pass" = "incomplete",
): AiGraderCalibrationConsoleViewModel {
  const pass = scenario === "pass";
  const failed = scenario === "failed";
  const acceptedPoses: AiGraderCalibrationPoseView[] = [
    { poseNumber: 1, operationLabel: "Accepted pose 1", acceptedAt: "2026-07-21T14:02:11.000Z", evidenceSha256: "1".repeat(64), centerXFraction: .41, centerYFraction: .42, rotationDegrees: -4.8, coverageFraction: .47, safetyMarginFraction: .082, superseded: false },
    { poseNumber: 2, operationLabel: "Accepted pose 2", acceptedAt: "2026-07-21T14:03:06.000Z", evidenceSha256: "2".repeat(64), centerXFraction: .59, centerYFraction: .43, rotationDegrees: 4.1, coverageFraction: .46, safetyMarginFraction: .079, superseded: false },
    { poseNumber: 3, operationLabel: "Accepted pose 3", acceptedAt: "2026-07-21T14:04:19.000Z", evidenceSha256: "3".repeat(64), centerXFraction: .43, centerYFraction: .61, rotationDegrees: -1.7, coverageFraction: .48, safetyMarginFraction: .074, superseded: false },
    ...(pass || failed ? [{ poseNumber: 4 as const, operationLabel: "Accepted pose 4", acceptedAt: "2026-07-21T14:05:22.000Z", evidenceSha256: "4".repeat(64), centerXFraction: .61, centerYFraction: .60, rotationDegrees: 5.4, coverageFraction: .47, safetyMarginFraction: .071, superseded: false }] : []),
  ];
  const phase: AiGraderCalibrationConsolePhase = pass ? "finalized_pass" : failed ? "analysis_failed" : "checkerboard_poses";
  const actionReason = "Mocked browser evidence only; no hardware or hosted mutation is performed.";
  return {
    source: "mocked_test_data",
    contractVersion: "mock-v1.2-console",
    sessionId: "mock-calibration-session-20260721-01",
    sessionRevision: "mock-revision-18",
    eventHeadSha256: "a".repeat(64),
    previewBinding: {
      sessionId: "mock-calibration-session-20260721-01",
      side: "front",
      sideEpoch: "mock-calibration-preview-epoch-18",
    },
    phase,
    title: pass ? "Calibration ready for explicit activation" : failed ? "Analysis failed — new attempt required" : "Pose 4 of 4",
    summary: pass
      ? "The mocked bundle passed every exact calibration and twelve-member bundle gate. Activation still requires a fresh human-admin action."
      : failed
        ? "The mocked analysis rejected evidence. Accepted evidence is preserved, thresholds are immutable, and activation is unavailable."
        : "Move the checkerboard toward the lower-right while maintaining the full contour and safety margin.",
    ...(failed ? { hardFailure: "Exact PASS was not reached: X diversity span is below the frozen minimum." } : {}),
    currentPoseNumber: 4,
    currentPose: {
      valid: true,
      reasons: [],
      exactTargetContour: [{ x: 490, y: 210 }, { x: 1860, y: 260 }, { x: 1810, y: 1790 }, { x: 450, y: 1740 }],
      centerXFraction: .58,
      centerYFraction: .59,
      rotationDegrees: 5.1,
      coverageFraction: .47,
      safetyMarginFraction: .071,
    },
    aggregateDiversity: {
      xSpan: failed ? .071 : pass ? .20 : .18,
      ySpan: .19,
      rotationSpanDegrees: 10.2,
      minimumXSpan: .08,
      minimumYSpan: .08,
      minimumRotationSpanDegrees: 2,
      exactFinalGateSatisfied: pass,
    },
    movementGuidance: pass
      ? ["All four pose diversity spans meet the exact final gate."]
      : failed
        ? ["This attempt cannot be repaired by changing thresholds.", "Start a new calibration attempt and use a wider left-to-right pose span."]
        : ["Move the target lower and right.", "Keep every contour point outside the dashed safety boundary.", "Rotate clockwise by roughly 4–6°."],
    acceptedPoses,
    failedAttempts: failed ? [{ attemptLabel: "Analysis attempt", failedAt: "2026-07-21T14:12:33.000Z", stepLabel: "Analyze", message: "X span 0.071000 is below exact minimum 0.080000." }] : [{ attemptLabel: "Pose 4 attempt 1", failedAt: "2026-07-21T14:05:01.000Z", stepLabel: "Capture Current Pose", poseNumber: 4, message: "Outer contour entered the unsafe frame margin; pose 4 remains current." }],
    automaticSweep: {
      acceptedFrames: pass || failed ? 72 : 0,
      requiredFrames: 72,
      currentLabel: pass || failed ? "72 / 72 complete; safe-off verified" : "Waiting for blank-reverse flip",
      resumed: false,
    },
    analysis: failed
      ? { status: "fail", exactPass: false, summary: "FAIL — evidence remains preserved and immutable.", issues: ["X diversity span below exact minimum."] }
      : pass
        ? { status: "pass", exactPass: true, summary: "PASS — all exact analysis gates satisfied.", issues: [] }
        : { status: "not_started", exactPass: false, summary: "Available only after four accepted poses and the automatic sweep.", issues: [] },
    finalization: pass
      ? { status: "pass", exactPass: true, bundleSha256: "b".repeat(64), runtimeContextSha256: "c".repeat(64), rigCharacterizationSha256: "d".repeat(64), memberLedgerSha256: "e".repeat(64), memberCount: 12, summary: "Exact twelve-member bundle finalized and hash-bound." }
      : { status: "not_started", exactPass: false, summary: "No activation-eligible bundle was finalized." },
    calibrations: [
      {
        calibrationId: "cal-20260721-01",
        name: "Dell Station — July 21",
        location: "Ten Kings grading bench",
        lightingLabel: "Leimac fixed ring / controlled room",
        status: pass ? "eligible" : failed ? "failed" : "incomplete",
        ...(pass ? { bundleSha256: "b".repeat(64), runtimeContextSha256: "c".repeat(64), rigCharacterizationSha256: "d".repeat(64), finalizedAt: "2026-07-21T14:14:00.000Z" } : {}),
        gateSummary: pass ? "Exact PASS; twelve members; activation pending." : failed ? "FAIL; activation prohibited." : "Incomplete; pose 4 remains current.",
        eligibleForActivation: pass,
        active: false,
      },
      {
        calibrationId: "cal-20260701-active",
        name: "Historical eligible calibration",
        location: "Ten Kings grading bench",
        lightingLabel: "Leimac fixed ring / controlled room",
        status: "active",
        bundleSha256: "f".repeat(64),
        runtimeContextSha256: "0".repeat(64),
        rigCharacterizationSha256: "9".repeat(64),
        finalizedAt: "2026-07-01T18:30:00.000Z",
        activatedAt: "2026-07-01T18:45:00.000Z",
        gateSummary: "Historical exact PASS; currently active in mocked registry state.",
        eligibleForActivation: true,
        active: true,
      },
    ],
    actions: {
      start_new: authority(true, actionReason),
      resume: authority(!pass, actionReason),
      capture_current_pose: authority(!pass && !failed, actionReason),
      retry_current_pose: authority(!pass && !failed, actionReason),
      replace_selected_pose: authority(!pass && !failed, actionReason),
      confirm_blank_reverse_flip: authority(false, "Four accepted poses are required first."),
      begin_or_resume_automatic_sweep: authority(false, "Blank-reverse confirmation is required first."),
      analyze: authority(false, pass || failed ? "Analysis is complete." : "Automatic sweep is incomplete."),
      finalize: authority(false, pass ? "Finalization is complete." : "Exact analysis PASS is required."),
      activate: authority(pass, pass ? actionReason : "Activation requires exact PASS and a finalized twelve-member bundle."),
      reactivate: authority(true, actionReason),
      exit: authority(true, actionReason),
    },
  };
}
