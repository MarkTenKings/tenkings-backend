import type { NextApiRequest, NextApiResponse } from "next";
import {
  generateAuthOnlyCaptureManifest,
  generateDeviceCapabilityManifests,
  generateQuickCaptureManifest,
  generateStandardCaptureSimulation,
  type CaptureHelperSimulatorConfigInput,
} from "@tenkings/ai-grader-simulator";
import type {
  CreateAuthRunDraftInput,
  CreateCaptureSessionDraftInput,
  CreateGradeRunDraftInput,
  FinalizeAuthRunInput,
  FinalizeGradeRunInput,
  PersistMacroSuspectRegionsInput,
  PersistOrchestratorTransitionInput,
} from "@tenkings/database";
import {
  type AiGraderValidationIssue,
  type CaptureManifest,
  type CaptureManifestFrame,
  type DeviceCapabilityManifest,
  type MicroSpotCapturePackage,
  validateCaptureManifestForMode,
  validateDeviceCapabilityManifest,
  validateMicroSpotCapturePackage,
} from "@tenkings/shared";
import type { AdminSession } from "./admin";

export const AI_GRADER_API_ENABLED_ENV = "AI_GRADER_API_ENABLED";
export const AI_GRADER_SIMULATOR_ENABLED_ENV = "AI_GRADER_SIMULATOR_ENABLED";
export const AI_GRADER_HELPER_BRIDGE_ENABLED_ENV = "AI_GRADER_HELPER_BRIDGE_ENABLED";
export const AI_GRADER_HELPER_BASE_URL_ENV = "AI_GRADER_HELPER_BASE_URL";
export const AI_GRADER_HELPER_BRIDGE_TIMEOUT_MS = 2500;

type JsonRecord = Record<string, unknown>;
type EnvLike = Record<string, string | undefined>;

export type AiGraderSimulatorMode = "DEVICE_CAPABILITIES" | "QUICK" | "STANDARD" | "AUTH_ONLY";
export type AiGraderHelperManifestMode = Exclude<AiGraderSimulatorMode, "DEVICE_CAPABILITIES">;

export type AiGraderSimulatorGenerateInput = {
  mode: AiGraderSimulatorMode;
  config?: CaptureHelperSimulatorConfigInput;
};

export type AiGraderSimulatorValidationSummary = {
  valid: boolean;
  issues: AiGraderValidationIssue[];
};

export type AiGraderSimulatorManifestSummary = {
  mode: AiGraderSimulatorMode;
  frameCount: number;
  microSpotPackageCount: number;
  evidenceArtifactCount: number;
  deviceCapabilityCount: number;
  helperInstanceId: string | null;
  calibrationSnapshotIds: string[];
  storageKeyExamples: string[];
  validation: AiGraderSimulatorValidationSummary;
};

export type AiGraderSimulatorGenerateResult = {
  simulator: true;
  mode: AiGraderSimulatorMode;
  summary: AiGraderSimulatorManifestSummary;
  deviceCapabilityManifests?: DeviceCapabilityManifest[];
  captureManifest?: CaptureManifest;
  microSpotPackages?: unknown[];
  evidenceArtifacts?: unknown[];
};

export type AiGraderSimulatedSessionWorkflowInput = {
  config?: CaptureHelperSimulatorConfigInput;
};

export type AiGraderSimulatedSessionWorkflowResult = {
  simulator: true;
  workflow: "STANDARD_SESSION";
  session: {
    sessionId: string;
    tenantId: string;
    mode: "STANDARD";
    helperInstanceId: string;
    calibrationSnapshotIds: string[];
  };
  manifest: {
    id: string;
    checksumSha256: string;
    frameCount: number;
    validation: AiGraderSimulatorValidationSummary;
  };
  macro: {
    frameCount: number;
    frames: Array<{
      frameId: string;
      kind: string;
      side: string;
      storageKey: string;
    }>;
  };
  micro: {
    packageCount: number;
    evidenceFrameCount: number;
    surfaceSuspectCount: number;
    packages: Array<{
      id: string;
      element: string;
      spotIndex: number;
      totalSpots: number;
      sourceSuspectRegionId?: string;
      frameCount: number;
    }>;
  };
  gradeRunDraft: {
    status: "SIMULATED_DRAFT";
    captureSessionId: string;
    captureManifestId: string;
    algorithmVersionId: string;
    thresholdSetVersionId: string;
    runtimeEnvironmentId: string;
    inputChecksum: string;
    computesGrades: false;
  };
  certificateReadiness: {
    ready: false;
    status: "SIMULATION_ONLY";
    message: string;
  };
  validation: AiGraderSimulatorValidationSummary;
};

