import path from "node:path";
import sharp from "sharp";
import type {
  BaslerCaptureStillResult,
  BaslerLine2ExposureActiveResult,
  BaslerLine2StatusResult,
  BaslerLine2UserOutputPulseResult,
} from "./baslerPylonClient";
import {
  LEIMAC_IDMU_MAX_FIRST_SMOKE_DUTY_PERCENT,
  type LeimacIdmuCommandResult,
  type LeimacIdmuSettingReadbackResult,
  type LeimacIdmuTriggerActivationMode,
  type LeimacIdmuTriggerProfileApplyResult,
  type LeimacIdmuTriggerProfilePlan,
  buildLeimacIdmuTriggerProfilePlan,
} from "./leimacIdmuClient";

export const BASLER_LEIMAC_SYNC_SMOKE_CONFIRMATION = "RUN SUPERVISED BASLER LEIMAC SYNC SMOKE";
export const BASLER_LEIMAC_POLARITY_SMOKE_CONFIRMATION = "RUN SUPERVISED BASLER LEIMAC POLARITY SMOKE";
export const BASLER_LEIMAC_IMAGE_STAT_SYNC_SMOKE_CONFIRMATION = "RUN SUPERVISED BASLER LEIMAC IMAGE STAT SYNC SMOKE";
export const BASLER_LEIMAC_POLARITY_DIAGNOSTIC_DEFAULT_DUTY_PERCENT = 1;

export class BaslerLeimacSyncError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BaslerLeimacSyncError";
    this.code = code;
  }
}

export interface BaslerLeimacSyncSmokeManifest {
  status: "planned" | "captured";
  imagePath?: string;
  sha256?: string;
  byteSize?: number;
  dimensions?: {
    width: number;
    height: number;
  };
  requestedExposureUs?: number;
  exposureUs?: number | null;
  gain?: number | null;
  basler: {
    line2: {
      lineSelector: "Line2";
      lineMode: "Output";
      lineSource: "ExposureActive";
      lineInverter: boolean;
      persistentSaved: false;
      baslerSettingsChanged: boolean;
    };
  };
  leimac: {
    host: string;
    port: number;
    unitInfo?: LeimacIdmuCommandResult;
    profile: "basler-line2-trg-in1-low-duty";
    triggerActivation: LeimacIdmuTriggerActivationMode;
    dutyPercent: number;
    dutySteps: number;
    persistentSaved: false;
    frames: string[];
  };
  calibration: {
    isCalibrated: false;
    calibrationProfileId: null;
    evidenceClass: "macro_sync_smoke_uncalibrated";
    cameraRole: "macro_overview";
    coordinateFrame: "basler_sensor_pixels";
  };
  safety: {
    supervised: boolean;
    dryRun: boolean;
    writesApplied: boolean;
    lightsCommanded: boolean;
    persistentSaved: false;
    calibratedEvidence: false;
  };
  note: string;
}

export type BaslerLeimacPolarityCandidateId =
  | "line2-no-inverter-level-high"
  | "line2-inverter-level-low"
  | "line2-no-inverter-level-low"
  | "line2-inverter-level-high";

export interface BaslerLeimacPolarityCandidate {
  id: BaslerLeimacPolarityCandidateId;
  baslerLineInverter: boolean;
  leimacTriggerActivation: LeimacIdmuTriggerActivationMode;
  preferredOrder: number;
  reason: string;
}

export interface BaslerLeimacPolaritySmokePlan {
  dryRun: boolean;
  dutyPercent: number;
  exposureUs?: number;
  candidates: BaslerLeimacPolarityCandidate[];
  selectedCandidate?: BaslerLeimacPolarityCandidate;
  safety: {
    markPresentRequired: true;
    wiringConfirmedRequired: true;
    leimacStatusGreenRequired: true;
    safeOffBeforeEachCandidate: true;
    safeOffAfterIdleOnCandidate: true;
    safeOffAfterCapture: true;
    persistentSaved: false;
    arbitraryWritesAllowed: false;
    maxDutyPercent: 5;
  };
}

