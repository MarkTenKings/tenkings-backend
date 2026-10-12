import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createVariantReviewSnapshot, importScrydexVariantCandidates, variantSelectionParallel } from '@tenkings/card-catalog-evidence';
import { codexCatalogContext, codexChoices, codexReadingKey, projectCodexReading } from '../src/variant-codex.mjs';
import { prepareVariantLabelRequest, projectVariantLabelResponse, createVariantPhotoProvider, VARIANT_LABEL_POLICY, VARIANT_PHOTO_MODEL } from '../src/variant-photo-provider.mjs';
import { prepareVariantCatalogObservation } from '../src/variant-catalog-proposal.mjs';
import { labelPhoto, labelHash, labelResponse } from './variant-label-fixture.mjs';

const saved = JSON.parse(readFileSync(new URL('../../card-catalog-evidence/tests/fixtures/scrydex-20261010-pikachu.json', import.meta.url)));
const identity = { category: 'POKEMON', name: 'Pikachu', year: '2023', setName: '151', cardNumber: '025/165', language: 'en' };
const card = JSON.parse(saved.body).data.find(value => value.id === 'sv3pt5-25');
const candidates = importScrydexVariantCandidates({ identity, card, source: { url: saved.url, sha256: saved.sha256 } });
const catalog = createVariantReviewSnapshot({ identity, candidates, referencePhotos: [labelPhoto().image], capturedAt: '2026-10-12T00:00:00.000Z' });

test('retained Scrydex origin and base-year meaning reach the label request without guessing Cosmos origin', async () => {
  const request = prepareVariantLabelRequest(catalog), snowflake = candidates.find(value => value.label === 'Snowflake Stamp');
  const context = request.catalogContext.find(value => value.source.recordId === snowflake.source.recordId);
  assert.equal(context.printingOrigin, 'Holiday Calendar 2025');
  assert.equal(context.identityYearMeaning, 'BASE_EXPANSION_RELEASE_YEAR');
  assert.equal(context.source.sha256, saved.sha256);
  assert.deepEqual(context.diagnostics, snowflake.diagnostics);
  assert.equal(request.catalogContext.find(value => value.source.recordId.endsWith(':cosmosHolofoil')).printingOrigin, null);
  const provider = createVariantPhotoProvider({ apiKey: 'synthetic-secret-not-real', readReferenceImage: async () => labelPhoto().media,
    fetchImpl: () => assert.fail('No paid dispatch') });
  const body = JSON.parse((await provider.prepare({ catalog })).body);
  assert.deepEqual(JSON.parse(body.input[1].content[0].text).catalogContext, request.catalogContext);
  assert.match(body.input[0].content, /base set release, not necessarily that variant printing/);
});

test('old paid label responses remain exact-readable and retain the same per-photo reading key', () => {
  const prior = prepareVariantLabelRequest(catalog, null, { includeCatalogContext: false });
  const current = prepareVariantLabelRequest(catalog);
  assert.notEqual(current.requestKey, prior.requestKey);
  assert.equal(codexReadingKey(current, current.photos[0].sha256), codexReadingKey(prior, prior.photos[0].sha256));
  const response = { version: VARIANT_LABEL_POLICY, requestEvidence: { policy: VARIANT_LABEL_POLICY, model: VARIANT_PHOTO_MODEL,
    requestSha256: labelHash('retained old request'), request: prior }, httpStatus: 200, bodyText: JSON.stringify(labelResponse(prior)) };
  const original = JSON.stringify(response);
  assert.equal(projectVariantLabelResponse(response, catalog).readings.length, 1);
  assert.equal(JSON.stringify(response), original);
});

test('newly supplied exact sourced origin can resolve the same printing key without rewriting OCR', () => {
  const reading = { sha256: catalog.referencePhotos[0].sha256, candidateKey: null, gradingCompany: 'PSA',
    labelText: 'HOLIDAY CALENDAR 2025\nPIKACHU\n025/165\nENGLISH\nSNOWFLAKE STAMP', reason: 'The original request listed only the 2023 base year.' };
  const priorChoices = codexChoices(catalog), before = JSON.stringify(reading);
  const projected = projectCodexReading(reading, catalog, priorChoices);
  assert.equal(projected.candidateId, candidates.find(value => value.label === 'Snowflake Stamp').candidateId);
  assert.equal(projected.labelText, reading.labelText); assert.equal(JSON.stringify(reading), before);
  assert.equal(projectCodexReading(reading, catalog, priorChoices, codexCatalogContext(catalog)).candidateId, null,
    'Do not override a refusal that already received the same origin evidence');
  for (const labelText of [reading.labelText.replace('2025', '2024'), `${reading.labelText}\n2024`,
    reading.labelText.replace('025/165', '025'), reading.labelText.replace('ENGLISH', ''),
    reading.labelText.replace('SNOWFLAKE STAMP', ''), reading.labelText.replace('CALENDAR', 'CAL')]) {
    assert.equal(projectCodexReading({ ...reading, labelText }, catalog, priorChoices).candidateId, null, labelText);
  }
  const actualCostco = { ...reading, labelText: 'CGC\nPikachu\nPokémon (2024)\nScarlet & Violet 151 - 025/165\nCostco Exclusive - 5-Pack Tin\nPRISTINE 10' };
  assert.equal(projectCodexReading(actualCostco, catalog, priorChoices).candidateId, null, 'No sourced Cosmos/Costco association is invented');
});

test('Scrydex query URLs remain in retained provenance and cannot break human observation contribution', () => {
  const candidate = candidates.find(value => value.label === 'Cosmos Holofoil');
  const payload = { decision: 'SELECTED', cardId: '11111111-1111-4111-8111-111111111111', actionId: '22222222-2222-4222-8222-222222222222',
    sourceHash: 'a'.repeat(64), identityRevision: 2, identityHash: 'b'.repeat(64), identity: candidate.identity,
    parallel: variantSelectionParallel(candidate), catalog, candidateId: candidate.candidateId, observedAt: '2026-10-12T00:00:00.000Z' };
  const before = JSON.stringify(payload), prepared = prepareVariantCatalogObservation(payload);
  assert.equal(prepared.proposal.sources.find(value => value.sourceId === 'comparison-observation').sourceUrl, null);
  assert.equal(prepared.proposal.sources.find(value => value.sourceId === 'comparison-observation').sourceRef, `atlas:variant-snapshot:${catalog.snapshotHash}`);
  assert.equal(prepared.proposal.images.length, 0);
  assert.equal(JSON.stringify(payload), before);
  assert.deepEqual(prepareVariantCatalogObservation(payload), prepared);
});
