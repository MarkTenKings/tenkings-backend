import { createHash, randomInt, randomUUID } from "node:crypto";
import {
  VaultCheckoutRequestSchema,
  VaultProviderCallbackSchema,
  calculateTaxCents,
  configDoorIds,
  configMachineProfile,
  machineProfileDigest,
  nextUnderTestedDoor,
  vaultPaymentTransitionAllowed,
  roleMay,
  redactVaultValue,
  type ControllerAdapter,
  type ControllerCommand,
  type NayaxAdapter,
  type NayaxSessionResult,
  type NayaxVendResultRequest,
  type SignedVaultConfig,
  type VaultConfigPayload,
  type VaultDoorId,
  type VaultMode,
  type VaultPaymentState,
  type VaultRole,
} from "../../vault-contracts/dist";
import { StaffAuthService } from "./auth";
import { ConfigManager, type PublicKey } from "./config-manager";
import { EventRepository } from "./events";
import { VaultStore } from "./store";
import { asBoolean, deterministicId, digest, iso, json, parseJson, supportReference, isVaultClockUnsafe } from "./util";
import {
  VaultError,
  systemClock,
  type CheckoutResult,
  type Clock,
  type PublicMachineState,
  type PublicCommandPhase,
  type PublicSale,
} from "./types";

const TERMINAL_COMMAND_STATES = new Set(["ACCEPTED", "SENT_UNKNOWN", "REJECTED", "TIMEOUT"]);
const TERMINAL_SALE_STATES = new Set(["COMPLETED", "PAYMENT_DECLINED", "PAYMENT_CANCELLED"]);

export interface MachineOptions {
  store: VaultStore;
  payment: NayaxAdapter;
  controller: ControllerAdapter;
  pinnedConfigKeys: Readonly<Record<string, PublicKey>>;
  appVersion: string;
  clock?: Clock;
  beforeCheckout?: () => Promise<void>;
}

export interface CertificationAuthority { sessionId: string; staffSessionId: string }

function providerReference(value: string): string { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }

export class VaultMachine {
  readonly events: EventRepository;
  readonly config: ConfigManager;
  readonly staff: StaffAuthService;
  private readonly clock: Clock;
  private drainPromise: Promise<void> | null = null;
  private readonly bootWall: number;
  private readonly bootMonotonic: number;
  private readonly beforeCheckout?: () => Promise<void>;
  private paymentAdvance: Promise<void> | null = null;
  private readonly paymentStarts = new Map<string, { key: string; operation: Promise<PublicSale> }>();
  private readonly paymentCancellations = new Map<string, { key: string; operation: Promise<PublicSale> }>();

  constructor(
    readonly store: VaultStore,
    readonly payment: NayaxAdapter,
    readonly controller: ControllerAdapter,
    options: Omit<MachineOptions, "store" | "payment" | "controller">,
  ) {
    this.clock = options.clock ?? systemClock;
    this.bootWall = this.clock.now().getTime();
    this.bootMonotonic = this.clock.monotonicMs();
    this.beforeCheckout = options.beforeCheckout;
    this.events = new EventRepository(store, this.clock);
    this.config = new ConfigManager(store, this.events, this.clock, options.pinnedConfigKeys, options.appVersion);
    this.staff = new StaffAuthService(store, this.events, this.clock);
  }

  async initialize(): Promise<{ recoveredSales: number; integrity: string[] }> {
    const integrity = this.store.integrityCheck();
    if (!integrity.ok) throw new VaultError("LOCAL_INTEGRITY_FAILED", "Local database integrity check failed", 503, integrity.rows);
    this.config.validateCached();
    this.staff.refreshLocks(true);
    // A process restart is the only point at which an unfinished dispatch may be
    // classified as terminal unknown. It is never sent again automatically.
    this.store.transaction(() => {
      for (const command of this.store.all(`SELECT command_id,sale_id FROM command_intent WHERE state='SENT_UNKNOWN' AND completed_at IS NULL`)) this.events.append({ type: "CONTROLLER_EFFECT_REMAINS_UNKNOWN", mode: this.saleEventMode(command.sale_id), correlationId: command.sale_id ? String(command.sale_id) : undefined, payload: { commandId: command.command_id, errorClass: "SERVICE_RESTART" } });
      this.store.run(`UPDATE command_intent SET completed_at=?,evidence_code=COALESCE(evidence_code,'RESTART_EFFECT_UNKNOWN') WHERE state='SENT_UNKNOWN' AND completed_at IS NULL`, iso(this.clock.now()));
      for (const row of this.store.all(`SELECT DISTINCT sale_id FROM command_intent WHERE sale_id IS NOT NULL AND state='SENT_UNKNOWN'`)) this.updateSaleCommandTerminal(String(row.sale_id));
    });
    this.store.run(`UPDATE machine_meta SET last_public_activity_at=COALESCE(last_public_activity_at,?) WHERE singleton=1`, iso(this.clock.now()));
    const active = this.config.active();
    if (active) {
      const validation = await this.controller.validateMapping(active.payload.doorMapping);
      if (!validation.valid) {
        this.store.run(`UPDATE machine_meta SET automation_halted=1 WHERE singleton=1`);
        throw new VaultError("CONTROLLER_MAPPING_INVALID", "Active controller mapping failed validation", 503, validation.errors);
      }
    }
    const rows = this.store.all(`SELECT sale_id FROM sale WHERE state NOT IN ('COMPLETED','PAYMENT_DECLINED','PAYMENT_CANCELLED') ORDER BY created_at`);
    for (const row of rows) await this.recoverSale(String(row.sale_id));
    this.store.transaction(() => {
      for (const row of rows) {
        this.store.run(`UPDATE sale SET recovered_at=?,updated_at=? WHERE sale_id=?`, iso(this.clock.now()), iso(this.clock.now()), row.sale_id);
        this.events.append({ type: "SALE_RECOVERY_EVALUATED", mode: this.saleEventMode(row.sale_id), correlationId: String(row.sale_id), payload: { saleId: row.sale_id } });
      }
    });
    await this.drainCommands();
    return { recoveredSales: rows.length, integrity: integrity.rows };
  }

  stageConfig(config: SignedVaultConfig): { pendingVersion: number } { return this.config.stage(config); }
  activatePendingConfig(): ReturnType<ConfigManager["activatePending"]> {
    const pending = this.config.pending();
    if (pending) {
      const reasons = this.localReadinessReasons().filter(reason => ["CLOCK_UNSAFE", "STORAGE_PRESSURE", "PHYSICAL_AUTOMATION_HALTED", "RECOVERY_REQUIRED"].includes(reason));
      if (reasons.length) return { activated: false, version: pending.version, reasons };
    }
    return this.config.activatePending();
  }

  activatePendingProfile(staffSessionId: string, expectedVersion: number, expectedDigest: string, compartmentsEmpty: boolean, servicedDoorsClosed: boolean): void {
    if (!compartmentsEmpty || !servicedDoorsClosed) throw new VaultError("PROFILE_RECONFIGURATION_CONFIRMATION_REQUIRED", "Profile activation requires explicit empty-compartment and physical-close confirmations", 409);
    const actor = this.staff.requireSession(staffSessionId, "CERTIFICATION_COLLECT");
    if (this.localReadinessReasons().some(reason => ["CLOCK_UNSAFE", "STORAGE_PRESSURE", "PHYSICAL_AUTOMATION_HALTED", "RECOVERY_REQUIRED"].includes(reason))) throw new VaultError("PROFILE_RECONFIGURATION_UNSAFE", "Local recovery, storage, and clock must be safe before activation", 409);
    const result = this.config.activatePending({ sessionId: actor.sessionId, userId: actor.userId, expectedVersion, expectedDigest });
    if (!result.activated) throw new VaultError("PROFILE_RECONFIGURATION_PINNED", "Finish active work before activating the reviewed profile", 409, result.reasons);
  }

  markCloudContact(at = this.clock.now()): void {
    this.store.transaction(() => {
      this.store.run(`UPDATE machine_meta SET last_cloud_success_at=?,last_trusted_wall_at=CASE WHEN last_trusted_wall_at>? THEN last_trusted_wall_at ELSE ? END,last_trusted_monotonic_ms=? WHERE singleton=1`, iso(at), iso(at), iso(at), this.clock.monotonicMs());
      this.events.append({ type: "CLOUD_FRESHNESS_PROVEN", payload: { observedAt: iso(at) } });
      this.store.bumpStateVersion();
    });
  }

  recordPublicActivity(): number {
    const meta = this.store.one(`SELECT service_locked FROM machine_meta WHERE singleton=1`);
    if (asBoolean(meta.service_locked)) throw new VaultError("PUBLIC_ACTIVITY_SERVICE_LOCKED", "Public activity cannot resume while service is locked", 409);
    if (this.store.maybeOne(`SELECT 1 FROM sale WHERE presentation_done_at IS NULL LIMIT 1`)) {
      throw new VaultError("PUBLIC_ACTIVITY_SALE_ACTIVE", "Public idle activity does not apply during an active sale", 409);
    }
    return this.store.transaction(() => {
      const observedAt = iso(this.clock.now());
      this.store.run(`UPDATE machine_meta SET last_public_activity_at=? WHERE singleton=1`, observedAt);
      this.events.append({ type: "PUBLIC_ACTIVITY_RECORDED", payload: { observedAt } });
      return this.store.bumpStateVersion();
    });
  }

  private localReadinessReasons(): string[] {
    const reasons: string[] = [];
    const active = this.config.active(); const meta = this.store.one(`SELECT * FROM machine_meta WHERE singleton=1`);
    if (!active) reasons.push("NO_VALID_CACHED_CONFIG");
    else {
      if (new Date(active.payload.expiresAt).getTime() <= this.clock.now().getTime()) reasons.push("CONFIG_EXPIRED");
      const cloudAt = meta.last_cloud_success_at ? new Date(String(meta.last_cloud_success_at)).getTime() : 0;
      if (this.clock.now().getTime() - cloudAt > active.payload.cloudFreshnessMs) reasons.push("CLOUD_NOT_FRESH");
      if (!active.payload.city || !active.payload.state) reasons.push("TAX_JURISDICTION_MISSING");
    }
    if (asBoolean(meta.service_locked)) reasons.push("SERVICE_LOCKED");
    if (asBoolean(meta.automation_halted)) reasons.push("PHYSICAL_AUTOMATION_HALTED");
    if (asBoolean(meta.recovery_required)) reasons.push("RECOVERY_REQUIRED");
    if (!this.store.storageStatus().ready) reasons.push("STORAGE_PRESSURE");
    if (isVaultClockUnsafe(this.store, this.clock, this.bootWall, this.bootMonotonic)) reasons.push("CLOCK_UNSAFE");
    const unknown = this.store.maybeOne(`SELECT 1 FROM sale WHERE payment_state IN ('UNKNOWN','RECONCILIATION_REQUIRED') LIMIT 1`);
    if (unknown) reasons.push("PAYMENT_RECONCILIATION_REQUIRED");
    if (this.store.maybeOne(`SELECT 1 FROM sale WHERE presentation_done_at IS NOT NULL AND payment_state NOT IN ('NOT_REQUESTED','DECLINED','CANCELLED','SETTLED') LIMIT 1`)) reasons.push("PAYMENT_FINALIZATION_PENDING");
    return reasons;
  }

