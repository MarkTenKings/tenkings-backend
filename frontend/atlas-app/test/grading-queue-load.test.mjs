import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url), babel = require('next/dist/compiled/babel/core');
const compiled = babel.transformSync(readFileSync(new URL('../lib/useGradingQueue.js', import.meta.url), 'utf8'), {
    filename: 'useGradingQueue.js', presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]], babelrc: false, configFile: false
}).code;
const session = { staff: { id: 'reviewer' }, csrf: 'a'.repeat(64) };
const error = code => Object.assign(new Error(code), { code });
const flush = () => new Promise(resolve => setImmediate(resolve));

function harness() {
    const slots = [], effects = [], listeners = new Map(), timers = new Map(), exports = {}; let cursor = 0, timerId = 0;
    const page = { visibilityState: 'visible', addEventListener(name, callback) { listeners.set(name, callback); }, removeEventListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name); } };
    const f = { staffId: 'reviewer', calls: [], maximumPending: 0, timers };
    const react = {
        useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
            return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }]; },
        useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
        useEffect(effect, deps) { const index = cursor++, old = slots[index];
            if (!old || deps.some((value, i) => value !== old.deps[i])) {
                const slot = { deps, cleanup: null }; slots[index] = slot;
                effects.push(() => { old?.cleanup?.(); slot.cleanup = effect(); });
            }
        }
    };
    vm.runInNewContext(compiled, { exports, AbortController, document: page,
        setTimeout(callback, milliseconds) { const id = ++timerId; timers.set(id, { callback, milliseconds }); return id; }, clearTimeout(id) { timers.delete(id); }, window: {
        addEventListener(name, callback) { listeners.set(name, callback); },
        removeEventListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name); }
    }, require(name) {
        if (name === 'react') return react;
        if (name === './client') return { api: (path, options) => new Promise((resolve, reject) => {
            const call = { path, options, pending: true,
                resolve(value) { call.pending = false; resolve(value); }, reject(value) { call.pending = false; reject(value); } };
            f.calls.push(call);
            f.maximumPending = Math.max(f.maximumPending, f.calls.filter(call => call.pending && !call.options.signal.aborted).length);
            // Deliberately ignore abort here: a late reply must still be ignored
            // by the hook, even if the underlying transport cannot stop it.
        }) };
        return require(name.startsWith('@babel/runtime/') ? `next/dist/compiled/${name}` : name);
    } });
    f.render = () => { cursor = 0; f.value = exports.useGradingQueue(f.staffId); for (const effect of effects.splice(0)) effect(); return f.value; };
    f.settle = async () => { await flush(); f.render(); f.render(); };
    f.resolve = async (index, value) => { f.calls[index].resolve(value); await f.settle(); };
    f.reject = async (index, value) => { f.calls[index].reject(value); await f.settle(); };
    f.event = name => { listeners.get(name)?.({ persisted: true }); f.render(); f.render(); };
    f.tick = () => { const [id, timer] = timers.entries().next().value ?? []; assert.ok(timer, 'A visible-page refresh is scheduled'); timers.delete(id); timer.callback(); f.render(); f.render(); };
    f.visibility = value => { page.visibilityState = value; f.event('visibilitychange'); };
    f.dispose = () => { for (const slot of slots) slot?.cleanup?.(); assert.equal(listeners.size, 0); assert.equal(timers.size, 0); };
    f.paths = () => f.calls.map(call => call.path);
    f.render(); f.render(); return f;
}

test('dashboard shows Waiting after one fresh session and workspace read while assigned reports remain stalled', async () => {
    const f = harness();
    assert.deepEqual(f.paths(), ['session']);
    await f.resolve(0, session); assert.deepEqual(f.paths(), ['session', 'workspace']);
    await f.resolve(1, { cards: [{ id: 'waiting-card', state: 'WAITING' }], readiness: {} });
    assert.deepEqual(f.paths(), ['session', 'workspace', 'cards']);
    await f.settle();
    assert.equal(f.calls[2].pending, true); assert.equal(f.value.assigned.loading, true); assert.equal(f.value.assigned.data, null);
    assert.equal(f.value.resource.loading, false); assert.equal(f.value.resource.error, '');
    assert.equal(f.value.resource.data.cards[0].id, 'waiting-card');
    await f.resolve(2, { cards: [{ id: 'assigned-report' }] });
    assert.equal(f.value.assigned.data.cards[0].id, 'assigned-report');
    assert.equal(f.value.resource.data.cards[0].id, 'waiting-card');
    assert.equal(f.value.resource.session, session); assert.equal(f.value.assigned.session, session);
    assert.equal(f.maximumPending, 1); assert.equal(f.calls.length, 3); f.dispose();
});

