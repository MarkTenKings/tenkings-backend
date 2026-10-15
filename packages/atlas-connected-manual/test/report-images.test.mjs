import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { descriptorSha256, parseDecodedFrame } from '@atlas/photo-core';
import { digest, canonical } from '@atlas/manual-service/contract';
import { parseReportImages } from '@atlas/report-view/report-images-contract';
import { createReportImages, inspectReportImage } from '../src/report-images.mjs';
import { createReportImageStore } from '../src/report-image-store.mjs';
import { createReportImageProvider, REPORT_IMAGE_RECIPE, reportImageRecipeHash, reportImageJobKey } from '../src/report-image-provider.mjs';
import { photo, working } from './photo-fixture.mjs';

// A synthetic alpha-only result preserves every retained RGB sample at its
// original coordinate. Provider HTTP contract/adversarial tests are separate.
const {data:sourceRgba,info:sourceInfo}=await sharp(working.png,{ignoreIcc:true}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
for(let y=0;y<sourceInfo.height;y++)for(let x=0;x<sourceInfo.width;x++)if(x<5||y<5||x>=sourceInfo.width-5||y>=sourceInfo.height-5)sourceRgba[(y*sourceInfo.width+x)*4+3]=0;
const output=await sharp(sourceRgba,{raw:sourceInfo}).withIccProfile('srgb').png().toBuffer();
const outputWidth=sourceInfo.width,outputHeight=sourceInfo.height;
test('output qualification decodes real alpha and refuses fake transparency or fully empty outputs', async () => {
  const result = await inspectReportImage(output); assert.equal(result.width, outputWidth); assert.equal(result.height, outputHeight);
  assert.ok(result.alpha.transparentPixels > 0); assert.ok(result.alpha.opaquePixels > 0);
  const opaque = await sharp({ create: { width: 40, height: 56, channels: 4, background: '#ffffff' } }).png().toBuffer();
  const empty = await sharp({ create: { width: 40, height: 56, channels: 4, background: '#00000000' } }).png().toBuffer();
  for (const bytes of [opaque, empty]) await assert.rejects(inspectReportImage(bytes), { code: 'REPORT_IMAGE_ALPHA_INVALID' });
  await assert.rejects(inspectReportImage(Buffer.alloc(4 * 1024 * 1024 + 1)), { code: 'REPORT_IMAGE_OUTPUT_INVALID' });
});
test('real transparent cutouts with a near-opaque foreground qualify without rewriting provider bytes', async () => {
  const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
  for (let i = 3; i < data.length; i += 4) if (data[i] === 255) data[i] = 253;
  const bytes = await sharp(data, { raw: info }).png().toBuffer(), before = Buffer.from(bytes);
  const result = await inspectReportImage(bytes);
  assert.equal(result.alpha.opaquePixels, 0); assert.equal(result.alpha.nearOpaqueMin, 250);
  assert.equal(result.alpha.nearOpaquePixels, (outputWidth - 10) * (outputHeight - 10)); assert.ok(result.alpha.transparentPixels > 0);
  assert.equal(result.sha256, digest(before)); assert.deepEqual(bytes, before);
});
test('faint foregrounds, opaque specks and negligible transparent pixels do not qualify', async () => {
  for (const kind of ['faint','speck','transparent-speck']) {
    const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
    for (let i = 3; i < data.length; i += 4) data[i] = kind === 'transparent-speck' ? 253 : data[i] ? 100 : 0;
    if (kind === 'speck') data[3] = 255;
    if (kind === 'transparent-speck') data[3] = 0;
    const bytes = await sharp(data, { raw: info }).png().toBuffer();
    await assert.rejects(inspectReportImage(bytes), { code: 'REPORT_IMAGE_ALPHA_INVALID' });
  }
});

function fixture({ count = 1, failure = null, dispatch = true } = {}) {
  const source = photo.workingFrame;
  const descriptor = { schemaVersion: 1, kind: 'derivative', id: 'inspection', purpose: 'inspection',
    originalDescriptorSha256: descriptorSha256(photo.original), frameDescriptorSha256: descriptorSha256(source),
    raster: { ...source.raster, object: { key: 'test/derived/inspection.png', versionId: null } },
    frameToDerivative: [1,0,0,0,1,0,0,0,1], encoder: { name: 'fixture', version: '1', settingsSha256: 'a'.repeat(64) } };
  const sourceMedia = { descriptor, frame: source, original: photo.original, decodePlan: photo.decodePlan };
  const key = reportImageJobKey(descriptor.raster.content.sha256, REPORT_IMAGE_RECIPE);
  const jobs = Array.from({ length: count }, (_, index) => ({ key: index ? digest(key + index) : key, sourceMedia,
    source_hash: descriptor.raster.content.sha256, source_card_id: 'synthetic-card', recipe: REPORT_IMAGE_RECIPE,
    recipe_hash: reportImageRecipeHash(REPORT_IMAGE_RECIPE), state: 'QUEUED', attempts: 0, claim_id: null }));
  const f = { jobs, generations: 0, reads: 0, writes: 0, active: 0, peak: 0, errors: [], objects: new Map(), dispatches: 0 };
  const store = {
    async candidates() { return []; },
    async photoCandidates() { return []; },
    async claim(_concurrency, recipeHash) { const job = jobs.find(x => x.state === 'QUEUED' && (!recipeHash || x.recipe_hash === recipeHash)); if (!job) return null;
      job.state = 'RUNNING'; job.attempts++; job.claim_id = randomUUID(); return structuredClone(job); },
    async dispatch(job) { f.dispatches++; if (!dispatch) return false; jobs.find(x => x.key === job.key).state = 'REQUESTED'; return true; },
    async renew() { return true; },
    async recordReceipt(job, receipt) { f.receipts ??= []; f.receipts.push({key:job.key,receipt}); return true; },
    async finish(job, value) { const current = jobs.find(x => x.key === job.key); Object.assign(current, value, {
      state: value.result ? 'READY' : value.disposition === 'UNKNOWN' ? 'UNKNOWN' : value.disposition === 'RETRY' ? 'QUEUED' : 'FAILED' }); return true; },
    async ready() { return jobs.find(x => x.state === 'READY') ?? null; },
    async readyMany() { const job = jobs.find(x => x.state === 'READY'); return job ? ['FRONT','BACK'].map(side => ({ ...job, side })) : []; },
  };
  const provider = { recipe: REPORT_IMAGE_RECIPE, async edit(input) {
    f.generations++; f.active++; f.peak = Math.max(f.peak, f.active); assert.equal(input.sourceSha256, descriptor.raster.content.sha256);
    await new Promise(resolve => setTimeout(resolve, 5)); f.active--;
    if (failure) throw failure;
    return { bytes: output, receipt: { execution: 'PHOTOROOM_PLUS_API', recipeVersion: provider.recipe.version, endpoint: provider.recipe.endpoint, recipeHash: reportImageRecipeHash(provider.recipe),
      sourceSha256: input.sourceSha256, outputSha256: digest(output), byteCount: output.length, clientRequestId: input.requestId } };
  } };
  const storage = {
    async readDerivative({ descriptor: image }) { f.reads++; return { bytes: image.purpose === 'inspection' ? working.png : f.objects.get(image.raster.object.key) }; },
    async writeGeneratedFrame({frame,original,decodePlan,bytes}) { parseDecodedFrame(frame,original,decodePlan); f.objects.set(frame.raster.object.key,Buffer.from(bytes)); return frame; },
    async readDecodedFrame({frame}) { return {bytes:f.objects.get(frame.raster.object.key) ?? working.png}; },
    async writeDerivative({ descriptor: image, bytes }) { f.writes++; f.objects.set(image.raster.object.key, Buffer.from(bytes)); return image; },
  };
  f.service = createReportImages({ store, artifacts: {}, storage, provider, keyPrefix: 'test', concurrency: 2, onError: e => f.errors.push(e),
    timers: { setInterval: () => ({ unref() {} }), clearInterval() {} } });
  f.packet = { publicToken: 'ar_' + 'a'.repeat(24), approvalVersion: 1, images: { FRONT: { sha256: descriptor.raster.content.sha256 }, BACK: { sha256: 'b'.repeat(64) } } };
  f.row = { public_hash: 'c'.repeat(64) };
  f.store = store; f.provider = provider; f.storage = storage;
  return f;
}
test('cold construction and read-only missing manifest never enqueue or call the provider', async () => {
  const f = fixture(); assert.equal(f.generations, 0); assert.equal(f.dispatches, 0);
  assert.deepEqual((await f.service.manifest(f.row, f.packet)).images, {}); assert.equal(f.generations, 0);
});
test('worker capacity is bounded, each durable ready result is reused on the next tick', async () => {
  const f = fixture({ count: 3 }); await f.service.tick(); assert.equal(f.generations, 2); assert.ok(f.peak <= 2);
  await f.service.tick(); assert.equal(f.generations, 3); await f.service.tick(); assert.equal(f.generations, 3);
  assert.equal(f.writes, 3); assert.equal(f.jobs.filter(x => x.state === 'READY').length, 3);
});
test('qualified image metadata survives the actual store serialization without changing image bytes or binary guards', async () => {
  const f = fixture(); await f.service.tick(); const job = f.jobs[0], result = job.result;
  assert.equal(result.output.alpha.pixelCount, outputWidth * outputHeight); assert.equal(Object.hasOwn(result.output.alpha, 'pixels'), false);
  const transactions = [];
  const store = createReportImageStore({ boundary: { async machineTransaction(_authority, work) {
    return work({ tx: { async $executeRawUnsafe(sql, ...args) { transactions.push({ sql, args }); return 1; } } });
  } } });
  assert.equal(await store.finish(job, { result }), true); assert.equal(transactions.length, 1);
  const [, , state, document, sha256] = transactions[0].args;
  assert.equal(state, 'READY'); assert.equal(digest(document), sha256); assert.deepEqual(JSON.parse(document), result);
  assert.deepEqual((await f.service.image(f.row, f.packet, 'FRONT', digest(output))).bytes, output);
  const oldAlpha = { ...result.output.alpha, pixels: result.output.alpha.pixelCount }; delete oldAlpha.pixelCount;
  assert.throws(() => canonical({ ...result, output: { ...result.output, alpha: oldAlpha } }), { code: 'MANUAL_OBJECT_REFERENCE_REQUIRED' });
  assert.throws(() => canonical({ pixels: [1, 2, 3] }), { code: 'MANUAL_OBJECT_REFERENCE_REQUIRED' });
  await f.service.tick(); assert.equal(f.generations, 1);
});
test('read-only legacy alpha metadata remains readable but conflicting or invalid pixel counts are refused', async () => {
  const f = fixture(); await f.service.tick(); const result = f.jobs[0].result;
  const original = structuredClone(result.output.alpha);
  result.output.alpha = { ...original, pixels: original.pixelCount }; delete result.output.alpha.pixelCount;
  const legacy = structuredClone(result.output.alpha);
  assert.deepEqual((await f.service.image(f.row, f.packet, 'FRONT', digest(output))).bytes, output);
  assert.deepEqual(result.output.alpha, legacy);
  for (const alpha of [{ ...original, pixelCount: 1 }, { ...original, pixelCount: '2240' },
    { ...original, pixels: 1 }, { ...legacy, pixels: 1 }, { ...legacy, pixelCount: null }]) {
    result.output.alpha = alpha;
    await assert.rejects(f.service.image(f.row, f.packet, 'FRONT', digest(output)), { code: 'REPORT_IMAGE_BINDING_INVALID' });
  }
  assert.equal(f.generations, 1);
});
test('generated image reads remain bound to source, side, exact publication and output hash', async () => {
  const f = fixture(); await f.service.tick();
  // Same cache row deliberately offered for the wrong side must be rejected.
  await assert.rejects(f.service.manifest(f.row, f.packet), { code: 'REPORT_IMAGE_BINDING_INVALID' });
  assert.equal(await f.service.image(f.row, f.packet, 'FRONT', 'd'.repeat(64)), null);
  assert.deepEqual((await f.service.image(f.row, f.packet, 'FRONT', digest(output))).bytes, output);
  await assert.rejects(f.service.image(f.row, { ...f.packet, images: { FRONT: { sha256: 'd'.repeat(64) } } }, 'FRONT', digest(output)), { code: 'REPORT_IMAGE_BINDING_INVALID' });
  assert.equal(f.generations, 1); assert.equal(f.jobs[0].result.media.descriptor.purpose, 'reveal');
});
test('lost provider reply becomes UNKNOWN and remains cold through subsequent ticks', async () => {
  const f = fixture({ failure: Object.assign(new Error('lost'), { code: 'REPORT_IMAGE_RESPONSE_UNKNOWN', disposition: 'UNKNOWN' }) });
  await f.service.tick(); await f.service.tick(); assert.equal(f.generations, 1); assert.equal(f.jobs[0].state, 'UNKNOWN'); assert.equal(f.writes, 0);
});
test('lease dispatch refusal cannot trigger paid work', async () => {
  const f = fixture({ dispatch: false }); await f.service.tick(); assert.equal(f.generations, 0); assert.equal(f.writes, 0);
});
test('restart under a new recipe skips old queued jobs and still processes matching work', async () => {
  const f = fixture({ count: 2 });
  f.jobs[0].recipe = { ...REPORT_IMAGE_RECIPE, promptVersion: 'old-recipe' };
  f.jobs[0].recipe_hash = reportImageRecipeHash(f.jobs[0].recipe);
  await f.service.tick(); await f.service.tick();
  assert.equal(f.jobs[0].state, 'QUEUED'); assert.equal(f.jobs[0].attempts, 0);
  assert.equal(f.jobs[1].state, 'READY'); assert.equal(f.generations, 1);
  assert.equal(f.jobs[1].result.recipeHash, f.jobs[1].result.receipt.recipeHash);
});
test('stale or corrupted claimed recipe is fenced before source reads and paid dispatch', async () => {
  for (const inconsistentHash of [false, true]) {
    const f = fixture(); f.jobs[0].recipe = { ...REPORT_IMAGE_RECIPE, model: 'old-model' };
    if (!inconsistentHash) f.jobs[0].recipe_hash = reportImageRecipeHash(f.jobs[0].recipe);
    const claim = f.store.claim; f.store.claim = concurrency => claim(concurrency);
    await f.service.tick(); await f.service.tick();
    assert.equal(f.generations, 0); assert.equal(f.dispatches, 0); assert.equal(f.reads, 0);
    assert.equal(f.jobs[0].state, 'FAILED'); assert.equal(f.jobs[0].code, 'REPORT_IMAGE_RECIPE_UNSUPPORTED');
  }
});
test('paid response provenance must match the claimed recipe, source, request and exact bytes before adoption', async () => {
  for (const change of [{ recipeHash: 'f'.repeat(64) }, { recipeVersion: 'old-version' }, { endpoint: 'https://example.com/' },
    { execution: 'OPENAI_IMAGES_API' }, { sourceSha256: 'f'.repeat(64) }, { clientRequestId: randomUUID() },
    { outputSha256: 'f'.repeat(64) }, { byteCount: 1 }]) {
    const f = fixture(), edit = f.provider.edit;
    f.provider.edit = async args => { const result = await edit(args); return { ...result, receipt: { ...result.receipt, ...change } }; };
    await f.service.tick(); await f.service.tick();
    assert.equal(f.generations, 1); assert.equal(f.writes, 0); assert.equal(f.jobs[0].state, 'FAILED');
    assert.equal(f.jobs[0].code, 'REPORT_IMAGE_RECEIPT_MISMATCH'); assert.ok(f.receipts.length > 0);
  }
});
test('cache key changes only with source or the exact provider recipe', () => {
  const source = 'a'.repeat(64), key = reportImageJobKey(source, REPORT_IMAGE_RECIPE);
  assert.equal(key, reportImageJobKey(source, structuredClone(REPORT_IMAGE_RECIPE)));
  assert.notEqual(key, reportImageJobKey('b'.repeat(64), REPORT_IMAGE_RECIPE));
  for (const change of [{ version: 'different' }, { hdBackgroundRemoval: 'false' }, { padding: 1 }])
    assert.notEqual(key, reportImageJobKey(source, { ...REPORT_IMAGE_RECIPE, ...change }));
});
test('public manifest allowlist refuses source/report swaps, external URLs and internal keys', async () => {
  const f = fixture(); await f.service.tick(); const result = f.jobs[0].result;
  const binding = { publicToken: f.packet.publicToken, approvalVersion: 1, publicHash: f.row.public_hash };
  const descriptor = { ...binding, side: 'FRONT', sourceSha256: result.sourceSha256, sha256: result.output.sha256,
    width: outputWidth, height: outputHeight, byteCount: output.length, contentType: 'image/png',
    url: `/api/reports/${binding.publicToken}/presentation/FRONT?v=1&sha=${digest(output)}`,
    transparent: true, presentationOnly: true, preservesOriginalRGB: false, preservesOpaqueRGB: true,
    foregroundRGBValidation: 'bounded-edge-rgb-v1', alignment: 'original-frame',
    recipeVersion: REPORT_IMAGE_RECIPE.version, execution: 'PHOTOROOM_PLUS_API' };
  const manifest = { version: 'atlas-report-images-v1', ...binding, images: { FRONT: descriptor } };
  assert.equal(parseReportImages(manifest, { packet: f.packet, publicHash: f.row.public_hash }).images.FRONT.sha256, digest(output));
  for (const change of [{ sourceSha256: 'd'.repeat(64) }, { side: 'BACK' }, { publicHash: 'd'.repeat(64) }, { url: 'https://example.com/x' }, { key: 'private/object' }, { model: null }, { byteCount: 101 * 1024 * 1024 + 1 }])
    assert.throws(() => parseReportImages({ ...manifest, images: { FRONT: { ...descriptor, ...change } } }, { packet: f.packet, publicHash: f.row.public_hash }));
  assert.equal(canonical(f.packet), canonical(f.packet));
});


test('upfront working-frame edit is reused for clean reads and a differently prepared published report', async()=>{
  const f=fixture(),job=f.jobs[0];job.sourceMedia.descriptor=job.sourceMedia.frame;
  f.storage.readDecodedFrame=async()=>({bytes:working.png});
  f.store.photoIntent=async()=>true;f.store.photo=async()=>job;
  await f.service.tick();assert.equal(job.state,'READY');assert.equal(f.generations,1);
  const clean=await f.service.readCleanPhoto({cardId:'synthetic-card',uploadId:'synthetic-upload',side:'FRONT',waitMs:0});
  assert.deepEqual(clean.bytes,output);assert.equal(clean.sha256,digest(output));
  const reportSource=digest('a later human-corrected inspection crop');
  job.report_source_hash=reportSource;job.original_sha256=photo.original.content.sha256;
  const packet={...f.packet,images:{FRONT:{sha256:reportSource}}};
  f.store.readyMany=async()=>[{...job,side:'FRONT'}];
  const shown=await f.service.manifest(f.row,packet);
  assert.equal(shown.images.FRONT.sourceSha256,reportSource);
  assert.equal(shown.images.FRONT.segmentationSourceSha256,job.source_hash);
  assert.equal(shown.images.FRONT.originalSha256,photo.original.content.sha256);
  assert.deepEqual((await f.service.image(f.row,packet,'FRONT',digest(output))).bytes,output);
  await f.service.tick();assert.equal(f.generations,1,'report reuse never buys another edit');
  job.report_source_hash=digest('different inspection source');
  await assert.rejects(f.service.manifest(f.row,packet),{code:'REPORT_IMAGE_BINDING_INVALID'});
});

test('pending/failed clean views do not hold a read and replaced uploads cannot receive stale pixels',async()=>{
  const f=fixture(),args={cardId:'synthetic-card',uploadId:'synthetic-upload',side:'FRONT',waitMs:0};
  f.store.photoIntent=async()=>true;f.store.photo=async()=>null;
  assert.equal(await f.service.readCleanPhoto(args),null);assert.equal(f.generations,0);
  f.store.photo=async()=>({state:'FAILED'});assert.equal(await f.service.readCleanPhoto(args),null);
  await f.service.tick();let count=0;f.store.photo=async()=>++count===1?f.jobs[0]:null;
  await assert.rejects(f.service.readCleanPhoto(args),{code:'REPORT_IMAGE_SOURCE_CHANGED'});
});

test('upfront preparation readiness defers only live image work and never starts provider work',async()=>{
 const f=fixture(),input={cardId:'synthetic-card',uploadId:'synthetic-upload',side:'FRONT'};
 f.store.photoIntent=async()=>true;f.store.photo=async()=>f.jobs[0];
 for(const state of ['QUEUED','RUNNING','REQUESTED']){f.jobs[0].state=state;assert.equal(await f.service.isPhotoPrepared(input),false);}
 f.jobs[0].state='READY';assert.equal(await f.service.isPhotoPrepared(input),false);
 for(const state of ['FAILED','UNKNOWN']){f.jobs[0].state=state;assert.equal(await f.service.isPhotoPrepared(input),true);}
 f.jobs[0].state='READY';f.jobs[0].result={media:{frame:{schemaVersion:3}}};assert.equal(await f.service.isPhotoPrepared(input),true);
 f.store.photo=async()=>null;assert.equal(await f.service.isPhotoPrepared(input),false);assert.equal(f.generations,0);
});


test('generated grading source owns its exact pixels and coordinates; contradictory failed-with-result evidence is refused',async()=>{
 const f=fixture(),job=f.jobs[0];job.sourceMedia.descriptor=job.sourceMedia.frame;
 job.bound_original_sha256=photo.original.content.sha256;f.store.photo=async()=>job;
 const input={cardId:'synthetic-card',uploadId:'synthetic-upload',side:'FRONT',photo};
 await assert.rejects(f.service.readGradingPhoto(input),{code:'GRADING_IMAGE_PENDING'});
 await f.service.tick();assert.equal(job.state,'READY');
 const generated=await f.service.readGradingPhoto(input);
 assert.deepEqual(generated.bytes,output);assert.equal(generated.photo.workingFrame.schemaVersion,4);
 assert.deepEqual(generated.photo.workingFrame.raster.dimensions,{width:outputWidth,height:outputHeight});
 assert.deepEqual(generated.photo.workingFrame.segmentation.sourceFrame,photo.workingFrame);
 assert.deepEqual(generated.photo.workingFrame.sourceToFrame,photo.workingFrame.sourceToFrame);
 assert.notEqual(generated.photo.workingFrame.raster.content.sha256,photo.workingFrame.raster.content.sha256);
 const changed=structuredClone(photo);changed.original.content.sha256='a'.repeat(64);
 await assert.rejects(f.service.readGradingPhoto({...input,photo:changed}),{code:'GRADING_IMAGE_SOURCE_MISMATCH'});
 job.state='FAILED';await assert.rejects(f.service.readGradingPhoto(input),{code:'GRADING_IMAGE_PENDING'});
 assert.equal(f.generations,1);
});


test('Photoroom presentation access signs the exact immutable reveal and never reads image bytes',async()=>{
 const f=fixture();await f.service.tick();const reads=f.reads,job=f.jobs[0];let grants=0;
 f.storage.createImmutableDerivativeRead=async input=>{grants++;assert.equal(input.expiresIn,120);assert.deepEqual(input.descriptor,job.result.media.descriptor);
  return {url:'https://atlas-grading-private-20260910.nyc3.digitaloceanspaces.com/cutout?grant=fixture',...input.descriptor.raster.content};};
 const access=await f.service.imageAccess(f.row,f.packet,'FRONT',digest(output));
 assert.equal(access.image.sha256,digest(output));assert.equal(access.publicHash,f.row.public_hash);assert.equal(access.image.byteCount,output.length);
 assert.equal(f.reads,reads);assert.equal(grants,1);assert.equal(f.generations,1);
 assert.equal(await f.service.imageAccess(f.row,f.packet,'FRONT','d'.repeat(64)),null);assert.equal(grants,1);
 await assert.rejects(f.service.imageAccess(f.row,f.packet,'BACK',digest(output)),{code:'REPORT_IMAGE_BINDING_INVALID'});
 const sign=f.storage.createImmutableDerivativeRead;
 f.storage.createImmutableDerivativeRead=async input=>({...await sign(input),sha256:'d'.repeat(64)});
 await assert.rejects(f.service.imageAccess(f.row,f.packet,'FRONT',digest(output)));
 f.storage.createImmutableDerivativeRead=async input=>{const grant=await sign(input);job.state='FAILED';return grant;};
 assert.equal(await f.service.imageAccess(f.row,f.packet,'FRONT',digest(output)),null);
 assert.equal(f.reads,reads);assert.equal(f.generations,1);
});
