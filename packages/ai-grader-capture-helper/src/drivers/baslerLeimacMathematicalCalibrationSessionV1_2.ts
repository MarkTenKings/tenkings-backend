import crypto from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import path from "node:path";
import {
  assertBaslerCaptureOutputDirAllowed,
  defaultBaslerPylonBridgeScriptPath,
  type BaslerCaptureStillResult,
} from "./baslerPylonClient";
import type { FastCalibrationPhotometricRoleV1_2 } from "./fixedRigFastMathematicalCalibrationV1_2";

export interface BaslerMathematicalCalibrationLiveContextV1_2 {
  camera: {
    serialNumber: string;
    modelName: string;
    exposureUs: number;
    gain: number;
    pixelFormat: string;
    widthPx: number;
    heightPx: number;
  };
  controller: {
    identity: string;
    unit: number;
  };
}

export interface BaslerLeimacMathematicalCalibrationSessionConfigV1_2 {
  outputDir: string;
  cameraIndex: number;
  pylonRoot?: string;
  bridgeScriptPath?: string;
  powershellPath?: string;
  timeoutMs?: number;
  terminationTimeoutMs?: number;
  spawnProcess?: typeof spawn;
  exposureUs: number;
  gain: number;
  leimacHost: string;
  leimacPort: number;
  leimacUnit: number;
  dutyPercent: number;
}

export interface BaslerLeimacMathematicalCalibrationCaptureV1_2 {
  capture: BaslerCaptureStillResult;
  safeOffBeforeResponseKinds: string[];
  lightingResponseKinds: string[];
  safeOffAfterResponseKinds: string[];
}

type SessionEnvelope = {
  ok: boolean;
  event?: "opened" | "capture" | "safe_off" | "closed";
  requestId?: string;
  result?: Record<string, unknown>;
  error?: { code?: string; message?: string };
};

type PendingResponse = {
  event: SessionEnvelope["event"];
  requestId?: string;
  resolve(value: SessionEnvelope): void;
  reject(error: Error): void;
  timeout: NodeJS.Timeout;
};

type ChildExit = { code: number | null; signal: NodeJS.Signals | null };

function exactSafe(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(value)) throw new Error(`${label} is not one exact safe identifier.`);
  return value;
}

function exactResponseKinds(value: unknown, label: string, allowEmpty = false): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.some((entry) => entry !== "ack")) {
    throw new Error(`${label} must contain exact controller acknowledgements only.`);
  }
  return value as string[];
}

export class BaslerLeimacMathematicalCalibrationSessionV1_2 {
  private child?: ChildProcessWithoutNullStreams;
  private childExit?: Promise<ChildExit>;
  private cleanupPromise?: Promise<void>;
  private readonly pending: PendingResponse[] = [];
  private stderr = "";

  constructor(private readonly config: BaslerLeimacMathematicalCalibrationSessionConfigV1_2) {
    assertBaslerCaptureOutputDirAllowed(config.outputDir);
    if (!Number.isInteger(config.cameraIndex) || config.cameraIndex < 0) throw new Error("Calibration camera index is invalid.");
    if (!config.leimacHost || !Number.isInteger(config.leimacPort) || !Number.isInteger(config.leimacUnit)) {
      throw new Error("Calibration Leimac endpoint is incomplete.");
    }
  }

  private args(action: "mathematical-calibration-context" | "mathematical-calibration-session"): string[] {
    return [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
      this.config.bridgeScriptPath ?? defaultBaslerPylonBridgeScriptPath(),
      "-Action", action,
      "-OutputDir", this.config.outputDir,
      "-CameraIndex", String(this.config.cameraIndex),
      "-Format", "tiff",
      "-ExposureUs", String(this.config.exposureUs),
      "-Gain", String(this.config.gain),
      "-LeimacHost", this.config.leimacHost,
      "-LeimacPort", String(this.config.leimacPort),
      "-LeimacUnit", String(this.config.leimacUnit),
      "-PreviewDutyTenthsPercent", String(Math.round(this.config.dutyPercent * 10)),
      ...(this.config.pylonRoot ? ["-PylonRoot", this.config.pylonRoot] : []),
    ];
  }

