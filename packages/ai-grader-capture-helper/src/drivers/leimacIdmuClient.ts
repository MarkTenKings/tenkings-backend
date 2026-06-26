import net from "node:net";

export const LEIMAC_IDMU_DEFAULT_PORT = 1000;
export const LEIMAC_IDMU_DEFAULT_TIMEOUT_MS = 1500;
export const LEIMAC_IDMU_DISCOVERY_PORT = 50001;
export const LEIMAC_IDMU_MAX_DIAGNOSTIC_FRAME_LENGTH = 32;
export const LEIMAC_IDMU_TRIGGER_PROFILE_CONFIRMATION = "APPLY LEIMAC LOW DUTY TRIGGER PROFILE";
export const LEIMAC_IDMU_SAFE_OFF_CONFIRMATION = "APPLY LEIMAC SAFE OFF";
export const LEIMAC_IDMU_MAX_FIRST_SMOKE_DUTY_PERCENT = 5;
export const LEIMAC_IDMU_CHANNEL_COUNT_BASE_UNIT = 8;

export type LeimacIdmuReadCommandName =
  | "status"
  | "firmware"
  | "operationMode"
  | "temperature"
  | "unitInfo";

export type LeimacIdmuReadTargetRequirement = "unit" | "unitOrSystem" | "none";
export type LeimacIdmuReadTargetKind = "unit" | "system" | "none";

export interface LeimacIdmuReadCommandDefinition {
  name: LeimacIdmuReadCommandName;
  commandNumber: "08" | "16" | "47" | "80" | "83";
  description: string;
  targetRequirement: LeimacIdmuReadTargetRequirement;
  requestData?: string;
}

