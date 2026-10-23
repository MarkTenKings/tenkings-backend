// Dedicated finite LOCAL fixture. --prepare chooses exact path/port/nonce, but
// does not launch PostgreSQL. Log that plan before the separate --execute call.
// No environment/database discovery, remote modes, existing cluster or serving
// import. Every mutation is confined to this nonce-owned synthetic database.
import assert from 'node:assert/strict';
import { assertRegisteredCompFoundation, applyCompFoundation } from '../../../atlas-standalone-database/test/comp-foundation-fixture.mjs';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, stat, rm, readdir, copyFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '../../../../frontend/atlas-app/.generated/staff-database/index.js';
import { applyStandaloneBaseline, applyStandaloneMigrations } from '../../../atlas-standalone-database/migrate.mjs';
import { initializeStandaloneCoordination } from '../../../atlas-standalone-database/initialize.mjs';
import { localAccessConfig, seedLocalStaff, fixtureVerifyProvider } from '../../../../frontend/atlas-app/lib/server/access/fixture.mjs';
import { DurableStaffAuth } from '../../../../frontend/atlas-app/lib/server/access/auth.mjs';
import { StaffDatabase } from '../../../../frontend/atlas-app/lib/server/access/database.mjs';
import { staffGrantSQL } from '../../../../frontend/atlas-app/lib/server/access/privileges.mjs';
import { createDurableStaffBoundary } from '../../../atlas-manual-service/src/staff-auth.mjs';
import { canonical, digest } from '../../../atlas-manual-service/src/contract.mjs';
import { createManualArtifactStore } from '../../../atlas-manual-service/src/artifacts.mjs';
import { createFileArtifactTransport } from '../../../atlas-manual-service/scripts/file-artifacts.mjs';
import { createIntakeRepository } from '../../../atlas-manual-intake/src/repository.mjs';
import { publicationFixture } from '../publication-fixture.mjs';
import { createPublicationRepository } from '../../src/publication-repository.mjs';
import { createManualFinishing } from '../../src/finishing.mjs';
import { createPresentationMarket, marketPreviewHash, publishedMarketQuery } from '../../src/presentation-market.mjs';
import { createCompCurationService } from '../../src/comp-curation-service.mjs';
import { createCompCurationDatabase, inspectCompCurationSchema, assertCompCurationDatabase, COMP_EVIDENCE_GUARD_VERSION } from '../../src/comp-curation-database.mjs';
import { createStaffCompCurationNativeComposition } from '../../../../frontend/atlas-app/lib/server/staff-comp-curation-native-composition.mjs';
import { assertProductionStaffRequest } from '../../../../frontend/atlas-app/lib/server/access/config.mjs';
import { routeEnvelope } from '../../../atlas-site-router/routes.mjs';

