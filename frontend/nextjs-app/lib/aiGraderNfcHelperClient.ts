export const AI_GRADER_NFC_HELPER_BASE_URL = "http://127.0.0.1:47662";
export const AI_GRADER_NFC_HELPER_TOKEN_STORAGE_KEY = "tenkings.aiGrader.nfc.workstationToken.v1";
export const AI_GRADER_NFC_HELPER_PROTOCOL_VERSION = "tenkings-ai-grader-nfc-loopback-v2";
export const AI_GRADER_NFC_INIT_IDEMPOTENCY_STORAGE_PREFIX = "tenkings.aiGrader.nfc.initIdempotency.v1:";
export const AI_GRADER_NFC_PROFILE_STORAGE_KEY = "tenkings.aiGrader.nfc.profile.v1";

const REQUEST_TIMEOUT_MS = 15_000;
const WRITE_TIMEOUT_MS = 45_000;

type JsonRecord = Record<string, unknown>;

export type AiGraderNfcHelperStatus = {
  helperProtocolVersion: string;
  readerConnected: boolean;
  pcscReady: boolean;
  tagState: "present" | "absent" | "multiple" | "unsupported" | "unknown";
  busy: boolean;
  readerModel?: string | null;
  capability?: {
    chipType: "NTAG215";
    securityMode: "static_url_v1";
    readSupported: boolean;
    writeSupported: boolean;
    multipleTagDetectionSupported: boolean;
    tagSelectionEvidence: string;
  } | null;
  errorCode?: string | null;
  supportedProfiles?: Array<{
    chipType: "NTAG215" | "FEIJU_F8215" | "NTAG424_DNA";
    securityMode: "static_url_v1" | "ntag424_sun_v1";
    programmingProfile: "ntag215_direct_pcsc_v1" | "gototags_manual_start_v1" | "ntag424_dna_unimplemented";
    adapterIdentity: string;
    implemented: boolean;
    permanentlyLocksTag: boolean;
  }> | null;
  goToTagsReady?: boolean;
  goToTagsErrorCode?: string | null;
};

export type AiGraderNfcHelperWriteResult = {
  normalizedUrl?: string;
  uidFingerprintSha256?: string;
  readbackPayloadSha256?: string;
  chipType?: "NTAG215" | "FEIJU_F8215";
  readerResultCode?: string;
  helperProtocolVersion?: string;
  overwriteRequired?: boolean;
  observedPayloadSha256?: string | null;
  existingContentKind?: "blank" | "same" | "different" | "unsupported";
  operationalAttestation?: {
    schemaVersion: "ai-grader-nfc-helper-attestation-v1" | "ai-grader-nfc-helper-attestation-v2";
    workstationKeyId: string;
    algorithm: "ecdsa-p256-sha256-p1363";
    attestationChallenge: string;
    observedAt: string;
    signature: string;
  } | null;
};

export type AiGraderF8215CompletionEvidence = {
  helperProtocolVersion: string;
  chipType: "FEIJU_F8215";
  securityMode: "static_url_v1";
  programmingProfile: "gototags_manual_start_v1";
  adapterIdentity: "gototags_desktop";
  adapterVersion: "4.37.0.1";
  normalizedUrl: string;
  uidFingerprintSha256: string;
  readbackPayloadSha256: string;
  writeProtectionState: "permanently_read_only_verified";
  readerResultCode: "write_locked_verified_gototags_readback";
  operationalAttestation: NonNullable<AiGraderNfcHelperWriteResult["operationalAttestation"]>;
};

export type AiGraderF8215OperationStatus = {
  helperProtocolVersion: string;
  attemptId: string;
  chipType: "FEIJU_F8215";
  programmingProfile: "gototags_manual_start_v1";
  phase: "awaiting_manual_start" | "completed" | "failed" | "uncertain";
  terminal: boolean;
  retryable: boolean;
  errorCode?: string | null;
  evidence?: AiGraderF8215CompletionEvidence | null;
};

