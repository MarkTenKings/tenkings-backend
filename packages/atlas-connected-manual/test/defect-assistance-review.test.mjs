import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createManualWorkflow } from '../../atlas-manual-workflow/src/workflow.mjs';
import { createManualArtifactStore } from '../../atlas-manual-service/src/artifacts.mjs';
import { canonical, digest, inputCommand, requireThat, stateDocument } from '../../atlas-manual-service/src/contract.mjs';
import { createGeometryWorkspace, applyGeometryEdit, applyPreparedFrame, confirmBothGeometry, geometryBase, preparationBase } from '../../atlas-manual-workspace/src/geometry-actions.mjs';
import { defectBase, runDefectMeasurement } from '../../atlas-manual-workspace/src/defect-actions.mjs';
import { traceAction } from '../../atlas-manual-workspace/test/defect-fixtures.mjs';
import { decodeSpeedsterTraceBitmapWireV1 } from '@atlas/grading-core/trace-bitmap-wire';
import { decodeSpeedsterTraceRleV1 } from '@atlas/grading-core/trace-codec';

const SIDES = ['FRONT', 'BACK'], hash = letter => letter.repeat(64), clone = value => structuredClone(value);
const physical = [{ x: .125, y: .1 }, { x: .875, y: .1 }, { x: .875, y: .9 }, { x: .125, y: .9 }];
const printed = [{ x: .04, y: .06 }, { x: .94, y: .06 }, { x: .94, y: .96 }, { x: .04, y: .96 }];
function geometry(cardId) {
  let state = createGeometryWorkspace({ cardId, profile: 'SPORTS', sides: Object.fromEntries(SIDES.map((side, i) => [side, {
    image: { version: 1, originalSha256: hash(i ? 'a' : 'b'), frameId: `${side}-decoded`, frameSha256: hash(i ? 'c' : 'd'),
      width: 1600, height: 2400, coordinateSpace: 'ORIENTED_DECODED' }, cornerShape: 'SQUARE', matColor: 'BLACK',
  }])) });
  for (const side of SIDES) {
    state = applyGeometryEdit(state, { side, kind: 'PHYSICAL', base: geometryBase(state, side, 'PHYSICAL'), quad: physical, actor: 'HUMAN', proposal: null }).state;
    const sx = 1269 / 1200, sy = 1777 / 1920;
    state = applyPreparedFrame(state, { side, base: preparationBase(state, side), frame: { id: `${side}-prepared`, version: 1,
      rectified: { sha256: hash(side === 'FRONT' ? 'e' : 'f'), width: 1270, height: 1778 },
      inspection: { sha256: hash(side === 'FRONT' ? '1' : '2'), width: 1350, height: 1858, cardBounds: { x: 40, y: 40, width: 1270, height: 1778 } },
      sourceToRectified: [sx, 0, -200 * sx, 0, sy, -240 * sy, 0, 0, 1],
    } }).state;
    state = applyGeometryEdit(state, { side, kind: 'PRINTED', base: geometryBase(state, side, 'PRINTED'), quad: printed, actor: 'HUMAN', proposal: null }).state;
  }
  return confirmBothGeometry(state, { actor: 'HUMAN', reviewed: true, base: Object.fromEntries(SIDES.map(side => [side, geometryBase(state, side, 'REVIEW')])) }).state;
}
async function fixture() {
  const cardId = randomUUID(), staff = { id: randomUUID() }, principal = { id: staff.id, canCertify: true };
  let card;
  const commands = new Map(), objects = new Map(), proposals = new Map(), f = { commits: [], measured: [], publications: [], publisher: async () => {}, resolve: null };
  const authorize = (actor, id) => { requireThat(actor === staff && id === cardId, 403, 'SYNTHETIC_ACCESS_DENIED'); };
  const repository = {
    async provision(actor, input) { authorize(actor, input.cardId); const document = stateDocument(input.draft);
      card = { cardId, revision: 1, contentHash: document.hash, draft: document.draft }; return clone(card); },
    async load(actor, id) { authorize(actor, id); return { card: clone(card), principal: clone(principal) }; },
    async authorizeEdit(actor, id) { return this.load(actor, id); },
    async findAction(actor, id, command) { authorize(actor, id); const prior = commands.get(command.actionId); if (!prior) return null;
      requireThat(prior.requestHash === inputCommand(command).requestHash, 409, 'MANUAL_ACTION_CONFLICT'); return clone(prior.result); },
    async commit(actor, input) { authorize(actor, input.cardId);
      requireThat(input.input.expectedRevision === card.revision && input.baseHash === card.contentHash, 409, 'MANUAL_DRAFT_STALE');
      const document = stateDocument(input.draft); card = { ...card, revision: card.revision + 1, draft: document.draft, contentHash: document.hash };
      const result = { card: clone(card), actionId: input.input.actionId };
      commands.set(input.input.actionId, { requestHash: inputCommand(input.input).requestHash, result }); f.commits.push(clone(input)); return clone(result);
    },
  };
  const artifacts = createManualArtifactStore({ transport: {
    async putIfAbsent({ key, bytes, contentType, lineageSha256 }) { if (objects.has(key)) throw Error('immutable existing object'); objects.set(key, { bytes: Buffer.from(bytes), contentType, lineageSha256 }); },
    async read({ key }) { return objects.get(key); },
  } });
  const workflow = createManualWorkflow({ repository, artifacts,
    resolveProposal: async ({ staff: actor, card: current, analysisId, proposalId }) => { authorize(actor, current.cardId); const found = proposals.get(`${analysisId}:${proposalId}`);
      requireThat(found, 404, 'MANUAL_PROPOSAL_NOT_FOUND'); return f.resolve ? f.resolve(clone(found)) : clone(found); },
    // A synthetic measured-result adapter isolates action/persistence behavior.
    // Actual CPU geometry and optical accuracy are tested by runtime suites.
    measure: async ({ workspace, side }) => runDefectMeasurement(workspace, side, async input => {
      f.measured.push(clone(input)); const ids = new Set(input.marks.map(mark => mark.id));
      return { receipt: { fixture: 'synthetic-measurement-only' }, defects: [...input.findings.filter(finding => !ids.has(finding.id)), ...input.marks.map(mark => {
        const count = decodeSpeedsterTraceRleV1(mark.finalTrace).reduce((sum, pixel) => sum + pixel, 0);
        return { ...mark, side, origin: 'SMART_MARK', confidence: 1, supportingViewIds: [], reviewResult: 'SMART_MARKED',
          measurementRegions: [{ zone: 'SURFACE', canonicalContour: printed, measurement: { pixelCount: count,
            widthMm: 1, heightMm: 1, areaMm2: count * .0025, zonePercent: .01, multiplier: 1, weightedAreaMm2: count * .0025, subgradeEffect: 0 } }] };
      })] };
    }),
    afterConfirm: async (actor, id, actionId) => { authorize(actor, id); assert.ok(commands.has(actionId), 'publication starts only after actual commit');
      f.publications.push(actionId); return f.publisher(actionId); },
  });
  await workflow.provision(staff, { geometry: geometry(cardId), identity: { playerName: 'Synthetic Player', year: '2026', manufacturer: 'Fixture', productSet: 'Action test' }, source: { sourceHash: digest('independent-synthetic-source') } });
  const initial = await workflow.hydrate(card), analysisId = randomUUID();
  for (let index = 0; index < 3; index++) {
    const id = `${analysisId}:${index + 1}`, x = .2 + index * .1;
    proposals.set(`${analysisId}:${id}`, { base: defectBase(initial.defects, 'FRONT'), proposal: { id, side: 'FRONT', defectType: 'LIGHT_SCRATCH_SCUFF',
      canonicalContour: [{ x, y: .2 }, { x: x + .02, y: .2 }, { x: x + .02, y: .22 }, { x, y: .22 }],
      observation: 'Synthetic proposal', uncertainty: 'MEDIUM', reviewStatus: 'UNREVIEWED', provenance: { analysisId }, areaMm2: 999999 } });
  }
  Object.assign(f, { workflow, staff, cardId, analysisId, proposals, artifacts, card: () => clone(card), state: () => workflow.hydrate(card),
    execute: (action, actionId = randomUUID()) => workflow.service.execute(staff, cardId, { actionId, expectedRevision: card.revision, action }),
    async review(action = 'ACCEPT', index = 1, extra = {}) { const state = await f.state(); return f.execute({ type: 'ASTRA_PROPOSAL_REVIEW', side: 'FRONT',
      base: defectBase(state.defects, 'FRONT'), analysisId, proposalId: `${analysisId}:${index}`, action, ...extra }); },
    async inspect() { for (const side of SIDES) { const state = await f.state(); await f.execute({ type: 'INSPECT_SIDE', side, base: defectBase(state.defects, side), inspected: true }); } },
    async confirm(actionId = randomUUID()) { const state = await f.state(); const command = { actionId, expectedRevision: card.revision,
      action: { type: 'CONFIRM_FINDINGS', reviewed: true, base: Object.fromEntries(SIDES.map(side => [side, defectBase(state.defects, side)])) } };
      return { result: await workflow.service.execute(staff, cardId, command), command }; },
  });
  return f;
}