export interface BaslerLeimacPolaritySmokeManifest {
  status: "planned" | "candidate_applied" | "captured" | "aborted";
  selectedCandidate: BaslerLeimacPolarityCandidate;
  candidateResult?: "idle_off_pending_capture" | "idle_on_failed" | "accepted" | "capture_failed";
  imagePath?: string;
  sha256?: string;
  byteSize?: number;
  dimensions?: {
    width: number;
    height: number;
  };
  requestedExposureUs?: number;
  exposureUs?: number | null;
  gain?: number | null;
  basler: {
    line2: {
      lineSelector: "Line2";
      lineMode: "Output";
      lineSource: "ExposureActive";
      lineInverter: boolean;
      persistentSaved: false;
      baslerSettingsChanged: boolean;
      readback?: BaslerLine2ExposureActiveResult["readback"] | BaslerLine2StatusResult["readback"];
    };
  };
  leimac: {
    host: string;
    port: number;
    unitInfo?: LeimacIdmuCommandResult;
    profile: "basler-line2-trg-in1-low-duty";
    triggerActivation: LeimacIdmuTriggerActivationMode;
    dutyPercent: number;
    dutySteps: number;
    persistentSaved: false;
    frames: string[];
  };
  calibration: {
    isCalibrated: false;
    calibrationProfileId: null;
    evidenceClass: "macro_sync_smoke_uncalibrated";
    cameraRole: "macro_overview";
    coordinateFrame: "basler_sensor_pixels";
  };
  safety: {
    supervised: boolean;
    dryRun: boolean;
    safeOffBefore: boolean;
    safeOffAfter: boolean;
    writesApplied: boolean;
    lightsCommanded: boolean;
    persistentSaved: false;
    calibratedEvidence: false;
    finalLightOffConfirmedByMark: boolean;
  };
  note: string;
}

export interface BaslerLeimacImageStats {
  filePath: string;
  width: number;
  height: number;
  channels: number;
  min: number;
  max: number;
  mean: number;
  nonZeroFraction: number;
  brightFraction: number;
}

export interface BaslerLeimacImageStatSyncSmokeManifest {
  status: "planned" | "captured" | "aborted";
  selectedCandidate: BaslerLeimacPolarityCandidate;
  darkControl?: {
    capture: BaslerCaptureStillResult;
    stats: BaslerLeimacImageStats;
  };
  synced?: {
    capture: BaslerCaptureStillResult;
    stats: BaslerLeimacImageStats;
  };
  comparison?: {
    meanDelta: number;
    maxDelta: number;
    materiallyBrighter: boolean;
  };
  requestedExposureUs: number;
  dutyPercent: number;
  pulse?: BaslerLine2UserOutputPulseResult;
  basler: {
    line2: {
      lineSelector: "Line2";
      lineMode: "Output";
      lineSource: "ExposureActive";
      lineInverter: boolean;
      persistentSaved: false;
      baslerSettingsChanged: boolean;
      readback?: BaslerLine2ExposureActiveResult["readback"] | BaslerLine2StatusResult["readback"];
    };
  };
  leimac: {
    host: string;
    port: number;
    unitInfo?: LeimacIdmuCommandResult;
    profile: "basler-line2-trg-in1-low-duty";
    triggerActivation: LeimacIdmuTriggerActivationMode;
    dutyPercent: number;
    dutySteps: number;
    persistentSaved: false;
    frames: string[];
    settingReadbacks?: LeimacIdmuSettingReadbackResult[];
  };
  calibration: {
    isCalibrated: false;
    calibrationProfileId: null;
    evidenceClass: "macro_sync_smoke_uncalibrated";
    cameraRole: "macro_overview";
    coordinateFrame: "basler_sensor_pixels";
  };
  safety: {
    supervised: boolean;
    dryRun: boolean;
    safeOffBefore: boolean;
    safeOffAfter: boolean;
    writesApplied: boolean;
    lightsCommanded: boolean;
    persistentSaved: false;
    calibratedEvidence: false;
    finalLightOffConfirmedByMark: boolean;
  };
  note: string;
}

