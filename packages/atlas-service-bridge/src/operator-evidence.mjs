import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { bridgeOrigin, canonical, digest, keys, requireBridge as check, SHA, UUID } from './protocol.mjs';
import { boundedBytes } from './transport.mjs';
import { parseOperatorImagePacket } from './operator-images.mjs';

export const OPERATOR_EVIDENCE_PATH = '/api/internal/atlas/operator-evidence';
export const MAX_OPERATOR_EVIDENCE_RESPONSE_BYTES = 4_400_000;
const purpose = 'atlas-operator-evidence-v1';
const uuid = v => typeof v === 'string' && UUID.test(v);
const sha = v => typeof v === 'string' && SHA.test(v);
const checked = (text,hash) => { check(typeof text === 'string' && digest(text)===hash,'ASTRA_STORED_EVIDENCE_INVALID');
    const value=JSON.parse(text); check(canonical(value)===text,'ASTRA_STORED_EVIDENCE_INVALID'); return value; };
const mac = (key,text) => createHmac('sha256',key).update(text).digest('hex');
function signature(key,text,value) { check(Buffer.isBuffer(key) && key.length===32 && sha(value)
    && timingSafeEqual(Buffer.from(mac(key,text),'hex'),Buffer.from(value,'hex')),'ASTRA_EVIDENCE_AUTHENTICATION_REQUIRED'); }
export function signOperatorEvidenceRequest(config, scope, request = null, now=Date.now()) {
    const claims={ purpose, audience: bridgeOrigin(config.origin), runtimeHash:config.runtimeHash, scope, request,
        issuedAt:now, expiresAt:now+30_000, nonce:randomUUID() }, body=canonical(claims);
    const signed={body,signature:mac(config.key,body)};
    verifyOperatorEvidenceRequest(config,body,signed.signature,now); return signed;
}
export function verifyOperatorEvidenceRequest(config,body,signed,now=Date.now()) {
    check(typeof body==='string' && Buffer.byteLength(body)<=8192); signature(config.key,body,signed);
    const c=JSON.parse(body); keys(c,['purpose','audience','runtimeHash','scope','request','issuedAt','expiresAt','nonce']);
    keys(c.scope,['runId','owner','fence','revision','attemptId','callId']);
    check(canonical(c)===body && c.purpose===purpose && c.audience===config.origin && sha(c.runtimeHash)
        && ['runId','owner','attemptId'].every(k=>uuid(c.scope[k])) && [c.scope.fence,c.scope.revision].every(v=>Number.isSafeInteger(v)&&v>0)
        && typeof c.scope.callId==='string' && /^[A-Za-z0-9_-]{1,160}$/.test(c.scope.callId)
        && Number.isSafeInteger(c.issuedAt) && Number.isSafeInteger(c.expiresAt) && c.issuedAt<=now && c.expiresAt>now
        && c.expiresAt-c.issuedAt<=30_000 && uuid(c.nonce)); return c;
}
export function operatorEvidenceClient(config,fetchImpl=fetch) {
    bridgeOrigin(config.origin);
    return { async read(scope,request,{signal}={}) {
        signal?.throwIfAborted(); const signed=signOperatorEvidenceRequest(config,scope,request);
        const response=await fetchImpl(`${config.origin}${OPERATOR_EVIDENCE_PATH}`,{method:'POST',redirect:'error',cache:'no-store',
            headers:{'content-type':'application/json','x-atlas-operator-evidence-signature':signed.signature},body:signed.body,
            signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30_000)]):AbortSignal.timeout(30_000)});
        check(response.status===200 && response.headers.get('content-type')?.split(';')[0]==='application/json','ASTRA_EVIDENCE_UNAVAILABLE');
        const text=(await boundedBytes(response,MAX_OPERATOR_EVIDENCE_RESPONSE_BYTES)).toString('utf8'); signature(config.key,text,response.headers.get('x-atlas-operator-evidence-signature'));
        const value=JSON.parse(text);
        check(canonical(value)===text && value.requestHash===digest(signed.body),'ASTRA_EVIDENCE_RESPONSE_CHANGED');
        return { value, signature:mac(config.key,text) };
    }, verify(receipt,scope,request,run,now=Date.now()) {
        signature(config.key,canonical(receipt.value),receipt.signature); const v=receipt.value;
        check(v.purpose==='atlas-operator-evidence-receipt-v1' && v.runtimeHash===config.runtimeHash && v.runtimeHash===run.runtimeHash
            && canonical(v.scope)===canonical(scope) && canonical(v.request)===canonical(request) && v.expiresAt>now
            && v.evidenceHash===run.evidenceHash && v.manifestHash===run.manifestHash
            && v.sourceHash===JSON.parse(run.manifestCanonical).sourceHash,'ASTRA_EVIDENCE_RECEIPT_STALE'); return v;
    } };
}

