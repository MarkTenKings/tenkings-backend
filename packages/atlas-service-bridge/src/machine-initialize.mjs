import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { previewAtlasReport } from '@atlas/grading-core/report';
import { canonical, digest, keys, parsePilotPolicy, requireBridge as check, UUID, SHA } from './protocol.mjs';

const machineActor = id => `ASTRA_INITIALIZE:${id}`;
const checked = (text,hash) => {
    check(typeof text === 'string' && digest(text) === hash, 'MACHINE_STORED_EVIDENCE_INVALID');
    const value = JSON.parse(text); check(canonical(value) === text, 'MACHINE_STORED_EVIDENCE_INVALID'); return value;
};
const fresh = source => check(Array.isArray(source.reviewedDefects) && source.reviewedDefects.length === 0
    && (!source.gradeReport || typeof source.gradeReport === 'object' && !Array.isArray(source.gradeReport)
        && Object.keys(source.gradeReport).length === 0), 'FRESH_DETECTION_REQUIRED');
const requests = (job,card) => ({ version:'atlas-machine-initialize-operation-v1',jobId:job.id,runtimeHash:job.runtimeHash,
    policyHash:job.gradingPolicyHash,operatorPolicyHash:job.operatorPolicyHash,bridgePolicyHash:job.bridgePolicyHash,
    sourceId:card.sourceId,sourceOwnerId:card.sourceOwnerId,sourceRevision:job.sourceRevision,sourceHash:job.sourceHash,
    request:{action:{type:'INITIALIZE'}} });

/** Private composition uses the original full grading ports. There is no HTTP
 * authentication, caller-selected worker, fake human identity or cached grade.
 * The private route must authenticate its jobId/runtimeHash before calling run.
 * The additive SQL must guard every machine job/op/execution/analysis transition;
 * the ordinary operator role must have no machine admission/enqueue privilege.
 */
