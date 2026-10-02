import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { CustomerAuth } from '../../atlas-customer/lib/server/auth.mjs';
import { CustomerDatabase } from '../../atlas-customer/lib/server/database.mjs';
import { localConfig, fixtureProvider } from '../../atlas-customer/lib/server/fixture.mjs';
import { createEmailVerificationService } from '../../../packages/atlas-customer-intake/src/email-verification.mjs';
import { createCustomerPrivateDatabase } from '../../../packages/atlas-connected-manual/scripts/customer-database.mjs';

// Only the nonce-owned disposable harness may invoke this. Every address,
// uploaded-photo record and provider outcome is synthetic and stays in it.
export async function emailVerificationScenarios(scenario) {
  await scenario('email verification binds account/address, resists scanners, preserves drafts and never retries uncertain delivery', async c => {
    assert.equal(new URL(c.db.adminUrl).hostname, '127.0.0.1');
    assert.match(new URL(c.db.adminUrl).pathname, /^\/atlas_fixture_case_\d+$/);
    for (const [input,expected] of [['  Alex+Cards@EXAMPLE.COM  ','Alex+Cards@example.com'],['Alex@example.com','Alex@example.com'],['alex@example.com','alex@example.com'],['a.b@example.com','a.b@example.com'],['a@@example.com',null],['a b@example.com',null],['\ta@example.com\t',null],['\u00a0a@example.com\u00a0',null]]) {
      assert.equal((await c.sql('SELECT atlas_customer.canonical_email($1) AS email',[input])).rows[0].email,expected);
    }
    const Client = c.admin.constructor;
    const customer = new Client({ datasources: { db: { url: c.db.customerUrl } } });
    const password = randomBytes(24).toString('hex'), privateUrl = new URL(c.db.adminUrl);
    privateUrl.username = 'atlas_email_fixture_private'; privateUrl.password = password; privateUrl.searchParams.set('schema', 'atlas_customer');
    await c.sql(`CREATE ROLE atlas_email_fixture_private LOGIN PASSWORD '${password}'`);
    await c.sql('GRANT USAGE ON SCHEMA atlas_customer TO atlas_email_fixture_private; GRANT EXECUTE ON FUNCTION atlas_customer.customer_private_call(text,jsonb,jsonb) TO atlas_email_fixture_private');
    const privateClient = new Client({ datasources: { db: { url: privateUrl.href } } });
    try {
      const config = localConfig({ databaseUrl: c.db.customerUrl, sessionKey: randomBytes(32), phoneKey: randomBytes(32) });
      await c.sql('INSERT INTO atlas_customer."CustomerControl"(enabled,mode,origin,"deploymentId","releaseSha","configHash") VALUES(true,$1,$2,$3,$4,$5)', Object.values(config.binding));
      await c.sql('INSERT INTO atlas_customer."CustomerServiceControl"(enabled,binding) VALUES(true,$1)', [JSON.stringify(config.binding)]);
      const auth = new CustomerAuth({ config, database: new CustomerDatabase(customer, config), provider: fixtureProvider(config) });
      async function login(phone) {
        const boot = await auth.bootstrap(undefined, 'email-fixture'), browser = `${config.cookies.browser}=${boot.browserToken}`;
        const challenge = await auth.send(browser, boot.csrf, { phone, requestId: randomUUID() }, 'email-fixture');
        const signed = await auth.verify(browser, boot.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'email-fixture');
        const cookie = `${browser}; ${config.cookies.session}=${signed.token}`;
        return { ...signed, cookie, authority: { ...auth.authority(cookie, signed.csrf), binding: config.binding } };
      }
      const owner = await login('+12025550141'), other = await login('+12025550142');
      const guest = await auth.bootstrap(undefined, 'email-scanner-fixture'), guestCookie = `${config.cookies.browser}=${guest.browserToken}`;
      const draftId = randomUUID(), cardId = randomUUID();
      const profile = { name: 'Synthetic Fixture', email: 'Alex+Cards@EXAMPLE.INVALID', address1: '1 Fixture Way', address2: '', city: 'Fixture', region: 'CA', postalCode: '90000', country: 'US' };
      await c.sql('INSERT INTO atlas_customer."CustomerIntakeDraft"(id,"accountId","requestId","inputHash","intakeMethod",state,"profileSnapshot") VALUES($1,$2,$3,$4,\'MAIL_IN\',\'REVIEW\',$5)', [draftId, owner.customer.id, randomUUID(), 'a'.repeat(64), JSON.stringify(profile)]);
      await c.sql('INSERT INTO atlas_customer."CustomerIntakeCard"(id,"draftId","requestId","pairId","inputHash") VALUES($1,$2,$3,$4,$5)', [cardId, draftId, randomUUID(), randomUUID(), 'b'.repeat(64)]);
      for (const side of ['FRONT','BACK']) await c.sql('INSERT INTO atlas_customer."CustomerIntakeUpload"(id,"cardId",side,"fileName",plan,verification) VALUES($1,$2,$3,$4,$5,$6)',
        [randomUUID(), cardId, side, `synthetic-${side}.jpg`, JSON.stringify({ synthetic: true, side }), JSON.stringify({ synthetic: true, sha256: 'c'.repeat(64) })]);
      const saved = await auth.call(owner.cookie, 'intake_read', { id: draftId });
      const uploads = (await c.sql('SELECT * FROM atlas_customer."CustomerIntakeUpload" ORDER BY id')).rows;
      const authorityCounts = async () => (await c.sql('SELECT (SELECT count(*)::int FROM atlas_customer."CustomerAccount") accounts,(SELECT count(*)::int FROM atlas_customer."CustomerSession") sessions')).rows[0];
      const beforeAuthority = await authorityCounts();
      const controls = (await c.sql('SELECT to_jsonb(c) AS value FROM atlas_customer."CustomerControl" c UNION ALL SELECT to_jsonb(s) FROM atlas_staff."StaffControl" s')).rows;
      const proof = async (aid = owner.customer.id, email = profile.email) => (await c.sql('SELECT atlas_customer.email_verified($1,$2) AS verified', [aid,email])).rows[0].verified;
      const privateDb = createCustomerPrivateDatabase({ client: privateClient, binding: config.binding });
      const sent = []; let uncertain = false;
      const service = createEmailVerificationService({ enabled: true, call: (name, input) => privateDb.call('email', { name, input }), sender: {
        async sendVerification(input) {
          // An independent connection sees the durable committed claim first.
          assert.equal((await c.sql('SELECT count(*)::int n FROM atlas_customer."CustomerEmailVerification"')).rows[0].n, sent.length + 1);
          sent.push(input); if (uncertain) throw Error('Synthetic lost provider reply');
          return { provider: 'SENDGRID', providerId: `synthetic-${sent.length}`, deliveryStatus: 'ACCEPTED' };
        },
      } });
      const token = () => new URL(sent.at(-1).verificationUrl).hash.slice('#token='.length);
      const request = (requestId = randomUUID()) => service.request(owner.authority, { draftId, requestId });
      const status = () => auth.call(owner.cookie, 'email_status', { draftId });
      const age = () => c.sql('UPDATE atlas_customer."CustomerEmailVerification" SET "createdAt"="createdAt"-interval \'2 minutes\',"expiresAt"="expiresAt"-interval \'2 minutes\'');
      const address = async email => { profile.email = email; await c.sql('UPDATE atlas_customer."CustomerIntakeDraft" SET "profileSnapshot"=$2,revision=revision+1 WHERE id=$1', [draftId,JSON.stringify(profile)]); };
      const confirm = (who, raw = token(), mode = 'AUTO') => auth.confirmEmail(who.cookie, who.csrf, { token: raw, mode }, 'email-fixture');
      assert.equal((await status()).state, 'UNSENT'); assert.equal(await proof(), false);
      await assert.rejects(service.request(other.authority, { draftId, requestId: randomUUID() }), { code: 'NOT_FOUND' });
      const permissionDenied = error => error?.meta?.code === '42501' && /permission denied/.test(error.message);
      await assert.rejects(customer.$executeRawUnsafe('INSERT INTO atlas_customer."CustomerVerifiedEmail"("accountId",email) VALUES($1::uuid,$2)', owner.customer.id, profile.email), permissionDenied);
      await assert.rejects(privateClient.$queryRawUnsafe('SELECT * FROM atlas_customer."CustomerEmailVerification"'), permissionDenied);
      const requestId = randomUUID(); assert.equal((await request(requestId)).state, 'SENT');
      assert.equal((await request(requestId)).state, 'SENT'); assert.equal(sent.length, 1);
      await assert.rejects(request(), { code: 'EMAIL_VERIFICATION_WAIT' });
      assert.deepEqual(await confirm(other), { verified: false, requiresConfirmation: true });
      assert.deepEqual(await confirm({ cookie: guestCookie, csrf: guest.csrf }), { verified: false, requiresConfirmation: true });
      assert.equal(await proof(), false); // Token alone/another signed-in account cannot auto-confirm.
      const verified = await confirm(owner); assert.equal(verified.resumeDraftId, draftId);
      assert.equal(await proof(), true); assert.equal(await proof(other.customer.id), false);
      const once = (await c.sql('SELECT * FROM atlas_customer."CustomerVerifiedEmail"')).rows;
      assert.deepEqual(await confirm(owner), verified);
      assert.deepEqual((await c.sql('SELECT * FROM atlas_customer."CustomerVerifiedEmail"')).rows, once);
      assert.equal((await request()).verified, true); assert.equal(sent.length, 1); // Once per account/address.
      assert.deepEqual(await auth.call(owner.cookie, 'intake_read', { id: draftId }), saved);
      assert.deepEqual((await c.sql('SELECT * FROM atlas_customer."CustomerIntakeUpload" ORDER BY id')).rows, uploads);
      await assert.rejects(auth.call(other.cookie, 'intake_read', { id: draftId }), { code: 'NOT_FOUND' });
      await age(); await address('changed@example.invalid'); await request(); const changedToken = token();
      assert.equal(await proof(), false);
      const crossBrowser = await confirm({ cookie: guestCookie, csrf: guest.csrf }, changedToken, 'CONFIRM');
      assert.deepEqual(crossBrowser, { verified: true });
      assert.equal((await auth.bootstrap(guestCookie, 'email-scanner-fixture')).customer, null);
      assert.equal((await status()).verified, true); // Original authenticated tab resumes via polling.
      await age(); await address('uncertain@example.invalid'); uncertain = true;
      const unknownId = randomUUID(); assert.equal((await request(unknownId)).state, 'UNKNOWN');
      const sends = sent.length; await request(unknownId); assert.equal(sent.length, sends); uncertain = false;
      const stale = token(); await age(); await request();
      await assert.rejects(confirm(owner, stale), { code: 'EMAIL_LINK_INVALID' });
      const changed = token(); await address('new-address@example.invalid');
      await assert.rejects(confirm(owner, changed), { code: 'EMAIL_LINK_CHANGED' }); assert.equal(await proof(), false);
      await age(); await assert.rejects(request(), { code: 'EMAIL_VERIFICATION_WAIT' });
      await c.sql('UPDATE atlas_customer."CustomerRateBucket" SET "expiresAt"=clock_timestamp()-interval \'1 second\'');
      await request(); const expired = token();
      await c.sql('UPDATE atlas_customer."CustomerEmailVerification" SET "createdAt"="createdAt"-interval \'31 minutes\',"expiresAt"="expiresAt"-interval \'31 minutes\' WHERE state=\'SENT\'');
      await assert.rejects(confirm(owner, expired), { code: 'EMAIL_LINK_INVALID' });
      const quoteId = randomUUID(), snapshot = { profile: { email: profile.email }, channel: 'MAIL_IN', cards: [{cardId}] };
      const quote = () => c.sql('INSERT INTO atlas_customer."CommerceQuote"(id,"accountId","draftId","draftRevision","contentHash",snapshot,"expiresAt") VALUES($1,$2,$3,1,$4,$5,clock_timestamp()+interval \'15 minutes\')', [quoteId,owner.customer.id,draftId,'d'.repeat(64),JSON.stringify(snapshot)]);
      await assert.rejects(quote(), /verified receipt email required/);
      await request(); await confirm(owner); await quote();
      await c.sql('INSERT INTO atlas_customer."WeeklyCapacitySharedWeek"("weekStartsAt","resetsAt","quotaCards") SELECT "weekStartsAt","resetsAt",10 FROM atlas_customer.weekly_capacity_week(clock_timestamp())');
      const paymentId = randomUUID(), paymentRequest = randomUUID(), merchant = { provider: 'STRIPE', accountId: 'acct_email_fixture', livemode: false }, providerBinding = { configHash: 'e'.repeat(64), merchant };
      await c.sql('INSERT INTO atlas_customer."CommerceControl"(enabled,binding,merchant) VALUES(true,$1,$2)', [JSON.stringify(providerBinding),JSON.stringify(merchant)]);
      await c.sql('INSERT INTO atlas_customer."CommercePayment"(id,"accountId","draftId","quoteId","requestId",merchant,state) VALUES($1,$2,$3,$4,$5,$6,\'UNKNOWN\')', [paymentId,owner.customer.id,draftId,quoteId,paymentRequest,JSON.stringify(merchant)]);
      await c.sql('DELETE FROM atlas_customer."CustomerVerifiedEmail" WHERE "accountId"=$1 AND email=$2', [owner.customer.id,profile.email]);
      const recovered = await privateDb.call('commerce', { name: 'commerce_reserve_payment', providerBinding,
        input: { authority: owner.authority, quoteId, requestId: paymentRequest, attemptId: randomUUID(), merchant } });
      assert.equal(recovered.dispatch, false); assert.equal(recovered.attempt.id, paymentId);
      assert.equal((await status()).required, false); // Existing attempt never demands a second purchase/verification.
      await assert.rejects(c.sql('INSERT INTO atlas_customer."CommercePayment"(id,"accountId","draftId","quoteId","requestId",merchant,state) VALUES($1,$2,$3,$4,$5,\'{}\',\'DISPATCHED\')', [randomUUID(),owner.customer.id,draftId,quoteId,randomUUID()]), /verified receipt email required/);
      assert.equal((await c.sql('SELECT atlas_customer.commerce_source($1)->\'emailVerified\' AS verified', [draftId])).rows[0].verified, false);
      assert.deepEqual((await c.sql('SELECT * FROM atlas_customer."CustomerIntakeUpload" ORDER BY id')).rows, uploads);
      assert.deepEqual(await authorityCounts(), beforeAuthority);
      assert.deepEqual((await c.sql('SELECT to_jsonb(c) AS value FROM atlas_customer."CustomerControl" c UNION ALL SELECT to_jsonb(s) FROM atlas_staff."StaffControl" s')).rows, controls);
      for (const [name, role] of [['customer_call',new URL(c.db.customerUrl).username],['customer_private_call','atlas_email_fixture_private']]) {
        const rows = (await c.sql('SELECT p.proname,pg_get_userbyid(p.proowner) AS owner,has_function_privilege($1,p.oid,\'EXECUTE\') AS allowed FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=\'atlas_customer\' AND p.proname=ANY($2::text[]) ORDER BY p.proname', [role,[name,name+'_before_email_verification']])).rows;
        assert.equal(rows.length,2); assert.equal(rows[0].owner,rows[1].owner);
        assert.equal(rows.find(r=>r.proname===name).allowed,true);
        assert.equal(rows.find(r=>r.proname!==name).allowed,false);
      }
    } finally { await customer.$disconnect(); await privateClient.$disconnect(); }
  });
}
