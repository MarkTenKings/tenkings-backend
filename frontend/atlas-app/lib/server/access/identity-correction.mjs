import { DurableStaffAuth } from './auth.mjs';
import { canonicalizeSpeedsterSessionIdentity } from '@atlas/grading-core/identity';
import { identityCorrectionRequestCanonical, validateIdentityCorrectionRequest } from '@atlas/service-bridge/identity-correction';
import { canonical } from '../review-contract.mjs';
import { deny, hash, strictObject } from '../policy.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,SHA=/^[a-f0-9]{64}$/;
const date=v=>v instanceof Date&&Number.isFinite(+v),positive=v=>Number.isSafeInteger(v)&&v>0&&v<=2147483647;
const check=(value,code='IDENTITY_REQUEST_INVALID',status=409)=>{if(!value)deny(status,code);};
const uuid=value=>check(typeof value==='string'&&UUID.test(value),'IDENTITY_REQUEST_INVALID',400);
const bindings=['actorId','sessionHash','browserHash','accessVersion','controlRevision','staffOrigin','deploymentId','releaseSha','staffConfigHash','specimenId','assignmentFence'];
function checked(body,digest,limit){
    check(typeof body==='string'&&Buffer.byteLength(body)<=limit&&SHA.test(digest??'')&&hash(body)===digest,'IDENTITY_EVIDENCE_INVALID');
    let value;try{value=JSON.parse(body);}catch{check(false,'IDENTITY_EVIDENCE_INVALID');}
    check(canonical(value)===body,'IDENTITY_EVIDENCE_INVALID');return value;
}
function scope(c,specimenId){return{actorId:c.identity.id,sessionHash:c.session.tokenHash,browserHash:c.session.browserHash,accessVersion:c.identity.accessVersion,
    controlRevision:c.control.revision,staffOrigin:c.control.origin,deploymentId:c.control.deploymentId,releaseSha:c.control.releaseSha,
    staffConfigHash:c.control.configHash,specimenId,assignmentFence:c.assignment.fence};}

/** Serving role only: projected immutable receipt definer, never raw receipt,
 * source or correction-control table access. Configuration is resolved lazily
 * after fresh authorized replay so disabled/rotated bridges remain recoverable. */
