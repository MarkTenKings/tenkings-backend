// Finite, nonce-owned synthetic PostgreSQL only; no provider or production URL.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { disposablePostgres } from '../../../frontend/atlas-app/scripts/disposable-postgres.mjs';
import { applyStandaloneBaseline, applyStandaloneMigrations } from '../migrate.mjs';
import { standaloneRoleSQL } from '../grants.mjs';
import { canonical, digest } from '../../atlas-manual-service/src/contract.mjs';
import { REPORT_IMAGE_RECIPE, reportImageRecipeHash } from '../../atlas-connected-manual/src/report-image-provider.mjs';
import { createReportImageStore } from '../../atlas-connected-manual/src/report-image-store.mjs';
import { createGradingPhotoReader } from '../../atlas-connected-manual/src/grading-photo-reader.mjs';

const args = process.argv.slice(2), output = process.env.ATLAS_IMAGE_RETRY_EVIDENCE;
assert(output && resolve(output) === output); await mkdir(output, { recursive: true, mode: 0o700 });
const { Client } = createRequire(import.meta.url)(args[args.indexOf('--pg-module') + 1]);
const cluster = await disposablePostgres(args), clients = [], checks = [];
const connect = async (role = null, password = null) => { const url = new URL(cluster.url('atlas_image_retry'));
  if (role) { url.username = role; url.password = password; } const client = new Client({ connectionString: url.href });
  await client.connect(); clients.push(client); return client; };
