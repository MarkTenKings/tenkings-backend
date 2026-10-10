import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { canonical, digest } from '@atlas/manual-service/contract';
import { createManualArtifactStore } from '@atlas/manual-service/artifacts';
import { canonicalJson, createVariantReviewSnapshot, prepareObservationProposal } from '@tenkings/card-catalog-evidence';
import { variantBinding } from '../src/variant-job-store.mjs';
import { createVariantReferenceContribution, VARIANT_REFERENCE_PHOTO_POLICY } from '../src/variant-reference-contribution.mjs';
import { VARIANT_SOURCE_PHOTO_POLICY } from '../src/variant-source-photos.mjs';
import { variantCandidate, variantIdentity } from './variant-fixture.mjs';

// Tiny synthetic images and a memory-only transport: no filesystem, database,
// provider, shared catalog, or real photographs are used by these tests.
const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const permission = { basis: 'owned_original', detail: 'I own these synthetic test photographs.', consumers: ['inventory', 'atlas'] };
function sealObservation(packet) {
  const prepared = prepareObservationProposal(packet.request.proposal);
  packet.request.observation = { physicalCardRef: prepared.proposal.physicalCardRef, observationId: prepared.proposal.observationId,
    inputRevision: prepared.proposal.inputRevision, evidenceSha256: prepared.proposalSha256 };
}
function captureOf(packet) { return JSON.parse(Buffer.from(packet.request.sourceArtifacts[0].bytesBase64, 'base64').toString('utf8')); }
function replaceCapture(packet, capture) {
  const bytes = Buffer.from(canonicalJson(capture)), root = packet.request.proposal.sources.find(s => s.sourceId === 'physical-review');
  packet.request.sourceArtifacts[0].bytesBase64 = bytes.toString('base64');
  root.sha256 = digest(bytes); root.sourceRef = `catalog:sha256:${root.sha256}`;
  sealObservation(packet);
}
async function fixture({ decision = 'MANUAL' } = {}) {
  const card = { cardId: id(1), draft: { source: { sourceHash: digest('synthetic pair') }, identityRevision: 2,
    identity: { cardName: 'Magikarp', year: '2020', productSet: 'Rebel Clash', cardNumber: '039/192', parallel: 'Reverse Holo' } } };
  const candidate = { ...variantCandidate, source: { ...variantCandidate.source, url: 'https://example.com/unreviewed-comparison' } };
  const catalog = createVariantReviewSnapshot({ identity: variantIdentity, candidates: [candidate], capturedAt: '2026-10-09T08:00:00.000Z' });
  const payload = { ...variantBinding(card), actionId: id(2), decision, identity: variantIdentity, parallel: 'Reverse Holo',
    observedFeatures: decision === 'MANUAL' ? 'Synthetic foil observation.' : null,
    candidateId: decision === 'SELECTED' ? candidate.candidateId : null, catalog: decision === 'SELECTED' ? catalog : null,
    observedAt: '2026-10-09T08:00:00.000Z', referencePermission: structuredClone(permission) };
  const job = { card_id: card.cardId, actor_id: id(3), access_version: 7, payload,
    payload_hash: digest(canonical(payload, { maxBytes: 2097152 })) };
  const events = [], objects = new Map(), requests = [], photos = { sourceHash: payload.sourceHash, policy: VARIANT_SOURCE_PHOTO_POLICY };
  for (const [side, color, width, height] of [['FRONT', '#224466', 12, 16], ['BACK', '#884422', 10, 14]]) {
    const bytes = await sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
    photos[side] = { bytes, sha256: digest(bytes), originalSha256: digest(`${side} original`), frameSha256: digest(`${side} frame`) };
  }
  const state = { card, savedPacket: null, readCount: 0, saveAllowed: true, beforeRead: null, afterPhotos: null, afterSave: null, submit: null };
  const artifacts = createManualArtifactStore({ transport: {
    async putIfAbsent(value) { events.push('artifact-put'); if (!objects.has(value.key)) objects.set(value.key, { ...value, bytes: Buffer.from(value.bytes) }); },
    async read({ key }) { events.push('artifact-read'); return objects.get(key); },
  } });
  const dependencies = {
    artifacts,
    boundary: { machineOwner(value) { events.push('authorize'); assert.deepEqual(value, { ownerId: job.actor_id, accessVersion: 7 }); return value; } },
    workflow: { service: { async read(staff, cardId) {
      events.push('current'); assert.equal(staff.ownerId, job.actor_id); assert.equal(cardId, card.cardId);
      state.readCount++; state.beforeRead?.(state.readCount); return structuredClone(state.card);
    } } },
    async loadPhotos(input) {
      events.push('photos'); assert.deepEqual(input.input, variantBinding(state.card)); state.afterPhotos?.(); return photos;
    },
    store: { async saveContributionPacket(input, pinned) {
      events.push('packet-save'); assert.equal(input.payload_hash, job.payload_hash);
      assert.ok(objects.has(pinned.ref.key), 'private bytes must exist before the job pins their reference');
      assert.equal(events.at(-2), 'artifact-read', 'the real artifact store must verify the completed private write');
      if (!state.saveAllowed) return false;
      state.savedPacket = structuredClone(pinned); state.afterSave?.(); return true;
    } },
    catalog: { async submitReference(request) {
      events.push('submit'); assert.ok(state.savedPacket, 'submission requires the saved immutable packet');
      requests.push(structuredClone(request)); return state.submit ? state.submit(request) : { status: 'accepted-for-review' };
    } },
  };
  return { job, state, photos, objects, requests, events, artifacts, dependencies,
    run: createVariantReferenceContribution(dependencies),
    packet: () => JSON.parse(objects.get(state.savedPacket.ref.key).bytes.toString('utf8')),
    source: { cardId: card.cardId, kind: 'VARIANT_REFERENCE', sourceHash: job.payload_hash } };
}