  async readiness(): Promise<{ ready: boolean; reasons: string[] }> {
    const reasons: string[] = [];
    const active = this.config.active();
    const controller = await this.controller.identity();
    if (!controller.ready) reasons.push("CONTROLLER_NOT_READY");
    if (controller.mode === "LIVE") reasons.push("LIVE_CONTROLLER_NOT_AUTHORIZED_IN_THIS_BUILD");
    if (active?.payload.schemaVersion === 2 && active.payload.machineProfile.controller.adapterId !== controller.adapter) reasons.push("CONTROLLER_ADAPTER_IDENTITY_MISMATCH");
    if (active && !(await this.controller.validateMapping(active.payload.doorMapping)).valid) reasons.push("CONTROLLER_MAPPING_INVALID");
    const payment = await this.payment.capabilities();
    if (payment.ready === false) reasons.push("NAYAX_NOT_READY");
    if (payment.mode === "LIVE") reasons.push("LIVE_PAYMENT_NOT_AUTHORIZED_IN_THIS_BUILD");
    reasons.push(...this.localReadinessReasons());
    return { ready: reasons.length === 0, reasons };
  }

  selectCartDoor(doorId: VaultDoorId, productId: string, selected: boolean, certification?: CertificationAuthority): { selected: boolean; stateVersion: number } {
    this.requirePublicCart(certification);
    const config = this.requireConfig();
    const product = config.payload.products.find((entry) => entry.id === productId && entry.active);
    if (!product) throw new VaultError("PRODUCT_UNAVAILABLE", "Product is not active", 409);
    const door = this.store.one(`SELECT state,product_id FROM door WHERE door_id=? AND active=1`, doorId);
    if (selected && (door.state !== "AVAILABLE" || door.product_id !== productId)) throw new VaultError("DOOR_UNAVAILABLE", "Door is not available for the requested product", 409);
    const version = this.store.transaction(() => {
      if (selected) this.store.run(`INSERT INTO cart_item(door_id,product_id,selected_at) VALUES(?,?,?) ON CONFLICT(door_id) DO UPDATE SET product_id=excluded.product_id,selected_at=excluded.selected_at`, doorId, productId, iso(this.clock.now()));
      else this.store.run(`DELETE FROM cart_item WHERE door_id=?`, doorId);
      this.events.append({ type: selected ? "CART_DOOR_SELECTED" : "CART_DOOR_REMOVED", payload: { doorId, productId } });
      return this.store.bumpStateVersion();
    });
    return { selected, stateVersion: version };
  }

  pickForMe(productId: string): { doorId: VaultDoorId; stateVersion: number } {
    this.requirePublicCart();
    const active = this.requireConfig();
    if (!active.payload.products.some((product) => product.id === productId && product.active)) throw new VaultError("PRODUCT_UNAVAILABLE", "Product is not active", 409);
    return this.store.transaction(() => {
      const candidates = this.store.all(
        `SELECT d.door_id FROM door d LEFT JOIN cart_item c ON c.door_id=d.door_id WHERE d.active=1 AND d.state='AVAILABLE' AND d.product_id=? AND c.door_id IS NULL ORDER BY d.display_order`, productId,
      );
      if (!candidates.length) throw new VaultError("PRODUCT_SOLD_OUT", "No available door remains for this product", 409);
      const doorId = String(candidates[randomInt(candidates.length)]!.door_id) as VaultDoorId;
      this.store.run(`INSERT INTO cart_item(door_id,product_id,selected_at) VALUES(?,?,?)`, doorId, productId, iso(this.clock.now()));
      this.events.append({ type: "CART_SECURE_PICK_PERSISTED", payload: { doorId, productId, candidateCount: candidates.length } });
      return { doorId, stateVersion: this.store.bumpStateVersion() };
    });
  }

  async checkout(input: unknown, certification?: CertificationAuthority): Promise<CheckoutResult> {
    const parsedRequest = VaultCheckoutRequestSchema.parse(input);
    const adapter = await this.payment.capabilities();
    const request = { ...parsedRequest, mode: (adapter.mode === "LIVE" ? "PRODUCTION" : "CERTIFICATION") as VaultMode };
    const requestDigest = digest(request);
    const prior = this.store.maybeOne(`SELECT sale_id,checkout_request_digest FROM sale WHERE checkout_idempotency_key=?`, request.idempotencyKey);
    if (prior) {
      if (prior.checkout_request_digest !== requestDigest) throw new VaultError("CHECKOUT_IDEMPOTENCY_CONFLICT", "Checkout idempotency key was reused with different content", 409);
      return { sale: this.publicSale(String(prior.sale_id)), conflictedDoorIds: [], preservedDoorIds: request.doorIds };
    }
    if (this.beforeCheckout) await this.beforeCheckout();
    const readiness = await this.readiness();
    if (certification) this.requireCertificationAuthority(certification);
    const blockingReasons = certification ? readiness.reasons.filter((reason) => reason !== "SERVICE_LOCKED") : readiness.reasons;
    if (blockingReasons.length) throw new VaultError("MACHINE_NOT_SALES_READY", "Machine is not ready for checkout", 409, blockingReasons);
    const active = this.requireConfig();
    if (request.configVersion !== active.payload.version) throw new VaultError("CONFIG_VERSION_MISMATCH", "Checkout must use the active configuration version", 409);
    const concurrent = this.existingCheckout(request.idempotencyKey, requestDigest, request.doorIds);
    if (concurrent) return concurrent;
    if (this.store.maybeOne(`SELECT 1 FROM sale WHERE state NOT IN ('COMPLETED','PAYMENT_DECLINED','PAYMENT_CANCELLED') LIMIT 1`)) throw new VaultError("ACTIVE_TRANSACTION_EXISTS", "An existing transaction must finish before checkout", 409);
    const capabilities = await this.payment.capabilities();
    // No awaited work occurs below this point: revalidate every mutable local
    // authority after adapter/cloud probes and before the atomic reservation.
    const completedDuringProbe = this.existingCheckout(request.idempotencyKey, requestDigest, request.doorIds);
    if (completedDuringProbe) return completedDuringProbe;
    this.requirePublicCart(certification);
    const finalReasons = this.localReadinessReasons().filter(reason => !certification || reason !== "SERVICE_LOCKED");
    if (finalReasons.length || capabilities.ready === false || capabilities.mode === "LIVE") throw new VaultError("MACHINE_NOT_SALES_READY", "Machine readiness changed before reservation", 409, finalReasons);
    if (this.requireConfig().payload.version !== active.payload.version) throw new VaultError("CONFIG_VERSION_MISMATCH", "Configuration changed during checkout", 409);
    const selected = new Map(this.store.all(`SELECT door_id,product_id FROM cart_item`).map((row) => [String(row.door_id), String(row.product_id)]));
    const conflicts: VaultDoorId[] = []; const items: Array<{ doorId: VaultDoorId; doorLabel: string; product: VaultConfigPayload["products"][number]; channel: number; endpoint: string | null; profileDigest: string | null; mappingVersion: string }> = [];
    for (const doorId of request.doorIds) {
      const door = this.store.maybeOne(`SELECT * FROM door WHERE door_id=? AND active=1`, doorId);
      const productId = selected.get(doorId);
      const product = active.payload.products.find((entry) => entry.id === productId && entry.active);
      if (!door || door.state !== "AVAILABLE" || !productId || door.product_id !== productId || !product) conflicts.push(doorId);
      else items.push({ doorId, doorLabel: String(door.door_label), product, channel: Number(door.controller_channel), endpoint: active.payload.schemaVersion === 2 ? String(door.controller_endpoint_id) : null, profileDigest: door.profile_digest ? String(door.profile_digest) : null, mappingVersion: String(door.mapping_version) });
    }
    if (conflicts.length) {
      this.store.transaction(() => {
        for (const doorId of conflicts) this.store.run(`DELETE FROM cart_item WHERE door_id=?`, doorId);
        this.events.append({ type: "CHECKOUT_RESERVATION_CONFLICT", mode: request.mode, payload: { conflictedDoorIds: conflicts, preservedDoorIds: items.map((item) => item.doorId) } });
        this.store.bumpStateVersion();
      });
      return { sale: null, conflictedDoorIds: conflicts, preservedDoorIds: items.map((item) => item.doorId) };
    }
    const subtotalCents = items.reduce((sum, item) => sum + item.product.priceCents, 0);
    const taxCents = calculateTaxCents(subtotalCents, active.payload.taxRateBasisPoints);
    const totalCents = subtotalCents + taxCents;
    if (items.length > capabilities.maxItems || totalCents > capabilities.maxTotalCents) throw new VaultError("PROVIDER_LIMIT_EXCEEDED", "Cart exceeds payment provider limits", 409);
    const saleId = randomUUID(); const now = iso(this.clock.now()); const reference = supportReference(saleId);
    const eventItems = items.map((item) => ({
      lineId: randomUUID(),
      doorId: item.doorId,
      doorLabel: item.doorLabel,
      productId: item.product.id,
      productName: item.product.name,
      photoUrl: item.product.photoUrl,
      description: item.product.description,
      category: item.product.category,
      priceCents: item.product.priceCents,
      taxClass: item.product.taxClass,
      controllerChannel: item.channel,
      ...(item.endpoint ? { controllerEndpointId: item.endpoint } : {}),
      ...(item.profileDigest ? { profileDigest: item.profileDigest } : {}),
      mappingVersion: item.mappingVersion,
    }));
    this.store.transaction(() => {
      this.store.run(
        `INSERT INTO sale(sale_id,support_reference,checkout_idempotency_key,checkout_request_digest,mode,state,config_version,config_digest,timezone,city,state_region,tax_rate_basis_points,tax_calculation_version,subtotal_cents,tax_cents,total_cents,payment_state,created_at,updated_at)
         VALUES(?,?,?,?,?,'RESERVED',?,?,?,?,?,?,?,?,?,?,'NOT_REQUESTED',?,?)`,
        saleId, reference, request.idempotencyKey, requestDigest, request.mode, active.payload.version, active.digest, active.payload.timezone, active.payload.city, active.payload.state,
        active.payload.taxRateBasisPoints, active.payload.taxCalculationVersion, subtotalCents, taxCents, totalCents, now, now,
      );
      if (certification) this.store.run(`UPDATE sale SET certification_session_id=? WHERE sale_id=?`, certification.sessionId, saleId);
      for (const item of eventItems) {
        this.store.run(
          `INSERT INTO sale_item(line_id,sale_id,door_id,door_label,product_id,product_name,photo_url,description,category,price_cents,tax_class,controller_channel,controller_endpoint_id,profile_digest,mapping_version,allocation_state,fulfillment_state) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'RESERVED','NOT_COMMITTED')`,
          item.lineId, saleId, item.doorId, item.doorLabel, item.productId, item.productName, item.photoUrl, item.description, item.category, item.priceCents, item.taxClass, item.controllerChannel, item.controllerEndpointId ?? null, item.profileDigest ?? null, item.mappingVersion,
        );
        const changed = this.store.run(`UPDATE door SET state='RESERVED',owning_sale_id=?,version=version+1 WHERE door_id=? AND state='AVAILABLE'`, saleId, item.doorId);
        if (changed.changes !== 1) throw new VaultError("RESERVATION_RACE", "Door changed during reservation", 409);
      }
      this.store.run(`DELETE FROM cart_item`);
      this.events.append({
        type: "SALE_RESERVED",
        mode: request.mode,
        correlationId: saleId,
        payload: {
          saleId,
          supportReference: reference,
          configVersion: active.payload.version,
          configDigest: active.digest,
          timezone: active.payload.timezone,
          city: active.payload.city,
          state: active.payload.state,
          taxRateBasisPoints: active.payload.taxRateBasisPoints,
          taxCalculationVersion: active.payload.taxCalculationVersion,
          subtotalCents,
          taxCents,
          totalCents,
          currency: "USD",
          items: eventItems,
          ...(certification ? { certificationSessionId: certification.sessionId } : {}),
        },
      });
      this.store.bumpStateVersion();
    });
    return { sale: this.publicSale(saleId), conflictedDoorIds: [], preservedDoorIds: items.map((item) => item.doorId) };
  }

