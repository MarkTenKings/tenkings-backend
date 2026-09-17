import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { NextApiRequest, NextApiResponse } from 'next';
import { prepareObservationProposal } from '@tenkings/card-catalog-evidence';
import { authorizeCatalogService, createCardCatalogServiceHandler, type CatalogServiceOperation } from '../lib/server/cardCatalogService';
import { HttpError } from '../lib/server/adminSessionAuthority';
// @ts-expect-error Shared package intentionally keeps synthetic test fixtures outside its public contract.
import { observationFixture } from '../../../packages/card-catalog-evidence/tests/fixtures.mjs';

const token = 'synthetic_atlas_service_token_for_offline_tests_only_12345';
const env = { SET_CATALOG_EVIDENCE_ENABLED: 'true', CATALOG_ATLAS_SERVICE_ENABLED: 'true',
  CATALOG_ATLAS_SERVICE_TOKEN_SHA256: createHash('sha256').update(token).digest('hex'), CATALOG_ATLAS_SERVICE_SCOPES: 'discover,lookup,media,proposals' };
const publication = { publicationId: 'fixture:publication', setId: 'fixture:set', revision: 1, manifestSha256: 'a'.repeat(64) };
const request = (body: unknown, headers: Record<string, string | undefined> = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, method = 'POST') => ({ method, body, headers } as NextApiRequest);
function response() {
  const result = { code: 0, body: undefined as any, headers: {} as Record<string, string | number> };
  const res = { setHeader(key: string, value: string | number) { result.headers[key] = value; }, status(code: number) { result.code = code; return this; },
    json(body: unknown) { result.body = body; return this; }, send(body: unknown) { result.body = body; return this; } } as unknown as NextApiResponse;
  return { result, res };
}
type Service = NonNullable<Parameters<typeof createCardCatalogServiceHandler>[1]>['service'];
function service(overrides: Partial<NonNullable<Service>> = {}): NonNullable<Service> {
  return { findCurrentSetCatalogPublications: async () => assert.fail('Unexpected discovery'), lookupPublishedSetCatalogEvidence: async () => assert.fail('Unexpected lookup'),
    readPublishedSetCatalogImage: async () => assert.fail('Unexpected media'), submitSetCatalogObservationProposal: async () => assert.fail('Unexpected write'), ...overrides };
}
async function invoke(operation: CatalogServiceOperation, body: unknown, overrides: Partial<NonNullable<Service>> = {}, settings = env, req = request(body)) {
  const out = response(); await createCardCatalogServiceHandler(operation, { env: settings, service: service(overrides) })(req, out.res); return out.result;
}

test('service defaults off and requires a separately scoped Atlas token, never staff cookies or an operator key', async () => {
  for (const settings of [{}, { ...env, CATALOG_ATLAS_SERVICE_ENABLED: 'false' }, { ...env, SET_CATALOG_EVIDENCE_ENABLED: 'false' }, { ...env, CATALOG_ATLAS_SERVICE_TOKEN_SHA256: 'invalid' }]) {
    assert.throws(() => authorizeCatalogService(request({}), 'lookup', settings), (e: unknown) => e instanceof HttpError && e.statusCode === 503);
  }
  for (const headers of [{}, { cookie: 'staff-session=synthetic' }, { 'x-operator-key': token }, { authorization: 'Bearer staff-session' }, { authorization: `Bearer ${token} ` }]) {
    const out = await invoke('lookup', {}, {}, env, request({}, headers)); assert.equal(out.code, 401);
  }
  assert.equal((await invoke('lookup', {}, {}, { ...env, CATALOG_ATLAS_SERVICE_SCOPES: 'discover' })).code, 403);
});

test('discover passes exact query and Atlas consumer grant, without inventing scope', async () => {
  const q = { category: 'POKEMON' as const, setLabel: 'Legendary Treasures', year: '2013', cardNumber: '6/113' };
  const out = await invoke('discover', { query: q }, { findCurrentSetCatalogPublications: async input => { assert.deepEqual(input, { query: q, consumer: 'atlas' }); return [publication]; } });
  assert.equal(out.code, 200); assert.deepEqual(out.body.publications, [publication]);
  assert.match(String(out.headers['Cache-Control']), /no-store/);
  for (const body of [{ query: { category: 'POKEMON' } }, { query: { ...q, limit: 25 } }, { query: q, consumer: 'inventory' }, { query: { ...q, guessedScope: true } }]) assert.equal((await invoke('discover', body)).code, 400);
});