export type AiGraderSimulatorGenerator = (
  input: AiGraderSimulatorGenerateInput
) => Promise<AiGraderSimulatorGenerateResult> | AiGraderSimulatorGenerateResult;

export type AiGraderSimulatedSessionGenerator = (
  input: AiGraderSimulatedSessionWorkflowInput
) => Promise<AiGraderSimulatedSessionWorkflowResult> | AiGraderSimulatedSessionWorkflowResult;

export type AiGraderHelperBridgeStatus = {
  enabled: boolean;
  configured: boolean;
  code?: string;
  message: string;
  baseUrl?: string;
};

export type AiGraderHelperBridgeFetchResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

export type AiGraderHelperBridgeFetch = (
  input: string,
  init?: RequestInit
) => Promise<AiGraderHelperBridgeFetchResponse>;

export type AiGraderHelperBridgeClient = {
  health(): Promise<unknown>;
  readiness(): Promise<unknown>;
  capabilities(): Promise<unknown>;
  manifest(mode: AiGraderHelperManifestMode): Promise<unknown>;
};

export type AiGraderAdminApiService = {
  createCaptureSessionDraft(input: CreateCaptureSessionDraftInput): Promise<unknown>;
  persistOrchestratorTransition(input: PersistOrchestratorTransitionInput): Promise<unknown>;
  persistMacroSuspectRegions(input: PersistMacroSuspectRegionsInput): Promise<unknown>;
  createGradeRunDraft(input: CreateGradeRunDraftInput): Promise<unknown>;
  finalizeGradeRun(input: FinalizeGradeRunInput): Promise<unknown>;
  createAuthRunDraft(input: CreateAuthRunDraftInput): Promise<unknown>;
  finalizeAuthRun(input: FinalizeAuthRunInput): Promise<unknown>;
};

export type AiGraderAdminApiDependencies = {
  env?: EnvLike;
  requireAdminSession(req: NextApiRequest): Promise<AdminSession>;
  getService(): Promise<AiGraderAdminApiService> | AiGraderAdminApiService;
  generateSimulatorManifest?: AiGraderSimulatorGenerator;
  generateSimulatedSessionWorkflow?: AiGraderSimulatedSessionGenerator;
  helperBridgeFetch?: AiGraderHelperBridgeFetch;
  getHelperBridgeClient?: (env: EnvLike) => AiGraderHelperBridgeClient;
};

type RouteDefinition = {
  allow: "GET" | "POST";
  operation: string;
  execute(service: AiGraderAdminApiService, body: JsonRecord, admin: AdminSession): Promise<unknown>;
};

type ApiResponse =
  | {
      ok: true;
      enabled: true;
      operation: string;
      result: unknown;
    }
  | {
      ok: true;
      enabled: true;
      service: "ai-grader-admin-api";
      simulator: {
        enabled: boolean;
        code?: string;
        message: string;
      };
      helperBridge: AiGraderHelperBridgeStatus;
      user: {
        id: string;
        phone: string | null;
        displayName: string | null;
      };
      routes: string[];
    }
  | {
      ok: false;
      enabled?: false;
      code?: string;
      message: string;
      issues?: unknown[];
    };

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isAiGraderApiEnabled(env: EnvLike = process.env) {
  return env[AI_GRADER_API_ENABLED_ENV] === "true";
}

export function isAiGraderSimulatorEnabled(env: EnvLike = process.env) {
  return env[AI_GRADER_SIMULATOR_ENABLED_ENV] === "true";
}

export function isAiGraderHelperBridgeEnabled(env: EnvLike = process.env) {
  return env[AI_GRADER_HELPER_BRIDGE_ENABLED_ENV] === "true";
}

class AiGraderHelperBridgeError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AiGraderHelperBridgeError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]";
}

