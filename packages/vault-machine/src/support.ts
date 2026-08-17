import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { redactVaultValue } from "../../vault-contracts/dist";
import { VaultStore } from "./store";
import { iso } from "./util";

/** Creates metadata-only support evidence. The SQLite database, cookies, PIN verifiers and credentials are never included. */
export function createSupportBundleDirectory(store: VaultStore, outputDirectory: string, logFiles: string[] = []): { manifestPath: string; files: string[] } {
  mkdirSync(outputDirectory, { recursive: true });
  const meta = store.one(`SELECT machine_id,app_version,schema_version,active_config_version,pending_config_version,last_cloud_success_at,public_state_version,service_locked,automation_halted,recovery_required FROM machine_meta WHERE singleton=1`);
  const counts = {
    doors: store.one(`SELECT COUNT(*) AS count FROM door`).count,
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
      const lines = readFileSync(logPath, "utf8").split("\n").slice(-5000).map((line) => {
        try { return JSON.stringify(redactVaultValue(JSON.parse(line))); } catch { return "[UNPARSEABLE LOG LINE OMITTED]"; }
      });
      const selected = join(outputDirectory, `redacted-${basename(logPath)}`); writeFileSync(selected, lines.join("\n"), { encoding: "utf8", mode: 0o600 }); generated.push(selected);
    } catch { /* unavailable diagnostic is represented by omission */ }
  }
  const manifest = generated.map((path) => ({ file: basename(path), size: statSync(path).size, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") }));
  const manifestPath = join(outputDirectory, "manifest.json"); writeFileSync(manifestPath, JSON.stringify({ schemaVersion: 1, generatedAt: iso(), exclusions: ["database", "credentials", "PIN verifiers", "provider payloads", "cookies"], files: manifest }, null, 2), { encoding: "utf8", mode: 0o600 });
  return { manifestPath, files: readdirSync(outputDirectory).sort() };
}
