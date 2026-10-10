import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {PrismaClient} from '../../../frontend/atlas-app/.generated/staff-database/index.js';
import {createMachineStaffBoundary} from '@atlas/manual-service/machine-auth';
import {canonical,digest} from '@atlas/manual-service/contract';
import {createVariantJobStore} from '../src/variant-job-store.mjs';
import {variantWorkerRoleSQL,variantWorkerGrantSQL} from '../src/variant-worker-grants.mjs';
import {prepareVariantListingRequest} from '../src/variant-listing-provider.mjs';

/** Runs only inside the caller's disposable cluster. Two separate cap-one
 * worker roles exercise the actual PostgreSQL lock/commit boundary. */
export async function validateListingSourceJournal({fixture,connection,store,staff,seed,review,catalog}){
 const role='atlas_fixture_variant_second',password=randomBytes(24).toString('hex');
 await fixture.cluster.sql(variantWorkerRoleSQL(role),[],fixture.database.name);
 await fixture.cluster.sql(`ALTER ROLE "${role}" LOGIN PASSWORD '${password}'`,[],fixture.database.name);
 await fixture.cluster.sql(variantWorkerGrantSQL(role),[],fixture.database.name);
 const url=new URL(fixture.database.adminUrl);url.username=role;url.password=password;url.searchParams.set('connection_limit','1');
 const client=new PrismaClient({datasources:{db:{url:url.href}},errorFormat:'minimal'});
 try{
  const second=createVariantJobStore({boundary:createMachineStaffBoundary({boundary:connection.boundary,auth:connection.auth,manualClient:client})});
  const cardA=await seed(),cardB=await seed();
  const [aliasRow]=await fixture.admin.$queryRawUnsafe('SELECT content FROM atlas_manual.card WHERE id=$1::uuid',cardB),aliasDraft=JSON.parse(aliasRow.content);
  aliasDraft.identity={...aliasDraft.identity,cardName:'MAGIKARP',productSet:'REBEL CLASH',cardNumber:'#39/0192'};aliasDraft.identityRevision++;
  await fixture.admin.$executeRawUnsafe('UPDATE atlas_manual.card SET content=$2,content_hash=$3,revision=revision+1 WHERE id=$1::uuid',cardB,canonical(aliasDraft),digest(canonical(aliasDraft)));
  assert.equal(await store.discover(),2);
  const a=await store.claim(2),b=await second.claim(2);assert.deepEqual(new Set([a.card_id,b.card_id]),new Set([cardA,cardB]));
  const request=prepareVariantListingRequest(a.input.identity);assert.deepEqual(prepareVariantListingRequest(b.input.identity),request);
  const forgedInput={...a.input,identity:{...a.input.identity,name:'Different player'}};
  await assert.rejects(store.reserveListingSource({...a,input:forgedInput},prepareVariantListingRequest(forgedInput.identity)),{code:'VARIANT_LISTING_REQUEST_CHANGED'});
  const reservations=await Promise.all([store.reserveListingSource(a,request),second.reserveListingSource(b,request)]);
  assert.deepEqual(reservations.map(r=>r.state).sort(),['RESERVED','UNKNOWN']);
  const winner=reservations.findIndex(r=>r.state==='RESERVED'),reservation=reservations[winner].reservation,original=[a,b][winner],other=[a,b][1-winner];
  const dispatchKey=`variant-listing-dispatch:v1:${request.requestKey}`,responseKey=`variant-listing-response:v1:${request.requestKey}`;
  assert.equal(await store.cache.get(dispatchKey),null,'journal TTL must never authorize a second request');
  assert.equal((await store.reserveListingSource(other,request)).state,'UNKNOWN');
  assert.equal((await fixture.admin.$queryRawUnsafe('SELECT count(*)::int n FROM atlas_manual_connected.variant_catalog_cache WHERE key=$1',dispatchKey))[0].n,1);
  await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.variant_job SET lease_until=clock_timestamp()-interval '1 second' WHERE key=$1",original.key);
  await assert.rejects(store.reserveListingSource(original,request),{code:'VARIANT_LEASE_LOST'});
  const bodyText=JSON.stringify({keyword:request.query,page:1,totalItems:0,hasNextPage:false,items:[],opaque:'é\\n"'.repeat(20000)});
  const source={schemaVersion:'variant-listing-response/v1',requestKey:request.requestKey,url:request.url,httpStatus:200,contentType:'application/json',bodyText,sha256:digest(bodyText),capturedAt:'2026-10-10T00:00:00.000Z'};
  assert(await second.saveListingSource(reservation,source),'late response survives original lease expiry');
  assert(await store.saveListingSource(reservation,source),'identical completion is idempotent');
  assert.deepEqual(await second.reserveListingSource(other,request),{state:'REUSED',source});
  await assert.rejects(store.saveListingSource(reservation,{...source,bodyText:'{}',sha256:digest('{}')}),{code:'VARIANT_LISTING_RESPONSE_CONFLICT'});
  await assert.rejects(store.saveListingSource(reservation,{...source,bodyText:'x'.repeat(1048577),sha256:digest('x'.repeat(1048577))}),{code:'VARIANT_EVIDENCE_BODY_TOO_LARGE'});
  await assert.rejects(store.saveListingSource({...reservation,dispatchId:randomUUID()},source),{code:'VARIANT_LISTING_RESERVATION_CHANGED'});
  const [stored]=await fixture.admin.$queryRawUnsafe('SELECT snapshot,snapshot_hash FROM atlas_manual_connected.variant_catalog_cache WHERE key=$1',responseKey);
  assert.equal(JSON.parse(stored.snapshot).bodyText,bodyText);assert.equal(digest(stored.snapshot),stored.snapshot_hash);
  assert.equal(await store.cache.get(responseKey),null);await assert.rejects(store.cache.put(dispatchKey,{expiresAt:'2099-01-01T00:00:00Z'}),{code:'VARIANT_LISTING_JOURNAL_RESERVED'});
  const recovered=await store.claim(2);assert.equal(recovered.key,original.key);
  for(const job of [recovered,other]){assert(await store.saveCatalog(job,catalog));assert(await store.finish(job,{result:{catalog,suggestion:{candidateId:null,confidence:null,reason:'Owned fixture'}}}));}
  const ready=await review.status(staff,original.card_id),refreshed=await review.refresh(staff,original.card_id,{requestId:randomUUID(),sourceHash:ready.sourceHash,identityRevision:ready.identityRevision,identityHash:ready.identityHash,jobId:ready.jobId});
  const fresh=await second.claim(1);assert.equal(fresh.key,refreshed.jobId);assert.deepEqual(await second.reserveListingSource(fresh,request),{state:'REUSED',source});
  assert(await second.finish(fresh,{state:'FAILED',code:'SYNTHETIC_CASE_FINISHED'}));
  const [audit]=await fixture.admin.$queryRawUnsafe("SELECT count(*) FILTER(WHERE event->>'event'='LISTING_DISPATCH')::int dispatches,count(*) FILTER(WHERE event->>'event'='LISTING_RESPONSE')::int responses FROM atlas_manual_connected.variant_job j CROSS JOIN LATERAL jsonb_array_elements(j.audit) event WHERE event->>'requestKey'=$1",request.requestKey);
  assert.deepEqual(audit,{dispatches:1,responses:1});
  const jobs=await fixture.admin.$queryRawUnsafe('SELECT dispatch_id,response,result FROM atlas_manual_connected.variant_job WHERE key=ANY($1::text[])',[a.key,b.key,fresh.key]);assert(jobs.every(j=>j.dispatch_id===null&&j.response===null),'listing journal never occupies photo-model fields');
  const staleCard=await seed();await store.discover();const stale=await store.claim(1);
  const [row]=await fixture.admin.$queryRawUnsafe('SELECT content FROM atlas_manual.card WHERE id=$1::uuid',staleCard),draft=JSON.parse(row.content);draft.identityRevision++;
  await fixture.admin.$executeRawUnsafe('UPDATE atlas_manual.card SET content=$2,content_hash=$3,revision=revision+1 WHERE id=$1::uuid',staleCard,canonical(draft),digest(canonical(draft)));
  await assert.rejects(store.reserveListingSource(stale,request),{code:'VARIANT_LEASE_LOST'});
  // A fresh active claim must also stop when its original owner's access
  // version changes, even though the server process retains its own role.
  await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.variant_job SET lease_until=clock_timestamp()-interval '1 second' WHERE key=$1",stale.key);
  const revokedCard=await seed();await store.discover();const revoked=await store.claim(1);assert.equal(revoked.card_id,revokedCard);
  await fixture.admin.$executeRawUnsafe('UPDATE atlas_staff."StaffIdentity" SET "accessVersion"="accessVersion"+1 WHERE id=$1::uuid',revoked.actor_id);
  await assert.rejects(store.reserveListingSource(revoked,prepareVariantListingRequest(revoked.input.identity)),{code:'VARIANT_LEASE_LOST'});
  return ['two cap-one restricted PostgreSQL clients reserve one shared canonical identity despite case/collector aliases; expired/uncertain journal never repurchases',
   'late exact raw response survives lease expiry, duplicate save is idempotent, conflicting/oversized/forged completion refuses',
   'same-identity physical card and explicit refresh reuse retained source; model fields stay empty; changed identity, forged input, revoked access and expired lease reject dispatch'];
 }finally{await client.$disconnect();}
}
