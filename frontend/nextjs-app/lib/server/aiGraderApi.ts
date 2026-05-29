import type { NextApiRequest, NextApiResponse } from "next";
import type {
  CreateAuthRunDraftInput,
  CreateCaptureSessionDraftInput,
  CreateGradeRunDraftInput,
  FinalizeAuthRunInput,
  FinalizeGradeRunInput,
  PersistMacroSuspectRegionsInput,
  PersistOrchestratorTransitionInput,
} from "@tenkings/database";
import type { AdminSession } from "./admin";

export const AI_GRADER_API_ENABLED_ENV = "AI_GRADER_API_ENABLED";

type JsonRecord = Record<string, unknown>;
type EnvLike = Record<string, string | undefined>;

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
const routeList = ["status", "health", ...Object.keys(ROUTES)];

export function createAiGraderAdminApiHandler(deps: AiGraderAdminApiDependencies) {
  const env = deps.env ?? process.env;

  return async function aiGraderAdminApiHandler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
    const key = routeKey(req);

    if (STATUS_ROUTE_KEYS.has(key)) {
      if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        return res.status(405).json({ ok: false, message: "Method not allowed" });
      }
    } else {
      const route = ROUTES[key];
      if (!route) {
        return res.status(404).json({ ok: false, message: "AI Grader admin API route not found" });
      }
      if (req.method !== route.allow) {
        res.setHeader("Allow", route.allow);
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

    try {
      const admin = await deps.requireAdminSession(req);

      if (STATUS_ROUTE_KEYS.has(key)) {
        return res.status(200).json({
          ok: true,
          enabled: true,
          service: "ai-grader-admin-api",
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
