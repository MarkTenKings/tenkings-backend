import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { BaslerLeimacMacroPackageManifest } from "./baslerLeimacFullRig";
import { ACCEPTED_BASLER_LEIMAC_LIGHTING_PROFILE_ID } from "./baslerLeimacFullRig";
import { assertBaslerLeimacSyncSmokeOutputDirAllowed, type BaslerLeimacImageStats } from "./baslerLeimacSync";

export const BASLER_FIXED_RIG_FOCUS_ASSIST_CONFIRMATION = "RUN BASLER FIXED RIG FOCUS ASSIST";
export const AI_GRADER_FIXED_RIG_V1_CONFIRMATION = "RUN AI GRADER FIXED RIG V1 LOCAL";
export const FIXED_RIG_V1_EVIDENCE_CLASS = "macro_fixed_rig_v1_uncalibrated";

export type FixedRigCardSide = "front" | "back";

export interface FixedRigCardBoundary {
  status: "detected" | "not_computed";
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  coverage?: number;
  confidence: number;
  reason?: string;
}

export interface FixedRigRoiDefinition {
  id:
    | "top-left-corner"
    | "top-right-corner"
    | "bottom-right-corner"
    | "bottom-left-corner"
    | "top-edge"
    | "right-edge"
    | "bottom-edge"
    | "left-edge"
    | "center-surface"
    | "upper-surface"
    | "lower-surface";
  label: string;
  type: "corner" | "edge" | "surface";
  status: "computed" | "not_computed";
  rect?: { x: number; y: number; width: number; height: number };
  source: "approximate_detected_boundary" | "not_computed";
}

export interface FixedRigQualityMetrics extends BaslerLeimacImageStats {
  clippedPixelFraction: number;
  darkPixelFraction: number;
  sharpnessScore: number;
  cardBoundary: FixedRigCardBoundary;
  framing: {
    status: "acceptable_for_smoke" | "warning" | "not_computed";
    cardCoverageEstimate?: number;
    warnings: string[];
  };
  focus: {
    status: "manual_review" | "warning";
    sharpnessScore: number;
    recommendation: string;
  };
  warnings: string[];
}

export interface FixedRigLightingProfilePlan {
  dryRun: true;
  selectedLightingProfile: typeof ACCEPTED_BASLER_LEIMAC_LIGHTING_PROFILE_ID;
  channelMappingStatus: "not_calibrated";
  profiles: Array<{
    id: string;
    name: string;
    role: "dark_control" | "macro_overview" | "directional_candidate" | "surface_screening_candidate";
    applySupportedInPr38: false;
    plannedChannels: "unknown_pending_channel_mapping" | "all_channels";
    note: string;
  }>;
  safety: {
    writesApplied: false;
    lightsCommanded: false;
    persistentSaved: false;
    channelPhysicalMappingInvented: false;
  };
}

export interface FixedRigFocusAssistManifest {
  packageId: string;
  packageDir: string;
  manifestPath?: string;
  previewReportPath?: string;
  status: "planned" | "captured" | "aborted";
  selectedLightingProfile: typeof ACCEPTED_BASLER_LEIMAC_LIGHTING_PROFILE_ID;
  macroPackage?: BaslerLeimacMacroPackageManifest;
  quality?: FixedRigQualityMetrics;
  operatorGuidance: {
    manualFocusOnly: true;
    autofocusClaimed: false;
    guidance: string[];
  };
  calibration: {
    isCalibrated: false;
    evidenceClass: typeof FIXED_RIG_V1_EVIDENCE_CLASS;
  };
  safety: {
    localOnly: true;
    safeOffBefore: boolean;
    safeOffAfter: boolean;
    persistentBaslerSaved: false;
    persistentLeimacSaved: false;
    finalLightOffConfirmedByMark: boolean;
  };
  note: string;
}

export interface FixedRigSideCapture {
  side: FixedRigCardSide;
  instruction: string;
  macroPackage: BaslerLeimacMacroPackageManifest;
  quality: FixedRigQualityMetrics;
  roiDefinitions: FixedRigRoiDefinition[];
  analysis: {
    status: "computed" | "not_computed";
    materiallyBrighter: boolean;
    qualityWarnings: string[];
    boundaryStatus: FixedRigCardBoundary["status"];
    notComputedReason?: string;
  };
}

