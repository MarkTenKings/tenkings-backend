import { VaultPaymentVoidActionSchema, type VaultPaymentVoidAction } from "@tenkings/vault-contracts";
import type { prisma } from "@tenkings/database";
import { z } from "zod";
import { VaultApiError } from "./http";

export const VaultPaymentVoidApprovalSchema = z.object({
  actionId: z.string().uuid(), saleId: z.string().uuid(), amountCents: z.number().int().positive().max(99_999_999),
  reason: z.string().trim().min(8).max(500), confirmFullSaleVoid: z.literal(true),
}).strict();

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Human approval is a separate action, never inferred from support annotations. */
export function prepareVaultPaymentVoidAction(sale: Record<string, any>, input: z.infer<typeof VaultPaymentVoidApprovalSchema>, approvedByAdminId: string, now = new Date()): VaultPaymentVoidAction {
  const evidence = record(sale.providerEvidence);
  if (sale.providerName !== "NAYAX_SPARK" || sale.paymentState !== "SETTLED" || sale.settlementState !== "SETTLED" || evidence.captureConfirmed !== true
    || sale.totalCents !== input.amountCents || sale.currency !== "USD" || !sale.customerDoneAt
    || !Array.isArray(sale.items) || !sale.items.length || sale.items.some(item => !item.initialCommandTerminalAt || item.retryCommandId && !item.retryCommandTerminalAt)) {
    throw new VaultApiError(409, "PAID_VOID_SALE_NOT_ELIGIBLE", "A full Spark void requires the exact confirmed paid sale after customer presentation and command recovery.");
  }
  const notices: Array<{ noticeId: string; resolvedAt: unknown }> = [...(sale.paymentAnomalies ?? []), ...(sale.machineOrphanPaymentAnomalies ?? [])];
  if (sale.paymentAction || notices.some(notice => !notice.resolvedAt)) throw new VaultApiError(409, "PAID_VOID_REQUIRES_REVIEW", "An existing payment action or unresolved financial discrepancy requires review.");
  const reviewedNoticeIds = [...new Set(notices.map(notice => notice.noticeId))].sort();
  if (reviewedNoticeIds.length > 100) throw new VaultApiError(409, "PAID_VOID_REVIEW_LIMIT", "The financial review notice set exceeds the bounded approval contract.");
  if ((sale.supportCases ?? []).some((support: any) => ["REFUND_RECORDED", "VOID_RECORDED"].includes(String(record(support.financialResolution).resolutionType)))) {
    throw new VaultApiError(409, "PAID_VOID_PRIOR_COMPENSATION_RECORDED", "A prior manual refund or void record must be reconciled before another payment operation.");
  }
  const parsed = VaultPaymentVoidActionSchema.safeParse({ actionId: input.actionId, machineId: sale.machineId, saleId: sale.localTransactionId,
    provider: "NAYAX_SPARK", paymentBindingDigest: evidence.paymentBindingDigest,
    providerSessionReference: sale.providerSessionId, providerTransactionReference: sale.providerTransactionId,
    amountCents: input.amountCents, currency: "USD", reason: input.reason, approvedByAdminId,
    reviewedNoticeIds, approvedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString() });
  if (!parsed.success) throw new VaultApiError(409, "PAID_VOID_CAPTURE_BINDING_INCOMPLETE", "The original capture does not contain complete immutable payment evidence.");
  return parsed.data;
}

export async function vaultPaymentActionHints(db: Pick<typeof prisma, "vaultPaymentAction">, machineId: string, _now = new Date()) {
  // Expired approvals still reach their bound machine for durable no-intent proof.
  // External review stops replay without converting UNKNOWN into confirmed money.
  const rows = await db.vaultPaymentAction.findMany({ where: { machineId, externalReviewedAt: null, state: { in: ["APPROVED", "EXECUTING", "UNKNOWN"] } }, orderBy: [{ approvedAt: "asc" }, { id: "asc" }], take: 101 });
  if (rows.length > 100) throw new VaultApiError(409, "PAYMENT_ACTION_LIMIT_REVIEW_REQUIRED", "Payment action recovery requires review.");
  const actions = rows.map(row => {
    const action = VaultPaymentVoidActionSchema.parse(row.action);
    if (action.machineId !== machineId || action.actionId !== row.id) throw new VaultApiError(503, "PAYMENT_ACTION_BINDING_INVALID", "Stored payment action binding is invalid.");
    return action;
  });
  return { instruction: "APPROVED_PAYMENT_ACTIONS_ONLY" as const, actions };
}

export function vaultPaymentActionAdminDto(row: Record<string, any>) {
  const action = VaultPaymentVoidActionSchema.parse(row.action);
  return { actionId: row.id, machineId: row.machineId, saleId: row.saleId ?? row.originalSaleId, state: row.state, provider: action.provider,
    approvalExpired: row.state === "APPROVED" && Date.parse(action.expiresAt) <= Date.now(),
    amountCents: action.amountCents, currency: action.currency, reason: action.reason, approvedByAdminId: action.approvedByAdminId,
    approvedAt: action.approvedAt, expiresAt: action.expiresAt, intentObservedAt: row.intentObservedAt, outcomeObservedAt: row.outcomeObservedAt,
    evidenceReference: row.evidenceReference, errorCode: row.errorCode, retiredAt: row.retiredAt ?? null,
    retirementProof: row.retirementProof ?? null, externalReviewedAt: row.externalReviewedAt ?? null, externalReview: row.externalReview ?? null };
}
