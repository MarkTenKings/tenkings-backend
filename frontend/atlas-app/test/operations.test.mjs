import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { StaffOperations } from '../lib/server/access/operations.mjs';
import { canonical } from '../lib/server/review-contract.mjs';
import { hash } from '../lib/server/policy.mjs';

const NOW = new Date('2026-09-08T18:00:00.000Z');
const SHA = 'a'.repeat(64);
const AUTH = () => ({ operationId: randomUUID(), reason: 'Explicit synthetic operator instruction', authorizationEvidenceHash: SHA });
function fixture() {
    const names = ['staffIdentity', 'staffSpecimen', 'staffReviewRevision', 'staffAudit', 'staffAssignment',
        'staffGradingExecution', 'staffGradingOperation', 'staffOperatorRun', 'staffOperatorAttempt', 'staffMachineInitialization',
        'staffWorkspaceSourceOperation', 'staffWorkspaceInfrastructureReservation'];
    const state = Object.fromEntries(names.map(name => [name, []]));
    const actorId = randomUUID(), reviewerId = randomUUID();
    state.staffIdentity.push(...[actorId, reviewerId].map(id => ({ id, role: 'REVIEWER', name: 'Synthetic reviewer',
        accessVersion: 1, revokedAt: null, certificationUntil: null, trustedLearningUntil: null })));
    const match = (row, where = {}) => Object.entries(where).every(([key, value]) => {
        if (value && typeof value === 'object' && !(value instanceof Date)) {
            if (value.in) return value.in.includes(row[key]);
            return match(row, value);
        }
        return row[key] === value;
    });
    let failAudit = false;
    const tx = Object.fromEntries(names.map(name => [name, {
        async findUnique({ where }) { return structuredClone(state[name].find(row => match(row, where)) ?? null); },
        async findMany({ where, take } = {}) { return structuredClone(state[name].filter(row => match(row, where)).slice(0, take)); },
        async create({ data }) {
            if (name === 'staffAudit' && failAudit) throw new Error('INJECTED_AUDIT_FAILURE');
            state[name].push(structuredClone(data)); return structuredClone(data);
        },
        async update({ where, data }) {
            const row = state[name].find(row => match(row, where)); assert.ok(row);
            Object.assign(row, structuredClone(data)); return structuredClone(row);
        },
    }]));
    tx.$queryRaw = async (_query, documentSha256, lineId) => state.staffAudit.filter(row => {
        if (row.event !== 'INVOICE_COST_RECONCILED') return false;
        const invoice = JSON.parse(JSON.parse(row.details).costEvidence).invoice;
        return invoice.documentSha256 === documentSha256 && invoice.lineId === lineId;
    }).map(row => ({ id: row.id }));
    const context = { tx, now: NOW, control: { enabled: true, mode: 'LOCAL_FIXTURE', revision: 1 },
        actorKind: 'HUMAN', capability: 'OPERATIONS', capabilityUntil: new Date(+NOW + 3600_000), operationsGrantId:randomUUID(),
        session: { identityId: actorId, tokenHash: SHA, accessVersion: 1, controlRevision: 1,
            revokedAt: null, createdAt: new Date(+NOW - 60_000), expiresAt: new Date(+NOW + 1200_000) } };
    let transactions = 0, inspections = 0;
    const admin = { async transaction(staff, work) {
        assert.equal(staff, 'opaque-server-handle'); transactions++;
        const before = structuredClone(state);
        try { return await work({ ...context, identity: structuredClone(state.staffIdentity.find(row => row.id === actorId)) }); }
        catch (error) { for (const name of names) state[name] = before[name]; throw error; }
    } };
    const sources = new Map();
    function addSource() {
        const source = { sourceType: 'LOCAL_FIXTURE', sourceId: randomUUID(), sourceOwnerId: 'explicit-known-fixture-owner' };
        const descriptor = { sha256: SHA, byteCount: 123, width: 360, height: 504, contentType: 'image/png', sourceRef: 'private:preserved-source' };
        const evidenceCanonical = canonical({ sides: { FRONT: descriptor, BACK: descriptor }, sourceRevision: NOW.toISOString() });
        const admissionCanonical = canonical({ version: 'synthetic-source-admission-v1', sourceId: source.sourceId,
            sourceOwnerId: source.sourceOwnerId, preserved: true });
        sources.set(source.sourceId, { ...source, title: 'Synthetic card', subtitle: 'Fictional test set', sourceRevision: NOW.toISOString(),
            evidenceCanonical, evidenceHash: hash(evidenceCanonical), admissionCanonical, admissionHash: hash(admissionCanonical) });
        return source;
    }
    const sourceValidation = { async inspect(_context, source) { inspections++; return structuredClone(sources.get(source.sourceId)); } };
    const operations = new StaffOperations({ admin, sourceValidation });
    const staff = 'opaque-server-handle';
    async function intake(source = addSource()) {
        const preview = await operations.previewIntake(staff, source);
        const input = { ...AUTH(), source, sourceBindingHash: preview.sourceBindingHash };
        return { source, preview, input, receipt: await operations.admitIntake(staff, input) };
    }
    return { state, context, operations, admin, sourceValidation, sources, addSource, intake, staff, reviewerId,
        counts: () => ({ transactions, inspections }), failAudit: () => { failAudit = true; } };
}
const rejected = (promise, code) => assert.rejects(promise, error => error.code === code || error.message === code);

