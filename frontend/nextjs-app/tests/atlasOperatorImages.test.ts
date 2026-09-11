import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { renderAtlasOperatorImage } from '../lib/server/atlasOperatorImages';
import { canonical, digest } from '@atlas/service-bridge/protocol';
import { IMAGE_TRANSFORM, LEGACY_IMAGE_TRANSFORM, MAX_OPERATOR_CROP_PIXELS, OPERATOR_IMAGE_DECODER, operatorImageTransform, parseOperatorImagePacket,
    type OperatorImageAsset, type OperatorImageRequest } from '@atlas/service-bridge/operator-images';
import { operatorEvidenceClient, MAX_OPERATOR_EVIDENCE_RESPONSE_BYTES } from '@atlas/service-bridge/operator-evidence';

function pixels(width: number,height: number) {
    const data=Buffer.alloc(width*height*3);
    for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
        const i=(y*width+x)*3; data[i]=x%256; data[i+1]=y%256; data[i+2]=(x+y)%256;
    }
    return data;
}
async function fixture(width=128,height=96) {
    const raw=pixels(width,height), sourceBytes=await sharp(raw,{raw:{width,height,channels:3}}).png().toBuffer();
    const asset: OperatorImageAsset={assetId:randomUUID(),sha256:digest(sourceBytes),side:'FRONT',view:'RECTIFIED',width,height,byteCount:sourceBytes.length,contentType:'image/png'};
    const request: OperatorImageRequest={runId:randomUUID(),expectedRevision:1,evidenceHash:'a'.repeat(64),manifestHash:'b'.repeat(64),
        assetId:asset.assetId,sourceSha256:asset.sha256,side:'FRONT',purpose:'CROP',rect:{x:17,y:11,width:19,height:13}};
    return {sourceBytes,asset,request,raw};
}
function pngChunk(type: string,data: Buffer) {
    const bytes=Buffer.alloc(data.length+12); bytes.writeUInt32BE(data.length); bytes.write(type,4); data.copy(bytes,8);
    let crc=0xffffffff;
    for(const byte of bytes.subarray(4,-4)) {
        crc ^= byte;
        for(let bit=0;bit<8;bit++) crc=(crc>>>1)^((crc&1)?0xedb88320:0);
    }
    bytes.writeUInt32BE((crc^0xffffffff)>>>0,bytes.length-4); return bytes;
}
function pngChunks(bytes: Buffer) {
    const result: {type:string;bytes:Buffer;data:Buffer}[]=[];
    for(let offset=8;offset<bytes.length;) {
        const length=bytes.readUInt32BE(offset);
        result.push({type:bytes.toString('ascii',offset+4,offset+8),bytes:bytes.subarray(offset,offset+length+12),data:bytes.subarray(offset+8,offset+length+8)});
        offset+=length+12;
    }
    return result;
}
async function animatedPng() {
    const png=async(background:string)=>pngChunks(await sharp({create:{width:8,height:10,channels:3,background}}).png().toBuffer());
    const first=await png('red'),second=await png('blue'),animation=Buffer.alloc(8);
    animation.writeUInt32BE(2);
    const frame=(sequence:number)=>{
        const control=Buffer.alloc(26); control.writeUInt32BE(sequence); control.writeUInt32BE(8,4); control.writeUInt32BE(10,8);
        control.writeUInt16BE(1,20); control.writeUInt16BE(2,22); return pngChunk('fcTL',control);
    };
    const secondData=Buffer.concat([Buffer.alloc(4),...second.filter(chunk=>chunk.type==='IDAT').map(chunk=>chunk.data)]);
    secondData.writeUInt32BE(2);
    return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),first[0].bytes,pngChunk('acTL',animation),frame(0),
        ...first.filter(chunk=>chunk.type==='IDAT').map(chunk=>chunk.bytes),frame(1),pngChunk('fdAT',secondData),first.at(-1)!.bytes]);
}
test('operator crop contains the exact unannotated source pixels with immutable lineage',async()=>{
    const f=await fixture(), preserved=Buffer.from(f.sourceBytes), packet=await renderAtlasOperatorImage(f);
    assert.equal(packet.decoder,OPERATOR_IMAGE_DECODER);
    const parsed=parseOperatorImagePacket(packet,f.request,f.asset), output=await sharp(parsed.bytes).raw().toBuffer({resolveWithObject:true});
    assert.equal(output.info.channels,3); assert.equal(output.info.width,19); assert.equal(output.info.height,13);
    for(let y=0;y<13;y++) for(let x=0;x<19;x++) {
        const actual=(y*19+x)*3, expected=((y+11)*128+x+17)*3;
        assert.deepEqual(output.data.subarray(actual,actual+3),f.raw.subarray(expected,expected+3));
    }
    assert.deepEqual(f.sourceBytes,preserved);
    const repeat=await renderAtlasOperatorImage(f); assert.equal(repeat.sha256,packet.sha256); assert.equal(repeat.transformHash,packet.transformHash);
    assert.notEqual(repeat.imageId,packet.imageId); assert.equal(parsed.transform.annotations,'NONE');
});
test('original JPEG crop coordinates follow preserved EXIF orientation, verified by manual pixel mapping',async()=>{
    const width=12,height=8, sourceBytes=await sharp(pixels(width,height),{raw:{width,height,channels:3}})
        .withMetadata({orientation:6}).jpeg({quality:100,chromaSubsampling:'4:4:4'}).toBuffer();
    const raw=await sharp(sourceBytes).raw().toBuffer({resolveWithObject:true});
    assert.equal(raw.info.width,width); assert.equal(raw.info.height,height);
    const asset: OperatorImageAsset={assetId:randomUUID(),sha256:digest(sourceBytes),side:'BACK',view:'ORIGINAL',width:height,height:width,byteCount:sourceBytes.length,contentType:'image/jpeg'};
    const request: OperatorImageRequest={runId:randomUUID(),expectedRevision:2,evidenceHash:'a'.repeat(64),manifestHash:'b'.repeat(64),
        assetId:asset.assetId,sourceSha256:asset.sha256,side:'BACK',purpose:'CROP',rect:{x:1,y:2,width:3,height:4}};
    const packet=await renderAtlasOperatorImage({sourceBytes,asset,request});
    assert.equal(JSON.parse(packet.transformCanonical).exifOrientation,6);
    const out=await sharp(Buffer.from(packet.bytesBase64,'base64')).raw().toBuffer({resolveWithObject:true});
    assert.equal(out.info.width,3); assert.equal(out.info.height,4);
    for(let y=0;y<4;y++) for(let x=0;x<3;x++) {
        const sourceX=y+2,sourceY=height-1-(x+1), index=(sourceY*width+sourceX)*3;
        assert.deepEqual(out.data.subarray((y*3+x)*3,(y*3+x)*3+3),raw.data.subarray(index,index+3));
    }
    assert.equal((await sharp(Buffer.from(packet.bytesBase64,'base64')).metadata()).orientation,undefined);
});
test('overview includes the full side and large crops retain an explicit source-to-output transform',async()=>{
    const f=await fixture(2048,1024);
    const request={...f.request,purpose:'OVERVIEW' as const,rect:{x:0,y:0,width:2048,height:1024}};
    const packet=await renderAtlasOperatorImage({...f,request}); assert.equal(packet.width,1024); assert.equal(packet.height,512);
    assert.equal(JSON.parse(packet.transformCanonical).rect.width,2048);
    const crop=await renderAtlasOperatorImage({...f,request:{...request,purpose:'CROP'}});
    assert.equal(crop.width,1448); assert.equal(crop.height,724);
    assert.equal(JSON.parse(crop.transformCanonical).version,IMAGE_TRANSFORM);
    assert.deepEqual(JSON.parse(crop.transformCanonical).rect,request.rect);
    await assert.rejects(()=>renderAtlasOperatorImage({...f,request:{...request,rect:{x:1,y:0,width:2047,height:1024}}}),/ASTRA_OVERVIEW_INCOMPLETE/);
});
test('the live 1900 by 620 request delivers its entire exact source region within the output limit',async()=>{
    const f=await fixture(2048,1024),preserved=Buffer.from(f.sourceBytes);
    const rect={x:74,y:101,width:1900,height:620},request={...f.request,rect};
    const packet=await renderAtlasOperatorImage({...f,request}),parsed=parseOperatorImagePacket(packet,request,f.asset);
    assert.equal(rect.width*rect.height,1_178_000); assert.equal(packet.width,1792); assert.equal(packet.height,584);
    assert(packet.width*packet.height<=MAX_OPERATOR_CROP_PIXELS);
    assert.deepEqual(parsed.transform.rect,rect); assert.deepEqual(parsed.transform.output,{width:1792,height:584});
    assert.equal(parsed.transform.sourceSha256,f.asset.sha256); assert.equal(parsed.transform.sourceAssetId,f.asset.assetId);
    assert.equal(parsed.transform.version,IMAGE_TRANSFORM); assert.deepEqual(f.sourceBytes,preserved);
    // Select the pixels by row offsets, independently of the renderer's Sharp
    // extract operation, then compare the versioned resampling exactly.
    const selected=Buffer.concat(Array.from({length:rect.height},(_,row)=>{
        const offset=((rect.y+row)*f.asset.width+rect.x)*3;
        return f.raw.subarray(offset,offset+rect.width*3);
    }));
    const expected=await sharp(selected,{raw:{width:rect.width,height:rect.height,channels:3}})
        .resize(1792,584,{fit:'fill',kernel:'lanczos3',withoutEnlargement:true}).raw().toBuffer();
    assert.deepEqual(await sharp(parsed.bytes).raw().toBuffer(),expected);
    const repeat=await renderAtlasOperatorImage({...f,request});
    assert.equal(repeat.sha256,packet.sha256); assert.equal(repeat.transformHash,packet.transformHash);
    const changed={...parsed.transform,version:LEGACY_IMAGE_TRANSFORM},transformCanonical=canonical(changed);
    assert.throws(()=>parseOperatorImagePacket({...packet,transformCanonical,transformHash:digest(transformCanonical)},request,f.asset),/ASTRA_CROP_TOO_LARGE/);
});
test('saved v1 native crops and overviews keep their original transform hashes and bytes',async()=>{
    const f=await fixture(2048,1024);
    for(const request of [f.request,{...f.request,purpose:'OVERVIEW' as const,rect:{x:0,y:0,width:2048,height:1024}}]) {
        const packet=await renderAtlasOperatorImage({...f,request});
        const legacy=operatorImageTransform(request,f.asset,1,LEGACY_IMAGE_TRANSFORM),transformCanonical=canonical(legacy);
        const saved={...packet,transformCanonical,transformHash:digest(transformCanonical)},before=canonical(saved);
        const parsed=parseOperatorImagePacket(saved,request,f.asset);
        assert.equal(parsed.transform.version,LEGACY_IMAGE_TRANSFORM); assert.equal(canonical(saved),before);
        assert.equal(parsed.packet.sha256,packet.sha256); assert.deepEqual(parsed.transform.output,{width:packet.width,height:packet.height});
    }
});
test('bounded crop dimensions cover square rounding and extreme aspect ratios without enlargement',async()=>{
    const f=await fixture();
    for(const [width,height] of [[1024,1024],[1024,1025],[1025,1024],[1025,1025],[1793,585],[8192,8192],[20000,3355],[3355,20000],[20000,1],[1,20000]]) {
        const asset={...f.asset,width:Math.max(2,width),height:Math.max(2,height)};
        const request={...f.request,rect:{x:0,y:0,width,height}},transform=operatorImageTransform(request,asset,1);
        assert(transform.output.width*transform.output.height<=MAX_OPERATOR_CROP_PIXELS);
        assert(transform.output.width<=width && transform.output.height<=height);
        assert.deepEqual(transform.rect,request.rect);
        if(width*height<=MAX_OPERATOR_CROP_PIXELS) assert.deepEqual(transform.output,{width,height});
    }
});
test('crop admission rejects wrong source, dimensions, side, URL fields and out-of-bounds rectangles',async()=>{
    const f=await fixture();
    await assert.rejects(()=>renderAtlasOperatorImage({...f,sourceBytes:Buffer.concat([f.sourceBytes,Buffer.from('changed')])}),/ASTRA_SOURCE_BYTES_CHANGED/);
    await assert.rejects(()=>renderAtlasOperatorImage({...f,asset:{...f.asset,width:127}}),/ASTRA_SOURCE_DIMENSIONS_CHANGED/);
    for(const rect of [{x:-1,y:0,width:1,height:1},{x:127,y:0,width:2,height:1},{x:1.5,y:0,width:1,height:1},{x:0,y:95,width:1,height:2}])
        await assert.rejects(()=>renderAtlasOperatorImage({...f,request:{...f.request,rect}}),/ASTRA_CROP_OUTSIDE_SOURCE/);
    await assert.rejects(()=>renderAtlasOperatorImage({...f,request:{...f.request,side:'BACK'}}),/ASTRA_IMAGE_SCOPE_INVALID/);
    assert.throws(()=>operatorImageTransform({...f.request,url:'https://elsewhere.example'} as OperatorImageRequest,f.asset,1));
});
test('PNG packet rejects substituted bytes, dimensions, transform or decoder identity',async()=>{
    const f=await fixture(),packet=await renderAtlasOperatorImage(f);
    for(const change of [{sha256:'c'.repeat(64)},{width:1},{bytesBase64:packet.bytesBase64+'='},{decoder:'sharp-0.34.5/vips-8.17.3'}])
        assert.throws(()=>parseOperatorImagePacket({...packet,...change},f.request,f.asset));
    const transform=JSON.parse(packet.transformCanonical); transform.annotations='MODEL_MARKINGS';
    const transformCanonical=canonical(transform);
    assert.throws(()=>parseOperatorImagePacket({...packet,transformCanonical,transformHash:digest(transformCanonical)},f.request,f.asset),/ASTRA_IMAGE_TRANSFORM_CHANGED/);
    const unknown=canonical({...JSON.parse(packet.transformCanonical),version:'unreviewed-transform'});
    assert.throws(()=>parseOperatorImagePacket({...packet,transformCanonical:unknown,transformHash:digest(unknown)},f.request,f.asset),/ASTRA_IMAGE_TRANSFORM_UNSUPPORTED/);
    assert.throws(()=>parseOperatorImagePacket({...packet,transformCanonical:'{',transformHash:digest('{')},f.request,f.asset),/ASTRA_IMAGE_TRANSFORM_INVALID/);
});
test('unsupported content, truncated rasters and cancellation cannot produce an image receipt',async()=>{
    const f=await fixture(),svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="96"></svg>');
    const altered={...f.asset,sha256:digest(svg),byteCount:svg.length};
    await assert.rejects(()=>renderAtlasOperatorImage({...f,sourceBytes:svg,asset:altered,request:{...f.request,sourceSha256:altered.sha256}}),/ASTRA_SOURCE_FORMAT_INVALID/);
    const cut=f.sourceBytes.subarray(0,f.sourceBytes.length-35),asset={...f.asset,sha256:digest(cut),byteCount:cut.length};
    await assert.rejects(()=>renderAtlasOperatorImage({...f,sourceBytes:cut,asset,request:{...f.request,sourceSha256:asset.sha256}}));
    const controller=new AbortController(); controller.abort(new Error('SYNTHETIC_CANCELLED'));
    await assert.rejects(()=>renderAtlasOperatorImage({...f,signal:controller.signal}),/SYNTHETIC_CANCELLED/);
});
test('valid animated PNG is rejected even when the decoder reports only its first frame',async()=>{
    const sourceBytes=await animatedPng(),f=await fixture(8,10),request={...f.request,rect:{x:0,y:0,width:8,height:10}};
    // This pinned decoder accepts this complete two-frame APNG as a plain PNG.
    assert.equal((await sharp(sourceBytes).metadata()).pages,undefined);
    await sharp(sourceBytes).stats();
    const asset={...f.asset,view:'ORIGINAL' as const,sha256:digest(sourceBytes),byteCount:sourceBytes.length};
    await assert.rejects(()=>renderAtlasOperatorImage({sourceBytes,asset,request:{...request,sourceSha256:asset.sha256}}),/ASTRA_SOURCE_ANIMATION_UNSUPPORTED/);
    const packet=await renderAtlasOperatorImage({...f,request});
    assert.throws(()=>parseOperatorImagePacket({...packet,bytesBase64:sourceBytes.toString('base64'),
        byteCount:sourceBytes.length,sha256:digest(sourceBytes)},request,f.asset),/ASTRA_SOURCE_ANIMATION_UNSUPPORTED/);
});
test('a full-size noisy RGB crop fits the bounded signed HTTP response without shrinking pixels',async()=>{
    const width=1024,height=1024,raw=Buffer.alloc(width*height*3);let seed=0x912a44bf;
    for(let i=0;i<raw.length;i++) {seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;raw[i]=seed&255;}
    const sourceBytes=await sharp(raw,{raw:{width,height,channels:3}}).png().toBuffer();
    const asset:OperatorImageAsset={assetId:randomUUID(),sha256:digest(sourceBytes),side:'FRONT',view:'ORIGINAL',width,height,byteCount:sourceBytes.length,contentType:'image/png'};
    const request:OperatorImageRequest={runId:randomUUID(),expectedRevision:1,evidenceHash:'a'.repeat(64),manifestHash:'b'.repeat(64),
        assetId:asset.assetId,sourceSha256:asset.sha256,side:'FRONT',purpose:'CROP',rect:{x:0,y:0,width,height}};
    const packet=await renderAtlasOperatorImage({sourceBytes,asset,request});
    const scope={runId:request.runId,owner:randomUUID(),fence:1,revision:1,attemptId:randomUUID(),callId:'call_noisy_crop'};
    const key=randomBytes(32),runtimeHash='c'.repeat(64),sourceHash='d'.repeat(64);let size=0;
    const client=operatorEvidenceClient({origin:'https://synthetic-images.example.test',key,runtimeHash},async(_url:string,init:RequestInit)=>{
        const claims=JSON.parse(init.body as string),value={purpose:'atlas-operator-evidence-receipt-v1',runtimeHash,scope,request,
            requestHash:digest(init.body as string),expiresAt:claims.expiresAt,evidenceHash:request.evidenceHash,manifestHash:request.manifestHash,sourceHash,image:packet};
        const body=canonical(value);size=Buffer.byteLength(body);
        return new Response(body,{status:200,headers:{'content-type':'application/json','x-atlas-operator-evidence-signature':createHmac('sha256',key).update(body).digest('hex')}});
    });
    const receipt=await client.read(scope,request);
    const verified=client.verify(receipt,scope,request,{runtimeHash,evidenceHash:request.evidenceHash,manifestHash:request.manifestHash,manifestCanonical:canonical({sourceHash})});
    assert(size>4*1024*1024);assert(size<=MAX_OPERATOR_EVIDENCE_RESPONSE_BYTES);assert(MAX_OPERATOR_EVIDENCE_RESPONSE_BYTES<4_500_000);
    const decoded=await sharp(Buffer.from(verified.image.bytesBase64,'base64')).raw().toBuffer();
    assert.deepEqual(decoded,raw);assert.equal(packet.width,1024);assert.equal(packet.height,1024);
});
