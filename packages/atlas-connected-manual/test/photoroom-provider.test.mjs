import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { digest } from '@atlas/manual-service/contract';
import { createReportImageProvider, inspectReportImageInput, inspectPhotoroomOutput, REPORT_IMAGE_RECIPE,
  reportImageRecipeHash, reportImageJobKey, PHOTOROOM_MAX_INPUT_BYTES, PHOTOROOM_MAX_OUTPUT_BYTES } from '../src/report-image-provider.mjs';

const apiKey = 'photoroom-unit-test-private-key';
async function fixture({ width = 64, height = 80, profile = null } = {}) {
  const rgb = Buffer.alloc(width * height * 3), rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = y * width + x, i = p * 3, j = p * 4;
    rgb[i] = (x * 31 + y * 11) % 256; rgb[i + 1] = (x * 7 + y * 19) % 256; rgb[i + 2] = (x * 13 + y * 43) % 256;
    rgb.copy(rgba, j, i, i + 3);
    rgba[j + 3] = x > 1 && x < width - 2 && y > 1 && y < height - 2 ? y === 2 && x === 2 ? 1 : y === 2 && x === 3 ? 250 : 255 : 0;
  }
  async function encode(data, channels) {
    let image = sharp(data, { raw: { width, height, channels } });
    if (profile) image = image.withIccProfile(profile);
    return image.png().toBuffer();
  }
  const source = await encode(rgb, 3), output = await encode(rgba, 4);
  return { source, output, rgb, rgba, width, height,
    input: { bytes: source, contentType: 'image/png', sourceSha256: digest(source), width, height, requestId: 'test-request-1' } };
}
const response = (bytes, headers = {}) => new Response(bytes, { headers: { 'content-type': 'image/png', 'x-request-id': 'vendor-1', ...headers } });

function provider(fetchImpl) { return createReportImageProvider({ apiKey, fetchImpl }); }

test('sole fixed Plus endpoint, exact multipart contract and immutable source bytes', async () => {
  const f = await fixture(); let calls = 0;
  const p = provider(async (url, options) => {
    calls++; assert.equal(url, 'https://image-api.photoroom.com/v2/edit');
    assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
    assert.deepEqual(options.headers, { 'x-api-key': apiKey, 'pr-hd-background-removal': 'auto', Accept: 'image/png' });
    assert.deepEqual([...options.body.keys()].sort(), ['colorSpace', 'export.format', 'imageFile', 'outputSize', 'padding', 'referenceBox', 'removeBackground'].sort());
    assert.equal(options.body.get('removeBackground'), 'true'); assert.equal(options.body.get('referenceBox'), 'originalImage');
    assert.equal(options.body.get('padding'), '0'); assert.equal(options.body.get('outputSize'), '64x80');
    assert.equal(options.body.get('export.format'), 'png'); assert.equal(options.body.get('colorSpace'), 'original');
    const uploaded = options.body.get('imageFile'); assert.equal(uploaded.type, 'image/png');
    assert.deepEqual(Buffer.from(await uploaded.arrayBuffer()), f.source);
    return response(f.output);
  });
  const result = await p.edit(f.input);
  assert.equal(calls, 1); assert.deepEqual(result.bytes, f.output);
  assert.equal(result.receipt.execution, 'PHOTOROOM_PLUS_API'); assert.equal(result.receipt.recipeVersion, REPORT_IMAGE_RECIPE.version);
  assert.equal(result.receipt.endpoint, REPORT_IMAGE_RECIPE.endpoint); assert.equal(result.receipt.sourceSha256, digest(f.source));
  assert.equal(result.receipt.outputSha256, digest(f.output)); assert.equal(result.receipt.providerRequestId, 'vendor-1');
  assert.equal(result.output.foregroundRGB.mismatchedPixels, 0); assert.equal(result.output.foregroundRGB.visiblePixels, 4560);
  assert.equal(result.output.alpha.transparentPixels, 560); assert.equal(result.output.alpha.nearOpaquePixels, 4559);
  assert.deepEqual(result.output.alphaBoundary, { validation: 'exterior-alpha-band-v1', connectivity: 4, distanceMetric: 'manhattan',
    maxFractionalDistance: 1, enclosedTransparentPixels: 0, enclosedFractionalPixels: 0 });
});

test('rejects source MIME/hash/dimensions/malformed PNG before fetch', async () => {
  const f = await fixture(); let calls = 0; const p = provider(async () => { calls++; });
  for (const patch of [{ contentType: 'image/jpeg' }, { sourceSha256: 'b'.repeat(64) }, { width: 13 }, { requestId: '' },
    { bytes: Buffer.from('not png'), sourceSha256: digest('not png') }]) {
    await assert.rejects(p.edit({ ...f.input, ...patch }), cause => cause.disposition === 'FAILED');
  }
  assert.equal(calls, 0);
});