test('fresh human capability is required before reads or source inspection', async () => {
    for (const change of [
        ctx => { ctx.actorKind = 'MACHINE'; }, ctx => { ctx.capability = 'REVIEWER'; },
        ctx => { ctx.capabilityUntil = NOW; }, ctx => { ctx.session.createdAt = new Date(+NOW - 300_001); },
        ctx => { ctx.session.createdAt = new Date(+NOW + 1); }, ctx => { ctx.session.revokedAt = NOW; },
        ctx => { ctx.session.accessVersion = 2; }, ctx => { ctx.control.enabled = false; },
    ]) {
        const f = fixture(); change(f.context);
        await rejected(f.operations.previewIntake(f.staff, f.addSource()), 'FRESH_HUMAN_OPERATIONS_REQUIRED');
        assert.equal(f.counts().inspections, 0); assert.equal(f.state.staffSpecimen.length, 0);
    }
});

test('intake preview excludes private references; exact admitted source gets immutable empty draft and admission audit', async () => {
    const f = fixture(), source = f.addSource();
    const preview = await f.operations.previewIntake(f.staff, source);
    assert.equal(f.state.staffSpecimen.length, 0); assert.ok(!JSON.stringify(preview).includes('private:'));
    const input = { ...AUTH(), source, sourceBindingHash: preview.sourceBindingHash };
    const receipt = await f.operations.admitIntake(f.staff, input);
    assert.equal(f.counts().inspections, 2);
    assert.equal(f.state.staffSpecimen[0].sourceOwnerId, source.sourceOwnerId);
    assert.equal(f.state.staffSpecimen[0].analysisRevision, 0);
    assert.deepEqual(JSON.parse(f.state.staffReviewRevision[0].canonical).reviewedSides, []);
    const audit = JSON.parse(f.state.staffAudit[0].details);
    assert.equal(audit.admissionCanonical, f.sources.get(source.sourceId).admissionCanonical);
    assert.equal(audit.receipt.specimenId, receipt.specimenId);
    assert.equal(f.state.staffGradingOperation.length + f.state.staffOperatorRun.length + f.state.staffAssignment.length, 0);
    assert.deepEqual(await f.operations.admitIntake(f.staff, input), receipt);
    assert.equal(f.state.staffSpecimen.length, 1);
});

