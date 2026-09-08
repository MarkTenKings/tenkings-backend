import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { canonical,digest } from '../src/protocol.mjs';
import { MachineInitializationBridge,enqueueMachineInitialization } from '../src/machine-initialize.mjs';
import { calculateSpeedsterReview } from '@atlas/grading-core/review';
import { measureSpeedsterCenteringBorders } from '@atlas/grading-core/scoring';

const clone=value=>structuredClone(value);
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const flush=async()=>{for(let i=0;i<80;i++)await Promise.resolve();};
function fixture({clock}={}) {
    const now=new Date('2026-09-08T20:00:00.000Z'),sourceId='synthetic-source',ownerId='synthetic-owner',id=randomUUID(),jobId=randomUUID();
    const quad=[{x:.04,y:.03},{x:.96,y:.03},{x:.96,y:.97},{x:.04,y:.97}];
    const source={id:sourceId,createdByUserId:ownerId,updatedAt:now,cardProfile:'SPORTS',identity:{playerName:'Synthetic Card',year:'2026',manufacturer:'Fixture',productSet:'Offline'},
        capture:{front:{centeringQuad:quad},back:{centeringQuad:quad}},reviewedDefects:[],gradeReport:null};
    const evidence={version:'synthetic-unit-evidence',sourceRevision:now.toISOString(),sourceId,sourceOwnerId:ownerId,sides:{FRONT:{sha256:'a'.repeat(64)},BACK:{sha256:'b'.repeat(64)}}};
    const evidenceCanonical=canonical(evidence),evidenceHash=digest(evidenceCanonical),runtimeHash='d'.repeat(64),events=[];
    const policy={version:'atlas-grading-bridge-policy-v1',pilotId:randomUUID(),specimenIds:[id,...Array.from({length:9},()=>randomUUID())],
        expiresAt:new Date(+now+100_000).toISOString(),maxOperationsPerCard:3,maxTotalMicroUsd:10000,maxCardMicroUsd:1000,
        reservationPerOperationMicroUsd:100,maxWorkerCalls:2,deadlineMs:5000};
    const operatorPolicy={version:'atlas-operator-control-policy-v1',pilotId:policy.pilotId,expiresAt:policy.expiresAt,astra:{model:'gpt-6-astra',returnedModel:'gpt-6-astra'}};
    const config={mode:'LOCAL_FIXTURE',origin:'https://fixture.invalid',deploymentId:'synthetic',releaseSha:'0'.repeat(40),
        configHash:'1'.repeat(64),clientKeyHash:'2'.repeat(64),gradingPolicyHash:'3'.repeat(64),runtimeHash};
    const bridge={...config,enabled:true,revision:1,policyCanonical:canonical(policy),policyHash:digest(canonical(policy))};
    const operator={enabled:true,mode:config.mode,configHash:runtimeHash,revision:1,policyCanonical:canonical(operatorPolicy),policyHash:digest(canonical(operatorPolicy))};
    const control={enabled:true,mode:config.mode,revision:1,gradingPolicyHash:config.gradingPolicyHash};
    const person={id:randomUUID(),name:'Synthetic administrator',accessVersion:1,revokedAt:null};
    const elevated={identity:person,actorKind:'HUMAN',capability:'OPERATIONS',capabilityUntil:new Date(+now+10_000),control,now,operationsGrantId:randomUUID(),
        session:{identityId:person.id,tokenHash:'8'.repeat(64),accessVersion:1,revokedAt:null,controlRevision:1,createdAt:now,expiresAt:new Date(+now+10_000)}};
    let state={card:{id,sourceId,sourceOwnerId:ownerId,sourceType:'LOCAL_FIXTURE',evidenceCanonical,evidenceHash,evidenceRevision:1,analysisRevision:0,draftRevision:1},
        source,job:null,op:null,execution:null,analysis:null,draft:{revision:1,reviewedSides:['FRONT','BACK'],identityReviewed:true,disposition:'READY_FOR_HUMAN',
            observations:{FRONT:'Prior human note',BACK:''},evidenceHash},audits:[]};
    const settings={otherWork:0,count:10,overrun:false,total:0,cardCost:0,operations:0,cached:false,failCommit:false,failClaimReply:false,missingPair:false,throwAfterCommit:false};
    const tx={
        async $queryRaw(strings,...args) {
            const q=strings.join('?');
            if(q.includes('clock_timestamp'))return [{now:clone(now)}];
            if(q.includes('AS "gradingCount"')){assert(q.includes('id<>?::uuid'));assert.deepEqual(args,[id,state.job?.gradingOperationId??args[1],id]);return [{gradingCount:settings.otherWork,runCount:settings.otherRuns??0}];}
            if(q.includes('count(*)::int'))return [{count:settings.count}];
            if(q.includes('pilot_budget_usage'))return [{overrun:settings.overrun,total:settings.total,card:settings.cardCost,operations:settings.operations}];
            if(q.includes('"StaffOperatorControl"'))return [clone(operator)];
            if(q.includes('"StaffGradingBridgeControl"'))return [clone(bridge)];
            if(q.includes('"StaffControl"'))return [clone(control)];
            if(q.includes('"StaffMachineInitialization"'))return state.job?[clone(state.job)]:[];
            if(q.includes('"StaffSpecimen"'))return [clone(state.card)];
            if(q.includes('"StaffGradingOperation"'))return state.op?[clone(state.op)]:[];
            if(q.includes('"StaffGradingExecution"'))return state.execution?[clone(state.execution)]:[];
            if(q.includes('"StaffReviewRevision"')){const text=canonical(state.draft);return [{canonical:text,contentHash:digest(text)}];}
            throw new Error(`Unexpected synthetic query ${q}`);
        },
        async $executeRaw(strings,...a) {
            const q=strings.join('?');
            if(q.includes('pg_advisory_xact_lock')||q.includes('SET CONSTRAINTS'))return 0;
            if(q.startsWith('INSERT INTO atlas_staff."StaffMachineInitialization"')){
                assert(q.includes("AT TIME ZONE 'UTC'"));
                const names=['id','specimenId','pilotId','gradingOperationId','runtimeHash','evidenceHash','operatorPolicyHash','bridgePolicyHash','gradingPolicyHash',
                    'sourceRevision','sourceHash','expectedReviewRevision','controlRevision','operatorRevision','bridgeRevision','admittedById','admittedSessionHash',
                    'admittedAccessVersion','operationsGrantId','admissionReason','authorizationEvidenceHash','deadlineAt','createdAt'];
                assert.equal(a.length,names.length);state.job={...Object.fromEntries(names.map((key,i)=>[key,clone(a[i])])),expectedAnalysisRevision:0,
                    state:'QUEUED',dispatchedAt:null,finishedAt:null,failureCode:null};return 1;}
            if(q.startsWith('INSERT INTO atlas_staff."StaffGradingOperation"')){
                assert(q.includes("AT TIME ZONE 'UTC'"));
                const names=['id','specimenId','operationId','actorId','controlRevision','evidenceHash','expectedReviewRevision','requestCanonical','inputHash',
                    'dispatchClaimId','leaseExpiresAt','createdAt'];assert.equal(a.length,names.length);
                state.op={...Object.fromEntries(names.map((key,i)=>[key,clone(a[i])])),actorKind:'ASTRA',sessionHash:null,assignmentFence:null,
                    expectedAnalysisRevision:0,state:'RESERVED',leaseFence:1,resultAnalysisRevision:null,dispatchedAt:null,finishedAt:null,failureCode:null};return 1;}
            if(q.startsWith('INSERT INTO atlas_staff."StaffGradingExecution"')){
                state.execution={operationId:a[0],claimId:a[1],pilotId:a[2],bridgeRevision:a[3],sourceRevision:a[4],reservedMicroUsd:a[5],state:'RUNNING'};events.push('durable-claim');return 1;}
            if(q.startsWith('INSERT INTO atlas_staff."StaffAnalysisRevision"')){state.analysis={operationId:a[0],specimenId:a[1],evidenceHash:a[2],sourceCanonical:a[3],sourceHash:a[4],
                reportCanonical:a[5],reportHash:a[6],admissionCanonical:a[7],admissionHash:a[8],sourceRevision:a[9]};events.push('analysis');return 1;}
            if(q.startsWith('INSERT INTO atlas_staff."StaffReviewRevision"')){state.draft=JSON.parse(a[5]);assert(q.includes('NULL'));events.push('reset-human-checklist');return 1;}
            if(q.startsWith('INSERT INTO atlas_staff."StaffAudit"')){state.audits.push({q,args:a});return 1;}
            if(q.startsWith('UPDATE atlas_staff."StaffSpecimen"')){state.card.analysisRevision=1;state.card.draftRevision=a[0];return 1;}
            for(const [table,key] of [['StaffGradingOperation','op'],['StaffGradingExecution','execution'],['StaffMachineInitialization','job']]) {
                if(q.startsWith(`UPDATE atlas_staff."${table}"`)){
                    const target=q.match(/SET state='([A-Z]+)'/)[1];state[key].state=target;
                    if(key==='op'&&target==='SUCCEEDED')state.op.resultAnalysisRevision=1;
                    if(target==='UNKNOWN')state[key].failureCode='GRADING_OUTCOME_UNCONFIRMED';return 1;
                }
            }
            throw new Error(`Unexpected synthetic write ${q}`);
        },
    };
    const client={$transaction:async work=>{const before=clone(state);let result;
        try{result=await work(tx);if(settings.failCommit&&state.analysis&&!before.analysis)throw new Error('synthetic commit rejected');}
        catch(e){state=before;throw e;}
        if(settings.failClaimReply&&state.execution&&!before.execution){settings.failClaimReply=false;throw new Error('synthetic lost claim reply');}
        return result;}};
    const ports={loadSource:async()=>clone(state.source),sourceEvidence:()=>evidence,
        reportSource:src=>({cardProfile:src.cardProfile,identity:src.identity,capture:src.capture,reviewedDefects:src.reviewedDefects,gradeReport:src.gradeReport}),
        assertSourceAdmission:()=>events.push('source-admitted'),assertFreshDetection:async()=>{events.push('fresh-preflight');if(settings.cached)throw new Error('CHECKPOINT_ALREADY_EXISTS');},
        perform:async input=>{
            assert.deepEqual(input.action,{type:'INITIALIZE'});assert.equal(state.execution.state,'RUNNING');assert.equal(input.freshDetection.jobId,jobId);
            assert.equal(input.freshDetection.claimId,state.execution.claimId);events.push('perform');
            await client.$transaction(async actualTx=>{
                const identity={sessionId:sourceId,createdByUserId:ownerId},expectedUpdatedAt=input.source.updatedAt;
                await input.beforeSessionLock(actualTx,identity,expectedUpdatedAt);
                const centeringBorders=measureSpeedsterCenteringBorders(quad),{grade}=calculateSpeedsterReview({front:{centeringBorders},back:{centeringBorders}},[]);
                state.source.gradeReport={...grade,detectorVersion:'SYNTHETIC-UNIT-ONLY'};state.source.updatedAt=new Date(+now+1);
                await input.afterPersist(actualTx,identity,expectedUpdatedAt,{detectionPair:settings.missingPair?undefined:{operationId:'synthetic-fresh-detector',
                    captureBindingSha256:'4'.repeat(64),memorySnapshotSha256:'5'.repeat(64),frontReceiptHmacSha256:'6'.repeat(64),backReceiptHmacSha256:'7'.repeat(64)}});
            });if(settings.throwAfterCommit)throw new Error('synthetic lost success reply');
        }};
    const executor=new MachineInitializationBridge({client,config,ports,...(clock?{clock}:{})});
    const admin={transaction:(_staff,work)=>client.$transaction(tx=>work({...elevated,tx}))};
    return {config,ports,executor,settings,elevated,operator,bridge,control,events,tx,client,claims:{jobId,runtimeHash},get state(){return state;},
        enqueue:(patch={})=>enqueueMachineInitialization({admin,staff:{opaque:'synthetic'},config,ports},{jobId,specimenId:id,reason:'Explicit synthetic admission after human review',authorizationEvidenceHash:'9'.repeat(64),...patch}),
        run:options=>executor.run({jobId,runtimeHash},options)};
}

