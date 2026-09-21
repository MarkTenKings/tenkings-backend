// Actual PostgreSQL only, in a newly owned disposable database. Never accepts a
// database URL, existing data directory, provider key, photo or production row.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { disposablePostgres } from '../../../frontend/atlas-app/scripts/disposable-postgres.mjs';
import { connectedGrantSQL } from '../src/details.mjs';

const migrationName = '20260921000000_manual_identification_retry';
const migrationUrl = new URL(`../../../frontend/atlas-app/prisma/migrations/${migrationName}/migration.sql`, import.meta.url);
const oldMigrationUrl = new URL('../../../frontend/atlas-app/prisma/migrations/20260912190200_manual_connected/migration.sql', import.meta.url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const lineage = ['retry_of', 'retry_action_id', 'evidence_attempt_id'];
const table = 'atlas_manual_connected.identification';

export async function runIdentificationRetryPostgres({ cluster, pgModule, output }) {
  const { Client } = createRequire(import.meta.url)(pgModule);
  const database = await cluster.database();
  const clients = new Set(), assertions = [];
  const role = `atlas_fixture_retry_${randomBytes(6).toString('hex')}`;
  const password = randomBytes(24).toString('hex');
  const roleUrl = new URL(database.adminUrl); roleUrl.username = role; roleUrl.password = password;
  async function open(url) {
    const client = new Client({ connectionString: url }); clients.add(client); await client.connect();
    await client.query("SET statement_timeout='15s'"); return client;
  }
  const owner = await open(database.adminUrl);
  async function check(name, fn) { await fn(); assertions.push(name); }
  const denied = (operation, codes = ['P0001']) => assert.rejects(operation, error => codes.includes(error.code));
  const actor = randomUUID(), card = randomUUID(), otherCard = randomUUID();
  const source = sha('synthetic original pair'), input = JSON.stringify({ fixture: 'retained original input' });
  const requestHash = sha('synthetic immutable model request');
  const root = randomUUID();
  const row = async (client, id) => (await client.query(`SELECT to_jsonb(r) AS value FROM ${table} r WHERE id=$1`, [id])).rows[0]?.value;
  const receipts = async id => (await owner.query('SELECT to_jsonb(r) AS value FROM atlas_manual_connected.effect r WHERE attempt_id=$1 ORDER BY stage,event', [id])).rows;
  async function seedRoot({ id = randomUUID(), cardId = card, sourceHash = randomBytes(32).toString('hex'), state = 'UNKNOWN', model = 'matching' } = {}) {
    await owner.query(`INSERT INTO ${table}(id,card_id,source_hash,actor_id,state,input) VALUES($1,$2,$3,$4,'RUNNING',$5)`, [id, cardId, sourceHash, actor, input]);
    if (state !== 'RUNNING') await owner.query(`UPDATE ${table} SET state=$2,finished_at=clock_timestamp() WHERE id=$1`, [id, state]);
    if (model !== 'absent') {
      await owner.query(`INSERT INTO atlas_manual_connected.effect(attempt_id,stage,event,request_hash,evidence)
        VALUES($1,'MODEL','DISPATCH',$2,'{"fixture":"request-ref"}')`, [id, requestHash]);
      if (model !== 'dispatch-only') await owner.query(`INSERT INTO atlas_manual_connected.effect(attempt_id,stage,event,request_hash,evidence)
        VALUES($1,'MODEL','RESPONSE',$2,'{"fixture":"verified-response-ref"}')`, [id, model === 'mismatching' ? sha('different request') : requestHash]);
    }
    return await row(owner, id);
  }
  async function insertChild(client, parent, overrides = {}, replay = false) {
    const data = { id: randomUUID(), card_id: parent.card_id, source_hash: parent.source_hash, actor_id: actor,
      state: 'RUNNING', input: parent.input, retry_of: parent.id, retry_action_id: randomUUID(),
      evidence_attempt_id: parent.evidence_attempt_id ?? parent.id, result: null, error: null, finished_at: null, ...overrides };
    const columns = Object.keys(data);
    return client.query(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map((_, i) => `$${i + 1}`).join(',')})
      ${replay ? 'ON CONFLICT DO NOTHING' : ''} RETURNING id`, Object.values(data));
  }
  async function effectiveColumns() {
    return (await owner.query(`SELECT a.attname AS name,
      has_column_privilege($1,c.oid,a.attnum,'SELECT') sel, has_column_privilege($1,c.oid,a.attnum,'INSERT') ins,
      has_column_privilege($1,c.oid,a.attnum,'UPDATE') upd, has_column_privilege($1,c.oid,a.attnum,'REFERENCES') refs
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
      WHERE n.nspname='atlas_manual_connected' AND c.relname='identification' AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`, [role])).rows;
  }
  try {
    const migration = await readFile(migrationUrl, 'utf8');
    const declared = cluster.source.staffMigrations.find(item => item.name === migrationName);
    assert.equal(declared?.sha256, sha(migration), 'Owned ordinary Prisma chain must include exact retry migration');
    assert.equal((await owner.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count, 0);
    // Reconstruct the exact prior table shape only inside this fresh, empty
    // owned case. This tests the upgrade against retained old rows as well as
    // the ordinary all-migrations Prisma deployment that created its template.
    const oldMigration = await readFile(oldMigrationUrl, 'utf8');
    const oldGuard = oldMigration.match(/CREATE FUNCTION atlas_manual_connected\.identification_guard\(\)[\s\S]*?END; \$\$;/)?.[0];
    assert(oldGuard);
    await owner.query(`BEGIN;
      DROP TRIGGER identification_retry_guard ON ${table};
      DROP FUNCTION atlas_manual_connected.identification_retry_guard();
      DROP INDEX atlas_manual_connected.identification_root_source_unique;
      ALTER TABLE ${table} DROP COLUMN retry_of, DROP COLUMN retry_action_id, DROP COLUMN evidence_attempt_id;
      ALTER TABLE ${table} ADD CONSTRAINT identification_card_id_source_hash_key UNIQUE(card_id,source_hash);
      ${oldGuard.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION')}
      COMMIT;`);
    await owner.query('INSERT INTO atlas_staff."StaffIdentity"(id,"phoneHash",name,role) VALUES($1,$2,$3,$4)',
      [actor, randomBytes(32).toString('hex'), 'Synthetic retry reviewer', 'REVIEWER']);
    for (const id of [card, otherCard]) await owner.query(`INSERT INTO atlas_manual_intake.card(id,pair_id,owner_id,create_request_id,create_request_hash,label)
      VALUES($1,$2,$3,$4,$5,'Synthetic retry fixture')`, [id, randomUUID(), actor, randomUUID(), sha(id)]);
    const original = await seedRoot({ id: root, sourceHash: source });
    const originalEffects = await receipts(root);
    await cluster.sql(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`);
    await owner.query(connectedGrantSQL(role));
    const beforeColumns = await effectiveColumns();
    const beforeAcl = (await owner.query(`SELECT relacl::text FROM pg_class WHERE oid='${table}'::regclass`)).rows;
    await check('exact additive migration preserves existing attempt, receipts and grants', async () => {
      await owner.query(migration);
      const upgraded = await row(owner, root);
      for (const name of lineage) { assert.equal(upgraded[name], null); delete upgraded[name]; }
      assert.deepEqual(upgraded, original); assert.deepEqual(await receipts(root), originalEffects);
      assert.deepEqual((await effectiveColumns()).filter(value => !lineage.includes(value.name)), beforeColumns);
      assert.deepEqual((await owner.query(`SELECT relacl::text FROM pg_class WHERE oid='${table}'::regclass`)).rows, beforeAcl);
    });
    const manual = await open(roleUrl.href), second = await open(roleUrl.href);
    const parent = await row(manual, root);
    await check('existing role can insert/read lineage but cannot update or reference it', async () => {
      assert.deepEqual((await effectiveColumns()).filter(value => lineage.includes(value.name)),
        lineage.map(name => ({ name, sel: true, ins: true, upd: false, refs: false })));
      const currentRole = (await manual.query('SELECT current_user,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolinherit FROM pg_roles WHERE rolname=current_user')).rows[0];
      assert.equal(currentRole.current_user, role);
      assert(Object.entries(currentRole).filter(([key]) => key !== 'current_user').every(([, value]) => value === false));
      assert.equal((await manual.query(`SELECT has_table_privilege(current_user,'${table}','DELETE,TRUNCATE,TRIGGER') AS extra,
        has_function_privilege(current_user,'atlas_manual_connected.identification_retry_guard()','EXECUTE') AS invoke,
        has_schema_privilege(current_user,'atlas_manual_connected','CREATE') AS create_objects`)).rows[0].extra, false);
      const permission = (await manual.query(`SELECT has_function_privilege(current_user,'atlas_manual_connected.identification_retry_guard()','EXECUTE') AS invoke,
        has_schema_privilege(current_user,'atlas_manual_connected','CREATE') AS create_objects`)).rows[0];
      assert.deepEqual(permission, { invoke: false, create_objects: false });
      for (const column of lineage) await denied(() => manual.query(`UPDATE ${table} SET ${column}=NULL WHERE id=$1`, [root]), ['42501']);
    });
    await check('ordinary original-root conflict target still returns the one retained attempt', async () => {
      const replay = await manual.query(`INSERT INTO ${table}(id,card_id,source_hash,actor_id,state,input) VALUES($1,$2,$3,$4,'RUNNING',$5)
        ON CONFLICT(card_id,source_hash) WHERE retry_of IS NULL DO NOTHING RETURNING id`, [randomUUID(), card, source, actor, input]);
      assert.equal(replay.rowCount, 0);
      await denied(() => manual.query(`INSERT INTO ${table}(id,card_id,source_hash,actor_id,state,input,retry_action_id)
        VALUES($1,$2,$3,$4,'RUNNING',$5,$6)`, [randomUUID(), card, randomBytes(32).toString('hex'), actor, input, randomUUID()]), ['23514']);
    });
    for (const [name, change] of [
      ['changed card', { card_id: otherCard }], ['changed source', { source_hash: sha('changed pair') }],
      ['changed input', { input: '{"fixture":"changed"}' }], ['wrong root evidence', { evidence_attempt_id: randomUUID() }],
      ['missing evidence link', { evidence_attempt_id: null }], ['missing action', { retry_action_id: null }],
      ['nonexistent parent', { retry_of: randomUUID() }], ['precompleted successor', { state: 'COMPLETE' }],
      ['prefilled result', { result: '{}' }], ['prefilled error', { error: 'forged' }],
      ['prefilled finish time', { finished_at: new Date() }],
    ]) await check(`rejects ${name}`, () => denied(() => insertChild(manual, parent, change), ['P0001', '23514']));
    for (const state of ['RUNNING', 'COMPLETE', 'FAILED', 'STALE']) await check(`rejects ${state} parent`, async () => {
      const unsuitable = await seedRoot({ state });
      await denied(() => insertChild(manual, unsuitable));
    });
    for (const model of ['absent', 'dispatch-only', 'mismatching']) await check(`rejects ${model} parent model receipts`, async () => {
      const unsuitable = await seedRoot({ model });
      await denied(() => insertChild(manual, unsuitable));
    });
    const childId = randomUUID(), actionId = randomUUID();
    await check('concurrent same-parent claims block and exactly one child commits', async () => {
      await manual.query('BEGIN'); await second.query('BEGIN');
      await insertChild(manual, parent, { id: childId, retry_action_id: actionId });
      const pid = (await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const losing = insertChild(second, parent).then(result => ({ result }), error => ({ error }));
      let blocked = false;
      for (let i = 0; i < 100; i++) {
        const observed = (await owner.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [pid])).rows[0];
        if (observed?.wait_event_type === 'Lock') { blocked = true; break; }
        await new Promise(done => setTimeout(done, 10));
      }
      // Release the winner even if the lock assertion fails, so cleanup cannot
      // leave the losing connection waiting on an owned fixture transaction.
      await manual.query('COMMIT');
      const result = await losing; await second.query('ROLLBACK');
      assert(blocked, 'Second transaction must wait on the retained parent');
      assert.equal(result.error?.code, '23505');
      assert.deepEqual((await manual.query(`SELECT id FROM ${table} WHERE retry_of=$1`, [root])).rows, [{ id: childId }]);
    });
    await check('same explicit action replay resolves the existing child; divergent action cannot fork', async () => {
      assert.equal((await insertChild(manual, parent, { retry_action_id: actionId }, true)).rowCount, 0);
      assert.equal((await manual.query(`SELECT id FROM ${table} WHERE card_id=$1 AND retry_action_id=$2`, [card, actionId])).rows[0].id, childId);
      await denied(() => insertChild(manual, parent), ['23505']);
      const otherParent = await seedRoot();
      await denied(() => insertChild(manual, otherParent, { retry_action_id: actionId }), ['23505']);
    });
    const child = await row(manual, childId);
    await check('successor lineage cannot change even while settling a RUNNING attempt', async () => {
      for (const column of lineage) for (const value of [null, randomUUID()])
        await denied(() => owner.query(`UPDATE ${table} SET ${column}=$2,state='UNKNOWN',finished_at=clock_timestamp() WHERE id=$1`, [childId, value]));
      assert.deepEqual(await row(manual, childId), child);
    });
    let grandchildId;
    await check('later explicit retry retains original evidence root and sole current leaf', async () => {
      await manual.query(`INSERT INTO atlas_manual_connected.effect(attempt_id,stage,event,request_hash,evidence)
        VALUES($1,'MODEL','DISPATCH',$2,'{"fixture":"same-request"}')`, [childId, requestHash]);
      await manual.query('SELECT atlas_manual_connected.append_receipt($1,$2,$3,$4,$5)',
        [childId, 'MODEL', 'RESPONSE', requestHash, '{"fixture":"second-verified-quota-rejection"}']);
      await manual.query(`UPDATE ${table} SET state='UNKNOWN',error='IDENTIFICATION_UNAVAILABLE',finished_at=clock_timestamp() WHERE id=$1`, [childId]);
      const settledChild = await row(manual, childId);
      await denied(() => insertChild(manual, settledChild, { evidence_attempt_id: childId }));
      grandchildId = (await insertChild(manual, settledChild)).rows[0].id;
      assert.equal((await row(manual, grandchildId)).evidence_attempt_id, root);
      const heads = await manual.query(`SELECT i.id FROM ${table} i WHERE i.card_id=$1 AND i.source_hash=$2
        AND NOT EXISTS(SELECT 1 FROM ${table} child WHERE child.retry_of=i.id)`, [card, source]);
      assert.deepEqual(heads.rows, [{ id: grandchildId }]);
    });
    await check('terminal attempts and all original effect bytes remain immutable', async () => {
      await denied(() => manual.query(`UPDATE ${table} SET state='RUNNING',finished_at=NULL WHERE id=$1`, [root]));
      await denied(() => owner.query(`UPDATE ${table} SET error='changed' WHERE id=$1`, [root]));
      await denied(() => owner.query("UPDATE atlas_manual_connected.effect SET evidence='{}' WHERE attempt_id=$1", [root]));
      await denied(() => owner.query('DELETE FROM atlas_manual_connected.effect WHERE attempt_id=$1', [root]));
      await denied(() => manual.query(`DELETE FROM ${table} WHERE id=$1`, [root]), ['42501']);
      await manual.query(`UPDATE ${table} SET state='COMPLETE',result='{}',finished_at=clock_timestamp() WHERE id=$1`, [grandchildId]);
      const complete = await row(manual, grandchildId);
      await denied(() => insertChild(manual, complete));
      const retained = await row(manual, root);
      for (const name of lineage) delete retained[name];
      assert.deepEqual(retained, original); assert.deepEqual(await receipts(root), originalEffects);
    });
    const result = { status: 'PASS', fixture: 'owned actual PostgreSQL; synthetic rows only', migration: { name: migrationName, sha256: sha(migration) },
      assertions, assertionCount: assertions.length, originalAttemptAndEffectsPreserved: true, providerCalls: 0,
      source: cluster.source, at: new Date().toISOString() };
    await writeFile(join(output, 'identification-retry-postgres.json'), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    return result;
  } finally {
    for (const client of clients) { try { await client.query('ROLLBACK'); } finally { await client.end(); } }
    await database.dispose();
    await cluster.sql(`DROP ROLE IF EXISTS "${role}"`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = process.env.ATLAS_CONNECTED_EVIDENCE;
  assert(output && resolve(output) === output, 'Absolute owned evidence directory required');
  const args = process.argv.slice(2), index = args.indexOf('--pg-module');
  assert(index >= 0 && args[index + 1]);
  await mkdir(output, { recursive: true, mode: 0o700 });
  const cluster = await disposablePostgres(args);
  try {
    const result = await runIdentificationRetryPostgres({ cluster, pgModule: args[index + 1], output });
    for (const name of ['source.json', 'ledgers.json', 'validation.log']) await copyFile(join(cluster.directory, name), join(output, name));
    console.log(JSON.stringify({ status: result.status, assertions: result.assertionCount, providerCalls: 0, output }));
  } finally {
    await cluster.stop();
    await copyFile(join(cluster.directory, 'cleanup.json'), join(output, 'database-cleanup.json'));
  }
}