function normalizeHelperBridgeBaseUrl(env: EnvLike): string {
  const raw = env[AI_GRADER_HELPER_BASE_URL_ENV]?.trim();
  if (!raw) {
    throw new AiGraderHelperBridgeError(
      400,
      "AI_GRADER_HELPER_BRIDGE_CONFIG_INVALID",
      "AI Grader helper bridge requires AI_GRADER_HELPER_BASE_URL=http://127.0.0.1:<port>."
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new AiGraderHelperBridgeError(
      400,
      "AI_GRADER_HELPER_BRIDGE_CONFIG_INVALID",
      "AI Grader helper bridge base URL must be a valid loopback HTTP URL."
    );
  }

  if (parsed.protocol !== "http:" || !isLoopbackHostname(parsed.hostname) || parsed.username || parsed.password) {
    throw new AiGraderHelperBridgeError(
      400,
      "AI_GRADER_HELPER_BRIDGE_CONFIG_INVALID",
      "AI Grader helper bridge base URL must use http and a loopback host."
    );
  }

  return parsed.origin;
}

function helperBridgeStatus(env: EnvLike): AiGraderHelperBridgeStatus {
  if (!isAiGraderHelperBridgeEnabled(env)) {
    return {
      enabled: false,
      configured: false,
      code: "AI_GRADER_HELPER_BRIDGE_DISABLED",
      message: "AI Grader helper bridge is disabled. Set AI_GRADER_HELPER_BRIDGE_ENABLED=true to enable.",
    };
  }

  try {
    return {
      enabled: true,
      configured: true,
      baseUrl: normalizeHelperBridgeBaseUrl(env),
      message: "AI Grader helper bridge is enabled for loopback-only local helper transport.",
    };
  } catch (error) {
    return {
      enabled: true,
      configured: false,
      code:
        error instanceof AiGraderHelperBridgeError
          ? error.code
          : "AI_GRADER_HELPER_BRIDGE_CONFIG_INVALID",
      message: errorMessage(error),
    };
  }
}

function routeKey(req: NextApiRequest) {
  const action = req.query.action;
  if (Array.isArray(action)) return action.join("/");
  if (typeof action === "string") return action;
  return "status";
}

function badRequest(message: string, issues?: unknown[]) {
  return {
    status: 400,
    body: {
      ok: false,
      message,
      ...(issues ? { issues } : {}),
    } satisfies ApiResponse,
  };
}

function validationErrorResponse(error: unknown) {
  if (!isRecord(error)) return null;
  const issues = Array.isArray(error.issues) ? error.issues : undefined;
  if (error.name === "AiGraderServiceValidationError" || issues) {
    return badRequest(error.message && typeof error.message === "string" ? error.message : "Invalid AI Grader request.", issues);
  }
  if (error.name === "CaptureHelperSimulatorConfigError") {
    return badRequest(error.message && typeof error.message === "string" ? error.message : "Invalid AI Grader simulator request.");
  }
  return null;
}

function errorStatus(error: unknown) {
  if (isRecord(error) && typeof error.statusCode === "number") {
    return error.statusCode;
  }
  return 500;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (isRecord(error) && typeof error.message === "string") return error.message;
  return "Unexpected error";
}

function helperTransportErrorMessage(payload: unknown) {
  if (!isRecord(payload)) return null;
  if (typeof payload.message === "string") return payload.message;
  if (isRecord(payload.error) && typeof payload.error.message === "string") return payload.error.message;
  return null;
}

function isAbortError(error: unknown) {
  return isRecord(error) && error.name === "AbortError";
}

function helperRequestHeaders(headers: HeadersInit | undefined) {
  const merged = new Headers(headers);
  if (!merged.has("Accept")) merged.set("Accept", "application/json");
  return merged;
}

export function createAiGraderHelperBridgeClient(
  env: EnvLike = process.env,
  fetchImpl: AiGraderHelperBridgeFetch = globalThis.fetch as unknown as AiGraderHelperBridgeFetch
): AiGraderHelperBridgeClient {
  const baseUrl = normalizeHelperBridgeBaseUrl(env);

  async function fetchHelper(path: string, init: RequestInit = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_GRADER_HELPER_BRIDGE_TIMEOUT_MS);
    let response: AiGraderHelperBridgeFetchResponse;

    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers: helperRequestHeaders(init.headers),
        signal: controller.signal,
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new AiGraderHelperBridgeError(
          504,
          "AI_GRADER_HELPER_BRIDGE_TIMEOUT",
          "AI Grader helper bridge request timed out."
        );
      }
      throw new AiGraderHelperBridgeError(
        502,
        "AI_GRADER_HELPER_BRIDGE_UNAVAILABLE",
        error instanceof Error ? error.message : "AI Grader helper bridge request failed."
      );
    } finally {
      clearTimeout(timeout);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AiGraderHelperBridgeError(
        502,
        "AI_GRADER_HELPER_BRIDGE_INVALID_RESPONSE",
        "AI Grader helper bridge returned invalid JSON."
      );
    }

    if (!response.ok) {
      throw new AiGraderHelperBridgeError(
        response.status,
        "AI_GRADER_HELPER_BRIDGE_UPSTREAM_ERROR",
        helperTransportErrorMessage(payload) ?? "AI Grader helper bridge returned an error.",
        payload
      );
    }

    return payload;
  }

  return {
    health: () => fetchHelper("/health"),
    readiness: () => fetchHelper("/readiness"),
    capabilities: () => fetchHelper("/capabilities"),
    manifest: (mode) =>
      fetchHelper("/manifest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ mode }),
      }),
  };
}

