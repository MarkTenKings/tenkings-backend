import { createHash } from "node:crypto";
import {
  VaultPaymentVoidActionSchema, type PaymentAdapter, type PaymentEvidenceNotice,
  type PaymentRecoverySnapshot, type PaymentVoidRequest, type PaymentVoidResult,
  type VaultPaymentState, type VaultPaymentVoidAction, type VaultMode,
} from "../../vault-contracts/dist";
import { EventRepository } from "./events";
import { VaultStore } from "./store";
import { VaultError, type Clock } from "./types";
import { digest, iso, json, parseJson } from "./util";
import { FinancialRecovery } from "./financial-recovery";

const reference = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const bounded = (value: unknown, maximum = 256): value is string => typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\x00-\x1f\x7f]/.test(value);

/** Financial recovery is independent of door allocation. No method in this service
 * creates commands, releases reservations, changes capture, or replenishes stock. */
export class PaymentOperations {
  private readonly executing = new Map<string, { digest: string; operation: Promise<PaymentVoidResult> }>();
  readonly recovery: FinancialRecovery;
  constructor(private readonly store: VaultStore, private readonly payment: PaymentAdapter,
    private readonly events: EventRepository, private readonly clock: Clock,
    private readonly clockUnsafe: () => boolean, private readonly beforeProductionEffect?: () => void) {
    this.recovery = new FinancialRecovery(store, payment, events, clock, clockUnsafe, () => this.executing.size > 0, () => this.pollEvidence());
  }

  async auditRecovery(): Promise<void> {
    if (!this.payment.auditRecovery) return;
    const configured = await this.payment.capabilities();
    // Rotation preserves all previous rows and journals. An unresolved old
    // binding must be reconciled under its original configuration before cutover.
    if (configured.provider === "NAYAX_SPARK" && this.store.maybeOne(`SELECT 1 FROM sale s JOIN sale_payment_binding b ON b.sale_id=s.sale_id
      WHERE b.provider='NAYAX_SPARK' AND b.binding_digest<>? AND
      (s.payment_state NOT IN ('SETTLED','DECLINED','CANCELLED') OR s.presentation_done_at IS NULL
      OR EXISTS(SELECT 1 FROM command_intent c WHERE c.sale_id=s.sale_id AND c.completed_at IS NULL)
      OR EXISTS(SELECT 1 FROM payment_void v LEFT JOIN payment_void_external_review r ON r.action_id=v.action_id WHERE v.sale_id=s.sale_id AND v.state IN ('INTENT','UNKNOWN') AND r.action_id IS NULL)) LIMIT 1`, configured.bindingDigest ?? "")) {
      this.store.run(`UPDATE machine_meta SET automation_halted=1,recovery_required=1 WHERE singleton=1`);
      throw new VaultError("PAYMENT_PREVIOUS_BINDING_RECOVERY_REQUIRED", "Reconcile the original provider binding before activating its replacement", 503);
    }
    const snapshot: PaymentRecoverySnapshot = {
      sales: this.store.all(`SELECT s.*,b.binding_digest FROM sale s JOIN sale_payment_binding b ON b.sale_id=s.sale_id WHERE b.provider='NAYAX_SPARK' AND b.binding_digest=?`, configured.bindingDigest ?? "").map(row => ({
        saleId: String(row.sale_id), requestKey: row.payment_intent_key as string | null, requestDigest: row.payment_request_digest as string | null,
        providerSessionId: row.provider_session_id as string | null, providerTransactionId: row.provider_transaction_id as string | null,
        bindingDigest: String(row.binding_digest), totalCents: Number(row.total_cents), currency: "USD",
        paymentState: row.payment_state as VaultPaymentState,
        hasCommittedFulfillment: Boolean(this.store.maybeOne(`SELECT 1 FROM sale_item WHERE sale_id=? AND allocation_state='COMMITTED_SOLD' LIMIT 1`, row.sale_id)),
      })),
      voids: this.store.all(`SELECT v.action_id,v.sale_id,v.state FROM payment_void v JOIN sale_payment_binding b ON b.sale_id=v.sale_id WHERE b.binding_digest=?`, configured.bindingDigest ?? "").map(row => ({ actionId: String(row.action_id), saleId: String(row.sale_id), state: row.state as PaymentRecoverySnapshot["voids"][number]["state"] })),
    };
    try { await this.recordEvidence(await this.payment.auditRecovery(snapshot)); }
    catch (error) {
      this.store.transaction(() => {
        this.store.run(`UPDATE machine_meta SET automation_halted=1,recovery_required=1 WHERE singleton=1`);
        this.store.bumpStateVersion();
      });
      // A provider/main-journal audit must succeed before any recovery effect.
      throw new VaultError("PAYMENT_RECOVERY_AUDIT_FAILED", "Payment journal recovery requires supervised review", 503);
    }
  }