test('elevated admission and fresh execution atomically create the first analysis without human authority',async()=>{
    const f=fixture(),job=await f.enqueue();assert.equal(job.state,'QUEUED');assert.equal(f.state.op.actorKind,'ASTRA');
    assert.equal(f.state.op.actorId,`ASTRA_INITIALIZE:${job.id}`);assert.equal(f.state.op.sessionHash,null);assert.equal(f.state.op.assignmentFence,null);
    assert.equal((await f.enqueue()).gradingOperationId,job.gradingOperationId);assert(!f.events.includes('perform'));
    const result=await f.run();assert.deepEqual(result,{state:'SUCCEEDED',analysisRevision:1});
    assert(f.events.indexOf('durable-claim')<f.events.indexOf('perform'));assert.equal(f.state.execution.reservedMicroUsd,100n);
    assert.equal(f.state.card.analysisRevision,1);assert.equal(f.state.card.draftRevision,2);assert.deepEqual(f.state.draft.reviewedSides,[]);
    assert.equal(f.state.draft.identityReviewed,false);assert.equal(f.state.draft.disposition,'IN_REVIEW');assert.equal(f.state.draft.observations.FRONT,'Prior human note');
    const admission=JSON.parse(f.state.analysis.admissionCanonical);assert.equal(admission.machineInitialization.jobId,job.id);
    assert.equal(admission.detectionPair.operationId,'synthetic-fresh-detector');
    assert(f.state.audits.find(a=>a.q.includes('MACHINE_INITIALIZATION_COMMITTED')).q.includes('NULL'));
    assert.deepEqual(await f.run(),result);assert.equal(f.events.filter(e=>e==='perform').length,1);
});

