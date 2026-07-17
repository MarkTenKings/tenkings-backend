import type { AiGraderCaptureTriggerMode, AiGraderLocalStationStatus } from "./aiGraderLocalStation";
import { callAiGraderStationBridge } from "./aiGraderStationBridgeClient";
import type { AiGraderPreviewFrameBinding } from "./aiGraderPreviewLifecycle";

const SAFE_ASSERTION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function assertionId(value: string, label: string) {
  const normalized = value.trim();
  if (!SAFE_ASSERTION_ID.test(normalized) || /token|secret|bearer|presign|x-amz|localhost/i.test(normalized)) {
    throw new Error(`AI Grader ${label} is missing or unsafe.`);
  }
  return normalized;
}

export type AiGraderCaptureSide = "front" | "back";
export type AiGraderCaptureMode = "detected_geometry";

export type AiGraderCaptureAssertion<Side extends AiGraderCaptureSide = AiGraderCaptureSide> = {
  expectedSessionId: string;
  expectedReportId: string;
  expectedSide: Side;
  expectedSideEpoch: string;
  expectedFrameId: string;
  geometryCaptureMode: AiGraderCaptureMode;
  captureTriggerMode: AiGraderCaptureTriggerMode;
};

export async function runAiGraderCapture(input: {
  baseUrl: string;
  stationToken: string;
  assertion: AiGraderCaptureAssertion;
  requestId: string;
  captureTriggerAt?: string;
}, fetchImpl: typeof fetch = fetch): Promise<AiGraderLocalStationStatus> {
  const captureTriggerAt = new Date(input.captureTriggerAt ?? Date.now()).toISOString();
  return callAiGraderStationBridge({
    baseUrl: input.baseUrl,
    stationToken: input.stationToken,
    action: input.assertion.expectedSide === "front" ? "capture-front" : "capture-back",
    body: {
      idempotencyKey: assertionId(input.requestId, "capture request ID"),
      expectedSessionId: assertionId(input.assertion.expectedSessionId, "expected session ID"),
      expectedReportId: assertionId(input.assertion.expectedReportId, "expected report ID"),
      expectedSide: input.assertion.expectedSide,
      expectedSideEpoch: assertionId(input.assertion.expectedSideEpoch, "expected side epoch"),
      expectedFrameId: assertionId(input.assertion.expectedFrameId, "expected frame ID"),
      geometryCaptureMode: "detected_geometry",
      captureTriggerMode: "operator",
      captureTriggerAt,
    },
  }, fetchImpl);
}

export function aiGraderCaptureAssertionFromFrame<Side extends AiGraderCaptureSide>(input: {
  frame: AiGraderPreviewFrameBinding & { side: Side };
  reportId: string;
  geometryCaptureMode: AiGraderCaptureMode;
  captureTriggerMode: AiGraderCaptureTriggerMode;
}): AiGraderCaptureAssertion<Side> {
  return {
    expectedSessionId: input.frame.sessionId,
    expectedReportId: input.reportId,
    expectedSide: input.frame.side,
    expectedSideEpoch: input.frame.sideEpoch,
    expectedFrameId: input.frame.frameId,
    geometryCaptureMode: "detected_geometry",
    captureTriggerMode: "operator",
  };
}
