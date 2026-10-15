import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { canonical, digest } from '@atlas/manual-service/contract';
import { descriptorSha256, parseDecodedFrame } from '@atlas/photo-core';
import sharp from 'sharp';
import { PREPARATION_CORE_V1, PREPARATION_REVEALS_V1, PREPARATION_LOSSLESS_SETTINGS, INSPECTION_PREVIEW_POLICY } from '@atlas/preparation-runtime';
import { createManualArtifactStore } from '@atlas/manual-service/artifacts';
import { createPhotoProcessor } from '@atlas/manual-intake/photo-processing';
import { createGeometryWorkspace, applyGeometryEdit, geometryBase } from '@atlas/manual-workspace/geometry-actions';
import { rgb16Png } from '../../atlas-photo-runtime/test/helpers.mjs';
import { memoryPhotoStorage, sha } from '../../atlas-manual-intake/test/helpers.mjs';
import { createWorkLimiter } from '../src/index.mjs';
import { adoptEarlyGeometry, createEarlyGeometry, geometryCacheInput } from '../src/early-geometry.mjs';
import { MACHINE_GEOMETRY_POLICY } from '../src/machine-geometry.mjs';
import { ASTRA_GEOMETRY_POLICY, prepareAstraGeometryRequest } from '../src/astra-geometry.mjs';
import { geometrySideSettings } from '../src/details.mjs';
import { createGradingPhotoReader } from '../src/grading-photo-reader.mjs';
import { savedGradingPhoto, savedBackgroundRemovedPhoto } from './grading-photo-fixture.mjs';

const settings = { matColor: 'BLACK', cornerShape: 'ROUNDED_3_18_MM', profile: null, fields: { name: '' } };
const identity = { identity: { opencv: 'fixture', numpy: 'fixture', physicalProposalPolicy: 'fixture', sources: {} }, native: { fixture: 'a'.repeat(64) } };
const limits = { maxInputBytes: 1000000, maxPixels: 1000000, maxOutputBytes: 1000000, timeoutMs: 1000 };
const quad = [{ x: .125, y: .1 }, { x: .875, y: .1 }, { x: .875, y: .9 }, { x: .125, y: .9 }];
const error = code => Object.assign(new Error(code), { code, status: 409 });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) { for (let i = 0; i < 200; i++) { if (await check()) return; await pause(5); } assert.fail('Expected bounded geometry progress'); }

test('discovery, cache, compute and consume bind the same generated grading frame exclusively',async()=>{
 const f=await fixture(),upload=await f.upload('FRONT'),uploaded=f.photos.get(upload.uploadId);
 const bytes=await sharp({create:{width:20,height:28,channels:4,background:'#dda040'}}).png().toBuffer();
 const frame=parseDecodedFrame({schemaVersion:3,kind:'decoded-frame',id:'synthetic-generated-frame',
  originalDescriptorSha256:descriptorSha256(uploaded.original),decodePlanSha256:descriptorSha256(uploaded.decodePlan),
  raster:{content:{mime:'image/png',sha256:digest(bytes),byteCount:bytes.length},dimensions:{width:20,height:28},object:{key:'intake/derived/generated.png',versionId:null}},
  sourceToFrame:[1,0,0,0,1,0,0,0,1],treatment:{decoder:'synthetic-generator',version:'v1',policyVersion:'atlas-generated-grading-image-v1',channels:4,bitDepth:8,colorSpace:'sRGB',colorTreatment:'converted',hdrTreatment:'not-present'},
  generation:{sourceFrame:uploaded.workingFrame,recipeHash:digest('recipe'),model:'synthetic-generator',promptVersion:'v1'}},uploaded.original,uploaded.decodePlan);
 const photo={...uploaded,workingFrame:frame};let prepared=false,calls=0,reads=0;
 const service=f.build({isCleanPhotoPrepared:async()=>prepared,readGradingPhoto:async input=>{
  reads++;assert.equal(input.uploadId,upload.uploadId);assert.equal(input.photo.original.content.sha256,uploaded.original.content.sha256);return{photo,bytes};
 },runVisual:async input=>{calls++;assert.deepEqual(input.source.frame,frame);assert.deepEqual(input.source.bytes,bytes);return{responseHash:digest('generated-response'),physical:{quad:null,contour:[],uncertainty:'HIGH',observation:'Synthetic missing outline.'},printed:{quad:null,uncertainty:'HIGH',observation:'Synthetic missing frame.'}};}});
 try{
  f.intents.add(upload.uploadId);service.start();await pause(20);assert.equal(reads,0);assert.equal(calls,0);
  prepared=true;await until(()=>calls===1);await until(()=>[...f.jobs.values()][0]?.state==='NEEDS_REVIEW');
  const result=await service.consume(f.staff,f.cardId,'FRONT',upload,uploaded,settings);
  assert.equal(result.input.frameDescriptorSha256,descriptorSha256(frame));assert.notEqual(result.input.frameDescriptorSha256,descriptorSha256(uploaded.workingFrame));
  assert.deepEqual(result.packet.photoFrame,frame);assert.equal(calls,1);
 }finally{await service.stop();}
});

