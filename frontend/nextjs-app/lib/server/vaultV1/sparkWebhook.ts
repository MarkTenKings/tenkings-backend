import { createHash, timingSafeEqual } from "node:crypto";
import { canonicalJson } from "@tenkings/vault-contracts";
import { parseSparkJson, SparkJsonNumber, sparkMoneyCents } from "./sparkJson";

/** Spark documents static configured callback headers, not a signed webhook. */
export class SparkWebhookError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
export type SparkStage = "SANDBOX" | "PRODUCTION";
export type SparkCallbackKind = "TRANSACTION" | "DECLINE" | "TIMEOUT";
export type SparkBinding = { stage?: SparkStage; paymentBindingDigest?: string; machineId: string; nayaxMachineId: string; terminalId: string; hwSerial: string; siteId: number; currency: "USD";
  callbackTerminalIdRepresentation: "HW_SERIAL" | "MACHINE_ID"; acquiringOnlyConfirmed: true;
  cardUidPolicy: "REJECT_AMBIGUOUS" | "ALLOW_CONFIRMED_ACQUIRING"; acquiringCardBrands: string[]; unsupportedCardBrands: string[] };
export type SparkObservation = {
  receiptId: string; stage?: SparkStage; paymentBindingDigest?: string; kind: SparkCallbackKind; sparkTransactionId: string;
  nayaxTransactionId: string | null; machineId: string; terminalId: string | null;
  hwSerial: string; siteId: number | null; amountCents: number | null;
  currency: string | null; currencySource: "CALLBACK" | "MACHINE_BINDING" | null; verdict: string | null; errorCode: number | null; machineAuTime: string | null;
  methodClassification: "ACQUIRING" | "AMBIGUOUS" | "UNSUPPORTED";
  methodProfileDigest: string;
  methodEvidence: { cardUidPresent: boolean; cardBrandClass: "SUPPORTED_ACQUIRING" | "UNSUPPORTED" | "ABSENT" | "UNKNOWN"; authCodePresent: boolean; rrnPresent: boolean };
};
export type SparkReceipt = { stage?: SparkStage; vaultMachineId: string; payloadDigest: string; observation: SparkObservation };
export const SPARK_CALLBACK_MAX_BYTES = 32 * 1024;
export const sparkUuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const safeIdentity = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,160}$/.test(value);
const canonicalInteger = (value: unknown): value is string => typeof value === "string" && /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
const hash = (value: string) => createHash("sha256").update(value).digest();

