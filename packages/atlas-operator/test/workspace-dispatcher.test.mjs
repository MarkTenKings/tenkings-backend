import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { canonical, digest } from '@atlas/service-bridge/protocol';
import { WORKSPACE_FUNCTIONS, WORKSPACE_GRANTS } from '@atlas/service-bridge/workspace-privileges';
import { CAPTURE_TOOL_NAMES } from '../src/capture-protocol.mjs';
import { MODEL, PRICING, REPORT_TOOL_NAMES } from '../src/responses.mjs';
import { makeOperatorConfig } from '../src/policy.mjs';
import { openAiBinding } from '../src/provider.mjs';
import { executeOperatorRun, productionOperatorConfig, RUNTIME_TOOLS } from '../src/runtime.mjs';
import { createWorkspaceDispatcher } from '../src/workspace-dispatcher.mjs';

const NOW = new Date('2026-09-10T04:00:00Z'), LATER = new Date(+NOW + 7200000);
const copy = value => structuredClone(value);
const encoded = value => ({ ...copy(value), canonical: canonical(value), contentHash: digest(canonical(value)) });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const astra = { version: 'atlas-astra-policy-v1', model: MODEL, returnedModel: MODEL, effort: 'max', serviceTier: 'default',
    maxOutputTokens: 128, requestTimeoutMs: 1000, pricingVersion: PRICING.version,
    inputNanoUsdPerToken: PRICING.inputNanoUsdPerToken, outputNanoUsdPerToken: PRICING.outputNanoUsdPerToken };

