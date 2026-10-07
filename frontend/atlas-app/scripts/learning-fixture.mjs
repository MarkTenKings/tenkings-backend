import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {PrismaClient} from '../.generated/staff-database/index.js';
import {makeTrustedLearningConfig,ScopedTrustedLearningCandidates,signTrustedLearningRequest,trustedLearningBundleHash} from '@atlas/service-bridge/trusted-learning';
import {canonical,digest,requireBridge} from '@atlas/service-bridge/protocol';
import {calculateSpeedsterReview} from '@atlas/grading-core/review';
import {previewAtlasReport} from '@atlas/grading-core/report';
import {measureSpeedsterCenteringBorders} from '@atlas/grading-core/scoring';
import {DurableReviewStore} from '../lib/server/access/review.mjs';
import {StaffReports} from '../lib/server/access/reports.mjs';
import {fixtureEvidence} from '../lib/server/access/fixture.mjs';
import {fixtureAnalysis,FIXTURE_GRADING_POLICY} from '../lib/server/access/fixture-analysis.mjs';
import {StaffTrustedLearning,learningCandidatePort} from '../lib/server/access/learning.mjs';

// Lead-owned disposable PostgreSQL context only. No cluster/listener/worker or
// provider is started here. Original rows are inert LOCAL_FIXTURE sources.
const OPTIONS={analyses:true,trained:true};
const defer=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{resolve,promise};};
const delay=ms=>new Promise(done=>setTimeout(done,ms));
const readyInput=card=>({operationId:randomUUID(),expectedRevision:card.draft.revision,evidenceRevision:card.evidenceRevision,evidenceHash:card.evidenceHash,
    observations:{FRONT:'Owned synthetic learning fixture.',BACK:''},reviewedSides:['FRONT','BACK'],identityReviewed:true,disposition:'READY_FOR_HUMAN'});
const approvalInput=card=>({operationId:randomUUID(),expectedAnalysisRevision:card.grading.analysisRevision,analysisHash:card.grading.analysisHash,
    expectedReviewRevision:card.draft.revision,reviewHash:card.reviewHash,evidenceHash:card.evidenceHash});