test('a real report failure leaves Waiting visible; explicit retry refreshes only that list after new access', async () => {
    const f = harness(); await f.resolve(0, session);
    const workspace = { cards: [{ id: 'saved-waiting-card', state: 'WAITING' }] };
    await f.resolve(1, workspace); await f.reject(2, error('TEMPORARILY_UNAVAILABLE'));
    assert.match(f.value.assigned.error, /service is temporarily unavailable/);
    assert.equal(f.value.assigned.data, null); assert.equal(f.value.assigned.loading, false);
    assert.deepEqual(f.paths(), ['session', 'workspace', 'cards']);
    assert.equal(f.value.resource.data, workspace);
    await f.settle(); assert.equal(f.calls.length, 3, 'There is no automatic retry.');
    f.value.assigned.reload(); f.render(); f.render();
    assert.deepEqual(f.paths(), ['session', 'workspace', 'cards', 'session']);
    assert.equal(f.value.resource.data, workspace); assert.equal(f.value.assigned.loading, true);
    await f.resolve(3, session); assert.equal(f.calls[4].path, 'cards');
    await f.resolve(4, { cards: [] });
    assert.equal(f.value.assigned.error, ''); assert.equal(f.value.assigned.data.cards.length, 0);
    assert.equal(f.value.resource.data, workspace); assert.equal(f.calls.length, 5); assert.equal(f.maximumPending, 1); f.dispose();
});

test('session failures start no data reads, and expired access invalidates both lists during recovery', async () => {
    const f = harness(); await f.reject(0, error('TEMPORARILY_UNAVAILABLE'));
    assert.equal(f.calls.length, 1); assert.match(f.value.assigned.error, /temporarily unavailable/); assert.match(f.value.resource.error, /temporarily unavailable/);
    f.value.resource.reload(); f.render(); await f.resolve(1, session);
    assert.equal(f.calls[2].path, 'workspace'); await f.resolve(2, { cards: [{ id: 'waiting-card' }] });
    f.value.assigned.reload(); f.render(); await f.resolve(3, session);
    assert.equal(f.calls[4].path, 'cards'); await f.reject(4, error('SIGN_IN_REQUIRED'));
    assert.equal(f.calls.length, 5); assert.equal(f.value.assigned.signedOut, true); assert.equal(f.value.resource.signedOut, true);
    assert.equal(f.value.resource.data, null); assert.equal(f.value.resource.session, null); f.dispose();
    for (const staff of [null, { id: 'another-reviewer' }]) {
        const g = harness(); await g.resolve(0, { ...session, staff });
        assert.equal(g.calls.length, 1); assert.equal(g.value.assigned.signedOut, true); assert.equal(g.value.resource.signedOut, true); g.dispose();
    }
});

test('retry during a pending initial read restarts unfinished lists and ignores the cancelled late response', async () => {
    const f = harness(); await f.resolve(0, session); await f.reject(1, error('TEMPORARILY_UNAVAILABLE'));
    assert.equal(f.calls[2].path, 'cards');
    f.value.resource.reload(); assert.equal(f.calls[2].options.signal.aborted, true); f.render(); f.render();
    assert.equal(f.calls[3].path, 'session');
    await f.resolve(2, { cards: [{ id: 'late-stale-card' }] });
    assert.equal(f.value.assigned.data, null); assert.equal(f.calls.length, 4);
    await f.resolve(3, session); assert.equal(f.calls[4].path, 'workspace');
    await f.resolve(4, { cards: [{ id: 'current-card' }] });
    assert.equal(f.calls[5].path, 'cards'); await f.resolve(5, { cards: [] });
    assert.equal(f.value.resource.data.cards[0].id, 'current-card'); assert.equal(f.maximumPending, 1); f.dispose();
});

test('page lifecycle clears private data, aborts pending reads and performs fresh access after back-forward restoration', async () => {
    const f = harness(); await f.resolve(0, session); await f.resolve(1, { cards: [{ id: 'old-card' }] }); await f.resolve(2, { cards: [] });
    f.event('pagehide'); assert.equal(f.value.resource.data, null); assert.equal(f.value.assigned.data, null);
    assert.equal(f.calls[2].options.signal.aborted, true);
    f.event('pageshow'); assert.equal(f.calls[3].path, 'session'); assert.equal(f.calls.length, 4);
    await f.resolve(3, session); assert.equal(f.calls[4].path, 'workspace');
    f.dispose(); assert.equal(f.calls[4].options.signal.aborted, true);
    await f.resolve(4, { cards: [{ id: 'late-after-unmount' }] }); assert.equal(f.calls.length, 5);
});

