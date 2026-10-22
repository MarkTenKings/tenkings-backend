// Dedicated finite LOCAL fixture. --prepare chooses exact path/port/nonce, but
// does not launch PostgreSQL. Log that plan before the separate --execute call.
// No environment/database discovery, remote modes, existing cluster or serving
// import. Every mutation is confined to this nonce-owned synthetic database.
import assert from 'node:assert/strict';
import { assertRegisteredCompFoundation } from '../../../atlas-standalone-database/test/comp-foundation-fixture.mjs';
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
import { createCompCurationDatabase, inspectCompCurationSchema } from '../../src/comp-curation-database.mjs';
import { createStaffCompCurationNativeComposition } from '../../../../frontend/atlas-app/lib/server/staff-comp-curation-native-composition.mjs';
import { assertProductionStaffRequest } from '../../../../frontend/atlas-app/lib/server/access/config.mjs';
import { routeEnvelope } from '../../../atlas-site-router/routes.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const [mode, output] = process.argv.slice(2);
assert(['--prepare', '--execute'].includes(mode) && output && resolve(output) === output && process.argv.length === 4);
assert(!Object.keys(process.env).some(k => /^(DATABASE_URL|DIRECT_URL|ATLAS_DATABASE_URL|PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATA|PGSERVICE|PGSERVICEFILE)$/.test(k)));
const bin = '/opt/homebrew/opt/postgresql@17/bin', pgModule = '/Users/markthomas/.codex/atlas-handoffs/atlas-v4-labels-pg-runtime/node_modules/pg';
const planPath = resolve(output, 'launch-plan.json'), sourcePaths = [
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
  const plan = { schema: 'atlas-comp-restricted-owned-pg-plan-v1', output, directory: resolve(output, 'cluster'), data: resolve(output, 'cluster/data'),
    host: '127.0.0.1', unixSockets: false, port, nonce: randomBytes(16).toString('hex'), bin, pgModule, sources,
    sourceCommit: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim(),
    groups: ['exact privileges/schema and real row locks', 'actual signed HTTP + null-policy receipt/replay', 'forbidden writes',
      'grant/schema/trigger drift refusal', 'late privilege drift refuses return', 'observed session-expiry wait', 'observed ACL revocation wait', 'observed newer-pending source wait'],
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
    const setup = await socket(); await applyStandaloneBaseline(setup); await applyStandaloneMigrations(setup); await initializeStandaloneCoordination(setup, { geometryConcurrency: 2 });
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
    schemaPin = await inspectCompCurationSchema(raw(setup)); await save(resolve(output, 'reviewed-owned-schema.json'), schemaPin);
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
    const db = createCompCurationDatabase({ client: clientAdapter, role, schemaOwner: ownerRole, schemaSha256: schemaPin.sha256 });
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
    const owner = await login('+12025550141'), other = await login('+12025550143');
  const f = await publicationFixture(); await f.publication.publish({}, f.cardId, f.actionId);
  const row = f.row, actionResult = JSON.parse(row.result); actionResult.receipt.actorId = owner.principal.id;
  const originalManifest = JSON.parse(row.manifest), packet = await f.artifacts.read(originalManifest.packet.ref,
    { cardId: f.cardId, kind: 'PUBLIC_REPORT', sourceHash: originalManifest.packet.sourceHash });
  const packetRef = await artifacts.write(packet, { cardId: f.cardId, kind: 'PUBLIC_REPORT', sourceHash: row.public_hash });
  const manifest = canonical({ ...originalManifest, packet: { ref: packetRef, sourceHash: row.public_hash } });
  await admin.$executeRawUnsafe('INSERT INTO atlas_manual.card(id,revision,content,content_hash,owner_id,approvers) VALUES($1::uuid,11,$2,$3,$4::uuid,$5::uuid[])',
    f.cardId, canonical(f.draft), row.source_hash, owner.principal.id, [other.principal.id]);
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
  // Existing v2 projector: designation is unknown, never inferred STANDARD.
  const previewId = randomUUID(), source = { packet, publicHash: row.public_hash }, context = publishedMarketQuery(source);
  const items = [{ id: 'synthetic-saved:1', title: 'SYNTHETIC retained sale', listingUrl: 'https://www.ebay.com/itm/123456789100',
    imageUrl: null, soldDate: '2026-10-19', soldPriceCents: 1000, currency: 'USD', priceBasis: 'EXACT' }];
  const preview = createPresentationMarket().project(source, { responsePolicy: 'ATLAS_SLAB_V1', source: 'EBAY_SOLD', engineVersion: 'ebay-sold-comps-v2.3.0',
    query: context.query, retrievedAt: '2026-10-20T12:00:00.000Z', items, acquisitionDiagnostics: { returnedItemCount: 1 },
    imageMatch: { policy: 'atlas-market-slab-label-v1', counts: {}, readings: [{ rowId: items[0].id, evidenceKind: 'SLABBED', identityMatch: 'MATCH',
      numericGrade: 9, gradingCompany: 'PSA', labelText: null, sha256: null, reason: 'Synthetic offline qualification' }] } }).preview;
  assert.equal(preview.version, 'atlas-market-preview-v2');
  assert(preview.candidates.every(candidate => candidate.sale.designation === null));
  const artifactHash = digest(JSON.stringify(preview)), ref = await artifacts.write(preview, { cardId: f.cardId, kind: 'MARKET_PREVIEW', sourceHash: artifactHash });
  const marketRequest = canonical({ requestId: previewId, approvalActionId: f.actionId, expectedRevision: 0 });
  await admin.$executeRawUnsafe('INSERT INTO atlas_manual.presentation_market(card_id,approval_action_id,request_id,actor_id,request,request_hash) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6)',
    f.cardId, f.actionId, previewId, owner.principal.id, marketRequest, digest(marketRequest));
  const marketResult = canonical({ state: 'READY', ref, artifactHash, sourceHash: marketPreviewHash(preview) });
  await admin.$executeRawUnsafe("UPDATE atlas_manual.presentation_market SET state='READY',result=$1,result_hash=$2 WHERE card_id=$3::uuid AND request_id=$4::uuid", marketResult, digest(marketResult), f.cardId, previewId);

    const approved = createManualFinishing({ repository: createPublicationRepository({ boundary, validateAccess }), artifacts });
    const service = createCompCurationService({ boundary, approved, artifacts, validateAccess, policy: null });
    const ingress = { mode: 'PRODUCTION', origin: 'https://atlasgrading.com', basePath: '/admin', application: 'atlas-staff', deploymentId: 'synthetic-restricted.vercel.app', routerKey: Buffer.alloc(32, 17) };
    const native = createStaffCompCurationNativeComposition({ enabled: true, environment: {}, auth, boundary, approved, artifacts, validateAccess,
      origin: ingress.origin, assertRequest(req) { assertProductionStaffRequest(req, ingress); } });
    const cardId = f.cardId, readInput = { approvalActionId: f.actionId, previewId };
    const input = (revision, overrides = {}) => ({ requestId: randomUUID(), approvalActionId: f.actionId, expectedSelectionRevision: revision,
      previewId, expectedPreviewHash: marketPreviewHash(preview), outcome: 'SKIP', selectedIds: [], reviewedIds: [], expectedPolicyHash: null, ...overrides });
    const http = async (actor, method, inputValue) => {
      const path = `/api/staff/comp-curation/cards/${cardId}${method === 'POST' ? '/decision' : `?approvalActionId=${f.actionId}&previewId=${previewId}`}`;
      const target = '/admin' + path, issuedAt = Date.now(), proof = createHmac('sha256', ingress.routerKey).update(routeEnvelope({ zone: 'staff', deployment: `https://${ingress.deploymentId}`, method, target, issuedAt })).digest('hex');
      let status, payload; await native.handler({ method, url: path, body: method === 'GET' ? '' : inputValue,
        headers: { host: 'atlasgrading.com', 'x-forwarded-host': 'atlasgrading.com', 'x-forwarded-proto': 'https', cookie: actor.cookie,
          'x-atlas-route-issued': String(issuedAt), 'x-atlas-route-target': target, 'x-atlas-route-proof': proof,
          ...(method === 'POST' ? { origin: ingress.origin, 'content-type': 'application/json', 'x-atlas-csrf': actor.csrf } : {}) } },
      { setHeader() {}, status(v) { status = v; return this; }, json(v) { payload = v; } });
      exchanges.push({ method, status, ...(inputValue ? { requestId: inputValue.requestId } : {}) }); return { status, payload };
    };
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
    // All auth/ACL setup belongs to the explicit initial synthetic seed. No
    // issued session is later edited. The expiry test waits until its fixed
    // original deadline is close, after completing the before census.
    const shortId = (await admin.$queryRawUnsafe('SELECT id FROM atlas_staff."StaffIdentity" WHERE "phoneHash"=$1', [...config.phoneByHash.keys()][3]))[0].id;
    await admin.$executeRawUnsafe('UPDATE atlas_manual.card SET approvers=array_append(approvers,$2::uuid),revision=revision+1 WHERE id=$1::uuid', cardId, shortId);
    const expiring = await login('+12025550144', true);
    const baseline = await census(), initialArtifacts = await files();
    await phase('exact schema/privileges permit actual manual + intake SHARE and UPDATE locks', {}, async () => {
      await boundary.transaction(owner.staff, async ({ tx }) => {
        assert.equal((await tx.$queryRawUnsafe('SELECT id FROM atlas_manual.card WHERE id=$1::uuid FOR UPDATE', cardId))[0].id, cardId);
        assert.equal((await tx.$queryRawUnsafe('SELECT id FROM atlas_manual_intake.card WHERE id=$1::uuid FOR SHARE', cardId))[0].id, cardId);
      });
      const state = await service.read(owner.staff, cardId, readInput); assert.equal(state.policy, null); assert.equal(state.availability, 'POLICY_REQUIRED');
    }); checks.push('exact role/schema + actual row locks');
    const first = input(0);
    await phase('signed HTTP Skip inserts only curation; same request is a no-write replay', { 'atlas_manual.comp_curation': { removed: 0, added: 1 } }, async () => {
      const response = await http(owner, 'POST', first); assert.equal(response.status, 200, JSON.stringify(response)); assert.equal(response.payload.result.guidance, null);
      assert.deepEqual(await http(owner, 'POST', first), response);
      const state = await http(owner, 'GET'); assert.equal(state.status, 200); assert.equal(state.payload.result.revision, 1);
    }); checks.push('actual auth/HTTP/service with null policy and exact replay');
    await phase('both id changes/no-op id writes and all grading/report/customer/provider writes are denied', {}, async () => {
      const attempts = [
        ['UPDATE atlas_manual.card SET id=id WHERE id=$1::uuid', [cardId], 'P0001'],
        ['UPDATE atlas_manual.card SET id=$2::uuid WHERE id=$1::uuid', [cardId, randomUUID()], 'P0001'],
        ['UPDATE atlas_manual_intake.card SET id=id WHERE id=$1::uuid', [cardId], 'P0001'],
        ['UPDATE atlas_manual_intake.card SET id=$2::uuid WHERE id=$1::uuid', [cardId, randomUUID()], 'P0001'],
        ['UPDATE atlas_manual.card SET revision=revision+1,content=content WHERE id=$1::uuid', [cardId], '42501'],
        ['UPDATE atlas_manual_intake.card SET revision=revision+1 WHERE id=$1::uuid', [cardId], '42501'],
        ['UPDATE atlas_manual.approval SET report=report WHERE false', [], '42501'],
        ['UPDATE atlas_manual.publication SET state=state WHERE false', [], '42501'],
        ['UPDATE atlas_manual.presentation_market SET state=state WHERE false', [], '42501'],
        ['UPDATE atlas_customer."CustomerAccount" SET id=id WHERE false', [], '42501'],
        ['DELETE FROM atlas_manual.comp_curation WHERE false', [], '42501'],
        ['TRUNCATE atlas_manual.comp_curation', [], '42501'],
      ];
      const c = await socket(role);
      for (const [q, args, code] of attempts) await assert.rejects(c.query(q, args), { code });
      await c.end(); sockets.delete(c);
    }); checks.push('no silent expanded lock grant; immutable IDs/content/revisions unchanged');
    await phase('effective grant, membership, schema, routine, sequence and trigger drift fail closed', {}, async () => {
      const seq = (await setup.query("SELECT n.nspname||'.'||quote_ident(c.relname) name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='S' AND n.nspname='atlas_manual' ORDER BY c.relname LIMIT 1")).rows[0].name;
      await control.query('CREATE ROLE atlas_fixture_extra NOLOGIN');
      const drifts = [
        [`GRANT UPDATE(revision) ON atlas_manual.card TO ${role}`, `REVOKE UPDATE(revision) ON atlas_manual.card FROM ${role}`],
        [`GRANT SELECT ON atlas_customer."CustomerAccount" TO ${role}`, `REVOKE SELECT ON atlas_customer."CustomerAccount" FROM ${role}`],
        [`GRANT atlas_fixture_extra TO ${role}`, `REVOKE atlas_fixture_extra FROM ${role}`],
        [`GRANT CREATE ON SCHEMA atlas_manual TO ${role}`, `REVOKE CREATE ON SCHEMA atlas_manual FROM ${role}`],
        [`GRANT EXECUTE ON FUNCTION atlas_manual.authenticate_machine(uuid,integer,jsonb,text[]) TO ${role}`, `REVOKE EXECUTE ON FUNCTION atlas_manual.authenticate_machine(uuid,integer,jsonb,text[]) FROM ${role}`],
        [`GRANT USAGE ON SEQUENCE ${seq} TO ${role}`, `REVOKE USAGE ON SEQUENCE ${seq} FROM ${role}`],
        ['ALTER TABLE atlas_manual.card DISABLE TRIGGER card_revision', 'ALTER TABLE atlas_manual.card ENABLE TRIGGER card_revision'],
        [`GRANT TEMPORARY ON DATABASE ${dbName} TO ${role}`, `REVOKE TEMPORARY ON DATABASE ${dbName} FROM ${role}`],
      ];
      for (const [apply, restore] of drifts) { await setup.query(apply); try { await assert.rejects(service.read(owner.staff, cardId, readInput), { code: 'COMP_DATABASE_ROLE_INVALID' }); } finally { await setup.query(restore); } }
      await service.read(owner.staff, cardId, readInput);
    }); checks.push('eight real catalog/privilege drifts refused and restored');
    await phase('privilege change during work is refused by final transaction guard', {}, async () => {
      await assert.rejects(db.$transaction(async () => { await setup.query(`GRANT SELECT ON atlas_customer."CustomerAccount" TO ${role}`); return 'private'; }), { code: 'COMP_DATABASE_ROLE_INVALID' });
      await setup.query(`REVOKE SELECT ON atlas_customer."CustomerAccount" FROM ${role}`);
      await assert.rejects(boundary.transaction({ ...owner.staff }, () => assert.fail('copied actor')), { code: 'SIGN_IN_REQUIRED' });
    }); checks.push('final privilege guard + private real-auth handle');
    async function blocked(work, authorized, whileHeld) {
      const lock = await socket(); await lock.query('BEGIN'); const blockerPid = (await lock.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      await lock.query('SELECT id FROM atlas_manual.card WHERE id=$1::uuid FOR UPDATE', [cardId]);
      let entered; const pidPromise = new Promise(r => { entered = r; }); observedBackend = entered;
      const pending = work().then(value => ({ value }), error => ({ error })); const waiterPid = await pidPromise; observedBackend = null;
      try {
        const deadline = Date.now() + 1000; let proof;
        while (Date.now() < deadline) {
          const row = (await setup.query('SELECT wait_event_type,pg_blocking_pids(pid) blockers,clock_timestamp() observed_at FROM pg_stat_activity WHERE pid=$1', [waiterPid])).rows[0];
          if (row?.wait_event_type === 'Lock' && row.blockers.includes(blockerPid)) {
            const authorization = await authorized(waiterPid, blockerPid); assert(authorization === true || authorization?.authorized === true);
            proof = { waiterPid, blockerPid, waitEventType: row.wait_event_type, observedAt: row.observed_at, authorizedBeforeChange: true,
              ...(authorization === true ? {} : { authorization }) }; break; }
          await new Promise(r => setTimeout(r, 10));
        }
        assert(proof, 'Exact waiter/blocker must be observed before change/expiry'); await whileHeld(lock, proof); waitProofs.push(proof);
        await lock.query('COMMIT');
      } finally { await lock.query('ROLLBACK'); await lock.end(); sockets.delete(lock); observedBackend = null; }
      return pending;
    }
    await phase('observed valid session wait crosses actual expiry and refuses insertion', {}, async () => {
      await new Promise(r => setTimeout(r, Math.max(0, +shortExpiry - Date.now() - 1100)));
      assert(Date.now() < +shortExpiry - 500, 'Session must still be valid before dispatch');
      const r = await blocked(() => service.decide(expiring.staff, cardId, input(1)), async (waiterPid, blockerPid) => {
        const observation = (await setup.query(`SELECT a.wait_event_type,pg_blocking_pids(a.pid) blockers,
          clock_timestamp() observed_at,s."expiresAt" AT TIME ZONE 'UTC' expires_at,
          (s."expiresAt" AT TIME ZONE 'UTC')>clock_timestamp() authorized
          FROM pg_stat_activity a JOIN atlas_staff."StaffSession" s ON s."tokenHash"=$2 WHERE a.pid=$1`, [waiterPid, expiring.sessionHash])).rows[0];
        assert.equal(observation.wait_event_type, 'Lock'); assert(observation.blockers.includes(blockerPid));
        assert.equal(observation.expires_at.toISOString(), shortExpiry.toISOString());
        assert(observation.observed_at < observation.expires_at);
        return { authorized: observation.authorized, observedAt: observation.observed_at, storedExpiryUTC: observation.expires_at };
      }, async (_lock, proof) => {
        proof.kind = 'SESSION_EXPIRY'; proof.expiresAt = shortExpiry;
        await new Promise(r => setTimeout(r, Math.max(0, +shortExpiry - Date.now() + 25)));
        const release = (await setup.query(`SELECT clock_timestamp() observed_at,"expiresAt" AT TIME ZONE 'UTC' expires_at,
          ("expiresAt" AT TIME ZONE 'UTC')<=clock_timestamp() expired FROM atlas_staff."StaffSession" WHERE "tokenHash"=$1`, [expiring.sessionHash])).rows[0];
        assert.equal(release.expired, true); assert(release.observed_at > release.expires_at);
        assert.equal(release.expires_at.toISOString(), shortExpiry.toISOString());
        proof.beforeBlockerCommit = { observedAt: release.observed_at, storedExpiryUTC: release.expires_at, expired: release.expired };
      });
      assert.equal(r.error?.code, 'SIGN_IN_REQUIRED', r.error?.message);
    }); checks.push('observed waiter before real session expiry, then refusal');
    await phase('ACL changed while blocked is rechecked on acquired row', { 'atlas_manual.card': { removed: 1, added: 1 } }, async () => {
      const r = await blocked(() => service.decide(other.staff, cardId, input(1)), async () => true,
        async (lock, proof) => { proof.kind = 'ACL_REVOKED'; await lock.query("UPDATE atlas_manual.card SET approvers='{}'::uuid[],revision=revision+1 WHERE id=$1::uuid", [cardId]); });
      assert.equal(r.error?.code, 'MANUAL_CARD_NOT_FOUND', r.error?.message);
    }); checks.push('observed ACL revocation wait');
    await phase('newer pending publication while blocked refuses old approval', Object.fromEntries(['action', 'approval', 'publication'].map(n => [`atlas_manual.${n}`, { removed: 0, added: 1 }])), async () => {
      const r = await blocked(() => service.decide(owner.staff, cardId, input(1)), async () => true,
        async (lock, proof) => { proof.kind = 'NEW_PENDING_PUBLICATION'; await seedApproval(randomUUID(), 2, false, raw(lock)); });
      assert.equal(r.error?.code, 'COMP_APPROVAL_STALE', r.error?.message);
    }); checks.push('observed source change wait; no old approval decision');
    const final = await census();
    const wholeDelta = differences(baseline, final);
    assert.deepEqual(counts(wholeDelta), { 'atlas_manual.action': { removed: 0, added: 1 }, 'atlas_manual.approval': { removed: 0, added: 1 },
      'atlas_manual.card': { removed: 1, added: 1 }, 'atlas_manual.comp_curation': { removed: 0, added: 1 }, 'atlas_manual.publication': { removed: 0, added: 1 } });
    const cardDelta = wholeDelta['atlas_manual.card'];
    assert.deepEqual(cardDelta.added[0], { ...cardDelta.removed[0], approvers: [], revision: cardDelta.removed[0].revision + 1 });
    const receiptRow = wholeDelta['atlas_manual.comp_curation'].added[0];
    assert.equal(receiptRow.actor_id, owner.principal.id); assert.equal(receiptRow.request_id, first.requestId); assert.equal(receiptRow.revision, 1);
    assert.equal(JSON.parse(receiptRow.receipt).guidance, null); assert.equal(JSON.parse(receiptRow.receipt).policy, null);
    assert.equal(wholeDelta['atlas_manual.publication'].added[0].state, 'PENDING');
    assert.equal((await setup.query('SELECT count(*)::int n FROM atlas_staff._standalone_migrations')).rows[0].n, 11);
    assert.deepEqual(await files(), initialArtifacts);
    result = { pass: true, checks, phases, waitProofs, exchanges, schemaSha256: schemaPin.sha256, tableCount: tables.length,
      wholeJourney: { changes: counts(wholeDelta), exactDelta: wholeDelta, unchangedTables: tables.length - Object.keys(wholeDelta).length }, artifactsPreserved: initialArtifacts, ledgerRows: 11,
      rowLockGrant: 'UPDATE(id) only; real changes and no-op writes refused', schemaOwner: ownerRole, servingRole: role,
      directTableRoleTrust: 'native service owns session/ACL/artifact authority; not per-user database RLS', policy: null };
    native.close(); db.close();
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
