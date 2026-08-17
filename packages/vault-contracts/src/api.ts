import { z } from "zod";
import { VaultDoorIdSchema } from "./doors";
import { VaultHealthStateSchema, VaultModeSchema, VaultPaymentStateSchema, VaultRoleSchema, VaultSaleItemSnapshotSchema } from "./domain";

export const VaultCheckoutRequestSchema = z.object({
  idempotencyKey: z.string().uuid(),
  mode: VaultModeSchema,
  configVersion: z.number().int().positive(),
  doorIds: z.array(VaultDoorIdSchema).min(1).max(150).refine((ids) => new Set(ids).size === ids.length),
});

export const VaultRetryRequestSchema = z.object({
  saleId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
});

export const VaultProviderCallbackSchema = z.object({
  callbackId: z.string().min(1).max(256),
  saleId: z.string().uuid(),
  providerSessionId: z.string().min(1).max(256),
  providerTransactionId: z.string().min(1).max(256).optional(),
  sequence: z.number().int().nonnegative(),
  state: VaultPaymentStateSchema,
  occurredAt: z.string().datetime(),
  evidence: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
});

export const VaultMachineEventSchema = z.object({
  eventId: z.string().uuid(),
  schemaVersion: z.literal(1),
  machineId: z.string().uuid(),
  sequence: z.number().int().positive(),
  type: z.string().min(1).max(120),
  mode: VaultModeSchema,
  correlationId: z.string().max(256).optional(),
  causationId: z.string().max(256).optional(),
  occurredAt: z.string().datetime(),
  payload: z.record(z.string(), z.unknown()),
});
export type VaultMachineEvent = z.infer<typeof VaultMachineEventSchema>;

export const VaultEventBatchSchema = z.object({
  contractVersion: z.literal(1),
  events: z.array(VaultMachineEventSchema).min(1).max(250),
});

export const VaultHeartbeatSchema = z.object({
  contractVersion: z.literal(1),
  appVersion: z.string().min(1).max(64),
  localSchemaVersion: z.number().int().nonnegative(),
  configVersion: z.number().int().positive().nullable(),
  configDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  health: VaultHealthStateSchema,
  readinessReasons: z.array(z.string().max(160)).max(32),
  availableDoorCount: z.number().int().min(0).max(150),
  outboxPendingCount: z.number().int().nonnegative(),
  serviceLocked: z.boolean(),
  observedAt: z.string().datetime(),
});

export const VaultStaffGrantSchema = z.object({
  grantId: z.string().uuid(),
  userId: z.string().min(1).max(128),
  machineId: z.string().uuid(),
  role: VaultRoleSchema,
  verifierVersion: z.number().int().positive(),
  verifier: z.string().min(32).max(1024),
  hashAlgorithm: z.enum(["scrypt", "argon2id"]),
  hashParameters: z.record(z.string(), z.number().int().positive()),
  validFrom: z.string().datetime(),
  expiresAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable(),
});

export const VaultSalePublicSchema = z.object({
  saleId: z.string().uuid(),
  supportReference: z.string().regex(/^[A-Z0-9]{6,12}$/),
  items: z.array(VaultSaleItemSnapshotSchema),
  subtotalCents: z.number().int().nonnegative(),
  taxCents: z.number().int().nonnegative(),
  totalCents: z.number().int().nonnegative(),
  paidDoorIds: z.array(VaultDoorIdSchema),
  retryAvailable: z.boolean(),
  retryUsed: z.boolean(),
});
