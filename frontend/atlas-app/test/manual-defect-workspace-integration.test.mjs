import {reviewImagePreview} from '@atlas/manual-workspace';
import {reviewedMemoryState} from '../../../packages/atlas-manual-workspace/src/astra-review-ui.mjs';
import * as reviewAttention from '../lib/manual-review-attention.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import * as reviewFeedback from '../lib/review-feedback.mjs';
import * as analysisClient from '../lib/manual-defect-analysis-client.mjs';
import * as earlyGeometryClient from '../lib/early-geometry-client.mjs';

const require = createRequire(import.meta.url), babel = require('next/dist/compiled/babel/core'), nextRequire = createRequire(require.resolve('next/package.json'));
const compiled = babel.transformSync(readFileSync(new URL('../components/ManualCards.jsx', import.meta.url), 'utf8'), {
  filename: 'ManualCards.jsx', presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]], babelrc: false, configFile: false,
}).code;
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const base = Object.fromEntries(['FRONT', 'BACK'].map(side => [side, { cardId: 'card', side, findingRevision: 1 }]));
const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : node ?? '';
const all = (node, predicate, out = []) => { if (Array.isArray(node)) node.forEach(child => all(child, predicate, out));
  else if (node && typeof node === 'object') { if (predicate(node)) out.push(node); all(node.props?.children, predicate, out); } return out; };
function harness({ journal, finalReview = false, rapid = false, initialGeometrySide = null } = {}) {
  const values = new Map(journal ? [['atlas-defect-analysis:v1:staff:card', JSON.stringify(journal)]] : []), slots = [], effects = [], timers = new Map(), cleanups = [];
  let cursor = 0, tree, viewCallback;
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), Fragment: 'fragment',
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useCallback: callback => callback,
    useEffect(callback, deps) { const i = cursor++, prior = slots[i]; if (!prior || deps.some((value, n) => value !== prior[n])) { slots[i] = deps; effects.push(callback); } },
  };
  const f = { calls: [], actions: [], popups: [], closedPopups: 0, pending: false, current: { card: { revision: 1, contentHash: 'one' }, geometry: { confirmed: true },
    defects: { marker: 'saved-original-defects' }, images: { marker: 'original-grants' }, identity: {}, astra: { enabled: true, status: 'IDLE', proposals: [] }, reviewedMemory: { enabled: true, status: 'UNSAVED' } } };
  if (finalReview) Object.assign(f.current, { finalReview: { report: { proposedGrade: 9.5, findings: [] } },
    provisional: { state: 'READY', report: { proposedGrade: 9.5 }, reportHash: 'first-current' } });
  f.respond = async (path, options) => path.endsWith('/view') ? f.current : { astra: f.current.astra };
  f.preview = async () => ({ reportHash: 'exact-report-hash', sourceRevision: f.current.card.revision,
    sourceHash: f.current.card.contentHash, canCertify: true, report: {}, review: {} });
  const client = { recover: async () => { viewCallback(f.current); return f.current; }, hasPending: () => f.pending,
    execute: async action => { f.actions.push(action); await f.onExecute?.(action); return f.current; },
    reviewProposal: async input => { f.actions.push({ type: 'REVIEW_PROPOSAL', input }); return f.current; },
    editDefect: async input => { f.actions.push({ type: 'EDIT_DEFECT', input }); return f.current; }, previewReport: async () => f.preview() };
  const exports = {};
  vm.runInNewContext(compiled, { exports, crypto: { randomUUID }, localStorage: storage,
    setInterval: (callback, ms) => { timers.set(ms, callback); return ms; }, clearInterval: id => timers.delete(id),
    window: { addEventListener() {}, removeEventListener() {} }, require(name) {
      if (name === 'react') return react;
      if (name === '../lib/manual-review-attention.mjs') return reviewAttention;
      if (name === './ReviewAttention') return {__esModule:true,default:'ReviewAttention'};
      if (name === './RapidReviewControls') return {RapidActionDock:'RapidActionDock',RapidEditDock:'RapidEditDock'};
      if (name === '../lib/review-feedback.mjs') return {...reviewFeedback,primeReviewAudio(){},playReviewCompletion(){},playAtlasVoice(){}};
      if (name === '../lib/card-discard.mjs' || name === '../lib/batch-import.mjs') return {};
      if (name === 'next/router') return { useRouter: () => ({ events: { on() {}, off() {} } }) };
      if (name === 'next/link' || name === './Shell') return { default: name };
      if (name === './EarlyGeometryPreview') return {default:name,EarlyGeometryStatus:'EarlyGeometryStatus'};
      if (name === './ReportPhotoUploader') return {__esModule:true,default:'ReportPhotoUploader'};
      if (name === './ReportMarketPicker') return {__esModule:true,default:'ReportMarketPicker'};
      if (name === './ReportResearchPicker') return {__esModule:true,default:'ReportResearchPicker'};
      if (name === './DealerOfferPicker') return {__esModule:true,default:'DealerOfferPicker'};
      if (name === './ManualFinishing') return {__esModule:true,default:'ManualFinishing',openManualLabelPrintWindow:()=>{const popup={close(){f.closedPopups++;}};f.popups.push(popup);return popup;}};
      if (name === '../lib/early-geometry-client.mjs') return earlyGeometryClient;
      if (name === '@atlas/manual-workflow/client') return { createManualClient: options => { viewCallback = options.onView; return client; } };
      if (name === '@atlas/manual-workspace') return { PairedGeometryWorkspace: 'PairedGeometryWorkspace', reviewImagePreview };
      if (name === '@atlas/manual-workspace/defects') return { DefectReviewWorkspace: 'DefectReviewWorkspace',reviewedMemoryState };
      if (name === '@atlas/manual-workspace/report-review') return { FinalReportReview: 'FinalReportReview', MachineReportReview: 'MachineReportReview',CompletedReviewCard:'CompletedReviewCard' };
      if (name === '@atlas/manual-workspace/rapid-review') return {rapidReviewStatus:()=>({geometry:true,findings:true,unresolved:0}),approveRapidStage:async(stage,view,execute)=>execute({type:'EXPLICIT_STAGE',stage})};
      if (name === '@atlas/manual-workspace/defect-actions') return {defectBase:(_value,side)=>base[side],reviewedDefectFindingIds:(value,side)=>value.sides?.[side]?.findingReviews?.decisions?.map(item=>item.findingId)??[]};
      if (name === '@atlas/manual-workspace/geometry-actions') return { geometryStatus: value => value };
      if (name.startsWith('@atlas/')) return {};
      if (name === '../lib/manual-defect-analysis-client.mjs') return analysisClient;
      if (name === '../lib/routes.mjs') return { STAFF_BASE_PATH: '/admin' };
      if (name === '../lib/manual-client.mjs') return { manualMessage: error => error.code ?? 'Retained', manualRequest: async (path, options) => {
        f.calls.push({ path, options: options && structuredClone(options) }); return f.respond(path, options); } };
      return nextRequire(name.startsWith('@babel/runtime/') ? `next/dist/compiled/${name}` : name);
    } });
  f.render = () => { cursor = 0; tree = exports.ManualWorkspace({ staff: { id: 'staff', role: 'REVIEWER' }, cardId: 'card', csrf: 'csrf', rapid, initialGeometrySide, onQueued:value=>{f.queued=value;}, onBusyChange:value=>{f.locked=value;}, onPhotos() {} }); effects.splice(0).forEach(effect => { const cleanup = effect(); if (typeof cleanup === 'function') cleanups.push(cleanup); }); };
  f.tick = async (ms = 5000) => { const tick = timers.get(ms); if (!tick) return; tick(); await flush(); f.render(); };
  f.dispose = () => cleanups.splice(0).forEach(cleanup => cleanup());
  f.defects = () => { const node = all(tree, node => node.type === 'DefectReviewWorkspace')[0]; assert.ok(node, 'defect workspace rendered'); return node.props; };
  f.button = label => { const matcher=node=>node.type==='button'&&(text(node)===label||node.props['aria-label']===label); return all(tree,matcher)[0] ?? all(all(tree,node=>typeof node.props?.renderReviewActions==='function').map(node=>node.props.renderReviewActions({})),matcher)[0]; };
  f.geometry = () => all(tree, node => node.type === 'PairedGeometryWorkspace')[0]?.props;
  f.finishing = () => all(tree, node => node.type === 'ManualFinishing')[0]?.props;
  f.report = () => all(tree, node => node.type === 'FinalReportReview')[0]?.props;
  f.machine = () => all(tree,node=>node.type==='MachineReportReview')[0]?.props;
  f.text = () => text(tree);
  f.publish = next => { f.current = next; viewCallback(next); f.render(); };
  f.render(); return f;
}

