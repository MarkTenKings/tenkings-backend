import test from "node:test";
import assert from "node:assert/strict";
import { vaultPayloadDigest } from "@tenkings/database";
import { prepareFinancialRecoveryDecision, financialRecoveryHints, projectFinancialRecoverySnapshot, projectFinancialRecoveryApplied,
  projectFinancialRecoverySuperseded, projectVoidRetiredUnstarted, financialRecoveryAdminView, financialRecoveryOperationalSummary } from "../lib/server/vaultV1/financialRecovery";
import { VaultFinancialRecoveryApprovalSchema } from "../lib/server/vaultV1/financialRecovery";
import { prepareVaultPaymentVoidAction, vaultPaymentActionAdminDto } from "../lib/server/vaultV1/paymentActions";
import { normalizeTypedVaultEvent, projectVaultMachineEvent } from "../lib/server/vaultV1/events";
import { salesTotals } from "../lib/server/vaultV1/reporting";

const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const machineId = uuid(1), saleId = uuid(2), actionId = uuid(3), now = new Date("2026-10-07T12:00:00Z"), hash = "a".repeat(64);
function snapshot() { return { snapshotId: uuid(4), machineId, generation: 1, paymentBindingDigest: hash, stateDigest: hash, providerEvidenceDigest: hash,
  noticeIds: [`sha256:${hash}`], unknownActionIds: [actionId], blockers: [], observedAt: now.toISOString() }; }
function approval() { const s = snapshot(); return { decisionId: uuid(5), machineId, snapshotId: s.snapshotId, generation: s.generation, stateDigest: s.stateDigest,
  noticeIds: s.noticeIds, unknownActionIds: s.unknownActionIds, evidenceReference: "provider-human-case-123", evidenceDigest: hash, reason: "Reviewed the complete financial evidence", confirmReviewed: true as const }; }
function decision() { return prepareFinancialRecoveryDecision(snapshot(), approval(), "human-admin", now); }
function applied() { const d = decision(); return { decisionId: d.decisionId, snapshotId: d.snapshotId, generation: d.generation, stateDigest: d.stateDigest,
  noticeIds: d.noticeIds, unknownActionIds: d.unknownActionIds, evidenceReference: d.evidenceReference, evidenceDigest: d.evidenceDigest,
  startedAt: new Date(now.getTime() + 1).toISOString(), source: "EXTERNAL_HUMAN_REVIEW", verifiedFinancialAdjustmentCents: 0 }; }
function paidSale() { return { id: saleId, machineId, localTransactionId: saleId, mode: "CERTIFICATION", providerName: "NAYAX_SPARK", paymentState: "SETTLED", settlementState: "SETTLED", totalCents: 2700, taxCents: 200, currency: "USD",
  providerEvidence: { captureConfirmed: true, paymentBindingDigest: hash }, providerSessionId: `sha256:${hash}`, providerTransactionId: `sha256:${hash}`,
  customerDoneAt: now, authorizationObservedAt: now, items: [{ initialCommandTerminalAt: now }], supportCases: [], paymentAnomalies: [], paymentAction: null }; }
function action() { return prepareVaultPaymentVoidAction(paidSale(), { actionId, saleId, amountCents: 2700, reason: "Reviewed full original compensation", confirmFullSaleVoid: true }, "human-admin", now); }
function retirement() { const a = action(); return { actionId, saleId, actionDigest: vaultPayloadDigest(a), paymentBindingDigest: hash, proofDigest: hash,
  expiresAt: a.expiresAt, retiredAt: a.expiresAt, mainIntentAbsent: true, providerIntentAbsent: true, providerTransportAbsent: true }; }

test("financial approval binds every current fact and expires within a fresh bounded window", () => {
  const d = decision(); assert.equal(Date.parse(d.expiresAt) - Date.parse(d.approvedAt), 300000);
  for (const patch of [{ generation: 2 }, { snapshotId: uuid(99) }, { stateDigest: "b".repeat(64) }, { machineId: uuid(99) }, { noticeIds: [] }, { unknownActionIds: [] }]) {
    assert.throws(() => prepareFinancialRecoveryDecision(snapshot(), { ...approval(), ...patch }, "human-admin", now));
  }
  assert.throws(() => prepareFinancialRecoveryDecision({ ...snapshot(), blockers: ["TECHNICAL_RECOVERY_REQUIRED"] }, approval(), "human-admin", now));
  assert.throws(() => VaultFinancialRecoveryApprovalSchema.parse({ ...approval(), confirmReviewed: false }));
  assert.throws(() => VaultFinancialRecoveryApprovalSchema.parse({ ...approval(), clearHardwareHolds: true }));
  assert.throws(() => prepareFinancialRecoveryDecision(snapshot(), { ...approval(), noticeIds: [...snapshot().noticeIds, ...snapshot().noticeIds] }, "human-admin", now));
});

