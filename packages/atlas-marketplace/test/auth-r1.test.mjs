import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import { createHmac,createHash } from 'node:crypto';
import { createR1MarketplaceAuthBridge, R1_SESSION_ACCESS_ACTION, R1_SESSION_ACCESS_SCHEMA,readR1ProofRequest } from '../src/auth-r1.mjs';
import { DurableStaffAuth as CanonicalStaffAuth } from '../../../frontend/atlas-app/lib/server/access/auth.mjs';
import { CustomerAuth as CanonicalCustomerAuth } from '../../../frontend/atlas-customer/lib/server/auth.mjs';

const id='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
const sessionHash='1'.repeat(64),browserHash='2'.repeat(64),cookie='opaque_fixture_cookie';
const denied=code=>Object.assign(new Error(code),{code});
function fixture({role='BUYER',method='GET',staffRoles=['REVIEWER'],maxDatabaseClockSkewMs=0,existingIdentityOnly=false}={}) {
  const control={now:1792706400000,revoked:false,accountId:id,staffRole:'REVIEWER',gatewayMissing:false,extraResult:{},calls:[],admissions:0,limited:false,guardCalls:0,refreshes:0,boundaryActive:false,boundaryVisits:0,handle:null};
  const config={mode:'LOCAL_FIXTURE',origin:'http://127.0.0.1:4318',deploymentId:'isolated-auth-contract-test',releaseSha:'a'.repeat(40),configHash:'b'.repeat(64),cookies:{browser:'fixture_browser',session:'fixture_session'}};
  config.binding=Object.fromEntries(['mode','origin','deploymentId','releaseSha','configHash'].map(key=>[key,config[key]]));
  if(existingIdentityOnly)Object.assign(config,{existingIdentityOnly:true,phoneByHash:new Map([['3'.repeat(64),'ISOLATED_PHONE_FIXTURE']]),phoneHash:()=>'3'.repeat(64),identityIdForPhoneHash:value=>value==='3'.repeat(64)?id:null,
    phoneIdentityRegistry:{version:1,keyVersion:'fixture',entries:[{newPhoneHash:'4'.repeat(64),canonicalPhoneHash:'3'.repeat(64),identityId:id}]}});
  class CustomerDatabase {
    constructor(){this.config=config;}
    async call(action,data) {
      control.calls.push({action,data});
      if(control.gatewayMissing) throw denied('NOT_FOUND');
      if(control.revoked) throw denied('SIGN_IN_REQUIRED');
      assert.equal(action,R1_SESSION_ACCESS_ACTION); assert.deepEqual(Object.keys(data).sort(),['browserHash','sessionHash']);
      return {schema:R1_SESSION_ACCESS_SCHEMA,accountId:control.accountId,sessionHash,browserHash,expiresAt:control.now+60000,observedAt:control.now,...control.extraResult};
    }
  }
  class CustomerAuth {
    constructor(){this.config=config;this.database=new CustomerDatabase();}
    digest(value){return createHmac('sha256','ISOLATED_TEST_ONLY_NO_CREDENTIAL').update(value).digest('hex');}
    authority(header){if(header!==cookie)throw denied('SIGN_IN_REQUIRED');return {sessionHash,browserHash};}
  }
  class DurableStaffAuth {
    constructor(){this.config=config;this.database={};this.actors=new WeakMap();}
    digest(value){return createHmac('sha256','ISOLATED_TEST_ONLY_NO_CREDENTIAL').update(value).digest('hex');}
    async authenticate(header){if(header!==cookie||control.revoked)throw denied('SIGN_IN_REQUIRED');const staff={id,role:control.staffRole};this.actors.set(staff,{sessionHash,browserHash});control.handle=staff;return staff;}
    async withStaff(handle,work){if(!this.actors.has(handle)||control.revoked)throw denied('SIGN_IN_REQUIRED');return work({identity:{id,phoneHash:'3'.repeat(64),role:control.staffRole,accessVersion:1},session:{identityId:id,tokenHash:sessionHash,browserHash,accessVersion:1,expiresAt:new Date(control.now+60000)}});}
  }
  DurableStaffAuth.prototype.identityMatches=CanonicalStaffAuth.prototype.identityMatches;
  const customerAuth=new CustomerAuth(),staffAuth=new DurableStaffAuth();
  const guard=()=>{control.guardCalls++;};
  const boundary={async transaction(handle,work){assert.equal(handle,control.handle);assert.equal(staffAuth.actors.has(handle),true);assert.equal(control.boundaryActive,false);control.boundaryActive=true;control.boundaryVisits++;try{const refresh=async()=>{control.refreshes++;if(control.revoked)throw denied('SIGN_IN_REQUIRED');return {principal:{id,role:control.staffRole,accessVersion:1},now:new Date(control.now)};};const current=await refresh();const result=await work({...current,refresh});await refresh();return result;}finally{control.boundaryActive=false;}}};
  const options={enabled:true,environment:'PROVIDER_SANDBOX',policy:{approved:true,approvalRef:'ISOLATED_AUTH_POLICY_TEST_ONLY',environment:'PROVIDER_SANDBOX',r1Mode:'LOCAL_FIXTURE',staffRoles,customerRoles:['BUYER','SELLER']},
    staff:{state:{auth:staffAuth,assertRequest:guard},boundary,DurableStaffAuth},customer:{state:{auth:customerAuth,config,assertRequest:guard},CustomerAuth,CustomerDatabase},clock:()=>control.now,
    maxDatabaseClockSkewMs,admitRequest:async input=>{control.admissions++;assert.equal(input.actorId,id);return !control.limited;}};
  const request={method,url:role==='STAFF'?'/admin/marketplace/api/workspace':'/account/marketplace/api/workspace',headers:{cookie,host:'127.0.0.1:4318',origin:config.origin,'sec-fetch-site':'same-origin'},socket:{remoteAddress:'127.0.0.1'},body:method==='POST'?{actor:{id:other,role:'STAFF'}}:undefined};
  const path='/workspace',bridge=createR1MarketplaceAuthBridge(options);
  const open=()=>bridge.open(request,{audience:role});
  const resolve=ctx=>ctx.resolveSession({cookie,method,path});
  const admit=(ctx,principal)=>ctx.admitRequest({sessionId:principal.sessionId,actorId:principal.actor.id,method,path});
  const csrf=async(ctx,principal)=>ctx.verifyCsrf({principal,token:await ctx.issueCsrf(principal),method,path});
  return {control,options,request,bridge,open,resolve,admit,csrf,path};
}