test('rejects >30MB and >5000px before decoding or provider dispatch', async () => {
  const f = await fixture(); let calls = 0; const p = provider(async () => { calls++; });
  const tooBig = Buffer.alloc(PHOTOROOM_MAX_INPUT_BYTES + 1);
  await assert.rejects(p.edit({ ...f.input, bytes: tooBig, sourceSha256: digest(tooBig) }), { code: 'REPORT_IMAGE_INPUT_SIZE_UNSUPPORTED' });
  for (const offset of [16, 20]) {
    const bytes = Buffer.from(f.source); bytes.writeUInt32BE(5001, offset);
    await assert.rejects(p.edit({ ...f.input, bytes, sourceSha256: digest(bytes) }), { code: 'REPORT_IMAGE_INPUT_SIZE_UNSUPPORTED' });
  }
  assert.equal(calls, 0);
});

test('full 3024x4032 source is accepted without size changes', async () => {
  const source = await sharp({ create: { width: 3024, height: 4032, channels: 3, background: '#e1c2a3' } }).png().toBuffer();
  assert.deepEqual(await inspectReportImageInput({ bytes: source, contentType: 'image/png', sourceSha256: digest(source), width: 3024, height: 4032 }),
    { width: 3024, height: 4032, byteCount: source.length, sha256: digest(source), contentType: 'image/png' });
});

test('rejects non-normalized orientation and transparent input', async () => {
  const f = await fixture();
  const rotated = await sharp(f.source).withMetadata({ orientation: 6 }).png().toBuffer();
  for (const bytes of [rotated, f.output]) await assert.rejects(inspectReportImageInput({ bytes, contentType: 'image/png', sourceSha256: digest(bytes) }), cause => cause.disposition === 'FAILED');
});

test('rejects output size drift and RGB rather than RGBA PNG', async () => {
  const f = await fixture();
  const resized = await sharp(f.output).resize(10, 10).png().toBuffer();
  await assert.rejects(inspectPhotoroomOutput(resized, f.source), { code: 'REPORT_IMAGE_DIMENSIONS_CHANGED' });
  await assert.rejects(inspectPhotoroomOutput(f.source, f.source), { code: 'REPORT_IMAGE_OUTPUT_INVALID' });
});

test('even one brighter RGB unit at alpha 1 is rejected with paid receipt and raw response intact', async () => {
  const f = await fixture(); const pixels = Buffer.from(f.rgba); const p = 2 * f.width + 2; pixels[p * 4]++;
  const output = await sharp(pixels, { raw: { width: f.width, height: f.height, channels: 4 } }).png().toBuffer(); let calls = 0;
  await assert.rejects(provider(async () => { calls++; return response(output); }).edit(f.input), cause => {
    assert.equal(cause.code, 'REPORT_IMAGE_FOREGROUND_RGB_CHANGED'); assert.equal(cause.disposition, 'FAILED');
    assert.equal(cause.validation.foregroundRGB.mismatchedPixels, 1); assert.equal(cause.validation.firstMismatch.alpha, 1);
    assert.equal(cause.receipt.status, 200); assert.equal(cause.receipt.outputSha256, digest(output));
    assert.deepEqual(cause.responseBytes, output); assert(!JSON.stringify(cause.receipt).includes(apiKey)); return true;
  });
  assert.equal(calls, 1);
});

test('fully transparent RGB may change but opaque RGB never may', async () => {
  const f = await fixture(); const pixels = Buffer.from(f.rgba); pixels[0]++;
  const output = await sharp(pixels, { raw: { width: f.width, height: f.height, channels: 4 } }).png().toBuffer();
  assert.equal((await inspectPhotoroomOutput(output, f.source)).foregroundRGB.mismatchedPixels, 0);
  pixels[(6 * f.width + 6) * 4]++;
  const changed = await sharp(pixels, { raw: { width: f.width, height: f.height, channels: 4 } }).png().toBuffer();
  await assert.rejects(inspectPhotoroomOutput(changed, f.source), { code: 'REPORT_IMAGE_FOREGROUND_RGB_CHANGED' });
});

test('approved exterior rounding stays unmodified and records exact measured provenance', async () => {
  const f = await fixture(), pixels = Buffer.from(f.rgba), p = 2 * f.width + 2;
  pixels[p * 4]--; pixels[p * 4 + 1]--;
  const output = await sharp(pixels, { raw: { width: f.width, height: f.height, channels: 4 } }).png().toBuffer();
  const result = await provider(async () => response(output)).edit(f.input);
  assert.deepEqual(result.bytes, output);
  assert.deepEqual(result.output.foregroundRGB, { validation: 'bounded-edge-rgb-v1', visiblePixels: 4560, opaquePixels: 4558,
    fractionalPixels: 2, comparedChannels: 3, mismatchedPixels: 1, mismatchedChannels: 2, opaqueMismatchedPixels: 0,
    minChannelDelta: -1, maxChannelDelta: 0 });
  assert.equal(result.receipt.recipeVersion, 'atlas-photoroom-plus-hd-v2');
});

