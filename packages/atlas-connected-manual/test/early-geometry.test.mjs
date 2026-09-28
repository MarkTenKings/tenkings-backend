import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { canonical, digest } from '@atlas/manual-service/contract';
import { descriptorSha256 } from '@atlas/photo-core';
import { PREPARATION_CORE_V1, PREPARATION_REVEALS_V1, PREPARATION_LOSSLESS_SETTINGS, INSPECTION_PREVIEW_POLICY } from '@atlas/preparation-runtime';
import { createManualArtifactStore } from '@atlas/manual-service/artifacts';
import { createPhotoProcessor } from '@atlas/manual-intake/photo-processing';
import { createGeometryWorkspace, applyGeometryEdit, geometryBase } from '@atlas/manual-workspace/geometry-actions';
import { rgb16Png } from '../../atlas-photo-runtime/test/helpers.mjs';
import { memoryPhotoStorage, sha } from '../../atlas-manual-intake/test/helpers.mjs';
import { createWorkLimiter } from '../src/index.mjs';
import { adoptEarlyGeometry, createEarlyGeometry, geometryCacheInput } from '../src/early-geometry.mjs';
import { MACHINE_GEOMETRY_POLICY, PRINTED_CANDIDATE_POLICY } from '../src/machine-geometry.mjs';
import { geometrySideSettings } from '../src/details.mjs';
import { selectRoleLearning, consumeGeometryLearning } from '../../atlas-defect-memory/src/role-learning.mjs';
import { roleFixture, seal } from '../../atlas-defect-memory/test/role-fixtures.mjs';

const settings = { matColor: 'BLACK', cornerShape: 'ROUNDED_3_18_MM', profile: null, fields: { name: '' } };
const identity = { identity: { opencv: 'fixture', numpy: 'fixture', physicalProposalPolicy: 'fixture', sources: {} }, native: { fixture: 'a'.repeat(64) } };
const limits = { maxInputBytes: 1000000, maxPixels: 1000000, maxOutputBytes: 1000000, timeoutMs: 1000 };
const quad = [{ x: .125, y: .1 }, { x: .875, y: .1 }, { x: .875, y: .9 }, { x: .125, y: .9 }];
const error = code => Object.assign(new Error(code), { code, status: 409 });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) { for (let i = 0; i < 200; i++) { if (await check()) return; await pause(5); } assert.fail('Expected bounded geometry progress'); }

