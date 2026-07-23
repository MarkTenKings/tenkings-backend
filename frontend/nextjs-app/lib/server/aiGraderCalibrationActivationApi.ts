import type { NextApiRequest, NextApiResponse } from "next";
import type {
  AiGraderCalibrationActivateRequestV1,
  AiGraderCalibrationCompleteActivationRequestV1,
  AiGraderCalibrationFailActivationRequestV1,
  AiGraderCalibrationReactivateRequestV1,
} from "@tenkings/shared";

type AdminIdentity = { user: { id: string } };
type JsonRecord = Record<string, unknown>;
type ActivationService = {
  resolveTrustedRegistry(): Promise<any>;
  list(rigId: string, includeIncomplete?: boolean): Promise<any>;
  status(rigId: string): Promise<any>;
  requestActivation(
    input:
      | (AiGraderCalibrationActivateRequestV1 & { action: "activate" })
      | (AiGraderCalibrationReactivateRequestV1 & { action: "reactivate" }),
    actorUserId: string,
  ): Promise<any>;
  completeActivation(input: AiGraderCalibrationCompleteActivationRequestV1, actorUserId: string): Promise<any>;
  failActivation(input: AiGraderCalibrationFailActivationRequestV1, actorUserId: string): Promise<any>;
};

export type AiGraderCalibrationActivationApiDependencies = {
  requireAdminSession(req: NextApiRequest): Promise<AdminIdentity>;
  requireFreshAdminSession(req: NextApiRequest): Promise<AdminIdentity>;
  service: ActivationService;
};

const WRITE_ACTIONS = new Set(["activate", "reactivate", "complete", "fail"]);

function actionFrom(req: NextApiRequest) {
  const parts = Array.isArray(req.query.action) ? req.query.action : [req.query.action];
  return parts.filter((part): part is string => typeof part === "string" && part.length > 0).join("/");
}

function exactBody(value: unknown, allowedKeys: readonly string[]): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error("Request body must be an exact JSON object."), { statusCode: 400 });
  }
  const input = value as JsonRecord;
  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(input).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw Object.assign(new Error(`Request body contains forbidden field: ${unexpected[0]}.`), { statusCode: 400 });
  }
  return input;
}

function safeError(error: unknown) {
  const value = error as { code?: unknown; message?: unknown; statusCode?: unknown };
  const code = typeof value?.code === "string"
    ? value.code : "AI_GRADER_CALIBRATION_ACTIVATION_REQUEST_FAILED";
  const status = typeof value?.statusCode === "number" ? value.statusCode : 500;
  return {
    status,
    code,
    message: status >= 500
      ? "Calibration activation authority is unavailable."
      : String(value?.message ?? "Calibration activation request failed."),
  };
}

/** Hosted registry API. The route selects the action and the authenticated server selects the actor. */
export function createAiGraderCalibrationActivationApiHandler(
  deps: AiGraderCalibrationActivationApiDependencies,
) {
  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    try {
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED", message: "Method not allowed." });
      }
      const action = actionFrom(req);
      const admin = WRITE_ACTIONS.has(action)
        ? await deps.requireFreshAdminSession(req)
        : await deps.requireAdminSession(req);

      if (action === "resolve-trusted") {
        exactBody(req.body, []);
        const resolved = await deps.service.resolveTrustedRegistry();
        return res.status(200).json({ ok: true, ...resolved });
      }
      if (action === "list") {
        const input = exactBody(req.body, ["rigId", "includeIncomplete"]);
        if (input.includeIncomplete !== undefined && typeof input.includeIncomplete !== "boolean") {
          throw Object.assign(new Error("includeIncomplete must be a boolean."), { statusCode: 400 });
        }
        const registry = await deps.service.list(String(input.rigId ?? ""), input.includeIncomplete as boolean | undefined);
        return res.status(200).json({ ok: true, registry });
      }
      if (action === "status") {
        const input = exactBody(req.body, ["rigId"]);
        const status = await deps.service.status(String(input.rigId ?? ""));
        return res.status(200).json({ ok: true, ...status });
      }
      if (action === "activate") {
        const input = exactBody(req.body, ["rigId", "snapshotId", "expectedRegistryRevision", "idempotencyKey", "reason"]);
        const pending = await deps.service.requestActivation({
          ...(input as AiGraderCalibrationActivateRequestV1),
          action: "activate",
        }, admin.user.id);
        return res.status(201).json({ ok: true, ...pending });
      }
      if (action === "reactivate") {
        const input = exactBody(req.body, ["rigId", "snapshotId", "priorActivationId", "expectedRegistryRevision", "idempotencyKey", "reason"]);
        const pending = await deps.service.requestActivation({
          ...(input as AiGraderCalibrationReactivateRequestV1),
          action: "reactivate",
        }, admin.user.id);
        return res.status(201).json({ ok: true, ...pending });
      }
      if (action === "complete") {
        const input = exactBody(req.body, ["activationId", "expectedActivationRevision", "idempotencyKey", "workstationReceipt"]);
        const completed = await deps.service.completeActivation(
          input as AiGraderCalibrationCompleteActivationRequestV1,
          admin.user.id,
        );
        return res.status(200).json({ ok: true, ...completed });
      }
      if (action === "fail") {
        const input = exactBody(req.body, ["activationId", "expectedActivationRevision", "idempotencyKey", "failureCode"]);
        const failed = await deps.service.failActivation(
          input as AiGraderCalibrationFailActivationRequestV1,
          admin.user.id,
        );
        return res.status(200).json({ ok: true, ...failed });
      }
      return res.status(404).json({
        ok: false,
        code: "ACTION_NOT_FOUND",
        message: "Unknown calibration activation action.",
      });
    } catch (error) {
      const failure = safeError(error);
      return res.status(failure.status).json({ ok: false, code: failure.code, message: failure.message });
    }
  };
}
