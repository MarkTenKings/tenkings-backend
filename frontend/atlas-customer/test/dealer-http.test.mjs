import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createHandler} from '../lib/server/http.mjs';
import {createDealerAccess} from '../lib/server/dealer.mjs';
import {BoundaryError} from '../lib/server/policy.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');
function fixture(){
 const config={mode:'LOCAL_FIXTURE',origin:'http://127.0.0.1:4318',cookies:{browser:'customer_browser'},sessionKey:Buffer.alloc(32,1)};
 const calls=[];const browser=Buffer.alloc(32,2).toString('base64url'),customer=Buffer.alloc(32,3).toString('base64url'),locationId='12345678-1234-4234-9234-123456789012';
 const auth={database:{call:async(action,data)=>{calls.push({action,data});return {location:{name:'Owned location'},cardCount:0};}},
  authority:(_header,csrf)=>{if(csrf!=='customer-csrf')throw new BoundaryError(403,'CSRF_REQUIRED');return {sessionHash:hash(customer),browserHash:hash(browser)};},
  call:async(_header,action,data)=>{calls.push({action,data});return {memberships:[{locationId,name:'Owned location'}]};},
  bootstrap:()=>assert.fail('dealer session must not use customer bootstrap')};
 const state={config,auth,dealer:createDealerAccess({auth,config}),assertRequest(){},clientAddress:()=> 'fixture'};
 const handler=createHandler(state);
 const run=async(path,{body,csrf='customer-csrf',session,origin=config.origin,method}={})=>{
  const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(s){this.statusCode=s;return this;},json(v){this.body=v;return this;}};
  await handler({url:`/api/customer/dealer/${path}`,method:method??(body===undefined?'GET':'POST'),body,
   headers:{cookie:`customer_browser=${browser};${session?` atlas_dealer_local_session=${session};`:''}`,origin,'content-type':'application/json','sec-fetch-site':'same-origin','x-atlas-customer-csrf':csrf}},res);return res;
 };
 return {run,calls,locationId};
}
test('dealer entry exchanges existing customer proof for separate HttpOnly cookie without exposing token',async()=>{
 const f=fixture(),r=await f.run('session',{body:{locationId:f.locationId}});assert.equal(r.statusCode,200);
 assert.match(r.headers['Set-Cookie'],/^atlas_dealer_local_session=[A-Za-z0-9_-]{43}; HttpOnly; Path=\/account; SameSite=Strict; Max-Age=28800$/);
 assert.equal(r.body.sessionToken,undefined);assert.match(r.body.csrf,/^[a-f0-9]{64}$/);assert.equal(f.calls[0].action,'dealer_enter');
 const session=r.headers['Set-Cookie'].split(';')[0].split('=')[1];
 const read=await f.run('session',{session});assert.equal(read.statusCode,200);assert.equal(f.calls[1].action,'dealer_read');
 assert.deepEqual(Object.keys(f.calls[1].data).sort(),['browserHash','dealerSessionHash']);
 assert.equal((await f.run('logout',{session,body:{},csrf:'customer-csrf'})).statusCode,403);
 assert.equal((await f.run('logout',{session,body:{},csrf:r.body.csrf})).statusCode,200);
});
test('dealer HTTP rejects forged account selectors, absent distinct session, cross-origin and mutation without CSRF',async()=>{
 const f=fixture();assert.equal((await f.run('session')).statusCode,401);
 assert.equal((await f.run('session',{body:{locationId:f.locationId,accountId:f.locationId}})).statusCode,400);
 assert.equal((await f.run('session',{body:{locationId:f.locationId},csrf:'bad'})).statusCode,403);
 assert.equal((await f.run('session',{body:{locationId:f.locationId},origin:'https://attacker.example'})).statusCode,403);
 assert.equal(f.calls.length,0);
});
test('dealer memberships uses authenticated customer gateway and rejects location query or wrong method',async()=>{
 const f=fixture();assert.equal((await f.run('memberships')).statusCode,200);assert.equal(f.calls[0].action,'dealer_memberships');
 assert.equal((await f.run('memberships?accountId=forged')).statusCode,400);
 assert.equal((await f.run('memberships',{body:{}})).statusCode,405);
});
