import assert from 'node:assert/strict';
import {canonical,digest} from '../../src/protocol.mjs';
import {makeTrustedLearningConfig,ScopedTrustedLearningCandidates,signTrustedLearningRequest} from '../../src/trusted-learning.mjs';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,h=n=>String(n).repeat(64);
export function learningFixture(){
    const now=new Date(),state={now,end:now,rows:[],inside:false,failFlush:false,generatorCalls:0};
    const config=makeTrustedLearningConfig({mode:'LOCAL_FIXTURE',origin:'https://learning.example.test',deploymentId:'local-private',releaseSha:'0'.repeat(40),
        key:Buffer.alloc(32,9),gradingPolicyHash:h(1),phoneAllowlistHash:h(2),otherKeyHashes:[]});
    const control={id:'active',enabled:true,mode:'LOCAL_FIXTURE',origin:'http://127.0.0.1:4318',deploymentId:'local-staff',releaseSha:'0'.repeat(40),
        configHash:h(3),gradingPolicyHash:h(1),revision:1};
    const i={id:id(1),phoneHash:h(4),role:'REVIEWER',accessVersion:1,revokedAt:null,certificationUntil:null,trustedLearningUntil:new Date(+now+600000)};
    const browser={tokenHash:h(5),controlRevision:1,createdAt:new Date(+now-2000),expiresAt:new Date(+now+600000)};
    const session={tokenHash:h(6),identityId:i.id,browserHash:browser.tokenHash,browser,accessVersion:1,controlRevision:1,revokedAt:null,
        createdAt:new Date(+now-1000),expiresAt:new Date(+now+600000)};
    const assignment={specimenId:id(2),identityId:i.id,canReview:true,fence:2,revokedAt:null,expiresAt:new Date(+now+600000)};
    const raw={id:'existing-source',createdByUserId:'existing-owner',workflowState:'CAPTURED',updatedAt:new Date(+now-5000)};
    const finding={id:'finding-1',origin:'DETECTOR',reviewResult:'REMOVED',defectType:'VISIBLE_WHITENING',detectedDefectType:'VISIBLE_WHITENING',
        featureFingerprint:Array.from({length:32},(_,n)=>n===0?1:0),sourceViewId:'FRONT:ORIGINAL',rawMask:{sha256:h(9)}};
    const snapshot={reviewedDefects:[finding],capture:{},gradeReport:{detectorVersion:'explicit-fixture'}};
    const evidence={sourceId:raw.id,sourceOwnerId:raw.createdByUserId,sourceRevision:raw.updatedAt.toISOString(),sides:{FRONT:{sha256:h(7)},BACK:{sha256:h(8)}}};
    const sourceCanonical=canonical(snapshot),evidenceCanonical=canonical(evidence);
    const card={id:id(2),sourceType:'LOCAL_FIXTURE',sourceId:raw.id,sourceOwnerId:raw.createdByUserId,evidenceCanonical,evidenceHash:digest(evidenceCanonical),analysisRevision:1,draftRevision:2};
    const analysis={specimenId:card.id,revision:1,sourceCanonical,sourceHash:digest(sourceCanonical),evidenceHash:card.evidenceHash,sourceRevision:raw.updatedAt.toISOString(),mode:'LOCAL_FIXTURE'};
    analysis.admissionCanonical=canonical({purpose:'atlas-analysis-admission-v1',policyHash:control.gradingPolicyHash,sourceHash:analysis.sourceHash,evidenceHash:card.evidenceHash,mode:'LOCAL_FIXTURE'});
    analysis.admissionHash=digest(analysis.admissionCanonical);
    const approval={id:id(3),specimenId:card.id,actorId:id(9),analysisRevision:1,reviewRevision:2,evidenceHash:card.evidenceHash,analysisHash:analysis.sourceHash,reviewHash:h(7)};
    const publication={specimenId:card.id,currentApprovalId:approval.id},review={specimenId:card.id,revision:2,contentHash:h(7)};
    const learning={...config,enabled:true,revision:1};
    let clocks=0;
    const tx={async $queryRaw(strings,...values){const sql=strings.join('?');
        if(sql.includes('clock_timestamp'))return[{now:++clocks%2?state.now:state.end}];
        if(sql.includes('"StaffLearningCandidates"'))return state.rows.filter(r=>r.id===values[0]);
        for(const [name,value]of Object.entries({StaffControl:control,StaffLearningControl:learning,StaffIdentity:i,StaffSession:session,StaffBrowser:browser,
            StaffAssignment:assignment,StaffSpecimen:card,StaffReportApproval:approval,StaffPublicReport:publication,StaffAnalysisRevision:analysis,StaffReviewRevision:review}))
            if(sql.includes(`"${name}"`))return[value];throw Error(sql);
    },async $executeRaw(strings,...values){const sql=strings.join('?');
        if(sql.includes('INSERT INTO')){const names=['id','actorId','sessionHash','accessVersion','assignmentFence','controlRevision','specimenId','approvalId','analysisRevision','reviewRevision',
            'evidenceHash','analysisHash','reviewHash','sourceRevision','sourceType','sourceId','sourceOwnerId','rawFindingsHash','generatorVersion','fingerprintVersion','gradingPolicyHash',
            'bridgeConfigHash','candidateCanonical','candidateHash','bundleHash','createdAt','expiresAt'];state.rows.push(Object.fromEntries(names.map((k,n)=>[k,values[n]])));}
        if(sql.includes('SET CONSTRAINTS')&&state.failFlush)throw Error('deferred-failure');return 1;
    }};
    const client={$transaction:async work=>{const saved=structuredClone(state.rows);state.inside=true;try{return await work(tx);}catch(e){state.rows=saved;throw e;}finally{state.inside=false;}}};
    const ports={async loadSource(_tx,exact){assert.equal(state.inside,true);assert.deepEqual(exact,{sourceType:card.sourceType,sourceId:card.sourceId,sourceOwnerId:card.sourceOwnerId});return raw;},
        reportSource:()=>snapshot,sourceEvidence:()=>evidence,assertSourceAdmission:()=>{},fingerprintVersion:()=> 'original-generator-fixture-v1',
        generateCandidates:input=>{state.generatorCalls++;assert.deepEqual(input.reviewedDefects,snapshot.reviewedDefects);return{lessons:[{defectType:'VISIBLE_WHITENING',polarity:'NEGATIVE',
            fingerprint:[...finding.featureFingerprint],provenance:'DETECTOR_REMOVED',sourceViewId:'ORIGINAL',proposalOrder:0}]};},isStaffPhoneAllowed:value=>value===i.phoneHash};
    const scope={actorId:i.id,sessionHash:session.tokenHash,browserHash:browser.tokenHash,accessVersion:1,controlRevision:1,staffOrigin:control.origin,
        deploymentId:control.deploymentId,releaseSha:control.releaseSha,staffConfigHash:control.configHash,specimenId:card.id,approvalId:approval.id,
        assignmentFence:2,analysisRevision:1,reviewRevision:2,evidenceHash:card.evidenceHash,analysisHash:analysis.sourceHash,reviewHash:approval.reviewHash,sourceRevision:analysis.sourceRevision};
    const bridge=new ScopedTrustedLearningCandidates({client,config,ports});
    const run=async()=>{const r=signTrustedLearningRequest(config,scope,+now,id(4));return bridge.receive(r.body,r.signature);};
    return{state,config,control,i,browser,session,assignment,raw,snapshot,evidence,card,analysis,approval,publication,review,learning,tx,client,ports,scope,bridge,run};
}
