import test from 'node:test';
import assert from 'node:assert/strict';
import { captureCounts, connectCapturedDraft } from '../lib/capture-state.mjs';
const verified = id => ({ id, identity: { title: id }, uploads: { FRONT: { state: 'VERIFIED' }, BACK: { state: 'VERIFIED' } } });

test('new-device resumed draft counts every unsent local pair and blocks review until that exact card is verified', () => {
  const local = { pairs: [{ cardId: 'new-card' }] }, cards = [verified('remote-one'), verified('remote-two')];
  assert.deepEqual(captureCounts({ cards }, local), { count: 3, uploadedCount: 2, waitingCount: 1, ready: false });
  cards.push({ id: 'new-card', identity: null, uploads: { FRONT: { state: 'VERIFIED' }, BACK: { state: 'PLANNED' } } });
  assert.deepEqual(captureCounts({ cards }, local), { count: 3, uploadedCount: 2, waitingCount: 1, ready: false });
  cards[2] = verified('new-card');
  assert.deepEqual(captureCounts({ cards }, local), { count: 3, uploadedCount: 3, waitingCount: 0, ready: true });
});
test('local/server copies of the same immutable card count once; empty and unidentified rosters cannot review', () => {
  assert.deepEqual(captureCounts({ cards: [verified('same')] }, { pairs: [{ cardId: 'same' }] }), { count: 1, uploadedCount: 1, waitingCount: 0, ready: true });
  assert.equal(captureCounts(null, null).ready, false);
  assert.equal(captureCounts({ cards: [{ ...verified('unknown'), identity: null }] }, null).ready, false);
});
test('a saved remote draft without a local create request is read, never recreated', async () => {
  const calls = [], draft = { id: 'existing-draft', state: 'REVIEW' };
  const buffer = { snapshot: async () => ({ draftId: draft.id, createRequest: null }), creation: async () => assert.fail('creation forbidden'), attachDraft: async () => assert.fail('replacement forbidden') };
  const result = await connectCapturedDraft({ buffer, request: async (...args) => { calls.push(args); return { draft }; } });
  assert.equal(result, draft); assert.deepEqual(calls, [[`/intake/drafts/${draft.id}`]]);
});
test('failed or mismatched existing-draft reads never fall through to creation', async () => {
  const buffer = { snapshot: async () => ({ draftId: 'saved-draft' }), creation: async () => assert.fail('creation forbidden') };
  await assert.rejects(connectCapturedDraft({ buffer, request: async () => { throw Error('network interruption'); } }), /network interruption/);
  await assert.rejects(connectCapturedDraft({ buffer, request: async () => ({ draft: { id: 'other-draft' } }) }), /could not be confirmed/);
});
test('a fresh capture destination uses the retained creation request and attaches only the acknowledged draft', async () => {
  const events = [], creation = { requestId: 'retained-request', intakeMethod: 'MAIL_IN', kioskId: null }, draft = { id: 'new-draft' };
  const buffer = { snapshot: async () => ({ draftId: null }), creation: async () => creation, attachDraft: async id => events.push(['attach', id]) };
  assert.equal(await connectCapturedDraft({ buffer, request: async (...args) => { events.push(['request', ...args]); return { draft }; } }), draft);
  assert.deepEqual(events, [['request', '/intake/drafts', { body: creation }], ['attach', draft.id]]);
});