test('R1 auth bridge is disabled without approved server composition and missing customer gateway never falls back to cookies or bootstrap',async()=>{
  assert.throws(()=>createR1MarketplaceAuthBridge().open({},{audience:'BUYER'}),{code:'AUTH_BOUNDARY_UNAVAILABLE'});
  const f=fixture();f.options.policy.approved=false;assert.throws(f.open,{code:'AUTH_BOUNDARY_UNAVAILABLE'});
  const missing=fixture();missing.control.gatewayMissing=true;const ctx=missing.open();await assert.rejects(missing.resolve(ctx),{code:'AUTH_BOUNDARY_UNAVAILABLE'});
  assert.deepEqual(missing.control.calls.map(row=>row.action),[R1_SESSION_ACCESS_ACTION]);
  const noLimiter=fixture();delete noLimiter.options.admitRequest;assert.throws(noLimiter.open,{code:'AUTH_BOUNDARY_UNAVAILABLE'});
});

test('customer identity comes only from exact live gateway result; copied principals and request actor claims confer no authority',async()=>{
  const f=fixture({method:'POST'}),ctx=f.open(),principal=await f.resolve(ctx);
  assert.equal(principal.actor.id,id);assert.equal(principal.actor.role,'BUYER');assert.equal(principal.sessionHash,undefined);
  await assert.rejects(ctx.issueCsrf({...principal}),{code:'SIGN_IN_REQUIRED'});
  await f.admit(ctx,principal);
  assert.equal(await ctx.verifyCsrf({principal,token:'é'.repeat(64),method:'POST',path:f.path}),false);
  await assert.rejects(ctx.withAuthorized(principal,()=>assert.fail('CSRF bypass')),{code:'CSRF_REFUSED'});
  assert.equal(await f.csrf(ctx,principal),true);
  assert.deepEqual(await ctx.withAuthorized(principal,actor=>({...actor})),{id,role:'BUYER'});
  assert.ok(f.control.calls.length>=5);assert.equal(f.control.guardCalls,1);assert.equal(f.control.admissions,1);
  await assert.rejects(ctx.withAuthorized(principal,()=>assert.fail('duplicate')),{code:'AUTH_REQUEST_CONSUMED'});
  ctx.close();await assert.rejects(f.resolve(ctx),{code:'SIGN_IN_REQUIRED'});
});

