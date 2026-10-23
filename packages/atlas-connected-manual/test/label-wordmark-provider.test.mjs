import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { digest } from '@atlas/manual-service/contract';
import { LABEL_WORDMARK_POLICY, LABEL_WORDMARK_IMAGE_MODEL, LABEL_WORDMARK_VERIFY_MODEL, LABEL_WORDMARK_LIMITS,
  prepareLabelWordmarkRequest, prepareLabelWordmarkVerificationRequest, validateLabelWordmarkReading } from '../src/label-wordmark-contract.mjs';
import { createLabelWordmarkProvider, readLabelWordmarkGeneration, readLabelWordmarkVerification } from '../src/label-wordmark-provider.mjs';
import { decodeLabelWordmarkBase64, validateLabelWordmarkImage, compileLabelWordmark } from '../src/label-wordmark-image.mjs';

const key = 'test-key-not-a-real-provider-key';
const input = { sourceHash: 'a'.repeat(64), role: 'variant', text: 'THRILLERS ICE', traits: ['BRUSH', 'BOLD', 'DRY_BRUSH'], normalizeWordInkHeight: true };
const request = prepareLabelWordmarkRequest(input);
const reading = { transcription: 'THRILLERS ICE', singleLine: true, extraMarks: false, confidence: 'HIGH', words: [
  { text: 'THRILLERS', x: 200, y: 400, width: 650, height: 180 }, { text: 'ICE', x: 930, y: 430, width: 120, height: 120 }] };