export const BASLER_LEIMAC_POLARITY_CANDIDATES: BaslerLeimacPolarityCandidate[] = [
  {
    id: "line2-no-inverter-level-high",
    baslerLineInverter: false,
    leimacTriggerActivation: "LevelHigh",
    preferredOrder: 1,
    reason: "First retry after idle-on with no-inverter/LevelLow; changes only Leimac trigger activation.",
  },
  {
    id: "line2-inverter-level-low",
    baslerLineInverter: true,
    leimacTriggerActivation: "LevelLow",
    preferredOrder: 2,
    reason: "Keeps vendor-guide LevelLow behavior but inverts the Basler Line2 electrical level.",
  },
  {
    id: "line2-no-inverter-level-low",
    baslerLineInverter: false,
    leimacTriggerActivation: "LevelLow",
    preferredOrder: 3,
    reason: "Previously tested baseline that caused idle-on; retained for complete manifest coverage only.",
  },
  {
    id: "line2-inverter-level-high",
    baslerLineInverter: true,
    leimacTriggerActivation: "LevelHigh",
    preferredOrder: 4,
    reason: "Final supported polarity combination if the first two candidates fail.",
  },
];

export function assertBaslerLeimacSyncSmokeOutputDirAllowed(outputDir: string, repoRoot = process.cwd()): string {
  if (!outputDir || outputDir.trim().length === 0) {
    throw new BaslerLeimacSyncError("BASLER_LEIMAC_SYNC_OUTPUT_DIR_REQUIRED", "basler-leimac-sync-smoke requires --output-dir <path>.");
  }
  const resolvedOutputDir = path.resolve(outputDir);
  const resolvedRepoRoot = path.resolve(repoRoot);
  const relative = path.relative(resolvedRepoRoot, resolvedOutputDir);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new BaslerLeimacSyncError("BASLER_LEIMAC_SYNC_OUTPUT_DIR_INSIDE_REPO", "Basler/Leimac sync smoke output directory must be outside the git repo.");
  }
  return resolvedOutputDir;
}

export function normalizeBaslerLeimacPolarityCandidate(
  candidateId: string | undefined
): BaslerLeimacPolarityCandidate {
  const id = (candidateId ?? BASLER_LEIMAC_POLARITY_CANDIDATES[0].id).trim();
  const candidate = BASLER_LEIMAC_POLARITY_CANDIDATES.find((entry) => entry.id === id);
  if (!candidate) {
    throw new BaslerLeimacSyncError(
      "BASLER_LEIMAC_POLARITY_CANDIDATE_INVALID",
      `Unsupported polarity candidate: ${id}.`
    );
  }
  return candidate;
}

export function normalizeBaslerLeimacPolarityDutyPercent(value: number | string | undefined): number {
  const numeric =
    value == null || value === "" ? BASLER_LEIMAC_POLARITY_DIAGNOSTIC_DEFAULT_DUTY_PERCENT : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new BaslerLeimacSyncError(
      "BASLER_LEIMAC_POLARITY_DUTY_INVALID",
      "--duty must be a number from 0 to 5 for polarity diagnostics."
    );
  }
  if (numeric > LEIMAC_IDMU_MAX_FIRST_SMOKE_DUTY_PERCENT) {
    throw new BaslerLeimacSyncError(
      "BASLER_LEIMAC_POLARITY_DUTY_TOO_HIGH",
      "Basler/Leimac polarity diagnostics are capped at 5% duty."
    );
  }
  return numeric;
}

