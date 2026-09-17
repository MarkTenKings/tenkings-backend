import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import {
  identifyCard, parseCardIdentificationResult, cardIdentificationInputHash,
  buildCardIdentificationOcrRequest, CardIdentificationError,
} from '../src/index.mjs';
import {
  identifyCardV2, parseCardIdentificationResultV2, parseCardIdentificationResultStructureV2,
  cardIdentificationInputHashV2, CARD_IDENTIFICATION_VERSION_V2,
  CARD_IDENTIFICATION_SOURCE_COMMIT_V2, CARD_IDENTIFICATION_GOOGLE_TEXT_FIELDS_V2,
} from '../src/v2.mjs';

const fixture = JSON.parse(await readFile(new URL('./fixtures/source-parity-v2.json', import.meta.url)));
const oldFixture = JSON.parse(await readFile(new URL('./fixtures/source-parity.json', import.meta.url)));
const hash = value => createHash('sha256').update(value).digest('hex');
const raw = value => Buffer.from(JSON.stringify(value));
const bytes = Object.fromEntries(Object.entries(fixture.photos).map(([side, value]) => [side, Buffer.from(value, 'base64')]));
const descriptor = (side, value) => ({ ref: `opaque-${side}-derivative`, sha256: hash(value), byteCount: value.length });
const input = (photos = bytes) => ({ subject: { id: 'neutral-subject', revision: 'original-pair-2' }, photos: {
  front: descriptor('front', photos.front), back: descriptor('back', photos.back),
} });
const error = code => value => value instanceof CardIdentificationError && value.code === code;
function harness(ocr = fixture.cases[0].ocr, photos = bytes, overrides = {}) {
  const calls = { reads: [], ocr: [], model: [] };
  const effects = {
    async readPhoto(photo, context) { calls.reads.push({ photo, context }); return photos[context.side]; },
    async ocr(request, context) { calls.ocr.push({ request, context }); return raw({ responses: [{ fullTextAnnotation: { text: ocr[context.side].text } }] }); },
    async model(request, context) { calls.model.push({ request, context }); return raw(fixture.provider_payload); },
    ...overrides,
  };
  return { effects, calls };
}

for (const candidate of fixture.cases) {
  test(`V2 ${candidate.name} request exactly matches the immutable Inventory source golden`, async () => {
    const { effects, calls } = harness(candidate.ocr);
    const expected = input();
    const result = await identifyCardV2(expected, effects);
    assert.equal(fixture.source_commit, CARD_IDENTIFICATION_SOURCE_COMMIT_V2);
    assert.equal(calls.reads.length, 2); assert.equal(calls.ocr.length, 2); assert.equal(calls.model.length, 1);
    assert.equal(JSON.stringify(calls.model[0].request), JSON.stringify(candidate.request));
    assert.equal(result.provenance.request_sha256, candidate.request_sha256);
    assert.equal(calls.model[0].context.requestHash, candidate.request_sha256);
    assert.equal(result.provenance.response_sha256, hash(raw(fixture.provider_payload)));
    assert.deepEqual(result.suggestions, fixture.parsed_suggestions);
    assert.deepEqual(parseCardIdentificationResultV2(result, expected), result);
    assert.deepEqual(result.provenance.photos, expected.photos);
    assert.equal(result.provenance.input_sha256, cardIdentificationInputHashV2(expected));
    for (const { request, context } of calls.ocr) {
      assert.deepEqual(request, { body: buildCardIdentificationOcrRequest(bytes[context.side]), responseFields: fixture.response_fields });
      assert.equal(context.requestHash, hash(JSON.stringify(request)));
      assert.equal(result.provenance.ocr.request_sha256[context.side], context.requestHash);
      assert.notEqual(context.requestHash, hash(JSON.stringify(request.body)));
      assert.equal(context.inputHash, result.provenance.input_sha256);
      assert.ok(Object.isFrozen(request) && Object.isFrozen(request.body));
    }
    assert.equal(calls.model[0].context.inputHash, result.provenance.input_sha256);
    assert.deepEqual(calls.model[0].context.pokemonDetail, result.provenance.pokemon_detail);
    assert.equal(JSON.stringify(calls.model[0].request).includes(expected.subject.id), false);
    assert.equal(JSON.stringify(calls.model[0].request).includes(expected.photos.front.ref), false);
    if (candidate.name === 'sports') {
      assert.equal(JSON.stringify(candidate.request), JSON.stringify(oldFixture.request));
      assert.equal(result.provenance.pokemon_detail, null);
      assert.equal(candidate.request.input[0].content.length, 4);
    } else {
      const detail = result.provenance.pokemon_detail;
      const suppliedCrop = Buffer.from(calls.model[0].request.input[0].content[5].image_url.split(',')[1], 'base64');
      const expectedCrop = await sharp(bytes.front).extract({ left: 0, top: 8, width: 12, height: 8 }).png().toBuffer();
      assert.deepEqual(suppliedCrop, expectedCrop);
      assert.deepEqual(detail, {
        transform: 'pokemon-lower-front-png-v1', parent_side: 'front', parent_sha256: expected.photos.front.sha256,
        source_width: 12, source_height: 16, region: { left: 0, top: 8, width: 12, height: 8 },
        mime_type: 'image/png', byte_count: expectedCrop.length, sha256: hash(expectedCrop),
      });
      assert.deepEqual(candidate.request.input[0].content.slice(0, 4).filter(part => part.type === 'input_image'), oldFixture.request.input[0].content.filter(part => part.type === 'input_image'));
    }
  });
}

