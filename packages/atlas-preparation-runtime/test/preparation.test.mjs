import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { descriptorSha256, parseDecodedFrame } from '@atlas/photo-core';
import { describeDecodedFrame, verifyAndDecodePhoto } from '@atlas/photo-runtime';
import { applyGeometryEdit, createGeometryWorkspace, geometryBase, updateGeometrySettings } from '@atlas/manual-workspace/geometry-actions';
import { adoptGeometryPreparation, describePreparationDerivative, prepareGeometry,
  preparationRuntimeIdentity, preparePhotoGeometry, prepareDeferredPhotoReveals,
  describePreparationPreview, PREPARATION_LOSSLESS_SETTINGS, PREPARATION_LEGACY_SETTINGS, INSPECTION_PREVIEW_POLICY,
  PREPARATION_FULL_V1, PREPARATION_CORE_V1, PREPARATION_REVEALS_V1, preparationOutputNames } from '../src/index.mjs';
import { runPreparationWorker } from '../src/process.mjs';
import { hashOwnedBytes } from '../src/hash-bytes.mjs';

const python = process.env.ATLAS_PREPARATION_PYTHON;
if (!python?.startsWith('/')) throw new Error('Set ATLAS_PREPARATION_PYTHON to the absolute path of the pinned CPU Python environment');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const limits = { maxInputBytes: 8_000_000, maxPixels: 3_000_000, maxOutputBytes: 8_000_000, timeoutMs: 10000 };
let directory, fixture, workspace, source, prepared, sources;
const input = overrides => ({ workspace, side: 'FRONT', source, pythonExecutable: python, limits, ...overrides });
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'atlas-preparation-test-'));
  execFileSync(python, [fileURLToPath(new URL('../../atlas-manual-workspace/scripts/generate-preview.py', import.meta.url)), directory]);
  fixture = JSON.parse(await readFile(join(directory, 'fixture.json')));
  sources = {};
  for (const side of ['FRONT', 'BACK']) {
    const bytes = await readFile(join(directory, `${side.toLowerCase()}-original.png`));
    const decoded = await verifyAndDecodePhoto({ bytes,
      uploadPlan: { schemaVersion: 1, uploadId: `test-${side}`, binding: { cardId: 'preparation-fixture', pairId: 'pair', side, version: 1 },
        object: { key: `originals/${side}`, versionId: null }, expected: { sha256: sha(bytes), byteCount: bytes.length } },
      observedObject: { key: `originals/${side}`, versionId: 'one' },
      limits: { ...limits, maxRasterBytes: 30_000_000 } });
    sources[side] = { original: decoded.original, decodePlan: decoded.decodePlan, bytes: decoded.png,
      frame: describeDecodedFrame(decoded, { id: `decoded-${side}`, object: { key: `decoded/${side}`, versionId: 'one' } }) };
  }
  workspace = createGeometryWorkspace({ cardId: 'preparation-fixture', profile: 'SPORTS', sides: Object.fromEntries(['FRONT','BACK'].map(side => {
    const value = sources[side];
    return [side, { cornerShape: 'SQUARE', matColor: 'BLACK', image: { version: 1, originalSha256: value.original.content.sha256,
      frameId: value.frame.id, frameSha256: value.frame.raster.content.sha256, ...value.frame.raster.dimensions, coordinateSpace: 'ORIENTED_DECODED' } }];
  })) });
  workspace = applyGeometryEdit(workspace, { side: 'FRONT', kind: 'PHYSICAL', base: geometryBase(workspace,'FRONT','PHYSICAL'), quad: fixture.FRONT.physical, actor: 'HUMAN', proposal: null }).state;
  source = sources.FRONT;
  prepared = await prepareGeometry(input());
});
after(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

test('real CPU preparation yields exact canonical frames, source transform without a competing visual proposal', () => {
  assert.deepEqual(Object.keys(prepared.outputs), ['rectified','inspection','normalized','microDefect','directional']);
  assert.deepEqual(prepared.frame.inspection.cardBounds, { x: 40, y: 40, width: 1270, height: 1778 });
  assert.equal(prepared.identity.opencv, '4.10.0');
  for (const output of Object.values(prepared.outputs)) assert.equal(sha(output.bytes), output.sha256);
  assert.equal(prepared.proposal, null);
  assert.equal(workspace.sides.FRONT.prepared, null);
  const result = adoptGeometryPreparation(workspace, prepared);
  assert.equal(result.proposalApplied, false);
  assert.equal(result.state.sides.FRONT.printed, null);
  assert.equal(result.state.sides.FRONT.confirmation, null);
  assert.deepEqual(result.state.sides.BACK, workspace.sides.BACK);
});

test('all five lossless outputs decode to unchanged warp/reveal samples including expanded grayscale', async () => {
  const sourcePath = join(directory, 'decoded.png'); await writeFile(sourcePath, source.bytes);
  const service = fileURLToPath(new URL('../../../backend/ai-grader-speedster-service/', import.meta.url));
  for (const [name, output] of Object.entries(prepared.outputs)) await writeFile(join(directory, `${name}.webp`), output.bytes);
  const script = `import sys,json,hashlib\nfrom pathlib import Path\nimport cv2,numpy as np\nsys.path.insert(0,sys.argv[1])\nfrom card_geometry import warp_to_card_map,warp_to_inspection_map\nfrom preparation_pixels import reveal_views\nimage=cv2.imread(sys.argv[2]);quad=np.float32(json.loads(sys.argv[3]))\nr,m=warp_to_card_map(image,quad);i,_=warp_to_inspection_map(image,quad);n,u,d=reveal_views(i)\nfor name,expected in zip(['rectified','inspection','normalized','microDefect','directional'],[r,i,n,u,d]):\n expected=cv2.cvtColor(expected,cv2.COLOR_GRAY2BGR) if expected.ndim==2 else expected\n actual=cv2.imread(str(Path(sys.argv[4],name+'.webp')),cv2.IMREAD_UNCHANGED)\n assert actual.shape==expected.shape and actual.dtype==expected.dtype and np.array_equal(actual,expected),name\nprint('pass')\n`;
  const quad = fixture.FRONT.physical.map(p => [p.x*1200,p.y*1540]);
  assert.equal(execFileSync(python, ['-I','-c',script,service,sourcePath,JSON.stringify(quad),directory],
    { encoding: 'utf8', env: { PATH: process.env.PATH, OPENBLAS_NUM_THREADS: '1', OMP_NUM_THREADS: '1' } }).trim(), 'pass');
  assert.deepEqual(prepared.encoderSettings, PREPARATION_LOSSLESS_SETTINGS);
});

test('identity-independent preparation retains actual proposals and all five lossless image hashes', async () => {
  const engine = await preparationRuntimeIdentity(python);
  assert.equal(engine.identity.opencv, '4.10.0'); assert.ok(Object.keys(engine.native).length > 0);
  const options = { source, matColor: 'BLACK', limits, pythonExecutable: python, engine };
  const early = await preparePhotoGeometry({ ...options, quad: workspace.sides.FRONT.physical.quad,
    encoderSettings: PREPARATION_LEGACY_SETTINGS });
  assert.deepEqual(early.encoderSettings, PREPARATION_LOSSLESS_SETTINGS);
  assert.deepEqual(Object.values(early.outputs).map(o => o.sha256), Object.values(prepared.outputs).map(o => o.sha256));
  assert.deepEqual(early.frame.sourceToRectified, prepared.frame.sourceToRectified);
  assert.deepEqual(early.proposal, prepared.proposal);
  const changed = structuredClone(engine); changed.identity.opencv = 'unmatched-runtime';
  await assert.rejects(preparePhotoGeometry({ ...options, quad: workspace.sides.FRONT.physical.quad, engine: changed }), e => e.code === 'PREPARATION_ENGINE_CHANGED');
});

test('generated transparent photographs prepare through automatic and human-save paths with the same exact visible pixels', async () => {
  const path = join(directory, 'generated-transparent.png');
  execFileSync(python, ['-I', '-c', `import sys,cv2,numpy as np\ny,x=np.indices((1540,1200))\na=np.stack([(3*x+y)%256,(x+2*y)%256,(2*x+3*y)%256,np.where((x>100)&(x<1100)&(y>140)&(y<1400),255,0)],axis=2).astype(np.uint8)\na[140:143,100:1100,3]=1\nassert cv2.imwrite(sys.argv[1],a)`, path]);
  const bytes = await readFile(path), originalHash = sha(bytes);
  const frame = parseDecodedFrame({ schemaVersion: 3, kind: 'decoded-frame', id: 'synthetic-generated-transparent',
    originalDescriptorSha256: descriptorSha256(source.original), decodePlanSha256: descriptorSha256(source.decodePlan),
    raster: { content: { mime: 'image/png', sha256: originalHash, byteCount: bytes.length }, dimensions: { width: 1200, height: 1540 },
      object: { key: 'generated/transparent.png', versionId: 'one' } }, sourceToFrame: [1,0,0,0,1,0,0,0,1],
    treatment: { decoder: 'synthetic-generator', version: 'v1', policyVersion: 'atlas-generated-grading-image-v1',
      channels: 4, bitDepth: 8, colorSpace: 'sRGB', colorTreatment: 'converted', hdrTreatment: 'not-present' },
    generation: { sourceFrame: source.frame, recipeHash: 'a'.repeat(64), model: 'synthetic-generator', promptVersion: 'v1' } }, source.original, source.decodePlan);
  const generated = { ...source, frame, bytes };
  let geometry = createGeometryWorkspace({ cardId: workspace.cardId, profile: 'SPORTS', sides: Object.fromEntries(['FRONT','BACK'].map(side => [side,
    { matColor: 'BLACK', cornerShape: 'SQUARE', image: side === 'FRONT' ? { ...workspace.sides.FRONT.image, frameId: frame.id, frameSha256: originalHash } : workspace.sides.BACK.image }])) });
  geometry = applyGeometryEdit(geometry, { side: 'FRONT', kind: 'PHYSICAL', base: geometryBase(geometry, 'FRONT', 'PHYSICAL'),
    quad: fixture.FRONT.physical, actor: 'HUMAN', proposal: null }).state;
  const before = structuredClone(geometry);
  const manual = await prepareGeometry(input({ workspace: geometry, source: generated }));
  const automatic = await preparePhotoGeometry({ source: generated, matColor: 'BLACK', quad: geometry.sides.FRONT.physical.quad,
    engine: await preparationRuntimeIdentity(python), limits, pythonExecutable: python, outputContract: PREPARATION_CORE_V1 });
  assert.deepEqual(geometry, before); assert.equal(sha(bytes), originalHash);
  for (const name of ['rectified','inspection']) {
    assert.deepEqual(manual.outputs[name].bytes, automatic.outputs[name].bytes);
    assert.deepEqual(manual.outputs[name].frameToDerivative, automatic.outputs[name].frameToDerivative);
    await writeFile(join(directory, `transparent-${name}.webp`), manual.outputs[name].bytes);
  }
  const service = fileURLToPath(new URL('../../../backend/ai-grader-speedster-service/', import.meta.url));
  const check = `import sys,json,cv2,numpy as np\nfrom pathlib import Path\nsys.path.insert(0,sys.argv[1])\nfrom card_geometry import warp_to_card_map,warp_to_inspection_map\na=cv2.imread(sys.argv[2],cv2.IMREAD_UNCHANGED);q=np.float32(json.loads(sys.argv[3]))\nfor name,fn in [('rectified',warp_to_card_map),('inspection',warp_to_inspection_map)]:\n expected,_=fn(a,q);actual=cv2.imread(str(Path(sys.argv[4],'transparent-'+name+'.webp')),cv2.IMREAD_UNCHANGED)\n assert actual.shape==expected.shape\n assert np.array_equal(actual[:,:,3],expected[:,:,3]),name\n visible=expected[:,:,3]>0\n assert np.array_equal(actual[visible,:3],expected[visible,:3]),name\n assert np.any(actual[~visible,:3]!=0),name\nprint('pass')`;
  assert.equal(execFileSync(python, ['-I','-c',check,service,path,JSON.stringify(fixture.FRONT.physical.map(p => [p.x*1200,p.y*1540])),directory], { encoding: 'utf8' }).trim(), 'pass');
  const adopted = adoptGeometryPreparation(geometry, manual).state;
  assert.equal(adopted.sides.FRONT.prepared.frame.id, manual.frame.id);
  assert.deepEqual(adopted.sides.FRONT.physical, before.sides.FRONT.physical);
  assert.equal(adopted.sides.FRONT.confirmation, null);
});

test('Photoroom alpha-only frame reaches automatic and human preparation with unchanged canonical geometry', async () => {
  const path=join(directory,'segmentation.png'),inputPath=join(directory,'segmentation-source.png');
  await writeFile(inputPath,source.bytes);
  execFileSync(python,['-I','-c',`import sys,cv2,numpy as np,math\na=cv2.imread(sys.argv[1],cv2.IMREAD_UNCHANGED)\nassert a.dtype==np.uint8 and a.shape[2]==3\nb=cv2.cvtColor(a,cv2.COLOR_BGR2BGRA);r=b.reshape(-1,4);n=math.ceil(len(r)*0.001);r[:n,3]=0;r[n,3]=127\nassert np.array_equal(a,b[:,:,:3]);assert cv2.imwrite(sys.argv[2],b)`,inputPath,path]);
  const bytes=await readFile(path),pixels=source.frame.raster.dimensions.width*source.frame.raster.dimensions.height,transparent=Math.ceil(pixels*0.001);
  const frame=parseDecodedFrame({schemaVersion:4,kind:'decoded-frame',id:'synthetic-segmentation',
    originalDescriptorSha256:descriptorSha256(source.original),decodePlanSha256:descriptorSha256(source.decodePlan),
    raster:{object:{key:'derived/segmentation.png',versionId:'one'},content:{mime:'image/png',sha256:sha(bytes),byteCount:bytes.length},dimensions:source.frame.raster.dimensions},
    sourceToFrame:source.frame.sourceToFrame,treatment:{decoder:'photoroom-plus-hd-background-removal',version:'plus-hd-auto',policyVersion:'atlas-background-removal-grading-image-v1',channels:4,bitDepth:8,colorSpace:'sRGB',colorTreatment:'preserved',hdrTreatment:'not-present'},
    segmentation:{sourceFrame:source.frame,recipeHash:'a'.repeat(64),provider:'PHOTOROOM_PLUS',endpoint:'https://image-api.photoroom.com/v2/edit',
      foregroundRGB:{validation:'bounded-edge-rgb-v1',visiblePixels:pixels-transparent,opaquePixels:pixels-transparent-1,fractionalPixels:1,
        comparedChannels:3,mismatchedPixels:0,mismatchedChannels:0,opaqueMismatchedPixels:0,minChannelDelta:0,maxChannelDelta:0},
      alphaBoundary:{validation:'exterior-alpha-band-v1',connectivity:4,distanceMetric:'manhattan',maxFractionalDistance:1,
        enclosedTransparentPixels:0,enclosedFractionalPixels:0}}},source.original,source.decodePlan);
  const cleaned={...source,frame,bytes},geometry=structuredClone(workspace);
  Object.assign(geometry.sides.FRONT.image,{frameId:frame.id,frameSha256:sha(bytes)});
  const manual=await prepareGeometry(input({workspace:geometry,source:cleaned}));
  const automatic=await preparePhotoGeometry({source:cleaned,matColor:'BLACK',quad:geometry.sides.FRONT.physical.quad,
    engine:await preparationRuntimeIdentity(python),limits,pythonExecutable:python,outputContract:PREPARATION_CORE_V1});
  for(const name of ['rectified','inspection']){
    assert.deepEqual(manual.outputs[name].bytes,automatic.outputs[name].bytes);
    assert.deepEqual(manual.outputs[name].frameToDerivative,prepared.outputs[name].frameToDerivative);
  }
  assert.equal(manual.frameDescriptorSha256,descriptorSha256(frame));assert.equal(sha(bytes),frame.raster.content.sha256);
  assert.equal(geometry.sides.FRONT.confirmation,null);
});

test('versioned core preparation preserves canonical core bytes and transforms; lazy reveals preserve its analysis frame', async () => {
  const engine = await preparationRuntimeIdentity(python);
  const options = { source, matColor: 'BLACK', limits, pythonExecutable: python, engine };
  const core = await preparePhotoGeometry({ ...options, quad: workspace.sides.FRONT.physical.quad, outputContract: PREPARATION_CORE_V1 });
  assert.equal(core.outputContract, PREPARATION_CORE_V1);
  assert.deepEqual(Object.keys(core.outputs), ['rectified', 'inspection']);
  assert.deepEqual(core.sourceQuad, workspace.sides.FRONT.physical.quad);
  for (const name of ['rectified', 'inspection']) {
    assert.deepEqual(core.outputs[name].bytes, prepared.outputs[name].bytes);
    assert.deepEqual(core.outputs[name].frameToDerivative, prepared.outputs[name].frameToDerivative);
  }
  assert.deepEqual(core.proposal, prepared.proposal);
  assert.deepEqual(core.frame.sourceToRectified, prepared.frame.sourceToRectified);
  const { outputs, inspectionPreview, ...metadata } = core, before = structuredClone(metadata);
  const reveals = await prepareDeferredPhotoReveals({ ...options, prepared: metadata });
  assert.deepEqual(metadata, before);
  assert.equal(reveals.parentPreparationId, core.id);
  assert.equal(reveals.outputContract, PREPARATION_REVEALS_V1);
  assert.deepEqual(reveals.frame, core.frame);
  assert.deepEqual(Object.keys(reveals.outputs), ['normalized', 'microDefect', 'directional']);
  for (const name of Object.keys(reveals.outputs)) {
    assert.deepEqual(reveals.outputs[name].bytes, prepared.outputs[name].bytes);
    const descriptor = describePreparationDerivative(reveals, name, source, { id: name, object: { key: `lazy/${name}`, versionId: null } });
    assert.equal(descriptor.frameDescriptorSha256, core.frameDescriptorSha256);
  }
  // A stored hash or proposal change must never rebind old analysis to new work.
  const differentPixels = structuredClone(metadata); differentPixels.frame.inspection.sha256 = 'a'.repeat(64);
  await assert.rejects(prepareDeferredPhotoReveals({ ...options, prepared: differentPixels }), e => e.code === 'PREPARATION_SOURCE_MISMATCH');
  const differentProposal = structuredClone(metadata); differentProposal.proposal = { outcome: 'ABSTAIN' };
  await assert.rejects(prepareDeferredPhotoReveals({ ...options, prepared: differentProposal }), e => e.code === 'PREPARATION_SOURCE_MISMATCH');
  await assert.rejects(prepareDeferredPhotoReveals({ ...options, prepared: { ...metadata, id: 'f'.repeat(64) } }), e => e.code === 'PREPARATION_SOURCE_MISMATCH');
  const differentTransform = structuredClone(metadata); differentTransform.frame.sourceToRectified[2] += 10;
  await assert.rejects(prepareDeferredPhotoReveals({ ...options, prepared: differentTransform }));
  await assert.rejects(prepareDeferredPhotoReveals({ ...options, source: { ...source, bytes: prepared.outputs.inspection.bytes }, prepared: metadata }),
    e => ['PREPARATION_SOURCE_MISMATCH', 'PREPARATION_LIMIT'].includes(e.code));
});

test('contracts distinguish legacy full outputs, reject malformed requests and do not expose phantom reveal descriptors', async () => {
  assert.deepEqual(preparationOutputNames(), ['rectified', 'inspection', 'normalized', 'microDefect', 'directional']);
  assert.equal(prepared.outputContract, PREPARATION_FULL_V1);
  assert.throws(() => preparationOutputNames(PREPARATION_CORE_V1).push('normalized'), TypeError);
  const engine = await preparationRuntimeIdentity(python);
  for (const outputContract of [null, 'core', {}, [], PREPARATION_REVEALS_V1]) {
    if (outputContract !== PREPARATION_REVEALS_V1) assert.throws(() => preparationOutputNames(outputContract), e => e.code === 'PREPARATION_OUTPUT_INVALID');
    await assert.rejects(preparePhotoGeometry({ source, matColor: 'BLACK', limits, pythonExecutable: python, engine,
      quad: workspace.sides.FRONT.physical.quad, outputContract }), e => e.code === 'PREPARATION_OUTPUT_INVALID');
  }
  const missing = { ...prepared, outputs: {} };
  assert.throws(() => describePreparationDerivative(missing, 'normalized', source, { id: 'absent', object: { key: 'absent', versionId: null } }),
    e => e.code === 'PREPARATION_SOURCE_MISMATCH');
});

test('late preparation cannot erase a newer physical edit; changed mat keeps warp but discards old proposal', () => {
  const changed = applyGeometryEdit(workspace, { side: 'FRONT', kind: 'PHYSICAL', base: geometryBase(workspace,'FRONT','PHYSICAL'), quad: fixture.FRONT.physical.map(p => ({ ...p, x: p.x+.001 })), actor: 'HUMAN', proposal: null }).state;
  assert.throws(() => adoptGeometryPreparation(changed, prepared), error => error.code === 'ATLAS_GEOMETRY_STALE');
  const recolored = updateGeometrySettings(workspace, { side: 'FRONT', base: geometryBase(workspace,'FRONT','SETTINGS'), cornerShape: 'SQUARE', matColor: 'WHITE' }).state;
  const result = adoptGeometryPreparation(recolored, prepared);
  assert.equal(result.proposalApplied, false);
  assert.equal(result.state.sides.FRONT.printed, null);
  assert.deepEqual(result.state.sides.FRONT.prepared.frame, prepared.frame);
});

test('every stored derivative binds actual bytes, current decoded source and exact transform/settings', () => {
  for (const name of Object.keys(prepared.outputs)) {
    const descriptor = describePreparationDerivative(prepared, name, source, { id: name, object: { key: `prepared/${name}`, versionId: 'stored-one' } });
    assert.equal(descriptor.raster.content.sha256, sha(prepared.outputs[name].bytes));
    assert.deepEqual(descriptor.frameToDerivative, prepared.outputs[name].frameToDerivative);
  }
  const altered = structuredClone(prepared); altered.outputs.rectified.bytes[10] ^= 1;
  assert.throws(() => describePreparationDerivative(altered,'rectified',source,{id:'r',object:{key:'prepared/r',versionId:null}}), error => error.code === 'PREPARATION_SOURCE_MISMATCH');
});

test('inspection context preview binds canonical lossless bytes and never enters canonical outputs', () => {
  const preview = prepared.inspectionPreview;
  assert.equal(preview.policyVersion, INSPECTION_PREVIEW_POLICY);
  assert.equal(preview.sourceSha256, prepared.frame.inspection.sha256);
  assert.equal(preview.mime, 'image/jpeg');
  assert.deepEqual([preview.width, preview.height], [558, 768]);
  assert.ok(preview.byteCount > 0 && preview.byteCount <= 1024 * 1024);
  assert.ok(!Object.hasOwn(prepared.outputs, 'inspectionPreview'));
  const destination = { id: 'preview', object: { key: 'prepared/preview.jpg', versionId: 'one' } };
  const descriptor = describePreparationPreview(prepared, source, destination);
  assert.equal(descriptor.purpose, 'preview');
  assert.equal(descriptor.raster.content.sha256, sha(preview.bytes));
  for (const change of [value => { value.inspectionPreview.sourceSha256 = 'a'.repeat(64); },
    value => { value.inspectionPreview.bytes[8] ^= 1; }, value => { value.inspectionPreview.width = 769; },
    value => { value.inspectionPreview.policyVersion = 'unknown'; },
    value => { value.encoderSettings = PREPARATION_LEGACY_SETTINGS; }]) {
    const bad = structuredClone(prepared); change(bad);
    assert.throws(() => describePreparationPreview(bad, source, destination), e => e.code.startsWith('PREPARATION_'));
  }
});

test('retained quality92 core regenerates exact historical reveals without replacing its frame or admitting it as new work', async () => {
  const engine = await preparationRuntimeIdentity(python), historicalEngine = structuredClone(engine);
  delete historicalEngine.identity.sources['preparation_encoding.py'];
  historicalEngine.identity.physicalProposalPolicy = 'atlas-native-photo-outer-ranking-v2';
  historicalEngine.identity.sources['atlas_photo_geometry.py'] = '19f71cd33e2ce3a780f5a70638503d27a66ac648e1cf3d83d71f6438a24d36dc';
  delete historicalEngine.encodingAdapterSha256;
  historicalEngine.workerSha256 = 'a'.repeat(64); historicalEngine.adapterSha256 = 'b'.repeat(64);
  const outputDirectory = join(directory, 'legacy'); await mkdir(outputDirectory);
  const inputPath = join(outputDirectory, 'input.png'); await writeFile(inputPath, source.bytes);
  const quad = workspace.sides.FRONT.physical.quad;
  const historical = await runPreparationWorker(python, fileURLToPath(new URL('../../../backend/ai-grader-speedster-service/manual_preparation_worker.py', import.meta.url)),
    { mode: 'PREPARE', matColor: 'BLACK', quad, encoderSettings: PREPARATION_LEGACY_SETTINGS, outputContract: PREPARATION_FULL_V1,
      inputPath, outputDirectory, source: { ...source.frame.raster.dimensions, ...source.frame.raster.content }, limits }, { timeoutMs: limits.timeoutMs });
  assert.equal(historical.inspectionPreview, undefined);
  const frameDescriptorSha256 = descriptorSha256(source.frame);
  const id = descriptorSha256({ mode: 'PREPARE', matColor: 'BLACK', quad, frameDescriptorSha256, engine: historicalEngine,
    proposal: historical.proposal, outputContract: PREPARATION_CORE_V1 });
  const retained = { id, frameDescriptorSha256, identity: historicalEngine.identity, proposal: historical.proposal,
    encoderSettings: PREPARATION_LEGACY_SETTINGS, outputContract: PREPARATION_CORE_V1, sourceQuad: quad,
    frame: { ...structuredClone(prepared.frame), id: `prepared-${id}`, version: 1 } };
  for (const name of ['rectified', 'inspection']) retained.frame[name].sha256 = historical.frames[name].sha256;
  const before = structuredClone(retained), options = { source, matColor: 'BLACK', limits, pythonExecutable: python, engine: historicalEngine, prepared: retained };
  const reveals = await prepareDeferredPhotoReveals(options);
  assert.deepEqual(retained, before); assert.deepEqual(reveals.frame, retained.frame);
  assert.deepEqual(reveals.encoderSettings, PREPARATION_LEGACY_SETTINGS);
  assert.equal(reveals.inspectionPreview, undefined);
  for (const name of ['normalized', 'microDefect', 'directional']) {
    assert.deepEqual(reveals.outputs[name].bytes, await readFile(join(outputDirectory, `${name}.webp`)));
    assert.equal(describePreparationDerivative(reveals, name, source, { id: name, object: { key: `history/${name}`, versionId: null } }).purpose, 'reveal');
  }
  const changed = structuredClone(retained); changed.frame.inspection.sha256 = 'c'.repeat(64);
  await assert.rejects(prepareDeferredPhotoReveals({ ...options, prepared: changed }), e => e.code === 'PREPARATION_SOURCE_MISMATCH');
  await assert.rejects(prepareDeferredPhotoReveals({ ...options, prepared: { ...retained, id: 'd'.repeat(64) } }), e => e.code === 'PREPARATION_SOURCE_MISMATCH');
  await assert.rejects(preparePhotoGeometry({ source, matColor: 'BLACK', quad, limits, pythonExecutable: python, engine: historicalEngine }),
    e => e.code === 'PREPARATION_ENGINE_CHANGED');
});

test('wrong bytes/side/frame, unsupported raster treatment and input/output bounds fail explicitly', async () => {
  const badBytes = Buffer.from(source.bytes); badBytes[50] ^= 1;
  await assert.rejects(prepareGeometry(input({ source: { ...source, bytes: badBytes } })), error => error.code === 'PREPARATION_SOURCE_MISMATCH');
  await assert.rejects(prepareGeometry(input({ side: 'BACK' })), error => error.code === 'PREPARATION_SOURCE_MISMATCH');
  const deep = structuredClone(source); deep.frame.treatment.bitDepth = 16;
  await assert.rejects(prepareGeometry(input({ source: deep })), error => error.code === 'PREPARATION_RASTER_UNSUPPORTED');
  await assert.rejects(prepareGeometry(input({ limits: { ...limits, maxInputBytes: 1 } })), error => error.code === 'PREPARATION_LIMIT');
  await assert.rejects(prepareGeometry(input({ limits: { ...limits, maxOutputBytes: 1 } })), error => error.code === 'PREPARATION_LIMIT');
});

test('caller mutation cannot change the captured source or decode resource limits after dispatch', async () => {
  const capturedLimits = { ...limits }, bytes = Buffer.from(source.bytes);
  const pending = prepareGeometry(input({ limits: capturedLimits, source: { ...source, bytes } }));
  capturedLimits.timeoutMs = 1; capturedLimits.maxOutputBytes = 1; bytes.fill(0);
  const result = await pending;
  assert.equal(result.outputs.rectified.sha256, prepared.outputs.rectified.sha256);
});

test('large preparation digests match the independent synchronous SHA-256 oracle and reject cancellation', async () => {
  for (const size of [1024 * 1024 - 1, 1024 * 1024, 3 * 1024 * 1024]) {
    const bytes = Buffer.alloc(size); for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
    assert.equal(await hashOwnedBytes(bytes), sha(bytes));
  }
  const controller = new AbortController(), pending = hashOwnedBytes(Buffer.alloc(3 * 1024 * 1024), controller.signal);
  controller.abort(); await assert.rejects(pending, error => error.code === 'PREPARATION_CANCELLED');
});

test('early preparation snapshots source lineage, quad, engine and limits before asynchronous hashing', async () => {
  const engine = await preparationRuntimeIdentity(python), captured = structuredClone(source);
  const quad = structuredClone(workspace.sides.FRONT.physical.quad), capturedLimits = { ...limits };
  const pending = preparePhotoGeometry({ source: captured, matColor: 'BLACK', quad,
    limits: capturedLimits, pythonExecutable: python, engine, outputContract: PREPARATION_CORE_V1 });
  captured.bytes.fill(0); captured.frame.raster.content.sha256 = '0'.repeat(64);
  captured.original.content.sha256 = '0'.repeat(64); quad[0].x = 999;
  engine.identity.opencv = 'changed'; capturedLimits.maxOutputBytes = 1;
  const result = await pending;
  assert.equal(result.outputs.rectified.sha256, prepared.outputs.rectified.sha256);
  assert.equal(result.outputs.inspection.sha256, prepared.outputs.inspection.sha256);
});

test('native worker timeout and abort reap the actual child before returning; malformed signal spawns nothing', async () => {
  const path = join(directory,'blocking.py'), pidPath = join(directory,'pid');
  await writeFile(path, `import os\nfrom pathlib import Path\nPath(${JSON.stringify(pidPath)}).write_text(str(os.getpid()))\nwhile True: pass\n`);
  const alive = async () => { const pid = Number(await readFile(pidPath)); assert.throws(() => process.kill(pid,0), error => error.code === 'ESRCH'); };
  await assert.rejects(runPreparationWorker(python,path,{}, { timeoutMs: 250 }), error => error.code === 'PREPARATION_TIMEOUT');
  await alive();
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(),250);
  try { await assert.rejects(runPreparationWorker(python,path,{}, { timeoutMs: 3000, signal: controller.signal }), error => error.code === 'PREPARATION_CANCELLED'); }
  finally { clearTimeout(timer); }
  await alive();
  await assert.rejects(prepareGeometry(input({ signal: {} })), error => error.code === 'PREPARATION_INVALID');
});

