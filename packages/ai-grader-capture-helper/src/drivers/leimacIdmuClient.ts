import net from "node:net";

export const LEIMAC_IDMU_DEFAULT_PORT = 1000;
export const LEIMAC_IDMU_DEFAULT_TIMEOUT_MS = 1500;
export const LEIMAC_IDMU_DISCOVERY_PORT = 50001;

export type LeimacIdmuReadCommandName =
  | "status"
  | "firmware"
  | "operationMode"
  | "temperature"
  | "unitInfo";

export interface LeimacIdmuReadCommandDefinition {
  name: LeimacIdmuReadCommandName;
  commandNumber: "08" | "16" | "47" | "80" | "83";
  description: string;
}

export const LEIMAC_IDMU_READ_COMMANDS: Record<LeimacIdmuReadCommandName, LeimacIdmuReadCommandDefinition> = {
  status: {
    name: "status",
    commandNumber: "08",
    description: "Status / error status",
  },
  firmware: {
    name: "firmware",
    commandNumber: "16",
    description: "Firmware version",
  },
  operationMode: {
    name: "operationMode",
    commandNumber: "47",
    description: "Operation mode",
  },
  temperature: {
    name: "temperature",
    commandNumber: "80",
    description: "Internal temperature data",
  },
  unitInfo: {
    name: "unitInfo",
    commandNumber: "83",
    description: "Unit information",
  },
};

export interface LeimacIdmuClientConfig {
  host?: string;
  port?: number;
  timeoutMs?: number;
  unit?: number;
  writesAllowed?: boolean;
  transport?: LeimacIdmuTransport;
}

export interface LeimacIdmuCommandRequest {
  host: string;
  port: number;
  timeoutMs: number;
  ascii: string;
  frame: string;
}

export interface LeimacIdmuTransport {
  send(request: LeimacIdmuCommandRequest): Promise<string>;
}

export interface LeimacIdmuCommandMetadata {
  name: LeimacIdmuReadCommandName;
  commandNumber: string;
  header: "R";
  unit: number;
  description: string;
  readOnly: true;
}

export interface LeimacIdmuComposedCommand {
  ascii: string;
  frame: string;
  terminator: "\\r\\n";
  metadata: LeimacIdmuCommandMetadata;
}

export interface LeimacIdmuSafetyMetadata {
  readOnly: true;
  writesAllowed: false;
  lightsCommanded: false;
  outputSettingsChanged: false;
  triggerSettingsChanged: false;
}

export interface LeimacIdmuParsedResponse {
  responseKind: "ack" | "nak" | "data" | "unknown";
  nakCode?: "NAK0" | "NAK1" | "WR00NAK" | "NAK";
  errorMeaning?: string;
  firmwareVersion?: string;
  unitModel?: string;
  temperatureC?: number;
  statusText?: string;
  operationMode?: string;
  parseConfidence: "confident" | "partial" | "unknown";
}

export interface LeimacIdmuCommandResult {
  ok: boolean;
  host: string;
  port: number;
  timeoutMs: number;
  command: LeimacIdmuCommandMetadata;
  requestAscii: string;
  rawResponse?: string;
  parsed: LeimacIdmuParsedResponse;
  durationMs: number;
  safety: LeimacIdmuSafetyMetadata;
  error?: string;
}

export interface LeimacIdmuReadinessResult {
  ok: boolean;
  status: "PASS" | "FAIL";
  controller: {
    family: "Leimac IDMU-P";
    host: string;
    port: number;
    unit: number;
    timeoutMs: number;
    protocol: "Leimac ASCII over TCP/IP";
  };
  commandsAttempted: LeimacIdmuCommandResult[];
  safety: LeimacIdmuSafetyMetadata;
  note: string;
}

export class LeimacIdmuClientError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "LeimacIdmuClientError";
    this.code = code;
  }
}

const READINESS_COMMANDS: LeimacIdmuReadCommandName[] = [
  "status",
  "firmware",
  "operationMode",
  "temperature",
  "unitInfo",
];

const SAFETY_METADATA: LeimacIdmuSafetyMetadata = {
  readOnly: true,
  writesAllowed: false,
  lightsCommanded: false,
  outputSettingsChanged: false,
  triggerSettingsChanged: false,
};

