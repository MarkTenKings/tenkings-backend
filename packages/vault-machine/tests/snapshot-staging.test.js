const test = require("node:test"), assert = require("node:assert/strict");
const { mkdtempSync, writeFileSync, rmSync, existsSync } = require("node:fs");
const { tmpdir } = require("node:os"), { join } = require("node:path");
const { VaultStore } = require("../dist/store");
test("an interrupted coordinated restore or upgrade cannot create or open a machine", t => {
  const dir = mkdtempSync(join(tmpdir(), "vault-incomplete-state-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "state-operation.pending.json"), JSON.stringify({ operation: "RESTORE" }));
  const file = join(dir, "vault.sqlite");
  assert.throws(() => new VaultStore(file, { machineId: "00000000-0000-4000-8000-000000000001", appVersion: "0.1.0" }), e => e.code === "STATE_OPERATION_INCOMPLETE");
  assert.equal(existsSync(file), false);
});
