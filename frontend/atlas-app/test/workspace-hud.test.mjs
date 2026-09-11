import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as client from '../lib/workspace-client.mjs';

const require = createRequire(import.meta.url), babel = require('next/dist/compiled/babel/core');
const compiled = path => babel.transformSync(readFileSync(new URL(path, import.meta.url), 'utf8'), { filename: path,
    presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]], babelrc: false, configFile: false }).code;
const stagesCode = compiled('../components/WorkspaceStages.jsx'), activityCode = compiled('../components/WorkspaceActivity.jsx'), viewCode = compiled('../components/AstraStageView.jsx'), workspaceCode = compiled('../components/CardGradingWorkspace.jsx');
const at = '2026-09-10T22:50:00.000Z';
const card = () => ({ id: 'test-card', revision: 7, title: 'Saved card', stage: 'IDENTITY', state: 'IN_PROGRESS', operator: { kind: 'ASTRA', mode: 'CONTINUOUS' },
    observedOperator: { state: 'RUNNING' }, identity: {}, workspace: {}, sides: [{ side: 'FRONT', status: 'VERIFIED', width: 3024, height: 4032 }, { side: 'BACK', status: 'VERIFIED', width: 3024, height: 4032 }] });
const timing = () => ({ asOf: at, totalActiveMs: 45_000, runningSince: at, activeStage: 'IDENTITY', pausedReason: null,
    stages: [{ stage: 'PHOTOS', activeMs: 15_000, completedAt: at, measured: true }, { stage: 'IDENTITY', activeMs: 30_000, completedAt: null, measured: true }] });
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree && typeof tree === 'object' ? text(tree.props?.children) : tree ?? '';
const all = (tree, predicate, result = []) => { if (Array.isArray(tree)) tree.forEach(node => all(node, predicate, result)); else if (tree && typeof tree === 'object') { if (predicate(tree)) result.push(tree); all(tree.props?.children, predicate, result); } return result; };

function harness(code, props, injected = {}) {
    const slots = [], effects = [], timers = new Map(), exports = {}; let cursor = 0, timerId = 0, elapsed = 0;
    const react = { Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
        useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }]; },
        useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
        useEffect(action, deps) { const index = cursor++, old = slots[index]; if (!old || deps.some((value, i) => value !== old.deps[i])) { const next = { deps }; slots[index] = next; effects.push(() => { old?.cleanup?.(); next.cleanup = action(); }); } } };
    vm.runInNewContext(code, { exports, AbortController, performance: { now: () => elapsed }, sessionStorage: { getItem: () => null },
        setInterval(callback, ms) { const id = ++timerId; timers.set(id, { callback, ms, interval: true }); return id; }, clearInterval(id) { timers.delete(id); },
        setTimeout(callback, ms) { const id = ++timerId; timers.set(id, { callback, ms, interval: false }); return id; }, clearTimeout(id) { timers.delete(id); },
        require(name) {
            if (name === 'react') return react;
            if (name === 'next/link') return 'link';
            if (name === './Shell') return { Notice: 'notice' };
            if (name === './WorkspaceIcon') return 'icon';
            if (name === './WorkspaceShared') return { PhotoPreview: 'photo', ReportLink: 'report-link' };
            if (['./PhotoIntake', './WorkspaceActivity', './WorkspaceStages', './AstraStageView'].includes(name)) return name.slice(2);
            if (name === './WorkspaceGeometry') return {};
            if (name === '../lib/useWorkspaceMutation') return { useWorkspaceMutation: () => ({ ready: true, busy: false, pending: null }) };
            if (name === '../lib/usePendingNavigation') return { usePendingNavigation() {} };
            if (name === '../lib/workspace-client.mjs') return { ...client, ...injected };
            if (name.endsWith('.module.css')) return new Proxy({}, { get: (_, name) => name === '__esModule' ? false : name });
            return require(name.startsWith('@babel/runtime/') ? `next/dist/compiled/${name}` : name);
        } });
    const f = { exports, props, timers };
    f.render = () => { cursor = 0; f.tree = exports.default(f.props); for (const effect of effects.splice(0)) effect(); return f.tree; };
    f.nodes = predicate => all(f.tree, predicate);
    f.text = () => text(f.tree);
    f.tick = ms => { elapsed += ms; for (const value of timers.values()) if (value.interval) value.callback(); f.render(); };
    f.settle = async () => { await new Promise(resolve => setImmediate(resolve)); f.render(); f.render(); };
    f.dispose = () => { for (const slot of slots) slot?.cleanup?.(); };
    f.render(); f.render(); return f;
}