export function normalizeLeimacIdmuHost(host: string | undefined): string {
  const normalized = host?.trim();
  if (!normalized) {
    throw new LeimacIdmuClientError("LEIMAC_IDMU_HOST_REQUIRED", "Leimac IDMU readiness requires explicit --host <ip>.");
  }
  if (/[\\/]/.test(normalized) || normalized.includes("://") || /^[A-Za-z]:/.test(normalized) || normalized.includes("..")) {
    throw new LeimacIdmuClientError("LEIMAC_IDMU_HOST_INVALID", "--host must be an IP address, not a path or URL.");
  }
  if (net.isIP(normalized) === 0) {
    throw new LeimacIdmuClientError("LEIMAC_IDMU_HOST_INVALID", "--host must be an explicit IPv4 or IPv6 address.");
  }
  return normalized;
}

export function normalizeLeimacIdmuPort(port: number | string | undefined): number {
  const numeric = port == null || port === "" ? LEIMAC_IDMU_DEFAULT_PORT : Number(port);
  if (!Number.isInteger(numeric) || numeric <= 0 || numeric > 65535) {
    throw new LeimacIdmuClientError("LEIMAC_IDMU_PORT_INVALID", "--port must be a TCP port from 1 to 65535.");
  }
  if (numeric === LEIMAC_IDMU_DISCOVERY_PORT) {
    throw new LeimacIdmuClientError(
      "LEIMAC_IDMU_PORT_RESERVED",
      "Port 50001 is reserved for Leimac Discovery and cannot be used as the command port."
    );
  }
  return numeric;
}

export function normalizeLeimacIdmuTimeoutMs(timeoutMs: number | string | undefined): number {
  const numeric = timeoutMs == null || timeoutMs === "" ? LEIMAC_IDMU_DEFAULT_TIMEOUT_MS : Number(timeoutMs);
  if (!Number.isInteger(numeric) || numeric <= 0 || numeric > 10000) {
    throw new LeimacIdmuClientError("LEIMAC_IDMU_TIMEOUT_INVALID", "--timeout-ms must be a positive integer up to 10000.");
  }
  return numeric;
}

export function normalizeLeimacIdmuUnit(unit: number | string | undefined): number {
  const numeric = unit == null || unit === "" ? 1 : Number(unit);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 5) {
    throw new LeimacIdmuClientError("LEIMAC_IDMU_UNIT_INVALID", "--unit must be an integer from 1 to 5.");
  }
  return numeric;
}

export function leimacIdmuSafetyMetadata(): LeimacIdmuSafetyMetadata {
  return { ...SAFETY_METADATA };
}

export function composeLeimacIdmuReadCommand(
  name: LeimacIdmuReadCommandName,
  options: { unit?: number | string } = {}
): LeimacIdmuComposedCommand {
  const definition = LEIMAC_IDMU_READ_COMMANDS[name];
  if (!definition) {
    throw new LeimacIdmuClientError("LEIMAC_IDMU_COMMAND_NOT_ALLOWED", `Unsupported Leimac IDMU read command: ${name}.`);
  }
  const unit = normalizeLeimacIdmuUnit(options.unit);
  const ascii = `R${String(unit).padStart(2, "0")}${definition.commandNumber}`;
  return {
    ascii,
    frame: `${ascii}\r\n`,
    terminator: "\\r\\n",
    metadata: {
      name: definition.name,
      commandNumber: definition.commandNumber,
      header: "R",
      unit,
      description: definition.description,
      readOnly: true,
    },
  };
}

export function composeLeimacIdmuCommand(input: {
  header: "R" | "W";
  name: LeimacIdmuReadCommandName | string;
  unit?: number | string;
  writesAllowed?: boolean;
}): LeimacIdmuComposedCommand {
  if (input.header !== "R") {
    throw new LeimacIdmuClientError("LEIMAC_IDMU_WRITE_REJECTED", "Leimac IDMU write commands are prohibited in this PR.");
  }
  if (input.writesAllowed) {
    throw new LeimacIdmuClientError("LEIMAC_IDMU_WRITE_REJECTED", "Leimac IDMU writesAllowed=true is not supported.");
  }
  if (!Object.prototype.hasOwnProperty.call(LEIMAC_IDMU_READ_COMMANDS, input.name)) {
    throw new LeimacIdmuClientError("LEIMAC_IDMU_COMMAND_NOT_ALLOWED", `Leimac IDMU command is not in the read allowlist: ${input.name}.`);
  }
  return composeLeimacIdmuReadCommand(input.name as LeimacIdmuReadCommandName, { unit: input.unit });
}

