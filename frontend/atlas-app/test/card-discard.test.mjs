import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, webcrypto } from 'node:crypto';
import { createWorkspaceDiscarder, discardKey, clearDiscardedCommands } from '../lib/card-discard.mjs';
const clone = structuredClone;
function fixture(count=2) {
  const staffId=randomUUID(), values=new Map(), calls=[], receipts=new Map(), retired=[];
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  let batch={version:1,items:Array.from({length:count},()=>({createId:randomUUID(),cardId:randomUUID(),done:true,files:null})),draft:{id:randomUUID(),files:{FRONT:new Blob(['original'])}}};
  let pending=batch.items.map(item=>({id:randomUUID(),value:{kind:'upload',cardId:item.cardId,input:{side:'FRONT'},file:new Blob(['native'])}}));
  let lost=false,failCleanup=false,locked=false,paused=0,drained=true;
  const server=new Map(batch.items.map(item=>[item.createId,item.cardId]));
  const deletedCreates=new Set(),deletedCards=new Set();
  const batchJournal={getMetadata:async()=>clone(batch),get:async()=>assert.fail('Deletion must not materialize photo bytes'),
    retire:async value=>{if(failCleanup){failCleanup=false;throw Error('device write failed');}retired.push(clone(value));batch.items=batch.items.filter(item=>!value.createRequestIds.includes(item.createId)&&!value.cardIds.includes(item.cardId));if(batch.draft?.id===value.draftId)batch.draft=null;}};
  const intakeJournal={list:async options=>{assert.equal(options.metadataOnly,true);return clone(pending);},
    retire:async value=>{pending=pending.filter(item=>!value.cardIds.includes(item.value.cardId));}};
  const request=async(path,{body})=>{
    assert.ok(drained,'drain before any remote request');calls.push({path,body:clone(body)});
    if(path.endsWith('/discard-status'))return {createRequestIds:body.createRequestIds.filter(id=>deletedCreates.has(id)),cardIds:body.cardIds.filter(id=>deletedCards.has(id))};
    assert.ok(storage.getItem(discardKey(staffId)),'exact intent saved before dispatch');
    const prior=receipts.get(body.requestId);if(prior){assert.deepEqual(prior.body,body);return {receipt:clone(prior.receipt)};}
    const creates=new Set(body.createRequestIds),cards=new Set(body.cardIds);
    for(const [createId,cardId] of server)if(body.scope==='ALL'||creates.has(createId)||cards.has(cardId)){creates.add(createId);cards.add(cardId);}
    const receipt={requestId:body.requestId,scope:body.scope,createRequestIds:[...creates],cardIds:[...cards],discardedAt:new Date().toISOString()};
    creates.forEach(id=>deletedCreates.add(id));cards.forEach(id=>deletedCards.add(id));receipts.set(body.requestId,{body:clone(body),receipt});
    if(lost){lost=false;throw Error('lost acknowledgement');}return {receipt:clone(receipt)};
  };
  const locks={request:async(_name,_options,work)=>{if(locked)return work(null);locked=true;try{return await work({});}finally{locked=false;}}};
  const f={staffId,storage,values,calls,receipts,server,deletedCreates,deletedCards,retired,batchJournal,intakeJournal,
    get batch(){return batch;},get pending(){return pending;},get paused(){return paused;},
    lose:()=>{lost=true;},failCleanup:()=>{failCleanup=true;},pause:async()=>{paused++;drained=true;},resume:()=>{paused--;},
    controller:()=>createWorkspaceDiscarder({staffId,request:(...args)=>f.request(...args),batchJournal,intakeJournal,storage,locks,cryptoImpl:webcrypto,pause:()=>f.pause(),resume:()=>f.resume()})};
  f.request=request;return f;
}
test('lost ALL acknowledgement retains both originals and replays one frozen request after reload',async()=>{
  const f=fixture(),original=clone(f.batch);f.lose();await assert.rejects(f.controller().discard(),/lost acknowledgement/);
  assert.deepEqual(f.batch,original);assert.equal(f.pending.length,2);assert.equal(f.retired.length,0);
  const saved=JSON.parse(f.storage.getItem(discardKey(f.staffId))),lateCreate=randomUUID(),lateCard=randomUUID();f.server.set(lateCreate,lateCard);
  await f.controller().recover();
  assert.equal(f.receipts.size,1);assert.deepEqual(f.calls[1].body,saved.requests[0].body);
  assert.equal(f.deletedCards.has(lateCard),false);assert.equal(f.batch.items.length,0);assert.equal(f.batch.draft,null);assert.equal(f.pending.length,0);
  assert.equal(f.storage.getItem(discardKey(f.staffId)),null);
});
test('partial local cleanup reload reuses the durable receipt without another server mutation',async()=>{
  const f=fixture();f.failCleanup();await assert.rejects(f.controller().discard(),/device write failed/);
  assert.equal(f.pending.length,0);assert.equal(f.batch.items.length,2);assert.ok(JSON.parse(f.storage.getItem(discardKey(f.staffId))).requests[0].receipt);
  await f.controller().recover();assert.equal(f.calls.length,1);assert.equal(f.batch.items.length,0);
});
test('selected deletion preserves the other card and partial capture',async()=>{
  const f=fixture(),[first,second]=clone(f.batch.items),draft=clone(f.batch.draft);
  await f.controller().discard({scope:'SELECTED',cardIds:[first.cardId]});
  assert.deepEqual(f.batch.items,[second]);assert.deepEqual(f.batch.draft,draft);assert.equal(f.pending.length,1);
  assert.deepEqual(f.calls[0].body.createRequestIds,[first.createId]);
});
test('more than100 saved pairs use one persisted ALL request followed by bounded SELECTED requests',async()=>{
  const f=fixture(205);await f.controller().discard();
  assert.deepEqual(f.calls.map(call=>call.body.scope),['ALL','SELECTED','SELECTED']);
  assert.ok(f.calls.every(call=>call.body.createRequestIds.length<=100&&call.body.cardIds.length<=100));assert.equal(f.batch.items.length,0);
});
test('invalid acknowledgement cannot discard any original or clear the recovery intent',async()=>{
  const f=fixture();f.request=async()=>({receipt:{requestId:randomUUID(),scope:'ALL',createRequestIds:[],cardIds:[],discardedAt:new Date().toISOString()}});
  await assert.rejects(f.controller().discard(),{code:'INTAKE_DISCARD_REPLY_INVALID'});
  assert.equal(f.pending.length,2);assert.equal(f.batch.items.length,2);assert.equal(f.retired.length,0);assert.ok(f.storage.getItem(discardKey(f.staffId)));
});
test('status reconciliation removes confirmed completed entries but never infers deletion from absence',async()=>{
  const f=fixture(),[first,second]=clone(f.batch.items);f.deletedCreates.add(first.createId);f.deletedCards.add(first.cardId);
  await f.controller().reconcile();assert.deepEqual(f.batch.items,[second]);assert.equal(f.batch.draft!==null,true);assert.equal(f.pending.length,1);
  assert.ok(f.calls.every(call=>call.path.endsWith('/discard-status')));
});
test('exact card command cleanup preserves another staff identity, a mixed enqueue and finishing receipts',()=>{
  const f=fixture(),[first,second]=f.batch.items,key=`atlas-batch-enqueue:${f.staffId}`;
  f.storage.setItem(key,JSON.stringify({actionId:randomUUID(),cards:[{cardId:first.cardId},{cardId:second.cardId}]}));
  const own=`atlas-connected-command:${f.staffId}:${first.cardId}`,other=`atlas-connected-command:other:${first.cardId}`,finishing=`atlas-finishing:${f.staffId}:${first.cardId}`;
  for(const k of [own,other,finishing])f.storage.setItem(k,'retained');
  clearDiscardedCommands(f.storage,f.staffId,[first.cardId]);assert.equal(f.storage.getItem(own),null);assert.ok(f.storage.getItem(key));
  assert.equal(f.storage.getItem(other),'retained');assert.equal(f.storage.getItem(finishing),'retained');
  clearDiscardedCommands(f.storage,f.staffId,[first.cardId,second.cardId]);assert.equal(f.storage.getItem(key),null);
});
test('deletion intent is durable before waiting for in-flight work and blocks a second tab',async()=>{
  const f=fixture();let release,entered;const started=new Promise(resolve=>entered=resolve);f.pause=()=>{entered();return new Promise(resolve=>release=resolve);};
  const first=f.controller().discard();await started;assert.ok(f.storage.getItem(discardKey(f.staffId)));assert.equal(f.calls.length,0);
  await assert.rejects(f.controller().discard(),{code:'INTAKE_DISCARD_BUSY'});release();await first;assert.equal(f.receipts.size,1);
});

