import { randomUUID } from "node:crypto";
import { VaultFinancialRecoveryDecisionSchema, VaultFinancialRecoverySnapshotSchema, VaultPaymentVoidActionSchema,
  type PaymentAdapter, type VaultFinancialRecoveryDecision, type VaultFinancialRecoverySnapshot, type VaultPaymentVoidAction } from "../../vault-contracts/dist";
import { VaultStore } from "./store";
import { EventRepository } from "./events";
import { VaultError, type Clock } from "./types";
import { digest, iso, json, parseJson } from "./util";

const reviewableCodes = new Set(["SPARK_ORPHAN_RECEIPT", "SPARK_APPROVAL_NEGATIVE_CONFLICT", "SPARK_LATE_CAPTURE_AFTER_FINAL_NEGATIVE",
  "SPARK_PAYMENT_METHOD_UNVERIFIED", "SPARK_PRESELECTION_TIMEOUT_MISMATCH", "SPARK_CONFLICTING_CAPTURE"]);

/** This service owns financial holds only. It never writes machine recovery flags,
 * sale/capture state, reservations, stock, controller commands, or provider money. */
export class FinancialRecovery {
  constructor(private readonly store: VaultStore, private readonly payment: PaymentAdapter, private readonly events: EventRepository,
    private readonly clock: Clock, private readonly clockUnsafe: () => boolean, private readonly executing: () => boolean,
    private readonly syncEvidence: () => Promise<void>) {}

  held(): boolean {
    return Boolean(this.store.maybeOne(`SELECT 1 FROM payment_evidence_notice n LEFT JOIN financial_notice_resolution r ON r.notice_id=n.notice_id WHERE r.notice_id IS NULL LIMIT 1`)
      || this.store.maybeOne(`SELECT 1 FROM payment_void v LEFT JOIN payment_void_external_review r ON r.action_id=v.action_id WHERE v.state IN ('INTENT','UNKNOWN') AND r.action_id IS NULL LIMIT 1`)
      || this.store.maybeOne(`SELECT 1 FROM financial_recovery_decision WHERE state='INTENT' LIMIT 1`));
  }

  readout(): { held: boolean; snapshot: VaultFinancialRecoverySnapshot | null; externallyReviewedActions: number; retiredActions: number } {
    const row = this.store.maybeOne(`SELECT payload_json FROM financial_recovery_snapshot ORDER BY generation DESC LIMIT 1`);
    return { held: this.held(), snapshot: row ? VaultFinancialRecoverySnapshotSchema.parse(parseJson(row.payload_json)) : null,
      externallyReviewedActions: Number(this.store.one(`SELECT count(*) AS count FROM payment_void_external_review`).count),
      retiredActions: Number(this.store.one(`SELECT count(*) AS count FROM payment_void_retirement`).count) };
  }

