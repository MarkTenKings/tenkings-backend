import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { CustomerAuth } from '../../atlas-customer/lib/server/auth.mjs';
import { CustomerDatabase } from '../../atlas-customer/lib/server/database.mjs';
import { makeConfig as makeCustomerConfig } from '../../atlas-customer/lib/server/config.mjs';
import { localConfig, fixtureProvider } from '../../atlas-customer/lib/server/fixture.mjs';
import { createHandler as customerHandler } from '../../atlas-customer/lib/server/http.mjs';
import { hash } from '../../atlas-customer/lib/server/policy.mjs';
import { DurableStaffAuth } from '../lib/server/access/auth.mjs';
import { StaffDatabase } from '../lib/server/access/database.mjs';
import { makeAccessConfig } from '../lib/server/access/config.mjs';
import { createHandler as staffHandler } from '../lib/server/http.mjs';

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
export async function smsTestLimitsScenarios(scenario) {
    async function run(name, work) {
        await scenario(`SMS limit retirement: ${name}`, async c => {
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
            try { await work({ ...c, apps, activate, reservations, rawClaim, pilotId }); }
            finally { await customerClient.$disconnect(); }
        });
    }

    async function retireSyntheticChallenges(c, app) {
        if (app.name === 'STAFF') await c.sql('ALTER TABLE atlas_staff."StaffChallenge" DISABLE TRIGGER "StaffChallenge_transition"');
        await c.sql(`UPDATE ${app.schema}."${app.table}" SET state='SUPERSEDED'`);
        if (app.name === 'STAFF') await c.sql('ALTER TABLE atlas_staff."StaffChallenge" ENABLE TRIGGER "StaffChallenge_transition"');
    }
    await run('concurrent staff/customer claims pass the old combined limit and preserve all original holds', async c => {
        const browsers = [], original = [];
        for (const app of c.apps) {
            await c.activate(app); const browser = await app.browser(); browsers.push(browser);
            for (let i = 0; i < 10; i++) await c.rawClaim(app, browser);
            original.push(await c.reservations(app));
        }
        const policies = (await c.sql('SELECT * FROM atlas_staff."SmsPilotControl" ORDER BY application')).rows;
        const race = await Promise.allSettled(c.apps.flatMap((app, i) => [c.rawClaim(app, browsers[i]), c.rawClaim(app, browsers[i])]));
        assert.equal(race.filter(result => result.status === 'fulfilled').length, 4);
        for (const [index, app] of c.apps.entries()) {
            const rows = await c.reservations(app); assert.equal(rows.length, 12); assert.deepEqual(rows.slice(0, 10), original[index]);
            assert(rows.every(row => row.reservedMicroUsd === '500000')); assert.equal(app.calls.sends, 0);
        }
        assert.deepEqual((await c.sql('SELECT count(*)::integer AS claims,sum("reservedMicroUsd")::text AS held FROM atlas_staff."SmsPilotReservation"')).rows[0], { claims: 24, held: '12000000' });
        assert.deepEqual((await c.sql('SELECT * FROM atlas_staff."SmsPilotControl" ORDER BY application')).rows, policies);
    });
    await run('historical window expiry permits approved sends but keeps exact owner, provider and CSRF gates', async c => {
        for (const app of c.apps) {
            await c.activate(app); const browser = await app.browser(); await c.rawClaim(app, browser);
            const original = await c.reservations(app); await retireSyntheticChallenges(c, app);
            // Only the owned fixture advances the original policy metadata.
            await c.sql(`BEGIN; ALTER TABLE atlas_staff."SmsPilotControl" DISABLE TRIGGER "SmsPilotControl_revision";
                UPDATE atlas_staff."SmsPilotControl" SET "activatedAt"="activatedAt"-interval '8 days',"expiresAt"="expiresAt"-interval '8 days' WHERE application='${app.name}';
                ALTER TABLE atlas_staff."SmsPilotControl" ENABLE TRIGGER "SmsPilotControl_revision"; COMMIT;`);
            const before = (await c.sql('SELECT * FROM atlas_staff."SmsPilotControl" WHERE application=$1', [app.name])).rows[0];
            assert(+before.expiresAt < Date.now());
            await assert.rejects(() => app.auth.send(browser.cookie, 'invalid-csrf', { phone: PHONE, requestId: randomUUID() }, 'sms-pilot-fixture'), e => e.status === 403);
            for (const wrong of [{ phoneHash: 'b'.repeat(64) }, { accountSid: `AC${'4'.repeat(32)}` }, { serviceSid: `VA${'4'.repeat(32)}` },
                ...(app.name === 'CUSTOMER' ? [{ phone: OTHER_PHONE }] : [])]) await assert.rejects(() => c.rawClaim(app, browser, wrong), unavailable);
            assert.equal((await app.httpSend(browser, OTHER_PHONE)).statusCode, 503); assert.equal(app.calls.sends, 0);
            const response = await app.httpSend(browser); assert.equal(response.statusCode, 200); assert.equal(app.calls.sends, 1);
            const rows = await c.reservations(app); assert.equal(rows.length, 2); assert.deepEqual(rows[0], original[0]);
            await c.sql('UPDATE atlas_staff."SmsPilotControl" SET binding=binding,revision=revision+1 WHERE application=$1', [app.name]);
            const after = (await c.sql('SELECT * FROM atlas_staff."SmsPilotControl" WHERE application=$1', [app.name])).rows[0];
            assert.deepEqual({ ...after, revision: before.revision, updatedAt: before.updatedAt }, before);
        }
    });
    await run('ordinary per-phone rate protection still refuses before any new reservation or provider request', async c => {
        for (const app of c.apps) {
            await c.activate(app); const browser = await app.browser();
            const table = app.name === 'STAFF' ? 'StaffRateBucket' : 'CustomerRateBucket';
            const now = app.name === 'STAFF' ? "(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')" : 'CURRENT_TIMESTAMP';
            await c.sql(`INSERT INTO ${app.schema}."${table}" (key,count,"expiresAt") VALUES ($1,4,${now}+interval '15 minutes')`, [`send-phone:${app.config.phoneHash(PHONE)}`]);
            const response = await app.httpSend(browser);
            assert.equal(response.statusCode, 429); assert.deepEqual(response.body, { error: 'PLEASE_WAIT' });
            assert.equal(app.calls.sends, 0); assert.equal((await c.reservations(app)).length, 0);
        }
    });
}
