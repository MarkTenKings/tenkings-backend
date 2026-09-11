// Disposable local PostgreSQL only. Real role/ledger/command guards, synthetic
// responses and PNGs; no provider, storage, production or human approval calls.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PrismaClient } from '../.generated/staff-database/index.js';
import { canonical, digest } from '@atlas/service-bridge/protocol';
import { OperatorLedger } from '../../../packages/atlas-operator/src/ledger.mjs';
import { makeOperatorConfig } from '../../../packages/atlas-operator/src/policy.mjs';
import { setupSource, withDispatcher } from '../../../packages/atlas-operator/test/workspace-dispatcher-postgres.mjs';
import { workspaceCaptureFixture } from './workspace-capture-fixture.mjs';
import { disposablePostgres } from './disposable-postgres.mjs';
import { localAccessConfig, seedLocalStaff, fixtureVerifyProvider } from '../lib/server/access/fixture.mjs';
import { DurableStaffAuth } from '../lib/server/access/auth.mjs';
import { StaffDatabase } from '../lib/server/access/database.mjs';

const options = { rosterSize: 1, preparationEnabled: true, effort: 'max', automaticCapture: true };
const runRow = (f, id) => f.admin.staffOperatorRun.findUnique({ where: { id } });
const binding = async (f, id, client = f.admin) => (await client.$queryRaw`
    SELECT atlas_staff.operator_release_adoption_binding(${id}::uuid) AS value`)[0].value;
const adopt = async (client, id, before, maintenanceId = randomUUID()) => (await client.$queryRaw`
    SELECT atlas_staff.adopt_workspace_operator_release(${id}::uuid,${maintenanceId}::uuid,${before.runHash},
        ${before.cardHash},${before.controlsHash},'Synthetic owner deployment maintenance; preserve settled work.') AS value`)[0].value;
async function settled(f, { large = false } = {}) {
    await setupSource(f);
    if (large) await f.sql(`CREATE FUNCTION atlas_staff.fixture_adoption_input() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        NEW."inputCanonical":=atlas_staff.workspace_manifest_canonical(NEW."inputCanonical"::jsonb||jsonb_build_array(
          jsonb_build_object('role','user','content',repeat('x',10190000))));
        NEW."inputHash":=encode(sha256(convert_to(NEW."inputCanonical",'UTF8')),'hex'); RETURN NEW; END $$;
        CREATE TRIGGER "AA_fixture_adoption_input" BEFORE INSERT ON atlas_staff."StaffOperatorRun"
          FOR EACH ROW EXECUTE FUNCTION atlas_staff.fixture_adoption_input();`);
    const current = await f.claim();
    if (large) await f.sql('DROP TRIGGER "AA_fixture_adoption_input" ON atlas_staff."StaffOperatorRun"; DROP FUNCTION atlas_staff.fixture_adoption_input()');
    let lease = (await f.apply(current.lease, await f.request(current.lease, 'read_original_photos'))).lease;
    for (const asset of JSON.parse(current.run.manifestCanonical).assets) {
        const crop = { assetId: asset.assetId, sourceSha256: asset.sha256, side: asset.side,
            rect: { x: 0, y: 0, width: asset.width, height: asset.height } };
        lease = (await f.apply(lease, await f.request(lease, 'inspect_region', crop))).lease;
    }
    return { ...current, lease, run: await runRow(f, current.run.id) };
}
async function rebind(f) {
    const config = makeOperatorConfig({ ...f.config, databaseUrl: f.db.operatorUrl, buildHash: digest('Synthetic successor operator artifact') });
    await f.admin.staffOperatorControl.update({ where: { id: 'active' }, data: { ...config, revision: { increment: 1 } } });
    await f.admin.staffControl.update({ where: { id: 'active' }, data: { revision: { increment: 1 } } });
    return config;
}
const noMaintenance = async f => assert.equal(await f.admin.staffAudit.count({ where: { event: 'ATLAS_OPERATOR_RELEASE_ADOPTED' } }), 0);

