import test from "node:test";
import assert from "node:assert/strict";
import { prepareVaultPaymentVoidAction, vaultPaymentActionHints } from "../lib/server/vaultV1/paymentActions";
import { normalizeTypedVaultEvent, projectVaultMachineEvent } from "../lib/server/vaultV1/events";
import { salesTotals } from "../lib/server/vaultV1/reporting";
import { vaultOfficialPaymentEvidenceProfile, evaluateVaultCertificationApproval } from "../lib/server/vaultV1/certification";

const machineId = "00000000-0000-4000-8000-000000000001";
const saleId = "00000000-0000-4000-8000-000000000002";
const actionId = "00000000-0000-4000-8000-000000000003";
const hash = "a".repeat(64);
const reference = `sha256:${hash}`;
const now = new Date("2026-10-07T12:00:00.000Z");
const input = { actionId, saleId, amountCents: 2700, reason: "Reviewed service failure", confirmFullSaleVoid: true as const };
function paidSale() {
  return { id: saleId, machineId, localTransactionId: saleId, mode: "CERTIFICATION", providerName: "NAYAX_SPARK", paymentState: "SETTLED", settlementState: "SETTLED", totalCents: 2700, taxCents: 200, currency: "USD",
    providerEvidence: { captureConfirmed: true, paymentBindingDigest: hash }, providerSessionId: reference, providerTransactionId: reference,
    customerDoneAt: now, authorizationObservedAt: now, items: [{ initialCommandTerminalAt: now }], supportCases: [], paymentAnomalies: [], paymentAction: null };
}
function envelope(type: string, payload: Record<string, unknown>, sequence = 1) {
  return normalizeTypedVaultEvent({ schemaVersion: 1, eventId: `00000000-0000-4000-8000-${String(sequence + 20).padStart(12, "0")}`, machineId,
    sequence, type, mode: "CERTIFICATION", occurredAt: new Date(now.getTime() + 1000).toISOString(), correlationId: saleId, payload } as any);
}
function actionPayload() {
  return { actionId, saleId, paymentProvider: "NAYAX_SPARK", paymentBindingDigest: hash, providerSessionReference: reference, providerTransactionReference: reference,
    amountCents: input.amountCents, currency: "USD", approvedByAdminId: "admin-user", reason: input.reason };
}

test("full paid void approval is exact, bounded, and unavailable before recovery or after prior compensation", () => {
  const action = prepareVaultPaymentVoidAction(paidSale(), input, "admin-user", now);
  assert.equal(action.amountCents, 2700); assert.equal(Date.parse(action.expiresAt) - Date.parse(action.approvedAt), 300_000);
  assert.equal(action.providerSessionReference, reference);
  for (const change of [{ providerName: "STRIPE_TERMINAL" }, { paymentState: "AUTHORIZED" }, { customerDoneAt: null }, { items: [{ initialCommandTerminalAt: null }] },
    { items: [{ initialCommandTerminalAt: now, retryCommandId: "retry", retryCommandTerminalAt: null }] }, { paymentAction: { state: "DECLINED" } },
    { paymentAnomalies: [{ resolvedAt: null }] }, { supportCases: [{ financialResolution: { resolutionType: "REFUND_RECORDED" } }] },
    { providerEvidence: { captureConfirmed: true } }]) assert.throws(() => prepareVaultPaymentVoidAction({ ...paidSale(), ...change }, input, "admin-user", now));
  assert.throws(() => prepareVaultPaymentVoidAction(paidSale(), { ...input, amountCents: 2500 }, "admin-user", now));
  assert.throws(() => prepareVaultPaymentVoidAction({ ...paidSale(), machineOrphanPaymentAnomalies: [{ noticeId: "orphan", resolvedAt: null }] }, input, "admin-user", now));
  const reviewed = prepareVaultPaymentVoidAction({ ...paidSale(), paymentAnomalies: [{ noticeId: "sale-notice", resolvedAt: now }], machineOrphanPaymentAnomalies: [{ noticeId: "orphan-notice", resolvedAt: now }] }, input, "admin-user", now);
  assert.deepEqual(reviewed.reviewedNoticeIds, ["orphan-notice", "sale-notice"]);
});

