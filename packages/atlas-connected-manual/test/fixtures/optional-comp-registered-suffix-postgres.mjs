// Finite owned PG17 installation-boundary proof only; semantic suites are reused.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, stat, rm, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { digest } from '../../../atlas-manual-service/src/contract.mjs';
import { applyStandaloneMigrations } from '../../../atlas-standalone-database/migrate.mjs';
import { registeredMigrations } from '../../../atlas-standalone-database/registered-migrations.mjs';
import { applyCompFoundation, assertRegisteredCompFoundation } from '../../../atlas-standalone-database/test/comp-foundation-fixture.mjs';
import { inspectCompCurationSchema } from '../../src/comp-curation-database.mjs';
import { inspectArchiveMarketSearchSchema } from '../../src/market-archive-database.mjs';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const [mode, output] = process.argv.slice(2);
assert(['--prepare', '--execute'].includes(mode) && output && resolve(output) === output && process.argv.length === 4);
assert(!Object.keys(process.env).some(k => /^(DATABASE_URL|DIRECT_URL|ATLAS_DATABASE_URL|PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATA|PGSERVICE|PGSERVICEFILE)$/.test(k)));
const bin = '/opt/homebrew/opt/postgresql@17/bin', pgModule = '/Users/markthomas/.codex/atlas-handoffs/atlas-v4-labels-pg-runtime/node_modules/pg';
const planPath=resolve(output,'launch-plan.json'),sourcePaths=[
 'packages/atlas-connected-manual/test/fixtures/optional-comp-registered-suffix-postgres.mjs',
 'packages/atlas-standalone-database/migrate.mjs','packages/atlas-standalone-database/registered-migrations.mjs',
 'packages/atlas-standalone-database/test/comp-foundation-fixture.mjs',
 'packages/atlas-standalone-database/baseline.manifest.json','packages/atlas-standalone-database/migrations.manifest.json',
 'packages/atlas-standalone-database/sql/baseline.sql',
 'packages/atlas-connected-manual/src/comp-curation-database.mjs','packages/atlas-connected-manual/src/market-archive-database.mjs',
 'packages/atlas-connected-manual/sql/comp-curation-proposal.sql',
 ...['002-variant-label-retry','003-report-image-retry','004-label-sheets','005-photoroom-removal','006-variant-shared-label-retry','007-label-layout-retry','008-graded-cards-archive','009-card-provenance','010-collection-foundation','011-comp-curation','012-optional-comp-archive'].map(n=>`packages/atlas-standalone-database/sql/${n}.sql`),
];
const save = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const pin = async path => ({ path, sha256: digest(await readFile(resolve(root, path))) });
if (mode === '--prepare') {
  await mkdir(output, { mode: 0o700 }); await mkdir(resolve(output, 'cluster'), { mode: 0o700 });
  await mkdir(resolve(output, 'source-used'), { mode: 0o700 });
  const port = await new Promise((done, reject) => { const server = createServer().once('error', reject);
    server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(error => error ? reject(error) : done(port)); }); });
  const sources = [];
  for (const path of sourcePaths) { const ref = await pin(path); sources.push(ref); await writeFile(resolve(output, 'source-used', path.replaceAll('/', '__')), await readFile(resolve(root, path)), { flag: 'wx', mode: 0o600 }); }
  const plan = { schema: 'atlas-optional-comp-registered-suffix-owned-pg-plan-v1', output, directory: resolve(output, 'cluster'), data: resolve(output, 'cluster/data'),
    host: '127.0.0.1', unixSockets: false, port, nonce: randomBytes(16).toString('hex'), bin, pgModule, sources,
    sourceCommit: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim(),
    groups: ['explicit registered prefix through011', 'actual suffix rollback before ledger insert', 'one registered012 and exact ledger/schema', 'second invocation no-op and refusal to rewind through011'],
    externalCalls: 0, productionConnections: 0 };
  await save(planPath, plan); process.stdout.write(JSON.stringify({ prepared: true, planPath, sha256: digest(await readFile(planPath)), directory: plan.directory, port, nonce: plan.nonce }) + '\n');
} else {
  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  assert.equal(plan.output, output); assert.equal(plan.directory, resolve(output, 'cluster')); assert.equal(plan.data, resolve(plan.directory, 'data'));
  assert.equal(plan.bin, bin); assert.equal(plan.pgModule, pgModule); assert.equal(plan.host, '127.0.0.1'); assert.equal(plan.unixSockets, false);
  assert.match(plan.nonce, /^[a-f0-9]{32}$/); assert(Number.isInteger(plan.port) && plan.port > 0 && plan.port < 65536);
  for (const ref of plan.sources) assert.deepEqual(await pin(ref.path), ref, ref.path);
  await assert.rejects(stat(plan.data), { code: 'ENOENT' });
  await save(resolve(output, 'execute-intent.json'), { nonce: plan.nonce, planSha256: digest(await readFile(planPath)), pid: process.pid });
  const { Client } = createRequire(import.meta.url)(pgModule), clients = new Set(), sockets = new Set();
  const passwords = Array.from({ length: 3 }, () => randomBytes(24).toString('hex'));
  const ownerRole = 'atlas_fixture_owner', staffRole = 'atlas_fixture_staff', role = 'atlas_fixture_curation';
  const dbName = `atlas_curation_${plan.nonce.slice(0, 12)}`;
  const url = (who, database = dbName) => `postgresql://${who}:${passwords[[ownerRole, staffRole, role].indexOf(who)]}@127.0.0.1:${plan.port}/${database}?schema=${who === role ? 'atlas_manual' : 'atlas_staff'}&connection_limit=4`;
  const cleanEnv = { HOME: process.env.HOME, PATH: '/usr/bin:/bin:/opt/homebrew/bin', LANG: 'C' };
  let log = '', started = false, result, failure, admin, schemaPin, shortNext = false;
  const checks = [], phases = [], waitProofs = [], exchanges = [];
  const safe = value => passwords.reduce((v, p) => v.replaceAll(p, '[fixture-secret]'), String(value));
  const run = (cmd, args) => { const r = spawnSync(cmd, args, { env: cleanEnv, encoding: 'utf8', timeout: 120000, maxBuffer: 8e6 });
    log += safe((r.stdout ?? '') + (r.stderr ?? '')); assert.equal(r.status, 0, safe(r.error?.message ?? r.stderr)); return r.stdout; };
  const socket = async (who = ownerRole, database = dbName) => { const c = new Client({ connectionString: url(who, database), connectionTimeoutMillis: 3000 }); await c.connect(); sockets.add(c); return c; };
  const raw = c => ({ $queryRawUnsafe: async (q, ...v) => (await c.query(q, v)).rows, $executeRawUnsafe: async (q, ...v) => (await c.query(q, v)).rowCount });
  try {
    await save(resolve(plan.directory, 'ownership.json'), { nonce: plan.nonce, directory: plan.directory, data: plan.data, ownerPid: process.pid, uid: process.getuid(), createdByHarness: true, port: plan.port });
    const passwordFile = resolve(plan.directory, 'owner-password'); await writeFile(passwordFile, passwords[0], { flag: 'wx', mode: 0o600 });
    assert.match(run(resolve(bin, 'postgres'), ['--version']), /PostgreSQL\) 17\./);
    run(resolve(bin, 'initdb'), ['-D', plan.data, '--username', ownerRole, '--pwfile', passwordFile, '--auth-host=scram-sha-256', '--auth-local=reject', '--encoding=UTF8', '--locale=C']);
    started = true;
    run(resolve(bin, 'pg_ctl'), ['-D', plan.data, '-l', resolve(plan.directory, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${plan.port} -c unix_socket_directories=''`, '-w', 'start']);
    await rm(passwordFile);
    const control = await socket(ownerRole, 'postgres');
    assert.deepEqual((await control.query("SELECT current_setting('data_directory') data,current_setting('listen_addresses') host,current_setting('unix_socket_directories') sockets")).rows[0], { data: plan.data, host: '127.0.0.1', sockets: '' });
    await control.query(`CREATE DATABASE ${dbName}`);
    const setup=await socket();
    const migrations=await registeredMigrations(),latest=migrations.at(-1);
    assert.equal(latest.version,'atlas-standalone-012-optional-comp-archive');
    assert.equal(latest.sqlSha256,'b2da5f767389d07a3b2afa76b69c8443b0a9304a2ff431e6f2b7e0ee54a284c8');
    assert.equal(digest(await readFile(resolve(root,'packages/atlas-standalone-database/migrations.manifest.json'))),'c4fb62c5db8a9917a0fe0eaf402ffb544732664fad8a53cc13b9be6d623bc555');
    const prefix=await applyCompFoundation(setup);assert.equal(prefix.through,'atlas-standalone-011-comp-curation');
    await setup.query('SET search_path=pg_catalog');await assertRegisteredCompFoundation((sql,...values)=>setup.query(sql,values));
    const oldComp=await inspectCompCurationSchema(raw(setup)),oldMarket=await inspectArchiveMarketSearchSchema(raw(setup));
    const tables=(await setup.query("SELECT n.nspname schema,c.relname name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname LIKE 'atlas_%' ORDER BY n.nspname,c.relname")).rows;
    async function census(){const out={};for(const t of tables)out[`${t.schema}.${t.name}`]=(await setup.query(`SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) value FROM "${t.schema}"."${t.name}" r`)).rows[0].value;return out;}
    const before=await census(),oldLedger=before['atlas_staff._standalone_migrations'];assert.equal(oldLedger.length,11);
    checks.push('explicit test-only registered prefix stops at011 and validates its original catalog');
    let injected=0;
    const interrupted={query:async(sql,values)=>{
      if(sql==='INSERT INTO atlas_staff._standalone_migrations(version,checksum) VALUES($1,$2)' && values?.[0]===latest.version){
        injected++;assert.equal((await inspectCompCurationSchema(raw(setup))).sha256,'5eed11b83e4ad6a8e1afab7a3d4ff1b79288dee5193a9b0a1026891bd88f5ab1');
        assert.equal((await inspectArchiveMarketSearchSchema(raw(setup))).sha256,'72aabf7f71e37e8238822faa71e0c8d975b2567648cddbeeb61c086e235e6a57');
        return setup.query('SELECT 1/0');
      }
      return setup.query(sql,values);
    }};
    await assert.rejects(applyStandaloneMigrations(interrupted),e=>e.code==='22012');assert.equal(injected,1);
    assert.deepEqual(await census(),before);assert.deepEqual(await inspectCompCurationSchema(raw(setup)),oldComp);assert.deepEqual(await inspectArchiveMarketSearchSchema(raw(setup)),oldMarket);
    checks.push('actual server error after registered012 DDL but before ledger insertion rolls back all DDL and rows');
    const applied=await applyStandaloneMigrations(setup);assert.equal(applied.status,'APPLIED');assert.deepEqual(applied.applied,[{version:latest.version,checksum:latest.sqlSha256}]);
    const after=await census(),newLedger=after['atlas_staff._standalone_migrations'];assert.equal(newLedger.length,12);
    assert.deepEqual(newLedger.filter(r=>r.version!==latest.version),oldLedger);assert.equal(newLedger.find(r=>r.version===latest.version).checksum,latest.sqlSha256);
    assert.deepEqual({...after,'atlas_staff._standalone_migrations':oldLedger},before);
    const newComp=await inspectCompCurationSchema(raw(setup)),newMarket=await inspectArchiveMarketSearchSchema(raw(setup));
    assert.equal(newComp.sha256,'5eed11b83e4ad6a8e1afab7a3d4ff1b79288dee5193a9b0a1026891bd88f5ab1');
    assert.equal(newMarket.sha256,'72aabf7f71e37e8238822faa71e0c8d975b2567648cddbeeb61c086e235e6a57');
    checks.push('actual registered suffix applies only012 with exact checksum/one ledger row and qualified schema pins');
    const noop=await applyStandaloneMigrations(setup);assert.equal(noop.status,'NO_OP');assert.deepEqual(noop.applied,[]);
    await assert.rejects(applyCompFoundation(setup),/STANDALONE_MIGRATION_LEDGER_INVALID/);
    assert.deepEqual(await census(),after);assert.deepEqual(await inspectCompCurationSchema(raw(setup)),newComp);assert.deepEqual(await inspectArchiveMarketSearchSchema(raw(setup)),newMarket);
    checks.push('second actual migrator invocation is exact no-op; test prefix installer cannot rewind012');
    await save(resolve(output,'ledger-before.json'),oldLedger);await save(resolve(output,'ledger-after.json'),newLedger);
    result={pass:true,checks,applied,noop,rollbackInjectedOnce:injected===1,ledgerRows:12,oldLedgerRowsPreserved:true,
      protectedTablesUnchanged:tables.length-1,curationSchemaSha256:newComp.sha256,marketSchemaSha256:newMarket.sha256,
      migrationVersion:latest.version,migrationSha256:latest.sqlSha256,semanticGroupsReused:15,semanticGroupsRerun:0,productionRegistrationApplied:false,defaultsOff:true};
  } catch (error) { failure = error; result = { pass: false, checks, phases, waitProofs, exchanges, error: { name: error.name, code: error.code, message: safe(error.message), stack: safe(error.stack) } }; }
  finally {
    await Promise.all([...clients].map(c => c.$disconnect()));
    await Promise.all([...sockets].map(c => c.end().catch(() => {})));
    let stoppedVerified = false;
    if (started) {
      const ownership = JSON.parse(await readFile(resolve(plan.directory, 'ownership.json'), 'utf8'));
      assert.equal(ownership.nonce, plan.nonce); assert.equal(ownership.ownerPid, process.pid); assert.equal((await stat(plan.directory)).uid, process.getuid());
      const status = spawnSync(resolve(bin, 'pg_ctl'), ['-D', plan.data, 'status'], { env: cleanEnv });
      if (status.status === 0) run(resolve(bin, 'pg_ctl'), ['-D', plan.data, '-m', 'fast', '-w', 'stop']); else assert.equal(status.status, 3);
      assert.equal(spawnSync(resolve(bin, 'pg_ctl'), ['-D', plan.data, 'status'], { env: cleanEnv }).status, 3);
      await rm(plan.data, { recursive: true }); await assert.rejects(stat(plan.data), { code: 'ENOENT' }); stoppedVerified = true;
    }
    await writeFile(resolve(output, 'validation.log'), log, { flag: 'wx', mode: 0o600 });
    await save(resolve(output, 'cleanup.json'), { stoppedVerified, ownedDataAbsent: stoppedVerified, nonce: plan.nonce, directory: plan.directory });
    await copyFile(resolve(plan.directory, 'postgres.log'), resolve(output, 'postgres.log')).catch(() => {});
    result = { ...result, planSha256: digest(await readFile(planPath)), sourceRefs: plan.sources, ownedDirectory: plan.directory, port: plan.port, nonce: plan.nonce,
      node: process.version, stoppedVerified, syntheticOnly: true, productionQueries: 0, externalProviderCalls: 0, storageProviderCalls: 0, notificationEffects: 0,
      cleanupSha256: digest(await readFile(resolve(output, 'cleanup.json'))) };
    await save(resolve(output, 'postgres-result.json'), result);
    process.stdout.write(JSON.stringify({ pass: result.pass, checks: checks.length, stoppedVerified, output }) + '\n');
  }
  if (failure) throw failure;
}
