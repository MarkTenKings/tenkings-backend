import {
  createNodeSerialLineTransport,
  type SerialLineConnection,
  type SerialLineOpenOptions,
  type SerialLineTransport,
} from "./serialTransport";

export const ARDUINO_LED_DEFAULT_BAUD_RATE = 115200;
export const ARDUINO_LED_DEFAULT_TIMEOUT_MS = 1000;
export const ARDUINO_LED_DEFAULT_OPEN_TIMEOUT_MS = 2000;
export const ARDUINO_LED_DEFAULT_CLOSE_TIMEOUT_MS = 1000;

export interface ArduinoLedControllerConfigInput {
  port?: string;
  baudRate?: number | string;
  commandTimeoutMs?: number | string;
  openTimeoutMs?: number | string;
  closeTimeoutMs?: number | string;
}

export interface ArduinoLedControllerConfig {
  port?: string;
  baudRate: number;
  commandTimeoutMs: number;
  openTimeoutMs: number;
  closeTimeoutMs: number;
}

export type ArduinoLedSerialOpenOptions = SerialLineOpenOptions;
export type ArduinoLedSerialConnection = SerialLineConnection;
export type ArduinoLedSerialTransport = SerialLineTransport;

export type ArduinoLedCommandStatus = "PASS" | "FAIL";

export interface ArduinoLedCommandResult {
  command: "PING" | "LED ALL OFF";
  expectedResponse: "PONG" | "OK";
  response?: string;
  status: ArduinoLedCommandStatus;
  durationMs: number;
  error?: string;
}

export interface ArduinoLedHealthResult {
  ok: boolean;
  status: ArduinoLedCommandStatus;
  port?: string;
  baudRate: number;
  opened: boolean;
  closed: boolean;
  allOffAttempted: boolean;
  allOffSucceeded: boolean;
  commands: ArduinoLedCommandResult[];
  error?: string;
  safeShutdownError?: string;
}

export interface ArduinoLedHealthCheckOptions {
  config: ArduinoLedControllerConfigInput;
  env?: Record<string, string | undefined>;
  transport?: ArduinoLedSerialTransport;
}

export class ArduinoLedControllerHealthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArduinoLedControllerHealthError";
  }
}

function firstNonEmpty(...values: Array<string | undefined>) {
  const value = values.find((candidate) => typeof candidate === "string" && candidate.trim().length > 0);
  return value?.trim();
}

function normalizePositiveInteger(value: number | string | undefined, fallback: number, label: string): number {
  if (value == null || value === "") return fallback;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new ArduinoLedControllerHealthError(`${label} must be a positive integer.`);
  }
  return numeric;
}

export function buildArduinoLedControllerConfig(
  input: ArduinoLedControllerConfigInput = {},
  env: Record<string, string | undefined> = process.env
): ArduinoLedControllerConfig {
  return {
    port: firstNonEmpty(input.port, env.AI_GRADER_CAPTURE_HELPER_ARDUINO_LED_PORT),
    baudRate: normalizePositiveInteger(
      input.baudRate ?? env.AI_GRADER_CAPTURE_HELPER_ARDUINO_LED_BAUD_RATE,
      ARDUINO_LED_DEFAULT_BAUD_RATE,
      "Arduino LED baud rate"
    ),
    commandTimeoutMs: normalizePositiveInteger(
      input.commandTimeoutMs ?? env.AI_GRADER_CAPTURE_HELPER_ARDUINO_LED_TIMEOUT_MS,
      ARDUINO_LED_DEFAULT_TIMEOUT_MS,
      "Arduino LED command timeout"
    ),
    openTimeoutMs: normalizePositiveInteger(
      input.openTimeoutMs ?? env.AI_GRADER_CAPTURE_HELPER_ARDUINO_LED_OPEN_TIMEOUT_MS,
      ARDUINO_LED_DEFAULT_OPEN_TIMEOUT_MS,
      "Arduino LED open timeout"
    ),
    closeTimeoutMs: normalizePositiveInteger(
      input.closeTimeoutMs ?? env.AI_GRADER_CAPTURE_HELPER_ARDUINO_LED_CLOSE_TIMEOUT_MS,
      ARDUINO_LED_DEFAULT_CLOSE_TIMEOUT_MS,
      "Arduino LED close timeout"
    ),
  };
}

