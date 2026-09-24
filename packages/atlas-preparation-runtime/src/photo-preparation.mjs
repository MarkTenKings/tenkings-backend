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

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const worker = fileURLToPath(new URL('../../../backend/ai-grader-speedster-service/manual_preparation_worker.py', import.meta.url));
const names = ['rectified', 'inspection', 'normalized', 'microDefect', 'directional'];
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
        "names=['card_geometry.py','color_geometry.py','atlas_photo_geometry.py','defect_math.py','preparation_pixels.py']",
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
      return { ...value, adapterSha256: hash(await readFile(fileURLToPath(import.meta.url))) };
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

async function run(mode, { source, matColor, quad, limits: requestedLimits, pythonExecutable, engine: requestedEngine, signal }) {
  requireThat(!aborted(signal), 'PREPARATION_CANCELLED');
  requireThat(typeof pythonExecutable === 'string' && pythonExecutable.startsWith('/'), 'PREPARATION_UNAVAILABLE');
  requireThat(['BLACK', 'WHITE', 'MAGENTA'].includes(matColor), 'PREPARATION_INVALID');
  const keys = ['maxInputBytes', 'maxPixels', 'maxOutputBytes', 'timeoutMs'];
  const limits = { ...requestedLimits }, engine = structuredClone(requestedEngine);
  requireThat(limits && Object.keys(limits).length === keys.length && keys.every(k => Number.isSafeInteger(limits[k]) && limits[k] > 0), 'PREPARATION_LIMIT');
  const frame = parseDecodedFrame(source.frame, source.original, source.decodePlan), { content, dimensions } = frame.raster;
  requireThat(content.mime === 'image/png' && frame.treatment.bitDepth === 8 && frame.treatment.channels === 3
    && frame.treatment.colorSpace === 'sRGB', 'PREPARATION_RASTER_UNSUPPORTED');
  requireThat(source.bytes instanceof Uint8Array && source.bytes.byteLength === content.byteCount
    && content.byteCount <= limits.maxInputBytes && dimensions.width * dimensions.height <= limits.maxPixels, 'PREPARATION_LIMIT');
  const bytes = Buffer.from(source.bytes);
  requireThat(hash(bytes) === content.sha256, 'PREPARATION_SOURCE_MISMATCH');
  if (mode === 'PREPARE') quad = validatePhotoGeometryQuad(quad);
  const directory = await mkdtemp(join(tmpdir(), 'atlas-photo-geometry-'));
  try {
    const inputPath = join(directory, 'source.png'); await writeFile(inputPath, bytes, { mode: 0o600, flag: 'wx' });
    const result = await runPreparationWorker(pythonExecutable, worker, { mode, matColor,
      source: { ...dimensions, sha256: content.sha256, byteCount: bytes.length }, limits,
      ...(mode === 'PREPARE' ? { quad } : {}), inputPath, outputDirectory: directory }, { timeoutMs: limits.timeoutMs, signal });
    requireThat(descriptorSha256(result.identity) === descriptorSha256(engine.identity), 'PREPARATION_ENGINE_CHANGED');
    const frameDescriptorSha256 = descriptorSha256(frame);
    const id = descriptorSha256({ mode, matColor, quad: quad ?? null, frameDescriptorSha256, engine, proposal: result.proposal });
    if (mode === 'PHYSICAL') return { id, frameDescriptorSha256, identity: result.identity, proposal: result.proposal };
    let total = 0; const outputs = {};
    for (const name of names) {
      const output = result.frames?.[name], expected = name === 'rectified' ? [1270, 1778] : [1350, 1858];
      requireThat(output && output.filename === `${name}.webp` && output.mime === 'image/webp'
        && output.width === expected[0] && output.height === expected[1], 'PREPARATION_OUTPUT_INVALID');
      const path = join(directory, output.filename), size = (await stat(path)).size; total += size;
      requireThat(size > 0 && size === output.byteCount && total <= limits.maxOutputBytes, 'PREPARATION_LIMIT');
      const data = await readFile(path); requireThat(hash(data) === output.sha256, 'PREPARATION_OUTPUT_INVALID');
      outputs[name] = { ...output, bytes: data };
    }
    requireThat(!aborted(signal), 'PREPARATION_CANCELLED');
    const prepared = { id: `prepared-${id}`, version: 1,
      rectified: { sha256: outputs.rectified.sha256, width: 1270, height: 1778 },
      inspection: { sha256: outputs.inspection.sha256, width: 1350, height: 1858, cardBounds: { x: 40, y: 40, width: 1270, height: 1778 } },
      sourceToRectified: outputs.rectified.frameToDerivative };
    validatePreparedPhotoFrame(prepared, photoImage(source), quad);
    return { id, frameDescriptorSha256, identity: result.identity, proposal: result.proposal,
      frame: prepared, encoderSettings: result.encoderSettings, outputs };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
export const proposePhotoGeometry = input => run('PHYSICAL', input);
export const preparePhotoGeometry = input => run('PREPARE', input);