import { proposalRle } from '../../atlas-manual-workflow/src/proposal-review.mjs';
import { buildReviewedLessons } from '../../atlas-defect-memory/src/lessons.mjs';
import { fixtures as memoryFixtures } from '../../atlas-defect-memory/test/fixtures.mjs';

// Independent regression fixture copied from the workflow's synthetic harness.
// These checks execute the current source and immutable artifact store, while
// replacing only repository/measurement/exemplar effects; no provider or DB.
async function stageExistingTrace(f, finding) {
  const state = await f.state();
  const trace = traceAction('FRONT', finding.id, [740, 720, 11, 9]).trace;
  const action = await f.workflow.stageTrace(f.staff, f.cardId, { side: 'FRONT', base: defectBase(state.defects, 'FRONT'),
    findingId: finding.id, trace });
  await f.execute(action); return trace;
}

test('discarding a later trace edit retains the already committed Astra proposal review and measured finding', async () => {
  const f = await fixture(); await f.review(); await f.execute({ type: 'MEASURE_SIDE', side: 'FRONT' });
  const before = await f.state(), finding = before.defects.sides.FRONT.findings[0];
  await stageExistingTrace(f, finding);
  const pending = await f.state();
  await f.execute({ type: 'DISCARD_PENDING', side: 'FRONT', base: defectBase(pending.defects, 'FRONT') });
  const after = await f.state();
  assert.deepEqual(after.defects.sides.FRONT.findings, before.defects.sides.FRONT.findings);
  assert.deepEqual(after.assistance.reviews, before.assistance.reviews,
    'Discarding an edit to an existing finding must retain its original committed proposal adoption');
});

