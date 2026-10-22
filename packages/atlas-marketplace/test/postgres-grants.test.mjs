import test from 'node:test';
import assert from 'node:assert/strict';
import { createPostgresStore, emptyMarketplaceState, POSTGRES_STORE_FORMAT } from '../src/store-postgres.mjs';
import { hash } from '../src/contract.mjs';

// This fixture tests qualification/refusal behavior; the separately invoked
// postgres.integration.mjs drift phase exercises actual PostgreSQL ACL queries.
function fixture() {
  const document = emptyMarketplaceState();
  const f = {
    role: { role: 'writer', database: 'marketplace', rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false },
    membership: { present: false },
    privileges: { database_create: false, gateway_usage: true, schema_write: false, direct_table: false, sequence_access: false, database_owner: false },
    routines: ['read_state()', 'lock_state()', 'commit_state(bigint, text, jsonb, text, bigint)'].map(name => ({ schema: 'atlas_marketplace', name, definer: true, config: ['search_path=pg_catalog'], owner: 'gateway_owner' })),
    row: { format: POSTGRES_STORE_FORMAT, environment: 'SYNTHETIC_LOCAL', revision: '0', document, state_hash: hash(document) },
    connects: 0, releases: [], queries: []
  };
  let prior;
  f.pool = { async connect() {
    f.connects++;
    return {
      async query(sql, values) {
        f.queries.push(sql);
        if (sql.startsWith('SELECT current_user AS role')) return { rows: f.role ? [structuredClone(f.role)] : [] };
        if (sql.includes('FROM pg_catalog.pg_auth_members')) return { rows: f.membership ? [structuredClone(f.membership)] : [] };
        if (sql.includes(' AS gateway_usage')) return { rows: f.privileges ? [structuredClone(f.privileges)] : [] };
        if (sql.includes('FROM pg_catalog.pg_proc p')) return { rows: structuredClone(f.routines) };
        if (sql === 'BEGIN') { prior = structuredClone(f.row); return { rows: [] }; }
        if (sql.startsWith('SET LOCAL ')) return { rows: [] };
        if (sql === 'SELECT * FROM atlas_marketplace.read_state()' || sql === 'SELECT * FROM atlas_marketplace.lock_state()') return { rows: [structuredClone(f.row)] };
        if (sql.startsWith('SELECT atlas_marketplace.commit_state(')) { f.row.document = JSON.parse(values[2]); f.row.state_hash = values[3]; f.row.revision = String(Number(f.row.revision) + 1); return { rows: [] }; }
        if (sql === 'COMMIT') { prior = undefined; return { rows: [] }; }
        if (sql === 'ROLLBACK') { f.row = prior; prior = undefined; return { rows: [] }; }
        throw Error(`Unexpected mock query: ${sql}`);
      },
      release(broken) { f.releases.push(Boolean(broken)); }
    };
  } };
  f.options = { pool: f.pool, environment: 'SYNTHETIC_LOCAL', expectedRole: 'writer', expectedDatabase: 'marketplace', expectedFunctionOwner: 'gateway_owner', enabled: true, clock: () => 1000 };
  f.store = createPostgresStore(f.options);
  return f;
}

test('Postgres store requires an explicit separate function owner and qualifies the writer even for reads', async () => {
  const f = fixture();
  assert.throws(() => createPostgresStore({ ...f.options, enabled: false }), { code: 'POSTGRES_STORE_DISABLED' });
  for (const expectedFunctionOwner of [undefined, '', 'writer']) assert.throws(() => createPostgresStore({ ...f.options, expectedFunctionOwner }), { code: 'DATABASE_FUNCTION_OWNER_REQUIRED' });
  assert.deepEqual(await f.store.read(), emptyMarketplaceState());
  await f.store.transaction(tx => { tx.state.consent.record = { approved: true }; return 'saved'; });
  assert.deepEqual(await f.store.read(state => state.consent.record), { approved: true });
  f.routines = f.routines.filter(item => item.name === 'read_state()');
  await assert.rejects(f.store.read(), { code: 'DATABASE_FUNCTION_GRANTS_REFUSED' });
  assert.equal(f.releases.length, f.connects);
});