test('absent photo opt-in performs zero authorization, source, artifact, transform or submission IO', async () => {
  const forbidden = () => assert.fail('no photo opt-in must not perform IO');
  const run = createVariantReferenceContribution({ boundary: { machineOwner: forbidden }, workflow: { service: { read: forbidden } },
    store: { saveContributionPacket: forbidden }, artifacts: { read: forbidden, write: forbidden },
    loadPhotos: forbidden, transform: forbidden, catalog: { submitReference: forbidden } });
  assert.equal(await run({ payload: {} }), null);
  assert.equal(await run({ payload: { referencePermission: null } }), null);
});

for (const decision of ['MANUAL', 'SELECTED']) test(`${decision}: actual encoded pair retains private physical lineage and exact rights before submission`, async () => {
  const f = await fixture({ decision }), originals = Object.fromEntries(['FRONT', 'BACK'].map(side => [side, digest(f.photos[side].bytes)]));
  assert.deepEqual(await f.run(f.job), { status: 'accepted-for-review' });
  assert.equal(f.requests.length, 1); assert.equal(f.objects.size, 1);
  assert.deepEqual(f.events, ['authorize', 'current', 'photos', 'authorize', 'current', 'artifact-put', 'artifact-read', 'packet-save', 'authorize', 'current', 'submit']);
  const packet = f.packet(), request = f.requests[0], proposal = request.proposal;
  assert.deepEqual(packet.request, request); assert.deepEqual(packet.photoPolicy, VARIANT_REFERENCE_PHOTO_POLICY);
  assert.equal(packet.payloadHash, f.job.payload_hash); assert.equal(f.state.savedPacket.sourceHash, f.job.payload_hash);
  assert.equal(f.state.savedPacket.ref.kind, 'VARIANT_REFERENCE'); assert.equal(f.state.savedPacket.ref.cardId, f.job.card_id);
  assert.equal(f.state.savedPacket.ref.lineageSha256, digest(canonical(f.source)));
  assert.equal(request.observation.evidenceSha256, prepareObservationProposal(proposal).proposalSha256);
  assert.equal(proposal.producer, 'atlas'); assert.equal(proposal.physicalCardRef, f.job.card_id);
  assert.equal(proposal.observationId, `variant-reference:${f.job.payload.actionId}`);
  assert.equal(proposal.inputRevision, `identity:2:${f.job.payload.identityHash}:source:${f.job.payload.sourceHash}`);
  assert.match(proposal.note, /Pending catalog and image-permission review/);
  assert.equal(proposal.sources.length, 3); assert.equal(proposal.sources.filter(s => s.kind === 'PHYSICAL_OBSERVATION').length, 1);
  const root = proposal.sources.find(s => s.sourceId === 'physical-review');
  assert.equal(request.sourceArtifacts.length, 1); assert.equal(request.sourceArtifacts[0].sourceId, 'physical-review');
  const captureBytes = Buffer.from(request.sourceArtifacts[0].bytesBase64, 'base64'), capture = JSON.parse(captureBytes.toString('utf8'));
  assert.deepEqual(capture, { schemaVersion: 'atlas-variant-reference-capture/v1', physicalCardRef: f.job.card_id,
    actionId: f.job.payload.actionId, inputRevision: proposal.inputRevision, sourceHash: f.job.payload.sourceHash,
    identityHash: f.job.payload.identityHash, identityRevision: f.job.payload.identityRevision, observedAt: f.job.payload.observedAt,
    sourcePhotoPolicy: VARIANT_SOURCE_PHOTO_POLICY, referencePhotoPolicy: VARIANT_REFERENCE_PHOTO_POLICY,
    photoDerivation: packet.photoDerivation });
  assert.equal(captureBytes.toString('utf8'), canonicalJson(capture), 'the staged capture descriptor uses exact canonical bytes');
  assert.equal(root.sha256, digest(captureBytes)); assert.notEqual(root.sha256, f.job.payload.sourceHash);
  assert.equal(root.sourceRef, `catalog:sha256:${digest(captureBytes)}`); assert.deepEqual(root.parentSourceIds, []);
  assert.deepEqual(root.originKeys, [`physical:atlas:${f.job.card_id}`, ...['FRONT', 'BACK']
    .flatMap(side => [f.photos[side].originalSha256, f.photos[side].frameSha256].map(hash => `bytes:${hash}`)).sort()]);
  assert.ok(proposal.sources.every(source => source.sourceUrl === null));
  assert.ok(!JSON.stringify(request).includes('example.com'), 'comparison provider lineage must not be exported with physical photo roots');
  for (const side of ['FRONT', 'BACK']) {
    const descriptor = proposal.images.find(i => i.role === side.toLowerCase());
    const upload = request.images.find(i => i.imageId === descriptor.imageId), bytes = Buffer.from(upload.bytesBase64, 'base64');
    const metadata = await sharp(bytes).metadata();
    assert.deepEqual(upload.permission, permission); assert.equal(metadata.format, 'jpeg');
    assert.equal(descriptor.mimeType, 'image/jpeg'); assert.equal(descriptor.sha256, digest(bytes));
    assert.equal(descriptor.mediaRef, `catalog:sha256:${digest(bytes)}`);
    assert.deepEqual([descriptor.width, descriptor.height], side === 'FRONT' ? [12, 16] : [10, 14]);
    assert.deepEqual([metadata.width, metadata.height], [descriptor.width, descriptor.height]);
    const derived = proposal.sources.find(s => s.sourceId === descriptor.sourceIds[0]);
    assert.equal(derived.kind, 'DERIVED'); assert.deepEqual(derived.parentSourceIds, ['physical-review']);
    assert.equal(derived.sourceRef, `catalog:sha256:${digest(bytes)}`); assert.equal(derived.sha256, digest(bytes));
    assert.deepEqual(derived.originKeys, [`physical:atlas:${f.job.card_id}`]);
    assert.deepEqual(packet.photoDerivation[side], { originalSha256: f.photos[side].originalSha256,
      frameSha256: f.photos[side].frameSha256, comparisonSha256: originals[side], referenceSha256: digest(bytes), quality: 85 });
    assert.equal(digest(f.photos[side].bytes), originals[side], 'source buffers remain unchanged');
  }
});

