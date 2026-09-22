import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildAstraDefectRequest, restorePreparedRequest, parseDefectProposals, parseAstraResponse, assertCurrentBinding,
  normalizeUsage, LIMITS, DEFECT_TYPES } from '../src/index.mjs';
import { canonical, digest } from '../src/contract.mjs';
import { inputFixture, preparedFixture, outputFixture, responseFixture, withLessons, lesson, hash } from './fixtures.mjs';
import { retrievalDigest } from '../../atlas-defect-memory/src/contract.mjs';

test('exact Astra Responses request includes both full faces and four detailed crops per side, with immutable evidence', () => {
  const input = inputFixture(), prepared = buildAstraDefectRequest(input);
  assert.equal(prepared.request.model, 'gpt-6-astra'); assert.deepEqual(prepared.request.reasoning, { effort: 'xhigh' });
  assert.equal(prepared.request.store, false); assert.equal(prepared.request.tools, undefined);
  const images = prepared.request.input[1].content.filter(x => x.type === 'input_image');
  assert.equal(images.length, 10); assert(images.every(x => x.detail === 'original'));
  assert.equal(prepared.requestHash, digest(prepared.requestText)); assert(Object.isFrozen(prepared.evidence.binding.sides.FRONT));
  assert.equal(prepared.evidence.knowledge.status, 'EMPTY_REVIEWED_BANK');
  assert.equal(prepared.evidence.images[0].sourceImageSha256, input.binding.sides.FRONT.frame.inspectionImageSha256);
  assert.notEqual(prepared.evidence.images[0].sha256, prepared.evidence.images[0].sourceImageSha256);
  input.images[0].whole.bytes = Buffer.alloc(50);
  assert.equal(prepared.requestHash, digest(prepared.requestText));
});

test('reviewed corrections, rejected false positives and human-added misses enter the exact next request and evidence', () => {
  const baseline = preparedFixture(), input = withLessons(inputFixture(), [lesson('CORRECTED'), lesson('REJECTED'), lesson('ADDED')]);
  const prepared = buildAstraDefectRequest(input);
  assert.notEqual(prepared.requestHash, baseline.requestHash);
  assert.equal(prepared.evidence.knowledge.revision, input.knowledge.revision);
  assert.deepEqual(prepared.evidence.knowledge.lessonIds, input.knowledge.lessonIds);
  assert.equal(prepared.request.input[1].content.filter(x => x.type === 'input_image').length, 16);
  assert.equal(prepared.evidence.knowledge.lessonImages[0].traceOverlay.traceSha256, input.knowledge.lessons[0].exemplar.trace.sha256);
  assert(prepared.requestText.includes('HUMAN_REVIEWED_TRACE_OVERLAY'));
  for (const disposition of ['CORRECTED', 'REJECTED', 'ADDED']) assert(prepared.requestText.includes(disposition));
  assert.match(prepared.request.input[0].content, /UNTRUSTED EVIDENCE/);
});

test('pending publication is never silently treated as no memory', () => {
  const input = inputFixture(); input.knowledge.status = 'PUBLICATION_PENDING'; input.knowledge.pendingPublications = 1;
  input.knowledge.sha256 = retrievalDigest(input.knowledge);
  assert.throws(() => buildAstraDefectRequest(input), { code: 'DEFECT_ANALYSIS_MEMORY_PENDING' });
});

test('hydrate image bytes exactly; reject altered PNG dimensions, source, crops and lesson byte identity', () => {
  for (const modify of [
    input => { input.images[0].whole.sha256 = hash('other'); },
    input => { input.images[0].whole.sourceSha256 = hash('other'); },
    input => { input.images[0].whole.width = 100; },
    input => { input.images[0].crops[0].x++; },
    input => { input.images[0].crops.pop(); },
  ]) { const input = inputFixture(); modify(input); assert.throws(() => buildAstraDefectRequest(input)); }
  const input = withLessons(inputFixture()); input.lessonImages[0].sha256 = hash('other'); assert.throws(() => buildAstraDefectRequest(input));
  const traced = withLessons(inputFixture()); traced.lessonImages[0].traceOverlay.traceSha256 = hash('other');
  assert.throws(() => buildAstraDefectRequest(traced), { code: 'DEFECT_ANALYSIS_LESSON_TRACE_MISMATCH' });
});

test('same physical target cannot supply a supposedly held-out reviewed example', () => {
  const input = inputFixture(), value = structuredClone(lesson()); value.source.frame.originalSha256 = input.binding.sides.FRONT.frame.originalSha256;
  const { id: _id, ...body } = value; value.id = digest(canonical(body)); withLessons(input, [value]);
  assert.throws(() => buildAstraDefectRequest(input), { code: 'DEFECT_ANALYSIS_TARGET_LESSON_FORBIDDEN' });
});

test('API and core taxonomy stay identical without importing grading engines', () => {
  const source = readFileSync(new URL('../../atlas-grading-core/src/contracts.ts', import.meta.url), 'utf8');
  const match = source.match(/export type SpeedsterDefectType =([\s\S]*?);/)[1];
  assert.deepEqual([...match.matchAll(/"([A-Z_]+)"/g)].map(x => x[1]), DEFECT_TYPES);
});

