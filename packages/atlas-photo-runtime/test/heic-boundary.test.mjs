import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import sharp from 'sharp';
import { verifyAndDecodePhoto, describeDecodedFrame } from '../src/index.mjs';
import { code, limits, orient, request, sha256 } from './helpers.mjs';
import { box, cropProperty, gridFixture, primaryVariant, withProperties } from './heif-fixture-helpers.mjs';

const fixture = name => readFile(new URL(`./fixtures/${name}`,import.meta.url));
const raw = png => sharp(png).raw().toBuffer();
const base = await fixture('colors-no-alpha.heic');
for (const [name,checksum] of [
  ['colors-no-alpha.heic','76f82ffc717a647b1c9c2551e5ea0545832a2d3216c7540f7e5b092282a04b63'],
  ['colors-no-alpha-thumbnail.heic','b610c6224a5cbd1f57122ee0adae4ba38b952a22fe72e9cfaf5dfad93513dc2f'],
]) test(`real HEVC ${name}: full-size primary decode with exact original retention`,async()=>{
  const bytes=await fixture(name); assert.equal(sha256(bytes),checksum);
  const result=await verifyAndDecodePhoto(request(bytes));
  assert.equal(result.original.content.mime,'image/heic'); assert.equal(result.original.content.sha256,checksum);
  assert.deepEqual(result.original.metadata.selection,{kind:'primary-still-image',itemId:'1'});
  assert.equal(result.treatment.bitDepth,8); assert.equal(result.treatment.colorSpace,null);
  assert.equal(result.treatment.colorTreatment,'unmanaged'); assert.equal(result.treatment.hdrTreatment,'unknown');
  assert.equal(sha256(bytes),checksum);
  const descriptor=describeDecodedFrame(result,{id:'decoded',object:{key:'decoded/frame.png',versionId:'v1'}});
  assert.deepEqual(descriptor.raster.dimensions,result.original.metadata.encoded);
});

test('the second top-level item is selected when pitm designates it',async()=>{
  const bytes=await fixture('two-images.heic'); assert.equal(sha256(bytes),'7f8b363e4936c0666a25f64f3a92fda10bd8e5453be4592530b65a55dd98f3f2');
  const larger={...limits,maxPixels:2_000_000,maxRasterBytes:16_000_000};
  const first=await verifyAndDecodePhoto(request(bytes,{limits:larger}));
  const second=await verifyAndDecodePhoto(request(primaryVariant(bytes,20006),{limits:larger}));
  assert.equal(first.original.metadata.selection.itemId,'20004'); assert.equal(second.original.metadata.selection.itemId,'20006');
  assert.notEqual(first.raster.content.sha256,second.raster.content.sha256);
  assert.deepEqual(second.raster.dimensions,{width:1280,height:854});
});

// Expectations use independent integer permutations, never photo-core's matrices.
const transformations=[[],[['imir',Buffer.from([1])]], [['irot',Buffer.from([2])]],
  [['imir',Buffer.from([0])]], [['irot',Buffer.from([1])],['imir',Buffer.from([0])]],
  [['irot',Buffer.from([3])]], [['irot',Buffer.from([3])],['imir',Buffer.from([0])]], [['irot',Buffer.from([1])]]];
for(let orientation=1;orientation<=8;orientation++) test(`HEIF crop, rotation and mirror orientation ${orientation} apply exactly once`,async()=>{
  const original=await verifyAndDecodePhoto(request(base)), originalPixels=await raw(original.png);
  const cropped=Buffer.alloc(48*32*3);
  for(let y=0;y<32;y++) originalPixels.copy(cropped,y*48*3,((y+16)*64+8)*3,((y+16)*64+56)*3);
  const bytes=withProperties(base,[cropProperty(48,32),...transformations[orientation-1]]);
  const result=await verifyAndDecodePhoto(request(bytes));
  assert.equal(result.decodePlan.metadata.orientation,orientation);
  assert.deepEqual(result.decodePlan.metadata.crop,{x:8,y:16,width:48,height:32});
  assert.deepEqual(await raw(result.png),orient(cropped,48,32,3,orientation));
  assert.equal((await sharp(result.png).metadata()).orientation,undefined);
});

for(const depth of [10,12]) test(`genuine HEVC ${depth}-bit source retains more than 256 sample levels in16-bit PNG`,async()=>{
  const bytes=await fixture(`rgb${depth}.heic`),result=await verifyAndDecodePhoto(request(bytes));
  assert.equal(sha256(bytes),depth===10?'7fbf1573c1e5c1693953b31bb287327c53eaefa74a6f1324e7391a08b3ed1e73':'92c048d4bead7eebd3e0da5cb13a2e286cccbde3acb23580ee9c5f6b4cfde812');
  assert.equal(result.original.metadata.bitDepth,depth); assert.equal(result.treatment.bitDepth,16);
  assert.deepEqual(result.raster.dimensions,{width:128,height:128});
  const idat=[];for(let at=8;at<result.png.length;){const n=result.png.readUInt32BE(at);if(result.png.toString('ascii',at+4,at+8)==='IDAT')idat.push(result.png.subarray(at+8,at+8+n));at+=n+12;}
  const rows=inflateSync(Buffer.concat(idat)),samples=new Set();
  assert.equal(rows.length,128*(1+128*6));
  for(let y=0;y<128;y++){assert.equal(rows[y*769],0);for(let x=0;x<128*3;x++) samples.add(rows.readUInt16BE(y*769+1+x*2));}
  assert.ok(samples.size>256,`retained ${samples.size} sample levels`);
  assert.equal(sha256(bytes),result.original.content.sha256);
});

