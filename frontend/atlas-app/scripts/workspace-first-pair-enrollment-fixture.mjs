import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { canonical, digest } from '@atlas/service-bridge/protocol';
import { StaffWorkspaceIdentification } from '../lib/server/access/workspace-identification.mjs';
import { workspaceCaptureFixture, updateWorkspaceFixtureCard } from './workspace-capture-fixture.mjs';
import { withDispatcher } from '../../../packages/atlas-operator/test/workspace-dispatcher-postgres.mjs';

const enrollmentEvent = 'WORKSPACE_FIRST_PAIR_ADMITTED';
const withoutRoster = policy => { const { workspaceCardIds: _ids, ...rest } = policy; return rest; };
async function fixture(context, work, options = {}) {
    return workspaceCaptureFixture(context, async f => {
        if (options.accountingOnly) {
            const policyCanonical = canonical({ ...f.budget, budgetEnforcement: 'ACCOUNTING_ONLY' });
            await f.admin.staffGradingBridgeControl.update({ where: { id: 'active' }, data: {
                policyCanonical, policyHash: digest(policyCanonical), revision: { increment: 1 } } });
        }
        if (options.pausedHistory) {
            await f.intake.claim(f.signed.staff, f.ids[0], { operationId: randomUUID(), expectedRevision: (await f.card()).revision, operator: 'ASTRA' });
            await f.control('PAUSE');
        }
        const oldCard = await f.admin.staffWorkspaceCard.findUnique({ where: { id: f.ids[0] } });
        const oldOperations = await f.admin.staffWorkspaceOperation.findMany({ where: { cardId: oldCard.id }, orderBy: { id: 'asc' } });
        const oldRuns = await f.admin.staffOperatorRun.findMany({ where: { workspaceCardId: oldCard.id }, orderBy: { id: 'asc' } });
        const cohortId = randomUUID(), c = await f.admin.staffWorkspaceControl.findUnique({ where: { id: 'active' } });
        const expiresAt = new Date(Math.min(+c.expiresAt, +new Date(f.budget.expiresAt)));
        await f.admin.staffWorkspaceControl.update({ where: { id: 'active' }, data: { cohortId, revision: { increment: 1 } } });
        await f.admin.$executeRaw`INSERT INTO atlas_staff."StaffWorkspaceSourceControl"
            (id,enabled,mode,"releaseSha","configHash","sourceConfigHash","sourceDeploymentId","sourceReleaseSha","cohortId","pilotId",
             "physicalReserveMicroUsd","preparationReserveMicroUsd","infrastructureReserveMicroUsd","expiresAt",revision,"updatedAt")
            VALUES ('active',true,'LOCAL_FIXTURE',${c.releaseSha},${c.configHash},${digest('owned first pair source')},'owned-first-pair-source',
                ${c.releaseSha},${cohortId}::uuid,${f.budget.pilotId}::uuid,1000,2000,25000,
                (${expiresAt}::timestamptz AT TIME ZONE 'UTC'),1,clock_timestamp() AT TIME ZONE 'UTC')`;
        const identificationPolicy = canonical({ version: 'atlas-intake-identification-policy-v1', pilotId: f.budget.pilotId,
            expiresAt: expiresAt.toISOString(), ocrReserveMicroUsd: 10000, modelReserveMicroUsd: 1000000,
            costEvidenceHash: digest('owned first pair identification') });
        await f.admin.$executeRaw`INSERT INTO atlas_staff."StaffWorkspaceIdentificationControl"
            (id,enabled,mode,"releaseSha","configHash","cohortId","pilotId","policyCanonical","policyHash","expiresAt",revision,"updatedAt") VALUES
            ('active',true,'LOCAL_FIXTURE',${c.releaseSha},${digest('owned first pair identification runtime')},${cohortId}::uuid,${f.budget.pilotId}::uuid,
            ${identificationPolicy},${digest(identificationPolicy)},(${expiresAt}::timestamptz AT TIME ZONE 'UTC'),1,clock_timestamp() AT TIME ZONE 'UTC')`;
        const beforeBridge = await f.admin.staffGradingBridgeControl.findUnique({ where: { id: 'active' } });
        const audits = () => f.admin.staffAudit.findMany({ where: { event: enrollmentEvent }, orderBy: { id: 'asc' } });
        const bridge = () => f.admin.staffGradingBridgeControl.findUnique({ where: { id: 'active' } });
        const pickup = async () => (await f.admin.$queryRaw`SELECT atlas_staff.pickup_workspace_queue(${f.config.configHash}) AS command`)[0].command;
        const unchangedHistory = async () => {
            assert.deepEqual(await f.admin.staffWorkspaceCard.findUnique({ where: { id: oldCard.id } }), oldCard);
            assert.deepEqual(await f.admin.staffWorkspaceOperation.findMany({ where: { cardId: oldCard.id }, orderBy: { id: 'asc' } }), oldOperations);
            assert.deepEqual(await f.admin.staffOperatorRun.findMany({ where: { workspaceCardId: oldCard.id }, orderBy: { id: 'asc' } }), oldRuns);
        };
        // Use the real upload planning/verifier fixture, stopping immediately
        // before queue only when an adversarial or identity-hold test needs it.
        const createDraft = async index => {
            const queue = f.intake.queue;
            f.intake.queue = async (_staff, id) => ({ card: await f.card(id) });
            try { return await f.createQueued(index); } finally { f.intake.queue = queue; }
        };
        assert.equal(await f.admin.staffWorkspaceCard.count({ where: { cohortId } }), 0);
        assert.equal((await audits()).length, 0); // Installing capability performs no backfill.
        await work({ ...f, cohortId, oldCard, oldRuns, beforeBridge, audits, bridge, pickup, unchangedHistory, createDraft });
    }, { rosterSize: 1, captureRpc: true, preparationEnabled: true, effort: 'max', ...options });
}

