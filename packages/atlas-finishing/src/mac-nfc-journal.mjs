import { mkdir, lstat, open, readFile, rename, rmdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
const assert = (ok, code = 'MAC_NFC_JOURNAL_INVALID') => { if (!ok) throw new Error(code); };
const states = ['WAITING_FOR_TAG', 'PROCESSING', 'WRITE_INTENT', 'READBACK_VERIFIED', 'LOCK_INTENT', 'LOCK_VERIFIED', 'WAITING_FOR_HOST_ACK', 'WAITING_FOR_REMOVAL', 'NFC_COMPLETE', 'UNKNOWN'];
const id = value => assert(/^afnfc_[a-f0-9]{64}$/.test(value));
const binding = ['version', 'intentId', 'planHash', 'profileHash', 'stationId', 'enrollmentId', 'keyId', 'expiresAt', 'authorizationHash', 'nonce', 'ndefHash'];
const fields = new Set([...binding, 'revision', 'state', 'readbackVerified', 'lockVerified', 'removalObserved', 'hostedAcknowledged', 'receipt', 'receiptHash', 'signature']);
function valid(record) {
  id(record.intentId); assert(Object.keys(record).every(key => fields.has(key)) && states.includes(record.state)
    && Number.isSafeInteger(record.revision) && record.revision >= 0);
  assert(record.state !== 'NFC_COMPLETE' || record.readbackVerified && record.lockVerified && record.removalObserved && record.hostedAcknowledged && record.receipt);
}
/** Private durable one-station journal. fullSync(fd) MUST be supplied by the
 * qualified native Mac layer (F_FULLFSYNC); there is no weaker default. A crash
 * leaves .mutation for explicit read-only reconciliation; it is never expired
 * or deleted on startup. Terminal records remain to fence every old intent. */
export function createFileMacNfcJournal({ directory, fullSync }) {
  assert(typeof directory === 'string' && isAbsolute(directory) && typeof fullSync === 'function');
  const file = join(directory, 'station.json'), mutex = join(directory, '.mutation');
  async function checked() {
    await mkdir(directory, { recursive: true, mode: 0o700 }); const stat = await lstat(directory);
    assert(stat.isDirectory() && !stat.isSymbolicLink() && !(stat.mode & 0o077) && stat.uid === process.getuid());
  }
  async function state() {
    try {
      const stat = await lstat(file); assert(stat.isFile() && !stat.isSymbolicLink() && !(stat.mode & 0o077) && stat.uid === process.getuid() && stat.size <= 16 * 1024 * 1024);
      const value = JSON.parse(await readFile(file, 'utf8'));
      assert(value.version === 1 && (value.stationId === null || /^[A-Za-z0-9_-]{1,128}$/.test(value.stationId))
        && Array.isArray(value.records) && value.records.length <= 4096);
      value.records.forEach(valid); assert(new Set(value.records.map(record => record.intentId)).size === value.records.length);
      assert(value.records.every(record => record.stationId === value.stationId));
      assert(value.active === null || value.records.some(record => record.intentId === value.active && record.state !== 'NFC_COMPLETE'));
      return value;
    } catch (error) { if (error.code === 'ENOENT') return { version: 1, stationId: null, active: null, records: [] }; throw error; }
  }
  async function mutate(callback) {
    await checked(); await mkdir(mutex, { mode: 0o700 });
    try {
      const value = await state(), result = callback(value), bytes = Buffer.from(JSON.stringify(value));
      assert(bytes.length <= 16 * 1024 * 1024 && value.records.length <= 4096);
      const temp = join(directory, `.pending-${randomUUID()}`), handle = await open(temp, 'wx', 0o600);
      try { await handle.writeFile(bytes); await handle.sync(); await fullSync(handle.fd); } finally { await handle.close(); }
      await rename(temp, file);
      const dir = await open(directory, 'r'); try { await dir.sync(); } finally { await dir.close(); }
      return structuredClone(result);
    } finally { await rmdir(mutex); }
  }
  return Object.freeze({ capability: Object.freeze({ durable: true }),
    async read(intentId) { id(intentId); await checked(); return structuredClone((await state()).records.find(record => record.intentId === intentId) ?? null); },
    reserve(record) {
      valid(record); return mutate(value => {
        assert(value.stationId === null || value.stationId === record.stationId, 'MAC_NFC_STATION_CONFLICT');
        const existing = value.records.find(item => item.intentId === record.intentId);
        if (existing) { assert(binding.every(key => existing[key] === record[key]), 'MAC_NFC_INTENT_CONFLICT'); return { created: false, record: existing }; }
        assert(value.active === null, 'MAC_NFC_STATION_BUSY'); assert(record.state === 'WAITING_FOR_TAG' && record.revision === 0);
        value.records.push(structuredClone(record)); value.stationId = record.stationId; value.active = record.intentId; return { created: true, record };
      });
    },
    advance(intentId, revision, patch) {
      id(intentId); assert(Object.keys(patch).every(key => fields.has(key) && !binding.includes(key) && key !== 'revision'));
      return mutate(value => {
        const at = value.records.findIndex(record => record.intentId === intentId), previous = value.records[at];
        assert(previous && previous.revision === revision && previous.state !== 'NFC_COMPLETE', 'MAC_NFC_JOURNAL_CONFLICT');
        const record = { ...previous, ...structuredClone(patch), revision: revision + 1 }; valid(record);
        assert(['readbackVerified', 'lockVerified', 'removalObserved', 'hostedAcknowledged'].every(key => !previous[key] || record[key] === true));
        value.records[at] = record; if (record.state === 'NFC_COMPLETE') value.active = null; return record;
      });
    },
  });
}