test('machine or stale operations context cannot admit a job',async()=>{
    for(const change of [{actorKind:'ASTRA'},{capability:'REVIEWER'},{capabilityUntil:new Date(0)}]){
        const f=fixture();Object.assign(f.elevated,change);await assert.rejects(()=>f.enqueue(),/MACHINE_ADMISSION_REQUIRED/);assert.equal(f.state.job,null);
    }
    const f=fixture();f.elevated.session.createdAt=new Date(+f.elevated.now-300001);await assert.rejects(()=>f.enqueue());
});

test('fresh detection preflight and the explicit original-service fresh flag are mandatory',async()=>{
    const f=fixture();assert.throws(()=>new MachineInitializationBridge({client:f.client,config:f.config,ports:{...f.ports,assertFreshDetection:undefined}}),/MACHINE_COMPOSITION_REQUIRED/);
    await f.enqueue();f.settings.cached=true;await assert.rejects(()=>f.run(),/CHECKPOINT_ALREADY_EXISTS/);
    assert.equal(f.state.execution,null);assert(!f.events.includes('perform'));assert.equal(f.state.op.state,'RESERVED');
});

test('existing measured content cannot be used as an initial machine grade',async()=>{
    for(const field of ['gradeReport','reviewedDefects']){
        const f=fixture();f.state.source[field]=field==='gradeReport'?{cached:true}:[{oldFinding:true}];
        await assert.rejects(()=>f.enqueue(),/FRESH_DETECTION_REQUIRED/);assert.equal(f.state.job,null);
    }
});