test('rejects opaque -1, fractional -2 and broad fractional recoloring', async () => {
  const f = await fixture();
  for (const kind of ['opaque', 'two-level', 'broad']) {
    const pixels = Buffer.from(f.rgba);
    if (kind === 'opaque') pixels[(4 * f.width + 4) * 4]--;
    else if (kind === 'two-level') pixels[(2 * f.width + 2) * 4] -= 2;
    else for (let x = 2; x < 13; x++) { const i = (2 * f.width + x) * 4; pixels[i + 3] = 127; pixels[i]--; }
    const output = await sharp(pixels, { raw: { width: f.width, height: f.height, channels: 4 } }).png().toBuffer();
    await assert.rejects(inspectPhotoroomOutput(output, f.source), { code: 'REPORT_IMAGE_FOREGROUND_RGB_CHANGED' });
  }
});

test('all fractional alpha must be exterior-connected and within Manhattan distance 16 of alpha zero', async () => {
  const f = await fixture({ width: 96, height: 96 });
  for (const kind of ['distance-16', 'distance-17', 'fractional-hole', 'transparent-hole', 'transparent-hole-with-soft-bridge', 'diagonal-only']) {
    const pixels = Buffer.from(f.rgba);
    if (kind.startsWith('distance')) {
      const length = kind === 'distance-16' ? 16 : 17;
      for (let x = 2; x < 2 + length; x++) pixels[(40 * f.width + x) * 4 + 3] = 127;
    } else if (kind === 'transparent-hole-with-soft-bridge') {
      pixels[(2 * f.width + 3) * 4 + 3] = 127;
      pixels[(3 * f.width + 3) * 4 + 3] = 0;
    } else if (kind === 'diagonal-only') {
      pixels[(2 * f.width + 2) * 4 + 3] = 0; pixels[(2 * f.width + 3) * 4 + 3] = 255;
      pixels[(3 * f.width + 3) * 4 + 3] = 127;
    } else pixels[(40 * f.width + 40) * 4 + 3] = kind === 'transparent-hole' ? 0 : 127;
    const output = await sharp(pixels, { raw: { width: f.width, height: f.height, channels: 4 } }).png().toBuffer();
    if (kind === 'distance-16') assert.equal((await inspectPhotoroomOutput(output, f.source)).alphaBoundary.maxFractionalDistance, 16);
    else await assert.rejects(inspectPhotoroomOutput(output, f.source), { code: 'REPORT_IMAGE_ALPHA_BOUNDARY_INVALID' });
  }
});

test('rejects broad transparency even when RGB and the exterior band are unchanged', async () => {
  const f = await fixture(), pixels = Buffer.from(f.rgba);
  for (let y = 2; y < 4; y++) for (let x = 2; x < f.width - 2; x++) pixels[(y * f.width + x) * 4 + 3] = 127;
  const output = await sharp(pixels, { raw: { width: f.width, height: f.height, channels: 4 } }).png().toBuffer();
  await assert.rejects(inspectPhotoroomOutput(output, f.source), { code: 'REPORT_IMAGE_ALPHA_INVALID' });
});

test('requires meaningful transparency and retained opaque foreground', async () => {
  const f = await fixture();
  for (const a of [0, 1, 255]) {
    const pixels = Buffer.from(f.rgba); for (let i = 3; i < pixels.length; i += 4) pixels[i] = a;
    const output = await sharp(pixels, { raw: { width: f.width, height: f.height, channels: 4 } }).png().toBuffer();
    await assert.rejects(inspectPhotoroomOutput(output, f.source), { code: 'REPORT_IMAGE_ALPHA_INVALID' });
  }
});

test('preserves exact ICC profile and compares unconverted native RGB', async () => {
  const f = await fixture({ profile: 'p3' });
  const checked = await inspectPhotoroomOutput(f.output, f.source);
  assert.match(checked.colorProfile.sourceIccSha256, /^[a-f0-9]{64}$/);
  assert.equal(checked.colorProfile.sourceIccSha256, checked.colorProfile.outputIccSha256);
  const stripped = await sharp(f.output, { ignoreIcc: true }).png().toBuffer();
  await assert.rejects(inspectPhotoroomOutput(stripped, f.source), { code: 'REPORT_IMAGE_COLOR_PROFILE_CHANGED' });
});

