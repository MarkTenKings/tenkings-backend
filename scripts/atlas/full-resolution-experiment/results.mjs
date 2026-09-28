// Offline interpretation and unchanged deterministic scoring. Never persists
// application state, publishes memory, or impersonates human review.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildMachineReport } from '../../../packages/atlas-connected-manual/src/batch-preparation.mjs';
import { canonical, digest } from '../../../packages/atlas-manual-service/src/contract.mjs';
import { DEFECT_TYPES } from '../../../packages/atlas-defect-analysis/src/index.mjs';
import { mapSourceContour } from './coordinates.mjs';

const json = async path => JSON.parse(await readFile(path, 'utf8'));
const keys = (value, names) => { assert(value && Object.getPrototypeOf(value) === Object.prototype); assert.deepEqual(Object.keys(value).sort(), [...names].sort()); };
const boundedText = (value, max = 512) => assert(typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value));

export function interpretResponse(body, evidence) {
  assert.equal(body.model, evidence.model); assert(/^resp_[A-Za-z0-9_-]{1,180}$/.test(body.id));
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
  return { policy: evidence.policy, analysisId: evidence.analysisId, responseId: body.id, raw: value, rows,
    validCount: rows.filter(x => x.status === 'VALID_MAPPED').length,
    invalidCount: rows.filter(x => x.status === 'INVALID').length,
    unmappableCount: rows.filter(x => x.status === 'UNMAPPABLE_PHYSICAL_GEOMETRY').length, canScore,
    analysis: { status: 'READY', analysisId: evidence.analysisId, proposals, limitations: value.limitations },
    gradeStatus: canScore ? 'ELIGIBLE_FOR_DETERMINISTIC_MEASUREMENT' : evidence.diagnosticOnly ? 'PHYSICAL_GEOMETRY_UNAVAILABLE' : 'RESPONSE_INVALID',
    productionApplied: false, humanApproval: false };
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
  const report = await buildMachineReport({ ...frozenState(card, extra), analysis: interpreted.analysis, pythonExecutable, measurementLimits });
  return { ...report, experimentPolicy: interpreted.policy, productionApplied: false, humanApproval: false };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const root = resolve(process.argv[2]), label = process.argv[3], pythonExecutable = process.argv[4];
  const manifest = await json(resolve(root, 'input-manifest.private.json')), extra = await json(resolve(root, 'extra-artifacts.private.json'));
  const card = manifest.cards.find(x => x.label === label); assert(card);
  const evidence = await json(resolve(root, label, 'evidence.json'));
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
