import test from 'node:test';
import assert from 'node:assert/strict';
import { digest } from '@atlas/manual-service/contract';
import { parseAtlasRecognition, verifyAtlasRecognition } from '../src/identification-recognition.mjs';

const unknown = () => ({ value: null, confidence: 'unknown', evidence: null });
const known = value => ({ value, confidence: 'high', evidence: 'Visible card design.' });
const suggestions = () => ({ name: known('Michael Jordan'), manufacturer: known('Fleer'), card_number: known('273'), year: known('1992-93'),
  set_name: unknown(), variant: unknown(), category: known('Sports cards'), card_type: known('Basketball') });
const catalog = (status = 'matched', overrides = {}) => ({ status,
  catalog: { indexSha256: 'a'.repeat(64), sourceCount: 1854, rowCount: 7439127, coverage: 'partial' },
  queries: [], matches: status === 'matched' ? [{ identity: { category: 'SPORTS', name: 'Michael Jordan', manufacturer: 'Fleer', year: '1992-93', setName: 'Fleer', cardNumber: '273', language: null },
    printing: 'Slam Dunk', queryIndices: [0], source: { provider: 'manufacturer_checklist', recordId: `manufacturer-row:v1:${digest(JSON.stringify(['c'.repeat(64), ['Slam Dunk','273','Michael Jordan','row:273']]))}`, url: 'https://example.com/checklist',
      sha256: 'c'.repeat(64), locator: 'row:273', evidenceAuthority: 'secondary', sourcePublisher: 'Trading Card Database',
      release: { manufacturer: 'Fleer', sports: ['basketball'], year: '1992-93', setName: 'Fleer' }, shardSha256: 'd'.repeat(64) } }] : [],
  truncated: false, problems: [], ...overrides });

test('every valid model result invokes catalog lookup once, including empty identity and Pokémon', async () => {
  for (const original of [suggestions(), Object.fromEntries(Object.keys(suggestions()).map(key => [key, unknown()])), { ...suggestions(), category: known('Pokémon') }]) {
    const calls = [];
    const result = await verifyAtlasRecognition(original, { async lookup(...args) { calls.push(args); return catalog('no_match'); } });
    assert.equal(calls.length, 1); assert.deepEqual(result.suggestions, original); assert.deepEqual(result.recognition.modelSuggestions, original);
    assert.equal(calls[0][0].fields.setName, null); assert.equal(calls[0][1].maxMatches, 80);
    assert(calls[0][1].signal instanceof AbortSignal);
  }
});

test('a unique catalog identity fills only missing descriptive fields and preserves original model and source evidence', async () => {
  const original = suggestions(), before = structuredClone(original), evidence = catalog();
  const result = await verifyAtlasRecognition(original, { async lookup(input) { assert.equal(input.fields.sport, 'Basketball'); return evidence; } });
  assert.deepEqual(original, before); assert.deepEqual(result.recognition.modelSuggestions, before); assert.deepEqual(result.recognition.catalog, evidence);
  assert.deepEqual(result.recognition.adoptedFields, ['set_name']); assert.equal(result.suggestions.set_name.value, 'Fleer'); assert.equal(result.suggestions.set_name.confidence, 'medium');
  assert.deepEqual(result.suggestions.variant, unknown()); assert.deepEqual(result.suggestions.name, before.name);
  assert.deepEqual(parseAtlasRecognition(result.recognition, result.suggestions), result.recognition);
});

test('catalog cannot overwrite an existing model value or force a printing from a checklist label', async () => {
  const original = { ...suggestions(), set_name: known('Fleer Basketball'), variant: known('Uncertain printing') };
  const result = await verifyAtlasRecognition(original, { async lookup() { return catalog(); } });
  assert.deepEqual(result.suggestions, original); assert.deepEqual(result.recognition.adoptedFields, []);
});

