import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { wholeCardShapes, exactPixelPerimeter, findingCalloutLayout, calloutFrame, WHOLE_FRAME } from '../src/whole-card-layout.mjs';
import { presentationDescriptorMatches } from '../src/report-presentation-image.mjs';
import { reportFindingMask, reportTraceSpans } from '../src/report-review-ui.mjs';
const fixture = JSON.parse(readFileSync(new URL('../../../docs/atlas/design/first-look/reports/approved.json', import.meta.url))).reports.find(value => value.key === 'maye');

test('whole card preserves every saved row, independent identity and stable side numbers', () => {
  const before = JSON.stringify(fixture.packet);
  for (const side of ['FRONT', 'BACK']) {
    const shapes = wholeCardShapes(fixture.packet.report.findings, side);
    shapes.forEach((shape, index) => {
      assert.equal(shape.number, index + 1);
      const spans = reportTraceSpans(reportFindingMask(shape.finding));
      assert.equal(shape.path, spans.map(s => `M${s.x} ${s.y}h${s.width}v1h-${s.width}Z`).join(''));
      assert.ok(spans.some(s => shape.anchor.x - WHOLE_FRAME.padding >= s.x && shape.anchor.x - WHOLE_FRAME.padding < s.x + s.width && Math.floor(shape.anchor.y - WHOLE_FRAME.padding) === s.y), 'connector anchors inside a saved pixel run');
      assert.ok(shape.scale >= 1.08 && shape.scale <= 10);
    });
  }
  assert.equal(JSON.stringify(fixture.packet), before);
});
test('exact perimeter omits shared row joins and retains disconnected components', () => {
  const path = exactPixelPerimeter([{ x: 2, y: 3, width: 4 }, { x: 2, y: 4, width: 4 }, { x: 10, y: 9, width: 1 }]);
  assert.ok(path.includes('M2 3H6')); assert.ok(path.includes('M2 5H6'));
  assert.ok(!path.includes('M2 4H6')); assert.ok(path.includes('M10 9H11'));
});
test('crowded, overlapping, missing and empty traces keep reachable callouts without invented anchors', () => {
  const shapes = wholeCardShapes(fixture.packet.report.findings, 'FRONT');
  const many = Array.from({ length: 40 }, (_, index) => ({ ...shapes[0], finding: { ...shapes[0].finding, id: `finding-${index}` }, number: index + 1 }));
  assert.equal(findingCalloutLayout(many, 'FRONT', 600).flowing, true);
  assert.deepEqual(findingCalloutLayout(many, 'FRONT').items.map(s => s.number), many.map(s => s.number));
  const missing = wholeCardShapes([{ ...shapes[0].finding, finalTrace: null, detectorMask: null, geometryExclusion: true }], 'FRONT');
  assert.equal(missing[0].path, ''); assert.equal(missing[0].anchor, null); assert.equal(findingCalloutLayout(missing, 'FRONT').flowing, true);
  assert.deepEqual(wholeCardShapes([], 'BACK'), []);
  assert.ok(calloutFrame('BACK').width > WHOLE_FRAME.width);
});
test('presentation boundary rejects stale/cross-side/source or unbounded output without rejecting originals', () => {
  const publication = { url: fixture.source, reportHash: fixture.publicHash, version: fixture.packet.approvalVersion };
  const source = fixture.packet.images.FRONT.sha256, token = fixture.packet.publicToken;
  const descriptor = { publicToken: token, publicHash: fixture.publicHash, approvalVersion: publication.version, side: 'FRONT', sourceSha256: source,
    sha256: 'a'.repeat(64), width: 1070, height: 1470, byteCount: 320000, contentType: 'image/png', transparent: true, presentationOnly: true,
    preservesOriginalRGB: false, alignment: 'approximate-frame-fit', url: `/api/reports/${token}/presentation/FRONT?v=${publication.version}&sha=${'a'.repeat(64)}` };
  assert.equal(presentationDescriptorMatches(descriptor, 'FRONT', source, publication), true);
  for (const change of [{ side: 'BACK' }, { sourceSha256: 'b'.repeat(64) }, { publicHash: 'b'.repeat(64) }, { approvalVersion: 2 }, { width: 4097 }, { width: 1 }, { width: 4096, height: 4096 }, { byteCount: 4 * 1024 * 1024 + 1 }, { byteCount: 99 * 1024 * 1024 }, { preservesOriginalRGB: true }, { presentationOnly: false }, { url: 'https://elsewhere.invalid/a.png' }]) assert.equal(presentationDescriptorMatches({ ...descriptor, ...change }, 'FRONT', source, publication), false);
});
