import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import {
  assertFixedRigOutputDirAllowed,
  buildFixedRigActiveLightingProfile,
  createFixedRigPackageDir,
  FIXED_RIG_SELECTED_EXPOSURE_US,
  FIXED_RIG_SELECTED_GAIN,
  FIXED_RIG_SELECTED_LEIMAC_DUTY,
  type FixedRigActiveLightingProfile,
} from "./baslerFixedRigV1";
import {
  buildAiGraderStationRealCommandPlan,
  createAiGraderStationCliRunner,
  type AiGraderStationCommandResult,
  type AiGraderStationCommandRunner,
  type AiGraderStationCommandStep,
  type AiGraderStationRealWorkflowInput,
} from "./aiGraderStationWorkflow";
import { writeAiGraderReportBundle, type AiGraderReportBundle } from "./aiGraderReportBundle";

export const AI_GRADER_LOCAL_STATION_BRIDGE_VERSION = "ai-grader-local-station-bridge-v0.2";
export const DEFAULT_AI_GRADER_LOCAL_STATION_BRIDGE_HOST = "127.0.0.1";
export const DEFAULT_AI_GRADER_LOCAL_STATION_BRIDGE_PORT = 47652;

export type AiGraderLocalStationBridgeMode = "mock" | "real";

export type AiGraderLocalStationBridgeAction =
  | "status"
  | "start-session"
  | "confirm-light-idle-off"
  | "confirm-fixture-rulers"
  | "launch-preview"
  | "accept-profile"
  | "capture-front"
  | "confirm-flip"
  | "capture-back"
  | "run-diagnostics"
  | "export-report-bundle"
  | "safe-off"
  | "latest-report"
  | "session-manifest"
  | "end-session";

export type AiGraderLocalStationStepId =
  | "start_new_card"
  | "verify_fixture_rulers"
  | "live_preview_focus_framing"
  | "lighting_exposure_tune"
  | "accept_capture_profile"
  | "capture_front"
  | "prompt_flip_card"
  | "capture_back"
  | "run_provisional_diagnostics"
  | "view_unified_report"
  | "safe_off_end_session";

export interface AiGraderLocalStationAcceptedProfile {
  dutyPercent: number;
  exposureUs: number;
  gain: number;
  channels: number[];
  source: "operator_preview" | "default" | "cli_override" | "bridge_operator";
  actualLeimacPwmStep: number;
  acceptedAt?: string;
}

export interface AiGraderLocalStationBridgeConfigInput {
  enabled?: boolean;
  host?: string;
  port?: number | string;
  mode?: AiGraderLocalStationBridgeMode;
  stationToken?: string;
  allowedOrigins?: string[];
  outputDir?: string;
  reportBundleOutputDir?: string;
  publicBasePath?: string;
  apply?: boolean;
  markPresent?: boolean;
  wiringConfirmed?: boolean;
  leimacStatusGreen?: boolean;
  leimacHost?: string;
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
  fixtureLabel?: string;
  fixtureId?: string;
  referenceType?: string;
  horizontalSpanMm?: number;
  horizontalStartPx?: { x: number; y: number };
  horizontalEndPx?: { x: number; y: number };
  verticalSpanMm?: number;
  verticalStartPx?: { x: number; y: number };
  verticalEndPx?: { x: number; y: number };
  cardBoundaryRect?: { x: number; y: number; width: number; height: number };
}

export interface AiGraderLocalStationBridgeConfig {
  enabled: boolean;
  host: string;
  port: number;
  mode: AiGraderLocalStationBridgeMode;
  outputDir: string;
  localOnly: true;
  stationToken: string;
  allowedOrigins: string[];
  reportBundleOutputDir?: string;
  publicBasePath?: string;
  apply: boolean;
  markPresent: boolean;
  wiringConfirmed: boolean;
  leimacStatusGreen: boolean;
  leimacHost?: string;
  leimacPort?: number;
  leimacTimeoutMs?: number;
  leimacUnit?: number;
  pylonRoot?: string;
  pylonTimeoutMs?: number;
  baslerBridgeScript?: string;
  cameraIndex?: number;
  exposureUs: number;
  gain: number;
  duty: number;
  fixtureLabel?: string;
  fixtureId?: string;
  referenceType?: string;
  horizontalSpanMm?: number;
  horizontalStartPx?: { x: number; y: number };
  horizontalEndPx?: { x: number; y: number };
  verticalSpanMm?: number;
  verticalStartPx?: { x: number; y: number };
  verticalEndPx?: { x: number; y: number };
  cardBoundaryRect?: { x: number; y: number; width: number; height: number };
}

export interface AiGraderLocalStationBridgeManifest {
  schemaVersion: typeof AI_GRADER_LOCAL_STATION_BRIDGE_VERSION;
  stationId: string;
  sessionId?: string;
  reportId?: string;
  currentStep: AiGraderLocalStationStepId;
  mode: AiGraderLocalStationBridgeMode;
  createdAt?: string;
  updatedAt: string;
  acceptedProfile: AiGraderLocalStationAcceptedProfile;
  confirmations: {
    lightIdleOff: boolean;
    fixtureRulersVisible: boolean;
    flipComplete: boolean;
    finalLightOff: boolean;
  };
  outputs: {
    sessionDir?: string;
    manifestPath?: string;
    previewPackageDir?: string;
    frontPackageDir?: string;
    backPackageDir?: string;
    unifiedReportDir?: string;
    unifiedReportPath?: string;
    reportBundlePath?: string;
    assetManifestPath?: string;
    checksumsPath?: string;
  };
  safety: {
    localOnly: true;
    hardwareAccessed: boolean;
    databaseWrites: false;
    migrationsRun: false;
    deployRun: false;
    persistentBaslerSaved: false;
    persistentLeimacSaved: false;
    highDutyLighting: false;
    capturedImagesCommitted: false;
    finalGradeComputed: false;
    certifiedClaim: false;
    labelGenerated: false;
    qrGenerated: false;
    certificateGenerated: false;
  };
  commandResults: AiGraderStationCommandResult[];
  progressLog: string[];
  warnings: string[];
  reportBundle?: AiGraderReportBundle;
}

