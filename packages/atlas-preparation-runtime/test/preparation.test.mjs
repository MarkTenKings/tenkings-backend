import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { describeDecodedFrame, verifyAndDecodePhoto } from '@atlas/photo-runtime';
import { applyGeometryEdit, createGeometryWorkspace, geometryBase, updateGeometrySettings } from '@atlas/manual-workspace/geometry-actions';
import { adoptGeometryPreparation, describePreparationDerivative, prepareGeometry, proposePhysicalGeometry } from '../src/index.mjs';
import { runPreparationWorker } from '../src/process.mjs';

const python = process.env.ATLAS_PREPARATION_PYTHON;
if (!python?.startsWith('/')) throw new Error('Set ATLAS_PREPARATION_PYTHON to the absolute path of the pinned CPU Python environment');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const limits = { maxInputBytes: 8_000_000, maxPixels: 3_000_000, maxOutputBytes: 8_000_000, timeoutMs: 10000 };
let directory, fixture, workspace, source, prepared;
const input = overrides => ({ workspace, side: 'FRONT', source, pythonExecutable: python, limits, ...overrides });
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'atlas-preparation-test-'));
  execFileSync(python, [fileURLToPath(new URL('../../atlas-manual-workspace/scripts/generate-preview.py', import.meta.url)), directory]);
  fixture = JSON.parse(await readFile(join(directory, 'fixture.json')));
  const sources = {};
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

test('real CPU preparation yields exact canonical frames, source transform and a genuine engine proposal', () => {
  assert.deepEqual(Object.keys(prepared.outputs), ['rectified','inspection','normalized','microDefect','directional']);
  assert.deepEqual(prepared.frame.inspection.cardBounds, { x: 40, y: 40, width: 1270, height: 1778 });
  assert.equal(prepared.identity.opencv, '4.10.0');
  for (const output of Object.values(prepared.outputs)) assert.equal(sha(output.bytes), output.sha256);
  assert.equal(prepared.proposal.mode, 'PRINTED_FRAME');
  assert.equal(prepared.proposal.outcome, 'ACCEPTED');
  assert.equal(workspace.sides.FRONT.prepared, null);
  const result = adoptGeometryPreparation(workspace, prepared);
  assert.equal(result.proposalApplied, true);
  assert.equal(result.state.sides.FRONT.printed.actor, 'ENGINE');
  assert.equal(result.state.sides.FRONT.confirmation, null);
  assert.deepEqual(result.state.sides.BACK, workspace.sides.BACK);
});

test('five encoded outputs match legacy warp, reveal and encoder functions byte for byte', async () => {
  const sourcePath = join(directory, 'decoded.png'); await writeFile(sourcePath, source.bytes);
  const service = fileURLToPath(new URL('../../../backend/ai-grader-speedster-service/', import.meta.url));
  const script = `import sys,ast,json,hashlib\nfrom pathlib import Path\nimport cv2,numpy as np\nsys.path.insert(0,sys.argv[1])\nfrom card_geometry import warp_to_card_map,warp_to_inspection_map\ns=Path(sys.argv[1],'preparation_core.py').read_text();t=ast.parse(s)\nfor n in t.body:\n if isinstance(n,ast.FunctionDef) and n.name in ('reveal_views','encode_webp'):exec(ast.get_source_segment(s,n))\nimage=cv2.imread(sys.argv[2]);quad=np.float32(json.loads(sys.argv[3]))\nr,m=warp_to_card_map(image,quad);i,_=warp_to_inspection_map(image,quad);n,u,d=reveal_views(i)\nprint(json.dumps([hashlib.sha256(encode_webp(v)).hexdigest() for v in (r,i,n,u,d)]))\n`;
  const quad = fixture.FRONT.physical.map(p => [p.x*1200,p.y*1540]);
  const expected = JSON.parse(execFileSync(python, ['-I','-c',script,service,sourcePath,JSON.stringify(quad)], { env: { PATH: process.env.PATH, OPENBLAS_NUM_THREADS: '1', OMP_NUM_THREADS: '1' } }));
  assert.deepEqual(Object.values(prepared.outputs).map(output => output.sha256), expected);
});

test('actual physical proposal uses the source frame and preserves its current geometry dependency base', async () => {
  const result = await proposePhysicalGeometry(input());
  assert.equal(result.proposal.mode, 'PHYSICAL_OUTER');
  assert.equal(result.proposal.outcome, 'ACCEPTED');
  assert.deepEqual(result.base, geometryBase(workspace, 'FRONT', 'PHYSICAL'));
  assert.ok(result.proposal.proposal.length === 4);
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