export class MachineInitializationBridge {
    constructor({client,config,ports,clock={now:()=>performance.now(),setTimeout,clearTimeout}}) {
        check(config&&SHA.test(config.runtimeHash)&&ports&&['loadSource','sourceEvidence','reportSource','assertSourceAdmission',
            'assertFreshDetection','perform'].every(key=>typeof ports[key]==='function'),'MACHINE_COMPOSITION_REQUIRED');
        this.client=client;this.config=config;this.ports=ports;this.clock=clock;
    }
    async transaction(work) {
        return this.client.$transaction(async tx=>{const result=await work(tx);await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;return result;},
            {maxWait:5000,timeout:10_000});
    }
    async controls(tx) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0))`;
        const [operator]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffOperatorControl" WHERE id='active' FOR SHARE`;
        const [bridge]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffGradingBridgeControl" WHERE id='active' FOR SHARE`;
        const [control]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffControl" WHERE id='active' FOR SHARE`;
        const [{now}]=await tx.$queryRaw`SELECT clock_timestamp() AS now`;
        check(bridge?.enabled && ['mode','origin','deploymentId','releaseSha','configHash','clientKeyHash','gradingPolicyHash']
            .every(k=>bridge[k]===this.config[k]) && operator?.enabled && control?.enabled
            && operator.mode===bridge.mode && control.mode===bridge.mode && operator.configHash===this.config.runtimeHash
            && control.gradingPolicyHash===bridge.gradingPolicyHash, 'MACHINE_INITIALIZATION_NOT_ENABLED');
        const policy=parsePilotPolicy(checked(bridge.policyCanonical,bridge.policyHash));
        const operatorPolicy=checked(operator.policyCanonical,operator.policyHash);
        check(operatorPolicy.version==='atlas-operator-control-policy-v1' && operatorPolicy.astra?.model==='gpt-6-astra'
            && operatorPolicy.astra.returnedModel==='gpt-6-astra' && operatorPolicy.pilotId===policy.pilotId
            && +new Date(operatorPolicy.expiresAt)>+now && +new Date(policy.expiresAt)>+now, 'MACHINE_PILOT_NOT_ACTIVE');
        const [{count}]=await tx.$queryRaw`SELECT count(*)::int AS count FROM atlas_staff."StaffSpecimen"
            WHERE id::text = ANY(${policy.specimenIds}::text[]) AND "sourceType"=${bridge.mode==='PRODUCTION'?'SPEEDSTER':'LOCAL_FIXTURE'}`;
        check(count===10,'PILOT_TEN_CARDS_REQUIRED');
        return {tx,operator,bridge,control,now,policy,operatorPolicy};
    }
    async authorize(tx,claims,{committing=false}={}) {
        const context=await this.controls(tx),{now,operator,bridge,control,policy}=context;
        const [job]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffMachineInitialization" WHERE id=${claims.jobId}::uuid FOR UPDATE`;
        check(job && job.runtimeHash===claims.runtimeHash && job.runtimeHash===operator.configHash
            && job.pilotId===policy.pilotId && job.operatorPolicyHash===operator.policyHash && job.bridgePolicyHash===bridge.policyHash
            && job.gradingPolicyHash===bridge.gradingPolicyHash && job.controlRevision===control.revision
            && job.operatorRevision===operator.revision && job.bridgeRevision===bridge.revision
            && policy.specimenIds.includes(job.specimenId), 'MACHINE_INITIALIZATION_SCOPE_CHANGED');
        const [card]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffSpecimen" WHERE id=${job.specimenId}::uuid FOR UPDATE`;
        check(card && card.evidenceHash===job.evidenceHash && card.sourceType===(bridge.mode==='PRODUCTION'?'SPEEDSTER':'LOCAL_FIXTURE'),
            'MACHINE_EVIDENCE_CHANGED');
        if (committing || job.state==='QUEUED') check(+job.deadlineAt>+now && job.expectedAnalysisRevision===0
            && card.analysisRevision===0 && card.draftRevision===job.expectedReviewRevision, 'MACHINE_INITIALIZATION_STALE');
        const [op]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffGradingOperation" WHERE id=${job.gradingOperationId}::uuid FOR UPDATE`;
        check(op && op.specimenId===card.id && op.actorKind==='ASTRA' && op.actorId===machineActor(job.id)
            && op.sessionHash===null && op.assignmentFence===null && op.controlRevision===job.controlRevision
            && op.evidenceHash===job.evidenceHash && op.expectedAnalysisRevision===0 && op.expectedReviewRevision===job.expectedReviewRevision
            && op.operationId===job.id && op.leaseFence===1 && +op.leaseExpiresAt===+job.deadlineAt
            && canonical(checked(op.requestCanonical,op.inputHash))===canonical(requests(job,card)), 'MACHINE_OPERATION_SCOPE_CHANGED');
        if (committing) check(job.state==='DISPATCHED' && op.state==='DISPATCHED' && +op.leaseExpiresAt>+now,
            'MACHINE_INITIALIZATION_STALE');
        return {...context,job,card,op};
    }
    async noOtherWork({tx,job,card}) {
        const [counts]=await tx.$queryRaw`SELECT
            (SELECT count(*)::int FROM atlas_staff."StaffGradingOperation" WHERE "specimenId"=${card.id}::uuid
                AND id<>${job.gradingOperationId}::uuid AND state IN ('RESERVED','DISPATCHED','UNKNOWN')) AS "gradingCount",
            (SELECT count(*)::int FROM atlas_staff."StaffOperatorRun" WHERE "specimenId"=${card.id}::uuid
                AND state IN ('QUEUED','RUNNING','WAITING_TOOL','UNKNOWN')) AS "runCount"`;
        check(counts?.gradingCount===0&&counts.runCount===0,'MACHINE_OTHER_WORK_UNRESOLVED');
    }
    async source(context) {
        const {tx,card,job}=context,source=await this.ports.loadSource(tx,card);
        check(source?.id===card.sourceId && source.createdByUserId===card.sourceOwnerId
            && source.updatedAt.toISOString()===job.sourceRevision
            && canonical(this.ports.sourceEvidence(source,checked(card.evidenceCanonical,card.evidenceHash).sourceRevision))===card.evidenceCanonical
            && digest(canonical(this.ports.reportSource(source)))===job.sourceHash, 'SOURCE_REVISION_CHANGED');
        await this.ports.assertSourceAdmission(source);fresh(source);return source;
    }
    async run(claims,{signal:parentSignal}={}) {
        keys(claims,['jobId','runtimeHash']);check(UUID.test(claims.jobId)&&SHA.test(claims.runtimeHash),'MACHINE_CLAIMS_INVALID');
        parentSignal?.throwIfAborted();
        const requestedAt=this.clock.now();
        const claim=await this.transaction(async tx=>{
            const context=await this.authorize(tx,claims),{job,op,card,policy,bridge,now}=context;
            const [execution]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffGradingExecution" WHERE "operationId"=${op.id}::uuid FOR UPDATE`;
            // A prior execution claim or UNKNOWN is never dispatch authority.
            if (execution || job.state!=='QUEUED' || op.state!=='RESERVED')
                return {prior:true,state:job.state==='SUCCEEDED'&&execution?.state==='COMMITTED'&&op.state==='SUCCEEDED'?'SUCCEEDED':'UNKNOWN',
                    analysisRevision:job.state==='SUCCEEDED'?op.resultAnalysisRevision:undefined};
            await this.noOtherWork(context);const source=await this.source(context);await this.ports.assertFreshDetection(tx,source);
            const [usage]=await tx.$queryRaw`SELECT * FROM atlas_staff.pilot_budget_usage(${policy.pilotId}::uuid,${card.id}::uuid)`;
            const reserve=BigInt(policy.reservationPerOperationMicroUsd);
            check(!usage.overrun && BigInt(usage.total)+reserve<=BigInt(policy.maxTotalMicroUsd)
                && BigInt(usage.card)+reserve<=BigInt(policy.maxCardMicroUsd) && usage.operations<policy.maxOperationsPerCard,
            'PILOT_BUDGET_EXHAUSTED');
            parentSignal?.throwIfAborted();const claimId=randomUUID();
            await tx.$executeRaw`UPDATE atlas_staff."StaffGradingOperation" SET state='DISPATCHED',"dispatchedAt"=(${now}::timestamptz AT TIME ZONE 'UTC') WHERE id=${op.id}::uuid`;
            await tx.$executeRaw`INSERT INTO atlas_staff."StaffGradingExecution"
                ("operationId","claimId","pilotId","bridgeRevision","sourceRevision","reservedMicroUsd",state,"createdAt")
                VALUES (${op.id}::uuid,${claimId}::uuid,${policy.pilotId}::uuid,${bridge.revision},${job.sourceRevision},${reserve},'RUNNING',(${now}::timestamptz AT TIME ZONE 'UTC'))`;
            await tx.$executeRaw`UPDATE atlas_staff."StaffMachineInitialization" SET state='DISPATCHED',"dispatchedAt"=(${now}::timestamptz AT TIME ZONE 'UTC') WHERE id=${job.id}::uuid`;
            return {prior:false,job,op,source,claimId,policy,bridge,now};
        });
        if (claim.prior) return {state:claim.state,...(claim.analysisRevision?{analysisRevision:claim.analysisRevision}:{})};
        const controller=new AbortController();
        const cancel=()=>controller.abort();parentSignal?.addEventListener('abort',cancel,{once:true});if(parentSignal?.aborted)cancel();
        // Local wall time cannot extend the database-observed exact job window.
        const remaining=Math.min(claim.policy.deadlineMs,+claim.job.deadlineAt-+claim.now)-(this.clock.now()-requestedAt);
        let timer,committingContext,hookUsed=false,aborted;
        const timeout=new Promise((_,reject)=>{
            aborted=()=>reject(new Error('MACHINE_EXECUTION_STOPPED'));controller.signal.addEventListener('abort',aborted,{once:true});
            timer=this.clock.setTimeout(()=>{controller.abort();reject(new Error('MACHINE_EXECUTION_TIMEOUT'));},Math.max(1,remaining));
        });
        timeout.catch(()=>{}); // Cancellation before dispatch must not leave an unhandled rejection.
        try {
            if(remaining<=0)controller.abort();
            controller.signal.throwIfAborted();
            await Promise.race([timeout,this.ports.perform({source:claim.source,action:{type:'INITIALIZE'},policy:claim.policy,signal:controller.signal,
                freshDetection:{jobId:claim.job.id,claimId:claim.claimId,sourceRevision:claim.job.sourceRevision},
                beforeSessionLock:async(tx,identity,expectedUpdatedAt)=>{
                    controller.signal.throwIfAborted();check(!hookUsed,'MACHINE_TRANSACTION_ALREADY_USED');
                    const context=await this.authorize(tx,claims,{committing:true});await this.noOtherWork(context);
                    const [execution]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffGradingExecution" WHERE "operationId"=${claim.op.id}::uuid FOR UPDATE`;
                    check(execution?.claimId===claim.claimId && execution.state==='RUNNING'
                        && identity.sessionId===claim.source.id && identity.createdByUserId===claim.source.createdByUserId
                        && expectedUpdatedAt.toISOString()===claim.job.sourceRevision, 'MACHINE_EXECUTION_STALE');
                    await this.source(context);committingContext=context;
                },
                afterPersist:async(tx,identity,expectedUpdatedAt,data)=>{
                    controller.signal.throwIfAborted();const context=committingContext;
                    check(context?.tx===tx&&!hookUsed && identity.sessionId===claim.source.id
                        && identity.createdByUserId===claim.source.createdByUserId
                        && expectedUpdatedAt.toISOString()===claim.job.sourceRevision,'MACHINE_TRANSACTION_REQUIRED');hookUsed=true;
                    const {card,bridge,now}=context,saved=await this.ports.loadSource(tx,card);
                    check(canonical(this.ports.sourceEvidence(saved,checked(card.evidenceCanonical,card.evidenceHash).sourceRevision))===card.evidenceCanonical,
                        'MACHINE_EVIDENCE_CHANGED');
                    const sourceCanonical=canonical(this.ports.reportSource(saved)),sourceHash=digest(sourceCanonical);
                    const reportCanonical=canonical(previewAtlasReport(JSON.parse(sourceCanonical))),reportHash=digest(reportCanonical);
                    // Never inherit a prior detectionPair or any cached report.
                    check(data?.detectionPair&&typeof data.detectionPair==='object'&&!Array.isArray(data.detectionPair),'DETECTION_ADMISSION_REQUIRED');
                    keys(data.detectionPair,['operationId','captureBindingSha256','memorySnapshotSha256','frontReceiptHmacSha256','backReceiptHmacSha256']);
                    check(typeof data.detectionPair.operationId==='string'&&data.detectionPair.operationId.length>0&&data.detectionPair.operationId.length<=128
                        &&['captureBindingSha256','memorySnapshotSha256','frontReceiptHmacSha256','backReceiptHmacSha256'].every(k=>SHA.test(data.detectionPair[k])),
                    'DETECTION_ADMISSION_REQUIRED');
                    const admissionCanonical=canonical({purpose:'atlas-analysis-admission-v1',mode:bridge.mode,evidenceHash:card.evidenceHash,sourceHash,
                        policyHash:bridge.gradingPolicyHash,bridgePolicyHash:bridge.policyHash,sourceId:card.sourceId,sourceOwnerId:card.sourceOwnerId,
                        operationId:claim.op.id,bridgeRevision:bridge.revision,detectionPair:data.detectionPair,
                        machineInitialization:{jobId:claim.job.id,runtimeHash:claim.job.runtimeHash,operatorPolicyHash:claim.job.operatorPolicyHash}});
                    await tx.$executeRaw`INSERT INTO atlas_staff."StaffAnalysisRevision"
                        ("operationId","specimenId",revision,"evidenceHash","sourceCanonical","sourceHash","reportCanonical","reportHash","admissionCanonical","admissionHash","sourceRevision",mode,"createdAt")
                        VALUES (${claim.op.id}::uuid,${card.id}::uuid,1,${card.evidenceHash},${sourceCanonical},${sourceHash},${reportCanonical},${reportHash},
                        ${admissionCanonical},${digest(admissionCanonical)},${saved.updatedAt.toISOString()},${bridge.mode},(${now}::timestamptz AT TIME ZONE 'UTC'))`;
                    const [row]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffReviewRevision" WHERE "specimenId"=${card.id}::uuid AND revision=${card.draftRevision}`;
                    const previous=checked(row.canonical,row.contentHash);
                    const draft={...previous,revision:card.draftRevision+1,reviewedSides:[],identityReviewed:false,disposition:'IN_REVIEW',savedAt:now.toISOString(),savedBy:'Astra preparation'};
                    const reviewCanonical=canonical(draft);
                    await tx.$executeRaw`INSERT INTO atlas_staff."StaffReviewRevision"
                        ("specimenId",revision,"evidenceRevision","evidenceHash","contentHash","analysisRevision",canonical,"savedById","savedAt")
                        VALUES (${card.id}::uuid,${draft.revision},${card.evidenceRevision},${card.evidenceHash},${digest(reviewCanonical)},1,${reviewCanonical},NULL,(${now}::timestamptz AT TIME ZONE 'UTC'))`;
                    await tx.$executeRaw`UPDATE atlas_staff."StaffSpecimen" SET "analysisRevision"=1,"draftRevision"=${draft.revision} WHERE id=${card.id}::uuid`;
                    await tx.$executeRaw`UPDATE atlas_staff."StaffGradingOperation" SET state='SUCCEEDED',"resultAnalysisRevision"=1,"failureCode"=NULL,"finishedAt"=(${now}::timestamptz AT TIME ZONE 'UTC') WHERE id=${claim.op.id}::uuid`;
                    await tx.$executeRaw`UPDATE atlas_staff."StaffGradingExecution" SET state='COMMITTED',"finishedAt"=(${now}::timestamptz AT TIME ZONE 'UTC') WHERE "operationId"=${claim.op.id}::uuid`;
                    await tx.$executeRaw`UPDATE atlas_staff."StaffMachineInitialization" SET state='SUCCEEDED',"finishedAt"=(${now}::timestamptz AT TIME ZONE 'UTC') WHERE id=${claim.job.id}::uuid`;
                    await tx.$executeRaw`INSERT INTO atlas_staff."StaffAudit" (id,event,"subjectId","actorId",details,"createdAt")
                        VALUES (${randomUUID()}::uuid,'MACHINE_INITIALIZATION_COMMITTED',${card.id},NULL,
                        ${canonical({jobId:claim.job.id,operationId:claim.op.id,analysisRevision:1,sourceHash,reportHash,runtimeHash:claim.job.runtimeHash})},(${now}::timestamptz AT TIME ZONE 'UTC'))`;
                    controller.signal.throwIfAborted();await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
                }})]);
        } catch { /* Durable state below, never a tool return value, proves commit. */ }
        finally {this.clock.clearTimeout(timer);controller.signal.removeEventListener('abort',aborted);controller.abort();parentSignal?.removeEventListener('abort',cancel);}
        return this.transaction(async tx=>{
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0))`;
            const [job]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffMachineInitialization" WHERE id=${claim.job.id}::uuid FOR UPDATE`;
            const [op]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffGradingOperation" WHERE id=${claim.op.id}::uuid FOR UPDATE`;
            const [execution]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffGradingExecution" WHERE "operationId"=${claim.op.id}::uuid FOR UPDATE`;
            check(job?.gradingOperationId===op?.id && execution?.claimId===claim.claimId,'MACHINE_EXECUTION_STALE');
            if(job.state==='SUCCEEDED'&&op.state==='SUCCEEDED'&&execution.state==='COMMITTED')return {state:'SUCCEEDED',analysisRevision:op.resultAnalysisRevision};
            const [{now}]=await tx.$queryRaw`SELECT clock_timestamp() AS now`;
            if(op.state==='DISPATCHED')await tx.$executeRaw`UPDATE atlas_staff."StaffGradingOperation" SET state='UNKNOWN',"failureCode"='GRADING_OUTCOME_UNCONFIRMED' WHERE id=${op.id}::uuid`;
            if(execution.state==='RUNNING')await tx.$executeRaw`UPDATE atlas_staff."StaffGradingExecution" SET state='UNKNOWN',"failureCode"='GRADING_OUTCOME_UNCONFIRMED',"finishedAt"=(${now}::timestamptz AT TIME ZONE 'UTC') WHERE "operationId"=${op.id}::uuid`;
            if(job.state==='DISPATCHED')await tx.$executeRaw`UPDATE atlas_staff."StaffMachineInitialization" SET state='UNKNOWN',"failureCode"='GRADING_OUTCOME_UNCONFIRMED',"finishedAt"=(${now}::timestamptz AT TIME ZONE 'UTC') WHERE id=${job.id}::uuid`;
            return {state:'UNKNOWN'};
        });
    }
}