async function fixture() {
  const cardId = randomUUID(), pairId = randomUUID(), selected = {}, photos = new Map(), jobs = new Map(), intents = new Set();
  const { storage } = memoryPhotoStorage(), objects = new Map();
  const artifacts = createManualArtifactStore({ transport: {
    async putIfAbsent(input) { if (!objects.has(input.key)) objects.set(input.key, input); },
    async read({ key }) { const v = objects.get(key); return { bytes: v.bytes, contentType: v.contentType, lineageSha256: v.lineageSha256 }; },
  } });
  let currentSettings = structuredClone(settings), active = 0, maximum = 0;
  const processor = createPhotoProcessor({ storage, keyPrefix: 'intake', decodeLimits: {
    maxInputBytes: 1000000, maxPixels: 1000000, maxRasterBytes: 8000000, maxOutputBytes: 1000000, timeoutMs: 10000 } });
  async function upload(side) {
    const bytes = rgb16Png(12, 16), uploadId = randomUUID(), version = (selected[side]?.version ?? 0) + 1;
    const plan = { schemaVersion: 1, uploadId, binding: { cardId, pairId, side, version },
      object: { key: `intake/originals/${uploadId}`, versionId: null }, expected: { sha256: sha(bytes), byteCount: bytes.length } };
    const found = await storage.writeOriginal({ uploadPlan: plan, bytes });
    const verification = { object: found.object, sha256: found.sha256, byteCount: found.byteCount, contentType: found.contentType };
    const photo = await processor({ uploadPlan: plan, verification, bytes }); photos.set(uploadId, photo);
    const sourceHash = descriptorSha256({ plan, verification });
    const ref = await artifacts.write(photo, { cardId, kind: 'PHOTO_SOURCE', sourceHash });
    selected[side] = { uploadId, side, version, plan, verification, source: { photoSourceHash: sourceHash, ref } };
    return selected[side];
  }
  const store = {
    async intent(_staff, _card, id) { intents.add(id); },
    async pending(engineHash) {
      return Object.values(selected).filter(u => intents.has(u.uploadId) && ![...jobs.values()].some(j => j.input.uploadId === u.uploadId
        && j.input.engineHash === engineHash && canonical(j.input.settings) === canonical(geometrySideSettings(currentSettings, u.side))))
        .map(u => ({ card_id: cardId, upload_id: u.uploadId, side: u.side, plan: JSON.stringify(u.plan), verification: JSON.stringify(u.verification),
          source: JSON.stringify(u.source), settings: geometrySideSettings(currentSettings, u.side), created_at: new Date(0) }));
    },
    async stage(input) { return store.ensure(null, input); },
    async ensure(_staff, input, { retry = false } = {}) {
      if (selected[input.side]?.uploadId !== input.uploadId) throw error('GEOMETRY_PHOTO_CHANGED');
      const key = digest(canonical(input)); let job = jobs.get(key);
      if (retry && job && !['FAILED','NEEDS_REVIEW'].includes(job.state)) throw error('GEOMETRY_RETRY_STALE');
      if (!job || retry) { job = { key, input, state: 'QUEUED', attempts: 0, result: null, error: null }; jobs.set(key, job); }
      return structuredClone(job);
    },
    async read(_staff, _card, key) { return structuredClone(jobs.get(key) ?? null); },
    async claim(engineHash, claimId) {
      if (active >= 2) return null;
      const job = [...jobs.values()].find(j => j.state === 'QUEUED' && j.input.engineHash === engineHash && selected[j.input.side]?.uploadId === j.input.uploadId);
      if (!job) return null;
      job.state = 'RUNNING'; job.claimId = claimId; job.attempts++; active++; maximum = Math.max(maximum, active); return structuredClone(job);
    },
    async finish(job, state, result, failure) {
      const current = jobs.get(job.key); active--;
      if (current.claimId !== job.claimId || selected[job.input.side]?.uploadId !== job.input.uploadId) return false;
      Object.assign(current, { state, result, error: failure, claimId: null }); return true;
    },
  };
  let calls = 0, preparation = async () => { throw new Error('Unexpected preparation of rejected outline'); };
  let physical = async input => ({ id: `proposal-${++calls}`, identity: identity.identity,
    frameDescriptorSha256: descriptorSha256(input.source.frame), proposal: { outcome: 'REJECTED', proposal: null } });
  const limited = createWorkLimiter(2), staff = {};
  const build = (options = {}) => createEarlyGeometry({ store, storage, artifacts, limits, pythonExecutable: '/fixture/python', keyPrefix: 'intake', ...options,
    runtimeIdentity: async () => identity, limited, intervalMs: 5,
    intake: { async read() { return { card: { cardId, sides: Object.fromEntries(['FRONT','BACK'].map(side => [side, { upload: selected[side] ?? null }])) } }; },
      async readSource(_staff, _card, id) { return { photo: photos.get(id) }; } },
    details: { async read() { return { details: currentSettings }; } }, physical: input => physical(input),
    prepare: input => preparation(input) });
  return { cardId, staff, upload, build, jobs, intents, selected, photos, store, identity, limits, artifacts,
    breakArtifact(uploadId) { objects.delete(photos.get(uploadId) && Object.values(selected).find(u => u.uploadId === uploadId).source.ref.key); },
    setSettings(value) { currentSettings = { ...currentSettings, ...value }; },
    setPhysical(value) { physical = value; }, setPrepare(value) { preparation = value; }, get calls() { return calls; }, get maximum() { return maximum; } };
}

test('a single Back photo is processed without profile, identity or Front, and duplicate starts reuse the durable result', async () => {
  const f = await fixture(), service = f.build();
  try {
    const back = await f.upload('BACK');
    await service.sourcePrepared(f.staff, f.cardId, back.uploadId);
    await until(() => [...f.jobs.values()].some(j => j.state === 'NEEDS_REVIEW'));
    const first = await service.ensure(f.staff, f.cardId), second = await service.ensure(f.staff, f.cardId);
    assert.equal(first.earlyGeometry.FRONT.state, 'WAITING_PHOTO');
    assert.equal(first.earlyGeometry.BACK.state, 'NEEDS_REVIEW');
    assert.equal(first.earlyGeometry.BACK.canRetry, true);
    assert.deepEqual(second, first); assert.equal(f.calls, 1);
  } finally { await service.stop(); }
});

test('persisted source intent recovers in a new worker without a browser ensure call', async () => {
  const f = await fixture(), upload = await f.upload('FRONT');
  f.intents.add(upload.uploadId); // same-transaction source intent survived a process exit
  const restarted = f.build();
  try { restarted.start(); await until(() => f.calls === 1); await until(() => [...f.jobs.values()][0]?.state === 'NEEDS_REVIEW'); }
  finally { await restarted.stop(); }
});

test('explicit retry repeats the exact reviewed input once; routine polling never retries a rejection', async () => {
  const f = await fixture(), service = f.build();
  try {
    await f.upload('FRONT'); await service.ensure(f.staff, f.cardId);
    await until(() => [...f.jobs.values()][0]?.state === 'NEEDS_REVIEW');
    const status = (await service.status(f.staff, f.cardId)).FRONT;
    for (let i = 0; i < 3; i++) await service.ensure(f.staff, f.cardId);
    assert.equal(f.calls, 1);
    await service.ensure(f.staff, f.cardId, { side: 'FRONT', expectedKey: status.key });
    await until(() => f.calls === 2); assert.equal(f.jobs.size, 1);
  } finally { await service.stop(); }
});