test('rejects ignored attributes and non-PNG response with one dispatch', async () => {
  const f = await fixture();
  for (const headers of [{ 'pr-unsupported-attributes': 'Unsupported attributes: colorSpace' }, { 'content-type': 'image/jpeg' }]) {
    let calls = 0;
    await assert.rejects(provider(async () => { calls++; return response(f.output, headers); }).edit(f.input), cause => {
      assert.equal(cause.disposition, 'FAILED'); assert.deepEqual(cause.responseBytes, f.output); return true;
    });
    assert.equal(calls, 1);
  }
});

test('rejects declared and streamed output limit overruns', async () => {
  const f = await fixture();
  await assert.rejects(provider(async () => response(f.output, { 'content-length': String(PHOTOROOM_MAX_OUTPUT_BYTES + 1) })).edit(f.input),
    { code: 'REPORT_IMAGE_RESPONSE_TOO_LARGE', disposition: 'FAILED' });
  let cancelled = false, count = 0;
  const body = new ReadableStream({ pull(controller) { count++; controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { cancelled = true; } });
  await assert.rejects(provider(async () => new Response(body, { headers: { 'content-type': 'image/png' } })).edit(f.input),
    { code: 'REPORT_IMAGE_RESPONSE_TOO_LARGE', disposition: 'FAILED' });
  assert(cancelled); assert(count <= 103);
});

test('definite rejections including 429 are terminal and sanitized; 5xx remain unknown', async () => {
  const f = await fixture();
  for (const status of [400, 401, 402, 429, 408, 500]) {
    let calls = 0;
    const p = provider(async () => { calls++; return new Response(JSON.stringify({ error: { code: 'rejected', message: `secret ${apiKey} https://private.test/source` } }), { status }); });
    await assert.rejects(p.edit(f.input), cause => {
      assert.equal(cause.disposition, status === 408 || status >= 500 ? 'UNKNOWN' : 'FAILED');
      assert.equal(cause.receipt.status, status); assert(!JSON.stringify(cause.receipt).includes(apiKey));
      assert(!JSON.stringify(cause.receipt).includes('private.test')); return true;
    });
    assert.equal(calls, 1);
  }
});

test('network and partial response failures retain uncertainty and never retry', async () => {
  const f = await fixture(); let calls = 0;
  await assert.rejects(provider(async () => { calls++; throw new Error('lost response'); }).edit(f.input), cause => {
    assert.equal(cause.code, 'REPORT_IMAGE_RESPONSE_UNKNOWN'); assert.equal(cause.disposition, 'UNKNOWN');
    assert.equal(cause.receipt.clientRequestId, f.input.requestId); return true;
  });
  assert.equal(calls, 1);
  const stream = new ReadableStream({ start(controller) { controller.error(new Error('connection closed')); } });
  await assert.rejects(provider(async () => new Response(stream, { headers: { 'content-type': 'image/png' } })).edit(f.input), { disposition: 'UNKNOWN' });
});

test('recipe/source/upload cache identities are exact and alternate recipes are refused', () => {
  const source = 'a'.repeat(64), key = reportImageJobKey(source, REPORT_IMAGE_RECIPE, 'upload-1');
  assert.equal(key, reportImageJobKey(source, structuredClone(REPORT_IMAGE_RECIPE), 'upload-1'));
  assert.notEqual(key, reportImageJobKey(source, REPORT_IMAGE_RECIPE, 'upload-2'));
  assert.notEqual(key, reportImageJobKey('b'.repeat(64), REPORT_IMAGE_RECIPE, 'upload-1'));
  assert.notEqual(reportImageRecipeHash(REPORT_IMAGE_RECIPE), reportImageRecipeHash({ ...REPORT_IMAGE_RECIPE, colorSpace: 'sRGB' }));
  assert.throws(() => createReportImageProvider({ apiKey, recipe: { ...REPORT_IMAGE_RECIPE, padding: 1 } }), { code: 'REPORT_IMAGE_CONFIG_INVALID' });
  assert.throws(() => createReportImageProvider({ apiKey: `sandbox_${apiKey}` }), { code: 'REPORT_IMAGE_CONFIG_INVALID' });
});

test('provider and canary contain no prior provider dispatch, prompt or shared secret fallback', async () => {
  const source = await readFile(new URL('../src/report-image-provider.mjs', import.meta.url), 'utf8');
  const canary = await readFile(new URL('../scripts/report-image-canary.mjs', import.meta.url), 'utf8');
  for (const text of [source, canary]) {
    assert(!/api\.openai\.com|OPENAI_IMAGES_API|REPORT_IMAGE_PROMPT|REPORT_IMAGE_MODEL|ATLAS_MANUAL_OPENAI_KEY|ATLAS_MANUAL_REPORT_IMAGES_OPENAI_KEY/.test(text));
  }
  assert.match(canary, /process\.env\.ATLAS_PHOTOROOM_API_KEY/);
  assert.match(canary, /'request\.json'/); assert.match(canary, /flag: 'wx'/);
});
