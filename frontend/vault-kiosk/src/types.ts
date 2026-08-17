import type {
  VaultDoorId,
  VaultDoorState,
  VaultHealthState,
  VaultMode,
  VaultPaymentState,
  VaultRestockItemState,
  VaultRole,
  VaultSaleState,
} from "@tenkings/vault-contracts/browser";

export type VaultPublicState =
  | "BOOTING"
  | "UPDATING"
  | "NO_VALID_CACHED_CONFIG"
  | "CLOSED"
  | "MAINTENANCE"
  | "ATTRACT"
  | "SHOPPING_EMPTY"
  | "SHOPPING_WITH_CART"
  | "PRODUCT_SOLD_OUT"
  | "ALL_PRODUCTS_SOLD_OUT"
  | "RESERVATION_CONFLICT"
  | "CHECKOUT_REVALIDATING"
  | "PROVIDER_LIMIT_EXCEEDED"
  | "CONTROLLER_NOT_READY"
  | "NAYAX_UNAVAILABLE"
  | "PAYMENT_STARTING"
  | "PAYMENT_PENDING"
  | "PAYMENT_DECLINED"
  | "PAYMENT_CANCELLED"
  | "PAYMENT_UNKNOWN"
  | "PAYMENT_APPROVED_DURABLE"
  | "UNLOCK_QUEUED"
  | "RETRIEVAL"
  | "GROUP_RETRY_AVAILABLE"
  | "GROUP_RETRY_COMMITTED"
  | "GROUP_RETRY_USED"
  | "SUPPORT_REQUIRED"
  | "PAID_RESET_COUNTDOWN"
  | "IDLE_WARNING"
  | "RESETTING"
  | "SERVICE_ENTRY"
  | "SERVICE_LOCKED";

export interface KioskProduct {
  id: string;
  name: string;
  description: string;
  photoUrl: string;
  priceCents: 2500 | 5000 | 10000 | 25000;
  category: "SPORTS" | "POKEMON";
  active: boolean;
}

export interface KioskDoor {
  doorId: VaultDoorId;
  state: VaultDoorState;
  productId: string | null;
  plannedProductId?: string | null;
  selected: boolean;
  conflict?: boolean;
}

export interface KioskCartLine {
  doorId: VaultDoorId;
  productId: string;
  productName: string;
  priceCents: number;
  conflict?: boolean;
}

export interface KioskSupportConfig {
  pageUrl: string;
  email: string;
  textNumber: string;
  phoneNumber: string;
  hours: string;
}

export interface KioskProviderLimits {
  maxItems: number;
  maxTotalCents: number;
}

export interface KioskSaleSummary {
  saleId: string;
  supportReference: string;
  items: Array<{
    lineId: string;
    doorId: VaultDoorId;
    productId: string;
    productName: string;
    photoUrl: string;
    description: string;
    category: "SPORTS" | "POKEMON";
    priceCents: number;
    taxClass: string;
  }>;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  paidDoorIds: VaultDoorId[];
  retryAvailable: boolean;
  retryUsed: boolean;
  state: VaultSaleState;
  paymentState: VaultPaymentState;
  retrievalSecondsRemaining: number | null;
  resetSecondsRemaining: number | null;
}

export interface KioskPublicSnapshot {
  stateVersion: string | number;
  sequence: number;
  mode: VaultMode;
  publicState: VaultPublicState;
  health: VaultHealthState;
  readinessReasons: string[];
  serviceLocked: boolean;
  configVersion: number | null;
  city: string | null;
  state: string | null;
  taxRateBasisPoints: number | null;
  products: KioskProduct[];
  doors: KioskDoor[];
  cart: KioskCartLine[];
  providerLimits: KioskProviderLimits | null;
  support: KioskSupportConfig | null;
  activeSale: KioskSaleSummary | null;
  idleSecondsRemaining: number | null;
  buildIdentity: TrustedBuildIdentity | null;
  reservationConflictDoorIds: VaultDoorId[];
  preservedDoorIds: VaultDoorId[];
  activeStaff?: { sessionId: string; userId: string; role: VaultRole; locked: boolean; expiresAt: string } | null;
  activeRestock?: RestockSession | null;
  activeCertification?: CertificationStatus | null;
}

export interface TrustedBuildIdentity {
  sourceCommit: string;
  appVersion: string;
}

export interface ControllerCommandReceipt {
  commandId: string;
  doorId: VaultDoorId | null;
  state: string;
  terminal: boolean;
  observationRecorded: boolean;
  outcome: string | null;
  observedDoorId: VaultDoorId | null;
  evidenceCode: string | null;
}

export interface StaffSession {
  sessionId: string;
  userId: string;
  displayName: string;
  role: VaultRole;
  expiresAt: string;
}

export interface RestockItem {
  doorId: VaultDoorId;
  productId: string | null;
  productName: string;
  outcome: VaultRestockItemState;
  command: ControllerCommandReceipt | null;
}

export interface RestockSession {
  id: string;
  configVersion: number;
  status: "ACTIVE" | "READY_TO_FINALIZE" | "COMPLETED";
  items: RestockItem[];
  updatedAt: string;
}

export interface CertificationStatus {
  activeSessionId: string | null;
  passEvidenceCount: number;
  failEvidenceCount: number;
  criticalEvidenceCount: number;
  nextDoorId: VaultDoorId | null;
  criticalStop: boolean;
  currentCommand: ControllerCommandReceipt | null;
}

export interface MachineHealthDetail {
  health: VaultHealthState;
  readinessReasons: string[];
  appVersion: string;
  localSchemaVersion: number | null;
  configVersion: number | null;
  databaseIntegrity: "OK" | "CHECKING" | "FAILED";
  clockSafe: boolean;
  storageSafe: boolean;
  cloudFresh: boolean;
  outboxPendingCount: number | null;
  paymentAdapter: string;
  controllerAdapter: string;
}

export interface ApiSuccess<T> {
  requestId: string;
  data: T;
}

export interface ApiErrorBody {
  requestId?: string;
  error: {
    code: string;
    message: string;
    retryable?: boolean;
    details?: Record<string, unknown>;
  };
}

export interface StaffAuthenticationResult {
  session: StaffSession;
  restock: RestockSession | null;
  certification: CertificationStatus | null;
}

export interface RestockStartResult {
  sessionId: string;
  expectedDoorIds: VaultDoorId[];
}

export interface RestockFinalizeResult {
  filled: number;
  leftEmpty: number;
  exceptions: number;
}

export interface CertificationStartResult {
  sessionId: string;
  scheduledDoorId: VaultDoorId;
}

export interface CertificationEvidenceResult {
  critical: boolean;
}

export type { VaultDoorId, VaultMode, VaultRestockItemState, VaultRole };
