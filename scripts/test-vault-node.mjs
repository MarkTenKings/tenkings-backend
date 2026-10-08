import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

if (!["20", "22"].includes(process.versions.node.split(".")[0])) throw new Error("Vault validation requires Node 20 compatibility or the Node 22 Linux runtime");
// Enumerate explicitly: cmd.exe does not expand tests/*.test.js on Node 20.
const directory = resolve(process.cwd(), "tests");
const files = readdirSync(directory).filter((file) => file.endsWith(".test.js")).sort().map((file) => resolve(directory, file));
if (!files.length) throw new Error("Vault Node test discovery found no tests");
const concurrency = process.env.VAULT_NODE_TEST_CONCURRENCY;
if (concurrency !== undefined && !/^(?:[1-9]|1[0-6])$/.test(concurrency)) throw new Error("VAULT_NODE_TEST_CONCURRENCY must be an integer from 1 to 16");
// Constrained Linux/emulated builders may serialize file workers; individual
// tests still exercise their own actual concurrent operations and assertions.
const result = spawnSync(process.execPath, ["--test", ...(concurrency ? [`--test-concurrency=${concurrency}`] : []), ...files], { stdio: "inherit", env: process.env });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
