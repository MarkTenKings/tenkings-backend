import { createHash } from 'node:crypto';
import sharp from 'sharp';
import {
  CARD_IDENTIFICATION_VERSION, CARD_IDENTIFICATION_SOURCE_COMMIT, CARD_IDENTIFICATION_MODEL,
  CARD_IDENTIFICATION_FIELDS, CARD_IDENTIFICATION_DEADLINES, CARD_IDENTIFICATION_MAX_OCR_CHARS,
  CARD_IDENTIFICATION_MAX_PROVIDER_BYTES, CardIdentificationError, requireIdentification,
  parseCardIdentificationInput, parseCardIdentificationResultStructure,
} from './contracts.mjs';
import { buildCardIdentificationRequest, parseCardIdentificationOutput } from './request.mjs';
export {
  CARD_IDENTIFICATION_VERSION, CARD_IDENTIFICATION_SOURCE_COMMIT, CARD_IDENTIFICATION_MODEL,
  CARD_IDENTIFICATION_FIELDS, CARD_IDENTIFICATION_CATEGORIES, CARD_IDENTIFICATION_LIMITS,
  CARD_IDENTIFICATION_DEADLINES, CARD_IDENTIFICATION_MAX_PHOTO_BYTES,
  CARD_IDENTIFICATION_MAX_PROVIDER_BYTES, CARD_IDENTIFICATION_MAX_OCR_CHARS,
  CardIdentificationError, parseCardIdentificationInput, parseCardIdentificationSuggestions,
  parseCardIdentificationResultStructure,
} from './contracts.mjs';
export { parseCardIdentificationOutput } from './request.mjs';

const SIDES = ['front', 'back'];
const digest = value => createHash('sha256').update(value).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export function cardIdentificationInputHash(input) { return digest(canonical(parseCardIdentificationInput(input))); }

/** Model/OCR effects return bounded raw JSON bytes. Their adapter owns network
 * streaming limits, credentials and actual dispatch/usage receipts. */
function providerJson(bytes) {
  requireIdentification(bytes instanceof Uint8Array && bytes.byteLength > 0 && bytes.byteLength <= CARD_IDENTIFICATION_MAX_PROVIDER_BYTES, 'malformed_response');
  try { return JSON.parse(Buffer.from(bytes).toString('utf8')); }
  catch { throw new CardIdentificationError('malformed_response'); }
}
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;

/** Exact Google Vision request from the reviewed source. */
export function buildCardIdentificationOcrRequest(bytes) {
  return { requests: [{ image: { content: Buffer.from(bytes).toString('base64') }, features: [{ type: 'DOCUMENT_TEXT_DETECTION' }] }] };
}
export function parseCardIdentificationOcrOutput(payload) {
  const response = object(payload);
  requireIdentification(response && response.error == null && Array.isArray(response.responses) && response.responses.length === 1, 'malformed_response');
  const result = object(response.responses[0]);
  requireIdentification(result && result.error == null, 'provider_error');
  const full = object(result.fullTextAnnotation);
  const first = Array.isArray(result.textAnnotations) ? object(result.textAnnotations[0]) : null;
  requireIdentification(result.fullTextAnnotation === undefined || (full && (full.text === undefined || typeof full.text === 'string')), 'malformed_response');
  requireIdentification(result.textAnnotations === undefined || (Array.isArray(result.textAnnotations) && (result.textAnnotations.length === 0 || typeof first?.description === 'string')), 'malformed_response');
  const text = String(full?.text ?? first?.description ?? '').slice(0, CARD_IDENTIFICATION_MAX_OCR_CHARS).trim();
  return { text, status: text ? 'read' : 'empty' };
}

/** Like the source, deadlines include effects that ignore cancellation. An
 * adapter may not apply a late result; the engine performs no persistence. */
async function bounded(operation, milliseconds, parent) {
  if (parent?.aborted) throw new CardIdentificationError('cancelled');
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  parent?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, milliseconds);
  let rejectAbort = () => {};
  const aborted = new Promise((_, reject) => {
    rejectAbort = () => reject(new CardIdentificationError(timedOut ? 'timeout' : 'cancelled'));
    controller.signal.addEventListener('abort', rejectAbort, { once: true });
  });
  try { return await Promise.race([operation(controller.signal), aborted]); }
  finally {
    clearTimeout(timer); parent?.removeEventListener('abort', cancel);
    controller.signal.removeEventListener('abort', rejectAbort); controller.abort();
  }
}
function deadline(stage, options) {
  return options.timeoutMs === undefined ? CARD_IDENTIFICATION_DEADLINES[stage] : Math.min(CARD_IDENTIFICATION_DEADLINES[stage], options.timeoutMs);
}
async function readPhoto(descriptor, context, effects, options) {
  return bounded(async signal => {
    try {
      const supplied = await effects.readPhoto(descriptor, { ...context, signal });
      requireIdentification(!signal.aborted, 'cancelled');
      requireIdentification(supplied instanceof Uint8Array && supplied.byteLength === descriptor.byteCount, 'unverified_photo');
      const bytes = Buffer.from(supplied);
      requireIdentification(digest(bytes) === descriptor.sha256, 'unverified_photo');
      const metadata = await sharp(bytes, { limitInputPixels: 1400 * 1400, failOn: 'warning' }).metadata();
      requireIdentification(!signal.aborted, 'cancelled');
      requireIdentification(metadata.format === 'jpeg' && metadata.width && metadata.height && metadata.width <= 1400 && metadata.height <= 1400 && (metadata.pages ?? 1) === 1, 'unverified_photo');
      return { bytes };
    } catch (error) {
      if (signal.aborted) throw new CardIdentificationError('cancelled');
      if (error instanceof CardIdentificationError) throw error;
      throw new CardIdentificationError('unverified_photo');
    }
  }, deadline('photo_read', options), context.signal);
}

