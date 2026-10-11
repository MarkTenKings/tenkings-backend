import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAstraDefectRequest, buildAstraBackgroundDefectRequest, buildAstraContextBackgroundDefectRequest,
  planDefectCrops, validateRequestEvidence, restorePreparedRequest, parseDefectProposals,
  INSPECTION_CONTEXT_CROP_LAYOUT, VERSION, BACKGROUND_VERSION } from '../src/index.mjs';
import { canonical, digest } from '../src/contract.mjs';
import { inputFixture, contextInputFixture, outputFixture, withLessons, hash } from './fixtures.mjs';

const expectedRects = [[0, 0], [611, 0], [0, 865], [611, 865]].map(([x, y]) => ({ x, y, width: 739, height: 993 }));
const contextRequest = () => buildAstraContextBackgroundDefectRequest(contextInputFixture());

test('explicit context builder uses V2 and all ten original-detail images; whole images, prompt, schema and source stay exact', () => {
  const old = buildAstraBackgroundDefectRequest(inputFixture()), prepared = contextRequest();
  assert.equal(prepared.evidence.version, BACKGROUND_VERSION);
  assert.equal(prepared.evidence.cropLayoutVersion, INSPECTION_CONTEXT_CROP_LAYOUT);
  assert.equal(prepared.request.background, true);
  assert.equal(prepared.evidence.sourceBindingSha256, old.evidence.sourceBindingSha256);
  for (const field of ['promptSha256', 'schemaSha256', 'limits', 'binding', 'knowledge'])
    assert.deepEqual(prepared.evidence[field], old.evidence[field]);
  const content = prepared.request.input[1].content, oldContent = old.request.input[1].content;
  assert.equal(content.filter(value => value.type === 'input_image').length, 10);
  assert(content.filter(value => value.type === 'input_image').every(value => value.detail === 'original'));
  for (const [i, side] of ['FRONT', 'BACK'].entries()) {
    assert.deepEqual(prepared.evidence.images[i * 5], old.evidence.images[i * 5]);
    assert.deepEqual(content.slice(i * 10 + 1, i * 10 + 3), oldContent.slice(i * 10 + 1, i * 10 + 3));
    assert.deepEqual(planDefectCrops(side, INSPECTION_CONTEXT_CROP_LAYOUT), expectedRects.map((rect, j) => ({ id: `${side}:crop:${j + 1}`, ...rect })));
    assert.deepEqual(prepared.evidence.images.slice(i * 5 + 1, i * 5 + 5).map(image => image.crop), expectedRects);
  }
});

test('retained context request restores exact bytes and hashes with empty and reviewed memory', () => {
  for (const input of [contextInputFixture(), withLessons(contextInputFixture())]) {
    const prepared = buildAstraContextBackgroundDefectRequest(input), restored = restorePreparedRequest(prepared);
    assert.equal(restored.requestText, prepared.requestText);
    assert.equal(restored.requestHash, prepared.requestHash);
    assert.equal(restored.evidenceHash, prepared.evidenceHash);
    assert.deepEqual(restored.evidence, prepared.evidence);
    assert.deepEqual(validateRequestEvidence({ ...prepared.evidence, providerBindingHash: hash('provider') }),
      { ...prepared.evidence, providerBindingHash: hash('provider') });
  }
});

test('absent, unsupported and incompatible layout markers cannot reinterpret crop evidence or restore altered requests', () => {
  const old = buildAstraBackgroundDefectRequest(inputFixture()), prepared = contextRequest();
  assert.throws(() => buildAstraContextBackgroundDefectRequest(inputFixture()), { code: 'DEFECT_ANALYSIS_CROP_MISMATCH' });
  for (const builder of [buildAstraDefectRequest, buildAstraBackgroundDefectRequest])
    assert.throws(() => builder(contextInputFixture()), { code: 'DEFECT_ANALYSIS_CROP_MISMATCH' });
  for (const marker of ['future-layout', 'legacy', null, undefined, 1]) {
    assert.throws(() => validateRequestEvidence({ ...prepared.evidence, cropLayoutVersion: marker }),
      { code: 'DEFECT_ANALYSIS_CROP_LAYOUT_INVALID' });
    if (marker !== undefined) assert.throws(() => planDefectCrops('FRONT', marker), { code: 'DEFECT_ANALYSIS_CROP_LAYOUT_INVALID' });
  }
  const altered = [
    { ...prepared.evidence, version: VERSION },
    { ...old.evidence, cropLayoutVersion: INSPECTION_CONTEXT_CROP_LAYOUT },
    Object.fromEntries(Object.entries(prepared.evidence).filter(([key]) => key !== 'cropLayoutVersion')),
    { ...prepared.evidence, images: prepared.evidence.images.map((image, i) => i === 1 ? { ...image, width: image.width - 1 } : image) },
  ];
  for (const evidence of altered) {
    assert.throws(() => validateRequestEvidence(evidence));
    assert.throws(() => restorePreparedRequest({ ...prepared, evidence, evidenceHash: digest(canonical(evidence)) }));
  }
  // Swapping to another internally valid layout must still fail exact artifact restoration.
  assert.throws(() => restorePreparedRequest({ ...prepared, evidence: old.evidence, evidenceHash: old.evidenceHash }));
  assert.throws(() => restorePreparedRequest({ ...old, evidence: prepared.evidence, evidenceHash: prepared.evidenceHash }));
});

