import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createPublishedCatalogReader, variantSelectionParallel } from '@tenkings/card-catalog-evidence';
import { createVariantCatalogService } from '../src/variant-catalog.mjs';
import { prepareVariantCatalogObservation } from '../src/variant-catalog-proposal.mjs';
import { fixture, hostFixture } from '../../card-catalog-evidence/tests/fixtures.mjs';

const now = () => Date.parse('2026-10-09T08:00:00.000Z');
function clientFixture(category = 'SPORTS') {
  const manifest = fixture(category), bytes = Buffer.from('actual synthetic image byte fixture');
  manifest.images[0].sha256 = createHash('sha256').update(bytes).digest('hex');
  const host = hostFixture(manifest); let current = true; const calls = [];
  const reader = createPublishedCatalogReader({ loadAuthorizedPublication: async () => current ? host.loaded : null });
  const client = {
    findCurrentSetCatalogPublications: async request => { calls.push(['discover', request]); return [host.pin]; },
    lookupPublishedSetCatalogEvidence: async request => { calls.push(['lookup', request]); return reader.lookup(request); },
    currentFor: async () => current,
    readPublishedSetCatalogImage: async () => ({ bytes, sha256: manifest.images[0].sha256, mimeType: 'image/jpeg', width: 1600, height: 2200 }),
  };
  const identity = { category, name: manifest.cards[0].name, year: manifest.set.year, setName: manifest.set.label,
    cardNumber: manifest.cards[0].number, manufacturer: manifest.set.manufacturer ?? manifest.set.publisher, language: null };
  return { manifest, client, identity, calls, revoke: () => { current = false; } };
}

for (const category of ['SPORTS', 'POKEMON']) test(`${category}: final-review catalog scopes enumerate photos without assuming physical scope`, async () => {
  const f = clientFixture(category), service = createVariantCatalogService({ catalogClient: f.client, providers: [], now });
  const result = await service.prepare({ identity: f.identity, cardId: 'private-card', sourceHash: 'physical-source' });
  assert.equal(result.candidates.length, category === 'SPORTS' ? 2 : 4, 'source program/number collisions remain separate choices');
  const candidate = result.candidates.find(c => c.canonical.cardId === f.manifest.cards[0].cardId && c.canonical.printingId === f.manifest.printings[0].printingId);
  assert.equal(candidate.images[0].relationship, 'representative');
  assert.equal(candidate.applicability, 'supported'); assert.ok(result.problems.includes('LANGUAGE_UNCONFIRMED'));
  assert.ok(f.calls.some(([kind, v]) => kind === 'lookup' && v.query.edition === 'standard'));
  assert.ok(f.calls.every(([, value]) => !JSON.stringify(value).includes('private-card') && !JSON.stringify(value).includes('physical-source')));
  const image = candidate.images[0];
  const restarted = createVariantCatalogService({ catalogClient: f.client, providers: [], now });
  const media = await restarted.readImage({ snapshot: result, candidateId: candidate.candidateId, imageId: image.imageId });
  assert.equal(media.sha256, image.sha256);
  f.revoke(); await assert.rejects(restarted.readImage({ snapshot: result, candidateId: candidate.candidateId, imageId: image.imageId }), /SUPERSEDED/);
});

test('revoked catalog never survives a cache; partial provider outage is explicit and no invented base appears', async () => {
  const f = clientFixture(); f.revoke();
  const service = createVariantCatalogService({ catalogClient: f.client, providers: [{ prepare: async () => { throw new Error('secret provider detail'); } }], now });
  const result = await service.prepare({ identity: f.identity });
  assert.deepEqual(result.candidates, []); assert.ok(result.problems.includes('CATALOG_UNAVAILABLE'));
  assert.ok(result.problems.includes('PROVIDER_UNAVAILABLE')); assert.ok(!JSON.stringify(result).includes('secret'));
});