export class StaffIdentityCorrection{
    constructor({auth,review,bridge=()=>null}){
        check(auth instanceof DurableStaffAuth&&typeof review?.assigned==='function'&&typeof bridge==='function','IDENTITY_NOT_CONFIGURED',503);
        this.auth=auth;this.review=review;this.bridge=bridge;
    }
    current(c){
        const{identity:i,session:s,assignment:a,control,now}=c;
        check(date(now)&&control?.enabled&&i?.role==='REVIEWER'&&!i.revokedAt&&positive(i.accessVersion)
            &&s?.identityId===i.id&&!s.revokedAt&&s.accessVersion===i.accessVersion&&s.controlRevision===control.revision
            &&date(s.createdAt)&&s.createdAt<=now&&+now-+s.createdAt<=300_000&&date(s.expiresAt)&&s.expiresAt>now
            &&SHA.test(s.tokenHash??'')&&SHA.test(s.browserHash??'')&&s.browser?.tokenHash===s.browserHash&&s.browser.controlRevision===control.revision
            &&date(s.browser.createdAt)&&s.browser.createdAt<=s.createdAt&&date(s.browser.expiresAt)&&s.browser.expiresAt>now
            &&a?.identityId===i.id&&a.canReview&&!a.revokedAt&&positive(a.fence)&&date(a.expiresAt)&&a.expiresAt>now,
        'FRESH_IDENTITY_REVIEWER_REQUIRED',403);
    }
    transaction(staff,specimenId,work,expectedScope=null){
        uuid(specimenId);const handle=this.auth.actors.get(staff);check(handle,'SIGN_IN_REQUIRED',401);
        return this.auth.withStaff(staff,async c=>{
            const assignment=await this.review.assigned(c,specimenId),context={...c,assignment};this.current(context);
            check(assignment.specimenId===specimenId,'IDENTITY_ASSIGNMENT_CHANGED',403);
            const initial=scope(context,specimenId);
            if(expectedScope)check(bindings.every(k=>initial[k]===expectedScope[k]),'IDENTITY_ACCESS_CHANGED',403);
            const result=await work(context);
            const[{now}]=await c.tx.$queryRaw`SELECT clock_timestamp() AS now`;
            const latest=await this.auth.current({...c,now},handle.sessionHash,handle.browserHash);
            check(latest&&latest.identity.accessVersion===c.identity.accessVersion,'FRESH_IDENTITY_REVIEWER_REQUIRED',403);
            const finalAssignment=await this.review.assigned({...c,...latest,now},specimenId),final={...c,...latest,assignment:finalAssignment,now};
            this.current(final);check(finalAssignment.specimenId===specimenId&&bindings.every(k=>scope(final,specimenId)[k]===initial[k]),'IDENTITY_ACCESS_CHANGED',403);
            await c.tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;return result;
        });
    }
    async receipt(c,specimenId,request,inputHash){
        let rows;
        try{rows=await c.tx.$queryRaw`SELECT * FROM atlas_staff.read_identity_correction_receipt(${specimenId}::uuid,${c.identity.id}::uuid,${request.operationId}::uuid,${inputHash},
            ${c.session.tokenHash},${c.session.browserHash},${c.identity.accessVersion}::integer,${c.assignment.fence}::integer,${c.control.revision}::integer)`;}
        catch(error){const message=String(error?.meta?.message??error?.message??'');
            if(message.includes('ATLAS correction receipt request conflict'))deny(409,'IDENTITY_REQUEST_CONFLICT');
            if(message.includes('ATLAS correction receipt requires fresh assigned human access'))deny(403,'FRESH_IDENTITY_REVIEWER_REQUIRED');throw error;}
        check(Array.isArray(rows)&&rows.length<=1,'IDENTITY_RECEIPT_INVALID',503);if(!rows.length)return null;
        const row=rows[0];
        check(UUID.test(row.receiptId??'')&&row.operationId===request.operationId
            &&row.analysisRevision===request.expectedAnalysisRevision+1&&row.reviewRevision===request.expectedReviewRevision+1
            &&row.evidenceRevision===request.expectedEvidenceRevision+1
            &&['evidenceHash','sourceHash','reviewHash'].every(k=>SHA.test(row[k]??''))&&date(row.createdAt)&&row.createdAt<=c.now,'IDENTITY_RECEIPT_INVALID',503);
        return{status:'CORRECTED',receiptId:row.receiptId,operationId:row.operationId,analysisRevision:row.analysisRevision,reviewRevision:row.reviewRevision,
            evidenceRevision:row.evidenceRevision,evidenceHash:row.evidenceHash,sourceHash:row.sourceHash,reviewHash:row.reviewHash,createdAt:row.createdAt.toISOString()};
    }
    async heads(c,specimenId,input){
        const[card]=await c.tx.$queryRaw`SELECT * FROM atlas_staff."StaffSpecimen" WHERE id=${specimenId}::uuid FOR SHARE`;
        check(card?.id===specimenId&&card.analysisRevision===input.expectedAnalysisRevision&&card.draftRevision===input.expectedReviewRevision
            &&card.evidenceRevision===input.expectedEvidenceRevision&&card.evidenceHash===input.evidenceHash
            &&card.sourceType===(c.control.mode==='PRODUCTION'?'SPEEDSTER':'LOCAL_FIXTURE'),'IDENTITY_HEAD_CHANGED');
        const analysis=await c.tx.staffAnalysisRevision.findUnique({where:{specimenId_revision:{specimenId,revision:card.analysisRevision}}}),
            review=await c.tx.staffReviewRevision.findUnique({where:{specimenId_revision:{specimenId,revision:card.draftRevision}}});
        check(analysis?.sourceHash===input.analysisHash&&analysis.sourceRevision===input.sourceRevision&&analysis.evidenceHash===input.evidenceHash
            &&analysis.mode===c.control.mode&&review?.contentHash===input.reviewHash&&review.evidenceHash===input.evidenceHash
            &&review.evidenceRevision===input.expectedEvidenceRevision&&review.analysisRevision===input.expectedAnalysisRevision,'IDENTITY_HEAD_CHANGED');
        const source=checked(analysis.sourceCanonical,analysis.sourceHash,2*1024*1024),evidence=checked(card.evidenceCanonical,card.evidenceHash,131072),
            draft=checked(review.canonical,review.contentHash,65536),admission=checked(analysis.admissionCanonical,analysis.admissionHash,8192);
        checked(analysis.reportCanonical,analysis.reportHash,2*1024*1024);
        check(admission.purpose==='atlas-analysis-admission-v1'&&admission.sourceHash===analysis.sourceHash&&admission.evidenceHash===card.evidenceHash
            &&admission.mode===c.control.mode&&admission.policyHash===c.control.gradingPolicyHash
            &&evidence.sourceId===card.sourceId&&evidence.sourceOwnerId===card.sourceOwnerId&&typeof evidence.sourceRevision==='string'
            &&draft.revision===card.draftRevision&&draft.evidenceRevision===card.evidenceRevision&&draft.evidenceHash===card.evidenceHash
            &&['SPORTS','POKEMON'].includes(source.cardProfile),'IDENTITY_EVIDENCE_INVALID');
        return{card,analysis,source};
    }
    advisory(wire,input,source){
        try{strictObject(wire,['status','reasons','changedFields','identity']);}catch{deny(503,'IDENTITY_RESPONSE_INVALID');}
        const reasons=['CATEGORY_CHANGED','LAYOUT_CHANGED','EXACT_MAP_KEY_CHANGED','FAMILY_MAP_KEY_CHANGED'],fields=['cardProfile','playerName','cardName','year','manufacturer','productSet','parallel','insert','cardNumber','layoutType'];
        let identity;try{identity=canonicalizeSpeedsterSessionIdentity(input.next.cardProfile,wire.identity);}catch{deny(503,'IDENTITY_RESPONSE_INVALID');}
        check(['NO_CHANGE','REPROCESS_REQUIRED'].includes(wire.status)&&Array.isArray(wire.reasons)&&wire.reasons.length<=4
            &&wire.reasons.every(v=>reasons.includes(v))&&new Set(wire.reasons).size===wire.reasons.length
            &&(wire.status==='NO_CHANGE'?wire.reasons.length===0:wire.reasons.length>0)
            &&Array.isArray(wire.changedFields)&&wire.changedFields.length<=fields.length&&wire.changedFields.every(v=>fields.includes(v))
            &&new Set(wire.changedFields).size===wire.changedFields.length
            &&canonical(identity)===canonical(wire.identity)&&canonical(identity)===canonical(canonicalizeSpeedsterSessionIdentity(input.next.cardProfile,input.next.identity)),
        'IDENTITY_RESPONSE_INVALID',503);
        if(wire.status==='NO_CHANGE')check(!wire.changedFields.length&&source.cardProfile===input.next.cardProfile
            &&canonical(source.identity)===canonical(identity),'IDENTITY_RESPONSE_INVALID',503);
        return{status:wire.status,advisory:true,reasons:[...wire.reasons],changedFields:[...wire.changedFields],identity};
    }
    async correct(staff,specimenId,input){
        uuid(specimenId);let request,requestCanonical;
        try{request=structuredClone(input);validateIdentityCorrectionRequest(request);canonicalizeSpeedsterSessionIdentity(request.next.cardProfile,request.next.identity);
            check(Number.isFinite(Date.parse(request.sourceRevision))&&new Date(request.sourceRevision).toISOString()===request.sourceRevision,'IDENTITY_REQUEST_INVALID',400);
            requestCanonical=identityCorrectionRequestCanonical(specimenId,request);check(Buffer.byteLength(requestCanonical)<=8192,'IDENTITY_REQUEST_INVALID',400);
        }catch{deny(400,'IDENTITY_REQUEST_INVALID');}
        const inputHash=hash(requestCanonical);
        const claimed=await this.transaction(staff,specimenId,async c=>{
            const retained=await this.receipt(c,specimenId,request,inputHash);if(retained)return{retained};
            await this.heads(c,specimenId,request);return{scope:scope(c,specimenId),policyHash:c.control.gradingPolicyHash};
        });
        if(claimed.retained)return claimed.retained;
        let bridge;try{bridge=await this.bridge();}catch{deny(503,'IDENTITY_NOT_CONFIGURED');}
        check(typeof bridge?.call==='function'&&SHA.test(bridge.binding?.bridgeConfigHash??'')&&bridge.binding.gradingPolicyHash===claimed.policyHash,'IDENTITY_NOT_CONFIGURED',503);
        // External work never runs inside a staff transaction. The private core
        // independently rechecks current source/map/preparation and human scope.
        let wire,error;try{wire=await bridge.call(structuredClone(claimed.scope),structuredClone(request));}catch(caught){error=caught;}
        return this.transaction(staff,specimenId,async c=>{
            const retained=await this.receipt(c,specimenId,request,inputHash);
            if(retained){
                if(!error&&wire?.status==='CORRECTED')check(canonical(wire)===canonical(retained),'IDENTITY_RESPONSE_INVALID',503);
                return retained;
            }
            if(error||wire?.status==='CORRECTED')deny(503,'IDENTITY_OUTCOME_UNCONFIRMED');
            const heads=await this.heads(c,specimenId,request);return this.advisory(wire,request,heads.source);
        },claimed.scope);
    }
}
