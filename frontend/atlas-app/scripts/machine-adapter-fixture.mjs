// Owned synthetic integration only: actual PNGs/HTTP envelopes/SQL, fictional
// measurements and provider replies. No optical, hardware or paid acceptance.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes,randomUUID } from 'node:crypto';
import { canonical,digest } from '../../../packages/atlas-service-bridge/src/protocol.mjs';
import { OperatorEvidenceBridge,operatorEvidenceClient,verifyOperatorEvidenceRequest } from '../../../packages/atlas-service-bridge/src/operator-evidence.mjs';
import { createOperatorImagePacket,operatorImageTransform,OPERATOR_IMAGE_DECODER } from '../../../packages/atlas-service-bridge/src/operator-images.mjs';
import { operatorAdapters } from '../../../packages/atlas-operator/src/adapters.mjs';
import { runOperator } from '../../../packages/atlas-operator/src/runner.mjs';
import { enqueueOperatorRun } from '../../../packages/atlas-operator/src/ledger.mjs';
import { responsesTransport } from '../../../packages/atlas-operator/src/provider.mjs';
import { operatorFixture } from './operator-fixture.mjs';
import { StaffProposals } from '../lib/server/access/proposals.mjs';
const sharp=createRequire(new URL('../../nextjs-app/package.json',import.meta.url))('sharp');
const tools=['read_card_report','inspect_region','propose_identity','propose_finding_change','submit_for_human_review'];
async function fixture(context,work) {
    const buffers={},sides={};
    for(const side of ['FRONT','BACK']) {
        const bytes=await sharp({create:{width:360,height:504,channels:3,background:side==='FRONT'?'#aa3355':'#5588bb'}}).png().toBuffer();
        const sourceRef=`synthetic-png:${side}`;buffers[sourceRef]=bytes;
        sides[side]={sourceRef,sha256:digest(bytes),byteCount:bytes.length,width:360,height:504,contentType:'image/png'};
    }
    return operatorFixture(context,async f=>{
        const key=randomBytes(32),config={mode:'LOCAL_FIXTURE',origin:'https://machine-images.example.test',deploymentId:'fixture-image-bridge',
            releaseSha:'0'.repeat(40),configHash:digest('fixture images'),clientKeyHash:digest(key),key,gradingPolicyHash:f.bridge.service.config.gradingPolicyHash};
        const {key:_key,gradingPolicyHash:_policy,...stored}=config;
        await f.admin.staffOperatorImageControl.create({data:{...stored,enabled:true}});
        let reads=0,afterRead;
        const bridge=new OperatorEvidenceBridge({client:f.admin,config,ports:{...f.bridge.ports,
            async readEvidence(descriptor) {reads++;await afterRead?.();return Buffer.from(buffers[descriptor.sourceRef]);},
            async render({sourceBytes,asset,request}) {
                const t=operatorImageTransform(request,asset,1),r=request.rect;
                const bytes=await sharp(sourceBytes).extract({left:r.x,top:r.y,width:r.width,height:r.height}).resize(t.output.width,t.output.height).png().toBuffer();
                return createOperatorImagePacket({imageId:randomUUID(),request,asset,orientation:1,decoder:OPERATOR_IMAGE_DECODER,bytes});
            }}});
        const client=operatorEvidenceClient({origin:config.origin,key,runtimeHash:f.config.configHash},async(url,request)=>{
            assert.equal(url,`${config.origin}/api/internal/atlas/operator-evidence`);
            const claims=verifyOperatorEvidenceRequest(config,request.body,request.headers['x-atlas-operator-evidence-signature']);
            const result=await bridge.read(claims);return new Response(result.text,{status:200,headers:{'content-type':'application/json','x-atlas-operator-evidence-signature':result.signature}});
        });
        const adapters=operatorAdapters({evidenceClient:client});
        async function apply(lease,attempt) {
            const snapshot=await f.ledger.inspectTool(lease,attempt.attemptId),adapter=adapters[snapshot.call.name];
            const prepared=await adapter.prepare(snapshot,{});
            return f.ledger.applyTool(lease,attempt.attemptId,data=>adapter.apply(data,prepared));
        }
        await work({...f,adapters,apply,imageBridge:bridge,imageClient:client,imageConfig:config,reads:()=>reads,setAfterRead:fn=>{afterRead=fn;}});
    },{tools,bridgeOptions:{evidence:{sides,originals:sides}}});
}
export async function machineAdapterScenarios(scenario) {
    await scenario('original-source admission holds the real public source lock until machine transition commit',async context=>{
        const id=`synthetic-lock-${randomUUID()}`,owner='synthetic-source-owner',revision='2026-09-08T12:00:00.123Z';
        await context.admin.$executeRaw`INSERT INTO public."AiGraderV2Session"
          (id,"createdByUserId","cardProfile","workflowState","ruleVersion",identity,capture,"reviewedDefects","gradeReport","updatedAt")
          VALUES (${id},${owner},'SPORTS','CAPTURED','synthetic-lock-test','{}','{}','[]','{}',(${revision}::timestamptz AT TIME ZONE 'UTC'))`;
        let unlock,entered;const hold=new Promise(r=>{unlock=r;}),ready=new Promise(r=>{entered=r;});
        const pending=context.admin.$transaction(async tx=>{
            const [row]=await tx.$queryRaw`SELECT pg_backend_pid() AS pid,atlas_staff.operator_source_matches(${id},${owner},${revision}) AS current`;
            assert.equal(row.current,true);entered(row.pid);await hold;
        },{timeout:5000});
        const lockedPid=await ready;
        try {
            await assert.rejects(()=>context.admin.$transaction(async tx=>{
                const [{pid}]=await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;assert.notEqual(pid,lockedPid);
                await tx.$executeRaw`SET LOCAL lock_timeout='250ms'`;
                await tx.$executeRaw`UPDATE public."AiGraderV2Session" SET "updatedAt"="updatedAt"+interval '1 second' WHERE id=${id}`;
            }),/lock timeout/);
        } finally {unlock();await pending;}
        await context.admin.$executeRaw`UPDATE public."AiGraderV2Session" SET "updatedAt"="updatedAt"+interval '1 second' WHERE id=${id}`;
        const [stale]=await context.admin.$queryRaw`SELECT atlas_staff.operator_source_matches(${id},${owner},${revision}) AS current`;
        assert.equal(stale.current,false);
        await assert.rejects(()=>context.client.$queryRaw`SELECT atlas_staff.operator_source_matches(${id},${owner},${revision})`);
    });
    await scenario('machine report and original crop persist exact image lineage and provider-request deliveries',context=>fixture(context,async f=>{
        const {run,lease}=await f.start(),first=await f.request(lease);
        const step=await f.apply(lease,first);
        assert.equal(step.output.result.report.grade.overall.displayGrade>0,true);assert.equal(step.output.result.assets.length,4);
        assert.equal(await f.admin.staffOperatorImage.count(),2);assert.equal(await f.admin.staffOperatorImageDelivery.count(),0);
        const asset=JSON.parse(run.manifestCanonical).assets.find(a=>a.side==='BACK'&&a.view==='ORIGINAL');
        const crop=await f.request(step.lease,'inspect_region',{assetId:asset.assetId,sourceSha256:asset.sha256,side:asset.side,rect:{x:5,y:9,width:20,height:30}});
        assert.equal(await f.admin.staffOperatorImageDelivery.count(),2);
        const next=await f.apply(step.lease,crop);assert.equal(await f.admin.staffOperatorImage.count(),3);
        const pending=await f.ledger.reserve(next.lease);assert.equal(await f.admin.staffOperatorImageDelivery.count(),5);
        const saved=await f.admin.staffOperatorAttempt.findUnique({where:{id:pending.attemptId}});
        assert.match(saved.requestCanonical,/ATLAS_TOOL_IMAGE_EVIDENCE/);assert.match(saved.requestCanonical,/data:image\/png;base64/);
        const images=await f.admin.staffOperatorImage.findMany();assert(images.every(i=>!i.canonical.includes('bytesBase64')&&!i.canonical.includes('sourceRef')));
        await assert.rejects(()=>f.client.staffOperatorImage.update({where:{imageId:images[0].imageId},data:{hash:'f'.repeat(64)}}));
        await assert.rejects(()=>f.admin.staffOperatorImage.delete({where:{imageId:images[0].imageId}}));
    }));
    await scenario('source mutation during image read rejects delivery before any tool commit',context=>fixture(context,async f=>{
        const {run,lease}=await f.start(),first=await f.request(lease);
        f.setAfterRead(async()=>{await f.admin.$executeRaw`UPDATE public."AtlasBridgeTestSource" SET "updatedAt"="updatedAt"+interval '1 second' WHERE id=${(await f.admin.staffSpecimen.findUnique({where:{id:run.specimenId}})).sourceId}`;});
        await assert.rejects(()=>f.apply(lease,first),/ASTRA_SOURCE_CHANGED/);
        assert.equal(await f.admin.staffOperatorImage.count(),0);assert.equal(await f.admin.staffOperatorStep.count(),0);
        assert.equal((await f.admin.staffOperatorAttempt.findUnique({where:{id:first.attemptId}})).state,'RECEIVED');
    }));
    await scenario('SQL independently rejects an omitted or substituted image delivery roster and rolls back the attempt',context=>fixture(context,async f=>{
        const {lease}=await f.start(),step=await f.apply(lease,await f.request(lease));
        await f.sql(`CREATE FUNCTION atlas_staff.fixture_omit_delivery() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
          CREATE TRIGGER fixture_omit_delivery BEFORE INSERT ON atlas_staff."StaffOperatorImageDelivery" FOR EACH ROW EXECUTE FUNCTION atlas_staff.fixture_omit_delivery();`);
        await assert.rejects(()=>f.ledger.reserve(step.lease),/untracked or substituted request image/);
        assert.equal(await f.admin.staffOperatorAttempt.count(),1);assert.equal(await f.admin.staffOperatorImageDelivery.count(),0);
        await f.sql('DROP TRIGGER fixture_omit_delivery ON atlas_staff."StaffOperatorImageDelivery"');
        await f.sql(`CREATE FUNCTION atlas_staff.fixture_substitute_delivery() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW."lineageHash":=repeat('f',64); RETURN NEW; END $$;
          CREATE TRIGGER fixture_substitute_delivery BEFORE INSERT ON atlas_staff."StaffOperatorImageDelivery" FOR EACH ROW EXECUTE FUNCTION atlas_staff.fixture_substitute_delivery();`);
        await assert.rejects(()=>f.ledger.reserve(step.lease),/image delivery attempt mismatch|untracked or substituted request image/);
        assert.equal(await f.admin.staffOperatorAttempt.count(),1);
        await f.sql('DROP TRIGGER fixture_substitute_delivery ON atlas_staff."StaffOperatorImageDelivery"');
        await f.ledger.reserve(step.lease);assert.equal(await f.admin.staffOperatorImageDelivery.count(),2);
    }));
    await scenario('proposal evidence must be in the exact current request delivery roster',context=>fixture(context,async f=>{
        const {run,lease}=await f.start(),asset=JSON.parse(run.manifestCanonical).assets[0];
        const request=await f.request(lease,'propose_identity',{fields:[{field:'playerName',value:'Hypothesis',evidence:[{assetId:asset.assetId,sha256:asset.sha256,side:asset.side}]}],summary:'Synthetic identity hypothesis.'});
        await assert.rejects(()=>f.apply(lease,request),/ASTRA_PROPOSAL_IMAGE_NOT_DELIVERED/);
        assert.equal(await f.admin.staffOperatorStep.count(),0);
    }));
    await scenario('actual bounded runner executes report image proposal and human handoff without publication',context=>fixture(context,async f=>{
        const card=await f.initialize(),run=await enqueueOperatorRun(f.admin,f.config,card.id),manifest=JSON.parse(run.manifestCanonical);
        const asset=manifest.assets.find(a=>a.side==='FRONT'&&a.view==='RECTIFIED');let calls=0;
        const result=await runOperator({ledger:f.ledger,runId:run.id,adapters:f.adapters,createProvider:({takeDispatch,signal})=>responsesTransport({binding:f.binding,takeDispatch,signal,
            fetchImpl:async(_url,request)=>{
                calls++;const args={runId:run.id,expectedRevision:calls,evidenceHash:run.evidenceHash,manifestHash:run.manifestHash};
                const name=calls===1?'read_card_report':calls===2?'propose_finding_change':'submit_for_human_review';
                if(calls===2) Object.assign(args,{findingId:'FRONT:fixture-1:SURFACE',action:'RETAIN',defectType:null,
                    evidence:[{assetId:asset.assetId,sha256:asset.sha256,side:'FRONT'}],rect:null,reason:'PHYSICAL_DAMAGE',summary:'Synthetic retained finding.',alternativeExplanation:'Illustration only.'});
                if(calls===3) Object.assign(args,{reportHash:manifest.reportHash,disposition:'READY_FOR_REVIEW',summary:'Synthetic draft for review.'});
                if(calls>1) assert.match(request.body,/ATLAS_TOOL_IMAGE_EVIDENCE/);
                return new Response(JSON.stringify({id:`resp_fixture_${calls}`,model:'gpt-6-astra',service_tier:'default',status:'completed',
                    output:[{type:'function_call',call_id:`call_fixture_${calls}`,name,arguments:canonical(args)}],usage:{input_tokens:100,output_tokens:100,total_tokens:200}}),
                    {status:200,headers:{'content-type':'application/json'}});
            }})});
        assert.equal(result.state,'READY_FOR_HUMAN',result.code);assert.equal(calls,3);assert.equal(result.stepsApplied,3);
        assert.equal(await f.admin.staffReportApproval.count(),0);assert.equal(await f.admin.staffOperatorImageDelivery.count(),4);
        const view=await f.bridge.review.read(f.signed.staff,card.id);assert.equal(view.grading.proposals.length,1);
        assert.equal(view.grading.approvalBlock,'MACHINE_PROPOSALS_UNRESOLVED');
        const proposals=new StaffProposals({auth:f.auth,review:f.bridge.review}),proposal=view.grading.proposals[0];
        const input={operationId:randomUUID(),stepId:proposal.stepId,analysisRevision:view.grading.analysisRevision,analysisHash:view.grading.analysisHash,
            evidenceHash:view.evidenceHash,decision:'ACCEPTED',reason:'Human inspected this synthetic saved finding.'};
        const resolved=await proposals.decide(f.signed.staff,card.id,input);assert.equal(resolved.card.grading.proposals[0].decision,'ACCEPTED');
        assert.equal((await proposals.decide(f.signed.staff,card.id,input)).card.id,card.id);
        await assert.rejects(()=>proposals.decide(f.signed.staff,card.id,{...input,reason:'Changed retry'}),/REQUEST_CONFLICT/);
        const [{count}]=await f.admin.$queryRaw`SELECT atlas_staff.operator_proposals_pending(${card.id}::uuid) AS count`;assert.equal(count,0);
        const observer=await f.login(undefined,'+12025550142');await assert.rejects(()=>proposals.decide(observer.staff,card.id,{...input,operationId:randomUUID()}),/REVIEW_ACCESS_REQUIRED/);
    }));
    await scenario('human cannot accept a removal until the original grading service saved that correction',context=>fixture(context,async f=>{
        const {run,lease,card}=await f.start();let step=await f.apply(lease,await f.request(lease));
        const asset=JSON.parse(run.manifestCanonical).assets[0];
        step=await f.apply(step.lease,await f.request(step.lease,'propose_finding_change',{findingId:'FRONT:fixture-1:SURFACE',action:'REMOVE',defectType:null,
            evidence:[{assetId:asset.assetId,sha256:asset.sha256,side:asset.side}],rect:null,reason:'PRINT_DESIGN',summary:'Synthetic suggestion.',alternativeExplanation:null}));
        await f.apply(step.lease,await f.request(step.lease,'submit_for_human_review',{reportHash:JSON.parse(run.manifestCanonical).reportHash,disposition:'READY_FOR_REVIEW',summary:'Synthetic needs human correction.'}));
        const view=await f.bridge.review.read(f.signed.staff,card.id),p=view.grading.proposals[0],proposals=new StaffProposals({auth:f.auth,review:f.bridge.review});
        const input={operationId:randomUUID(),stepId:p.stepId,analysisRevision:view.grading.analysisRevision,analysisHash:view.grading.analysisHash,
            evidenceHash:view.evidenceHash,decision:'ACCEPTED',reason:'Synthetic test decision.'};
        await assert.rejects(()=>proposals.decide(f.signed.staff,card.id,input),/SAVE_PROPOSED_CORRECTION_FIRST/);
        await proposals.decide(f.signed.staff,card.id,{...input,decision:'REJECTED'});
        assert.equal(await f.admin.staffProposalDecision.count(),1);
        await assert.rejects(()=>f.admin.staffProposalDecision.updateMany({data:{reason:'Changed'}}));
    }));
    await scenario('fenced runner stop releases undispatched reservations but preserves unknown attempts after revocation',context=>operatorFixture(context,async f=>{
        const first=await f.start(),reserved=await f.ledger.reserve(first.lease);
        assert.equal((await f.ledger.stop(first.lease,{code:'ASTRA_RUNNER_STOPPED'})).state,'FAILED');
        assert.equal((await f.admin.staffOperatorAttempt.findUnique({where:{id:reserved.attemptId}})).state,'FAILED');
        const second=await f.start(1),sent=await f.request(second.lease,'read_card_report',{}, {deferReceipt:true});
        await f.admin.staffOperatorControl.update({where:{id:'active'},data:{enabled:false,revision:{increment:1}}});
        assert.equal((await f.ledger.stop(second.lease,{code:'ASTRA_RUNNER_STOPPED'})).state,'UNKNOWN');
        await f.ledger.recordReceipt(sent);
        assert.equal((await f.admin.staffOperatorRun.findUnique({where:{id:second.run.id}})).state,'UNKNOWN');
        assert.equal((await f.admin.staffOperatorAttempt.findUnique({where:{id:sent.attemptId}})).state,'RECEIVED');
    }));
}
