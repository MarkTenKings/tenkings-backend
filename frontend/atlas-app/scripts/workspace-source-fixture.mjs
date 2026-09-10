// All sources, geometry receipts and detector results are explicitly synthetic
// in the owned PostgreSQL harness. No worker, provider or real photo acceptance.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { canonical, digest, requireBridge as check } from '../../../packages/atlas-service-bridge/src/protocol.mjs';
import { admitWorkspaceSource } from '../../../packages/atlas-service-bridge/src/workspace-admission.mjs';
import { enqueueWorkspaceMachineInitializationInTransaction } from '../../../packages/atlas-service-bridge/src/workspace-initialize.mjs';
import { createWorkspaceInitializationService } from '../../../packages/atlas-service-bridge/src/workspace-initialization-service.mjs';
import { enqueueWorkspaceReportSuccessorInTransaction } from '../../../packages/atlas-operator/src/ledger.mjs';
import { fixtureAnalysis } from '../lib/server/access/fixture-analysis.mjs';
import { calculateSpeedsterReview } from '@atlas/grading-core/review';
import { measureSpeedsterCenteringBorders } from '@atlas/grading-core/scoring';
import { workspaceCaptureFixture, updateWorkspaceFixtureCard } from './workspace-capture-fixture.mjs';

const privateRequire = createRequire(new URL('../../nextjs-app/package.json', import.meta.url));
const { tsImport } = await import(pathToFileURL(privateRequire.resolve('tsx/esm/api')).href);
const { createAtlasWorkspaceSourceLedger } = await tsImport('../../nextjs-app/lib/server/atlasWorkspaceSourceAuthority.ts', import.meta.url);

