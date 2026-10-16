import {reviewImagePreview} from '@atlas/manual-workspace';
import {reportAwardedGrade} from '../../../packages/atlas-manual-workspace/src/report-review-ui.mjs';
import {reviewedMemoryState} from '../../../packages/atlas-manual-workspace/src/astra-review-ui.mjs';
import * as reviewIdentity from '../lib/review-identity.mjs';
import * as reviewAttention from '../lib/manual-review-attention.mjs';
import * as reviewStartup from '../lib/manual-review-startup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import * as reviewFeedback from '../lib/review-feedback.mjs';
import * as variantReview from '../lib/variant-review-client.mjs';
import * as analysisClient from '../lib/manual-defect-analysis-client.mjs';

const require = createRequire(import.meta.url), babel = require('next/dist/compiled/babel/core'), nextRequire = createRequire(require.resolve('next/package.json'));
const compiled = babel.transformSync(readFileSync(new URL('../components/ManualCards.jsx', import.meta.url), 'utf8'), {
  filename: 'ManualCards.jsx', presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]], babelrc: false, configFile: false,
}).code;
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const base = Object.fromEntries(['FRONT', 'BACK'].map(side => [side, { cardId: 'card', side, findingRevision: 1 }]));
const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : node ?? '';
const all = (node, predicate, out = []) => { if (Array.isArray(node)) node.forEach(child => all(child, predicate, out));
  else if (node && typeof node === 'object') { if (predicate(node)) out.push(node); all(node.props?.children, predicate, out); } return out; };
function harness({ journal, finalReview = false, rapid = false, initialGeometrySide = null, initialBatchReview = null, initialView = {}, recover, role = 'REVIEWER' } = {}) {
  const values = new Map(journal ? [['atlas-defect-analysis:v1:staff:card', JSON.stringify(journal)]] : []), slots = [], effects = [], timers = new Map(), cleanups = [];
  let cursor = 0, tree, viewCallback, statusCallback;
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), Fragment: 'fragment',
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useCallback: callback => callback,
    useEffect(callback, deps) { const i = cursor++, prior = slots[i]; if (!prior || deps.some((value, n) => value !== prior[n])) { slots[i] = deps; effects.push(callback); } },
  };
  const f = { calls: [], actions: [], popups: [], closedPopups: 0, pending: false, current: { card: { revision: 1, contentHash: 'one' }, geometry: { confirmed: !rapid },
    defects: { marker: 'saved-original-defects' }, images: { marker: 'original-grants' }, identity: {}, astra: { enabled: true, status: 'IDLE', proposals: [] }, reviewedMemory: { enabled: true, status: 'UNSAVED' } } };
  if (finalReview) Object.assign(f.current, { finalReview: { report: { proposedGrade: 9.5, findings: [] } },
    provisional: { state: 'READY', report: { proposedGrade: 9.5 }, reportHash: 'first-current' } });
  Object.assign(f.current,initialView);
  f.respond = async (path, options) => path.endsWith('/view') ? f.current : { astra: f.current.astra };
  f.preview = async () => ({ reportHash: 'exact-report-hash', sourceRevision: f.current.card.revision,
    sourceHash: f.current.card.contentHash, canCertify: true, report: {}, review: {} });
  const client = { recover: async () => { f.recoveries=(f.recoveries??0)+1;if(recover)await recover(f);viewCallback(f.current); return f.current; }, hasPending: () => f.pending,needsRefresh:()=>Boolean(f.refreshNeeded),
    execute: async action => { f.actions.push(action); await f.onExecute?.(action);
      if (action.type === 'IDENTITY_EDIT') f.current = {...f.current,identity:action.identity,card:{...f.current.card,revision:f.current.card.revision+1,contentHash:`identity-${f.current.card.revision+1}`}};
      if (action.type === 'INSPECT_SIDE') f.current = {...f.current,defects:{...f.current.defects,inspected:[...(f.current.defects.inspected ?? []),action.side]}};
      if (action.type === 'CONFIRM_FINDINGS') f.current = {...f.current,defects:{...f.current.defects,confirmed:true}};
      if (action.type === 'EXPLICIT_STAGE' && action.stage === 'geometry') f.current = {...f.current,geometry:{...f.current.geometry,confirmed:true}};
      viewCallback(f.current); return f.current; },
    reviewProposal: async input => { f.actions.push({ type: 'REVIEW_PROPOSAL', input }); return f.current; },
    editDefect: async input => { f.actions.push({ type: 'EDIT_DEFECT', input }); return f.current; }, previewReport: async () => f.preview() };
  const exports = {};
  vm.runInNewContext(compiled, { exports, crypto: { randomUUID }, localStorage: storage,
    setInterval: (callback, ms) => { timers.set(ms, callback); return ms; }, clearInterval: id => timers.delete(id),
    window: { addEventListener() {}, removeEventListener() {}, location:{reload(){f.pageReloads=(f.pageReloads??0)+1;}} }, require(name) {
      if (name === 'react') return react;
      if (name === '../lib/variant-review-client.mjs') return variantReview;
      if (name === '../lib/manual-review-attention.mjs') return reviewAttention;
      if (name === '../lib/manual-review-startup.mjs') return reviewStartup;
      if (name === '../lib/review-identity.mjs') return reviewIdentity;
      if (name === './ReviewIdentityPanel') return {__esModule:true,default:'ReviewIdentityPanel'};
      if (name === './ReviewAttention') return {__esModule:true,default:'ReviewAttention'};
      if (name === './CompletionNextSteps') return {__esModule:true,default:'CompletionNextSteps'};
      if (name === '@atlas/manual-workspace/focused-geometry') return {FocusedGeometryWorkspace:'FocusedGeometryWorkspace',sourceQuadToPrepared:(_g,_s,quad)=>quad};
      if (name === './RapidReviewControls') return {RapidActionDock:'RapidActionDock',RapidEditDock:'RapidEditDock',DirectCardReviewShell:'DirectCardReviewShell'};
      if (name === '../lib/review-feedback.mjs') return {...reviewFeedback,primeReviewAudio(){},playReviewCompletion(){},playAtlasVoice(){}};
      if (name === '../lib/card-discard.mjs' || name === '../lib/batch-import.mjs') return {};
      if (name === 'next/router') return { useRouter: () => ({ events: { on() {}, off() {} } }) };
      if (name === 'next/link' || name === './Shell') return { default: name };
      if (name === './ReportPhotoUploader') return {__esModule:true,default:'ReportPhotoUploader'};
      if (name === './VariantIdentityReview') return {__esModule:true,default:'VariantIdentityReview'};
      if (name === './ReportMarketPicker') return {__esModule:true,default:'ReportMarketPicker'};
      if (name === './ReportResearchPicker') return {__esModule:true,default:'ReportResearchPicker'};
      if (name === './DealerOfferPicker') return {__esModule:true,default:'DealerOfferPicker'};
      if (name === './ManualFinishing') return {__esModule:true,default:'ManualFinishing',openManualLabelPrintWindow:()=>{const popup={close(){f.closedPopups++;}};f.popups.push(popup);return popup;}};
      if (name === '@atlas/manual-workflow/client') return { createManualClient: options => { viewCallback = options.onView; statusCallback = options.onStatus; return client; } };
      if (name === '@atlas/manual-workspace') return { reviewImagePreview };
      if (name === '@atlas/manual-workspace/defects') return { DefectReviewWorkspace: 'DefectReviewWorkspace',reviewedMemoryState };
      if (name === '@atlas/manual-workspace/report-review') return { FinalReportReview: 'FinalReportReview', MachineReportReview: 'MachineReportReview',CompletedReviewCard:'CompletedReviewCard',reportAwardedGrade };
      if (name === '@atlas/manual-workspace/rapid-review') return {
        rapidResumeStage: view => !view.geometry.confirmed ? 'geometry-review' : view.defects?.confirmed ? 'report' : 'findings-review',
        rapidReviewStatus: view => ({ geometry: true, findings: Boolean(view.geometry.confirmed) && !Object.values(view.defects?.sides ?? {}).some(slot => slot.pending) }),
        approveRapidGeometrySide: async (view,input,execute) => execute({type:'EXPLICIT_SIDE',side:input.side}),
        confirmRapidGeometryPair: async (view,approvals,execute) => { assert.ok(approvals.FRONT); assert.ok(approvals.BACK); return execute({type:'EXPLICIT_STAGE',stage:'geometry'}); },
        approveRapidFindingsSide: async (view,side,execute) => {
          let current = view;
          if (!(current.defects.inspected ?? []).includes(side)) current = await execute({type:'INSPECT_SIDE',side,base:base[side],inspected:true});
          const nextSide = ['FRONT','BACK'].find(value => !(current.defects.inspected ?? []).includes(value));
          if (nextSide) return {view:current,nextSide,complete:false};
          if (!current.defects.confirmed) current = await execute({type:'CONFIRM_FINDINGS',base,reviewed:true});
          return {view:current,nextSide:null,complete:true};
        },
      };
      if (name === '@atlas/manual-workspace/defect-actions') return {defectBase:(_value,side)=>base[side]};
      if (name === '@atlas/manual-workspace/geometry-actions') return { geometryStatus: value => value,geometryBase:(_geometry,side)=>({side}) };
      if (name.startsWith('@atlas/')) return {};
      if (name === '../lib/manual-defect-analysis-client.mjs') return analysisClient;
      if (name === '../lib/routes.mjs') return { STAFF_BASE_PATH: '/admin' };
      if (name === '../lib/manual-client.mjs') return { manualMessage: error => error.code ?? 'Retained', manualRequest: async (path, options) => {
        f.calls.push({ path, options: options && structuredClone(options) }); return f.respond(path, options); } };
      return nextRequire(name.startsWith('@babel/runtime/') ? `next/dist/compiled/${name}` : name);
    } });
  f.scroll = { top: 900, resets: 0, scrollTo({top}) { this.top = top; this.resets++; } };
  f.render = () => { cursor = 0; tree = exports.ManualWorkspace({ staff: { id: 'staff', role }, cardId: f.cardId ?? 'card', csrf: 'csrf', initialReviewStage: !rapid&&!initialGeometrySide?'defects':null, initialGeometrySide, initialBatchReview:f.batchReview??initialBatchReview, onQueued:value=>{f.queued=value;}, onBusyChange:value=>{f.locked=value;} });
    const stage = all(tree,node=>node.props?.ref && /mc-rapid-stage|mc-complete/.test(node.props.className ?? ''))[0];
    if(stage)stage.props.ref.current={closest:selector=>selector==='[data-review-scroll]'?f.scroll:null};
    effects.splice(0).forEach(effect => { const cleanup = effect(); if (typeof cleanup === 'function') cleanups.push(cleanup); }); };
  f.tree = () => tree;
  f.tick = async (ms = 5000) => { const tick = timers.get(ms); if (!tick) return; tick(); await flush(); f.render(); };
  f.dispose = () => cleanups.splice(0).forEach(cleanup => cleanup());
  f.defects = () => { const node = all(tree, node => node.type === 'DefectReviewWorkspace')[0]; assert.ok(node, 'defect workspace rendered'); return node.props; };
  f.openFindings = () => { f.button('Findings').props.onClick(); f.render(); };
  f.openGrade = async () => { f.button('04Grade').props.onClick(); await flush(); f.render(); };
  f.button = label => { const matcher=node=>node.type==='button'&&(text(node)===label||node.props['aria-label']===label); return all(tree,matcher)[0] ?? all(all(tree,node=>typeof node.props?.renderReviewActions==='function').map(node=>node.props.renderReviewActions({})),matcher)[0]; };
  f.focusedGeometry = () => all(tree, node => node.type === 'FocusedGeometryWorkspace')[0]?.props;
  f.completion = () => all(tree, node => node.type === 'CompletionNextSteps')[0]?.props;
  f.geometry = () => all(tree, node => node.type === 'FocusedGeometryWorkspace')[0]?.props;
  f.finishing = () => all(tree, node => node.type === 'ManualFinishing')[0]?.props;
  f.identity = () => all(tree, node => node.type === 'ReviewIdentityPanel')[0]?.props;
  f.variant = () => all(tree, node => node.type === 'VariantIdentityReview')[0]?.props;
  f.report = () => all(tree, node => node.type === 'FinalReportReview')[0]?.props;
  f.machine = () => all(tree,node=>node.type==='MachineReportReview')[0]?.props;
  f.text = () => text(tree);
  f.publish = next => { f.current = next; viewCallback(next); f.render(); };
  f.status = value => { statusCallback(value); f.render(); };
  f.render(); return f;
}

