import { z } from "zod";
import { vaultPaymentActionAdminDto } from "./paymentActions";

export const VaultFinancialResolutionSchema = z.object({
  resolutionType: z.enum(["NO_EXTERNAL_ACTION", "REFUND_RECORDED", "VOID_RECORDED", "MANUAL_REVIEW_RECORDED"]),
  amountCents: z.number().int().nonnegative().max(100_000_000).nullable(),
  currency: z.literal("USD"),
  note: z.string().trim().min(1).max(1000),
  recordedAt: z.string().datetime(),
}).strict();

export type VaultFinancialResolution = z.infer<typeof VaultFinancialResolutionSchema>;

type SaleWithItems = Record<string, unknown> & { items?: Array<Record<string, unknown>> };

export function vaultSaleAdminDto(sale: SaleWithItems) {
  return {
    id: sale.id,
    machineId: sale.machineId,
    localTransactionId: sale.localTransactionId,
    supportReference: sale.supportReference,
    mode: sale.mode,
    state: sale.state,
    paymentState: sale.paymentState,
    paymentProvider: ["NAYAX_SPARK", "STRIPE_TERMINAL", "SIMULATED"].includes(String(sale.providerName)) ? sale.providerName : null,
    paymentAction: sale.paymentAction ? vaultPaymentActionAdminDto(sale.paymentAction as Record<string, unknown>) : null,
    financialAnomalies: Array.isArray(sale.paymentAnomalies) ? sale.paymentAnomalies.map((notice: Record<string, unknown>) => ({ noticeId: notice.noticeId, code: notice.code, amountCents: notice.amountCents, currency: notice.currency, captureConfirmed: notice.captureConfirmed, occurredAt: notice.occurredAt, resolvedAt: notice.resolvedAt })) : [],
    settlementState: sale.settlementState,
    fulfillmentState: sale.fulfillmentState,
    configVersionNumber: sale.configVersionNumber,
    configDigest: sale.configDigest,
    taxCity: sale.taxCity,
    taxState: sale.taxState,
    taxRateBasisPoints: sale.taxRateBasisPoints,
    subtotalCents: sale.subtotalCents,
    taxCents: sale.taxCents,
    totalCents: sale.totalCents,
    currency: sale.currency,
    itemCount: sale.itemCount,
    authorizationObservedAt: sale.authorizationObservedAt,
    settlementObservedAt: sale.settlementObservedAt,
    reconciliationRequiredAt: sale.reconciliationRequiredAt,
    reconciliationResolvedAt: sale.reconciliationResolvedAt,
    groupRetryConsumedAt: sale.groupRetryConsumedAt,
    customerDoneAt: sale.customerDoneAt,
    createdAt: sale.createdAt,
    updatedAt: sale.updatedAt,
    machine: sale.machine,
    items: (sale.items ?? []).map((item) => ({
      id: item.id,
      lineId: item.lineId,
      doorId: item.doorId,
      productIdSnapshot: item.productIdSnapshot,
      productNameSnapshot: item.productNameSnapshot,
      photoUrlSnapshot: item.photoUrlSnapshot,
      descriptionSnapshot: item.descriptionSnapshot,
      categorySnapshot: item.categorySnapshot,
      priceCentsSnapshot: item.priceCentsSnapshot,
      taxClassSnapshot: item.taxClassSnapshot,
      controllerChannelSnapshot: item.controllerChannelSnapshot,
      controllerEndpointIdSnapshot: item.controllerEndpointIdSnapshot,
      doorLabelSnapshot: item.doorLabelSnapshot,
      mappingVersionSnapshot: item.mappingVersionSnapshot,
      taxRateBasisPoints: item.taxRateBasisPoints,
      taxCentsSnapshot: item.taxCentsSnapshot,
      allocationState: item.allocationState,
      fulfillmentState: item.fulfillmentState,
      initialCommandState: item.initialCommandState,
      initialCommandTerminalAt: item.initialCommandTerminalAt,
      retryCommandState: item.retryCommandState,
      retryCommandTerminalAt: item.retryCommandTerminalAt,
      retryUsedAt: item.retryUsedAt,
    })),
  };
}

export function vaultSupportCaseAdminDto(supportCase: Record<string, unknown>) {
  const financial = supportCase.financialResolution === null || supportCase.financialResolution === undefined
    ? null
    : VaultFinancialResolutionSchema.safeParse(supportCase.financialResolution);
  const evidence = z.object({ noticeId: z.string().min(1).max(256), provider: z.enum(["NAYAX_SPARK", "STRIPE_TERMINAL"]), amountCents: z.number().int().positive().nullable(), currency: z.literal("USD"), captureConfirmed: z.boolean(), code: z.string().regex(/^[A-Z0-9_]{1,120}$/) }).strict().safeParse(supportCase.reconciliationSnapshot);
  return {
    id: supportCase.id,
    machineId: supportCase.machineId,
    saleId: supportCase.saleId,
    shortReference: supportCase.shortReference,
    type: supportCase.type,
    status: supportCase.status,
    affectedDoorIds: supportCase.affectedDoorIds,
    customerSafeSummary: supportCase.customerSafeSummary,
    financialResolution: financial && financial.success ? financial.data : null,
    financialEvidence: evidence.success ? evidence.data : null,
    financialResolutionEvidenceValid: financial === null ? null : financial.success,
    openedAt: supportCase.openedAt,
    assignedAdminId: supportCase.assignedAdminId,
    resolvedByAdminId: supportCase.resolvedByAdminId,
    resolvedAt: supportCase.resolvedAt,
    closedAt: supportCase.closedAt,
    resolutionReason: supportCase.resolutionReason,
    createdAt: supportCase.createdAt,
    updatedAt: supportCase.updatedAt,
    machine: supportCase.machine,
    sale: supportCase.sale ? vaultSaleAdminDto(supportCase.sale as SaleWithItems) : null,
  };
}