test('Postgres refuses effective cross-schema privileges before reading or locking state', async t => {
  for (const field of ['database_create','schema_write','direct_table','sequence_access','database_owner','gateway_usage']) await t.test(field, async () => {
    const f = fixture(); f.privileges[field] = field === 'gateway_usage' ? false : true;
    await assert.rejects(f.store.transaction(() => assert.fail('reducer ran')), { code: 'DATABASE_GRANTS_REFUSED' });
    assert.equal(f.queries.some(sql => sql === 'BEGIN' || sql.includes('atlas_marketplace.lock_state()')), false);
    assert.equal(f.releases.length, 1);
  });
  const f = fixture(); delete f.privileges.sequence_access;
  await assert.rejects(f.store.read(), { code: 'DATABASE_GRANTS_REFUSED' });
});

test('Postgres pins the exact executable function set, ownership, definer mode and search path', async t => {
  const mutations = {
    unrelated_definer: f => f.routines.push({ ...f.routines[0], schema: 'other_private', name: 'elevate()', definer: true }),
    unrelated_invoker: f => f.routines.push({ ...f.routines[0], schema: 'public', name: 'helper()', definer: false }),
    executable_trigger: f => f.routines.push({ ...f.routines[0], name: 'reject_change()', definer: false }),
    missing_commit: f => f.routines.pop(),
    duplicate_signature: f => { f.routines[2] = { ...f.routines[0] }; },
    wrong_schema: f => { f.routines[0].schema = 'other'; },
    wrong_arguments: f => { f.routines[2].name = 'commit_state(integer, text, jsonb, text, bigint)'; },
    wrong_owner: f => { f.routines[0].owner = 'unapproved_owner'; },
    runtime_owned: f => { f.routines[0].owner = 'writer'; },
    invoker_gateway: f => { f.routines[0].definer = false; },
    unsafe_search_path: f => { f.routines[0].config = ['search_path=public, pg_catalog']; },
    extra_config: f => { f.routines[0].config.push('row_security=off'); },
    absent_config: f => { f.routines[0].config = null; }
  };
  for (const [name, mutate] of Object.entries(mutations)) await t.test(name, async () => {
    const f = fixture(); mutate(f);
    await assert.rejects(f.store.read(), { code: 'DATABASE_FUNCTION_GRANTS_REFUSED' });
    assert.equal(f.queries.some(sql => sql === 'SELECT * FROM atlas_marketplace.read_state()'), false);
    assert.equal(f.releases.length, 1);
  });
});

test('Postgres role binding and missing qualification rows fail closed', async t => {
  for (const field of ['role','database','rolsuper','rolcreatedb','rolcreaterole','rolreplication','rolbypassrls']) await t.test(field, async () => {
    const f = fixture(); f.role[field] = typeof f.role[field] === 'string' ? 'other' : true;
    await assert.rejects(f.store.read(), { code: 'DATABASE_AUTHORITY_REFUSED' });
  });
  const f = fixture(); f.membership.present = true;
  await assert.rejects(f.store.read(), { code: 'DATABASE_ROLE_MEMBERSHIP_REFUSED' });
  f.membership = null;
  await assert.rejects(f.store.read(), { code: 'DATABASE_ROLE_MEMBERSHIP_REFUSED' });
  f.role = null;
  await assert.rejects(f.store.read(), { code: 'DATABASE_AUTHORITY_REFUSED' });
});

test('Postgres rejects declared async reducers and invalid callbacks without executing or acquiring a connection', async () => {
  const f = fixture(); let executed = false;
  await assert.rejects(f.store.transaction(async () => { executed = true; throw Error('must never execute'); }), { code: 'ASYNC_TRANSACTION_REFUSED' });
  for (const callback of [null, undefined, {}, 3]) await assert.rejects(f.store.transaction(callback), { code: 'INVALID_TRANSACTION_CALLBACK' });
  await assert.rejects(f.store.read(null), { code: 'INVALID_READ_CALLBACK' });
  assert.equal(executed, false); assert.equal(f.connects, 0);
});

test('Postgres observes unexpected rejected Promise and thenable results and rolls back without any commit', async () => {
  const f = fixture(); const initial = hash(await f.store.read());
  for (const result of [() => Promise.reject(Error('rejected reducer result')), () => ({ then(_resolve, reject) { reject(Error('rejected thenable result')); } })]) {
    await assert.rejects(f.store.transaction(tx => { tx.state.consent.uncommitted = true; return result(); }), { code: 'ASYNC_TRANSACTION_REFUSED' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(hash(await f.store.read()), initial);
  }
  assert.equal(f.queries.filter(sql => sql === 'ROLLBACK').length, 2);
  assert.equal(f.queries.some(sql => sql === 'COMMIT' || sql.startsWith('SELECT atlas_marketplace.commit_state(')), false);
  assert.equal(f.releases.length, f.connects);
});