test('extracted pixel engines retain unchanged function bodies and no service/model imports', async () => {
  const service = fileURLToPath(new URL('../../../backend/ai-grader-speedster-service/', import.meta.url));
  const script = `import ast,sys,json,hashlib\nfrom pathlib import Path\nr=Path(sys.argv[1]);old=(r/'preparation_core.py').read_text();new=(r/'preparation_pixels.py').read_text();m=json.loads((r/'preparation-pixels-extraction.json').read_text())\nassert hashlib.sha256(old.encode()).hexdigest()==m['sourceSha256']\nf=lambda s:{n.name:ast.get_source_segment(s,n) for n in ast.parse(s).body if isinstance(n,ast.FunctionDef)}\nassert {k:f(old)[k] for k in m['functions']}==f(new)\nassert [n.names[0].name for n in ast.parse(new).body if isinstance(n,ast.Import)]==['cv2','numpy']\nprint('pass')`;
  assert.equal(execFileSync(python,['-I','-c',script,service],{encoding:'utf8'}).trim(),'pass');
});

test('qualified physical-only update regenerates lossless reveals without changing historical pixels or allowing other engine changes',async()=>{
 const engine=await preparationRuntimeIdentity(python),historical=structuredClone(engine);
 historical.identity.physicalProposalPolicy='atlas-native-photo-outer-ranking-v2';
 historical.identity.sources['atlas_photo_geometry.py']='19f71cd33e2ce3a780f5a70638503d27a66ac648e1cf3d83d71f6438a24d36dc';
 historical.adapterSha256='577707037436c234895d6d3c96e6af532d343be7f77a9f8a67810171b479056b';
 const retain=old=>{
  const {outputs,inspectionPreview,...value}=structuredClone(prepared);
  value.identity=structuredClone(old.identity);value.outputContract=PREPARATION_CORE_V1;value.sourceQuad=structuredClone(workspace.sides.FRONT.physical.quad);
  value.id=descriptorSha256({mode:'PREPARE',matColor:'BLACK',quad:value.sourceQuad,frameDescriptorSha256:value.frameDescriptorSha256,engine:old,proposal:value.proposal,outputContract:PREPARATION_CORE_V1});
  value.frame.id=`prepared-${value.id}`;return value;
 };
 const retained=retain(historical),before=structuredClone(retained);
 const options={source,matColor:'BLACK',limits,pythonExecutable:python,engine:historical,prepared:retained};
 const result=await prepareDeferredPhotoReveals(options);
 assert.deepEqual(retained,before);assert.deepEqual(result.frame,retained.frame);
 for(const name of ['normalized','microDefect','directional'])assert.deepEqual(result.outputs[name].bytes,prepared.outputs[name].bytes);
 for(const mutate of [
  e=>{e.identity.sources['preparation_pixels.py']='a'.repeat(64);},
  e=>{e.executableSha256='a'.repeat(64);},
  e=>{e.native[Object.keys(e.native)[0]]='a'.repeat(64);},
 ]){
  const changed=structuredClone(historical);mutate(changed);
  await assert.rejects(prepareDeferredPhotoReveals({...options,engine:changed,prepared:retain(changed)}),e=>e.code==='PREPARATION_ENGINE_CHANGED');
 }
 const badPixels=structuredClone(retained);badPixels.frame.inspection.sha256='a'.repeat(64);
 await assert.rejects(prepareDeferredPhotoReveals({...options,prepared:badPixels}),e=>e.code==='PREPARATION_SOURCE_MISMATCH');
 await assert.rejects(preparePhotoGeometry({...options,quad:retained.sourceQuad}),e=>e.code==='PREPARATION_ENGINE_CHANGED');
});

