import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createOwnedManualFixture } from '../../atlas-manual-service/scripts/owned-fixture.mjs';
import { createDefectMemory, createDefectMemoryRepository, defectMemoryGrantSQL } from '../src/index.mjs';
import { canonical, digest, requireThat } from '../src/contract.mjs';
import { fixtures, identity } from '../test/fixtures.mjs';
import { runAnalysisFixtureChecks } from '../../atlas-defect-analysis/scripts/fixture-checks.mjs';

const fixture = await createOwnedManualFixture(process.argv.slice(2));
const checks = [], hydration = new Map(), nativeSources = new Map();
const record = name => checks.push(name);
let connection = fixture.connect();
async function login(phone) {
  const boot = await connection.auth.bootstrap(''), cookie = `${fixture.config.cookies.browser}=${boot.browserToken}`;
  const challenge = await connection.auth.send(cookie, boot.csrf, { phone, requestId: randomUUID() }, 'fixture-memory');
  const verified = await connection.auth.verify(cookie, boot.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'fixture-memory');
  const signed = `${cookie}; ${fixture.config.cookies.session}=${verified.token}`;
  return { cookie: signed, csrf: verified.csrf, staff: await connection.auth.authenticate(signed, verified.csrf) };
}
const hydrate = async card => {
  const saved = hydration.get(card.draft.defects.sourceHash); assert(saved, 'Exact saved fixture artifact required');
  return saved;
};
let effect = input => exemplars.get(input.card.cardId)(input), exemplars = new Map();
const connectMemory = () => createDefectMemory({ repository: createDefectMemoryRepository({ boundary: connection.boundary,
  validateSource: ({ cardId, draft }) => requireThat(nativeSources.get(cardId) === draft.source.sourceHash, 409, 'INTAKE_PAIR_STALE') }),
hydrate, createExemplar: input => effect(input) });
async function provision(actor, options = {}) {
  const f = fixtures(options); if (options.identity) f.draft.identity = options.identity;
  hydration.set(f.draft.defects.sourceHash, { geometry: f.geometry, defects: f.defects });
  nativeSources.set(f.cardId, f.draft.source.sourceHash); exemplars.set(f.cardId, f.createExemplar);
  const saved = await connection.repository.provision(actor.staff, { cardId: f.cardId, draft: f.draft });
  return { ...f, saved };
}
async function confirm(actor, f, changed = null) {
  const current = (await connection.repository.load(actor.staff, f.cardId)).card;
  const draft = changed ?? current.draft;
  const input = { actionId: randomUUID(), expectedRevision: current.revision,
    action: { type: 'CONFIRM_FINDINGS', reviewed: true, base: f.base } };
  return connection.repository.commit(actor.staff, { cardId: f.cardId, input, baseHash: current.contentHash, draft });
}
try {
  await fixture.cluster.sql(defectMemoryGrantSQL('atlas_fixture_manual'), [], fixture.database.name);
  await fixture.cluster.sql('GRANT USAGE ON SCHEMA atlas_manual_intake TO atlas_fixture_manual; GRANT SELECT ON atlas_manual_intake.card TO atlas_fixture_manual', [], fixture.database.name);
  await fixture.admin.$executeRawUnsafe(`UPDATE atlas_staff."StaffIdentity" SET "certificationUntil"=NULL,"accessVersion"="accessVersion"+1 WHERE role='REVIEWER'`);
  const reviewer = await login('+12025550141'), observer = await login('+12025550142'), other = await login('+12025550143');
  const principal = (await connection.boundary.transaction(reviewer.staff, async ({ principal }) => principal));
  assert.equal((await connection.boundary.transaction(reviewer.staff, async ({ principal }) => principal)).canCertify, false);
  const a = await provision(reviewer), b = await provision(other, { originalHashes: ['7'.repeat(64), '8'.repeat(64)] });
  let memory = connectMemory();
  assert.equal((await memory.status(reviewer.staff, a.cardId)).status, 'NO_CONFIRMED_FINDINGS');
  assert.equal((await memory.retrieve(other.staff, { cardId: b.cardId })).status, 'EMPTY_REVIEWED_BANK');
  const committed = await confirm(reviewer, a), actionId = committed.receipt.actionId;
  const pending = await memory.retrieve(other.staff, { cardId: b.cardId });
  assert.equal(pending.status, 'PUBLICATION_PENDING'); assert.equal(pending.generation, 0);
  assert.equal((await memory.status(reviewer.staff, a.cardId, actionId)).status, 'PENDING');
  record('complete public/staff migration chains and no-op replays; committed human review is durable pending intent');

  await assert.rejects(memory.publish({ ...reviewer.staff }, a.cardId, actionId), { code: 'SIGN_IN_REQUIRED' });
  await assert.rejects(memory.publish(other.staff, a.cardId, actionId), { code: 'MANUAL_CARD_NOT_FOUND' });
  await assert.rejects(memory.publish(observer.staff, a.cardId, actionId), { code: 'MANUAL_CARD_NOT_FOUND' });
  record('forged handles, unrelated graders and observers cannot publish or read a private target');

  const originalEffect = effect; effect = async () => { throw new Error('owned crop storage outage'); };
  await assert.rejects(memory.publish(reviewer.staff, a.cardId, actionId), /owned crop storage outage/);
  assert.equal((await connection.repository.status(reviewer.staff, a.cardId, actionId)).state, 'COMMITTED');
  assert.equal((await memory.status(reviewer.staff, a.cardId, actionId)).status, 'PENDING');
  effect = originalEffect;
  const published = await memory.publish(reviewer.staff, a.cardId, actionId);
  assert.equal(published.status, 'PUBLISHED'); assert.equal(published.generation, 1); assert.equal(published.lessonCount, 2);
  assert.deepEqual(await memory.publish(reviewer.staff, a.cardId, actionId), published);
  const learned = await memory.retrieve(other.staff, { cardId: b.cardId });
  assert.equal(learned.status, 'READY'); assert.equal(learned.lessons.length, 2); assert.equal(learned.generation, 1);
  assert(learned.lessons.every(l => l.source.actionId === actionId)); assert.notEqual(learned.revision, pending.revision);
  record('non-certifying REVIEWER publishes; failed crop preserves confirmation; exact replay is idempotent; next retrieval uses acknowledged revision');

  await connection.close(); connection = fixture.connect();
  reviewer.staff = await connection.auth.authenticate(reviewer.cookie, reviewer.csrf); other.staff = await connection.auth.authenticate(other.cookie, other.csrf);
  memory = connectMemory();
  assert.deepEqual(await memory.retrieve(other.staff, { cardId: b.cardId }), learned);
  assert.deepEqual(await memory.publish(reviewer.staff, a.cardId, actionId), published);
  record('new auth/repository/service instances retrieve identical durable knowledge and publication receipts');

  const unrelated = await provision(other, { identity: { ...identity, productSet: 'Unrelated printed design' }, originalHashes: ['9'.repeat(64), 'a'.repeat(64)] });
  assert.equal((await memory.retrieve(other.staff, { cardId: unrelated.cardId })).lessons.length, 0);
  const duplicate = await provision(other);
  assert.equal((await memory.retrieve(other.staff, { cardId: duplicate.cardId })).lessons.length, 0);
  assert.equal((await memory.retrieve(reviewer.staff, { cardId: a.cardId })).lessons.length, 0);
  record('unrelated designs, target card and identical original-photo hashes receive no borrowed visual examples');

  const empty = fixtures({ cardId: a.cardId, empty: true });
  const nextDraft = { ...committed.card.draft, defects: empty.draft.defects };
  hydration.set(nextDraft.defects.sourceHash, { geometry: a.geometry, defects: empty.defects });
  const newer = await confirm(reviewer, { ...a, base: empty.base }, nextDraft);
  const superseding = await memory.retrieve(other.staff, { cardId: b.cardId });
  assert.equal(superseding.generation, 1); assert.notEqual(superseding.revision, learned.revision);
  assert.equal(superseding.status, 'PUBLICATION_PENDING'); assert.equal(superseding.lessons.length, 0);
  assert.equal((await memory.publish(reviewer.staff, a.cardId, actionId)).status, 'SUPERSEDED');
  const cleared = await memory.publish(reviewer.staff, a.cardId, newer.receipt.actionId);
  assert.equal(cleared.lessonCount, 0); assert.equal(cleared.generation, 2);
  assert.equal((await memory.retrieve(other.staff, { cardId: b.cardId })).status, 'EMPTY_REVIEWED_BANK');
  assert.equal((await fixture.admin.$queryRawUnsafe('SELECT count(*)::integer AS count FROM atlas_manual.defect_memory_publication'))[0].count, 2);
  record('new confirmation suppresses prior lessons before counter increment; zero-findings publication supersedes without deleting history');

  const c = await provision(reviewer, { originalHashes: ['b'.repeat(64), 'c'.repeat(64)] }), cConfirmed = await confirm(reviewer, c);
  let first = true; effect = async input => {
    if (first) { first = false; nativeSources.set(c.cardId, digest('owned replaced native source')); }
    return originalEffect(input);
  };
  await assert.rejects(memory.publish(reviewer.staff, c.cardId, cConfirmed.receipt.actionId), { code: 'INTAKE_PAIR_STALE' });
  assert.equal((await connection.repository.status(reviewer.staff, c.cardId, cConfirmed.receipt.actionId)).state, 'COMMITTED');
  assert.equal((await fixture.admin.$queryRawUnsafe('SELECT count(*)::integer AS count FROM atlas_manual.defect_memory_publication'))[0].count, 2);
  nativeSources.set(c.cardId, c.draft.source.sourceHash); effect = originalEffect;
  record('source replacement during crop generation fences publication after effects while preserving committed review');

  first = true; effect = async input => {
    if (first) { first = false; await fixture.admin.$executeRawUnsafe(`UPDATE atlas_staff."StaffIdentity" SET "revokedAt"=CURRENT_TIMESTAMP,"accessVersion"="accessVersion"+1 WHERE id=$1::uuid`, principal.id); }
    return originalEffect(input);
  };
  await assert.rejects(memory.publish(reviewer.staff, c.cardId, cConfirmed.receipt.actionId), { code: 'SIGN_IN_REQUIRED' });
  await fixture.admin.$executeRawUnsafe(`UPDATE atlas_staff."StaffIdentity" SET "revokedAt"=NULL,"accessVersion"="accessVersion"+1 WHERE id=$1::uuid`, principal.id);
  Object.assign(reviewer, await login('+12025550141'));
  effect = originalEffect;
  assert.equal((await memory.status(reviewer.staff, c.cardId, cConfirmed.receipt.actionId)).status, 'PENDING');
  record('reviewer revocation during image effects prevents publication and retains retryable confirmation');

  const p3 = await memory.publish(reviewer.staff, c.cardId, cConfirmed.receipt.actionId);
  const cCurrent = (await connection.repository.load(reviewer.staff, c.cardId)).card;
  const changedDraft = { ...cCurrent.draft, assistance: { sourceHash: digest('new unconfirmed rejection') } };
  await connection.repository.commit(reviewer.staff, { cardId: c.cardId, baseHash: cCurrent.contentHash, draft: changedDraft,
    input: { actionId: randomUUID(), expectedRevision: cCurrent.revision, action: { type: 'OWNED_FIXTURE_EDIT' } } });
  assert.equal((await memory.status(reviewer.staff, c.cardId)).status, 'SUPERSEDED');
  assert.equal((await memory.publish(reviewer.staff, c.cardId, cConfirmed.receipt.actionId)).status, 'SUPERSEDED');
  assert.equal((await memory.retrieve(other.staff, { cardId: b.cardId })).lessons.length, 2);
  record('current publication UI reflects unconfirmed assistance edits; previously published immutable visual history remains usable');

  await assert.rejects(connection.manualClient.$executeRawUnsafe('UPDATE atlas_manual.defect_memory_publication SET revision=revision+100'), /permission denied/);
  await assert.rejects(fixture.admin.$executeRawUnsafe('DELETE FROM atlas_manual.defect_memory_publication'), /immutable/);
  const [stored] = await fixture.admin.$queryRawUnsafe('SELECT * FROM atlas_manual.defect_memory_publication WHERE revision=$1', p3.generation);
  assert(!stored.document.includes('pngBase64') && !stored.document.includes('"runs"'));
  await assert.rejects(fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_manual.defect_memory_publication
    (revision,card_id,action_id,actor_id,result_revision,content_hash,source_hash,design_key,document,document_hash)
    VALUES(4,$1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9)`, stored.card_id, stored.action_id, randomUUID(), stored.result_revision,
  stored.content_hash, stored.source_hash, stored.design_key, stored.document, stored.document_hash), /Exact committed/);
  record('restricted serving grants and database triggers preserve append-only history and reject forged confirmation provenance; SQL contains no image/trace bodies');

  const otherPrincipal = await connection.boundary.transaction(other.staff, async ({ principal }) => principal);
  const observerPrincipal = await connection.boundary.transaction(await connection.auth.authenticate(observer.cookie, observer.csrf), async ({ principal }) => principal);
  await fixture.admin.$executeRawUnsafe(`UPDATE atlas_manual.card SET editors=ARRAY[$1::uuid],readers=ARRAY[$2::uuid],revision=revision+1 WHERE id=$3::uuid`,
    otherPrincipal.id, observerPrincipal.id, a.cardId);
  await assert.rejects(memory.publish(other.staff, a.cardId, newer.receipt.actionId), { code: 'MEMORY_CONFIRMER_REQUIRED' });
  const editedConfirmation = await confirm(other, { ...a, base: empty.base });
  assert.equal((await memory.publish(other.staff, a.cardId, editedConfirmation.receipt.actionId)).status, 'PUBLISHED');
  observer.staff = await connection.auth.authenticate(observer.cookie, observer.csrf);
  assert.equal((await memory.status(observer.staff, a.cardId)).status, 'PUBLISHED');
  await assert.rejects(memory.publish(observer.staff, a.cardId, editedConfirmation.receipt.actionId), { code: 'MANUAL_CARD_ACCESS_DENIED' });
  record('authorized non-certifying editor deliberately confirms and publishes own review; reader observer and borrowed confirmer identity are refused');

  checks.push(...await runAnalysisFixtureChecks({ fixture, connection, reviewer, cardId: c.cardId, actorId: principal.id }));

  const result = { ok: true, node: process.version, checks, publicMigrations: fixture.cluster.source.publicMigrations.length,
    staffMigrations: fixture.cluster.source.staffMigrations.length, evidenceDirectory: fixture.cluster.directory };
  await writeFile(join(fixture.cluster.directory, 'memory-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  await writeFile(join(fixture.cluster.directory, 'memory-result.json'), JSON.stringify({ ok: false, checks, error: fixture.cluster.safe(error.stack) }, null, 2));
  throw error;
} finally {
  await fixture.stop();
  const cleanup = JSON.parse(await readFile(join(fixture.cluster.directory, 'cleanup.json'), 'utf8'));
  assert.equal(cleanup.stoppedVerified, true);
  console.log(JSON.stringify({ cleanup, evidenceDirectory: fixture.cluster.directory }));
}