import { createCompCurationArchiveCapability } from '../../src/comp-curation-archive.mjs';
import { publishedResearchQuery } from '../../src/research-market-query.mjs';
import { compCurationPolicy, compEvidenceSelectionPolicy } from '../../src/comp-curation-contract.mjs';
import { createMachineStaffBoundary, machineGrantSQL } from '../../../atlas-manual-service/src/machine-auth.mjs';
import { manualGrantSQL } from '../../../atlas-manual-service/src/staff-auth.mjs';
import { intakeGrantSQL } from '../../../atlas-manual-intake/src/repository.mjs';
import { publicationGrantSQL } from '../../src/publication-repository.mjs';
import { presentationGrantSQL } from '../../src/presentation-repository.mjs';
import { createMarketJobStore, marketJobGrantSQL } from '../../src/market-job-store.mjs';
import { createMarketArchiveSearchCapability } from '../../src/market-archive-search.mjs';
import { inspectArchiveMarketSearchSchema, assertArchiveMarketSearchDatabase } from '../../src/market-archive-database.mjs';
import { validateMarketRuntimeConfiguration } from '../../../../frontend/atlas-app/lib/server/connected-manual-runtime.mjs';
const stable = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k,v[k]])) : v);
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const [mode, output] = process.argv.slice(2);
assert(['--prepare', '--execute'].includes(mode) && output && resolve(output) === output && process.argv.length === 4);
assert(!Object.keys(process.env).some(k => /^(DATABASE_URL|DIRECT_URL|ATLAS_DATABASE_URL|PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATA|PGSERVICE|PGSERVICEFILE)$/.test(k)));
const bin = '/opt/homebrew/opt/postgresql@17/bin', pgModule = '/Users/markthomas/.codex/atlas-handoffs/atlas-v4-labels-pg-runtime/node_modules/pg';
const planPath = resolve(output, 'launch-plan.json'), sourcePaths = [
  'packages/atlas-connected-manual/test/fixtures/optional-comp-candidates-postgres.mjs',
  'packages/atlas-connected-manual/sql/comp-evidence-selection-migration-candidate.sql',
  'packages/atlas-connected-manual/sql/archive-market-search-authority-proposal.sql',
  'packages/atlas-connected-manual/src/market-archive-database.mjs',
  'packages/atlas-connected-manual/src/market-archive-search.mjs',
  'packages/atlas-connected-manual/src/market-job-store.mjs',
  'frontend/atlas-app/lib/server/connected-manual-runtime.mjs',
  'frontend/atlas-app/lib/server/market-runtime-settings.mjs',
  'packages/atlas-manual-service/src/machine-auth.mjs',
  'packages/atlas-connected-manual/src/presentation-repository.mjs',
  'packages/atlas-connected-manual/src/comp-curation-archive.mjs',
  'packages/atlas-connected-manual/sql/comp-evidence-selection-guard-proposal.sql',
  'packages/atlas-standalone-database/test/comp-foundation-fixture.mjs',
  'packages/atlas-standalone-database/registered-migrations.mjs',
  'packages/atlas-connected-manual/src/comp-curation-database.mjs',
  'packages/atlas-connected-manual/sql/comp-curation-role-proposal.sql',
  'packages/atlas-connected-manual/test/comp-curation-database.test.mjs',
  'packages/atlas-connected-manual/test/fixtures/comp-curation-restricted-role-postgres.mjs',
  'packages/atlas-connected-manual/sql/comp-curation-proposal.sql',
  'packages/atlas-connected-manual/src/comp-curation-service.mjs',
  'packages/atlas-connected-manual/src/comp-curation-contract.mjs',
  'packages/atlas-connected-manual/src/publication-repository.mjs',
  'packages/atlas-connected-manual/src/finishing.mjs',
  'packages/atlas-manual-service/src/staff-auth.mjs',
  'packages/atlas-manual-intake/src/repository.mjs',
  'frontend/atlas-app/lib/server/staff-comp-curation-native-composition.mjs',
  'frontend/atlas-app/lib/server/staff-comp-curation-http.mjs',
  'frontend/atlas-app/lib/server/access/auth.mjs',
  'packages/atlas-standalone-database/sql/baseline.sql',
  'packages/atlas-standalone-database/baseline.manifest.json',
  'packages/atlas-standalone-database/migrations.manifest.json',
  ...['002-variant-label-retry','003-report-image-retry','004-label-sheets','005-photoroom-removal','006-variant-shared-label-retry','007-label-layout-retry','008-graded-cards-archive','009-card-provenance','010-collection-foundation','011-comp-curation'].map(n => `packages/atlas-standalone-database/sql/${n}.sql`),
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
  const plan = { schema: 'atlas-optional-comp-candidates-owned-pg-plan-v1', output, directory: resolve(output, 'cluster'), data: resolve(output, 'cluster/data'),
    host: '127.0.0.1', unixSockets: false, port, nonce: randomBytes(16).toString('hex'), bin, pgModule, sources,
    sourceCommit: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim(),
    groups: ['guarded evidence migration old/candidate preconditions', 'exact additive archive schema and unchanged rows/ACL', 'actual host startup old-schema refusal/candidate acceptance', 'real restricted archive reservation/replay/claim/read-only packet', 'new authority SQL source/hash/ACL/stale negatives and rights refusal'],
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
  const passwords = Array.from({ length: 4 }, () => randomBytes(24).toString('hex'));
  const ownerRole = 'atlas_fixture_owner', staffRole = 'atlas_fixture_staff', role = 'atlas_fixture_curation', marketRole = 'atlas_fixture_market';
  const dbName = `atlas_curation_${plan.nonce.slice(0, 12)}`;
  const url = (who, database = dbName) => `postgresql://${who}:${passwords[[ownerRole, staffRole, role, marketRole].indexOf(who)]}@127.0.0.1:${plan.port}/${database}?schema=${who === role ? 'atlas_manual' : 'atlas_staff'}&connection_limit=4`;
  const cleanEnv = { HOME: process.env.HOME, PATH: '/usr/bin:/bin:/opt/homebrew/bin', LANG: 'C' };
  let log = '', started = false, result, failure, admin, schemaPin, shortNext = false;
  const checks = [], phases = [], waitProofs = [], exchanges = [];
  const safe = value => passwords.reduce((v, p) => v.replaceAll(p, '[fixture-secret]'), String(value));
  const run = (cmd, args) => { const r = spawnSync(cmd, args, { env: cleanEnv, encoding: 'utf8', timeout: 120000, maxBuffer: 8e6 });
    log += safe((r.stdout ?? '') + (r.stderr ?? '')); assert.equal(r.status, 0, safe(r.error?.message ?? r.stderr)); return r.stdout; };
  const open = who => { const c = new PrismaClient({ datasources: { db: { url: url(who) } } }); clients.add(c); return c; };
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
    const setup = await socket(); await applyCompFoundation(setup); await initializeStandaloneCoordination(setup, { geometryConcurrency: 2 });
    await setup.query('SET search_path=pg_catalog');
    await assertRegisteredCompFoundation((sql, ...values) => setup.query(sql, values));
    // Synthetic owned database only. Production inherited PUBLIC TEMP remains an
    // operator prerequisite; the proposal never changes database-wide grants.
    await setup.query(`REVOKE TEMPORARY ON DATABASE ${dbName} FROM PUBLIC`);
    for (const [i, who] of [[1, staffRole], [2, role], [3, marketRole]]) await control.query(`CREATE ROLE ${who} LOGIN PASSWORD '${passwords[i]}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`);
    await setup.query(staffGrantSQL(staffRole));
    const grantText = await readFile(resolve(root, 'packages/atlas-connected-manual/sql/comp-curation-role-proposal.sql'), 'utf8');
    await setup.query(grantText.replaceAll(':"curation_role"', `"${role}"`));
    for (const grant of [manualGrantSQL,machineGrantSQL,intakeGrantSQL,publicationGrantSQL,presentationGrantSQL,marketJobGrantSQL]) await setup.query(grant(marketRole));
    await setup.query('SET search_path=pg_catalog');
    const marketSocket = await socket(marketRole); await marketSocket.query('SET search_path=pg_catalog');
    const oldMarketSchema = await inspectArchiveMarketSearchSchema(raw(setup));
    await validateMarketRuntimeConfiguration({marketAutomaticEnabled:true,client:raw(marketSocket)});
    await assert.rejects(validateMarketRuntimeConfiguration({marketAutomaticEnabled:true,client:raw(marketSocket),archiveSearchSettings:{expectedSchemaSha256:oldMarketSchema.sha256}}),{code:'MARKET_ARCHIVE_DATABASE_INVALID'});
    checks.push('actual host wrapper preserves legacy startup and refuses archive opt-in on SQL011');
    const oldSchema = await inspectCompCurationSchema(raw(setup));
    assert.equal(oldSchema.sha256, 'a1bbdf297ec7c426358a9f6dee0fd90fb23a109bb92007f0b2ccfa5b3b842ff7');
    const roleSocket = await socket(role);
    await roleSocket.query('SET search_path=pg_catalog');
    const oldConfig = { role, schemaOwner: ownerRole, schemaSha256: oldSchema.sha256 };
    await assertCompCurationDatabase(raw(roleSocket), oldConfig);
    await assert.rejects(assertCompCurationDatabase(raw(roleSocket), { ...oldConfig, guardVersion: COMP_EVIDENCE_GUARD_VERSION }), { code: 'COMP_DATABASE_ROLE_INVALID' });
    const proposal = await readFile(resolve(root, 'packages/atlas-connected-manual/sql/comp-evidence-selection-guard-proposal.sql'), 'utf8');
    const body = proposal.match(/AS \$\$(.*?)\$\$;/s)[1];
    const expected = structuredClone(oldSchema);
    expected.functions.find(f => f.name === 'atlas_manual.comp_curation_guard').source = body;
    expected.sha256 = digest(stable({ tables: expected.tables.map(({owner,...v})=>v), functions: expected.functions.map(({owner,...v})=>v) }));
    await save(resolve(output, 'expected-candidate-schema.json'), expected);
    const guarded = await readFile(resolve(root, 'packages/atlas-connected-manual/sql/comp-evidence-selection-migration-candidate.sql'), 'utf8');
    assert.equal(guarded.match(/AS \$\$(.*?)\$\$;/s)[1],body);
    await setup.query(guarded);
    await assert.rejects(setup.query(guarded), e=>e.code==='P0001'); await setup.query('ROLLBACK');
    checks.push('guarded evidence transaction installs exact qualified body and refuses old-precondition replay');
    schemaPin = await inspectCompCurationSchema(raw(setup)); assert.deepEqual(schemaPin, expected);
    await save(resolve(output, 'observed-candidate-schema.json'), schemaPin);
    await assert.rejects(assertCompCurationDatabase(raw(roleSocket), { ...oldConfig, schemaSha256: expected.sha256 }), { code: 'COMP_DATABASE_ROLE_INVALID' });
    const candidateConfig = { role, schemaOwner: ownerRole, schemaSha256: expected.sha256, guardVersion: COMP_EVIDENCE_GUARD_VERSION };
    await assertCompCurationDatabase(raw(roleSocket), candidateConfig);
    checks.push('SQL011 default accepted; candidate requires exact independently derived schema and explicit guard version');
    admin = open(ownerRole); const staffClient = open(staffRole), restricted = open(role), marketClient = open(marketRole);
    const config = localAccessConfig({ databaseUrl: url(staffRole), sessionKey: randomBytes(32), phoneKey: randomBytes(32), phones: ['+12025550141', '+12025550142', '+12025550143', '+12025550144'] });
    await seedLocalStaff(admin, config, { trained: true });
    // Real auth issues the synthetic short session through its ordinary INSERT.
    // Alter only that INSERT's expiry, never an immutable issued session row.
    let shortExpiry;
    const staffAdapter = { $transaction: (work, options) => staffClient.$transaction(tx => work(new Proxy(tx, { get(target, key) {
      if (key !== 'staffSession' || !shortNext) return target[key];
      return new Proxy(target.staffSession, { get(model, op) { if (op !== 'create') return model[op]; return value => {
        shortNext = false; shortExpiry = new Date(Date.now() + 60000); return model.create({ ...value, data: { ...value.data, expiresAt: shortExpiry } });
      }; } });
    } })), options) };
    const auth = new DurableStaffAuth({ database: new StaffDatabase(staffAdapter, config), config, provider: fixtureVerifyProvider(config) });
    let observedBackend = null;
    const clientAdapter = { $transaction: (work, options) => restricted.$transaction(async tx => {
      if (observedBackend) observedBackend((await tx.$queryRawUnsafe('SELECT pg_backend_pid() pid'))[0].pid);
      return work(tx);
    }, options) };
    const db = createCompCurationDatabase({ client: clientAdapter, ...candidateConfig });
    const boundary = createDurableStaffBoundary({ auth, manualClient: db });
    const objectDirectory = resolve(plan.directory, 'artifacts'); await mkdir(objectDirectory, { mode: 0o700 });
    const artifacts = createManualArtifactStore({ transport: await createFileArtifactTransport(objectDirectory) });
    const intake = createIntakeRepository({ boundary, keyPrefix: 'restricted-synthetic', maxOriginalBytes: 65536 });
    const validateAccess = ({ tx, cardId }) => intake.assertActiveInTransaction(tx, cardId);
    async function login(phone, short = false) {
      const boot = await auth.bootstrap(''), initial = `${config.cookies.browser}=${boot.browserToken}`;
      const challenge = await auth.send(initial, boot.csrf, { phone, requestId: randomUUID() }, 'restricted-fixture');
      shortNext = short;
      const signed = await auth.verify(initial, boot.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'restricted-fixture');
      const cookie = `${initial}; ${config.cookies.session}=${signed.token}`, staff = await auth.authenticate(cookie, signed.csrf);
      const principal = { id: staff.id }; return { staff, principal, cookie, csrf: signed.csrf, sessionHash: auth.actors.get(staff).sessionHash };
    }
    const owner = await login('+12025550141'), other = await login('+12025550143'), editor = await login('+12025550144'), observer = await login('+12025550142');
  const f = await publicationFixture(); await f.publication.publish({}, f.cardId, f.actionId);
  const row = f.row, actionResult = JSON.parse(row.result); actionResult.receipt.actorId = owner.principal.id;
  const originalManifest = JSON.parse(row.manifest), packet = await f.artifacts.read(originalManifest.packet.ref,
    { cardId: f.cardId, kind: 'PUBLIC_REPORT', sourceHash: originalManifest.packet.sourceHash });
  const packetRef = await artifacts.write(packet, { cardId: f.cardId, kind: 'PUBLIC_REPORT', sourceHash: row.public_hash });
  const manifest = canonical({ ...originalManifest, packet: { ref: packetRef, sourceHash: row.public_hash } });
  await admin.$executeRawUnsafe('INSERT INTO atlas_manual.card(id,revision,content,content_hash,owner_id,readers,editors) VALUES($1::uuid,11,$2,$3,$4::uuid,$5::uuid[],$6::uuid[])',
    f.cardId, canonical(f.draft), row.source_hash, owner.principal.id, [other.principal.id], [editor.principal.id]);
  await admin.$executeRawUnsafe('INSERT INTO atlas_manual_intake.card(id,pair_id,owner_id,create_request_id,create_request_hash,label) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6)',
    f.cardId, randomUUID(), owner.principal.id, randomUUID(), digest('synthetic-native-curation'), 'SYNTHETIC NATIVE CURATION ONLY');
  async function seedApproval(actionId, version, published, writer = admin) {
    const value = structuredClone(actionResult); value.receipt.actionId = actionId;
    await writer.$executeRawUnsafe('INSERT INTO atlas_manual.action(card_id,action_id,actor_id,expected_revision,result_revision,request_hash,request,result) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8)',
      f.cardId, actionId, owner.principal.id, version === 1 ? 10 : 11, version === 1 ? 11 : 12, digest('{}'), '{}', canonical(value));
    await writer.$executeRawUnsafe('INSERT INTO atlas_manual.approval(card_id,action_id,actor_id,source_revision,source_hash,report_hash,report,approved_at) VALUES($1::uuid,$2::uuid,$3::uuid,10,$4,$5,$6,$7::timestamptz)',
      f.cardId, actionId, owner.principal.id, row.source_hash, row.report_hash, row.report, row.approved_at);
    if (version === 1) await writer.$executeRawUnsafe('INSERT INTO atlas_manual.public_report_identity(card_id,public_token,report_number) VALUES($1::uuid,$2,$3)', f.cardId, row.public_token, row.report_number);
    await writer.$executeRawUnsafe("INSERT INTO atlas_manual.publication(card_id,action_id,version,mode) VALUES($1::uuid,$2::uuid,$3,'LOCAL_FIXTURE')", f.cardId, actionId, version);
    if (published) await writer.$executeRawUnsafe("UPDATE atlas_manual.publication SET state='PUBLISHED',manifest=$1,manifest_hash=$2,public_hash=$3,published_at=clock_timestamp() WHERE card_id=$4::uuid AND action_id=$5::uuid",
      manifest, digest(manifest), row.public_hash, f.cardId, actionId);
  }
  await seedApproval(f.actionId, 1, true);
  const previewId = randomUUID(), timestamp = new Date(), preview = { version: 'atlas-market-preview-v1', ...publishedResearchQuery({ packet, publicHash: row.public_hash }),
    source: 'EBAY_SOLD', engineVersion: 'ebay-sold-comps-v2.3.0', retrievedAt: timestamp.toISOString(), candidates: [1000,2001,3000].map((priceMinor, i) => ({
      match: 'MATCH', sale: { id: `ebay:${123456789000+i}`, title: '2026 Fixture Local only Synthetic report PSA 9',
        listingUrl: `https://www.ebay.com/itm/${123456789000+i}`, soldAt: new Date(+timestamp-86400000).toISOString(), identityStatus: 'MATCH',
        priceBasis: 'sold', priceMinor, currency: 'USD', raw: false, grader: 'PSA', grade: '9', designation: 'STANDARD' } })) };
  const artifactHash = digest(JSON.stringify(preview)), ref = await artifacts.write(preview, { cardId: f.cardId, kind: 'MARKET_PREVIEW', sourceHash: artifactHash });
  const marketRequest = canonical({ requestId: previewId, approvalActionId: f.actionId, expectedRevision: 0 });
  await admin.$executeRawUnsafe('INSERT INTO atlas_manual.presentation_market(card_id,approval_action_id,request_id,actor_id,request,request_hash) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6)',
    f.cardId, f.actionId, previewId, owner.principal.id, marketRequest, digest(marketRequest));
  const marketResult = canonical({ state: 'READY', ref, artifactHash, sourceHash: marketPreviewHash(preview) });
  await admin.$executeRawUnsafe("UPDATE atlas_manual.presentation_market SET state='READY',result=$1,result_hash=$2 WHERE card_id=$3::uuid AND request_id=$4::uuid", marketResult, digest(marketResult), f.cardId, previewId);

    const approved = createManualFinishing({ repository: createPublicationRepository({ boundary, validateAccess }), artifacts });
    const marketBoundary = createMachineStaffBoundary({boundary:createDurableStaffBoundary({auth,manualClient:marketClient}),auth,manualClient:marketClient});
    const marketIntake = createIntakeRepository({boundary:marketBoundary,keyPrefix:'synthetic-archive-search',maxOriginalBytes:65536});
    const marketAccess = ({tx,cardId})=>marketIntake.assertActiveInTransaction(tx,cardId);
    const archiveSearch=createMarketArchiveSearchCapability({boundary:marketBoundary,artifacts,validateAccess:marketAccess});
    const store=createMarketJobStore({boundary:marketBoundary,validateAccess:marketAccess,archiveSearch});
    const legacyStore=createMarketJobStore({boundary:marketBoundary,validateAccess:marketAccess});
    const cardId=f.cardId;
    // One explicit pre-migration legacy failed reservation proves old history is
    // preserved; no provider was dispatched and the saved request is terminal.
    const legacyRequestId=randomUUID(),legacyRequest=canonical({requestId:legacyRequestId,approvalActionId:f.actionId,expectedRevision:0});
    await setup.query('INSERT INTO atlas_manual.presentation_market(card_id,approval_action_id,request_id,actor_id,request,request_hash) VALUES($1,$2,$3,$4,$5,$6)',[cardId,f.actionId,legacyRequestId,owner.principal.id,legacyRequest,digest(legacyRequest)]);
    await setup.query("INSERT INTO atlas_manual_connected.market_job(request_id,card_id,approval_action_id,actor_id,access_version,mode,origin,source_hash,report_hash) VALUES($1,$2,$3,$4,1,'LOCAL_FIXTURE','REFRESH',$5,$6)",[legacyRequestId,cardId,f.actionId,owner.principal.id,row.source_hash,row.report_hash]);
    await setup.query("UPDATE atlas_manual_connected.market_job SET state='FAILED',code='SYNTHETIC_PREEXISTING_FAILURE' WHERE request_id=$1",[legacyRequestId]);
    const terminal=canonical({state:'UNAVAILABLE',reason:'SYNTHETIC_PREEXISTING_FAILURE'});
    await setup.query("UPDATE atlas_manual.presentation_market SET state='UNAVAILABLE',result=$2,result_hash=$3 WHERE request_id=$1",[legacyRequestId,terminal,digest(terminal)]);
    const tables = (await admin.$queryRawUnsafe("SELECT n.nspname schema,c.relname name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname LIKE 'atlas\\_%' ESCAPE '\\' ORDER BY n.nspname,c.relname"));
    async function census() { const out = {}; for (const t of tables) out[`${t.schema}.${t.name}`] = (await admin.$queryRawUnsafe(`SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) value FROM "${t.schema}"."${t.name}" r`))[0].value; return out; }
    async function files(dir = objectDirectory) { const out = []; for (const e of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = resolve(dir, e.name); if (e.isDirectory()) out.push(...await files(path)); else out.push({ path: relative(objectDirectory, path), sha256: digest(await readFile(path)) }); } return out; }
    function differences(a, b) { const out = {}; for (const key of Object.keys(a)) {
      const before = a[key].map(JSON.stringify), after = b[key].map(JSON.stringify);
      if (JSON.stringify(before) !== JSON.stringify(after)) out[key] = { removed: before.filter(v => !after.includes(v)).map(JSON.parse), added: after.filter(v => !before.includes(v)).map(JSON.parse) };
    } return out; }
    const counts = delta => Object.fromEntries(Object.entries(delta).map(([key, v]) => [key, { removed: v.removed.length, added: v.added.length }]));
    async function phase(name, allowed, fn) { const before = await census(), af = await files(); await fn(); const after = await census();
      assert.deepEqual(counts(differences(before, after)), allowed, name); assert.deepEqual(await files(), af);
      phases.push({ name, tables: tables.length, before: digest(JSON.stringify(before)), after: digest(JSON.stringify(after)), changes: allowed, exactDelta: differences(before, after) }); }
    const beforeInstall=await census(),initialArtifacts=await files();
    const aclQuery=`SELECT n.nspname||'.'||c.relname name,c.relacl::text acl,(SELECT jsonb_agg(jsonb_build_object('column',a.attname,'acl',a.attacl::text) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL) columns FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname LIKE 'atlas_%' ORDER BY name`;
    const beforeACL=(await setup.query(aclQuery)).rows;
    const searchSQL=await readFile(resolve(root,'packages/atlas-connected-manual/sql/archive-market-search-authority-proposal.sql'),'utf8');
    await setup.query('BEGIN');await setup.query(searchSQL);await setup.query('COMMIT');
    const marketSchema=await inspectArchiveMarketSearchSchema(raw(setup));
    const oldTable=oldMarketSchema.tables[0],newTable=marketSchema.tables[0];
    assert.deepEqual(newTable.columns.slice(0,-2),oldTable.columns);
    assert.deepEqual(newTable.columns.slice(-2),['archive_authority','archive_authority_hash'].map(name=>({name,type:'text',notNull:false,identity:'',generated:'',default:null})));
    assert.deepEqual({...newTable,columns:oldTable.columns,constraints:oldTable.constraints,triggers:oldTable.triggers},oldTable);
    assert.deepEqual(newTable.constraints.filter(c=>!['market_job_origin_check','market_job_archive_authority_check'].includes(c.name)),oldTable.constraints.filter(c=>c.name!=='market_job_origin_check'));
    const origin=newTable.constraints.find(c=>c.name==='market_job_origin_check');
    assert.equal(origin.definition.replace(/\s/g,''),"CHECK((origin=ANY(ARRAY['APPROVAL'::text,'REFRESH'::text,'BACKFILL'::text,'ARCHIVE_SEARCH_V1'::text])))");
    const extraConstraint=newTable.constraints.find(c=>c.name==='market_job_archive_authority_check');
    assert(extraConstraint && extraConstraint.validated && !extraConstraint.deferrable && !extraConstraint.deferred && extraConstraint.type==='c');
    assert.deepEqual(newTable.triggers.filter(t=>t.name!=='market_archive_search_guard'),oldTable.triggers);
    assert.deepEqual(newTable.triggers.find(t=>t.name==='market_archive_search_guard'),{name:'market_archive_search_guard',enabled:'O',type:23,definition:'CREATE TRIGGER market_archive_search_guard BEFORE INSERT OR UPDATE ON atlas_manual_connected.market_job FOR EACH ROW EXECUTE FUNCTION atlas_manual_connected.market_archive_search_guard()'});
    assert.deepEqual(marketSchema.functions.filter(f=>f.name!=='atlas_manual_connected.market_archive_search_guard'),oldMarketSchema.functions);
    assert.equal(digest(marketSchema.functions.find(f=>f.name==='atlas_manual_connected.market_archive_search_guard').source),digest(searchSQL.match(/AS \$function\$(.*?)\$function\$;/s)[1]));
    assert.deepEqual((await setup.query(aclQuery)).rows,beforeACL);
    const afterInstall=await census();
    const projected=structuredClone(afterInstall);for(const j of projected['atlas_manual_connected.market_job']){assert.equal(j.archive_authority,null);assert.equal(j.archive_authority_hash,null);delete j.archive_authority;delete j.archive_authority_hash;}
    assert.deepEqual(projected,beforeInstall);assert.deepEqual(await files(),initialArtifacts);
    await assertCompCurationDatabase(raw(roleSocket),candidateConfig);
    await validateMarketRuntimeConfiguration({marketAutomaticEnabled:true,client:raw(marketSocket),archiveSearchSettings:{expectedSchemaSha256:marketSchema.sha256}});
    await save(resolve(output,'market-schema-before.json'),oldMarketSchema);await save(resolve(output,'reviewed-market-schema.json'),marketSchema);
    checks.push('exact additive two-column/constraint/trigger/function installation; old rows/ACL/functions and curation contract preserved; actual host gate passes');
    const baseline=afterInstall,request={requestId:randomUUID(),approvalActionId:f.actionId,expectedRevision:0};let job,claimed;
    await phase('actual reader reservation/replay adds one immutable authority and private request only',{'atlas_manual.presentation_market':{removed:0,added:1},'atlas_manual_connected.market_job':{removed:0,added:1}},async()=>{
      job=await store.reserve(other.staff,cardId,request,{archive:true});assert.equal(job.origin,'ARCHIVE_SEARCH_V1');
      const authority=JSON.parse(job.archive_authority);assert.equal(authority.actorId,other.principal.id);assert.equal(authority.requestHash,digest(canonical(request)));assert.equal(authority.publicHash,row.public_hash);
      const replay=await store.reserve(other.staff,cardId,request,{archive:true});assert.equal(replay.request_id,job.request_id);assert.equal(replay.archive_authority,job.archive_authority);
      await assert.rejects(store.reserve(other.staff,cardId,{...request,expectedRevision:1},{archive:true}),{code:'PRESENTATION_REQUEST_CONFLICT'});
      await assert.rejects(legacyStore.reserve(other.staff,cardId,request),{code:'MANUAL_CARD_ACCESS_DENIED'});
    });checks.push('real archive reader reservation/exact replay and mismatched request/legacy authority refusal');
    await phase('original machine lease with archive authority loads already-published packet without publication effect',{'atlas_manual_connected.market_job':{removed:1,added:1}},async()=>{
      claimed=await store.claim(1);assert.equal(claimed.request_id,request.requestId);assert.equal(claimed.actor_id,other.principal.id);
      const loaded=await archiveSearch.loadJobPacket(claimed);assert.equal(loaded.publicHash,row.public_hash);assert.equal(loaded.row.state,'PUBLISHED');
      assert.equal(claimed.dispatch_id,null);assert.equal(claimed.response,null);
    });checks.push('real claim/current authority and read-only packet loader; no dispatch or provider');
    await phase('new authority shape/source/hash and role column guards refuse independently',{},async()=>{
      async function attempt(change,code='P0001'){
        await marketSocket.query('BEGIN');
        try {
          const id=randomUUID(),input={requestId:id,approvalActionId:f.actionId,expectedRevision:0},text=canonical(input);
          await marketSocket.query('INSERT INTO atlas_manual.presentation_market(card_id,approval_action_id,request_id,actor_id,request,request_hash) VALUES($1,$2,$3,$4,$5,$6)',[cardId,f.actionId,id,other.principal.id,text,digest(text)]);
          const value={...JSON.parse(job.archive_authority),requestId:id,requestHash:digest(text)},rowValues={origin:'ARCHIVE_SEARCH_V1',actorId:other.principal.id,accessVersion:1,mode:'LOCAL_FIXTURE',sourceHash:row.source_hash,reportHash:row.report_hash};
          change(value,rowValues);const authText=canonical(value),hash=rowValues.badHash?'0'.repeat(64):digest(authText);
          await assert.rejects(marketSocket.query('INSERT INTO atlas_manual_connected.market_job(request_id,card_id,approval_action_id,actor_id,access_version,mode,origin,source_hash,report_hash,archive_authority,archive_authority_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[id,cardId,f.actionId,rowValues.actorId,rowValues.accessVersion,rowValues.mode,rowValues.origin,rowValues.sourceHash,rowValues.reportHash,authText,hash]),e=>e.code===code);
        }finally{await marketSocket.query('ROLLBACK');}
      }
      for(const patch of [v=>{v.requestHash='0'.repeat(64);},v=>{v.sourceHash='0'.repeat(64);},v=>{v.manifestHash='0'.repeat(64);},v=>{v.extra=true;},v=>{v.accessVersion=2;},(v,r)=>{r.sourceHash='0'.repeat(64);},(v,r)=>{r.mode='PRODUCTION';}])await attempt(patch);
      await attempt((v,r)=>{r.badHash=true;},'23514');await attempt((v,r)=>{r.origin='REFRESH';},'23514');
      await assert.rejects(marketSocket.query("UPDATE atlas_manual_connected.market_job SET archive_authority=archive_authority WHERE request_id=$1",[request.requestId]),e=>e.code==='42501');
      await setup.query(`GRANT UPDATE(archive_authority) ON atlas_manual_connected.market_job TO ${marketRole}`);
      try{await assert.rejects(validateMarketRuntimeConfiguration({marketAutomaticEnabled:true,client:raw(marketSocket),archiveSearchSettings:{expectedSchemaSha256:marketSchema.sha256}}),{code:'MARKET_ARCHIVE_DATABASE_INVALID'});}
      finally{await setup.query(`REVOKE UPDATE(archive_authority) ON atlas_manual_connected.market_job FROM ${marketRole}`);}
      await validateMarketRuntimeConfiguration({marketAutomaticEnabled:true,client:raw(marketSocket),archiveSearchSettings:{expectedSchemaSha256:marketSchema.sha256}});
    });checks.push('nine new SQL authority/source/hash/legacy-null negatives; immutable authority UPDATE unavailable and extra privilege refused');
    await phase('current archive ACL revocation refuses exact reservation replay and leased packet',{'atlas_manual.card':{removed:1,added:1}},async()=>{
      await setup.query("UPDATE atlas_manual.card SET readers='{}',revision=revision+1 WHERE id=$1",[cardId]);
      await assert.rejects(store.reserve(other.staff,cardId,request,{archive:true}),{code:'MANUAL_CARD_NOT_FOUND'});
      await assert.rejects(archiveSearch.loadJobPacket(claimed),{code:'MARKET_ARCHIVE_ACCESS_ENDED'});
    });checks.push('real archive ACL revocation fences reserved/replayed/leased work');
    const final=await census(),wholeDelta=differences(baseline,final);
    assert.deepEqual(counts(wholeDelta),{'atlas_manual.card':{removed:1,added:1},'atlas_manual.presentation_market':{removed:0,added:1},'atlas_manual_connected.market_job':{removed:0,added:1}});
    assert.deepEqual(wholeDelta['atlas_manual.card'].added[0],{...wholeDelta['atlas_manual.card'].removed[0],readers:[],revision:wholeDelta['atlas_manual.card'].removed[0].revision+1});
    const effectiveACL=rows=>rows.map(row=>({...row,columns:row.columns?.filter(c=>c.acl!=='{}').length ? row.columns.filter(c=>c.acl!=='{}') : null}));
    assert.deepEqual(effectiveACL((await setup.query(aclQuery)).rows),effectiveACL(beforeACL));assert.deepEqual(await files(),initialArtifacts);
    assert.deepEqual(await inspectCompCurationSchema(raw(setup)),expected);assert.deepEqual(await inspectArchiveMarketSearchSchema(raw(setup)),marketSchema);
    result={pass:true,checks,phases,candidateCurationSchemaSha256:expected.sha256,candidateMarketSchemaSha256:marketSchema.sha256,
      tableCount:tables.length,wholeJourney:{changes:counts(wholeDelta),unchangedTables:tables.length-3},artifactsPreserved:initialArtifacts,
      ledgerRows:(await setup.query('SELECT count(*)::int n FROM atlas_staff._standalone_migrations')).rows[0].n,
      roleProposalsUnchanged:true,schemaApplyOldRowsAndACLUnchanged:true,guardedCurationWrapperQualified:true,providerDispatches:0,productionRegistration:false,defaultsOff:true};
    db.close();
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
