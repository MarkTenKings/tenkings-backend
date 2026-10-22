import test from 'node:test';
import assert from 'node:assert/strict';
import { createCollectionPreferencesClient, parsePreferenceResult, preferenceInput, PREFERENCE_LIMITS } from '../lib/collection-preferences-client.mjs';
import { projectOwnershipPreferences } from '../../../packages/atlas-connected-manual/src/card-ownership-preferences-contract.mjs';
import { createPreferenceFixture, AID, CID, OTHER, prefId, TIME, rawCurrent, rawReceipt, defer } from './collection-preferences-fixture.mjs';
const input = (patch = {}) => ({ requestId: prefId(50), expectedPreferenceRevision: 0, visibility: 'PRIVATE', offersDisabled: true, ...patch });
const response = value => Response.json(value, { headers: { 'cache-control': 'private, no-store' } });
test('closed browser parser matches actual server projections across independent privacy/opt-outs and receipt states', () => {
  for (const card of [false,true]) for (const a of ['PRIVATE','PUBLIC']) for (const b of ['PRIVATE','PUBLIC']) for (const x of [false,true]) for (const y of [false,true]) {
    const raw = rawCurrent(card); Object.assign(raw.collectionPreferences,{visibility:a,offersDisabled:x}); if(card)Object.assign(raw.cardPreferences,{visibility:b,offersDisabled:y});
    const action=card?'read_card':'read_preferences', i=card?{cardId:CID}:{};
    const projected=projectOwnershipPreferences(action,raw,i,AID); assert.deepEqual(parsePreferenceResult(projected,AID,action,i),projected);
  }
  for(const action of ['set_collection_preferences','set_card_preferences']) {
    const i=input(action==='set_card_preferences'?{cardId:CID,expectedOwnershipRevision:2}:{}), raw=rawReceipt(action,i);
    for(const verb of [action,'recover_request']){const request=verb==='recover_request'?{requestId:i.requestId}:i,v=projectOwnershipPreferences(verb,raw,request,AID);assert.deepEqual(parsePreferenceResult(v,AID,verb,request),v);}
    const stale=projectOwnershipPreferences(action,{accountId:AID,observedAt:TIME,requestId:i.requestId,action,cardId:i.cardId??null,input:i,observedPreferenceRevision:3},i,AID);
    assert.deepEqual(parsePreferenceResult(stale,AID,action,i),stale);
    for(const patch of [{accountId:OTHER},{observedPreferenceRevision:0},{input:{...i,offersDisabled:false}},{requestId:prefId(99)},{outcome:'RECORDED'}])assert.throws(()=>parsePreferenceResult({...stale,...patch},AID,action,i));
    assert.throws(()=>parsePreferenceResult(stale,AID,'recover_request',{requestId:i.requestId}));
  }
  const absent=projectOwnershipPreferences('recover_request',{accountId:AID,observedAt:TIME,requestId:prefId(50),receipt:null},{requestId:prefId(50)},AID);
  assert.equal(parsePreferenceResult(absent,AID,'recover_request',{requestId:prefId(50)}).outcome,'ABSENT');
  assert.throws(()=>parsePreferenceResult(absent,AID,'set_collection_preferences',input()));
});
test('actual client→signed HTTP→qualified service uses fixed private paths, cookie credentials and exact CSRF/input',async()=>{
 const f=createPreferenceFixture(),client=createCollectionPreferencesClient({request:f.request});assert.equal(createCollectionPreferencesClient(),null);
 const current=await client.read({accountId:AID,cardId:CID});assert.equal(current.cardPreferences.ownershipRevision,2);
 const i=input({cardId:CID,expectedOwnershipRevision:2});const r=await client.write({accountId:AID,action:'set_card_preferences',input:i,csrf:f.csrf});assert.equal(r.receipt.preferenceRevision,1);
 assert.deepEqual((await client.recover({accountId:AID,requestId:i.requestId})).receipt,r.receipt);
 for(const req of f.requests){assert(!req.path.includes(AID));assert.equal(req.input.credentials,'same-origin');assert.equal(req.input.cache,'no-store');assert.equal(req.input.redirect,'error');}
 assert.equal(f.requests[1].input.headers['x-atlas-customer-csrf'],f.csrf);assert.deepEqual(JSON.parse(f.requests[1].input.body),i);
 for(const action of ['submit_claim','read_collection','propose_transfer'])assert.throws(()=>preferenceInput(action,{}));
});
test('generic statuses/malformed or foreign success never masquerade as terminal stale or recorded outcome',async()=>{
 const f=createPreferenceFixture(),raw=rawCurrent(),v=projectOwnershipPreferences('read_preferences',raw,{},AID);
 for(const r of [response({...v,accountId:OTHER}),response({...v,privateKey:'secret'}),response({...v,effective:{...v.effective,canReceiveOffers:true}}),new Response('{}',{status:409}),new Response('{}',{status:503})]){
  const c=createCollectionPreferencesClient({request:async()=>r});await assert.rejects(c.read({accountId:AID}));
 }
 for(const status of [401,403])await assert.rejects(createCollectionPreferencesClient({request:async()=>new Response('',{status})}).read({accountId:AID}),{code:'PREFERENCES_ACCESS_ENDED'});
 await assert.rejects(createCollectionPreferencesClient({request:async()=>Response.json(v)}).read({accountId:AID}));
 assert.equal(f.stats.begins,0);
});
test('bounded response stream and abort stop ignored transport/body without issuing retries',async()=>{
 for(const body of [false,true]){
  const entered=defer(),wait=defer(),controller=new AbortController();let calls=0,cancelled=0;
  const r=new Response(new ReadableStream({pull(){entered.resolve();return new Promise(()=>{});},cancel(){cancelled++;}}),{headers:{'content-type':'application/json','cache-control':'private, no-store'}});
  const client=createCollectionPreferencesClient({request:()=>{calls++;if(!body)entered.resolve();return body?r:wait.promise;}});
  const pending=client.read({accountId:AID,signal:controller.signal});await entered.promise;controller.abort();await assert.rejects(pending,{code:'PREFERENCES_CANCELLED'});
  if(!body)wait.resolve(r);await new Promise(r=>setImmediate(r));assert.equal(calls,1);assert.equal(cancelled,1);
 }
 const tooBig=Response.json({value:'x'.repeat(PREFERENCE_LIMITS.responseBytes)},{headers:{'cache-control':'private, no-store'}});
 await assert.rejects(createCollectionPreferencesClient({request:async()=>tooBig}).read({accountId:AID}));
});
test('observed noncompliant fetch times out once; future expected revision remains generic uncertainty',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const entered=defer();let calls=0;
 const c=createCollectionPreferencesClient({request:()=>{calls++;entered.resolve();return new Promise(()=>{});}});
 const pending=c.read({accountId:AID});await entered.promise;assert.equal(calls,1);t.mock.timers.tick(PREFERENCE_LIMITS.timeoutMs);await assert.rejects(pending,{code:'PREFERENCES_UNAVAILABLE'});assert.equal(calls,1);t.mock.timers.reset();
 const f=createPreferenceFixture(),real=createCollectionPreferencesClient({request:f.request});
 await assert.rejects(real.write({accountId:AID,action:'set_collection_preferences',input:input({expectedPreferenceRevision:5}),csrf:f.csrf}),{code:'PREFERENCES_UNAVAILABLE'});assert.equal(f.records.size,0);
});