test('the fields envelope prevents simulated polygon overflow without changing OCR body or provider limits', async () => {
  const large = { responses: [{ fullTextAnnotation: { text: 'Pokémon', pages: [{ symbols: 'x'.repeat(300000) }] } }] };
  let dispatches = 0;
  const { effects } = harness(undefined, bytes, { ocr: async request => {
    dispatches++;
    assert.equal(request.responseFields, CARD_IDENTIFICATION_GOOGLE_TEXT_FIELDS_V2);
    // Offline Google transport simulation: query selection removes unused data.
    return request.responseFields === fixture.response_fields
      ? raw({ responses: [{ fullTextAnnotation: { text: 'Pokémon' } }] }) : raw(large);
  } });
  const result = await identifyCardV2(input(), effects);
  assert.equal(dispatches, 2);
  assert.equal(result.provenance.ocr.front, 'read'); assert.equal(result.provenance.ocr.back, 'read');
  const oversized = await identifyCardV2(input(), harness(undefined, bytes, { ocr: async () => raw(large) }).effects);
  assert.equal(oversized.provenance.ocr.front, 'unavailable');
  assert.equal(oversized.provenance.pokemon_detail, null);
  await assert.rejects(identifyCardV2(input(), harness(undefined, bytes, { model: async () => Buffer.alloc(262145) }).effects), error('malformed_response'));
});

test('V1 stays opt-in by default and neither result parser reinterprets another version', async () => {
  const old = await identifyCard(input(), harness(fixture.cases[1].ocr).effects);
  assert.equal(old.provenance.engine_version, 'card-identification-v1');
  assert.deepEqual(parseCardIdentificationResult(old, input()), old);
  const current = await identifyCardV2(input(), harness(fixture.cases[1].ocr).effects);
  assert.equal(current.provenance.engine_version, CARD_IDENTIFICATION_VERSION_V2);
  assert.notEqual(current.provenance.input_sha256, cardIdentificationInputHash(input()));
  assert.equal(current.provenance.input_sha256, hash(JSON.stringify({ engine_version: 'card-identification-v2', input_sha256: cardIdentificationInputHash(input()) })));
  assert.throws(() => parseCardIdentificationResultV2(old, input()), error('malformed_response'));
  assert.throws(() => parseCardIdentificationResult(current, input()), error('malformed_response'));
  const { effects, calls } = harness(fixture.cases[1].ocr);
  await identifyCard(input(), effects);
  assert.equal(calls.model[0].request.input[0].content.length, 4);
  assert.equal(calls.model[0].request.instructions, oldFixture.request.instructions);
  assert.deepEqual(calls.ocr[0].request, buildCardIdentificationOcrRequest(bytes.front));
});

