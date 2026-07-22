#!/usr/bin/env node
import path from "node:path";
import { archiveAuthorizedStaleInvalidRapidCaptureQueueItemsV1 } from "./drivers/staleInvalidRapidCaptureQueueArchivalV1";

function exactArgs(argv: string[]) {
  const allowed = new Set(["--output-dir", "--archive-root", "--idle-status-path", "--idle-status-sha256"]);
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(key) || !value || values.has(key)) throw new Error("Exact CLI arguments are required once each; no item IDs, incident hashes, or reason are caller-selectable.");
    values.set(key, value);
  }
  if (values.size !== allowed.size) throw new Error("Required: --output-dir --archive-root --idle-status-path --idle-status-sha256");
  return Object.fromEntries([...values].map(([key, value]) => [key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value])) as {
    outputDir: string; archiveRoot: string; idleStatusPath: string; idleStatusSha256: string;
  };
}

async function main() {
  const input = exactArgs(process.argv.slice(2));
  const result = await archiveAuthorizedStaleInvalidRapidCaptureQueueItemsV1({
    outputDir: path.resolve(input.outputDir),
    archiveRoot: path.resolve(input.archiveRoot),
    idleStatusPath: path.resolve(input.idleStatusPath),
    idleStatusSha256: input.idleStatusSha256.toLowerCase(),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
