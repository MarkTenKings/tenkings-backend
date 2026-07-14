import type {
  AiGraderCaptureTriggerMode,
  AiGraderLocalStationStatus,
  AiGraderLocalStationPreviewStatus,
} from "./aiGraderLocalStation";
import {
  callAiGraderStationBridge,
  fetchAiGraderStationPreviewStatus,
  retryAiGraderBackPositioningLight,
  type AiGraderBackPositioningRetryResult,
  type AiGraderStationBridgeActionRequestBody,
} from "./aiGraderStationBridgeClient";
import {
  aiGraderLocalBackCaptureIntentMatches,
  aiGraderPreviewBindingMatches,
  aiGraderPreviewStatusBinding,
  isAiGraderConfirmedBackCaptureTransitionFailure,
  type AiGraderLocalBackCaptureIntent,
  type AiGraderPreviewEpochBinding,
  type AiGraderPreviewFrameBinding,
} from "./aiGraderPreviewLifecycle";

const SAFE_ASSERTION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function assertionId(value: string, label: string) {
  const normalized = value.trim();
  if (!SAFE_ASSERTION_ID.test(normalized)) {
    throw new Error("AI Grader " + label + " is missing or unsafe.");
  }
  if (/token|secret|bearer|presign|x-amz|localhost/i.test(normalized)) {
    throw new Error("AI Grader " + label + " cannot contain local or credential-bearing data.");
  }
  return normalized;
}