function fixture({ rosterSize = 10 } = {}) {
    const env = { NODE_ENV: 'production', ATLAS_OPERATOR_ENABLED: 'true', ATLAS_OPERATOR_RELEASE_SHA: 'a'.repeat(40), ATLAS_OPERATOR_BUILD_HASH: 'b'.repeat(64),
        ATLAS_OPERATOR_DATABASE_URL: 'postgresql://synthetic_operator:synthetic_password@db.invalid:5432/fixture?schema=atlas_staff',
        ATLAS_OPERATOR_OPENAI_PROJECT_ID: 'proj_fixture000000', ATLAS_OPERATOR_OPENAI_API_KEY: 'sk-synthetic-fixture-key-only-00000000',
        ATLAS_OPERATOR_EVIDENCE_ORIGIN: 'https://evidence.invalid', ATLAS_OPERATOR_EVIDENCE_KEY: Buffer.alloc(32, 2).toString('base64') };
    const provider = openAiBinding(env), operatorConfig = makeOperatorConfig({ databaseUrl: env.ATLAS_OPERATOR_DATABASE_URL, mode: 'PRODUCTION',
        releaseSha: env.ATLAS_OPERATOR_RELEASE_SHA, buildHash: env.ATLAS_OPERATOR_BUILD_HASH, providerBindingHash: provider.bindingHash });
    env.ATLAS_OPERATOR_RUNTIME_HASH = operatorConfig.configHash;
    const release = { version: 'atlas-operator-release-v2', mode: 'PRODUCTION', model: MODEL, nodeVersion: process.version,
        releaseSha: operatorConfig.releaseSha, buildHash: operatorConfig.buildHash, runtimeHash: operatorConfig.configHash,
        databaseBindingHash: digest(env.ATLAS_OPERATOR_DATABASE_URL), providerBindingHash: provider.bindingHash,
        imageBridge: { origin: env.ATLAS_OPERATOR_EVIDENCE_ORIGIN, keyHash: digest(Buffer.from(env.ATLAS_OPERATOR_EVIDENCE_KEY, 'base64')) },
        machineInitialization: null, tools: [...RUNTIME_TOOLS] };
    assert.deepEqual(productionOperatorConfig({ env, manifest: release, manifestHash: digest(canonical(release)) }).config, operatorConfig);
    const cardId = randomUUID(), runId = randomUUID(), pilotId = randomUUID(), actorId = randomUUID(), creatorId = randomUUID(), cohortId = randomUUID();
    const policy = { version: 'atlas-operator-control-policy-v1', pilotId, expiresAt: LATER.toISOString(), prompt: 'Fixture.', astra,
        tools: REPORT_TOOL_NAMES, captureTools: CAPTURE_TOOL_NAMES, maxAttemptsPerCard: 50, maxStepsPerRun: 64,
        maxRunMs: 3600000, leaseMs: 30000, concurrency: 1 };
    const budget = { version: 'atlas-workspace-bridge-policy-v1', pilotId, workspaceCardIds: [cardId, ...Array.from({ length: rosterSize - 1 }, () => randomUUID())],
        expiresAt: LATER.toISOString(), maxOperationsPerCard: 20, maxTotalMicroUsd: 90000000, maxCardMicroUsd: 9000000,
        reservationPerOperationMicroUsd: 100000, maxWorkerCalls: 2, deadlineMs: 200000 };
    const control = { ...operatorConfig, enabled: true, policyCanonical: canonical(policy), policyHash: digest(canonical(policy)) };
    const bridge = { enabled: true, mode: operatorConfig.mode, gradingPolicyHash: 'e'.repeat(64),
        policyCanonical: canonical(budget), policyHash: digest(canonical(budget)) };
    const card = { id: cardId, creatorId, cohortId, revision: 8, state: 'IN_PROGRESS', stage: 'IDENTITY', specimenId: null,
        captureHash: 'f'.repeat(64), captureRevision: 1, claimFence: 2,
        source: { sourceType: 'SPEEDSTER', sourceId: `atlas-${cardId}`, sourceOwnerId: `atlas-staff-${creatorId}` },
        claim: { id: randomUUID(), kind: 'ASTRA', actorId, actorName: 'Fixture reviewer', accessVersion: 2, controlRevision: 1,
            runId, fence: 2, captureHash: 'f'.repeat(64), captureRevision: 1, workflowRevision: 8, mode: 'CONTINUOUS' },
        identity: { category: 'SPORTS', playerName: 'Visible Player', year: '2026', manufacturer: 'Fixture', productSet: 'Fixture Set' },
        workspace: { cornerShape: 'SQUARE' }, updatedAt: NOW.toISOString() };
    const manifest = { version: 'atlas-operator-capture-manifest-v1', phase: 'CAPTURE_REVIEW', runId, workspaceCardId: cardId,
        claimId: card.claim.id, claimFence: 2, captureRevision: 1, workflowRevision: 8, evidenceHash: card.captureHash,
        identity: card.identity, cornerShape: 'SQUARE', assets: ['FRONT', 'BACK'].map((side, index) => ({ assetId: randomUUID(),
            side, view: 'ORIGINAL', sha256: String(index + 1).repeat(64), byteCount: 4096, width: 800, height: 1000, contentType: 'image/jpeg' })) };
    const run = { id: runId, workspaceCardId: cardId, phase: 'CAPTURE_REVIEW', specimenId: null, initializationId: null, captureRunId: null,
        expectedAnalysisRevision: 0, expectedReviewRevision: 0, state: 'QUEUED', revision: 1, leaseFence: 0,
        leaseOwner: null, leaseExpiresAt: null, controlRevision: 1, controlState: 'RUNNING', executionMode: 'CONTINUOUS', stepBudget: 0,
        pilotId, policyHash: control.policyHash, policyCanonical: control.policyCanonical, runtimeHash: operatorConfig.configHash,
        gradingPolicyHash: bridge.gradingPolicyHash, evidenceHash: card.captureHash,
        manifestCanonical: canonical(manifest), manifestHash: digest(canonical(manifest)), inputCanonical: canonical([]), inputHash: digest(canonical([])),
        deadlineAt: new Date(+NOW + 3600000) };
    const f = { env, release, operatorConfig, card, run, runs: new Map([[runId, run]]), operations: new Map(), admissions: new Map(),
        jobs: new Map(), permits: new Map(), sources: new Map(), recoveries: [], events: [], queries: [], mutations: [], now: NOW, count: rosterSize,
        roleUnsafe: false, extraGrant: false, missingFunction: false, transactions: 0, inside: false, sourceCalls: 0, operatorCalls: [],
        work: new Map(), control, bridge, identity: { id: actorId, role: 'REVIEWER', accessVersion: 2, revokedAt: null },
        staff: { enabled: true, mode: operatorConfig.mode, revision: 1, gradingPolicyHash: bridge.gradingPolicyHash },
        workspaceControl: { cohortId, claimsEnabled: true, astraEnabled: true, preparationEnabled: true }, sourceControl: { pilotId, enabled: true }, appliedSteps: [], preparedProof: [],
        afterOperator: null, afterSource: null, execute: null, sourceRun: null };
    const workFor = id => ({ attempts: 0, held: 0, permits: 0, sources: 0, unknown: 0, unknownAttempts: 0, ...f.work.get(id) });
    const tx = {
        async $executeRaw(strings) {
            const sql = strings.join('?'); f.mutations.push(sql);
            assert(sql.includes('pg_advisory_xact_lock') || sql.includes('SET CONSTRAINTS') || sql.includes('lock_workspace_private_controls'),
                'dispatcher must not mutate a claim, control, permit, cost or report'); return 1;
        },
        async $queryRaw(strings, ...values) {
            const sql = strings.join('?'); f.queries.push(sql);
            if (sql.includes('FROM pg_roles r')) return [{ unsafe: f.roleUnsafe }];
            if (sql.includes('FROM pg_namespace n') && !sql.includes('JOIN')) return ['atlas_staff', 'public'].map(name => ({ name, creates: false, uses: true, grants: false }));
            if (sql.includes('has_column_privilege')) {
                const rows = Object.entries(WORKSPACE_GRANTS.COORDINATOR.atlas_staff).flatMap(([name, grants]) =>
                    grants.SELECT.map(column => ({ schema: 'atlas_staff', name, column, sel: true,
                        ins: grants.INSERT?.includes(column) ?? false, upd: grants.UPDATE?.includes(column) ?? false,
                        refs: false, extra: false, grants: false })));
                if (f.extraGrant) rows.push({ schema: 'public', name: 'AiGraderV2Session', column: 'nfcDone', sel: true, ins: true,
                    upd: false, refs: false, extra: false, grants: false });
                return rows;
            }
            if (sql.includes('WITH sequences AS MATERIALIZED')) return [];
            if (sql.includes('FROM pg_proc p')) return WORKSPACE_FUNCTIONS.COORDINATOR.slice(f.missingFunction ? 1 : 0)
                .map(name => ({ schema: 'atlas_staff', name, definer: true, grants: false }));
            if (sql.includes('clock_timestamp() AS now')) return [{ now: f.now }];
            if (sql.includes('operator_workspace_count')) return [{ count: f.count }];
            if (sql.includes('"StaffOperatorControl"') || sql.includes('lock_operator_control()')) return [f.control];
            if (sql.includes('"StaffGradingBridgeControl"') || sql.includes('lock_operator_bridge_control()')) return [f.bridge];
            if (sql.includes('lock_control()')) return [f.staff];
            if (sql.includes('lock_workspace_private_run')) return [copy(f.runs.get(values[0]))].filter(Boolean);
            if (sql.includes('lock_workspace_private_actor')) return [copy(f.identity)];
            if (sql.includes('lock_workspace_private_card') || sql.includes('FROM atlas_staff."StaffWorkspaceCard"')) return [encoded(f.card)];
            if (sql.includes('AS attempts')) return [workFor(values[0])];
            if (sql.includes('"StaffOperatorRecovery"')) return f.recoveries.filter(g => g.runId === values[0]
                && g.runRevision === values[1] && g.leaseFence === values[2]).map(copy);
            if (sql.includes('AS applied')) return [{ applied: f.appliedSteps.filter(step => step.runId === values[0] && step.revision === values[1]).length,
                prepared: f.preparedProof.filter(proof => proof.runId === values[4] && proof.controlRevision === values[5]).length }];
            if (sql.includes('"StaffWorkspaceOperation"') && sql.includes("action='OPERATOR_CONTROL'")) return [...f.operations.values()]
                .filter(event => event.cardId === values[0] && event.action === 'OPERATOR_CONTROL'
                    && (event.result.runId === values[1] && event.result.runControlRevision > values[2]
                        || values[3] !== values[4] && event.result.runId === values[5]))
                .sort((a,b) => b.result.runControlRevision-a.result.runControlRevision).slice(0,1).map(copy);
            if (sql.includes('"StaffWorkspaceOperation"') && sql.includes('WHERE id=')) return [copy(f.operations.get(values[0]))].filter(Boolean);
            if (sql.includes('"StaffWorkspaceOperation"')) return [...f.operations.values()]
                .filter(event => event.actorId === values[0] && event.operationId === values[1]).map(copy);
            if (sql.includes('"StaffMachineInitialization"')) return [copy(f.jobs.get(values[0]))].filter(Boolean);
            if (sql.includes('"StaffWorkspaceSourceAdmission"')) return [copy(f.admissions.get(values[0]))].filter(Boolean);
            if (sql.includes('lock_workspace_private_permit')) return [copy(f.permits.get(values[0]))].filter(Boolean);
            if (sql.includes('"StaffWorkspaceSourceOperation"')) return [copy(f.sources.get(values[0]))].filter(Boolean);
            if (sql.includes('"StaffOperatorRun"') && sql.includes('"initializationId"=')) return [...f.runs.values()].filter(value => value.initializationId === values[0]).map(copy);
            throw Error('Unexpected fixture query: ' + sql);
        },
    };
    let queue = Promise.resolve();
    f.client = { async $transaction(work, options) {
        assert.deepEqual(options, { maxWait: 5000, timeout: 10000 });
        const previous = queue; let release; queue = new Promise(done => { release = done; }); await previous;
        f.inside = true; f.transactions++;
        try { return await work(tx); } finally { f.inside = false; release(); }
    } };
    f.authority = {
        async controls() {
            assert(f.inside); assert(f.sourceControl.enabled && f.workspaceControl.astraEnabled);
            return { now: f.now, staff: copy(f.staff), workspace: copy(f.workspaceControl), source: copy(f.sourceControl) };
        },
        async current(_tx, request) {
            assert(f.inside); const { scope, binding } = request;
            assert.equal(scope.actorKind, 'MACHINE'); assert.equal(Object.hasOwn(scope, 'sessionHash'), false);
            assert.equal(scope.actorId, f.identity.id); assert.equal(f.identity.role, 'REVIEWER'); assert.equal(f.identity.revokedAt, null);
            assert.equal(scope.accessVersion, f.identity.accessVersion); assert.equal(scope.accessVersion, f.card.claim.accessVersion);
            assert.equal(scope.controlRevision, f.staff.revision); assert.equal(scope.controlRevision, f.card.claim.controlRevision);
            assert.deepEqual(binding, { captureRevision: f.card.captureRevision, captureHash: f.card.captureHash,
                claimFence: f.card.claimFence, workflowRevision: f.card.revision });
            assert(['IN_PROGRESS', 'NEEDS_ATTENTION'].includes(f.card.state));
            return { card: copy(f.card), identity: copy(f.identity), staff: copy(f.staff) };
        },
        async loadInTransaction() { throw Error('Fixture has no retained source intent.'); },
        async recheck() { throw Error('Fixture has no retained source intent.'); },
    };
    f.source = Object.fromEntries(['prepare', 'finalize', 'status'].map(method => [method, async () => { throw Error('Unexpected source effect: ' + method); }]));
    f.prepared = () => { Object.assign(f.run, { state: 'PREPARATION_READY', revision: 6, leaseFence: 3, leaseOwner: null, leaseExpiresAt: null }); };
    f.completeOperator = id => {
        const row = f.runs.get(id), state = row.phase === 'CAPTURE_REVIEW' ? 'PREPARATION_READY' : 'READY_FOR_HUMAN';
        const beforeRevision = row.revision;
        if (row.phase === 'CAPTURE_REVIEW') f.prepared(); else { row.state = state; row.revision++; row.leaseOwner = null; row.leaseExpiresAt = null; }
        if (row.executionMode === 'STEP') { row.stepBudget = 0; row.controlRevision += 2;
            f.appliedSteps.push({ runId: row.id, revision: beforeRevision + 1 });
            if (state === 'PREPARATION_READY') row.controlState = 'PAUSED'; }
        return { runId: id, state, code: null, stepsApplied: 1, receipts: { total: 1, persisted: 1, unconfirmed: 0, pending: 0 }, disconnect: 'CLOSED', exitCode: 0 };
    };
    f.makeReport = () => {
        const requestId = randomUUID(), reportRunId = randomUUID(), admissionCanonical = canonical({ fixture: 'immutable original source admission' });
        f.prepared();
        const row = { ...copy(f.run), id: reportRunId, phase: 'REPORT_REVIEW', state: 'QUEUED', specimenId: cardId,
            initializationId: requestId, captureRunId: runId, expectedAnalysisRevision: 1, expectedReviewRevision: 1, revision: 1,
            leaseOwner: null, leaseExpiresAt: null, leaseFence: 0, evidenceHash: '9'.repeat(64),
            controlState: f.run.executionMode === 'STEP' || f.run.controlState !== 'RUNNING' ? 'PAUSED' : 'RUNNING', stepBudget: 0,
            deadlineAt: new Date(+f.now + 3600000) };
        const reportManifest = { version: 'atlas-operator-manifest-v1', runId: reportRunId, workspaceCardId: cardId,
            captureRunId: runId, specimenId: cardId, evidenceHash: row.evidenceHash, analysisRevision: 1, reviewRevision: 1,
            sourceHash: '8'.repeat(64), reportHash: '7'.repeat(64), assets: [] };
        row.manifestCanonical = canonical(reportManifest); row.manifestHash = digest(row.manifestCanonical);
        f.runs.set(reportRunId, row); f.card.specimenId = cardId; f.card.claim.runId = reportRunId; f.card.revision++; delete f.card.workspace.pending;
        const job = { id: requestId, state: 'SUCCEEDED', admissionKind: 'WORKSPACE_CAPTURE', workspaceSourceRequestId: requestId,
            runtimeHash: operatorConfig.configHash, pilotId, specimenId: cardId, evidenceHash: row.evidenceHash,
            authorizationEvidenceHash: digest(admissionCanonical), admittedById: actorId, admittedAccessVersion: 2, gradingOperationId: randomUUID() };
        f.jobs.set(requestId, job);
        f.admissions.set(requestId, { requestId, actorKind: 'MACHINE', sessionHash: null, specimenId: cardId, cardId,
            evidenceHash: row.evidenceHash, admissionHash: job.authorizationEvidenceHash, admissionCanonical, actorId, accessVersion: 2 });
        f.permits.set(requestId, { requestId, state: 'SUCCEEDED', cardId, runId, runRevision: f.run.revision,
            claimFence: f.card.claimFence, captureHash: f.card.captureHash });
        f.sources.set(requestId, { requestId, state: 'SUCCEEDED', cardId, runId, gradingExecutionId: job.gradingOperationId,
            resultCanonical: canonical({ state: 'SUCCEEDED' }), resultHash: digest(canonical({ state: 'SUCCEEDED' })) });
        const event = encoded({ id: randomUUID(), actorId, operationId: `machine-report-${requestId}`, cardId, action: 'MACHINE_REPORT_SUCCESSOR',
            inputHash: '6'.repeat(64), result: { actor: 'MACHINE', sourceRequestId: requestId, captureRunId: runId,
                reportRunId, claimFence: f.card.claimFence, revision: f.card.revision }, createdAt: NOW.toISOString() });
        f.operations.set(event.id, event); return row;
    };
    f.executeOperator = async input => {
        assert(!f.inside); assert.deepEqual(Object.keys(input).sort(), input.signal ? ['expectedControlRevision', 'runId', 'signal'] : ['expectedControlRevision', 'runId']);
        assert.equal(input.expectedControlRevision, f.runs.get(input.runId).controlRevision);
        f.operatorCalls.push(input.runId); f.events.push(f.runs.get(input.runId).phase);
        const reply = f.execute ? await f.execute(input) : f.completeOperator(input.runId);
        if (f.afterOperator) await f.afterOperator(input, reply); return reply;
    };
    f.options = { client: f.client, authority: f.authority, source: f.source, operatorConfig, executeOperator: f.executeOperator };
    f.composition = { makeSourceRunner(options) {
        assert.notEqual(options.client, f.client); assert.deepEqual(options.operatorConfig, operatorConfig);
        return { async run(input) {
            assert(!f.inside); assert.equal(input.runId, runId); f.sourceCalls++; f.events.push('SOURCE');
            const reply = f.sourceRun ? await f.sourceRun(input) : { runId, actions: 3, state: 'READY', reportRunId: f.makeReport().id };
            if (f.afterSource) await f.afterSource(input, reply); return reply;
        } };
    } };
    f.commandFor = (action = 'claim', row = f.run) => {
        const initial = action === 'claim', event = encoded({ id: randomUUID(), actorId, operationId: randomUUID(), cardId,
            action: initial ? 'claim' : 'OPERATOR_CONTROL', inputHash: '5'.repeat(64), createdAt: NOW.toISOString(),
            result: initial ? { cardId, revision: f.card.claim.workflowRevision, claim: { ...copy(f.card.claim), mode: row.executionMode } }
                : { action, priorClaim: { ...copy(f.card.claim), runId: row.id }, claimFence: f.card.claimFence,
                    runId: row.id, runRevision: row.revision, runControlRevision: row.controlRevision,
                    control: { state: row.controlState, mode: row.executionMode } } });
        f.operations.set(event.id, event); f.command = event; return event;
    };
    f.pending = () => {
        const requestId = randomUUID(), binding = { captureRevision: f.card.captureRevision, captureHash: f.card.captureHash,
            claimFence: f.card.claimFence, workflowRevision: f.card.revision };
        f.card.workspace.pending = { requestId, action: 'PREPARE_SIDE', binding };
        f.operations.set(requestId, encoded({ id: requestId, actorId, operationId: randomUUID(), cardId, action: 'MACHINE_SOURCE_ACTION', inputHash: '4'.repeat(64),
            result: { binding, payload: { machine: { runId, runControlRevision: f.command.action === 'claim' ? 1 : f.command.result.runControlRevision,
                ...(f.run.executionMode === 'STEP' ? { permitOperationId: f.command.id } : {}) } } }, createdAt: NOW.toISOString() }));
        return requestId;
    };
    f.commandFor();
    f.dispatcher = createWorkspaceDispatcher(f.options, f.composition);
    f.start = (input = { runId }) => f.dispatcher.run({ commandId: f.command.id, ...input });
    f.admit = (input = { runId }) => f.dispatcher.admit({ commandId: f.command.id, ...input });
    return f;
}

