// Offline interpretation and unchanged deterministic scoring. Never persists
// application state, publishes memory, or impersonates human review.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildMachineReport } from '../../../packages/atlas-connected-manual/src/batch-preparation.mjs';
import { canonical, digest } from '../../../packages/atlas-manual-service/src/contract.mjs';
import { DEFECT_TYPES, RESULT_SCHEMA, restorePreparedRequest, normalizeUsage } from '../../../packages/atlas-defect-analysis/src/index.mjs';
import { canonical as requestCanonical } from '../../../packages/atlas-defect-analysis/src/contract.mjs';
import { descriptorSha256 } from '../../../packages/atlas-photo-core/src/index.mjs';
import { gradingIdentity } from '../../../packages/atlas-connected-manual/src/details.mjs';
import { validateRetrieval, retrievalDigest } from '../../../packages/atlas-defect-memory/src/contract.mjs';
import { mapSourceContour, planSourceCrops, assertSourceGeometryBinding } from './coordinates.mjs';

const json = async path => JSON.parse(await readFile(path, 'utf8'));
const keys = (value, names) => { assert(value && Object.getPrototypeOf(value) === Object.prototype); assert.deepEqual(Object.keys(value).sort(), [...names].sort()); };
const boundedText = (value, max = 512) => assert(typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value && !/[\x00-\x1f\x7f]/.test(value));
const SIDES = ['FRONT', 'BACK'], verifiedEvidence = new WeakMap(), verifiedResults = new WeakMap();
const recordHash = value => digest(JSON.stringify(value));

export function verifyEvidenceBinding(evidence) {
  assert.equal(evidence.policy, 'atlas-source-resolution-experiment-v1');
  const { policy, cardId, profile, cornerShapes, sourceSides, images, knowledge, baselineEvidenceHash } = evidence;
  assert.equal(evidence.sourceBindingSha256, digest(requestCanonical({ policy, cardId, profile, cornerShapes,
    sourceSides, images, knowledge, baselineEvidenceHash }, 262144)), 'experiment evidence binding changed');
  assert.equal(evidence.diagnosticOnly, !SIDES.every(side => sourceSides[side]?.sourceToRectified));
  assert.equal(evidence.productionWrites, false); assert.equal(evidence.humanApproval, false);
}
function artifact(value, cardId, kind) {
  assert(value?.ref && value.value); assert.equal(value.ref.cardId, cardId); assert.equal(value.ref.kind, kind);
  const bytes = JSON.stringify(value.value);
  assert.equal(digest(bytes), value.ref.sha256, 'manifest artifact changed');
  assert.equal(Buffer.byteLength(bytes), value.ref.byteCount);
  return value.value;
}

/** Match the frozen input manifest, rather than trusting a response echo to
 * authenticate mutable evidence or the card later selected for measurement. */