test('Pokemon trigger uses decoded bounded OCR, including newlines and the back; negative hints retain sports', async () => {
  for (const text of ['copyright\nPokémon', 'copyright\tPOKEMON', 'Pokemon', 'Pokémon TCG']) {
    const { effects, calls } = harness({ front: { text: '' }, back: { text } });
    const result = await identifyCardV2(input(), effects);
    assert.ok(result.provenance.pokemon_detail, text);
    assert.equal(calls.model[0].request.input[0].content.length, 6);
  }
  for (const text of ['Pokemono', 'notPokemon', 'Basketball', '']) {
    const { effects, calls } = harness({ front: { text }, back: { text: '' } });
    const result = await identifyCardV2(input(), effects);
    assert.equal(result.provenance.pokemon_detail, null, text);
    assert.equal(calls.model[0].request.instructions, oldFixture.request.instructions);
  }
});

test('odd-height patterned front yields its exact lower PNG region and never substitutes the back', async () => {
  const pixels = Buffer.from(Array.from({ length: 15 * 17 * 3 }, (_, index) => index % 251));
  const front = await sharp(pixels, { raw: { width: 15, height: 17, channels: 3 } }).jpeg().toBuffer();
  const photos = { front, back: bytes.back };
  const { effects, calls } = harness(fixture.cases[1].ocr, photos);
  const result = await identifyCardV2(input(photos), effects);
  const expected = await sharp(front).extract({ left: 0, top: 8, width: 15, height: 9 }).png().toBuffer();
  assert.equal(result.provenance.pokemon_detail.sha256, hash(expected));
  assert.deepEqual(result.provenance.pokemon_detail.region, { left: 0, top: 8, width: 15, height: 9 });
  assert.equal(calls.model[0].request.input[0].content[5].image_url, `data:image/png;base64,${expected.toString('base64')}`);
  assert.deepEqual(photos.front, front);
});

test('input/parent/crop/result drift, PNG input, added photos and added knowledge fail closed', async () => {
  const result = await identifyCardV2(input(), harness(fixture.cases[1].ocr).effects);
  for (const change of [
    value => { value.provenance.pokemon_detail.parent_sha256 = input().photos.back.sha256; },
    value => { value.provenance.pokemon_detail.parent_side = 'back'; },
    value => { value.provenance.pokemon_detail.region.top++; },
    value => { value.provenance.pokemon_detail.region.height++; },
    value => { value.provenance.pokemon_detail.mime_type = 'image/jpeg'; },
    value => { value.provenance.pokemon_detail.byte_count = 3145729; },
    value => { value.provenance.pokemon_detail.sha256 = 'bad'; },
    value => { value.provenance.pokemon_detail.ref = 'extra-photo'; },
    value => { value.provenance.ocr.response_fields = 'responses'; },
    value => { delete value.provenance.ocr.request_sha256.back; },
    value => { value.provenance.input_sha256 = cardIdentificationInputHash(input()); },
    value => { value.provenance.subject.revision = 'retake-3'; },
    value => { value.provenance.photos.front.ref = 'new-front'; },
    value => { value.suggestions.name.value = 'https://untrusted.test'; },
  ]) {
    const modified = structuredClone(result); change(modified);
    assert.throws(() => parseCardIdentificationResultV2(modified, input()), error('malformed_response'));
  }
  const { effects, calls } = harness();
  for (const added of [{ photos: { ...input().photos, detail: input().photos.front } }, { pokemon_detail: {} }]) {
    await assert.rejects(identifyCardV2({ ...input(), ...added }, effects), error('invalid_input'));
  }
  await assert.rejects(identifyCardV2({ ...input(), knowledge: {} }, effects), error('unsupported_knowledge'));
  assert.equal(calls.reads.length + calls.ocr.length + calls.model.length, 0);
  const png = await sharp(bytes.front).png().toBuffer(), photos = { front: png, back: bytes.back };
  const invalid = harness(fixture.cases[1].ocr, photos);
  await assert.rejects(identifyCardV2(input(photos), invalid.effects), error('unverified_photo'));
  assert.equal(invalid.calls.ocr.length + invalid.calls.model.length, 0);
});

