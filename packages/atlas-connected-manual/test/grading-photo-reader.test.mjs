import test from 'node:test';
import assert from 'node:assert/strict';
import { createStoredGradingPhotoReader } from '../src/grading-photo-reader.mjs';
import { createConnectedManual } from '../src/index.mjs';
import { variantJobGrantSQL } from '../src/variant-job-store.mjs';
import { photo } from './photo-fixture.mjs';
import { savedGradingPhoto } from './grading-photo-fixture.mjs';

test('provider-disabled connected variant composition reads only a saved generated frame', async () => {
  const saved = await savedGradingPhoto(photo), calls = [];
  const boundary = { transaction() { throw Error('Unexpected browser transaction'); },
    machineTransaction: async (staff, work) => work({ principal: { mode: 'LOCAL_FIXTURE' }, tx: {
      async $queryRawUnsafe(sql, ...args) { calls.push({ sql, args }); return [saved.row]; },
    } }) };
  const storage = { writeDecodedFrame() { throw Error('Reader cannot write a decoded frame'); },
    async readDecodedFrame({ frame }) { assert.deepEqual(frame, saved.frame); return { bytes: saved.bytes }; } };
  const connected = createConnectedManual({ boundary, storage, artifacts: { read() { throw Error('Unexpected artifact read'); } }, keyPrefix: 'synthetic', readOnlyGradingImages: true });
  assert.equal(connected.reportImages, null);
  const input = { cardId: photo.original.binding.cardId, uploadId: photo.original.uploadId, side: 'FRONT', photo };
  const found = await connected.readGradingPhoto(input);
  assert.deepEqual(found.bytes, saved.bytes); assert.deepEqual(found.photo.workingFrame, saved.frame);
  assert.equal(calls.length, 2);
  for (const call of calls) { assert.match(call.sql, /^SELECT \* FROM atlas_manual_connected\.read_grading_photo\(/);
    assert.deepEqual(call.args, [input.cardId, input.uploadId, 'FRONT', 'LOCAL_FIXTURE']); }
});

test('read-only reader rechecks current upload and rejects corrupt saved evidence without provider access', async () => {
  const saved = await savedGradingPhoto(photo); let rows = [saved.row], changed = false, reads = 0;
  const reader = createStoredGradingPhotoReader({ boundary: { machineTransaction: async (_staff, work) => work({ principal: { mode: 'LOCAL_FIXTURE' },
    tx: { $queryRawUnsafe: async () => changed && reads ? [] : rows } }) }, storage: { readDecodedFrame: async () => { reads++; return { bytes: saved.bytes }; } } });
  const input = { cardId: photo.original.binding.cardId, uploadId: photo.original.uploadId, side: 'FRONT', photo };
  assert.equal(await reader.isPhotoPrepared(input), true);
  changed = true; await assert.rejects(reader.readGradingPhoto(input), { code: 'REPORT_IMAGE_SOURCE_CHANGED' });
  changed = false; rows = [{ ...saved.row, result_hash: 'a'.repeat(64) }];
  await assert.rejects(reader.readGradingPhoto(input), { code: 'REPORT_IMAGE_STORED_CONTENT_INVALID' });
  rows = []; await assert.rejects(reader.readGradingPhoto(input), { code: 'GRADING_IMAGE_PENDING' });
  assert.deepEqual(Object.keys(reader).sort(), ['isPhotoPrepared', 'photoStatus', 'readGradingPhoto']);
});

test('saved image status exposes only bounded state and code without raster or provider reads',async()=>{
 const saved=await savedGradingPhoto(photo);let row={...saved.row,state:'UNKNOWN',result:null,result_hash:null,code:'REPORT_IMAGE_RESPONSE_UNKNOWN',privateDiagnostic:'secret'};
 const reader=createStoredGradingPhotoReader({boundary:{machineTransaction:async(_staff,work)=>work({principal:{mode:'LOCAL_FIXTURE'},tx:{$queryRawUnsafe:async()=>[row]}})},
   storage:{readDecodedFrame(){throw Error('Status must not read pixels');}}});
 const input={cardId:photo.original.binding.cardId,uploadId:photo.original.uploadId,side:'FRONT'};
 assert.deepEqual(await reader.photoStatus(input),{state:'UNKNOWN',code:'REPORT_IMAGE_RESPONSE_UNKNOWN'});
 row={...row,state:'FAILED',code:'private diagnostic\nwith secret'};
 assert.deepEqual(await reader.photoStatus(input),{state:'FAILED',code:null});
});

test('isolated variant grants add saved-image projection without image queue capability', () => {
  const worker = variantJobGrantSQL('synthetic_variant', { worker: true });
  assert.match(worker, /read_grading_photo\(uuid,uuid,text,text\)/);
  assert.doesNotMatch(worker, /report_image_job|card_image_binding|card_image_intent/);
  assert.doesNotMatch(variantJobGrantSQL('synthetic_main'), /read_grading_photo/);
});