const ROUTES: Record<string, RouteDefinition> = {
  "capture-sessions/draft": {
    allow: "POST",
    operation: "createCaptureSessionDraft",
    execute: (service, body) => service.createCaptureSessionDraft(body as CreateCaptureSessionDraftInput),
  },
  "orchestrator/transition": {
    allow: "POST",
    operation: "persistOrchestratorTransition",
    execute: (service, body) => service.persistOrchestratorTransition(body as PersistOrchestratorTransitionInput),
  },
  "macro/suspect-regions": {
    allow: "POST",
    operation: "persistMacroSuspectRegions",
    execute: (service, body) => service.persistMacroSuspectRegions(body as PersistMacroSuspectRegionsInput),
  },
  "grade-runs/draft": {
    allow: "POST",
    operation: "createGradeRunDraft",
    execute: (service, body) => service.createGradeRunDraft(body as CreateGradeRunDraftInput),
  },
  "grade-runs/finalize": {
    allow: "POST",
    operation: "finalizeGradeRun",
    execute: (service, body) => service.finalizeGradeRun(body as FinalizeGradeRunInput),
  },
  "auth-runs/draft": {
    allow: "POST",
    operation: "createAuthRunDraft",
    execute: (service, body) => service.createAuthRunDraft(body as CreateAuthRunDraftInput),
  },
  "auth-runs/finalize": {
    allow: "POST",
    operation: "finalizeAuthRun",
    execute: (service, body) => service.finalizeAuthRun(body as FinalizeAuthRunInput),
  },
};

const STATUS_ROUTE_KEYS = new Set(["status", "health"]);
const SIMULATOR_ROUTE_KEY = "simulator/generate";
const SIMULATED_SESSION_ROUTE_KEY = "simulator/session";
const SIMULATOR_ROUTE_KEYS = new Set([SIMULATOR_ROUTE_KEY, SIMULATED_SESSION_ROUTE_KEY]);
const HELPER_HEALTH_ROUTE_KEY = "helper/health";
const HELPER_READINESS_ROUTE_KEY = "helper/readiness";
const HELPER_CAPABILITIES_ROUTE_KEY = "helper/capabilities";
const HELPER_MANIFEST_ROUTE_KEY = "helper/manifest";
const HELPER_ROUTE_KEYS = new Set([
  HELPER_HEALTH_ROUTE_KEY,
  HELPER_READINESS_ROUTE_KEY,
  HELPER_CAPABILITIES_ROUTE_KEY,
  HELPER_MANIFEST_ROUTE_KEY,
]);
const routeList = [
  "status",
  "health",
  SIMULATOR_ROUTE_KEY,
  SIMULATED_SESSION_ROUTE_KEY,
  HELPER_HEALTH_ROUTE_KEY,
  HELPER_READINESS_ROUTE_KEY,
  HELPER_CAPABILITIES_ROUTE_KEY,
  HELPER_MANIFEST_ROUTE_KEY,
  ...Object.keys(ROUTES),
];

