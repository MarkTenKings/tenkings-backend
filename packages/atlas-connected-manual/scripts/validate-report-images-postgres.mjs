// Finite owned synthetic PostgreSQL qualification. Never accepts an existing DB.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createOwnedManualFixture } from '../../atlas-manual-service/scripts/owned-fixture.mjs';
import { createMachineStaffBoundary, machineGrantSQL } from '@atlas/manual-service/machine-auth';
import { createManualRepository } from '@atlas/manual-service/repository';
import { createManualService } from '@atlas/manual-service';
import { digest } from '@atlas/manual-service/contract';
import { intakeGrantSQL } from '@atlas/manual-intake/repository';
import { createPublicationRepository, publicationGrantSQL } from '../src/publication-repository.mjs';
import { createManualPublication } from '../src/publication.mjs';
import { createReportImageStore, reportImageGrantSQL } from '../src/report-image-store.mjs';
import { REPORT_IMAGE_RECIPE } from '../src/report-image-provider.mjs';
import { publicationFixture } from '../test/publication-fixture.mjs';

const output = process.env.ATLAS_REPORT_IMAGES_EVIDENCE;
assert(output && resolve(output) === output, 'Absolute owned evidence directory required');
await mkdir(output, { recursive: true, mode: 0o700 });
const fixture = await createOwnedManualFixture(process.argv.slice(2)), connection = fixture.connect();
try {
  for (const grant of [machineGrantSQL, intakeGrantSQL, publicationGrantSQL, reportImageGrantSQL])
    await fixture.cluster.sql(grant('atlas_fixture_manual'), [], fixture.database.name);
  const { auth, boundary, manualClient } = connection;
  const boot = await auth.bootstrap(''), browser = `${fixture.config.cookies.browser}=${boot.browserToken}`;
  const challenge = await auth.send(browser, boot.csrf, { phone: '+12025550141', requestId: randomUUID() }, 'report-image-fixture');
  const verified = await auth.verify(browser, boot.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'report-image-fixture');
  const staff = await auth.authenticate(`${browser}; ${fixture.config.cookies.session}=${verified.token}`, verified.csrf);
  const principal = await boundary.transaction(staff, async ({ principal }) => principal);
  const machine = createMachineStaffBoundary({ boundary, auth, manualClient });
  const store = createReportImageStore({ boundary: machine, client: manualClient }), checks = [];
  async function publish() {
    const pub = await publicationFixture(), createId = randomUUID();
    await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_manual_intake.card(id,pair_id,owner_id,create_request_id,create_request_hash,label)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,'Synthetic report image qualification')`, pub.cardId, randomUUID(), principal.id, createId, digest(createId));
    const repository = createPublicationRepository({ boundary }), manual = createManualRepository({ boundary, approvalCommitted: repository.approvalCommitted });
    await manual.provision(staff, { cardId: pub.cardId, draft: pub.draft });
    const service = createManualService({ repository: manual, reduce: ({ card }) => card.draft, buildReport: async () => pub.approval });
    await service.execute(staff, pub.cardId, { actionId: pub.actionId, expectedRevision: 1, action: { type: 'APPROVE_REPORT', reportHash: pub.row.report_hash, reviewed: true } });
    const publication = createManualPublication({ repository, artifacts: pub.artifacts, storage: pub.storage,
      readSource: async (_staff, _id, upload) => ({ photo: pub.photos[upload.side] }) });
    await publication.publish(staff, pub.cardId, pub.actionId);
    return { row: (await fixture.admin.$queryRawUnsafe('SELECT * FROM atlas_manual.publication WHERE card_id=$1::uuid', pub.cardId))[0], createId };
  }
  const source = char => ({ descriptor: { raster: { content: { sha256: char.repeat(64) } } } });
  const first = await publish(), second = await publish();
  const before = await fixture.admin.$queryRawUnsafe('SELECT * FROM atlas_manual.publication ORDER BY card_id');
  assert.equal((await store.candidates()).length, 2);
  const front = await store.enqueue(first.row, 'FRONT', source('a'), REPORT_IMAGE_RECIPE);
  assert.equal(await store.enqueue(first.row, 'FRONT', source('a'), REPORT_IMAGE_RECIPE), front);
  assert.equal(await store.enqueue(second.row, 'FRONT', source('a'), REPORT_IMAGE_RECIPE), front);
  const back = await store.enqueue(first.row, 'BACK', source('b'), REPORT_IMAGE_RECIPE);
  await store.enqueue(second.row, 'BACK', source('b'), REPORT_IMAGE_RECIPE);
  assert.equal((await store.candidates()).length, 0);
  assert.equal(Number((await fixture.admin.$queryRawUnsafe('SELECT count(*) n FROM atlas_manual_connected.report_image_job'))[0].n), 2);
  checks.push('two publications and four sides deduplicate to two exact source/recipe jobs; repeat discovery and enqueue are inert');
  assert.equal(await store.claim(2, 'f'.repeat(64)), null);
  assert.equal(Number((await fixture.admin.$queryRawUnsafe('SELECT sum(attempts) n FROM atlas_manual_connected.report_image_job'))[0].n), 0);
  let claims = (await Promise.all([store.claim(2), store.claim(2), store.claim(2)])).filter(Boolean);
  while (claims.length < 2) { const next = await store.claim(2); assert(next); claims.push(next); }
  assert.equal(await store.claim(2), null);
  const a = claims.find(x => x.key === front), b = claims.find(x => x.key === back);
  assert(await store.renew(a)); assert.equal(await store.dispatch({ ...a, claim_id: randomUUID() }), false);
  assert(await store.dispatch(a)); assert(await store.recordReceipt(a, { providerRequestId: 'req_a', usage: { output_tokens: 10 } }));
  assert.equal(await store.recordReceipt(a, { providerRequestId: 'req_a' }), false);
  assert(await store.finish(a, { result: { fixture: true }, receipt: { providerRequestId: 'req_a' } }));
  assert((await store.ready(first.row, 'FRONT')).result.fixture); assert((await store.ready(second.row, 'FRONT')).result.fixture);
  assert.deepEqual((await store.readyMany(first.row)).map(job => job.side), ['FRONT']);
  assert.deepEqual(await store.readyMany({ ...first.row, manifest_hash: 'd'.repeat(64) }), []);
  assert.equal(await store.ready({ ...first.row, manifest_hash: 'd'.repeat(64) }, 'FRONT'), null);
  await assert.rejects(store.enqueue(first.row, 'FRONT', source('a'), { ...REPORT_IMAGE_RECIPE, execution: 'OPENAI_BUILT_IN', model: null }, { receipt: { fixture: true } }), { code: 'REPORT_IMAGE_SEED_BINDING_EXISTS' });
  await assert.rejects(manualClient.$executeRawUnsafe("UPDATE atlas_manual_connected.report_image_job SET state='QUEUED',result=NULL,result_hash=NULL WHERE key=$1", front), /immutable/);
  checks.push('global bounded claims, renewable claim fencing, exact publication selection, immutable ready output and explicit seed conflict pass');
  assert(await store.dispatch(b));
  await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.report_image_job SET lease_until=clock_timestamp()-interval '1 second' WHERE key=$1", b.key);
  assert.equal(await store.finish(b, { result: { stale: true } }), false);
  assert.equal(await store.claim(2), null);
  assert.equal((await fixture.admin.$queryRawUnsafe('SELECT state FROM atlas_manual_connected.report_image_job WHERE key=$1', b.key))[0].state, 'UNKNOWN');
  assert(await store.recordReceipt(b, { providerRequestId: 'req_late', usage: { output_tokens: 20 } }));
  const third = await publish(), thirdKey = await store.enqueue(third.row, 'FRONT', source('c'), REPORT_IMAGE_RECIPE);
  let retry = await store.claim(1); assert.equal(retry.key, thirdKey); assert(await store.dispatch(retry));
  await store.recordReceipt(retry, { status: 429 });
  assert(await store.finish(retry, { code: 'REPORT_IMAGE_RATE_LIMITED', disposition: 'RETRY', receipt: { status: 429 } }));
  assert.equal(await store.claim(1), null);
  for (let attempt = 2; attempt <= 6; attempt++) {
    await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.report_image_job SET available_at=clock_timestamp()-interval '1 second' WHERE key=$1", thirdKey);
    retry = await store.claim(1); assert.equal(retry.attempts, attempt); await store.dispatch(retry);
    await store.recordReceipt(retry, { status: 429 }); await store.finish(retry, { code: 'REPORT_IMAGE_RATE_LIMITED', disposition: 'RETRY' });
  }
  assert.equal((await fixture.admin.$queryRawUnsafe('SELECT state FROM atlas_manual_connected.report_image_job WHERE key=$1', thirdKey))[0].state, 'FAILED');
  checks.push('crash after dispatch becomes UNKNOWN without reissue; late receipt is retained; explicit rejected-request retry backs off and stops after six attempts');
  const fourth = await publish(), fourthKey = await store.enqueue(fourth.row, 'FRONT', source('d'), REPORT_IMAGE_RECIPE);
  const retiring = await store.claim(1); assert.equal(retiring.key, fourthKey); await store.dispatch(retiring);
  const tombstone = randomUUID();
  await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_manual_intake.discard_request(owner_id,request_id,request,request_hash,receipt,receipt_hash)
    VALUES($1::uuid,$2::uuid,'{}',$3,'{}',$3)`, principal.id, tombstone, digest('{}'));
  await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_manual_intake.discarded_card(owner_id,create_request_id,card_id,request_id)
    VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid)`, principal.id, fourth.createId, fourth.row.card_id, tombstone);
  assert.equal(await store.renew(retiring), false); assert.equal(await store.finish(retiring, { result: { invalid: true } }), false);
  assert(await store.recordReceipt(retiring, { providerRequestId: 'req_retired', usage: { output_tokens: 30 } }));
  assert.equal(await store.ready(fourth.row, 'FRONT'), null);
  const after = await fixture.admin.$queryRawUnsafe('SELECT * FROM atlas_manual.publication WHERE card_id=ANY($1::uuid[]) ORDER BY card_id', before.map(x => x.card_id));
  assert.deepEqual(after, before);
  const [permissions] = await fixture.admin.$queryRawUnsafe(`SELECT has_table_privilege('atlas_fixture_manual','atlas_manual_connected.report_image_job','DELETE') can_delete,
    has_column_privilege('atlas_fixture_manual','atlas_manual_connected.report_image_job','recipe','UPDATE') can_rewrite_recipe`);
  assert.deepEqual(permissions, { can_delete: false, can_rewrite_recipe: false });
  checks.push('retirement fences publication/adoption while retaining late paid outcome receipts; immutable approved publications and narrow grants remain unchanged');
  const evidence = { status: 'REPORT_IMAGES_POSTGRES_PASS', providerCalls: 0, productionDataEffects: false, checks };
  await writeFile(join(output, 'report-images-postgres.json'), JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(evidence));
} finally { await connection.close(); await fixture.stop(); }
