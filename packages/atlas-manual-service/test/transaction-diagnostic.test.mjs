import test from 'node:test';
import assert from 'node:assert/strict';
import { safeTransactionDiagnostic } from '../src/contract.mjs';

const expired = (timeout = '5000', elapsed = '5212') => `Transaction already closed: A query cannot be executed on an expired transaction. The timeout for this transaction was ${timeout} ms, however ${elapsed} ms passed since the start of the transaction.`;
const failure = (message, meta) => Object.assign(new Error(message), { code: 'P2028', meta });

test('distinguishes transaction start wait from active expiration using actual Prisma phrases', () => {
  for (const wrap of [text => failure(text), text => failure('Private query details', { error: text })]) {
    assert.deepEqual(safeTransactionDiagnostic(wrap('Unable to start a transaction in the given time.')), { transactionFailureCategory: 'START_WAIT' });
    assert.deepEqual(safeTransactionDiagnostic(wrap(expired())), { transactionFailureCategory: 'ACTIVE_TIMEOUT', transactionTimeoutMs: 5000, transactionElapsedMs: 5212 });
    assert.deepEqual(safeTransactionDiagnostic(wrap('Transaction already closed: A query cannot be executed on a committed transaction.')), { transactionFailureCategory: 'CLOSED' });
  }
});

test('unknown transaction failures stay unknown and unrelated error codes produce no fields', () => {
  assert.deepEqual(safeTransactionDiagnostic(failure('Unknown transaction API failure')), { transactionFailureCategory: 'UNKNOWN' });
  assert.deepEqual(safeTransactionDiagnostic(failure('SQL text merely mentions expired transaction')), { transactionFailureCategory: 'UNKNOWN' });
  assert.deepEqual(safeTransactionDiagnostic({ code: 'P2024', message: expired() }), {});
  assert.deepEqual(safeTransactionDiagnostic(null), {});
  assert.deepEqual(safeTransactionDiagnostic({ code: 'P2028', meta: { error: {} }, message: 5212 }), { transactionFailureCategory: 'UNKNOWN' });
});

test('only bounded integer durations are retained, never inferred from configured deadlines', () => {
  for (const [timeout, elapsed] of [['-1', '5000'], ['5000', '1.5'], ['1e3', '5000'], ['123456789', '5000']]) {
    assert.deepEqual(safeTransactionDiagnostic(failure(expired(timeout, elapsed))), { transactionFailureCategory: 'ACTIVE_TIMEOUT' });
  }
  assert.deepEqual(safeTransactionDiagnostic(failure(expired('86400001', '99999999'))), { transactionFailureCategory: 'ACTIVE_TIMEOUT' });
  assert.deepEqual(safeTransactionDiagnostic(failure(expired('0', '86400000'))), { transactionFailureCategory: 'ACTIVE_TIMEOUT', transactionTimeoutMs: 0, transactionElapsedMs: 86400000 });
  assert.deepEqual(safeTransactionDiagnostic(failure('Transaction already closed: A query cannot be executed on an expired transaction.')), { transactionFailureCategory: 'ACTIVE_TIMEOUT' });
});

test('safe worker diagnostics can cross another logger without admitting extra fields or coercing numbers', () => {
  const safe = safeTransactionDiagnostic(failure(expired()));
  const copied = { code: 'P2028', ...safe, databaseUrl: 'postgresql://secret', meta: { token: 'secret' } };
  assert.deepEqual(safeTransactionDiagnostic(copied), safe);
  assert.deepEqual(safeTransactionDiagnostic({ code: 'P2028', transactionFailureCategory: 'secret', transactionTimeoutMs: 10 }), { transactionFailureCategory: 'UNKNOWN' });
  assert.deepEqual(safeTransactionDiagnostic({ code: 'P2028', transactionFailureCategory: 'ACTIVE_TIMEOUT', transactionTimeoutMs: '5000', transactionElapsedMs: Infinity }), { transactionFailureCategory: 'ACTIVE_TIMEOUT' });
});

test('raw credentials, SQL, messages, oversized text and hostile getters never enter diagnostics', () => {
  const secret = 'postgresql://owner:private-password@db/private?token=secret';
  const error = failure(`SELECT '${secret}'\n${expired()}`, { error: expired(), url: secret });
  error.stack = secret;
  assert.deepEqual(safeTransactionDiagnostic(error), { transactionFailureCategory: 'ACTIVE_TIMEOUT', transactionTimeoutMs: 5000, transactionElapsedMs: 5212 });
  assert(!JSON.stringify(safeTransactionDiagnostic(error)).includes(secret));
  assert.deepEqual(safeTransactionDiagnostic(failure('x'.repeat(8193) + expired())), { transactionFailureCategory: 'UNKNOWN' });
  assert.doesNotThrow(() => safeTransactionDiagnostic({ get code() { throw Error(secret); } }));
  assert.deepEqual(safeTransactionDiagnostic({ code: 'P2028', get meta() { throw Error(secret); } }), {});
});
