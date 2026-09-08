import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../.generated/staff-database/index.js';
import { canonical, digest } from '../../../packages/atlas-service-bridge/src/protocol.mjs';
import { OperatorLedger, enqueueOperatorRun } from '../../../packages/atlas-operator/src/ledger.mjs';
import { makeOperatorConfig } from '../../../packages/atlas-operator/src/policy.mjs';
import { openAiBinding, responsesTransport } from '../../../packages/atlas-operator/src/provider.mjs';
import { MODEL, PRICING, requestReservation } from '../../../packages/atlas-operator/src/responses.mjs';
import { bridgeFixture, gradingInput } from './bridge-fixture.mjs';

const reject = (code, work) => assert.rejects(work,error => error.code === code,code);
async function fixture(context, work, options = {}) {
    const bridge = await bridgeFixture(context,options.bridgeOptions);
    const budget = { ...bridge.policy, maxTotalMicroUsd: options.total ?? 1_000_000_000, maxCardMicroUsd: options.card ?? 100_000_000 };
    const policyCanonical = canonical(budget);
    await context.admin.staffGradingBridgeControl.update({ where: { id: 'active' }, data: {
        policyCanonical, policyHash: digest(policyCanonical), revision: { increment: 1 } } });
    const binding = openAiBinding({ ATLAS_OPERATOR_OPENAI_PROJECT_ID: 'proj_fixture000000',
        ATLAS_OPERATOR_OPENAI_API_KEY: 'sk-synthetic-fixture-key-only-00000000' });
    const config = makeOperatorConfig({ databaseUrl: context.db.operatorUrl, mode: 'LOCAL_FIXTURE', releaseSha: '0'.repeat(40),
        buildHash: digest('synthetic runner; no artifact activation'), providerBindingHash: binding.bindingHash });
    const policy = { version: 'atlas-operator-control-policy-v1', pilotId: budget.pilotId, expiresAt: budget.expiresAt,
        prompt: 'Synthetic workflow test. Inspect both sides; route uncertainty to the reviewer.',
        astra: { version: 'atlas-astra-policy-v1', model: MODEL, returnedModel: MODEL, effort: 'medium', serviceTier: 'default',
            maxOutputTokens: 2000, requestTimeoutMs: 10_000, pricingVersion: PRICING.version,
            inputNanoUsdPerToken: PRICING.inputNanoUsdPerToken, outputNanoUsdPerToken: PRICING.outputNanoUsdPerToken },
        tools: options.tools ?? ['read_card_report','submit_for_human_review'], maxAttemptsPerCard: 10, maxStepsPerRun: 8,
        maxRunMs: 600_000, leaseMs: 60_000, concurrency: 1 };
    await context.admin.staffOperatorControl.create({ data: { ...config, enabled: true,
        policyCanonical: canonical(policy), policyHash: digest(canonical(policy)) } });
    const client = new PrismaClient({ datasources: { db: { url: context.db.operatorUrl } } });
    const ledger = new OperatorLedger({ client, config });
    const signed = await context.login();
    async function initialize(index = 0) {
        let card = await bridge.review.read(signed.staff,bridge.specimenIds[index]);
        card = (await bridge.grading.run(signed.staff,card.id,gradingInput(card))).card;
        assert.equal(card.grading.analysisRevision,1); return card;
    }
    async function start(index = 0) {
        const card = await initialize(index);
        const run = await enqueueOperatorRun(context.admin,config,card.id);
        const { lease, mode } = await ledger.claim(run.id,randomUUID()); assert.equal(mode,'WORK'); return { card, run, lease };
    }
    let calls = 0;
    async function request(lease, name = 'read_card_report', extra = {}, options = {}) {
        const attempt = await ledger.reserve(lease);
        const run = await context.admin.staffOperatorRun.findUnique({ where: { id: lease.runId } });
        const args = { runId: run.id, evidenceHash: run.evidenceHash, expectedRevision: lease.revision, manifestHash: run.manifestHash, ...extra };
        const transport = responsesTransport({ binding, takeDispatch: id => ledger.takeDispatch(lease,id), fetchImpl: async (_url, init) => {
            calls++; assert.equal(init.headers['OpenAI-Project'],binding.projectId);
            if (options.unknown) throw Error('SYNTHETIC LOST RESPONSE');
            const response = { id: `resp_fixture_${calls}`, model: MODEL, service_tier: 'default', status: 'completed',
                output: [{ type: 'reasoning', encrypted_content: 'opaque-synthetic-continuation', summary: [] },
                    { type: 'function_call', call_id: `call_fixture_${calls}`, name, arguments: canonical(args) }],
                usage: { input_tokens: 500, output_tokens: 100, total_tokens: 600 } };
            return new Response(JSON.stringify(response),{ status: 200, headers: { 'content-type': 'application/json', 'x-request-id': `req_fixture_${calls}` } });
        } });
        const receipt = await transport.dispatch(attempt.attemptId);
        if (!options.deferReceipt) await ledger.recordReceipt({ ...attempt, receipt });
        return { ...attempt, receipt };
    }
    const expire = runId => context.admin.$executeRaw`UPDATE atlas_staff."StaffOperatorRun"
      SET "leaseExpiresAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second' WHERE id=${runId}::uuid`;
    try { await work({ ...context, bridge, config, binding, client, ledger, budget, policy, signed, initialize, start, request, expire, calls: () => calls }); }
    finally { await client.$disconnect(); }
}
export { fixture as operatorFixture };

