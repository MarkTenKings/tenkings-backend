import test from 'node:test';
import assert from 'node:assert/strict';
import { unmatchedVariantReferences } from '../lib/variant-reference-photos.mjs';

const photo = index => ({ imageId: `photo-${index}`, sha256: `${index}`.repeat(64), relationship: 'listing_photo' });
function result() {
  const photos = [photo(1), photo(2), photo(3)];
  return { catalog: { snapshotHash: 'catalog', candidates: [{ candidateId: 'together' }], referencePhotos: photos },
    referenceLabels: { version: 'atlas-slab-label-associations/v1', catalogHash: 'catalog', readings: [
      { ...photos[0], candidateId: 'together', gradingCompany: 'PSA', labelText: 'Together', reason: 'Exact printing' },
      { ...photos[1], candidateId: null, gradingCompany: 'CGC', labelText: 'Pokémon (2024)\nCostco Exclusive', reason: 'Catalog year differs' },
      { ...photos[2], candidateId: null, gradingCompany: null, labelText: null, reason: 'Raw card without a slab' },
    ] } };
}
test('retains unmatched slab and raw photos, with exact saved text and no association or source mutation', () => {
  const saved = result(), before = JSON.stringify(saved), photos = unmatchedVariantReferences(saved);
  assert.deepEqual(photos.map(image => image.sha256), [photo(2).sha256, photo(3).sha256]);
  assert.deepEqual(photos[0].labelReading, { company: 'CGC', text: 'Pokémon (2024)\nCostco Exclusive', evidenceKind: 'SLABBED', reason: 'Catalog year differs' });
  assert.equal(photos[1].labelReading.text, null);
  assert(photos.every(image => image.associationStatus === 'UNASSIGNED'));
  assert.equal(JSON.stringify(saved), before);
});
test('stale or mismatched readings cannot hide photos or attach unrelated label text', () => {
  const stale = result(); stale.referenceLabels.catalogHash = 'old';
  assert.equal(unmatchedVariantReferences(stale).length, 3);
  assert(unmatchedVariantReferences(stale).every(image => image.labelReading.text === null));
  const mismatch = result(); mismatch.referenceLabels.readings[0].imageId = 'different-photo';
  assert.equal(unmatchedVariantReferences(mismatch).length, 3);
  assert.equal(unmatchedVariantReferences(mismatch)[0].labelReading.text, null);
  const absent = result(); absent.catalog.candidates = [];
  assert.equal(unmatchedVariantReferences(absent).length, 3);
});
test('empty and duplicate pools remain stable without inventing photos', () => {
  assert.deepEqual(unmatchedVariantReferences(null), []);
  const saved = result(); saved.catalog.referencePhotos.push(photo(2));
  assert.equal(unmatchedVariantReferences(saved).length, 2);
});
