#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { PrismaClient } from '../.generated/staff-database/index.js';
import { disposablePostgres } from './disposable-postgres.mjs';
import { localAccessConfig, seedLocalStaff, fixtureEvidence, fixtureVerifyProvider } from '../lib/server/access/fixture.mjs';
import { DurableStaffAuth } from '../lib/server/access/auth.mjs';
import { StaffDatabase } from '../lib/server/access/database.mjs';
import { DurableReviewStore } from '../lib/server/access/review.mjs';
import { StaffReports } from '../lib/server/access/reports.mjs';
import { PublicReportReader } from '../../atlas-public/lib/server/reader.mjs';
import { makePublicConfig, LOCAL_ORIGIN as PUBLIC_LOCAL_ORIGIN } from '../../atlas-public/lib/server/policy.mjs';
import { parsePublicReport } from '@atlas/report-view/public-contract';
import { fixtureArtwork } from '@atlas/report-view/fixture-artwork';
import { decodeSpeedsterTraceBitmapWireV1 } from '@atlas/grading-core/trace-bitmap-wire';
import { canonical } from '../lib/server/review-contract.mjs';
import { hash } from '../lib/server/policy.mjs';
import { bridgeFixture, gradingInput } from './bridge-fixture.mjs';
import { operatorScenarios } from './operator-fixture.mjs';
import { workspaceOperatorScenarios } from './workspace-operator-fixture.mjs';
import { workspaceCaptureScenarios } from './workspace-capture-fixture.mjs';
import { workspaceCaptureReadinessScenarios } from './workspace-capture-readiness-fixture.mjs';
import { workspaceIdentificationScenarios } from './workspace-identification-fixture.mjs';
import { workspaceCornerShapeScenarios } from './workspace-corner-shape-fixture.mjs';
import { workspaceTimingScenarios } from './workspace-timing-fixture.mjs';
import { workspaceReceiptRecoveryScenarios } from './workspace-receipt-recovery-fixture.mjs';
import { workspaceAttemptAbandonmentScenarios } from './workspace-attempt-abandonment-fixture.mjs';
import { workspaceReleaseAdoptionScenarios } from './workspace-release-adoption-fixture.mjs';
import { processingDollarLimitsScenarios } from './processing-dollar-limits-fixture.mjs';
import { workspaceSourceScenarios } from './workspace-source-fixture.mjs';
import { workspacePrivilegeScenarios } from './workspace-privileges-fixture.mjs';
import { workspaceDispatcherScenarios } from '../../../packages/atlas-operator/test/workspace-dispatcher-postgres.mjs';
import { machineAdapterScenarios } from './machine-adapter-fixture.mjs';
import { operationsScenarios } from './operations-fixture.mjs';
import { intakeScenarios } from './intake-fixture.mjs';
import { machineInitializationScenarios } from './machine-initialization-fixture.mjs';
import { finishingScenarios } from './finishing-fixture.mjs';
import { resolutionScenarios } from './resolution-fixture.mjs';
import { learningScenarios } from './learning-fixture.mjs';
import { identityCorrectionScenarios } from './identity-correction-fixture.mjs';
import { adminPathScenarios } from './admin-path-fixture.mjs';
import { customerScenarios } from '../../atlas-customer/scripts/postgres-scenarios.mjs';
import { trackingRegressionScenarios } from '../../atlas-customer/scripts/tracking-regression.mjs';
import { smsPilotScenarios } from '../../atlas-customer/scripts/sms-pilot-regression.mjs';
import { smsTestLimitsScenarios } from './sms-test-limits-fixture.mjs';

// Execute the original pure TypeScript classifier in the fixture. No substitute
// normalization/scoring code or private runtime activation is used here.
const privateRequire = createRequire(new URL('../../nextjs-app/package.json', import.meta.url));
const { tsImport } = await import(pathToFileURL(privateRequire.resolve('tsx/esm/api')).href);
const { classifyAtlasIdentityCorrection } = await tsImport('../../nextjs-app/lib/server/atlasIdentityCorrection.ts', import.meta.url);

const fixture = await disposablePostgres(process.argv.slice(2));
const results = [], clients = new Set();
const check = (code, action) => assert.rejects(async () => action(), error => error.code === code, code);
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
async function scenario(name, work, { emptyRoster = false, analyses = false, trained = false, traces = false } = {}) {
    const db = await fixture.database();
    const admin = new PrismaClient({ datasources: { db: { url: db.adminUrl } } });
    const client = new PrismaClient({ datasources: { db: { url: db.staffUrl } } });
    clients.add(admin); clients.add(client);
    const config = localAccessConfig({ databaseUrl: db.staffUrl, sessionKey: randomBytes(32), phoneKey: randomBytes(32) });
    const identities = await seedLocalStaff(admin, config, { identities: !emptyRoster, analyses, trained, traces });
    const makeAuth = (provider = fixtureVerifyProvider(config)) => new DurableStaffAuth({ config, database: new StaffDatabase(client, config), provider });
    const auth = makeAuth();
    const casesql = (sql, values) => fixture.sql(sql, values, db.name);
    async function begin(whichAuth = auth, phone = '+12025550141') {
        const boot = await whichAuth.bootstrap(undefined, 'test-client');
        const cookie = `${config.cookies.browser}=${boot.browserToken}`;
        const requestId = randomUUID();
        const challenge = await whichAuth.send(cookie, boot.csrf, { phone, requestId }, 'test-client');
        return { boot, cookie, requestId, phone, challenge };
    }
    async function login(whichAuth = auth, phone) {
        const context = await begin(whichAuth, phone);
        const result = await whichAuth.verify(context.cookie, context.boot.csrf, { challengeId: context.challenge.challengeId, code: '424242' }, 'test-client');
        return { ...context, ...result, cookie: `${context.cookie}; ${config.cookies.session}=${result.token}` };
    }
    try {
        await work({ db, admin, client, config, identities, auth, makeAuth, sql: casesql, begin, login });
        results.push({ name, ok: true }); console.log(`PASS ${name}`);
    } catch (error) {
        results.push({ name, ok: false, error: fixture.safe(error.message) }); throw error;
    } finally { await admin.$disconnect(); await client.$disconnect(); clients.delete(admin); clients.delete(client); await db.dispose(); }
}
const draft = (card, change = {}) => ({ operationId: randomUUID(), expectedRevision: card.draft.revision,
    evidenceRevision: card.evidenceRevision, evidenceHash: card.evidenceHash, observations: { FRONT: 'Check this edge.', BACK: '' },
    reviewedSides: [], identityReviewed: false, disposition: 'IN_REVIEW', ...change });

const approvalInput = card => ({ operationId: randomUUID(), expectedAnalysisRevision: card.grading.analysisRevision,
    analysisHash: card.grading.analysisHash, expectedReviewRevision: card.draft.revision,
    reviewHash: card.reviewHash, evidenceHash: card.evidenceHash });
async function readyReport(context) {
    const signed = await context.login();
    const review = new DurableReviewStore({ auth: context.auth, evidence: fixtureEvidence() });
    const reports = new StaffReports({ auth: context.auth, review });
    const cards = await review.list(signed.staff);
    const card = await review.read(signed.staff, cards.find(c => c.evidenceComplete).id);
    const ready = await review.save(signed.staff, card.id, draft(card, { disposition: 'READY_FOR_HUMAN', reviewedSides: ['FRONT', 'BACK'], identityReviewed: true }));
    return { signed, review, reports, ready };
}

