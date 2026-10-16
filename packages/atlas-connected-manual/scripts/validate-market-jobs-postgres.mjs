// Finite owned local PostgreSQL qualification. No existing DB/provider is accepted.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
import { qualifyMarketReliability } from './market-reliability-postgres.mjs';

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
  let providerCalls = 0, paginate = false; const providerRequests = [];
  const provider = async (input, { page = 1 } = {}) => {
    providerCalls++; providerRequests.push({ query: input.queryOverride, page });
    const items = !paginate ? [] : (page === 1 ? ['123456789012'] : ['123456789012','123456789013']).map((id,index) => ({
      id: `atlas-sale:${page}:${index}`, providerItemId: id, title: `Synthetic raw listing ${id}`,
      listingUrl: `https://www.ebay.com/itm/${id}`, imageUrl: null, soldDate: '2026-09-01', soldPriceCents: 1234,
      currency: 'USD', reportedPrice: '12.34', priceBasis: 'EXACT' }));
    return { source: 'EBAY_SOLD', engineVersion: EBAY_SOLD_COMPS_V2_ENGINE_VERSION, query: input.queryOverride,
      retrievedAt: new Date().toISOString(), responsePolicy:'ATLAS_SLAB_V1', items,
      pagination: { page, pageSize: 240, hasNextPage: paginate && page === 1, totalResults: String(items.length) },
      acquisitionDiagnostics:{returnedItemCount:items.length,retainedItemCount:items.length,missingImageCount:items.length} };
  };
  const worker = createMarketWorker({ store, approved, publication, artifacts: storeArtifacts, provider, labelMarket:async({response})=>({...response,imageMatch:{policy:'atlas-market-slab-label-v1',readings:response.items.map(item=>({rowId:item.id,sha256:null,evidenceKind:'RAW',gradingCompany:null,numericGrade:null,labelText:null,identityMatch:'UNCERTAIN',reason:'Synthetic raw card evidence.'})),counts:{}}}),
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
  const savedResult = { source:'EBAY_SOLD',engineVersion:EBAY_SOLD_COMPS_V2_ENGINE_VERSION,query:publishedMarketQuery(savedSource).query,retrievedAt:new Date().toISOString(),offset:0,nextOffset:0,requestedResultCount:240,hasMore:false,responsePolicy:'ATLAS_SLAB_V1',items:[],acquisitionDiagnostics:{returnedItemCount:0,retainedItemCount:0,missingImageCount:0} };
  savedResult.items = [0,1].map(index => ({id:`atlas-sale:${index}`,title:'Synthetic retained sale',listingUrl:null,imageUrl:null,
    soldDate:null,reportedPrice:null,soldPriceCents:null,currency:null,priceBasis:'UNKNOWN'}));
  savedResult.acquisitionDiagnostics = {returnedItemCount:2,retainedItemCount:2,missingImageCount:2};
  assert(await store.recordResponse(saved, savedResult));
  const progress = {returned:2,completed:1,failed:0,unknown:0,unavailable:0,pending:1};
  await assert.rejects(async()=>store.recordProgress(saved,{...progress,pending:-1}),{code:'MARKET_PROGRESS_INVALID'});
  await assert.rejects(store.recordProgress(saved,{...progress,returned:3,pending:2}),{code:'MARKET_PROGRESS_SOURCE_MISMATCH'});
  assert.equal(await store.recordProgress({...saved,claim_id:randomUUID()},progress),false);
  assert(await store.recordProgress(saved,progress));
  assert.deepEqual((await service.status(staff,saved.card_id)).progress,progress);
  assert(await store.recordProgress(saved,{...progress,completed:0,pending:2}));
  assert.deepEqual((await service.status(staff,saved.card_id)).progress,progress);
  assert.equal((await store.latest(staff,saved.card_id)).audit.filter(event=>event.event==='LABEL_PROGRESS').length,1);
  assert.equal(providerCalls,1,'Progress and retained-pool status do not dispatch paid searches');
  checks.push('restricted-role progress update is exact-response/claim-bound, monotonic, read-only on GET, and does not replace final preview');
  await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.market_job SET lease_until=clock_timestamp()-interval '1 second' WHERE request_id=ANY($1::uuid[])", claims.map(x=>x.request_id));
  assert.equal(await store.finish(lost,{code:'STALE',disposition:'RETRY'}),false);
  assert.equal(await store.recordProgress(saved,{...progress,completed:2,pending:0}),false);
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
  await store.recordResponse(localJob,{source:'EBAY_SOLD',engineVersion:EBAY_SOLD_COMPS_V2_ENGINE_VERSION,query:publishedMarketQuery(localSource).query,retrievedAt:new Date().toISOString(),offset:0,nextOffset:0,requestedResultCount:240,hasMore:false,responsePolicy:'ATLAS_SLAB_V1',items:[],acquisitionDiagnostics:{returnedItemCount:0,retainedItemCount:0,missingImageCount:0}});
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
  const oldResponse={source:'EBAY_SOLD',engineVersion:EBAY_SOLD_COMPS_V2_ENGINE_VERSION,query:publishedMarketQuery(expiredSource).query,
    retrievedAt:new Date(Date.now()-48*60*60*1000).toISOString(),offset:0,nextOffset:0,requestedResultCount:240,hasMore:false,responsePolicy:'ATLAS_SLAB_V1',items:[],acquisitionDiagnostics:{returnedItemCount:0,retainedItemCount:0,missingImageCount:0}};
  await store.recordResponse(expiredJob,oldResponse);
  // Exercise a failure written by the previous application release.
  await store.finish(expiredJob,{code:'MARKET_PREVIEW_EXPIRED',disposition:'FAILED'});
  const callsBeforeExpiry=providerCalls,expiredStatus=await service.status(staff,expired.cardId);
  assert.equal(expiredStatus.refreshAction,'RETRY_SAVED_RESPONSE');assert.equal(expiredStatus.refreshable,true);
  const freshInput={requestId:randomUUID(),approvalActionId:expired.actionId,expectedRevision:0};
  const freshQueued=await service.preview(staff,expired.cardId,freshInput);assert.equal(freshQueued.previewId,expiredJob.request_id);
  assert.deepEqual(await service.preview(staff,expired.cardId,freshInput),freshQueued);
  await worker.drainOnce();assert.equal(providerCalls,callsBeforeExpiry);
  const recoveredStatus=await service.status(staff,expired.cardId);assert.equal(recoveredStatus.state,'READY');assert.equal(recoveredStatus.preview.retrievedAt,oldResponse.retrievedAt);
  assert.deepEqual((await store.latest(staff,expired.cardId)).response,oldResponse);
  checks.push('historical expiry failure recovers the same saved response and preview identity after days, with exact request deduplication and zero new paid searches');

  for(const name of ['reclassificationPlan','reclassify','reclassificationSource','recordReclassification'])assert.equal(name in store,false);
  const rejected=await approve({publish:true}),rejectedJob=await store.claim(1);
  const rejectedSource=await approved.loadPacket(staff,rejected.cardId,rejected.actionId);
  await store.bind(rejectedJob,rejectedSource);await store.dispatch(rejectedJob);
  const legacyResponse={source:'EBAY_SOLD',engineVersion:EBAY_SOLD_COMPS_V2_ENGINE_VERSION,query:publishedMarketQuery(rejectedSource).query,
    retrievedAt:new Date().toISOString(),offset:0,nextOffset:0,requestedResultCount:60,hasMore:false,candidates:[]};
  await store.recordResponse(rejectedJob,legacyResponse);
  await store.finish(rejectedJob,{code:'MARKET_PROCESSING_INTERRUPTED',disposition:'RETRY'});
  await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.market_job SET available_at=clock_timestamp()-interval '1 second' WHERE request_id=$1::uuid",rejectedJob.request_id);
  const beforeRetired=providerCalls;await worker.drainOnce();
  const rejectedStatus=await service.status(staff,rejected.cardId);
  assert.equal(rejectedStatus.state,'FAILED');assert.equal(rejectedStatus.reason,'MARKET_PROVIDER_POLICY_INVALID');assert.equal(rejectedStatus.refreshable,true);assert.equal(rejectedStatus.refreshAction,undefined);
  const rejectedBefore = await fixture.admin.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.market_job WHERE request_id=$1::uuid', rejectedJob.request_id);
  const rejectedRefresh = {requestId:randomUUID(),approvalActionId:rejected.actionId,expectedRevision:0};
  const rejectedQueued = await service.preview(staff,rejected.cardId,rejectedRefresh);
  assert.equal(rejectedQueued.previewId,rejectedRefresh.requestId); assert.notEqual(rejectedQueued.previewId,rejectedJob.request_id);
  assert.deepEqual(await service.preview(staff,rejected.cardId,rejectedRefresh),rejectedQueued);
  assert.equal(providerCalls,beforeRetired);
  await worker.drainOnce();assert.equal(providerCalls,beforeRetired+1);assert.equal((await service.status(staff,rejected.cardId)).state,'READY');
  assert.deepEqual(await fixture.admin.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.market_job WHERE request_id=$1::uuid',rejectedJob.request_id),rejectedBefore);
  checks.push('retired title-only provider bytes never project or dispatch; explicit staff refresh creates one new current-path request and preserves old job evidence unchanged');

  const retired=await approve({publish:true}),retiredMarker={event:'RECLASSIFY',version:'atlas-market-reclassification-v1'};
  await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.market_job SET audit=audit||$2::jsonb WHERE request_id=$1::uuid",retired.actionId,JSON.stringify([retiredMarker]));
  const retiredJob=await store.claim(1);assert.equal(retiredJob.request_id,retired.actionId);
  await store.bind(retiredJob,await approved.loadPacket(staff,retired.cardId,retired.actionId));
  await assert.rejects(async()=>store.dispatch(retiredJob),{code:'MARKET_RECLASSIFICATION_RETIRED'});
  assert.equal(await store.dispatch({...retiredJob,audit:[]}),false,'Stored marker still refuses dispatch if a caller drops its copy');
  await store.finish(retiredJob,{code:'MARKET_RECLASSIFICATION_RETIRED',disposition:'FAILED'});
  assert.equal((await service.status(staff,retired.cardId)).refreshable,true);
  const retiredBefore=await fixture.admin.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.market_job WHERE request_id=$1::uuid',retired.actionId);
  const freshRetired={requestId:randomUUID(),approvalActionId:retired.actionId,expectedRevision:0};
  assert.equal((await service.preview(staff,retired.cardId,freshRetired)).previewId,freshRetired.requestId);
  await worker.drainOnce();assert.equal(providerCalls,beforeRetired+2);
  assert.deepEqual(await fixture.admin.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.market_job WHERE request_id=$1::uuid',retired.actionId),retiredBefore);
  checks.push('historical reclassification marker permanently fences its own dispatch, while human refresh starts the current workflow using the existing approval without changing history');

  paginate=true;
  const paged=await approve({publish:true});
  const pageApproval=await fixture.admin.$queryRawUnsafe('SELECT * FROM atlas_manual.approval WHERE card_id=$1::uuid',paged.cardId);
  const beforePages=providerCalls;await worker.drainOnce();assert.equal(providerCalls,beforePages+1);
  const firstPage=await service.status(staff,paged.cardId);assert.equal(firstPage.state,'READY');assert.equal(firstPage.preview.pagination.page,1);
  const older={requestId:randomUUID(),approvalActionId:paged.actionId,expectedRevision:0,afterPreviewId:firstPage.previewId};
  const next=await service.preview(staff,paged.cardId,older);assert.equal(next.previewId,older.requestId);
  assert.deepEqual(await service.preview(staff,paged.cardId,older),next);
  const samePage=await service.preview(staff,paged.cardId,{...older,requestId:randomUUID()});assert.equal(samePage.previewId,next.previewId);
  const storedRequest=(await fixture.admin.$queryRawUnsafe('SELECT request FROM atlas_manual.presentation_market WHERE card_id=$1::uuid AND request_id=$2::uuid',paged.cardId,older.requestId))[0];
  assert.deepEqual(JSON.parse(storedRequest.request),older);
  await worker.drainOnce();assert.equal(providerCalls,beforePages+2);
  const secondPage=await service.status(staff,paged.cardId);assert.equal(secondPage.state,'READY');assert.equal(secondPage.preview.pagination.page,2);
  assert.equal(secondPage.preview.previousPreviewId,firstPage.previewId);assert.equal(secondPage.preview.candidates.length,2);
  assert.equal(secondPage.preview.counts.returned,3);assert.equal(secondPage.preview.counts.duplicates,1);assert.equal(secondPage.preview.counts.raw,2);
  assert.deepEqual(providerRequests.slice(-2).map(x=>x.page),[1,2]);assert.equal(providerRequests.at(-1).query,providerRequests.at(-2).query);
  assert.equal((await service.preview(staff,paged.cardId,{...older,requestId:randomUUID()})).previewId,older.requestId);
  await assert.rejects(service.preview(staff,paged.cardId,{...older,requestId:randomUUID(),afterPreviewId:secondPage.previewId}),{code:'MARKET_NEXT_PAGE_UNAVAILABLE'});
  await assert.rejects(service.preview(staff,a.cardId,{...older,requestId:randomUUID(),approvalActionId:a.actionId}),{code:'MARKET_NEXT_PAGE_UNAVAILABLE'});
  assert.deepEqual(await fixture.admin.$queryRawUnsafe('SELECT * FROM atlas_manual.approval WHERE card_id=$1::uuid',paged.cardId),pageApproval);
  assert.equal(Number((await fixture.admin.$queryRawUnsafe('SELECT count(*) n FROM atlas_manual.presentation WHERE card_id=$1::uuid',paged.cardId))[0].n),0);
  const selected=await service.select(staff,paged.cardId,{requestId:randomUUID(),approvalActionId:paged.actionId,expectedRevision:0,previewId:secondPage.previewId,selectedIds:[secondPage.preview.candidates[0].sale.id]});
  assert(selected);assert.equal(Number((await fixture.admin.$queryRawUnsafe('SELECT count(*) n FROM atlas_manual.presentation WHERE card_id=$1::uuid',paged.cardId))[0].n),1);
  assert.equal(providerCalls,beforePages+2);
  checks.push('actual staff grants persist afterPreviewId immutably; same-query page2 deduplicates rows and requests, retains raw choices, rejects exhausted/foreign parents, and publishes nothing before explicit human selection');
  await worker.stop();
  await qualifyMarketReliability({fixture,machine,store,staff,principal,approve,approved,publication,artifacts:storeArtifacts,checks});
  const evidence={version:'atlas-market-jobs-postgres-v1',synthetic:true,fixtureDirectory:fixture.cluster.directory,providerCalls,checks,productionTouched:false,paidProviderCalls:0};
  await writeFile(join(output,'result.json'),JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify(evidence));
} finally {
  await fixture.stop();
  await writeFile(join(output,'cleanup.json'),await readFile(join(fixture.cluster.directory,'cleanup.json')),{mode:0o600});
}
