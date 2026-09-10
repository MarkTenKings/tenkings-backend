import { randomUUID } from 'node:crypto';
import { deny, hash, identifier, strictObject } from '../policy.mjs';
import { canonical } from '../review-contract.mjs';

export async function proposalsView(tx,card) {
    const rows=await tx.$queryRaw`SELECT * FROM atlas_staff.read_operator_proposals(${card.id}::uuid)`;
    const decisions=await tx.staffProposalDecision.findMany({where:{specimenId:card.id,analysisRevision:card.analysisRevision}});
    return rows.filter(p=>p.evidenceHash===card.evidenceHash).map(p=>({stepId:p.stepId,runId:p.runId,
        analysisRevision:p.analysisRevision,toolName:p.toolName,proposal:JSON.parse(p.request),
        decision:decisions.find(d=>d.stepId===p.stepId)?.decision??null,
        reason:decisions.find(d=>d.stepId===p.stepId)?.reason??null,createdAt:p.createdAt.toISOString()}));
}
export class StaffProposals {
    constructor({auth,review}) {this.auth=auth;this.review=review;}
    async decide(staff,cardId,input) {
        strictObject(input,['operationId','stepId','analysisRevision','analysisHash','evidenceHash','decision','reason']);
        identifier(input.operationId);identifier(input.stepId);
        if (!Number.isSafeInteger(input.analysisRevision)||input.analysisRevision<=0
            ||![input.analysisHash,input.evidenceHash].every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v))
            ||!['ACCEPTED','REJECTED','INSPECTED'].includes(input.decision)||typeof input.reason!=='string'
            ||!input.reason.trim()||input.reason.length>1000) deny(400,'INVALID_REQUEST');
        return this.auth.withStaff(staff,async context=>{
            const {tx,identity,session,now,control}=context, assignment=await this.review.assigned(context,cardId);
            const [card]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffSpecimen" WHERE id=${cardId}::uuid FOR UPDATE`;
            if (!card||identity.role!=='REVIEWER'||!assignment.canReview) deny(403,'REVIEW_ACCESS_REQUIRED');
            const inputHash=hash(canonical({cardId,input}));
            const prior=await tx.staffProposalDecision.findUnique({where:{actorId_operationId:{actorId:identity.id,operationId:input.operationId}}});
            if (prior) { if(prior.inputHash!==inputHash) deny(409,'REQUEST_CONFLICT');return {card:await this.review.view(context,card,assignment)}; }
            if (card.analysisRevision!==input.analysisRevision||card.evidenceHash!==input.evidenceHash) deny(409,'DRAFT_CHANGED');
            const analysis=await tx.staffAnalysisRevision.findUnique({where:{specimenId_revision:{specimenId:cardId,revision:card.analysisRevision}}});
            if (!analysis||analysis.sourceHash!==input.analysisHash||hash(analysis.reportCanonical)!==analysis.reportHash) deny(409,'DRAFT_CHANGED');
            const proposal=(await proposalsView(tx,card)).find(p=>p.stepId===input.stepId);
            if (!proposal||proposal.decision) deny(409,'PROPOSAL_ALREADY_RESOLVED');
            const p=proposal.proposal,report=JSON.parse(analysis.reportCanonical);
            if (input.decision==='INSPECTED'&&p.action!=='INSPECT_MISSED_REGION') deny(400,'INVALID_REQUEST');
            if (input.decision==='ACCEPTED') {
                const finding=report.findings.find(f=>f.id===p.findingId);
                const matches=proposal.toolName==='propose_identity'?p.fields.every(f=>canonical(report.identity[f.field]??null)===canonical(f.value))
                    :p.action==='REMOVE'?finding?.reviewResult==='REMOVED'
                    :p.action==='RETAIN'?finding&&finding.reviewResult!=='REMOVED'
                    :p.action==='RETYPE'?finding&&finding.reviewResult!=='REMOVED'&&finding.defectType===p.defectType:false;
                if (!matches) deny(409,'SAVE_PROPOSED_CORRECTION_FIRST');
            }
            await tx.staffProposalDecision.create({data:{id:randomUUID(),specimenId:cardId,stepId:input.stepId,analysisRevision:card.analysisRevision,
                analysisHash:analysis.sourceHash,evidenceHash:card.evidenceHash,decision:input.decision,reason:input.reason.trim(),actorId:identity.id,
                sessionHash:session.tokenHash,accessVersion:identity.accessVersion,assignmentFence:assignment.fence,controlRevision:control.revision,
                operationId:input.operationId,inputHash,createdAt:now}});
            await this.auth.audit(tx,'ASTRA_PROPOSAL_REVIEWED',cardId,identity.id,{stepId:input.stepId,analysisRevision:card.analysisRevision,decision:input.decision});
            return {card:await this.review.view(context,card,assignment)};
        });
    }
}
