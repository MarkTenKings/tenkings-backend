import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  FIXED_RIG_SELECTED_EXPOSURE_US,
  FIXED_RIG_SELECTED_GAIN,
  FIXED_RIG_SELECTED_LEIMAC_DUTY,
  FIXED_RIG_V1_EVIDENCE_CLASS,
  assertFixedRigOutputDirAllowed,
  buildFixedRigActiveLightingProfile,
  createFixedRigPackageDir,
  fixedRigActiveLightingProfilePath,
  type FixedRigActiveLightingProfile,
} from "./baslerFixedRigV1";

export const AI_GRADER_STATION_OPERATOR_WORKFLOW_VERSION = "ai-grader-station-operator-workflow-v0.1";
export const AI_GRADER_STATION_OPERATOR_WORKFLOW_CONFIRMATION = "RUN AI GRADER STATION OPERATOR WORKFLOW";

export type AiGraderStationWorkflowStateId =
  | "start_new_card"
  | "verify_fixture_rulers"
  | "live_preview_focus_framing"
  | "lighting_exposure_tune"
  | "accept_capture_profile"
  | "capture_front"
  | "prompt_flip_card"
  | "capture_back"
  | "run_provisional_diagnostics"
  | "view_unified_report"
  | "rerun_if_warnings"
  | "export_open_report"
  | "safe_off_end_session";

export interface AiGraderStationWorkflowState {
  id: AiGraderStationWorkflowStateId;
  label: string;
  operatorAction: string;
  primaryButton?: string;
  status: "pending" | "ready" | "blocked" | "completed";
  hardwareAccess: boolean;
  safeOffRequiredAfterState: boolean;
  warnings: string[];
}

export interface AiGraderLightingTuneMetrics {
  mean?: number;
  clippedFraction?: number;
  darkFraction?: number;
  sharpness?: number;
}

export interface AiGraderLightingTuneRecommendation {
  status: "ready" | "needs_tuning" | "accepted_with_warnings";
  thresholds: {
    clippedFractionWarn: number;
    darkFractionWarn: number;
    minSharpnessSoft: number;
    maxDutyPercent: 5;
  };
  currentProfile: FixedRigActiveLightingProfile;
  requestedExposureUs: number;
  requestedGain: number;
  frontMetrics?: AiGraderLightingTuneMetrics;
  backMetrics?: AiGraderLightingTuneMetrics;
  recommendedProfile: {
    selectedDutyPercent: number;
    actualLeimacPwmStep: number;
    exposureUs: number;
    gain: number;
    selectedChannels: number[];
    reason: string;
  };
  operatorMustExplicitlyAcceptWarnings: boolean;
  warnings: string[];
}

export interface AiGraderStationDiagnosticElementRule {
  element: "centering" | "corners" | "edges" | "surface";
  status: "provisional_diagnostic" | "insufficient_evidence";
  score?: number;
  confidence: "low" | "medium" | "not_computed";
  primaryMetrics: string[];
  warnings: string[];
  evidenceReferences: string[];
  explanation: string;
}

export interface AiGraderStationDiagnosticRulesV0 {
  rulesetId: "fixed_rig_provisional_diagnostic_rules_v0";
  finalGradeComputed: false;
  certificateGenerated: false;
  certifiedClaim: false;
  elements: AiGraderStationDiagnosticElementRule[];
  gating: {
    rulerCalibrationRequired: true;
    framingOverlayPassRequired: true;
    repeatabilityRequired: true;
    clippingFocusWarningsReduceConfidence: true;
    completeFrontBackEvidenceRequired: true;
  };
  warnings: string[];
}