test('intake rejects source owner substitution, changed preview, incomplete evidence and arbitrary descriptors', async () => {
    for (const change of [
        row => { row.sourceOwnerId = 'different-owner'; },
        row => { row.title = 'Changed title'; },
        row => { row.evidenceCanonical = canonical({ ...JSON.parse(row.evidenceCanonical), sides: { FRONT: null, BACK: null } }); row.evidenceHash = hash(row.evidenceCanonical); },
    ]) {
        const f = fixture(), source = f.addSource(), preview = await f.operations.previewIntake(f.staff, source);
        change(f.sources.get(source.sourceId));
        await assert.rejects(f.operations.admitIntake(f.staff, { ...AUTH(), source, sourceBindingHash: preview.sourceBindingHash }));
        assert.equal(f.state.staffSpecimen.length, 0);
    }
    const f = fixture();
    await assert.rejects(f.operations.previewIntake(f.staff, { ...f.addSource(), descriptor: { sourceRef: 'caller-key' } }));
    assert.equal(f.counts().inspections, 0);
});

test('source preservation and admission digest corruption fail before intake writes', async () => {
    for (const key of ['evidenceCanonical', 'admissionCanonical']) {
        const f = fixture(), source = f.addSource(); f.sources.get(source.sourceId)[key] += ' ';
        await rejected(f.operations.previewIntake(f.staff, source), 'OPERATIONS_EVIDENCE_INVALID');
    }
});

test('intake rejects duplicate source; audit failure rolls back all new rows', async () => {
    const f = fixture(), first = await f.intake();
    await rejected(f.operations.admitIntake(f.staff, { ...first.input, operationId: randomUUID() }), 'SOURCE_ALREADY_ADMITTED');
    assert.equal(f.state.staffSpecimen.length, 1);
    const g = fixture(); g.failAudit();
    await assert.rejects(g.intake(), /INJECTED_AUDIT_FAILURE/);
    assert.equal(g.state.staffSpecimen.length, 0); assert.equal(g.state.staffReviewRevision.length, 0);
});

test('roster capabilities are separate, explicit and access-version fenced', async () => {
    const f = fixture();
    const input = { ...AUTH(), identityId: f.reviewerId, expectedAccessVersion: 1, role: 'REVIEWER', revoked: false,
        certificationUntil: new Date(+NOW + 3600_000).toISOString(), trustedLearningUntil: null };
    await f.operations.updateRoster(f.staff, input);
    const row = f.state.staffIdentity.find(row => row.id === f.reviewerId);
    assert.equal(row.accessVersion, 2); assert.equal(row.trustedLearningUntil, null);
    await rejected(f.operations.updateRoster(f.staff, { ...input, operationId: randomUUID() }), 'STAFF_ACCESS_CHANGED');
    await f.operations.updateRoster(f.staff, { ...input, operationId: randomUUID(), expectedAccessVersion: 2,
        certificationUntil: null, trustedLearningUntil: new Date(+NOW + 3600_000).toISOString() });
    assert.equal(f.state.staffIdentity.find(row => row.id === f.reviewerId).certificationUntil, null);
    assert.equal(f.state.staffIdentity.length, 2);
    assert.ok(!(await f.operations.roster(f.staff)).some(row => Object.hasOwn(row, 'phoneHash')));
});

test('roster refuses role expansion, unknown identities and missing independent capability flag', async () => {
    const f = fixture();
    const base = { ...AUTH(), identityId: f.reviewerId, expectedAccessVersion: 1, role: 'REVIEWER', revoked: false,
        certificationUntil: null, trustedLearningUntil: null };
    assert.throws(() => f.operations.updateRoster(f.staff, { ...base, role: 'ADMIN' }));
    const missing = { ...base }; delete missing.trustedLearningUntil;
    assert.throws(() => f.operations.updateRoster(f.staff, missing));
    await rejected(f.operations.updateRoster(f.staff, { ...base, identityId: randomUUID() }), 'STAFF_IDENTITY_NOT_FOUND');
});

