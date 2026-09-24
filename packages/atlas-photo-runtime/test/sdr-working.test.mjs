import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { parseDecodedFrame } from '@atlas/photo-core';
import { verifyAndDecodePhoto, deriveSdrWorkingPhoto, describeDecodedFrame } from '../src/index.mjs';
import { code, request, sha256 } from './helpers.mjs';
import { cropProperty, gridFixture, withProperties } from './heif-fixture-helpers.mjs';

const fixture = name => readFile(new URL(`./fixtures/${name}`, import.meta.url));
const base = await fixture('colors-no-alpha.heic'), p3 = await fixture('DisplayP3-v4.icc');
const prof = Buffer.concat([Buffer.from('prof'), p3]);
const native = async (bytes = withProperties(base, [['colr', prof]]), overrides = {}) => verifyAndDecodePhoto(request(bytes, overrides));
const raw = png => sharp(png, { ignoreIcc: true }).raw().toBuffer();
const describe = result => describeDecodedFrame(result, { id: 'working-frame', object: { key: 'working/front.png', versionId: '1' } });

import { colorOracle } from './color-oracle.mjs';

test('P3 working conversion matches an independent ICC matrix/TRC oracle, without resizing or relabelling', async () => {
  const rich=await native(), before=Buffer.from(rich.png), working=await deriveSdrWorkingPhoto(rich);
  const input=await raw(rich.png), output=await raw(working.png), meta=await sharp(working.png).metadata();
  let max=0, changed=0;
  for(let i=0;i<input.length;i+=3){const expected=colorOracle(p3,meta.icc,[...input.subarray(i,i+3)]);
    for(let c=0;c<3;c++){max=Math.max(max,Math.abs(output[i+c]-expected[c]));if(output[i+c]!==input[i+c])changed++;}}
  assert.ok(max<=2,`ICC conversion error ${max}`); assert.ok(changed>input.length/20);
  assert.deepEqual(rich.png,before);
  assert.deepEqual(working.original,rich.original);assert.deepEqual(working.decodePlan,rich.decodePlan);
  assert.deepEqual(working.raster.dimensions,rich.raster.dimensions);assert.equal(meta.orientation,undefined);
  assert.equal(meta.channels,3);assert.equal(working.treatment.bitDepth,8);assert.equal(working.treatment.colorSpace,'sRGB');
  assert.equal(working.workingImage.sourceRaster.content.sha256,sha256(rich.png));
  assert.equal(working.workingImage.outputIccSha256,sha256(meta.icc));
  assert.equal(describe(working).schemaVersion,2);
});

test('working-image descriptor rejects source, transform, profile and treatment drift', async () => {
  const rich=await native(), result=await deriveSdrWorkingPhoto(rich), frame=describe(result);
  const mutations=[
    v=>v.workingImage.sourceRaster.dimensions.width++,v=>v.workingImage.sourceTreatment.channels=4,
    v=>v.workingImage.sourceTreatment.colorSpace=null,v=>v.workingImage.outputIccSha256='0'.repeat(64),
    v=>v.workingImage.geometryTreatment='resized',v=>v.treatment.hdrTreatment='not-present-x',
    v=>v.treatment.bitDepth=16,v=>v.sourceToFrame[2]++,v=>v.raster.object.key=rich.original.object.key,
  ];
  for(const mutate of mutations){const value=structuredClone(frame);mutate(value);assert.throws(()=>parseDecodedFrame(value,rich.original,rich.decodePlan));}
  const tampered={...result,png:Buffer.from(result.png)};tampered.png[tampered.png.length-1]^=1;
  assert.throws(()=>describe(tampered),code('PHOTO_SOURCE_MISMATCH'));
  await assert.rejects(deriveSdrWorkingPhoto(result),code('PHOTO_SOURCE_MISMATCH'));
});

