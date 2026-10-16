import test from 'node:test';
import assert from 'node:assert/strict';
import { createManualClient } from '../src/client.mjs';
import { createWorkflowHandler } from '../src/http.mjs';
import { createManualWorkflow } from '../src/workflow.mjs';
import { actionWorkspaceVersion } from '../src/action-workspace.mjs';

const cardId='11111111-1111-4111-8111-111111111111', staffId='reviewer', origin='http://127.0.0.1:4318';
const command={actionId:'22222222-2222-4222-8222-222222222222',expectedRevision:1,action:{type:'INSPECT_SIDE',side:'BACK'}};
const card=revision=>({cardId,revision,contentHash:`hash-${revision}`,draft:{geometry:{ref:`g-${revision}`},defects:{ref:`d-${revision}`},finalReview:{ref:'final'},assistance:{ref:'assistance'}}});
const view=revision=>({card:card(revision),geometry:{cardId,sides:{FRONT:{saved:revision},BACK:{saved:revision}}},defects:{cardId,sides:{FRONT:{saved:revision},BACK:{saved:revision}}},identity:{cardName:'Fixture'},images:{FRONT:{original:{sha256:'front'}},BACK:{original:{sha256:'back'}}},approval:null,finalReview:{saved:true},assistance:{saved:true},publication:{state:'NONE'},variantVerification:{enabled:true},provisional:{grade:8.5}});
const receipt=(input=command,revision=input.expectedRevision+1)=>({card:card(revision),receipt:{actionId:input.actionId,actorId:staffId,actorKind:'HUMAN',expectedRevision:input.expectedRevision,revision}});
const envelope=(input=command)=>({...receipt(input),workspace:{version:actionWorkspaceVersion,imageScope:'all',view:view(input.expectedRevision+1)}});
const response=(body,status=200)=>({status,ok:status<400,json:async()=>body});
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
function browser(fetchImpl,observers={}){
  const values=new Map(),views=[],statuses=[];
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const client=createManualClient({cardId,staffId,csrf:'csrf',storage,fetchImpl,onView:value=>{views.push(value);observers.onView?.(value);},onStatus:value=>{statuses.push(value);observers.onStatus?.(value);}});
  return {client,values,views,statuses,storage};
}

test('selected action consumes the entire authoritative response with no workspace GET, retaining metadata',async()=>{
  const requests=[];const f=browser(async(url,options)=>{
    requests.push(url);
    if(options.method==='POST'){assert.equal(options.headers['x-atlas-workspace'],'all');return response(envelope(JSON.parse(options.body)));}
    return response(view(1));
  });
  await f.client.load();const saved=await f.client.execute(command.action);
  assert.deepEqual(saved,view(2));assert.equal(requests.length,2);assert.deepEqual(f.client.current(),view(2));assert.equal(f.values.size,0);
});

for(const broken of ['missing','version','scope','card','geometry','finalReview','metadata'])test(`incomplete or mismatched ${broken} snapshot takes full authoritative GET`,async()=>{
  let reads=0,posts=0;const f=browser(async(url,options)=>{
    if(options.method!=='POST')return response(view(++reads===1?1:3));
    posts++;const result=envelope(JSON.parse(options.body));
    if(broken==='missing')delete result.workspace;
    if(broken==='version')result.workspace.version='future';
    if(broken==='scope')result.workspace.imageScope='inspection';
    if(broken==='card')result.workspace.view.card=card(1);
    if(broken==='geometry')result.workspace.view.geometry={};
    if(broken==='finalReview')delete result.workspace.view.finalReview;
    if(broken==='metadata')delete result.workspace.view.variantVerification;
    return response(result);
  });
  await f.client.load();assert.deepEqual(await f.client.execute(command.action),view(3));assert.equal(reads,2);assert.equal(posts,1);
});

