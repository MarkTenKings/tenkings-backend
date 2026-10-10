// Owned local PostgreSQL only. Synthetic ledger evidence, no provider calls.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { PrismaClient } from '../../../frontend/atlas-app/.generated/staff-database/index.js';
import { createOwnedManualFixture } from '../../atlas-manual-service/scripts/owned-fixture.mjs';
import { createMachineStaffBoundary } from '@atlas/manual-service/machine-auth';
import { canonical, digest } from '@atlas/manual-service/contract';
import { createVariantAdmission } from '../src/variant-admission.mjs';
import { variantWorkerRoleSQL, variantWorkerGrantSQL } from '../src/variant-worker-grants.mjs';

const output = process.env.ATLAS_VARIANT_ADMISSION_EVIDENCE;
assert(output && resolve(output) === output);
await mkdir(output, { recursive: true, mode: 0o700 });
const fixture = await createOwnedManualFixture(process.argv.slice(2));
const connection = fixture.connect();
let workerClient, result;
try {
  const { auth, boundary, repository } = connection;
  const boot = await auth.bootstrap(''), browser = `${fixture.config.cookies.browser}=${boot.browserToken}`;
  const challenge = await auth.send(browser, boot.csrf, { phone: '+12025550141', requestId: randomUUID() }, 'admission-fixture');
  const verified = await auth.verify(browser, boot.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'admission-fixture');
  const staff = await auth.authenticate(`${browser}; ${fixture.config.cookies.session}=${verified.token}`, verified.csrf);
  const principal = await boundary.transaction(staff, async ({ principal }) => principal);
  const role = 'atlas_fixture_variant_admission', password = randomBytes(24).toString('hex');
  await fixture.cluster.sql(variantWorkerRoleSQL(role), [], fixture.database.name);
  await fixture.cluster.sql(`ALTER ROLE "${role}" LOGIN PASSWORD '${password}'`, [], fixture.database.name);
  await fixture.cluster.sql(variantWorkerGrantSQL(role), [], fixture.database.name);
  const url = new URL(fixture.database.adminUrl);
  url.username = role; url.password = password; url.searchParams.set('schema', 'atlas_manual'); url.searchParams.set('connection_limit', '1');
  workerClient = new PrismaClient({ datasources: { db: { url: url.href } }, errorFormat: 'minimal' });
  const machine = createMachineStaffBoundary({ boundary, auth, manualClient: workerClient });
  const admission = createVariantAdmission({ boundary: machine });
  const db = fixture.admin, checks = [], providerBinding = digest('synthetic offline provider');
  const unknown = { state: 'UNKNOWN', responseRef: null, resultRef: null, responseHash: null,
    providerRequestId: null, responseId: null, httpStatus: null, usage: null, code: 'DEFECT_ANALYSIS_OUTCOME_UNKNOWN' };
  async function card() {
    const id = randomUUID(), createId = randomUUID();
    await db.$executeRawUnsafe(`INSERT INTO atlas_manual_intake.card(id,pair_id,owner_id,create_request_id,create_request_hash,label)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,'Synthetic admission fixture')`, id, randomUUID(), principal.id, createId, digest(createId));
    await repository.provision(staff, { cardId: id, draft: { source: { sourceHash: digest(id) }, identityRevision: 1 } });
    return { id, createId };
  }
  async function prepare({ expired = false, target = null, replaces = null, version = 'atlas-astra-defect-analysis-v2' } = {}) {
    const c = target ?? await card(), id = randomUUID(), created = new Date(Date.now() - (expired ? 86400000 : 0));
    const expires = new Date(created.getTime() + 180000), evidence = canonical({ version, model: 'gpt-6-astra', providerBindingHash: providerBinding });
    const run = { id, actionId: id, card: c, requestHash: digest(id), responseId: `resp_${id.replaceAll('-', '')}` };
    await db.$executeRawUnsafe(`INSERT INTO atlas_defect_analysis.run
      (id,card_id,action_id,actor_id,base_hash,binding,binding_hash,request_hash,request_ref,request_evidence,evidence_hash,state,created_at,expires_at,replaces_analysis_id,replaces_outcome_hash)
      VALUES($1::uuid,$2::uuid,$1::uuid,$3::uuid,$4,'{}',$5,$6,'{}',$7,$8,'PREPARED',$9::timestamptz,$10::timestamptz,$11::uuid,$12)`,
    id, c.id, principal.id, digest('base'), digest('{}'), run.requestHash, evidence, digest(evidence), created, expires,
    replaces?.id ?? null, replaces ? digest(canonical(unknown)) : null);
    return run;
  }
  async function dispatch(run) {
    await db.$executeRawUnsafe("UPDATE atlas_defect_analysis.run SET state='DISPATCHED',dispatched_at=created_at+interval '1 millisecond' WHERE id=$1::uuid", run.id);
    return run;
  }
  async function outcome(run) {
    await db.$queryRawUnsafe("SELECT atlas_defect_analysis.append_receipt($1::uuid,$2,'OUTCOME',$3)", run.id, run.requestHash, canonical(unknown));
    return run;
  }
  async function response(run) {
    const reply = { state: 'REFUSED', responseRef: { sha256: digest('synthetic response') }, resultRef: null,
      responseHash: digest('synthetic response'), providerRequestId: null, responseId: run.responseId,
      httpStatus: 400, usage: null, code: 'SYNTHETIC_TERMINAL_RESPONSE' };
    await db.$queryRawUnsafe("SELECT atlas_defect_analysis.append_receipt($1::uuid,$2,'RESPONSE',$3)", run.id, run.requestHash, canonical(reply));
  }
  async function refuse(run) {
    await db.$executeRawUnsafe(`INSERT INTO atlas_defect_analysis.request_refusal(card_id,action_id,analysis_id,actor_id,base_hash,code)
      VALUES($1::uuid,$2::uuid,$2::uuid,$3::uuid,$4,'DEFECT_ANALYSIS_REQUEST_EXPIRED')`, run.card.id, run.id, principal.id, digest('base'));
  }
  async function accepted(run) {
    const now = Date.now(), event = { responseId: run.responseId, providerRequestId: null, httpStatus: 202,
      providerStatus: 'in_progress', model: 'gpt-6-astra', responseHash: digest('synthetic acceptance'),
      receivedAt: new Date(now).toISOString(), pollUntil: new Date(now + 600000).toISOString() };
    await db.$queryRawUnsafe("SELECT atlas_defect_analysis.append_provider_event($1::uuid,$2,$3,'ACCEPTED',$4)",
      run.id, run.requestHash, providerBinding, canonical(event));
  }
  async function discard(c) {
    const request = randomUUID();
    await db.$executeRawUnsafe(`INSERT INTO atlas_manual_intake.discard_request(owner_id,request_id,request,request_hash,receipt,receipt_hash)
      VALUES($1::uuid,$2::uuid,'{}',$3,'{}',$3)`, principal.id, request, digest('{}'));
    await db.$executeRawUnsafe(`INSERT INTO atlas_manual_intake.discarded_card(owner_id,create_request_id,card_id,request_id)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid)`, principal.id, c.createId, c.id, request);
  }
  async function immutableHistory() {
    const [row] = await db.$queryRawUnsafe(`SELECT jsonb_build_object(
      'runs',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]'::jsonb) FROM atlas_defect_analysis.run r),
      'receipts',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY analysis_id,kind),'[]'::jsonb) FROM atlas_defect_analysis.receipt r),
      'events',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY analysis_id,kind),'[]'::jsonb) FROM atlas_defect_analysis.provider_event r),
      'refusals',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY card_id,action_id),'[]'::jsonb) FROM atlas_defect_analysis.request_refusal r),
      'discards',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY card_id),'[]'::jsonb) FROM atlas_manual_intake.discarded_card r))::text AS value`);
    return row.value;
  }
  async function expect(label, allowed, options) {
    const before = await immutableHistory();
    assert.equal(await admission(options), allowed, label);
    assert.equal(await immutableHistory(), before, `${label}: admission never changes retained history`);
    checks.push(label);
  }

  await expect('idle restricted-role observation admits', true);
  const prepared = await prepare();
  await expect('unexpired PREPARED blocks', false);
  await expect('only exact own recheck action is excluded', true, { actionId: prepared.id });
  await expect('unrelated recheck action cannot bypass priority', false, { actionId: randomUUID() });
  await refuse(prepared); await expect('explicit undispatched refusal releases priority', true);
  await prepare({ expired: true }); await expect('expired PREPARED alone is not active', true);

  for (const expired of [false, true]) {
    const current = await outcome(await dispatch(await prepare({ expired })));
    await expect(`${expired ? 'expired' : 'fresh'} current UNKNOWN remains blocking`, false);
    const unrelated = await dispatch(await prepare({ target: current.card })); await response(unrelated);
    await expect('a newer terminal analysis does not implicitly supersede UNKNOWN', false);
    await response(current); await expect('terminal RESPONSE releases only its exact run', true);
  }
  for (const mode of ['discarded', 'replaced', 'discarded-and-replaced']) {
    for (const expired of [false, true]) {
      const parent = await outcome(await dispatch(await prepare({ expired, version: 'atlas-astra-defect-analysis-v1' })));
      if (mode.includes('replaced')) {
        const successor = await prepare({ target: parent.card, replaces: parent });
        await expect('explicit successor is independently active while PREPARED', false);
        await refuse(successor);
      }
      if (mode.includes('discarded')) await discard(parent.card);
      await expect(`${expired ? 'expired' : 'fresh'} ${mode} unaccepted dispatch ${expired ? 'releases' : 'retains'} priority`, expired);
      await response(parent);
    }
  }
  for (const mode of ['discarded', 'replaced', 'discarded-and-replaced']) {
    const parent = await outcome(await dispatch(await prepare({ expired: true })));
    if (mode.includes('replaced')) await refuse(await prepare({ target: parent.card, replaces: parent }));
    if (mode.includes('discarded')) await discard(parent.card);
    // Late provider acceptance after explicit replacement is conservatively active.
    await accepted(parent); await expect(`ACCEPTED remains blocking after expired ${mode}`, false);
    await response(parent); await expect('accepted terminal RESPONSE releases priority', true);
  }

  const identificationCard = await card(), identificationId = randomUUID();
  await db.$executeRawUnsafe(`INSERT INTO atlas_manual_connected.identification(id,card_id,source_hash,actor_id,state,input)
    VALUES($1::uuid,$2::uuid,$3,$4::uuid,'RUNNING','{}')`, identificationId, identificationCard.id, digest(identificationId), principal.id);
  await expect('nondiscarded RUNNING identification blocks', false);
  await discard(identificationCard); await expect('discarded identification has no grading priority', true);

  const batchCard = await card(), batchKey = digest(randomUUID());
  await db.$executeRawUnsafe(`INSERT INTO atlas_manual_connected.batch_grading(key,card_id,source_hash,actor_id,access_version,analysis_action_id,input,input_hash)
    VALUES($1,$2::uuid,$3,$4::uuid,$5,$6::uuid,'{}',$7)`, batchKey, batchCard.id, digest('batch source'), principal.id, principal.accessVersion, randomUUID(), digest('{}'));
  await expect('current-owner QUEUED batch blocks', false);
  await db.$executeRawUnsafe("UPDATE atlas_manual_connected.batch_grading SET state='NEEDS_ATTENTION',analysis_reserved=true WHERE key=$1", batchKey);
  await expect('analysis reservation blocks independently of batch state', false);
  await db.$executeRawUnsafe('UPDATE atlas_manual_connected.batch_grading SET analysis_reserved=false WHERE key=$1', batchKey);
  await expect('settled batch with no reservation releases priority', true);
  await db.$executeRawUnsafe("UPDATE atlas_manual_connected.batch_grading SET state='RUNNING',claim_id=$2::uuid,lease_until=clock_timestamp()+interval '2 minutes' WHERE key=$1", batchKey, randomUUID());
  await expect('current-owner RUNNING batch blocks', false);
  await discard(batchCard); await expect('discarded batch is excluded by unchanged owner/discard predicate', true);

  const [privilege] = await workerClient.$queryRawUnsafe("SELECT current_user AS role,has_table_privilege(current_user,'atlas_defect_analysis.provider_event','SELECT') AS accepted_read");
  assert.equal(privilege.role, role); assert.equal(privilege.accepted_read, true);
  const [roleState] = await workerClient.$queryRawUnsafe('SELECT rolconnlimit,rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user');
  assert.equal(roleState.rolconnlimit, 1);
  assert(Object.entries(roleState).filter(([key]) => key !== 'rolconnlimit').every(([, value]) => value === false));
  const [ledger] = await db.$queryRawUnsafe('SELECT count(*)::int n FROM atlas_staff._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL');
  assert.equal(ledger.n, 79);
  result = { status: 'PASS', checks, groups: checks.length, staffMigrations: ledger.n,
    restrictedRole: true, workerRole: role, workerConnectionLimit: roleState.rolconnlimit,
    workerUnsafeAttributes: false, existingGrantsUnchanged: true, providerCalls: 0, productionCalls: 0,
    everyObservationPreservedHistory: true, fixtureDirectory: fixture.cluster.directory };
} finally {
  await workerClient?.$disconnect(); await connection.close(); await fixture.stop();
}
const cleanup = JSON.parse(await readFile(join(fixture.cluster.directory, 'cleanup.json'), 'utf8'));
assert.equal(cleanup.stoppedVerified, true);
assert.equal(cleanup.removed, 'owned regenerable database files');
await writeFile(join(output, 'result.json'), JSON.stringify({ ...result, cleanup }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ status: result.status, groups: result.groups, providerCalls: 0, productionCalls: 0, cleanup }));