async function fixture() {
  const cardId = randomUUID(), pairId = randomUUID(), selected = {}, photos = new Map(), jobs = new Map(), intents = new Set();
  const { storage } = memoryPhotoStorage(), objects = new Map();
  const artifacts = createManualArtifactStore({ transport: {
    async putIfAbsent(input) { if (!objects.has(input.key)) objects.set(input.key, input); },
    async read({ key }) { const v = objects.get(key); return { bytes: v.bytes, contentType: v.contentType, lineageSha256: v.lineageSha256 }; },
  } });
  let currentSettings = structuredClone(settings), active = 0, maximum = 0;
  const processor = createPhotoProcessor({ storage, keyPrefix: 'intake', decodeLimits: {
    maxInputBytes: 1000000, maxPixels: 1000000, maxRasterBytes: 8000000, maxOutputBytes: 1000000, timeoutMs: 10000 } });
  async function upload(side) {
    const bytes = rgb16Png(12, 16), uploadId = randomUUID(), version = (selected[side]?.version ?? 0) + 1;
    const plan = { schemaVersion: 1, uploadId, binding: { cardId, pairId, side, version },
      object: { key: `intake/originals/${uploadId}`, versionId: null }, expected: { sha256: sha(bytes), byteCount: bytes.length } };
    const found = await storage.writeOriginal({ uploadPlan: plan, bytes });
    const verification = { object: found.object, sha256: found.sha256, byteCount: found.byteCount, contentType: found.contentType };
    const photo = await processor({ uploadPlan: plan, verification, bytes }); photos.set(uploadId, photo);
    const sourceHash = descriptorSha256({ plan, verification });
    const ref = await artifacts.write(photo, { cardId, kind: 'PHOTO_SOURCE', sourceHash });
    selected[side] = { uploadId, side, version, plan, verification, source: { photoSourceHash: sourceHash, ref } };
    return selected[side];
  }
  const store = {
    async intent(_staff, _card, id) { intents.add(id); },
    async pending(engineHash) {
      return Object.values(selected).filter(u => intents.has(u.uploadId) && ![...jobs.values()].some(j => j.input.uploadId === u.uploadId
        && j.input.engineHash === engineHash && canonical(j.input.settings) === canonical(geometrySideSettings(currentSettings, u.side))))
        .map(u => ({ card_id: cardId, upload_id: u.uploadId, side: u.side, plan: JSON.stringify(u.plan), verification: JSON.stringify(u.verification),
          source: JSON.stringify(u.source), settings: geometrySideSettings(currentSettings, u.side), created_at: new Date(0) }));
    },
    async stage(input) { return store.ensure(null, input); },
    async ensure(_staff, input, { retry = false } = {}) {
      if (selected[input.side]?.uploadId !== input.uploadId) throw error('GEOMETRY_PHOTO_CHANGED');
      const key = digest(canonical(input)); let job = jobs.get(key);
      if (retry && job && !['FAILED','NEEDS_REVIEW'].includes(job.state)) throw error('GEOMETRY_RETRY_STALE');
      if (!job || retry) { job = { key, input, state: 'QUEUED', attempts: 0, result: null, error: null }; jobs.set(key, job); }
      return structuredClone(job);
    },
    async read(_staff, _card, key) { return structuredClone(jobs.get(key) ?? null); },
    async retainedForPhoto() { return []; },
    async claim(engineHash, claimId) {
      if (active >= 2) return null;
      const job = [...jobs.values()].find(j => j.state === 'QUEUED' && j.input.engineHash === engineHash && selected[j.input.side]?.uploadId === j.input.uploadId);
      if (!job) return null;
      job.state = 'RUNNING'; job.claimId = claimId; job.attempts++; active++; maximum = Math.max(maximum, active); return structuredClone(job);
    },
    async finish(job, state, result, failure) {
      const current = jobs.get(job.key); active--;
      if (current.claimId !== job.claimId || selected[job.input.side]?.uploadId !== job.input.uploadId) return false;
      Object.assign(current, { state, result, error: failure, claimId: null }); return true;
    },
  };
  let printed = { quad:null,uncertainty:'LOW',observation:'No coherent printed frame.' };
  let calls = 0, preparation = async () => { throw new Error('Unexpected preparation of rejected outline'); };
  let physical = async input => ({ id: `proposal-${++calls}`, identity: identity.identity,
    frameDescriptorSha256: descriptorSha256(input.source.frame), proposal: { outcome: 'REJECTED', proposal: null } });
  const limited = createWorkLimiter(2), staff = {};
  const build = (options = {}) => createEarlyGeometry({ store, storage, artifacts, limits, pythonExecutable: '/fixture/python', keyPrefix: 'intake', ...options,
    runtimeIdentity: async () => identity, limited, intervalMs: 5,
    intake: { async read() { return { card: { cardId, sides: Object.fromEntries(['FRONT','BACK'].map(side => [side, { upload: selected[side] ?? null }])) } }; },
      async readSource(_staff, _card, id) { return { photo: photos.get(id) }; } },
    details: { async read() { return { details: currentSettings }; } },
    readGradingPhoto:options.readGradingPhoto??(async({photo})=>({photo,bytes:(await storage.readDecodedFrame({frame:photo.workingFrame,original:photo.original,decodePlan:photo.decodePlan})).bytes})),
    runVisual:options.runVisual??(async input=>{
      const proposed=await physical(input),q=proposed.proposal.outcome==='ACCEPTED'?proposed.proposal.proposal:null;
      const contour=q?Array.from({length:16},(_,i)=>{const edge=Math.floor(i/4),t=i%4/4,a=q[edge],b=q[(edge+1)%4];return{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};}):[];
      return {physical:{quad:q,contour,uncertainty:'LOW',observation:'Fixture outline.'},printed:structuredClone(printed),responseHash:digest(proposed.id)};
    }),
    prepare: input => preparation(input) });
  return { cardId, staff, storage, upload, build, jobs, intents, selected, photos, store, identity, limits, artifacts,
    breakArtifact(uploadId) { objects.delete(photos.get(uploadId) && Object.values(selected).find(u => u.uploadId === uploadId).source.ref.key); },
    setSettings(value) { currentSettings = { ...currentSettings, ...value }; },
    setPhysical(value) { physical = value; }, setPrinted(value) { printed = value; }, setPrepare(value) { preparation = value; }, get calls() { return calls; }, get maximum() { return maximum; } };
}

