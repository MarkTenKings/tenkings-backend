import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { prisma } from "@tenkings/database";
import type { NextApiRequest, NextApiResponse } from "next";
import handler from "../pages/api/vault/v1/admin/[...path]";
import { publishVaultConfig } from "../lib/server/vaultV1/config";
import { machineLocalDate, salesTotals, vaultMachineDto } from "../lib/server/vaultV1/reporting";
import { requireVaultAdmin, requireVaultHumanSession, requireVaultJson, writeVaultAdminAudit } from "../lib/server/vaultV1/http";
import { verifyVaultArtifact, verifyVaultAutomatedProof, vaultCertificateMatchesReportedBuild } from "../lib/server/vaultV1/certification";

const machineId = "00000000-0000-4000-8000-000000000001";
const secondMachine = "00000000-0000-4000-8000-000000000002";
const configId = "00000000-0000-4000-8000-000000000003";
const userId = "vault-scope-only-staff";
const token = "vault-unit-test-human-session";
const digest = "a".repeat(64);
const uuid = (value: number) => `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
function stub(t: TestContext, object: any, key: string, implementation: any) {
  const original = object[key]; object[key] = implementation;
  t.after(() => { object[key] = original; });
}

function machine() {
  return { id: machineId, slug: "test", displayName: "Test Vault", lastEventSequence: 1234567890123456789n, lastHeartbeatAt: new Date(), lastCloudObservedAt: new Date(), health: "READY", status: "ENROLLED", serviceLocked: false, doors: [], configs: [], _count: { supportCases: 0 } };
}

async function request(path: string[], body?: unknown, query: Record<string, string> = {}) {
  const result = { status: 200, body: undefined as any, headers: {} as Record<string, string> };
  const res = {
    status(code: number) { result.status = code; return this; },
    json(value: unknown) { result.body = JSON.parse(JSON.stringify(value)); return this; },
    setHeader(key: string, value: string) { result.headers[key] = value; return this; },
  } as unknown as NextApiResponse;
  await handler({ method: body === undefined ? "GET" : "POST", query: { ...query, path }, body, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-vault-contract-version": "1" }, socket: {} } as unknown as NextApiRequest, res);
  return result;
}

async function withAuthority(t: TestContext, owner: boolean, work: () => Promise<void>) {
  const priorOwners = process.env.VAULT_OWNER_ADMIN_USER_IDS;
  process.env.VAULT_OWNER_ADMIN_USER_IDS = owner ? userId : "";
  stub(t, globalThis, "fetch", async () => { throw new Error("Tests prohibit all external requests"); });
  stub(t, prisma.session, "findUnique", async () => ({ id: "human-session", tokenHash: createHash("sha256").update(token).digest("hex"), createdAt: new Date(Date.now() - 1000), expiresAt: new Date(Date.now() + 60000), user: { id: userId, phone: null, displayName: "Test human" } }));
  stub(t, prisma.vaultStaffMachineAccess, "findMany", async (input: any) => owner || input.where.machineId && input.where.machineId !== machineId ? [] : [{ machineId, userId, grantId: uuid(4), grantVersion: 1, verifierVersion: 1, role: "TECHNICIAN", status: "ACTIVE", validFrom: new Date(0), expiresAt: new Date(Date.now() + 60000) }]);
  stub(t, prisma.vaultAdminAuditEvent, "create", async () => ({}));
  stub(t, prisma, "$transaction", async (work: any) => work(prisma));
  stub(t, prisma, "$queryRaw", async () => []);
  try { await work(); } finally { if (priorOwners === undefined) delete process.env.VAULT_OWNER_ADMIN_USER_IDS; else process.env.VAULT_OWNER_ADMIN_USER_IDS = priorOwners; t.mock.restoreAll(); }
}

test("populated fleet uses JSON-safe sequences and server-observed readiness", async (t) => withAuthority(t, true, async () => {
  const stale = { ...machine(), lastCloudObservedAt: new Date(Date.now() - 600000) };
  stub(t, prisma.vaultMachine, "findMany", async () => [machine(), stale]);
  const result = await request(["fleet"]);
  assert.equal(result.status, 200);
  assert.equal(result.body.machines[0].lastEventSequence, "1234567890123456789");
  assert.equal(result.body.summary.salesReady, 1);
  assert.equal(result.body.machines[1].online, false);
  assert.equal(vaultMachineDto({ ...machine(), status: "DECOMMISSIONED" }).salesReady, false);
}));

function capturedSparkSale() {
  return { id: uuid(900), machineId, localTransactionId: uuid(900), mode: "CERTIFICATION", providerName: "NAYAX_SPARK", paymentState: "SETTLED", settlementState: "SETTLED", currency: "USD", totalCents: 2700,
    providerEvidence: { captureConfirmed: true, paymentBindingDigest: digest }, providerSessionId: `sha256:${digest}`, providerTransactionId: `sha256:${digest}`,
    customerDoneAt: new Date(), items: [{ initialCommandTerminalAt: new Date() }], supportCases: [], paymentAnomalies: [], paymentAction: null };
}

test("paid void approval requires fresh admin authority and rejects technicians before creating an action", async (t) => withAuthority(t, false, async () => {
  stub(t, prisma.vaultSale, "findUnique", async () => ({ machineId }));
  let writes = 0; stub(t, prisma.vaultPaymentAction, "create", async () => { writes++; });
  const denied = await request(["payment-actions"], { actionId: uuid(901), saleId: uuid(900), amountCents: 2700, reason: "Reviewed failed service", confirmFullSaleVoid: true });
  assert.equal(denied.status, 403); assert.equal(writes, 0);
}));

test("fresh paid void approval creates one exact action, replay is stable, and amount edits conflict", async (t) => withAuthority(t, true, async () => {
  const sale = capturedSparkSale(); let saved: any; let writes = 0;
  stub(t, prisma.vaultSale, "findUnique", async (query: any) => query.select ? { machineId } : sale);
  stub(t, prisma.vaultPaymentAction, "findUnique", async () => saved ?? null);
  stub(t, prisma.vaultPaymentEvidenceAnomaly, "findMany", async () => []);
  stub(t, prisma.vaultPaymentAction, "create", async ({ data }: any) => { writes++; saved = { ...data, state: "APPROVED" }; return saved; });
  const body = { actionId: uuid(901), saleId: sale.id, amountCents: 2700, reason: "Reviewed failed service", confirmFullSaleVoid: true };
  const approved = await request(["payment-actions"], body);
  assert.equal(approved.status, 201); assert.equal(approved.body.externalPaymentActionExecuted, false);
  assert.equal(approved.body.paymentAction.amountCents, 2700);
  assert.equal(Date.parse(saved.action.expiresAt) - Date.parse(saved.action.approvedAt), 300_000);
  assert.equal((await request(["payment-actions"], body)).status, 201); assert.equal(writes, 1);
  assert.equal((await request(["payment-actions"], { ...body, amountCents: 2600 })).status, 409); assert.equal(writes, 1);
}));

test("paid void refuses stale human authentication even for an owner", async (t) => withAuthority(t, true, async () => {
  stub(t, prisma.vaultSale, "findUnique", async () => ({ machineId }));
  stub(t, prisma.session, "findUnique", async () => ({ id: "old", tokenHash: createHash("sha256").update(token).digest("hex"), createdAt: new Date(Date.now() - 3600000), expiresAt: new Date(Date.now() + 60000), user: { id: userId } }));
  const denied = await request(["payment-actions"], { actionId: uuid(901), saleId: uuid(900), amountCents: 2700, reason: "Reviewed failed service", confirmFullSaleVoid: true });
  assert.equal(denied.status, 403);
}));

test("explicit financial review resolves only its linked anomaly without treating annotation as a provider operation", async (t) => withAuthority(t, true, async () => {
  const noticeId = `sha256:${digest}`;
  const supportCase = { id: uuid(902), machineId, saleId: uuid(900), reconciliationSnapshot: { noticeId, provider: "NAYAX_SPARK", amountCents: 2700, currency: "USD", captureConfirmed: true, code: "LATE_CAPTURE" } };
  stub(t, prisma.vaultSupportCase, "findUnique", async () => supportCase);
  stub(t, prisma.vaultSupportCase, "update", async ({ data }: any) => ({ ...supportCase, ...data }));
  const reviews: any[] = [];
  stub(t, prisma.vaultPaymentEvidenceAnomaly, "updateMany", async (query: any) => { reviews.push(query); return { count: 1 }; });
  const body = { caseId: supportCase.id, status: "RESOLVED", resolutionReason: "Reviewed original provider evidence" };
  assert.equal((await request(["support-cases"], body)).status, 400); assert.equal(reviews.length, 0);
  const resolved = await request(["support-cases"], { ...body, financialResolution: { resolutionType: "NO_EXTERNAL_ACTION", amountCents: null, currency: "USD", note: "Reviewed the exact transaction", recordedAt: new Date().toISOString() } });
  assert.equal(resolved.status, 200); assert.equal(resolved.body.externalPaymentActionExecuted, false);
  assert.deepEqual(reviews[0].where, { machineId, noticeId, saleId: supportCase.saleId, resolvedAt: null });
}));

test("Vault-only technician identity gets machine scope without global platform-admin role", async (t) => withAuthority(t, false, async () => {
  let filter: any;
  stub(t, prisma.vaultCertificationSession, "findMany", async (input: any) => { filter = input.where; return []; });
  assert.equal((await request(["certification"], undefined, { machineId })).status, 200);
  assert.deepEqual(filter, { machine: { id: machineId } });
  assert.equal((await request(["certification"], undefined, { machineId: secondMachine })).status, 403);
  assert.equal((await request(["sales"])).status, 403);
  const unauthenticated = await request(["access"]);
  assert.equal(unauthenticated.body.owner, false);
  assert.equal(unauthenticated.body.allowed, true);
}));

test("config publication cannot replace a newer active or pending version", async (t) => withAuthority(t, true, async () => {
  stub(t, prisma.vaultConfigVersion, "findUnique", async (input: any) => input.select ? { machineId } : { id: configId, machineId, version: 3, status: "DRAFT", expiresAt: new Date(Date.now() + 60000), machine: { activeConfig: { version: 2 }, pendingConfig: { version: 4 }, activeConfigId: uuid(20), pendingConfigId: uuid(21) } });
  await assert.rejects(publishVaultConfig(configId, userId), (error: any) => error.code === "CONFIG_VERSION_STALE");
}));

test("chunked per-action body limits apply independently of shared parser ceiling", () => {
  assert.throws(() => requireVaultJson({ headers: { "x-vault-contract-version": "1", "content-type": "application/json" }, body: { text: "x".repeat(5000) } } as unknown as NextApiRequest, 1024), (error: any) => error.statusCode === 413);
});

test("sales totals include every matching sale beyond the first 250 and paginate independently", async (t) => withAuthority(t, true, async () => {
  const sales = Array.from({ length: 551 }, (_, index) => ({ id: uuid(index + 100), machineId, machineTimezone: "America/Los_Angeles", mode: "PRODUCTION", totalCents: 2500, taxCents: 0, authorizationObservedAt: new Date(), settlementState: "SETTLED", createdAt: new Date("2026-09-07T07:00:00.000Z"), items: [], machine: { displayName: "Test", slug: "test" } }));
  stub(t, prisma.vaultSale, "findMany", async (input: any) => { const offset = input.cursor ? sales.findIndex((sale) => sale.id === input.cursor.id) + 1 : 0; return sales.slice(offset, offset + input.take); });
  const first = await request(["sales"], undefined, { from: "2026-09-07", through: "2026-09-07" });
  assert.equal(first.status, 200);
  assert.equal(first.body.sales.length, 250);
  assert.equal(first.body.totalCount, 551);
  assert.equal(first.body.totals.settledCents, 551 * 2500);
  const next = await request(["sales"], undefined, { cursor: first.body.nextCursor });
  assert.equal(next.body.sales[0].id, sales[250]!.id);
  assert.equal(next.body.totals.settledCents, first.body.totals.settledCents);
  assert.equal(machineLocalDate(new Date("2026-03-08T07:59:59Z"), "America/Los_Angeles"), "2026-03-07");
  assert.equal(machineLocalDate(new Date("2026-03-08T08:00:00Z"), "America/Los_Angeles"), "2026-03-08");
  assert.equal(salesTotals([{ authorizationObservedAt: new Date(), settlementState: "RECONCILIATION_REQUIRED", totalCents: 1000, taxCents: 80 }]).authorizedCents, 1000);
}));

test("door plan requires the exact preview digest and a human-entered confirmation", async (t) => withAuthority(t, true, async () => {
  stub(t, prisma.vaultMachine, "findUnique", async () => ({ slug: "test" }));
  stub(t, prisma.vaultDoor, "findMany", async () => [{ doorId: "X-01", plannedProductId: null, state: "EMPTY" }]);
  stub(t, prisma.vaultProduct, "count", async () => 1);
  let mutations = 0;
  stub(t, prisma.vaultDoor, "update", async () => { mutations += 1; return {}; });
  const path = ["machines", machineId, "doors", "plan"];
  const input = { assignments: [{ doorId: "X-01", productId: uuid(40) }], reason: "Review exact plan" };
  const preview = await request(path, { ...input, dryRun: true });
  assert.equal(preview.status, 200);
  assert.equal((await request(path, { ...input, dryRun: false, impactDigest: preview.body.impactDigest })).status, 400);
  assert.equal((await request(path, { ...input, dryRun: false, confirmPhrase: "PLAN test", impactDigest: digest })).status, 409);
  assert.equal(mutations, 0);
  assert.equal((await request(path, { ...input, dryRun: false, confirmPhrase: "PLAN test", impactDigest: preview.body.impactDigest })).status, 200);
  assert.equal(mutations, 1);
}));

test("artifact verification reads bounded configured keys, rejects tampering and path traversal", async () => {
  const bytes = Buffer.from("verified evidence");
  const expected = createHash("sha256").update(bytes).digest("hex");
  const key = `vault-certification/${configId}/evidence.json`;
  let reads = 0;
  const read = async (actual: string, maximum: number) => { assert.equal(actual, key); assert.equal(maximum, 1048576); reads += 1; return bytes; };
  assert.deepEqual(await verifyVaultArtifact(key, expected, read as any), bytes);
  await assert.rejects(verifyVaultArtifact(key, digest, read as any), /digest/);
  await assert.rejects(verifyVaultArtifact(`vault-certification/${configId}/../secret`, expected, read as any));
  await assert.rejects(verifyVaultArtifact("https://example.test/evidence", expected, read as any));
  assert.equal(reads, 2);
  await assert.rejects(verifyVaultArtifact(key, expected, async () => Buffer.alloc(1048577)), /byte limit/);
});

test("automated certification counts derive only from unique passing exact-build artifact records", () => {
  const identity = { sourceCommit: "a".repeat(40), appBuild: "0.1.0", localSchemaVersion: 2, contractVersion: 1, configVersion: { digest } };
  const proof = { schemaVersion: 1, sourceCommit: identity.sourceCommit, appBuild: identity.appBuild, localSchemaVersion: 2, contractVersion: 1, configDigest: digest, transactions: Array.from({ length: 1000 }, (_, index) => ({ transactionId: uuid(index + 100), result: "PASS", evidenceDigest: digest })) };
  const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
  assert.equal(verifyVaultAutomatedProof(bytes(proof), identity), 1000);
  assert.throws(() => verifyVaultAutomatedProof(bytes({ ...proof, automatedTransactions: 999999, transactions: undefined }), identity));
  assert.throws(() => verifyVaultAutomatedProof(bytes({ ...proof, transactions: proof.transactions.slice(0, 999) }), identity));
  assert.throws(() => verifyVaultAutomatedProof(bytes({ ...proof, transactions: proof.transactions.map(() => proof.transactions[0]) }), identity));
  assert.throws(() => verifyVaultAutomatedProof(bytes({ ...proof, sourceCommit: "b".repeat(40) }), identity));
  assert.throws(() => verifyVaultAutomatedProof(bytes({ ...proof, localSchemaVersion: 1 }), identity));
  assert.throws(() => verifyVaultAutomatedProof(bytes({ ...proof, transactions: proof.transactions.map((row, index) => index === 0 ? { ...row, result: "FAIL" } : row) }), identity));
});

test("certification mutation union parses approval and artifact requests without a discriminator runtime crash", async (t) => withAuthority(t, true, async () => {
  stub(t, prisma.vaultCertificationSession, "findUnique", async () => null);
  assert.equal((await request(["certification"], { action: "approve", certificationId: configId, reason: "Test reviewed approval" })).status, 404);
  assert.equal((await request(["certification"], { action: "verify-artifacts", certificationId: configId, reason: "Verify stored evidence", bindings: [{ evidenceId: uuid(10), artifactStorageKey: `vault-certification/${configId}/evidence.json` }] })).status, 404);
  assert.equal((await request(["certification"], { action: "unreviewed", certificationId: configId, reason: "Reject unknown action" })).status, 400);
}));

test("certificate authority fails closed after config, schema, app or exact-source changes", () => {
  const certificate = { sourceCommit: "a".repeat(40), appBuild: "0.1.0", localSchemaVersion: 2, contractVersion: 1, configVersion: { version: 1, digest } };
  const report = { sourceCommit: certificate.sourceCommit, appVersion: certificate.appBuild, localSchemaVersion: 2, contractVersion: 1, configVersion: 1, configDigest: digest };
  assert.equal(vaultCertificateMatchesReportedBuild(certificate, report), true);
  for (const change of [{ sourceCommit: undefined }, { sourceCommit: "b".repeat(40) }, { appVersion: "0.1.1" }, { localSchemaVersion: 3 }, { contractVersion: 2 }, { configVersion: 2 }, { configDigest: "b".repeat(64) }]) assert.equal(vaultCertificateMatchesReportedBuild(certificate, { ...report, ...change }), false);
});

test("human authorization rejects static credentials, old step-up and revocation before mutation commit", async (t) => withAuthority(t, false, async () => {
  const req = { headers: { authorization: `Bearer ${token}`, "x-vault-contract-version": "1" }, socket: {} } as unknown as NextApiRequest;
  await assert.rejects(requireVaultHumanSession({ ...req, headers: { authorization: "VaultMachine not-a-human" } } as NextApiRequest), (error: any) => error.code === "HUMAN_AUTH_REQUIRED");
  const authority = await requireVaultAdmin(req, { permission: "RESTOCK_RUN", machineId, fresh: true, reason: "Review exact restock" });
  stub(t, prisma.vaultStaffMachineAccess, "findMany", async () => [{ role: "TECHNICIAN", status: "REVOKED", validFrom: new Date(0), expiresAt: new Date(Date.now() + 60000) }]);
  await assert.rejects(writeVaultAdminAudit({ req, authority, machineId, action: "test", outcome: "SUCCESS", tx: prisma as any }), (error: any) => error.code === "HUMAN_AUTHORITY_CHANGED");
  stub(t, prisma.vaultStaffMachineAccess, "findMany", async () => [{ role: "TECHNICIAN", status: "ACTIVE", validFrom: new Date(0), expiresAt: new Date(Date.now() + 60000) }]);
  stub(t, prisma.session, "findUnique", async () => null);
  await assert.rejects(writeVaultAdminAudit({ req, authority, machineId, action: "test", outcome: "SUCCESS", tx: prisma as any }), (error: any) => error.statusCode === 401);
  stub(t, prisma.session, "findUnique", async () => ({ id: "human-session", tokenHash: createHash("sha256").update(token).digest("hex"), createdAt: new Date(Date.now() - 16 * 60000), expiresAt: new Date(Date.now() + 60000), user: { id: userId } }));
  await assert.rejects(requireVaultAdmin(req, { permission: "RESTOCK_RUN", machineId, fresh: true, reason: "Review exact restock" }), (error: any) => error.statusCode === 403);
}));

function financialReviewFixture() {
  const snapshot = { snapshotId: uuid(960), machineId, generation: 1, paymentBindingDigest: digest, stateDigest: digest, providerEvidenceDigest: digest,
    noticeIds: [`sha256:${digest}`], unknownActionIds: [], blockers: [], observedAt: new Date().toISOString() };
  const input = { decisionId: uuid(961), machineId, snapshotId: snapshot.snapshotId, generation: 1, stateDigest: digest, noticeIds: snapshot.noticeIds, unknownActionIds: [],
    evidenceReference: 'external-human-review-123', evidenceDigest: digest, reason: 'Verified the complete financial evidence', confirmReviewed: true };
  return { snapshot, input };
}

test('financial recovery authority requires a fresh authorized human before creating any decision', async t => withAuthority(t, false, async () => {
  let writes = 0; stub(t, prisma.vaultFinancialRecoveryDecision, 'create', async () => { writes++; });
  assert.equal((await request(['financial-recovery'], financialReviewFixture().input)).status, 403); assert.equal(writes, 0);
}));

test('fresh financial review authorizes exactly one current snapshot and exports only bounded evidence', async t => withAuthority(t, true, async () => {
  const { snapshot, input } = financialReviewFixture(); let saved: any, writes = 0;
  stub(t, prisma.vaultMachine, 'findUnique', async () => machine());
  stub(t, prisma.vaultFinancialRecoverySnapshot, 'findFirst', async () => ({ id: snapshot.snapshotId, snapshot, receivedAt: new Date() }));
  stub(t, prisma.vaultFinancialRecoveryDecision, 'findUnique', async () => saved ?? null);
  stub(t, prisma.vaultFinancialRecoveryDecision, 'findFirst', async () => null);
  stub(t, prisma.vaultFinancialRecoveryDecision, 'create', async ({ data }: any) => { writes++; saved = { ...data, state: 'APPROVED' }; return saved; });
  stub(t, prisma.vaultPaymentEvidenceAnomaly, 'count', async () => 1);
  stub(t, prisma.vaultPaymentAction, 'count', async () => 0);
  const result = await request(['financial-recovery'], input);
  assert.equal(result.status, 201); assert.equal(result.body.externalPaymentActionExecuted, false); assert.equal(result.body.decision.approvedByAdminId, userId);
  assert.equal(Date.parse(result.body.decision.expiresAt) - Date.parse(result.body.decision.approvedAt), 300000);
  assert.equal((await request(['financial-recovery'], input)).status, 201); assert.equal(writes, 1);
  assert.equal((await request(['financial-recovery'], { ...input, evidenceDigest: 'b'.repeat(64) })).status, 409);
  stub(t, prisma.vaultPaymentAction, 'findMany', async () => []);
  stub(t, prisma.vaultPaymentEvidenceAnomaly, 'findMany', async () => []);
  stub(t, prisma.vaultFinancialRecoveryDecision, 'findMany', async () => [saved]);
  stub(t, prisma.vaultSparkObservation, 'aggregate', async () => ({ _count: { _all: 0 }, _max: { receivedAt: null, receiptSequence: null } }));
  stub(t, prisma.vaultPaymentAction, 'aggregate', async () => ({ _count: { _all: 0 }, _min: { approvedAt: null } }));
  const exported = await request(['financial-recovery'], undefined, { machineId, download: 'true' });
  assert.equal(exported.status, 200); assert.match(exported.headers['Content-Disposition'], /vault-financial-recovery.json/);
  assert.equal(exported.body.snapshot.stateDigest, digest); assert.equal(exported.body.decisions[0].state, 'APPROVED');
}));

test('financial recovery refuses stale sessions, offline machines, blockers and stale generation', async t => withAuthority(t, true, async () => {
  const { snapshot, input } = financialReviewFixture(); let writes = 0;
  stub(t, prisma.vaultFinancialRecoveryDecision, 'create', async () => { writes++; });
  stub(t, prisma.vaultFinancialRecoveryDecision, 'findUnique', async () => null);
  stub(t, prisma.vaultMachine, 'findUnique', async () => ({ ...machine(), lastCloudObservedAt: new Date(Date.now() - 600000) }));
  assert.equal((await request(['financial-recovery'], input)).body.error.code, 'FINANCIAL_RECOVERY_MACHINE_OFFLINE');
  stub(t, prisma.vaultMachine, 'findUnique', async () => machine());
  stub(t, prisma.vaultFinancialRecoverySnapshot, 'findFirst', async () => ({ id: snapshot.snapshotId, snapshot: { ...snapshot, blockers: ['TECHNICAL_RECOVERY_REQUIRED'] } }));
  assert.equal((await request(['financial-recovery'], input)).status, 409);
  stub(t, prisma.vaultFinancialRecoverySnapshot, 'findFirst', async () => ({ id: snapshot.snapshotId, snapshot }));
  assert.equal((await request(['financial-recovery'], { ...input, generation: 2 })).status, 409);
  stub(t, prisma.session, 'findUnique', async () => ({ id: 'old', tokenHash: createHash('sha256').update(token).digest('hex'), createdAt: new Date(Date.now() - 3600000), expiresAt: new Date(Date.now() + 60000), user: { id: userId } }));
  assert.equal((await request(['financial-recovery'], input)).status, 403); assert.equal(writes, 0);
}));
