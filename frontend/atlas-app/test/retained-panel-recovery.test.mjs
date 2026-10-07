import * as routes from '../lib/routes.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url), babel = require('next/dist/compiled/babel/core');
const files = ['MachinePreparation', 'OperationalRecovery', 'TrustedLearning'];
const compiled = Object.fromEntries(files.map(name => [name, babel.transformSync(readFileSync(new URL(`../components/${name}.jsx`, import.meta.url), 'utf8'), {
    filename: `${name}.jsx`, presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]], babelrc: false, configFile: false }).code]));
const sha = 'a'.repeat(64), fresh = 'b'.repeat(64), session = { staff: { id: 'human' }, csrf: fresh };
const error = (status, code) => Object.assign(new Error(code), { status, code });
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness(name, props = {}) {
    const slots = []; let cursor = 0, tree, guard; const modules = {};
    const react = { Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
        useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
        useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; }, useEffect() {} };
    const f = { props: { csrf: sha, disabled: false, ...props }, calls: [], respond: async () => { throw Error('Unexpected call'); } };
    function load(name) {
        if (modules[name]) return modules[name]; const exports = {}; modules[name] = exports;
        vm.runInNewContext(compiled[name], { exports, structuredClone, crypto: { randomUUID }, TextEncoder, TextDecoder, Uint8Array, AbortController, setTimeout, clearTimeout,
            fetch: async (url, options) => {
                const call = { path: url.replace('/admin/api/staff/', ''), body: options.body === undefined ? undefined : JSON.parse(options.body), csrf: options.headers['X-Atlas-Csrf'] };
                f.calls.push(call);
                try { return new Response(JSON.stringify(await f.respond(call)), { status: 200 }); }
                catch (e) { if (e.status) return new Response(JSON.stringify({ error: e.code }), { status: e.status }); throw e; }
            }, require(dep) {
                if (dep === 'react') return react;
                if (dep === '../lib/routes.mjs') return routes;
                if (dep === './MachinePreparation') return load('MachinePreparation');
                if (dep === '../lib/usePendingNavigation') return { usePendingNavigation: fn => { guard = fn; } };
                if (dep.endsWith('.module.css')) return {};
                return require(dep.startsWith('@babel/runtime/') ? `next/dist/compiled/${dep}` : dep);
            } }); return exports;
    }
    const component = name === 'hook' ? load('MachinePreparation').useRetainedOperation : load(name).default;
    const all = (node, predicate, out = []) => { if (Array.isArray(node)) node.forEach(n => all(n, predicate, out));
        else if (node && typeof node === 'object') { if (predicate(node)) out.push(node); all(node.props?.children, predicate, out); } return out; };
    const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : node ?? '';
    f.render = () => { cursor = 0; tree = component(f.props); f.value = tree; return tree; };
    f.find = (type, label) => { const result = all(tree, n => n.type === type && (label === undefined || text(n).includes(label)))[0]; assert.ok(result, `${type}: ${label}`); return result; };
    f.change = (label, value, checked = false) => { const field = f.find('label', label), input = all(field, n => ['input', 'textarea', 'select'].includes(n.type))[0]; input.props.onChange({ target: { value, checked } }); f.render(); };
    f.click = async label => { await f.find('button', label).props.onClick(); await flush(); f.render(); };
    f.pending = () => guard(); f.writes = () => f.calls.filter(c => c.body !== undefined);
    f.render(); return f;
}
test('actual retained hook retries through disabled props with fresh CSRF, preserves earlier uncertainty after sign-in/4xx, and blocks new work', async () => {
    const f = harness('hook'), body = { operationId: randomUUID(), pilotId: randomUUID(), reason: 'Exact reason' }; let accepted = 0;
    f.respond = async () => { throw Error('Lost reply'); };
    f.value.run({ path: 'operations/resolution/abandon', body, label: 'Recovery', accept: () => accepted++ }); await flush(); f.render();
    const original = structuredClone(f.writes()[0]); f.props.disabled = true; f.render();
    f.value.run({ path: 'wrong/new', body: {}, accept() {} }); assert.equal(f.calls.length, 1);
    f.respond = async () => ({ staff: null }); await f.value.retry(); f.render();
    assert.equal(f.writes().length, 1); assert.equal(f.pending(), true);
    f.respond = async call => { if (call.path === 'session') return session; throw error(403, 'FRESH_HUMAN_OPERATIONS_REQUIRED'); };
    await f.value.retry(); f.render(); assert.equal(f.pending(), true);
    f.respond = async call => call.path === 'session' ? session : { receipt: 'saved' };
    await f.value.retry(); f.render(); assert.equal(f.pending(), false); assert.equal(accepted, 1); assert.equal(f.value.locked, true);
    for (const write of f.writes()) { assert.equal(write.path, original.path); assert.deepEqual(write.body, original.body); }
    assert.equal(f.writes().at(-1).csrf, fresh);
});
test('machine admission actual component retains first postcommit 403/409 and recovers exact job while disabled', async () => {
    for (const [status, code] of [[403, 'FRESH_HUMAN_OPERATIONS_REQUIRED'], [409, 'MACHINE_ADMISSION_OUTCOME_UNCONFIRMED']]) {
        const pilotId = randomUUID(), specimenId = randomUUID(); let receipt;
        const f = harness('MachinePreparation', { pilotId, specimens: [{ specimenId, present: true, evidenceMatches: true, analysisRevision: 0 }], reason: 'Authorized specimen', authorizationEvidenceHash: sha });
        f.change('Uninitialized pilot specimen', specimenId); f.change('I checked this specimen', '', true);
        f.respond = async call => {
            receipt = { jobId: call.body.jobId, specimenId, pilotId, gradingOperationId: randomUUID(), runtimeHash: sha, state: 'QUEUED', deadlineAt: new Date(Date.now() + 60_000).toISOString(), operatorRun: null };
            throw error(status, code);
        };
        await f.click('Admit for supervised preparation'); assert.equal(f.pending(), true, code);
        const original = f.writes()[0].body; f.props.disabled = true; f.render();
        assert.equal(f.find('button', 'Retry exact admission').props.disabled, false); assert.equal(f.find('fieldset').props.disabled, true);
        assert.equal(f.find('a', 'Sign in in another tab').props.target, '_blank');
        await f.click('Admit for supervised preparation'); assert.equal(f.writes().length, 1);
        f.respond = async call => call.path === 'session' ? session : { receipt };
        await f.click('Retry exact admission'); assert.deepEqual(f.writes()[1].body, original); assert.equal(f.writes()[1].csrf, fresh); assert.equal(f.pending(), false);
    }
});
test('known initial machine shape/config refusals clear only before any uncertain attempt', async () => {
    for (const [status, code] of [[400, 'MACHINE_ADMISSION_REQUIRED'], [503, 'MACHINE_ADMISSION_NOT_CONFIGURED']]) {
        const f = harness('hook'), request = { path: 'operations/machine/admit', body: { jobId: randomUUID() }, preserveDispatchedUncertainty: true, accept() {} };
        f.respond = async () => { throw error(status, code); }; f.value.run(request); await flush(); f.render(); assert.equal(f.pending(), false);
        f.respond = async () => { throw Error('lost'); }; f.value.run(request); await flush(); f.render(); assert.equal(f.pending(), true);
        f.respond = async call => { if (call.path === 'session') return session; throw error(status, code); }; await f.value.retry(); f.render(); assert.equal(f.pending(), true);
    }
});
test('direct recovery initial definitive denial clears, but 408 and named unresolved outcomes remain uncertain', async () => {
    for (const [status, code, retained] of [[409, 'RESOLUTION_STATE_CHANGED', false], [408, 'REQUEST_TIMEOUT', true], [409, 'OUTCOME_UNCONFIRMED', true], [409, 'WORK_UNRESOLVED', true], [409, 'OUTCOME_UNKNOWN', true]]) {
        const f = harness('hook'); f.respond = async () => { throw error(status, code); };
        f.value.run({ path: 'operations/resolution/abandon', body: { operationId: randomUUID() }, accept() {} }); await flush(); f.render(); assert.equal(f.pending(), retained, code);
    }
});
test('actual operational recovery retains exact decision while disabled and keeps new recovery controls locked', async () => {
    const pilotId = randomUUID(), recordId = randomUUID(), specimenId = randomUUID(), holds = { scope: 'TARGET', accountingChanged: false, records: 1, reservedMicroUsd: '10', unsettledMicroUsd: '10', actualMicroUsd: '0' };
    const f = harness('OperationalRecovery', { pilotId, runs: [{ id: recordId, specimenId, state: 'UNKNOWN' }] });
    f.change('Record to inspect', `ASTRA:${recordId}`);
    f.respond = async () => ({ record: { pilotId, recordId, specimenId, kind: 'ASTRA', state: 'UNKNOWN', bindingHash: sha, holds } });
    await f.click('Inspect exact recovery record'); f.change('Reason for this recovery', 'Inspected original outcome'); f.change('Incident or outcome evidence checksum', sha); f.change('I inspected the external outcome', '', true);
    f.respond = async () => { throw Error('lost'); }; await f.click('Record human abandonment'); const original = f.writes().at(-1).body;
    f.props.disabled = true; f.render(); assert.equal(f.find('button', 'Retry exact recovery decision').props.disabled, false); assert.equal(f.find('fieldset').props.disabled, true);
    assert.equal(f.find('a', 'Sign in in another tab').props.target, '_blank');
    const before = f.calls.length; await f.click('Record human abandonment'); assert.equal(f.calls.length, before);
    f.respond = async call => call.path === 'session' ? session : { receipt: { pilotId, recordId, specimenId, kind: 'ASTRA', state: 'FAILED', holds, nextAction: 'HUMAN_INSPECTION_OR_RECAPTURE' } };
    await f.click('Retry exact recovery decision'); assert.deepEqual(f.writes().at(-1).body, original); assert.equal(f.writes().at(-1).csrf, fresh); assert.equal(f.pending(), false);
});
test('actual learning decision retries saved approval/subset despite disabled changed-approval props and failed fresh sign-in', async () => {
    const specimenId = randomUUID(), approvalId = randomUUID(), candidatesId = randomUUID();
    const f = harness('TrustedLearning', { specimenId, approvalId });
    f.respond = async () => ({ preview: { specimenId, approvalId, candidatesId, bundleHash: sha, selectedCandidateIds: [], applicationAvailable: false,
        expiresAt: new Date(Date.now() + 60_000).toISOString(), candidates: [{ candidateId: sha, findingId: 'finding', proposalOrder: 0, lessonOrder: 0, defectType: 'SCRATCH', polarity: 'POSITIVE', provenance: 'UNTOUCHED_ACCEPTED_POSITIVE', sourceViewId: 'ORIGINAL' }] } });
    await f.click('Load candidates from approved report'); f.change('SCRATCH', '', true); f.change('Approve · pending bank application', '', true); f.change('Reason for the selected candidates', 'Exact learning reason');
    f.respond = async () => { throw Error('lost decision'); }; await f.click('Record separate trusted-learning decision');
    const original = f.writes().at(-1).body; f.props.disabled = true; f.props.approvalId = randomUUID(); f.render();
    assert.equal(f.find('button', 'Retry exact trusted-learning decision').props.disabled, false);
    assert.equal(f.find('button', 'Load candidates').props.disabled, true);
    const before = f.calls.length; await f.click('Load candidates'); assert.equal(f.calls.length, before);
    f.respond = async () => ({ staff: null }); await f.click('Retry exact trusted-learning decision'); assert.equal(f.pending(), true); assert.equal(f.writes().length, 2);
    f.respond = async call => { if (call.path === 'session') return session;
        if (call.path.endsWith('/decisions')) throw error(403, 'FRESH_TRUSTED_LEARNING_REVIEWER_REQUIRED');
        throw Error('unexpected'); };
    await f.click('Retry exact trusted-learning decision'); assert.equal(f.pending(), true);
    f.respond = async call => call.path === 'session' ? session : call.path.endsWith('/decisions') ? { receipt: { decisionId: randomUUID(), specimenId, approvalId,
        bundleHash: sha, status: 'APPROVED_PENDING_APPLICATION', candidateIds: [sha], reason: original.reason, createdAt: new Date().toISOString(), applicationAvailable: false } }
        : { learning: { applicationAvailable: false, decisions: [], olderDecisionsAvailable: false } };
    await f.click('Retry exact trusted-learning decision'); assert.equal(f.pending(), false);
    for (const call of f.writes().filter(c => c.path.endsWith('/decisions'))) { assert.deepEqual(call.body, original); if (call !== f.writes()[1]) assert.equal(call.csrf, fresh); }
    assert.ok(f.find('p', 'No learning-bank application has occurred.'));
});
test('retained retry keeps its synchronous busy interlock while fresh-session read is unresolved', async () => {
    const f = harness('hook'); f.respond = async () => { throw Error('lost'); };
    f.value.run({ path: 'operations/resolution/abandon', body: { operationId: randomUUID() }, accept() {} }); await flush(); f.render();
    f.props.disabled = true; f.render(); let resolve;
    f.respond = () => new Promise(yes => { resolve = yes; });
    const first = f.value.retry(); await f.value.retry(); assert.equal(f.calls.length, 2);
    f.value.run({ path: 'new', body: {}, accept() {} }); assert.equal(f.calls.length, 2);
    resolve({ staff: null }); await first; f.render(); assert.equal(f.pending(), true); assert.equal(f.writes().length, 1);
});
