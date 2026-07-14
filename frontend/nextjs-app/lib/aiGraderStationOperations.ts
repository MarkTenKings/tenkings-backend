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
  aiGraderLocalCaptureIntentMatches,
  aiGraderPreviewBindingMatches,
  aiGraderPreviewStatusBinding,
  isAiGraderConfirmedCaptureTransitionFailure,
  type AiGraderLocalCaptureIntent,
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

export type AiGraderCaptureSide = "front" | "back";
export type AiGraderBackCaptureMode = "detected_geometry" | "manual_capture";
export type AiGraderCaptureMode = AiGraderBackCaptureMode;

export type AiGraderCaptureAssertion<Side extends AiGraderCaptureSide = AiGraderCaptureSide> = {
  expectedSessionId: string;
  expectedReportId: string;
  expectedSide: Side;
  expectedSideEpoch: string;
  expectedFrameId: string;
  geometryCaptureMode: AiGraderCaptureMode;
  captureTriggerMode: AiGraderCaptureTriggerMode;
};
export type AiGraderBackCaptureAssertion = AiGraderCaptureAssertion<"back">;
export type AiGraderFrontCaptureAssertion = AiGraderCaptureAssertion<"front">;

export type AiGraderCaptureAttempt = {
  signature: string;
  idempotencyKey: string;
  captureTriggerAt: string;
};
export type AiGraderBackCaptureAttempt = AiGraderCaptureAttempt;
export type AiGraderFrontCaptureAttempt = AiGraderCaptureAttempt;

export type AiGraderCaptureOperationGate = {
  run<T>(signature: string, operation: () => Promise<T>): Promise<T>;
  activeSignature(): string | undefined;
};

export function createAiGraderCaptureOperationGate(): AiGraderCaptureOperationGate {
  let active: { signature: string; promise: Promise<unknown> } | undefined;
  return {
    run<T>(signature: string, operation: () => Promise<T>): Promise<T> {
      const boundedSignature = signature.trim();
      if (
        !boundedSignature ||
        boundedSignature.length > 1024 ||
        /[\r\n]/.test(boundedSignature) ||
        /token|secret|bearer|presign|x-amz|localhost/i.test(boundedSignature)
      ) {
        return Promise.reject(new Error("AI Grader capture operation signature is missing or unsafe."));
      }
      if (active) {
        if (active.signature !== boundedSignature) {
          return Promise.reject(new Error("A different AI Grader capture operation is already active."));
        }
        return active.promise as Promise<T>;
      }
      const promise = Promise.resolve().then(operation);
      active = { signature: boundedSignature, promise };
      void promise.then(
        () => {
          if (active?.promise === promise) active = undefined;
        },
        () => {
          if (active?.promise === promise) active = undefined;
        },
      );
      return promise;
    },
    activeSignature() {
      return active?.signature;
    },
  };
}