  async startPayment(saleId: string, idempotencyKey: string): Promise<PublicSale> {
    if (!idempotencyKey || idempotencyKey.length > 160) throw new VaultError("IDEMPOTENCY_KEY_INVALID", "A bounded payment idempotency key is required", 400);
    const pending = this.paymentStarts.get(saleId);
    if (pending) {
      if (pending.key !== idempotencyKey) throw new VaultError("PAYMENT_IDEMPOTENCY_CONFLICT", "Payment request conflicts with the existing intent", 409);
      return pending.operation;
    }
    const operation = this.startPaymentInternal(saleId, idempotencyKey).finally(() => { this.paymentStarts.delete(saleId); });
    this.paymentStarts.set(saleId, { key: idempotencyKey, operation });
    return operation;
  }

  private existingCheckout(key: string, requestDigest: string, doorIds: VaultDoorId[]): CheckoutResult | null {
    const prior = this.store.maybeOne(`SELECT sale_id,checkout_request_digest FROM sale WHERE checkout_idempotency_key=?`, key);
    if (!prior) return null;
    if (prior.checkout_request_digest !== requestDigest) throw new VaultError("CHECKOUT_IDEMPOTENCY_CONFLICT", "Checkout idempotency key was reused with different content", 409);
    return { sale: this.publicSale(String(prior.sale_id)), conflictedDoorIds: [], preservedDoorIds: doorIds };
  }

  private async startPaymentInternal(saleId: string, idempotencyKey: string): Promise<PublicSale> {
    await this.requireNonLivePayment();
    const sale = this.store.one(`SELECT * FROM sale WHERE sale_id=?`, saleId);
    const request = this.paymentRequest(saleId, idempotencyKey);
    const requestDigest = digest(request);
    if (sale.payment_intent_key) {
      if (sale.payment_intent_key !== idempotencyKey || sale.payment_request_digest !== requestDigest) throw new VaultError("PAYMENT_IDEMPOTENCY_CONFLICT", "Payment request conflicts with the existing intent", 409);
      if (sale.provider_session_id || sale.payment_state !== "NOT_REQUESTED") return this.publicSale(saleId);
    } else {
      if (sale.state !== "RESERVED") throw new VaultError("PAYMENT_STATE_INVALID", "Sale is not reserved for payment", 409);
      this.store.transaction(() => {
        this.store.run(`UPDATE sale SET state='PAYMENT_REQUESTED',payment_state='REQUESTED',payment_intent_key=?,payment_request_digest=?,state_version=state_version+1,updated_at=? WHERE sale_id=?`, idempotencyKey, requestDigest, iso(this.clock.now()), saleId);
        this.events.append({ type: "PAYMENT_INTENT_RECORDED", mode: sale.mode as VaultMode, correlationId: saleId, payload: { saleId, totalCents: sale.total_cents } });
        this.store.bumpStateVersion();
      });
    }
    let result;
    try { result = await this.payment.startSession(request); }
    catch (error) {
      this.store.transaction(() => {
        const changed = this.store.run(`UPDATE sale SET state='PAYMENT_UNKNOWN',payment_state='UNKNOWN',state_version=state_version+1,updated_at=? WHERE sale_id=? AND payment_state='REQUESTED'`, iso(this.clock.now()), saleId);
        if (changed.changes) {
          this.events.append({ type: "PAYMENT_START_EFFECT_UNKNOWN", mode: sale.mode as VaultMode, correlationId: saleId, payload: { saleId, errorClass: error instanceof Error ? error.name : "UNKNOWN" } });
          this.store.bumpStateVersion();
        }
      });
      return this.publicSale(saleId);
    }
    this.validatePaymentResult(saleId, result);
    this.store.run(`UPDATE sale SET provider_session_id=? WHERE sale_id=? AND provider_session_id IS NULL`, result.providerSessionId, saleId);
    await this.handleProviderCallback({
      callbackId: deterministicId("callback", saleId, result.providerSessionId, "start", result.state), saleId, providerSessionId: result.providerSessionId,
      sequence: 0, state: result.state, occurredAt: iso(this.clock.now()), evidence: { adapter: "normalized", source: "startSession" },
    });
    return this.publicSale(saleId);
  }