test('stage tracker marks only recorded completions, keeps view selection separate and never invents stage duration', () => {
    const selected = [], initial = card(), saved = timing();
    saved.stages[0] = { ...saved.stages[0], measured: false, activeMs: 0 };
    const f = harness(stagesCode, { card: { ...initial, stage: 'INSPECTION', timing: saved }, selectedStage: 'REPORT', onSelectStage: value => selected.push(value) });
    const steps = f.nodes(node => node.type === 'li'); assert.equal(steps.length, 8);
    assert.ok(steps[0].props.className.includes('stageDone')); assert.match(text(steps[0]), /—/);
    assert.ok(!steps[1].props.className.includes('stageDone'), 'A later card stage cannot fabricate an unrecorded completion');
    const current = f.nodes(node => node.type === 'button' && node.props['aria-current'] === 'step'); assert.equal(current.length, 1); assert.match(current[0].props['aria-label'], /Inspection/);
    assert.match(f.nodes(node => node.type === 'button' && node.props['aria-pressed'] === true)[0].props['aria-label'], /Report/);
    current[0].props.onClick(); assert.deepEqual(selected, ['INSPECTION']); assert.match(f.text(), /1 of 8 stages completed/); f.dispose();
});

test('active timer ticks from the server snapshot, freezes at human review and bounds disconnected display time', () => {
    const saved = timing(), f = harness(stagesCode, { card: { ...card(), timing: saved } });
    assert.match(f.text(), /00:45/); f.tick(3000); assert.match(f.text(), /00:48/);
    f.props.card = { ...card(), state: 'HUMAN_REVIEW', stage: 'REVIEW', timing: { ...saved, totalActiveMs: 51_000, runningSince: null, pausedReason: 'HUMAN_REVIEW' } }; f.render(); f.render();
    f.tick(60_000); assert.match(f.text(), /00:51/); assert.match(f.text(), /Paused · awaiting reviewer/); assert.equal(f.timers.size, 0);
    f.props.card = { ...card(), timing: { ...saved, asOf: '2026-09-10T23:00:00.000Z' } }; f.render(); f.render(); f.tick(25_000);
    assert.match(f.text(), /01:05/); assert.match(f.text(), /Waiting for update/); f.tick(300_000); assert.match(f.text(), /01:05/); f.dispose();
});

test('timer keeps long card durations and missing timing distinct from zero', () => {
    const f = harness(stagesCode, { card: card() });
    assert.equal(f.exports.formatActiveDuration(3_661_000), '1:01:01'); assert.equal(f.exports.formatActiveDuration(0), '00:00');
    for (const missing of [null, undefined, -1, NaN]) assert.equal(f.exports.formatActiveDuration(missing), '—');
    assert.match(f.text(), /Timing not yet recorded/); assert.doesNotMatch(f.text(), /00:00/); f.dispose();
});

test('activity renders held saved work truthfully and permits only the admitted saved-response recovery', async () => {
    const initial = card(), calls = [], controls = [], control = { state: 'NEEDS_ATTENTION', mode: 'CONTINUOUS', pending: 1, canRecover: true, canPause: false, canResume: false, canStep: false, canTakeOver: false };
    const f = harness(activityCode, { card: initial, disabled: false, onControl: action => controls.push(action), onObservedCard() {} }, {
        async workspaceRequest(path) { calls.push(path); return path.endsWith('/activity') ? { control, activity: [] } : { card: initial }; }
    });
    await f.settle(); assert.deepEqual(calls, ['workspace/cards/test-card', 'workspace/cards/test-card/activity']);
    assert.match(f.text(), /Astra needs attention/); assert.doesNotMatch(f.text(), /Astra is working/); assert.match(f.text(), /Continue from the saved response/);
    const recover = f.nodes(node => node.type === 'button' && text(node).includes('Continue Astra'))[0]; assert.equal(recover.props.disabled, false); recover.props.onClick(); assert.deepEqual(controls, ['RECOVER']);
    for (const label of ['Pause Astra', 'Resume Astra', 'Run next step', 'Take over manually']) assert.equal(f.nodes(node => node.type === 'button' && text(node).includes(label))[0].props.disabled, true);
    assert.equal(f.exports.operatorPresentation({ state: 'UNKNOWN', pending: 1 }, initial).tone, 'attention');
    assert.equal(f.exports.operatorPresentation({ state: 'RUNNING', mode: 'CONTINUOUS' }, { ...initial, state: 'HUMAN_REVIEW' }).label, 'Ready for human review'); f.dispose();
});

