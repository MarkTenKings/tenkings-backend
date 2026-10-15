import sharp from 'sharp';
import { canonical, digest, requireThat } from '@atlas/manual-service/contract';

export const REPORT_IMAGE_RECIPE = Object.freeze({ version: 'atlas-photoroom-plus-hd-v2', execution: 'PHOTOROOM_PLUS_API',
  endpoint: 'https://image-api.photoroom.com/v2/edit', method: 'POST', hdBackgroundRemoval: 'auto',
  removeBackground: true, referenceBox: 'originalImage', padding: 0, outputSize: 'source-dimensions',
  exportFormat: 'png', colorSpace: 'original', foregroundRGBValidation: 'bounded-edge-rgb-v1',
  minFractionalChannelDelta: -1, maxFractionalChannelDelta: 0, maxChangedVisibleRatio: 0.002,
  alphaBoundaryValidation: 'exterior-alpha-band-v1', alphaConnectivity: 4, alphaDistanceMetric: 'manhattan',
  maxFractionalDistance: 16, minOpaqueVisibleRatio: 0.98 });
export const reportImageRecipeHash = recipe => digest(canonical(recipe));
export const reportImageJobKey = (sourceSha256, recipe, uploadId) => digest(canonical({ sourceSha256, recipeHash: reportImageRecipeHash(recipe), ...(uploadId ? { uploadId } : {}) }));
export const PHOTOROOM_MAX_INPUT_BYTES = 30_000_000;
export const PHOTOROOM_MAX_DIMENSION = 5000;
export const PHOTOROOM_MAX_PIXELS = 25_000_000;
export const PHOTOROOM_MAX_OUTPUT_BYTES = 101 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const NEAR_OPAQUE_MIN = 250;
const error = (code, disposition = 'FAILED', receipt = null, details = {}) => Object.assign(new Error(code), { code, disposition, receipt, ...details });
const requestID = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(value) ? value : null;

function pngHeader(bytes, output = false) {
  const code = output ? 'REPORT_IMAGE_OUTPUT_INVALID' : 'REPORT_IMAGE_INPUT_INVALID';
  if (!Buffer.isBuffer(bytes) || bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)
    || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR'
    || bytes[24] !== 8 || !(output ? bytes[25] === 6 : [2, 6].includes(bytes[25]))
    || bytes[26] !== 0 || bytes[27] !== 0) throw error(code);
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (width < 2 || height < 2 || width > PHOTOROOM_MAX_DIMENSION || height > PHOTOROOM_MAX_DIMENSION
    || width * height > PHOTOROOM_MAX_PIXELS) throw error(output ? code : 'REPORT_IMAGE_INPUT_SIZE_UNSUPPORTED');
  // APNG is not one grading photograph, even if a decoder selects only frame 1.
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
    if (length > bytes.length - offset - 12 || type === 'acTL') throw error(code);
    offset += length + 12;
    if (type === 'IEND') { if (length !== 0 || offset !== bytes.length) throw error(code); return { width, height }; }
  }
  throw error(code);
}

async function decodePNG(bytes, output = false) {
  const dimensions = pngHeader(bytes, output), code = output ? 'REPORT_IMAGE_OUTPUT_INVALID' : 'REPORT_IMAGE_INPUT_INVALID';
  try {
    // Compare native stored RGB samples. Default sharp ICC conversion could hide
    // a change through rounding; the embedded profile is verified separately.
    const image = sharp(bytes, { limitInputPixels: PHOTOROOM_MAX_PIXELS, failOn: 'warning', animated: false, ignoreIcc: true });
    const metadata = await image.metadata();
    if (metadata.format !== 'png' || metadata.depth !== 'uchar' || metadata.space !== 'srgb'
      || metadata.width !== dimensions.width || metadata.height !== dimensions.height
      || metadata.pages > 1 || metadata.orientation && metadata.orientation !== 1
      || output && (!metadata.hasAlpha || metadata.channels !== 4)) throw error(code);
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
    if (info.width !== dimensions.width || info.height !== dimensions.height || ![3, 4].includes(info.channels)
      || output && info.channels !== 4 || data.length !== info.width * info.height * info.channels) throw error(code);
    if (!output && info.channels === 4) {
      for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) throw error('REPORT_IMAGE_INPUT_ALPHA_UNSUPPORTED');
    }
    return { ...dimensions, data, channels: info.channels, icc: metadata.icc ?? null };
  } catch (cause) { if (cause.disposition) throw cause; throw error(code); }
}