  private boundedExit(exit: Promise<ChildExit>, timeoutMs: number): Promise<ChildExit | undefined> {
    return new Promise((resolve) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(undefined);
        }
      }, timeoutMs);
      void exit.then((value) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          resolve(value);
        }
      });
    });
  }

  private async terminateChild(
    child: ChildProcessWithoutNullStreams,
    exit: Promise<ChildExit>,
    reason: Error,
  ): Promise<void> {
    try { child.stdin.end(); } catch {}
    try { child.kill(); } catch {}
    const timeoutMs = this.config.terminationTimeoutMs ?? 5000;
    if (await this.boundedExit(exit, timeoutMs)) return;
    try { child.kill("SIGKILL"); } catch {}
    if (await this.boundedExit(exit, timeoutMs)) return;
    throw new Error(`${reason.message} Persistent calibration owner did not exit after forced termination.`);
  }

  private terminateActiveChild(reason: Error): Promise<void> {
    const child = this.child;
    const exit = this.childExit;
    if (!child || !exit) return Promise.resolve();
    return this.terminateChild(child, exit, reason);
  }

  private failAll(error: Error): void {
    while (this.pending.length > 0) {
      const pending = this.pending.shift()!;
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
  }

  private failAllAfterCleanup(error: Error): void {
    const pending = this.pending.splice(0);
    pending.forEach((entry) => clearTimeout(entry.timeout));
    const cleanup = this.cleanupPromise ?? this.terminateActiveChild(error);
    this.cleanupPromise = cleanup;
    void cleanup.then(
      () => pending.forEach((entry) => entry.reject(error)),
      (cleanupError) => {
        const message = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        pending.forEach((entry) => entry.reject(new Error(`${error.message} Cleanup failed: ${message}`)));
      },
    ).finally(() => {
      if (this.cleanupPromise === cleanup) this.cleanupPromise = undefined;
    });
  }

  private attachPersistentChild(child: ChildProcessWithoutNullStreams): void {
    this.child = child;
    this.childExit = new Promise((resolve) => {
      child.once("close", (code, signal) => {
        if (this.child === child) this.child = undefined;
        resolve({ code, signal });
        if (this.pending.length > 0) {
          this.failAll(new Error(this.stderr.trim() ||
            `Persistent calibration transport exited ${code ?? "without code"} before completing its request.`));
        }
      });
    });
    child.once("error", (error) => this.failAllAfterCleanup(error));
  }

  private processLine(line: string): void {
    let envelope: SessionEnvelope;
    try {
      envelope = JSON.parse(line) as SessionEnvelope;
    } catch {
      this.failAllAfterCleanup(new Error("Persistent calibration transport emitted non-JSON output."));
      return;
    }
    const index = this.pending.findIndex((entry) => entry.event === envelope.event &&
      (entry.requestId === undefined || entry.requestId === envelope.requestId));
    if (index < 0) {
      this.failAllAfterCleanup(new Error("Persistent calibration transport emitted an unexpected response."));
      return;
    }
    const [pending] = this.pending.splice(index, 1);
    clearTimeout(pending!.timeout);
    if (!envelope.ok) pending!.reject(new Error(envelope.error?.message ?? "Persistent calibration transport failed."));
    else pending!.resolve(envelope);
  }

  private waitFor(event: PendingResponse["event"], requestId?: string): Promise<SessionEnvelope> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const suffix = this.stderr.trim() ? `: ${this.stderr.trim().slice(-1000)}` : "";
        this.failAllAfterCleanup(new Error(`Persistent calibration transport ${event} timed out${suffix}`));
      }, this.config.timeoutMs ?? 30000);
      this.pending.push({ event, ...(requestId ? { requestId } : {}), resolve, reject, timeout });
    });
  }

  private send(value: Record<string, unknown>): void {
    if (!this.child || this.child.killed || !this.child.stdin.writable) throw new Error("Persistent calibration transport is not open.");
    this.child.stdin.write(`${JSON.stringify(value)}\n`, "utf8");
  }

  async probeContext(): Promise<BaslerMathematicalCalibrationLiveContextV1_2> {
    const executable = this.config.powershellPath ?? "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
    const spawnProcess = this.config.spawnProcess ?? spawn;
    const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawnProcess(executable, this.args("mathematical-calibration-context"), { windowsHide: true });
      } catch (error) {
        reject(error);
        return;
      }
      let stdout = "";
      let stderr = "";
      let settled = false;
      let terminating = false;
      const exit = new Promise<ChildExit>((resolveExit) => {
        child.once("close", (code, signal) => resolveExit({ code, signal }));
      });
      const finish = (error?: Error, value?: Record<string, unknown>) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve(value!);
      };
      const terminateAndFail = (error: Error) => {
        if (terminating || settled) return;
        terminating = true;
        void this.terminateChild(child, exit, error).then(
          () => finish(error),
          (cleanupError) => finish(cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError))),
        );
      };
      const timeout = setTimeout(() => terminateAndFail(
        new Error("Mathematical calibration live-context probe timed out."),
      ), this.config.timeoutMs ?? 30000);
      child.stdout.on("data", (chunk) => { stdout += String(chunk); });
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });
      child.once("error", (error) => terminateAndFail(error));
      child.on("close", (code) => {
        if (terminating) return;
        try {
          const envelope = JSON.parse(stdout.trim()) as { ok: boolean; result?: Record<string, unknown>; error?: { message?: string } };
          if (code !== 0 || !envelope.ok || !envelope.result) finish(new Error(envelope.error?.message ?? (stderr.trim() || "Calibration context probe failed.")));
          else finish(undefined, envelope.result);
        } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
      });
    });
    const camera = result.camera as Record<string, unknown>;
    const controller = result.controller as Record<string, unknown>;
    return {
      camera: {
        serialNumber: exactSafe(String(camera.serialNumber ?? ""), "live camera serial"),
        modelName: exactSafe(String(camera.modelName ?? ""), "live camera model"),
        exposureUs: Number(camera.exposureUs),
        gain: Number(camera.gain),
        pixelFormat: exactSafe(String(camera.pixelFormat ?? ""), "live pixel format"),
        widthPx: Number(camera.widthPx),
        heightPx: Number(camera.heightPx),
      },
      controller: {
        identity: exactSafe(String(controller.identity ?? ""), "live controller identity"),
        unit: Number(controller.unit),
      },
    };
  }

  async open(): Promise<BaslerMathematicalCalibrationLiveContextV1_2> {
    if (this.child) throw new Error("Persistent calibration transport is already open.");
    const executable = this.config.powershellPath ?? "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
    const opened = this.waitFor("opened");
    let child: ChildProcessWithoutNullStreams;
    try {
      child = (this.config.spawnProcess ?? spawn)(
        executable,
        this.args("mathematical-calibration-session"),
        { windowsHide: true },
      );
    } catch (error) {
      this.failAll(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
    this.attachPersistentChild(child);
    const lines = readline.createInterface({ input: child.stdout });
    lines.on("line", (line) => this.processLine(line));
    child.stderr.on("data", (chunk) => { this.stderr += String(chunk); });
    let envelope: SessionEnvelope;
    try {
      envelope = await opened;
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      await this.terminateActiveChild(failure);
      throw failure;
    }
    const result = envelope.result ?? {};
    const camera = result.camera as Record<string, unknown>;
    const controller = result.controller as Record<string, unknown>;
    try {
      return {
      camera: {
        serialNumber: exactSafe(String(camera.serialNumber ?? ""), "opened camera serial"),
        modelName: exactSafe(String(camera.modelName ?? ""), "opened camera model"),
        exposureUs: Number(camera.exposureUs),
        gain: Number(camera.gain),
        pixelFormat: exactSafe(String(camera.pixelFormat ?? ""), "opened pixel format"),
        widthPx: Number(camera.widthPx),
        heightPx: Number(camera.heightPx),
      },
      controller: {
        identity: exactSafe(String(controller.identity ?? ""), "opened controller identity"),
        unit: Number(controller.unit),
      },
      };
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      await this.terminateActiveChild(failure);
      throw failure;
    }
  }

  private async captureRole(input: {
    operationId: string;
    role: FastCalibrationPhotometricRoleV1_2 | "checkerboard_placement";
    channelIndex: number;
    sampleIndex: number;
    dutyPercent: number;
    replacement?: boolean;
  }): Promise<BaslerLeimacMathematicalCalibrationCaptureV1_2> {
    const requestId = exactSafe(input.operationId, "calibration operationId");
    const pending = this.waitFor("capture", requestId);
    this.send({ command: "capture", requestId, role: input.role, channelIndex: input.channelIndex,
      sampleIndex: input.sampleIndex, dutyTenthsPercent: Math.round(input.dutyPercent * 10),
      ...(input.replacement === undefined ? {} : { replacement: input.replacement }) });
    const result = (await pending).result ?? {};
    return {
      capture: result.capture as unknown as BaslerCaptureStillResult,
      safeOffBeforeResponseKinds: exactResponseKinds(result.safeOffBeforeResponseKinds, "safe-off-before responses"),
      lightingResponseKinds: exactResponseKinds(result.lightingResponseKinds, "lighting responses", true),
      safeOffAfterResponseKinds: exactResponseKinds(result.safeOffAfterResponseKinds, "safe-off-after responses"),
    };
  }

  capture(input: {
    operationId: string;
    role: FastCalibrationPhotometricRoleV1_2;
    channelIndex: number;
    sampleIndex: number;
    dutyPercent: number;
  }): Promise<BaslerLeimacMathematicalCalibrationCaptureV1_2> {
    return this.captureRole(input);
  }

  captureCheckerboard(input: {
    operationId: string;
    slot: number;
    replacement: boolean;
    dutyPercent: number;
  }): Promise<BaslerLeimacMathematicalCalibrationCaptureV1_2> {
    return this.captureRole({ ...input, role: "checkerboard_placement", channelIndex: 0, sampleIndex: input.slot });
  }

  async safeOff(): Promise<string[]> {
    const requestId = `safe-off-${crypto.randomUUID()}`;
    const pending = this.waitFor("safe_off", requestId);
    this.send({ command: "safe_off", requestId });
    return exactResponseKinds((await pending).result?.responseKinds, "final safe-off responses");
  }

  async close(): Promise<void> {
    const child = this.child;
    const exit = this.childExit;
    if (!child) return;
    if (!exit) throw new Error("Persistent calibration transport exit ownership is missing.");
    const requestId = `close-${crypto.randomUUID()}`;
    const pending = this.waitFor("closed", requestId);
    this.send({ command: "close", requestId });
    try {
      const envelope = await pending;
      exactResponseKinds(envelope.result?.responseKinds, "close safe-off responses");
      child.stdin.end();
      const closed = await this.boundedExit(exit, this.config.terminationTimeoutMs ?? 5000);
      if (!closed) {
        const failure = new Error("Persistent calibration close acknowledgement preceded bounded camera/controller release.");
        await this.terminateChild(child, exit, failure);
        throw failure;
      }
      if (closed.code !== 0) {
        throw new Error(this.stderr.trim() || `Persistent calibration transport exited ${closed.code} after close acknowledgement.`);
      }
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      await this.terminateChild(child, exit, failure);
      throw failure;
    }
  }
}