test('final correction workspace shows the current computed grade and hides it while measurement is pending without creating human decisions', async () => {
  const f = harness({ finalReview: true }); await flush(); f.render();
  assert.match(f.text(), /Current provisional grade: 9.5/); assert.equal(f.actions.length, 0);
  f.publish({ ...f.current, card: { revision: 2, contentHash: 'pending' }, provisional: { state: 'PENDING' } });
  assert.match(f.text(), /Preparation or measurement is incomplete/); assert.doesNotMatch(f.text(), /Current provisional grade: 9.5/);
  f.publish({ ...f.current, card: { revision: 3, contentHash: 'measured' }, provisional: { state: 'READY', report: { proposedGrade: 8 }, reportHash: 'updated' } });
  assert.match(f.text(), /Current provisional grade: 8/);
  f.button('Findings').props.onClick(); await flush(); f.render();
  assert.equal(f.defects().grade, 8); assert.equal(f.actions.length, 0); assert.equal(f.popups.length, 0);
  f.dispose();
});

test('actual staff parent refreshes analysis assistance without replacing a newer saved finding edit or leaving its editor', async () => {
  const f = harness(); await flush(); f.render(); const old = structuredClone(f.current); let complete;
  f.respond = (path, options) => {
    if (options?.method === 'POST') return new Promise(resolve => { complete = () => resolve({ astra: { enabled: true, status: 'READY', analysisId: options.body.actionId, base, proposals: [] } }); });
    return old;
  };
  const analysis = f.defects().onAnalyzeDefects({ base, actor: 'HUMAN' });
  f.defects().onEditingChange(true); f.publish({ ...f.current, card: { revision: 2, contentHash: 'two' }, defects: { marker: 'new-human-trace' } });
  complete(); await analysis; f.render();
  assert.equal(f.defects().workspace.marker, 'new-human-trace'); assert.equal(f.defects().astra.status, 'READY');
  assert.equal(f.button('Photos').props.disabled, true, 'analysis completion does not clear the active editor');
  assert.equal(f.actions.length, 0, 'analysis never confirms, inspects or measures a finding');
});