test('changed control, runtime, policy, source or review revision denies execution before a worker claim',async()=>{
    for(const change of [f=>{f.control.enabled=false;},f=>{f.operator.configHash='f'.repeat(64);},f=>{f.bridge.revision++;},
        f=>{f.state.source.updatedAt=new Date(+f.state.source.updatedAt+1);},f=>{f.state.card.draftRevision++;},f=>{f.state.op.actorKind='HUMAN';}]){
        const f=fixture();await f.enqueue();change(f);await assert.rejects(()=>f.run());assert.equal(f.state.execution,null);assert(!f.events.includes('perform'));
    }
});

test('exact ten-card presence, other work and shared budget are checked before external work',async()=>{
    for(const change of [f=>{f.settings.count=9;},f=>{f.settings.otherWork=1;},f=>{f.settings.overrun=true;},
        f=>{f.settings.total=9999;},f=>{f.settings.operations=3;}]){
        const f=fixture();await f.enqueue();change(f);await assert.rejects(()=>f.run());assert.equal(f.state.execution,null);assert(!f.events.includes('perform'));
    }
});

test('worker failure and missing fresh pair preserve held uncertainty with no automatic retry',async()=>{
    for(const kind of ['worker','pair']){
        const f=fixture();await f.enqueue();if(kind==='worker')f.ports.perform=async()=>{f.events.push('perform');throw new Error('synthetic unknown worker outcome');};
        else f.settings.missingPair=true;
        assert.deepEqual(await f.run(),{state:'UNKNOWN'});assert.equal(f.state.execution.state,'UNKNOWN');assert.equal(f.state.execution.reservedMicroUsd,100n);
        assert.equal(f.state.analysis,null);assert.equal(f.state.card.analysisRevision,0);assert.equal(f.state.source.gradeReport,null);
        assert.deepEqual(await f.run(),{state:'UNKNOWN'});assert.equal(f.events.filter(e=>e==='perform').length,1);
    }
});