export async function workspaceReleaseAdoptionScenarios(scenario) {
    await scenario('owner release adoption retains a real 10 MB settled continuation and requires the new signed-in RESUME command',
        context => workspaceCaptureFixture(context, async f => {
            const current = await settled(f, { large: true }); await f.expire(current.run.id);
            const beforeRun = await runRow(f, current.run.id), beforeCard = await f.card();
            assert.equal(beforeRun.revision, 4); assert(Buffer.byteLength(beforeRun.inputCanonical) > 10_190_000);
            const oldCommand = await f.admin.staffWorkspaceOperation.findFirst({ where: { cardId: f.ids[0], action: 'claim' } });
            const config = await rebind(f), before = await binding(f, beforeRun.id), auditId = randomUUID();
            await assert.rejects(() => adopt(context.client, beforeRun.id, before), /permission denied/);
            await assert.rejects(() => adopt(f.client, beforeRun.id, before), /permission denied/);
            await assert.rejects(() => binding(f, beforeRun.id, context.client), /permission denied/);
            const result = await adopt(f.admin, beforeRun.id, before, auditId);
            const after = await binding(f, beforeRun.id), afterRun = await runRow(f, beforeRun.id), afterCard = await f.card();
            assert.equal(result.status, 'WORKSPACE_OPERATOR_RELEASE_ADOPTED'); assert.equal(result.state, 'PAUSED');
            assert.deepEqual(after.ledger, before.ledger); assert.deepEqual(after.controls, before.controls);
            for (const key of ['inputCanonical','inputHash','manifestCanonical','manifestHash','policyCanonical','policyHash','revision',
                'leaseFence','evidenceHash','gradingPolicyHash','pilotId','createdAt']) assert.deepEqual(afterRun[key], beforeRun[key], key);
            assert.equal(afterRun.runtimeHash, config.configHash); assert.equal(afterRun.controlState, 'PAUSED');
            assert.equal(afterRun.controlRevision, beforeRun.controlRevision + 1); assert.equal(afterRun.leaseOwner, null);
            assert.equal(afterCard.startedAt, beforeCard.startedAt); assert.equal(afterCard.revision, beforeCard.revision + 1);
            assert.deepEqual(afterCard.claim, { ...beforeCard.claim, controlRevision: beforeCard.claim.controlRevision + 1 });
            const audit = await f.admin.staffAudit.findUnique({ where: { id: auditId } }); assert.equal(audit.actorId, null);
            const { controls: _controls, ledger: _ledger, ...afterProof } = after;
            assert.equal(result.proofHash, digest(audit.details)); assert.deepEqual(JSON.parse(audit.details).after, afterProof);
            assert(Buffer.byteLength(audit.details) <= 16384);
            assert.equal(await f.admin.staffWorkspaceOperation.count({ where: { action: 'OPERATOR_CONTROL' } }), 0);
            assert.equal(await f.admin.staffOperationsGrant.count(), 0); assert.equal(f.calls(), 3);
            await assert.rejects(() => adopt(f.admin, beforeRun.id, before, auditId), /NOT_AVAILABLE/);
            await assert.rejects(() => f.admin.staffAudit.update({ where: { id: auditId }, data: { details: '{}' } }), /immutable/);
            await assert.rejects(() => f.control('RESUME')); // Prior release session is invalid.
            await withDispatcher(context, { ...f, config }, async ({ client, dispatcher, effects }) => {
                await assert.rejects(() => adopt(client, beforeRun.id, before), /permission denied/);
                assert.equal(await dispatcher.pickup(), null);
                const old = { runId: beforeRun.id, commandId: oldCommand.id };
                assert.equal((await dispatcher.admit(old)).code, 'ASTRA_DISPATCH_COMMAND_CHANGED');
                const signed = await f.login();
                const input = { action: 'RESUME', operationId: randomUUID(), expectedRevision: afterCard.revision };
                await f.service.control(signed.staff, f.ids[0], input);
                await f.service.control(signed.staff, f.ids[0], input);
                const command = await f.admin.staffWorkspaceOperation.findUnique({ where: { actorId_operationId: {
                    actorId: signed.staff.id, operationId: input.operationId } } });
                assert.deepEqual(await dispatcher.pickup(), { runId: beforeRun.id, commandId: command.id });
                assert.equal((await dispatcher.admit({ runId: beforeRun.id, commandId: command.id })).state, 'ADMITTED');
                assert.equal((await dispatcher.admit(old)).code, 'ASTRA_DISPATCH_COMMAND_CHANGED'); assert.equal(effects(), 0);
                const ledger = new OperatorLedger({ client: f.client, config }), claim = await ledger.claim(beforeRun.id, randomUUID());
                assert.equal(claim.lease.fence, beforeRun.leaseFence + 1); assert.equal(claim.lease.revision, 4);
                assert.equal(await f.admin.staffOperatorAttempt.count(), 3); assert.equal(f.calls(), 3);
            });
            const timing = (await f.admin.$queryRaw`SELECT atlas_staff.workspace_timing_history(${f.ids[0]}::uuid) AS value`)[0].value;
            assert(timing.events.some(event => event.kind === 'PAUSE' && +new Date(event.at) === Math.max(+beforeRun.updatedAt, +beforeRun.leaseExpiresAt)));
        }, options));

    await scenario('release adoption refuses active leases, held requests and stale run/card/control CAS without changing history',
        context => workspaceCaptureFixture(context, async f => {
            const current = await settled(f), config = await rebind(f);
            const active = await binding(f, current.run.id);
            await assert.rejects(() => adopt(f.admin, current.run.id, active), /NOT_AVAILABLE/);
            await f.expire(current.run.id); const before = await binding(f, current.run.id);
            for (const key of ['runHash','cardHash','controlsHash']) await assert.rejects(() =>
                adopt(f.admin, current.run.id, { ...before, [key]: '0'.repeat(64) }), /COMPARE_FAILED/);
            await assert.rejects(() => f.admin.staffOperatorRun.update({ where: { id: current.run.id },
                data: { runtimeHash: config.configHash, controlState: 'PAUSED', controlRevision: { increment: 1 } } }), /immutable/);
            assert.deepEqual(await binding(f, current.run.id), before); await noMaintenance(f);
        }, options));

    await scenario('deployment maintenance never adopts a dispatched request without its exact applied receipt and step',
        context => workspaceCaptureFixture(context, async f => {
            const current = await settled(f);
            await f.request(current.lease, 'read_original_photos', {}, { deferReceipt: true });
            await f.expire(current.run.id); await rebind(f); const before = await binding(f, current.run.id);
            await assert.rejects(() => adopt(f.admin, current.run.id, before), /NOT_AVAILABLE/);
            assert.deepEqual(await binding(f, current.run.id), before); await noMaintenance(f);
        }, options));

    await scenario('adoption audit forgery and missing matching mutations roll back the entire maintenance transaction',
        context => workspaceCaptureFixture(context, async f => {
            const current = await settled(f); await f.expire(current.run.id); await rebind(f);
            const before = await binding(f, current.run.id);
            const plan = (await f.admin.$queryRaw`SELECT atlas_staff.operator_release_adoption_plan(${current.run.id}::uuid,
                ${randomUUID()}::uuid,'Synthetic exact reviewed pause',date_trunc('milliseconds',clock_timestamp() AT TIME ZONE 'UTC')) AS value`)[0].value;
            const insert = value => f.admin.staffAudit.create({ data: { id: value.auditId, event: 'ATLAS_OPERATOR_RELEASE_ADOPTED',
                subjectId: f.ids[0], actorId: null, details: canonical(value), createdAt: new Date(value.createdAt + 'Z') } });
            await assert.rejects(() => insert({ ...plan, after: { ...plan.after, run: { ...plan.after.run, inputHash: '0'.repeat(64) } } }), /PROOF_CHANGED/);
            await assert.rejects(() => insert(plan), /ATOMICITY_REQUIRED/);
            await assert.rejects(() => f.admin.$transaction(async tx => {
                await adopt(tx, current.run.id, before); throw Error('Synthetic rollout rollback after adoption');
            }), /Synthetic rollout rollback/);
            assert.deepEqual(await binding(f, current.run.id), before); await noMaintenance(f);
            // Even an accidental future EXECUTE grant cannot promote a serving
            // session to the table-owner identity required by the invoker RPC.
            const role = new URL(context.db.staffUrl).username;
            await f.sql(`GRANT EXECUTE ON FUNCTION atlas_staff.adopt_workspace_operator_release(uuid,uuid,text,text,text,text),
                atlas_staff.assert_operator_release_adoption_owner() TO "${role}"`);
            await assert.rejects(() => adopt(context.client, current.run.id, before), /OWNER_REQUIRED/);
            await f.sql(`REVOKE EXECUTE ON FUNCTION atlas_staff.adopt_workspace_operator_release(uuid,uuid,text,text,text,text),
                atlas_staff.assert_operator_release_adoption_owner() FROM "${role}"`);
        }, options));

    await scenario('expired wall-clock maintenance restores only remaining active time and never passes original policy or workspace expiry',
        context => workspaceCaptureFixture(context, async f => {
            const current = await settled(f);
            // Seed only this disposable historical clock, as the existing
            // recovery fixtures do; restore the real guard before testing.
            // All original requests, receipts, steps and financial rows remain.
            await f.admin.$transaction(async tx => {
                await tx.$executeRaw`ALTER TABLE atlas_staff."StaffOperatorRun" DISABLE TRIGGER "StaffOperatorRun_guard"`;
                await tx.$executeRaw`UPDATE atlas_staff."StaffOperatorRun" SET
                    "createdAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '11 minutes',
                    "deadlineAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 minute',
                    "updatedAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '10 minutes',
                    "leaseExpiresAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '9 minutes' WHERE id=${current.run.id}::uuid`;
                await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
                await tx.$executeRaw`ALTER TABLE atlas_staff."StaffOperatorRun" ENABLE TRIGGER "StaffOperatorRun_guard"`;
            });
            const expiry = new Date(Date.now() + 30_000);
            await f.admin.staffWorkspaceControl.update({ where: { id: 'active' }, data: { expiresAt: expiry, revision: { increment: 1 } } });
            await rebind(f); const before = await binding(f, current.run.id), old = await runRow(f, current.run.id);
            assert(+old.deadlineAt < Date.now());
            const result = await adopt(f.admin, current.run.id, before), after = await runRow(f, current.run.id);
            assert.equal(+after.deadlineAt, +expiry);
            assert.equal(result.timing.remainingActiveMs, +old.deadlineAt - Math.max(+old.updatedAt, +old.leaseExpiresAt));
            assert.equal(result.timing.maxRunMs, f.policy.maxRunMs); assert(result.timing.excludedOutageMs >= 9 * 60_000);
            assert(+after.deadlineAt <= +new Date(f.policy.expiresAt)); assert(+after.deadlineAt <= +new Date(f.budget.expiresAt));
            assert.deepEqual((await binding(f, current.run.id)).ledger, before.ledger);
        }, options));
}