test("snapshot projection is machine-bound, immutable, monotonic and duplicate-safe", async () => {
  let row: any = null; const tx: any = { vaultFinancialRecoverySnapshot: { findUnique: async ({ where }: any) => row?.generation === where.machineId_generation?.generation ? row : null,
    findFirst: async () => row, create: async ({ data }: any) => { row = data; } } };
  await projectFinancialRecoverySnapshot(tx, machineId, snapshot()); await projectFinancialRecoverySnapshot(tx, machineId, snapshot());
  await assert.rejects(projectFinancialRecoverySnapshot(tx, machineId, { ...snapshot(), stateDigest: "b".repeat(64) }));
  await assert.rejects(projectFinancialRecoverySnapshot(tx, uuid(99), snapshot()));
  await projectFinancialRecoverySnapshot(tx, machineId, { ...snapshot(), generation: 3, snapshotId: uuid(33) });
  await assert.rejects(projectFinancialRecoverySnapshot(tx, machineId, { ...snapshot(), generation: 2, snapshotId: uuid(22) }));
});

test("machine recovery feed delivers only approved unexpired exact decisions", async () => {
  let query: any; const tx: any = { vaultFinancialRecoveryDecision: { findMany: async (value: any) => { query = value; return [{ id: uuid(5), decision: decision() }]; } } };
  const result = await financialRecoveryHints(tx, machineId, now);
  assert.equal(result.instruction, "FINANCIAL_RECOVERY_ONLY"); assert.deepEqual(query.where, { machineId, state: "APPROVED", expiresAt: { gt: now } });
  await assert.rejects(financialRecoveryHints(tx, uuid(99), now));
});

test("external review preserves UNKNOWN, original capture and stock and never counts as confirmed compensation", async () => {
  const approved: any = { id: uuid(5), machineId, decision: decision(), state: "APPROVED", approvedAt: now, expiresAt: new Date(decision().expiresAt) };
  const voidRow: any = { id: actionId, machineId, saleId, state: "UNKNOWN", externalReviewedAt: null };
  let resolved = 0; const tx: any = { vaultFinancialRecoveryDecision: { findUnique: async () => approved, update: async ({ data }: any) => Object.assign(approved, data) },
    vaultPaymentAction: { findUnique: async () => voidRow, update: async ({ data }: any) => Object.assign(voidRow, data) },
    vaultPaymentEvidenceAnomaly: { updateMany: async () => { resolved++; } } };
  const sale = { ...paidSale(), paymentAction: voidRow }; const total = salesTotals([sale]);
  await projectFinancialRecoveryApplied(tx, machineId, applied(), new Date(now.getTime() + 600000));
  await projectFinancialRecoveryApplied(tx, machineId, applied(), new Date(now.getTime() + 600000));
  assert.equal(voidRow.state, "UNKNOWN"); assert.equal(voidRow.id, actionId); assert.equal(voidRow.externalReview.verifiedFinancialAdjustmentCents, 0);
  assert.equal(approved.state, "APPLIED"); assert.equal(resolved, 1); assert.deepEqual(salesTotals([sale]), total);
  // No sale, door or inventory delegate was available: the projector cannot change them.
});