/** Call before reserving provider dispatch. Never resize an unsupported input. */
export async function inspectReportImageInput({ bytes, contentType, sourceSha256, width, height } = {}) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > PHOTOROOM_MAX_INPUT_BYTES)
    throw error('REPORT_IMAGE_INPUT_SIZE_UNSUPPORTED');
  if (contentType !== 'image/png' || !/^[a-f0-9]{64}$/.test(sourceSha256 ?? '') || digest(bytes) !== sourceSha256)
    throw error('REPORT_IMAGE_INPUT_INVALID');
  const decoded = await decodePNG(bytes);
  if (width !== undefined && width !== decoded.width || height !== undefined && height !== decoded.height)
    throw error('REPORT_IMAGE_SOURCE_MISMATCH');
  return { width: decoded.width, height: decoded.height, sha256: sourceSha256, byteCount: bytes.length, contentType: 'image/png' };
}

function inspectAlphaBoundary(data, width, height, nonOpaquePixels) {
  const pixels = width * height, distance = new Uint8Array(pixels), cap = REPORT_IMAGE_RECIPE.maxFractionalDistance + 1;
  // Two-pass Manhattan distance to alpha 0; saturation keeps this bounded at
  // one byte per input pixel. No image samples are changed.
  for (let p = 0; p < pixels; p++) {
    distance[p] = data[p * 4 + 3] === 0 ? 0 : Math.min(cap,
      p % width ? distance[p - 1] + 1 : cap, p >= width ? distance[p - width] + 1 : cap);
  }
  for (let p = pixels - 1; p >= 0; p--) distance[p] = Math.min(distance[p],
    p % width < width - 1 ? distance[p + 1] + 1 : cap, p + width < pixels ? distance[p + width] + 1 : cap);
  let maxFractionalDistance = 0;
  for (let p = 0; p < pixels; p++) if (data[p * 4 + 3] > 0 && data[p * 4 + 3] < 255)
    maxFractionalDistance = Math.max(maxFractionalDistance, distance[p]);
  // Flood transparent and nonopaque regions separately from the exterior using
  // four neighbors. A transparent hole cannot escape through a translucent
  // bridge. Reuse high bits of the distance array for visitation; the queue has at
  // most one entry per nonopaque pixel, never an unbounded JS object graph.
  const queue = new Uint32Array(nonOpaquePixels);
  for (const [threshold, bit] of [[1, 64], [255, 128]]) {
    let head = 0, tail = 0;
    function visit(p) { if (!(distance[p] & bit) && data[p * 4 + 3] < threshold) { distance[p] |= bit; queue[tail++] = p; } }
    for (let x = 0; x < width; x++) { visit(x); visit((height - 1) * width + x); }
    for (let y = 1; y < height - 1; y++) { visit(y * width); visit(y * width + width - 1); }
    while (head < tail) { const p = queue[head++];
      if (p % width) visit(p - 1); if (p % width < width - 1) visit(p + 1);
      if (p >= width) visit(p - width); if (p + width < pixels) visit(p + width);
    }
  }
  let enclosedTransparentPixels = 0, enclosedFractionalPixels = 0;
  for (let p = 0; p < pixels; p++) {
    const a = data[p * 4 + 3];
    if (a === 0 && !(distance[p] & 64)) enclosedTransparentPixels++;
    else if (a > 0 && a < 255 && !(distance[p] & 128)) enclosedFractionalPixels++;
  }
  return { validation: 'exterior-alpha-band-v1', connectivity: 4, distanceMetric: 'manhattan',
    maxFractionalDistance, enclosedTransparentPixels, enclosedFractionalPixels };
}