test('exact NOT_FOUND remains recoverable after a stale assistance view and only explicit resume POSTs the same request', async () => {
  const f = harness(); await flush(); f.render(); const saved = f.current; let first = true;
  f.respond = async (path, options) => {
    if (path.endsWith('/view')) return saved;
    if (options?.method === 'POST' && first) { first = false; throw Error('Lost result'); }
    if (options?.method === 'POST') return { astra: { enabled: true, status: 'READY', analysisId: options.body.actionId, base, proposals: [] } };
    return { state: 'NOT_FOUND' };
  };
  await assert.rejects(f.defects().onAnalyzeDefects({ base })); f.render(); await f.defects().onRefreshAnalysis(); f.render();
  assert.equal(f.defects().astra.status, 'UNKNOWN'); assert.equal(f.defects().astra.resumeAvailable, true);
  const before = f.calls.filter(call => call.options?.method === 'POST'); assert.equal(before.length, 1);
  await f.defects().onResumeAnalysis(); f.render();
  const posts = f.calls.filter(call => call.options?.method === 'POST'); assert.equal(posts.length, 2);
  assert.deepEqual(posts[0].options.body, posts[1].options.body);
  assert.equal(f.defects().astra.status, 'READY', 'an older same-card view cannot undo acknowledged analysis');
});

test('proposal acceptance and correction use the normal side measurement; rejection sends no measurement', async () => {
  const f = harness(); await flush(); f.render();
  for (const action of ['ACCEPT', 'TRACE_SAVE', 'REJECT']) {
    f.actions.length = 0;
    const input = { side: 'FRONT', base: base.FRONT, analysisId: 'analysis', proposalId: 'proposal', action };
    await f.defects().onReviewProposal(input); await flush();
    assert.equal(f.actions[0].type, 'REVIEW_PROPOSAL'); assert.equal(f.actions[0].input, input);
    assert.equal(f.actions.length, action === 'REJECT' ? 1 : 2);
    if (action !== 'REJECT') assert.deepEqual(JSON.parse(JSON.stringify(f.actions[1])), { type: 'MEASURE_SIDE', side: 'FRONT' });
  }
});

test('publication acknowledgement for older findings cannot mark a new manual revision saved', async () => {
  const f = harness(); await flush(); f.render(); let finish;
  f.respond = (path, options) => options?.method === 'POST' ? new Promise(resolve => { finish = resolve; }) : f.current;
  const saving = f.defects().onRetryReviewedMemory();
  f.publish({ ...f.current, card: { revision: 2, contentHash: 'two' }, reviewedMemory: { enabled: true, status: 'UNSAVED' }, defects: { marker: 'changed-after-confirmation' } });
  finish({ reviewedMemory: { enabled: true, status: 'SAVED' } }); await saving; f.render();
  assert.equal(f.defects().reviewedMemory.status, 'UNSAVED'); assert.equal(f.defects().workspace.marker, 'changed-after-confirmation');
  assert.equal(f.actions.length, 0);
});

test('mount with an unknown saved analysis performs exact GET only and leaves manual review usable', async () => {
  const id = '33333333-3333-4333-8333-333333333333';
  const f = harness({ journal: { version: 1, phase: 'PENDING', canResume: false, body: { actionId: id, base } } });
  f.respond = async () => ({ astra: { enabled: true, analysisId: id, status: 'UNKNOWN', base, proposals: [] } });
  await flush(); f.render();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].path.endsWith(`/${id}`), true);
  assert.equal(f.calls[0].options.method, undefined); assert.equal(f.defects().astra.status, 'UNKNOWN');
  assert.equal(f.button('Photos').props.disabled, false); assert.equal(f.actions.length, 0);
});

test('an image-grant refresh begun before publication acknowledgement cannot revert saved examples to pending', async () => {
  const f = harness(); await flush(); f.render();
  f.publish({ ...f.current, reviewedMemory: { enabled: true, status: 'PENDING' } });
  const earlier = structuredClone(f.current); let finish, reads = 0;
  f.respond = (path, options) => {
    if (options?.method === 'POST') { f.current = { ...f.current, reviewedMemory: { enabled: true, status: 'SAVED' } }; return { reviewedMemory: f.current.reviewedMemory }; }
    if (reads++ === 0) return new Promise(resolve => { finish = resolve; });
    return f.current;
  };
  const loading = f.button('Reload images').props.onClick();
  await f.defects().onRetryReviewedMemory(); f.render(); assert.equal(f.defects().reviewedMemory.status, 'SAVED');
  finish(earlier); await loading; f.render(); assert.equal(f.defects().reviewedMemory.status, 'SAVED');
});


test('accepted background analysis refreshes with GET only and preserves an active human edit', async () => {
  const f = harness(); await flush(); f.render(); let analysisId;
  f.respond = async (path, options) => {
    if (path.endsWith('/view')) return f.current;
    if (options?.method === 'POST') { analysisId = options.body.actionId; return { astra: { enabled: true, status: 'RUNNING', backgroundAccepted: true, analysisId, base, proposals: [] } }; }
    assert.equal(path.endsWith('/' + analysisId), true);
    return { astra: { enabled: true, status: 'READY', analysisId, base, proposals: [] } };
  };
  await f.defects().onAnalyzeDefects({ base }); f.render(); assert.equal(f.defects().astra.status, 'RUNNING');
  f.defects().onEditingChange(true); f.publish({ ...f.current, card: { revision: 2, contentHash: 'edited' }, defects: { marker: 'unsaved-editor-still-open' } });
  const before = f.calls.length; await f.tick();
  assert.equal(f.calls.length, before + 1); assert.equal(f.calls.at(-1).options.method, undefined);
  assert.equal(f.defects().astra.status, 'READY'); assert.equal(f.defects().workspace.marker, 'unsaved-editor-still-open');
  assert.equal(f.button('Photos').props.disabled, true); assert.equal(f.actions.length, 0);
  await f.tick(); assert.equal(f.calls.length, before + 1, 'settled analysis stops polling');
  assert.equal(f.calls.filter(call => call.options?.method === 'POST').length, 1);
  f.dispose();
});

