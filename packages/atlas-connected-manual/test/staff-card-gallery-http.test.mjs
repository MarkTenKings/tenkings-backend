import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createConnectedHandler } from '../src/http.mjs';
import { createPrivateManualServer } from '../scripts/private-server.mjs';
import { createManualServiceProxy, isManualServicePath, manualResponsePolicy } from '../src/transport.mjs';
const origin = 'https://atlasgrading.com', cardId = randomUUID(), base = `/api/staff/manual-connected/cards/${cardId}`;
const query = 'intakeRevision=2&sourceHash=none&uploadId=' + randomUUID() + '&version=1&originalSha256=' + 'a'.repeat(64) + '&manualRevision=none&manualContentHash=none';
const response = () => ({ headers: {}, setHeader(k,v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; }, send(body) { this.body = body; }, end(body) { this.body = body; } });
function fixture() {
  const actor = {}, calls = [], connected = { intake: {}, workflow: {}, gallery: {
    read: async (staff,id) => { assert.equal(staff,actor); calls.push(['read',id]); return { schema: 'atlas-staff-card-gallery-v1' }; },
    preview: async (staff,id,input) => { assert.equal(staff,actor); calls.push(['preview',id,input]); return { schema: 'atlas-staff-gallery-preview-v1' }; } } };
  const boundary = { authenticate: async (cookie,csrf) => { assert.equal(csrf,undefined); if (cookie !== 'staff') throw Object.assign(Error(),{status:401,code:'SIGN_IN_REQUIRED'}); return actor; } };
  return { connected,boundary,calls,handler:createConnectedHandler({connected,boundary,origin,assertRequest:async()=>{}}) };
}
test('gallery GET enforces exact query/body/method and ordinary staff authentication', async () => {
  const f=fixture();
  for(const [path,body] of [[base+'/gallery',undefined],[base+'/gallery',''],[base+'/gallery',{}],[base+'/gallery-preview?'+query,undefined]]) {
    const res=response();await f.handler({method:'GET',url:path,headers:{cookie:'staff'},body},res);assert.equal(res.statusCode,200);assert.equal(res.headers['Cache-Control'],'private, no-store');
  }
  assert.equal(f.calls[3][2].sourceHash,null);assert.equal(f.calls[3][2].manualRevision,null);
  for(const suffix of ['gallery?x=1','gallery-preview?'+query+'&version=1','gallery-preview?'+query.replace('sourceHash=none','sourceHash=wrong'),'gallery-preview?'+query.replace('manualRevision=none','manualRevision=1')]) {
    const res=response();await f.handler({method:'GET',url:base+'/'+suffix,headers:{cookie:'staff'}},res);assert.equal(res.statusCode,400);
  }
  for(const req of [{method:'POST',headers:{cookie:'staff'}},{method:'GET',headers:{}},{method:'GET',headers:{cookie:'staff','content-length':'2'},body:'{}'},{method:'GET',headers:{cookie:'staff','transfer-encoding':'chunked'}}]) {
    const res=response();await f.handler({url:base+'/gallery',...req},res);assert([400,401,405].includes(res.statusCode));
  }
  assert.equal(f.calls.length,4);
});
test('existing signed transport carries exact gallery JSON routes without widening image/body limits', async () => {
  for(const path of [base+'/gallery',base+'/gallery-preview?'+query]) { assert.equal(isManualServicePath(path),true);assert.equal(manualResponsePolicy(path,'application/json').limit,2*1024*1024);assert.throws(()=>manualResponsePolicy(path,'image/jpeg')); }
  const f=fixture(),key='synthetic-gallery-'.repeat(4),server=createPrivateManualServer({connected:f.connected,boundary:f.boundary,origin,key});server.listen(0,'127.0.0.1');await once(server,'listening');
  try {
    const host=`http://127.0.0.1:${server.address().port}`,proxy=createManualServiceProxy({origin:'https://private.invalid',key,fetchImpl:(url,init)=>{const u=new URL(url);return fetch(host+u.pathname+u.search,init);}});
    for(const suffix of ['/gallery','/gallery-preview?'+query]) { const res=response();await proxy({method:'GET',url:base+suffix,headers:{cookie:'staff'}},res);assert.equal(res.statusCode,200);assert.match(JSON.parse(Buffer.from(res.body).toString()).schema,/^atlas-staff-/); }
    const anonymous=response();await proxy({method:'GET',url:base+'/gallery',headers:{}},anonymous);assert.equal(anonymous.statusCode,401);
    assert.equal((await fetch(host+base+'/gallery')).status,401);assert.equal(f.calls.length,2);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});