test('one-card admission dispatches the complete capture and report flow with the same MAX policy', async () => {
    const f = fixture({ rosterSize: 1 }), policy = copy(f.control.policyCanonical), result = await f.start();
    assert.equal(result.state, 'READY_FOR_HUMAN'); assert.equal(result.operatorRuns, 2); assert.equal(result.sourceActions, 3);
    assert.deepEqual(f.events, ['CAPTURE_REVIEW', 'SOURCE', 'REPORT_REVIEW']);
    assert.equal(f.control.policyCanonical, policy); assert.equal(JSON.parse(policy).astra.effort, 'max');
});

function grantRecovery(f) {
    f.run.state = 'WAITING_TOOL'; f.run.leaseFence = 2; f.run.controlRevision++;
    f.work.set(f.run.id, { attempts: 1, held: 1 }); f.commandFor('RECOVER');
    const grant = { version: 'atlas-operator-recovery-v1', id: randomUUID(), runId: f.run.id,
        attemptId: randomUUID(), receiptId: randomUUID(), commandId: f.command.id, ordinal: 1,
        runRevision: f.run.revision, controlRevision: f.run.controlRevision, leaseFence: f.run.leaseFence + 1,
        policyHash: f.run.policyHash, evidenceHash: f.run.evidenceHash, manifestHash: f.run.manifestHash,
        inputHash: f.run.inputHash, gradingPolicyHash: f.run.gradingPolicyHash, newRuntimeHash: f.run.runtimeHash,
        newDeadlineAt: f.run.deadlineAt.toISOString() };
    f.recoveries.push({ ...grant, canonical: canonical(grant), hash: digest(canonical(grant)) }); return grant;
}

