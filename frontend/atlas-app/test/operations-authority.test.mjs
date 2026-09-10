import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DurableStaffAuth } from '../lib/server/access/auth.mjs';
import { makeAccessConfig } from '../lib/server/access/config.mjs';
import { OPERATION_GRANTS, StaffOperationsAuthority, makeOperationsAuthorityConfig, operationsGrantSQL }
    from '../lib/server/access/operations-authority.mjs';

const NOW = new Date('2026-09-08T18:00:00.000Z'), SHA = 'a'.repeat(64), BROWSER = 'b'.repeat(64);
function fixture() {
    const config = makeAccessConfig({ mode: 'LOCAL_FIXTURE', origin: 'http://127.0.0.1:4318', basePath: '/admin', deploymentId: 'operations-authority-fixture',
        releaseSha: '0'.repeat(40), databaseUrl: 'postgresql://staff_fixture:fictional@127.0.0.1:54329/fictional?schema=atlas_staff',
        sessionKey: Buffer.alloc(32, 1), phoneKey: Buffer.alloc(32, 2), approvedPhones: new Set(['+12025550141']),
        accountSid: `AC${'1'.repeat(32)}`, serviceSid: `VA${'2'.repeat(32)}`, providerLifetimeMs: 600_000 });
    const operationsConfig = makeOperationsAuthorityConfig({ databaseUrl:
        'postgresql://operations_fixture:alsofictional@127.0.0.1:54329/fictional?schema=atlas_staff', staffConfig: config });
    const identityId = randomUUID();
    const state = {
        control: { id: 'active', enabled: true, revision: 3, mode: config.mode, origin: config.origin,
            deploymentId: config.deploymentId, releaseSha: config.releaseSha, configHash: config.configHash },
        identity: { id: identityId, phoneHash: [...config.phoneByHash.keys()][0], name: 'Fictional human',
            role: 'REVIEWER', revokedAt: null, accessVersion: 4 },
        browser: { tokenHash: BROWSER, controlRevision: 3, createdAt: new Date(+NOW - 120_000), expiresAt: new Date(+NOW + 3600_000) },
        session: { tokenHash: SHA, identityId, browserHash: BROWSER, controlRevision: 3, accessVersion: 4,
            revokedAt: null, createdAt: new Date(+NOW - 60_000), expiresAt: new Date(+NOW + 1200_000) },
        role: { role: operationsConfig.roleName, database: operationsConfig.databaseName, unsafe: false },
        schemas: [], sequences: [], functions: ['lock_control()', 'lock_operations_grants(uuid)', 'lock_source_admissions(uuid, text, uuid, text, text, text)',
            'apply_operational_resolution(uuid)', 'customer_operations(text, text, text, jsonb, jsonb)'].map(name => ({ name, schema: 'atlas_staff', definer: true })),
        columns: Object.entries(OPERATION_GRANTS).flatMap(([name, grants]) =>
            [...new Set(['id', ...(grants.INSERT ?? []), ...(grants.UPDATE ?? [])])].map(column => ({ schema: 'atlas_staff', name, column,
                sel: true, ins: grants.INSERT?.includes(column) === true, upd: grants.UPDATE?.includes(column) === true, refs: false, extra: false }))),
        grants: [], firstNow: NOW, lastNow: NOW, value: null, deferredFailure: false,
    };
    state.grants.push({ id: randomUUID(), identityId, accessVersion: 4, controlRevision: 3, mode: config.mode,
        origin: config.origin, deploymentId: config.deploymentId, releaseSha: config.releaseSha, configHash: config.configHash,
        authorizationEvidenceHash: SHA, createdAt: new Date(+NOW - 3600_000), expiresAt: new Date(+NOW + 3600_000), revokedAt: null });
    const log = []; let transactions = 0, clockReads = 0;
    const tx = {
        staffSession: { async findUnique({ where }) {
            log.push('session');
            return where.tokenHash === state.session.tokenHash ? structuredClone({ ...state.session, browser: state.browser, identity: state.identity }) : null;
        } },
        async $queryRaw(strings, ...values) {
            const sql = strings.join('?');
            if (sql.includes('FROM pg_roles')) { log.push('privileges-role'); return [structuredClone(state.role)]; }
            if (sql.includes('FROM pg_namespace')) return state.schemas;
            if (sql.includes('JOIN pg_attribute')) return state.columns;
            if (sql.includes("c.relkind='S'")) return state.sequences;
            if (sql.includes('FROM pg_proc')) return state.functions;
            if (sql.includes('lock_control()')) { log.push('control-lock'); return [structuredClone(state.control)]; }
            if (sql.includes('clock_timestamp()')) { log.push('clock'); return [{ now: clockReads++ === 0 ? state.firstNow : state.lastNow }]; }
            if (sql.includes('"StaffIdentity"')) {
                assert.ok(sql.includes('FOR SHARE')); log.push('identity-lock');
                return values[0] === state.identity.id ? [structuredClone(state.identity)] : [];
            }
            if (sql.includes('lock_operations_grants')) {
                assert.equal(values[0], state.identity.id); log.push('grant-lock'); return structuredClone(state.grants);
            }
            throw new Error(`Unexpected fixture SQL: ${sql}`);
        },
        async $executeRaw(strings) {
            const sql = strings.join('?');
            if (sql.includes('pg_advisory_xact_lock')) { log.push('common-lock'); return 1; }
            assert.equal(sql, 'SET CONSTRAINTS ALL IMMEDIATE'); log.push('constraints');
            if (state.deferredFailure) throw new Error('SYNTHETIC_DEFERRED_FAILURE');
            return 0;
        },
    };
    const servingClient = {};
    const auth = new DurableStaffAuth({ config, database: { client: servingClient, async transaction() { throw new Error('NESTED_SERVING_TRANSACTION'); } },
        provider: { async start() { throw new Error('NO_PROVIDER'); }, async check() { throw new Error('NO_PROVIDER'); } } });
    const staff = auth.actor({ identity: state.identity, session: state.session }, BROWSER);
    const client = { async $transaction(work, options) {
        transactions++; clockReads = 0; log.push('transaction');
        assert.deepEqual(options, { maxWait: 5000, timeout: 10_000 });
        const before = structuredClone(state);
        try { const result = await work(tx); log.push('commit'); return result; }
        catch (error) { Object.assign(state, before); log.push('rollback'); throw error; }
    } };
    const authority = new StaffOperationsAuthority({ client, auth, config: operationsConfig });
    return { state, config, operationsConfig, auth, staff, client, servingClient, authority, log, transactions: () => transactions };
}
const rejected = (promise, code) => assert.rejects(promise, error => error.message === code);

