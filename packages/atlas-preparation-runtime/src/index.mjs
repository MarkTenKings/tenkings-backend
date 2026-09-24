import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { descriptorSha256, parseDecodedFrame, parseDerivative } from '@atlas/photo-core';
import { applyPreparedFrame, geometryBase, parseGeometryWorkspace, preparationBase } from '@atlas/manual-workspace/geometry-actions';
import { aborted, PreparationError, runPreparationWorker } from './process.mjs';

export { PreparationError };
export { preparationRuntimeIdentity, proposePhotoGeometry, preparePhotoGeometry } from './photo-preparation.mjs';
export { adoptGeometryPreparation, adoptPhysicalGeometryProposal } from '@atlas/manual-workspace/preparation-result';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const worker = fileURLToPath(new URL('../../../backend/ai-grader-speedster-service/manual_preparation_worker.py', import.meta.url));
const NAMES = ['rectified', 'inspection', 'normalized', 'microDefect', 'directional'];
const requireThat = (value, code = 'PREPARATION_INVALID') => { if (!value) throw new PreparationError(code); };
const equal = (a, b) => descriptorSha256(a) === descriptorSha256(b);

function checkSource(workspace, side, source) {
  const state = parseGeometryWorkspace(workspace), slot = state.sides[side];
  requireThat(slot?.image && source, 'PREPARATION_SOURCE_MISMATCH');
  const frame = parseDecodedFrame(source.frame, source.original, source.decodePlan);
  const image = slot.image, dimensions = frame.raster.dimensions, content = frame.raster.content;
  requireThat(source.original.binding.cardId === state.cardId && source.original.binding.side === side
    && source.original.binding.version === image.version && source.original.content.sha256 === image.originalSha256
    && frame.id === image.frameId && content.sha256 === image.frameSha256
    && dimensions.width === image.width && dimensions.height === image.height, 'PREPARATION_SOURCE_MISMATCH');
  requireThat(content.mime === 'image/png' && frame.treatment.bitDepth === 8
    && frame.treatment.channels === 3 && frame.treatment.colorSpace === 'sRGB', 'PREPARATION_RASTER_UNSUPPORTED');
  requireThat(source.bytes instanceof Uint8Array && source.bytes.buffer instanceof ArrayBuffer);
  return { state, frame, content, dimensions };
}