test('a native preparation refusal retains its valid physical proposal and exposes a recoverable per-side result', async () => {
  const f = await fixture(), service = f.build();
  f.setPhysical(async input => ({ id: 'physical-only', identity: identity.identity,
    frameDescriptorSha256: descriptorSha256(input.source.frame), proposal: { outcome: 'ACCEPTED', proposal: quad } }));
  f.setPrepare(async () => { throw Object.assign(new Error('bounded resource refusal'), { name: 'PreparationError', code: 'PREPARATION_LIMIT' }); });
  try {
    await f.upload('FRONT'); await service.ensure(f.staff, f.cardId);
    await until(() => [...f.jobs.values()][0]?.state === 'NEEDS_REVIEW');
    const result = (await service.status(f.staff, f.cardId)).FRONT;
    assert.deepEqual(result.physical, quad); assert.equal(result.prepared, false); assert.equal(result.printed, null);
    assert.equal(result.error, 'PREPARATION_LIMIT'); assert.equal(result.canRetry, true);
  } finally { await service.stop(); }
});

test('opt-in geometry consumer observes real native output and retains frame-bound advice without replacing coordinates', async () => {
  const f = await fixture(); let observed = 0;
  f.setPhysical(async input => ({ id: 'native-observed', identity: identity.identity,
    frameDescriptorSha256: descriptorSha256(input.source.frame), proposal: { outcome: 'ACCEPTED', proposal: quad } }));
  f.setPrepare(async () => { throw Object.assign(Error(), { name: 'PreparationError', code: 'PREPARATION_LIMIT' }); });
  const service = f.build({ geometryLearning: async ({ input, targetFrameSha256, candidates }) => {
    observed++; assert.deepEqual(candidates[0].physical, quad);
    const r = roleFixture('GEOMETRY'), { sha256: _sha, ...policy } = r.policy;
    r.bindings = { ...policy.bindings, modelPromptSha256: digest(canonical(input.engine)) };
    r.policy = seal({ ...policy, bindings: r.bindings }); r.candidates[0].example.confirmed.printed = null;
    const selection = selectRoleLearning(r);
    return consumeGeometryLearning({ selection, policy: r.policy, targetFrameSha256, candidates });
  } });
  try {
    await f.upload('FRONT'); await service.ensure(f.staff, f.cardId);
    await until(() => [...f.jobs.values()][0]?.state === 'NEEDS_REVIEW');
    const status = (await service.status(f.staff, f.cardId)).FRONT;
    assert.equal(observed, 1); assert.equal(status.learningAdvice.status, 'CANDIDATE');
    assert.equal(status.learningAdvice.requiresHumanConfirmation, true); assert.deepEqual(status.physical, quad);
    assert.equal(status.prepared, false); assert.equal(status.canRetry, true);
  } finally { await service.stop(); }
});