export type AiGraderF8215PrepareResult = Pick<
  AiGraderF8215OperationStatus,
  "helperProtocolVersion" | "attemptId" | "chipType" | "programmingProfile" | "phase"
>;

export class AiGraderNfcHelperError extends Error {
  readonly code: string;
  readonly status: number;
  readonly result?: JsonRecord;
  readonly retryable: boolean;

  constructor(code: string, message: string, status: number, result?: JsonRecord, retryable = false) {
    super(message);
    this.name = "AiGraderNfcHelperError";
    this.code = code;
    this.status = status;
    this.result = result;
    this.retryable = retryable;
  }
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function workstationToken() {
  if (typeof window === "undefined") return "";
  const token = window.localStorage.getItem(AI_GRADER_NFC_HELPER_TOKEN_STORAGE_KEY)?.trim() ?? "";
  return /^[A-Za-z0-9_-]{32,160}$/.test(token) ? token : "";
}

export function hasAiGraderNfcHelperPairing() {
  return Boolean(workstationToken());
}

export function clearAiGraderNfcHelperPairing() {
  if (typeof window !== "undefined") window.localStorage.removeItem(AI_GRADER_NFC_HELPER_TOKEN_STORAGE_KEY);
}

async function helperRequest<T>(
  path: "/pair" | "/status" | "/read" | "/write" | "/prepare" | "/operation-status" | "/operation-ack",
  input: { method?: "GET" | "POST"; body?: JsonRecord; tokenRequired?: boolean; timeoutMs?: number } = {},
): Promise<T> {
  const token = workstationToken();
  if (input.tokenRequired !== false && !token) {
    throw new AiGraderNfcHelperError("NFC_HELPER_PAIRING_REQUIRED", "Pair this NFC workstation before programming.", 401);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${AI_GRADER_NFC_HELPER_BASE_URL}${path}`, {
      method: input.method ?? "GET",
      mode: "cors",
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      headers: {
        Accept: "application/json",
        ...(input.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { "x-tenkings-nfc-token": token } : {}),
      },
      ...(input.body ? { body: JSON.stringify(input.body) } : {}),
      signal: controller.signal,
    });
    const payload = record(await response.json().catch(() => ({})));
    if (!response.ok || payload.ok !== true) {
      const error = record(payload.error);
      throw new AiGraderNfcHelperError(
        typeof error.code === "string" ? error.code : "NFC_HELPER_REQUEST_FAILED",
        typeof error.message === "string" ? error.message : "The local NFC helper rejected the request.",
        response.status,
        record(payload.result),
        error.retryable === true,
      );
    }
    return record(payload.result) as T;
  } catch (error) {
    if (error instanceof AiGraderNfcHelperError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new AiGraderNfcHelperError(
        "NFC_HELPER_TIMEOUT",
        "The local NFC helper response timed out. Keep the same physical tag on the reader and retry the current attempt after the helper is no longer busy.",
        408,
        undefined,
        true,
      );
    }
    throw new AiGraderNfcHelperError(
      "NFC_HELPER_UNAVAILABLE",
      "The dedicated NFC helper is not reachable. Keep the same physical tag on the reader and retry the current attempt after the helper returns.",
      503,
      undefined,
      true,
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function pairAiGraderNfcHelper(pairingCode: string) {
  const code = pairingCode.trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(code)) {
    throw new AiGraderNfcHelperError("NFC_HELPER_PAIRING_CODE_INVALID", "Enter the current NFC helper pairing code.", 400);
  }
  const result = await helperRequest<{ workstationToken?: string }>("/pair", {
    method: "POST",
    body: { pairingCode: code },
    tokenRequired: false,
  });
  const token = result.workstationToken?.trim() ?? "";
  if (!/^[A-Za-z0-9_-]{32,160}$/.test(token)) {
    throw new AiGraderNfcHelperError("NFC_HELPER_PAIRING_RESPONSE_INVALID", "The NFC helper pairing response was invalid.", 502);
  }
  window.localStorage.setItem(AI_GRADER_NFC_HELPER_TOKEN_STORAGE_KEY, token);
  return getAiGraderNfcHelperStatus();
}

export function getAiGraderNfcHelperStatus() {
  return helperRequest<AiGraderNfcHelperStatus>("/status", { tokenRequired: true });
}

export function readAiGraderNfcTag(attemptId: string) {
  return helperRequest<AiGraderNfcHelperWriteResult>("/read", {
    method: "POST",
    body: { attemptId },
    tokenRequired: true,
  });
}

export function writeAiGraderNfcTag(input: {
  attemptId: string;
  idempotencyKey: string;
  publicTagId: string;
  attestationChallenge: string;
  url: string;
  overwriteConfirmation?: { confirmed: true; observedPayloadSha256: string };
}) {
  return helperRequest<AiGraderNfcHelperWriteResult>("/write", {
    method: "POST",
    body: {
      attemptId: input.attemptId,
      idempotencyKey: input.idempotencyKey,
      publicTagId: input.publicTagId,
      attestationChallenge: input.attestationChallenge,
      url: input.url,
      ...(input.overwriteConfirmation ? { overwriteConfirmation: input.overwriteConfirmation } : {}),
    },
    tokenRequired: true,
    timeoutMs: WRITE_TIMEOUT_MS,
  });
}

export function prepareAiGraderF8215Job(input: {
  attemptId: string;
  idempotencyKey: string;
  publicTagId: string;
  attestationChallenge: string;
  url: string;
  attemptExpiresAt: string;
}) {
  return helperRequest<AiGraderF8215PrepareResult>("/prepare", {
    method: "POST",
    body: {
      ...input,
      chipType: "FEIJU_F8215",
      programmingProfile: "gototags_manual_start_v1",
    },
    tokenRequired: true,
  });
}

export function getAiGraderF8215OperationStatus(attemptId: string) {
  return helperRequest<AiGraderF8215OperationStatus>("/operation-status", {
    method: "POST",
    body: { attemptId },
    tokenRequired: true,
  });
}

export function acknowledgeAiGraderF8215Operation(attemptId: string) {
  return helperRequest<{ helperProtocolVersion: string; attemptId: string; cleaned: boolean }>("/operation-ack", {
    method: "POST",
    body: { attemptId },
    tokenRequired: true,
  });
}

export type AiGraderF8215HostedActivationRecovery = {
  status: "active";
  activeAttemptId?: string | null;
  chipType?: "NTAG215" | "FEIJU_F8215" | null;
  nfcTagUrl?: string | null;
};

/**
 * Cleans only a completed local F8215 job that matches authenticated hosted
 * active state. The paired-browser acknowledgment is a local cleanup signal;
 * it does not independently prove hosted activation.
 */
export async function reconcileAiGraderF8215HostedActivation(
  hosted: AiGraderF8215HostedActivationRecovery,
  dependencies: {
    status?: typeof getAiGraderF8215OperationStatus;
    acknowledge?: typeof acknowledgeAiGraderF8215Operation;
  } = {},
): Promise<"cleaned" | "already_absent"> {
  const attemptId = hosted.activeAttemptId?.trim() ?? "";
  const normalizedUrl = hosted.nfcTagUrl?.trim() ?? "";
  if (
    hosted.status !== "active" ||
    hosted.chipType !== "FEIJU_F8215" ||
    !/^nfc_attempt_[A-Za-z0-9_-]{43}$/.test(attemptId) ||
    !/^https:\/\/collect\.tenkings\.co\/nfc\/[A-Za-z0-9_-]{32}$/.test(normalizedUrl)
  ) {
    throw new AiGraderNfcHelperError(
      "NFC_HOSTED_ACTIVATION_RECOVERY_INVALID",
      "The authenticated hosted activation does not contain one exact F8215 recovery identity.",
      409,
    );
  }
  const readStatus = dependencies.status ?? getAiGraderF8215OperationStatus;
  const acknowledge = dependencies.acknowledge ?? acknowledgeAiGraderF8215Operation;
  let local: AiGraderF8215OperationStatus;
  try {
    local = await readStatus(attemptId);
  } catch (error) {
    if (error instanceof AiGraderNfcHelperError && error.code === "gototags_job_not_found") return "already_absent";
    throw error;
  }
  if (
    local.attemptId !== attemptId ||
    local.chipType !== "FEIJU_F8215" ||
    local.programmingProfile !== "gototags_manual_start_v1" ||
    local.phase !== "completed" ||
    !local.terminal ||
    !local.evidence ||
    local.evidence.normalizedUrl !== normalizedUrl ||
    local.evidence.writeProtectionState !== "permanently_read_only_verified" ||
    local.evidence.readerResultCode !== "write_locked_verified_gototags_readback"
  ) {
    throw new AiGraderNfcHelperError(
      "NFC_HOSTED_LOCAL_RECOVERY_MISMATCH",
      "The completed local F8215 job does not match the authenticated hosted activation.",
      409,
    );
  }
  const result = await acknowledge(attemptId);
  if (result.attemptId !== attemptId || !result.cleaned) {
    throw new AiGraderNfcHelperError(
      "NFC_HOSTED_LOCAL_CLEANUP_FAILED",
      "The exact completed local F8215 job was not cleaned.",
      503,
    );
  }
  return "cleaned";
}

export type AiGraderNfcSelectedProfile = "NTAG215_DIRECT_PCSC" | "FEIJU_F8215_GOTOTAGS_MANUAL_START";

export function readAiGraderNfcSelectedProfile(storage: Pick<Storage, "getItem"> = window.localStorage): AiGraderNfcSelectedProfile {
  return storage.getItem(AI_GRADER_NFC_PROFILE_STORAGE_KEY) === "FEIJU_F8215_GOTOTAGS_MANUAL_START"
    ? "FEIJU_F8215_GOTOTAGS_MANUAL_START"
    : "NTAG215_DIRECT_PCSC";
}

export function writeAiGraderNfcSelectedProfile(
  profile: AiGraderNfcSelectedProfile,
  storage: Pick<Storage, "setItem"> = window.localStorage,
) {
  storage.setItem(AI_GRADER_NFC_PROFILE_STORAGE_KEY, profile);
}

type SessionStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function initStorageKey(reportId: string) {
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(reportId)) {
    throw new Error("The NFC report identity is invalid.");
  }
  return `${AI_GRADER_NFC_INIT_IDEMPOTENCY_STORAGE_PREFIX}${reportId}`;
}

export function readAiGraderNfcInitIdempotencyKey(reportId: string, storage: SessionStorageLike = window.sessionStorage) {
  const value = storage.getItem(initStorageKey(reportId))?.trim() ?? "";
  return /^[A-Za-z0-9._:-]{8,128}$/.test(value) ? value : "";
}

/** This report-scoped sessionStorage path stores only the init idempotency
 * key, before init. It never stores a hosted token, challenge, signature, UID
 * fingerprint, or the separately managed workstation pairing credential. */
export function getOrCreateAiGraderNfcInitIdempotencyKey(
  reportId: string,
  storage: SessionStorageLike = window.sessionStorage,
  randomUuid: () => string = () => crypto.randomUUID(),
) {
  const existing = readAiGraderNfcInitIdempotencyKey(reportId, storage);
  if (existing) return existing;
  const generated = `nfc-init-${randomUuid()}`;
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(generated)) throw new Error("The NFC init retry identity could not be created.");
  storage.setItem(initStorageKey(reportId), generated);
  return generated;
}

export function clearAiGraderNfcInitIdempotencyKey(
  reportId: string,
  storage: SessionStorageLike = window.sessionStorage,
) {
  storage.removeItem(initStorageKey(reportId));
}
