export const AI_GRADER_NFC_HELPER_BASE_URL = "http://127.0.0.1:47662";
export const AI_GRADER_NFC_HELPER_TOKEN_STORAGE_KEY = "tenkings.aiGrader.nfc.workstationToken.v1";
export const AI_GRADER_NFC_HELPER_PROTOCOL_VERSION = "tenkings-ai-grader-nfc-loopback-v1";

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
};

export class AiGraderNfcHelperError extends Error {
  readonly code: string;
  readonly status: number;
  readonly result?: JsonRecord;

  constructor(code: string, message: string, status: number, result?: JsonRecord) {
    super(message);
    this.name = "AiGraderNfcHelperError";
    this.code = code;
    this.status = status;
    this.result = result;
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
      );
    }
    return record(payload.result) as T;
  } catch (error) {
    if (error instanceof AiGraderNfcHelperError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new AiGraderNfcHelperError("NFC_HELPER_TIMEOUT", "The local NFC helper timed out safely.", 408);
    }
    throw new AiGraderNfcHelperError(
      "NFC_HELPER_UNAVAILABLE",
      "The dedicated NFC helper is not reachable on this workstation.",
      503,
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
  url: string;
  overwriteConfirmation?: { confirmed: true; observedPayloadSha256: string };
}) {
  return helperRequest<AiGraderNfcHelperWriteResult>("/write", {
    method: "POST",
    body: {
      attemptId: input.attemptId,
      idempotencyKey: input.idempotencyKey,
      url: input.url,
      ...(input.overwriteConfirmation ? { overwriteConfirmation: input.overwriteConfirmation } : {}),
    },
    tokenRequired: true,
    timeoutMs: WRITE_TIMEOUT_MS,
  });
}