test('opaque durable human handle is revalidated under common/control/identity/grant locks, then fresh clock and constraints', async () => {
    const f = fixture();
    const result = await f.authority.transaction(f.staff, context => {
        f.log.push('work'); assert.equal(context.actorKind, 'HUMAN'); assert.equal(context.capability, 'OPERATIONS');
        assert.deepEqual(context.capabilityUntil, f.state.grants[0].expiresAt);
        assert.equal(context.operationsGrantId, f.state.grants[0].id); assert.equal(context.identity.id, f.state.identity.id);
        f.state.value = 'saved'; return { saved: true };
    });
    assert.deepEqual(result, { saved: true }); assert.equal(f.state.value, 'saved');
    assert.deepEqual(f.log, ['transaction', 'privileges-role', 'common-lock', 'control-lock', 'clock', 'session', 'identity-lock',
        'grant-lock', 'work', 'clock', 'session', 'identity-lock', 'grant-lock', 'constraints', 'commit']);
});

test('copied or invented browser actor fields are not opaque authority', async () => {
    const f = fixture();
    for (const staff of [{ ...f.staff, role: 'ADMIN' }, { id: f.state.identity.id, role: 'REVIEWER', actorKind: 'HUMAN' }, null, 'cookie-token'])
        await rejected(f.authority.transaction(staff, () => assert.fail()), 'SIGN_IN_REQUIRED');
    assert.equal(f.transactions(), 0);
    f.staff.role = 'ADMIN'; f.staff.id = randomUUID();
    await f.authority.transaction(f.staff, context => assert.equal(context.identity.role, 'REVIEWER'));
});

test('runtime grants exclude provisioning, activation, session issuance, execution and public schema', () => {
    const sql = operationsGrantSQL('operations_fixture');
    assert.match(sql, /GRANT SELECT ON atlas_staff\."StaffOperationsGrant"/);
    assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION atlas_staff.customer_operations(text, text, text, jsonb, jsonb)'));
    assert.ok(!sql.includes('atlas_customer.'));
    assert.ok(!sql.includes('ON public.'));
    for (const name of ['StaffOperationsGrant', 'StaffControl', 'StaffSession', 'StaffBrowser', 'StaffOperatorRun', 'StaffGradingOperation']) {
        assert.deepEqual(OPERATION_GRANTS[name], {});
        assert.ok(!sql.split('\n').some(line => line.includes(`ON atlas_staff."${name}"`) && !line.startsWith('GRANT SELECT')));
    }
    assert.deepEqual(OPERATION_GRANTS.StaffOperatorAttempt.UPDATE, ['actualMicroUsd', 'costEvidenceHash']);
    assert.throws(() => operationsGrantSQL('role"; GRANT ALL'));
    assert.throws(() => OPERATION_GRANTS.StaffIdentity.UPDATE.push('phoneHash'));
});