  async snapshot(): Promise<VaultFinancialRecoverySnapshot | null> {
    if (!this.payment.financialRecoveryEvidence) return null;
    const provider = await this.payment.financialRecoveryEvidence();
    await this.syncEvidence();
    const notices = this.store.all(`SELECT n.notice_id,n.payload_digest,n.payload_json FROM payment_evidence_notice n LEFT JOIN financial_notice_resolution r ON r.notice_id=n.notice_id WHERE r.notice_id IS NULL ORDER BY n.notice_id`);
    const actions = this.store.all(`SELECT v.action_id,v.action_digest,v.action_json,v.state,v.outcome_json FROM payment_void v LEFT JOIN payment_void_external_review r ON r.action_id=v.action_id WHERE r.action_id IS NULL AND (v.state IN ('INTENT','UNKNOWN') OR json_extract(v.action_json,'$.paymentBindingDigest')=?) ORDER BY v.action_id`, provider.bindingDigest);
    const unknown = actions.filter(row => row.state === "UNKNOWN");
    const blockers = new Set(provider.blockers);
    const meta = this.store.one(`SELECT machine_id,automation_halted,recovery_required FROM machine_meta WHERE singleton=1`);
    if (meta.automation_halted || meta.recovery_required) blockers.add("TECHNICAL_RECOVERY_REQUIRED");
    if (this.clockUnsafe()) blockers.add("CLOCK_UNSAFE");
    if (this.executing() || actions.some(row => row.state === "INTENT")) blockers.add("PAYMENT_OPERATION_ACTIVE");
    if (this.store.maybeOne(`SELECT 1 FROM command_intent WHERE completed_at IS NULL LIMIT 1`)) blockers.add("CONTROLLER_OPERATION_ACTIVE");
    if (this.store.maybeOne(`SELECT 1 FROM sale WHERE payment_state IN ('REQUESTED','UNKNOWN','RECONCILIATION_REQUIRED','SETTLEMENT_PENDING') OR (payment_state='SETTLED' AND presentation_done_at IS NULL) LIMIT 1`)) blockers.add("SALE_RECOVERY_REQUIRED");
    for (const row of notices) if (!reviewableCodes.has(String(parseJson<Record<string, unknown>>(row.payload_json).code))) blockers.add("TECHNICAL_PAYMENT_EVIDENCE_REQUIRED");
    if (notices.some(row => parseJson<Record<string, unknown>>(row.payload_json).paymentBindingDigest !== provider.bindingDigest)
      || actions.some(row => parseJson<Record<string, unknown>>(row.action_json).paymentBindingDigest !== provider.bindingDigest)) blockers.add("PAYMENT_BINDING_MISMATCH");
    if (notices.length > 100 || unknown.length > 100) blockers.add("FINANCIAL_REVIEW_LIMIT");
    const noticeIds = notices.map(row => String(row.notice_id)).slice(0, 100), unknownActionIds = unknown.map(row => String(row.action_id)).slice(0, 100);
    const blockList = [...blockers].sort();
    const stateDigest = digest({ paymentBindingDigest: provider.bindingDigest, providerEvidenceDigest: provider.evidenceDigest, notices, actions,
      machineId: meta.machine_id, blockers: blockList,
      sales: this.store.all(`SELECT sale_id,payment_state,presentation_done_at,provider_session_id,provider_transaction_id FROM sale ORDER BY sale_id`),
      commands: this.store.all(`SELECT command_id,state,completed_at FROM command_intent ORDER BY command_id`) });
    return this.store.transaction(() => {
      const prior = this.store.maybeOne(`SELECT generation,state_digest,payload_json FROM financial_recovery_snapshot ORDER BY generation DESC LIMIT 1`);
      if (prior?.state_digest === stateDigest) return VaultFinancialRecoverySnapshotSchema.parse(parseJson(prior.payload_json));
      const snapshot = VaultFinancialRecoverySnapshotSchema.parse({ snapshotId: randomUUID(), machineId: meta.machine_id,
        generation: Number(prior?.generation ?? 0) + 1, stateDigest, paymentBindingDigest: provider.bindingDigest, providerEvidenceDigest: provider.evidenceDigest,
        noticeIds, unknownActionIds, blockers: blockList, observedAt: iso(this.clock.now()) });
      this.store.run(`INSERT INTO financial_recovery_snapshot VALUES(?,?,?,?,?)`, snapshot.snapshotId, snapshot.generation, stateDigest, json(snapshot), snapshot.observedAt);
      this.events.append({ type: "FINANCIAL_RECOVERY_SNAPSHOT_RECORDED", payload: snapshot });
      return snapshot;
    });
  }