export function parseLeimacIdmuResponse(command: LeimacIdmuCommandMetadata, rawResponse: string): LeimacIdmuParsedResponse {
  const trimmed = rawResponse.trim();
  const nakCode = parseNakCode(trimmed);
  if (nakCode) {
    return {
      responseKind: "nak",
      nakCode,
      errorMeaning: nakMeaning(nakCode),
      parseConfidence: "confident",
    };
  }

  if (!trimmed) {
    return { responseKind: "unknown", parseConfidence: "unknown" };
  }
  const payload = stripLeimacResponsePrefix(trimmed);

  if (/ACK/i.test(payload)) {
    return { responseKind: "ack", parseConfidence: "partial" };
  }

  if (command.name === "firmware") {
    const version = payload.match(/\b\d+(?:\.\d+){1,4}\b/)?.[0];
    return {
      responseKind: "data",
      ...(version ? { firmwareVersion: version } : {}),
      parseConfidence: version ? "partial" : "unknown",
    };
  }

  if (command.name === "unitInfo") {
    const unitModel = payload.match(/\bIDMU-P[A-Z0-9-]+\b/i)?.[0];
    return {
      responseKind: "data",
      ...(unitModel ? { unitModel } : {}),
      parseConfidence: unitModel ? "partial" : "unknown",
    };
  }

  if (command.name === "temperature") {
    const numeric = payload.match(/-?\d+(?:\.\d+)?/)?.[0];
    const temperatureC = numeric == null ? undefined : Number(numeric);
    const plausible = typeof temperatureC === "number" && Number.isFinite(temperatureC) && temperatureC >= -20 && temperatureC <= 150;
    return {
      responseKind: "data",
      ...(plausible ? { temperatureC } : {}),
      parseConfidence: plausible ? "partial" : "unknown",
    };
  }

  if (command.name === "operationMode") {
    const mode = payload.match(/\b(LevelHigh|RisingEdge|LevelLow|FallingEdge|External|Internal|Trigger|Continuous)\b/i)?.[0];
    return {
      responseKind: "data",
      ...(mode ? { operationMode: mode } : {}),
      parseConfidence: mode ? "partial" : "unknown",
    };
  }

  if (command.name === "status") {
    const statusText = payload.match(/\b(OK|NORMAL|ERROR|OVERCURRENT|TEMP|TEMPERATURE)\b/i)?.[0];
    return {
      responseKind: "data",
      ...(statusText ? { statusText } : {}),
      parseConfidence: statusText ? "partial" : "unknown",
    };
  }

  return { responseKind: "data", parseConfidence: "unknown" };
}

export class LeimacIdmuClient {
  private readonly host: string;
  private readonly port: number;
  private readonly timeoutMs: number;
  private readonly unit: number;
  private readonly transport: LeimacIdmuTransport;

  constructor(config: LeimacIdmuClientConfig = {}) {
    this.host = normalizeLeimacIdmuHost(config.host);
    this.port = normalizeLeimacIdmuPort(config.port);
    this.timeoutMs = normalizeLeimacIdmuTimeoutMs(config.timeoutMs);
    this.unit = normalizeLeimacIdmuUnit(config.unit);
    if (config.writesAllowed) {
      throw new LeimacIdmuClientError("LEIMAC_IDMU_WRITE_REJECTED", "Leimac IDMU writesAllowed=true is not supported.");
    }
    this.transport = config.transport ?? createNodeLeimacIdmuTcpTransport();
  }

