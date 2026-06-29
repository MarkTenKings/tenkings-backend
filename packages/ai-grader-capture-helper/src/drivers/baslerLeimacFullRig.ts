import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BaslerCaptureStillResult, BaslerLine2ExposureActiveResult, BaslerLine2StatusResult } from "./baslerPylonClient";
import {
  type BaslerLeimacImageStatSyncSmokeManifest,
  type BaslerLeimacImageStats,
  type BaslerLeimacPolarityCandidate,
  assertBaslerLeimacSyncSmokeOutputDirAllowed,
  buildBaslerLeimacImageStatSyncSmokeManifest,
  buildBaslerLeimacPolaritySmokePlan,
} from "./baslerLeimacSync";
import type {
  LeimacIdmuCommandResult,
  LeimacIdmuSettingReadbackResult,
  LeimacIdmuTriggerProfileApplyResult,
  LeimacIdmuTriggerProfilePlan,
} from "./leimacIdmuClient";
import type { DinoLiteBridgeOperatorWorkflowResult } from "./dinoliteBridgeClient";

export const BASLER_LEIMAC_MACRO_PACKAGE_CONFIRMATION = "RUN BASLER LEIMAC MACRO PACKAGE";
export const AI_GRADER_FULL_RIG_LOCAL_SMOKE_CONFIRMATION = "RUN AI GRADER FULL RIG LOCAL SMOKE";
export const ACCEPTED_BASLER_LEIMAC_PROFILE_ID = "line2-inverter-level-low";
export const ACCEPTED_BASLER_LEIMAC_LIGHTING_PROFILE_ID = "line2-inverter-level-low-v0";

export interface BaslerLeimacMacroPackageManifest extends BaslerLeimacImageStatSyncSmokeManifest {
  packageId: string;
  packageDir: string;
  manifestPath?: string;
  previewReportPath?: string;
  lightingProfileId: typeof ACCEPTED_BASLER_LEIMAC_LIGHTING_PROFILE_ID;
  macroEvidence: {
    role: "macro_overview";
    preferredFor: Array<"centering" | "overview">;
    detailEvidenceSource: "dinolite";
    routingStatus: "available_for_future_scorer_routing";
  };
}

export interface FullRigLocalSmokeManifest {
  packageId: string;
  packageDir: string;
  manifestPath?: string;
  previewReportPath?: string;
  status: "planned" | "completed" | "aborted";
  baslerMacro: {
    manifest: BaslerLeimacMacroPackageManifest;
  };
  dinoliteDetail?: {
    plan: "experimental-card-grading";
    workflow: DinoLiteBridgeOperatorWorkflowResult;
    analysis?: unknown;
    evidenceRole: "detail_corners_edges_surface";
  };
  analysisRouting: {
    macroOverviewSource: "basler_leimac";
    detailSource: "dinolite";
    centeringInput: "basler_preferred_not_routed_to_score_v0";
    scoringStatus: "existing_dinolite_experimental_analysis_preserved" | "not_computed";
    note: string;
  };
  calibration: {
    isCalibrated: false;
    evidenceClass: "full_rig_local_smoke_uncalibrated";
  };
  safety: {
    localOnly: true;
    offlineOnly: true;
    productionUpload: false;
    databaseWrites: false;
    persistentBaslerSaved: false;
    persistentLeimacSaved: false;
    finalLightOffConfirmedByMark: boolean;
  };
  note: string;
}

export function acceptedBaslerLeimacPolarityCandidate(): BaslerLeimacPolarityCandidate {
  return buildBaslerLeimacPolaritySmokePlan({
    candidateId: ACCEPTED_BASLER_LEIMAC_PROFILE_ID,
    dutyPercent: 5,
  }).selectedCandidate as BaslerLeimacPolarityCandidate;
}

export function assertFullRigOutputDirAllowed(outputDir: string, repoRoot = process.cwd()): string {
  return assertBaslerLeimacSyncSmokeOutputDirAllowed(outputDir, repoRoot);
}