export interface AiGraderLocalStationBridgeStatus extends AiGraderLocalStationBridgeManifest {
  ok: true;
  bridgeVersion: typeof AI_GRADER_LOCAL_STATION_BRIDGE_VERSION;
  localOnly: true;
  loginRequired: false;
  hardwareActionsEnabled: boolean;
  stationUrl: string;
  nextAction: AiGraderLocalStationBridgeAction;
  nextActionLabel: string;
  latestReport: {
    reportId?: string;
    localHtmlPath?: string;
    localViewerPath: string;
    publicViewerRoute: string;
    exists: boolean;
  };
  sessionManifest: {
    gradingSessionId: string;
    reportId: string;
    status: "planned" | "hardware_pending" | "hardware_completed" | "blocked";
    frontCaptured: boolean;
    backCaptured: boolean;
    provisionalDiagnosticsRun: boolean;
  };
  calibrationProfile: {
    referenceType: "fixed_metric_rulers";
    status: "fixture_rulers_pending" | "operator_verified";
    isCalibrated: false;
  };
  bridgeContract: {
    endpoints: Array<{ method: "GET" | "POST"; path: string; action: AiGraderLocalStationBridgeAction; hardwareAccess: boolean; description: string }>;
    realHardwarePending: string[];
  };
  publicViewerRoute: string;
  bridgeSecurity: {
    tokenRequired: true;
    allowedOrigins: string[];
    host: string;
    port: number;
    rejectsNonLoopback: true;
  };
}

export interface AiGraderLocalStationBridgeActionRequest {
  acceptedProfile?: Partial<AiGraderLocalStationAcceptedProfile>;
  confirmations?: Partial<AiGraderLocalStationBridgeManifest["confirmations"]>;
  reportId?: string;
}

export interface StartedAiGraderLocalStationBridge {
  server: http.Server;
  host: string;
  port: number;
  url: string;
  config: AiGraderLocalStationBridgeConfig;
}

type JsonBody = Record<string, unknown>;

const NEXT_ACTION_BY_STEP: Record<AiGraderLocalStationStepId, AiGraderLocalStationBridgeAction> = {
  start_new_card: "start-session",
  verify_fixture_rulers: "launch-preview",
  live_preview_focus_framing: "accept-profile",
  lighting_exposure_tune: "accept-profile",
  accept_capture_profile: "capture-front",
  capture_front: "capture-front",
  prompt_flip_card: "confirm-flip",
  capture_back: "capture-back",
  run_provisional_diagnostics: "run-diagnostics",
  view_unified_report: "latest-report",
  safe_off_end_session: "safe-off",
};