test('assignment requires existing specimen/person, explicit fence, role-compatible review and audited revocation', async () => {
    const f = fixture(), { receipt } = await f.intake();
    const input = { ...AUTH(), specimenId: receipt.specimenId, identityId: f.reviewerId,
        expectedFence: null, canReview: true, expiresAt: new Date(+NOW + 3600_000).toISOString(), revoked: false };
    await f.operations.assign(f.staff, input);
    await rejected(f.operations.assign(f.staff, { ...input, operationId: randomUUID() }), 'ASSIGNMENT_CHANGED');
    await f.operations.assign(f.staff, { ...input, operationId: randomUUID(), expectedFence: 1, revoked: true });
    assert.equal(f.state.staffAssignment[0].fence, 2); assert.deepEqual(f.state.staffAssignment[0].revokedAt, NOW);
    f.state.staffIdentity.find(row => row.id === f.reviewerId).role = 'OBSERVER';
    await rejected(f.operations.assign(f.staff, { ...input, operationId: randomUUID(), expectedFence: 2 }), 'ASSIGNMENT_NOT_ALLOWED');
});

async function pilot(f) {
    const specimens = [];
    for (let i = 0; i < 10; i++) { const { receipt } = await f.intake(); specimens.push(receipt); }
    const policy = { version: 'atlas-grading-bridge-policy-v1', pilotId: randomUUID(), specimenIds: specimens.map(s => s.specimenId),
        expiresAt: new Date(+NOW + 3600_000).toISOString(), maxOperationsPerCard: 2, maxTotalMicroUsd: 1_000_000,
        maxCardMicroUsd: 100_000, reservationPerOperationMicroUsd: 10_000, maxWorkerCalls: 4, deadlineMs: 10_000 };
    return { ...AUTH(), policy, specimens };
}

test('pilot prepares exactly ten current evidence bindings and never enables or enqueues work', async () => {
    const f = fixture(), input = await pilot(f), before = structuredClone(f.context.control);
    const result = await f.operations.preparePilot(f.staff, input);
    assert.equal(result.state, 'PREPARED_ONLY'); assert.equal(result.specimenCount, 10);
    assert.equal(hash(result.policyCanonical), result.policyHash);
    assert.deepEqual(f.context.control, before);
    assert.equal(f.state.staffOperatorRun.length + f.state.staffGradingOperation.length, 0);
    const summary = await f.operations.pilotSummary(f.staff, input.policy.pilotId);
    assert.equal(summary.specimens.length, 10);
    assert.ok(summary.specimens.every(row => row.evidenceMatches && row.analysisRevision === 0));
    assert.equal(summary.preparedConfiguration.state, 'PREPARED_ONLY');
    assert.throws(() => f.operations.preparePilot(f.staff, { ...input, specimens: input.specimens.slice(0, 9) }));
    const ninePolicy = { ...input.policy, specimenIds: input.policy.specimenIds.slice(0, 9) };
    assert.throws(() => f.operations.preparePilot(f.staff, { ...input, policy: ninePolicy }));
});

test('pilot refuses a substituted or changed specimen even if all ten IDs are present', async () => {
    const f = fixture(), input = await pilot(f);
    input.specimens[0].evidenceHash = 'b'.repeat(64);
    await rejected(f.operations.preparePilot(f.staff, input), 'PILOT_EVIDENCE_CHANGED');
    assert.ok(!f.state.staffAudit.some(row => row.event === 'TEN_CARD_PILOT_PREPARED'));
});