export function assertFrozenStateBinding(evidence, card, extra) {
  verifyEvidenceBinding(evidence);
  assert.equal(evidence.cardId, card.cardId); assert.equal(evidence.label, card.label);
  assert.equal(evidence.profile, card.snapshot.details.profile);
  assert.deepEqual(evidence.identity, gradingIdentity(card.snapshot.details));
  const baseline = card.baseline?.value;
  assert.equal(evidence.baselineEvidenceHash, baseline?.evidenceHash ?? null);
  assert.equal(evidence.baselineRequestHash, baseline?.requestHash ?? null);
  assert.equal(evidence.baselineAnalysisId, baseline?.evidence.analysisId ?? null);
  assert.deepEqual(evidence.cornerShapes, baseline?.evidence.cornerShapes
    ?? Object.fromEntries(SIDES.map(s => [s, card.snapshot.details.cornerShape])));
  const geometryArtifact = card.geometryArtifacts.find(a => a.ref.kind === 'GEOMETRY');
  const geometry = geometryArtifact ? artifact(geometryArtifact, card.cardId, 'GEOMETRY') : null;
  let pairId;
  for (const side of SIDES) {
    const slot = card.sides[side], photo = artifact(slot.photo, card.cardId, 'PHOTO_SOURCE');
    const working = photo.workingFrame, source = evidence.sourceSides[side];
    assert.equal(photo.original.binding.cardId, card.cardId); assert.equal(photo.original.binding.side, side);
    if (pairId) assert.equal(photo.original.binding.pairId, pairId); pairId = photo.original.binding.pairId;
    const early = artifact(card.geometryArtifacts.find(a => a.ref.kind === 'EARLY_GEOMETRY'
      && a.value.binding.side === side), card.cardId, 'EARLY_GEOMETRY');
    assert.equal(early.binding.cardId, card.cardId); assert.deepEqual(early.photoFrame, working);
    const frame = geometry?.sides[side]?.prepared?.frame ?? early.preparation?.frame ?? null;
    const preparedArtifact = slot.prepared ?? extra.find(a => a.ref.cardId === card.cardId && a.ref.kind === 'PREPARED_IMAGES'
      && a.value.images.inspection.originalDescriptorSha256 === working.originalDescriptorSha256) ?? null;
    const H = frame?.sourceToRectified ?? null;
    const quad = geometry?.sides[side]?.physical?.quad ?? early.preparation?.sourceQuad ?? null;
    const { width, height } = working.raster.dimensions;
    assert.deepEqual(source, { originalSha256: photo.original.content.sha256, workingSha256: working.raster.content.sha256,
      originalToWorking: working.sourceToFrame, workingDescriptorSha256: descriptorSha256(working), width, height,
      sourceToRectified: H, preparedFrame: frame, preparedArtifactSha256: preparedArtifact?.ref.sha256 ?? null,
      sourceCardPolygon: quad?.map(q => ({ x: q.x * width, y: q.y * height })) ?? null }, 'source/geometry substitution');
    if (H) {
      assert(quad && preparedArtifact);
      const prepared = artifact(preparedArtifact, card.cardId, 'PREPARED_IMAGES');
      assert.equal(prepared.images.inspection.frameDescriptorSha256, descriptorSha256(working));
      assert.equal(prepared.images.inspection.originalDescriptorSha256, working.originalDescriptorSha256);
      assert.equal(prepared.images.inspection.raster.content.sha256, frame.inspection.sha256);
      assert.equal(prepared.images.rectified.raster.content.sha256, frame.rectified.sha256);
      assert.deepEqual(prepared.images.rectified.frameToDerivative, H);
      if (geometry) assert.deepEqual(assertSourceGeometryBinding({ geometrySide: geometry.sides[side], workingFrame: working,
        originalSha256: photo.original.content.sha256 }), H);
    } else assert(!quad && !preparedArtifact);
    if (baseline) {
      assert.equal(baseline.evidence.cardId, card.cardId); assert.equal(baseline.evidence.profile, evidence.profile);
      const bound = baseline.evidence.binding.sides[side].frame;
      assert.equal(bound.originalSha256, source.originalSha256); assert.equal(bound.frameId, frame.id);
      assert.equal(bound.imageVersion, photo.original.binding.version); assert.equal(bound.preparationVersion, frame.version);
      assert.equal(bound.inspectionImageSha256, frame.inspection.sha256); assert.equal(bound.rectifiedImageSha256, frame.rectified.sha256);
    }
  }
  if (!evidence.diagnosticOnly) {
    const frozen = frozenState(card, extra);
    for (const side of SIDES) {
      const source = evidence.sourceSides[side], slot = frozen.state.defects.sides[side];
      assert.equal(slot.cornerShape, evidence.cornerShapes[side]);
      const expected = { imageVersion: photoVersion(card, side), originalSha256: source.originalSha256,
        preparationVersion: source.preparedFrame.version, frameId: source.preparedFrame.id,
        inspectionImageSha256: source.preparedFrame.inspection.sha256, rectifiedImageSha256: source.preparedFrame.rectified.sha256 };
      assert.deepEqual(slot.frame, expected, 'measurement frame substituted');
    }
    assert.equal(baseline.evidence.binding.sourceHash, frozen.card.draft.source.sourceHash);
    assert.equal(baseline.evidence.binding.manualRevision, frozen.card.revision);
    assert.equal(baseline.evidence.binding.manualContentHash, frozen.card.contentHash);
  }
}
const photoVersion = (card, side) => card.sides[side].photo.value.original.binding.version;

/** Read-only validation of the already frozen/sent files. It never rebuilds or
 * changes a paid request. Raw file hashes are retained as an audit receipt. */
