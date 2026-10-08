import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import * as feedback from '../lib/review-feedback.mjs';
import * as batchQueue from '../lib/batch-queue.mjs';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { samplePlan } from '../../../packages/atlas-finishing/test/manual-fixture.mjs';
const require = createRequire(new URL('../package.json', import.meta.url));
const babel = require('next/dist/compiled/babel/core'), nextRequire = createRequire(require.resolve('next/package.json'));
const code = babel.transformSync(readFileSync(new URL('../components/BatchGrading.jsx', import.meta.url), 'utf8'), {
  filename: 'BatchGrading.jsx', presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]], babelrc: false, configFile: false,
}).code;
const all = (value, match, out = []) => { if (Array.isArray(value)) value.forEach(item => all(item, match, out)); else if (value && typeof value === 'object') { if (match(value)) out.push(value); all(value.props?.children, match, out); } return out; };
const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : value ?? '';
async function fixture({ pending = false, mismatch = false, deferred = false, deferredJobs = false, intake = false, attention = false, resumeFailure = null, correcting = false, partial = false, oldScoringPolicy = false, correctionFailure = null } = {}) {
  const plan = samplePlan(), key = 'a'.repeat(64); let staff = { id: 'fixture-reviewer', role: 'REVIEWER' };
  const packet = { key, cardId: plan.binding.cardId, canCertify: true, reportHash: 'c'.repeat(64), report: {
    geometry: { FRONT: { frame: { inspectionImageSha256: 'd'.repeat(64) } }, BACK: { frame: { inspectionImageSha256: 'e'.repeat(64) } } },
  } };
  if (partial) Object.assign(packet,{canCertify:false,reviewRequiredReason:'BATCH_FINAL_GEOMETRY_REQUIRED',explanation:null,report:{...packet.report,calculationState:'GEOMETRY_UNRESOLVED',grade:null,proposedGrade:null}});
  if (oldScoringPolicy) Object.assign(packet, { canCertify: false, reviewRequiredReason: 'BATCH_SCORING_POLICY_UPDATED' });
  if (correcting) { packet.correctionAvailable = true; packet.canCertify = false; }
  const result = { cardId: packet.cardId, actionId: plan.binding.approvalActionId, publication: {
    state: pending ? 'PENDING' : 'PUBLISHED', actionId: plan.binding.approvalActionId,
    reportHash: plan.binding.reportHash, publicHash: plan.binding.publicHash, version: plan.binding.approvalVersion, reportNumber: plan.binding.reportNumber,
  } };
  const f = { calls: [], popups: [], events: [], approved: false, disposed: false, plan, result, packet, actions: [], routes: [] };
  let resolveApproval, resolveJobs; const response = deferred ? new Promise(resolve => { resolveApproval = resolve; }) : Promise.resolve(result);
  f.release = () => resolveApproval?.(result);
  f.releaseJobs = jobs => resolveJobs?.({ jobs });
  f.jobs = [{ key, cardId: packet.cardId, state: attention ? 'NEEDS_ATTENTION' : 'REVIEW', revision: 7,
    canResumeProcessing: attention, evidence: { proposedGrade: 9.5 } }];
  const slots = [], effects = []; let cursor = 0, dirty = false, tree;
  const changed = (old, deps) => !old || deps.some((value, index) => value !== old[index]);
  const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const id = cursor++; if (!(id in slots)) slots[id] = typeof initial === 'function' ? initial() : initial; return [slots[id], value => { const next = typeof value === 'function' ? value(slots[id]) : value; if (!Object.is(next, slots[id])) { slots[id] = next; dirty = true; } }]; },
    useRef(initial) { const id = cursor++; if (!(id in slots)) slots[id] = { current: initial }; return slots[id]; },
    useCallback(callback, deps) { const id = cursor++; if (changed(slots[id]?.deps, deps)) slots[id] = { deps, value: callback }; return slots[id].value; },
    useEffect(callback, deps) { const id = cursor++; if (changed(slots[id]?.deps, deps)) { const previous = slots[id]; slots[id] = { deps, cleanup: previous?.cleanup }; effects.push(() => { previous?.cleanup?.(); slots[id].cleanup = callback(); }); } },
  };
  function MachineReportReview() {} function ManualFinishing() {} function BatchImport() {}
  const request = async (url, options = {}) => {
    f.calls.push({ url, options }); f.events.push(options.method === 'POST' ? 'POST' : url.includes('/finishing/') ? 'LABEL' : 'READ');
    if (url === '/api/staff/session') return { staff, csrf: 'fixture-csrf' };
    if (url === '/api/staff/manual-connected/cards/batch') {
      if (deferredJobs && !resolveJobs) return new Promise(resolve => { resolveJobs = resolve; });
      return { jobs: f.approved ? [] : f.jobs };
    }
    if (url.endsWith(`/${key}`)) return packet;
    if (url.endsWith('/thumbnail')) return {images:{FRONT:{state:'READY',preview:{url:'/front-thumb.jpg'}},BACK:{state:'READY',preview:{url:'/back-thumb.jpg'}}}};
    if (url.endsWith(`/${key}/review`)) { f.approved = true; return response; }
    if (url.endsWith('/batch/resume')) {
      f.jobs = [{ ...f.jobs[0], state: 'QUEUED', revision: 8, canResumeProcessing: false }];
      if (resumeFailure) throw resumeFailure;
      return { job: f.jobs[0] };
    }
    if (url.includes('/finishing/')) return mismatch ? { ...plan, binding: { ...plan.binding, cardId: randomUUID() } } : plan;
    throw new Error(`Unexpected fixture request ${url}`);
  };
  const exports = {}, local = new Map(), router = { query: { tab: intake ? 'INTAKE' : attention ? 'NEEDS_ATTENTION' : 'REVIEW' }, pathname: '/batch', push(url) { f.routes.push(url); }, replace() {} };
  vm.runInNewContext(code, { exports, AbortController, crypto: { randomUUID }, setInterval: () => 1, clearInterval() {},
    window: { addEventListener() {}, removeEventListener() {} }, document: { visibilityState: 'visible' },
    localStorage: { getItem: key => local.get(key) ?? null, setItem: (key, value) => local.set(key, value), removeItem: key => local.delete(key) },
    require(name) {
      if (name === '../lib/batch-queue.mjs') return batchQueue;
      if (name === '../lib/review-feedback.mjs') return {...feedback,primeReviewAudio(){}};
      if (name === './RapidReviewControls') return {AtlasSoundControl:'AtlasSoundControl'};
      if (name === 'react') return react;
      if (name === 'next/router') return { useRouter: () => router };
      if (name === './ManualCards') return {ManualWorkspace:'ManualWorkspace'};
      if (name === './BatchImport') return BatchImport;
      if (['next/link', './Shell'].includes(name)) return () => null;
      if (name.endsWith('.css')) return new Proxy({}, { get: (_, key) => key });
      if (name.endsWith('/manual-client.mjs')) return { manualRequest: request, manualMessage: failure => failure.code ?? 'Label unavailable.' };
      if (name.endsWith('/routes.mjs')) return { STAFF_BASE_PATH: '/app' };
      if (name === '@atlas/manual-workspace/image-cache') return {usePrefetchVerifiedImages:()=>()=>()=>{}};
      if (name === '@atlas/manual-workspace/report-review') return { MachineReportReview };
      if (name === '@atlas/manual-workflow/client') return { createManualClient: () => ({
        recover: async () => correcting ? { finalReview: { reportHash: packet.reportHash } } : {},
        execute: async action => { f.actions.push(action); if (correctionFailure) { const failure = correctionFailure; correctionFailure = null; throw failure; } },
      }) };
      if (name === './ManualFinishing') return { __esModule: true, default: ManualFinishing, openManualLabelPrintWindow() {
        f.events.push('POPUP'); const popup = { closed: false, close() { this.closed = true; } }; f.popups.push(popup); return popup;
      } };
      return nextRequire(name.startsWith('@babel/runtime/') ? `next/dist/compiled/${name}` : name);
    },
  });
  f.render = () => { if (f.disposed) return; let count = 0; do { dirty = false; cursor = 0; tree = exports.default({ staff }); effects.splice(0).forEach(callback => callback()); assert.ok(++count < 25); } while (dirty); };
  f.flush = async () => { for (let step = 0; step < 8; step++) { await new Promise(resolve => setImmediate(resolve)); f.render(); } };
  f.find = predicate => all(tree, predicate); f.text = () => text(tree);
  f.switchStaff = id => { staff = { ...staff, id }; f.render(); };
  f.ready = () => { f.find(node => node.type === MachineReportReview)[0].props.onReadyChange(true); f.render(); };
  f.approve = () => f.find(node => node.type === 'button' && /Approve & print next/.test(text(node)))[0].props.onClick();
  f.reviews = () => f.find(node => node.type === MachineReportReview);
  f.importer = () => f.find(node => node.type === BatchImport);
  f.finishing = () => f.find(node => node.type === ManualFinishing);
  f.dispose = () => { f.disposed = true; slots.forEach(slot => slot?.cleanup?.()); };
  f.render(); await f.flush(); return f;
}
test('batch approval owns one popup before POST and prepares only the exact committed label', async () => {
  const f = await fixture(); assert.equal(f.popups.length, 0); assert.equal(f.finishing().length, 0);
  f.ready(); const pending = f.approve(); assert.equal(f.popups.length, 1);
  assert.deepEqual(f.events.filter(event => ['POPUP', 'POST'].includes(event)), ['POPUP', 'POST']);
  await pending; await f.flush();
  assert.equal(f.finishing().length, 1); assert.equal(f.finishing()[0].props.plan, f.plan);
  assert.equal(f.finishing()[0].props.autoPrintWindow, f.popups[0]); assert.equal(f.finishing()[0].props.printDisabled, false);
  const post = f.calls.find(call => call.options.method === 'POST');
  assert.equal(post.options.body.reviewed, true); assert.equal(post.options.body.images.FRONT, 'd'.repeat(64));
  assert.equal(post.options.body.reportHash, f.packet.reportHash); f.dispose();
});
test('final corrections begin only on the explicit gesture and retain the exact displayed machine report binding', async () => {
  const f = await fixture();
  assert.equal(f.actions.length, 0);
  f.find(node => node.type === 'button' && text(node) === 'Review geometry / make corrections')[0].props.onClick();
  await f.flush();
  assert.deepEqual(f.actions.map(action => ({ ...action })), [{ type: 'BEGIN_FINAL_REVIEW', batchKey: f.packet.key, reportHash: f.packet.reportHash }]);
  assert.deepEqual(f.routes, []); assert.equal(f.find(node=>node.type?.name==='RapidReviewDialog')[0].props.job.navigationMode,'ordinary');
  assert.equal(f.popups.length, 0); assert.equal(f.calls.some(call => call.options.method === 'POST'), false);
  f.dispose();
});
test('queue previews use the thumbnail-only projection without a full-photo proxy or review write', async () => {
  const f = await fixture();
  f.packet.images = { FRONT: { inspection: { url: 'https://private-images.example/front.png' } }, BACK: { inspection: { url: 'https://private-images.example/back.png' } } };
  const photo = f.find(node => node.type?.name === 'QueuePhoto')[0];
  assert.ok(photo);
  const before = f.calls.length;
  const [first, second] = await Promise.all([photo.props.readPreview(f.jobs[0]), photo.props.readPreview(f.jobs[0])]);
  assert.equal(first.FRONT.url, '/front-thumb.jpg'); assert.deepEqual(first, second);
  assert.equal(f.calls.length, before+1); assert.equal(f.actions.length, 0);
  assert.equal(f.calls.some(call => call.url.includes('/preview-image/') || call.options.method === 'POST'), false);
  f.dispose();
});
test('the contextual correction action retains the same explicit final-review binding', async () => {
  const f = await fixture(); f.reviews()[0].props.onCorrectFinding({ id: 'fixture-finding', side: 'BACK' }); await f.flush();
  assert.equal(f.actions[0].type, 'BEGIN_FINAL_REVIEW'); assert.equal(f.actions[0].reportHash, f.packet.reportHash);
  assert.equal(f.popups.length, 0); assert.equal(f.calls.some(call => call.options.method === 'POST'), false); f.dispose();
});
test('a corrected report continues the current final review and cannot approve the old machine report', async () => {
  const f = await fixture({ correcting: true });
  assert.equal(f.find(node => node.type === 'button' && /Approve & print/.test(text(node))).length, 0);
  f.find(node => node.type === 'button' && text(node) === 'Continue final review')[0].props.onClick();
  await f.flush();
  assert.equal(f.actions.length, 0); assert.deepEqual(f.routes, []); assert.equal(f.find(node=>node.type?.name==='RapidReviewDialog')[0].props.job.navigationMode,'ordinary');
  f.dispose();
});
test('mismatched label cannot print; pending publication closes popup without reading a label', async () => {
  for (const options of [{ mismatch: true }, { pending: true }]) {
    const f = await fixture(options); f.ready(); await f.approve(); await f.flush();
    assert.equal(f.popups[0].closed, true); assert.equal(f.finishing().length, 0); assert.match(f.text(), /Report approved/);
    if (options.pending) assert.equal(f.calls.some(call => call.url.includes('/finishing/')), false);
    f.dispose();
  }
});
test('unmount during approval closes its popup and discards late label effects', async () => {
  const f = await fixture({ deferred: true }); f.ready(); const pending = f.approve();
  f.dispose(); f.release(); await pending; await f.flush();
  assert.equal(f.popups[0].closed, true); assert.equal(f.calls.some(call => call.url.includes('/finishing/')), false);
});
test('a delayed queue response cannot display a prior staff account after account change', async () => {
  const f = await fixture({ deferredJobs: true });
  f.jobs = [{ key: 'second-job', cardId: 'second-card', state: 'QUEUED', label: 'Second account card' }];
  f.switchStaff('second-reviewer'); await f.flush();
  f.find(node => node.type === 'button' && /^Grading/.test(text(node)))[0].props.onClick(); await f.flush();
  assert.match(f.text(), /Second account card/);
  f.releaseJobs([{ key: 'first-job', cardId: 'first-card', state: 'QUEUED', label: 'Prior account card' }]);
  await f.flush();
  assert.match(f.text(), /Second account card/); assert.doesNotMatch(f.text(), /Prior account card/);
  assert.equal(f.calls.some(call => call.options.method === 'POST'), false); f.dispose();
});
test('photo intake stays mounted while switching to review so saved uploads keep running', async () => {
  const f = await fixture({ intake: true });
  assert.equal(f.importer().length, 1); assert.equal(f.importer()[0].props.enabled, true);
  assert.equal(f.reviews().length, 0);
  f.find(node => node.type === 'button' && /^Review/.test(text(node)))[0].props.onClick(); await f.flush();
  assert.equal(f.importer().length, 1); assert.equal(f.importer()[0].props.enabled, true);
  assert.equal(f.reviews().length, 1);
  assert.equal(f.calls.some(call => call.options.method === 'POST'), false); f.dispose();
});
test('resume binds the displayed revision once and reconciles a lost response without reenqueuing', async () => {
  for (const resumeFailure of [null, { code: 'NETWORK_FAILED' }]) {
    const f = await fixture({ attention: true, resumeFailure });
    const button = f.find(node => node.type === 'button' && text(node) === 'Resume saved processing')[0];
    assert.ok(button);
    const attempt = button.props.onClick();
    await button.props.onClick(); // a rapid second click cannot dispatch again
    await attempt; await f.flush();
    const posts = f.calls.filter(call => call.options.method === 'POST');
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, '/api/staff/manual-connected/cards/batch/resume');
    assert.equal(posts[0].options.body.key, f.packet.key);
    assert.equal(posts[0].options.body.expectedRevision, 7);
    assert.equal(f.find(node => node.type === 'button' && text(node) === 'Resume saved processing').length, 0);
    assert.equal(f.calls.at(-1).url, '/api/staff/manual-connected/cards/batch');
    f.dispose();
  }
});