export const LEIMAC_IDMU_READ_COMMANDS: Record<LeimacIdmuReadCommandName, LeimacIdmuReadCommandDefinition> = {
  status: {
    name: "status",
    commandNumber: "08",
    description: "Status / error status",
    targetRequirement: "unitOrSystem",
  },
  firmware: {
    name: "firmware",
    commandNumber: "16",
    description: "Firmware version",
    targetRequirement: "unit",
  },
  operationMode: {
    name: "operationMode",
    commandNumber: "47",
    description: "Operation mode",
    targetRequirement: "none",
  },
  temperature: {
    name: "temperature",
    commandNumber: "80",
    description: "Internal temperature data",
    targetRequirement: "unit",
  },
  unitInfo: {
    name: "unitInfo",
    commandNumber: "83",
    description: "Unit information",
    targetRequirement: "none",
    requestData: "0000",
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
  unit?: number;
  targetDesignation?: string;
  targetKind: LeimacIdmuReadTargetKind;
  description: string;
  readOnly: true;
}

export interface LeimacIdmuDiagnosticFrameMetadata {
  name: LeimacIdmuReadCommandName;
  commandNumber: string;
  header: "R";
  targetDesignation?: string;
  targetKind: LeimacIdmuReadTargetKind;
  description: string;
  readOnly: true;
  diagnosticFrame: true;
}

export interface LeimacIdmuComposedCommand {
  ascii: string;
  frame: string;
  terminator: "";
  metadata: LeimacIdmuCommandMetadata;
}

export interface LeimacIdmuSafetyMetadata {
  readOnly: true;
  writesAllowed: false;
  lightsCommanded: false;
  outputSettingsChanged: false;
  triggerSettingsChanged: false;
}

export type LeimacIdmuTriggerProfileName = "basler-line2-trg-in1-low-duty";
export type LeimacIdmuWriteCommandName =
  | "triggerActivation"
  | "lightingOutputValue"
  | "lightingOutputDelay"
  | "triggerSource"
  | "triggerSynchronizationMode"
  | "asynchronousOutput"
  | "lightingOutput";

export interface LeimacIdmuWriteFrame {
  name: LeimacIdmuWriteCommandName;
  commandNumber: "09" | "11" | "13" | "65" | "84" | "85" | "86";
  description: string;
  targetDesignation: string;
  channelValues: Array<{
    channel: number;
    value: string;
    meaning: string;
  }>;
  requestAscii: string;
  requestFrame: string;
  terminator: "";
  allowlisted: true;
}

export interface LeimacIdmuWriteResult {
  ok: boolean;
  host: string;
  port: number;
  timeoutMs: number;
  frame: LeimacIdmuWriteFrame;
  rawResponse?: string;
  responseKind: "ack" | "nak" | "unknown";
  error?: string;
}

export interface LeimacIdmuTriggerProfilePlan {
  profile: LeimacIdmuTriggerProfileName;
  unit: number;
  dutyPercent: number;
  dutySteps: number;
  maxDutyPercent: 5;
  commandFormat: "Header + CommandNumber + UnitNumber + repeated ChannelNumber/SettingValue data";
  persistentSaved: false;
  outputTimeWritten: false;
  reasonOutputTimeNotWritten: "Synchronous mode is intended to follow Basler Exposure Active; output-time command is intentionally omitted in PR #36.";
  frames: LeimacIdmuWriteFrame[];
  safeOffFrames: LeimacIdmuWriteFrame[];
  safety: {
    dryRun: boolean;
    applyRequiresConfirmation: true;
    writesApplied: boolean;
    lightsCommanded: boolean;
    outputSettingsChanged: boolean;
    triggerSettingsChanged: boolean;
    persistentSaved: false;
    arbitraryWritesAllowed: false;
    maxDutyPercent: 5;
  };
}

export interface LeimacIdmuTriggerProfileApplyResult {
  ok: boolean;
  host: string;
  port: number;
  timeoutMs: number;
  applied: boolean;
  unitInfo?: LeimacIdmuCommandResult;
  plan: LeimacIdmuTriggerProfilePlan;
  writes: LeimacIdmuWriteResult[];
  safeOffBeforeProfile: LeimacIdmuWriteResult[];
  error?: string;
}

export interface LeimacIdmuSafeOffResult {
  ok: boolean;
  host: string;
  port: number;
  timeoutMs: number;
  applied: boolean;
  frames: LeimacIdmuWriteFrame[];
  writes: LeimacIdmuWriteResult[];
  safety: {
    writesApplied: boolean;
    lightsCommanded: false;
    outputSettingsChanged: boolean;
    triggerSettingsChanged: false;
    persistentSaved: false;
    arbitraryWritesAllowed: false;
  };
  error?: string;
}

export interface LeimacIdmuParsedResponse {
  responseKind: "ack" | "nak" | "data" | "unknown";
  nakCode?: "NAK0" | "NAK1" | "WR00NAK" | "NAK";
  errorMeaning?: string;
  firmwareVersion?: string;
  unitModel?: string;
  unitInformation?: {
    totalUnits?: number;
    units: Array<{
      index: number;
      dimmingMethodCode: string;
      lightingOutputChannels?: number;
    }>;
  };
  temperatureC?: number;
  temperaturePoints?: Array<{
    point: number;
    temperatureC: number;
  }>;
  statusCode?: string;
  statusMeaning?: string;
  statusText?: string;
  operationModeCode?: string;
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
  requestFrame: string;
  rawResponse?: string;
  parsed: LeimacIdmuParsedResponse;
  durationMs: number;
  safety: LeimacIdmuSafetyMetadata;
  error?: string;
}

export interface LeimacIdmuDiagnosticFrameResult {
  ok: boolean;
  host: string;
  port: number;
  timeoutMs: number;
  command: LeimacIdmuDiagnosticFrameMetadata;
  requestAscii: string;
  requestFrame: string;
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

export interface LeimacIdmuTriggerSyncPlan {
  mode: "basler-exposure-active-to-trg-in1";
  architecture: {
    capture: "Basler ace 2 macro image capture";
    triggerOutput: "Basler Line 2 Exposure Active";
    triggerInput: "Leimac TRG IN1";
    lightingBehavior: "Leimac lighting fires during camera exposure after future approved configuration";
  };
  basler: {
    lineSelector: "Line 2";
    lineMode: "Output";
    lineInverter: false;
    lineSource: "Exposure Active";
  };
  leimac: {
    triggerInput: "TRG IN1";
    triggerControlMode: "Level Low";
  };
  wiring: Array<{
    from: string;
    to: string;
  }>;
  requiredCable: "CEBR119 or CEBR120";
  requiredTriggerSupply: "5-24 VDC";
  safety: {
    dryRun: true;
    writesApplied: false;
    lightsCommanded: false;
    baslerSettingsChanged: false;
    leimacSettingsChanged: false;
  };
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

const WRITE_COMMAND_DESCRIPTIONS: Record<LeimacIdmuWriteCommandName, LeimacIdmuWriteFrame["description"]> = {
  triggerActivation: "Trigger activation; LevelLow for Basler Line 2 guide wiring",
  lightingOutputValue: "Lighting output value; PWM duty cycle in 1000 steps",
  lightingOutputDelay: "Lighting output delay time; 1 microsecond steps",
  triggerSource: "Trigger source; TRG IN1",
  triggerSynchronizationMode: "Trigger synchronization mode; synchronous",
  asynchronousOutput: "Asynchronous output ON/OFF; OFF for trigger-only profile",
  lightingOutput: "Lighting output ON/OFF; channel enable or safe off",
};

const WRITE_COMMAND_NUMBERS: Record<LeimacIdmuWriteCommandName, LeimacIdmuWriteFrame["commandNumber"]> = {
  triggerActivation: "09",
  lightingOutputValue: "11",
  lightingOutputDelay: "13",
  triggerSource: "65",
  triggerSynchronizationMode: "84",
  asynchronousOutput: "85",
  lightingOutput: "86",
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

function normalizeLeimacIdmuReadTarget(
  definition: LeimacIdmuReadCommandDefinition,
  unit: number | string | undefined
): { unit?: number; targetDesignation?: string; targetKind: LeimacIdmuReadTargetKind } {
  if (definition.targetRequirement === "none") {
    return { targetKind: "none" };
  }
  const numeric = unit == null || unit === "" ? 1 : Number(unit);
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > 5) {
    throw new LeimacIdmuClientError("LEIMAC_IDMU_UNIT_INVALID", "--unit must be an integer from 1 to 5, or 0 for system status.");
  }
  if (definition.targetRequirement === "unit" && numeric === 0) {
    throw new LeimacIdmuClientError("LEIMAC_IDMU_UNIT_INVALID", `Leimac IDMU ${definition.name} requires a unit from 1 to 5.`);
  }
  return {
    ...(numeric > 0 ? { unit: numeric } : {}),
    targetDesignation: String(numeric).padStart(2, "0"),
    targetKind: numeric === 0 ? "system" : "unit",
  };
}

export function composeLeimacIdmuReadCommand(
  name: LeimacIdmuReadCommandName,
  options: { unit?: number | string } = {}
): LeimacIdmuComposedCommand {
  const definition = LEIMAC_IDMU_READ_COMMANDS[name];
  if (!definition) {
    throw new LeimacIdmuClientError("LEIMAC_IDMU_COMMAND_NOT_ALLOWED", `Unsupported Leimac IDMU read command: ${name}.`);
  }
  const target = normalizeLeimacIdmuReadTarget(definition, options.unit);
  const ascii = `R${definition.commandNumber}${target.targetDesignation ?? ""}${definition.requestData ?? ""}`;
  return {
    ascii,
    frame: ascii,
    terminator: "",
    metadata: {
      name: definition.name,
      commandNumber: definition.commandNumber,
      header: "R",
      ...("unit" in target ? { unit: target.unit } : {}),
      ...("targetDesignation" in target ? { targetDesignation: target.targetDesignation } : {}),
      targetKind: target.targetKind,
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

export function composeLeimacIdmuUnsafeWriteCommandForTest(input: {
  commandNumber: string;
  targetDesignation: string;
  data: string;
}): { ascii: string; frame: string; terminator: ""; metadata: { header: "W"; commandNumber: string; targetDesignation: string; testOnly: true } } {
  const commandNumber = input.commandNumber.trim();
  const targetDesignation = input.targetDesignation.trim();
  const data = input.data.trim();
  if (!/^\d{2}$/.test(commandNumber)) {
    throw new LeimacIdmuClientError("LEIMAC_IDMU_COMMAND_INVALID", "Leimac IDMU command number must be two decimal digits.");
  }
  if (!/^\d{2}$/.test(targetDesignation)) {
    throw new LeimacIdmuClientError("LEIMAC_IDMU_TARGET_INVALID", "Leimac IDMU target designation must be two decimal digits.");
  }
  if (!/^[A-Za-z0-9.-]*$/.test(data)) {
    throw new LeimacIdmuClientError("LEIMAC_IDMU_DATA_INVALID", "Leimac IDMU test data must be printable command data.");
  }
  const ascii = `W${commandNumber}${targetDesignation}${data}`;
  return {
    ascii,
    frame: ascii,
    terminator: "",
    metadata: {
      header: "W",
      commandNumber,
      targetDesignation,
      testOnly: true,
    },
  };
}

export function normalizeLeimacIdmuDiagnosticReadFrame(frame: string | undefined): string {
  const normalized = frame?.trim();
  if (!normalized) {
    throw new LeimacIdmuClientError("LEIMAC_IDMU_FRAME_REQUIRED", "leimac-idmu-read-frame requires explicit --frame <R...>.");
  }
  if (normalized.length > LEIMAC_IDMU_MAX_DIAGNOSTIC_FRAME_LENGTH) {
    throw new LeimacIdmuClientError(
      "LEIMAC_IDMU_FRAME_TOO_LONG",
      `Leimac IDMU diagnostic frames must be ${LEIMAC_IDMU_MAX_DIAGNOSTIC_FRAME_LENGTH} ASCII characters or fewer.`
    );
  }
  if (normalized.includes("W")) {
    throw new LeimacIdmuClientError("LEIMAC_IDMU_WRITE_REJECTED", "Leimac IDMU diagnostic read-frame rejects W/write frames.");
  }
  if (!/^[A-Z0-9]+$/.test(normalized)) {
    throw new LeimacIdmuClientError(
      "LEIMAC_IDMU_FRAME_INVALID",
      "Leimac IDMU diagnostic frames must use uppercase ASCII alphanumeric characters only."
    );
  }
  if (!normalized.startsWith("R")) {
    throw new LeimacIdmuClientError("LEIMAC_IDMU_FRAME_NOT_READ", "Leimac IDMU diagnostic frames must start with R.");
  }
  const commandNumber = normalized.slice(1, 3);
  if (!Object.values(LEIMAC_IDMU_READ_COMMANDS).some((command) => command.commandNumber === commandNumber)) {
    throw new LeimacIdmuClientError(
      "LEIMAC_IDMU_COMMAND_NOT_ALLOWED",
      `Leimac IDMU diagnostic frame command is not in the read allowlist: ${commandNumber}.`
    );
  }
  return normalized;
}

export function metadataForLeimacIdmuDiagnosticReadFrame(frame: string): LeimacIdmuDiagnosticFrameMetadata {
  const normalized = normalizeLeimacIdmuDiagnosticReadFrame(frame);
  const commandNumber = normalized.slice(1, 3);
  const definition = Object.values(LEIMAC_IDMU_READ_COMMANDS).find((command) => command.commandNumber === commandNumber);
  if (!definition) {
    throw new LeimacIdmuClientError(
      "LEIMAC_IDMU_COMMAND_NOT_ALLOWED",
      `Leimac IDMU diagnostic frame command is not in the read allowlist: ${commandNumber}.`
    );
  }
  const maybeTarget = normalized.length >= 5 ? normalized.slice(3, 5) : undefined;
  const targetKind: LeimacIdmuReadTargetKind =
    definition.targetRequirement === "none" ? "none" : maybeTarget === "00" ? "system" : "unit";
  return {
    name: definition.name,
    commandNumber: definition.commandNumber,
    header: "R",
    ...(maybeTarget && definition.targetRequirement !== "none" ? { targetDesignation: maybeTarget } : {}),
    targetKind,
    description: definition.description,
    readOnly: true,
    diagnosticFrame: true,
  };
}

export function buildLeimacIdmuTriggerSyncPlan(mode = "basler-exposure-active-to-trg-in1"): LeimacIdmuTriggerSyncPlan {
  if (mode !== "basler-exposure-active-to-trg-in1") {
    throw new LeimacIdmuClientError(
      "LEIMAC_IDMU_TRIGGER_SYNC_MODE_INVALID",
      "Unsupported Leimac trigger sync plan mode. Use basler-exposure-active-to-trg-in1."
    );
  }
  return {
    mode,
    architecture: {
      capture: "Basler ace 2 macro image capture",
      triggerOutput: "Basler Line 2 Exposure Active",
      triggerInput: "Leimac TRG IN1",
      lightingBehavior: "Leimac lighting fires during camera exposure after future approved configuration",
    },
    basler: {
      lineSelector: "Line 2",
      lineMode: "Output",
      lineInverter: false,
      lineSource: "Exposure Active",
    },
    leimac: {
      triggerInput: "TRG IN1",
      triggerControlMode: "Level Low",
    },
    wiring: [
      {
        from: "Basler Pin 4 / Line 2 / black wire",
        to: "Leimac Pin 2 / TRG IN1",
      },
      {
        from: "Basler Pin 6 / Ground / pink wire",
        to: "trigger supply GND",
      },
      {
        from: "Leimac Pin 1 / IN_COM",
        to: "trigger supply V+",
      },
    ],
    requiredCable: "CEBR119 or CEBR120",
    requiredTriggerSupply: "5-24 VDC",
    safety: {
      dryRun: true,
      writesApplied: false,
      lightsCommanded: false,
      baslerSettingsChanged: false,
      leimacSettingsChanged: false,
    },
  };
}

export function normalizeLeimacIdmuDutyPercent(value: number | string | undefined): number {
  const numeric = value == null || value === "" ? LEIMAC_IDMU_MAX_FIRST_SMOKE_DUTY_PERCENT : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new LeimacIdmuClientError("LEIMAC_IDMU_DUTY_INVALID", "--duty must be a number from 0 to 5 for the first smoke.");
  }
  if (numeric > LEIMAC_IDMU_MAX_FIRST_SMOKE_DUTY_PERCENT) {
    throw new LeimacIdmuClientError("LEIMAC_IDMU_DUTY_TOO_HIGH", "PR #36 first-smoke duty is capped at 5%.");
  }
  return numeric;
}

export function leimacIdmuDutyPercentToSteps(dutyPercent: number): number {
  const normalized = normalizeLeimacIdmuDutyPercent(dutyPercent);
  return Math.round((normalized / 100) * 1000);
}

export function composeLeimacIdmuChannelWriteFrame(input: {
  name: LeimacIdmuWriteCommandName;
  unit?: number | string;
  value: string;
  meaning: string;
  channels?: number;
}): LeimacIdmuWriteFrame {
  const unit = normalizeLeimacIdmuUnit(input.unit);
  const targetDesignation = String(unit).padStart(2, "0");
  const value = input.value.trim();
  if (!/^\d{4}$/.test(value)) {
    throw new LeimacIdmuClientError("LEIMAC_IDMU_WRITE_VALUE_INVALID", "Leimac IDMU trigger-profile values must be four digits.");
  }
  const commandNumber = WRITE_COMMAND_NUMBERS[input.name];
  if (!commandNumber) {
    throw new LeimacIdmuClientError("LEIMAC_IDMU_WRITE_REJECTED", "Leimac IDMU write command is not in the PR #36 trigger-profile allowlist.");
  }
  const channels = input.channels ?? LEIMAC_IDMU_CHANNEL_COUNT_BASE_UNIT;
  if (!Number.isInteger(channels) || channels < 1 || channels > LEIMAC_IDMU_CHANNEL_COUNT_BASE_UNIT) {
    throw new LeimacIdmuClientError("LEIMAC_IDMU_CHANNEL_COUNT_INVALID", "Leimac IDMU PR #36 supports 1 to 8 channels on the confirmed base unit.");
  }
  const channelValues = Array.from({ length: channels }, (_, index) => ({
    channel: index + 1,
    value,
    meaning: input.meaning,
  }));
  const data = channelValues.map((entry) => `${String(entry.channel).padStart(2, "0")}${entry.value}`).join("");
  const requestAscii = `W${commandNumber}${targetDesignation}${data}`;
  return {
    name: input.name,
    commandNumber,
    description: WRITE_COMMAND_DESCRIPTIONS[input.name],
    targetDesignation,
    channelValues,
    requestAscii,
    requestFrame: requestAscii,
    terminator: "",
    allowlisted: true,
  };
}

export function buildLeimacIdmuSafeOffFrames(unit: number | string = 1): LeimacIdmuWriteFrame[] {
  return [
    composeLeimacIdmuChannelWriteFrame({
      name: "lightingOutput",
      unit,
      value: "0000",
      meaning: "Lighting output OFF",
    }),
    composeLeimacIdmuChannelWriteFrame({
      name: "asynchronousOutput",
      unit,
      value: "0000",
      meaning: "Asynchronous output OFF",
    }),
    composeLeimacIdmuChannelWriteFrame({
      name: "lightingOutputValue",
      unit,
      value: "0000",
      meaning: "PWM duty 0 steps for safe-off",
    }),
  ];
}

export function buildLeimacIdmuTriggerProfilePlan(input: {
  profile?: string;
  dutyPercent?: number | string;
  unit?: number | string;
} = {}): LeimacIdmuTriggerProfilePlan {
  const profile = (input.profile ?? "basler-line2-trg-in1-low-duty").trim();
  if (profile !== "basler-line2-trg-in1-low-duty") {
    throw new LeimacIdmuClientError(
      "LEIMAC_IDMU_PROFILE_UNSUPPORTED",
      "Leimac IDMU PR #36 supports --profile basler-line2-trg-in1-low-duty only."
    );
  }
  const unit = normalizeLeimacIdmuUnit(input.unit);
  const dutyPercent = normalizeLeimacIdmuDutyPercent(input.dutyPercent);
  const dutySteps = leimacIdmuDutyPercentToSteps(dutyPercent);
  const dutyValue = String(dutySteps).padStart(4, "0");
  const frames = [
    ...buildLeimacIdmuSafeOffFrames(unit),
    composeLeimacIdmuChannelWriteFrame({
      name: "triggerActivation",
      unit,
      value: "0002",
      meaning: "LevelLow",
    }),
    composeLeimacIdmuChannelWriteFrame({
      name: "triggerSource",
      unit,
      value: "0000",
      meaning: "TRG IN1",
    }),
    composeLeimacIdmuChannelWriteFrame({
      name: "triggerSynchronizationMode",
      unit,
      value: "0000",
      meaning: "Synchronous",
    }),
    composeLeimacIdmuChannelWriteFrame({
      name: "lightingOutputDelay",
      unit,
      value: "0000",
      meaning: "0 microseconds",
    }),
    composeLeimacIdmuChannelWriteFrame({
      name: "lightingOutputValue",
      unit,
      value: dutyValue,
      meaning: `PWM duty ${dutyPercent}% (${dutySteps}/1000 steps)`,
    }),
    composeLeimacIdmuChannelWriteFrame({
      name: "asynchronousOutput",
      unit,
      value: "0000",
      meaning: "Asynchronous output OFF",
    }),
    composeLeimacIdmuChannelWriteFrame({
      name: "lightingOutput",
      unit,
      value: "0001",
      meaning: "Lighting output enabled for trigger-controlled smoke",
    }),
  ];
  return {
    profile,
    unit,
    dutyPercent,
    dutySteps,
    maxDutyPercent: LEIMAC_IDMU_MAX_FIRST_SMOKE_DUTY_PERCENT,
    commandFormat: "Header + CommandNumber + UnitNumber + repeated ChannelNumber/SettingValue data",
    persistentSaved: false,
    outputTimeWritten: false,
    reasonOutputTimeNotWritten:
      "Synchronous mode is intended to follow Basler Exposure Active; output-time command is intentionally omitted in PR #36.",
    frames,
    safeOffFrames: buildLeimacIdmuSafeOffFrames(unit),
    safety: {
      dryRun: true,
      applyRequiresConfirmation: true,
      writesApplied: false,
      lightsCommanded: false,
      outputSettingsChanged: false,
      triggerSettingsChanged: false,
      persistentSaved: false,
      arbitraryWritesAllowed: false,
      maxDutyPercent: LEIMAC_IDMU_MAX_FIRST_SMOKE_DUTY_PERCENT,
    },
  };
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
  const payload = stripLeimacResponsePrefix(command, trimmed);

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
    const unitInformation = parseUnitInformation(payload);
    if (unitInformation) {
      return {
        responseKind: "data",
        unitInformation,
        parseConfidence: "partial",
      };
    }
    const unitModel = payload.match(/\bIDMU-P[A-Z0-9-]+\b/i)?.[0];
    return {
      responseKind: "data",
      ...(unitModel ? { unitModel } : {}),
      parseConfidence: unitModel ? "partial" : "unknown",
    };
  }

  if (command.name === "temperature") {
    const temperaturePoints = parseTemperaturePoints(payload);
    if (temperaturePoints.length > 0) {
      return {
        responseKind: "data",
        temperatureC: temperaturePoints[0].temperatureC,
        temperaturePoints,
        parseConfidence: "partial",
      };
    }
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
    const operationModeCode = payload.match(/^\d{4}/)?.[0];
    const operationMode = operationModeCode ? operationModeMeaning(operationModeCode) : undefined;
    if (operationMode) {
      return {
        responseKind: "data",
        operationModeCode,
        operationMode,
        parseConfidence: "partial",
      };
    }
    const mode = payload.match(/\b(LevelHigh|RisingEdge|LevelLow|FallingEdge|External|Internal|Trigger|Continuous)\b/i)?.[0];
    return {
      responseKind: "data",
      ...(mode ? { operationMode: mode } : {}),
      parseConfidence: mode ? "partial" : "unknown",
    };
  }

  if (command.name === "status") {
    const statusCode = payload.match(/^\d{4}/)?.[0];
    if (statusCode) {
      return {
        responseKind: "data",
        statusCode,
        statusMeaning: statusMeaning(statusCode, command.targetKind),
        parseConfidence: "partial",
      };
    }
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
      const ok = parsed.responseKind === "data" && parsed.parseConfidence !== "unknown";
      return {
        ok,
        host: this.host,
        port: this.port,
        timeoutMs: this.timeoutMs,
        command: composed.metadata,
        requestAscii: composed.ascii,
        requestFrame: composed.frame,
        rawResponse,
        parsed,
        durationMs: Date.now() - startedAt,
        safety: leimacIdmuSafetyMetadata(),
        ...(parsed.responseKind === "nak"
          ? { error: parsed.errorMeaning ?? "Leimac IDMU returned NAK." }
          : !ok
            ? { error: "Leimac IDMU response was empty, invalid, or not confidently parsed." }
            : {}),
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
        requestFrame: composed.frame,
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

  async readFrame(frame: string): Promise<LeimacIdmuDiagnosticFrameResult> {
    const requestFrame = normalizeLeimacIdmuDiagnosticReadFrame(frame);
    const metadata = metadataForLeimacIdmuDiagnosticReadFrame(requestFrame);
    const startedAt = Date.now();
    try {
      const rawResponse = await this.transport.send({
        host: this.host,
        port: this.port,
        timeoutMs: this.timeoutMs,
        ascii: requestFrame,
        frame: requestFrame,
      });
      const parsed = parseLeimacIdmuResponse(metadata, rawResponse);
      const ok = parsed.responseKind === "data" && parsed.parseConfidence !== "unknown";
      return {
        ok,
        host: this.host,
        port: this.port,
        timeoutMs: this.timeoutMs,
        command: metadata,
        requestAscii: requestFrame,
        requestFrame,
        rawResponse,
        parsed,
        durationMs: Date.now() - startedAt,
        safety: leimacIdmuSafetyMetadata(),
        ...(parsed.responseKind === "nak"
          ? { error: parsed.errorMeaning ?? "Leimac IDMU returned NAK." }
          : !ok
            ? { error: "Leimac IDMU response was empty, invalid, or not confidently parsed." }
            : {}),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Leimac IDMU diagnostic read-frame error.";
      return {
        ok: false,
        host: this.host,
        port: this.port,
        timeoutMs: this.timeoutMs,
        command: metadata,
        requestAscii: requestFrame,
        requestFrame,
        parsed: { responseKind: "unknown", parseConfidence: "unknown" },
        durationMs: Date.now() - startedAt,
        safety: leimacIdmuSafetyMetadata(),
        error: message,
      };
    }
  }

  async safeOff(apply = false): Promise<LeimacIdmuSafeOffResult> {
    const frames = buildLeimacIdmuSafeOffFrames(this.unit);
    if (!apply) {
      return {
        ok: true,
        host: this.host,
        port: this.port,
        timeoutMs: this.timeoutMs,
        applied: false,
        frames,
        writes: [],
        safety: {
          writesApplied: false,
          lightsCommanded: false,
          outputSettingsChanged: false,
          triggerSettingsChanged: false,
          persistentSaved: false,
          arbitraryWritesAllowed: false,
        },
      };
    }
    const writes: LeimacIdmuWriteResult[] = [];
    for (const frame of frames) {
      const result = await this.writeAllowlistedFrame(frame);
      writes.push(result);
      if (!result.ok) {
        return {
          ok: false,
          host: this.host,
          port: this.port,
          timeoutMs: this.timeoutMs,
          applied: true,
          frames,
          writes,
          safety: {
            writesApplied: true,
            lightsCommanded: false,
            outputSettingsChanged: true,
            triggerSettingsChanged: false,
            persistentSaved: false,
            arbitraryWritesAllowed: false,
          },
          error: result.error ?? "Leimac IDMU safe-off write failed.",
        };
      }
    }
    return {
      ok: true,
      host: this.host,
      port: this.port,
      timeoutMs: this.timeoutMs,
      applied: true,
      frames,
      writes,
      safety: {
        writesApplied: true,
        lightsCommanded: false,
        outputSettingsChanged: true,
        triggerSettingsChanged: false,
        persistentSaved: false,
        arbitraryWritesAllowed: false,
      },
    };
  }

  async applyTriggerProfile(input: {
    profile?: string;
    dutyPercent?: number | string;
    apply?: boolean;
    confirmation?: string;
  } = {}): Promise<LeimacIdmuTriggerProfileApplyResult> {
    const plan = buildLeimacIdmuTriggerProfilePlan({
      profile: input.profile,
      dutyPercent: input.dutyPercent,
      unit: this.unit,
    });
    if (!input.apply) {
      return {
        ok: true,
        host: this.host,
        port: this.port,
        timeoutMs: this.timeoutMs,
        applied: false,
        plan,
        writes: [],
        safeOffBeforeProfile: [],
      };
    }
    if (input.confirmation !== LEIMAC_IDMU_TRIGGER_PROFILE_CONFIRMATION) {
      throw new LeimacIdmuClientError(
        "LEIMAC_IDMU_TRIGGER_PROFILE_CONFIRMATION_REQUIRED",
        `Leimac trigger profile apply requires --confirm "${LEIMAC_IDMU_TRIGGER_PROFILE_CONFIRMATION}".`
      );
    }
    const unitInfo = await this.readCommand("unitInfo");
    if (!unitInfo.ok) {
      return {
        ok: false,
        host: this.host,
        port: this.port,
        timeoutMs: this.timeoutMs,
        applied: false,
        unitInfo,
        plan,
        writes: [],
        safeOffBeforeProfile: [],
        error: "Leimac unit information read failed before trigger-profile writes.",
      };
    }
    const totalUnits = unitInfo.parsed.unitInformation?.totalUnits;
    const channelCount = unitInfo.parsed.unitInformation?.units[0]?.lightingOutputChannels;
    if (totalUnits !== 1 || channelCount !== LEIMAC_IDMU_CHANNEL_COUNT_BASE_UNIT) {
      return {
        ok: false,
        host: this.host,
        port: this.port,
        timeoutMs: this.timeoutMs,
        applied: false,
        unitInfo,
        plan,
        writes: [],
        safeOffBeforeProfile: [],
        error: "Leimac unit information did not match the confirmed PR #36 base-unit profile.",
      };
    }

    const safeOffBeforeProfile: LeimacIdmuWriteResult[] = [];
    const safeOffFrames = buildLeimacIdmuSafeOffFrames(this.unit);
    for (const frame of safeOffFrames) {
      const result = await this.writeAllowlistedFrame(frame);
      safeOffBeforeProfile.push(result);
      if (!result.ok) {
        return {
          ok: false,
          host: this.host,
          port: this.port,
          timeoutMs: this.timeoutMs,
          applied: true,
          unitInfo,
          plan: {
            ...plan,
            safety: {
              ...plan.safety,
              dryRun: false,
              writesApplied: true,
              outputSettingsChanged: true,
            },
          },
          writes: [],
          safeOffBeforeProfile,
          error: result.error ?? "Leimac IDMU pre-profile safe-off write failed.",
        };
      }
    }

    const writes: LeimacIdmuWriteResult[] = [];
    for (const frame of plan.frames.slice(safeOffFrames.length)) {
      const result = await this.writeAllowlistedFrame(frame);
      writes.push(result);
      if (!result.ok) {
        return {
          ok: false,
          host: this.host,
          port: this.port,
          timeoutMs: this.timeoutMs,
          applied: true,
          unitInfo,
          plan: {
            ...plan,
            safety: {
              ...plan.safety,
              dryRun: false,
              writesApplied: true,
              lightsCommanded: writes.some((write) => write.frame.name === "lightingOutput"),
              outputSettingsChanged: true,
              triggerSettingsChanged: true,
            },
          },
          writes,
          safeOffBeforeProfile,
          error: result.error ?? "Leimac IDMU trigger-profile write failed.",
        };
      }
    }
    return {
      ok: true,
      host: this.host,
      port: this.port,
      timeoutMs: this.timeoutMs,
      applied: true,
      unitInfo,
      plan: {
        ...plan,
        safety: {
          ...plan.safety,
          dryRun: false,
          writesApplied: true,
          lightsCommanded: true,
          outputSettingsChanged: true,
          triggerSettingsChanged: true,
        },
      },
      writes,
      safeOffBeforeProfile,
    };
  }

  async readiness(): Promise<LeimacIdmuReadinessResult> {
    const commandsAttempted: LeimacIdmuCommandResult[] = [];
    for (const commandName of READINESS_COMMANDS) {
      const result = await this.readCommand(commandName);
      commandsAttempted.push(result);
      if (!result.ok) break;
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

  private async writeAllowlistedFrame(frame: LeimacIdmuWriteFrame): Promise<LeimacIdmuWriteResult> {
    if (!frame.allowlisted || !Object.values(WRITE_COMMAND_NUMBERS).includes(frame.commandNumber)) {
      throw new LeimacIdmuClientError("LEIMAC_IDMU_WRITE_REJECTED", "Leimac IDMU write frame is not in the PR #36 trigger-profile allowlist.");
    }
    try {
      const rawResponse = await this.transport.send({
        host: this.host,
        port: this.port,
        timeoutMs: this.timeoutMs,
        ascii: frame.requestAscii,
        frame: frame.requestFrame,
      });
      const nakCode = parseNakCode(rawResponse);
      if (nakCode) {
        return {
          ok: false,
          host: this.host,
          port: this.port,
          timeoutMs: this.timeoutMs,
          frame,
          rawResponse,
          responseKind: "nak",
          error: nakMeaning(nakCode),
        };
      }
      const ok = /\bACK\d*\b/i.test(rawResponse) || rawResponse.toUpperCase().includes("ACK");
      return {
        ok,
        host: this.host,
        port: this.port,
        timeoutMs: this.timeoutMs,
        frame,
        rawResponse,
        responseKind: ok ? "ack" : "unknown",
        ...(!ok ? { error: "Leimac IDMU write response was not an ACK." } : {}),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Leimac IDMU write error.";
      return {
        ok: false,
        host: this.host,
        port: this.port,
        timeoutMs: this.timeoutMs,
        frame,
        responseKind: "unknown",
        error: message,
      };
    }
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
        let idleTimer: NodeJS.Timeout | undefined;

        const finish = (callback: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (idleTimer) clearTimeout(idleTimer);
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
          if (response.includes("\n") || response.includes("\r")) {
            finish(() => resolve(response));
          } else {
            if (idleTimer) clearTimeout(idleTimer);
            idleTimer = setTimeout(() => {
              const idleResponse = Buffer.concat(chunks).toString("ascii");
              finish(() => resolve(idleResponse));
            }, Math.min(100, Math.max(25, Math.floor(request.timeoutMs / 10))));
          }
        });
        socket.on("error", (error) => {
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

function stripLeimacResponsePrefix(command: LeimacIdmuCommandMetadata, response: string): string {
  let payload = response.replace(/\s+/g, "");
  if (/^[RW]/i.test(payload)) payload = payload.slice(1);
  if (payload.startsWith(command.commandNumber)) payload = payload.slice(command.commandNumber.length);
  if (command.targetDesignation && payload.startsWith(command.targetDesignation)) {
    payload = payload.slice(command.targetDesignation.length);
  }
  return payload.trim();
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

function operationModeMeaning(code: string): string | undefined {
  switch (code) {
    case "0000":
      return "Normal mode";
    case "0001":
      return "Programming mode";
    default:
      return undefined;
  }
}

function statusMeaning(code: string, targetKind: LeimacIdmuReadTargetKind): string {
  if (targetKind === "system") return `System status bitmask ${code}.`;
  switch (code) {
    case "0000":
      return "No error condition.";
    case "0001":
      return "Overcurrent.";
    case "0002":
      return "Temperature abnormality.";
    case "0003":
      return "Inter-unit communication error.";
    case "0004":
      return "Other unit error.";
    default:
      return `Unknown status code ${code}.`;
  }
}

function parseTemperaturePoints(payload: string): NonNullable<LeimacIdmuParsedResponse["temperaturePoints"]> {
  const points: NonNullable<LeimacIdmuParsedResponse["temperaturePoints"]> = [];
  for (const match of payload.matchAll(/(\d{2})(\d{4})/g)) {
    const point = Number(match[1]);
    const temperatureC = Number(match[2]);
    if (Number.isInteger(point) && point > 0 && Number.isFinite(temperatureC) && temperatureC >= -20 && temperatureC <= 150) {
      points.push({ point, temperatureC });
    }
  }
  return points;
}

function parseUnitInformation(payload: string): NonNullable<LeimacIdmuParsedResponse["unitInformation"]> | undefined {
  const numeric = payload.match(/^\d{4}(?:\d{8})*/)?.[0];
  if (!numeric || numeric.length < 4) return undefined;
  const totalUnits = Number(numeric.slice(0, 4));
  if (!Number.isInteger(totalUnits) || totalUnits < 0 || totalUnits > 5) return undefined;
  const units: NonNullable<LeimacIdmuParsedResponse["unitInformation"]>["units"] = [];
  let offset = 4;
  for (let index = 1; offset + 8 <= numeric.length && index <= Math.max(totalUnits, 1); index += 1) {
    const dimmingMethodCode = numeric.slice(offset, offset + 4);
    const channelValue = Number(numeric.slice(offset + 4, offset + 8));
    units.push({
      index,
      dimmingMethodCode,
      ...(Number.isInteger(channelValue) && channelValue >= 0 ? { lightingOutputChannels: channelValue } : {}),
    });
    offset += 8;
  }
  return {
    totalUnits,
    units,
  };
}
