import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { makeConfig } from '../lib/server/config.mjs';
import { CustomerAuth } from '../lib/server/auth.mjs';
import { deny } from '../lib/server/policy.mjs';
import { createHandler } from '../lib/server/http.mjs';
import { createCollectionRuntime, collectionConfiguration } from '../lib/server/collection-runtime.mjs';
import { createCollectionPreviewFixture } from './collection-preview-fixture.mjs';
import { signRoute } from '@atlas/site-router/proof';
import { acceptsSiteRequest } from '@atlas/site-router/server';

const authUrl='postgresql://customer:auth-secret@127.0.0.1:5432/atlas?schema=atlas_customer';
const readerUrl='postgresql://collection_reader:read-secret@127.0.0.1:5432/atlas?schema=atlas_ownership';
const settings=()=>({enabled:'1',databaseUrl:readerUrl});
const browser=Buffer.alloc(32,3).toString('base64url'),session=Buffer.alloc(32,4).toString('base64url');
const cookie=`collection_browser=${browser}; collection_session=${session}`;
const hash=v=>createHash('sha256').update(v).digest('hex');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function config(production=false){return makeConfig({mode:production?'PRODUCTION':'LOCAL_FIXTURE',origin:production?'https://atlasgrading.com':'http://127.0.0.1:4318',
  deploymentId:production?'collection-reader.vercel.app':'collection-fixture',deploymentHost:'collection-reader.vercel.app',releaseSha:'0'.repeat(40),
  databaseUrl:production?authUrl.replace('127.0.0.1','db.example.invalid')+'&sslmode=require':authUrl,
  accountSid:'AC'+'0'.repeat(32),serviceSid:'VA'+'0'.repeat(32),sessionKey:Buffer.alloc(32,7),phoneKey:Buffer.alloc(32,8),routerKey:Buffer.alloc(32,9),
  cookies:{browser:'collection_browser',session:'collection_session'}});}