test('NCLX sRGB is observed and its output is explicitly tagged',async()=>{
  const nclx=Buffer.from('6e636c780001000d000680','hex');
  const result=await verifyAndDecodePhoto(request(withProperties(base,[['colr',nclx]])));
  assert.equal(result.original.metadata.colorSpace,'NCLX:1/13/6/1'); assert.equal(result.original.metadata.dynamicRange,'SDR');
  assert.equal(result.treatment.colorSpace,'sRGB'); assert.equal(result.treatment.hdrTreatment,'not-present');
  assert.ok(result.png.includes(Buffer.from('sRGB')));
});

test('unqualified HDR, wide-gamut color and fractional crop fail explicitly',async()=>{
  for(const transfer of [16,18]){
    const nclx=Buffer.from('6e636c780001000d000680','hex');nclx.writeUInt16BE(transfer,6);
    await assert.rejects(verifyAndDecodePhoto(request(withProperties(base,[['colr',nclx]]))),code('PHOTO_HDR_UNSUPPORTED'));
  }
  const p3=Buffer.from('6e636c78000c000d000680','hex');
  await assert.rejects(verifyAndDecodePhoto(request(withProperties(base,[['colr',p3]]))),code('PHOTO_COLOR_UNSUPPORTED'));
  const crop=cropProperty(48,32);crop[1].writeUInt32BE(3,20);crop[1].writeInt32BE(1,16);
  await assert.rejects(verifyAndDecodePhoto(request(withProperties(base,[crop]))),code('PHOTO_GEOMETRY_UNSUPPORTED'));
});

test('HEIC limits, changed metadata, malformed data and movie sequences cannot silently succeed',async()=>{
  await assert.rejects(verifyAndDecodePhoto(request(base,{limits:{...limits,maxPixels:4000}})),code('PHOTO_DECODE_LIMIT'));
  await assert.rejects(verifyAndDecodePhoto(request(base,{limits:{...limits,maxRasterBytes:64*64*8-1}})),code('PHOTO_DECODE_LIMIT'));
  await assert.rejects(verifyAndDecodePhoto(request(base,{limits:{...limits,maxOutputBytes:100}})),code('PHOTO_DECODE_LIMIT'));
  const result=await verifyAndDecodePhoto(request(base)),old=structuredClone(result.original);old.metadata.orientation=6;old.metadata.orientationSource='heif-properties';
  await assert.rejects(verifyAndDecodePhoto(request(base,{existingOriginal:old})),code('PHOTO_SOURCE_MISMATCH'));
  await assert.rejects(verifyAndDecodePhoto(request(base.subarray(0,-1))),code('PHOTO_DECODE_INVALID'));
  await assert.rejects(verifyAndDecodePhoto(request(Buffer.concat([base,box('moov',Buffer.alloc(0))]))),code('PHOTO_MULTIFRAME_UNSUPPORTED'));
});

test('an unrelated BMFF codec is not mislabeled as HEIC',async()=>{
  const ftyp=Buffer.from('00000018667479706176696600000000617669666d696631','hex');
  await assert.rejects(verifyAndDecodePhoto(request(ftyp)),code('PHOTO_FORMAT_UNSUPPORTED'));
});

test('unknown accepted metadata stays immutable and an auxiliary alpha image is refused',async()=>{
  const decoded=await verifyAndDecodePhoto(request(base)), existing=structuredClone(decoded.original);
  existing.metadata=null;
  const replay=await verifyAndDecodePhoto(request(base,{existingOriginal:existing}));
  assert.deepEqual(replay.original,existing); assert.equal(replay.decodePlan.metadata.bitDepth,8);
  assert.equal(replay.raster.content.sha256,decoded.raster.content.sha256);
  const alpha=await fixture('colors-with-alpha.heic'),prior=sha256(alpha);
  await assert.rejects(verifyAndDecodePhoto(request(alpha)),code('PHOTO_HEIC_UNSUPPORTED'));
  assert.equal(sha256(alpha),prior);
});

