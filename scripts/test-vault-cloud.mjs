import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

if (process.versions.node.split(".")[0] !== "20") throw new Error("Vault validation requires Node 20");
const app = resolve(import.meta.dirname, "../frontend/nextjs-app");
const requireFromApp = createRequire(resolve(app, "package.json"));
const tests = readdirSync(resolve(app, "tests")).filter((file) => /^vaultV1.*\.test\.tsx?$/.test(file)).sort().map((file) => `tests/${file}`);
tests.push("lib/vaultSupport.test.ts");
if (tests.length < 3) throw new Error("Vault cloud regression discovery is incomplete");
const result = spawnSync(process.execPath, [requireFromApp.resolve("tsx/cli"), "--test", ...tests], { cwd: app, stdio: "inherit", env: process.env });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