test("machine action polling preserves expired started actions without inventing a new approval", async () => {
  const action = prepareVaultPaymentVoidAction(paidSale(), input, "admin-user", now);
  let query: any;
  const db: any = { vaultPaymentAction: { findMany: async (value: any) => { query = value; return [{ id: actionId, machineId, action, state: "UNKNOWN" }]; } } };
  const result = await vaultPaymentActionHints(db, machineId, new Date(now.getTime() + 600_000));
  assert.equal(result.actions[0]!.expiresAt, action.expiresAt);
  assert.deepEqual(query.where.state, { in: ["APPROVED", "EXECUTING", "UNKNOWN"] });
  assert.equal(query.where.externalReviewedAt, null);
  assert.equal(result.instruction, "APPROVED_PAYMENT_ACTIONS_ONLY");
  await assert.rejects(vaultPaymentActionHints(db, "00000000-0000-4000-8000-000000000099", now), /binding/);
});

test("late captured quarantine is ingested as financial evidence without sale or door mutation", async () => {
  const notices: any[] = []; const cases: any[] = [];
  const tx: any = { vaultSale: { findFirst: async () => ({ ...paidSale(), paymentState: "CANCELLED", fulfillmentState: "NOT_COMMITTED" }) },
    vaultPaymentEvidenceAnomaly: { findUnique: async () => null, create: async ({ data }: any) => { notices.push(data); } },
    vaultSupportCase: { upsert: async (data: any) => { cases.push(data); } } };
  const event = envelope("PAYMENT_CALLBACK_QUARANTINED", { callbackId: "late-paid", sequence: 4, state: "SETTLED", disposition: "STATE_CONFLICT", captureConfirmed: true,
    paymentProvider: "NAYAX_SPARK", paymentBindingDigest: hash, providerSessionReference: reference, providerTransactionReference: reference });
  await projectVaultMachineEvent(tx, event);
  assert.equal(notices.length, 1); assert.equal(notices[0].amountCents, 2700); assert.equal(notices[0].captureConfirmed, true);
  assert.equal(cases.length, 2); assert.equal(notices[0].code, "LATE_CAPTURE_STATE_CONFLICT");
});

test("orphan financial evidence remains durable and conflicting duplicate evidence is rejected", async () => {
  let stored: any; let support = 0;
  const tx: any = { vaultSale: { findFirst: async () => null }, vaultPaymentEvidenceAnomaly: { findUnique: async () => stored, create: async ({ data }: any) => { stored = data; } },
    vaultSupportCase: { upsert: async () => { support++; } } };
  const payload = { noticeId: "orphan", saleId, paymentProvider: "NAYAX_SPARK", paymentBindingDigest: hash, providerSessionReference: reference, providerTransactionReference: reference,
    amountCents: 2700, currency: "USD", captureConfirmed: true, code: "ORPHAN_CAPTURE" };
  await projectVaultMachineEvent(tx, envelope("PAYMENT_EVIDENCE_ANOMALY", payload));
  assert.equal(stored.saleId, null); assert.equal(stored.amountCents, 2700);
  await projectVaultMachineEvent(tx, envelope("PAYMENT_EVIDENCE_ANOMALY", payload, 2)); assert.equal(support, 2);
  await assert.rejects(projectVaultMachineEvent(tx, envelope("PAYMENT_EVIDENCE_ANOMALY", { ...payload, amountCents: 2800 }, 3)), /cannot change/);
});

