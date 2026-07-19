import type { NextApiRequest, NextApiResponse } from "next";
import type {
  AiGraderMathematicalCalibrationSnapshotRow,
  ImportAiGraderMathematicalCalibrationSnapshotV1Input,
  RevokeAiGraderMathematicalCalibrationSnapshotV1Input,
  SupersedeAiGraderMathematicalCalibrationSnapshotV1Input,
  TrustAiGraderMathematicalCalibrationSnapshotV1Input,
} from "@tenkings/database";

type AdminIdentity = { user: { id: string } };
type SnapshotService = {
  importDraft(input: ImportAiGraderMathematicalCalibrationSnapshotV1Input):
    Promise<AiGraderMathematicalCalibrationSnapshotRow>;
  listForRig(rigId: string): Promise<AiGraderMathematicalCalibrationSnapshotRow[]>;
  trust(input: TrustAiGraderMathematicalCalibrationSnapshotV1Input):
    Promise<AiGraderMathematicalCalibrationSnapshotRow>;
  revoke(input: RevokeAiGraderMathematicalCalibrationSnapshotV1Input):
    Promise<AiGraderMathematicalCalibrationSnapshotRow>;
  supersede(input: SupersedeAiGraderMathematicalCalibrationSnapshotV1Input):
    Promise<AiGraderMathematicalCalibrationSnapshotRow>;
};

export type AiGraderMathematicalCalibrationSnapshotApiDependencies = {
  requireAdminSession(req: NextApiRequest): Promise<AdminIdentity>;
  service: SnapshotService;
};

function actionFrom(req: NextApiRequest) {
  const parts = Array.isArray(req.query.action) ? req.query.action : [req.query.action];
  return parts.filter((part): part is string => typeof part === "string" && part.length > 0).join("/");
}

function body(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error("Request body must be an exact JSON object."), { statusCode: 400 });
  }
  return value as Record<string, unknown>;
}

function safeError(error: unknown) {
  const value = error as { code?: unknown; message?: unknown; statusCode?: unknown };
  const code = typeof value?.code === "string"
    ? value.code : "AI_GRADER_MATHEMATICAL_CALIBRATION_REQUEST_FAILED";
  const status = typeof value?.statusCode === "number" ? value.statusCode
    : code.endsWith("EXACT_SNAPSHOT_NOT_FOUND") ? 404
      : code.endsWith("STATE_CONFLICT") || code.endsWith("ARTIFACT_INTEGRITY_MISMATCH") ? 409
        : code.endsWith("ARTIFACT_READ_UNAVAILABLE") || code.endsWith("ARTIFACT_READ_FAILED") ? 503
          : code.endsWith("INVALID_INPUT") || code.endsWith("ARTIFACT_INVALID") ? 400
            : 500;
  return {
    status,
    code,
    message: status === 500
      ? "Mathematical calibration snapshot request failed."
      : String(value?.message ?? "Mathematical calibration snapshot request failed."),
  };
}

/** Admin-only, exact-id/hash lifecycle. It never provides a production grading mutation. */
export function createAiGraderMathematicalCalibrationSnapshotApiHandler(
  deps: AiGraderMathematicalCalibrationSnapshotApiDependencies,
) {
  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    try {
      const admin = await deps.requireAdminSession(req);
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED", message: "Method not allowed." });
      }
      const input = body(req.body);
      const action = actionFrom(req);
      if (action === "list") {
        const snapshots = await deps.service.listForRig(String(input.rigId ?? ""));
        return res.status(200).json({ ok: true, snapshots });
      }
      if (action === "import") {
        const snapshot = await deps.service.importDraft({
          ...(input as unknown as Omit<
            ImportAiGraderMathematicalCalibrationSnapshotV1Input,
            "importedByOperatorId"
          >),
          importedByOperatorId: admin.user.id,
        });
        return res.status(201).json({ ok: true, snapshot });
      }
      if (action === "trust") {
        const snapshot = await deps.service.trust({
          ...(input as unknown as Omit<
            TrustAiGraderMathematicalCalibrationSnapshotV1Input,
            "trustedByOperatorId"
          >),
          trustedByOperatorId: admin.user.id,
        });
        return res.status(200).json({ ok: true, snapshot });
      }
      if (action === "revoke") {
        const snapshot = await deps.service.revoke({
          ...(input as unknown as Omit<
            RevokeAiGraderMathematicalCalibrationSnapshotV1Input,
            "revokedByOperatorId"
          >),
          revokedByOperatorId: admin.user.id,
        });
        return res.status(200).json({ ok: true, snapshot });
      }
      if (action === "supersede") {
        const snapshot = await deps.service.supersede({
          ...(input as unknown as Omit<
            SupersedeAiGraderMathematicalCalibrationSnapshotV1Input,
            "supersededByOperatorId"
          >),
          supersededByOperatorId: admin.user.id,
        });
        return res.status(200).json({ ok: true, snapshot });
      }
      return res.status(404).json({
        ok: false,
        code: "ACTION_NOT_FOUND",
        message: "Unknown mathematical calibration snapshot action.",
      });
    } catch (error) {
      const failure = safeError(error);
      return res.status(failure.status).json({
        ok: false,
        code: failure.code,
        message: failure.message,
      });
    }
  };
}
