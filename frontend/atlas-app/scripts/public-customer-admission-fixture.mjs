import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { CustomerAuth } from '../../atlas-customer/lib/server/auth.mjs';
import { CustomerDatabase } from '../../atlas-customer/lib/server/database.mjs';
import { makeConfig } from '../../atlas-customer/lib/server/config.mjs';
import { localConfig, fixtureProvider } from '../../atlas-customer/lib/server/fixture.mjs';
import { hash } from '../../atlas-customer/lib/server/policy.mjs';

// Run only through the owned disposable PostgreSQL harness. All destinations
// are fictional, Verify is synthetic, and no provider network is used.
export async function publicCustomerAdmissionScenarios(scenario) {
    await scenario('public customer admission preserves operator authority, OTP, replay, rate limits and revocation', async c => {
        assert.equal(new URL(c.db.adminUrl).hostname, '127.0.0.1');
        assert.match(new URL(c.db.adminUrl).pathname, /^\/atlas_fixture_case_\d+$/);
        const Client = c.admin.constructor;
        const client = new Client({ datasources: { db: { url: c.db.customerUrl } } });
        try {
            const controls = (await c.sql('SELECT application,"publicCustomerAdmission" FROM atlas_staff."SmsPilotControl" ORDER BY application')).rows;
            assert.deepEqual(controls, [
                { application: 'CUSTOMER', publicCustomerAdmission: false },
                { application: 'STAFF', publicCustomerAdmission: false },
            ]);
            const config = makeConfig({ ...localConfig({ databaseUrl: c.db.customerUrl,
                sessionKey: randomBytes(32), phoneKey: randomBytes(32) }), mode: 'PRODUCTION', origin: 'https://atlasgrading.com',
                deploymentId: 'public-customer-fixture.vercel.app', releaseSha: '9'.repeat(40) });
            await c.sql('INSERT INTO atlas_customer."CustomerControl"(enabled,mode,origin,"deploymentId","releaseSha","configHash") VALUES(true,$1,$2,$3,$4,$5)', Object.values(config.binding));
            const owner = '+12025550141', other = '+12025550142';
            await c.sql('UPDATE atlas_staff."SmsPilotControl" SET enabled=true,"pilotId"=$1,"allowedPhoneHash"=$2,"allowedDestinationHash"=$3,"accountSid"=$4,"serviceSid"=$5,"feeEvidenceHash"=$6,binding=$7,revision=revision+1 WHERE application=\'CUSTOMER\'',
                [randomUUID(), config.phoneHash(owner), hash(`atlas-sms-pilot-v1:CUSTOMER:${owner}`), config.accountSid,
                    config.serviceSid, 'a'.repeat(64), JSON.stringify(config.binding)]);
            let sends = 0, checks = 0, unknownSend = false;
            const verify = fixtureProvider(config);
            const reservations = async () => (await c.sql('SELECT * FROM atlas_staff."SmsPilotReservation" ORDER BY "sendClaimId"')).rows;
            const auth = new CustomerAuth({ config, database: new CustomerDatabase(client, config), provider: {
                async start(phone) {
                    sends++;
                    // Independent connection proves reservation committed before provider I/O.
                    assert.equal((await reservations()).length, sends);
                    if (unknownSend) throw new Error('synthetic unknown');
                    return verify.start(phone);
                },
                async check(...args) { checks++; return verify.check(...args); },
            } });
            const boot = await auth.bootstrap(undefined, 'public-customer-fixture');
            const cookie = `${config.cookies.browser}=${boot.browserToken}`;
            const send = (phone, clientName = 'public-customer-fixture', requestId = randomUUID()) =>
                auth.send(cookie, boot.csrf, { phone, requestId }, clientName);
            const unavailable = /ATLAS SMS pilot unavailable/;
            await assert.rejects(send(other), unavailable);
            assert.equal(sends, 0);
            await assert.rejects(client.$executeRawUnsafe('UPDATE atlas_staff."SmsPilotControl" SET "publicCustomerAdmission"=true,revision=revision+1 WHERE application=\'CUSTOMER\''), /permission denied/);
            await assert.rejects(c.sql('UPDATE atlas_staff."SmsPilotControl" SET "publicCustomerAdmission"=true WHERE application=\'CUSTOMER\''), /revision required/);
            await assert.rejects(c.sql('UPDATE atlas_staff."SmsPilotControl" SET "publicCustomerAdmission"=true,revision=revision+1 WHERE application=\'STAFF\''), /public_customer_only/);
            await c.sql('UPDATE atlas_staff."SmsPilotControl" SET "publicCustomerAdmission"=true,revision=revision+1 WHERE application=\'CUSTOMER\'');

            const requestId = randomUUID(), challenge = await send(other, 'public-customer-fixture', requestId);
            assert.deepEqual(await send(other, 'public-customer-fixture', requestId), challenge);
            assert.equal(sends, 1);
            await assert.rejects(send(other), { code: 'PLEASE_WAIT' });
            await assert.rejects(auth.verify(cookie, boot.csrf, { challengeId: challenge.challengeId, code: '111111' }, 'public-customer-fixture'), { code: 'CODE_NOT_ACCEPTED' });
            assert.equal((await c.sql('SELECT count(*)::int n FROM atlas_customer."CustomerAccount"')).rows[0].n, 0);
            const signed = await auth.verify(cookie, boot.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'public-customer-fixture');
            assert.equal((await auth.verify(cookie, boot.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'public-customer-fixture')).token, signed.token);
            assert.equal(checks, 2);

            const pending = await send('+12025550143');
            assert.equal(sends, 2);
            for (const [key, limit, phone, clientName] of [
                [`send-phone:${config.phoneHash('+12025550144')}`, 4, '+12025550144', 'fresh-phone-client'],
                [`send-client:${hash('blocked-client')}`, 12, '+12025550145', 'blocked-client'],
                ['send-global', 60, '+12025550146', 'fresh-global-client'],
            ]) {
                await c.sql('INSERT INTO atlas_customer."CustomerRateBucket"(key,count,"expiresAt") VALUES($1,$2,clock_timestamp()+interval \'15 minutes\') ON CONFLICT(key) DO UPDATE SET count=excluded.count,"expiresAt"=excluded."expiresAt"', [key, limit]);
                await assert.rejects(send(phone, clientName), { code: 'PLEASE_WAIT' });
                assert.equal(sends, 2);
            }
            await c.sql('UPDATE atlas_customer."CustomerRateBucket" SET "expiresAt"=clock_timestamp()-interval \'1 second\'');
            unknownSend = true;
            await assert.rejects(send('+12025550147'), { code: 'SIGN_IN_RESTART_REQUIRED' });
            await assert.rejects(send('+12025550147'), { code: 'SIGN_IN_RESTART_REQUIRED' });
            assert.equal(sends, 3);
            unknownSend = false;

            const ledger = await reservations();
            await assert.rejects(c.sql('UPDATE atlas_staff."SmsPilotReservation" SET "recordedAt"=clock_timestamp()'), /immutable/);
            await assert.rejects(c.sql('UPDATE atlas_staff."SmsPilotControl" SET "accountSid"=$1,revision=revision+1 WHERE application=\'CUSTOMER\'', [`AC${'4'.repeat(32)}`]), /identity is immutable/);
            await c.sql('UPDATE atlas_staff."SmsPilotControl" SET "publicCustomerAdmission"=false,revision=revision+1 WHERE application=\'CUSTOMER\'');
            await assert.rejects(send('+12025550148'), unavailable);
            assert.equal(sends, 3);
            // Revocation fences new sends; it does not falsely revoke an already
            // issued challenge or an authenticated customer's session.
            const pendingResult = await auth.verify(cookie, boot.csrf, { challengeId: pending.challengeId, code: '424242' }, 'public-customer-fixture');
            assert(pendingResult.token);
            assert.equal((await auth.bootstrap(`${cookie}; ${config.cookies.session}=${signed.token}`, 'public-customer-fixture')).customer.id, signed.customer.id);
            assert.deepEqual(await reservations(), ledger);
        } finally { await client.$disconnect(); }
    });
}