test('a single Back photo is processed without profile, identity or Front, and duplicate starts reuse the durable result', async () => {
  const f = await fixture(), service = f.build();
  try {
    const back = await f.upload('BACK');
    await service.sourcePrepared(f.staff, f.cardId, back.uploadId);
    await until(() => [...f.jobs.values()].some(j => j.state === 'NEEDS_REVIEW'));
    const first = await service.ensure(f.staff, f.cardId), second = await service.ensure(f.staff, f.cardId);
    assert.equal(first.earlyGeometry.FRONT.state, 'WAITING_PHOTO');
    assert.equal(first.earlyGeometry.BACK.state, 'NEEDS_REVIEW');
    assert.equal(first.earlyGeometry.BACK.canRetry, true);
    assert.deepEqual(second, first); assert.equal(f.calls, 1);
  } finally { await service.stop(); }
});

test('persisted source intent recovers in a new worker without a browser ensure call', async () => {
  const f = await fixture(), upload = await f.upload('FRONT');
  f.intents.add(upload.uploadId); // same-transaction source intent survived a process exit
  const restarted = f.build();
  try { restarted.start(); await until(() => f.calls === 1); await until(() => [...f.jobs.values()][0]?.state === 'NEEDS_REVIEW'); }
  finally { await restarted.stop(); }
});

test('explicit retry repeats the exact reviewed input once; routine polling never retries a rejection', async () => {
  const f = await fixture(), service = f.build();
  try {
    await f.upload('FRONT'); await service.ensure(f.staff, f.cardId);
    await until(() => [...f.jobs.values()][0]?.state === 'NEEDS_REVIEW');
    const status = (await service.status(f.staff, f.cardId)).FRONT;
    for (let i = 0; i < 3; i++) await service.ensure(f.staff, f.cardId);
    assert.equal(f.calls, 1);
    await service.ensure(f.staff, f.cardId, { side: 'FRONT', expectedKey: status.key });
    await until(() => f.calls === 2); assert.equal(f.jobs.size, 1);
  } finally { await service.stop(); }
});

test('a native preparation refusal retains its valid physical proposal and exposes a recoverable per-side result', async () => {
  const f = await fixture(), service = f.build();
  f.setPhysical(async input => ({ id: 'physical-only', identity: identity.identity,
    frameDescriptorSha256: descriptorSha256(input.source.frame), proposal: { outcome: 'ACCEPTED', proposal: quad } }));
  f.setPrepare(async () => { throw Object.assign(new Error('bounded resource refusal'), { name: 'PreparationError', code: 'PREPARATION_LIMIT' }); });
  try {
    await f.upload('FRONT'); await service.ensure(f.staff, f.cardId);
    await until(() => [...f.jobs.values()][0]?.state === 'NEEDS_REVIEW');
    const result = (await service.status(f.staff, f.cardId)).FRONT;
    assert.deepEqual(result.physical, quad); assert.equal(result.prepared, false); assert.equal(result.printed, null);
    assert.equal(result.error, 'PREPARATION_LIMIT'); assert.equal(result.canRetry, true);
  } finally { await service.stop(); }
});

