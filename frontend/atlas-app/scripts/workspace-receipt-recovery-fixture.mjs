// Owned disposable PostgreSQL, synthetic photographs and synthetic Responses
// only. No live provider, original storage or production control is accessed.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { canonical, digest } from '@atlas/service-bridge/protocol';
import { OperatorLedger } from '../../../packages/atlas-operator/src/ledger.mjs';
import { makeOperatorConfig } from '../../../packages/atlas-operator/src/policy.mjs';
import { runOperator } from '../../../packages/atlas-operator/src/runner.mjs';
import { responsesTransport } from '../../../packages/atlas-operator/src/provider.mjs';
import { MODEL } from '../../../packages/atlas-operator/src/responses.mjs';
import { workspaceCaptureFixture } from './workspace-capture-fixture.mjs';

const options = { rosterSize: 1, preparationEnabled: true, effort: 'max' };
const runRow = (f, id) => f.admin.staffOperatorRun.findUnique({ where: { id } });
const control = async f => (await f.admin.$queryRaw`SELECT atlas_staff.read_workspace_operator_control(${f.ids[0]}::uuid) AS value`)[0].value;
async function savedCrop(f, { unknown = false, deferReceipt = false, inside = false, full = false } = {}) {
    const { run, lease } = await f.claim(), asset = JSON.parse(run.manifestCanonical).assets[0];
    const rect = full ? { x: 0, y: 0, width: asset.width, height: asset.height }
        : { x: inside ? 0 : asset.width - 1, y: 0, width: 2, height: 2 };
    const request = await f.request(lease, 'inspect_region', { assetId: asset.assetId, sourceSha256: asset.sha256,
        side: asset.side, rect }, { unknown, deferReceipt });
    return { run, lease, asset, rect, request };
}
async function stopSaved(f, current) {
    await f.ledger.stop(current.lease, { code: 'ASTRA_TOOL_PREPARATION_FAILED' });
    assert.equal((await runRow(f, current.run.id)).state, 'UNKNOWN');
}