export interface AiGraderStationIntegrationContract {
  contractVersion: "ai-grader-station-integration-contract-v0.1";
  gradingSessionId: string;
  cardAssetId?: string;
  reportId: string;
  reportStatus: "provisional_diagnostic_pending" | "provisional_diagnostic_ready" | "insufficient_evidence";
  provisionalStatus: "provisional_diagnostic";
  finalStatus: "not_computed";
  gradeFieldsReservedOnly: true;
  labelQrFieldsReservedOnly: true;
  labelGenerated: false;
  qrGenerated: false;
  certificateGenerated: false;
  reportStorage: {
    localOutputFolder?: string;
    reportHtmlPath?: string;
    manifestPath?: string;
  };
  evidenceReferences: {
    frontPackageDir?: string;
    backPackageDir?: string;
    unifiedReportDir?: string;
  };
  calibrationProfileReference?: string;
  note: string;
}

export interface AiGraderStationWorkflowManifest {
  packageId: string;
  packageDir?: string;
  manifestPath?: string;
  reportPath?: string;
  contractPath?: string;
  workflowVersion: typeof AI_GRADER_STATION_OPERATOR_WORKFLOW_VERSION;
  status: "planned" | "mock_completed" | "hardware_pending" | "blocked";
  session: {
    gradingSessionId: string;
    reportId: string;
    createdAt: string;
    operatorWorkflow: "fixed_rig_v1_station";
    currentState: AiGraderStationWorkflowStateId;
    nextAction: string;
  };
  acceptedLightingProfile: FixedRigActiveLightingProfile;
  calibrationProfile: {
    profileId?: string;
    referenceType: "fixed_metric_rulers";
    status: "required" | "operator_verified" | "not_supplied";
    isCalibrated: false;
    mmPerPixelX?: number;
    mmPerPixelY?: number;
  };
  tuneRecommendation: AiGraderLightingTuneRecommendation;
  states: AiGraderStationWorkflowState[];
  diagnostics: AiGraderStationDiagnosticRulesV0;
  reportOpenExport: {
    latestUnifiedReportPath?: string;
    outputFolder?: string;
    openReportAction: "available_when_report_exists" | "missing_report";
    missingReportHandling: string;
  };
  integrationContract: AiGraderStationIntegrationContract;
  hardwareAcceptance: {
    status: "pending_mark_present" | "not_run_software_only";
    requiredFlow: string[];
  };
  safety: {
    localOnly: true;
    hardwareAccessed: false;
    baslerContacted: false;
    leimacContacted: false;
    databaseWrites: false;
    migrationsRun: false;
    deployRun: false;
    persistentBaslerSaved: false;
    persistentLeimacSaved: false;
    highDutyLighting: false;
    capturedImagesCommitted: false;
    finalGradeComputed: false;
    certificateGenerated: false;
    certifiedClaim: false;
  };
  warnings: string[];
}

function roundDutyToPwmStep(dutyPercent: number): { dutyPercent: number; step: number } {
  const capped = Math.max(0, Math.min(5, dutyPercent));
  const step = Math.max(0, Math.min(50, Math.round(capped * 10)));
  return { dutyPercent: step / 10, step };
}

