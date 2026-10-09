// Finite owned local PostgreSQL qualification. No existing DB/provider is accepted.
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
import { createManualFinishing } from '../src/finishing.mjs';
import { createPresentationRepository, presentationGrantSQL } from '../src/presentation-repository.mjs';
import { createPresentationMarketService } from '../src/presentation-market-service.mjs';
import { createMarketJobStore, marketJobGrantSQL, recordApprovalMarket } from '../src/market-job-store.mjs';
import { createMarketWorker } from '../src/market-worker.mjs';
import { publishedMarketQuery } from '../src/presentation-market.mjs';
import { EBAY_SOLD_COMPS_V2_ENGINE_VERSION } from '@tenkings/ebay-sold-comps-v2';
import { publicationFixture } from '../test/publication-fixture.mjs';
import { validateMarketRuntimeConfiguration } from '../../../frontend/atlas-app/lib/server/connected-manual-runtime.mjs';

const output = process.env.ATLAS_MARKET_JOBS_EVIDENCE;
assert(output && resolve(output) === output, 'Absolute owned evidence directory required');
await mkdir(output, { recursive: true, mode: 0o700 });
const fixture = await createOwnedManualFixture(process.argv.slice(2)), connection = fixture.connect();
try {
  for (const grant of [machineGrantSQL, intakeGrantSQL, publicationGrantSQL, presentationGrantSQL, marketJobGrantSQL])
    await fixture.cluster.sql(grant('atlas_fixture_manual'), [], fixture.database.name);
  const { auth, boundary, manualClient } = connection;
  async function login(phone) {
    const boot = await auth.bootstrap(''), browser = `${fixture.config.cookies.browser}=${boot.browserToken}`;
    const challenge = await auth.send(browser, boot.csrf, { phone, requestId: randomUUID() }, 'market-jobs-fixture');
    const verified = await auth.verify(browser, boot.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'market-jobs-fixture');
    return auth.authenticate(`${browser}; ${fixture.config.cookies.session}=${verified.token}`, verified.csrf);
  }
  const staff = await login('+12025550141'), other = await login('+12025550142');
  const principal = await boundary.transaction(staff, async ({ principal }) => principal);
  const otherPrincipal = await boundary.transaction(other, async ({ principal }) => principal);
  const machine = createMachineStaffBoundary({ boundary, auth, manualClient });
  const store = createMarketJobStore({ boundary: machine }), checks = [];
  await validateMarketRuntimeConfiguration({marketAutomaticEnabled:true,client:manualClient});
  for(const permission of ['SELECT','INSERT',...['state','attempts','recoveries','claim_id','lease_until','dispatch_id','public_hash','response','response_hash','code','available_at','updated_at','audit'].map(column=>`UPDATE(${column})`)]) {
    await fixture.cluster.sql(`REVOKE ${permission} ON atlas_manual_connected.market_job FROM atlas_fixture_manual`,[],fixture.database.name);
    await assert.rejects(validateMarketRuntimeConfiguration({marketAutomaticEnabled:true,client:manualClient}),{code:'MARKET_QUEUE_GRANTS_REQUIRED'},permission);
    await fixture.cluster.sql(marketJobGrantSQL('atlas_fixture_manual'),[],fixture.database.name);
  }
  await validateMarketRuntimeConfiguration({marketAutomaticEnabled:true,client:manualClient});
  checks.push('startup rejects SELECT-only, INSERT-only and each missing mutable-column UPDATE grant against the actual restricted PostgreSQL role');
  const pubRepo = createPublicationRepository({ boundary: machine });
  const artifacts = new Map();
  const storeArtifacts = {
    async read(ref, expected, options) { return artifacts.get(expected.cardId).read(ref, expected, options); },
    async write(value, expected, options) { return artifacts.get(expected.cardId).write(value, expected, options); },
  };
  const publishServices = new Map();
  const publication = { publish: (actor, cardId, actionId) => publishServices.get(cardId).publish(actor, cardId, actionId) };
  const approved = createManualFinishing({ repository: pubRepo, artifacts: storeArtifacts });
  const presentationRepo = createPresentationRepository({ boundary: machine, keyPrefix: 'market-fixture' });
  let providerCalls = 0;
  const provider = async input => {
    providerCalls++;
    const { buildEbaySoldCompsV2Query } = await import('@tenkings/ebay-sold-comps-v2');
    return { source: 'EBAY_SOLD', engineVersion: EBAY_SOLD_COMPS_V2_ENGINE_VERSION, query: buildEbaySoldCompsV2Query(input), retrievedAt: new Date().toISOString(), candidates: [] };
  };
  const worker = createMarketWorker({ store, approved, publication, artifacts: storeArtifacts, provider,
    authorityFor: job => machine.machineOwner({ ownerId: job.actor_id, accessVersion: job.access_version }), concurrency: 2 });
  const service = createPresentationMarketService({ repository: presentationRepo, approved, artifacts: storeArtifacts, provider, jobs: store, worker });
  async function approve({ enqueue = true, publish = false } = {}) {
    const pub = await publicationFixture(), createId = randomUUID(); artifacts.set(pub.cardId, pub.artifacts);
    await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_manual_intake.card(id,pair_id,owner_id,create_request_id,create_request_hash,label)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,'Synthetic market job qualification')`, pub.cardId, randomUUID(), principal.id, createId, digest(createId));
    const repository = createManualRepository({ boundary, approvalCommitted: async context => {
      await pubRepo.approvalCommitted(context); if (enqueue) await recordApprovalMarket(context);
    } });
    await repository.provision(staff, { cardId: pub.cardId, draft: pub.draft });
    const service = createManualService({ repository, reduce: ({ card }) => card.draft, buildReport: async () => pub.approval });
    const input = { actionId: pub.actionId, expectedRevision: 1, action: { type: 'APPROVE_REPORT', reportHash: pub.row.report_hash, reviewed: true } };
    const first = await service.execute(staff, pub.cardId, input);
    assert.deepEqual(await service.execute(staff, pub.cardId, input), first);
    const publisher = createManualPublication({ repository: pubRepo, artifacts: pub.artifacts, storage: pub.storage,
      readSource: async (_staff, _id, upload) => ({ photo: pub.photos[upload.side] }) });
    publishServices.set(pub.cardId, publisher);
    if (publish) await publisher.publish(staff, pub.cardId, pub.actionId);
    return { ...pub, createId };
  }
  const a = await approve();
  assert.equal((await service.status(staff, a.cardId)).state, 'QUEUED'); assert.equal(providerCalls, 0);
  assert.equal(Number((await fixture.admin.$queryRawUnsafe('SELECT count(*) n FROM atlas_manual_connected.market_job'))[0].n), 1);
  await assert.rejects(service.preview(staff, a.cardId, {requestId:randomUUID(),approvalActionId:a.actionId,expectedRevision:0}), {code:'MARKET_SEARCH_IN_PROGRESS'});
  const approvedBefore = await fixture.admin.$queryRawUnsafe('SELECT * FROM atlas_manual.approval WHERE card_id=$1::uuid', a.cardId);
  await worker.drainOnce();
  assert.equal((await service.status(staff, a.cardId)).state, 'READY'); assert.equal(providerCalls, 1);
  assert.deepEqual(await fixture.admin.$queryRawUnsafe('SELECT * FROM atlas_manual.approval WHERE card_id=$1::uuid', a.cardId), approvedBefore);
  await worker.drainOnce(); assert.equal(providerCalls, 1);
  await assert.rejects(service.status(other, a.cardId), {code:'MANUAL_CARD_NOT_FOUND'});
  await fixture.admin.$executeRawUnsafe('UPDATE atlas_manual.card SET readers=ARRAY[$2::uuid],revision=revision+1 WHERE id=$1::uuid', a.cardId, otherPrincipal.id);
  assert.equal((await service.status(other, a.cardId)).preview.candidates.length, 0);
  await assert.rejects(service.preview(other, a.cardId, {requestId:randomUUID(),approvalActionId:a.actionId,expectedRevision:0}), {code:'MANUAL_CARD_ACCESS_DENIED'});
  checks.push('atomic exact approval replay creates one job; cold GETs; worker recovers pending publication; one provider call; unchanged approval bytes; cross-session reader discovery and write denial');

  const b = await approve({publish:true}), c = await approve({publish:true});
  const claims = [];
  for (let i=0;i<2;i++) { let job; while (!(job=await store.claim(2))) {} claims.push(job); }
  assert.equal(await store.claim(2), null);
  for (const job of claims) {
    const source = await approved.loadPacket(staff, job.card_id, job.approval_action_id); assert(await store.bind(job, source));
    assert(await store.dispatch(job));
  }
  const lost = claims[0], saved = claims[1];
  const savedSource = await approved.loadPacket(staff, saved.card_id, saved.approval_action_id);
  const savedResult = { source:'EBAY_SOLD',engineVersion:EBAY_SOLD_COMPS_V2_ENGINE_VERSION,query:publishedMarketQuery(savedSource).query,retrievedAt:new Date().toISOString(),candidates:[] };
  assert(await store.recordResponse(saved, savedResult));
  await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.market_job SET lease_until=clock_timestamp()-interval '1 second' WHERE request_id=ANY($1::uuid[])", claims.map(x=>x.request_id));
  assert.equal(await store.finish(lost,{code:'STALE',disposition:'RETRY'}),false);
  const restart = createMarketJobStore({boundary:machine});
  const reclaimed = await restart.claim(2); assert.equal(reclaimed.request_id,saved.request_id); assert(reclaimed.response);
  assert.equal((await store.latest(staff,lost.card_id)).state,'UNKNOWN');
  await assert.rejects(service.preview(staff,lost.card_id,{requestId:randomUUID(),approvalActionId:lost.approval_action_id,expectedRevision:0}),{code:'MARKET_OUTCOME_RECONCILIATION_REQUIRED'});
  await restart.finish(reclaimed,{code:'RETRY_LOCAL',disposition:'RETRY'});
  await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.market_job SET available_at=clock_timestamp()-interval '1 second' WHERE request_id=$1::uuid",saved.request_id);
  await worker.drainOnce(); assert.equal(providerCalls,1); assert.equal((await service.status(staff,saved.card_id)).state,'READY');
  assert(await store.recordResponse(lost,savedResult));
  await worker.drainOnce(); assert.equal(providerCalls,1); // Response query differs only if fixture identity differs; never a repurchase either way.
  checks.push('global concurrent claim cap; lease fencing; crash after dispatch stays UNKNOWN; saved/late responses resume local processing with zero paid redispatch');

  const d=await approve({publish:true}), job=await store.claim(1); assert.equal(job.card_id,d.cardId);
  await store.bind(job,await approved.loadPacket(staff,d.cardId,d.actionId)); await store.dispatch(job);
  await store.finish(job,{code:'PROVIDER_REQUEST_LIMITED',disposition:'RETRY'});
  assert.equal(await store.claim(1),null);
  for(let attempt=2;attempt<=6;attempt++) {
    await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.market_job SET available_at=clock_timestamp()-interval '1 second' WHERE request_id=$1::uuid",job.request_id);
    const next=await store.claim(1); assert.equal(next.attempts,attempt); await store.dispatch(next); await store.finish(next,{code:'PROVIDER_REQUEST_LIMITED',disposition:'RETRY'});
  }
  assert.equal((await store.latest(staff,d.cardId)).state,'FAILED');
  await assert.rejects(manualClient.$executeRawUnsafe("UPDATE atlas_manual_connected.market_job SET state='QUEUED' WHERE request_id=$1::uuid",job.request_id),/immutable/);
  await assert.rejects(manualClient.$executeRawUnsafe('UPDATE atlas_manual_connected.market_job SET report_hash=$2 WHERE request_id=$1::uuid',job.request_id,'f'.repeat(64)),/permission denied/);
  checks.push('typed refusal retries back off and stop at six; terminal/binding immutability and narrow grants hold');

  const localRetry=await approve({publish:true}), localJob=await store.claim(1);
  assert.equal(localJob.card_id,localRetry.cardId);
  const localSource=await approved.loadPacket(staff,localRetry.cardId,localRetry.actionId);
  await store.bind(localJob,localSource);await store.dispatch(localJob);
  await store.recordResponse(localJob,{source:'EBAY_SOLD',engineVersion:EBAY_SOLD_COMPS_V2_ENGINE_VERSION,query:publishedMarketQuery(localSource).query,retrievedAt:new Date().toISOString(),candidates:[]});
  await store.finish(localJob,{code:'MARKET_PROCESSING_INTERRUPTED',disposition:'FAILED'});
  assert.equal((await service.status(staff,localRetry.cardId)).refreshAction,'RETRY_SAVED_RESPONSE');
  const retryInput={requestId:randomUUID(),approvalActionId:localRetry.actionId,expectedRevision:0};
  const queuedRetry=await service.preview(staff,localRetry.cardId,retryInput);
  assert.equal(queuedRetry.previewId,localRetry.actionId);assert.equal(queuedRetry.requestId,retryInput.requestId);
  assert.deepEqual(await service.preview(staff,localRetry.cardId,retryInput),queuedRetry);
  await worker.drainOnce();assert.equal(providerCalls,1);assert.equal((await service.status(staff,localRetry.cardId)).state,'READY');
  await assert.rejects(manualClient.$executeRawUnsafe("UPDATE atlas_manual_connected.market_job SET audit='[]'::jsonb WHERE request_id=$1::uuid",localRetry.actionId),/immutable/);
  checks.push('explicit processing retry is idempotently aliased to original preview, retains immutable response/audit and never purchases a second search');

  const legacy=await approve({enqueue:false,publish:true}),legacyInput={requestId:randomUUID(),approvalActionId:legacy.actionId,expectedRevision:0};
  await presentationRepo.reserveMarket(staff,legacy.cardId,legacyInput);
  await presentationRepo.finishMarket(staff,legacy.cardId,legacyInput.requestId,{state:'UNAVAILABLE',reason:'PROVIDER_CONFIGURATION_ERROR'});
  const legacyPlan=await store.backfillPlan({refreshLegacyApprovalIds:[legacy.actionId]});
  assert.equal(legacyPlan.entries.find(x=>x.approvalActionId===legacy.actionId).disposition,'REFRESH_LEGACY_SEARCH');
  const legacyApplied=await store.backfill(legacyPlan.planHash,{refreshLegacyApprovalIds:[legacy.actionId]});
  assert.equal(legacyApplied.queued.length,1);assert.notEqual(legacyApplied.queued[0].previewId,legacyInput.requestId);
  assert.equal((await presentationRepo.market(staff,legacy.cardId,legacyInput.requestId)).state,'UNAVAILABLE');
  await worker.drainOnce();assert.equal(providerCalls,2);
  checks.push('explicit reviewed legacy refresh has deterministic separate request while old market record remains byte-preserved');

  const missing=await approve({enqueue:false,publish:true}), plan=await store.backfillPlan();
  assert.equal(plan.entries.filter(x=>x.disposition==='QUEUE_MISSING').length,1); assert.equal(providerCalls,2);
  await assert.rejects(store.backfill('a'.repeat(64)),{code:'MARKET_BACKFILL_PLAN_CHANGED'});
  const backfill=await store.backfill(plan.planHash); assert.equal(backfill.queued.length,1); assert.equal(backfill.queued[0].previewId,missing.actionId);
  const nextPlan=await store.backfillPlan(); assert.equal(nextPlan.entries.filter(x=>x.disposition==='QUEUE_MISSING').length,0);
  assert.equal(providerCalls,2);
  const revoked=await approve({publish:true});
  const tombstone=randomUUID();
  await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_manual_intake.discard_request(owner_id,request_id,request,request_hash,receipt,receipt_hash)
    VALUES($1::uuid,$2::uuid,'{}',$3,'{}',$3)`,principal.id,tombstone,digest('{}'));
  await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_manual_intake.discarded_card(owner_id,create_request_id,card_id,request_id)
    VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid)`,principal.id,revoked.createId,revoked.cardId,tombstone);
  await worker.drainOnce();
  assert.equal((await fixture.admin.$queryRawUnsafe('SELECT state,code FROM atlas_manual_connected.market_job WHERE request_id=$1::uuid',revoked.actionId))[0].code,'MARKET_APPROVAL_NO_LONGER_ACTIVE');
  checks.push('read-only backfill reports only missing searches; exact-plan apply queues without provider; saved previews retained; lost approval access ends obsolete queue explicitly');
  const expired=await approve({publish:true}),expiredJob=await store.claim(1);
  assert.equal(expiredJob.card_id,expired.cardId);
  const expiredSource=await approved.loadPacket(staff,expired.cardId,expired.actionId);
  await store.bind(expiredJob,expiredSource);await store.dispatch(expiredJob);
  await store.recordResponse(expiredJob,{source:'EBAY_SOLD',engineVersion:EBAY_SOLD_COMPS_V2_ENGINE_VERSION,query:publishedMarketQuery(expiredSource).query,retrievedAt:new Date(Date.now()-48*60*60*1000).toISOString(),candidates:[]});
  await store.finish(expiredJob,{code:'MARKET_PROCESSING_INTERRUPTED',disposition:'RETRY'});
  await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.market_job SET available_at=clock_timestamp()-interval '1 second' WHERE request_id=$1::uuid",expiredJob.request_id);
  const callsBeforeExpiry=providerCalls;await worker.drainOnce();assert.equal(providerCalls,callsBeforeExpiry);
  const expiredStatus=await service.status(staff,expired.cardId);
  assert.equal(expiredStatus.state,'FAILED');assert.equal(expiredStatus.reason,'MARKET_PREVIEW_EXPIRED');assert.equal(expiredStatus.refreshAction,'SEARCH_AGAIN');assert.equal(expiredStatus.refreshable,true);
  const expiredHistory=await fixture.admin.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.market_job WHERE request_id=$1::uuid',expiredJob.request_id);
  const expiredMarket=await fixture.admin.$queryRawUnsafe('SELECT * FROM atlas_manual.presentation_market WHERE card_id=$1::uuid AND request_id=$2::uuid',expired.cardId,expiredJob.request_id);
  const freshInput={requestId:randomUUID(),approvalActionId:expired.actionId,expectedRevision:0};
  const freshQueued=await service.preview(staff,expired.cardId,freshInput);assert.equal(freshQueued.previewId,freshInput.requestId);assert.notEqual(freshQueued.previewId,expiredJob.request_id);
  assert.deepEqual(await service.preview(staff,expired.cardId,freshInput),freshQueued);
  await worker.drainOnce();await worker.drainOnce();assert.equal(providerCalls,callsBeforeExpiry+1);
  assert.equal((await service.status(staff,expired.cardId)).state,'READY');
  assert.deepEqual(await fixture.admin.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.market_job WHERE request_id=$1::uuid',expiredJob.request_id),expiredHistory);
  assert.deepEqual(await fixture.admin.$queryRawUnsafe('SELECT * FROM atlas_manual.presentation_market WHERE card_id=$1::uuid AND request_id=$2::uuid',expired.cardId,expiredJob.request_id),expiredMarket);
  checks.push('conclusively expired retained response permits one explicitly requested new search identity; replay dedupes and old response/audit/market bytes stay unchanged');
  await worker.stop();
  const evidence={version:'atlas-market-jobs-postgres-v1',synthetic:true,providerCalls,checks,productionTouched:false,paidProviderCalls:0};
  await writeFile(join(output,'result.json'),JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify(evidence));
} finally { await fixture.stop(); }