export function buildBaslerLeimacMacroPackageManifest(input: {
  status: "planned" | "captured" | "aborted";
  packageId: string;
  packageDir: string;
  leimacHost: string;
  leimacPort: number;
  candidate?: BaslerLeimacPolarityCandidate;
  leimacProfilePlan?: LeimacIdmuTriggerProfilePlan;
  leimacProfile?: LeimacIdmuTriggerProfileApplyResult;
  unitInfo?: LeimacIdmuCommandResult;
  settingReadbacks?: LeimacIdmuSettingReadbackResult[];
  baslerLine2?: BaslerLine2ExposureActiveResult;
  baslerLine2Status?: BaslerLine2StatusResult;
  requestedExposureUs: number;
  dutyPercent: number;
  darkControl?: { capture: BaslerCaptureStillResult; stats: BaslerLeimacImageStats };
  synced?: { capture: BaslerCaptureStillResult; stats: BaslerLeimacImageStats };
  supervised: boolean;
  safeOffBefore: boolean;
  safeOffAfter: boolean;
  finalLightOffConfirmedByMark?: boolean;
  manifestPath?: string;
  previewReportPath?: string;
}): BaslerLeimacMacroPackageManifest {
  const candidate = input.candidate ?? acceptedBaslerLeimacPolarityCandidate();
  const base = buildBaslerLeimacImageStatSyncSmokeManifest({
    status: input.status,
    candidate,
    leimacHost: input.leimacHost,
    leimacPort: input.leimacPort,
    leimacProfilePlan: input.leimacProfilePlan,
    leimacProfile: input.leimacProfile,
    unitInfo: input.unitInfo,
    settingReadbacks: input.settingReadbacks,
    baslerLine2: input.baslerLine2,
    baslerLine2Status: input.baslerLine2Status,
    requestedExposureUs: input.requestedExposureUs,
    dutyPercent: input.dutyPercent,
    darkControl: input.darkControl,
    synced: input.synced,
    supervised: input.supervised,
    safeOffBefore: input.safeOffBefore,
    safeOffAfter: input.safeOffAfter,
    finalLightOffConfirmedByMark: input.finalLightOffConfirmedByMark,
  });
  return {
    ...base,
    packageId: input.packageId,
    packageDir: input.packageDir,
    ...(input.manifestPath ? { manifestPath: input.manifestPath } : {}),
    ...(input.previewReportPath ? { previewReportPath: input.previewReportPath } : {}),
    lightingProfileId: ACCEPTED_BASLER_LEIMAC_LIGHTING_PROFILE_ID,
    macroEvidence: {
      role: "macro_overview",
      preferredFor: ["centering", "overview"],
      detailEvidenceSource: "dinolite",
      routingStatus: "available_for_future_scorer_routing",
    },
    note:
      "Local uncalibrated Basler/Leimac macro package only; not calibrated production macro evidence, not a final grade, not a certificate, and not certified grading.",
  };
}

