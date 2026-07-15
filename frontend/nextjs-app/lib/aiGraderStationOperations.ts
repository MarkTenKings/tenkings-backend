import type {
  AiGraderCaptureTriggerMode,
  AiGraderLocalStationStatus,
  AiGraderLocalStationPreviewStatus,
} from "./aiGraderLocalStation";
import { AI_GRADER_FRONT_WORKFLOW_AUTHORITY_SCHEMA_VERSION } from "./aiGraderLocalStation";
import {
  callAiGraderStationBridge,
  fetchAiGraderStationPreviewStatus,
  retryAiGraderBackPositioningLight,
  type AiGraderBackPositioningRetryResult,
  type AiGraderFrontWorkflowAssertionRequest,
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

function candidateProfileIdentity(value: string | undefined) {
  if (!value || !/^candidate-[a-f0-9]{32}$/.test(value)) {
    throw new Error('AI Grader current candidate profile revision is missing or unsafe.');
  }
  return value;
}

function secureWorkflowAttemptNonce() {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi) {
    throw new Error('Secure randomness is unavailable for the Front workflow request.');
  }
  if (typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID().replace(/-/g, '');
  }
  if (typeof cryptoApi.getRandomValues !== 'function') {
    throw new Error('Secure randomness is unavailable for the Front workflow request.');
  }
  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
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

export type AiGraderFrontWorkflowOperation = 'accept-live-profile' | 'confirm-fixture-rulers';
export type AiGraderFrontWorkflowAssertion = {
  expectedSessionId: string;
  expectedReportId: string;
  expectedSide: 'front';
  expectedSideEpoch: string;
  expectedCandidateProfileIdentity?: string;
};
export type AiGraderFrontWorkflowAttempt = {
  operation: AiGraderFrontWorkflowOperation;
  signature: string;
  idempotencyKey: string;
};
export type AiGraderFrontWorkflowOperationGate = {
  run<T>(signature: string, operation: () => Promise<T>): Promise<T>;
  activeSignature(): string | undefined;
};

export function aiGraderFrontWorkflowAssertionFromStatus(
  status: AiGraderLocalStationStatus,
): AiGraderFrontWorkflowAssertion {
  const sessionId = assertionId(status.sessionManifest.gradingSessionId, 'expected session ID');
  const reportId = assertionId(status.sessionManifest.reportId, 'expected report ID');
  const preview = status.previewStatus;
  if (preview.sessionId !== sessionId || preview.activeSide !== 'front' || !preview.sideEpoch) {
    throw new Error('The bridge has no current Front preview binding for this session.');
  }
  return {
    expectedSessionId: sessionId,
    expectedReportId: reportId,
    expectedSide: 'front',
    expectedSideEpoch: assertionId(preview.sideEpoch, 'expected side epoch'),
    ...(/^candidate-[a-f0-9]{32}$/.test(status.liveLighting.profile.candidateProfileIdentity ?? '')
      ? { expectedCandidateProfileIdentity: status.liveLighting.profile.candidateProfileIdentity }
      : {}),
  };
}

export function aiGraderFrontWorkflowAttemptSignature(
  operation: AiGraderFrontWorkflowOperation,
  assertion: AiGraderFrontWorkflowAssertion,
) {
  return [
    operation,
    assertionId(assertion.expectedSessionId, 'expected session ID'),
    assertionId(assertion.expectedReportId, 'expected report ID'),
    assertion.expectedSide,
    assertionId(assertion.expectedSideEpoch, 'expected side epoch'),
    ...(operation === 'accept-live-profile'
      ? [candidateProfileIdentity(assertion.expectedCandidateProfileIdentity)]
      : []),
  ].join('|');
}

export function createAiGraderFrontWorkflowAttempt(
  operation: AiGraderFrontWorkflowOperation,
  assertion: AiGraderFrontWorkflowAssertion,
): AiGraderFrontWorkflowAttempt {
  const signature = aiGraderFrontWorkflowAttemptSignature(operation, assertion);
  return {
    operation,
    signature,
    idempotencyKey: `front-workflow-${operation}-v1-${secureWorkflowAttemptNonce()}`,
  };
}

export function buildAiGraderFrontWorkflowRequest(input: {
  assertion: AiGraderFrontWorkflowAssertion;
  attempt: AiGraderFrontWorkflowAttempt;
}): AiGraderFrontWorkflowAssertionRequest {
  const signature = aiGraderFrontWorkflowAttemptSignature(input.attempt.operation, input.assertion);
  if (input.attempt.signature !== signature) {
    throw new Error('The Front workflow attempt does not match the current bridge session and preview epoch.');
  }
  return {
    idempotencyKey: assertionId(input.attempt.idempotencyKey, 'Front workflow idempotency key'),
    expectedSessionId: assertionId(input.assertion.expectedSessionId, 'expected session ID'),
    expectedReportId: assertionId(input.assertion.expectedReportId, 'expected report ID'),
    expectedSide: 'front',
    expectedSideEpoch: assertionId(input.assertion.expectedSideEpoch, 'expected side epoch'),
    ...(input.attempt.operation === 'accept-live-profile'
      ? { expectedCandidateProfileIdentity: candidateProfileIdentity(input.assertion.expectedCandidateProfileIdentity) }
      : {}),
  };
}

export function createAiGraderFrontWorkflowOperationGate(): AiGraderFrontWorkflowOperationGate {
  let active: { signature: string; promise: Promise<unknown> } | undefined;
  return {
    run<T>(signature: string, operation: () => Promise<T>): Promise<T> {
      if (!signature || signature.length > 1024 || /[\r\n]/.test(signature) ||
        /token|secret|bearer|presign|x-amz|localhost/i.test(signature)) {
        return Promise.reject(new Error('The Front workflow operation signature is missing or unsafe.'));
      }
      if (active) {
        return active.signature === signature
          ? active.promise as Promise<T>
          : Promise.reject(new Error('A different Front workflow operation is already active.'));
      }
      const promise = Promise.resolve().then(operation);
      active = { signature, promise };
      void promise.finally(() => {
        if (active?.promise === promise) active = undefined;
      }).catch(() => {});
      return promise;
    },
    activeSignature: () => active?.signature,
  };
}

export type AiGraderFrontStartReadinessCode =
  | AiGraderLocalStationStatus['frontCaptureReadiness']['code']
  | 'bridge_disconnected'
  | 'local_operation_pending'
  | 'preview_binding_stale';

export type AiGraderFrontStartReadiness = {
  ready: boolean;
  code: AiGraderFrontStartReadinessCode;
  message: string;
};

export function preserveAiGraderPrimaryWorkflowError(current: string | null, next: unknown): string {
  if (current?.trim()) return current;
  const message = next instanceof Error ? next.message : typeof next === 'string' ? next : '';
  return message.trim() || 'The AI Grader workflow request failed.';
}

function frontBindingMatches(
  value: { sessionId: string; reportId: string; side: string; sideEpoch: string } | undefined,
  expected: { sessionId: string; reportId: string; side: 'front'; sideEpoch: string },
) {
  return Boolean(value && value.sessionId === expected.sessionId &&
    value.reportId === expected.reportId &&
    value.side === expected.side && value.sideEpoch === expected.sideEpoch);
}

function frontPositioningLightingAcknowledged(status: AiGraderLocalStationStatus) {
  const lighting = status.liveLighting;
  const acceptedAuthority = status.frontWorkflowAuthority.acceptedProfile;
  const applied = lighting.applied;
  const physical = lighting.physicalState;
  const expected = applied.expectedWriteCount;
  const responseKinds = applied.lastResponseKinds ?? [];
  const canonicalTimestamp = (value: string | undefined) => Boolean(
    value && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
  );
  return Boolean(acceptedAuthority) && lighting.status === 'on' && lighting.profile.enabled === true &&
    lighting.profile.acceptedForCapture === true &&
    lighting.profile.acceptedAt === acceptedAuthority?.acceptedAt &&
    lighting.profile.dutyPercent > 0 && lighting.profile.channels.length > 0 &&
    applied.enabled === true && applied.dutyPercent === lighting.profile.dutyPercent &&
    applied.actualLeimacPwmStep === lighting.profile.actualLeimacPwmStep &&
    applied.channels.join(',') === lighting.profile.channels.join(',') &&
    Number.isInteger(expected) && expected > 0 && applied.acknowledgedWriteCount === expected &&
    physical.expectedWriteCount === expected && physical.acknowledgedWriteCount === expected &&
    responseKinds.length === expected && responseKinds.every((kind) => kind === 'ack' || kind === 'mock') &&
    applied.verificationState === 'verified' && applied.verificationComplete === true &&
    physical.state === 'positioning_light_verified' && physical.complete === true &&
    canonicalTimestamp(applied.verifiedAt) && canonicalTimestamp(physical.verifiedAt) &&
    applied.verifiedAt === physical.verifiedAt && physical.lastError === undefined && lighting.lastError === undefined &&
    (lighting.connection.state === 'idle' || lighting.connection.state === 'mock');
}

export function deriveAiGraderFrontStartReadiness(input: {
  status: AiGraderLocalStationStatus;
  previewBinding?: AiGraderPreviewEpochBinding;
  bridgeConnected: boolean;
  safetyFailure?: string | null;
  transitionPending?: boolean;
  capturePending?: boolean;
  cleanupPending?: boolean;
  ambiguousRequestPending?: boolean;
}): AiGraderFrontStartReadiness {
  const unavailable = (code: AiGraderFrontStartReadinessCode, message: string): AiGraderFrontStartReadiness => ({
    ready: false,
    code,
    message,
  });
  if (!input.bridgeConnected) {
    return unavailable('bridge_disconnected', 'Connect and pair the authoritative Dell bridge before Front capture.');
  }
  if (input.safetyFailure?.trim()) {
    return unavailable('safety_state_unverified', `Hardware safety interlock: ${input.safetyFailure.trim()}`);
  }
  if (input.transitionPending || input.capturePending || input.cleanupPending || input.ambiguousRequestPending) {
    return unavailable('local_operation_pending', 'Wait for the current workflow, capture, cleanup, or recovery request to finish.');
  }
  const status = input.status;
  if (status.frontWorkflowAuthority.schemaVersion !== AI_GRADER_FRONT_WORKFLOW_AUTHORITY_SCHEMA_VERSION) {
    return unavailable('front_binding_stale', 'The bridge Front workflow authority schema is missing or stale.');
  }
  if (status.captureFailure || status.sessionManifest.frontCaptured || status.sessionManifest.backCaptured ||
    status.rapidCaptureQueue.activeQueueItemId) {
    return unavailable('capture_blocked', 'Front capture is blocked by the authoritative session state.');
  }
  if (status.warmRunnerStatus.captureLock.held || status.warmRunnerStatus.status === 'capturing' ||
    status.previewStatus.intentionalTransition.active) {
    return unavailable('lifecycle_pending', 'Wait for the authoritative capture lifecycle to become idle.');
  }
  if (!status.frontCaptureReadiness.ready || status.frontCaptureReadiness.code !== 'ready') {
    return unavailable(status.frontCaptureReadiness.code, status.frontCaptureReadiness.message);
  }
  if (!frontPositioningLightingAcknowledged(status)) {
    return unavailable('safety_state_unverified', 'Controller-acknowledged lighting safety state is required before Front capture.');
  }
  if (status.currentStep !== 'capture_front') {
    return unavailable('current_step_not_capture_front', 'Complete the required Front workflow confirmations before capture.');
  }
  if (status.previewStatus.status !== 'live' || status.previewStatus.cameraOwnership !== 'preview_stream') {
    return unavailable('live_preview_required', 'Wait for the bridge-authoritative Front preview to become live.');
  }
  const expected = status.frontCaptureReadiness.binding;
  if (!expected || expected.side !== 'front' ||
    expected.sessionId !== status.sessionManifest.gradingSessionId ||
    expected.reportId !== status.sessionManifest.reportId) {
    return unavailable('front_binding_stale', 'The authoritative Front readiness binding is stale for this session or report.');
  }
  const previewStatusBinding = status.previewStatus.sessionId && status.previewStatus.activeSide && status.previewStatus.sideEpoch
    ? { sessionId: status.previewStatus.sessionId, reportId: expected.reportId, side: status.previewStatus.activeSide, sideEpoch: status.previewStatus.sideEpoch }
    : undefined;
  const localPreviewBinding = input.previewBinding
    ? { ...input.previewBinding, reportId: expected.reportId }
    : undefined;
  if (!frontBindingMatches(previewStatusBinding, expected) || !frontBindingMatches(localPreviewBinding, expected)) {
    return unavailable('preview_binding_stale', 'Wait for the current Front preview session and epoch to refresh.');
  }
  const authority = status.frontWorkflowAuthority;
  const accepted = authority.acceptedProfile;
  const transition = authority.transition;
  if (!frontBindingMatches(authority.lightIdleOff, expected)) {
    return unavailable('light_idle_off_required', 'Controller-acknowledged initial light idle-off evidence is required.');
  }
  if (!frontBindingMatches(authority.fixtureRulers, expected)) {
    return unavailable('fixture_rulers_required', 'Confirm the fixture and both rulers for this Front session and epoch.');
  }
  if (!frontBindingMatches(accepted, expected) || !accepted?.profileDigestSha256 || !accepted.profileIdentity) {
    return unavailable('accepted_profile_required', 'Accept the bridge-held live lighting profile for this Front session and epoch.');
  }
  if (!frontBindingMatches(transition, expected) || transition?.profileIdentity !== accepted.profileIdentity ||
    status.frontCaptureReadiness.profileIdentity !== accepted.profileIdentity) {
    return unavailable('workflow_transition_required', 'Wait for the bridge to complete the authoritative Front workflow transition.');
  }
  return { ready: true, code: 'ready', message: status.frontCaptureReadiness.message };
}

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
