import {
  createNodeSerialLineTransport,
  type SerialLineConnection,
  type SerialLineOpenOptions,
  type SerialLineTransport,
} from "./serialTransport";

export const GRBL_STAGE_DEFAULT_BAUD_RATE = 115200;
export const GRBL_STAGE_DEFAULT_TIMEOUT_MS = 1000;
export const GRBL_STAGE_DEFAULT_OPEN_TIMEOUT_MS = 2000;
export const GRBL_STAGE_DEFAULT_CLOSE_TIMEOUT_MS = 1000;
export const GRBL_STAGE_STATUS_QUERY = "?";

export interface GrblStageConfigInput {
  port?: string;
  baudRate?: number | string;
  commandTimeoutMs?: number | string;
  openTimeoutMs?: number | string;
  closeTimeoutMs?: number | string;
}

export interface GrblStageConfig {
  port?: string;
  baudRate: number;
  commandTimeoutMs: number;
  openTimeoutMs: number;
  closeTimeoutMs: number;
}

export type GrblStageSerialOpenOptions = SerialLineOpenOptions;
export type GrblStageSerialConnection = SerialLineConnection;
export type GrblStageSerialTransport = SerialLineTransport;

export type GrblStageHealthStatus = "PASS" | "FAIL";

export interface GrblStageStatusResponse {
  raw: string;
  machineState: string;
  fields: Record<string, string>;
  fieldOrder: string[];
}

export interface GrblStageStatusQueryResult {
  command: typeof GRBL_STAGE_STATUS_QUERY;
  expectedResponse: "GRBL_STATUS";
  response?: string;
  parsed?: GrblStageStatusResponse;
  status: GrblStageHealthStatus;
  durationMs: number;
  error?: string;
}

export interface GrblStageHealthResult {
  ok: boolean;
  status: GrblStageHealthStatus;
  port?: string;
  baudRate: number;
  opened: boolean;
  closed: boolean;
  queries: GrblStageStatusQueryResult[];
  statusResponse?: GrblStageStatusResponse;
  error?: string;
  closeError?: string;
}

export interface GrblStageHealthCheckOptions {
  config: GrblStageConfigInput;
  env?: Record<string, string | undefined>;
  transport?: GrblStageSerialTransport;
}

export class GrblStageHealthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GrblStageHealthError";
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
    throw new GrblStageHealthError(`${label} must be a positive integer.`);
  }
  return numeric;
}

export function buildGrblStageConfig(
  input: GrblStageConfigInput = {},
  env: Record<string, string | undefined> = process.env
): GrblStageConfig {
  return {
    port: firstNonEmpty(input.port, env.AI_GRADER_CAPTURE_HELPER_GRBL_STAGE_PORT),
    baudRate: normalizePositiveInteger(
      input.baudRate ?? env.AI_GRADER_CAPTURE_HELPER_GRBL_STAGE_BAUD_RATE,
      GRBL_STAGE_DEFAULT_BAUD_RATE,
      "GRBL stage baud rate"
    ),
    commandTimeoutMs: normalizePositiveInteger(
      input.commandTimeoutMs ?? env.AI_GRADER_CAPTURE_HELPER_GRBL_STAGE_TIMEOUT_MS,
      GRBL_STAGE_DEFAULT_TIMEOUT_MS,
      "GRBL stage command timeout"
    ),
    openTimeoutMs: normalizePositiveInteger(
      input.openTimeoutMs ?? env.AI_GRADER_CAPTURE_HELPER_GRBL_STAGE_OPEN_TIMEOUT_MS,
      GRBL_STAGE_DEFAULT_OPEN_TIMEOUT_MS,
      "GRBL stage open timeout"
    ),
    closeTimeoutMs: normalizePositiveInteger(
      input.closeTimeoutMs ?? env.AI_GRADER_CAPTURE_HELPER_GRBL_STAGE_CLOSE_TIMEOUT_MS,
      GRBL_STAGE_DEFAULT_CLOSE_TIMEOUT_MS,
      "GRBL stage close timeout"
    ),
  };
}

export function isGrblStageRequested(
  inputKind: string | undefined,
  env: Record<string, string | undefined> = process.env
): boolean {
  const normalized = firstNonEmpty(inputKind, env.AI_GRADER_CAPTURE_HELPER_STAGE_KIND)?.toLowerCase();
  return normalized === "grbl" || normalized === "openbuilds";
}

