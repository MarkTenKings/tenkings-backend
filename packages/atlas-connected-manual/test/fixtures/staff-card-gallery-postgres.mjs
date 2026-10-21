// Root-logged, disposable native PostgreSQL17 qualification only. Never runtime.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createOwnedManualFixture } from '../../../atlas-manual-service/scripts/owned-fixture.mjs';
import { canonical, digest } from '../../../atlas-manual-service/src/contract.mjs';
import { createIntakeRepository, intakeGrantSQL } from '../../../atlas-manual-intake/src/repository.mjs';
import { connectedGrantSQL } from '../../src/details.mjs';
import { createGallerySnapshot, createStaffCardGallery } from '../../src/staff-card-gallery.mjs';

const output = process.env.ATLAS_STAFF_GALLERY_QUALIFICATION, args = process.argv.slice(2);
assert(output && resolve(output) === output, 'A new absolute qualification directory is required');
assert(args.includes('--postgres-bin') && args.includes('--ack-disposable-local-postgres'));
assert(!args.some(arg => ['--serve', '--docker-image', '--ack-disposable-remote-pg17'].includes(arg)), 'Finite local native fixture only');
await mkdir(output, { mode: 0o700 });
const sources = {};
for (const path of ['../../src/staff-card-gallery.mjs', '../../../atlas-manual-intake/src/repository.mjs', './staff-card-gallery-postgres.mjs'])
  sources[path] = digest(await readFile(new URL(path, import.meta.url)));