async function fixture(context,work){
    const {admin,auth,config}=context;assert.equal(config.mode,'LOCAL_FIXTURE');
    const learner=await admin.staffIdentity.update({where:{id:context.identities[1].id},data:{role:'REVIEWER',name:'Synthetic learning reviewer',
        certificationUntil:null,trustedLearningUntil:new Date(Date.now()+3600000),accessVersion:{increment:1}}});
    const sourceId=`learning-source-${randomUUID()}`,sourceOwnerId='synthetic-learning-owner',sourceRevision='2026-09-08T16:00:00.123Z';
    const originalCard=await admin.staffSpecimen.findFirst({where:{analysisRevision:1}});
    const evidence=JSON.parse(originalCard.evidenceCanonical),evidenceCanonical=canonical(evidence),evidenceHash=digest(evidenceCanonical);
    const analysis=fixtureAnalysis({title:'Synthetic learning source',set:'Owned regression only'},evidenceHash),snapshot=JSON.parse(analysis.sourceCanonical);
    const finding=snapshot.reviewedDefects[0];finding.origin='DETECTOR';finding.detectedDefectType=finding.defectType;finding.reviewResult='REMOVED';
    // Exact JS numeric lexemes intentionally exercise the JSONB exponent issue.
    finding.featureFingerprint=Array.from({length:32},(_,n)=>n===0?1:n===1?1e-7:n===2?-2.75e-8:0);
    const centering={front:{centeringBorders:measureSpeedsterCenteringBorders(snapshot.capture.front.centeringQuad)},
        back:{centeringBorders:measureSpeedsterCenteringBorders(snapshot.capture.back.centeringQuad)}};
    snapshot.gradeReport={...calculateSpeedsterReview(centering,snapshot.reviewedDefects).grade,detectorVersion:'SYNTHETIC_NO_DETECTION_OR_ASTRA'};
    analysis.sourceCanonical=canonical(snapshot);analysis.sourceHash=digest(analysis.sourceCanonical);analysis.sourceRevision=sourceRevision;
    analysis.reportCanonical=canonical(previewAtlasReport(snapshot));analysis.reportHash=digest(analysis.reportCanonical);
    analysis.admissionCanonical=canonical({purpose:'atlas-analysis-admission-v1',mode:'LOCAL_FIXTURE',evidenceHash,sourceHash:analysis.sourceHash,
        policyHash:FIXTURE_GRADING_POLICY,synthetic:true});analysis.admissionHash=digest(analysis.admissionCanonical);
    await admin.$executeRaw`INSERT INTO public."AiGraderV2Session"
        (id,"createdByUserId","cardProfile","workflowState","ruleVersion",identity,capture,"reviewedDefects","gradeReport","updatedAt")
        VALUES (${sourceId},${sourceOwnerId},'SPORTS','CAPTURED','owned-learning-fixture',${canonical(snapshot.identity)}::jsonb,
        ${canonical(snapshot.capture)}::jsonb,${canonical(snapshot.reviewedDefects)}::jsonb,${canonical(snapshot.gradeReport)}::jsonb,
        (${sourceRevision}::timestamptz AT TIME ZONE 'UTC'))`;
    const specimenId=randomUUID();
    await admin.$transaction(async tx=>{
        await tx.staffSpecimen.create({data:{id:specimenId,sourceType:'LOCAL_FIXTURE',sourceId,sourceOwnerId,title:'Synthetic learning source',
            subtitle:'Owned regression only',evidenceCanonical,evidenceHash,analysisRevision:1}});
        await tx.staffAnalysisRevision.create({data:{specimenId,...analysis}});
        const prior=await tx.staffReviewRevision.findUnique({where:{specimenId_revision:{specimenId:originalCard.id,revision:1}}});
        const draft={...JSON.parse(prior.canonical),evidenceHash};const content=canonical(draft);
        await tx.staffReviewRevision.create({data:{specimenId,revision:1,evidenceRevision:1,evidenceHash,analysisRevision:1,canonical:content,contentHash:digest(content)}});
        for(const identityId of [context.identities[0].id,learner.id])await tx.staffAssignment.create({data:{specimenId,identityId,canReview:true,expiresAt:new Date(Date.now()+3600000)}});
        await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
    });
    const review=new DurableReviewStore({auth,evidence:fixtureEvidence()}),reports=new StaffReports({auth,review}),reportHuman=await context.login();
    const ready=await review.save(reportHuman.staff,specimenId,readyInput(await review.read(reportHuman.staff,specimenId)));
    const result=await reports.approve(reportHuman.staff,specimenId,approvalInput(ready));
    const approval=await admin.staffReportApproval.findUnique({where:{id:result.approval.approvalId}}),signed=await context.login(auth,'+12025550142');
    const session=await admin.staffSession.findUnique({where:{tokenHash:digest(signed.token)}}),control=await admin.staffControl.findUnique({where:{id:'active'}});
    const assignment=await admin.staffAssignment.findUnique({where:{specimenId_identityId:{specimenId,identityId:learner.id}}});
    const card=await admin.staffSpecimen.findUnique({where:{id:specimenId}});
    const learningConfig=makeTrustedLearningConfig({mode:'LOCAL_FIXTURE',origin:'https://learning-fixture.example.test',deploymentId:'owned-learning-source-fixture',
        releaseSha:'0'.repeat(40),key:randomBytes(32),gradingPolicyHash:FIXTURE_GRADING_POLICY,
        phoneAllowlistHash:digest(canonical([...config.phoneByHash.keys()].sort())),otherKeyHashes:[]});
    const {key:_key,purpose:_purpose,generatorVersion:_generator,...activation}=learningConfig;
    await admin.staffLearningControl.create({data:{...activation,enabled:true}});
    const state={privateCalls:0,afterCall:null,lastWritten:null};
    const privateClient={$transaction:(work,options)=>admin.$transaction(tx=>work(new Proxy(tx,{get(target,name){
        if(name==='$executeRaw')return async(strings,...values)=>{if(strings.join('').includes('INSERT INTO atlas_staff."StaffLearningCandidates"'))
            state.lastWritten={id:values[0],createdAt:new Date(values[25]),expiresAt:new Date(values[26])};return target.$executeRaw(strings,...values);};
        const value=Reflect.get(target,name,target);return typeof value==='function'?value.bind(target):value;
    }})),options)};
    const ports={async loadSource(tx,exact){
        assert.deepEqual(exact,{sourceType:'LOCAL_FIXTURE',sourceId,sourceOwnerId});
        const [row]=await tx.$queryRaw`SELECT id,"createdByUserId","workflowState","updatedAt",identity,capture,"reviewedDefects","gradeReport"
            FROM public."AiGraderV2Session" WHERE id=${exact.sourceId} AND "createdByUserId"=${exact.sourceOwnerId} FOR SHARE`;return row;
    },reportSource:raw=>({cardProfile:'SPORTS',identity:raw.identity,capture:raw.capture,reviewedDefects:raw.reviewedDefects,gradeReport:raw.gradeReport}),
    sourceEvidence:()=>evidence,assertSourceAdmission:()=>requireBridge(config.mode==='LOCAL_FIXTURE','FIXTURE_ONLY'),
    fingerprintVersion:()=> 'owned-original-generator-shape-fixture-v1',isStaffPhoneAllowed:phoneHash=>config.phoneByHash.has(phoneHash),
    generateCandidates:({reviewedDefects})=>({lessons:[{defectType:reviewedDefects[0].defectType,polarity:'NEGATIVE',fingerprint:[...reviewedDefects[0].featureFingerprint],
        provenance:'DETECTOR_REMOVED',sourceViewId:'NORMALIZED',proposalOrder:0}]})};
    const bridge=new ScopedTrustedLearningCandidates({client:privateClient,config:learningConfig,ports});
    const client={binding:{bridgeConfigHash:learningConfig.configHash,gradingPolicyHash:learningConfig.gradingPolicyHash},async call(scope){
        state.privateCalls++;const request=signTrustedLearningRequest(learningConfig,scope),answer=await bridge.receive(request.body,request.signature);
        if(state.afterCall)await state.afterCall();return answer;}};
    const candidates=learningCandidatePort({client}),service=new StaffTrustedLearning({auth,review,candidates});
    const scope={actorId:learner.id,sessionHash:session.tokenHash,browserHash:session.browserHash,accessVersion:learner.accessVersion,
        controlRevision:control.revision,staffOrigin:control.origin,deploymentId:control.deploymentId,releaseSha:control.releaseSha,staffConfigHash:control.configHash,
        specimenId,approvalId:approval.id,assignmentFence:assignment.fence,analysisRevision:1,reviewRevision:card.draftRevision,
        evidenceHash,analysisHash:analysis.sourceHash,reviewHash:approval.reviewHash,sourceRevision};
    const issue=async(overrides={})=>{const request=signTrustedLearningRequest(learningConfig,{...scope,...overrides});return bridge.receive(request.body,request.signature);};
    const preview=()=>service.preview(signed.staff,specimenId,{approvalId:approval.id});
    const decisionInput=p=>({operationId:randomUUID(),approvalId:approval.id,candidatesId:p.candidatesId??p.receiptId,bundleHash:p.bundleHash,
        candidateIds:p.candidates.map(c=>c.candidateId),decision:'APPROVE',reason:'Exact synthetic negative candidate reviewed.'});
    const auditData=data=>({id:randomUUID(),event:'ATLAS_TRUSTED_LEARNING_DECIDED',subjectId:specimenId,actorId:learner.id,
        details:canonical({decisionId:data.id,decisionHash:data.decisionHash,bundleHash:data.bundleHash,status:data.status,operationId:data.operationId,inputHash:data.inputHash})});
    function decisionData(row,input=decisionInput({receiptId:row.id,bundleHash:row.bundleHash,candidates:JSON.parse(row.candidateCanonical).candidates})){
        const createdAt=new Date(),id=randomUUID(),inputHash=digest(canonical({specimenId,input})),status=input.decision==='APPROVE'?'APPROVED_PENDING_APPLICATION':'REJECTED';
        const body={version:'atlas-trusted-learning-decision-v1',purpose:'TRUSTED_LEARNING',status,specimenId,approvalId:approval.id,candidatesId:row.id,
            bundleHash:row.bundleHash,rawFindingsHash:row.rawFindingsHash,candidateHash:row.candidateHash,generatorVersion:row.generatorVersion,fingerprintVersion:row.fingerprintVersion,
            gradingPolicyHash:row.gradingPolicyHash,bridgeConfigHash:row.bridgeConfigHash,sourceType:row.sourceType,sourceId,sourceOwnerId,sourceRevision:row.sourceRevision,
            analysisRevision:row.analysisRevision,reviewRevision:row.reviewRevision,evidenceHash,analysisHash:row.analysisHash,reviewHash:row.reviewHash,
            candidateIds:input.candidateIds,reason:input.reason,actorId:learner.id,sessionHash:session.tokenHash,browserHash:session.browserHash,
            accessVersion:learner.accessVersion,assignmentFence:assignment.fence,controlRevision:control.revision,trustedLearningUntil:learner.trustedLearningUntil.toISOString(),
            operationId:input.operationId,inputHash,createdAt:createdAt.toISOString()};
        const decisionCanonical=canonical(body);return{id,specimenId,approvalId:approval.id,candidatesId:row.id,bundleHash:row.bundleHash,rawFindingsHash:row.rawFindingsHash,
            analysisRevision:row.analysisRevision,reviewRevision:row.reviewRevision,evidenceHash,analysisHash:row.analysisHash,reviewHash:row.reviewHash,sourceRevision:row.sourceRevision,
            actorId:learner.id,sessionHash:session.tokenHash,accessVersion:learner.accessVersion,assignmentFence:assignment.fence,controlRevision:control.revision,
            operationId:input.operationId,inputHash,decisionCanonical,decisionHash:digest(decisionCanonical),status,createdAt};
    }
    async function persist(data,{audit=true,details,after,auditFirst=false}={}){return admin.$transaction(async tx=>{
        const a=auditData(data);if(details)a.details=canonical({...JSON.parse(a.details),...details});
        if(audit&&auditFirst)await tx.staffAudit.create({data:a});
        const row=await tx.staffTrustedLearningDecision.create({data});if(audit&&!auditFirst)await tx.staffAudit.create({data:a});
        if(after)await after(tx);await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;return row;
    });}
    await work({...context,learner,signed,reportHuman,review,reports,approval,card,analysis,snapshot,sourceId,sourceOwnerId,sourceRevision,
        session,control,assignment,learningConfig,bridge,ports,state,client,candidates,service,scope,issue,preview,decisionInput,decisionData,auditData,persist});
}

