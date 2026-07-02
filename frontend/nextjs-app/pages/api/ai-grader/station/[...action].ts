import type { NextApiRequest, NextApiResponse } from "next";
import {
  buildAiGraderLocalStationStatus,
  parseAiGraderStationAction,
  type AiGraderStationAction,
} from "../../../../lib/aiGraderLocalStation";

type ApiResponse =
  | {
      ok: true;
      operation: AiGraderStationAction;
      result: ReturnType<typeof buildAiGraderLocalStationStatus>;
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

const GET_ACTIONS = new Set<AiGraderStationAction>(["status", "latest-report", "session-manifest"]);

export default function aiGraderLocalStationHandler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  const action = parseAiGraderStationAction(req.query.action);
  if (!action) {
    return res.status(404).json({
      ok: false,
      code: "AI_GRADER_LOCAL_STATION_ROUTE_NOT_FOUND",
      message: "AI Grader local station route not found.",
    });
  }

  const expectedMethod = GET_ACTIONS.has(action) ? "GET" : "POST";
  if (req.method !== expectedMethod) {
    res.setHeader("Allow", expectedMethod);
    return res.status(405).json({
      ok: false,
      code: "AI_GRADER_LOCAL_STATION_METHOD_NOT_ALLOWED",
      message: "Method not allowed for AI Grader local station action.",
    });
  }

  return res.status(200).json({
    ok: true,
    operation: action,
    result: buildAiGraderLocalStationStatus({
      action,
      mode: "mock_dev",
      now: new Date().toISOString(),
    }),
  });
}