export interface FixedRigV1LocalManifest {
  packageId: string;
  packageDir: string;
  manifestPath?: string;
  analysisPath?: string;
  previewReportPath?: string;
  status: "planned" | "completed" | "aborted";
  selectedLightingProfile: typeof ACCEPTED_BASLER_LEIMAC_LIGHTING_PROFILE_ID;
  workflow: {
    mode: "fixed_overhead_basler_v1";
    humanSteps: string[];
    baslerRole: "primary_macro_overview_measurement_screening";
    dinoliteRole: "optional_manual_detail_confirmation";
    automationNotRequiredForV1: Array<"dobot" | "openbuilds" | "robotic_arm" | "dinolite_full_card_tiling">;
  };
  front?: FixedRigSideCapture;
  back?: FixedRigSideCapture;
  lightingProfilePlan: FixedRigLightingProfilePlan;
  followUpPlan: {
    status: "not_computed" | "computed";
    suggestedDinoLiteTargets: Array<{
      side: FixedRigCardSide;
      roiId: FixedRigRoiDefinition["id"];
      reason: string;
    }>;
    note: string;
  };
  calibration: {
    isCalibrated: false;
    evidenceClass: typeof FIXED_RIG_V1_EVIDENCE_CLASS;
    requiredNext: Array<"pixel_to_mm" | "lens_distortion" | "lighting_profile_calibration" | "repeatability">;
  };
  safety: {
    localOnly: true;
    offlineOnly: true;
    productionUpload: false;
    databaseWrites: false;
    persistentBaslerSaved: false;
    persistentLeimacSaved: false;
    safeOffBeforeFront: boolean;
    safeOffAfterFront: boolean;
    safeOffBeforeBack: boolean;
    safeOffAfterBack: boolean;
    finalLightOffConfirmedByMark: boolean;
  };
  warnings: string[];
  note: string;
}

function roundMetric(value: number, places = 4): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function assertFixedRigOutputDirAllowed(outputDir: string, repoRoot = process.cwd()): string {
  return assertBaslerLeimacSyncSmokeOutputDirAllowed(outputDir, repoRoot);
}

export async function createFixedRigPackageDir(parentOutputDir: string, prefix: string): Promise<{
  packageId: string;
  packageDir: string;
}> {
  const outputRoot = assertFixedRigOutputDirAllowed(parentOutputDir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "").replace("Z", "Z");
  const packageId = `${prefix}-${timestamp}`;
  const packageDir = path.join(outputRoot, packageId);
  await mkdir(packageDir, { recursive: true });
  return { packageId, packageDir };
}

export function buildFixedRigLightingProfilePlan(): FixedRigLightingProfilePlan {
  return {
    dryRun: true,
    selectedLightingProfile: ACCEPTED_BASLER_LEIMAC_LIGHTING_PROFILE_ID,
    channelMappingStatus: "not_calibrated",
    profiles: [
      {
        id: "dark-control-v0",
        name: "Dark control",
        role: "dark_control",
        applySupportedInPr38: false,
        plannedChannels: "unknown_pending_channel_mapping",
        note: "Capture with Leimac safe-off before synced macro evidence.",
      },
      {
        id: "line2-inverter-level-low-v0",
        name: "All-channel synced macro",
        role: "macro_overview",
        applySupportedInPr38: false,
        plannedChannels: "all_channels",
        note: "Accepted PR #36/PR #37 low-duty profile; currently the only applied profile in fixed-rig V1 smoke.",
      },
      {
        id: "directional-left-right-candidate-v0",
        name: "Left/right directional candidate",
        role: "directional_candidate",
        applySupportedInPr38: false,
        plannedChannels: "unknown_pending_channel_mapping",
        note: "Dry-run placeholder until Leimac channel-to-physical-segment mapping is calibrated.",
      },
      {
        id: "directional-top-bottom-candidate-v0",
        name: "Top/bottom directional candidate",
        role: "directional_candidate",
        applySupportedInPr38: false,
        plannedChannels: "unknown_pending_channel_mapping",
        note: "Dry-run placeholder until Leimac channel-to-physical-segment mapping is calibrated.",
      },
      {
        id: "surface-scratch-low-angle-candidate-v0",
        name: "Low-angle surface screening candidate",
        role: "surface_screening_candidate",
        applySupportedInPr38: false,
        plannedChannels: "unknown_pending_channel_mapping",
        note: "Dry-run placeholder; do not infer physical dome segments without measured channel mapping.",
      },
    ],
    safety: {
      writesApplied: false,
      lightsCommanded: false,
      persistentSaved: false,
      channelPhysicalMappingInvented: false,
    },
  };
}

