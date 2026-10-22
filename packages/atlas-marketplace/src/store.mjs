import { DatabaseSync } from 'node:sqlite';
import { chmodSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { canonicalJSON, clone, hash, requireValue } from './contract.mjs';

const EMPTY = { listings: {}, reservations: {}, receipts: {}, journals: [], intents: {}, orders: {}, fulfillment: {}, events: [], consent: {} };
const FORMAT = 'atlas-r2-synthetic-local-v1';

// This owned SQLite store is only the local qualification runtime. It is not a
// production persistence adapter and has no PostgreSQL/credentials fallback.
export function openLocalStore({ filename, clock = Date.now, environment } = {}) {
  requireValue(environment === 'SYNTHETIC_LOCAL', 'LOCAL_STORE_ONLY');
  requireValue(filename === ':memory:' || (typeof filename === 'string' && isAbsolute(filename)), 'ABSOLUTE_STORE_PATH_REQUIRED');
  if (filename !== ':memory:') {
    mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
    requireValue(realpathSync(dirname(filename)) === resolve(dirname(filename)), 'SYMLINK_STORE_REFUSED');
    try { requireValue(lstatSync(filename).isFile() && !lstatSync(filename).isSymbolicLink(), 'INVALID_STORE_FILE'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const db = new DatabaseSync(filename);
  if (filename !== ':memory:') chmodSync(filename, 0o600);
  db.exec('PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row => row.name);
  requireValue(tables.every(name => ['marketplace_state', 'marketplace_commits'].includes(name)), 'FOREIGN_DATABASE_REFUSED');
  db.exec(`CREATE TABLE IF NOT EXISTS marketplace_state (id INTEGER PRIMARY KEY CHECK(id=1), format TEXT NOT NULL, revision INTEGER NOT NULL, state TEXT NOT NULL, state_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS marketplace_commits (revision INTEGER PRIMARY KEY, previous_hash TEXT NOT NULL, state_hash TEXT NOT NULL, state TEXT NOT NULL, recorded_at INTEGER NOT NULL);
    CREATE TRIGGER IF NOT EXISTS marketplace_commits_no_update BEFORE UPDATE ON marketplace_commits BEGIN SELECT RAISE(ABORT, 'append only'); END;
    CREATE TRIGGER IF NOT EXISTS marketplace_commits_no_delete BEFORE DELETE ON marketplace_commits BEGIN SELECT RAISE(ABORT, 'append only'); END;`);
  db.prepare('INSERT OR IGNORE INTO marketplace_state VALUES (1,?,0,?,?)').run(FORMAT, canonicalJSON(EMPTY), hash(EMPTY));
  let active = false;
  function current() {
    const row = db.prepare('SELECT * FROM marketplace_state WHERE id=1').get();
    requireValue(row?.format === FORMAT, 'WRONG_STORE_FORMAT');
    const state = JSON.parse(row.state);
    requireValue(hash(state) === row.state_hash, 'STORE_CORRUPT');
    const tip = db.prepare('SELECT state_hash FROM marketplace_commits WHERE revision=?').get(row.revision);
    requireValue(row.revision === 0 || tip?.state_hash === row.state_hash, 'STORE_HISTORY_MISMATCH');
    return { row, state };
  }
  function transaction(fn) {
    requireValue(!active, 'NESTED_TRANSACTION');
    active = true;
    let began = false;
    try {
      db.exec('BEGIN IMMEDIATE');
      began = true;
      const { row, state } = current();
      const beforeJournals = clone(state.journals);
      const beforeEvents = clone(state.events);
      const now = clock();
      requireValue(Number.isSafeInteger(now) && now >= 0, 'INVALID_CLOCK');
      const tx = { state, now, emit(type, payload) {
        state.events.push({ sequence: state.events.length + 1, type, payload: clone(payload), at: now, environment: 'SYNTHETIC_LOCAL' });
      } };
      const result = fn(tx);
      requireValue(!result || typeof result.then !== 'function', 'ASYNC_TRANSACTION_REFUSED');
      requireValue(state.journals.length >= beforeJournals.length && hash(state.journals.slice(0, beforeJournals.length)) === hash(beforeJournals), 'JOURNAL_MUTATION');
      requireValue(state.events.length >= beforeEvents.length && hash(state.events.slice(0, beforeEvents.length)) === hash(beforeEvents), 'EVENT_MUTATION');
      const serialized = canonicalJSON(state), stateHash = hash(state);
      if (stateHash !== row.state_hash) {
        db.prepare('INSERT INTO marketplace_commits VALUES (?,?,?,?,?)').run(row.revision + 1, row.state_hash, stateHash, serialized, now);
        db.prepare('UPDATE marketplace_state SET revision=?,state=?,state_hash=? WHERE id=1').run(row.revision + 1, serialized, stateHash);
      }
      db.exec('COMMIT');
      began = false;
      return clone(result);
    } catch (error) { if (began) db.exec('ROLLBACK'); throw error; }
    finally { active = false; }
  }
  current();
  return { transaction, read(fn = state => state) { return clone(fn(current().state)); }, close() { db.close(); } };
}