test('effective owner/membership/role substitution and database substitution fail before auth or work', async () => {
    for (const mutate of [state => { state.role.unsafe = true; }, state => { state.role.role = 'different_role'; },
        state => { state.role.database = 'different_database'; }, state => { state.schemas = [{ nspname: 'public' }]; }]) {
        const f = fixture(); mutate(f.state);
        await rejected(f.authority.transaction(f.staff, () => assert.fail()), 'OPERATIONS_DATABASE_ROLE_INVALID');
        assert.ok(!f.log.includes('session'));
    }
});

test('extra public rights, grant self-provisioning, execution writes or missing required rights fail closed', async () => {
    const mutations = [
        state => state.columns.push({ schema: 'public', name: 'User', column: 'id', sel: true, ins: false, upd: false, refs: false, extra: false }),
        state => { state.columns.find(row => row.name === 'StaffOperationsGrant').upd = true; },
        state => { state.columns.find(row => row.name === 'StaffControl').upd = true; },
        state => state.columns.push({ schema: 'atlas_staff', name: 'StaffOperatorAttempt', column: 'state', sel: true, upd: true, ins: false, refs: false, extra: false }),
        state => { state.columns.find(row => row.name === 'StaffOperationsGrant').sel = false; },
        state => { state.columns = state.columns.filter(row => row.name !== 'StaffOperationsGrant'); },
        state => { state.columns = state.columns.filter(row => !(row.name === 'StaffOperatorAttempt' && row.column === 'costEvidenceHash')); },
        state => { state.columns[0].extra = true; }, state => { state.columns[0].refs = true; },
    ];
    for (const mutate of mutations) {
        const f = fixture(); mutate(f.state);
        await rejected(f.authority.transaction(f.staff, () => assert.fail()), 'OPERATIONS_DATABASE_ROLE_INVALID');
        assert.ok(!f.log.includes('grant-lock'));
    }
});

test('unlisted callable functions/sequences and lock-function substitutions fail closed', async () => {
    for (const mutate of [state => state.functions.push({ schema: 'public', name: 'unsafe()', definer: true }),
        state => { state.functions[1].schema = 'public'; }, state => { state.functions[1].definer = false; },
        state => { state.functions.pop(); }, state => { state.sequences = [{ oid: 1 }]; }]) {
        const f = fixture(); mutate(f.state);
        await rejected(f.authority.transaction(f.staff, () => assert.fail()), 'OPERATIONS_DATABASE_ROLE_INVALID');
    }
});

test('exact deployment/release/config and enabled control are required each transaction', async () => {
    for (const key of ['enabled', 'mode', 'origin', 'deploymentId', 'releaseSha', 'configHash', 'revision']) {
        const f = fixture(); f.state.control[key] = key === 'enabled' ? false : key === 'revision' ? 0 : 'different';
        await rejected(f.authority.transaction(f.staff, () => assert.fail()), 'STAFF_ACCESS_NOT_ENABLED');
        assert.ok(!f.log.includes('session'));
    }
});

test('expired, future, revoked and version-mismatched sessions or browsers never reach work', async () => {
    const mutations = [
        state => { state.session.createdAt = new Date(+NOW - 300_001); }, state => { state.session.createdAt = new Date(+NOW + 1); },
        state => { state.session.expiresAt = NOW; }, state => { state.session.revokedAt = NOW; },
        state => { state.session.accessVersion++; }, state => { state.session.controlRevision++; },
        state => { state.session.browserHash = 'c'.repeat(64); }, state => { state.browser.expiresAt = NOW; },
        state => { state.browser.createdAt = new Date(+NOW + 1); }, state => { state.browser.controlRevision++; },
        state => { state.identity.revokedAt = NOW; }, state => { state.identity.role = 'ADMIN'; }, state => { state.identity.phoneHash = 'c'.repeat(64); },
    ];
    for (const mutate of mutations) {
        const f = fixture(); mutate(f.state);
        await rejected(f.authority.transaction(f.staff, () => assert.fail()), 'FRESH_HUMAN_OPERATIONS_REQUIRED');
    }
});