function simulatorStatus(env: EnvLike) {
  const enabled = isAiGraderSimulatorEnabled(env);
  return {
    enabled,
    ...(enabled ? {} : { code: "AI_GRADER_SIMULATOR_DISABLED" }),
    message: enabled
      ? "AI Grader simulator mode is enabled for local-only manifest generation."
      : "AI Grader simulator mode is disabled. Set AI_GRADER_SIMULATOR_ENABLED=true to enable.",
  };
}

function isSimulatorMode(value: unknown): value is AiGraderSimulatorMode {
  return value === "DEVICE_CAPABILITIES" || value === "QUICK" || value === "STANDARD" || value === "AUTH_ONLY";
}

function isHelperManifestMode(value: unknown): value is AiGraderHelperManifestMode {
  return value === "QUICK" || value === "STANDARD" || value === "AUTH_ONLY";
}

function parseSimulatorGenerateInput(body: JsonRecord): AiGraderSimulatorGenerateInput {
  if (!isSimulatorMode(body.mode)) {
    throw Object.assign(new Error("Simulator mode must be DEVICE_CAPABILITIES, QUICK, STANDARD, or AUTH_ONLY."), {
      name: "AiGraderServiceValidationError",
      issues: [{ path: "mode", code: "INVALID_MODE", message: "mode must be DEVICE_CAPABILITIES, QUICK, STANDARD, or AUTH_ONLY." }],
    });
  }
  if (body.config != null && !isRecord(body.config)) {
    throw Object.assign(new Error("Simulator config must be a JSON object when provided."), {
      name: "AiGraderServiceValidationError",
      issues: [{ path: "config", code: "INVALID_CONFIG", message: "config must be a JSON object when provided." }],
    });
  }
  return {
    mode: body.mode,
    ...(isRecord(body.config) ? { config: body.config as CaptureHelperSimulatorConfigInput } : {}),
  };
}

function parseHelperManifestInput(body: JsonRecord): AiGraderHelperManifestMode {
  if (!isHelperManifestMode(body.mode)) {
    throw Object.assign(new Error("Helper manifest mode must be QUICK, STANDARD, or AUTH_ONLY."), {
      name: "AiGraderServiceValidationError",
      issues: [{ path: "mode", code: "INVALID_MODE", message: "mode must be QUICK, STANDARD, or AUTH_ONLY." }],
    });
  }
  return body.mode;
}

function parseSimulatedSessionWorkflowInput(body: JsonRecord): AiGraderSimulatedSessionWorkflowInput {
  if (body.config != null && !isRecord(body.config)) {
    throw Object.assign(new Error("Simulator config must be a JSON object when provided."), {
      name: "AiGraderServiceValidationError",
      issues: [{ path: "config", code: "INVALID_CONFIG", message: "config must be a JSON object when provided." }],
    });
  }
  return {
    ...(isRecord(body.config) ? { config: body.config as CaptureHelperSimulatorConfigInput } : {}),
  };
}

function combineValidationIssues(results: AiGraderSimulatorValidationSummary[]): AiGraderSimulatorValidationSummary {
  const issues = results.flatMap((result) => result.issues);
  return {
    valid: results.every((result) => result.valid),
    issues,
  };
}

function isStandardMacroFrame(frame: CaptureManifestFrame) {
  return frame.kind === "FRONT_DIFFUSE" || frame.kind === "BACK_DIFFUSE" || frame.kind === "FRONT_DARKFIELD" || frame.kind === "BACK_DARKFIELD";
}

function summarizeMicroPackage(microPackage: MicroSpotCapturePackage) {
  return {
    id: microPackage.id,
    element: microPackage.element,
    spotIndex: microPackage.spotIndex,
    totalSpots: microPackage.totalSpots,
    ...(microPackage.sourceSuspectRegionId ? { sourceSuspectRegionId: microPackage.sourceSuspectRegionId } : {}),
    frameCount: Object.keys(microPackage.frames).length,
  };
}