for (const proposalKind of ['accepted', 'provisional ambiguous', 'missing printed']) test(`automatic cache retains exact core pixels and ${proposalKind} geometry provenance`, async () => {
  const provisional = proposalKind === 'provisional ambiguous', missingPrinted = proposalKind === 'missing printed';
  const f = await fixture(), service = f.build();
  f.setPhysical(async input => ({ id: 'physical-core', identity: identity.identity,
    frameDescriptorSha256: descriptorSha256(input.source.frame), proposal: { outcome: 'ACCEPTED', proposal: quad } }));
  f.setPrepare(async input => {
    assert.equal(input.outputContract, PREPARATION_CORE_V1);
    const transform = [141, 0, -211.5, 0, 138.828125, -222.125, 0, 0, 1];
    // Native preparation itself has separate real-byte equivalence tests. This
    // transport fixture exercises contract selection and retained provenance.
    const output = (name, width, height) => { const bytes = Buffer.from(`fixture-${name}`);
      return { filename: `${name}.webp`, mime: 'image/webp', bytes, byteCount: bytes.length, sha256: sha(bytes), width, height,
        frameToDerivative: name === 'rectified' ? transform : [141, 0, -171.5, 0, 138.828125, -182.125, 0, 0, 1] }; };
    const outputs = { rectified: output('rectified', 1270, 1778), inspection: output('inspection', 1350, 1858) };
    const previewBytes = Buffer.from('fixture-jpeg-preview'), hasPreview = proposalKind === 'accepted';
    return { id: 'core-result', frameDescriptorSha256: descriptorSha256(input.source.frame), identity: identity.identity,
      outputContract: PREPARATION_CORE_V1, sourceQuad: input.quad, proposal: missingPrinted
        ? { mode: 'PRINTED_FRAME', outcome: 'NOT_APPLICABLE', authority: 'PROPOSER_ONLY', proposal: null, advisory: { code: 'NO_PRINTED_FRAME' } }
        : provisional
        ? { mode: 'PRINTED_FRAME', outcome: 'ABSTAIN', authority: 'PROPOSER_ONLY', proposal: null,
          ambiguity: { ambiguous: true }, advisory: { code: 'AMBIGUOUS_PRINTED_FRAME' },
          diagnosticCandidate: { policy: PRINTED_CANDIDATE_POLICY, authority: 'PROPOSER_ONLY', reason: 'AMBIGUOUS_SUPPORTED_TRANSITIONS', quad },
          sideEvidence: Object.fromEntries(['top', 'right', 'bottom', 'left'].map(side => [side,
            { medianContrastDeltaE: 24, supportFraction: .8, sampleCount: 200, candidateCount: 2 }])) }
        : { outcome: 'ACCEPTED', proposal: quad },
      encoderSettings: hasPreview ? PREPARATION_LOSSLESS_SETTINGS : { format: 'webp', quality: 92, sourceBitDepth: 8 }, outputs,
      ...(hasPreview ? { inspectionPreview: { filename: 'inspection-preview.jpg', policyVersion: INSPECTION_PREVIEW_POLICY,
        sourceSha256: outputs.inspection.sha256, bytes: previewBytes, sha256: sha(previewBytes), byteCount: previewBytes.length,
        mime: 'image/jpeg', width: 558, height: 768, frameToDerivative: outputs.inspection.frameToDerivative } } : {}),
      frame: { id: 'prepared-core', version: 1, sourceToRectified: transform,
        rectified: { sha256: outputs.rectified.sha256, width: 1270, height: 1778 },
        inspection: { sha256: outputs.inspection.sha256, width: 1350, height: 1858, cardBounds: { x: 40, y: 40, width: 1270, height: 1778 } } } };
  });
  try {
    const upload = await f.upload('FRONT'), photo = f.photos.get(upload.uploadId);
    await service.ensure(f.staff, f.cardId); await until(() => [...f.jobs.values()][0]?.state === 'READY');
    const { input, packet } = await service.consume(f.staff, f.cardId, 'FRONT', upload, photo, settings);
    assert.equal(input.engine.outputContract, PREPARATION_CORE_V1);
    assert.equal(input.engine.machineGeometryPolicy, MACHINE_GEOMETRY_POLICY);
    const oldPolicy = { ...input.engine }; delete oldPolicy.machineGeometryPolicy;
    assert.notEqual(digest(canonical(geometryCacheInput(upload, photo, settings, oldPolicy))), packet.key);
    const historicalEngine = { ...input.engine }; delete historicalEngine.outputContract;
    assert.notEqual(digest(canonical(geometryCacheInput(upload, photo, settings, historicalEngine))), packet.key);
    const manifest = await f.artifacts.read(packet.preparedImages.ref,
      { cardId: f.cardId, kind: 'PREPARED_IMAGES', sourceHash: packet.preparedImages.sourceHash });
    assert.deepEqual(Object.keys(manifest.images).sort(), ['inspection', 'rectified']);
    assert.equal(manifest.outputContract, PREPARATION_CORE_V1);
    assert.equal(manifest.deferredReveals.outputContract, PREPARATION_REVEALS_V1);
    assert.deepEqual(manifest.deferredReveals.workingFrame, photo.workingFrame);
    assert.deepEqual(manifest.deferredReveals.preparation.sourceQuad, quad);
    assert.deepEqual(manifest.deferredReveals.preparation, packet.preparation);
    assert.equal(manifest.deferredReveals.preparation.outputs, undefined);
    assert.equal(manifest.deferredReveals.preparation.inspectionPreview, undefined);
    if (proposalKind === 'accepted') {
      assert.equal(manifest.inspectionPreview.policyVersion, INSPECTION_PREVIEW_POLICY);
      assert.equal(manifest.inspectionPreview.sourceSha256, manifest.images.inspection.raster.content.sha256);
      assert.equal(manifest.inspectionPreview.descriptor.purpose, 'preview');
      assert.equal(manifest.inspectionPreview.descriptor.raster.content.mime, 'image/jpeg');
      assert.deepEqual(Object.keys(manifest.inspectionPreview).sort(), ['descriptor', 'policyVersion', 'sourceSha256']);
    } else assert.equal(manifest.inspectionPreview, undefined);
    const frame = photo.workingFrame;
    const geometry = createGeometryWorkspace({ cardId: f.cardId, profile: 'POKEMON', sides: {
      FRONT: { ...input.settings, image: { version: upload.version, originalSha256: photo.original.content.sha256,
        frameId: frame.id, frameSha256: frame.raster.content.sha256, ...frame.raster.dimensions, coordinateSpace: 'ORIENTED_DECODED' } },
      BACK: { ...input.settings, image: null },
    } });
    const before = structuredClone(packet), adopted = adoptEarlyGeometry(geometry, 'FRONT', packet, input);
    if (missingPrinted) {
      assert.equal(adopted.geometry.sides.FRONT.printed, null);
      assert.deepEqual(adopted.geometry.sides.FRONT.physical.quad, quad);
      assert.ok(adopted.geometry.sides.FRONT.prepared);
      assert.equal(packet.preparation.proposal.advisory.code, 'NO_PRINTED_FRAME');
    } else {
      assert.deepEqual(adopted.geometry.sides.FRONT.printed.quad, quad);
      assert.equal(adopted.geometry.sides.FRONT.printed.actor, 'ENGINE');
      assert.equal(adopted.geometry.sides.FRONT.printed.proposal.ambiguous, provisional);
    }
    assert.equal(adopted.geometry.sides.FRONT.confirmation, null);
    assert.deepEqual(packet, before);
    const status = (await service.status(f.staff, f.cardId)).FRONT;
    assert.equal(status.machineUsable, true); assert.equal(status.ambiguous, provisional);
    assert.equal(status.requiresHumanConfirmation, true);
    assert.deepEqual(status.unresolved, missingPrinted ? ['PRINTED_GEOMETRY_UNRESOLVED'] : []);
    if (provisional) assert.equal(packet.preparation.proposal.outcome, 'ABSTAIN');
  } finally { await service.stop(); }
});

