import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export const vaultTestRoot = resolve(import.meta.dirname, "..");
export const vaultTestApp = resolve(vaultTestRoot, "frontend/nextjs-app");
export const unavailableDatabaseUrl = "postgresql://vault_validation:unused@127.0.0.1:1/no_database?connect_timeout=1";

export function assertIsolatedNextEnvironment() {
  assert.equal(process.versions.node.split(".")[0], "20", "Vault Next validation requires Node 20");
  for (const directory of [vaultTestRoot, vaultTestApp]) {
    for (const file of [".env", ".env.local", ".env.production", ".env.production.local"]) {
      assert.equal(existsSync(resolve(directory, file)), false, "Local Next validation requires a checkout without environment files");
    }
  }
}

export function vaultNextTestEnvironment(databaseUrl = unavailableDatabaseUrl) {
  assertIsolatedNextEnvironment();
  if (databaseUrl !== unavailableDatabaseUrl) {
    assert.equal(process.env.AI_GRADER_NFC_DISPOSABLE_VALIDATION, "1", "Disposable database harness required");
    const target = new URL(databaseUrl);
    assert.equal(target.protocol, "postgresql:");
    assert.equal(target.hostname, "127.0.0.1");
    assert.equal(target.username, "tenkings_nfc_validation");
    assert.equal(target.pathname, "/tenkings_ai_grader_nfc_validation");
    assert.ok(Number(target.port) > 1 && Number(target.port) <= 65_535);
    assert.deepEqual([...target.searchParams.entries()], [["schema", "public"]]);
  }
  // Do not inherit provider credentials, alternate database URLs or production configuration.
  return {
    PATH: process.env.PATH, ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", RUN_DB_MIGRATIONS: "false", VERCEL_ENV: "preview",
    DATABASE_URL: databaseUrl,
  };
}

export async function startVaultNextTestServer(databaseUrl = unavailableDatabaseUrl) {
  const env = vaultNextTestEnvironment(databaseUrl);
  const manifest = JSON.parse(readFileSync(resolve(vaultTestApp, ".next/server/pages-manifest.json"), "utf8"));
  assert.ok(manifest["/api/vault/v1/machines/[machineId]/[...action]"]);
  assert.equal(manifest["/api/vault/v1/machines/[machineId]/events:batch"], undefined);
  assert.equal(manifest["/api/vault/v1/machines/[machineId]/staff-grants:pull"], undefined);
  const allocation = createServer();
  await new Promise((done, reject) => { allocation.once("error", reject); allocation.listen(0, "127.0.0.1", done); });
  const port = allocation.address().port;
  await new Promise((done) => allocation.close(done));
  const child = spawn(process.execPath, [resolve(vaultTestApp, "node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: vaultTestApp, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  let logs = "", exited = false, startupError;
  child.stdout.on("data", (chunk) => { logs = (logs + chunk).slice(-4000); });
  child.stderr.on("data", (chunk) => { logs = (logs + chunk).slice(-4000); });
  child.on("exit", () => { exited = true; });
  child.on("error", (error) => { startupError = error; });
  const url = `http://127.0.0.1:${port}`;
  const close = async () => {
    if (!exited) child.kill("SIGTERM");
    if (!exited) await Promise.race([new Promise((done) => child.once("exit", done)), delay(5000)]);
    if (!exited) {
      child.kill("SIGKILL");
      await Promise.race([new Promise((done) => child.once("exit", done)), delay(5000)]);
    }
    assert.ok(exited || startupError, "Disposable Next process did not exit");
  };
  try {
    let ready = false;
    for (let attempt = 0; attempt < 150; attempt += 1) {
      if (startupError || exited) throw new Error("Disposable Next server failed during startup");
      try {
        const response = await fetch(`${url}/api/vault/v1/machines/00000000-0000-4000-8000-000000000339/unknown`, { signal: AbortSignal.timeout(500) });
        if (response.status === 404) { ready = true; break; }
      } catch { /* bounded startup polling only */ }
      await delay(200);
    }
    assert.ok(ready, `Disposable Next startup deadline: ${logs.replaceAll(databaseUrl, "[DISPOSABLE_DATABASE]")}`);
    return { url, close };
  } catch (error) { await close(); throw error; }
}
