import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { canonical, digest } from '@atlas/manual-service/contract';
import { descriptorSha256 } from '@atlas/photo-core';
import { createManualArtifactStore } from '@atlas/manual-service/artifacts';
import { createPhotoProcessor } from '@atlas/manual-intake/photo-processing';
import { createGeometryWorkspace, applyGeometryEdit, geometryBase } from '@atlas/manual-workspace/geometry-actions';
import { rgb16Png } from '../../atlas-photo-runtime/test/helpers.mjs';
import { memoryPhotoStorage, sha } from '../../atlas-manual-intake/test/helpers.mjs';
import { createWorkLimiter } from '../src/index.mjs';
import { adoptEarlyGeometry, createEarlyGeometry, geometryCacheInput } from '../src/early-geometry.mjs';

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
        && j.input.engineHash === engineHash && canonical(j.input.settings) === canonical({ matColor: currentSettings.matColor, cornerShape: currentSettings.cornerShape })))
        .map(u => ({ card_id: cardId, upload_id: u.uploadId, side: u.side, plan: JSON.stringify(u.plan), verification: JSON.stringify(u.verification),
          source: JSON.stringify(u.source), settings: currentSettings, created_at: new Date(0) }));
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
  const build = () => createEarlyGeometry({ store, storage, artifacts, limits, pythonExecutable: '/fixture/python', keyPrefix: 'intake',
    runtimeIdentity: async () => identity, limited, intervalMs: 5,
    intake: { async read() { return { card: { cardId, sides: Object.fromEntries(['FRONT','BACK'].map(side => [side, { upload: selected[side] ?? null }])) } }; },
      async readSource(_staff, _card, id) { return { photo: photos.get(id) }; } },
    details: { async read() { return { details: currentSettings }; } }, physical: input => physical(input),
    prepare: input => preparation(input) });
  return { cardId, staff, upload, build, jobs, intents, selected, photos, store, identity, limits,
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