for(const defect of ['actionId','actorId','actorKind','expectedRevision','revision','cardId','contentHash'])test(`invalid durable ${defect} receipt remains pending through malformed status`,async()=>{
  let posted,statusReads=0;const f=browser(async(url,options)=>{
    if(url.endsWith('/view'))return response(view(1));
    if(options.method==='POST'){
      posted=JSON.parse(options.body);const result=envelope(posted);
      if(defect==='cardId')result.card.cardId='wrong-card';
      else if(defect==='contentHash')delete result.card.contentHash;
      else result.receipt[defect]='wrong';
      return response(result);
    }
    statusReads++;return response({state:'COMMITTED'});
  });
  await f.client.load();await assert.rejects(f.client.execute(command.action),/receipt/);
  assert.equal(statusReads,1);assert.equal(f.client.hasPending(),true);assert.deepEqual(JSON.parse([...f.values.values()][0]),posted);
  assert.deepEqual(f.client.current(),view(1));
});

test('double click dispatches one action while a late pre-save read cannot overwrite the committed image/state',async()=>{
  const readStarted=deferred(),readRelease=deferred(),postStarted=deferred(),postRelease=deferred();let reads=0,posts=0;
  const f=browser(async(url,options)=>{
    if(options.method==='POST'){posts++;postStarted.resolve();await postRelease.promise;return response(envelope(JSON.parse(options.body)));}
    if(++reads===2){readStarted.resolve();await readRelease.promise;}
    return response(view(1));
  });
  await f.client.load();const oldRead=f.client.load();await readStarted.promise;
  const save=f.client.execute(command.action);await postStarted.promise;
  await assert.rejects(f.client.execute(command.action),/already in progress/);postRelease.resolve();await save;readRelease.resolve();
  assert.deepEqual(await oldRead,view(2));assert.deepEqual(f.client.current(),view(2));assert.equal(posts,1);assert.deepEqual(f.views,[view(1),view(2)]);
});

for(const status of [401,403,409,503])test(`committed save plus ${status} refresh failure permits only read recovery, including reload`,async()=>{
  let reads=0,posts=0,online=false;
  const fetchImpl=async(url,options)=>{
    if(options.method==='POST'){posts++;return response(receipt(JSON.parse(options.body)));}
    if(++reads===1)return response(view(1));
    return online?response(view(2)):response({error:status===409?'MANUAL_PHOTOS_CHANGED':'UNAVAILABLE'},status);
  };
  const f=browser(fetchImpl);await f.client.load();await assert.rejects(f.client.execute(command.action),{code:'MANUAL_SAVED_REFRESH_REQUIRED',committed:true,status});
  assert.equal(f.values.size,0);assert.equal(f.client.needsRefresh(),true);assert.equal(f.statuses.at(-1),'Saved; refreshing…');
  await assert.rejects(f.client.execute(command.action),/Refresh/);online=true;await f.client.recover();assert.equal(f.client.needsRefresh(),false);assert.equal(posts,1);
  const reloaded=createManualClient({cardId,staffId,csrf:'csrf',storage:f.storage,fetchImpl});await reloaded.recover();assert.equal(posts,1);assert.deepEqual(reloaded.current(),view(2));
});

test('stale full read after a known save cannot pair old findings with a committed revision',async()=>{
  const f=browser(async(url,options)=>response(options.method==='POST'?receipt(JSON.parse(options.body)):view(1)));
  await f.client.load();await assert.rejects(f.client.execute(command.action),{code:'MANUAL_SAVED_REFRESH_REQUIRED'});
  assert.deepEqual(f.client.current(),view(1));assert.equal(f.client.needsRefresh(),true);
});

test('observer failures never replay or reclassify a known committed action',async()=>{
  let posts=0,fail=true;const f=browser(async(url,options)=>{
    if(options.method==='POST'){posts++;return response(envelope(JSON.parse(options.body)));}return response(view(posts?2:1));
  },{onView:value=>{if(fail&&value.card.revision===2)throw Error('observer');},onStatus:()=>{throw Error('observer');}});
  await f.client.load();await assert.rejects(f.client.execute(command.action),{committed:true});assert.equal(posts,1);assert.equal(f.values.size,0);
  fail=false;await f.client.recover();assert.equal(f.client.needsRefresh(),false);assert.equal(posts,1);
});

