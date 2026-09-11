import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { hash } from '../lib/server/policy.mjs';
import { canonical } from '../lib/server/review-contract.mjs';
import { StaffWorkspaceIdentification, workspaceIdentificationSettings } from '../lib/server/access/workspace-identification.mjs';
import { IDENTIFICATION_FIELDS, IDENTIFICATION_VERSION, workspaceIdentificationPhotos } from '../lib/workspace-identification.mjs';
import { syntheticPng } from '../../../packages/atlas-contracts/test/fixtures.mjs';
import { workspaceCaptureFixture, updateWorkspaceFixtureCard } from './workspace-capture-fixture.mjs';
import { captureProposalRef } from '../../../packages/atlas-operator/src/capture-protocol.mjs';

const suggestions = () => Object.fromEntries(IDENTIFICATION_FIELDS.map(field => [field,
    ['category', 'name', 'cardNumber'].includes(field) ? { value: ({ category: 'POKEMON', name: 'Charmander', cardNumber: '007/165' })[field], confidence: 'high', evidence: `Front printed ${field}.` }
        : { value: null, confidence: 'unknown', evidence: null }]));
async function identifiedFixture(context, work) {
    return workspaceCaptureFixture(context, async f => {
        const original = await f.card();
        await updateWorkspaceFixtureCard(f.admin, original, { state: 'DRAFT', pairConfirmedAt: null, captureHash: null });
        const control = await f.admin.staffWorkspaceControl.findUnique({ where: { id: 'active' } });
        const expiresAt = new Date(Math.min(+control.expiresAt, +new Date(f.budget.expiresAt))).toISOString();
        const settings = workspaceIdentificationSettings({ ATLAS_IDENTIFICATION_ENABLED: 'true',
            ATLAS_IDENTIFICATION_OPENAI_API_KEY: 'fixture-dedicated-atlas-only', ATLAS_IDENTIFICATION_GOOGLE_VISION_API_KEY: 'fixture-google-vision-only',
            ATLAS_IDENTIFICATION_POLICY_JSON: JSON.stringify({ version: 'atlas-intake-identification-policy-v1', pilotId: f.budget.pilotId,
                expiresAt, ocrReserveMicroUsd: 10000, modelReserveMicroUsd: 1000000, costEvidenceHash: hash('owned synthetic cost evidence') }) }, context.config);
        assert.equal(settings.enabled, true);
        await f.admin.$executeRaw`INSERT INTO atlas_staff."StaffWorkspaceIdentificationControl"
            (id,enabled,mode,"releaseSha","configHash","cohortId","pilotId","policyCanonical","policyHash","expiresAt",revision,"updatedAt") VALUES
            ('active',true,'LOCAL_FIXTURE',${control.releaseSha},${settings.configHash},${control.cohortId}::uuid,${f.budget.pilotId}::uuid,
            ${settings.policyCanonical},${settings.policyHash},(${expiresAt}::timestamptz AT TIME ZONE 'UTC'),1,clock_timestamp() AT TIME ZONE 'UTC')`;
        const originals = new Map([syntheticPng(8, 10, 10), syntheticPng(8, 10, 15)].map(bytes => [hash(bytes), bytes]));
        f.intake.storage.read = async ({ upload }) => { assert(originals.has(upload.sha256)); return originals.get(upload.sha256); };
        let providerCalls = 0, fail = false;
        const service = new StaffWorkspaceIdentification({ intake: f.intake, settings,
            provider: async () => {
                providerCalls++;
                assert.equal(await f.admin.staffWorkspaceOperation.count({ where: { action: 'IDENTIFICATION_REQUEST' } }), 1);
                if (fail) throw new Error('Synthetic uncertain paid response');
                return { suggestions: suggestions(), warnings: [], provenance: { version: IDENTIFICATION_VERSION, authority: 'MACHINE', phase: 'INTAKE_IDENTIFICATION',
                    model: 'gpt-6-astra', reasoningEffort: 'low', maxOutputTokens: 2400, elapsedMs: 1, usageCeilingMicroUsd: 10000 } };
            } });
        const read = async () => (await f.intake.read(f.signed.staff, original.id)).card;
        const input = async () => { const card = await read(); return { operationId: randomUUID(), expectedRevision: card.revision, photos: workspaceIdentificationPhotos(card) }; };
        const usage = async () => {
            const [workspace] = await f.admin.$queryRaw`SELECT * FROM atlas_staff.workspace_pilot_budget_usage(${f.budget.pilotId}::uuid,${original.id}::uuid)`;
            const [ordinary] = await f.admin.$queryRaw`SELECT * FROM atlas_staff.pilot_budget_usage(${f.budget.pilotId}::uuid,NULL::uuid)`;
            return { workspace, ordinary };
        };
        await work({ ...f, operatorService: f.service, service, read, input, usage, settings, calls: () => providerCalls, setFailure: () => { fail = true; } });
    }, { identity: {}, rosterSize: 1 });
}