async function fixture(context, work, options = {}) {
    return workspaceCaptureFixture(context, async f => {
        const workspaceControl = await f.admin.staffWorkspaceControl.findUnique({ where: { id: 'active' } });
        const staffControl = await f.admin.staffControl.findUnique({ where: { id: 'active' } });
        const sourceConfigHash = digest('owned workspace source fixture'), expiresAt = new Date(Math.min(+workspaceControl.expiresAt, +new Date(f.budget.expiresAt)));
        await f.admin.$executeRaw`INSERT INTO atlas_staff."StaffWorkspaceSourceControl"
            (id,enabled,mode,"releaseSha","configHash","sourceConfigHash","sourceDeploymentId","sourceReleaseSha","cohortId","pilotId",
             "physicalReserveMicroUsd","preparationReserveMicroUsd","infrastructureReserveMicroUsd","expiresAt",revision,"updatedAt")
            VALUES ('active',true,'LOCAL_FIXTURE',${staffControl.releaseSha},${workspaceControl.configHash},${sourceConfigHash},'owned-source-fixture',
                ${staffControl.releaseSha},${workspaceControl.cohortId}::uuid,${f.budget.pilotId}::uuid,1000,2000,25000,
                (${expiresAt}::timestamptz AT TIME ZONE 'UTC'),1,clock_timestamp() AT TIME ZONE 'UTC')`;
        await f.admin.$executeRaw`INSERT INTO atlas_staff."StaffWorkspaceInfrastructureReservation"
            (id,"pilotId","sourceConfigHash","reservedMicroUsd","createdAt","expiresAt") VALUES
            (${randomUUID()}::uuid,${f.budget.pilotId}::uuid,${sourceConfigHash},25000,clock_timestamp() AT TIME ZONE 'UTC',(${expiresAt}::timestamptz AT TIME ZONE 'UTC'))`;
        const transaction = work => f.admin.$transaction(async tx => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0))`;
            const result = await work(tx); await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`; return result;
        }, { maxWait: 5000, timeout: 10000 });
        let current, terminal;
        if (options.human) await f.intake.claim(f.signed.staff, f.ids[0], { operationId: randomUUID(),
            expectedRevision: (await f.card()).revision, operator: 'HUMAN' });
        else { current = await f.claim(); terminal = await f.submit(await f.prepareProposals(current)); }
        const sourceCard = await f.card(), sourceRevision = new Date().toISOString();
        const full = JSON.parse(fixtureAnalysis({ title: 'Synthetic source phase', set: 'Owned PostgreSQL' }, 'a'.repeat(64)).sourceCanonical);
        const originals = {}, sides = {};
        for (const side of ['FRONT', 'BACK']) {
            const verified = JSON.parse((await f.admin.staffWorkspaceOperation.findUnique({ where: { id: sourceCard.sides[side].verificationId } })).canonical).result.verification;
            originals[side] = { contentType: 'image/webp', width: 1270, height: 1778, byteCount: 500,
                sha256: digest(`synthetic prepared original ${side}`), uploadedOriginalSha256: verified.sha256 };
            sides[side] = { contentType: 'image/webp', width: 1270, height: 1778, byteCount: 500, sha256: digest(`synthetic rectified ${side}`) };
        }
        const evidence = { version: 'atlas-owned-workspace-source-fixture-v1', sourceId: sourceCard.source.sourceId,
            sourceOwnerId: sourceCard.source.sourceOwnerId, sourceRevision, originals, sides };
        const initial = { ...full, workflowState: 'CAPTURED', reviewedDefects: [], gradeReport: null };
        await f.admin.$executeRaw`INSERT INTO public."AtlasBridgeTestSource" VALUES
            (${sourceCard.source.sourceId},${sourceCard.source.sourceOwnerId},${canonical(initial)},(${new Date(sourceRevision)}::timestamptz AT TIME ZONE 'UTC'))`;
        let calls = 0;
        const settings = {};
        const ports = { ...f.bridge.ports,
            sourceEvidence: () => evidence,
            sourceAdmission: () => ({ preparationRelease: { synthetic: true, readiness: false },
                frontAuthorityHash: '4'.repeat(64), backAuthorityHash: '5'.repeat(64) }),
            sourceTitle: () => ({ title: 'Synthetic source phase', subtitle: 'Owned fixture; no optical acceptance' }),
            assertSourceAdmission: source => check(source.id === sourceCard.source.sourceId, 'FIXTURE_SOURCE_SUBSTITUTED'),
            assertFreshDetection: async () => { if (settings.cached) throw new Error('FIXTURE_CACHED_DETECTION'); },
            async perform({ source, action, beforeSessionLock, afterPersist }) {
                calls++; assert.equal(action.type, 'INITIALIZE'); await settings.beforePerform?.();
                const capture = Object.fromEntries(['front', 'back'].map(side => [side,
                    { centeringBorders: measureSpeedsterCenteringBorders(source.capture[side].centeringQuad) }]));
                const review = calculateSpeedsterReview(capture, full.reviewedDefects);
                const data = { reviewedDefects: review.defects, gradeReport: { ...review.grade, detectorVersion: full.gradeReport.detectorVersion },
                    detectionPair: { operationId: 'owned-synthetic-fresh-detector', captureBindingSha256: '6'.repeat(64),
                        memorySnapshotSha256: '7'.repeat(64), frontReceiptHmacSha256: '8'.repeat(64), backReceiptHmacSha256: '9'.repeat(64) } };
                const identity = { sessionId: source.id, createdByUserId: source.createdByUserId };
                await transaction(async tx => {
                    await beforeSessionLock(tx, identity, source.updatedAt, data);
                    const updatedAt = new Date(+source.updatedAt + 1);
                    const count = await tx.$executeRaw`UPDATE public."AtlasBridgeTestSource" SET payload=${canonical({ ...ports.reportSource(source), ...data })},
                        "updatedAt"=(${updatedAt}::timestamptz AT TIME ZONE 'UTC') WHERE id=${source.id} AND owner=${source.createdByUserId}
                        AND "updatedAt"=(${source.updatedAt}::timestamptz AT TIME ZONE 'UTC')`;
                    assert.equal(count, 1); await afterPersist(tx, identity, source.updatedAt, data); await settings.afterPersist?.(tx);
                }).catch(error => { settings.performError = error.message; throw error; });
            } };
        const config = { ...f.bridge.service.config, runtimeHash: f.config.configHash,
            staffDeploymentId: staffControl.deploymentId, staffReleaseSha: staffControl.releaseSha };
        async function intent(action = 'INITIALIZE_REPORT', side) {
            return transaction(async tx => {
                const card = JSON.parse((await tx.staffWorkspaceCard.findUnique({ where: { id: f.ids[0] } })).canonical);
                const actor = await tx.staffIdentity.findUnique({ where: { id: card.claim.actorId } });
                const requestId = randomUUID(), operationId = randomUUID(), machine = card.claim.kind === 'ASTRA';
                const bound = { captureHash: card.captureHash, captureRevision: card.captureRevision, claimFence: card.claimFence, workflowRevision: card.revision + 1 };
                const payload = side ? { side } : {};
                if (machine) {
                    const run = await tx.staffOperatorRun.findUnique({ where: { id: card.claim.runId } });
                    const selected = await tx.staffOperatorStep.findFirst({ where: { runId: run.id, toolName: 'submit_capture_preparation' } });
                    payload.machine = { runId: run.id, runRevision: run.revision, leaseFence: run.leaseFence, runControlRevision: run.controlRevision,
                        selectionStepId: selected.id, selectionResultHash: selected.resultHash };
                    if (run.executionMode === 'STEP') {
                        const control = await tx.staffWorkspaceOperation.findFirst({ where: { cardId: card.id, action: 'OPERATOR_CONTROL' }, orderBy: { createdAt: 'desc' } });
                        payload.machine.permitOperationId = control?.id;
                    }
                }
                await updateWorkspaceFixtureCard(tx, card, { workspace: { ...card.workspace,
                    pending: { requestId, operationId, action, ...(side ? { side } : {}), binding: bound } } });
                const event = { id: requestId, actorId: actor.id, operationId, cardId: card.id, action: machine ? 'MACHINE_SOURCE_ACTION' : 'MANUAL_ACTION',
                    inputHash: digest(canonical({ action, payload, binding: bound })), result: { phase: 'REQUESTED', requestId, action, payload,
                        binding: bound, revision: bound.workflowRevision, actorId: actor.id, accessVersion: actor.accessVersion }, createdAt: new Date().toISOString() };
                const text = canonical(event);
                await tx.staffWorkspaceOperation.create({ data: { id: event.id, actorId: event.actorId, operationId, cardId: card.id, action: event.action,
                    inputHash: event.inputHash, canonical: text, contentHash: digest(text), createdAt: new Date(event.createdAt) } });
                const scope = machine ? { actorKind: 'MACHINE', actorId: actor.id, accessVersion: actor.accessVersion,
                    controlRevision: staffControl.revision, runId: card.claim.runId, runtimeHash: config.runtimeHash }
                    : { actorId: actor.id, sessionHash: f.auth.actors.get(f.signed.staff).sessionHash, controlRevision: staffControl.revision };
                return { requestId, cardId: card.id, scope, binding: bound };
            });
        }
        const load = async (request, tx) => {
            if (!tx) return transaction(database => load(request, database));
            const [staff] = await tx.$queryRaw`SELECT * FROM atlas_staff.lock_control()`;
            const [{ now }] = await tx.$queryRaw`SELECT clock_timestamp() AS now`;
            const identity = await tx.staffIdentity.findUnique({ where: { id: request.scope.actorId } });
            check(staff.enabled && identity && identity.revokedAt === null && identity.role === 'REVIEWER', 'FIXTURE_CURRENT_ACTOR_REQUIRED');
            const card = JSON.parse((await tx.staffWorkspaceCard.findUnique({ where: { id: request.cardId } })).canonical);
            const operation = JSON.parse((await tx.staffWorkspaceOperation.findUnique({ where: { id: request.requestId } })).canonical);
            check(operation.actorId === identity.id && operation.result.accessVersion === identity.accessVersion
                && card.claim.actorId === identity.id && card.claimFence === request.binding.claimFence
                && card.captureHash === request.binding.captureHash && card.workspace.pending.requestId === request.requestId,
            'FIXTURE_CURRENT_CLAIM_REQUIRED');
            if (request.scope.actorKind !== 'MACHINE') {
                const handle = f.auth.actors.get(f.signed.staff);
                check(await f.auth.current({ tx, control: staff, now }, handle.sessionHash, handle.browserHash), 'FIXTURE_CURRENT_SESSION_REQUIRED');
            }
            const machine = request.scope.actorKind === 'MACHINE'
                ? { run: await tx.staffOperatorRun.findUnique({ where: { id: card.claim.runId } }) } : undefined;
            return { card, operation, ...(machine ? { machine } : {}) };
        };
        const authority = { load, loadInTransaction: load, recheck: async (request, _prior, tx) => load(request, tx),
            current: async (tx, request) => {
                await load(request, tx);
                const [source] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffWorkspaceSourceControl" WHERE id='active' FOR SHARE`;
                const [workspace] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffWorkspaceControl" WHERE id='active' FOR SHARE`;
                const [{ now }] = await tx.$queryRaw`SELECT clock_timestamp() AS now`;
                return { source, workspace, now };
            } };
        const sourceLedger = request => createAtlasWorkspaceSourceLedger(f.admin, authority, request);
        const bound = (request, purpose = 'INITIALIZE_REPORT', side = 'PAIR') => ({ requestId: request.requestId, cardId: request.cardId,
            purpose, side, binding: request.binding, request: { action: purpose === 'INITIALIZE_REPORT' ? 'INITIALIZE' : purpose,
                actorKind: request.scope.actorKind === 'MACHINE' ? 'MACHINE' : 'HUMAN' } });
        const initialization = (request, ledger = sourceLedger(request)) => createWorkspaceInitializationService({ client: f.admin,
            authority, config, ports, sourceConfigHash, request, ledger });
        const admit = request => admitWorkspaceSource({ client: f.admin, authority, ports, sourceConfigHash }, request);
        const finishPermit = (request, outcome = 'SUCCEEDED') => transaction(tx => tx.$executeRaw`SELECT atlas_staff.finish_workspace_source_permit(${request.requestId}::uuid,${outcome})`);
        const readControl = async (tx = context.client) => (await tx.$queryRaw`SELECT atlas_staff.read_workspace_operator_control(${f.ids[0]}::uuid) AS control`)[0].control;
        // Fixture-only coordinator settlement: retain the exact immutable
        // machine result and project pending in the same real transaction.
        const projectResult = (request, { clearPending = true, changes = {} } = {}) => transaction(async tx => {
            const card = JSON.parse((await tx.staffWorkspaceCard.findUnique({ where: { id: request.cardId } })).canonical);
            const intent = JSON.parse((await tx.staffWorkspaceOperation.findUnique({ where: { id: request.requestId } })).canonical);
            const workspace = { ...card.workspace }; if (clearPending) delete workspace.pending;
            const next = await updateWorkspaceFixtureCard(tx, card, { workspace });
            const { action, payload, binding } = intent.result, machine = payload.machine;
            const event = { id: randomUUID(), actorId: intent.actorId, operationId: `source-result_${request.requestId}`,
                cardId: card.id, action: 'MACHINE_SOURCE_RESULT', inputHash: digest(canonical({ requestId: request.requestId })),
                result: { actor: 'MACHINE', runId: machine.runId, requestId: request.requestId, action,
                    ...(payload.side ? { side: payload.side } : {}), state: 'SUCCEEDED', captureHash: binding.captureHash,
                    claimFence: binding.claimFence, selectionStepId: machine.selectionStepId,
                    selectionResultHash: machine.selectionResultHash, revision: next.revision, ...changes }, createdAt: new Date().toISOString() };
            const text = canonical(event);
            await tx.staffWorkspaceOperation.create({ data: { id: event.id, actorId: event.actorId, operationId: event.operationId,
                cardId: card.id, action: event.action, inputHash: event.inputHash, canonical: text, contentHash: digest(text), createdAt: new Date(event.createdAt) } });
            await tx.$executeRaw`SELECT atlas_staff.finish_workspace_source_permit(${request.requestId}::uuid,${event.result.state})`;
        });
        const successor = request => transaction(tx => enqueueWorkspaceReportSuccessorInTransaction(tx, f.config, { requestId: request.requestId }));
        const usage = async () => (await f.admin.$queryRaw`SELECT * FROM atlas_staff.workspace_pilot_budget_usage(${f.budget.pilotId}::uuid,${f.ids[0]}::uuid)`)[0];
        await work({ ...f, current, terminal, transaction, machineConfig: config, sourceConfigHash, ports, settings, intent, authority, sourceLedger,
            bound, initialization, admit, finishPermit, readControl, projectResult, successor, usage, workerCalls: () => calls });
    }, { sourceType: options.sourceType ?? 'LOCAL_FIXTURE', identity: options.identity, preparationEnabled: true });
}