test('only the exact recovery command admits a saved completed tool and continues the full pipeline', async () => {
    const f = fixture({ rosterSize: 1 }); grantRecovery(f);
    assert.equal((await f.admit()).state, 'ADMITTED');
    f.afterOperator = async ({ runId }) => f.work.delete(runId);
    const result = await f.start(); assert.equal(result.state, 'READY_FOR_HUMAN');
    assert.deepEqual(f.events, ['CAPTURE_REVIEW', 'SOURCE', 'REPORT_REVIEW']);
});

test('a missing or mismatched grant, uncertain work or source activity cannot use recovery admission', async () => {
    for (const alter of [f => { f.recoveries = []; }, f => { f.commandFor('RECOVER'); },
        f => { f.run.leaseFence++; }, f => { f.run.controlRevision++; },
        f => { f.work.set(f.run.id, { attempts: 1, held: 1, unknown: 1, unknownAttempts: 1 }); },
        f => { f.work.set(f.run.id, { attempts: 1, held: 1, permits: 1 }); },
        f => { f.run.state = 'UNKNOWN'; }, f => { f.run.leaseOwner = randomUUID(); f.run.leaseExpiresAt = LATER; }]) {
        const f = fixture(); grantRecovery(f); alter(f);
        assert.notEqual((await f.admit()).state, 'ADMITTED'); assert.deepEqual(f.events, []);
    }
});

test('one-card dispatcher rejects missing, excess, duplicate and non-admitted workspace records before effects', async () => {
    for (const alter of [f => { f.count = 0; }, f => { f.count = 2; }, f => {
        const p = JSON.parse(f.bridge.policyCanonical); p.workspaceCardIds = [randomUUID()];
        f.bridge.policyCanonical = canonical(p); f.bridge.policyHash = digest(f.bridge.policyCanonical);
    }, f => {
        const p = JSON.parse(f.bridge.policyCanonical); p.workspaceCardIds.push(p.workspaceCardIds[0]);
        f.bridge.policyCanonical = canonical(p); f.bridge.policyHash = digest(f.bridge.policyCanonical);
    }]) {
        const f = fixture({ rosterSize: 1 }); alter(f);
        assert.equal((await f.start()).state, 'HELD'); assert.deepEqual(f.events, []); assert.equal(f.sourceCalls, 0);
    }
});