test('definite atomic refusal keeps originals and clears only an uncommitted deletion intent',async()=>{
  for(const [code,status]of [['INTAKE_CARD_HAS_COMMITTED_OBLIGATIONS',409],['INTAKE_CARD_NOT_FOUND',404]]){
    const f=fixture(),original=clone(f.batch);f.request=async()=>{throw {code,status};};
    await assert.rejects(f.controller().discard(),{code,status});assert.deepEqual(f.batch,original);assert.equal(f.pending.length,2);
    assert.equal(f.storage.getItem(discardKey(f.staffId)),null);assert.equal(f.paused,0);
  }
});
test('a later refused chunk retains earlier acknowledged progress and all remaining originals',async()=>{
  const f=fixture(101),request=f.request;let calls=0;
  f.request=async(...args)=>{if(++calls===2)throw {code:'INTAKE_CARD_HAS_COMMITTED_OBLIGATIONS',status:409};return request(...args);};
  await assert.rejects(f.controller().discard(),{code:'INTAKE_CARD_HAS_COMMITTED_OBLIGATIONS'});
  const saved=JSON.parse(f.storage.getItem(discardKey(f.staffId)));assert.ok(saved.requests[0].receipt);assert.equal(saved.requests[1].receipt,undefined);
  assert.equal(f.batch.items.length,101);assert.equal(f.pending.length,101);
});