// Bypass application validation in this owned fixture to exercise the new SQL
// boundary itself. Every rejected insert rolls back its card/operation changes.
async function rawQueue(f, cardId, corruption) {
    return f.admin.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0))`;
        let card = JSON.parse((await tx.staffWorkspaceCard.findUnique({ where: { id: cardId } })).canonical);
        const sides = {};
        for (const side of ['FRONT', 'BACK']) {
            let plan = await tx.staffWorkspaceOperation.findUnique({ where: { id: card.sides[side].uploadId } });
            let verified = await tx.staffWorkspaceOperation.findUnique({ where: { id: card.sides[side].verificationId } });
            if (corruption === 'source' && side === 'FRONT') {
                const p = JSON.parse(plan.canonical), v = JSON.parse(verified.canonical), originalId = p.id;
                p.id = randomUUID(); p.operationId = randomUUID(); p.result.upload.id = p.id;
                p.result.upload.sourceId = `atlas-${randomUUID()}`;
                p.result.upload.objectRef = p.result.upload.objectRef.replace(originalId, p.id);
                v.id = randomUUID(); v.operationId = randomUUID(); v.result.uploadId = p.id;
                v.result.verification.objectRef = p.result.upload.objectRef;
                plan = await tx.staffWorkspaceOperation.create({ data: { ...plan, id: p.id, operationId: p.operationId,
                    canonical: canonical(p), contentHash: digest(canonical(p)) } });
                verified = await tx.staffWorkspaceOperation.create({ data: { ...verified, id: v.id, operationId: v.operationId,
                    canonical: canonical(v), contentHash: digest(canonical(v)) } });
                card = { ...card, sides: { ...card.sides, [side]: { uploadId: p.id, verificationId: v.id } } };
            }
            sides[side] = { uploadId: plan.id, ...JSON.parse(verified.canonical).result.verification };
        }
        const captureRevision = card.captureRevision + 1;
        const captureHash = corruption === 'capture' ? 'f'.repeat(64)
            : digest(canonical({ source: card.source, captureRevision, sides }));
        const at = new Date(), atText = at.toISOString(), revision = card.revision + 1;
        const next = { ...card, revision, captureRevision, captureHash, state: 'WAITING', stage: 'PHOTOS', attention: null,
            admittedAt: card.admittedAt ?? atText, pairConfirmedAt: atText, updatedAt: atText };
        if (corruption === 'verification') next.sides.FRONT = { ...next.sides.FRONT, verificationId: null };
        await tx.staffWorkspaceCard.update({ where: { id: card.id }, data: { state: next.state, stage: next.stage, revision,
            canonical: canonical(next), contentHash: digest(canonical(next)), updatedAt: at } });
        if (corruption === 'session') await tx.staffSession.updateMany({ where: { identityId: f.signed.staff.id }, data: { revokedAt: at } });
        const operationId = randomUUID(), input = { operationId, expectedRevision: card.revision, pairConfirmed: true };
        const inputHash = corruption === 'input' ? 'f'.repeat(64) : digest(canonical({ action: 'queue', cardId: card.id, input }));
        const event = { id: randomUUID(), actorId: f.signed.staff.id, operationId, action: 'queue', cardId: card.id, inputHash,
            result: { cardId: card.id, revision, captureRevision, captureHash }, createdAt: atText };
        await tx.staffWorkspaceOperation.create({ data: { id: event.id, actorId: event.actorId, operationId, cardId: card.id,
            action: event.action, inputHash, canonical: canonical(event), contentHash: digest(canonical(event)), createdAt: at } });
        await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
    }, { maxWait: 5000, timeout: 10000 });
}

export async function workspaceFirstPairEnrollmentScenarios(scenario) {
    await scenario('first verified pair replaces only the retired roster and ordinary Start preserves exact retry and all other controls', context => fixture(context, async f => {
        const controls = async () => ({ staff: await f.admin.staffControl.findUnique({ where: { id: 'active' } }),
            workspace: await f.admin.staffWorkspaceControl.findUnique({ where: { id: 'active' } }),
            source: await f.admin.$queryRaw`SELECT * FROM atlas_staff."StaffWorkspaceSourceControl"`,
            identification: await f.admin.$queryRaw`SELECT * FROM atlas_staff."StaffWorkspaceIdentificationControl"`,
            operator: await f.admin.staffOperatorControl.findUnique({ where: { id: 'active' } }) });
        const beforeControls = await controls(), id = await f.createQueued(20), card = await f.card(id), admitted = await f.bridge();
        assert.deepEqual(JSON.parse(admitted.policyCanonical), { ...JSON.parse(f.beforeBridge.policyCanonical), workspaceCardIds: [id] });
        assert.equal(admitted.policyHash, digest(admitted.policyCanonical)); assert.equal(admitted.revision, f.beforeBridge.revision + 1);
        for (const field of ['configHash', 'clientKeyHash', 'gradingPolicyHash', 'releaseSha', 'enabled', 'mode']) assert.equal(admitted[field], f.beforeBridge[field]);
        assert.deepEqual(await controls(), beforeControls); assert.equal((await f.intake.read(f.signed.staff, id)).card.capabilities.astraClaim, true);
        const [audit] = await f.audits(), detail = JSON.parse(audit.details);
        const queue = await f.admin.staffWorkspaceOperation.findUnique({ where: { id: detail.queueOperationId } });
        assert.equal(audit.actorId, f.signed.staff.id); assert.equal(audit.subjectId, id); assert.equal(detail.queueOperationHash, queue.contentHash);
        assert.equal(detail.captureHash, card.captureHash); assert.equal(detail.cohortId, f.cohortId); assert.equal(detail.policyHash, admitted.policyHash);
        assert.equal(detail.preservedPolicyHash, digest(canonical(withoutRoster(JSON.parse(f.beforeBridge.policyCanonical)))));
        assert.deepEqual(detail.priorWorkspaceCardIds, [f.oldCard.id]); assert.deepEqual(detail.workspaceCardIds, [id]);
        const queuedInput = { operationId: queue.operationId, expectedRevision: card.revision - 1, pairConfirmed: true };
        await f.intake.queue(f.signed.staff, id, queuedInput); assert.deepEqual(await f.bridge(), admitted); assert.equal((await f.audits()).length, 1);
        const input = { operationId: randomUUID(), expectedRevision: card.revision, operator: 'ASTRA' };
        const started = await f.intake.claim(f.signed.staff, id, input), replay = await f.intake.claim(f.signed.staff, id, input);
        assert.equal(started.card.operator.kind, 'ASTRA'); assert.equal(replay.card.revision, started.card.revision);
        assert.equal(await f.admin.staffOperatorRun.count({ where: { workspaceCardId: id } }), 1);
        const duplicate = await f.createQueued(20); assert.equal((await f.card(duplicate)).state, 'DRAFT');
        const waiting = await f.createQueued(21); assert.equal((await f.card(waiting)).state, 'WAITING');
        assert.deepEqual(await f.bridge(), admitted); assert.equal((await f.audits()).length, 1);
        for (let index = 22; index < 29; index++) await f.createDraft(index);
        assert.equal(await f.admin.staffWorkspaceCard.count({ where: { cohortId: f.cohortId } }), 10);
        await assert.rejects(() => f.createQueued(29), error => error.code === 'WORKSPACE_PILOT_FULL');
        await assert.rejects(async () => f.intake.claim(f.signed.staff, waiting, { ...input, operationId: randomUUID(), expectedRevision: (await f.card(waiting)).revision }));
        await assert.rejects(() => context.client.$executeRaw`UPDATE atlas_staff."StaffGradingBridgeControl" SET enabled=false`, /permission denied/);
        await assert.rejects(() => context.client.$queryRaw`SELECT atlas_staff.enroll_workspace_first_pair()`, /permission denied/);
        await assert.rejects(() => f.admin.staffAudit.update({ where: { id: audit.id }, data: { details: '{}' } }), /immutable/);
        assert.equal(await f.admin.staffOperatorAttempt.count(), 0); assert.equal(await f.admin.staffReportApproval.count(), 0);
        await f.unchangedHistory();
    }, { accountingOnly: true }));

    await scenario('concurrent verified pairs enroll once and automatic pickup leases the fresh card while retired paused history is preserved', context => fixture(context, async f => {
        const ids = await Promise.all([f.createQueued(20), f.createQueued(21)]), admitted = await f.bridge();
        const [id] = JSON.parse(admitted.policyCanonical).workspaceCardIds;
        assert(ids.includes(id)); assert.equal(admitted.revision, f.beforeBridge.revision + 1); assert.equal((await f.audits()).length, 1);
        await withDispatcher(context, { ...f, card: () => f.card(id) }, async ({ dispatcher }) => {
            const command = await dispatcher.pickup(); assert(command);
            assert.equal((await dispatcher.admit(command)).state, 'ADMITTED');
            const run = await f.admin.staffOperatorRun.findUnique({ where: { id: command.runId } }); assert.equal(run.workspaceCardId, id);
            const claimed = await f.ledger.claim(run.id, randomUUID()); assert.equal(claimed.mode, 'WORK');
        });
        assert.equal((await f.card(ids.find(candidate => candidate !== id))).state, 'WAITING');
        assert.deepEqual(await f.bridge(), admitted); await f.unchangedHistory();
        assert.equal(f.oldRuns[0].controlState, 'PAUSED'); assert.equal(await f.admin.staffOperatorAttempt.count(), 0);
    }, { pausedHistory: true }));

    await scenario('a queued unknown identity is enrolled and normal category correction unlocks automatic pickup without another identification request', context => fixture(context, async f => {
        const id = await f.createDraft(20);
        await updateWorkspaceFixtureCard(f.admin, await f.card(id), { identityReview: { status: 'UNKNOWN' } });
        await f.intake.queue(f.signed.staff, id, { operationId: randomUUID(), expectedRevision: (await f.card(id)).revision, pairConfirmed: true });
        const admitted = await f.bridge(); assert.deepEqual(JSON.parse(admitted.policyCanonical).workspaceCardIds, [id]);
        assert.equal((await f.intake.read(f.signed.staff, id)).card.capabilities.astraClaim, false); assert.equal(await f.pickup(), null);
        const service = new StaffWorkspaceIdentification({ intake: f.intake });
        const corrected = await service.saveIdentity(f.signed.staff, id, { operationId: randomUUID(), expectedRevision: (await f.card(id)).revision,
            identity: { category: 'SPORTS', playerName: 'Human supplied test identity' }, editedFields: ['category', 'playerName'] });
        assert.equal(corrected.card.capabilities.astraClaim, true); assert(await f.pickup());
        assert.deepEqual(await f.bridge(), admitted); assert.equal((await f.audits()).length, 1);
        assert.equal(await f.admin.staffWorkspaceOperation.count({ where: { action: 'IDENTIFICATION_REQUEST' } }), 0);
        assert.equal(await f.admin.staffOperatorAttempt.count(), 0); await f.unchangedHistory();
    }, { identity: {} }));

    await scenario('forged queue input capture hash missing verification source provenance or expired authority roll back enrollment and card atomically', context => fixture(context, async f => {
        const id = await f.createDraft(20), before = await f.card(id);
        const operations = await f.admin.staffWorkspaceOperation.findMany({ where: { cardId: id }, orderBy: { id: 'asc' } });
        for (const corruption of ['input', 'capture', 'verification', 'source', 'session']) {
            await assert.rejects(() => rawQueue(f, id, corruption), /first pair enrollment/);
            assert.deepEqual(await f.card(id), before); assert.deepEqual(await f.bridge(), f.beforeBridge); assert.equal((await f.audits()).length, 0);
            assert.deepEqual(await f.admin.staffWorkspaceOperation.findMany({ where: { cardId: id }, orderBy: { id: 'asc' } }), operations);
        }
        const valid = await f.intake.queue(f.signed.staff, id, { operationId: randomUUID(), expectedRevision: before.revision, pairConfirmed: true });
        assert.equal(valid.card.capabilities.astraClaim, true); assert.equal((await f.audits()).length, 1); await f.unchangedHistory();
    }));

    await scenario('mismatched controls unknown prior IDs consumed allowance and ten-card expansion cannot silently authorize first-pair enrollment', context => fixture(context, async f => {
        const originalSource = (await f.admin.$queryRaw`SELECT * FROM atlas_staff."StaffWorkspaceSourceControl"`)[0];
        const originalIdentification = (await f.admin.$queryRaw`SELECT * FROM atlas_staff."StaffWorkspaceIdentificationControl"`)[0];
        await f.admin.$executeRaw`UPDATE atlas_staff."StaffWorkspaceSourceControl" SET "cohortId"=${randomUUID()}::uuid,revision=revision+1 WHERE id='active'`;
        await f.createQueued(20); assert.deepEqual(await f.bridge(), f.beforeBridge);
        await f.admin.$executeRaw`UPDATE atlas_staff."StaffWorkspaceSourceControl" SET "cohortId"=${originalSource.cohortId}::uuid,revision=revision+1 WHERE id='active'`;
        await f.admin.$executeRaw`UPDATE atlas_staff."StaffWorkspaceIdentificationControl" SET "cohortId"=${randomUUID()}::uuid,revision=revision+1 WHERE id='active'`;
        await f.createQueued(21); assert.deepEqual(await f.bridge(), f.beforeBridge);
        await f.admin.$executeRaw`UPDATE atlas_staff."StaffWorkspaceIdentificationControl" SET "cohortId"=${originalIdentification.cohortId}::uuid,revision=revision+1 WHERE id='active'`;
        await f.admin.staffWorkspaceControl.update({ where: { id: 'active' }, data: { processingLimit: 10, revision: { increment: 1 } } });
        await f.createQueued(22); assert.deepEqual(await f.bridge(), f.beforeBridge);
        await f.admin.staffWorkspaceControl.update({ where: { id: 'active' }, data: { processingLimit: 1, revision: { increment: 1 } } });
        const unproven = canonical({ ...JSON.parse(f.beforeBridge.policyCanonical), workspaceCardIds: [randomUUID()] });
        await f.admin.staffGradingBridgeControl.update({ where: { id: 'active' }, data: { policyCanonical: unproven, policyHash: digest(unproven), revision: { increment: 1 } } });
        const unprovenBridge = await f.bridge(); await f.createQueued(23); assert.deepEqual(await f.bridge(), unprovenBridge);
        await f.admin.staffGradingBridgeControl.update({ where: { id: 'active' }, data: { policyCanonical: f.beforeBridge.policyCanonical,
            policyHash: f.beforeBridge.policyHash, revision: { increment: 1 } } });
        const waiting = await f.admin.staffWorkspaceCard.findFirst({ where: { cohortId: f.cohortId, state: 'WAITING' } });
        await f.intake.claim(f.signed.staff, waiting.id, { operationId: randomUUID(), expectedRevision: waiting.revision, operator: 'HUMAN' });
        const consumedBridge = await f.bridge(); await f.createQueued(24); assert.deepEqual(await f.bridge(), consumedBridge);
        assert.equal((await f.audits()).length, 0); assert.equal(await f.admin.staffOperatorRun.count(), 0); await f.unchangedHistory();
    }));
}
