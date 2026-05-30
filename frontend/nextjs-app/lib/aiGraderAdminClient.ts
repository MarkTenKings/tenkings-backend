export type AiGraderAdminApiStatus = {
  enabled: boolean;
  message?: string;
  code?: string;
  service?: string;
  simulator?: {
    enabled: boolean;
    message?: string;
    code?: string;
  };
  routes?: string[];
  user?: {
    id: string;
    phone: string | null;
    displayName: string | null;
  };
};

export type AiGraderSimulatorMode = "DEVICE_CAPABILITIES" | "QUICK" | "STANDARD" | "AUTH_ONLY";

export type AiGraderSimulatorSummary = {
  mode: AiGraderSimulatorMode;
  frameCount: number;
  microSpotPackageCount: number;
  evidenceArtifactCount: number;
  deviceCapabilityCount: number;
  helperInstanceId: string | null;
  calibrationSnapshotIds: string[];
  storageKeyExamples: string[];
  validation: {
    valid: boolean;
    issues: unknown[];
  };
};

export type AiGraderSimulatorResult = {
  simulator: true;
  mode: AiGraderSimulatorMode;
  summary: AiGraderSimulatorSummary;
  deviceCapabilityManifests?: unknown[];
  captureManifest?: unknown;
  microSpotPackages?: unknown[];
  evidenceArtifacts?: unknown[];
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
    validation: {
      valid: boolean;
      issues: unknown[];
    };
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
  validation: {
    valid: boolean;
    issues: unknown[];
  };
};

export type AiGraderAdminOperation =
  | "captureSessionDraft"
  | "orchestratorTransition"
  | "macroSuspectRegions"
  | "gradeRunDraft"
  | "gradeRunFinalize"
  | "authRunDraft"
  | "authRunFinalize";

export const AI_GRADER_ADMIN_OPERATION_PATHS: Record<AiGraderAdminOperation, string> = {
  captureSessionDraft: "capture-sessions/draft",
  orchestratorTransition: "orchestrator/transition",
  macroSuspectRegions: "macro/suspect-regions",
  gradeRunDraft: "grade-runs/draft",
  gradeRunFinalize: "grade-runs/finalize",
  authRunDraft: "auth-runs/draft",
  authRunFinalize: "auth-runs/finalize",
};

export type AiGraderAdminFetchResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

export type AiGraderAdminFetch = (
  input: string,
  init?: RequestInit
) => Promise<AiGraderAdminFetchResponse>;

type ApiErrorPayload = {
  ok?: false;
  enabled?: false;
  code?: string;
  message?: string;
  issues?: unknown[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isApiErrorPayload(value: unknown): value is ApiErrorPayload {
  return isRecord(value);
}

async function readJson(response: AiGraderAdminFetchResponse): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export class AiGraderAdminApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly issues?: unknown[];
  readonly disabled: boolean;

  constructor(input: {
    status: number;
    message: string;
    code?: string;
    issues?: unknown[];
    disabled?: boolean;
  }) {
    super(input.message);
    this.name = "AiGraderAdminApiError";
    this.status = input.status;
    this.code = input.code;
    this.issues = input.issues;
    this.disabled = input.disabled ?? false;
  }
}

export async function parseAiGraderAdminResponse<T>(response: AiGraderAdminFetchResponse): Promise<T> {
  const payload = await readJson(response);

  if (!response.ok) {
    const apiError = isApiErrorPayload(payload) ? payload : {};
    throw new AiGraderAdminApiError({
      status: response.status,
      message: apiError.message ?? "AI Grader request failed",
      code: apiError.code,
      issues: apiError.issues,
      disabled:
        apiError.code === "AI_GRADER_API_DISABLED" ||
        apiError.code === "AI_GRADER_SIMULATOR_DISABLED" ||
        apiError.enabled === false,
    });
  }

  return payload as T;
}

export async function fetchAiGraderAdminStatus(
  headers: Record<string, string>,
  fetchImpl: AiGraderAdminFetch = globalThis.fetch as AiGraderAdminFetch
): Promise<AiGraderAdminApiStatus> {
  const response = await fetchImpl("/api/admin/ai-grader/status", { headers });
  const payload = await readJson(response);

  if (!response.ok) {
    const apiError = isApiErrorPayload(payload) ? payload : {};
    if (response.status === 503 && (apiError.enabled === false || apiError.code === "AI_GRADER_API_DISABLED")) {
      return {
        enabled: false,
        message: apiError.message ?? "AI Grader admin API is disabled.",
        code: apiError.code ?? "AI_GRADER_API_DISABLED",
        simulator: {
          enabled: false,
          code: "AI_GRADER_SIMULATOR_DISABLED",
          message: "AI Grader simulator status is unavailable while the admin API is disabled.",
        },
      };
    }
    throw new AiGraderAdminApiError({
      status: response.status,
      message: apiError.message ?? "Failed to load AI Grader API status",
      code: apiError.code,
      issues: apiError.issues,
      disabled: apiError.enabled === false,
    });
  }

  if (!isRecord(payload) || payload.ok !== true) {
    throw new AiGraderAdminApiError({
      status: response.status,
      message: "AI Grader API status returned an unexpected payload",
    });
  }

  return {
    enabled: payload.enabled === true,
    service: typeof payload.service === "string" ? payload.service : undefined,
    simulator: isRecord(payload.simulator)
      ? {
          enabled: payload.simulator.enabled === true,
          message: typeof payload.simulator.message === "string" ? payload.simulator.message : undefined,
          code: typeof payload.simulator.code === "string" ? payload.simulator.code : undefined,
        }
      : undefined,
    routes: Array.isArray(payload.routes) ? payload.routes.filter((route): route is string => typeof route === "string") : [],
    user: isRecord(payload.user)
      ? {
          id: typeof payload.user.id === "string" ? payload.user.id : "",
          phone: typeof payload.user.phone === "string" ? payload.user.phone : null,
          displayName: typeof payload.user.displayName === "string" ? payload.user.displayName : null,
        }
      : undefined,
  };
}

export async function postAiGraderAdminOperation(
  operation: AiGraderAdminOperation,
  body: unknown,
  headers: Record<string, string>,
  fetchImpl: AiGraderAdminFetch = globalThis.fetch as AiGraderAdminFetch
) {
  const path = AI_GRADER_ADMIN_OPERATION_PATHS[operation];
  return parseAiGraderAdminResponse<unknown>(
    await fetchImpl(`/api/admin/ai-grader/${path}`, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })
  );
}

export async function generateAiGraderSimulatorManifest(
  mode: AiGraderSimulatorMode,
  headers: Record<string, string>,
  fetchImpl: AiGraderAdminFetch = globalThis.fetch as AiGraderAdminFetch
): Promise<AiGraderSimulatorResult> {
  const payload = await parseAiGraderAdminResponse<{ ok: true; result: AiGraderSimulatorResult }>(
    await fetchImpl("/api/admin/ai-grader/simulator/generate", {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ mode }),
    })
  );

  return payload.result;
}

export async function generateAiGraderSimulatedSessionWorkflow(
  headers: Record<string, string>,
  fetchImpl: AiGraderAdminFetch = globalThis.fetch as AiGraderAdminFetch
): Promise<AiGraderSimulatedSessionWorkflowResult> {
  const payload = await parseAiGraderAdminResponse<{ ok: true; result: AiGraderSimulatedSessionWorkflowResult }>(
    await fetchImpl("/api/admin/ai-grader/simulator/session", {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    })
  );

  return payload.result;
}