export async function analyzeFixedRigMacroQuality(filePath: string): Promise<FixedRigQualityMetrics> {
  const { data, info } = await sharp(filePath).greyscale().raw().toBuffer({ resolveWithObject: true });
  const width = info.width ?? 0;
  const height = info.height ?? 0;
  const count = data.length || 1;
  let min = 255;
  let max = 0;
  let sum = 0;
  let nonZero = 0;
  let bright = 0;
  let clipped = 0;
  let dark = 0;
  const buckets = new Array<number>(8).fill(0);
  for (const value of data) {
    if (value < min) min = value;
    if (value > max) max = value;
    sum += value;
    if (value > 0) nonZero += 1;
    if (value >= 32) bright += 1;
    if (value >= 250) clipped += 1;
    if (value <= 8) dark += 1;
    buckets[Math.min(7, Math.floor(value / 32))] += 1;
  }
  const mean = sum / count;
  let gradientSum = 0;
  let gradientCount = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const left = data[y * width + x - 1] ?? 0;
      const right = data[y * width + x + 1] ?? 0;
      const up = data[(y - 1) * width + x] ?? 0;
      const down = data[(y + 1) * width + x] ?? 0;
      const gx = right - left;
      const gy = down - up;
      gradientSum += gx * gx + gy * gy;
      gradientCount += 1;
    }
  }
  const sharpnessScore = roundMetric(gradientSum / Math.max(1, gradientCount), 4);
  const threshold = Math.max(16, Math.min(96, mean * 0.7));
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = data[y * width + x] ?? 0;
      if (value >= threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const boundaryWidth = maxX >= minX ? maxX - minX + 1 : 0;
  const boundaryHeight = maxY >= minY ? maxY - minY + 1 : 0;
  const coverage = boundaryWidth > 0 && boundaryHeight > 0 ? (boundaryWidth * boundaryHeight) / Math.max(1, width * height) : 0;
  const boundary: FixedRigCardBoundary =
    coverage > 0.05
      ? {
          status: "detected",
          x: minX,
          y: minY,
          width: boundaryWidth,
          height: boundaryHeight,
          coverage: roundMetric(coverage, 6),
          confidence: coverage >= 0.35 && coverage <= 0.95 ? 0.65 : 0.35,
        }
      : {
          status: "not_computed",
          confidence: 0,
          reason: "No reliable bright foreground boundary found in the uncalibrated macro image.",
        };
  const warnings: string[] = [];
  const clippedPixelFraction = clipped / count;
  const darkPixelFraction = dark / count;
  if (sharpnessScore < 20) warnings.push("Sharpness is low; manually adjust Basler focus/height and repeat focus assist.");
  if (mean < 15 || darkPixelFraction > 0.8) warnings.push("Image may be underexposed or mostly dark.");
  if (clippedPixelFraction > 0.02) warnings.push("Image has saturated/clipped pixels; reduce exposure, gain, or lighting duty in a later approved profile.");
  if (boundary.status !== "detected") warnings.push("Card boundary was not computed; ROI screening remains not_computed.");
  if (boundary.status === "detected" && (coverage < 0.35 || coverage > 0.95)) {
    warnings.push("Card coverage/framing is outside the preferred smoke range; adjust fixed tray/camera height before calibration.");
  }
  return {
    filePath,
    width,
    height,
    channels: info.channels ?? 1,
    min,
    max,
    mean: roundMetric(mean, 4),
    nonZeroFraction: roundMetric(nonZero / count, 6),
    brightFraction: roundMetric(bright / count, 6),
    histogram: buckets.map((bucketCount, index) => {
      const start = index * 32;
      const end = index === 7 ? 255 : start + 31;
      return {
        range: `${start}-${end}`,
        count: bucketCount,
        fraction: roundMetric(bucketCount / count, 6),
      };
    }),
    clippedPixelFraction: roundMetric(clippedPixelFraction, 6),
    darkPixelFraction: roundMetric(darkPixelFraction, 6),
    sharpnessScore,
    cardBoundary: boundary,
    framing: {
      status: boundary.status === "detected" && coverage >= 0.35 && coverage <= 0.95 ? "acceptable_for_smoke" : "warning",
      ...(boundary.status === "detected" ? { cardCoverageEstimate: roundMetric(coverage, 6) } : {}),
      warnings: warnings.filter((warning) => /boundary|coverage|framing|tray|height/i.test(warning)),
    },
    focus: {
      status: sharpnessScore < 20 ? "warning" : "manual_review",
      sharpnessScore,
      recommendation:
        "Manual focus assist only: repeat after mechanical focus/height changes and prefer the setting where sharpness improves then stabilizes.",
    },
    warnings,
  };
}