  async retireExpired(input: VaultPaymentVoidAction): Promise<void> {
    const action = VaultPaymentVoidActionSchema.parse(input);
    if (!this.payment.retireVoidAction || this.clockUnsafe() || Date.parse(action.expiresAt) > this.clock.now().getTime()) throw this.fail("RETIREMENT_NOT_ELIGIBLE");
    const existing = this.store.maybeOne(`SELECT action_digest FROM payment_void_retirement WHERE action_id=?`, action.actionId);
    if (existing) { if (existing.action_digest !== digest(action)) throw this.fail("RETIREMENT_CONFLICT"); return; }
    const caps = await this.payment.capabilities();
    if (caps.bindingDigest !== action.paymentBindingDigest || action.machineId !== this.store.one(`SELECT machine_id FROM machine_meta WHERE singleton=1`).machine_id
      || this.executing() || this.store.maybeOne(`SELECT 1 FROM payment_void WHERE action_id=?`, action.actionId)) throw this.fail("RETIREMENT_INTENT_PRESENT");
    const snapshot = await this.snapshot();
    if (!snapshot || snapshot.blockers.length || snapshot.paymentBindingDigest !== action.paymentBindingDigest) throw this.fail("RETIREMENT_RECOVERY_BLOCKED");
    const proof = await this.payment.retireVoidAction(action.actionId, digest(action), "EXPIRED_UNSTARTED");
    if (proof.actionId !== action.actionId || proof.actionDigest !== digest(action) || proof.reason !== "EXPIRED_UNSTARTED" || !/^[a-f0-9]{64}$/.test(proof.proofDigest)) throw this.fail("RETIREMENT_PROOF_INVALID");
    this.store.transaction(() => {
      if (this.store.maybeOne(`SELECT 1 FROM payment_void WHERE action_id=?`, action.actionId)) throw this.fail("RETIREMENT_INTENT_PRESENT");
      const payload = { actionId: action.actionId, saleId: action.saleId, actionDigest: digest(action), paymentBindingDigest: action.paymentBindingDigest,
        proofDigest: proof.proofDigest, expiresAt: action.expiresAt, retiredAt: iso(this.clock.now()), mainIntentAbsent: true, providerIntentAbsent: true, providerTransportAbsent: true };
      this.store.run(`INSERT INTO payment_void_retirement VALUES(?,?,?,?)`, action.actionId, digest(action), json(payload), payload.retiredAt);
      this.events.append({ type: "PAYMENT_VOID_RETIRED_UNSTARTED", correlationId: action.saleId, payload });
      this.store.bumpStateVersion();
    });
  }