test('lost POST response retries the exact saved packet after restart without source loads or re-encoding', async () => {
  const f = await fixture(); f.state.submit = () => { throw Error('Synthetic lost acknowledgement'); };
  await assert.rejects(f.run(f.job), /lost acknowledgement/); assert.ok(f.state.savedPacket); assert.equal(f.requests.length, 1);
  const retained = JSON.stringify(f.packet()), firstRequest = canonical(f.requests[0], { maxBytes: 8388608 });
  f.state.submit = null; f.events.length = 0;
  const restarted = createVariantReferenceContribution({ ...f.dependencies,
    loadPhotos: async () => assert.fail('saved packet must not reload original photographs'),
    transform: async () => assert.fail('saved packet must not re-encode across a restart') });
  await restarted({ ...f.job, referencePacket: structuredClone(f.state.savedPacket) });
  assert.deepEqual(f.events, ['authorize', 'current', 'artifact-read', 'authorize', 'current', 'submit']);
  assert.equal(f.requests.length, 2); assert.equal(canonical(f.requests[1], { maxBytes: 8388608 }), firstRequest);
  assert.equal(JSON.stringify(f.packet()), retained); assert.equal(f.objects.size, 1);
});

test('a lost packet lease refuses submission even after the private artifact write completed', async () => {
  const f = await fixture(); f.state.saveAllowed = false;
  await assert.rejects(f.run(f.job), { code: 'VARIANT_CONTRIBUTION_LEASE_LOST' });
  assert.equal(f.objects.size, 1); assert.equal(f.state.savedPacket, null); assert.equal(f.requests.length, 0);
});