test('native-only runtime changes recover the exact generated-frame Astra reply without a new model job',async()=>{
 const f=await fixture(),upload=await f.upload('FRONT'),uploaded=f.photos.get(upload.uploadId);
 const bytes=await sharp({create:{width:40,height:60,channels:4,background:'#bba040'}}).png().toBuffer();
 const frame=parseDecodedFrame({schemaVersion:3,kind:'decoded-frame',id:'retained-generated-frame',
  originalDescriptorSha256:descriptorSha256(uploaded.original),decodePlanSha256:descriptorSha256(uploaded.decodePlan),
  raster:{content:{mime:'image/png',sha256:digest(bytes),byteCount:bytes.length},dimensions:{width:40,height:60},object:{key:'intake/derived/retained.png',versionId:null}},
  sourceToFrame:[1,0,0,0,1,0,0,0,1],treatment:{decoder:'synthetic-generator',version:'v1',policyVersion:'atlas-generated-grading-image-v1',channels:4,bitDepth:8,colorSpace:'sRGB',colorTreatment:'converted',hdrTreatment:'not-present'},
  generation:{sourceFrame:uploaded.workingFrame,recipeHash:digest('recipe'),model:'synthetic-generator',promptVersion:'v1'}},uploaded.original,uploaded.decodePlan);
 const photo={...uploaded,workingFrame:frame},source={frame,bytes};
 const {evidence}=await prepareAstraGeometryRequest({source,side:'FRONT'});
 const physicalContour=Array.from({length:16},(_,i)=>{const edge=Math.floor(i/4),t=i%4/4,a=quad[edge],b=quad[(edge+1)%4];return{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};});
 const visual={physical:{quad,contour:physicalContour,uncertainty:'LOW',observation:'Authored physical edge.'},printed:{quad:quad.map(p=>({x:.5+(p.x-.5)*.9,y:.5+(p.y-.5)*.9})),uncertainty:'HIGH',observation:'Authored interrupted printed rails.'}};
 const saved={evidence,status:200,bodyText:JSON.stringify({id:'resp_retained',model:'gpt-6-astra',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(visual)}]}]})};
 const responseRef=await f.artifacts.write(saved,{cardId:f.cardId,kind:'GEOMETRY_MODEL_RESPONSE',sourceHash:evidence.requestHash});
 const oldEngine={policy:'atlas-early-clean-geometry-v2',outputContract:PREPARATION_CORE_V1,machineGeometryPolicy:MACHINE_GEOMETRY_POLICY,visual:ASTRA_GEOMETRY_POLICY,
  runtime:{...identity,identity:{...identity.identity,opencv:'prior-codec'}},limits};
 const prior=geometryCacheInput(upload,photo,settings,oldEngine),priorJob={key:digest(canonical(prior)),input:prior,state:'NEEDS_REVIEW',result:null};
 let ensureCount=0,modelCount=0;
 f.store.ensure=async()=>{ensureCount++;return null;};f.store.read=async()=>({state:'NEEDS_REVIEW',result:null,error:'GEOMETRY_REFRESH_AVAILABLE'});f.store.pending=async()=>[];
 f.store.retainedForPhoto=async(_staff,cardId,side,uploadId,hash)=>{assert.equal(cardId,f.cardId);assert.equal(side,'FRONT');assert.equal(uploadId,upload.uploadId);return hash===descriptorSha256(frame)?[priorJob]:[];};
 f.store.readModel=async()=>({requestHash:evidence.requestHash,request:{evidence},response:{ref:responseRef,httpStatus:200}});
 const service=f.build({readGradingPhoto:async()=>({photo,bytes}),runVisual:async()=>{modelCount++;assert.fail('retained reply must not dispatch again');}});
 try{
  const recovered=await service.consume(f.staff,f.cardId,'FRONT',upload,uploaded,settings);
  assert.equal(ensureCount,0);assert.equal(modelCount,0);assert.equal(f.jobs.size,0);
  assert.deepEqual(recovered.input,prior);assert.deepEqual(recovered.packet.visual.printed,visual.printed);
  assert.equal(recovered.packet.preparation,null);assert.equal(recovered.packet.preparedImages,null);
  const exact=await service.retainedVisual(f.staff,f.cardId,'FRONT',upload.uploadId,frame,{responseHash:digest(saved.bodyText)});
  assert.equal(exact.responseHash,digest(saved.bodyText));
  assert.equal(await service.retainedVisual(f.staff,f.cardId,'FRONT',upload.uploadId,frame,{responseHash:'0'.repeat(64)}),null);
  assert.equal(await service.retainedVisual(f.staff,f.cardId,'FRONT',upload.uploadId,{...frame,id:'another-frame'}),null);
  const changedSettings=await service.consume(f.staff,f.cardId,'FRONT',upload,uploaded,{...settings,matColor:'WHITE'});
  assert.equal(changedSettings.packet,null);
  priorJob.input.engine.visual={...ASTRA_GEOMETRY_POLICY,version:'another-model-policy'};
  assert.equal(await service.retainedVisual(f.staff,f.cardId,'FRONT',upload.uploadId,frame),null);
 }finally{await service.stop();}
});