test('continuous dispatch follows one capture, finite source work and the proven original report successor', async () => {
    const f = fixture(), result = await f.start();
    assert.equal(result.state, 'READY_FOR_HUMAN'); assert.equal(result.operatorRuns, 2); assert.equal(result.sourceActions, 3);
    assert.equal(result.stepsApplied, 2); assert.equal(result.activeRunId, f.card.claim.runId);
    assert.deepEqual(f.events, ['CAPTURE_REVIEW', 'SOURCE', 'REPORT_REVIEW']);
    assert(f.queries.some(sql => sql.includes('"StaffWorkspaceSourceAdmission"')));
    assert(f.queries.some(sql => sql.includes('"StaffMachineInitialization"')));
    assert(f.queries.some(sql => sql.includes('"StaffWorkspaceSourceOperation"')));
    assert(f.mutations.every(sql => !/UPDATE|INSERT|DELETE/.test(sql)));
    const calls = f.events.length, repeated = await f.start();
    assert.equal(repeated.state, 'READY_FOR_HUMAN'); assert.equal(repeated.operatorRuns, 0); assert.equal(repeated.sourceActions, 0);
    assert.equal(f.events.length, calls); assert.equal(f.runs.size, 2);
});

test('read-only admission distinguishes a real claimed run from pause, takeover, unknown work and arbitrary UUIDs', async () => {
    const f = fixture(), before = canonical(f.card), admitted = await f.admit({ runId: f.run.id });
    assert.deepEqual(admitted, { runId: f.run.id, activeRunId: f.run.id, workspaceCardId: f.card.id,
        phase: 'CAPTURE_REVIEW', state: 'ADMITTED', commandId: f.command.id, commandHash: f.command.contentHash, code: null });
    assert.equal(canonical(f.card), before); assert.deepEqual(f.events, []); assert.equal(f.run.leaseOwner, null);
    assert.equal(f.operations.size, 1); assert.equal(f.permits.size, 0); assert.equal(f.sources.size, 0);
    f.run.controlState = 'PAUSED'; f.run.controlRevision++; const original = f.command; f.commandFor('PAUSE'); f.command = original;
    assert.equal((await f.admit({ runId: f.run.id })).state, 'SETTLED');
    f.run.state = 'UNKNOWN'; assert.equal((await f.admit({ runId: f.run.id })).state, 'HELD');
    const invalid = await f.admit({ runId: randomUUID() });
    assert.equal(invalid.state, 'HELD'); assert.equal(invalid.workspaceCardId, null); assert.equal(invalid.activeRunId, null);
    Object.assign(f.run, { controlState: 'TAKEN_OVER', state: 'FAILED' }); f.card.claim.kind = 'HUMAN';
    assert.equal((await f.admit({ runId: f.run.id })).state, 'HELD');
    assert.deepEqual(f.events, []);
    await assert.rejects(() => f.admit({ runId: f.run.id, mode: 'CONTINUOUS' }));
    await assert.rejects(() => f.admit({ runId: f.run.id, signal: new AbortController().signal }));
});

test('admission uses the same original successor proof and run rechecks a revoked claim after acknowledgment', async () => {
    const f = fixture(), report = f.makeReport(), admitted = await f.admit({ runId: f.run.id });
    assert.equal(admitted.state, 'ADMITTED'); assert.equal(admitted.activeRunId, report.id); assert.equal(admitted.phase, 'REPORT_REVIEW');
    assert.equal(f.runs.size, 2); assert.equal(f.operations.size, 2); assert.deepEqual(f.events, []);
    f.identity.accessVersion++;
    assert.equal((await f.start()).state, 'HELD'); assert.deepEqual(f.events, []);
    const g = fixture(); g.makeReport(); [...g.jobs.values()][0].state = 'UNKNOWN';
    assert.equal((await g.admit({ runId: g.run.id })).state, 'HELD'); assert.deepEqual(g.events, []);
});

test('strict invocation rejects model-supplied authority, mode, source, callbacks and unknown fields before any connection', async () => {
    const f = fixture();
    for (const extra of [{ actorId: randomUUID() }, { mode: 'CONTINUOUS' }, { scope: { actorKind: 'HUMAN' } },
        { source: 'https://elsewhere.invalid' }, { executeOperator() {} }, { claimNext: true }])
        await assert.rejects(() => f.start({ runId: f.run.id, ...extra }));
    for (const value of [{}, { runId: 'all' }, { runId: f.run.id, signal: {} }]) await assert.rejects(() => f.start(value));
    assert.equal(f.transactions, 0); assert.deepEqual(f.events, []);
    assert.throws(() => createWorkspaceDispatcher({ ...f.options, source: null }), /ASTRA_DISPATCH_CONFIGURATION_REQUIRED/);
    assert.throws(() => createWorkspaceDispatcher({ ...f.options, operatorConfig: { ...f.operatorConfig, provider: 'alias' } }));
});

test('current claim, capture, reviewer access version, cohort, pilot and all fixed controls deny effects when changed', async () => {
    const changes = [f => { f.card.claim = null; }, f => { f.card.claim.kind = 'HUMAN'; }, f => { f.card.claim.runId = randomUUID(); },
        f => { f.card.claimFence++; }, f => { f.card.captureRevision++; }, f => { f.card.captureHash = '1'.repeat(64); },
        f => { f.identity.revokedAt = NOW; }, f => { f.identity.accessVersion++; }, f => { f.identity.role = 'OBSERVER'; },
        f => { f.card.cohortId = randomUUID(); }, f => { f.staff.revision++; }, f => { f.control.configHash = '1'.repeat(64); },
        f => { f.control.enabled = false; }, f => { f.bridge.enabled = false; }, f => { f.staff.enabled = false; },
        f => { f.sourceControl.enabled = false; }, f => { f.sourceControl.pilotId = randomUUID(); }, f => { f.workspaceControl.astraEnabled = false; },
        f => { f.workspaceControl.claimsEnabled = false; }, f => { f.workspaceControl.preparationEnabled = false; }, f => { f.count = 9; },
        f => { f.now = new Date(+f.run.deadlineAt + 1); }, f => { f.run.inputHash = '1'.repeat(64); },
        f => { f.run.manifestHash = '1'.repeat(64); }, f => { f.run.policyHash = '1'.repeat(64); }];
    for (const change of changes) {
        const f = fixture(); change(f); const result = await f.start();
        assert.equal(result.state, 'HELD', change.toString()); assert.deepEqual(f.events, [], change.toString());
    }
});