  async pollEvidence(): Promise<void> {
    if (!this.payment.pollEvidence) return;
    let notices: readonly PaymentEvidenceNotice[];
    try { notices = await this.payment.pollEvidence(); }
    catch {
      // The Spark adapter handles temporary transport outages internally. An
      // escaping error means its evidence contract or durable ledger failed.
      this.store.run(`UPDATE machine_meta SET automation_halted=1,recovery_required=1 WHERE singleton=1`);
      const capabilities = await this.payment.capabilities();
      if (capabilities.provider !== "NAYAX_SPARK" || !/^[a-f0-9]{64}$/.test(capabilities.bindingDigest ?? "")) throw new VaultError("PAYMENT_EVIDENCE_INTEGRITY_FAILED", "Payment evidence requires review", 503);
      notices = [{ noticeId: reference(`integrity:${capabilities.bindingDigest}`), saleId: null, provider: "NAYAX_SPARK", bindingDigest: capabilities.bindingDigest!,
        providerSessionId: null, providerTransactionId: null, amountCents: null, currency: "USD", captureConfirmed: false, code: "SPARK_EVIDENCE_INTEGRITY_FAILED" }];
    }
    await this.recordEvidence(notices);
  }

  private async recordEvidence(notices: readonly PaymentEvidenceNotice[]): Promise<void> {
    if (!Array.isArray(notices) || notices.length > 1000) throw new VaultError("PAYMENT_EVIDENCE_INVALID", "Payment evidence batch is invalid", 503);
    for (const notice of notices) {
      if (!notice || !bounded(notice.noticeId) || (notice.saleId !== null && !/^[a-f0-9-]{36}$/i.test(notice.saleId))
        || notice.provider !== "NAYAX_SPARK" || !/^[a-f0-9]{64}$/.test(notice.bindingDigest)
        || (notice.providerSessionId !== null && !bounded(notice.providerSessionId)) || (notice.providerTransactionId !== null && !bounded(notice.providerTransactionId))
        || (notice.amountCents !== null && (!Number.isSafeInteger(notice.amountCents) || notice.amountCents <= 0 || notice.amountCents > 99_999_999))
        || notice.currency !== "USD" || typeof notice.captureConfirmed !== "boolean" || !/^[A-Z0-9_]{1,120}$/.test(notice.code)) throw new VaultError("PAYMENT_EVIDENCE_INVALID", "Payment evidence is invalid", 503);
      // Persist only minimized, hashed financial identifiers in the main outbox.
      const payload = { noticeId: notice.noticeId, saleId: notice.saleId, paymentProvider: notice.provider,
        paymentBindingDigest: notice.bindingDigest, providerSessionReference: notice.providerSessionId ? reference(notice.providerSessionId) : null,
        providerTransactionReference: notice.providerTransactionId ? reference(notice.providerTransactionId) : null,
        amountCents: notice.amountCents, currency: notice.currency, captureConfirmed: notice.captureConfirmed, code: notice.code };
      this.store.transaction(() => {
        const prior = this.store.maybeOne(`SELECT payload_digest FROM payment_evidence_notice WHERE notice_id=?`, notice.noticeId);
        if (prior) {
          if (prior.payload_digest !== digest(payload)) throw new VaultError("PAYMENT_EVIDENCE_CONFLICT", "Payment evidence identity changed", 503);
          return;
        }
        this.store.run(`INSERT INTO payment_evidence_notice(notice_id,payload_digest,payload_json,recorded_at) VALUES(?,?,?,?)`, notice.noticeId, digest(payload), json(payload), iso(this.clock.now()));
        const sale = notice.saleId ? this.store.maybeOne(`SELECT mode FROM sale WHERE sale_id=?`, notice.saleId) : null;
        this.events.append({ type: "PAYMENT_EVIDENCE_ANOMALY", mode: (sale?.mode ?? "CERTIFICATION") as VaultMode,
          ...(sale ? { correlationId: notice.saleId! } : {}), payload });
        this.store.bumpStateVersion();
      });
      // Crash after local COMMIT simply replays the same immutable notice.
      await this.payment.acknowledgeEvidence?.(notice.noticeId);
    }
  }

