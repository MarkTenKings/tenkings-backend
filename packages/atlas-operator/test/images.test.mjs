import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { canonical, digest } from '@atlas/service-bridge/protocol';
import { createOperatorImagePacket, OPERATOR_IMAGE_DECODER } from '@atlas/service-bridge/operator-images';
import { syntheticPng } from '../../atlas-contracts/test/fixtures.mjs';
import { appendToolResult, toolImageOutput } from '../src/responses.mjs';

function fixture() {
    const binding={runId:randomUUID(),expectedRevision:1,evidenceHash:'a'.repeat(64),manifestHash:'b'.repeat(64)};
    const images=['FRONT','BACK'].map((side,index)=>{
        const bytes=syntheticPng(8,10,index?50:200);
        const asset={assetId:randomUUID(),sha256:digest(bytes),side,view:'RECTIFIED',width:8,height:10,byteCount:bytes.length,contentType:'image/png'};
        const request={...binding,assetId:asset.assetId,sourceSha256:asset.sha256,side,purpose:'OVERVIEW',rect:{x:0,y:0,width:8,height:10}};
        const packet=createOperatorImagePacket({imageId:randomUUID(),request,asset,orientation:1,decoder:OPERATOR_IMAGE_DECODER,bytes});
        return {packet,asset};
    });
    const call={name:'read_card_report',callId:'call_images',args:binding};
    const response={output:[{type:'reasoning',encrypted_content:'synthetic-opaque'},
        {type:'function_call',name:call.name,call_id:call.callId,arguments:canonical(binding)}]};
    return {binding,images,call,response};
}
test('multimodal tool results retain the call and opaque continuation while carrying verified image objects',()=>{
    const f=fixture(),result={binding:{...f.binding,expectedRevision:2},reportHash:'c'.repeat(64)};
    const next=appendToolResult([{role:'user',content:'Synthetic inspection'}],f.response,f.call,result,f.images);
    assert.deepEqual(next.slice(1,3),f.response.output);
    const output=next.at(-1); assert.equal(output.type,'function_call_output'); assert.equal(output.call_id,f.call.callId);
    assert.equal(output.output[0].type,'input_text'); assert.deepEqual(JSON.parse(output.output[0].text),result);
    const images=output.output.filter(i=>i.type==='input_image'); assert.equal(images.length,2);
    for(let i=0;i<2;i++) { assert.equal(images[i].detail,'auto'); assert.equal(digest(Buffer.from(images[i].image_url.split(',')[1],'base64')),f.images[i].packet.sha256); }
    assert.equal(toolImageOutput(f.call,f.images).roster[0].sourceSha256,f.images[0].asset.sha256);
});
test('image tool results reject incomplete sides, changed revision and unauthorized output tools',()=>{
    const f=fixture();
    assert.throws(()=>toolImageOutput(f.call,[f.images[0]]));
    assert.throws(()=>toolImageOutput(f.call,[f.images[0],f.images[0]]));
    assert.throws(()=>toolImageOutput({...f.call,name:'propose_identity'},f.images));
    assert.throws(()=>toolImageOutput({...f.call,args:{...f.binding,expectedRevision:2}},f.images));
    const swapped=structuredClone(f.images); swapped[1].packet.bytesBase64=swapped[0].packet.bytesBase64;
    assert.throws(()=>toolImageOutput(f.call,swapped),/ASTRA_IMAGE_BYTES_CHANGED/);
});
test('crop output is bound to the exact requested source rectangle and image hash',()=>{
    const f=fixture(),image=f.images[0],request={...image.packet.request,purpose:'CROP'};
    image.packet=createOperatorImagePacket({imageId:randomUUID(),request,asset:image.asset,orientation:1,
        decoder:OPERATOR_IMAGE_DECODER,bytes:Buffer.from(image.packet.bytesBase64,'base64')});
    const call={...f.call,name:'inspect_region',args:{...f.binding,assetId:image.asset.assetId,sourceSha256:image.asset.sha256,side:'FRONT',rect:request.rect}};
    assert.equal(toolImageOutput(call,[image]).roster[0].purpose,'CROP');
    assert.throws(()=>toolImageOutput({...call,args:{...call.args,rect:{...request.rect,x:1}}},[image]),/ASTRA_IMAGE_TOOL_SCOPE_CHANGED/);
    assert.throws(()=>toolImageOutput({...call,args:{...call.args,sourceSha256:'f'.repeat(64)}},[image]),/ASTRA_IMAGE_TOOL_SCOPE_CHANGED/);
});
