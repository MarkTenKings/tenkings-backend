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
const stable = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k,v[k]])) : v);
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const [mode, output] = process.argv.slice(2);
assert(['--prepare', '--execute'].includes(mode) && output && resolve(output) === output && process.argv.length === 4);
assert(!Object.keys(process.env).some(k => /^(DATABASE_URL|DIRECT_URL|ATLAS_DATABASE_URL|PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATA|PGSERVICE|PGSERVICEFILE)$/.test(k)));
const bin = '/opt/homebrew/opt/postgresql@17/bin', pgModule = '/Users/markthomas/.codex/atlas-handoffs/atlas-v4-labels-pg-runtime/node_modules/pg';
const planPath = resolve(output, 'launch-plan.json'), sourcePaths = [
  'packages/atlas-connected-manual/test/fixtures/comp-evidence-archive-postgres.mjs',
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
  const plan = { schema: 'atlas-comp-evidence-archive-owned-pg-plan-v1', output, directory: resolve(output, 'cluster'), data: resolve(output, 'cluster/data'),
    host: '127.0.0.1', unixSockets: false, port, nonce: randomBytes(16).toString('hex'), bin, pgModule, sources,
    sourceCommit: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim(),
    groups: ['SQL011 default and exact one-function candidate schema', 'real restricted role archive read/locks', 'evidence-only SELECTED/read/replay reader+editor', 'legacy pricing and null-policy behavior', 'database source/policy/hash negatives', 'role/ACL/replay refusals and protected-data preservation'],
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
    for (const [i, who] of [[1, staffRole], [2, role]]) await control.query(`CREATE ROLE ${who} LOGIN PASSWORD '${passwords[i]}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`);
    await setup.query(staffGrantSQL(staffRole));
    const grantText = await readFile(resolve(root, 'packages/atlas-connected-manual/sql/comp-curation-role-proposal.sql'), 'utf8');
    await setup.query(grantText.replaceAll(':"curation_role"', `"${role}"`));
    await setup.query('SET search_path=pg_catalog');
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
    await setup.query(proposal);
    schemaPin = await inspectCompCurationSchema(raw(setup)); assert.deepEqual(schemaPin, expected);
    await save(resolve(output, 'observed-candidate-schema.json'), schemaPin);
    await assert.rejects(assertCompCurationDatabase(raw(roleSocket), { ...oldConfig, schemaSha256: expected.sha256 }), { code: 'COMP_DATABASE_ROLE_INVALID' });
    const candidateConfig = { role, schemaOwner: ownerRole, schemaSha256: expected.sha256, guardVersion: COMP_EVIDENCE_GUARD_VERSION };
    await assertCompCurationDatabase(raw(roleSocket), candidateConfig);
    checks.push('SQL011 default accepted; candidate requires exact independently derived schema and explicit guard version');
    admin = open(ownerRole); const staffClient = open(staffRole), restricted = open(role);
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
    const selectionPolicy = { version: 'atlas-comp-evidence-selection-policy-v1', status: 'LOCAL_PROPOSAL', method: 'private-saved-sold-evidence-v1', recencyDays: null, rightsStatus: 'UNRESOLVED' };
    const policy = { version: 'atlas-comp-curation-policy-v1', status: 'LOCAL_PROPOSAL', method: 'selected-sold-price-arithmetic-mean-v1', recencyDays: 90, rightsStatus: 'UNRESOLVED' };
    const deps = { boundary, approved, artifacts, validateAccess };
    const service = createCompCurationService({ ...deps, policy: null, selectionPolicy, archiveCapability: createCompCurationArchiveCapability(deps) });
    const legacy = createCompCurationService({ ...deps, policy });
    const disabled = createCompCurationService({ ...deps, policy: null });
    const cardId = f.cardId, readInput = { approvalActionId: f.actionId, previewId };
    const input = (revision, overrides = {}) => ({ requestId: randomUUID(), approvalActionId: f.actionId, expectedSelectionRevision: revision,
      previewId, expectedPreviewHash: marketPreviewHash(preview), outcome: 'SELECTED', selectedIds: preview.candidates.map(c=>c.sale.id),
      reviewedIds: preview.candidates.map(c=>c.sale.id), expectedPolicyHash: compEvidenceSelectionPolicy(selectionPolicy).hash, ...overrides });
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
    const baseline = await census(), initialArtifacts = await files();
    await phase('exact existing grants permit actual archive/manual/intake locks without grading writes', {}, async () => {
      await boundary.transaction(other.staff, async ({ tx }) => {
        assert.equal((await tx.$queryRawUnsafe('SELECT id FROM atlas_manual.card WHERE id=$1::uuid FOR UPDATE', cardId))[0].id, cardId);
        assert.equal((await tx.$queryRawUnsafe('SELECT id FROM atlas_manual_intake.card WHERE id=$1::uuid FOR SHARE', cardId))[0].id, cardId);
      });
      assert.equal((await service.read(other.staff, cardId, readInput)).availability, 'READY');
      await assert.rejects(disabled.read(other.staff, cardId, readInput), { code: 'MANUAL_CARD_NOT_FOUND' });
      await assert.rejects(service.read(observer.staff, cardId, readInput));
      await assert.rejects(approved.loadPacket(other.staff, cardId, f.actionId), { code: 'MANUAL_CARD_ACCESS_DENIED' });
    }); checks.push('actual reader archive loads with unchanged exact restricted role; ordinary publication access stays denied');
    const readerInput = input(0), editorInput = input(1); let first;
    await phase('reader and editor each append one private evidence receipt; exact replay remains unchanged', { 'atlas_manual.comp_curation': { removed: 0, added: 2 } }, async () => {
      first = await service.decide(other.staff, cardId, readerInput);
      assert.equal(first.guidance, null); assert.equal(first.selected.length, 3); assert.deepEqual(first.policy, selectionPolicy);
      assert.equal(first.actorId, other.principal.id); assert.deepEqual(await service.decide(other.staff, cardId, readerInput), first);
      const second = await service.decide(editor.staff, cardId, editorInput); assert.equal(second.revision, 2); assert.equal(second.guidance, null);
      assert.deepEqual(await service.decide(editor.staff, cardId, editorInput), second);
      assert.equal((await service.read(other.staff, cardId, readInput)).selection.revision, 2);
    }); checks.push('real restricted reader/editor SELECTED null-guidance writes, reads and immutable replay');
    await phase('legacy pricing branch and default null-policy behavior remain distinct', { 'atlas_manual.comp_curation': { removed: 0, added: 2 } }, async () => {
      const selected = await legacy.decide(owner.staff, cardId, input(2, { expectedPolicyHash: compCurationPolicy(policy).hash }));
      assert.equal(selected.guidance.meanMinor, 2000); assert.equal(selected.policy.version, policy.version);
      assert.equal((await disabled.read(owner.staff, cardId, readInput)).availability, 'POLICY_REQUIRED');
      await assert.rejects(disabled.decide(owner.staff, cardId, input(3, { expectedPolicyHash: null })), { code: 'COMP_SELECTION_OUTCOME_CONFLICT' });
      await assert.rejects(disabled.decide(owner.staff, cardId, input(3)), { code: 'COMP_POLICY_CHANGED' });
      const skipped = await disabled.decide(owner.staff, cardId, input(3, { outcome: 'SKIP', selectedIds: [], reviewedIds: [], expectedPolicyHash: null }));
      assert.equal(skipped.policy, null); assert.equal(skipped.guidance, null);
    }); checks.push('legacy arithmetic and default null-policy refusal/Skip remain unchanged');
    await phase('new branch independently rejects source, policy, evidence and content-hash corruption', {}, async () => {
      const original = (await setup.query('SELECT * FROM atlas_manual.comp_curation ORDER BY revision LIMIT 1')).rows[0];
      async function refused(mutate, expectedCode = 'P0001') {
        const request = JSON.parse(original.request), binding = JSON.parse(original.binding), source = JSON.parse(original.source), selected = JSON.parse(original.selected_facts), receipt = JSON.parse(original.receipt);
        request.requestId = randomUUID(); request.expectedSelectionRevision = 4; receipt.requestId = request.requestId; receipt.revision = 5;
        mutate({ request, binding, source, selected, receipt });
        receipt.binding = binding; receipt.source = source; receipt.selected = selected; receipt.selectedFactsHash = digest(canonical(selected));
        const texts = [request,binding,source,selected,receipt].map(v=>canonical(v));
        const hashes = texts.map(digest); if (expectedCode === '23514') hashes[4] = '0'.repeat(64);
        await assert.rejects(roleSocket.query(`INSERT INTO atlas_manual.comp_curation(card_id,approval_action_id,revision,request_id,actor_id,request,request_hash,binding,binding_hash,source,source_hash,selected_facts,selected_facts_hash,receipt,receipt_hash)
          VALUES($1,$2,5,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [cardId,f.actionId,request.requestId,original.actor_id,...texts.flatMap((v,i)=>[v,hashes[i]])]), e=>e.code===expectedCode);
      }
      for (const mutate of [v=>{v.receipt.guidance={meanMinor:2000};}, v=>{v.receipt.policy.recencyDays=90;}, v=>{v.receipt.policy.rightsStatus='APPROVED';},
        v=>{v.receipt.policyHash='0'.repeat(64);v.request.expectedPolicyHash=v.receipt.policyHash;}, v=>{v.request.expectedPolicyHash='0'.repeat(64);},
        v=>{v.source.artifactHash='0'.repeat(64);}, v=>{v.binding.publicHash='0'.repeat(64);},
        v=>{v.selected[0].eligible=false;}, v=>{v.selected[0].reasonCodes=['UNKNOWN_DESIGNATION'];}, v=>{v.request.reviewedIds=[];}]) await refused(mutate);
      await refused(()=>{}, '23514');
      await assert.rejects(service.decide(other.staff, cardId, input(4, { expectedPolicyHash:'0'.repeat(64) })), { code:'COMP_POLICY_CHANGED' });
      await assert.rejects(service.decide(other.staff, cardId, input(4, { expectedPreviewHash:'0'.repeat(64) })), { code:'COMP_SOURCE_CHANGED' });
    }); checks.push('11 independent SQL source/policy/evidence/hash negatives and service source/policy mismatch refusals');
    await phase('narrow lock privileges cannot change protected data; missing lock or surplus rights fails validation', {}, async () => {
      for (const sql of ['UPDATE atlas_manual.card SET id=id', 'UPDATE atlas_manual_intake.card SET id=id', 'UPDATE atlas_manual.card SET revision=revision+1',
        'UPDATE atlas_manual.publication SET state=state', 'DELETE FROM atlas_manual.comp_curation', 'TRUNCATE atlas_manual.comp_curation'])
        await assert.rejects(roleSocket.query(sql), e=>['42501','P0001'].includes(e.code));
      for (const table of ['atlas_manual.card','atlas_manual_intake.card']) {
        await setup.query(`REVOKE UPDATE(id) ON ${table} FROM ${role}`);
        try { await assert.rejects(assertCompCurationDatabase(raw(roleSocket), candidateConfig), {code:'COMP_DATABASE_ROLE_INVALID'});
          await assert.rejects(roleSocket.query(`SELECT id FROM ${table} FOR SHARE`), e=>e.code==='42501'); }
        finally { await setup.query(`GRANT UPDATE(id) ON ${table} TO ${role}`); }
      }
      await setup.query(`GRANT UPDATE(revision) ON atlas_manual.card TO ${role}`);
      try { await assert.rejects(assertCompCurationDatabase(raw(roleSocket), candidateConfig), {code:'COMP_DATABASE_ROLE_INVALID'}); }
      finally { await setup.query(`REVOKE UPDATE(revision) ON atlas_manual.card FROM ${role}`); }
      await assertCompCurationDatabase(raw(roleSocket), candidateConfig);
    }); checks.push('actual missing-lock/extra-right negatives, protected writes denied, exact role restored');
    await phase('archive reader revocation refuses read and retained replay', { 'atlas_manual.card': {removed:1,added:1} }, async()=>{
      await setup.query("UPDATE atlas_manual.card SET readers='{}',revision=revision+1 WHERE id=$1",[cardId]);
      await assert.rejects(service.read(other.staff,cardId,readInput),{code:'MANUAL_CARD_NOT_FOUND'});
      await assert.rejects(service.decide(other.staff,cardId,readerInput),{code:'MANUAL_CARD_NOT_FOUND'});
    }); checks.push('actual ACL revocation prevents archive read/replay');
    const final = await census(), wholeDelta = differences(baseline,final);
    assert.deepEqual(counts(wholeDelta), {'atlas_manual.card':{removed:1,added:1},'atlas_manual.comp_curation':{removed:0,added:4}});
    assert.deepEqual(wholeDelta['atlas_manual.card'].added[0], {...wholeDelta['atlas_manual.card'].removed[0],readers:[],revision:wholeDelta['atlas_manual.card'].removed[0].revision+1});
    assert.deepEqual(await files(),initialArtifacts); assert.equal((await setup.query('SELECT count(*)::int n FROM atlas_staff._standalone_migrations')).rows[0].n,11);
    assert.deepEqual(await inspectCompCurationSchema(raw(setup)),expected);
    result={pass:true,checks,phases,baselineSchemaSha256:oldSchema.sha256,candidateSchemaSha256:expected.sha256,candidateGuardSourceSha256:digest(body),
      tableCount:tables.length,wholeJourney:{changes:counts(wholeDelta),unchangedTables:tables.length-2},artifactsPreserved:initialArtifacts,ledgerRows:11,
      guardVersion:COMP_EVIDENCE_GUARD_VERSION,roleProposalUnchanged:true,productionRegistration:false,defaultsOff:true,
      directTableRoleTrust:'native service owns session/ACL/artifact authority; no per-user database RLS',activePricingPolicy:null};
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
