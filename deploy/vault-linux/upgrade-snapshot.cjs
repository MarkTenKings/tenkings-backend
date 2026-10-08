"use strict";
// Offline-only runner included in and verified by the signed release manifest.
const fs = require("node:fs"), path = require("node:path");
const release = path.resolve(__dirname, "../..");
const { createRequire } = require("node:module");
const fromMachine = createRequire(path.join(release, "packages/vault-machine/package.json"));
const Database = fromMachine("better-sqlite3");
const { MIGRATIONS, LOCAL_SCHEMA_VERSION } = require(path.join(release, "packages/vault-machine/dist/migrations.js"));
function upgrade(directory, machineId, fromSchema, toSchema, sourceCommit, appVersion) {
  if (!path.isAbsolute(directory) || !Number.isInteger(fromSchema) || !Number.isInteger(toSchema) || fromSchema >= toSchema || toSchema !== LOCAL_SCHEMA_VERSION
      || !/^[a-f0-9]{40}$/.test(sourceCommit) || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(appVersion)) throw new Error("OFFLINE_UPGRADE_ARGUMENTS_INVALID");
  const pendingPath = path.join(directory, "state-operation.pending.json"), marker = JSON.parse(fs.readFileSync(pendingPath, "utf8"));
  if (marker.operation !== "UPGRADE" || marker.machineId !== machineId || marker.sourceSchemaVersion !== fromSchema || marker.activationAllowed !== false) throw new Error("OFFLINE_UPGRADE_MARKER_REQUIRED");
  const file = path.join(directory, "vault.sqlite");
  if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink() || fs.existsSync(`${file}.writer.lock`)) throw new Error("OFFLINE_UPGRADE_FILE_INVALID");
  const db = new Database(file, { fileMustExist: true });
  try {
    db.exec("PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;");
    const m = db.prepare("SELECT machine_id,schema_version,service_locked,automation_halted,recovery_required FROM machine_meta WHERE singleton=1").get();
    if (m.machine_id !== machineId || m.schema_version !== fromSchema || !m.service_locked || !m.automation_halted || !m.recovery_required) throw new Error("OFFLINE_UPGRADE_HELD_IDENTITY_REQUIRED");
    const versions = db.prepare("SELECT version FROM schema_migration ORDER BY version").all().map(r => r.version);
    if (versions.length !== fromSchema || versions.some((v, index) => v !== index + 1)) throw new Error("OFFLINE_UPGRADE_LEDGER_INVALID");
    for (const migration of MIGRATIONS.filter(m => m.version > fromSchema)) {
      if (migration.rebuildsReferencedTables) db.pragma("foreign_keys=OFF");
      try { db.transaction(() => {
        db.exec(migration.sql);
        if (db.pragma("foreign_key_check").length) throw new Error("OFFLINE_UPGRADE_FOREIGN_KEYS_INVALID");
        db.prepare("INSERT INTO schema_migration(version,name,applied_at) VALUES(?,?,?)").run(migration.version, migration.name, new Date().toISOString());
      })(); } finally { if (migration.rebuildsReferencedTables) db.pragma("foreign_keys=ON"); }
    }
    db.prepare("UPDATE machine_meta SET schema_version=?,source_commit=?,app_version=? WHERE singleton=1").run(toSchema, sourceCommit, appVersion);
    if (db.pragma("integrity_check", { simple: true }) !== "ok") throw new Error("OFFLINE_UPGRADE_INTEGRITY_FAILED");
    db.pragma("wal_checkpoint(TRUNCATE)");
    return { upgraded: true, fromSchema, toSchema, technicalHoldRetained: true, networkRequests: 0 };
  } finally { db.close(); }
}
if (require.main === module) {
  try { const [dir, id, from, to, commit, version] = process.argv.slice(2); process.stdout.write(JSON.stringify(upgrade(dir, id, Number(from), Number(to), commit, version)) + "\n"); }
  catch { process.stderr.write("OFFLINE_UPGRADE_FAILED: preserve the marked staging directory and original snapshot\n"); process.exitCode = 1; }
}
module.exports = { upgrade };
