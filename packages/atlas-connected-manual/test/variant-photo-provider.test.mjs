import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { variantCandidateId, createVariantReviewSnapshot } from '@tenkings/card-catalog-evidence';
import { createVariantPhotoProvider, projectVariantPhotoResponse, VARIANT_PHOTO_MODEL } from '../src/variant-photo-provider.mjs';
import { variantCandidate, variantIdentity } from './variant-fixture.mjs';
import { VARIANT_SOURCE_PHOTO_POLICY } from '../src/variant-source-photos.mjs';
const hash = x => createHash('sha256').update(x).digest('hex');
const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOv8AAAAASUVORK5CYII=', 'base64');
const photo = { bytes, sha256: hash(bytes), mimeType: 'image/png', originalSha256: hash('original photo'), frameSha256: hash('working frame') };
const input = { sourceHash: hash('source'), identityHash: hash('identity'), identityRevision: 2, identity: variantIdentity };
const photos = { sourceHash: input.sourceHash, policy: VARIANT_SOURCE_PHOTO_POLICY, FRONT: photo, BACK: photo };
function catalogFixture() {
  const raw = structuredClone(variantCandidate); delete raw.candidateId;
  raw.images[0] = { ...raw.images[0], sha256: photo.sha256, mimeType: photo.mimeType, width: 1, height: 1 };
  return createVariantReviewSnapshot({ identity: variantIdentity, candidates: [{ ...raw, candidateId: variantCandidateId(raw) }], capturedAt: '2026-10-09T00:00:00.000Z' });
}
const answer = candidateId => ({ candidateId, confidence: candidateId ? .84 : null, reason: 'Synthetic comparison fixture.',
  evidence: candidateId ? [{ side: 'FRONT', sha256: photo.sha256, observation: 'Synthetic feature for contract qualification only.' }] : [] });
const response = output => Response.json({ model: VARIANT_PHOTO_MODEL, status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(output) }] }] });

test('preparation binds exact source/reference evidence; one paid dispatch cannot replay', async () => {
  const catalog = catalogFixture(), id = catalog.candidates[0].candidateId; let calls = 0, referenceCalls = 0;
  const provider = createVariantPhotoProvider({ apiKey: 'synthetic-secret-not-a-key',
    readReferenceImage: async request => { referenceCalls++; assert.equal(request.snapshot.snapshotHash, catalog.snapshotHash); assert.equal(request.candidateId, id); return photo; },
    fetchImpl: async (url, options) => { calls++; assert.equal(url, 'https://api.openai.com/v1/responses'); assert.equal(options.redirect, 'error');
      const body = JSON.parse(options.body); assert.equal(body.store, false); assert.equal(body.text.format.strict, true);
      assert.equal(body.input[1].content.filter(c => c.type === 'input_image').length, 3); return response(answer(id)); } });
  const prepared = await provider.prepare({ input, photos, catalog });
  assert.equal(calls, 0); assert.equal(referenceCalls, 1); assert.equal(prepared.evidence.requestSha256, hash(prepared.body));
  assert.equal(prepared.evidence.photoDerivation.sides.FRONT.originalSha256, photo.originalSha256);
  assert.throws(() => { prepared.evidence.references[0].sha256 = hash('wrong'); }, TypeError);
  const saved = await provider({ prepared }); assert.deepEqual(projectVariantPhotoResponse(saved, catalog, input), answer(id));
  await assert.rejects(provider({ prepared }), { code: 'VARIANT_REQUEST_UNPREPARED' }); assert.equal(calls, 1);
});

