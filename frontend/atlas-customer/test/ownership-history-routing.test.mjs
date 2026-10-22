import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { signRoute } from '@atlas/site-router/proof';
import { acceptsSiteRequest } from '@atlas/site-router/server';
import { CustomerAuth } from '../lib/server/auth.mjs';
import { makeConfig, COOKIE_NAMES, cookie as makeCookie } from '../lib/server/config.mjs';
import { deny } from '../lib/server/policy.mjs';
import { createHandler } from '../lib/server/http.mjs';
import { createOwnershipHistoryRuntime } from '../lib/server/ownership-history-runtime.mjs';
import { CLAIM_ACCOUNT, CLAIM_OTHER_ACCOUNT, createOwnershipClaimHistoryFixture } from './ownership-claims-fixture.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const browser=Buffer.alloc(32,5).toString('base64url'),session=Buffer.alloc(32,6).toString('base64url');
const cookie=`${COOKIE_NAMES.browser}=${browser}; ${COOKIE_NAMES.session}=${session}`;
const validSettings={enabled:'1',databaseUrl:'postgresql://history_reader:reader-secret@db.example.invalid/atlas?schema=atlas_ownership_lifecycle_reader&sslmode=require'};
const routine={schema:'atlas_ownership_lifecycle_reader',name:'customer_read(text, text, jsonb, text, jsonb)',definer:true,owned:false,config:['search_path=pg_catalog']};
function fixture(settings=validSettings){
  const cfg=makeConfig({mode:'PRODUCTION',origin:'https://atlasgrading.com',deploymentId:'customer-history-fixture.vercel.app',deploymentHost:'customer-history-fixture.vercel.app',releaseSha:'0'.repeat(40),
    databaseUrl:'postgresql://customer:auth-secret@db.example.invalid/atlas?schema=atlas_customer&sslmode=require',cookies:COOKIE_NAMES,routerKey:Buffer.alloc(32,7),sessionKey:Buffer.alloc(32,8),phoneKey:Buffer.alloc(32,9),
    accountSid:'AC'+'0'.repeat(32),serviceSid:'VA'+'0'.repeat(32)});
  const history=createOwnershipClaimHistoryFixture(),actions=[],queries=[],ordinary=[],ingress=[];let creates=0,hook=null,unsafe=false;
  const broad={$transaction(){assert.fail('General customer client used by ownership');}};
  const auth=new CustomerAuth({config:cfg,database:{client:broad,async call(action,data){ordinary.push(action);
    if(action==='bootstrap')return {browserHash:data.browserHash,customer:{id:CLAIM_ACCOUNT}};
    if(action==='progress_preferences')return {email:false,sms:false};assert.fail('Unexpected ordinary action');}},provider:{start(){assert.fail('No provider');}}});
  const state={config:cfg,auth,clientAddress:()=> 'synthetic',cookie:(name,value,age)=>makeCookie(cfg,name,value,age),assertRequest(req){
    assert.equal(this,state);ingress.push(req.url);if(!acceptsSiteRequest(req,{zone:'customer',deploymentId:cfg.deploymentHost,routerKey:cfg.routerKey}))deny(403,'HOST_NOT_ALLOWED');}};
  const owned={async $disconnect(){},async $transaction(work){return work({async $executeRawUnsafe(){},async $queryRawUnsafe(sql,...args){
    queries.push(sql);if(sql.startsWith('SELECT r.rolsuper'))return [{unsafe}];if(sql.startsWith('SELECT n.nspname'))return [routine];
    assert.match(sql,/^SELECT atlas_ownership_lifecycle_reader.customer_read\(/);assert.deepEqual(args.slice(0,2),[hash(session),hash(browser)]);assert.deepEqual(JSON.parse(args[2]),cfg.binding);
    const action=args[3];actions.push(action);const base={actorId:CLAIM_ACCOUNT,observedAt:history.raw.observedAt};
    const value=action==='read_access'?base:action==='list_claims'?{...base,claims:[history.raw.claim],nextClaimId:null}:action==='read_claim'?{...base,claim:history.raw.claim}:action==='list_history'?history.raw:assert.fail('No mutation/config/target');
    return [{result:hook?await hook(action,structuredClone(value)):structuredClone(value)}];
  }});}};
  state.ownershipHistory=createOwnershipHistoryRuntime({customerState:state,settings,createClient(){creates++;return owned;}});
  const handler=createHandler(state);
  async function run({path='/api/customer/ownership/claims?limit=25',method='GET',body='',headers={},signed=true}={}){
    const proof=signed?await signRoute({zone:'customer',deployment:`https://${cfg.deploymentHost}`,method,target:'/account'+path,issuedAt:Date.now()},cfg.routerKey.toString('base64')):{};
    const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
    await handler({method,url:path,body,headers:{host:cfg.deploymentHost,'x-forwarded-proto':'https',cookie,...proof,...headers}},res);
    assert.match(res.headers['Cache-Control'],/private, no-store/);return res;
  }
  return {state,history,run,actions,queries,ordinary,ingress,get creates(){return creates;},set hook(value){hook=value;},set unsafe(value){unsafe=value;}};
}

test('actual catch-all dispatch admits only three signed GET reads through real auth/composition/role/projector',async()=>{
  const f=fixture();assert.equal(f.creates,0);
  for(const [path,schema] of [['claims?limit=25','atlas-ownership-claims-page-v2'],['claim?claimId='+f.history.request.claimId,'atlas-ownership-claim-state-v2'],
    ['history?claimId='+f.history.request.claimId+'&afterRevision=0&limit=25','atlas-ownership-claim-history-v2']]){
    const r=await f.run({path:'/api/customer/ownership/'+path});assert.equal(r.code,200);assert.equal(r.body.schema,schema);assert.equal(r.body.accountId,CLAIM_ACCOUNT);
  }
  assert.equal(f.creates,1);assert.equal(f.ordinary.length,0);assert.equal(f.ingress.length,3);
  assert.deepEqual(f.actions,['read_access','list_claims','read_access','read_access','read_claim','read_access','read_access','list_history','read_access']);
  await f.state.ownershipHistory.close();
});

test('missing/malformed history settings preserve actual session bootstrap and ordinary read routes',async()=>{
  for(const settings of [{enabled:undefined,databaseUrl:undefined},{enabled:'1',databaseUrl:'malformed'},{enabled:'0',databaseUrl:validSettings.databaseUrl}]){
    const f=fixture(settings);const session=await f.run({path:'/api/customer/session'});assert.equal(session.code,200);assert.equal(session.body.customer.id,CLAIM_ACCOUNT);assert.match(session.headers['Set-Cookie'],/HttpOnly; Secure; Path=\/account/);
    const ordinary=await f.run({path:'/api/customer/notifications'});assert.equal(ordinary.code,200);assert.deepEqual(ordinary.body,{email:false,sms:false});
    const result=await f.run();assert.equal(result.code,503);assert.deepEqual(result.body,{error:'OWNERSHIP_CLAIMS_UNAVAILABLE'});assert.deepEqual(f.ordinary,['bootstrap','progress_preferences']);assert.equal(f.creates,0);assert.equal(f.queries.length,0);
    assert.equal((await f.run({path:'/api/customer/session',signed:false})).code,403);await f.state.ownershipHistory.close();
  }
});

test('writes/other ownership routes, body/selectors and absent cookies never construct a reader client',async()=>{
  const f=fixture();
  for(const name of ['claims','claim','history'])assert.equal((await f.run({method:'POST',path:'/api/customer/ownership/'+name})).code,405);
  for(const name of ['submit','withdraw','replace','reserve','sign','complete','configuration','target','request','bundle','queue'])
    for(const method of ['GET','POST'])assert.equal((await f.run({method,path:'/api/customer/ownership/'+name})).code,404);
  for(const change of [{body:{accountId:CLAIM_ACCOUNT}},{path:'/api/customer/ownership/claims?limit=25&accountId='+CLAIM_ACCOUNT},{headers:{cookie:''}},
    {headers:{authorization:'Bearer invented'}},{headers:{origin:'https://foreign.invalid'}},{headers:{'sec-fetch-site':'cross-site'}},{signed:false}])assert.notEqual((await f.run(change)).code,200);
  assert.equal(f.creates,0);assert.equal(f.ordinary.length,0);assert.equal(f.queries.length,0);await f.state.ownershipHistory.close();
});

test('actual ingress guard replacement before lazy creation fails closed, including async rejection',async()=>{
  for(const guard of [()=>{},async()=>{throw Error('not admitted');}]){
    const f=fixture();f.state.assertRequest=guard;const r=await f.run();assert.equal(r.code,503);assert.equal(f.creates,0);assert.equal(f.queries.length,0);
    await f.state.ownershipHistory.close();
  }
});

test('live role refusal, foreign account and final session revocation expose no rows through catch-all',async()=>{
  for(const mode of ['role','foreign','revoked']){
    const f=fixture();let access=0;f.unsafe=mode==='role';f.hook=(action,value)=>{
      if(action==='list_claims'&&mode==='foreign')value.actorId=CLAIM_OTHER_ACCOUNT;
      if(action==='read_access'&&++access===2&&mode==='revoked')return {error:{status:401,code:'SIGN_IN_REQUIRED'}};
      return value;};
    const r=await f.run();assert.equal(r.code,mode==='revoked'?401:503);assert.deepEqual(Object.keys(r.body),['error']);assert.doesNotMatch(JSON.stringify(r.body),/claimId|bundleId|WITHDRAWN/);
    assert.equal(f.ordinary.length,0);await f.state.ownershipHistory.close();
  }
});

test('runtime hookup remains lazy/default-off, catch-all stays existing Next route and UI/SQL are not registered',async()=>{
  const [runtime,module,page]=await Promise.all([readFile(new URL('../lib/server/runtime.mjs',import.meta.url),'utf8'),
    readFile(new URL('../lib/server/ownership-history-runtime.mjs',import.meta.url),'utf8'),readFile(new URL('../pages/api/customer/[...path].js',import.meta.url),'utf8')]);
  assert.match(runtime,/enabled: env\.ATLAS_CUSTOMER_OWNERSHIP_HISTORY, databaseUrl: env\.ATLAS_CUSTOMER_OWNERSHIP_HISTORY_DATABASE_URL/);
  assert.match(runtime,/createClient: databaseUrl => new PrismaClient\(\{ datasources: \{ db: \{ url: databaseUrl \} \} \}\)/);
  assert.match(page,/export default createHandler\(runtime\)/);assert.doesNotMatch(module,/process\.env|\$connect|\bfetch\(|GRANT |customer_gateway|proofPreparation/);
});
