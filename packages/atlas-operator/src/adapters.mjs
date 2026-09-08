import { canonical, requireBridge as check } from '@atlas/service-bridge/protocol';
import { parseOperatorImagePacket, operatorImageTransform } from '@atlas/service-bridge/operator-images';
import { presentAtlasFindings } from '@atlas/grading-core/report';
import { checked } from './policy.mjs';

const scope = (run,attemptId,callId) => ({runId:run.id,owner:run.leaseOwner,fence:run.leaseFence,revision:run.revision,attemptId,callId});
function imageRequests({call,run,manifest}) {
    if (call.name==='inspect_region') return [{...call.args,purpose:'CROP'}];
    if (call.name!=='read_card_report') return [null];
    return ['FRONT','BACK'].map(side=>{
        const asset=manifest.assets.find(a=>a.side===side&&a.view==='RECTIFIED'); check(asset,'ASTRA_EVIDENCE_REQUIRED');
        return {runId:run.id,expectedRevision:run.revision,evidenceHash:run.evidenceHash,manifestHash:run.manifestHash,
            assetId:asset.assetId,sourceSha256:asset.sha256,side,purpose:'OVERVIEW',rect:{x:0,y:0,width:asset.width,height:asset.height}};
    });
}
async function evidenceDelivered(data, references) {
    const rows=await data.tx.staffOperatorImageDelivery.findMany({where:{attemptId:data.attempt.id}});
    const images=await data.tx.staffOperatorImage.findMany({where:{runId:data.run.id,imageId:{in:rows.map(r=>r.imageId)}}});
    for (const ref of references) {
        const asset=data.manifest.assets.find(a=>a.assetId===ref.assetId);
        check(asset && asset.sha256===ref.sha256 && asset.side===ref.side,'ASTRA_PROPOSAL_EVIDENCE_INVALID');
        check(images.some(i=>{const p=checked(i.canonical,i.hash);return p.asset.assetId===asset.assetId&&p.asset.sha256===asset.sha256;}),
            'ASTRA_PROPOSAL_IMAGE_NOT_DELIVERED');
    }
}

/** Concrete proposals retain machine hypotheses; this module never edits the
 * source report or calls grading, certification, learning, or publication. */
export function operatorAdapters({evidenceClient}) {
    check(evidenceClient&&typeof evidenceClient.read==='function'&&typeof evidenceClient.verify==='function','ASTRA_ADAPTER_CONFIGURATION_REQUIRED');
    const adapter={
        async prepare(snapshot,{signal}) {
            const claims=scope(snapshot.run,snapshot.attemptId,snapshot.call.callId), receipts=[];
            for (const request of imageRequests(snapshot)) {
                signal?.throwIfAborted();
                receipts.push({request,receipt:await evidenceClient.read(claims,request,{signal})});
            }
            return {claims,receipts};
        },
        async apply(data,prepared) {
            const {run,call,manifest,tx,attempt,now}=data;
            const claims=scope(run,attempt.id,call.callId), requests=imageRequests(data);
            check(canonical(prepared?.claims)===canonical(claims)&&prepared.receipts.length===requests.length,'ASTRA_PREPARED_TOOL_CHANGED');
            const images=prepared.receipts.flatMap((entry,index)=>{
                check(canonical(entry.request)===canonical(requests[index]),'ASTRA_PREPARED_TOOL_CHANGED');
                const result=evidenceClient.verify(entry.receipt,claims,entry.request,run,+now);
                if (entry.request===null) {check(result.image===null,'ASTRA_TOOL_IMAGES_FORBIDDEN');return [];}
                const asset=manifest.assets.find(a=>a.assetId===entry.request.assetId);
                parseOperatorImagePacket(result.image,entry.request,asset); return [{packet:result.image,asset}];
            });
            const analysis=await tx.staffAnalysisRevision.findUnique({where:{specimenId_revision:{specimenId:run.specimenId,revision:run.expectedAnalysisRevision}}});
            check(analysis?.sourceHash===manifest.sourceHash&&analysis.reportHash===manifest.reportHash,'ASTRA_REPORT_CHANGED');
            const report=checked(analysis.reportCanonical,analysis.reportHash);
            if (call.name==='read_card_report') return {result:{reportHash:manifest.reportHash,analysisRevision:run.expectedAnalysisRevision,
                report:{version:report.version,ruleVersion:report.ruleVersion,cardProfile:report.cardProfile,identity:report.identity,
                    grade:report.grade,findings:presentAtlasFindings(report.findings,'DRAFT'),findingCounts:report.findingCounts},
                assets:manifest.assets, imageUse:'Evidence delivery does not establish visual understanding.'},images};
            if (call.name==='inspect_region') return {result:{assetId:call.args.assetId,rect:call.args.rect},images};
            if (call.name==='propose_identity') {
                const allowed=report.cardProfile==='POKEMON'?['cardName','year','productSet','parallel','cardNumber','layoutType']
                    :['playerName','year','manufacturer','productSet','parallel','insert','cardNumber'];
                for (const field of call.args.fields) {
                    check(allowed.includes(field.field),'ASTRA_IDENTITY_CATEGORY_CHANGED');
                    if (field.field==='layoutType') check(field.value===null||['POKEMON','TRAINER','ENERGY'].includes(field.value),'ASTRA_LAYOUT_INVALID');
                    await evidenceDelivered(data,field.evidence);
                }
                return {result:{status:'PROPOSED_FOR_HUMAN_REVIEW',fields:call.args.fields.map(f=>f.field)}};
            }
            if (call.name==='propose_finding_change') {
                const args=call.args;
                await evidenceDelivered(data,args.evidence);
                if (args.action==='INSPECT_MISSED_REGION') {
                    check(new Set(args.evidence.map(e=>e.assetId)).size===1,'ASTRA_MISSED_REGION_AMBIGUOUS');
                    const ref=args.evidence[0], asset=manifest.assets.find(a=>a.assetId===ref.assetId);
                    operatorImageTransform({runId:run.id,expectedRevision:run.revision,evidenceHash:run.evidenceHash,manifestHash:run.manifestHash,
                        assetId:asset.assetId,sourceSha256:asset.sha256,side:asset.side,purpose:'CROP',rect:args.rect},asset,1);
                } else {
                    const finding=report.findings.find(f=>f.id===args.findingId);
                    check(finding&&args.evidence.every(e=>e.side===finding.side),'ASTRA_FINDING_NOT_IN_REPORT');
                }
                return {result:{status:'PROPOSED_FOR_HUMAN_REVIEW',findingId:args.findingId,action:args.action}};
            }
            check(call.name==='submit_for_human_review'&&call.args.reportHash===manifest.reportHash,'ASTRA_REPORT_CHANGED');
            const refs=manifest.assets.filter(a=>a.view==='RECTIFIED').map(a=>({assetId:a.assetId,sha256:a.sha256,side:a.side}));
            // Missing/failed evidence may go to recapture/expert; ordinary ready
            // submission requires the actual request roster for both sides.
            if (call.args.disposition==='READY_FOR_REVIEW') await evidenceDelivered(data,refs);
            return {result:{status:'HANDED_TO_HUMAN',reportHash:manifest.reportHash}};
        },
    };
    return Object.fromEntries(['read_card_report','inspect_region','propose_identity','propose_finding_change','submit_for_human_review'].map(n=>[n,adapter]));
}
