import type { NextApiRequest, NextApiResponse } from "next";
import {
  requireAiGraderProductionActor,
  type AiGraderProductionActor,
  type AiGraderProductionAuthDependencies,
} from "./aiGraderProductionAuth";

export const AI_GRADER_NFC_API_BODY_LIMIT_BYTES = 32 * 1024;
export const AI_GRADER_NFC_ATTEMPT_TTL_SECONDS = 5 * 60;

type JsonRecord = Record<string, unknown>;
type EnvLike = Record<string, string | undefined>;

type NfcRuntimeInput = {
  tenantId: string;
  actorUserId: string;
  actorAudit: AiGraderProductionActor["audit"];
};

export type AiGraderNfcApiDependencies = AiGraderProductionAuthDependencies & {
  env?: EnvLike;
  now?: () => number;
  disableRateLimitForTests?: boolean;
  init(input: NfcRuntimeInput & {
    reportId: string;
    idempotencyKey: string;
    attemptTtlSeconds: number;
  }): Promise<unknown>;
  complete(input: NfcRuntimeInput & {
    reportId: string;
    cardAssetId: string;
    itemId: string;
    certId: string;
    publicTagId: string;
    attemptId: string;
    attemptToken: string;
    idempotencyKey: string;
    chipType: "NTAG215";
    normalizedUrl: string;
    uidFingerprintSha256: string;
    readbackPayloadSha256: string;
    readerResultCode: string;
    helperProtocolVersion: string;
    evidenceType: "local_pcsc_readback_human_operator";
  }): Promise<unknown>;
  status(input: NfcRuntimeInput & { reportId: string }): Promise<unknown>;
  revoke(input: NfcRuntimeInput & { reportId: string; reason: string; idempotencyKey: string }): Promise<unknown>;
  replace(input: NfcRuntimeInput & {
    reportId: string;
    replacedPublicTagId: string;
    reason: string;
    idempotencyKey: string;
    attemptTtlSeconds: number;
  }): Promise<unknown>;
};

type RateWindow = { startedAt: number; count: number };
const rateWindows = new Map<string, RateWindow>();

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function firstText(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function boundedText(value: unknown, label: string, min: number, max: number, pattern?: RegExp) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < min || text.length > max || (pattern && !pattern.test(text))) {
    throw nfcApiError(400, "AI_GRADER_NFC_INVALID_REQUEST", `${label} is invalid.`);
  }
  return text;
}

function reportId(value: unknown) {
  return boundedText(value, "reportId", 1, 160, /^[A-Za-z0-9._:-]+$/);
}

function linkageId(value: unknown, label: string) {
  return boundedText(value, label, 1, 160, /^[A-Za-z0-9._:-]+$/);
}

function idempotencyKey(value: unknown) {
  return boundedText(value, "idempotencyKey", 8, 128, /^[A-Za-z0-9._:-]+$/);
}

function sha256(value: unknown, label: string) {
  return boundedText(value, label, 64, 64, /^[a-f0-9]{64}$/);
}

function assertSmallBody(body: unknown) {
  if (!isRecord(body)) throw nfcApiError(400, "AI_GRADER_NFC_INVALID_REQUEST", "A JSON object body is required.");
  let size = AI_GRADER_NFC_API_BODY_LIMIT_BYTES + 1;
  try {
    size = Buffer.byteLength(JSON.stringify(body), "utf8");
  } catch {
    // The bounded error below is intentionally generic.
  }
  if (size > AI_GRADER_NFC_API_BODY_LIMIT_BYTES) {
    throw nfcApiError(413, "AI_GRADER_NFC_BODY_TOO_LARGE", "The NFC request body is too large.");
  }
  return body;
}