function manifestStorageKeyExamples(manifest: CaptureManifest, limit = 4) {
  return manifest.frameList
    .map((frame) => frame.storageKey)
    .filter((storageKey): storageKey is string => typeof storageKey === "string" && storageKey.length > 0)
    .slice(0, limit);
}

function summarizeCaptureManifest(input: {
  mode: AiGraderSimulatorMode;
  manifest: CaptureManifest;
  validation: AiGraderSimulatorValidationSummary;
  microSpotPackageCount?: number;
  evidenceArtifactCount?: number;
}): AiGraderSimulatorManifestSummary {
  return {
    mode: input.mode,
    frameCount: input.manifest.frameList.length,
    microSpotPackageCount: input.microSpotPackageCount ?? 0,
    evidenceArtifactCount: input.evidenceArtifactCount ?? 0,
    deviceCapabilityCount: 0,
    helperInstanceId: input.manifest.helperInstanceId,
    calibrationSnapshotIds: input.manifest.calibrationSnapshotIds,
    storageKeyExamples: manifestStorageKeyExamples(input.manifest),
    validation: input.validation,
  };
}

export function generateDefaultAiGraderSimulatorManifest(
  input: AiGraderSimulatorGenerateInput
): AiGraderSimulatorGenerateResult {
  const config = input.config ?? {};

  if (input.mode === "DEVICE_CAPABILITIES") {
    const deviceCapabilityManifests = generateDeviceCapabilityManifests(config);
    const validation = combineValidationIssues(deviceCapabilityManifests.map((manifest) => validateDeviceCapabilityManifest(manifest)));
    return {
      simulator: true,
      mode: input.mode,
      summary: {
        mode: input.mode,
        frameCount: 0,
        microSpotPackageCount: 0,
        evidenceArtifactCount: 0,
        deviceCapabilityCount: deviceCapabilityManifests.length,
        helperInstanceId: deviceCapabilityManifests[0]?.helperInstanceId ?? null,
        calibrationSnapshotIds: [],
        storageKeyExamples: [],
        validation,
      },
      deviceCapabilityManifests,
    };
  }

  if (input.mode === "STANDARD") {
    const simulation = generateStandardCaptureSimulation(config);
    const manifestValidation = validateCaptureManifestForMode(simulation.captureManifest, "STANDARD", { side: "FRONT" });
    const packageValidation = combineValidationIssues(
      simulation.microSpotPackages.map((microPackage) => validateMicroSpotCapturePackage(microPackage))
    );
    const validation = combineValidationIssues([manifestValidation, packageValidation]);
    return {
      simulator: true,
      mode: input.mode,
      summary: summarizeCaptureManifest({
        mode: input.mode,
        manifest: simulation.captureManifest,
        validation,
        microSpotPackageCount: simulation.microSpotPackages.length,
        evidenceArtifactCount: simulation.evidenceArtifacts.length,
      }),
      captureManifest: simulation.captureManifest,
      microSpotPackages: simulation.microSpotPackages,
      evidenceArtifacts: simulation.evidenceArtifacts,
    };
  }

  const captureManifest =
    input.mode === "AUTH_ONLY"
      ? generateAuthOnlyCaptureManifest(config)
      : generateQuickCaptureManifest(config);
  const validation = validateCaptureManifestForMode(captureManifest, input.mode, { side: "FRONT" });

  return {
    simulator: true,
    mode: input.mode,
    summary: summarizeCaptureManifest({
      mode: input.mode,
      manifest: captureManifest,
      validation,
    }),
    captureManifest,
  };
}

