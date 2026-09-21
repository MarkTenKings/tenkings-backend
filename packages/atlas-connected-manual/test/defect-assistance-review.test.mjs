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
import { buildAstraDefectRequest, buildAstraBackgroundDefectRequest, buildAstraContextBackgroundDefectRequest,
  parseAstraResponse, validateRequestEvidence, restorePreparedRequest, INSPECTION_CONTEXT_CROP_LAYOUT } from '../../atlas-defect-analysis/src/index.mjs';
import { readAnalysisRequest } from '../../atlas-defect-analysis/src/executor.mjs';
import { inputFixture, contextInputFixture, outputFixture, responseFixture } from '../../atlas-defect-analysis/test/fixtures.mjs';

async function savedAnalysisFixture({ background=false, contextLayout=false, receiptKind='RESPONSE', accepted=false, collectionExpired=false }={}) {
  const f = await fixture(), initial = f.card(), state = await f.state(), input = contextLayout ? contextInputFixture() : inputFixture();
  input.analysisId = f.analysisId; input.cardId = f.cardId; input.binding = defectAnalysisBinding(initial, state);
  for (const slot of input.images) slot.whole.sourceSha256 = input.binding.sides[slot.side].frame.inspectionImageSha256;
  const prepared = (contextLayout ? buildAstraContextBackgroundDefectRequest : background ? buildAstraBackgroundDefectRequest : buildAstraDefectRequest)(input);
  const output = outputFixture(prepared.evidence);
  if (contextLayout) output.findings[0].localContour = [{ x: 40, y: 40 }, { x: 50, y: 40 }, { x: 50, y: 52 }, { x: 40, y: 52 }];
  const raw = Buffer.from(JSON.stringify(responseFixture(prepared.evidence, output)));
  const parsed = parseAstraResponse(raw, prepared.evidence), source = { cardId: f.cardId, sourceHash: prepared.evidence.sourceBindingSha256 };
  const responseRef = await f.artifacts.write({ version: 1, analysisId: f.analysisId, requestHash: prepared.requestHash,
    sha256: digest(raw), base64: raw.toString('base64') }, { ...source, kind: 'DEFECT_RESPONSE' });
  const resultRef = await f.artifacts.write(parsed.result, { ...source, kind: 'DEFECT_RESULT' });
  const calls={provider:0,images:0},refusals=new Map();
  const provider = { bindingHash: digest('offline-review-provider'), dispatch: async () => { calls.provider++;throw Error('No provider dispatch permitted'); } };
  const evidence = canonical({ ...prepared.evidence, providerBindingHash: provider.bindingHash });
  const row = { id: f.analysisId, card_id: f.cardId, action_id: f.analysisId, actor_id: f.staff.id,
    binding: canonical(prepared.evidence.binding), binding_hash: digest(canonical(prepared.evidence.binding)),
    request_hash: prepared.requestHash, request_ref: JSON.stringify(responseRef), request_evidence: evidence, evidence_hash: digest(evidence),
    base_hash: digest(canonical({actionId:f.analysisId,base:Object.fromEntries(SIDES.map(side => [side, defectBase(state.defects, side)]))})), state: 'DISPATCHED', created_at: new Date(), expires_at: new Date(Date.now()+120000), dispatched_at: new Date() };
  const receipt = receiptKind==='OUTCOME'?{state:'UNKNOWN',responseRef:null,resultRef:null,responseHash:null,providerRequestId:null,responseId:null,httpStatus:null,usage:null,code:'DEFECT_ANALYSIS_OUTCOME_UNKNOWN'}:{ state: 'READY', responseRef, resultRef, responseHash: digest(raw), providerRequestId: 'offline-review-request',
    responseId: parsed.responseId, httpStatus: 200, usage: parsed.usage, code: null };
  const receivedAt=Date.now()-(collectionExpired?1801000:0);
  const acceptance=accepted?{responseId:'resp_fixture_pending',providerRequestId:'offline-acceptance-request',httpStatus:200,providerStatus:'queued',model:'gpt-6-astra',responseHash:digest('synthetic queued reply'),receivedAt:new Date(receivedAt).toISOString(),pollUntil:new Date(receivedAt+1800000).toISOString()}:null;
  const acceptedRow=acceptance?{analysis_id:f.analysisId,kind:'ACCEPTED',request_hash:row.request_hash,provider_binding_hash:provider.bindingHash,response_id:acceptance.responseId,evidence:canonical(acceptance),evidence_hash:digest(canonical(acceptance)),recorded_at:new Date()}:null;
  const principal = { id: f.staff.id, role: 'REVIEWER' };
  const tx = { async $queryRawUnsafe(sql,...args) {
    if (sql.includes('FROM atlas_defect_analysis.request_refusal') && !sql.includes('FROM atlas_defect_analysis.run r')) return [...refusals.values()].filter(value=>value.card_id===args[0] && (sql.includes('action_id=$2')?value.action_id:value.analysis_id)===args[1]);
    if(sql.includes('FROM atlas_defect_analysis.provider_event'))return acceptedRow?[acceptedRow]:[];
    if (sql.includes('FROM atlas_manual.card')) { const current = f.card(); return [{ id: f.cardId, owner_id: f.staff.id, editors: [], readers: [], approvers: [],
      revision: current.revision, content: canonical(current.draft), content_hash: current.contentHash }]; }
    if (sql.includes('FROM atlas_defect_analysis.run')) {
      if(sql.includes('replaces_analysis_id='))return [];
      if(args[1] && (sql.includes('action_id=$2')?row.action_id:row.id)!==args[1])return [];
      return [row];
    }
    if (sql.includes('FROM atlas_defect_analysis.receipt')) return row.state === 'PREPARED' || receiptKind===null ? [] : [{ kind: receiptKind, evidence: canonical(receipt), recorded_at: new Date() }];
    throw Error(`Unrecognized offline query: ${sql}`);
  },async $executeRawUnsafe(sql,...args){
    if(sql.startsWith('INSERT INTO atlas_defect_analysis.request_refusal')){
      const [card_id,action_id,analysis_id,actor_id,base_hash,code]=args;
      refusals.set(action_id,{card_id,action_id,analysis_id,actor_id,base_hash,code,created_at:new Date()});return 1;
    }
    throw Error(`Unrecognized offline write: ${sql}`);
  } };
  const boundary = { transaction: async (_staff, work) => work({ tx, principal, now: new Date(), refresh: async () => ({ principal, now: new Date() }) }) };
  const assistance = createDefectAssistance({ boundary, intakeRepository: { assertCurrentPair: async () => {} }, workflow: f.workflow,
    artifacts: f.artifacts, imageEffects: { createExemplar: async () => { throw Error('No exemplar effect permitted'); },currentImages:async()=>{calls.images++;throw Error('No image effects expected');} },
    memoryEnabled: true, provider, receiptClient: tx });
  return { ...f, assistance, prepared, parsed, row, receipt, acceptance, calls, refusals };
}