/** Elevated admission port must authenticate an opaque fresh HUMAN OPERATIONS
 * principal, validate its dedicated DB role, and flush deferred constraints.
 * The SQL job/op admission guard must independently enforce this authority.
 * This helper cannot enable any control or grant itself that capability.
 */
export async function enqueueMachineInitialization({admin,staff,config,ports},input) {
    keys(input,['jobId','specimenId','reason','authorizationEvidenceHash']);
    const {jobId,specimenId,reason,authorizationEvidenceHash}=input;
    check(typeof reason==='string'&&reason.trim().length>0&&reason.length<=500&&!/[\x00-\x1f\x7f]/.test(reason)
        &&typeof authorizationEvidenceHash==='string'&&SHA.test(authorizationEvidenceHash),'MACHINE_ADMISSION_REQUIRED');
    check(UUID.test(jobId)&&UUID.test(specimenId)&&typeof admin?.transaction==='function','MACHINE_ADMISSION_REQUIRED');
    const executor=new MachineInitializationBridge({client:null,config,ports});
    return admin.transaction(staff,async elevated=>{
        const {tx,identity,session,capabilityUntil,operationsGrantId}=elevated;
        const context=await executor.controls(tx),{operator,bridge,control,policy,operatorPolicy,now}=context;
        check(elevated.actorKind==='HUMAN'&&elevated.capability==='OPERATIONS'&&UUID.test(identity?.id)
            &&!identity.revokedAt&&Number.isSafeInteger(identity.accessVersion)&&identity.accessVersion>0&&identity.accessVersion<=2147483647
            &&session?.identityId===identity.id&&!session.revokedAt&&session.accessVersion===identity.accessVersion
            &&typeof session.tokenHash==='string'&&SHA.test(session.tokenHash)&&UUID.test(operationsGrantId??'')
            &&now instanceof Date&&capabilityUntil instanceof Date&&capabilityUntil>now&&session.createdAt instanceof Date
            &&session.createdAt<=now&&+now-+session.createdAt<=300_000&&session.expiresAt>now,'MACHINE_ADMISSION_REQUIRED');
        check(elevated.control?.revision===control.revision&&session.controlRevision===control.revision,'MACHINE_ADMISSION_REQUIRED');
        const [existing]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffMachineInitialization" WHERE id=${jobId}::uuid FOR UPDATE`;
        if(existing){check(existing.id===jobId&&existing.specimenId===specimenId&&existing.runtimeHash===config.runtimeHash
            &&existing.admittedById===identity.id&&existing.admissionReason===reason&&existing.authorizationEvidenceHash===authorizationEvidenceHash,
            'MACHINE_ADMISSION_CONFLICT');return existing;}
        const [card]=await tx.$queryRaw`SELECT * FROM atlas_staff."StaffSpecimen" WHERE id=${specimenId}::uuid FOR UPDATE`;
        check(card&&policy.specimenIds.includes(card.id)&&card.analysisRevision===0&&card.sourceType===(bridge.mode==='PRODUCTION'?'SPEEDSTER':'LOCAL_FIXTURE'),
            'MACHINE_INITIALIZATION_STALE');
        const source=await ports.loadSource(tx,card);fresh(source);await ports.assertSourceAdmission(source);
        check(source.id===card.sourceId&&source.createdByUserId===card.sourceOwnerId
            &&canonical(ports.sourceEvidence(source,checked(card.evidenceCanonical,card.evidenceHash).sourceRevision))===card.evidenceCanonical,
        'SOURCE_REVISION_CHANGED');
        await ports.assertFreshDetection(tx,source);
        const deadlineAt=new Date(Math.min(+context.now+policy.deadlineMs,+new Date(policy.expiresAt),+new Date(operatorPolicy.expiresAt)));
        const job={id:jobId,specimenId,pilotId:policy.pilotId,gradingOperationId:randomUUID(),runtimeHash:config.runtimeHash,evidenceHash:card.evidenceHash,
            operatorPolicyHash:operator.policyHash,bridgePolicyHash:bridge.policyHash,gradingPolicyHash:bridge.gradingPolicyHash,
            sourceRevision:source.updatedAt.toISOString(),sourceHash:digest(canonical(ports.reportSource(source))),expectedAnalysisRevision:0,
            expectedReviewRevision:card.draftRevision,controlRevision:control.revision,operatorRevision:operator.revision,bridgeRevision:bridge.revision,
            admittedById:identity.id,admittedSessionHash:session.tokenHash,admittedAccessVersion:identity.accessVersion,operationsGrantId,
            admissionReason:reason,authorizationEvidenceHash,deadlineAt,createdAt:context.now,state:'QUEUED',dispatchedAt:null,finishedAt:null,failureCode:null};
        await executor.noOtherWork({...context,card,job});
        await tx.$executeRaw`INSERT INTO atlas_staff."StaffMachineInitialization"
            (id,"specimenId","pilotId","gradingOperationId","runtimeHash","evidenceHash","operatorPolicyHash","bridgePolicyHash","gradingPolicyHash",
             "sourceRevision","sourceHash","expectedAnalysisRevision","expectedReviewRevision","controlRevision","operatorRevision","bridgeRevision",
             "admittedById","admittedSessionHash","admittedAccessVersion","operationsGrantId","admissionReason","authorizationEvidenceHash","deadlineAt","createdAt",state)
            VALUES (${job.id}::uuid,${job.specimenId}::uuid,${job.pilotId}::uuid,${job.gradingOperationId}::uuid,${job.runtimeHash},${job.evidenceHash},
                ${job.operatorPolicyHash},${job.bridgePolicyHash},${job.gradingPolicyHash},${job.sourceRevision},${job.sourceHash},0,
                ${job.expectedReviewRevision},${job.controlRevision},${job.operatorRevision},${job.bridgeRevision},${job.admittedById}::uuid,
                ${job.admittedSessionHash},${job.admittedAccessVersion},${job.operationsGrantId}::uuid,${job.admissionReason},${job.authorizationEvidenceHash},
                (${deadlineAt}::timestamptz AT TIME ZONE 'UTC'),(${context.now}::timestamptz AT TIME ZONE 'UTC'),'QUEUED')`;
        const requestCanonical=canonical(requests(job,card));
        await tx.$executeRaw`INSERT INTO atlas_staff."StaffGradingOperation"
            (id,"specimenId","operationId","actorKind","actorId","sessionHash","assignmentFence","controlRevision","evidenceHash",
             "expectedAnalysisRevision","expectedReviewRevision","requestCanonical","inputHash",state,"dispatchClaimId","leaseFence","leaseExpiresAt","createdAt")
            VALUES (${job.gradingOperationId}::uuid,${specimenId}::uuid,${jobId},'ASTRA',${machineActor(jobId)},NULL,NULL,${control.revision},${card.evidenceHash},
                0,${card.draftRevision},${requestCanonical},${digest(requestCanonical)},'RESERVED',${randomUUID()}::uuid,1,
                (${deadlineAt}::timestamptz AT TIME ZONE 'UTC'),(${context.now}::timestamptz AT TIME ZONE 'UTC'))`;
        await tx.$executeRaw`INSERT INTO atlas_staff."StaffAudit" (id,event,"subjectId","actorId",details,"createdAt")
            VALUES (${randomUUID()}::uuid,'MACHINE_INITIALIZATION_ADMITTED',${card.id},${identity.id}::uuid,
            ${canonical({jobId,operationId:job.gradingOperationId,runtimeHash:job.runtimeHash,evidenceHash:job.evidenceHash,
                sessionHash:session.tokenHash,accessVersion:identity.accessVersion,controlRevision:control.revision,operationsGrantId,reason,authorizationEvidenceHash})},(${context.now}::timestamptz AT TIME ZONE 'UTC'))`;
        await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;return job;
    });
}