function costFixture(f, kind = 'ASTRA', state = 'UNKNOWN') {
    const recordId = randomUUID(), pilotId = randomUUID(), specimenId = randomUUID();
    if (kind === 'ASTRA') {
        const runId = randomUUID();
        f.state.staffOperatorRun.push({ id: runId, pilotId, specimenId, state: 'UNKNOWN', revision: 2 });
        f.state.staffOperatorAttempt.push({ id: recordId, runId, state, requestHash: SHA, dispatchClaimId: randomUUID(),
            reservedMicroUsd: 1000n, usageCeilingMicroUsd: 1200n, usageEnvelopeExceeded: false, actualMicroUsd: null,
            costEvidenceHash: null, dispatchedAt: NOW });
    } else {
        f.state.staffGradingOperation.push({ id: recordId, specimenId, inputHash: SHA, state: 'UNKNOWN' });
        f.state.staffGradingExecution.push({ operationId: recordId, pilotId, state, claimId: randomUUID(), reservedMicroUsd: 1000n,
            actualMicroUsd: null, costEvidenceHash: null });
    }
    return { recordId, pilotId, kind };
}
async function invoice(f, target) {
    const summary = await f.operations.pilotSummary(f.staff, target.pilotId);
    return { ...AUTH(), ...target, expectedBindingHash: summary.costs.find(row => row.recordId === target.recordId).bindingHash,
        invoice: { invoiceId: 'actual-synthetic-invoice', lineId: 'exact-line-1', documentSha256: SHA, actualMicroUsd: '800' } };
}

test('invoice records exact costs once for both providers without unlocking UNKNOWN work', async () => {
    for (const kind of ['WORKER', 'ASTRA']) {
        const f = fixture(), target = costFixture(f, kind), input = await invoice(f, target);
        const before = structuredClone(kind === 'WORKER' ? f.state.staffGradingOperation : f.state.staffOperatorRun);
        const result = await f.operations.reconcileInvoice(f.staff, input);
        assert.equal(result.actualMicroUsd, '800');
        assert.deepEqual(kind === 'WORKER' ? f.state.staffGradingOperation : f.state.staffOperatorRun, before);
        assert.deepEqual(await f.operations.reconcileInvoice(f.staff, input), result);
        await rejected(f.operations.reconcileInvoice(f.staff, { ...input, operationId: randomUUID() }), 'INVOICE_ALREADY_RECONCILED');
        const summary = await f.operations.pilotSummary(f.staff, target.pilotId);
        assert.equal(summary.actualMicroUsd, '800'); assert.equal(summary.unsettledMicroUsd, '0');
        const audit = JSON.parse(f.state.staffAudit[0].details);
        assert.equal(hash(audit.costEvidence), result.costEvidenceHash);
    }
});

test('invoice binds exact pilot/request/claim and terminal dispatch; audit rollback keeps held reservation', async () => {
    for (const alteration of [input => { input.pilotId = randomUUID(); }, input => { input.expectedBindingHash = 'b'.repeat(64); }]) {
        const f = fixture(), target = costFixture(f), input = await invoice(f, target); alteration(input);
        await rejected(f.operations.reconcileInvoice(f.staff, input), 'INVOICE_BINDING_CHANGED');
        assert.equal(f.state.staffOperatorAttempt[0].actualMicroUsd, null);
    }
    const f = fixture(), target = costFixture(f, 'ASTRA', 'DISPATCHED'), input = await invoice(f, target);
    await rejected(f.operations.reconcileInvoice(f.staff, input), 'INVOICE_WORK_NOT_TERMINAL');
    f.state.staffOperatorAttempt[0].state = 'UNKNOWN'; f.failAudit();
    await assert.rejects(f.operations.reconcileInvoice(f.staff, input), /INJECTED_AUDIT_FAILURE/);
    assert.equal(f.state.staffOperatorAttempt[0].actualMicroUsd, null);
    assert.equal((await f.operations.pilotSummary(f.staff, target.pilotId)).unsettledMicroUsd, '1200');
});

