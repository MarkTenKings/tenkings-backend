import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, digest } from '@atlas/manual-service/contract';
import { createReportImageStore } from '../src/report-image-store.mjs';
import { createCardImageStore } from '../src/card-image-store.mjs';
import { REPORT_IMAGE_RECIPE, reportImageJobKey, reportImageRecipeHash } from '../src/report-image-provider.mjs';
import { photo } from './photo-fixture.mjs';

function fixture() {
  const original = photo.original;
  const plan = { schemaVersion: 1, uploadId: original.uploadId, binding: original.binding,
    object: { ...original.object, versionId: null }, expected: { sha256: original.content.sha256, byteCount: original.content.byteCount } };
  const verified = { object: original.object, sha256: original.content.sha256, byteCount: original.content.byteCount, contentType: 'application/octet-stream' };
  const media = { descriptor: photo.workingFrame, frame: photo.workingFrame, original, decodePlan: photo.decodePlan };
  const upload = { card_id: original.binding.cardId, upload_id: original.uploadId, side: original.binding.side, source: canonical({ fixture: 'source artifact' }) };
  const f = { writes: [], transactions: 0, queries: [], retained: null, prior: null,
    current: { id: upload.upload_id, plan: canonical(plan), plan_hash: digest(canonical(plan)),
      verification: canonical(verified), verification_hash: digest(canonical(verified)), source_hash: digest(upload.source) } };
  const key = reportImageJobKey(media.descriptor.raster.content.sha256, REPORT_IMAGE_RECIPE, upload.upload_id);
  let bindingReads = 0;
  const store = createCardImageStore({ parsed: x => x ?? null, boundary: { async machineTransaction(_authority, work) {
    f.transactions++;
    return work({ principal: { mode: 'LOCAL_FIXTURE' }, tx: {
      async $executeRawUnsafe(sql, ...args) { f.writes.push({ sql, args }); return 1; },
      async $queryRawUnsafe(sql, ...args) {
        f.queries.push({ sql, args });
        if (sql.startsWith('SELECT u.id,u.plan')) return f.current ? [f.current] : [];
        if (sql.startsWith('SELECT job_key FROM atlas_manual_connected.card_image_binding')) return ++bindingReads === 1 ? (f.prior ? [{ job_key: f.prior }] : []) : [{ job_key: f.winningKey ?? f.retained ?? key }];
        if (sql.startsWith('SELECT key FROM atlas_manual_connected.report_image_job')) return f.retained ? [{ key: f.retained }] : [];
        if (sql.startsWith('SELECT mode,source_hash,recipe_hash')) return [{ mode: 'LOCAL_FIXTURE', source_hash: f.retained ? 'b'.repeat(64) : media.descriptor.raster.content.sha256, recipe_hash: reportImageRecipeHash(REPORT_IMAGE_RECIPE) }];
        throw Error('Unexpected fixture query');
      },
    } });
  } } });
  return Object.assign(f, { store, upload, media, key, plan, verified });
}

test('image admission binds the original to the current saved plan, verified object and working descriptor', async () => {
  const f = fixture();
  assert.equal(await f.store.enqueuePhoto(f.upload, f.media, REPORT_IMAGE_RECIPE), f.key);
  assert.equal(f.writes.length, 2);
  assert.equal(f.writes[0].args[1], f.media.descriptor.raster.content.sha256);
  assert.equal(f.writes[1].args[3], f.media.original.content.sha256);
  for (const mutate of [
    g => { g.media = structuredClone(g.media); g.media.original.uploadId = 'wrong-upload'; },
    g => { g.media = structuredClone(g.media); g.media.descriptor.sourceToFrame[2]++; },
    g => { g.media = structuredClone(g.media); g.media.frame = photo.original; },
    g => { const plan = { ...g.plan, expected: { ...g.plan.expected, sha256: 'b'.repeat(64) } }; g.current.plan = canonical(plan); g.current.plan_hash = digest(g.current.plan); },
    g => { const verified = { ...g.verified, object: { ...g.verified.object, versionId: 'unverified-version' } }; g.current.verification = canonical(verified); g.current.verification_hash = digest(g.current.verification); },
    g => { g.current.source_hash = 'c'.repeat(64); },
    g => { g.current = null; },
  ]) {
    const g = fixture(); mutate(g); await assert.rejects(g.store.enqueuePhoto(g.upload, g.media, REPORT_IMAGE_RECIPE));
    assert.equal(g.writes.length, 0);
  }
});

test('repeat and concurrent binding return the immutable winning job', async () => {
  const f = fixture(); f.prior = 'd'.repeat(64);
  assert.equal(await f.store.enqueuePhoto(f.upload, f.media, REPORT_IMAGE_RECIPE), f.prior); assert.equal(f.writes.length, 0);
  const g = fixture(); g.winningKey = 'e'.repeat(64);
  assert.equal(await g.store.enqueuePhoto(g.upload, g.media, REPORT_IMAGE_RECIPE), g.winningKey);
});

test('retired publication enqueue/import is absent; only upload admission remains', () => {
  const store = createReportImageStore({ boundary: {} });
  assert.equal('enqueue' in store, false);
  assert.equal(typeof store.enqueuePhoto, 'function');
});