  async readCommand(name: LeimacIdmuReadCommandName, unit = this.unit): Promise<LeimacIdmuCommandResult> {
    const composed = composeLeimacIdmuReadCommand(name, { unit });
    const startedAt = Date.now();
    try {
      const rawResponse = await this.transport.send({
        host: this.host,
        port: this.port,
        timeoutMs: this.timeoutMs,
        ascii: composed.ascii,
        frame: composed.frame,
      });
      const parsed = parseLeimacIdmuResponse(composed.metadata, rawResponse);
      return {
        ok: parsed.responseKind !== "nak",
        host: this.host,
        port: this.port,
        timeoutMs: this.timeoutMs,
        command: composed.metadata,
        requestAscii: composed.ascii,
        rawResponse,
        parsed,
        durationMs: Date.now() - startedAt,
        safety: leimacIdmuSafetyMetadata(),
        ...(parsed.responseKind === "nak" ? { error: parsed.errorMeaning ?? "Leimac IDMU returned NAK." } : {}),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Leimac IDMU command error.";
      return {
        ok: false,
        host: this.host,
        port: this.port,
        timeoutMs: this.timeoutMs,
        command: composed.metadata,
        requestAscii: composed.ascii,
        parsed: { responseKind: "unknown", parseConfidence: "unknown" },
        durationMs: Date.now() - startedAt,
        safety: leimacIdmuSafetyMetadata(),
        error: message,
      };
    }
  }

  async status(): Promise<LeimacIdmuCommandResult> {
    return this.readCommand("status");
  }

  async readiness(): Promise<LeimacIdmuReadinessResult> {
    const commandsAttempted: LeimacIdmuCommandResult[] = [];
    for (const commandName of READINESS_COMMANDS) {
      commandsAttempted.push(await this.readCommand(commandName));
    }
    const ok = commandsAttempted.every((result) => result.ok);
    return {
      ok,
      status: ok ? "PASS" : "FAIL",
      controller: {
        family: "Leimac IDMU-P",
        host: this.host,
        port: this.port,
        unit: this.unit,
        timeoutMs: this.timeoutMs,
        protocol: "Leimac ASCII over TCP/IP",
      },
      commandsAttempted,
      safety: leimacIdmuSafetyMetadata(),
      note:
        "Read-only Leimac IDMU-P readiness only; sends R commands from the allowlist and never changes light output, PWM, brightness, trigger, or controller settings.",
    };
  }
}

export function createNodeLeimacIdmuTcpTransport(): LeimacIdmuTransport {
  return {
    send(request) {
      return new Promise<string>((resolve, reject) => {
        const socket = net.createConnection({
          host: request.host,
          port: request.port,
        });
        let settled = false;
        const chunks: Buffer[] = [];

        const finish = (callback: () => void) => {
          if (settled) return;
          settled = true;
          socket.destroy();
          callback();
        };

        const timer = setTimeout(() => {
          finish(() =>
            reject(
              new LeimacIdmuClientError(
                "LEIMAC_IDMU_TIMEOUT",
                `Timed out waiting for Leimac IDMU response from ${request.host}:${request.port}.`
              )
            )
          );
        }, request.timeoutMs);

        socket.setNoDelay(true);
        socket.on("connect", () => {
          socket.write(request.frame, "ascii");
        });
        socket.on("data", (chunk) => {
          chunks.push(Buffer.from(chunk));
          const response = Buffer.concat(chunks).toString("ascii");
          if (response.includes("\n") || response.includes("\r") || response.length >= 3) {
            clearTimeout(timer);
            finish(() => resolve(response));
          }
        });
        socket.on("error", (error) => {
          clearTimeout(timer);
          finish(() =>
            reject(
              new LeimacIdmuClientError(
                "LEIMAC_IDMU_SOCKET_ERROR",
                `Leimac IDMU TCP error for ${request.host}:${request.port}: ${error.message}`
              )
            )
          );
        });
        socket.on("close", () => {
          if (settled) return;
          clearTimeout(timer);
          const response = Buffer.concat(chunks).toString("ascii");
          finish(() => {
            if (response) resolve(response);
            else reject(new LeimacIdmuClientError("LEIMAC_IDMU_NO_RESPONSE", "Leimac IDMU TCP connection closed without a response."));
          });
        });
      });
    },
  };
}

function parseNakCode(response: string): LeimacIdmuParsedResponse["nakCode"] | undefined {
  const upper = response.toUpperCase();
  if (upper.includes("WR00NAK")) return "WR00NAK";
  if (upper.includes("NAK0")) return "NAK0";
  if (upper.includes("NAK1")) return "NAK1";
  if (upper.includes("NAK")) return "NAK";
  return undefined;
}

function stripLeimacResponsePrefix(response: string): string {
  return response.replace(/^[RW]{1,2}\d{2}/i, "").trim();
}

function nakMeaning(code: NonNullable<LeimacIdmuParsedResponse["nakCode"]>): string {
  switch (code) {
    case "NAK0":
      return "Setting value incorrect.";
    case "NAK1":
      return "Target designation problem.";
    case "WR00NAK":
      return "Other error, incorrect header, or incorrect command.";
    case "NAK":
      return "Leimac IDMU returned a NAK response.";
  }
}
