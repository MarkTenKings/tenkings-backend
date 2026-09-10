import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { canonical, digest, keys, keyBytes, bridgeOrigin, requireBridge as check, SHA, UUID } from './protocol.mjs';
export const IDENTITY_CORRECTION_PATH='/api/internal/atlas/identity-correction';
export const IDENTITY_CORRECTION_PURPOSE='atlas-identity-correction-v1';
const date=v=>v instanceof Date&&Number.isFinite(+v),sha=v=>typeof v==='string'&&SHA.test(v),uuid=v=>typeof v==='string'&&UUID.test(v);
const positive=v=>Number.isSafeInteger(v)&&v>0&&v<=2147483647;
const text=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v);
export function makeIdentityCorrectionConfig({mode,origin,deploymentId,releaseSha,key,gradingPolicyHash,phoneAllowlistHash,otherKeyHashes}){
    bridgeOrigin(origin);const bytes=Buffer.isBuffer(key)?Buffer.from(key):keyBytes(key),clientKeyHash=digest(bytes);
    check(['PRODUCTION','LOCAL_FIXTURE'].includes(mode)&&text(deploymentId,120)&&/^[a-f0-9]{40}$/.test(releaseSha)
        &&bytes.length===32&&sha(gradingPolicyHash)&&sha(phoneAllowlistHash)&&Array.isArray(otherKeyHashes)
        &&otherKeyHashes.every(sha)&&otherKeyHashes.length<=20&&!otherKeyHashes.includes(clientKeyHash)
        &&(mode==='PRODUCTION'?releaseSha!=='0'.repeat(40):releaseSha==='0'.repeat(40)),'IDENTITY_CONFIGURATION_INVALID');
    const binding={purpose:IDENTITY_CORRECTION_PURPOSE,mode,origin,deploymentId,releaseSha,clientKeyHash,gradingPolicyHash,phoneAllowlistHash};
    return Object.freeze({...binding,key:bytes,configHash:digest(canonical(binding))});
}
export function validateIdentityCorrectionRequest(request){
    keys(request,['operationId','expectedAnalysisRevision','expectedReviewRevision','expectedEvidenceRevision','analysisHash','reviewHash','evidenceHash','sourceRevision','next','reason']);
    check(uuid(request.operationId)&&['expectedAnalysisRevision','expectedReviewRevision','expectedEvidenceRevision'].every(k=>positive(request[k]))
        &&['analysisHash','reviewHash','evidenceHash'].every(k=>sha(request[k]))&&text(request.sourceRevision,80)&&text(request.reason,1000),'IDENTITY_REQUEST_INVALID');
    keys(request.next,['cardProfile','identity']);check(['SPORTS','POKEMON'].includes(request.next.cardProfile)&&request.next.identity
        &&typeof request.next.identity==='object'&&!Array.isArray(request.next.identity)&&Buffer.byteLength(canonical(request.next.identity))<=4096,'IDENTITY_REQUEST_INVALID');
    return request;
}
function scopeShape(s,mode){
    keys(s,['actorId','sessionHash','browserHash','accessVersion','controlRevision','staffOrigin','deploymentId','releaseSha','staffConfigHash','specimenId','assignmentFence']);
    check(uuid(s.actorId)&&uuid(s.specimenId)&&['sessionHash','browserHash','staffConfigHash'].every(k=>sha(s[k]))
        &&['accessVersion','controlRevision','assignmentFence'].every(k=>positive(s[k]))&&text(s.deploymentId,120)&&/^[a-f0-9]{40}$/.test(s.releaseSha),'IDENTITY_SCOPE_INVALID');
    if(mode!=='LOCAL_FIXTURE'||s.staffOrigin!=='http://127.0.0.1:4318')bridgeOrigin(s.staffOrigin);
}
export function identityCorrectionRequestCanonical(specimenId,request){
    check(uuid(specimenId),'IDENTITY_REQUEST_INVALID');validateIdentityCorrectionRequest(request);
    return canonical({version:'atlas-identity-correction-request-v1',specimenId,request});
}
export function signIdentityCorrectionRequest(config,scope,request,now=Date.now(),nonce=randomUUID()){
    scopeShape(scope,config.mode);validateIdentityCorrectionRequest(request);
    const body=canonical({purpose:IDENTITY_CORRECTION_PURPOSE,audience:config.origin,bridgeConfigHash:config.configHash,scope,request,nonce,issuedAt:now,expiresAt:now+30_000});
    check(Buffer.byteLength(body)<=8192,'IDENTITY_REQUEST_INVALID');return{body,signature:createHmac('sha256',config.key).update(body).digest('hex')};
}
export function verifyIdentityCorrectionRequest(config,body,signature,now=Date.now()){
    check(typeof body==='string'&&Buffer.byteLength(body)<=8192&&sha(signature),'IDENTITY_REQUEST_INVALID');
    check(timingSafeEqual(createHmac('sha256',config.key).update(body).digest(),Buffer.from(signature,'hex')),'IDENTITY_AUTHENTICATION_REQUIRED');
    let p;try{p=JSON.parse(body);}catch{check(false,'IDENTITY_REQUEST_INVALID');}
    keys(p,['purpose','audience','bridgeConfigHash','scope','request','nonce','issuedAt','expiresAt']);
    check(canonical(p)===body&&p.purpose===IDENTITY_CORRECTION_PURPOSE&&p.audience===config.origin&&p.bridgeConfigHash===config.configHash&&uuid(p.nonce)
        &&Number.isSafeInteger(p.issuedAt)&&Number.isSafeInteger(p.expiresAt)&&p.issuedAt<=now&&p.expiresAt>now
        &&p.expiresAt>p.issuedAt&&p.expiresAt-p.issuedAt<=30_000,'IDENTITY_REQUEST_EXPIRED');
    scopeShape(p.scope,config.mode);validateIdentityCorrectionRequest(p.request);return p;
}
function checked(body,hash,limit=2*1024*1024){
    check(typeof body==='string'&&Buffer.byteLength(body)<=limit&&sha(hash)&&digest(body)===hash,'IDENTITY_EVIDENCE_INVALID');
    let value;try{value=JSON.parse(body);}catch{check(false,'IDENTITY_EVIDENCE_INVALID');}check(canonical(value)===body,'IDENTITY_EVIDENCE_INVALID');return value;
}
export function identityCorrectionRawSource(source){
    check(date(source.updatedAt),'IDENTITY_SOURCE_CHANGED');
    return{id:source.id,createdByUserId:source.createdByUserId,cardProfile:source.cardProfile,workflowState:source.workflowState,
        identity:source.identity,capture:source.capture,reviewedDefects:source.reviewedDefects,gradeReport:source.gradeReport,
        mapRevisionId:source.mapRevisionId??null,mapFilterPolicyVersion:source.mapFilterPolicyVersion??null,mapRegistration:source.mapRegistration??null,
        updatedAt:source.updatedAt.toISOString()};
}
export function identityCorrectionReceipt(row){
    return{status:'CORRECTED',receiptId:row.id,operationId:row.operationId,analysisRevision:row.resultAnalysisRevision,
        reviewRevision:row.resultReviewRevision,evidenceRevision:row.resultEvidenceRevision,evidenceHash:row.newEvidenceHash,
        sourceHash:row.newSourceHash,reviewHash:row.newReviewHash,createdAt:row.createdAt.toISOString()};
}
export function identityCorrectionAudit(row){return{identityCorrectionId:row.id,operationId:row.operationId,inputHash:row.inputHash,proofHash:row.proofHash,assignmentFence:row.assignmentFence};}