export async function workspaceIdentificationScenarios(scenario) {
    await scenario('identification reserves original shared pilot before one provider phase; exact replay and queue preserve category and liability', context => identifiedFixture(context, async f => {
        const before = await f.usage(), input = await f.input();
        const first = await f.service.identify(f.signed.staff, f.ids[0], input);
        assert.equal(first.identification.status, 'SUCCEEDED'); assert.equal(first.card.identity.category, 'POKEMON'); assert.equal(first.card.identity.cardNumber, '007/165');
        const replay = await f.service.identify(f.signed.staff, f.ids[0], input); assert.deepEqual(replay, first); assert.equal(f.calls(), 1);
        const after = await f.usage(); assert.equal(BigInt(after.workspace.total) - BigInt(before.workspace.total), 1010000n);
        assert.equal(BigInt(after.ordinary.total) - BigInt(before.ordinary.total), 1010000n); assert.equal(after.workspace.attempts, before.workspace.attempts);
        const queued = await f.intake.queue(f.signed.staff, f.ids[0], { operationId: randomUUID(), expectedRevision: first.card.revision, pairConfirmed: true });
        const [{ ready }] = await f.admin.$queryRaw`SELECT atlas_staff.workspace_identity_ready(${f.ids[0]}::uuid) AS ready`;
        assert.equal(ready, true); assert.equal(queued.card.identityReady, true); assert.deepEqual(await f.usage(), after);
        const request = await f.admin.staffWorkspaceOperation.findFirst({ where: { action: 'IDENTIFICATION_REQUEST' } });
        await assert.rejects(() => f.admin.staffWorkspaceOperation.delete({ where: { id: request.id } }), /immutable/);
        await assert.rejects(() => context.client.$executeRaw`UPDATE atlas_staff."StaffWorkspaceIdentificationControl" SET enabled=false WHERE id='active'`, /permission denied/);
    }));
    await scenario('identification unknown result remains a full liability across recovery and human category correction', context => identifiedFixture(context, async f => {
        const before = await f.usage(), input = await f.input(); f.setFailure();
        const failed = await f.service.identify(f.signed.staff, f.ids[0], input); assert.equal(failed.identification.status, 'UNKNOWN'); assert.equal(failed.card.identityReady, false);
        await f.service.identify(f.signed.staff, f.ids[0], input); assert.equal(f.calls(), 1);
        const after = await f.usage(); assert.equal(BigInt(after.workspace.total) - BigInt(before.workspace.total), 1010000n);
        assert.equal(after.workspace.total, after.ordinary.total);
        const edited = await f.service.saveIdentity(f.signed.staff, f.ids[0], { operationId: randomUUID(), expectedRevision: failed.card.revision,
            identity: { category: 'SPORTS', playerName: 'Human supplied' }, editedFields: ['category', 'playerName'] });
        assert.equal(edited.card.identityReady, true); assert.deepEqual(await f.usage(), after);
    }));
    await scenario('identification admission rejects real SQL budget overspend and expired config before provider dispatch', context => identifiedFixture(context, async f => {
        const budget = { ...f.budget, maxCardMicroUsd: 1000000 }, input = await f.input();
        await f.admin.staffGradingBridgeControl.update({ where: { id: 'active' }, data: { policyCanonical: canonical(budget), policyHash: hash(canonical(budget)), revision: { increment: 1 } } });
        const held = await f.service.identify(f.signed.staff, f.ids[0], input); assert.equal(held.identification.status, 'UNAVAILABLE');
        assert.equal(f.calls(), 0); assert.equal(await f.admin.staffWorkspaceOperation.count({ where: { action: 'IDENTIFICATION_REQUEST' } }), 0);
        await f.admin.$executeRaw`UPDATE atlas_staff."StaffWorkspaceIdentificationControl" SET "expiresAt"=clock_timestamp() AT TIME ZONE 'UTC'-interval '1 second',revision=revision+1 WHERE id='active'`;
        const disabled = await f.service.identify(f.signed.staff, f.ids[0], input); assert.equal(disabled.identification.status, 'UNAVAILABLE'); assert.equal(f.calls(), 0);
        const queued = await f.intake.queue(f.signed.staff, f.ids[0], { operationId: randomUUID(), expectedRevision: disabled.card.revision, pairConfirmed: true });
        assert.equal(queued.card.state, 'WAITING'); assert.equal(queued.card.identityReady, false);
    }));
    const rejectConflict = async (f, field, value) => {
        const current = await f.claim();
        const read = await f.apply(current.lease, await f.request(current.lease, 'read_original_photos'));
        const manifest = JSON.parse(current.run.manifestCanonical), asset = manifest.assets[0];
        const proposed = await f.request(read.lease, 'propose_capture_identity', { fields: [{ field, value,
            evidence: [{ assetId: asset.assetId, sha256: asset.sha256, side: asset.side }] }], summary: 'Synthetic conflicting visible text requires review.' });
        await assert.rejects(() => f.apply(read.lease, proposed), /ASTRA_CAPTURE_IDENTITY_CONFLICT/);
        // An adapter bypass still cannot substitute this field in SQL.
        await assert.rejects(() => f.ledger.applyTool(read.lease, proposed.attemptId, data => ({ actor: 'MACHINE',
            status: 'PROPOSED_FOR_PREPARATION', proposal: captureProposalRef(data.stepId, data.call) })), /ASTRA_CAPTURE_IDENTITY_CONFLICT/);
        const stopped = await f.ledger.stop(read.lease, { code: 'ASTRA_CAPTURE_IDENTITY_CONFLICT' }); assert.equal(stopped.state, 'UNKNOWN');
        const attempt = await f.admin.staffOperatorAttempt.findUnique({ where: { id: proposed.attemptId } });
        assert.equal(attempt.state, 'RECEIVED'); assert(attempt.resultReceiptId);
        assert.equal(await f.admin.staffOperatorStep.count({ where: { runId: current.run.id, toolName: 'propose_capture_identity' } }), 0);
        const view = await f.service.activity(f.signed.staff, f.ids[0]); assert.equal(view.control.state, 'NEEDS_ATTENTION');
        assert.equal(view.control.failureCode, 'ASTRA_CAPTURE_IDENTITY_CONFLICT');
        assert.equal(await f.admin.staffWorkspaceSourceOperation.count(), 0);
    };
    await scenario('accepted identification remains machine provenance and conflicting MAX reply is retained for attention in JS and SQL', context => identifiedFixture(context, async f => {
        const input = await f.input(), identified = await f.service.identify(f.signed.staff, f.ids[0], input);
        await f.intake.queue(f.signed.staff, f.ids[0], { operationId: randomUUID(), expectedRevision: identified.card.revision, pairConfirmed: true });
        const identity = (await f.card()).identity, authority = (await f.card()).identityAuthority;
        assert.equal(authority.cardName.actor, 'MACHINE');
        // The fixture exposes the workspace control service under a separate
        // name because service above is the identification API.
        await rejectConflict({ ...f, service: f.operatorService }, 'cardName', 'Conflicting synthetic card');
        assert.deepEqual((await f.card()).identity, identity); assert.deepEqual((await f.card()).identityAuthority, authority);
    }));
    await scenario('deliberately cleared HUMAN identity cannot be filled by MAX or direct adapter writes', context => workspaceCaptureFixture(context, async f => {
        assert.equal((await f.card()).identity.year, ''); assert.equal((await f.card()).identityAuthority.year.actor, 'HUMAN');
        await rejectConflict(f, 'year', '1999');
        assert.equal((await f.card()).identity.year, ''); assert.equal((await f.card()).identityAuthority.year.actor, 'HUMAN');
    }, { identity: { category: 'SPORTS', playerName: 'Staff confirmed name', year: '' }, rosterSize: 1 }));
}