  async apply(input: VaultFinancialRecoveryDecision): Promise<void> {
    const decision = VaultFinancialRecoveryDecisionSchema.parse(input);
    const prior = this.store.maybeOne(`SELECT decision_digest,state FROM financial_recovery_decision WHERE decision_id=?`, decision.decisionId);
    if (prior && prior.decision_digest !== digest(decision)) throw this.fail("DECISION_CONFLICT");
    if (prior?.state === "APPLIED" || prior?.state === "SUPERSEDED") return;
    if (this.store.maybeOne(`SELECT 1 FROM financial_recovery_decision WHERE state='INTENT' AND decision_id<>? LIMIT 1`, decision.decisionId)) throw this.fail("OTHER_DECISION_ACTIVE");
    const now = this.clock.now().getTime();
    if (this.clockUnsafe() || Date.parse(decision.approvedAt) > now || !prior && Date.parse(decision.expiresAt) <= now) throw this.fail("APPROVAL_EXPIRED");
    const snapshot = await this.snapshot();
    if (!snapshot || snapshot.blockers.length || snapshot.machineId !== decision.machineId || snapshot.snapshotId !== decision.snapshotId || snapshot.generation !== decision.generation
      || snapshot.stateDigest !== decision.stateDigest || digest(snapshot.noticeIds) !== digest([...decision.noticeIds].sort())
      || digest(snapshot.unknownActionIds) !== digest([...decision.unknownActionIds].sort()) || !decision.noticeIds.length && !decision.unknownActionIds.length) {
      if (snapshot && snapshot.machineId === decision.machineId) this.supersede(decision, snapshot);
      throw this.fail("SNAPSHOT_CHANGED_OR_BLOCKED");
    }
    if (decision.unknownActionIds.length && !this.payment.retireVoidAction) throw this.fail("PROVIDER_REVIEW_UNSUPPORTED");
    this.store.transaction(() => {
      if (this.executing() || this.clockUnsafe() || !prior && Date.parse(decision.expiresAt) <= this.clock.now().getTime()) throw this.fail("APPROVAL_EXPIRED");
      if (!prior) this.store.run(`INSERT INTO financial_recovery_decision VALUES(?,?,?,'INTENT',?,NULL)`, decision.decisionId, digest(decision), json(decision), iso(this.clock.now()));
    });
    for (const actionId of decision.unknownActionIds) {
      const row = this.store.one(`SELECT state,action_digest FROM payment_void WHERE action_id=?`, actionId);
      if (row.state !== "UNKNOWN") throw this.fail("VOID_STATE_CHANGED");
      const proof = await this.payment.retireVoidAction!(actionId, String(row.action_digest), "EXTERNAL_REVIEW");
      if (proof.actionId !== actionId || proof.actionDigest !== row.action_digest || proof.reason !== "EXTERNAL_REVIEW" || !/^[a-f0-9]{64}$/.test(proof.proofDigest)) throw this.fail("RETIREMENT_PROOF_INVALID");
    }
    // Provider tombstones are replay barriers only, and do not change the
    // financial evidence digest. A restart resumes this exact decision safely.
    const current = await this.snapshot();
    if (current?.stateDigest !== snapshot.stateDigest || this.clockUnsafe() || this.executing()) {
      if (current) this.supersede(decision, current);
      throw this.fail("SNAPSHOT_CHANGED_OR_BLOCKED");
    }
    this.store.transaction(() => {
      for (const noticeId of decision.noticeIds) this.store.run(`INSERT INTO financial_notice_resolution VALUES(?,?)`, noticeId, decision.decisionId);
      for (const actionId of decision.unknownActionIds) this.store.run(`INSERT INTO payment_void_external_review VALUES(?,?,?,?)`, actionId, decision.decisionId, decision.evidenceDigest, iso(this.clock.now()));
      this.store.run(`UPDATE financial_recovery_decision SET state='APPLIED',applied_at=? WHERE decision_id=?`, iso(this.clock.now()), decision.decisionId);
      this.events.append({ type: "FINANCIAL_RECOVERY_APPLIED", actor: decision.approvedByAdminId, payload: { decisionId: decision.decisionId, snapshotId: decision.snapshotId,
        stateDigest: decision.stateDigest, generation: decision.generation, noticeIds: decision.noticeIds, unknownActionIds: decision.unknownActionIds,
        evidenceReference: decision.evidenceReference, evidenceDigest: decision.evidenceDigest,
        startedAt: String(this.store.one(`SELECT created_at FROM financial_recovery_decision WHERE decision_id=?`, decision.decisionId).created_at),
        source: "EXTERNAL_HUMAN_REVIEW", verifiedFinancialAdjustmentCents: 0 } });
      this.store.bumpStateVersion();
    });
  }

  private supersede(decision: VaultFinancialRecoveryDecision, current: VaultFinancialRecoverySnapshot): void {
    this.store.transaction(() => {
      const prior = this.store.maybeOne(`SELECT state FROM financial_recovery_decision WHERE decision_id=?`, decision.decisionId);
      if (prior?.state === "SUPERSEDED" || prior?.state === "APPLIED") return;
      if (prior) this.store.run(`UPDATE financial_recovery_decision SET state='SUPERSEDED' WHERE decision_id=?`, decision.decisionId);
      else this.store.run(`INSERT INTO financial_recovery_decision VALUES(?,?,?,'SUPERSEDED',?,NULL)`, decision.decisionId, digest(decision), json(decision), iso(this.clock.now()));
      this.events.append({ type: "FINANCIAL_RECOVERY_SUPERSEDED", actor: decision.approvedByAdminId, payload: { decisionId: decision.decisionId,
        snapshotId: decision.snapshotId, stateDigest: decision.stateDigest, generation: decision.generation,
        currentSnapshotId: current.snapshotId, currentStateDigest: current.stateDigest, reason: "EVIDENCE_CHANGED" } });
      // Every notice and UNKNOWN action remains unresolved; replay barriers stay.
      this.store.bumpStateVersion();
    });
  }

  async resumeIntents(): Promise<void> {
    for (const row of this.store.all(`SELECT decision_json FROM financial_recovery_decision WHERE state='INTENT' ORDER BY created_at`)) await this.apply(parseJson(row.decision_json));
  }
  private fail(code: string): VaultError { return new VaultError(`FINANCIAL_RECOVERY_${code}`, "Financial recovery needs exact current evidence and supervised review", 409); }
}
