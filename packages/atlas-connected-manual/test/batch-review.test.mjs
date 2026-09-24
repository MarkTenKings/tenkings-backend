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
import { measureDefectWorkspaceEdit } from '@atlas/measurement-runtime';
const sides = ['FRONT', 'BACK'], clone = structuredClone;
async function fixture({ count = 2, native = false } = {}) {
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
  const proposals = Array.from({ length: count }, (_, i) => { const x = .2 + Math.floor(i / 2) * .012;
    return { id: `proposal-${i}`, side: sides[i % 2], defectType: 'LIGHT_SCRATCH_SCUFF',
      reviewStatus: 'UNREVIEWED', canonicalContour: [{ x, y: .2 }, { x: x + .02, y: .2 }, { x: x + .02, y: .22 }, { x, y: .22 }] }; });
  const analysisId = randomUUID(), offer = { analysisId, resultHash: digest(canonical(proposals)), proposalIds: proposals.map(x => x.id).sort() };
  let initial;
  const workflow = createManualWorkflow({ repository, artifacts: p.artifacts, measure,
    resolveConfirmation: async ({ selection }) => {
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
  return { review: createBatchReview({ connected, repository: batchRepository, artifacts: p.artifacts }), staff, job, report, workflow, commits, approvals, lessons,
    input: { reportHash, reviewed: true, images: Object.fromEntries(sides.map(side => [side, report.geometry[side].frame.inspectionImageSha256])) },
    loseReply(type) { lostReplyAt = type; }, mutate() { card.revision++; card.contentHash = 'f'.repeat(64); }, replace() { replaced = true; },
    deny() { principal.canCertify = false; }, tamper() { tamper = true; }, get command() { return review; }, get card() { return card; } };
}
test('reading exact machine evidence does not attest; one explicit human command adopts displayed traces, grades and approves', async () => {
  const f = await fixture(); const view = await f.review.detail(f.staff, f.job.key);
  assert.equal(view.report.authority, 'MACHINE_PROPOSAL'); assert.equal(f.command, null); assert.equal(f.commits.length, 0); assert.equal(f.lessons.length, 0);
  const result = await f.review.approve(f.staff, f.job.key, f.input);
  assert.equal(result.publication.state, 'PUBLISHED');
  assert.deepEqual(f.commits.map(x => x.action.type), ['CONFIRM_GEOMETRY', 'INSPECT_SIDE', 'INSPECT_SIDE', 'CONFIRM_FINDINGS', 'APPROVE_REPORT']);
  const state = await f.workflow.hydrate(f.card);
  assert.equal(state.assistance.reviews.length, 2); assert.equal(state.assistance.reviews.every(x => x.reviewerId === f.staff.id && x.action === 'ACCEPT'), true);
  assert.equal(f.lessons.length, 1); assert.equal(f.approvals.size, 1);
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
