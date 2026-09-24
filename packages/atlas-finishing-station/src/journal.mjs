import { mkdir, lstat, open, readFile, rename, rmdir } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { stationCanonical, stationHash, stationAssert as check } from '@atlas/finishing/station-protocol';

/** One protected local station ledger, including the original signed arm.
 * Interrupted mutexes are retained for reconciliation, never auto-expired.
 */
export function createStationJournal({ directory, fullSync }) {
  check(isAbsolute(directory) && typeof fullSync === 'function');
  const path = join(directory, 'bridge.json'), mutex = join(directory, '.mutation');
  async function prepare() {
    await mkdir(directory, { recursive: true, mode: 0o700 }); const stat = await lstat(directory);
    check(stat.isDirectory() && !stat.isSymbolicLink() && !(stat.mode & 0o077) && stat.uid === process.getuid(), 'STATION_JOURNAL_UNSAFE');
  }
  async function read() {
    await prepare();
    try {
      const stat = await lstat(path);
      check(stat.isFile() && !stat.isSymbolicLink() && !(stat.mode & 0o077) && stat.uid === process.getuid() && stat.size <= 16 * 1024 * 1024, 'STATION_JOURNAL_UNSAFE');
      const value = JSON.parse(await readFile(path, 'utf8'));
      check(value.version === 1 && Array.isArray(value.records) && value.records.length <= 4096 && new Set(value.records.map(record => record.plan.planHash)).size === value.records.length, 'STATION_JOURNAL_INVALID');
      check(value.active === null || value.records.some(record => record.plan.planHash === value.active && !record.completed), 'STATION_JOURNAL_INVALID');
      return value;
    } catch (error) { if (error.code === 'ENOENT') return { version: 1, active: null, enrollment: null, records: [] }; throw error; }
  }
  async function mutate(callback) {
    await prepare(); await mkdir(mutex, { mode: 0o700 });
    try {
      const state = await read(), result = callback(state), bytes = Buffer.from(JSON.stringify(state));
      check(bytes.length <= 16 * 1024 * 1024 && state.records.length <= 4096, 'STATION_JOURNAL_FULL');
      const temp = join(directory, `.pending-${randomUUID()}`), handle = await open(temp, 'wx', 0o600);
      try { await handle.writeFile(bytes); await handle.sync(); await fullSync(handle.fd); } finally { await handle.close(); }
      await rename(temp, path); const dir = await open(directory, 'r'); try { await dir.sync(); } finally { await dir.close(); }
      return structuredClone(result);
    } finally { await rmdir(mutex); }
  }
  return Object.freeze({
    state: read,
    enroll(envelope) { return mutate(state => { check(!state.active, 'STATION_PREVIOUS_CARD_UNRESOLVED', 409); state.enrollment = structuredClone(envelope); return envelope; }); },
    async get(planHash) { return (await read()).records.find(record => record.plan.planHash === planHash) ?? null; },
    reserve(input) {
      const sourceHash = stationHash(stationCanonical(input));
      return mutate(state => {
        const existing = state.records.find(record => record.plan.planHash === input.plan.planHash);
        if (existing) { check(existing.sourceHash === sourceHash, 'STATION_INTENT_CONFLICT', 409); return existing; }
        check(state.active === null, 'STATION_PREVIOUS_CARD_UNRESOLVED', 409);
        const record = { ...structuredClone(input), sourceHash, completed: false, writeAck: null, removalAck: null, removal: null };
        state.records.push(record); state.active = input.plan.planHash; return record;
      });
    },
    update(planHash, patch) {
      check(Object.keys(patch).every(key => ['writeAck','removalAck','removal','completed','lastError'].includes(key)), 'STATION_JOURNAL_INVALID');
      return mutate(state => {
        const record = state.records.find(value => value.plan.planHash === planHash); check(record, 'STATION_INTENT_MISSING', 404);
        for (const [key, value] of Object.entries(patch)) {
          check(key === 'lastError' || !record[key] || stationCanonical(record[key]) === stationCanonical(value), 'STATION_JOURNAL_CONFLICT', 409); record[key] = structuredClone(value);
        }
        if (record.completed) { check(record.writeAck && record.removalAck && record.removal, 'STATION_COMPLETION_INVALID'); if (state.active === planHash) state.active = null; }
        return record;
      });
    },
  });
}
