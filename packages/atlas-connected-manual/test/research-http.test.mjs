import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createConnectedHandler} from '../src/http.mjs';
const origin='https://atlasgrading.com';
function fixture(){
  const calls=[],actor={id:randomUUID()},cardId=randomUUID();
  const connected={workflow:{},intake:{},research:{preview:async(staff,id,input)=>{assert.equal(staff,actor);calls.push({id,input});return {state:'READY'};},contribute:async(staff,id,input)=>{assert.equal(staff,actor);calls.push({id,input});return {state:'RECORDED'};}}};
  const handler=createConnectedHandler({connected,origin,assertRequest:async()=>calls.push('gateway'),boundary:{authenticate:async(cookie,csrf)=>{assert.equal(cookie,'staff');assert.equal(csrf,'current');calls.push('auth');return actor;}}});
  const req={url:`/api/staff/manual-connected/cards/${cardId}/presentation/research/search`,method:'POST',body:{requestId:randomUUID()},headers:{origin,cookie:'staff','content-type':'application/json','x-atlas-csrf':'current'}};
  const res={headers:{},setHeader(key,value){this.headers[key]=value;},status(value){this.statusCode=value;return this;},json(value){this.body=value;}};
  return {calls,connected,handler,req,res,cardId};
}
test('research and catalog contributions authenticate before effects and disable caching',async()=>{
  for(const action of ['search','contribute']){const f=fixture();f.req.url=f.req.url.replace(/search$/,action);await f.handler(f.req,f.res);assert.equal(f.res.statusCode,200);assert.deepEqual(f.calls,['gateway','auth',{id:f.cardId,input:f.req.body}]);assert.equal(f.res.headers['Cache-Control'],'private, no-store');}
});
test('research rejects foreign origin, missing CSRF, queries, methods and oversized input before invocation',async()=>{
  for(const change of [req=>req.headers.origin='https://other.invalid',req=>delete req.headers['x-atlas-csrf'],req=>req.headers['content-type']='text/plain',req=>req.method='GET',req=>req.url+='?retry=true',req=>req.body={large:'x'.repeat(65536)}]){
    const f=fixture();change(f.req);await f.handler(f.req,f.res);assert.ok([403,405,413].includes(f.res.statusCode));assert.deepEqual(f.calls,['gateway']);
  }
  const f=fixture();f.connected.research=null;await f.handler(f.req,f.res);assert.equal(f.res.body.error,'RESEARCH_DISABLED');
});
