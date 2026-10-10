import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { canonicalJson, prepareObservationProposal } from '@tenkings/card-catalog-evidence';
import { prepareReferenceProposal, createSetCatalogReferenceService } from '../lib/server/setCatalogReferenceProposals';
import { privateChecksumPutObjectCommand } from '../lib/server/storage';
import { referenceFixture as fixture, referenceActor as actor } from './catalogReferenceFixtures';
const digest = (v: unknown) => createHash('sha256').update(canonicalJson(v)).digest('hex');
test('photo sharing binds exact original lineage, full image roster and explicit pending permissions', async () => {
  const f = await fixture(), result = prepareReferenceProposal(f, actor);
  assert.equal(result.submission.disposition, 'requires_authorized_review'); assert.equal(result.artifacts.length, 2); assert.equal(result.sourceArtifacts.length, 1);
  assert.equal(result.submissionSha256, digest(result.submission));
  for (const mutate of [(v: any) => { delete v.images[0].permission; }, (v: any) => { v.observation.physicalCardRef = 'another'; },
    (v: any) => { v.images[0].bytesBase64 = Buffer.from('different').toString('base64'); }, (v: any) => { v.images.push(v.images[0]); },
    (v: any) => { v.images[0].permission.consumers.push('public'); }]) {
    const bad = structuredClone(f); mutate(bad); assert.throws(() => prepareReferenceProposal(bad, actor));
  }
  for (const mutate of [(v: any) => { v.proposal.sources[0].originKeys = ['physical:atlas:different-card']; },
    (v: any) => { v.proposal.sources[0].kind = 'OFFICIAL_CHECKLIST'; },
    (v: any) => { v.proposal.images[0].mediaRef = 'https://arbitrary.invalid/image'; }]) {
    const bad = structuredClone(f); mutate(bad); try { bad.observation.evidenceSha256 = prepareObservationProposal(bad.proposal).proposalSha256; } catch {}
    assert.throws(() => prepareReferenceProposal(bad, actor));
  }
});
test('verified replay performs no image decoding/upload and rejects a changed permission statement', async () => {
  const input = await fixture(), prepared = prepareReferenceProposal(input, actor);
  const service = createSetCatalogReferenceService({ db: { $queryRaw: async () => [{ proposalId: 'fixture:id', proposalSha256: prepared.prepared.proposalSha256, submissionSha256: prepared.submissionSha256, submissionJson: prepared.submission }] } as any,
    stage: async () => assert.fail('Replay re-uploaded'), verify: async () => assert.fail('Replay re-decoded') });
  const receipt = await service.submit(input, actor); assert.equal(receipt.outcome, 'replay'); assert.equal(receipt.submissionSha256, prepared.submissionSha256);
  const changed = structuredClone(input); changed.images[0].permission.detail = 'Changed assertion'; await assert.rejects(service.submit(changed, actor), /replay differs/);
});
test('capture descriptor retains exact canonical bytes, source revision and original photo ancestry', async () => {
  const input = await fixture();
  for (const change of [(v: any) => { v.actionId = '10000000-0000-4000-8000-000000000001'; },
    (v: any) => { v.sourceHash = 'f'.repeat(64); }, (v: any) => { v.photoDerivation.FRONT.originalSha256 = 'e'.repeat(64); },
    (v: any) => { v.photoDerivation.BACK.referenceSha256 = 'd'.repeat(64); }]) {
    const bad = structuredClone(input), capture = JSON.parse(Buffer.from(bad.sourceArtifacts[0].bytesBase64, 'base64').toString('utf8')); change(capture);
    const bytes = Buffer.from(canonicalJson(capture)), sha256 = createHash('sha256').update(bytes).digest('hex');
    Object.assign(bad.proposal.sources[0], { sha256, sourceRef: `catalog:sha256:${sha256}` }); bad.sourceArtifacts[0].bytesBase64 = bytes.toString('base64');
    bad.observation.evidenceSha256 = prepareObservationProposal(bad.proposal).proposalSha256;
    assert.throws(() => prepareReferenceProposal(bad, actor), /binding mismatch|derivation mismatch/);
  }
  const missing = structuredClone(input); missing.sourceArtifacts = []; assert.throws(() => prepareReferenceProposal(missing, actor));
});
test('corrupt pixels fail before any staging or database write; normal successful bytes are decoded', async () => {
  const input = await fixture(), corrupt = Buffer.from('not-a-real-image'), hash = createHash('sha256').update(corrupt).digest('hex');
  const image = input.proposal.images[0], source = input.proposal.sources.find((s: any) => s.sourceId === 'photo-front');
  Object.assign(image, { imageId: `atlas-reference:front:${hash}`, sha256: hash, mediaRef: `catalog:sha256:${hash}` });
  Object.assign(source, { sha256: hash, sourceRef: image.mediaRef });
  input.images[0].imageId = image.imageId; input.images[0].bytesBase64 = corrupt.toString('base64');
  const capture = JSON.parse(Buffer.from(input.sourceArtifacts[0].bytesBase64, 'base64').toString('utf8'));
  capture.photoDerivation.FRONT.referenceSha256 = hash;
  const captureBytes = Buffer.from(canonicalJson(capture)), captureHash = createHash('sha256').update(captureBytes).digest('hex');
  Object.assign(input.proposal.sources[0], { sha256: captureHash, sourceRef: `catalog:sha256:${captureHash}` });
  input.sourceArtifacts[0].bytesBase64 = captureBytes.toString('base64'); input.observation.evidenceSha256 = prepareObservationProposal(input.proposal).proposalSha256;
  const service = createSetCatalogReferenceService({ db: { $queryRaw: async () => [], $transaction: async () => assert.fail('Corrupt bytes reached persistence') } as any,
    stage: async () => assert.fail('Corrupt bytes reached private storage') });
  await assert.rejects(service.submit(input, actor), /fully decoded/);
});
test('new reference writes use private conditional checksum PUT; legacy callers retain exact behavior', () => {
  const value = { bucket: 'fixture-private', storageKey: 'set-catalog-evidence/x.bin', buffer: Buffer.from('x'), contentType: 'application/octet-stream', checksumSha256: 'a'.repeat(64) };
  const normal = privateChecksumPutObjectCommand(value), conditional = privateChecksumPutObjectCommand({ ...value, ifAbsent: true });
  assert.equal(normal.input.IfNoneMatch, undefined); assert.equal(conditional.input.IfNoneMatch, '*'); assert.equal(conditional.input.ACL, 'private');
  assert.equal(conditional.input.ChecksumSHA256, Buffer.from('a'.repeat(64), 'hex').toString('base64'));
});

