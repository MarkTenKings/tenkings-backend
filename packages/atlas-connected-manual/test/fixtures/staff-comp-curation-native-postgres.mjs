// Finite, fresh owned PostgreSQL17 only. This is never a serving import.
// Synthetic policy:null, retained local artifacts and in-process signed HTTP;
// no proxy/route activation, external provider, real session or browser claim.
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { chmod, copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeEnvelope } from '../../../atlas-site-router/routes.mjs';
import { createOwnedManualFixture } from '../../../atlas-manual-service/scripts/owned-fixture.mjs';
import { canonical, digest } from '../../../atlas-manual-service/src/contract.mjs';
import { createIntakeRepository, intakeGrantSQL } from '../../../atlas-manual-intake/src/repository.mjs';
import { publicationFixture } from '../publication-fixture.mjs';
import { createPublicationRepository } from '../../src/publication-repository.mjs';
import { createManualFinishing } from '../../src/finishing.mjs';
import { createPresentationMarket, marketPreviewHash, publishedMarketQuery } from '../../src/presentation-market.mjs';
import { compCurationGrantSQL } from '../../src/comp-curation-service.mjs';
import { createStaffCompCurationNativeComposition } from '../../../../frontend/atlas-app/lib/server/staff-comp-curation-native-composition.mjs';
import { assertProductionStaffRequest } from '../../../../frontend/atlas-app/lib/server/access/config.mjs';
import { createStaffCompCurationClient } from '../../../../frontend/atlas-app/lib/staff-comp-curation-client.mjs';
import { createStaffCompCurationController } from '../../../../frontend/atlas-app/lib/staff-comp-curation-controller.mjs';