export function buildBaslerLeimacPolaritySmokePlan(input: {
  dutyPercent?: number | string;
  exposureUs?: number;
  candidateId?: string;
  dryRun?: boolean;
} = {}): BaslerLeimacPolaritySmokePlan {
  const dutyPercent = normalizeBaslerLeimacPolarityDutyPercent(input.dutyPercent);
  const selectedCandidate = input.candidateId
    ? normalizeBaslerLeimacPolarityCandidate(input.candidateId)
    : undefined;
  return {
    dryRun: input.dryRun ?? true,
    dutyPercent,
    ...(input.exposureUs ? { exposureUs: input.exposureUs } : {}),
    candidates: BASLER_LEIMAC_POLARITY_CANDIDATES,
    ...(selectedCandidate ? { selectedCandidate } : {}),
    safety: {
      markPresentRequired: true,
      wiringConfirmedRequired: true,
      leimacStatusGreenRequired: true,
      safeOffBeforeEachCandidate: true,
      safeOffAfterIdleOnCandidate: true,
      safeOffAfterCapture: true,
      persistentSaved: false,
      arbitraryWritesAllowed: false,
      maxDutyPercent: LEIMAC_IDMU_MAX_FIRST_SMOKE_DUTY_PERCENT,
    },
  };
}

export function buildBaslerLeimacSyncSmokeManifest(input: {
  status: "planned" | "captured";
  leimacHost: string;
  leimacPort: number;
  leimacProfile: LeimacIdmuTriggerProfileApplyResult;
  baslerLine2: BaslerLine2ExposureActiveResult;
  requestedExposureUs?: number;
  capture?: BaslerCaptureStillResult;
  supervised: boolean;
}): BaslerLeimacSyncSmokeManifest {
  return {
    status: input.status,
    ...(input.capture
      ? {
          imagePath: input.capture.outputFilePath,
          sha256: input.capture.sha256,
          byteSize: input.capture.byteSize,
          dimensions: {
            width: input.capture.imageWidth,
            height: input.capture.imageHeight,
          },
          exposureUs: input.capture.exposureTime ?? null,
          gain: input.capture.gain ?? null,
        }
      : {}),
    ...(input.requestedExposureUs ? { requestedExposureUs: input.requestedExposureUs } : {}),
    basler: {
      line2: {
        lineSelector: "Line2",
        lineMode: "Output",
        lineSource: "ExposureActive",
        lineInverter: input.baslerLine2.lineInverter,
        persistentSaved: false,
        baslerSettingsChanged: input.baslerLine2.baslerSettingsChanged,
      },
    },
    leimac: {
      host: input.leimacHost,
      port: input.leimacPort,
      unitInfo: input.leimacProfile.unitInfo,
      profile: "basler-line2-trg-in1-low-duty",
      triggerActivation: input.leimacProfile.plan.triggerActivation,
      dutyPercent: input.leimacProfile.plan.dutyPercent,
      dutySteps: input.leimacProfile.plan.dutySteps,
      persistentSaved: false,
      frames: input.leimacProfile.plan.frames.map((frame) => frame.requestFrame),
    },
    calibration: {
      isCalibrated: false,
      calibrationProfileId: null,
      evidenceClass: "macro_sync_smoke_uncalibrated",
      cameraRole: "macro_overview",
      coordinateFrame: "basler_sensor_pixels",
    },
    safety: {
      supervised: input.supervised,
      dryRun: input.status === "planned",
      writesApplied: input.leimacProfile.applied || input.baslerLine2.applied,
      lightsCommanded: input.leimacProfile.plan.safety.lightsCommanded,
      persistentSaved: false,
      calibratedEvidence: false,
    },
    note:
      "Uncalibrated Basler/Leimac synchronized lighting smoke only; not production macro evidence, not a final grade, not a certificate, and not certified grading.",
  };
}