test('customer gateway mismatches, internal metadata, stale evidence and account switching fail closed',async()=>{
  for(const extraResult of [{sessionHash:'f'.repeat(64)},{browserHash:'f'.repeat(64)},{customer:{id}},{expiresAt:1},{observedAt:1},{accountId:'claimed-account'}]) {
    const f=fixture();f.control.extraResult=extraResult;await assert.rejects(f.resolve(f.open()),{code:'AUTH_BOUNDARY_UNAVAILABLE'});
  }
  const f=fixture(),ctx=f.open(),principal=await f.resolve(ctx);await f.admit(ctx,principal);
  f.control.accountId=other;await assert.rejects(ctx.withAuthorized(principal,()=>assert.fail('changed account')),{code:'SIGN_IN_REQUIRED'});
});

test('staff service work executes outside both short authority transactions with the original handle and a reviewer-only policy',async()=>{
  const f=fixture({role:'STAFF',method:'POST'}),ctx=f.open(),principal=await f.resolve(ctx);
  assert.deepEqual(principal.actor,{id,role:'STAFF'});assert.equal(principal.staffHandle,undefined);
  await f.admit(ctx,principal);await f.csrf(ctx,principal);
  assert.equal(await ctx.withAuthorized(principal,async actor=>{assert.equal(actor.id,id);assert.equal(f.control.boundaryActive,false);assert.equal(f.control.boundaryVisits,1);await Promise.resolve();f.control.now+=20000;assert.equal(f.control.boundaryActive,false);return 'accepted';}),'accepted');
  assert.equal(f.control.boundaryVisits,2);assert.equal(f.control.boundaryActive,false);assert.ok(f.control.refreshes>=4);assert.equal(f.control.guardCalls,1);
  const observer=fixture({role:'STAFF'});observer.control.staffRole='OBSERVER';await assert.rejects(observer.resolve(observer.open()),{code:'SIGN_IN_REQUIRED'});
  for(const staffRoles of [['OBSERVER'],['REVIEWER','OBSERVER']]){const configuredObserver=fixture({role:'STAFF',staffRoles});assert.throws(configuredObserver.open,{code:'AUTH_BOUNDARY_UNAVAILABLE'});assert.equal(configuredObserver.control.handle,null);}
  const revoked=fixture({role:'STAFF'}),otherCtx=revoked.open(),otherPrincipal=await revoked.resolve(otherCtx);await revoked.admit(otherCtx,otherPrincipal);revoked.control.revoked=true;
  await assert.rejects(otherCtx.withAuthorized(otherPrincipal,()=>assert.fail('revoked staff')),{code:'SIGN_IN_REQUIRED'});
});

test('revocation after work suppresses its response without claiming rollback; ingress, method and capability changes cannot reuse the request',async()=>{
  for(const role of ['BUYER','STAFF']) {
    const f=fixture({role}),ctx=f.open(),principal=await f.resolve(ctx);await f.admit(ctx,principal);let effects=0;
    await assert.rejects(ctx.withAuthorized(principal,()=>{effects++;f.control.revoked=true;return 'must not publish';}),{code:'SIGN_IN_REQUIRED'});
    assert.equal(effects,1);assert.equal(f.control.guardCalls,1);assert.equal(f.control.boundaryActive,false);
  }
  const f=fixture(),ctx=f.open(),principal=await f.resolve(ctx);await f.admit(ctx,principal);f.request.url='/account/different';
  await assert.rejects(ctx.withAuthorized(principal,()=>assert.fail('changed ingress')),{code:'AUTH_BOUNDARY_UNAVAILABLE'});
  const swapped=fixture(),swapCtx=swapped.open();swapped.options.customer.state.auth.authority=()=>({sessionHash,browserHash});await assert.rejects(swapped.resolve(swapCtx),{code:'AUTH_BOUNDARY_UNAVAILABLE'});
  const asyncGuard=fixture();asyncGuard.options.customer.state.assertRequest=async()=>{};assert.throws(asyncGuard.open,{code:'AUTH_BOUNDARY_UNAVAILABLE'});
  const rate=fixture(),rateCtx=rate.open(),ratePrincipal=await rate.resolve(rateCtx);rate.control.limited=true;assert.equal(await rate.admit(rateCtx,ratePrincipal),false);await assert.rejects(rateCtx.withAuthorized(ratePrincipal,()=>assert.fail('rate bypass')),{code:'RATE_LIMITED'});
});