test('each context crop maps its card corner exactly and retains adjacent background observations without clamping', () => {
  const { evidence } = contextRequest();
  // Independent physical corner positions in the four local images.
  const corners = [
    { x: 40, y: 40, sx: 1, sy: 1, canonical: { x: 0, y: 0 } },
    { x: 698, y: 40, sx: -1, sy: 1, canonical: { x: 1, y: 0 } },
    { x: 40, y: 952, sx: 1, sy: -1, canonical: { x: 0, y: 1 } },
    { x: 698, y: 952, sx: -1, sy: -1, canonical: { x: 1, y: 1 } },
  ];
  for (const side of ['FRONT', 'BACK']) for (const [i, corner] of corners.entries()) {
    const output = outputFixture(evidence), finding = output.findings[0];
    Object.assign(finding, { side, imageId: `${side}:crop:${i + 1}`, localContour: [
      { x: corner.x, y: corner.y }, { x: corner.x + corner.sx * 10, y: corner.y },
      { x: corner.x + corner.sx * 10, y: corner.y + corner.sy * 12 }, { x: corner.x, y: corner.y + corner.sy * 12 },
    ] });
    const proposal = parseDefectProposals(output, evidence).proposals[0];
    assert.deepEqual(proposal.canonicalContour, [corner.canonical,
      { x: (i % 2 ? 1259 : 10) / 1269, y: corner.canonical.y },
      { x: (i % 2 ? 1259 : 10) / 1269, y: (i > 1 ? 1765 : 12) / 1777 },
      { x: corner.canonical.x, y: (i > 1 ? 1765 : 12) / 1777 },
    ]);
    assert.equal(proposal.provenance.cropLayoutVersion, INSPECTION_CONTEXT_CROP_LAYOUT);
    assert.deepEqual(proposal.provenance.crop, expectedRects[i]);
    for (const axis of ['x', 'y']) {
      const invalid = structuredClone(output);
      invalid.findings[0].localContour[0][axis] -= corner[axis === 'x' ? 'sx' : 'sy'];
      const retained = parseDefectProposals(invalid, evidence).proposals[0];
      assert.equal(retained.measurementHold, 'OUTSIDE_CARD_FRAME');
      assert.deepEqual(retained.provenance.localContour, invalid.findings[0].localContour);
      assert.notDeepEqual(retained.canonicalContour, proposal.canonicalContour);
    }
  }
});

// The saved Magmar response contained five observations: two bottom-edge
// marks were 7–12 pixels beyond the physical frame, alongside three in-card
// marks. Reproduce its crop coordinates without retaining private images.
test('one off-card observation no longer refuses a completed response with valid peers', () => {
  const { evidence } = contextRequest(), raw = outputFixture(evidence), first = raw.findings[0];
  const points = [
    ['FRONT',4,[[690,891],[694,891],[694,897],[692,902],[688,901],[689,896]]],
    ['BACK',2,[[671,332],[696,315],[697,317],[673,335]]],
    ['BACK',3,[[87,961],[92,959],[97,960],[97,962],[93,963],[88,963]]],
    ['BACK',4,[[695,918],[698,919],[695,929],[690,938],[683,945],[678,948],[678,945],[682,941],[687,935],[692,927]]],
    ['BACK',4,[[638,960],[644,960],[649,961],[649,963],[643,964],[638,963]]],
  ];
  raw.findings = points.map(([side, crop, contour]) => ({ ...first, side, imageId: `${side}:crop:${crop}`,
    localContour: contour.map(([x,y]) => ({x,y})) }));
  const parsed = parseDefectProposals(raw,evidence);
  assert.equal(parsed.proposals.length,5);
  assert.deepEqual(parsed.proposals.map(p => Boolean(p.measurementHold)),[false,false,true,false,true]);
  for (const [index,p] of parsed.proposals.entries()) assert.deepEqual(p.provenance.localContour,raw.findings[index].localContour);
  assert.ok(parsed.proposals[2].canonicalContour.every(p => p.y > 1));
});
