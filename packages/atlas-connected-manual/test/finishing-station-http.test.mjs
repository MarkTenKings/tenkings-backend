import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnectedHandler } from '../src/http.mjs';
const origin='https://atlasgrading.com';
function fixture(enabled=true){
  const calls=[],staff={id:'authenticated-fixture'},connected={workflow:{},intake:{}};
  if(enabled)connected.station=Object.fromEntries(['list','challenge','enroll','arm','acknowledge','complete'].map(action=>[action,async(actor,body)=>{assert.equal(actor,staff);calls.push(action);return{action,body};}]));
  const handler=createConnectedHandler({connected,origin,assertRequest:async()=>{calls.push('gateway');},boundary:{authenticate:async(cookie,csrf)=>{assert.equal(cookie,'staff-cookie');calls.push({csrf});return staff;}}});
  const req={url:'/api/staff/manual-connected/stations/arm',method:'POST',body:{actionId:'fixture'},headers:{origin,cookie:'staff-cookie','content-type':'application/json','x-atlas-csrf':'current'}};
  const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.statusCode=code;return this;},json(body){this.body=body;}};
  return{handler,req,res,calls};
}
test('finishing station endpoints authenticate ordinary staff and CSRF before any service mutation',async()=>{
  const f=fixture();await f.handler(f.req,f.res);assert.equal(f.res.statusCode,200);
  assert.deepEqual(f.calls,['gateway',{csrf:'current'},'arm']);assert.equal(f.res.headers['Cache-Control'],'private, no-store');
  for(const action of ['challenge','enroll','acknowledge','complete']){const g=fixture();g.req.url=`/api/staff/manual-connected/stations/${action}`;await g.handler(g.req,g.res);assert.equal(g.res.body.action,action);}
});
test('station endpoint refuses cross-origin/query/method/body misuse before the service',async()=>{
  for(const change of [req=>req.headers.origin='https://other.invalid',req=>delete req.headers['x-atlas-csrf'],req=>req.headers['content-type']='text/plain',req=>req.method='GET',req=>req.url+='?override=1',req=>req.body={oversize:'x'.repeat(65536)}]){
    const f=fixture();change(f.req);await f.handler(f.req,f.res);assert.ok([403,405,413].includes(f.res.statusCode));assert.deepEqual(f.calls,['gateway']);
  }
});
test('disabled station read remains cold and write cannot invoke missing capability',async()=>{
  const f=fixture(false);f.req.url='/api/staff/manual-connected/stations';f.req.method='GET';await f.handler(f.req,f.res);
  assert.deepEqual(f.res.body,{enabled:false,stations:[]});assert.deepEqual(f.calls,['gateway',{csrf:undefined}]);
  const g=fixture(false);await g.handler(g.req,g.res);assert.equal(g.res.statusCode,503);assert.equal(g.res.body.error,'FINISHING_STATION_DISABLED');
});