export function buildFullRigLocalSmokeManifest(input: {
  packageId: string;
  packageDir: string;
  status: FullRigLocalSmokeManifest["status"];
  baslerMacro: BaslerLeimacMacroPackageManifest;
  dinoliteWorkflow?: DinoLiteBridgeOperatorWorkflowResult;
  dinoliteAnalysis?: unknown;
  finalLightOffConfirmedByMark?: boolean;
  manifestPath?: string;
  previewReportPath?: string;
}): FullRigLocalSmokeManifest {
  return {
    packageId: input.packageId,
    packageDir: input.packageDir,
    ...(input.manifestPath ? { manifestPath: input.manifestPath } : {}),
    ...(input.previewReportPath ? { previewReportPath: input.previewReportPath } : {}),
    status: input.status,
    baslerMacro: {
      manifest: input.baslerMacro,
    },
    ...(input.dinoliteWorkflow
      ? {
          dinoliteDetail: {
            plan: "experimental-card-grading",
            workflow: input.dinoliteWorkflow,
            ...(input.dinoliteAnalysis ? { analysis: input.dinoliteAnalysis } : {}),
            evidenceRole: "detail_corners_edges_surface",
          },
        }
      : {}),
    analysisRouting: {
      macroOverviewSource: "basler_leimac",
      detailSource: "dinolite",
      centeringInput: "basler_preferred_not_routed_to_score_v0",
      scoringStatus: input.dinoliteAnalysis
        ? "existing_dinolite_experimental_analysis_preserved"
        : "not_computed",
      note:
        "Basler macro overview is recorded as preferred macro/centering evidence, but existing v0 experimental scoring is not rerouted unless a later tested scorer change proves the contract.",
    },
    calibration: {
      isCalibrated: false,
      evidenceClass: "full_rig_local_smoke_uncalibrated",
    },
    safety: {
      localOnly: true,
      offlineOnly: true,
      productionUpload: false,
      databaseWrites: false,
      persistentBaslerSaved: false,
      persistentLeimacSaved: false,
      finalLightOffConfirmedByMark: input.finalLightOffConfirmedByMark ?? false,
    },
    note:
      "Local/offline full-rig smoke package only; not calibrated macro evidence, not a final AI grade, not a certificate, and not certified grading.",
  };
}

export async function createLocalSmokePackageDir(parentOutputDir: string, prefix: string): Promise<{
  packageId: string;
  packageDir: string;
}> {
  const outputRoot = assertFullRigOutputDirAllowed(parentOutputDir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "").replace("Z", "Z");
  const packageId = `${prefix}-${timestamp}`;
  const packageDir = path.join(outputRoot, packageId);
  await mkdir(packageDir, { recursive: true });
  return { packageId, packageDir };
}

export async function writeMacroPackageArtifacts(manifest: BaslerLeimacMacroPackageManifest): Promise<BaslerLeimacMacroPackageManifest> {
  const manifestPath = path.join(manifest.packageDir, "manifest.json");
  const previewReportPath = path.join(manifest.packageDir, "preview-report.html");
  const withPaths = { ...manifest, manifestPath, previewReportPath };
  await writeJsonArtifact(manifestPath, withPaths);
  await writeFile(previewReportPath, renderMacroPackageReport(withPaths), "utf-8");
  return withPaths;
}

export async function writeFullRigArtifacts(manifest: FullRigLocalSmokeManifest): Promise<FullRigLocalSmokeManifest> {
  const manifestPath = path.join(manifest.packageDir, "manifest.json");
  const previewReportPath = path.join(manifest.packageDir, "preview-report.html");
  const withPaths = { ...manifest, manifestPath, previewReportPath };
  await writeJsonArtifact(manifestPath, withPaths);
  await writeFile(previewReportPath, renderFullRigReport(withPaths), "utf-8");
  return withPaths;
}

