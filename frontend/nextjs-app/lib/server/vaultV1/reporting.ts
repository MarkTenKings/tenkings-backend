import { z } from "zod";

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "A real calendar date is required");

export const VaultSalesQuerySchema = z.object({
  machineId: z.string().uuid().optional(),
  productId: z.string().min(1).max(256).optional(),
  from: localDate.optional(),
  through: localDate.optional(),
  includeCertification: z.enum(["true", "false"]).default("false"),
  cursor: z.string().uuid().optional(),
  provider: z.enum(["NAYAX_SPARK", "STRIPE_TERMINAL", "SIMULATED"]).optional(),
}).refine((input) => !input.from || !input.through || input.from <= input.through, "Date range is reversed");

export function machineLocalDate(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function vaultMachineDto<T extends { lastEventSequence: bigint; lastHeartbeatAt: Date | null; lastCloudObservedAt: Date | null; health: string; serviceLocked: boolean; status: string }>(machine: T, now = Date.now()) {
  const lastSeen = machine.lastCloudObservedAt?.getTime();
  const online = lastSeen !== undefined && now >= lastSeen && now - lastSeen <= 120_000;
  const salesReady = online && machine.health === "READY" && !machine.serviceLocked && !["DISABLED", "DECOMMISSIONED"].includes(machine.status);
  return { ...machine, lastEventSequence: machine.lastEventSequence.toString(), online, salesReady };
}

export function salesTotals(sales: Array<{ authorizationObservedAt: Date | null; settlementState: string; totalCents: number; taxCents: number;
  paymentAction?: { state: string } | null; paymentAnomalies?: Array<{ resolvedAt: Date | null }> }>) {
  return sales.reduce((sum, sale) => {
    const settled = sale.settlementState === "SETTLED";
    // Only the independently confirmed full-sale provider outcome adjusts money.
    // Free-text manual support annotations never enter verified net totals.
    const voided = settled && sale.paymentAction?.state === "VOIDED";
    return {
    authorizedCents: sum.authorizedCents + (sale.authorizationObservedAt ? sale.totalCents : 0),
    settledCents: sum.settledCents + (settled ? sale.totalCents : 0),
    taxCents: sum.taxCents + (settled ? sale.taxCents : 0),
    confirmedVoidCents: sum.confirmedVoidCents + (voided ? sale.totalCents : 0),
    netSettledCents: sum.netSettledCents + (settled && !voided ? sale.totalCents : 0),
    netTaxCents: sum.netTaxCents + (settled && !voided ? sale.taxCents : 0),
    unresolvedFinancialCount: sum.unresolvedFinancialCount + ((sale.paymentAnomalies ?? []).filter(notice => !notice.resolvedAt).length) + (sale.paymentAction?.state === "UNKNOWN" ? 1 : 0),
  }; }, { authorizedCents: 0, settledCents: 0, taxCents: 0, confirmedVoidCents: 0, netSettledCents: 0, netTaxCents: 0, unresolvedFinancialCount: 0 });
}
