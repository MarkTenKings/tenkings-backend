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
  type DeviceCapabilityManifest,
  validateCaptureManifestForMode,
  validateDeviceCapabilityManifest,
  validateMicroSpotCapturePackage,
} from "@tenkings/shared";
import type { AdminSession } from "./admin";

export const AI_GRADER_API_ENABLED_ENV = "AI_GRADER_API_ENABLED";
export const AI_GRADER_SIMULATOR_ENABLED_ENV = "AI_GRADER_SIMULATOR_ENABLED";

type JsonRecord = Record<string, unknown>;
type EnvLike = Record<string, string | undefined>;

export type AiGraderSimulatorMode = "DEVICE_CAPABILITIES" | "QUICK" | "STANDARD" | "AUTH_ONLY";

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

export type AiGraderSimulatorGenerator = (
  input: AiGraderSimulatorGenerateInput
) => Promise<AiGraderSimulatorGenerateResult> | AiGraderSimulatorGenerateResult;

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
const routeList = ["status", "health", SIMULATOR_ROUTE_KEY, ...Object.keys(ROUTES)];

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

function combineValidationIssues(results: AiGraderSimulatorValidationSummary[]): AiGraderSimulatorValidationSummary {
  const issues = results.flatMap((result) => result.issues);
  return {
    valid: results.every((result) => result.valid),
    issues,
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

export function createAiGraderAdminApiHandler(deps: AiGraderAdminApiDependencies) {
  const env = deps.env ?? process.env;
  const generateSimulatorManifest = deps.generateSimulatorManifest ?? generateDefaultAiGraderSimulatorManifest;

  return async function aiGraderAdminApiHandler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
    const key = routeKey(req);

    if (STATUS_ROUTE_KEYS.has(key)) {
      if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        return res.status(405).json({ ok: false, message: "Method not allowed" });
      }
    } else {
      const route = ROUTES[key];
      if (!route && key !== SIMULATOR_ROUTE_KEY) {
        return res.status(404).json({ ok: false, message: "AI Grader admin API route not found" });
      }
      const allow = key === SIMULATOR_ROUTE_KEY ? "POST" : route.allow;
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

    if (key === SIMULATOR_ROUTE_KEY && !isAiGraderSimulatorEnabled(env)) {
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
          user: {
            id: admin.user.id,
            phone: admin.user.phone,
            displayName: admin.user.displayName,
          },
          routes: routeList,
        });
      }

      if (!isRecord(req.body)) {
        return res.status(400).json({ ok: false, message: "JSON object body is required" });
      }

      if (key === SIMULATOR_ROUTE_KEY) {
        const result = await generateSimulatorManifest(parseSimulatorGenerateInput(req.body));
        return res.status(200).json({
          ok: true,
          enabled: true,
          operation: "generateSimulatorManifest",
          result,
        });
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
