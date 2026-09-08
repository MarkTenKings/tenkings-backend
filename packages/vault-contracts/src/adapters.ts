import type { VaultDoorId, VaultDoorMappingSchema } from "./doors";
import type { VaultMode, VaultPaymentState } from "./domain";
import type { z } from "zod";

export interface NayaxCapabilities {
  adapterName: string;
  adapterVersion: string;
  sdkVersion: string | null;
  mode: "MOCK" | "OFFICIAL_TEST" | "LIVE";
  maxItems: number;
  maxTotalCents: number;
  cancellationBeforeAuthorization: boolean;
  ready?: boolean;
}

export interface NayaxSessionRequest {
  idempotencyKey: string;
  saleId: string;
  mode: VaultMode;
  currency: "USD";
  totalCents: number;
  items: ReadonlyArray<{ lineId: string; name: string; priceCents: number }>;
}

export interface NayaxSessionResult {
  providerSessionId: string;
  originalRequestDigest: string;
  state: VaultPaymentState;
}

export interface NayaxAdapter {
  capabilities(): Promise<NayaxCapabilities>;
  startSession(request: NayaxSessionRequest): Promise<NayaxSessionResult>;
  cancelSession(providerSessionId: string, idempotencyKey: string): Promise<NayaxSessionResult>;
  reconcile(providerSessionId: string): Promise<NayaxSessionResult>;
  /** null is affirmative absence from the provider's durable idempotency ledger. */
  reconcileRequest?(idempotencyKey: string): Promise<NayaxSessionResult | null>;
  reportVendResult?(request: NayaxVendResultRequest): Promise<NayaxSessionResult>;
}

/** A test boundary only. No live no-sensor vend policy is implied by this input. */
export interface NayaxVendResultRequest {
  idempotencyKey: string;
  saleId: string;
  providerSessionId: string;
  policy: "SIMULATOR_ONLY";
  items: ReadonlyArray<{ lineId: string; commandId: string; outcome: ControllerOutcome }>;
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
}
export interface ControllerAdapter {
  identity(): Promise<{ adapter: string; mode: "MOCK" | "OFFICIAL_TEST" | "LIVE"; firmware: string | null; mappingDigest: string; ready: boolean }>;
  validateMapping(mapping: z.infer<typeof VaultDoorMappingSchema>): Promise<{ valid: boolean; errors: string[] }>;
  sendOpenCommand(command: ControllerCommand): Promise<ControllerReceipt>;
}