test('status polling pauses after session denial and unmount removes its timer', async () => {
  const id = '44444444-4444-4444-8444-444444444444';
  const f = harness({ journal: { version: 1, phase: 'PENDING', canResume: false, body: { actionId: id, base } } });
  let reads = 0;
  f.respond = async () => {
    if (reads++ === 0) return { astra: { enabled: true, status: 'RUNNING', backgroundAccepted: true, analysisId: id, base, proposals: [] } };
    throw { status: 401, code: 'SIGN_IN_REQUIRED' };
  };
  await flush(); f.render(); await f.tick(); const count = f.calls.length;
  await f.tick(); assert.equal(f.calls.length, count); assert.equal(count, 2);
  assert.equal(f.calls.every(call => call.options.method === undefined), true);
  f.dispose(); await f.tick(); assert.equal(f.calls.length, count);
});

test('exhausted background collection stops automatic browser polling without starting another analysis', async () => {
  const id = '44444444-4444-4444-8444-444444444444';
  const f = harness({ journal: { version: 1, phase: 'PENDING', canResume: false, body: { actionId: id, base } } });
  f.respond = async () => ({ astra: { enabled: true, status: 'UNKNOWN', backgroundAccepted: true,
    collectionStopped: true, analysisId: id, base, proposals: [] } });
  await flush(); f.render(); const count = f.calls.length;
  await f.tick(); await f.tick();
  assert.equal(f.calls.length, count); assert.equal(f.defects().astra.collectionStopped, true);
  assert.equal(f.calls.every(call => call.options.method === undefined), true);
  f.dispose();
});

test('staff parent sends one explicit collective confirmation with the offered roster and no browser adoption loop', async () => {
  const f = harness(); await flush(); f.render();
  const proposalReview = { analysisId: randomUUID(), resultHash: 'a'.repeat(64), proposalIds: ['proposal-one', 'proposal-two'] };
  await f.defects().onConfirm({ base, reviewed: true, actor: 'HUMAN', proposalReview });
  assert.deepEqual(JSON.parse(JSON.stringify(f.actions)), [{ type: 'CONFIRM_FINDINGS', base, reviewed: true, proposalReview }]);
  f.dispose();
});

test('opening the full draft is read-only and approval requires verified images and the exact displayed revision', async () => {
  const f = harness(); await flush(); f.render();
  await f.defects().onContinue(); f.render();
  assert.equal(f.report().preview.reportHash, 'exact-report-hash'); assert.equal(f.report().current, true);
  assert.equal(f.actions.length, 0); assert.equal(f.button('Approve & print label').props.disabled, true);
  await f.button('Approve & print label').props.onClick(); assert.equal(f.actions.length, 0);
  f.report().onReadyChange(true); f.render(); assert.equal(f.button('Approve & print label').props.disabled, false);
  await f.button('Approve & print label').props.onClick(); f.render();
  assert.deepEqual(JSON.parse(JSON.stringify(f.actions)), [{ type: 'APPROVE_REPORT', reportHash: 'exact-report-hash', reviewed: true }]);
  f.publish({ ...f.current, card: { revision: 2, contentHash: 'changed-after-preview' } });
  assert.equal(f.report().current, false);
  await f.button('Approve & print label').props.onClick(); assert.equal(f.actions.length, 1, 'a stale enabled callback cannot approve changed content');
  f.dispose();
});

test('manual review explains missing certification and prevents approval or print effects before a current preview', async () => {
  const f = harness(); await flush(); f.render(); const preview = f.preview;
  f.preview = async () => ({ ...await preview(), canCertify: false });
  await f.defects().onContinue(); f.render(); f.report().onReadyChange(true); f.render();
  assert.equal(f.button('Approve & print label').props.disabled, true);
  assert.match(f.text(), /Your account has no current report certification/);
  await f.button('Approve & print label').props.onClick();
  assert.equal(f.actions.length, 0); assert.equal(f.popups.length, 0);
  f.preview = preview;
  await f.button('Refresh report').props.onClick(); f.render();
  assert.equal(f.report().preview.canCertify, true);
  assert.equal(f.button('Approve & print label').props.disabled, false, 'the unchanged report retains its verified images');
  assert.equal(f.actions.length, 0); assert.equal(f.popups.length, 0); f.dispose();
});

test('certification refusal after a preview closes the popup and updates guidance without retrying approval', async () => {
  const f = harness(); await flush(); f.render();
  await f.defects().onContinue(); f.render(); f.report().onReadyChange(true); f.render();
  f.onExecute = () => { throw { code: 'MANUAL_CERTIFICATION_REQUIRED' }; };
  await f.button('Approve & print label').props.onClick(); f.render();
  assert.equal(f.closedPopups, 1); assert.equal(f.actions.length, 1);
  assert.equal(f.button('Approve & print label').props.disabled, true);
  assert.match(f.text(), /Your account has no current report certification/);
  await f.button('Approve & print label').props.onClick();
  assert.equal(f.actions.length, 1); assert.equal(f.popups.length, 1); f.dispose();
});

