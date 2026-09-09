import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { ATLAS_NFC, canonicalNfcResult } from '../../../packages/atlas-finishing/src/nfc.mjs';
import { DurableReviewStore } from '../../atlas-app/lib/server/access/review.mjs';
import { StaffReports } from '../../atlas-app/lib/server/access/reports.mjs';
import { StaffFinishing } from '../../atlas-app/lib/server/access/finishing.mjs';
import { makeFinishingConfig } from '../../atlas-app/lib/server/access/finishing-runtime.mjs';
import { makeOperationsAuthorityConfig, StaffOperationsAuthority } from '../../atlas-app/lib/server/access/operations-authority.mjs';
import { StaffCustomerIntake } from '../../atlas-app/lib/server/access/customer-intake.mjs';
import { fixtureEvidence } from '../../atlas-app/lib/server/access/fixture.mjs';
import { hash } from '../../atlas-app/lib/server/policy.mjs';
import { CustomerAuth } from '../lib/server/auth.mjs';
import { CustomerDatabase } from '../lib/server/database.mjs';
import { localConfig, fixtureProvider } from '../lib/server/fixture.mjs';

// The lead supplies a fresh disposable database through its existing scenario
// callback. Importing this module creates no clients, processes, network calls,
// provider work, hardware access or persistent key enrollment. The synthetic
// P256 fixture follows atlas-app/scripts/finishing-fixture.mjs; every report,
// label, verification and physical record goes through the restricted service.
const OPTIONS = { analyses: true, trained: true };
const RETURNS = Object.freeze({ name: 'Tracking Fixture Customer', address1: '1 Synthetic Road', address2: '',
    city: 'Example', region: 'CA', postalCode: '90001', country: 'US' });
const approvalInput = card => ({ operationId: randomUUID(), expectedAnalysisRevision: card.grading.analysisRevision,
    analysisHash: card.grading.analysisHash, expectedReviewRevision: card.draft.revision,
    reviewHash: card.reviewHash, evidenceHash: card.evidenceHash });
const reviewInput = (card, disposition = 'READY_FOR_HUMAN') => ({ operationId: randomUUID(), expectedRevision: card.draft.revision,
    evidenceRevision: card.evidenceRevision, evidenceHash: card.evidenceHash,
    observations: { FRONT: `Owned synthetic tracking review ${card.draft.revision + 1}.`, BACK: '' },
    reviewedSides: ['FRONT', 'BACK'], identityReviewed: true, disposition });
const publicKey = pair => pair.publicKey.export({ type: 'spki', format: 'der' });
const rejectsCode = (code, action) => assert.rejects(action, error => error.code === code, code);

