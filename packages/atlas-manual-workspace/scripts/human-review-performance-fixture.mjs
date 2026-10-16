/** Synthetic, in-memory review persistence only. No accounts, providers or DB.
 * Prepared transforms and measured masks come from existing synthetic fixtures;
 * subsequent edits use the actual deterministic CPU measurement adapter.
 */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { focusedFixture } from '../test/focused-geometry-fixture.mjs';
import { measurements } from '../test/defect-fixtures.mjs';
import { geometryMeasurementFrame, confirmBothGeometry } from '../src/geometry-actions.mjs';
import { createDefectWorkspace, adoptDefectProposals, defectBase, beginDefectEdit,
  applyDefectMeasurement, markDefectSideInspected, confirmDefectFindings, previewDefectReport } from '../src/defect-actions.mjs';
import { measureDefectWorkspaceEdit } from '../../atlas-measurement-runtime/src/index.mjs';
import { explainAtlasManualReport } from '@atlas/grading-core/manual-report';

const sharp = createRequire(new URL('../../../frontend/atlas-app/package.json', import.meta.url))('sharp');
const hash = value => createHash('sha256').update(value).digest('hex');
const sides = ['FRONT', 'BACK'];
export async function createPerformanceFixture({ pythonExecutable, cardId='11111111-1111-4111-8111-111111111111', imageSeed=0 }) {
  const assets = new Map(), images = {}, initial = structuredClone(focusedFixture().workspace);
  initial.cardId = cardId;
  // Distinct sides, exact known placement, full resolution and deterministic
  // texture. These are synthetic PNGs, not representative production photos.
  for (const [index, side] of sides.entries()) {
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="2400"><rect width="1600" height="2400" fill="#171d23"/><rect x="180" y="250" width="1269" height="1777" fill="#d6bd79"/><rect x="240" y="340" width="1129" height="1607" fill="${index ? '#794533' : '#315973'}"/><text x="310" y="1000" fill="white" font-size="90">SYNTHETIC ${side}</text></svg>`);
    const raw = await sharp(svg).removeAlpha().raw().toBuffer();
    let seed = 1741 + index + imageSeed;
    for (let y = 0; y < 2400; y++) for (let x = 0; x < 1600; x += 4) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const noise = seed >>> 30;
      for (let dx = 0; dx < 4; dx++) for (let c = 0; c < 3; c++) raw[(y * 1600 + x + dx) * 3 + c] = Math.min(255, raw[(y * 1600 + x + dx) * 3 + c] + noise);
    }
    const original = await sharp(raw, { raw: { width: 1600, height: 2400, channels: 3 } }).png().toBuffer();
    const rectified = await sharp(original).extract({ left: 180, top: 250, width: 1270, height: 1778 }).png().toBuffer();
    const inspection = await sharp(rectified).extend({ top: 40, bottom: 40, left: 40, right: 40, background: '#171d23' }).png().toBuffer();
    const register = (bytes, width, height) => {
      const sha256 = hash(bytes), url = `/images/${sha256}`;
      assets.set(url, { bytes, mime: 'image/png' });
      return { url, sha256, byteCount: bytes.length, width, height };
    };
    images[side] = { original: register(original, 1600, 2400), rectified: register(rectified, 1270, 1778), inspection: register(inspection, 1350, 1858) };
    const slot = initial.sides[side];
    let bound = JSON.stringify(slot);
    for (const [before, after] of [[slot.image.originalSha256, images[side].original.sha256],
      [slot.image.frameSha256, images[side].original.sha256],
      [slot.prepared.frame.inspection.sha256, images[side].inspection.sha256],
      [slot.prepared.frame.rectified.sha256, images[side].rectified.sha256]]) bound = bound.replaceAll(before, after);
    initial.sides[side] = JSON.parse(bound);
  }
  const identity = { playerName: 'Synthetic performance fixture', year: '2026', manufacturer: 'Local fixture', productSet: 'No production card' };
  let geometry, defects, revision, actions, approval, publication;
  const reset = () => {
    geometry = structuredClone(initial); revision = 1; actions = []; approval=null;publication=null;
    defects = createDefectWorkspace({ cardId: geometry.cardId, profile: 'SPORTS', sides: Object.fromEntries(sides.map(side => [side, { frame: geometryMeasurementFrame(geometry, side), cornerShape: 'SQUARE' }])) });
    for (const side of sides) defects = adoptDefectProposals(defects, { side, base: defectBase(defects, side), findings: [structuredClone(measurements[side])], source: { method: 'DETECTOR', version: 'synthetic-fixture-only', id: `fixture-${side}` } }).state;
  };
  reset();
  const contentHash = () => hash(JSON.stringify({ geometry, defects, revision, identity }));
  const view = () => structuredClone({ card: { id: geometry.cardId, cardId: geometry.cardId, revision, contentHash: contentHash(), draft: { source: { sourceHash: hash('synthetic-photo-pair') }, identityRevision: 1 } }, geometry, defects, images, identity, approval, publication, astra: { enabled: false }, assistance: { reviews: [] }, finalReview: { reportHash: hash('retained-synthetic-proposal') }, variantVerification: { enabled: false }, provisional: { state: 'READY', report: { findings: sides.flatMap(side => defects.sides[side].findings) } } });
  const preview = () => {
    const report = previewDefectReport(defects, { identity, centeringQuads: Object.fromEntries(sides.map(side => [side, geometry.sides[side].printed.quad])), draftRevision: revision });
    return { report, reportHash: hash(JSON.stringify(report)), sourceRevision: revision, sourceHash: contentHash(), canCertify: true, review: { report, explanation: explainAtlasManualReport(report) } };
  };
  const packet = () => {
    let reviewed = defects;
    for (const side of sides) reviewed = markDefectSideInspected(reviewed, { side, base: defectBase(reviewed, side), actor: 'HUMAN', inspected: true }).state;
    reviewed = confirmDefectFindings(reviewed, { base: Object.fromEntries(sides.map(side => [side, defectBase(reviewed, side)])), actor: 'HUMAN', reviewed: true }).state;
    const full = previewDefectReport(reviewed, { identity, centeringQuads: Object.fromEntries(sides.map(side => [side, geometry.sides[side].printed.quad])), draftRevision: revision });
    const { inspection, ...rest } = full;
    return { reportHash: hash('retained-synthetic-proposal'), images, explanation: explainAtlasManualReport(full),
      report: { ...rest, version: 'atlas-machine-provisional-report-v1', authority: 'MACHINE_PROPOSAL', certification: null, proposedGrade: full.finalGrade, findings: sides.flatMap(side => defects.sides[side].findings), geometry: Object.fromEntries(sides.map(side => [side, { frame: defects.sides[side].frame, centeringQuad: geometry.sides[side].printed.quad }])) } };
  };
  const execute = async action => {
    const request = { ...action, actor: 'HUMAN' }; delete request.type;
    if (action.type === 'CONFIRM_GEOMETRY') geometry = confirmBothGeometry(geometry, request).state;
    else if (action.type === 'INSPECT_SIDE') defects = markDefectSideInspected(defects, request).state;
    else if (action.type === 'CONFIRM_FINDINGS') defects = confirmDefectFindings(defects, request).state;
    else if (action.type === 'DEFECT_EDIT') defects = beginDefectEdit(defects, { side: action.side, base: action.base, actor: 'HUMAN', action: action.edit }).state;
    else if (action.type === 'MEASURE_SIDE') defects = applyDefectMeasurement(defects, await measureDefectWorkspaceEdit({ workspace: defects, side: action.side, pythonExecutable, limits: { maxInputBytes: 8_000_000, maxOutputBytes: 16_000_000, maxFindings: 200, timeoutMs: 30_000 } })).state;
    else throw new Error(`Fixture blocks action ${action.type}`);
    revision++; actions.push(structuredClone(action)); return view();
  };
  const seedPublished=()=>{const report=preview();approval={sourceHash:contentHash(),reportHash:report.reportHash,actionId:'33333333-3333-4333-8333-333333333333'};publication={...approval,state:'PUBLISHED',version:1,publicHash:hash('synthetic-published-report'),href:'/fixture/report',reportNumber:'SYNTHETIC ONLY'};};
  return { assets, images, view, preview, packet, execute, reset, seedPublished, actions: () => structuredClone(actions) };
}
