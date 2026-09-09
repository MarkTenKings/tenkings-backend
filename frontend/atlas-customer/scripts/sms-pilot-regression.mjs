import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { CustomerAuth } from '../lib/server/auth.mjs';
import { CustomerDatabase } from '../lib/server/database.mjs';
import { makeConfig as makeCustomerConfig } from '../lib/server/config.mjs';
import { localConfig, fixtureProvider } from '../lib/server/fixture.mjs';
import { createHandler as customerHandler } from '../lib/server/http.mjs';
import { hash } from '../lib/server/policy.mjs';
import { DurableStaffAuth } from '../../atlas-app/lib/server/access/auth.mjs';
import { StaffDatabase } from '../../atlas-app/lib/server/access/database.mjs';
import { makeAccessConfig } from '../../atlas-app/lib/server/access/config.mjs';
import { createHandler as staffHandler } from '../../atlas-app/lib/server/http.mjs';

const PHONE = '+12025550141', OTHER_PHONE = '+12025550142'; // Reserved fictional NANP numbers only.
const ORIGIN = 'https://atlasgrading.com';
const unavailable = /ATLAS SMS pilot unavailable/;
const opaque = () => randomBytes(32).toString('base64url');
const binding = config => Object.fromEntries(['mode', 'origin', 'deploymentId', 'releaseSha', 'configHash'].map(key => [key, config[key]]));
const destinationHash = app => hash(`atlas-sms-pilot-v1:${app}:${PHONE}`);
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

/** Production policy branches, real restricted DB roles and synthetic Verify.
 * Only the owned disposable loopback harness may call this hook. Nothing here
 * connects to a provider or accepts an arbitrary database URL. */