function buildStationStates(input: { mockRun?: boolean; reportPath?: string; warnings: string[] }): AiGraderStationWorkflowState[] {
  const completed = input.mockRun;
  const status = (hardwareAccess: boolean): AiGraderStationWorkflowState["status"] => {
    if (completed) return "completed";
    return hardwareAccess ? "blocked" : "ready";
  };
  return [
    ["start_new_card", "Start New Card", "Create a local fixed-rig grading session.", "Start", false],
    ["verify_fixture_rulers", "Verify Fixture/Rulers", "Confirm the fixed fixture and metric rulers are visible.", "Continue", true],
    ["live_preview_focus_framing", "Live Preview / Focus / Framing", "Use the Basler live preview to focus and align the card.", "Accept Profile", true],
    ["lighting_exposure_tune", "Lighting / Exposure Tune", "Tune low-duty Leimac brightness/exposure until clipping is acceptable or warnings are explicitly accepted.", "Accept Profile", true],
    ["accept_capture_profile", "Accept Capture Profile", "Lock the software active lighting profile for this card session.", "Accept Profile", false],
    ["capture_front", "Capture Front", "Capture front dark/all-on/accepted-profile/channel 1-8 evidence.", "Capture Front", true],
    ["prompt_flip_card", "Prompt Flip Card", "Pause only for the operator to flip the card.", "Continue After Flip", false],
    ["capture_back", "Capture Back", "Capture back dark/all-on/accepted-profile/channel 1-8 evidence.", "Capture Back", true],
    ["run_provisional_diagnostics", "Run Provisional Diagnostics", "Run provisional centering, corner, edge, and surface diagnostics.", "Run Diagnostics", false],
    ["view_unified_report", "View Unified Report", "Generate and open the unified front/back diagnostic report.", "Open Report", false],
    ["rerun_if_warnings", "Rerun If Warnings", "Rerun tuning or capture when clipping/framing/focus warnings are not acceptable.", "Rerun", false],
    ["export_open_report", "Export/Open Report", "Show report folder, HTML path, and artifact summary.", "Open Report", false],
    ["safe_off_end_session", "Safe Off / End Session", "Run safe-off after hardware use and close the session.", "End Session", true],
  ].map(([id, label, operatorAction, primaryButton, hardwareAccess]) => ({
    id: id as AiGraderStationWorkflowStateId,
    label: label as string,
    operatorAction: operatorAction as string,
    primaryButton: primaryButton as string,
    status: status(Boolean(hardwareAccess)),
    hardwareAccess: Boolean(hardwareAccess),
    safeOffRequiredAfterState: Boolean(hardwareAccess),
    warnings: Boolean(hardwareAccess) && !completed ? ["Hardware action pending until Mark is physically present."] : [],
  }));
}

export function buildAiGraderLightingTuneRecommendation(input: {
  profile?: FixedRigActiveLightingProfile;
  exposureUs?: number;
  gain?: number;
  frontMetrics?: AiGraderLightingTuneMetrics;
  backMetrics?: AiGraderLightingTuneMetrics;
  operatorAcceptedWarnings?: boolean;
}): AiGraderLightingTuneRecommendation {
  const profile = input.profile ?? buildFixedRigActiveLightingProfile({ profileSource: "default" });
  const clippedWarn = 0.02;
  const darkWarn = 0.35;
  const minSharpness = 100;
  const clippedValues = [input.frontMetrics?.clippedFraction, input.backMetrics?.clippedFraction].filter((value): value is number => Number.isFinite(value));
  const maxClipped = clippedValues.length ? Math.max(...clippedValues) : 0;
  const warnings: string[] = [];
  if (maxClipped > clippedWarn) {
    warnings.push(`Clipping exceeds ${clippedWarn}; lower preview duty and/or exposure before relying on diagnostics.`);
  }
  for (const [side, metrics] of [["front", input.frontMetrics], ["back", input.backMetrics]] as const) {
    if (metrics?.darkFraction !== undefined && metrics.darkFraction > darkWarn) warnings.push(`${side} dark fraction is high.`);
    if (metrics?.sharpness !== undefined && metrics.sharpness < minSharpness) warnings.push(`${side} sharpness is below the soft focus threshold.`);
  }
  const reductionRatio = maxClipped > clippedWarn ? Math.max(0.35, clippedWarn / maxClipped) : 1;
  const rounded = roundDutyToPwmStep(profile.selectedDutyPercent * reductionRatio);
  const status = warnings.length === 0 ? "ready" : input.operatorAcceptedWarnings ? "accepted_with_warnings" : "needs_tuning";
  return {
    status,
    thresholds: {
      clippedFractionWarn: clippedWarn,
      darkFractionWarn: darkWarn,
      minSharpnessSoft: minSharpness,
      maxDutyPercent: 5,
    },
    currentProfile: profile,
    requestedExposureUs: input.exposureUs ?? FIXED_RIG_SELECTED_EXPOSURE_US,
    requestedGain: input.gain ?? FIXED_RIG_SELECTED_GAIN,
    frontMetrics: input.frontMetrics,
    backMetrics: input.backMetrics,
    recommendedProfile: {
      selectedDutyPercent: rounded.dutyPercent,
      actualLeimacPwmStep: rounded.step,
      exposureUs: input.exposureUs ?? FIXED_RIG_SELECTED_EXPOSURE_US,
      gain: input.gain ?? FIXED_RIG_SELECTED_GAIN,
      selectedChannels: profile.selectedChannels,
      reason: warnings.length === 0 ? "Current profile is within PR #41 soft thresholds." : "Duty recommendation is scaled from the worst clipped side and rounded to the Leimac 0.1% PWM step.",
    },
    operatorMustExplicitlyAcceptWarnings: warnings.length > 0,
    warnings,
  };
}