for (const proposalKind of ['accepted', 'ambiguous missing', 'missing printed']) test(`automatic cache retains exact core pixels and ${proposalKind} geometry provenance`, async () => {
  const provisional = proposalKind === 'ambiguous missing', missingPrinted = proposalKind === 'missing printed';
  const f = await fixture(), service = f.build();
  f.setPhysical(async input => ({ id: 'physical-core', identity: identity.identity,
    frameDescriptorSha256: descriptorSha256(input.source.frame), proposal: { outcome: 'ACCEPTED', proposal: quad } }));
  f.setPrinted({quad:missingPrinted||provisional?null:[{x:.21875,y:.18},{x:.78125,y:.18},{x:.78125,y:.82},{x:.21875,y:.82}],uncertainty:provisional?'HIGH':'LOW',observation:missingPrinted?'No printed frame.':provisional?'Interrupted frame is unresolved.':'Supported inner rails.'});
  f.setPrepare(async input => {
    assert.equal(input.outputContract, PREPARATION_CORE_V1);
    const transform = [141, 0, -211.5, 0, 138.828125, -222.125, 0, 0, 1];
    // Native preparation itself has separate real-byte equivalence tests. This
    // transport fixture exercises contract selection and retained provenance.
    const output = (name, width, height) => { const bytes = Buffer.from(`fixture-${name}`);
      return { filename: `${name}.webp`, mime: 'image/webp', bytes, byteCount: bytes.length, sha256: sha(bytes), width, height,
        frameToDerivative: name === 'rectified' ? transform : [141, 0, -171.5, 0, 138.828125, -182.125, 0, 0, 1] }; };
    const outputs = { rectified: output('rectified', 1270, 1778), inspection: output('inspection', 1350, 1858) };
    const previewBytes = Buffer.from('fixture-jpeg-preview'), hasPreview = proposalKind === 'accepted';
    return { id: 'core-result', frameDescriptorSha256: descriptorSha256(input.source.frame), identity: identity.identity,
      outputContract: PREPARATION_CORE_V1, sourceQuad: input.quad, proposal: {outcome:'NOT_APPLICABLE',proposal:null},
      encoderSettings: hasPreview ? PREPARATION_LOSSLESS_SETTINGS : { format: 'webp', quality: 92, sourceBitDepth: 8 }, outputs,
      ...(hasPreview ? { inspectionPreview: { filename: 'inspection-preview.jpg', policyVersion: INSPECTION_PREVIEW_POLICY,
        sourceSha256: outputs.inspection.sha256, bytes: previewBytes, sha256: sha(previewBytes), byteCount: previewBytes.length,
        mime: 'image/jpeg', width: 558, height: 768, frameToDerivative: outputs.inspection.frameToDerivative } } : {}),
      frame: { id: 'prepared-core', version: 1, sourceToRectified: transform,
        rectified: { sha256: outputs.rectified.sha256, width: 1270, height: 1778 },
        inspection: { sha256: outputs.inspection.sha256, width: 1350, height: 1858, cardBounds: { x: 40, y: 40, width: 1270, height: 1778 } } } };
  });
  try {
    const upload = await f.upload('FRONT'), photo = f.photos.get(upload.uploadId);
    await service.ensure(f.staff, f.cardId); await until(() => [...f.jobs.values()][0]?.state === 'READY');
    const { input, packet } = await service.consume(f.staff, f.cardId, 'FRONT', upload, photo, settings);
    assert.equal(input.engine.outputContract, PREPARATION_CORE_V1);
    assert.equal(input.engine.machineGeometryPolicy, MACHINE_GEOMETRY_POLICY);
    const oldPolicy = { ...input.engine }; delete oldPolicy.machineGeometryPolicy;
    assert.notEqual(digest(canonical(geometryCacheInput(upload, photo, settings, oldPolicy))), packet.key);
    const historicalEngine = { ...input.engine }; delete historicalEngine.outputContract;
    assert.notEqual(digest(canonical(geometryCacheInput(upload, photo, settings, historicalEngine))), packet.key);
    const manifest = await f.artifacts.read(packet.preparedImages.ref,
      { cardId: f.cardId, kind: 'PREPARED_IMAGES', sourceHash: packet.preparedImages.sourceHash });
    assert.deepEqual(Object.keys(manifest.images).sort(), ['inspection', 'rectified']);
    assert.equal(manifest.outputContract, PREPARATION_CORE_V1);
    assert.equal(manifest.deferredReveals.outputContract, PREPARATION_REVEALS_V1);
    assert.deepEqual(manifest.deferredReveals.workingFrame, photo.workingFrame);
    assert.deepEqual(manifest.deferredReveals.preparation.sourceQuad, quad);
    assert.deepEqual(manifest.deferredReveals.preparation, packet.preparation);
    assert.equal(manifest.deferredReveals.preparation.outputs, undefined);
    assert.equal(manifest.deferredReveals.preparation.inspectionPreview, undefined);
    if (proposalKind === 'accepted') {
      assert.equal(manifest.inspectionPreview.policyVersion, INSPECTION_PREVIEW_POLICY);
      assert.equal(manifest.inspectionPreview.sourceSha256, manifest.images.inspection.raster.content.sha256);
      assert.equal(manifest.inspectionPreview.descriptor.purpose, 'preview');
      assert.equal(manifest.inspectionPreview.descriptor.raster.content.mime, 'image/jpeg');
      assert.deepEqual(Object.keys(manifest.inspectionPreview).sort(), ['descriptor', 'policyVersion', 'sourceSha256']);
    } else assert.equal(manifest.inspectionPreview, undefined);
    const frame = photo.workingFrame;
    const geometry = createGeometryWorkspace({ cardId: f.cardId, profile: 'POKEMON', sides: {
      FRONT: { ...input.settings, image: { version: upload.version, originalSha256: photo.original.content.sha256,
        frameId: frame.id, frameSha256: frame.raster.content.sha256, ...frame.raster.dimensions, coordinateSpace: 'ORIENTED_DECODED' } },
      BACK: { ...input.settings, image: null },
    } });
    const before = structuredClone(packet), adopted = adoptEarlyGeometry(geometry, 'FRONT', packet, input);
    if (missingPrinted || provisional) {
      assert.equal(adopted.geometry.sides.FRONT.printed, null);
      assert.deepEqual(adopted.geometry.sides.FRONT.physical.quad, quad);
      assert.ok(adopted.geometry.sides.FRONT.prepared);
      assert.equal(packet.preparation.proposal.observation,provisional?'Interrupted frame is unresolved.':'No printed frame.');
    } else {
      assert.ok(adopted.geometry.sides.FRONT.printed.quad.every((p,i)=>Math.abs(p.x-quad[i].x)<.001&&Math.abs(p.y-quad[i].y)<.001));
      assert.equal(adopted.geometry.sides.FRONT.printed.actor, 'ASTRA');
      assert.equal(adopted.geometry.sides.FRONT.printed.proposal.ambiguous, provisional);
    }
    assert.equal(adopted.geometry.sides.FRONT.confirmation, null);
    assert.deepEqual(packet, before);
    const status = (await service.status(f.staff, f.cardId)).FRONT;
    assert.equal(status.machineUsable, true); assert.equal(status.ambiguous, false);
    assert.equal(status.requiresHumanConfirmation, true);
    assert.deepEqual(status.unresolved, missingPrinted || provisional ? ['PRINTED_GEOMETRY_UNRESOLVED'] : []);
    if (provisional) assert.equal(packet.preparation.proposal.outcome, 'ABSTAIN');
  } finally { await service.stop(); }
});

