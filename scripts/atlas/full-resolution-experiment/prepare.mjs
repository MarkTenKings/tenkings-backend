// Offline, opt-in experiment only. No application imports this CLI and no
// storage/database/provider writes are available to it.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { restorePreparedRequest, RESULT_SCHEMA } from '../../../packages/atlas-defect-analysis/src/index.mjs';
import { canonical } from '../../../packages/atlas-defect-analysis/src/contract.mjs';
import { parseOriginal, parseDecodedFrame, descriptorSha256 } from '../../../packages/atlas-photo-core/src/index.mjs';
import { gradingIdentity } from '../../../packages/atlas-connected-manual/src/details.mjs';
import { createDefectImageEffects } from '../../../packages/atlas-connected-manual/src/defect-images.mjs';
import { retrievalDigest, validateRetrieval } from '../../../packages/atlas-defect-memory/src/contract.mjs';
import { planSourceCrops, transformPoint, inverseMatrix, assertSourceGeometryBinding } from './coordinates.mjs';

const sharp = createRequire(new URL('../../../frontend/atlas-app/package.json', import.meta.url))('sharp');
export const POLICY = 'atlas-source-resolution-experiment-v1';
export const hash = value => createHash('sha256').update(value).digest('hex');
const SIDES = ['FRONT', 'BACK'];
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const save = (path, value) => writeFile(path, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
const raw = bytes => sharp(bytes, { failOn: 'warning', limitInputPixels: 30_000_000 }).raw().toBuffer({ resolveWithObject: true });

export async function verifySource(slot, cardId, side) {
  const photo = slot.photo.value;
  assert.equal(slot.photo.ref.cardId, cardId); assert.equal(slot.photo.ref.kind, 'PHOTO_SOURCE');
  assert.equal(hash(JSON.stringify(photo)), slot.photo.ref.sha256);
  const original = parseOriginal(photo.original);
  const working = parseDecodedFrame(photo.workingFrame, original, photo.decodePlan);
  assert.equal(original.binding.cardId, cardId); assert.equal(original.binding.side, side);
  assert.equal(working.originalDescriptorSha256, descriptorSha256(original));
  const bytes = await readFile(slot.path), raster = working.raster;
  assert.equal(hash(bytes), raster.content.sha256, 'source bytes substituted');
  assert.equal(bytes.length, raster.content.byteCount);
  const decoded = await raw(bytes);
  assert.equal(decoded.info.width, raster.dimensions.width); assert.equal(decoded.info.height, raster.dimensions.height);
  assert.equal(decoded.info.channels, 3); assert.equal(decoded.info.depth, 'uchar');
  assert.equal(raster.content.mime, 'image/png');
  assert.deepEqual([raster.dimensions.width, raster.dimensions.height], [3024, 4032]);
  return { photo, working, bytes, decoded };
}

export async function prepareCard(card, root, extra, threadsMemory) {
  const folder = resolve(root, card.label); await mkdir(folder, { recursive: true, mode: 0o700 });
  const baselineCard = card.baseline ? card : (await json(resolve(root, 'input-manifest.private.json'))).cards.find(x => x.label === 'Card-41');
  const baselineBytes = await readFile(baselineCard.baselineRequestPath);
  const manifest = baselineCard.baseline.value;
  assert.equal(hash(baselineBytes), manifest.requestHash);
  const restored = restorePreparedRequest({ requestText: baselineBytes.toString('utf8'), requestHash: manifest.requestHash,
    evidence: manifest.evidence, evidenceHash: manifest.evidenceHash });
  const request = structuredClone(restored.request);
  const analysisId = randomUUID();
  let knowledge = structuredClone(restored.evidence.knowledge);
  let lessons = request.input[1].content.slice(21);
  if (!card.baseline) {
    const snapshot = threadsMemory.find(x => x.cardId === card.cardId)?.snapshot;
    assert(snapshot && snapshot.pending === 0, 'pending diagnostic memory must not be bypassed');
    const selected = snapshot.selected.map(x => x.lesson);
    assert(selected.every(lesson => lesson.source.cardId !== card.cardId
      && !SIDES.some(side => card.sides[side].photo.value.original.content.sha256 === lesson.source.frame.originalSha256)));
    const retrieval = { version: 'atlas-defect-memory-retrieval-v1', revision: `m1:${snapshot.generation}:${snapshot.confirmation_hash}`,
      generation: snapshot.generation, status: selected.length ? 'READY' : 'EMPTY_REVIEWED_BANK', pendingPublications: 0,
      lessonIds: selected.map(x => x.id), lessons: selected };
    const validated = validateRetrieval({ ...retrieval, sha256: retrievalDigest(retrieval) });
    const lessonArtifacts = await json(resolve(root, 'threads-lesson-artifacts.private.json'));
    const effects = createDefectImageEffects({ artifacts: { read: async ref => {
      const found = lessonArtifacts.find(x => x.ref.key === ref.key); assert(found); assert.deepEqual(found.ref, ref);
      assert.equal(hash(JSON.stringify(found.value)), ref.sha256); return structuredClone(found.value);
    } } });
    const hydrated = await effects.lessonImages(validated);
    const png = img => ({ type: 'input_image', detail: 'original', image_url: `data:image/png;base64,${img.bytes.toString('base64')}` });
    const descriptors = hydrated.map(({ bytes, traceOverlay: { bytes: overlayBytes, ...traceOverlay }, ...img }) => ({ ...img, byteCount: bytes.length,
      traceOverlay: { ...traceOverlay, byteCount: overlayBytes.length } }));
    knowledge = { revision: retrieval.revision, generation: retrieval.generation, sha256: retrievalDigest(retrieval),
      status: retrieval.status, lessonIds: retrieval.lessonIds, lessonImages: descriptors }; lessons = [];
    for (const [index, lesson] of selected.entries()) {
      const image = hydrated[index], { bytes: _bytes, traceSha256, ...overlay } = image.traceOverlay;
      lessons.push({ type: 'input_text', text: canonical({ kind: 'HUMAN_REVIEWED_EXAMPLE', ...lesson }, 524288) }, png(image),
        { type: 'input_text', text: canonical({ kind: 'HUMAN_REVIEWED_TRACE_OVERLAY', lessonId: lesson.id,
          traceSha256, ...overlay, byteCount: image.traceOverlay.bytes.length }, 524288) }, png(image.traceOverlay));
    }
  }
  const geometry = card.geometryArtifacts.find(x => x.ref.kind === 'GEOMETRY')?.value ?? null;
  const images = [], content = [], sourceSides = {}, validation = [];
  let totalImageBytes = 0;
  for (const side of SIDES) {
    const slot = card.sides[side]; const { photo, working, bytes, decoded } = await verifySource(slot, card.cardId, side);
    const { width, height } = working.raster.dimensions;
    const early = card.geometryArtifacts.find(x => x.ref.kind === 'EARLY_GEOMETRY' && x.value.binding.side === side)?.value;
    assert.equal(early.binding.cardId, card.cardId);
    assert.deepEqual(early.photoFrame, working);
    const savedFrame = geometry?.sides[side]?.prepared?.frame ?? early?.preparation?.frame ?? null;
    const prepared = slot.prepared ?? extra.find(x => x.ref.cardId === card.cardId && x.ref.kind === 'PREPARED_IMAGES'
      && x.value.images.inspection.originalDescriptorSha256 === working.originalDescriptorSha256) ?? null;
    const H = savedFrame?.sourceToRectified ?? null;
    const quad = geometry?.sides[side]?.physical?.quad ?? early?.preparation?.sourceQuad ?? null;
    let roundTripMaxPx = null, cornerMaxPx = null, inspectionMaxPx = null;
    if (H) {
      if (geometry) assert.deepEqual(assertSourceGeometryBinding({ geometrySide: geometry.sides[side], workingFrame: working,
        originalSha256: photo.original.content.sha256 }), H);
      assert(prepared && quad); const p = prepared.value;
      assert.equal(p.images.inspection.frameDescriptorSha256, descriptorSha256(working));
      assert.equal(p.images.inspection.originalDescriptorSha256, working.originalDescriptorSha256);
      assert.equal(p.images.inspection.raster.content.sha256, savedFrame.inspection.sha256);
      assert.deepEqual(p.images.rectified.frameToDerivative, H);
      const inverse = inverseMatrix(H);
      roundTripMaxPx = 0; inspectionMaxPx = 0;
      for (let y = 0; y < height; y += 200) for (let x = 0; x < width; x += 200) {
        const mapped = transformPoint(H, { x, y }), back = transformPoint(inverse, mapped);
        roundTripMaxPx = Math.max(roundTripMaxPx, Math.hypot(back.x - x, back.y - y));
        const inspection = transformPoint(p.images.inspection.frameToDerivative, { x, y });
        inspectionMaxPx = Math.max(inspectionMaxPx, Math.hypot(inspection.x - mapped.x - 40, inspection.y - mapped.y - 40));
      }
      cornerMaxPx = Math.max(...quad.map((q, i) => {
        const v = transformPoint(H, { x: q.x * width, y: q.y * height });
        return Math.hypot(v.x - [0,1269,1269,0][i], v.y - [0,0,1777,1777][i]);
      }));
      assert(roundTripMaxPx < 1e-6 && cornerMaxPx < 1e-4 && inspectionMaxPx < 1e-4);
      if (card.baseline) {
        const bound = card.baseline.value.evidence.binding.sides[side].frame;
        assert.equal(bound.originalSha256, photo.original.content.sha256);
        assert.equal(bound.frameId, savedFrame.id); assert.equal(bound.inspectionImageSha256, savedFrame.inspection.sha256);
      }
    } else assert(!prepared && !quad, 'partial/mismatched geometry must not become a transform');
    sourceSides[side] = { originalSha256: photo.original.content.sha256, workingSha256: hash(bytes),
      originalToWorking: working.sourceToFrame, workingDescriptorSha256: descriptorSha256(working), width, height,
      sourceToRectified: H, preparedFrame: savedFrame, preparedArtifactSha256: prepared?.ref.sha256 ?? null,
      sourceCardPolygon: quad?.map(q => ({ x: q.x * width, y: q.y * height })) ?? null };
    const rectangles = [{ x: 0, y: 0, width, height }, ...planSourceCrops({ width, height, sourceToRectified: H })];
    for (const [index, crop] of rectangles.entries()) {
      const id = `${side}:${index === 0 ? 'whole' : `crop:${index}`}`;
      let png = bytes;
      if (index) png = await sharp(bytes).extract({ left: crop.x, top: crop.y, width: crop.width, height: crop.height }).png({ compressionLevel: 6 }).toBuffer();
      const check = await raw(png);
      assert.equal(check.info.width, crop.width); assert.equal(check.info.height, crop.height); assert.equal(check.info.channels, 3);
      const expected = Buffer.alloc(crop.width * crop.height * 3);
      for (let y = 0; y < crop.height; y++) decoded.data.copy(expected, y * crop.width * 3,
        ((crop.y + y) * width + crop.x) * 3, ((crop.y + y) * width + crop.x + crop.width) * 3);
      assert(check.data.equals(expected), 'crop changed source samples');
      const patches = Math.ceil(crop.width / 32) * Math.ceil(crop.height / 32);
      assert(patches <= 30000 && Math.max(crop.width, crop.height) <= 65535);
      const image = { id, side, sourceImageSha256: hash(bytes), mime: 'image/png', sha256: hash(png), byteCount: png.length,
        width: crop.width, height: crop.height, crop: { x: crop.x, y: crop.y, width: crop.width, height: crop.height },
        coordinateSpace: 'WORKING_SOURCE_LOCAL_PIXEL_CENTERS', noResampling: true,
        physicalCardBoundaryInSource: sourceSides[side].sourceCardPolygon,
        geometryStatus: H ? 'SAVED_MACHINE_GEOMETRY' : 'PHYSICAL_GEOMETRY_UNAVAILABLE', detail: 'original',
        patches, estimatedImageTokens: Math.ceil(patches * 1.2), decodedPixelSha256: hash(check.data) };
      images.push(image); totalImageBytes += png.length;
      content.push({ type: 'input_text', text: JSON.stringify({ kind: 'CURRENT_CARD', ...image }) },
        { type: 'input_image', detail: 'original', image_url: `data:image/png;base64,${png.toString('base64')}` });
    }
    validation.push({ side, roundTripMaxPx, cornerMaxPx, inspectionMaxPx, sourceSamplesPreserved: true });
  }
  const baselineEvidence = card.baseline?.value.evidence ?? null;
  const profile = card.snapshot.details.profile;
  const cornerShapes = baselineEvidence?.cornerShapes ?? Object.fromEntries(SIDES.map(s => [s, card.snapshot.details.cornerShape]));
  const sourceBindingSha256 = hash(canonical({ policy: POLICY, cardId: card.cardId, profile, cornerShapes, sourceSides, images,
    knowledge, baselineEvidenceHash: card.baseline?.value.evidenceHash ?? null }, 262144));
  const context = JSON.parse(request.input[1].content[0].text);
  Object.assign(context, { analysisId, profile, cornerShapes, sourceBindingSha256, knowledgeRevision: knowledge.revision, knowledgeStatus: knowledge.status });
  request.input[1].content = [{ type: 'input_text', text: JSON.stringify(context) }, ...content, ...lessons];
  const schema = structuredClone(RESULT_SCHEMA);
  schema.properties.findings.items.properties.localContour.items.properties.x.maximum = 3023;
  schema.properties.findings.items.properties.localContour.items.properties.y.maximum = 4031;
  request.text.format.schema = schema;
  assert.equal(hash(request.input[0].content), restored.evidence.promptSha256);
  assert.equal(request.model, 'gpt-6-astra'); assert.equal(request.reasoning.effort, 'xhigh');
  assert.equal(request.background, true); assert.equal(request.store, false); assert.equal(request.max_output_tokens, 32768);
  const requestText = JSON.stringify(request); assert(Buffer.byteLength(requestText) <= 192 * 1024 * 1024);
  const evidence = { policy: POLICY, analysisId, cardId: card.cardId, label: card.label, name: card.name,
    identity: gradingIdentity(card.snapshot.details), profile, cornerShapes, sourceBindingSha256, sourceSides, images, knowledge,
    baselineAnalysisId: baselineEvidence?.analysisId ?? null, baselineRequestHash: card.baseline?.value.requestHash ?? null,
    baselineEvidenceHash: card.baseline?.value.evidenceHash ?? null, promptSha256: restored.evidence.promptSha256,
    baselineSchemaSha256: restored.evidence.schemaSha256, schemaSha256: hash(canonical(schema)),
    schemaDelta: 'Only localContour x/y maxima expanded to 3023/4031 for source pixels.',
    lessonContentSha256: hash(JSON.stringify(lessons)), model: request.model, reasoningEffort: request.reasoning.effort,
    totalCurrentImageBytes: totalImageBytes, requestByteCount: Buffer.byteLength(requestText), requestHash: hash(requestText),
    estimatedCurrentImageTokens: images.reduce((sum, image) => sum + image.estimatedImageTokens, 0), validation,
    productionWrites: false, humanApproval: false, diagnosticOnly: !SIDES.every(s => sourceSides[s].sourceToRectified) };
  await writeFile(resolve(folder, 'request.json'), requestText, { flag: 'wx', mode: 0o600 });
  await save(resolve(folder, 'evidence.json'), evidence);
  return evidence;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const root = resolve(process.argv[2]);
  const manifest = await json(resolve(root, 'input-manifest.private.json'));
  assert.equal(manifest.version, POLICY); assert.equal(manifest.cards.length, 6);
  const extra = await json(resolve(root, 'extra-artifacts.private.json'));
  const memory = await json(resolve(root, 'threads-memory.private.json'));
  for (const card of manifest.cards.filter(c => !process.argv[3] || c.label === process.argv[3])) {
    const result = await prepareCard(card, root, extra, memory);
    console.log(JSON.stringify({ label: result.label, requestHash: result.requestHash, requestBytes: result.requestByteCount,
      estimatedCurrentImageTokens: result.estimatedCurrentImageTokens, diagnosticOnly: result.diagnosticOnly, validation: result.validation }));
  }
}