export function buildBaslerLeimacPolaritySmokeManifest(input: {
  status: BaslerLeimacPolaritySmokeManifest["status"];
  candidate: BaslerLeimacPolarityCandidate;
  candidateResult?: BaslerLeimacPolaritySmokeManifest["candidateResult"];
  leimacHost: string;
  leimacPort: number;
  leimacProfilePlan?: LeimacIdmuTriggerProfilePlan;
  leimacProfile?: LeimacIdmuTriggerProfileApplyResult;
  unitInfo?: LeimacIdmuCommandResult;
  baslerLine2?: BaslerLine2ExposureActiveResult;
  baslerLine2Status?: BaslerLine2StatusResult;
  requestedExposureUs?: number;
  capture?: BaslerCaptureStillResult;
  supervised: boolean;
  safeOffBefore: boolean;
  safeOffAfter: boolean;
  finalLightOffConfirmedByMark?: boolean;
}): BaslerLeimacPolaritySmokeManifest {
  const profilePlan =
    input.leimacProfile?.plan ??
    input.leimacProfilePlan ??
    buildLeimacIdmuTriggerProfilePlan({
      dutyPercent: BASLER_LEIMAC_POLARITY_DIAGNOSTIC_DEFAULT_DUTY_PERCENT,
      triggerActivation: input.candidate.leimacTriggerActivation,
    });
  const readback = input.baslerLine2?.readback ?? input.baslerLine2Status?.readback;
  return {
    status: input.status,
    selectedCandidate: input.candidate,
    ...(input.candidateResult ? { candidateResult: input.candidateResult } : {}),
    ...(input.capture
      ? {
          imagePath: input.capture.outputFilePath,
          sha256: input.capture.sha256,
          byteSize: input.capture.byteSize,
          dimensions: {
            width: input.capture.imageWidth,
            height: input.capture.imageHeight,
          },
          exposureUs: input.capture.exposureTime ?? null,
          gain: input.capture.gain ?? null,
        }
      : {}),
    ...(input.requestedExposureUs ? { requestedExposureUs: input.requestedExposureUs } : {}),
    basler: {
      line2: {
        lineSelector: "Line2",
        lineMode: "Output",
        lineSource: "ExposureActive",
        lineInverter: input.candidate.baslerLineInverter,
        persistentSaved: false,
        baslerSettingsChanged: input.baslerLine2?.baslerSettingsChanged ?? false,
        ...(readback ? { readback } : {}),
      },
    },
    leimac: {
      host: input.leimacHost,
      port: input.leimacPort,
      unitInfo: input.leimacProfile?.unitInfo ?? input.unitInfo,
      profile: "basler-line2-trg-in1-low-duty",
      triggerActivation: profilePlan.triggerActivation,
      dutyPercent: profilePlan.dutyPercent,
      dutySteps: profilePlan.dutySteps,
      persistentSaved: false,
      frames: profilePlan.frames.map((frame) => frame.requestFrame),
    },
    calibration: {
      isCalibrated: false,
      calibrationProfileId: null,
      evidenceClass: "macro_sync_smoke_uncalibrated",
      cameraRole: "macro_overview",
      coordinateFrame: "basler_sensor_pixels",
    },
    safety: {
      supervised: input.supervised,
      dryRun: input.status === "planned",
      safeOffBefore: input.safeOffBefore,
      safeOffAfter: input.safeOffAfter,
      writesApplied: input.leimacProfile?.applied || input.baslerLine2?.applied || false,
      lightsCommanded: input.leimacProfile?.plan.safety.lightsCommanded ?? false,
      persistentSaved: false,
      calibratedEvidence: false,
      finalLightOffConfirmedByMark: input.finalLightOffConfirmedByMark ?? false,
    },
    note:
      "Uncalibrated supervised Basler/Leimac polarity diagnostic only; not production macro evidence, not a final grade, not a certificate, and not certified grading.",
  };
}

function roundMetric(value: number, places = 4): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export async function analyzeBaslerLeimacImageStats(filePath: string): Promise<BaslerLeimacImageStats> {
  const { data, info } = await sharp(filePath).greyscale().raw().toBuffer({ resolveWithObject: true });
  let min = 255;
  let max = 0;
  let sum = 0;
  let nonZero = 0;
  let bright = 0;
  for (const value of data) {
    if (value < min) min = value;
    if (value > max) max = value;
    sum += value;
    if (value > 0) nonZero += 1;
    if (value >= 32) bright += 1;
  }
  const count = data.length || 1;
  return {
    filePath,
    width: info.width ?? 0,
    height: info.height ?? 0,
    channels: info.channels ?? 1,
    min,
    max,
    mean: roundMetric(sum / count, 4),
    nonZeroFraction: roundMetric(nonZero / count, 6),
    brightFraction: roundMetric(bright / count, 6),
  };
}