export function buildAiGraderStationDiagnosticRulesV0(input: {
  calibrationProfilePresent?: boolean;
  framingOverlayPass?: boolean;
  repeatabilityPass?: boolean;
  frontEvidenceComplete?: boolean;
  backEvidenceComplete?: boolean;
  clippingWarnings?: string[];
} = {}): AiGraderStationDiagnosticRulesV0 {
  const gatePass =
    input.calibrationProfilePresent === true &&
    input.framingOverlayPass === true &&
    input.repeatabilityPass === true &&
    input.frontEvidenceComplete === true &&
    input.backEvidenceComplete === true;
  const clippingWarnings = input.clippingWarnings ?? [];
  const status = gatePass ? "provisional_diagnostic" : "insufficient_evidence";
  const confidence = gatePass ? (clippingWarnings.length ? "low" : "medium") : "not_computed";
  const gateWarning = gatePass ? [] : ["Calibration, framing/overlay, repeatability, and complete front/back evidence are required before diagnostics are computed."];
  const makeRule = (
    element: AiGraderStationDiagnosticElementRule["element"],
    metrics: string[],
    explanation: string
  ): AiGraderStationDiagnosticElementRule => ({
    element,
    status,
    score: gatePass ? 0 : undefined,
    confidence,
    primaryMetrics: metrics,
    warnings: [...gateWarning, ...clippingWarnings],
    evidenceReferences: gatePass ? ["front evidence package", "back evidence package", "unified provisional report"] : [],
    explanation,
  });
  return {
    rulesetId: "fixed_rig_provisional_diagnostic_rules_v0",
    finalGradeComputed: false,
    certificateGenerated: false,
    certifiedClaim: false,
    elements: [
      makeRule("centering", ["ruler scale", "detected boundary", "left/right/top/bottom margins", "centering percentage"], "Centering uses fixed-ruler geometry and detected card boundary only."),
      makeRule("corners", ["corner ROI sharpness", "corner ROI contrast", "dark/clipped fractions", "high-frequency proxy"], "Corners use portrait ROI proxy metrics until calibrated grading is implemented."),
      makeRule("edges", ["edge ROI roughness proxy", "edge ROI contrast", "visible boundary completeness"], "Edges use portrait ROI proxy metrics and remain diagnostic only."),
      makeRule("surface", ["dark/all-on/channel 1-8 images", "glare/clipping mask", "surface anomaly proxy"], "Surface uses multi-light evidence and preliminary anomaly candidates only."),
    ],
    gating: {
      rulerCalibrationRequired: true,
      framingOverlayPassRequired: true,
      repeatabilityRequired: true,
      clippingFocusWarningsReduceConfidence: true,
      completeFrontBackEvidenceRequired: true,
    },
    warnings: [...gateWarning, ...clippingWarnings],
  };
}

