import { canonical, digest, requireThat } from '@atlas/manual-service/contract';

export const REPORT_IMAGE_MODEL = 'gpt-image-2.5-sunburst-2026-09-08';
export const REPORT_IMAGE_PROMPT_VERSION = 'atlas-background-extraction-api-v2';
export const REPORT_IMAGE_PROMPT = 'Cut out the entire physical trading card from this photograph. Make every pixel outside its physical edge transparent (alpha 0). Keep the whole card opaque, including its printed borders, all corners, text, artwork, foil and defects. Preserve the card’s existing position, scale and framing. Do not create any colored background, gradient, shadow or checkerboard. Return one RGBA PNG with transparent space around the card.';
export const REPORT_IMAGE_RECIPE = Object.freeze({ version: 'atlas-report-image-recipe-v1', execution: 'OPENAI_IMAGES_API',
  model: REPORT_IMAGE_MODEL, promptVersion: REPORT_IMAGE_PROMPT_VERSION, prompt: REPORT_IMAGE_PROMPT,
  background: 'transparent', output_format: 'png', quality: 'xhigh', size: '1104x1520', n: 1 });
export const reportImageRecipeHash = recipe => digest(canonical(recipe));
export const reportImageJobKey = (sourceSha256, recipe) => digest(canonical({ sourceSha256, recipeHash: reportImageRecipeHash(recipe) }));
const error = (code, disposition = 'UNKNOWN', receipt = null) => Object.assign(new Error(code), { code, disposition, receipt });
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
async function boundedJSON(response, signal) {
  requireThat(response.body?.getReader, 503, 'REPORT_IMAGE_RESPONSE_INVALID');
  const reader = response.body.getReader(), chunks = []; let length = 0;
  try { while (true) { signal.throwIfAborted(); const part = await reader.read(); if (part.done) break;
    length += part.value.byteLength; if (length > 24 * 1024 * 1024) throw error('REPORT_IMAGE_RESPONSE_TOO_LARGE', 'FAILED'); chunks.push(Buffer.from(part.value)); }
    return JSON.parse(Buffer.concat(chunks, length).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
function requestID(value) { return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(value) ? value : null; }
function usageReceipt(value) {
  if (!value || typeof value !== 'object') return null;
  const result = {};
  for (const key of ['input_tokens','output_tokens','total_tokens']) if (Number.isSafeInteger(value[key]) && value[key] >= 0) result[key] = value[key];
  return Object.keys(result).length ? result : null;
}

/** One explicit POST, no SDK retries. Never send a public/signed source URL or
 * log provider response bodies. A lost response is UNKNOWN, not permission to
 * purchase another edit. X-Client-Request-Id is audit correlation, not a claim
 * that the Images API guarantees idempotency. */
export function createReportImageProvider({ apiKey, fetchImpl = fetch, timeoutMs = 180000, recipe = REPORT_IMAGE_RECIPE } = {}) {
  requireThat(typeof apiKey === 'string' && apiKey.length >= 12 && !/[\r\n]/.test(apiKey)
    && canonical(recipe) === canonical(REPORT_IMAGE_RECIPE) && timeoutMs >= 1000 && timeoutMs <= 240000,
  503, 'REPORT_IMAGE_CONFIG_INVALID');
  return Object.freeze({ recipe, async edit({ bytes, contentType, sourceSha256, requestId, signal }) {
    requireThat(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= MAX_IMAGE_BYTES
      && ['image/png','image/webp','image/jpeg'].includes(contentType) && digest(bytes) === sourceSha256
      && requestID(requestId), 503, 'REPORT_IMAGE_INPUT_INVALID');
    signal?.throwIfAborted();
    const active = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
    const body = new FormData();
    for (const key of ['model','prompt','background','output_format','quality','size','n']) body.set(key, String(recipe[key]));
    body.set('image[]', new Blob([bytes], { type: contentType }), `card.${contentType.split('/')[1]}`);
    const startedAt = new Date().toISOString(); let response;
    try { response = await fetchImpl('https://api.openai.com/v1/images/edits', { method: 'POST', redirect: 'error',
      headers: { Authorization: `Bearer ${apiKey}`, 'X-Client-Request-Id': requestId }, body, signal: active }); }
    catch { throw error('REPORT_IMAGE_RESPONSE_UNKNOWN'); }
    const receipt = { execution: 'OPENAI_IMAGES_API', model: recipe.model, promptVersion: recipe.promptVersion,
      promptSha256: digest(recipe.prompt), recipeHash: reportImageRecipeHash(recipe), sourceSha256,
      clientRequestId: requestId, providerRequestId: requestID(response.headers.get('x-request-id')),
      startedAt, finishedAt: new Date().toISOString(), status: response.status };
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      // 429 means the request was rejected. Network/5xx/408 may have accepted
      // work; preserve uncertainty instead of automatically duplicating cost.
      throw error(response.status === 429 ? 'REPORT_IMAGE_RATE_LIMITED' : response.status >= 500 || response.status === 408
        ? 'REPORT_IMAGE_RESPONSE_UNKNOWN' : 'REPORT_IMAGE_REQUEST_REJECTED', response.status === 429 ? 'RETRY'
        : response.status >= 500 || response.status === 408 ? 'UNKNOWN' : 'FAILED', receipt);
    }
    let payload;
    try { payload = await boundedJSON(response, active); } catch (cause) { throw error(cause.code ?? 'REPORT_IMAGE_RESPONSE_UNKNOWN', cause.disposition ?? 'UNKNOWN', receipt); }
    const completed = { ...receipt, finishedAt: new Date().toISOString(), usage: usageReceipt(payload?.usage) };
    try {
      const encoded = Array.isArray(payload?.data) && payload.data.length === 1 ? payload.data[0]?.b64_json : null;
      if (typeof encoded !== 'string' || !encoded.length || encoded.length % 4 !== 0
        || encoded.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) throw error('REPORT_IMAGE_RESPONSE_INVALID', 'FAILED');
      // Canonical round-trip validation is linear and bounded. A repeated
      // quartet regexp can exhaust the JS stack on ordinary multi-MiB PNGs.
      const output = Buffer.from(encoded, 'base64');
      if (!output.length || output.length > MAX_IMAGE_BYTES || output.toString('base64') !== encoded)
        throw error('REPORT_IMAGE_RESPONSE_INVALID', 'FAILED');
      return { bytes: output, receipt: { ...completed, outputSha256: digest(output), byteCount: output.length } };
    } catch (cause) { throw error(cause.code ?? 'REPORT_IMAGE_RESPONSE_INVALID', cause.disposition ?? 'FAILED', completed); }
  } });
}