test('bounded database clock skew shortens expiry and conservatively checks freshness without accepting arbitrary future observations',async()=>{
  for(const maxDatabaseClockSkewMs of [-1,2001,1.5]) {const f=fixture({maxDatabaseClockSkewMs});assert.throws(f.open,{code:'AUTH_BOUNDARY_UNAVAILABLE'});}
  const strict=fixture();strict.control.extraResult={observedAt:strict.control.now+1};await assert.rejects(strict.resolve(strict.open()),{code:'AUTH_BOUNDARY_UNAVAILABLE'});
  const f=fixture({maxDatabaseClockSkewMs:2000});f.control.extraResult={observedAt:f.control.now+2000,expiresAt:f.control.now+10000};
  const ctx=f.open(),principal=await f.resolve(ctx);assert.equal(principal.expiresAt,f.control.now+8000);await f.admit(ctx,principal);
  f.control.now+=8000;await assert.rejects(ctx.withAuthorized(principal,()=>assert.fail('expired')),{code:'SIGN_IN_REQUIRED'});
  for(const offset of [2001,-28001]) {const old=fixture({maxDatabaseClockSkewMs:2000});old.control.extraResult={observedAt:old.control.now+offset};await assert.rejects(old.resolve(old.open()),{code:'AUTH_BOUNDARY_UNAVAILABLE'});}
  const boundary=fixture({maxDatabaseClockSkewMs:2000});boundary.control.extraResult={observedAt:boundary.control.now-28000};assert.equal((await boundary.resolve(boundary.open())).actor.id,id);
  const almostExpired=fixture({maxDatabaseClockSkewMs:2000});almostExpired.control.extraResult={observedAt:almostExpired.control.now-1,expiresAt:almostExpired.control.now+2000};await assert.rejects(almostExpired.resolve(almostExpired.open()),{code:'SIGN_IN_REQUIRED'});
});

test('clock rollback, deadline jumps and revoked sessions cannot reuse a clock-skew allowance',async()=>{
  for(const offset of [-1,30000]) {
    const f=fixture({maxDatabaseClockSkewMs:2000}),ctx=f.open(),principal=await f.resolve(ctx);await f.admit(ctx,principal);f.control.now+=offset;
    await assert.rejects(ctx.withAuthorized(principal,()=>assert.fail('clock changed')),{code:offset<0?'AUTH_BOUNDARY_UNAVAILABLE':'SIGN_IN_REQUIRED'});
  }
  const f=fixture({maxDatabaseClockSkewMs:2000}),ctx=f.open(),principal=await f.resolve(ctx);await f.admit(ctx,principal);f.control.revoked=true;
  await assert.rejects(ctx.withAuthorized(principal,()=>assert.fail('revoked')),{code:'SIGN_IN_REQUIRED'});
});