/** Validate the actual unmodified provider PNG against the exact uploaded PNG. */
export async function inspectPhotoroomOutput(bytes, sourceBytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > PHOTOROOM_MAX_OUTPUT_BYTES)
    throw error('REPORT_IMAGE_OUTPUT_INVALID');
  if (!Buffer.isBuffer(sourceBytes) || !sourceBytes.length || sourceBytes.length > PHOTOROOM_MAX_INPUT_BYTES)
    throw error('REPORT_IMAGE_INPUT_SIZE_UNSUPPORTED');
  const source = await decodePNG(sourceBytes), output = await decodePNG(bytes, true);
  if (source.width !== output.width || source.height !== output.height) throw error('REPORT_IMAGE_DIMENSIONS_CHANGED');
  const sourceIccSha256 = source.icc ? digest(source.icc) : null, outputIccSha256 = output.icc ? digest(output.icc) : null;
  if (sourceIccSha256 !== outputIccSha256) throw error('REPORT_IMAGE_COLOR_PROFILE_CHANGED', 'FAILED', null,
    { validation: { sourceIccSha256, outputIccSha256 } });
  let transparentPixels = 0, opaquePixels = 0, nearOpaquePixels = 0, visiblePixels = 0, mismatchedPixels = 0;
  let mismatchedChannels = 0, opaqueMismatchedPixels = 0, minChannelDelta = 0, maxChannelDelta = 0;
  let firstMismatch = null;
  const pixelCount = output.width * output.height;
  for (let pixel = 0; pixel < pixelCount; pixel++) {
    const i = pixel * 4, a = output.data[i + 3];
    if (a === 0) transparentPixels++;
    if (a === 255) opaquePixels++;
    if (a >= NEAR_OPAQUE_MIN) nearOpaquePixels++;
    if (a > 0) {
      visiblePixels++;
      const s = pixel * source.channels;
      let mismatch = false;
      for (let c = 0; c < 3; c++) { const delta = output.data[i + c] - source.data[s + c];
        minChannelDelta = Math.min(minChannelDelta, delta); maxChannelDelta = Math.max(maxChannelDelta, delta);
        if (delta) { mismatch = true; mismatchedChannels++; }
      }
      if (mismatch) {
        mismatchedPixels++;
        if (a === 255) opaqueMismatchedPixels++;
        firstMismatch ??= { x: pixel % output.width, y: Math.floor(pixel / output.width), alpha: a,
          sourceRGB: [...source.data.subarray(s, s + 3)], outputRGB: [...output.data.subarray(i, i + 3)] };
      }
    }
  }
  const alpha = { transparentPixels, opaquePixels, nearOpaquePixels, nearOpaqueMin: NEAR_OPAQUE_MIN, pixelCount };
  const foregroundRGB = { validation: 'bounded-edge-rgb-v1', visiblePixels, opaquePixels, fractionalPixels: visiblePixels - opaquePixels,
    comparedChannels: 3, mismatchedPixels, mismatchedChannels, opaqueMismatchedPixels, minChannelDelta, maxChannelDelta };
  if (opaqueMismatchedPixels || minChannelDelta < REPORT_IMAGE_RECIPE.minFractionalChannelDelta
    || maxChannelDelta > REPORT_IMAGE_RECIPE.maxFractionalChannelDelta || mismatchedPixels > visiblePixels * REPORT_IMAGE_RECIPE.maxChangedVisibleRatio)
    throw error('REPORT_IMAGE_FOREGROUND_RGB_CHANGED', 'FAILED', null, { validation: { alpha, foregroundRGB, firstMismatch } });
  if (transparentPixels < Math.ceil(pixelCount * 0.001) || nearOpaquePixels < Math.ceil(pixelCount * 0.1)
    || opaquePixels < visiblePixels * REPORT_IMAGE_RECIPE.minOpaqueVisibleRatio)
    throw error('REPORT_IMAGE_ALPHA_INVALID', 'FAILED', null, { validation: { alpha, foregroundRGB } });
  const alphaBoundary = inspectAlphaBoundary(output.data, output.width, output.height, pixelCount - opaquePixels);
  if (alphaBoundary.maxFractionalDistance > REPORT_IMAGE_RECIPE.maxFractionalDistance
    || alphaBoundary.enclosedTransparentPixels || alphaBoundary.enclosedFractionalPixels)
    throw error('REPORT_IMAGE_ALPHA_BOUNDARY_INVALID', 'FAILED', null, { validation: { alpha, foregroundRGB, alphaBoundary } });
  return { width: output.width, height: output.height, sha256: digest(bytes), byteCount: bytes.length, contentType: 'image/png', alpha,
    foregroundRGB, alphaBoundary, colorProfile: { validation: 'exact-icc-v1', sourceIccSha256, outputIccSha256 } };
}

