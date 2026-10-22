import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { signRoute } from '@atlas/site-router/proof';
import { acceptsSiteRequest } from '@atlas/site-router/server';
import { CustomerAuth } from '../lib/server/auth.mjs';
import { makeConfig } from '../lib/server/config.mjs';
import { createOwnershipLifecycleReadComposition } from '../lib/server/ownership-lifecycle-read-composition.mjs';
import { createOwnershipClaimsTransport } from '../lib/ownership-claims-transport.mjs';
import { createOwnershipClaimsReader, createOwnershipClaimHistoryReader } from '../lib/ownership-claims-client.mjs';
import { CLAIM_ACCOUNT, CLAIM_OTHER_ACCOUNT, createOwnershipClaimHistoryFixture } from './ownership-claims-fixture.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const browser = Buffer.alloc(32, 1).toString('base64url'), session = Buffer.alloc(32, 2).toString('base64url');
const cookie = `composition_browser=${browser}; composition_session=${session}`;
const expected = { schema: 'atlas_ownership_lifecycle_reader', name: 'customer_read(text, text, jsonb, text, jsonb)', definer: true, config: ['search_path=pg_catalog'], owned: false };
const base = (accountId = CLAIM_ACCOUNT) => ({ actorId: accountId, observedAt: '2026-10-21T12:00:00.000Z' });
function fixture({ production = false } = {}) {
  const history = createOwnershipClaimHistoryFixture(), queries = [], settings = [], actions = [], requests = [];
  let unsafe = false, routines = [expected], resultHook = null;
  const deploymentHost = 'atlas-customer-composition.vercel.app';
  const config = makeConfig({ mode: production ? 'PRODUCTION' : 'LOCAL_FIXTURE', origin: production ? 'https://atlasgrading.com' : 'http://127.0.0.1:4318',
    deploymentId: production ? deploymentHost : 'composition-fixture', deploymentHost, routerKey: Buffer.alloc(32, 17), releaseSha: '0'.repeat(40),
    accountSid: 'AC'+'0'.repeat(32), serviceSid: 'VA'+'0'.repeat(32), cookies: { browser: 'composition_browser', session: 'composition_session' },
    sessionKey: Buffer.alloc(32, 7), phoneKey: Buffer.alloc(32, 8) });
  const broadClient = { $transaction() { assert.fail('No broad customer DB'); } };
  const auth = new CustomerAuth({ config, database: { client: broadClient, call() { assert.fail('No bootstrap/auth writes'); } },
    provider: { start() { assert.fail('No SMS'); }, check() { assert.fail('No SMS'); } } });
  const state = { config, auth, assertRequest(req) { assert.equal(this, state); requests.push(req.url);
    const accepted = production ? acceptsSiteRequest(req, { zone: 'customer', deploymentId: config.deploymentHost, routerKey: config.routerKey })
      : req.headers.host === '127.0.0.1:4318';
    if (!accepted) throw { status: 403, code: 'HOST_NOT_ALLOWED' }; },
    ownershipClaims: { lifecycle: { call() { assert.fail('Do not inherit existing capabilities'); } }, proof: { sign() { assert.fail('No proof'); } } } };
  const client = { async $transaction(work, options) {
    assert.deepEqual(options, { maxWait: 3000, timeout: 8000 });
    return work({ async $executeRawUnsafe(sql) { settings.push(sql); }, async $queryRawUnsafe(sql, ...args) {
      queries.push({ sql, args });
      if (sql.startsWith('SELECT r.rolsuper')) return [{ unsafe }];
      if (sql.startsWith('SELECT n.nspname')) return routines;
      assert.match(sql, /^SELECT atlas_ownership_lifecycle_reader.customer_read\(/);
      assert.deepEqual(args.slice(0, 2), [hash(session), hash(browser)]); assert.deepEqual(JSON.parse(args[2]), config.binding);
      const action = args[3], input = JSON.parse(args[4]); actions.push({ action, input });
      const value = action === 'read_access' ? base() : action === 'list_claims' ? { ...base(), claims: [history.raw.claim], nextClaimId: null }
        : action === 'read_claim' ? { ...base(), claim: history.raw.claim } : action === 'list_history' ? history.raw : assert.fail('Unexpected read');
      return [{ result: resultHook ? await resultHook(action, structuredClone(value)) : structuredClone(value) }];
    } });
  } };
  const composition = createOwnershipLifecycleReadComposition({ customerState: state, readerClient: client });
  async function run({ method = 'GET', path = 'claims?limit=25', body = '', headers = {} } = {}) {
    const req = { method, url: '/api/customer/ownership/'+path, body, headers: { host: production ? deploymentHost : '127.0.0.1:4318', cookie, ...headers } };
    const res = { headers: {}, setHeader(k,v) { this.headers[k]=v; }, status(n) { this.statusCode=n; return this; }, json(value) { this.body=value; this.writableEnded=true; return this; } };
    await composition.handler(req,res); assert.match(res.headers['Cache-Control'], /private, no-store/); assert.equal(res.headers['Vercel-CDN-Cache-Control'], 'no-store'); return res;
  }
  return { config, auth, state, client, broadClient, composition, run, history, queries, settings, actions, requests,
    set unsafe(v) { unsafe=v; }, set routines(v) { routines=v; }, set hook(fn) { resultHook=fn; } };
}

test('explicit composition constructs without any transaction and exports only one frozen handler', () => {
  const f = fixture(); assert.equal(f.queries.length, 0); assert.equal(f.requests.length, 0); assert.equal(f.actions.length, 0);
  assert(Object.isFrozen(f.composition)); assert.deepEqual(Object.keys(f.composition), ['handler']);
  for (const options of [undefined, {}, { customerState: f.state }, { customerState: f.state, readerClient: f.client, uiConfig: {} },
    { customerState: { ...f.state, auth: { config: f.config, authority: () => ({ accountId: CLAIM_ACCOUNT }) } }, readerClient: f.client },
    { customerState: { ...f.state, config: { ...f.config } }, readerClient: f.client }, { customerState: f.state, readerClient: f.broadClient }]) {
    assert.throws(() => createOwnershipLifecycleReadComposition(options));
  }
  assert.equal(f.queries.length, 0);
});

test('actual CustomerAuth → handler → qualified service → projector checks live access and role for every list/current/history read', async () => {
  const f = fixture();
  const list = await f.run(); assert.equal(list.statusCode, 200); assert.equal(list.body.schema, 'atlas-ownership-claims-page-v2');
  assert.equal(list.body.claims[0].state, 'WITHDRAWN'); assert.equal(list.body.claims[0].claimRevision, 3);
  const current = await f.run({ path: 'claim?claimId='+f.history.request.claimId }); assert.equal(current.body.claim.bundleId, f.history.raw.claim.bundleId);
  const history = await f.run({ path: `history?claimId=${f.history.request.claimId}&afterRevision=0&limit=25` });
  assert.equal(history.body.transitions[0].state, 'PENDING'); assert.equal(history.body.transitions[0].claimRevision, 1); assert.equal(history.body.claim.state, 'WITHDRAWN');
  assert.deepEqual(f.actions.map(x => x.action), ['read_access','list_claims','read_access','read_access','read_claim','read_access','read_access','list_history','read_access']);
  assert.equal(f.queries.filter(q => q.sql.startsWith('SELECT r.rolsuper')).length, 9); assert.equal(f.settings.length, 18);
  assert(f.settings.every(sql => /^SET LOCAL (lock_timeout|statement_timeout)/.test(sql)));
});

test('narrow read-only composition refuses writes, proof, target, configuration and request recovery before any DB call', async () => {
  const f = fixture();
  for (const path of ['submit','withdraw','replace','reserve','sign','complete','claims?limit=25']) assert.equal((await f.run({ method:'POST', path, body:{} })).statusCode, 405);
  for (const path of ['target?certificateNumber=ATLAS-000000000001','configuration','request?requestId='+f.history.request.claimId,'bundle?bundleId='+f.history.request.claimId,'queue'])
    assert.equal((await f.run({ path })).statusCode, 404);
  assert.equal(f.queries.length, 0); assert.equal(f.requests.length, 0);
});

test('existing cookie, trusted request boundary, GET grammar and cross-site checks run before restricted SQL', async () => {
  const f = fixture();
  for (const request of [{headers:{cookie:''}},{headers:{authorization:'Bearer forged'}},{headers:{host:'evil.invalid'}},
    {headers:{origin:'https://foreign.invalid'}},{headers:{'sec-fetch-site':'cross-site'}},{body:{accountId:CLAIM_ACCOUNT}},
    {path:'claims?limit=25&accountId='+CLAIM_ACCOUNT},{path:'claims?limit=025'}]) assert.notEqual((await f.run(request)).statusCode,200);
  assert.equal(f.queries.length,0);
});

test('role drift, writer/legacy grants and private helper access fail closed before any gateway result', async () => {
  for (const change of [f => {f.unsafe=true;},f => {f.routines=[];},f => {f.routines=[{...expected,schema:'atlas_customer',name:'customer_call(text, jsonb, jsonb)'}];},
    f => {f.routines=[expected,{...expected,schema:'atlas_ownership_lifecycle',name:'customer_gateway(text, text, jsonb, text, jsonb)'}];},
    f => {f.routines=[{...expected,owned:true}];},f => {f.routines=[{...expected,config:['search_path=public']}];}]) {
    const f=fixture();change(f);const result=await f.run();assert.equal(result.statusCode,503);assert.deepEqual(result.body,{error:'OWNERSHIP_CLAIMS_UNAVAILABLE'});assert.equal(f.actions.length,0);
  }
  const f=fixture();assert.equal((await f.run()).statusCode,200);f.unsafe=true;assert.equal((await f.run()).statusCode,503);assert.equal(f.actions.length,3);
});

test('foreign account projection and revocation during final access refresh disclose no private rows', async () => {
  for (const mode of ['foreign','revoked','not-found']) {
    const f=fixture();let accesses=0;
    f.hook=(action,value)=>{
      if(action==='read_access' && ++accesses===2 && mode==='revoked')return {error:{status:401,code:'SIGN_IN_REQUIRED'}};
      if(action==='list_claims' && mode==='foreign')value.actorId=CLAIM_OTHER_ACCOUNT;
      if(action==='list_claims' && mode==='not-found')return {error:{status:404,code:'OWNERSHIP_CLAIM_NOT_FOUND'}};
      return value;
    };
    const r=await f.run();assert.equal(r.statusCode,mode==='revoked'?401:mode==='not-found'?404:503);assert.deepEqual(Object.keys(r.body),['error']);
    assert.doesNotMatch(JSON.stringify(r.body),/claimId|bundleId|WITHDRAWN|PENDING/);
  }
});

test('state/auth/config/cookie/client boundary replacement fails closed, including drift during a pending read', async () => {
  for (const mutate of [f => {f.state.auth=new CustomerAuth({config:f.config});},f => {f.state.config={...f.config};},
    f => {f.auth.config={...f.config};},f => {f.state.assertRequest=()=>{};},f => {f.auth.authority=()=>({sessionHash:'a'.repeat(64),browserHash:'b'.repeat(64)});},
    f => {f.client.$transaction=()=>assert.fail('Replaced client');},f => {f.config.cookies.session='changed_session';}]) {
    const f=fixture();mutate(f);assert.equal((await f.run()).statusCode,503);assert.equal(f.queries.length,0);
  }
  const f=fixture();f.hook=(action,value)=>{if(action==='list_claims')f.state.assertRequest=()=>{};return value;};
  const result=await f.run();assert.equal(result.statusCode,503);assert.deepEqual(Object.keys(result.body),['error']);assert.equal(f.actions.length,2);
});

test('actual browser read transport consumes composed responses with no policy configuration or upload availability', async () => {
  const f=fixture(), calls=[];
  const transport=createOwnershipClaimsTransport({csrf:()=>assert.fail('GET does not need CSRF'),fetchImpl:async(url,options)=>{
    calls.push({url,options});assert.equal(options.method,'GET');assert.equal(options.credentials,'same-origin');
    const r=await f.run({path:url.slice('/account/api/customer/ownership/'.length),headers:options.headers});
    return new Response(JSON.stringify(r.body),{status:r.statusCode,headers:{...r.headers,'content-type':'application/json'}});
  }});
  const page=await createOwnershipClaimsReader(transport.listClaims)({accountId:CLAIM_ACCOUNT});
  const history=await createOwnershipClaimHistoryReader(transport.listHistory)({accountId:CLAIM_ACCOUNT,claimId:f.history.request.claimId});
  assert.equal(page.claims[0].state,'WITHDRAWN');assert.equal(history.claim.claimRevision,3);assert.equal(history.transitions[0].state,'PENDING');
  assert.equal(calls.length,2);assert(!f.actions.some(x=>['configuration','resolve_certificate'].includes(x.action)));
});

test('composition source has no registration, environment, client constructor, provider or grading entrypoint', async () => {
  const source=await readFile(new URL('../lib/server/ownership-lifecycle-read-composition.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/process\.env|new PrismaClient|import\([^)]*runtime|from ['"][^'"]*(?:grading|runtime|twilio|storage|database)\b|\b(?:fetch|connect|listen)\(/);
  assert.match(source,/createCardOwnershipLifecycleReadService\(\{ customerAuth: auth, client, uiConfig: null \}\)/);
  assert.doesNotMatch(source,/cardOwnershipLifecycleReadGrantSQL|customer_gateway|proofPreparation:/);
});


test('composition refuses an asynchronous or predicate-style ingress guard rather than treating it as admitted', async () => {
  for (const guard of [async () => { throw Error('not admitted'); }, () => false, () => true]) {
    const f=fixture(); f.state.assertRequest=guard;
    const composition=createOwnershipLifecycleReadComposition({customerState:f.state,readerClient:f.client});
    const req={method:'GET',url:'/api/customer/ownership/claims?limit=25',body:'',headers:{host:'127.0.0.1:4318',cookie}};
    const res={setHeader(){},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}};
    await composition.handler(req,res);assert.equal(res.statusCode,503);assert.equal(f.queries.length,0);
    assert.deepEqual(res.body,{error:'OWNERSHIP_CLAIMS_UNAVAILABLE'});
  }
});

test('existing route signer/verifier admits only the exact signed customer GET before restricted reads', async () => {
  const f = fixture({ production: true });
  const proof = await signRoute({ zone: 'customer', deployment: `https://${f.config.deploymentHost}`, method: 'GET',
    target: '/account/api/customer/ownership/claims?limit=25', issuedAt: Date.now() }, f.config.routerKey.toString('base64'), webcrypto);
  const headers = { ...proof, 'x-forwarded-proto': 'https', 'x-forwarded-host': f.config.deploymentHost };
  for (const request of [{ headers: { 'x-forwarded-proto': 'https' } },
    { headers: { ...headers, 'x-atlas-route-proof': '0'.repeat(64) } },
    { path: 'claims?limit=26', headers }, { headers: { ...headers, 'x-forwarded-host': 'foreign.invalid' } }]) {
    const result = await f.run(request); assert.equal(result.statusCode, 403); assert.deepEqual(Object.keys(result.body), ['error']);
  }
  assert.equal(f.queries.length, 0);
  const result = await f.run({ headers }); assert.equal(result.statusCode, 200); assert.equal(result.body.accountId, CLAIM_ACCOUNT);
  assert.deepEqual(f.actions.map(value => value.action), ['read_access', 'list_claims', 'read_access']);
});

test('observed deferred read refuses pinned auth, binding, cookie and ingress changes before returning any private result', async () => {
  for (const mutate of [f => { f.auth.config = { ...f.config, binding: { ...f.config.binding, releaseSha: '1'.repeat(40) } }; },
    f => { f.config.cookies.session = 'rotated_session'; }, f => { f.state.assertRequest = () => {}; }]) {
    const f = fixture(); let entered, resume, completed = false;
    const reached = new Promise(resolve => { entered = resolve; }), paused = new Promise(resolve => { resume = resolve; });
    f.hook = async (action, value) => { if (action === 'list_claims') { entered(); await paused; } return value; };
    const pending = f.run().then(result => { completed = true; return result; });
    await reached;
    assert.equal(completed, false); assert.deepEqual(f.actions.map(value => value.action), ['read_access', 'list_claims']);
    mutate(f); resume();
    const result = await pending; assert.equal(result.statusCode, 503); assert.deepEqual(result.body, { error: 'OWNERSHIP_CLAIMS_UNAVAILABLE' });
    assert.equal(f.actions.length, 2); assert.doesNotMatch(JSON.stringify(result.body), /claimId|bundleId|WITHDRAWN|PENDING/);
  }
});