export function aiGraderCaptureAttemptSignature(input: AiGraderCaptureAssertion) {
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

export function createAiGraderCaptureAttempt(
  input: AiGraderCaptureAssertion,
  captureTriggerAt = new Date().toISOString(),
): AiGraderCaptureAttempt {
  const signature = aiGraderCaptureAttemptSignature(input);
  const timestampMs = Date.parse(captureTriggerAt);
  if (!Number.isFinite(timestampMs)) {
    throw new Error("AI Grader capture trigger timestamp is invalid.");
  }
  return {
    signature,
    idempotencyKey:
      `capture-${input.expectedSide}-v0.9-` +
      hash32(signature, 0x811c9dc5) +
      hash32(signature, 0x9e3779b9),
    captureTriggerAt: new Date(timestampMs).toISOString(),
  };
}

export function buildAiGraderAtomicCaptureRequest(input: {
  assertion: AiGraderCaptureAssertion;
  attempt: AiGraderCaptureAttempt;
}): AiGraderStationBridgeActionRequestBody {
  const signature = aiGraderCaptureAttemptSignature(input.assertion);
  if (input.attempt.signature !== signature) {
    throw new Error(`AI Grader ${input.assertion.expectedSide}-capture attempt does not match the displayed preview snapshot.`);
  }
  const idempotencyKey = assertionId(input.attempt.idempotencyKey, `${input.assertion.expectedSide}-capture idempotency key`);
  const captureTriggerAtMs = Date.parse(input.attempt.captureTriggerAt);
  if (!Number.isFinite(captureTriggerAtMs)) {
    throw new Error("AI Grader capture trigger timestamp is invalid.");
  }
  return {
    idempotencyKey,
    expectedSessionId: assertionId(input.assertion.expectedSessionId, "expected session ID"),
    expectedReportId: assertionId(input.assertion.expectedReportId, "expected report ID"),
    expectedSide: input.assertion.expectedSide,
    expectedSideEpoch: assertionId(input.assertion.expectedSideEpoch, "expected side epoch"),
    expectedFrameId: assertionId(input.assertion.expectedFrameId, "expected frame ID"),
    geometryCaptureMode: input.assertion.geometryCaptureMode,
    captureTriggerMode: input.assertion.captureTriggerMode,
    captureTriggerAt: new Date(captureTriggerAtMs).toISOString(),
  };
}

export async function runAiGraderAtomicCapture(input: {
  baseUrl: string;
  stationToken: string;
  assertion: AiGraderCaptureAssertion;
  attempt: AiGraderCaptureAttempt;
}, fetchImpl: typeof fetch = fetch): Promise<AiGraderLocalStationStatus> {
  return callAiGraderStationBridge({
    baseUrl: input.baseUrl,
    stationToken: input.stationToken,
    action: input.assertion.expectedSide === "front" ? "capture-front" : "capture-back",
    body: buildAiGraderAtomicCaptureRequest(input),
  }, fetchImpl);
}

function confirmsAiGraderCapturePreTransitionFailure(input: {
  intent: AiGraderLocalCaptureIntent;
  previewStatus: AiGraderLocalStationPreviewStatus;
  capturePostResponseReceived: boolean;
}) {
  const authoritativeBinding = aiGraderPreviewStatusBinding(input.previewStatus);
  if (
    !authoritativeBinding ||
    !aiGraderPreviewBindingMatches(authoritativeBinding, input.intent.binding) ||
    !aiGraderLocalCaptureIntentMatches({
      expectedBinding: authoritativeBinding,
      localIntent: input.intent,
    }) ||
    input.previewStatus.intentionalTransition.active ||
    input.previewStatus.intentionalTransition.outcome === "capture_started" ||
    input.previewStatus.cameraOwnership === "capture_action"
  ) return false;
  if (isAiGraderConfirmedCaptureTransitionFailure({
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

export async function runAiGraderStationCaptureOrchestration<Side extends AiGraderCaptureSide>(input: {
  baseUrl: string;
  stationToken: string;
  assertion: AiGraderCaptureAssertion<Side>;
  attempt: AiGraderCaptureAttempt;
  onIntent: (intent: AiGraderLocalCaptureIntent<Side>) => void;
  onConfirmedPreTransitionFailure?: (input: {
    intent: AiGraderLocalCaptureIntent<Side>;
    previewStatus: AiGraderLocalStationPreviewStatus;
  }) => void | Promise<void>;
}, fetchImpl: typeof fetch = fetch): Promise<AiGraderLocalStationStatus> {
  const intent: AiGraderLocalCaptureIntent<Side> = {
    binding: {
      sessionId: input.assertion.expectedSessionId,
      side: input.assertion.expectedSide,
      sideEpoch: input.assertion.expectedSideEpoch,
    },
    frameId: input.assertion.expectedFrameId,
    submittedAtMs: Date.now(),
  };
  input.onIntent(intent);
  let capturePostResponseReceived = false;
  const captureFetch: typeof fetch = async (request, init) => {
    const response = await fetchImpl(request, init);
    capturePostResponseReceived = true;
    return response;
  };
  try {
    return await runAiGraderAtomicCapture(input, captureFetch);
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
    if (confirmsAiGraderCapturePreTransitionFailure({
      intent,
      previewStatus,
      capturePostResponseReceived,
    })) {
      await input.onConfirmedPreTransitionFailure?.({ intent, previewStatus });
    }
    throw captureError;
  }
}

export const aiGraderBackCaptureAttemptSignature = (input: AiGraderBackCaptureAssertion) =>
  aiGraderCaptureAttemptSignature(input);

export const createAiGraderBackCaptureAttempt = (
  input: AiGraderBackCaptureAssertion,
  captureTriggerAt = new Date().toISOString(),
) => createAiGraderCaptureAttempt(input, captureTriggerAt);

export const buildAiGraderAtomicBackCaptureRequest = (input: {
  assertion: AiGraderBackCaptureAssertion;
  attempt: AiGraderBackCaptureAttempt;
}) => buildAiGraderAtomicCaptureRequest(input);

export const runAiGraderAtomicBackCapture = (input: {
  baseUrl: string;
  stationToken: string;
  assertion: AiGraderBackCaptureAssertion;
  attempt: AiGraderBackCaptureAttempt;
}, fetchImpl: typeof fetch = fetch) => runAiGraderAtomicCapture(input, fetchImpl);

export const runAiGraderStationBackCaptureOrchestration = (input: {
  baseUrl: string;
  stationToken: string;
  assertion: AiGraderBackCaptureAssertion;
  attempt: AiGraderBackCaptureAttempt;
  onIntent: (intent: AiGraderLocalCaptureIntent<"back">) => void;
  onConfirmedPreTransitionFailure?: (input: {
    intent: AiGraderLocalCaptureIntent<"back">;
    previewStatus: AiGraderLocalStationPreviewStatus;
  }) => void | Promise<void>;
}, fetchImpl: typeof fetch = fetch) => runAiGraderStationCaptureOrchestration(input, fetchImpl);

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
    geometryCaptureMode: input.geometryCaptureMode,
    captureTriggerMode: input.captureTriggerMode,
  };
}

export function aiGraderFrontCaptureAssertionFromFrame(input: {
  frame: AiGraderPreviewFrameBinding;
  reportId: string;
  geometryCaptureMode: AiGraderCaptureMode;
  captureTriggerMode: AiGraderCaptureTriggerMode;
}): AiGraderFrontCaptureAssertion {
  if (input.frame.side !== "front") {
    throw new Error("AI Grader atomic front capture requires a displayed front preview snapshot.");
  }
  return aiGraderCaptureAssertionFromFrame({ ...input, frame: { ...input.frame, side: "front" } });
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
  return aiGraderCaptureAssertionFromFrame({ ...input, frame: { ...input.frame, side: "back" } });
}