async function boundedBody(response, signal, maximum) {
  if (!response.body?.getReader) throw error('REPORT_IMAGE_RESPONSE_INVALID');
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum)) throw error('REPORT_IMAGE_RESPONSE_TOO_LARGE');
  const reader = response.body.getReader(), chunks = []; let length = 0;
  try {
    while (true) { signal.throwIfAborted(); const part = await reader.read(); if (part.done) break;
      length += part.value.byteLength; if (length > maximum) throw error('REPORT_IMAGE_RESPONSE_TOO_LARGE');
      chunks.push(Buffer.from(part.value));
    }
    return Buffer.concat(chunks, length);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

async function rejectionEvidence(response, signal, apiKey) {
  try {
    const bytes = await boundedBody(response, signal, 16 * 1024);
    const evidence = { bodyState: 'COMPLETE', bodySha256: digest(bytes), bodyByteCount: bytes.length };
    let payload; try { payload = JSON.parse(bytes.toString('utf8')); } catch { return evidence; }
    const diagnostic = payload?.error;
    if (!diagnostic || typeof diagnostic !== 'object' || Array.isArray(diagnostic)) return evidence;
    for (const key of ['code', 'type', 'param']) {
      const value = diagnostic[key];
      if (typeof value === 'string' && !value.includes(apiKey) && /^[a-zA-Z0-9_.\[\]-]{1,100}$/.test(value)) evidence[key] = value;
    }
    if (typeof diagnostic.message === 'string') evidence.message = diagnostic.message.split(apiKey).join('[REDACTED]')
      .replace(/\bBearer\s+\S+|\bdata:[^\s"<>]*|(?:https?|postgres(?:ql)?):\/\/[^\s"<>]+|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED]')
      .replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 512);
    return evidence;
  } catch (cause) { return { bodyState: cause.code === 'REPORT_IMAGE_RESPONSE_TOO_LARGE' ? 'TOO_LARGE' : 'UNAVAILABLE' }; }
}

/** One POST, no network retry or alternate provider. A lost response remains
 * UNKNOWN. The local request ID is audit correlation, not vendor idempotency. */
