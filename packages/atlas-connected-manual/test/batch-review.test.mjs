import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createBatchReview } from '../src/batch-review.mjs';
import { buildMachineReport } from '../src/batch-preparation.mjs';
import { publicationFixture } from './publication-fixture.mjs';
import { createManualWorkflow } from '../../atlas-manual-workflow/src/workflow.mjs';
import { canonical, digest, stateDocument, inputCommand, requireThat } from '@atlas/manual-service/contract';
import { defectBase, runDefectMeasurement } from '@atlas/manual-workspace/defect-actions';
import { decodeSpeedsterTraceRleV1 } from '@atlas/grading-core/trace-codec';
import { SPEEDSTER_RULE_VERSION } from '@atlas/grading-core/contracts';
import { ATLAS_RULE_VERSION } from '@atlas/grading-core/atlas-policy';
import { calculateSpeedsterReview } from '@atlas/grading-core/review';
import { measureSpeedsterCenteringBorders } from '@atlas/grading-core/scoring';
import { calculateAtlasFinalGrade } from '@atlas/grading-core/manual-report';
import { measureDefectWorkspaceEdit } from '@atlas/measurement-runtime';
import { geometryBase } from '@atlas/manual-workspace/geometry-actions';
import { batchActionId } from '@atlas/batch-grading';
const sides = ['FRONT', 'BACK'], clone = structuredClone;
async function fixture({ count = 2, native = false, unmeasurable = false, missingPrinted = false, historicalMachine = false } = {}) {
  const p = await publicationFixture(), staff = { id: p.actorId }, principal = { id: p.actorId, canCertify: true };
  const records = new Map(), approvals = new Map(), commits = [], lessons = [];
  const publishedLessons = new Set();
  const publishLesson = async (actor, id, actionId) => {
    assert.ok(records.has(actionId));
    if (!publishedLessons.has(actionId)) { publishedLessons.add(actionId); lessons.push(actionId); }
  };
  let card, review = null, lostReplyAt = null, tamper = false, replaced = false;
  const repository = {
    async provision(actor, input) { const doc = stateDocument(input.draft); card = { cardId: input.cardId, revision: 1, contentHash: doc.hash, draft: doc.draft }; return clone(card); },
    async load() { return { card: clone(card), principal: clone(principal) }; },
    async authorizeEdit() { return this.load(); },
    async status(actor, id, actionId) { const value = records.get(actionId); return value ? { state: 'COMMITTED', ...clone(value) } : { state: 'NOT_FOUND' }; },
    async findAction(actor, id, input) { const prior = records.get(input.actionId); if (!prior) return null;
      requireThat(prior.requestHash === inputCommand(input).requestHash, 409, 'MANUAL_ACTION_CONFLICT'); return clone(prior.result); },
    async readApproval(actor, id, actionId) { return clone(approvals.get(actionId)); },
    async commit(actor, input) {
      requireThat(actor === staff && !replaced, 409, 'BATCH_PHOTOS_CHANGED');
      requireThat(input.input.expectedRevision === card.revision && input.baseHash === card.contentHash, 409, 'MANUAL_DRAFT_STALE');
      const source = clone(card), doc = stateDocument(input.draft), requestHash = inputCommand(input.input).requestHash;
      card = { ...card, revision: card.revision + 1, contentHash: doc.hash, draft: doc.draft };
      const receipt = { actionId: input.input.actionId, expectedRevision: source.revision, revision: card.revision };
      if (input.approval) approvals.set(input.input.actionId, { sourceRevision: source.revision, report: clone(input.approval) });
      const result = { card: clone(card), receipt }; records.set(input.input.actionId, { requestHash, result }); commits.push(clone(input.input));
      if (input.input.action.type === lostReplyAt) { lostReplyAt = null; throw new Error('reply lost after durable commit'); }
      return result;
    },
  };
  const syntheticMeasure = async ({ workspace, side }) => runDefectMeasurement(workspace, side, async input => {
    const ids = new Set(input.marks.map(mark => mark.id));
    return { receipt: { fixture: 'synthetic CPU adapter, no optical qualification' }, defects: [
      ...input.findings.filter(finding => !ids.has(finding.id)), ...input.marks.map(mark => {
        const pixels = decodeSpeedsterTraceRleV1(mark.finalTrace).reduce((n, value) => n + value, 0);
        return { ...mark, side, origin: 'SMART_MARK', confidence: 1, supportingViewIds: [], reviewResult: 'SMART_MARKED',
          measurementRegions: [{ zone: 'SURFACE', canonicalContour: p.geometry.sides[side].printed.quad,
            measurement: { pixelCount: pixels, widthMm: 1, heightMm: 1, areaMm2: pixels * .0025,
              zonePercent: .01, multiplier: 1, weightedAreaMm2: pixels * .0025, subgradeEffect: 0 } }] };
      })] };
  });
  const measure = native ? input => measureDefectWorkspaceEdit({ ...input, pythonExecutable: process.env.ATLAS_MEASUREMENT_PYTHON,
    limits: { maxInputBytes: 8000000, maxOutputBytes: 8000000, maxFindings: 128, timeoutMs: 15000 } }) : syntheticMeasure;
  const geometry = clone(p.geometry); for (const side of sides) geometry.sides[side].confirmation = null;
  if (missingPrinted) geometry.sides.BACK.printed = null;
  const proposals = Array.from({ length: count }, (_, i) => { const x = .2 + Math.floor(i / 2) * .012;
    return { id: `proposal-${i}`, side: sides[i % 2], defectType: 'LIGHT_SCRATCH_SCUFF',
      reviewStatus: 'UNREVIEWED', canonicalContour: [{ x, y: .2 }, { x: x + .02, y: .2 }, { x: x + .02, y: .22 }, { x, y: .22 }] }; });
  if (unmeasurable) proposals[0].canonicalContour = [
    { x: .50001, y: .50001 }, { x: .50002, y: .50001 }, { x: .50002, y: .50002 },
  ];
  const analysisId = randomUUID(), offer = { analysisId, resultHash: digest(canonical(proposals)), proposalIds: proposals.map(x => x.id).sort() };
  let initial, batchReview;
  const workflow = createManualWorkflow({ repository, artifacts: p.artifacts, measure,
    resolveFinalReview: input => batchReview.resolveCorrections(input),
    resolveConfirmation: async ({ selection, card }) => {
      if (card.draft.finalReview) { assert.equal(selection, null); return { entries: [] }; }
      assert.deepEqual(selection, count ? offer : null);
      return { entries: proposals.map(proposal => ({ proposal, base: defectBase(initial.defects, proposal.side) })) };
    },
    assertReviewComplete: async ({ card }) => {
      const state = await workflow.hydrate(card);
      requireThat((state.assistance?.reviews.length ?? 0) === count, 409, 'MANUAL_ASTRA_REVIEW_REQUIRED');
      return null;
    },
    afterConfirm: publishLesson,
    afterApprove: async () => ({ state: 'PUBLISHED' }),
  });
  await workflow.provision(staff, { geometry, identity: p.full.identity, source: { sourceHash: 'a'.repeat(64) } });
  initial = await workflow.hydrate(card);
  const analysis = { status: 'READY', analysisId, proposals, proposalReview: offer };
  const report = await buildMachineReport({ card: clone(card), state: initial, analysis, measure });
  if (historicalMachine) {
    const capture = Object.fromEntries(sides.map(side => [side.toLowerCase(), {
      centeringBorders: measureSpeedsterCenteringBorders(initial.geometry.sides[side].printed.quad),
    }]));
    const historical = calculateSpeedsterReview(capture, report.findings);
    report.ruleVersion = SPEEDSTER_RULE_VERSION;
    report.grade = historical.grade;
    report.findings = historical.defects;
    report.proposedGrade = calculateAtlasFinalGrade(historical.grade.overall.rawGrade);
  }
  const reportHash = digest(JSON.stringify(report)), reportRef = await p.artifacts.write(report, { cardId: p.cardId, kind: 'BATCH_REPORT', sourceHash: reportHash });
  const job = { key: 'b'.repeat(64), cardId: p.cardId, state: 'REVIEW', sourceHash: card.draft.source.sourceHash,
    analysisActionId: randomUUID(), evidence: { authority: 'MACHINE_PROPOSAL', reportHash, reportRef, manualRevision: card.revision, manualContentHash: card.contentHash } };
  const batchRepository = {
    async readReview() { requireThat(!replaced, 409, 'BATCH_PHOTOS_CHANGED'); return { job: clone(job), review: clone(review), canCertify: principal.canCertify }; },
    async beginReview(actor, key, input) { if (review) assert.deepEqual(input, review); else { assert.equal(card.revision, 1); review = clone(input); } },
  };
  const connected = { workflow: { ...workflow, service: { ...workflow.service, async previewReport(...args) {
    const preview = await workflow.service.previewReport(...args); if (tamper) preview.review.report.findings[0].defectType = 'DENT'; return preview;
  } } }, assistance: { async status() { return { astra: clone(analysis) }; }, publish: publishLesson },
  async imageDescriptors() { return Object.fromEntries(sides.map(side => [side, { inspection: { sha256: report.geometry[side].frame.inspectionImageSha256 } }])); },
  publication: { async publish() { return { state: 'PUBLISHED' }; } } };
  batchReview = createBatchReview({ connected, repository: batchRepository, artifacts: p.artifacts });
  return { review: batchReview, staff, job, report, workflow, commits, approvals, lessons,
    input: { reportHash, reviewed: true, images: Object.fromEntries(sides.map(side => [side, report.geometry[side].frame.inspectionImageSha256])) },
    async seedHistoricalProgress(steps) {
      assert(historicalMachine); assert(Number.isInteger(steps) && steps >= 0 && steps <= 5);
      await batchRepository.beginReview(staff, job.key, { reportHash, reviewed: true,
        images: Object.fromEntries(sides.map(side => [side, report.geometry[side].frame.inspectionImageSha256])),
        manualRevision: report.manualRevision, manualContentHash: report.manualContentHash, proposalReview: offer });
      for (const [index, step] of ['GEOMETRY', 'INSPECT_FRONT', 'INSPECT_BACK', 'FINDINGS', 'APPROVAL'].entries()) {
        if (index >= steps) break;
        const state = await workflow.hydrate(card), actionId = batchActionId(job.key, `HUMAN_REVIEW_${step}`);
        let action;
        if (step === 'GEOMETRY') action = { type: 'CONFIRM_GEOMETRY', reviewed: true,
          base: Object.fromEntries(sides.map(side => [side, geometryBase(state.geometry, side, 'REVIEW')])) };
        else if (step.startsWith('INSPECT_')) { const side = step.slice(8); action = { type: 'INSPECT_SIDE', side,
          base: defectBase(state.defects, side), inspected: true }; }
        else if (step === 'FINDINGS') action = { type: 'CONFIRM_FINDINGS', reviewed: true,
          base: Object.fromEntries(sides.map(side => [side, defectBase(state.defects, side)])), proposalReview: offer };
        else {
          // Persist an authentic old-policy approval as it existed before the
          // release. Recovery must read these bytes without invoking new scoring.
          const preview = await workflow.service.previewReport(staff, card.cardId);
          const calculated = calculateSpeedsterReview(Object.fromEntries(sides.map(side => [side.toLowerCase(), {
            centeringBorders: measureSpeedsterCenteringBorders(state.geometry.sides[side].printed.quad),
          }])), preview.review.report.findings);
          const final = { ...preview.review.report, ruleVersion: SPEEDSTER_RULE_VERSION, grade: calculated.grade,
            findings: calculated.defects, finalGrade: calculateAtlasFinalGrade(calculated.grade.overall.rawGrade) };
          const approval = { ...preview.report, ruleVersion: final.ruleVersion, grade: final.grade,
            finalGrade: final.finalGrade, report: await p.save('REPORT', final) };
          const input = { actionId, expectedRevision: card.revision,
            action: { type: 'APPROVE_REPORT', reviewed: true, reportHash: digest(canonical(approval)) } };
          await repository.commit(staff, { input, baseHash: card.contentHash, draft: card.draft, approval });
          continue;
        }
        await workflow.service.execute(staff, card.cardId, { actionId, expectedRevision: card.revision, action });
      }
    },
    loseHistoricalReceipt(step) { records.delete(batchActionId(job.key, `HUMAN_REVIEW_${step}`)); },
    changeContentHash() { card.contentHash = 'f'.repeat(64); },
    loseReply(type) { lostReplyAt = type; }, mutate() { card.revision++; card.contentHash = 'f'.repeat(64); }, replace() { replaced = true; },
    deny() { principal.canCertify = false; }, tamper() { tamper = true; }, get command() { return review; }, get card() { return card; } };
}
test('missing-border report is visible and unapprovable until final human geometry and findings review completes', async () => {
  const f = await fixture({ missingPrinted: true });
  const execute = action => f.workflow.service.execute(f.staff, f.card.cardId, { actionId: randomUUID(), expectedRevision: f.card.revision, action });
  const view = await f.review.detail(f.staff, f.job.key);
  assert.equal(view.report.grade, null); assert.equal(view.report.proposedGrade, null); assert.equal(view.explanation, null);
  assert.equal(view.report.findings.length, 2); assert.equal(view.canCertify, false);
  assert.equal(view.reviewRequiredReason, 'BATCH_FINAL_GEOMETRY_REQUIRED');
  await assert.rejects(f.review.approve(f.staff, f.job.key, f.input), { code: 'BATCH_FINAL_GEOMETRY_REQUIRED' });
  assert.equal(f.command, null); assert.equal(f.commits.length, 0); assert.equal(f.lessons.length, 0);
  await execute({ type: 'BEGIN_FINAL_REVIEW', batchKey: f.job.key, reportHash: f.input.reportHash });
  let state = await f.workflow.hydrate(f.card);
  const partial = await f.review.detail(f.staff, f.job.key);
  assert.equal(partial.state, 'READY'); assert.equal(partial.report.calculationState, 'GEOMETRY_UNRESOLVED');
  assert.equal(partial.report.proposedGrade, null); assert.equal(partial.canCertify, false);
  assert.deepEqual(state.finalReview.report, f.report); assert.equal(state.defects.confirmation, null);
  await assert.rejects(execute({ type: 'APPROVE_REPORT', reportHash: partial.reportHash, reviewed: true }));
  await execute({ type: 'GEOMETRY_EDIT', edit: { side: 'BACK', kind: 'PRINTED', base: geometryBase(state.geometry, 'BACK', 'PRINTED'),
    quad: [{ x: .04, y: .03 }, { x: .96, y: .03 }, { x: .96, y: .97 }, { x: .04, y: .97 }] } });
  state = await f.workflow.hydrate(f.card);
  assert.deepEqual(state.finalReview.report, f.report); assert.equal(state.defects.sides.BACK.findings.length, 1);
  const corrected = f.workflow.currentPreview(f.card, state);
  assert.equal(corrected.report.calculationState, 'COMPLETE'); assert.ok(Number.isFinite(corrected.report.proposedGrade));
  assert.equal(corrected.report.certification, null); assert.deepEqual(corrected.report.unresolvedGeometry, []);
  await execute({ type: 'CONFIRM_GEOMETRY', reviewed: true, base: Object.fromEntries(sides.map(side => [side, geometryBase(state.geometry, side, 'REVIEW')])) });
  for (const side of sides) { state = await f.workflow.hydrate(f.card); await execute({ type: 'INSPECT_SIDE', side, inspected: true, base: defectBase(state.defects, side) }); }
  state = await f.workflow.hydrate(f.card);
  await execute({ type: 'CONFIRM_FINDINGS', reviewed: true, base: Object.fromEntries(sides.map(side => [side, defectBase(state.defects, side)])) });
  const final = await f.workflow.service.previewReport(f.staff, f.card.cardId);
  await assert.rejects(execute({ type: 'APPROVE_REPORT', reportHash: partial.reportHash, reviewed: true }), { code: 'MANUAL_REPORT_STALE' });
  await execute({ type: 'APPROVE_REPORT', reportHash: final.reportHash, reviewed: true });
  assert.equal(f.approvals.size, 1); assert.equal(f.lessons.length, 1);
  assert.equal(final.review.report.finalGrade, corrected.report.proposedGrade);
});
test('final correction entry preserves unreviewed machine evidence; printed correction recalculates and exact revised approval wins', async () => {
  const f = await fixture();
  const execute = action => f.workflow.service.execute(f.staff, f.card.cardId, {
    actionId: randomUUID(), expectedRevision: f.card.revision, action,
  });
  const begin = { actionId: randomUUID(), expectedRevision: f.card.revision,
    action: { type: 'BEGIN_FINAL_REVIEW', batchKey: f.job.key, reportHash: f.input.reportHash } };
  await f.workflow.service.execute(f.staff, f.card.cardId, begin);
  await f.workflow.service.execute(f.staff, f.card.cardId, begin);
  let state = await f.workflow.hydrate(f.card);
  assert.equal(f.commits.length, 1, 'lost reply/replay does not import twice');
  assert.deepEqual(state.finalReview.report, f.report);
  assert.equal(state.defects.confirmation, null);
  assert.equal(state.assistance, undefined);
  assert.equal(f.approvals.size, 0); assert.equal(f.lessons.length, 0);
  assert.ok(sides.every(side => state.defects.sides[side].findings.every(value => value.origin === 'DETECTOR' && value.reviewResult === 'UNREVIEWED')));
  const original = f.workflow.currentPreview(f.card, state);
  assert.equal(original.report.proposedGrade, f.report.proposedGrade);
  const findings = clone(state.defects.sides.FRONT.findings), frame = clone(state.defects.sides.FRONT.frame);
  await execute({ type: 'GEOMETRY_EDIT', edit: { side: 'FRONT', kind: 'PRINTED', base: geometryBase(state.geometry, 'FRONT', 'PRINTED'),
    quad: [{ x: .15, y: .03 }, { x: .96, y: .03 }, { x: .96, y: .97 }, { x: .15, y: .97 }] } });
  state = await f.workflow.hydrate(f.card);
  assert.deepEqual(state.defects.sides.FRONT.findings, findings); assert.deepEqual(state.defects.sides.FRONT.frame, frame);
  const updated = f.workflow.currentPreview(f.card, state);
  assert.notEqual(updated.report.proposedGrade, original.report.proposedGrade);
  assert.notEqual(updated.reportHash, original.reportHash);
  assert.equal(updated.report.authority, 'HUMAN_REVIEW_DRAFT'); assert.equal(updated.report.certification, null);
  const batch = await f.review.detail(f.staff, f.job.key);
  assert.equal(batch.correctionAvailable, true); assert.equal(batch.canCertify, false);
  assert.equal(batch.report.proposedGrade, updated.report.proposedGrade);
  await assert.rejects(f.review.approve(f.staff, f.job.key, f.input), { code: 'BATCH_REVIEW_STALE' });
  await assert.rejects(execute({ type: 'APPROVE_REPORT', reportHash: original.reportHash, reviewed: true }));
  await execute({ type: 'CONFIRM_GEOMETRY', reviewed: true, base: Object.fromEntries(sides.map(side => [side, geometryBase(state.geometry, side, 'REVIEW')])) });
  for (const side of sides) { state = await f.workflow.hydrate(f.card); await execute({ type: 'INSPECT_SIDE', side, inspected: true, base: defectBase(state.defects, side) }); }
  state = await f.workflow.hydrate(f.card);
  await execute({ type: 'CONFIRM_FINDINGS', reviewed: true, base: Object.fromEntries(sides.map(side => [side, defectBase(state.defects, side)])) });
  state = await f.workflow.hydrate(f.card);
  assert.equal(state.assistance.reviews.length, 2); assert.equal(f.lessons.length, 1);
  const final = await f.workflow.service.previewReport(f.staff, f.card.cardId);
  assert.equal(final.review.report.finalGrade, updated.report.proposedGrade);
  await assert.rejects(execute({ type: 'APPROVE_REPORT', reportHash: original.reportHash, reviewed: true }), { code: 'MANUAL_REPORT_STALE' });
  await execute({ type: 'APPROVE_REPORT', reportHash: final.reportHash, reviewed: true });
  assert.equal(f.approvals.size, 1);
});

