export const TURNSTILE_SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const TURNSTILE_SEND_CODE_ACTION = "send_code";

const DEFAULT_TIMEOUT_MS = 8_000;

type SiteverifyResponse = {
  success?: boolean;
  hostname?: string;
  action?: string;
  "error-codes"?: unknown;
};

export type TurnstileFailureReason =
  | "invalid-token"
  | "challenge-rejected"
  | "hostname-mismatch"
  | "action-mismatch"
  | "siteverify-unavailable";

export type TurnstileVerificationResult =
  | {
      success: true;
      hostname: string;
      action: string;
    }
  | {
      success: false;
      reason: TurnstileFailureReason;
      errorCodes: string[];
    };

export type TurnstileFetch = (
  input: string,
  init: RequestInit
) => Promise<Pick<Response, "ok" | "json">>;

type VerifyTurnstileTokenOptions = {
  secretKey: string;
  token: string;
  expectedHostname: string;
  expectedAction?: string;
  timeoutMs?: number;
  fetchImpl?: TurnstileFetch;
};

const failure = (reason: TurnstileFailureReason, errorCodes: string[] = []): TurnstileVerificationResult => ({
  success: false,
  reason,
  errorCodes,
});

const readErrorCodes = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

export async function verifyTurnstileToken({
  secretKey,
  token,
  expectedHostname,
  expectedAction = TURNSTILE_SEND_CODE_ACTION,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch,
}: VerifyTurnstileTokenOptions): Promise<TurnstileVerificationResult> {
  if (!token || token.length > 2_048) {
    return failure("invalid-token");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(TURNSTILE_SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: secretKey,
        response: token,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return failure("siteverify-unavailable");
    }

    const payload = (await response.json()) as SiteverifyResponse;
    const errorCodes = readErrorCodes(payload?.["error-codes"]);

    if (payload?.success !== true) {
      return failure("challenge-rejected", errorCodes);
    }

    const hostname = typeof payload.hostname === "string" ? payload.hostname.toLowerCase() : "";
    if (hostname !== expectedHostname.toLowerCase()) {
      return failure("hostname-mismatch");
    }

    const action = typeof payload.action === "string" ? payload.action : "";
    if (action !== expectedAction) {
      return failure("action-mismatch");
    }

    return { success: true, hostname, action };
  } catch {
    return failure("siteverify-unavailable");
  } finally {
    clearTimeout(timeout);
  }
}
