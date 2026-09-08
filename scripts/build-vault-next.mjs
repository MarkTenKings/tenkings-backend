import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { vaultNextTestEnvironment, vaultTestRoot } from "./vault-next-test-server.mjs";

const env = vaultNextTestEnvironment();
// Invoke the package-manager JavaScript entry with Node; Windows .cmd files
// cannot be spawned directly without introducing shell interpretation.
const pnpmScript = process.env.npm_execpath;
if (!pnpmScript || !/\.(?:c?js|mjs)$/.test(pnpmScript) || !existsSync(pnpmScript)) throw new Error("Run this build through pnpm vault:build-next");
function run(args) {
  const result = spawnSync(process.execPath, [pnpmScript, ...args], { cwd: vaultTestRoot, env, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(["--filter", "@tenkings/database", "generate"]);
for (const name of ["vault-contracts", "shared", "database", "browser-rip-client", "ai-grader-capture-helper", "ebay-sold-comps-v2", "nextjs-app"]) run(["--filter", `@tenkings/${name}`, "build"]);