test('a later corrected Astra outline publishes a CORRECTED lesson with its original proposal provenance', async () => {
  const f = await fixture(); await f.review(); await f.execute({ type: 'MEASURE_SIDE', side: 'FRONT' });
  const before = await f.state(), finding = before.defects.sides.FRONT.findings[0];
  const trace = await stageExistingTrace(f, finding); await f.execute({ type: 'MEASURE_SIDE', side: 'FRONT' });
  await f.inspect(); await f.confirm();
  const state = await f.state(), exemplars = memoryFixtures({ cardId: f.cardId });
  assert.notEqual(state.defects.sides.FRONT.findings[0].finalTrace.sha256, finding.finalTrace.sha256);
  const bundle = await buildReviewedLessons({ confirmation: { actionId: randomUUID(), actorId: f.staff.id, card: f.card() },
    staff: f.staff, hydrate: f.workflow.hydrate, createExemplar: exemplars.createExemplar, proposalTrace: proposalRle });
  const lesson = bundle.lessons.find(value => value.findingId === finding.id);
  assert.equal(lesson.exemplar.trace.sha256, trace.traceProvenance.finalTraceSha256);
  assert.equal(lesson.proposalReview.action, 'ACCEPT', 'The original adoption remains immutable provenance');
  assert.equal(lesson.disposition, 'CORRECTED', 'Final reviewed trace differs from the accepted proposal outline');
});

import { createDefectAssistance, defectAnalysisBinding } from '../src/defect-assistance.mjs';
import { buildAstraDefectRequest, parseAstraResponse } from '../../atlas-defect-analysis/src/index.mjs';
import { inputFixture, responseFixture } from '../../atlas-defect-analysis/test/fixtures.mjs';

