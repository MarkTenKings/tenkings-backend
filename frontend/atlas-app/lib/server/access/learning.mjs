import { randomUUID } from 'node:crypto';
import { DurableStaffAuth } from './auth.mjs';
import { canonical } from '../review-contract.mjs';
import { deny, hash, identifier, strictObject } from '../policy.mjs';
import { publicLearningCandidates, validateLearningCandidates, checkedLearningJSON } from '@atlas/service-bridge/trusted-learning';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,SHA=/^[a-f0-9]{64}$/;
const date=v=>v instanceof Date&&Number.isFinite(+v);
const check=(value,code='LEARNING_REQUEST_INVALID',status=409)=>{if(!value)deny(status,code);};
const uuid=value=>check(typeof value==='string'&&UUID.test(value),'LEARNING_REQUEST_INVALID',400);
const sha=value=>check(typeof value==='string'&&SHA.test(value),'LEARNING_REQUEST_INVALID',400);

/** Receipt SELECT only. This SECURITY DEFINER must hold the exact original
 * public source FOR SHARE until the final decision transaction commits. */
export function learningCandidatePort({client}){
    check(typeof client?.call==='function'&&SHA.test(client.binding?.bridgeConfigHash??'')
        &&SHA.test(client.binding?.gradingPolicyHash??''),'LEARNING_NOT_CONFIGURED',503);
    const binding=Object.freeze({...client.binding});
    return Object.freeze({binding,call:scope=>client.call(scope),async inspect(context,{specimenId,approvalId,candidatesId}){
        const rows=await context.tx.$queryRaw`SELECT * FROM atlas_staff.lock_learning_candidates(${context.identity.id}::uuid,${context.session.tokenHash},
            ${specimenId}::uuid,${approvalId}::uuid,${candidatesId}::uuid)`;
        const [{now}]=await context.tx.$queryRaw`SELECT clock_timestamp() AS now`;
        check(rows.length===1,'LEARNING_PREFLIGHT_REQUIRED');const row=rows[0];
        check(row.id===candidatesId&&row.actorId===context.identity.id&&row.sessionHash===context.session.tokenHash
            &&row.specimenId===specimenId&&row.approvalId===approvalId&&row.accessVersion===context.identity.accessVersion
            &&row.assignmentFence===context.assignment.fence&&row.controlRevision===context.control.revision
            &&row.gradingPolicyHash===binding.gradingPolicyHash&&row.bridgeConfigHash===binding.bridgeConfigHash
            &&context.control.gradingPolicyHash===binding.gradingPolicyHash&&date(now)&&date(row.createdAt)&&row.createdAt<=now
            &&date(row.expiresAt)&&row.expiresAt>now&&+row.expiresAt-+row.createdAt<=300_000,'LEARNING_CANDIDATES_EXPIRED');
        validateLearningCandidates(row);return row;
    }});
}
/** Durable human decisions only. No bank application exists in this service. */
export class StaffTrustedLearning {
    constructor({auth,review,candidates}){
        check(auth instanceof DurableStaffAuth&&typeof review?.assigned==='function','LEARNING_NOT_CONFIGURED',503);
        this.auth=auth;this.review=review;this.candidates=candidates;
    }
    available(){check(typeof this.candidates?.call==='function'&&typeof this.candidates?.inspect==='function'
        &&SHA.test(this.candidates.binding?.bridgeConfigHash??'')&&SHA.test(this.candidates.binding?.gradingPolicyHash??''),'LEARNING_NOT_CONFIGURED',503);}
    current(context){
        const {identity:i,session:s,assignment:a,now,control}=context;
        check(date(now)&&control?.enabled
            &&i?.role==='REVIEWER'&&!i.revokedAt&&date(i.trustedLearningUntil)&&i.trustedLearningUntil>now
            &&s?.identityId===i.id&&!s.revokedAt&&s.accessVersion===i.accessVersion&&s.controlRevision===control.revision
            &&date(s.createdAt)&&s.createdAt<=now&&+now-+s.createdAt<=300_000&&date(s.expiresAt)&&s.expiresAt>now
            &&s.browser?.tokenHash===s.browserHash&&s.browser.controlRevision===control.revision
            &&date(s.browser.createdAt)&&s.browser.createdAt<=s.createdAt&&date(s.browser.expiresAt)&&s.browser.expiresAt>now
            &&a?.identityId===i.id&&a.canReview&&!a.revokedAt&&date(a.expiresAt)&&a.expiresAt>now,'FRESH_TRUSTED_LEARNING_REVIEWER_REQUIRED',403);
    }
    transaction(staff,specimenId,work){
        uuid(specimenId);
        const handle=this.auth.actors.get(staff);check(handle,'SIGN_IN_REQUIRED',401);
        return this.auth.withStaff(staff,async c=>{
            const assignment=await this.review.assigned(c,specimenId),context={...c,assignment};this.current(context);
            const result=await work(context);
            const [{now}]=await c.tx.$queryRaw`SELECT clock_timestamp() AS now`;
            const latest=await this.auth.current({...c,now},handle.sessionHash,handle.browserHash);
            check(latest&&latest.identity.accessVersion===c.identity.accessVersion,'FRESH_TRUSTED_LEARNING_REVIEWER_REQUIRED',403);
            const finalAssignment=await this.review.assigned({...c,...latest,now},specimenId);
            check(finalAssignment.fence===assignment.fence,'LEARNING_ASSIGNMENT_CHANGED');
            this.current({...c,...latest,assignment:finalAssignment,now});
            await c.tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;return result;
        });
    }
    async approved(c,specimenId,approvalId){
        uuid(approvalId);
        const [card]=await c.tx.$queryRaw`SELECT * FROM atlas_staff."StaffSpecimen" WHERE id=${specimenId}::uuid FOR SHARE`;
        const publication=await c.tx.staffPublicReport.findUnique({where:{specimenId}});
        const approval=await c.tx.staffReportApproval.findUnique({where:{id:approvalId}});
        check(card&&approval?.specimenId===card.id&&publication?.currentApprovalId===approval.id
            &&approval.evidenceHash===card.evidenceHash&&approval.analysisRevision===card.analysisRevision
            &&approval.reviewRevision===card.draftRevision,'LEARNING_APPROVAL_CHANGED');
        const analysis=await c.tx.staffAnalysisRevision.findUnique({where:{specimenId_revision:{specimenId,revision:card.analysisRevision}}});
        const review=await c.tx.staffReviewRevision.findUnique({where:{specimenId_revision:{specimenId,revision:card.draftRevision}}});
        check(analysis?.sourceHash===approval.analysisHash&&analysis.evidenceHash===card.evidenceHash&&analysis.mode===c.control.mode
            &&review?.contentHash===approval.reviewHash,'LEARNING_APPROVAL_CHANGED');
        const source=checkedLearningJSON(analysis.sourceCanonical,analysis.sourceHash,2*1024*1024);
        const admission=checkedLearningJSON(analysis.admissionCanonical,analysis.admissionHash,8192);
        check(admission.purpose==='atlas-analysis-admission-v1'&&admission.sourceHash===analysis.sourceHash
            &&admission.evidenceHash===card.evidenceHash&&admission.mode===c.control.mode&&admission.policyHash===c.control.gradingPolicyHash
            &&Array.isArray(source.reviewedDefects),'LEARNING_EVIDENCE_INVALID');
        return {card,approval,analysis,source,rawFindingsHash:hash(canonical(source.reviewedDefects))};
    }
    match(row,snapshot){
        check(row.approvalId===snapshot.approval.id&&row.specimenId===snapshot.card.id&&row.evidenceHash===snapshot.card.evidenceHash
            &&row.analysisRevision===snapshot.card.analysisRevision&&row.reviewRevision===snapshot.card.draftRevision
            &&row.analysisHash===snapshot.analysis.sourceHash&&row.reviewHash===snapshot.approval.reviewHash
            &&row.sourceRevision===snapshot.analysis.sourceRevision&&row.rawFindingsHash===snapshot.rawFindingsHash
            &&row.sourceType===snapshot.card.sourceType&&row.sourceId===snapshot.card.sourceId&&row.sourceOwnerId===snapshot.card.sourceOwnerId,
            'LEARNING_APPROVAL_CHANGED');
    }
    async preview(staff,specimenId,input){
        this.available();
        strictObject(input,['approvalId']);uuid(input.approvalId);
        const scope=await this.transaction(staff,specimenId,async c=>{
            const {card,approval,analysis}=await this.approved(c,specimenId,input.approvalId);
            return {actorId:c.identity.id,sessionHash:c.session.tokenHash,browserHash:c.session.browserHash,accessVersion:c.identity.accessVersion,
                controlRevision:c.control.revision,staffOrigin:c.control.origin,deploymentId:c.control.deploymentId,releaseSha:c.control.releaseSha,
                staffConfigHash:c.control.configHash,specimenId:card.id,approvalId:approval.id,assignmentFence:c.assignment.fence,
                analysisRevision:card.analysisRevision,reviewRevision:card.draftRevision,evidenceHash:card.evidenceHash,
                analysisHash:analysis.sourceHash,reviewHash:approval.reviewHash,sourceRevision:analysis.sourceRevision};
        });
        // Signed private source read occurs only after the staff transaction ends.
        const wire=await this.candidates.call(scope);uuid(wire?.receiptId);sha(wire?.bundleHash);
        return this.transaction(staff,specimenId,async c=>{
            const snapshot=await this.approved(c,specimenId,input.approvalId);
            const row=await this.candidates.inspect(c,{specimenId,approvalId:input.approvalId,candidatesId:wire.receiptId});
            this.match(row,snapshot);check(row.bundleHash===wire.bundleHash,'LEARNING_EVIDENCE_INVALID');
            return {specimenId,approvalId:input.approvalId,candidatesId:row.id,bundleHash:row.bundleHash,
                candidates:publicLearningCandidates(row),selectedCandidateIds:[],expiresAt:row.expiresAt.toISOString(),applicationAvailable:false};
        });
    }
    receipt(row){
        const decision=checkedLearningJSON(row.decisionCanonical,row.decisionHash,65536);
        check(['APPROVED_PENDING_APPLICATION','REJECTED'].includes(row.status)&&decision.status===row.status
            &&decision.version==='atlas-trusted-learning-decision-v1'&&decision.purpose==='TRUSTED_LEARNING'
            &&['specimenId','approvalId','candidatesId','bundleHash','rawFindingsHash','analysisRevision','reviewRevision','evidenceHash','analysisHash',
                'reviewHash','sourceRevision','actorId','sessionHash','accessVersion','assignmentFence','controlRevision','operationId','inputHash'].every(k=>decision[k]===row[k])
            &&Array.isArray(decision.candidateIds)&&decision.candidateIds.length>0&&decision.candidateIds.every(id=>SHA.test(id))
            &&new Set(decision.candidateIds).size===decision.candidateIds.length&&typeof decision.reason==='string'
            &&date(row.createdAt)&&decision.createdAt===row.createdAt.toISOString(),'LEARNING_EVIDENCE_INVALID');
        return {decisionId:row.id,specimenId:row.specimenId,approvalId:row.approvalId,bundleHash:row.bundleHash,status:row.status,
            candidateIds:decision.candidateIds,reason:decision.reason,createdAt:row.createdAt.toISOString(),applicationAvailable:false};
    }
    read(staff,specimenId){return this.transaction(staff,specimenId,async c=>{
        const rows=await c.tx.staffTrustedLearningDecision.findMany({where:{specimenId},orderBy:[{createdAt:'desc'},{id:'desc'}],take:51});
        return {decisions:rows.slice(0,50).map(row=>this.receipt(row)),olderDecisionsAvailable:rows.length>50,applicationAvailable:false};
    });}
    decide(staff,specimenId,input){
        strictObject(input,['operationId','approvalId','candidatesId','bundleHash','candidateIds','decision','reason']);
        identifier(input.operationId);uuid(input.approvalId);uuid(input.candidatesId);sha(input.bundleHash);
        check(['APPROVE','REJECT'].includes(input.decision)&&Array.isArray(input.candidateIds)&&input.candidateIds.length>0&&input.candidateIds.length<=256
            &&input.candidateIds.every(id=>typeof id==='string'&&SHA.test(id))&&new Set(input.candidateIds).size===input.candidateIds.length
            &&typeof input.reason==='string'&&input.reason.trim().length>0&&input.reason.length<=1000&&!/[\x00-\x1f\x7f]/.test(input.reason),'LEARNING_REQUEST_INVALID',400);
        const inputHash=hash(canonical({specimenId,input}));
        return this.transaction(staff,specimenId,async c=>{
            const prior=await c.tx.staffTrustedLearningDecision.findUnique({where:{actorId_operationId:{actorId:c.identity.id,operationId:input.operationId}}});
            if(prior){check(prior.specimenId===specimenId&&prior.inputHash===inputHash,'LEARNING_REQUEST_CONFLICT');return this.receipt(prior);}
            this.available();
            const snapshot=await this.approved(c,specimenId,input.approvalId);
            const row=await this.candidates.inspect(c,{specimenId,approvalId:input.approvalId,candidatesId:input.candidatesId});
            this.match(row,snapshot);check(row.bundleHash===input.bundleHash,'LEARNING_CANDIDATES_CHANGED');
            const entries=validateLearningCandidates(row),ids=new Set(entries.map(v=>v.candidateId));
            check(input.candidateIds.every(id=>ids.has(id)),'LEARNING_CANDIDATES_CHANGED');
            const status=input.decision==='APPROVE'?'APPROVED_PENDING_APPLICATION':'REJECTED',id=randomUUID();
            const body={version:'atlas-trusted-learning-decision-v1',purpose:'TRUSTED_LEARNING',status,specimenId,approvalId:input.approvalId,
                candidatesId:row.id,bundleHash:row.bundleHash,rawFindingsHash:row.rawFindingsHash,candidateHash:row.candidateHash,
                generatorVersion:row.generatorVersion,fingerprintVersion:row.fingerprintVersion,gradingPolicyHash:row.gradingPolicyHash,
                bridgeConfigHash:row.bridgeConfigHash,sourceType:row.sourceType,sourceId:row.sourceId,sourceOwnerId:row.sourceOwnerId,
                sourceRevision:row.sourceRevision,analysisRevision:row.analysisRevision,reviewRevision:row.reviewRevision,
                evidenceHash:row.evidenceHash,analysisHash:row.analysisHash,reviewHash:row.reviewHash,candidateIds:[...input.candidateIds],reason:input.reason,
                actorId:c.identity.id,sessionHash:c.session.tokenHash,browserHash:c.session.browserHash,accessVersion:c.identity.accessVersion,
                assignmentFence:c.assignment.fence,controlRevision:c.control.revision,trustedLearningUntil:c.identity.trustedLearningUntil.toISOString(),
                operationId:input.operationId,inputHash,createdAt:c.now.toISOString()};
            const decisionCanonical=canonical(body);check(Buffer.byteLength(decisionCanonical)<=65536,'LEARNING_REQUEST_INVALID');
            const decision=await c.tx.staffTrustedLearningDecision.create({data:{id,specimenId,approvalId:input.approvalId,candidatesId:row.id,
                bundleHash:row.bundleHash,rawFindingsHash:row.rawFindingsHash,analysisRevision:row.analysisRevision,reviewRevision:row.reviewRevision,
                evidenceHash:row.evidenceHash,analysisHash:row.analysisHash,reviewHash:row.reviewHash,sourceRevision:row.sourceRevision,
                actorId:c.identity.id,sessionHash:c.session.tokenHash,accessVersion:c.identity.accessVersion,assignmentFence:c.assignment.fence,
                controlRevision:c.control.revision,operationId:input.operationId,inputHash,decisionCanonical,decisionHash:hash(decisionCanonical),status,createdAt:c.now}});
            await this.auth.audit(c.tx,'ATLAS_TRUSTED_LEARNING_DECIDED',specimenId,c.identity.id,{decisionId:id,decisionHash:decision.decisionHash,
                bundleHash:row.bundleHash,status,operationId:input.operationId,inputHash});
            // Fresh receipt/source lock readback after all writes, before commit.
            const finalRow=await this.candidates.inspect(c,{specimenId,approvalId:input.approvalId,candidatesId:row.id});
            check(finalRow.bundleHash===row.bundleHash,'LEARNING_CANDIDATES_CHANGED');return this.receipt(decision);
        });
    }
}
