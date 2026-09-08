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

export function salesTotals(sales: Array<{ authorizationObservedAt: Date | null; settlementState: string; totalCents: number; taxCents: number }>) {
  return sales.reduce((sum, sale) => ({
    authorizedCents: sum.authorizedCents + (sale.authorizationObservedAt ? sale.totalCents : 0),
    settledCents: sum.settledCents + (sale.settlementState === "SETTLED" ? sale.totalCents : 0),
    taxCents: sum.taxCents + (sale.settlementState === "SETTLED" ? sale.taxCents : 0),
  }), { authorizedCents: 0, settledCents: 0, taxCents: 0 });
}