test('grant must match exact current identity/access/control/release and retain valid authorization evidence', async () => {
    for (const key of ['identityId', 'accessVersion', 'controlRevision', 'mode', 'origin', 'deploymentId', 'releaseSha', 'configHash', 'authorizationEvidenceHash']) {
        const f = fixture(); f.state.grants[0][key] = ['accessVersion', 'controlRevision'].includes(key) ? 99 : 'wrong';
        await rejected(f.authority.transaction(f.staff, () => assert.fail()), 'FRESH_HUMAN_OPERATIONS_REQUIRED');
    }
    for (const mutate of [row => { row.revokedAt = NOW; }, row => { row.expiresAt = NOW; }, row => { row.createdAt = new Date(+NOW + 1); }]) {
        const f = fixture(); mutate(f.state.grants[0]);
        await rejected(f.authority.transaction(f.staff, () => assert.fail()), 'FRESH_HUMAN_OPERATIONS_REQUIRED');
    }
});

test('missing or multiple current grants deny, while revoked immutable history does not mask one current grant', async () => {
    const missing = fixture(); missing.state.grants = [];
    await rejected(missing.authority.transaction(missing.staff, () => assert.fail()), 'FRESH_HUMAN_OPERATIONS_REQUIRED');
    const multiple = fixture(); multiple.state.grants.push({ ...multiple.state.grants[0], id: randomUUID() });
    await rejected(multiple.authority.transaction(multiple.staff, () => assert.fail()), 'FRESH_HUMAN_OPERATIONS_REQUIRED');
    const historical = fixture(); historical.state.grants.push({ ...historical.state.grants[0], id: randomUUID(), revokedAt: NOW });
    await historical.authority.transaction(historical.staff, () => 'permitted');
});

test('fresh clock at commit rolls back a callback that outlives session freshness or grant expiry', async () => {
    for (const change of [state => { state.lastNow = new Date(+NOW + 240_001); },
        state => { state.grants[0].expiresAt = new Date(+NOW + 1); state.lastNow = new Date(+NOW + 2); }]) {
        const f = fixture(); change(f.state);
        await rejected(f.authority.transaction(f.staff, () => { f.state.value = 'must rollback'; }), 'FRESH_HUMAN_OPERATIONS_REQUIRED');
        assert.equal(f.state.value, null); assert.ok(!f.log.includes('commit'));
    }
});

test('callback cannot retain authority after changing its own identity access or substituting a grant', async () => {
    for (const mutate of [state => { state.identity.accessVersion++; }, state => { state.grants[0].id = randomUUID(); },
        state => { state.grants[0].revokedAt = NOW; }]) {
        const f = fixture();
        await rejected(f.authority.transaction(f.staff, () => { f.state.value = 'must rollback'; mutate(f.state); }), 'FRESH_HUMAN_OPERATIONS_REQUIRED');
        assert.equal(f.state.value, null);
    }
});

test('deferred constraint failures are surfaced before reporting success and roll back callback writes', async () => {
    const f = fixture(); f.state.deferredFailure = true;
    await assert.rejects(f.authority.transaction(f.staff, () => { f.state.value = 'must rollback'; }), /SYNTHETIC_DEFERRED_FAILURE/);
    assert.equal(f.state.value, null); assert.equal(f.log.at(-1), 'rollback'); assert.ok(f.log.includes('constraints'));
});

test('configuration requires a separate explicit credential on the exact staff database and rejects role/options injection', () => {
    const f = fixture(), base = f.operationsConfig.databaseUrl;
    for (const databaseUrl of [undefined, f.config.databaseUrl, base.replace('127.0.0.1', 'other-host'), base.replace('/fictional?', '/other?'),
        base + '&options=-crole%3Dpostgres', base + '&schema=public', base.replace('schema=atlas_staff', 'schema=public'),
        base.replace(':alsofictional@', ':@'), base.replace('operations_fixture:', 'bad%22role:')]) {
        assert.throws(() => makeOperationsAuthorityConfig({ databaseUrl, staffConfig: f.config }), /OPERATIONS_CONFIGURATION_REQUIRED/);
    }
    assert.throws(() => new StaffOperationsAuthority({ client: f.servingClient, auth: f.auth, config: f.operationsConfig }), /OPERATIONS_CONFIGURATION_REQUIRED/);
    assert.throws(() => new StaffOperationsAuthority({ client: f.client, auth: {}, config: f.operationsConfig }), /OPERATIONS_CONFIGURATION_REQUIRED/);
    assert.throws(() => new StaffOperationsAuthority({ client: f.client, auth: f.auth, config: { ...f.operationsConfig, releaseSha: '1'.repeat(40) } }), /OPERATIONS_CONFIGURATION_REQUIRED/);
});
