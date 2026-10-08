import type { VaultDoorId, VaultDoorMappingSchema } from "./doors";
import type { VaultMode, VaultPaymentState } from "./domain";
import type { z } from "zod";
import type { PaymentEvidenceNotice, PaymentRecoverySnapshot, PaymentVoidRequest, PaymentVoidResult, PaymentProviderRecoveryEvidence, PaymentVoidRetirement } from "./payment-operations";

export interface PaymentCapabilities {
  adapterName: string;
  adapterVersion: string;
  apiVersion: string | null;
  mode: "MOCK" | "OFFICIAL_TEST" | "LIVE";
  provider?: "STRIPE_TERMINAL" | "NAYAX_SPARK" | "SIMULATED";
  /** SHA-256 of non-secret provider account/device/machine binding; required outside MOCK. */
  bindingDigest?: string;
  captureBeforeFulfillment?: true;
  /** Explicit nonsecret vendor configuration evidence for provider-aware certification. */
  flow?: "REMOTE_START_PRE_SELECTION";
  acquiringOnlyConfirmed?: true;
  preSelectionConfirmed?: true;
  sandboxConfirmed?: true;
  productionConfirmed?: true;
  maxItems: number;
  maxTotalCents: number;
  cancellationBeforeAuthorization: boolean;
  ready?: boolean;
}

export interface PaymentSessionRequest {
  idempotencyKey: string;
  saleId: string;
  mode: VaultMode;
  currency: "USD";
  totalCents: number;
  items: ReadonlyArray<{ lineId: string; name: string; priceCents: number }>;
  /** Exact immutable machine linkage to the configured controller profile. */
  fulfillment?: {
    profileDigest: string;
    mappingVersion: string;
    items: ReadonlyArray<{ lineId: string; doorId: VaultDoorId; controllerEndpointId?: string; controllerChannel: number }>;
  };
}

export interface PaymentSessionResult {
  providerSessionId: string;
  originalRequestDigest: string;
  providerTransactionId?: string;
  state: VaultPaymentState;
}

export interface PaymentAdapter {
  capabilities(): Promise<PaymentCapabilities>;
  startSession(request: PaymentSessionRequest): Promise<PaymentSessionResult>;
  cancelSession(providerSessionId: string, idempotencyKey: string): Promise<PaymentSessionResult>;
  reconcile(providerSessionId: string, options?: { allowReplay: boolean }): Promise<PaymentSessionResult>;
  /** null is affirmative absence from the provider's durable idempotency ledger. */
  reconcileRequest?(idempotencyKey: string, options?: { allowReplay: boolean }): Promise<PaymentSessionResult | null>;
  /** Separate human-approved compensation; never reinterpret cancelSession as a paid void. */
  voidPaidTransaction?(request: PaymentVoidRequest, options?: { beforeTransport: () => void }): Promise<PaymentVoidResult>;
  /** Read-only provider evidence transport; pending notices survive until local durable ACK. */
  pollEvidence?(): Promise<readonly PaymentEvidenceNotice[]>;
  acknowledgeEvidence?(noticeId: string): Promise<void>;
  /** Compare both durable ledgers before recovery or fulfillment effects. No provider mutation. */
  auditRecovery?(snapshot: PaymentRecoverySnapshot): Promise<readonly PaymentEvidenceNotice[]>;
  financialRecoveryEvidence?(): Promise<PaymentProviderRecoveryEvidence>;
  retireVoidAction?(actionId: string, actionDigest: string, reason: PaymentVoidRetirement["reason"]): Promise<PaymentVoidRetirement>;
}

export type ControllerOutcome = "ACCEPTED" | "SENT_UNKNOWN" | "REJECTED" | "TIMEOUT";
export interface ControllerCommand {
  commandId: string;
  doorId: VaultDoorId;
  controllerChannel: number;
  /** Required for v2 profiles; absent only for preserved historical v1 commands. */
  controllerEndpointId?: string;
  profileDigest?: string;
  mappingVersion: string;
  attempt: 1 | 2;
  authority: "PAID_SALE" | "RESTOCK" | "CERTIFICATION";
}
export interface ControllerReceipt {
  commandId: string;
  outcome: ControllerOutcome;
  controllerSequence: number;
  observedDoorId?: VaultDoorId;
  evidenceCode?: string;
  /** Board-reported output state, never proof of physical contact or door opening. */
  outputState?: "OFF_VERIFIED" | "UNCERTAIN" | "NOT_SENT";
}
export interface ControllerAdapter {
  identity(): Promise<{ adapter: string; mode: "MOCK" | "OFFICIAL_TEST" | "LIVE"; firmware: string | null; productionConfirmed?: true; bindingDigest?: string; mappingDigest: string; ready: boolean; outputState?: "OFF_VERIFIED" | "UNCERTAIN" | "NOT_SENT" }>;
  validateMapping(mapping: z.infer<typeof VaultDoorMappingSchema>): Promise<{ valid: boolean; errors: string[] }>;
  sendOpenCommand(command: ControllerCommand): Promise<ControllerReceipt>;
}
