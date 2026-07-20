import { spawn } from "node:child_process";
import path from "node:path";

export interface MathematicalCalibrationPreviewPoint {
  x: number;
  y: number;
}

export interface MathematicalCalibrationPreviewCheckerboard {
  imageWidth: number;
  imageHeight: number;
  internalCorners: readonly MathematicalCalibrationPreviewPoint[];
  outerCorners: readonly [
    MathematicalCalibrationPreviewPoint,
    MathematicalCalibrationPreviewPoint,
    MathematicalCalibrationPreviewPoint,
    MathematicalCalibrationPreviewPoint,
  ];
  rotationDegrees: number;
}

const DETECTOR_SCRIPT = path.resolve(__dirname, "../../../../scripts/ai-grader/detect-mathematical-calibration-preview-checkerboard.py");

function finitePoint(value: unknown): value is MathematicalCalibrationPreviewPoint {
  if (!value || typeof value !== "object") return false;
  const point = value as Record<string, unknown>;
  return typeof point.x === "number" && Number.isFinite(point.x)
    && typeof point.y === "number" && Number.isFinite(point.y);
}

function parseResult(stdout: string): MathematicalCalibrationPreviewCheckerboard {
  const parsed = JSON.parse(stdout) as Partial<MathematicalCalibrationPreviewCheckerboard>;
  const imageWidth = parsed.imageWidth;
  const imageHeight = parsed.imageHeight;
  const internalCorners = parsed.internalCorners;
  const outerCorners = parsed.outerCorners;
  if (typeof imageWidth !== "number" || typeof imageHeight !== "number"
    || !Number.isInteger(imageWidth) || !Number.isInteger(imageHeight)
    || imageWidth <= 0 || imageHeight <= 0
    || !Array.isArray(internalCorners) || internalCorners.length !== 176
    || !Array.isArray(outerCorners) || outerCorners.length !== 4
    || !outerCorners.every(finitePoint)
    || !internalCorners.every(finitePoint)
    || typeof parsed.rotationDegrees !== "number" || !Number.isFinite(parsed.rotationDegrees)) {
    throw new Error("calibration preview checkerboard detector returned invalid geometry");
  }
  return {
    imageWidth,
    imageHeight,
    internalCorners,
    outerCorners: outerCorners as MathematicalCalibrationPreviewCheckerboard["outerCorners"],
    rotationDegrees: parsed.rotationDegrees,
  };
}

export function detectMathematicalCalibrationPreviewCheckerboard(
  imageBuffer: Buffer,
  options: { pythonExecutable?: string; timeoutMs?: number; scriptPath?: string } = {},
): Promise<MathematicalCalibrationPreviewCheckerboard> {
  return new Promise((resolve, reject) => {
    const child = spawn(options.pythonExecutable ?? "python", [options.scriptPath ?? DETECTOR_SCRIPT], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill();
      if (!settled) {
        settled = true;
        reject(new Error("calibration preview checkerboard detection timed out"));
      }
    }, options.timeoutMs ?? 3000);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else {
        try { resolve(parseResult(stdout)); }
        catch (parseError) { reject(parseError); }
      }
    };
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => finish(code === 0 ? undefined : new Error(stderr.trim() || `checkerboard detector exited with code ${code ?? 1}`)));
    child.stdin.end(imageBuffer);
  });
}