export function verifyExperimentInputs({ manifestText, extraText, evidenceText, requestText, baselineRequestText,
  label, dispatchIntent, accepted, threadsMemory = [] }) {
  const manifest = JSON.parse(manifestText), extra = JSON.parse(extraText), evidence = JSON.parse(evidenceText);
  assert.equal(manifest.version, evidence.policy); assert.equal(manifest.cards.length, 6);
  assert.equal(new Set(manifest.cards.map(c => c.cardId)).size, 6);
  assert.equal(manifest.cards.filter(c => c.label === label).length, 1);
  const card = manifest.cards.find(c => c.label === label);
  assertFrozenStateBinding(evidence, card, extra);
  assert.equal(digest(requestText), evidence.requestHash); assert.equal(Buffer.byteLength(requestText), evidence.requestByteCount);
  for (const receipt of [dispatchIntent, accepted]) {
    assert(receipt); assert.equal(receipt.analysisId, evidence.analysisId); assert.equal(receipt.requestHash, evidence.requestHash);
  }
  assert.equal(accepted.state, 'RECEIVED'); assert.equal(accepted.httpStatus, 200);
  const acceptedBody = JSON.parse(accepted.responseText);
  assert(/^resp_[A-Za-z0-9_-]{1,180}$/.test(acceptedBody.id));
  assert.equal(digest(accepted.responseText), accepted.responseSha256);
  const templateCard = card.baseline ? card : manifest.cards.find(c => c.label === 'Card-41');
  const baseline = templateCard.baseline.value;
  const restored = restorePreparedRequest({ requestText: baselineRequestText, requestHash: baseline.requestHash,
    evidence: baseline.evidence, evidenceHash: baseline.evidenceHash });
  const request = JSON.parse(requestText), schema = structuredClone(RESULT_SCHEMA);
  schema.properties.findings.items.properties.localContour.items.properties.x.maximum = 3023;
  schema.properties.findings.items.properties.localContour.items.properties.y.maximum = 4031;
  assert.deepEqual(request.text, { ...restored.request.text, format: { ...restored.request.text.format, schema } });
  assert.equal(evidence.schemaSha256, digest(requestCanonical(schema)));
  assert.equal(evidence.baselineSchemaSha256, restored.evidence.schemaSha256);
  const fixed = { ...request, input: restored.request.input, text: restored.request.text };
  assert.deepEqual(fixed, restored.request); assert.equal(request.input.length, 2);
  assert.deepEqual(request.input[0], restored.request.input[0]); assert.equal(request.input[1].role, 'user');
  assert.equal(digest(request.input[0].content), evidence.promptSha256);
  assert.equal(evidence.promptSha256, restored.evidence.promptSha256);
  assert.equal(evidence.model, request.model); assert.equal(evidence.reasoningEffort, request.reasoning.effort);
  const content = request.input[1].content, context = JSON.parse(content[0].text);
  assert.deepEqual(context, { ...JSON.parse(restored.request.input[1].content[0].text), analysisId: evidence.analysisId,
    profile: evidence.profile, cornerShapes: evidence.cornerShapes, sourceBindingSha256: evidence.sourceBindingSha256,
    knowledgeRevision: evidence.knowledge.revision, knowledgeStatus: evidence.knowledge.status });
  assert.equal(evidence.images.length, 10);
  let total = 0;
  for (const [i, image] of evidence.images.entries()) {
    assert.deepEqual(JSON.parse(content[1 + 2*i].text), { kind: 'CURRENT_CARD', ...image });
    const input = content[2 + 2*i]; assert.equal(input.type, 'input_image'); assert.equal(input.detail, 'original');
    assert(input.image_url.startsWith('data:image/png;base64,'));
    const encoded = input.image_url.slice(22), bytes = Buffer.from(encoded, 'base64');
    assert.equal(bytes.toString('base64'), encoded); assert.equal(digest(bytes), image.sha256);
    assert.equal(bytes.length, image.byteCount); total += bytes.length;
    assert(bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
    assert.equal(bytes.readUInt32BE(16), image.width); assert.equal(bytes.readUInt32BE(20), image.height);
    const side = SIDES[Math.floor(i/5)], n = i%5, source = evidence.sourceSides[side];
    const specs = [{ x: 0, y: 0, width: source.width, height: source.height }, ...planSourceCrops(source)];
    const { canonicalCrop: _canonicalCrop, ...crop } = specs[n];
    assert.equal(image.side, side); assert.equal(image.id, `${side}:${n ? `crop:${n}` : 'whole'}`);
    assert.deepEqual(image.crop, crop); assert.equal(image.width, crop.width); assert.equal(image.height, crop.height);
    assert.equal(image.sourceImageSha256, source.workingSha256); if (!n) assert.equal(image.sha256, source.workingSha256);
    assert.equal(image.coordinateSpace, 'WORKING_SOURCE_LOCAL_PIXEL_CENTERS'); assert.equal(image.noResampling, true);
    assert.deepEqual(image.physicalCardBoundaryInSource, source.sourceCardPolygon);
  }
  assert.equal(total, evidence.totalCurrentImageBytes);
  const lessons = content.slice(21); assert.equal(digest(JSON.stringify(lessons)), evidence.lessonContentSha256);
  if (card.baseline) {
    assert.deepEqual(evidence.knowledge, restored.evidence.knowledge);
    assert.deepEqual(lessons, restored.request.input[1].content.slice(21));
  } else {
    const snapshot = threadsMemory.find(x => x.cardId === card.cardId)?.snapshot;
    assert(snapshot && snapshot.pending === 0); assert.equal(lessons.length, snapshot.selected.length * 4);
    const selected = lessons.filter((_, i) => i%4 === 0).map(x => { const { kind, ...lesson } = JSON.parse(x.text);
      assert.equal(kind, 'HUMAN_REVIEWED_EXAMPLE'); return lesson; });
    assert.deepEqual(selected, snapshot.selected.map(x => x.lesson));
    assert.equal(evidence.knowledge.revision, `m1:${snapshot.generation}:${snapshot.confirmation_hash}`);
    assert.equal(evidence.knowledge.generation, snapshot.generation);
    assert(selected.every(lesson => lesson.source.cardId !== card.cardId
      && !SIDES.some(side => evidence.sourceSides[side].originalSha256 === lesson.source.frame.originalSha256)));
    assert.equal(evidence.knowledge.lessonImages.length, selected.length);
    for (const [i, lesson] of selected.entries()) {
      const descriptor = evidence.knowledge.lessonImages[i]; assert.equal(descriptor.lessonId, lesson.id);
      assert.equal(descriptor.sha256, lesson.exemplar.crop.sha256);
      assert.equal(descriptor.traceOverlay.traceSha256, lesson.exemplar.trace.sha256);
      const { traceSha256, ...overlay } = descriptor.traceOverlay;
      assert.deepEqual(JSON.parse(lessons[4*i + 2].text), { kind: 'HUMAN_REVIEWED_TRACE_OVERLAY', lessonId: lesson.id,
        traceSha256, ...overlay });
      for (const [input, image] of [[lessons[4*i + 1], descriptor], [lessons[4*i + 3], descriptor.traceOverlay]]) {
        assert.equal(input.type, 'input_image'); assert.equal(input.detail, 'original'); assert.equal(image.mime, 'image/png');
        assert(input.image_url.startsWith('data:image/png;base64,'));
        const encoded = input.image_url.slice(22), bytes = Buffer.from(encoded, 'base64');
        assert.equal(bytes.toString('base64'), encoded); assert.equal(digest(bytes), image.sha256);
        assert.equal(bytes.length, image.byteCount);
        assert(bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
        assert.equal(bytes.readUInt32BE(16), image.width); assert.equal(bytes.readUInt32BE(20), image.height);
      }
    }
    const retrieval = { version: 'atlas-defect-memory-retrieval-v1', revision: evidence.knowledge.revision,
      generation: evidence.knowledge.generation, status: evidence.knowledge.status, pendingPublications: 0,
      lessonIds: evidence.knowledge.lessonIds, lessons: selected, sha256: evidence.knowledge.sha256 };
    validateRetrieval(retrieval); assert.equal(retrieval.sha256, retrievalDigest(retrieval));
  }
  const verification = { inputManifestSha256: digest(manifestText), extraArtifactsSha256: digest(extraText),
    evidenceSha256: digest(evidenceText), requestSha256: digest(requestText), baselineRequestSha256: digest(baselineRequestText),
    acceptedResponseId: acceptedBody.id, sourceBindingSha256: evidence.sourceBindingSha256 };
  verifiedEvidence.set(evidence, { verification, evidenceHash: recordHash(evidence), cardHash: recordHash(card), extraHash: recordHash(extra) });
  return { card, extra, evidence, verification };
}

export function interpretResponse(body, evidence) {
  const verified = verifiedEvidence.get(evidence);
  if (verified) {
    assert.equal(recordHash(evidence), verified.evidenceHash, 'verified evidence changed');
    assert.equal(body.id, verified.verification.acceptedResponseId, 'response does not match the accepted paid request');
  }
  assert.equal(body.model, evidence.model); assert(/^resp_[A-Za-z0-9_-]{1,180}$/.test(body.id));
  normalizeUsage(body.usage);
  assert.equal(body.status, 'completed');
  assert(Array.isArray(body.output) && body.output.every(x => ['message', 'reasoning'].includes(x.type)));
  const messages = body.output.filter(x => x.type === 'message'); assert.equal(messages.length, 1);
  const message = messages[0]; assert.equal(message.status, 'completed'); assert.equal(message.role, 'assistant');
  assert.equal(message.content.length, 1); assert.equal(message.content[0].type, 'output_text');
  const text = message.content[0].text; assert(Buffer.byteLength(text) <= 262144);
  const value = JSON.parse(text); keys(value, ['sourceBindingSha256', 'knowledgeRevision', 'findings', 'limitations']);
  assert.equal(value.sourceBindingSha256, evidence.sourceBindingSha256); assert.equal(value.knowledgeRevision, evidence.knowledge.revision);
  assert(Array.isArray(value.findings) && value.findings.length <= 32);
  assert(Array.isArray(value.limitations) && value.limitations.length <= 8); value.limitations.forEach(x => boundedText(x));
  const rows = [], proposals = [], seen = new Set();
  for (const [index, finding] of value.findings.entries()) {
    let sourceContour = null;
    try {
      keys(finding, ['side', 'imageId', 'defectType', 'localContour', 'observation', 'uncertainty', 'lessonIds']);
      assert(['FRONT', 'BACK'].includes(finding.side)); assert(DEFECT_TYPES.includes(finding.defectType));
      assert(['LOW', 'MEDIUM', 'HIGH'].includes(finding.uncertainty)); boundedText(finding.observation); boundedText(finding.imageId);
      assert(Array.isArray(finding.lessonIds) && finding.lessonIds.length <= 12 && new Set(finding.lessonIds).size === finding.lessonIds.length
        && finding.lessonIds.every(id => evidence.knowledge.lessonIds.includes(id)));
      const image = evidence.images.find(x => x.id === finding.imageId && x.side === finding.side); assert(image, 'unknown current image');
      const source = evidence.sourceSides[finding.side]; assert.equal(image.sourceImageSha256, source.workingSha256);
      const mapped = mapSourceContour({ points: finding.localContour, crop: image.crop, width: source.width, height: source.height,
        sourceToRectified: source.sourceToRectified }); sourceContour = mapped.sourceContour;
      const signature = canonical({ side: finding.side, sourceContour }); assert(!seen.has(signature), 'duplicate proposal'); seen.add(signature);
      const status = mapped.canonicalContour ? 'VALID_MAPPED' : 'UNMAPPABLE_PHYSICAL_GEOMETRY';
      rows.push({ index: index + 1, status, raw: finding, ...mapped });
      if (mapped.canonicalContour) proposals.push({ id: `${evidence.analysisId}:${index + 1}`, side: finding.side, defectType: finding.defectType,
        canonicalContour: mapped.canonicalContour, observation: finding.observation, uncertainty: finding.uncertainty, reviewStatus: 'UNREVIEWED',
        provenance: { version: evidence.policy, analysisId: evidence.analysisId, sourceBindingSha256: evidence.sourceBindingSha256,
          imageId: image.id, imageSha256: image.sha256, localContour: finding.localContour, sourceContour,
          crop: image.crop, sourceToRectified: source.sourceToRectified, knowledgeRevision: evidence.knowledge.revision, lessonIds: finding.lessonIds } });
    } catch (error) {
      rows.push({ index: index + 1, status: 'INVALID', code: error.code ?? error.message, raw: finding, sourceContour });
    }
  }
  const canScore = !evidence.diagnosticOnly && rows.every(x => x.status === 'VALID_MAPPED');
  const result = { policy: evidence.policy, analysisId: evidence.analysisId, responseId: body.id, raw: value, rows,
    validCount: rows.filter(x => x.status === 'VALID_MAPPED').length,
    invalidCount: rows.filter(x => x.status === 'INVALID').length,
    unmappableCount: rows.filter(x => x.status === 'UNMAPPABLE_PHYSICAL_GEOMETRY').length, canScore,
    analysis: { status: 'READY', analysisId: evidence.analysisId, proposals, limitations: value.limitations },
    gradeStatus: canScore ? 'ELIGIBLE_FOR_DETERMINISTIC_MEASUREMENT' : evidence.diagnosticOnly ? 'PHYSICAL_GEOMETRY_UNAVAILABLE' : 'RESPONSE_INVALID',
    productionApplied: false, humanApproval: false, ...(verified ? { verification: verified.verification } : {}) };
  if (verified) verifiedResults.set(result, { ...verified, resultHash: recordHash(result), evidence });
  return result;
}

export function frozenState(card, extra) {
  assert(card.snapshot.workspace);
  const draft = card.snapshot.workspace;
  const geometry = card.geometryArtifacts.find(x => x.ref.kind === 'GEOMETRY'); assert(geometry);
  const defects = extra.find(x => x.ref.kind === 'DEFECTS' && x.ref.cardId === card.cardId); assert(defects);
  for (const [kind, artifact] of [['geometry', geometry], ['defects', defects]]) {
    assert.deepEqual(artifact.ref, draft[kind].ref);
    assert.equal(digest(JSON.stringify(artifact.value)), draft[kind].sourceHash);
  }
  return { card: { cardId: card.cardId, draft, revision: card.snapshot.workspaceRevision, contentHash: digest(canonical(draft)) },
    state: { geometry: geometry.value, defects: defects.value, identity: draft.identity, assistance: null } };
}

export const measurementLimits = { maxInputBytes: 16 * 1024 * 1024, maxOutputBytes: 16 * 1024 * 1024, maxFindings: 200, timeoutMs: 30000 };
export async function scoreExperiment(card, extra, interpreted, pythonExecutable) {
  assert.equal(interpreted.canScore, true, 'incomplete/invalid analysis must not receive a score');
  const verified = verifiedResults.get(interpreted); assert(verified, 'verified frozen experiment inputs required before scoring');
  assert.equal(recordHash(interpreted), verified.resultHash, 'interpreted findings changed');
  assert.equal(recordHash(card), verified.cardHash, 'scoring card changed');
  assert.equal(recordHash(extra), verified.extraHash, 'scoring artifacts changed');
  assertFrozenStateBinding(verified.evidence, card, extra);
  const report = await buildMachineReport({ ...frozenState(card, extra), analysis: interpreted.analysis, pythonExecutable, measurementLimits });
  return { ...report, experimentPolicy: interpreted.policy, verification: verified.verification, productionApplied: false, humanApproval: false };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const root = resolve(process.argv[2]), label = process.argv[3], pythonExecutable = process.argv[4];
  const manifestText = await readFile(resolve(root, 'input-manifest.private.json'), 'utf8'), manifest = JSON.parse(manifestText);
  const selected = manifest.cards.find(x => x.label === label); assert(selected);
  const template = selected.baseline ? selected : manifest.cards.find(x => x.label === 'Card-41');
  const { card, extra, evidence } = verifyExperimentInputs({ manifestText, label,
    extraText: await readFile(resolve(root, 'extra-artifacts.private.json'), 'utf8'),
    evidenceText: await readFile(resolve(root, label, 'evidence.json'), 'utf8'),
    requestText: await readFile(resolve(root, label, 'request.json'), 'utf8'),
    baselineRequestText: await readFile(template.baselineRequestPath, 'utf8'),
    dispatchIntent: await json(resolve(root, label, 'dispatch.intent.json')), accepted: await json(resolve(root, label, 'accepted.json')),
    threadsMemory: await json(resolve(root, 'threads-memory.private.json')) });
  const response = await readFile(resolve(root, label, 'response.json')); const interpreted = interpretResponse(JSON.parse(response), evidence);
  await writeFile(resolve(root, label, 'interpreted.json'), JSON.stringify({ ...interpreted, responseSha256: digest(response) }, null, 2), { flag: 'wx', mode: 0o600 });
  let report = null;
  if (interpreted.canScore) {
    report = await scoreExperiment(card, extra, interpreted, pythonExecutable);
    await writeFile(resolve(root, label, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
  }
  console.log(JSON.stringify({ label, responseId: interpreted.responseId, rawFindings: interpreted.rows.length, valid: interpreted.validCount,
    invalid: interpreted.invalidCount, unmappable: interpreted.unmappableCount, gradeStatus: report?.calculationState ?? interpreted.gradeStatus,
    proposedGrade: report?.proposedGrade ?? null, limitations: interpreted.raw.limitations }));
}