export function buildFixedRigRoiDefinitions(boundary: FixedRigCardBoundary): FixedRigRoiDefinition[] {
  const roiBase: Array<Omit<FixedRigRoiDefinition, "status" | "rect" | "source"> & {
    rectRatio: { x: number; y: number; width: number; height: number };
  }> = [
    { id: "top-left-corner", label: "Top-left corner", type: "corner", rectRatio: { x: 0, y: 0, width: 0.18, height: 0.18 } },
    { id: "top-right-corner", label: "Top-right corner", type: "corner", rectRatio: { x: 0.82, y: 0, width: 0.18, height: 0.18 } },
    { id: "bottom-right-corner", label: "Bottom-right corner", type: "corner", rectRatio: { x: 0.82, y: 0.82, width: 0.18, height: 0.18 } },
    { id: "bottom-left-corner", label: "Bottom-left corner", type: "corner", rectRatio: { x: 0, y: 0.82, width: 0.18, height: 0.18 } },
    { id: "top-edge", label: "Top edge", type: "edge", rectRatio: { x: 0.18, y: 0, width: 0.64, height: 0.12 } },
    { id: "right-edge", label: "Right edge", type: "edge", rectRatio: { x: 0.88, y: 0.18, width: 0.12, height: 0.64 } },
    { id: "bottom-edge", label: "Bottom edge", type: "edge", rectRatio: { x: 0.18, y: 0.88, width: 0.64, height: 0.12 } },
    { id: "left-edge", label: "Left edge", type: "edge", rectRatio: { x: 0, y: 0.18, width: 0.12, height: 0.64 } },
    { id: "center-surface", label: "Center surface", type: "surface", rectRatio: { x: 0.35, y: 0.35, width: 0.3, height: 0.3 } },
    { id: "upper-surface", label: "Upper surface", type: "surface", rectRatio: { x: 0.3, y: 0.18, width: 0.4, height: 0.22 } },
    { id: "lower-surface", label: "Lower surface", type: "surface", rectRatio: { x: 0.3, y: 0.6, width: 0.4, height: 0.22 } },
  ];
  if (boundary.status !== "detected" || boundary.x == null || boundary.y == null || !boundary.width || !boundary.height) {
    return roiBase.map(({ rectRatio: _rectRatio, ...roi }) => ({
      ...roi,
      status: "not_computed",
      source: "not_computed",
    }));
  }
  const boundaryX = boundary.x;
  const boundaryY = boundary.y;
  const boundaryWidth = boundary.width;
  const boundaryHeight = boundary.height;
  return roiBase.map(({ rectRatio, ...roi }) => ({
    ...roi,
    status: "computed",
    source: "approximate_detected_boundary",
    rect: {
      x: Math.round(boundaryX + boundaryWidth * rectRatio.x),
      y: Math.round(boundaryY + boundaryHeight * rectRatio.y),
      width: Math.round(boundaryWidth * rectRatio.width),
      height: Math.round(boundaryHeight * rectRatio.height),
    },
  }));
}

