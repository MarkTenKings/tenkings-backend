// Finite nonce-owned PostgreSQL17 only. Preparation writes local evidence; execution
// requires a separately reviewed exact plan hash. No ambient database discovery.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, stat, rm, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '../../../frontend/atlas-app/.generated/staff-database/index.js';
import { CustomerAuth } from '../../../frontend/atlas-customer/lib/server/auth.mjs';
import { CustomerDatabase } from '../../../frontend/atlas-customer/lib/server/database.mjs';
import { localConfig, fixtureProvider } from '../../../frontend/atlas-customer/lib/server/fixture.mjs';
import { applyStandaloneBaseline, applyStandaloneMigrations } from '../migrate.mjs';
import { standaloneRoleSQL } from '../grants.mjs';
import { collectionFoundationDefinition, assertRegisteredOwnershipFoundation } from '../test/ownership-foundation-fixture.mjs';
import { createCardOwnershipReadService, cardOwnershipReadGrantSQL } from '../../atlas-connected-manual/src/card-ownership-read-service.mjs';
import { createCardOwnershipPreferencesService, cardOwnershipPreferencesGrantSQL } from '../../atlas-connected-manual/src/card-ownership-preferences-service.mjs';
import { assertCompCurationDatabase } from '../../atlas-connected-manual/src/comp-curation-database.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const [mode, output, argument] = process.argv.slice(2);
assert(process.argv.length === 5 && ['--prepare', '--execute'].includes(mode) && output && resolve(output) === output);
assert(!Object.keys(process.env).some(k => /^(DATABASE_URL|DIRECT_URL|ATLAS_.*DATABASE_URL|PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATA|PGDATABASE|PGSERVICE|PGSERVICEFILE)$/.test(k)));
const bin = '/opt/homebrew/opt/postgresql@17/bin', pgModule = '/Users/markthomas/.codex/atlas-handoffs/atlas-v4-labels-pg-runtime/node_modules/pg';
const hash = x => createHash('sha256').update(x).digest('hex');
const stable = x => JSON.stringify(x, (_k, v) => v && Object.getPrototypeOf(v) === Object.prototype ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
const save = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const planPath = resolve(output, 'launch-plan.json');
const definition = await collectionFoundationDefinition();
const sourcePaths = [
  'packages/atlas-standalone-database/scripts/qualify-collection-foundation.mjs',
  ...['migrate.mjs', 'registered-migrations.mjs', 'grants.mjs', 'baseline.manifest.json', 'migrations.manifest.json', 'sql/baseline.sql',
    'test/ownership-foundation-fixture.mjs', 'test/collection-foundation.test.mjs', ...definition.migrations.map(m => m.file)].map(p => 'packages/atlas-standalone-database/' + p),
  ...definition.components.map(c => 'packages/atlas-connected-manual/sql/' + c.name),
  ...['card-ownership-contract.mjs', 'card-ownership-read-service.mjs', 'card-ownership-preferences-contract.mjs', 'card-ownership-preferences-service.mjs', 'comp-curation-database.mjs'].map(p => 'packages/atlas-connected-manual/src/' + p),
  'packages/atlas-connected-manual/sql/comp-curation-proposal.sql', 'packages/atlas-connected-manual/sql/comp-curation-role-proposal.sql',
  ...['auth.mjs', 'database.mjs', 'fixture.mjs', 'config.mjs', 'policy.mjs'].map(p => 'frontend/atlas-customer/lib/server/' + p),
];
const compSchemaPath = '/Users/markthomas/.codex/atlas-handoffs/atlas-staff-comp-curation-20261021/restricted-role-pg-03/reviewed-owned-schema.json';
const compSchemaSha256 = 'a1bbdf297ec7c426358a9f6dee0fd90fb23a109bb92007f0b2ccfa5b3b842ff7';
const pin = async path => ({ path, sha256: hash(await readFile(resolve(root, path))) });
if (mode === '--prepare') {
  assert(/^[1-9][0-9]{3,4}$/.test(argument)); const port = Number(argument); assert(port <= 65535);
  await mkdir(output, { mode: 0o700 }); await mkdir(resolve(output, 'cluster'), { mode: 0o700 }); await mkdir(resolve(output, 'source-used'), { mode: 0o700 });
  const sources = [];
  for (const path of sourcePaths) { sources.push(await pin(path)); await writeFile(resolve(output, 'source-used', path.replaceAll('/', '__')), await readFile(resolve(root, path)), { flag: 'wx', mode: 0o600 }); }
  const schema = JSON.parse(await readFile(compSchemaPath)); assert.equal(schema.sha256, compSchemaSha256);
  await save(planPath, { schema: 'atlas-collection-foundation-owned-pg-v1', output, directory: resolve(output, 'cluster'), data: resolve(output, 'cluster/data'),
    host: '127.0.0.1', unixSockets: false, port, nonce: randomBytes(16).toString('hex'), bin, pgModule, sources,
    compSchema: { path: compSchemaPath, sha256: hash(await readFile(compSchemaPath)), schemaSha256: compSchemaSha256 },
    groups: ['populated exact ledger9 plus seven control rows and retained serving/comp grants', 'additive010 exact row/catalog/ACL preservation and empty ownership authority',
      'repeat no-op plus strict retained comp schema and serving privilege refusal', 'actual customer reader/preferences defaults, exact save/recovery and sole event delta',
      'fresh full chain installation without seed or grants', 'partial-schema and corrupted-ledger refusal with transactional rollback'],
    fixtureOnlySmsSetup: 'Insert two disabled synthetic SmsPilotControl rows under one scoped no_replace trigger exception before preservation baseline; immediately restore trigger.',
    productionQueries: 0, providerCalls: 0, storageCalls: 0 });
  process.stdout.write(JSON.stringify({ prepared: true, planPath, sha256: hash(await readFile(planPath)), port }) + '\n');
} else {
  assert.equal(hash(await readFile(planPath)), argument, 'Exact separately reviewed plan required');
  const plan = JSON.parse(await readFile(planPath));
  assert.equal(plan.schema, 'atlas-collection-foundation-owned-pg-v1'); assert.equal(plan.output, output);
  assert.equal(plan.directory, resolve(output, 'cluster')); assert.equal(plan.data, resolve(plan.directory, 'data'));
  assert.equal(plan.host, '127.0.0.1'); assert.equal(plan.unixSockets, false); assert.equal(plan.bin, bin); assert.equal(plan.pgModule, pgModule);
  assert.match(plan.nonce, /^[a-f0-9]{32}$/); assert(Number.isInteger(plan.port) && plan.port >= 1024 && plan.port <= 65535);
  assert.deepEqual(plan.sources.map(r => r.path), sourcePaths); for (const ref of plan.sources) assert.deepEqual(await pin(ref.path), ref);
  assert.equal(plan.compSchema.path, compSchemaPath); assert.equal(hash(await readFile(compSchemaPath)), plan.compSchema.sha256); assert.equal(plan.compSchema.schemaSha256, compSchemaSha256);
  await assert.rejects(stat(plan.data), { code: 'ENOENT' }); await save(resolve(output, 'execute-intent.json'), { nonce: plan.nonce, planSha256: argument, pid: process.pid });
  const { Client } = createRequire(import.meta.url)(pgModule), sockets = new Set(), clients = new Set();
  const ownerRole = 'atlas_fixture_owner', customerRole = 'atlas_foundation_customer', readRole = 'atlas_foundation_reader', prefRole = 'atlas_foundation_preferences', compRole = 'atlas_foundation_comp';
  const roles = { staff: 'atlas_foundation_staff', manual: 'atlas_foundation_manual', variant: 'atlas_foundation_variant', customer: customerRole, customerPrivate: 'atlas_foundation_customer_private' };
  const passwords = Object.fromEntries([ownerRole, customerRole, readRole, prefRole, compRole].map(r => [r, randomBytes(24).toString('hex')]));
  const dbName = 'atlas_collection_' + plan.nonce.slice(0, 12), checks = [], evidence = [];
  const url = (role, database = dbName) => `postgresql://${role}:${passwords[role]}@127.0.0.1:${plan.port}/${database}?schema=${role === ownerRole ? 'atlas_staff' : 'atlas_customer'}&connection_limit=2`;
  const safe = x => Object.values(passwords).reduce((v, p) => v.replaceAll(p, '[fixture-secret]'), String(x));
  const env = { PATH: '/usr/bin:/bin:/opt/homebrew/bin', LANG: 'C' }; let log = '', started = false, failure, result;
  const run = (name, args) => { const r = spawnSync(resolve(bin, name), args, { env, encoding: 'utf8', timeout: 120000, maxBuffer: 8e6 }); log += safe((r.stdout ?? '') + (r.stderr ?? '')); assert.equal(r.status, 0, safe(r.error?.message ?? r.stderr)); return r.stdout; };
  const socket = async (role = ownerRole, database = dbName) => { const c = new Client({ connectionString: url(role, database), connectionTimeoutMillis: 3000 }); sockets.add(c); await c.connect(); return c; };
  const txRaw = c => ({ $executeRawUnsafe: async (q, ...args) => (await c.query(q, args)).rowCount, $queryRawUnsafe: async (q, ...args) => (await c.query(q, args)).rows });
  const clientRaw = c => ({ async $transaction(work) { await c.query('BEGIN'); try { const v = await work(txRaw(c)); await c.query('COMMIT'); return v; } catch (e) { await c.query('ROLLBACK'); throw e; } } });
  const census = async c => {
    const tables = (await c.query("SELECT n.nspname AS schema,c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname LIKE 'atlas_%' ORDER BY n.nspname,c.relname")).rows;
    const out = {};
    for (const t of tables) { const id = `"${t.schema}"."${t.name}"`, rows = (await c.query(`SELECT to_jsonb(t) AS row FROM ${id} t ORDER BY to_jsonb(t)::text`)).rows.map(r => r.row); out[t.schema + '.' + t.name] = { count: rows.length, sha256: hash(stable(rows)) }; }
    return out;
  };
  const catalog = async c => (await c.query(`SELECT 'schema:'||nspname AS name,jsonb_build_object('owner',nspowner,'acl',nspacl) AS value FROM pg_namespace WHERE nspname LIKE 'atlas_%'
    UNION ALL SELECT 'relation:'||n.nspname||'.'||c.relname,jsonb_build_object('owner',c.relowner,'acl',c.relacl,'kind',c.relkind,
      'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
      'constraints',(SELECT jsonb_agg(jsonb_build_object('name',k.conname,'definition',pg_get_constraintdef(k.oid,false),'valid',k.convalidated) ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid=c.oid)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname LIKE 'atlas_%'
    UNION ALL SELECT 'routine:'||n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')',jsonb_build_object('owner',p.proowner,'acl',p.proacl,'definition',pg_get_functiondef(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname LIKE 'atlas_%'
    UNION ALL SELECT 'trigger:'||n.nspname||'.'||c.relname||'.'||t.tgname,jsonb_build_object('enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid,false)) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname LIKE 'atlas_%' ORDER BY name`)).rows;
  try {
    const owned = { nonce: plan.nonce, directory: plan.directory, data: plan.data, ownerPid: process.pid, uid: process.getuid(), createdByHarness: true };
    await save(resolve(plan.directory, 'ownership.json'), owned); const pw = resolve(plan.directory, 'owner-password'); await writeFile(pw, passwords[ownerRole], { flag: 'wx', mode: 0o600 });
    assert.match(run('postgres', ['--version']), /PostgreSQL\) 17\./);
    run('initdb', ['-D', plan.data, '--username', ownerRole, '--pwfile', pw, '--auth-host=scram-sha-256', '--auth-local=reject', '--encoding=UTF8', '--locale=C']);
    started = true; run('pg_ctl', ['-D', plan.data, '-l', resolve(plan.directory, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${plan.port} -c unix_socket_directories=''`, '-w', 'start']); await rm(pw);
    const control = await socket(ownerRole, 'postgres');
    assert.deepEqual((await control.query("SELECT current_setting('data_directory') data,current_setting('listen_addresses') host,current_setting('unix_socket_directories') sockets")).rows[0], { data: plan.data, host: '127.0.0.1', sockets: '' });
    await control.query(`CREATE DATABASE ${dbName}`); const setup = await socket(); await applyStandaloneBaseline(setup);
    for (const m of definition.migrations.slice(0, 8)) { await setup.query('BEGIN'); try { await setup.query(m.sql); await setup.query('INSERT INTO atlas_staff._standalone_migrations(version,checksum) VALUES($1,$2)', [m.version,m.sqlSha256]); await setup.query('COMMIT'); } catch (e) { await setup.query('ROLLBACK'); throw e; } }
    await setup.query(`REVOKE TEMPORARY ON DATABASE ${dbName} FROM PUBLIC`); await setup.query(standaloneRoleSQL(roles));
    await control.query(`ALTER ROLE ${customerRole} LOGIN PASSWORD '${passwords[customerRole]}'`);
    await setup.query(await readFile(resolve(root, 'packages/atlas-connected-manual/sql/comp-curation-proposal.sql'), 'utf8'));
    for (const role of [compRole, readRole, prefRole]) await control.query(`CREATE ROLE ${role} LOGIN PASSWORD '${passwords[role]}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`);
    await setup.query((await readFile(resolve(root, 'packages/atlas-connected-manual/sql/comp-curation-role-proposal.sql'), 'utf8')).replaceAll(':"curation_role"', `"${compRole}"`));
    const comp = await socket(compRole); await assertCompCurationDatabase(txRaw(comp), { role: compRole, schemaOwner: ownerRole, schemaSha256: compSchemaSha256 });
    const customerClient = new PrismaClient({ datasources: { db: { url: url(customerRole) } } }); clients.add(customerClient);
    const config = localConfig({ databaseUrl: url(customerRole), sessionKey: randomBytes(32), phoneKey: randomBytes(32) });
    for (const table of ['atlas_customer."CustomerControl"', 'atlas_staff."StaffControl"']) await setup.query(`INSERT INTO ${table}(enabled,mode,origin,"deploymentId","releaseSha","configHash") VALUES($1,$2,$3,$4,$5,$6)`, [table.includes('CustomerControl'),config.mode,config.origin,config.deploymentId,config.releaseSha,config.configHash]);
    await setup.query('INSERT INTO atlas_staff."PublicReaderControl"(enabled,mode,origin,"deploymentId","releaseSha","configHash") VALUES($1,$2,$3,$4,$5,$6)', [false,config.mode,'http://127.0.0.1:4319','local-public-fixture',config.releaseSha,config.configHash]);
    await setup.query('INSERT INTO atlas_customer."CustomerServiceControl"(binding) VALUES($1)', [config.binding]);
    await setup.query('INSERT INTO atlas_customer."CommerceControl"(binding,merchant) VALUES($1,$2)', [config.binding,{}]);
    // Synthetic setup only, restored before preservation baseline; no live rows copied.
    await setup.query('BEGIN'); try { await setup.query('ALTER TABLE atlas_staff."SmsPilotControl" DISABLE TRIGGER "SmsPilotControl_no_replace"'); await setup.query("INSERT INTO atlas_staff.\"SmsPilotControl\"(application) VALUES('STAFF'),('CUSTOMER')"); await setup.query('ALTER TABLE atlas_staff."SmsPilotControl" ENABLE TRIGGER "SmsPilotControl_no_replace"'); await setup.query('COMMIT'); } catch (e) { await setup.query('ROLLBACK'); throw e; }
    const auth = new CustomerAuth({ database: new CustomerDatabase(customerClient, config), config, provider: fixtureProvider(config) });
    const boot = await auth.bootstrap('', 'collection-foundation'), initial = `${config.cookies.browser}=${boot.browserToken}`;
    const challenge = await auth.send(initial, boot.csrf, { phone: '+12025550811', requestId: randomUUID() }, 'collection-foundation');
    const signed = await auth.verify(initial, boot.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'collection-foundation');
    const cookie = `${initial}; ${config.cookies.session}=${signed.token}`;
    const staffId = randomUUID(), cardId = randomUUID(), actionId = randomUUID(), requestId = randomUUID(), report = '{"identity":{"playerName":"SYNTHETIC"},"finalGrade":8}';
    await setup.query('INSERT INTO atlas_staff."StaffIdentity"(id,"phoneHash",name) VALUES($1,$2,$3)', [staffId,hash('synthetic-staff'),'SYNTHETIC']);
    await setup.query('INSERT INTO atlas_manual_intake.card(id,pair_id,owner_id,create_request_id,create_request_hash,label) VALUES($1,$2,$3,$4,$5,$6)', [cardId,randomUUID(),staffId,requestId,hash(requestId),'SYNTHETIC migration']);
    await setup.query("INSERT INTO atlas_manual.card(id,revision,content,content_hash,owner_id) VALUES($1,1,'{}',$2,$3)", [cardId,hash('{}'),staffId]);
    await setup.query('INSERT INTO atlas_manual.public_report_identity(card_id,public_token,report_number) VALUES($1,$2,$3)', [cardId,`ar_${randomUUID().replaceAll('-','').slice(0,24)}`,`ATLAS-${randomUUID().replaceAll('-','').slice(0,12).toUpperCase()}`]);
    await setup.query("INSERT INTO atlas_manual.action(card_id,action_id,actor_id,expected_revision,result_revision,request_hash,request,result) VALUES($1,$2,$3,1,2,$4,'{}','{}')", [cardId,actionId,staffId,hash('{}')]);
    await setup.query('INSERT INTO atlas_manual.approval(card_id,action_id,actor_id,source_revision,source_hash,report_hash,report) VALUES($1,$2,$3,1,$4,$5,$6)', [cardId,actionId,staffId,hash('source'),hash(report),report]);
    await setup.query("INSERT INTO atlas_manual.publication(card_id,action_id,version,mode) VALUES($1,$2,1,'LOCAL_FIXTURE')", [cardId,actionId]);
    await setup.query("UPDATE atlas_manual.publication SET state='PUBLISHED',manifest='{}',manifest_hash=$1,public_hash=$2,published_at=clock_timestamp() WHERE card_id=$3 AND action_id=$4", [hash('{}'),hash(actionId),cardId,actionId]);
    const roleSnapshot=async()=>({roles:(await setup.query('SELECT * FROM pg_roles WHERE rolname=ANY($1::text[]) ORDER BY rolname',[[ownerRole,...Object.values(roles),compRole,readRole,prefRole]])).rows,memberships:(await setup.query('SELECT * FROM pg_auth_members ORDER BY roleid,member')).rows});
    const before = await census(setup), priorCatalog = await catalog(setup), priorRoles=await roleSnapshot(), ledger = (await setup.query('SELECT * FROM atlas_staff._standalone_migrations ORDER BY version')).rows;
    assert.equal(ledger.length, 9); checks.push('populated ledger9, seven control rows, exact retained serving grants and independently pinned comp schema');
    const applied = await applyStandaloneMigrations(setup); assert.deepEqual(applied.applied, [{ version: definition.migration.version, checksum: definition.migration.sqlSha256 }]);
    const after = await census(setup), afterCatalog = await catalog(setup);
    for (const [name, value] of Object.entries(before)) if (!name.endsWith('._standalone_migrations')) assert.deepEqual(after[name], value, name);
    assert.deepEqual(Object.keys(after).filter(k => !Object.hasOwn(before,k)).sort(), ['atlas_ownership.event','atlas_ownership.reviewer_authority']);
    assert.equal(after['atlas_ownership.event'].count,0); assert.equal(after['atlas_ownership.reviewer_authority'].count,0);
    for (const entry of priorCatalog) assert.deepEqual(afterCatalog.find(r => r.name === entry.name), entry, entry.name);
    assert.deepEqual(await roleSnapshot(),priorRoles);
    assert.deepEqual((await setup.query('SELECT * FROM atlas_staff._standalone_migrations WHERE version<>$1 ORDER BY version',[definition.migration.version])).rows, ledger);
    evidence.push({ before, after, existingCatalogSha256: hash(stable(priorCatalog)), existingCatalogEntries: priorCatalog.length });
    await assertRegisteredOwnershipFoundation(q => setup.query(q)); checks.push('010 only adds empty foundation objects and one ledger row; every old table/catalog/ACL/control unchanged');
    assert.equal((await applyStandaloneMigrations(setup)).status,'NO_OP'); assert.deepEqual(await census(setup),after); assert.deepEqual(await catalog(setup),afterCatalog);
    await assertCompCurationDatabase(txRaw(comp), { role: compRole, schemaOwner: ownerRole, schemaSha256: compSchemaSha256 });
    for (const role of [...Object.values(roles),compRole]) {
      const probe = await setup.query(`SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname IN('atlas_ownership','atlas_ownership_preferences') AND has_schema_privilege($1,oid,'USAGE,CREATE')) AS schema,
        EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('atlas_ownership','atlas_ownership_preferences') AND has_function_privilege($1,p.oid,'EXECUTE')) AS routine,
        EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='atlas_ownership' AND c.relkind='r' AND has_table_privilege($1,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')) AS relation,
        EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE CASE WHEN n.nspname='atlas_ownership' AND c.relkind='S' THEN has_sequence_privilege($1,c.oid,'USAGE,SELECT,UPDATE') ELSE false END) AS sequence`,[role]);
      assert.deepEqual(probe.rows,[{schema:false,routine:false,relation:false,sequence:false}]);
    }
    checks.push('repeat no-op; original serving roles gain no ownership rights; retained comp role and a1bbdf29 schema still pass');
    await setup.query(cardOwnershipReadGrantSQL(readRole)); await setup.query(cardOwnershipPreferencesGrantSQL(prefRole));
    const readDb=await socket(readRole), prefDb=await socket(prefRole); const reader=createCardOwnershipReadService({auth,client:clientRaw(readDb)});
    const prefs=createCardOwnershipPreferencesService({customerAuth:auth,client:clientRaw(prefDb),servingRole:prefRole,schemaOwner:ownerRole});
    const readBefore=await census(setup), collection=await reader.read(cookie,'read_collection',{afterCardId:null,limit:25});
    assert.equal(collection.accountId,signed.customer.id); assert.deepEqual(collection.cards,[]); assert.equal(collection.preferences.visibility,'PRIVATE');
    assert.equal((await prefs.call(cookie,'read_preferences',{})).collectionPreferences.offersDisabled,false); assert.deepEqual(await census(setup),readBefore);
    const input={requestId:randomUUID(),expectedPreferenceRevision:0,visibility:'PRIVATE',offersDisabled:true};
    const receipt=await prefs.call(cookie,'set_collection_preferences',input,signed.csrf), recovered=await prefs.call(cookie,'recover_request',{requestId:input.requestId});
    assert.deepEqual(recovered.receipt,receipt.receipt); assert.deepEqual((await prefs.call(cookie,'set_collection_preferences',input,signed.csrf)).receipt,receipt.receipt);
    const written=await census(setup); for(const [name,value]of Object.entries(readBefore))if(name!=='atlas_ownership.event')assert.deepEqual(written[name],value,name);
    assert.equal(written['atlas_ownership.event'].count,1); const events=(await setup.query('SELECT * FROM atlas_ownership.event')).rows;
    assert.equal(events[0].kind,'COLLECTION_PREFERENCES_SET');assert.equal(events[0].customer_id,signed.customer.id);assert.equal(events[0].request_id,input.requestId);assert.deepEqual(events[0].input,input);
    for(const db of [readDb,prefDb]) for(const q of ['SELECT * FROM atlas_ownership.event','SELECT atlas_ownership.customer_call(NULL,NULL,NULL,NULL,NULL)','SELECT atlas_ownership.staff_call(NULL,NULL,NULL,NULL,NULL)'])await assert.rejects(db.query(q),e=>e.code==='42501');
    evidence.push({readBefore,written,eventId:events[0].id,requestId:input.requestId});prefs.close(); checks.push('real customer read remains empty/PRIVATE; narrow preference save/recovery/replay changes exactly one account preference event, no title or reviewer');
    await control.query('CREATE DATABASE atlas_collection_fresh');const fresh=await socket(ownerRole,'atlas_collection_fresh');await applyStandaloneMigrations(fresh);await assertRegisteredOwnershipFoundation(q=>fresh.query(q));
    const freshRows=await census(fresh);for(const [name,value]of Object.entries(freshRows))if(!name.endsWith('._standalone_migrations'))assert.equal(value.count,0,name);assert.equal(freshRows['atlas_staff._standalone_migrations'].count,10);checks.push('fresh full chain has ten exact ledger rows and zero application seeds');
    await control.query('CREATE DATABASE atlas_collection_refusal');const refusal=await socket(ownerRole,'atlas_collection_refusal');await applyStandaloneBaseline(refusal);
    for(const m of definition.migrations.slice(0,8)){await refusal.query('BEGIN');try{await refusal.query(m.sql);await refusal.query('INSERT INTO atlas_staff._standalone_migrations(version,checksum) VALUES($1,$2)',[m.version,m.sqlSha256]);await refusal.query('COMMIT');}catch(e){await refusal.query('ROLLBACK');throw e;}}
    await refusal.query('CREATE SCHEMA atlas_ownership');const partialBefore=await census(refusal),partialCatalog=await catalog(refusal);
    await assert.rejects(applyStandaloneMigrations(refusal),e=>e.code==='42P06');assert.deepEqual(await census(refusal),partialBefore);assert.deepEqual(await catalog(refusal),partialCatalog);
    // This explicit empty synthetic namespace is owned by this fixture only.
    await refusal.query('DROP SCHEMA atlas_ownership');await refusal.query("UPDATE atlas_staff._standalone_migrations SET checksum=$1 WHERE version=$2",['0'.repeat(64),definition.migrations[0].version]);
    const driftBefore=await census(refusal);await assert.rejects(applyStandaloneMigrations(refusal),/LEDGER_INVALID/);assert.deepEqual(await census(refusal),driftBefore);
    checks.push('unexpected partial schema rolls back010; corrupted known-prefix checksum refuses without repair');
    result={pass:true,checks,evidence,ledgerRows:10,previousLedgerRows:9,compSchemaSha256,existingTables:Object.keys(before).length,oldTablesUnchangedExceptLedger:true,newOwnershipTablesEmptyAfterMigration:true,syntheticOnly:true};
  }catch(error){failure=error;result={pass:false,checks,evidence,error:{name:error.name,code:error.code,message:safe(error.message),stack:safe(error.stack)}};}
  finally {
    const clientCloses=await Promise.allSettled([...clients].map(c=>Promise.resolve().then(()=>c.$disconnect()))),socketCloses=await Promise.allSettled([...sockets].map(c=>Promise.resolve().then(()=>c.end())));
    const outcomes=values=>values.map(v=>v.status==='fulfilled'?{status:v.status}:{status:v.status,error:safe(v.reason?.message??v.reason)});
    let stoppedVerified=false;
    if(started){const own=JSON.parse(await readFile(resolve(plan.directory,'ownership.json')));assert.equal(own.nonce,plan.nonce);assert.equal(own.data,plan.data);assert.equal(own.ownerPid,process.pid);assert.equal((await stat(plan.directory)).uid,process.getuid());
      const status=spawnSync(resolve(bin,'pg_ctl'),['-D',plan.data,'status'],{env});if(status.status===0)run('pg_ctl',['-D',plan.data,'-m','fast','-w','stop']);else assert.equal(status.status,3);
      assert.equal(spawnSync(resolve(bin,'pg_ctl'),['-D',plan.data,'status'],{env}).status,3);await rm(plan.data,{recursive:true});await assert.rejects(stat(plan.data),{code:'ENOENT'});stoppedVerified=true;}
    await writeFile(resolve(output,'validation.log'),log,{flag:'wx',mode:0o600});await copyFile(resolve(plan.directory,'postgres.log'),resolve(output,'postgres.log')).catch(()=>{});
    await save(resolve(output,'cleanup.json'),{stoppedVerified,ownedDataAbsent:stoppedVerified,nonce:plan.nonce,directory:plan.directory,clientCloses:outcomes(clientCloses),socketCloses:outcomes(socketCloses)});
    if([...clientCloses,...socketCloses].some(v=>v.status==='rejected')){failure??=Error('Owned connection cleanup failed after stop');result={...result,pass:false,cleanupFailure:true};}
    result={...result,sourceRefs:plan.sources,planSha256:argument,stoppedVerified,node:process.version,productionQueries:0,providerCalls:0,storageCalls:0,cleanupSha256:hash(await readFile(resolve(output,'cleanup.json')))};
    await save(resolve(output,'postgres-result.json'),result);process.stdout.write(JSON.stringify({pass:result.pass,groups:checks.length,stoppedVerified,output})+'\n');
  }
  if(failure)throw failure;
}
