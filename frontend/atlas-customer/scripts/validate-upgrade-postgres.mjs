import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '../../atlas-app/.generated/staff-database/index.js';
import { disposablePostgres } from '../../atlas-app/scripts/disposable-postgres.mjs';
import { makeAccessConfig } from '../../atlas-app/lib/server/access/config.mjs';
import { BROWSER_COOKIE, SESSION_COOKIE, LOCAL_ORIGIN } from '../../atlas-app/lib/server/policy.mjs';
import { STAFF_BASE_PATH } from '../../atlas-app/lib/routes.mjs';
import { DurableStaffAuth } from '../../atlas-app/lib/server/access/auth.mjs';
import { StaffDatabase } from '../../atlas-app/lib/server/access/database.mjs';
import { CustomerAuth } from '../lib/server/auth.mjs';
import { CustomerDatabase, assertCustomerPrivileges } from '../lib/server/database.mjs';
import { localConfig, fixtureProvider } from '../lib/server/fixture.mjs';
import { assertCustomerPrivatePrivileges, customerPrivateGrantSQL, createCustomerPrivateDatabase } from '../../../packages/atlas-connected-manual/scripts/customer-database.mjs';

// This command accepts only the owned disposable harness's arguments. All
// phone/provider/authority data below is synthetic, never a production approval.
const checks = [], clients = [], passwords = [];
let fixture, before, context, customerConfig, customerAuth, customerClient, staffOperations, staffAuthority;
let first, second, originalRequest, originalSubmission, originalEventRequest, originalEvent;
const profile = { name: 'Synthetic Legacy Customer', address1: '1 Fixture Road', address2: '', city: 'Example', region: 'CA', postalCode: '90001', country: 'US' };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const client = url => { const value = new PrismaClient({ datasources: { db: { url } } }); clients.push(value); return value; };
const retain = (name, value) => writeFileSync(join(context.directory, name), JSON.stringify(value, null, 2), { mode: 0o600 });
async function login(auth, config, phone) {
    const boot = await auth.bootstrap(undefined, 'upgrade-fixture'), initial = `${config.cookies.browser}=${boot.browserToken}`;
    const challenge = await auth.send(initial, boot.csrf, { phone, requestId: randomUUID() }, 'upgrade-fixture');
    const signed = await auth.verify(initial, boot.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'upgrade-fixture');
    return { ...signed, cookie: `${initial}; ${config.cookies.session}=${signed.token}` };
}
const call = (action, input, who = first) => customerAuth.call(who.cookie, action, input, who.csrf);

async function snapshot(sql, oldTables) {
    const tables = oldTables ?? (await sql(`SELECT n.nspname AS schema,c.relname AS name,
        format('%I.%I',n.nspname,c.relname) AS relation FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE c.relkind='r' AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'
        AND c.relname<>'_prisma_migrations' ORDER BY n.nspname,c.relname`)).rows;
    const rows = [];
    for (const table of tables) {
        const [row] = (await sql(`SELECT count(*)::int AS count,
            encode(sha256(convert_to(COALESCE(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),''),'UTF8')),'hex') AS row_sha256,
            encode(sha256(convert_to(COALESCE(string_agg(to_jsonb(t)::text||t.xmin::text||t.ctid::text,E'\\n' ORDER BY to_jsonb(t)::text),''),'UTF8')),'hex') AS physical_sha256
            FROM ${table.relation} t`)).rows;
        rows.push({ ...table, ...row });
    }
    const functions = (await sql(`SELECT p.oid::text AS oid,n.nspname AS schema,p.proname AS name,
        oidvectortypes(p.proargtypes) AS arguments,pg_get_userbyid(p.proowner) AS owner,p.prosecdef AS definer,
        p.proconfig AS config,p.proacl::text AS acl,p.provolatile AS volatility,l.lanname AS language,
        encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') AS body_sha256
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
        WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' ORDER BY p.oid`)).rows;
    const grants = (await sql(`SELECT n.nspname AS schema,c.relname AS name,c.relacl::text AS acl,
        (SELECT jsonb_agg(jsonb_build_object('column',a.attname,'acl',a.attacl::text) ORDER BY a.attnum)
        FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL) AS column_acls
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','v','m','f','S')
        AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' ORDER BY n.nspname,c.relname`)).rows;
    const schemas = (await sql(`SELECT nspname AS name,nspacl::text AS acl FROM pg_namespace
        WHERE nspname NOT LIKE 'pg_%' AND nspname<>'information_schema' ORDER BY nspname`)).rows;
    const roles = (await sql(`SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls
        FROM pg_roles ORDER BY rolname`)).rows;
    const memberships = (await sql('SELECT roleid::text,member::text,grantor::text,admin_option FROM pg_auth_members ORDER BY roleid,member,grantor')).rows;
    const publicLedger = (await sql('SELECT * FROM public."_prisma_migrations" ORDER BY migration_name,id')).rows;
    const staffLedger = (await sql('SELECT * FROM atlas_staff."_prisma_migrations" ORDER BY migration_name,id')).rows;
    return { rows, functions, grants, schemas, roles, memberships, publicLedger, staffLedger };
}

