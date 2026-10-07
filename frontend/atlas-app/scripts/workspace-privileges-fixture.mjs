// Owned disposable PostgreSQL only. The real generated clients and bridge run
// against narrowly granted credentials; source pixels and detections remain
// explicitly synthetic and cannot demonstrate optical or live readiness.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { PrismaClient as SourceClient } from '../../../backend/atlas-private/.generated/database/index.js';
import { PrismaClient as CoordinatorClient } from '../.generated/staff-database/index.js';
import { canonical, digest, requireBridge as check } from '../../../packages/atlas-service-bridge/src/protocol.mjs';
import { workspaceGrantSQL, assertWorkspacePrivileges } from '../../../packages/atlas-service-bridge/src/workspace-privileges.mjs';
import { createWorkspaceInitializationService } from '../../../packages/atlas-service-bridge/src/workspace-initialization-service.mjs';
import { enqueueWorkspaceReportSuccessorInTransaction } from '../../../packages/atlas-operator/src/ledger.mjs';
import { calculateSpeedsterReview } from '@atlas/grading-core/review';
import { measureSpeedsterCenteringBorders } from '@atlas/grading-core/scoring';
import { fixtureAnalysis } from '../lib/server/access/fixture-analysis.mjs';
import { workspaceSourceFixture } from './workspace-source-fixture.mjs';

const privateRequire = createRequire(new URL('../../nextjs-app/package.json', import.meta.url));
const { tsImport } = await import(pathToFileURL(privateRequire.resolve('tsx/esm/api')).href);
const { createAtlasWorkspaceSourceLedger, createAtlasWorkspaceSourceAuthority } = await tsImport('../../nextjs-app/lib/server/atlasWorkspaceSourceAuthority.ts', import.meta.url);
const { createPrismaAtlasWorkspaceSessions } = await tsImport('../../nextjs-app/lib/server/atlasWorkspaceSource.ts', import.meta.url);
const { createPrismaSpeedsterPreparationStore } = await tsImport('../../nextjs-app/lib/server/speedsterPreparationStore.ts', import.meta.url);
const { catchUpSpeedsterLearningBankForDetect } = await tsImport('../../nextjs-app/lib/server/aiGraderV2LearningBank.ts', import.meta.url);
const { deriveSpeedsterLearningBankV2 } = await tsImport('../../nextjs-app/lib/ai-grader-v2/learning-v2.ts', import.meta.url);

const transaction = (client, work) => client.$transaction(async tx => {
    const value = await work(tx); await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`; return value;
}, { maxWait: 5000, timeout: 10000 });
const denied = action => assert.rejects(action, error => /permission denied/i.test(error.message));

async function credentials(context, work) {
    const clients = {}, roles = {}, queries = [];
    try {
        for (const kind of ['SOURCE', 'COORDINATOR']) {
            const role = `atlas_test_${kind.toLowerCase()}_${randomBytes(6).toString('hex')}`, password = randomBytes(24).toString('hex');
            // Generated hexadecimal identifiers/passwords stay inside this
            // harness and are never emitted or reused outside its cluster.
            await context.sql(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
            await context.sql(workspaceGrantSQL(role, kind));
            const url = new URL(context.db.adminUrl); url.username = role; url.password = password;
            const Client = kind === 'SOURCE' ? SourceClient : CoordinatorClient;
            clients[kind] = new Client({ datasources: { db: { url: url.href } }, log: [{ emit: 'event', level: 'query' }] }); roles[kind] = role;
            clients[kind].$on('query', event => { queries.push(`${kind}: ${event.query}`); if (queries.length > 5) queries.shift(); });
            await assertWorkspacePrivileges(clients[kind], kind);
        }
        // Match the private runtime's callback-only original source adapter.
        const source = new Proxy(clients.SOURCE, { get(target, key) {
            if (key === '$transaction') return (work, options) => {
                assert.equal(typeof work, 'function');
                return target.$transaction(async tx => {
                    await assertWorkspacePrivileges(tx, 'SOURCE');
                    await tx.$executeRaw`SET LOCAL search_path=pg_catalog,public,atlas_staff,pg_temp`;
                    const result = await work(tx); await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`; return result;
                }, options);
            };
            const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
        } });
        await work({ source, coordinator: clients.COORDINATOR, roles });
    } catch (error) {
        throw new Error(`${error.message}\nLast fixture SQL (no parameter values):\n${queries.join('\n')}`, { cause: error });
    } finally { await Promise.all(Object.values(clients).map(client => client.$disconnect())); }
}