async function writeJsonArtifact(filePath: string, data: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function imageTag(filePath: string | undefined, alt: string): string {
  if (!filePath) return "<p>Not captured.</p>";
  return `<figure><img src="${escapeHtml(filePath)}" alt="${escapeHtml(alt)}"><figcaption>${escapeHtml(filePath)}</figcaption></figure>`;
}

function statsTable(stats: BaslerLeimacImageStats | undefined): string {
  if (!stats) return "<p>Stats not available.</p>";
  return `<table><tbody>
    <tr><th>Mean</th><td>${stats.mean}</td></tr>
    <tr><th>Min / Max</th><td>${stats.min} / ${stats.max}</td></tr>
    <tr><th>Non-zero fraction</th><td>${stats.nonZeroFraction}</td></tr>
    <tr><th>Bright fraction</th><td>${stats.brightFraction}</td></tr>
  </tbody></table>`;
}

export function renderMacroPackageReport(manifest: BaslerLeimacMacroPackageManifest): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Basler/Leimac Macro Package - Uncalibrated</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #171717; background: #f7f7f4; }
    main { max-width: 1180px; margin: 0 auto; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
    img { max-width: 100%; border: 1px solid #aaa; background: #111; }
    table { border-collapse: collapse; width: 100%; margin: 8px 0 16px; }
    th, td { border: 1px solid #bbb; padding: 6px 8px; text-align: left; }
    .warn { border-left: 4px solid #a33; padding: 8px 12px; background: #fff; }
  </style>
</head>
<body><main>
  <h1>Basler/Leimac Macro Package</h1>
  <p class="warn">Local uncalibrated smoke output only. This is not calibrated production macro evidence, not a final grade, not a certificate, and not certified grading.</p>
  <p><strong>Profile:</strong> ${escapeHtml(manifest.lightingProfileId)} | <strong>Status:</strong> ${escapeHtml(manifest.status)} | <strong>Materially brighter:</strong> ${escapeHtml(manifest.comparison?.materiallyBrighter)}</p>
  <div class="grid">
    <section><h2>Dark Control</h2>${imageTag(manifest.darkControl?.capture.outputFilePath, "Dark control macro")}${statsTable(manifest.darkControl?.stats)}</section>
    <section><h2>Synced Macro</h2>${imageTag(manifest.synced?.capture.outputFilePath, "Synced macro")}${statsTable(manifest.synced?.stats)}</section>
  </div>
  <h2>Comparison</h2>
  <table><tbody>
    <tr><th>Mean delta</th><td>${escapeHtml(manifest.comparison?.meanDelta)}</td></tr>
    <tr><th>Max delta</th><td>${escapeHtml(manifest.comparison?.maxDelta)}</td></tr>
    <tr><th>Selected polarity</th><td>${escapeHtml(manifest.selectedCandidate.id)}</td></tr>
    <tr><th>Exposure</th><td>${escapeHtml(manifest.requestedExposureUs)} us</td></tr>
    <tr><th>Duty</th><td>${escapeHtml(manifest.dutyPercent)}%</td></tr>
  </tbody></table>
</main></body></html>
`;
}

export function renderFullRigReport(manifest: FullRigLocalSmokeManifest): string {
  const macro = manifest.baslerMacro.manifest;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>AI Grader Full Rig Local Smoke - Uncalibrated</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #171717; background: #f7f7f4; }
    main { max-width: 1180px; margin: 0 auto; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
    img { max-width: 100%; border: 1px solid #aaa; background: #111; }
    table { border-collapse: collapse; width: 100%; margin: 8px 0 16px; }
    th, td { border: 1px solid #bbb; padding: 6px 8px; text-align: left; }
    .warn { border-left: 4px solid #a33; padding: 8px 12px; background: #fff; }
  </style>
</head>
<body><main>
  <h1>AI Grader Full Rig Local Smoke</h1>
  <p class="warn">Local/offline uncalibrated evidence package only. This is not a final AI grade, not a certificate, and not certified grading.</p>
  <h2>Basler Macro Evidence</h2>
  <div class="grid">
    <section><h3>Dark Control</h3>${imageTag(macro.darkControl?.capture.outputFilePath, "Dark control macro")}${statsTable(macro.darkControl?.stats)}</section>
    <section><h3>Synced Macro</h3>${imageTag(macro.synced?.capture.outputFilePath, "Synced macro")}${statsTable(macro.synced?.stats)}</section>
  </div>
  <h2>Dino-Lite Detail Evidence</h2>
  <table><tbody>
    <tr><th>Status</th><td>${escapeHtml(manifest.dinoliteDetail?.workflow.status ?? "not_run")}</td></tr>
    <tr><th>Plan</th><td>${escapeHtml(manifest.dinoliteDetail?.plan ?? "experimental-card-grading")}</td></tr>
    <tr><th>Session dir</th><td>${escapeHtml(manifest.dinoliteDetail?.workflow.sessionDir ?? "")}</td></tr>
    <tr><th>Preview report</th><td>${escapeHtml(manifest.dinoliteDetail?.workflow.previewReportPath ?? "")}</td></tr>
  </tbody></table>
  <h2>Analysis Routing</h2>
  <p>${escapeHtml(manifest.analysisRouting.note)}</p>
</main></body></html>
`;
}