test('batch entry recovers once in the mounted owner and same-card updates preserve an active geometry edit',async()=>{
  const batch={key:'batch',cardId:'card',state:'REVIEW'},f=harness({finalReview:true,rapid:true,initialBatchReview:batch});
  await flush();f.render();assert.equal(f.recoveries,1);assert.equal(f.actions.length,0);
  f.geometry().onEditingChange(true);f.render();assert.equal(f.locked,true);
  f.batchReview={...batch,revision:2};f.render();await flush();f.render();
  assert.equal(f.recoveries,1);assert.equal(f.actions.length,0);assert.equal(f.locked,true);
  assert.equal(f.geometry().side,'FRONT');f.dispose();
});
test('the mounted batch workspace reads its fresh report and adopts it only after owned recovery',async()=>{
  const f=harness({rapid:true,initialBatchReview:{key:'batch',cardId:'card',state:'REVIEW'}});
  f.respond=async path=>path.endsWith('/batch/batch')?{state:'READY',reportHash:'current-machine-report'}:{astra:f.current.astra};
  f.onExecute=async action=>{if(action.type==='BEGIN_FINAL_REVIEW')f.current={...f.current,finalReview:{reportHash:action.reportHash,report:{proposedGrade:9.5}}};};
  await flush();f.render();assert.equal(f.recoveries,1);
  assert.deepEqual(JSON.parse(JSON.stringify(f.actions)),[{type:'BEGIN_FINAL_REVIEW',batchKey:'batch',reportHash:'current-machine-report'}]);
  assert.ok(f.geometry());assert.equal(f.popups.length,0);f.dispose();
});
test('a failed batch startup stays in the workspace retry state and never approves a grade',async()=>{
  const f=harness({rapid:true,initialBatchReview:{key:'batch',cardId:'card',state:'REVIEW'}});
  f.respond=async path=>{if(path.endsWith('/batch/batch'))throw{code:'MANUAL_TEMPORARILY_UNAVAILABLE',status:503};return{astra:f.current.astra};};
  await flush();f.render();assert.equal(f.recoveries,1);assert.match(f.text(),/MANUAL_TEMPORARILY_UNAVAILABLE/);
  assert.ok(f.button('Retry loading review'));assert.equal(f.actions.length,0);assert.equal(f.popups.length,0);
  f.respond=async path=>path.endsWith('/batch/batch')?{state:'READY',reportHash:'current-machine-report'}:{astra:f.current.astra};
  f.button('Retry loading review').props.onClick();await flush();f.render();
  assert.equal(f.recoveries,2);assert.equal(f.actions.length,1);assert.equal(f.actions[0].type,'BEGIN_FINAL_REVIEW');assert.ok(f.geometry());f.dispose();
});
test('authorization loss during batch startup shows sign-in recovery with no intermediate editor',async()=>{
  const f=harness({rapid:true,initialBatchReview:{key:'batch',cardId:'card',state:'REVIEW'}});
  f.respond=async()=>{throw{code:'SIGN_IN_REQUIRED',status:401};};
  await flush();f.render();assert.equal(f.recoveries,1);assert.match(f.text(),/Sign in again/);
  assert.equal(f.geometry(),undefined);assert.equal(f.actions.length,0);assert.equal(f.button('Retry loading review'),undefined);f.dispose();
});
test('known-commit recovery locks review, deduplicates clicks and preserves an active geometry draft',async()=>{
  let release;
  const f=harness({rapid:true,recover:async state=>{if(state.recoveries>1){await new Promise(resolve=>{release=resolve;});state.refreshNeeded=false;state.status('Saved');}}});
  await flush();f.render();f.geometry().onEditingChange(true);f.render();
  f.refreshNeeded=true;f.status('Saved; refreshing…');
  assert.equal(f.geometry().busy,true);assert.equal(f.button('04Grade').props.disabled,true);
  const recover=f.button('Refresh saved review').props.onClick,first=recover();
  await recover();f.render();assert.equal(f.recoveries,2,'startup and one recovery only');
  assert.equal(f.button('Refreshing saved review…').props.disabled,true);assert.equal(f.actions.length,0);
  release();await first;await flush();f.render();
  assert.equal(f.button('Refresh saved review'),undefined);assert.equal(f.geometry().busy,false);
  assert.equal(f.locked,true,'unsaved geometry still prevents navigation');assert.equal(f.button('04Grade').props.disabled,true);
  assert.doesNotMatch(f.text(),/already in progress|not confirmed/);assert.equal(f.actions.length,0);f.dispose();
});
test('expired authentication during a known-commit refresh exposes sign-in and keeps edits locked',async()=>{
  const f=harness({rapid:true,recover:async state=>{if(state.recoveries>1)throw{status:401,code:'SIGN_IN_REQUIRED'};}});
  await flush();f.render();f.refreshNeeded=true;f.status('Saved; refreshing…');
  await f.button('Refresh saved review').props.onClick();await flush();f.render();
  assert.match(f.text(),/Sign in again/);assert.equal(f.geometry().busy,true);assert.equal(f.button('04Grade').props.disabled,true);
  assert.equal(f.button('Refresh saved review').props.disabled,false);assert.equal(f.actions.length,0);f.dispose();
});
test('a stale enabled geometry or navigation handler observes the current known-commit recovery lock',async()=>{
  const f=harness({rapid:true});await flush();f.render();
  const approve=f.geometry().onApproveSide,navigate=f.button('02Back').props.onClick;
  f.refreshNeeded=true; // Before the status update can cause a new render.
  navigate();await assert.rejects(approve({side:'FRONT'}),{code:'MANUAL_COMMAND_PENDING'});
  f.render();assert.equal(f.geometry().side,'FRONT');assert.equal(f.actions.length,0);f.dispose();
});