export async function workspaceSourceScenarios(scenario) {
    await scenario('source STEP permit is consumed once and unknown worker results keep their reservation and block takeover', context => fixture(context, async f => {
        await f.control('PAUSE'); await f.control('STEP');
        const request = await f.intent('PREPARE_SIDE', 'FRONT'), input = f.bound(request, 'PHYSICAL_GEOMETRY', 'FRONT'), ledger = f.sourceLedger(request);
        const claimed = await ledger.claim(input); assert.equal(claimed.claimed, true);
        const run = await f.admin.staffOperatorRun.findUnique({ where: { id: f.current.run.id } }); assert.equal(run.stepBudget, 0);
        assert.equal((await ledger.claim(input)).claimed, false); await ledger.dispatch(input, claimed.row.id);
        await assert.rejects(() => ledger.dispatch(input, claimed.row.id));
        await f.control('PAUSE'); assert.equal((await f.admin.staffOperatorRun.findUnique({ where: { id: run.id } })).controlState, 'PAUSE_REQUESTED');
        await ledger.complete(input, claimed.row.id, { state: 'UNKNOWN', failureCode: 'OWNED_SOURCE_UNKNOWN' }); await f.finishPermit(request, 'UNKNOWN');
        const cost = await f.usage(); assert.equal(cost.card, '101000'); assert.equal(cost.total, '126000');
        await assert.rejects(() => f.control('STEP')); await assert.rejects(() => f.control('TAKE_OVER'));
        const [retained] = await f.admin.$queryRaw`SELECT * FROM atlas_staff."StaffWorkspaceSourceOperation" WHERE id=${claimed.row.id}::uuid`;
        assert.equal(retained.reservedMicroUsd, 1000n); assert.equal(retained.actualMicroUsd, null); assert.equal(retained.state, 'UNKNOWN');
        await assert.rejects(() => f.admin.$executeRaw`UPDATE atlas_staff."StaffWorkspaceSourceOperation" SET state='DISPATCHED' WHERE id=${retained.id}::uuid`);
    }));

    await scenario('successful source geometry and preparation require a new explicit STEP before another source action', context => fixture(context, async f => {
        await f.control('PAUSE'); await f.control('STEP');
        const request = await f.intent('PREPARE_SIDE', 'FRONT'), ledger = f.sourceLedger(request);
        for (const purpose of ['PHYSICAL_GEOMETRY', 'PREPARATION']) {
            const input = f.bound(request, purpose, 'FRONT'), claimed = await ledger.claim(input);
            await ledger.dispatch(input, claimed.row.id); await ledger.complete(input, claimed.row.id, { state: 'SUCCEEDED', synthetic: purpose });
        }
        await f.finishPermit(request); assert.equal((await f.admin.staffOperatorRun.findUnique({ where: { id: f.current.run.id } })).controlState, 'PAUSED');
        const held = await f.readControl(); assert.equal(held.pending, 1); assert.equal(held.settled, false);
        assert.equal(held.canResume, false); assert.equal(held.canStep, false); assert.equal(held.canTakeOver, false);
        for (const action of ['RESUME', 'STEP', 'TAKE_OVER']) await assert.rejects(() => f.control(action));
        await f.projectResult(request); const ready = await f.readControl();
        assert.equal(ready.pending, 0); assert.equal(ready.settled, true); assert.equal(ready.canStep, true);
        await f.control('STEP'); const permitted = await f.intent('PREPARE_SIDE', 'BACK');
        assert.equal((await f.sourceLedger(permitted).claim(f.bound(permitted, 'PHYSICAL_GEOMETRY', 'BACK'))).claimed, true);
        const cost = await f.usage(); assert.equal(cost.card, '104000'); assert.equal(cost.total, '129000');
    }));

    await scenario('settled source reply loss holds the claim and a later pause settles only after exact coordinator projection', context => fixture(context, async f => {
        const request = await f.intent('PREPARE_SIDE', 'FRONT'), ledger = f.sourceLedger(request);
        for (const purpose of ['PHYSICAL_GEOMETRY', 'PREPARATION']) {
            const input = f.bound(request, purpose, 'FRONT'), claimed = await ledger.claim(input);
            await ledger.dispatch(input, claimed.row.id); await ledger.complete(input, claimed.row.id, { state: 'SUCCEEDED', synthetic: purpose });
        }
        await f.finishPermit(request);
        const [permit] = await f.admin.$queryRaw`SELECT * FROM atlas_staff."StaffWorkspaceSourceActionPermit" WHERE "requestId"=${request.requestId}::uuid`;
        const costs = await f.usage(), held = await f.readControl();
        assert.equal(permit.state, 'SUCCEEDED'); assert.equal(held.state, 'RUNNING'); assert.equal(held.pending, 1);
        assert.equal(held.settled, false); assert.equal(held.canPause, true); assert.equal(held.canTakeOver, false);
        for (const action of ['RESUME', 'STEP', 'TAKE_OVER']) await assert.rejects(() => f.control(action));
        await f.control('PAUSE'); assert.equal((await f.readControl()).state, 'PAUSE_REQUESTED');
        await f.finishPermit(request); assert.equal((await f.readControl()).state, 'PAUSE_REQUESTED');
        for (const action of ['RESUME', 'STEP', 'TAKE_OVER']) await assert.rejects(() => f.control(action));
        await assert.rejects(() => f.transaction(async tx => {
            const card = await f.card(), workspace = { ...card.workspace }; delete workspace.pending;
            await updateWorkspaceFixtureCard(tx, card, { workspace });
            await tx.$executeRaw`SELECT atlas_staff.finish_workspace_source_permit(${request.requestId}::uuid,'SUCCEEDED')`;
        }), /ATLAS operator control requires an exact human action or settled step/);
        await assert.rejects(() => f.projectResult(request, { changes: { claimFence: request.binding.claimFence + 1 } }),
            /ATLAS operator control requires an exact human action or settled step/);
        assert.equal((await f.card()).workspace.pending.requestId, request.requestId);
        await f.projectResult(request);
        const projected = await f.readControl(); assert.equal(projected.state, 'PAUSED'); assert.equal(projected.pending, 0);
        assert.equal(projected.settled, true); assert.equal(projected.canResume, true); assert.equal(projected.canStep, true); assert.equal(projected.canTakeOver, true);
        const [retained] = await f.admin.$queryRaw`SELECT * FROM atlas_staff."StaffWorkspaceSourceActionPermit" WHERE "requestId"=${request.requestId}::uuid`;
        assert.deepEqual(retained, permit); assert.deepEqual(await f.usage(), costs);
        await f.finishPermit(request); assert.deepEqual(await f.readControl(), projected);
        await f.control('RESUME'); assert.equal((await f.readControl()).state, 'RUNNING');
        assert.equal(await f.admin.staffWorkspaceSourceOperation.count({ where: { requestId: request.requestId } }), 2);
        assert.equal(f.workerCalls(), 0);
    }));

    await scenario('a source result for changed capture bytes cannot release the retained pending claim', context => fixture(context, async f => {
        const request = await f.intent('PREPARE_SIDE', 'FRONT'), ledger = f.sourceLedger(request);
        for (const purpose of ['PHYSICAL_GEOMETRY', 'PREPARATION']) {
            const input = f.bound(request, purpose, 'FRONT'), claimed = await ledger.claim(input);
            await ledger.dispatch(input, claimed.row.id); await ledger.complete(input, claimed.row.id, { state: 'SUCCEEDED', synthetic: purpose });
        }
        await f.finishPermit(request);
        await f.projectResult(request, { clearPending: false, changes: { captureHash: digest('substituted synthetic capture') } });
        const held = await f.readControl(); assert.equal(held.pending, 1); assert.equal(held.settled, false); assert.equal(held.canTakeOver, false);
        await assert.rejects(() => f.control('TAKE_OVER')); assert.equal((await f.card()).claim.runId, f.current.run.id);
    }));

    await scenario('machine fresh-photo admission initializes through original detector transaction and atomically links one continuous report successor', context => fixture(context, async f => {
        const request = await f.intent(), initial = await f.card(), service = f.initialization(request);
        const result = await service.run();
        assert.deepEqual(result, { state: 'SUCCEEDED', specimenId: f.ids[0] }, f.settings.performError); assert.equal(f.workerCalls(), 1);
        assert.deepEqual(await service.run(), { state: 'SUCCEEDED', specimenId: f.ids[0] }); assert.equal(f.workerCalls(), 1);
        const [admission] = await f.admin.$queryRaw`SELECT * FROM atlas_staff."StaffWorkspaceSourceAdmission" WHERE "requestId"=${request.requestId}::uuid`;
        const job = await f.admin.staffMachineInitialization.findUnique({ where: { id: request.requestId } });
        assert.equal(admission.actorKind, 'MACHINE'); assert.equal(admission.sessionHash, null); assert.equal(job.admittedSessionHash, null);
        assert.equal(job.operationsGrantId, null); assert.equal(job.admissionKind, 'WORKSPACE_CAPTURE');
        await assert.rejects(() => f.successor(request), /ASTRA_CAPTURE_SOURCE_UNRESOLVED/);
        await f.finishPermit(request); await f.projectResult(request, { clearPending: false });
        const held = await f.readControl(); assert.equal(held.pending, 1); assert.equal(held.settled, false);
        for (const action of ['RESUME', 'STEP', 'TAKE_OVER']) await assert.rejects(() => f.control(action));
        const report = await f.successor(request), linked = await f.card();
        assert.equal(report.executionMode, 'CONTINUOUS'); assert.equal(report.controlState, 'RUNNING'); assert.equal(report.captureRunId, f.current.run.id);
        assert.equal(linked.claim.runId, report.id); assert.equal(linked.claim.workflowRevision, initial.claim.workflowRevision);
        assert.equal(linked.claimFence, initial.claimFence); assert.equal(linked.startedAt, initial.startedAt);
        assert.equal(linked.stage, 'INSPECTION'); assert.equal(Object.hasOwn(linked.workspace, 'pending'), false);
        assert.equal((await f.successor(request)).id, report.id);
        assert.equal(await f.admin.staffWorkspaceOperation.count({ where: { cardId: linked.id, action: 'MACHINE_REPORT_SUCCESSOR' } }), 1);
        const analysis = await f.admin.staffAnalysisRevision.findUnique({ where: { operationId: job.gradingOperationId } });
        assert.equal(JSON.parse(analysis.admissionCanonical).machineInitialization.jobId, job.id);
        assert.equal((await f.usage()).card, '110000'); assert.equal((await f.usage()).total, '135000');
        assert.equal(await f.admin.staffReportApproval.count(), 0); assert.equal(await f.admin.staffPublicReport.count(), 0);
        assert.equal(await f.admin.staffOperatorStep.count({ where: { runId: f.current.run.id } }), 5);
    }));

    await scenario('STEP source initialization cannot silently grant the successor report a new machine request', context => fixture(context, async f => {
        await f.control('PAUSE'); await f.control('STEP'); const request = await f.intent();
        assert.equal((await f.initialization(request).run()).state, 'SUCCEEDED'); await f.finishPermit(request);
        const run = await f.successor(request); assert.equal(run.executionMode, 'STEP'); assert.equal(run.controlState, 'PAUSED'); assert.equal(run.stepBudget, 0);
        assert.equal((await f.ledger.claim(run.id, randomUUID())).mode, 'PAUSED');
        await f.control('STEP'); const claimed = await f.ledger.claim(run.id, randomUUID()); assert.equal(claimed.mode, 'WORK');
        await f.request(claimed.lease, 'read_card_report');
        assert.equal((await f.admin.staffOperatorRun.findUnique({ where: { id: run.id } })).stepBudget, 0); assert.equal(f.workerCalls(), 1);
    }));

    await scenario('human fresh-photo report admission retains actual browser actor and original human initialization without machine grants', context => fixture(context, async f => {
        const request = await f.intent(), service = f.initialization(request);
        assert.equal((await service.run()).state, 'SUCCEEDED'); assert.equal(f.workerCalls(), 1);
        const [admission] = await f.admin.$queryRaw`SELECT * FROM atlas_staff."StaffWorkspaceSourceAdmission" WHERE "requestId"=${request.requestId}::uuid`;
        const operation = await f.admin.staffGradingOperation.findFirst({ where: { operationId: request.requestId } });
        assert.equal(admission.actorKind, 'HUMAN'); assert.equal(admission.sessionHash, request.scope.sessionHash);
        assert.equal(operation.actorKind, 'HUMAN'); assert.equal(operation.actorId, request.scope.actorId); assert.equal(operation.state, 'SUCCEEDED');
        assert.equal(await f.admin.staffMachineInitialization.count(), 0); assert.equal(await f.admin.staffOperatorRun.count(), 0);
        assert.equal((await service.run()).state, 'SUCCEEDED'); assert.equal(f.workerCalls(), 1);
        assert.equal((await f.usage()).card, '10000'); assert.equal((await f.usage()).total, '35000');
    }, { human: true }));

    await scenario('workspace machine admission requires its immutable audit in the same transaction and current actor access', context => fixture(context, async f => {
        const request = await f.intent(), ledger = f.sourceLedger(request); await ledger.claim(f.bound(request)); await f.admit(request);
        await assert.rejects(() => f.transaction(tx => enqueueWorkspaceMachineInitializationInTransaction(new Proxy(tx, {
            get(target, property) {
                if (property === '$executeRaw') return (strings, ...args) => strings.join('?').includes('INSERT INTO atlas_staff."StaffAudit"') ? 1 : target.$executeRaw(strings, ...args);
                const value = target[property]; return typeof value === 'function' ? value.bind(target) : value;
            } }), f.machineConfig, f.ports, { requestId: request.requestId })), /capture admission|immutable|audit/i);
        assert.equal(await f.admin.staffMachineInitialization.count(), 0);
        await f.admin.staffIdentity.update({ where: { id: request.scope.actorId }, data: { accessVersion: { increment: 1 } } });
        await assert.rejects(() => f.transaction(tx => enqueueWorkspaceMachineInitializationInTransaction(tx, f.machineConfig, f.ports,
            { requestId: request.requestId })), /WORKSPACE_MACHINE_ACTOR_CHANGED/);
        assert.equal(await f.admin.staffGradingExecution.count(), 0); assert.equal(f.workerCalls(), 0);
    }));

    await scenario('initialization service atomically rolls back failed enqueue and retains one undispatched zero-cost source result', context => fixture(context, async f => {
        const request = await f.intent(), service = f.initialization(request);
        f.settings.cached = true;
        const failed = { state: 'FAILED', failureCode: 'WORKSPACE_INITIALIZATION_NOT_DISPATCHED' };
        assert.deepEqual(await service.run(), failed);
        assert.equal(await f.admin.staffWorkspaceSourceAdmission.count({ where: { requestId: request.requestId } }), 0);
        assert.equal(await f.admin.staffMachineInitialization.count({ where: { id: request.requestId } }), 0);
        assert.equal(await f.admin.staffGradingOperation.count({ where: { specimenId: f.ids[0] } }), 0);
        assert.equal(await f.admin.staffSpecimen.count({ where: { id: f.ids[0] } }), 0);
        assert.equal((await f.card()).specimenId, null); assert.equal(f.workerCalls(), 0);
        const [source] = await f.admin.$queryRaw`SELECT * FROM atlas_staff."StaffWorkspaceSourceOperation" WHERE "requestId"=${request.requestId}::uuid`;
        assert.equal(source.state, 'FAILED'); assert.equal(source.reservedMicroUsd, 0n);
        assert.equal(source.dispatchedAt, null); assert.equal(source.gradingExecutionId, null);
        assert.deepEqual(JSON.parse(source.resultCanonical), failed);
        f.settings.cached = false;
        assert.deepEqual(await service.run(), failed); assert.deepEqual(await service.status(), failed);
        assert.equal(f.workerCalls(), 0); assert.equal(await f.admin.staffWorkspaceSourceOperation.count({ where: { requestId: request.requestId } }), 1);
        assert.equal((await f.usage()).card, '100000'); assert.equal((await f.usage()).total, '125000');
        await f.finishPermit(request, 'FAILED'); await assert.rejects(() => f.successor(request));
    }));

    await scenario('machine initialization rollback retains UNKNOWN detector and source cost and cannot create a report successor', context => fixture(context, async f => {
        const request = await f.intent(), service = f.initialization(request); f.settings.afterPersist = () => { throw new Error('OWNED_LATE_COMMIT_DENIED'); };
        assert.equal((await service.run()).state, 'UNKNOWN'); assert.equal(f.workerCalls(), 1);
        await f.finishPermit(request, 'UNKNOWN'); assert.equal((await service.run()).state, 'UNKNOWN'); assert.equal(f.workerCalls(), 1);
        assert.equal((await f.admin.staffSpecimen.findUnique({ where: { id: f.ids[0] } })).analysisRevision, 0);
        assert.equal(await f.admin.staffAnalysisRevision.count({ where: { specimenId: f.ids[0] } }), 0);
        const job = await f.admin.staffMachineInitialization.findUnique({ where: { id: request.requestId } }); assert.equal(job.state, 'UNKNOWN');
        const execution = await f.admin.staffGradingExecution.findUnique({ where: { operationId: job.gradingOperationId } });
        assert.equal(execution.state, 'UNKNOWN'); assert.equal(execution.reservedMicroUsd, 10000n); assert.equal(execution.actualMicroUsd, null);
        await assert.rejects(() => f.successor(request)); await assert.rejects(() => f.control('TAKE_OVER'));
        assert.equal((await f.usage()).card, '110000'); assert.equal((await f.usage()).total, '135000');
    }));
}

export { fixture as workspaceSourceFixture };