test('reference mismatch and changed original stop before provider dispatch', async () => {
  let calls = 0;
  const provider = createVariantPhotoProvider({ apiKey: 'synthetic-secret-not-a-key', readReferenceImage: async () => ({ ...photo, sha256: hash('wrong') }), fetchImpl: async () => { calls++; } });
  await assert.rejects(provider.prepare({ input, photos, catalog: catalogFixture() }), { code: 'VARIANT_IMAGE_CHANGED' });
  await assert.rejects(provider.prepare({ input, photos: { ...photos, sourceHash: hash('new source') }, catalog: catalogFixture() }), { code: 'VARIANT_SOURCE_STALE' });
  await assert.rejects(provider.prepare({ input, photos: { ...photos, FRONT: { ...photo, bytes: Buffer.from('not an image') } }, catalog: catalogFixture() }), { code: 'VARIANT_IMAGE_INVALID' });
  assert.equal(calls, 0);
});

test('no diagnostic image means no paid request; transport failure never automatically replays', async () => {
  let calls = 0;
  const provider = createVariantPhotoProvider({ apiKey: 'synthetic-secret-not-a-key', readReferenceImage: async () => photo,
    fetchImpl: async () => { calls++; throw Error('synthetic network failure'); } });
  const empty = createVariantReviewSnapshot({ identity: variantIdentity, candidates: [], capturedAt: '2026-10-09T00:00:00.000Z' });
  await assert.rejects(provider.prepare({ input, photos, catalog: empty }), { code: 'VARIANT_DIAGNOSTIC_REFERENCE_REQUIRED' });
  assert.equal(calls, 0); const prepared = await provider.prepare({ input, photos, catalog: catalogFixture() });
  await assert.rejects(provider({ prepared }), /synthetic network failure/);
  await assert.rejects(provider({ prepared }), { code: 'VARIANT_REQUEST_UNPREPARED' }); assert.equal(calls, 1);
});

test('retained output rejects hallucinated choices, foreign image evidence, refusals, truncation and rebound catalog', async () => {
  const catalog = catalogFixture(), id = catalog.candidates[0].candidateId;
  const provider = createVariantPhotoProvider({ apiKey: 'synthetic-secret-not-a-key', readReferenceImage: async () => photo, fetchImpl: async () => response(answer(id)) });
  const saved = await provider({ prepared: await provider.prepare({ input, photos, catalog }) });
  for (const result of [{ ...answer(id), candidateId: 'made-up' }, { ...answer(id), confidence: 1.01 },
    { ...answer(id), evidence: [{ side: 'FRONT', sha256: hash('foreign'), observation: 'wrong image' }] }, { ...answer(null), confidence: .9 }]) {
    const bodyText = await response(result).text(); assert.throws(() => projectVariantPhotoResponse({ ...saved, bodyText }, catalog, input));
  }
  const incomplete = JSON.parse(saved.bodyText); incomplete.status = 'incomplete';
  assert.throws(() => projectVariantPhotoResponse({ ...saved, bodyText: JSON.stringify(incomplete) }, catalog, input), { code: 'VARIANT_RESPONSE_INCOMPLETE' });
  const refusal = JSON.parse(saved.bodyText); refusal.output[0].content = [{ type: 'refusal', refusal: 'fixture' }];
  assert.throws(() => projectVariantPhotoResponse({ ...saved, bodyText: JSON.stringify(refusal) }, catalog, input), { code: 'VARIANT_RESPONSE_INVALID' });
  assert.throws(() => projectVariantPhotoResponse({ ...saved, requestEvidence: { ...saved.requestEvidence, references: [] } }, catalog, input), { code: 'VARIANT_RESPONSE_BINDING_INVALID' });
  assert.throws(() => projectVariantPhotoResponse({ ...saved, requestEvidence: { ...saved.requestEvidence, photoDerivation: null } }, catalog, input), { code: 'VARIANT_RESPONSE_BINDING_INVALID' });
  for (const changed of [{ sourceHash: hash('another card') }, { identityHash: hash('another identity') }, { identityRevision: input.identityRevision + 1 }]) {
    assert.throws(() => projectVariantPhotoResponse(saved, catalog, { ...input, ...changed }), { code: 'VARIANT_RESPONSE_BINDING_INVALID' });
  }
  assert.throws(() => projectVariantPhotoResponse({ ...saved, bodyText: '{' }, catalog, input));
});
