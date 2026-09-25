// Owned disposable PostgreSQL only; no native processing, storage or provider calls.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createOwnedManualFixture } from '../../packages/atlas-manual-service/scripts/owned-fixture.mjs';
import { createIntakeRepository, intakeGrantSQL } from '../../packages/atlas-manual-intake/src/repository.mjs';
import { document } from '../../packages/atlas-manual-intake/src/contract.mjs';
import { canonical, digest } from '../../packages/atlas-manual-service/src/contract.mjs';
import { createEarlyGeometryStore, earlyGeometryGrantSQL, recordEarlyGeometryIntent } from '../../packages/atlas-connected-manual/src/early-geometry-store.mjs';

const output = process.env.ATLAS_SCALABLE_EVIDENCE;
assert(output && resolve(output) === output, 'Supply absolute ATLAS_SCALABLE_EVIDENCE');
await mkdir(output, { recursive: true, mode: 0o700 });
const checks = [], fixture = await createOwnedManualFixture(process.argv.slice(2)), connections = [];
const rows = (sql, ...args) => fixture.admin.$queryRawUnsafe(sql, ...args);
const record = name => { checks.push(name); console.log(JSON.stringify({ check: name, status: 'PASS' })); };
try {
  assert.equal((await rows('SELECT count(*)::int n FROM atlas_staff."_prisma_migrations"'))[0].n, 57);
  const signatures = ['atlas_manual_connected.claim_early_geometry(text,uuid,integer)',
    'atlas_manual_connected.pending_early_geometry(text,timestamptz,uuid,integer)'];
  for (const signature of signatures) assert.equal((await rows('SELECT has_function_privilege($1,$2,\'EXECUTE\') AS allowed', 'atlas_fixture_manual', signature))[0].allowed, false);
  await fixture.cluster.sql(intakeGrantSQL('atlas_fixture_manual') + '\n' + earlyGeometryGrantSQL('atlas_fixture_manual'), [], fixture.database.name);
  for (const signature of signatures) {
    assert.equal((await rows('SELECT has_function_privilege($1,$2,\'EXECUTE\') AS allowed', 'atlas_fixture_manual', signature))[0].allowed, true);
    assert.equal((await rows('SELECT has_function_privilege($1,$2,\'EXECUTE\') AS allowed', 'atlas_fixture_public', signature))[0].allowed, false);
  }
  for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) assert.equal((await rows(
    'SELECT has_table_privilege($1,$2,$3) AS allowed', 'atlas_fixture_manual', 'atlas_manual_connected.geometry_claim_capacity', privilege))[0].allowed, false);
  record('57 additive migrations; new functions deny PUBLIC and allow exact EXECUTE grants; capacity state has no runtime table privileges');

  const first = fixture.connect(), second = fixture.connect(); connections.push(first, second);
  const intake = createIntakeRepository({ boundary: first.boundary, keyPrefix: 'geometry-fixture', maxOriginalBytes: 1000, sourceCommitted: recordEarlyGeometryIntent });
  const stores = [first, second].map(connection => createEarlyGeometryStore({ boundary: connection.boundary, intakeRepository: intake, receiptClient: connection.manualClient }));
  const authenticate = async phone => {
    const boot = await first.auth.bootstrap(''), cookie = `${fixture.config.cookies.browser}=${boot.browserToken}`;
    const challenge = await first.auth.send(cookie, boot.csrf, { phone, requestId: randomUUID() }, 'geometry-capacity');
    const verified = await first.auth.verify(cookie, boot.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'geometry-capacity');
    return first.auth.authenticate(`${cookie}; ${fixture.config.cookies.session}=${verified.token}`, verified.csrf);
  };
  const owner = await authenticate('+12025550141'), otherOwner = await authenticate('+12025550143');
  const engine = { fixture: 'geometry-capacity' }, engineHash = digest(canonical(engine));
  async function seed(staff = owner) {
    const { card } = await intake.create(staff, { requestId: randomUUID(), label: 'Owned geometry capacity fixture' });
    const { upload } = await intake.plan(staff, card.cardId, { requestId: randomUUID(), side: 'FRONT', expectedVersion: 0, sha256: 'a'.repeat(64), byteCount: 1 });
    const verification = { object: upload.plan.object, sha256: 'a'.repeat(64), byteCount: 1, contentType: 'application/octet-stream' };
    await intake.recordVerification(staff, card.cardId, upload.uploadId, verification);
    await intake.recordSource(staff, card.cardId, upload.uploadId, { verificationHash: document(verification).hash, source: { fixture: 'immutable source' } });
    const saved = (await intake.read(staff, card.cardId)).card.sides.FRONT.upload;
    const input = { policy: 'atlas-early-photo-geometry-v1', cardId: card.cardId, uploadId: upload.uploadId, side: 'FRONT',
      photoSource: saved.source, plan: saved.plan, verification: saved.verification, frameDescriptorSha256: 'f'.repeat(64),
      settings: { matColor: 'BLACK', cornerShape: 'ROUNDED_3_18_MM' }, engine, engineHash };
    return { card, upload, input, key: digest(canonical(input)) };
  }
  const seeded = []; for (let i = 0; i < 15; i++) seeded.push(await seed());
  const page1 = await stores[0].pending(engineHash, null, 5);
  const page2 = await stores[0].pending(engineHash, { createdAt: page1.at(-1).cursor_created_at, uploadId: page1.at(-1).upload_id }, 32);
  assert.equal(page1.length, 5); assert.equal(page2.length, 10); assert.equal(new Set([...page1, ...page2].map(row => row.upload_id)).size, 15);
  const oneAtATime = []; let cursor = null;
  for (let i = 0; i < 16; i++) {
    const page = await stores[0].pending(engineHash, cursor, 1);
    if (!page.length) break;
    assert.match(page[0].cursor_created_at, /\.\d{6}Z$/);
    oneAtATime.push(page[0].upload_id);
    cursor = { createdAt: page[0].cursor_created_at, uploadId: page[0].upload_id };
  }
  assert.equal(oneAtATime.length, 15); assert.equal(new Set(oneAtATime).size, 15, 'Microsecond cursors cannot repeat even when failed sources are never staged');
  assert.equal((await first.manualClient.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.pending_early_geometry($1,NULL,NULL)', engineHash)).length, 2);
  for (const value of seeded) assert.equal(await stores[0].stage(value.input), true);
  for (const capacity of [null, 0, 13]) await assert.rejects(first.manualClient.$queryRawUnsafe(
    'SELECT * FROM atlas_manual_connected.claim_early_geometry($1,$2::uuid,$3::integer)', engineHash, randomUUID(), capacity), error => error.meta?.code === 'P0001');
  for (const size of [null, 0, 33]) await assert.rejects(first.manualClient.$queryRawUnsafe(
    'SELECT * FROM atlas_manual_connected.pending_early_geometry($1,NULL,NULL,$2::integer)', engineHash, size), error => error.meta?.code === 'P0001');
  record('one/five-row discovery pages cover all fifteen unstaged sources without microsecond repeats; legacy discovery remains two; SQL rejects invalid limits');

  const claims = (await Promise.all(Array.from({ length: 24 }, (_, i) => stores[i % 2].claim(engineHash, randomUUID(), 12)))).filter(Boolean);
  assert.equal(claims.length, 12); assert.equal(new Set(claims.map(job => job.key)).size, 12);
  assert.equal((await rows("SELECT count(*)::int n FROM atlas_manual_connected.early_geometry WHERE state='RUNNING'"))[0].n, 12);
  assert.equal(await stores[0].claim(engineHash, randomUUID(), 8), null);
  assert.equal((await first.manualClient.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.claim_early_geometry($1,$2::uuid)', engineHash, randomUUID())).length, 0);
  for (const job of claims.slice(1)) assert.equal(await stores[0].finish(job, 'NEEDS_REVIEW', {}), true);
  assert.equal(await stores[1].claim(engineHash, randomUUID(), 2), null, 'One surviving twelve-capacity claim still pins its epoch');
  assert.equal(await stores[0].finish(claims[0], 'NEEDS_REVIEW', {}), true);
  record('two database clients racing 24 claims admit exactly twelve; mixed eight/two/legacy ceilings wait for the entire active epoch');

  const legacy = [];
  for (let i = 0; i < 3; i++) legacy.push(...await first.manualClient.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.claim_early_geometry($1,$2::uuid)', engineHash, randomUUID()));
  assert.equal(legacy.length, 2); assert.equal(await stores[0].claim(engineHash, randomUUID(), 12), null);
  for (const job of legacy) assert.equal((await first.manualClient.$queryRawUnsafe(
    "SELECT atlas_manual_connected.finish_early_geometry($1,$2::uuid,'NEEDS_REVIEW','{}',NULL) AS ok", job.key, job.claim_id))[0].ok, true);
  const expired = await stores[0].claim(engineHash, randomUUID(), 12); assert(expired);
  await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.early_geometry SET lease_until=clock_timestamp()-interval '1 second' WHERE key=$1", expired.key);
  const recovered = await stores[1].claim(engineHash, randomUUID(), 2);
  assert.equal(recovered.key, expired.key); assert.notEqual(recovered.claimId, expired.claimId); assert.deepEqual(recovered.input, expired.input);
  assert.equal(await stores[0].finish(expired, 'NEEDS_REVIEW', {}), false);
  assert.equal(await stores[1].finish(recovered, 'NEEDS_REVIEW', {}), true);
  record('legacy callers retain a global two-job ceiling; expired work recovers under a fresh claim and stale completion cannot overwrite it');

  const discarded = await seed(), replaced = await seed(), revoked = await seed(otherOwner), valid = await seed();
  for (const value of [discarded, replaced, revoked, valid]) await stores[0].stage(value.input);
  await intake.discard(owner, { requestId: randomUUID(), scope: 'SELECTED', cardIds: [discarded.card.cardId] });
  await intake.plan(owner, replaced.card.cardId, { requestId: randomUUID(), side: 'FRONT', expectedVersion: 1, sha256: 'b'.repeat(64), byteCount: 1 });
  await fixture.admin.$executeRawUnsafe('UPDATE atlas_staff."StaffIdentity" SET "accessVersion"="accessVersion"+1,"revokedAt"=clock_timestamp() WHERE id=$1::uuid', otherOwner.id);
  const surviving = (await Promise.all(Array.from({ length: 12 }, () => stores[0].claim(engineHash, randomUUID(), 12)))).filter(Boolean);
  assert.deepEqual(surviving.map(job => job.key), [valid.key]);
  assert.equal((await rows('SELECT error FROM atlas_manual_connected.early_geometry WHERE key=$1', discarded.key))[0].error, 'INTAKE_CARD_DELETED');
  assert.equal((await rows('SELECT count(*)::int n FROM atlas_manual_intake.discarded_card'))[0].n, 1);
  assert.equal(await stores[0].finish(surviving[0], 'NEEDS_REVIEW', {}), true);
  const unpublished = (await rows('SELECT (SELECT count(*) FROM atlas_manual.approval)::int approvals,(SELECT count(*) FROM atlas_manual.publication)::int publications'))[0];
  assert.deepEqual(unpublished, { approvals: 0, publications: 0 });
  record('owner revocation, source replacement and immutable discard fences survive capacity scaling; no certification/publication');
  await writeFile(join(output, 'result.json'), JSON.stringify({ status: 'PASS', checks, migrations: 57, providerCalls: 0, storageCalls: 0, productionMutations: 0 }, null, 2), { mode: 0o600 });
} finally {
  await Promise.all(connections.map(connection => connection.close())); await fixture.stop();
}