test('a report response that arrives after a newer saved edit is refused before display', async () => {
  const f = harness(); await flush(); f.render(); let finish;
  f.preview = () => new Promise(resolve => { finish = resolve; });
  const opening = f.defects().onContinue();
  f.publish({ ...f.current, card: { revision: 2, contentHash: 'two' } });
  finish({ reportHash: 'old-report', sourceRevision: 1, sourceHash: 'one', report: {}, review: {} });
  await opening; f.render();
  assert.equal(f.report(), undefined); assert.ok(f.defects()); assert.match(f.text(), /MANUAL_REPORT_STALE/);
  assert.equal(f.actions.length, 0); f.dispose();
});

const finishingPublication = { actionId: 'approved-action', state: 'PUBLISHED', reportHash: 'exact-report-hash', publicHash: 'published-packet', version: 1, reportNumber: 'ATLAS-EXAMPLE' };
const finishingPlan = { id: 'synthetic-plan', binding: { cardId: 'card', approvalActionId: 'approved-action', reportHash: 'exact-report-hash', publicHash: 'published-packet', approvalVersion: 1 } };
test('reopening an approved report only reads its saved label and never owns a print popup', async () => {
  const f = harness(); await flush(); f.render();
  f.publish({ ...f.current, approval: { sourceHash: 'one', reportHash: 'exact-report-hash' }, publication: finishingPublication });
  f.respond = async path => path.includes('/finishing/') ? finishingPlan : f.current;
  await f.defects().onContinue(); f.render(); await flush(); f.render();
  assert.equal(f.finishing().plan.id, 'synthetic-plan'); assert.equal(f.finishing().autoPrintWindow, null); assert.equal(f.popups.length, 0);
  assert.equal(f.calls.filter(call => call.path.includes('/finishing/')).length, 1);
  assert.equal(f.calls.filter(call => call.options?.method === 'POST').length, 0); f.dispose();
});
test('one explicit approval gesture hands its popup to the exact saved label after publication', async () => {
  const f = harness(); await flush(); f.render();
  f.respond = async path => path.includes('/finishing/') ? finishingPlan : f.current;
  f.onExecute = () => f.publish({ ...f.current, approval: { sourceHash: 'one', reportHash: 'exact-report-hash' }, publication: finishingPublication });
  await f.defects().onContinue(); f.render(); f.report().onReadyChange(true); f.render();
  await f.button('Approve & print label').props.onClick(); f.render(); await flush(); f.render();
  assert.equal(f.popups.length, 1); assert.equal(f.closedPopups, 0); assert.equal(f.finishing().autoPrintWindow, f.popups[0]);
  assert.equal(f.finishing().plan.binding.approvalActionId, finishingPublication.actionId);
  assert.equal(f.calls.filter(call => call.path.includes('/finishing/')).length, 1); assert.equal(f.actions.length, 1);
  f.render(); assert.equal(f.popups.length, 1); f.dispose();
});

test('returning to Findings discards the displayed report and opens a fresh corrected draft without implicit approval', async () => {
  const f = harness(); await flush(); f.render(); let previews = 0;
  f.preview = async () => ({ reportHash: `report-${++previews}`, sourceRevision: f.current.card.revision,
    sourceHash: f.current.card.contentHash, report: {}, review: {} });
  await f.defects().onContinue(); f.render(); f.report().onReadyChange(true); f.render();
  await f.button('Findings').props.onClick(); f.render(); assert.equal(f.report(), undefined); assert.ok(f.defects());
  f.publish({ ...f.current, card: { revision: 2, contentHash: 'corrected' } });
  await f.defects().onContinue(); f.render();
  assert.equal(f.report().preview.reportHash, 'report-2'); assert.equal(f.report().preview.sourceHash, 'corrected');
  assert.equal(f.button('Approve & print label').props.disabled, true, 'new report must verify its images again');
  assert.equal(f.actions.length, 0); f.dispose();
});

test('stage navigation is immediate while one background image-grant refresh is pending',async()=>{
  const f=harness();await flush();f.render();let finish;
  f.respond=()=>new Promise(resolve=>{finish=resolve;});
  f.button('Geometry').props.onClick();f.render();
  assert.ok(f.geometry(),'geometry opens without waiting for the network');assert.equal(f.geometry().images.marker,'original-grants');
  assert.equal(f.button('Findings').props.disabled,false);assert.equal(f.button('Photos').props.disabled,false);
  f.button('Findings').props.onClick();f.render();assert.ok(f.defects());assert.equal(f.calls.filter(call=>call.path.endsWith('/view')).length,1,'switches share the existing refresh');
  finish({...f.current,images:{marker:'renewed-grants'}});await flush();f.render();
  assert.equal(f.defects().images.marker,'renewed-grants');assert.equal(f.actions.length,0);f.dispose();
});

test('background navigation refresh cannot replace a new save or active editor and a failed refresh leaves the stage usable',async()=>{
  const f=harness();await flush();f.render();let finish;
  const earlier=structuredClone(f.current);f.respond=()=>new Promise(resolve=>{finish=resolve;});
  f.button('Geometry').props.onClick();f.render();f.geometry().onEditingChange(true);
  f.publish({...f.current,card:{revision:2,contentHash:'new'},images:{marker:'new-pixels'}});
  finish(earlier);await flush();f.render();assert.ok(f.geometry());assert.equal(f.geometry().images.marker,'new-pixels');
  assert.equal(f.button('Findings').props.disabled,true);assert.doesNotMatch(f.text(),/MANUAL_REVISION_CONFLICT/);
  f.geometry().onEditingChange(false);f.render();f.respond=async()=>{throw {code:'IMAGE_ACCESS_UNAVAILABLE'};};
  f.button('Findings').props.onClick();f.render();assert.ok(f.defects());await flush();f.render();
  assert.ok(f.defects());assert.match(f.text(),/IMAGE_ACCESS_UNAVAILABLE/);assert.equal(f.actions.length,0);f.dispose();
});