test('revocation during external work prevents commit and preserves uncertainty',async()=>{
    const f=fixture();await f.enqueue();const original=f.ports.perform;f.ports.perform=async input=>{f.control.enabled=false;return original(input);};
    assert.deepEqual(await f.run(),{state:'UNKNOWN'});assert.equal(f.state.analysis,null);assert.equal(f.state.job.state,'UNKNOWN');
});

test('failed commit rolls back source, analysis and checklist together',async()=>{
    const f=fixture();await f.enqueue();f.settings.failCommit=true;assert.deepEqual(await f.run(),{state:'UNKNOWN'});
    assert.equal(f.state.source.gradeReport,null);assert.equal(f.state.analysis,null);assert.equal(f.state.card.draftRevision,1);
    assert.equal(f.state.draft.identityReviewed,true);assert.equal(f.state.execution.state,'UNKNOWN');
});

test('a lost post-commit reply reads durable success and does not replay the worker',async()=>{
    const f=fixture();await f.enqueue();f.settings.throwAfterCommit=true;assert.deepEqual(await f.run(),{state:'SUCCEEDED',analysisRevision:1});
    assert.equal(f.state.execution.state,'COMMITTED');assert.equal(f.events.filter(e=>e==='perform').length,1);
});

test('a lost durable claim reply cannot authorize a new worker dispatch',async()=>{
    const f=fixture();await f.enqueue();f.settings.failClaimReply=true;await assert.rejects(()=>f.run(),/lost claim reply/);
    assert.equal(f.state.execution.state,'RUNNING');assert(!f.events.includes('perform'));assert.deepEqual(await f.run(),{state:'UNKNOWN'});
});

test('abort stops a noncooperative perform and late hooks cannot commit or retry',async()=>{
    const f=fixture(),gate=deferred(),controller=new AbortController();await f.enqueue();let input;
    f.ports.perform=async value=>{input=value;await gate.promise;};const pending=f.run({signal:controller.signal});await flush();assert(input);
    controller.abort();assert.deepEqual(await pending,{state:'UNKNOWN'});assert.equal(f.state.execution.state,'UNKNOWN');
    await assert.rejects(()=>input.beforeSessionLock(f.tx,{sessionId:'synthetic-source',createdByUserId:'synthetic-owner'},f.state.source.updatedAt));
    gate.resolve();assert.equal(f.state.analysis,null);
});


test('a fake success result or suppressed transaction hooks cannot attest an analysis',async()=>{
    for(const attempt of [async()=>({state:'SUCCEEDED',analysisRevision:1}),async input=>input.afterPersist({},
        {sessionId:'synthetic-source',createdByUserId:'synthetic-owner'},new Date(),{detectionPair:{}})]){
        const f=fixture();await f.enqueue();f.ports.perform=attempt;
        assert.deepEqual(await f.run(),{state:'UNKNOWN'});assert.equal(f.state.analysis,null);assert.equal(f.state.job.state,'UNKNOWN');
    }
});

test('the exact job deadline includes time spent durably claiming and never starts an expired worker',async()=>{
    let calls=0,cleared=false;
    const clock={now:()=>calls++===0?0:6000,setTimeout:()=>1,clearTimeout:()=>{cleared=true;}};
    const f=fixture({clock});await f.enqueue();assert.deepEqual(await f.run(),{state:'UNKNOWN'});
    assert(!f.events.includes('perform'));assert(cleared);assert.equal(f.state.execution.reservedMicroUsd,100n);
});

test('the bounded deadline stops a noncooperative worker and permanently fences its late hooks',async()=>{
    let fire,cleared=false;
    const clock={now:()=>0,setTimeout:callback=>{fire=callback;return 1;},clearTimeout:()=>{cleared=true;}};
    const f=fixture({clock}),gate=deferred();await f.enqueue();let input;
    f.ports.perform=async value=>{input=value;await gate.promise;};
    const pending=f.run();await flush();assert(input);fire();assert.deepEqual(await pending,{state:'UNKNOWN'});assert(cleared);
    await assert.rejects(()=>input.beforeSessionLock(f.tx,{sessionId:'synthetic-source',createdByUserId:'synthetic-owner'},f.state.source.updatedAt));
    gate.resolve();assert.equal(f.state.analysis,null);assert.deepEqual(await f.run(),{state:'UNKNOWN'});
});


