import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { descriptorSha256, parseDecodedFrame } from '@atlas/photo-core';
import { validatePhotoGeometryQuad, validatePreparedPhotoFrame } from '@atlas/manual-workspace/geometry-actions';
import { PreparationError, aborted, runPreparationWorker } from './process.mjs';
import { PREPARATION_FULL_V1, PREPARATION_CORE_V1, PREPARATION_REVEALS_V1, preparationOutputNames } from './output-contract.mjs';
import { hashOwnedBytes } from './hash-bytes.mjs';
import { PREPARATION_LOSSLESS_SETTINGS, PREPARATION_LEGACY_SETTINGS, sameEncoder, readInspectionPreview } from './encoding.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const worker = fileURLToPath(new URL('../../../backend/ai-grader-speedster-service/manual_preparation_worker.py', import.meta.url));
const requireThat = (ok, code) => { if (!ok) throw new PreparationError(code); };
const identities = new Map();

/** Cold until explicitly called. Bind both source and actual installed native
 * runtime, once per immutable serving process. No photo, provider or DB access. */
export async function preparationRuntimeIdentity(pythonExecutable) {
  requireThat(typeof pythonExecutable === 'string' && pythonExecutable.startsWith('/'), 'PREPARATION_UNAVAILABLE');
  if (!identities.has(pythonExecutable)) {
    const pending = (async () => {
      const script = [
        'import hashlib,json,pathlib,sys,importlib.util',
        "p=pathlib.Path(sys.argv[1]);s=importlib.util.spec_from_file_location('atlas_preparation_identity',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)",
        'h=lambda p:hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()',
        "names=['card_geometry.py','color_geometry.py','atlas_photo_geometry.py','defect_math.py','preparation_pixels.py','preparation_encoding.py']",
        "identity={'opencv':m.cv2.__version__,'numpy':m.np.__version__,'physicalProposalPolicy':m.POLICY_VERSION,'sources':{n:h(p.parent/n) for n in names}}",
        'roots=[pathlib.Path(mod.__file__).parent for mod in [m.cv2,m.np]]',
        "roots += [roots[0].parent/n for n in ['opencv_python.libs','opencv_python_headless.libs','numpy.libs']]",
        "native={str(root.name+'/'+str(q.relative_to(root))):h(q) for root in roots if root.is_dir() for q in sorted(root.rglob('*')) if q.is_file() and ('.so' in q.name or q.suffix=='.dylib')}",
        "print(json.dumps({'identity':identity,'workerSha256':h(p),'python':sys.version,'executableSha256':h(sys.executable),'native':native},sort_keys=True))",
      ].join('\n');
      const { stdout } = await promisify(execFile)(pythonExecutable, ['-I', '-c', script, worker], {
        timeout: 30000, killSignal: 'SIGKILL', maxBuffer: 65536, env: { PATH: process.env.PATH ?? '', OPENBLAS_NUM_THREADS: '1', OMP_NUM_THREADS: '1', PYTHONNOUSERSITE: '1' },
      });
      const value = JSON.parse(stdout);
      requireThat(value?.identity?.sources && Object.keys(value.native ?? {}).length > 0, 'PREPARATION_UNAVAILABLE');
      return { ...value, adapterSha256: hash(await readFile(fileURLToPath(import.meta.url))),
        encodingAdapterSha256: hash(await readFile(new URL('./encoding.mjs', import.meta.url))) };
    })();
    identities.set(pythonExecutable, pending);
    pending.catch(() => identities.delete(pythonExecutable));
  }
  return structuredClone(await identities.get(pythonExecutable));
}

export function photoImage(source) {
  const frame = parseDecodedFrame(source.frame, source.original, source.decodePlan);
  return { version: source.original.binding.version, originalSha256: source.original.content.sha256,
    frameId: frame.id, frameSha256: frame.raster.content.sha256, ...frame.raster.dimensions, coordinateSpace: 'ORIENTED_DECODED' };
}

