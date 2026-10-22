import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, lstat, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OWNERSHIP_PROOF_LIMITS, ownershipProofObjectPlan } from './card-ownership-proof-contract.mjs';

export const OWNERSHIP_PROOF_VALIDATOR = Object.freeze({ recipe: 'atlas-ownership-original-photo-v1',
  rasterVersion: 'sharp-0.33.5/libvips-8.15.3', heicVersion: 'libheif-1.23.2/libde265-1.1.1',
  maxInputBytes: OWNERSHIP_PROOF_LIMITS.maxObjectBytes, maxPixels: OWNERSHIP_PROOF_LIMITS.maxPixels,
  maxRasterBytes: OWNERSHIP_PROOF_LIMITS.maxPixels * 8, maxMemoryBytes: 1024 * 1024 * 1024,
  timeoutMs: 15_000, maxOutputBytes: 8192, maxErrorBytes: 4096 });
export class OwnershipProofValidationError extends Error {
  constructor(code) { super(code); this.name = 'OwnershipProofValidationError'; this.code = code; }
}
const need = (ok, code = 'OWNERSHIP_PROOF_INVALID_PHOTO') => { if (!ok) throw new OwnershipProofValidationError(code); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const workerPath = fileURLToPath(import.meta.url);
const limits = OWNERSHIP_PROOF_VALIDATOR;
const cancelled = signal => need(!signal?.aborted, 'OWNERSHIP_PROOF_VALIDATION_CANCELLED');
function geometry(width, height) {
  need(Number.isSafeInteger(width) && Number.isSafeInteger(height) && width >= 2 && height >= 2);
  need(Number.isSafeInteger(width * height) && width * height <= limits.maxPixels
    && width * height * 8 <= limits.maxRasterBytes, 'OWNERSHIP_PROOF_PHOTO_LIMIT');
}
function receipt(value, plan) {
  const keys = ['recipe', 'decoderVersion', 'mime', 'width', 'height', 'pixels', 'originalSha256', 'originalByteCount'];
  need(value && Object.getPrototypeOf(value) === Object.prototype && Reflect.ownKeys(value).length === keys.length
    && keys.every(k => Object.hasOwn(Object.getOwnPropertyDescriptor(value, k) ?? {}, 'value')), 'OWNERSHIP_PROOF_VALIDATOR_PROTOCOL');
  geometry(value.width, value.height);
  need(value.recipe === limits.recipe && value.decoderVersion === (plan.declaredType === 'image/heic' ? limits.heicVersion : limits.rasterVersion)
    && value.mime === plan.declaredType && value.pixels === value.width * value.height
    && value.originalSha256 === plan.sha256 && value.originalByteCount === plan.byteCount, 'OWNERSHIP_PROOF_VALIDATOR_PROTOCOL');
  return structuredClone(value);
}

// The trusted host supplies a launcher that actually enforces these isolation
// bounds and returns a ChildProcess-compatible handle. Declaring this interface
// is NOT evidence that a host enforces it. No launcher is enabled here. The
// existing photo subprocess is deliberately not used as a memory/network sandbox.
function run(sandbox, request, privateDirectory, signal) {
  cancelled(signal);
  return new Promise((resolveResult, reject) => {
    let child;
    try {
      child = sandbox.launch({ executable: process.execPath, args: [workerPath, '--ownership-proof-worker'],
        cwd: privateDirectory, env: { UV_THREADPOOL_SIZE: '1', VIPS_CONCURRENCY: '1' },
        limits: { network: 'none', maxMemoryBytes: sandbox.maxMemoryBytes, timeoutMs: limits.timeoutMs },
        // Only this private input directory and the pinned read-only decoder
        // closure may be mounted. No credentials, application volumes or ports.
        privateDirectory });
    } catch { reject(new OwnershipProofValidationError('OWNERSHIP_PROOF_VALIDATOR_UNAVAILABLE')); return; }
    need(child?.stdin?.end && child?.stdout?.on && child?.stderr?.on && child?.on && child?.kill,
      'OWNERSHIP_PROOF_VALIDATOR_UNAVAILABLE');
    let stdout = '', outBytes = 0, errBytes = 0, failure;
    const stop = code => { failure ??= new OwnershipProofValidationError(code); child.kill('SIGKILL'); };
    const cancel = () => stop('OWNERSHIP_PROOF_VALIDATION_CANCELLED');
    const timer = setTimeout(() => stop('OWNERSHIP_PROOF_VALIDATION_TIMEOUT'), limits.timeoutMs);
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    child.stdout.on('data', chunk => {
      outBytes += chunk.length;
      if (outBytes > limits.maxOutputBytes) stop('OWNERSHIP_PROOF_VALIDATOR_PROTOCOL'); else stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', chunk => { errBytes += chunk.length; if (errBytes > limits.maxErrorBytes) stop('OWNERSHIP_PROOF_VALIDATOR_PROTOCOL'); });
    child.on('error', () => { failure ??= new OwnershipProofValidationError('OWNERSHIP_PROOF_VALIDATOR_UNAVAILABLE'); });
    child.stdin.on('error', () => { /* Terminal child close is authoritative. */ });
    child.on('close', (code, exitSignal) => {
      clearTimeout(timer); signal?.removeEventListener('abort', cancel);
      if (failure) { reject(failure); return; }
      if (code !== 0 || exitSignal) { reject(new OwnershipProofValidationError('OWNERSHIP_PROOF_VALIDATOR_FAILED')); return; }
      try {
        const result = JSON.parse(stdout);
        need(result && Object.keys(result).length === 2 && typeof result.ok === 'boolean', 'OWNERSHIP_PROOF_VALIDATOR_PROTOCOL');
        if (!result.ok) {
          const known = ['OWNERSHIP_PROOF_INVALID_PHOTO', 'OWNERSHIP_PROOF_PHOTO_LIMIT', 'OWNERSHIP_PROOF_FORMAT_UNSUPPORTED',
            'OWNERSHIP_PROOF_VALIDATOR_UNAVAILABLE', 'OWNERSHIP_PROOF_SOURCE_MISMATCH'];
          throw new OwnershipProofValidationError(known.includes(result.code) ? result.code : 'OWNERSHIP_PROOF_INVALID_PHOTO');
        }
        resolveResult(result.validation);
      } catch (error) { reject(error instanceof OwnershipProofValidationError ? error : new OwnershipProofValidationError('OWNERSHIP_PROOF_VALIDATOR_PROTOCOL')); }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

/** Source-only validator. No environment/client/process/network action on
 * import. With no explicitly injected qualified launcher validate fails closed.
 * Qualification of the host sandbox remains separate from decoder unit tests.
 */
export function createOwnershipProofValidator({ sandbox } = {}) {
  if (sandbox !== undefined) need(typeof sandbox.launch === 'function' && sandbox.network === 'none'
    && Number.isSafeInteger(sandbox.maxMemoryBytes) && sandbox.maxMemoryBytes > 0
    && sandbox.maxMemoryBytes <= limits.maxMemoryBytes, 'OWNERSHIP_PROOF_VALIDATOR_UNAVAILABLE');
  const isolated = sandbox && Object.freeze({ launch: sandbox.launch.bind(sandbox), maxMemoryBytes: sandbox.maxMemoryBytes });
  return Object.freeze({ async validate({ plan: supplied, bytes: suppliedBytes, signal } = {}) {
    need(isolated, 'OWNERSHIP_PROOF_VALIDATOR_UNAVAILABLE');
    need(signal === undefined || signal instanceof AbortSignal); cancelled(signal);
    const plan = ownershipProofObjectPlan(supplied);
    need(suppliedBytes instanceof Uint8Array && suppliedBytes.buffer instanceof ArrayBuffer
      && suppliedBytes.byteLength === plan.byteCount && suppliedBytes.byteLength <= limits.maxInputBytes, 'OWNERSHIP_PROOF_SOURCE_MISMATCH');
    const bytes = Buffer.from(suppliedBytes);
    need(sha(bytes) === plan.sha256, 'OWNERSHIP_PROOF_SOURCE_MISMATCH');
    let directory;
    try {
      directory = await mkdtemp(join(await realpath(tmpdir()), 'atlas-ownership-proof-'));
      const inputPath = join(directory, 'original');
      await writeFile(inputPath, bytes, { flag: 'wx', mode: 0o600 }); cancelled(signal);
      const validation = receipt(await run(isolated, { inputPath, byteCount: bytes.length, sha256: plan.sha256,
        declaredType: plan.declaredType }, directory, signal), plan);
      cancelled(signal);
      // The worker may only read the original. Detect a buggy injected sandbox
      // changing the private source even if it reports the expected digest.
      const after = await lstat(inputPath);
      need(after.isFile() && !after.isSymbolicLink() && after.size === bytes.length, 'OWNERSHIP_PROOF_SOURCE_MISMATCH');
      need(sha(await readFile(inputPath)) === plan.sha256, 'OWNERSHIP_PROOF_SOURCE_MISMATCH');
      return validation;
    } finally { bytes.fill(0); if (directory) await rm(directory, { recursive: true, force: true }); }
  } });
}

async function decodeFile(request) {
  need(request && Object.keys(request).sort().join(',') === 'byteCount,declaredType,inputPath,sha256');
  need(typeof request.inputPath === 'string' && resolve(request.inputPath) === join(process.cwd(), 'original'));
  need(OWNERSHIP_PROOF_LIMITS.formats.includes(request.declaredType), 'OWNERSHIP_PROOF_FORMAT_UNSUPPORTED');
  need(Number.isSafeInteger(request.byteCount) && request.byteCount > 0 && request.byteCount <= limits.maxInputBytes
    && typeof request.sha256 === 'string' && /^[a-f0-9]{64}$/.test(request.sha256));
  const info = await lstat(request.inputPath);
  need(info.isFile() && !info.isSymbolicLink() && info.size === request.byteCount, 'OWNERSHIP_PROOF_SOURCE_MISMATCH');
  const bytes = await readFile(request.inputPath);
  need(bytes.length === request.byteCount && sha(bytes) === request.sha256, 'OWNERSHIP_PROOF_SOURCE_MISMATCH');
  const { inspectContainer } = await import('../../atlas-photo-runtime/src/container.mjs');
  const container = inspectContainer(bytes); // Rejects animated/trailing/HDR formats outside this recipe.
  need(container.mime === request.declaredType, 'OWNERSHIP_PROOF_FORMAT_UNSUPPORTED');
  let width, height, decoderVersion;
  if (container.format === 'heif') {
    const { inspectHeif } = await import('../../atlas-photo-runtime/src/heif-container.mjs');
    const { inspectHeifExif, qualifyHeifIcc } = await import('../../atlas-photo-runtime/src/heif-metadata.mjs');
    const { heifGeometry } = await import('../../atlas-photo-runtime/src/heif.mjs');
    const parsed = inspectHeif(bytes);
    let addon;
    try { addon = createRequire(import.meta.url)('../../atlas-photo-runtime/native/build/heif.node'); }
    catch { need(false, 'OWNERSHIP_PROOF_VALIDATOR_UNAVAILABLE'); }
    const probe = addon.probe(bytes, limits);
    need(probe.version === '1.23.2/libde265-1.1.1' && probe.topLevelCount === 1 && !probe.appleGainMap,
      'OWNERSHIP_PROOF_FORMAT_UNSUPPORTED');
    ({ width, height } = probe); geometry(width, height);
    heifGeometry(probe, parsed); inspectHeifExif(probe.exif); qualifyHeifIcc(probe.icc);
    // No output raster or document interpretation is produced. Unsupported
    // auxiliary/HDR images remain unavailable; original storage is untouched.
    const decoded = addon.decode(bytes, limits), { pixels, ...again } = decoded;
    need(JSON.stringify(again) === JSON.stringify(probe) && Buffer.isBuffer(pixels)
      && pixels.length === width * height * 3 * (probe.bitDepth === 8 ? 1 : 2), 'OWNERSHIP_PROOF_SOURCE_MISMATCH');
    decoderVersion = limits.heicVersion;
  } else {
    need(['jpeg', 'png'].includes(container.format), 'OWNERSHIP_PROOF_FORMAT_UNSUPPORTED');
    let sharp;
    try { sharp = (await import('sharp')).default; } catch { need(false, 'OWNERSHIP_PROOF_VALIDATOR_UNAVAILABLE'); }
    need(sharp.versions.sharp === '0.33.5' && sharp.versions.vips === '8.15.3', 'OWNERSHIP_PROOF_VALIDATOR_UNAVAILABLE');
    sharp.cache(false); sharp.concurrency(1);
    const options = { failOn: 'warning', sequentialRead: true, limitInputPixels: limits.maxPixels };
    const meta = await sharp(bytes, options).metadata();
    need(meta.format === container.format && (meta.pages ?? 1) === 1 && [1, 2, 4, 8, 16].includes(container.bitDepth));
    ({ width, height } = meta); geometry(width, height);
    const { data, info: raster } = await sharp(bytes, options).raw({ depth: 'ushort' }).toBuffer({ resolveWithObject: true });
    need(raster.width === width && raster.height === height && raster.depth === 'ushort'
      && Number.isInteger(raster.channels) && raster.channels >= 1 && raster.channels <= 4
      && data.length === width * height * raster.channels * 2 && data.length <= limits.maxRasterBytes);
    decoderVersion = limits.rasterVersion;
  }
  return { recipe: limits.recipe, decoderVersion, mime: container.mime, width, height, pixels: width * height,
    originalSha256: request.sha256, originalByteCount: bytes.length };
}

// Explicit worker entry only. Merely importing this module never reads stdin,
// files, native addons or environment and never launches a child.
if (process.argv[1] && resolve(process.argv[1]) === workerPath && process.argv[2] === '--ownership-proof-worker') {
  try {
    let text = '';
    for await (const chunk of process.stdin) { text += chunk.toString('utf8'); need(Buffer.byteLength(text) <= 8192); }
    process.stdout.write(JSON.stringify({ ok: true, validation: await decodeFile(JSON.parse(text)) }));
  } catch (error) {
    const code = error instanceof OwnershipProofValidationError ? error.code : 'OWNERSHIP_PROOF_INVALID_PHOTO';
    process.stdout.write(JSON.stringify({ ok: false, code }));
  }
}