async function seedBefore48(ctx) {
    context = ctx;
    const admin = client(ctx.adminUrl), staffClient = client(ctx.staffUrl);
    customerClient = client(ctx.customerUrl); staffOperations = client(ctx.operationsUrl);
    customerConfig = localConfig({ databaseUrl: ctx.customerUrl, sessionKey: randomBytes(32), phoneKey: randomBytes(32) });
    customerAuth = new CustomerAuth({ config: customerConfig, database: new CustomerDatabase(customerClient, customerConfig), provider: fixtureProvider(customerConfig) });
    await ctx.sql(`INSERT INTO atlas_customer."CustomerControl"(enabled,mode,origin,"deploymentId","releaseSha","configHash")
        VALUES(true,$1,$2,$3,$4,$5)`, ['mode','origin','deploymentId','releaseSha','configHash'].map(key => customerConfig[key]));
    const staffConfig = makeAccessConfig({ mode: 'LOCAL_FIXTURE', origin: LOCAL_ORIGIN, basePath: STAFF_BASE_PATH,
        deploymentId: 'local-postgres-fixture', releaseSha: '0'.repeat(40), accountSid: `AC${'1'.repeat(32)}`,
        serviceSid: `VA${'2'.repeat(32)}`, databaseUrl: ctx.staffUrl,
        cookies: { browser: BROWSER_COOKIE, session: SESSION_COOKIE }, sessionKey: randomBytes(32), phoneKey: randomBytes(32),
        approvedPhones: new Set(['+12025550141']), providerLifetimeMs: 600_000 });
    await admin.staffControl.create({ data: { enabled: true, mode: staffConfig.mode, origin: staffConfig.origin,
        deploymentId: staffConfig.deploymentId, releaseSha: staffConfig.releaseSha, configHash: staffConfig.configHash } });
    await admin.staffIdentity.create({ data: { id: randomUUID(), phoneHash: [...staffConfig.phoneByHash.keys()][0], name: 'Synthetic upgrade reviewer', role: 'REVIEWER' } });
    const staffAuth = new DurableStaffAuth({ config: staffConfig, database: new StaffDatabase(staffClient, staffConfig), provider: fixtureProvider(staffConfig) });
    const reviewer = await login(staffAuth, staffConfig, '+12025550141');
    const identity = await admin.staffIdentity.findUnique({ where: { id: reviewer.staff.id } });
    // Deliberate fixture authority only, restricted to this owned LOCAL_FIXTURE DB.
    await admin.staffOperationsGrant.create({ data: { id: randomUUID(), identityId: identity.id, accessVersion: identity.accessVersion,
        controlRevision: 1, mode: staffConfig.mode, origin: staffConfig.origin, deploymentId: staffConfig.deploymentId,
        releaseSha: staffConfig.releaseSha, configHash: staffConfig.configHash, authorizationEvidenceHash: 'a'.repeat(64),
        createdAt: new Date(Date.now() - 1000), expiresAt: new Date(Date.now() + 3600_000) } });
    staffAuthority = { ...staffAuth.actors.get(reviewer.staff), binding: Object.fromEntries(['mode','origin','deploymentId','releaseSha','configHash'].map(k => [k, staffConfig[k]])) };
    first = await login(customerAuth, customerConfig, '+12025550401');
    second = await login(customerAuth, customerConfig, '+12025550402');
    await call('profile', { profile });
    originalRequest = { requestId: randomUUID(), profile, confirmed: true, intakeMethod: 'MAIL_IN', cards: [
        { title: 'Synthetic Legacy Sports', category: 'SPORTS' }, { title: 'Synthetic Legacy Pokémon', category: 'POKEMON' }] };
    originalSubmission = (await call('submit', { submission: originalRequest })).submission;
    await call('submit', { submission: { ...originalRequest, requestId: randomUUID(), intakeMethod: 'DEALER_DROP_OFF', cards: [originalRequest.cards[0]] } }, second);
    const cardId = originalSubmission.cards[0].id;
    await operations('action', { operationId: randomUUID(), cardId, reason: 'CARD_DETAILS_NEEDED', message: 'Synthetic fixture needs details.', resolved: false });
    originalEventRequest = { operationId: randomUUID(), cardId, reason: 'CARD_DETAILS_NEEDED', message: null, resolved: true };
    originalEvent = await operations('action', originalEventRequest);
    assert.equal(originalEvent.receipt.kind, 'ACTION_RESOLVED');
    originalSubmission = (await call('submission', { id: originalSubmission.id })).submission;
    before = await snapshot(ctx.sql);
    for (const [name, count] of Object.entries({ CustomerAccount: 2, CustomerSession: 2, CustomerSubmission: 2, CustomerCard: 3, CustomerCardEvent: 2 }))
        assert.equal(before.rows.find(r => r.schema === 'atlas_customer' && r.name === name)?.count, count, name);
    assert.equal(before.staffLedger.length, 48);
    assert.equal(before.functions.filter(f => f.schema === 'atlas_customer' && f.name === 'customer_call').length, 1);
    assert(!before.functions.some(f => f.schema === 'atlas_customer' && f.name === 'customer_call_v1'));
    await customerClient.$transaction(assertCustomerPrivileges);
    retain('upgrade-before.json', before);
    checks.push('schema48: actual restricted customer SMS sessions, legacy profiles and both-channel submissions; original staff gateway creates action/resolution events');
}
async function operations(action, input) {
    const rows = await staffOperations.$queryRaw`SELECT atlas_staff.customer_operations(${action},${staffAuthority.sessionHash},${staffAuthority.browserHash},${JSON.stringify(staffAuthority.binding)}::jsonb,${JSON.stringify(input)}::jsonb) AS result`;
    assert(!rows[0].result.error, rows[0].result.error?.code); return rows[0].result;
}