test('conditional reference staging verifies newly stored bytes and reuses matching objects without PUT', async () => {
  const { stageReferenceProposalArtifact } = await import('../lib/server/setCatalogReferenceProposals');
  const prepared = prepareReferenceProposal(await fixture(), actor), artifact = prepared.artifacts[0]; let reads = 0, writes = 0;
  await stageReferenceProposalArtifact(artifact, { mode: 's3', read: async () => { if (++reads === 1) throw Object.assign(Error('missing'), { name: 'NoSuchKey' }); return artifact.bytes; },
    put: async (_key, _bytes, _type, options) => { writes++; assert.equal(options.ifAbsent, true); return { storageKey: 'fixture' }; } });
  assert.equal(reads, 2); assert.equal(writes, 1);
  await stageReferenceProposalArtifact(artifact, { mode: 's3', read: async () => artifact.bytes, put: async () => assert.fail('Reuploaded existing bytes') });
  reads = 0;
  await assert.rejects(stageReferenceProposalArtifact(artifact, { mode: 's3', read: async () => { if (++reads === 1) throw Object.assign(Error('missing'), { name: 'NoSuchKey' }); return Buffer.from('wrong bytes'); },
    put: async () => ({ storageKey: 'fixture' }) }), /Stored reference bytes differ/);
});