test('an unversioned full worker result cannot be persisted as new core preparation', async () => {
  const f = await fixture(), service = f.build();
  f.setPhysical(async input => ({ id: 'physical-core', identity: identity.identity,
    frameDescriptorSha256: descriptorSha256(input.source.frame), proposal: { outcome: 'ACCEPTED', proposal: quad } }));
  f.setPrepare(async () => ({ outputs: Object.fromEntries(['rectified','inspection','normalized','microDefect','directional'].map(k => [k, {}])) }));
  try {
    await f.upload('FRONT'); await service.ensure(f.staff, f.cardId);
    await until(() => [...f.jobs.values()][0]?.state === 'FAILED');
    assert.equal([...f.jobs.values()][0].error, 'GEOMETRY_STORED_CONTENT_INVALID');
    assert.equal([...f.jobs.values()][0].result, null);
  } finally { await service.stop(); }
});

test('failed source discovery does not starve another side or already queued work', async () => {
  const f = await fixture(), first = await f.upload('FRONT'), second = await f.upload('BACK');
  f.intents.add(first.uploadId); f.intents.add(second.uploadId); f.breakArtifact(first.uploadId);
  const service = f.build();
  try {
    service.start(); await until(() => [...f.jobs.values()].some(j => j.input.side === 'BACK' && j.state === 'NEEDS_REVIEW'));
    assert.equal(f.calls, 1); assert.equal([...f.jobs.values()].filter(j => j.input.side === 'FRONT').length, 0);
  } finally { await service.stop(); }
});

test('Front and Back native work can overlap but never exceed two reserved slots', async () => {
  const f = await fixture(), service = f.build(); let release;
  const gate = new Promise(resolve => { release = resolve; }); let entered = 0;
  f.setPhysical(async input => { entered++; await gate; return { id: `p-${entered}`, identity: identity.identity,
    frameDescriptorSha256: descriptorSha256(input.source.frame), proposal: { outcome: 'REJECTED', proposal: null } }; });
  try {
    await f.upload('FRONT'); await f.upload('BACK'); await service.ensure(f.staff, f.cardId);
    await until(() => entered === 2); assert.equal(f.maximum, 2); release();
    await until(() => [...f.jobs.values()].every(j => j.state === 'NEEDS_REVIEW'));
  } finally { release(); await service.stop(); }
});

test('a Back that arrives during slow Front processing uses the free slot and finishes first', async () => {
  const f = await fixture(), service = f.build(); let release, frontEntered = false;
  const gate = new Promise(resolve => { release = resolve; });
  f.setPhysical(async input => {
    if (input.source.original.binding.side === 'FRONT') { frontEntered = true; await gate; }
    return { id: `p-${input.source.original.binding.side}`, identity: identity.identity,
      frameDescriptorSha256: descriptorSha256(input.source.frame), proposal: { outcome: 'REJECTED', proposal: null } };
  });
  try {
    const front = await f.upload('FRONT'); await service.sourcePrepared(f.staff, f.cardId, front.uploadId); await until(() => frontEntered);
    const back = await f.upload('BACK'); await service.sourcePrepared(f.staff, f.cardId, back.uploadId);
    await until(() => [...f.jobs.values()].some(j => j.input.side === 'BACK' && j.state === 'NEEDS_REVIEW'));
    assert.equal([...f.jobs.values()].find(j => j.input.side === 'FRONT').state, 'RUNNING'); assert.equal(f.maximum, 2);
  } finally { release(); await service.stop(); }
});

test('shutdown cannot be undone by a late upload-completion callback', async () => {
  const f = await fixture(), service = f.build(), upload = await f.upload('FRONT');
  await service.stop(); await service.sourcePrepared(f.staff, f.cardId, upload.uploadId);
  assert.equal(service.start(), false); await pause(15); assert.equal(f.calls, 0); assert(f.intents.has(upload.uploadId));
});