export function isArduinoLedControllerRequested(
  inputKind: string | undefined,
  env: Record<string, string | undefined> = process.env
): boolean {
  const normalized = firstNonEmpty(inputKind, env.AI_GRADER_CAPTURE_HELPER_LED_CONTROLLER_KIND)?.toLowerCase();
  return normalized === "arduino";
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new ArduinoLedControllerHealthError(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function sendAndExpect(input: {
  connection: ArduinoLedSerialConnection;
  command: "PING" | "LED ALL OFF";
  expectedResponse: "PONG" | "OK";
  timeoutMs: number;
  commands: ArduinoLedCommandResult[];
}): Promise<void> {
  const startedAt = Date.now();
  const result: ArduinoLedCommandResult = {
    command: input.command,
    expectedResponse: input.expectedResponse,
    status: "FAIL",
    durationMs: 0,
  };
  input.commands.push(result);

  try {
    await withTimeout(
      input.connection.writeLine(input.command),
      input.timeoutMs,
      `Timed out writing ${input.command} to Arduino LED controller.`
    );
    const response = await withTimeout(
      input.connection.readLine(),
      input.timeoutMs,
      `Timed out waiting for ${input.expectedResponse} after ${input.command}.`
    );
    result.response = response;
    if (response !== input.expectedResponse) {
      throw new ArduinoLedControllerHealthError(
        `Unexpected Arduino LED controller response to ${input.command}: expected ${input.expectedResponse}, received ${response}.`
      );
    }
    result.status = "PASS";
  } catch (error) {
    result.error = error instanceof Error ? error.message : "Unknown Arduino LED command error.";
    throw error;
  } finally {
    result.durationMs = Date.now() - startedAt;
  }
}

function failResult(
  config: ArduinoLedControllerConfig,
  message: string,
  partial: Partial<ArduinoLedHealthResult> = {}
): ArduinoLedHealthResult {
  return {
    ok: false,
    status: "FAIL",
    port: config.port,
    baudRate: config.baudRate,
    opened: false,
    closed: false,
    allOffAttempted: false,
    allOffSucceeded: false,
    commands: [],
    ...partial,
    error: message,
  };
}

export async function runArduinoLedControllerHealthCheck(
  options: ArduinoLedHealthCheckOptions
): Promise<ArduinoLedHealthResult> {
  const config = buildArduinoLedControllerConfig(options.config, options.env ?? {});
  const commands: ArduinoLedCommandResult[] = [];
  let connection: ArduinoLedSerialConnection | undefined;
  let opened = false;
  let closed = false;
  let allOffAttempted = false;
  let allOffSucceeded = false;
  let primaryError: string | undefined;
  let safeShutdownError: string | undefined;

  if (!config.port) {
    return failResult(config, "Arduino LED controller serial port is required for real hardware readiness.");
  }

  try {
    const transport = options.transport ?? await createNodeSerialArduinoLedTransport();
    connection = await withTimeout(
      transport.open({
        port: config.port,
        baudRate: config.baudRate,
        openTimeoutMs: config.openTimeoutMs,
      }),
      config.openTimeoutMs,
      `Timed out opening Arduino LED controller serial port ${config.port}.`
    );
    opened = true;

    await sendAndExpect({
      connection,
      command: "PING",
      expectedResponse: "PONG",
      timeoutMs: config.commandTimeoutMs,
      commands,
    });
    allOffAttempted = true;
    await sendAndExpect({
      connection,
      command: "LED ALL OFF",
      expectedResponse: "OK",
      timeoutMs: config.commandTimeoutMs,
      commands,
    });
    allOffSucceeded = true;
  } catch (error) {
    primaryError = error instanceof Error ? error.message : "Unknown Arduino LED controller health error.";
  } finally {
    if (opened && connection) {
      if (!allOffAttempted) {
        allOffAttempted = true;
        try {
          await sendAndExpect({
            connection,
            command: "LED ALL OFF",
            expectedResponse: "OK",
            timeoutMs: config.commandTimeoutMs,
            commands,
          });
          allOffSucceeded = true;
        } catch (error) {
          safeShutdownError = error instanceof Error ? error.message : "Unknown Arduino LED all-off shutdown error.";
        }
      }

      try {
        await withTimeout(
          connection.close(),
          config.closeTimeoutMs,
          `Timed out closing Arduino LED controller serial port ${config.port}.`
        );
        closed = true;
      } catch (error) {
        safeShutdownError = error instanceof Error ? error.message : "Unknown Arduino LED serial close error.";
      }
    }
  }

  const status: ArduinoLedCommandStatus =
    primaryError || safeShutdownError || !opened || !closed || !allOffSucceeded ? "FAIL" : "PASS";
  return {
    ok: status === "PASS",
    status,
    port: config.port,
    baudRate: config.baudRate,
    opened,
    closed,
    allOffAttempted,
    allOffSucceeded,
    commands,
    ...(primaryError ? { error: primaryError } : {}),
    ...(safeShutdownError ? { safeShutdownError } : {}),
  };
}

export async function createNodeSerialArduinoLedTransport(): Promise<ArduinoLedSerialTransport> {
  return await createNodeSerialLineTransport("Arduino LED controller");
}