export function parseCardIdentificationResult(value, expectedInput) {
  const input = parseCardIdentificationInput(expectedInput);
  const result = parseCardIdentificationResultStructure(value);
  requireIdentification(canonical(result.provenance.subject) === canonical(input.subject)
    && canonical(result.provenance.photos) === canonical(input.photos)
    && result.provenance.input_sha256 === cardIdentificationInputHash(input), 'malformed_response');
  return result;
}

/** No default network/storage/knowledge implementation; no inventory, grading,
 * editing, automatic retry or persistence. Both photo reads and OCR overlap. */
export async function identifyCard(input, effects, options = {}) {
  const data = freeze(parseCardIdentificationInput(input));
  requireIdentification(effects && ['readPhoto', 'ocr', 'model'].every(key => typeof effects[key] === 'function'), 'unavailable');
  requireIdentification(object(options));
  requireIdentification(options.timeoutMs === undefined || Number.isSafeInteger(options.timeoutMs) && options.timeoutMs > 0);
  requireIdentification(options.signal === undefined || options.signal instanceof AbortSignal);
  options = { timeoutMs: options.timeoutMs, signal: options.signal };
  const inputHash = cardIdentificationInputHash(data), started = Date.now();
  return bounded(async signal => {
    const context = { subject: data.subject, inputHash, signal };
    const photoStarted = Date.now();
    const loaded = await Promise.all(SIDES.map(side => readPhoto(data.photos[side], { ...context, side }, effects, options)));
    const photos = { front: loaded[0], back: loaded[1] };
    const photoElapsed = Math.max(0, Date.now() - photoStarted);
    const ocrStarted = Date.now();
    const ocrResults = await Promise.all(SIDES.map(async side => {
      try {
        return await bounded(async ocrSignal => {
          const request = freeze(buildCardIdentificationOcrRequest(photos[side].bytes));
          const bytes = await effects.ocr(request, { ...context, side, photo: data.photos[side], requestHash: digest(JSON.stringify(request)), signal: ocrSignal });
          requireIdentification(!ocrSignal.aborted, 'cancelled');
          return parseCardIdentificationOcrOutput(providerJson(bytes));
        }, deadline('ocr', options), signal);
      } catch {
        if (signal.aborted) throw new CardIdentificationError('cancelled');
        return { text: '', status: 'unavailable' };
      }
    }));
    const ocrElapsed = Math.max(0, Date.now() - ocrStarted);
    const ocr = { front: ocrResults[0], back: ocrResults[1] };
    const modelStarted = Date.now();
    const request = freeze(buildCardIdentificationRequest(photos, ocr));
    const requestHash = digest(JSON.stringify(request));
    const { suggestions, responseHash } = await bounded(async modelSignal => {
      const supplied = await effects.model(request, { ...context, photos: data.photos, requestHash, signal: modelSignal });
      requireIdentification(!modelSignal.aborted, 'cancelled');
      const payload = providerJson(supplied);
      return { suggestions: parseCardIdentificationOutput(payload), responseHash: digest(supplied) };
    }, deadline('model', options), signal);
    const modelElapsed = Math.max(0, Date.now() - modelStarted);
    const result = {
      suggestions,
      warnings: [
        'Review the suggested details before saving.',
        ...SIDES.filter(side => ocr[side].status !== 'read').map(side => `${side === 'front' ? 'Front' : 'Back'} text ${ocr[side].status === 'empty' ? 'was not readable' : 'recognition was unavailable'}; suggestions use the photos.`),
        ...(CARD_IDENTIFICATION_FIELDS.some(field => suggestions[field].value === null || suggestions[field].confidence === 'low') ? ['Some details are uncertain or missing. Check those fields on the card.'] : []),
      ],
      provenance: {
        engine_version: CARD_IDENTIFICATION_VERSION, source_commit: CARD_IDENTIFICATION_SOURCE_COMMIT,
        subject: data.subject, photos: data.photos, input_sha256: inputHash, request_sha256: requestHash, response_sha256: responseHash,
        model: CARD_IDENTIFICATION_MODEL, reasoning_effort: 'low', identified_at: new Date().toISOString(), elapsed_ms: Math.max(0, Date.now() - started),
        stage_timings_ms: { photo_read: photoElapsed, ocr: ocrElapsed, model: modelElapsed },
        ocr: { provider: 'google_vision', front: ocr.front.status, back: ocr.back.status }, knowledge: null,
      },
    };
    return freeze(parseCardIdentificationResult(result, data));
  }, deadline('overall', options), options.signal).catch(error => {
    if (error instanceof CardIdentificationError) throw error;
    throw new CardIdentificationError('provider_error');
  });
}
