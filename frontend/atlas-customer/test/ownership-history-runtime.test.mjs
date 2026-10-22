import test from 'node:test';
import assert from 'node:assert/strict';
import { makeConfig, LOCAL_COOKIES } from '../lib/server/config.mjs';
import { CustomerAuth } from '../lib/server/auth.mjs';
import { createOwnershipHistoryRuntime, ownershipHistoryConfiguration } from '../lib/server/ownership-history-runtime.mjs';
import { CLAIM_ACCOUNT, createOwnershipClaimHistoryFixture } from './ownership-claims-fixture.mjs';

const local = 'postgresql://customer:auth-secret@127.0.0.1:5432/atlas?schema=atlas_customer';
const reader = 'postgresql://history_reader:read-secret@127.0.0.1:5432/atlas?schema=atlas_ownership_lifecycle_reader';
const settings = () => ({ enabled: '1', databaseUrl: reader });
const config = () => makeConfig({ mode: 'LOCAL_FIXTURE', origin: 'http://127.0.0.1:4318', deploymentId: 'local-customer-fixture', releaseSha: '0'.repeat(40),
  databaseUrl: local, accountSid: 'AC'+'0'.repeat(32), serviceSid: 'VA'+'0'.repeat(32), cookies: LOCAL_COOKIES, sessionKey: Buffer.alloc(32, 1), phoneKey: Buffer.alloc(32, 2) });