const changes = {
  source(card) { card.draft.source.sourceHash = digest('replacement source'); },
  identityRevision(card) { card.draft.identityRevision++; },
  identityHash(card) { card.draft.identity.parallel = 'Different physical printing'; },
};
for (const [name, change] of Object.entries(changes)) test(`${name}: current-state checks stop stale contributions before loading, after encoding and after packet pinning`, async () => {
  for (const at of ['before', 'afterPhotos', 'afterSave']) {
    const f = await fixture();
    if (at === 'before') change(f.state.card); else f.state[at] = () => change(f.state.card);
    await assert.rejects(f.run(f.job), { code: 'VARIANT_REFERENCE_SOURCE_STALE' });
    assert.equal(f.requests.length, 0); assert.equal(f.objects.size, at === 'afterSave' ? 1 : 0);
    if (at === 'before') assert.ok(!f.events.includes('photos'));
  }
});

test('a pinned retry still rechecks the current source before and after its immutable artifact read', async () => {
  for (const at of ['before', 'afterRead']) {
    const f = await fixture(); await f.run(f.job); f.requests.length = 0; f.events.length = 0;
    if (at === 'before') changes.source(f.state.card);
    else f.state.beforeRead = count => { if (count === 5) changes.identityHash(f.state.card); };
    await assert.rejects(f.run({ ...f.job, referencePacket: f.state.savedPacket }), { code: 'VARIANT_REFERENCE_SOURCE_STALE' });
    assert.equal(f.requests.length, 0); assert.equal(f.events.includes('artifact-read'), at === 'afterRead');
  }
});

test('corrupt payload or mismatched photograph bytes fail before private persistence or submission', async () => {
  const payload = await fixture(); payload.job.payload.parallel = 'Changed without its immutable hash';
  await assert.rejects(payload.run(payload.job), { code: 'VARIANT_CONTRIBUTION_CORRUPT' }); assert.deepEqual(payload.events, []);
  const photo = await fixture(); photo.photos.BACK.bytes = Buffer.from(photo.photos.FRONT.bytes);
  await assert.rejects(photo.run(photo.job), { code: 'VARIANT_REFERENCE_SOURCE_INVALID' });
  assert.equal(photo.objects.size, 0); assert.equal(photo.requests.length, 0);
});

test('foreign source-pair bindings or photo policies refuse before encoding or persistence', async () => {
  for (const field of ['sourceHash', 'policy']) {
    const f = await fixture();
    f.photos[field] = field === 'sourceHash' ? digest('foreign pair') : { ...VARIANT_SOURCE_PHOTO_POLICY, quality: 80 };
    const run = createVariantReferenceContribution({ ...f.dependencies, transform: async () => assert.fail('invalid source policy must refuse before encoding') });
    await assert.rejects(run(f.job), { code: 'VARIANT_REFERENCE_SOURCE_INVALID' });
    assert.equal(f.objects.size, 0); assert.equal(f.requests.length, 0);
  }
});

test('private artifact byte tampering is refused by the actual artifact store without a submission', async () => {
  const f = await fixture(); await f.run(f.job); f.requests.length = 0;
  const stored = f.objects.get(f.state.savedPacket.ref.key); stored.bytes[0] ^= 1;
  await assert.rejects(f.run({ ...f.job, referencePacket: f.state.savedPacket }), { code: 'MANUAL_ARTIFACT_UNVERIFIED' });
  assert.equal(f.requests.length, 0);
});

