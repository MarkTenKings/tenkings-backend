import { createHash } from "node:crypto";
import { closeSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { redactVaultValue } from "../../vault-contracts/dist";
import { VaultStore } from "./store";
import { iso } from "./util";

/** Creates metadata-only support evidence. The SQLite database, cookies, PIN verifiers and credentials are never included. */
export function createSupportBundleDirectory(store: VaultStore, outputDirectory: string, logFiles: string[] = []): { manifestPath: string; files: string[] } {
  mkdirSync(dirname(resolve(outputDirectory)), { recursive: true });
  // Reusing a directory could accidentally package pre-existing private files.
  mkdirSync(outputDirectory, { mode: 0o700 });
  const meta = store.one(`SELECT machine_id,app_version,schema_version,active_config_version,pending_config_version,last_cloud_success_at,public_state_version,service_locked,automation_halted,recovery_required FROM machine_meta WHERE singleton=1`);
  const counts = {
    doors: store.one(`SELECT COUNT(*) AS count FROM door WHERE active=1`).count,
    retiredDoors: store.one(`SELECT COUNT(*) AS count FROM door WHERE active=0`).count,
    pendingOutbox: store.one(`SELECT COUNT(*) AS count FROM outbox WHERE acknowledged_at IS NULL`).count,
    nonterminalSales: store.one(`SELECT COUNT(*) AS count FROM sale WHERE state NOT IN ('COMPLETED','PAYMENT_DECLINED','PAYMENT_CANCELLED')`).count,
  };
  const generated: string[] = [];
  const healthPath = join(outputDirectory, "health-metadata.json");
  writeFileSync(healthPath, JSON.stringify(redactVaultValue({ generatedAt: iso(), meta, counts, integrity: store.integrityCheck(), pragmas: store.pragmaSnapshot() }), null, 2), { encoding: "utf8", mode: 0o600 });
  generated.push(healthPath);
  for (const logPath of logFiles) {
    try {
      if (!statSync(logPath).isFile()) continue;
      const handle = openSync(logPath, "r"); let tail: string;
      try {
        const size = fstatSync(handle).size;
        const length = Math.min(size, 1024 * 1024); const data = Buffer.alloc(length);
        const read = readSync(handle, data, 0, length, size - length);
        tail = data.subarray(0, read).toString("utf8");
        if (size > length) tail = tail.slice(tail.indexOf("\n") + 1);
      } finally { closeSync(handle); }
      const lines = tail.split("\n").slice(-5000).map((line) => {
        try { return JSON.stringify(redactVaultValue(JSON.parse(line))); } catch { return "[UNPARSEABLE LOG LINE OMITTED]"; }
      });
      const selected = join(outputDirectory, `redacted-${basename(logPath)}`); writeFileSync(selected, lines.join("\n"), { encoding: "utf8", mode: 0o600, flag: "wx" }); generated.push(selected);
    } catch { /* unavailable diagnostic is represented by omission */ }
  }
  const manifest = generated.map((path) => ({ file: basename(path), size: statSync(path).size, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") }));
  const manifestPath = join(outputDirectory, "manifest.json"); writeFileSync(manifestPath, JSON.stringify({ schemaVersion: 1, generatedAt: iso(), exclusions: ["database", "credentials", "PIN verifiers", "provider payloads", "cookies"], files: manifest }, null, 2), { encoding: "utf8", mode: 0o600 });
  return { manifestPath, files: readdirSync(outputDirectory).sort() };
}