export function buildFixedRigFocusAssistManifest(input: {
  packageId: string;
  packageDir: string;
  status: FixedRigFocusAssistManifest["status"];
  macroPackage?: BaslerLeimacMacroPackageManifest;
  quality?: FixedRigQualityMetrics;
  safeOffBefore: boolean;
  safeOffAfter: boolean;
  finalLightOffConfirmedByMark?: boolean;
  manifestPath?: string;
  previewReportPath?: string;
}): FixedRigFocusAssistManifest {
  return {
    packageId: input.packageId,
    packageDir: input.packageDir,
    ...(input.manifestPath ? { manifestPath: input.manifestPath } : {}),
    ...(input.previewReportPath ? { previewReportPath: input.previewReportPath } : {}),
    status: input.status,
    selectedLightingProfile: ACCEPTED_BASLER_LEIMAC_LIGHTING_PROFILE_ID,
    ...(input.macroPackage ? { macroPackage: input.macroPackage } : {}),
    ...(input.quality ? { quality: input.quality } : {}),
    operatorGuidance: {
      manualFocusOnly: true,
      autofocusClaimed: false,
      guidance: [
        "This is manual focus assist, not autofocus.",
        "Repeat after focus/height adjustments and compare sharpnessScore; prefer the setting where sharpness improves then stabilizes.",
        "The card should fill most of the Basler frame while leaving a visible margin around all edges.",
        "Lock camera height, tray position, and focus after an acceptable setup before calibration work.",
      ],
    },
    calibration: {
      isCalibrated: false,
      evidenceClass: FIXED_RIG_V1_EVIDENCE_CLASS,
    },
    safety: {
      localOnly: true,
      safeOffBefore: input.safeOffBefore,
      safeOffAfter: input.safeOffAfter,
      persistentBaslerSaved: false,
      persistentLeimacSaved: false,
      finalLightOffConfirmedByMark: input.finalLightOffConfirmedByMark ?? false,
    },
    note:
      "Fixed-rig Basler focus/framing assist is local and uncalibrated; it is not autofocus, calibrated macro evidence, a final grade, a certificate, or certified grading.",
  };
}

export function buildFixedRigSideCapture(input: {
  side: FixedRigCardSide;
  macroPackage: BaslerLeimacMacroPackageManifest;
  quality: FixedRigQualityMetrics;
}): FixedRigSideCapture {
  const rois = buildFixedRigRoiDefinitions(input.quality.cardBoundary);
  const materiallyBrighter = input.macroPackage.comparison?.materiallyBrighter ?? false;
  const notComputedReason =
    input.quality.cardBoundary.status !== "detected"
      ? "Card boundary was not computed, so fixed-rig ROI analysis remains not_computed."
      : input.quality.warnings.length > 0
        ? "Quality warnings require operator review before scoring."
        : undefined;
  return {
    side: input.side,
    instruction:
      input.side === "front"
        ? "Place card face-up in the fixed tray/position before capture."
        : "Flip card to the back side in the same fixed tray/position before capture.",
    macroPackage: input.macroPackage,
    quality: input.quality,
    roiDefinitions: rois,
    analysis: {
      status: notComputedReason ? "not_computed" : "computed",
      materiallyBrighter,
      qualityWarnings: input.quality.warnings,
      boundaryStatus: input.quality.cardBoundary.status,
      ...(notComputedReason ? { notComputedReason } : {}),
    },
  };
}