export function sparkStage(value: unknown = "SANDBOX"): SparkStage {
  if (value !== "SANDBOX" && value !== "PRODUCTION") throw new SparkWebhookError(400, "SPARK_STAGE_INVALID");
  return value;
}
export function sparkStageEnvironment(stage: SparkStage): string {
  return sparkStage(stage) === "PRODUCTION" ? "VAULT_NAYAX_SPARK_PRODUCTION_" : "VAULT_NAYAX_SPARK_";
}
export function requireSparkStage(env: NodeJS.ProcessEnv, stage: SparkStage = "SANDBOX"): void {
  const prefix = sparkStageEnvironment(stage);
  if (env[`${prefix}CALLBACKS_ENABLED`] !== "true") throw new SparkWebhookError(503, "SPARK_CALLBACKS_DISABLED");
  if (env[`${prefix}ENVIRONMENT`] !== stage) throw new SparkWebhookError(503, stage === "SANDBOX" ? "SPARK_SANDBOX_REQUIRED" : "SPARK_PRODUCTION_REQUIRED");
}
export function requireSparkSandbox(env: NodeJS.ProcessEnv): void { requireSparkStage(env); }
export function authenticateSparkCallback(headers: Record<string, string | string[] | undefined>, env: NodeJS.ProcessEnv, stage: SparkStage = "SANDBOX"): void {
  requireSparkStage(env, stage);
  const prefix = sparkStageEnvironment(stage);
  const name = env[`${prefix}CALLBACK_HEADER`] ?? (stage === "SANDBOX" ? "x-vault-spark-secret" : "");
  const secret = env[`${prefix}CALLBACK_SECRET`] ?? "";
  if (!/^x-[a-z0-9-]{1,100}$/.test(name) || secret.length < 32 || secret.length > 512 || /[\r\n]/.test(secret)
    || stage === "PRODUCTION" && secret === env.VAULT_NAYAX_SPARK_CALLBACK_SECRET)
    throw new SparkWebhookError(503, "SPARK_CALLBACK_AUTH_UNCONFIGURED");
  const supplied = headers[name];
  if (typeof supplied !== "string" || supplied.length > 512 || !timingSafeEqual(hash(supplied), hash(secret))) throw new SparkWebhookError(401, "SPARK_CALLBACK_AUTH_INVALID");
}
export function configuredSparkBindings(env: NodeJS.ProcessEnv, stage: SparkStage = "SANDBOX"): SparkBinding[] {
  return sparkBindings(env[`${sparkStageEnvironment(stage)}BINDINGS_JSON`], stage);
}
export function sparkBindings(raw: string | undefined, stage: SparkStage = "SANDBOX"): SparkBinding[] {
  sparkStage(stage);
  let values: unknown;
  try { values = JSON.parse(raw ?? "[]"); } catch { throw new SparkWebhookError(503, "SPARK_BINDINGS_INVALID"); }
  if (!Array.isArray(values) || values.length === 0 || values.length > 1000) throw new SparkWebhookError(503, "SPARK_BINDINGS_INVALID");
  const machines = new Set(), terminals = new Set(), hardware = new Set(), external = new Set();
  return values.map(value => {
    const b = object(value);
    const brandList = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 100 && value.every(item => typeof item === "string" && item.length > 0 && item.length <= 100) && new Set(value).size === value.length;
    if (stage === "PRODUCTION" ? b.stage !== "PRODUCTION" || typeof b.paymentBindingDigest !== "string" || !/^[a-f0-9]{64}$/.test(b.paymentBindingDigest)
      : b.stage != null && b.stage !== "SANDBOX" || b.paymentBindingDigest != null) throw new SparkWebhookError(503, "SPARK_BINDINGS_STAGE_INVALID");
    if (!sparkUuid(b.machineId) || !canonicalInteger(b.nayaxMachineId) || !safeIdentity(b.terminalId) || !safeIdentity(b.hwSerial) || !Number.isSafeInteger(b.siteId) || Number(b.siteId) < 1 || Number(b.siteId) > 32767 || b.currency !== "USD"
      || !["HW_SERIAL", "MACHINE_ID"].includes(String(b.callbackTerminalIdRepresentation)) || b.acquiringOnlyConfirmed !== true
      || !["REJECT_AMBIGUOUS", "ALLOW_CONFIRMED_ACQUIRING"].includes(String(b.cardUidPolicy)) || !brandList(b.acquiringCardBrands) || !brandList(b.unsupportedCardBrands)
      || b.acquiringCardBrands.some(brand => (b.unsupportedCardBrands as string[]).includes(brand))) throw new SparkWebhookError(503, "SPARK_BINDINGS_INVALID");
    const machineId = b.machineId.toLowerCase();
    if (machines.has(machineId) || terminals.has(b.terminalId) || hardware.has(b.hwSerial) || external.has(b.nayaxMachineId)) throw new SparkWebhookError(503, "SPARK_BINDINGS_INVALID");
    machines.add(machineId); terminals.add(b.terminalId); hardware.add(b.hwSerial); external.add(b.nayaxMachineId);
    return { ...(stage === "PRODUCTION" ? { stage, paymentBindingDigest: b.paymentBindingDigest as string } : {}), machineId, nayaxMachineId: b.nayaxMachineId, terminalId: b.terminalId, hwSerial: b.hwSerial, siteId: b.siteId as number, currency: "USD",
      callbackTerminalIdRepresentation: b.callbackTerminalIdRepresentation as SparkBinding["callbackTerminalIdRepresentation"], acquiringOnlyConfirmed: true,
      cardUidPolicy: b.cardUidPolicy as SparkBinding["cardUidPolicy"], acquiringCardBrands: b.acquiringCardBrands, unsupportedCardBrands: b.unsupportedCardBrands };
  });
}
export async function readSparkBody(stream: AsyncIterable<unknown>): Promise<Buffer> {
  const chunks: Buffer[] = []; let length = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    length += bytes.length;
    if (length > SPARK_CALLBACK_MAX_BYTES) throw new SparkWebhookError(413, "SPARK_BODY_TOO_LARGE");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}