  executeApprovedVoid(input: VaultPaymentVoidAction): Promise<PaymentVoidResult> {
    const action = VaultPaymentVoidActionSchema.parse(input);
    const active = this.executing.get(action.actionId);
    if (active) {
      if (active.digest !== digest(action)) return Promise.reject(new VaultError("PAYMENT_VOID_ACTION_CONFLICT", "Approval identity changed", 409));
      return active.operation;
    }
    const operation = this.executeOnce(action).finally(() => this.executing.delete(action.actionId));
    this.executing.set(action.actionId, { digest: digest(action), operation });
    return operation;
  }

  private async executeOnce(action: VaultPaymentVoidAction): Promise<PaymentVoidResult> {
    if (!this.payment.voidPaidTransaction) throw new VaultError("PAYMENT_VOID_UNSUPPORTED", "This provider does not support approved paid-sale voids", 409);
    const capabilities = await this.payment.capabilities();
    if (!["OFFICIAL_TEST", "LIVE"].includes(capabilities.mode) || capabilities.provider !== "NAYAX_SPARK" || capabilities.bindingDigest !== action.paymentBindingDigest) throw new VaultError("PAYMENT_VOID_BINDING_MISMATCH", "Approval requires its original configured provider", 409);
    const request = this.store.transaction(() => {
      if (this.store.maybeOne(`SELECT 1 FROM payment_void_retirement WHERE action_id=?`, action.actionId)
        || this.store.maybeOne(`SELECT 1 FROM payment_void_external_review WHERE action_id=?`, action.actionId)
        || this.store.maybeOne(`SELECT 1 FROM financial_recovery_decision WHERE state='INTENT' LIMIT 1`)) throw new VaultError("PAYMENT_VOID_RETIRED_OR_REVIEWING", "This action cannot initiate another provider operation", 409);
      const existing = this.store.maybeOne(`SELECT * FROM payment_void WHERE action_id=?`, action.actionId);
      if (existing) {
        if (existing.action_digest !== digest(action)) throw new VaultError("PAYMENT_VOID_ACTION_CONFLICT", "Approval identity changed", 409);
        return parseJson<PaymentVoidRequest>(existing.request_json);
      }
      if (capabilities.mode === "LIVE") this.requireProductionAuthority();
      this.requireVoidEffectAuthority(action);
      const now = this.clock.now().getTime();
      if (this.clockUnsafe() || Date.parse(action.approvedAt) > now || Date.parse(action.expiresAt) <= now) throw new VaultError("PAYMENT_VOID_APPROVAL_EXPIRED", "A fresh financial approval is required", 409);
      const meta = this.store.one(`SELECT machine_id FROM machine_meta WHERE singleton=1`);
      const sale = this.store.maybeOne(`SELECT s.*,b.provider,b.binding_digest,b.capture_before_fulfillment FROM sale s JOIN sale_payment_binding b ON b.sale_id=s.sale_id WHERE s.sale_id=?`, action.saleId);
      if (action.machineId !== meta.machine_id || !sale || sale.provider !== "NAYAX_SPARK" || sale.binding_digest !== action.paymentBindingDigest || !sale.capture_before_fulfillment
        || sale.payment_state !== "SETTLED" || !sale.provider_session_id || !sale.provider_transaction_id
        || reference(String(sale.provider_session_id)) !== action.providerSessionReference || reference(String(sale.provider_transaction_id)) !== action.providerTransactionReference
        || sale.total_cents !== action.amountCents || sale.currency !== action.currency) throw new VaultError("PAYMENT_VOID_SALE_MISMATCH", "Approval does not match a captured sale", 409);
      if (!sale.presentation_done_at || this.store.maybeOne(`SELECT 1 FROM command_intent WHERE sale_id=? AND (completed_at IS NULL OR state NOT IN ('ACCEPTED','SENT_UNKNOWN','REJECTED','TIMEOUT')) LIMIT 1`, action.saleId)) throw new VaultError("PAYMENT_VOID_FULFILLMENT_ACTIVE", "Finish customer presentation and door-command recovery before financial resolution", 409);
      if (this.store.all(`SELECT notice_id FROM payment_evidence_notice WHERE json_extract(payload_json,'$.saleId')=? OR json_extract(payload_json,'$.saleId') IS NULL`, action.saleId).some(row => !action.reviewedNoticeIds.includes(String(row.notice_id)))) throw new VaultError("PAYMENT_VOID_EVIDENCE_REVIEW_REQUIRED", "Local financial discrepancies require reconciliation before a new compensation", 409);
      if (this.store.maybeOne(`SELECT 1 FROM payment_void WHERE sale_id=?`, action.saleId)) throw new VaultError("PAYMENT_VOID_ALREADY_RECORDED", "A financial action already owns this sale", 409);
      const request: PaymentVoidRequest = { actionId: action.actionId, saleId: action.saleId, providerSessionId: String(sale.provider_session_id),
        providerTransactionId: String(sale.provider_transaction_id), bindingDigest: action.paymentBindingDigest, amountCents: action.amountCents, currency: "USD", reason: action.reason };
      this.store.run(`INSERT INTO payment_void(action_id,sale_id,action_digest,action_json,request_json,state,created_at,updated_at) VALUES(?,?,?,?,?,'INTENT',?,?)`, action.actionId, action.saleId, digest(action), json(action), json(request), iso(this.clock.now()), iso(this.clock.now()));
      this.events.append({ type: "PAYMENT_VOID_INTENT_RECORDED", mode: sale.mode as VaultMode, correlationId: action.saleId, actor: action.approvedByAdminId, payload: this.actionPayload(action) });
      this.store.bumpStateVersion();
      return request;
    });
    const current = this.store.one(`SELECT state,outcome_json FROM payment_void WHERE action_id=?`, action.actionId);
    if (["VOIDED", "DECLINED"].includes(String(current.state))) return parseJson<PaymentVoidResult>(current.outcome_json);
    if (capabilities.mode === "LIVE") this.requireProductionAuthority();
    this.requireVoidEffectAuthority(action);
    let blockedByGate = false;
    const beforeTransport = () => {
      try { if (capabilities.mode === "LIVE") this.requireProductionAuthority(); this.requireVoidEffectAuthority(action); }
      catch (error) { blockedByGate = true; throw error; }
    };
    let outcome: PaymentVoidResult;
    try {
      const result = await this.payment.voidPaidTransaction(request, { beforeTransport });
      if (!result || result.actionId !== request.actionId || result.providerSessionId !== request.providerSessionId || result.providerTransactionId !== request.providerTransactionId
        || result.amountCents !== request.amountCents || result.currency !== "USD" || !["VOIDED", "DECLINED", "UNKNOWN"].includes(result.state)
        || !/^sha256:[a-f0-9]{64}$/.test(result.evidenceReference) || (result.errorCode !== undefined && (!Number.isSafeInteger(result.errorCode) || result.errorCode < 0))) throw new Error("INVALID_VOID_EVIDENCE");
      outcome = result;
    } catch (error) {
      if (blockedByGate) throw error; // No provider attempt crossed this gate. Preserve the original intent.
      outcome = { actionId: request.actionId, state: "UNKNOWN", providerSessionId: request.providerSessionId, providerTransactionId: request.providerTransactionId,
        amountCents: request.amountCents, currency: "USD", evidenceReference: reference(`unknown:${action.actionId}`) };
    }
    this.store.transaction(() => {
      const previous = this.store.one(`SELECT state,outcome_json FROM payment_void WHERE action_id=?`, action.actionId);
      if (previous.outcome_json === json(outcome)) return;
      this.store.run(`UPDATE payment_void SET state=?,outcome_json=?,updated_at=? WHERE action_id=?`, outcome.state, json(outcome), iso(this.clock.now()), action.actionId);
      const sale = this.store.one(`SELECT mode FROM sale WHERE sale_id=?`, action.saleId);
      this.events.append({ type: "PAYMENT_VOID_OUTCOME_RECORDED", mode: sale.mode as VaultMode, correlationId: action.saleId, actor: action.approvedByAdminId,
        payload: { ...this.actionPayload(action), state: outcome.state, evidenceReference: outcome.evidenceReference, ...(outcome.errorCode === undefined ? {} : { errorCode: outcome.errorCode }) } });
      this.store.bumpStateVersion();
    });
    return outcome;
  }

