import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createManualWorkflow } from '../src/workflow.mjs';
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
  await workflow.provision(staff, { geometry: geometry(cardId), identity: { playerName: 'Synthetic Player', year: '2026', manufacturer: 'Fixture', productSet: 'Action test' } });
  const initial = await workflow.hydrate(card), analysisId = randomUUID();
  for (let index = 0; index < 3; index++) {
    const id = `${analysisId}:${index + 1}`, x = .2 + index * .1;
    proposals.set(`${analysisId}:${id}`, { base: defectBase(initial.defects, 'FRONT'), proposal: { id, side: 'FRONT', defectType: 'LIGHT_SCRATCH_SCUFF',
      canonicalContour: [{ x, y: .2 }, { x: x + .02, y: .2 }, { x: x + .02, y: .22 }, { x, y: .22 }],
      observation: 'Synthetic proposal', uncertainty: 'MEDIUM', reviewStatus: 'UNREVIEWED', provenance: { analysisId }, areaMm2: 999999 } });
  }
  Object.assign(f, { workflow, staff, cardId, analysisId, proposals, card: () => clone(card), state: () => workflow.hydrate(card),
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

test('acceptance stages a separate exact trace for measurement, never model-authored area or inspection authority', async () => {
  const f = await fixture(); await f.review(); const state = await f.state(), pending = state.defects.sides.FRONT.pending;
  assert.equal(pending.action.type, 'TRACE_SAVE'); assert.equal(pending.actor, 'HUMAN'); assert.equal(state.defects.sides.FRONT.findings.length, 0);
  assert.equal(state.defects.sides.FRONT.inspection, null); assert.equal(state.defects.confirmation, null); assert.equal(f.measured.length, 0);
  assert.equal(pending.action.trace.areaMm2, undefined); assert.ok(decodeSpeedsterTraceBitmapWireV1(pending.action.trace.traceWire).some(Boolean));
  await f.execute({ type: 'MEASURE_SIDE', side: 'FRONT' }); const measured = await f.state();
  assert.equal(f.measured.length, 1); assert.equal(measured.defects.sides.FRONT.findings.length, 1);
  assert.equal(measured.defects.sides.FRONT.findings[0].finalTrace.sha256, pending.action.trace.traceProvenance.finalTraceSha256);
  assert.notEqual(measured.defects.sides.FRONT.findings[0].measurementRegions[0].measurement.areaMm2, 999999);
  assert.equal(measured.assistance.reviews[0].proposal.areaMm2, 999999, 'original proposal data remains separate from deterministic measured findings');
});

test('a corrected outline and type are staged as exact private trace bytes and retain original proposal provenance', async () => {
  const f = await fixture(), state = await f.state(), trace = traceAction('FRONT', null, [700, 700, 8, 8], 'corrected-trace').trace;
  const action = await f.workflow.stageProposalTrace(f.staff, f.cardId, { side: 'FRONT', base: defectBase(state.defects, 'FRONT'), analysisId: f.analysisId,
    proposalId: `${f.analysisId}:1`, trace });
  assert.equal(action.trace, undefined); assert.ok(action.traceRef.sha256); await f.execute(action); await f.execute({ type: 'MEASURE_SIDE', side: 'FRONT' });
  const saved = await f.state(), finding = saved.defects.sides.FRONT.findings[0];
  assert.equal(finding.defectType, 'VISIBLE_WHITENING'); assert.equal(finding.finalTrace.sha256, trace.traceProvenance.finalTraceSha256);
  assert.equal(saved.assistance.reviews[0].action, 'TRACE_SAVE'); assert.equal(saved.assistance.reviews[0].proposal.defectType, 'LIGHT_SCRATCH_SCUFF');
  assert.equal(saved.assistance.reviews[0].findingId, 'corrected-trace'); assert.equal(saved.assistance.reviews[0].reviewerId, f.staff.id);
});

test('rejecting another proposal preserves measured findings and inspections while requiring a new deliberate confirmation', async () => {
  const f = await fixture(); await f.review(); await f.execute({ type: 'MEASURE_SIDE', side: 'FRONT' }); await f.inspect(); await f.confirm();
  const before = await f.state(); await f.review('REJECT', 2); const after = await f.state();
  assert.deepEqual(after.defects.sides, before.defects.sides); assert.equal(after.defects.confirmation, null);
  assert.equal(f.measured.length, 1); assert.equal(after.assistance.reviews.at(-1).action, 'REJECT'); assert.equal(after.assistance.reviews.at(-1).findingId, null);
});

test('stale frame, original source and current action base are refused without a committed change', async () => {
  for (const mutate of [resolved => { resolved.base.frame.frameId = 'older-frame'; }, resolved => { resolved.base.frame.originalSha256 = hash('9'); },
    resolved => { resolved.base.cornerShape = 'ROUNDED_3_18_MM'; }]) {
    const f = await fixture(), before = f.card(); f.resolve = resolved => { mutate(resolved); return resolved; };
    await assert.rejects(f.review(), { code: 'MANUAL_PROPOSAL_STALE' }); assert.deepEqual(f.card(), before);
  }
  const f = await fixture(), state = await f.state(), stale = defectBase(state.defects, 'FRONT'); await f.inspect();
  await assert.rejects(f.review('REJECT', 1, { base: stale }), { code: 'MANUAL_PROPOSAL_STALE' });
});

test('sequential adoption uses the latest manual base without invalidating unchanged-frame proposals and rejects duplicate reviews', async () => {
  const f = await fixture(); await f.review(); await f.execute({ type: 'MEASURE_SIDE', side: 'FRONT' });
  const first = (await f.state()).defects.sides.FRONT.findings[0];
  await f.review('ACCEPT', 2); await f.execute({ type: 'MEASURE_SIDE', side: 'FRONT' }); const after = await f.state();
  assert.equal(after.defects.sides.FRONT.findings.length, 2); assert.deepEqual(after.defects.sides.FRONT.findings[0], first);
  assert.notEqual(after.assistance.reviews[0].base.findingRevision, after.assistance.reviews[1].base.findingRevision);
  const before = f.card(); await assert.rejects(f.review('REJECT', 1), { code: 'MANUAL_PROPOSAL_ALREADY_REVIEWED' }); assert.deepEqual(f.card(), before);
});

test('discarding a pending proposal change removes only its provisional review so it can be reviewed again', async () => {
  const f = await fixture(); await f.review('REJECT', 2); await f.review('ACCEPT', 1);
  const pending = await f.state(); await f.execute({ type: 'DISCARD_PENDING', side: 'FRONT', base: defectBase(pending.defects, 'FRONT') });
  const discarded = await f.state(); assert.equal(discarded.defects.sides.FRONT.pending, null); assert.equal(discarded.defects.sides.FRONT.findings.length, 0);
  assert.equal(discarded.assistance.reviews.length, 1); assert.equal(discarded.assistance.reviews[0].proposalId, `${f.analysisId}:2`);
  await f.review('ACCEPT', 1); assert.equal((await f.state()).assistance.reviews.length, 2);
});

test('confirmation commits before publication; failed publication and exact save replay preserve one durable review', async () => {
  const f = await fixture(); await f.inspect(); f.publisher = async () => { throw Error('synthetic publication failure'); };
  const { command } = await f.confirm(), saved = f.card(), commits = f.commits.length;
  assert.ok((await f.state()).defects.confirmation); assert.deepEqual(f.publications, [command.actionId]);
  f.publisher = async () => {};
  await f.workflow.service.execute(f.staff, f.cardId, command);
  assert.equal(f.commits.length, commits); assert.deepEqual(f.card(), saved); assert.deepEqual(f.publications, [command.actionId, command.actionId]);
});

test('forged human or measurement fields fail the public action before proposal resolution', async () => {
  const f = await fixture(); let resolved = 0; f.resolve = value => { resolved++; return value; };
  await assert.rejects(f.review('ACCEPT', 1, { actor: 'HUMAN' }), { code: 'MANUAL_CLIENT_AUTHORITY_FORBIDDEN' });
  await assert.rejects(f.review('ACCEPT', 1, { areaMm2: 50 }), { code: 'MANUAL_REQUEST_INVALID' });
  assert.equal(resolved, 0); assert.equal(f.commits.length, 0);
});