export function createReportImageProvider({ apiKey, fetchImpl = fetch, timeoutMs = 180000, recipe = REPORT_IMAGE_RECIPE } = {}) {
  requireThat(typeof apiKey === 'string' && apiKey.length >= 12 && apiKey.length <= 512 && !/\s/.test(apiKey) && !apiKey.startsWith('sandbox_')
    && typeof fetchImpl === 'function' && canonical(recipe) === canonical(REPORT_IMAGE_RECIPE)
    && Number.isInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 240000, 503, 'REPORT_IMAGE_CONFIG_INVALID');
  recipe = REPORT_IMAGE_RECIPE;
  return Object.freeze({ recipe: REPORT_IMAGE_RECIPE, validateInput: inspectReportImageInput,
    async edit({ bytes, contentType, sourceSha256, width, height, requestId, signal }) {
      const input = await inspectReportImageInput({ bytes, contentType, sourceSha256, width, height });
      if (!requestID(requestId)) throw error('REPORT_IMAGE_INPUT_INVALID');
      signal?.throwIfAborted();
      const active = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
      const body = new FormData();
      for (const [key, value] of Object.entries({ removeBackground: true, referenceBox: 'originalImage', padding: 0,
        outputSize: `${input.width}x${input.height}`, 'export.format': 'png', colorSpace: 'original' })) body.set(key, String(value));
      body.set('imageFile', new Blob([bytes], { type: 'image/png' }), 'card.png');
      const initialReceipt = { execution: recipe.execution, recipeVersion: recipe.version, endpoint: recipe.endpoint,
        hdBackgroundRemoval: recipe.hdBackgroundRemoval, recipeHash: reportImageRecipeHash(recipe), sourceSha256,
        sourceWidth: input.width, sourceHeight: input.height, sourceByteCount: bytes.length,
        clientRequestId: requestId, startedAt: new Date().toISOString() };
      let response;
      try { response = await fetchImpl(REPORT_IMAGE_RECIPE.endpoint, { method: 'POST', redirect: 'error',
        headers: { 'x-api-key': apiKey, 'pr-hd-background-removal': 'auto', Accept: 'image/png' }, body, signal: active }); }
      catch { throw error('REPORT_IMAGE_RESPONSE_UNKNOWN', 'UNKNOWN', { ...initialReceipt, finishedAt: new Date().toISOString(), status: null }); }
      const receipt = { ...initialReceipt, providerRequestId: requestID(response.headers.get('x-request-id')),
        finishedAt: new Date().toISOString(), status: response.status };
      if (!response.ok) {
        const providerError = await rejectionEvidence(response, active, apiKey);
        const unknown = response.status >= 500 || response.status === 408;
        throw error(response.status === 429 ? 'REPORT_IMAGE_RATE_LIMITED' : unknown ? 'REPORT_IMAGE_RESPONSE_UNKNOWN' : 'REPORT_IMAGE_REQUEST_REJECTED',
          unknown ? 'UNKNOWN' : 'FAILED', { ...receipt, finishedAt: new Date().toISOString(), providerError });
      }
      let outputBytes;
      try {
        outputBytes = await boundedBody(response, active, PHOTOROOM_MAX_OUTPUT_BYTES);
        const completed = { ...receipt, finishedAt: new Date().toISOString(), outputSha256: digest(outputBytes), byteCount: outputBytes.length };
        if (response.headers.get('pr-unsupported-attributes')?.trim()) throw error('REPORT_IMAGE_ATTRIBUTES_UNSUPPORTED', 'FAILED', completed);
        if (response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'image/png')
          throw error('REPORT_IMAGE_RESPONSE_INVALID', 'FAILED', completed);
        const output = await inspectPhotoroomOutput(outputBytes, bytes);
        return { bytes: outputBytes, receipt: { ...completed, validation: output }, output };
      } catch (cause) {
        throw error(cause.code ?? 'REPORT_IMAGE_RESPONSE_UNKNOWN', cause.disposition ?? 'UNKNOWN',
          { ...receipt, finishedAt: new Date().toISOString(), ...(outputBytes ? { outputSha256: digest(outputBytes), byteCount: outputBytes.length } : {}),
            ...(cause.validation ? { validation: cause.validation } : {}), validationCode: cause.code ?? 'REPORT_IMAGE_RESPONSE_UNKNOWN' },
          { ...(outputBytes ? { responseBytes: outputBytes } : {}), ...(cause.validation ? { validation: cause.validation } : {}) });
      }
    } });
}