async function run(mode, { workspace, side, source, limits: limitValue, pythonExecutable, signal } = {}) {
  requireThat(!aborted(signal), 'PREPARATION_CANCELLED');
  requireThat(typeof pythonExecutable === 'string' && pythonExecutable.startsWith('/'), 'PREPARATION_UNAVAILABLE');
  requireThat(limitValue && Object.getPrototypeOf(limitValue) === Object.prototype, 'PREPARATION_LIMIT');
  const limits = { ...limitValue };
  const keys = ['maxInputBytes', 'maxPixels', 'maxOutputBytes', 'timeoutMs'];
  requireThat(limits && Object.keys(limits).length === keys.length && keys.every(key => Number.isSafeInteger(limits[key]) && limits[key] > 0), 'PREPARATION_LIMIT');
  const checked = checkSource(workspace, side, source), { state, frame, content, dimensions } = checked;
  requireThat(source.bytes.length === content.byteCount && content.byteCount <= limits.maxInputBytes
    && dimensions.width * dimensions.height <= limits.maxPixels, 'PREPARATION_LIMIT');
  const bytes = Buffer.from(source.bytes);
  requireThat(hash(bytes) === content.sha256, 'PREPARATION_SOURCE_MISMATCH');
  const base = mode === 'PHYSICAL' ? geometryBase(state, side, 'PHYSICAL') : preparationBase(state, side);
  const request = { mode, matColor: state.sides[side].matColor,
    source: { ...dimensions, sha256: content.sha256, byteCount: bytes.length }, limits: { ...limits } };
  if (mode === 'PREPARE') request.quad = state.sides[side].physical.quad;
  const directory = await mkdtemp(join(tmpdir(), 'atlas-preparation-'));
  try {
    const inputPath = join(directory, 'source.png');
    await writeFile(inputPath, bytes, { mode: 0o600, flag: 'wx' });
    const result = await runPreparationWorker(pythonExecutable, worker, { ...request, inputPath, outputDirectory: directory }, { timeoutMs: limits.timeoutMs, signal });
    const binding = { side, base, frameDescriptorSha256: descriptorSha256(frame), settingsRevision: state.sides[side].settingsRevision,
      matColor: state.sides[side].matColor, cornerShape: state.sides[side].cornerShape };
    const id = descriptorSha256({ ...binding, identity: result.identity, proposal: result.proposal });
    requireThat(!aborted(signal), 'PREPARATION_CANCELLED');
    if (mode === 'PHYSICAL') return { ...binding, id, identity: result.identity, proposal: result.proposal };
    const outputs = {};
    let total = 0;
    for (const name of NAMES) {
      const output = result.frames?.[name];
      const expected = name === 'rectified' ? { width: 1270, height: 1778 } : { width: 1350, height: 1858 };
      requireThat(output && output.filename === `${name}.webp` && output.mime === 'image/webp'
        && output.width === expected.width && output.height === expected.height, 'PREPARATION_OUTPUT_INVALID');
      const path = join(directory, output.filename), size = (await stat(path)).size;
      total += size;
      requireThat(Number.isSafeInteger(size) && size > 0 && size === output.byteCount && total <= limits.maxOutputBytes, 'PREPARATION_LIMIT');
      const data = await readFile(path);
      requireThat(hash(data) === output.sha256, 'PREPARATION_OUTPUT_INVALID');
      outputs[name] = { ...output, bytes: data };
    }
    requireThat(!aborted(signal), 'PREPARATION_CANCELLED');
    const prepared = { id: `prepared-${id}`, version: state.sides[side].preparationRevision + 1,
      rectified: { sha256: outputs.rectified.sha256, width: 1270, height: 1778 },
      inspection: { sha256: outputs.inspection.sha256, width: 1350, height: 1858, cardBounds: { x: 40, y: 40, width: 1270, height: 1778 } },
      sourceToRectified: outputs.rectified.frameToDerivative };
    // Validate the actual warp against the captured source quad before returning
    // an adoptable frame. This does not persist or change the supplied workspace.
    applyPreparedFrame(state, { side, base, frame: prepared });
    return { ...binding, id, identity: result.identity, proposal: result.proposal,
      frame: prepared, encoderSettings: result.encoderSettings, outputs };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export const proposePhysicalGeometry = input => run('PHYSICAL', input);
export const prepareGeometry = input => run('PREPARE', input);

/** Describe actual prepared bytes against a destination subsequently observed
 * by the storage adapter. No object write or durable receipt is invented here. */
export function describePreparationDerivative(result, name, source, { id, object }) {
  requireThat(NAMES.includes(name));
  const frame = parseDecodedFrame(source.frame, source.original, source.decodePlan), output = result.outputs[name];
  requireThat(result.frameDescriptorSha256 === descriptorSha256(frame)
    && output.bytes.byteLength === output.byteCount && hash(output.bytes) === output.sha256, 'PREPARATION_SOURCE_MISMATCH');
  requireThat(equal(result.encoderSettings, { format: 'webp', quality: 92, sourceBitDepth: 8 }), 'PREPARATION_OUTPUT_INVALID');
  return parseDerivative({ schemaVersion: 1, kind: 'derivative', id,
    purpose: name === 'rectified' || name === 'inspection' ? name : 'reveal',
    originalDescriptorSha256: frame.originalDescriptorSha256, frameDescriptorSha256: descriptorSha256(frame),
    raster: { content: { mime: output.mime, sha256: output.sha256, byteCount: output.byteCount },
      dimensions: { width: output.width, height: output.height }, object },
    frameToDerivative: output.frameToDerivative,
    encoder: { name: 'opencv-webp', version: result.identity.opencv, settingsSha256: descriptorSha256(result.encoderSettings) },
  }, frame, source.original, source.decodePlan);
}