export function buildBaslerLeimacImageStatSyncSmokeManifest(input: {
  status: BaslerLeimacImageStatSyncSmokeManifest["status"];
  candidate: BaslerLeimacPolarityCandidate;
  leimacHost: string;
  leimacPort: number;
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
}): BaslerLeimacImageStatSyncSmokeManifest {
  const profilePlan =
    input.leimacProfile?.plan ??
    input.leimacProfilePlan ??
    buildLeimacIdmuTriggerProfilePlan({
      dutyPercent: input.dutyPercent,
      triggerActivation: input.candidate.leimacTriggerActivation,
    });
  const readback = input.baslerLine2?.readback ?? input.baslerLine2Status?.readback;
  const comparison =
    input.darkControl && input.synced
      ? {
          meanDelta: roundMetric(input.synced.stats.mean - input.darkControl.stats.mean, 4),
          maxDelta: roundMetric(input.synced.stats.max - input.darkControl.stats.max, 4),
          materiallyBrighter:
            input.synced.stats.mean >= input.darkControl.stats.mean + 2 ||
            input.synced.stats.max >= input.darkControl.stats.max + 16 ||
            input.synced.stats.brightFraction >= input.darkControl.stats.brightFraction + 0.01,
        }
      : undefined;
  return {
    status: input.status,
    selectedCandidate: input.candidate,
    ...(input.darkControl ? { darkControl: input.darkControl } : {}),
    ...(input.synced ? { synced: input.synced } : {}),
    ...(comparison ? { comparison } : {}),
    requestedExposureUs: input.requestedExposureUs,
    dutyPercent: input.dutyPercent,
    basler: {
      line2: {
        lineSelector: "Line2",
        lineMode: "Output",
        lineSource: "ExposureActive",
        lineInverter: input.candidate.baslerLineInverter,
        persistentSaved: false,
        baslerSettingsChanged: input.baslerLine2?.baslerSettingsChanged ?? false,
        ...(readback ? { readback } : {}),
      },
    },
    leimac: {
      host: input.leimacHost,
      port: input.leimacPort,
      unitInfo: input.leimacProfile?.unitInfo ?? input.unitInfo,
      profile: "basler-line2-trg-in1-low-duty",
      triggerActivation: profilePlan.triggerActivation,
      dutyPercent: profilePlan.dutyPercent,
      dutySteps: profilePlan.dutySteps,
      persistentSaved: false,
      frames: profilePlan.frames.map((frame) => frame.requestFrame),
      ...(input.settingReadbacks ? { settingReadbacks: input.settingReadbacks } : {}),
    },
    calibration: {
      isCalibrated: false,
      calibrationProfileId: null,
      evidenceClass: "macro_sync_smoke_uncalibrated",
      cameraRole: "macro_overview",
      coordinateFrame: "basler_sensor_pixels",
    },
    safety: {
      supervised: input.supervised,
      dryRun: input.status === "planned",
      safeOffBefore: input.safeOffBefore,
      safeOffAfter: input.safeOffAfter,
      writesApplied: input.leimacProfile?.applied || input.baslerLine2?.applied || false,
      lightsCommanded: input.leimacProfile?.plan.safety.lightsCommanded ?? false,
      persistentSaved: false,
      calibratedEvidence: false,
      finalLightOffConfirmedByMark: input.finalLightOffConfirmedByMark ?? false,
    },
    note:
      "Uncalibrated supervised Basler/Leimac image-stat sync smoke only; brightness stats are diagnostic evidence, not calibrated production macro evidence, not a final grade, not a certificate, and not certified grading.",
  };
}
