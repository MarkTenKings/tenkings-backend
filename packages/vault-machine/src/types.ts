import type {
  VaultConfigPayload,
  VaultDoorId,
  VaultDoorState,
  VaultMode,
  VaultPaymentState,
  VaultRole,
  VaultSaleState,
} from "../../vault-contracts/dist";

export type HealthState = "READY" | "DEGRADED_CLOUD" | "DEGRADED_SYNC" | "BLOCKED_CONFIG" | "BLOCKED_TAX" | "BLOCKED_NAYAX" | "BLOCKED_CONTROLLER" | "BLOCKED_STORAGE" | "BLOCKED_CLOCK" | "SERVICE_LOCKED" | "RECOVERY_REQUIRED";

export interface Clock {
  now(): Date;
  monotonicMs(): number;
}

export const systemClock: Clock = {
  now: () => new Date(),
  monotonicMs: () => Number(process.hrtime.bigint() / 1_000_000n),
};

export interface PublicDoor {
  doorId: VaultDoorId;
  controllerChannel: number;
  state: VaultDoorState;
  productId: string | null;
  plannedProductId: string | null;
  version: number;
}

export interface PublicCartLine {
  doorId: VaultDoorId;
  productId: string;
  productName: string;
  priceCents: number;
  selectedAt: string;
}

export interface PublicSale {
  saleId: string;
  supportReference: string;
  state: VaultSaleState;
  paymentState: VaultPaymentState;
  mode: VaultMode;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  items: Array<{ lineId: string; doorId: VaultDoorId; productId: string; productName: string; photoUrl: string; description: string; category: string; priceCents: number; taxClass: string }>;
  paidDoorIds: VaultDoorId[];
  retryAvailable: boolean;
  retryUsed: boolean;
  retrievalSeconds: number;
  retryExtensionSeconds: number;
  retrievalSecondsRemaining: number | null;
  resetSecondsRemaining: number | null;
  createdAt: string;
}

export interface PublicMachineState {
  stateVersion: number;
  sequence: number;
  mode: VaultMode;
  publicState: string;
  health: HealthState;
  readinessReasons: string[];
  configVersion: number | null;
  buildIdentity: { sourceCommit: string; appVersion: string };
  city: string | null;
  state: string | null;
  taxRateBasisPoints: number | null;
  products: VaultConfigPayload["products"];
  tax: null | { city: string; state: string; rateBasisPoints: number; calculationVersion: string };
  timers: null | { retrievalSeconds: number; retryExtensionSeconds: number };
  support: VaultConfigPayload["support"] | null;
  doors: PublicDoor[];
  cart: PublicCartLine[];
  sale: PublicSale | null;
  activeSale: PublicSale | null;
  providerLimits: { maxItems: number; maxTotalCents: number };
  idleSecondsRemaining: number | null;
  serviceLocked: boolean;
  activeStaff: null | { sessionId: string; userId: string; role: VaultRole; locked: boolean; expiresAt: string };
  activeRestock: null | { sessionId: string; configVersion: number; status: string; expectedDoorIds: VaultDoorId[]; items: Array<{ doorId: VaultDoorId; productId: string | null; productName: string | null; outcome: string; command: PublicCommandPhase | null }> };
  activeCertification: null | { sessionId: string; configVersion: number; status: string; adapterMode: string; passCount: number; failCount: number; criticalCount: number; nextUnderTestedDoorId: VaultDoorId | null; currentCommand: PublicCommandPhase | null };
}

export interface PublicCommandPhase {
  commandId: string;
  doorId: VaultDoorId;
  state: string;
  terminal: boolean;
  outcome: string | null;
  observedDoorId: VaultDoorId | null;
  evidenceCode: string | null;
  observationRecorded: boolean;
}

export interface ApiErrorBody {
  requestId: string;
  error: { code: string; message: string };
}

export class VaultError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "VaultError";
  }
}

export interface CheckoutResult {
  sale: PublicSale | null;
  conflictedDoorIds: VaultDoorId[];
  preservedDoorIds: VaultDoorId[];
}

export interface OutboxEnvelope {
  eventId: string;
  sequence: number;
  digest: string;
  payload: Record<string, unknown>;
  attemptCount: number;
}

export interface OutboxBatchResult {
  acknowledgedEventIds: string[];
  rejected: Array<{ eventId: string; code: string }>;
}
