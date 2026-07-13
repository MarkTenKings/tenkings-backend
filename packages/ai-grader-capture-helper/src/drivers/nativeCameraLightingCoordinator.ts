import type { NativeCameraForensicRole, NativeCameraSide } from "./nativeCameraProtocol";

export interface NativeCameraLightingContext {
  sessionId: string;
  captureRequestId: string;
  side: Exclude<NativeCameraSide, "none">;
  sideEpoch: number;
  role: NativeCameraForensicRole;
}

export interface NativeCameraLightingProfileRequest extends NativeCameraLightingContext {
  requestedAtUnixMs: number;
}

export interface NativeCameraLightingProfileReceipt {
  profileRequestId: string;
  accepted: true;
}

export interface NativeCameraStableLightAcknowledgement {
  stable: true;
  acknowledgementId: string;
  stableAtUnixMs: number;
  acknowledgementDurationMs: number;
}

export interface NativeCameraOneGrabAuthorization {
  authorized: true;
  authorizationId: string;
  authorizedAtUnixMs: number;
  expiresAtUnixMs: number;
}

export interface NativeCameraLightingCompletion extends NativeCameraLightingContext {
  authorizationId: string;
  frameId: string;
  completedAtUnixMs: number;
}

export type NativeCameraSafeOffReason =
  | "capture_complete"
  | "capture_failure"
  | "worker_exit"
  | "worker_timeout"
  | "malformed_protocol"
  | "invalid_epoch"
  | "invalid_order"
  | "safe_idle"
  | "client_shutdown";

export interface NativeCameraLightingSafeOffResult {
  safe: true;
  completedAtUnixMs: number;
}

/**
 * Lighting stays outside the native worker. Every grab requires an explicit,
 * expiring authorization derived from a positive stable-light acknowledgement.
 */
export interface NativeCameraLightingCoordinator {
  requestEvidenceRoleProfile(request: NativeCameraLightingProfileRequest): Promise<NativeCameraLightingProfileReceipt>;
  waitForStableLight(
    context: NativeCameraLightingContext,
    receipt: NativeCameraLightingProfileReceipt,
  ): Promise<NativeCameraStableLightAcknowledgement>;
  authorizeOneGrab(
    context: NativeCameraLightingContext,
    stable: NativeCameraStableLightAcknowledgement,
  ): Promise<NativeCameraOneGrabAuthorization>;
  completeEvidenceRole(completion: NativeCameraLightingCompletion): Promise<void>;
  safeOff(reason: NativeCameraSafeOffReason): Promise<NativeCameraLightingSafeOffResult>;
}

export class NativeCameraLightingCoordinationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NativeCameraLightingCoordinationError";
  }
}

export function assertStableLightingAuthorization(
  stable: NativeCameraStableLightAcknowledgement,
  authorization: NativeCameraOneGrabAuthorization,
  nowUnixMs: number,
): void {
  if (!stable || stable.stable !== true || !stable.acknowledgementId) {
    throw new NativeCameraLightingCoordinationError("Lighting did not return a positive stable acknowledgement.");
  }
  if (!authorization || authorization.authorized !== true || !authorization.authorizationId) {
    throw new NativeCameraLightingCoordinationError("Lighting did not authorize a grab.");
  }
  if (!Number.isSafeInteger(authorization.expiresAtUnixMs) || authorization.expiresAtUnixMs <= nowUnixMs) {
    throw new NativeCameraLightingCoordinationError("The one-grab lighting authorization is already expired.");
  }
}

/** Fail-closed default used until a bridge explicitly injects lighting. */
export function createRejectingNativeCameraLightingCoordinator(): NativeCameraLightingCoordinator {
  const reject = async (): Promise<never> => {
    throw new NativeCameraLightingCoordinationError("Native camera lighting coordination is not configured.");
  };
  return {
    requestEvidenceRoleProfile: reject,
    waitForStableLight: reject,
    authorizeOneGrab: reject,
    completeEvidenceRole: reject,
    safeOff: reject,
  };
}