const routine = { schema:'atlas_ownership_lifecycle_reader',name:'customer_read(text, text, jsonb, text, jsonb)',definer:true,owned:false,config:['search_path=pg_catalog'] };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve=r; }); return { promise, resolve }; };
function setup({ selected = settings(), construct } = {}) {
  const cfg=config(), history=createOwnershipClaimHistoryFixture(), actions=[], calls={construct:0,disconnect:0,transaction:0};
  const broad={ $transaction(){assert.fail('General client used');} }, auth=new CustomerAuth({config:cfg,database:{client:broad}});
  const state={auth,config:cfg,assertRequest(){}};
  let pause=null;
  const owned={async $transaction(work, options){
    assert.equal(this,owned);assert.deepEqual(options,{maxWait:3000,timeout:8000});calls.transaction++;
    return work({async $executeRawUnsafe(){},async $queryRawUnsafe(sql,...args){
      if(sql.startsWith('SELECT r.rolsuper'))return [{unsafe:false}];
      if(sql.startsWith('SELECT n.nspname'))return [routine];
      const action=args[3];actions.push(action);
      if(pause)await pause(action);
      return [{result:action==='read_access'?{actorId:CLAIM_ACCOUNT,observedAt:history.raw.observedAt}: {actorId:CLAIM_ACCOUNT,observedAt:history.raw.observedAt,claims:[history.raw.claim],nextClaimId:null}}];
    }});
  },async $disconnect(){assert.equal(this,owned);calls.disconnect++;}};
  const runtime=createOwnershipHistoryRuntime({customerState:state,settings:selected,createClient:async url=>{
    calls.construct++;assert.equal(new URL(url).searchParams.get('connection_limit'),'2');return construct?construct(owned,state):owned;
  }});
  async function read(){
    const token=Buffer.alloc(32,3).toString('base64url'),res={setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
    await runtime.handler({method:'GET',url:'/api/customer/ownership/claims?limit=25',body:'',headers:{cookie:`${LOCAL_COOKIES.browser}=${token}; ${LOCAL_COOKIES.session}=${token}`}},res);return res;
  }
  return {cfg,auth,state,broad,owned,runtime,read,calls,actions,set pause(fn){pause=fn;}};
}

test('history is off without an explicit complete configuration; parsing has no fallback credentials',()=>{
  for(const enabled of [undefined,null,'','0'])assert.equal(ownershipHistoryConfiguration({enabled,databaseUrl:undefined},config()),null);
  for(const value of [{},{enabled:true,databaseUrl:reader},{enabled:'1',databaseUrl:undefined},{enabled:'0',databaseUrl:reader},{enabled:'1',databaseUrl:reader,extra:true}])
    assert.throws(()=>ownershipHistoryConfiguration(value,config()),/OWNERSHIP_CLAIMS_UNAVAILABLE/);
});

test('configuration binds same database with distinct credentials, fixed schema/TLS and bounded pool options',()=>{
  const selected=ownershipHistoryConfiguration(settings(),config()),url=new URL(selected.databaseUrl);
  assert(Object.isFrozen(selected));assert.equal(url.searchParams.get('connection_limit'),'2');assert.equal(url.searchParams.get('pool_timeout'),'3');assert.equal(url.searchParams.get('connect_timeout'),'5');
  const production={...config(),mode:'PRODUCTION',databaseUrl:local.replace('127.0.0.1','db.example.invalid')+'&sslmode=require'};
  const valid=reader.replace('127.0.0.1','db.example.invalid')+'&sslmode=require';
  assert.equal(new URL(ownershipHistoryConfiguration({enabled:'1',databaseUrl:valid},production).databaseUrl).hostname,'db.example.invalid');
  for(const bad of [reader.replace('history_reader','customer'),reader.replace('read-secret','auth-secret'),reader.replace('history_reader','%63ustomer'),
    reader.replace('/atlas?','/other?'),reader.replace(':5432',':5433'),reader.replace('127.0.0.1','other.invalid'),reader.replace('postgresql:','https:'),
    reader.replace('atlas_ownership_lifecycle_reader','atlas_customer'),reader+'&schema=atlas_ownership_lifecycle_reader',reader+'&host=evil.invalid',
    reader+'&options=-crole=owner',reader+'&connection_limit=999',reader+'#hidden',reader.replace('read-secret','bad%0Asecret')])
    assert.throws(()=>ownershipHistoryConfiguration({enabled:'1',databaseUrl:bad},config()),/OWNERSHIP_CLAIMS_UNAVAILABLE/);
  for(const bad of [valid.replace('sslmode=require','sslmode=disable'),valid.replace('db.example.invalid','127.0.0.1'),valid.replace('&sslmode=require','')])
    assert.throws(()=>ownershipHistoryConfiguration({enabled:'1',databaseUrl:bad},production));
});

test('factory and disabled close have zero I/O, malformed settings stay unavailable and expose no credentials',async()=>{
  for(const selected of [{enabled:undefined,databaseUrl:undefined},{enabled:'1',databaseUrl:'postgresql://private-secret@bad'}]){
    const f=setup({selected});assert.deepEqual(f.calls,{construct:0,disconnect:0,transaction:0});assert(Object.isFrozen(f.runtime));assert.deepEqual(Object.keys(f.runtime),['handler','close']);
    const result=await f.read();assert.equal(result.code,503);assert.deepEqual(result.body,{error:'OWNERSHIP_CLAIMS_UNAVAILABLE'});
    await f.runtime.close();assert.deepEqual(f.calls,{construct:0,disconnect:0,transaction:0});assert.doesNotMatch(JSON.stringify(f.runtime),/secret|databaseUrl/);
  }
});

test('concurrent admitted reads share one client; close drains a held read and disconnects exactly once',async()=>{
  const f=setup(),entered=deferred(),release=deferred();let held=false,finished=false;
  f.pause=async action=>{if(action==='list_claims'&&!held){held=true;entered.resolve();await release.promise;}};
  const first=f.read();await entered.promise;
  const second=await f.read();assert.equal(second.code,200);assert.equal(f.calls.construct,1);
  const closing=f.runtime.close();assert.strictEqual(f.runtime.close(),closing);closing.then(()=>{finished=true;});
  assert.equal((await f.read()).code,503);assert.equal(finished,false);assert.equal(f.calls.disconnect,0);
  release.resolve();assert.equal((await first).code,503);await closing;
  assert.equal(f.calls.disconnect,1);assert.equal(f.calls.construct,1);assert.equal((await f.read()).code,503);
});

test('close during observed client construction waits for ownership then disposes without a transaction',async()=>{
  const entered=deferred(),release=deferred();const f=setup({construct:async owned=>{entered.resolve();await release.promise;return owned;}});
  const read=f.read();await entered.promise;const closing=f.runtime.close();assert.equal(f.calls.disconnect,0);
  release.resolve();assert.equal((await read).code,503);await closing;assert.deepEqual(f.calls,{construct:1,disconnect:1,transaction:0});
});

test('failed construction is sticky and sanitized, never retried automatically',async()=>{
  const f=setup({construct:()=>{throw Error('secret connection string');}});
  for(let n=0;n<2;n++){const r=await f.read();assert.equal(r.code,503);assert.doesNotMatch(JSON.stringify(r.body),/secret|connection/);}
  await f.runtime.close();assert.deepEqual(f.calls,{construct:1,disconnect:0,transaction:0});
});

test('malformed newly owned client is disposed once before refusal, including disposal failure',async()=>{
  for(const fail of [false,true]){
    let disposed=0;const bad={$transaction:null,async $disconnect(){assert.equal(this,bad);disposed++;if(fail)throw Error('private cleanup detail');}};
    const f=setup({construct:()=>bad});
    for(let n=0;n<2;n++){const r=await f.read();assert.equal(r.code,503);assert.deepEqual(r.body,{error:'OWNERSHIP_CLAIMS_UNAVAILABLE'});}
    await f.runtime.close();assert.equal(disposed,1);assert.equal(f.calls.construct,1);assert.equal(f.calls.transaction,0);
  }
  // The real factory constructs a lazy Prisma client: a return without disposal
  // violates that contract and is refused before any transaction can open a pool.
  const f=setup({construct:()=>({$transaction(){assert.fail('Undisposable client queried');}})});
  assert.equal((await f.read()).code,503);await f.runtime.close();assert.equal(f.calls.transaction,0);
});

test('factory cannot smuggle general customer client and later method drift refuses without invoking replacement',async()=>{
  const f=setup({construct:(_owned,state)=>state.auth.database.client});assert.equal((await f.read()).code,503);await f.runtime.close();assert.equal(f.calls.transaction,0);assert.equal(f.calls.disconnect,0);
  const g=setup();assert.equal((await g.read()).code,200);g.owned.$transaction=()=>assert.fail('Replaced transaction invoked');
  assert.equal((await g.read()).code,503);await g.runtime.close();assert.equal(g.calls.disconnect,1);
  const h=setup();assert.equal((await h.read()).code,200);h.owned.$disconnect=()=>assert.fail('Replaced disconnect invoked');
  assert.equal((await h.read()).code,503);await assert.rejects(h.runtime.close(),/OWNERSHIP_CLAIMS_UNAVAILABLE/);assert.equal(h.calls.disconnect,0);
});