test('legacy V1/V2 and context V2 saved suggestions remain reviewable without new images, memory or provider dispatch', async () => {
  for (const options of [{}, { background: true }, { contextLayout: true }]) {
    const f = await savedAnalysisFixture(options), before = clone(f.row);
    const status = await f.assistance.status(f.staff, f.cardId, f.analysisId);
    assert.equal(status.astra.status, 'READY');
    assert.deepEqual(status.astra.proposals, f.parsed.result.proposals);
    const resolved = await f.assistance.resolveProposal({ staff: f.staff, card: f.card(), analysisId: f.analysisId,
      proposalId: f.parsed.result.proposals[0].id });
    assert.deepEqual(resolved.proposal, f.parsed.result.proposals[0]);
    // Replaying the original completed action performs only the saved read path.
    const state = await f.state();
    await f.assistance.analyze(f.staff, f.cardId, { actionId: f.analysisId,
      base: Object.fromEntries(SIDES.map(side => [side, defectBase(state.defects, side)])) });
    assert.deepEqual(f.row, before); assert.deepEqual(f.calls, { provider: 0, images: 0 });
  }
});

test('a new explicit connected analysis selects context image effects and stores exact context V2 request before provider work', async () => {
  const f = await fixture(), state = await f.state(), before = f.card();
  let imageCalls = 0, pendingRun;
  const stop = new Error('fixture stops at the database insert boundary');
  const tx = {
    async $queryRawUnsafe(sql) {
      if (sql.startsWith('WITH latest_action')) return [{ generation: 0, confirmation_hash: digest('empty'), pending: 0, selected: [] }];
      if (sql.includes('FROM atlas_manual.card')) return [{ id: f.cardId, owner_id: f.staff.id, editors: [], readers: [], approvers: [],
        revision: before.revision, content: canonical(before.draft), content_hash: before.contentHash }];
      if (sql.includes('FROM atlas_defect_analysis.')) return [];
      throw new Error(`Unexpected fixture read: ${sql}`);
    },
    async $executeRawUnsafe(sql, ...args) {
      assert(sql.startsWith('INSERT INTO atlas_defect_analysis.run'));
      pendingRun = { requestHash: args[6], requestRef: JSON.parse(args[7]), evidence: JSON.parse(args[8]), evidenceHash: args[9] };
      throw stop;
    },
  };
  const principal = { id: f.staff.id, role: 'REVIEWER' };
  const boundary = { transaction: async (staff, work) => {
    assert.equal(staff, f.staff);
    return work({ tx, principal, now: new Date(), refresh: async () => ({ principal, now: new Date() }) });
  } };
  const assistance = createDefectAssistance({ boundary, intakeRepository: { assertCurrentPair: async () => {} },
    workflow: f.workflow, artifacts: f.artifacts, memoryEnabled: true, receiptClient: tx,
    provider: { bindingHash: digest('connected synthetic provider'), dispatch: async () => assert.fail('Cannot dispatch before preparation commits') },
    imageEffects: {
      async currentImages(staff, card, binding, layout) {
        imageCalls++; assert.equal(staff, f.staff); assert.equal(card.cardId, f.cardId);
        assert.equal(layout, INSPECTION_CONTEXT_CROP_LAYOUT);
        const input = contextInputFixture();
        for (const slot of input.images) slot.whole.sourceSha256 = binding.sides[slot.side].frame.inspectionImageSha256;
        return input.images;
      },
      async lessonImages(knowledge) { assert.equal(knowledge.status, 'EMPTY_REVIEWED_BANK'); return []; },
    } });
  const actionId = randomUUID();
  await assert.rejects(assistance.analyze(f.staff, f.cardId, { actionId,
    base: Object.fromEntries(SIDES.map(side => [side, defectBase(state.defects, side)])) }), error => error === stop);
  assert.equal(imageCalls, 1); assert.equal(pendingRun.evidence.cropLayoutVersion, INSPECTION_CONTEXT_CROP_LAYOUT);
  validateRequestEvidence(pendingRun.evidence);
  const stored = await readAnalysisRequest(pendingRun.requestRef, { cardId: f.cardId,
    sourceHash: pendingRun.evidence.sourceBindingSha256 }, f.artifacts);
  const restored = restorePreparedRequest({ requestText: stored.bytes.toString('utf8'), requestHash: stored.manifest.requestHash,
    evidence: stored.manifest.evidence, evidenceHash: stored.manifest.evidenceHash });
  assert.equal(restored.evidence.analysisId, actionId);
  assert.equal(restored.requestHash, pendingRun.requestHash);
  assert.equal(restored.evidence.cropLayoutVersion, INSPECTION_CONTEXT_CROP_LAYOUT);
  assert.deepEqual(f.card(), before);
});

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