test('pending geometry after final-review physical correction never serves the old score or clears saved findings', async () => {
  const f = await fixture();
  const execute = action => f.workflow.service.execute(f.staff, f.card.cardId, { actionId: randomUUID(), expectedRevision: f.card.revision, action });
  await execute({ type: 'BEGIN_FINAL_REVIEW', batchKey: f.job.key, reportHash: f.input.reportHash });
  const state = await f.workflow.hydrate(f.card);
  await execute({ type: 'GEOMETRY_EDIT', edit: { side: 'FRONT', kind: 'PHYSICAL', base: geometryBase(state.geometry, 'FRONT', 'PHYSICAL'),
    quad: [{ x: .126, y: .1 }, { x: .875, y: .1 }, { x: .875, y: .9 }, { x: .126, y: .9 }] } });
  const after = await f.workflow.hydrate(f.card), preview = f.workflow.currentPreview(f.card, after);
  assert.equal(preview.state, 'PENDING'); assert.equal(preview.report, undefined);
  assert.deepEqual(after.defects, state.defects); assert.ok(f.card.draft.geometryBeforeEdit.FRONT);
});

test('a retained nonraster observation can be explicitly rejected after physical geometry changes without reusing old coordinates', async () => {
  const f = await fixture({ unmeasurable: true });
  const execute = action => f.workflow.service.execute(f.staff, f.card.cardId, { actionId: randomUUID(), expectedRevision: f.card.revision, action });
  await execute({ type: 'BEGIN_FINAL_REVIEW', batchKey: f.job.key, reportHash: f.input.reportHash });
  const before = await f.workflow.hydrate(f.card), proposal = f.report.unmeasurableProposals[0];
  await execute({ type: 'GEOMETRY_EDIT', edit: { side: 'FRONT', kind: 'PHYSICAL', base: geometryBase(before.geometry, 'FRONT', 'PHYSICAL'),
    quad: [{ x: .126, y: .1 }, { x: .875, y: .1 }, { x: .875, y: .9 }, { x: .126, y: .9 }] } });
  await assert.rejects(execute({ type: 'REJECT_FINAL_OBSERVATION', proposalId: proposal.id, reportHash: 'e'.repeat(64), reviewed: true }));
  await execute({ type: 'REJECT_FINAL_OBSERVATION', proposalId: proposal.id, reportHash: f.input.reportHash, reviewed: true });
  const after = await f.workflow.hydrate(f.card), review = after.assistance.reviews[0];
  assert.equal(review.action, 'REJECT'); assert.equal(review.noMeasurablePixels, true);
  assert.equal(review.reviewerId, f.staff.id); assert.equal(review.proposalId, proposal.id);
  assert.deepEqual(review.base.frame, before.defects.sides[proposal.side].frame);
  assert.deepEqual(after.defects.sides.FRONT.findings, before.defects.sides.FRONT.findings);
  assert.equal(after.defects.confirmation, null); assert.equal(f.approvals.size, 0); assert.equal(f.lessons.length, 0);
});
test('unmeasurable machine proposals require manual review before any human action or approval intent is saved', async () => {
  const f = await fixture({ unmeasurable: true });
  const view = await f.review.detail(f.staff, f.job.key);
  assert.equal(view.canCertify, false); assert.equal(view.reviewRequiredReason, 'BATCH_PROPOSAL_REVIEW_REQUIRED');
  assert.equal(view.report.unmeasurableProposals.length, 1);
  await assert.rejects(f.review.approve(f.staff, f.job.key, f.input), error => error.code === 'BATCH_PROPOSAL_REVIEW_REQUIRED');
  assert.equal(f.command, null); assert.equal(f.commits.length, 0); assert.equal(f.approvals.size, 0);
  assert.equal(f.lessons.length, 0); assert.equal(f.card.revision, 1);
});
test('reading exact machine evidence does not attest; one explicit human command adopts displayed traces, grades and approves', async () => {
  const f = await fixture(); const view = await f.review.detail(f.staff, f.job.key);
  assert.equal(view.report.ruleVersion, ATLAS_RULE_VERSION);
  assert.equal(view.report.authority, 'MACHINE_PROPOSAL'); assert.equal(f.command, null); assert.equal(f.commits.length, 0); assert.equal(f.lessons.length, 0);
  const result = await f.review.approve(f.staff, f.job.key, f.input);
  assert.equal(result.publication.state, 'PUBLISHED');
  assert.deepEqual(f.commits.map(x => x.action.type), ['CONFIRM_GEOMETRY', 'INSPECT_SIDE', 'INSPECT_SIDE', 'CONFIRM_FINDINGS', 'APPROVE_REPORT']);
  const state = await f.workflow.hydrate(f.card);
  assert.equal(state.assistance.reviews.length, 2); assert.equal(state.assistance.reviews.every(x => x.reviewerId === f.staff.id && x.action === 'ACCEPT'), true);
  assert.equal(f.lessons.length, 1); assert.equal(f.approvals.size, 1);
});
test('retained machine report under the old rule is readable but requires a new human-scored draft before approval', async () => {
  const f = await fixture({ historicalMachine: true });
  const before = clone(f.report), view = await f.review.detail(f.staff, f.job.key);
  assert.equal(view.report.ruleVersion, SPEEDSTER_RULE_VERSION);
  assert.equal(view.reviewRequiredReason, 'BATCH_SCORING_POLICY_UPDATED');
  assert.equal(view.canCertify, false);
  await assert.rejects(f.review.approve(f.staff, f.job.key, f.input), { code: 'BATCH_SCORING_POLICY_UPDATED' });
  assert.equal(f.commits.length, 0);
  await f.workflow.service.execute(f.staff, f.card.cardId, { actionId: randomUUID(), expectedRevision: f.card.revision,
    action: { type: 'BEGIN_FINAL_REVIEW', batchKey: f.job.key, reportHash: f.input.reportHash } });
  const state = await f.workflow.hydrate(f.card), current = f.workflow.currentPreview(f.card, state);
  assert.deepEqual(state.finalReview.report, before);
  assert.equal(current.report.ruleVersion, ATLAS_RULE_VERSION);
  assert.equal(current.report.originalMachineReportHash, f.input.reportHash);
  assert.equal(current.explanation.ruleVersion, ATLAS_RULE_VERSION);
});
test('lost committed findings response resumes identical receipts without duplicate adoption or approval', async () => {
  const f = await fixture(); f.loseReply('CONFIRM_FINDINGS');
  await assert.rejects(f.review.approve(f.staff, f.job.key, f.input), /reply lost/);
  const view = await f.review.detail(f.staff, f.job.key); assert.equal(view.resumeAvailable, true);
  assert.equal(f.commits.length, 4); await f.review.approve(f.staff, f.job.key, f.input); await f.review.approve(f.staff, f.job.key, f.input);
  assert.equal(f.commits.length, 5); assert.equal(f.approvals.size, 1);
  assert.equal(f.lessons.length, 1, 'A lost commit reply resumes the exact reviewed-memory publication once');
  assert.equal((await f.workflow.hydrate(f.card)).assistance.reviews.length, 2);
});
test('each interrupted historical approval prefix can explicitly reopen unchanged evidence for fresh current-policy review', async () => {
  for (const steps of [0, 1, 2, 3, 4]) {
    const f = await fixture({ historicalMachine: true }); await f.seedHistoricalProgress(steps);
    const original = clone(f.report), before = await f.workflow.hydrate(f.card);
    const view = await f.review.detail(f.staff, f.job.key);
    assert.equal(view.reviewRequiredReason, 'BATCH_SCORING_POLICY_UPDATED'); assert.equal(view.canCertify, false);
    await assert.rejects(f.review.approve(f.staff, f.job.key, f.input), { code: 'BATCH_SCORING_POLICY_UPDATED' });
    await f.workflow.service.execute(f.staff, f.card.cardId, { actionId: randomUUID(), expectedRevision: f.card.revision,
      action: { type: 'BEGIN_FINAL_REVIEW', batchKey: f.job.key, reportHash: f.input.reportHash } });
    const state = await f.workflow.hydrate(f.card), preview = f.workflow.currentPreview(f.card, state);
    assert.deepEqual(state.finalReview.report, original); assert.equal(state.finalReview.reportHash, f.input.reportHash);
    assert.equal(preview.report.ruleVersion, ATLAS_RULE_VERSION); assert.equal(f.approvals.size, 0);
    assert.equal(state.defects.confirmation, null);
    for (const side of sides) {
      assert.equal(state.defects.sides[side].inspection, null);
      assert(state.defects.sides[side].findingRevision > before.defects.sides[side].findingRevision);
      assert(state.defects.sides[side].reviewRevision > before.defects.sides[side].reviewRevision);
      assert.deepEqual(state.defects.sides[side].findings, original.findings.filter(finding => finding.side === side));
    }
    await assert.rejects(f.workflow.service.execute(f.staff, f.card.cardId, { actionId: randomUUID(), expectedRevision: f.card.revision,
      action: { type: 'APPROVE_REPORT', reportHash: preview.reportHash, reviewed: true } }));
    if (steps === 4) {
      const execute = action => f.workflow.service.execute(f.staff, f.card.cardId, {
        actionId: randomUUID(), expectedRevision: f.card.revision, action });
      for (const side of sides) { const current = await f.workflow.hydrate(f.card);
        await execute({ type: 'INSPECT_SIDE', side, inspected: true, base: defectBase(current.defects, side) }); }
      const current = await f.workflow.hydrate(f.card);
      await execute({ type: 'CONFIRM_FINDINGS', reviewed: true,
        base: Object.fromEntries(sides.map(side => [side, defectBase(current.defects, side)])) });
      const final = await f.workflow.service.previewReport(f.staff, f.card.cardId);
      assert.equal(final.review.report.ruleVersion, ATLAS_RULE_VERSION);
      assert.notDeepEqual(final.review.report.grade, original.grade);
      await execute({ type: 'APPROVE_REPORT', reportHash: final.reportHash, reviewed: true });
      assert.equal(f.approvals.size, 1);
      assert.equal(f.approvals.values().next().value.report.ruleVersion, ATLAS_RULE_VERSION);
      assert.deepEqual((await f.workflow.hydrate(f.card)).finalReview.report, original);
    }
  }
});
test('historical correction transition rejects changed revision/hash, missing receipts, changed images and wrong report', async () => {
  for (const change of [f => f.mutate(), f => f.changeContentHash(), f => f.loseHistoricalReceipt('GEOMETRY'), f => f.replace(),
    f => { f.input.reportHash = 'c'.repeat(64); }, f => { f.command.images.FRONT = 'c'.repeat(64); }]) {
    const f = await fixture({ historicalMachine: true }); await f.seedHistoricalProgress(3); change(f);
    await assert.rejects(f.workflow.service.execute(f.staff, f.card.cardId, { actionId: randomUUID(), expectedRevision: f.card.revision,
      action: { type: 'BEGIN_FINAL_REVIEW', batchKey: f.job.key, reportHash: f.input.reportHash } }),
    error => ['BATCH_REVIEW_STALE', 'BATCH_PHOTOS_CHANGED', 'BATCH_REVIEW_BINDING_CHANGED'].includes(error.code));
    assert.equal(f.commits.length, 3); assert.equal(f.approvals.size, 0);
  }
});
test('fully committed historical approval recovers the exact saved award and publication without reapproval', async () => {
  const f = await fixture({ historicalMachine: true }); await f.seedHistoricalProgress(5);
  const before = clone([...f.approvals]), card = clone(f.card), view = await f.review.detail(f.staff, f.job.key);
  assert.equal(view.approved, true); assert.equal(view.canCertify, true); assert.equal(view.reviewRequiredReason, null);
  const result = await f.review.approve(f.staff, f.job.key, f.input);
  assert.equal(result.publication.state, 'PUBLISHED'); assert.equal(result.actionId, batchActionId(f.job.key, 'HUMAN_REVIEW_APPROVAL'));
  assert.deepEqual(await f.review.approve(f.staff, f.job.key, f.input), result);
  assert.equal(f.commits.length, 5); assert.equal(f.approvals.size, 1);
  assert.deepEqual([...f.approvals], before); assert.deepEqual(f.card, card);
  await assert.rejects(f.workflow.service.execute(f.staff, f.card.cardId, { actionId: randomUUID(), expectedRevision: f.card.revision,
    action: { type: 'BEGIN_FINAL_REVIEW', batchKey: f.job.key, reportHash: f.input.reportHash } }), { code: 'BATCH_REVIEW_STALE' });
});
test('historical saved approval recovery rejects mismatched receipt chains and approval source revisions', async () => {
  for (const change of [f => f.loseHistoricalReceipt('FINDINGS'), f => f.changeContentHash(),
    f => { f.approvals.values().next().value.sourceRevision++; }]) {
    const f = await fixture({ historicalMachine: true }); await f.seedHistoricalProgress(5); change(f);
    await assert.rejects(f.review.approve(f.staff, f.job.key, f.input), error => ['BATCH_REVIEW_STALE', 'BATCH_REVIEW_BINDING_CHANGED'].includes(error.code));
    assert.equal(f.commits.length, 5); assert.equal(f.approvals.size, 1);
  }
});
test('zero findings still require the same actual human inspection and approval', async () => {
  const f = await fixture({ count: 0 }); await f.review.approve(f.staff, f.job.key, f.input);
  assert.equal(f.commits.length, 5); assert.equal(f.approvals.size, 1);
});
test('different photo/report authority, missing deliberate decision and untrained staff never begin review', async () => {
  for (const change of [f => ({ ...f.input, reviewed: false }), f => ({ ...f.input, reportHash: 'c'.repeat(64) }),
    f => ({ ...f.input, images: { ...f.input.images, FRONT: 'c'.repeat(64) } }), f => { f.deny(); return f.input; }]) {
    const f = await fixture(); await assert.rejects(f.review.approve(f.staff, f.job.key, change(f))); assert.equal(f.command, null); assert.equal(f.commits.length, 0);
  }
});
test('intervening manual edits or replaced source after partial review cannot be silently adopted', async () => {
  for (const change of ['mutate', 'replace']) {
    const f = await fixture(); f.loseReply('INSPECT_SIDE'); await assert.rejects(f.review.approve(f.staff, f.job.key, f.input)); f[change]();
    await assert.rejects(f.review.approve(f.staff, f.job.key, f.input), e => ['BATCH_REVIEW_STALE', 'BATCH_PHOTOS_CHANGED'].includes(e.code)); assert.equal(f.approvals.size, 0);
  }
});
test('a reclassified or differently measured final finding refuses approval even when final rounded grade is unchanged', async () => {
  const f = await fixture(); f.tamper(); await assert.rejects(f.review.approve(f.staff, f.job.key, f.input), e => e.code === 'BATCH_REVIEW_REPORT_CHANGED');
  assert.equal(f.commits.length, 4); assert.equal(f.approvals.size, 0);
});
test('checked native CPU yields exactly the same proposal and approved traces, overlap ownership and score',
  { skip: !process.env.ATLAS_MEASUREMENT_PYTHON }, async () => {
    const f = await fixture({ count: 4, native: true });
    assert.equal(f.report.measurementReceipts.every(item => item.receipt.version === 'atlas-manual-cpu-measurement-v1'), true);
    const result = await f.review.approve(f.staff, f.job.key, f.input);
    assert.equal(result.publication.state, 'PUBLISHED'); assert.equal(f.approvals.size, 1);
    assert.equal((await f.workflow.hydrate(f.card)).assistance.reviews.length, 4);
  });