export function generateDefaultAiGraderSimulatedSessionWorkflow(
  input: AiGraderSimulatedSessionWorkflowInput = {}
): AiGraderSimulatedSessionWorkflowResult {
  const simulation = generateStandardCaptureSimulation(input.config ?? {});
  const manifestValidation = validateCaptureManifestForMode(simulation.captureManifest, "STANDARD", { side: "FRONT" });
  const packageValidation = combineValidationIssues(
    simulation.microSpotPackages.map((microPackage) => validateMicroSpotCapturePackage(microPackage))
  );
  const validation = combineValidationIssues([manifestValidation, packageValidation]);
  const macroFrames = simulation.captureManifest.frameList.filter(isStandardMacroFrame);
  const surfaceSuspectCount = new Set(
    simulation.microSpotPackages
      .map((microPackage) => microPackage.sourceSuspectRegionId)
      .filter((regionId): regionId is string => typeof regionId === "string" && regionId.length > 0)
  ).size;

  return {
    simulator: true,
    workflow: "STANDARD_SESSION",
    session: {
      sessionId: simulation.captureManifest.captureSessionId,
      tenantId: simulation.captureManifest.tenantId,
      mode: "STANDARD",
      helperInstanceId: simulation.captureManifest.helperInstanceId,
      calibrationSnapshotIds: simulation.captureManifest.calibrationSnapshotIds,
    },
    manifest: {
      id: simulation.captureManifest.id,
      checksumSha256: simulation.captureManifest.checksumSha256,
      frameCount: simulation.captureManifest.frameList.length,
      validation: manifestValidation,
    },
    macro: {
      frameCount: macroFrames.length,
      frames: macroFrames.map((frame) => ({
        frameId: frame.frameId,
        kind: frame.kind,
        side: frame.side,
        storageKey: frame.storageKey,
      })),
    },
    micro: {
      packageCount: simulation.microSpotPackages.length,
      evidenceFrameCount: simulation.evidenceArtifacts.length,
      surfaceSuspectCount,
      packages: simulation.microSpotPackages.map(summarizeMicroPackage),
    },
    gradeRunDraft: {
      status: "SIMULATED_DRAFT",
      captureSessionId: simulation.captureManifest.captureSessionId,
      captureManifestId: simulation.captureManifest.id,
      algorithmVersionId: "simulated-standard-grader-v0",
      thresholdSetVersionId: "simulated-standard-thresholds-v0",
      runtimeEnvironmentId: "simulated-admin-workflow-runtime",
      inputChecksum: simulation.captureManifest.checksumSha256,
      computesGrades: false,
    },
    certificateReadiness: {
      ready: false,
      status: "SIMULATION_ONLY",
      message: "simulation only; production DB migration and hardware capture required",
    },
    validation,
  };
}

