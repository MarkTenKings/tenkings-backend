import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { canonical, digest } from '@atlas/service-bridge/protocol';
import { operatorCropRejection, operatorImageTransform } from '@atlas/service-bridge/operator-images';
import { operatorAdapters } from '../src/adapters.mjs';

function fixture(phase='CAPTURE_REVIEW') {
    const run={id:randomUUID(),leaseOwner:randomUUID(),leaseFence:1,revision:2,phase,
        workspaceCardId:randomUUID(),evidenceHash:'a'.repeat(64),expectedAnalysisRevision:1,specimenId:randomUUID()};
    const assets=['FRONT','BACK'].map(side=>({assetId:randomUUID(),sha256:side==='FRONT'?'b'.repeat(64):'c'.repeat(64),
        side,view:'ORIGINAL',width:3024,height:4032,byteCount:1000,contentType:'image/png'}));
    const analysis={sourceHash:'d'.repeat(64),reportHash:'e'.repeat(64),reportCanonical:canonical({findings:[]})};
    analysis.reportHash=digest(analysis.reportCanonical);
    const manifest=phase==='CAPTURE_REVIEW'?{version:'atlas-operator-capture-manifest-v1',phase,runId:run.id,
        workspaceCardId:run.workspaceCardId,claimId:randomUUID(),claimFence:1,captureRevision:1,workflowRevision:1,
        evidenceHash:run.evidenceHash,identity:{category:'POKEMON'},cornerShape:null,assets}
        :{sourceHash:analysis.sourceHash,reportHash:analysis.reportHash,assets};
    run.manifestHash=digest(canonical(manifest));
    const request={runId:run.id,expectedRevision:run.revision,evidenceHash:run.evidenceHash,manifestHash:run.manifestHash,
        assetId:assets[0].assetId,sourceSha256:assets[0].sha256,side:'FRONT',purpose:'CROP',rect:{x:3000,y:100,width:1900,height:620}};
    const {purpose,...args}=request,call={callId:'call_region',name:'inspect_region',args};
    const attemptId=randomUUID(),snapshot={run,manifest,call,attemptId},reads=[];
    const evidenceClient={async read(...args) { reads.push(args); return {verified:'synthetic'}; },verify() { throw new Error('unexpected image verification'); }};
    const adapters=operatorAdapters({evidenceClient}),data={...snapshot,attempt:{id:attemptId},now:new Date(),
        tx:{staffAnalysisRevision:{async findUnique() { return analysis; }}}};
    return {run,assets,analysis,manifest,request,snapshot,data,reads,evidenceClient,adapter:adapters.inspect_region};
}

test('a schema-valid outside crop returns a precise source-bound outcome before any image read',async()=>{
    for(const phase of ['CAPTURE_REVIEW','REPORT_REVIEW']) {
        const f=fixture(phase),prepared=await f.adapter.prepare(f.snapshot,{});
        const expected={status:'REGION_NOT_AVAILABLE',code:'ASTRA_CROP_OUTSIDE_SOURCE',assetId:f.assets[0].assetId,
            rect:f.request.rect,sourceWidth:3024,sourceHeight:4032};
        assert.deepEqual(operatorCropRejection(f.request,f.assets[0]),expected);
        assert.deepEqual(prepared.rejection,expected); assert.equal(f.reads.length,0);
        assert.deepEqual(await f.adapter.apply(f.data,prepared),{result:expected,images:[]});
        assert.equal(f.reads.length,0);
    }
});

test('an in-bounds 1900 by 620 crop is admitted normally and never turned into an unavailable result',async()=>{
    const f=fixture(); f.request.rect={x:500,y:700,width:1900,height:620}; f.snapshot.call.args.rect=f.request.rect;
    assert.equal(operatorCropRejection(f.request,f.assets[0]),null);
    assert.deepEqual(operatorImageTransform(f.request,f.assets[0],1).output,{width:1792,height:584});
    const prepared=await f.adapter.prepare(f.snapshot,{});
    assert.equal(prepared.rejection,undefined); assert.equal(f.reads.length,1);
    assert.deepEqual(f.reads[0][1],f.request);
});