async function trackingFixture(context, work) {
    assert.equal(context.config.mode, 'LOCAL_FIXTURE');
    assert.equal(context.auth.database.client, context.client, 'Staff actions must use the restricted serving client');
    const customerUrl = new URL(context.db.customerUrl), operationsUrl = new URL(context.db.operationsUrl);
    for (const url of [customerUrl, operationsUrl]) {
        assert.equal(url.hostname, '127.0.0.1'); assert(url.port);
        assert.match(url.pathname, /^\/atlas_fixture_case_\d+$/);
    }
    assert.equal(customerUrl.username, 'atlas_fixture_customer');
    assert.equal(operationsUrl.username, 'atlas_fixture_operations');
    assert.equal(customerUrl.pathname, operationsUrl.pathname);
    const Client = context.admin.constructor;
    const customerClient = new Client({ datasources: { db: { url: customerUrl.href } } });
    const operationsClient = new Client({ datasources: { db: { url: operationsUrl.href } } });
    try {
        const { admin, auth, config } = context, signed = await context.login();
        const control = await admin.staffControl.findUnique({ where: { id: 'active' } });
        const actor = await admin.staffIdentity.findUnique({ where: { id: signed.staff.id } });
        await admin.staffOperationsGrant.create({ data: { id: randomUUID(), identityId: actor.id,
            accessVersion: actor.accessVersion, controlRevision: control.revision, mode: config.mode, origin: config.origin,
            deploymentId: config.deploymentId, releaseSha: config.releaseSha, configHash: config.configHash,
            authorizationEvidenceHash: hash('owned customer tracking regression authorization'),
            createdAt: new Date(Date.now() - 1000), expiresAt: new Date(Date.now() + 600_000) } });
        const authority = new StaffOperationsAuthority({ client: operationsClient, auth,
            config: makeOperationsAuthorityConfig({ databaseUrl: operationsUrl.href, staffConfig: config }) });
        const intake = new StaffCustomerIntake({ admin: authority });
        const customerConfig = localConfig({ databaseUrl: customerUrl.href, sessionKey: randomBytes(32), phoneKey: randomBytes(32) });
        await admin.$executeRaw`INSERT INTO atlas_customer."CustomerControl"(enabled,mode,origin,"deploymentId","releaseSha","configHash")
            VALUES(true,${customerConfig.mode},${customerConfig.origin},${customerConfig.deploymentId},${customerConfig.releaseSha},${customerConfig.configHash})`;
        const customer = new CustomerAuth({ database: new CustomerDatabase(customerClient, customerConfig),
            config: customerConfig, provider: fixtureProvider(customerConfig) });
        const boot = await customer.bootstrap(undefined, 'tracking-fixture');
        const browserCookie = `${customerConfig.cookies.browser}=${boot.browserToken}`;
        const challenge = await customer.send(browserCookie, boot.csrf, { phone: '+12025550109', requestId: randomUUID() }, 'tracking-fixture');
        const login = await customer.verify(browserCookie, boot.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'tracking-fixture');
        const cookie = `${browserCookie}; ${customerConfig.cookies.session}=${login.token}`;
        const submitted = (await customer.call(cookie, 'submit', { submission: { requestId: randomUUID(), profile: RETURNS,
            confirmed: true, intakeMethod: 'MAIL_IN', cards: [{ title: 'Synthetic tracked card', category: 'SPORTS' },
                { title: 'Synthetic sibling still awaiting receipt', category: 'POKEMON' }] } }, login.csrf)).submission;
        const customerCard = submitted.cards.find(card => card.title === 'Synthetic tracked card');
        assert(customerCard);
        const review = new DurableReviewStore({ auth, evidence: fixtureEvidence() });
        const reports = new StaffReports({ auth, review });
        const assigned = (await review.list(signed.staff)).find(card => card.evidenceComplete);
        assert(assigned);
        const specimenId = assigned.id;
        await intake.bind(signed.staff, { operationId: randomUUID(), cardId: customerCard.id,
            specimenId, physicalReceiptConfirmed: true });

        const server = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
        const workstation = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
        const workstationKeyId = hash(publicKey(workstation));
        const nfc = makeFinishingConfig({ mode: control.mode, origin: control.origin, deploymentId: control.deploymentId,
            releaseSha: control.releaseSha, privateKeyPem: server.privateKey.export({ type: 'pkcs8', format: 'pem' }),
            trust: { schemaVersion: 'atlas-nfc-trust-v1',
                serverKeys: [{ keyId: hash(publicKey(server)), publicSpkiDerBase64: publicKey(server).toString('base64') }],
                workstationKeys: [{ keyId: workstationKeyId, publicSpkiDerBase64: publicKey(workstation).toString('base64'),
                    enrollmentPolicy: ATLAS_NFC.workstationEnrollmentPolicy }] } });
        const { privateKeyPem: _key, trust: _trust, ...activation } = nfc;
        await admin.staffNfcControl.create({ data: activation });
        const finishing = new StaffFinishing({ auth, review, nfc });
        let approved;
        const expected = () => ({ approvalId: approved.approval.approvalId,
            approvalVersion: approved.approval.version, publicHash: approved.approval.publicHash });
        const currentCard = () => review.read(signed.staff, specimenId);
        async function approve() {
            const ready = await review.save(signed.staff, specimenId, reviewInput(await currentCard()));
            approved = await reports.approve(signed.staff, specimenId, approvalInput(ready));
            return approved;
        }
        const issueLabel = () => finishing.issueLabel(signed.staff, specimenId, { operationId: randomUUID(), ...expected() });
        async function verifyLabel(label) {
            const job = await finishing.createNfcJob(signed.staff, specimenId, { operationId: randomUUID(), ...expected(), labelIssueId: label.id });
            const bound = job.job;
            const result = { schemaVersion: ATLAS_NFC.resultSchema, algorithm: ATLAS_NFC.algorithm, workstationKeyId,
                jobEnvelopeSha256: job.jobEnvelopeSha256, nonce: bound.nonce, specimenId: bound.specimenId,
                approvalId: bound.approvalId, approvalVersion: bound.approvalVersion, publicToken: bound.publicToken, publicHash: bound.publicHash,
                url: bound.url, chipType: ATLAS_NFC.chipType, securityMode: ATLAS_NFC.securityMode,
                programmingProfile: ATLAS_NFC.programmingProfile, readerModel: ATLAS_NFC.readerModel,
                adapterIdentity: ATLAS_NFC.adapterIdentity, adapterVersion: ATLAS_NFC.adapterVersion,
                readbackPayloadSha256: hash(bound.url), writeProtectionState: ATLAS_NFC.writeProtectionState,
                readerResultCode: ATLAS_NFC.readerResultCode, helperCapability: ATLAS_NFC.helperCapability,
                observedAt: new Date().toISOString(), signature: Buffer.alloc(64).toString('base64url') };
            result.signature = sign('sha256', Buffer.from(canonicalNfcResult(result)),
                { key: workstation.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
            const verification = await finishing.recordNfcVerification(signed.staff, specimenId,
                { operationId: randomUUID(), jobId: job.id, result });
            return { job, verification };
        }
        const physical = (label, verification, assembly = null) => finishing.recordPhysical(signed.staff, specimenId,
            { operationId: randomUUID(), ...expected(), labelIssueId: label.id, verificationId: verification.id,
                stage: assembly ? 'SONIC_WELDED' : 'ASSEMBLED', assemblyId: assembly?.id ?? null, humanConfirmed: true });
        async function complete() {
            const label = await issueLabel(), { job, verification } = await verifyLabel(label);
            const assembly = await physical(label, verification), weld = await physical(label, verification, assembly);
            return { label, job, verification, assembly, weld };
        }
        const shipInput = () => ({ operationId: randomUUID(), cardId: customerCard.id, physicalDispatchConfirmed: true,
            carrier: 'Owned fixture carrier', trackingNumber: 'LOCAL-TRACKING-ONLY' });
        const ship = input => intake.ship(signed.staff, input ?? shipInput());
        const readCustomer = () => customer.call(cookie, 'card', { id: customerCard.id }).then(value => value.card);
        async function stage(value) {
            const card = await readCustomer(); assert.equal(card.stage, value);
            const queue = await intake.list(signed.staff), submission = queue.submissions.find(row => row.id === submitted.id);
            assert(submission); assert.deepEqual(submission.profileSnapshot, RETURNS); assert.equal(submission.intakeMethod, 'MAIL_IN');
            assert.equal(submission.cards.find(row => row.id === card.id).stage, value);
            assert.equal(submission.cards.find(row => row.id !== card.id).stage, 'SUBMITTED');
            assert.equal(card.shipment === null, value !== 'SHIPPED');
            return card;
        }
        await work({ ...context, signed, review, reports, finishing, intake, specimenId, customerCard,
            currentCard, approve, issueLabel, verifyLabel, physical, complete, shipInput, ship, readCustomer, stage });
    } finally { await customerClient.$disconnect(); await operationsClient.$disconnect(); }
}

/** Invoke only through the lead's owned full-chain scenario callback. */
export async function trackingRegressionScenarios(scenario) {
    assert.equal(typeof scenario, 'function');
    await scenario('customer tracking: a real review correction invalidates old approval and finishing until reapproved and refinished',
        context => trackingFixture(context, async f => {
            await f.stage('RECEIVED');
            const approved = await f.approve(); await f.stage('APPROVED');
            await rejectsCode('ENCAPSULATION_REQUIRED', () => f.ship());
            const old = await f.complete(); await f.stage('ENCAPSULATED');
            assert.equal((await f.finishing.read(f.signed.staff, f.specimenId)).stage, 'SONIC_WELD_CONFIRMED');
            const oldApproval = await f.admin.staffReportApproval.findUnique({ where: { id: approved.approval.approvalId } });
            const oldWeld = await f.admin.staffPhysicalFinish.findUnique({ where: { id: old.weld.id } });
            const before = await f.currentCard();
            const corrected = await f.review.save(f.signed.staff, f.specimenId, reviewInput(before, 'IN_REVIEW'));
            assert.equal(corrected.draft.revision, before.draft.revision + 1);
            const changed = await f.stage('FINAL_REVIEW');
            assert.equal(changed.events.some(event => ['APPROVED', 'ENCAPSULATED', 'SHIPPED'].includes(event.kind)), false);
            assert.equal(changed.reportUrl, approved.approval.path, 'Earlier immutable approved report remains addressable');
            assert.equal((await f.finishing.read(f.signed.staff, f.specimenId)).mutationBlock, 'APPROVAL_CHANGED');
            await rejectsCode('ENCAPSULATION_REQUIRED', () => f.ship());
            assert.deepEqual(await f.admin.staffReportApproval.findUnique({ where: { id: oldApproval.id } }), oldApproval);
            assert.deepEqual(await f.admin.staffPhysicalFinish.findUnique({ where: { id: oldWeld.id } }), oldWeld);
            const next = await f.approve(); assert.equal(next.approval.version, approved.approval.version + 1);
            await f.stage('APPROVED'); await rejectsCode('ENCAPSULATION_REQUIRED', () => f.ship());
            const fresh = await f.complete(); assert.notEqual(fresh.label.id, old.label.id);
            await f.stage('ENCAPSULATED');
            const request = f.shipInput(), receipt = await f.ship(request);
            assert.equal(receipt.receipt.kind, 'SHIPPED'); assert.deepEqual(await f.ship(request), receipt);
            const shipped = await f.stage('SHIPPED'); assert.equal(shipped.reportUrl, next.approval.path);
            assert.equal(await f.admin.staffPhysicalFinish.count({ where: { specimenId: f.specimenId } }), 4);
        }), OPTIONS);
    await scenario('customer tracking: replacement label and newer verified tag each invalidate an old welded chain before dispatch',
        context => trackingFixture(context, async f => {
            await f.approve(); const old = await f.complete(); await f.stage('ENCAPSULATED');
            const replacement = await f.issueLabel(); assert.notEqual(replacement.id, old.label.id);
            let current = await f.stage('APPROVED');
            assert.equal(current.events.some(event => event.kind === 'ENCAPSULATED'), false);
            assert.equal((await f.finishing.read(f.signed.staff, f.specimenId)).stage, 'LABEL_READY_FOR_PRINT_AND_NFC');
            await rejectsCode('ENCAPSULATION_REQUIRED', () => f.ship());
            const first = await f.verifyLabel(replacement); await f.stage('APPROVED');
            await rejectsCode('ENCAPSULATION_REQUIRED', () => f.ship());
            const assembly = await f.physical(replacement, first.verification); await f.stage('APPROVED');
            await rejectsCode('ENCAPSULATION_REQUIRED', () => f.ship());
            await f.physical(replacement, first.verification, assembly); await f.stage('ENCAPSULATED');
            const newer = await f.verifyLabel(replacement); assert.notEqual(newer.verification.id, first.verification.id);
            current = await f.stage('APPROVED'); assert.equal(current.events.some(event => event.kind === 'ENCAPSULATED'), false);
            assert.equal((await f.finishing.read(f.signed.staff, f.specimenId)).stage, 'READY_FOR_ASSEMBLY');
            await rejectsCode('ENCAPSULATION_REQUIRED', () => f.ship());
            const freshAssembly = await f.physical(replacement, newer.verification);
            const freshWeld = await f.physical(replacement, newer.verification, freshAssembly);
            assert.equal(freshWeld.assemblyId, freshAssembly.id); await f.stage('ENCAPSULATED');
            await f.ship(); await f.stage('SHIPPED');
            assert.equal(await f.admin.staffReportApproval.count({ where: { specimenId: f.specimenId } }), 1);
            assert.equal(await f.admin.staffPhysicalFinish.count({ where: { specimenId: f.specimenId } }), 6);
        }), OPTIONS);
}
