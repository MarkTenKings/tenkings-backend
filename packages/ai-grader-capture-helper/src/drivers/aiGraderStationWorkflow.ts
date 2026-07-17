import { spawn } from "node:child_process";
import path from "node:path";
import { LEIMAC_IDMU_SAFE_OFF_CONFIRMATION } from "./leimacIdmuClient";

export interface AiGraderStationCommandStep {
  id: "unified_report" | "safe_off";
  label: string;
  command: string;
  args: string[];
  hardwareAccess: boolean;
  required: boolean;
}

export interface AiGraderStationCommandResult {
  stepId: AiGraderStationCommandStep["id"] | "capture_front" | "capture_back";
  ok: boolean;
  exitCode: number;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  stdoutText?: string;
  stderrText?: string;
  payload?: any;
  error?: string;
}

export interface AiGraderStationCommandRunner {
  run(step: AiGraderStationCommandStep): Promise<AiGraderStationCommandResult>;
}

export interface AiGraderStationRealWorkflowInput {
  outputDir: string;
  leimacHost: string;
  leimacPort?: number;
  leimacTimeoutMs?: number;
  leimacUnit?: number;
  pylonRoot?: string;
  pylonTimeoutMs?: number;
  baslerBridgeScript?: string;
  cameraIndex?: number;
  exposureUs?: number;
  gain?: number;
  duty?: number;
  markPresent: boolean;
  wiringConfirmed: boolean;
  leimacStatusGreen: boolean;
  fixtureLabel?: string;
  fixtureId?: string;
  referenceType?: string;
  horizontalSpanMm?: number;
  horizontalStartPx?: { x: number; y: number };
  horizontalEndPx?: { x: number; y: number };
  verticalSpanMm?: number;
  verticalStartPx?: { x: number; y: number };
  verticalEndPx?: { x: number; y: number };
}

function pushOptionalArg(args: string[], name: string, value: unknown) {
  if (value !== undefined && value !== null && value !== "") args.push(name, String(value));
}

/** The production bridge uses only its warm capture owner. This plan contains report generation and bridge-owned Safe Off. */
export function buildAiGraderStationRealCommandPlan(input: AiGraderStationRealWorkflowInput): AiGraderStationCommandStep[] {
  const safeOffArgs = [
    "leimac-idmu-safe-off", "--host", input.leimacHost, "--apply", "--confirm", LEIMAC_IDMU_SAFE_OFF_CONFIRMATION,
  ];
  pushOptionalArg(safeOffArgs, "--port", input.leimacPort);
  pushOptionalArg(safeOffArgs, "--timeout-ms", input.leimacTimeoutMs);
  pushOptionalArg(safeOffArgs, "--unit", input.leimacUnit);
  return [
    {
      id: "unified_report",
      label: "Generate unified front/back provisional diagnostic report",
      command: "node",
      args: ["ai-grader-fixed-rig-v1-card-report", "--output-dir", input.outputDir, "--front-dir", "<frontPackageDir>", "--back-dir", "<backPackageDir>"],
      hardwareAccess: false,
      required: true,
    },
    {
      id: "safe_off",
      label: "Bridge-owned Leimac Safe Off cleanup",
      command: "node",
      args: safeOffArgs,
      hardwareAccess: true,
      required: true,
    },
  ];
}

function parseJsonPayload(stdoutText: string): any | undefined {
  const trimmed = stdoutText.trim();
  if (!trimmed) return undefined;
  try { return JSON.parse(trimmed); } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try { return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)); } catch { return undefined; }
    }
    return undefined;
  }
}

export function createAiGraderStationCliRunner(cliPath = path.join(__dirname, "..", "cli.js")): AiGraderStationCommandRunner {
  return {
    run(step) {
      return new Promise((resolve) => {
        const startedAt = new Date().toISOString();
        const startedAtMs = Date.now();
        const child = spawn(process.execPath, [cliPath, ...step.args], { stdio: ["ignore", "pipe", "pipe"] });
        let stdoutText = "";
        let stderrText = "";
        child.stdout.on("data", (chunk) => { stdoutText += String(chunk); });
        child.stderr.on("data", (chunk) => { stderrText += String(chunk); });
        child.on("error", (error) => resolve({
          stepId: step.id, ok: false, exitCode: 1, startedAt, finishedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAtMs, error: error.message,
        }));
        child.on("close", (code) => resolve({
          stepId: step.id, ok: code === 0, exitCode: code ?? 1, startedAt, finishedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAtMs, stdoutText, stderrText, payload: parseJsonPayload(stdoutText),
          ...(code === 0 ? {} : { error: stderrText.trim() || `Command exited with code ${code ?? 1}.` }),
        }));
      });
    },
  };
}
