import type { PaymentAdapter, PaymentCapabilities, PaymentSessionRequest, PaymentSessionResult } from "../../vault-contracts/dist";
import { digest } from "./util";
import { PaymentNoEffectError, VaultError } from "./types";

type StripeIntent = {
  id: string; object: string; amount: number; amount_received?: number; currency: string; capture_method: string;
  livemode: boolean; status: string; payment_method_types: string[];
  metadata: Record<string, string>; latest_charge?: string | null;
};
type StripeReader = {
  id: string; object: string; location: string | null; device_type: string;
  livemode: boolean; status: string | null;
  action: null | { type: string; status: string; failure_code?: string | null; process_payment_intent?: { payment_intent: string } };
};

export interface StripeTerminalTestOptions {
  secretKey: string;
  machineId: string;
  readerId: string;
  locationId: string;
  fetchImpl?: typeof fetch;
  apiBase?: string;
}

/** Emitted only before this startSession invocation can create/process a payment.
 * It cannot establish absence after any earlier ambiguous start attempt.
 */
export class StripePaymentPreflightError extends PaymentNoEffectError {}

/** Test-mode Stripe API boundary. It cannot accept a live key or authorize live doors. */
export class StripeTerminalTestAdapter implements PaymentAdapter {
  private readonly fetchImpl: typeof fetch;
  private readonly apiBase: string;
  private readonly options: StripeTerminalTestOptions;

  constructor(options: StripeTerminalTestOptions) {
    if (!/^(sk|rk)_test_[A-Za-z0-9_]+$/.test(options.secretKey)
      || !/^tmr_[A-Za-z0-9]+$/.test(options.readerId)
      || !/^tml_[A-Za-z0-9]+$/.test(options.locationId)
      || !/^[0-9a-f-]{36}$/.test(options.machineId)) throw new VaultError("STRIPE_TEST_CONFIG_INVALID", "Stripe test configuration is incomplete or not test mode", 503);
    if (options.apiBase && (!options.fetchImpl || !/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/.test(options.apiBase))) throw new VaultError("STRIPE_TEST_CONFIG_INVALID", "Stripe API base override requires an injected test transport", 503);
    this.options = { ...options };
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.apiBase = options.apiBase ?? "https://api.stripe.com";
  }

  async capabilities(): Promise<PaymentCapabilities> {
    return { adapterName: "stripe-terminal-server-driven-test", adapterVersion: "0.1.0", apiVersion: null,
      mode: "OFFICIAL_TEST", provider: "STRIPE_TERMINAL", captureBeforeFulfillment: true,
      bindingDigest: digest({ provider: "STRIPE_TERMINAL", mode: "OFFICIAL_TEST", machineId: this.options.machineId, readerId: this.options.readerId, locationId: this.options.locationId }),
      maxItems: 25, maxTotalCents: 99_999_999, cancellationBeforeAuthorization: true, ready: true };
  }

  async startSession(request: PaymentSessionRequest): Promise<PaymentSessionResult> {
    if (!request || !Array.isArray(request.items) || !request.idempotencyKey || request.idempotencyKey.length > 160
      || request.mode !== "CERTIFICATION" || request.currency !== "USD" || !Number.isSafeInteger(request.totalCents)
      || request.totalCents < 50 || request.totalCents > 99_999_999 || !request.items.length
      || request.items.length > 25
      || request.items.some(item => !item || !item.lineId || !item.name || !Number.isSafeInteger(item.priceCents) || item.priceCents < 1)
      || new Set(request.items.map(item => item.lineId)).size !== request.items.length
      || request.items.reduce((sum, item) => sum + item.priceCents, 0) > request.totalCents || !/^[0-9a-f-]{36}$/.test(request.saleId)) throw new StripePaymentPreflightError("STRIPE_TEST_REQUEST_INVALID", "Stripe test purchase is invalid", 400);
    const requestDigest = digest(request);
    const initialReader = await this.reader();
    if (initialReader.status !== "online") throw new StripePaymentPreflightError("STRIPE_READER_OFFLINE", "Stripe reader must be online to begin payment", 503);
    if (initialReader.action?.status === "in_progress") throw new StripePaymentPreflightError("STRIPE_READER_BUSY", "Stripe reader is handling a payment", 409);
    const created = await this.post<StripeIntent>("/v1/payment_intents", {
      amount: String(request.totalCents), currency: "usd", "payment_method_types[]": "card_present", capture_method: "automatic",
      "metadata[vault_sale_id]": request.saleId, "metadata[vault_machine_id]": this.options.machineId,
      "metadata[vault_request_digest]": requestDigest, "metadata[vault_reader_id]": this.options.readerId,
      "metadata[vault_location_id]": this.options.locationId, "metadata[vault_total_cents]": String(request.totalCents),
    }, `vault-pi-${request.saleId}`);
    this.verifyIntent(created, { saleId: request.saleId, requestDigest, amount: request.totalCents });
    if (created.status === "succeeded" || created.status === "canceled") return this.result(created);
    if (created.status !== "requires_payment_method") return this.result(created);
    try {
      const reader = await this.reader();
      if (reader.status !== "online") return this.result(created);
      if (reader.action?.status === "in_progress" && reader.action.process_payment_intent?.payment_intent !== created.id) {
        throw new VaultError("STRIPE_READER_BUSY", "Stripe reader is handling a different payment", 409);
      }
      if (reader.action?.process_payment_intent?.payment_intent === created.id) return this.reconcile(created.id);
      await this.post<StripeReader>(`/v1/terminal/readers/${this.options.readerId}/process_payment_intent`,
        { payment_intent: created.id }, `vault-reader-${request.saleId}`);
      return this.reconcile(created.id);
    } catch {
      // The reader command may have reached Stripe. Keep this PaymentIntent and reconcile it.
      return { providerSessionId: created.id, originalRequestDigest: requestDigest, state: "UNKNOWN" };
    }
  }