function actionLabel(action: AiGraderLocalStationBridgeAction) {
  return action
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function firstNonEmpty(...values: Array<string | undefined>) {
  const value = values.find((candidate) => typeof candidate === "string" && candidate.trim().length > 0);
  return value?.trim();
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function normalizeHost(host: string | undefined): string {
  const normalized = (host ?? DEFAULT_AI_GRADER_LOCAL_STATION_BRIDGE_HOST).trim().toLowerCase();
  if (!isLoopbackHost(normalized)) {
    throw new Error("AI Grader station bridge only supports loopback hosts.");
  }
  return normalized;
}

function normalizePort(port: number | string | undefined): number {
  if (port === undefined || port === "") return DEFAULT_AI_GRADER_LOCAL_STATION_BRIDGE_PORT;
  const value = typeof port === "number" ? port : Number(port);
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    throw new Error("AI Grader station bridge port must be an integer from 0 to 65535.");
  }
  return value;
}

function hostForUrl(host: string) {
  return host === "::1" ? "[::1]" : host;
}

function parseMode(value: string | undefined): AiGraderLocalStationBridgeMode {
  if (!value) return "mock";
  if (value === "mock" || value === "real") return value;
  throw new Error("AI Grader station bridge mode must be mock or real.");
}

function parseAllowedOrigins(value: string | undefined, explicit: string[] | undefined): string[] {
  const fromEnv = value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
  const origins = [...(explicit ?? []), ...fromEnv].map((origin) => origin.trim()).filter(Boolean);
  return origins.length ? Array.from(new Set(origins)) : ["http://127.0.0.1:*", "http://localhost:*"];
}

function roundDuty(input: number) {
  const capped = Math.max(0, Math.min(5, input));
  const step = Math.max(0, Math.min(50, Math.round(capped * 10)));
  return { dutyPercent: step / 10, actualLeimacPwmStep: step };
}

function defaultProfile(config: Pick<AiGraderLocalStationBridgeConfig, "duty" | "exposureUs" | "gain">): AiGraderLocalStationAcceptedProfile {
  const duty = roundDuty(config.duty);
  return {
    dutyPercent: duty.dutyPercent,
    actualLeimacPwmStep: duty.actualLeimacPwmStep,
    exposureUs: config.exposureUs,
    gain: config.gain,
    channels: [1, 2, 3, 4, 5, 6, 7, 8],
    source: "default",
  };
}

export function buildAiGraderLocalStationBridgeConfig(
  input: AiGraderLocalStationBridgeConfigInput = {},
  env: NodeJS.ProcessEnv = process.env
): AiGraderLocalStationBridgeConfig {
  const enabled = input.enabled ?? env.AI_GRADER_LOCAL_STATION_ENABLED === "true";
  const mode = input.mode ?? parseMode(env.AI_GRADER_STATION_BRIDGE_MODE);
  const outputDir = firstNonEmpty(input.outputDir, env.AI_GRADER_STATION_OUTPUT_DIR) ?? "C:\\TenKings\\capture-data\\ai-grader-station";
  const stationToken = firstNonEmpty(input.stationToken, env.AI_GRADER_STATION_BRIDGE_TOKEN) ?? (mode === "mock" ? "local-dev-token" : "");
  if (!enabled) {
    throw new Error("AI Grader station bridge requires --enable-local-station or AI_GRADER_LOCAL_STATION_ENABLED=true.");
  }
  assertFixedRigOutputDirAllowed(outputDir);
  if (mode === "real") {
    if (!stationToken || stationToken.length < 16) {
      throw new Error("AI Grader station bridge real mode requires a station token of at least 16 characters.");
    }
    if (!input.apply) throw new Error("AI Grader station bridge real mode requires --apply.");
    if (!input.markPresent) throw new Error("AI Grader station bridge real mode requires --mark-present.");
    if (!input.wiringConfirmed) throw new Error("AI Grader station bridge real mode requires --wiring-confirmed.");
    if (!input.leimacStatusGreen) throw new Error("AI Grader station bridge real mode requires --leimac-status-green.");
    if (!firstNonEmpty(input.leimacHost, env.AI_GRADER_STATION_LEIMAC_HOST)) {
      throw new Error("AI Grader station bridge real mode requires --leimac-host <ip>.");
    }
  }
  const exposureUs = input.exposureUs ?? Number(env.AI_GRADER_STATION_EXPOSURE_US ?? FIXED_RIG_SELECTED_EXPOSURE_US);
  const gain = input.gain ?? Number(env.AI_GRADER_STATION_GAIN ?? FIXED_RIG_SELECTED_GAIN);
  const duty = input.duty ?? Number(env.AI_GRADER_STATION_DUTY_PERCENT ?? FIXED_RIG_SELECTED_LEIMAC_DUTY);
  if (!Number.isInteger(exposureUs) || exposureUs <= 0 || exposureUs > 100000) {
    throw new Error("AI Grader station bridge exposure must be an integer from 1 to 100000 us.");
  }
  if (!Number.isFinite(gain) || gain < 0) throw new Error("AI Grader station bridge gain must be non-negative.");
  if (!Number.isFinite(duty) || duty < 0 || duty > 5) throw new Error("AI Grader station bridge duty must be from 0 to 5 percent.");
  return {
    enabled,
    host: normalizeHost(firstNonEmpty(input.host, env.AI_GRADER_STATION_BRIDGE_HOST)),
    port: normalizePort(input.port ?? env.AI_GRADER_STATION_BRIDGE_PORT),
    mode,
    localOnly: true,
    stationToken,
    allowedOrigins: parseAllowedOrigins(env.AI_GRADER_STATION_ALLOWED_ORIGINS, input.allowedOrigins),
    outputDir,
    reportBundleOutputDir: firstNonEmpty(input.reportBundleOutputDir, env.AI_GRADER_REPORT_BUNDLE_OUTPUT_DIR),
    publicBasePath: firstNonEmpty(input.publicBasePath, env.AI_GRADER_REPORT_PUBLIC_BASE_PATH),
    apply: input.apply === true,
    markPresent: input.markPresent === true,
    wiringConfirmed: input.wiringConfirmed === true,
    leimacStatusGreen: input.leimacStatusGreen === true,
    leimacHost: firstNonEmpty(input.leimacHost, env.AI_GRADER_STATION_LEIMAC_HOST),
    leimacPort: input.leimacPort,
    leimacTimeoutMs: input.leimacTimeoutMs,
    leimacUnit: input.leimacUnit,
    pylonRoot: firstNonEmpty(input.pylonRoot, env.AI_GRADER_STATION_PYLON_ROOT),
    pylonTimeoutMs: input.pylonTimeoutMs,
    baslerBridgeScript: firstNonEmpty(input.baslerBridgeScript, env.AI_GRADER_STATION_BASLER_BRIDGE_SCRIPT),
    cameraIndex: input.cameraIndex,
    exposureUs,
    gain,
    duty,
    fixtureLabel: input.fixtureLabel,
    fixtureId: input.fixtureId,
    referenceType: input.referenceType,
    horizontalSpanMm: input.horizontalSpanMm,
    horizontalStartPx: input.horizontalStartPx,
    horizontalEndPx: input.horizontalEndPx,
    verticalSpanMm: input.verticalSpanMm,
    verticalStartPx: input.verticalStartPx,
    verticalEndPx: input.verticalEndPx,
    cardBoundaryRect: input.cardBoundaryRect,
  };
}

function newManifest(config: AiGraderLocalStationBridgeConfig): AiGraderLocalStationBridgeManifest {
  return {
    schemaVersion: AI_GRADER_LOCAL_STATION_BRIDGE_VERSION,
    stationId: "local-dell-ai-grader-station",
    currentStep: "start_new_card",
    mode: config.mode,
    updatedAt: new Date().toISOString(),
    acceptedProfile: defaultProfile(config),
    confirmations: {
      lightIdleOff: false,
      fixtureRulersVisible: false,
      flipComplete: false,
      finalLightOff: false,
    },
    outputs: {},
    safety: {
      localOnly: true,
      hardwareAccessed: false,
      databaseWrites: false,
      migrationsRun: false,
      deployRun: false,
      persistentBaslerSaved: false,
      persistentLeimacSaved: false,
      highDutyLighting: false,
      capturedImagesCommitted: false,
      finalGradeComputed: false,
      certifiedClaim: false,
      labelGenerated: false,
      qrGenerated: false,
      certificateGenerated: false,
    },
    commandResults: [],
    progressLog: ["Station bridge initialized. No hardware action has run."],
    warnings: [
      "Provisional diagnostic only; not certified and no final grade.",
      config.mode === "real"
        ? "Real bridge mode is enabled, but each hardware action still requires local token and staged operator confirmations."
        : "Mock bridge mode is active; hardware success is not claimed.",
    ],
  };
}

function mergeConfirmations(
  manifest: AiGraderLocalStationBridgeManifest,
  confirmations: Partial<AiGraderLocalStationBridgeManifest["confirmations"]> | undefined
) {
  if (!confirmations) return;
  manifest.confirmations = {
    ...manifest.confirmations,
    ...Object.fromEntries(Object.entries(confirmations).filter(([, value]) => typeof value === "boolean")),
  };
}

function validateProfile(profile: Partial<AiGraderLocalStationAcceptedProfile> | undefined, current: AiGraderLocalStationAcceptedProfile): AiGraderLocalStationAcceptedProfile {
  if (!profile) return current;
  const requestedDuty = typeof profile.dutyPercent === "number" ? profile.dutyPercent : current.dutyPercent;
  if (!Number.isFinite(requestedDuty) || requestedDuty < 0 || requestedDuty > 5) {
    throw new Error("Accepted AI Grader station duty must be from 0 to 5 percent.");
  }
  const exposureUs = typeof profile.exposureUs === "number" ? profile.exposureUs : current.exposureUs;
  if (!Number.isInteger(exposureUs) || exposureUs <= 0 || exposureUs > 100000) {
    throw new Error("Accepted AI Grader station exposure must be from 1 to 100000 us.");
  }
  const gain = typeof profile.gain === "number" ? profile.gain : current.gain;
  if (!Number.isFinite(gain) || gain < 0) throw new Error("Accepted AI Grader station gain must be non-negative.");
  const channels = Array.isArray(profile.channels) ? profile.channels : current.channels;
  if (
    channels.length === 0 ||
    channels.some((channel) => !Number.isInteger(channel) || channel < 1 || channel > 8) ||
    new Set(channels).size !== channels.length
  ) {
    throw new Error("Accepted AI Grader station channels must be unique integers from 1 to 8.");
  }
  const duty = roundDuty(requestedDuty);
  return {
    dutyPercent: duty.dutyPercent,
    actualLeimacPwmStep: duty.actualLeimacPwmStep,
    exposureUs,
    gain,
    channels: [...channels].sort((a, b) => a - b),
    source: profile.source ?? "bridge_operator",
    acceptedAt: new Date().toISOString(),
  };
}

function buildFixedRigProfile(profile: AiGraderLocalStationAcceptedProfile): FixedRigActiveLightingProfile {
  return buildFixedRigActiveLightingProfile({
    selectedDutyPercent: profile.dutyPercent,
    selectedChannels: profile.channels,
    profileSource: profile.source === "default" ? "default" : "operator_preview",
    acceptedAt: profile.acceptedAt,
  });
}

function extractPackageDir(payload: any): string | undefined {
  return payload?.packageDir ?? payload?.manifest?.packageDir ?? payload?.report?.packageDir;
}

function extractUnifiedReportPath(payload: any): string | undefined {
  return payload?.report?.reportPath ?? payload?.report?.reportHtmlPath ?? payload?.manifest?.reportPath;
}

function dirnameIfFile(filePath: string | undefined) {
  if (!filePath) return undefined;
  return path.dirname(filePath);
}

function commandInput(config: AiGraderLocalStationBridgeConfig, manifest: AiGraderLocalStationBridgeManifest): AiGraderStationRealWorkflowInput {
  return {
    outputDir: config.outputDir,
    leimacHost: config.leimacHost ?? "",
    leimacPort: config.leimacPort,
    leimacTimeoutMs: config.leimacTimeoutMs,
    leimacUnit: config.leimacUnit,
    pylonRoot: config.pylonRoot,
    pylonTimeoutMs: config.pylonTimeoutMs,
    baslerBridgeScript: config.baslerBridgeScript,
    cameraIndex: config.cameraIndex,
    exposureUs: manifest.acceptedProfile.exposureUs,
    gain: manifest.acceptedProfile.gain,
    duty: manifest.acceptedProfile.dutyPercent,
    markPresent: config.markPresent,
    wiringConfirmed: config.wiringConfirmed,
    leimacStatusGreen: config.leimacStatusGreen,
    operatorConfirmedLightIdleOff: manifest.confirmations.lightIdleOff,
    operatorFlipConfirmed: manifest.confirmations.flipComplete,
    operatorConfirmedFixtureRulersVisible: manifest.confirmations.fixtureRulersVisible,
    operatorConfirmedFinalLightOff: manifest.confirmations.finalLightOff,
    fixtureLabel: config.fixtureLabel,
    fixtureId: config.fixtureId,
    referenceType: config.referenceType,
    horizontalSpanMm: config.horizontalSpanMm,
    horizontalStartPx: config.horizontalStartPx,
    horizontalEndPx: config.horizontalEndPx,
    verticalSpanMm: config.verticalSpanMm,
    verticalStartPx: config.verticalStartPx,
    verticalEndPx: config.verticalEndPx,
    cardBoundaryRect: config.cardBoundaryRect,
  };
}

function stepById(config: AiGraderLocalStationBridgeConfig, manifest: AiGraderLocalStationBridgeManifest, id: AiGraderStationCommandStep["id"]) {
  const plan = buildAiGraderStationRealCommandPlan(commandInput(config, manifest));
  const step = plan.find((candidate) => candidate.id === id);
  if (!step) throw new Error(`AI Grader station command plan missing step ${id}.`);
  return step;
}

function assertRealReady(config: AiGraderLocalStationBridgeConfig, manifest: AiGraderLocalStationBridgeManifest) {
  if (config.mode !== "real") return;
  if (!config.apply || !config.markPresent || !config.wiringConfirmed || !config.leimacStatusGreen || !config.leimacHost) {
    throw new Error("Real AI Grader station bridge is not armed with required apply/Mark/wiring/Leimac flags.");
  }
  if (!manifest.confirmations.lightIdleOff) throw new Error("Mark must confirm physical ring light is idle/off before hardware actions.");
}

function assertFixtureVisible(manifest: AiGraderLocalStationBridgeManifest) {
  if (!manifest.confirmations.fixtureRulersVisible) {
    throw new Error("Mark must confirm fixture/rulers are visible before capture actions.");
  }
}

function assertFlipComplete(manifest: AiGraderLocalStationBridgeManifest) {
  if (!manifest.confirmations.flipComplete) throw new Error("Mark must confirm card flip is complete before back capture.");
}

async function writeSessionManifest(manifest: AiGraderLocalStationBridgeManifest) {
  if (!manifest.outputs.sessionDir) return;
  const manifestPath = manifest.outputs.manifestPath ?? path.join(manifest.outputs.sessionDir, "station-session.json");
  manifest.outputs.manifestPath = manifestPath;
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
}

async function runStepOrMock(
  config: AiGraderLocalStationBridgeConfig,
  manifest: AiGraderLocalStationBridgeManifest,
  runner: AiGraderStationCommandRunner,
  step: AiGraderStationCommandStep
): Promise<AiGraderStationCommandResult> {
  manifest.safety.hardwareAccessed = manifest.safety.hardwareAccessed || config.mode === "real" && step.hardwareAccess;
  if (config.mode === "mock") {
    return {
      stepId: step.id,
      ok: true,
      exitCode: 0,
      payload: {
        ok: true,
        packageDir: path.join(manifest.outputs.sessionDir ?? config.outputDir, `mock-${step.id}`),
        report: step.id === "unified_report"
          ? {
              packageDir: path.join(manifest.outputs.sessionDir ?? config.outputDir, "mock-unified-report"),
              reportPath: path.join(manifest.outputs.sessionDir ?? config.outputDir, "mock-unified-report", "provisional-diagnostic-report.html"),
            }
          : undefined,
        acceptedLightingProfile: step.id === "operator_preview" ? buildFixedRigProfile(manifest.acceptedProfile) : undefined,
      },
    };
  }
  return runner.run(step);
}

function reportRoute(reportId: string | undefined) {
  return `/ai-grader/reports/${encodeURIComponent(reportId || "local-ai-grader-report")}`;
}

function bridgeEndpoints() {
  const actions: Array<{ method: "GET" | "POST"; action: AiGraderLocalStationBridgeAction; hardwareAccess: boolean; description: string }> = [
    { method: "GET", action: "status", hardwareAccess: false, description: "Read current local station bridge status." },
    { method: "POST", action: "start-session", hardwareAccess: false, description: "Create a local station session folder and manifest." },
    { method: "POST", action: "confirm-light-idle-off", hardwareAccess: false, description: "Record operator light-idle/off confirmation." },
    { method: "POST", action: "confirm-fixture-rulers", hardwareAccess: false, description: "Record operator fixture/ruler visibility confirmation." },
    { method: "POST", action: "launch-preview", hardwareAccess: true, description: "Run the existing Basler live preview/focus/framing command." },
    { method: "POST", action: "accept-profile", hardwareAccess: false, description: "Accept the current software capture profile." },
    { method: "POST", action: "capture-front", hardwareAccess: true, description: "Run front fixed-rig evidence capture." },
    { method: "POST", action: "confirm-flip", hardwareAccess: false, description: "Record operator flip confirmation." },
    { method: "POST", action: "capture-back", hardwareAccess: true, description: "Run back fixed-rig evidence capture after flip confirmation." },
    { method: "POST", action: "run-diagnostics", hardwareAccess: false, description: "Generate the unified provisional diagnostic report." },
    { method: "POST", action: "export-report-bundle", hardwareAccess: false, description: "Export report-bundle.json, asset manifest, and checksums." },
    { method: "POST", action: "safe-off", hardwareAccess: true, description: "Run guarded Leimac safe-off cleanup." },
    { method: "GET", action: "latest-report", hardwareAccess: false, description: "Read latest report location." },
    { method: "GET", action: "session-manifest", hardwareAccess: false, description: "Read station manifest path and state." },
    { method: "POST", action: "end-session", hardwareAccess: false, description: "End the local station session." },
  ];
  return actions.map((endpoint) => ({
    ...endpoint,
    path: endpoint.method === "GET" ? `/${endpoint.action}` : `/actions/${endpoint.action}`,
  }));
}

export class AiGraderLocalStationBridgeService {
  readonly config: AiGraderLocalStationBridgeConfig;
  readonly runner: AiGraderStationCommandRunner;
  readonly stationUrl: string;
  private manifest: AiGraderLocalStationBridgeManifest;

  constructor(config: AiGraderLocalStationBridgeConfig, runner: AiGraderStationCommandRunner = createAiGraderStationCliRunner()) {
    this.config = config;
    this.runner = runner;
    this.stationUrl = `http://${hostForUrl(config.host)}:${config.port}`;
    this.manifest = newManifest(config);
  }

  status(): AiGraderLocalStationBridgeStatus {
    const nextAction = NEXT_ACTION_BY_STEP[this.manifest.currentStep];
    const reportId = this.manifest.reportId;
    const viewerRoute = reportRoute(reportId);
    const reportReady = Boolean(this.manifest.outputs.unifiedReportPath);
    return {
      ok: true,
      bridgeVersion: AI_GRADER_LOCAL_STATION_BRIDGE_VERSION,
      localOnly: true,
      loginRequired: false,
      hardwareActionsEnabled: this.config.mode === "real",
      stationUrl: this.stationUrl,
      nextAction,
      nextActionLabel: actionLabel(nextAction),
      latestReport: {
        reportId,
        localHtmlPath: this.manifest.outputs.unifiedReportPath,
        localViewerPath: viewerRoute,
        publicViewerRoute: "/ai-grader/reports/[reportId]",
        exists: reportReady,
      },
      sessionManifest: {
        gradingSessionId: this.manifest.sessionId ?? "pending-local-station-session",
        reportId: reportId ?? "pending-local-station-report",
        status: reportReady ? "hardware_completed" : this.manifest.sessionId ? "hardware_pending" : "planned",
        frontCaptured: Boolean(this.manifest.outputs.frontPackageDir),
        backCaptured: Boolean(this.manifest.outputs.backPackageDir),
        provisionalDiagnosticsRun: reportReady,
      },
      calibrationProfile: {
        referenceType: "fixed_metric_rulers",
        status: this.manifest.confirmations.fixtureRulersVisible ? "operator_verified" : "fixture_rulers_pending",
        isCalibrated: false,
      },
      bridgeContract: {
        endpoints: bridgeEndpoints(),
        realHardwarePending: this.config.mode === "real" ? [] : ["Start the bridge with --station-bridge-mode real, --apply, Mark/wiring/Leimac flags, and a local token to enable hardware actions."],
      },
      publicViewerRoute: viewerRoute,
      bridgeSecurity: {
        tokenRequired: true,
        allowedOrigins: this.config.allowedOrigins,
        host: this.config.host,
        port: this.config.port,
        rejectsNonLoopback: true,
      },
      ...this.manifest,
    };
  }

  async action(action: AiGraderLocalStationBridgeAction, request: AiGraderLocalStationBridgeActionRequest = {}): Promise<AiGraderLocalStationBridgeStatus> {
    mergeConfirmations(this.manifest, request.confirmations);
    const now = new Date().toISOString();
    this.manifest.updatedAt = now;

    if (action === "status" || action === "latest-report" || action === "session-manifest") {
      return this.status();
    }

    if (action === "start-session") {
      const { packageId, packageDir } = await createFixedRigPackageDir(this.config.outputDir, "ai-grader-browser-station-session");
      this.manifest.sessionId = `${packageId}-session`;
      this.manifest.reportId = request.reportId ?? `${packageId}-report`;
      this.manifest.createdAt = now;
      this.manifest.outputs.sessionDir = packageDir;
      this.manifest.outputs.manifestPath = path.join(packageDir, "station-session.json");
      this.manifest.currentStep = "verify_fixture_rulers";
      this.manifest.progressLog.push(`${now} Started station session ${this.manifest.sessionId}.`);
      await writeSessionManifest(this.manifest);
      return this.status();
    }

    if (!this.manifest.sessionId && action !== "safe-off" && action !== "end-session") {
      throw new Error("Start a station session before running AI Grader station actions.");
    }

    if (action === "confirm-light-idle-off") {
      this.manifest.confirmations.lightIdleOff = true;
      this.manifest.progressLog.push(`${now} Operator confirmed physical ring light idle/off.`);
      await writeSessionManifest(this.manifest);
      return this.status();
    }

    if (action === "confirm-fixture-rulers") {
      this.manifest.confirmations.fixtureRulersVisible = true;
      this.manifest.progressLog.push(`${now} Operator confirmed fixture/rulers visible.`);
      await writeSessionManifest(this.manifest);
      return this.status();
    }

    if (action === "accept-profile") {
      this.manifest.acceptedProfile = validateProfile(request.acceptedProfile, this.manifest.acceptedProfile);
      this.manifest.currentStep = "capture_front";
      this.manifest.progressLog.push(`${now} Accepted profile ${this.manifest.acceptedProfile.dutyPercent}% / ${this.manifest.acceptedProfile.exposureUs} us.`);
      await writeSessionManifest(this.manifest);
      return this.status();
    }

    if (action === "confirm-flip") {
      this.manifest.confirmations.flipComplete = true;
      this.manifest.currentStep = "capture_back";
      this.manifest.progressLog.push(`${now} Operator confirmed card flip complete.`);
      await writeSessionManifest(this.manifest);
      return this.status();
    }

    if (action === "end-session") {
      this.manifest.currentStep = "safe_off_end_session";
      this.manifest.progressLog.push(`${now} Station session ended.`);
      await writeSessionManifest(this.manifest);
      return this.status();
    }

    if (action === "safe-off") {
      assertRealReady(this.config, this.manifest);
      const result = await runStepOrMock(this.config, this.manifest, this.runner, stepById(this.config, this.manifest, "safe_off"));
      this.manifest.commandResults.push(result);
      this.manifest.confirmations.finalLightOff = Boolean(request.confirmations?.finalLightOff) || this.manifest.confirmations.finalLightOff;
      this.manifest.currentStep = "safe_off_end_session";
      this.manifest.progressLog.push(`${now} Safe-off ${result.ok ? "completed" : "failed"}.`);
      if (!result.ok) this.manifest.warnings.push(result.error ?? "Safe-off failed.");
      await writeSessionManifest(this.manifest);
      return this.status();
    }

    assertRealReady(this.config, this.manifest);

    if (action === "launch-preview") {
      assertFixtureVisible(this.manifest);
      const result = await runStepOrMock(this.config, this.manifest, this.runner, stepById(this.config, this.manifest, "operator_preview"));
      this.manifest.commandResults.push(result);
      if (!result.ok) throw new Error(result.error ?? "Basler live preview failed.");
      this.manifest.outputs.previewPackageDir = extractPackageDir(result.payload);
      const accepted = result.payload?.acceptedLightingProfile ?? result.payload?.manifest?.acceptedLightingProfile;
      if (accepted?.selectedDutyPercent) {
        this.manifest.acceptedProfile = validateProfile({
          dutyPercent: Number(accepted.selectedDutyPercent),
          exposureUs: this.manifest.acceptedProfile.exposureUs,
          gain: this.manifest.acceptedProfile.gain,
          channels: Array.isArray(accepted.selectedChannels) ? accepted.selectedChannels : this.manifest.acceptedProfile.channels,
          source: "operator_preview",
        }, this.manifest.acceptedProfile);
      }
      this.manifest.currentStep = "accept_capture_profile";
      this.manifest.progressLog.push(`${now} Basler live preview completed; profile available for acceptance.`);
      await writeSessionManifest(this.manifest);
      return this.status();
    }

    if (action === "capture-front") {
      assertFixtureVisible(this.manifest);
      const result = await runStepOrMock(this.config, this.manifest, this.runner, stepById(this.config, this.manifest, "capture_front"));
      this.manifest.commandResults.push(result);
      if (!result.ok) throw new Error(result.error ?? "Front evidence capture failed.");
      this.manifest.outputs.frontPackageDir = extractPackageDir(result.payload);
      this.manifest.currentStep = "prompt_flip_card";
      this.manifest.progressLog.push(`${now} Front evidence captured.`);
      await writeSessionManifest(this.manifest);
      return this.status();
    }

    if (action === "capture-back") {
      assertFixtureVisible(this.manifest);
      assertFlipComplete(this.manifest);
      const result = await runStepOrMock(this.config, this.manifest, this.runner, stepById(this.config, this.manifest, "capture_back"));
      this.manifest.commandResults.push(result);
      if (!result.ok) throw new Error(result.error ?? "Back evidence capture failed.");
      this.manifest.outputs.backPackageDir = extractPackageDir(result.payload);
      this.manifest.currentStep = "run_provisional_diagnostics";
      this.manifest.progressLog.push(`${now} Back evidence captured.`);
      await writeSessionManifest(this.manifest);
      return this.status();
    }

    if (action === "run-diagnostics") {
      if (!this.manifest.outputs.frontPackageDir || !this.manifest.outputs.backPackageDir) {
        throw new Error("Unified report requires both front and back evidence package folders.");
      }
      const step = {
        ...stepById(this.config, this.manifest, "unified_report"),
        args: [
          "ai-grader-fixed-rig-v1-card-report",
          "--output-dir",
          this.config.outputDir,
          "--front-dir",
          this.manifest.outputs.frontPackageDir,
          "--back-dir",
          this.manifest.outputs.backPackageDir,
        ],
      };
      const result = await runStepOrMock(this.config, this.manifest, this.runner, step);
      this.manifest.commandResults.push(result);
      if (!result.ok) throw new Error(result.error ?? "Unified provisional diagnostics failed.");
      this.manifest.outputs.unifiedReportDir = result.payload?.report?.packageDir ?? dirnameIfFile(extractUnifiedReportPath(result.payload));
      this.manifest.outputs.unifiedReportPath = extractUnifiedReportPath(result.payload);
      this.manifest.currentStep = "view_unified_report";
      this.manifest.progressLog.push(`${now} Unified provisional diagnostics generated.`);
      await writeSessionManifest(this.manifest);
      return this.status();
    }

    if (action === "export-report-bundle") {
      const reportDir = this.manifest.outputs.unifiedReportDir ?? dirnameIfFile(this.manifest.outputs.unifiedReportPath);
      if (!reportDir) throw new Error("Report bundle export requires a generated unified report folder.");
      const outputDir = this.config.reportBundleOutputDir ?? path.join(this.config.outputDir, "report-bundles", this.manifest.reportId ?? "local-report");
      const bundle = await writeAiGraderReportBundle({
        reportDir,
        outputDir,
        reportId: this.manifest.reportId,
        publicBasePath: this.config.publicBasePath,
      });
      this.manifest.outputs.reportBundlePath = bundle.bundlePath;
      this.manifest.outputs.assetManifestPath = bundle.assetManifestPath;
      this.manifest.outputs.checksumsPath = bundle.checksumsPath;
      this.manifest.reportBundle = bundle.bundle;
      this.manifest.progressLog.push(`${now} Report bundle exported to ${bundle.bundlePath}.`);
      await writeSessionManifest(this.manifest);
      return this.status();
    }

    throw new Error(`Unsupported AI Grader station bridge action: ${action}`);
  }
}

function isAllowedAction(value: string): value is AiGraderLocalStationBridgeAction {
  return [
    "status",
    "start-session",
    "confirm-light-idle-off",
    "confirm-fixture-rulers",
    "launch-preview",
    "accept-profile",
    "capture-front",
    "confirm-flip",
    "capture-back",
    "run-diagnostics",
    "export-report-bundle",
    "safe-off",
    "latest-report",
    "session-manifest",
    "end-session",
  ].includes(value);
}

function remoteIsLoopback(remoteAddress: string | undefined) {
  return remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1";
}

function hostHeaderIsLoopback(hostHeader: string | undefined) {
  if (!hostHeader) return false;
  const host = hostHeader.split(":")[0].toLowerCase();
  return isLoopbackHost(host);
}

function originAllowed(origin: string | undefined, allowedOrigins: string[]) {
  if (!origin) return true;
  return allowedOrigins.some((allowed) => {
    if (allowed.endsWith(":*")) {
      const prefix = allowed.slice(0, -1);
      return origin.startsWith(prefix);
    }
    return origin === allowed;
  });
}

function setCors(res: http.ServerResponse, origin: string | undefined, config: AiGraderLocalStationBridgeConfig) {
  if (origin && originAllowed(origin, config.allowedOrigins)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type,x-ai-grader-station-token");
  res.setHeader("Access-Control-Max-Age", "600");
}

function sendJson(res: http.ServerResponse, statusCode: number, body: unknown, origin: string | undefined, config: AiGraderLocalStationBridgeConfig) {
  setCors(res, origin, config);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(`${JSON.stringify(body)}\n`);
}

async function readJsonBody(req: http.IncomingMessage): Promise<JsonBody> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 1024 * 1024) throw new Error("AI Grader station bridge request body must be 1MB or smaller.");
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("AI Grader station bridge request body must be a JSON object.");
  }
  return parsed as JsonBody;
}

