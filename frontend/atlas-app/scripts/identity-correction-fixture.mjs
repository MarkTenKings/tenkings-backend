// Inactive M13 disposable-PostgreSQL scenarios. The lead supplies the original
// pure TS classifier explicitly after reviewing SQL/adapter composition. No
// cluster, server, network, worker/provider or process starts on module import.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {canonical,digest} from '@atlas/service-bridge/protocol';
import {makeIdentityCorrectionConfig,ScopedIdentityCorrection,signIdentityCorrectionRequest,identityCorrectionRequestCanonical,identityCorrectionClient,IDENTITY_CORRECTION_PATH} from '../../../packages/atlas-service-bridge/src/identity-correction.mjs';
import {canonicalizeSpeedsterSessionIdentity} from '@atlas/grading-core/identity';
import {previewAtlasReport} from '@atlas/grading-core/report';
import {fixtureAnalysis,FIXTURE_GRADING_POLICY} from '../lib/server/access/fixture-analysis.mjs';
import {DurableReviewStore} from '../lib/server/access/review.mjs';
import {StaffReports} from '../lib/server/access/reports.mjs';
import {fixtureEvidence} from '../lib/server/access/fixture.mjs';
import {StaffIdentityCorrection} from '../lib/server/access/identity-correction.mjs';
import {bridgeFixture} from './bridge-fixture.mjs';
const OPTIONS={analyses:true,trained:true};
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{resolve,promise};};
const reportSource=s=>({cardProfile:s.cardProfile,identity:s.identity,capture:s.capture,reviewedDefects:s.reviewedDefects,
    gradeReport:s.gradeReport,mapRevisionId:s.mapRevisionId??null,mapFilterPolicyVersion:s.mapFilterPolicyVersion??null,mapRegistration:s.mapRegistration??null});