test('durable background acceptance projects RUNNING after admission expiry without borrowing a browser session for polling',async()=>{
  const f=await savedAnalysisFixture({background:true,accepted:true,receiptKind:null});
  f.row.expires_at=new Date(Date.now()-60000);
  const result=await f.assistance.status(f.staff,f.cardId,f.analysisId);
  assert.equal(result.state,'DISPATCHED');assert.equal(result.astra.status,'RUNNING');
  assert.equal(result.astra.backgroundAccepted,true);assert.equal(result.astra.resumeAvailable,false);
  assert.equal(result.astra.collectionStopped,undefined);
  assert.equal(result.astra.replacement,undefined);assert.deepEqual(f.calls,{provider:0,images:0});
});

test('verified accepted collection expiry projects a stopped UNKNOWN before or after its durable exhaustion receipt',async()=>{
  for(const receiptKind of [null,'OUTCOME']){
    const f=await savedAnalysisFixture({background:true,accepted:true,collectionExpired:true,receiptKind});
    if(receiptKind){f.receipt.code='DEFECT_ANALYSIS_POLL_WINDOW_EXHAUSTED';f.receipt.responseId=f.acceptance.responseId;}
    const result=await f.assistance.status(f.staff,f.cardId,f.analysisId);
    assert.equal(result.astra.status,'UNKNOWN');assert.equal(result.astra.backgroundAccepted,true);
    assert.equal(result.astra.collectionStopped,true);assert.equal(result.astra.resumeAvailable,false);
    assert.equal(result.astra.replacement,undefined);assert.deepEqual(f.calls,{provider:0,images:0});
  }
});