function actionRequestFromJson(value: JsonBody): AiGraderLocalStationBridgeActionRequest {
  return value as AiGraderLocalStationBridgeActionRequest;
}

function tokenMatches(req: http.IncomingMessage, config: AiGraderLocalStationBridgeConfig) {
  const header = req.headers["x-ai-grader-station-token"];
  const supplied = Array.isArray(header) ? header[0] : header;
  if (!supplied) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(config.stationToken);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createAiGraderLocalStationBridgeHttpServer(
  input: AiGraderLocalStationBridgeConfigInput = {},
  env: NodeJS.ProcessEnv = process.env,
  runner: AiGraderStationCommandRunner = createAiGraderStationCliRunner()
): http.Server {
  const config = buildAiGraderLocalStationBridgeConfig(input, env);
  const service = new AiGraderLocalStationBridgeService(config, runner);

  return http.createServer(async (req, res) => {
    const origin = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin;
    try {
      if (!remoteIsLoopback(req.socket.remoteAddress) || !hostHeaderIsLoopback(req.headers.host)) {
        return sendJson(res, 403, { ok: false, code: "AI_GRADER_STATION_BRIDGE_NON_LOCAL", message: "AI Grader station bridge accepts loopback requests only." }, origin, config);
      }
      if (!originAllowed(origin, config.allowedOrigins)) {
        return sendJson(res, 403, { ok: false, code: "AI_GRADER_STATION_BRIDGE_ORIGIN_REJECTED", message: "Origin is not allowed by this local station bridge." }, origin, config);
      }
      if (req.method === "OPTIONS") {
        setCors(res, origin, config);
        res.writeHead(204);
        res.end();
        return;
      }
      if (!req.url) return sendJson(res, 404, { ok: false, code: "NOT_FOUND", message: "Route not found." }, origin, config);
      const url = new URL(req.url, `http://${hostForUrl(config.host)}:${config.port}`);

      if (url.pathname === "/health") {
        if (req.method !== "GET") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED", message: "GET is required for /health." }, origin, config);
        return sendJson(res, 200, {
          ok: true,
          bridgeVersion: AI_GRADER_LOCAL_STATION_BRIDGE_VERSION,
          mode: config.mode,
          localOnly: true,
          tokenRequired: true,
          hardwareActionsEnabled: config.mode === "real",
          allowedOrigins: config.allowedOrigins,
        }, origin, config);
      }

      const statusRoutes = new Set(["/status", "/latest-report", "/session-manifest"]);
      if (statusRoutes.has(url.pathname)) {
        if (req.method !== "GET") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED", message: "GET is required for this route." }, origin, config);
        if (!tokenMatches(req, config)) return sendJson(res, 401, { ok: false, code: "AI_GRADER_STATION_BRIDGE_UNAUTHORIZED", message: "Station token is required." }, origin, config);
        return sendJson(res, 200, { ok: true, operation: url.pathname.slice(1), result: service.status() }, origin, config);
      }

      if (url.pathname.startsWith("/actions/")) {
        if (req.method !== "POST") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED", message: "POST is required for station actions." }, origin, config);
        if (!tokenMatches(req, config)) return sendJson(res, 401, { ok: false, code: "AI_GRADER_STATION_BRIDGE_UNAUTHORIZED", message: "Station token is required." }, origin, config);
        const action = decodeURIComponent(url.pathname.slice("/actions/".length));
        if (!isAllowedAction(action)) return sendJson(res, 404, { ok: false, code: "AI_GRADER_STATION_BRIDGE_ROUTE_NOT_FOUND", message: "Unknown station action." }, origin, config);
        const body = await readJsonBody(req);
        const result = await service.action(action, actionRequestFromJson(body));
        return sendJson(res, 200, { ok: true, operation: action, result }, origin, config);
      }

      return sendJson(res, 404, { ok: false, code: "NOT_FOUND", message: "Route not found." }, origin, config);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected AI Grader station bridge error.";
      return sendJson(res, 400, { ok: false, code: "AI_GRADER_STATION_BRIDGE_ERROR", message }, origin, config);
    }
  });
}

export async function startAiGraderLocalStationBridgeHttpServer(
  input: AiGraderLocalStationBridgeConfigInput = {},
  env: NodeJS.ProcessEnv = process.env,
  runner: AiGraderStationCommandRunner = createAiGraderStationCliRunner()
): Promise<StartedAiGraderLocalStationBridge> {
  const config = buildAiGraderLocalStationBridgeConfig(input, env);
  const server = createAiGraderLocalStationBridgeHttpServer(config, env, runner);
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(config.port, config.host);
  });
  const address = server.address() as AddressInfo;
  return {
    server,
    host: config.host,
    port: address.port,
    url: `http://${hostForUrl(config.host)}:${address.port}`,
    config: {
      ...config,
      port: address.port,
    },
  };
}