function exactNfcUrl(value: unknown, publicTagId: string) {
  const text = boundedText(value, "normalizedUrl", 1, 256);
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw nfcApiError(400, "AI_GRADER_NFC_URL_INVALID", "The NFC readback URL is invalid.");
  }
  const expected = `https://collect.tenkings.co/nfc/${publicTagId}`;
  if (
    text !== expected ||
    parsed.protocol !== "https:" ||
    parsed.hostname !== "collect.tenkings.co" ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== `/nfc/${publicTagId}`
  ) {
    throw nfcApiError(400, "AI_GRADER_NFC_URL_MISMATCH", "The NFC readback URL does not match the reserved tag URL.");
  }
  return text;
}

function humanActor(actor: AiGraderProductionActor) {
  if (actor.type !== "human_operator" || !actor.user.id) {
    throw nfcApiError(403, "AI_GRADER_NFC_HUMAN_REQUIRED", "A human AI Grader operator session is required.");
  }
  return actor;
}

function enforceRateLimit(actorUserId: string, action: string, req: NextApiRequest, deps: AiGraderNfcApiDependencies) {
  if (deps.disableRateLimitForTests) return;
  const now = (deps.now ?? Date.now)();
  const windowMs = 60_000;
  const limit = req.method === "GET" ? 90 : 30;
  const key = `${actorUserId}:${action}:${req.method}`;
  const current = rateWindows.get(key);
  if (!current || now - current.startedAt >= windowMs) {
    rateWindows.set(key, { startedAt: now, count: 1 });
    return;
  }
  if (current.count >= limit) {
    throw nfcApiError(429, "AI_GRADER_NFC_RATE_LIMITED", "Too many NFC requests. Wait and retry.");
  }
  current.count += 1;
}

