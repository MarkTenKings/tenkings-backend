import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PrismaClient } from '../../frontend/atlas-app/.generated/staff-database/index.js';
import { createOwnedManualFixture } from '../../packages/atlas-manual-service/scripts/owned-fixture.mjs';
import { createAnalysisRepository, analysisReceiptGrantSQL } from '../../packages/atlas-defect-analysis/src/repository.mjs';
import { createAnalysisExecutor, storeAnalysisRequest } from '../../packages/atlas-defect-analysis/src/executor.mjs';
import { createAstraDefectProvider } from '../../packages/atlas-defect-analysis/src/provider.mjs';
import { buildAstraContextBackgroundDefectRequest } from '../../packages/atlas-defect-analysis/src/index.mjs';
import { contextInputFixture } from '../../packages/atlas-defect-analysis/test/fixtures.mjs';
import { canonical, digest } from '../../packages/atlas-defect-analysis/src/contract.mjs';
import { retainNativeFixture, stopRetainedFixture, startRetainedFixture, readRetainedFixture, assertRetainedDatabase } from './retained-fixture.mjs';

const output = process.env.ATLAS_SCALABLE_EVIDENCE, args = process.argv.slice(2);
assert(output && resolve(output) === output); await mkdir(output, { recursive: false, mode: 0o700 });
const fixture = await createOwnedManualFixture(args);
let retained, collector, restarted = false;
const calls = [];
try {
  const role = 'atlas_fixture_retained_receipt', password = randomBytes(24).toString('hex');
  await fixture.cluster.sql(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  await fixture.cluster.sql(analysisReceiptGrantSQL(role), [], fixture.database.name);
  const collectorUrl = new URL(fixture.database.adminUrl); collectorUrl.username = role; collectorUrl.password = password;
  const input = contextInputFixture(); input.cardId = randomUUID(); input.analysisId = randomUUID();
  const prepared = buildAstraContextBackgroundDefectRequest(input), responseId = `resp_${randomUUID().replaceAll('-', '')}`;
  const provider = createAstraDefectProvider({ apiKey: 'sk-owned-fixture-never-real-provider-key', fetchImpl: async (url, options) => {
    assert.equal(options.method, 'GET'); assert.equal(url, `https://api.openai.com/v1/responses/${responseId}`); calls.push(options.method);
    return new Response(JSON.stringify({ id: responseId, model: 'gpt-6-astra', status: 'incomplete', output: [],
      error: null, incomplete_details: { reason: 'max_output_tokens' }, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }),
    { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'req_owned_retention' } });
  } });
  const requestRef = await storeAnalysisRequest(prepared, fixture.artifacts), evidence = canonical({ ...prepared.evidence, providerBindingHash: provider.bindingHash });
  const content = canonical({ fixture: 'retained acceptance' }), binding = canonical(prepared.evidence.binding);
  await fixture.admin.$executeRawUnsafe('INSERT INTO atlas_manual.card(id,revision,content,content_hash,owner_id) VALUES($1::uuid,1,$2,$3,$4::uuid)', input.cardId, content, digest(content), fixture.identities[0].id);
  await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_defect_analysis.run(id,card_id,action_id,actor_id,base_hash,binding,binding_hash,request_hash,request_ref,request_evidence,evidence_hash,state,expires_at)
    VALUES($1::uuid,$2::uuid,$1::uuid,$3::uuid,$4,$5,$6,$7,$8,$9,$10,'PREPARED',clock_timestamp()+interval '3 minutes')`,
  input.analysisId, input.cardId, fixture.identities[0].id, digest('retained-base'), binding, digest(binding), prepared.requestHash, canonical(requestRef), evidence, digest(evidence));
  await fixture.admin.$executeRawUnsafe("UPDATE atlas_defect_analysis.run SET state='DISPATCHED',dispatched_at=clock_timestamp() WHERE id=$1::uuid", input.analysisId);
  const received = Date.now();
  const ack = canonical({ responseId, providerRequestId: 'req_owned_acceptance', httpStatus: 200, providerStatus: 'queued', model: 'gpt-6-astra',
    responseHash: digest('owned-ack'), receivedAt: new Date(received).toISOString(), pollUntil: new Date(received + 1800000).toISOString() });
  await fixture.admin.$queryRawUnsafe('SELECT atlas_defect_analysis.append_provider_event($1::uuid,$2,$3,$4,$5)', input.analysisId, prepared.requestHash, provider.bindingHash, 'ACCEPTED', ack);
  const unknown = canonical({ state: 'UNKNOWN', responseRef: null, resultRef: null, responseHash: null, providerRequestId: null, responseId: null,
    httpStatus: null, usage: null, code: 'DEFECT_ANALYSIS_OUTCOME_UNKNOWN' });
  await fixture.admin.$queryRawUnsafe('SELECT atlas_defect_analysis.append_receipt($1::uuid,$2,$3,$4)', input.analysisId, prepared.requestHash, 'OUTCOME', unknown);
  const before = await fixture.admin.$queryRawUnsafe(`SELECT
    (SELECT md5(string_agg(to_jsonb(r)::text,'' ORDER BY id)) FROM atlas_defect_analysis.run r) run_hash,
    (SELECT md5(string_agg(to_jsonb(r)::text,'' ORDER BY analysis_id,kind)) FROM atlas_defect_analysis.receipt r) receipt_hash,
    (SELECT md5(string_agg(to_jsonb(r)::text,'' ORDER BY analysis_id,kind)) FROM atlas_defect_analysis.provider_event r) event_hash,
    (SELECT count(*)::int FROM atlas_staff."_prisma_migrations") migrations`);
  retained = await retainNativeFixture({ fixture, postgresBin: args[args.indexOf('--postgres-bin') + 1], pgModule: args[args.indexOf('--pg-module') + 1], output,
    context: { collectorUrl: collectorUrl.href, responseId, analysisId: input.analysisId, providerBindingHash: provider.bindingHash } });
  await fixture.admin.$disconnect(); await stopRetainedFixture(retained.record);
  assert((await stat(retained.record.data)).isDirectory());
  const loaded = await readRetainedFixture(retained.path); await startRetainedFixture(loaded); restarted = true;
  await assertRetainedDatabase(fixture.admin, loaded);
  const after = await fixture.admin.$queryRawUnsafe(`SELECT
    (SELECT md5(string_agg(to_jsonb(r)::text,'' ORDER BY id)) FROM atlas_defect_analysis.run r) run_hash,
    (SELECT md5(string_agg(to_jsonb(r)::text,'' ORDER BY analysis_id,kind)) FROM atlas_defect_analysis.receipt r) receipt_hash,
    (SELECT md5(string_agg(to_jsonb(r)::text,'' ORDER BY analysis_id,kind)) FROM atlas_defect_analysis.provider_event r) event_hash,
    (SELECT count(*)::int FROM atlas_staff."_prisma_migrations") migrations`);
  assert.deepEqual(after, before);
  collector = new PrismaClient({ datasources: { db: { url: loaded.context.collectorUrl } } });
  const forbidden = () => { throw new Error('No browser, dispatch, authorization or adoption capability'); };
  const repository = createAnalysisRepository({ boundary: { transaction: forbidden }, authorize: forbidden, assertCurrent: forbidden, receiptClient: collector });
  const executor = createAnalysisExecutor({ repository, provider: { ...provider, dispatch: forbidden }, artifacts: fixture.artifacts });
  assert.equal((await executor.pending()).items[0].run.analysisId, input.analysisId);
  const result = await executor.reconcile({ analysisId: input.analysisId });
  assert.deepEqual(result, { analysisId: input.analysisId, state: 'SETTLED', outcome: 'REFUSED' });
  assert.deepEqual(calls, ['GET']); assert.equal((await executor.pending()).items.length, 0);
  await assert.rejects(collector.$queryRawUnsafe('SELECT * FROM atlas_defect_analysis.run'));
  const receipts = await fixture.admin.$queryRawUnsafe('SELECT kind,evidence FROM atlas_defect_analysis.receipt WHERE analysis_id=$1::uuid ORDER BY kind', input.analysisId);
  assert.equal(receipts.find(row => row.kind === 'OUTCOME').evidence, unknown);
  assert.equal(JSON.parse(receipts.find(row => row.kind === 'RESPONSE').evidence).responseId, responseId);
  assert.equal((await fixture.admin.$queryRawUnsafe('SELECT count(*)::int n FROM atlas_defect_analysis.run'))[0].n, 1);
  await writeFile(join(output, 'result.json'), JSON.stringify({ status: 'PASS', fullNativeClusterRetained: true,
    restartIdentityAndRowHashesMatch: true, priorUnknownReceiptUnchanged: true, actualExecutorReconciledOldAcceptance: true,
    terminalResult: 'REFUSED', providerHttpMethods: calls, realNetworkCalls: 0, paidCalls: 0, newProviderPosts: 0,
    roleCannotSelectRuns: true, retainedContext: retained.path }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ status: 'PASS', actualExecutorRecovery: true, simulatedProviderGets: calls.length, paidCalls: 0, output }));
} finally {
  await collector?.$disconnect(); await fixture.admin.$disconnect();
  if (retained) await stopRetainedFixture(retained.record); else await fixture.stop();
  await writeFile(join(output, 'cleanup.json'), JSON.stringify({ stopped: true, dataRetained: Boolean(retained), restartExercised: restarted }), { mode: 0o600 });
}