  async handleProviderCallback(input: unknown): Promise<{ disposition: string; sale: PublicSale }> {
    const callback = VaultProviderCallbackSchema.parse(input); const callbackDigest = digest(callback);
    const existing = this.store.maybeOne(`SELECT payload_digest,disposition,sale_id FROM payment_callback WHERE callback_id=?`, callback.callbackId);
    if (existing) {
      if (existing.payload_digest !== callbackDigest) {
        this.store.transaction(() => this.events.append({ type: "PAYMENT_CALLBACK_CONFLICT_QUARANTINED", mode: this.saleEventMode(existing.sale_id), correlationId: String(existing.sale_id), payload: { callbackId: callback.callbackId } }));
        throw new VaultError("PAYMENT_CALLBACK_CONFLICT", "Callback ID conflicts with previously persisted content", 409);
      }
      return { disposition: "DUPLICATE", sale: this.publicSale(callback.saleId) };
    }
    let shouldDrain = false; let disposition = "APPLIED";
    this.store.transaction(() => {
      const sale = this.store.one(`SELECT * FROM sale WHERE sale_id=?`, callback.saleId);
      const committed = Boolean(this.store.maybeOne(`SELECT 1 FROM sale_item WHERE sale_id=? AND allocation_state='COMMITTED_SOLD' LIMIT 1`, callback.saleId));
      if (sale.provider_session_id && sale.provider_session_id !== callback.providerSessionId) disposition = "SESSION_CONFLICT";
      else if (callback.sequence < Number(sale.provider_sequence)) disposition = "OUT_OF_ORDER";
      else if (callback.sequence === Number(sale.provider_sequence) && Number(sale.provider_sequence) >= 0) disposition = "SEQUENCE_CONFLICT";
      else if (!sale.payment_intent_key || !vaultPaymentTransitionAllowed(String(sale.payment_state), callback.state, committed)) disposition = "STATE_CONFLICT";
      else if (callback.providerTransactionId && sale.provider_transaction_id && sale.provider_transaction_id !== callback.providerTransactionId) disposition = "TRANSACTION_CONFLICT";
      this.store.run(
        `INSERT INTO payment_callback(callback_id,payload_digest,sale_id,provider_session_id,provider_transaction_id,sequence,state,occurred_at,evidence_json,disposition,received_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
        callback.callbackId, callbackDigest, callback.saleId, callback.providerSessionId, callback.providerTransactionId ?? null, callback.sequence, callback.state, callback.occurredAt, json(redactVaultValue(callback.evidence)), disposition, iso(this.clock.now()),
      );
      this.events.append({ type: disposition === "APPLIED" ? "PAYMENT_CALLBACK_APPLIED" : "PAYMENT_CALLBACK_QUARANTINED", mode: sale.mode as VaultMode, correlationId: callback.saleId, causationId: callback.callbackId, payload: { callbackId: callback.callbackId, sequence: callback.sequence, state: callback.state, disposition, providerSessionReference: providerReference(callback.providerSessionId), ...(callback.providerTransactionId ? { providerTransactionReference: providerReference(callback.providerTransactionId) } : {}) } });
      if (disposition !== "APPLIED") return;
      this.store.run(`UPDATE sale SET provider_session_id=COALESCE(provider_session_id,?),provider_transaction_id=COALESCE(provider_transaction_id,?),provider_sequence=?,updated_at=? WHERE sale_id=?`, callback.providerSessionId, callback.providerTransactionId ?? null, callback.sequence, iso(this.clock.now()), callback.saleId);
      switch (callback.state) {
        case "AUTHORIZED":
          if (!committed) {
            this.fulfillmentCommit(callback.saleId, sale.mode as VaultMode, callback.callbackId);
            shouldDrain = true;
          } else if (["UNKNOWN", "RECONCILIATION_REQUIRED"].includes(String(sale.payment_state))) this.store.run(`UPDATE sale SET payment_state='AUTHORIZED',state_version=state_version+1 WHERE sale_id=?`, callback.saleId);
          break;
        case "DECLINED": case "CANCELLED":
          if (["PAYMENT_REQUESTED", "PAYMENT_UNKNOWN", "RECONCILIATION_REQUIRED"].includes(String(sale.state))) this.releaseReservation(callback.saleId, callback.state);
          break;
        case "UNKNOWN":
          if (committed) this.store.run(`UPDATE sale SET payment_state='RECONCILIATION_REQUIRED',state_version=state_version+1 WHERE sale_id=?`, callback.saleId);
          else if (["PAYMENT_REQUESTED", "PAYMENT_UNKNOWN"].includes(String(sale.state))) this.store.run(`UPDATE sale SET state='PAYMENT_UNKNOWN',payment_state='UNKNOWN',state_version=state_version+1 WHERE sale_id=?`, callback.saleId);
          break;
        case "RECONCILIATION_REQUIRED":
          this.store.run(`UPDATE sale SET state=CASE WHEN ?=0 AND presentation_done_at IS NULL THEN 'RECONCILIATION_REQUIRED' ELSE state END,payment_state='RECONCILIATION_REQUIRED',state_version=state_version+1 WHERE sale_id=?`, committed ? 1 : 0, callback.saleId);
          break;
        case "SETTLED":
          this.store.run(`UPDATE sale SET payment_state='SETTLED',state=CASE WHEN state IN ('VEND_RESULT_PENDING','SETTLEMENT_PENDING','OPEN_COMMAND_TERMINAL') THEN 'SETTLED' ELSE state END,state_version=state_version+1 WHERE sale_id=?`, callback.saleId);
          break;
        default:
          this.store.run(`UPDATE sale SET payment_state=?,state_version=state_version+1 WHERE sale_id=?`, callback.state, callback.saleId);
      }
      this.store.bumpStateVersion();
    });
    if (shouldDrain) await this.drainCommands();
    return { disposition, sale: this.publicSale(callback.saleId) };
  }

  async reconcileSale(saleId: string): Promise<PublicSale> {
    await this.requireNonLivePayment();
    const sale = this.store.one(`SELECT * FROM sale WHERE sale_id=?`, saleId);
    if (!sale.provider_session_id) throw new VaultError("RECONCILIATION_SESSION_MISSING", "Sale has no provider session to reconcile", 409);
    const result = await this.payment.reconcile(String(sale.provider_session_id));
    this.validatePaymentResult(saleId, result);
    await this.handleProviderCallback({ callbackId: deterministicId("callback", saleId, "reconcile", String(Number(sale.provider_sequence) + 1), result.state), saleId, providerSessionId: result.providerSessionId, sequence: Number(sale.provider_sequence) + 1, state: result.state, occurredAt: iso(this.clock.now()), evidence: { source: "reconcile" } });
    return this.publicSale(saleId);
  }

  async cancelPayment(saleId: string, idempotencyKey: string): Promise<PublicSale> {
    if (!idempotencyKey || idempotencyKey.length > 160) throw new VaultError("IDEMPOTENCY_KEY_INVALID", "A bounded idempotency key is required", 400);
    const pending = this.paymentCancellations.get(saleId);
    if (pending) {
      if (pending.key !== idempotencyKey) throw new VaultError("CANCEL_IDEMPOTENCY_CONFLICT", "Cancellation intent already exists", 409);
      return pending.operation;
    }
    const operation = this.cancelPaymentInternal(saleId, idempotencyKey).finally(() => { this.paymentCancellations.delete(saleId); });
    this.paymentCancellations.set(saleId, { key: idempotencyKey, operation });
    return operation;
  }

  private async cancelPaymentInternal(saleId: string, idempotencyKey: string): Promise<PublicSale> {
    const sale = this.store.one(`SELECT * FROM sale WHERE sale_id=?`, saleId);
    if (sale.cancel_intent_key && sale.cancel_intent_key !== idempotencyKey) throw new VaultError("CANCEL_IDEMPOTENCY_CONFLICT", "Cancellation intent already exists", 409);
    if (sale.payment_state === "CANCELLED") return this.publicSale(saleId);
    if (sale.cancel_intent_key && this.hasCommittedAuthorization(saleId)) return this.publicSale(saleId);
    if (this.hasCommittedAuthorization(saleId) || !["NOT_REQUESTED", "REQUESTED", "UNKNOWN", "RECONCILIATION_REQUIRED"].includes(String(sale.payment_state))) throw new VaultError("PAYMENT_CANNOT_CANCEL", "Payment cannot be cancelled after authorization", 409);
    if (sale.payment_state !== "NOT_REQUESTED" && !(await this.payment.capabilities()).cancellationBeforeAuthorization) throw new VaultError("PAYMENT_CANNOT_CANCEL", "Adapter does not support preauthorization cancellation", 409);
    this.store.transaction(() => {
      const current = this.store.one(`SELECT payment_state FROM sale WHERE sale_id=?`, saleId);
      if (this.hasCommittedAuthorization(saleId) || !["NOT_REQUESTED", "REQUESTED", "UNKNOWN", "RECONCILIATION_REQUIRED"].includes(String(current.payment_state))) throw new VaultError("PAYMENT_CANNOT_CANCEL", "Payment changed before cancellation", 409);
      this.store.run(`UPDATE sale SET cancel_intent_key=COALESCE(cancel_intent_key,?) WHERE sale_id=?`, idempotencyKey, saleId);
      if (!sale.cancel_intent_key) this.events.append({ type: "PAYMENT_CANCEL_INTENT_RECORDED", mode: sale.mode as VaultMode, correlationId: saleId, payload: { saleId } });
      if (current.payment_state === "NOT_REQUESTED") this.releaseReservation(saleId, "CANCELLED");
      this.store.bumpStateVersion();
    });
    if (sale.payment_state === "NOT_REQUESTED") return this.publicSale(saleId);
    // The persisted cancellation survives a start request whose external effect
    // has not returned yet. The next tick resolves it without a second payment.
    if (!sale.provider_session_id) return this.publicSale(saleId);
    await this.requireNonLivePayment();
    const result = await this.payment.cancelSession(String(sale.provider_session_id), idempotencyKey);
    this.validatePaymentResult(saleId, result);
    const sequence = Number(this.store.one(`SELECT provider_sequence FROM sale WHERE sale_id=?`, saleId).provider_sequence) + 1;
    await this.handleProviderCallback({ callbackId: deterministicId("callback", saleId, "cancel", idempotencyKey, result.state), saleId, providerSessionId: result.providerSessionId, sequence, state: result.state, occurredAt: iso(this.clock.now()), evidence: { source: "cancel" } });
    return this.publicSale(saleId);
  }

  async advancePayments(): Promise<void> {
    if (this.paymentAdvance) return this.paymentAdvance;
    this.paymentAdvance = this.advancePaymentsInternal().finally(() => { this.paymentAdvance = null; });
    return this.paymentAdvance;
  }

  private async advancePaymentsInternal(): Promise<void> {
    for (const row of this.store.all(`SELECT sale_id,payment_state FROM sale WHERE payment_state NOT IN ('NOT_REQUESTED','DECLINED','CANCELLED','SETTLED') ORDER BY created_at`)) {
      const saleId = String(row.sale_id);
      try {
        if (["REQUESTED", "UNKNOWN", "RECONCILIATION_REQUIRED", "SETTLEMENT_PENDING"].includes(String(row.payment_state))) await this.recoverSale(saleId);
        const current = this.store.one(`SELECT * FROM sale WHERE sale_id=?`, saleId);
        if (!["AUTHORIZED", "VEND_RESULT_PENDING"].includes(String(current.payment_state)) || !this.initialCommandsTerminal(saleId)) continue;
        const capabilities = await this.payment.capabilities();
        if (capabilities.mode !== "MOCK" || !this.payment.reportVendResult) continue;
        const request: NayaxVendResultRequest = {
          idempotencyKey: deterministicId("vend", saleId), saleId, providerSessionId: String(current.provider_session_id), policy: "SIMULATOR_ONLY",
          items: this.store.all(`SELECT si.line_id,ci.command_id,ci.state FROM sale_item si JOIN command_intent ci ON ci.sale_item_id=si.line_id AND ci.attempt=1 WHERE si.sale_id=? ORDER BY si.line_id`, saleId).map((item) => ({ lineId: String(item.line_id), commandId: String(item.command_id), outcome: item.state as NayaxVendResultRequest["items"][number]["outcome"] })),
        };
        const requestDigest = digest(request);
        if (current.vend_result_request_digest && current.vend_result_request_digest !== requestDigest) throw new VaultError("VEND_RESULT_INTENT_CONFLICT", "Persisted vend evidence changed", 503);
        if (!current.vend_result_intent_key) this.store.transaction(() => {
          this.store.run(`UPDATE sale SET vend_result_intent_key=?,vend_result_request_digest=?,payment_state='VEND_RESULT_PENDING' WHERE sale_id=?`, request.idempotencyKey, requestDigest, saleId);
          this.events.append({ type: "VEND_RESULT_INTENT_RECORDED", mode: current.mode as VaultMode, correlationId: saleId, payload: { saleId, policy: request.policy, items: request.items } });
        });
        const result = await this.payment.reportVendResult(request);
        this.validatePaymentResult(saleId, result);
        const sequence = Number(this.store.one(`SELECT provider_sequence FROM sale WHERE sale_id=?`, saleId).provider_sequence) + 1;
        await this.handleProviderCallback({ callbackId: deterministicId("callback", saleId, "vend", result.state), saleId, providerSessionId: result.providerSessionId, sequence, state: result.state, occurredAt: iso(this.clock.now()), evidence: { source: "mock-vend-result" } });
        this.store.run(`UPDATE sale SET vend_result_reported_at=COALESCE(vend_result_reported_at,?) WHERE sale_id=?`, iso(this.clock.now()), saleId);
        await this.reconcileSale(saleId);
      } catch {
        // Preserve the persisted intent; the next supervised tick reconciles or
        // replays that same idempotent mock vend request, never a new payment.
      }
    }
  }

  private validatePaymentResult(saleId: string, result: NayaxSessionResult): void {
    const sale = this.store.one(`SELECT payment_request_digest,provider_session_id FROM sale WHERE sale_id=?`, saleId);
    if (!result.providerSessionId || result.originalRequestDigest !== sale.payment_request_digest || (sale.provider_session_id && result.providerSessionId !== sale.provider_session_id)) throw new VaultError("PAYMENT_ADAPTER_RESULT_CONFLICT", "Payment adapter result does not bind the persisted request", 503);
  }

  private async requireNonLivePayment(): Promise<void> {
    if ((await this.payment.capabilities()).mode === "LIVE") throw new VaultError("LIVE_PAYMENT_NOT_AUTHORIZED_IN_THIS_BUILD", "This software candidate cannot contact a live payment adapter", 503);
  }

  async openPaidDoorsAgain(saleId: string, idempotencyKey: string): Promise<PublicSale> {
    if (!idempotencyKey || idempotencyKey.length > 160) throw new VaultError("IDEMPOTENCY_KEY_INVALID", "A bounded retry idempotency key is required", 400);
    const requestDigest = digest({ saleId, idempotencyKey });
    const prior = this.store.maybeOne(`SELECT request_digest,response_json FROM idempotency_record WHERE scope=? AND idempotency_key=?`, `retry:${saleId}`, idempotencyKey);
    if (prior) {
      if (prior.request_digest !== requestDigest) throw new VaultError("RETRY_IDEMPOTENCY_CONFLICT", "Retry key was reused with different content", 409);
      return this.publicSale(saleId);
    }
    this.store.transaction(() => {
      const sale = this.store.one(`SELECT * FROM sale WHERE sale_id=?`, saleId);
      if (sale.retry_used_at) throw new VaultError("GROUP_RETRY_ALREADY_USED", "Paid-door group retry was already consumed", 409);
      if (!this.initialCommandsTerminal(saleId)) throw new VaultError("GROUP_RETRY_NOT_AVAILABLE", "Initial commands have not reached terminal outcomes", 409);
      if (!["OPEN_COMMAND_TERMINAL", "VEND_RESULT_PENDING", "SETTLEMENT_PENDING", "SETTLED", "SUPPORT_REQUIRED"].includes(String(sale.state))) throw new VaultError("GROUP_RETRY_NOT_AVAILABLE", "Sale is not eligible for paid-door retry", 409);
      const items = this.store.all(`SELECT * FROM sale_item WHERE sale_id=? ORDER BY door_id`, saleId);
      if (!items.length) throw new VaultError("SALE_ITEMS_MISSING", "Paid sale has no durable items", 503);
      const usedAt = iso(this.clock.now());
      const config = parseJson<VaultConfigPayload>(this.store.one(`SELECT payload_json FROM config_snapshot WHERE version=?`, sale.config_version).payload_json);
      const currentExpiryMs = sale.presentation_expires_at ? new Date(String(sale.presentation_expires_at)).getTime() : this.clock.now().getTime();
      const extendedExpiry = iso(new Date(Math.max(this.clock.now().getTime(), currentExpiryMs) + config.retryExtensionSeconds * 1000));
      this.store.run(`UPDATE sale SET retry_used_at=?,presentation_expires_at=?,state='OPEN_COMMAND_PENDING',state_version=state_version+1,updated_at=? WHERE sale_id=? AND retry_used_at IS NULL`, usedAt, extendedExpiry, usedAt, saleId);
      for (const item of items) {
        const commandId = deterministicId("cmd", saleId, String(item.line_id), "2");
        this.store.run(`INSERT INTO command_intent(command_id,sale_id,sale_item_id,door_id,door_label,controller_channel,controller_endpoint_id,profile_digest,mapping_version,attempt,authority,state,created_at) VALUES(?,?,?,?,?,?,?,?,?,2,'PAID_SALE','COMMAND_INTENT_RECORDED',?)`, commandId, saleId, item.line_id, item.door_id, item.door_label, item.controller_channel, item.controller_endpoint_id, item.profile_digest, item.mapping_version, usedAt);
      }
      this.events.append({ type: "PAID_DOOR_GROUP_RETRY_COMMITTED", mode: sale.mode as VaultMode, correlationId: saleId, payload: { saleId, commands: items.map((item) => ({ commandId: deterministicId("cmd", saleId, String(item.line_id), "2"), doorId: item.door_id, attempt: 2 })) } });
      this.store.run(`INSERT INTO idempotency_record(scope,idempotency_key,request_digest,response_json,created_at) VALUES(?,?,?,?,?)`, `retry:${saleId}`, idempotencyKey, requestDigest, json({ saleId, usedAt }), usedAt);
      this.store.bumpStateVersion();
    });
    await this.drainCommands();
    return this.publicSale(saleId);
  }

  markPresentationDone(saleId: string): PublicSale {
    const sale = this.store.one(`SELECT state,payment_state,presentation_done_at FROM sale WHERE sale_id=?`, saleId);
    if (sale.presentation_done_at) return this.publicSale(saleId);
    const unpaidTerminal = ["PAYMENT_DECLINED", "PAYMENT_CANCELLED"].includes(String(sale.state));
    const paid = this.hasCommittedAuthorization(saleId);
    const commandPending = this.store.maybeOne(`SELECT 1 FROM command_intent WHERE sale_id=? AND completed_at IS NULL LIMIT 1`, saleId);
    if (!unpaidTerminal && (!paid || !this.initialCommandsTerminal(saleId) || commandPending)) {
      throw new VaultError("SALE_PRESENTATION_PINNED", "Payment or door-command recovery presentation cannot be cleared", 409);
    }
    this.completePresentation(saleId, paid);
    return this.publicSale(saleId);
  }

  async drainCommands(): Promise<void> {
    if (this.drainPromise) return this.drainPromise;
    this.drainPromise = this.drainCommandsInternal().finally(() => { this.drainPromise = null; });
    return this.drainPromise;
  }

  private async drainCommandsInternal(): Promise<void> {
    while (true) {
      const intent = this.store.maybeOne(`SELECT * FROM command_intent WHERE state='COMMAND_INTENT_RECORDED' ORDER BY created_at,command_id LIMIT 1`);
      if (!intent) return;
      const mode = this.saleEventMode(intent.sale_id);
      const halted = asBoolean(this.store.one(`SELECT automation_halted FROM machine_meta WHERE singleton=1`).automation_halted);
      if (halted) return;
      const controllerIdentity = await this.controller.identity();
      const pinnedConfig = this.store.maybeOne(`SELECT payload_json FROM config_snapshot WHERE version=?`, intent.mapping_version);
      const profileConfig = pinnedConfig ? parseJson<VaultConfigPayload>(pinnedConfig.payload_json) : null;
      const expectedMapping = profileConfig?.doorMapping.find(mapping => mapping.doorId === intent.door_id);
      if (controllerIdentity.mode === "LIVE" || !expectedMapping || expectedMapping.controllerChannel !== intent.controller_channel
        || ("controllerEndpointId" in expectedMapping ? expectedMapping.controllerEndpointId : null) !== intent.controller_endpoint_id
        || (profileConfig?.schemaVersion === 2 && (profileConfig.machineProfile.controller.adapterId !== controllerIdentity.adapter || machineProfileDigest(profileConfig.machineProfile) !== intent.profile_digest))) {
        this.store.transaction(() => { this.store.run(`UPDATE machine_meta SET automation_halted=1,recovery_required=1 WHERE singleton=1`); this.events.append({ type: "CONTROLLER_AUTHORITY_INVALID", payload: { commandId: intent.command_id } }); });
        return;
      }
      if (intent.authority === "PAID_SALE") {
        const authority = this.store.maybeOne(`SELECT 1 FROM sale_item si JOIN sale s ON s.sale_id=si.sale_id JOIN door d ON d.door_id=si.door_id WHERE si.line_id=? AND si.sale_id=? AND si.door_id=? AND si.controller_channel=? AND si.mapping_version=? AND si.controller_endpoint_id IS ? AND si.profile_digest IS ? AND si.allocation_state='COMMITTED_SOLD' AND d.active=1 AND d.state='COMMITTED_SOLD' AND d.owning_sale_id=s.sale_id AND d.controller_channel=si.controller_channel AND d.mapping_version=si.mapping_version AND d.profile_digest IS si.profile_digest AND d.controller_endpoint_id=COALESCE(si.controller_endpoint_id,'legacy')`, intent.sale_item_id, intent.sale_id, intent.door_id, intent.controller_channel, intent.mapping_version, intent.controller_endpoint_id, intent.profile_digest);
        if (!authority) {
          this.store.transaction(() => { this.store.run(`UPDATE machine_meta SET automation_halted=1,recovery_required=1 WHERE singleton=1`); this.events.append({ type: "CONTROLLER_AUTHORITY_INVALID", payload: { commandId: intent.command_id } }); });
          return;
        }
      } else {
        const session = intent.authority === "RESTOCK"
          ? this.store.maybeOne(`SELECT actor_session_id FROM restock_session WHERE session_id=? AND finalized_at IS NULL`, intent.restock_session_id)
          : this.store.maybeOne(`SELECT actor_session_id FROM certification_session WHERE session_id=? AND status='ACTIVE'`, intent.certification_session_id);
        try { if (!session) return; this.staff.requireSession(String(session.actor_session_id), intent.authority === "RESTOCK" ? "RESTOCK_RUN" : "CERTIFICATION_COLLECT"); }
        catch { return; }
      }
      this.store.transaction(() => {
        this.store.run(`UPDATE command_intent SET state='SENT_UNKNOWN',dispatched_at=? WHERE command_id=? AND state='COMMAND_INTENT_RECORDED'`, iso(this.clock.now()), intent.command_id);
        this.events.append({ type: "CONTROLLER_DISPATCH_BOUNDARY_ENTERED", mode, correlationId: intent.sale_id ? String(intent.sale_id) : undefined, payload: { commandId: intent.command_id, doorId: intent.door_id, attempt: intent.attempt, authority: intent.authority } });
      });
      const command: ControllerCommand = {
        commandId: String(intent.command_id), doorId: intent.door_id as VaultDoorId, controllerChannel: Number(intent.controller_channel), mappingVersion: String(intent.mapping_version),
        ...(intent.controller_endpoint_id ? { controllerEndpointId: String(intent.controller_endpoint_id) } : {}),
        ...(intent.profile_digest ? { profileDigest: String(intent.profile_digest) } : {}),
        attempt: Number(intent.attempt) as 1 | 2, authority: intent.authority as ControllerCommand["authority"],
      };
      try {
        const receipt = await this.controller.sendOpenCommand(command);
        this.store.transaction(() => {
          if (receipt.commandId !== command.commandId || !TERMINAL_COMMAND_STATES.has(receipt.outcome) || !Number.isSafeInteger(receipt.controllerSequence) || receipt.controllerSequence < 1) {
            this.store.run(`UPDATE machine_meta SET automation_halted=1,recovery_required=1 WHERE singleton=1`);
            throw new VaultError("CONTROLLER_RECEIPT_INVALID", "Controller receipt does not bind the dispatched command", 503);
          }
          const wrongDoor = Boolean(receipt.observedDoorId && receipt.observedDoorId !== command.doorId);
          this.store.run(`UPDATE command_intent SET state=?,controller_sequence=?,observed_door_id=?,evidence_code=?,completed_at=? WHERE command_id=?`, receipt.outcome, receipt.controllerSequence, receipt.observedDoorId ?? null, receipt.evidenceCode ?? null, iso(this.clock.now()), command.commandId);
          if (intent.sale_item_id) this.store.run(`UPDATE sale_item SET fulfillment_state=? WHERE line_id=?`, receipt.outcome, intent.sale_item_id);
          if (wrongDoor) this.store.run(`UPDATE machine_meta SET automation_halted=1,recovery_required=1 WHERE singleton=1`);
          this.events.append({ type: wrongDoor ? "CRITICAL_WRONG_DOOR_OBSERVED" : "CONTROLLER_COMMAND_TERMINAL", mode, correlationId: intent.sale_id ? String(intent.sale_id) : undefined, payload: { commandId: command.commandId, expectedDoorId: command.doorId, observedDoorId: receipt.observedDoorId ?? null, outcome: receipt.outcome, controllerSequence: receipt.controllerSequence, evidenceCode: receipt.evidenceCode ?? null } });
          if (intent.sale_id) this.updateSaleCommandTerminal(String(intent.sale_id));
          this.store.bumpStateVersion();
        });
      } catch (error) {
        this.store.transaction(() => {
          this.store.run(`UPDATE command_intent SET completed_at=?,evidence_code=COALESCE(evidence_code,?) WHERE command_id=?`, iso(this.clock.now()), error instanceof VaultError ? error.code : "ADAPTER_EFFECT_UNKNOWN", command.commandId);
          if (error instanceof VaultError && error.code === "CONTROLLER_RECEIPT_INVALID") this.store.run(`UPDATE machine_meta SET automation_halted=1,recovery_required=1 WHERE singleton=1`);
          if (intent.sale_item_id) this.store.run(`UPDATE sale_item SET fulfillment_state='SENT_UNKNOWN' WHERE line_id=?`, intent.sale_item_id);
          this.events.append({ type: "CONTROLLER_EFFECT_REMAINS_UNKNOWN", mode, correlationId: intent.sale_id ? String(intent.sale_id) : undefined, payload: { commandId: command.commandId, errorClass: error instanceof Error ? error.name : "UNKNOWN" } });
          if (intent.sale_id) this.updateSaleCommandTerminal(String(intent.sale_id));
          this.store.bumpStateVersion();
        });
      }
    }
  }

  publicSale(saleId: string): PublicSale {
    const row = this.store.one(`SELECT * FROM sale WHERE sale_id=?`, saleId);
    const items = this.store.all(`SELECT * FROM sale_item WHERE sale_id=? ORDER BY door_id`, saleId);
    const config = parseJson<VaultConfigPayload>(this.store.one(`SELECT payload_json FROM config_snapshot WHERE version=?`, row.config_version).payload_json);
    const remaining = row.presentation_expires_at
      ? Math.max(0, Math.ceil((new Date(String(row.presentation_expires_at)).getTime() - this.clock.now().getTime()) / 1000))
      : null;
    const commandPending = this.store.maybeOne(`SELECT 1 FROM command_intent WHERE sale_id=? AND completed_at IS NULL LIMIT 1`, saleId);
    return {
      saleId, supportReference: String(row.support_reference), state: row.state as PublicSale["state"], paymentState: row.payment_state as VaultPaymentState,
      authorizationDurable: this.hasCommittedAuthorization(saleId),
      mode: row.mode as VaultMode, subtotalCents: Number(row.subtotal_cents), taxCents: Number(row.tax_cents), totalCents: Number(row.total_cents),
      items: items.map((item) => ({ lineId: String(item.line_id), doorId: item.door_id as VaultDoorId, doorLabel: String(item.door_label ?? item.door_id), productId: String(item.product_id), productName: String(item.product_name), photoUrl: String(item.photo_url), description: String(item.description), category: String(item.category), priceCents: Number(item.price_cents), taxClass: String(item.tax_class) })),
      paidDoorIds: items.map((item) => item.door_id as VaultDoorId), retryAvailable: !row.presentation_done_at && !row.retry_used_at && this.initialCommandsTerminal(saleId), retryUsed: Boolean(row.retry_used_at),
      retrievalSeconds: config.retrievalSeconds, retryExtensionSeconds: config.retryExtensionSeconds,
      retrievalSecondsRemaining: remaining,
      resetSecondsRemaining: row.presentation_started_at && !commandPending ? remaining : null,
      createdAt: String(row.created_at),
    };
  }

  async publicState(): Promise<PublicMachineState> {
    this.staff.refreshLocks();
    let meta = this.store.one(`SELECT * FROM machine_meta WHERE singleton=1`); const active = this.config.active(); const provider = await this.payment.capabilities();
    let saleRow = this.store.maybeOne(`SELECT sale_id,presentation_expires_at FROM sale WHERE presentation_done_at IS NULL ORDER BY created_at DESC LIMIT 1`);
    if (saleRow?.presentation_expires_at
      && new Date(String(saleRow.presentation_expires_at)).getTime() <= this.clock.now().getTime()
      && !this.store.maybeOne(`SELECT 1 FROM command_intent WHERE sale_id=? AND completed_at IS NULL LIMIT 1`, saleRow.sale_id)) {
      const expiring = this.store.one(`SELECT payment_state FROM sale WHERE sale_id=?`, saleRow.sale_id);
      const paid = this.hasCommittedAuthorization(String(saleRow.sale_id));
      if (paid && this.initialCommandsTerminal(String(saleRow.sale_id))) {
        this.completePresentation(String(saleRow.sale_id), true);
        meta = this.store.one(`SELECT * FROM machine_meta WHERE singleton=1`);
        saleRow = this.store.maybeOne(`SELECT sale_id,presentation_expires_at FROM sale WHERE presentation_done_at IS NULL ORDER BY created_at DESC LIMIT 1`);
      }
    }
    const currentSale = saleRow ? this.publicSale(String(saleRow.sale_id)) : null;
    if (currentSale) currentSale.cancelAvailable = currentSale.paymentState === "NOT_REQUESTED" || (currentSale.paymentState === "REQUESTED" && provider.cancellationBeforeAuthorization);
    const idleElapsedMs = meta.last_public_activity_at ? Math.max(0, this.clock.now().getTime() - new Date(String(meta.last_public_activity_at)).getTime()) : 0;
    if (!currentSale && !asBoolean(meta.service_locked) && idleElapsedMs >= 70_000 && this.store.maybeOne(`SELECT 1 FROM cart_item LIMIT 1`)) {
      this.store.transaction(() => {
        this.store.run(`DELETE FROM cart_item`);
        const observedAt = iso(this.clock.now());
        this.store.run(`UPDATE machine_meta SET last_public_activity_at=? WHERE singleton=1`, observedAt);
        this.events.append({ type: "PUBLIC_IDLE_CART_RESET", payload: { observedAt } });
        this.store.bumpStateVersion();
      });
      meta = this.store.one(`SELECT * FROM machine_meta WHERE singleton=1`);
    }
    const readiness = await this.readiness();
    const staff = this.store.maybeOne(`SELECT * FROM staff_session WHERE ended_at IS NULL ORDER BY created_at DESC LIMIT 1`);
    const restock = this.store.maybeOne(`SELECT * FROM restock_session WHERE finalized_at IS NULL ORDER BY created_at DESC LIMIT 1`);
    const restockConfig = restock ? parseJson<VaultConfigPayload>(this.store.one(`SELECT payload_json FROM config_snapshot WHERE version=?`, restock.config_version).payload_json) : null;
    const activeCertificationRow = this.store.maybeOne(`SELECT * FROM certification_session WHERE status IN ('ACTIVE','CRITICAL_STOP') ORDER BY created_at DESC LIMIT 1`);
    const certification = this.store.maybeOne(`SELECT 1 FROM certification_session WHERE status='ACTIVE' LIMIT 1`);
    const lastPublicActivityAt = meta.last_public_activity_at ? new Date(String(meta.last_public_activity_at)).getTime() : this.clock.now().getTime();
    const idleSecondsRemaining = currentSale || asBoolean(meta.service_locked)
      ? null
      : Math.max(0, 70 - Math.floor(Math.max(0, this.clock.now().getTime() - lastPublicActivityAt) / 1000));
    return {
      stateVersion: Number(meta.public_state_version), sequence: Number(this.store.one(`SELECT COALESCE(MAX(sequence),0) AS sequence FROM machine_event`).sequence), mode: certification || provider.mode !== "LIVE" ? "CERTIFICATION" : (currentSale?.mode ?? "PRODUCTION"),
      adapterMode: provider.mode,
      publicState: this.derivePublicState(meta, currentSale, readiness.reasons, idleSecondsRemaining), health: this.healthFromReasons(readiness.reasons), readinessReasons: readiness.reasons,
      configVersion: active?.payload.version ?? null, products: active?.payload.products.filter((product) => product.active) ?? [],
      configSchemaVersion: active?.payload.schemaVersion ?? null, machineProfile: active ? configMachineProfile(active.payload) : null,
      pendingProfile: this.config.pending(),
      buildIdentity: { sourceCommit: String(meta.source_commit), appVersion: String(meta.app_version) },
      city: active?.payload.city ?? null, state: active?.payload.state ?? null, taxRateBasisPoints: active?.payload.taxRateBasisPoints ?? null,
      tax: active ? { city: active.payload.city, state: active.payload.state, rateBasisPoints: active.payload.taxRateBasisPoints, calculationVersion: active.payload.taxCalculationVersion } : null,
      timers: active ? { retrievalSeconds: active.payload.retrievalSeconds, retryExtensionSeconds: active.payload.retryExtensionSeconds } : null,
      support: active?.payload.support ?? null,
      doors: this.store.all(`SELECT * FROM door WHERE active=1 ORDER BY display_order`).map((door) => ({ doorId: door.door_id as VaultDoorId, doorLabel: String(door.door_label), controllerChannel: Number(door.controller_channel), state: door.state as any, productId: door.product_id ? String(door.product_id) : null, plannedProductId: door.planned_product_id ? String(door.planned_product_id) : null, version: Number(door.version) })),
      cart: this.store.all(`SELECT * FROM cart_item ORDER BY selected_at`).map((line) => {
        const product = active?.payload.products.find((entry) => entry.id === line.product_id);
        return { doorId: line.door_id as VaultDoorId, productId: String(line.product_id), productName: product?.name ?? String(line.product_id), priceCents: product?.priceCents ?? 0, selectedAt: String(line.selected_at) };
      }),
      sale: currentSale, activeSale: currentSale, providerLimits: { maxItems: provider.maxItems, maxTotalCents: provider.maxTotalCents }, idleSecondsRemaining,
      serviceLocked: asBoolean(meta.service_locked),
      activeStaff: staff ? { sessionId: String(staff.session_id), userId: String(staff.user_id), role: staff.role as VaultRole, locked: Boolean(staff.locked_at), expiresAt: String(staff.expires_at) } : null,
      activeRestock: restock ? {
        sessionId: String(restock.session_id), configVersion: Number(restock.config_version), configSchemaVersion: restockConfig!.schemaVersion, machineProfile: configMachineProfile(restockConfig!), status: String(restock.status), expectedDoorIds: parseJson<VaultDoorId[]>(restock.expected_door_ids_json),
        items: this.store.all(`SELECT ri.door_id,ri.planned_product_id,ri.outcome FROM restock_item ri JOIN door d ON d.door_id=ri.door_id WHERE ri.session_id=? ORDER BY ri.planned_product_id,d.display_order`, restock.session_id).map((item) => {
          const product = restockConfig?.products.find((entry) => entry.id === item.planned_product_id);
          const command = this.store.maybeOne(`SELECT * FROM command_intent WHERE restock_session_id=? AND door_id=? ORDER BY created_at DESC LIMIT 1`, restock.session_id, item.door_id);
          return { doorId: item.door_id as VaultDoorId, doorLabel: configMachineProfile(restockConfig!)?.doors.find(door => door.doorId === item.door_id)?.label ?? String(item.door_id), productId: item.planned_product_id ? String(item.planned_product_id) : null, productName: product?.name ?? null, outcome: String(item.outcome), command: command ? this.publicCommand(command, String(item.outcome) !== "UNREVIEWED") : null };
        }),
      } : null,
      activeCertification: activeCertificationRow ? this.publicCertification(activeCertificationRow) : null,
    };
  }

  private publicCertification(row: Record<string, unknown>): PublicMachineState["activeCertification"] {
    const config = parseJson<VaultConfigPayload>(this.store.one(`SELECT payload_json FROM config_snapshot WHERE version=?`, row.config_version).payload_json);
    const profile = configMachineProfile(config); const canonicalDoorIds = configDoorIds(config);
    const counts = Object.fromEntries(this.store.all(`SELECT outcome,COUNT(*) AS count FROM certification_evidence WHERE session_id=? GROUP BY outcome`, row.session_id).map((entry) => [String(entry.outcome), Number(entry.count)]));
    const doorCounts = Object.fromEntries(this.store.all(
      `SELECT door_id,COUNT(*) AS count FROM certification_evidence WHERE session_id=? AND outcome='PASS' AND door_id IS NOT NULL GROUP BY door_id`,
      row.session_id,
    ).map((entry) => [String(entry.door_id), Number(entry.count)]));
    const unobserved = this.store.maybeOne(`SELECT ci.* FROM command_intent ci LEFT JOIN certification_evidence ce ON ce.command_id=ci.command_id WHERE ci.certification_session_id=? AND ce.command_id IS NULL ORDER BY ci.created_at DESC LIMIT 1`, row.session_id);
    const observed = unobserved ? undefined : this.store.maybeOne(`SELECT ci.* FROM command_intent ci JOIN certification_evidence ce ON ce.command_id=ci.command_id WHERE ci.certification_session_id=? ORDER BY ce.observed_at DESC LIMIT 1`, row.session_id);
    const currentCommand = unobserved ?? observed;
    const nextDoor = unobserved ? unobserved.door_id as VaultDoorId : canonicalDoorIds.length ? nextUnderTestedDoor(doorCounts, canonicalDoorIds) as VaultDoorId : null;
    return { sessionId: String(row.session_id), configVersion: Number(row.config_version), configSchemaVersion: config.schemaVersion, machineProfile: profile, status: String(row.status), adapterMode: String(row.adapter_mode), passCount: counts.PASS ?? 0, failCount: counts.FAIL ?? 0, criticalCount: counts.CRITICAL ?? 0, nextUnderTestedDoorId: nextDoor, nextUnderTestedDoorLabel: nextDoor ? profile?.doors.find(door => door.doorId === nextDoor)?.label ?? nextDoor : null, currentCommand: currentCommand ? this.publicCommand(currentCommand, Boolean(observed)) : null };
  }

  private publicCommand(command: Record<string, unknown>, observationRecorded: boolean): PublicCommandPhase {
    const state = String(command.state);
    const terminal = Boolean(command.completed_at) && TERMINAL_COMMAND_STATES.has(state);
    return {
      commandId: String(command.command_id),
      doorId: command.door_id as VaultDoorId,
      doorLabel: String(command.door_label ?? command.door_id),
      state,
      terminal,
      outcome: terminal ? state : null,
      observedDoorId: command.observed_door_id ? command.observed_door_id as VaultDoorId : null,
      evidenceCode: command.evidence_code ? String(command.evidence_code) : null,
      observationRecorded,
      cycleType: command.authority === "PAID_SALE" ? "PURCHASE" : command.authority === "RESTOCK" ? "RESTOCK" : "DIAGNOSTIC",
      saleId: command.sale_id ? String(command.sale_id) : null,
      restockSessionId: command.restock_session_id ? String(command.restock_session_id) : null,
    };
  }

  private requireConfig(): { payload: VaultConfigPayload; digest: string } {
    const active = this.config.active(); if (!active) throw new VaultError("NO_VALID_CACHED_CONFIG", "No active validated configuration", 503); return active;
  }

  private requirePublicCart(certification?: CertificationAuthority): void {
    const meta = this.store.one(`SELECT service_locked,automation_halted,recovery_required FROM machine_meta WHERE singleton=1`);
    if (certification) this.requireCertificationAuthority(certification);
    if ((asBoolean(meta.service_locked) && !certification) || asBoolean(meta.automation_halted) || asBoolean(meta.recovery_required)) throw new VaultError("PUBLIC_SESSION_BLOCKED", "Customer changes are blocked while service or recovery owns the machine", 409);
    if (this.store.maybeOne(`SELECT 1 FROM sale WHERE state NOT IN ('COMPLETED','PAYMENT_DECLINED','PAYMENT_CANCELLED') LIMIT 1`)) throw new VaultError("ACTIVE_TRANSACTION_EXISTS", "An existing transaction must finish before changing the cart", 409);
  }

  requireCertificationAuthority(authority: CertificationAuthority): void {
    const actor = this.staff.requireSession(authority.staffSessionId, "CERTIFICATION_COLLECT");
    const session = this.store.maybeOne(`SELECT actor_session_id,adapter_mode FROM certification_session WHERE session_id=? AND status='ACTIVE'`, authority.sessionId);
    if (!session || session.adapter_mode !== "MOCK" || (session.actor_session_id !== actor.sessionId && actor.role !== "ADMIN")) throw new VaultError("CERTIFICATION_AUTHORITY_INVALID", "Simulator cycle requires the active scoped certification actor", 403);
  }

  private paymentRequest(saleId: string, idempotencyKey: string) {
    const sale = this.store.one(`SELECT * FROM sale WHERE sale_id=?`, saleId);
    const items = this.store.all(`SELECT line_id,product_name,price_cents FROM sale_item WHERE sale_id=? ORDER BY line_id`, saleId);
    return { idempotencyKey, saleId, mode: sale.mode as VaultMode, currency: "USD" as const, totalCents: Number(sale.total_cents), items: items.map((item) => ({ lineId: String(item.line_id), name: String(item.product_name), priceCents: Number(item.price_cents) })) };
  }

  private saleEventMode(saleId: unknown): VaultMode {
    return saleId ? this.store.one(`SELECT mode FROM sale WHERE sale_id=?`, String(saleId)).mode as VaultMode : "CERTIFICATION";
  }

  private fulfillmentCommit(saleId: string, mode: VaultMode, callbackId: string): void {
    const sale = this.store.one(`SELECT certification_session_id FROM sale WHERE sale_id=?`, saleId);
    const items = this.store.all(`SELECT * FROM sale_item WHERE sale_id=? ORDER BY door_id`, saleId);
    for (const item of items) {
      const changed = this.store.run(`UPDATE door SET state='COMMITTED_SOLD',version=version+1 WHERE door_id=? AND state='RESERVED' AND owning_sale_id=?`, item.door_id, saleId);
      if (changed.changes !== 1) throw new VaultError("FULFILLMENT_DOOR_INVARIANT", "Reserved door did not belong to authorized sale", 503);
      this.store.run(`UPDATE sale_item SET allocation_state='COMMITTED_SOLD',fulfillment_state='COMMAND_INTENT_RECORDED' WHERE line_id=?`, item.line_id);
      const commandId = deterministicId("cmd", saleId, String(item.line_id), "1");
      this.store.run(`INSERT INTO command_intent(command_id,sale_id,sale_item_id,door_id,door_label,controller_channel,controller_endpoint_id,profile_digest,mapping_version,attempt,authority,state,created_at) VALUES(?,?,?,?,?,?,?,?,?,1,'PAID_SALE','COMMAND_INTENT_RECORDED',?)`, commandId, saleId, item.line_id, item.door_id, item.door_label, item.controller_channel, item.controller_endpoint_id, item.profile_digest, item.mapping_version, iso(this.clock.now()));
      if (sale.certification_session_id) this.store.run(`UPDATE command_intent SET certification_session_id=? WHERE command_id=?`, sale.certification_session_id, commandId);
    }
    this.store.run(`UPDATE sale SET state='OPEN_COMMAND_PENDING',payment_state='AUTHORIZED',state_version=state_version+1,updated_at=? WHERE sale_id=?`, iso(this.clock.now()), saleId);
    this.events.append({ type: "FULFILLMENT_COMMITTED", mode, correlationId: saleId, causationId: callbackId, payload: { saleId, commands: items.map((item) => ({ commandId: deterministicId("cmd", saleId, String(item.line_id), "1"), doorId: item.door_id, attempt: 1 })) } });
  }

  private releaseReservation(saleId: string, paymentState: "DECLINED" | "CANCELLED"): void {
    this.store.run(`UPDATE door SET state='AVAILABLE',owning_sale_id=NULL,version=version+1 WHERE owning_sale_id=? AND state='RESERVED'`, saleId);
    this.store.run(`UPDATE sale SET state=?,payment_state=?,state_version=state_version+1,updated_at=? WHERE sale_id=?`, paymentState === "DECLINED" ? "PAYMENT_DECLINED" : "PAYMENT_CANCELLED", paymentState, iso(this.clock.now()), saleId);
    this.store.run(`UPDATE sale_item SET allocation_state='RELEASED' WHERE sale_id=?`, saleId);
    this.events.append({ type: paymentState === "DECLINED" ? "PAYMENT_DECLINED_RESERVATION_RELEASED" : "PAYMENT_CANCELLED_RESERVATION_RELEASED", mode: this.saleEventMode(saleId), correlationId: saleId, payload: { saleId } });
  }

  private initialCommandsTerminal(saleId: string): boolean {
    const rows = this.store.all(`SELECT state,completed_at FROM command_intent WHERE sale_id=? AND attempt=1`, saleId);
    const itemCount = Number(this.store.one(`SELECT COUNT(*) AS count FROM sale_item WHERE sale_id=?`, saleId).count);
    return rows.length === itemCount && itemCount > 0 && rows.every((row) => row.completed_at && TERMINAL_COMMAND_STATES.has(String(row.state)));
  }

  private hasCommittedAuthorization(saleId: string): boolean { return Boolean(this.store.maybeOne(`SELECT 1 FROM sale_item WHERE sale_id=? AND allocation_state='COMMITTED_SOLD' LIMIT 1`, saleId)); }

  private updateSaleCommandTerminal(saleId: string): void {
    const pending = Number(this.store.one(`SELECT COUNT(*) AS count FROM command_intent WHERE sale_id=? AND completed_at IS NULL`, saleId).count);
    if (pending !== 0) return;
    const sale = this.store.one(`SELECT config_version,presentation_started_at FROM sale WHERE sale_id=?`, saleId);
    const now = this.clock.now();
    if (!sale.presentation_started_at) {
      const config = parseJson<VaultConfigPayload>(this.store.one(`SELECT payload_json FROM config_snapshot WHERE version=?`, sale.config_version).payload_json);
      this.store.run(
        `UPDATE sale SET state='OPEN_COMMAND_TERMINAL',presentation_started_at=?,presentation_expires_at=?,state_version=state_version+1,updated_at=? WHERE sale_id=? AND state='OPEN_COMMAND_PENDING'`,
        iso(now), iso(new Date(now.getTime() + config.retrievalSeconds * 1000)), iso(now), saleId,
      );
      return;
    }
    this.store.run(`UPDATE sale SET state='OPEN_COMMAND_TERMINAL',state_version=state_version+1,updated_at=? WHERE sale_id=? AND state='OPEN_COMMAND_PENDING'`, iso(now), saleId);
  }

  private completePresentation(saleId: string, paid: boolean): void {
    this.store.transaction(() => {
      const completedAt = iso(this.clock.now());
      const changed = this.store.run(
        `UPDATE sale SET presentation_done_at=?,state=CASE WHEN ?=1 THEN 'COMPLETED' ELSE state END,state_version=state_version+1,updated_at=? WHERE sale_id=? AND presentation_done_at IS NULL`,
        completedAt, paid ? 1 : 0, completedAt, saleId,
      );
      if (changed.changes !== 1) return;
      this.events.append({ type: "PUBLIC_PRESENTATION_DONE", mode: this.saleEventMode(saleId), correlationId: saleId, payload: { saleId } });
      this.store.bumpStateVersion();
    });
  }

  private async recoverSale(saleId: string): Promise<void> {
    if (this.paymentStarts.has(saleId) || this.paymentCancellations.has(saleId)) return;
    const sale = this.store.one(`SELECT * FROM sale WHERE sale_id=?`, saleId);
    if (sale.cancel_intent_key && sale.provider_session_id && !this.hasCommittedAuthorization(saleId)
      && ["REQUESTED", "UNKNOWN", "RECONCILIATION_REQUIRED"].includes(String(sale.payment_state))) {
      await this.cancelPayment(saleId, String(sale.cancel_intent_key));
      return;
    }
    if (["REQUESTED", "UNKNOWN", "RECONCILIATION_REQUIRED"].includes(String(sale.payment_state)) && !sale.provider_session_id && sale.payment_intent_key) {
      const request = this.paymentRequest(saleId, String(sale.payment_intent_key));
      if (digest(request) !== sale.payment_request_digest) {
        this.store.transaction(() => {
          this.store.run(`UPDATE sale SET state=CASE WHEN ?=1 THEN state ELSE 'RECONCILIATION_REQUIRED' END,payment_state='RECONCILIATION_REQUIRED' WHERE sale_id=?`, this.hasCommittedAuthorization(saleId) ? 1 : 0, saleId);
          this.events.append({ type: "PAYMENT_RECOVERY_INTENT_DIGEST_CONFLICT", mode: sale.mode as VaultMode, correlationId: saleId, payload: { saleId } });
        });
        return;
      }
      try {
        await this.requireNonLivePayment();
        if (!this.payment.reconcileRequest) throw new VaultError("PAYMENT_RECOVERY_UNSUPPORTED", "Adapter cannot reconcile the original payment intent", 503);
        const observed = await this.payment.reconcileRequest(request.idempotencyKey);
        if (!observed && sale.cancel_intent_key) {
          this.store.transaction(() => { this.releaseReservation(saleId, "CANCELLED"); this.store.bumpStateVersion(); });
          return;
        }
        const result = observed ?? await this.payment.startSession(request);
        this.validatePaymentResult(saleId, result);
        this.store.run(`UPDATE sale SET provider_session_id=? WHERE sale_id=? AND provider_session_id IS NULL`, result.providerSessionId, saleId);
        await this.handleProviderCallback({ callbackId: deterministicId("callback", saleId, result.providerSessionId, "recovery-start", result.state), saleId, providerSessionId: result.providerSessionId, sequence: 0, state: result.state, occurredAt: iso(this.clock.now()), evidence: { source: "recovery-idempotent-start" } });
      } catch {
        this.store.transaction(() => {
          const changed = this.store.run(`UPDATE sale SET state=CASE WHEN ?=1 THEN state ELSE 'RECONCILIATION_REQUIRED' END,payment_state='RECONCILIATION_REQUIRED' WHERE sale_id=? AND payment_state NOT IN ('DECLINED','CANCELLED','SETTLED')`, this.hasCommittedAuthorization(saleId) ? 1 : 0, saleId);
          if (changed.changes) this.events.append({ type: "PAYMENT_RECOVERY_EFFECT_UNRESOLVED", mode: sale.mode as VaultMode, correlationId: saleId, payload: { saleId } });
        });
      }
      return;
    }
    if (["REQUESTED", "UNKNOWN", "RECONCILIATION_REQUIRED", "SETTLEMENT_PENDING"].includes(String(sale.payment_state)) && sale.provider_session_id) {
      try { await this.reconcileSale(saleId); }
      catch {
        this.store.transaction(() => {
          const changed = this.store.run(`UPDATE sale SET state=CASE WHEN ?=1 THEN state ELSE 'RECONCILIATION_REQUIRED' END,payment_state='RECONCILIATION_REQUIRED' WHERE sale_id=? AND payment_state NOT IN ('DECLINED','CANCELLED','SETTLED')`, this.hasCommittedAuthorization(saleId) ? 1 : 0, saleId);
          if (changed.changes) this.events.append({ type: "PAYMENT_RECOVERY_RECONCILIATION_REQUIRED", mode: sale.mode as VaultMode, correlationId: saleId, payload: { saleId } });
        });
      }
    }
  }

  private derivePublicState(meta: Record<string, unknown>, sale: PublicSale | null, reasons: string[], idleSecondsRemaining: number | null): string {
    if (asBoolean(meta.service_locked)) return "SERVICE_LOCKED";
    if (!this.config.active()) return "NO_VALID_CACHED_CONFIG";
    if (sale) {
      if (!sale.authorizationDurable && (sale.paymentState === "UNKNOWN" || sale.paymentState === "RECONCILIATION_REQUIRED")) return "PAYMENT_UNKNOWN";
      if (sale.state === "PAYMENT_DECLINED") return "PAYMENT_DECLINED";
      if (sale.state === "PAYMENT_CANCELLED") return "PAYMENT_CANCELLED";
      if (sale.state === "PAYMENT_REQUESTED") return "PAYMENT_PENDING";
      if (sale.state === "OPEN_COMMAND_PENDING") return sale.retryUsed ? "GROUP_RETRY_COMMITTED" : "UNLOCK_QUEUED";
      if (sale.resetSecondsRemaining !== null) return "PAID_RESET_COUNTDOWN";
      if (sale.retryUsed) return "GROUP_RETRY_USED";
      if (sale.retryAvailable) return "GROUP_RETRY_AVAILABLE";
      if (sale.paymentState === "AUTHORIZED" || sale.paymentState === "SETTLED") return "RETRIEVAL";
    }
    if (reasons.some((reason) => reason.includes("CONTROLLER"))) return "CONTROLLER_NOT_READY";
    const cart = Number(this.store.one(`SELECT COUNT(*) AS count FROM cart_item`).count);
    if (cart && idleSecondsRemaining !== null && idleSecondsRemaining <= 10) return "IDLE_WARNING";
    return cart ? "SHOPPING_WITH_CART" : "ATTRACT";
  }

  private healthFromReasons(reasons: string[]): PublicMachineState["health"] {
    if (!reasons.length) return "READY";
    if (reasons.includes("SERVICE_LOCKED")) return "SERVICE_LOCKED";
    if (reasons.includes("RECOVERY_REQUIRED") || reasons.includes("PHYSICAL_AUTOMATION_HALTED")) return "RECOVERY_REQUIRED";
    if (reasons.includes("CLOCK_UNSAFE")) return "BLOCKED_CLOCK";
    if (reasons.includes("STORAGE_PRESSURE")) return "BLOCKED_STORAGE";
    if (reasons.some((reason) => reason.startsWith("CLOUD"))) return "DEGRADED_CLOUD";
    if (reasons.some((reason) => reason.includes("CONFIG"))) return "BLOCKED_CONFIG";
    if (reasons.some((reason) => reason.includes("CONTROLLER"))) return "BLOCKED_CONTROLLER";
    return "BLOCKED_NAYAX";
  }
}