const responseBody = value => ({ model: LABEL_WORDMARK_VERIFY_MODEL, status: 'completed', output: [{ type: 'message', role: 'assistant',
  status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });
const saved = (prepared, value, httpStatus = 200) => ({ version: LABEL_WORDMARK_POLICY, requestEvidence: prepared.evidence,
  bodyText: JSON.stringify(value), httpStatus, requestId: 'req_fixture' });
const offline = () => createLabelWordmarkProvider({ apiKey: key, imageApiKey: 'dedicated-image-fixture-key-not-real', fetchImpl: () => { throw new Error('NETWORK_FORBIDDEN'); } });
const clone = value => structuredClone(value);
async function fixture({ color = '#000000', alpha = 1, border = false, blank = false, width = 1536 } = {}) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="1024"><rect width="100%" height="100%" fill="white" fill-opacity="${alpha}"/>${blank ? '' : `<rect x="${border ? 0 : 200}" y="400" width="650" height="180" fill="${color}"/><rect x="930" y="430" width="120" height="120" fill="${color}"/>`}</svg>`;
  const bytes = await sharp(Buffer.from(svg)).png().toBuffer();
  return { bytes, sha256: digest(bytes), mimeType: 'image/png', width, height: 1024 };
}
const image = await fixture();
async function verified(rawRequest = request, rawReading = reading, sourceImage = image) {
  const prepared = await offline().prepareVerification(rawRequest, sourceImage);
  return readLabelWordmarkVerification(saved(prepared, responseBody(rawReading)), rawRequest, sourceImage);
}

test('wordmark identity binds literal text, generic morphology, policy and source without admitting arbitrary prompts', () => {
  assert.equal(request.model, LABEL_WORDMARK_IMAGE_MODEL);
  assert.match(request.requestKey, /^label-wordmark-generate:v1:[a-f0-9]{64}$/);
  assert.deepEqual(request, prepareLabelWordmarkRequest({ ...input, traits: [...input.traits].reverse() }));
  assert.notEqual(request.requestKey, prepareLabelWordmarkRequest({ ...input, sourceHash: 'b'.repeat(64) }).requestKey);
  assert.notEqual(request.requestKey, prepareLabelWordmarkRequest({ ...input, text: 'Thrillers ICE' }).requestKey);
  for (const change of [{ traits: ['NamedCommercialFont'] }, { description: 'copy this logo' }, { traits: ['BOLD', 'LIGHT'] },
    { traits: ['BRUSH', 'SERIF'] }, { traits: ['BRUSH', 'BRUSH'] }, { text: 'a\nb' }, { text: '<script>' },
    { text: ' a' }, { text: 'a  b' }, { text: 'a '.repeat(60).trim() }, { sourceHash: 'wrong' }]) {
    assert.throws(() => prepareLabelWordmarkRequest({ ...input, ...change }), /LABEL_WORDMARK_REQUEST_INVALID/);
  }
  assert.equal(prepareLabelWordmarkRequest({ ...input, text: 'Pokémon Élite' }).text, 'Pokémon Élite');
});

test('generation dispatch is bounded, pinned and single-use; verification is independent blind OCR', async () => {
  const calls = [];
  const provider = createLabelWordmarkProvider({ apiKey: key, imageApiKey: 'dedicated-image-fixture-key-not-real', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(url.endsWith('generations') ? { data: [{ b64_json: image.bytes.toString('base64') }] } : responseBody(reading)),
      { status: 200, headers: { 'x-request-id': 'req_safe' } });
  } });
  const prepared = provider.prepareGeneration(request); assert.equal(calls.length, 0);
  const generation = await provider.generate({ prepared });
  const actualImage = await readLabelWordmarkGeneration(generation, request);
  const verifyPrepared = await provider.prepareVerification(request, actualImage);
  assert.notEqual(prepared.evidence.request.requestKey, verifyPrepared.evidence.request.requestKey);
  assert.match(verifyPrepared.evidence.request.requestKey, /^label-wordmark-verify:v1:[a-f0-9]{64}$/);
  const verification = await readLabelWordmarkVerification(await provider.verify({ prepared: verifyPrepared }), request, actualImage);
  assert.equal(calls.length, 2); assert.equal(verification.reading.transcription, input.text);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer dedicated-image-fixture-key-not-real');
  assert.equal(calls[1].options.headers.Authorization, `Bearer ${key}`);
  const generateBody = JSON.parse(calls[0].options.body), verifyBody = JSON.parse(calls[1].options.body);
  assert.equal(generateBody.model, LABEL_WORDMARK_IMAGE_MODEL); assert.equal(generateBody.n, 1);
  assert.equal(generateBody.output_format, 'png'); assert.equal(generateBody.background, 'opaque');
  assert.equal(generateBody.size, '1536x1024'); assert.equal(generateBody.quality, 'high');
  assert.equal(verifyBody.model, LABEL_WORDMARK_VERIFY_MODEL); assert.equal(verifyBody.reasoning.effort, 'xhigh');
  assert.equal(verifyBody.store, false); assert.equal(verifyBody.input[1].content[1].detail, 'original');
  assert.equal(verifyBody.text.format.strict, true); assert.ok(!calls[1].options.body.includes(input.text));
  assert.equal(calls[0].options.redirect, 'error'); assert.equal(calls[1].options.redirect, 'error');
  assert.ok(!JSON.stringify(generation).includes(key));
  await assert.rejects(provider.generate({ prepared }), /LABEL_WORDMARK_REQUEST_UNPREPARED/);
  await assert.rejects(provider.verify({ prepared: verifyPrepared }), /LABEL_WORDMARK_REQUEST_UNPREPARED/);
  assert.equal(calls.length, 2);
});

test('measured word ink is normalized uniformly without changing text, source pixels or natural aspect ratios', async () => {
  const sourceBefore = digest(image.bytes), verification = await verified();
  const artifact = await compileLabelWordmark({ request, image, verification });
  assert.equal(digest(image.bytes), sourceBefore); assert.equal(artifact.descriptor.sha256, digest(artifact.bytes));
  assert.equal(artifact.descriptor.text, 'THRILLERS ICE'); assert.equal(artifact.descriptor.ink, 'BLACK_ON_WHITE');
  assert.equal(artifact.descriptor.words[0].height, 256); assert.equal(artifact.descriptor.words[1].height, 256);
  assert.deepEqual(artifact.descriptor.words.map(({ start, end }) => [start, end]), [[0, 9], [10, 13]]);
  assert.ok(Math.abs(artifact.descriptor.words[0].width / 256 - 650 / 180) < 0.01);
  assert.equal(artifact.descriptor.words[1].width, 256);
  assert.equal(artifact.descriptor.provenance.ownershipClaimed, false);
  assert.equal(artifact.descriptor.provenance.fontMatchPercentageClaimed, false);
  const decoded = await sharp(artifact.bytes).grayscale().raw().toBuffer({ resolveWithObject: true });
  assert.equal(decoded.info.width, artifact.descriptor.width); assert.equal(decoded.info.height, artifact.descriptor.height);
  assert.equal(artifact.descriptor.mask.sha256, digest(artifact.maskBytes)); assert.ok(artifact.maskBytes.length <= 256 * 1024);
  assert.ok(artifact.descriptor.width <= 4096 && artifact.descriptor.height <= 512);
  const mask = await sharp(artifact.maskBytes).raw().toBuffer({ resolveWithObject: true });
  assert.equal(mask.info.channels, 4);
  for (let pixel = 0; pixel < decoded.info.width * decoded.info.height; pixel++) {
    assert.equal(mask.data[pixel * 4], 255); assert.equal(mask.data[pixel * 4 + 1], 255); assert.equal(mask.data[pixel * 4 + 2], 255);
    assert.equal(mask.data[pixel * 4 + 3], 255 - decoded.data[pixel]);
  }
  const second = await compileLabelWordmark({ request, image, verification });
  assert.deepEqual(artifact.descriptor, second.descriptor); assert.ok(artifact.bytes.equals(second.bytes));
});

test('unrequested height normalization retains relative word geometry', async () => {
  const rawRequest = prepareLabelWordmarkRequest({ ...input, normalizeWordInkHeight: false });
  const artifact = await compileLabelWordmark({ request: rawRequest, image, verification: await verified(rawRequest) });
  assert.equal(artifact.descriptor.words[0].height, 180); assert.equal(artifact.descriptor.words[1].height, 120);
  assert.equal(artifact.descriptor.normalizeWordInkHeight, false);
});

test('spelling, capitalization, ordering, uncertainty and extra marks fail before rendering', () => {
  for (const change of [{ transcription: 'THRILLER ICE' }, { transcription: 'Thrillers ICE' }, { singleLine: false },
    { extraMarks: true }, { confidence: 'MEDIUM' }, { confidence: 'LOW' }]) {
    assert.throws(() => validateLabelWordmarkReading({ ...reading, ...change }, request, image), /LABEL_WORDMARK_SPELLING_UNVERIFIED/);
  }
  const altered = clone(reading); altered.words[1].text = '1CE';
  assert.throws(() => validateLabelWordmarkReading(altered, request, image), /LABEL_WORDMARK_BOX_INVALID/);
  for (const change of [{ x: -1 }, { y: NaN }, { width: 1 }, { height: 2000 }, { x: 220 }, { x: 1.2 }]) {
    const value = clone(reading); Object.assign(value.words[1], change);
    assert.throws(() => validateLabelWordmarkReading(value, request, image), /LABEL_WORDMARK_BOX_INVALID/);
  }
});

test('OCR boxes cannot discard unassigned ink or point to a blank area', async () => {
  const clipped = clone(reading); clipped.words[0].width -= 5;
  await assert.rejects(compileLabelWordmark({ request, image, verification: await verified(request, clipped) }), /LABEL_WORDMARK_UNASSIGNED_INK/);
  const wrong = clone(reading); wrong.words[1].y = 700;
  await assert.rejects(compileLabelWordmark({ request, image, verification: await verified(request, wrong) }), /LABEL_WORDMARK_UNASSIGNED_INK/);
});

test('actual PNG decoding rejects color, transparent background, clipped ink, blank output and wrong dimensions', async () => {
  for (const options of [{ color: '#ff0000' }, { alpha: 0 }, { border: true }, { blank: true }, { width: 1000 }]) {
    await assert.rejects(validateLabelWordmarkImage(await fixture(options)), /LABEL_WORDMARK_(?:IMAGE|COLOR|CLIPPED|INK)_INVALID|LABEL_WORDMARK_CLIPPED/);
  }
  await assert.rejects(validateLabelWordmarkImage({ ...image, sha256: 'b'.repeat(64) }), /LABEL_WORDMARK_IMAGE_INVALID/);
  await assert.rejects(validateLabelWordmarkImage({ ...image, bytes: Buffer.from('not a png') }), /LABEL_WORDMARK_IMAGE_INVALID/);
  assert.throws(() => decodeLabelWordmarkBase64('not base64!'), /LABEL_WORDMARK_IMAGE_INVALID/);
  assert.throws(() => decodeLabelWordmarkBase64(Buffer.from('<svg/>').toString('base64')), /LABEL_WORDMARK_IMAGE_INVALID/);
  assert.throws(() => decodeLabelWordmarkBase64(`${image.bytes.toString('base64')}\n`), /LABEL_WORDMARK_IMAGE_INVALID/);
});

test('saved response binding, complete state and exactly one inline image are required', async () => {
  const provider = offline(), prepared = provider.prepareGeneration(request);
  const generation = saved(prepared, { data: [{ b64_json: image.bytes.toString('base64') }] });
  const different = prepareLabelWordmarkRequest({ ...input, sourceHash: 'b'.repeat(64) });
  await assert.rejects(readLabelWordmarkGeneration(generation, different), /LABEL_WORDMARK_RESPONSE_BINDING_INVALID/);
  for (const value of [{ data: [{ url: 'https://example.com/untrusted.png' }] }, { data: [] },
    { data: [{ b64_json: image.bytes.toString('base64') }, { b64_json: image.bytes.toString('base64') }] }, { error: { message: 'bad' } }]) {
    await assert.rejects(readLabelWordmarkGeneration(saved(prepared, value), request), /LABEL_WORDMARK_RESPONSE_INVALID/);
  }
  const vp = await provider.prepareVerification(request, image);
  for (const mutate of [v => { v.status = 'incomplete'; }, v => { v.error = { message: 'failed' }; },
    v => { v.output[0].content = [{ type: 'refusal', refusal: 'no' }]; }, v => { v.model = 'different'; }]) {
    const value = responseBody(reading); mutate(value);
    await assert.rejects(readLabelWordmarkVerification(saved(vp, value), request, image), /LABEL_WORDMARK_RESPONSE_(?:INVALID|INCOMPLETE)/);
  }
  const good = await verified();
  await assert.rejects(compileLabelWordmark({ request, image, verification: { ...good, sourceHash: 'b'.repeat(64) } }), /LABEL_WORDMARK_VERIFICATION_CHANGED/);
  assert.notEqual(prepareLabelWordmarkVerificationRequest(request, image).requestKey,
    prepareLabelWordmarkVerificationRequest(request, { ...image, sha256: 'b'.repeat(64) }).requestKey);
});

test('transport uncertainty and HTTP failure retain single-dispatch semantics without leaking diagnostics', async () => {
  let calls = 0;
  const uncertain = createLabelWordmarkProvider({ apiKey: key, imageApiKey: 'dedicated-image-fixture-key-not-real', fetchImpl: async () => { calls++; throw new Error(`transport ${key}`); } });
  const prepared = uncertain.prepareGeneration(request);
  await assert.rejects(uncertain.generate({ prepared }), error => error.code === 'LABEL_WORDMARK_PROVIDER_UNCERTAIN' && !error.message.includes(key));
  await assert.rejects(uncertain.generate({ prepared }), /LABEL_WORDMARK_REQUEST_UNPREPARED/); assert.equal(calls, 1);
  const denied = createLabelWordmarkProvider({ apiKey: key, imageApiKey: 'dedicated-image-fixture-key-not-real', fetchImpl: async () => { calls++; return new Response('{"error":{"code":"insufficient_quota"}}', { status: 429 }); } });
  const refusal = await denied.generate({ prepared: denied.prepareGeneration(request) });
  assert.equal(refusal.httpStatus, 429); assert.match(refusal.bodyText, /insufficient_quota/);
  await assert.rejects(readLabelWordmarkGeneration(refusal, request), /LABEL_WORDMARK_PROVIDER_HTTP_ERROR/); assert.equal(calls, 2);
});

test('redirects, excessive response headers, streamed overflow and foreign prepared capabilities are refused', async () => {
  for (const response of [{ redirected: true, url: 'https://wrong.example' },
    new Response('{}', { headers: { 'content-length': String(LABEL_WORDMARK_LIMITS.responseBytes + 1) } }),
    new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(LABEL_WORDMARK_LIMITS.responseBytes + 1)); controller.close(); } }))]) {
    let calls = 0; const provider = createLabelWordmarkProvider({ apiKey: key, imageApiKey: 'dedicated-image-fixture-key-not-real', fetchImpl: async () => { calls++; return response; } });
    await assert.rejects(provider.generate({ prepared: provider.prepareGeneration(request) }), /LABEL_WORDMARK_PROVIDER_REDIRECT|LABEL_WORDMARK_RESPONSE_TOO_LARGE/);
    assert.equal(calls, 1);
  }
  const provider = offline();
  await assert.rejects(provider.generate({ prepared: clone(provider.prepareGeneration(request)) }), /LABEL_WORDMARK_REQUEST_UNPREPARED/);
  await assert.rejects(provider.prepareVerification(request, { ...image, bytes: Buffer.from('broken') }), /LABEL_WORDMARK_IMAGE_INVALID/);
});


test('image generation requires its dedicated key and never spends with the analysis credential', async () => {
  let calls = 0;
  const provider = createLabelWordmarkProvider({ apiKey: key, fetchImpl: async () => { calls++; assert.fail('no dispatch'); } });
  assert.throws(() => provider.prepareGeneration(request), /LABEL_WORDMARK_IMAGE_CREDENTIAL_REQUIRED/);
  const prepared = await provider.prepareVerification(request, image);
  assert.ok(prepared.evidence.request.requestKey.startsWith('label-wordmark-verify:'));
  assert.equal(calls, 0);
});