test('an unversioned full worker result cannot be persisted as new core preparation', async () => {
  const f = await fixture(), service = f.build();
  f.setPhysical(async input => ({ id: 'physical-core', identity: identity.identity,
    frameDescriptorSha256: descriptorSha256(input.source.frame), proposal: { outcome: 'ACCEPTED', proposal: quad } }));
  f.setPrepare(async () => ({ outputs: Object.fromEntries(['rectified','inspection','normalized','microDefect','directional'].map(k => [k, {}])) }));
  try {
    await f.upload('FRONT'); await service.ensure(f.staff, f.cardId);
    await until(() => [...f.jobs.values()][0]?.state === 'FAILED');
    assert.equal([...f.jobs.values()][0].error, 'GEOMETRY_STORED_CONTENT_INVALID');
    assert.equal([...f.jobs.values()][0].result, null);
  } finally { await service.stop(); }
});

test('failed source discovery does not starve another side or already queued work', async () => {
  const f = await fixture(), first = await f.upload('FRONT'), second = await f.upload('BACK');
  f.intents.add(first.uploadId); f.intents.add(second.uploadId); f.breakArtifact(first.uploadId);
  const service = f.build();
  try {
    service.start(); await until(() => [...f.jobs.values()].some(j => j.input.side === 'BACK' && j.state === 'NEEDS_REVIEW'));
    assert.equal(f.calls, 1); assert.equal([...f.jobs.values()].filter(j => j.input.side === 'FRONT').length, 0);
  } finally { await service.stop(); }
});

test('Front and Back native work can overlap but never exceed two reserved slots', async () => {
  const f = await fixture(), service = f.build(); let release;
  const gate = new Promise(resolve => { release = resolve; }); let entered = 0;
  f.setPhysical(async input => { entered++; await gate; return { id: `p-${entered}`, identity: identity.identity,
    frameDescriptorSha256: descriptorSha256(input.source.frame), proposal: { outcome: 'REJECTED', proposal: null } }; });
  try {
    await f.upload('FRONT'); await f.upload('BACK'); await service.ensure(f.staff, f.cardId);
    await until(() => entered === 2); assert.equal(f.maximum, 2); release();
    await until(() => [...f.jobs.values()].every(j => j.state === 'NEEDS_REVIEW'));
  } finally { release(); await service.stop(); }
});

test('a Back that arrives during slow Front processing uses the free slot and finishes first', async () => {
  const f = await fixture(), service = f.build(); let release, frontEntered = false;
  const gate = new Promise(resolve => { release = resolve; });
  f.setPhysical(async input => {
    if (input.source.original.binding.side === 'FRONT') { frontEntered = true; await gate; }
    return { id: `p-${input.source.original.binding.side}`, identity: identity.identity,
      frameDescriptorSha256: descriptorSha256(input.source.frame), proposal: { outcome: 'REJECTED', proposal: null } };
  });
  try {
    const front = await f.upload('FRONT'); await service.sourcePrepared(f.staff, f.cardId, front.uploadId); await until(() => frontEntered);
    const back = await f.upload('BACK'); await service.sourcePrepared(f.staff, f.cardId, back.uploadId);
    await until(() => [...f.jobs.values()].some(j => j.input.side === 'BACK' && j.state === 'NEEDS_REVIEW'));
    assert.equal([...f.jobs.values()].find(j => j.input.side === 'FRONT').state, 'RUNNING'); assert.equal(f.maximum, 2);
  } finally { release(); await service.stop(); }
});