test('human outer-quad correction keeps observed source silhouette but recomputes its canonical mask',async()=>{
 const quad=workspace.sides.FRONT.physical.quad;
 const center={x:quad.reduce((n,p)=>n+p.x,0)/4,y:quad.reduce((n,p)=>n+p.y,0)/4};
 const materialContour=quad.map(p=>({x:center.x+(p.x-center.x)*.92,y:center.y+(p.y-center.y)*.92}));
 const first=applyGeometryEdit(workspace,{side:'FRONT',kind:'PHYSICAL',base:geometryBase(workspace,'FRONT','PHYSICAL'),quad,materialContour,actor:'HUMAN'}).state;
 const one=await prepareGeometry(input({workspace:first}));
 const changed=quad.map(p=>({x:center.x+(p.x-center.x)*1.01,y:center.y+(p.y-center.y)*1.01}));
 const edited=applyGeometryEdit(first,{side:'FRONT',kind:'PHYSICAL',base:geometryBase(first,'FRONT','PHYSICAL'),quad:changed,actor:'HUMAN'}).state;
 assert.deepEqual(edited.sides.FRONT.physical.materialContour,materialContour);
 const two=await prepareGeometry(input({workspace:edited}));assert.notDeepEqual(two.frame.materialContour,one.frame.materialContour);
 const[a,b,c,d,e,f,g,h,i]=two.frame.sourceToRectified,{width,height}=source.frame.raster.dimensions;
 const expected=materialContour.map(p=>{const x=p.x*width,y=p.y*height,w=g*x+h*y+i;return{x:(a*x+b*y+c)/w/1269,y:(d*x+e*y+f)/w/1777};});
 assert.deepEqual(two.frame.materialContour,expected);
});