const fixture = await createOwnedManualFixture(args), checks = [], preservation = [];
let result;
try {
  await fixture.cluster.sql(intakeGrantSQL('atlas_fixture_manual') + '\n' + connectedGrantSQL('atlas_fixture_manual'), [], fixture.database.name);
  const connection = fixture.connect(), admin = fixture.admin;
  const intake = createIntakeRepository({ boundary: connection.boundary, keyPrefix: 'gallery-synthetic', maxOriginalBytes: 65536 });
  const snapshot = createGallerySnapshot({ boundary: connection.boundary, intakeRepository: intake });
  const unreachable = () => assert.fail('Snapshot qualification must not read, generate or write media');
  const reader = selectedSnapshot => createStaffCardGallery({ snapshot: selectedSnapshot ?? snapshot,
    intake: { readSource: unreachable }, storage: { readDecodedFrame: unreachable }, generate: unreachable });
  const gallery = reader();
  async function login(phone) {
    const boot = await connection.auth.bootstrap(''), initial = `${fixture.config.cookies.browser}=${boot.browserToken}`;
    const challenge = await connection.auth.send(initial, boot.csrf, { phone, requestId: randomUUID() }, 'gallery-fixture');
    const signed = await connection.auth.verify(initial, boot.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'gallery-fixture');
    const cookie = `${initial}; ${fixture.config.cookies.session}=${signed.token}`;
    const staff = await connection.auth.authenticate(cookie, signed.csrf);
    const principal = await connection.boundary.transaction(staff, ({ principal }) => principal);
    return { staff, principal };
  }
  const owner = await login('+12025550141'), other = await login('+12025550143');
  async function card(actor = owner) { return (await intake.create(actor.staff, { requestId: randomUUID(), label: 'SYNTHETIC GALLERY ONLY' })).card; }
  async function side(value, sideName, actor = owner) {
    const { upload } = await intake.plan(actor.staff, value.cardId, { requestId: randomUUID(), side: sideName,
      expectedVersion: value.sides[sideName].version, sha256: digest(`synthetic:${randomUUID()}`), byteCount: 16 });
    const observed = { object: { ...upload.plan.object, versionId: `synthetic-${upload.uploadId}` },
      sha256: upload.plan.expected.sha256, byteCount: 16, contentType: 'application/octet-stream' };
    await intake.recordVerification(actor.staff, value.cardId, upload.uploadId, observed);
    // Synthetic metadata only. No object is uploaded or claimed to exist.
    return (await intake.recordSource(actor.staff, value.cardId, upload.uploadId, { verificationHash: digest(canonical(observed)),
      source: { photoSourceHash: digest(`synthetic-source:${upload.uploadId}`), ref: { key: `synthetic-only/${upload.uploadId}` } } })).card;
  }
  async function pair(actor = owner) { return side(await side(await card(actor), 'FRONT', actor), 'BACK', actor); }
  async function manual(value, { legacy = false, actor = owner, readers = [] } = {}) {
    const draft = { identity: { playerName: 'SYNTHETIC Saved Player' }, ...(legacy ? {} : { source: { sourceHash: value.sourceHash,
      uploads: { FRONT: value.sides.FRONT.upload.uploadId, BACK: value.sides.BACK.upload.uploadId } } }) };
    const content = canonical(draft), contentHash = digest(content);
    await admin.$executeRawUnsafe('INSERT INTO atlas_manual.card(id,revision,content,content_hash,owner_id,readers) VALUES($1::uuid,1,$2,$3,$4::uuid,$5::uuid[])',
      value.cardId, content, contentHash, actor.principal.id, readers);
    return { draft, contentHash };
  }
  async function approve(value, saved) {
    const actionId = randomUUID(), report = canonical({ schema: 'SYNTHETIC_GALLERY_REPORT', finalGrade: 9 });
    await admin.$executeRawUnsafe("INSERT INTO atlas_manual.action(card_id,action_id,actor_id,expected_revision,result_revision,request_hash,request,result) VALUES($1::uuid,$2::uuid,$3::uuid,1,2,$4,'{}','{}')",
      value.cardId, actionId, owner.principal.id, digest('{}'));
    await admin.$executeRawUnsafe('INSERT INTO atlas_manual.approval(card_id,action_id,actor_id,source_revision,source_hash,report_hash,report) VALUES($1::uuid,$2::uuid,$3::uuid,1,$4,$5,$6)',
      value.cardId, actionId, owner.principal.id, saved.contentHash, digest(report), report);
    return actionId;
  }
  const empty = await card(), current = await pair(), detailsOnly = await pair(), legacy = await pair(), acl = await pair(), foreign = await pair(other);
  const saved = await manual(current), actionId = await approve(current, saved);
  await manual(legacy, { legacy: true }); await manual(acl, { actor: other, readers: [owner.principal.id] });
  const details = canonical({ sourceHash: detailsOnly.sourceHash, fields: { name: 'SYNTHETIC Saved Intake Title' } });
  await admin.$executeRawUnsafe('INSERT INTO atlas_manual_connected.details(card_id,content,content_hash) VALUES($1::uuid,$2,$3)', detailsOnly.cardId, details, digest(details));
  const tables = ['atlas_manual.card', 'atlas_manual.action', 'atlas_manual.approval', 'atlas_manual.publication',
    'atlas_manual.public_report_identity', 'atlas_manual_intake.card', 'atlas_manual_intake.upload', 'atlas_manual_intake.discard_request',
    'atlas_manual_intake.discarded_card', 'atlas_manual_connected.details', 'atlas_manual_connected.details_action',
    'atlas_manual_connected.identification', 'atlas_manual_connected.effect', 'atlas_staff."StaffIdentity"',
    'atlas_staff."StaffSession"', 'atlas_staff."StaffBrowser"', 'atlas_staff."StaffControl"'];
  async function census(selected = tables) {
    const values = {};
    for (const table of selected) values[table] = (await admin.$queryRawUnsafe(`SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) value FROM ${table} r`))[0].value;
    return digest(canonical(values));
  }
  async function reads(name, work) {
    const before = await census(); await work(); assert.equal(await census(), before, `${name}: reads changed database rows`);
    preservation.push({ name, sha256: before, tableCount: tables.length }); checks.push(name);
  }
  let approved;
  await reads('actual SELECT snapshot: current approval, exact pair/title, saved details, legacy UNKNOWN and absent draft/details without INSERT', async () => {
    approved = await gallery.read(owner.staff, current.cardId);
    assert.equal(approved.staffId, owner.principal.id); assert.equal(approved.review.state, 'APPROVED_CURRENT');
    assert.equal(approved.review.approval.actionId, actionId); assert.equal(approved.review.approval.sourceHash, saved.contentHash);
    assert.equal(approved.title.text, saved.draft.identity.playerName); assert.equal(approved.front.binding.sourceHash, current.sourceHash);
    assert.equal(approved.front.binding.uploadId, current.sides.FRONT.upload.uploadId);
    const intakeOnly = await gallery.read(owner.staff, detailsOnly.cardId);
    assert.equal(intakeOnly.title.source, 'SAVED_DETAILS'); assert.equal(intakeOnly.title.text, 'SYNTHETIC Saved Intake Title');
    const unknown = await gallery.read(owner.staff, legacy.cardId); assert.equal(unknown.review.state, 'UNKNOWN'); assert.equal(unknown.title.text, null);
    const missing = await gallery.read(owner.staff, empty.cardId); assert.equal(missing.manual, null); assert.equal(missing.review.state, 'UNKNOWN'); assert.equal(missing.front.state, 'UNAVAILABLE');
    assert.equal((await admin.$queryRawUnsafe('SELECT count(*) n FROM atlas_manual_connected.details WHERE card_id=$1::uuid', empty.cardId))[0].n, 0n);
  });
  await reads('intake list staffId, owner-only pagination/cursor and foreign gallery access stay private', async () => {
    const first = await intake.list(owner.staff, { limit: 2 }); assert.equal(first.staffId, owner.principal.id); assert.equal(first.cards.length, 2); assert(first.nextCursor);
    const rest = await intake.list(owner.staff, { limit: 30, cursor: first.nextCursor }); assert.equal(rest.staffId, owner.principal.id);
    const ids = [...first.cards, ...rest.cards].map(value => value.cardId); assert.equal(new Set(ids).size, 5); assert(!ids.includes(foreign.cardId));
    const theirs = await intake.list(other.staff); assert.equal(theirs.staffId, other.principal.id); assert.deepEqual(theirs.cards.map(value => value.cardId), [foreign.cardId]);
    await assert.rejects(intake.list(owner.staff, { cursor: foreign.cardId }), { code: 'INTAKE_CARD_NOT_FOUND' });
    await assert.rejects(gallery.read(other.staff, current.cardId), { code: 'INTAKE_CARD_NOT_FOUND' });
    assert.equal((await gallery.read(owner.staff, acl.cardId)).manual.sourceCurrent, true);
  });
  const historical = await census(['atlas_manual.action', 'atlas_manual.approval']);
  const revised = canonical({ ...saved.draft, identity: { playerName: 'SYNTHETIC Revised Player' } });
  await admin.$executeRawUnsafe('UPDATE atlas_manual.card SET content=$1,content_hash=$2,revision=revision+1 WHERE id=$3::uuid', revised, digest(revised), current.cardId);
  await reads('edited draft retains prior approval truthfully instead of claiming current approval', async () => {
    const value = await gallery.read(owner.staff, current.cardId); assert.equal(value.review.state, 'CHANGED_SINCE_APPROVAL');
    assert.equal(value.review.approval.current, false); assert.equal(value.review.approval.actionId, actionId); assert.equal(value.title.text, 'SYNTHETIC Revised Player');
  });
  let first = true;
  const changing = reader(async (...input) => { const value = await snapshot(...input); if (first) { first = false; await side(current, 'FRONT'); } return value; });
  await assert.rejects(changing.read(owner.staff, current.cardId), { code: 'GALLERY_SOURCE_CHANGED' });
  await reads('real source replacement refuses old two-snapshot read and preserves earlier approval/history', async () => {
    const value = await gallery.read(owner.staff, current.cardId); assert.equal(value.review.state, 'PHOTOS_CHANGED'); assert.equal(value.title.text, null);
    assert.notEqual(value.sourceHash, current.sourceHash); assert.equal(value.review.approval.actionId, actionId); assert.equal(value.review.approval.current, false);
    assert.equal(await census(['atlas_manual.action', 'atlas_manual.approval']), historical);
  });
  first = true;
  const revokedACL = reader(async (...input) => { const value = await snapshot(...input); if (first) { first = false;
    await admin.$executeRawUnsafe("UPDATE atlas_manual.card SET readers='{}'::uuid[],revision=revision+1 WHERE id=$1::uuid", acl.cardId); } return value; });
  await assert.rejects(revokedACL.read(owner.staff, acl.cardId), { code: 'MANUAL_CARD_NOT_FOUND' });
  await reads('manual ACL revocation denies the final snapshot and later reads without inserts', async () => {
    await assert.rejects(gallery.read(owner.staff, acl.cardId), { code: 'MANUAL_CARD_NOT_FOUND' });
  });
  first = true;
  const sessionHash = connection.auth.actors.get(owner.staff).sessionHash;
  const revokedSession = reader(async (...input) => { const value = await snapshot(...input); if (first) { first = false;
    await admin.$executeRawUnsafe('UPDATE atlas_staff."StaffSession" SET "revokedAt"=clock_timestamp() WHERE "tokenHash"=$1', sessionHash); } return value; });
  await assert.rejects(revokedSession.read(owner.staff, empty.cardId), { code: 'SIGN_IN_REQUIRED' });
  await reads('real session revocation denies final snapshot, gallery and list without business writes', async () => {
    await assert.rejects(gallery.read(owner.staff, empty.cardId), { code: 'SIGN_IN_REQUIRED' });
    await assert.rejects(intake.list(owner.staff), { code: 'SIGN_IN_REQUIRED' });
  });
  result = { pass: true, checks, preservation, sourceSha256: sources, syntheticOnly: true, mediaQualified: false,
    mediaReads: 0, providerCalls: 0, productionQueries: 0, notificationEffects: 0, node: process.version, ownedCluster: fixture.cluster.directory };
} catch (error) {
  result = { pass: false, checks, preservation, sourceSha256: sources, syntheticOnly: true,
    error: { name: error.name, code: error.code, message: error.message }, productionQueries: 0, providerCalls: 0 };
  throw error;
} finally {
  await fixture.stop();
  const cleanupPath = resolve(fixture.cluster.directory, 'cleanup.json'), cleanup = JSON.parse(await readFile(cleanupPath, 'utf8'));
  result = { ...result, stoppedVerified: cleanup.stoppedVerified === true, cleanupPath };
  await copyFile(cleanupPath, resolve(output, 'cleanup.json')); await chmod(resolve(output, 'cleanup.json'), 0o600);
  await copyFile(resolve(fixture.cluster.directory, 'validation.log'), resolve(output, 'harness-validation.log'));
  await writeFile(resolve(output, 'postgres-result.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  process.stdout.write(JSON.stringify(result) + '\n'); assert.equal(result.stoppedVerified, true);
}