test('shutdown cannot be undone by a late upload-completion callback', async () => {
  const f = await fixture(), service = f.build(), upload = await f.upload('FRONT');
  await service.stop(); await service.sourcePrepared(f.staff, f.cardId, upload.uploadId);
  assert.equal(service.start(), false); await pause(15); assert.equal(f.calls, 0); assert(f.intents.has(upload.uploadId));
});

test('identity text/profile do not rerun unchanged pixels; changed mat has a new cache key', async () => {
  const f = await fixture(), service = f.build();
  try {
    await f.upload('FRONT'); const original = await service.ensure(f.staff, f.cardId);
    await until(() => f.calls === 1); f.setSettings({ profile: 'POKEMON', fields: { name: 'Updated after identification' } });
    assert.equal((await service.ensure(f.staff, f.cardId)).earlyGeometry.FRONT.key, original.earlyGeometry.FRONT.key);
    f.setSettings({ matColor: 'WHITE' }); const changed = await service.ensure(f.staff, f.cardId);
    assert.notEqual(changed.earlyGeometry.FRONT.key, original.earlyGeometry.FRONT.key); await until(() => f.calls === 2);
  } finally { await service.stop(); }
});

test('mixed mats select separate exact jobs; correcting Front reuses Back and refuses the old Front retry', async () => {
  const f = await fixture(), service = f.build();
  try {
    await f.upload('FRONT'); await f.upload('BACK'); f.setSettings({ frontMatColor: 'WHITE', backMatColor: 'BLACK' });
    const initial = await service.ensure(f.staff, f.cardId);
    await until(() => [...f.jobs.values()].filter(j => j.state === 'NEEDS_REVIEW').length === 2);
    assert.deepEqual([...f.jobs.values()].map(j => [j.input.side, j.input.settings.matColor]).sort(), [['BACK','BLACK'],['FRONT','WHITE']]);
    f.setSettings({ frontMatColor: 'MAGENTA' }); const changed = await service.ensure(f.staff, f.cardId);
    assert.notEqual(changed.earlyGeometry.FRONT.key, initial.earlyGeometry.FRONT.key);
    assert.equal(changed.earlyGeometry.BACK.key, initial.earlyGeometry.BACK.key);
    await assert.rejects(service.ensure(f.staff, f.cardId, { side: 'FRONT', expectedKey: initial.earlyGeometry.FRONT.key }), { code: 'GEOMETRY_RETRY_STALE' });
    await until(() => f.calls === 3); assert.equal(f.jobs.size, 3);
    const explicitWorkspace = { FRONT: { matColor: 'BLACK', cornerShape: 'SQUARE' }, BACK: { matColor: 'MAGENTA', cornerShape: 'SQUARE' } };
    const workspace = await service.ensure(f.staff, f.cardId, {}, explicitWorkspace);
    for (const side of ['FRONT','BACK']) assert.deepEqual(f.jobs.get(workspace.earlyGeometry[side].key).input.settings, explicitWorkspace[side]);
  } finally { await service.stop(); }
});

test('a late old-photo completion cannot become current; retry refuses a superseded key', async () => {
  const f = await fixture(), service = f.build(); let release, entered = false;
  const gate = new Promise(resolve => { release = resolve; });
  f.setPhysical(async input => { entered = true; await gate; return { id: 'late', identity: identity.identity,
    frameDescriptorSha256: descriptorSha256(input.source.frame), proposal: { outcome: 'REJECTED', proposal: null } }; });
  try {
    await f.upload('FRONT'); const old = await service.ensure(f.staff, f.cardId); await until(() => entered);
    await f.upload('FRONT'); release();
    await assert.rejects(service.ensure(f.staff, f.cardId, { side: 'FRONT', expectedKey: old.earlyGeometry.FRONT.key }), e => e.code === 'GEOMETRY_RETRY_STALE');
    const current = await service.ensure(f.staff, f.cardId); assert.notEqual(current.earlyGeometry.FRONT.key, old.earlyGeometry.FRONT.key);
    assert.equal(current.earlyGeometry.FRONT.physical, null);
  } finally { release(); await service.stop(); }
});

