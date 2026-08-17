import { z } from "zod";
import { VaultDoorIdSchema } from "./doors";

export const VaultModeSchema = z.enum(["PRODUCTION", "CERTIFICATION"]);
export type VaultMode = z.infer<typeof VaultModeSchema>;
export const VaultRoleSchema = z.enum(["RESTOCKER", "TECHNICIAN", "ADMIN"]);
export type VaultRole = z.infer<typeof VaultRoleSchema>;
export const VaultProductCategorySchema = z.enum(["SPORTS", "POKEMON"]);
export const VAULT_ALLOWED_PRICE_CENTS = [2500, 5000, 10000, 25000] as const;

export const VaultDoorStateSchema = z.enum([
  "EMPTY",
  "AVAILABLE",
  "RESERVED",
  "COMMITTED_SOLD",
  "SERVICE_HOLD",
  "DISABLED",
  "EXCEPTION",
]);
export type VaultDoorState = z.infer<typeof VaultDoorStateSchema>;

export const VaultPaymentStateSchema = z.enum([
  "NOT_REQUESTED",
  "REQUESTED",
  "AUTHORIZED",
  "DECLINED",
  "CANCELLED",
  "UNKNOWN",
  "VEND_RESULT_PENDING",
  "SETTLEMENT_PENDING",
  "SETTLED",
  "RECONCILIATION_REQUIRED",
]);
export type VaultPaymentState = z.infer<typeof VaultPaymentStateSchema>;

export const VaultCommandStateSchema = z.enum([
  "NOT_COMMITTED",
  "COMMAND_INTENT_RECORDED",
  "ACCEPTED",
  "SENT_UNKNOWN",
  "REJECTED",
  "TIMEOUT",
  "OUTPUT_RELEASED",
]);
export type VaultCommandState = z.infer<typeof VaultCommandStateSchema>;

export const VaultSaleStateSchema = z.enum([
  "CART_ACTIVE",
  "CHECKOUT_REVALIDATING",
  "RESERVED",
  "PAYMENT_REQUESTED",
  "PAYMENT_AUTHORIZED",
  "FULFILLMENT_COMMITTED",
  "OPEN_COMMAND_PENDING",
  "OPEN_COMMAND_TERMINAL",
  "VEND_RESULT_PENDING",
  "SETTLEMENT_PENDING",
  "SETTLED",
  "COMPLETED",
  "PAYMENT_DECLINED",
  "PAYMENT_CANCELLED",
  "PAYMENT_UNKNOWN",
  "RECONCILIATION_REQUIRED",
  "SUPPORT_REQUIRED",
]);
export type VaultSaleState = z.infer<typeof VaultSaleStateSchema>;

export const VaultRestockItemStateSchema = z.enum(["UNREVIEWED", "FILLED", "LEFT_EMPTY", "EXCEPTION"]);
export type VaultRestockItemState = z.infer<typeof VaultRestockItemStateSchema>;
export const VaultHealthStateSchema = z.enum([
  "READY",
  "DEGRADED_CLOUD",
  "DEGRADED_SYNC",
  "BLOCKED_CONFIG",
  "BLOCKED_TAX",
  "BLOCKED_NAYAX",
  "BLOCKED_CONTROLLER",
  "BLOCKED_STORAGE",
  "BLOCKED_CLOCK",
  "SERVICE_LOCKED",
  "RECOVERY_REQUIRED",
]);
export type VaultHealthState = z.infer<typeof VaultHealthStateSchema>;

export const VaultPublicStateSchema = z.enum([
  "BOOTING", "UPDATING", "NO_VALID_CACHED_CONFIG", "CLOSED", "MAINTENANCE", "ATTRACT",
  "SHOPPING_EMPTY", "SHOPPING_WITH_CART", "PRODUCT_SOLD_OUT", "ALL_PRODUCTS_SOLD_OUT",
  "RESERVATION_CONFLICT", "CHECKOUT_REVALIDATING", "PROVIDER_LIMIT_EXCEEDED",
  "CONTROLLER_NOT_READY", "NAYAX_UNAVAILABLE", "PAYMENT_STARTING", "PAYMENT_PENDING",
  "PAYMENT_DECLINED", "PAYMENT_CANCELLED", "PAYMENT_UNKNOWN", "PAYMENT_APPROVED_DURABLE",
  "UNLOCK_QUEUED", "RETRIEVAL", "GROUP_RETRY_AVAILABLE", "GROUP_RETRY_COMMITTED",
  "GROUP_RETRY_USED", "SUPPORT_REQUIRED", "PAID_RESET_COUNTDOWN", "IDLE_WARNING",
  "RESETTING", "SERVICE_ENTRY", "SERVICE_LOCKED",
]);

