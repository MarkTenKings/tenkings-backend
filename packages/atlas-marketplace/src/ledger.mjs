import { createHash } from 'node:crypto';

export function financeAssert(value, code, message = code) {
  if (!value) { const error = new Error(message); error.code = code; throw error; }
}
export function integerCents(value, { positive = false } = {}) {
  financeAssert(Number.isSafeInteger(value) && value >= (positive ? 1 : 0), 'INVALID_CENTS');
  return value;
}
export function safeSum(...values) {
  const total = values.reduce((sum, value) => {
    financeAssert(Number.isSafeInteger(value), 'INVALID_CENTS');
    return sum + BigInt(value);
  }, 0n);
  financeAssert(total >= -BigInt(Number.MAX_SAFE_INTEGER) && total <= BigInt(Number.MAX_SAFE_INTEGER), 'CENTS_OVERFLOW');
  return Number(total);
}
export function stableJSON(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJSON).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJSON(value[key])}`).join(',')}}`;
}
export function digest(value) { return createHash('sha256').update(stableJSON(value)).digest('hex'); }
export function copy(value) { return structuredClone(value); }
export function identifier(value) { financeAssert(typeof value === 'string' && /^[A-Za-z0-9_:.\/-]{1,220}$/.test(value), 'INVALID_FINANCE_ID'); return value; }

// Signed postings: positive is debit, negative is credit. Each book balances independently.
export function assertJournal(journal) {
  let previousHash = null;
  const ids = new Set();
  for (let index = 0; index < journal.length; index++) {
    const entry = journal[index];
    financeAssert(entry.sequence === index + 1 && entry.previousHash === previousHash && !ids.has(entry.id), 'JOURNAL_CORRUPT');
    const { hash, ...body } = entry;
    financeAssert(hash === digest(body), 'JOURNAL_CORRUPT');
    validateLines(entry.lines);
    previousHash = hash;
    ids.add(entry.id);
  }
  return true;
}
function validateLines(lines) {
  financeAssert(Array.isArray(lines) && lines.length >= 2, 'UNBALANCED_JOURNAL');
  const totals = new Map();
  for (const line of lines) {
    identifier(line.book); identifier(line.account);
    financeAssert(line.currency === 'USD' && Number.isSafeInteger(line.cents) && line.cents !== 0, 'INVALID_POSTING');
    const key = `${line.book}:USD`;
    totals.set(key, (totals.get(key) ?? 0n) + BigInt(line.cents));
  }
  financeAssert([...totals.values()].every(total => total === 0n), 'UNBALANCED_JOURNAL');
}
export function postJournal(tx, { id, kind, intentId, evidenceHash, lines }) {
  const journal = tx.state.journals ??= [];
  assertJournal(journal);
  identifier(id); identifier(kind); identifier(intentId);
  financeAssert(typeof evidenceHash === 'string' && /^[a-f0-9]{64}$/.test(evidenceHash), 'INVALID_EVIDENCE_HASH');
  lines = lines.filter(line => line.cents !== 0);
  validateLines(lines);
  const content = { id, kind, intentId, evidenceHash, lines };
  const old = journal.find(entry => entry.id === id);
  if (old) {
    financeAssert(digest(content) === digest(Object.fromEntries(Object.keys(content).map(key => [key, old[key]]))), 'JOURNAL_ID_CONFLICT');
    return copy(old);
  }
  const running = new Map();
  for (const entry of [...journal, { lines }]) for (const line of entry.lines) {
    const key = `${line.book}\0${line.account}`;
    const next = (running.get(key) ?? 0n) + BigInt(line.cents);
    financeAssert(next >= -BigInt(Number.MAX_SAFE_INTEGER) && next <= BigInt(Number.MAX_SAFE_INTEGER), 'CENTS_OVERFLOW');
    running.set(key, next);
  }
  const body = { ...copy(content), sequence: journal.length + 1, previousHash: journal.at(-1)?.hash ?? null, recordedAt: tx.now };
  const entry = { ...body, hash: digest(body) };
  journal.push(entry);
  return copy(entry);
}
export function accountBalance(state, book, account) {
  const journal = state.journals ?? [];
  assertJournal(journal);
  let total = 0n;
  for (const entry of journal) for (const line of entry.lines) if (line.book === book && line.account === account) total += BigInt(line.cents);
  financeAssert(total >= -BigInt(Number.MAX_SAFE_INTEGER) && total <= BigInt(Number.MAX_SAFE_INTEGER), 'CENTS_OVERFLOW');
  return Number(total);
}
export function posting(book, account, cents) { return { book, account, currency: 'USD', cents }; }