test('a valid artifact checksum cannot make changed packet policy, binding, rights or encoded bytes acceptable', async () => {
  const f = await fixture(); await f.run(f.job); const original = f.packet(); f.requests.length = 0;
  const mutations = [
    packet => { packet.schemaVersion = 'different-packet'; },
    packet => { packet.payloadHash = digest('other payload'); },
    packet => { packet.photoPolicy.quality = 70; },
    packet => { packet.request.proposal.physicalCardRef = id(9); },
    packet => { packet.request.observation.evidenceSha256 = digest('other observation'); },
    packet => { packet.request.images[0].permission.basis = 'licensed'; },
    packet => { packet.request.images[0].bytesBase64 = Buffer.from('substituted bytes').toString('base64'); },
    packet => { packet.request.images[0].bytesBase64 += '\n'; },
  ];
  for (const mutate of mutations) {
    const packet = structuredClone(original); mutate(packet);
    const ref = await f.artifacts.write(packet, f.source);
    await assert.rejects(f.run({ ...f.job, referencePacket: { ref, sourceHash: f.job.payload_hash } }), { code: 'VARIANT_REFERENCE_PACKET_INVALID' });
    assert.equal(f.requests.length, 0);
  }
  await assert.rejects(f.run({ ...f.job, referencePacket: { ...f.state.savedPacket, sourceHash: digest('other payload') } }), { code: 'VARIANT_REFERENCE_PACKET_INVALID' });
});

test('a self-consistent observation hash still cannot substitute the payload identity or its physical lineage', async () => {
  const f = await fixture({ decision: 'SELECTED' }); await f.run(f.job); const original = f.packet(); f.requests.length = 0;
  const mutations = [
    packet => { packet.request.proposal.identity.name = 'A different physical card'; },
    packet => { packet.request.proposal.inputRevision = 'identity:999:other-source'; },
    packet => { packet.request.proposal.observedAt = '2026-10-08T08:00:00.000Z'; },
    packet => { packet.request.proposal.basedOnPublication = null; },
    packet => { packet.request.proposal.sources[0].sha256 = digest('other physical root'); },
    packet => { packet.request.proposal.sources[1].sourceUrl = 'https://example.com/foreign-source'; },
    packet => { packet.request.proposal.images[0].mimeType = 'image/png'; },
    packet => { packet.request.proposal.images[0].width = 1601; },
    packet => { packet.photoDerivation.FRONT.referenceSha256 = digest('other reference'); },
    packet => { packet.photoDerivation.BACK.quality = 99; },
  ];
  for (const mutate of mutations) {
    const packet = structuredClone(original); mutate(packet);
    sealObservation(packet);
    const ref = await f.artifacts.write(packet, f.source);
    await assert.rejects(f.run({ ...f.job, referencePacket: { ref, sourceHash: f.job.payload_hash } }), { code: 'VARIANT_REFERENCE_PACKET_INVALID' });
    assert.equal(f.requests.length, 0);
  }
});

test('the staged capture descriptor is mandatory, singular, canonical and byte-pinned', async () => {
  const f = await fixture(); await f.run(f.job); const original = f.packet(); f.requests.length = 0;
  const mutations = [
    packet => { packet.request.sourceArtifacts = []; },
    packet => { packet.request.sourceArtifacts.push(structuredClone(packet.request.sourceArtifacts[0])); },
    packet => { packet.request.sourceArtifacts.push({ sourceId: 'extra-source', bytesBase64: Buffer.from('extra').toString('base64') }); },
    packet => { packet.request.sourceArtifacts[0].sourceId = 'another-physical-root'; },
    packet => { packet.request.sourceArtifacts[0].bytesBase64 = Buffer.from('corrupt descriptor').toString('base64'); },
    packet => { packet.request.sourceArtifacts[0].bytesBase64 += '\n'; },
    packet => {
      const bytes = Buffer.from(JSON.stringify(captureOf(packet), null, 2));
      packet.request.sourceArtifacts[0].bytesBase64 = bytes.toString('base64');
      const root = packet.request.proposal.sources[0]; root.sha256 = digest(bytes); root.sourceRef = `catalog:sha256:${root.sha256}`;
      sealObservation(packet);
    },
  ];
  for (const mutate of mutations) {
    const packet = structuredClone(original); mutate(packet);
    const ref = await f.artifacts.write(packet, f.source);
    await assert.rejects(f.run({ ...f.job, referencePacket: { ref, sourceHash: f.job.payload_hash } }), { code: 'VARIANT_REFERENCE_PACKET_INVALID' });
  }
  const missing = structuredClone(original); delete missing.request.sourceArtifacts;
  const ref = await f.artifacts.write(missing, f.source);
  await assert.rejects(f.run({ ...f.job, referencePacket: { ref, sourceHash: f.job.payload_hash } }),
    error => ['VARIANT_REFERENCE_PACKET_INVALID', 'MANUAL_REQUEST_INVALID'].includes(error.code));
  assert.equal(f.requests.length, 0);
});