test('identity text/profile do not rerun unchanged pixels; changed mat has a new cache key', async () => {
  const f = await fixture(), service = f.build();
  try {
    await f.upload('FRONT'); const original = await service.ensure(f.staff, f.cardId);
    await until(() => f.calls === 1); f.setSettings({ profile: 'POKEMON', fields: { name: 'Updated after identification' } });
    assert.equal((await service.ensure(f.staff, f.cardId)).earlyGeometry.FRONT.key, original.earlyGeometry.FRONT.key);
    f.setSettings({ matColor: 'WHITE' }); const changed = await service.ensure(f.staff, f.cardId);
    assert.notEqual(changed.earlyGeometry.FRONT.key, original.earlyGeometry.FRONT.key); await until(() => f.calls === 2);
  } finally { await service.stop(); }
});

test('mixed mats select separate exact jobs; correcting Front reuses Back and refuses the old Front retry', async () => {
  const f = await fixture(), service = f.build();
  try {
    await f.upload('FRONT'); await f.upload('BACK'); f.setSettings({ frontMatColor: 'WHITE', backMatColor: 'BLACK' });
    const initial = await service.ensure(f.staff, f.cardId);
    await until(() => [...f.jobs.values()].filter(j => j.state === 'NEEDS_REVIEW').length === 2);
    assert.deepEqual([...f.jobs.values()].map(j => [j.input.side, j.input.settings.matColor]).sort(), [['BACK','BLACK'],['FRONT','WHITE']]);
    f.setSettings({ frontMatColor: 'MAGENTA' }); const changed = await service.ensure(f.staff, f.cardId);
    assert.notEqual(changed.earlyGeometry.FRONT.key, initial.earlyGeometry.FRONT.key);
    assert.equal(changed.earlyGeometry.BACK.key, initial.earlyGeometry.BACK.key);
    await assert.rejects(service.ensure(f.staff, f.cardId, { side: 'FRONT', expectedKey: initial.earlyGeometry.FRONT.key }), { code: 'GEOMETRY_RETRY_STALE' });
    await until(() => f.calls === 3); assert.equal(f.jobs.size, 3);
    const explicitWorkspace = { FRONT: { matColor: 'BLACK', cornerShape: 'SQUARE' }, BACK: { matColor: 'MAGENTA', cornerShape: 'SQUARE' } };
    const workspace = await service.ensure(f.staff, f.cardId, {}, explicitWorkspace);
    for (const side of ['FRONT','BACK']) assert.deepEqual(f.jobs.get(workspace.earlyGeometry[side].key).input.settings, explicitWorkspace[side]);
  } finally { await service.stop(); }
});

test('a late old-photo completion cannot become current; retry refuses a superseded key', async () => {
  const f = await fixture(), service = f.build(); let release, entered = false;
  const gate = new Promise(resolve => { release = resolve; });
  f.setPhysical(async input => { entered = true; await gate; return { id: 'late', identity: identity.identity,
    frameDescriptorSha256: descriptorSha256(input.source.frame), proposal: { outcome: 'REJECTED', proposal: null } }; });
  try {
    await f.upload('FRONT'); const old = await service.ensure(f.staff, f.cardId); await until(() => entered);
    await f.upload('FRONT'); release();
    await assert.rejects(service.ensure(f.staff, f.cardId, { side: 'FRONT', expectedKey: old.earlyGeometry.FRONT.key }), e => e.code === 'GEOMETRY_RETRY_STALE');
    const current = await service.ensure(f.staff, f.cardId); assert.notEqual(current.earlyGeometry.FRONT.key, old.earlyGeometry.FRONT.key);
    assert.equal(current.earlyGeometry.FRONT.physical, null);
  } finally { release(); await service.stop(); }
});

test('cache adoption uses the real profile and refuses later human geometry without touching Back', async () => {
  const f = await fixture(), upload = await f.upload('FRONT'), photo = f.photos.get(upload.uploadId);
  const engine = { policy: 'atlas-early-photo-geometry-v1', runtime: identity, limits };
  const input = geometryCacheInput(upload, photo, settings, engine), frame = photo.workingFrame;
  const packet = { policy: input.policy, key: digest(canonical(input)), binding: input, photoFrame: frame, preparation: null,
    physical: { id: 'early-test', actor:'ASTRA', identity: ASTRA_GEOMETRY_POLICY, frameDescriptorSha256: descriptorSha256(frame), proposal: { outcome: 'ACCEPTED', proposal: quad } } };
  const geometry = createGeometryWorkspace({ cardId: f.cardId, profile: 'POKEMON', sides: {
    FRONT: { ...input.settings, image: { version: upload.version, originalSha256: photo.original.content.sha256, frameId: frame.id,
      frameSha256: frame.raster.content.sha256, ...frame.raster.dimensions, coordinateSpace: 'ORIENTED_DECODED' } },
    BACK: { ...input.settings, image: null },
  } });
  const adopted = adoptEarlyGeometry(geometry, 'FRONT', packet, input);
  assert.equal(adopted.geometry.profile, 'POKEMON'); assert.equal(adopted.geometry.sides.FRONT.physical.actor, 'ASTRA');
  assert.deepEqual(adopted.geometry.sides.BACK, geometry.sides.BACK); assert.equal(adopted.geometry.sides.FRONT.confirmation, null);
  const human = applyGeometryEdit(geometry, { side: 'FRONT', kind: 'PHYSICAL', base: geometryBase(geometry, 'FRONT', 'PHYSICAL'), quad, actor: 'HUMAN', proposal: null }).state;
  assert.throws(() => adoptEarlyGeometry(human, 'FRONT', packet, input), e => e.code === 'GEOMETRY_CACHE_STALE');
  const altered = structuredClone(packet); altered.physical.identity = { ...altered.physical.identity, opencv: 'other' };
  assert.throws(() => adoptEarlyGeometry(geometry, 'FRONT', altered, input), e => e.code === 'GEOMETRY_STORED_CONTENT_INVALID');
});