const preparedReview = current => {
  const sides=Object.fromEntries(['FRONT','BACK'].map((side,index)=>{
    const frame={id:`prepared-${side}`,version:1,inspection:{sha256:String(index+1).repeat(64)},rectified:{sha256:String(index+3).repeat(64)}};
    return [side,{image:{version:1,originalSha256:String(index+5).repeat(64)},physical:{actor:'ENGINE'},prepared:{frame},printed:null}];
  }));
  return {...current,geometry:{confirmed:false,sides},defects:{sides:Object.fromEntries(Object.entries(sides).map(([side,slot])=>[side,{
    frame:{frameId:slot.prepared.frame.id,preparationVersion:1,imageVersion:1,originalSha256:slot.image.originalSha256,
      inspectionImageSha256:slot.prepared.frame.inspection.sha256,rectifiedImageSha256:slot.prepared.frame.rectified.sha256},findings:[]}
  ]))}};
};
test('partial final review permits Findings in the exact prepared physical frame without printed borders or geometry confirmation',async()=>{
  const f=harness({finalReview:true});await flush();f.render();
  f.publish({...preparedReview(f.current),provisional:{state:'READY',report:{proposedGrade:null,calculationState:'GEOMETRY_UNRESOLVED'}}});
  assert.match(f.text(),/Centering geometry needs review/);assert.doesNotMatch(f.text(),/Updating measurements|Current provisional grade: null/);
  assert.equal(f.button('Findings').props.disabled,false);f.button('Findings').props.onClick();f.render();
  assert.ok(f.defects());assert.equal(f.defects().grade,undefined);assert.equal(f.actions.length,0);
  f.button('Geometry').props.onClick();f.render();
  f.publish({...f.current,defects:{sides:{...f.current.defects.sides,FRONT:{...f.current.defects.sides.FRONT,frame:{...f.current.defects.sides.FRONT.frame,frameId:'wrong-frame'}}}}});
  assert.equal(f.button('Findings').props.disabled,true);f.button('Findings').props.onClick();f.render();assert.ok(f.geometry());
  f.dispose();
});
test('unsaved geometry and finding edits suppress saved grade until saved or discarded',async()=>{
  const f=harness({finalReview:true});await flush();f.render();
  f.button('Findings').props.onClick();f.render();assert.equal(f.defects().grade,9.5);
  f.defects().onEditingChange(true);f.render();assert.equal(f.defects().grade,undefined);
  assert.match(f.text(),/Unsaved changes/);assert.doesNotMatch(f.text(),/Current provisional grade:/);
  f.defects().onEditingChange(false);f.render();assert.equal(f.defects().grade,9.5);
  f.button('Geometry').props.onClick();f.render();f.geometry().onEditingChange(true);f.render();
  assert.match(f.text(),/Unsaved changes/);assert.doesNotMatch(f.text(),/Current provisional grade:/);
  f.geometry().onEditingChange(false);f.render();assert.match(f.text(),/Current provisional grade: 9.5/);assert.equal(f.actions.length,0);f.dispose();
});
test('failed physical preparation exposes an explicit same-side restore command and recovers Findings access without approval',async()=>{
  const f=harness({finalReview:true});await flush();f.render();const prepared=preparedReview(f.current);
  f.publish({...prepared,card:{...prepared.card,draft:{geometryBeforeEdit:{FRONT:{ref:{id:'retained-original'}}}}},
    geometry:{...prepared.geometry,sides:{...prepared.geometry.sides,FRONT:{...prepared.geometry.sides.FRONT,prepared:null}}},provisional:{state:'PENDING'}});
  assert.equal(f.button('Findings').props.disabled,true);assert.match(f.text(),/restore the previous outline, correct the finding/);
  f.onExecute=action=>{if(action.type==='RESTORE_GEOMETRY')f.publish(prepared);};
  await f.button('Restore Front previous outline').props.onClick();f.render();
  assert.deepEqual(JSON.parse(JSON.stringify(f.actions)),[{type:'RESTORE_GEOMETRY',side:'FRONT'}]);
  assert.ok(f.geometry());assert.equal(f.button('Findings').props.disabled,false);
  assert.equal(f.button('Restore Front previous outline'),undefined);assert.equal(f.popups.length,0);f.dispose();
});