  async reconcile(providerSessionId: string): Promise<PaymentSessionResult> {
    if (!/^pi_[A-Za-z0-9]+$/.test(providerSessionId)) throw new VaultError("STRIPE_INTENT_ID_INVALID", "Stripe PaymentIntent ID is invalid", 400);
    const intent = await this.get<StripeIntent>(`/v1/payment_intents/${providerSessionId}`);
    this.verifyIntent(intent, undefined, providerSessionId);
    if (["succeeded", "canceled"].includes(intent.status)) return this.result(intent);
    const reader = await this.reader();
    const observed = this.result(intent, reader);
    if (observed.state !== "DECLINED") return observed;
    // A failed reader action alone leaves a reusable PaymentIntent. Retire it
    // before releasing the reserved merchandise for a fresh customer checkout.
    try {
      const canceled = await this.post<StripeIntent>(`/v1/payment_intents/${providerSessionId}/cancel`, {}, `vault-decline-${providerSessionId}`);
      this.verifyIntent(canceled, undefined, providerSessionId);
      return canceled.status === "canceled" ? { ...this.result(canceled), state: "DECLINED" } : this.result(canceled);
    } catch {
      return this.observeAfterUncertainMutation(providerSessionId, observed);
    }
  }

  async cancelSession(providerSessionId: string, idempotencyKey: string): Promise<PaymentSessionResult> {
    if (!idempotencyKey || idempotencyKey.length > 160) throw new VaultError("STRIPE_CANCEL_KEY_INVALID", "A bounded cancellation key is required", 400);
    const current = await this.reconcile(providerSessionId);
    if (current.state === "SETTLED" || current.state === "CANCELLED") return current;
    const reader = await this.reader();
    if (reader.action?.process_payment_intent?.payment_intent === providerSessionId && reader.action.status === "in_progress") {
      try { await this.post(`/v1/terminal/readers/${this.options.readerId}/cancel_action`, {}, `vault-cancel-reader-${digest({ providerSessionId, idempotencyKey })}`); }
      catch { return this.observeAfterUncertainMutation(providerSessionId, current); }
    }
    try {
      const canceled = await this.post<StripeIntent>(`/v1/payment_intents/${providerSessionId}/cancel`, {}, `vault-cancel-pi-${digest({ providerSessionId, idempotencyKey })}`);
      this.verifyIntent(canceled, undefined, providerSessionId);
      return this.result(canceled);
    } catch { return this.observeAfterUncertainMutation(providerSessionId, current); }
  }

  private async observeAfterUncertainMutation(id: string, current: PaymentSessionResult): Promise<PaymentSessionResult> {
    try {
      const intent = await this.get<StripeIntent>(`/v1/payment_intents/${id}`);
      this.verifyIntent(intent, undefined, id);
      // PaymentIntent terminal state resolves cancel-versus-capture races even
      // when the reader is now disconnected. Never send another reader action.
      if (["succeeded", "canceled"].includes(intent.status)) return this.result(intent);
    } catch { /* Keep the existing durable binding and inventory reservation. */ }
    return { ...current, state: "UNKNOWN" };
  }

  async reconcileRequest(_idempotencyKey: string): Promise<null> {
    // Stripe's 24-hour idempotency retention is not proof of permanent absence.
    // An unbound start remains held for staff/Stripe reconciliation, never a new PI.
    throw new VaultError("STRIPE_UNBOUND_INTENT_REQUIRES_REVIEW", "Stripe start outcome has no durable PaymentIntent binding", 503);
  }