test('partial batch report keeps evidence visible and gives geometry action instead of a certification or loading message',async()=>{
  const f=await fixture({partial:true});assert.equal(f.reviews().length,1);f.ready();
  assert.match(f.text(),/Defect analysis and measurements are saved/);assert.doesNotMatch(f.text(),/trained reviewer is required|Loading the exact/);
  const approve=f.find(node=>node.type==='button'&&text(node)==='Approve & print next')[0];assert.equal(approve.props.disabled,true);
  await approve.props.onClick();await f.flush();assert.equal(f.popups.length,0);assert.equal(f.calls.some(call=>call.options.method==='POST'),false);
  f.find(node=>node.type==='button'&&text(node)==='Review geometry / make corrections')[0].props.onClick();await f.flush();
  assert.equal(f.actions[0].type,'BEGIN_FINAL_REVIEW');assert.equal(f.routes.length,0);assert.equal(f.find(node=>node.type?.name==='RapidReviewDialog')[0].props.job.navigationMode,'ordinary');f.dispose();
});

test('old scoring policy explains the approval block and opens the bound final review only on an explicit gesture', async () => {
  const f = await fixture({ oldScoringPolicy: true }); f.ready();
  assert.match(f.text(), /This draft uses an earlier scoring policy/);
  assert.match(f.text(), /recalculate its saved measurements with the current policy before approval/);
  assert.doesNotMatch(f.text(), /trained reviewer is required/);
  const approve = f.find(node => node.type === 'button' && text(node) === 'Approve & print next')[0];
  assert.equal(approve.props.disabled, true);
  await approve.props.onClick(); await f.flush();
  assert.equal(f.actions.length, 0); assert.equal(f.popups.length, 0);
  assert.equal(f.calls.some(call => call.options.method === 'POST'), false);
  f.find(node => node.type === 'button' && text(node) === 'Review updated scoring')[0].props.onClick(); await f.flush();
  assert.deepEqual(f.actions.map(action => ({ ...action })), [{ type: 'BEGIN_FINAL_REVIEW', batchKey: f.packet.key, reportHash: f.packet.reportHash }]);
  assert.equal(f.find(node => node.type?.name === 'RapidReviewDialog')[0].props.job.navigationMode, 'ordinary');
  assert.equal(f.popups.length, 0); assert.equal(f.calls.some(call => call.options.method === 'POST'), false);
  f.dispose();
});