test("review outcome rejects changed evidence, expired start, superseded approval and a non-UNKNOWN void", async () => {
  for (const kind of ["changed", "expired", "superseded", "voided"]) {
    const approved: any = { id: uuid(5), machineId, decision: decision(), state: kind === "superseded" ? "SUPERSEDED" : "APPROVED", approvedAt: now, expiresAt: new Date(decision().expiresAt) };
    const tx: any = { vaultFinancialRecoveryDecision: { findUnique: async () => approved }, vaultPaymentAction: { findUnique: async () => ({ machineId, state: kind === "voided" ? "VOIDED" : "UNKNOWN" }) } };
    const payload = { ...applied(), ...(kind === "changed" ? { evidenceDigest: "b".repeat(64) } : {}), ...(kind === "expired" ? { startedAt: new Date(now.getTime() + 300001).toISOString() } : {}) };
    await assert.rejects(projectFinancialRecoveryApplied(tx, machineId, payload, new Date(now.getTime() + 600000)));
  }
});

test("supersession retires only obsolete review authority without resolving evidence or replacing UNKNOWN action identity", async () => {
  const approved: any = { id: uuid(5), machineId, decision: decision(), state: "APPROVED" };
  const current = { id: uuid(6), machineId, stateDigest: "b".repeat(64) };
  const tx: any = { vaultFinancialRecoveryDecision: { findUnique: async () => approved, update: async ({ data }: any) => Object.assign(approved, data) },
    vaultFinancialRecoverySnapshot: { findUnique: async () => current } };
  const payload = { decisionId: uuid(5), snapshotId: uuid(4), stateDigest: hash, generation: 1, currentSnapshotId: current.id, currentStateDigest: current.stateDigest, reason: "EVIDENCE_CHANGED" };
  await projectFinancialRecoverySuperseded(tx, machineId, payload); await projectFinancialRecoverySuperseded(tx, machineId, payload);
  assert.equal(approved.state, "SUPERSEDED"); assert.deepEqual(approved.decision, decision());
  await assert.rejects(projectFinancialRecoverySuperseded(tx, machineId, { ...payload, currentStateDigest: hash }));
});

test("only bound machine proof retires an expired unstarted approval and frees sale ownership", async () => {
  const a = action(), row: any = { id: actionId, machineId, saleId, originalSaleId: saleId, state: "APPROVED", action: a, expiresAt: new Date(a.expiresAt) };
  let writes = 0; const tx: any = { vaultPaymentAction: { findUnique: async () => row, update: async ({ data }: any) => { writes++; Object.assign(row, data); } } };
  await projectVoidRetiredUnstarted(tx, machineId, retirement(), new Date(a.expiresAt));
  await projectVoidRetiredUnstarted(tx, machineId, retirement(), new Date(a.expiresAt));
  assert.equal(row.state, "RETIRED_UNSTARTED"); assert.equal(row.saleId, null); assert.equal(row.originalSaleId, saleId); assert.equal(writes, 1);
  assert.deepEqual(row.action, a); assert.equal(vaultPaymentActionAdminDto(row).saleId, saleId);
  assert.equal(prepareVaultPaymentVoidAction(paidSale(), { actionId: uuid(9), saleId, amountCents: 2700, reason: "Fresh replacement after proven no transport", confirmFullSaleVoid: true }, "human-admin", new Date(a.expiresAt)).actionId, uuid(9));
});

test("retirement cannot release a started or UNKNOWN action and rejects false or mismatched proof", async () => {
  for (const patch of [{ state: "UNKNOWN" }, { state: "EXECUTING" }, { intentObservedAt: now }, { outcomeObservedAt: now }, { externalReviewedAt: now }]) {
    const row = { id: actionId, machineId, saleId, state: "APPROVED", action: action(), expiresAt: new Date(action().expiresAt), ...patch };
    const tx: any = { vaultPaymentAction: { findUnique: async () => row } };
    await assert.rejects(projectVoidRetiredUnstarted(tx, machineId, retirement(), new Date(action().expiresAt)));
  }
  const tx: any = { vaultPaymentAction: { findUnique: async () => ({ machineId, action: action(), expiresAt: new Date(action().expiresAt) }) } };
  for (const patch of [{ actionDigest: "b".repeat(64) }, { saleId: uuid(99) }, { providerTransportAbsent: false }, { retiredAt: now.toISOString() }]) await assert.rejects(projectVoidRetiredUnstarted(tx, machineId, { ...retirement(), ...patch }, new Date(action().expiresAt)));
});