test('adapter-held photo mutation cannot change the verified original or crop', async () => {
  const supplied = { front: Buffer.from(bytes.front), back: Buffer.from(bytes.back) };
  const { effects, calls } = harness(fixture.cases[1].ocr, supplied, {
    async ocr(_request, context) {
      supplied.front.fill(0); supplied.back.fill(0);
      return raw({ responses: [{ fullTextAnnotation: { text: fixture.cases[1].ocr[context.side].text } }] });
    },
  });
  const result = await identifyCardV2(input(), effects);
  assert.equal(result.provenance.request_sha256, fixture.cases[1].request_sha256);
  assert.equal(calls.model[0].request.input[0].content[1].image_url, `data:image/jpeg;base64,${bytes.front.toString('base64')}`);
  assert.ok(Object.isFrozen(result.provenance.pokemon_detail.region));
});

test('empty/unavailable OCR retains photo-only behavior and nullable suggestions without catalog inference', async () => {
  const { effects, calls } = harness(undefined, bytes, { ocr: async (_request, context) => {
    if (context.side === 'front') throw new Error('private provider message');
    return raw({ responses: [{}] });
  } });
  const result = await identifyCardV2(input(), effects);
  assert.equal(result.provenance.pokemon_detail, null);
  assert.equal(result.provenance.ocr.front, 'unavailable'); assert.equal(result.provenance.ocr.back, 'empty');
  assert.equal(calls.model[0].request.instructions, oldFixture.request.instructions);
  assert.equal(result.suggestions.variant.value, null);
  assert.equal(result.suggestions.manufacturer.value, null);
  assert.equal(result.provenance.knowledge, null);
  assert.deepEqual(parseCardIdentificationResultStructureV2(result), result);
});

test('Pokemon suggestions preserve publisher, copyright, complete number and uncertain finish as reviewable fields', async () => {
  const suggestions = Object.fromEntries(Object.keys(fixture.parsed_suggestions).map(field => [field, { value: null, confidence: 'unknown', evidence: null }]));
  Object.assign(suggestions, {
    name: { value: 'Snivy', confidence: 'high', evidence: 'Front: Snivy' },
    category: { value: 'Pokémon', confidence: 'high', evidence: 'Back: Pokémon' },
    manufacturer: { value: 'Pokémon', confidence: 'medium', evidence: 'Front: Pokémon copyright line' },
    card_number: { value: 'RC1/RC25', confidence: 'high', evidence: 'Front: RC1/RC25' },
    year: { value: '2013', confidence: 'medium', evidence: 'Front: copyright 2013' },
  });
  // Stubbed output is parser/adoption-boundary evidence, not a real-card claim.
  const payload = structuredClone(fixture.provider_payload);
  payload.output[0].content[0].text = JSON.stringify(suggestions);
  const result = await identifyCardV2(input(), harness(fixture.cases[1].ocr, bytes, { model: async () => raw(payload) }).effects);
  assert.deepEqual(result.suggestions, suggestions);
  assert.equal(result.suggestions.variant.value, null);
  assert.equal(result.suggestions.set_name.value, null);
  assert.deepEqual(Object.keys(result), ['suggestions', 'warnings', 'provenance']);
});

test('cancelled or timed-out V2 work cannot dispatch a late model result or retry', async () => {
  const cancelled = new AbortController(); cancelled.abort();
  const untouched = harness();
  await assert.rejects(identifyCardV2(input(), untouched.effects, { signal: cancelled.signal }), error('cancelled'));
  assert.equal(untouched.calls.reads.length, 0);
  let resolve, signal, dispatches = 0;
  const late = harness(fixture.cases[1].ocr, bytes, { model: async (_request, context) => {
    dispatches++; signal = context.signal; return new Promise(done => { resolve = done; });
  } });
  await assert.rejects(identifyCardV2(input(), late.effects, { timeoutMs: 100 }), error('timeout'));
  assert.equal(dispatches, 1); assert.equal(signal.aborted, true);
  resolve(raw(fixture.provider_payload)); await new Promise(done => setImmediate(done));
  assert.equal(dispatches, 1);
});

test('V1 runtime, types, fixtures and source manifest remain byte-identical to the recorded Atlas base', async () => {
  const manifest = JSON.parse(await readFile(new URL('../handoff-manifest.json', import.meta.url)));
  for (const file of manifest.baseline_files.filter(file => !file.path.endsWith('/README.md') && !file.path.endsWith('/package.json'))) {
    const bytes = await readFile(new URL(`../../../${file.path}`, import.meta.url));
    assert.equal(hash(bytes), file.sha256, file.path);
  }
});