test('exact coordinator role assertion rejects missing or excessive privileges before authority reads', async () => {
    for (const key of ['roleUnsafe', 'extraGrant', 'missingFunction']) {
        const f = fixture(); f[key] = true; const result = await f.start();
        assert.equal(result.code, 'WORKSPACE_DATABASE_ROLE_INVALID'); assert.deepEqual(f.events, []);
        assert(!f.queries.some(sql => sql.includes('"StaffOperatorControl"')));
    }
});

test('STEP capture terminates at its action boundary; explicit subsequent STEP authorizes one source action', async () => {
    const f = fixture(); Object.assign(f.run, { executionMode: 'STEP', stepBudget: 1 }); f.commandFor();
    let result = await f.start(); assert.equal(result.state, 'PAUSED'); assert.equal(f.sourceCalls, 0);
    assert.equal(result.operatorRuns, 1); assert.equal(f.run.state, 'PREPARATION_READY');
    Object.assign(f.run, { controlState: 'RUNNING', controlRevision: f.run.controlRevision + 1, stepBudget: 1 }); f.commandFor('STEP');
    f.sourceRun = async () => { f.preparedProof.push({ runId: f.run.id, controlRevision: f.run.controlRevision }); f.run.controlState = 'PAUSED'; f.run.stepBudget = 0; f.run.controlRevision += 2;
        return { runId: f.run.id, actions: 1, state: 'PAUSED' }; };
    result = await f.start(); assert.equal(result.state, 'PAUSED'); assert.equal(result.operatorRuns, 0); assert.equal(result.sourceActions, 1);
    assert.equal(f.operatorCalls.length, 1); assert.equal(f.sourceCalls, 1);
    result = await f.start(); assert.equal(result.state, 'PAUSED'); assert.equal(f.sourceCalls, 1);
});

test('STEP source initialization creates a paused report and cannot spend its action on report inspection', async () => {
    const f = fixture(); f.prepared(); Object.assign(f.run, { executionMode: 'STEP', stepBudget: 1, controlRevision: 3 }); f.commandFor('STEP');
    f.sourceRun = async () => { f.preparedProof.push({ runId: f.run.id, controlRevision: f.run.controlRevision }); f.run.controlRevision += 2;
        return { runId: f.run.id, actions: 1, state: 'READY', reportRunId: f.makeReport().id }; };
    let result = await f.start(); assert.equal(result.state, 'PAUSED'); assert.equal(result.operatorRuns, 0); assert.equal(result.sourceActions, 1);
    const report = f.runs.get(f.card.claim.runId); Object.assign(report, { controlState: 'RUNNING', stepBudget: 1, controlRevision: report.controlRevision + 1 });
    f.commandFor('STEP', report); result = await f.start({ runId: report.id }); assert.equal(result.state, 'READY_FOR_HUMAN'); assert.equal(result.operatorRuns, 1);
    assert.equal(result.sourceActions, 0); assert.equal(f.sourceCalls, 1);
});

test('a newer human control cannot make the same STEP invocation consume another action', async () => {
    const f = fixture(); Object.assign(f.run, { executionMode: 'STEP', stepBudget: 1 }); f.commandFor();
    f.afterOperator = () => { f.run.controlState = 'RUNNING'; f.run.executionMode = 'CONTINUOUS'; f.run.controlRevision++; f.commandFor('RESUME'); };
    const result = await f.start(); assert.equal(result.state, 'YIELDED'); assert.equal(f.sourceCalls, 0);
    assert.equal(result.code, 'ASTRA_DISPATCH_COMMAND_SUPERSEDED');
});

test('pause during capture prevents source continuation and takeover prevents any later phase', async () => {
    const f = fixture(); f.afterOperator = () => { f.run.controlState = 'PAUSED'; f.run.controlRevision++; f.commandFor('PAUSE'); };
    assert.equal((await f.start()).state, 'PAUSED'); assert.equal(f.sourceCalls, 0);
    const g = fixture(); g.afterOperator = () => {
        g.run.controlState = 'TAKEN_OVER'; g.run.state = 'FAILED'; g.card.claim.kind = 'HUMAN'; g.card.claimFence++;
    };
    assert.equal((await g.start()).state, 'TAKEN_OVER'); assert.equal(g.sourceCalls, 0);
});

test('unknown provider outcomes and unconfirmed receipts stop without source dispatch or retry', async () => {
    for (const alteration of [reply => ({ ...reply, state: 'RECONCILIATION_REQUIRED', code: 'ASTRA_WORK_UNRESOLVED', exitCode: 3 }),
        reply => ({ ...reply, receipts: { total: 1, persisted: 0, pending: 1, unconfirmed: 0 } }),
        reply => ({ ...reply, disconnect: 'UNCONFIRMED' })]) {
        const f = fixture(); f.execute = async ({ runId }) => alteration(f.completeOperator(runId));
        const result = await f.start(); assert.equal(result.state, 'HELD'); assert.equal(f.operatorCalls.length, 1); assert.equal(f.sourceCalls, 0);
    }
    const f = fixture(); f.run.state = 'UNKNOWN';
    assert.equal((await f.start()).state, 'HELD'); assert.deepEqual(f.events, []);
    const g = fixture(); g.work.set(g.run.id, { attempts: 1, held: 1 });
    assert.equal((await g.start()).state, 'HELD'); assert.deepEqual(g.events, []);
});

test('existing active operator lease is held; an expired lease with only a never-dispatched reservation reaches the original runner', async () => {
    const f = fixture(); Object.assign(f.run, { leaseOwner: randomUUID(), leaseExpiresAt: new Date(+NOW + 10000) });
    assert.equal((await f.start()).code, 'ASTRA_LEASE_BUSY'); assert.deepEqual(f.events, []);
    f.run.leaseExpiresAt = new Date(+NOW - 1); f.work.set(f.run.id, { attempts: 1 });
    f.execute = async ({ runId }) => { f.work.delete(runId); return f.completeOperator(runId); };
    assert.equal((await f.start()).state, 'READY_FOR_HUMAN'); assert.equal(f.operatorCalls.length, 2);
});

