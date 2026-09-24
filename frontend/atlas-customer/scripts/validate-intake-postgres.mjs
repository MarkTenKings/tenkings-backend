import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { PrismaClient } from '../../atlas-app/.generated/staff-database/index.js';
import { disposablePostgres } from '../../atlas-app/scripts/disposable-postgres.mjs';
import { CustomerAuth } from '../lib/server/auth.mjs';
import { CustomerDatabase } from '../lib/server/database.mjs';
import { localConfig, fixtureProvider } from '../lib/server/fixture.mjs';

const fixture = await disposablePostgres(process.argv.slice(2));
let admin, client, checks = 0;
const hash = b => createHash('sha256').update(b).digest('hex');
try {
  const db = await fixture.database();
  admin = new PrismaClient({ datasources: { db: { url: db.adminUrl } } });
  client = new PrismaClient({ datasources: { db: { url: db.customerUrl } } });
  const config = localConfig({ databaseUrl: db.customerUrl, sessionKey: randomBytes(32), phoneKey: randomBytes(32) });
  const database = new CustomerDatabase(client, config), auth = new CustomerAuth({ database, config, provider: fixtureProvider(config) });
  await admin.$executeRaw`INSERT INTO atlas_customer."CustomerControl"(enabled,mode,origin,"deploymentId","releaseSha","configHash")
    VALUES(true,${config.mode},${config.origin},${config.deploymentId},${config.releaseSha},${config.configHash})`;
  async function login(phone) {
    const boot = await auth.bootstrap(undefined, 'intake-fixture'), initial = `${config.cookies.browser}=${boot.browserToken}`;
    const challenge = await auth.send(initial, boot.csrf, { phone, requestId: randomUUID() }, 'intake-fixture');
    const signed = await auth.verify(initial, boot.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'intake-fixture');
    return { ...signed, cookie: `${initial}; ${config.cookies.session}=${signed.token}` };
  }
  const a = await login('+12025550101'), b = await login('+12025550102');
  const call = (action, data, who = a) => auth.call(who.cookie, action, data, who.csrf);
  const authority = { binding: config.binding, ...auth.authority(a.cookie, a.csrf) };
  const worker = async (action, d) => {
    const [{ result }] = await admin.$queryRaw`SELECT atlas_customer.intake_worker_call(${action},${JSON.stringify(d)}::jsonb) AS result`;
    if (result.error) throw Object.assign(new Error(result.error.code), result.error);
    return result;
  };
  const profile = { name: 'Synthetic Customer', email: 'synthetic@example.test', address1: '1 Fixture Road', address2: '', city: 'Example', region: 'CA', postalCode: '90001', country: 'US' };
  const saved = await call('profile', { profile }); assert.deepEqual(saved.customer.profile, profile); checks++;
  const legacy = { ...profile }; delete legacy.email;
  await call('profile', { profile: legacy }, b); checks++;
  await assert.rejects(call('profile', { profile: { ...profile, email: 'bad' } }), { code: 'RETURN_DETAILS_REQUIRED' }); checks++;
  await assert.rejects(client.$queryRaw`SELECT * FROM atlas_customer."CustomerIntakeDraft"`); checks++;
  await assert.rejects(client.$queryRaw`SELECT atlas_customer.intake_worker_call('claim','{}'::jsonb)`); checks++;
  await assert.rejects(client.$queryRaw`SELECT atlas_customer.customer_call_v1('list','{}'::jsonb,'{}'::jsonb)`); checks++;
  await assert.rejects(database.call('intake_list', { browserHash: 'f'.repeat(64), sessionHash: 'e'.repeat(64) }), { code: 'SIGN_IN_REQUIRED' }); checks++;
  const create = { requestId: randomUUID(), intakeMethod: 'MAIL_IN', kioskId: null };
  let { draft } = await call('intake_create', create);
  assert.equal((await call('intake_create', create)).draft.id, draft.id); checks++;
  await assert.rejects(call('intake_create', { ...create, intakeMethod: 'DEALER_DROP_OFF', kioskId: randomUUID() }), { code: 'REQUEST_CONFLICT' }); checks++;
  await assert.rejects(call('intake_create', { requestId: randomUUID(), intakeMethod: 'DEALER_DROP_OFF', kioskId: randomUUID() }), { code: 'KIOSK_NOT_AVAILABLE' }); checks++;
  await assert.rejects(call('intake_read', { id: draft.id }, b), { code: 'NOT_FOUND' }); checks++;
  const card = { requestId: randomUUID(), cardId: randomUUID(), pairId: randomUUID(),
    front: { uploadId: randomUUID(), sha256: '1'.repeat(64), byteCount: 10, fileName: 'IMG_1234.HEIC' },
    back: { uploadId: randomUUID(), sha256: '2'.repeat(64), byteCount: 11, fileName: 'IMG_9876.HEIC' } };
  draft = (await call('intake_card', { id: draft.id, card })).draft;
  assert.equal(draft.cards.length, 1); assert.equal(draft.cards[0].identityState, 'UPLOADING'); checks++;
  assert.equal((await call('intake_card', { id: draft.id, card })).draft.revision, draft.revision); checks++;
  await assert.rejects(call('intake_review', { id: draft.id, expectedRevision: draft.revision, profile }), { code: 'INTAKE_REVIEW_NOT_READY' }); checks++;
  for (const side of ['front', 'back']) {
    const input = { id: draft.id, cardId: card.cardId, uploadId: card[side].uploadId };
    await assert.rejects(call('intake_upload', input, b), { code: 'NOT_FOUND' }); checks++;
    const { upload } = await call('intake_upload', input);
    assert.equal(upload.plan.object.key, `atlas-customer/originals/${a.customer.id}/${card.cardId}/${card[side].uploadId}`); checks++;
    const verification = { object: upload.plan.object, ...upload.plan.expected, contentType: 'application/octet-stream' };
    await assert.rejects(worker('verify', { ...input, authority, verification: { ...verification, sha256: 'f'.repeat(64) } }), { code: 'INTAKE_UPLOAD_CONFLICT' }); checks++;
    draft = (await worker('verify', { ...input, authority, verification })).draft;
  }
  assert.equal(draft.cards[0].identityState, 'QUEUED'); checks++;
  const { job } = await worker('claim', {}), scope = { attemptId: job.attemptId, leaseId: job.leaseId };
  const identity = { category: 'SPORTS', title: 'Synthetic fixture card', playerName: 'Fixture Player', year: '2026', manufacturer: 'Fixture', setName: 'Test Set', cardNumber: '1', parallel: '', insert: '' };
  const dispatch = { ...scope, stage: 'MODEL', requestHash: 'a'.repeat(64) };
  assert.equal((await worker('dispatch', dispatch)).dispatch, true);
  assert.equal((await worker('dispatch', dispatch)).dispatch, false); checks++;
  const bytes = Buffer.from(JSON.stringify({ synthetic: true }));
  await worker('response', { ...dispatch, response: bytes.toString('base64'), responseHash: hash(bytes) });
  await worker('finish', { ...scope, result: { identity, suggestions: {}, warnings: [], provenance: { engine_version: 'card-identification-v2', subject: { id: card.cardId, revision: job.sourceHash } } } });
  draft = (await call('intake_read', { id: draft.id })).draft;
  assert.equal(draft.cards[0].identitySource, 'MACHINE_PROPOSAL'); checks++;
  draft = (await call('intake_correct', { id: draft.id, cardId: card.cardId, expectedRevision: draft.cards[0].revision, identity: { ...identity, title: 'Customer corrected title' } })).draft;
  await assert.rejects(call('intake_correct', { id: draft.id, cardId: card.cardId, expectedRevision: 1, identity }), { code: 'INTAKE_REVISION_CHANGED' }); checks++;
  draft = (await call('intake_review', { id: draft.id, expectedRevision: draft.revision, profile })).draft;
  assert.equal(draft.state, 'REVIEW'); assert.equal(draft.cards[0].identity.title, 'Customer corrected title'); checks++;
  const accounts = (await call('intake_list', {}, b)).drafts; assert.equal(accounts.length, 0); checks++;
  process.stdout.write(JSON.stringify({ pass: true, checks, syntheticOnly: true, migrations: fixture.source.staffMigrations.length, evidenceDirectory: fixture.directory })+'\n');
} finally {
  await client?.$disconnect(); await admin?.$disconnect(); await fixture.stop();
}