export function buildFixedRigV1LocalManifest(input: {
  packageId: string;
  packageDir: string;
  status: FixedRigV1LocalManifest["status"];
  front?: FixedRigSideCapture;
  back?: FixedRigSideCapture;
  finalLightOffConfirmedByMark?: boolean;
  manifestPath?: string;
  analysisPath?: string;
  previewReportPath?: string;
}): FixedRigV1LocalManifest {
  const warnings = [
    ...(input.front?.quality.warnings.map((warning) => `front: ${warning}`) ?? []),
    ...(input.back?.quality.warnings.map((warning) => `back: ${warning}`) ?? []),
  ];
  return {
    packageId: input.packageId,
    packageDir: input.packageDir,
    ...(input.manifestPath ? { manifestPath: input.manifestPath } : {}),
    ...(input.analysisPath ? { analysisPath: input.analysisPath } : {}),
    ...(input.previewReportPath ? { previewReportPath: input.previewReportPath } : {}),
    status: input.status,
    selectedLightingProfile: ACCEPTED_BASLER_LEIMAC_LIGHTING_PROFILE_ID,
    workflow: {
      mode: "fixed_overhead_basler_v1",
      humanSteps: [
        "Place raw card face-up in fixed tray/position.",
        "Start fixed-rig V1 local workflow.",
        "Capture front Basler/Leimac dark control and synced macro.",
        "Flip card to back side in the same fixed tray/position.",
        "Capture back Basler/Leimac dark control and synced macro.",
        "Review macro quality and ROI screening output.",
        "Use Dino-Lite manually only for suggested or operator-requested close-up confirmation.",
      ],
      baslerRole: "primary_macro_overview_measurement_screening",
      dinoliteRole: "optional_manual_detail_confirmation",
      automationNotRequiredForV1: ["dobot", "openbuilds", "robotic_arm", "dinolite_full_card_tiling"],
    },
    ...(input.front ? { front: input.front } : {}),
    ...(input.back ? { back: input.back } : {}),
    lightingProfilePlan: buildFixedRigLightingProfilePlan(),
    followUpPlan: {
      status: "not_computed",
      suggestedDinoLiteTargets: [],
      note:
        "No suggested close-ups computed yet. PR #38 records ROI definitions and quality warnings only; no mature anomaly detector is allowed to fake defects.",
    },
    calibration: {
      isCalibrated: false,
      evidenceClass: FIXED_RIG_V1_EVIDENCE_CLASS,
      requiredNext: ["pixel_to_mm", "lens_distortion", "lighting_profile_calibration", "repeatability"],
    },
    safety: {
      localOnly: true,
      offlineOnly: true,
      productionUpload: false,
      databaseWrites: false,
      persistentBaslerSaved: false,
      persistentLeimacSaved: false,
      safeOffBeforeFront: input.front?.macroPackage.safety.safeOffBefore ?? false,
      safeOffAfterFront: input.front?.macroPackage.safety.safeOffAfter ?? false,
      safeOffBeforeBack: input.back?.macroPackage.safety.safeOffBefore ?? false,
      safeOffAfterBack: input.back?.macroPackage.safety.safeOffAfter ?? false,
      finalLightOffConfirmedByMark: input.finalLightOffConfirmedByMark ?? false,
    },
    warnings,
    note:
      "Fixed-rig V1 local workflow output is uncalibrated and offline only; it is not a final AI grade, not a certificate, and not certified grading.",
  };
}

export async function writeFixedRigFocusAssistArtifacts(
  manifest: FixedRigFocusAssistManifest
): Promise<FixedRigFocusAssistManifest> {
  const manifestPath = path.join(manifest.packageDir, "manifest.json");
  const previewReportPath = path.join(manifest.packageDir, "preview-report.html");
  const withPaths = { ...manifest, manifestPath, previewReportPath };
  await writeJsonArtifact(manifestPath, withPaths);
  await writeFile(previewReportPath, renderFixedRigFocusAssistReport(withPaths), "utf-8");
  return withPaths;
}

