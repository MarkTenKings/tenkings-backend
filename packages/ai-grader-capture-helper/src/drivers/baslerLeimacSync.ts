import path from "node:path";
import type { BaslerCaptureStillResult, BaslerLine2ExposureActiveResult } from "./baslerPylonClient";
import type { LeimacIdmuCommandResult, LeimacIdmuTriggerProfileApplyResult } from "./leimacIdmuClient";

export const BASLER_LEIMAC_SYNC_SMOKE_CONFIRMATION = "RUN SUPERVISED BASLER LEIMAC SYNC SMOKE";

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
      lineInverter: false;
      persistentSaved: false;
      baslerSettingsChanged: boolean;
    };
  };
  leimac: {
    host: string;
    port: number;
    unitInfo?: LeimacIdmuCommandResult;
    profile: "basler-line2-trg-in1-low-duty";
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
        lineInverter: false,
        persistentSaved: false,
        baslerSettingsChanged: input.baslerLine2.baslerSettingsChanged,
      },
    },
    leimac: {
      host: input.leimacHost,
      port: input.leimacPort,
      unitInfo: input.leimacProfile.unitInfo,
      profile: "basler-line2-trg-in1-low-duty",
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
