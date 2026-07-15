export const AI_GRADER_NFC_HELPER_BASE_URL = "http://127.0.0.1:47662";
export const AI_GRADER_NFC_HELPER_TOKEN_STORAGE_KEY = "tenkings.aiGrader.nfc.workstationToken.v1";
export const AI_GRADER_NFC_HELPER_PROTOCOL_VERSION = "tenkings-ai-grader-nfc-loopback-v2";
export const AI_GRADER_NFC_INIT_IDEMPOTENCY_STORAGE_PREFIX = "tenkings.aiGrader.nfc.initIdempotency.v1:";

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
};

export type AiGraderNfcHelperWriteResult = {
  normalizedUrl?: string;
  uidFingerprintSha256?: string;
  readbackPayloadSha256?: string;
  chipType?: "NTAG215";
  readerResultCode?: string;
  helperProtocolVersion?: string;
  overwriteRequired?: boolean;
  observedPayloadSha256?: string | null;
  existingContentKind?: "blank" | "same" | "different" | "unsupported";
  operationalAttestation?: {
    schemaVersion: "ai-grader-nfc-helper-attestation-v1";
    workstationKeyId: string;
    algorithm: "ecdsa-p256-sha256-p1363";
    attestationChallenge: string;
    observedAt: string;
    signature: string;
  } | null;
};

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
  path: "/pair" | "/status" | "/read" | "/write",
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

const DEFINITE_PREWRITE_CODES = new Set([
  "invalid_request_context",
  "invalid_nfc_url",
  "invalid_public_tag_id",
  "pcsc_unavailable",
  "no_tag",
  "multiple_tags",
  "unsupported_tag",
  "invalid_capability_container",
  "tag_read_only",
  "writer_busy",
  "reader_busy",
  "overwrite_confirmation_mismatch",
]);

export function classifyAiGraderNfcHelperWriteRecovery(error: unknown) {
  if (!(error instanceof AiGraderNfcHelperError)) return "uncertain" as const;
  if (DEFINITE_PREWRITE_CODES.has(error.code)) return "definite_prewrite" as const;
  if (error.retryable || ["NFC_HELPER_TIMEOUT", "NFC_HELPER_UNAVAILABLE", "request_cancelled", "reader_timeout"].includes(error.code)) {
    return "uncertain" as const;
  }
  return "not_retryable" as const;
}

export async function waitForAiGraderNfcHelperIdle(input: {
  attempts?: number;
  delayMs?: number;
  readStatus?: () => Promise<AiGraderNfcHelperStatus>;
  delay?: (milliseconds: number) => Promise<void>;
} = {}) {
  const attempts = Math.max(1, Math.min(40, input.attempts ?? 24));
  const delayMs = Math.max(25, Math.min(1_000, input.delayMs ?? 250));
  const readStatus = input.readStatus ?? getAiGraderNfcHelperStatus;
  const delay = input.delay ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  for (let index = 0; index < attempts; index += 1) {
    const status = await readStatus();
    if (!status.busy) return status;
    if (index + 1 < attempts) await delay(delayMs);
  }
  throw new AiGraderNfcHelperError(
    "NFC_HELPER_STILL_BUSY",
    "The NFC reader is still finishing the prior operation. Keep the same physical tag on the reader, wait, and retry this same attempt.",
    409,
    undefined,
    true,
  );
}