export function buildAiGraderStationIntegrationContract(input: {
  gradingSessionId: string;
  reportId: string;
  packageDir?: string;
  reportPath?: string;
  manifestPath?: string;
  frontPackageDir?: string;
  backPackageDir?: string;
  calibrationProfileId?: string;
  reportReady?: boolean;
}): AiGraderStationIntegrationContract {
  return {
    contractVersion: "ai-grader-station-integration-contract-v0.1",
    gradingSessionId: input.gradingSessionId,
    reportId: input.reportId,
    reportStatus: input.reportReady ? "provisional_diagnostic_ready" : "provisional_diagnostic_pending",
    provisionalStatus: "provisional_diagnostic",
    finalStatus: "not_computed",
    gradeFieldsReservedOnly: true,
    labelQrFieldsReservedOnly: true,
    labelGenerated: false,
    qrGenerated: false,
    certificateGenerated: false,
    reportStorage: {
      localOutputFolder: input.packageDir,
      reportHtmlPath: input.reportPath,
      manifestPath: input.manifestPath,
    },
    evidenceReferences: {
      frontPackageDir: input.frontPackageDir,
      backPackageDir: input.backPackageDir,
      unifiedReportDir: input.packageDir,
    },
    calibrationProfileReference: input.calibrationProfileId,
    note: "Contract only; no database schema, DB write, final grade, QR label, or certificate is created in PR #41.",
  };
}