export async function operatorScenarios(scenario) {
    await scenario('Astra intake requires a fresh initial grading and cannot use serving or runner authority', context => fixture(context, async f => {
        await assert.rejects(() => enqueueOperatorRun(f.admin,f.config,f.bridge.specimenIds[0]),/ASTRA_GRADING_REQUIRED/);
        const card = await f.initialize();
        await assert.rejects(() => enqueueOperatorRun(f.client,f.config,card.id));
        const run = await enqueueOperatorRun(f.admin,f.config,card.id);
        await assert.rejects(() => enqueueOperatorRun(f.admin,f.config,card.id));
        const unsafe = new OperatorLedger({ client: f.admin, config: f.config });
        await reject('ASTRA_DATABASE_ROLE_INVALID',() => unsafe.claim(run.id,randomUUID()));
        for (const query of ['SELECT * FROM public."User"','SELECT * FROM atlas_staff."StaffSession"',
            'UPDATE atlas_staff."StaffOperatorControl" SET enabled=true','UPDATE atlas_staff."StaffIdentity" SET "certificationUntil"=now()',
            'INSERT INTO atlas_staff."StaffReportApproval" (id) VALUES (gen_random_uuid())']) await assert.rejects(() => f.client.$executeRawUnsafe(query));
        await assert.rejects(() => context.client.$queryRaw`SELECT * FROM atlas_staff."StaffOperatorRun"`);
        const claim = await f.ledger.claim(run.id,randomUUID()); assert.equal(claim.mode,'WORK');
    }));
    await scenario('Astra concurrent lease and dispatch claims consume one persistent HTTP attempt', context => fixture(context, async f => {
        const card = await f.initialize(), run = await enqueueOperatorRun(f.admin,f.config,card.id);
        const claims = await Promise.allSettled([f.ledger.claim(run.id,randomUUID()),f.ledger.claim(run.id,randomUUID())]);
        assert.equal(claims.filter(r => r.status === 'fulfilled').length,1);
        const lease = claims.find(r => r.status === 'fulfilled').value.lease, attempt = await f.ledger.reserve(lease);
        const grants = await Promise.allSettled([f.ledger.takeDispatch(lease,attempt.attemptId),f.ledger.takeDispatch(lease,attempt.attemptId)]);
        assert.equal(grants.filter(r => r.status === 'fulfilled').length,1);
        assert.equal((await f.admin.staffOperatorAttempt.findUnique({ where: { id: attempt.attemptId } })).state,'DISPATCHED');
        await reject('ASTRA_WORK_UNRESOLVED',() => f.ledger.reserve(lease));
        assert.equal(await f.admin.staffOperatorAttempt.count(),1);
    }));
    await scenario('Astra committed steps, opaque continuation and exact human outbox survive a fresh runner', context => fixture(context, async f => {
        const { run, lease } = await f.start(); const first = await f.request(lease);
        const rebuilt = new OperatorLedger({ client: f.client, config: f.config });
        const step = await rebuilt.applyTool(lease,first.attemptId,async ({ manifest }) => ({ reportHash: manifest.reportHash, synthetic: true }));
        assert.equal(step.lease.revision,2); assert.equal(step.state,'RUNNING');
        const updated = await f.admin.staffOperatorRun.findUnique({ where: { id: run.id } });
        assert.match(updated.inputCanonical,/opaque-synthetic-continuation/);
        assert.equal(JSON.parse(updated.inputCanonical).at(-1).call_id,'call_fixture_1');
        await reject('ASTRA_LEASE_STALE',() => rebuilt.applyTool(lease,first.attemptId,() => { throw Error('Must never rerun'); }));
        const reportHash = JSON.parse(run.manifestCanonical).reportHash;
        const second = await f.request(step.lease,'submit_for_human_review',{ reportHash, disposition: 'READY_FOR_REVIEW', summary: 'Synthetic draft ready for a human.' });
        const done = await rebuilt.applyTool(step.lease,second.attemptId,async () => ({ proposals: 0 }));
        assert.equal(done.state,'READY_FOR_HUMAN'); assert.equal(await f.admin.staffOperatorStep.count(),2);
        assert.equal(await f.admin.staffReportApproval.count(),0); assert.equal(await f.admin.staffOperatorOutbox.count(),1);
        const outbox = await rebuilt.claimOutbox(randomUUID()); assert.equal(outbox.payload.reportHash,reportHash);
        assert.equal(await rebuilt.claimOutbox(randomUUID()),null);
        await reject('ASTRA_OUTBOX_STALE',() => rebuilt.acknowledgeOutbox({ ...outbox, owner: randomUUID() }));
        assert.deepEqual(await rebuilt.acknowledgeOutbox(outbox),{ delivered: true });
        assert.deepEqual(await rebuilt.acknowledgeOutbox(outbox),{ delivered: true });
        const attempt = await f.admin.staffOperatorAttempt.findUnique({ where: { id: second.attemptId } });
        assert.equal(attempt.usageCeilingMicroUsd,20_000n); assert.equal(attempt.actualMicroUsd,null);
        assert.equal(f.calls(),2);
    }));
    await scenario('Astra atomic handoff rollback preserves the exact unapplied receipt', context => fixture(context, async f => {
        const { run, lease } = await f.start();
        const attempt = await f.request(lease,'submit_for_human_review',{ reportHash: JSON.parse(run.manifestCanonical).reportHash,
            disposition: 'NEEDS_EXPERT', summary: 'Synthetic ambiguous finding.' });
        await f.sql(`CREATE FUNCTION atlas_staff.fixture_reject_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_OUTBOX_ROLLBACK'; END $$;
          CREATE TRIGGER fixture_reject_outbox BEFORE INSERT ON atlas_staff."StaffOperatorOutbox" FOR EACH ROW EXECUTE FUNCTION atlas_staff.fixture_reject_outbox();`);
        await assert.rejects(() => f.ledger.applyTool(lease,attempt.attemptId,async () => ({ synthetic: true })),/SYNTHETIC_OUTBOX_ROLLBACK/);
        assert.equal(await f.admin.staffOperatorStep.count(),0); assert.equal(await f.admin.staffOperatorOutbox.count(),0);
        assert.equal((await f.admin.staffOperatorAttempt.findUnique({ where: { id: attempt.attemptId } })).state,'RECEIVED');
        assert.equal((await f.admin.staffOperatorRun.findUnique({ where: { id: run.id } })).revision,1);
        // Only the test-injected trigger in this owned case database is removed.
        await f.sql('DROP TRIGGER fixture_reject_outbox ON atlas_staff."StaffOperatorOutbox"');
        assert.equal((await f.ledger.applyTool(lease,attempt.attemptId,async () => ({ synthetic: true }))).state,'NEEDS_EXPERT');
    }));
    await scenario('Astra expired dispatch acquires reconciliation only; late receipt never gains a new tool lease', context => fixture(context, async f => {
        const { run, lease } = await f.start(), attempt = await f.request(lease,'read_card_report',{}, { deferReceipt: true });
        await f.expire(run.id);
        await reject('ASTRA_LEASE_STALE',() => f.ledger.renew(lease));
        const recovered = await f.ledger.claim(run.id,randomUUID()); assert.equal(recovered.mode,'RECONCILE_ONLY');
        assert.equal(recovered.lease.fence,2);
        await assert.rejects(() => f.admin.staffOperatorRun.update({ where: { id: run.id }, data: { state: 'FAILED' } }));
        await assert.rejects(() => f.admin.staffOperatorRun.update({ where: { id: run.id }, data: { state: 'RUNNING' } }));
        await f.ledger.recordReceipt(attempt);
        assert.equal((await f.admin.staffOperatorRun.findUnique({ where: { id: run.id } })).state,'UNKNOWN');
        await reject('ASTRA_LEASE_STALE',() => f.ledger.takeDispatch(lease,attempt.attemptId));
        await reject('ASTRA_LEASE_STALE',() => f.ledger.reserve(recovered.lease));
        await reject('ASTRA_LEASE_STALE',() => f.ledger.inspectTool(recovered.lease,attempt.attemptId));
        assert.equal(await f.admin.staffOperatorReceipt.count(),1); assert.equal(f.calls(),1);
        assert.equal((await f.admin.staffOperatorAttempt.findUnique({ where: { id: attempt.attemptId } })).usageCeilingMicroUsd,20_000n);
    }));
    await scenario('Astra undispatched expired reservation cancels before a new fenced attempt', context => fixture(context, async f => {
        const { run, lease } = await f.start(), first = await f.ledger.reserve(lease);
        await f.expire(run.id);
        const claim = await f.ledger.claim(run.id,randomUUID()); assert.equal(claim.mode,'WORK');
        const prior = await f.admin.staffOperatorAttempt.findUnique({ where: { id: first.attemptId } });
        assert.equal(prior.state,'FAILED'); assert.equal(prior.dispatchedAt,null); assert.equal(prior.actualMicroUsd,null);
        const [usage] = await f.admin.$queryRaw`SELECT * FROM atlas_staff.pilot_budget_usage(${run.pilotId}::uuid,${run.specimenId}::uuid)`;
        assert.equal(usage.card,'10000');
        await reject('ASTRA_LEASE_STALE',() => f.ledger.takeDispatch(lease,first.attemptId));
        const second = await f.ledger.reserve(claim.lease); assert.notEqual(second.attemptId,first.attemptId);
        await assert.rejects(() => f.admin.staffOperatorAttempt.update({ where: { id: first.attemptId }, data: { state: 'RESERVED', finishedAt: null } }));
    }));
    await scenario('Astra and grading workers share held pilot reservations before either service spends again', context => fixture(context, async f => {
        const { run, lease } = await f.start(), attempt = await f.request(lease,'read_card_report',{}, { unknown: true });
        assert.equal((await f.admin.staffOperatorAttempt.findUnique({ where: { id: attempt.attemptId } })).usageCeilingMicroUsd,null);
        const [usage] = await f.admin.$queryRaw`SELECT * FROM atlas_staff.pilot_budget_usage(${run.pilotId}::uuid,${run.specimenId}::uuid)`;
        assert.equal(usage.total,String(requestReservation(f.policy.astra)+10_000));
        const other = await f.bridge.review.read(f.signed.staff,f.bridge.specimenIds[1]);
        const blocked = await f.bridge.grading.run(f.signed.staff,other.id,gradingInput(other));
        assert.equal(blocked.operation.state,'FAILED'); assert.equal(blocked.operation.failureCode,'PILOT_BUDGET_EXHAUSTED');
        assert.equal(f.bridge.calls(),1); assert.equal(f.calls(),1);
    },{ total: 23_210_000, card: 23_210_000 }));
    await scenario('Astra verified usage does not become invoice cost; actual overrun is write-once and pauses the pilot', context => fixture(context, async f => {
        const { lease } = await f.start(), attempt = await f.request(lease);
        const next = await f.ledger.applyTool(lease,attempt.attemptId,async () => ({ synthetic: true }));
        await assert.rejects(() => f.client.staffOperatorAttempt.update({ where: { id: attempt.attemptId }, data: { actualMicroUsd: 0n, costEvidenceHash: 'a'.repeat(64) } }));
        await f.admin.staffOperatorAttempt.update({ where: { id: attempt.attemptId }, data: { actualMicroUsd: 20_001n, costEvidenceHash: 'a'.repeat(64) } });
        await assert.rejects(() => f.admin.staffOperatorAttempt.update({ where: { id: attempt.attemptId }, data: { actualMicroUsd: 0n, costEvidenceHash: 'b'.repeat(64) } }));
        await reject('ASTRA_BUDGET_EXHAUSTED',() => f.ledger.reserve(next.lease));
        const other = await f.bridge.review.read(f.signed.staff,f.bridge.specimenIds[1]);
        assert.equal((await f.bridge.grading.run(f.signed.staff,other.id,gradingInput(other))).operation.failureCode,'PILOT_BUDGET_EXHAUSTED');
    }));
    await scenario('Astra wrong tool scope and forged run advancement cannot change the deterministic report', context => fixture(context, async f => {
        const { run, card, lease } = await f.start(), attempt = await f.request(lease,'read_card_report',{ evidenceHash: 'f'.repeat(64) });
        await reject('ASTRA_TOOL_SCOPE_CHANGED',() => f.ledger.applyTool(lease,attempt.attemptId,async () => ({ synthetic: true })));
        await assert.rejects(() => f.admin.$transaction(async tx => {
            await tx.staffOperatorRun.update({ where: { id: run.id }, data: { revision: 2 } });
            await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
        }));
        await assert.rejects(() => f.admin.staffSpecimen.update({ where: { id: card.id }, data: { draftRevision: { increment: 1 } } }));
        const view = await f.bridge.review.read(f.signed.staff,card.id); assert.equal(view.grading.approvalBlock,'GRADING_WORK_UNRESOLVED');
        await reject('GRADING_WORK_UNRESOLVED',() => f.bridge.grading.run(f.signed.staff,card.id,gradingInput(view,
            { type: 'REMOVE', defectIds: [view.grading.report.findings[0].id] })));
        assert.equal(await f.admin.staffOperatorStep.count(),0); assert.equal(view.grading.analysisRevision,1);
    }));
    await scenario('Astra revocation retains late cost receipts and never executes a tool', context => fixture(context, async f => {
        const { run, lease } = await f.start(), attempt = await f.request(lease,'read_card_report',{}, { deferReceipt: true });
        await f.admin.staffOperatorControl.update({ where: { id: 'active' }, data: { enabled: false, revision: { increment: 1 } } });
        const stored = await f.ledger.recordReceipt(attempt), replay = await f.ledger.recordReceipt(attempt);
        assert.equal(stored.receiptId,replay.receiptId); assert.equal(await f.admin.staffOperatorReceipt.count(),1);
        await reject('ASTRA_NOT_ENABLED',() => f.ledger.inspectTool(lease,attempt.attemptId));
        assert.equal((await f.admin.staffOperatorRun.findUnique({ where: { id: run.id } })).state,'UNKNOWN');
        assert.equal((await f.admin.staffOperatorAttempt.findUnique({ where: { id: attempt.attemptId } })).usageCeilingMicroUsd,20_000n);
    }));
    await scenario('Astra immutable run policy retains original pricing after pilot instructions change', context => fixture(context, async f => {
        const { run, lease } = await f.start(), attempt = await f.request(lease,'read_card_report',{}, { deferReceipt: true });
        const changed = canonical({ ...f.policy, prompt: 'Amended synthetic instructions.' });
        await f.admin.staffOperatorControl.update({ where: { id: 'active' }, data: { policyCanonical: changed, policyHash: digest(changed), revision: { increment: 1 } } });
        await f.ledger.recordReceipt(attempt);
        const retained = await f.admin.staffOperatorRun.findUnique({ where: { id: run.id } });
        assert.equal(retained.policyCanonical,canonical(f.policy)); assert.equal(retained.state,'UNKNOWN');
        assert.equal((await f.admin.staffOperatorAttempt.findUnique({ where: { id: attempt.attemptId } })).usageCeilingMicroUsd,20_000n);
        await reject('ASTRA_RUN_NOT_CURRENT',() => f.ledger.inspectTool(lease,attempt.attemptId));
    }));
    await scenario('Astra replacement runtime cannot inherit a pinned run or fabricate usage settlement', context => fixture(context, async f => {
        const { run, lease } = await f.start(), attempt = await f.ledger.reserve(lease);
        await f.ledger.takeDispatch(lease,attempt.attemptId);
        await assert.rejects(() => f.client.staffOperatorAttempt.update({ where: { id: attempt.attemptId }, data: { usageCeilingMicroUsd: 0n } }));
        const next = makeOperatorConfig({ databaseUrl: f.db.operatorUrl, mode: 'LOCAL_FIXTURE', releaseSha: '0'.repeat(40),
            buildHash: digest('different synthetic runner'), providerBindingHash: f.binding.bindingHash });
        await f.admin.staffOperatorControl.update({ where: { id: 'active' }, data: { ...next, revision: { increment: 1 } } });
        await f.expire(run.id);
        const replacement = new OperatorLedger({ client: f.client, config: next });
        await reject('ASTRA_RUN_NOT_CURRENT',() => replacement.claim(run.id,randomUUID()));
        assert.equal((await f.admin.staffOperatorRun.findUnique({ where: { id: run.id } })).runtimeHash,f.config.configHash);
    }));
    await scenario('Astra conflicting provider receipts remain immutable and stop further tool execution', context => fixture(context, async f => {
        const { run, lease } = await f.start(), attempt = await f.request(lease);
        const conflicting = structuredClone(attempt.receipt); conflicting.body.id='resp_conflicting';
        conflicting.bodyHash=digest(canonical(conflicting.body));
        await f.ledger.recordReceipt({ ...attempt, receipt: conflicting });
        assert.equal(await f.admin.staffOperatorReceipt.count(),2);
        const retained = await f.admin.staffOperatorRun.findUnique({ where: { id: run.id } });
        assert.equal(retained.state,'UNKNOWN'); assert.equal(retained.failureCode,'ASTRA_CONFLICTING_RECEIPT');
        await reject('ASTRA_TOOL_NOT_READY',() => f.ledger.inspectTool(lease,attempt.attemptId));
        assert.equal(await f.admin.staffOperatorStep.count(),0);
    }));
}
