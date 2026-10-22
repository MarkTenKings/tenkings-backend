import test from 'node:test';
import assert from 'node:assert/strict';
import { safeSum, integerCents, postJournal, posting, assertJournal, accountBalance } from '../src/ledger.mjs';
import { openLocalStore } from '../src/store.mjs';

test('unsafe cents, cross-book imbalance and historical rewriting are refused', () => {
  assert.throws(() => integerCents(1.01), { code: 'INVALID_CENTS' });
  assert.throws(() => safeSum(Number.MAX_SAFE_INTEGER, 1), { code: 'CENTS_OVERFLOW' });
  const store = openLocalStore({ filename: ':memory:', environment: 'SYNTHETIC_LOCAL', clock: () => 100 });
  const input = { id: 'journal_one', intentId: 'intent_one', kind: 'PAYMENT', evidenceHash: 'a'.repeat(64), lines: [posting('platform:p', 'cash', 100), posting('platform:p', 'seller', -100)] };
  store.transaction(tx => postJournal(tx, input));
  store.transaction(tx => postJournal(tx, input));
  assert.equal(store.read(state => state.journals.length), 1);
  assert.equal(store.read(state => accountBalance(state, 'platform:p', 'cash')), 100);
  assert.throws(() => store.transaction(tx => postJournal(tx, { ...input, id: 'bad', lines: [posting('platform:p', 'cash', 100), posting('connected:s', 'seller', -100)] })), { code: 'UNBALANCED_JOURNAL' });
  assert.throws(() => store.transaction(tx => { tx.state.journals[0].lines[0].cents = 99; return true; }), { code: 'JOURNAL_MUTATION' });
  const tampered = store.read(state => state.journals); tampered[0].lines[0].cents = 99;
  assert.throws(() => assertJournal(tampered), { code: 'JOURNAL_CORRUPT' });
  store.close();
});

test('cumulative account cents cannot overflow even when each balanced journal is individually safe', () => {
  const store = openLocalStore({ filename: ':memory:', environment: 'SYNTHETIC_LOCAL', clock: () => 100 });
  const amount = Number.MAX_SAFE_INTEGER;
  const input = { id: 'large_one', intentId: 'intent_one', kind: 'PAYMENT', evidenceHash: 'b'.repeat(64), lines: [posting('platform:p', 'cash', amount), posting('platform:p', 'seller', -amount)] };
  store.transaction(tx => postJournal(tx, input));
  assert.throws(() => store.transaction(tx => postJournal(tx, { ...input, id: 'large_two', lines: [posting('platform:p', 'cash', 1), posting('platform:p', 'seller', -1)] })), { code: 'CENTS_OVERFLOW' });
  assert.equal(store.read(state => state.journals.length), 1); store.close();
});