test("void projection binds approved content, requires intent, and never rewrites capture or fulfillment", async () => {
  const action = prepareVaultPaymentVoidAction(paidSale(), input, "admin-user", now);
  const row: any = { id: actionId, machineId, saleId, state: "APPROVED", action, approvedAt: now, expiresAt: new Date(action.expiresAt), intentObservedAt: null };
  const tx: any = { vaultPaymentAction: { findUnique: async () => row, update: async ({ data }: any) => Object.assign(row, data) },
    vaultSale: { findFirst: async () => paidSale() }, vaultSupportCase: { upsert: async () => {} } };
  const result = { ...actionPayload(), state: "VOIDED", evidenceReference: reference };
  await assert.rejects(projectVaultMachineEvent(tx, envelope("PAYMENT_VOID_OUTCOME_RECORDED", result)), /prior durable intent/);
  await assert.rejects(projectVaultMachineEvent(tx, envelope("PAYMENT_VOID_INTENT_RECORDED", { ...actionPayload(), amountCents: 2600 })), /differs/);
  await projectVaultMachineEvent(tx, envelope("PAYMENT_VOID_INTENT_RECORDED", actionPayload())); assert.equal(row.state, "EXECUTING");
  await projectVaultMachineEvent(tx, envelope("PAYMENT_VOID_OUTCOME_RECORDED", { ...result, state: "UNKNOWN" }, 2)); assert.equal(row.state, "UNKNOWN");
  await projectVaultMachineEvent(tx, envelope("PAYMENT_VOID_OUTCOME_RECORDED", result, 3)); assert.equal(row.state, "VOIDED");
  await projectVaultMachineEvent(tx, envelope("PAYMENT_VOID_OUTCOME_RECORDED", { ...result, state: "DECLINED" }, 4)); assert.equal(row.state, "VOIDED");
});

test("reports adjust only confirmed provider voids and retain gross amounts, tax and discrepancies", () => {
  const first: any = { ...paidSale(), paymentAction: { state: "VOIDED" } };
  const second: any = { ...paidSale(), paymentAction: { state: "UNKNOWN" }, paymentAnomalies: [{ resolvedAt: null }], financialResolution: { resolutionType: "REFUND_RECORDED", amountCents: 2700 } };
  const totals = salesTotals([first, second]);
  assert.equal(totals.settledCents, 5400); assert.equal(totals.confirmedVoidCents, 2700); assert.equal(totals.netSettledCents, 2700);
  assert.equal(totals.taxCents, 400); assert.equal(totals.netTaxCents, 200); assert.equal(totals.unresolvedFinancialCount, 2);
});

test("Spark official evidence collection requires its explicit supported flow identity", () => {
  const identity = { provider: "NAYAX_SPARK", mode: "OFFICIAL_TEST", bindingDigest: hash, captureBeforeFulfillment: true,
    flow: "REMOTE_START_PRE_SELECTION", acquiringOnlyConfirmed: true, preSelectionConfirmed: true, sandboxConfirmed: true };
  assert.equal(vaultOfficialPaymentEvidenceProfile(identity), true);
  for (const change of [{ flow: "DEVICE_START" }, { sandboxConfirmed: false }, { acquiringOnlyConfirmed: false }, { bindingDigest: undefined }, { mode: "MOCK" }]) assert.equal(vaultOfficialPaymentEvidenceProfile({ ...identity, ...change }), false);
  const partial: any = { status: "REVIEW_REQUIRED", sourceCommit: "a".repeat(40), appBuild: "test", localSchemaVersion: 5, contractVersion: 1, configVersion: { digest: hash }, paymentAdapterVersion: "test", paymentApiVersion: "v3", paymentFlowConfig: identity, controllerIdentity: { mode: "OFFICIAL_TEST" }, hardwareIdentity: {}, evidenceSummary: {}, unresolvedDeviations: [], evidence: [] };
  assert.ok(evaluateVaultCertificationApproval(partial).reasons.includes("NAYAX_INTEGRATION_CERTIFICATION_REQUIRED"));
  partial.evidenceSummary = { providerCertification: { provider: "NAYAX_SPARK", paymentBindingDigest: hash, artifactVerified: true, digest: hash, artifactStorageKey: "vault-certification/session/nayax-letter.pdf" } };
  assert.equal(evaluateVaultCertificationApproval(partial).reasons.includes("NAYAX_INTEGRATION_CERTIFICATION_REQUIRED"), false);
  assert.equal(evaluateVaultCertificationApproval(partial).eligible, false);
});