async function withPublicReader(context, work) {
    const config = makePublicConfig({ mode: 'LOCAL_FIXTURE', origin: PUBLIC_LOCAL_ORIGIN, deploymentId: 'local-public-fixture',
        releaseSha: '0'.repeat(40), databaseUrl: context.db.publicUrl });
    const { databaseUrl, ...activation } = config;
    await context.admin.publicReaderControl.create({ data: { ...activation, enabled: true } });
    const client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try { await work({ client, config, reader: new PublicReportReader(client, config,
        { async read(_reference, descriptor) { return fixtureArtwork(descriptor.sourceRef); } }) }); }
    finally { await client.$disconnect(); }
}

let error;
try {
    await scenario('first allowed login creates only an untrained staff identity', async ({ login, admin }) => {
        assert.equal(await admin.staffIdentity.count(), 0);
        const signed = await login();
        const identity = await admin.staffIdentity.findUnique({ where: { id: signed.staff.id } });
        assert.equal(identity.role, 'REVIEWER'); assert.equal(identity.certificationUntil, null);
        assert.equal(identity.trustedLearningUntil, null); assert.equal(await admin.staffIdentity.count(), 1);
    }, { emptyRoster: true });
    await scenario('durable session, review history and exact evidence survive fresh clients', async ({ auth, login, config, db, client }) => {
        const signed = await login();
        const review = new DurableReviewStore({ auth, evidence: fixtureEvidence() });
        const cards = await review.list(signed.staff); assert.equal(cards.length, 3);
        const card = await review.read(signed.staff, cards.find(c => c.evidenceComplete).id);
        const updated = await review.save(signed.staff, card.id, draft(card)); assert.equal(updated.draft.revision, 2);
        const asset = await review.asset(signed.staff, card.id, 'FRONT'); assert.match(asset.contentType, /svg/);
        assert.equal(hash(asset.bytes), card.sides[0].sha256);
        await client.$disconnect();
        const freshClient = new PrismaClient({ datasources: { db: { url: db.staffUrl } } }); clients.add(freshClient);
        try {
            const fresh = new DurableStaffAuth({ database: new StaffDatabase(freshClient, config), config, provider: { start() { throw Error('Unexpected dispatch'); }, check() { throw Error('Unexpected dispatch'); } } });
            const staff = await fresh.authenticate(signed.cookie, signed.csrf);
            const restored = await new DurableReviewStore({ auth: fresh, evidence: fixtureEvidence() }).read(staff, card.id);
            assert.deepEqual(restored.draft, updated.draft); assert.equal(restored.history.length, 1);
        } finally { await freshClient.$disconnect(); clients.delete(freshClient); }
    });
    await scenario('lost verification reply replays one exact session; logout defeats replay', async ({ auth, begin, admin }) => {
        const b = await begin(); const input = { challengeId: b.challenge.challengeId, code: '424242' };
        const first = await auth.verify(b.cookie, b.boot.csrf, input, 'test');
        const again = await auth.verify(b.cookie, b.boot.csrf, input, 'test'); assert.equal(first.token, again.token);
        assert.equal(await admin.staffSession.count(), 1);
        await auth.logout(`${b.cookie}; atlas_local_staff=${first.token}`, first.csrf);
        await check('CODE_NOT_ACCEPTED', () => auth.verify(b.cookie, b.boot.csrf, input, 'test'));
    });
    await scenario('durable send claims prevent duplicate calls and changed-request reuse', async ({ makeAuth, config, admin }) => {
        const hold = deferred(), entered = deferred(), transport = fixtureVerifyProvider(config); let count = 0;
        const provider = { ...transport, async start(phone) { count++; entered.resolve(); await hold.promise; return transport.start(phone); } };
        const auth = makeAuth(provider), boot = await auth.bootstrap(undefined, 'test');
        const cookie = `atlas_local_browser=${boot.browserToken}`, input = { phone: '+12025550141', requestId: randomUUID() };
        const first = auth.send(cookie, boot.csrf, input, 'test'); await entered.promise;
        await check('SIGN_IN_RESTART_REQUIRED', () => makeAuth(provider).send(cookie, boot.csrf, input, 'test'));
        assert.equal((await admin.staffChallenge.findFirst()).state, 'SENDING');
        hold.resolve(); const result = await first;
        assert.deepEqual(await makeAuth(provider).send(cookie, boot.csrf, input, 'test'), result); assert.equal(count, 1);
        await check('REQUEST_CONFLICT', () => auth.send(cookie, boot.csrf, { ...input, phone: '+12025550142' }, 'test'));
    });
    await scenario('concurrent checks claim once and persist the approved result', async ({ makeAuth, config, begin, admin }) => {
        const hold = deferred(), entered = deferred(), transport = fixtureVerifyProvider(config); let count = 0;
        const provider = { ...transport, async check(sid, code) { count++; entered.resolve(); await hold.promise; return transport.check(sid, code); } };
        const auth = makeAuth(provider), b = await begin(auth), input = { challengeId: b.challenge.challengeId, code: '424242' };
        const first = auth.verify(b.cookie, b.boot.csrf, input, 'test'); await entered.promise;
        await check('CODE_NOT_ACCEPTED', () => makeAuth(provider).verify(b.cookie, b.boot.csrf, input, 'test'));
        hold.resolve(); const signed = await first; assert(signed.staff); assert.equal(count, 1);
        assert.equal(await admin.staffSession.count(), 1); assert.equal((await admin.staffChallenge.findFirst()).attempts, 1);
    });
    await scenario('five wrong-code attempts remain spent after auth recreation', async ({ auth, begin, makeAuth, admin }) => {
        const b = await begin(); const input = { challengeId: b.challenge.challengeId, code: '000000' };
        for (let i = 0; i < 5; i++) await check('CODE_NOT_ACCEPTED', () => auth.verify(b.cookie, b.boot.csrf, input, 'test'));
        let called = false;
        await check('CODE_NOT_ACCEPTED', () => makeAuth({ async check() { called = true; } }).verify(b.cookie, b.boot.csrf, { ...input, code: '424242' }, 'test'));
        assert.equal(called, false); assert.equal((await admin.staffChallenge.findFirst()).attempts, 5);
    });
    await scenario('unknown send/check outcomes remain quarantined across processes', async ({ makeAuth, begin, config, admin }) => {
        const transport = fixtureVerifyProvider(config); let sends = 0;
        const auth = makeAuth({ ...transport, async start() { sends++; throw Error('lost response'); } });
        const boot = await auth.bootstrap(undefined, 'test'), cookie = `atlas_local_browser=${boot.browserToken}`;
        await check('SIGN_IN_RESTART_REQUIRED', () => auth.send(cookie, boot.csrf, { phone: '+12025550141', requestId: randomUUID() }, 'test'));
        await check('SIGN_IN_RESTART_REQUIRED', () => makeAuth().send(cookie, boot.csrf, { phone: '+12025550141', requestId: randomUUID() }, 'test'));
        assert.equal(sends, 1);
        const second = makeAuth({ ...transport, async check() { throw Error('lost reply'); } });
        const b = await begin(second, '+12025550142');
        await check('SIGN_IN_RESTART_REQUIRED', () => second.verify(b.cookie, b.boot.csrf, { challengeId: b.challenge.challengeId, code: '424242' }, 'test'));
        assert.equal(await admin.staffChallenge.count({ where: { state: 'UNKNOWN' } }), 2); assert.equal(await admin.staffSession.count(), 0);
    });
    for (const field of ['accountSid', 'serviceSid', 'verificationSid', 'phone', 'channel', 'status']) {
        await scenario(`provider substitution denied: ${field}`, async ({ makeAuth, config, begin, admin }) => {
            const transport = fixtureVerifyProvider(config);
            const auth = makeAuth({ ...transport, async check(sid, code) { return { ...await transport.check(sid, code), [field]: 'substituted' }; } });
            const b = await begin(auth);
            await check('SIGN_IN_RESTART_REQUIRED', () => auth.verify(b.cookie, b.boot.csrf, { challengeId: b.challenge.challengeId, code: '424242' }, 'test'));
            assert.equal(await admin.staffSession.count(), 0); assert.equal((await admin.staffChallenge.findFirst()).state, 'UNKNOWN');
        });
    }
    await scenario('current access, browser binding and actor provenance gate every operation', async ({ auth, login, admin, identities }) => {
        const signed = await login(); const review = new DurableReviewStore({ auth, evidence: fixtureEvidence() });
        await check('SIGN_IN_REQUIRED', () => review.list({ ...signed.staff }));
        const other = await auth.bootstrap(undefined, 'other');
        assert.equal(await auth.maybeAuthenticate(`atlas_local_browser=${other.browserToken}; atlas_local_staff=${signed.token}`), null);
        await admin.staffIdentity.update({ where: { id: identities[0].id }, data: { revokedAt: new Date(), accessVersion: { increment: 1 } } });
        await check('SIGN_IN_REQUIRED', () => review.list(signed.staff)); assert.equal(await auth.maybeAuthenticate(signed.cookie), null);
    });
    await scenario('revocation during provider verification prevents late session issuance', async ({ makeAuth, config, begin, admin, identities }) => {
        const transport = fixtureVerifyProvider(config);
        const auth = makeAuth({ ...transport, async check(sid, code) {
            await admin.staffIdentity.update({ where: { id: identities[0].id }, data: { revokedAt: new Date(), accessVersion: { increment: 1 } } });
            return transport.check(sid, code);
        } });
        const b = await begin(auth);
        await check('CODE_NOT_ACCEPTED', () => auth.verify(b.cookie, b.boot.csrf, { challengeId: b.challenge.challengeId, code: '424242' }, 'test'));
        assert.equal(await admin.staffSession.count(), 0);
    });
    await scenario('activation switch and old deployment invalidate retained authority', async ({ auth, login, admin, config, client }) => {
        const signed = await login();
        const old = new DurableStaffAuth({ config: { ...config, deploymentId: 'old-deployment' }, database: new StaffDatabase(client, { ...config, deploymentId: 'old-deployment' }) });
        await check('STAFF_ACCESS_NOT_ENABLED', () => old.maybeAuthenticate(signed.cookie));
        await admin.staffControl.update({ where: { id: 'active' }, data: { revision: { increment: 1 } } });
        assert.equal(await auth.maybeAuthenticate(signed.cookie), null);
        await admin.staffControl.update({ where: { id: 'active' }, data: { enabled: false, revision: { increment: 1 } } });
        await check('STAFF_ACCESS_NOT_ENABLED', () => auth.bootstrap(undefined, 'test'));
    });
    await scenario('serving role cannot activate, assign, self-train or access legacy cards', async ({ client, auth, sql }) => {
        for (const query of [
            'UPDATE atlas_staff."StaffControl" SET enabled=true,revision=revision+1',
            'UPDATE atlas_staff."StaffIdentity" SET "certificationUntil"=now(),"accessVersion"="accessVersion"+1',
            'UPDATE atlas_staff."StaffAssignment" SET "canReview"=true,fence=fence+1',
            'SELECT * FROM public."User"', 'SELECT * FROM public."CollectibleCardV2"',
            'DELETE FROM atlas_staff."StaffAudit"', 'TRUNCATE atlas_staff."StaffReviewRevision"',
        ]) await assert.rejects(() => client.$executeRawUnsafe(query));
        await sql('GRANT SELECT ON public."User" TO atlas_fixture_staff');
        await check('STAFF_DATABASE_ROLE_INVALID', () => auth.bootstrap(undefined, 'test'));
    });
    await scenario('review CAS, idempotency, complete checklist and observer/assignment rules', async ({ auth, login, admin, identities }) => {
        const signed = await login(), observer = await login(auth, '+12025550142');
        const review = new DurableReviewStore({ auth, evidence: fixtureEvidence() });
        const observerCards = await review.list(observer.staff); assert.equal(observerCards.length, 1);
        const card = await review.read(signed.staff, observerCards[0].id);
        await check('REVIEW_PERMISSION_REQUIRED', () => review.save(observer.staff, card.id, draft(card)));
        const input = draft(card), race = await Promise.allSettled([review.save(signed.staff, card.id, input), review.save(signed.staff, card.id, draft(card))]);
        assert.equal(race.filter(r => r.status === 'fulfilled').length, 1);
        assert.equal(race.find(r => r.status === 'rejected').reason.code, 'DRAFT_CHANGED');
        const updated = await review.read(signed.staff, card.id); assert.equal(updated.draft.revision, 2);
        if (race[0].status === 'fulfilled') assert.equal((await review.save(signed.staff, card.id, input)).draft.revision, 2);
        await check('REVIEW_CHECKLIST_REQUIRED', () => review.save(signed.staff, card.id, draft(updated, { disposition: 'READY_FOR_HUMAN' })));
        const ready = await review.save(signed.staff, card.id, draft(updated, { disposition: 'READY_FOR_HUMAN', identityReviewed: true, reviewedSides: ['FRONT', 'BACK'] }));
        assert.equal(ready.history.length, 2);
        await admin.staffAssignment.update({ where: { specimenId_identityId: { specimenId: card.id, identityId: identities[0].id } }, data: { revokedAt: new Date(), fence: { increment: 1 } } });
        await check('CARD_NOT_FOUND', () => review.read(signed.staff, card.id));
        await check('CARD_NOT_FOUND', () => review.save(signed.staff, card.id, draft(ready)));
    });
    await scenario('evidence byte mismatch and in-flight assignment revocation fail closed', async ({ auth, login, admin, identities }) => {
        const signed = await login(), normal = new DurableReviewStore({ auth, evidence: fixtureEvidence() });
        const card = (await normal.list(signed.staff)).find(c => c.evidenceComplete);
        const bad = new DurableReviewStore({ auth, evidence: { async read() { return Buffer.from('wrong bytes'); } } });
        await check('EVIDENCE_UNAVAILABLE', () => bad.asset(signed.staff, card.id, 'FRONT'));
        const revoking = new DurableReviewStore({ auth, evidence: { async read(binding) {
            await admin.staffAssignment.update({ where: { specimenId_identityId: { specimenId: card.id, identityId: identities[0].id } }, data: { revokedAt: new Date(), fence: { increment: 1 } } });
            return fixtureEvidence().read(binding);
        } } });
        await check('CARD_NOT_FOUND', () => revoking.asset(signed.staff, card.id, 'FRONT'));
    });
    await scenario('audit failure rolls back review head, immutable history and idempotency', async ({ auth, login, admin, sql }) => {
        const signed = await login(), review = new DurableReviewStore({ auth, evidence: fixtureEvidence() });
        const card = await review.read(signed.staff, (await review.list(signed.staff))[0].id);
        await sql(`CREATE FUNCTION atlas_staff.fixture_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected audit failure'; END; $$;
          CREATE TRIGGER fixture_reject_audit BEFORE INSERT ON atlas_staff."StaffAudit" FOR EACH ROW EXECUTE FUNCTION atlas_staff.fixture_reject_audit()`);
        await assert.rejects(() => review.save(signed.staff, card.id, draft(card)));
        assert.equal((await admin.staffSpecimen.findUnique({ where: { id: card.id } })).draftRevision, 1);
        assert.equal(await admin.staffReviewRevision.count({ where: { specimenId: card.id } }), 1);
        assert.equal(await admin.staffOperation.count(), 0);
    });
    await scenario('SQL rejects orphan heads, history replacement and partial session issuance', async ({ admin, sql, begin, identities }) => {
        const card = await admin.staffSpecimen.findFirst(), revision = await admin.staffReviewRevision.findFirst({ where: { specimenId: card.id } });
        await assert.rejects(() => admin.$transaction(async tx => {
            const content = canonical({ ...JSON.parse(revision.canonical), revision: 99 });
            await tx.staffReviewRevision.create({ data: { ...revision, revision: 99, canonical: content, contentHash: hash(content) } });
            await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
        }));
        await assert.rejects(() => admin.$transaction(async tx => {
            await tx.staffSpecimen.update({ where: { id: card.id }, data: { draftRevision: 2 } });
            await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
        }));
        await assert.rejects(() => admin.staffReviewRevision.update({ where: { specimenId_revision: { specimenId: card.id, revision: 1 } }, data: { savedById: randomUUID() } }));
        await assert.rejects(() => sql('TRUNCATE atlas_staff."StaffReviewRevision" CASCADE'));
        assert.equal((await admin.staffSpecimen.findUnique({ where: { id: card.id } })).draftRevision, 1);
        const b = await begin(); const challenge = await admin.staffChallenge.findUnique({ where: { id: b.challenge.challengeId } });
        const now = new Date();
        await assert.rejects(() => admin.$transaction(async tx => {
            await tx.staffSession.create({ data: { tokenHash: hash(randomBytes(32)), identityId: identities[0].id,
                browserHash: challenge.browserHash, challengeId: challenge.id, controlRevision: challenge.controlRevision,
                accessVersion: 1, createdAt: now, expiresAt: new Date(+now + 60_000) } });
            await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
        }));
        await assert.rejects(() => admin.$transaction(async tx => {
            await tx.staffChallenge.update({ where: { id: challenge.id }, data: { state: 'CHECKING', checkClaimId: randomUUID(), attempts: 1 } });
            await tx.staffChallenge.update({ where: { id: challenge.id }, data: { state: 'CONSUMED', consumedAt: now,
                replayHash: hash(randomBytes(32)), replayUntil: new Date(+now + 30_000) } });
            await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
        }));
        assert.equal((await admin.staffChallenge.findUnique({ where: { id: challenge.id } })).state, 'PENDING');
        assert.equal(await admin.staffSession.count(), 0);
    });
    await scenario('expired challenge, browser and session cannot restore access', async ({ auth, admin, config }) => {
        const createdAt = new Date(Date.now() - 4 * 60_000), consumedAt = new Date(+createdAt + 1000);
        const token = randomBytes(32).toString('base64url'), browserToken = randomBytes(32).toString('base64url');
        const identity = await admin.staffIdentity.findFirst();
        const browserHash = hash(browserToken), id = randomBytes(32).toString('base64url');
        await admin.$transaction(async tx => {
            await tx.staffBrowser.create({ data: { tokenHash: browserHash, controlRevision: 1, createdAt, expiresAt: new Date(Date.now() + 60_000) } });
            await tx.staffChallenge.create({ data: { id, browserHash, requestId: randomUUID(), phoneHash: identity.phoneHash,
                controlRevision: 1, accountSid: config.accountSid, serviceSid: config.serviceSid, sendClaimId: randomUUID(), state: 'SENDING',
                createdAt, expiresAt: new Date(+createdAt + 3 * 60_000), quarantineUntil: new Date(+createdAt + 10 * 60_000) } });
            await tx.staffChallenge.update({ where: { id }, data: { state: 'PENDING', verificationSid: `VE${'3'.repeat(32)}` } });
            await tx.staffChallenge.update({ where: { id }, data: { state: 'CHECKING', checkClaimId: randomUUID(), attempts: 1 } });
            await tx.staffSession.create({ data: { tokenHash: hash(token), identityId: identity.id, browserHash, challengeId: id,
                controlRevision: 1, accessVersion: 1, createdAt: consumedAt, expiresAt: new Date(+consumedAt + 60_000) } });
            await tx.staffChallenge.update({ where: { id }, data: { state: 'CONSUMED', consumedAt, replayHash: hash(randomBytes(32)), replayUntil: new Date(+consumedAt + 30_000) } });
            await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
        });
        const cookie = `atlas_local_browser=${browserToken}; atlas_local_staff=${token}`;
        assert.equal(await auth.maybeAuthenticate(cookie), null);
        await check('CODE_NOT_ACCEPTED', () => auth.verify(cookie, auth.digest(`browser:${browserToken}`), { challengeId: id, code: '424242' }, 'test'));
        const expired = randomBytes(32).toString('base64url');
        await admin.staffBrowser.create({ data: { tokenHash: hash(expired), controlRevision: 1, createdAt,
            expiresAt: new Date(+createdAt + 60_000) } });
        await check('SIGN_IN_SESSION_EXPIRED', () => auth.send(`atlas_local_browser=${expired}`, auth.digest(`browser:${expired}`), { phone: '+12025550141', requestId: randomUUID() }, 'test'));
    });
    await scenario('human approval publishes an exact immutable version; corrections retain prior publication', async context => {
        const { signed, review, reports, ready } = await readyReport(context);
        assert.equal(ready.grading.report.findingCounts.unreviewed, 1);
        assert.equal(ready.grading.approvalBlock, null);
        const input = approvalInput(ready), result = await reports.approve(signed.staff, ready.id, input);
        assert.equal(result.approval.version, 1); assert.equal(result.card.grading.published.matchesCurrent, true);
        assert.equal(result.card.grading.approvalBlock, 'ALREADY_APPROVED');
        const approval = await context.admin.staffReportApproval.findUnique({ where: { id: result.approval.approvalId } });
        const published = JSON.parse(approval.publicCanonical);
        assert.equal(published.report.findings[0].reviewResult, 'ACCEPTED'); assert.equal(published.mode, 'LOCAL_FIXTURE');
        assert.deepEqual(published.report.grade, ready.grading.report.grade);
        const before = approval.publicCanonical;
        const retry = await reports.approve(signed.staff, ready.id, input); assert.deepEqual(retry.approval, result.approval);
        const edited = await review.save(signed.staff, ready.id, draft(result.card, { observations: { FRONT: 'A later review note.', BACK: '' } }));
        assert.equal(edited.grading.published.version, 1); assert.equal(edited.grading.published.matchesCurrent, false);
        assert.equal((await context.admin.staffReportApproval.findUnique({ where: { id: approval.id } })).publicCanonical, before);
        const oldRetry = await reports.approve(signed.staff, ready.id, input); assert.deepEqual(oldRetry.approval, result.approval);
        assert.equal(oldRetry.card.grading.published.matchesCurrent, false);
        const nextReady = await review.save(signed.staff, ready.id, draft(edited, { disposition: 'READY_FOR_HUMAN', reviewedSides: ['FRONT', 'BACK'], identityReviewed: true }));
        const second = await reports.approve(signed.staff, ready.id, approvalInput(nextReady));
        assert.equal(second.approval.version, 2); assert.equal(second.card.grading.published.publicToken, result.card.grading.published.publicToken);
        assert.equal(await context.admin.staffReportApproval.count(), 2); assert.equal(await context.admin.staffPublicReport.count(), 1);
        assert.equal((await context.admin.staffReportApproval.findUnique({ where: { id: approval.id } })).publicCanonical, before);
        assert.equal(Number((await context.sql('SELECT count(*) FROM public."CollectibleCardV2"')).rows[0].count), 0);
    }, { analyses: true, trained: true });
    await scenario('untrained and fabricated machine identities cannot approve', async context => {
        const { signed, reports, ready } = await readyReport(context);
        await check('TRAINED_REVIEWER_REQUIRED', () => reports.approve(signed.staff, ready.id, approvalInput(ready)));
        await check('SIGN_IN_REQUIRED', () => reports.approve({ ...signed.staff, role: 'REVIEWER', mode: 'PRODUCTION' }, ready.id, approvalInput(ready)));
        assert.equal(await context.admin.staffReportApproval.count(), 0);
    }, { analyses: true });
    await scenario('stale analysis/review and concurrent approvals cannot publish twice', async context => {
        const { signed, reports, ready } = await readyReport(context), input = approvalInput(ready);
        await check('DRAFT_CHANGED', () => reports.approve(signed.staff, ready.id, { ...input, analysisHash: 'f'.repeat(64) }));
        await check('DRAFT_CHANGED', () => reports.approve(signed.staff, ready.id, { ...input, expectedReviewRevision: 1 }));
        const results = await Promise.allSettled([reports.approve(signed.staff, ready.id, input), reports.approve(signed.staff, ready.id, approvalInput(ready))]);
        assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
        assert.equal(results.find(r => r.status === 'rejected').reason.code, 'ALREADY_APPROVED');
        assert.equal(await context.admin.staffReportApproval.count(), 1); assert.equal(await context.admin.staffPublicReport.count(), 1);
    }, { analyses: true, trained: true });
    await scenario('unresolved grading and changed policy block human approval', async context => {
        const { signed, review, reports, ready } = await readyReport(context);
        const session = await context.admin.staffSession.findFirst(); const now = new Date();
        const requestCanonical = canonical({ type: 'INITIALIZE' });
        const op = await context.admin.staffGradingOperation.create({ data: { id: randomUUID(), specimenId: ready.id, operationId: randomUUID(),
            actorKind: 'HUMAN', actorId: signed.staff.id, sessionHash: session.tokenHash, assignmentFence: 1,
            controlRevision: 1, evidenceHash: ready.evidenceHash, expectedAnalysisRevision: ready.grading.analysisRevision,
            expectedReviewRevision: ready.draft.revision, requestCanonical, inputHash: hash(requestCanonical), state: 'RESERVED',
            dispatchClaimId: randomUUID(), leaseFence: 1, createdAt: now, leaseExpiresAt: new Date(+now + 60_000) } });
        await check('GRADING_WORK_UNRESOLVED', () => reports.approve(signed.staff, ready.id, approvalInput(ready)));
        await context.admin.staffGradingOperation.update({ where: { id: op.id }, data: { state: 'FAILED', failureCode: 'CANCELLED_BEFORE_DISPATCH', finishedAt: new Date() } });
        await context.admin.staffControl.update({ where: { id: 'active' }, data: { gradingPolicyHash: 'f'.repeat(64), revision: { increment: 1 } } });
        const fresh = await context.login();
        const current = await review.read(fresh.staff, ready.id);
        await check('GRADING_POLICY_CHANGED', () => reports.approve(fresh.staff, ready.id, approvalInput(current)));
        assert.equal(await context.admin.staffReportApproval.count(), 0);
    }, { analyses: true, trained: true });
    await scenario('approval audit failure rolls back approval and public identity together', async context => {
        const { signed, reports, ready } = await readyReport(context);
        await context.sql(`CREATE FUNCTION atlas_staff.fixture_reject_report_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected report audit failure'; END; $$;
          CREATE TRIGGER fixture_reject_report_audit BEFORE INSERT ON atlas_staff."StaffAudit" FOR EACH ROW EXECUTE FUNCTION atlas_staff.fixture_reject_report_audit()`);
        await assert.rejects(() => reports.approve(signed.staff, ready.id, approvalInput(ready)));
        assert.equal(await context.admin.staffReportApproval.count(), 0); assert.equal(await context.admin.staffPublicReport.count(), 0);
        assert.equal((await context.admin.staffSpecimen.findUnique({ where: { id: ready.id } })).analysisRevision, 1);
    }, { analyses: true, trained: true });
    await scenario('SQL preserves source, approval and permanent public identity', async context => {
        const { signed, reports, ready } = await readyReport(context);
        const result = await reports.approve(signed.staff, ready.id, approvalInput(ready));
        await assert.rejects(() => context.admin.staffAnalysisRevision.update({ where: { specimenId_revision: { specimenId: ready.id, revision: 1 } }, data: { sourceRevision: 'changed' } }));
        await assert.rejects(() => context.admin.staffReportApproval.update({ where: { id: result.approval.approvalId }, data: { publicHash: 'f'.repeat(64) } }));
        await assert.rejects(() => context.admin.$transaction(async tx => {
            await tx.staffPublicReport.update({ where: { specimenId: ready.id }, data: { reportNumber: 'ATLAS-FFFFFFFFFFFF' } });
            await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
        }));
        assert.equal((await context.admin.staffPublicReport.findUnique({ where: { specimenId: ready.id } })).reportNumber, result.card.grading.published.reportNumber);
    }, { analyses: true, trained: true });
    await scenario('public role sees only approved versions while private draft edits remain private', async context => {
        const { signed, review, reports, ready } = await readyReport(context);
        await withPublicReader(context, async ({ reader }) => {
            assert.equal(await reader.read({ token: 'ar_000000000000000000000000', version: null }), null);
            const first = await reports.approve(signed.staff, ready.id, approvalInput(ready));
            const token = first.card.grading.published.publicToken;
            const current = await reader.read({ token, version: null });
            assert.equal(current.publicHash, first.approval.publicHash); assert.equal(current.packet.approvalVersion, 1);
            assert.equal(current.packet.report.findings[0].reviewResult, 'ACCEPTED');
            assert(!JSON.stringify(current).includes('Check this edge.'));
            assert.equal(await reader.read({ token, version: 2 }), null);
            const changed = await review.save(signed.staff, ready.id, draft(first.card, { observations: { FRONT: 'Private changed notes', BACK: '' } }));
            assert.deepEqual(await reader.read({ token, version: null }), current);
            const next = await review.save(signed.staff, ready.id, draft(changed, { disposition: 'READY_FOR_HUMAN', reviewedSides: ['FRONT', 'BACK'], identityReviewed: true }));
            await reports.approve(signed.staff, ready.id, approvalInput(next));
            assert.equal((await reader.read({ token, version: null })).packet.approvalVersion, 2);
            assert.deepEqual(await reader.read({ token, version: 1 }), current);
            const altered = structuredClone(current.packet); altered.report.findings[0].memoryExamples = ['private'];
            assert.throws(() => parsePublicReport(altered));
            const removed = structuredClone(current.packet); removed.report.findings[0].reviewResult = 'REMOVED';
            assert.throws(() => parsePublicReport(removed));
        });
    }, { analyses: true, trained: true });
    await scenario('public credentials cannot read private tables, write approvals or activate either app', async context => {
        await withPublicReader(context, async ({ client, config, reader }) => {
            await assert.rejects(() => client.$queryRaw`SELECT * FROM atlas_staff."StaffIdentity"`);
            await assert.rejects(() => client.$queryRaw`SELECT * FROM atlas_staff."StaffReportApproval"`);
            await assert.rejects(() => client.$queryRaw`SELECT * FROM public."CollectibleCardV2"`);
            await assert.rejects(() => client.$executeRaw`UPDATE atlas_staff."PublicReaderControl" SET enabled=false`);
            await assert.rejects(() => client.$executeRaw`UPDATE atlas_staff."StaffControl" SET enabled=false`);
            await assert.rejects(() => context.client.$queryRaw`SELECT * FROM atlas_staff."PublicReaderControl"`);
            const stale = new PublicReportReader(client, { ...config, releaseSha: 'f'.repeat(40) });
            await assert.rejects(() => stale.read({ token: 'ar_000000000000000000000000', version: null }));
            await context.sql('GRANT SELECT ON atlas_staff."StaffIdentity" TO atlas_fixture_public');
            await assert.rejects(() => reader.read({ token: 'ar_000000000000000000000000', version: null }));
        });
    });
    await scenario('approved photographs bind exact bytes and historical versions without exposing private references', async context => {
        const { signed, reports, review, ready } = await readyReport(context);
        const first = await reports.approve(signed.staff, ready.id, approvalInput(ready));
        const token = first.card.grading.published.publicToken;
        await withPublicReader(context, async ({ reader, client }) => {
            const published = await reader.read({ token, version: 1 });
            assert(!JSON.stringify(published).includes('sourceRef')); assert(!JSON.stringify(published).includes('sample-00'));
            const retained = {};
            for (const side of ['FRONT', 'BACK']) {
                const image = await reader.image({ token, version: 1, side });
                assert.equal(image.contentType, 'image/svg+xml'); assert.equal(hash(image.bytes), published.packet.images[side].sha256);
                assert.equal(image.bytes.length, published.packet.images[side].byteCount); retained[side] = image;
            }
            assert.equal(await reader.image({ token, version: 2, side: 'FRONT' }), null);
            assert.equal(await reader.image({ token, version: null, side: 'FRONT' }), null);
            assert.equal(await reader.image({ token, version: 1, side: 'ORIGINAL' }), null);
            await assert.rejects(() => client.$queryRaw`SELECT * FROM atlas_staff."StaffApprovedImage"`);
            await assert.rejects(() => context.admin.staffApprovedImage.update({ where: { approvalId_side: { approvalId: first.approval.approvalId, side: 'FRONT' } }, data: { descriptorHash: 'f'.repeat(64) } }));
            const updated = await review.save(signed.staff, ready.id, draft(first.card, { observations: { FRONT: 'private later draft', BACK: '' },
                disposition: 'READY_FOR_HUMAN', reviewedSides: ['FRONT', 'BACK'], identityReviewed: true }));
            await reports.approve(signed.staff, ready.id, approvalInput(updated));
            assert.equal((await reader.read({ token, version: null })).packet.approvalVersion, 2);
            for (const side of ['FRONT', 'BACK']) assert.deepEqual(await reader.image({ token, version: 1, side }), retained[side]);
            assert.equal(await context.admin.staffApprovedImage.count(), 4);
        });
    }, { analyses: true, trained: true });
    await scenario('approved image storage corruption and access revocation during a read fail closed', async context => {
        const { signed, reports, ready } = await readyReport(context);
        const approved = await reports.approve(signed.staff, ready.id, approvalInput(ready));
        const selector = { token: approved.card.grading.published.publicToken, version: 1, side: 'FRONT' };
        await withPublicReader(context, async ({ client, config }) => {
            const corrupted = new PublicReportReader(client, config, { async read() { return Buffer.from('changed image'); } });
            await assert.rejects(() => corrupted.image(selector));
            const revoked = new PublicReportReader(client, config, { async read(_reference, descriptor) {
                await context.admin.publicReaderControl.update({ where: { id: 'active' }, data: { enabled: false, revision: { increment: 1 } } });
                return fixtureArtwork(descriptor.sourceRef);
            } });
            await assert.rejects(() => revoked.image(selector));
        });
    }, { analyses: true, trained: true });
    await scenario('image substitution or insertion failure rolls back the entire human approval and permanent public identity', async context => {
        const { signed, reports, ready } = await readyReport(context);
        await context.sql(`CREATE FUNCTION atlas_staff.fixture_reject_image() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
          NEW."descriptorCanonical":=replace(NEW."descriptorCanonical",'sample-00','substituted-00');
          NEW."descriptorHash":=encode(sha256(convert_to(NEW."descriptorCanonical",'UTF8')),'hex'); RETURN NEW; END; $$;
          CREATE TRIGGER fixture_reject_image BEFORE INSERT ON atlas_staff."StaffApprovedImage" FOR EACH ROW EXECUTE FUNCTION atlas_staff.fixture_reject_image()`);
        await assert.rejects(() => reports.approve(signed.staff, ready.id, approvalInput(ready)));
        assert.equal(await context.admin.staffReportApproval.count(), 0); assert.equal(await context.admin.staffPublicReport.count(), 0);
        assert.equal(await context.admin.staffApprovedImage.count(), 0);
        await context.sql(`CREATE OR REPLACE FUNCTION atlas_staff.fixture_reject_image() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected image insert failure'; END; $$`);
        await assert.rejects(() => reports.approve(signed.staff, ready.id, approvalInput(ready)));
        assert.equal(await context.admin.staffReportApproval.count(), 0); assert.equal(await context.admin.staffPublicReport.count(), 0);
    }, { analyses: true, trained: true });
    await scenario('public traces contain only approved pixels and never removed findings or private provenance', async context => {
        const { signed, reports, ready } = await readyReport(context);
        const approved = await reports.approve(signed.staff, ready.id, approvalInput(ready));
        const selector = { token: approved.card.grading.published.publicToken, version: 1, findingId: 'FRONT:fixture-1:SURFACE' };
        await withPublicReader(context, async ({ reader }) => {
            const result = await reader.trace(selector), report = await reader.read(selector);
            assert.equal(result.publicHash, report.publicHash); assert.equal(result.side, 'FRONT');
            assert.equal(result.traceWire.rleSha256, report.packet.report.findings[0].traceSha256);
            assert.equal(decodeSpeedsterTraceBitmapWireV1(result.traceWire).reduce((sum, n) => sum + n, 0), 400);
            assert.deepEqual(Object.keys(result).sort(), ['publicHash', 'side', 'traceWire']);
            for (const change of [{ findingId: 'FRONT:fixture-private-removed:SURFACE' }, { findingId: 'unknown' }, { version: 2 }, { version: null }])
                assert.equal(await reader.trace({ ...selector, ...change }), null);
        });
    }, { analyses: true, trained: true, traces: true });
    await scenario('public revocation blocks retained clients and production mode never serves synthetic approvals', async context => {
        const { signed, reports, ready } = await readyReport(context);
        const result = await reports.approve(signed.staff, ready.id, approvalInput(ready));
        const selector = { token: result.card.grading.published.publicToken, version: 1 };
        await withPublicReader(context, async ({ reader, client, config }) => {
            assert(await reader.read(selector));
            await context.admin.publicReaderControl.update({ where: { id: 'active' }, data: { enabled: false, revision: { increment: 1 } } });
            await assert.rejects(() => reader.read(selector));
            const production = makePublicConfig({ ...config, mode: 'PRODUCTION', origin: 'https://atlasgrading.com', deploymentId: 'fixture-production.vercel.app' });
            const { databaseUrl, ...activation } = production;
            await context.admin.publicReaderControl.update({ where: { id: 'active' }, data: { ...activation, enabled: true, revision: { increment: 1 } } });
            assert.equal(await new PublicReportReader(client, production).read(selector), null);
        });
    }, { analyses: true, trained: true });
    await scenario('bridge commits source, immutable analysis, reset review and operation together; lost reply is idempotent', async context => {
        const bridge = await bridgeFixture(context, { loseReply: true });
        const signed = await context.login();
        const card = await bridge.review.read(signed.staff, bridge.specimenIds[0]), input = gradingInput(card);
        const result = await bridge.grading.run(signed.staff, card.id, input);
        assert.equal(result.operation.state, 'SUCCEEDED', result.operation.failureCode); assert.equal(result.card.grading.analysisRevision, 1);
        assert.equal(result.card.draft.revision, 2); assert.equal(result.card.grading.report.grade.overall.displayGrade, 9.7);
        const retry = await bridge.grading.run(signed.staff, card.id, input);
        assert.deepEqual(retry.operation, result.operation); assert.equal(bridge.calls(), 1);
        const execution = await context.admin.staffGradingExecution.findUnique({ where: { operationId: result.operation.id } });
        assert.equal(execution.state, 'COMMITTED'); assert.equal(execution.reservedMicroUsd, 10_000n); assert.equal(execution.actualMicroUsd, null);
    });
    await scenario('concurrent bridge clicks dispatch once; exact operation identity rejects changed action', async context => {
        const entered = deferred(), release = deferred();
        const bridge = await bridgeFixture(context, { beforePerform: async () => { entered.resolve(); await release.promise; } });
        const signed = await context.login(), card = await bridge.review.read(signed.staff, bridge.specimenIds[0]);
        let dispatchNotifications = 0, committedState;
        const input = gradingInput(card), first = bridge.grading.run(signed.staff, card.id, input, { onDispatched() {
            dispatchNotifications++;
            committedState = context.admin.staffGradingOperation.findUnique({ where: {
                specimenId_operationId: { specimenId: card.id, operationId: input.operationId } } });
        } });
        await entered.promise;
        assert.equal((await committedState).state, 'DISPATCHED'); assert.equal(dispatchNotifications, 1);
        const duplicate = await bridge.grading.run(signed.staff, card.id, input, { onDispatched() { dispatchNotifications++; } });
        assert.equal(dispatchNotifications, 1);
        assert.equal(duplicate.operation.state, 'DISPATCHED'); assert.equal(bridge.calls(), 1);
        await check('REQUEST_CONFLICT', () => bridge.grading.run(signed.staff, card.id, { ...input, action: { type: 'REMOVE', defectIds: ['other'] } }));
        release.resolve(); assert.equal((await first).operation.state, 'SUCCEEDED');
    });
    await scenario('bridge transaction rollback leaves old source and report; unknown reservation cannot retry', async context => {
        const bridge = await bridgeFixture(context, { afterPersist: () => { throw new Error('INJECTED_ROLLBACK'); } });
        const signed = await context.login(), card = await bridge.review.read(signed.staff, bridge.specimenIds[0]);
        const input = gradingInput(card), result = await bridge.grading.run(signed.staff, card.id, input);
        assert.equal(result.operation.state, 'UNKNOWN'); assert.equal(result.card.grading.analysisRevision, 0); assert.equal(result.card.draft.revision, 1);
        const source = await bridge.ports.loadSource(context.admin, await context.admin.staffSpecimen.findUnique({ where: { id: card.id } }));
        assert.equal(source.gradeReport, null); assert.equal(await context.admin.staffAnalysisRevision.count({ where: { specimenId: card.id } }), 0);
        await bridge.grading.run(signed.staff, card.id, input); assert.equal(bridge.calls(), 1);
        await check('GRADING_WORK_UNRESOLVED', () => bridge.grading.run(signed.staff, card.id, { ...input, operationId: randomUUID() }));
    });
    await scenario('revocation during bridge work prevents source/analysis commit and retains the unsettled execution', async context => {
        const entered = deferred(), release = deferred();
        const bridge = await bridgeFixture(context, { beforePerform: async () => { entered.resolve(); await release.promise; } });
        const signed = await context.login(), card = await bridge.review.read(signed.staff, bridge.specimenIds[0]);
        const running = bridge.grading.run(signed.staff, card.id, gradingInput(card));
        const observed = running.catch(error => error); await entered.promise;
        await context.admin.staffIdentity.update({ where: { id: signed.staff.id }, data: { revokedAt: new Date(), accessVersion: { increment: 1 } } });
        release.resolve(); assert.equal((await observed).code, 'SIGN_IN_REQUIRED');
        assert.equal(await context.admin.staffAnalysisRevision.count({ where: { specimenId: card.id } }), 0);
        const op = await context.admin.staffGradingOperation.findFirst({ where: { specimenId: card.id } });
        assert.equal(op.state, 'UNKNOWN'); const execution = await context.admin.staffGradingExecution.findUnique({ where: { operationId: op.id } });
        assert.equal(execution.actualMicroUsd, null); assert.equal(bridge.calls(), 1);
    });
    await scenario('bridge correction recalculates grade and preserves prior approved public version', async context => {
        const bridge = await bridgeFixture(context); const signed = await context.login();
        let card = await bridge.review.read(signed.staff, bridge.specimenIds[0]);
        card = (await bridge.grading.run(signed.staff, card.id, gradingInput(card))).card;
        card = await bridge.review.save(signed.staff, card.id, draft(card, { disposition: 'READY_FOR_HUMAN', reviewedSides: ['FRONT','BACK'], identityReviewed: true }));
        const reports = new StaffReports({ auth: context.auth, review: bridge.review });
        const first = await reports.approve(signed.staff, card.id, approvalInput(card));
        await withPublicReader(context, async ({ reader }) => {
            const selector = { token: first.card.grading.published.publicToken, version: 1 };
            const published = await reader.read(selector);
            const corrected = await bridge.grading.run(signed.staff, card.id, gradingInput(first.card,
                { type: 'REMOVE', defectIds: [first.card.grading.report.findings[0].id] }));
            assert.equal(corrected.operation.state, 'SUCCEEDED'); assert.equal(corrected.card.grading.analysisRevision, 2);
            assert.equal(corrected.card.grading.report.grade.overall.displayGrade, 10);
            assert.deepEqual(corrected.card.draft.reviewedSides, []); assert.equal(corrected.card.draft.identityReviewed, false);
            assert.equal(corrected.card.grading.published.matchesCurrent, false);
            assert.deepEqual(await reader.read(selector), published); assert.equal(bridge.calls(), 2);
        });
    }, { trained: true });
    await scenario('bridge enforces per-card cost reservations before another worker attempt', async context => {
        const bridge = await bridgeFixture(context, { maxCardMicroUsd: 10_000 }); const signed = await context.login();
        let card = await bridge.review.read(signed.staff, bridge.specimenIds[0]);
        card = (await bridge.grading.run(signed.staff, card.id, gradingInput(card))).card;
        const result = await bridge.grading.run(signed.staff, card.id, gradingInput(card, { type: 'REMOVE', defectIds: [card.grading.report.findings[0].id] }));
        assert.equal(result.operation.state, 'FAILED'); assert.equal(result.operation.failureCode, 'PILOT_BUDGET_EXHAUSTED');
        assert.equal(bridge.calls(), 1); assert.equal(await context.admin.staffGradingExecution.count(), 1);
    });
    await scenario('pilot budget amendments retain mathematical admission and allow a new bounded correction', async context => {
        const bridge = await bridgeFixture(context, { maxCardMicroUsd: 10_000 }); const signed = await context.login();
        let card = await bridge.review.read(signed.staff, bridge.specimenIds[0]);
        card = (await bridge.grading.run(signed.staff, card.id, gradingInput(card))).card;
        const prior = await context.admin.staffAnalysisRevision.findUnique({ where: { specimenId_revision: { specimenId: card.id, revision: 1 } } });
        const updatedPolicy = canonical({ ...bridge.policy, maxCardMicroUsd: 20_000 });
        await context.admin.staffGradingBridgeControl.update({ where: { id: 'active' }, data: { policyCanonical: updatedPolicy, policyHash: hash(updatedPolicy), revision: { increment: 1 } } });
        const result = await bridge.grading.run(signed.staff, card.id, gradingInput(card, { type: 'REMOVE', defectIds: [card.grading.report.findings[0].id] }));
        assert.equal(result.operation.state, 'SUCCEEDED'); assert.equal(bridge.calls(), 2);
        assert.equal((await context.admin.staffAnalysisRevision.findUnique({ where: { specimenId_revision: { specimenId: card.id, revision: 1 } } })).admissionHash, prior.admissionHash);
        assert.notEqual(result.card.grading.approvalBlock, 'GRADING_POLICY_CHANGED');
    });
    await scenario('all ten configured specimens must exist before any pilot worker dispatch', async context => {
        const bridge = await bridgeFixture(context); const signed = await context.login();
        const changed = canonical({ ...bridge.policy, specimenIds: [...bridge.specimenIds.slice(0, 9), randomUUID()] });
        await context.admin.staffGradingBridgeControl.update({ where: { id: 'active' }, data: { policyCanonical: changed, policyHash: hash(changed), revision: { increment: 1 } } });
        const card = await bridge.review.read(signed.staff, bridge.specimenIds[0]);
        const result = await bridge.grading.run(signed.staff, card.id, gradingInput(card));
        assert.equal(result.operation.failureCode, 'PILOT_TEN_CARDS_REQUIRED'); assert.equal(result.operation.state, 'FAILED'); assert.equal(bridge.calls(), 0);
    });
    await scenario('a changed source revision is rejected before reserving or calling the worker', async context => {
        const bridge = await bridgeFixture(context, { beforeDispatch: async () => {
            await context.admin.$executeRaw`UPDATE public."AtlasBridgeTestSource" SET "updatedAt"="updatedAt"+interval '1 second'`;
        } });
        const signed = await context.login(), card = await bridge.review.read(signed.staff, bridge.specimenIds[0]);
        const result = await bridge.grading.run(signed.staff, card.id, gradingInput(card));
        assert.equal(result.operation.failureCode, 'SOURCE_REVISION_CHANGED'); assert.equal(result.operation.state, 'FAILED');
        assert.equal(bridge.calls(), 0); assert.equal(await context.admin.staffGradingExecution.count(), 0);
    });
    await scenario('observed cost overrun pauses the entire pilot and cannot be erased by settlement edits', async context => {
        const bridge = await bridgeFixture(context); const signed = await context.login();
        let card = await bridge.review.read(signed.staff, bridge.specimenIds[0]);
        const result = await bridge.grading.run(signed.staff, card.id, gradingInput(card));
        await context.admin.staffGradingExecution.update({ where: { operationId: result.operation.id }, data: { actualMicroUsd: 10_001n, costEvidenceHash: 'e'.repeat(64) } });
        await assert.rejects(() => context.admin.staffGradingExecution.update({ where: { operationId: result.operation.id }, data: { actualMicroUsd: 0n, costEvidenceHash: 'f'.repeat(64) } }));
        card = await bridge.review.read(signed.staff, bridge.specimenIds[1]);
        const blocked = await bridge.grading.run(signed.staff, card.id, gradingInput(card));
        assert.equal(blocked.operation.failureCode, 'PILOT_BUDGET_EXHAUSTED'); assert.equal(bridge.calls(), 1);
    });
    await scenario('bridge reads cannot substitute staff deployment, assignment, case evidence or session', async context => {
        const bridge = await bridgeFixture(context); const signed = await context.login();
        const card = await context.admin.staffSpecimen.findUnique({ where: { id: bridge.specimenIds[0] } });
        const assignment = await context.admin.staffAssignment.findUnique({ where: { specimenId_identityId: { specimenId: card.id, identityId: signed.staff.id } } });
        const control = await context.admin.staffControl.findUnique({ where: { id: 'active' } });
        const session = await context.admin.staffSession.findFirst({ where: { identityId: signed.staff.id } });
        const claims = { controlRevision: control.revision, specimenId: card.id, actorId: signed.staff.id, sessionHash: session.tokenHash,
            assignmentFence: assignment.fence, evidenceHash: card.evidenceHash, deploymentId: context.config.deploymentId, releaseSha: context.config.releaseSha };
        for (const update of [{ deploymentId: 'other' }, { assignmentFence: 200 }, { evidenceHash: 'f'.repeat(64) }, { sessionHash: 'f'.repeat(64) }])
            await assert.rejects(() => bridge.service.transaction(tx => bridge.service.authorize(tx, { ...claims, ...update })));
        assert.equal(bridge.calls(), 0);
    });
    await scenario('staff serving credentials cannot claim executions, settle cost or enable the private bridge', async context => {
        await bridgeFixture(context);
        await assert.rejects(() => context.client.$executeRaw`UPDATE atlas_staff."StaffGradingBridgeControl" SET enabled=true`);
        await assert.rejects(() => context.client.$queryRaw`SELECT * FROM atlas_staff."StaffGradingExecution"`);
        const signed = await context.login(undefined, '+12025550142');
        const bridge = new (await import('../lib/server/access/grading.mjs')).StaffGrading({ auth: context.auth,
            review: new DurableReviewStore({ auth: context.auth, evidence: fixtureEvidence() }), bridge: null });
        const card = (await context.admin.staffSpecimen.findMany({ where: { subtitle: 'Synthetic bridge' }, take: 1 }))[0];
        const view = await bridge.review.read(signed.staff, card.id);
        await check('REVIEW_PERMISSION_REQUIRED', () => bridge.run(signed.staff, card.id, gradingInput(view)));
    });
    await operatorScenarios(scenario);
    await workspaceOperatorScenarios(scenario);
    await workspaceCaptureScenarios(scenario);
    await workspaceCaptureReadinessScenarios(scenario);
    await workspaceIdentificationScenarios(scenario);
    await workspaceCornerShapeScenarios(scenario);
    await workspaceTimingScenarios(scenario);
    await workspaceReceiptRecoveryScenarios(scenario);
    await workspaceAttemptAbandonmentScenarios(scenario);
    await workspaceReleaseAdoptionScenarios(scenario);
    await processingDollarLimitsScenarios(scenario);
    await workspaceSourceScenarios(scenario);
    await workspacePrivilegeScenarios(scenario);
    await workspaceDispatcherScenarios(scenario);
    await machineAdapterScenarios(scenario);
    await operationsScenarios(scenario);
    for (const { name, work } of intakeScenarios) await scenario(name, work);
    await machineInitializationScenarios(scenario);
    await finishingScenarios(scenario);
    await resolutionScenarios(scenario);
    await learningScenarios(scenario);
    await identityCorrectionScenarios(scenario, { classify: classifyAtlasIdentityCorrection });
    await adminPathScenarios(scenario);
    await customerScenarios(scenario, check);
    await trackingRegressionScenarios(scenario);
    await smsPilotScenarios(scenario, check);
    await smsTestLimitsScenarios(scenario);
} catch (caught) { error = caught; }
finally {
    for (const client of clients) await client.$disconnect();
    await fixture.stop();
    const result = { ok: !error, directory: fixture.directory, stopped: true, source: fixture.source, results,
        error: error ? fixture.safe(error.message) : null };
    writeFileSync(join(fixture.directory, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ok: result.ok, passed: results.filter(r => r.ok).length, directory: fixture.directory, stopped: true }));
}
if (error) { console.error(fixture.safe(error.stack)); process.exitCode = 1; }
