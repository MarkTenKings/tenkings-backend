import { openSync, closeSync, readFileSync, writeFileSync, fsyncSync, renameSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { hash, requireThat, immutable } from './strict.mjs';

// Local reference adapter, never a Production datastore. A leftover lock fails
// closed; it must only be removed after the owning process is proved stopped.
export class OfflineStore {
  constructor(path, initial) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    if (!existsSync(path)) {
      const fd = openSync(path, 'wx', 0o600);
      try { writeFileSync(fd, JSON.stringify({ data: initial, sha256: hash(initial) })); fsyncSync(fd); } finally { closeSync(fd); }
    }
    this.read();
  }
  read() {
    const envelope = JSON.parse(readFileSync(this.path, 'utf8'));
    requireThat(envelope.sha256 === hash(envelope.data), 'STORE_INTEGRITY');
    requireThat(envelope.data.mode === 'OFFLINE_REFERENCE', 'OFFLINE_ONLY');
    return immutable(envelope.data);
  }
  transaction(fn, failpoint = null) {
    let lock;
    try { lock = openSync(`${this.path}.lock`, 'wx', 0o600); } catch (error) { if (error.code === 'EEXIST') throw new Error('STORE_BUSY_OR_RECOVERY_REQUIRED'); throw error; }
    try {
      const current = this.read();
      const draft = structuredClone(current);
      const result = fn(draft);
      requireThat(!result || typeof result.then !== 'function', 'ASYNC_TRANSACTION_FORBIDDEN');
      draft.version = current.version + 1;
      const fd = openSync(`${this.path}.next`, 'w', 0o600);
      try { writeFileSync(fd, JSON.stringify({ data: draft, sha256: hash(draft) })); fsyncSync(fd); } finally { closeSync(fd); }
      if (failpoint === 'BEFORE_RENAME') throw new Error('SIMULATED_CRASH_BEFORE_COMMIT');
      renameSync(`${this.path}.next`, this.path);
      const dir = openSync(dirname(this.path), 'r');
      try { fsyncSync(dir); } finally { closeSync(dir); }
      if (failpoint === 'AFTER_RENAME') throw new Error('SIMULATED_CRASH_AFTER_COMMIT');
      return immutable(structuredClone(result ?? null));
    } finally { closeSync(lock); unlinkSync(`${this.path}.lock`); }
  }
}
export function initialStore(batchId, caps) {
  for (const field of ['batchMicroUsd', 'cardMicroUsd', 'maxAttempts', 'maxProviderAttempts', 'maxToolCalls', 'maxStageDurationMs', 'maxCardDurationMs', 'deadlineMs']) requireThat(Number.isSafeInteger(caps[field]) && caps[field] > 0, 'INVALID_CAPS');
  return { mode: 'OFFLINE_REFERENCE', version: 0, batchId, caps, cards: {}, operations: {}, attempts: {}, outbox: {}, spentMicroUsd: 0, reservedMicroUsd: 0 };
}
