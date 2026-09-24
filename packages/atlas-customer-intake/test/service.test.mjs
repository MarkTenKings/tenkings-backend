import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { descriptorSha256, planDecode } from '@atlas/photo-core';
import { createCustomerIntakeService } from '../src/service.mjs';
import { digest } from '../src/contract.mjs';

function fixture() {
  const accountId = randomUUID(), cardId = randomUUID(), pairId = randomUUID(), draftId = randomUUID(), bytes = Buffer.from('fixture original');
  function upload(side) {
    const uploadId = randomUUID();
    const plan = { schemaVersion: 1, uploadId, binding: { cardId, pairId, side, version: 1 }, object: { key: `atlas-customer/originals/${accountId}/${cardId}/${uploadId}`, versionId: null }, expected: { sha256: digest(bytes), byteCount: bytes.length } };
    const verification = { object: { ...plan.object, versionId: 'retained-original' }, sha256: plan.expected.sha256, byteCount: bytes.length, contentType: 'application/octet-stream' };
    const original = { schemaVersion: 1, kind: 'original', uploadId, binding: plan.binding, object: verification.object, content: { mime: 'image/png', sha256: plan.expected.sha256, byteCount: bytes.length }, metadata: null };
    const decodePlan = planDecode(original, { encoded: { width: 4, height: 3 }, orientation: 1, orientationSource: 'identity', crop: null, selection: { kind: 'single-frame' }, bitDepth: 8, iccSha256: null, colorSpace: 'sRGB', dynamicRange: 'SDR' },
      { maxInputBytes: 1000, maxPixels: 100, maxRasterBytes: 800, maxOutputBytes: 1000, timeoutMs: 100 });
    const decodedFrame = { schemaVersion: 1, kind: 'decoded-frame', id: uploadId, originalDescriptorSha256: descriptorSha256(original), decodePlanSha256: descriptorSha256(decodePlan),
      raster: { object: { key: `${plan.object.key}/decoded.png`, versionId: 'decoded' }, content: { mime: 'image/png', sha256: 'b'.repeat(64), byteCount: 100 }, dimensions: { width: 4, height: 3 } }, sourceToFrame: decodePlan.geometry.matrix,
      treatment: { decoder: 'fixture', version: '1', policyVersion: 'fixture', channels: 3, bitDepth: 8, colorSpace: 'sRGB', colorTreatment: 'converted', hdrTreatment: 'not-present' } };
    const workingFrame = { ...decodedFrame, schemaVersion: 2, id: `${uploadId}-working`, raster: { ...decodedFrame.raster, object: { key: `${plan.object.key}/working.png`, versionId: 'working' } },
      treatment: { ...decodedFrame.treatment, policyVersion: 'atlas-sdr-working-srgb8-v1' }, workingImage: { policyVersion: 'atlas-sdr-working-srgb8-v1', sourceRaster: { content: decodedFrame.raster.content, dimensions: decodedFrame.raster.dimensions },
        sourceTreatment: decodedFrame.treatment, outputIccSha256: 'c56e1685d888f5edb92fe07f2750f387f8fe8e91b32ff8fb0b56bfbbb9458353', geometryTreatment: 'identity-no-resampling' } };
    return { accountId, draftId, cardId, pairId, side, plan, verification, prepared: { original, decodePlan, decodedFrame, workingFrame } };
  }
  const uploads = { FRONT: upload('FRONT'), BACK: upload('BACK') }, events = [], effects = new Map(); let modelCalls = 0, revoked = false;
  const job = { accountId, cardId, sourceHash: 'c'.repeat(64), attemptId: randomUUID(), leaseId: randomUUID(), uploads };
  const repository = {
    upload: async () => { if (revoked) throw Error('revoked'); return { upload: uploads.FRONT }; },
    verify: async (_authority, value) => { events.push(['verify', value]); return { draft: { id: draftId } }; },
    claim: async () => ({ job }), prepared: async value => { events.push(['prepared', value]); },
    dispatch: async value => { events.push(['dispatch', value]); const old = effects.get(value.stage); if (old) return { dispatch: false, response: old.response }; effects.set(value.stage, {}); return { dispatch: true }; },
    response: async value => { events.push(['response', value]); effects.set(value.stage, value); }, finish: async value => { events.push(['finish', value]); }, fail: async value => { events.push(['fail', value]); },
  };
  const storage = { readOriginal: async ({ uploadPlan }) => ({ bytes, ...Object.values(uploads).find(value => value.plan.uploadId === uploadPlan.uploadId).verification }),
    createOriginalUpload: async () => ({ url: 'https://private.example/upload', method: 'PUT', headers: {} }) };
  const processPhoto = async () => { throw Error('Already prepared fixture must be reused'); };
  const identify = async ({ effect }) => { const reply = await effect('MODEL', { input: 'bound fixture' }, async () => { modelCalls++; return Buffer.from('{"saved":true}'); }); return { identity: null, reply: reply.toString() }; };
  return { uploads, events, effects, repository, storage, processPhoto, identify, modelCalls: () => modelCalls, revoke: () => { revoked = true; }, service: () => createCustomerIntakeService({ repository, storage, processPhoto, identify }) };
}
test('verified upload completion returns the existing server receipt without reading a later object', async () => {
  const f = fixture(); f.storage.readOriginal = async () => { throw Error('Unexpected read'); };
  await f.service().complete({}, {}); assert.equal(f.events[0][0], 'verify'); assert.deepEqual(f.events[0][1].verification, f.uploads.FRONT.verification);
});
test('upload sign rechecks customer ownership after asynchronous storage signing', async () => {
  const f = fixture(); f.uploads.FRONT.verification = null; f.storage.createOriginalUpload = async () => { f.revoke(); return { url: 'https://private.example/upload' }; };
  await assert.rejects(f.service().sign({}, {}), /revoked/);
});
test('worker reserves a model effect before provider I/O, saves response before adoption, and reuses saved bytes on replay', async () => {
  const f = fixture(), service = f.service();
  assert.equal((await service.runOnce()).attention, undefined); assert.equal(f.modelCalls(), 1);
  assert.deepEqual(f.events.map(value => value[0]), ['prepared', 'prepared', 'dispatch', 'response', 'finish']);
  await service.runOnce(); assert.equal(f.modelCalls(), 1); assert.equal(f.events.at(-1)[0], 'finish');
});
test('unknown paid dispatch stops before another provider call and stays visible', async () => {
  const f = fixture(); f.effects.set('MODEL', {});
  const result = await f.service().runOnce(); assert.equal(result.attention, true); assert.equal(f.modelCalls(), 0); assert.equal(f.events.at(-1)[0], 'fail');
});
test('unbound prepared photo cannot reach identification even from a private decoder callback', async () => {
  const f = fixture(); f.uploads.FRONT.prepared.workingFrame.originalDescriptorSha256 = 'f'.repeat(64);
  assert.equal((await f.service().runOnce()).attention, true); assert.equal(f.modelCalls(), 0); assert.equal(f.events.filter(value => value[0] === 'dispatch').length, 0);
});