export function buildAiGraderStationWorkflowManifest(input: {
  packageId?: string;
  packageDir?: string;
  reportPath?: string;
  manifestPath?: string;
  contractPath?: string;
  mockRun?: boolean;
  gradingSessionId?: string;
  reportId?: string;
  acceptedLightingProfile?: FixedRigActiveLightingProfile;
  exposureUs?: number;
  gain?: number;
  frontMetrics?: AiGraderLightingTuneMetrics;
  backMetrics?: AiGraderLightingTuneMetrics;
  operatorAcceptedWarnings?: boolean;
  calibrationProfileId?: string;
  mmPerPixelX?: number;
  mmPerPixelY?: number;
  framingOverlayPass?: boolean;
  repeatabilityPass?: boolean;
  frontPackageDir?: string;
  backPackageDir?: string;
}): AiGraderStationWorkflowManifest {
  const createdAt = new Date().toISOString();
  const packageId = input.packageId ?? `ai-grader-station-${createdAt.replace(/[:.]/g, "")}`;
  const gradingSessionId = input.gradingSessionId ?? `${packageId}-session`;
  const reportId = input.reportId ?? `${packageId}-report`;
  const acceptedLightingProfile = input.acceptedLightingProfile ?? buildFixedRigActiveLightingProfile({
    selectedDutyPercent: FIXED_RIG_SELECTED_LEIMAC_DUTY,
    profileSource: "default",
  });
  const tuneRecommendation = buildAiGraderLightingTuneRecommendation({
    profile: acceptedLightingProfile,
    exposureUs: input.exposureUs,
    gain: input.gain,
    frontMetrics: input.frontMetrics,
    backMetrics: input.backMetrics,
    operatorAcceptedWarnings: input.operatorAcceptedWarnings,
  });
  const diagnostics = buildAiGraderStationDiagnosticRulesV0({
    calibrationProfilePresent: Boolean(input.calibrationProfileId),
    framingOverlayPass: input.framingOverlayPass,
    repeatabilityPass: input.repeatabilityPass,
    frontEvidenceComplete: Boolean(input.frontPackageDir),
    backEvidenceComplete: Boolean(input.backPackageDir),
    clippingWarnings: tuneRecommendation.warnings,
  });
  const warnings = [
    ...tuneRecommendation.warnings,
    ...diagnostics.warnings,
    "Hardware smoke is pending until Mark is physically present.",
    "Provisional diagnostic only; no final grade, label, QR, certificate, or certified claim.",
  ];
  const integrationContract = buildAiGraderStationIntegrationContract({
    gradingSessionId,
    reportId,
    packageDir: input.packageDir,
    reportPath: input.reportPath,
    manifestPath: input.manifestPath,
    frontPackageDir: input.frontPackageDir,
    backPackageDir: input.backPackageDir,
    calibrationProfileId: input.calibrationProfileId,
    reportReady: Boolean(input.reportPath),
  });
  return {
    packageId,
    packageDir: input.packageDir,
    manifestPath: input.manifestPath,
    reportPath: input.reportPath,
    contractPath: input.contractPath,
    workflowVersion: AI_GRADER_STATION_OPERATOR_WORKFLOW_VERSION,
    status: input.mockRun ? "mock_completed" : "hardware_pending",
    session: {
      gradingSessionId,
      reportId,
      createdAt,
      operatorWorkflow: "fixed_rig_v1_station",
      currentState: input.mockRun ? "view_unified_report" : "start_new_card",
      nextAction: input.mockRun ? "Review generated software-only station report; hardware acceptance remains pending." : "Launch station workflow with Mark present for live preview and supervised capture.",
    },
    acceptedLightingProfile,
    calibrationProfile: {
      profileId: input.calibrationProfileId,
      referenceType: "fixed_metric_rulers",
      status: input.calibrationProfileId ? "operator_verified" : "required",
      isCalibrated: false,
      mmPerPixelX: input.mmPerPixelX,
      mmPerPixelY: input.mmPerPixelY,
    },
    tuneRecommendation,
    states: buildStationStates({ mockRun: input.mockRun, reportPath: input.reportPath, warnings }),
    diagnostics,
    reportOpenExport: {
      latestUnifiedReportPath: input.reportPath,
      outputFolder: input.packageDir,
      openReportAction: input.reportPath ? "available_when_report_exists" : "missing_report",
      missingReportHandling: "Station UI must show a clear missing-report state and keep Run Diagnostics / Generate Report as the next action.",
    },
    integrationContract,
    hardwareAcceptance: {
      status: "pending_mark_present",
      requiredFlow: [
        "Launch AI Grader Station workflow.",
        "Verify fixture and rulers visible.",
        "Tune lighting/exposure to reduce clipping.",
        "Accept profile.",
        "Capture front.",
        "Prompt Mark to flip.",
        "Capture back.",
        "Run provisional diagnostics.",
        "Generate/open unified report.",
        "Safe-off and confirm physical ring light is off.",
      ],
    },
    safety: {
      localOnly: true,
      hardwareAccessed: false,
      baslerContacted: false,
      leimacContacted: false,
      databaseWrites: false,
      migrationsRun: false,
      deployRun: false,
      persistentBaslerSaved: false,
      persistentLeimacSaved: false,
      highDutyLighting: false,
      capturedImagesCommitted: false,
      finalGradeComputed: false,
      certificateGenerated: false,
      certifiedClaim: false,
    },
    warnings,
  };
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stateRows(states: AiGraderStationWorkflowState[]): string {
  return states.map((state) => `<tr><td>${escapeHtml(state.label)}</td><td>${escapeHtml(state.status)}</td><td>${escapeHtml(state.operatorAction)}</td><td>${escapeHtml(state.primaryButton ?? "")}</td><td>${escapeHtml(state.hardwareAccess)}</td></tr>`).join("");
}

function diagnosticCards(rules: AiGraderStationDiagnosticRulesV0): string {
  return rules.elements.map((rule) => `<section class="card"><h3>${escapeHtml(rule.element)}</h3><strong>${escapeHtml(rule.status)}</strong><p>Confidence: ${escapeHtml(rule.confidence)}</p><p>${escapeHtml(rule.explanation)}</p><p>${escapeHtml(rule.warnings.join(" "))}</p></section>`).join("");
}

export function renderAiGraderStationWorkflowReport(manifest: AiGraderStationWorkflowManifest): string {
  const clippingWarning = manifest.tuneRecommendation.warnings.find((warning) => /clipping/i.test(warning)) ?? "No clipping warning in supplied metrics.";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Ten Kings AI Grader Station - Provisional Workflow</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; color: #191919; background: #f5f5f1; }
    main { max-width: 1180px; margin: 0 auto; padding: 28px; }
    .hero { background: #fff; border: 1px solid #d6d1c7; padding: 24px; display: grid; grid-template-columns: 1.2fr .8fr; gap: 20px; }
    .badge { display: inline-block; border: 1px solid #8d1f1f; color: #8d1f1f; padding: 5px 8px; font-weight: 700; }
    .grade { font-size: 34px; font-weight: 800; margin: 18px 0 8px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 14px; margin: 18px 0; }
    .card { background: #fff; border: 1px solid #d6d1c7; padding: 14px; }
    table { border-collapse: collapse; width: 100%; background: #fff; }
    th, td { border: 1px solid #d6d1c7; padding: 7px 8px; text-align: left; vertical-align: top; }
    .warn { border-left: 4px solid #8d1f1f; background: #fff; padding: 10px 12px; }
  </style>
</head>
<body><main>
  <header class="hero">
    <section>
      <h1>Ten Kings AI Grader Station</h1>
      <span class="badge">Provisional Diagnostic - Not Certified - No Final Grade</span>
      <div class="grade">Diagnostic Grade Pending</div>
      <p>Session ${escapeHtml(manifest.session.gradingSessionId)}. ${escapeHtml(manifest.session.nextAction)}</p>
    </section>
    <section>
      <h2>Current Profile</h2>
      <p>Duty ${escapeHtml(manifest.acceptedLightingProfile.selectedDutyPercent)}% / PWM ${escapeHtml(manifest.acceptedLightingProfile.actualLeimacPwmStep)}, exposure ${escapeHtml(manifest.tuneRecommendation.requestedExposureUs)} us, gain ${escapeHtml(manifest.tuneRecommendation.requestedGain)}, channels ${escapeHtml(manifest.acceptedLightingProfile.selectedChannels.join(","))}.</p>
      <p class="warn">${escapeHtml(clippingWarning)}</p>
    </section>
  </header>
  <section class="grid">
    <section class="card"><h2>Next Action</h2><p>${escapeHtml(manifest.session.nextAction)}</p></section>
    <section class="card"><h2>Fixture/Rulers</h2><p>${escapeHtml(manifest.calibrationProfile.status)}; isCalibrated=false.</p></section>
    <section class="card"><h2>Report</h2><p>${escapeHtml(manifest.reportOpenExport.latestUnifiedReportPath ?? "Missing until diagnostics generate a report.")}</p></section>
  </section>
  <h2>Operator Workflow</h2>
  <table><thead><tr><th>State</th><th>Status</th><th>Operator action</th><th>Button</th><th>Hardware</th></tr></thead><tbody>${stateRows(manifest.states)}</tbody></table>
  <h2>Lighting / Exposure Tune</h2>
  <table><tbody>
    <tr><th>Status</th><td>${escapeHtml(manifest.tuneRecommendation.status)}</td></tr>
    <tr><th>Recommended duty</th><td>${escapeHtml(manifest.tuneRecommendation.recommendedProfile.selectedDutyPercent)}% / PWM ${escapeHtml(manifest.tuneRecommendation.recommendedProfile.actualLeimacPwmStep)}</td></tr>
    <tr><th>Reason</th><td>${escapeHtml(manifest.tuneRecommendation.recommendedProfile.reason)}</td></tr>
    <tr><th>Warnings</th><td>${escapeHtml(manifest.tuneRecommendation.warnings.join("; ") || "none")}</td></tr>
  </tbody></table>
  <h2>Provisional Diagnostic Rules V0</h2>
  <div class="grid">${diagnosticCards(manifest.diagnostics)}</div>
  <h2>Future Integration Contract</h2>
  <table><tbody>
    <tr><th>Report status</th><td>${escapeHtml(manifest.integrationContract.reportStatus)}</td></tr>
    <tr><th>Final status</th><td>${escapeHtml(manifest.integrationContract.finalStatus)}</td></tr>
    <tr><th>Label/QR generated</th><td>${escapeHtml(manifest.integrationContract.labelGenerated)} / ${escapeHtml(manifest.integrationContract.qrGenerated)}</td></tr>
    <tr><th>Certificate generated</th><td>${escapeHtml(manifest.integrationContract.certificateGenerated)}</td></tr>
  </tbody></table>
  <h2>Guardrails</h2>
  <p>No hardware, DB, migration, deploy, persistent device save, high-duty lighting, final grade, certificate, or certified claim was performed by this software-only station report.</p>
</main></body></html>
`;
}

export async function writeAiGraderStationWorkflowArtifacts(input: {
  outputDir: string;
  mockRun?: boolean;
  gradingSessionId?: string;
  acceptedDutyPercent?: number;
  exposureUs?: number;
  gain?: number;
  frontClippedFraction?: number;
  backClippedFraction?: number;
  operatorAcceptedWarnings?: boolean;
  calibrationProfileId?: string;
  mmPerPixelX?: number;
  mmPerPixelY?: number;
  framingOverlayPass?: boolean;
  repeatabilityPass?: boolean;
  frontPackageDir?: string;
  backPackageDir?: string;
}): Promise<AiGraderStationWorkflowManifest> {
  assertFixedRigOutputDirAllowed(input.outputDir);
  const { packageId, packageDir } = await createFixedRigPackageDir(input.outputDir, "ai-grader-station-operator-workflow");
  const manifestPath = path.join(packageDir, "manifest.json");
  const reportPath = path.join(packageDir, "station-report.html");
  const contractPath = path.join(packageDir, "integration-contract.json");
  const profile = buildFixedRigActiveLightingProfile({
    selectedDutyPercent: input.acceptedDutyPercent ?? FIXED_RIG_SELECTED_LEIMAC_DUTY,
    profileSource: "operator_preview",
  });
  const manifest = buildAiGraderStationWorkflowManifest({
    packageId,
    packageDir,
    reportPath,
    manifestPath,
    contractPath,
    mockRun: input.mockRun,
    gradingSessionId: input.gradingSessionId,
    acceptedLightingProfile: profile,
    exposureUs: input.exposureUs,
    gain: input.gain,
    frontMetrics: input.frontClippedFraction === undefined ? undefined : { clippedFraction: input.frontClippedFraction },
    backMetrics: input.backClippedFraction === undefined ? undefined : { clippedFraction: input.backClippedFraction },
    operatorAcceptedWarnings: input.operatorAcceptedWarnings,
    calibrationProfileId: input.calibrationProfileId,
    mmPerPixelX: input.mmPerPixelX,
    mmPerPixelY: input.mmPerPixelY,
    framingOverlayPass: input.framingOverlayPass,
    repeatabilityPass: input.repeatabilityPass,
    frontPackageDir: input.frontPackageDir,
    backPackageDir: input.backPackageDir,
  });
  await mkdir(packageDir, { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
  await writeFile(contractPath, `${JSON.stringify(manifest.integrationContract, null, 2)}\n`, "utf-8");
  await writeFile(reportPath, renderAiGraderStationWorkflowReport(manifest), "utf-8");
  await writeFile(fixedRigActiveLightingProfilePath(packageDir), `${JSON.stringify(profile, null, 2)}\n`, "utf-8");
  return {
    ...manifest,
    manifestPath,
    reportPath,
    contractPath,
    reportOpenExport: {
      ...manifest.reportOpenExport,
      latestUnifiedReportPath: reportPath,
      outputFolder: packageDir,
      openReportAction: "available_when_report_exists",
    },
  };
}