export async function smsPilotScenarios(scenario, check) {
    async function run(name, work) {
        await scenario(`SMS pilot: ${name}`, async c => {
            assert.equal(new URL(c.db.adminUrl).hostname, '127.0.0.1');
            assert.match(new URL(c.db.adminUrl).pathname, /^\/atlas_fixture_case_\d+$/);
            const Client = c.admin.constructor, customerClient = new Client({ datasources: { db: { url: c.db.customerUrl } } });
            const staffConfig = makeAccessConfig({ ...c.config, mode: 'PRODUCTION', origin: ORIGIN,
                deploymentId: 'sms-staff-fixture.vercel.app', releaseSha: '9'.repeat(40) });
            const customerConfig = makeCustomerConfig({ ...localConfig({ databaseUrl: c.db.customerUrl,
                sessionKey: randomBytes(32), phoneKey: randomBytes(32) }), mode: 'PRODUCTION', origin: ORIGIN,
                serviceSid: `VA${'3'.repeat(32)}`, deploymentId: 'sms-customer-fixture.vercel.app', releaseSha: '9'.repeat(40) });
            await c.admin.staffControl.update({ where: { id: 'active' }, data: { ...binding(staffConfig), revision: { increment: 1 } } });
            await c.admin.$executeRaw`INSERT INTO atlas_customer."CustomerControl"(enabled,mode,origin,"deploymentId","releaseSha","configHash")
                VALUES (true,${customerConfig.mode},${customerConfig.origin},${customerConfig.deploymentId},${customerConfig.releaseSha},${customerConfig.configHash})`;
            const apps = [
                { name: 'STAFF', schema: 'atlas_staff', table: 'StaffChallenge', control: 'StaffControl', config: staffConfig, client: c.client },
                { name: 'CUSTOMER', schema: 'atlas_customer', table: 'CustomerChallenge', control: 'CustomerControl', config: customerConfig, client: customerClient },
            ];
            const reservations = async app => (await c.sql('SELECT * FROM atlas_staff."SmsPilotReservation" WHERE application=$1 ORDER BY "recordedAt","sendClaimId"', [app.name])).rows;
            for (const app of apps) {
                const original = fixtureProvider(app.config);
                app.calls = { sends: 0, checks: 0 };
                app.provider = {
                    async start(phone) {
                        app.calls.sends++;
                        // The provider sees committed evidence through an independent connection.
                        assert((await reservations(app)).length >= app.calls.sends);
                        if (app.onStart) return app.onStart(phone, original);
                        return original.start(phone);
                    },
                    async check(sid, code) {
                        app.calls.checks++;
                        if (app.onCheck) return app.onCheck(sid, code, original);
                        return original.check(sid, code);
                    },
                };
                app.fresh = () => app.name === 'STAFF'
                    ? new DurableStaffAuth({ config: app.config, database: new StaffDatabase(app.client, app.config), provider: app.provider })
                    : new CustomerAuth({ config: app.config, database: new CustomerDatabase(app.client, app.config), provider: app.provider });
                app.auth = app.fresh();
                app.browser = async (auth = app.auth) => {
                    const boot = await auth.bootstrap(undefined, 'sms-pilot-fixture');
                    return { boot, cookie: `${app.config.cookies.browser}=${boot.browserToken}` };
                };
                app.begin = async (auth = app.auth) => {
                    const browser = await app.browser(auth), input = { phone: PHONE,
                        requestId: app.name === 'STAFF' ? `sms-pilot-${opaque()}` : randomUUID() };
                    return { ...browser, input, challenge: await auth.send(browser.cookie, browser.boot.csrf, input, 'sms-pilot-fixture') };
                };
                app.httpSend = async (browser, phone = PHONE) => {
                    // Host/proxy handling has its own acceptance suite; this real handler
                    // exercises origin, CSRF, auth, database trigger and generic errors.
                    const state = { config: app.config, origin: ORIGIN, mode: 'PRODUCTION', auth: app.auth,
                        cookies: app.config.cookies, assertRequest() {}, clientAddress: () => 'sms-pilot-fixture' };
                    const handler = (app.name === 'STAFF' ? staffHandler : customerHandler)(state);
                    const req = { url: `/api/${app.name.toLowerCase()}/auth/request`, method: 'POST',
                        headers: { origin: ORIGIN, cookie: browser.cookie, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin',
                            [app.name === 'STAFF' ? 'x-atlas-csrf' : 'x-atlas-customer-csrf']: browser.boot.csrf },
                        body: { phone, requestId: randomUUID() } };
                    const res = { headers: {}, setHeader(key, value) { this.headers[key] = value; },
                        status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
                    await handler(req, res); return res;
                };
            }
            const pilotId = randomUUID();
            async function activate(app) {
                await c.sql('UPDATE atlas_staff."SmsPilotControl" SET enabled=true,"pilotId"=$2::uuid,"allowedPhoneHash"=$3,"allowedDestinationHash"=$4,"accountSid"=$5,"serviceSid"=$6,"feeEvidenceHash"=$7,binding=$8::jsonb,revision=revision+1 WHERE application=$1',
                    [app.name, pilotId, app.config.phoneHash(PHONE), destinationHash(app.name), app.config.accountSid, app.config.serviceSid, 'a'.repeat(64), JSON.stringify(binding(app.config))]);
            }
            async function rawClaim(app, browser, overrides = {}, execute = c.sql, ignoreConflict = false) {
                const values = { id: opaque(), browserHash: hash(browser.boot.browserToken), requestId: randomUUID(),
                    phoneHash: app.config.phoneHash(PHONE), phone: PHONE, accountSid: app.config.accountSid,
                    serviceSid: app.config.serviceSid, sendClaimId: randomUUID(), ...overrides };
                const control = (await c.sql(`SELECT revision FROM ${app.schema}."${app.control}" WHERE id='active'`)).rows[0];
                const columns = ['id', 'browserHash', 'requestId', 'phoneHash', 'accountSid', 'serviceSid', 'sendClaimId'];
                if (app.name === 'CUSTOMER') columns.push('phone');
                const parameters = columns.map(key => values[key]);
                parameters.push(control.revision);
                // Use one transaction-stable timestamp for both bounds. Calling
                // clock_timestamp() separately can advance createdAt/expiresAt
                // by a millisecond and trip the existing five-minute shape
                // check before the SMS pilot trigger is exercised.
                const now = app.name === 'STAFF' ? "(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')" : 'CURRENT_TIMESTAMP';
                const placeholders = parameters.map((_, i) => `$${i + 1}${['requestId', 'sendClaimId'].includes(columns[i]) ? '::uuid' : i === columns.length ? '::integer' : ''}`);
                const query = `INSERT INTO ${app.schema}."${app.table}" (${columns.map(key => `"${key}"`).join(',')},"controlRevision",state,"createdAt","expiresAt","quarantineUntil") VALUES (${placeholders.join(',')},'SENDING',${now},${now}+interval '5 minutes',${now}+interval '11 minutes')${ignoreConflict ? ' ON CONFLICT DO NOTHING' : ''} RETURNING id`;
                await execute(query, parameters); return values;
            }
            try { await work({ ...c, apps, activate, reservations, rawClaim }); }
            finally { await customerClient.$disconnect(); }
        });
    }

    await run('production sends default closed, including fixture numbers, with generic HTTP errors', async c => {
        const rows = (await c.sql('SELECT * FROM atlas_staff."SmsPilotControl" ORDER BY application')).rows;
        assert.equal(rows.length, 2); assert(rows.every(row => !row.enabled && row.activatedAt === null));
        for (const app of c.apps) {
            const res = await app.httpSend(await app.browser());
            assert.equal(res.statusCode, 503); assert.deepEqual(res.body, { error: 'TEMPORARILY_UNAVAILABLE' });
            assert.equal(app.calls.sends, 0); assert.equal((await c.reservations(app)).length, 0);
            assert.equal((await c.sql(`SELECT count(*)::int AS n FROM ${app.schema}."${app.table}"`)).rows[0].n, 0);
        }
    });
    await run('one committed reservation covers send/check replay, with separate staff and customer exposure', async c => {
        for (const app of c.apps) {
            await c.activate(app);
            const initial = await app.begin(), auth = app.fresh();
            assert.deepEqual(await auth.send(initial.cookie, initial.boot.csrf, initial.input, 'sms-pilot-fixture'), initial.challenge);
            const input = { challengeId: initial.challenge.challengeId, code: '424242' };
            const first = await auth.verify(initial.cookie, initial.boot.csrf, input, 'sms-pilot-fixture');
            assert.equal((await app.fresh().verify(initial.cookie, initial.boot.csrf, input, 'sms-pilot-fixture')).token, first.token);
            assert.deepEqual(app.calls, { sends: 1, checks: 1 });
            const [receipt] = await c.reservations(app);
            assert.equal(receipt.challengeId, initial.challenge.challengeId); assert.equal(receipt.reservedMicroUsd, '500000');
            assert.equal(receipt.requestId, initial.input.requestId);
            assert.equal(receipt.phoneHash, app.config.phoneHash(PHONE)); assert.deepEqual(receipt.binding, binding(app.config));
        }
        const [window] = (await c.sql('SELECT bool_and("expiresAt"-"activatedAt"=interval \'168 hours\') AS exact FROM atlas_staff."SmsPilotControl"')).rows;
        assert.equal(window.exact, true);
        assert.equal((await c.sql('SELECT sum("reservedMicroUsd")::text AS held FROM atlas_staff."SmsPilotReservation"')).rows[0].held, '1000000');
    });
    await run('in-flight and unknown sends never retry or release their reservation', async c => {
        for (const app of c.apps) {
            await c.activate(app);
            const hold = deferred(), entered = deferred();
            app.onStart = async () => { entered.resolve(); await hold.promise; throw Error('synthetic lost provider reply'); };
            const browser = await app.browser(), input = { phone: PHONE, requestId: randomUUID() };
            const pending = app.auth.send(browser.cookie, browser.boot.csrf, input, 'sms-pilot-fixture');
            try {
                // Surface a pre-provider failure instead of waiting forever for
                // a hook that the failed claim will never enter.
                await Promise.race([entered.promise, pending]);
                await check('SIGN_IN_RESTART_REQUIRED', () => app.fresh().send(browser.cookie, browser.boot.csrf, input, 'sms-pilot-fixture'));
            } finally { hold.resolve(); }
            await check('SIGN_IN_RESTART_REQUIRED', () => pending);
            await check('SIGN_IN_RESTART_REQUIRED', () => app.fresh().send(browser.cookie, browser.boot.csrf, { ...input, requestId: randomUUID() }, 'sms-pilot-fixture'));
            assert.equal(app.calls.sends, 1); assert.equal((await c.reservations(app)).length, 1);
            assert.equal((await c.sql(`SELECT state FROM ${app.schema}."${app.table}"`)).rows[0].state, 'UNKNOWN');
        }
    });
    await run('wrong codes and unknown checks retain exposure without further SMS', async c => {
        for (const app of c.apps) {
            await c.activate(app); const initial = await app.begin();
            await check('CODE_NOT_ACCEPTED', () => app.fresh().verify(initial.cookie, initial.boot.csrf,
                { challengeId: initial.challenge.challengeId, code: '111111' }, 'sms-pilot-fixture'));
            app.onCheck = async () => { throw Error('synthetic lost verification reply'); };
            await check('SIGN_IN_RESTART_REQUIRED', () => app.fresh().verify(initial.cookie, initial.boot.csrf,
                { challengeId: initial.challenge.challengeId, code: '424242' }, 'sms-pilot-fixture'));
            await check('CODE_NOT_ACCEPTED', () => app.fresh().verify(initial.cookie, initial.boot.csrf,
                { challengeId: initial.challenge.challengeId, code: '424242' }, 'sms-pilot-fixture'));
            assert.deepEqual(app.calls, { sends: 1, checks: 2 }); assert.equal((await c.reservations(app)).length, 1);
        }
    });
    await run('last-slot races stop at ten claims per service and ten dollars total', async c => {
        for (const app of c.apps) {
            await c.activate(app); const browser = await app.browser();
            // Independent raw inserts stress the DB budget gate itself; the staff
            // path uses its actual serving role. Customer has no INSERT grant.
            const execute = app.name === 'STAFF' ? (query, parameters) => app.client.$queryRawUnsafe(query, ...parameters) : c.sql;
            // Serving users must not turn the serialized ledger count into a
            // stale-snapshot allowance by changing their transaction isolation.
            for (const isolationLevel of ['RepeatableRead', 'Serializable']) {
                await assert.rejects(() => app.client.$transaction(async tx => {
                    if (app.name === 'STAFF') return c.rawClaim(app, browser, {}, (query, parameters) => tx.$queryRawUnsafe(query, ...parameters));
                    const data = { browserHash: hash(browser.boot.browserToken), phone: PHONE, phoneHash: app.config.phoneHash(PHONE),
                        requestId: randomUUID(), challengeId: opaque(), claimId: randomUUID(), accountSid: app.config.accountSid,
                        serviceSid: app.config.serviceSid, clientHash: 'a'.repeat(64) };
                    return tx.$queryRawUnsafe('SELECT atlas_customer.customer_call($1::text,$2::jsonb,$3::jsonb)',
                        'send_claim', JSON.stringify(app.config.binding), JSON.stringify(data));
                }, { isolationLevel }), unavailable);
            }
            for (let i = 0; i < 9; i++) await c.rawClaim(app, browser, {}, execute);
            const race = await Promise.allSettled([c.rawClaim(app, browser, {}, execute), c.rawClaim(app, browser, {}, execute)]);
            assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
            assert.equal(race.filter(result => result.status === 'rejected' && unavailable.test(result.reason.message)).length, 1);
            assert.equal((await c.reservations(app)).length, 10);
            await assert.rejects(() => c.rawClaim(app, browser, {}, execute), unavailable);
            // A fresh real auth request reaches the exhausted budget once old
            // synthetic challenges leave their active quarantine states.
            if (app.name === 'STAFF') {
                // The production staff transition guard correctly keeps an
                // in-flight/unknown challenge quarantined until its provider
                // lifetime ends. This local-only budget case has already
                // asserted that quarantine behavior above; disable only that
                // trigger while retiring synthetic rows so the test can reach
                // the exhausted-ledger assertion immediately.
                // Keep the ALTER statements in their own autocommit calls;
                // PostgreSQL cannot re-enable a trigger in the same
                // transaction after row events have been queued.
                await c.sql(`ALTER TABLE ${app.schema}."${app.table}" DISABLE TRIGGER "StaffChallenge_transition"`);
                await c.sql(`UPDATE ${app.schema}."${app.table}" SET state='SUPERSEDED'`);
                await c.sql(`ALTER TABLE ${app.schema}."${app.table}" ENABLE TRIGGER "StaffChallenge_transition"`);
            } else await c.sql(`UPDATE ${app.schema}."${app.table}" SET state='SUPERSEDED'`);
            const denied = await app.httpSend(await app.browser());
            assert.equal(denied.statusCode, 503); assert.deepEqual(denied.body, { error: 'TEMPORARILY_UNAVAILABLE' });
            assert.equal(app.calls.sends, 0);
        }
        assert.deepEqual((await c.sql('SELECT count(*)::int AS claims,sum("reservedMicroUsd")::text AS held FROM atlas_staff."SmsPilotReservation"')).rows[0],
            { claims: 20, held: '10000000' });
    });
    await run('recipient, provider and release substitution cannot escape the pilot', async c => {
        for (const app of c.apps) {
            await c.activate(app); const browser = await app.browser();
            const other = await app.httpSend(browser, OTHER_PHONE);
            assert.equal(other.statusCode, 503); assert.deepEqual(other.body, { error: 'TEMPORARILY_UNAVAILABLE' });
            for (const fields of [{ accountSid: `AC${'4'.repeat(32)}` }, { serviceSid: `VA${'4'.repeat(32)}` }, { phoneHash: '4'.repeat(64) }])
                await assert.rejects(() => c.rawClaim(app, browser, fields), unavailable);
            if (app.name === 'CUSTOMER') {
                // Even a caller using the real restricted customer gateway cannot
                // pair the allowed HMAC with a substituted expensive destination.
                const database = new CustomerDatabase(app.client, app.config);
                await assert.rejects(() => database.call('send_claim', { browserHash: hash(browser.boot.browserToken), phone: OTHER_PHONE,
                    phoneHash: app.config.phoneHash(PHONE), requestId: randomUUID(), challengeId: opaque(), claimId: randomUUID(),
                    accountSid: app.config.accountSid, serviceSid: app.config.serviceSid, clientHash: 'a'.repeat(64) }), unavailable);
            }
            const config = app.name === 'STAFF' ? makeAccessConfig : makeCustomerConfig;
            app.config = config({ ...app.config, deploymentId: `repinned-${app.name.toLowerCase()}.vercel.app`, releaseSha: '8'.repeat(40) });
            await c.sql(`UPDATE ${app.schema}."${app.control}" SET "deploymentId"=$1,"releaseSha"=$2,"configHash"=$3,revision=revision+1 WHERE id='active'`,
                [app.config.deploymentId, app.config.releaseSha, app.config.configHash]);
            app.auth = app.fresh(); const current = await app.browser();
            assert.equal((await app.httpSend(current)).statusCode, 503);
            await c.sql('UPDATE atlas_staff."SmsPilotControl" SET binding=$2::jsonb,revision=revision+1 WHERE application=$1', [app.name, JSON.stringify(binding(app.config))]);
            await c.rawClaim(app, current); assert.equal((await c.reservations(app)).length, 1);
            assert.equal(app.calls.sends, 0);
        }
    });
    await run('controls, exposure and expiry cannot reset through serving roles or redeployment', async c => {
        for (const app of c.apps) {
            await c.activate(app); const browser = await app.browser(); await c.rawClaim(app, browser);
            const original = await c.reservations(app);
            for (const query of [
                'SELECT * FROM atlas_staff."SmsPilotControl"',
                'UPDATE atlas_staff."SmsPilotControl" SET enabled=false,revision=revision+1',
                'DELETE FROM atlas_staff."SmsPilotReservation"',
                'TRUNCATE atlas_staff."SmsPilotReservation"',
                `UPDATE ${app.schema}."${app.control}" SET mode='LOCAL_FIXTURE',revision=revision+1`,
                `ALTER TABLE ${app.schema}."${app.table}" DISABLE TRIGGER USER`,
                "SET session_replication_role='replica'",
            ]) await assert.rejects(() => app.client.$executeRawUnsafe(query), /permission denied|must be owner/);
            for (const clause of ['"maxClaims"=11', '"maxReservedMicroUsd"=6000000', '"reservationMicroUsd"=1',
                '"pilotId"=gen_random_uuid()', '"allowedPhoneHash"=repeat(\'b\',64)', '"allowedDestinationHash"=repeat(\'b\',64)',
                '"accountSid"=\'AC\'||repeat(\'b\',32)', '"serviceSid"=\'VA\'||repeat(\'b\',32)',
                '"feeEvidenceHash"=repeat(\'b\',64)', '"expiresAt"="expiresAt"+interval \'1 hour\'', '"activatedAt"=NULL'])
                await assert.rejects(() => c.sql(`UPDATE atlas_staff."SmsPilotControl" SET ${clause},revision=revision+1 WHERE application=$1`, [app.name]), /SMS pilot/);
            await assert.rejects(() => c.sql('UPDATE atlas_staff."SmsPilotControl" SET enabled=false WHERE application=$1', [app.name]), /revision required/);
            await c.sql('UPDATE atlas_staff."SmsPilotControl" SET enabled=false,revision=revision+1 WHERE application=$1', [app.name]);
            await assert.rejects(() => c.rawClaim(app, browser), unavailable);
            await c.sql('UPDATE atlas_staff."SmsPilotControl" SET enabled=true,revision=revision+1 WHERE application=$1', [app.name]);
            await c.sql(`UPDATE ${app.schema}."${app.control}" SET revision=revision+1 WHERE id='active'`);
            await c.rawClaim(app, await app.browser());
            const rows = await c.reservations(app); assert.equal(rows.length, 2); assert.deepEqual(rows[0], original[0]);
        }
        for (const query of ['UPDATE atlas_staff."SmsPilotReservation" SET "reservedMicroUsd"=0',
            'DELETE FROM atlas_staff."SmsPilotReservation"', 'TRUNCATE atlas_staff."SmsPilotReservation"',
            'DELETE FROM atlas_staff."SmsPilotControl"', 'TRUNCATE atlas_staff."SmsPilotControl" CASCADE'])
            await assert.rejects(() => c.sql(query), /immutable/);
    });
    await run('transaction rollback spends nothing; elapsed expiry denies new claims and reactivation', async c => {
        for (const app of c.apps) {
            await c.activate(app); const browser = await app.browser();
            await assert.rejects(() => c.admin.$transaction(async tx => {
                await c.rawClaim(app, browser, {}, (query, parameters) => tx.$queryRawUnsafe(query, ...parameters));
                throw Error('synthetic transaction rollback');
            }), /synthetic transaction rollback/);
            assert.equal((await c.reservations(app)).length, 0);
            const committed = await c.rawClaim(app, browser), before = await c.reservations(app);
            await c.rawClaim(app, browser, { requestId: committed.requestId }, c.sql, true);
            assert.deepEqual(await c.reservations(app), before);
            // Simulate eight elapsed days only in the owned loopback fixture. The
            // previous case proves the normal owner/serving paths cannot edit time.
            await c.sql(`BEGIN; ALTER TABLE atlas_staff."SmsPilotControl" DISABLE TRIGGER "SmsPilotControl_revision";
                UPDATE atlas_staff."SmsPilotControl" SET "activatedAt"="activatedAt"-interval '8 days',"expiresAt"="expiresAt"-interval '8 days' WHERE application='${app.name}';
                ALTER TABLE atlas_staff."SmsPilotControl" ENABLE TRIGGER "SmsPilotControl_revision"; COMMIT;`);
            await assert.rejects(() => c.rawClaim(app, browser), unavailable);
            await assert.rejects(() => c.sql('UPDATE atlas_staff."SmsPilotControl" SET enabled=true,revision=revision+1 WHERE application=$1', [app.name]), /SMS pilot expired/);
            await c.sql('UPDATE atlas_staff."SmsPilotControl" SET enabled=false,revision=revision+1 WHERE application=$1', [app.name]);
            assert.deepEqual(await c.reservations(app), before); assert.equal(app.calls.sends, 0);
        }
    });
}