function hash32(value: string, seed: number) {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export type AiGraderBackCaptureMode = "detected_geometry" | "manual_capture";

export type AiGraderBackCaptureAssertion = {
  expectedSessionId: string;
  expectedReportId: string;
  expectedSide: "back";
  expectedSideEpoch: string;
  expectedFrameId: string;
  geometryCaptureMode: AiGraderBackCaptureMode;
  captureTriggerMode: AiGraderCaptureTriggerMode;
};

export type AiGraderBackCaptureAttempt = {
  signature: string;
  idempotencyKey: string;
  captureTriggerAt: string;
};

export function aiGraderBackCaptureAttemptSignature(input: AiGraderBackCaptureAssertion) {
  return [
    assertionId(input.expectedSessionId, "expected session ID"),
    assertionId(input.expectedReportId, "expected report ID"),
    input.expectedSide,
    assertionId(input.expectedSideEpoch, "expected side epoch"),
    assertionId(input.expectedFrameId, "expected frame ID"),
    input.geometryCaptureMode,
    input.captureTriggerMode,
  ].join("|");
}

export function createAiGraderBackCaptureAttempt(
  input: AiGraderBackCaptureAssertion,
  captureTriggerAt = new Date().toISOString(),
): AiGraderBackCaptureAttempt {
  const signature = aiGraderBackCaptureAttemptSignature(input);
  const timestampMs = Date.parse(captureTriggerAt);
  if (!Number.isFinite(timestampMs)) {
    throw new Error("AI Grader capture trigger timestamp is invalid.");
  }
  return {
    signature,
    idempotencyKey:
      "capture-back-v0.8-" +
      hash32(signature, 0x811c9dc5) +
      hash32(signature, 0x9e3779b9),
    captureTriggerAt: new Date(timestampMs).toISOString(),
  };
}

export function buildAiGraderAtomicBackCaptureRequest(input: {
  assertion: AiGraderBackCaptureAssertion;
  attempt: AiGraderBackCaptureAttempt;
}): AiGraderStationBridgeActionRequestBody {
  const signature = aiGraderBackCaptureAttemptSignature(input.assertion);
  if (input.attempt.signature !== signature) {
    throw new Error("AI Grader back-capture attempt does not match the displayed preview snapshot.");
  }
  const idempotencyKey = assertionId(input.attempt.idempotencyKey, "back-capture idempotency key");
  const captureTriggerAtMs = Date.parse(input.attempt.captureTriggerAt);
  if (!Number.isFinite(captureTriggerAtMs)) {
    throw new Error("AI Grader capture trigger timestamp is invalid.");
  }
  return {
    idempotencyKey,
    expectedSessionId: assertionId(input.assertion.expectedSessionId, "expected session ID"),
    expectedReportId: assertionId(input.assertion.expectedReportId, "expected report ID"),
    expectedSide: "back",
    expectedSideEpoch: assertionId(input.assertion.expectedSideEpoch, "expected side epoch"),
    expectedFrameId: assertionId(input.assertion.expectedFrameId, "expected frame ID"),
    geometryCaptureMode: input.assertion.geometryCaptureMode,
    captureTriggerMode: input.assertion.captureTriggerMode,
    captureTriggerAt: new Date(captureTriggerAtMs).toISOString(),
  };
}

export async function runAiGraderAtomicBackCapture(input: {
  baseUrl: string;
  stationToken: string;
  assertion: AiGraderBackCaptureAssertion;
  attempt: AiGraderBackCaptureAttempt;
}, fetchImpl: typeof fetch = fetch): Promise<AiGraderLocalStationStatus> {
  return callAiGraderStationBridge({
    baseUrl: input.baseUrl,
    stationToken: input.stationToken,
    action: "capture-back",
    body: buildAiGraderAtomicBackCaptureRequest(input),
  }, fetchImpl);
}

function confirmsAiGraderBackCapturePreTransitionFailure(input: {
  intent: AiGraderLocalBackCaptureIntent;
  previewStatus: AiGraderLocalStationPreviewStatus;
  capturePostResponseReceived: boolean;
}) {
  const authoritativeBinding = aiGraderPreviewStatusBinding(input.previewStatus);
  if (
    !authoritativeBinding ||
    !aiGraderPreviewBindingMatches(authoritativeBinding, input.intent.binding) ||
    !aiGraderLocalBackCaptureIntentMatches({
      expectedBinding: authoritativeBinding,
      localIntent: input.intent,
    }) ||
    input.previewStatus.intentionalTransition.active ||
    input.previewStatus.intentionalTransition.outcome === "capture_started" ||
    input.previewStatus.cameraOwnership === "capture_action"
  ) return false;
  if (isAiGraderConfirmedBackCaptureTransitionFailure({
    expectedBinding: input.intent.binding,
    localIntent: input.intent,
    authoritativeBinding,
    bridgeIntent: input.previewStatus.intentionalTransition,
  })) return true;
  return input.capturePostResponseReceived && (
    input.previewStatus.status === "live" ||
    input.previewStatus.status === "starting" ||
    input.previewStatus.status === "stopped" ||
    input.previewStatus.status === "error"
  );
}

export async function runAiGraderStationBackCaptureOrchestration(input: {
  baseUrl: string;
  stationToken: string;
  assertion: AiGraderBackCaptureAssertion;
  attempt: AiGraderBackCaptureAttempt;
  onIntent: (intent: AiGraderLocalBackCaptureIntent) => void;
  onConfirmedPreTransitionFailure?: (input: {
    intent: AiGraderLocalBackCaptureIntent;
    previewStatus: AiGraderLocalStationPreviewStatus;
  }) => void | Promise<void>;
}, fetchImpl: typeof fetch = fetch): Promise<AiGraderLocalStationStatus> {
  const intent: AiGraderLocalBackCaptureIntent = {
    binding: {
      sessionId: input.assertion.expectedSessionId,
      side: "back",
      sideEpoch: input.assertion.expectedSideEpoch,
    },
    frameId: input.assertion.expectedFrameId,
  };
  input.onIntent(intent);
  let capturePostResponseReceived = false;
  const captureFetch: typeof fetch = async (request, init) => {
    const response = await fetchImpl(request, init);
    capturePostResponseReceived = true;
    return response;
  };
  try {
    return await runAiGraderAtomicBackCapture(input, captureFetch);
  } catch (captureError) {
    let previewStatus: AiGraderLocalStationPreviewStatus;
    try {
      previewStatus = await fetchAiGraderStationPreviewStatus({
        baseUrl: input.baseUrl,
        stationToken: input.stationToken,
      }, fetchImpl);
    } catch {
      throw captureError;
    }
    if (confirmsAiGraderBackCapturePreTransitionFailure({
      intent,
      previewStatus,
      capturePostResponseReceived,
    })) {
      await input.onConfirmedPreTransitionFailure?.({ intent, previewStatus });
    }
    throw captureError;
  }
}

export async function runAiGraderBackPositioningRetryRecovery(input: {
  baseUrl: string;
  stationToken: string;
  expectedBinding: AiGraderPreviewEpochBinding & { side: "back" };
  getCurrentBinding: () => AiGraderPreviewEpochBinding | undefined;
  restartPreview: (binding: AiGraderPreviewEpochBinding & { side: "back" }) => Promise<void>;
}, fetchImpl: typeof fetch = fetch): Promise<AiGraderBackPositioningRetryResult> {
  const expectedBinding = {
    sessionId: assertionId(input.expectedBinding.sessionId, "expected session ID"),
    side: "back" as const,
    sideEpoch: assertionId(input.expectedBinding.sideEpoch, "expected side epoch"),
  };
  if (!aiGraderPreviewBindingMatches(input.getCurrentBinding(), expectedBinding)) {
    throw new Error("AI Grader positioning-light retry is obsolete for the current preview binding.");
  }
  await input.restartPreview(expectedBinding);
  if (!aiGraderPreviewBindingMatches(input.getCurrentBinding(), expectedBinding)) {
    throw new Error("AI Grader positioning-light retry became obsolete before the bounded restore request.");
  }
  const result = await retryAiGraderBackPositioningLight({
    baseUrl: input.baseUrl,
    stationToken: input.stationToken,
    expectedSessionId: expectedBinding.sessionId,
    expectedSide: "back",
    expectedSideEpoch: expectedBinding.sideEpoch,
  }, fetchImpl);
  if (!aiGraderPreviewBindingMatches(input.getCurrentBinding(), expectedBinding)) {
    throw new Error("AI Grader positioning-light retry became obsolete while the bounded restore request was in flight.");
  }
  if (result.sessionId !== expectedBinding.sessionId || result.sideEpoch !== expectedBinding.sideEpoch) {
    throw new Error("AI Grader positioning-light retry returned an obsolete preview binding.");
  }
  return result;
}

export function aiGraderBackCaptureAssertionFromFrame(input: {
  frame: AiGraderPreviewFrameBinding;
  reportId: string;
  geometryCaptureMode: AiGraderBackCaptureMode;
  captureTriggerMode: AiGraderCaptureTriggerMode;
}): AiGraderBackCaptureAssertion {
  if (input.frame.side !== "back") {
    throw new Error("AI Grader atomic back capture requires a displayed back preview snapshot.");
  }
  return {
    expectedSessionId: input.frame.sessionId,
    expectedReportId: input.reportId,
    expectedSide: "back",
    expectedSideEpoch: input.frame.sideEpoch,
    expectedFrameId: input.frame.frameId,
    geometryCaptureMode: input.geometryCaptureMode,
    captureTriggerMode: input.captureTriggerMode,
  };
}
