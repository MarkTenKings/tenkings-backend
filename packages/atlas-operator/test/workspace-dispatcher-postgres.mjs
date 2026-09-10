// Explicitly invoked by the owned disposable PostgreSQL harness. There are no
// provider, storage or source worker calls; this tests the actual restricted
// coordinator credential and source authority over genuine staff admission.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { PrismaClient } from '../../../frontend/atlas-app/.generated/staff-database/index.js';
import { workspaceCaptureFixture } from '../../../frontend/atlas-app/scripts/workspace-capture-fixture.mjs';
import { workspaceSourceFixture } from '../../../frontend/atlas-app/scripts/workspace-source-fixture.mjs';
import { workspaceGrantSQL } from '@atlas/service-bridge/workspace-privileges';
import { canonical, digest } from '@atlas/service-bridge/protocol';
import { OperatorLedger } from '../src/ledger.mjs';
import { StaffWorkspaceOperator, workspaceOperatorSqlPort } from '../../../frontend/atlas-app/lib/server/access/workspace-operator.mjs';
import { createWorkspaceDispatcher } from '../src/workspace-dispatcher.mjs';

const privateRequire = createRequire(new URL('../../../frontend/nextjs-app/package.json', import.meta.url));
const { tsImport } = await import(pathToFileURL(privateRequire.resolve('tsx/esm/api')).href);
const { createAtlasWorkspaceSourceAuthority } = await tsImport('../../../frontend/nextjs-app/lib/server/atlasWorkspaceSourceAuthority.ts', import.meta.url);