export function parseGrblStatusResponse(response: string): GrblStageStatusResponse {
  const trimmed = response.trim();
  const match = /^<([^|>]+)(?:\|([^>]*))?>$/.exec(trimmed);
  if (!match) {
    throw new GrblStageHealthError(`Unexpected GRBL stage status response: ${response}.`);
  }

  const fieldOrder: string[] = [];
  const fields: Record<string, string> = {};
  const fieldText = match[2];
  if (fieldText) {
    for (const field of fieldText.split("|").filter(Boolean)) {
      const separator = field.indexOf(":");
      if (separator < 0) {
        fieldOrder.push(field);
        fields[field] = "";
        continue;
      }
      const key = field.slice(0, separator);
      const value = field.slice(separator + 1);
      fieldOrder.push(key);
      fields[key] = value;
    }
  }

  return {
    raw: trimmed,
    machineState: match[1],
    fields,
    fieldOrder,
  };
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new GrblStageHealthError(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function writeStatusQuery(connection: GrblStageSerialConnection): Promise<void> {
  if (connection.writeRaw) {
    await connection.writeRaw(GRBL_STAGE_STATUS_QUERY);
    return;
  }
  await connection.writeLine(GRBL_STAGE_STATUS_QUERY);
}

async function queryStatus(input: {
  connection: GrblStageSerialConnection;
  timeoutMs: number;
  queries: GrblStageStatusQueryResult[];
}): Promise<GrblStageStatusResponse> {
  const startedAt = Date.now();
  const result: GrblStageStatusQueryResult = {
    command: GRBL_STAGE_STATUS_QUERY,
    expectedResponse: "GRBL_STATUS",
    status: "FAIL",
    durationMs: 0,
  };
  input.queries.push(result);

  try {
    await withTimeout(
      writeStatusQuery(input.connection),
      input.timeoutMs,
      "Timed out writing GRBL stage status query."
    );
    const response = await withTimeout(
      input.connection.readLine(),
      input.timeoutMs,
      "Timed out waiting for GRBL stage status response."
    );
    result.response = response;
    const parsed = parseGrblStatusResponse(response);
    result.parsed = parsed;
    result.status = "PASS";
    return parsed;
  } catch (error) {
    result.error = error instanceof Error ? error.message : "Unknown GRBL stage status query error.";
    throw error;
  } finally {
    result.durationMs = Date.now() - startedAt;
  }
}

function failResult(
  config: GrblStageConfig,
  message: string,
  partial: Partial<GrblStageHealthResult> = {}
): GrblStageHealthResult {
  return {
    ok: false,
    status: "FAIL",
    port: config.port,
    baudRate: config.baudRate,
    opened: false,
    closed: false,
    queries: [],
    ...partial,
    error: message,
  };
}

export async function runGrblStageHealthCheck(options: GrblStageHealthCheckOptions): Promise<GrblStageHealthResult> {
  const config = buildGrblStageConfig(options.config, options.env ?? {});
  const queries: GrblStageStatusQueryResult[] = [];
  let connection: GrblStageSerialConnection | undefined;
  let opened = false;
  let closed = false;
  let statusResponse: GrblStageStatusResponse | undefined;
  let primaryError: string | undefined;
  let closeError: string | undefined;

  if (!config.port) {
    return failResult(config, "GRBL stage serial port is required for real hardware readiness.");
  }

  try {
    const transport = options.transport ?? await createNodeSerialGrblStageTransport();
    connection = await withTimeout(
      transport.open({
        port: config.port,
        baudRate: config.baudRate,
        openTimeoutMs: config.openTimeoutMs,
      }),
      config.openTimeoutMs,
      `Timed out opening GRBL stage serial port ${config.port}.`
    );
    opened = true;
    statusResponse = await queryStatus({
      connection,
      timeoutMs: config.commandTimeoutMs,
      queries,
    });
  } catch (error) {
    primaryError = error instanceof Error ? error.message : "Unknown GRBL stage health error.";
  } finally {
    if (opened && connection) {
      try {
        await withTimeout(
          connection.close(),
          config.closeTimeoutMs,
          `Timed out closing GRBL stage serial port ${config.port}.`
        );
        closed = true;
      } catch (error) {
        closeError = error instanceof Error ? error.message : "Unknown GRBL stage serial close error.";
      }
    }
  }

  const status: GrblStageHealthStatus = primaryError || closeError || !opened || !closed || !statusResponse ? "FAIL" : "PASS";
  return {
    ok: status === "PASS",
    status,
    port: config.port,
    baudRate: config.baudRate,
    opened,
    closed,
    queries,
    ...(statusResponse ? { statusResponse } : {}),
    ...(primaryError ? { error: primaryError } : {}),
    ...(closeError ? { closeError } : {}),
  };
}

export async function createNodeSerialGrblStageTransport(): Promise<GrblStageSerialTransport> {
  return await createNodeSerialLineTransport("GRBL stage");
}
