import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { CustomerAuth } from '../lib/server/auth.mjs';
import { CustomerDatabase } from '../lib/server/database.mjs';
import { localConfig, fixtureProvider } from '../lib/server/fixture.mjs';
import { hash } from '../lib/server/policy.mjs';

const returns = { name: 'Alex Example', address1: '1 Synthetic Road', address2: '', city: 'Example', region: 'CA', postalCode: '90001', country: 'US' };
const payload = (overrides = {}) => ({ requestId: randomUUID(), profile: returns, confirmed: true, intakeMethod: 'MAIL_IN',
    cards: [{ title: 'Example Sports Card A', category: 'SPORTS' }, { title: 'Example Pokémon Card B', category: 'POKEMON' }], ...overrides });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

/** Hook for the existing owned, loopback-only full-chain PostgreSQL harness.
 * It accepts that harness's scenario function, never a user database URL. */
export async function customerScenarios(scenario, check) {
    async function run(name, work, options = {}) {
        await scenario(`customer: ${name}`, async context => {
            assert(context.db.customerUrl, 'Harness must provision independent atlas_fixture_customer credentials');
            const Client = context.admin.constructor;
            const client = new Client({ datasources: { db: { url: context.db.customerUrl } } });
            const ops = new Client({ datasources: { db: { url: context.db.operationsUrl } } });
            const config = localConfig({ databaseUrl: context.db.customerUrl, sessionKey: randomBytes(32), phoneKey: randomBytes(32) });
            const provider = fixtureProvider(config), database = new CustomerDatabase(client, config);
            const auth = new CustomerAuth({ database, config, provider });
            await context.admin.$executeRaw`INSERT INTO atlas_customer."CustomerControl"(enabled,mode,origin,"deploymentId","releaseSha","configHash")
                VALUES (true,${config.mode},${config.origin},${config.deploymentId},${config.releaseSha},${config.configHash})`;
            async function begin(phone = '+12025550101', which = auth) {
                const boot = await which.bootstrap(undefined, 'customer-test'), cookie = `${config.cookies.browser}=${boot.browserToken}`;
                const input = { phone, requestId: randomUUID() }, challenge = await which.send(cookie, boot.csrf, input, 'customer-test');
                return { boot, cookie, input, challenge };
            }
            async function login(phone = '+12025550101', which = auth) {
                const initial = await begin(phone, which), result = await which.verify(initial.cookie, initial.boot.csrf,
                    { challengeId: initial.challenge.challengeId, code: '424242' }, 'customer-test');
                return { ...initial, ...result, cookie: `${initial.cookie}; ${config.cookies.session}=${result.token}` };
            }
            const submit = (signed, input = payload()) => auth.call(signed.cookie, 'submit', { submission: input }, signed.csrf);
            async function operations() {
                const signed = await context.login();
                const identity = await context.admin.staffIdentity.findUnique({ where: { id: signed.staff.id } });
                await context.admin.staffOperationsGrant.create({ data: { id: randomUUID(), identityId: identity.id,
                    accessVersion: identity.accessVersion, controlRevision: 1, mode: context.config.mode, origin: context.config.origin,
                    deploymentId: context.config.deploymentId, releaseSha: context.config.releaseSha, configHash: context.config.configHash,
                    authorizationEvidenceHash: 'a'.repeat(64), createdAt: new Date(Date.now() - 1000), expiresAt: new Date(Date.now() + 3600000) } });
                const handle = context.auth.actors.get(signed.staff), binding = Object.fromEntries(['mode', 'origin', 'deploymentId', 'releaseSha', 'configHash'].map(key => [key, context.config[key]]));
                const call = async (action, data, authority = handle, bound = binding) => {
                    const [{ result }] = await ops.$queryRaw`SELECT atlas_staff.customer_operations(${action},${authority.sessionHash},${authority.browserHash},${JSON.stringify(bound)}::jsonb,${JSON.stringify(data)}::jsonb) AS result`;
                    return result;
                };
                return { signed, handle, binding, call };
            }
            try { await work({ ...context, customerClient: client, customerConfig: config, customerAuth: auth, customerDatabase: database,
                customerProvider: provider, customerBegin: begin, customerLogin: login, submit, operations }); }
            finally { await client.$disconnect(); await ops.$disconnect(); }
        }, options);
    }
    await run('phone-only first signup is atomic; returning formatted phone keeps one account', async c => {
        assert.equal((await c.sql('SELECT count(*)::int AS n FROM atlas_customer."CustomerAccount"')).rows[0].n, 0);
        const initial = await c.customerBegin();
        assert.equal((await c.sql('SELECT count(*)::int AS n FROM atlas_customer."CustomerAccount"')).rows[0].n, 0);
        const first = await c.customerAuth.verify(initial.cookie, initial.boot.csrf, { challengeId: initial.challenge.challengeId, code: '424242' }, 'customer-test');
        assert.equal(first.customer.profile, null); assert.equal(first.customer.phone, '+12025550101');
        const repeat = await c.customerLogin('+1 (202) 555-0101');
        assert.equal(repeat.customer.id, first.customer.id);
        const counts = (await c.sql('SELECT (SELECT count(*)::int FROM atlas_customer."CustomerAccount") AS accounts,(SELECT count(*)::int FROM atlas_customer."CustomerSession") AS sessions')).rows[0];
        assert.deepEqual(counts, { accounts: 1, sessions: 2 });
        assert.equal(await c.admin.staffIdentity.count(), c.identities.length);
    });
    await run('lost verified reply replays one session then logout permanently defeats replay', async c => {
        const initial = await c.customerBegin(), input = { challengeId: initial.challenge.challengeId, code: '424242' };
        const first = await c.customerAuth.verify(initial.cookie, initial.boot.csrf, input, 'customer-test');
        const recovered = await c.customerAuth.verify(initial.cookie, initial.boot.csrf, input, 'customer-test');
        assert.equal(first.token, recovered.token); assert.deepEqual(first.customer, recovered.customer);
        assert.equal((await c.sql('SELECT count(*)::int AS n FROM atlas_customer."CustomerSession"')).rows[0].n, 1);
        await c.customerAuth.logout(`${initial.cookie}; ${c.customerConfig.cookies.session}=${first.token}`, first.csrf);
        assert.deepEqual(await c.customerAuth.logout(`${initial.cookie}; ${c.customerConfig.cookies.session}=${first.token}`, first.csrf), { signedOut: true });
        await check('CODE_NOT_ACCEPTED', () => c.customerAuth.verify(initial.cookie, initial.boot.csrf, input, 'customer-test'));
    });
    await run('concurrent sends claim once and lost send reply recovers without a second SMS', async c => {
        const hold = deferred(), entered = deferred(); let sends = 0;
        const auth = new CustomerAuth({ database: c.customerDatabase, config: c.customerConfig,
            provider: { ...c.customerProvider, async start(phone) { sends++; entered.resolve(); await hold.promise; return c.customerProvider.start(phone); } } });
        const boot = await auth.bootstrap(undefined, 'race'), cookie = `${c.customerConfig.cookies.browser}=${boot.browserToken}`;
        const input = { phone: '+12025550102', requestId: randomUUID() };
        const pending = auth.send(cookie, boot.csrf, input, 'race'); await entered.promise;
        await check('SIGN_IN_RESTART_REQUIRED', () => auth.send(cookie, boot.csrf, input, 'race'));
        hold.resolve(); const first = await pending, repeated = await auth.send(cookie, boot.csrf, input, 'race');
        assert.deepEqual(first, repeated); assert.equal(sends, 1);
        await check('REQUEST_CONFLICT', () => auth.send(cookie, boot.csrf, { ...input, phone: '+12025550103' }, 'race'));
    });
    await run('simultaneous verification creates one account/session and recovers only the exact code', async c => {
        const initial = await c.customerBegin(), hold = deferred(), entered = deferred(); let checks = 0;
        const auth = new CustomerAuth({ database: c.customerDatabase, config: c.customerConfig,
            provider: { ...c.customerProvider, async check(sid, code) { checks++; entered.resolve(); await hold.promise; return c.customerProvider.check(sid, code); } } });
        const input = { challengeId: initial.challenge.challengeId, code: '424242' };
        const pending = auth.verify(initial.cookie, initial.boot.csrf, input, 'race'); await entered.promise;
        await check('CODE_NOT_ACCEPTED', () => auth.verify(initial.cookie, initial.boot.csrf, input, 'race'));
        hold.resolve(); const first = await pending;
        assert.equal((await auth.verify(initial.cookie, initial.boot.csrf, input, 'race')).token, first.token);
        await check('CODE_NOT_ACCEPTED', () => auth.verify(initial.cookie, initial.boot.csrf, { ...input, code: '424243' }, 'race'));
        assert.equal(checks, 1);
        assert.equal((await c.sql('SELECT count(*)::int AS n FROM atlas_customer."CustomerAccount"')).rows[0].n, 1);
    });
    await run('wrong codes consume five durable attempts across fresh auth instances', async c => {
        const initial = await c.customerBegin(); let checks = 0;
        const provider = { ...c.customerProvider, async check(sid, code) { checks++; return c.customerProvider.check(sid, code); } };
        for (let i = 0; i < 6; i++) {
            const fresh = new CustomerAuth({ config: c.customerConfig, database: c.customerDatabase, provider });
            await check('CODE_NOT_ACCEPTED', () => fresh.verify(initial.cookie, initial.boot.csrf, { challengeId: initial.challenge.challengeId, code: '111111' }, 'wrong'));
        }
        assert.equal(checks, 5); assert.equal((await c.sql('SELECT attempts FROM atlas_customer."CustomerChallenge"')).rows[0].attempts, 5);
        assert.equal((await c.sql('SELECT count(*)::int AS n FROM atlas_customer."CustomerSession"')).rows[0].n, 0);
    });
    await run('expired challenges and timed-out send outcomes never create accounts', async c => {
        const initial = await c.customerBegin();
        await c.sql('UPDATE atlas_customer."CustomerChallenge" SET "createdAt"="createdAt"-interval \'6 minutes\',"expiresAt"="expiresAt"-interval \'6 minutes\',"quarantineUntil"="quarantineUntil"-interval \'6 minutes\' WHERE id=$1', [initial.challenge.challengeId]);
        await check('CODE_NOT_ACCEPTED', () => c.customerAuth.verify(initial.cookie, initial.boot.csrf, { challengeId: initial.challenge.challengeId, code: '424242' }, 'expired'));
        const config = c.customerConfig, broken = new CustomerAuth({ database: c.customerDatabase, config, provider: { async start() { throw Error('timeout'); } } });
        const boot = await broken.bootstrap(undefined, 'timeout'), cookie = `${config.cookies.browser}=${boot.browserToken}`;
        await check('SIGN_IN_RESTART_REQUIRED', () => broken.send(cookie, boot.csrf, { phone: '+12025550103', requestId: randomUUID() }, 'timeout'));
        await check('SIGN_IN_RESTART_REQUIRED', () => c.customerAuth.send(cookie, boot.csrf, { phone: '+12025550103', requestId: randomUUID() }, 'timeout'));
        assert.equal((await c.sql('SELECT count(*)::int AS n FROM atlas_customer."CustomerAccount"')).rows[0].n, 0);
    });
    await run('provider phone/SID binding mismatch is quarantined without a session', async c => {
        const initial = await c.customerBegin(), provider = { ...c.customerProvider, async check(sid, code) {
            return { ...await c.customerProvider.check(sid, code), phone: '+12025550199' };
        } };
        const auth = new CustomerAuth({ database: c.customerDatabase, config: c.customerConfig, provider });
        await check('SIGN_IN_RESTART_REQUIRED', () => auth.verify(initial.cookie, initial.boot.csrf, { challengeId: initial.challenge.challengeId, code: '424242' }, 'mismatch'));
        const state = (await c.sql('SELECT state FROM atlas_customer."CustomerChallenge"')).rows[0].state;
        assert.equal(state, 'UNKNOWN'); assert.equal((await c.sql('SELECT count(*)::int AS n FROM atlas_customer."CustomerAccount"')).rows[0].n, 0);
    });
    await run('submission ownership is enforced inside SQL for lists, details, cards and cursors', async c => {
        const first = await c.customerLogin(), second = await c.customerLogin('+12025550102');
        const input = payload(), item = (await c.submit(first, input)).submission;
        assert.equal((await c.customerAuth.call(first.cookie, 'list', { cursor: null })).submissions.length, 1);
        assert.equal((await c.customerAuth.call(second.cookie, 'list', { cursor: null, accountId: first.customer.id })).submissions.length, 0);
        await check('NOT_FOUND', () => c.customerAuth.call(second.cookie, 'submission', { id: item.id, accountId: first.customer.id }));
        await check('NOT_FOUND', () => c.customerAuth.call(second.cookie, 'card', { id: item.cards[0].id }));
        await check('NOT_FOUND', () => c.customerAuth.call(second.cookie, 'list', { cursor: item.id }));
        await check('NOT_FOUND', () => c.customerAuth.call(second.cookie, 'submission_request', { id: input.requestId }));
        assert.equal((await c.customerAuth.call(first.cookie, 'submission_request', { id: input.requestId })).submission.id, item.id);
        const one = await c.customerAuth.call(first.cookie, 'card', { id: item.cards[0].id });
        assert.equal(one.card.id, item.cards[0].id); assert.equal(Object.hasOwn(one.card, 'specimenId'), false);
    });
    await run('profile is required only at submission; immutable snapshots and request replay survive profile edits', async c => {
        const signed = await c.customerLogin(); assert.equal(signed.customer.profile, null);
        await check('INVALID_SUBMISSION', () => c.submit(signed, payload({ profile: null })));
        const input = payload(), first = (await c.submit(signed, input)).submission;
        assert.equal(first.intakeMethod, 'MAIL_IN'); assert.deepEqual(first.profileSnapshot, returns);
        const updated = { ...returns, address1: '2 Different Example Road' };
        await c.customerAuth.call(signed.cookie, 'profile', { profile: updated }, signed.csrf);
        const recovered = (await c.submit(signed, input)).submission; assert.deepEqual(recovered, first);
        assert.deepEqual((await c.customerAuth.call(signed.cookie, 'submission', { id: first.id })).submission.profileSnapshot, returns);
        await check('REQUEST_CONFLICT', () => c.submit(signed, { ...input, intakeMethod: 'DEALER_DROP_OFF' }));
        await assert.rejects(() => c.sql('UPDATE atlas_customer."CustomerSubmission" SET "profileSnapshot"=$1::jsonb WHERE id=$2', [JSON.stringify(updated), first.id]), /IMMUTABLE/);
        await assert.rejects(() => c.sql('DELETE FROM atlas_customer."CustomerSubmission" WHERE id=$1', [first.id]), /IMMUTABLE/);
        assert.equal((await c.customerAuth.bootstrap(signed.cookie, 'reload')).customer.profile.address1, updated.address1);
    });
    await run('own-submission pagination is bounded and does not skip a sixth submission', async c => {
        const signed = await c.customerLogin();
        for (let i = 0; i < 6; i++) await c.submit(signed, payload({ intakeMethod: i % 2 ? 'MAIL_IN' : 'DEALER_DROP_OFF' }));
        const first = await c.customerAuth.call(signed.cookie, 'list', { cursor: null });
        assert.equal(first.submissions.length, 5); assert.equal(first.nextCursor, first.submissions[4].id);
        const second = await c.customerAuth.call(signed.cookie, 'list', { cursor: first.nextCursor });
        assert.equal(second.submissions.length, 1); assert.equal(second.nextCursor, null);
        assert.equal(new Set([...first.submissions, ...second.submissions].map(row => row.id)).size, 6);
    });
    await run('revocation and release revision invalidate customer sessions and consumed-code recovery', async c => {
        const signed = await c.customerLogin();
        await c.sql('UPDATE atlas_customer."CustomerAccount" SET "accessVersion"="accessVersion"+1 WHERE id=$1', [signed.customer.id]);
        await check('SIGN_IN_REQUIRED', () => c.customerAuth.call(signed.cookie, 'list', { cursor: null }));
        const fresh = await c.customerLogin();
        await assert.rejects(() => c.sql('UPDATE atlas_customer."CustomerControl" SET enabled=false'), /REVISION_REQUIRED/);
        await assert.rejects(() => c.sql('DELETE FROM atlas_customer."CustomerControl"'), /IMMUTABLE/);
        await c.sql('UPDATE atlas_customer."CustomerControl" SET revision=revision+1');
        await check('SIGN_IN_SESSION_EXPIRED', () => c.customerAuth.call(fresh.cookie, 'list', { cursor: null }));
        assert.equal((await c.customerAuth.bootstrap(fresh.cookie, 'revision')).customer, null);
    });
    await run('customer serving credential has no tables, staff functions or ambient role authority', async c => {
        const signed = await c.customerLogin();
        for (const table of ['atlas_customer."CustomerAccount"', 'atlas_customer."CustomerSubmission"', 'atlas_staff."StaffIdentity"', 'atlas_staff."StaffSession"'])
            await assert.rejects(() => c.customerClient.$queryRawUnsafe(`SELECT * FROM ${table}`), /permission denied/);
        await assert.rejects(() => c.customerClient.$queryRaw`SELECT atlas_staff.customer_operations('list','x','y','{}'::jsonb,'{"cursor":null}'::jsonb)`, /permission denied/);
        await c.sql('GRANT SELECT ON atlas_customer."CustomerAccount" TO atlas_fixture_customer');
        await check('CUSTOMER_DATABASE_ROLE_INVALID', () => c.customerAuth.call(signed.cookie, 'list', { cursor: null }));
        await c.sql('REVOKE SELECT ON atlas_customer."CustomerAccount" FROM atlas_fixture_customer');
        assert.equal((await c.customerAuth.call(signed.cookie, 'list', { cursor: null })).submissions.length, 0);
    });
    await run('staff cookie cannot authenticate customer and customer session cannot authorize staff intake', async c => {
        const customer = await c.customerLogin(), staff = await c.login();
        await check('SIGN_IN_REQUIRED', () => c.customerAuth.call(staff.cookie, 'list', { cursor: null }));
        const ops = await c.operations();
        const authority = { sessionHash: hash(customer.token), browserHash: hash(customer.boot.browserToken) };
        assert.equal((await ops.call('list', { cursor: null }, authority)).error.code, 'FRESH_HUMAN_OPERATIONS_REQUIRED');
        const forgedBinding = { ...ops.binding, origin: 'https://evil.example' };
        assert.equal((await ops.call('list', { cursor: null }, ops.handle, forgedBinding)).error.code, 'STAFF_ACCESS_NOT_ENABLED');
    });
    await run('physical intake is explicit, exact and idempotent; sibling card progress stays submitted', async c => {
        const signed = await c.customerLogin(), item = (await c.submit(signed)).submission, ops = await c.operations();
        const assigned = await c.admin.staffAssignment.findFirst({ where: { identityId: ops.signed.staff.id, canReview: true } });
        const input = { operationId: randomUUID(), cardId: item.cards[0].id, specimenId: assigned.specimenId, physicalReceiptConfirmed: true };
        assert.equal((await ops.call('bind', { ...input, physicalReceiptConfirmed: false })).error.code, 'PHYSICAL_RECEIPT_REQUIRED');
        const receipt = await ops.call('bind', input); assert.equal(receipt.receipt.kind, 'RECEIVED'); assert.deepEqual(await ops.call('bind', input), receipt);
        const detail = (await c.customerAuth.call(signed.cookie, 'submission', { id: item.id })).submission;
        assert.equal(detail.cards.find(card => card.id === item.cards[0].id).stage, 'RECEIVED');
        assert.equal(detail.cards.find(card => card.id === item.cards[1].id).stage, 'SUBMITTED');
        assert(detail.cards.every(card => !card.events.some(event => ['FINAL_REVIEW', 'ENCAPSULATED', 'SHIPPED'].includes(event.kind))));
        assert.equal((await ops.call('bind', { ...input, operationId: randomUUID(), cardId: item.cards[1].id })).error.code, 'SPECIMEN_ALREADY_LINKED');
        const event = (await c.sql('SELECT details FROM atlas_customer."CustomerCardEvent" WHERE id=$1', [receipt.receipt.id])).rows[0];
        assert.equal(event.details.sessionHash, ops.handle.sessionHash); assert(event.details.operationsGrantId);
    }, { analyses: true, trained: true });
    await run('customer-visible action messages and dispatch guards never invent shipping or expose internal notes', async c => {
        const signed = await c.customerLogin(), item = (await c.submit(signed)).submission, ops = await c.operations(), cardId = item.cards[0].id;
        const input = { operationId: randomUUID(), cardId, reason: 'CARD_DETAILS_NEEDED', message: 'Please confirm the set name with the ATLAS team.', resolved: false };
        const first = await ops.call('action', input); assert.equal(first.receipt.kind, 'ACTION_NEEDED'); assert.deepEqual(await ops.call('action', input), first);
        let card = (await c.customerAuth.call(signed.cookie, 'card', { id: cardId })).card;
        assert.equal(card.actionNeeded.message, input.message); assert.equal(card.stage, 'SUBMITTED');
        const ship = { operationId: randomUUID(), cardId, physicalDispatchConfirmed: true, carrier: 'Example carrier', trackingNumber: 'SYNTHETIC123' };
        assert.equal((await ops.call('ship', ship)).error.code, 'CUSTOMER_ACTION_REQUIRED');
        await ops.call('action', { ...input, operationId: randomUUID(), message: null, resolved: true });
        card = (await c.customerAuth.call(signed.cookie, 'card', { id: cardId })).card; assert.equal(card.actionNeeded, null); assert.equal(card.shipment, null);
        assert.equal((await ops.call('ship', ship)).error.code, 'ENCAPSULATION_REQUIRED');
        const missing = { ...input, operationId: randomUUID() }; delete missing.resolved;
        assert.equal((await ops.call('action', missing)).error.code, 'INVALID_REQUEST');
        assert.equal(JSON.stringify(card).includes(ops.handle.sessionHash), false);
    });
}