  private requireProductionAuthority(): void {
    if (!this.beforeProductionEffect) throw new VaultError("PRODUCTION_AUTHORITY_REQUIRED", "Production payment authority is required", 503);
    this.beforeProductionEffect();
  }

  private requireVoidEffectAuthority(action: VaultPaymentVoidAction): void {
    const flags = this.store.one(`SELECT automation_halted,recovery_required FROM machine_meta WHERE singleton=1`);
    if (flags.automation_halted || flags.recovery_required || this.clockUnsafe()) throw new VaultError("PAYMENT_VOID_TECHNICAL_RECOVERY_REQUIRED", "Payment transport is held for technical or clock recovery", 409);
    if (this.store.maybeOne(`SELECT 1 FROM payment_void_retirement WHERE action_id=?`, action.actionId)
      || this.store.maybeOne(`SELECT 1 FROM payment_void_external_review WHERE action_id=?`, action.actionId)
      || this.store.maybeOne(`SELECT 1 FROM financial_recovery_decision WHERE state='INTENT' LIMIT 1`)) throw new VaultError("PAYMENT_VOID_RETIRED_OR_REVIEWING", "Payment transport is held by retained financial authority", 409);
    if (this.store.maybeOne(`SELECT 1 FROM payment_void v LEFT JOIN payment_void_external_review r ON r.action_id=v.action_id WHERE v.action_id<>? AND v.state IN ('INTENT','UNKNOWN') AND r.action_id IS NULL LIMIT 1`, action.actionId)) throw new VaultError("PAYMENT_VOID_OTHER_FINANCIAL_RECOVERY_REQUIRED", "Another uncertain financial operation requires review before payment transport", 409);
    const notices = this.store.all(`SELECT n.notice_id FROM payment_evidence_notice n LEFT JOIN financial_notice_resolution r ON r.notice_id=n.notice_id WHERE r.notice_id IS NULL`);
    if (notices.some(row => !action.reviewedNoticeIds.includes(String(row.notice_id)))) throw new VaultError("PAYMENT_VOID_EVIDENCE_REVIEW_REQUIRED", "New financial evidence requires exact review before payment transport", 409);
  }

  private actionPayload(action: VaultPaymentVoidAction): Record<string, unknown> {
    return { actionId: action.actionId, saleId: action.saleId, paymentProvider: action.provider, paymentBindingDigest: action.paymentBindingDigest,
      providerSessionReference: action.providerSessionReference, providerTransactionReference: action.providerTransactionReference,
      amountCents: action.amountCents, currency: action.currency, approvedByAdminId: action.approvedByAdminId, reason: action.reason };
  }
}