async function run(mode, { source, matColor, quad, limits: requestedLimits, pythonExecutable, engine: requestedEngine, signal,
  outputContract = PREPARATION_FULL_V1 }, encoderSettings = PREPARATION_LOSSLESS_SETTINGS) {
  requireThat(!aborted(signal), 'PREPARATION_CANCELLED');
  requireThat(typeof pythonExecutable === 'string' && pythonExecutable.startsWith('/'), 'PREPARATION_UNAVAILABLE');
  requireThat(['BLACK', 'WHITE', 'MAGENTA'].includes(matColor), 'PREPARATION_INVALID');
  requireThat([PREPARATION_FULL_V1, PREPARATION_CORE_V1].includes(outputContract), 'PREPARATION_OUTPUT_INVALID');
  const names = preparationOutputNames(outputContract);
  const keys = ['maxInputBytes', 'maxPixels', 'maxOutputBytes', 'timeoutMs'];
  const limits = { ...requestedLimits }, engine = structuredClone(requestedEngine);
  requireThat(limits && Object.keys(limits).length === keys.length && keys.every(k => Number.isSafeInteger(limits[k]) && limits[k] > 0), 'PREPARATION_LIMIT');
  const frame = parseDecodedFrame(source.frame, source.original, source.decodePlan), { content, dimensions } = frame.raster;
  requireThat(content.mime === 'image/png' && frame.treatment.bitDepth === 8 && frame.treatment.channels === 3
    && frame.treatment.colorSpace === 'sRGB', 'PREPARATION_RASTER_UNSUPPORTED');
  requireThat(source.bytes instanceof Uint8Array && source.bytes.buffer instanceof ArrayBuffer && source.bytes.byteLength === content.byteCount
    && content.byteCount <= limits.maxInputBytes && dimensions.width * dimensions.height <= limits.maxPixels, 'PREPARATION_LIMIT');
  const bytes = Buffer.from(source.bytes);
  if (mode === 'PREPARE') quad = validatePhotoGeometryQuad(quad);
  const image = photoImage(source);
  requireThat(await hashOwnedBytes(bytes, signal) === content.sha256, 'PREPARATION_SOURCE_MISMATCH');
  const directory = await mkdtemp(join(tmpdir(), 'atlas-photo-geometry-'));
  try {
    const inputPath = join(directory, 'source.png'); await writeFile(inputPath, bytes, { mode: 0o600, flag: 'wx' });
    const result = await runPreparationWorker(pythonExecutable, worker, { mode, matColor,
      source: { ...dimensions, sha256: content.sha256, byteCount: bytes.length }, limits,
      ...(mode === 'PREPARE' ? { quad, outputContract, encoderSettings } : {}), inputPath, outputDirectory: directory }, { timeoutMs: limits.timeoutMs, signal });
    requireThat(descriptorSha256(result.identity) === descriptorSha256(engine.identity), 'PREPARATION_ENGINE_CHANGED');
    requireThat(!aborted(signal), 'PREPARATION_CANCELLED');
    const frameDescriptorSha256 = descriptorSha256(frame);
    const id = descriptorSha256({ mode, matColor, quad: quad ?? null, frameDescriptorSha256, engine, proposal: result.proposal,
      ...(mode === 'PREPARE' ? { outputContract } : {}) });
    if (mode === 'PHYSICAL') return { id, frameDescriptorSha256, identity: result.identity, proposal: result.proposal };
    requireThat(sameEncoder(result.encoderSettings, encoderSettings), 'PREPARATION_OUTPUT_INVALID');
    requireThat(result.outputContract === outputContract && result.frames && Object.keys(result.frames).length === names.length
      && names.every(name => Object.hasOwn(result.frames, name)), 'PREPARATION_OUTPUT_INVALID');
    let total = 0; const outputs = {};
    for (const name of names) {
      const output = result.frames?.[name], expected = name === 'rectified' ? [1270, 1778] : [1350, 1858];
      requireThat(output && output.filename === `${name}.webp` && output.mime === 'image/webp'
        && output.width === expected[0] && output.height === expected[1], 'PREPARATION_OUTPUT_INVALID');
      const path = join(directory, output.filename), size = (await stat(path)).size; total += size;
      requireThat(size > 0 && size === output.byteCount && total <= limits.maxOutputBytes, 'PREPARATION_LIMIT');
      const data = await readFile(path); requireThat(await hashOwnedBytes(data, signal) === output.sha256, 'PREPARATION_OUTPUT_INVALID');
      outputs[name] = { ...output, bytes: data };
    }
    const inspectionPreview = await readInspectionPreview(result, directory, { total, maxOutputBytes: limits.maxOutputBytes, signal });
    requireThat(!aborted(signal), 'PREPARATION_CANCELLED');
    const prepared = { id: `prepared-${id}`, version: 1,
      rectified: { sha256: outputs.rectified.sha256, width: 1270, height: 1778 },
      inspection: { sha256: outputs.inspection.sha256, width: 1350, height: 1858, cardBounds: { x: 40, y: 40, width: 1270, height: 1778 } },
      sourceToRectified: outputs.rectified.frameToDerivative };
    validatePreparedPhotoFrame(prepared, image, quad);
    return { id, frameDescriptorSha256, identity: result.identity, proposal: result.proposal,
      frame: prepared, encoderSettings: result.encoderSettings, outputContract, sourceQuad: quad, outputs,
      ...(inspectionPreview ? { inspectionPreview } : {}) };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
export const proposePhotoGeometry = input => run('PHYSICAL', input);
export const preparePhotoGeometry = input => run('PREPARE', input);

/** Lazy reveals start from the verified working PNG and the retained physical
 * quad, never a lossy prepared WebP. Full recomputation is intentionally outside
 * automatic admission; core pixels, transforms and proposal must still match.
 * The separate result does not replace the prepared frame or analysis binding. */
export async function prepareDeferredPhotoReveals({ prepared, ...input }) {
  requireThat(prepared?.outputContract === PREPARATION_CORE_V1 && prepared.sourceQuad && prepared.frame,
    'PREPARATION_OUTPUT_INVALID');
  const retained = structuredClone(prepared);
  const frame = parseDecodedFrame(input.source.frame, input.source.original, input.source.decodePlan);
  requireThat(retained.frameDescriptorSha256 === descriptorSha256(frame)
    && descriptorSha256(retained.identity) === descriptorSha256(input.engine.identity), 'PREPARATION_SOURCE_MISMATCH');
  requireThat(retained.id === descriptorSha256({ mode: 'PREPARE', matColor: input.matColor, quad: retained.sourceQuad,
    frameDescriptorSha256: retained.frameDescriptorSha256, engine: input.engine, proposal: retained.proposal,
    outputContract: PREPARATION_CORE_V1 }), 'PREPARATION_SOURCE_MISMATCH');
  validatePreparedPhotoFrame(retained.frame, photoImage(input.source), retained.sourceQuad);
  const legacy = sameEncoder(retained.encoderSettings, PREPARATION_LEGACY_SETTINGS);
  requireThat(legacy || sameEncoder(retained.encoderSettings, PREPARATION_LOSSLESS_SETTINGS), 'PREPARATION_OUTPUT_INVALID');
  // Historical callers supply the immutable engine retained in the early-work
  // packet. Permit only this encoding migration, with all old pixel sources and
  // actual native binaries unchanged; still prove every saved core byte below.
  const currentEngine = await preparationRuntimeIdentity(input.pythonExecutable);
  const equal = (a, b) => descriptorSha256({ value: a }) === descriptorSha256({ value: b });
  if (legacy) {
    const identity = structuredClone(currentEngine.identity);
    delete identity.sources['preparation_encoding.py'];
    requireThat(equal(input.engine.identity, identity)
      && ['native', 'python', 'executableSha256'].every(key => equal(input.engine[key], currentEngine[key])), 'PREPARATION_ENGINE_CHANGED');
  } else requireThat(equal(input.engine, currentEngine), 'PREPARATION_ENGINE_CHANGED');
  const result = await run('PREPARE', { ...input, engine: currentEngine, quad: retained.sourceQuad, outputContract: PREPARATION_FULL_V1 },
    legacy ? PREPARATION_LEGACY_SETTINGS : PREPARATION_LOSSLESS_SETTINGS);
  requireThat(equal(result.proposal, retained.proposal) && equal(result.encoderSettings, retained.encoderSettings)
    && ['rectified', 'inspection', 'sourceToRectified'].every(key => equal(result.frame[key], retained.frame[key])),
  'PREPARATION_SOURCE_MISMATCH');
  const outputContract = PREPARATION_REVEALS_V1;
  return { id: descriptorSha256({ outputContract, parentPreparationId: retained.id, frameDescriptorSha256: retained.frameDescriptorSha256,
    identity: result.identity, encoderSettings: result.encoderSettings }), parentPreparationId: retained.id,
    outputContract, sourceQuad: retained.sourceQuad, frameDescriptorSha256: retained.frameDescriptorSha256,
    frame: retained.frame, identity: result.identity, encoderSettings: result.encoderSettings,
    outputs: Object.fromEntries(preparationOutputNames(outputContract).map(name => [name, result.outputs[name]])) };
}