test('label queue opens saved completion workspace directly instead of another navigation screen',async()=>{
  const f=await fixture();f.jobs=[{...f.jobs[0],state:'APPROVED'}];
  f.find(node=>node.type==='button'&&/^Label queue/.test(text(node)))[0].props.onClick();await f.flush();
  // Refresh the fixture through a staff generation to provide the updated queue.
  f.switchStaff('next-reviewer');await f.flush();
  const workspace=f.find(node=>node.type==='ManualWorkspace')[0];assert.ok(workspace);assert.equal(workspace.props.cardId,f.packet.cardId);
  assert.doesNotMatch(f.text(),/Open label & finishing/);assert.equal(f.popups.length,0);assert.equal(f.calls.some(call=>call.options.method==='POST'),false);f.dispose();
});

 test('failed rapid entry exposes retry for the same card and intent without losing the report', async () => {
  const f = await fixture({ correctionFailure: { code: 'MANUAL_TEMPORARILY_UNAVAILABLE' } });
  f.find(node => node.type === 'button' && text(node) === 'Start rapid review →')[0].props.onClick();
  await f.flush();
  assert.equal(f.find(node => node.type?.name === 'RapidReviewDialog').length, 0);
  assert.equal(f.reviews().length, 1);
  assert.match(f.text(), /Retry opening review/); assert.match(f.text(), /Open saved card workspace/);
  f.find(node => node.type === 'button' && text(node) === 'Retry opening review')[0].props.onClick();
  await f.flush();
  assert.equal(f.find(node => node.type?.name === 'RapidReviewDialog')[0].props.job.navigationMode, 'rapid');
  assert.deepEqual(f.actions[1], f.actions[0]);
  assert.doesNotMatch(f.text(), /Retry opening review/); assert.equal(f.popups.length, 0); f.dispose();
});
test('a refused stale review points to saved work and offers the existing workspace', async () => {
  const f = await fixture({ correctionFailure: { code: 'BATCH_REVIEW_STALE' } });
  f.find(node => node.type === 'button' && text(node) === 'Start rapid review →')[0].props.onClick(); await f.flush();
  assert.match(f.text(), /newer saved work/); assert.doesNotMatch(f.text(), /This step did not finish/);
  f.find(node => node.type === 'button' && text(node) === 'Open saved card workspace')[0].props.onClick();
  assert.deepEqual(f.routes, [`/manual/${f.packet.cardId}?from=batch`]); assert.equal(f.popups.length, 0); f.dispose();
});
