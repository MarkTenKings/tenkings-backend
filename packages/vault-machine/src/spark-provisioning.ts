import { createPublicKey, verify } from "node:crypto";
import { canonicalJson } from "../../vault-contracts/dist";
import { NayaxSparkClient } from "./nayax-spark-client";
import { digest } from "./util";

export type SparkStage = "SANDBOX" | "PRODUCTION";
export interface SparkProvisioningInput {
  schemaVersion: 1;
  machineId: string;
  stage: SparkStage;
  callbackOrigin: string;
  callbackHeaderName: string;
  profile: {
    apiBase: string; environment: SparkStage; sandboxConfirmed: boolean; productionConfirmed?: boolean; credentialGeneration?: string;
    preSelectionConfirmed: true; currency: "USD"; currencyConfirmed: true;
    terminalId: string; terminalIdType: 1 | 2; nayaxMachineId: string; hwSerial: string; siteId: number;
    integratorId: string; tokenId: number; signingProfile: "MANUAL_BODY_SHA256" | "CURRENT_GUID_SHA256";
    wireApiVersion: string | null; vendorApprovalReference: string; maxTotalCents: number;
    callbackTerminalIdRepresentation: "HW_SERIAL" | "MACHINE_ID"; acquiringOnlyConfirmed: true;
    cardUidPolicy: "REJECT_AMBIGUOUS" | "ALLOW_CONFIRMED_ACQUIRING";
    acquiringCardBrands: string[]; unsupportedCardBrands: string[];
    triggerReplayPolicy: "DISABLED" | "SAME_GUID_CONFIRMED_FINAL";
    cancelReplayPolicy: "DISABLED" | "SAME_REQUEST_CONFIRMED";
    maxTriggerAttempts: number; maxCancelAttempts: number;
  };
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha = /^[a-f0-9]{64}$/;
const profileKeys = ["apiBase", "environment", "sandboxConfirmed", "productionConfirmed", "credentialGeneration", "preSelectionConfirmed", "currency", "currencyConfirmed", "terminalId", "terminalIdType", "nayaxMachineId", "hwSerial", "siteId", "integratorId", "tokenId", "signingProfile", "wireApiVersion", "vendorApprovalReference", "maxTotalCents", "callbackTerminalIdRepresentation", "acquiringOnlyConfirmed", "cardUidPolicy", "acquiringCardBrands", "unsupportedCardBrands", "triggerReplayPolicy", "cancelReplayPolicy", "maxTriggerAttempts", "maxCancelAttempts"];
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const fail = (code: string): never => { throw new Error(`SPARK_PROVISIONING_${code}`); };
function need(condition: unknown, code: string): asserts condition { if (!condition) fail(code); }

/** The intersection of cloud and local rules is intentional: a generated pair
 * must be accepted by both consumers. No network or journal is opened here. */
export function validateSparkProvisioning(value: unknown): SparkProvisioningInput {
  need(object(value), "INPUT_INVALID");
  const input = value as Record<string, unknown>;
  need(Object.keys(input).every(k => ["schemaVersion", "machineId", "stage", "callbackOrigin", "callbackHeaderName", "profile"].includes(k)), "UNEXPECTED_FIELD");
  need(input.schemaVersion === 1 && typeof input.machineId === "string" && uuid.test(input.machineId), "IDENTITY_INVALID");
  need(["SANDBOX", "PRODUCTION"].includes(String(input.stage)) && object(input.profile), "PROFILE_INVALID");
  const p = input.profile as Record<string, unknown>;
  need(Object.keys(p).every(k => profileKeys.includes(k)), "UNEXPECTED_PROFILE_FIELD");
  need(p.environment === input.stage && p.preSelectionConfirmed === true && p.currencyConfirmed === true && p.currency === "USD" && p.acquiringOnlyConfirmed === true, "VENDOR_CONFIRMATION_REQUIRED");
  need(input.stage === "SANDBOX" ? p.sandboxConfirmed === true && p.productionConfirmed !== true && p.credentialGeneration == null : p.productionConfirmed === true && p.sandboxConfirmed === false && typeof p.credentialGeneration === "string" && uuid.test(p.credentialGeneration), "ENVIRONMENT_CONFIRMATION_REQUIRED");
  need(p.wireApiVersion === null, "WIRE_VERSION_UNSUPPORTED");
  // Constructor validation is read-only; fixed dummy secrets are never used to send requests.
  try { new NayaxSparkClient({ ...(p as unknown as SparkProvisioningInput["profile"]), beforeEffect: () => { throw new Error("OFFLINE_ONLY"); },
    tokenSecret: "OFFLINE_VALIDATION_0123456789abcdefghijklmnopqrstuvwxyz", signKey: "OFFLINE_VALIDATION_ONLY_SIGN_KEY" }); }
  catch { fail("WIRE_PROFILE_INVALID"); }
  need(typeof p.nayaxMachineId === "string" && /^[1-9][0-9]{0,18}$/.test(p.nayaxMachineId) && BigInt(p.nayaxMachineId) <= 9223372036854775807n, "DEVICE_INVALID");
  need([p.terminalId, p.hwSerial].every(v => typeof v === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(v)) && (p.terminalIdType === 1 || p.terminalIdType === 2)
    && p.terminalId === (p.terminalIdType === 1 ? p.hwSerial : p.nayaxMachineId), "TERMINAL_INVALID");
  need(Number.isSafeInteger(p.siteId) && Number(p.siteId) >= 1 && Number(p.siteId) <= 32767, "SITE_INVALID");
  need(Number.isSafeInteger(p.maxTotalCents) && Number(p.maxTotalCents) > 0 && Number(p.maxTotalCents) <= 99999999, "AMOUNT_LIMIT_INVALID");
  need(["HW_SERIAL", "MACHINE_ID"].includes(String(p.callbackTerminalIdRepresentation)) && ["REJECT_AMBIGUOUS", "ALLOW_CONFIRMED_ACQUIRING"].includes(String(p.cardUidPolicy)), "METHOD_PROFILE_INVALID");
  const brands = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 40 && v.every(s => typeof s === "string" && /^[A-Za-z0-9 _-]{1,40}$/.test(s)) && new Set(v).size === v.length;
  need(brands(p.acquiringCardBrands) && brands(p.unsupportedCardBrands), "BRANDS_INVALID");
  need(!(p.acquiringCardBrands as string[]).some(s => (p.unsupportedCardBrands as string[]).includes(s)), "BRANDS_OVERLAP");
  need(["DISABLED", "SAME_GUID_CONFIRMED_FINAL"].includes(String(p.triggerReplayPolicy)) && ["DISABLED", "SAME_REQUEST_CONFIRMED"].includes(String(p.cancelReplayPolicy))
    && [p.maxTriggerAttempts, p.maxCancelAttempts].every(v => Number.isSafeInteger(v) && Number(v) >= 1 && Number(v) <= 3)
    && (p.triggerReplayPolicy !== "DISABLED" || p.maxTriggerAttempts === 1) && (p.cancelReplayPolicy !== "DISABLED" || p.maxCancelAttempts === 1), "RETRY_PROFILE_INVALID");
  let callback: URL;
  try { callback = new URL(String(input.callbackOrigin)); } catch { return fail("CALLBACK_ORIGIN_INVALID"); }
  need(callback.protocol === "https:" && callback.origin === input.callbackOrigin && !callback.username && !callback.password && callback.hostname !== "localhost"
    && !/^(?:127\.|0\.|\[)/.test(callback.hostname), "CALLBACK_ORIGIN_INVALID");
  need(typeof input.callbackHeaderName === "string" && /^x-[a-z0-9-]{1,100}$/.test(input.callbackHeaderName), "CALLBACK_HEADER_INVALID");
  return JSON.parse(JSON.stringify(input)) as SparkProvisioningInput;
}

export function buildSparkProvisioning(value: unknown) {
  const input = validateSparkProvisioning(value), p = input.profile;
  const methodProfile = { acquiringCardBrands: p.acquiringCardBrands, acquiringOnlyConfirmed: p.acquiringOnlyConfirmed,
    callbackTerminalIdRepresentation: p.callbackTerminalIdRepresentation, cardUidPolicy: p.cardUidPolicy, unsupportedCardBrands: p.unsupportedCardBrands };
  const baseCloudBinding = { machineId: input.machineId.toLowerCase(), nayaxMachineId: p.nayaxMachineId, terminalId: p.terminalId,
    hwSerial: p.hwSerial, siteId: p.siteId, currency: p.currency, ...methodProfile };
  const mode = input.stage === "SANDBOX" ? "OFFICIAL_TEST" : "LIVE";
  const bindingDigest = digest({ provider: "NAYAX_SPARK", mode, ...(input.stage === "PRODUCTION" ? { credentialGeneration: p.credentialGeneration } : {}), flow: "REMOTE_START_PRE_SELECTION", apiBase: new URL(p.apiBase).href,
    machineId: input.machineId.toLowerCase(), terminalId: p.terminalId, terminalIdType: p.terminalIdType, nayaxMachineId: p.nayaxMachineId, hwSerial: p.hwSerial,
    siteId: p.siteId, integratorId: p.integratorId, tokenId: p.tokenId, currency: p.currency, signingProfile: p.signingProfile, wireApiVersion: p.wireApiVersion,
    vendorApprovalReference: p.vendorApprovalReference, maxTotalCents: p.maxTotalCents, acquiringOnlyConfirmed: p.acquiringOnlyConfirmed,
    cardUidPolicy: p.cardUidPolicy, acquiringCardBrands: p.acquiringCardBrands, unsupportedCardBrands: p.unsupportedCardBrands,
    callbackTerminalIdRepresentation: p.callbackTerminalIdRepresentation, triggerReplayPolicy: p.triggerReplayPolicy, cancelReplayPolicy: p.cancelReplayPolicy,
    maxTriggerAttempts: p.maxTriggerAttempts, maxCancelAttempts: p.maxCancelAttempts });
  const cloudBinding = { ...baseCloudBinding, ...(input.stage === "PRODUCTION" ? { stage: input.stage, paymentBindingDigest: bindingDigest } : {}) };
  const prefix = input.stage === "PRODUCTION" ? "VAULT_NAYAX_SPARK_PRODUCTION_" : "VAULT_NAYAX_SPARK_";
  const route = input.stage === "PRODUCTION" ? "/api/vault/v1/spark/production" : "/api/vault/v1/spark";
  return { schemaVersion: 1, machineId: cloudBinding.machineId, stage: input.stage, configurationDigest: digest(input), bindingDigest,
    methodProfileDigest: digest(methodProfile), localProfile: p, cloudBindings: [cloudBinding],
    cloudEnvironment: { [`${prefix}CALLBACKS_ENABLED`]: "false", [`${prefix}ENVIRONMENT`]: input.stage,
      [`${prefix}CALLBACK_HEADER`]: input.callbackHeaderName, [`${prefix}BINDINGS_JSON`]: JSON.stringify([cloudBinding]) },
    callbackUrls: { transaction: `${input.callbackOrigin}${route}/TransactionCallback`, decline: `${input.callbackOrigin}${route}/DeclineCallback`, timeout: `${input.callbackOrigin}${route}/TimeoutCallback` },
    secretEnvironmentNames: input.stage === "PRODUCTION"
      ? ["VAULT_SPARK_PRODUCTION_TOKEN_SECRET", "VAULT_SPARK_PRODUCTION_SIGN_KEY", "VAULT_NAYAX_SPARK_PRODUCTION_CALLBACK_SECRET"]
      : ["VAULT_SPARK_TOKEN_SECRET", "VAULT_SPARK_SIGN_KEY", "VAULT_NAYAX_SPARK_CALLBACK_SECRET"],
    activationAllowed: false, requiredNextStep: input.stage === "SANDBOX" ? "Install protected credentials and confirm callback onboarding before explicit sandbox enablement" : "Verify signed production activation authority and qualify the exact release before enabling LIVE" };
}

export function compareSparkCloudBinding(value: unknown, rawBindings: unknown): { matches: boolean; methodProfileDigest: string } {
  const planned = buildSparkProvisioning(value);
  need(Array.isArray(rawBindings), "CLOUD_BINDINGS_INVALID");
  const matching = rawBindings.filter(b => object(b) && b.machineId === planned.machineId);
  need(matching.length === 1 && digest(matching[0]) === digest(planned.cloudBindings[0]), "CLOUD_LOCAL_MISMATCH");
  return { matches: true, methodProfileDigest: planned.methodProfileDigest };
}

export function checkSparkSecretPresence(env: Record<string, string | undefined>, stage: SparkStage = "SANDBOX") {
  need(stage === "SANDBOX" || stage === "PRODUCTION", "STAGE_INVALID");
  const token = stage === "PRODUCTION" ? env.VAULT_SPARK_PRODUCTION_TOKEN_SECRET : env.VAULT_SPARK_TOKEN_SECRET;
  const key = stage === "PRODUCTION" ? env.VAULT_SPARK_PRODUCTION_SIGN_KEY : env.VAULT_SPARK_SIGN_KEY;
  const callback = stage === "PRODUCTION" ? env.VAULT_NAYAX_SPARK_PRODUCTION_CALLBACK_SECRET : env.VAULT_NAYAX_SPARK_CALLBACK_SECRET;
  const valid = (v: unknown, minimum: number): v is string => typeof v === "string" && v.length >= minimum && v.length <= 512 && !/[\r\n]/.test(v);
  const checks = { tokenSecret: valid(token, 32) && Buffer.byteLength(token.slice(-32), "utf8") === 32,
    signingKey: valid(key, 16), callbackSecret: valid(callback, 32),
    callbackSecretDistinct: !!callback && callback !== token && callback !== key && (stage !== "PRODUCTION" || callback !== env.VAULT_NAYAX_SPARK_CALLBACK_SECRET) };
  return { ready: Object.values(checks).every(Boolean), checks };
}

export const SPARK_PROMOTION_EVIDENCE = ["NAYAX_CERTIFICATION", "TERMINAL_SANDBOX", "CABINET_ACCEPTANCE", "LINUX_RELEASE", "PRODUCTION_ACCOUNT"] as const;
export interface SparkPromotionApproval {
  schemaVersion: 1; purpose: "VAULT_SPARK_PRODUCTION_PROMOTION"; machineId: string; configurationDigest: string;
  previousBindingDigest: string; targetBindingDigest: string; sourceCommit: string; approvedBy: string; approvedAt: string; expiresAt: string;
  evidence: { kind: typeof SPARK_PROMOTION_EVIDENCE[number]; sha256: string }[];
}

/** Verifies an explicit authority document; never changes a runtime or rewrites
 * historical bindings. Approval is bound to the exact new configuration and evidence bytes. */
export function verifySparkPromotion(value: unknown, envelope: { payload: SparkPromotionApproval; signature: string }, publicKeyPem: string,
  evidenceDigests: Partial<Record<typeof SPARK_PROMOTION_EVIDENCE[number], string>>, now = Date.now()) {
  const planned = buildSparkProvisioning(value), p = envelope?.payload;
  need(planned.stage === "PRODUCTION" && object(p) && p.schemaVersion === 1 && p.purpose === "VAULT_SPARK_PRODUCTION_PROMOTION", "PROMOTION_INVALID");
  need(p.machineId === planned.machineId && p.configurationDigest === planned.configurationDigest && p.targetBindingDigest === planned.bindingDigest
    && sha.test(p.previousBindingDigest) && p.previousBindingDigest !== p.targetBindingDigest && /^[a-f0-9]{40}$/.test(p.sourceCommit), "PROMOTION_BINDING_INVALID");
  need(typeof p.approvedBy === "string" && /^[A-Za-z0-9_.:@-]{1,160}$/.test(p.approvedBy) && Number.isFinite(now)
    && Number.isFinite(Date.parse(p.approvedAt)) && Date.parse(p.approvedAt) <= now && Date.parse(p.expiresAt) > now
    && Date.parse(p.expiresAt) - Date.parse(p.approvedAt) <= 24 * 60 * 60 * 1000, "PROMOTION_EXPIRED");
  need(Array.isArray(p.evidence) && p.evidence.length === SPARK_PROMOTION_EVIDENCE.length
    && SPARK_PROMOTION_EVIDENCE.every(kind => p.evidence.filter(e => e.kind === kind && sha.test(e.sha256) && evidenceDigests[kind] === e.sha256).length === 1), "PROMOTION_EVIDENCE_INVALID");
  try {
    const key = createPublicKey(publicKeyPem);
    need(key.asymmetricKeyType === "ed25519" && typeof envelope.signature === "string" && /^[A-Za-z0-9+/]{86}==$/.test(envelope.signature)
      && verify(null, Buffer.from(canonicalJson(p)), key, Buffer.from(envelope.signature, "base64")), "PROMOTION_SIGNATURE_INVALID");
  } catch { fail("PROMOTION_SIGNATURE_INVALID"); }
  return { approved: true, machineId: planned.machineId, previousBindingDigest: p.previousBindingDigest, targetBindingDigest: p.targetBindingDigest,
    configurationDigest: planned.configurationDigest, sourceCommit: p.sourceCommit, authorityDigest: digest(p), activationAllowed: false,
    requiredActions: ["Quiesce and reconcile the previous provider binding", "Preserve its journals and cloud receipt route", "Provision a separate production journal and exact device/credential binding", "Qualify and explicitly activate the signed production release"] };
}
