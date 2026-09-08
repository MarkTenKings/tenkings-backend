import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

if (process.versions.node.split(".")[0] !== "20") throw new Error("Vault validation requires Node 20");
// Enumerate explicitly: cmd.exe does not expand tests/*.test.js on Node 20.
const directory = resolve(process.cwd(), "tests");
const files = readdirSync(directory).filter((file) => file.endsWith(".test.js")).sort().map((file) => resolve(directory, file));
if (!files.length) throw new Error("Vault Node test discovery found no tests");
const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit", env: process.env });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