// Standalone focused invocation uses the same owned-cluster harness and real
// STAFF login/role setup as validate-postgres.mjs, without running other suites.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const fixture = await disposablePostgres(process.argv.slice(2)), results = []; let caught;
    async function scenario(name, work) {
        const db = await fixture.database(), admin = new PrismaClient({ datasources: { db: { url: db.adminUrl } } }),
            client = new PrismaClient({ datasources: { db: { url: db.staffUrl } } });
        const config = localAccessConfig({ databaseUrl: db.staffUrl, sessionKey: randomBytes(32), phoneKey: randomBytes(32) });
        const identities = await seedLocalStaff(admin, config);
        const auth = new DurableStaffAuth({ config, database: new StaffDatabase(client, config), provider: fixtureVerifyProvider(config) });
        const login = async (whichAuth = auth, phone = '+12025550141') => {
            const boot = await whichAuth.bootstrap(undefined, 'test-client'), cookie = `${config.cookies.browser}=${boot.browserToken}`;
            const challenge = await whichAuth.send(cookie, boot.csrf, { phone, requestId: randomUUID() }, 'test-client');
            const signed = await whichAuth.verify(cookie, boot.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'test-client');
            return { ...signed, cookie: `${cookie}; ${config.cookies.session}=${signed.token}` };
        };
        try { await work({ db, admin, client, config, identities, auth, login, sql: (query, values) => fixture.sql(query, values, db.name) });
            results.push({ name, ok: true }); console.log(`PASS ${name}`); }
        finally { await admin.$disconnect(); await client.$disconnect(); await db.dispose(); }
    }
    try { await workspaceReleaseAdoptionScenarios(scenario); } catch (error) { caught = error; }
    finally {
        await fixture.stop(); writeFileSync(join(fixture.directory, 'release-adoption-result.json'), JSON.stringify({
            ok: !caught, results, error: caught ? fixture.safe(caught.stack) : null, stopped: true }, null, 2));
        console.log(JSON.stringify({ ok: !caught, passed: results.length, stopped: true, directory: fixture.directory }));
    }
    if (caught) { console.error(fixture.safe(caught.stack)); process.exitCode = 1; }
}
