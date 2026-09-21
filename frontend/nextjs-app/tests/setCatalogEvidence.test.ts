import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';
import type { NextApiRequest, NextApiResponse } from 'next';
import { createSetCatalogEvidenceService, catalogPublishSchema } from '../lib/server/setCatalogEvidence';
import { assertCatalogHuman, requireCatalogHuman } from '../lib/server/setCatalogEvidenceAuth';
import { catalogArtifactKey, prepareCatalogVerification, assertCatalogGrants, verifyCatalogImageBytes } from '../lib/server/setCatalogEvidenceMedia';
import { sendCatalogJson } from '../lib/server/setCatalogEvidenceApi';
import { validateManifest } from '@tenkings/card-catalog-evidence';

const digest = (b: Buffer) => createHash('sha256').update(b).digest('hex');
test('publication is disabled without touching the database; body review authority and static keys are rejected', async () => {
  const previous = process.env.SET_CATALOG_EVIDENCE_ENABLED; delete process.env.SET_CATALOG_EVIDENCE_ENABLED;
  try {
    const service = createSetCatalogEvidenceService({ db: new Proxy({} as never, { get() { throw Error('Database must not be touched'); } }) });
    assert.equal(await service.loadCurrentSetCatalogPublication({ setId: 'x' }), null);
    assert.deepEqual(await service.findCurrentSetCatalogPublications({ query: { category: 'SPORTS', setLabel: 'x', year: '2024' } }), []);
    assert.equal(await service.isSetCatalogPublicationCurrent({ publicationId: 'x', setId: 'x', revision: 1, manifestSha256: 'a'.repeat(64) }), false);
    assert.throws(() => assertCatalogHuman({ authority: 'operator-key' } as never, 'approver'), /human admin/);
    await assert.rejects(requireCatalogHuman({ headers: { 'x-operator-key': 'static-fixture' } } as unknown as NextApiRequest, 'approver'), /Static operator/);
    assert.equal(catalogPublishSchema.safeParse({ reviewedById: 'forged', approved: true }).success, false);
  } finally { if (previous === undefined) delete process.env.SET_CATALOG_EVIDENCE_ENABLED; else process.env.SET_CATALOG_EVIDENCE_ENABLED = previous; }
});
test('artifact namespace excludes URLs, private originals and paths; image checks bind real bytes, dimensions and type', async () => {
  for (const invalid of ['https://example.com/file', '../photo', 'research-evidence/test.jpg', 'inventory-photos/private.jpg', 'catalog:sha256:' + 'z'.repeat(64)]) assert.throws(() => catalogArtifactKey(invalid));
  const bytes = await sharp({ create: { width: 30, height: 40, channels: 3, background: 'white' } }).png().toBuffer();
  const image = { sha256: digest(bytes), width: 30, height: 40, mimeType: 'image/png' };
  await verifyCatalogImageBytes(bytes, image);
  await assert.rejects(verifyCatalogImageBytes(bytes, { ...image, width: 31 }), /dimensions/);
  await assert.rejects(verifyCatalogImageBytes(bytes, { ...image, sha256: '0'.repeat(64) }), /checksum/);
});
test('image evidence requires full pixel decoding even when a damaged file retains valid metadata', async () => {
  const bytes = await sharp({ create: { width: 30, height: 40, channels: 3, background: 'white' } }).png().toBuffer();
  const truncated = bytes.subarray(0, Math.floor(bytes.length / 2));
  const metadata = await sharp(truncated).metadata();
  assert.equal(metadata.width, 30); assert.equal(metadata.height, 40);
  await assert.rejects(verifyCatalogImageBytes(truncated, { sha256: digest(truncated), width: 30, height: 40, mimeType: 'image/png' }), /fully decoded/);
  await assert.rejects(verifyCatalogImageBytes(bytes, { sha256: digest(bytes), width: 30, height: 40, mimeType: 'image/png' }, Date.now() - 1), /timed out/);
});
test('full verification requires every source/image grant, exact staged bytes and compatible consumer scope', async () => {
  const { fixture } = await import(pathToFileURL(resolve(dirname(require.resolve('@tenkings/card-catalog-evidence')), '../tests/fixtures.mjs')).href);
  const manifest = fixture('POKEMON'), artifacts = new Map<string, Buffer>();
  for (const source of manifest.sources) { const bytes = Buffer.from(`synthetic bytes ${source.sourceId}`); source.sourceRef = `catalog:sha256:${digest(bytes)}`; artifacts.set(source.sourceRef, bytes); }
  const image = manifest.images[0], bytes = await sharp({ create: { width: image.width, height: image.height, channels: 3, background: 'white' } }).jpeg().toBuffer();
  image.sha256 = digest(bytes); image.mediaRef = `catalog:sha256:${image.sha256}`; artifacts.set(image.mediaRef, bytes);
  const grant = { basis: 'owned_original', detail: 'Synthetic fixture only.', consumers: ['inventory'] };
  const reviewEvidence = { sources: manifest.sources.map((s: { sourceId: string }) => ({ sourceId: s.sourceId, taxonomySourceId: null, classificationNote: 'Synthetic source only.', grant })), images: [{ imageId: image.imageId, grant }] };
  const frozen = validateManifest(manifest);
  const prepared = await prepareCatalogVerification(frozen, reviewEvidence, async ref => artifacts.get(ref)!);
  assertCatalogGrants(frozen, prepared.verification, 'inventory');
  assert.throws(() => assertCatalogGrants(frozen, prepared.verification, 'atlas'), /not granted/);
  await assert.rejects(prepareCatalogVerification(frozen, { ...reviewEvidence, images: [] }, async ref => artifacts.get(ref)!), /rosters/);
  await assert.rejects(prepareCatalogVerification(frozen, reviewEvidence, async () => Buffer.from('changed')), /match/);
});


test('catalog review fails above its response bound without dropping any evidence', () => {
  let sent = false;
  const res = { status() { sent = true; return this; }, json() { return this; } } as unknown as NextApiResponse;
  assert.throws(() => sendCatalogJson(res, { evidence: 'x'.repeat(4 * 1024 * 1024) }), /too large/);
  assert.equal(sent, false);
  sendCatalogJson(res, { evidence: 'complete small review' }); assert.equal(sent, true);
});