test('misses, ambiguity, unavailability and truncated matches preserve the complete valid model answer', async () => {
  for (const evidence of [catalog('no_match'), catalog('ambiguous'), catalog('insufficient_evidence'), catalog('unavailable'), catalog('ambiguous', { truncated: true, matches:catalog().matches })]) {
    const original = suggestions(), result = await verifyAtlasRecognition(original, { async lookup() { return evidence; } });
    assert.deepEqual(result.suggestions, original); assert.deepEqual(result.recognition.adoptedFields, []); assert.deepEqual(result.recognition.catalog, evidence);
  }
});

test('thrown, malformed and oversized catalog responses cannot fail identification or discard model fields', async () => {
  const bad = [undefined, {}, { ...catalog(), status: 'invented' }, { ...catalog(), problems: ['x'.repeat(196609)] },
    { ...catalog(), matches: [null] }, catalog('matched', {truncated:true})];
  for (const evidence of bad) {
    const original = suggestions();
    const result = await verifyAtlasRecognition(original, { async lookup() { return evidence; } });
    assert.deepEqual(result.suggestions, original); assert.equal(result.recognition.catalog.status, 'unavailable'); assert.deepEqual(result.recognition.adoptedFields, []);
  }
  const result = await verifyAtlasRecognition(suggestions(), { async lookup() { throw Error('read failure'); } });
  assert.equal(result.recognition.catalog.status, 'unavailable');
});

test('catalog adoption requires a bound source receipt and one consistent core identity', async () => {
  const invalid=[];
  for(const change of [match=>{delete match.source;},match=>{match.source.sha256='invalid';},match=>{match.source.locator='row:999';},
    match=>{match.source.release.setName='Different release';},match=>{match.source.evidenceAuthority='invented';}]){
    const value=catalog();change(value.matches[0]);invalid.push(value);
  }
  const conflicting=catalog(),other=structuredClone(conflicting.matches[0]);other.identity.setName='Another set';other.source.release.setName='Another set';conflicting.matches.push(other);invalid.push(conflicting);
  for(const value of invalid){
    const original=suggestions(),result=await verifyAtlasRecognition(original,{async lookup(){return value;}});
    assert.deepEqual(result.suggestions,original);assert.equal(result.recognition.catalog.status,'unavailable');assert.deepEqual(result.recognition.adoptedFields,[]);
  }
});

test('catalog time limit aborts a hanging reader and ignores its late answer without mutating preserved output', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let resolve, lookupSignal;
  const original = suggestions(), pending = verifyAtlasRecognition(original, { lookup(_, { signal }) { lookupSignal = signal; return new Promise(done => { resolve = done; }); } });
  t.mock.timers.tick(6000);
  const result = await pending, before = structuredClone(result);
  assert.equal(lookupSignal.aborted, true); assert.equal(result.recognition.catalog.status, 'unavailable'); assert.deepEqual(result.suggestions, original);
  resolve(catalog()); await Promise.resolve(); await Promise.resolve(); assert.deepEqual(result, before);
  t.mock.timers.reset();
});

test('persisted recognition cannot rewrite a model field or invent an unrecorded catalog adoption', async () => {
  const result = await verifyAtlasRecognition(suggestions(), { async lookup() { return catalog(); } });
  const changed = structuredClone(result.suggestions); changed.name = known('Different Athlete');
  assert.throws(() => parseAtlasRecognition(result.recognition, changed), { code: 'IDENTIFICATION_CATALOG_INVALID' });
  const erased = structuredClone(result.recognition); erased.adoptedFields = [];
  assert.throws(() => parseAtlasRecognition(erased, result.suggestions), { code: 'IDENTIFICATION_CATALOG_INVALID' });
  const replaced = structuredClone(result.recognition); replaced.modelSuggestions.set_name = known('Existing model set');
  assert.throws(() => parseAtlasRecognition(replaced, result.suggestions), { code: 'IDENTIFICATION_CATALOG_INVALID' });
});
