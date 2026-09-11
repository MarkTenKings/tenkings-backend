// Owned disposable PostgreSQL and synthetic providers only. These scenarios
// change fixture policies through the administrator; they never admit live work.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { canonical, digest } from '@atlas/service-bridge/protocol';
import { workspaceCaptureFixture, updateWorkspaceFixtureCard } from './workspace-capture-fixture.mjs';
import { workspaceSourceFixture } from './workspace-source-fixture.mjs';
import { StaffWorkspaceIdentification, workspaceIdentificationSettings } from '../lib/server/access/workspace-identification.mjs';
import { workspaceIdentificationPhotos } from '../lib/workspace-identification.mjs';
import { syntheticPng } from '../../../packages/atlas-contracts/test/fixtures.mjs';
import { buildRequest, requestReservation } from '../../../packages/atlas-operator/src/responses.mjs';
import { bridgeFixture, gradingInput } from './bridge-fixture.mjs';

const options = { rosterSize: 1, preparationEnabled: true, effort: 'max' };
async function policy(f, changes) {
    const next = { ...f.budget, ...changes }, text = canonical(next);
    await f.admin.staffGradingBridgeControl.update({ where: { id: 'active' }, data: {
        policyCanonical: text, policyHash: digest(text), revision: { increment: 1 } } });
    return next;
}
const usage = async f => (await f.admin.$queryRaw`SELECT * FROM atlas_staff.workspace_pilot_budget_usage(${f.budget.pilotId}::uuid,${f.ids[0]}::uuid)`)[0];
async function infrastructure(f, reserve) {
    return f.admin.staffWorkspaceInfrastructureReservation.create({ data: { id: randomUUID(), pilotId: f.budget.pilotId,
        sourceConfigHash: digest('owned accounting scenario'), reservedMicroUsd: reserve,
        createdAt: new Date(), expiresAt: new Date(f.budget.expiresAt) } });
}

