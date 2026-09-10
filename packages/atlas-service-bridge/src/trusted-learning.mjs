import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { canonical, digest, keys, keyBytes, bridgeOrigin, requireBridge as check, SHA, UUID } from './protocol.mjs';
export const LEARNING_PATH = '/api/internal/atlas/trusted-learning/candidates';
export const LEARNING_PURPOSE = 'atlas-trusted-learning-candidates-v1';
export const LEARNING_GENERATOR_VERSION = 'speedster-learning-candidates-v1';
const date = value => value instanceof Date && Number.isFinite(+value);
const positive = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
const sha = value => typeof value === 'string' && SHA.test(value);
const uuid = value => typeof value === 'string' && UUID.test(value);
export function makeTrustedLearningConfig({mode,origin,deploymentId,releaseSha,key,gradingPolicyHash,phoneAllowlistHash,otherKeyHashes}) {
    bridgeOrigin(origin); const bytes = Buffer.isBuffer(key) ? Buffer.from(key) : keyBytes(key), clientKeyHash = digest(bytes);
    check(['PRODUCTION','LOCAL_FIXTURE'].includes(mode) && text(deploymentId,120) && /^[a-f0-9]{40}$/.test(releaseSha)
        && bytes.length === 32 && sha(gradingPolicyHash) && sha(phoneAllowlistHash) && Array.isArray(otherKeyHashes)
        && otherKeyHashes.length <= 16 && otherKeyHashes.every(sha) && !otherKeyHashes.includes(clientKeyHash)
        && (mode === 'PRODUCTION' ? releaseSha !== '0'.repeat(40) : releaseSha === '0'.repeat(40)), 'LEARNING_CONFIGURATION_INVALID');
    const binding = {purpose:LEARNING_PURPOSE,mode,origin,deploymentId,releaseSha,clientKeyHash,gradingPolicyHash,
        phoneAllowlistHash,generatorVersion:LEARNING_GENERATOR_VERSION};
    return Object.freeze({...binding,key:bytes,configHash:digest(canonical(binding))});
}
const scopeKeys = ['actorId','sessionHash','browserHash','accessVersion','controlRevision','staffOrigin','deploymentId','releaseSha','staffConfigHash',
    'specimenId','approvalId','assignmentFence','analysisRevision','reviewRevision','evidenceHash','analysisHash','reviewHash','sourceRevision'];
function scopeShape(scope,mode) {
    keys(scope,scopeKeys);
    check(['actorId','specimenId','approvalId'].every(k=>uuid(scope[k]))
        && ['sessionHash','browserHash','staffConfigHash','evidenceHash','analysisHash','reviewHash'].every(k=>sha(scope[k]))
        && ['accessVersion','controlRevision','assignmentFence','analysisRevision','reviewRevision'].every(k=>positive(scope[k]))
        && text(scope.deploymentId,120) && /^[a-f0-9]{40}$/.test(scope.releaseSha) && text(scope.sourceRevision,80), 'LEARNING_SCOPE_INVALID');
    if (mode !== 'LOCAL_FIXTURE' || scope.staffOrigin !== 'http://127.0.0.1:4318') bridgeOrigin(scope.staffOrigin);
}
export function signTrustedLearningRequest(config,scope,now=Date.now(),nonce=randomUUID()) {
    scopeShape(scope,config.mode);
    const body=canonical({purpose:LEARNING_PURPOSE,audience:config.origin,bridgeConfigHash:config.configHash,
        scope,nonce,issuedAt:now,expiresAt:now+30_000});
    return {body,signature:createHmac('sha256',config.key).update(body).digest('hex')};
}
export function verifyTrustedLearningRequest(config,body,signature,now=Date.now()) {
    check(typeof body==='string' && Buffer.byteLength(body)<=8192 && sha(signature),'LEARNING_REQUEST_INVALID');
    check(timingSafeEqual(createHmac('sha256',config.key).update(body).digest(),Buffer.from(signature,'hex')),'LEARNING_AUTHENTICATION_REQUIRED');
    let p;try{p=JSON.parse(body);}catch{check(false,'LEARNING_REQUEST_INVALID');}
    keys(p,['purpose','audience','bridgeConfigHash','scope','nonce','issuedAt','expiresAt']);
    check(canonical(p)===body && p.purpose===LEARNING_PURPOSE && p.audience===config.origin && p.bridgeConfigHash===config.configHash
        && uuid(p.nonce) && Number.isSafeInteger(p.issuedAt) && Number.isSafeInteger(p.expiresAt) && p.issuedAt<=now
        && p.expiresAt>now && p.expiresAt>p.issuedAt && p.expiresAt-p.issuedAt<=30_000,'LEARNING_REQUEST_EXPIRED');
    scopeShape(p.scope,config.mode);return p;
}
export function checkedLearningJSON(body,hash,limit=262144) {
    check(typeof body==='string' && Buffer.byteLength(body)<=limit && sha(hash) && digest(body)===hash,'LEARNING_EVIDENCE_INVALID');
    let value;try{value=JSON.parse(body);}catch{check(false,'LEARNING_EVIDENCE_INVALID');}
    check(canonical(value)===body,'LEARNING_EVIDENCE_INVALID');return value;
}
const bundleKeys=['specimenId','approvalId','analysisRevision','reviewRevision','evidenceHash','analysisHash','reviewHash','sourceRevision',
    'sourceType','sourceId','sourceOwnerId','rawFindingsHash','candidateHash','generatorVersion','fingerprintVersion','gradingPolicyHash','bridgeConfigHash'];