test('cache adoption uses the real profile and refuses later human geometry without touching Back', async () => {
  const f = await fixture(), upload = await f.upload('FRONT'), photo = f.photos.get(upload.uploadId);
  const engine = { policy: 'atlas-early-photo-geometry-v1', runtime: identity, limits };
  const input = geometryCacheInput(upload, photo, settings, engine), frame = photo.workingFrame;
  const packet = { policy: input.policy, key: digest(canonical(input)), binding: input, photoFrame: frame, preparation: null,
    physical: { id: 'early-test', identity: identity.identity, frameDescriptorSha256: descriptorSha256(frame), proposal: { outcome: 'ACCEPTED', proposal: quad } } };
  const geometry = createGeometryWorkspace({ cardId: f.cardId, profile: 'POKEMON', sides: {
    FRONT: { ...input.settings, image: { version: upload.version, originalSha256: photo.original.content.sha256, frameId: frame.id,
      frameSha256: frame.raster.content.sha256, ...frame.raster.dimensions, coordinateSpace: 'ORIENTED_DECODED' } },
    BACK: { ...input.settings, image: null },
  } });
  const adopted = adoptEarlyGeometry(geometry, 'FRONT', packet, input);
  assert.equal(adopted.geometry.profile, 'POKEMON'); assert.equal(adopted.geometry.sides.FRONT.physical.actor, 'ENGINE');
  assert.deepEqual(adopted.geometry.sides.BACK, geometry.sides.BACK); assert.equal(adopted.geometry.sides.FRONT.confirmation, null);
  const human = applyGeometryEdit(geometry, { side: 'FRONT', kind: 'PHYSICAL', base: geometryBase(geometry, 'FRONT', 'PHYSICAL'), quad, actor: 'HUMAN', proposal: null }).state;
  assert.throws(() => adoptEarlyGeometry(human, 'FRONT', packet, input), e => e.code === 'GEOMETRY_CACHE_STALE');
  const altered = structuredClone(packet); altered.physical.identity = { ...altered.physical.identity, opencv: 'other' };
  assert.throws(() => adoptEarlyGeometry(geometry, 'FRONT', altered, input), e => e.code === 'GEOMETRY_STORED_CONTENT_INVALID');
});

// Exercise the deployment-owned consumer and cache read together. SQL effects
// are represented by a bounded active-release fixture; production predicate
// semantics are separately exercised by the owned PostgreSQL qualification.
import { createNativeGeometryLearning, readNativeGeometryAdvice } from '../src/geometry-learning.mjs';
import { learningRetrievalBindingFacts } from '../../atlas-defect-memory/src/binding-facts.mjs';
import { geometryLearningConsumerFacts } from '../../atlas-defect-memory/src/role-learning.mjs';
import { ATLAS_FINAL_GRADE_POLICY } from '@atlas/grading-core/manual-report';

async function geometryAdviceFixture({ active = true } = {}) {
  const f = roleFixture('GEOMETRY'), now = Date.now();
  const reseal = (value, changes) => { const { sha256: _hash, ...body } = value; return seal({ ...body, ...changes }); };
  const engine = { policy: 'geometry-advice-fixture', runtime: identity, limits };
  const nativeEngineSha256 = digest(canonical(engine));
  const bindings = { modelPromptSha256: digest(canonical({ nativeEngineSha256, consumer: geometryLearningConsumerFacts(), retrieval: learningRetrievalBindingFacts() })),
    imagePolicySha256: digest(canonical(PREPARATION_LOSSLESS_SETTINGS)), scoringPolicySha256: digest(canonical(ATLAS_FINAL_GRADE_POLICY)) };
  const quality = reseal(f.quality, { reviewers: f.quality.reviewers.map(r => ({ ...r, measuredAt: new Date(now - 3600000).toISOString() })) });
  const policy = reseal(f.policy, { bindings, reviewerQualitySha256: quality.sha256,
    validFrom: new Date(now - 86400000).toISOString(), validUntil: new Date(now + 86400000).toISOString(),
    ownerApproval: { ...f.policy.ownerApproval, approvedAt: new Date(now - 86400000).toISOString() } });
  const scope = { policy, registry: f.registry, quality }, input = { cardId: f.target.cardId, side: 'FRONT', uploadId: randomUUID(),
    photoSource: { photoSourceHash: digest('current-photo-source'), ref: { key: 'synthetic-photo-source' } }, engine };
  const feedback = canonical({ source: f.candidates[0].source, examples: [f.candidates[0].example] });
  const publication = { card_id: f.candidates[0].source.cardId, action_id: f.candidates[0].source.actionId,
    revision: 1, feedback, feedback_hash: digest(feedback) };
  const state = { active, withdrawn: false, statusReads: 0, sourceReads: 0, lessonReads: 0, intakeChecks: 0, queries: [],
    manifest: { version: 'atlas-learning-release-v1', policy: 'legacy-defect-family-v1', publications: [{ revision: 1, sha256: digest('publication') }],
      learningMembership: { DEFECT: [], CLEAN: [], GEOMETRY: [1] }, learningScopes: { GEOMETRY: scope } },
    uploads: [{ id: input.uploadId, side: 'FRONT', original_hash: f.target.originalSha256[0], source: canonical(input.photoSource) },
      { id: randomUUID(), side: 'BACK', original_hash: f.target.originalSha256[1], source: canonical({ photoSourceHash: digest('back-photo-source') }) }],
    sides: {} };
  const tx = { async $queryRawUnsafe(sql, ...args) {
    state.queries.push(sql);
    if (sql.includes(' AS policy_hash')) return [{ policy_hash: state.active ? policy.sha256 : null }];
    if (sql.includes(' AS scope')) return [{ scope: state.active ? scope : null }];
    if (sql.includes('SELECT r.id,r.manifest,r.manifest_hash')) {
      const manifest = canonical(state.manifest);
      return [{ id: 'synthetic-geometry-release', manifest, manifest_hash: digest(manifest) }];
    }
    if (sql.includes('FROM atlas_manual_intake.card c JOIN atlas_manual_intake.upload')) {
      assert.equal(args[0], input.cardId); state.sourceReads++; return structuredClone(state.uploads);
    }
    if (sql.includes('FROM atlas_manual.learning_publication p JOIN atlas_manual.learning_release_member')) {
      assert.match(sql, /learning_withdrawal/); assert.match(sql, /discarded_card/); assert.match(sql, /result_revision>p.result_revision/);
      assert.equal(args[0], 'synthetic-geometry-release'); assert(args[1].includes(publication.card_id));
      assert.deepEqual(args[2], [1]); state.lessonReads++; return state.withdrawn ? [] : [structuredClone(publication)];
    }
    assert.fail(`Unexpected cached geometry query: ${sql}`);
  } };
  const boundary = { transaction: async (_staff, run) => run({ tx }), machineTransaction: async (_principal, run) => run({ tx }) };
  const earlyGeometry = { async status(_staff, cardId) { assert.equal(cardId, input.cardId); state.statusReads++; return structuredClone(state.sides); } };
  const observe = createNativeGeometryLearning({ boundary, intakeRepository: { async assertActiveInTransaction(actual, cardId) {
    assert.equal(actual, tx); assert.equal(cardId, input.cardId); state.intakeChecks++;
  } } });
  const request = { input, targetFrameSha256: digest('current-working-frame'), candidates: [{ id: 'native-candidate', authority: 'PROPOSER_ONLY',
    nativeSupported: true, engineSha256: nativeEngineSha256, frameSha256: digest('current-working-frame'), physical: f.physical, printed: f.printed }] };
  const before = structuredClone(request), saved = await observe(request);
  assert.deepEqual(request, before, 'learning must not mutate the native proposal');
  state.sides.FRONT = { learningAdvice: saved };
  return { state, saved, input, now, policy, observe, request,
    read: options => readNativeGeometryAdvice({ boundary, earlyGeometry, staff: {}, cardId: input.cardId, now, ...options }) };
}