export async function processingDollarLimitsScenarios(scenario) {
    await scenario('human grading accounting-only admission retains original reservation and per-card operation count', async context => {
        const bridge = await bridgeFixture(context), signed = await context.login();
        const next = { ...bridge.policy, budgetEnforcement: 'ACCOUNTING_ONLY', maxTotalMicroUsd: 1, maxCardMicroUsd: 1, maxOperationsPerCard: 1 };
        await context.admin.staffGradingBridgeControl.update({ where: { id: 'active' }, data: {
            policyCanonical: canonical(next), policyHash: digest(canonical(next)), revision: { increment: 1 } } });
        let card = await bridge.review.read(signed.staff, bridge.specimenIds[0]);
        const input = gradingInput(card), first = await bridge.grading.run(signed.staff, card.id, input);
        assert.equal(first.operation.state, 'SUCCEEDED'); card = first.card;
        const [execution] = await context.admin.staffGradingExecution.findMany();
        assert.equal(execution.reservedMicroUsd, 10000n); assert.equal(bridge.calls(), 1);
        assert.deepEqual(await bridge.grading.run(signed.staff, card.id, input), first); assert.equal(bridge.calls(), 1);
        const second = await bridge.grading.run(signed.staff, card.id, gradingInput(card,
            { type: 'REMOVE', defectIds: [card.grading.report.findings[0].id] }));
        assert.equal(second.operation.failureCode, 'PILOT_BUDGET_EXHAUSTED'); assert.equal(bridge.calls(), 1);
        assert.equal(await context.admin.staffGradingExecution.count(), 1);
        assert.equal(await context.admin.staffReportApproval.count(), 0);
    });
    await scenario('accounting-only mode is explicit, strict and unavailable to serving or runner policy writers', context => workspaceCaptureFixture(context, async f => {
        const original = await f.admin.staffGradingBridgeControl.findUnique({ where: { id: 'active' } });
        assert.equal(Object.hasOwn(JSON.parse(original.policyCanonical), 'budgetEnforcement'), false);
        const allow = async (p, total = '0', card = '0', reserve = '0', overrun = false, hard = null) =>
            (await f.admin.$queryRaw`SELECT atlas_staff.pilot_dollar_limits_allow(${canonical(p)}::jsonb,
                ${total}::numeric,${card}::numeric,${reserve}::numeric,${overrun}::boolean,${hard}::numeric) AS allowed`)[0].allowed;
        assert.equal(await allow(f.budget, '89999999', '89999999', '1'), true);
        assert.equal(await allow(f.budget, '89999999', '89999999', '2'), false);
        assert.equal(await allow(f.budget, '0', '0', '0', true), false);
        const accounting = { ...f.budget, budgetEnforcement: 'ACCOUNTING_ONLY' };
        assert.equal(await allow(accounting, '90000000000', '90000000000', '23650000', true, '90000000'), true);
        for (const mode of [null, false, '', 'ENFORCED', 'accounting_only', 1, {}]) {
            await assert.rejects(() => allow({ ...f.budget, budgetEnforcement: mode }), /mode invalid/);
            await assert.rejects(() => policy(f, { budgetEnforcement: mode }), /budget_enforcement/);
        }
        for (const amount of [null, '-1', '0.1', 'NaN', 'Infinity'])
            await assert.rejects(() => allow(accounting, amount), /accounting input invalid/);
        await assert.rejects(() => allow(accounting, '0', '0', '0', null), /accounting input invalid/);
        for (const client of [context.client, f.client]) {
            await assert.rejects(() => client.$executeRaw`UPDATE atlas_staff."StaffGradingBridgeControl" SET revision=revision+1`, /permission denied/);
            await assert.rejects(() => client.$queryRaw`SELECT atlas_staff.pilot_dollar_limits_allow(${canonical(accounting)}::jsonb,0,0,0,false)`, /permission denied/);
        }
        assert.deepEqual(await f.admin.staffGradingBridgeControl.findUnique({ where: { id: 'active' } }), original);
    }, options));

    await scenario('infrastructure above former ceilings remains immutable accounting; operator dispatch still consumes one held attempt', context => workspaceCaptureFixture(context, async f => {
        await assert.rejects(() => infrastructure(f, 100_000_000n), /original pilot budget/);
        assert.equal(await f.admin.staffWorkspaceInfrastructureReservation.count(), 0);
        await policy(f, { budgetEnforcement: 'ACCOUNTING_ONLY', maxTotalMicroUsd: 1, maxCardMicroUsd: 1 });
        const held = await infrastructure(f, 100_000_000n);
        const observed = await f.admin.staffWorkspaceInfrastructureReservation.update({ where: { id: held.id },
            data: { actualMicroUsd: 100_000_001n, costEvidenceHash: digest('synthetic invoice') } });
        assert.equal((await usage(f)).overrun, true); assert.equal((await usage(f)).total, '100000001');
        await assert.rejects(() => f.admin.staffWorkspaceInfrastructureReservation.update({ where: { id: held.id },
            data: { reservedMicroUsd: 0n } }), /immutable/);
        await assert.rejects(() => f.admin.staffWorkspaceInfrastructureReservation.delete({ where: { id: held.id } }), /immutable/);
        const { run, lease } = await f.claim(), beforeCard = await f.card();
        const attempt = await f.ledger.reserve(lease);
        assert.equal((await f.admin.staffOperatorAttempt.findUnique({ where: { id: attempt.attemptId } })).reservedMicroUsd, BigInt(requestReservation(f.policy.astra)));
        await f.ledger.takeDispatch(lease, attempt.attemptId);
        await assert.rejects(() => f.ledger.takeDispatch(lease, attempt.attemptId));
        await assert.rejects(() => f.ledger.reserve(lease), /ASTRA_WORK_UNRESOLVED/);
        const after = await usage(f); assert.equal(after.attempts, 1); assert.equal(after.overrun, true);
        assert(BigInt(after.total) > 100_000_001n); assert.equal(await f.admin.staffOperatorReceipt.count(), 0);
        assert.equal(await f.admin.staffOperatorAttempt.count(), 1);
        assert.deepEqual(await f.admin.staffWorkspaceInfrastructureReservation.findUnique({ where: { id: held.id } }), observed);
        const current = await f.admin.staffOperatorRun.findUnique({ where: { id: run.id } });
        assert.equal(current.pilotId, run.pilotId); assert.equal(current.inputHash, run.inputHash);
        assert.equal((await f.card()).startedAt, beforeCard.startedAt);
        assert.equal(await f.admin.staffReportApproval.count(), 0);
    }, options));

    await scenario('accounting mode permits exact saved receipt recovery without relabeling the run or paying again', context => workspaceCaptureFixture(context, async f => {
        const { run, lease } = await f.claim(), asset = JSON.parse(run.manifestCanonical).assets[0];
        const attempt = await f.request(lease, 'inspect_region', { assetId: asset.assetId, sourceSha256: asset.sha256,
            side: asset.side, rect: { x: 0, y: 0, width: asset.width, height: asset.height } });
        await f.ledger.stop(lease, { code: 'ASTRA_TOOL_PREPARATION_FAILED' });
        const beforeAttempt = await f.admin.staffOperatorAttempt.findUnique({ where: { id: attempt.attemptId } });
        const beforeReceipt = await f.admin.staffOperatorReceipt.findUnique({ where: { id: beforeAttempt.resultReceiptId } });
        const recoverable = async () => (await context.client.$queryRaw`SELECT atlas_staff.read_workspace_operator_control(${f.ids[0]}::uuid) AS value`)[0].value.canRecover;
        await policy(f, { maxTotalMicroUsd: 10000, maxCardMicroUsd: 10000 }); assert.equal(await recoverable(), false);
        const accounting = await policy(f, { budgetEnforcement: 'ACCOUNTING_ONLY', maxTotalMicroUsd: 1, maxCardMicroUsd: 1 });
        assert.equal(await recoverable(), true); const beforeUsage = await usage(f);
        await f.control('RECOVER');
        assert.deepEqual(await f.admin.staffOperatorAttempt.findUnique({ where: { id: attempt.attemptId } }), beforeAttempt);
        assert.deepEqual(await f.admin.staffOperatorReceipt.findUnique({ where: { id: beforeReceipt.id } }), beforeReceipt);
        assert.deepEqual(await usage(f), beforeUsage); assert.equal(f.calls(), 1);
        const recovered = await f.ledger.claim(run.id, randomUUID());
        const applied = await f.apply(recovered.lease, attempt);
        assert.equal(await f.admin.staffOperatorStep.count({ where: { attemptId: attempt.attemptId } }), 1);
        const exhausted = { ...f.policy, maxAttemptsPerCard: 1 };
        // A new operator policy cannot relabel this admitted run, even in accounting mode.
        await f.admin.staffOperatorControl.update({ where: { id: 'active' }, data: {
            policyCanonical: canonical(exhausted), policyHash: digest(canonical(exhausted)), revision: { increment: 1 } } });
        await assert.rejects(() => f.ledger.reserve(applied.lease));
        await policy(f, { ...accounting, expiresAt: new Date(Date.now() - 1000).toISOString() });
        await assert.rejects(() => f.ledger.reserve(applied.lease));
        assert.equal(await f.admin.staffOperatorAttempt.count(), 1); assert.equal(f.calls(), 1);
    }, options));

    await scenario('accounting-only operator attempts retain SQL count, scope and expiry enforcement', context => workspaceCaptureFixture(context, async f => {
        const limited = { ...f.policy, maxAttemptsPerCard: 1 };
        await f.admin.staffOperatorControl.update({ where: { id: 'active' }, data: {
            policyCanonical: canonical(limited), policyHash: digest(canonical(limited)), revision: { increment: 1 } } });
        const accounting = await policy(f, { budgetEnforcement: 'ACCOUNTING_ONLY', maxTotalMicroUsd: 1, maxCardMicroUsd: 1 });
        const { run, lease } = await f.claim();
        const attempt = await f.request(lease, 'read_original_photos');
        const applied = await f.apply(lease, attempt);
        await assert.rejects(() => f.ledger.reserve(applied.lease), /ASTRA_BUDGET_EXHAUSTED/);
        const current = await f.admin.staffOperatorRun.findUnique({ where: { id: run.id } });
        const request = buildRequest({ policy: limited.astra, prompt: limited.prompt, names: limited.captureTools,
            input: JSON.parse(current.inputCanonical), phase: current.phase });
        const direct = () => f.client.$executeRaw`INSERT INTO atlas_staff."StaffOperatorAttempt"
            (id,"runId",ordinal,"runRevision","leaseFence","dispatchClaimId","requestCanonical","requestHash","providerBindingHash","reservedMicroUsd",state,"createdAt")
            VALUES (${randomUUID()}::uuid,${run.id}::uuid,2,${current.revision},${current.leaseFence},${randomUUID()}::uuid,
                ${request.requestCanonical},${request.requestHash},${f.config.providerBindingHash},${BigInt(requestReservation(limited.astra))},
                'RESERVED',clock_timestamp() AT TIME ZONE 'UTC')`;
        await assert.rejects(direct, /shared workspace pilot budget denied/);
        await policy(f, { ...accounting, workspaceCardIds: [randomUUID()] });
        await assert.rejects(() => f.ledger.reserve(applied.lease)); await assert.rejects(direct);
        await policy(f, { ...accounting, expiresAt: new Date(Date.now() - 1000).toISOString() });
        await assert.rejects(() => f.ledger.reserve(applied.lease)); await assert.rejects(direct);
        assert.equal(await f.admin.staffOperatorAttempt.count(), 1); assert.equal(f.calls(), 1);
        assert.equal(await f.admin.staffReportApproval.count(), 0);
    }, options));

    await scenario('source reservations above former per-call ceilings retain exact unknown liability and cannot redispatch', context => workspaceSourceFixture(context, async f => {
        const request = await f.intent('PREPARE_SIDE', 'FRONT'), input = f.bound(request, 'PHYSICAL_GEOMETRY', 'FRONT'), ledger = f.sourceLedger(request);
        await f.admin.$executeRaw`UPDATE atlas_staff."StaffWorkspaceSourceControl" SET "physicalReserveMicroUsd"=100000000,revision=revision+1 WHERE id='active'`;
        await assert.rejects(() => ledger.claim(input), /WORKSPACE_SOURCE_RESERVATION_INVALID/);
        await policy(f, { budgetEnforcement: 'ACCOUNTING_ONLY', maxTotalMicroUsd: 1, maxCardMicroUsd: 1 });
        const before = await f.usage(), claimed = await ledger.claim(input);
        assert.equal(claimed.claimed, true); assert.equal(claimed.row.reservedMicroUsd, 100_000_000n);
        await ledger.dispatch(input, claimed.row.id);
        await ledger.complete(input, claimed.row.id, { state: 'UNKNOWN', failureCode: 'OWNED_ACCOUNTING_UNKNOWN' });
        const after = await f.usage(); assert.equal(BigInt(after.total) - BigInt(before.total), 100_000_000n);
        assert.equal((await ledger.claim(input)).claimed, false); await assert.rejects(() => ledger.dispatch(input, claimed.row.id));
        const row = await f.admin.staffWorkspaceSourceOperation.findUnique({ where: { id: claimed.row.id } });
        assert.equal(row.state, 'UNKNOWN'); assert.equal(row.actualMicroUsd, null); assert.equal(row.reservedMicroUsd, 100_000_000n);
        assert.equal(await f.admin.staffWorkspaceSourceOperation.count(), 1); assert.deepEqual(await f.usage(), after);
    }, { human: true, rosterSize: 1 }));

    await scenario('identification above former five-dollar ceiling retains an unknown reservation and exact replay', context => workspaceCaptureFixture(context, async f => {
        const original = await f.card(); await updateWorkspaceFixtureCard(f.admin, original, { state: 'DRAFT', pairConfirmedAt: null, captureHash: null });
        const control = await f.admin.staffWorkspaceControl.findUnique({ where: { id: 'active' } });
        const expiresAt = new Date(Math.min(+control.expiresAt, +new Date(f.budget.expiresAt))).toISOString();
        const settings = workspaceIdentificationSettings({ ATLAS_IDENTIFICATION_ENABLED: 'true',
            ATLAS_IDENTIFICATION_OPENAI_API_KEY: 'fixture-dedicated-atlas-only', ATLAS_IDENTIFICATION_GOOGLE_VISION_API_KEY: 'fixture-google-vision-only',
            ATLAS_IDENTIFICATION_POLICY_JSON: JSON.stringify({ version: 'atlas-intake-identification-policy-v1', pilotId: f.budget.pilotId,
                expiresAt, ocrReserveMicroUsd: 10000, modelReserveMicroUsd: 6000000, costEvidenceHash: digest('owned synthetic pricing') }) }, context.config);
        assert.equal(settings.enabled, true);
        await f.admin.$executeRaw`INSERT INTO atlas_staff."StaffWorkspaceIdentificationControl"
            (id,enabled,mode,"releaseSha","configHash","cohortId","pilotId","policyCanonical","policyHash","expiresAt",revision,"updatedAt") VALUES
            ('active',true,'LOCAL_FIXTURE',${control.releaseSha},${settings.configHash},${control.cohortId}::uuid,${f.budget.pilotId}::uuid,
            ${settings.policyCanonical},${settings.policyHash},(${expiresAt}::timestamptz AT TIME ZONE 'UTC'),1,clock_timestamp() AT TIME ZONE 'UTC')`;
        const originals = new Map([syntheticPng(8, 10, 10), syntheticPng(8, 10, 15)].map(bytes => [digest(bytes), bytes]));
        f.intake.storage.read = async ({ upload }) => { assert(originals.has(upload.sha256)); return originals.get(upload.sha256); };
        let calls = 0;
        const service = new StaffWorkspaceIdentification({ intake: f.intake, settings, provider: async () => { calls++; throw Error('Owned uncertain identification response'); } });
        const current = (await f.intake.read(f.signed.staff, original.id)).card;
        const input = { operationId: randomUUID(), expectedRevision: current.revision, photos: workspaceIdentificationPhotos(current) };
        await policy(f, { maxTotalMicroUsd: 10000, maxCardMicroUsd: 10000 });
        assert.equal((await service.identify(f.signed.staff, original.id, input)).identification.status, 'UNAVAILABLE'); assert.equal(calls, 0);
        await policy(f, { budgetEnforcement: 'ACCOUNTING_ONLY', maxTotalMicroUsd: 1, maxCardMicroUsd: 1 });
        await infrastructure(f, 100_000_000n); const before = await usage(f);
        const first = await service.identify(f.signed.staff, original.id, input); assert.equal(first.identification.status, 'UNKNOWN');
        assert.deepEqual(await service.identify(f.signed.staff, original.id, input), first); assert.equal(calls, 1);
        const after = await usage(f); assert.equal(BigInt(after.total) - BigInt(before.total), 6_010_000n);
        assert.equal(after.attempts, before.attempts); assert.equal(first.card.identityReady, false);
        assert.equal(await f.admin.staffWorkspaceOperation.count({ where: { action: 'IDENTIFICATION_REQUEST' } }), 1);
        assert.equal(await f.admin.staffReportApproval.count(), 0);
    }, { identity: {}, rosterSize: 1 }));
}