test('rapid review waits for verified photos, adjustments stay inside, and final approval queues without a print popup', async()=>{
 const f=harness({finalReview:true,rapid:true});await flush();f.render();
 assert.equal(f.machine().inspectionMode,'geometry');assert.equal(f.button('Approve geometry').props.disabled,true);assert.equal(f.actions.length,0);
 f.machine().onReadyChange(true);f.render();f.button('Adjust Geometry').props.onClick();await flush();f.render();assert.ok(f.geometry());assert.equal(f.actions.length,0);
 f.button('← Back').props.onClick();await flush();f.render();f.machine().onReadyChange(true);f.render();
 await f.button('Approve geometry').props.onClick();await flush();f.render();assert.equal(f.machine().inspectionMode,'findings');assert.equal(f.button('Approve findings').props.disabled,true);
 f.machine().onReadyChange(true);f.render();await f.button('Approve findings').props.onClick();await flush();f.render();assert.ok(f.report());assert.equal(f.popups.length,0);
 assert.deepEqual(f.actions.map(a=>a.type),['EXPLICIT_STAGE','EXPLICIT_STAGE']);
 f.report().onReadyChange(true);f.render();await f.button('Approve final grade and queue label').props.onClick();await flush();f.render();
 assert.equal(f.actions.at(-1).type,'APPROVE_REPORT');assert.equal(f.actions.at(-1).reportHash,'exact-report-hash');assert.equal(f.popups.length,0);f.dispose();
});

test('rapid correction confirmation opens the final grade directly and a failed save stays in corrections',async()=>{
 const f=harness({finalReview:true,rapid:true});await flush();f.render();
 f.machine().onReadyChange(true);f.render();await f.button('Approve geometry').props.onClick();await flush();f.render();
 f.button('Adjust Defects').props.onClick();await flush();f.render();
 f.onExecute=async()=>{throw Error('save failed');};
 await assert.rejects(f.defects().onConfirm({base:{},reviewed:true}));f.render();assert.ok(f.defects());assert.equal(f.report(),undefined);
 f.onExecute=undefined;await f.defects().onConfirm({base:{},reviewed:true});await flush();f.render();
 assert.ok(f.report());assert.equal(f.button('Approve findings'),undefined);assert.equal(f.actions.filter(a=>a.type==='APPROVE_REPORT').length,0);f.dispose();
});


test('approved review opens a calm completion screen with saved award, lazy extras and retained correction path',async()=>{
  const f=harness({finalReview:true});await flush();f.render();
  f.preview=async()=>({reportHash:'exact-report-hash',sourceRevision:1,sourceHash:'one',report:{version:'atlas-manual-draft-report-v2',identity:{cardName:'Abomasnow'},finalGrade:10,grade:{overall:{displayGrade:9.9}}}});
  f.publish({...f.current,approval:{sourceHash:'one',reportHash:'exact-report-hash'},publication:finishingPublication});
  f.respond=async path=>path.includes('/finishing/')?finishingPlan:f.current;
  f.button('Findings').props.onClick();await flush();f.render();await f.defects().onContinue();f.render();await flush();f.render();
  assert.match(f.text(),/Completed.*Abomasnow.*APPROVED GRADE10/);assert.match(f.text(),/Review next card/);
  assert.doesNotMatch(f.text(),/Final human review|Current provisional|View current provisional|Approved. Preserved|Optional report tools/);
  assert.equal(f.report(),undefined);assert.equal(f.button('Geometry'),undefined);assert.equal(f.finishing().compact,true);
  const calls=f.calls.length;await f.tick(240000);assert.equal(f.calls.length,calls,'completed review does not keep refreshing image grants');
  f.button('More options +').props.onClick();f.render();assert.match(f.text(),/Optional report tools/);
  f.button('Correct findings').props.onClick();await flush();f.render();assert.ok(f.defects());assert.equal(f.actions.length,0);
  f.dispose();
});

test('rapid approval advances without fetching a label; optional label failure cannot undo saved review',async()=>{
  const f=harness({finalReview:true,rapid:true});await flush();f.render();
  f.machine().onReadyChange(true);f.render();await f.button('Approve geometry').props.onClick();f.render();
  f.machine().onReadyChange(true);f.render();await f.button('Approve findings').props.onClick();f.render();
  f.report().onReadyChange(true);f.render();
  f.onExecute=action=>{if(action.type==='APPROVE_REPORT')f.publish({...f.current,approval:{sourceHash:'one',reportHash:'exact-report-hash'},publication:finishingPublication});};
  f.respond=async path=>{if(path.includes('/finishing/'))throw {code:'SIGN_IN_REQUIRED'};return f.current;};
  await f.button('Approve final grade and queue label').props.onClick();f.render();await flush();f.render();
  assert.match(f.text(),/Completed/);assert.equal(f.report(),undefined);assert.equal(f.popups.length,0);
  assert.equal(f.calls.filter(call=>call.path.includes('/finishing/')).length,0);
  assert.equal(f.button('Next card →').props.disabled,false);
  f.button('Print label / station').props.onClick();f.render();await flush();f.render();
  assert.match(f.text(),/Your grade is saved. SIGN_IN_REQUIRED/);assert.equal(f.button('Next card →').props.disabled,false);
  f.button('Next card →').props.onClick();assert.equal(f.queued.actionId,finishingPublication.actionId);
  assert.equal(f.actions.filter(action=>action.type==='APPROVE_REPORT').length,1);f.dispose();
});

test('publication pending remains a saved approval with explicit retry and no false ready label',async()=>{
  const f=harness();await flush();f.render();
  f.publish({...f.current,approval:{sourceHash:'one',reportHash:'exact-report-hash'},publication:{...finishingPublication,state:'PENDING',retryable:true}});
  await f.defects().onContinue();f.render();await flush();f.render();
  assert.match(f.text(),/Grade approved and saved. Report publication still needs attention/);assert.ok(f.button('Retry report publication'));
  assert.equal(f.button('Next card →'),undefined);assert.equal(f.finishing(),undefined);assert.equal(f.actions.length,0);f.dispose();
});