// Synthetic resolver deliberately differs from the raw stored capture. This
// checks that raw CAS and resolved report evidence have independent invariants.
const resolveSource=s=>({...structuredClone(s),capture:{...structuredClone(s.capture),reportStorageKey:'synthetic-resolved-only'}});
async function fixture(context,classify,work){
    assert.equal(context.config.mode,'LOCAL_FIXTURE');assert.equal(typeof classify,'function','Original pure classifier must be supplied explicitly');
    const {admin,auth}=context,base=await admin.staffSpecimen.findFirst({where:{analysisRevision:1}});
    const sourceId=`identity-source-${randomUUID()}`,sourceOwnerId='synthetic-identity-owner',specimenId=randomUUID();
    const oldRevision=new Date(Date.now()-20_000),evidenceRevision=new Date(+oldRevision-10_000).toISOString();
    const initial=JSON.parse(fixtureAnalysis({title:'Synthetic Player',set:'Owned identity regression'},base.evidenceHash).sourceCanonical);
    initial.identity=canonicalizeSpeedsterSessionIdentity('SPORTS',initial.identity);
    initial.reviewedDefects[0].featureFingerprint=[1e-7,-2.75e-8,0.125];
    const raw={...initial,id:sourceId,createdByUserId:sourceOwnerId,workflowState:'CAPTURED',updatedAt:oldRevision,
        mapRevisionId:null,mapFilterPolicyVersion:null,mapRegistration:null};
    const sides=JSON.parse(base.evidenceCanonical).sides;
    const sourceEvidence=(s,revision)=>{const resolved=resolveSource(s);return{version:'atlas-speedster-evidence-v1',sourceId:s.id,sourceOwnerId:s.createdByUserId,
        sourceRevision:revision,captureHash:digest(canonical(resolved.capture)),identityHash:digest(canonical({cardProfile:s.cardProfile,identity:s.identity})),
        mapRevisionId:null,mapFilterPolicyVersion:null,mapRegistrationHash:digest('null'),sides,originals:sides};};
    const evidenceCanonical=canonical(sourceEvidence(raw,evidenceRevision)),evidenceHash=digest(evidenceCanonical);
    const sourceCanonical=canonical(reportSource(resolveSource(raw))),sourceHash=digest(sourceCanonical),reportCanonical=canonical(previewAtlasReport(JSON.parse(sourceCanonical)));
    const admissionCanonical=canonical({purpose:'atlas-analysis-admission-v1',mode:'LOCAL_FIXTURE',policyHash:FIXTURE_GRADING_POLICY,
        sourceId,sourceOwnerId,sourceHash,evidenceHash,detectionPair:{syntheticHistorical:true,numeric:[1e-7,-2.75e-8],noWorkerCalled:true}});
    await admin.$executeRaw`INSERT INTO public."AiGraderV2Session" (id,"createdByUserId","cardProfile","workflowState","ruleVersion",identity,capture,"reviewedDefects","gradeReport","updatedAt")
        VALUES(${sourceId},${sourceOwnerId},'SPORTS','CAPTURED','owned-identity-fixture',${canonical(raw.identity)}::jsonb,${canonical(raw.capture)}::jsonb,
        ${canonical(raw.reviewedDefects)}::jsonb,${canonical(raw.gradeReport)}::jsonb,(${oldRevision}::timestamptz AT TIME ZONE 'UTC'))`;
    await admin.$transaction(async tx=>{
        await tx.staffSpecimen.create({data:{id:specimenId,sourceType:'LOCAL_FIXTURE',sourceId,sourceOwnerId,title:'Synthetic Player',subtitle:'Owned identity regression',evidenceCanonical,evidenceHash,analysisRevision:1}});
        await tx.staffAnalysisRevision.create({data:{specimenId,revision:1,evidenceHash,sourceCanonical,sourceHash,reportCanonical,reportHash:digest(reportCanonical),
            admissionCanonical,admissionHash:digest(admissionCanonical),sourceRevision:oldRevision.toISOString(),mode:'LOCAL_FIXTURE'}});
        const draft={revision:1,evidenceRevision:1,evidenceHash,observations:{FRONT:'Keep exact human observation.',BACK:''},reviewedSides:[],identityReviewed:false,
            disposition:'IN_REVIEW',savedAt:null,savedBy:null},canonicalDraft=canonical(draft);
        await tx.staffReviewRevision.create({data:{specimenId,revision:1,evidenceRevision:1,evidenceHash,analysisRevision:1,canonical:canonicalDraft,contentHash:digest(canonicalDraft)}});
        await tx.staffAssignment.create({data:{specimenId,identityId:context.identities[0].id,canReview:true,expiresAt:new Date(Date.now()+600_000)}});
        await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
    });
    const review=new DurableReviewStore({auth,evidence:fixtureEvidence()}),reports=new StaffReports({auth,review}),approver=await context.login();
    const card=await review.read(approver.staff,specimenId),ready=await review.save(approver.staff,specimenId,{operationId:randomUUID(),expectedRevision:card.draft.revision,
        evidenceRevision:1,evidenceHash,observations:{FRONT:'Keep exact human observation.',BACK:''},reviewedSides:['FRONT','BACK'],identityReviewed:true,disposition:'READY_FOR_HUMAN'});
    const approved=await reports.approve(approver.staff,specimenId,{operationId:randomUUID(),expectedAnalysisRevision:1,analysisHash:sourceHash,
        expectedReviewRevision:ready.draft.revision,reviewHash:ready.reviewHash,evidenceHash});
    // Correction is a reviewer action, not certification or trusted learning.
    const identity=await admin.staffIdentity.update({where:{id:approver.staff.id},data:{certificationUntil:null,trustedLearningUntil:null,accessVersion:{increment:1}}});
    const signed=await context.login(),session=await admin.staffSession.findUnique({where:{tokenHash:digest(signed.token)}}),control=await admin.staffControl.findUnique({where:{id:'active'}});
    const assignment=await admin.staffAssignment.findUnique({where:{specimenId_identityId:{specimenId,identityId:identity.id}}});
    const config=makeIdentityCorrectionConfig({mode:'LOCAL_FIXTURE',origin:'https://identity-fixture.example.test',deploymentId:'owned-identity-correction-fixture',
        releaseSha:'0'.repeat(40),key:randomBytes(32),gradingPolicyHash:FIXTURE_GRADING_POLICY,
        phoneAllowlistHash:digest(canonical([...context.config.phoneByHash.keys()].sort())),otherKeyHashes:[]});
    const {key:_key,purpose:_purpose,...activation}=config;
    await admin.$executeRaw`INSERT INTO atlas_staff."StaffIdentityCorrectionControl" (id,enabled,mode,origin,"deploymentId","releaseSha","configHash","clientKeyHash","gradingPolicyHash","phoneAllowlistHash")
        VALUES('active',true,${activation.mode},${activation.origin},${activation.deploymentId},${activation.releaseSha},${activation.configHash},${activation.clientKeyHash},${activation.gradingPolicyHash},${activation.phoneAllowlistHash})`;
    const scope={actorId:identity.id,sessionHash:session.tokenHash,browserHash:session.browserHash,accessVersion:identity.accessVersion,controlRevision:control.revision,
        staffOrigin:control.origin,deploymentId:control.deploymentId,releaseSha:control.releaseSha,staffConfigHash:control.configHash,specimenId,assignmentFence:assignment.fence};
    const state={preflightCalls:0,casCalls:0,mutateSql:null,mutateNext:null,preflight:null,authority:null};
    const client={$transaction:(work,options)=>admin.$transaction(tx=>work(new Proxy(tx,{get(target,name){
        if(name==='$executeRaw')return async(strings,...values)=>{
            const changed=state.mutateSql?.(strings.join(''),values);
            if(changed===false)return 0;return target.$executeRaw(strings,...(changed??values));};
        const value=Reflect.get(target,name,target);return typeof value==='function'?value.bind(target):value;
    }})),options)};
    const sourceAdmission=()=>({gradingPolicyHash:FIXTURE_GRADING_POLICY,preparationRelease:{mode:'LOCAL_FIXTURE',noPreparationClaim:true},frontAuthorityHash:'a'.repeat(64),backAuthorityHash:'b'.repeat(64)});
    const ports={async loadRawSource(tx,exact){assert.equal(exact.sourceId,sourceId);const [row]=await tx.$queryRaw`SELECT id,"createdByUserId","cardProfile","workflowState",identity,capture,"reviewedDefects","gradeReport","mapRevisionId","mapFilterPolicyVersion","mapRegistration","updatedAt"
        FROM public."AiGraderV2Session" WHERE id=${exact.sourceId} AND "createdByUserId"=${exact.sourceOwnerId} FOR UPDATE`;return row;},
        classify:(source,expected,next)=>classify({source:resolveSource(source),expected,next},{sourceEvidence,reportSource,previewReport:previewAtlasReport,sourceAdmission}),
        async preflight(){state.preflightCalls++;await state.preflight?.();return{synthetic:true};},
        async assertCurrentAuthority(tx,source,preflight){assert(preflight.synthetic);await state.authority?.(tx,source);},
        projectNext:(source,identity,updatedAt)=>({...structuredClone(source),identity,updatedAt}),
        reportSource:source=>reportSource(resolveSource(source)),sourceEvidence,previewReport:previewAtlasReport,
        safeTitle:source=>({title:source.identity.playerName,subtitle:'Owned identity regression'}),isStaffPhoneAllowed:phoneHash=>context.config.phoneByHash.has(phoneHash),
        async compareAndSwap(tx,old,next){state.casCalls++;const write=state.mutateNext?.(next)??next;
            const count=await tx.$executeRaw`UPDATE public."AiGraderV2Session" SET identity=${canonical(write.identity)}::jsonb,capture=${canonical(write.capture)}::jsonb,"updatedAt"=(${write.updatedAt}::timestamptz AT TIME ZONE 'UTC')
                WHERE id=${old.id} AND "createdByUserId"=${old.createdByUserId} AND "updatedAt"=(${old.updatedAt}::timestamptz AT TIME ZONE 'UTC')`;
            assert.equal(count,1);return ports.loadRawSource(tx,{sourceId:old.id,sourceOwnerId:old.createdByUserId});}};
    const bridge=new ScopedIdentityCorrection({client,config,ports});
    const input={operationId:randomUUID(),expectedAnalysisRevision:1,expectedReviewRevision:ready.draft.revision,expectedEvidenceRevision:1,
        analysisHash:sourceHash,reviewHash:ready.reviewHash,evidenceHash,sourceRevision:oldRevision.toISOString(),
        next:{cardProfile:'SPORTS',identity:{...raw.identity,playerName:raw.identity.playerName.toUpperCase()}},reason:'Correct display metadata with identical original normalized map keys.'};
    const call=(request=input,currentScope=scope)=>{const packet=signIdentityCorrectionRequest(config,currentScope,request);return bridge.receive(packet.body,packet.signature);};
    const snapshot=async()=>({source:(await admin.$queryRaw`SELECT * FROM public."AiGraderV2Session" WHERE id=${sourceId}`)[0],
        card:await admin.staffSpecimen.findUnique({where:{id:specimenId}}),analyses:await admin.staffAnalysisRevision.findMany({where:{specimenId},orderBy:{revision:'asc'}}),
        reviews:await admin.staffReviewRevision.findMany({where:{specimenId},orderBy:{revision:'asc'}}),
        publication:await admin.staffPublicReport.findUnique({where:{specimenId}}),approvals:await admin.staffReportApproval.findMany({where:{specimenId}}),
        receipts:await admin.$queryRaw`SELECT * FROM atlas_staff."StaffIdentityCorrection" WHERE "specimenId"=${specimenId}::uuid`});
    const readReceipt=(request=input,currentScope=scope)=>context.client.$queryRaw`SELECT * FROM atlas_staff.read_identity_correction_receipt(
        ${currentScope.specimenId}::uuid,${currentScope.actorId}::uuid,${request.operationId}::uuid,${digest(identityCorrectionRequestCanonical(currentScope.specimenId,request))},
        ${currentScope.sessionHash},${currentScope.browserHash},${currentScope.accessVersion}::integer,${currentScope.assignmentFence}::integer,${currentScope.controlRevision}::integer)`;
    const facadeState={factoryCalls:0,privateCalls:0,configuration:config,loseReply:false};
    const facade=new StaffIdentityCorrection({auth,review,bridge:()=>{
        facadeState.factoryCalls++;if(!facadeState.configuration)return null;
        return identityCorrectionClient(facadeState.configuration,async(url,options)=>{
            facadeState.privateCalls++;assert.equal(url,`${config.origin}${IDENTITY_CORRECTION_PATH}`);
            assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');
            const result=await bridge.receive(options.body,options.headers['x-atlas-identity-signature']);
            if(facadeState.loseReply)throw Error('SYNTHETIC_PRIVATE_REPLY_LOST_AFTER_COMMIT');
            return new Response(canonical(result),{status:200,headers:{'content-type':'application/json'}});
        });
    }});
    await work({...context,config,scope,input,call,state,ports,sourceId,sourceOwnerId,specimenId,identity,session,assignment,control,approved,snapshot,readReceipt,
        signed,review,facade,facadeState});
}