test('activity feed orders actual saved events newest first and cannot recover without server capability', async () => {
    const initial = card(), f = harness(activityCode, { card: initial, onObservedCard() {} }, {
        async workspaceRequest(path) { return path.endsWith('/activity') ? { control: { state: 'UNKNOWN', pending: 1, mode: 'CONTINUOUS' }, activity: [
            { id: 'older', at, stage: 'PHOTOS', actor: 'ASTRA', summary: 'Original photos inspected', status: 'RECORDED' },
            { id: 'newer', at: '2026-09-10T22:51:00.000Z', stage: 'IDENTITY', actor: 'ASTRA', summary: 'Identity proposed', status: 'PROPOSED' },
        ] } : { card: initial }; }
    });
    await f.settle(); assert.equal(f.nodes(node => node.type === 'button' && text(node).includes('Continue Astra')).length, 0);
    assert.match(text(f.nodes(node => node.type === 'li')[0]), /Identity proposed/); assert.doesNotMatch(f.text(), /Astra is working/); f.dispose();
});

for (const failedRead of ['card', 'activity']) test(`interrupted ${failedRead} reads retain the feed without claiming Astra is working or permitting a stale restart`, async () => {
    const initial = card(), actions = [], connection = []; let fail = false, stopped = false;
    const saved = [{ id: 'saved-inspection', at, stage: 'PHOTOS', actor: 'ASTRA', summary: 'Both original photographs inspected', status: 'RECORDED' }];
    const f = harness(activityCode, { card: initial, disabled: false, onControl: action => actions.push(action), onObservedCard() {}, onConnectionChange: value => connection.push(value) }, {
        async workspaceRequest(path) {
            if (fail && path.endsWith('/activity') === (failedRead === 'activity')) throw Object.assign(new Error('The request could not be completed.'), { code: 'INTERNAL_ERROR' });
            return path.endsWith('/activity') ? { activity: saved, control: stopped
                ? { state: 'NEEDS_ATTENTION', mode: 'CONTINUOUS', pending: 0, failureCode: 'ASTRA_DATABASE_TRANSACTION_FAILED', canPause: false, canResume: false, canStep: false, canTakeOver: true }
                : { state: 'RUNNING', mode: 'CONTINUOUS', pending: 0, canRecover: true, canPause: true, canResume: true, canStep: true, canTakeOver: true } } : { card: initial };
        }
    });
    const button = label => f.nodes(node => node.type === 'button' && text(node).includes(label))[0];
    const poll = async () => { const [id, timer] = [...f.timers].find(([, value]) => !value.interval); f.timers.delete(id); await timer.callback(); await f.settle(); };
    await f.settle(); assert.match(f.text(), /Astra is working/); assert.equal(connection.at(-1), 'CONNECTED');
    fail = true; await poll();
    assert.match(f.text(), /Reconnecting to Astra/); assert.match(f.text(), /Current progress is unconfirmed/);
    assert.match(f.text(), /Both original photographs inspected/); assert.doesNotMatch(f.text(), /Astra is working|The request could not be completed/);
    assert.equal(connection.at(-1), 'INTERRUPTED');
    for (const label of ['Continue Astra', 'Resume Astra', 'Run next step', 'Take over manually']) { assert.equal(button(label).props.disabled, true); button(label).props.onClick(); }
    assert.equal(actions.length, 0); assert.equal(button('Pause Astra').props.disabled, false); button('Pause Astra').props.onClick(); assert.deepEqual(actions, ['PAUSE']);
    assert.equal(f.nodes(node => node.props['aria-label'] === 'Refresh recorded activity')[0].props.disabled, false);
    assert.equal([...f.timers.values()].some(timer => timer.ms === 8000), true, 'Failed reads still reconnect automatically.');
    fail = false; stopped = true; await poll();
    assert.match(f.text(), /Astra needs attention/); assert.match(f.text(), /could not confirm its saved progress/);
    assert.doesNotMatch(f.text(), /Astra is working|Reconnecting to Astra|ASTRA_DATABASE_TRANSACTION_FAILED/);
    assert.equal(connection.at(-1), 'CONNECTED'); assert.equal(button('Take over manually').props.disabled, false);
    assert.equal(button('Resume Astra').props.disabled, true); assert.match(f.text(), /Both original photographs inspected/); f.dispose();
});

