import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextAppRoot = path.join(repositoryRoot, "frontend", "nextjs-app");
const requireFromRepository = createRequire(import.meta.url);
const nextConfig = requireFromRepository("../frontend/nextjs-app/next.config.js");
assert.equal(
  path.resolve(nextConfig.experimental?.outputFileTracingRoot ?? ""),
  repositoryRoot,
  "Next outputFileTracingRoot must be the exact monorepo root",
);
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

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

for (const traceFile of traceFiles) {
  const trace = JSON.parse(await readFile(traceFile, "utf8"));
  assert(Array.isArray(trace.files), `${traceFile} does not contain a files array`);
  const normalizedFiles = trace.files.map((file) => file.replaceAll("\\", "/"));
  const sharpRuntimeFiles = trace.files.filter((file) => {
    const normalized = file.replaceAll("\\", "/");
    return normalized.includes(sharpPackageMarker)
      || normalized.includes(linuxSharpMarker)
      || normalized.includes(linuxLibvipsMarker);
  });
  assert(
    normalizedFiles.some((file) => file.includes(sharpPackageMarker)),
    `${traceFile} does not package sharp 0.34.5`,
  );

  let externalSharpFileCount = 0;
  for (const tracedFile of sharpRuntimeFiles) {
    const resolvedFile = path.resolve(path.dirname(traceFile), tracedFile);
    assert(
      isInside(repositoryRoot, resolvedFile),
      `${traceFile} traces a Sharp runtime member outside the monorepo trace root: ${tracedFile}`,
    );
    if (!isInside(nextAppRoot, resolvedFile)) externalSharpFileCount += 1;
    assert((await stat(resolvedFile)).isFile(), `${resolvedFile} is not a packaged runtime file`);
  }
  assert(
    externalSharpFileCount > 0,
    `${traceFile} does not trace any external Sharp files beneath the monorepo root`,
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
    sharpRuntimeFileCount: sharpRuntimeFiles.length,
    externalSharpFileCount,
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
    outputFileTracingRoot: repositoryRoot.replaceAll("\\", "/"),
    sharpRuntime: "0.34.5",
    traces: traceResults,
    calibrationBundleImport: "passed",
  }),
);