function server({failAt=null,large=false}={}){
  const calls=[],saved=receipt();const staff={id:staffId};
  const fail=where=>{calls.push(where);if(failAt===where)throw Object.assign(Error(where),{status:401,code:'SIGN_IN_REQUIRED'});};
  const state=view(2);delete state.card;delete state.images;delete state.approval;
  const handler=createWorkflowHandler({origin,assertRequest(){fail('boundary');},boundary:{async authenticate(){fail('authenticate');return staff;}},
    workflow:{service:{async execute(){fail('commit');return saved;},async read(){fail('read');return card(2);},async latestApproval(){fail('approval');return null;}},
      async hydrate(input){assert.deepEqual(input,card(2));fail('hydrate');return {geometry:state.geometry,defects:state.defects,identity:state.identity,finalReview:state.finalReview,assistance:state.assistance};},
      async assertViewCurrent(actor,input){assert.equal(actor,staff);assert.deepEqual(input,card(2));fail('fence');}},
    async imageDescriptors(input){assert.equal(input.staff,staff);fail('images');return view(2).images;},
    async workspaceExtras(){fail('extras');return {publication:state.publication,variantVerification:state.variantVerification,provisional:state.provisional,...(large?{large:'x'.repeat(2*1024*1024)}:{})};}});
  const invoke=async({header='all',input=command,method='POST'}={})=>{
    const req={url:`/api/staff/manual/cards/${cardId}/${method==='POST'?'actions':'view'}`,method,body:input,headers:{origin,'content-type':'application/json','x-atlas-csrf':'csrf',...(header?{'x-atlas-workspace':header}:{})}};
    const res={setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;}};await handler(req,res);return res;
  };return {invoke,calls,saved};
}