test('pausing activity updates does not claim to pause Astra and suppresses stale start controls', async () => {
    let fail = false;
    const initial = card(), connection = [], f = harness(activityCode, { card: initial, disabled: false, onObservedCard() {}, onConnectionChange: value => connection.push(value), onControl() {} }, {
        async workspaceRequest(path) { if (fail) throw Error('Synthetic interrupted update'); return path.endsWith('/activity') ? { control: { state: 'RUNNING', mode: 'CONTINUOUS', pending: 1, canPause: true, canResume: true }, activity: [] } : { card: initial }; }
    });
    await f.settle(); fail = true; f.nodes(node => node.props['aria-label'] === 'Keep activity updated')[0].props.onChange({ target: { checked: false } }); f.render(); await f.settle();
    assert.match(f.text(), /Activity updates paused/); assert.match(f.text(), /current status is unconfirmed/);
    assert.doesNotMatch(f.text(), /Astra is working|Astra is paused|One action is in progress|Reconnecting|retry automatically/);
    assert.equal(connection.at(-1), 'PAUSED'); assert.equal(f.timers.size, 0);
    assert.equal(f.nodes(node => node.type === 'button' && text(node).includes('Resume Astra'))[0].props.disabled, true);
    fail = false; f.nodes(node => node.props['aria-label'] === 'Keep activity updated')[0].props.onChange({ target: { checked: true } }); f.render(); f.render();
    assert.doesNotMatch(f.text(), /Astra is working/); assert.equal(connection.at(-1), 'CONNECTING'); await f.settle();
    assert.match(f.text(), /Astra is working/); assert.equal(connection.at(-1), 'CONNECTED'); f.dispose();
});

test('unconfirmed-request recovery requires reviewing the recorded charge and explicitly authorizing one step', async () => {
    const initial = card(), actions = [], control = { state: 'NEEDS_ATTENTION', pending: 1, mode: 'CONTINUOUS',
        canAbandon: true, attemptRecovery: { attemptId: 'original-attempt', reviewHash: 'a'.repeat(64),
            reservedMicroUsd: '23650000', dispatchedAt: at } };
    const f = harness(activityCode, { card: initial, disabled: false, onObservedCard() {},
        onControl: async (...args) => { actions.push(args); return { card: initial }; } }, {
        async workspaceRequest(path) { return path.endsWith('/activity') ? { control, activity: [] } : { card: initial }; }
    });
    await f.settle(); assert.equal(actions.length, 0);
    const review = f.nodes(node => node.type === 'button' && text(node).includes('Review recovery'))[0]; review.props.onClick(); f.render();
    assert.equal(actions.length, 0); assert.match(f.text(), /\$23\.65 remains recorded/); assert.match(f.text(), /one new Astra step/);
    assert.match(f.text(), /Astra will then pause/);
    const note = f.nodes(node => node.type === 'textarea')[0]; note.props.onChange({ target: { value: 'Keep the unconfirmed request; continue once.' } }); f.render();
    const confirm = f.nodes(node => node.type === 'button' && text(node) === 'Continue one step')[0];
    assert.equal(confirm.props.disabled, false); await confirm.props.onClick(); f.render();
    assert.equal(actions.length, 1); assert.equal(actions[0][0], 'ABANDON_AND_STEP');
    assert.equal(actions[0][1].reviewHash, control.attemptRecovery.reviewHash);
    assert.equal(actions[0][1].reason, 'Keep the unconfirmed request; continue once.');
    f.dispose();
});

test('recovery review cannot silently adopt a changed card or dispatch when cancelled or unavailable', async () => {
    const initial = card(), actions = [], control = { state: 'NEEDS_ATTENTION', pending: 1, mode: 'CONTINUOUS',
        canAbandon: true, attemptRecovery: { attemptId: 'original-attempt', reviewHash: 'a'.repeat(64),
            reservedMicroUsd: '23650000', dispatchedAt: at } };
    const f = harness(activityCode, { card: initial, disabled: false, onObservedCard() {}, onControl: action => actions.push(action) }, {
        async workspaceRequest(path) { return path.endsWith('/activity') ? { control, activity: [] } : { card: initial }; }
    });
    await f.settle();
    f.nodes(node => node.type === 'button' && text(node).includes('Review recovery'))[0].props.onClick(); f.render();
    f.props.card = { ...initial, revision: initial.revision + 1 }; f.render();
    assert.match(f.text(), /recovery details changed/);
    const confirm = f.nodes(node => node.type === 'button' && text(node) === 'Continue one step')[0];
    assert.equal(confirm.props.disabled, true); await confirm.props.onClick(); assert.equal(actions.length, 0);
    f.nodes(node => node.type === 'button' && text(node) === 'Keep paused')[0].props.onClick(); f.render();
    assert.equal(actions.length, 0); assert.equal(f.nodes(node => node.type === 'textarea').length, 0);
    control.canAbandon = false; f.render();
    assert.equal(f.nodes(node => node.type === 'button' && text(node).includes('Review recovery')).length, 0);
    f.dispose();
});