for(const depth of [8,10,12]) test(`genuine HEVC ${depth}-bit tiles assemble a complete grid with exact crop and orientation`,async()=>{
  const source=depth===8?base:await fixture(`rgb${depth}.heic`);
  const original=await verifyAndDecodePhoto(request(source));
  const channels=depth===8?3:6;
  const pixels=depth===8?await raw(original.png):unfilteredPixels(original.png);
  const tw=original.raster.dimensions.width,th=original.raster.dimensions.height;
  const width=tw*2,height=th*2,cw=width-24,ch=height-24;
  const expected=Buffer.alloc(cw*ch*channels);
  for(let y=0;y<ch;y++)for(let x=0;x<cw;x++){
    const at=(((y+12)%th)*tw+(x+12)%tw)*channels;
    pixels.copy(expected,(y*cw+x)*channels,at,at+channels);
  }
  const result=await verifyAndDecodePhoto(request(gridFixture(source,{
    primaryProperties:[cropProperty(cw,ch),['irot',Buffer.from([3])]],padding:[0,0]
  })));
  assert.equal(result.original.metadata.selection.itemId,'5');
  assert.deepEqual(result.original.metadata.encoded,{width,height});
  assert.deepEqual(result.decodePlan.metadata.crop,{x:12,y:12,width:cw,height:ch});
  assert.equal(result.decodePlan.metadata.orientation,6);
  const observed=depth===8?await raw(result.png):unfilteredPixels(result.png);
  assert.deepEqual(observed,orient(expected,cw,ch,channels,6));
});

test('grid tile transforms and inconsistent tile color are refused before raster adoption',async()=>{
  const srgb=Buffer.from('6e636c780001000d000680','hex'),p3=Buffer.from('6e636c78000c000d000680','hex');
  const result=await verifyAndDecodePhoto(request(gridFixture(base,{color:srgb})));
  assert.equal(result.original.metadata.colorSpace,'NCLX:1/13/6/1');
  assert.deepEqual(result.raster.dimensions,{width:125,height:123});
  await assert.rejects(verifyAndDecodePhoto(request(gridFixture(base,{primaryProperties:[['irot',Buffer.from([3])]]}))),code('PHOTO_GEOMETRY_UNSUPPORTED'));
  await assert.rejects(verifyAndDecodePhoto(request(gridFixture(base,{color:srgb,tileColor:p3}))),code('PHOTO_COLOR_UNSUPPORTED'));
  await assert.rejects(verifyAndDecodePhoto(request(gridFixture(base,{tileProperties:[['irot',Buffer.from([1])]]}))),code('PHOTO_GEOMETRY_UNSUPPORTED'));
});

function unfilteredPixels(png){
  const width=png.readUInt32BE(16),height=png.readUInt32BE(20),channels=png[24]===16?6:3,idat=[];
  for(let at=8;at<png.length;){const n=png.readUInt32BE(at);if(png.toString('ascii',at+4,at+8)==='IDAT')idat.push(png.subarray(at+8,at+8+n));at+=n+12;}
  const data=inflateSync(Buffer.concat(idat)),result=Buffer.alloc(width*height*channels),row=width*channels;
  for(let y=0;y<height;y++){assert.equal(data[y*(row+1)],0);data.copy(result,y*row,y*(row+1)+1,(y+1)*(row+1));}
  return result;
}

test('associated EXIF is descriptive; the primary HEIF transform governs despite thumbnail differences',async()=>{
  const neutral=await fixture('profile-mismatch-thumbnail.heic');
  const decoded=await verifyAndDecodePhoto(request(neutral));
  const oriented=Buffer.from(neutral),signature=Buffer.from('011200030000000100010000','hex'),at=oriented.indexOf(signature);
  assert.ok(at>=0);assert.equal(oriented.indexOf(signature,at+1),-1);oriented.writeUInt16BE(6,at+8);
  const changed=await verifyAndDecodePhoto(request(oriented));
  assert.deepEqual(changed.png,decoded.png); assert.equal(changed.decodePlan.metadata.orientationSource,'identity');
  const transformed=await verifyAndDecodePhoto(request(await fixture('transform-mismatch-thumbnail.heic')));
  assert.equal(transformed.decodePlan.metadata.orientationSource,'heif-properties');
  assert.equal((await sharp(transformed.png).metadata()).orientation,undefined);
});

test('odd-origin crops are refused for both direct HEVC and grids before accepting shifted chroma',async()=>{
  for(const crop of[cropProperty(46,30),cropProperty(48,32,1,1)]){
    await assert.rejects(verifyAndDecodePhoto(request(withProperties(base,[crop]))),code('PHOTO_GEOMETRY_UNSUPPORTED'));
  }
  await assert.rejects(verifyAndDecodePhoto(request(gridFixture(base,{
    padding:[0,0],primaryProperties:[cropProperty(104,104,1,1)]
  }))),code('PHOTO_GEOMETRY_UNSUPPORTED'));
});


test('repeated rotation or mirror properties are refused even when their net orientation is identity',async()=>{
  for(const type of ['imir','irot']){
    const operations=type==='imir'?[['imir',Buffer.from([0])],['imir',Buffer.from([0])]]:
      [['irot',Buffer.from([1])],['irot',Buffer.from([3])]];
    for(const bytes of [withProperties(base,operations),gridFixture(base,{primaryProperties:operations}),
      gridFixture(base,{padding:[0,0],primaryProperties:operations})]){
      await assert.rejects(verifyAndDecodePhoto(request(bytes)),code('PHOTO_GEOMETRY_UNSUPPORTED'));
    }
  }
});
