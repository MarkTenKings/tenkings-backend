import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { deriveLabelStyleTextures } from '../src/label-style-textures.mjs';
import { validateLabelStyleTexture } from '../../atlas-finishing/src/label-style-paint.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(width = 64, height = 32) {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 3;
    data[at] = x % 256; data[at + 1] = y % 256; data[at + 2] = (x + y) % 256;
  }
  const bytes = await sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer();
  const photo = { bytes, sha256: sha(bytes), width, height };
  const source = { side: 'FRONT', sha256: photo.sha256, box: { x: .25, y: .25, width: .5, height: .5 }, basis: 'CARD_BORDER', confidence: 'HIGH' };
  const recipe = { lines: [{ role: 'variant', text: 'BLUE ICE', spans: [{ start: 0, end: 8, pattern: 'DIAMOND', source }] }] };
  return { photo, source, recipe, photos: { FRONT: photo } };
}

test('texture derives only the selected crop with input/output hash receipts and no enlargement', async () => {
  const f = await fixture(), before = JSON.stringify(f.recipe);
  const result = await deriveLabelStyleTextures(f), again = await deriveLabelStyleTextures(f);
  assert.equal(JSON.stringify(f.recipe), before);
  assert.deepEqual(result, again);
  assert.ok(Object.isFrozen(result.lines[0].spanTextures[0]));
  const tile = result.lines[0].spanTextures[0];
  validateLabelStyleTexture(tile);
  assert.equal(tile.width, 32); assert.equal(tile.height, 16);
  const pixels = await sharp(Buffer.from(tile.pngBase64, 'base64')).raw().toBuffer();
  assert.deepEqual([...pixels.subarray(0, 3)], [16, 8, 24]);
  assert.deepEqual([...pixels.subarray(-3)], [47, 23, 70]);
  const receipt = result.receipts[0];
  assert.equal(receipt.status, 'READY'); assert.equal(receipt.source.sha256, f.photo.sha256);
  assert.deepEqual(receipt.source.cropBox, { left: 16, top: 8, width: 32, height: 16 });
  assert.equal(receipt.output.sha256, tile.sha256);
  assert.equal(receipt.output.byteCount, Buffer.from(tile.pngBase64, 'base64').length);
  assert.equal(receipt.processing.resize, 'inside-128-no-enlargement');
  assert.doesNotMatch(JSON.stringify(result.receipts), /pngBase64|data:image|https?:/);
});

test('large crops shrink inside 128 pixels while preserving aspect ratio and stable per-span identity', async () => {
  const f = await fixture(1024, 512);
  f.recipe.lines[0].spans = [
    { start: 0, end: 4, pattern: 'SHIMMER', source: f.source },
    { start: 5, end: 8, pattern: 'STRIPES', source: f.source },
  ];
  const r = await deriveLabelStyleTextures(f);
  assert.equal(r.lines[0].spanTextures[0].width, 128); assert.equal(r.lines[0].spanTextures[0].height, 64);
  assert.deepEqual(r.lines[0].spanTextures[0], r.lines[0].spanTextures[1]);
  assert.deepEqual(r.receipts.map(v => [v.role, v.spanIndex, v.start, v.end]), [['variant', 0, 0, 4], ['variant', 1, 5, 8]]);
});

test('unavailable, uncertain and printed-lettering sources return explicit procedural receipts', async () => {
  const f = await fixture();
  for (const [source, reason] of [
    [null, 'SOURCE_UNAVAILABLE'], [{ basis: 'UNAVAILABLE' }, 'SOURCE_UNAVAILABLE'],
    [{ ...f.source, confidence: 'LOW' }, 'SOURCE_UNCERTAIN'],
    [{ ...f.source, basis: 'PRINTED_LETTERING' }, 'LETTERING_IS_NOT_FIELD_TEXTURE'],
  ]) {
    const recipe = { lines: [{ ...f.recipe.lines[0], spans: [{ ...f.recipe.lines[0].spans[0], source }] }] };
    const result = await deriveLabelStyleTextures({ recipe, photos: {} });
    assert.equal(result.lines[0].spanTextures[0], null);
    assert.equal(result.receipts[0].status, 'PROCEDURAL_FALLBACK'); assert.equal(result.receipts[0].reason, reason);
  }
  f.recipe.lines[0].spans[0].pattern = 'NONE';
  const flat = await deriveLabelStyleTextures({ recipe: f.recipe, photos: {} });
  assert.equal(flat.receipts[0].status, 'NOT_REQUESTED');
});