let evidence;
try {
  await cluster.sql('CREATE DATABASE atlas_image_retry'); const admin = await connect();
  assert.equal((await applyStandaloneBaseline(admin)).status, 'APPLIED');
  const initial = (await admin.query('SELECT * FROM atlas_staff._standalone_migrations')).rows;
  const migrations = await applyStandaloneMigrations(admin); assert.equal(migrations.applied.length, 2);
  assert.equal((await applyStandaloneMigrations(admin)).status, 'NO_OP'); assert.equal((await applyStandaloneBaseline(admin)).status, 'NO_OP');
  assert.deepEqual((await admin.query('SELECT * FROM atlas_staff._standalone_migrations WHERE version=$1', [initial[0].version])).rows, initial);
  checks.push('registered baseline→003 and repeated no-op retain original baseline bytes and receipt');
  const roles = { staff: 'atlas_image_staff', manual: 'atlas_image_main', variant: 'atlas_image_worker', customer: 'atlas_image_customer', customerPrivate: 'atlas_image_private' };
  await admin.query(standaloneRoleSQL(roles));
  const password = randomBytes(24).toString('hex'); await admin.query(`ALTER ROLE ${roles.manual} LOGIN PASSWORD '${password}'`);
  const main = await connect(roles.manual, password), concurrent = await connect(roles.manual, password);
  const signature = 'atlas_manual_connected.retry_report_image(uuid,integer,uuid,uuid,uuid,text,text,uuid,text)';
  for (const role of Object.values(roles)) assert.equal((await admin.query("SELECT has_function_privilege($1,$2,'EXECUTE') allowed", [role, signature])).rows[0].allowed, role === roles.manual);
  checks.push('retry EXECUTE is main-only; worker, staff and customer roles cannot call it');
  const actor = randomUUID(), other = randomUUID();
  for (const id of [actor, other]) await admin.query('INSERT INTO atlas_staff."StaffIdentity"(id,"phoneHash",role) VALUES($1,$2,\'REVIEWER\')', [id, digest(id)]);
  const tx = { $queryRawUnsafe: async (sql, ...values) => (await main.query(sql, values)).rows,
    $executeRawUnsafe: async (sql, ...values) => (await main.query(sql, values)).rowCount };
  const store = createReportImageStore({ boundary: { machineTransaction: async (_, work) => {
    await main.query('BEGIN'); try { const result = await work({ tx, principal: { mode: 'LOCAL_FIXTURE' } }); await main.query('COMMIT'); return result; }
    catch (error) { await main.query('ROLLBACK'); throw error; }
  } } });
  const recipeHash = reportImageRecipeHash(REPORT_IMAGE_RECIPE);
  const row = async key => (await admin.query('SELECT * FROM atlas_manual_connected.report_image_job WHERE key=$1', [key])).rows[0];
  const seed = async ({ status = 400, state = 'FAILED', attempts = 1, outputField = false, missingResponse = false, changedReceipt = false, side = 'BACK', cardId = null } = {}) => {
    const card = cardId ?? randomUUID(), upload = randomUUID(), sourceHash = digest(card + side), originalHash = digest(upload), key = digest(card + upload), failed = randomUUID();
    if (!cardId) await admin.query('INSERT INTO atlas_manual_intake.card(id,pair_id,owner_id,create_request_id,create_request_hash,label) VALUES($1,$2,$3,$4,$5,\'Synthetic image retry\')', [card, randomUUID(), actor, randomUUID(), digest(card)]);
    const plan = canonical({ expected: { sha256: originalHash } }), saved = '{}';
    await admin.query(`INSERT INTO atlas_manual_intake.upload(id,card_id,request_id,actor_id,request,request_hash,side,version,plan,plan_hash,verification,verification_hash,source,source_hash)
      VALUES($1,$2,$3,$4,$5,$6,$9,1,$7,$8,$5,$6,$5,$6)`, [upload, card, randomUUID(), actor, saved, digest(saved), plan, digest(plan), side]);
    await admin.query(`UPDATE atlas_manual_intake.card SET ${side === 'FRONT' ? 'front' : 'back'}_upload_id=$2,${side === 'FRONT' ? 'front' : 'back'}_version=1,revision=revision+1 WHERE id=$1`, [card, upload]);
    const frame = { raster: { content: { sha256: sourceHash } } }, media = canonical({ descriptor: frame, frame, original: { uploadId: upload, binding: { cardId: card, side }, content: { sha256: originalHash } } });
    const receipt = { status, execution: 'OPENAI_IMAGES_API', model: REPORT_IMAGE_RECIPE.model, promptVersion: REPORT_IMAGE_RECIPE.promptVersion,
      promptSha256: digest(REPORT_IMAGE_RECIPE.prompt), sourceSha256: sourceHash, recipeHash, clientRequestId: failed, ...(outputField ? { outputSha256: digest('accepted output') } : {}) };
    const audit = [{ event: 'REQUESTED', requestId: failed }, ...(!missingResponse ? [{ event: 'RESPONSE', requestId: failed, receipt }] : []),
      { event: state, requestId: failed, code: 'REPORT_IMAGE_REQUEST_REJECTED', receipt: changedReceipt ? { ...receipt, sourceSha256: digest('other') } : receipt }];
    const result = state === 'READY' ? canonical({ fixture: 'retained ready output' }) : null;
    await admin.query(`INSERT INTO atlas_manual_connected.report_image_job(key,source_hash,recipe_hash,recipe,mode,source_card_id,source_media,source_media_hash,state,attempts,audit,code,result,result_hash)
      VALUES($1,$2,$3,$4,'LOCAL_FIXTURE',$5,$6,$7,$8,$9,$10,'REPORT_IMAGE_REQUEST_REJECTED',$11,$12)`,
    [key, sourceHash, recipeHash, canonical(REPORT_IMAGE_RECIPE), card, media, digest(media), state, attempts, JSON.stringify(audit), result, result ? digest(result) : null]);
    await admin.query("INSERT INTO atlas_manual_connected.card_image_intent(upload_id,card_id,mode) VALUES($1,$2,'LOCAL_FIXTURE')", [upload, card]);
    await admin.query("INSERT INTO atlas_manual_connected.card_image_binding(upload_id,card_id,side,original_sha256,job_key) VALUES($1,$2,$5,$3,$4)", [upload, card, originalHash, key, side]);
    return { card, upload, key, failed, receipt, args: [actor, 1, randomUUID(), card, upload, side, key, failed, recipeHash] };
  };
  const call = (client, values) => client.query('SELECT atlas_manual_connected.retry_report_image($1,$2,$3,$4,$5,$6,$7,$8,$9) receipt', values);
  const x = await seed({ attempts: 30 }), before = await row(x.key);
  const front = await seed({ cardId: x.card, side: 'FRONT', status: 200, state: 'READY' }), actionId = randomUUID(), document = '{"fixture":"existing human work"}';
  await admin.query('INSERT INTO atlas_manual.card(id,revision,content,content_hash,owner_id) VALUES($1,1,$2,$3,$4)', [x.card, document, digest(document), actor]);
  await admin.query('INSERT INTO atlas_manual.action(card_id,action_id,actor_id,expected_revision,result_revision,request_hash,request,result) VALUES($1,$2,$3,1,2,$4,$5,$5)', [x.card, actionId, actor, digest(document), document]);
  await admin.query('INSERT INTO atlas_manual.approval(card_id,action_id,actor_id,source_revision,source_hash,report_hash,report) VALUES($1,$2,$3,1,$4,$4,$5)', [x.card, actionId, actor, digest(document), document]);
  const preserved = async () => { const result = {};
    for (const [name, sql] of Object.entries({ intake: 'SELECT * FROM atlas_manual_intake.card WHERE id=$1', uploads: 'SELECT * FROM atlas_manual_intake.upload WHERE card_id=$1 ORDER BY id',
      manual: 'SELECT * FROM atlas_manual.card WHERE id=$1', actions: 'SELECT * FROM atlas_manual.action WHERE card_id=$1 ORDER BY action_id',
      approvals: 'SELECT * FROM atlas_manual.approval WHERE card_id=$1 ORDER BY action_id', bindings: 'SELECT * FROM atlas_manual_connected.card_image_binding WHERE card_id=$1 ORDER BY side' }))
      result[name] = digest(JSON.stringify((await admin.query(sql, [x.card])).rows));
    result.front = digest(JSON.stringify(await row(front.key))); return result;
  };
  const preservedBefore = await preserved();
  const reader = createGradingPhotoReader({ photo: store.photo, storage: { readDecodedFrame() { assert.fail('status may not read pixels'); } } });
  const status = await reader.photoStatus({ cardId: x.card, uploadId: x.upload, side: 'BACK' });
  assert.equal(status.rejection.failedRequestId, x.failed); assert.deepEqual(await row(x.key), before);
  assert.deepEqual(await preserved(), preservedBefore);
  checks.push('real stored status reads exact rejection without any job/card/source/manual/approval/Front writes');
  for (const [index, value] of [[0, other], [1, 2], [4, randomUUID()], [5, 'FRONT'], [7, randomUUID()], [8, digest('wrong recipe')]]) {
    await assert.rejects(call(main, x.args.map((entry, i) => i === index ? value : entry)), /ACCESS_DENIED|UNAVAILABLE|EVIDENCE_INVALID/);
  }
  await assert.rejects(main.query("UPDATE atlas_manual_connected.report_image_job SET state='QUEUED',code='REPORT_IMAGE_RETRY_REQUESTED' WHERE key=$1", [x.key]), /immutable/);
  await assert.rejects(main.query("UPDATE atlas_manual_connected.report_image_job SET audit=audit||'[ {\"event\":\"RETRY_REQUESTED\",\"attemptBase\":30} ]'::jsonb WHERE key=$1", [x.key]), /immutable/);
  checks.push('wrong actor/access/upload/side/recipe/predecessor, direct terminal update and forged retry audit refused');
  const [one, two] = await Promise.all([call(main, x.args), call(concurrent, x.args)]);
  assert.deepEqual(one.rows, two.rows); const acknowledged = one.rows[0].receipt, queued = await row(x.key);
  assert.equal(queued.state, 'QUEUED'); assert.equal(queued.attempts, 30); assert.equal(acknowledged.attemptBase, 30);
  assert.deepEqual(queued.audit.slice(0, -1), before.audit);
  for (const key of ['source_hash', 'recipe_hash', 'recipe', 'source_media', 'source_media_hash', 'created_at']) assert.deepEqual(queued[key], before[key]);
  assert.deepEqual(await preserved(), preservedBefore);
  await assert.rejects(call(main, x.args.map((entry, i) => i === 2 ? randomUUID() : entry)), /UNAVAILABLE/);
  checks.push('concurrent identical intent commits once; exact source/recipe/audit preserved; competing UUID cannot repeat predecessor');
  let claim = await store.claim(1, recipeHash); assert.equal(claim.key, x.key); assert.equal(claim.attempts, 31);
  assert(await store.dispatch(claim)); assert.equal(await store.claim(1, recipeHash), null);
  const secondReceipt = { ...x.receipt, clientRequestId: claim.claim_id };
  assert(await store.recordReceipt(claim, secondReceipt)); assert(await store.finish(claim, { code: 'REPORT_IMAGE_REQUEST_REJECTED', receipt: secondReceipt }));
  assert.equal(await store.claim(1, recipeHash), null);
  assert.deepEqual(await preserved(), preservedBefore);
  assert.deepEqual((await call(main, x.args)).rows[0].receipt, acknowledged);
  assert.equal((await row(x.key)).state, 'FAILED');
  const nextArgs = x.args.map((entry, i) => i === 2 ? randomUUID() : i === 7 ? claim.claim_id : entry);
  await call(main, nextArgs); claim = await store.claim(1, recipeHash); assert.equal(claim.attempts, 32);
  for (let attempt = 1; attempt <= 6; attempt++) {
    assert(await store.dispatch(claim)); const rate = { ...x.receipt, status: 429, clientRequestId: claim.claim_id };
    assert(await store.recordReceipt(claim, rate)); assert(await store.finish(claim, { code: 'REPORT_IMAGE_RATE_LIMITED', disposition: 'RETRY', receipt: rate }));
    if (attempt < 6) { await admin.query("UPDATE atlas_manual_connected.report_image_job SET available_at=clock_timestamp()-interval '1 second' WHERE key=$1", [x.key]); claim = await store.claim(1, recipeHash); assert(claim); }
  }
  const exhausted = await row(x.key); assert.equal(exhausted.state, 'FAILED'); assert.equal(exhausted.attempts, 37); assert(exhausted.audit.length > 20);
  assert.equal(await store.claim(1, recipeHash), null);
  checks.push('real claim/dispatch/finish allows lifetime attempts>6/audit>20, stops400 immediately and bounds each explicit429 allowance to6');
  for (const options of [{ status: 200 }, { status: 500 }, { status: 408 }, { state: 'UNKNOWN' }, { state: 'READY' }, { outputField: true }, { missingResponse: true }, { changedReceipt: true }]) {
    const invalid = await seed(options); await assert.rejects(call(main, invalid.args), /UNAVAILABLE|EVIDENCE_INVALID/); assert.equal((await row(invalid.key)).state, options.state ?? 'FAILED');
  }
  checks.push('accepted/uncertain/output-bearing/missing/mismatched response evidence never purchases a successor');
  const crash = await seed(); await call(main, crash.args); const pending = await store.claim(1, recipeHash); assert.equal(pending.key, crash.key); assert(await store.dispatch(pending));
  await admin.query("UPDATE atlas_manual_connected.report_image_job SET lease_until=clock_timestamp()-interval '1 second' WHERE key=$1", [crash.key]);
  assert.equal(await store.claim(1, recipeHash), null); assert.equal((await row(crash.key)).state, 'UNKNOWN');
  await assert.rejects(call(main, crash.args.map((entry, i) => i === 2 ? randomUUID() : entry)), /UNAVAILABLE/);
  assert.equal((await call(main, crash.args)).rows[0].receipt.requestId, crash.args[2]);
  checks.push('crash after dispatch settles UNKNOWN; exact acknowledgment remains readable with no new edit authority');
  evidence = { status: 'REPORT_IMAGE_RETRY_POSTGRES_PASS', groups: checks.length, checks, migrations: migrations.applied,
    ledger: (await admin.query('SELECT version,checksum FROM atlas_staff._standalone_migrations ORDER BY version')).rows, providerCalls: 0, productionQueries: 0 };
} finally { for (const client of clients.reverse()) await client.end().catch(() => {}); await cluster.stop(); }
evidence.cleanup = JSON.parse(await readFile(resolve(cluster.directory, 'cleanup.json'), 'utf8'));
assert.equal(evidence.cleanup.stoppedVerified, true);
await writeFile(resolve(output, 'result.json'), JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 }); console.log(JSON.stringify(evidence));
