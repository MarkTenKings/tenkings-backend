// Owned disposable PostgreSQL and synthetic provider/image data only. This
// validates execution recovery and retained accounting, never grading quality.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PrismaClient } from '../.generated/staff-database/index.js';
import { canonical, digest } from '@atlas/service-bridge/protocol';
import { workspaceGrantSQL, assertWorkspacePrivileges } from '@atlas/service-bridge/workspace-privileges';
import { assertOperatorPrivileges } from '../../../packages/atlas-operator/src/privileges.mjs';
import { OperatorLedger } from '../../../packages/atlas-operator/src/ledger.mjs';
import { makeOperatorConfig } from '../../../packages/atlas-operator/src/policy.mjs';
import { assertStaffPrivileges } from '../lib/server/access/privileges.mjs';
import { isBoundaryError } from '../lib/server/policy.mjs';
import { workspaceCaptureFixture } from './workspace-capture-fixture.mjs';
import { disposablePostgres } from './disposable-postgres.mjs';
import { localAccessConfig, seedLocalStaff, fixtureVerifyProvider } from '../lib/server/access/fixture.mjs';
import { DurableStaffAuth } from '../lib/server/access/auth.mjs';
import { StaffDatabase } from '../lib/server/access/database.mjs';

const options = { rosterSize: 1, preparationEnabled: true, effort: 'max' };
const row = (f, id) => f.admin.staffOperatorRun.findUnique({ where: { id } });
const projection = async f => (await f.admin.$queryRaw`SELECT atlas_staff.read_workspace_operator_control(${f.ids[0]}::uuid) AS value`)[0].value;
const budget = async (f, run) => (await f.admin.$queryRaw`SELECT * FROM atlas_staff.workspace_pilot_budget_usage(${run.pilotId}::uuid,${f.ids[0]}::uuid)`)[0];
async function grant(f, signed = f.signed) {
    const c = await f.admin.staffControl.findUnique({ where: { id: 'active' } });
    const i = await f.admin.staffIdentity.findUnique({ where: { id: signed.staff.id } });
    return f.admin.staffOperationsGrant.create({ data: { id: randomUUID(), identityId: i.id,
        accessVersion: i.accessVersion, controlRevision: c.revision, mode: c.mode, origin: c.origin,
        deploymentId: c.deploymentId, releaseSha: c.releaseSha, configHash: c.configHash,
        authorizationEvidenceHash: digest('Synthetic explicit operations grant; no production authority.'),
        createdAt: new Date(Date.now() - 1000), expiresAt: new Date(Date.now() + 3_600_000) } });
}
async function incident(f, { large = false, unknown = false, received = false } = {}) {
    if (large) await f.sql(`CREATE FUNCTION atlas_staff.fixture_large_initial_input() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        NEW."inputCanonical":=atlas_staff.workspace_manifest_canonical(NEW."inputCanonical"::jsonb||jsonb_build_array(
          jsonb_build_object('role','user','content',jsonb_build_array(jsonb_build_object('type','input_text','text',repeat('x',7350000))))));
        NEW."inputHash":=encode(sha256(convert_to(NEW."inputCanonical",'UTF8')),'hex'); RETURN NEW; END $$;
        CREATE TRIGGER "AA_fixture_large_input" BEFORE INSERT ON atlas_staff."StaffOperatorRun"
          FOR EACH ROW EXECUTE FUNCTION atlas_staff.fixture_large_initial_input();`);
    const current = await f.claim();
    if (large) await f.sql('DROP TRIGGER "AA_fixture_large_input" ON atlas_staff."StaffOperatorRun"; DROP FUNCTION atlas_staff.fixture_large_initial_input()');
    let lease = current.lease;
    const asset = JSON.parse(current.run.manifestCanonical).assets[0];
    const crop = { assetId: asset.assetId, sourceSha256: asset.sha256, side: asset.side,
        rect: { x: asset.width - 1, y: 0, width: 2, height: 2 } };
    if (large) {
        // Both revisions are real, guarded ledger applications. The synthetic
        // large initial evidence was admitted before them, with all guards on.
        lease = (await f.apply(lease, await f.request(lease, 'read_original_photos'))).lease;
        lease = (await f.apply(lease, await f.request(lease, 'inspect_region', crop))).lease;
    }
    const request = await f.request(lease, 'inspect_region', crop, { unknown, deferReceipt: !unknown && !received });
    await f.ledger.stop(lease, { code: 'ASTRA_RUNNER_FAILED' });
    const run = await row(f, current.run.id);
    assert.equal(run.state, 'UNKNOWN'); assert.equal(run.leaseOwner, null);
    return { ...current, run, lease, crop, request };
}
async function input(f) {
    const view = await projection(f); assert.equal(view.canAbandon, true); assert(view.attemptRecovery);
    return { action: 'ABANDON_AND_STEP', operationId: randomUUID(), expectedRevision: (await f.card()).revision,
        recovery: { reviewHash: view.attemptRecovery.reviewHash, reason: 'Explicitly abandon this synthetic unknown execution; retain every charge.' } };
}
async function rpc(f, client, value, changes = {}) {
    const card = await f.card(), args = { actor: f.signed.staff.id, session: f.auth.actors.get(f.signed.staff).sessionHash,
        fence: card.claimFence, revision: value.expectedRevision, command: randomUUID(), hash: value.recovery.reviewHash,
        reason: value.recovery.reason, ...changes };
    return client.$queryRaw`SELECT atlas_staff.abandon_workspace_operator_attempt(${card.id}::uuid,${args.fence}::integer,
        ${args.actor}::uuid,${args.session}::text,${args.revision}::integer,${args.command}::uuid,${args.hash}::text,${args.reason}::text) AS value`;
}

