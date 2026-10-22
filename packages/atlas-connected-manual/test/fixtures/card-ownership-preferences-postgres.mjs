// Dedicated owned PG17 only. --prepare writes a finite source/path/port/nonce
// plan; --execute is a SEPARATE root-approved operation. No existing DB reuse.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, stat, rm, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '../../../../frontend/atlas-app/.generated/staff-database/index.js';
import { applyStandaloneBaseline, applyStandaloneMigrations } from '../../../atlas-standalone-database/migrate.mjs';
import { initializeStandaloneCoordination } from '../../../atlas-standalone-database/initialize.mjs';
import { localAccessConfig, seedLocalStaff } from '../../../../frontend/atlas-app/lib/server/access/fixture.mjs';
import { CustomerAuth } from '../../../../frontend/atlas-customer/lib/server/auth.mjs';
import { CustomerDatabase, customerGrantSQL } from '../../../../frontend/atlas-customer/lib/server/database.mjs';
import { localConfig, fixtureProvider } from '../../../../frontend/atlas-customer/lib/server/fixture.mjs';
import { createCardOwnershipPreferencesService, cardOwnershipPreferencesGrantSQL } from '../../src/card-ownership-preferences-service.mjs';
import { projectOwnershipPreferences } from '../../src/card-ownership-preferences-contract.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url)), [mode, output] = process.argv.slice(2);
assert(['--prepare','--execute'].includes(mode) && output && resolve(output) === output && process.argv.length === 4);
assert(!Object.keys(process.env).some(k => /^(DATABASE_URL|DIRECT_URL|ATLAS_DATABASE_URL|PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATA|PGSERVICE|PGSERVICEFILE)$/.test(k)));
const bin = '/opt/homebrew/opt/postgresql@17/bin', pgModule = '/Users/markthomas/.codex/atlas-handoffs/atlas-v4-labels-pg-runtime/node_modules/pg';
const hash = v => createHash('sha256').update(v).digest('hex');
const stable = v => JSON.stringify(v, (_k, x) => x && Object.getPrototypeOf(x) === Object.prototype ? Object.fromEntries(Object.entries(x).sort(([a],[b]) => a.localeCompare(b))) : x);
const save = (p, v) => writeFile(p, JSON.stringify(v, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const planPath = resolve(output, 'launch-plan.json');
const sourcePaths = ['packages/atlas-connected-manual/sql/card-ownership-preferences-proposal.sql',
  'packages/atlas-connected-manual/src/card-ownership-preferences-contract.mjs', 'packages/atlas-connected-manual/src/card-ownership-preferences-service.mjs',
  'packages/atlas-connected-manual/test/card-ownership-preferences.test.mjs', 'packages/atlas-connected-manual/test/fixtures/card-ownership-preferences-postgres.mjs',
  'packages/atlas-connected-manual/sql/card-ownership-proposal.sql', 'packages/atlas-connected-manual/src/card-ownership-contract.mjs',
  'frontend/atlas-customer/lib/server/auth.mjs', 'frontend/atlas-customer/lib/server/database.mjs', 'frontend/atlas-customer/lib/server/fixture.mjs',
  'frontend/atlas-customer/lib/server/config.mjs', 'frontend/atlas-customer/lib/server/policy.mjs', 'frontend/atlas-app/lib/server/access/fixture.mjs',
  'packages/atlas-standalone-database/migrate.mjs', 'packages/atlas-standalone-database/initialize.mjs',
  'packages/atlas-standalone-database/sql/baseline.sql', 'packages/atlas-standalone-database/baseline.manifest.json', 'packages/atlas-standalone-database/migrations.manifest.json',
  ...['002-variant-label-retry','003-report-image-retry','004-label-sheets','005-photoroom-removal','006-variant-shared-label-retry','007-label-layout-retry','008-graded-cards-archive','009-card-provenance'].map(n => `packages/atlas-standalone-database/sql/${n}.sql`)];
const pin = async path => ({ path, sha256: hash(await readFile(resolve(root, path))) });
if (mode === '--prepare') {
  await mkdir(output, { mode: 0o700 }); await mkdir(resolve(output, 'cluster'), { mode: 0o700 }); await mkdir(resolve(output, 'source-used'), { mode: 0o700 });
  const port = await new Promise((done, reject) => { const s = createServer().once('error', reject); s.listen(0, '127.0.0.1', () => { const port = s.address().port; s.close(e => e ? reject(e) : done(port)); }); });
  const sources = [];
  for (const path of sourcePaths) { sources.push(await pin(path)); await writeFile(resolve(output, 'source-used', path.replaceAll('/', '__')), await readFile(resolve(root, path)), { flag: 'wx', mode: 0o600 }); }
  await save(planPath, { schema: 'atlas-ownership-preferences-owned-pg-plan-v1', output, directory: resolve(output, 'cluster'), data: resolve(output, 'cluster/data'),
    host: '127.0.0.1', unixSockets: false, port, nonce: randomBytes(16).toString('hex'), bin, pgModule, sources,
    groups: ['restricted actual customer authority/defaults/non-UTC', 'account/card CAS and opt-outs', 'lost committed reply and exact recovery/replay',
      'historical receipt after transfer/discard', 'actual privilege/definition drift refusal', 'post-append SQL expiry rollback with witnessed wait',
      'post-append JS authority/role rollback', 'observed owner/discard changes before write'],
    productionConnections: 0, externalProviderCalls: 0, storageProviderCalls: 0 });
  const p = JSON.parse(await readFile(planPath)); process.stdout.write(JSON.stringify({ prepared: true, planPath, sha256: hash(await readFile(planPath)), directory: p.directory, port, nonce: p.nonce }) + '\n');
} else {
  const plan = JSON.parse(await readFile(planPath));
  assert.equal(plan.output, output); assert.equal(plan.directory, resolve(output, 'cluster')); assert.equal(plan.data, resolve(plan.directory, 'data'));
  assert.equal(plan.host, '127.0.0.1'); assert.equal(plan.unixSockets, false); assert.equal(plan.bin, bin); assert.equal(plan.pgModule, pgModule);
  assert.match(plan.nonce, /^[a-f0-9]{32}$/); assert(Number.isInteger(plan.port) && plan.port > 0 && plan.port < 65536);
  assert.deepEqual(plan.sources.map(v => v.path), sourcePaths); for (const ref of plan.sources) assert.deepEqual(await pin(ref.path), ref);
  assert.equal((await pin('packages/atlas-connected-manual/sql/card-ownership-proposal.sql')).sha256, '00720728d42a1276d50c70998d22e9e309cec2b1bb5cdd9ba8c7126e16fc36a2');
  await assert.rejects(stat(plan.data), { code: 'ENOENT' });
  await save(resolve(output, 'execute-intent.json'), { nonce: plan.nonce, planSha256: hash(await readFile(planPath)), pid: process.pid });
  const { Client } = createRequire(import.meta.url)(pgModule), sockets = new Set(), clients = new Set();
  const ownerRole = 'atlas_fixture_owner', customerRole = 'atlas_fixture_customer', servingRole = 'atlas_fixture_preferences';
  const passwords = Array.from({ length: 3 }, () => randomBytes(24).toString('hex')), dbName = `atlas_prefs_${plan.nonce.slice(0, 12)}`;
  const url = (who, db = dbName) => `postgresql://${who}:${passwords[[ownerRole,customerRole,servingRole].indexOf(who)]}@127.0.0.1:${plan.port}/${db}?schema=${who === ownerRole ? 'atlas_staff' : 'atlas_customer'}&connection_limit=4`;
  const cleanEnv = { HOME: process.env.HOME, PATH: '/usr/bin:/bin:/opt/homebrew/bin', LANG: 'C' };
  let log = '', started = false, failure, result, setup, restricted, afterGateway, afterCommit, observedBackend;
  const checks = [], phases = [], waitProofs = [];
  const safe = v => passwords.reduce((text, p) => text.replaceAll(p, '[fixture-secret]'), String(v));
  const run = (cmd, args) => { const r = spawnSync(cmd, args, { env: cleanEnv, encoding: 'utf8', timeout: 120000, maxBuffer: 8e6 }); log += safe((r.stdout ?? '') + (r.stderr ?? '')); assert.equal(r.status, 0, safe(r.error?.message ?? r.stderr)); return r.stdout; };
  const socket = async (who = ownerRole, db = dbName) => { const c = new Client({ connectionString: url(who, db), connectionTimeoutMillis: 3000 }); await c.connect(); sockets.add(c); return c; };
  try {
    await save(resolve(plan.directory, 'ownership.json'), { nonce: plan.nonce, directory: plan.directory, data: plan.data, ownerPid: process.pid, uid: process.getuid(), createdByHarness: true });
    const passwordFile = resolve(plan.directory, 'owner-password'); await writeFile(passwordFile, passwords[0], { flag: 'wx', mode: 0o600 });
    assert.match(run(resolve(bin, 'postgres'), ['--version']), /PostgreSQL\) 17\./);
    run(resolve(bin, 'initdb'), ['-D', plan.data, '--username', ownerRole, '--pwfile', passwordFile, '--auth-host=scram-sha-256', '--auth-local=reject', '--encoding=UTF8', '--locale=C']);
    started = true; run(resolve(bin, 'pg_ctl'), ['-D', plan.data, '-l', resolve(plan.directory, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${plan.port} -c unix_socket_directories=''`, '-w', 'start']); await rm(passwordFile);
    const control = await socket(ownerRole, 'postgres');
    assert.deepEqual((await control.query("SELECT current_setting('data_directory') data,current_setting('listen_addresses') host,current_setting('unix_socket_directories') sockets")).rows[0], { data: plan.data, host: '127.0.0.1', sockets: '' });
    await control.query(`CREATE DATABASE ${dbName}`); setup = await socket();
    await applyStandaloneBaseline(setup); await applyStandaloneMigrations(setup); await initializeStandaloneCoordination(setup, { geometryConcurrency: 2 });
    await setup.query(await readFile(resolve(root, 'packages/atlas-connected-manual/sql/card-ownership-proposal.sql'), 'utf8'));
    await setup.query(await readFile(resolve(root, 'packages/atlas-connected-manual/sql/card-ownership-preferences-proposal.sql'), 'utf8'));
    await setup.query(`REVOKE TEMPORARY ON DATABASE ${dbName} FROM PUBLIC`); // Only this owned DB; no production authority.
    for (const [i, who] of [[1,customerRole],[2,servingRole]]) await control.query(`CREATE ROLE ${who} LOGIN PASSWORD '${passwords[i]}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`);
    await setup.query(customerGrantSQL(customerRole)); await setup.query(cardOwnershipPreferencesGrantSQL(servingRole));
    const admin = new PrismaClient({ datasources: { db: { url: url(ownerRole) } } }), customerClient = new PrismaClient({ datasources: { db: { url: url(customerRole) } } }); clients.add(admin); clients.add(customerClient);
    const staffConfig = localAccessConfig({ databaseUrl: url(ownerRole), sessionKey: randomBytes(32), phoneKey: randomBytes(32), phones: ['+12025550172'] });
    await seedLocalStaff(admin, staffConfig, { trained: true });
    const staffId = (await setup.query('SELECT id FROM atlas_staff."StaffIdentity" LIMIT 1')).rows[0].id;
    const config = localConfig({ databaseUrl: url(customerRole), sessionKey: randomBytes(32), phoneKey: randomBytes(32) });
    const auth = new CustomerAuth({ database: new CustomerDatabase(customerClient, config), config, provider: fixtureProvider(config) });
    await setup.query('INSERT INTO atlas_customer."CustomerControl"(enabled,mode,origin,"deploymentId","releaseSha","configHash") VALUES(true,$1,$2,$3,$4,$5)', [config.mode,config.origin,config.deploymentId,config.releaseSha,config.configHash]);
    async function login(phone) {
      const boot = await auth.bootstrap('', 'preferences-fixture'), initial = `${config.cookies.browser}=${boot.browserToken}`;
      const challenge = await auth.send(initial, boot.csrf, { phone, requestId: randomUUID() }, 'preferences-fixture');
      const signed = await auth.verify(initial, boot.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'preferences-fixture');
      return { ...signed, cookie: `${initial}; ${config.cookies.session}=${signed.token}` };
    }
    const owner = await login('+12025550731'), other = await login('+12025550732'), expiring = await login('+12025550733');
    restricted = await socket(servingRole); await restricted.query("SET timezone='Pacific/Honolulu'");
    const client = { async $transaction(work, options) {
      assert.deepEqual(options, { maxWait: 3000, timeout: 8000 }); await restricted.query('BEGIN');
      try {
        if (observedBackend) observedBackend((await restricted.query('SELECT pg_backend_pid() pid')).rows[0].pid);
        const v = await work({ $executeRawUnsafe: async (q, ...args) => (await restricted.query(q,args)).rowCount,
          $queryRawUnsafe: async (q, ...args) => { const rows = (await restricted.query(q,args)).rows;
            if (q.startsWith('SELECT atlas_ownership_preferences.customer_call') && afterGateway) await afterGateway(args[3], args[4], rows);
            return rows; } });
        await restricted.query('COMMIT'); if (afterCommit) await afterCommit(); return v;
      } catch (e) { await restricted.query('ROLLBACK'); throw e; }
    } };
    const options = { customerAuth: auth, client, servingRole, schemaOwner: ownerRole }, service = createCardOwnershipPreferencesService(options);
    const attempts = new Map(), expectedTitles = new Map(), expectedDiscards = new Map();
    const call = (action, input, who = owner) => {
      if (action.startsWith('set_')) {
        const k = `${who.customer.id}:${input.requestId}`;
        if (!attempts.has(k)) attempts.set(k, { action, input: structuredClone(input), accountId: who.customer.id });
      }
      return service.call(who.cookie, action, input, who.csrf);
    };
    const raw = async (action, input, who = owner, binding = config.binding) => {
      const proof = auth.authority(who.cookie);
      return (await restricted.query('SELECT atlas_ownership_preferences.customer_call($1,$2,$3::jsonb,$4,$5::jsonb) result', [proof.sessionHash,proof.browserHash,JSON.stringify(binding),action,JSON.stringify(input)])).rows[0].result;
    };
    async function seed() {
      const c = { id: randomUUID(), createId: randomUUID() }, actionId = randomUUID();
      await setup.query('INSERT INTO atlas_manual_intake.card(id,pair_id,owner_id,create_request_id,create_request_hash,label) VALUES($1,$2,$3,$4,$5,$6)', [c.id,randomUUID(),staffId,c.createId,hash(c.createId),'SYNTHETIC preferences']);
      await setup.query("INSERT INTO atlas_manual.card(id,revision,content,content_hash,owner_id) VALUES($1,1,'{}',$2,$3)", [c.id,hash('{}'),staffId]);
      await setup.query('INSERT INTO atlas_manual.public_report_identity(card_id,public_token,report_number) VALUES($1,$2,$3)', [c.id,`ar_${randomUUID().replaceAll('-','').slice(0,24)}`,`ATLAS-${randomUUID().replaceAll('-','').slice(0,12).toUpperCase()}`]);
      const report = '{"identity":{"playerName":"SYNTHETIC"},"finalGrade":8}';
      await setup.query("INSERT INTO atlas_manual.action(card_id,action_id,actor_id,expected_revision,result_revision,request_hash,request,result) VALUES($1,$2,$3,1,2,$4,'{}','{}')", [c.id,actionId,staffId,hash('{}')]);
      await setup.query('INSERT INTO atlas_manual.approval(card_id,action_id,actor_id,source_revision,source_hash,report_hash,report) VALUES($1,$2,$3,1,$4,$5,$6)', [c.id,actionId,staffId,hash('source'),hash(report),report]);
      await setup.query("INSERT INTO atlas_manual.publication(card_id,action_id,version,mode) VALUES($1,$2,1,'LOCAL_FIXTURE')", [c.id,actionId]);
      await setup.query("UPDATE atlas_manual.publication SET state='PUBLISHED',manifest='{}',manifest_hash=$1,public_hash=$2,published_at=clock_timestamp() WHERE card_id=$3 AND action_id=$4", [hash('{}'),hash(actionId),c.id,actionId]);
      return c;
    }
    async function title(c, aid, revision = 1, db = setup) {
      await db.query("INSERT INTO atlas_ownership.event(card_id,staff_id,request_id,action,input,input_hash,kind,owner_account_id,ownership_revision) VALUES($1,$2,$3,'fixture-only','{}',$4,'CLAIM_VERIFIED',$5,$6)", [c.id,staffId,randomUUID(),hash('synthetic-title'),aid,revision]);
      expectedTitles.set(`${c.id}:${revision}`, { accountId: aid, revision });
    }
    async function discard(c, db = setup) {
      const id = randomUUID(); await db.query("INSERT INTO atlas_manual_intake.discard_request(owner_id,request_id,request,request_hash,receipt,receipt_hash) VALUES($1,$2,'{}',$3,'{}',$3)", [staffId,id,hash('{}')]);
      await db.query('INSERT INTO atlas_manual_intake.discarded_card(owner_id,create_request_id,card_id,request_id) VALUES($1,$2,$3,$4)', [staffId,c.createId,c.id,id]);
      expectedDiscards.set(c.id, { owner_id: staffId, create_request_id: c.createId, card_id: c.id, request_id: id });
    }
    const card = await seed(), transferCard = await seed(), discardedCard = await seed(), raceCard = await seed(), raceDiscard = await seed();
    for (const c of [card,transferCard,discardedCard,raceCard,raceDiscard]) await title(c,owner.customer.id);
    const unrelatedRequest = randomUUID();
    await setup.query("INSERT INTO atlas_ownership.event(card_id,customer_id,request_id,action,input,input_hash,kind) VALUES($1,$2,$3,'fixture-only','{}',$4,'CLAIM_SUBMITTED')", [card.id,owner.customer.id,unrelatedRequest,hash('synthetic-claim')]);
    const tables = (await setup.query("SELECT n.nspname schema,c.relname name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname LIKE 'atlas_%' ORDER BY 1,2")).rows;
    async function census() { const out = {}; for (const t of tables) out[`${t.schema}.${t.name}`] = (await setup.query(`SELECT to_jsonb(t) v FROM "${t.schema}"."${t.name}" t ORDER BY to_jsonb(t)::text`)).rows.map(r => r.v); return out; }
    function delta(before, after) { const out = {}; for (const name of Object.keys(before)) {
      const a = new Map(before[name].map(v => [stable(v),v])), b = new Map(after[name].map(v => [stable(v),v]));
      const removed = [...a.keys()].filter(k => !b.has(k)).map(k => a.get(k)), added = [...b.keys()].filter(k => !a.has(k)).map(k => b.get(k));
      if (removed.length || added.length) out[name] = { removed, added };
    } return out; }
    const counts = d => Object.fromEntries(Object.entries(d).map(([k,v]) => [k,{ removed:v.removed.length,added:v.added.length }]));
    async function assertRows(changes) {
      for (const e of changes['atlas_ownership.event']?.added ?? []) {
        assert(Number.isSafeInteger(Number(e.sequence)) && Number(e.sequence)>0); assert.match(e.id,/^[a-f0-9-]{36}$/); assert(Number.isFinite(Date.parse(e.created_at)));
        const { sequence, id, created_at, ...actual } = e;
        if (e.kind === 'CLAIM_VERIFIED') {
          const intended = expectedTitles.get(`${e.card_id}:${e.ownership_revision}`); assert(intended);
          assert.deepEqual(actual, { card_id: e.card_id, customer_id: null, staff_id: staffId, request_id: e.request_id,
            action:'fixture-only', input:{},input_hash:hash('synthetic-title'),kind:'CLAIM_VERIFIED',subject_id:null,
            owner_account_id:intended.accountId,ownership_revision:intended.revision,preference_revision:null,expires_at:null });
        } else {
          const intended = attempts.get(`${e.customer_id}:${e.request_id}`); assert(intended);
          const ih=(await setup.query("SELECT encode(sha256(convert_to(jsonb_build_object('action',$1::text,'input',$2::jsonb)::text,'UTF8')),'hex') h",[intended.action,JSON.stringify(intended.input)])).rows[0].h;
          assert.deepEqual(actual,{card_id:intended.input.cardId??null,customer_id:intended.accountId,staff_id:null,request_id:intended.input.requestId,
            action:intended.action,input:intended.input,input_hash:ih,kind:intended.action==='set_card_preferences'?'CARD_PREFERENCES_SET':'COLLECTION_PREFERENCES_SET',
            subject_id:null,owner_account_id:null,ownership_revision:null,preference_revision:intended.input.expectedPreferenceRevision+1,expires_at:null});
        }
      }
      for (const row of changes['atlas_manual_intake.discarded_card']?.added ?? []) {
        const { discarded_at, ...actual } = row; assert(Number.isFinite(Date.parse(discarded_at))); assert.deepEqual(actual,expectedDiscards.get(row.card_id));
      }
    }
    async function phase(name, expected, fn) { const before = await census(); await fn(); const after = await census(), changes = delta(before,after);
      assert.deepEqual(counts(changes), expected, name); await assertRows(changes);
      phases.push({ name, beforeSha256:hash(stable(before)),afterSha256:hash(stable(after)),changes }); }
    const baseline = await census(), coll = (revision, patch = {}) => ({ requestId:randomUUID(),expectedPreferenceRevision:revision,visibility:'PRIVATE',offersDisabled:false,...patch });
    const perCard = (c, revision = 0, patch = {}) => ({ ...coll(revision),cardId:c.id,expectedOwnershipRevision:1,...patch });
    let savedCardInput, transferInput, discardInput, lostInput, lostReceipt;
    await phase('restricted authority, default settings, closed gateway and non-UTC raw timestamps', {}, async () => {
      const v = await call('read_preferences',{}); assert.equal(v.collectionPreferences.visibility,'PRIVATE'); assert.equal(v.effective.preference,'OPEN_TO_OFFERS'); assert.equal(v.effective.canReceiveOffers,false);
      assert.equal((await call('read_preferences',{},other)).collectionPreferences.revision,0);
      const direct = await raw('read_preferences',{}); assert.match(direct.observedAt,/Z$/); projectOwnershipPreferences('read_preferences',direct,{},owner.customer.id);
      assert.equal((await restricted.query('SHOW timezone')).rows[0].TimeZone,'Pacific/Honolulu');
      await assert.rejects(service.readPreferences(''),{code:'SIGN_IN_REQUIRED'});
      await assert.rejects(service.setCollectionPreferences(owner.cookie,'bad',coll(0)),{code:'CSRF_REQUIRED'});
      for (const action of ['submit_claim','propose_transfer','accept_transfer','review_claim']) assert.equal((await raw(action,{})).error.code,'OWNERSHIP_PREFERENCES_ONLY');
      for (const q of ['SELECT * FROM atlas_ownership.event',"SELECT atlas_ownership.customer_call(NULL,NULL,'{}','read_preferences','{}')","SELECT atlas_ownership.preferences(NULL)","SELECT nextval('atlas_ownership.event_sequence_seq')"])
        await assert.rejects(restricted.query(q),{code:'42501'});
      assert.equal((await raw('read_preferences',{},owner,{...config.binding,releaseSha:'f'.repeat(40)})).error.code,'CUSTOMER_ACCESS_NOT_ENABLED');
    }); checks.push('sole gateway/live actual customer authority/defaults/non-UTC');
    await phase('independent collection/card CAS and retained opt-outs', { 'atlas_ownership.event':{removed:0,added:4} }, async () => {
      const a = coll(0,{visibility:'PUBLIC',offersDisabled:true}); await call('set_collection_preferences',a);
      savedCardInput = perCard(card,0,{visibility:'PUBLIC',offersDisabled:true}); const r = await call('set_card_preferences',savedCardInput);
      assert.equal((await call('set_card_preferences',savedCardInput)).receipt.eventId,r.receipt.eventId);
      await assert.rejects(call('set_card_preferences',{...savedCardInput,requestId:randomUUID()}),{code:'OWNERSHIP_PREFERENCE_CHANGED'});
      await assert.rejects(call('set_card_preferences',perCard(card),other),{code:'OWNERSHIP_NOT_FOUND'});
      await call('set_collection_preferences',coll(1,{visibility:'PRIVATE',offersDisabled:false}));
      const now = await call('read_card',{cardId:card.id}); assert.equal(now.collectionPreferences.revision,2); assert.equal(now.cardPreferences.revision,1);
      assert.equal(now.effective.visibility,'PRIVATE'); assert.equal(now.effective.preference,'DISABLED'); assert.equal(now.cardPreferences.offersDisabled,true);
      await call('set_collection_preferences',coll(0,{offersDisabled:true}),other); assert.equal((await call('read_preferences',{},other)).collectionPreferences.revision,1);
    }); checks.push('separate account/card revisions and explicit opt-out preservation');
    await phase('committed response loss, later state and exact historical recovery', { 'atlas_ownership.event':{removed:0,added:2} }, async () => {
      lostInput = coll(2,{visibility:'PUBLIC',offersDisabled:false}); afterCommit = async () => { afterCommit=null; throw Error('synthetic committed response lost'); };
      await assert.rejects(call('set_collection_preferences',lostInput),/committed response lost/);
      lostReceipt = await call('recover_request',{requestId:lostInput.requestId}); assert.equal(lostReceipt.outcome,'RECORDED'); assert.deepEqual(lostReceipt.receipt.input,lostInput);
      await call('set_collection_preferences',coll(3,{visibility:'PUBLIC',offersDisabled:false}));
      assert.equal((await call('read_preferences',{})).collectionPreferences.revision,4);
      assert.deepEqual((await call('recover_request',{requestId:lostInput.requestId})).receipt,lostReceipt.receipt);
      assert.deepEqual((await call('set_collection_preferences',lostInput)).receipt,lostReceipt.receipt);
      await assert.rejects(call('set_collection_preferences',{...lostInput,offersDisabled:true}),{code:'OWNERSHIP_REQUEST_CONFLICT'});
      for (const [id,who] of [[randomUUID(),owner],[unrelatedRequest,owner],[lostInput.requestId,other]]) assert.equal((await call('recover_request',{requestId:id},who)).outcome,'ABSENT');
    }); checks.push('unknown outcome resolved only by exact original receipt; no duplicate append');
    await phase('own historical receipts after transfer/discard do not disclose current title', { 'atlas_ownership.event':{removed:0,added:3},'atlas_manual_intake.discard_request':{removed:0,added:1},'atlas_manual_intake.discarded_card':{removed:0,added:1} }, async () => {
      transferInput=perCard(transferCard,0,{offersDisabled:true}); discardInput=perCard(discardedCard,0,{offersDisabled:true});
      await call('set_card_preferences',transferInput); await call('set_card_preferences',discardInput);
      await title(transferCard,other.customer.id,2); await discard(discardedCard);
      for (const [c,input] of [[transferCard,transferInput],[discardedCard,discardInput]]) {
        const prior=await call('recover_request',{requestId:input.requestId}); assert.deepEqual(prior.receipt.input,input);
        assert.deepEqual((await call('set_card_preferences',input)).receipt,prior.receipt);
        assert.doesNotMatch(JSON.stringify(prior),new RegExp(other.customer.id)); await assert.rejects(call('read_card',{cardId:c.id}),{code:'OWNERSHIP_NOT_FOUND'});
        await assert.rejects(call('set_card_preferences',{...input,requestId:randomUUID(),expectedPreferenceRevision:1}));
      }
      const next=await call('read_card',{cardId:transferCard.id},other); assert.equal(next.cardPreferences.revision,0); assert.equal(next.cardPreferences.visibility,'PRIVATE'); assert.equal(next.cardPreferences.offersDisabled,false);
    }); checks.push('historical own recovery/replay survives card access loss without owner leakage');
    await phase('actual privilege and definition drift is rejected', {}, async () => {
      const attempts = [
        [`GRANT MAINTAIN ON atlas_manual.card TO ${servingRole}`,`REVOKE MAINTAIN ON atlas_manual.card FROM ${servingRole}`],
        [`GRANT SELECT ON atlas_ownership.event TO ${servingRole}`,`REVOKE SELECT ON atlas_ownership.event FROM ${servingRole}`],
        [`GRANT EXECUTE ON FUNCTION atlas_ownership.customer_call(text,text,jsonb,text,jsonb) TO ${servingRole}`,`REVOKE EXECUTE ON FUNCTION atlas_ownership.customer_call(text,text,jsonb,text,jsonb) FROM ${servingRole}`],
        [`GRANT USAGE ON SEQUENCE atlas_ownership.event_sequence_seq TO ${servingRole}`,`REVOKE USAGE ON SEQUENCE atlas_ownership.event_sequence_seq FROM ${servingRole}`],
        [`GRANT TEMPORARY ON DATABASE ${dbName} TO ${servingRole}`,`REVOKE TEMPORARY ON DATABASE ${dbName} FROM ${servingRole}`],
        [`ALTER DATABASE ${dbName} OWNER TO ${servingRole}`,`ALTER DATABASE ${dbName} OWNER TO ${ownerRole}`],
        ["ALTER FUNCTION atlas_ownership_preferences.customer_call(text,text,jsonb,text,jsonb) SET search_path=public","ALTER FUNCTION atlas_ownership_preferences.customer_call(text,text,jsonb,text,jsonb) SET search_path=pg_catalog"],
      ];
      for (const [grant,revoke] of attempts) { await setup.query(grant); try { await assert.rejects(call('read_preferences',{}),{code:'OWNERSHIP_PREFERENCES_DATABASE_ROLE_INVALID'}); } finally { await setup.query(revoke); } }
    }); checks.push('MAINTAIN/database owner/original mutator/table/sequence/TEMP/config drift refused');
    const sleep = ms => new Promise(done=>setTimeout(done,ms));
    async function witness(pid, blocker, expiryHash=null) {
      const end=Date.now()+1000; let row;
      while(Date.now()<end) {
        row=(await setup.query(`SELECT pid,wait_event_type,pg_blocking_pids(pid) blockers,clock_timestamp() observed_at FROM pg_stat_activity WHERE pid=$1`,[pid])).rows[0];
        if(row?.wait_event_type==='Lock' && row.blockers.includes(blocker)) break; await sleep(10);
      }
      assert.equal(row?.wait_event_type,'Lock'); assert(row.blockers.includes(blocker));
      const proof={waiterPid:pid,blockerPid:blocker,waitEventType:row.wait_event_type,observedAt:row.observed_at};
      if(expiryHash) {
        const session=(await setup.query('SELECT clock_timestamp() observed_at,"expiresAt" stored_expiry,"expiresAt">clock_timestamp() authorized FROM atlas_customer."CustomerSession" WHERE "tokenHash"=$1',[expiryHash])).rows[0];
        assert.equal(session.authorized,true); proof.authorization=session;
      }
      waitProofs.push(proof); return proof;
    }
    await phase('expiry AFTER nested append raises and rolls the whole statement back', {'atlas_customer.CustomerSession':{removed:1,added:1}}, async () => {
      const input=coll(0,{offersDisabled:true}), sessionHash=auth.authority(expiring.cookie).sessionHash;
      await setup.query('UPDATE atlas_customer."CustomerSession" SET "expiresAt"=clock_timestamp()+interval \'1200 milliseconds\' WHERE "tokenHash"=$1',[sessionHash]);
      const blocker=await socket(); await blocker.query('SELECT pg_advisory_lock(814020,51)'); const blockerPid=(await blocker.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      await setup.query(`CREATE FUNCTION atlas_ownership_preferences.fixture_after_append() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN IF NEW.request_id='${input.requestId}'::uuid THEN PERFORM pg_advisory_xact_lock(814020,51); END IF; RETURN NEW; END $$`);
      await setup.query('REVOKE ALL ON FUNCTION atlas_ownership_preferences.fixture_after_append() FROM PUBLIC');
      await setup.query('CREATE TRIGGER fixture_after_append AFTER INSERT ON atlas_ownership.event FOR EACH ROW EXECUTE FUNCTION atlas_ownership_preferences.fixture_after_append()');
      let pid; observedBackend=v=>pid=v;
      const pending=call('set_collection_preferences',input,expiring).then(v=>({v}),error=>({error}));
      try {
        { const end=Date.now()+1000; while(!pid && Date.now()<end) await sleep(5); assert(pid,'Observed transaction backend required'); } const proof=await witness(pid,blockerPid,sessionHash); proof.kind='POST_APPEND_SESSION_EXPIRY';
        await sleep(Math.max(0,Date.parse(proof.authorization.stored_expiry)-Date.now()+25));
        const expired=(await setup.query('SELECT clock_timestamp() observed_at,"expiresAt" stored_expiry,"expiresAt"<=clock_timestamp() expired FROM atlas_customer."CustomerSession" WHERE "tokenHash"=$1',[sessionHash])).rows[0];
        assert.equal(expired.expired,true); assert.equal(String(expired.stored_expiry),String(proof.authorization.stored_expiry)); proof.beforeUnlock=expired;
        await blocker.query('SELECT pg_advisory_unlock(814020,51)'); const outcome=await pending;
        assert.equal(outcome.error?.code,'28000'); assert.equal(outcome.error?.message,'SIGN_IN_REQUIRED');
        assert.equal((await setup.query('SELECT count(*)::int n FROM atlas_ownership.event WHERE request_id=$1',[input.requestId])).rows[0].n,0);
      } finally { observedBackend=null; await blocker.query('SELECT pg_advisory_unlock_all()'); await pending; await setup.query('DROP TRIGGER fixture_after_append ON atlas_ownership.event'); await setup.query('DROP FUNCTION atlas_ownership_preferences.fixture_after_append()'); }
    }); checks.push('observed post-append wait/UTC expiry; actual SQL RAISE rolls back event');
    await phase('final JS role/capability rejection rolls back appended events', {}, async () => {
      const input=coll(4); afterGateway=async action=>{if(action==='set_collection_preferences'){afterGateway=null;await setup.query(`GRANT MAINTAIN ON atlas_manual.card TO ${servingRole}`);}};
      try { await assert.rejects(call('set_collection_preferences',input),{code:'OWNERSHIP_PREFERENCES_DATABASE_ROLE_INVALID'}); } finally {afterGateway=null;await setup.query(`REVOKE MAINTAIN ON atlas_manual.card FROM ${servingRole}`);}
      const original=options.client; afterGateway=async action=>{if(action==='set_collection_preferences'){afterGateway=null;options.client={};}};
      try {await assert.rejects(call('set_collection_preferences',coll(4)),{code:'OWNERSHIP_PREFERENCES_UNAVAILABLE'});} finally {afterGateway=null;options.client=original;}
    }); checks.push('actual final role/capability guards rollback nested append');
    await phase('current owner and discard rechecked after observed identity waits', {'atlas_ownership.event':{removed:0,added:1},'atlas_manual_intake.discard_request':{removed:0,added:1},'atlas_manual_intake.discarded_card':{removed:0,added:1}},async()=>{
      for(const [c,kind] of [[raceCard,'TRANSFER'],[raceDiscard,'DISCARD']]) {
        const blocker=await socket(); await blocker.query('BEGIN'); await blocker.query('SELECT 1 FROM atlas_manual.public_report_identity WHERE card_id=$1 FOR UPDATE',[c.id]);
        const blockerPid=(await blocker.query('SELECT pg_backend_pid() pid')).rows[0].pid; let pid; observedBackend=v=>pid=v;
        const pending=call('set_card_preferences',perCard(c)).then(v=>({v}),error=>({error}));
        try {
          { const end=Date.now()+1000; while(!pid && Date.now()<end) await sleep(5); assert(pid,'Observed transaction backend required'); } const proof=await witness(pid,blockerPid); proof.kind=kind;
          if(kind==='TRANSFER') await title(c,other.customer.id,2,blocker); else await discard(c,blocker);
          await blocker.query('COMMIT'); const outcome=await pending;
          assert.equal(outcome.error?.code,kind==='TRANSFER'?'OWNERSHIP_REVISION_CHANGED':'OWNERSHIP_NOT_FOUND');
        } finally {observedBackend=null;await blocker.query('ROLLBACK');await pending;}
      }
    }); checks.push('observed title/discard wait denies stale new write');
    const final=await census(), whole=delta(baseline,final), expected={'atlas_ownership.event':{removed:0,added:10},'atlas_customer.CustomerSession':{removed:1,added:1},'atlas_manual_intake.discard_request':{removed:0,added:2},'atlas_manual_intake.discarded_card':{removed:0,added:2}};
    assert.deepEqual(counts(whole),expected);
    const sessionDelta=whole['atlas_customer.CustomerSession']; assert.deepEqual(sessionDelta.added[0],{...sessionDelta.removed[0],expiresAt:sessionDelta.added[0].expiresAt});
    const events=whole['atlas_ownership.event'].added; assert.equal(events.filter(e=>e.kind==='CLAIM_VERIFIED').length,2);
    await assertRows(whole);
    assert.equal((await setup.query('SELECT count(*)::int n FROM atlas_staff._standalone_migrations')).rows[0].n,9);
    result={pass:true,checks,phases,waitProofs,tableCount:tables.length,wholeJourney:{changes:counts(whole),exactDelta:whole,unchangedTables:tables.length-Object.keys(whole).length},ledgerRows:9,
      policyRequired:false,offerDelivery:false,timezoneQualification:'Pacific/Honolulu session; canonical UTC raw gateway and SET LOCAL UTC service',servingRole,schemaOwner:ownerRole};
    service.close();
  } catch(error) {failure=error;result={pass:false,checks,phases,waitProofs,error:{name:error.name,code:error.code,message:safe(error.message),stack:safe(error.stack)}};}
  finally {
    // Disconnect rejection must never skip exact owned-cluster stop/absence.
    const clientCloses=await Promise.allSettled([...clients].map(c=>Promise.resolve().then(()=>c.$disconnect())));
    const socketCloses=await Promise.allSettled([...sockets].map(c=>Promise.resolve().then(()=>c.end())));
    const closeOutcomes={clients:clientCloses.map(v=>v.status==='fulfilled'?{status:v.status}:{status:v.status,error:safe(v.reason?.message??v.reason)}),
      sockets:socketCloses.map(v=>v.status==='fulfilled'?{status:v.status}:{status:v.status,error:safe(v.reason?.message??v.reason)})};
    const closeFailed=[...clientCloses,...socketCloses].some(v=>v.status==='rejected');
    let stoppedVerified=false;
    if(started){const own=JSON.parse(await readFile(resolve(plan.directory,'ownership.json')));assert.equal(own.nonce,plan.nonce);assert.equal(own.ownerPid,process.pid);assert.equal((await stat(plan.directory)).uid,process.getuid());
      const status=spawnSync(resolve(bin,'pg_ctl'),['-D',plan.data,'status'],{env:cleanEnv});if(status.status===0)run(resolve(bin,'pg_ctl'),['-D',plan.data,'-m','fast','-w','stop']);else assert.equal(status.status,3);
      assert.equal(spawnSync(resolve(bin,'pg_ctl'),['-D',plan.data,'status'],{env:cleanEnv}).status,3);await rm(plan.data,{recursive:true});await assert.rejects(stat(plan.data),{code:'ENOENT'});stoppedVerified=true;}
    await writeFile(resolve(output,'validation.log'),log,{flag:'wx',mode:0o600});await save(resolve(output,'cleanup.json'),{stoppedVerified,ownedDataAbsent:stoppedVerified,nonce:plan.nonce,directory:plan.directory,closeOutcomes});
    await copyFile(resolve(plan.directory,'postgres.log'),resolve(output,'postgres.log')).catch(()=>{});
    if(closeFailed){failure??=Error('Owned connection cleanup failed after cluster stop');result={...result,pass:false,cleanupFailure:true};}
    result={...result,closeOutcomes,planSha256:hash(await readFile(planPath)),sourceRefs:plan.sources,ownedDirectory:plan.directory,port:plan.port,nonce:plan.nonce,node:process.version,stoppedVerified,
      syntheticOnly:true,productionQueries:0,externalProviderCalls:0,storageProviderCalls:0,notificationEffects:0,cleanupSha256:hash(await readFile(resolve(output,'cleanup.json')))};
    await save(resolve(output,'postgres-result.json'),result);process.stdout.write(JSON.stringify({pass:result.pass,checks:checks.length,stoppedVerified,output})+'\n');
  }
  if(failure)throw failure;
}