test("new machine event envelopes route through strict projection and reject pretend financial adjustments", async () => {
  const envelope = (payload: any) => normalizeTypedVaultEvent({ schemaVersion: 1, eventId: uuid(77), machineId, sequence: 1, type: "FINANCIAL_RECOVERY_APPLIED", mode: "CERTIFICATION", occurredAt: now.toISOString(), payload } as any);
  assert.throws(() => envelope({ ...applied(), verifiedFinancialAdjustmentCents: 2700 }));
  await assert.rejects(projectVaultMachineEvent({ vaultFinancialRecoveryDecision: { findUnique: async () => null } } as any, envelope(applied())));
});

test("admin evidence export contains bounded safe references and machine-wide orphan count", async () => {
  const row = { id: actionId, machineId, saleId, state: "UNKNOWN", action: action(), externalReview: { source: "EXTERNAL_HUMAN_REVIEW" } };
  const tx: any = { vaultFinancialRecoverySnapshot: { findFirst: async () => ({ snapshot: snapshot(), receivedAt: now }) },
    vaultSparkObservation: { aggregate: async () => ({ _count: { _all: 0 }, _max: { receivedAt: null, receiptSequence: null } }) },
    vaultPaymentAction: { findMany: async () => [row], aggregate: async () => ({ _count: { _all: 1 }, _min: { approvedAt: now } }) }, vaultPaymentEvidenceAnomaly: { findMany: async () => [], count: async () => 2 },
    vaultFinancialRecoveryDecision: { findMany: async () => [{ decision: decision(), state: "APPROVED" }] } };
  const view = await financialRecoveryAdminView(tx, machineId);
  assert.equal(view.unresolvedOrphanCount, 2); assert.equal(view.actions[0]!.actionId, actionId); assert.equal(view.truncatedAt, 100);
  assert.ok(!JSON.stringify(view).includes("providerTransactionReference")); assert.match(view.financialEvidencePolicy, /does not establish provider-confirmed funds/);
});

test('operational summary uses scoped aggregate fields only and serializes large receipt cursors losslessly', async () => {
  const queries: any[] = [];
  const tx: any = { vaultSparkObservation: { aggregate: async (query: any) => { queries.push(query); return { _count: { _all: 25 }, _max: { receivedAt: new Date(now.getTime() - 91000), receiptSequence: 9223372036854775807n } }; } },
    vaultPaymentAction: { aggregate: async (query: any) => { queries.push(query); return { _count: { _all: 3 }, _min: { approvedAt: new Date(now.getTime() - 900000) } }; } } };
  const summary = await financialRecoveryOperationalSummary(tx, machineId, now);
  assert.deepEqual(queries[0], { where: { machineId }, _count: { _all: true }, _max: { receivedAt: true, receiptSequence: true } });
  assert.deepEqual(queries[1], { where: { machineId, externalReviewedAt: null, state: { in: ['APPROVED', 'EXECUTING', 'UNKNOWN'] } }, _count: { _all: true }, _min: { approvedAt: true } });
  assert.equal(summary.callbacks.secondsSinceLatestReceipt, 91); assert.equal(summary.callbacks.latestReceiptSequence, '9223372036854775807');
  assert.equal(summary.pendingActions.oldestApprovalAgeSeconds, 900); assert.equal(summary.pendingActions.count, 3);
  assert.equal(JSON.parse(JSON.stringify(summary)).callbacks.receiptCount, 25);
  assert.match(summary.timingMeaning, /age alone does not establish a missing callback or payment outcome/);
});

test('empty or future operational timestamps remain explicit null ages and never imply lost payment', async () => {
  for (const at of [null, new Date(now.getTime() + 60000)]) {
    const tx: any = { vaultSparkObservation: { aggregate: async () => ({ _count: { _all: at ? 1 : 0 }, _max: { receivedAt: at, receiptSequence: at ? 1n : null } }) },
      vaultPaymentAction: { aggregate: async () => ({ _count: { _all: at ? 1 : 0 }, _min: { approvedAt: at } }) } };
    const summary = await financialRecoveryOperationalSummary(tx, machineId, now);
    assert.equal(summary.callbacks.secondsSinceLatestReceipt, null); assert.equal(summary.pendingActions.oldestApprovalAgeSeconds, null);
    assert.equal(summary.callbacks.latestReceivedAt, at?.toISOString() ?? null);
    assert.equal('missingCallback' in summary, false); assert.equal('paymentConfirmed' in summary, false);
  }
});