test('final correction workspace shows the current computed grade and hides it while measurement is pending without creating human decisions', async () => {
  const f = harness({ finalReview: true }); await flush(); f.render();
  assert.match(f.text(), /Grade 9.5 \/ 10/); assert.equal(f.actions.length, 0);
  f.publish({ ...f.current, card: { revision: 2, contentHash: 'pending' }, provisional: { state: 'PENDING' } });
  assert.doesNotMatch(f.text(), /Grade 9.5 \/ 10/); assert.doesNotMatch(f.text(), /Current provisional grade: 9.5/);
  f.publish({ ...f.current, card: { revision: 3, contentHash: 'measured' }, provisional: { state: 'READY', report: { proposedGrade: 8 }, reportHash: 'updated' } });
  assert.match(f.text(), /Grade 8 \/ 10/);
  f.openFindings(); await flush(); f.render();
  assert.match(f.text(), /Grade 8 \/ 10/); assert.equal(f.actions.length, 0); assert.equal(f.popups.length, 0);
  f.dispose();
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


test('mount with an unknown saved analysis performs exact GET only and leaves manual review usable', async () => {
  const id = '33333333-3333-4333-8333-333333333333';
  const f = harness({ journal: { version: 1, phase: 'PENDING', canResume: false, body: { actionId: id, base } } });
  f.respond = async () => ({ astra: { enabled: true, analysisId: id, status: 'UNKNOWN', base, proposals: [] } });
  await flush(); f.render();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].path.endsWith(`/${id}`), true);
  assert.equal(f.calls[0].options.method, undefined); assert.equal(f.defects().astra.status, 'UNKNOWN');
  assert.equal(f.button('Edit card details').props.disabled, false); assert.equal(f.actions.length, 0);
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


test('opening the full draft is read-only and approval requires verified images and the exact displayed revision', async () => {
  const f = harness(); await flush(); f.render();
  await f.openGrade(); f.render();
  assert.equal(f.report().preview.reportHash, 'exact-report-hash'); assert.equal(f.report().current, true);
  assert.equal(f.actions.length, 0); assert.equal(f.button('Approve final grade and queue label').props.disabled, true);
  await f.button('Approve final grade and queue label').props.onClick(); assert.equal(f.actions.length, 0);
  f.report().onReadyChange(true); f.render(); assert.equal(f.button('Approve final grade and queue label').props.disabled, false);
  await f.button('Approve final grade and queue label').props.onClick(); f.render();
  assert.deepEqual(JSON.parse(JSON.stringify(f.actions)), [{ type: 'APPROVE_REPORT', reportHash: 'exact-report-hash', reviewed: true }]);
  f.publish({ ...f.current, card: { revision: 2, contentHash: 'changed-after-preview' } });
  assert.equal(f.report().current, false);
  await f.button('Approve final grade and queue label').props.onClick(); assert.equal(f.actions.length, 1, 'a stale enabled callback cannot approve changed content');
  f.dispose();
});

test('manual review explains missing certification and prevents approval or print effects before a current preview', async () => {
  const f = harness(); await flush(); f.render(); const preview = f.preview;
  f.preview = async () => ({ ...await preview(), canCertify: false });
  await f.openGrade(); f.render(); f.report().onReadyChange(true); f.render();
  assert.equal(f.button('Approve final grade and queue label').props.disabled, true);
  assert.match(f.text(), /Current reviewer certification required/);
  await f.button('Approve final grade and queue label').props.onClick();
  assert.equal(f.actions.length, 0); assert.equal(f.popups.length, 0);
  f.preview = preview;
  await f.button('04Grade').props.onClick(); await flush(); f.render();
  assert.equal(f.report().preview.canCertify, true);
  assert.equal(f.button('Approve final grade and queue label').props.disabled, false, 'the unchanged report retains its verified images');
  assert.equal(f.actions.length, 0); assert.equal(f.popups.length, 0); f.dispose();
});

test('certification refusal after a preview queues no label and updates guidance without retrying approval', async () => {
  const f = harness(); await flush(); f.render();
  await f.openGrade(); f.render(); f.report().onReadyChange(true); f.render();
  f.onExecute = () => { throw { code: 'MANUAL_CERTIFICATION_REQUIRED' }; };
  await f.button('Approve final grade and queue label').props.onClick(); f.render();
  assert.equal(f.closedPopups, 0); assert.equal(f.actions.length, 1);
  assert.equal(f.button('Approve final grade and queue label').props.disabled, true);
  assert.match(f.text(), /Current reviewer certification required/);
  await f.button('Approve final grade and queue label').props.onClick();
  assert.equal(f.actions.length, 1); assert.equal(f.popups.length, 0); f.dispose();
});

test('a report response that arrives after a newer saved edit is refused before display', async () => {
  const f = harness(); await flush(); f.render(); let finish;
  f.preview = () => new Promise(resolve => { finish = resolve; });
  const opening = f.openGrade();
  f.publish({ ...f.current, card: { revision: 2, contentHash: 'two' } });
  finish({ reportHash: 'old-report', sourceRevision: 1, sourceHash: 'one', report: {}, review: {} });
  await opening; f.render();
  assert.equal(f.report(), undefined); assert.ok(f.defects()); assert.match(f.text(), /MANUAL_REPORT_STALE/);
  assert.equal(f.actions.length, 0); f.dispose();
});

const finishingPublication = { actionId: 'approved-action', state: 'PUBLISHED', reportHash: 'exact-report-hash', publicHash: 'published-packet', version: 1, reportNumber: 'ATLAS-EXAMPLE' };
const finishingPlan = { id: 'synthetic-plan', binding: { cardId: 'card', approvalActionId: 'approved-action', reportHash: 'exact-report-hash', publicHash: 'published-packet', approvalVersion: 1 } };
test('reopening an approved report reads its saved label only on the explicit label gesture', async () => {
  const f = harness(); await flush(); f.render();
  f.publish({ ...f.current, approval: { sourceHash: 'one', reportHash: 'exact-report-hash' }, publication: finishingPublication });
  f.respond = async path => path.includes('/finishing/') ? finishingPlan : f.current;
  await f.openGrade(); f.render(); await flush(); f.render();
  assert.equal(f.finishing(),undefined); assert.equal(f.calls.filter(call=>call.path.includes('/finishing/')).length,0);
  f.completion().onToggleLabel();f.render();await flush();f.render();
  assert.equal(f.finishing().plan.id, 'synthetic-plan'); assert.equal(f.finishing().autoPrintWindow, undefined); assert.equal(f.popups.length, 0);
  assert.equal(f.calls.filter(call => call.path.includes('/finishing/')).length, 1);
  assert.equal(f.calls.filter(call => call.options?.method === 'POST').length, 0); f.dispose();
});
test('returning to Findings discards the displayed report and opens a fresh corrected draft without implicit approval', async () => {
  const f = harness(); await flush(); f.render(); let previews = 0;
  f.preview = async () => ({ reportHash: `report-${++previews}`, sourceRevision: f.current.card.revision,
    sourceHash: f.current.card.contentHash, report: {}, review: {} });
  await f.openGrade(); f.render(); f.report().onReadyChange(true); f.render();
  await f.openFindings(); f.render(); assert.equal(f.report(), undefined); assert.ok(f.defects());
  f.publish({ ...f.current, card: { revision: 2, contentHash: 'corrected' } });
  await f.openGrade(); f.render();
  assert.equal(f.report().preview.reportHash, 'report-2'); assert.equal(f.report().preview.sourceHash, 'corrected');
  assert.equal(f.button('Approve final grade and queue label').props.disabled, true, 'new report must verify its images again');
  assert.equal(f.actions.length, 0); f.dispose();
});

test('stage navigation is immediate while one background image-grant refresh is pending',async()=>{
  const f=harness();await flush();f.render();let finish;
  f.respond=()=>new Promise(resolve=>{finish=resolve;});
  f.button('Geometry').props.onClick();f.render();
  assert.ok(f.geometry(),'geometry opens without waiting for the network');assert.equal(f.geometry().images.marker,'original-grants');
  assert.equal(f.button('Findings').props.disabled,false);assert.equal(f.button('Edit card details').props.disabled,false);
  f.openFindings();f.render();assert.ok(f.defects());assert.equal(f.calls.filter(call=>call.path.endsWith('/view')).length,1,'switches share the existing refresh');
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
  f.openFindings();f.render();assert.ok(f.defects());await flush();f.render();
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
  assert.doesNotMatch(f.text(), /Grade 9.5 \/ 10/);assert.doesNotMatch(f.text(),/Updating measurements|Current provisional grade: null/);
  f.button('Geometry').props.onClick();f.render();
  assert.equal(f.button('Findings').props.disabled,false);f.openFindings();f.render();
  assert.ok(f.defects());assert.doesNotMatch(f.text(), /Grade 9.5 \/ 10/);assert.equal(f.actions.length,0);
  f.button('Geometry').props.onClick();f.render();
  f.publish({...f.current,defects:{sides:{...f.current.defects.sides,FRONT:{...f.current.defects.sides.FRONT,frame:{...f.current.defects.sides.FRONT.frame,frameId:'wrong-frame'}}}}});
  assert.equal(f.button('Findings').props.disabled,true);f.openFindings();f.render();assert.ok(f.geometry());
  f.dispose();
});
test('unsaved geometry and finding edits suppress saved grade until saved or discarded',async()=>{
  const f=harness({finalReview:true});await flush();f.render();
  f.openFindings();f.render();assert.match(f.text(), /Grade 9.5 \/ 10/);
  f.defects().onEditingChange(true);f.render();assert.doesNotMatch(f.text(), /Grade 9.5 \/ 10/);
  assert.match(f.text(),/Unsaved changes/);assert.doesNotMatch(f.text(),/Current provisional grade:/);
  f.defects().onEditingChange(false);f.render();assert.match(f.text(), /Grade 9.5 \/ 10/);
  f.button('Geometry').props.onClick();f.render();f.geometry().onEditingChange(true);f.render();
  assert.match(f.text(),/Unsaved changes/);assert.doesNotMatch(f.text(),/Current provisional grade:/);
  f.geometry().onEditingChange(false);f.render();assert.equal(f.current.provisional.report.proposedGrade,9.5);assert.equal(f.actions.length,0);f.dispose();
});
test('an interrupted outline edit offers optional same-side undo without a preservation recovery banner',async()=>{
  const f=harness({finalReview:true});await flush();f.render();const prepared=preparedReview(f.current);
  f.publish({...prepared,card:{...prepared.card,draft:{geometryBeforeEdit:{FRONT:{ref:{id:'retained-original'}}}}},
    geometry:{...prepared.geometry,sides:{...prepared.geometry.sides,FRONT:{...prepared.geometry.sides.FRONT,prepared:null}}},provisional:{state:'PENDING'}});
  f.button('Geometry').props.onClick();f.render();
  assert.equal(f.button('Findings').props.disabled,true);assert.equal(f.geometry().reviewRecovery,undefined);assert.doesNotMatch(f.text(),/must remain inside|restore the previous outline, correct the finding/);
  f.onExecute=action=>{if(action.type==='RESTORE_GEOMETRY')f.publish(prepared);};
  await f.button('Undo Front outline change').props.onClick();f.render();
  assert.deepEqual(JSON.parse(JSON.stringify(f.actions)),[{type:'RESTORE_GEOMETRY',side:'FRONT'}]);
  assert.ok(f.geometry());assert.equal(f.button('Findings').props.disabled,false);
  assert.equal(f.button('Undo Front outline change'),undefined);assert.equal(f.popups.length,0);f.dispose();
});


async function approveFindings(f){
 assert.equal(f.defects().side,'FRONT'); f.defects().onReadyChange(true); f.render();
 await f.button('Approve front findings').props.onClick(); await flush(); f.render();
 assert.equal(f.defects().side,'BACK'); f.defects().onReadyChange(true); f.render();
 await f.button('Approve back findings').props.onClick(); await flush(); f.render();
}
async function approveGeometry(f){
 assert.equal(f.focusedGeometry().side,'FRONT');
 await f.focusedGeometry().onApproveSide({side:'FRONT'});f.render();
 assert.equal(f.focusedGeometry().side,'BACK');
 await f.focusedGeometry().onApproveSide({side:'BACK'});f.render();
}
test('rapid opens editable Front, saves both sides in order, then findings and final grade without a print popup',async()=>{
 const f=harness({finalReview:true,rapid:true});await flush();f.render();
 assert.ok(f.focusedGeometry());assert.equal(f.machine(),undefined);assert.equal(f.actions.length,0);
 await approveGeometry(f);assert.ok(f.defects());
 await approveFindings(f);
 assert.ok(f.report());assert.deepEqual(f.actions.map(a=>a.type),['EXPLICIT_SIDE','EXPLICIT_SIDE','EXPLICIT_STAGE','INSPECT_SIDE','INSPECT_SIDE','CONFIRM_FINDINGS']);
 assert.equal(f.button('Approve final grade and queue label').props.disabled,true);
 f.report().onReadyChange(true);f.render();await f.button('Approve final grade and queue label').props.onClick();f.render();
 assert.equal(f.actions.at(-1).type,'APPROVE_REPORT');assert.equal(f.popups.length,0);f.dispose();
});
test('rapid failed side save stays on the exact side and does not confirm or advance',async()=>{
 const f=harness({finalReview:true,rapid:true});await flush();f.render();
 f.onExecute=()=>{throw Error('save failed');};
 await assert.rejects(f.focusedGeometry().onApproveSide({side:'FRONT'}));f.render();
 assert.equal(f.focusedGeometry().side,'FRONT');assert.equal(f.actions.some(a=>a.type==='EXPLICIT_STAGE'),false);
 f.onExecute=undefined;await approveGeometry(f);assert.ok(f.defects());assert.equal(f.report(),undefined);f.dispose();
});

test('approved review opens a calm completion screen with saved award, lazy extras and retained correction path',async()=>{
  const f=harness({finalReview:true});await flush();f.render();
  f.preview=async()=>({reportHash:'exact-report-hash',sourceRevision:1,sourceHash:'one',report:{version:'atlas-manual-report-snapshot-v2',identity:{cardName:'Abomasnow'},finalGradePolicy:'atlas-final-half-point-v1',finalGrade:10,grade:{overall:{rawGrade:9.9,displayGrade:9.9}}}});
  f.publish({...f.current,approval:{sourceHash:'one',reportHash:'exact-report-hash'},publication:finishingPublication});
  f.respond=async path=>path.includes('/finishing/')?finishingPlan:f.current;
  f.openFindings();await flush();f.render();await f.openGrade();f.render();await flush();f.render();
  assert.match(f.text(),/Completed.*Abomasnow.*APPROVED GRADE10/);assert.match(f.text(),/Next card/);
  assert.doesNotMatch(f.text(),/Final human review|Current provisional|View current provisional|Approved. Preserved|Optional report tools/);
  assert.equal(f.report(),undefined);assert.equal(f.button('Geometry'),undefined);assert.equal(f.finishing(),undefined);
  f.publish({...f.current,variantVerification:{enabled:true,legacyApproved:true,approvalReady:true,confirmation:null}});assert.equal(f.variant(),undefined);assert.ok(f.completion());
  const calls=f.calls.length;await f.tick(240000);assert.equal(f.calls.length,calls,'completed review does not keep refreshing image grants');
  f.button('More options +').props.onClick();f.render();assert.match(f.text(),/Optional report tools/);
  f.button('Correct findings').props.onClick();await flush();f.render();assert.ok(f.defects());assert.equal(f.actions.length,0);
  f.dispose();
});

test('recovered completed snapshot displays the saved whole or half-point award on both completion surfaces',async()=>{
  for(const [raw,detail,award] of [[8.24,8.2,8],[8.25,8.3,8.5],[8.74,8.7,8.5],[8.75,8.8,9]]){
    const f=harness();await flush();f.render();
    const saved={version:'atlas-manual-report-snapshot-v2',identity:{cardName:'Magikarp'},finalGradePolicy:'atlas-final-half-point-v1',finalGrade:award,grade:{overall:{rawGrade:raw,displayGrade:detail}}};
    const before=JSON.stringify(saved);
    f.preview=async()=>({reportHash:'exact-report-hash',sourceRevision:1,sourceHash:'one',report:saved});
    f.publish({...f.current,approval:{sourceHash:'one',reportHash:'exact-report-hash'},publication:finishingPublication});
    await f.openGrade();f.render();await flush();f.render();
    assert.match(f.text(),new RegExp(`APPROVED GRADE${award}ATLAS`));
    assert.equal(all(f.tree(),node=>node.type==='CompletedReviewCard')[0].props.grade,award);
    assert.equal(JSON.stringify(saved),before,'reading an approval never rewrites its evidence');
    assert.equal(f.actions.length,0,'recovery must not reapprove or regrade');f.dispose();
  }
});

test('a changed card revision cannot reuse an older completion award',async()=>{
  const f=harness();await flush();f.render();
  f.preview=async()=>({reportHash:'exact-report-hash',sourceRevision:1,sourceHash:'one',report:{version:'atlas-manual-report-snapshot-v2',finalGradePolicy:'atlas-final-half-point-v1',finalGrade:8,grade:{overall:{displayGrade:8.2}}}});
  f.publish({...f.current,card:{revision:2,contentHash:'two'},approval:{sourceHash:'one',reportHash:'exact-report-hash'},publication:finishingPublication});
  await f.openGrade();f.render();await flush();f.render();
  assert.doesNotMatch(f.text(),/APPROVED GRADE|Completed/);assert.equal(f.actions.length,0);f.dispose();
});

test('rapid approval advances without fetching a label; optional label failure cannot undo saved review',async()=>{
  const f=harness({finalReview:true,rapid:true});await flush();f.render();
  await approveGeometry(f);await approveFindings(f);
  f.report().onReadyChange(true);f.render();
  f.onExecute=action=>{if(action.type==='APPROVE_REPORT')f.publish({...f.current,approval:{sourceHash:'one',reportHash:'exact-report-hash'},publication:finishingPublication});};
  f.respond=async path=>{if(path.includes('/finishing/'))throw {code:'SIGN_IN_REQUIRED'};return f.current;};
  await f.button('Approve final grade and queue label').props.onClick();f.render();await flush();f.render();
  assert.match(f.text(),/Completed/);assert.equal(f.report(),undefined);assert.equal(f.popups.length,0);
  assert.equal(f.calls.filter(call=>call.path.includes('/finishing/')).length,0);
  assert.equal(f.button('Next card →').props.disabled,false);
  f.completion().onToggleLabel();f.render();await flush();f.render();
  assert.match(f.text(),/Your grade is saved. SIGN_IN_REQUIRED/);assert.equal(f.button('Next card →').props.disabled,false);
  f.button('Next card →').props.onClick();assert.equal(f.queued.actionId,finishingPublication.actionId);
  assert.equal(f.actions.filter(action=>action.type==='APPROVE_REPORT').length,1);f.dispose();
});

test('publication pending remains a saved approval with explicit retry and no false ready label',async()=>{
  const f=harness();await flush();f.render();
  f.publish({...f.current,approval:{sourceHash:'one',reportHash:'exact-report-hash'},publication:{...finishingPublication,state:'PENDING',retryable:true}});
  await f.openGrade();f.render();await flush();f.render();
  assert.match(f.text(),/Grade approved/);assert.match(f.text(),/report and label are not ready yet/);assert.doesNotMatch(f.text(),/Completed|Sign in again|Refresh access/);assert.ok(f.button('Finish report and label'));
  assert.equal(f.button('Next card →'),undefined);assert.equal(f.finishing(),undefined);assert.equal(f.actions.length,0);f.dispose();
});

test('publication errors offer sign-in only for actual authentication loss and reload only for changed CSRF',async()=>{
 for(const failure of [{status:500,code:'MANUAL_PUBLICATION_REPORT_INVALID'},{status:401,code:'SIGN_IN_REQUIRED'},{status:403,code:'CSRF_REQUIRED'}]){
  const f=harness();await flush();f.render();
  f.preview=async()=>({reportHash:'exact-report-hash',sourceRevision:1,sourceHash:'one',report:{version:'atlas-manual-report-snapshot-v2',finalGradePolicy:'atlas-final-half-point-v1',finalGrade:8}});
  f.publish({...f.current,approval:{sourceHash:'one',reportHash:'exact-report-hash'},publication:{...finishingPublication,state:'PENDING',retryable:true}});
  await f.openGrade();f.render();f.respond=async()=>{throw failure;};
  await f.button('Finish report and label').props.onClick();await flush();f.render();
  assert.match(f.text(),/Your grade 8 is approved and saved/);assert.equal(f.actions.length,0,'publication retry never reapproves');
  const writes=f.calls.filter(call=>call.options?.method==='POST');assert.equal(writes.length,1);assert.equal(writes[0].options.body.actionId,finishingPublication.actionId);
  assert.equal(all(f.tree(),node=>node.type==='a'&&text(node)==='Sign in again ↗').length,failure.status===401?1:0);
  assert.equal(Boolean(f.button('Reload review')),failure.code==='CSRF_REQUIRED');assert.equal(f.button('Refresh access'),undefined);
  if(failure.code==='CSRF_REQUIRED'){f.button('Reload review').props.onClick();assert.equal(f.pageReloads,1);}
  f.dispose();
 }
});

test('card and stage changes reset the shared scrolled review container without recording a decision',async()=>{
 const f=harness({rapid:true,finalReview:true});await flush();f.render();assert.equal(f.scroll.top,0);
 f.scroll.top=700;await f.openGrade();assert.equal(f.scroll.top,0);
 f.scroll.top=800;const count=f.scroll.resets;f.render();assert.equal(f.scroll.top,800);assert.equal(f.scroll.resets,count,'ordinary render preserves inspection scroll');
 f.button('01Front').props.onClick();await flush();f.render();assert.equal(f.scroll.top,0);
 f.scroll.top=900;f.cardId='next-card';f.render();await flush();f.render();assert.equal(f.scroll.top,0);
 assert.equal(f.actions.length,0);f.dispose();
});



test('explicit photo editor entry opens geometry even when a final report exists and prioritizes the chosen side',async()=>{
 const f=harness({finalReview:true,initialGeometrySide:'BACK'});
 f.current.geometry={confirmed:false,sides:{FRONT:{image:{}},BACK:{image:{}}}};
 await flush();f.render();
 assert.ok(f.geometry());assert.equal(f.geometry().side,'BACK');
 assert.equal(f.machine(),undefined);assert.deepEqual(f.actions,[]);f.dispose();
});

test('focused geometry uses the grading image descriptors without the removed paired editor',async()=>{
 const f=harness({initialGeometrySide:'BACK'});await flush();f.render();assert.equal(f.geometry().side,'BACK');assert.equal(f.geometry().images,f.current.images);assert.equal(f.geometry().onBackground,undefined);assert.equal(f.actions.length,0);f.dispose();
});

test('focused geometry does not expose the retired raw display retry action',async()=>{
 const f=harness({initialGeometrySide:'FRONT'});await flush();f.render();
 assert.equal(f.geometry().onRetryDisplay,undefined);f.dispose();
});

test('proposal correction awaits measurement and propagates a failure instead of advancing with a pending trace',async()=>{
 const f=harness();await flush();f.render();let finish,complete=false;
 f.onExecute=action=>action.type==='MEASURE_SIDE'?new Promise((resolve,reject)=>{finish={resolve,reject};}):undefined;
 const saving=f.defects().onReviewProposal({side:'FRONT',action:'TRACE_SAVE'}).then(()=>{complete=true;});await flush();assert.equal(complete,false);
 finish.reject(Error('measurement held'));await assert.rejects(saving,/measurement held/);assert.equal(complete,false);assert.equal(f.actions.some(a=>a.type==='REVIEW_FINDING'),false);
 const retry=f.defects().onRetry('FRONT');await flush();finish.resolve();await retry;assert.equal(f.actions.filter(a=>a.type==='REVIEW_PROPOSAL').length,1);f.dispose();
});


test('rapid stage browsing records no decisions and side approvals work after starting on Back',async()=>{
 const f=harness({finalReview:true,rapid:true});await flush();f.render();
 f.button('02Back').props.onClick();await flush();f.render();
 assert.equal(f.focusedGeometry().side,'BACK');assert.equal(f.actions.length,0);
 await f.focusedGeometry().onApproveSide({side:'BACK'});f.render();
 assert.equal(f.focusedGeometry().side,'FRONT');assert.equal(f.actions.some(action=>action.type==='EXPLICIT_STAGE'),false);
 await f.focusedGeometry().onApproveSide({side:'FRONT'});f.render();
 assert.ok(f.defects());assert.equal(f.actions.filter(action=>action.type==='EXPLICIT_SIDE').length,2);
 assert.equal(f.actions.filter(action=>action.type==='EXPLICIT_STAGE').length,1);assert.equal(f.actions.some(action=>action.type==='APPROVE_REPORT'),false);f.dispose();
});

test('stale rapid navigation handler cannot replace a newly dirty geometry side',async()=>{
 const f=harness({finalReview:true,rapid:true});await flush();f.render();
 const stale=f.button('02Back').props.onClick;
 f.focusedGeometry().onEditingChange(true);stale();f.render();
 assert.equal(f.focusedGeometry().side,'FRONT');assert.equal(f.button('02Back').props.disabled,true);
 assert.match(f.text(),/Unsaved changes/);assert.equal(f.actions.length,0);f.dispose();
});


test('a deferred Grade preview cannot replace a geometry draft begun during the read',async()=>{
 const f=harness({finalReview:true,rapid:true});await flush();f.render();let resolvePreview;
 f.preview=()=>new Promise(resolve=>{resolvePreview=resolve;});
 f.button('04Grade').props.onClick();await flush();f.render();assert.equal(f.focusedGeometry().busy,true);
 f.focusedGeometry().onEditingChange(true);f.render();
 resolvePreview({reportHash:'same-source-report',sourceRevision:f.current.card.revision,sourceHash:f.current.card.contentHash,canCertify:true,report:{},review:{}});
 await flush();f.render();assert.ok(f.focusedGeometry());assert.equal(f.report(),undefined);assert.match(f.text(),/Unsaved changes/);
 assert.equal(f.actions.length,0);f.dispose();
});



test('final identity gate blocks approval until current card verification, and pending recovery blocks stage navigation', async () => {
  const f = harness(); await flush(); f.render();
  f.publish({...f.current,card:{...f.current.card,draft:{source:{sourceHash:'photos'},identityRevision:1}},variantVerification:{enabled:true}});
  await f.openGrade(); f.render();
  f.report().onReadyChange(true); f.render();
  assert.equal(f.variant().revision,1); assert.equal(f.button('Approve final grade and queue label'),undefined);
  assert.equal(typeof f.variant().renderReviewActions,'function');assert.equal(f.actions.length,0); assert.equal(f.popups.length,0);
  f.variant().onGateChange(true); f.render(); assert.equal(f.button('Approve final grade and queue label').props.disabled,false);
  f.variant().onActivityChange(true); f.render(); assert.equal(f.button('Approve final grade and queue label').props.disabled,true);
  f.openFindings(); await flush(); f.render(); assert.ok(f.report(),'pending exact decision prevents leaving final review');
  f.variant().onActivityChange(false); f.render();
  f.publish({...f.current,card:{...f.current.card,revision:2,draft:{source:{sourceHash:'photos'},identityRevision:2}}});
  assert.equal(f.button('Approve final grade and queue label'),undefined,'old identity gate cannot approve revised identity');
  f.dispose();
});

test('Rapid Grade keeps the exact current preview grade above empty variant matches and the approval gate stays closed',async()=>{
 const f=harness({rapid:true,finalReview:true,initialView:{variantVerification:{enabled:true,state:'READY',result:{catalog:{candidates:[]}},approvalReady:false}}});await flush();f.render();
 f.preview=async()=>({reportHash:'exact-report-hash',sourceRevision:f.current.card.revision,sourceHash:f.current.card.contentHash,canCertify:true,report:{},review:{report:{version:'atlas-manual-draft-report-v2',finalGradePolicy:'atlas-final-half-point-v1',finalGrade:9.5}}});
 f.button('04Grade').props.onClick();await flush();f.render();assert.ok(f.report());
 assert.match(f.text(),/Grade awaiting final approval: 9.5 \/ 10/);assert.equal(typeof f.variant().renderReviewActions,'function');
 const sequence=all(f.tree(),node=>node.type==='VariantIdentityReview'||node.type==='FinalReportReview'||node.type==='p'&&text(node).includes('Grade awaiting final approval:'));
 assert.deepEqual(sequence.map(node=>node.type),['p','VariantIdentityReview','FinalReportReview']);
 f.report().onReadyChange(true);f.render();assert.equal(f.button('Approve final grade and queue label'),undefined);assert.equal(f.actions.length,0);
 f.publish({...f.current,card:{...f.current.card,revision:2,contentHash:'changed'}});assert.doesNotMatch(f.text(),/Grade awaiting final approval: 9.5/);f.dispose();
});






test('same identity confirmation keeps confirmed borders and returns to its report',async()=>{
  const f=harness();await flush();f.render();await f.openGrade();f.render();
  const saved=f.variant().onSaved,geometry=f.current.geometry;
  f.current={...f.current,variantVerification:{enabled:true,confirmation:{decision:'SELECTED',reprocessRequired:false},approvalReady:true}};
  await saved();await flush();f.render();assert.ok(f.report());assert.equal(f.report().geometry,geometry);
  assert.doesNotMatch(f.text(),/Recheck border placement/);assert.equal(f.actions.length,0);f.dispose();
});





test('explicit unconfirmed variant returns to report and still requires a separate final approval',async()=>{
 const f=harness();await flush();f.render();await f.openGrade();f.render();const saved=f.variant().onSaved;
 f.current={...f.current,identity:{cardName:null,productSet:null,parallel:null},variantVerification:{enabled:true,approvalReady:true,
  confirmation:{decision:'UNRESOLVED',reprocessRequired:true,recheckState:'REFUSED',recheckRetryable:true}}};
 await saved();await flush();f.render();assert.ok(f.variant());assert.ok(f.report());assert.equal(f.geometry(),undefined);
 f.variant().onGateChange(true);f.report().onReadyChange(true);f.render();
 assert.equal(f.button('Approve final grade and queue label').props.disabled,false);
 assert.doesNotMatch(f.text(),/Recheck border placement|Checking the confirmed variant/);assert.equal(f.actions.length,0);f.dispose();
});
test('a retained unconfirmed variant leaves grading usable and its review remains reachable',async()=>{
 const f=harness({initialView:{variantVerification:{enabled:true,approvalReady:false,confirmation:{decision:'UNRESOLVED',reprocessRequired:true,recheckState:'UNKNOWN'}}}});
 await flush();f.render();assert.ok(f.defects());assert.equal(f.report(),undefined);
 assert.match(f.text(),/The variant remains unconfirmed/);f.button('Review card variant').props.onClick();f.render();
 assert.ok(f.variant());assert.equal(f.actions.length,0);assert.ok(f.calls.every(call=>!call.options?.method));f.dispose();
});

test('card correction stays above the mounted variant panel and retains pending-save navigation locks',async()=>{
 const f=harness({initialView:{identity:{cardName:'Saved card',parallel:'Saved printing'},variantVerification:{enabled:true,approvalReady:false,confirmation:{decision:'UNRESOLVED'}}}});
 await flush();f.render();f.button('Review card variant').props.onClick();f.render();assert.ok(f.variant());const edit=f.button('Edit card details').props.onClick;
 f.variant().onActivityChange(true);f.render();edit();f.render();assert.ok(f.variant(),'a stale edit handler cannot leave pending variant recovery');
 f.variant().onActivityChange(false);f.render();f.button('Edit card details').props.onClick();await flush();f.render();
 assert.ok(f.variant());assert.equal(f.variant().disabled,true);assert.equal(f.identity().draft.cardName,'Saved card');assert.equal(f.actions.length,0);
 f.identity().onCancel();f.render();assert.ok(f.variant());assert.equal(f.identity().draft,null);assert.equal(f.actions.length,0);f.dispose();
});





test('only an actual unconfirmed save exposes recovery while ordinary pending requests stay quietly locked',async()=>{
 const f=harness({finalReview:true});await flush();f.render();f.pending=true;
 for(const status of ['Saving…','Checking pending save…']){
  f.status(status);assert.equal(f.button('Check last save'),undefined);assert.doesNotMatch(f.text(),/last edit has not been confirmed/);
  assert.equal(f.button('Edit card details').props.disabled,true);
 }
 for(const status of ['Save not confirmed — retry the pending save','Last edit not confirmed — check its saved status']){
  f.status(status);assert.ok(f.button('Check last save'));assert.match(f.text(),/last edit has not been confirmed/);
 }
 f.pending=false;f.status('Saved');assert.equal(f.button('Check last save'),undefined);assert.equal(f.button('Edit card details').props.disabled,false);f.dispose();
});

test('incomplete geometry can preview references and return without a report read or human decision',async()=>{
 const geometry={confirmed:false};
 const f=harness({rapid:true,initialView:{geometry,variantVerification:{enabled:true,approvalReady:false}}});
 let previews=0;f.preview=async()=>{previews++;throw Error('Incomplete geometry cannot preview a report');};
 await flush();f.render();assert.ok(f.focusedGeometry());
 f.button('View references').props.onClick();f.render();
 assert.equal(f.variant().previewOnly,true);assert.equal(f.report(),undefined);assert.equal(f.focusedGeometry(),undefined);
 f.variant().onGateChange(true);f.render();assert.equal(f.report(),undefined,'reference readiness cannot create a final grade');
 f.variant().onActivityChange(true);f.render();assert.equal(f.button('Back to grading review').props.disabled,true,'explicit reference refresh keeps navigation locked until settled');
 f.variant().onActivityChange(false);f.render();f.button('Back to grading review').props.onClick();f.render();
 assert.ok(f.focusedGeometry());assert.equal(f.current.geometry,geometry);assert.equal(previews,0);assert.deepEqual(f.actions,[]);
 assert.ok(f.calls.every(call=>!call.options?.method));f.dispose();
});



test('reopening rapid review resumes Findings after saved geometry and Grade after saved findings without approvals',async()=>{
 for(const confirmed of [false,true]){
  const f=harness({rapid:true,initialView:{geometry:{confirmed:true},defects:{confirmed,marker:'retained'}}});
  await flush();f.render();assert.equal(f.focusedGeometry(),undefined);
  if(confirmed)assert.ok(f.report());else assert.ok(f.defects());
  assert.equal(f.actions.length,0);f.dispose();
 }
});
test('explicit geometry correction remains accessible when saved findings are complete',async()=>{
 const f=harness({rapid:true,initialGeometrySide:'BACK',initialView:{geometry:{confirmed:true},defects:{confirmed:true}}});
 await flush();f.render();assert.equal(f.focusedGeometry().side,'BACK');assert.equal(f.report(),undefined);
 assert.equal(f.actions.length,0);f.dispose();
});


test('one controlled side review keeps selection and navigation display-only',async()=>{
 const findings=[{id:'front-a',side:'FRONT',defectType:'VISIBLE_WHITENING'},{id:'back-b',side:'BACK',defectType:'LIGHT_SCRATCH_SCUFF'}];
 const f=harness({finalReview:true,rapid:true});await flush();f.render();
 f.publish({...f.current,defects:{sides:Object.fromEntries(['FRONT','BACK'].map(side=>[side,{findings:findings.filter(value=>value.side===side),pending:null}]))}});
 await approveGeometry(f);const count=f.actions.length;
 assert.equal(f.defects().side,'FRONT');assert.equal(f.defects().findingId,'front-a','side entry opens the first current finding close-up');assert.equal(f.defects().focusedReview,undefined);assert.equal(f.button('Review one at a time'),undefined);
 f.defects().onReadyChange(true);f.render();f.defects().onSelectFinding(findings[0]);f.render();assert.equal(f.defects().findingId,'front-a');
 f.defects().onSelectFinding(null);f.render();assert.equal(f.defects().findingId,null,'Fit remains a deliberate whole-side view');
 f.defects().onSideChange('BACK');f.render();assert.equal(f.defects().side,'BACK');assert.equal(f.defects().findingId,'back-b');assert.equal(f.button('Approve back findings').props.disabled,true,'new side must verify its own photographs');
 const staleChange=f.defects().onSideChange;f.defects().onEditingChange(true);staleChange('FRONT');f.render();assert.equal(f.defects().side,'BACK');
 assert.equal(f.actions.length,count);assert.equal(f.calls.filter(call=>call.options?.method==='POST').length,0);f.dispose();
});

test('front and back approval use one side gesture each and wait for saved confirmation before Grade',async()=>{
 const f=harness({finalReview:true,rapid:true});await flush();f.render();await approveGeometry(f);
 f.defects().onReadyChange(true);f.render();await f.button('Approve front findings').props.onClick();await flush();f.render();
 assert.equal(f.defects().side,'BACK');assert.equal(f.report(),undefined);assert.equal(f.actions.at(-1).type,'INSPECT_SIDE');assert.equal(f.actions.at(-1).side,'FRONT');
 assert.equal(f.button('Approve back findings').props.disabled,true);f.defects().onReadyChange(true);f.render();
 let finish;f.onExecute=action=>action.type==='CONFIRM_FINDINGS'?new Promise(resolve=>{finish=resolve;}):undefined;
 const approve=f.button('Approve back findings').props.onClick,saving=approve();await flush();await approve();f.render();
 assert.equal(f.report(),undefined);assert.equal(f.actions.filter(action=>action.type==='CONFIRM_FINDINGS').length,1);assert.equal(f.button('Approve back findings').props.disabled,true);
 finish();await saving;await flush();f.render();assert.ok(f.report());assert.equal(f.actions.some(action=>action.type==='REVIEW_FINDING'||action.type==='APPROVE_REPORT'),false);
 assert.deepEqual(f.actions.filter(action=>action.type==='INSPECT_SIDE').map(action=>action.side),['FRONT','BACK']);f.dispose();
});

test('failed side approval preserves the active side and an old enabled handler cannot bypass a pending command',async()=>{
 const f=harness({finalReview:true,rapid:true});await flush();f.render();await approveGeometry(f);f.defects().onReadyChange(true);f.render();
 const approve=f.button('Approve front findings').props.onClick;f.onExecute=action=>{if(action.type==='INSPECT_SIDE')throw {code:'SAVE_NOT_CONFIRMED'};};
 await approve();await flush();f.render();assert.equal(f.defects().side,'FRONT');assert.equal(f.report(),undefined);assert.match(f.text(),/SAVE_NOT_CONFIRMED/);
 const count=f.actions.length;f.pending=true;await approve();await flush();f.render();assert.equal(f.actions.length,count);assert.equal(f.report(),undefined);f.dispose();
});

test('historical original observations and variant recheck metadata cannot veto current findings approval',async()=>{
 const f=harness({finalReview:true,rapid:true,initialView:{
   finalReview:{reportHash:'historical-machine-report',report:{findings:[],unmeasurableProposals:[{id:'old-observation',side:'FRONT',defectType:'VISIBLE_WHITENING'}]}},
   variantVerification:{enabled:true,approvalReady:false,confirmation:{decision:'SELECTED',reprocessRequired:true,recheckState:'QUEUED'}},
 }});await flush();f.render();
 assert.equal(f.focusedGeometry().reviewObservations,undefined);await approveGeometry(f);f.defects().onReadyChange(true);f.render();
 assert.equal(f.defects().renderObservations,undefined);assert.doesNotMatch(f.text(),/Original observations|Checking the confirmed variant|Review notes/);
 assert.equal(f.button('Approve front findings').props.disabled,false);await f.button('Approve front findings').props.onClick();await flush();f.render();
 assert.equal(f.defects().side,'BACK');assert.equal(f.actions.some(action=>action.type==='REJECT_FINAL_OBSERVATION'),false);assert.equal(f.calls.filter(call=>call.options?.method==='POST').length,0);f.dispose();
});

test('a corrected finding stays in the same side review until its measurement acknowledges without a finding checklist',async()=>{
 const f=harness();await flush();f.render();f.defects().onSideChange('BACK');f.render();let measurement;
 f.onExecute=action=>action.type==='MEASURE_SIDE'?new Promise((resolve,reject)=>{measurement={resolve,reject};}):undefined;
 const saving=f.defects().onEdit({side:'BACK',base:base.BACK,action:{type:'REMOVE',defectIds:['back-finding']}});await flush();
 assert.equal(f.defects().side,'BACK');assert.equal(f.report(),undefined);measurement.reject({code:'MEASUREMENT_NOT_CONFIRMED'});await assert.rejects(saving,error=>error.code==='MEASUREMENT_NOT_CONFIRMED');
 f.render();assert.equal(f.defects().side,'BACK');assert.deepEqual(f.actions.map(action=>action.type),['EDIT_DEFECT','MEASURE_SIDE']);
 assert.equal(f.actions.some(action=>action.type==='INSPECT_SIDE'||action.type==='CONFIRM_FINDINGS'||action.type==='REVIEW_FINDING'),false);f.dispose();
});

test('accepted background analysis uses GET only and a late response cannot replace an active manual edit',async()=>{
 const id='55555555-5555-4555-8555-555555555555';
 const f=harness({journal:{version:1,phase:'PENDING',canResume:false,body:{actionId:id,base}}});let finish,reads=0;
 f.respond=async(path,options)=>{
  assert.equal(options?.method,undefined);
  if(reads++===0)return {astra:{enabled:true,status:'RUNNING',backgroundAccepted:true,analysisId:id,base,proposals:[]}};
  return new Promise(resolve=>{finish=resolve;});
 };
 await flush();f.render();const polling=f.tick();await flush();
 f.defects().onEditingChange(true);f.publish({...f.current,card:{revision:2,contentHash:'new-trace'},defects:{marker:'new-human-trace'}});
 finish({astra:{enabled:true,status:'READY',analysisId:id,base,proposals:[]}});await polling;f.render();
 assert.equal(f.defects().workspace.marker,'new-human-trace');assert.equal(f.button('Edit card details').props.disabled,true);
 assert.equal(f.actions.length,0);assert.equal(f.calls.filter(call=>call.options?.method==='POST').length,0);f.dispose();
});

test('explicit retry after a refused provider call starts one new journaled request without changing human findings', async () => {
  const previous = '33333333-3333-4333-8333-333333333333';
  const f = harness({ initialView: { astra: { enabled: true, status: 'REFUSED', analysisId: previous,
    code: 'DEFECT_ANALYSIS_PROVIDER_HTTP_ERROR', httpStatus: 500, proposals: [] } } });
  await flush(); f.render();
  const before = f.current.defects; let finish;
  f.respond = async (_path, options) => new Promise(resolve => { finish = () => resolve({ astra: { enabled: true,
    status: 'RUNNING', backgroundAccepted: true, analysisId: options.body.actionId, base, proposals: [] } }); });
  const pending = f.defects().onAnalyzeDefects(); await flush(); f.render();
  assert.equal(f.defects().disabled, false); assert.equal(f.button('Edit card details').props.disabled, false);
  const post = f.calls.find(call => call.options.method === 'POST');
  assert.ok(post); assert.notEqual(post.options.body.actionId, previous);
  assert.deepEqual(post.options.body.base, base);
  await assert.rejects(f.defects().onAnalyzeDefects(), /MANUAL_ANALYSIS_BUSY/);
  assert.equal(f.calls.filter(call => call.options.method === 'POST').length, 1);
  finish(); await pending; f.render();
  assert.equal(f.defects().workspace, before); assert.equal(f.actions.length, 0);
  assert.equal(f.defects().astra.status, 'RUNNING'); f.dispose();
});

const editableIdentity={cardName:'Pikachu',year:null,productSet:'Scarlet & Violet Promo',cardNumber:'027',parallel:'English Cosmos Holofoil',layoutType:'POKEMON'};

for(const side of ['FRONT','BACK'])test(`inline identity correction preserves the mounted ${side} geometry workspace and saved findings`,async()=>{
 const f=harness({initialGeometrySide:side,initialView:{identity:editableIdentity}});await flush();f.render();
 const workspace=f.geometry().workspace,defects=f.current.defects,images=f.geometry().images,key=f.geometry().key,scrolls=f.scroll.resets;
 f.identity().onEdit();f.render();assert.equal(f.identity().draft.year,null);assert.equal(f.geometry().key,key);assert.equal(f.geometry().workspace,workspace);assert.equal(f.geometry().busy,true);
 f.identity().onChange('year','2023');f.render();await f.identity().onSave();await flush();f.render();
 assert.equal(f.geometry().side,side);assert.equal(f.geometry().key,key);assert.equal(f.geometry().workspace,workspace);assert.equal(f.geometry().images,images);assert.equal(f.current.defects,defects);
 assert.equal(f.identity().draft,null);assert.equal(f.current.identity.year,'2023');assert.equal(f.current.card.revision,2);assert.equal(f.scroll.resets,scrolls);
 assert.deepEqual(f.actions.map(action=>action.type),['IDENTITY_EDIT']);assert.ok(f.calls.every(call=>!call.options?.method));f.dispose();
});

test('saving details during Back findings keeps the selected finding, mounted workspace and variant stage',async()=>{
 const f=harness({initialView:{identity:editableIdentity,variantVerification:{enabled:true}}});await flush();f.render();
 f.defects().onSideChange('BACK');f.render();f.defects().onSelectFinding({id:'back-scratch'});f.render();const workspace=f.defects().workspace,key=f.defects().key;
 f.identity().onEdit();f.render();assert.equal(f.defects().disabled,true);f.identity().onChange('year','2023');f.render();await f.identity().onSave();f.render();
 assert.equal(f.defects().side,'BACK');assert.equal(f.defects().findingId,'back-scratch');assert.equal(f.defects().key,key);assert.equal(f.defects().workspace,workspace);
 f.button('View references').props.onClick();f.render();assert.ok(f.variant());const savedKey=f.variant().key;
 f.identity().onEdit();f.render();assert.equal(f.variant().key,savedKey);f.identity().onChange('manufacturer','Pokémon');f.render();await f.identity().onSave();f.render();
 assert.ok(f.variant());assert.equal(f.variant().identity.manufacturer,'Pokémon');assert.equal(f.report(),undefined);assert.equal(f.geometry(),undefined);
 f.button('Back to grading review').props.onClick();f.render();assert.equal(f.defects().side,'BACK');assert.equal(f.defects().findingId,'back-scratch');
 assert.deepEqual(f.actions.map(action=>action.type),['IDENTITY_EDIT','IDENTITY_EDIT']);assert.ok(f.calls.every(call=>!call.options?.method));f.dispose();
});

test('unchanged details close without a command, revision or variant invalidation',async()=>{
 const f=harness({initialView:{identity:editableIdentity,variantVerification:{enabled:true}}});await flush();f.render();await f.openGrade();f.variant().onGateChange(true);f.report().onReadyChange(true);f.render();
 f.identity().onEdit();f.render();f.identity().onChange('cardName','  Pikachu  ');f.render();await f.identity().onSave();f.render();
 assert.equal(f.identity().draft,null);assert.equal(f.current.card.revision,1);assert.equal(f.actions.length,0);assert.equal(f.button('Approve final grade and queue label').props.disabled,false);f.dispose();
});

test('identity failures retain the draft, validation prevents requests and duplicate saves share one command',async()=>{
 const f=harness({initialGeometrySide:'FRONT',initialView:{identity:editableIdentity}});await flush();f.render();f.identity().onEdit();f.render();
 f.identity().onChange('cardName','x'.repeat(121));f.render();await f.identity().onSave();f.render();assert.ok(f.identity().errors.cardName);assert.equal(f.actions.length,0);
 f.identity().onChange('cardName','Pikachu');f.identity().onChange('year','2023');f.render();let reject;
 f.onExecute=()=>new Promise((_resolve,no)=>{reject=no;});const save=f.identity().onSave;const work=save();await save();f.render();
 assert.equal(f.actions.length,1);assert.equal(f.identity().saving,true);f.identity().onCancel();f.render();assert.ok(f.identity().draft);
 reject({code:'MANUAL_REVISION_CONFLICT'});await work;f.render();assert.equal(f.identity().draft.year,'2023');assert.equal(f.identity().saving,false);assert.match(f.text(),/MANUAL_REVISION_CONFLICT/);assert.equal(f.geometry().side,'FRONT');f.dispose();
});

test('a changed card head cannot silently receive an older full identity draft',async()=>{
 const f=harness({initialView:{identity:editableIdentity}});await flush();f.render();f.identity().onEdit();f.render();f.identity().onChange('year','2023');f.render();
 f.publish({...f.current,identity:{...editableIdentity,cardName:'Newer saved name'},card:{revision:2,contentHash:'newer'}});await f.identity().onSave();f.render();
 assert.match(f.identity().errors.identity,/changed while you were editing/);assert.equal(f.identity().draft.year,'2023');assert.equal(f.actions.length,0);f.dispose();
});

test('identity correction on Grade keeps Grade and refreshes only its report preview',async()=>{
 const f=harness({initialView:{identity:editableIdentity,variantVerification:{enabled:true}}});await flush();f.render();await f.openGrade();f.report().onReadyChange(true);f.variant().onGateChange(true);f.render();
 const staleApprove=f.button('Approve final grade and queue label').props.onClick;f.identity().onEdit();await staleApprove();f.render();assert.equal(f.actions.length,0);
 assert.equal(f.button('Approve final grade and queue label').props.disabled,true);f.identity().onChange('year','2023');f.render();await f.identity().onSave();f.render();
 assert.ok(f.report());assert.equal(f.report().preview.sourceRevision,2);assert.equal(f.report().current,true);assert.equal(f.identity().draft,null);assert.equal(f.geometry(),undefined);assert.equal(f.button('Approve final grade and queue label'),undefined,'new identity must pass variant verification again');
 assert.deepEqual(f.actions.map(action=>action.type),['IDENTITY_EDIT']);assert.ok(f.calls.every(call=>!call.options?.method));f.dispose();
});


test('normal saved-review loading has no retry control before a failure',async()=>{
 let finish;const f=harness({rapid:true,recover:()=>new Promise(resolve=>{finish=resolve;})});
 assert.match(f.text(),/Loading saved review/);assert.equal(f.button('Retry loading review'),undefined);
 finish();await flush();f.render();assert.ok(f.focusedGeometry());assert.equal(f.actions.length,0);f.dispose();
});

test('failed saved-review read retries the same load and restores its current sequential stage',async()=>{
 let count=0,finish;const f=harness({rapid:true,recover:async()=>{if(++count===1)throw {code:'READ_FAILED'};await new Promise(resolve=>{finish=resolve;});}});
 await flush();f.render();assert.match(f.text(),/READ_FAILED/);assert.doesNotMatch(f.text(),/Loading saved review/);
 f.button('Retry loading review').props.onClick();f.render();assert.match(f.text(),/Loading saved review/);assert.equal(f.button('Retry loading review'),undefined);
 finish();await flush();f.render();assert.ok(f.focusedGeometry());assert.equal(f.focusedGeometry().side,'FRONT');assert.equal(f.actions.length,0);f.dispose();
});

const unfinishedGeometry=()=>({confirmed:false,sides:{FRONT:{physical:{quad:'saved-front'},prepared:null},BACK:{physical:{quad:'saved-back'},prepared:null}}});
test('opening existing review prepares saved outlines sequentially before enabling editing, without confirmation or model calls',async()=>{
 const f=harness({rapid:true,initialView:{geometry:unfinishedGeometry(),astra:{enabled:false}}});let complete;
 f.onExecute=action=>new Promise(resolve=>{complete=()=>{f.current={...f.current,card:{...f.current.card,revision:f.current.card.revision+1},geometry:{...f.current.geometry,sides:{...f.current.geometry.sides,[action.side]:{...f.current.geometry.sides[action.side],prepared:{frame:'prepared'},printed:{quad:'retained-astra'}}}}};resolve();};});
 await flush();f.render();assert.equal(f.geometry(),undefined);assert.match(f.text(),/Preparing saved outlines/);assert.equal(f.locked,true);
 assert.deepEqual(f.actions.map(a=>[a.type,a.side]),[['PREPARE_SIDE','FRONT']]);
 complete();await flush();f.render();assert.equal(f.geometry(),undefined);assert.equal(f.actions.length,2);
 complete();await flush();f.render();assert.ok(f.geometry());assert.equal(f.geometry().workspace.sides.FRONT.printed.quad,'retained-astra');
 assert.deepEqual(f.actions.map(a=>[a.type,a.side]),[['PREPARE_SIDE','FRONT'],['PREPARE_SIDE','BACK']]);assert.equal(f.current.geometry.confirmed,false);assert.equal(f.calls.length,0);f.dispose();
});
test('failed entry preparation stays in current editor and retries only the still-unprepared side',async()=>{
 const geometry=unfinishedGeometry();geometry.sides.FRONT.prepared={frame:'already-ready'};
 const f=harness({rapid:true,initialView:{geometry,astra:{enabled:false}}});let fail=true;
 f.onExecute=async action=>{if(fail)throw {code:'MANUAL_PREPARATION_FAILED'};f.current={...f.current,geometry:{...geometry,sides:{...geometry.sides,BACK:{...geometry.sides.BACK,prepared:{frame:'ready'}}}}};};
 await flush();f.render();assert.ok(f.geometry());assert.match(f.text(),/MANUAL_PREPARATION_FAILED/);assert.ok(f.button('Retry preparation'));
 fail=false;f.button('Retry preparation').props.onClick();await flush();f.render();assert.ok(f.geometry());assert.equal(f.button('Retry preparation'),undefined);
 assert.deepEqual(f.actions.map(a=>[a.type,a.side]),[['PREPARE_SIDE','BACK'],['PREPARE_SIDE','BACK']]);assert.equal(f.current.geometry.confirmed,false);f.dispose();
});
for(const scenario of ['read-only','approved'])test(`entry preparation leaves ${scenario} review untouched`,async()=>{
 const f=harness({rapid:true,role:scenario==='read-only'?'VIEWER':'REVIEWER',initialView:{geometry:unfinishedGeometry(),astra:{enabled:false},...(scenario==='approved'?{approval:{sourceHash:'one'}}:{})}});
 await flush();f.render();assert.equal(f.actions.length,0);f.dispose();
});