export async function writeFixedRigV1Artifacts(manifest: FixedRigV1LocalManifest): Promise<FixedRigV1LocalManifest> {
  const manifestPath = path.join(manifest.packageDir, "manifest.json");
  const analysisPath = path.join(manifest.packageDir, "analysis.json");
  const previewReportPath = path.join(manifest.packageDir, "preview-report.html");
  const withPaths = { ...manifest, manifestPath, analysisPath, previewReportPath };
  await writeJsonArtifact(manifestPath, withPaths);
  await writeJsonArtifact(analysisPath, {
    status: manifest.status === "completed" ? "computed" : "not_computed",
    selectedLightingProfile: manifest.selectedLightingProfile,
    front: manifest.front?.analysis,
    back: manifest.back?.analysis,
    followUpPlan: manifest.followUpPlan,
    calibration: manifest.calibration,
    warnings: manifest.warnings,
  });
  await writeFile(previewReportPath, renderFixedRigV1Report(withPaths), "utf-8");
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

function qualityTable(quality: FixedRigQualityMetrics | undefined): string {
  if (!quality) return "<p>Quality metrics not available.</p>";
  return `<table><tbody>
    <tr><th>Mean / max</th><td>${quality.mean} / ${quality.max}</td></tr>
    <tr><th>Sharpness score</th><td>${quality.sharpnessScore}</td></tr>
    <tr><th>Clipped pixels</th><td>${quality.clippedPixelFraction}</td></tr>
    <tr><th>Dark pixels</th><td>${quality.darkPixelFraction}</td></tr>
    <tr><th>Card boundary</th><td>${escapeHtml(quality.cardBoundary.status)} ${escapeHtml(quality.cardBoundary.coverage ?? "")}</td></tr>
    <tr><th>Warnings</th><td>${escapeHtml(quality.warnings.join("; ") || "none")}</td></tr>
  </tbody></table>`;
}

function sideSection(side: FixedRigSideCapture | undefined, title: string): string {
  if (!side) return `<section><h2>${escapeHtml(title)}</h2><p>Not captured.</p></section>`;
  return `<section>
    <h2>${escapeHtml(title)}</h2>
    <div class="grid">
      <section><h3>Dark Control</h3>${imageTag(side.macroPackage.darkControl?.capture.outputFilePath, `${title} dark control`)}</section>
      <section><h3>Synced Macro</h3>${imageTag(side.macroPackage.synced?.capture.outputFilePath, `${title} synced macro`)}</section>
    </div>
    ${qualityTable(side.quality)}
    <p><strong>ROI status:</strong> ${escapeHtml(side.analysis.boundaryStatus)} | <strong>Analysis:</strong> ${escapeHtml(side.analysis.status)}</p>
  </section>`;
}

export function renderFixedRigFocusAssistReport(manifest: FixedRigFocusAssistManifest): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Basler Fixed-Rig Focus Assist - Uncalibrated</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #171717; background: #f7f7f4; }
    main { max-width: 1180px; margin: 0 auto; }
    img { max-width: 100%; border: 1px solid #aaa; background: #111; }
    table { border-collapse: collapse; width: 100%; margin: 8px 0 16px; }
    th, td { border: 1px solid #bbb; padding: 6px 8px; text-align: left; }
    .warn { border-left: 4px solid #a33; padding: 8px 12px; background: #fff; }
  </style>
</head>
<body><main>
  <h1>Basler Fixed-Rig Focus Assist</h1>
  <p class="warn">Manual focus assist only. This is not autofocus, not calibrated macro evidence, not a final grade, not a certificate, and not certified grading.</p>
  ${imageTag(manifest.macroPackage?.synced?.capture.outputFilePath, "Focus assist synced macro")}
  ${qualityTable(manifest.quality)}
  <h2>Operator Guidance</h2>
  <ul>${manifest.operatorGuidance.guidance.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
</main></body></html>
`;
}

export function renderFixedRigV1Report(manifest: FixedRigV1LocalManifest): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>AI Grader Fixed-Rig V1 Local - Uncalibrated</title>
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
  <h1>AI Grader Fixed-Rig V1 Local Workflow</h1>
  <p class="warn">Local/offline uncalibrated evidence package only. No final AI grade, certificate, or certified grading claim is made.</p>
  <p><strong>Evidence roles:</strong> Basler is primary macro measurement/screening evidence. Dino-Lite is optional manual detail confirmation for flagged or operator-requested close-ups.</p>
  ${sideSection(manifest.front, "Front Basler Macro")}
  ${sideSection(manifest.back, "Back Basler Macro")}
  <h2>Lighting Profile</h2>
  <p>${escapeHtml(manifest.selectedLightingProfile)}. Multi-light directional profiles are dry-run only until channel mapping is calibrated.</p>
  <h2>Next Calibration Needed</h2>
  <ul>${manifest.calibration.requiredNext.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
  <h2>Dino-Lite Follow-Up</h2>
  <p>${escapeHtml(manifest.followUpPlan.note)}</p>
</main></body></html>
`;
}
