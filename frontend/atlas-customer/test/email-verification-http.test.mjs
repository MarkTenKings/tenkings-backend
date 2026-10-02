import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { CustomerAuth } from '../lib/server/auth.mjs';
import { createHandler } from '../lib/server/http.mjs';
import { makeConfig, LOCAL_COOKIES } from '../lib/server/config.mjs';
import { hash } from '../lib/server/policy.mjs';
const response = () => ({headers:{},setHeader(key,value){this.headers[key]=value;},status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
function fixture() {
 const config=makeConfig({mode:'LOCAL_FIXTURE',origin:'http://127.0.0.1:4318',deploymentId:'local-customer-fixture',releaseSha:'0'.repeat(40),
  sessionKey:randomBytes(32),phoneKey:randomBytes(32),cookies:LOCAL_COOKIES,accountSid:'AC'+'1'.repeat(32),serviceSid:'VA'+'2'.repeat(32)});
 const calls=[],requests=[],browser=randomBytes(32).toString('base64url'),session=randomBytes(32).toString('base64url');
 const auth=new CustomerAuth({config,database:{async call(action,data){calls.push({action,data});return {verified:true};}}});
 const handler=createHandler({config,auth,assertRequest(){},clientAddress(){return 'synthetic-trusted-client';},
  emailVerification:{async request(authority,input){requests.push({authority,input});return{state:'SENT',verified:false};}}});
 const headers={origin:config.origin,'content-type':'application/json','sec-fetch-site':'same-origin',cookie:`${config.cookies.browser}=${browser}; ${config.cookies.session}=${session}`,
  'x-atlas-customer-csrf':auth.digest(`session:${session}`)};
 const invoke=async(path,body,override={})=>{const res=response();await handler({url:'/api/customer/email/'+path,method:body===undefined?'GET':'POST',headers,body,...override},res);return res;};
 return {config,auth,browser,session,headers,calls,requests,invoke};
}
test('verification GET is inert; confirmation is exact CSRF POST with token hash only and never issues login cookies',async()=>{
 const f=fixture(),token=randomBytes(32).toString('base64url');
 const get=await f.invoke('confirm');assert.equal(get.code,405);assert.equal(f.calls.length,0);
 for(const changed of [{headers:{...f.headers,origin:'https://other.invalid'}},{headers:{...f.headers,'x-atlas-customer-csrf':''}},
  {body:{token,mode:'LOGIN'}},{body:{token,mode:'CONFIRM',accountId:randomUUID()}}]) {
  const denied=await f.invoke('confirm',{token,mode:'CONFIRM'},changed);assert([400,403].includes(denied.code));
 }
 assert.equal(f.calls.length,0);
 const good=await f.invoke('confirm',{token,mode:'AUTO'});assert.equal(good.code,200);assert.equal(good.headers['Set-Cookie'],undefined);
 assert.deepEqual(f.calls,[{action:'email_confirm',data:{browserHash:hash(f.browser),sessionHash:hash(f.session),tokenHash:hash(token),mode:'AUTO',clientHash:hash('synthetic-trusted-client')}}]);
 assert(!JSON.stringify(f.calls).includes(token));assert.match(good.headers['Cache-Control'],/private, no-store/);
});
test('signed-out confirmation has browser CSRF and no session authority or login cookie',async()=>{
 const f=fixture(),token=randomBytes(32).toString('base64url');
 const headers={...f.headers,cookie:`${f.config.cookies.browser}=${f.browser}`,'x-atlas-customer-csrf':f.auth.digest(`browser:${f.browser}`)};
 const result=await f.invoke('confirm',{token,mode:'CONFIRM'},{headers});assert.equal(result.code,200);
 assert.equal(f.calls[0].data.sessionHash,undefined);assert.equal(result.headers['Set-Cookie'],undefined);
 const absent=await f.invoke('confirm',{token,mode:'CONFIRM'},{headers:{...headers,cookie:''}});assert.equal(absent.code,403);assert.equal(f.calls.length,1);
});
test('email request requires signed phone session and session CSRF, forbids caller destination, and forwards binding',async()=>{
 const f=fixture(),body={draftId:randomUUID(),requestId:randomUUID()};
 for(const changed of [{headers:{...f.headers,cookie:`${f.config.cookies.browser}=${f.browser}`}},
  {headers:{...f.headers,'x-atlas-customer-csrf':f.auth.digest(`browser:${f.browser}`)}},{body:{...body,to:'untrusted@example.invalid'}},{url:'/api/customer/email/request?to=untrusted'}]) {
  const denied=await f.invoke('request',body,changed);assert([400,401,403].includes(denied.code));
 }
 assert.equal(f.requests.length,0);const sent=await f.invoke('request',body);assert.equal(sent.code,200);
 assert.deepEqual(f.requests,[{input:body,authority:{browserHash:hash(f.browser),sessionHash:hash(f.session),binding:f.config.binding}}]);
 assert.deepEqual(sent.body,{state:'SENT',verified:false});assert.equal(sent.headers['Set-Cookie'],undefined);
});
test('status is authenticated and requires exactly one owned draft selector',async()=>{
 const f=fixture(),id=randomUUID();
 for(const path of ['status','status?draftId='+id+'&draftId='+id,'status?draftId='+id+'&accountId='+randomUUID()])assert.equal((await f.invoke(path)).code,400);
 assert.equal(f.calls.length,0);assert.equal((await f.invoke('status?draftId='+id)).code,200);
 assert.equal(f.calls[0].action,'email_status');assert.equal(f.calls[0].data.draftId,id);assert.equal(f.calls[0].data.sessionHash,hash(f.session));
});