test('individual accepts await durable save, reload from saved progress and require a separate final findings confirmation',async()=>{
 const f=harness({finalReview:true,rapid:true});await flush();f.render();
 const findings=[{id:'a',side:'FRONT'},{id:'b',side:'FRONT'},{id:'c',side:'BACK'}];
 f.publish({...f.current,defects:{sides:{FRONT:{pending:null},BACK:{pending:null}}},provisional:{...f.current.provisional,report:{...f.current.provisional.report,findings}}});
 f.onExecute=async action=>{
   if(action.type!=='REVIEW_FINDING')return;
   const slot=f.current.defects.sides[action.side];
   f.publish({...f.current,defects:{sides:{...f.current.defects.sides,[action.side]:{...slot,findingReviews:{decisions:[...(slot.findingReviews?.decisions??[]),{findingId:action.findingId}]}}}}});
 };
 f.machine().onReadyChange(true);f.render();await f.button('Approve geometry').props.onClick();f.render();
 f.machine().onReadyChange(true);f.render();assert.equal(f.machine().guidedFindingId,'a');
 f.machine().onFindingSelect('c');f.render();await f.button('Approve defect 3 of 3').props.onClick();f.render();
 assert.equal(f.machine().guidedFindingId,'a');assert.equal(f.actions.filter(a=>a.type==='REVIEW_FINDING').length,1);
 assert.equal(f.actions.some(a=>a.stage==='findings'),false,'one saved decision never confirms the full review');
 await f.button('Approve defect 1 of 3').props.onClick();f.render();assert.equal(f.machine().guidedFindingId,'b');
 // A new response/report hash must retain real saved progress, rather than resetting a local Set.
 f.publish({...f.current,provisional:{...f.current.provisional,reportHash:'new-projection'}});
 assert.match(f.text(),/2 of 3 decisions saved/);
 f.machine().onReadyChange(true);f.render();await f.button('Approve defect 2 of 3').props.onClick();f.render();
 assert.equal(f.report(),undefined);assert.match(f.text(),/All findings reviewed/);
 await f.button('Approve defect 2 of 3').props.onClick();f.render();assert.ok(f.report());
 assert.equal(f.actions.at(-1).stage,'findings');assert.equal(f.actions.some(a=>a.type==='APPROVE_REPORT'),false);f.dispose();
});

test('explicit photo editor entry opens geometry even when a final report exists and prioritizes the chosen side',async()=>{
 const f=harness({finalReview:true,initialGeometrySide:'BACK'});
 f.current.geometry={confirmed:false,sides:{FRONT:{image:{}},BACK:{image:{}}}};
 await flush();f.render();
 assert.ok(f.geometry());assert.deepEqual(f.geometry().attention.map(i=>i.side),['BACK','FRONT']);
 assert.equal(f.machine(),undefined);assert.deepEqual(f.actions,[]);f.dispose();
});

test('background recovery saves the exact selected side before preparing it and never requests analysis',async()=>{
 const f=harness({initialGeometrySide:'BACK'});f.current.defects=null;
 await flush();f.render();const input={side:'BACK',base:{marker:'exact-settings-base'},matColor:'WHITE'};
 await f.geometry().onBackground(input);
 assert.deepEqual(JSON.parse(JSON.stringify(f.actions)),[{type:'SET_PHOTO_BACKGROUND',...input},{type:'PREPARE_SIDE',side:'BACK'}]);
 assert.ok(f.calls.every(c=>c.options?.method!=='POST'));f.dispose();
});
test('background recovery never prepares after an uncertain settings save and is absent for retained findings',async()=>{
 const f=harness({initialGeometrySide:'FRONT'});await flush();f.render();assert.equal(f.geometry().onBackground,undefined);
 f.publish({...f.current,defects:null});f.onExecute=async()=>{throw {code:'REPLY_UNCERTAIN'};};
 await assert.rejects(f.geometry().onBackground({side:'FRONT',base:{},matColor:'WHITE'}));
 assert.deepEqual(f.actions.map(a=>a.type),['SET_PHOTO_BACKGROUND']);f.dispose();
});

test('failed display retry keeps its exact source/job action across lost acknowledgement and only reloads grants afterward',async()=>{
 const f=harness({initialGeometrySide:'FRONT'});await flush();f.render();
 const retry={jobId:'display-job',photoSourceHash:'a'.repeat(64)};
 f.publish({...f.current,images:{FRONT:{original:{displayState:{state:'FAILED',retry}}}}});
 let failed=true;f.respond=async(path,options)=>{if(path.endsWith('/display-retry')){if(failed){failed=false;throw {code:'LOST_ACK'};}return {state:'PENDING'};}return f.current;};
 await assert.rejects(f.geometry().onRetryDisplay({side:'FRONT',...retry}),error=>error.code==='LOST_ACK');
 await f.geometry().onRetryDisplay({side:'FRONT',...retry});
 const posts=f.calls.filter(call=>call.path.endsWith('/display-retry'));
 assert.equal(posts.length,2);assert.deepEqual(posts[0].options.body,posts[1].options.body);assert.equal(posts[0].options.body.photoSourceHash,retry.photoSourceHash);assert.equal(posts[0].options.csrf,'csrf');
 assert.ok(f.calls.at(-1).path.endsWith('/view'));assert.equal(f.actions.length,0,'retry never changes originals or approves a draft');
 await assert.rejects(f.geometry().onRetryDisplay({side:'FRONT',...retry,jobId:'old-job'}),error=>error.code==='REVIEW_DISPLAY_RETRY_STALE');f.dispose();
});