test('only the verified no-ID legacy UNKNOWN outcome exposes an explicit replacement token',async()=>{
  const f=await savedAnalysisFixture({receiptKind:'OUTCOME'}),before=clone(f.row);
  const result=await f.assistance.status(f.staff,f.cardId,f.analysisId);
  assert.equal(result.astra.status,'UNKNOWN');assert.equal(result.astra.backgroundAccepted,undefined);
  assert.equal(result.astra.collectionStopped,undefined);
  assert.deepEqual(result.astra.replacement,{analysisId:f.analysisId,outcomeHash:digest(canonical(f.receipt))});
  assert.deepEqual(f.row,before);assert.deepEqual(f.calls,{provider:0,images:0});
});

test('a different ordinary action while UNKNOWN is durably refused before image or paid work and cannot resume later',async()=>{
  const f=await savedAnalysisFixture({receiptKind:'OUTCOME'}),state=await f.state();
  const input={actionId:randomUUID(),base:Object.fromEntries(SIDES.map(side=>[side,defectBase(state.defects,side)]))};
  const refused=await f.assistance.analyze(f.staff,f.cardId,input);
  assert.equal(refused.state,'REFUSED');assert.equal(refused.astra.analysisId,input.actionId);
  assert.equal(refused.followLatest,true);
  assert.equal(refused.astra.resumeAvailable,false);assert.equal(f.refusals.get(input.actionId).code,'DEFECT_ANALYSIS_PENDING');
  assert.equal((await f.assistance.analyze(f.staff,f.cardId,input)).state,'REFUSED');
  assert.equal((await f.assistance.status(f.staff,f.cardId)).astra.analysisId,f.analysisId);
  assert.deepEqual(f.calls,{provider:0,images:0});
});

test('a stale replacement outcome is durably refused without hiding or modifying the old UNKNOWN run',async()=>{
  const f=await savedAnalysisFixture({receiptKind:'OUTCOME'}),state=await f.state(),before=clone(f.row);
  const input={actionId:randomUUID(),base:Object.fromEntries(SIDES.map(side=>[side,defectBase(state.defects,side)])),
    replacement:{analysisId:f.analysisId,outcomeHash:digest('different retained outcome')}};
  const refused=await f.assistance.analyze(f.staff,f.cardId,input);
  assert.equal(refused.state,'REFUSED');assert.equal(f.refusals.get(input.actionId).code,'DEFECT_ANALYSIS_REPLACEMENT_INVALID');
  assert.equal(refused.followLatest,true);
  assert.equal((await f.assistance.status(f.staff,f.cardId)).astra.analysisId,f.analysisId);
  assert.deepEqual(f.row,before);assert.deepEqual(f.calls,{provider:0,images:0});
});

test('an ordinary verified retirement does not request a latest-analysis handoff',async()=>{
  const f=await savedAnalysisFixture(),actionId=randomUUID();
  f.refusals.set(actionId,{card_id:f.cardId,action_id:actionId,analysis_id:actionId,actor_id:f.staff.id,
    base_hash:digest('ordinary retired request'),code:'DEFECT_ANALYSIS_STALE',created_at:new Date()});
  const result=await f.assistance.status(f.staff,f.cardId,actionId);
  assert.equal(result.state,'REFUSED');assert.equal(result.followLatest,undefined);
  assert.deepEqual(f.calls,{provider:0,images:0});
});

test('known provider acceptance never exposes or accepts a no-ID replacement even with an earlier UNKNOWN receipt',async()=>{
  const f=await savedAnalysisFixture({background:true,accepted:true,receiptKind:'OUTCOME'}),state=await f.state();
  assert.equal((await f.assistance.status(f.staff,f.cardId,f.analysisId)).astra.replacement,undefined);
  const input={actionId:randomUUID(),base:Object.fromEntries(SIDES.map(side=>[side,defectBase(state.defects,side)])),
    replacement:{analysisId:f.analysisId,outcomeHash:digest(canonical(f.receipt))}};
  assert.equal((await f.assistance.analyze(f.staff,f.cardId,input)).state,'REFUSED');
  assert.deepEqual(f.calls,{provider:0,images:0});
});
