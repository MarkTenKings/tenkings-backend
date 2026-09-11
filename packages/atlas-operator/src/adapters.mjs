import { canonical, requireBridge as check } from '@atlas/service-bridge/protocol';
import { parseOperatorImagePacket, operatorImageTransform, operatorCropRejection } from '@atlas/service-bridge/operator-images';
import { presentAtlasFindings } from '@atlas/grading-core/report';
import { sanitizeSpeedsterUnitQuad } from '@atlas/grading-core/geometry';
import { measureSpeedsterCenteringBorders, calculateCenteringBalance, calculateCenteringScore } from '@atlas/grading-core/scoring';
import { checked } from './policy.mjs';
import { CAPTURE_TOOL_NAMES, parseCaptureManifest, validateCaptureProposal, captureProposalRef, selectedCapturePreparation } from './capture-protocol.mjs';

const scope = (run,attemptId,callId) => ({runId:run.id,owner:run.leaseOwner,fence:run.leaseFence,revision:run.revision,attemptId,callId});
const cropRejection = ({call,manifest}) => call.name === 'inspect_region'
    ? operatorCropRejection({...call.args,purpose:'CROP'},manifest.assets.find(asset=>asset.assetId===call.args.assetId)) : null;
async function diagnosed(work, fallbackCode) {
    try { return await work(); }
    catch (error) {
        // Never put an arbitrary network, decoder or database error message in
        // the persisted run status. Retain known contract codes verbatim.
        const candidate=error?.code??error?.message;
        const code=typeof candidate==='string'&&/^ASTRA_[A-Z0-9_]{1,74}$/.test(candidate)?candidate:fallbackCode;
        throw Object.assign(new Error(code),{code});
    }
}
function imageRequests({call,run,manifest}) {
    if (call.name==='inspect_region') return [{...call.args,purpose:'CROP'}];
    if (!['read_card_report','read_original_photos'].includes(call.name)) return [null];
    return ['FRONT','BACK'].map(side=>{
        const asset=manifest.assets.find(a=>a.side===side&&a.view===(call.name==='read_original_photos'?'ORIGINAL':'RECTIFIED')); check(asset,'ASTRA_EVIDENCE_REQUIRED');
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
            signal?.throwIfAborted();
            const rejection=cropRejection(snapshot);
            if (rejection) return {claims,rejection};
            for (const request of imageRequests(snapshot)) {
                signal?.throwIfAborted();
                receipts.push({request,receipt:await evidenceClient.read(claims,request,{signal})});
            }
            return {claims,receipts};
        },
        async apply(data,prepared) {
            const {run,call,manifest,tx,attempt,now}=data;
            const claims=scope(run,attempt.id,call.callId), requests=imageRequests(data), rejection=cropRejection(data);
            check(canonical(prepared?.claims)===canonical(claims),'ASTRA_PREPARED_TOOL_CHANGED');
            if (rejection) check(prepared?.rejection && canonical(prepared.rejection)===canonical(rejection)
                && prepared.receipts===undefined,'ASTRA_PREPARED_TOOL_CHANGED');
            else check(prepared?.rejection===undefined && Array.isArray(prepared?.receipts)
                && prepared.receipts.length===requests.length,'ASTRA_PREPARED_TOOL_CHANGED');
            const images=rejection?[]:prepared.receipts.flatMap((entry,index)=>{
                check(canonical(entry.request)===canonical(requests[index]),'ASTRA_PREPARED_TOOL_CHANGED');
                const result=evidenceClient.verify(entry.receipt,claims,entry.request,run,+now);
                if (entry.request===null) {check(result.image===null,'ASTRA_TOOL_IMAGES_FORBIDDEN');return [];}
                const asset=manifest.assets.find(a=>a.assetId===entry.request.assetId);
                parseOperatorImagePacket(result.image,entry.request,asset); return [{packet:result.image,asset}];
            });
            if (run.phase === 'CAPTURE_REVIEW') {
                parseCaptureManifest(manifest); validateCaptureProposal(call,manifest,data.card);
                if (call.name === 'read_original_photos') return { result: { actor: 'MACHINE', phase: 'CAPTURE_REVIEW',
                    identity: manifest.identity, cornerShape: manifest.cornerShape, assets: manifest.assets,
                    status: 'ORIGINAL_PHOTOS_DELIVERED', preparation: 'NOT_STARTED' }, images };
                if (call.name === 'inspect_region') return { result: rejection??{ assetId: call.args.assetId, rect: call.args.rect }, images };
                if (['propose_capture_identity','propose_physical_boundary'].includes(call.name)) {
                    const references = call.name === 'propose_capture_identity' ? call.args.fields.flatMap(f => f.evidence) : call.args.evidence;
                    await evidenceDelivered(data,references);
                    return { result: { actor: 'MACHINE', status: 'PROPOSED_FOR_PREPARATION',
                        proposal: captureProposalRef(data.stepId,call) } };
                }
                check(call.name === 'submit_capture_preparation','ASTRA_CAPTURE_TOOL_INVALID');
                if (call.args.disposition !== 'READY_FOR_PREPARATION') return { result: { actor: 'MACHINE',
                    status: 'PREPARATION_ATTENTION_REQUIRED', disposition: call.args.disposition } };
                await evidenceDelivered(data,manifest.assets.map(a => ({ assetId:a.assetId,sha256:a.sha256,side:a.side })));
                return { result: await selectedCapturePreparation(data,evidenceDelivered) };
            }
            const analysis=await tx.staffAnalysisRevision.findUnique({where:{specimenId_revision:{specimenId:run.specimenId,revision:run.expectedAnalysisRevision}}});
            check(analysis?.sourceHash===manifest.sourceHash&&analysis.reportHash===manifest.reportHash,'ASTRA_REPORT_CHANGED');
            const report=checked(analysis.reportCanonical,analysis.reportHash);
            if (['inspect_card_geometry','measure_centering'].includes(call.name)) {
                const source=checked(analysis.sourceCanonical,analysis.sourceHash), side=source.capture?.[call.args.side.toLowerCase()];
                const centeringQuad=sanitizeSpeedsterUnitQuad(side?.centeringQuad);
                if (call.name==='inspect_card_geometry') return {result:{side:call.args.side,sourceHash:analysis.sourceHash,
                    reportHash:analysis.reportHash,corners:sanitizeSpeedsterUnitQuad(side?.corners),centeringQuad,
                    cornerShape:['SQUARE','ROUNDED'].includes(source.capture?.cornerShape)?source.capture.cornerShape:null,
                    status:centeringQuad?'RECORDED_GEOMETRY':'GEOMETRY_UNAVAILABLE'},images};
                check(centeringQuad,'ASTRA_CENTERING_EVIDENCE_REQUIRED');
                const borders=measureSpeedsterCenteringBorders(centeringQuad);
                return {result:{side:call.args.side,sourceHash:analysis.sourceHash,reportHash:analysis.reportHash,
                    ruleVersion:report.ruleVersion,centeringQuad,borders,
                    leftRightBalance:calculateCenteringBalance(borders.leftMm,borders.rightMm),
                    topBottomBalance:calculateCenteringBalance(borders.topMm,borders.bottomMm),
                    score:calculateCenteringScore(borders),basis:'SAVED_BOUNDARY_DETERMINISTIC_ATLAS'},images};
            }
            if (call.name==='inspect_finding') {
                const finding=report.findings.find(f=>f.id===call.args.findingId);
                check(finding,'ASTRA_FINDING_NOT_IN_REPORT');
                return {result:{reportHash:analysis.reportHash,analysisRevision:run.expectedAnalysisRevision,
                    finding:presentAtlasFindings([finding],'DRAFT')[0]},images};
            }
            if (call.name==='read_card_report') return {result:{reportHash:manifest.reportHash,analysisRevision:run.expectedAnalysisRevision,
                report:{version:report.version,ruleVersion:report.ruleVersion,cardProfile:report.cardProfile,identity:report.identity,
                    grade:report.grade,findings:presentAtlasFindings(report.findings,'DRAFT'),findingCounts:report.findingCounts},
                assets:manifest.assets, imageUse:'Evidence delivery does not establish visual understanding.'},images};
            if (call.name==='inspect_region') return {result:rejection??{assetId:call.args.assetId,rect:call.args.rect},images};
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
    const guarded={prepare:(...args)=>diagnosed(()=>adapter.prepare(...args),'ASTRA_TOOL_PREPARATION_FAILED'),
        apply:(...args)=>diagnosed(()=>adapter.apply(...args),'ASTRA_TOOL_APPLICATION_FAILED')};
    return Object.fromEntries([...new Set(['read_card_report','inspect_region','inspect_card_geometry','measure_centering','inspect_finding',
        'propose_identity','propose_finding_change','submit_for_human_review',...CAPTURE_TOOL_NAMES])].map(n=>[n,guarded]));
}
