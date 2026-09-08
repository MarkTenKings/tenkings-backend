import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '../.generated/staff-database/index.js';
import { makeIntakeConfig, ScopedSourceIntake, signIntakeRequest } from '@atlas/service-bridge/intake';
import { canonical, digest, requireBridge } from '@atlas/service-bridge/protocol';
import { StaffOperationsAuthority, makeOperationsAuthorityConfig } from '../lib/server/access/operations-authority.mjs';
import { StaffOperations } from '../lib/server/access/operations.mjs';
import { receiptSourceValidation, withSourceIntake } from '../lib/server/access/intake.mjs';

const instruction = () => ({ operationId: randomUUID(), reason: 'Explicit owned synthetic intake instruction.', authorizationEvidenceHash: 'a'.repeat(64) });
const recordKey = source => ({ sourceType_sourceId: { sourceType: source.sourceType, sourceId: source.sourceId } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

/** Existing disposable-postgres context only. No database creation/start or env
 * fallback. Synthetic public session uses an inert owner string, no User row. */
async function fixture(context, work) {
    const { admin, auth, config } = context;
    assert.equal(config.mode, 'LOCAL_FIXTURE');
    const policyHash = 'b'.repeat(64);
    await admin.staffControl.update({ where: { id: 'active' }, data: { gradingPolicyHash: policyHash, revision: { increment: 1 } } });
    const signed = await context.login(), control = await admin.staffControl.findUnique({ where: { id: 'active' } });
    const identity = await admin.staffIdentity.findUnique({ where: { id: signed.staff.id } }), now = new Date();
    const grant = await admin.staffOperationsGrant.create({ data: { id: randomUUID(), identityId: identity.id, accessVersion: identity.accessVersion,
        controlRevision: control.revision, mode: config.mode, origin: config.origin, deploymentId: config.deploymentId,
        releaseSha: config.releaseSha, configHash: config.configHash, authorizationEvidenceHash: 'a'.repeat(64),
        createdAt: new Date(+now - 1000), expiresAt: new Date(+now + 3600_000) } });
    const intakeConfig = makeIntakeConfig({ mode: 'LOCAL_FIXTURE', origin: 'https://intake-fixture.example.test',
        deploymentId: 'owned-source-intake-fixture', releaseSha: '0'.repeat(40), key: randomBytes(32),
        gradingPolicyHash: policyHash, otherKeyHashes: [], phoneAllowlistHash: digest(canonical([...config.phoneByHash.keys()].sort())) });
    const { key: _key, purpose: _purpose, phoneAllowlistHash: _phones, ...activation } = intakeConfig;
    await admin.staffIntakeControl.create({ data: { ...activation, enabled: true } });
    const source = { sourceType: 'LOCAL_FIXTURE', sourceId: `intake-source-${randomUUID()}`, sourceOwnerId: 'synthetic-intake-owner' };
    const revision = '2026-09-08T12:00:00.123Z';
    await admin.$executeRaw`INSERT INTO public."AiGraderV2Session"
        (id,"createdByUserId","cardProfile","workflowState","ruleVersion",identity,capture,"reviewedDefects","gradeReport","updatedAt")
        VALUES (${source.sourceId},${source.sourceOwnerId},'SPORTS','CAPTURED','owned-intake-fixture','{}','{}','[]','{}',
        (${revision}::timestamptz AT TIME ZONE 'UTC'))`;
    const state = { calls: 0, lastWritten: null, afterCall: null, beforeCall: null };
    // Capture the exact JS dates passed to the real SQL INSERT to detect the
    // Prisma/Pacific timestamp-without-zone conversion regression.
    const privateClient = { $transaction: (work, options) => admin.$transaction(tx => work(new Proxy(tx, { get(target, name) {
        if (name === '$executeRaw') return async (strings, ...values) => {
            if (strings.join('').includes('INSERT INTO atlas_staff."StaffSourceAdmission"'))
                state.lastWritten = { id: values[0], createdAt: new Date(values[17]), expiresAt: new Date(values[18]) };
            return target.$executeRaw(strings, ...values);
        };
        const value = Reflect.get(target, name, target); return typeof value === 'function' ? value.bind(target) : value;
    } })), options) };
    const descriptor = side => ({ sourceRef: `fixture/${source.sourceId}/${side}.svg`, contentType: 'image/svg+xml',
        sha256: digest(`explicit-intake-fixture-${side}`), byteCount: 123, width: 360, height: 504 });
    const ports = {
        async loadSource(tx, exact) {
            const rows = await tx.$queryRaw`SELECT id,"createdByUserId","workflowState","updatedAt" FROM public."AiGraderV2Session"
                WHERE id=${exact.sourceId} AND "createdByUserId"=${exact.sourceOwnerId} FOR SHARE`;
            requireBridge(rows.length === 1 && rows[0].workflowState === 'CAPTURED', 'SOURCE_NOT_CAPTURED'); return rows[0];
        },
        sourceEvidence: (row, sourceRevision) => ({ version: 'explicit-owned-intake-fixture-v1', sourceId: row.id,
            sourceOwnerId: row.createdByUserId, sourceRevision, sides: { FRONT: descriptor('FRONT'), BACK: descriptor('BACK') },
            originals: { FRONT: descriptor('FRONT'), BACK: descriptor('BACK') } }),
        assertSourceAdmission: () => requireBridge(config.mode === 'LOCAL_FIXTURE', 'FIXTURE_ONLY'),
        sourceAdmission: row => ({ preparationRelease: { fixture: 'explicit-owned-local-source-only' },
            frontAuthorityHash: digest(canonical({ id: row.id, revision: row.updatedAt.toISOString(), side: 'FRONT' })),
            backAuthorityHash: digest(canonical({ id: row.id, revision: row.updatedAt.toISOString(), side: 'BACK' })) }),
        sourceTitle: () => ({ title: 'Synthetic preserved intake card', subtitle: 'Owned local fixture — no production authority' }),
        isStaffPhoneAllowed: phoneHash => config.phoneByHash.has(phoneHash),
    };
    const bridge = new ScopedSourceIntake({ client: privateClient, config: intakeConfig, ports });
    const operationsClient = new PrismaClient({ datasources: { db: { url: context.db.operationsUrl } } });
    const authority = new StaffOperationsAuthority({ client: operationsClient, auth,
        config: makeOperationsAuthorityConfig({ databaseUrl: context.db.operationsUrl, staffConfig: config }) });
    const validation = receiptSourceValidation({ gradingPolicyHash: policyHash, bridgeConfigHash: intakeConfig.configHash });
    const operations = new StaffOperations({ admin: authority, sourceValidation: validation });
    const intake = { binding: { gradingPolicyHash: policyHash, bridgeConfigHash: intakeConfig.configHash }, async call(scope, exact) {
        state.calls++; if (state.beforeCall) await state.beforeCall();
        const request = signIntakeRequest(intakeConfig, scope, exact);
        const result = await bridge.receive(request.body, request.signature);
        if (state.afterCall) await state.afterCall(); return result;
    } };
    const facade = withSourceIntake({ operations, admin: authority, intake });
    const scope = () => authority.transaction(signed.staff, async ({ identity, session, control, operationsGrantId }) => ({
        actorId: identity.id, sessionHash: session.tokenHash, browserHash: session.browserHash, accessVersion: identity.accessVersion,
        controlRevision: control.revision, staffOrigin: control.origin, deploymentId: control.deploymentId, releaseSha: control.releaseSha,
        staffConfigHash: control.configHash, operationsGrantId }));
    const issue = async (exact = source, overrides = {}) => {
        const request = signIntakeRequest(intakeConfig, { ...await scope(), ...overrides }, exact);
        return bridge.receive(request.body, request.signature);
    };
    try { await work({ ...context, signed, control, grant, source, intakeConfig, bridge, ports, state, operationsClient,
        authority, validation, operations, facade, intake, scope, issue }); }
    finally { await operationsClient.$disconnect(); }
}

/** Lead harness: for (const {name,work} of intakeScenarios) await scenario(name,work). */
export const intakeScenarios = [
    { name: 'intake issues immutable exact UTC receipts then admits through the restricted operations role', work: context => fixture(context, async f => {
        const preview = await f.facade.previewIntake(f.signed.staff, f.source);
        const written = f.state.lastWritten, persisted = await f.admin.staffSourceAdmission.findUnique({ where: { id: written.id } });
        assert.equal(+persisted.createdAt, +written.createdAt); assert.equal(+persisted.expiresAt, +written.expiresAt);
        assert(persisted.expiresAt > new Date()); assert.equal(persisted.sourceRevision, '2026-09-08T12:00:00.123Z');
        assert.equal(preview.existingSpecimenId, null); assert.equal(preview.sourceOwnerId, f.source.sourceOwnerId);
        const input = { ...instruction(), source: f.source, sourceBindingHash: preview.sourceBindingHash };
        const receipt = await f.facade.admitIntake(f.signed.staff, input);
        const card = await f.admin.staffSpecimen.findUnique({ where: { id: receipt.specimenId } });
        assert.equal(card.evidenceHash, preview.evidenceHash); assert.equal(card.sourceOwnerId, f.source.sourceOwnerId);
        assert.equal(card.analysisRevision, 0); assert.equal(await f.admin.staffReviewRevision.count({ where: { specimenId: card.id } }), 1);
        const audit = await f.admin.staffAudit.findFirst({ where: { event: 'SPECIMEN_INTAKE_ADMITTED', actorId: f.signed.staff.id } });
        assert.equal(JSON.parse(audit.details).operationsGrantId, f.grant.id);
        await assert.rejects(() => f.admin.staffSourceAdmission.update({ where: { id: written.id }, data: { title: 'changed' } }));
        await assert.rejects(() => f.operationsClient.staffSourceAdmission.create({ data: { ...persisted, id: randomUUID() } }));
        await assert.rejects(() => f.client.staffSourceAdmission.findMany());
    }) },
    { name: 'intake rejects wrong source owner, browser and disabled or mismatched intake configuration', work: context => fixture(context, async f => {
        await assert.rejects(() => f.issue({ ...f.source, sourceOwnerId: 'wrong-owner' }), /SOURCE_NOT_CAPTURED/);
        await assert.rejects(() => f.issue(f.source, { browserHash: 'f'.repeat(64) }), /FRESH_HUMAN_OPERATIONS_REQUIRED/);
        await f.admin.staffIntakeControl.update({ where: { id: 'active' }, data: { configHash: 'c'.repeat(64), revision: { increment: 1 } } });
        await assert.rejects(() => f.issue(), /INTAKE_NOT_ENABLED/);
        await f.admin.staffIntakeControl.update({ where: { id: 'active' }, data: { configHash: f.intakeConfig.configHash, enabled: false, revision: { increment: 1 } } });
        await assert.rejects(() => f.issue(), /INTAKE_NOT_ENABLED/);
        assert.equal(await f.admin.staffSourceAdmission.count(), 0);
    }) },
    { name: 'expired immutable intake receipts are excluded by the actual definer', work: context => fixture(context, async f => {
        const result = await f.issue();
        const issued = await f.admin.staffSourceAdmission.findUnique({ where: { id: result.receiptId } });
        const expiredSource = { ...f.source, sourceId: `expired-${randomUUID()}` };
        await f.admin.staffSourceAdmission.create({ data: { ...issued, id: randomUUID(), ...expiredSource,
            createdAt: new Date(Date.now() - 120_000), expiresAt: new Date(Date.now() - 60_000) } });
        await assert.rejects(() => f.operations.previewIntake(f.signed.staff, expiredSource), /INTAKE_PREFLIGHT_REQUIRED/);
    }) },
    { name: 'source mutation after reviewed preflight changes the exact admission binding', work: context => fixture(context, async f => {
        const preview = await f.facade.previewIntake(f.signed.staff, f.source);
        await f.admin.$executeRaw`UPDATE public."AiGraderV2Session" SET "updatedAt"="updatedAt"+interval '1 second' WHERE id=${f.source.sourceId}`;
        await assert.rejects(() => f.facade.admitIntake(f.signed.staff, { ...instruction(), source: f.source,
            sourceBindingHash: preview.sourceBindingHash }), /INTAKE_SOURCE_CHANGED/);
        assert.equal(await f.admin.staffSpecimen.findUnique({ where: recordKey(f.source) }), null);
        assert.equal(await f.admin.staffAudit.count({ where: { event: 'SPECIMEN_INTAKE_ADMITTED' } }), 0);
    }) },
    { name: 'real audit rejection rolls back the admitted specimen and review rows', work: context => fixture(context, async f => {
        const preview = await f.facade.previewIntake(f.signed.staff, f.source);
        const beforeCards = await f.admin.staffSpecimen.count(), beforeReviews = await f.admin.staffReviewRevision.count();
        // Corrupt only the audit write at the test seam. PostgreSQL's actual
        // current-grant audit trigger must reject after the card/review INSERTs.
        const failingAuthority = { transaction: (staff, work) => f.authority.transaction(staff, c => work({ ...c,
            tx: new Proxy(c.tx, { get(target, name) {
                if (name === 'staffAudit') return { findUnique: args => target.staffAudit.findUnique(args), async create({ data }) {
                    const details = JSON.parse(data.details); details.operationsGrantId = randomUUID();
                    return target.staffAudit.create({ data: { ...data, details: canonical(details) } });
                } };
                const value = Reflect.get(target, name, target); return typeof value === 'function' ? value.bind(target) : value;
            } }),
        })) };
        const failing = new StaffOperations({ admin: failingAuthority, sourceValidation: f.validation });
        await assert.rejects(() => failing.admitIntake(f.signed.staff, { ...instruction(), source: f.source,
            sourceBindingHash: preview.sourceBindingHash }), /current human capability/);
        assert.equal(await f.admin.staffSpecimen.count(), beforeCards); assert.equal(await f.admin.staffReviewRevision.count(), beforeReviews);
        assert.equal(await f.admin.staffAudit.count({ where: { event: 'SPECIMEN_INTAKE_ADMITTED' } }), 0);
    }) },
    { name: 'lost intake admission reply recovers the immutable audit without a private source call', work: context => fixture(context, async f => {
        const preview = await f.facade.previewIntake(f.signed.staff, f.source);
        const input = { ...instruction(), source: f.source, sourceBindingHash: preview.sourceBindingHash };
        const receipt = await f.facade.admitIntake(f.signed.staff, input), calls = f.state.calls;
        f.state.beforeCall = () => { throw new Error('Private source is now unavailable'); };
        assert.deepEqual(await f.facade.admitIntake(f.signed.staff, input), receipt); assert.equal(f.state.calls, calls);
        await assert.rejects(() => f.facade.admitIntake(f.signed.staff, { ...input, reason: 'Different authorized action.' }), /OPERATIONS_REQUEST_CONFLICT/);
        await f.admin.staffOperationsGrant.update({ where: { id: f.grant.id }, data: { revokedAt: new Date() } });
        await assert.rejects(() => f.facade.admitIntake(f.signed.staff, input), /FRESH_HUMAN_OPERATIONS_REQUIRED/);
    }) },
    { name: 'operations revocation between private preflight and admission prevents any card mutation', work: context => fixture(context, async f => {
        const preview = await f.facade.previewIntake(f.signed.staff, f.source);
        f.state.afterCall = () => f.admin.staffOperationsGrant.update({ where: { id: f.grant.id }, data: { revokedAt: new Date() } });
        await assert.rejects(() => f.facade.admitIntake(f.signed.staff, { ...instruction(), source: f.source,
            sourceBindingHash: preview.sourceBindingHash }), /FRESH_HUMAN_OPERATIONS_REQUIRED/);
        assert.equal(await f.admin.staffSpecimen.findUnique({ where: recordKey(f.source) }), null);
        assert.equal(await f.admin.staffAudit.count({ where: { event: 'SPECIMEN_INTAKE_ADMITTED' } }), 0);
    }) },
    { name: 'production receipt definer retains the actual public source lock and excludes owner or revision drift', work: context => fixture(context, async f => {
        const issued = await f.issue(), row = await f.admin.staffSourceAdmission.findUnique({ where: { id: issued.receiptId } });
        // Direct SQL boundary fixture only: no promotion of local auth or ports
        // into production. The real operations credential calls its exact definer.
        const current = await f.admin.staffControl.update({ where: { id: 'active' }, data: { mode: 'PRODUCTION',
            origin: 'https://app.atlasgrading.com', deploymentId: 'synthetic-sql-scope.vercel.app', releaseSha: 'd'.repeat(40), revision: { increment: 1 } } });
        await f.admin.staffIntakeControl.update({ where: { id: 'active' }, data: { mode: 'PRODUCTION',
            deploymentId: 'synthetic-intake-sql-scope.vercel.app', releaseSha: 'e'.repeat(40), revision: { increment: 1 } } });
        const receipt = await f.admin.staffSourceAdmission.create({ data: { ...row, id: randomUUID(), sourceType: 'SPEEDSTER', controlRevision: current.revision } });
        const locked = deferred(), release = deferred();
        const pending = f.operationsClient.$transaction(async tx => {
            const rows = await tx.$queryRaw`SELECT * FROM atlas_staff.lock_source_admissions(${row.actorId}::uuid,${row.sessionHash},
                ${row.operationsGrantId}::uuid,'SPEEDSTER',${row.sourceId},${row.sourceOwnerId})`;
            assert.equal(rows.length, 1); assert.equal(rows[0].id, receipt.id); locked.resolve(); await release.promise;
        }, { timeout: 5000 });
        // Ensure an early query/constraint failure cannot leave the test waiting.
        await Promise.race([locked.promise, pending.then(() => { throw new Error('Lock transaction ended too early'); })]);
        try {
            await assert.rejects(() => f.admin.$transaction(async tx => {
                await tx.$executeRaw`SET LOCAL lock_timeout='250ms'`;
                await tx.$executeRaw`UPDATE public."AiGraderV2Session" SET "updatedAt"="updatedAt"+interval '1 second' WHERE id=${row.sourceId}`;
            }), /lock timeout/);
        } finally { release.resolve(); await pending; }
        const wrongOwner = await f.operationsClient.$queryRaw`SELECT * FROM atlas_staff.lock_source_admissions(${row.actorId}::uuid,${row.sessionHash},
            ${row.operationsGrantId}::uuid,'SPEEDSTER',${row.sourceId},'wrong-owner')`;
        assert.equal(wrongOwner.length, 0);
        await f.admin.$executeRaw`UPDATE public."AiGraderV2Session" SET "updatedAt"="updatedAt"+interval '1 second' WHERE id=${row.sourceId}`;
        const stale = await f.operationsClient.$queryRaw`SELECT * FROM atlas_staff.lock_source_admissions(${row.actorId}::uuid,${row.sessionHash},
            ${row.operationsGrantId}::uuid,'SPEEDSTER',${row.sourceId},${row.sourceOwnerId})`;
        assert.equal(stale.length, 0);
        await assert.rejects(() => f.operationsClient.$queryRaw`SELECT * FROM public."AiGraderV2Session" WHERE id=${row.sourceId}`);
    }) },
];
