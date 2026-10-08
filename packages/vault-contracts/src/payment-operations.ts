import { z } from "zod";
import type { VaultPaymentState } from "./domain";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const reference = z.string().regex(/^sha256:[a-f0-9]{64}$/);

/** A fresh human cloud approval, delivered over the authenticated machine channel.
 * It authorizes exactly one full paid-sale void, never a door or stock operation. */
export const VaultPaymentVoidActionSchema = z.object({
  actionId: z.string().uuid(),
  machineId: z.string().uuid(),
  saleId: z.string().uuid(),
  provider: z.literal("NAYAX_SPARK"),
  paymentBindingDigest: digest,
  providerSessionReference: reference,
  providerTransactionReference: reference,
  amountCents: z.number().int().positive().max(99_999_999),
  currency: z.literal("USD"),
  reason: z.string().trim().min(8).max(500),
  approvedByAdminId: z.string().min(1).max(256),
  reviewedNoticeIds: z.array(z.string().min(1).max(256)).max(100).default([]).refine(ids => new Set(ids).size === ids.length, "Reviewed notice IDs must be unique"),
  approvedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
}).strict().refine(value => {
  const lifetime = Date.parse(value.expiresAt) - Date.parse(value.approvedAt);
  return lifetime > 0 && lifetime <= 5 * 60_000;
}, "Financial approval must expire within five minutes");
export type VaultPaymentVoidAction = z.infer<typeof VaultPaymentVoidActionSchema>;

export interface PaymentVoidRequest {
  actionId: string;
  saleId: string;
  providerSessionId: string;
  providerTransactionId: string;
  bindingDigest: string;
  amountCents: number;
  currency: "USD";
  reason: string;
}

export interface PaymentVoidResult {
  actionId: string;
  state: "VOIDED" | "DECLINED" | "UNKNOWN";
  providerSessionId: string;
  providerTransactionId: string;
  amountCents: number;
  currency: "USD";
  evidenceReference: string;
  errorCode?: number;
}

/** Safe evidence emitted by a bound provider adapter. Persist locally before ACK. */
export interface PaymentEvidenceNotice {
  noticeId: string;
  saleId: string | null;
  provider: "NAYAX_SPARK";
  bindingDigest: string;
  providerSessionId: string | null;
  providerTransactionId: string | null;
  amountCents: number | null;
  currency: "USD";
  captureConfirmed: boolean;
  code: string;
}

export interface PaymentRecoverySnapshot {
  sales: ReadonlyArray<{
    saleId: string;
    requestKey: string | null;
    requestDigest: string | null;
    providerSessionId: string | null;
    providerTransactionId: string | null;
    bindingDigest: string;
    totalCents: number;
    currency: "USD";
    paymentState: VaultPaymentState;
    hasCommittedFulfillment: boolean;
  }>;
  voids: ReadonlyArray<{ actionId: string; saleId: string; state: "INTENT" | "VOIDED" | "DECLINED" | "UNKNOWN" }>;
}

const uniqueIds = z.array(z.string().min(1).max(256)).max(100).refine(ids => new Set(ids).size === ids.length, "Identifiers must be unique");
export const VaultFinancialRecoverySnapshotSchema = z.object({
  snapshotId: z.string().uuid(), machineId: z.string().uuid(), generation: z.number().int().positive(),
  paymentBindingDigest: digest, stateDigest: digest, providerEvidenceDigest: digest,
  noticeIds: uniqueIds, unknownActionIds: z.array(z.string().uuid()).max(100),
  blockers: z.array(z.string().regex(/^[A-Z0-9_]{1,120}$/)).max(100),
  observedAt: z.string().datetime(),
}).strict();
export type VaultFinancialRecoverySnapshot = z.infer<typeof VaultFinancialRecoverySnapshotSchema>;
export const VaultFinancialRecoveryDecisionSchema = z.object({
  decisionId: z.string().uuid(), machineId: z.string().uuid(), snapshotId: z.string().uuid(), generation: z.number().int().positive(), stateDigest: digest,
  noticeIds: uniqueIds, unknownActionIds: z.array(z.string().uuid()).max(100).refine(ids => new Set(ids).size === ids.length),
  evidenceReference: z.string().trim().min(8).max(256), evidenceDigest: digest,
  reason: z.string().trim().min(8).max(500), approvedByAdminId: z.string().min(1).max(256),
  approvedAt: z.string().datetime(), expiresAt: z.string().datetime(),
}).strict().refine(value => { const life = Date.parse(value.expiresAt) - Date.parse(value.approvedAt); return life > 0 && life <= 300000; }, "Recovery approval expires within five minutes");
export type VaultFinancialRecoveryDecision = z.infer<typeof VaultFinancialRecoveryDecisionSchema>;
export const VaultFinancialRecoveryAppliedSchema = z.object({
  decisionId: z.string().uuid(), snapshotId: z.string().uuid(), stateDigest: digest, generation: z.number().int().positive(),
  noticeIds: uniqueIds, unknownActionIds: z.array(z.string().uuid()).max(100),
  evidenceReference: z.string().min(8).max(256), evidenceDigest: digest,
  startedAt: z.string().datetime(),
  source: z.literal("EXTERNAL_HUMAN_REVIEW"), verifiedFinancialAdjustmentCents: z.literal(0),
}).strict();
export const VaultFinancialRecoverySupersededSchema = z.object({
  decisionId: z.string().uuid(), snapshotId: z.string().uuid(), stateDigest: digest, generation: z.number().int().positive(),
  currentSnapshotId: z.string().uuid(), currentStateDigest: digest, reason: z.literal("EVIDENCE_CHANGED"),
}).strict();
export const VaultPaymentVoidRetiredSchema = z.object({
  actionId: z.string().uuid(), saleId: z.string().uuid(), actionDigest: digest, paymentBindingDigest: digest,
  proofDigest: digest, expiresAt: z.string().datetime(), retiredAt: z.string().datetime(),
  mainIntentAbsent: z.literal(true), providerIntentAbsent: z.literal(true), providerTransportAbsent: z.literal(true),
}).strict();
export type PaymentProviderRecoveryEvidence = { bindingDigest: string; evidenceDigest: string; blockers: string[] };
export type PaymentVoidRetirement = { actionId: string; actionDigest: string; reason: "EXPIRED_UNSTARTED" | "EXTERNAL_REVIEW"; proofDigest: string };