/** Private admitted read path. Caller supplies an asset ID/rectangle only;
 * storage identity comes from the current preserved original source. */
export class OperatorEvidenceBridge {
    constructor({client,config,ports}) { this.client=client; this.config=config; this.ports=ports; }
    async authorize(claims) {
        check(claims.expiresAt>Date.now(),'ASTRA_EVIDENCE_REQUEST_EXPIRED');
        return this.client.$transaction(async tx=>{
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0))`;
            const [control]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffOperatorImageControl" WHERE id='active' FOR SHARE`;
            const [operator]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffOperatorControl" WHERE id='active' FOR SHARE`;
            const [bridge]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffGradingBridgeControl" WHERE id='active' FOR SHARE`;
            const [staff]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffControl" WHERE id='active' FOR SHARE`;
            const [{now}]=await tx.$queryRaw`SELECT clock_timestamp() AS now`;
            check(control?.enabled && ['mode','origin','deploymentId','releaseSha','configHash','clientKeyHash'].every(k=>control[k]===this.config[k])
                && operator?.enabled && bridge?.enabled && staff?.enabled && operator.configHash===claims.runtimeHash
                && [operator,bridge,staff].every(c=>c.mode===control.mode)
                && bridge.gradingPolicyHash===this.config.gradingPolicyHash && staff.gradingPolicyHash===bridge.gradingPolicyHash,'ASTRA_EVIDENCE_NOT_ENABLED');
            const [run]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffOperatorRun" WHERE id=${claims.scope.runId}::uuid FOR SHARE`;
            check(run?.state==='WAITING_TOOL' && run.runtimeHash===operator.configHash && run.policyHash===operator.policyHash
                && run.gradingPolicyHash===bridge.gradingPolicyHash && run.leaseOwner===claims.scope.owner && run.leaseFence===claims.scope.fence
                && run.revision===claims.scope.revision && run.leaseMode==='WORK' && +run.leaseExpiresAt>+now && +run.deadlineAt>+now,'ASTRA_LEASE_STALE');
            const policy=checked(operator.policyCanonical,operator.policyHash), budget=checked(bridge.policyCanonical,bridge.policyHash);
            check(policy.pilotId===run.pilotId && budget.pilotId===run.pilotId && budget.specimenIds.includes(run.specimenId)
                && +new Date(policy.expiresAt)>+now && +new Date(budget.expiresAt)>+now,'ASTRA_PILOT_NOT_ACTIVE');
            const [card]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffSpecimen" WHERE id=${run.specimenId}::uuid FOR SHARE`;
            const [analysis]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffAnalysisRevision" WHERE "specimenId"=${card.id}::uuid AND revision=${run.expectedAnalysisRevision}`;
            check(card.evidenceHash===run.evidenceHash && card.analysisRevision===run.expectedAnalysisRevision
                && card.draftRevision===run.expectedReviewRevision && card.sourceType===(control.mode==='PRODUCTION'?'SPEEDSTER':'LOCAL_FIXTURE'),'ASTRA_EVIDENCE_CHANGED');
            const manifest=checked(run.manifestCanonical,run.manifestHash), evidence=checked(card.evidenceCanonical,card.evidenceHash);
            check(analysis?.sourceHash===manifest.sourceHash && analysis.reportHash===manifest.reportHash,'ASTRA_REPORT_CHANGED');
            const [attempt]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffOperatorAttempt" WHERE id=${claims.scope.attemptId}::uuid`;
            check(attempt?.runId===run.id && attempt.state==='RECEIVED' && attempt.runRevision===run.revision
                && attempt.leaseFence===run.leaseFence && attempt.usageCeilingMicroUsd!==null && !attempt.usageEnvelopeExceeded,'ASTRA_TOOL_NOT_READY');
            const [receipt]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffOperatorReceipt" WHERE id=${attempt.resultReceiptId}::uuid`;
            const body=checked(receipt.canonical,receipt.hash).body, calls=body?.output?.filter(c=>c.type==='function_call');
            check(body?.model==='gpt-6-astra' && body.status==='completed' && body.service_tier==='default' && calls?.length===1
                && calls[0].call_id===claims.scope.callId && policy.tools.includes(calls[0].name),'ASTRA_TOOL_NOT_READY');
            const call=calls[0], args=JSON.parse(call.arguments);
            check(args.runId===run.id && args.expectedRevision===run.revision && args.manifestHash===run.manifestHash
                && args.evidenceHash===run.evidenceHash,'ASTRA_TOOL_SCOPE_CHANGED');
            const source=await this.ports.loadSource(tx,card);
            check(source.updatedAt.toISOString()===analysis.sourceRevision
                && canonical(this.ports.sourceEvidence(source,evidence.sourceRevision))===card.evidenceCanonical
                && digest(canonical(this.ports.reportSource(source)))===manifest.sourceHash,'ASTRA_SOURCE_CHANGED');
            this.ports.assertSourceAdmission(source);
            let asset=null, descriptor=null;
            if (claims.request!==null) {
                const req=claims.request; asset=manifest.assets.find(a=>a.assetId===req.assetId);
                check(asset && req.runId===run.id && req.expectedRevision===run.revision && req.evidenceHash===run.evidenceHash
                    && req.manifestHash===run.manifestHash && req.sourceSha256===asset.sha256 && req.side===asset.side,'ASTRA_IMAGE_NOT_IN_MANIFEST');
                if (call.name==='inspect_region') check(canonical({...args,purpose:'CROP'})===canonical(req),'ASTRA_IMAGE_TOOL_SCOPE_CHANGED');
                else check(call.name==='read_card_report' && req.purpose==='OVERVIEW' && asset.view==='RECTIFIED','ASTRA_IMAGE_TOOL_SCOPE_CHANGED');
                descriptor=(asset.view==='RECTIFIED'?evidence.sides:evidence.originals)?.[asset.side];
                check(descriptor && ['sha256','byteCount','width','height','contentType'].every(k=>descriptor[k]===asset[k]),'ASTRA_EVIDENCE_CHANGED');
            }
            return {asset,descriptor,sourceHash:manifest.sourceHash,evidenceHash:run.evidenceHash,manifestHash:run.manifestHash};
        },{maxWait:5000,timeout:10_000});
    }
    async read(claims) {
        const first=await this.authorize(claims); let image=null;
        if (first.asset) {
            const signal=AbortSignal.timeout(Math.max(1,claims.expiresAt-Date.now()));
            const bytes=await this.ports.readEvidence(first.descriptor,signal);
            image=await this.ports.render({sourceBytes:bytes,asset:first.asset,request:claims.request,signal});
            parseOperatorImagePacket(image,claims.request,first.asset);
        }
        check(canonical(await this.authorize(claims))===canonical(first),'ASTRA_SOURCE_CHANGED');
        const value={purpose:'atlas-operator-evidence-receipt-v1',runtimeHash:claims.runtimeHash,scope:claims.scope,request:claims.request,
            requestHash:digest(canonical(claims)),expiresAt:claims.expiresAt,sourceHash:first.sourceHash,
            evidenceHash:first.evidenceHash,manifestHash:first.manifestHash,image};
        const text=canonical(value); check(Buffer.byteLength(text)<=MAX_OPERATOR_EVIDENCE_RESPONSE_BYTES,'ASTRA_IMAGE_RESPONSE_TOO_LARGE');
        return {text,signature:mac(this.config.key,text)};
    }
}
