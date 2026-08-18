import type { SpeedsterCardSide } from "./contracts";
import type { SpeedsterMapScope } from "./card-type-map-contracts";

export const SPEEDSTER_MAP_AUTHORITY_EVIDENCE_VERSION = "speedster-map-authority-evidence-v1" as const;
export const SPEEDSTER_MAP_AUTHORITY_HISTORY_LIMIT = 64;

export type SpeedsterMapAuthorityFailure = Readonly<{
  side: SpeedsterCardSide;
  source:
    | "PROVIDER_GATEWAY"
    | "PROVIDER"
    | "PROVIDER_NETWORK"
    | "TEN_KINGS_API"
    | "CLIENT_NETWORK"
    | "CLIENT_PROTOCOL"
    | "HUMAN_CORRECTION";
  code: string;
  httpStatus: number | null;
  requestId?: string;
}>;

type SpeedsterMapAuthorityRevision = Readonly<{
  revisionId: string;
  revisionHash: string;
  version: number;
  scope: SpeedsterMapScope;
  name: string;
}>;

export type SpeedsterMapAuthorityEvent = Readonly<{
  attemptId: string;
  recordedAt: string;
  status: "LOADED" | "NO_MAP" | "LOOKUP_FAILED" | "INTEGRITY_ERROR" | "REGISTRATION_BLOCKED" | "APPLIED";
  failureCode: string | null;
  message: string;
  revision: SpeedsterMapAuthorityRevision | null;
  registrationOperationId: string | null;
  registrationFailures: readonly SpeedsterMapAuthorityFailure[];
}>;

export type SpeedsterMapAuthorityEvidence = Readonly<{
  version: typeof SPEEDSTER_MAP_AUTHORITY_EVIDENCE_VERSION;
  current: SpeedsterMapAuthorityEvent;
  history: readonly SpeedsterMapAuthorityEvent[];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function speedsterMapAuthorityEvidenceFromCapture(capture: unknown): SpeedsterMapAuthorityEvidence | null {
  if (!isRecord(capture) || !isRecord(capture.mapAuthority)) return null;
  const evidence = capture.mapAuthority;
  if (evidence.version !== SPEEDSTER_MAP_AUTHORITY_EVIDENCE_VERSION
    || !isRecord(evidence.current)
    || !Array.isArray(evidence.history)) return null;
  return evidence as SpeedsterMapAuthorityEvidence;
}

export function appendSpeedsterMapAuthorityEvidence(
  capture: unknown,
  event: SpeedsterMapAuthorityEvent,
): Record<string, unknown> {
  const source = isRecord(capture) ? capture : {};
  const prior = speedsterMapAuthorityEvidenceFromCapture(source);
  const history = [...(prior?.history ?? []), event].slice(-SPEEDSTER_MAP_AUTHORITY_HISTORY_LIMIT);
  return {
    ...source,
    mapAuthority: {
      version: SPEEDSTER_MAP_AUTHORITY_EVIDENCE_VERSION,
      current: event,
      history,
    } satisfies SpeedsterMapAuthorityEvidence,
  };
}