test('malformed success cannot be mistaken for an empty report list; changed staff must recheck both lists', async () => {
    const f = harness(); await f.resolve(0, session); await f.resolve(1, { cards: [] }); await f.resolve(2, {});
    assert.equal(f.value.assigned.data, null); assert.match(f.value.assigned.error, /list could not be confirmed/);
    f.value.assigned.reload(); f.render(); await f.resolve(3, session); await f.resolve(4, { cards: [] });
    f.staffId = 'new-reviewer'; f.render(); f.render(); assert.equal(f.calls[5].path, 'session');
    await f.resolve(5, { ...session, staff: { id: 'new-reviewer' } }); assert.equal(f.calls[6].path, 'workspace');
    await f.resolve(6, { cards: [] });
    assert.equal(f.calls[7].path, 'cards'); await f.resolve(7, { cards: [] }); assert.equal(f.maximumPending, 1); f.dispose();
});

test('live queue refresh keeps cards and counts visible while all authenticated reads remain ordered', async () => {
    const f = harness(), workspace = { cards: [{ id: 'card', state: 'IN_PROGRESS' }] }, reports = { cards: [{ id: 'report', disposition: 'IN_REVIEW' }] };
    await f.resolve(0, session); await f.resolve(1, workspace); await f.resolve(2, reports);
    assert.equal(f.timers.size, 1); assert.equal([...f.timers.values()][0].milliseconds, 6000);
    f.tick(); assert.deepEqual(f.paths(), ['session', 'workspace', 'cards', 'session']);
    assert.equal(f.value.resource.data, workspace); assert.equal(f.value.resource.loading, false); assert.equal(f.value.resource.refreshing, true);
    assert.equal(f.value.assigned.data, reports); assert.equal(f.value.assigned.loading, false);
    await f.resolve(3, session); assert.equal(f.calls[4].path, 'workspace');
    await f.resolve(4, { cards: [{ id: 'card', state: 'HUMAN_REVIEW' }] });
    assert.equal(f.value.resource.data.cards[0].state, 'HUMAN_REVIEW'); assert.equal(f.value.assigned.data, reports);
    await f.resolve(5, { cards: [{ id: 'report', disposition: 'READY_FOR_HUMAN' }] });
    assert.equal(f.value.assigned.data.cards[0].disposition, 'READY_FOR_HUMAN'); assert.equal(f.value.resource.refreshing, false);
    assert.equal(f.maximumPending, 1); assert.equal(f.timers.size, 1); f.dispose();
});

test('live read failure retains and marks the saved snapshot, while expired access clears it and stops polling', async () => {
    const f = harness(), workspace = { cards: [{ id: 'card', state: 'WAITING' }] };
    await f.resolve(0, session); await f.resolve(1, workspace); await f.resolve(2, { cards: [] });
    f.tick(); await f.reject(3, error('TEMPORARILY_UNAVAILABLE'));
    assert.equal(f.value.resource.data, workspace); assert.equal(f.value.resource.loading, false); assert.equal(f.value.resource.error, '');
    assert.match(f.value.resource.refreshError, /temporarily unavailable/); assert.equal(f.value.resource.refreshing, false);
    f.tick(); await f.reject(4, error('SIGN_IN_REQUIRED'));
    assert.equal(f.value.resource.data, null); assert.equal(f.value.assigned.data, null);
    assert.equal(f.value.resource.signedOut, true); assert.equal(f.timers.size, 0); f.dispose();
});

test('hidden pages stop queue polling and ignore interrupted replies; returning refreshes after fresh access', async () => {
    const f = harness(), workspace = { cards: [{ id: 'saved-card' }] };
    await f.resolve(0, session); await f.resolve(1, workspace); await f.resolve(2, { cards: [] });
    f.visibility('hidden'); assert.equal(f.timers.size, 0); assert.equal(f.calls.length, 3); assert.equal(f.value.resource.data, workspace);
    f.visibility('visible'); assert.equal(f.calls[3].path, 'session'); await f.resolve(3, session);
    f.visibility('hidden'); assert.equal(f.calls[4].options.signal.aborted, true);
    await f.resolve(4, { cards: [{ id: 'ignored-reply' }] }); assert.equal(f.value.resource.data, workspace); assert.equal(f.calls.length, 5); assert.equal(f.timers.size, 0);
    f.visibility('visible'); assert.equal(f.calls[5].path, 'session'); await f.resolve(5, session); await f.resolve(6, { cards: [{ id: 'current-card' }] }); await f.resolve(7, { cards: [] });
    assert.equal(f.value.resource.data.cards[0].id, 'current-card'); assert.equal(f.maximumPending, 1); f.dispose();
});

test('claim suspension stops background reads until the queue explicitly resumes', async () => {
    const f = harness(); await f.resolve(0, session); await f.resolve(1, { cards: [] }); await f.resolve(2, { cards: [] });
    f.value.suspend(); assert.equal(f.timers.size, 0); f.visibility('hidden'); f.visibility('visible'); assert.equal(f.calls.length, 3);
    f.value.resume(); f.render(); assert.equal(f.calls[3].path, 'session'); f.dispose();
});
