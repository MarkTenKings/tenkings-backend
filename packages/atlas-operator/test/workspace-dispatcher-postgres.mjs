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
import { makeOperatorConfig } from '../src/policy.mjs';
import { StaffWorkspaceOperator, workspaceOperatorSqlPort } from '../../../frontend/atlas-app/lib/server/access/workspace-operator.mjs';
import { createWorkspaceRuntime } from '../../../frontend/atlas-app/lib/server/access/workspace-runtime.mjs';
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
async function withDispatcher(context, f, work, { syntheticSource = false } = {}) {
    const role = `atlas_test_dispatch_${randomBytes(6).toString('hex')}`, password = randomBytes(24).toString('hex');
    await context.sql(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await context.sql(workspaceGrantSQL(role, 'COORDINATOR'));
    const url = new URL(context.db.adminUrl); url.username = role; url.password = password;
    const client = new PrismaClient({ datasources: { db: { url: url.href } }, log: [] });
    try {
        const staff = await client.staffControl.findUnique({ where: { id: 'active' } });
        const workspace = await client.staffWorkspaceControl.findUnique({ where: { id: 'active' } });
        const control = await client.staffWorkspaceSourceControl.findUnique({ where: { id: 'active' } });
        const card = await f.card(), identity = await client.staffIdentity.findUnique({ where: { id: card.claim?.actorId ?? card.creatorId } });
        const sourceAuthority = createAtlasWorkspaceSourceAuthority(client, { mode: 'LOCAL_FIXTURE', staffOrigin: staff.origin,
            staffDeploymentId: staff.deploymentId, staffReleaseSha: staff.releaseSha, staffConfigHash: staff.configHash,
            configHash: workspace.configHash, sourceConfigHash: control.sourceConfigHash, sourceDeploymentId: control.sourceDeploymentId,
            sourceReleaseSha: control.sourceReleaseSha, allowedPhoneHashes: [identity.phoneHash] });
        // The full detector fixture owns a LOCAL_FIXTURE source namespace.
        // Keep its real SQL controls, card, actor, run, receipt and successor
        // proofs; only the source namespace adapter is synthetic here.
        const authority = syntheticSource ? { ...sourceAuthority, async current(tx, request) {
            const controls = await sourceAuthority.controls(tx);
            const [row] = await tx.$queryRaw`SELECT * FROM atlas_staff.lock_workspace_private_card(${request.cardId}::uuid)`;
            const card = JSON.parse(row.canonical); assert.equal(digest(canonical(card)), row.contentHash);
            assert.equal(card.source.sourceType, 'LOCAL_FIXTURE');
            const [actor] = await tx.$queryRaw`SELECT * FROM atlas_staff.lock_workspace_private_actor(${request.scope.actorId}::uuid,NULL)`;
            assert.equal(actor.id, card.claim.actorId); assert.equal(actor.role, 'REVIEWER'); assert.equal(actor.revokedAt, null);
            assert.equal(actor.phoneHash, identity.phoneHash); assert.equal(actor.accessVersion, card.claim.accessVersion);
            assert.equal(controls.staff.revision, card.claim.controlRevision);
            assert.deepEqual(request.binding, { captureHash: card.captureHash, captureRevision: card.captureRevision,
                claimFence: card.claimFence, workflowRevision: card.revision });
            return { ...controls, card, identity: actor };
        } } : sourceAuthority;
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
    await scenario('automatic queue pickup is atomic, concurrent, browser-independent and settles the original saved queue operation',
        context => workspaceCaptureFixture(context, async f => {
            await setupSource(f);
            const before = await f.card();
            const queued = await f.admin.staffWorkspaceOperation.findFirst({ where: { cardId: before.id, action: 'queue' } });
            const queueInput = { operationId: queued.operationId, expectedRevision: before.revision - 1, pairConfirmed: true };
            await withDispatcher(context, f, async ({ dispatcher, client }) => {
                const [first, concurrent] = await Promise.all([dispatcher.pickup(), dispatcher.pickup()]);
                assert(first); assert.deepEqual(concurrent, first);
                assert.equal((await dispatcher.admit(first)).state, 'ADMITTED');
                const card = await f.card();
                assert.equal(card.claim.kind, 'ASTRA'); assert.equal(card.claim.mode, 'CONTINUOUS');
                assert.equal(card.claim.actorId, before.creatorId); assert.equal(card.claimFence, before.claimFence + 1);
                assert.equal(card.captureHash, before.captureHash); assert.equal(card.revision, before.revision + 1);
                assert.equal(await client.staffOperatorRun.count(), 1); assert.equal(await client.staffOperatorAttempt.count(), 0);
                const command = await client.staffWorkspaceOperation.findUnique({ where: { id: first.commandId } });
                assert.equal(JSON.parse(command.canonical).result.queueOperationId, queued.id);
                assert.equal(JSON.parse(command.canonical).result.automatic, true);
                const run = await client.staffOperatorRun.findUnique({ where: { id: first.runId } });
                assert.equal(run.policyCanonical, canonical(f.policy)); assert.equal(run.deadlineAt <= new Date(f.policy.expiresAt), true);
                const replay = await f.intake.queue(f.signed.staff, before.id, queueInput);
                assert.equal(replay.operationId, queued.operationId); assert.equal(replay.card.state, 'IN_PROGRESS');
                await context.auth.logout(f.signed.cookie, f.signed.csrf);
                assert.deepEqual(await dispatcher.pickup(), first);
                assert.equal((await dispatcher.admit(first)).state, 'ADMITTED');
                assert.equal(await client.staffOperatorRun.count(), 1); assert.equal(await client.staffOperatorAttempt.count(), 0);
                assert.equal((await f.card(f.ids[1])).state, 'WAITING');
            });
        }, { sourceType: 'SPEEDSTER', preparationEnabled: true, captureRpc: true, rosterSize: 2, effort: 'max' }));

    await scenario('automatic pickup preserves unknown receipts and only consumes a separately saved recovery command',
        context => workspaceCaptureFixture(context, async f => {
            await setupSource(f);
            await withDispatcher(context, f, async ({ dispatcher, client }) => {
                const first = await dispatcher.pickup(); assert(first);
                const { lease } = await f.ledger.claim(first.runId, randomUUID());
                await f.request(lease, 'read_original_photos');
                await f.ledger.stop(lease, { code: 'ASTRA_RUNNER_FAILED' });
                const run = await client.staffOperatorRun.findUnique({ where: { id: first.runId } });
                const attempt = await client.staffOperatorAttempt.findFirst({ where: { runId: first.runId } });
                assert.equal(run.state, 'UNKNOWN'); assert.equal(attempt.state, 'RECEIVED');
                await f.admin.staffWorkspaceControl.update({ where: { id: 'active' }, data: { processingLimit: 10, revision: { increment: 1 } } });
                assert.equal(await dispatcher.pickup(), null); assert.equal(await dispatcher.pickup(), null);
                assert.equal(await client.staffOperatorRun.count(), 1); assert.equal((await f.card(f.ids[1])).state, 'WAITING');
                const recovery = await commandFor(f, (await f.control('RECOVER')).operationId);
                assert.deepEqual(await dispatcher.pickup(), recovery);
                assert.equal((await dispatcher.admit(recovery)).state, 'ADMITTED');
                assert.deepEqual(await client.staffOperatorAttempt.findUnique({ where: { id: attempt.id } }), attempt);
                assert.equal(await client.staffOperatorAttempt.count(), 1);
            });
        }, { sourceType: 'SPEEDSTER', preparationEnabled: true, captureRpc: true, rosterSize: 2, effort: 'max' }));

    await scenario('automatic queue identity, runtime, pause and revoked-reviewer fences cannot allocate another run',
        context => workspaceCaptureFixture(context, async f => {
            await setupSource(f);
            await withDispatcher(context, f, async ({ dispatcher, client }) => {
                const [{ command }] = await client.$queryRaw`SELECT atlas_staff.pickup_workspace_queue(${digest('unadmitted runtime')}) AS command`;
                assert.equal(command, null); assert.equal(await client.staffOperatorRun.count(), 0);
                const before = await f.card();
                const held = { ...before, identityReview: { status: 'UNKNOWN', pairHash: digest('not accepted') },
                    revision: before.revision + 1, updatedAt: new Date().toISOString() };
                await f.admin.staffWorkspaceCard.update({ where: { id: held.id }, data: { revision: held.revision,
                    canonical: canonical(held), contentHash: digest(canonical(held)), updatedAt: new Date(held.updatedAt) } });
                assert.equal(await dispatcher.pickup(), null); assert.equal(await client.staffOperatorRun.count(), 0);
                const restored = { ...held, revision: held.revision + 1, updatedAt: new Date().toISOString() }; delete restored.identityReview;
                await f.admin.staffWorkspaceCard.update({ where: { id: restored.id }, data: { revision: restored.revision,
                    canonical: canonical(restored), contentHash: digest(canonical(restored)), updatedAt: new Date(restored.updatedAt) } });
                const first = await dispatcher.pickup(); assert(first);
                await f.control('PAUSE'); assert.equal(await dispatcher.pickup(), null);
                await f.control('RESUME'); assert(await dispatcher.pickup());
                const saved = await f.card();
                await f.admin.staffIdentity.update({ where: { id: saved.claim.actorId }, data: { accessVersion: { increment: 1 } } });
                await assert.rejects(dispatcher.pickup());
                assert.equal(await client.staffOperatorRun.count(), 1); assert.equal(await client.staffOperatorAttempt.count(), 0);
            });
        }, { sourceType: 'SPEEDSTER', preparationEnabled: true, captureRpc: true, rosterSize: 1, effort: 'max' }));

    await scenario('automatic pickup consumes the exact saved recovery across a runtime release without repeating the completed response',
        context => workspaceCaptureFixture(context, async f => {
            await setupSource(f);
            let original;
            await withDispatcher(context, f, async ({ dispatcher }) => { original = await dispatcher.pickup(); assert(original); });
            const first = await f.ledger.claim(original.runId, randomUUID());
            const read = await f.request(first.lease, 'read_original_photos');
            const applied = await f.apply(first.lease, read);
            const run = await f.admin.staffOperatorRun.findUnique({ where: { id: original.runId } });
            const asset = JSON.parse(run.manifestCanonical).assets[0];
            const saved = await f.request(applied.lease, 'inspect_region', {
                assetId: asset.assetId, sourceSha256: asset.sha256, side: asset.side,
                rect: { x: 0, y: 0, width: asset.width, height: asset.height } });
            await f.ledger.stop(applied.lease, { code: 'ASTRA_TOOL_PREPARATION_FAILED' });
            const before = await f.admin.staffOperatorRun.findUnique({ where: { id: original.runId } });
            const attempt = await f.admin.staffOperatorAttempt.findUnique({ where: { id: saved.attemptId } });
            const receipt = await f.admin.staffOperatorReceipt.findUnique({ where: { id: attempt.resultReceiptId } });
            assert.equal(before.state, 'UNKNOWN'); assert.equal(attempt.state, 'RECEIVED');
            assert.equal(await f.admin.staffOperatorAttempt.count({ where: { state: 'APPLIED' } }), 1);
            const nextConfig = makeOperatorConfig({ ...f.config, databaseUrl: f.db.operatorUrl,
                buildHash: digest('synthetic automatic pickup release') });
            await f.admin.staffOperatorControl.update({ where: { id: 'active' }, data: { ...nextConfig, revision: { increment: 1 } } });
            await f.admin.staffControl.update({ where: { id: 'active' }, data: { revision: { increment: 1 } } });
            await withDispatcher(context, { ...f, config: nextConfig }, async ({ dispatcher }) => {
                assert.equal(await dispatcher.pickup(), null);
                assert.equal((await dispatcher.admit(original)).state, 'HELD');
            });
            await assert.rejects(() => f.control('RECOVER'));
            const signed = await f.login(), card = await f.card();
            const input = { action: 'RECOVER', operationId: randomUUID(), expectedRevision: card.revision };
            await f.service.control(signed.staff, card.id, input);
            await f.service.control(signed.staff, card.id, input);
            const recovery = await commandFor(f, input.operationId, signed.staff.id);
            const recovered = await f.admin.staffOperatorRun.findUnique({ where: { id: before.id } });
            const grant = JSON.parse((await f.admin.staffOperatorRecovery.findFirst({ where: { runId: before.id } })).canonical);
            assert.equal(grant.oldRuntimeHash, before.runtimeHash); assert.equal(grant.newRuntimeHash, nextConfig.configHash);
            assert.equal(recovered.runtimeHash, nextConfig.configHash); assert.equal(recovered.state, 'WAITING_TOOL');
            assert.equal(recovered.policyCanonical, before.policyCanonical); assert.equal(recovered.inputCanonical, before.inputCanonical);
            await withDispatcher(context, { ...f, config: nextConfig }, async ({ dispatcher, client }) => {
                assert.deepEqual(await dispatcher.pickup(), recovery);
                assert.equal((await dispatcher.admit(recovery)).state, 'ADMITTED');
                assert.deepEqual(await client.staffOperatorAttempt.findUnique({ where: { id: attempt.id } }), attempt);
                const ledger = new OperatorLedger({ client: f.client, config: nextConfig,
                    expectedClaim: { runId: recovered.id, controlRevision: recovered.controlRevision } });
                const claim = await ledger.claim(recovered.id, randomUUID());
                assert.equal(claim.mode, 'RECOVER_TOOL'); assert.equal(claim.attemptId, attempt.id);
                const snapshot = await ledger.inspectTool(claim.lease, attempt.id), adapter = f.adaptersFor(nextConfig.configHash)[snapshot.call.name];
                const prepared = await adapter.prepare(snapshot, {});
                await ledger.applyTool(claim.lease, attempt.id, data => adapter.apply(data, prepared));
                assert.equal(await client.staffOperatorAttempt.count(), 2); assert.equal(f.calls(), 2);
                assert.equal(await client.staffOperatorStep.count({ where: { attemptId: attempt.id } }), 1);
                assert.equal((await client.staffOperatorAttempt.findUnique({ where: { id: attempt.id } })).state, 'APPLIED');
                assert.deepEqual(await f.admin.staffOperatorReceipt.findUnique({ where: { id: receipt.id } }), receipt);
                assert.equal(await dispatcher.pickup(), null);
            });
        }, { sourceType: 'SPEEDSTER', preparationEnabled: true, captureRpc: true, rosterSize: 1, effort: 'max' }));

    await scenario('automatic capacity releases an actual terminal report lease only within the admitted distinct-card limit',
        context => workspaceSourceFixture(context, async f => {
            await f.control('PAUSE'); const command = await commandFor(f, (await f.control('RESUME')).operationId);
            const request = await f.intent();
            assert.equal((await f.initialization(request).run()).state, 'SUCCEEDED');
            await f.finishPermit(request); await f.projectResult(request, { clearPending: false });
            const report = await f.successor(request), { lease } = await f.ledger.claim(report.id, randomUUID());
            const read = await f.request(lease, 'read_card_report');
            const step = await f.ledger.applyTool(lease, read.attemptId, async ({ manifest }) => ({ reportHash: manifest.reportHash, synthetic: true }));
            const submit = await f.request(step.lease, 'submit_for_human_review', {
                reportHash: JSON.parse(report.manifestCanonical).reportHash, disposition: 'READY_FOR_REVIEW', summary: 'Synthetic report awaits the human.' });
            const done = await f.ledger.applyTool(step.lease, submit.attemptId, async () => ({ proposals: 0 }));
            assert.equal(done.state, 'READY_FOR_HUMAN');
            const terminal = await f.admin.staffOperatorRun.findUnique({ where: { id: report.id } });
            assert(terminal.leaseOwner); assert(terminal.leaseExpiresAt > new Date());
            await withDispatcher(context, f, async ({ dispatcher, client }) => {
                assert.equal((await dispatcher.admit(command)).state, 'SETTLED');
                assert.equal((await dispatcher.run(command)).state, 'READY_FOR_HUMAN');
                const workspace = await f.admin.staffWorkspaceControl.findUnique({ where: { id: 'active' } });
                const app = createWorkspaceRuntime({ auth: context.auth, review: f.bridge.review, staffConfig: context.config,
                    env: {}, settings: { enabled: false, configHash: workspace.configHash }, ports: {} });
                const humanDraft = await f.admin.staffReviewRevision.findFirst({ where: { specimenId: report.specimenId }, orderBy: { revision: 'desc' } });
                assert.equal(JSON.parse(humanDraft.canonical).identityReviewed, false);
                assert.deepEqual(JSON.parse(humanDraft.canonical).reviewedSides, []);
                const waiting = (await app.read(f.signed.staff, f.ids[0])).card;
                assert.equal(waiting.state, 'HUMAN_REVIEW'); assert.equal(waiting.stage, 'REVIEW');
                assert.equal(waiting.timing.runningSince, null); assert.equal(waiting.timing.pausedReason, 'HUMAN_REVIEW');
                const observed = (await app.read(f.signed.staff, f.ids[0])).card;
                assert.equal(observed.timing.totalActiveMs, waiting.timing.totalActiveMs);
                // The saved card has not been picked up by a human. Its real
                // terminal ledger alone releases machine capacity, while the
                // initial distinct-card cap still prevents a second claim.
                assert.equal((await f.card()).state, 'IN_PROGRESS');
                assert.equal(await dispatcher.pickup(), null);
                assert.equal((await f.card(f.ids[1])).state, 'WAITING');
                await f.admin.staffWorkspaceControl.update({ where: { id: 'active' }, data: { processingLimit: 10, revision: { increment: 1 } } });
                const next = await dispatcher.pickup(); assert(next);
                assert.notEqual(next.runId, report.id); assert.equal((await f.card(f.ids[1])).claim.runId, next.runId);
                const pickedUp = await app.reviewSession(f.signed.staff, f.ids[0], {
                    operationId: randomUUID(), expectedRevision: waiting.revision, action: 'START' });
                assert.equal(pickedUp.card.state, 'HUMAN_REVIEW'); assert.equal(pickedUp.card.timing.activeStage, 'REVIEW');
                assert(pickedUp.card.timing.runningSince);
                const paused = await app.reviewSession(f.signed.staff, f.ids[0], {
                    operationId: randomUUID(), expectedRevision: pickedUp.card.revision, action: 'PAUSE' });
                assert.equal(paused.card.timing.runningSince, null); assert.equal(paused.card.timing.pausedReason, 'PAUSED');
                assert(paused.card.timing.totalActiveMs >= waiting.timing.totalActiveMs);
                assert.deepEqual(await f.admin.staffReviewRevision.findUnique({ where: {
                    specimenId_revision: { specimenId: humanDraft.specimenId, revision: humanDraft.revision } } }), humanDraft);
                assert.deepEqual(await client.staffOperatorRun.findUnique({ where: { id: report.id } }), terminal);
                assert.equal(await f.admin.staffReportApproval.count(), 0); assert.equal(await f.admin.staffPublicReport.count(), 0);
            }, { syntheticSource: true });
        }, { sourceType: 'LOCAL_FIXTURE', rosterSize: 2, effort: 'max' }));

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