test('region rejection cannot bypass asset identity, hashes, side, schema or prepared-outcome validation',async()=>{
    const f=fixture(),prepared=await f.adapter.prepare(f.snapshot,{});
    for(const field of ['sourceWidth','sourceHeight','assetId','code','status']) {
        const changed=structuredClone(prepared); changed.rejection[field]=field==='sourceWidth'||field==='sourceHeight'?1:'altered';
        await assert.rejects(f.adapter.apply(f.data,changed),/ASTRA_PREPARED_TOOL_CHANGED/);
    }
    const changedRect=structuredClone(prepared);changedRect.rejection.rect.x++;
    await assert.rejects(f.adapter.apply(f.data,changedRect),/ASTRA_PREPARED_TOOL_CHANGED/);
    await assert.rejects(f.adapter.apply(f.data,{...prepared,receipts:[]}),/ASTRA_PREPARED_TOOL_CHANGED/);
    await assert.rejects(f.adapter.apply(f.data,{...prepared,claims:{...prepared.claims,fence:2}}),/ASTRA_PREPARED_TOOL_CHANGED/);
    for(const change of [{sourceSha256:'f'.repeat(64)},{side:'BACK'},{assetId:randomUUID()}])
        assert.throws(()=>operatorCropRejection({...f.request,...change},f.assets[0]),/ASTRA_IMAGE_SCOPE_INVALID/);
    for(const rect of [{x:-1,y:0,width:1900,height:620},{x:0.5,y:0,width:1900,height:620},
        {x:0,y:0,width:0,height:620},{x:0,y:0,width:20001,height:620}])
        assert.throws(()=>operatorCropRejection({...f.request,rect},f.assets[0]),/ASTRA_IMAGE_REQUEST_INVALID/);
    assert.throws(()=>operatorCropRejection({...f.request,rect:{...f.request.rect,url:'https://untrusted.example'}},f.assets[0]));
    assert.throws(()=>operatorCropRejection({...f.request,purpose:'OVERVIEW'},f.assets[0]),/ASTRA_IMAGE_REQUEST_INVALID/);
    assert.equal(f.reads.length,0);
});

test('apply rechecks source dimensions and current report before committing a prepared crop rejection',async()=>{
    const f=fixture(),prepared=await f.adapter.prepare(f.snapshot,{});
    f.assets[0].width=5000;
    await assert.rejects(f.adapter.apply(f.data,prepared),/ASTRA_PREPARED_TOOL_CHANGED/);
    const g=fixture('REPORT_REVIEW'),reportPrepared=await g.adapter.prepare(g.snapshot,{});
    g.analysis.sourceHash='f'.repeat(64);
    await assert.rejects(g.adapter.apply(g.data,reportPrepared),/ASTRA_REPORT_CHANGED/);
});

test('unknown preparation and application failures retain safe stage codes and never become region rejections',async()=>{
    const f=fixture();f.snapshot.call.args.rect={x:500,y:700,width:1900,height:620};
    const privateText='token=must-not-escape https://private.example/object?signature=secret';
    f.evidenceClient.read=async()=>{throw new TypeError(privateText);};
    await assert.rejects(f.adapter.prepare(f.snapshot,{}),error=>{
        assert.equal(error.code,'ASTRA_TOOL_PREPARATION_FAILED');assert.equal(error.message,error.code);return true;
    });
    f.evidenceClient.read=async()=>{throw Object.assign(new Error(privateText),{code:'ASTRA_EVIDENCE_UNAVAILABLE'});};
    await assert.rejects(f.adapter.prepare(f.snapshot,{}),/ASTRA_EVIDENCE_UNAVAILABLE/);
    const g=fixture('REPORT_REVIEW'),prepared=await g.adapter.prepare(g.snapshot,{});
    g.data.tx.staffAnalysisRevision.findUnique=async()=>{throw new Error(privateText);};
    await assert.rejects(g.adapter.apply(g.data,prepared),error=>{
        assert.equal(error.code,'ASTRA_TOOL_APPLICATION_FAILED');assert.equal(error.message,error.code);return true;
    });
});
