#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  STALE_REVIEW_SAFE_OFF_CAPTURE_CONFIRMATION_V1,
  captureStaleReviewSafeOffReceiptV1,
  regenerateStaleReviewSafeOffReceiptV1,
} from "./drivers/staleInvalidRapidCaptureSafeOffReceiptV1";
import { parseStaleReviewSafeOffReceiptConfigV1 } from "./drivers/staleInvalidRapidCaptureSafeOffReceiptConfigV1";

type CaptureArgs = { mode: "capture"; outputDir: string; configPath: string; confirmation: string };
type RegenerateArgs = { mode: "regenerate"; outputDir: string };

function exactArgs(argv: string[]): CaptureArgs | RegenerateArgs {
  const mode = argv[0];
  if (mode !== "capture" && mode !== "regenerate") {
    throw new Error("Required incident-only mode: capture or regenerate.");
  }
  const allowed = mode === "capture"
    ? new Set(["--output-dir", "--config-path", "--confirm"])
    : new Set(["--output-dir"]);
  const values = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(key) || !value || values.has(key)) {
      throw new Error("Only the exact incident receipt-capture arguments are accepted once each.");
    }
    values.set(key, value);
  }
  if (values.size !== allowed.size) throw new Error(`Missing required ${mode} receipt-capture argument.`);
  const outputDir = values.get("--output-dir")!;
  if (mode === "regenerate") return { mode, outputDir };
  return {
    mode,
    outputDir,
    configPath: values.get("--config-path")!,
    confirmation: values.get("--confirm")!,
  };
}

async function main() {
  const input = exactArgs(process.argv.slice(2));
  if (input.mode === "regenerate") {
    const result = regenerateStaleReviewSafeOffReceiptV1({ outputDir: path.resolve(input.outputDir) });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (input.confirmation !== STALE_REVIEW_SAFE_OFF_CAPTURE_CONFIRMATION_V1) {
    throw new Error(`Capture requires --confirm "${STALE_REVIEW_SAFE_OFF_CAPTURE_CONFIRMATION_V1}" after fresh explicit hardware authorization.`);
  }
  const configPath = path.resolve(input.configPath);
  const config = parseStaleReviewSafeOffReceiptConfigV1(readFileSync(configPath, "utf8"));
  const result = await captureStaleReviewSafeOffReceiptV1({
    outputDir: path.resolve(input.outputDir),
    captureHelperCliPath: path.join(__dirname, "cli.js"),
    controllerHost: String(config.leimacHost ?? ""),
    controllerPort: Number(config.leimacPort),
    confirmation: input.confirmation,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