test('pinned lookup never silently switches to a newer publication and redacts internal failures', async () => {
  const q = { category: 'SPORTS' as const, setId: publication.setId, cardNumber: 'TBK-2' };
  for (const status of [404, 409, 503]) {
    const out = await invoke('lookup', { publication, query: q }, { lookupPublishedSetCatalogEvidence: async input => { assert.deepEqual(input, { publication, query: q, consumer: 'atlas' }); throw new HttpError(status, 'private SQL storage credential detail'); } });
    assert.equal(out.code, status); assert.equal(JSON.stringify(out).includes('private SQL'), false);
  }
  assert.equal((await invoke('lookup', { publication: { ...publication, manifestSha256: 'wrong' }, query: q })).code, 400);
});

test('media returns only verified bytes plus integrity metadata, without a bucket or signed URL', async () => {
  const bytes = Buffer.from('synthetic image bytes'), hash = createHash('sha256').update(bytes).digest('hex');
  const out = await invoke('media', { publication, imageId: 'fixture:image' }, { readPublishedSetCatalogImage: async input => { assert.deepEqual(input, { publication, imageId: 'fixture:image', consumer: 'atlas' }); return { bytes, sha256: hash, mimeType: 'image/jpeg', width: 100, height: 200 }; } });
  assert.equal(out.code, 200); assert.deepEqual(out.body, bytes); assert.equal(out.headers['X-Catalog-Image-Sha256'], hash); assert.equal(out.headers['Content-Length'], bytes.length);
  assert.equal((await invoke('media', { publication, imageId: 'fixture:image', storageKey: 'private' })).code, 400);
});

test('proposal binds authenticated Atlas observation and full canonical hash, with no fabricated human reviewer', async () => {
  const p = observationFixture('atlas'), prepared = prepareObservationProposal(p);
  const observation = { physicalCardRef: p.physicalCardRef, observationId: p.observationId, inputRevision: p.inputRevision, evidenceSha256: prepared.proposalSha256 };
  for (const outcome of ['recorded', 'replay'] as const) {
    const out = await invoke('proposals', { proposal: p, observation }, { submitSetCatalogObservationProposal: async input => {
      assert.deepEqual(input.authority, { producer: 'atlas', actorKind: 'service', actorRef: 'atlas:card-catalog:v1', userId: null, binding: observation });
      assert.deepEqual(input.proposal, p); return { proposalId: 'fixture:proposal', proposalSha256: prepared.proposalSha256, idempotencyKey: prepared.idempotencyKey, outcome };
    } });
    assert.equal(out.code, outcome === 'recorded' ? 201 : 200); assert.equal(out.body.disposition, 'requires_authorized_review');
  }
  for (const changed of [{ ...observation, evidenceSha256: 'b'.repeat(64) }, { ...observation, physicalCardRef: 'different-card' }, { ...observation, inputRevision: 'different-revision' }]) assert.equal((await invoke('proposals', { proposal: p, observation: changed })).code, 403);
  assert.equal((await invoke('proposals', { proposal: p, observation, actorKind: 'human' })).code, 400);
  assert.equal((await invoke('proposals', { proposal: observationFixture('inventory'), observation })).code, 403);
});

test('service mutation is JSON POST only; failures never disclose credentials or private payloads', async () => {
  const out = await invoke('proposals', {}, {}, env, request({}, undefined, 'GET')); assert.equal(out.code, 405); assert.equal(out.headers.Allow, 'POST');
  assert.equal((await invoke('discover', {}, {}, env, request({}, { authorization: `Bearer ${token}`, 'content-type': 'text/plain' }))).code, 415);
  const failure = await invoke('discover', { query: { category: 'SPORTS', setId: 'fixture:set' } }, { findCurrentSetCatalogPublications: async () => { throw new Error(`private ${token}`); } });
  assert.equal(failure.code, 503); assert.equal(JSON.stringify(failure).includes(token), false);
});


test('service rejects oversized complete responses instead of truncating evidence', async () => {
  const q = { category: 'SPORTS' as const, setId: publication.setId };
  const jsonResult = await invoke('lookup', { publication, query: q }, { lookupPublishedSetCatalogEvidence: async () => ({ evidence: 'x'.repeat(1024 * 1024) }) as never });
  assert.equal(jsonResult.code, 503); assert.equal(jsonResult.body.error, 'unavailable');
  const imageResult = await invoke('media', { publication, imageId: 'fixture:image' }, { readPublishedSetCatalogImage: async () => ({ bytes: Buffer.alloc(4 * 1024 * 1024 + 1), sha256: 'a'.repeat(64), mimeType: 'image/jpeg', width: 100, height: 100 }) });
  assert.equal(imageResult.code, 503); assert.equal(imageResult.headers['Content-Length'], undefined);
});