/** Original private client only. No provider, bank or legacy administrator port.
 * External immutable-byte preflight occurs between two authorized transactions.
 * All mutations and both old/postimage guards belong to the final transaction. */
export class ScopedIdentityCorrection{
    constructor({client,config,ports}){
        const verified=makeIdentityCorrectionConfig({...config,otherKeyHashes:[]});
        check(config.configHash===verified.configHash&&typeof client?.$transaction==='function'
            &&['loadRawSource','classify','preflight','assertCurrentAuthority','projectNext','reportSource','sourceEvidence','previewReport','safeTitle','compareAndSwap','isStaffPhoneAllowed']
                .every(k=>typeof ports?.[k]==='function'),'IDENTITY_CONFIGURATION_INVALID');
        this.client=client;this.config=verified;this.ports=ports;
    }
    async authorize(tx,s,now){
        const [control]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffControl" WHERE id='active' FOR SHARE`;
        const [correction]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffIdentityCorrectionControl" WHERE id='active' FOR SHARE`;
        check(control?.enabled&&correction?.enabled&&positive(correction.revision)
            &&['mode','origin','deploymentId','releaseSha','configHash','clientKeyHash','gradingPolicyHash','phoneAllowlistHash'].every(k=>correction[k]===this.config[k])
            &&control.mode===this.config.mode&&control.gradingPolicyHash===this.config.gradingPolicyHash&&control.revision===s.controlRevision
            &&control.origin===s.staffOrigin&&control.deploymentId===s.deploymentId&&control.releaseSha===s.releaseSha&&control.configHash===s.staffConfigHash,'IDENTITY_NOT_ENABLED');
        const [i]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffIdentity" WHERE id=${s.actorId}::uuid FOR SHARE`;
        const [session]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffSession" WHERE "tokenHash"=${s.sessionHash} FOR SHARE`;
        const [browser]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffBrowser" WHERE "tokenHash"=${s.browserHash} FOR SHARE`;
        const [assignment]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffAssignment" WHERE "specimenId"=${s.specimenId}::uuid AND "identityId"=${s.actorId}::uuid FOR SHARE`;
        check(i?.id===s.actorId&&i.role==='REVIEWER'&&!i.revokedAt&&i.accessVersion===s.accessVersion&&this.ports.isStaffPhoneAllowed(i.phoneHash)===true
            &&session?.identityId===i.id&&!session.revokedAt&&session.tokenHash===s.sessionHash&&session.accessVersion===i.accessVersion
            &&session.browserHash===s.browserHash&&session.controlRevision===control.revision&&date(session.createdAt)&&session.createdAt<=now
            &&+now-+session.createdAt<=300_000&&date(session.expiresAt)&&session.expiresAt>now
            &&browser?.tokenHash===s.browserHash&&browser.controlRevision===control.revision&&date(browser.createdAt)&&browser.createdAt<=session.createdAt
            &&date(browser.expiresAt)&&browser.expiresAt>now&&assignment?.canReview&&!assignment.revokedAt
            &&assignment.fence===s.assignmentFence&&date(assignment.expiresAt)&&assignment.expiresAt>now,'FRESH_IDENTITY_REVIEWER_REQUIRED');
        return{i,session,browser,assignment,control,correction};
    }
    async replay(tx,s,requestCanonical){
        const operationId=JSON.parse(requestCanonical).request.operationId;
        const [prior]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffIdentityCorrection" WHERE "actorId"=${s.actorId}::uuid AND "operationId"=${operationId}::uuid FOR SHARE`;
        if(!prior)return null;
        check(prior.specimenId===s.specimenId&&prior.requestCanonical===requestCanonical&&prior.inputHash===digest(requestCanonical),'IDENTITY_REQUEST_CONFLICT');
        return identityCorrectionReceipt(prior);
    }
    async heads(tx,s,r,now){
        const [card]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffSpecimen" WHERE id=${s.specimenId}::uuid FOR UPDATE`;
        const [analysis]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffAnalysisRevision" WHERE "specimenId"=${s.specimenId}::uuid AND revision=${r.expectedAnalysisRevision} FOR SHARE`;
        const [review]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffReviewRevision" WHERE "specimenId"=${s.specimenId}::uuid AND revision=${r.expectedReviewRevision} FOR SHARE`;
        const [publication]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffPublicReport" WHERE "specimenId"=${s.specimenId}::uuid FOR SHARE`;
        check(card?.id===s.specimenId&&card.analysisRevision===r.expectedAnalysisRevision&&card.draftRevision===r.expectedReviewRevision
            &&card.evidenceRevision===r.expectedEvidenceRevision&&card.evidenceHash===r.evidenceHash
            &&analysis?.sourceHash===r.analysisHash&&analysis.sourceRevision===r.sourceRevision&&analysis.evidenceHash===r.evidenceHash
            &&analysis.mode===this.config.mode&&review?.contentHash===r.reviewHash&&review.evidenceHash===r.evidenceHash
            &&review.analysisRevision===r.expectedAnalysisRevision,'IDENTITY_HEAD_CHANGED');
        const snapshot=checked(analysis.sourceCanonical,analysis.sourceHash),evidence=checked(card.evidenceCanonical,card.evidenceHash,131072),
            draft=checked(review.canonical,review.contentHash,65536),admission=checked(analysis.admissionCanonical,analysis.admissionHash,8192);
        checked(analysis.reportCanonical,analysis.reportHash);
        check(admission.purpose==='atlas-analysis-admission-v1'&&admission.mode===this.config.mode&&admission.policyHash===this.config.gradingPolicyHash
            &&admission.sourceHash===analysis.sourceHash&&admission.evidenceHash===card.evidenceHash,'IDENTITY_ADMISSION_CHANGED');
        if(this.config.mode==='PRODUCTION'){
            const [bridge]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffGradingBridgeControl" WHERE id='active' FOR SHARE`;
            check(admission.detectionPair&&admission.sourceId===card.sourceId&&admission.sourceOwnerId===card.sourceOwnerId
                &&bridge?.mode===this.config.mode&&bridge.gradingPolicyHash===this.config.gradingPolicyHash&&bridge.policyHash===admission.bridgePolicyHash
                &&bridge.revision===admission.bridgeRevision,'IDENTITY_ADMISSION_CHANGED');
        }
        const [{pending}]=await tx.$queryRaw`SELECT (
            EXISTS(SELECT 1 FROM atlas_staff."StaffGradingOperation" WHERE "specimenId"=${card.id}::uuid AND state IN ('RESERVED','DISPATCHED','UNKNOWN'))
            OR EXISTS(SELECT 1 FROM atlas_staff."StaffGradingExecution" e JOIN atlas_staff."StaffGradingOperation" o ON o.id=e."operationId" WHERE o."specimenId"=${card.id}::uuid AND e.state IN ('RUNNING','UNKNOWN'))
            OR EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorRun" WHERE "specimenId"=${card.id}::uuid AND state IN ('QUEUED','RUNNING','WAITING_TOOL','UNKNOWN'))
            OR EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorAttempt" a JOIN atlas_staff."StaffOperatorRun" r ON r.id=a."runId" WHERE r."specimenId"=${card.id}::uuid AND a.state IN ('RESERVED','DISPATCHED','RECEIVED','UNKNOWN'))
            OR EXISTS(SELECT 1 FROM atlas_staff.read_operator_proposals(${card.id}::uuid) p WHERE p."evidenceHash"=${card.evidenceHash}
                AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffProposalDecision" d WHERE d."stepId"=p."stepId" AND d."analysisRevision"=${card.analysisRevision} AND d."evidenceHash"=${card.evidenceHash}))
            OR EXISTS(SELECT 1 FROM atlas_staff."StaffNfcJob" WHERE "specimenId"=${card.id}::uuid AND "expiresAt">(${now}::timestamptz AT TIME ZONE 'UTC'))
            OR EXISTS(SELECT 1 FROM atlas_staff."StaffPhysicalFinish" f WHERE f."specimenId"=${card.id}::uuid AND f.stage='ASSEMBLED'
                AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffPhysicalFinish" w WHERE w."assemblyId"=f.id AND w.stage='SONIC_WELDED'))
        ) AS pending`;
        check(pending===false,'IDENTITY_WORK_UNRESOLVED');
        return{card,analysis,review,publication,snapshot,evidence,draft,admission};
    }
    async source(tx,a,r){
        const exact={sourceType:a.card.sourceType,sourceId:a.card.sourceId,sourceOwnerId:a.card.sourceOwnerId};
        check(exact.sourceType===(this.config.mode==='PRODUCTION'?'SPEEDSTER':'LOCAL_FIXTURE'),'IDENTITY_SOURCE_CHANGED');
        const raw=await this.ports.loadRawSource(tx,exact);
        check(raw?.id===exact.sourceId&&raw.createdByUserId===exact.sourceOwnerId&&raw.workflowState==='CAPTURED'
            &&date(raw.updatedAt)&&raw.updatedAt.toISOString()===r.sourceRevision,'IDENTITY_SOURCE_CHANGED');
        const proposal=await this.ports.classify(raw,{sourceId:raw.id,sourceOwnerId:raw.createdByUserId,sourceRevision:r.sourceRevision,evidenceSourceRevision:a.evidence.sourceRevision,
            sourceHash:r.analysisHash,evidenceHash:r.evidenceHash,gradingPolicyHash:this.config.gradingPolicyHash},r.next);
        check(['COMPATIBLE','NO_CHANGE','REPROCESS_REQUIRED'].includes(proposal.status)&&sha(proposal.proofHash)
            &&digest(proposal.proofCanonical)===proposal.proofHash,'IDENTITY_PROPOSAL_INVALID');
        return{raw,proposal};
    }
    async transaction(p,body,signature,work){
        return this.client.$transaction(async tx=>{
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0))`;
            const [{now}]=await tx.$queryRaw`SELECT clock_timestamp() AS now`;
            verifyIdentityCorrectionRequest(this.config,body,signature,+now);const auth=await this.authorize(tx,p.scope,now);
            const result=await work(tx,auth,now);
            const [{now:finishedAt}]=await tx.$queryRaw`SELECT clock_timestamp() AS now`;
            verifyIdentityCorrectionRequest(this.config,body,signature,+finishedAt);await this.authorize(tx,p.scope,finishedAt);
            await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;return result;
        },{maxWait:5000,timeout:10_000});
    }
    async receive(body,signature){
        const p=verifyIdentityCorrectionRequest(this.config,body,signature),s=p.scope,r=p.request,
            requestCanonical=identityCorrectionRequestCanonical(s.specimenId,r);
        const initial=await this.transaction(p,body,signature,async(tx,_auth,now)=>{
            const replay=await this.replay(tx,s,requestCanonical);if(replay)return{response:replay};
            const a=await this.heads(tx,s,r,now),{raw,proposal}=await this.source(tx,a,r);
            if(proposal.status!=='COMPATIBLE')return{response:{status:proposal.status,reasons:proposal.reasons,changedFields:proposal.changedFields,
                identity:JSON.parse(proposal.nextIdentityCanonical)}};
            return{raw,proposal};
        });
        if(initial.response)return initial.response;
        const preflight=await this.ports.preflight(structuredClone(initial.raw));
        return this.transaction(p,body,signature,async(tx,auth,now)=>{
            const replay=await this.replay(tx,s,requestCanonical);if(replay)return replay;
            const a=await this.heads(tx,s,r,now),{raw,proposal}=await this.source(tx,a,r);
            check(proposal.status==='COMPATIBLE'&&proposal.proofHash===initial.proposal.proofHash,'IDENTITY_SOURCE_CHANGED');
            await this.ports.assertCurrentAuthority(tx,raw,preflight);
            const [{now:changedAt}]=await tx.$queryRaw`SELECT clock_timestamp() AS now`;
            check(date(changedAt)&&changedAt>raw.updatedAt,'IDENTITY_SOURCE_REVISION_CONFLICT');
            const next=await this.ports.projectNext(raw,JSON.parse(proposal.nextIdentityCanonical),changedAt);
            const rawSourceCanonical=canonical(identityCorrectionRawSource(raw)),nextRawSourceCanonical=canonical(identityCorrectionRawSource(next));
            check(canonical({...identityCorrectionRawSource(raw),identity:next.identity,updatedAt:changedAt.toISOString()})===nextRawSourceCanonical,'IDENTITY_SOURCE_MUTATION_INVALID');
            const sourceCanonical=canonical(await this.ports.reportSource(next)),sourceHash=digest(sourceCanonical),
                evidenceCanonical=canonical(await this.ports.sourceEvidence(next,changedAt.toISOString())),evidenceHash=digest(evidenceCanonical),
                reportCanonical=canonical(await this.ports.previewReport(JSON.parse(sourceCanonical)));
            const previous=JSON.parse(a.analysis.sourceCanonical);
            check(canonical({...previous,identity:next.identity})===sourceCanonical,'IDENTITY_SOURCE_MUTATION_INVALID');
            const newReport=JSON.parse(reportCanonical),oldReport=JSON.parse(a.analysis.reportCanonical);
            check(canonical({...oldReport,identity:newReport.identity})===reportCanonical&&canonical(newReport.identity)===proposal.nextIdentityCanonical,'IDENTITY_REPORT_CHANGED');
            check(canonical({...a.evidence,sourceRevision:changedAt.toISOString(),identityHash:digest(canonical({cardProfile:next.cardProfile,identity:next.identity}))})===evidenceCanonical,'IDENTITY_EVIDENCE_CHANGED');
            const id=randomUUID(),resultAnalysisRevision=a.card.analysisRevision+1,resultReviewRevision=a.card.draftRevision+1,resultEvidenceRevision=a.card.evidenceRevision+1;
            const admission={purpose:'atlas-analysis-admission-v1',mode:this.config.mode,policyHash:this.config.gradingPolicyHash,
                ...(a.admission.bridgePolicyHash===undefined?{}:{bridgePolicyHash:a.admission.bridgePolicyHash}),
                ...(a.admission.bridgeRevision===undefined?{}:{bridgeRevision:a.admission.bridgeRevision}),
                sourceId:a.card.sourceId,sourceOwnerId:a.card.sourceOwnerId,sourceHash,evidenceHash,
                ...(a.admission.detectionPair===undefined?{}:{detectionPair:a.admission.detectionPair}),provenance:'IDENTITY_CORRECTION',identityCorrectionId:id,
                previousAnalysisRevision:a.analysis.revision,previousAdmissionHash:a.analysis.admissionHash,
                previousSourceHash:a.analysis.sourceHash,previousEvidenceHash:a.card.evidenceHash,proofHash:proposal.proofHash};
            const admissionCanonical=canonical(admission),draft={...a.draft,revision:resultReviewRevision,evidenceRevision:resultEvidenceRevision,evidenceHash,
                reviewedSides:[],identityReviewed:false,disposition:'IN_REVIEW',savedAt:changedAt.toISOString(),savedBy:auth.i.name},reviewCanonical=canonical(draft);
            const row={id,specimenId:s.specimenId,actorId:s.actorId,operationId:r.operationId,sessionHash:s.sessionHash,browserHash:s.browserHash,
                accessVersion:s.accessVersion,assignmentFence:s.assignmentFence,controlRevision:s.controlRevision,correctionControlRevision:auth.correction.revision,
                requestCanonical,inputHash:digest(requestCanonical),sourceType:a.card.sourceType,sourceId:a.card.sourceId,sourceOwnerId:a.card.sourceOwnerId,
                expectedAnalysisRevision:a.card.analysisRevision,expectedReviewRevision:a.card.draftRevision,expectedEvidenceRevision:a.card.evidenceRevision,
                resultAnalysisRevision,resultReviewRevision,resultEvidenceRevision,oldSourceRevision:r.sourceRevision,newSourceRevision:changedAt.toISOString(),
                oldSourceHash:a.analysis.sourceHash,newSourceHash:sourceHash,oldEvidenceHash:a.card.evidenceHash,newEvidenceHash:evidenceHash,
                oldReportHash:a.analysis.reportHash,newReportHash:digest(reportCanonical),oldReviewHash:a.review.contentHash,newReviewHash:digest(reviewCanonical),
                oldAdmissionHash:a.analysis.admissionHash,oldIdentityCanonical:canonical(previous.identity),newIdentityCanonical:proposal.nextIdentityCanonical,
                oldEvidenceCanonical:a.card.evidenceCanonical,newEvidenceCanonical:evidenceCanonical,proofCanonical:proposal.proofCanonical,proofHash:proposal.proofHash,
                rawSourceCanonical,rawSourceHash:digest(rawSourceCanonical),nextRawSourceCanonical,nextRawSourceHash:digest(nextRawSourceCanonical),
                priorApprovalId:a.publication?.currentApprovalId??null,gradingPolicyHash:this.config.gradingPolicyHash,bridgeConfigHash:this.config.configHash,createdAt:changedAt};
            await insertReceipt(tx,row);
            const saved=await this.ports.compareAndSwap(tx,raw,next);
            check(canonical(identityCorrectionRawSource(saved))===nextRawSourceCanonical,'IDENTITY_SOURCE_CAS_FAILED');
            await tx.$executeRaw`INSERT INTO atlas_staff."StaffAnalysisRevision" ("identityCorrectionId","specimenId",revision,"evidenceHash","sourceCanonical","sourceHash","reportCanonical","reportHash","admissionCanonical","admissionHash","sourceRevision",mode,"createdAt")
                VALUES(${id}::uuid,${s.specimenId}::uuid,${resultAnalysisRevision},${evidenceHash},${sourceCanonical},${sourceHash},${reportCanonical},${row.newReportHash},${admissionCanonical},${digest(admissionCanonical)},${row.newSourceRevision},${this.config.mode},(${changedAt}::timestamptz AT TIME ZONE 'UTC'))`;
            await tx.$executeRaw`INSERT INTO atlas_staff."StaffReviewRevision" ("specimenId",revision,"evidenceRevision","evidenceHash","contentHash","analysisRevision",canonical,"savedById","savedAt")
                VALUES(${s.specimenId}::uuid,${resultReviewRevision},${resultEvidenceRevision},${evidenceHash},${row.newReviewHash},${resultAnalysisRevision},${reviewCanonical},${s.actorId}::uuid,(${changedAt}::timestamptz AT TIME ZONE 'UTC'))`;
            const title=await this.ports.safeTitle(next);keys(title,['title','subtitle']);check(text(title.title,200)&&text(title.subtitle,300),'IDENTITY_TITLE_INVALID');
            const updated=await tx.$executeRaw`UPDATE atlas_staff."StaffSpecimen" SET "analysisRevision"=${resultAnalysisRevision},"draftRevision"=${resultReviewRevision},"evidenceRevision"=${resultEvidenceRevision},
                "evidenceCanonical"=${evidenceCanonical},"evidenceHash"=${evidenceHash},title=${title.title},subtitle=${title.subtitle}
                WHERE id=${s.specimenId}::uuid AND "analysisRevision"=${r.expectedAnalysisRevision} AND "draftRevision"=${r.expectedReviewRevision} AND "evidenceHash"=${r.evidenceHash}`;
            check(updated===1,'IDENTITY_HEAD_CHANGED');
            await tx.$executeRaw`INSERT INTO atlas_staff."StaffAudit" (id,event,"subjectId","actorId",details,"createdAt") VALUES
                (${id}::uuid,'IDENTITY_CORRECTED',${s.specimenId},${s.actorId}::uuid,${canonical(identityCorrectionAudit(row))},(${changedAt}::timestamptz AT TIME ZONE 'UTC'))`;
            return identityCorrectionReceipt(row);
        });
    }
}

async function insertReceipt(tx,r){
    await tx.$executeRaw`INSERT INTO atlas_staff."StaffIdentityCorrection" (id,"specimenId","actorId","operationId","sessionHash","browserHash","accessVersion","assignmentFence","controlRevision","correctionControlRevision",
        "requestCanonical","inputHash","sourceType","sourceId","sourceOwnerId","expectedAnalysisRevision","expectedReviewRevision","expectedEvidenceRevision","resultAnalysisRevision","resultReviewRevision","resultEvidenceRevision",
        "oldSourceRevision","newSourceRevision","oldSourceHash","newSourceHash","oldEvidenceHash","newEvidenceHash","oldReportHash","newReportHash","oldReviewHash","newReviewHash","oldAdmissionHash",
        "oldIdentityCanonical","newIdentityCanonical","oldEvidenceCanonical","newEvidenceCanonical","proofCanonical","proofHash","rawSourceCanonical","rawSourceHash","nextRawSourceCanonical","nextRawSourceHash",
        "priorApprovalId","gradingPolicyHash","bridgeConfigHash","createdAt") VALUES
        (${r.id}::uuid,${r.specimenId}::uuid,${r.actorId}::uuid,${r.operationId}::uuid,${r.sessionHash},${r.browserHash},${r.accessVersion},${r.assignmentFence},${r.controlRevision},${r.correctionControlRevision},
        ${r.requestCanonical},${r.inputHash},${r.sourceType},${r.sourceId},${r.sourceOwnerId},${r.expectedAnalysisRevision},${r.expectedReviewRevision},${r.expectedEvidenceRevision},${r.resultAnalysisRevision},${r.resultReviewRevision},${r.resultEvidenceRevision},
        ${r.oldSourceRevision},${r.newSourceRevision},${r.oldSourceHash},${r.newSourceHash},${r.oldEvidenceHash},${r.newEvidenceHash},${r.oldReportHash},${r.newReportHash},${r.oldReviewHash},${r.newReviewHash},${r.oldAdmissionHash},
        ${r.oldIdentityCanonical},${r.newIdentityCanonical},${r.oldEvidenceCanonical},${r.newEvidenceCanonical},${r.proofCanonical},${r.proofHash},${r.rawSourceCanonical},${r.rawSourceHash},${r.nextRawSourceCanonical},${r.nextRawSourceHash},
        ${r.priorApprovalId}::uuid,${r.gradingPolicyHash},${r.bridgeConfigHash},(${r.createdAt}::timestamptz AT TIME ZONE 'UTC'))`;
}

/** Wire results are a safe projection, not authority for subsequent staff writes.
 * A lost reply retries the identical operation under current human authority. */
export function identityCorrectionClient(config,fetchImpl=fetch,{timers={setTimeout,clearTimeout}}={}){
    bridgeOrigin(config.origin);
    return Object.freeze({binding:Object.freeze({bridgeConfigHash:config.configHash,gradingPolicyHash:config.gradingPolicyHash}),async call(scope,request){
        const signed=signIdentityCorrectionRequest(config,scope,request),controller=new AbortController();
        let reader,timer,closed=false,complete=false;const cancel=target=>{try{Promise.resolve(target?.cancel()).catch(()=>{});}catch{}};
        const deadline=new Promise((_,reject)=>{timer=timers.setTimeout(()=>{controller.abort();reject(Object.assign(new Error('IDENTITY_OUTCOME_UNCONFIRMED'),{code:'IDENTITY_OUTCOME_UNCONFIRMED'}));},15_000);});
        try{return await Promise.race([deadline,(async()=>{
            const response=await fetchImpl(`${config.origin}${IDENTITY_CORRECTION_PATH}`,{method:'POST',redirect:'error',credentials:'omit',cache:'no-store',
                headers:{'content-type':'application/json','x-atlas-identity-signature':signed.signature},body:signed.body,signal:controller.signal});
            if(closed){cancel(response.body);check(false,'IDENTITY_OUTCOME_UNCONFIRMED');}
            const length=response.headers?.get('content-length');
            if(response.status!==200||response.redirected===true||!response.body?.getReader
                ||response.headers?.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json'
                ||length!=null&&(!/^\d+$/.test(length)||!Number.isSafeInteger(Number(length))||Number(length)>16384)){
                cancel(response.body);check(false,'IDENTITY_OUTCOME_UNCONFIRMED');}
            reader=response.body.getReader();const chunks=[];let size=0;
            while(true){const {done,value}=await reader.read();check(!closed,'IDENTITY_OUTCOME_UNCONFIRMED');if(done){complete=true;break;}
                check(value instanceof Uint8Array&&(size+=value.byteLength)<=16384,'IDENTITY_RESPONSE_INVALID');chunks.push(Buffer.from(value));}
            const body=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size)),result=JSON.parse(body);
            check(canonical(result)===body,'IDENTITY_RESPONSE_INVALID');
            if(result.status==='CORRECTED'){
                keys(result,['status','receiptId','operationId','analysisRevision','reviewRevision','evidenceRevision','evidenceHash','sourceHash','reviewHash','createdAt']);
                check(uuid(result.receiptId)&&result.operationId===request.operationId&&['analysisRevision','reviewRevision','evidenceRevision'].every(k=>positive(result[k]))
                    &&['evidenceHash','sourceHash','reviewHash'].every(k=>sha(result[k]))&&text(result.createdAt,80),'IDENTITY_RESPONSE_INVALID');
            }else{
                keys(result,['status','reasons','changedFields','identity']);
                check(['NO_CHANGE','REPROCESS_REQUIRED'].includes(result.status)&&Array.isArray(result.reasons)&&result.reasons.length<=4
                    &&result.reasons.every(reason=>['CATEGORY_CHANGED','LAYOUT_CHANGED','EXACT_MAP_KEY_CHANGED','FAMILY_MAP_KEY_CHANGED'].includes(reason))
                    &&Array.isArray(result.changedFields)&&result.changedFields.length<=12&&result.changedFields.every(field=>text(field,40))
                    &&result.identity&&typeof result.identity==='object'&&!Array.isArray(result.identity),'IDENTITY_RESPONSE_INVALID');
            }
            return result;
        })()]);}finally{closed=true;timers.clearTimeout(timer);controller.abort();if(!complete)cancel(reader);try{reader?.releaseLock();}catch{}}
    }});
}
