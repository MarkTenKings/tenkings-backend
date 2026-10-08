// No machine database, payment adapter or serial transport is opened by this probe.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createRequire } = require('node:module');
const root = path.resolve(process.argv[2]);
const pin = JSON.parse(fs.readFileSync(path.join(root, 'deploy/vault-linux/runtime.json')));
if (process.platform !== pin.platform || process.arch !== pin.architecture || process.versions.node !== pin.nodeVersion) throw new Error('Pinned Linux Node runtime mismatch');
const requireMachine = createRequire(path.join(root, 'packages/vault-machine/package.json'));
if (requireMachine('better-sqlite3/package.json').version !== pin.betterSqlite3Version) throw new Error('Native SQLite package version mismatch');
const Database = requireMachine('better-sqlite3');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-native-probe-'));
let db;
try {
  db = new Database(path.join(scratch, 'probe.sqlite'));
  if (db.pragma('journal_mode = WAL', { simple: true }) !== 'wal') throw new Error('WAL unavailable');
  db.pragma('synchronous = FULL');
  db.exec('CREATE TABLE probe(id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
  db.transaction(() => db.prepare('INSERT INTO probe VALUES (?, ?)').run(1, 'durable'))();
  try { db.transaction(() => { db.prepare('INSERT INTO probe VALUES (?, ?)').run(2, 'rolled-back'); throw new Error('rollback'); })(); } catch (error) { if (error.message !== 'rollback') throw error; }
  db.close(); db = new Database(path.join(scratch, 'probe.sqlite'));
  if (db.prepare('SELECT COUNT(*) AS count FROM probe').get().count !== 1 || db.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('SQLite durability/integrity probe failed');
  process.stdout.write(JSON.stringify({ nodeVersion: process.versions.node, nodeAbi: process.versions.modules, platform: process.platform, architecture: process.arch, betterSqlite3Version: pin.betterSqlite3Version, sqliteVersion: db.prepare('SELECT sqlite_version() AS version').get().version, wal: true, transactionRollback: true, integrity: true }) + '\n');
} finally { db?.close(); fs.rmSync(scratch, { recursive: true, force: true }); }