async function setupSource(f) {
    const staff = await f.admin.staffControl.findUnique({ where: { id: 'active' } });
    const workspace = await f.admin.staffWorkspaceControl.findUnique({ where: { id: 'active' } });
    const sourceConfigHash = digest('owned dispatcher source fixture');
    const expiresAt = new Date(Math.min(+workspace.expiresAt, +new Date(f.budget.expiresAt)));
    await f.admin.$executeRaw`INSERT INTO atlas_staff."StaffWorkspaceSourceControl"
        (id,enabled,mode,"releaseSha","configHash","sourceConfigHash","sourceDeploymentId","sourceReleaseSha","cohortId","pilotId",
         "physicalReserveMicroUsd","preparationReserveMicroUsd","infrastructureReserveMicroUsd","expiresAt",revision,"updatedAt")
        VALUES ('active',true,'LOCAL_FIXTURE',${staff.releaseSha},${workspace.configHash},${sourceConfigHash},'owned-dispatcher-fixture',
            ${staff.releaseSha},${workspace.cohortId}::uuid,${f.budget.pilotId}::uuid,1000,2000,25000,
            (${expiresAt}::timestamptz AT TIME ZONE 'UTC'),1,clock_timestamp() AT TIME ZONE 'UTC')`;
    await f.admin.$executeRaw`INSERT INTO atlas_staff."StaffWorkspaceInfrastructureReservation"
        (id,"pilotId","sourceConfigHash","reservedMicroUsd","createdAt","expiresAt") VALUES
        (${randomUUID()}::uuid,${f.budget.pilotId}::uuid,${sourceConfigHash},25000,clock_timestamp() AT TIME ZONE 'UTC',
            (${expiresAt}::timestamptz AT TIME ZONE 'UTC'))`;
}
async function withDispatcher(context, f, work) {
    const role = `atlas_test_dispatch_${randomBytes(6).toString('hex')}`, password = randomBytes(24).toString('hex');
    await context.sql(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await context.sql(workspaceGrantSQL(role, 'COORDINATOR'));
    const url = new URL(context.db.adminUrl); url.username = role; url.password = password;
    const client = new PrismaClient({ datasources: { db: { url: url.href } }, log: [] });
    try {
        const staff = await client.staffControl.findUnique({ where: { id: 'active' } });
        const workspace = await client.staffWorkspaceControl.findUnique({ where: { id: 'active' } });
        const control = await client.staffWorkspaceSourceControl.findUnique({ where: { id: 'active' } });
        const card = await f.card(), identity = await client.staffIdentity.findUnique({ where: { id: card.claim.actorId } });
        const authority = createAtlasWorkspaceSourceAuthority(client, { mode: 'LOCAL_FIXTURE', staffOrigin: staff.origin,
            staffDeploymentId: staff.deploymentId, staffReleaseSha: staff.releaseSha, staffConfigHash: staff.configHash,
            configHash: workspace.configHash, sourceConfigHash: control.sourceConfigHash, sourceDeploymentId: control.sourceDeploymentId,
            sourceReleaseSha: control.sourceReleaseSha, allowedPhoneHashes: [identity.phoneHash] });
        let effects = 0;
        const forbidden = async () => { effects++; throw Error('No external execution is allowed in the admission fixture.'); };
        const dispatcher = createWorkspaceDispatcher({ client, authority, operatorConfig: f.config,
            source: { prepare: forbidden, finalize: forbidden, status: forbidden }, executeOperator: forbidden });
        await work({ client, dispatcher, card, effects: () => effects });
        assert.equal(effects, 0);
    } finally { await client.$disconnect(); }
}

async function commandFor(f, operationId, actorId = f.signed.staff.id) {
    const row = await f.admin.staffWorkspaceOperation.findUnique({ where: { actorId_operationId: { actorId, operationId } } });
    assert(row); const event = JSON.parse(row.canonical);
    return { runId: event.action === 'claim' ? event.result.claim.runId : event.result.runId, commandId: row.id };
}

export async function workspaceDispatcherScenarios(scenario) {
    await scenario('dispatcher proves exact Start and STEP settlement under restricted grants; stale control cannot claim or dispatch',
        context => workspaceCaptureFixture(context, async f => {
            await setupSource(f);
            const claimed = await f.intake.claim(f.signed.staff, f.ids[0], { operationId: randomUUID(), expectedRevision: (await f.card()).revision,
                operator: 'ASTRA', mode: 'CONTINUOUS' });
            const start = await commandFor(f, claimed.operationId);
            await withDispatcher(context, f, async ({ client, dispatcher, card }) => {
                const runId = card.claim.runId, before = await client.staffOperatorRun.findUnique({ where: { id: runId } });
                assert.equal(before.state, 'QUEUED'); assert.equal(before.leaseFence, 0);
                const admitted = await dispatcher.admit(start);
                assert.equal(admitted.state, 'ADMITTED', admitted.code); assert.equal(admitted.phase, 'CAPTURE_REVIEW');
                assert.equal(admitted.workspaceCardId, card.id);
                assert.equal((await client.staffOperatorRun.findUnique({ where: { id: runId } })).leaseFence, 0);
                assert.equal(await client.staffOperatorAttempt.count({ where: { runId } }), 0);
                assert.equal(await client.staffWorkspaceSourceActionPermit.count({ where: { runId } }), 0);
                await f.control('PAUSE'); assert.equal((await dispatcher.admit(start)).state, 'SETTLED');
                const stepReply = await f.control('STEP'), step = await commandFor(f, stepReply.operationId);
                assert.equal((await dispatcher.admit(step)).state, 'ADMITTED');
                const ready = await client.staffOperatorRun.findUnique({ where: { id: runId } }); assert.equal(ready.stepBudget, 1);
                const stale = new OperatorLedger({ client: f.client, config: f.config,
                    expectedClaim: { runId, controlRevision: before.controlRevision } });
                await assert.rejects(() => stale.claim(runId, randomUUID()), /ASTRA_CONTROL_REVISION_STALE/);
                assert.deepEqual(await client.staffOperatorRun.findUnique({ where: { id: runId } }), ready);
                assert.equal(await client.staffOperatorAttempt.count({ where: { runId } }), 0);
                const exact = new OperatorLedger({ client: f.client, config: f.config,
                    expectedClaim: { runId, controlRevision: ready.controlRevision } });
                const lease = (await exact.claim(runId, randomUUID())).lease;
                const applied = await f.apply(lease, await f.request(lease, 'read_original_photos'));
                await f.ledger.releasePause(applied.lease);
                const settled = await dispatcher.admit(step);
                assert.equal(settled.state, 'SETTLED', settled.code); assert.equal(settled.commandId, step.commandId);
                const receiptCount = await client.staffOperatorAttempt.count({ where: { runId } });
                assert.equal((await dispatcher.run(step)).state, 'PAUSED');
                assert.equal(await client.staffOperatorAttempt.count({ where: { runId } }), receiptCount);
                const next = await commandFor(f, (await f.control('STEP')).operationId);
                const nextAdmission = await dispatcher.admit(next);
                assert.equal(nextAdmission.state, 'ADMITTED'); assert.notEqual(nextAdmission.commandHash, settled.commandHash);
                assert.equal((await dispatcher.admit(step)).state, 'SETTLED');
                assert.equal((await dispatcher.run(step)).state, 'YIELDED');
                assert.equal((await client.staffOperatorRun.findUnique({ where: { id: runId } })).stepBudget, 1);
                const unknown = await dispatcher.admit({ ...next, runId: randomUUID() });
                assert.equal(unknown.state, 'HELD'); assert.equal(unknown.workspaceCardId, null);
                await f.admin.staffIdentity.update({ where: { id: card.claim.actorId }, data: { accessVersion: { increment: 1 } } });
                assert.equal((await dispatcher.admit(next)).state, 'HELD'); assert.equal((await dispatcher.run(next)).state, 'HELD');
            });
        }, { sourceType: 'SPEEDSTER', preparationEnabled: true, captureRpc: true }));

    await scenario('dispatcher source STEP recovers exact pending status and lost acknowledgment after immutable result without new permits',
        context => workspaceSourceFixture(context, f => withDispatcher(context, f, async ({ client, dispatcher, card }) => {
            const runId = card.claim.runId;
            await f.control('PAUSE'); const resume = await commandFor(f, (await f.control('RESUME')).operationId);
            assert.equal((await dispatcher.admit(resume)).state, 'ADMITTED'); assert.equal((await dispatcher.admit(resume)).phase, 'SOURCE');
            await f.control('PAUSE'); assert.equal((await dispatcher.admit(resume)).state, 'SETTLED');
            const step = await commandFor(f, (await f.control('STEP')).operationId);
            const request = await f.intent('PREPARE_SIDE', 'FRONT'), ledger = f.sourceLedger(request);
            for (const purpose of ['PHYSICAL_GEOMETRY', 'PREPARATION']) {
                const input = f.bound(request, purpose, 'FRONT'), claimed = await ledger.claim(input);
                await ledger.dispatch(input, claimed.row.id); await ledger.complete(input, claimed.row.id, { state: 'SUCCEEDED', synthetic: purpose });
            }
            await f.finishPermit(request);
            const before = await client.staffWorkspaceSourceActionPermit.findUnique({ where: { requestId: request.requestId } });
            const usage = await f.usage(), count = await client.staffWorkspaceOperation.count({ where: { cardId: card.id } });
            const recovering = await dispatcher.admit(step);
            assert.equal(recovering.state, 'ADMITTED', recovering.code); assert.equal(recovering.phase, 'SOURCE');
            assert.deepEqual(await client.staffWorkspaceSourceActionPermit.findUnique({ where: { requestId: request.requestId } }), before);
            assert.deepEqual(await f.usage(), usage); assert.equal(await client.staffWorkspaceOperation.count({ where: { cardId: card.id } }), count);
            assert.equal((await f.card()).workspace.pending.requestId, request.requestId);
            await f.projectResult(request);
            const settled = await dispatcher.admit(step);
            assert.equal(settled.state, 'SETTLED', settled.code); assert.equal(settled.commandHash, recovering.commandHash);
            assert.equal((await dispatcher.run(step)).state, 'PAUSED'); assert.deepEqual(await f.usage(), usage);
            const next = await commandFor(f, (await f.control('STEP')).operationId);
            assert.equal((await dispatcher.admit(next)).state, 'ADMITTED'); assert.equal((await dispatcher.admit(step)).state, 'SETTLED');
            assert.equal((await dispatcher.run(step)).state, 'YIELDED');
            assert.equal(await client.staffWorkspaceSourceActionPermit.count({ where: { runId } }), 1);
        }), { sourceType: 'SPEEDSTER' }));

    await scenario('workspace control rejects another reviewer and forged command baseline atomically while preserving pause and takeover',
        context => workspaceCaptureFixture(context, async f => {
            const cardId = f.ids[0];
            await f.intake.claim(f.signed.staff, cardId, { operationId: randomUUID(), expectedRevision: (await f.card()).revision,
                operator: 'ASTRA', mode: 'CONTINUOUS' });
            const original = await f.card(), runId = original.claim.runId;
            const observer = context.identities.find(identity => identity.role === 'OBSERVER');
            await f.admin.staffIdentity.update({ where: { id: observer.id }, data: { role: 'REVIEWER', accessVersion: { increment: 1 } } });
            const other = await context.login(context.auth, '+12025550142');
            const send = action => f.service.control(other.staff, cardId, { operationId: randomUUID(), expectedRevision: original.revision, action });
            assert.equal((await f.service.activity(other.staff, cardId)).control.canPause, true);
            await send('PAUSE');
            const paused = await f.card(), beforeRun = await f.admin.staffOperatorRun.findUnique({ where: { id: runId } });
            const beforeOps = await f.admin.staffWorkspaceOperation.count(), beforeAudits = await f.admin.staffAudit.count();
            const visible = (await f.service.activity(other.staff, cardId)).control;
            assert.equal(visible.canResume, false); assert.equal(visible.canStep, false); assert.equal(visible.canTakeOver, true);
            for (const action of ['RESUME', 'STEP']) {
                await assert.rejects(() => f.service.control(other.staff, cardId, { operationId: randomUUID(), expectedRevision: paused.revision, action }), /WORKSPACE_CLAIM_CONFLICT/);
                const session = context.auth.actors.get(other.staff);
                await assert.rejects(() => context.client.$queryRaw`SELECT atlas_staff.control_workspace_operator(${cardId}::uuid,
                    ${paused.claimFence}::integer,${action},${other.staff.id}::uuid,${session.sessionHash},${paused.revision}::integer)`);
            }
            assert.deepEqual(await f.card(), paused); assert.deepEqual(await f.admin.staffOperatorRun.findUnique({ where: { id: runId } }), beforeRun);
            const forged = new StaffWorkspaceOperator({ store: f.store, projectCard: (context, card) => f.intake.project(context, card),
                runPort: { ...workspaceOperatorSqlPort, async control(context, input) {
                    const result = await workspaceOperatorSqlPort.control(context, input); return { ...result, runRevision: result.runRevision + 1 };
                } } });
            await assert.rejects(() => forged.control(f.signed.staff, cardId, { operationId: randomUUID(), expectedRevision: paused.revision, action: 'STEP' }));
            assert.deepEqual(await f.card(), paused); assert.deepEqual(await f.admin.staffOperatorRun.findUnique({ where: { id: runId } }), beforeRun);
            assert.equal(await f.admin.staffWorkspaceOperation.count(), beforeOps); assert.equal(await f.admin.staffAudit.count(), beforeAudits);
            const saved = await f.admin.staffWorkspaceOperation.findFirst({ where: { cardId, action: 'OPERATOR_CONTROL' } });
            const fake = { ...JSON.parse(saved.canonical), id: randomUUID(), operationId: randomUUID() }, text = canonical(fake);
            await assert.rejects(() => context.client.staffWorkspaceOperation.create({ data: { ...saved, id: fake.id, operationId: fake.operationId,
                canonical: text, contentHash: digest(text) } }));
            await f.service.control(other.staff, cardId, { operationId: randomUUID(), expectedRevision: paused.revision, action: 'TAKE_OVER' });
            assert.equal((await f.card()).claim.actorId, other.staff.id); assert.equal((await f.card()).claim.kind, 'HUMAN');
        }, { sourceType: 'SPEEDSTER', preparationEnabled: true, captureRpc: true }));
}