async function boundSource(f, client) {
    const card = await f.card(), initial = await f.ports.loadSource(f.admin, card.source);
    // Prisma create injects finishing default columns; the private adapter uses
    // this bounded insert and preserves PostgreSQL's unchanged defaults.
    await client.$executeRaw`INSERT INTO public."AiGraderV2Session"
        (id,"createdByUserId","cardProfile","workflowState","ruleVersion",identity,capture,"reviewedDefects","gradeReport","createdAt","updatedAt")
        VALUES(${initial.id},${initial.createdByUserId},${initial.cardProfile},'CAPTURED','OWNED_FIXTURE_ONLY',${canonical(initial.identity)}::jsonb,
            ${canonical(initial.capture)}::jsonb,'[]'::jsonb,'null'::jsonb,(${initial.updatedAt}::timestamptz AT TIME ZONE 'UTC'),(${initial.updatedAt}::timestamptz AT TIME ZONE 'UTC'))`;
    const load = async (request, tx) => {
        if (!tx) return transaction(client, database => load(request, database));
        await tx.$executeRaw`SELECT atlas_staff.lock_workspace_private_controls()`;
        const [identity] = await tx.$queryRaw`SELECT * FROM atlas_staff.lock_workspace_private_actor(${request.scope.actorId}::uuid,${request.scope.sessionHash ?? null}::text)`;
        const [row] = await tx.$queryRaw`SELECT * FROM atlas_staff.lock_workspace_private_card(${request.cardId}::uuid)`;
        const operationRow = await tx.staffWorkspaceOperation.findUnique({ where: { id: request.requestId } });
        check(identity?.role === 'REVIEWER' && row && operationRow && digest(row.canonical) === row.contentHash
            && digest(operationRow.canonical) === operationRow.contentHash, 'OWNED_AUTHORITY_CHANGED');
        const current = JSON.parse(row.canonical), operation = JSON.parse(operationRow.canonical);
        check(operation.actorId === identity.id && operation.result.accessVersion === identity.accessVersion
            && current.claim.actorId === identity.id && current.claimFence === request.binding.claimFence
            && current.captureHash === request.binding.captureHash && current.workspace.pending.requestId === request.requestId,
        'OWNED_AUTHORITY_CHANGED');
        const machine = request.scope.actorKind === 'MACHINE'
            ? { run: (await tx.$queryRaw`SELECT * FROM atlas_staff.lock_workspace_private_run(${current.claim.runId}::uuid)`)[0] } : undefined;
        return { card: current, operation, ...(machine ? { machine } : {}) };
    };
    const authority = { load, loadInTransaction: load, recheck: (request, _prior, tx) => load(request, tx),
        current: async (tx, request) => {
            await load(request, tx);
            const source = await tx.staffWorkspaceSourceControl.findUnique({ where: { id: 'active' } });
            const workspace = await tx.staffWorkspaceControl.findUnique({ where: { id: 'active' } });
            const [{ now }] = await tx.$queryRaw`SELECT clock_timestamp() AS now`; return { source, workspace, now };
        } };
    const full = JSON.parse(fixtureAnalysis({ title: 'Synthetic source phase', set: 'Owned PostgreSQL' }, 'a'.repeat(64)).sourceCanonical);
    let calls = 0, performError;
    const ports = { ...f.ports,
        async loadSource(tx, binding) {
            const source = await tx.aiGraderV2Session.findUnique({ where: { id: binding.sourceId } });
            check(source?.createdByUserId === binding.sourceOwnerId, 'OWNED_SOURCE_CHANGED'); return source;
        },
        async perform({ source, action, beforeSessionLock, afterPersist }) {
            calls++; assert.equal(action.type, 'INITIALIZE');
            const capture = Object.fromEntries(['front', 'back'].map(side => [side,
                { centeringBorders: measureSpeedsterCenteringBorders(source.capture[side].centeringQuad) }]));
            const review = calculateSpeedsterReview(capture, full.reviewedDefects);
            const data = { reviewedDefects: review.defects, gradeReport: { ...review.grade, detectorVersion: full.gradeReport.detectorVersion },
                detectionPair: { operationId: 'owned-synthetic-fresh-detector', captureBindingSha256: '6'.repeat(64),
                    memorySnapshotSha256: '7'.repeat(64), frontReceiptHmacSha256: '8'.repeat(64), backReceiptHmacSha256: '9'.repeat(64) } };
            const identity = { sessionId: source.id, createdByUserId: source.createdByUserId };
            await transaction(client, async tx => {
                await beforeSessionLock(tx, identity, source.updatedAt, data);
                const result = await tx.aiGraderV2Session.updateMany({ where: { id: source.id, createdByUserId: source.createdByUserId, updatedAt: source.updatedAt },
                    data: { reviewedDefects: data.reviewedDefects, gradeReport: data.gradeReport, updatedAt: new Date(+source.updatedAt + 1) } });
                assert.equal(result.count, 1); await afterPersist(tx, identity, source.updatedAt, data);
            }).catch(error => { performError = error.message; throw error; });
        } };
    return { authority, ports, calls: () => calls, performError: () => performError, initialization: request => {
        const ledger = createAtlasWorkspaceSourceLedger(client, authority, request);
        return { ledger, service: createWorkspaceInitializationService({ client, authority, config: f.machineConfig,
            ports, sourceConfigHash: f.sourceConfigHash, request, ledger }) };
    } };
}