const routine={schema:'atlas_ownership',name:'customer_read(text, text, jsonb, text, jsonb)',definer:true,owned:false,config:['search_path=pg_catalog']};
function setup({selected,construct,production=false}={}){
  const cfg=config(production),f=createCollectionPreviewFixture(),calls={construct:0,transaction:0,disconnect:0,admit:0,bootstrap:0},queries=[],actions=[];
  const raw={accountId:f.accountId,preferences:f.snapshot.preferences,cards:f.snapshot.cards.map(c=>({...c,cardOffersDisabled:c.offers.cardDisabled,collectionPreferences:f.snapshot.preferences})),nextCardId:null};
  const broad={$transaction(){assert.fail('General DB client used');},$disconnect(){assert.fail('General client disposed');}};
  const auth=new CustomerAuth({config:cfg,database:{client:broad,async call(action,input){assert.equal(action,'bootstrap');calls.bootstrap++;return {browserHash:input.browserHash,customer:{id:f.accountId}};}}});
  const state={auth,config:cfg,clientAddress:()=> 'fixture',cookie:()=> 'fixture-cookie',assertRequest(req){assert.equal(this,state);calls.admit++;
    if(production&&!acceptsSiteRequest(req,{zone:'customer',deploymentId:cfg.deploymentHost,routerKey:cfg.routerKey}))deny(403,'HOST_NOT_ALLOWED');}};
  let hook=null,unsafe=false,routines=[routine];
  const owned={async $transaction(work,opts){assert.equal(this,owned);calls.transaction++;assert.deepEqual(opts,{maxWait:3000,timeout:5000});
    return work({async $executeRawUnsafe(sql){assert.match(sql,/^SET LOCAL (lock_timeout|statement_timeout)/);},async $queryRawUnsafe(sql,...args){
      queries.push(sql);if(sql.startsWith('SELECT r.rolsuper'))return [{unsafe}];if(sql.startsWith('SELECT n.nspname'))return routines;
      assert.match(sql,/^SELECT atlas_ownership.customer_read\(/);assert.deepEqual(args.slice(0,2),[hash(session),hash(browser)]);assert.deepEqual(JSON.parse(args[2]),cfg.binding);
      actions.push({action:args[3],input:JSON.parse(args[4])});const result=structuredClone(raw);return [{result:hook?await hook(result):result}];
    }});},async $disconnect(){assert.equal(this,owned);calls.disconnect++;}};
  const options={customerState:state,settings:selected??(production?{enabled:'1',databaseUrl:readerUrl.replace('127.0.0.1','db.example.invalid')+'&sslmode=require'}:settings()),
    createClient:async url=>{calls.construct++;assert.equal(new URL(url).searchParams.get('schema'),'atlas_ownership');return construct?construct(owned,state):owned;}};
  const runtime=createCollectionRuntime(options);state.ownershipRead=runtime.reader;
  function request(change={}){const req=new EventEmitter();Object.assign(req,{method:'GET',url:'/api/customer/collection?limit=25',body:'',headers:{host:production?cfg.deploymentHost:'127.0.0.1:4318',cookie},socket:{remoteAddress:'127.0.0.1'}},change);return req;}
  async function run(req=request()) {const res=new EventEmitter();Object.assign(res,{headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(body){this.body=body;this.writableEnded=true;return this;}});await createHandler(state)(req,res);assert.match(res.headers['Cache-Control'],/private, no-store/);return res;}
  return {cfg,f,raw,calls,queries,actions,state,auth,owned,broad,options,runtime,request,run,set hook(v){hook=v;},set unsafe(v){unsafe=v;},set routines(v){routines=v;}};
}

test('collection configuration is explicitly off, distinct same-database credentials and fixed bounded schema/TLS',()=>{
  for(const enabled of [undefined,null,'','0'])assert.equal(collectionConfiguration({enabled,databaseUrl:undefined},config()),null);
  const url=new URL(collectionConfiguration(settings(),config()).databaseUrl);assert.equal(url.searchParams.get('schema'),'atlas_ownership');assert.equal(url.searchParams.get('connection_limit'),'2');assert.equal(url.searchParams.get('pool_timeout'),'3');assert.equal(url.searchParams.get('connect_timeout'),'5');
  for(const selected of [{},{enabled:true,databaseUrl:readerUrl},{enabled:'0',databaseUrl:readerUrl},{enabled:'1'}, {...settings(),extra:true}])assert.throws(()=>collectionConfiguration(selected,config()));
  for(const bad of [readerUrl.replace('collection_reader','customer'),readerUrl.replace('read-secret','auth-secret'),readerUrl.replace('collection_reader','%63ustomer'),readerUrl.replace('/atlas?','/other?'),readerUrl.replace(':5432',':5433'),readerUrl.replace('127.0.0.1','other.invalid'),readerUrl.replace('postgresql:','https:'),readerUrl.replace('atlas_ownership','atlas_customer'),readerUrl+'&schema=atlas_ownership',readerUrl+'&options=-crole=owner',readerUrl+'&connection_limit=999',readerUrl+'#x',readerUrl.replace('read-secret','bad%0Asecret')])assert.throws(()=>collectionConfiguration({enabled:'1',databaseUrl:bad},config()));
  const production=readerUrl.replace('127.0.0.1','db.example.invalid')+'&sslmode=require';assert(collectionConfiguration({enabled:'1',databaseUrl:production},config(true)));
  for(const bad of [production.replace('sslmode=require','sslmode=disable'),production.replace('&sslmode=require',''),production.replace('db.example.invalid','127.0.0.1')])assert.throws(()=>collectionConfiguration({enabled:'1',databaseUrl:bad},config(true)));
});

test('disabled/malformed factory does no client I/O; collection unavailable is distinct from valid empty and ordinary routes survive',async()=>{
  for(const selected of [{enabled:undefined,databaseUrl:undefined},{enabled:'1',databaseUrl:'private-invalid'}]){
    const f=setup({selected});assert.equal(f.calls.construct,0);assert(Object.isFrozen(f.runtime));assert.deepEqual(Object.keys(f.runtime.reader),['read']);
    assert.deepEqual((await f.run()).body,{error:'COLLECTION_UNAVAILABLE'});assert.equal(f.calls.construct,0);
    const r=await f.run(f.request({url:'/api/customer/session'}));assert.equal(r.code,200);assert.equal(r.body.customer.id,f.f.accountId);assert.equal(f.calls.bootstrap,1);await f.runtime.close();assert.equal(f.calls.disconnect,0);
    assert.doesNotMatch(JSON.stringify(f.runtime),/secret|databaseUrl/);
  }
  const f=setup();f.raw.cards=[];const r=await f.run();assert.equal(r.code,200);assert.deepEqual(r.body.cards,[]);await f.runtime.close();
});

test('actual CustomerAuth→existing HTTP→unchanged restricted reader→projector; one ingress and role check per read',async()=>{
  const f=setup();const r=await f.run();assert.equal(r.code,200);assert.deepEqual(r.body,f.f.snapshot);assert.equal(f.calls.admit,1);assert.equal(f.calls.construct,1);assert.equal(f.calls.bootstrap,0);
  assert.deepEqual(f.actions,[{action:'read_collection',input:{afterCardId:null,limit:25}}]);assert.equal(f.queries.filter(s=>s.startsWith('SELECT r.rolsuper')).length,1);
  assert.equal((await f.run()).code,200);assert.equal(f.calls.construct,1);assert.equal(f.calls.admit,2);await f.runtime.close();assert.equal(f.calls.disconnect,1);
});

test('real signed ingress binds exact path/query/host and no predicate or unfinished promise is admission',async()=>{
  const f=setup({production:true});const proof=await signRoute({zone:'customer',deployment:`https://${f.cfg.deploymentHost}`,method:'GET',target:'/account/api/customer/collection?limit=25',issuedAt:Date.now()},f.cfg.routerKey.toString('base64'),webcrypto);
  const headers={host:f.cfg.deploymentHost,cookie,...proof,'x-forwarded-proto':'https','x-forwarded-host':f.cfg.deploymentHost};
  for(const req of [f.request(),f.request({headers:{...headers,'x-atlas-route-proof':'0'.repeat(64)}}),f.request({headers,url:'/api/customer/collection?limit=26'})])assert.equal((await f.run(req)).code,403);
  assert.equal(f.calls.construct,0);assert.equal((await f.run(f.request({headers}))).code,200);assert.equal(f.calls.admit,4);await f.runtime.close();
  for(const guard of [()=>true,()=>false,async()=>{},()=>Promise.reject(Error('private rejection'))]){const g=setup();g.state.assertRequest=guard;assert.equal((await g.run()).code,503);assert.equal(g.calls.construct,0);await g.runtime.close();}
});

test('strict GET shape, missing cookies and malformed/writer SQL role refuse without widening authority',async()=>{
  const f=setup();for(const req of [f.request({method:'POST',body:{}}),f.request({url:'/api/customer/collection?accountId='+f.f.accountId}),f.request({headers:{cookie,authorization:'Bearer private'}}),f.request({headers:{cookie,origin:'https://other.invalid'}}),f.request({rawBody:Buffer.from('x')}),f.request({headers:{}})])assert.notEqual((await f.run(req)).code,200);
  assert.equal(f.calls.construct,0);await f.runtime.close();
  for(const change of [g=>{g.unsafe=true;},g=>{g.routines=[{...routine,name:'customer_call(text, text, jsonb, text, jsonb)'}];},g=>{g.routines=[routine,{...routine,schema:'atlas_customer'}];}]){const g=setup();change(g);assert.equal((await g.run()).code,503);assert.equal(g.actions.length,0);await g.runtime.close();}
});

test('observed deferred read refuses request, auth, config, ingress and reader drift before any private response',async()=>{
  const changes=[(f,req)=>{req.headers.cookie+='x';},(f,req)=>{req.url='/api/customer/collection?limit=24';},(f,req)=>{req.body={accountId:f.f.accountId};},(f,req)=>{req.headers['x-atlas-route-proof']='changed';},(f,req)=>{req.emit('aborted');},
    f=>{f.state.auth=new CustomerAuth({config:f.cfg,database:{}});},f=>{f.auth.authority=()=>assert.fail('replaced auth called');},f=>{f.auth.digest=()=>assert.fail('replaced digest called');},f=>{f.auth.config={...f.cfg};},f=>{f.state.config={...f.cfg};},f=>{f.cfg.cookies.session='changed';},f=>{f.cfg.routerKey[0]^=1;},f=>{f.state.assertRequest=()=>{};},f=>{f.state.ownershipRead={read:()=>assert.fail('replacement reader called')};}];
  for(const change of changes){const f=setup(),entered=deferred(),release=deferred();f.hook=async v=>{entered.resolve();await release.promise;return v;};const req=f.request(),pending=f.run(req);await entered.promise;assert.equal(f.actions.length,1);change(f,req);release.resolve();const r=await pending;assert.equal(r.code,503);assert.deepEqual(r.body,{error:'COLLECTION_UNAVAILABLE'});assert.equal(f.calls.admit,1);await f.runtime.close();}
});

test('SQL revoked/foreign collection result is never mistaken for empty data',async()=>{
  for(const outcome of ['revoked','foreign']){const f=setup();f.hook=v=>outcome==='revoked'?{error:{status:401,code:'SIGN_IN_REQUIRED'}}:{...v,accountId:'99999999-9999-4999-8999-999999999999'};const r=await f.run();assert.equal(r.code,outcome==='revoked'?401:503);assert.deepEqual(Object.keys(r.body),['error']);await f.runtime.close();}
});

test('single-flight lazy client and close drain active reads, reject late delivery and dispose once',async()=>{
  const f=setup(),entered=deferred(),release=deferred();let held=false,closed=false;f.hook=async v=>{if(!held){held=true;entered.resolve();await release.promise;}return v;};
  const first=f.run();await entered.promise;assert.equal((await f.run()).code,200);assert.equal(f.calls.construct,1);const closing=f.runtime.close();assert.strictEqual(f.runtime.close(),closing);closing.then(()=>{closed=true;});assert.equal(closed,false);assert.equal((await f.run()).code,503);release.resolve();assert.equal((await first).code,503);await closing;assert.equal(f.calls.disconnect,1);assert.equal(closed,true);
});

test('close during observed construction retains ownership and disconnects without a transaction',async()=>{
  const entered=deferred(),release=deferred();const f=setup({construct:async owned=>{entered.resolve();await release.promise;return owned;}});const first=f.run();await entered.promise;const closing=f.runtime.close();release.resolve();assert.equal((await first).code,503);await closing;assert.deepEqual([f.calls.construct,f.calls.transaction,f.calls.disconnect],[1,0,1]);
});

test('failed construction is sticky; malformed owned clients dispose once, general client never disposed',async()=>{
  const failed=setup({construct:()=>{throw Error('private connection string');}});for(let i=0;i<2;i++)assert.deepEqual((await failed.run()).body,{error:'COLLECTION_UNAVAILABLE'});await failed.runtime.close();assert.equal(failed.calls.construct,1);
  for(const reject of [false,true]){let disposed=0;const bad={$transaction:null,$disconnect(){disposed++;if(reject)throw Error('private disposal');}};const f=setup({construct:()=>bad});assert.equal((await f.run()).code,503);assert.equal((await f.run()).code,503);await f.runtime.close();assert.equal(disposed,1);assert.equal(f.calls.transaction,0);}
  const f=setup({construct:(_owned,state)=>state.auth.database.client});assert.equal((await f.run()).code,503);await f.runtime.close();assert.equal(f.calls.transaction,0);
});

test('captured client/config changes refuse without replacement invocation and close remains explicit',async()=>{
  const f=setup();assert.equal((await f.run()).code,200);f.owned.$transaction=()=>assert.fail('replaced transaction used');assert.equal((await f.run()).code,503);await f.runtime.close();assert.equal(f.calls.disconnect,1);
  const g=setup();assert.equal((await g.run()).code,200);g.owned.$disconnect=()=>assert.fail('replaced disconnect used');assert.equal((await g.run()).code,503);await assert.rejects(g.runtime.close(),/COLLECTION_UNAVAILABLE/);
  const h=setup();h.options.settings.databaseUrl=readerUrl.replace('read-secret','other');assert.equal((await h.run()).code,503);assert.equal(h.calls.construct,0);await h.runtime.close();
});