test('scoped commit capability rejects expiry/abort and detects in-place binary mutation without holding R1 locks',async()=>{
  for(const mutation of ['expiry','abort','bytes']){
    const f=fixture({role:'STAFF',method:'POST'});f.request.rawBody=Buffer.alloc(1048576,3);
    const ctx=f.open(),principal=await f.resolve(ctx);await f.admit(ctx,principal);await f.csrf(ctx,principal);
    await assert.rejects(ctx.withAuthorized(principal,async(actor,capability)=>{
      assert.equal(capability.authorizeCommit(),true);assert.equal(f.control.boundaryActive,false);
      await capability.refreshAuthorization();assert.equal(f.control.boundaryActive,false);
      if(mutation==='expiry')f.control.now+=30000;else if(mutation==='abort')f.request.aborted=true;else f.request.rawBody[0]=4;
      capability.authorizeCommit();assert.fail('expired/changed request committed');
    }),{code:mutation==='bytes'?'AUTH_BOUNDARY_UNAVAILABLE':'SIGN_IN_REQUIRED'});
    ctx.close();
  }
});
test('scoped refresh rereads revoked canonical customer and staff access before publication',async()=>{
  for(const role of ['BUYER','STAFF']){const f=fixture({role}),ctx=f.open(),principal=await f.resolve(ctx);await f.admit(ctx,principal);
    await assert.rejects(ctx.withAuthorized(principal,async(_actor,capability)=>{f.control.revoked=true;await capability.refreshAuthorization();assert.fail('revoked access committed');}),{code:'SIGN_IN_REQUIRED'});
    assert.equal(f.control.boundaryActive,false);ctx.close();
  }
});

test('rotated staff identity uses the canonical registry mapping and refuses another existing identity',async()=>{
  const f=fixture({role:'STAFF',existingIdentityOnly:true}),ctx=f.open(),principal=await f.resolve(ctx);
  await f.admit(ctx,principal);assert.equal(await ctx.withAuthorized(principal,actor=>actor.id),id);ctx.close();
  const wrong=fixture({role:'STAFF',existingIdentityOnly:true});wrong.options.staff.state.auth.config.identityIdForPhoneHash=()=>other;
  await assert.rejects(wrong.resolve(wrong.open()),{code:'SIGN_IN_REQUIRED'});
  const missing=fixture({role:'STAFF',existingIdentityOnly:true});delete missing.options.staff.DurableStaffAuth.prototype.identityMatches;
  assert.throws(missing.open,{code:'AUTH_BOUNDARY_UNAVAILABLE'});
});

test('staff request detects registry, roster and identity helper replacement before dispatch',async()=>{
  const changes=[
    auth=>{auth.config.existingIdentityOnly=false;},
    auth=>{auth.config.phoneIdentityRegistry.entries[0].identityId=other;},
    auth=>{auth.config.phoneByHash.set('3'.repeat(64),'CHANGED_FIXTURE');},
    auth=>{auth.config.phoneByHash=new Map(auth.config.phoneByHash);},
    auth=>{auth.config.identityIdForPhoneHash=()=>id;},
    auth=>{auth.config.phoneHash=()=>'3'.repeat(64);},
    auth=>{auth.identityMatches=()=>true;},
  ];
  for(const change of changes){const f=fixture({role:'STAFF',existingIdentityOnly:true}),ctx=f.open(),principal=await f.resolve(ctx);await f.admit(ctx,principal);change(f.options.staff.state.auth);
    await assert.rejects(ctx.withAuthorized(principal,()=>assert.fail('changed identity binding dispatched')),{code:'AUTH_BOUNDARY_UNAVAILABLE'});ctx.close();}
});

test('actual socket close ends an admitted request even when the request aborted flag is not set',async()=>{
 const f=fixture({role:'STAFF',method:'POST'});f.request.socket=Object.assign(new EventEmitter(),{remoteAddress:'127.0.0.1'});const ctx=f.open(),principal=await f.resolve(ctx);await f.admit(ctx,principal);await f.csrf(ctx,principal);
 await assert.rejects(ctx.withAuthorized(principal,async(_actor,capability)=>{f.request.socket.emit('close');assert.equal(f.request.aborted,undefined);await capability.refreshAuthorization();}),{code:'SIGN_IN_REQUIRED'});
 ctx.close();assert.equal(f.request.socket.listenerCount('close'),0);
});

