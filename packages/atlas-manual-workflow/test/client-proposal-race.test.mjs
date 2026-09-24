import test from 'node:test';
import assert from 'node:assert/strict';
import { createManualClient } from '../src/client.mjs';

const key = 'atlas-manual-pending:v1:staff:card';
const reply = (value, status = 200) => ({ ok: status < 400, status, json: async () => value });
const storage = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; };
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const input = action => ({ side: 'FRONT', base: { cardId: 'card', findingRevision: 3 }, analysisId: 'analysis', proposalId: 'proposal', action,
  ...(action === 'TRACE_SAVE' ? { trace: { id: 'trace', traceWire: { fixture: true } } } : {}) });

for (const waitAt of ['initial view', 'proposal-trace']) test(`a different uncertain save admitted during ${waitAt} cannot be overwritten by proposal review`, async () => {
  const store = storage(), started = gate(), release = gate(); let actionPosts = 0;
  const client = createManualClient({ cardId: 'card', staffId: 'staff', csrf: 'csrf', storage: store, fetchImpl: async (url, options) => {
    if (url.endsWith('/view')) { if (waitAt === 'initial view') { started.resolve(); await release.promise; } return reply({ card: { revision: 3 } }); }
    if (url.endsWith('/proposal-trace')) { started.resolve(); await release.promise;
      return reply({ type: 'ASTRA_PROPOSAL_REVIEW', side: 'FRONT', base: {}, analysisId: 'analysis', proposalId: 'proposal', action: 'TRACE_SAVE', traceRef: { key: 'exact' }, traceSourceHash: 'hash' }); }
    if (options.method === 'POST') actionPosts++; throw Error('unexpected action request');
  } });
  if (waitAt === 'proposal-trace') await client.load();
  const saving = client.reviewProposal(input(waitAt === 'proposal-trace' ? 'TRACE_SAVE' : 'ACCEPT'));
  const denied = assert.rejects(saving, /pending save/); await started.promise;
  const newer = JSON.stringify({ actionId: 'new-uncertain', expectedRevision: 3, action: { type: 'INSPECT_SIDE', side: 'BACK' } });
  store.setItem(key, newer); release.resolve(); await denied;
  assert.equal(actionPosts, 0); assert.equal(store.getItem(key), newer);
});

test('a lost proposal action reply reconciles one journaled action without rerunning trace staging or choosing a new action id', async () => {
  const store = storage(), posts = [], stage = [];
  const client = createManualClient({ cardId: 'card', staffId: 'staff', csrf: 'csrf', storage: store, fetchImpl: async (url, options) => {
    if (url.endsWith('/view')) return reply({ card: { revision: posts.length ? 4 : 3 } });
    if (url.endsWith('/proposal-trace')) { stage.push(JSON.parse(options.body));
      return reply({ type: 'ASTRA_PROPOSAL_REVIEW', side: 'FRONT', base: {}, analysisId: 'analysis', proposalId: 'proposal', action: 'TRACE_SAVE', traceRef: { key: 'exact' }, traceSourceHash: 'hash' }); }
    if (url.endsWith('/actions')) { posts.push(options.body); throw Error('synthetic lost committed reply'); }
    assert.equal(url.endsWith(`/actions/${JSON.parse(posts[0]).actionId}`), true); return reply({ state: 'COMMITTED' });
  } });
  await client.reviewProposal(input('TRACE_SAVE'));
  assert.equal(stage.length, 1); assert.equal(posts.length, 1); assert.equal(store.getItem(key), null);
  const command = JSON.parse(posts[0]); assert.equal(command.expectedRevision, 3); assert.equal(command.action.trace, undefined);
  assert.equal(command.action.traceRef.key, 'exact'); assert.equal(command.action.action, 'TRACE_SAVE');
});

test('proposal acceptance strips browser actor assertions and leaves measurement as a separate later action', async () => {
  const store = storage(), posts = [];
  const client = createManualClient({ cardId: 'card', staffId: 'staff', csrf: 'csrf', storage: store, fetchImpl: async (url, options) => {
    if (url.endsWith('/view')) return reply({ card: { revision: 3 + posts.length } });
    posts.push(JSON.parse(options.body)); return reply({ committed: true });
  } });
  await client.reviewProposal({ ...input('ACCEPT'), actor: 'HUMAN', measurement: { areaMm2: 99 } });
  assert.equal(posts.length, 1); assert.equal(posts[0].action.type, 'ASTRA_PROPOSAL_REVIEW');
  assert.equal(posts[0].action.actor, undefined); assert.equal(posts[0].action.measurement, undefined);
  assert.equal(posts.some(command => command.action.type === 'MEASURE_SIDE'), false);
});
