import test from 'node:test';
import assert from 'node:assert/strict';
import {StaffTrustedLearning,learningCandidatePort} from '../lib/server/access/learning.mjs';
import {DurableStaffAuth} from '../lib/server/access/auth.mjs';
import {learningFixture} from '../../../packages/atlas-service-bridge/test/fixtures/trusted-learning.mjs';
import {canonical} from '../../../packages/atlas-service-bridge/src/protocol.mjs';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,h=n=>String(n).repeat(64);
async function fixture(){
    const f=learningFixture(),wire=await f.run(),row=f.state.rows[0];
    const state={decisions:[],audits:[],privateCalls:0,inspections:0,inside:false,now:f.state.now,end:f.state.now,failAudit:false,afterAudit:()=>{}};
    const baseQuery=f.tx.$queryRaw.bind(f.tx);
    f.tx.$queryRaw=async(strings,...values)=>{const sql=strings.join('?');
        if(sql.includes('clock_timestamp'))return[{now:state.end}];
        if(sql.includes('lock_learning_candidates')){state.inspections++;
            assert.deepEqual(values,[f.i.id,f.session.tokenHash,f.card.id,f.approval.id,row.id]);
            return f.raw.updatedAt.toISOString()===row.sourceRevision&&f.learning.enabled&&f.learning.configHash===row.bridgeConfigHash?[row]:[];}
        return baseQuery(strings,...values);
    };
    f.tx.staffSession={findUnique:async()=>f.session};
    for(const [key,value]of Object.entries({staffPublicReport:f.publication,staffReportApproval:f.approval,staffAnalysisRevision:f.analysis,staffReviewRevision:f.review}))
        f.tx[key]={findUnique:async()=>value};
    f.tx.staffTrustedLearningDecision={findUnique:async({where:{actorId_operationId:k}})=>state.decisions.find(r=>r.actorId===k.actorId&&r.operationId===k.operationId),
        create:async({data})=>{state.decisions.push(structuredClone(data));return data;},findMany:async()=>state.decisions};
    f.tx.staffAudit={create:async({data})=>{if(state.failAudit)throw Error('audit-failure');state.audits.push(data);state.afterAudit();}};
    const database={async transaction(work){const old=structuredClone({decisions:state.decisions,audits:state.audits});state.inside=true;
        try{return await work({tx:f.tx,control:f.control,now:state.now});}catch(e){Object.assign(state,old);throw e;}finally{state.inside=false;}}};
    const auth=new DurableStaffAuth({database,config:{mode:'LOCAL_FIXTURE',phoneByHash:new Map([[f.i.phoneHash,'fixture-only']])}});
    const staff=auth.actor({identity:f.i,session:f.session},f.browser.tokenHash),review={assigned:async()=>f.assignment};
    const client={binding:{bridgeConfigHash:f.config.configHash,gradingPolicyHash:f.config.gradingPolicyHash},async call(scope){
        assert.equal(state.inside,false);assert.deepEqual(scope,f.scope);state.privateCalls++;return wire;}};
    const candidates=learningCandidatePort({client}),service=new StaffTrustedLearning({auth,review,candidates});
    const input={operationId:'learning-operation-1',approvalId:f.approval.id,candidatesId:row.id,bundleHash:row.bundleHash,
        candidateIds:wire.candidates.map(c=>c.candidateId),decision:'APPROVE',reason:'Exact reviewed false positive.'};
    return {...f,bridgeState:f.state,state,wire,row,auth,staff,candidates,service,input};
}
test('preview gets source outside transaction and exposes safe candidates with none selected',async()=>{
    const f=await fixture(),before=canonical(f.snapshot),result=await f.service.preview(f.staff,f.card.id,{approvalId:f.approval.id});
    assert.deepEqual(result.selectedCandidateIds,[]);assert.equal(result.applicationAvailable,false);assert.equal(f.state.privateCalls,1);
    assert.equal(JSON.stringify(result).includes('fingerprint'),false);assert.equal(JSON.stringify(result).includes('rawMask'),false);
    assert.equal(canonical(f.snapshot),before);assert.equal(f.state.decisions.length,0);
});
test('trained human can approve exact selected lesson independently of certification and report approver',async()=>{
    const f=await fixture(),before=canonical(f.snapshot);assert.equal(f.i.certificationUntil,null);assert.notEqual(f.approval.actorId,f.i.id);
    const result=await f.service.decide(f.staff,f.card.id,f.input);
    assert.equal(result.status,'APPROVED_PENDING_APPLICATION');assert.equal(result.applicationAvailable,false);
    assert.equal(f.state.decisions.length,1);assert.equal(f.state.audits[0].event,'ATLAS_TRUSTED_LEARNING_DECIDED');assert.equal(f.state.inspections,2);
    assert.equal(canonical(f.snapshot),before);assert.equal(JSON.stringify(f.state.decisions).includes('fingerprint"'),false);
    assert.deepEqual((await f.service.read(f.staff,f.card.id)).decisions,[result]);
});
test('rejection is a durable explicit per-lesson fact and empty/default selection creates nothing',async()=>{
    const f=await fixture();assert.throws(()=>f.service.decide(f.staff,f.card.id,{...f.input,candidateIds:[]}),/LEARNING_REQUEST_INVALID/);
    const result=await f.service.decide(f.staff,f.card.id,{...f.input,decision:'REJECT'});assert.equal(result.status,'REJECTED');assert.equal(result.applicationAvailable,false);
});
test('lost decision reply replays exact retained fact before stale source inspection; changed operation input conflicts',async()=>{
    const f=await fixture(),result=await f.service.decide(f.staff,f.card.id,f.input),inspections=f.state.inspections;
    f.raw.updatedAt=new Date(+f.raw.updatedAt+1);f.publication.currentApprovalId=id(8);f.row.expiresAt=f.state.now;
    assert.deepEqual(await f.service.decide(f.staff,f.card.id,f.input),result);assert.equal(f.state.inspections,inspections);assert.equal(f.state.privateCalls,0);
    await assert.rejects(f.service.decide(f.staff,f.card.id,{...f.input,reason:'Changed reason'}),/LEARNING_REQUEST_CONFLICT/);
    assert.equal(f.state.decisions.length,1);assert.equal(f.state.audits.length,1);
});
test('opaque durable HUMAN reviewer, distinct training, browser freshness and assignment remain mandatory on replay',async()=>{
    const f=await fixture();assert.throws(()=>f.service.decide({...f.staff},f.card.id,f.input),/SIGN_IN_REQUIRED/);
    for(const mutate of [f=>f.i.trustedLearningUntil=null,f=>f.i.trustedLearningUntil=f.state.now,f=>f.i.role='OBSERVER',
        f=>f.session.createdAt=new Date(+f.state.now-300001),f=>f.assignment.canReview=false,f=>f.browser.expiresAt=f.state.now,
        f=>f.session.revokedAt=f.state.now,f=>f.i.accessVersion++]){
        const f=await fixture();await f.service.decide(f.staff,f.card.id,f.input);f.i.certificationUntil=new Date(+f.state.now+600000);mutate(f);
        await assert.rejects(f.service.decide(f.staff,f.card.id,f.input));assert.equal(f.state.decisions.length,1);
    }
});
test('new decisions reject stale exact approval, analysis, raw source, candidate hash and expired receipts',async()=>{
    for(const mutate of [f=>f.publication.currentApprovalId=id(8),f=>f.analysis.sourceCanonical+=' ',f=>f.card.analysisRevision++,
        f=>f.raw.updatedAt=new Date(+f.raw.updatedAt+1),f=>f.row.candidateCanonical+=' ',f=>f.row.expiresAt=f.state.now,
        f=>f.row.assignmentFence++,f=>f.row.actorId=id(8),f=>f.learning.enabled=false,f=>f.learning.configHash=h(8)]){
        const f=await fixture();mutate(f);await assert.rejects(f.service.decide(f.staff,f.card.id,f.input));assert.equal(f.state.decisions.length,0);
    }
    const f=await fixture();await assert.rejects(f.service.decide(f.staff,f.card.id,{...f.input,candidateIds:[h(9)]}),/LEARNING_CANDIDATES_CHANGED/);
});
test('audit failure, final session/training expiry, source receipt expiry and deferred failures roll back decisions',async()=>{
    for(const mutate of [f=>f.state.failAudit=true,f=>f.state.afterAudit=()=>{f.session.revokedAt=f.state.now;},
        f=>f.state.afterAudit=()=>{f.i.trustedLearningUntil=f.state.now;},f=>f.state.afterAudit=()=>{f.state.end=new Date(+f.state.now+300001);},
        f=>f.state.afterAudit=()=>{f.row.expiresAt=f.state.now;},f=>f.state.afterAudit=()=>{f.assignment.fence++;},f=>f.bridgeState.failFlush=true]){
        const f=await fixture();mutate(f);await assert.rejects(f.service.decide(f.staff,f.card.id,f.input));assert.equal(f.state.decisions.length,0);assert.equal(f.state.audits.length,0);
    }
});
test('disabled candidate generation preserves current-human history and exact lost-reply recovery only',async()=>{
    const f=await fixture(),service=new StaffTrustedLearning({auth:f.auth,review:{assigned:async()=>f.assignment}});
    assert.deepEqual((await service.read(f.staff,f.card.id)).decisions,[]);
    await assert.rejects(service.preview(f.staff,f.card.id,{approvalId:f.approval.id}),/LEARNING_NOT_CONFIGURED/);
    await assert.rejects(service.decide(f.staff,f.card.id,f.input),/LEARNING_NOT_CONFIGURED/);
    const receipt=await f.service.decide(f.staff,f.card.id,f.input);
    assert.deepEqual(await service.decide(f.staff,f.card.id,f.input),receipt);
    assert.deepEqual((await service.read(f.staff,f.card.id)).decisions,[receipt]);
    f.i.trustedLearningUntil=null;
    await assert.rejects(service.decide(f.staff,f.card.id,f.input),/FRESH_TRUSTED_LEARNING_REVIEWER_REQUIRED/);
    assert.equal(f.state.decisions.length,1);
});
