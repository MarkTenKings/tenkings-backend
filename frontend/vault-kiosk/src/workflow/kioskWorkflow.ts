import { calculateTaxCents, roleMay, type VaultPermission } from "@tenkings/vault-contracts/browser";
import type {
  KioskCartLine,
  KioskProviderLimits,
  KioskSaleSummary,
  KioskSupportConfig,
  VaultDoorId,
  VaultPublicState,
  VaultRole,
} from "../types";

export const VIEWPORT_TEST_CASES = Object.freeze([
  { width: 720, height: 1280, scale: 1 },
  { width: 768, height: 1366, scale: 1.25 },
  { width: 864, height: 1536, scale: 1.5 },
  { width: 1080, height: 1920, scale: 1 },
]);

export function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export function calculateCartTotals(cart: readonly KioskCartLine[], taxRateBasisPoints: number | null) {
  const subtotalCents = cart.reduce((sum, line) => sum + line.priceCents, 0);
  // Display uses the shared contract; the local service still revalidates and persists the
  // authoritative signed tax snapshot before payment.
  const taxCents = taxRateBasisPoints === null ? null : calculateTaxCents(subtotalCents, taxRateBasisPoints);
  return { subtotalCents, taxCents, totalCents: taxCents === null ? null : subtotalCents + taxCents };
}

export type ProviderLimitViolation = "ITEM_LIMIT" | "TOTAL_LIMIT" | null;

export function providerLimitViolation(
  cart: readonly KioskCartLine[],
  totalCents: number | null,
  limits: KioskProviderLimits | null,
): ProviderLimitViolation {
  if (!limits) return null;
  if (cart.length > limits.maxItems) return "ITEM_LIMIT";
  if (totalCents !== null && totalCents > limits.maxTotalCents) return "TOTAL_LIMIT";
  return null;
}

export function preserveCartConflicts(cart: readonly KioskCartLine[], conflictingDoors: readonly string[]): KioskCartLine[] {
  const conflicts = new Set(conflictingDoors);
  return cart.map((line) => ({ ...line, conflict: conflicts.has(line.doorId) }));
}

const UNPAID_IDLE_STATES: ReadonlySet<VaultPublicState> = new Set([
  "ATTRACT", "SHOPPING_EMPTY", "SHOPPING_WITH_CART", "PRODUCT_SOLD_OUT",
  "ALL_PRODUCTS_SOLD_OUT", "RESERVATION_CONFLICT", "PROVIDER_LIMIT_EXCEEDED", "IDLE_WARNING",
]);

export function mayIdleTimeout(state: VaultPublicState): boolean {
  return UNPAID_IDLE_STATES.has(state);
}

export function mayShowOpenDoors(state: VaultPublicState, sale: KioskSaleSummary | null): boolean {
  return (state === "GROUP_RETRY_AVAILABLE" || state === "PAID_RESET_COUNTDOWN")
    && Boolean(sale?.retryAvailable)
    && !sale?.retryUsed;
}

export function createSupportUrl(
  config: KioskSupportConfig,
  supportReference: string,
  doorIds: readonly VaultDoorId[],
): string {
  const url = new URL(config.pageUrl);
  url.searchParams.set("ref", supportReference);
  url.searchParams.set("doors", doorIds.join(","));
  return url.toString();
}

export interface StaffOperation {
  permission: VaultPermission;
  label: string;
  description: string;
}

const STAFF_OPERATIONS: readonly StaffOperation[] = [
  { permission: "RESTOCK_RUN", label: "Restock doors", description: "Resume or start the assigned per-door restock workflow." },
  { permission: "DIAGNOSTICS_VIEW", label: "Machine health", description: "View redacted local health and readiness evidence." },
  { permission: "DOOR_TEST", label: "Door diagnostics", description: "Enter supervised test mode; never a public or remote unlock." },
  { permission: "SOFTWARE_RECOVERY", label: "Software recovery", description: "Review local recovery steps without changing credentials." },
  { permission: "CERTIFICATION_COLLECT", label: "Certification", description: "Collect immutable TEST MODE evidence on approved adapters." },
  { permission: "FINANCIAL_RESOLVE", label: "Financial review", description: "Review reconciliation cases; no automatic customer remedy." },
  { permission: "ENROLLMENT_MANAGE", label: "Enrollment and keys", description: "Admin-only credential lifecycle and installer authorization." },
  { permission: "CONFIG_PUBLISH", label: "Configuration", description: "Admin-only signed configuration publication." },
];

export function staffOperationsForRole(role: VaultRole): StaffOperation[] {
  return STAFF_OPERATIONS.filter((operation) => roleMay(role, operation.permission));
}