export async function workspaceAttemptAbandonmentScenarios(scenario) {
    await scenario('exact unknown capture abandonment retains a real 7.35 MB revision-3 continuation and grants one STEP only',
        context => workspaceCaptureFixture(context, async f => {
            const current = await incident(f, { large: true }); await grant(f);
            const before = await row(f, current.run.id), cardBefore = await f.card();
            const attemptBefore = await f.admin.staffOperatorAttempt.findUnique({ where: { id: current.request.attemptId } });
            const receiptsBefore = await f.admin.staffOperatorReceipt.findMany({ orderBy: { createdAt: 'asc' } });
            const budgetBefore = await budget(f, before), command = await input(f);
            assert.equal(before.revision, 3); assert(Buffer.byteLength(before.inputCanonical) >= 7_350_000);
            assert(Buffer.byteLength(before.inputCanonical) < 7_400_000); assert.equal(attemptBefore.finishedAt, null);
            await assertStaffPrivileges(context.client); await assertOperatorPrivileges(f.client);
            for (const client of [context.client, f.client]) await assert.rejects(() => client.$executeRaw`
                UPDATE atlas_staff."StaffOperatorAttempt" SET state='ABANDONED' WHERE id=${attemptBefore.id}::uuid`);
            await assert.rejects(async () => rpc(f, f.client, command), /permission denied/);
            await assert.rejects(() => context.client.$transaction(async tx => {
                await rpc(f, tx, command); await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
            }), /ABANDONMENT_COMMAND|immutable human command|foreign key/i);
            assert.equal(await f.admin.staffOperatorAttemptAbandonment.count(), 0);
            assert.deepEqual(await row(f, before.id), before); assert.deepEqual(await budget(f, before), budgetBefore);
            await f.service.control(f.signed.staff, f.ids[0], command);
            await f.service.control(f.signed.staff, f.ids[0], command);
            await assert.rejects(() => f.service.control(f.signed.staff, f.ids[0], {
                ...command, recovery: { ...command.recovery, reason: 'Changed reviewed instruction.' } }), /WORKSPACE_REQUEST_CONFLICT/);
            const after = await row(f, before.id), cardAfter = await f.card();
            const proof = await f.admin.staffOperatorAttemptAbandonment.findFirst(), value = JSON.parse(proof.canonical);
            assert.equal(proof.reviewHash, command.recovery.reviewHash); assert.equal(proof.attemptId, attemptBefore.id);
            assert.equal(proof.hash, digest(proof.canonical)); assert.equal(value.binding.run.inputHash, before.inputHash);
            for (const field of ['inputCanonical','inputHash','manifestCanonical','manifestHash','policyCanonical','policyHash',
                'revision','leaseFence','pilotId','evidenceHash','createdAt','deadlineAt']) assert.deepEqual(after[field], before[field], field);
            assert.equal(after.state, 'RUNNING'); assert.equal(after.controlState, 'RUNNING'); assert.equal(after.executionMode, 'STEP');
            assert.equal(after.stepBudget, 1); assert.equal(after.controlRevision, before.controlRevision + 1); assert.equal(after.leaseOwner, null);
            assert.equal(cardAfter.startedAt, cardBefore.startedAt); assert.equal(cardAfter.captureHash, cardBefore.captureHash);
            assert.deepEqual(cardAfter.claim, { ...cardBefore.claim, mode: 'STEP' });
            assert.deepEqual(await f.admin.staffOperatorAttempt.findUnique({ where: { id: attemptBefore.id } }), { ...attemptBefore, state: 'ABANDONED' });
            assert.deepEqual(await f.admin.staffOperatorReceipt.findMany({ orderBy: { createdAt: 'asc' } }), receiptsBefore);
            assert.deepEqual(await budget(f, before), budgetBefore);
            const view = await projection(f); assert.equal(view.pending, 0); assert.equal(view.settled, true); assert.equal(view.canAbandon, false);
            assert.deepEqual(view.unconfirmedCost, { attempts: 1, reservedMicroUsd: String(attemptBefore.reservedMicroUsd) });
            assert(view.extraTimingEvents.some(event => +new Date(event.at) === +before.updatedAt));
            const picked = (await f.admin.$queryRaw`SELECT atlas_staff.pickup_workspace_queue(${f.config.configHash}) AS value`)[0].value;
            assert.deepEqual(picked, { runId: before.id, commandId: proof.commandId });
            const claim = await f.ledger.claim(before.id, randomUUID()); assert.equal(claim.mode, 'WORK');
            assert.equal(claim.lease.fence, before.leaseFence + 1); assert.equal(claim.lease.revision, 3);
            await assert.rejects(() => f.ledger.applyTool(claim.lease, attemptBefore.id, () => assert.fail('Abandoned tool executed')));
            const next = await f.request(claim.lease, 'inspect_region', current.crop);
            const stepped = await f.apply(claim.lease, next); assert.equal(stepped.state, 'PAUSED');
            await f.ledger.releasePause(stepped.lease);
            assert.equal(f.calls(), 4); assert.equal(await f.admin.staffOperatorAttempt.count(), 4);
            assert.equal(await f.admin.staffOperatorStep.count({ where: { attemptId: next.attemptId } }), 1);
            const paused = await row(f, before.id), pausedCard = await f.card();
            const late = await f.ledger.recordReceipt(current.request); assert.equal(late.state, 'ABANDONED');
            assert.deepEqual(await row(f, before.id), paused); assert.deepEqual(await f.card(), pausedCard);
            const abandoned = await f.admin.staffOperatorAttempt.findUnique({ where: { id: attemptBefore.id } });
            assert.equal(abandoned.state, 'ABANDONED'); assert.equal(abandoned.finishedAt, null);
            assert.equal(abandoned.reservedMicroUsd, attemptBefore.reservedMicroUsd); assert.equal(abandoned.usageCeilingMicroUsd, 20_000n);
            assert.equal(abandoned.requestCanonical, attemptBefore.requestCanonical); assert.equal(abandoned.dispatchClaimId, attemptBefore.dispatchClaimId);
            assert.deepEqual((await projection(f)).unconfirmedCost, { attempts: 0, reservedMicroUsd: '0' });
            const conflict = structuredClone(current.request); conflict.receipt.body.id = 'synthetic-late-conflict';
            conflict.receipt.bodyHash = digest(canonical(conflict.receipt.body));
            await f.ledger.recordReceipt(conflict); assert.deepEqual(await row(f, before.id), paused);
            for (const state of ['RECEIVED','APPLIED','DISPATCHED','FAILED']) await assert.rejects(() =>
                f.client.staffOperatorAttempt.update({ where: { id: abandoned.id }, data: { state } }));
            await assert.rejects(() => f.admin.staffOperatorAttemptAbandonment.update({ where: { id: proof.id }, data: { reason: 'Changed' } }));
            await assert.rejects(() => f.client.staffOperatorAttemptAbandonment.create({ data: { ...proof, id: randomUUID() } }));
            await assert.rejects(() => f.client.$transaction(async tx => {
                const receipt = { ...current.request.receipt, providerRequestId: 'synthetic_unique_late' }, text = canonical(receipt);
                await tx.staffOperatorReceipt.create({ data: { id: randomUUID(), attemptId: abandoned.id, canonical: text, hash: digest(text), createdAt: new Date() } });
                await tx.staffOperatorRun.update({ where: { id: before.id }, data: { state: 'UNKNOWN', failureCode: 'ASTRA_LATE_RECEIPT' } });
            }), /ABANDONED_RECEIPT_NO_RUN_AUTHORITY/);
            // Reversing statement order must fail at commit as well. Otherwise
            // the run BEFORE UPDATE guard cannot yet see the late receipt.
            await assert.rejects(() => f.client.$transaction(async tx => {
                await tx.staffOperatorRun.update({ where: { id: before.id }, data: { state: 'UNKNOWN', failureCode: 'ASTRA_LATE_RECEIPT' } });
                const receipt = { ...current.request.receipt, providerRequestId: 'synthetic_reversed_late' }, text = canonical(receipt);
                await tx.staffOperatorReceipt.create({ data: { id: randomUUID(), attemptId: abandoned.id, canonical: text, hash: digest(text), createdAt: new Date() } });
            }), /ABANDONED_RECEIPT_NO_RUN_AUTHORITY/);
            assert.deepEqual(await row(f, before.id), paused); assert.equal(await f.admin.staffReportApproval.count(), 0);
        }, options));

    await scenario('UNKNOWN abandonment preserves its original finished time, unknown receipt and financial hold',
        context => workspaceCaptureFixture(context, async f => {
            const current = await incident(f, { unknown: true }); await grant(f);
            const old = await f.admin.staffOperatorAttempt.findUnique({ where: { id: current.request.attemptId } });
            const oldReceipts = await f.admin.staffOperatorReceipt.findMany(); const oldBudget = await budget(f, current.run);
            assert(old.finishedAt); await f.service.control(f.signed.staff, f.ids[0], await input(f));
            assert.deepEqual(await f.admin.staffOperatorAttempt.findUnique({ where: { id: old.id } }), { ...old, state: 'ABANDONED' });
            assert.deepEqual(await f.admin.staffOperatorReceipt.findMany(), oldReceipts); assert.deepEqual(await budget(f, current.run), oldBudget);
        }, options));

    await scenario('saved RECEIVED responses cannot be abandoned instead of reconciled',
        context => workspaceCaptureFixture(context, async f => {
            const current = await incident(f, { received: true }); await grant(f);
            assert.equal((await projection(f)).canAbandon, false); assert.equal((await projection(f)).attemptRecovery, null);
            await assert.rejects(async () => rpc(f, context.client, { expectedRevision: (await f.card()).revision,
                recovery: { reviewHash: 'a'.repeat(64), reason: 'Synthetic prohibited receipt bypass.' } }), /ABANDONMENT_NOT_AVAILABLE/);
            assert.equal(await f.admin.staffOperatorAttemptAbandonment.count(), 0);
            assert.equal((await f.admin.staffOperatorAttempt.findUnique({ where: { id: current.request.attemptId } })).state, 'RECEIVED');
        }, options));

    await scenario('review hashes bind fresh grant and incident changes while RPC requires a current human operations session',
        context => workspaceCaptureFixture(context, async f => {
            const current = await incident(f), missingGrant = await input(f);
            await assert.rejects(async () => rpc(f, context.client, missingGrant), /FRESH_OPERATIONS_REQUIRED/);
            await assert.rejects(() => f.service.control(f.signed.staff, f.ids[0], missingGrant), error =>
                isBoundaryError(error) && error.code === 'ASTRA_ABANDONMENT_FRESH_OPERATIONS_REQUIRED'
                    && error.status === 403 && error.outcome === 'NOT_DISPATCHED');
            const operationsGrant = await grant(f), approved = await input(f);
            assert.notEqual(approved.recovery.reviewHash, missingGrant.recovery.reviewHash);
            await assert.rejects(async () => rpc(f, context.client, missingGrant), /REVIEW_CHANGED/);
            await assert.rejects(async () => rpc(f, context.client, approved, { fence: (await f.card()).claimFence + 1 }), /AUTHORITY_REQUIRED/);
            await assert.rejects(async () => rpc(f, context.client, approved, { revision: approved.expectedRevision + 1 }), /AUTHORITY_REQUIRED/);
            await assert.rejects(async () => rpc(f, context.client, approved, { session: '0'.repeat(64) }), /FRESH_OPERATIONS_REQUIRED/);
            const runBefore = await row(f, current.run.id);
            await f.admin.staffSession.update({ where: { tokenHash: f.auth.actors.get(f.signed.staff).sessionHash }, data: { revokedAt: new Date() } });
            await assert.rejects(async () => rpc(f, context.client, approved), /FRESH_OPERATIONS_REQUIRED/);
            await f.admin.staffOperationsGrant.update({ where: { id: operationsGrant.id }, data: { revokedAt: new Date() } });
            assert.notEqual((await projection(f)).attemptRecovery.reviewHash, approved.recovery.reviewHash);
            assert.deepEqual(await row(f, current.run.id), runBefore); assert.equal(await f.admin.staffOperatorAttemptAbandonment.count(), 0);
        }, options));

    await scenario('restricted coordinator can read the incident but cannot abandon or forge its human proof',
        context => workspaceCaptureFixture(context, async f => {
            const current = await incident(f); await grant(f); const command = await input(f);
            const role = `atlas_abandon_coord_${randomBytes(6).toString('hex')}`, password = randomBytes(24).toString('hex');
            await context.sql(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
            await context.sql(workspaceGrantSQL(role, 'COORDINATOR'));
            const url = new URL(context.db.adminUrl); url.username = role; url.password = password;
            const client = new PrismaClient({ datasources: { db: { url: url.href } } });
            try {
                await assertWorkspacePrivileges(client, 'COORDINATOR'); assert.equal(await client.staffOperatorAttempt.count(), 1);
                await assert.rejects(async () => rpc(f, client, command), /permission denied/);
                await assert.rejects(() => client.$executeRaw`INSERT INTO atlas_staff."StaffOperatorAttemptAbandonment"(id) VALUES(gen_random_uuid())`, /permission denied/);
                await assert.rejects(() => client.$queryRaw`SELECT atlas_staff.operator_attempt_abandonment_binding(${current.run.id}::uuid)`);
            } finally { await client.$disconnect(); }
            assert.equal(await f.admin.staffOperatorAttemptAbandonment.count(), 0);
        }, options));

    await scenario('expired capture recovery binds the current runtime and staff grant without extending its pilot',
        context => workspaceCaptureFixture(context, async f => {
            const current = await incident(f), cardBefore = await f.card();
            // Seed an expired synthetic historical run exactly as the existing
            // saved-receipt fixture does. Restore its guard in this transaction
            // before testing the new RPC; no attempt or receipt is rewritten.
            await f.admin.$transaction(async tx => {
                await tx.$executeRaw`ALTER TABLE atlas_staff."StaffOperatorRun" DISABLE TRIGGER "StaffOperatorRun_guard"`;
                await tx.$executeRaw`UPDATE atlas_staff."StaffOperatorRun" SET "createdAt"="createdAt"-interval '11 minutes',
                    "deadlineAt"="deadlineAt"-interval '11 minutes',"updatedAt"="updatedAt"-interval '1 minute' WHERE id=${current.run.id}::uuid`;
                await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
                await tx.$executeRaw`ALTER TABLE atlas_staff."StaffOperatorRun" ENABLE TRIGGER "StaffOperatorRun_guard"`;
            });
            const before = await row(f, current.run.id); assert(+before.deadlineAt < Date.now());
            const nextConfig = makeOperatorConfig({ ...f.config, databaseUrl: f.db.operatorUrl,
                buildHash: digest('Synthetic attempt-abandonment replacement runtime') });
            await f.admin.staffOperatorControl.update({ where: { id: 'active' }, data: { ...nextConfig, revision: { increment: 1 } } });
            await f.admin.staffControl.update({ where: { id: 'active' }, data: { revision: { increment: 1 } } });
            const signed = await f.login(); await grant(f, signed);
            const command = await input(f);
            await assert.rejects(() => f.service.control(f.signed.staff, f.ids[0], command));
            await assert.rejects(() => f.admin.staffOperatorRun.update({ where: { id: before.id },
                data: { runtimeHash: nextConfig.configHash, deadlineAt: new Date(Date.now() + 1000) } }), /immutable/);
            await f.service.control(signed.staff, f.ids[0], command);
            const after = await row(f, before.id), cardAfter = await f.card();
            const proof = await f.admin.staffOperatorAttemptAbandonment.findFirst(), value = JSON.parse(proof.canonical);
            assert.equal(after.runtimeHash, nextConfig.configHash); assert.equal(value.oldRuntimeHash, before.runtimeHash);
            assert.equal(value.newRuntimeHash, nextConfig.configHash); assert.equal(+new Date(value.oldDeadlineAt), +before.deadlineAt);
            assert(+after.deadlineAt > Date.now()); assert(+after.deadlineAt - +proof.createdAt <= f.policy.maxRunMs);
            assert(+after.deadlineAt <= +new Date(f.policy.expiresAt)); assert(+after.deadlineAt <= +new Date(f.budget.expiresAt));
            assert.equal(after.inputCanonical, before.inputCanonical); assert.equal(after.revision, before.revision);
            assert.equal(after.policyCanonical, before.policyCanonical); assert.equal(after.pilotId, before.pilotId);
            assert.equal(cardAfter.startedAt, cardBefore.startedAt); assert.equal(cardAfter.claim.fence, cardBefore.claim.fence);
            assert.equal(cardAfter.claim.controlRevision, cardBefore.claim.controlRevision + 1); assert.equal(cardAfter.claim.mode, 'STEP');
            const ledger = new OperatorLedger({ client: f.client, config: nextConfig });
            const next = await ledger.claim(before.id, randomUUID()); assert.equal(next.mode, 'WORK');
            assert.equal(next.lease.fence, before.leaseFence + 1); assert.equal(f.calls(), 1);
        }, options));

    await scenario('active leases and a changed unknown receipt invalidate abandonment without releasing the hold',
        context => workspaceCaptureFixture(context, async f => {
            const current = await incident(f); await grant(f); const reviewed = await input(f);
            const claim = await f.ledger.claim(current.run.id, randomUUID()); assert.equal(claim.mode, 'RECONCILE_ONLY');
            assert.equal((await projection(f)).canAbandon, false);
            await assert.rejects(() => rpc(f, context.client, reviewed), /ABANDONMENT_NOT_AVAILABLE/);
            await f.ledger.stop(claim.lease, { code: 'ASTRA_RECONCILIATION_ONLY' });
            const latest = await input(f);
            const receipt = { state: 'UNKNOWN', attemptId: current.request.attemptId,
                startedAt: current.request.receipt.startedAt, receivedAt: new Date().toISOString(), httpStatus: null,
                failureCode: 'ASTRA_OUTCOME_UNCONFIRMED' };
            await f.ledger.recordReceipt({ ...current.request, receipt });
            assert.notEqual((await projection(f)).attemptRecovery.reviewHash, latest.recovery.reviewHash);
            await assert.rejects(() => rpc(f, context.client, latest), /ABANDONMENT_REVIEW_CHANGED/);
            const held = await f.admin.staffOperatorAttempt.findUnique({ where: { id: current.request.attemptId } });
            assert.equal(held.state, 'UNKNOWN'); assert.equal(held.actualMicroUsd, null); assert(held.reservedMicroUsd > 0n);
            assert.equal(await f.admin.staffOperatorAttemptAbandonment.count(), 0); assert.equal(f.calls(), 1);
        }, options));

    await scenario('an otherwise valid operations session older than five minutes cannot abandon an attempt',
        context => workspaceCaptureFixture(context, async f => {
            await incident(f); await grant(f); const reviewed = await input(f);
            const tokenHash = f.auth.actors.get(f.signed.staff).sessionHash;
            // Backdate only this owned synthetic session, restoring the
            // immutable-binding trigger before the actual authority assertion.
            await f.admin.$transaction(async tx => {
                await tx.$executeRaw`ALTER TABLE atlas_staff."StaffSession" DISABLE TRIGGER "StaffSession_binding"`;
                await tx.$executeRaw`UPDATE atlas_staff."StaffBrowser" SET "createdAt"="createdAt"-interval '6 minutes',
                    "expiresAt"="expiresAt"-interval '6 minutes' WHERE "tokenHash"=(SELECT "browserHash" FROM atlas_staff."StaffSession" WHERE "tokenHash"=${tokenHash})`;
                await tx.$executeRaw`UPDATE atlas_staff."StaffSession" SET "createdAt"="createdAt"-interval '6 minutes',
                    "expiresAt"="expiresAt"-interval '6 minutes' WHERE "tokenHash"=${tokenHash}`;
                await tx.$executeRaw`ALTER TABLE atlas_staff."StaffSession" ENABLE TRIGGER "StaffSession_binding"`;
            });
            await assert.rejects(() => rpc(f, context.client, reviewed), /FRESH_OPERATIONS_REQUIRED/);
            assert.equal(await f.admin.staffOperatorAttemptAbandonment.count(), 0);
        }, options));

    await scenario('accounting-only abandonment keeps unknown charges and still consumes exactly one fresh STEP',
        context => workspaceCaptureFixture(context, async f => {
            const current = await incident(f); await grant(f);
            const bridge = await f.admin.staffGradingBridgeControl.findUnique({ where: { id: 'active' } });
            const policy = { ...JSON.parse(bridge.policyCanonical), budgetEnforcement: 'ACCOUNTING_ONLY', maxTotalMicroUsd: 1, maxCardMicroUsd: 1 };
            const policyCanonical = canonical(policy);
            await f.admin.staffGradingBridgeControl.update({ where: { id: 'active' }, data: {
                policyCanonical, policyHash: digest(policyCanonical), revision: { increment: 1 } } });
            const before = await budget(f, current.run); assert(BigInt(before.card) > 1n);
            await f.service.control(f.signed.staff, f.ids[0], await input(f));
            assert.deepEqual(await budget(f, current.run), before);
            assert.equal((await projection(f)).unconfirmedCost.attempts, 1);
            const claim = await f.ledger.claim(current.run.id, randomUUID());
            const next = await f.request(claim.lease, 'inspect_region', current.crop), stepped = await f.apply(claim.lease, next);
            assert.equal(stepped.state, 'PAUSED'); await f.ledger.releasePause(stepped.lease);
            const paused = await row(f, current.run.id);
            await f.ledger.recordReceipt(current.request); assert.deepEqual(await row(f, current.run.id), paused);
            assert.equal((await projection(f)).unconfirmedCost.attempts, 0);
            assert.equal(f.calls(), 2); assert.equal(await f.admin.staffOperatorAttempt.count(), 2);
            assert.equal((await f.admin.staffOperatorAttempt.findUnique({ where: { id: current.request.attemptId } })).state, 'ABANDONED');
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
    try { await workspaceAttemptAbandonmentScenarios(scenario); } catch (error) { caught = error; }
    finally {
        await fixture.stop(); writeFileSync(join(fixture.directory, 'attempt-abandonment-result.json'), JSON.stringify({
            ok: !caught, results, error: caught ? fixture.safe(caught.stack) : null, stopped: true }, null, 2));
        console.log(JSON.stringify({ ok: !caught, passed: results.length, stopped: true, directory: fixture.directory }));
    }
    if (caught) { console.error(fixture.safe(caught.stack)); process.exitCode = 1; }
}