test('canonical staff request owns the private proof lifetime; copied or completed authority cannot be reused',async()=>{
 const now=Date.now(),token=Buffer.alloc(32,1).toString('base64url'),browser=Buffer.alloc(32,2).toString('base64url'),sha=v=>createHash('sha256').update(v).digest('hex'),phoneHash='3'.repeat(64);
 const config={mode:'LOCAL_FIXTURE',origin:'http://127.0.0.1:4318',deploymentId:'STRUCTURAL_ONLY',releaseSha:'a'.repeat(40),configHash:'b'.repeat(64),sessionKey:Buffer.alloc(32,3),cookies:{session:'fixture_session',browser:'fixture_browser'},existingIdentityOnly:true,phoneByHash:new Map([[phoneHash,'STRUCTURAL_ONLY']]),identityIdForPhoneHash:()=>id,phoneHash:()=>phoneHash,phoneIdentityRegistry:{version:1}};
 const identity={id,role:'REVIEWER',accessVersion:1,phoneHash},session={tokenHash:sha(token),browserHash:sha(browser),identityId:id,accessVersion:1,controlRevision:1,expiresAt:new Date(now+60000),browser:{controlRevision:1,expiresAt:new Date(now+60000)}};
 const database={async transaction(work){return work({now:new Date(now),control:{revision:1},tx:{staffSession:{findUnique:async()=>session},$queryRaw:async()=>[identity]}});}},auth=new CanonicalStaffAuth({database,config}),socket=new EventEmitter(),request={method:'POST',url:'/admin/marketplace/api/proofs/prepare',headers:{cookie:`fixture_session=${token}; fixture_browser=${browser}`,origin:config.origin},socket};
 const boundary={async transaction(_,work){const context={principal:{id,role:'REVIEWER',accessVersion:1},refresh:async()=>context};return work(context);}},bridge=createR1MarketplaceAuthBridge({enabled:true,environment:'PROVIDER_SANDBOX',policy:{approved:true,approvalRef:'STRUCTURAL_ONLY',environment:'PROVIDER_SANDBOX',r1Mode:'LOCAL_FIXTURE',staffRoles:['REVIEWER'],customerRoles:['BUYER']},staff:{state:{auth,assertRequest(){}},boundary,DurableStaffAuth:CanonicalStaffAuth},clock:()=>now,admitRequest:async()=>true}),ctx=bridge.open(request,{audience:'STAFF'});
 const principal=await ctx.resolveSession({cookie:request.headers.cookie,method:'POST',path:'/proofs/prepare'});await ctx.admitRequest({sessionId:principal.sessionId,actorId:id,method:'POST',path:'/proofs/prepare'});await ctx.verifyCsrf({principal,method:'POST',path:'/proofs/prepare',token:await ctx.issueCsrf(principal)});
 let retained,signal;await ctx.withAuthorized(principal,async(actor,authority)=>{retained=authority;const proof=await readR1ProofRequest(authority);assert.equal(proof.actorId,actor.id);assert.equal(proof.sessionHash,session.tokenHash);assert.equal(proof.browserHash,session.browserHash);signal=proof.signal;assert.equal(signal.aborted,false);await assert.rejects(readR1ProofRequest({...authority}),{code:'AUTH_BOUNDARY_UNAVAILABLE'});});
 assert.equal(signal.aborted,true);await assert.rejects(readR1ProofRequest(retained),{code:'AUTH_BOUNDARY_UNAVAILABLE'});ctx.close();assert.equal(socket.listenerCount('close'),0);
});

test('feature-off canonical staff and customer logout retain their original database path and DTO',async()=>{
 const token=Buffer.alloc(32,4).toString('base64url'),browser=Buffer.alloc(32,5).toString('base64url'),config={sessionKey:Buffer.alloc(32,6),cookies:{session:'fixture_session',browser:'fixture_browser'}},header=`fixture_session=${token}; fixture_browser=${browser}`,sha=v=>createHash('sha256').update(v).digest('hex');let updates=0,audits=0;
 const staff=new CanonicalStaffAuth({config,database:{async transaction(work){return work({now:new Date(),tx:{staffSession:{findUnique:async()=>({tokenHash:sha(token),browserHash:sha(browser),challengeId:'structural',identityId:id}),update:async()=>{updates++;}},staffAudit:{create:async()=>{audits++;}}}});}}});
 assert.equal(await staff.logout(header,staff.digest(`session:${token}`)),undefined);assert.equal(updates,1);assert.equal(audits,1);
 let calls=0;const customer=new CanonicalCustomerAuth({config,database:{async call(action,value){calls++;assert.equal(action,'logout');assert.deepEqual(value,{sessionHash:sha(token),browserHash:sha(browser)});return {signedOut:true};}}});
 assert.deepEqual(await customer.logout(header,customer.digest(`session:${token}`)),{signedOut:true});assert.equal(calls,1);
});
