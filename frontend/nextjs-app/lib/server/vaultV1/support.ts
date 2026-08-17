import { z } from "zod";

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
      mappingVersionSnapshot: item.mappingVersionSnapshot,
      taxRateBasisPoints: item.taxRateBasisPoints,
      taxCentsSnapshot: item.taxCentsSnapshot,
      allocationState: item.allocationState,
      fulfillmentState: item.fulfillmentState,
      initialCommandState: item.initialCommandState,
      retryCommandState: item.retryCommandState,
      retryUsedAt: item.retryUsedAt,
    })),
  };
}

export function vaultSupportCaseAdminDto(supportCase: Record<string, unknown>) {
  const financial = supportCase.financialResolution === null || supportCase.financialResolution === undefined
    ? null
    : VaultFinancialResolutionSchema.safeParse(supportCase.financialResolution);
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