export async function workspacePrivilegeScenarios(scenario) {
    await scenario('private source and coordinator credentials have exact effective rights and preserve original memory catch-up', context => credentials(context, async ({ source, coordinator }) => {
        const bank = deriveSpeedsterLearningBankV2([]).bank;
        await context.admin.$executeRaw`INSERT INTO public."AiGraderV2LearningBank" (id,state,"updatedAt") VALUES ('GLOBAL',${canonical(bank)}::jsonb,clock_timestamp())`;
        const result = await catchUpSpeedsterLearningBankForDetect(source);
        assert.equal(result.catchUp.status, 'V2_CURRENT'); assert.deepEqual(result.learningBank, bank);
        await source.aiGraderV2LearningBank.update({ where: { id: 'GLOBAL' }, data: { state: bank } });
        await denied(() => source.$queryRaw`SELECT "certificateNumber" FROM public."HumanGradeLabel"`);
        await denied(() => source.$executeRaw`UPDATE atlas_staff."StaffControl" SET enabled=enabled`);
        await denied(() => source.$executeRaw`UPDATE atlas_staff."StaffIdentity" SET role=role`);
        await denied(() => source.$executeRaw`UPDATE public."AiGraderV2Session" SET "nfcDone"="nfcDone"`);
        await denied(() => source.$executeRaw`UPDATE public."AiGraderV2CardTypeMap" SET "currentRevisionId"="currentRevisionId"`);
        await denied(() => source.$executeRaw`UPDATE atlas_staff."StaffWorkspaceSourceOperation" SET "actualMicroUsd"="actualMicroUsd"`);
        await denied(() => coordinator.$queryRaw`SELECT * FROM public."AiGraderV2Session"`);
        await denied(() => coordinator.$executeRaw`UPDATE atlas_staff."StaffOperatorRun" SET "controlState"="controlState"`);
        await denied(() => coordinator.$executeRaw`UPDATE atlas_staff."StaffWorkspaceCard" SET "specimenId"="specimenId"`);
    }));

    for (const human of [true, false]) await scenario(`private ${human ? 'HUMAN' : 'MACHINE'} source authority and original preparation locks work without identity or finishing mutations`,
        context => workspaceSourceFixture(context, f => credentials(context, async ({ source }) => {
            const staff = await source.staffControl.findUnique({ where: { id: 'active' } });
            const workspace = await source.staffWorkspaceControl.findUnique({ where: { id: 'active' } });
            const control = await source.staffWorkspaceSourceControl.findUnique({ where: { id: 'active' } });
            const request = await f.intent('PREPARE_SIDE', 'FRONT');
            const identity = await source.staffIdentity.findUnique({ where: { id: request.scope.actorId } });
            if (!human) {
                const intent = JSON.parse((await source.staffWorkspaceOperation.findUnique({ where: { id: request.requestId } })).canonical).result.payload.machine;
                Object.assign(request.scope, { runRevision: intent.runRevision, leaseFence: intent.leaseFence, runControlRevision: intent.runControlRevision });
            }
            const authority = createAtlasWorkspaceSourceAuthority(source, { mode: 'LOCAL_FIXTURE', staffOrigin: staff.origin,
                staffDeploymentId: staff.deploymentId, staffReleaseSha: staff.releaseSha, staffConfigHash: staff.configHash,
                configHash: workspace.configHash, sourceConfigHash: control.sourceConfigHash, sourceDeploymentId: control.sourceDeploymentId,
                sourceReleaseSha: control.sourceReleaseSha, allowedPhoneHashes: [identity.phoneHash] });
            const authorized = await authority.load(request);
            const upload = await authority.loadUpload({ cardId: request.cardId, uploadId: authorized.card.sides.FRONT.uploadId });
            assert.equal(upload.verification.sha256, authorized.originals.FRONT.verification.sha256);
            const session = await createPrismaAtlasWorkspaceSessions(source, authority).ensure(request, authorized);
            assert.equal(session.id, authorized.card.source.sourceId); assert.equal(session.workflowState, 'DRAFT');
            assert.equal(session.nfcDone, false); assert.equal(session.compsDone, false); assert.equal(session.inventoryDone, false);
            assert.equal(session.publicReportSlug, null);
            const store = createPrismaSpeedsterPreparationStore(source), owner = { sessionId: session.id, createdByUserId: session.createdByUserId };
            const snapshot = await store.read(owner); assert.equal(snapshot.session.id, session.id);
            const locked = await store.transaction(owner, async tx => {
                await authority.recheck(request, authorized, tx.database);
                const [{ search_path }] = await tx.database.$queryRaw`SHOW search_path`;
                assert.equal(search_path, 'pg_catalog, public, atlas_staff, pg_temp'); return tx.snapshot;
            });
            assert.equal(locked.session.id, session.id);
            await assertWorkspacePrivileges(source);
        }), { human, sourceType: 'SPEEDSTER', identity: { category: 'SPORTS', playerName: 'Synthetic supplied identity',
            year: '2026', manufacturer: 'Owned synthetic fixture', productSet: 'Disposable PostgreSQL' } }));

    await scenario('private source credential executes HUMAN original initialization without staff or public finishing writes', context => workspaceSourceFixture(context, f => credentials(context, async ({ source }) => {
        const bound = await boundSource(f, source), request = await f.intent(), { service } = bound.initialization(request);
        const result = await service.run(); assert.deepEqual(result, { state: 'SUCCEEDED', specimenId: request.cardId }, bound.performError());
        assert.deepEqual(await service.run(), result); assert.equal(bound.calls(), 1);
        assert.equal(await source.staffMachineInitialization.count({ where: { specimenId: request.cardId } }), 0);
        assert.equal(await source.staffAnalysisRevision.count({ where: { specimenId: request.cardId } }), 1);
        await assertWorkspacePrivileges(source);
    }), { human: true }));

    await scenario('separate private credentials execute MACHINE original initialization and mode-preserving atomic report successor', context => workspaceSourceFixture(context, f => credentials(context, async ({ source, coordinator }) => {
        const bound = await boundSource(f, source);
        await f.control('PAUSE'); await f.control('STEP');
        const request = await f.intent(), { service, ledger } = bound.initialization(request);
        const result = await service.run(); assert.deepEqual(result, { state: 'SUCCEEDED', specimenId: request.cardId }, bound.performError());
        assert.equal(bound.calls(), 1); await ledger.finishPermit('SUCCEEDED');
        const successor = await transaction(coordinator, tx => enqueueWorkspaceReportSuccessorInTransaction(tx, f.config, { requestId: request.requestId }));
        assert.equal(successor.phase, 'REPORT_REVIEW'); assert.equal(successor.controlState, 'PAUSED'); assert.equal(successor.executionMode, 'STEP');
        assert.equal(successor.stepBudget, 0); assert.equal(successor.captureRunId, f.current.run.id);
        assert.equal((await f.card()).claim.runId, successor.id);
        const replay = await transaction(coordinator, tx => enqueueWorkspaceReportSuccessorInTransaction(tx, f.config, { requestId: request.requestId }));
        assert.equal(replay.id, successor.id); assert.equal(bound.calls(), 1);
        await assertWorkspacePrivileges(source); await assertWorkspacePrivileges(coordinator, 'COORDINATOR');
    })));

    await scenario('private runtime rejects unrelated PUBLIC grants, membership, grant options and missing required read rights', context => credentials(context, async ({ source, roles }) => {
        await context.sql('GRANT SELECT (email) ON public."User" TO PUBLIC');
        await assert.rejects(() => assertWorkspacePrivileges(source), /WORKSPACE_DATABASE_ROLE_INVALID/);
        await context.sql('REVOKE SELECT (email) ON public."User" FROM PUBLIC');
        await context.sql(`GRANT UPDATE ("nfcDone") ON public."AiGraderV2Session" TO ${roles.SOURCE}`);
        await assert.rejects(() => assertWorkspacePrivileges(source), /WORKSPACE_DATABASE_ROLE_INVALID/);
        await context.sql(`REVOKE UPDATE ("nfcDone") ON public."AiGraderV2Session" FROM ${roles.SOURCE}`);
        await context.sql(`GRANT SELECT (state) ON public."AiGraderV2LearningBank" TO ${roles.SOURCE} WITH GRANT OPTION`);
        await assert.rejects(() => assertWorkspacePrivileges(source), /WORKSPACE_DATABASE_ROLE_INVALID/);
        await context.sql(`REVOKE GRANT OPTION FOR SELECT (state) ON public."AiGraderV2LearningBank" FROM ${roles.SOURCE}`);
        await context.sql(`GRANT ${roles.COORDINATOR} TO ${roles.SOURCE}`);
        await assert.rejects(() => assertWorkspacePrivileges(source), /WORKSPACE_DATABASE_ROLE_INVALID/);
        await context.sql(`REVOKE ${roles.COORDINATOR} FROM ${roles.SOURCE}`);
        await context.sql(`REVOKE SELECT ("createdAt") ON public."HumanGradeLabel" FROM ${roles.SOURCE}`);
        await assert.rejects(() => assertWorkspacePrivileges(source), /WORKSPACE_DATABASE_ROLE_INVALID/);
        await context.sql(`GRANT SELECT ("createdAt") ON public."HumanGradeLabel" TO ${roles.SOURCE}`);
        await assertWorkspacePrivileges(source);
    }));
}