function externalInteger(value: unknown): string {
  if (!(value instanceof SparkJsonNumber) || !canonicalInteger(value.raw)) throw new SparkWebhookError(422, "SPARK_PROVIDER_ID_INVALID");
  return value.raw;
}
function amountCents(value: unknown): number {
  const cents = sparkMoneyCents(value);
  if (cents === null) throw new SparkWebhookError(422, "SPARK_AMOUNT_INVALID");
  return cents;
}
function safeInteger(value: unknown): number | null {
  if (!(value instanceof SparkJsonNumber) || !/^-?(0|[1-9][0-9]*)$/.test(value.raw)) return null;
  const number = Number(value.raw);
  return Number.isSafeInteger(number) ? number : null;
}

/** Retain only protocol evidence. Never store card data, raw bodies or error text. */
export function buildSparkReceipt(body: Buffer, kind: SparkCallbackKind, bindings: SparkBinding[], stage: SparkStage = "SANDBOX"): SparkReceipt {
  sparkStage(stage);
  if (bindings.some(b => stage === "PRODUCTION" ? b.stage !== "PRODUCTION" || !/^[a-f0-9]{64}$/.test(b.paymentBindingDigest ?? "") : b.stage != null && b.stage !== "SANDBOX" || b.paymentBindingDigest != null))
    throw new SparkWebhookError(503, "SPARK_BINDINGS_STAGE_INVALID");
  if (body.length > SPARK_CALLBACK_MAX_BYTES) throw new SparkWebhookError(413, "SPARK_BODY_TOO_LARGE");
  let input: Record<string, unknown>;
  try { input = object(parseSparkJson(new TextDecoder("utf-8", { fatal: true }).decode(body))); }
  catch { throw new SparkWebhookError(400, "SPARK_BODY_INVALID"); }
  if (!sparkUuid(input.SparkTransactionId)) throw new SparkWebhookError(422, "SPARK_SESSION_INVALID");
  const machineId = externalInteger(input.MachineId);
  const binding = bindings.find(candidate => candidate.nayaxMachineId === machineId);
  const expectedTerminal = binding?.callbackTerminalIdRepresentation === "MACHINE_ID" ? binding.nayaxMachineId : binding?.hwSerial;
  // The request's terminal type and callback's representation are separate
  // vendor-provisioned facts. Numeric JSON IDs are normalized losslessly.
  const terminalId = input.TerminalId instanceof SparkJsonNumber ? externalInteger(input.TerminalId) : input.TerminalId;
  if (!binding || input.HwSerial !== binding.hwSerial || kind !== "DECLINE" && terminalId !== expectedTerminal || terminalId != null && terminalId !== expectedTerminal || kind === "TRANSACTION" && safeInteger(input.SiteId) !== binding.siteId) throw new SparkWebhookError(422, "SPARK_DEVICE_BINDING_MISMATCH");
  const status = kind === "TRANSACTION" ? object(input.AuthStatus) : kind === "DECLINE" ? object(input.Status) : {};
  if (kind === "TRANSACTION" && !["Approved", "Declined"].includes(String(status.Verdict)) || kind === "DECLINE" && status.Verdict !== "Declined") throw new SparkWebhookError(422, "SPARK_VERDICT_INVALID");
  const errorCode = safeInteger(status.ErrorCode);
  if (status.ErrorCode != null && (errorCode === null || Math.abs(errorCode) > 2147483647)) throw new SparkWebhookError(422, "SPARK_ERROR_CODE_INVALID");
  const currencyNumeric = input.CurrencyNumeric instanceof SparkJsonNumber ? input.CurrencyNumeric.raw : input.CurrencyNumeric;
  if (input.CurrencyCode != null && input.CurrencyCode !== "USD" || currencyNumeric != null && currencyNumeric !== "840") throw new SparkWebhookError(422, "SPARK_CURRENCY_INVALID");
  if ((kind === "TRANSACTION" || input.MachineAuTime != null) && (typeof input.MachineAuTime !== "string" || !/^\d{17}$/.test(input.MachineAuTime))) throw new SparkWebhookError(422, "SPARK_AUTH_TIME_INVALID");
  const present = (value: unknown) => value !== null && value !== undefined && value !== "";
  const brand = input.CardBrand;
  const cardBrandClass = !present(brand) ? "ABSENT" as const : typeof brand === "string" && binding.unsupportedCardBrands.includes(brand) ? "UNSUPPORTED" as const
    : typeof brand === "string" && binding.acquiringCardBrands.includes(brand) ? "SUPPORTED_ACQUIRING" as const : "UNKNOWN" as const;
  const methodEvidence = { cardUidPresent: present(input.CardUid), cardBrandClass, authCodePresent: present(input.AuthCode), rrnPresent: present(input.NayaxRRN) };
  // DeclineCallback has no acquisition evidence: keep that ambiguity truthful.
  // Its documented no-authorization outcome is interpreted separately by the machine.
  const methodClassification = cardBrandClass === "UNSUPPORTED" ? "UNSUPPORTED" as const
    : kind !== "TRANSACTION" || binding.acquiringOnlyConfirmed !== true || cardBrandClass === "UNKNOWN" || methodEvidence.cardUidPresent && binding.cardUidPolicy !== "ALLOW_CONFIRMED_ACQUIRING" ? "AMBIGUOUS" as const : "ACQUIRING" as const;
  const normalized = {
    ...(stage === "PRODUCTION" ? { stage, paymentBindingDigest: binding.paymentBindingDigest! } : {}),
    kind, sparkTransactionId: input.SparkTransactionId.toLowerCase(),
    nayaxTransactionId: kind === "TRANSACTION" ? externalInteger(input.NayaxTransactionId) : null,
    machineId, terminalId: typeof terminalId === "string" ? terminalId : null,
    hwSerial: binding.hwSerial, siteId: kind === "TRANSACTION" ? binding.siteId : null,
    amountCents: kind === "TRANSACTION" && (status.Verdict === "Approved" || input.Amount != null) ? amountCents(input.Amount) : null,
    // USD machine binding is explicit onboarding configuration, never a default.
    currency: kind === "TRANSACTION" ? binding.currency : null,
    currencySource: kind !== "TRANSACTION" ? null : input.CurrencyCode === "USD" ? "CALLBACK" as const : "MACHINE_BINDING" as const,
    verdict: typeof status.Verdict === "string" ? status.Verdict : null,
    errorCode,
    machineAuTime: typeof input.MachineAuTime === "string" ? input.MachineAuTime : null,
    methodClassification, methodEvidence,
    methodProfileDigest: createHash("sha256").update(canonicalJson({ acquiringCardBrands: binding.acquiringCardBrands, acquiringOnlyConfirmed: binding.acquiringOnlyConfirmed,
      callbackTerminalIdRepresentation: binding.callbackTerminalIdRepresentation, cardUidPolicy: binding.cardUidPolicy, unsupportedCardBrands: binding.unsupportedCardBrands })).digest("hex"),
  };
  const payloadDigest = createHash("sha256").update(JSON.stringify({ vaultMachineId: binding.machineId, ...normalized })).digest("hex");
  return { ...(stage === "PRODUCTION" ? { stage } : {}), vaultMachineId: binding.machineId, payloadDigest, observation: { receiptId: `spark-${stage.toLowerCase()}:` + payloadDigest, ...normalized } };
}