test('changed photos, wrong dimensions, out-of-range boxes, invalid bases and aborts fail closed', async () => {
  const f = await fixture();
  await assert.rejects(deriveLabelStyleTextures({ recipe: f.recipe, photos: {} }), /LABEL_STYLE_TEXTURE_PHOTO_CHANGED/);
  await assert.rejects(deriveLabelStyleTextures({ recipe: f.recipe, photos: { FRONT: { ...f.photo, sha256: '0'.repeat(64) } } }), /LABEL_STYLE_TEXTURE_PHOTO_CHANGED/);
  await assert.rejects(deriveLabelStyleTextures({ recipe: f.recipe, photos: { FRONT: { ...f.photo, bytes: Buffer.from('bad') } } }), /LABEL_STYLE_TEXTURE_PHOTO_CHANGED/);
  await assert.rejects(deriveLabelStyleTextures({ recipe: f.recipe, photos: { FRONT: { ...f.photo, width: 65 } } }), /LABEL_STYLE_TEXTURE_PHOTO_INVALID/);
  for (const box of [{ x: -.1, y: 0, width: .5, height: .5 }, { x: .9, y: 0, width: .5, height: .5 }, { x: 0, y: 0, width: 0, height: .5 }]) {
    const recipe = structuredClone(f.recipe); recipe.lines[0].spans[0].source.box = box;
    await assert.rejects(deriveLabelStyleTextures({ recipe, photos: f.photos }), /LABEL_STYLE_TEXTURE_BOX_INVALID/);
  }
  const recipe = structuredClone(f.recipe); recipe.lines[0].spans[0].source.basis = 'URL';
  await assert.rejects(deriveLabelStyleTextures({ recipe, photos: f.photos }), /LABEL_STYLE_TEXTURE_SOURCE_INVALID/);
  await assert.rejects(deriveLabelStyleTextures({ ...f, signal: AbortSignal.abort() }), /abort/i);
});

async function tilePixels(result) {
  return sharp(Buffer.from(result.lines[0].spanTextures[0].pngBase64,'base64')).removeAlpha().raw().toBuffer();
}
const luma=(r,g,b)=>.2126*r+.7152*g+.0722*b;

test('neutral shimmer preserves source luminance detail while reducing chroma and recording the derived tone',async()=>{
  const f=await fixture();f.recipe.lines[0].spans[0].pattern='SHIMMER';
  const unchanged=await deriveLabelStyleTextures(f),original=await tilePixels(unchanged);
  f.recipe.lines[0].spans[0].baseColor='#BAC5C7';const snapshot=JSON.stringify(f.recipe);
  const toned=await deriveLabelStyleTextures(f),pixels=await tilePixels(toned),receipt=toned.receipts[0];
  assert.equal(JSON.stringify(f.recipe),snapshot);assert.equal(toned.version,'atlas-label-source-texture-v2');
  assert.equal(receipt.processing.sourceTileSha256,unchanged.lines[0].spanTextures[0].sha256);
  assert.equal(receipt.processing.tone.kind,'NEUTRAL_SHIMMER');assert.equal(receipt.processing.tone.saturation,.12);
  assert.equal(pixels.length,original.length);
  for(let i=0;i<pixels.length;i+=3){
    const before=luma(original[i],original[i+1],original[i+2]),after=luma(pixels[i],pixels[i+1],pixels[i+2]);
    assert.ok(Math.abs(after-(before+.12*(255-before)))<=1);
    const chroma=Math.max(...pixels.subarray(i,i+3))-Math.min(...pixels.subarray(i,i+3));
    const oldChroma=Math.max(...original.subarray(i,i+3))-Math.min(...original.subarray(i,i+3));
    assert.ok(chroma<=oldChroma*.12+1);
  }
  f.recipe.lines[0].spans[0].baseColor='#075CE0';
  assert.deepEqual(await tilePixels(await deriveLabelStyleTextures(f)),original,'colored shimmer remains source-colored');
});

test('dark diamond gain is capped and preserves facets; bright diamonds and red stripes remain unchanged',async()=>{
  const f=await fixture(),raw=await deriveLabelStyleTextures(f),original=await tilePixels(raw);
  f.recipe.lines[0].spans[0].baseColor='#0B57BA';
  const adjusted=await deriveLabelStyleTextures(f),pixels=await tilePixels(adjusted),tone=adjusted.receipts[0].processing.tone;
  assert.equal(tone.kind,'DARK_DIAMOND_LIFT');assert.equal(tone.gain,1.2);assert.ok(tone.outputMeanLuma>tone.sourceMeanLuma);
  for(let i=0;i<original.length;i++)assert.equal(pixels[i],Math.min(255,Math.round(original[i]*1.2)));
  f.recipe.lines[0].spans[0].pattern='STRIPES';f.recipe.lines[0].spans[0].baseColor='#F43C1C';
  assert.deepEqual(await tilePixels(await deriveLabelStyleTextures(f)),original);
  const bytes=await sharp({create:{width:64,height:32,channels:3,background:'#A0B0D0'}}).png().toBuffer();
  f.photos.FRONT={...f.photo,bytes,sha256:sha(bytes)};f.recipe.lines[0].spans[0].source.sha256=sha(bytes);
  f.recipe.lines[0].spans[0].pattern='DIAMOND';f.recipe.lines[0].spans[0].baseColor='#0B57BA';
  const bright=await deriveLabelStyleTextures(f);assert.equal(bright.receipts[0].processing.tone.kind,'SOURCE_UNCHANGED');
  assert.equal(bright.receipts[0].processing.sourceTileSha256,bright.lines[0].spanTextures[0].sha256);
});