test('Astra workbench exposes actual source evidence and marks attention without inventing saved identity or approval', () => {
    const initial = { ...card(), observedOperator: { state: 'NEEDS_ATTENTION' } }, f = harness(viewCode, { card: initial, stage: 'IDENTITY' });
    assert.match(f.text(), /Needs attention/); assert.match(f.text(), /Card details will appear here once they are saved/);
    assert.match(f.text(), /Human reviewer/); assert.doesNotMatch(f.text(), /Human reviewed|Human approved|Astra at work/);
    assert.equal(f.nodes(node => node.type === 'photo')[0].props.side, 'FRONT');
    const back = f.nodes(node => node.type === 'button' && text(node) === 'Back')[0]; back.props.onClick(); f.render();
    assert.equal(f.nodes(node => node.type === 'photo')[0].props.side, 'BACK');
    assert.equal(f.nodes(node => node.type === 'svg' && node.props['aria-label'] === 'Saved physical card boundary').length, 0);
    f.props.stage = 'PREPARATION'; f.props.card.workspace.preparation = { BACK: { corners: [{ x: .1, y: .1 }, { x: .9, y: .1 }, { x: .9, y: .9 }, { x: .1, y: .9 }] } }; f.render();
    assert.equal(f.nodes(node => node.type === 'svg' && node.props['aria-label'] === 'Saved physical card boundary').length, 1);
    f.props.card.workspace.preparation.BACK.corners[0].x = 2; f.render(); assert.equal(f.nodes(node => node.type === 'svg' && node.props['aria-label'] === 'Saved physical card boundary').length, 0); f.dispose();
});

test('workbench distinguishes unconfirmed progress from the last saved running or failed state', () => {
    const f = harness(viewCode, { card: card(), stage: 'IDENTITY', activityConnection: 'INTERRUPTED' });
    assert.match(f.text(), /Progress unconfirmed/); assert.doesNotMatch(f.text(), /Astra at work/);
    f.props.activityConnection = 'PAUSED'; f.render(); assert.match(f.text(), /Activity updates paused/); assert.doesNotMatch(f.text(), /Astra at work/);
    f.props.activityConnection = 'CONNECTED'; f.props.card.observedOperator.state = 'NEEDS_ATTENTION'; f.render();
    assert.match(f.text(), /Needs attention/); assert.doesNotMatch(f.text(), /Astra at work/);
    assert.equal(f.nodes(node => node.type === 'photo').length, 1, 'Original photograph remains visible.'); f.dispose();
});

test('activity connection status also keeps the workspace claim bar and workbench honest', () => {
    const initial = card(), f = harness(workspaceCode, { initial, staff: { id: 'reviewer', role: 'REVIEWER' }, csrf: 'test-csrf' });
    const activity = () => f.nodes(node => node.type === 'WorkspaceActivity')[0];
    const workbench = () => f.nodes(node => node.type === 'AstraStageView')[0];
    assert.match(f.text(), /Checking Astra’s saved progress/); assert.doesNotMatch(f.text(), /Astra is operating this card/);
    activity().props.onConnectionChange('CONNECTED'); f.render(); assert.match(f.text(), /Astra is operating this card/);
    activity().props.onConnectionChange('INTERRUPTED'); f.render(); assert.match(f.text(), /Astra’s current progress is unconfirmed/);
    assert.doesNotMatch(f.text(), /Astra is operating this card/); assert.equal(workbench().props.activityConnection, 'INTERRUPTED');
    activity().props.onObservedCard({ ...initial, observedOperator: { state: 'NEEDS_ATTENTION', failureCode: 'ASTRA_DATABASE_TRANSACTION_FAILED' } });
    activity().props.onConnectionChange('CONNECTED'); f.render(); assert.match(f.text(), /Astra needs attention/);
    assert.doesNotMatch(f.text(), /Astra is operating this card/); assert.equal(workbench().props.card.sides.length, 2); f.dispose();
});