  close(): void { /* No local persistent or device handle. */ }

  private async reader(): Promise<StripeReader> {
    const reader = await this.get<StripeReader>(`/v1/terminal/readers/${this.options.readerId}`);
    if (!reader || reader.object !== "terminal.reader" || reader.id !== this.options.readerId || reader.location !== this.options.locationId
      || reader.livemode !== false || !["simulated_wisepos_e", "verifone_ux700"].includes(reader.device_type)) {
      throw new VaultError("STRIPE_READER_BINDING_INVALID", "Stripe reader does not match this Vault test machine", 503);
    }
    return reader;
  }

  private verifyIntent(intent: StripeIntent, expected?: { saleId: string; requestDigest: string; amount: number }, expectedId?: string): void {
    const meta = intent?.metadata;
    if (!intent || intent.object !== "payment_intent" || !/^pi_[A-Za-z0-9]+$/.test(intent.id) || intent.livemode !== false
      || (expectedId && intent.id !== expectedId)
      || intent.currency !== "usd" || intent.capture_method !== "automatic" || (!Array.isArray(intent.payment_method_types) || intent.payment_method_types.length !== 1 || intent.payment_method_types[0] !== "card_present")
      || meta?.vault_machine_id !== this.options.machineId || meta?.vault_reader_id !== this.options.readerId
      || meta?.vault_location_id !== this.options.locationId || !/^[0-9a-f-]{36}$/.test(meta?.vault_sale_id ?? "")
      || !/^[0-9a-f]{64}$/.test(meta?.vault_request_digest ?? "") || !Number.isSafeInteger(intent.amount)
      || (intent.status === "succeeded" && (intent.amount_received !== intent.amount || typeof intent.latest_charge !== "string" || !/^ch_[A-Za-z0-9]+$/.test(intent.latest_charge)))
      || (intent.latest_charge != null && (typeof intent.latest_charge !== "string" || !/^ch_[A-Za-z0-9]+$/.test(intent.latest_charge)))
      || intent.amount < 50 || intent.amount > 99_999_999 || meta?.vault_total_cents !== String(intent.amount)
      || (expected && (meta.vault_sale_id !== expected.saleId || meta.vault_request_digest !== expected.requestDigest || intent.amount !== expected.amount))) {
      throw new VaultError("STRIPE_INTENT_BINDING_INVALID", "Stripe payment does not match this Vault test purchase", 503);
    }
  }

  private result(intent: StripeIntent, reader?: StripeReader): PaymentSessionResult {
    const action = reader?.action;
    const forIntent = action?.type === "process_payment_intent" && action.process_payment_intent?.payment_intent === intent.id;
    const state = intent.status === "succeeded" ? "SETTLED"
      : intent.status === "canceled" ? "CANCELLED"
      : intent.status === "requires_payment_method" && forIntent && action?.status === "failed" && action.failure_code === "card_declined" ? "DECLINED"
      : intent.status === "requires_payment_method" && forIntent && action?.status === "in_progress" ? "REQUESTED"
      : "UNKNOWN";
    return { providerSessionId: intent.id, originalRequestDigest: intent.metadata.vault_request_digest!,
      ...(intent.latest_charge ? { providerTransactionId: intent.latest_charge } : {}), state };
  }

  private get<T>(path: string): Promise<T> { return this.call<T>("GET", path); }
  private post<T>(path: string, fields: Record<string, string>, key: string): Promise<T> { return this.call<T>("POST", path, fields, key); }
  private async call<T>(method: "GET" | "POST", path: string, fields?: Record<string, string>, key?: string): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.apiBase}${path}`, {
        method, redirect: "error", headers: { Authorization: `Bearer ${this.options.secretKey}`,
          ...(fields ? { "Content-Type": "application/x-www-form-urlencoded" } : {}), ...(key ? { "Idempotency-Key": key } : {}) },
        ...(fields ? { body: new URLSearchParams(fields).toString() } : {}), signal: AbortSignal.timeout(12_000),
      });
    } catch { throw new VaultError("STRIPE_API_UNREACHABLE", "Stripe test API outcome is unknown", 503); }
    if (!response.ok) {
      // Do not include Stripe response bodies, credentials, or card details in errors.
      const code = response.status === 401 || response.status === 403 ? "STRIPE_API_ACCESS_DENIED"
        : response.status === 429 ? "STRIPE_API_RATE_LIMITED" : "STRIPE_API_RESPONSE_FAILED";
      throw new VaultError(code, "Stripe test API did not confirm the operation", 503);
    }
    try { return await response.json() as T; }
    catch { throw new VaultError("STRIPE_API_RESPONSE_INVALID", "Stripe test API response is invalid", 503); }
  }
}