test('inward human corner correction prepares a valid clipped silhouette without changing photo pixels or source evidence',async()=>{
 const {validMaterialContour}=await import('../../atlas-manual-workspace/src/material-contour.mjs');
 const {preparedPointToOriginal}=await import('../../atlas-manual-workspace/src/geometry-actions.mjs');
 const ready=adoptGeometryPreparation(workspace,prepared).state;
 // Rounded corner samples straddle the corrected bottom-left corner. The old
 // per-coordinate clamp collapses several of them onto (0,1).
 const canonical=[[.01,0],[.99,0],[1,.01],[1,.99],[.99,1],[.01,1],[.004,.999],[.001,.996],[0,.99],[0,.01]];
 const materialContour=canonical.map(([x,y])=>preparedPointToOriginal(ready,'FRONT',{x:x*1269/1270,y:y*1777/1778}));
 const quad=workspace.sides.FRONT.physical.quad.map((p,i)=>i===3?{x:p.x+.015,y:p.y-.015}:{...p});
 const edited=applyGeometryEdit(workspace,{side:'FRONT',kind:'PHYSICAL',base:geometryBase(workspace,'FRONT','PHYSICAL'),quad,materialContour,actor:'HUMAN'}).state;
 const before=structuredClone(edited),result=await prepareGeometry(input({workspace:edited}));
 const[a,b,c,d,e,f,g,h,i]=result.frame.sourceToRectified,{width,height}=source.frame.raster.dimensions;
 const clamped=materialContour.map(p=>{const x=p.x*width,y=p.y*height,w=g*x+h*y+i;return{x:Math.max(0,Math.min(1,(a*x+b*y+c)/w/1269)),y:Math.max(0,Math.min(1,(d*x+e*y+f)/w/1777))};});
 assert.equal(validMaterialContour(clamped),false,'the actual native transform reproduces the old failure');
 assert.equal(validMaterialContour(result.frame.materialContour),true);
 assert.deepEqual(edited,before);
 const adopted=adoptGeometryPreparation(edited,result).state;
 assert.deepEqual(adopted.sides.FRONT.physical.materialContour,materialContour);
 assert.deepEqual(adopted.sides.BACK,workspace.sides.BACK);
 assert.equal(adopted.sides.FRONT.printed,null);assert.equal(adopted.sides.FRONT.confirmation,null);
 const withoutContour=structuredClone(edited);delete withoutContour.sides.FRONT.physical.materialContour;
 const unchangedPixels=await prepareGeometry(input({workspace:withoutContour}));
 for(const name of Object.keys(result.outputs))assert.equal(result.outputs[name].sha256,unchangedPixels.outputs[name].sha256);
 assert.deepEqual(result.frame.sourceToRectified,unchangedPixels.frame.sourceToRectified);
});

