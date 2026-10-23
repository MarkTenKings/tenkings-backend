import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createManualWorkflow } from '../src/workflow.mjs';
import { createManualArtifactStore } from '../../atlas-manual-service/src/artifacts.mjs';
import { canonical, digest, inputCommand, requireThat, stateDocument } from '../../atlas-manual-service/src/contract.mjs';
import { createGeometryWorkspace, replaceGeometryImage, applyGeometryEdit, applyPreparedFrame, confirmBothGeometry, geometryBase, preparationBase } from '../../atlas-manual-workspace/src/geometry-actions.mjs';
import { defectBase, reviewedDefectFindingIds, runDefectMeasurement } from '../../atlas-manual-workspace/src/defect-actions.mjs';
import { traceAction } from '../../atlas-manual-workspace/test/defect-fixtures.mjs';
import { decodeSpeedsterTraceBitmapWireV1 } from '@atlas/grading-core/trace-bitmap-wire';
import { decodeSpeedsterTraceRleV1 } from '@atlas/grading-core/trace-codec';
import { ATLAS_FINAL_GRADE_POLICY, ATLAS_HALF_POINT_FINAL_GRADE_POLICY, calculateAtlasFinalGrade } from '@atlas/grading-core/manual-report';
import { emptyAtlasSportsAttributes, atlasPrintedSerial } from '@atlas/grading-core/identity';