const output = process.env.ATLAS_STAFF_COMP_NATIVE_QUALIFICATION, args = process.argv.slice(2);
assert(output && resolve(output) === output, 'Fresh absolute evidence directory required');
assert(args.includes('--postgres-bin') && args.includes('--ack-disposable-local-postgres'));
assert(!args.some(arg => ['--serve', '--docker-image', '--ack-disposable-remote-pg17'].includes(arg)), 'Finite native local fixture only');
await mkdir(output, { mode: 0o700 });
const root = fileURLToPath(new URL('../../../../', import.meta.url)), sourceRefs = [];
await mkdir(resolve(output, 'source-used'), { mode: 0o700 });
for (const path of [
  'frontend/atlas-app/lib/server/staff-comp-curation-native-composition.mjs',
  'frontend/atlas-app/test/staff-comp-curation-native-composition.test.mjs',
  'frontend/atlas-app/lib/server/staff-comp-curation-http.mjs', 'frontend/atlas-app/lib/server/policy.mjs',
  'frontend/atlas-app/lib/staff-comp-curation-client.mjs', 'frontend/atlas-app/lib/staff-comp-curation-controller.mjs',
  'frontend/atlas-app/lib/server/access/config.mjs', 'frontend/atlas-app/lib/server/access/auth.mjs',
  'frontend/atlas-app/lib/server/access/database.mjs', 'frontend/atlas-app/lib/server/access/fixture.mjs',
  'frontend/atlas-app/scripts/disposable-postgres.mjs',
  'packages/atlas-manual-service/scripts/owned-fixture.mjs', 'packages/atlas-manual-service/scripts/file-artifacts.mjs',
  'packages/atlas-manual-service/src/staff-auth.mjs', 'packages/atlas-manual-service/src/artifacts.mjs',
  'packages/atlas-manual-intake/src/repository.mjs', 'packages/atlas-connected-manual/src/finishing.mjs',
  'packages/atlas-site-router/routes.mjs',
  'packages/atlas-connected-manual/src/publication-repository.mjs', 'packages/atlas-connected-manual/src/presentation-market.mjs',
  'packages/atlas-connected-manual/src/comp-curation-contract.mjs', 'packages/atlas-connected-manual/src/comp-curation-service.mjs',
  'packages/atlas-connected-manual/sql/comp-curation-proposal.sql', 'packages/atlas-connected-manual/test/publication-fixture.mjs',
  'packages/atlas-connected-manual/test/fixtures/staff-comp-curation-native-postgres.mjs',
]) {
  const bytes = await readFile(resolve(root, path)), saved = resolve(output, 'source-used', path.replaceAll('/', '__'));
  await writeFile(saved, bytes, { flag: 'wx', mode: 0o600 }); sourceRefs.push({ path, sha256: digest(bytes), bytes: bytes.length, saved });
}
await writeFile(resolve(output, 'source-refs.json'), JSON.stringify(sourceRefs, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const checks = [], readPhases = [], mutationPhases = [], exchanges = [];
let fixture, result, failure;
try {
  fixture = await createOwnedManualFixture(args);
  const ownership = JSON.parse(await readFile(resolve(fixture.cluster.directory, 'ownership.json'), 'utf8'));
  assert.equal(ownership.createdByHarness, true); assert.equal(ownership.ownerPid, process.pid);
  const ownUrl = new URL(fixture.database.adminUrl);
  assert.equal(ownUrl.hostname, '127.0.0.1'); assert(Number(ownUrl.port) > 0);
  const sql = await readFile(resolve(root, 'packages/atlas-connected-manual/sql/comp-curation-proposal.sql'), 'utf8');
  await fixture.cluster.sql(sql, [], fixture.database.name);
  await fixture.cluster.sql(intakeGrantSQL('atlas_fixture_manual') + '\n' + compCurationGrantSQL('atlas_fixture_manual')
    + '\nGRANT SELECT ON atlas_manual.publication,atlas_manual.public_report_identity,atlas_manual.presentation_market TO atlas_fixture_manual;', [], fixture.database.name);
  const connection = fixture.connect(), admin = fixture.admin;
  const intake = createIntakeRepository({ boundary: connection.boundary, keyPrefix: 'native-curation-synthetic', maxOriginalBytes: 65536 });
  const validateAccess = ({ tx, cardId }) => intake.assertActiveInTransaction(tx, cardId);
  async function login(phone) {
    const boot = await connection.auth.bootstrap(''), initial = `${fixture.config.cookies.browser}=${boot.browserToken}`;
    const challenge = await connection.auth.send(initial, boot.csrf, { phone, requestId: randomUUID() }, 'native-curation-fixture');
    const signed = await connection.auth.verify(initial, boot.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'native-curation-fixture');
    const cookie = `${initial}; ${fixture.config.cookies.session}=${signed.token}`;
    const staff = await connection.auth.authenticate(cookie, signed.csrf);
    const principal = await connection.boundary.transaction(staff, ({ principal }) => principal);
    return { staff, principal, cookie, csrf: signed.csrf, sessionHash: connection.auth.actors.get(staff).sessionHash };
  }
  const owner = await login('+12025550141'), other = await login('+12025550143');
  const f = await publicationFixture(); await f.publication.publish({}, f.cardId, f.actionId);
  const row = f.row, actionResult = JSON.parse(row.result); actionResult.receipt.actorId = owner.principal.id;
  const originalManifest = JSON.parse(row.manifest), packet = await f.artifacts.read(originalManifest.packet.ref,
    { cardId: f.cardId, kind: 'PUBLIC_REPORT', sourceHash: originalManifest.packet.sourceHash });
  const packetRef = await fixture.artifacts.write(packet, { cardId: f.cardId, kind: 'PUBLIC_REPORT', sourceHash: row.public_hash });
  const manifest = canonical({ ...originalManifest, packet: { ref: packetRef, sourceHash: row.public_hash } });
  await admin.$executeRawUnsafe('INSERT INTO atlas_manual.card(id,revision,content,content_hash,owner_id,approvers) VALUES($1::uuid,11,$2,$3,$4::uuid,$5::uuid[])',
    f.cardId, canonical(f.draft), row.source_hash, owner.principal.id, [other.principal.id]);
  await admin.$executeRawUnsafe('INSERT INTO atlas_manual_intake.card(id,pair_id,owner_id,create_request_id,create_request_hash,label) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6)',
    f.cardId, randomUUID(), owner.principal.id, randomUUID(), digest('synthetic-native-curation'), 'SYNTHETIC NATIVE CURATION ONLY');
  async function seedApproval(actionId, version, published) {
    const value = structuredClone(actionResult); value.receipt.actionId = actionId;
    await admin.$executeRawUnsafe('INSERT INTO atlas_manual.action(card_id,action_id,actor_id,expected_revision,result_revision,request_hash,request,result) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8)',
      f.cardId, actionId, owner.principal.id, version === 1 ? 10 : 11, version === 1 ? 11 : 12, digest('{}'), '{}', canonical(value));
    await admin.$executeRawUnsafe('INSERT INTO atlas_manual.approval(card_id,action_id,actor_id,source_revision,source_hash,report_hash,report,approved_at) VALUES($1::uuid,$2::uuid,$3::uuid,10,$4,$5,$6,$7::timestamptz)',
      f.cardId, actionId, owner.principal.id, row.source_hash, row.report_hash, row.report, row.approved_at);
    if (version === 1) await admin.$executeRawUnsafe('INSERT INTO atlas_manual.public_report_identity(card_id,public_token,report_number) VALUES($1::uuid,$2,$3)', f.cardId, row.public_token, row.report_number);
    await admin.$executeRawUnsafe("INSERT INTO atlas_manual.publication(card_id,action_id,version,mode) VALUES($1::uuid,$2::uuid,$3,'LOCAL_FIXTURE')", f.cardId, actionId, version);
    if (published) await admin.$executeRawUnsafe("UPDATE atlas_manual.publication SET state='PUBLISHED',manifest=$1,manifest_hash=$2,public_hash=$3,published_at=clock_timestamp() WHERE card_id=$4::uuid AND action_id=$5::uuid",
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
  const artifactHash = digest(JSON.stringify(preview)), ref = await fixture.artifacts.write(preview, { cardId: f.cardId, kind: 'MARKET_PREVIEW', sourceHash: artifactHash });
  const marketRequest = canonical({ requestId: previewId, approvalActionId: f.actionId, expectedRevision: 0 });
  await admin.$executeRawUnsafe('INSERT INTO atlas_manual.presentation_market(card_id,approval_action_id,request_id,actor_id,request,request_hash) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6)',
    f.cardId, f.actionId, previewId, owner.principal.id, marketRequest, digest(marketRequest));
  const marketResult = canonical({ state: 'READY', ref, artifactHash, sourceHash: marketPreviewHash(preview) });
  await admin.$executeRawUnsafe("UPDATE atlas_manual.presentation_market SET state='READY',result=$1,result_hash=$2 WHERE card_id=$3::uuid AND request_id=$4::uuid", marketResult, digest(marketResult), f.cardId, previewId);
  const approved = createManualFinishing({ repository: createPublicationRepository({ boundary: connection.boundary, validateAccess }), artifacts: fixture.artifacts });
  const ingress = { mode: 'PRODUCTION', origin: 'https://atlasgrading.com', basePath: '/admin', application: 'atlas-staff',
    deploymentId: 'synthetic-curation.vercel.app', routerKey: Buffer.alloc(32, 13) };
  const options = { enabled: true, environment: {}, auth: connection.auth, boundary: connection.boundary, approved, artifacts: fixture.artifacts,
    validateAccess, origin: ingress.origin, assertRequest(req) { assertProductionStaffRequest(req, ingress); } };
  const native = createStaffCompCurationNativeComposition(options);
  let loseNextPost = false;
  function transport(actor) { return async ({ method, path, body }, extra = {}) => {
    const issuedAt = Date.now(), target = `/admin${path}`;
    const proof = createHmac('sha256', ingress.routerKey).update(routeEnvelope({ zone: 'staff', deployment: `https://${ingress.deploymentId}`, method, target, issuedAt })).digest('hex');
    const req = { method, url: path, body: method === 'GET' ? '' : body, headers: { host: 'atlasgrading.com', 'x-forwarded-host': 'atlasgrading.com', 'x-forwarded-proto': 'https',
      cookie: actor.cookie, 'x-atlas-route-issued': String(issuedAt), 'x-atlas-route-target': target, 'x-atlas-route-proof': proof,
      ...(method === 'POST' ? { origin: ingress.origin, 'content-type': 'application/json', 'x-atlas-csrf': actor.csrf } : {}), ...extra } };
    let status, payload; const headers = new Headers({ 'content-type': 'application/json' });
    await native.handler(req, { setHeader(k, v) { headers.set(k, v); }, status(v) { status = v; return this; }, json(v) { payload = v; } });
    exchanges.push({ method, path, status, ...(body ? { requestId: body.requestId } : {}), ...(status !== 200 ? { error: payload.error } : {}) });
    if (method === 'POST' && loseNextPost && status === 200) { loseNextPost = false; throw new Error('Synthetic response lost after committed HTTP200'); }
    return new Response(JSON.stringify(payload), { status, headers });
  }; }
  const request = transport(owner), peerRequest = transport(other), client = createStaffCompCurationClient({ request });
  const readInput = { approvalActionId: f.actionId, previewId }, cardId = f.cardId;
  const controller = () => createStaffCompCurationController({ staff: owner.staff, cardId, input: readInput, request });
  const readPath = `/api/staff/comp-curation/cards/${cardId}?approvalActionId=${f.actionId}&previewId=${previewId}`;
  const decisionPath = `/api/staff/comp-curation/cards/${cardId}/decision`;
  const input = (revision, outcome = 'SKIP', extra = {}) => ({ requestId: randomUUID(), approvalActionId: f.actionId, expectedSelectionRevision: revision,
    previewId, expectedPreviewHash: marketPreviewHash(preview), outcome, selectedIds: [], reviewedIds: [], expectedPolicyHash: null, ...extra });
  const tables = (await admin.$queryRawUnsafe("SELECT n.nspname schema,c.relname name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname LIKE 'atlas\\_%' ESCAPE '\\' ORDER BY n.nspname,c.relname"))
    .map(value => ({ ...value, key: `${value.schema}.${value.name}` }));
  assert(tables.length > 100);
  async function census() {
    const values = {};
    for (const { schema, name, key } of tables) {
      assert(/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name));
      values[key] = (await admin.$queryRawUnsafe(`SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) value FROM "${schema}"."${name}" r`))[0].value;
    }
    return { values, sha256: digest(canonical(values, { maxBytes: 32 * 1024 * 1024 })) };
  }
  async function artifactCensus(directory = fixture.objectDirectory) {
    const records = [];
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) records.push(...await artifactCensus(path));
      else { assert(entry.isFile()); const bytes = await readFile(path); records.push({ path: relative(fixture.objectDirectory, path), byteCount: bytes.length, sha256: digest(bytes) }); }
    }
    return records;
  }
  const initial = await census(), initialArtifacts = await artifactCensus();
  async function preserved(name, work) {
    const before = await census(), artifacts = await artifactCensus();
    const value = await work(); const after = await census();
    assert.deepEqual(after, before, name); assert.deepEqual(await artifactCensus(), artifacts, name);
    readPhases.push({ name, tableCount: tables.length, sha256: before.sha256, artifactSha256: digest(canonical(artifacts)) }); return value;
  }
  function diff(before, after) {
    const changes = {};
    for (const { key } of tables) {
      const a = before.values[key].map(value => canonical(value)), b = after.values[key].map(value => canonical(value));
      if (canonical(a) !== canonical(b)) changes[key] = { removed: a.filter(value => !b.includes(value)).length, added: b.filter(value => !a.includes(value)).length };
    }
    return changes;
  }
  async function mutation(name, expected, work) {
    const before = await census(), artifacts = await artifactCensus(); const value = await work(); const after = await census();
    const changes = diff(before, after); assert.deepEqual(changes, expected, name); assert.deepEqual(await artifactCensus(), artifacts, name);
    mutationPhases.push({ name, tableCount: tables.length, before: before.sha256, after: after.sha256, changes }); return value;
  }
  const append = { 'atlas_manual.comp_curation': { removed: 0, added: 1 } };
  const c = controller();
  await preserved('actual auth/signed HTTP/service reads immutable saved v2; no configured guidance', async () => {
    const state = await c.load(); assert.equal(c.snapshot().phase, 'READY');
    assert.equal(state.availability, 'POLICY_REQUIRED'); assert.equal(state.policy, null); assert.equal(state.preview, null);
    assert.equal(state.source.previewId, previewId); assert.equal(state.revision, 0);
  });
  const firstRequestId = randomUUID();
  await mutation('Skip commits exactly one private receipt despite lost HTTP response', append, async () => {
    loseNextPost = true; assert.equal(await c.decide({ requestId: firstRequestId, outcome: 'SKIP' }), null);
    assert.equal(c.snapshot().phase, 'UNRESOLVED'); assert.equal(c.snapshot().pending.requestId, firstRequestId);
  });
  await preserved('exact current receipt reconciles loss; no automatic save retry', async () => {
    const postCount = exchanges.filter(value => value.method === 'POST').length;
    await c.reconcile(); assert.equal(c.snapshot().phase, 'CONFIRMED'); assert.equal(c.snapshot().receipt.requestId, firstRequestId);
    assert.equal(c.snapshot().receipt.guidance, null); assert.equal(c.snapshot().receipt.policy, null);
    assert.equal(exchanges.filter(value => value.method === 'POST').length, postCount);
  });
  await preserved('refresh current saved source before next human decision', () => c.load());
  const secondRequestId = randomUUID();
  await mutation('No suitable comps is a private null-guidance choice', append, async () => {
    const saved = await c.decide({ requestId: secondRequestId, outcome: 'NO_SUITABLE_COMPS' });
    assert.equal(saved.revision, 2); assert.equal(saved.guidance, null); assert.equal(saved.reportSnapshotUnaffected, true);
  });
  await preserved('load for a second uncertain request', () => c.load());
  const thirdRequestId = randomUUID();
  await mutation('third private receipt commits before a second lost response', append, async () => {
    loseNextPost = true; await c.decide({ requestId: thirdRequestId, outcome: 'SKIP' }); assert.equal(c.snapshot().phase, 'UNRESOLVED');
  });
  const fourth = input(3, 'SKIP');
  await mutation('another explicit request with equal-looking choice advances current state', append,
    () => client.decide({ staff: owner.staff, cardId, input: fourth }));
  await preserved('latest equal-looking decision cannot resolve earlier request; exact same-ID retry can', async () => {
    await c.reconcile(); assert.equal(c.snapshot().phase, 'UNRESOLVED'); assert.equal(c.snapshot().pending.requestId, thirdRequestId);
    await assert.rejects(c.load(), { code: 'COMP_RECONCILE_REQUIRED' });
    const saved = await c.retry(); assert.equal(saved.requestId, thirdRequestId); assert.equal(saved.revision, 3);
    assert.equal(c.snapshot().phase, 'CONFIRMED');
    const current = await client.read({ staff: owner.staff, cardId, input: readInput }); assert.equal(current.selection.requestId, fourth.requestId); assert.equal(current.revision, 4);
  });
  const noPool = input(4, 'SKIP', { previewId: null, expectedPreviewHash: null });
  await mutation('Skip without a saved pool remains explicit and never acquires evidence', append, async () => {
    const saved = await client.decide({ staff: owner.staff, cardId, input: noPool }); assert.equal(saved.sourceStatus, 'NO_SAVED_POOL');
    assert.equal(saved.source, null); assert.equal(saved.guidance, null); assert.equal(saved.policy, null);
  });
  await preserved('exact retry and forged SELECTED/ingress/CSRF requests do not mutate', async () => {
    assert.equal((await client.decide({ staff: owner.staff, cardId, input: noPool })).revision, 5);
    const selected = input(5, 'SELECTED', { selectedIds: [items[0].id], reviewedIds: [items[0].id], expectedPolicyHash: 'a'.repeat(64) });
    assert.equal((await request({ method: 'POST', path: decisionPath, body: selected })).status, 409);
    assert.equal((await request({ method: 'GET', path: readPath }, { 'x-atlas-route-proof': undefined })).status, 403);
    assert.equal((await request({ method: 'POST', path: decisionPath, body: input(5) }, { 'x-atlas-csrf': 'wrong' })).status, 403);
    assert.equal((await peerRequest({ method: 'POST', path: decisionPath, body: fourth })).status, 409);
  });
  const peerInput = input(5, 'NO_SUITABLE_COMPS');
  await mutation('separately authorized approver may append own private receipt', append, async () => {
    assert.equal((await peerRequest({ method: 'POST', path: decisionPath, body: peerInput })).status, 200);
  });
  await mutation('explicit synthetic ACL revocation only changes exact card row', { 'atlas_manual.card': { removed: 1, added: 1 } },
    () => admin.$executeRawUnsafe("UPDATE atlas_manual.card SET approvers='{}'::uuid[],revision=revision+1 WHERE id=$1::uuid", cardId));
  await preserved('current ACL revocation refuses read and replay without receipt disclosure', async () => {
    assert.equal((await peerRequest({ method: 'GET', path: readPath })).status, 404);
    assert.equal((await peerRequest({ method: 'POST', path: decisionPath, body: peerInput })).status, 404);
  });
  await mutation('explicit synthetic session revocation changes only exact session', { 'atlas_staff.StaffSession': { removed: 1, added: 1 } },
    () => admin.$executeRawUnsafe('UPDATE atlas_staff."StaffSession" SET "revokedAt"=clock_timestamp() WHERE "tokenHash"=$1', other.sessionHash));
  await preserved('revoked real local staff session clears controller private context', async () => {
    const peer = createStaffCompCurationController({ staff: other.staff, cardId, input: readInput, request: peerRequest });
    await peer.load(); assert.equal(peer.snapshot().phase, 'ENDED'); assert.equal(peer.snapshot().state, null);
    assert.equal((await peerRequest({ method: 'POST', path: decisionPath, body: peerInput })).status, 401);
  });
  await mutation('explicit newer pending publication seed is three append-only rows', Object.fromEntries(['action', 'approval', 'publication'].map(name => [`atlas_manual.${name}`, { removed: 0, added: 1 }])),
    () => seedApproval(randomUUID(), 2, false));
  await preserved('newer pending publication refuses old read, new decision and exact replay', async () => {
    assert.equal((await request({ method: 'GET', path: readPath })).status, 409);
    assert.equal((await request({ method: 'POST', path: decisionPath, body: input(6) })).status, 409);
    assert.equal((await request({ method: 'POST', path: decisionPath, body: fourth })).status, 409);
  });
  await preserved('native composition close ends access while caller connection remains usable', async () => {
    native.close(); c.dispose(); assert.equal((await request({ method: 'GET', path: readPath })).status, 503);
    assert.equal((await connection.manualClient.$queryRawUnsafe('SELECT 1 n'))[0].n, 1);
  });
  const final = await census(), wholeChanges = diff(initial, final);
  assert.deepEqual(wholeChanges, { 'atlas_manual.action': { removed: 0, added: 1 }, 'atlas_manual.approval': { removed: 0, added: 1 },
    'atlas_manual.card': { removed: 1, added: 1 }, 'atlas_manual.comp_curation': { removed: 0, added: 6 },
    'atlas_manual.publication': { removed: 0, added: 1 }, 'atlas_staff.StaffSession': { removed: 1, added: 1 } });
  assert.deepEqual(await artifactCensus(), initialArtifacts);
  checks.push('actual durable local staff auth + signed ingress + native factory + service + PG + finishing + retained artifact + HTTP + browser parser/controller',
    'policy:null blocks selected guidance; Skip/No suitable do not touch immutable reports, saved market, presentation or human price',
    'lost reply/current exact receipt versus later equal-looking receipt and intentional same-ID retry',
    'current actor, ACL, session, CSRF, ingress and latest pending publication fences; no route/proxy activation');
  result = { pass: true, checks, readPhases, mutationPhases, wholeJourney: { tableCount: tables.length, before: initial.sha256, after: final.sha256,
    changes: wholeChanges, unchangedTables: tables.length - Object.keys(wholeChanges).length, artifactRecords: initialArtifacts, artifactsPreserved: true }, exchanges,
    sourceRefs, node: process.version, ownedCluster: fixture.cluster.directory, ownership: { ...ownership, port: Number(ownUrl.port), listen: '127.0.0.1', unixSockets: false },
    syntheticOnly: true, policy: null, inProcessSignedHTTP: true, actualBrowser: false, productionProxyQualified: false, concurrencyExpiryQualified: false,
    productionQueries: 0, providerCalls: 0, notificationEffects: 0, financialEffects: 0 };
} catch (error) {
  failure = error; result = { pass: false, checks, readPhases, mutationPhases, exchanges, sourceRefs, syntheticOnly: true,
    error: { name: error.name, code: error.code, message: error.message, stack: error.stack }, productionQueries: 0, providerCalls: 0 };
} finally {
  if (fixture) {
    await fixture.stop();
    const cleanupPath = resolve(fixture.cluster.directory, 'cleanup.json'), cleanup = JSON.parse(await readFile(cleanupPath, 'utf8'));
    assert.equal(cleanup.stoppedVerified, true);
    await assert.rejects(stat(resolve(fixture.cluster.directory, 'data')), { code: 'ENOENT' });
    for (const name of ['cleanup.json', 'validation.log', 'postgres.log', 'ownership.json', 'standalone-baseline.json']) {
      const saved = resolve(output, name); await copyFile(resolve(fixture.cluster.directory, name), saved); await chmod(saved, 0o600);
    }
    result = { ...result, stoppedVerified: true, ownedDataAbsent: true, cleanupPath, cleanupSha256: digest(await readFile(cleanupPath)) };
  } else result = { ...result, stoppedVerified: false, note: 'Creation failed before fixture returned; inspect retained harness evidence.' };
  await writeFile(resolve(output, 'postgres-result.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  process.stdout.write(JSON.stringify({ pass: result.pass, reads: readPhases.length, mutations: mutationPhases.length, stoppedVerified: result.stoppedVerified, output }) + '\n');
}
if (failure) throw failure;
