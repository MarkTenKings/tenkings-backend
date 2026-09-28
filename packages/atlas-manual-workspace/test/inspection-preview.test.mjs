import test from 'node:test';
import assert from 'node:assert/strict';
import { reportInspectionPreview, inspectionLoadingText } from '../src/inspection-preview.mjs';
const hash = 'a'.repeat(64);
const descriptor = () => ({ sha256: hash, preview: { sourceSha256: hash, sha256: 'b'.repeat(64), url: '/preview.jpg',
  byteCount: 12000, mime: 'image/jpeg', width: 558, height: 768, policyVersion: 'atlas-inspection-preview-v1' } });
test('preview must describe the same approved frame with bounded size and matching aspect', () => {
  const d = descriptor(); assert.deepEqual(reportInspectionPreview(d, hash), d.preview);
  assert.equal(reportInspectionPreview({ sha256: hash }, hash), null);
  for (const mutate of [d => { d.sha256 = 'c'.repeat(64); }, d => { d.preview.sourceSha256 = 'c'.repeat(64); },
    d => { d.preview.width = 768; }, d => { d.preview.height = 0; }, d => { d.preview.byteCount = 2000000; },
    d => { d.preview.policyVersion = 'unbound'; }]) {
    const d = descriptor(); mutate(d); assert.equal(reportInspectionPreview(d, hash), null);
  }
});
test('preview and verification progress describe separate full-detail readiness', () => {
  assert.match(inspectionLoadingText({ loadedBytes: 5, totalBytes: 10 }, true), /Preview.*50%/);
  assert.match(inspectionLoadingText({ phase: 'VERIFYING' }, true), /Checking full-detail/);
});