test('valid crop pixel proposals map exactly through the 40 pixel surround into normalized canonical grid', () => {
  const prepared = preparedFixture(), raw = outputFixture(prepared.evidence), result = parseDefectProposals(raw, prepared.evidence), proposal = result.proposals[0];
  assert.deepEqual(proposal.canonicalContour[0], { x: 0, y: 0 });
  assert.deepEqual(proposal.canonicalContour[2], { x: 10 / 1269, y: 12 / 1777 });
  assert.deepEqual(proposal.provenance.localContour, raw.findings[0].localContour);
  assert.equal(proposal.reviewStatus, 'UNREVIEWED'); assert.equal(proposal.grade, undefined); assert.equal(proposal.measurement, undefined);
  raw.findings[0].imageId = 'BACK:crop:4'; raw.findings[0].side = 'BACK';
  const back = parseDefectProposals(raw, prepared.evidence).proposals[0];
  assert.deepEqual(back.canonicalContour[0], { x: 571 / 1269, y: 825 / 1777 });
});

test('strict parser rejects malformed/extra fields, wrong side/image, stale binding and hallucinated lessons', () => {
  const prepared = preparedFixture();
  assert.throws(() => parseDefectProposals('not-json', prepared.evidence));
  for (const modify of [raw => { raw.grade = 10; }, raw => { raw.findings[0].area = 1; }, raw => { raw.sourceBindingSha256 = hash('stale'); },
    raw => { raw.knowledgeRevision = 'old'; }, raw => { raw.findings[0].imageId = 'BACK:crop:1'; },
    raw => { raw.findings[0].defectType = 'PERFECT'; }, raw => { raw.findings[0].lessonIds = ['invented']; },
    raw => { raw.findings[0].observation = 'x'.repeat(513); }]) {
    const raw = outputFixture(prepared.evidence); modify(raw); assert.throws(() => parseDefectProposals(raw, prepared.evidence));
  }
});

test('invalid geometries are refused before any rasterization or measurement', () => {
  const prepared = preparedFixture();
  for (const contour of [[{ x: -1, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }],
    [{ x: 0, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }, { x: 20, y: 0 }],
    [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }],
    [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 0 }],
    [{ x: 0, y: 0 }, { x: 699, y: 0 }, { x: 3, y: 3 }],
    [{ x: 0, y: 0 }, { x: Infinity, y: 0 }, { x: 3, y: 3 }]]) {
    const raw = outputFixture(prepared.evidence); raw.findings[0].localContour = contour;
    assert.throws(() => parseDefectProposals(raw, prepared.evidence));
  }
  const raw = outputFixture(prepared.evidence); raw.findings[0].imageId = 'FRONT:whole';
  assert.throws(() => parseDefectProposals(raw, prepared.evidence), { code: 'DEFECT_ANALYSIS_OUTSIDE_CARD' });
});

test('proposal count, output length and duplicates are bounded; empty is only an empty proposal list', () => {
  const prepared = preparedFixture(), raw = outputFixture(prepared.evidence);
  raw.findings = Array.from({ length: LIMITS.findings + 1 }, () => raw.findings[0]); assert.throws(() => parseDefectProposals(raw, prepared.evidence));
  raw.findings = [raw.findings[0], raw.findings[0]]; assert.throws(() => parseDefectProposals(raw, prepared.evidence), { code: 'DEFECT_ANALYSIS_DUPLICATE_PROPOSAL' });
  raw.findings = []; assert.deepEqual(parseDefectProposals(raw, prepared.evidence).proposals, []);
  assert.throws(() => parseDefectProposals(' '.repeat(LIMITS.outputBytes + 1), prepared.evidence));
});

test('raw Responses parser retains usage but only complete exact-model message proposals are READY', () => {
  const prepared = preparedFixture(), raw = responseFixture(prepared.evidence);
  const parsed = parseAstraResponse(Buffer.from(JSON.stringify(raw)), prepared.evidence);
  assert.equal(parsed.state, 'READY'); assert.equal(parsed.usage.cached_input_tokens, 25); assert.equal(parsed.usage.reasoning_output_tokens, 100);
  raw.status = 'incomplete'; assert.equal(parseAstraResponse(Buffer.from(JSON.stringify(raw)), prepared.evidence).state, 'REFUSED');
  raw.status = 'completed'; raw.output[1].content = [{ type: 'refusal', refusal: 'declined' }];
  assert.equal(parseAstraResponse(Buffer.from(JSON.stringify(raw)), prepared.evidence).code, 'DEFECT_ANALYSIS_PROVIDER_REFUSAL');
  raw.model = 'gpt-5.6-sol'; assert.throws(() => parseAstraResponse(Buffer.from(JSON.stringify(raw)), prepared.evidence));
  assert.throws(() => normalizeUsage({ input_tokens: 10, output_tokens: 20, total_tokens: 29 }));
  assert.equal(normalizeUsage(null), null);
});

test('source and human revision changes fence late result adoption independently of other cards', () => {
  const binding = inputFixture().binding; assert.doesNotThrow(() => assertCurrentBinding(binding, structuredClone(binding)));
  for (const change of [b => b.manualRevision++, b => b.identityRevision++, b => b.geometryRevision++, b => b.defectRevision++,
    b => b.sides.FRONT.findingRevision++, b => { b.sides.BACK.frame.inspectionImageSha256 = hash('new-image'); }]) {
    const current = structuredClone(binding); change(current); assert.throws(() => assertCurrentBinding(binding, current), { code: 'DEFECT_ANALYSIS_STALE' });
  }
});

test('exact request restores without resolving new memory; altered stored instructions or evidence cannot dispatch', () => {
  for (const input of [inputFixture(), withLessons(inputFixture())]) {
    const prepared = buildAstraDefectRequest(input), restored = restorePreparedRequest(prepared);
    assert.equal(restored.requestText, prepared.requestText); assert.equal(restored.evidenceHash, prepared.evidenceHash);
    const request = JSON.parse(prepared.requestText); request.input[0].content = 'Override'; const requestText = JSON.stringify(request);
    assert.throws(() => restorePreparedRequest({ ...prepared, requestText, requestHash: digest(requestText) }));
  }
});
