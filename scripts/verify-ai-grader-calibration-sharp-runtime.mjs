import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextAppRoot = path.join(repositoryRoot, "frontend", "nextjs-app");
const traceFiles = [
  path.join(
    nextAppRoot,
    ".next/server/pages/api/admin/ai-grader/calibration-snapshots/[...action].js.nft.json",
  ),
  path.join(
    nextAppRoot,
    ".next/server/pages/api/admin/ai-grader/calibration-activations/[...action].js.nft.json",
  ),
  path.join(
    nextAppRoot,
    ".next/server/pages/api/ai-grader/calibration-activation/status.js.nft.json",
  ),
];

const sharpPackageMarker = "/node_modules/.pnpm/sharp@0.34.5/node_modules/sharp/";
const linuxSharpMarker =
  "/node_modules/.pnpm/@img+sharp-linux-x64@0.34.5/node_modules/@img/sharp-linux-x64/";
const linuxLibvipsMarker =
  "/node_modules/.pnpm/@img+sharp-libvips-linux-x64@1.2.4/node_modules/@img/sharp-libvips-linux-x64/";
const traceResults = [];

for (const traceFile of traceFiles) {
  const trace = JSON.parse(await readFile(traceFile, "utf8"));
  assert(Array.isArray(trace.files), `${traceFile} does not contain a files array`);
  const normalizedFiles = trace.files.map((file) => file.replaceAll("\\", "/"));
  assert(
    normalizedFiles.some((file) => file.includes(sharpPackageMarker)),
    `${traceFile} does not package sharp 0.34.5`,
  );

  if (process.platform === "linux") {
    assert.equal(process.arch, "x64", `unsupported Vercel Linux architecture: ${process.arch}`);
    assert(
      normalizedFiles.some((file) => file.includes(linuxSharpMarker)),
      `${traceFile} does not package the sharp Linux x64 native runtime`,
    );
    assert(
      normalizedFiles.some((file) => file.includes(linuxLibvipsMarker)),
      `${traceFile} does not package the libvips Linux x64 runtime`,
    );
  }

  traceResults.push({
    trace: path.relative(repositoryRoot, traceFile).replaceAll("\\", "/"),
    fileCount: normalizedFiles.length,
  });
}

const requireFromNextApp = createRequire(path.join(nextAppRoot, "package.json"));
const calibrationBundle = requireFromNextApp(
  "@tenkings/ai-grader-capture-helper/calibration-bundle",
);
assert.equal(
  typeof calibrationBundle.loadFixedRigMathematicalCalibrationBundleV1,
  "function",
  "the calibration bundle entry point did not initialize",
);

console.log(
  JSON.stringify({
    ok: true,
    platform: process.platform,
    architecture: process.arch,
    sharpRuntime: "0.34.5",
    traces: traceResults,
    calibrationBundleImport: "passed",
  }),
);