test('queued clean-photo dependency does not claim geometry capacity or block opening manual outlines',async()=>{
 const f=await fixture();let cleanReady=false;const service=f.build({isCleanPhotoPrepared:async()=>cleanReady});
 try{
  const front=await f.upload('FRONT');await service.sourcePrepared(f.staff,f.cardId,front.uploadId);
  const status=await service.ensure(f.staff,f.cardId);assert.equal(status.earlyGeometry.FRONT.state,'QUEUED');
  await pause(30);assert.equal(f.jobs.size,0);assert.equal(f.calls,0);
  const result=await service.consume(f.staff,f.cardId,'FRONT',front,f.photos.get(front.uploadId),settings);
  assert.equal(result.packet,null);assert.equal(f.calls,0);
  cleanReady=true;await service.ensure(f.staff,f.cardId);await until(()=>f.calls===1);
  assert.equal(f.jobs.size,1);
 }finally{await service.stop();}
});


test('historical engine discovery advances past saved photos without purchasing a replacement',async()=>{
 const f=await fixture(),service=f.build();let reads=0;const originalPending=f.store.pending;
 f.store.pending=async(...args)=>(await originalPending(...args)).map(row=>({...row,previous_engine:!!++reads}));
 try{
  const front=await f.upload('FRONT');await service.sourcePrepared(f.staff,f.cardId,front.uploadId);
  await until(()=>reads>=1);assert.equal(f.calls,0);assert.equal(f.jobs.size,0);
  await service.ensure(f.staff,f.cardId,{side:'FRONT',expectedKey:(await service.status(f.staff,f.cardId)).FRONT.key});
  await until(()=>f.calls===1);assert.equal(f.jobs.size,1);
 }finally{await service.stop();}
});


for(const cleaned of [false,true])test(`ordinary discovery releases failed Front using its original while ${cleaned?'Photoroom cleaned':'historical generated'} Back retains its own frame and cache`,async()=>{
 const f=await fixture(),front=await f.upload('FRONT'),back=await f.upload('BACK');
 const frontPhoto=f.photos.get(front.uploadId),backPhoto=f.photos.get(back.uploadId);
 const saved=cleaned?await savedBackgroundRemovedPhoto(backPhoto,(await f.storage.readDecodedFrame({frame:backPhoto.workingFrame,original:backPhoto.original,decodePlan:backPhoto.decodePlan})).bytes)
  :await savedGradingPhoto(backPhoto);
 const failed={key:digest('failed-front'),state:'FAILED',result:null,code:'REPORT_IMAGE_REQUEST_REJECTED',source_hash:frontPhoto.workingFrame.raster.content.sha256,bound_original_sha256:frontPhoto.original.content.sha256};
 const ready={...saved.row,result:saved.result},before=canonical(failed),observed={};
 const reader=createGradingPhotoReader({photo:async(_card,_upload,side)=>side==='FRONT'?failed:ready,
  storage:{readDecodedFrame:input=>[3,4].includes(input.frame.schemaVersion)?Promise.resolve({bytes:saved.bytes}):f.storage.readDecodedFrame(input)}});
 const service=f.build({isCleanPhotoPrepared:reader.isPhotoPrepared,readGradingPhoto:reader.readGradingPhoto,runVisual:async input=>{
  observed[input.job.input.side]=input.source;
  const {request,evidence}=await prepareAstraGeometryRequest({source:input.source,side:input.job.input.side});
  assert.equal(request.reasoning.effort,'xhigh');
  return{responseHash:digest(input.job.input.side),evidence,physical:{quad:null,contour:[],uncertainty:'HIGH',observation:'No fixture outline.'},printed:{quad:null,uncertainty:'HIGH',observation:'No fixture frame.'}};
 }});
 try{
  f.intents.add(front.uploadId);f.intents.add(back.uploadId);service.start();
  await until(()=>f.jobs.size===2&&[...f.jobs.values()].every(j=>j.state==='NEEDS_REVIEW'));
  for(const [side,upload,photo,frame] of [['FRONT',front,frontPhoto,frontPhoto.workingFrame],['BACK',back,backPhoto,saved.frame]]){
   const found=await service.consume(f.staff,f.cardId,side,upload,photo,settings);
   assert.equal(found.input.frameDescriptorSha256,descriptorSha256(frame));assert.deepEqual(found.packet.photoFrame,frame);
   assert.deepEqual(observed[side].frame,frame);assert.equal(digest(observed[side].bytes),frame.raster.content.sha256);
  }
  assert.equal(observed.FRONT.frame.generation,undefined);assert.equal(observed.BACK.frame.schemaVersion,cleaned?4:3);
  assert.equal(canonical(failed),before);assert.equal(f.jobs.size,2);
 }finally{await service.stop();}
});
