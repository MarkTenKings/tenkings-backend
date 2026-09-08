import test from 'node:test';
import assert from 'node:assert/strict';
import { DurableStaffAuth } from '../lib/server/access/auth.mjs';
import { StaffIdentityCorrection } from '../lib/server/access/identity-correction.mjs';
import { identityCorrectionRuntimeSettings,createIdentityCorrectionRuntime } from '../lib/server/access/identity-correction-runtime.mjs';
import { identityCorrectionRequestCanonical,makeIdentityCorrectionConfig } from '@atlas/service-bridge/identity-correction';
import { canonical,digest } from '@atlas/service-bridge/protocol';
import { canonicalizeSpeedsterSessionIdentity } from '@atlas/grading-core/identity';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,h=n=>String(n).repeat(64),now=new Date('2026-09-08T18:00:00.000Z');
function fixture(){
    const identity={id:id(1),phoneHash:h(1),name:'Fixture reviewer',role:'REVIEWER',accessVersion:1,revokedAt:null,certificationUntil:null,trustedLearningUntil:null},
        browser={tokenHash:h(2),controlRevision:1,createdAt:new Date(+now-60_000),expiresAt:new Date(+now+600_000)},
        session={tokenHash:h(3),identityId:id(1),browserHash:h(2),accessVersion:1,controlRevision:1,createdAt:new Date(+now-30_000),expiresAt:new Date(+now+600_000),revokedAt:null,browser},
        control={enabled:true,mode:'PRODUCTION',revision:1,origin:'https://app.atlasgrading.com',deploymentId:'staff-fixture.vercel.app',releaseSha:'a'.repeat(40),configHash:h(4),gradingPolicyHash:h(5)},
        assignment={identityId:id(1),specimenId:id(2),canReview:true,revokedAt:null,fence:1,expiresAt:new Date(+now+600_000)};
    const source={cardProfile:'SPORTS',identity:canonicalizeSpeedsterSessionIdentity('SPORTS',{playerName:'Fixture Player',year:'2026',manufacturer:'Synthetic',productSet:'Fixture Set'}),
        capture:{private:'retained capture'},reviewedDefects:[{rawFingerprint:[0.1,0.10000000000000002]}],gradeReport:{private:'retained report'},mapRevisionId:null,mapFilterPolicyVersion:null,mapRegistration:null};
    const sourceCanonical=canonical(source),sourceHash=digest(sourceCanonical),evidenceCanonical=canonical({sourceId:'known-source',sourceOwnerId:'known-owner',sourceRevision:'2026-09-08T17:00:00.000Z'}),evidenceHash=digest(evidenceCanonical);
    const admissionCanonical=canonical({purpose:'atlas-analysis-admission-v1',mode:'PRODUCTION',policyHash:h(5),sourceHash,evidenceHash}),reportCanonical=canonical({identity:source.identity});
    const draft={revision:3,evidenceRevision:1,evidenceHash,observations:'retained',reviewedSides:[],identityReviewed:false},reviewCanonical=canonical(draft);
    const analysis={specimenId:id(2),revision:2,evidenceHash,sourceHash,sourceCanonical,sourceRevision:'2026-09-08T17:59:00.000Z',mode:'PRODUCTION',
        admissionCanonical,admissionHash:digest(admissionCanonical),reportCanonical,reportHash:digest(reportCanonical)},
        review={specimenId:id(2),revision:3,analysisRevision:2,evidenceRevision:1,evidenceHash,canonical:reviewCanonical,contentHash:digest(reviewCanonical)},
        card={id:id(2),sourceId:'known-source',sourceOwnerId:'known-owner',sourceType:'SPEEDSTER',analysisRevision:2,draftRevision:3,evidenceRevision:1,evidenceHash,evidenceCanonical};
    const input={operationId:id(3),expectedAnalysisRevision:2,expectedReviewRevision:3,expectedEvidenceRevision:1,analysisHash:sourceHash,reviewHash:review.contentHash,
        evidenceHash,sourceRevision:analysis.sourceRevision,next:{cardProfile:'SPORTS',identity:{...source.identity,playerName:'FIXTURE PLAYER'}},reason:'Correct capitalization.'};
    const state={inside:false,now,end:now,privateCalls:0,settingsCalls:0,reads:0,headReads:0,receipts:[],sql:[],afterRead:()=>{},privateHook:async()=>{},failFlush:false};
    const tx={staffSession:{findUnique:async({where})=>where.tokenHash===session.tokenHash?session:null},
        staffAnalysisRevision:{findUnique:async()=>analysis},staffReviewRevision:{findUnique:async()=>review},
        async $queryRaw(strings,...values){const sql=strings.join('?');state.sql.push(sql);
            assert(!sql.includes('public.')&&!sql.includes('FROM atlas_staff."StaffIdentityCorrection"'));
            if(sql.includes('clock_timestamp'))return[{now:state.end}];
            if(sql.includes('read_identity_correction_receipt')){
                state.reads++;assert.deepEqual(values.slice(0,3),[card.id,identity.id,input.operationId]);
                assert.deepEqual(values.slice(4),[session.tokenHash,session.browserHash,identity.accessVersion,assignment.fence,control.revision]);
                const found=state.receipts.find(row=>row.operationId===values[2]);
                if(found&&found.inputHash!==values[3])throw Error('ATLAS correction receipt request conflict');
                state.afterRead();return found?[found]:[];
            }
            if(sql.includes('"StaffIdentity"'))return values[0]===identity.id?[identity]:[];
            if(sql.includes('"StaffSpecimen"')){state.headReads++;return[card];}throw Error(sql);
        },async $executeRaw(strings){assert.equal(strings.join(''),'SET CONSTRAINTS ALL IMMEDIATE');if(state.failFlush)throw Error('deferred denial');return 1;}};
    const database={async transaction(work){assert.equal(state.inside,false);state.inside=true;
        try{return await work({tx,now:state.now,control});}finally{state.inside=false;}}};
    const auth=new DurableStaffAuth({database,config:{mode:'PRODUCTION',phoneByHash:new Map([[identity.phoneHash,'fixture-phone']])}}),staff=auth.actor({identity,session},browser.tokenHash),
        reviewStore={assigned:async()=>assignment};
    const committed=()=>{
        const row={receiptId:id(7),operationId:input.operationId,analysisRevision:3,reviewRevision:4,evidenceRevision:2,evidenceHash:h(6),sourceHash:h(7),reviewHash:h(8),createdAt:state.now,
            inputHash:digest(identityCorrectionRequestCanonical(card.id,input)),privateProof:'must never return'};
        state.receipts.push(row);const{inputHash,privateProof,...safe}=row;return{status:'CORRECTED',...safe,createdAt:row.createdAt.toISOString()};
    };
    const bridge={binding:{bridgeConfigHash:h(9),gradingPolicyHash:h(5)},async call(scope,request){
        assert.equal(state.inside,false);assert.equal(scope.actorId,identity.id);assert.equal(scope.specimenId,card.id);assert.equal(scope.sessionHash,session.tokenHash);
        assert.deepEqual(request,input);state.privateCalls++;await state.privateHook(scope,request);return committed();}};
    const service=new StaffIdentityCorrection({auth,review:reviewStore,bridge:()=>{state.settingsCalls++;return bridge;}});
    return{state,identity,session,browser,control,assignment,source,card,analysis,review,input,auth,staff,reviewStore,bridge,service,committed};
}
test('fresh assigned reviewer dispatches outside transaction and returns only restricted committed receipt readback',async()=>{
    const f=fixture(),before=canonical(f.source),result=await f.service.correct(f.staff,f.card.id,f.input);
    assert.equal(result.status,'CORRECTED');assert.equal(result.receiptId,id(7));assert.equal(Object.hasOwn(result,'privateProof'),false);
    assert.equal(f.state.privateCalls,1);assert.equal(f.state.reads,2);assert.equal(f.state.headReads,1);assert.equal(canonical(f.source),before);
    assert.equal(f.identity.certificationUntil,null);assert.equal(f.identity.trustedLearningUntil,null);
});
test('committed replay precedes current heads and all private configuration, including disable/rotation/unavailable settings',async()=>{
    const f=fixture(),expected=f.committed();f.card.analysisRevision=99;f.analysis.sourceHash=h(0);
    const service=new StaffIdentityCorrection({auth:f.auth,review:f.reviewStore,bridge:()=>{throw Error('disabled rotated unavailable');}});
    assert.deepEqual(await service.correct(f.staff,f.card.id,f.input),expected);assert.equal(f.state.headReads,0);assert.equal(f.state.privateCalls,0);
    await assert.rejects(()=>service.correct(f.staff,f.card.id,{...f.input,reason:'Changed request'}),/IDENTITY_REQUEST_CONFLICT/);
});
test('lost private reply reads the same committed result once without redispatch; absent receipt remains unconfirmed',async()=>{
    const f=fixture();f.bridge.call=async()=>{assert.equal(f.state.inside,false);f.state.privateCalls++;f.committed();throw Error('reply lost');};
    assert.equal((await f.service.correct(f.staff,f.card.id,f.input)).status,'CORRECTED');assert.equal(f.state.privateCalls,1);assert.equal(f.state.reads,2);
    const missing=fixture();missing.bridge.call=async()=>{missing.state.privateCalls++;throw Error('unavailable');};
    await assert.rejects(()=>missing.service.correct(missing.staff,missing.card.id,missing.input),/IDENTITY_OUTCOME_UNCONFIRMED/);
    assert.equal(missing.state.privateCalls,1);assert.equal(missing.state.reads,2);
});
test('wire CORRECTED never substitutes for a receipt or different recorded receipt hashes',async()=>{
    for(const kind of ['missing','different','malformed']){const f=fixture();
        f.bridge.call=async()=>{const safe=f.committed();if(kind==='missing')f.state.receipts=[];if(kind==='different')safe.sourceHash=h(0);
            if(kind==='malformed')f.state.receipts[0].analysisRevision=20;return safe;};
        await assert.rejects(()=>f.service.correct(f.staff,f.card.id,f.input),/IDENTITY_(OUTCOME_UNCONFIRMED|RESPONSE_INVALID|RECEIPT_INVALID)/);
    }
});
test('no-change and reprocess outcomes are safe advisory projections with exact head recheck and no authority',async()=>{
    for(const status of ['NO_CHANGE','REPROCESS_REQUIRED']){const f=fixture();if(status==='NO_CHANGE')f.input.next.identity={...f.source.identity};
        const wire={status,identity:f.input.next.identity,reasons:status==='NO_CHANGE'?[]:['EXACT_MAP_KEY_CHANGED'],changedFields:status==='NO_CHANGE'?[]:['playerName']};
        f.bridge.call=async()=>wire;const result=await f.service.correct(f.staff,f.card.id,f.input);
        assert.deepEqual(result,{...wire,advisory:true});assert.equal(f.state.headReads,2);assert.equal(f.state.receipts.length,0);
        assert.equal(Object.hasOwn(result,'receiptId'),false);
    }
    for(const change of ['heads','private','false-no-change']){const f=fixture();f.bridge.call=async()=>{
        const result={status:'REPROCESS_REQUIRED',identity:f.input.next.identity,reasons:['EXACT_MAP_KEY_CHANGED'],changedFields:['playerName']};
        if(change==='heads')f.card.draftRevision++;if(change==='private')result.capture={raw:'do not expose'};
        if(change==='false-no-change')Object.assign(result,{status:'NO_CHANGE',reasons:[],changedFields:[]});return result;};
        await assert.rejects(()=>f.service.correct(f.staff,f.card.id,f.input),/IDENTITY_(HEAD_CHANGED|RESPONSE_INVALID)/);
    }
});
test('forged opaque actors, stale sessions, observers and revoked browser/assignment fail before private work even on replay',async()=>{
    const f=fixture();await assert.rejects(()=>f.service.correct({...f.staff},f.card.id,f.input),/SIGN_IN_REQUIRED/);
    for(const mutate of [f=>{f.identity.role='OBSERVER';},f=>{f.session.createdAt=new Date(+now-300001);},f=>{f.assignment.canReview=false;},
        f=>{f.assignment.revokedAt=now;},f=>{f.browser.expiresAt=now;},f=>{f.session.revokedAt=now;},f=>{f.identity.accessVersion++;}]){
        const f=fixture();f.committed();mutate(f);await assert.rejects(()=>f.service.correct(f.staff,f.card.id,f.input));assert.equal(f.state.privateCalls,0);assert.equal(f.state.settingsCalls,0);
    }
});
test('permission/fence/session expiry after external work cannot return success; retained receipt remains recoverable',async()=>{
    for(const mutate of [f=>{f.assignment.fence++;},f=>{f.assignment.canReview=false;},f=>{f.session.revokedAt=now;},
        f=>{f.state.end=new Date(+now+301000);},f=>{f.state.failFlush=true;}]){
        const f=fixture();f.state.privateHook=async()=>mutate(f);await assert.rejects(()=>f.service.correct(f.staff,f.card.id,f.input));
        assert.equal(f.state.receipts.length,1);assert.equal(f.state.privateCalls,1);
    }
});
test('even retained readback rechecks clock, opaque session and assignment after the definer returns',async()=>{
    for(const mutate of [f=>{f.assignment.fence++;},f=>{f.session.revokedAt=now;},f=>{f.state.end=new Date(+now+301000);}]){
        const f=fixture();f.committed();f.state.afterRead=()=>mutate(f);
        await assert.rejects(()=>f.service.correct(f.staff,f.card.id,f.input));assert.equal(f.state.privateCalls,0);assert.equal(f.state.settingsCalls,0);
    }
});
test('invalid and stale requests never dispatch, and caller mutation cannot alter the retained input',async()=>{
    for(const change of [input=>{input.next.identity.secret='private';},input=>{input.operationId='bad';},input=>{input.url='https://elsewhere';},
        input=>{input.sourceRevision='not-a-date';},input=>{input.expectedAnalysisRevision=0;}]){const f=fixture();change(f.input);
        await assert.rejects(()=>f.service.correct(f.staff,f.card.id,f.input),/IDENTITY_REQUEST_INVALID/);assert.equal(f.state.privateCalls,0);}
    for(const mutate of [f=>{f.card.draftRevision++;},f=>{f.analysis.sourceCanonical+=' ';},f=>{f.review.contentHash=h(0);}]){
        const f=fixture();mutate(f);await assert.rejects(()=>f.service.correct(f.staff,f.card.id,f.input));assert.equal(f.state.privateCalls,0);}
    const f=fixture(),original=structuredClone(f.input);f.state.privateHook=async(_scope,request)=>{request.reason='mutated bridge clone';};
    assert.equal((await f.service.correct(f.staff,f.card.id,f.input)).status,'CORRECTED');assert.deepEqual(f.input,original);
});
function runtimeFixture(){
    const staffConfig={mode:'PRODUCTION',phoneByHash:new Map([[h(1),'fixture']]),sessionKey:Buffer.alloc(32,1),phoneKey:Buffer.alloc(32,2)},
        env={NODE_ENV:'production',VERCEL_ENV:'production',ATLAS_IDENTITY_CORRECTION_ENABLED:'true',ATLAS_IDENTITY_CORRECTION_ORIGIN:'https://identity.example.test',
            ATLAS_IDENTITY_CORRECTION_KEY:Buffer.alloc(32,3).toString('base64'),ATLAS_IDENTITY_CORRECTION_DEPLOYMENT_ID:'dpl_private',
            ATLAS_IDENTITY_CORRECTION_RELEASE_SHA:'b'.repeat(40),ATLAS_IDENTITY_CORRECTION_GRADING_POLICY_HASH:h(5)};
    return{staffConfig,env};
}
test('runtime requires own production pins/key/policy, exact staff phone hashes, and rejects every reused key',()=>{
    const{env,staffConfig}=runtimeFixture(),settings=identityCorrectionRuntimeSettings(env,staffConfig);
    assert.equal(settings.deploymentId,'dpl_private');assert.equal(settings.phoneAllowlistHash,digest(canonical([h(1)])));
    assert.equal(identityCorrectionRuntimeSettings({},staffConfig),null);
    for(const patch of [{NODE_ENV:'development'},{VERCEL_ENV:'preview'},{ATLAS_LOCAL_SYNTHETIC:'1'},{ATLAS_IDENTITY_CORRECTION_DEPLOYMENT_ID:''},
        {ATLAS_IDENTITY_CORRECTION_RELEASE_SHA:'0'.repeat(40)},{ATLAS_IDENTITY_CORRECTION_GRADING_POLICY_HASH:undefined},
        {ATLAS_IDENTITY_CORRECTION_ALLOWED_PHONE_HASHES_JSON:JSON.stringify([h(2)])},{ATLAS_IDENTITY_CORRECTION_ALLOWED_PHONE_HASHES_JSON:JSON.stringify([h(1),h(1)])},
        {ATLAS_IDENTITY_CORRECTION_KEY:staffConfig.sessionKey.toString('base64')},{ATLAS_IDENTITY_CORRECTION_KEY:staffConfig.phoneKey.toString('base64')}])
        assert.throws(()=>identityCorrectionRuntimeSettings({...env,...patch},staffConfig));
    for(const name of ['ATLAS_GRADING_BRIDGE_KEY','ATLAS_INTAKE_KEY','ATLAS_TRUSTED_LEARNING_KEY','ATLAS_OPERATOR_EVIDENCE_KEY','ATLAS_PUBLIC_MEDIA_KEY','ATLAS_MACHINE_ADMISSION_KEY','ATLAS_MACHINE_EXECUTION_KEY'])
        assert.throws(()=>identityCorrectionRuntimeSettings({...env,[name]:env.ATLAS_IDENTITY_CORRECTION_KEY},staffConfig));
    assert.equal(identityCorrectionRuntimeSettings({...env,ATLAS_IDENTITY_CORRECTION_ALLOWED_PHONE_HASHES_JSON:JSON.stringify([h(1)])},staffConfig).configHash,settings.configHash);
    assert.equal(makeIdentityCorrectionConfig({...settings,otherKeyHashes:[]}).configHash,settings.configHash);
});
test('retained runtime reparses current environment after replay, preserving disabled receipt recovery with no fetch',async()=>{
    const f=fixture(),runtime=runtimeFixture();let env={...runtime.env},settingsReads=0,fetches=0;
    const service=createIdentityCorrectionRuntime({auth:f.auth,review:f.reviewStore,staffConfig:runtime.staffConfig,env:()=>{settingsReads++;return env;},
        fetchImpl:async()=>{fetches++;throw Error('no network');}});
    env.ATLAS_IDENTITY_CORRECTION_ENABLED='false';await assert.rejects(()=>service.correct(f.staff,f.card.id,f.input),/IDENTITY_NOT_CONFIGURED/);assert.equal(fetches,0);
    env={...runtime.env};await assert.rejects(()=>service.correct(f.staff,f.card.id,f.input),/IDENTITY_OUTCOME_UNCONFIRMED/);assert.equal(fetches,1);
    const retained=f.committed();env={...runtime.env,ATLAS_IDENTITY_CORRECTION_ENABLED:'false',ATLAS_IDENTITY_CORRECTION_KEY:'rotated invalid'};
    const count=settingsReads;assert.deepEqual(await service.correct(f.staff,f.card.id,f.input),retained);assert.equal(settingsReads,count);assert.equal(fetches,1);
});