try {
    fixture = await disposablePostgres(process.argv.slice(2), { beforeUpgradeFrom48: seedBefore48 });
    const sql = context.sql;
    const after = await snapshot(sql, before.rows.map(({ schema, name, relation }) => ({ schema, name, relation })));
    retain('upgrade-after.json', after);
    assert.deepEqual(after.rows, before.rows, 'Existing row bytes or xmin/ctid changed during upgrade');
    assert.deepEqual(after.publicLedger, before.publicLedger);
    assert.deepEqual(after.staffLedger.slice(0, 48), before.staffLedger); assert.equal(after.staffLedger.length, 52);
    assert.deepEqual(after.roles, before.roles); assert.deepEqual(after.memberships, before.memberships);
    for (const old of before.grants) assert.deepEqual(after.grants.find(g => g.schema === old.schema && g.name === old.name), old);
    for (const old of before.schemas) assert.deepEqual(after.schemas.find(s => s.name === old.name), old);
    checks.push('all preexisting table contents and physical row versions, public ledger, first48 staff ledger rows, table/column/schema ACLs, roles and memberships unchanged');
    const originalGateway = before.functions.find(f => f.schema === 'atlas_customer' && f.name === 'customer_call');
    const retainedGateway = after.functions.find(f => f.oid === originalGateway.oid);
    assert.equal(retainedGateway.name, 'customer_call_v1');
    assert.deepEqual({ ...retainedGateway, name: originalGateway.name, acl: originalGateway.acl }, originalGateway);
    const wrapper = after.functions.find(f => f.schema === 'atlas_customer' && f.name === 'customer_call');
    assert.equal(wrapper.acl, originalGateway.acl); assert.equal(wrapper.owner, originalGateway.owner); assert.equal(wrapper.definer, true);
    for (const old of before.functions) {
        if (old.oid === originalGateway.oid || (old.schema === 'atlas_customer' && old.name === 'valid_profile')) continue;
        assert.deepEqual(after.functions.find(f => f.oid === old.oid), old, `Prior function changed: ${old.schema}.${old.name}`);
    }
    const oldProfile = before.functions.find(f => f.schema === 'atlas_customer' && f.name === 'valid_profile');
    const newProfile = after.functions.find(f => f.oid === oldProfile.oid);
    // Migration49 explicitly adds the private helper schema to this invoker's
    // fixed search path. Its identity, owner and ACL still must not change.
    assert.deepEqual(newProfile.config, ['search_path=pg_catalog, atlas_customer']);
    assert.deepEqual({ ...newProfile, body_sha256: oldProfile.body_sha256, config: oldProfile.config }, oldProfile);
    checks.push('original gateway OID/body/owner/security/settings retained; exact existing EXECUTE ACL moves to wrapper; other predecessor functions unchanged except approved profile body and fixed search path');
    await customerClient.$transaction(assertCustomerPrivileges);
    for (const query of [
        `SELECT atlas_customer.customer_call_v1('list','{}'::jsonb,'{}'::jsonb)`,
        `SELECT atlas_customer.customer_private_call('directory','{}'::jsonb,'{}'::jsonb)`,
        `SELECT atlas_customer.intake_worker_call('claim','{}'::jsonb)`,
        `SELECT atlas_customer.commerce_provider_call('commerce_pending_effects','{}'::jsonb,'{}'::jsonb)`,
        `SELECT * FROM atlas_customer."CustomerAccount"`, `SELECT * FROM atlas_customer."CommerceOrder"`,
        `SELECT * FROM atlas_dealer.location`,
    ]) await assert.rejects(customerClient.$queryRawUnsafe(query), /permission denied/);
    checks.push('original customer role passes exact one-function privilege verifier without regrant; old/internal/private gateways and direct tables denied');
    const boot = await customerAuth.bootstrap(first.cookie, 'upgrade-fixture');
    assert.equal(boot.customer.id, first.customer.id); assert.deepEqual(boot.customer.profile, profile);
    assert.deepEqual((await call('submission', { id: originalSubmission.id })).submission, originalSubmission);
    assert.deepEqual((await call('submission_request', { id: originalRequest.requestId })).submission, originalSubmission);
    assert.deepEqual((await call('submit', { submission: originalRequest })).submission, originalSubmission);
    assert.equal((await call('list', { cursor: null })).submissions[0].id, originalSubmission.id);
    assert.deepEqual((await call('card', { id: originalSubmission.cards[0].id })).card, originalSubmission.cards[0]);
    assert.deepEqual(await operations('action', originalEventRequest), originalEvent);
    await assert.rejects(call('submission', { id: originalSubmission.id }, second), { code: 'NOT_FOUND' });
    await assert.rejects(call('card', { id: originalSubmission.cards[0].id }, second), { code: 'NOT_FOUND' });
    await assert.rejects(call('submit', { submission: { ...originalRequest, intakeMethod: 'DEALER_DROP_OFF' } }), { code: 'REQUEST_CONFLICT' });
    assert.deepEqual((await snapshot(sql, before.rows.map(({ schema, name, relation }) => ({ schema, name, relation })))).rows, before.rows,
        'Old read/retry requests changed preserved histories');
    checks.push('same pre-upgrade session, profile, list/detail/card/request reads and exact submit/staff-event retries survive; foreign ownership and changed retries denied without row changes');
    const profileValidity = (await sql('SELECT atlas_customer.valid_profile($1::jsonb) AS legacy,atlas_customer.valid_profile($2::jsonb) AS current,atlas_customer.valid_profile($3::jsonb) AS invalid',
        [JSON.stringify(profile), JSON.stringify({ ...profile, email: 'fixture@example.test' }), JSON.stringify({ ...profile, email: 'invalid' })])).rows[0];
    assert.deepEqual(profileValidity, { legacy: true, current: true, invalid: false });
    checks.push('legacy no-email profiles remain valid; complete email profile accepted and malformed email rejected');
    const cold = (await sql(`SELECT (SELECT count(*)::int FROM atlas_customer."CustomerServiceControl") AS service,
        (SELECT count(*)::int FROM atlas_customer."CommerceControl") AS commerce,(SELECT count(*)::int FROM atlas_dealer.location) AS locations,
        (SELECT count(*)::int FROM atlas_dealer.membership) AS memberships,(SELECT count(*)::int FROM atlas_customer."CommerceOrder") AS orders,
        (SELECT count(*)::int FROM atlas_customer."CustomerIntakeDraft") AS drafts`)).rows[0];
    assert.deepEqual(cold, { service: 0, commerce: 0, locations: 0, memberships: 0, orders: 0, drafts: 0 });
    const defaults = (await sql(`SELECT table_name,column_name,column_default FROM information_schema.columns
        WHERE table_schema='atlas_customer' AND ((table_name='CustomerServiceControl' AND column_name IN ('enabled','identificationEnabled'))
        OR (table_name='CommerceControl' AND column_name='enabled')) ORDER BY table_name,column_name`)).rows;
    assert.equal(defaults.length, 3); assert(defaults.every(row => row.column_default === 'false'));
    checks.push('new customer service, identification and commerce controls remain absent with false defaults; no invented dealer/location/order or legacy conversion');
    const privateRole = 'atlas_fixture_upgrade_private', password = randomBytes(24).toString('hex'); passwords.push(password);
    await sql(`CREATE ROLE ${privateRole} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await sql(customerPrivateGrantSQL(privateRole));
    const privateUrl = new URL(context.customerUrl); privateUrl.username = privateRole; privateUrl.password = password;
    const privateClient = client(privateUrl.href);
    await privateClient.$transaction(assertCustomerPrivatePrivileges);
    const privateDatabase = createCustomerPrivateDatabase({ client: privateClient, binding: customerConfig.binding });
    await assert.rejects(privateDatabase.call('directory', { input: {} }), { code: 'CUSTOMER_SERVICE_NOT_ENABLED' });
    await assert.rejects(privateClient.$queryRaw`SELECT atlas_customer.customer_call('list','{}'::jsonb,'{}'::jsonb)`, /permission denied/);
    await assert.rejects(privateClient.$queryRaw`SELECT atlas_customer.intake_worker_call('claim','{}'::jsonb)`, /permission denied/);
    await assert.rejects(privateClient.$queryRaw`SELECT * FROM atlas_customer."CustomerSession"`, /permission denied/);
    await assert.rejects(privateClient.$queryRaw`SELECT * FROM atlas_dealer.location`, /permission denied/);
    await customerClient.$transaction(assertCustomerPrivileges);
    checks.push('new separately provisioned private role passes exact one-function verifier, is denied customer/internal/table access and refuses work while service control is absent');
    // Functionality after preservation checks: ordinary legacy writes still work,
    // but all previously created immutable history must remain byte-identical.
    const freshRequest = { ...originalRequest, requestId: randomUUID(), cards: [originalRequest.cards[0]] };
    const newSubmission = (await call('submit', { submission: freshRequest })).submission;
    assert.notEqual(newSubmission.id, originalSubmission.id);
    assert.equal((await call('submit', { submission: freshRequest })).submission.id, newSubmission.id);
    assert.deepEqual((await call('submission', { id: originalSubmission.id })).submission, originalSubmission);
    const priorImmutable = before.rows.filter(r => r.schema === 'atlas_customer' && r.name === 'CustomerCardEvent');
    assert.deepEqual((await snapshot(sql, priorImmutable.map(({ schema, name, relation }) => ({ schema, name, relation })))).rows, priorImmutable);
    checks.push('new legacy submission succeeds with the original no-email request contract and exact retry remains idempotent; existing event history stays intact');
    const result = { pass: true, syntheticOnly: true, networkProviders: false, preUpgradeStaffMigrations: 48,
        publicMigrations: fixture.source.publicMigrations.length, staffMigrations: fixture.source.staffMigrations.length,
        postgres: (await sql('SELECT version() AS version')).rows[0].version, node: process.version,
        oldTablesVerified: before.rows.length, populatedTablesVerified: before.rows.filter(r => r.count > 0).length,
        originalGatewayBodySha256: originalGateway.body_sha256, originalGatewayAclSha256: digest(originalGateway.acl),
        beforeSnapshotSha256: digest(before), afterSnapshotSha256: digest(after), checks, evidenceDirectory: fixture.directory };
    retain('upgrade-result.json', result); process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
    if (context) retain('upgrade-result.json', { pass: false, syntheticOnly: true, checks,
        error: passwords.reduce((text, password) => text.replaceAll(password, '[fixture-password]'), fixture ? fixture.safe(error.message) : 'Upgrade initialization failed; see harness result.json'), evidenceDirectory: context.directory });
    throw error;
} finally {
    await Promise.allSettled(clients.map(value => value.$disconnect()));
    await fixture?.stop();
}
