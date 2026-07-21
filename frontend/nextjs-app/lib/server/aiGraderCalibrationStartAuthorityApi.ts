import type { NextApiRequest, NextApiResponse } from "next";
import type {
  AiGraderCalibrationStartAuthorityResponseV1,
} from "@tenkings/shared";

type HumanActor = { type: "human_operator"; user: { id: string } };
type StartAuthorityService = {
  readStartAuthority(
    tenantId: string,
    rigId: string,
  ): Promise<Omit<AiGraderCalibrationStartAuthorityResponseV1, "ok">>;
};

export type AiGraderCalibrationStartAuthorityApiDependencies = {
  requireHumanActor(req: NextApiRequest): Promise<HumanActor>;
  service: StartAuthorityService;
};

function safeError(error: unknown) {
  const value = error as { code?: unknown; message?: unknown; statusCode?: unknown };
  const status = typeof value?.statusCode === "number" ? value.statusCode : 500;
  return {
    status,
    code: typeof value?.code === "string" ? value.code : "AI_GRADER_CALIBRATION_ACTIVATION_UNAVAILABLE",
    message: status >= 500 ? "Calibration activation authority is unavailable." : String(value?.message ?? "Calibration activation authority is unavailable."),
  };
}

export function createAiGraderCalibrationStartAuthorityApiHandler(
  deps: AiGraderCalibrationStartAuthorityApiDependencies,
) {
  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    try {
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED", message: "Method not allowed." });
      }
      await deps.requireHumanActor(req);
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) ||
          Object.keys(req.body).sort().join(",") !== "rigId,tenantId") {
        return res.status(400).json({ ok: false, code: "INVALID_REQUEST", message: "Exact tenantId and rigId are required." });
      }
      const result = await deps.service.readStartAuthority(String(req.body.tenantId ?? ""), String(req.body.rigId ?? ""));
      return res.status(200).json({ ok: true, ...result });
    } catch (error) {
      const failure = safeError(error);
      return res.status(failure.status).json({ ok: false, code: failure.code, message: failure.message });
    }
  };
}
