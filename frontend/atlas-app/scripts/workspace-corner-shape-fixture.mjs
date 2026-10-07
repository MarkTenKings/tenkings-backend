// Ordinary intake/automatic claims, real PostgreSQL guards and retained
// synthetic Responses. No shape seeding, live photos or paid provider calls.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { selectedCapturePreparation } from '../../../packages/atlas-operator/src/capture-protocol.mjs';
import { workspaceCaptureFixture } from './workspace-capture-fixture.mjs';
import { workspaceSourceFixture } from './workspace-source-fixture.mjs';

const options = { automaticCapture: true, rosterSize: 1, preparationEnabled: true, effort: 'max' };
export async function workspaceCornerShapeScenarios(scenario) {
    await scenario('ordinary automatic intake with no shape reaches exact machine preparation selection and SQL rejects an invented shape', context => workspaceCaptureFixture(context, async f => {
        assert.equal((await f.card()).workspace, undefined);
        const current = await f.claim(), original = current.run.manifestCanonical;
        assert.equal(JSON.parse(original).cornerShape, null);
        const command = await f.admin.staffWorkspaceOperation.findFirst({ where: { cardId: f.ids[0], action: 'claim' } });
        assert.equal(JSON.parse(command.canonical).result.automatic, true);
        const proposals = await f.prepareProposals(current);
        const request = await f.request(proposals.lease, 'submit_capture_preparation', { disposition: 'READY_FOR_PREPARATION',
            identityProposal: proposals.identityProposal, boundaries: proposals.boundaries, summary: 'Exact synthetic boundaries await original worker validation.' });
        await assert.rejects(() => f.ledger.applyTool(proposals.lease, request.attemptId, async data => ({ result: {
            ...await selectedCapturePreparation(data, async () => {}), cornerShape: 'SQUARE' } })), /selection must equal its exact recorded machine proposals/);
        const ready = await f.apply(proposals.lease, request);
        assert.equal(ready.state, 'PREPARATION_READY'); assert.equal(ready.output.result.cornerShape, 'ROUNDED_3_18_MM');
        assert.equal(ready.output.result.cornerShapeBasis, 'PREPARATION_DEFAULT'); assert.equal(ready.output.result.actor, 'MACHINE');
        assert.equal(ready.output.result.status, 'PENDING_ORIGINAL_PREPARATION');
        assert.equal(ready.output.result.printedFrameSelection, 'REQUIRE_VALIDATED_WORKER_PROPOSAL');
        assert.equal((await f.card()).workspace, undefined); assert.equal((await f.card()).specimenId, null);
        const run = await f.admin.staffOperatorRun.findUnique({ where: { id: current.run.id } });
        assert.equal(run.manifestCanonical, original); assert.equal(run.manifestHash, current.run.manifestHash);
        assert.equal(await f.admin.staffWorkspaceSourceOperation.count(), 0); assert.equal(await f.admin.staffReportApproval.count(), 0);
    }, options));

    await scenario('a retained RECEIVED crop against the original null-shape manifest reapplies once then reaches default preparation without rewriting paid evidence', context => workspaceCaptureFixture(context, async f => {
        const current = await f.claim(), manifest = JSON.parse(current.run.manifestCanonical), asset = manifest.assets[0];
        assert.equal(manifest.cornerShape, null);
        const crop = await f.request(current.lease, 'inspect_region', { assetId: asset.assetId, sourceSha256: asset.sha256, side: asset.side,
            rect: { x: 0, y: 0, width: asset.width, height: asset.height } });
        const before = await f.admin.staffOperatorAttempt.findUnique({ where: { id: crop.attemptId } });
        const receipt = await f.admin.staffOperatorReceipt.findUnique({ where: { id: before.resultReceiptId } });
        assert.equal(before.state, 'RECEIVED'); await f.ledger.stop(current.lease, { code: 'ASTRA_TOOL_PREPARATION_FAILED' });
        await f.control('RECOVER'); const claimed = await f.ledger.claim(current.run.id, randomUUID());
        const reapplied = await f.apply(claimed.lease, crop); assert.equal(f.calls(), 1);
        assert.equal(await f.admin.staffOperatorStep.count({ where: { attemptId: crop.attemptId } }), 1);
        const ready = await f.submit(await f.prepareProposals({ run: current.run, lease: reapplied.lease }));
        assert.equal(ready.state, 'PREPARATION_READY'); assert.equal(ready.output.result.cornerShapeBasis, 'PREPARATION_DEFAULT');
        const after = await f.admin.staffOperatorAttempt.findUnique({ where: { id: crop.attemptId } });
        assert.equal(after.state, 'APPLIED'); assert.equal(after.requestCanonical, before.requestCanonical); assert.equal(after.requestHash, before.requestHash);
        assert.deepEqual(await f.admin.staffOperatorReceipt.findUnique({ where: { id: receipt.id } }), receipt);
        const run = await f.admin.staffOperatorRun.findUnique({ where: { id: current.run.id } });
        assert.equal(run.manifestCanonical, current.run.manifestCanonical); assert.equal(run.manifestHash, current.run.manifestHash);
        assert.equal((await f.card()).workspace, undefined); assert.equal(await f.admin.staffReportApproval.count(), 0);
    }, options));

    await scenario('the existing source admission accepts the exact defaulted machine selection while the original null capture stays immutable', context => workspaceSourceFixture(context, async f => {
        const card = await f.card(), run = await f.admin.staffOperatorRun.findUnique({ where: { id: card.claim.runId } });
        assert.equal(JSON.parse(run.manifestCanonical).cornerShape, null); assert.equal(card.workspace, undefined);
        const selected = await f.admin.staffOperatorStep.findFirst({ where: { runId: run.id, toolName: 'submit_capture_preparation' } });
        assert.equal(JSON.parse(selected.resultCanonical).result.cornerShapeBasis, 'PREPARATION_DEFAULT');
        const request = await f.intent('INITIALIZE_REPORT');
        await f.sourceLedger(request).claim(f.bound(request));
        const admitted = await f.admit(request); assert(admitted);
        assert.equal((await f.admin.staffOperatorRun.findUnique({ where: { id: run.id } })).manifestCanonical, run.manifestCanonical);
        assert.equal(await f.admin.staffReportApproval.count(), 0);
    }, { automaticCapture: true, rosterSize: 1, effort: 'max' }));
}
