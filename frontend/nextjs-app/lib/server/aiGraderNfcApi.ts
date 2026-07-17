import type { NextApiRequest, NextApiResponse } from "next";
import {
  requireAiGraderProductionActor,
  type AiGraderProductionActor,
  type AiGraderProductionAuthDependencies,
} from "./aiGraderProductionAuth";
import {
  aiGraderNfcProgrammingReadiness,
  type AiGraderNfcProgrammingReadiness,
} from "./aiGraderNfcPolicy";

export const AI_GRADER_NFC_API_BODY_LIMIT_BYTES = 32 * 1024;
export const AI_GRADER_NFC_ATTEMPT_TTL_SECONDS = 5 * 60;

type JsonRecord = Record<string, unknown>;
type EnvLike = Record<string, string | undefined>;

type NfcRuntimeInput = {
  tenantId: string;
  actorUserId: string;
  actorAudit: AiGraderProductionActor["audit"];
};

type OperationalAttestationInput = {
  schemaVersion: "ai-grader-nfc-helper-attestation-v1" | "ai-grader-nfc-helper-attestation-v2";
  workstationKeyId: string;
  algorithm: "ecdsa-p256-sha256-p1363";
  attestationChallenge: string;
  observedAt: string;
  signature: string;
};

export type AiGraderNfcApiDependencies = AiGraderProductionAuthDependencies & {
  env?: EnvLike;
  now?: () => number;
  disableRateLimitForTests?: boolean;
  readiness?: (env: EnvLike, tenantId: string) => AiGraderNfcProgrammingReadiness;
  schemaReadiness?: () => Promise<boolean>;
  init(input: NfcRuntimeInput & {
    reportId: string;
    idempotencyKey: string;
    attemptTtlSeconds: number;
    chipType: "NTAG215" | "FEIJU_F8215";
    programmingProfile: "ntag215_direct_pcsc_v1" | "gototags_manual_start_v1";
    operatorFreshInventoryConfirmation?: "operator_fresh_inventory_confirmation_v1";
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
    chipType: "NTAG215" | "FEIJU_F8215";
    programmingProfile: "ntag215_direct_pcsc_v1" | "gototags_manual_start_v1";
    normalizedUrl: string;
    uidFingerprintSha256: string;
    readbackPayloadSha256: string;
    readerResultCode: string;
    helperProtocolVersion: string;
    adapterIdentity?: "gototags_desktop";
    adapterVersion?: "4.37.0.1";
    writeProtectionState?: "permanently_read_only_verified";
    operationalAttestation: OperationalAttestationInput;
  }): Promise<unknown>;
  status(input: NfcRuntimeInput & { reportId: string }): Promise<unknown>;
  publishedLinkage(input: NfcRuntimeInput & { reportId: string }): Promise<{
    reportId: string;
    cardAssetId: string;
    itemId: string;
    certId: string;
    cardTitle?: string;
    cardSet?: string;
  }>;
  revoke(input: NfcRuntimeInput & { reportId: string; reason: string; idempotencyKey: string }): Promise<unknown>;
  replace(input: NfcRuntimeInput & {
    reportId: string;
    replacedPublicTagId: string;
    reason: string;
    idempotencyKey: string;
    attemptTtlSeconds: number;
    chipType: "NTAG215" | "FEIJU_F8215";
    programmingProfile: "ntag215_direct_pcsc_v1" | "gototags_manual_start_v1";
    operatorFreshInventoryConfirmation?: "operator_fresh_inventory_confirmation_v1";
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

function operationalAttestation(value: unknown): OperationalAttestationInput {
  if (!isRecord(value)) {
    throw nfcApiError(400, "AI_GRADER_NFC_ATTESTATION_REQUIRED", "A workstation operational attestation is required.");
  }
  const expectedKeys = [
    "algorithm",
    "attestationChallenge",
    "observedAt",
    "schemaVersion",
    "signature",
    "workstationKeyId",
  ];
  if (Object.keys(value).sort().join("\n") !== expectedKeys.join("\n")) {
    throw nfcApiError(400, "AI_GRADER_NFC_ATTESTATION_INVALID", "The workstation operational attestation is invalid.");
  }
  if (
    value.schemaVersion !== "ai-grader-nfc-helper-attestation-v1" &&
    value.schemaVersion !== "ai-grader-nfc-helper-attestation-v2"
  ) {
    throw nfcApiError(400, "AI_GRADER_NFC_ATTESTATION_SCHEMA_INVALID", "The workstation attestation schema is not supported.");
  }
  if (value.algorithm !== "ecdsa-p256-sha256-p1363") {
    throw nfcApiError(400, "AI_GRADER_NFC_ATTESTATION_ALGORITHM_INVALID", "The workstation attestation algorithm is not supported.");
  }
  return {
    schemaVersion: value.schemaVersion,
    workstationKeyId: boundedText(value.workstationKeyId, "workstationKeyId", 64, 64, /^[a-f0-9]{64}$/),
    algorithm: "ecdsa-p256-sha256-p1363",
    attestationChallenge: boundedText(value.attestationChallenge, "attestationChallenge", 43, 43, /^[A-Za-z0-9_-]{43}$/),
    observedAt: boundedText(
      value.observedAt,
      "observedAt",
      24,
      24,
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    ),
    signature: boundedText(value.signature, "signature", 86, 86, /^[A-Za-z0-9_-]{86}$/),
  };
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

type RequestedProfile =
  | { chipType: "NTAG215"; programmingProfile: "ntag215_direct_pcsc_v1" }
  | { chipType: "FEIJU_F8215"; programmingProfile: "gototags_manual_start_v1" };

function requestedProfile(body: JsonRecord): RequestedProfile {
  const chipType = body.chipType ?? "NTAG215";
  const programmingProfile = body.programmingProfile ?? (
    chipType === "NTAG215" ? "ntag215_direct_pcsc_v1" : undefined
  );
  if (chipType === "NTAG215" && programmingProfile === "ntag215_direct_pcsc_v1") {
    return { chipType, programmingProfile };
  }
  if (chipType === "FEIJU_F8215" && programmingProfile === "gototags_manual_start_v1") {
    return { chipType, programmingProfile };
  }
  throw nfcApiError(400, "AI_GRADER_NFC_CHIP_UNSUPPORTED", "The NFC programming profile is not supported.");
}

function freshInventoryConfirmation(body: JsonRecord, profile: RequestedProfile) {
  if (profile.chipType !== "FEIJU_F8215") {
    if (body.operatorFreshInventoryConfirmation !== undefined) {
      throw nfcApiError(400, "AI_GRADER_NFC_FRESH_INVENTORY_CONFIRMATION_INVALID", "Fresh inventory confirmation applies only to Feiju F8215.");
    }
    return undefined;
  }
  if (body.operatorFreshInventoryConfirmation !== "operator_fresh_inventory_confirmation_v1") {
    throw nfcApiError(
      400,
      "AI_GRADER_NFC_FRESH_INVENTORY_CONFIRMATION_REQUIRED",
      "Confirm one fresh controlled-inventory F8215 before preparing the job.",
    );
  }
  return "operator_fresh_inventory_confirmation_v1" as const;
}

function humanActor(actor: AiGraderProductionActor, adminOnly: boolean) {
  if (actor.type !== "human_operator" || !actor.user.id) {
    throw nfcApiError(403, "AI_GRADER_NFC_HUMAN_REQUIRED", "A human AI Grader operator session is required.");
  }
  if (adminOnly && actor.role !== "ai_grader_admin") {
    throw nfcApiError(403, "AI_GRADER_NFC_ADMIN_REQUIRED", "An AI Grader administrator is required for this NFC action.");
  }
  return actor;
}

function requireProgrammingReady(readiness: AiGraderNfcProgrammingReadiness) {
  requireSchemaReady(readiness);
  if (!readiness.nfcProgrammingEnabled) {
    throw nfcApiError(503, "AI_GRADER_NFC_PROGRAMMING_DISABLED", "NFC programming is disabled by server policy.");
  }
  if (!readiness.nfcAttemptTokenConfigured || !readiness.nfcWorkstationAttestationConfigured || readiness.nfcWorkstationKeyCount < 1) {
    throw nfcApiError(503, "AI_GRADER_NFC_PROGRAMMING_NOT_CONFIGURED", "NFC programming is not fully configured.");
  }
}

function requireProfileReady(readiness: AiGraderNfcProgrammingReadiness, profile: RequestedProfile) {
  requireProgrammingReady(readiness);
  if (profile.chipType === "FEIJU_F8215" && !readiness.nfcFeijuF8215Enabled) {
    throw nfcApiError(503, "AI_GRADER_NFC_FEIJU_F8215_DISABLED", "Feiju F8215 programming is disabled by server policy.");
  }
}

function requireSchemaReady(readiness: AiGraderNfcProgrammingReadiness) {
  if (!readiness.nfcSchemaReady) {
    throw nfcApiError(
      503,
      "AI_GRADER_NFC_SCHEMA_UNAVAILABLE",
      "NFC persistence is unavailable until the approved database migration is applied.",
    );
  }
}

async function defaultSchemaReadiness() {
  const { prisma, readCachedAiGraderNfcSchemaReadiness } = await import("@tenkings/database");
  return (await readCachedAiGraderNfcSchemaReadiness(prisma as any)).ready;
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
  const statusCode = typeof source?.statusCode === "number" && source.statusCode >= 400 && source.statusCode <= 599
    ? source.statusCode
    : 500;
  const code =
    typeof source?.code === "string" && /^AI_GRADER_NFC_[A-Z0-9_]+$/.test(source.code)
      ? source.code
      : statusCode >= 500
        ? "AI_GRADER_NFC_INTERNAL_ERROR"
        : "AI_GRADER_NFC_REQUEST_REJECTED";
  const message =
    code.startsWith("AI_GRADER_NFC_") && typeof source?.message === "string" && source.message.length <= 240
      ? source.message
      : statusCode >= 500
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
      const actor = humanActor(
        await requireAiGraderProductionActor(req, authAction, deps),
        action === "revoke" || action === "replace",
      );
      enforceRateLimit(actor.user.id, action, req, deps);
      let nfcSchemaReady: boolean;
      try {
        nfcSchemaReady = await (deps.schemaReadiness ?? defaultSchemaReadiness)();
      } catch {
        throw nfcApiError(
          503,
          "AI_GRADER_NFC_SCHEMA_CHECK_FAILED",
          "NFC persistence readiness could not be verified. No NFC state was changed.",
        );
      }
      const readiness = {
        ...(deps.readiness ?? aiGraderNfcProgrammingReadiness)(env, tenantId),
        nfcSchemaReady,
      };
      const common: NfcRuntimeInput = {
        tenantId,
        actorUserId: actor.user.id,
        actorAudit: actor.audit,
      };

      if (action === "status") {
        if (req.method !== "GET") throw nfcApiError(405, "AI_GRADER_NFC_METHOD_NOT_ALLOWED", "GET is required.");
        const requestedReportId = reportId(req.query.reportId);
        const result = nfcSchemaReady
          ? await deps.status({ ...common, reportId: requestedReportId })
          : {
              ...(await deps.publishedLinkage({ ...common, reportId: requestedReportId })),
              status: "unavailable",
              registrationKind: "not_active",
              cryptographicallyVerified: false,
            };
        return res.status(200).json({
          ok: true,
          operation: "aiGraderNfcStatus",
          result: {
            ...(isRecord(result) ? result : {}),
            ...readiness,
            canProgram: true,
            canAdmin: actor.role === "ai_grader_admin",
          },
        });
      }

      if (req.method !== "POST") throw nfcApiError(405, "AI_GRADER_NFC_METHOD_NOT_ALLOWED", "POST is required.");
      const body = assertSmallBody(req.body);

      if (action === "init") {
        const profile = requestedProfile(body);
        requireProfileReady(readiness, profile);
        const result = await deps.init({
          ...common,
          ...profile,
          operatorFreshInventoryConfirmation: freshInventoryConfirmation(body, profile),
          reportId: reportId(body.reportId),
          idempotencyKey: idempotencyKey(body.idempotencyKey),
          attemptTtlSeconds: AI_GRADER_NFC_ATTEMPT_TTL_SECONDS,
        });
        return res.status(200).json({ ok: true, operation: "aiGraderNfcInit", result });
      }

      if (action === "complete") {
        const profile = requestedProfile(body);
        requireProfileReady(readiness, profile);
        const publicTagId = boundedText(body.publicTagId, "publicTagId", 32, 32, /^[A-Za-z0-9_-]+$/);
        const readerResultCode = boundedText(body.readerResultCode, "readerResultCode", 1, 64, /^[A-Za-z0-9_:-]+$/);
        const eligibleResult = profile.chipType === "NTAG215"
          ? readerResultCode === "write_verified_pcsc_readback" || readerResultCode === "already_programmed_exact"
          : readerResultCode === "write_locked_verified_gototags_readback";
        if (!eligibleResult) {
          throw nfcApiError(400, "AI_GRADER_NFC_READER_RESULT_INVALID", "The NFC reader result is not eligible for activation.");
        }
        const helperProtocolVersion = boundedText(
          body.helperProtocolVersion,
          "helperProtocolVersion",
          1,
          64,
          /^[A-Za-z0-9._-]+$/,
        );
        if (helperProtocolVersion !== readiness.expectedNfcHelperProtocolVersion) {
          throw nfcApiError(409, "AI_GRADER_NFC_HELPER_PROTOCOL_MISMATCH", "The NFC workstation helper must be updated before programming.");
        }
        const attestation = operationalAttestation(body.operationalAttestation);
        if (
          (profile.chipType === "NTAG215" && attestation.schemaVersion !== "ai-grader-nfc-helper-attestation-v1") ||
          (profile.chipType === "FEIJU_F8215" && attestation.schemaVersion !== "ai-grader-nfc-helper-attestation-v2")
        ) {
          throw nfcApiError(400, "AI_GRADER_NFC_ATTESTATION_SCHEMA_INVALID", "The workstation attestation schema does not match the NFC profile.");
        }
        const f8215Evidence = profile.chipType === "FEIJU_F8215"
          ? {
              adapterIdentity: body.adapterIdentity === "gototags_desktop"
                ? "gototags_desktop" as const
                : (() => { throw nfcApiError(400, "AI_GRADER_NFC_ADAPTER_EVIDENCE_INVALID", "The Feiju adapter identity is invalid."); })(),
              adapterVersion: body.adapterVersion === "4.37.0.1"
                ? "4.37.0.1" as const
                : (() => { throw nfcApiError(400, "AI_GRADER_NFC_ADAPTER_EVIDENCE_INVALID", "The Feiju adapter version is invalid."); })(),
              writeProtectionState: body.writeProtectionState === "permanently_read_only_verified"
                ? "permanently_read_only_verified" as const
                : (() => { throw nfcApiError(400, "AI_GRADER_NFC_WRITE_PROTECTION_INVALID", "Permanent write protection was not verified."); })(),
            }
          : {};
        const result = await deps.complete({
          ...common,
          ...profile,
          ...f8215Evidence,
          reportId: reportId(body.reportId),
          cardAssetId: linkageId(body.cardAssetId, "cardAssetId"),
          itemId: linkageId(body.itemId, "itemId"),
          certId: linkageId(body.certId, "certId"),
          publicTagId,
          attemptId: boundedText(body.attemptId, "attemptId", 22, 80, /^[A-Za-z0-9_-]+$/),
          attemptToken: boundedText(body.attemptToken, "attemptToken", 32, 160, /^[A-Za-z0-9_-]+$/),
          idempotencyKey: idempotencyKey(body.idempotencyKey),
          normalizedUrl: exactNfcUrl(body.normalizedUrl, publicTagId),
          uidFingerprintSha256: sha256(body.uidFingerprintSha256, "uidFingerprintSha256"),
          readbackPayloadSha256: sha256(body.readbackPayloadSha256, "readbackPayloadSha256"),
          readerResultCode,
          helperProtocolVersion,
          operationalAttestation: attestation,
        });
        return res.status(200).json({ ok: true, operation: "aiGraderNfcComplete", result });
      }

      if (action === "revoke") {
        requireSchemaReady(readiness);
        const result = await deps.revoke({
          ...common,
          reportId: reportId(body.reportId),
          reason: boundedText(body.reason, "reason", 8, 240),
          idempotencyKey: idempotencyKey(body.idempotencyKey),
        });
        return res.status(200).json({ ok: true, operation: "aiGraderNfcRevoke", result });
      }

      if (action === "replace") {
        const profile = requestedProfile(body);
        requireProfileReady(readiness, profile);
        const result = await deps.replace({
          ...common,
          ...profile,
          operatorFreshInventoryConfirmation: freshInventoryConfirmation(body, profile),
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