test('rehashed capture descriptors cannot change the human action, identity, original lineage or photo policy', async () => {
  const f = await fixture(); await f.run(f.job); const original = f.packet(); f.requests.length = 0;
  const mutations = [
    capture => { capture.schemaVersion = 'other-capture/v1'; },
    capture => { capture.physicalCardRef = id(9); },
    capture => { capture.actionId = id(9); },
    capture => { capture.inputRevision = 'other-input'; },
    capture => { capture.sourceHash = digest('other pair'); },
    capture => { capture.identityHash = digest('other identity'); },
    capture => { capture.identityRevision++; },
    capture => { capture.observedAt = '2026-10-08T08:00:00.000Z'; },
    capture => { capture.sourcePhotoPolicy.quality = 80; },
    capture => { capture.referencePhotoPolicy.quality = 70; },
    capture => { capture.photoDerivation.FRONT.originalSha256 = digest('other original'); },
    capture => { capture.photoDerivation.BACK.frameSha256 = digest('other frame'); },
    capture => { capture.photoDerivation.FRONT.referenceSha256 = digest('other image'); },
    capture => { capture.extra = 'not part of the saved capture'; },
  ];
  for (const mutate of mutations) {
    const packet = structuredClone(original), capture = captureOf(packet); mutate(capture); replaceCapture(packet, capture);
    const ref = await f.artifacts.write(packet, f.source);
    await assert.rejects(f.run({ ...f.job, referencePacket: { ref, sourceHash: f.job.payload_hash } }), { code: 'VARIANT_REFERENCE_PACKET_INVALID' });
  }
  assert.equal(f.requests.length, 0);
});

test('new image bytes, image hashes and capture derivation cannot contradict one another even with rehashed proposals', async () => {
  const f = await fixture(); await f.run(f.job); const original = f.packet(); f.requests.length = 0;
  const newBytes = await sharp({ create: { width: 12, height: 16, channels: 3, background: '#227744' } }).jpeg().toBuffer();
  const newHash = digest(newBytes);
  for (const contradiction of ['old-capture', 'old-descriptor', 'old-upload']) {
    const packet = structuredClone(original), image = packet.request.proposal.images.find(i => i.role === 'front');
    const upload = packet.request.images.find(i => i.imageId === image.imageId);
    if (contradiction !== 'old-descriptor') {
      image.sha256 = newHash; image.mediaRef = `catalog:sha256:${newHash}`; image.imageId = `atlas-reference:front:${newHash}`;
      upload.imageId = image.imageId;
      const source = packet.request.proposal.sources.find(s => s.sourceId === 'photo-front'); source.sha256 = newHash; source.sourceRef = `catalog:sha256:${newHash}`;
    }
    if (contradiction !== 'old-upload') upload.bytesBase64 = newBytes.toString('base64');
    if (contradiction !== 'old-capture') {
      packet.photoDerivation.FRONT.referenceSha256 = newHash;
      const capture = captureOf(packet); capture.photoDerivation = structuredClone(packet.photoDerivation); replaceCapture(packet, capture);
    }
    sealObservation(packet);
    const ref = await f.artifacts.write(packet, f.source);
    await assert.rejects(f.run({ ...f.job, referencePacket: { ref, sourceHash: f.job.payload_hash } }), { code: 'VARIANT_REFERENCE_PACKET_INVALID' });
  }
  assert.equal(f.requests.length, 0);
});