test('HTTP complete optional snapshot matches the regular full view, and absent opt-in preserves original response',async()=>{
  const s=server(), enriched=await s.invoke(), full=await s.invoke({method:'GET'});
  assert.equal(enriched.code,200);assert.deepEqual(enriched.body.workspace.view,full.body);assert.deepEqual(enriched.body.workspace.view,view(2));
  const legacy=server();assert.deepEqual((await legacy.invoke({header:null})).body,legacy.saved);assert.deepEqual(legacy.calls,['boundary','authenticate','commit']);
});
for(const type of ['APPROVE_REPORT','CONFIRM_GEOMETRY','REVIEW_FINDING','DISCARD_PENDING'])test(`${type} retains original response and no optional reads`,async()=>{
  const s=server();assert.deepEqual((await s.invoke({input:{...command,action:{type}}})).body,s.saved);assert.deepEqual(s.calls,['boundary','authenticate','commit']);
});
for(const failAt of ['hydrate','approval','images','extras','fence'])test(`postcommit ${failAt} refusal preserves receipt and omits snapshot`,async()=>{
  const s=server({failAt}), result=await s.invoke();assert.equal(result.code,200);assert.deepEqual(result.body,s.saved);assert.equal(s.calls.filter(x=>x==='commit').length,1);
});
test('optional response exceeding private JSON transport limit falls back to compact committed result',async()=>{
  const s=server({large:true}), result=await s.invoke();assert.equal(result.code,200);assert.deepEqual(result.body,s.saved);
});
for(const {elapsed,budget,label} of [
  {elapsed:0,budget:5000,label:'5-second optional hydration timeout'},
  {elapsed:199000,budget:1000,label:'remaining time before the 200-second total cap'},
  {elapsed:200000,budget:0,label:'exhausted 200-second total cap'},
])test(`${label} returns one compact receipt that late hydration cannot change`,async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.parse('2026-10-16T20:00:00.000Z')});
  const hydration=deferred(),fenced=deferred(),saved=receipt(),savedBytes=JSON.stringify(saved);
  let commits=0,hydrations=0,replies=0;
  const handler=createWorkflowHandler({origin,assertRequest(){},boundary:{async authenticate(){return {id:staffId};}},
    workflow:{service:{async execute(){commits++;t.mock.timers.tick(elapsed);return saved;},async latestApproval(){return null;}},
      async hydrate(){hydrations++;return hydration.promise;},async assertViewCurrent(){fenced.resolve();}},
    async imageDescriptors(){return view(2).images;},async workspaceExtras(){return {publication:{state:'NONE'}};}});
  const req={url:`/api/staff/manual/cards/${cardId}/actions`,method:'POST',body:command,
    headers:{origin,'content-type':'application/json','x-atlas-csrf':'csrf','x-atlas-workspace':'all'}};
  const res={setHeader(){},status(code){this.code=code;return this;},json(body){replies++;this.body=body;this.bytes=JSON.stringify(body);}};
  const nextTurn=()=>new Promise(resolve=>setImmediate(resolve));
  try{
    const pending=handler(req,res);await nextTurn();assert.equal(commits,1);
    if(budget){
      assert.equal(hydrations,1);assert.equal(replies,0);
      t.mock.timers.tick(budget-1);await nextTurn();assert.equal(replies,0,'receipt must wait until the actual optional deadline');
      t.mock.timers.tick(1);
    }else assert.equal(hydrations,0,'no optional work starts after the total budget is exhausted');
    await pending;
    assert.equal(res.code,200);assert.equal(replies,1);assert.equal(res.body,saved);assert.equal(res.bytes,savedBytes);
    assert.equal(res.body.workspace,undefined);
    // The timeout bounds response waiting, not the outstanding read itself.
    // Complete that read and its final fence after the response has been sent.
    hydration.resolve(view(2));if(budget)await fenced.promise;await nextTurn();
    assert.equal(replies,1);assert.equal(res.body,saved);assert.equal(res.bytes,savedBytes);
    assert.equal(JSON.stringify(saved),savedBytes);assert.equal(res.body.workspace,undefined);assert.equal(commits,1);
  }finally{hydration.resolve(view(2));t.mock.timers.reset();}
});
for(const failAt of ['boundary','authenticate'])test(`${failAt} refusal never commits or discloses workspace`,async()=>{
  const s=server({failAt}), result=await s.invoke();assert.equal(result.code,401);assert.equal(result.body.workspace,undefined);assert.ok(!s.calls.includes('commit'));
});
test('final snapshot fence rejects an edit committed during current-photo validation',async()=>{
  let current=card(2);const workflow=createManualWorkflow({repository:{async load(){return {card:current,principal:{id:staffId}};}},artifacts:{},assertCurrent:async()=>{current=card(3);}});
  await assert.rejects(workflow.assertViewCurrent({id:staffId},card(2)),{code:'MANUAL_DRAFT_STALE'});
});

for(const stale of ['older','wrong hash'])test(`known committed floor survives failed refresh and rejects ${stale} recovery before accepting fresh state`,async()=>{
  let reads=0,posts=0,phase='offline';
  const f=browser(async(url,options)=>{
    if(options.method==='POST'){posts++;return response(receipt(JSON.parse(options.body)));}
    if(++reads===1)return response(view(1));
    if(phase==='offline')return response({error:'UNAVAILABLE'},503);
    const current=view(phase==='stale'&&stale==='older'?1:2);
    if(phase==='stale'&&stale==='wrong hash')current.card.contentHash='unrelated';
    return response(current);
  });
  await f.client.load();await assert.rejects(f.client.execute(command.action),{committed:true});phase='stale';
  await assert.rejects(f.client.recover(),{code:'MANUAL_DRAFT_STALE'});assert.equal(f.client.needsRefresh(),true);
  await assert.rejects(f.client.execute(command.action),/Refresh/);phase='fresh';await f.client.recover();assert.equal(f.client.needsRefresh(),false);assert.equal(posts,1);
});