export async function identityCorrectionScenarios(scenario,{classify}={}){
    assert.equal(typeof classify,'function','Supply classifyAtlasIdentityCorrection from the reviewed original module; no fallback');
    const owned=(name,work)=>scenario(name,context=>fixture(context,classify,work),OPTIONS);
    await owned('compatible human identity correction preserves raw numeric evidence and old publication while resetting exact heads',async f=>{
        const before=await f.snapshot(),result=await f.call(),after=await f.snapshot();assert.equal(result.status,'CORRECTED');
        assert.equal(after.receipts.length,1);assert.equal(after.card.analysisRevision,before.card.analysisRevision+1);
        assert.equal(after.card.draftRevision,before.card.draftRevision+1);assert.equal(after.card.evidenceRevision,before.card.evidenceRevision+1);
        assert.equal(after.source.identity.playerName,'SYNTHETIC PLAYER');
        assert.deepEqual({...after.source,identity:before.source.identity,updatedAt:before.source.updatedAt},before.source);
        assert.deepEqual(after.publication,before.publication);assert.deepEqual(after.approvals,before.approvals);
        assert.deepEqual(after.analyses[0],before.analyses[0]);assert.deepEqual(after.reviews.slice(0,-1),before.reviews);
        const a=after.analyses.at(-1),draft=JSON.parse(after.reviews.at(-1).canonical),old=before.analyses[0];
        assert.equal(a.operationId,null);assert.equal(a.identityCorrectionId,after.receipts[0].id);
        assert.deepEqual(JSON.parse(a.sourceCanonical).reviewedDefects,JSON.parse(old.sourceCanonical).reviewedDefects);
        assert(a.sourceCanonical.includes('1e-7'));assert(a.sourceCanonical.includes('-2.75e-8'));
        assert.equal(canonical(JSON.parse(a.admissionCanonical).detectionPair),canonical(JSON.parse(old.admissionCanonical).detectionPair));
        assert.equal(JSON.parse(a.admissionCanonical).previousAdmissionHash,old.admissionHash);
        assert.deepEqual(draft.reviewedSides,[]);assert.equal(draft.identityReviewed,false);assert.equal(draft.disposition,'IN_REVIEW');
        assert.equal(draft.observations.FRONT,'Keep exact human observation.');assert.equal(f.state.casCalls,1);
        assert.equal(await f.admin.staffGradingOperation.count({where:{specimenId:f.specimenId}}),0);
    });
    await owned('no change and normalized-key changes never create correction or invoke mutation/preflight',async f=>{
        const before=await f.snapshot();const same=await f.call({...f.input,next:{cardProfile:'SPORTS',identity:before.source.identity}});
        assert.equal(same.status,'NO_CHANGE');const different=await f.call({...f.input,next:{cardProfile:'SPORTS',identity:{...before.source.identity,playerName:'Different Player'}}});
        assert.equal(different.status,'REPROCESS_REQUIRED');assert.deepEqual(await f.snapshot(),before);assert.equal(f.state.preflightCalls,0);assert.equal(f.state.casCalls,0);
    });
    await owned('same-operation concurrent replies converge and later fresh replay precedes changed source and heads',async f=>{
        const gate=deferred();f.state.preflight=async()=>{if(f.state.preflightCalls===2)gate.resolve();await gate.promise;};
        const [a,b]=await Promise.all([f.call(),f.call()]);assert.deepEqual(a,b);assert.equal(f.state.casCalls,1);
        await f.admin.$executeRaw`UPDATE public."AiGraderV2Session" SET "updatedAt"="updatedAt"+interval '1 second' WHERE id=${f.sourceId}`;
        const preflights=f.state.preflightCalls;assert.deepEqual(await f.call(),a);assert.equal(f.state.preflightCalls,preflights);
        await assert.rejects(()=>f.call({...f.input,reason:'Different request.'}),/IDENTITY_REQUEST_CONFLICT/);
    });
    await owned('identity correction source guard rejects raw capture mutation and rolls back receipt',async f=>{
        const before=await f.snapshot();f.state.mutateNext=next=>({...next,capture:{...next.capture,forbiddenReplacement:true}});
        await assert.rejects(()=>f.call(),/identity and revision only/);assert.deepEqual(await f.snapshot(),before);
        f.state.mutateNext=null;f.state.authority=tx=>tx.$executeRaw`UPDATE public."AiGraderV2Session" SET "ruleVersion"='forbidden-prior-change' WHERE id=${f.sourceId}`;
        // Deferred source event checks also catch hidden-column writes made
        // before the same-transaction receipt existed.
        await assert.rejects(()=>f.call(),/identity and revision only/);assert.deepEqual(await f.snapshot(),before);
    });
    await owned('omitted correction audit and forged canonical result fields roll back all source and head writes',async f=>{
        const before=await f.snapshot();f.state.mutateSql=(sql)=>sql.includes('INSERT INTO atlas_staff."StaffAudit"')?false:undefined;
        await assert.rejects(()=>f.call(),/atomically preserve|same-transaction/);assert.deepEqual(await f.snapshot(),before);
        f.state.mutateSql=(sql,values)=>{if(!sql.includes('INSERT INTO atlas_staff."StaffAnalysisRevision"'))return;
            const next=[...values],report=JSON.parse(next[6]);report.grade=0;next[6]=canonical(report);next[7]=digest(next[6]);return next;};
        await assert.rejects(()=>f.call(),/atomically preserve/);assert.deepEqual(await f.snapshot(),before);
    });
    await owned('retained UNKNOWN worker execution blocks correction without clearing reservation or cost',async f=>{
        // Reuse the real owned ten-specimen budget fixture. Only membership is
        // adapted to include this already-graded correction specimen; no guard
        // is bypassed and no perform/worker port is invoked.
        const bridge=await bridgeFixture({...f,config:f.auth.config});
        const policy={...bridge.policy,specimenIds:[f.specimenId,...bridge.specimenIds.slice(1)]},policyCanonical=canonical(policy);
        const budget=await f.admin.staffGradingBridgeControl.update({where:{id:'active'},data:{policyCanonical,policyHash:digest(policyCanonical),revision:{increment:1}}});
        const current=await f.admin.staffControl.findUnique({where:{id:'active'}}),signed=await f.login(),
            session=await f.admin.staffSession.findUnique({where:{tokenHash:digest(signed.token)}});
        Object.assign(f.scope,{sessionHash:session.tokenHash,browserHash:session.browserHash,controlRevision:current.revision});
        const id=randomUUID(),createdAt=new Date(),requestCanonical=canonical({synthetic:true});
        await f.admin.staffGradingOperation.create({data:{id,specimenId:f.specimenId,operationId:randomUUID(),actorKind:'HUMAN',actorId:f.identity.id,
            sessionHash:session.tokenHash,assignmentFence:f.assignment.fence,controlRevision:current.revision,evidenceHash:f.input.evidenceHash,
            expectedAnalysisRevision:1,expectedReviewRevision:f.input.expectedReviewRevision,requestCanonical,inputHash:digest(requestCanonical),state:'RESERVED',
            dispatchClaimId:randomUUID(),leaseFence:1,leaseExpiresAt:new Date(+createdAt+240_000),createdAt}});
        await f.admin.staffGradingOperation.update({where:{id},data:{state:'DISPATCHED',dispatchedAt:createdAt}});
        await f.admin.staffGradingExecution.create({data:{operationId:id,claimId:randomUUID(),pilotId:policy.pilotId,bridgeRevision:budget.revision,
            sourceRevision:f.input.sourceRevision,reservedMicroUsd:BigInt(policy.reservationPerOperationMicroUsd),state:'RUNNING',createdAt}});
        await f.admin.staffGradingExecution.update({where:{operationId:id},data:{state:'UNKNOWN',failureCode:'SYNTHETIC_UNCERTAIN',finishedAt:new Date(),actualMicroUsd:9000n,costEvidenceHash:'c'.repeat(64)}});
        const held=await f.admin.staffGradingExecution.findUnique({where:{operationId:id}}),before=await f.snapshot(),
            [usage]=await f.admin.$queryRaw`SELECT * FROM atlas_staff.pilot_budget_usage(${policy.pilotId}::uuid,${f.specimenId}::uuid)`;
        assert.equal(held.reservedMicroUsd,BigInt(policy.reservationPerOperationMicroUsd));assert.equal(usage.card,'9000');
        await assert.rejects(()=>f.call(),/IDENTITY_WORK_UNRESOLVED/);assert.deepEqual(await f.snapshot(),before);
        assert.deepEqual(await f.admin.staffGradingExecution.findUnique({where:{operationId:id}}),held);assert.equal(f.state.preflightCalls,0);
        assert.deepEqual((await f.admin.$queryRaw`SELECT * FROM atlas_staff.pilot_budget_usage(${policy.pilotId}::uuid,${f.specimenId}::uuid)`)[0],usage);
        assert.equal(bridge.calls(),0);
    });
    await owned('revoked assignment after preflight cannot mutate and serving roles cannot read private correction snapshots',async f=>{
        const before=await f.snapshot();f.state.preflight=async()=>f.admin.staffAssignment.update({where:{specimenId_identityId:{specimenId:f.specimenId,identityId:f.identity.id}},
            data:{revokedAt:new Date(),fence:{increment:1}}});
        await assert.rejects(()=>f.call(),/FRESH_IDENTITY_REVIEWER_REQUIRED/);assert.deepEqual(await f.snapshot(),before);assert.equal(f.state.casCalls,0);
        await assert.rejects(()=>f.client.$queryRaw`SELECT * FROM atlas_staff."StaffIdentityCorrection"`);
        await assert.rejects(()=>f.client.$queryRaw`SELECT * FROM public."AiGraderV2Session" WHERE id=${f.sourceId}`);
        await assert.rejects(()=>f.client.$executeRaw`UPDATE public."AiGraderV2Session" SET identity='{}'::jsonb WHERE id=${f.sourceId}`);
    });
    await owned('same-transaction receipt guard rejects forged proof hash and ordinary immutable approval edits',async f=>{
        const before=await f.snapshot();f.state.mutateSql=(sql,values)=>{if(!sql.includes('INSERT INTO atlas_staff."StaffIdentityCorrection"'))return;
            const next=[...values];next[37]='f'.repeat(64);return next;};
        await assert.rejects(()=>f.call());assert.deepEqual(await f.snapshot(),before);
        await assert.rejects(()=>f.admin.staffReportApproval.update({where:{id:f.approved.approval.approvalId},data:{publicHash:'0'.repeat(64)}}));
    });
    await owned('actual serving receipt role recovers exact historical success after correction control disable and key rotation',async f=>{
        const result=await f.call(),[{actorRole}]=await f.client.$queryRaw`SELECT current_user AS "actorRole"`,[{ownerRole}]=await f.admin.$queryRaw`SELECT current_user AS "ownerRole"`;
        assert.notEqual(actorRole,ownerRole);const [first]=await f.readReceipt();assert.equal(first.receiptId,result.receiptId);
        assert.deepEqual(Object.keys(first).sort(),['receiptId','operationId','analysisRevision','reviewRevision','evidenceRevision','evidenceHash','sourceHash','reviewHash','createdAt'].sort());
        const rotated=makeIdentityCorrectionConfig({...f.config,key:randomBytes(32),otherKeyHashes:[]});
        await f.admin.$executeRaw`UPDATE atlas_staff."StaffIdentityCorrectionControl" SET enabled=false,"clientKeyHash"=${rotated.clientKeyHash},
            "configHash"=${rotated.configHash},revision=revision+1,"updatedAt"=(clock_timestamp() AT TIME ZONE 'UTC') WHERE id='active'`;
        await f.admin.$executeRaw`UPDATE public."AiGraderV2Session" SET "updatedAt"="updatedAt"+interval '1 second' WHERE id=${f.sourceId}`;
        const signed=await f.login(),session=await f.admin.staffSession.findUnique({where:{tokenHash:digest(signed.token)}}),fresh={...f.scope,sessionHash:session.tokenHash,browserHash:session.browserHash};
        const before=f.state.preflightCalls;assert.deepEqual(await f.readReceipt(f.input,fresh),[first]);assert.equal(f.state.preflightCalls,before);
        await assert.rejects(()=>f.readReceipt({...f.input,reason:'Conflicting canonical intent'},fresh),/request conflict/);
        await assert.rejects(()=>f.client.$queryRaw`SELECT * FROM atlas_staff."StaffIdentityCorrection"`);
        await assert.rejects(()=>f.client.$queryRaw`SELECT atlas_staff.assert_identity_correction_commit(${first.receiptId}::uuid)`);
        await assert.rejects(()=>f.client.$executeRaw`UPDATE atlas_staff."StaffIdentityCorrection" SET "inputHash"='forged' WHERE id=${first.receiptId}::uuid`);
    });
    await owned('receipt reader denies foreign actor operations wrong specimen revoked session and disabled staff control',async f=>{
        await f.call();const other=await f.admin.staffIdentity.update({where:{id:f.identities[1].id},data:{role:'REVIEWER',accessVersion:{increment:1}}});
        await f.admin.staffAssignment.create({data:{specimenId:f.specimenId,identityId:other.id,canReview:true,expiresAt:new Date(Date.now()+600_000)}});
        const signed=await f.login(f.auth,'+12025550142'),session=await f.admin.staffSession.findUnique({where:{tokenHash:digest(signed.token)}});
        const foreign={...f.scope,actorId:other.id,sessionHash:session.tokenHash,browserHash:session.browserHash,accessVersion:other.accessVersion,assignmentFence:1};
        assert.deepEqual(await f.readReceipt(f.input,foreign),[]);
        const otherCard=await f.admin.staffSpecimen.findFirst({where:{id:{not:f.specimenId}}});
        const assignment=await f.admin.staffAssignment.findUnique({where:{specimenId_identityId:{specimenId:otherCard.id,identityId:f.identity.id}}});
        await assert.rejects(()=>f.readReceipt(f.input,{...f.scope,specimenId:otherCard.id,assignmentFence:assignment.fence}),/request conflict/);
        await f.admin.staffSession.update({where:{tokenHash:f.session.tokenHash},data:{revokedAt:new Date()}});
        await assert.rejects(()=>f.readReceipt(),/fresh assigned human access/);
        await f.admin.staffControl.update({where:{id:'active'},data:{enabled:false,revision:{increment:1}}});
        await assert.rejects(()=>f.readReceipt(f.input,foreign),/fresh assigned human access/);
    });

    await owned('restricted staff identity service commits one correction and recovers exact replay after private disable and rotation',async f=>{
        const [{staffRole}]=await f.client.$queryRaw`SELECT current_user AS "staffRole"`,[{ownerRole}]=await f.admin.$queryRaw`SELECT current_user AS "ownerRole"`;
        assert.notEqual(staffRole,ownerRole);assert.equal(f.auth.database.client,f.client);
        const before=await f.snapshot(),result=await f.facade.correct(f.signed.staff,f.specimenId,f.input),after=await f.snapshot();
        assert.equal(result.status,'CORRECTED');assert.equal(after.receipts.length,1);assert.equal(f.state.casCalls,1);
        assert.equal(f.facadeState.factoryCalls,1);assert.equal(f.facadeState.privateCalls,1);
        assert.deepEqual(after.publication,before.publication);assert.deepEqual(after.approvals,before.approvals);
        assert.deepEqual(await f.facade.correct(f.signed.staff,f.specimenId,f.input),result);assert.equal(f.facadeState.factoryCalls,1);
        const rotated=makeIdentityCorrectionConfig({...f.config,key:randomBytes(32),otherKeyHashes:[]});
        await f.admin.$executeRaw`UPDATE atlas_staff."StaffIdentityCorrectionControl" SET enabled=false,"clientKeyHash"=${rotated.clientKeyHash},
            "configHash"=${rotated.configHash},revision=revision+1,"updatedAt"=(clock_timestamp() AT TIME ZONE 'UTC') WHERE id='active'`;
        f.facadeState.configuration=null;
        await f.admin.$executeRaw`UPDATE public."AiGraderV2Session" SET "updatedAt"="updatedAt"+interval '1 second' WHERE id=${f.sourceId}`;
        const fresh=await f.login();assert.deepEqual(await f.facade.correct(fresh.staff,f.specimenId,f.input),result);
        assert.equal(f.facadeState.factoryCalls,1);assert.equal(f.facadeState.privateCalls,1);assert.equal(f.state.casCalls,1);
        await assert.rejects(()=>f.facade.correct(fresh.staff,f.specimenId,{...f.input,reason:'Conflicting historical request.'}),/IDENTITY_REQUEST_CONFLICT/);
        await assert.rejects(()=>f.facade.correct({...fresh.staff},f.specimenId,f.input),/SIGN_IN_REQUIRED/);
        const latest=await f.snapshot(),analysis=latest.analyses.at(-1),review=latest.reviews.at(-1),newRequest={...f.input,operationId:randomUUID(),
            expectedAnalysisRevision:analysis.revision,expectedReviewRevision:review.revision,expectedEvidenceRevision:latest.card.evidenceRevision,
            analysisHash:analysis.sourceHash,reviewHash:review.contentHash,evidenceHash:latest.card.evidenceHash,sourceRevision:analysis.sourceRevision,
            next:{cardProfile:'SPORTS',identity:before.source.identity}};
        await assert.rejects(()=>f.facade.correct(fresh.staff,f.specimenId,newRequest),/IDENTITY_NOT_CONFIGURED/);
        assert.equal(f.facadeState.factoryCalls,2);assert.equal(f.facadeState.privateCalls,1);assert.deepEqual(await f.snapshot(),latest);
    });
    await owned('restricted staff identity service recovers a committed lost private reply and rechecks current assignment on replay',async f=>{
        f.facadeState.loseReply=true;const result=await f.facade.correct(f.signed.staff,f.specimenId,f.input);
        assert.equal(result.status,'CORRECTED');assert.equal(f.facadeState.privateCalls,1);assert.equal(f.state.casCalls,1);
        assert.equal((await f.snapshot()).receipts.length,1);f.facadeState.configuration=null;
        assert.deepEqual(await f.facade.correct(f.signed.staff,f.specimenId,f.input),result);assert.equal(f.facadeState.factoryCalls,1);
        await f.admin.staffAssignment.update({where:{specimenId_identityId:{specimenId:f.specimenId,identityId:f.identity.id}},
            data:{revokedAt:new Date(),fence:{increment:1}}});
        await assert.rejects(()=>f.facade.correct(f.signed.staff,f.specimenId,f.input),/CARD_NOT_FOUND|ASSIGNMENT|REVIEW_PERMISSION|FRESH_IDENTITY/);
        assert.equal(f.facadeState.factoryCalls,1);assert.equal(f.facadeState.privateCalls,1);
    });

}