/** Lead wiring: await learningScenarios(scenario), after reviewed M12 + models/grants. */
export async function learningScenarios(scenario){
    await scenario('learning real private receipt and human decision preserve exact numeric bytes, raw findings and independent training',context=>fixture(context,async f=>{
        const preview=await f.preview(),row=await f.admin.staffLearningCandidates.findUnique({where:{id:preview.candidatesId}});
        assert.equal(f.learner.certificationUntil,null);assert.notEqual(f.approval.actorId,f.learner.id);assert.deepEqual(preview.selectedCandidateIds,[]);
        assert.equal(JSON.stringify(preview).includes('fingerprint'),false);assert.match(row.candidateCanonical,/1e-7/);
        assert.equal(+row.createdAt,+f.state.lastWritten.createdAt);assert.equal(+row.expiresAt,+f.state.lastWritten.expiresAt);
        const result=await f.service.decide(f.signed.staff,f.card.id,f.decisionInput(preview));assert.equal(result.status,'APPROVED_PENDING_APPLICATION');assert.equal(result.applicationAvailable,false);
        assert.equal((await f.service.read(f.signed.staff,f.card.id)).decisions.length,1);
        const [source]=await f.admin.$queryRaw`SELECT "reviewedDefects","workflowState" FROM public."AiGraderV2Session" WHERE id=${f.sourceId}`;
        assert.equal(canonical(source.reviewedDefects),canonical(f.snapshot.reviewedDefects));assert.equal(source.workflowState,'CAPTURED');
        for(const [model,id]of [['staffLearningCandidates',row.id],['staffTrustedLearningDecision',result.decisionId]]){
            await assert.rejects(()=>f.admin[model].delete({where:{id}}),/immutable/);
            await assert.rejects(()=>f.admin[model].update({where:{id},data:model==='staffLearningCandidates'?{bundleHash:'a'.repeat(64)}:{status:'REJECTED'}}),/immutable/);
        }
    }),OPTIONS);
    await scenario('learning SQL rejects missing, changed, orphan and recycled decision audits with atomic rollback',context=>fixture(context,async f=>{
        const p=await f.issue(),row=await f.admin.staffLearningCandidates.findUnique({where:{id:p.receiptId}});
        await assert.rejects(()=>f.persist(f.decisionData(row),{audit:false}),/same transaction/);
        await assert.rejects(()=>f.persist(f.decisionData(row),{details:{inputHash:'f'.repeat(64)}}),/same transaction/);
        const orphan=f.decisionData(row);await assert.rejects(()=>f.admin.$transaction(async tx=>{
            await tx.staffAudit.create({data:f.auditData(orphan)});await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`; }),/same transaction/);
        assert.equal(await f.admin.staffTrustedLearningDecision.count(),0);
        const retained=await f.persist(f.decisionData(row),{auditFirst:true});assert(retained.id);
        await assert.rejects(()=>f.admin.staffAudit.create({data:f.auditData(retained)}),/Unique constraint|same transaction/);
        assert.equal(await f.admin.staffTrustedLearningDecision.count(),1);
    }),OPTIONS);
    await scenario('learning SQL rejects rehashed wrong candidate selection and changed exact input',context=>fixture(context,async f=>{
        const p=await f.issue(),row=await f.admin.staffLearningCandidates.findUnique({where:{id:p.receiptId}}),input=f.decisionInput(p);
        await assert.rejects(()=>f.persist(f.decisionData(row,{...input,candidateIds:['f'.repeat(64)]})),/exact candidates/);
        const bad=f.decisionData(row),body=JSON.parse(bad.decisionCanonical);body.reason='Changed without input commitment';bad.decisionCanonical=canonical(body);bad.decisionHash=digest(bad.decisionCanonical);
        await assert.rejects(()=>f.persist(bad),/canonical input/);
        const changed={...row,id:randomUUID()},packet=JSON.parse(changed.candidateCanonical);packet.candidates[0].lesson.fingerprint[1]=0.3333333333333333;
        changed.candidateCanonical=canonical(packet);changed.candidateHash=digest(changed.candidateCanonical);changed.bundleHash=trustedLearningBundleHash(changed);
        await assert.rejects(()=>f.admin.staffLearningCandidates.create({data:changed}),/candidate identity/);
        assert.equal(await f.admin.staffTrustedLearningDecision.count(),0);
    }),OPTIONS);
    await scenario('learning SQL independently rejects training, session, assignment or control revocation during commit',context=>fixture(context,async f=>{
        const p=await f.issue(),row=await f.admin.staffLearningCandidates.findUnique({where:{id:p.receiptId}});
        for(const after of [tx=>tx.staffIdentity.update({where:{id:f.learner.id},data:{trustedLearningUntil:null,certificationUntil:new Date(Date.now()+3600000),accessVersion:{increment:1}}}),
            tx=>tx.staffSession.update({where:{tokenHash:f.session.tokenHash},data:{revokedAt:new Date()}}),
            tx=>tx.staffAssignment.update({where:{specimenId_identityId:{specimenId:f.card.id,identityId:f.learner.id}},data:{canReview:false,fence:{increment:1}}}),
            tx=>tx.staffLearningControl.update({where:{id:'active'},data:{enabled:false,revision:{increment:1}}})]){
            await assert.rejects(()=>f.persist(f.decisionData(row),{after}),/fresh trained human|exact approved source/);
            assert.equal(await f.admin.staffTrustedLearningDecision.count(),0);
        }
        await assert.rejects(()=>f.issue({browserHash:'f'.repeat(64)}),/FRESH_TRUSTED_LEARNING_REVIEWER_REQUIRED/);
    }),OPTIONS);
    await scenario('learning receipt expires independently of still-valid human training',context=>fixture(context,async f=>{
        const p=await f.issue(),row=await f.admin.staffLearningCandidates.findUnique({where:{id:p.receiptId}});
        const brief=await f.admin.staffLearningCandidates.create({data:{...row,id:randomUUID(),createdAt:new Date(),expiresAt:new Date(Date.now()+700)}});
        await delay(800);
        await assert.rejects(()=>f.service.decide(f.signed.staff,f.card.id,{...f.decisionInput(p),candidatesId:brief.id}),/LEARNING_PREFLIGHT_REQUIRED/);
        assert.equal(await f.admin.staffTrustedLearningDecision.count(),0);assert(f.learner.trustedLearningUntil>new Date());
    }),OPTIONS);
    await scenario('learning source drift and changed current approval prevent new decisions while preserving historic facts',context=>fixture(context,async f=>{
        const p=await f.preview();await f.admin.$executeRaw`UPDATE public."AiGraderV2Session" SET "updatedAt"="updatedAt"+interval '1 second' WHERE id=${f.sourceId}`;
        await assert.rejects(()=>f.service.decide(f.signed.staff,f.card.id,f.decisionInput(p)),/LEARNING_PREFLIGHT_REQUIRED/);
        await assert.rejects(()=>f.issue(),/LEARNING_SOURCE_CHANGED|exact approved source/);
        assert.equal(await f.admin.staffTrustedLearningDecision.count(),0);assert(await f.admin.staffReportApproval.findUnique({where:{id:f.approval.id}}));
    }),OPTIONS);
    await scenario('learning new review revision invalidates candidate approval and revocation after private preflight fails closed',context=>fixture(context,async f=>{
        const p=await f.preview(),card=await f.review.read(f.signed.staff,f.card.id);
        await f.review.save(f.signed.staff,f.card.id,{...readyInput(card),observations:{FRONT:'Changed exact review.',BACK:''}});
        await assert.rejects(()=>f.service.decide(f.signed.staff,f.card.id,f.decisionInput(p)),/LEARNING_APPROVAL_CHANGED/);
        assert.equal(await f.admin.staffTrustedLearningDecision.count(),0);
    }),OPTIONS);
    await scenario('learning revocation between private preview and DB receipt read prevents presentation',context=>fixture(context,async f=>{
        f.state.afterCall=()=>f.admin.staffIdentity.update({where:{id:f.learner.id},data:{trustedLearningUntil:null,accessVersion:{increment:1}}});
        await assert.rejects(()=>f.preview(),/SIGN_IN_REQUIRED|FRESH_TRUSTED_LEARNING_REVIEWER_REQUIRED/);assert.equal(await f.admin.staffTrustedLearningDecision.count(),0);
    }),OPTIONS);
    await scenario('learning lost decision reply recovers without private source read but still needs current training',context=>fixture(context,async f=>{
        const p=await f.preview(),input=f.decisionInput(p),result=await f.service.decide(f.signed.staff,f.card.id,input),calls=f.state.privateCalls;
        await f.admin.$executeRaw`UPDATE public."AiGraderV2Session" SET "updatedAt"="updatedAt"+interval '1 second' WHERE id=${f.sourceId}`;
        f.client.call=()=>{throw Error('Private bridge unavailable');};
        assert.deepEqual(await f.service.decide(f.signed.staff,f.card.id,input),result);assert.equal(f.state.privateCalls,calls);
        await assert.rejects(()=>f.service.decide(f.signed.staff,f.card.id,{...input,reason:'Changed replay input'}),/LEARNING_REQUEST_CONFLICT/);
        await f.admin.staffIdentity.update({where:{id:f.learner.id},data:{trustedLearningUntil:null,accessVersion:{increment:1}}});
        await assert.rejects(()=>f.service.decide(f.signed.staff,f.card.id,input),/SIGN_IN_REQUIRED|FRESH_TRUSTED_LEARNING_REVIEWER_REQUIRED/);
        assert.equal(await f.admin.staffTrustedLearningDecision.count(),1);
    }),OPTIONS);
    await scenario('learning definer holds actual public source lock and staff operations runner cannot read or create candidates',context=>fixture(context,async f=>{
        const p=await f.issue(),row=await f.admin.staffLearningCandidates.findUnique({where:{id:p.receiptId}}),locked=defer(),release=defer();
        const pending=f.auth.withStaff(f.signed.staff,async c=>{
            const assignment=await f.review.assigned(c,f.card.id);await f.candidates.inspect({...c,assignment},{specimenId:f.card.id,approvalId:f.approval.id,candidatesId:row.id});
            locked.resolve();await release.promise;
        });
        await Promise.race([locked.promise,pending.then(()=>{throw Error('Learning source lock ended early');})]);
        try{await assert.rejects(()=>f.admin.$transaction(async tx=>{await tx.$executeRaw`SET LOCAL lock_timeout='250ms'`;
            await tx.$executeRaw`UPDATE public."AiGraderV2Session" SET "updatedAt"="updatedAt"+interval '1 second' WHERE id=${f.sourceId}`;}),/lock timeout/);}
        finally{release.resolve();await pending;}
        for(const url of [f.db.staffUrl,f.db.operationsUrl,f.db.operatorUrl]){const client=new PrismaClient({datasources:{db:{url}}});try{
            await assert.rejects(()=>client.staffLearningCandidates.findMany());await assert.rejects(()=>client.staffLearningCandidates.create({data:{...row,id:randomUUID()}}));
            await assert.rejects(()=>client.staffLearningControl.findMany());
            await assert.rejects(()=>client.staffLearningControl.update({where:{id:'active'},data:{enabled:false,revision:{increment:1}}}));
            await assert.rejects(()=>client.$queryRaw`SELECT id FROM public."AiGraderV2Session" WHERE id=${f.sourceId}`);
            if(url!==f.db.staffUrl){await assert.rejects(()=>client.staffTrustedLearningDecision.create({data:f.decisionData(row)}));
                await assert.rejects(()=>client.$queryRaw`SELECT * FROM atlas_staff.lock_learning_candidates(${f.learner.id}::uuid,
                    ${f.session.tokenHash},${f.card.id}::uuid,${f.approval.id}::uuid,${row.id}::uuid)`);}
        }finally{await client.$disconnect();}}
    }),OPTIONS);
}