test('lost source reply preserves one recovery invocation even with settled permit and PAUSE_REQUESTED', async () => {
    const f = fixture(); f.prepared(); const requestId = f.pending();
    f.run.controlState = 'PAUSE_REQUESTED';
    f.sourceRun = async () => ({ runId: f.run.id, actions: 0, state: 'HELD', requestId, code: 'ASTRA_SOURCE_PENDING' });
    let result = await f.start(); assert.equal(result.state, 'HELD'); assert.equal(result.sourceActions, 0);
    assert.equal(f.card.workspace.pending.requestId, requestId); assert.equal(f.operatorCalls.length, 0); assert.equal(f.sourceCalls, 1);
    f.sourceRun = async () => { delete f.card.workspace.pending; f.run.controlState = 'PAUSED'; f.run.controlRevision++; const command = f.command; f.commandFor('PAUSE'); f.command = command;
        return { runId: f.run.id, actions: 0, state: 'PAUSED' }; };
    result = await f.start(); assert.equal(result.state, 'PAUSED'); assert.equal(f.sourceCalls, 2);
    assert.equal((await f.start()).state, 'PAUSED'); assert.equal(f.sourceCalls, 2);
});

test('an orphan source hold cannot start a new action and a throwing continuation is never retried in the invocation', async () => {
    const f = fixture(); f.prepared(); f.work.set(f.run.id, { permits: 1 });
    assert.equal((await f.start()).code, 'ASTRA_SOURCE_WORK_UNRESOLVED'); assert.equal(f.sourceCalls, 0);
    const g = fixture(); g.prepared(); g.sourceRun = async () => { throw Error(g.env.ATLAS_OPERATOR_DATABASE_URL); };
    const result = await g.start(); assert.equal(result.state, 'HELD'); assert.equal(g.sourceCalls, 1); assert.equal(g.operatorCalls.length, 0);
    assert(!JSON.stringify(result).includes('synthetic_password'));
});

test('source report IDs, absent successor proof, changed immutable result and pending finalization deny report execution', async () => {
    const changes = [(_f, reply) => { reply.reportRunId = randomUUID(); }, f => { f.operations.clear(); },
        f => { [...f.operations.values()][0].contentHash = '1'.repeat(64); }, f => { f.card.workspace.pending = { requestId: randomUUID() }; },
        f => { [...f.jobs.values()][0].state = 'UNKNOWN'; }, f => { [...f.sources.values()][0].gradingExecutionId = randomUUID(); },
        f => { [...f.permits.values()][0].state = 'UNKNOWN'; }, f => { f.work.set(f.run.id, { sources: 1 }); }];
    for (const change of changes) {
        const f = fixture(); f.prepared(); f.afterSource = (_input, reply) => change(f, reply);
        const result = await f.start(); assert.equal(result.state, 'HELD', change.toString()); assert.equal(f.operatorCalls.length, 0);
    }
});

test('a direct report input needs a current linked workspace and original admission; expired capture deadline does not expire its valid successor', async () => {
    const f = fixture(), report = f.makeReport();
    f.now = new Date(+f.run.deadlineAt + 1); report.deadlineAt = new Date(+f.now + 10000);
    report.controlRevision++; f.commandFor('RESUME', report);
    assert.equal((await f.start({ runId: report.id })).state, 'READY_FOR_HUMAN'); assert.equal(f.sourceCalls, 0);
    assert.equal((await f.start({ runId: report.id })).state, 'READY_FOR_HUMAN');
    const g = fixture(), wrong = g.makeReport(); wrong.captureRunId = randomUUID();
    assert.equal((await g.start({ runId: wrong.id })).state, 'HELD'); assert.deepEqual(g.events, []);
});

test('source success cannot advance through a new pause, revocation, capture change or grant change', async () => {
    for (const change of [f => { f.runs.get(f.card.claim.runId).controlState = 'PAUSED'; },
        f => { f.identity.accessVersion++; }, f => { f.card.claimFence++; }, f => { f.extraGrant = true; }]) {
        const f = fixture(); f.prepared(); f.afterSource = () => change(f);
        const result = await f.start(); assert(['PAUSED', 'HELD'].includes(result.state)); assert.equal(f.operatorCalls.length, 0);
    }
});

test('concurrent explicit invocations honor the existing operator lease instead of duplicating execution', async () => {
    const f = fixture(), entered = deferred(), gate = deferred();
    f.execute = async ({ runId }) => {
        if (runId === f.run.id) { f.run.leaseOwner = randomUUID(); f.run.leaseExpiresAt = new Date(+NOW + 30000); entered.resolve(); await gate.promise; }
        return f.completeOperator(runId);
    };
    const first = f.start(); await entered.promise;
    const other = createWorkspaceDispatcher(f.options, f.composition), second = await other.run({ runId: f.run.id, commandId: f.command.id });
    assert.equal(second.state, 'HELD'); assert.equal(second.code, 'ASTRA_LEASE_BUSY');
    gate.resolve(); assert.equal((await first).state, 'READY_FOR_HUMAN'); assert.equal(f.sourceCalls, 1);
    assert.equal(f.operatorCalls.filter(id => id === f.run.id).length, 1);
});

test('abort stops at finite boundaries without erasing confirmed work or dispatching the next phase', async () => {
    const f = fixture(), first = new AbortController(); first.abort();
    assert.equal((await f.start({ runId: f.run.id, signal: first.signal })).state, 'STOPPED'); assert.equal(f.transactions, 0);
    const g = fixture(), during = new AbortController(); g.afterOperator = () => during.abort();
    const result = await g.start({ runId: g.run.id, signal: during.signal });
    assert.equal(result.state, 'STOPPED'); assert.equal(result.stepsApplied, 1); assert.equal(g.run.state, 'PREPARATION_READY'); assert.equal(g.sourceCalls, 0);
    const h = fixture(), source = new AbortController(); h.prepared(); h.afterSource = () => source.abort();
    assert.equal((await h.start({ runId: h.run.id, signal: source.signal })).state, 'STOPPED'); assert.equal(h.operatorCalls.length, 0);
});

test('malformed or over-bound execution replies and secret exception text remain held and safely projected', async () => {
    for (const bad of [reply => ({ ...reply, unexpected: 'private storage URL' }), reply => ({ ...reply, runId: randomUUID() }),
        reply => ({ ...reply, receipts: { total: 1, persisted: 2, unconfirmed: 0, pending: 0 } }),
        reply => ({ ...reply, state: 'APPROVED' })]) {
        const f = fixture(); f.execute = async ({ runId }) => bad(f.completeOperator(runId));
        const result = await f.start(); assert.equal(result.state, 'HELD'); assert.equal(f.sourceCalls, 0);
        assert(!JSON.stringify(result).includes('private storage URL'));
    }
    const f = fixture(); f.prepared(); f.sourceRun = async () => ({ runId: f.run.id, actions: 4, state: 'READY', reportRunId: f.makeReport().id });
    assert.equal((await f.start()).state, 'HELD'); assert.equal(f.operatorCalls.length, 0);
});