async function savedAnalysisFixture() {
  const f = await fixture(), initial = f.card(), state = await f.state(), input = inputFixture();
  input.analysisId = f.analysisId; input.cardId = f.cardId; input.binding = defectAnalysisBinding(initial, state);
  for (const slot of input.images) slot.whole.sourceSha256 = input.binding.sides[slot.side].frame.inspectionImageSha256;
  const prepared = buildAstraDefectRequest(input), raw = Buffer.from(JSON.stringify(responseFixture(prepared.evidence)));
  const parsed = parseAstraResponse(raw, prepared.evidence), source = { cardId: f.cardId, sourceHash: prepared.evidence.sourceBindingSha256 };
  const responseRef = await f.artifacts.write({ version: 1, analysisId: f.analysisId, requestHash: prepared.requestHash,
    sha256: digest(raw), base64: raw.toString('base64') }, { ...source, kind: 'DEFECT_RESPONSE' });
  const resultRef = await f.artifacts.write(parsed.result, { ...source, kind: 'DEFECT_RESULT' });
  const provider = { bindingHash: digest('offline-review-provider'), dispatch: async () => { throw Error('No provider dispatch permitted'); } };
  const evidence = canonical({ ...prepared.evidence, providerBindingHash: provider.bindingHash });
  const row = { id: f.analysisId, card_id: f.cardId, action_id: f.analysisId, actor_id: f.staff.id,
    binding: canonical(prepared.evidence.binding), binding_hash: digest(canonical(prepared.evidence.binding)),
    request_hash: prepared.requestHash, request_ref: JSON.stringify(responseRef), request_evidence: evidence, evidence_hash: digest(evidence),
    base_hash: digest(canonical(Object.fromEntries(SIDES.map(side => [side, defectBase(state.defects, side)])))), state: 'DISPATCHED', created_at: new Date(), expires_at: new Date(Date.now()+120000), dispatched_at: new Date() };
  const receipt = { state: 'READY', responseRef, resultRef, responseHash: digest(raw), providerRequestId: 'offline-review-request',
    responseId: parsed.responseId, httpStatus: 200, usage: parsed.usage, code: null };
  const principal = { id: f.staff.id, role: 'REVIEWER' };
  const tx = { async $queryRawUnsafe(sql) {
    if (sql.includes('FROM atlas_defect_analysis.request_refusal')) return [];
    if (sql.includes('FROM atlas_manual.card')) { const current = f.card(); return [{ id: f.cardId, owner_id: f.staff.id, editors: [], readers: [], approvers: [],
      revision: current.revision, content: canonical(current.draft), content_hash: current.contentHash }]; }
    if (sql.includes('FROM atlas_defect_analysis.run')) return [row];
    if (sql.includes('FROM atlas_defect_analysis.receipt')) return row.state === 'PREPARED' ? [] : [{ kind: 'RESPONSE', evidence: canonical(receipt), recorded_at: new Date() }];
    throw Error(`Unrecognized offline query: ${sql}`);
  } };
  const boundary = { transaction: async (_staff, work) => work({ tx, principal, now: new Date(), refresh: async () => ({ principal, now: new Date() }) }) };
  const assistance = createDefectAssistance({ boundary, intakeRepository: { assertCurrentPair: async () => {} }, workflow: f.workflow,
    artifacts: f.artifacts, imageEffects: { createExemplar: async () => { throw Error('No exemplar effect permitted'); } },
    memoryEnabled: true, provider, receiptClient: tx });
  return { ...f, assistance, prepared, parsed, row };
}

test('identity correction invalidates proposals informed by the old design memory while preserving raw receipts', async () => {
  const f = await savedAnalysisFixture();
  assert.equal((await f.assistance.status(f.staff, f.cardId, f.analysisId)).astra.status, 'READY');
  await f.execute({ type: 'IDENTITY_EDIT', identity: { ...f.card().draft.identity, productSet: 'Corrected unrelated set' } });
  const current = await f.assistance.status(f.staff, f.cardId, f.analysisId);
  assert.equal(current.astra.status, 'STALE', 'Old design-memory context must not remain adoptable after an identity correction');
  await assert.rejects(f.assistance.resolveProposal({ staff: f.staff, card: f.card(), analysisId: f.analysisId,
    proposalId: f.parsed.result.proposals[0].id }), { code: 'MANUAL_PROPOSAL_STALE' });
  const retained = await f.assistance.executor.readResult(f.staff, { cardId: f.cardId, analysisId: f.analysisId });
  assert.deepEqual(retained.result, f.parsed.result, 'Staleness never deletes or rewrites the original result');
});

test('expired never-dispatched PREPARED requests remain exactly resumable for terminal refusal', async () => {
  const f = await savedAnalysisFixture();
  f.row.state = 'PREPARED'; f.row.dispatched_at = null; f.row.created_at = new Date(Date.now() - 180001); f.row.expires_at = new Date(Date.now() - 1);
  const result = await f.assistance.status(f.staff, f.cardId, f.analysisId);
  assert.equal(result.state, 'PREPARED', 'Expiry cannot erase the distinction between never-dispatched and uncertain paid work');
  assert.equal(result.astra.resumeAvailable, true, 'The saved command must remain reachable for durable retirement');
  assert.deepEqual(result.astra.proposals, []);
});
