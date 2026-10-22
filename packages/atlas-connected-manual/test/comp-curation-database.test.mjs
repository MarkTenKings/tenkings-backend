import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCompCurationDatabase, assertCompCurationDatabase, inspectCompCurationSchema, COMP_CURATION_TABLES } from '../src/comp-curation-database.mjs';

const baseline = await readFile(new URL('../../atlas-standalone-database/sql/baseline.sql', import.meta.url), 'utf8');
const proposal = await readFile(new URL('../sql/comp-curation-proposal.sql', import.meta.url), 'utf8');
function sample() {
  const role = 'atlas_test_curation', schemaOwner = 'atlas_test_owner';
  const tables = COMP_CURATION_TABLES.map(name => ({ name, owner: schemaOwner, kind: 'r', rls: false, force_rls: false,
    columns: [{ name: 'id' }], constraints: [], indexes: [], triggers: [] }));
  const functions = ['atlas_manual.authenticate', 'atlas_manual.card_revision', 'atlas_manual.immutable', 'atlas_manual_intake.card_guard']
    .map(name => ({ name, owner: schemaOwner, source: baseline.match(new RegExp(`CREATE OR REPLACE FUNCTION ${name.replaceAll('.', '\\.')}\\(.*?AS \\$function\\$(.*?)\\$function\\$;`, 's'))[1] }));
  functions.push({ name: 'atlas_manual.comp_curation_guard', owner: schemaOwner, source: proposal.match(/AS \$\$(.*?)\$\$;/s)[1] });
  const data = { role: [{ name: role, session_name: role, unsafe: false, memberships: [] }],
    schemas: [{ name: 'atlas_manual', usage: true, create: false }, { name: 'atlas_manual_intake', usage: true, create: false }, { name: 'public', usage: true, create: false }],
    columns: COMP_CURATION_TABLES.flatMap(name => ['id', 'content', 'revision'].map(column => ({ name, column, sel: true,
      ins: name === 'atlas_manual.comp_curation', upd: ['atlas_manual.card', 'atlas_manual_intake.card'].includes(name) && column === 'id', refs: false, extra: false }))),
    sequences: [], routines: [{ name: 'atlas_manual.authenticate', arguments: 'text, text, jsonb, text[]' }], schema: tables, functions };
  const trace = [], queries = [], tx = { async $executeRawUnsafe(sql) { trace.push(sql); }, async $queryRawUnsafe(sql) {
    queries.push(sql);
    const key = sql.match(/comp-db:([a-z]+)/)?.[1]; assert(key && Object.hasOwn(data, key)); trace.push(key); return structuredClone(data[key]);
  } };
  return { data, trace, queries, tx, config: { role, schemaOwner }, async pin() { this.config.schemaSha256 = (await inspectCompCurationSchema(tx)).sha256; return this; } };
}
const administratorMembership = ({ role, schemaOwner }) => ({ role, member: schemaOwner, admin: true, inherit: false, set: false, grantorSuperuser: true });
test('factory is inert and requires explicit distinct role, owner and reviewed schema pin', () => {
  let calls = 0; const client = { async $transaction() { calls++; } };
  assert.throws(() => createCompCurationDatabase({ client, role: 'x', schemaOwner: 'x', schemaSha256: 'a'.repeat(64) }));
  const db = createCompCurationDatabase({ client, role: 'reader', schemaOwner: 'owner', schemaSha256: 'a'.repeat(64) });
  assert.equal(calls, 0); assert.deepEqual(Object.keys(db), ['$transaction', 'close']); db.close(); assert.equal(calls, 0);
});
test('exact role checks bracket real callback; caller client lifetime stays external', async () => {
  const f = await sample().pin(), client = { async $transaction(work, options) { assert.equal(options.timeout, 8000); return work(f.tx); } };
  const db = createCompCurationDatabase({ client, ...f.config });
  assert.equal(await db.$transaction(async tx => { assert.equal(tx, f.tx); f.trace.push('work'); return 'private'; }), 'private');
  assert(f.trace.indexOf('role') < f.trace.indexOf('work')); assert(f.trace.lastIndexOf('role') > f.trace.indexOf('work'));
  db.close(); await assert.rejects(db.$transaction(() => assert.fail('closed callback')), { code: 'COMP_DATABASE_ROLE_INVALID' });
});
test('only the reviewed owner incoming superuser-granted admin-only membership is permitted', async () => {
  const f = await sample().pin();
  f.data.role[0].memberships = [administratorMembership(f.config)];
  assert.equal(await assertCompCurationDatabase(f.tx, f.config), f.config.schemaSha256);
});
test('membership direction, member, grantor and every non-exact option fail before private work', async () => {
  for (const patch of [{ role: 'another_role' }, { member: 'another_owner' },
    { role: 'another_role', member: 'atlas_test_curation' }, { member: 'atlas_test_curation' },
    { admin: false }, { admin: null }, { admin: 'true' }, { inherit: true }, { inherit: null }, { inherit: 0 },
    { set: true }, { set: null }, { set: 0 }, { grantorSuperuser: false }, { grantorSuperuser: null }, { grantorSuperuser: 'true' }]) {
    const f = await sample().pin();
    f.data.role[0].memberships = [administratorMembership(f.config), { ...administratorMembership(f.config), ...patch }];
    await assert.rejects(assertCompCurationDatabase(f.tx, f.config), { code: 'COMP_DATABASE_ROLE_INVALID' }, JSON.stringify(patch));
    assert.equal(f.trace.filter(v => v === 'schemas').length, 0);
  }
  for (const memberships of [undefined, null, {}, [null], [{}]]) {
    const f = await sample().pin(); f.data.role[0].memberships = memberships;
    await assert.rejects(assertCompCurationDatabase(f.tx, f.config), { code: 'COMP_DATABASE_ROLE_INVALID' });
  }
});
test('incoming administrator membership drift is rejected by the final transaction check', async () => {
  const f = await sample().pin(); f.data.role[0].memberships = [administratorMembership(f.config)];
  const db = createCompCurationDatabase({ client: { $transaction: work => work(f.tx) }, ...f.config });
  await assert.rejects(db.$transaction(async () => { f.data.role[0].memberships[0].set = true; return 'private'; }),
    { code: 'COMP_DATABASE_ROLE_INVALID' });
});
test('catalog queries retain both membership directions and treat pg_ as a literal schema prefix', async () => {
  const f = await sample().pin(); await assertCompCurationDatabase(f.tx, f.config);
  const query = f.queries.find(sql => sql.includes('comp-db:role'));
  assert.match(query, /WHERE m\.member=r\.oid OR m\.roleid=r\.oid/);
  assert.match(query, /LEFT JOIN pg_roles g ON g\.oid=m\.grantor/);
  assert.match(query, /'grantorSuperuser',g\.rolsuper/);
  const catalog = f.queries.join('\n');
  assert.doesNotMatch(catalog, /LIKE 'pg_%'/);
  assert.equal([...catalog.matchAll(/left\((?:n\.)?nspname,3\)<>'pg_'/g)].length, 4);
  f.data.schemas.push({ name: 'pga_private', usage: true, create: false });
  await assert.rejects(assertCompCurationDatabase(f.tx, f.config), { code: 'COMP_DATABASE_ROLE_INVALID' });
});
for (const [name, drift] of [
  ['role/membership/create/temp/ownership flag', f => { f.data.role[0].unsafe = true; }],
  ['SET ROLE impersonation', f => { f.data.role[0].session_name = 'other'; }],
  ['extra schema usage', f => { f.data.schemas.push({ name: 'atlas_customer', usage: true, create: false }); }],
  ['grading revision UPDATE', f => { f.data.columns.find(r => r.name === 'atlas_manual.card' && r.column === 'revision').upd = true; }],
  ['foreign SELECT', f => { f.data.columns.push({ name: 'atlas_customer.CustomerAccount', column: 'id', sel: true, ins: false, upd: false, refs: false, extra: false }); }],
  ['sequence grant', f => { f.data.sequences.push({ oid: 42 }); }],
  ['extra routine including trigger helper', f => { f.data.routines.push({ name: 'atlas_manual.comp_curation_guard', arguments: '' }); }],
  ['missing lock column permission', f => { f.data.columns.find(r => r.name === 'atlas_manual.card' && r.column === 'id').upd = false; }],
  ['schema trigger state drift', f => { f.data.schema[2].triggers.push({ name: 'bypass', enabled: 'D' }); }],
  ['source guard replacement', f => { f.data.functions.find(r => r.name === 'atlas_manual.card_revision').source = 'BEGIN RETURN NEW; END'; }],
]) test(`refuses ${name} before private work`, async () => {
  const f = await sample().pin(); drift(f); await assert.rejects(assertCompCurationDatabase(f.tx, f.config), { code: 'COMP_DATABASE_ROLE_INVALID' });
});
test('reviewed schema pin cannot bless changed immutable guard source', async () => {
  const f = sample(); f.data.functions.find(r => r.name === 'atlas_manual.card_revision').source = 'BEGIN RETURN NEW; END';
  await f.pin(); await assert.rejects(assertCompCurationDatabase(f.tx, f.config), { code: 'COMP_DATABASE_ROLE_INVALID' });
});
test('grant drift during asynchronous work fails final validation', async () => {
  const f = await sample().pin(), client = { $transaction: work => work(f.tx) };
  const db = createCompCurationDatabase({ client, ...f.config });
  await assert.rejects(db.$transaction(async () => { f.data.sequences.push({ oid: 1 }); return 'private'; }), { code: 'COMP_DATABASE_ROLE_INVALID' });
});
test('captured options and transaction method cannot drift across awaited work', async () => {
  for (const mutate of [o => { o.role = 'other'; }, o => { o.client.$transaction = () => {}; }]) {
    const f = await sample().pin(), options = { client: { $transaction: work => work(f.tx) }, ...f.config };
    const db = createCompCurationDatabase(options); let entered, resume;
    const enteredPromise = new Promise(r => { entered = r; }), gate = new Promise(r => { resume = r; });
    const pending = db.$transaction(async () => { entered(); await gate; return 'private'; });
    await enteredPromise; mutate(options); resume(); await assert.rejects(pending, { code: 'COMP_DATABASE_ROLE_INVALID' });
  }
});
test('unregistered grant proposal is narrow and has no provisioning or policy defaults', async () => {
  const sql = await readFile(new URL('../sql/comp-curation-role-proposal.sql', import.meta.url), 'utf8');
  const statements = sql.replace(/--[^\n]*/g, '').split(';').map(v => v.trim()).filter(Boolean);
  assert.equal(statements.length, 7); assert.equal(statements[0], 'BEGIN'); assert.equal(statements.at(-1), 'COMMIT');
  assert(statements.some(s => /^GRANT UPDATE\(id\) ON atlas_manual.card,atlas_manual_intake.card TO :"curation_role"$/.test(s)));
  assert(!statements.some(s => /CREATE ROLE|PASSWORD|DELETE|TRUNCATE|REVOKE|atlas_staff|atlas_customer|revision|content/.test(s)));
});