test('the default source continuation keeps original proof checks before any source call', async () => {
    const f = fixture(); f.prepared();
    const real = createWorkspaceDispatcher(f.options), result = await real.run({ runId: f.run.id, commandId: f.command.id });
    assert.equal(result.state, 'HELD'); assert.equal(result.operatorRuns, 0);
    assert.equal(f.sourceCalls, 0); assert.equal(f.operatorCalls.length, 0);
    assert(f.queries.filter(sql => sql.includes('FROM pg_roles r')).length >= 2,
        'the concrete source runner must also use the coordinator role wrapper');
});

test('fixed actual executeOperatorRun retains artifact and separate operator-client verification before capture execution', async () => {
    const f = fixture(), events = [];
    f.execute = input => executeOperatorRun({ ...input, env: f.env, manifest: f.release,
        manifestHash: digest(canonical(f.release)), artifactRoot: '/synthetic/verified-artifact' }, {
        execArgv: [], verifyArtifact: async () => { events.push('artifact'); },
        createClient: databaseUrl => { assert.equal(databaseUrl, f.env.ATLAS_OPERATOR_DATABASE_URL); events.push('operator-client');
            return { $connect: async () => events.push('connect'), $disconnect: async () => events.push('disconnect') }; },
        createLedger: ({ client, config }) => { assert.notEqual(client, f.client); assert.deepEqual(config, f.operatorConfig);
            return { transaction: async work => { events.push('operator-authority'); return work({}); } }; },
        makeEvidenceClient: () => { events.push('evidence'); return {}; },
        makeAdapters: () => Object.fromEntries(RUNTIME_TOOLS.map(name => [name, {}])),
        makeProvider: () => { throw Error('No provider in fixture.'); },
        run: async ({ runId }) => { const reply = f.completeOperator(runId); return { ...reply, receiptWrites: [Promise.resolve({ state: 'PERSISTED' })] }; },
    });
    assert.equal((await f.start()).state, 'READY_FOR_HUMAN');
    assert.deepEqual(events, Array.from({ length: 2 }, () => ['artifact', 'operator-client', 'connect', 'operator-authority', 'evidence', 'disconnect']).flat());
    const g = fixture(); g.execute = input => executeOperatorRun({ ...input, env: g.env, manifest: g.release,
        manifestHash: digest(canonical(g.release)), artifactRoot: '/synthetic/changed-artifact' }, {
        execArgv: [], verifyArtifact: async () => { throw Object.assign(Error('artifact changed'), { code: 'ASTRA_ARTIFACT_CHANGED' }); },
        createClient: () => { throw Error('Must not construct a client.'); },
    });
    const rejected = await g.start(); assert.equal(rejected.state, 'STOPPED'); assert.equal(rejected.code, 'ASTRA_ARTIFACT_CHANGED');
    assert.equal(g.sourceCalls, 0); assert.equal(g.run.state, 'QUEUED');
});

test('lost STEP acknowledgment recovers the exact immutable applied boundary without another execution', async () => {
    const f = fixture(); Object.assign(f.run, { executionMode: 'STEP', stepBudget: 1 }); f.commandFor();
    const command = { runId: f.run.id, commandId: f.command.id }, before = await f.dispatcher.admit(command);
    assert.equal((await f.dispatcher.run(command)).state, 'PAUSED');
    const after = await f.dispatcher.admit(command);
    assert.equal(after.state, 'SETTLED'); assert.equal(after.commandHash, before.commandHash);
    assert.equal((await f.dispatcher.run(command)).state, 'PAUSED');
    assert.equal(f.operatorCalls.length, 1); assert.equal(f.sourceCalls, 0);
});
test('a new STEP has a distinct generation and a delayed older invocation cannot consume it', async () => {
    const f = fixture(); Object.assign(f.run, { executionMode: 'STEP', stepBudget: 1 }); f.commandFor();
    const old = { runId: f.run.id, commandId: f.command.id };
    await f.dispatcher.run(old);
    Object.assign(f.run, { controlState: 'RUNNING', controlRevision: f.run.controlRevision + 1, stepBudget: 1 }); f.commandFor('STEP');
    const next = await f.admit(), recovered = await f.dispatcher.admit(old);
    assert.equal(next.state, 'ADMITTED'); assert.equal(recovered.state, 'SETTLED'); assert.notEqual(next.commandHash, recovered.commandHash);
    const delayed = await f.dispatcher.run(old);
    assert.equal(delayed.state, 'YIELDED'); assert.equal(delayed.operatorRuns, 0); assert.equal(delayed.sourceActions, 0);
    assert.equal(f.run.stepBudget, 1); assert.equal(f.sourceCalls, 0);
});
test('a fabricated paused state without an applied step or exact source result cannot prove settlement', async () => {
    const f = fixture(); Object.assign(f.run, { executionMode: 'STEP', stepBudget: 1 }); f.commandFor();
    Object.assign(f.run, { controlState: 'PAUSED', controlRevision: 3, stepBudget: 0 });
    assert.equal((await f.admit()).state, 'HELD'); assert.equal((await f.start()).state, 'HELD'); assert.deepEqual(f.events, []);
});
test('command identity, scope, baseline and canonical hash are checked before admission', async () => {
    for (const alter of [event => { event.actorId = randomUUID(); }, event => { event.cardId = randomUUID(); },
        event => { event.result.claim.id = randomUUID(); }, event => { event.result.claim.runId = randomUUID(); },
        event => { event.result.claim.captureHash = '9'.repeat(64); }, event => { event.action = 'MANUAL_ACTION'; }]) {
        const f = fixture(), event = copy(f.command); alter(event); f.operations.set(event.id, encoded(event));
        const result = await f.admit(); assert.equal(result.state, 'HELD'); assert.equal(result.commandHash, null); assert.deepEqual(f.events, []);
    }
    const f = fixture(); f.command.contentHash = '0'.repeat(64); assert.equal((await f.admit()).state, 'HELD');
    const g = fixture(); await assert.rejects(() => g.dispatcher.run({ runId: g.run.id })); assert.equal(g.transactions, 0);
});
test('in-flight admission retains the exact validated command key while unknown provider work remains held', async () => {
    const f = fixture(); Object.assign(f.run, { leaseOwner: randomUUID(), leaseExpiresAt: new Date(+NOW + 30000) });
    let admission = await f.admit(); assert.equal(admission.state, 'IN_FLIGHT'); assert.equal(admission.commandHash, f.command.contentHash);
    f.work.set(f.run.id, { attempts: 1, held: 1, unknown: 1, unknownAttempts: 1 });
    admission = await f.admit(); assert.equal(admission.state, 'HELD'); assert.deepEqual(f.events, []);
});