export function trustedLearningBundleHash(row) {
    return digest(canonical({version:'atlas-trusted-learning-bundle-v1',...Object.fromEntries(bundleKeys.map(k=>[k,row[k]]))}));
}
const provenance=['DETECTOR_REMOVED','DETECTOR_RELABELED_NEGATIVE','DETECTOR_RELABELED_POSITIVE','HUMAN_TRACE_CORRECTION_POSITIVE','SMART_MARK_POSITIVE','UNTOUCHED_ACCEPTED_POSITIVE'];
function candidateId(row,entry) {
    return digest(canonical({purpose:'atlas-trusted-learning-candidate-v1',approvalId:row.approvalId,analysisHash:row.analysisHash,
        evidenceHash:row.evidenceHash,sourceRevision:row.sourceRevision,generatorVersion:row.generatorVersion,
        fingerprintVersion:row.fingerprintVersion,findingId:entry.findingId,rawFindingHash:entry.rawFindingHash,lesson:entry.lesson}));
}
export function validateLearningCandidates(row) {
    check(row && uuid(row.id) && uuid(row.specimenId) && uuid(row.approvalId)
        && ['evidenceHash','analysisHash','reviewHash','rawFindingsHash','candidateHash','bundleHash','gradingPolicyHash','bridgeConfigHash'].every(k=>sha(row[k]))
        && positive(row.analysisRevision) && positive(row.reviewRevision) && text(row.sourceRevision,80)
        && ['SPEEDSTER','LOCAL_FIXTURE'].includes(row.sourceType) && text(row.sourceId,128) && text(row.sourceOwnerId,128)
        && row.generatorVersion===LEARNING_GENERATOR_VERSION && text(row.fingerprintVersion,160)
        && trustedLearningBundleHash(row)===row.bundleHash,'LEARNING_EVIDENCE_INVALID');
    const packet=checkedLearningJSON(row.candidateCanonical,row.candidateHash);
    keys(packet,['version','candidates']);check(packet.version==='atlas-trusted-learning-candidates-v1' && Array.isArray(packet.candidates)
        && packet.candidates.length<=256,'LEARNING_EVIDENCE_INVALID');
    const ids=new Set();
    for(const entry of packet.candidates){
        keys(entry,['candidateId','findingId','rawFindingHash','lesson']);const l=entry.lesson;
        check(text(entry.findingId,180) && sha(entry.rawFindingHash) && sha(entry.candidateId)
            && entry.candidateId===candidateId(row,entry) && !ids.has(entry.candidateId),'LEARNING_EVIDENCE_INVALID');
        ids.add(entry.candidateId);
        keys(l,Object.hasOwn(l??{},'lessonOrder')?['defectType','polarity','fingerprint','provenance','sourceViewId','proposalOrder','lessonOrder']:
            ['defectType','polarity','fingerprint','provenance','sourceViewId','proposalOrder']);
        check(text(l.defectType,80) && ['POSITIVE','NEGATIVE'].includes(l.polarity) && provenance.includes(l.provenance)
            && ['ORIGINAL','NORMALIZED','MICRO_DEFECT','DIRECTIONAL'].includes(l.sourceViewId)
            && Number.isSafeInteger(l.proposalOrder) && l.proposalOrder>=0
            && (l.lessonOrder===undefined || Number.isSafeInteger(l.lessonOrder)&&l.lessonOrder>=0)
            && Array.isArray(l.fingerprint)&&l.fingerprint.length===32&&l.fingerprint.every(v=>typeof v==='number'&&Number.isFinite(v)), 'LEARNING_EVIDENCE_INVALID');
    }
    return packet.candidates;
}
export function publicLearningCandidates(row) {
    return validateLearningCandidates(row).map((entry,index)=>({candidateId:entry.candidateId,findingId:entry.findingId,
        proposalOrder:entry.lesson.proposalOrder,lessonOrder:entry.lesson.lessonOrder??index,defectType:entry.lesson.defectType,
        polarity:entry.lesson.polarity,provenance:entry.lesson.provenance,sourceViewId:entry.lesson.sourceViewId}));
}
/** Private metadata-only bridge. The injected generator is the original pure
 * candidate function. This class has no bank writer or source mutation port. */