export function createAiGraderAdminApiHandler(deps: AiGraderAdminApiDependencies) {
  const env = deps.env ?? process.env;
  const generateSimulatorManifest = deps.generateSimulatorManifest ?? generateDefaultAiGraderSimulatorManifest;
  const generateSimulatedSessionWorkflow =
    deps.generateSimulatedSessionWorkflow ?? generateDefaultAiGraderSimulatedSessionWorkflow;

  return async function aiGraderAdminApiHandler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
    const key = routeKey(req);
    const isHelperRoute = HELPER_ROUTE_KEYS.has(key);

    if (STATUS_ROUTE_KEYS.has(key)) {
      if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        return res.status(405).json({ ok: false, message: "Method not allowed" });
      }
    } else {
      const route = ROUTES[key];
      if (!route && !SIMULATOR_ROUTE_KEYS.has(key) && !isHelperRoute) {
        return res.status(404).json({ ok: false, message: "AI Grader admin API route not found" });
      }
      const allow = SIMULATOR_ROUTE_KEYS.has(key) || key === HELPER_MANIFEST_ROUTE_KEY ? "POST" : isHelperRoute ? "GET" : route.allow;
      if (req.method !== allow) {
        res.setHeader("Allow", allow);
        return res.status(405).json({ ok: false, message: "Method not allowed" });
      }
    }

    if (!isAiGraderApiEnabled(env)) {
      return res.status(503).json({
        ok: false,
        enabled: false,
        code: "AI_GRADER_API_DISABLED",
        message: "AI Grader admin API is disabled. Set AI_GRADER_API_ENABLED=true to enable.",
      });
    }

    if (isHelperRoute) {
      const bridgeStatus = helperBridgeStatus(env);
      if (!bridgeStatus.enabled) {
        return res.status(503).json({
          ok: false,
          enabled: false,
          code: "AI_GRADER_HELPER_BRIDGE_DISABLED",
          message: bridgeStatus.message,
        });
      }
      if (!bridgeStatus.configured) {
        return res.status(400).json({
          ok: false,
          code: bridgeStatus.code ?? "AI_GRADER_HELPER_BRIDGE_CONFIG_INVALID",
          message: bridgeStatus.message,
        });
      }
    }

    if (SIMULATOR_ROUTE_KEYS.has(key) && !isAiGraderSimulatorEnabled(env)) {
      return res.status(503).json({
        ok: false,
        enabled: false,
        code: "AI_GRADER_SIMULATOR_DISABLED",
        message: "AI Grader simulator mode is disabled. Set AI_GRADER_SIMULATOR_ENABLED=true to enable.",
      });
    }

    try {
      const admin = await deps.requireAdminSession(req);

      if (STATUS_ROUTE_KEYS.has(key)) {
        return res.status(200).json({
          ok: true,
          enabled: true,
          service: "ai-grader-admin-api",
          simulator: simulatorStatus(env),
          helperBridge: helperBridgeStatus(env),
          user: {
            id: admin.user.id,
            phone: admin.user.phone,
            displayName: admin.user.displayName,
          },
          routes: routeList,
        });
      }

      if (!isHelperRoute && !isRecord(req.body)) {
        return res.status(400).json({ ok: false, message: "JSON object body is required" });
      }

      if (key === SIMULATOR_ROUTE_KEY) {
        if (!isRecord(req.body)) {
          return res.status(400).json({ ok: false, message: "JSON object body is required" });
        }
        const result = await generateSimulatorManifest(parseSimulatorGenerateInput(req.body));
        return res.status(200).json({
          ok: true,
          enabled: true,
          operation: "generateSimulatorManifest",
          result,
        });
      }

      if (key === SIMULATED_SESSION_ROUTE_KEY) {
        if (!isRecord(req.body)) {
          return res.status(400).json({ ok: false, message: "JSON object body is required" });
        }
        const result = await generateSimulatedSessionWorkflow(parseSimulatedSessionWorkflowInput(req.body));
        return res.status(200).json({
          ok: true,
          enabled: true,
          operation: "generateSimulatedSessionWorkflow",
          result,
        });
      }

      if (isHelperRoute) {
        const helperClient =
          deps.getHelperBridgeClient?.(env) ??
          createAiGraderHelperBridgeClient(env, deps.helperBridgeFetch ?? (globalThis.fetch as unknown as AiGraderHelperBridgeFetch));

        if (key === HELPER_HEALTH_ROUTE_KEY) {
          const result = await helperClient.health();
          return res.status(200).json({
            ok: true,
            enabled: true,
            operation: "helperBridgeHealth",
            result,
          });
        }

        if (key === HELPER_READINESS_ROUTE_KEY) {
          const result = await helperClient.readiness();
          return res.status(200).json({
            ok: true,
            enabled: true,
            operation: "helperBridgeReadiness",
            result,
          });
        }

        if (key === HELPER_CAPABILITIES_ROUTE_KEY) {
          const result = await helperClient.capabilities();
          return res.status(200).json({
            ok: true,
            enabled: true,
            operation: "helperBridgeCapabilities",
            result,
          });
        }

        if (!isRecord(req.body)) {
          return res.status(400).json({ ok: false, message: "JSON object body is required" });
        }

        const result = await helperClient.manifest(parseHelperManifestInput(req.body));
        return res.status(200).json({
          ok: true,
          enabled: true,
          operation: "helperBridgeManifest",
          result,
        });
      }

      if (!isRecord(req.body)) {
        return res.status(400).json({ ok: false, message: "JSON object body is required" });
      }

      const route = ROUTES[key];
      const service = await deps.getService();
      const result = await route.execute(service, req.body, admin);

      return res.status(200).json({
        ok: true,
        enabled: true,
        operation: route.operation,
        result,
      });
    } catch (error) {
      if (error instanceof AiGraderHelperBridgeError) {
        return res.status(error.statusCode).json({
          ok: false,
          code: error.code,
          message: error.message,
          ...(error.details == null ? {} : { details: error.details }),
        });
      }

      const validationResponse = validationErrorResponse(error);
      if (validationResponse) {
        return res.status(validationResponse.status).json(validationResponse.body);
      }

      return res.status(errorStatus(error)).json({
        ok: false,
        message: errorMessage(error),
      });
    }
  };
}