export async function workspaceReceiptRecoveryScenarios(scenario) {
    await scenario('saved completed crop recovers across runtime and staff revisions after expiry without replaying its POST',
        context => workspaceCaptureFixture(context, async f => {
            const current = await savedCrop(f, { full: true }); await stopSaved(f, current);
            await assert.rejects(() => f.admin.staffOperatorRun.update({ where: { id: current.run.id },
                data: { deadlineAt: new Date(Date.now() + 300000), runtimeHash: 'f'.repeat(64) } }), /immutable/);
            // Backdate only this synthetic run to seed an expired historical
            // episode. The actual guard is restored in this same transaction
            // before any recovery assertion; no receipt/attempt is changed.
            await f.admin.$transaction(async tx => {
                await tx.$executeRaw`ALTER TABLE atlas_staff."StaffOperatorRun" DISABLE TRIGGER "StaffOperatorRun_guard"`;
                await tx.$executeRaw`UPDATE atlas_staff."StaffOperatorRun" SET
                    "createdAt"="createdAt"-interval '11 minutes',"deadlineAt"="deadlineAt"-interval '11 minutes',
                    "updatedAt"="updatedAt"-interval '1 minute' WHERE id=${current.run.id}::uuid`;
                await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
                await tx.$executeRaw`ALTER TABLE atlas_staff."StaffOperatorRun" ENABLE TRIGGER "StaffOperatorRun_guard"`;
            });
            const before = await runRow(f, current.run.id), beforeCard = await f.card();
            assert(+before.deadlineAt < Date.now());
            const oldAttempt = await f.admin.staffOperatorAttempt.findUnique({ where: { id: current.request.attemptId } });
            const oldReceipt = await f.admin.staffOperatorReceipt.findUnique({ where: { id: oldAttempt.resultReceiptId } });
            const policy = await f.admin.staffOperatorControl.findUnique({ where: { id: 'active' } });
            const budget = await f.admin.staffGradingBridgeControl.findUnique({ where: { id: 'active' } });
            const nextConfig = makeOperatorConfig({ ...f.config, databaseUrl: f.db.operatorUrl,
                buildHash: digest('synthetic crop-recovery release') });
            await f.admin.staffOperatorControl.update({ where: { id: 'active' }, data: { ...nextConfig, revision: { increment: 1 } } });
            await f.admin.staffControl.update({ where: { id: 'active' }, data: { revision: { increment: 1 } } });
            const signed = await f.login(), nextStaff = await f.admin.staffControl.findUnique({ where: { id: 'active' } });
            assert.notEqual(beforeCard.claim.controlRevision, nextStaff.revision);
            assert.equal((await control(f)).canRecover, true);
            await assert.rejects(() => f.control('RECOVER')); // The old session never gains new authority.
            const sessionHash = f.auth.actors.get(signed.staff).sessionHash;
            await assert.rejects(() => f.client.$queryRaw`SELECT atlas_staff.recover_workspace_operator(${f.ids[0]}::uuid,
                ${beforeCard.claimFence}::integer,${signed.staff.id}::uuid,${sessionHash},${beforeCard.revision}::integer,${randomUUID()}::uuid)`, /permission denied/);
            await assert.rejects(() => context.client.$transaction(async tx => {
                await tx.$queryRaw`SELECT atlas_staff.recover_workspace_operator(${f.ids[0]}::uuid,${beforeCard.claimFence}::integer,
                    ${signed.staff.id}::uuid,${sessionHash},${beforeCard.revision}::integer,${randomUUID()}::uuid)`;
                await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
            }), /RECOVERY_COMMAND|immutable human command|foreign key/i);
            assert.equal(await f.admin.staffOperatorRecovery.count(), 0); assert.deepEqual(await runRow(f, before.id), before);
            const input = { action: 'RECOVER', operationId: randomUUID(), expectedRevision: beforeCard.revision };
            await f.service.control(signed.staff, f.ids[0], input);
            await f.service.control(signed.staff, f.ids[0], input); // Idempotent owner command.
            const recovered = await runRow(f, before.id), afterCard = await f.card();
            const [grantRow] = await f.admin.staffOperatorRecovery.findMany({ where: { runId: before.id } });
            const grant = JSON.parse(grantRow.canonical);
            assert.equal(grantRow.ordinal, 1); assert.equal(grantRow.attemptId, oldAttempt.id); assert.equal(grantRow.receiptId, oldReceipt.id);
            assert.equal(grant.oldRuntimeHash, before.runtimeHash); assert.equal(grant.newRuntimeHash, nextConfig.configHash);
            assert.equal(+new Date(grant.oldDeadlineAt), +before.deadlineAt); assert.equal(+new Date(grant.oldUpdatedAt), +before.updatedAt);
            assert(+recovered.deadlineAt > Date.now()); assert(+recovered.deadlineAt <= +new Date(JSON.parse(policy.policyCanonical).expiresAt));
            assert(+recovered.deadlineAt - +grantRow.createdAt <= Math.min(3600000, f.policy.maxRunMs));
            assert.equal(recovered.inputHash, before.inputHash); assert.equal(recovered.policyHash, before.policyHash);
            assert.deepEqual(afterCard.claim, { ...beforeCard.claim, controlRevision: nextStaff.revision, mode: 'CONTINUOUS' });
            assert.equal((await control(f)).canRecover, false);
            assert.equal(+new Date((await control(f)).extraTimingEvents[0].at), +before.updatedAt);
            const ledger = new OperatorLedger({ client: f.client, config: nextConfig,
                expectedClaim: { runId: before.id, controlRevision: recovered.controlRevision } });
            let posts = 0;
            const result = await runOperator({ ledger, runId: before.id, adapters: f.adaptersFor(nextConfig.configHash),
                createProvider: ({ takeDispatch, signal }) => responsesTransport({ binding: f.binding, takeDispatch, signal,
                    fetchImpl: async () => {
                        // The first possible new POST happens after the exact
                        // saved response has committed once under its new fence.
                        const saved = await f.admin.staffOperatorAttempt.findUnique({ where: { id: oldAttempt.id } });
                        assert.equal(saved.state, 'APPLIED'); assert.equal(await f.admin.staffOperatorStep.count({ where: { attemptId: oldAttempt.id } }), 1);
                        posts++; const run = await runRow(f, before.id);
                        return Response.json({ id: 'resp_synthetic_after_recovery', model: MODEL, service_tier: 'default', status: 'completed',
                            output: [{ type: 'function_call', call_id: 'call_after_recovery', name: 'submit_capture_preparation',
                                arguments: canonical({ runId: run.id, evidenceHash: run.evidenceHash, manifestHash: run.manifestHash,
                                    expectedRevision: run.revision, disposition: 'NEEDS_EXPERT', identityProposal: null, boundaries: [],
                                    summary: 'Synthetic fixture completed its recovery; no physical card was graded.' }) }],
                            usage: { input_tokens: 500, output_tokens: 100, total_tokens: 600 } });
                    } }) });
            assert.equal(result.state, 'NEEDS_EXPERT', result.code); assert.equal(result.stepsApplied, 2); assert.equal(posts, 1);
            assert.equal(f.calls(), 1); assert.equal(f.reads(), 1); assert.equal(result.receiptWrites.length, 1);
            assert.equal(await f.admin.staffOperatorImage.count({ where: { runId: before.id } }), 1);
            const applied = await f.admin.staffOperatorAttempt.findUnique({ where: { id: oldAttempt.id } });
            const { state: _oldState, finishedAt: _oldFinished, ...retainedBefore } = oldAttempt;
            const { state: _newState, finishedAt: _newFinished, ...retainedAfter } = applied;
            assert.deepEqual(retainedAfter, retainedBefore); assert.deepEqual(await f.admin.staffOperatorReceipt.findUnique({ where: { id: oldReceipt.id } }), oldReceipt);
            assert.equal((await f.admin.staffGradingBridgeControl.findUnique({ where: { id: 'active' } })).policyCanonical, budget.policyCanonical);
            assert.equal((await f.admin.staffOperatorControl.findUnique({ where: { id: 'active' } })).policyCanonical, policy.policyCanonical);
            await assert.rejects(() => ledger.applyTool(current.lease, oldAttempt.id, () => assert.fail('Old fence applied')));
            await assert.rejects(() => f.admin.staffOperatorRecovery.update({ where: { id: grantRow.id }, data: { hash: '0'.repeat(64) } }));
            await assert.rejects(() => f.client.staffOperatorRecovery.create({ data: { ...grantRow, id: randomUUID() } }));
        }, options));

    for (const kind of ['DISPATCHED', 'UNKNOWN', 'CONFLICTING']) await scenario(`saved receipt recovery denies ${kind} provider outcomes`,
        context => workspaceCaptureFixture(context, async f => {
            const current = await savedCrop(f, { unknown: kind === 'UNKNOWN', deferReceipt: kind === 'DISPATCHED' });
            await stopSaved(f, current);
            if (kind === 'CONFLICTING') {
                const receipt = structuredClone(current.request.receipt); receipt.body.id = 'resp_synthetic_conflicting';
                receipt.bodyHash = digest(canonical(receipt.body)); await f.ledger.recordReceipt({ ...current.request, receipt });
            }
            assert.equal((await control(f)).canRecover, false);
            await assert.rejects(() => f.control('RECOVER'), /RECOVERY_NOT_AVAILABLE/);
            assert.equal(await f.admin.staffOperatorRecovery.count(), 0); assert.equal(await f.admin.staffOperatorStep.count(), 0);
            assert.equal(f.calls(), 1); assert.equal(f.reads(), 0);
        }, options));

    await scenario('recovery permits at most three explicit episodes and never rewrites the old dispatch fence',
        context => workspaceCaptureFixture(context, async f => {
            const current = await savedCrop(f); await stopSaved(f, current);
            for (let ordinal = 1; ordinal <= 3; ordinal++) {
                assert.equal((await control(f)).canRecover, true); await f.control('RECOVER');
                const claim = await f.ledger.claim(current.run.id, randomUUID());
                assert.equal(claim.mode, 'RECOVER_TOOL'); assert.equal(claim.attemptId, current.request.attemptId);
                assert.equal(claim.lease.fence, current.lease.fence + ordinal);
                await assert.rejects(() => f.ledger.reserve(claim.lease), /ASTRA_STEP_LIMIT/);
                await f.ledger.stop(claim.lease, { code: 'ASTRA_TOOL_PREPARATION_FAILED' });
            }
            assert.equal((await control(f)).canRecover, false);
            await assert.rejects(() => f.control('RECOVER'), /RECOVERY_NOT_AVAILABLE/);
            assert.equal(await f.admin.staffOperatorRecovery.count(), 3); assert.equal(f.calls(), 1);
            const held = await f.admin.staffOperatorAttempt.findUnique({ where: { id: current.request.attemptId } });
            assert.equal(held.state, 'RECEIVED'); assert.equal(held.leaseFence, current.lease.fence);
            assert.equal(await f.admin.staffOperatorReceipt.count(), 1);
        }, options));

    await scenario('SQL accepts only an exact outside-source crop rejection and keeps valid image delivery mandatory',
        context => workspaceCaptureFixture(context, async f => {
            const current = await savedCrop(f, { full: true });
            await assert.rejects(() => f.ledger.applyTool(current.lease, current.request.attemptId, () => ({ images: [], result: {
                status: 'REGION_NOT_AVAILABLE', code: 'ASTRA_CROP_OUTSIDE_SOURCE', assetId: current.asset.assetId,
                rect: current.rect, sourceWidth: current.asset.width, sourceHeight: current.asset.height,
            } })), /actual recorded crop/);
            assert.equal(await f.admin.staffOperatorStep.count(), 0);
            assert.equal((await f.admin.staffOperatorAttempt.findUnique({ where: { id: current.request.attemptId } })).state, 'RECEIVED');
            const inside = await f.apply(current.lease, current.request), rect = { x: current.asset.width - 1, y: 0, width: 2, height: 2 };
            const outside = await f.request(inside.lease, 'inspect_region', { assetId: current.asset.assetId,
                sourceSha256: current.asset.sha256, side: current.asset.side, rect });
            const expected = { status: 'REGION_NOT_AVAILABLE', code: 'ASTRA_CROP_OUTSIDE_SOURCE', assetId: current.asset.assetId,
                rect, sourceWidth: current.asset.width, sourceHeight: current.asset.height };
            await assert.rejects(() => f.ledger.applyTool(inside.lease, outside.attemptId, () => ({ images: [],
                result: { ...expected, sourceWidth: current.asset.width + 1 } })), /actual recorded crop/);
            const applied = await f.apply(inside.lease, outside);
            assert.deepEqual(applied.output.result, expected); assert.equal(f.reads(), 1);
            assert.equal(await f.admin.staffOperatorImage.count(), 1); assert.equal(await f.admin.staffOperatorStep.count(), 2);
        }, options));
}