const SIDES = ['FRONT', 'BACK'], hash = letter => letter.repeat(64), clone = value => structuredClone(value);
const physical = [{ x: .125, y: .1 }, { x: .875, y: .1 }, { x: .875, y: .9 }, { x: .125, y: .9 }];
test('reviewed sports attributes save through the real identity action while measurements stay exact', async () => {
  const f = await fixture(), before = await f.state(), original = f.card(), attributes = emptyAtlasSportsAttributes();
  attributes.serial = { presence: 'PRESENT', ...atlasPrintedSerial('007/099'), evidence: [{ side: 'BACK', imageSha256: before.geometry.sides.BACK.image.originalSha256, observation: 'Back lower edge: 007/099.' }] };
  attributes.specialFeatures = [{ kind: 'CASE_HIT', evidence: { type: 'REVIEWED_REFERENCE', sourceTitle: 'Synthetic checklist', sourceUrl: 'https://example.com/checklist', matchNote: 'The exact card and printing match the listed case hit.' } }];
  const identity = { ...original.draft.identity, sportsAttributes: attributes };
  await f.execute({ type: 'IDENTITY_EDIT', identity });
  assert.deepEqual(f.card().draft.identity, identity); assert.equal(f.card().draft.identityRevision, original.draft.identityRevision + 1);
  const after = await f.state(); assert.deepEqual(after.geometry, before.geometry); assert.deepEqual(after.defects, before.defects);
  assert.equal(f.measured.length, 0); assert.equal(f.publications.length, 0);
  assert.deepEqual(f.commits.at(-1).input.action.identity.sportsAttributes.specialFeatures, attributes.specialFeatures);
  const saved = f.card(); identity.sportsAttributes.serial.evidence[0].imageSha256 = hash('f');
  await assert.rejects(f.execute({ type: 'IDENTITY_EDIT', identity }), { code: 'MANUAL_IDENTITY_PHOTO_STALE' });
  assert.deepEqual(f.card(), saved);
});
test('machine proposals cannot acquire reviewed sports identity through the human action', async () => {
  const f = await fixture({ actorKind: 'MACHINE' }), before = f.card();
  await assert.rejects(f.execute({ type: 'IDENTITY_EDIT', identity: { ...before.draft.identity, sportsAttributes: emptyAtlasSportsAttributes() } }), { code: 'MANUAL_HUMAN_REQUIRED' });
  assert.deepEqual(f.card(), before);
});
test('reference-only special features use the ordinary identity action without manufacturing photographed facts', async () => {
  const f = await fixture(), before = f.card(), attributes = emptyAtlasSportsAttributes();
  attributes.specialFeatures = [{ kind: 'SHORT_PRINT', evidence: { type: 'REVIEWED_REFERENCE', sourceTitle: 'Synthetic short-print checklist', sourceUrl: 'https://example.com/checklist', matchNote: 'Card 7 in the exact saved printing is listed as SP.' } }];
  await f.execute({ type: 'IDENTITY_EDIT', identity: { ...before.draft.identity, sportsAttributes: attributes } });
  assert.deepEqual(f.card().draft.identity.sportsAttributes, attributes);
  assert.deepEqual(f.card().draft.geometry, before.draft.geometry); assert.deepEqual(f.card().draft.defects, before.draft.defects);
  assert.equal(f.publications.length, 0); assert.equal(f.measured.length, 0);
});
const printed = [{ x: .04, y: .06 }, { x: .94, y: .06 }, { x: .94, y: .96 }, { x: .04, y: .96 }];
function geometry(cardId, printedQuad = printed) {
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
    state = applyGeometryEdit(state, { side, kind: 'PRINTED', base: geometryBase(state, side, 'PRINTED'), quad: printedQuad, actor: 'HUMAN', proposal: null }).state;
  }
  return confirmBothGeometry(state, { actor: 'HUMAN', reviewed: true, base: Object.fromEntries(SIDES.map(side => [side, geometryBase(state, side, 'REVIEW')])) }).state;
}
async function fixture({resolveVariantConfirmation=null,actorKind=null,printedQuad=printed,replaceSources=null}={}) {
  const cardId = randomUUID(), staff = { id: randomUUID() }, principal = { id: staff.id, canCertify: true, ...(actorKind?{actorKind}:{}) };
  let card;
  const commands = new Map(), objects = new Map(), proposals = new Map(), f = { commits: [], measured: [], publications: [], publisher: async () => {}, resolve: null,
    artifactPuts: [], artifactGets: [], corruptNextWrite: false, corruptKey: null };
  const authorize = (actor, id) => { requireThat(!f.accessRevoked && actor === staff && id === cardId, 403, 'SYNTHETIC_ACCESS_DENIED'); };
  const repository = {
    async provision(actor, input) { authorize(actor, input.cardId); const document = stateDocument(input.draft);
      card = { cardId, revision: 1, contentHash: document.hash, draft: document.draft }; return clone(card); },
    async load(actor, id) { authorize(actor, id); return { card: clone(card), principal: clone(principal) }; },
    async latestApproval(actor, id) { authorize(actor, id); return clone(f.approval ?? null); },
    async authorizeEdit(actor, id) { return this.load(actor, id); },
    async findAction(actor, id, command) { authorize(actor, id); const prior = commands.get(command.actionId); if (!prior) return null;
      requireThat(prior.requestHash === inputCommand(command).requestHash, 409, 'MANUAL_ACTION_CONFLICT'); return clone(prior.result); },
    async commit(actor, input) { authorize(actor, input.cardId);
      requireThat(input.input.expectedRevision === card.revision && input.baseHash === card.contentHash, 409, 'MANUAL_DRAFT_STALE');
      if (input.approval) f.approval = { actionId: input.input.actionId, sourceRevision: card.revision,
        sourceHash: card.contentHash, reportHash: stateDocument(input.approval).hash, report: clone(input.approval) };
      const document = stateDocument(input.draft); card = { ...card, revision: card.revision + 1, draft: document.draft, contentHash: document.hash };
      const result = { card: clone(card), actionId: input.input.actionId };
      commands.set(input.input.actionId, { requestHash: inputCommand(input.input).requestHash, result }); f.commits.push(clone(input));
      if (f.loseReply) { f.loseReply = false; throw Error('reply lost after durable commit'); }
      return clone(result);
    },
  };
  const artifacts = createManualArtifactStore({ transport: {
    async putIfAbsent({ key, bytes, contentType, lineageSha256 }) { f.artifactPuts.push(key); if (objects.has(key)) throw Error('immutable existing object');
      objects.set(key, { bytes: Buffer.from(bytes), contentType, lineageSha256 }); if (f.corruptNextWrite) f.corruptKey = key; },
    async read({ key }) { f.artifactGets.push(key); if (f.onArtifactRead) await f.onArtifactRead(key);
      return key === f.corruptKey ? { ...objects.get(key), bytes: Buffer.from('corrupt') } : objects.get(key); },
  } });
  const workflow = createManualWorkflow({ repository, artifacts, resolveVariantConfirmation, replaceSources,
    assertCurrent: async () => { requireThat(!f.photosChanged, 409, 'MANUAL_PHOTOS_CHANGED'); },
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
  await workflow.provision(staff, { geometry: geometry(cardId, printedQuad), identity: { playerName: 'Synthetic Player', year: '2026', manufacturer: 'Fixture', productSet: 'Action test' } });
  const initial = await workflow.hydrate(card), analysisId = randomUUID();
  for (let index = 0; index < 3; index++) {
    const id = `${analysisId}:${index + 1}`, x = .2 + index * .1;
    proposals.set(`${analysisId}:${id}`, { base: defectBase(initial.defects, 'FRONT'), proposal: { id, side: 'FRONT', defectType: 'LIGHT_SCRATCH_SCUFF',
      canonicalContour: [{ x, y: .2 }, { x: x + .02, y: .2 }, { x: x + .02, y: .22 }, { x, y: .22 }],
      observation: 'Synthetic proposal', uncertainty: 'MEDIUM', reviewStatus: 'UNREVIEWED', provenance: { analysisId }, areaMm2: 999999 } });
  }
  Object.assign(f, { workflow, artifacts, staff, cardId, analysisId, proposals, card: () => clone(card), state: () => workflow.hydrate(card),
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

async function historicalApprovalFixture() {
  // Identical measured category arithmetic yields raw 8.35: old award 8.5,
  // current award 8. No provider, production record or historical rewrite.
  const f = await fixture({ printedQuad: [{ x: .088, y: .04 }, { x: .988, y: .04 }, { x: .988, y: .96 }, { x: .088, y: .96 }] });
  await f.inspect(); await f.confirm();
  const current = await f.workflow.service.previewReport(f.staff, f.cardId), full = clone(current.review.report);
  full.finalGradePolicy = ATLAS_HALF_POINT_FINAL_GRADE_POLICY;
  full.finalGrade = calculateAtlasFinalGrade(full.grade.overall.rawGrade, full.finalGradePolicy);
  const sourceHash = digest(JSON.stringify(full));
  const report = { ...current.report, report: { ref: await f.artifacts.write(full, { cardId: f.cardId, kind: 'REPORT', sourceHash }), sourceHash },
    finalGrade: full.finalGrade, finalGradePolicy: full.finalGradePolicy };
  f.approval = { actionId: randomUUID(), sourceRevision: f.card().revision, sourceHash: f.card().contentHash,
    reportHash: stateDocument(report).hash, report };
  return { f, current, full };
}

test('unchanged historical approval opens the original full report, compact hash and half award without writing a new artifact', async () => {
  const { f, current, full } = await historicalApprovalFixture(), before = clone(f.approval), card = f.card(), writes = f.artifactPuts.length;
  assert.ok(Math.abs(full.grade.overall.rawGrade - 8.35) < 1e-12);
  assert.equal(full.finalGrade, 8.5); assert.equal(current.report.finalGrade, 8);
  const preview = await f.workflow.service.previewReport(f.staff, f.cardId);
  assert.equal(preview.reportHash, before.reportHash); assert.deepEqual(preview.report, before.report);
  assert.deepEqual(preview.review.report, full); assert.equal(preview.review.explanation.overall.finalGrade, 8.5);
  assert.equal(preview.sourceHash, card.contentHash); assert.equal(preview.sourceRevision, card.revision);
  assert.equal(f.artifactPuts.length, writes); assert.deepEqual(f.approval, before); assert.deepEqual(f.card(), card);
  // A deliberate source correction creates a fresh current-policy preview;
  // the saved historical approval and its artifact are retained unchanged.
  await f.execute({ type: 'IDENTITY_EDIT', identity: { ...card.draft.identity, playerName: 'Corrected identity' } });
  const corrected = await f.workflow.service.previewReport(f.staff, f.cardId);
  assert.equal(corrected.report.finalGradePolicy, ATLAS_FINAL_GRADE_POLICY); assert.equal(corrected.report.finalGrade, 8);
  assert.notEqual(corrected.reportHash, before.reportHash); assert.deepEqual(f.approval, before);
});

test('saved approval viewing still refuses corrupt compact/full evidence, changed photos, revoked access and concurrent edits', async () => {
  for (const scenario of ['compact', 'artifact', 'images', 'photos', 'access', 'edit']) {
    const { f, full } = await historicalApprovalFixture();
    let code;
    if (scenario === 'compact') {
      f.approval.report.finalGrade = 9;
      f.approval.reportHash = stateDocument(f.approval.report).hash; code = 'MANUAL_APPROVED_REPORT_INVALID';
    } else if (scenario === 'artifact') {
      f.corruptKey = f.approval.report.report.ref.key; code = 'MANUAL_ARTIFACT_UNVERIFIED';
    } else if (scenario === 'images') {
      const changed = clone(full); changed.inspection.front.imageSha256 = 'f'.repeat(64);
      const sourceHash = digest(JSON.stringify(changed));
      f.approval.report.report = { ref: await f.artifacts.write(changed, { cardId: f.cardId, kind: 'REPORT', sourceHash }), sourceHash };
      f.approval.reportHash = stateDocument(f.approval.report).hash; code = 'MANUAL_APPROVED_REPORT_IMAGE_MISMATCH';
    } else if (scenario === 'photos') { f.photosChanged = true; code = 'MANUAL_PHOTOS_CHANGED'; }
    else if (scenario === 'access') {
      f.onArtifactRead = () => { f.accessRevoked = true; }; code = 'SYNTHETIC_ACCESS_DENIED';
    } else {
      f.onArtifactRead = async () => { f.onArtifactRead = null;
        await f.execute({ type: 'IDENTITY_EDIT', identity: { ...f.card().draft.identity, playerName: 'Concurrent correction' } }); };
      code = 'MANUAL_DRAFT_STALE';
    }
    await assert.rejects(f.workflow.service.previewReport(f.staff, f.cardId), { code }, scenario);
  }
});

test('an uncommitted old-policy preview cannot approve after cutover and a committed current approval survives a lost reply once', async () => {
  const { f, current } = await historicalApprovalFixture(), oldHash = f.approval.reportHash, before = f.commits.length;
  f.approval = null;
  const stale = { actionId: randomUUID(), expectedRevision: f.card().revision,
    action: { type: 'APPROVE_REPORT', reviewed: true, reportHash: oldHash } };
  await assert.rejects(f.workflow.service.execute(f.staff, f.cardId, stale), { code: 'MANUAL_REPORT_STALE' });
  assert.equal(f.commits.length, before); assert.equal(f.approval, null);
  const command = { ...stale, actionId: randomUUID(), action: { ...stale.action, reportHash: current.reportHash } };
  f.loseReply = true;
  await assert.rejects(f.workflow.service.execute(f.staff, f.cardId, command), /reply lost after durable commit/);
  const approval = clone(f.approval), writes = f.artifactPuts.length;
  const replay = await f.workflow.service.execute(f.staff, f.cardId, command);
  assert.equal(replay.actionId, command.actionId); assert.equal(f.commits.length, before + 1);
  assert.equal(f.artifactPuts.length, writes); assert.deepEqual(f.approval, approval);
  assert.equal(approval.report.finalGrade, 8); assert.equal(approval.report.finalGradePolicy, ATLAS_FINAL_GRADE_POLICY);
});

test('identity-only saves retain verified geometry/defect refs without repeat PUT/readback and preserve exact replay', async () => {
  const f = await fixture(), before = f.card(); f.artifactPuts.length = 0; f.artifactGets.length = 0;
  const command = { actionId: randomUUID(), expectedRevision: before.revision,
    action: { type: 'IDENTITY_EDIT', identity: { ...before.draft.identity, playerName: 'Reviewed name' } } };
  const result = await f.workflow.service.execute(f.staff, f.cardId, command);
  assert.deepEqual(result.card.draft.geometry, before.draft.geometry); assert.deepEqual(result.card.draft.defects, before.draft.defects);
  assert.equal(f.artifactPuts.length, 0); assert.equal(f.artifactGets.length, 2, 'both reused objects are still verified before the action');
  assert.equal(result.card.revision, before.revision + 1);
  assert.deepEqual(await f.workflow.service.execute(f.staff, f.cardId, command), result);
  assert.equal(f.commits.length, 1); assert.equal(f.artifactGets.length, 2);
  await assert.rejects(f.workflow.service.execute(f.staff, f.cardId, { ...command, actionId: randomUUID() }), { code: 'MANUAL_DRAFT_STALE' });
  assert.equal(f.artifactPuts.length, 0);
});

test('inspection saves write and verify only changed defects; tampered readback commits nothing', async () => {
  const f = await fixture(), state = await f.state(), before = f.card(); f.artifactPuts.length = 0; f.artifactGets.length = 0;
  await f.execute({ type: 'INSPECT_SIDE', side: 'FRONT', inspected: true, base: defectBase(state.defects, 'FRONT') });
  assert.equal(f.artifactPuts.length, 1); assert.match(f.artifactPuts[0], /\/DEFECTS\//);
  assert.equal(f.artifactGets.length, 3); assert.deepEqual(f.card().draft.geometry, before.draft.geometry);
  assert.notDeepEqual(f.card().draft.defects, before.draft.defects);
  const current = f.card(), next = await f.state(); f.corruptNextWrite = true;
  await assert.rejects(f.execute({ type: 'INSPECT_SIDE', side: 'BACK', inspected: true, base: defectBase(next.defects, 'BACK') }), { code: 'MANUAL_ARTIFACT_UNVERIFIED' });
  assert.deepEqual(f.card(), current); assert.equal(f.commits.length, 1);
});

test('unchanged artifacts still require exact verified bytes before reference reuse', async () => {
  const f = await fixture(), before = f.card(); f.corruptKey = before.draft.geometry.ref.key;
  f.artifactPuts.length = 0;
  await assert.rejects(f.execute({ type: 'IDENTITY_EDIT', identity: { ...before.draft.identity, playerName: 'Must not save' } }),
    { code: 'MANUAL_ARTIFACT_UNVERIFIED' });
  assert.deepEqual(f.card(), before); assert.equal(f.artifactPuts.length, 0); assert.equal(f.commits.length, 0);
});

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


test('individual review is a durable idempotent action, rejects concurrent stale writes, and never publishes learning',async()=>{
  const f=await fixture();await f.review();await f.execute({type:'MEASURE_SIDE',side:'FRONT'});
  const state=await f.state(),card=f.card(),finding=state.defects.sides.FRONT.findings[0];
  const command={actionId:randomUUID(),expectedRevision:card.revision,action:{type:'REVIEW_FINDING',side:'FRONT',base:defectBase(state.defects,'FRONT'),findingId:finding.id,reviewed:true}};
  const saved=await f.workflow.service.execute(f.staff,f.cardId,command);
  assert.deepEqual(reviewedDefectFindingIds((await f.state()).defects,'FRONT'),[finding.id]);
  assert.equal((await f.state()).defects.confirmation,null);assert.equal(f.publications.length,0);
  assert.deepEqual(await f.workflow.service.execute(f.staff,f.cardId,command),saved);
  await assert.rejects(f.workflow.service.execute(f.staff,f.cardId,{...command,actionId:randomUUID()}),/STALE|REVISION/);
  const geometry=(await f.state()).geometry;
  await f.execute({type:'MARK_PRINTED_ABSENT',side:'FRONT',base:geometryBase(geometry,'FRONT','PRINTED')});
  const changed=await f.state();assert.equal(changed.geometry.sides.FRONT.printed,null);
  assert.deepEqual(reviewedDefectFindingIds(changed.defects,'FRONT'),[]);
  assert.deepEqual(changed.defects.sides.FRONT.findings,state.defects.sides.FRONT.findings);
  assert.equal(f.publications.length,0);
});

test('variant confirmation preserves completed geometry/findings and permits exact final approval without repeating review',async()=>{
 let resolutions=0;const resolve=async({card})=>{resolutions++;return {...card.draft.identity,parallel:'Gold Refractor'};};
 const f=await fixture({resolveVariantConfirmation:resolve});
 await f.review();await f.execute({type:'MEASURE_SIDE',side:'FRONT'});await f.inspect();await f.confirm();
 const before=f.card(),prior=await f.state(),preview=await f.workflow.service.previewReport(f.staff,f.cardId),actionId=randomUUID(),command={actionId,expectedRevision:before.revision,action:{type:'VARIANT_CONFIRM'}};
 const changed=await f.workflow.service.execute(f.staff,f.cardId,command);assert.equal(changed.card.draft.identity.parallel,'Gold Refractor');assert.equal(changed.card.draft.identityRevision,before.draft.identityRevision+1);assert.deepEqual(changed.card.draft.geometry,before.draft.geometry);assert.deepEqual(changed.card.draft.defects,before.draft.defects);assert.deepEqual(changed.card.draft.source,before.draft.source);assert.deepEqual(changed.card.draft.assistance,before.draft.assistance);
 const after=await f.state();
 assert.ok(prior.defects.confirmation);assert.deepEqual(after.defects,prior.defects);
 for(const side of SIDES){assert.ok(prior.geometry.sides[side].confirmation);assert.deepEqual(after.geometry.sides[side],prior.geometry.sides[side]);}
 const currentPreview=await f.workflow.service.previewReport(f.staff,f.cardId);
 assert.deepEqual(currentPreview.report.grade,preview.report.grade);assert.equal(currentPreview.report.identity.parallel,'Gold Refractor');assert.notEqual(currentPreview.reportHash,preview.reportHash);
 await assert.rejects(f.execute({type:'APPROVE_REPORT',reportHash:preview.reportHash,reviewed:true}),{code:'MANUAL_REPORT_STALE'});
 assert.deepEqual(await f.workflow.service.execute(f.staff,f.cardId,command),changed);assert.equal(resolutions,1);
 const same=await f.execute({type:'VARIANT_CONFIRM'});assert.equal(same.card.draft.identityRevision,changed.card.draft.identityRevision);assert.deepEqual(same.card.draft.geometry,changed.card.draft.geometry);
 const approved=await f.execute({type:'APPROVE_REPORT',reportHash:(await f.workflow.service.previewReport(f.staff,f.cardId)).reportHash,reviewed:true});
 assert.deepEqual(approved.card.draft.geometry,before.draft.geometry);assert.deepEqual(approved.card.draft.defects,before.draft.defects);assert.equal(f.commits.at(-1).approval.identity.parallel,'Gold Refractor');
 const machine=await fixture({resolveVariantConfirmation:resolve,actorKind:'MACHINE'});await assert.rejects(machine.execute({type:'VARIANT_CONFIRM'}),{code:'VARIANT_CONFIRMATION_UNAVAILABLE'});assert.equal(resolutions,2);
});

test('replacing photographs clears only the new draft claims and preserves prior reviewed approval bytes',async()=>{
 const f=await fixture({replaceSources:async({card,geometry:before,sourceHash})=>{
  const fresh=replaceGeometryImage(before,{side:'BACK',base:geometryBase(before,'BACK','IMAGE'),image:{...before.sides.BACK.image,version:before.sides.BACK.image.version+1,originalSha256:hash('9')}}).state;
  return {geometry:fresh,source:{sourceHash},changedSides:['BACK']};
 }});
 const original=(await f.state()).geometry,attributes=emptyAtlasSportsAttributes();attributes.serial={presence:'PRESENT',...atlasPrintedSerial('007/099'),evidence:[{side:'BACK',imageSha256:original.sides.BACK.image.originalSha256,observation:'Back lower edge: 007/099.'}]};
 attributes.specialFeatures=[{kind:'CASE_HIT',evidence:{type:'REVIEWED_REFERENCE',sourceTitle:'Synthetic checklist',sourceUrl:'https://example.com/checklist',matchNote:'Exact card and printing match.'}}];
 await f.execute({type:'IDENTITY_EDIT',identity:{...f.card().draft.identity,sportsAttributes:attributes}});await f.inspect();await f.confirm();
 const before=clone(f.approval),card=f.card(),approved=await f.workflow.service.previewReport(f.staff,f.cardId);
 await f.execute({type:'REPLACE_SOURCES',sourceHash:hash('8')});
 assert.equal(Object.hasOwn(f.card().draft.identity,'sportsAttributes'),false);assert.equal(f.card().draft.identityRevision,card.draft.identityRevision+1);assert.deepEqual(f.approval,before);
 assert.equal(approved.review.report.identity.sportsAttributes.serial.printed,'007/099');
 assert.deepEqual(approved.review.report.identity.sportsAttributes.specialFeatures,attributes.specialFeatures);
 assert.equal((await f.state()).geometry.sides.BACK.image.originalSha256,hash('9'));
});