test('all qualified native orientation/mirror frames keep dimensions and exact source-to-working transform',async()=>{
  const transforms=[[],[['imir',Buffer.from([1])]],[['irot',Buffer.from([2])]],[['imir',Buffer.from([0])]],
    [['irot',Buffer.from([1])],['imir',Buffer.from([0])]], [['irot',Buffer.from([3])]],
    [['irot',Buffer.from([3])],['imir',Buffer.from([0])]], [['irot',Buffer.from([1])]]];
  for (const operations of transforms) {
    const bytes=gridFixture(base,{padding:[0,16],color:prof,primaryProperties:[cropProperty(104,88),...operations]});
    const rich=await native(bytes),result=await deriveSdrWorkingPhoto(rich),frame=describe(result);
    assert.deepEqual(frame.sourceToFrame,rich.decodePlan.geometry.matrix);assert.deepEqual(frame.raster.dimensions,rich.raster.dimensions);
    const expected=await sharp(rich.png).withIccProfile('srgb').raw().toBuffer();
    assert.deepEqual(await raw(result.png),expected);
  }
});

test('sRGB RGB8 has no pixel loss and 10/12-bit P3 rich originals remain separate from quantized working RGB8',async()=>{
  const srgb=Buffer.concat([Buffer.from('prof'),await fixture('sRGB-v4.icc')]);
  const rich=await native(withProperties(base,[['colr',srgb]])),working=await deriveSdrWorkingPhoto(rich);
  assert.deepEqual(await raw(working.png),await raw(rich.png));
  for(const depth of [10,12]){
    const high=await native(withProperties(await fixture(`rgb${depth}.heic`),[['colr',prof]]));
    const before=sha256(high.png),low=await deriveSdrWorkingPhoto(high);
    assert.equal(high.treatment.bitDepth,16);assert.equal(low.treatment.bitDepth,8);
    assert.equal(low.workingImage.sourceTreatment.bitDepth,16);assert.equal(sha256(high.png),before);
  }
});

test('working conversion refuses alpha, unmanaged color, changed bytes and unsupported HDR claims',async()=>{
  await assert.rejects(deriveSdrWorkingPhoto(await native(base)),code('PHOTO_COLOR_UNSUPPORTED'));
  const png=await sharp({create:{width:8,height:8,channels:4,background:{r:1,g:2,b:3,alpha:.5}}}).png().toBuffer();
  await assert.rejects(deriveSdrWorkingPhoto(await verifyAndDecodePhoto(request(png))),code('PHOTO_COLOR_UNSUPPORTED'));
  const rich=await native(),bad={...rich,png:Buffer.from(rich.png)};bad.png[bad.png.length-1]^=1;
  await assert.rejects(deriveSdrWorkingPhoto(bad),code('PHOTO_SOURCE_MISMATCH'));
  for(const policy of [true,'ignore-hdr','',{}]) await assert.rejects(verifyAndDecodePhoto(request(base,{heicHdrPolicy:policy})),code('PHOTO_HDR_UNSUPPORTED'));
});

test('working-image bounds, cancellation and timeout fail without reducing quality',async()=>{
  const rich=await native();
  for (const limits of [{...rich.decodePlan.limits,maxInputBytes:rich.png.length-1},
    {...rich.decodePlan.limits,maxPixels:10},{...rich.decodePlan.limits,maxRasterBytes:10},
    {...rich.decodePlan.limits,maxOutputBytes:10}]) await assert.rejects(deriveSdrWorkingPhoto(rich,{limits}),code('PHOTO_DECODE_LIMIT'));
  await assert.rejects(deriveSdrWorkingPhoto(rich,{limits:{...rich.decodePlan.limits,timeoutMs:1}}),code('PHOTO_DECODE_TIMEOUT'));
  await assert.rejects(deriveSdrWorkingPhoto(rich,{signal:AbortSignal.abort()}),code('PHOTO_DECODE_CANCELLED'));
});

test('working conversion snapshots bytes, descriptors and limits before its first await',async()=>{
  const rich=await native(),expected=await deriveSdrWorkingPhoto(rich),limits={...rich.decodePlan.limits};
  const inFlight=deriveSdrWorkingPhoto(rich,{limits});
  rich.png.fill(0);rich.raster.content.sha256='0'.repeat(64);rich.treatment.colorSpace='untrusted';limits.maxOutputBytes=1;
  const actual=await inFlight;assert.deepEqual(actual.png,expected.png);assert.deepEqual(describe(actual),describe(expected));
});