export class ScopedTrustedLearningCandidates {
    constructor({client,config,ports}){
        const verified=makeTrustedLearningConfig({...config,otherKeyHashes:[]});
        check(verified.configHash===config.configHash && typeof client?.$transaction==='function'
            && ['loadSource','reportSource','sourceEvidence','assertSourceAdmission','fingerprintVersion','generateCandidates','isStaffPhoneAllowed']
                .every(k=>typeof ports?.[k]==='function'),'LEARNING_CONFIGURATION_INVALID');
        this.client=client;this.config=verified;this.ports=ports;
    }
    async authorize(tx,s,now){
        const [control]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffControl" WHERE id='active' FOR SHARE`;
        const [learning]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffLearningControl" WHERE id='active' FOR SHARE`;
        check(control?.enabled && learning?.enabled && positive(learning.revision)
            && ['mode','origin','deploymentId','releaseSha','configHash','clientKeyHash','gradingPolicyHash','phoneAllowlistHash'].every(k=>learning[k]===this.config[k])
            && control.mode===this.config.mode && control.gradingPolicyHash===this.config.gradingPolicyHash
            && control.revision===s.controlRevision && control.origin===s.staffOrigin && control.deploymentId===s.deploymentId
            && control.releaseSha===s.releaseSha && control.configHash===s.staffConfigHash,'LEARNING_NOT_ENABLED');
        const [i]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffIdentity" WHERE id=${s.actorId}::uuid FOR SHARE`;
        const [session]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffSession" WHERE "tokenHash"=${s.sessionHash} FOR SHARE`;
        const [browser]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffBrowser" WHERE "tokenHash"=${s.browserHash} FOR SHARE`;
        const [assignment]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffAssignment" WHERE "specimenId"=${s.specimenId}::uuid AND "identityId"=${s.actorId}::uuid FOR SHARE`;
        check(i?.id===s.actorId && i.role==='REVIEWER' && !i.revokedAt && i.accessVersion===s.accessVersion
            && date(i.trustedLearningUntil)&&i.trustedLearningUntil>now&&this.ports.isStaffPhoneAllowed(i.phoneHash)===true
            && session?.identityId===i.id&&!session.revokedAt&&session.tokenHash===s.sessionHash&&session.accessVersion===i.accessVersion
            && session.browserHash===s.browserHash&&session.controlRevision===control.revision&&date(session.createdAt)&&session.createdAt<=now
            && +now-+session.createdAt<=300_000&&date(session.expiresAt)&&session.expiresAt>now
            && browser?.tokenHash===s.browserHash&&browser.controlRevision===control.revision&&date(browser.createdAt)&&browser.createdAt<=session.createdAt
            && date(browser.expiresAt)&&browser.expiresAt>now&&assignment?.canReview&&!assignment.revokedAt
            && assignment.fence===s.assignmentFence&&date(assignment.expiresAt)&&assignment.expiresAt>now,'FRESH_TRUSTED_LEARNING_REVIEWER_REQUIRED');
        const [card]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffSpecimen" WHERE id=${s.specimenId}::uuid FOR SHARE`;
        const [approval]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffReportApproval" WHERE id=${s.approvalId}::uuid FOR SHARE`;
        const [publication]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffPublicReport" WHERE "specimenId"=${s.specimenId}::uuid FOR SHARE`;
        const [analysis]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffAnalysisRevision" WHERE "specimenId"=${s.specimenId}::uuid AND revision=${s.analysisRevision} FOR SHARE`;
        const [review]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffReviewRevision" WHERE "specimenId"=${s.specimenId}::uuid AND revision=${s.reviewRevision} FOR SHARE`;
        check(card?.id===s.specimenId&&card.evidenceHash===s.evidenceHash&&card.analysisRevision===s.analysisRevision&&card.draftRevision===s.reviewRevision
            && approval?.specimenId===card.id&&publication?.currentApprovalId===approval.id&&approval.id===s.approvalId
            && approval.evidenceHash===s.evidenceHash&&approval.analysisHash===s.analysisHash&&approval.reviewHash===s.reviewHash
            && approval.analysisRevision===s.analysisRevision&&approval.reviewRevision===s.reviewRevision
            && analysis?.sourceHash===s.analysisHash&&analysis.evidenceHash===s.evidenceHash&&analysis.sourceRevision===s.sourceRevision
            && analysis.mode===control.mode&&review?.contentHash===s.reviewHash,'LEARNING_APPROVAL_CHANGED');
        const snapshot=checkedLearningJSON(analysis.sourceCanonical,analysis.sourceHash,2*1024*1024);
        const evidence=checkedLearningJSON(card.evidenceCanonical,card.evidenceHash,131072);
        const admission=checkedLearningJSON(analysis.admissionCanonical,analysis.admissionHash,8192);
        check(admission.purpose==='atlas-analysis-admission-v1'&&admission.policyHash===control.gradingPolicyHash
            &&admission.sourceHash===analysis.sourceHash&&admission.evidenceHash===card.evidenceHash&&admission.mode===control.mode
            &&Array.isArray(snapshot.reviewedDefects),'LEARNING_EVIDENCE_INVALID');
        return {i,session,browser,assignment,card,snapshot,evidence};
    }
    async receive(body,signature){
        verifyTrustedLearningRequest(this.config,body,signature);
        return this.client.$transaction(async tx=>{
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0))`;
            const [{now}]=await tx.$queryRaw`SELECT clock_timestamp() AS now`;
            const p=verifyTrustedLearningRequest(this.config,body,signature,+now),s=p.scope,a=await this.authorize(tx,s,now);
            const exact={sourceType:a.card.sourceType,sourceId:a.card.sourceId,sourceOwnerId:a.card.sourceOwnerId};
            check(exact.sourceType===(this.config.mode==='PRODUCTION'?'SPEEDSTER':'LOCAL_FIXTURE'),'LEARNING_SOURCE_CHANGED');
            const raw=await this.ports.loadSource(tx,exact);
            check(raw?.id===exact.sourceId&&raw.createdByUserId===exact.sourceOwnerId&&raw.workflowState==='CAPTURED'
                &&date(raw.updatedAt)&&raw.updatedAt.toISOString()===s.sourceRevision,'LEARNING_SOURCE_CHANGED');
            await this.ports.assertSourceAdmission(raw);
            check(canonical(await this.ports.reportSource(raw))===canonical(a.snapshot)
                &&canonical(await this.ports.sourceEvidence(raw,a.evidence.sourceRevision))===a.card.evidenceCanonical,'LEARNING_SOURCE_CHANGED');
            const fingerprintVersion=await this.ports.fingerprintVersion(a.snapshot);
            check(text(fingerprintVersion,160),'LEARNING_EVIDENCE_INVALID');
            const rawFindingsHash=digest(canonical(a.snapshot.reviewedDefects));
            // Isolate the original evidence even from a accidentally mutating injected adapter.
            const generated=await this.ports.generateCandidates({fingerprintVersion,reviewedDefects:structuredClone(a.snapshot.reviewedDefects)});
            check(Array.isArray(generated?.lessons)&&generated.lessons.length<=256,'LEARNING_CANDIDATES_INVALID');
            const row={id:p.nonce,actorId:s.actorId,sessionHash:s.sessionHash,accessVersion:s.accessVersion,assignmentFence:s.assignmentFence,
                controlRevision:s.controlRevision,specimenId:s.specimenId,approvalId:s.approvalId,analysisRevision:s.analysisRevision,
                reviewRevision:s.reviewRevision,evidenceHash:s.evidenceHash,analysisHash:s.analysisHash,reviewHash:s.reviewHash,sourceRevision:s.sourceRevision,
                ...exact,rawFindingsHash,generatorVersion:this.config.generatorVersion,fingerprintVersion,gradingPolicyHash:this.config.gradingPolicyHash,
                bridgeConfigHash:this.config.configHash,createdAt:now,expiresAt:new Date(Math.min(+now+300_000,+a.session.createdAt+300_000,
                    +a.session.expiresAt,+a.browser.expiresAt,+a.i.trustedLearningUntil,+a.assignment.expiresAt))};
            const candidates=generated.lessons.map(lesson=>{
                check(Number.isSafeInteger(lesson?.proposalOrder)&&lesson.proposalOrder>=0,'LEARNING_CANDIDATES_INVALID');
                const finding=a.snapshot.reviewedDefects[lesson.proposalOrder];
                check(finding&&text(finding.id,180)&&a.snapshot.reviewedDefects.filter(raw=>raw?.id===finding.id).length===1,'LEARNING_CANDIDATES_INVALID');
                const entry={findingId:finding.id,rawFindingHash:digest(canonical(finding)),lesson:structuredClone(lesson)};
                return {candidateId:candidateId(row,entry),...entry};
            });
            row.candidateCanonical=canonical({version:'atlas-trusted-learning-candidates-v1',candidates});row.candidateHash=digest(row.candidateCanonical);
            row.bundleHash=trustedLearningBundleHash(row);validateLearningCandidates(row);check(row.expiresAt>now,'FRESH_TRUSTED_LEARNING_REVIEWER_REQUIRED');
            const [prior]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffLearningCandidates" WHERE id=${row.id}::uuid FOR SHARE`;
            if(prior) check(['actorId','sessionHash','accessVersion','assignmentFence','controlRevision',...bundleKeys,'candidateCanonical','bundleHash'].every(k=>prior[k]===row[k])
                &&date(prior.expiresAt)&&prior.expiresAt>now,'LEARNING_NONCE_CONFLICT');
            else await tx.$executeRaw`INSERT INTO atlas_staff."StaffLearningCandidates"
                (id,"actorId","sessionHash","accessVersion","assignmentFence","controlRevision","specimenId","approvalId","analysisRevision","reviewRevision",
                "evidenceHash","analysisHash","reviewHash","sourceRevision","sourceType","sourceId","sourceOwnerId","rawFindingsHash","generatorVersion","fingerprintVersion",
                "gradingPolicyHash","bridgeConfigHash","candidateCanonical","candidateHash","bundleHash","createdAt","expiresAt") VALUES
                (${row.id}::uuid,${row.actorId}::uuid,${row.sessionHash},${row.accessVersion},${row.assignmentFence},${row.controlRevision},${row.specimenId}::uuid,
                ${row.approvalId}::uuid,${row.analysisRevision},${row.reviewRevision},${row.evidenceHash},${row.analysisHash},${row.reviewHash},${row.sourceRevision},
                ${row.sourceType},${row.sourceId},${row.sourceOwnerId},${row.rawFindingsHash},${row.generatorVersion},${row.fingerprintVersion},${row.gradingPolicyHash},
                ${row.bridgeConfigHash},${row.candidateCanonical},${row.candidateHash},${row.bundleHash},(${row.createdAt}::timestamptz AT TIME ZONE 'UTC'),
                (${row.expiresAt}::timestamptz AT TIME ZONE 'UTC'))`;
            const [{now:finishedAt}]=await tx.$queryRaw`SELECT clock_timestamp() AS now`;
            verifyTrustedLearningRequest(this.config,body,signature,+finishedAt);await this.authorize(tx,s,finishedAt);
            check((prior??row).expiresAt>finishedAt,'LEARNING_CANDIDATES_EXPIRED');await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
            return {receiptId:row.id,bundleHash:row.bundleHash,candidates:publicLearningCandidates(row),expiresAt:(prior??row).expiresAt.toISOString()};
        },{maxWait:5000,timeout:10_000});
    }
}
export function trustedLearningClient(config,fetchImpl=fetch,{timers={setTimeout,clearTimeout}}={}){
    bridgeOrigin(config.origin);
    return Object.freeze({binding:Object.freeze({bridgeConfigHash:config.configHash,gradingPolicyHash:config.gradingPolicyHash}),async call(scope){
        const request=signTrustedLearningRequest(config,scope);
        const controller=new AbortController();let reader,timer,closed=false,complete=false;
        const cancel=target=>{try{Promise.resolve(target?.cancel()).catch(()=>{});}catch{/* A broken cancellation cannot hold the deadline. */}};
        const deadline=new Promise((_,reject)=>{timer=timers.setTimeout(()=>{
            controller.abort();reject(Object.assign(new Error('LEARNING_OUTCOME_UNCONFIRMED'),{code:'LEARNING_OUTCOME_UNCONFIRMED'}));
        },15_000);});
        try{return await Promise.race([deadline,(async()=>{
            const response=await fetchImpl(`${config.origin}${LEARNING_PATH}`,{method:'POST',redirect:'error',credentials:'omit',cache:'no-store',
                headers:{'content-type':'application/json','x-atlas-learning-signature':request.signature},body:request.body,signal:controller.signal});
            if(closed){cancel(response.body);check(false,'LEARNING_OUTCOME_UNCONFIRMED');}
            const length=response.headers?.get('content-length');
            if(response.status!==200||response.redirected===true||!response.body?.getReader
                ||response.headers?.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json'
                ||length!==null&&length!==undefined&&(!/^\d+$/.test(length)||!Number.isSafeInteger(Number(length))||Number(length)>131072)){
                cancel(response.body);check(false,'LEARNING_OUTCOME_UNCONFIRMED');
            }
            reader=response.body.getReader();const chunks=[];let size=0;
            while(true){const {done,value}=await reader.read();check(!closed,'LEARNING_OUTCOME_UNCONFIRMED');
                if(done){complete=true;break;}check(value instanceof Uint8Array&&(size+=value.byteLength)<=131072,'LEARNING_RESPONSE_INVALID');chunks.push(Buffer.from(value));}
            const body=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size)),result=JSON.parse(body);
            check(canonical(result)===body,'LEARNING_RESPONSE_INVALID');keys(result,['receiptId','bundleHash','candidates','expiresAt']);
            check(uuid(result.receiptId)&&sha(result.bundleHash)&&Array.isArray(result.candidates)&&result.candidates.length<=256
                &&typeof result.expiresAt==='string'&&Number.isFinite(Date.parse(result.expiresAt)),'LEARNING_RESPONSE_INVALID');
            // The caller uses DB-only receipt readback; wire data is never authority.
            return {receiptId:result.receiptId,bundleHash:result.bundleHash};
        })()]);}finally{closed=true;timers.clearTimeout(timer);controller.abort();if(!complete)cancel(reader);
            try{reader?.releaseLock();}catch{/* A pending uncooperative read remains bounded by the settled outer call. */}}
    }});
}