test('incomplete identity does no catalog or provider requests, and aborted work cannot persist a ready snapshot', async () => {
  let calls = 0;
  const service = createVariantCatalogService({ catalogClient: { findCurrentSetCatalogPublications: async () => { calls++; return []; } },
    providers: [{ prepare: async () => { calls++; return { candidates: [], problems: [], truncated: false }; } }], now });
  const identity = { category: 'SPORTS', name: 'A Player', year: '2024', setName: null, cardNumber: '3' };
  const result = await service.prepare({ identity }); assert.equal(calls, 0); assert.ok(result.problems.includes('IDENTITY_INCOMPLETE'));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(service.prepare({ identity }, { signal: controller.signal })); assert.equal(calls, 0);
});

test('a hung catalog is bounded and a byte substitution never becomes a reference response', async () => {
  const f = clientFixture();
  const timeout = createVariantCatalogService({ providers: [{ prepare: async () => new Promise(() => {}) }], timeoutMs: 5, now });
  await assert.rejects(timeout.prepare({ identity: f.identity }), /TIMEOUT/);
  const service = createVariantCatalogService({ catalogClient: f.client, providers: [], now });
  const snapshot = await service.prepare({ identity: f.identity }), candidate = snapshot.candidates.find(c => c.images.length), image = candidate.images[0];
  f.client.readPublishedSetCatalogImage = async () => ({ bytes: Buffer.from('substitution'), sha256: image.sha256, mimeType: image.mimeType, width: image.width, height: image.height });
  await assert.rejects(service.readImage({ snapshot, candidateId: candidate.candidateId, imageId: image.imageId }), /CHANGED/);
});

test('confirmed choices create idempotent unreviewed metadata proposals; replay never exports photographs or publishes', async () => {
  const f = clientFixture('POKEMON'), service = createVariantCatalogService({ catalogClient: f.client, providers: [], now });
  const snapshot = await service.prepare({ identity: f.identity }), candidate = snapshot.candidates.find(c => c.images.length);
  const payload = { decision: 'SELECTED', cardId: '11111111-1111-4111-8111-111111111111', actionId: '22222222-2222-4222-8222-222222222222',
    sourceHash: 'a'.repeat(64), identityRevision: 2, identityHash: 'b'.repeat(64), identity: candidate.identity,
    parallel: variantSelectionParallel(candidate), observedFeatures: null, catalog: snapshot, candidateId: candidate.candidateId, observedAt: new Date(now()).toISOString() };
  const first = prepareVariantCatalogObservation(payload), retry = prepareVariantCatalogObservation(structuredClone(payload));
  assert.deepEqual(retry, first); assert.deepEqual(first.proposal.images, []);
  assert.ok(first.proposal.sources.every(s => ['PHYSICAL_OBSERVATION', 'DERIVED'].includes(s.kind)));
  assert.equal(first.proposal.identity.cardId, candidate.canonical.cardId); assert.equal(first.proposal.identity.printingId, candidate.canonical.printingId);
  assert.ok(!JSON.stringify(first).includes('actual synthetic image byte fixture'));
  let submitted; f.client.submit = async proposal => { submitted = proposal; return { status: 'accepted', proposalSha256: first.proposalSha256 }; };
  await service.submitObservation(payload); assert.deepEqual(submitted, first.proposal);
  assert.throws(() => prepareVariantCatalogObservation({ ...payload, parallel: 'Base' }), /INVALID/);
  assert.throws(() => prepareVariantCatalogObservation({ ...payload, decision: 'UNRESOLVED' }), /INVALID/);
  const manual = prepareVariantCatalogObservation({ ...payload, decision: 'MANUAL', candidateId: null, catalog: null, parallel: 'English Cosmos Holo', observedFeatures: 'Visible galaxy pattern in the picture window.' });
  assert.equal(manual.proposal.identity.cardId, null); assert.equal(manual.proposal.basedOnPublication, null); assert.deepEqual(manual.proposal.images, []);
  assert.throws(() => prepareVariantCatalogObservation({ ...payload, decision: 'MANUAL', candidateId: null, observedFeatures: '' }), /INVALID/);
});