test('cached geometry advice reuses only the exact qualified native proposal and remains advisory', async () => {
  const f = await geometryAdviceFixture();
  assert.equal(f.saved.status, 'CANDIDATE'); assert.equal(f.saved.requiresHumanConfirmation, true);
  assert.equal(f.saved.selectedCandidateId, 'native-candidate');
  assert.deepEqual(await f.read(), { FRONT: { status: 'CANDIDATE', frameSha256: f.request.targetFrameSha256,
    nativeGeometry: { physical: f.request.candidates[0].physical, printed: f.request.candidates[0].printed }, requiresHumanConfirmation: true } });
  assert.equal(f.state.lessonReads, 2); assert.equal(f.state.intakeChecks, 1);
  f.state.sides.FRONT.learningAdvice.status = 'ABSTAIN';
  assert.equal((await f.read()).FRONT.status, 'ABSTAIN');
});

test('cached geometry advice is withheld after policy expiry, withdrawal, release/source drift or changed native binding', async t => {
  for (const reason of ['expiry', 'withdrawal', 'release', 'source', 'native binding', 'missing side']) await t.test(reason, async () => {
    const f = await geometryAdviceFixture(); let options;
    if (reason === 'expiry') options = { now: Date.parse(f.policy.validUntil) };
    if (reason === 'withdrawal') f.state.withdrawn = true;
    if (reason === 'release') f.state.manifest = { ...f.state.manifest, revisionNote: 'new immutable release with same policy and lessons' };
    if (reason === 'source') f.state.uploads[0].original_hash = digest('replacement-front-original');
    if (reason === 'native binding') f.state.sides.FRONT.learningAdvice.nativeEngineSha256 = digest('different-engine');
    if (reason === 'missing side') f.state.uploads.pop();
    assert.deepEqual(await f.read(options), {});
  });
});

test('frozen baseline geometry advice is dormant without source, status or reference scans', async () => {
  const f = await geometryAdviceFixture({ active: false });
  assert.equal(f.saved, null); assert.equal(await f.read(), null);
  assert.equal(f.state.intakeChecks, 0); assert.equal(f.state.sourceReads, 0);
  assert.equal(f.state.statusReads, 0); assert.equal(f.state.lessonReads, 0); assert.equal(f.state.queries.length, 2);
});