function nfcApiError(statusCode: number, code: string, message: string) {
  const error = new Error(message) as Error & { statusCode: number; code: string };
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function safeError(error: unknown) {
  const source = error as { statusCode?: unknown; code?: unknown; message?: unknown };
  const statusCode = typeof source?.statusCode === "number" && source.statusCode >= 400 && source.statusCode <= 499
    ? source.statusCode
    : 500;
  const code =
    typeof source?.code === "string" && /^AI_GRADER_NFC_[A-Z0-9_]+$/.test(source.code)
      ? source.code
      : statusCode === 500
        ? "AI_GRADER_NFC_INTERNAL_ERROR"
        : "AI_GRADER_NFC_REQUEST_REJECTED";
  const message =
    statusCode !== 500 && typeof source?.message === "string" && source.message.length <= 240
      ? source.message
      : statusCode === 500
        ? "The NFC operation failed safely. No tag state was accepted."
        : "The NFC request was rejected.";
  return { statusCode, code, message };
}

function actionKey(req: NextApiRequest) {
  const raw = req.query.action;
  const parts = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  return parts.filter(Boolean).join("/");
}

export function createAiGraderNfcApiHandler(deps: AiGraderNfcApiDependencies) {
  const env = deps.env ?? process.env;
  const tenantId = env.AI_GRADER_PRODUCTION_TENANT_ID?.trim() || "ten-kings";

  return async function aiGraderNfcApiHandler(req: NextApiRequest, res: NextApiResponse) {
    res.setHeader("Cache-Control", "no-store");
    const action = actionKey(req);
    try {
      const contentLength = Number(firstText(req.headers["content-length"]));
      if (Number.isFinite(contentLength) && contentLength > AI_GRADER_NFC_API_BODY_LIMIT_BYTES) {
        throw nfcApiError(413, "AI_GRADER_NFC_BODY_TOO_LARGE", "The NFC request body is too large.");
      }
      const authAction = action === "revoke" || action === "replace" ? "nfc-admin" : "nfc-program";
      const actor = humanActor(await requireAiGraderProductionActor(req, authAction, deps));
      enforceRateLimit(actor.user.id, action, req, deps);
      const common: NfcRuntimeInput = {
        tenantId,
        actorUserId: actor.user.id,
        actorAudit: actor.audit,
      };

      if (action === "status") {
        if (req.method !== "GET") throw nfcApiError(405, "AI_GRADER_NFC_METHOD_NOT_ALLOWED", "GET is required.");
        const result = await deps.status({ ...common, reportId: reportId(req.query.reportId) });
        return res.status(200).json({ ok: true, operation: "aiGraderNfcStatus", result });
      }

      if (req.method !== "POST") throw nfcApiError(405, "AI_GRADER_NFC_METHOD_NOT_ALLOWED", "POST is required.");
      const body = assertSmallBody(req.body);

      if (action === "init") {
        const result = await deps.init({
          ...common,
          reportId: reportId(body.reportId),
          idempotencyKey: idempotencyKey(body.idempotencyKey),
          attemptTtlSeconds: AI_GRADER_NFC_ATTEMPT_TTL_SECONDS,
        });
        return res.status(200).json({ ok: true, operation: "aiGraderNfcInit", result });
      }

      if (action === "complete") {
        const publicTagId = boundedText(body.publicTagId, "publicTagId", 32, 32, /^[A-Za-z0-9_-]+$/);
        if (body.chipType !== "NTAG215") {
          throw nfcApiError(400, "AI_GRADER_NFC_CHIP_UNSUPPORTED", "Only NTAG215 is supported by static_url_v1.");
        }
        const result = await deps.complete({
          ...common,
          reportId: reportId(body.reportId),
          cardAssetId: linkageId(body.cardAssetId, "cardAssetId"),
          itemId: linkageId(body.itemId, "itemId"),
          certId: linkageId(body.certId, "certId"),
          publicTagId,
          attemptId: boundedText(body.attemptId, "attemptId", 22, 80, /^[A-Za-z0-9_-]+$/),
          attemptToken: boundedText(body.attemptToken, "attemptToken", 32, 160, /^[A-Za-z0-9_-]+$/),
          idempotencyKey: idempotencyKey(body.idempotencyKey),
          chipType: "NTAG215",
          normalizedUrl: exactNfcUrl(body.normalizedUrl, publicTagId),
          uidFingerprintSha256: sha256(body.uidFingerprintSha256, "uidFingerprintSha256"),
          readbackPayloadSha256: sha256(body.readbackPayloadSha256, "readbackPayloadSha256"),
          readerResultCode: boundedText(body.readerResultCode, "readerResultCode", 1, 64, /^[A-Za-z0-9_:-]+$/),
          helperProtocolVersion: boundedText(body.helperProtocolVersion, "helperProtocolVersion", 1, 64, /^[A-Za-z0-9._-]+$/),
          evidenceType: "local_pcsc_readback_human_operator",
        });
        return res.status(200).json({ ok: true, operation: "aiGraderNfcComplete", result });
      }

      if (action === "revoke") {
        const result = await deps.revoke({
          ...common,
          reportId: reportId(body.reportId),
          reason: boundedText(body.reason, "reason", 8, 240),
          idempotencyKey: idempotencyKey(body.idempotencyKey),
        });
        return res.status(200).json({ ok: true, operation: "aiGraderNfcRevoke", result });
      }

      if (action === "replace") {
        const result = await deps.replace({
          ...common,
          reportId: reportId(body.reportId),
          replacedPublicTagId: boundedText(body.replacedPublicTagId, "replacedPublicTagId", 32, 32, /^[A-Za-z0-9_-]+$/),
          reason: boundedText(body.reason, "reason", 8, 240),
          idempotencyKey: idempotencyKey(body.idempotencyKey),
          attemptTtlSeconds: AI_GRADER_NFC_ATTEMPT_TTL_SECONDS,
        });
        return res.status(200).json({ ok: true, operation: "aiGraderNfcReplace", result });
      }

      throw nfcApiError(404, "AI_GRADER_NFC_ROUTE_NOT_FOUND", "NFC route not found.");
    } catch (error) {
      const safe = safeError(error);
      return res.status(safe.statusCode).json({ ok: false, code: safe.code, message: safe.message });
    }
  };
}