const SALE_TRANSITIONS: Readonly<Record<VaultSaleState, readonly VaultSaleState[]>> = {
  CART_ACTIVE: ["CHECKOUT_REVALIDATING"],
  CHECKOUT_REVALIDATING: ["CART_ACTIVE", "RESERVED"],
  RESERVED: ["PAYMENT_REQUESTED", "PAYMENT_CANCELLED"],
  PAYMENT_REQUESTED: ["PAYMENT_AUTHORIZED", "PAYMENT_DECLINED", "PAYMENT_CANCELLED", "PAYMENT_UNKNOWN"],
  PAYMENT_AUTHORIZED: ["FULFILLMENT_COMMITTED"],
  FULFILLMENT_COMMITTED: ["OPEN_COMMAND_PENDING"],
  OPEN_COMMAND_PENDING: ["OPEN_COMMAND_TERMINAL", "SUPPORT_REQUIRED"],
  OPEN_COMMAND_TERMINAL: ["VEND_RESULT_PENDING", "SUPPORT_REQUIRED"],
  VEND_RESULT_PENDING: ["SETTLEMENT_PENDING", "RECONCILIATION_REQUIRED", "SUPPORT_REQUIRED"],
  SETTLEMENT_PENDING: ["SETTLED", "RECONCILIATION_REQUIRED"],
  SETTLED: ["COMPLETED", "SUPPORT_REQUIRED"],
  COMPLETED: [], PAYMENT_DECLINED: [], PAYMENT_CANCELLED: [],
  PAYMENT_UNKNOWN: ["PAYMENT_AUTHORIZED", "PAYMENT_DECLINED", "PAYMENT_CANCELLED", "RECONCILIATION_REQUIRED"],
  RECONCILIATION_REQUIRED: ["PAYMENT_AUTHORIZED", "PAYMENT_DECLINED", "PAYMENT_CANCELLED", "SETTLED", "SUPPORT_REQUIRED"],
  SUPPORT_REQUIRED: ["SETTLED", "COMPLETED"],
};

export function mayTransitionSale(from: VaultSaleState, to: VaultSaleState): boolean {
  return SALE_TRANSITIONS[from].includes(to);
}

export const VaultPermissionSchema = z.enum([
  "RESTOCK_RUN", "SERVICE_LOCK", "DIAGNOSTICS_VIEW", "DOOR_TEST", "SOFTWARE_RECOVERY",
  "CERTIFICATION_COLLECT", "CERTIFICATION_APPROVE", "PRODUCT_MANAGE", "TAX_MANAGE",
  "SUPPORT_CONFIG_MANAGE", "DOOR_PLAN_MANAGE", "STAFF_MANAGE", "FINANCIAL_RESOLVE",
  "ENROLLMENT_MANAGE", "CONFIG_PUBLISH",
]);
export type VaultPermission = z.infer<typeof VaultPermissionSchema>;

const ROLE_PERMISSIONS: Record<VaultRole, ReadonlySet<VaultPermission>> = {
  RESTOCKER: new Set(["RESTOCK_RUN"]),
  TECHNICIAN: new Set(["RESTOCK_RUN", "SERVICE_LOCK", "DIAGNOSTICS_VIEW", "DOOR_TEST", "SOFTWARE_RECOVERY", "CERTIFICATION_COLLECT", "CERTIFICATION_APPROVE"]),
  ADMIN: new Set(VaultPermissionSchema.options),
};

export function roleMay(role: VaultRole, permission: VaultPermission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export const VaultSaleItemSnapshotSchema = z.object({
  lineId: z.string().uuid(),
  doorId: VaultDoorIdSchema,
  productId: z.string().min(1).max(128),
  productName: z.string().min(1).max(120),
  photoUrl: z.string().url().max(2048),
  description: z.string().max(1000),
  category: VaultProductCategorySchema,
  priceCents: z.number().int().refine((value) => (VAULT_ALLOWED_PRICE_CENTS as readonly number[]).includes(value)),
  taxClass: z.string().min(1).max(64),
});