test('asynchronous source-admission denial is awaited before admission or dispatch',async()=>{
    const f=fixture();f.ports.assertSourceAdmission=async()=>{throw new Error('SYNTHETIC_SOURCE_DENIED');};
    await assert.rejects(()=>f.enqueue(),/SYNTHETIC_SOURCE_DENIED/);assert.equal(f.state.job,null);
    const g=fixture();await g.enqueue();g.ports.assertSourceAdmission=f.ports.assertSourceAdmission;
    await assert.rejects(()=>g.run(),/SYNTHETIC_SOURCE_DENIED/);assert.equal(g.state.execution,null);assert(!g.events.includes('perform'));
});


test('admission requires strict human reason/evidence and current grant/session references before any creation',async()=>{
    for(const patch of [{reason:''},{reason:'\n'},{reason:'x'.repeat(501)},{authorizationEvidenceHash:'bad'},{unexpected:true}]){
        const f=fixture();await assert.rejects(()=>f.enqueue(patch));assert.equal(f.state.job,null);assert.equal(f.state.op,null);
    }
    for(const change of [f=>{f.elevated.operationsGrantId=undefined;},f=>{f.elevated.session.tokenHash='bad';},
        f=>{f.elevated.identity.accessVersion=0;f.elevated.session.accessVersion=0;}]){
        const f=fixture();change(f);await assert.rejects(()=>f.enqueue(),/MACHINE_ADMISSION_REQUIRED/);assert.equal(f.state.job,null);
    }
});

test('original public Prisma raw-only transaction can admit and retains exact immutable human audit evidence',async()=>{
    const f=fixture();assert(!('staffGradingOperation' in f.tx));const job=await f.enqueue();
    assert.equal(job.admittedSessionHash,f.elevated.session.tokenHash);assert.equal(job.admittedAccessVersion,f.elevated.identity.accessVersion);
    assert.equal(job.operationsGrantId,f.elevated.operationsGrantId);assert.equal(job.authorizationEvidenceHash,'9'.repeat(64));
    const audit=JSON.parse(f.state.audits.find(a=>a.q.includes('MACHINE_INITIALIZATION_ADMITTED')).args[3]);
    assert.deepEqual(audit,{jobId:job.id,operationId:job.gradingOperationId,runtimeHash:job.runtimeHash,evidenceHash:job.evidenceHash,
        sessionHash:job.admittedSessionHash,accessVersion:job.admittedAccessVersion,controlRevision:job.controlRevision,
        operationsGrantId:job.operationsGrantId,reason:job.admissionReason,authorizationEvidenceHash:job.authorizationEvidenceHash});
    assert.deepEqual(await f.run(),{state:'SUCCEEDED',analysisRevision:1});
});

test('admission itself rejects retained checkpoints and active runs before creating a reservation',async()=>{
    for(const change of [f=>{f.settings.cached=true;},f=>{f.settings.otherRuns=1;}]){
        const f=fixture();change(f);await assert.rejects(()=>f.enqueue());assert.equal(f.state.job,null);assert.equal(f.state.op,null);
        assert(!f.events.includes('perform'));
    }
});

test('same-human replay retains exact original admission evidence and conflicts on reason/evidence/actor',async()=>{
    const f=fixture(),job=await f.enqueue();f.elevated.session.tokenHash='a'.repeat(64);
    assert.deepEqual(await f.enqueue(),job);assert.equal(f.state.audits.length,1);
    for(const patch of [{reason:'Changed authorization reason'},{authorizationEvidenceHash:'b'.repeat(64)},{specimenId:randomUUID()}])
        await assert.rejects(()=>f.enqueue(patch),/MACHINE_ADMISSION_CONFLICT/);
    const other=randomUUID();f.elevated.identity.id=other;f.elevated.session.identityId=other;
    await assert.rejects(()=>f.enqueue(),/MACHINE_ADMISSION_CONFLICT/);assert.equal(f.state.audits.length,1);assert.equal(f.state.execution,null);
});