test('fresh photographic contours survive native preparation, measurement, reviewed report and public packet projection',async()=>{
 const {confirmBothGeometry}=await import('../../atlas-manual-workspace/src/geometry-actions.mjs');
 const {createDefectWorkspace,beginDefectEdit,applyDefectMeasurement,defectBase,markDefectSideInspected,confirmDefectFindings,previewDefectReport}=await import('../../atlas-manual-workspace/src/defect-actions.mjs');
 const {traceAction}=await import('../../atlas-manual-workspace/test/defect-fixtures.mjs');
 const {measureDefectWorkspaceEdit}=await import('../../atlas-measurement-runtime/src/index.mjs');
 const {projectApprovedManualReport}=await import('../../atlas-connected-manual/src/publication.mjs');
 const {parsePublicManualReport}=await import('../../atlas-report-view/src/manual-public-contract.mjs');
 const {parseBinding}=await import('../../atlas-defect-analysis/src/contract.mjs');
 const {validateFrame}=await import('../../atlas-defect-memory/src/contract.mjs');
 let geometry=workspace;const outputs={};
 for(const side of ['FRONT','BACK']){
  const quad=fixture[side].physical,center={x:quad.reduce((n,p)=>n+p.x,0)/4,y:quad.reduce((n,p)=>n+p.y,0)/4};
  const materialContour=quad.map(p=>({x:center.x+(p.x-center.x)*.995,y:center.y+(p.y-center.y)*.995}));
  geometry=applyGeometryEdit(geometry,{side,kind:'PHYSICAL',base:geometryBase(geometry,side,'PHYSICAL'),quad,materialContour,actor:'HUMAN'}).state;
  const result=await prepareGeometry(input({workspace:geometry,side,source:sources[side]}));outputs[side]=result.outputs;
  geometry=adoptGeometryPreparation(geometry,result).state;
  geometry=applyGeometryEdit(geometry,{side,kind:'PRINTED',base:geometryBase(geometry,side,'PRINTED'),quad:[{x:.05,y:.05},{x:.95,y:.05},{x:.95,y:.95},{x:.05,y:.95}],actor:'HUMAN'}).state;
 }
 geometry=confirmBothGeometry(geometry,{base:Object.fromEntries(['FRONT','BACK'].map(side=>[side,geometryBase(geometry,side,'REVIEW')])),actor:'HUMAN',reviewed:true}).state;
 const frames=Object.fromEntries(['FRONT','BACK'].map(side=>{const slot=geometry.sides[side],p=slot.prepared.frame;return[side,{imageVersion:slot.image.version,originalSha256:slot.image.originalSha256,preparationVersion:p.version,frameId:p.id,inspectionImageSha256:p.inspection.sha256,rectifiedImageSha256:p.rectified.sha256,materialContour:p.materialContour}];}));
 for(const frame of Object.values(frames))validateFrame(frame);
 parseBinding({sourceHash:'a'.repeat(64),manualRevision:1,manualContentHash:'b'.repeat(64),identityRevision:1,geometryRevision:1,defectRevision:1,sides:Object.fromEntries(['FRONT','BACK'].map(side=>[side,{frame:frames[side],findingRevision:1,reviewRevision:0}]))});
 let defects=createDefectWorkspace({cardId:geometry.cardId,profile:'SPORTS',sides:Object.fromEntries(['FRONT','BACK'].map(side=>[side,{frame:frames[side],cornerShape:'SQUARE'}]))});
 for(const side of ['FRONT','BACK']){
  defects=beginDefectEdit(defects,{side,base:defectBase(defects,side),actor:'HUMAN',action:traceAction(side,null,[0,0,20,20],side+':photo-corner')}).state;
  const measured=await measureDefectWorkspaceEdit({workspace:defects,side,pythonExecutable:python,limits:{maxInputBytes:8000000,maxOutputBytes:8000000,maxFindings:128,timeoutMs:15000}});
  defects=applyDefectMeasurement(defects,measured).state;
  const pixels=defects.sides[side].findings[0].measurementRegions.reduce((n,r)=>n+r.measurement.pixelCount,0);
  assert(pixels>0&&pixels<400,'Actual silhouette clips only measured area; full 400-pixel trace survives');
  defects=markDefectSideInspected(defects,{side,base:defectBase(defects,side),actor:'HUMAN',inspected:true}).state;
 }
 defects=confirmDefectFindings(defects,{base:Object.fromEntries(['FRONT','BACK'].map(side=>[side,defectBase(defects,side)])),actor:'HUMAN',reviewed:true}).state;
 const full=previewDefectReport(defects,{identity:{playerName:'Synthetic only',year:'2026',manufacturer:'Fixture',productSet:'Contour proof',parallel:null,insert:null,cardNumber:null},centeringQuads:Object.fromEntries(['FRONT','BACK'].map(side=>[side,geometry.sides[side].printed.quad]))});
 const approval={version:'atlas-manual-report-snapshot-v2',report:{fixture:'not persisted'},identity:full.identity,grade:full.grade,finalGrade:full.finalGrade,finalGradePolicy:full.finalGradePolicy,findingCounts:full.findingCounts,ruleVersion:full.ruleVersion};
 const row={public_token:'ar_'+'a'.repeat(24),report_number:'ATLAS-012345ABCDEF',version:1,approved_at:'2026-10-12T00:00:00.000Z',mode:'LOCAL_FIXTURE',report_hash:'c'.repeat(64)};
 const images=Object.fromEntries(['FRONT','BACK'].map(side=>[side,{sha256:frames[side].inspectionImageSha256,byteCount:outputs[side].inspection.bytes.length,width:1350,height:1858,contentType:'image/webp'}]));
 const packet=parsePublicManualReport(projectApprovedManualReport({row,approval,full,geometry,images}));
 assert.equal(packet.report.finalGrade,full.finalGrade);assert.equal(packet.report.findings.length,2);assert.deepEqual(packet.report.findings.map(f=>f.finalTrace),full.findings.map(f=>f.finalTrace));
});