test('pilot summary keeps unknown reservations/usage ceilings distinct from invoices and overrun', async () => {
    const f = fixture(), target = costFixture(f), summary = await f.operations.pilotSummary(f.staff, target.pilotId);
    assert.equal(summary.actualMicroUsd, '0'); assert.equal(summary.unsettledMicroUsd, '1200'); assert.equal(summary.overrun, true);
    f.state.staffOperatorAttempt[0].usageCeilingMicroUsd = null;
    assert.equal((await f.operations.pilotSummary(f.staff, target.pilotId)).unsettledMicroUsd, '1000');
    f.state.staffOperatorAttempt[0].state = 'FAILED'; f.state.staffOperatorAttempt[0].dispatchedAt = null;
    assert.equal((await f.operations.pilotSummary(f.staff, target.pilotId)).unsettledMicroUsd, '0');
    await rejected(f.operations.reconcileInvoice(f.staff, await invoice(f, target)), 'INVOICE_DISPATCH_REQUIRED');
});

test('pilot totals retain source unknowns and every infrastructure release without double charging initialization', async () => {
    const f = fixture(), pilotId = randomUUID(), cardId = randomUUID();
    const source = { id: randomUUID(), pilotId, cardId, purpose: 'PREPARATION', side: 'FRONT', sourceConfigHash: SHA,
        state: 'UNKNOWN', reservedMicroUsd: 500n, actualMicroUsd: null, costEvidenceHash: null, dispatchedAt: NOW };
    f.state.staffWorkspaceSourceOperation.push(source,
        { ...source, id: randomUUID(), purpose: 'INITIALIZE_REPORT', reservedMicroUsd: 0n },
        { ...source, id: randomUUID(), purpose: 'PHYSICAL_GEOMETRY', state: 'FAILED', dispatchedAt: null, reservedMicroUsd: 300n });
    f.state.staffWorkspaceInfrastructureReservation.push(...[1000n, 2000n].map((reservedMicroUsd, i) => ({
        id: randomUUID(), pilotId, sourceConfigHash: String(i + 1).repeat(64), reservedMicroUsd, actualMicroUsd: null, costEvidenceHash: null })));
    let summary = await f.operations.pilotSummary(f.staff, pilotId);
    assert.equal(summary.accountedMicroUsd, '3500'); assert.equal(summary.actualMicroUsd, '0');
    assert.equal(summary.costs.length, 4); assert.equal(summary.costs.some(row => row.purpose === 'INITIALIZE_REPORT'), false);
    source.actualMicroUsd = 600n; source.costEvidenceHash = SHA;
    summary = await f.operations.pilotSummary(f.staff, pilotId);
    assert.equal(summary.actualMicroUsd, '600'); assert.equal(summary.unsettledMicroUsd, '3000'); assert.equal(summary.overrun, true);
    assert.equal(summary.costs.some(row => 'requestCanonical' in row || 'resultCanonical' in row), false);
});

test('operation id reused for another request conflicts and fractional/negative invoice input is refused', async () => {
    const f = fixture(), target = costFixture(f), input = await invoice(f, target);
    await f.operations.reconcileInvoice(f.staff, input);
    await rejected(f.operations.reconcileInvoice(f.staff, { ...input, invoice: { ...input.invoice, actualMicroUsd: '900' } }), 'OPERATIONS_REQUEST_CONFLICT');
    for (const value of ['-1', '0.5', '01', '1000000000001', 800])
        assert.throws(() => f.operations.reconcileInvoice(f.staff, { ...input, invoice: { ...input.invoice, actualMicroUsd: value } }));
});

test('one exact invoice document line cannot settle two attempts even under another invoice label', async () => {
    const f = fixture(), first = costFixture(f), second = costFixture(f);
    await f.operations.reconcileInvoice(f.staff, await invoice(f, first));
    const input = await invoice(f, second); input.invoice.invoiceId = 'renamed-same-document';
    await rejected(f.operations.reconcileInvoice(f.staff, input), 'INVOICE_LINE_ALREADY_USED');
    assert.equal(f.state.staffOperatorAttempt[1].actualMicroUsd, null);
    await f.operations.reconcileInvoice(f.staff, { ...input, invoice: { ...input.invoice, lineId: 'exact-line-2' } });
    assert.equal(f.state.staffOperatorAttempt[1].actualMicroUsd, 800n);
});
