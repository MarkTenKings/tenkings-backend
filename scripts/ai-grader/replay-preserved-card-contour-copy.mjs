import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [
  stationManifestPath,
  frontPackageSource,
  backPackageSource,
  calibrationBundlePath,
  replayRoot,
] = process.argv.slice(2);

for (const [label, value] of [
  ["station manifest", stationManifestPath],
  ["Front evidence package", frontPackageSource],
  ["Back evidence package", backPackageSource],
  ["calibration bundle", calibrationBundlePath],
  ["replay root", replayRoot],
]) {
  if (!value || !path.isAbsolute(value)) {
    throw new Error(`${label} must be an absolute path.`);
  }
}
if (existsSync(replayRoot)) {
  throw new Error("Replay root must not already exist.");
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hashFile = (filePath) => sha256(readFileSync(filePath));
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const {
  normalizeCardImageWithGeometry,
} = await import(
  pathToFileURL(path.join(
    repositoryRoot,
    "packages",
    "ai-grader-capture-helper",
    "dist",
    "drivers",
    "cardGeometry.js",
  )).href
);
const {
  createFixedRigProcessingWorkerRequest,
  executeFixedRigProcessingWorkerRequest,
  validateFixedRigProcessingWorkerAuthorityInput,
} = await import(
  pathToFileURL(path.join(
    repositoryRoot,
    "packages",
    "ai-grader-capture-helper",
    "dist",
    "drivers",
    "fixedRigProcessingWorkerProtocol.js",
  )).href
);

function filesUnder(root) {
  const files = [];
  for (const name of readdirSync(root)) {
    const filePath = path.join(root, name);
    const stat = statSync(filePath);
    if (stat.isDirectory()) files.push(...filesUnder(filePath));
    else if (stat.isFile()) files.push(filePath);
  }
  return files;
}

function tiffLedger(root) {
  const entries = filesUnder(root)
    .filter((filePath) => /\.tiff?$/i.test(filePath))
    .map((filePath) => ({
      relativePath: path.relative(root, filePath).replaceAll("\\", "/"),
      byteSize: statSync(filePath).size,
      sha256: hashFile(filePath),
    }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return { entries, ledgerSha256: sha256(Buffer.from(JSON.stringify(entries), "utf8")) };
}

function replacePathStrings(value, sourceRoot, destinationRoot) {
  if (typeof value === "string") {
    const sourceLower = sourceRoot.toLowerCase();
    return value.toLowerCase().startsWith(sourceLower)
      ? destinationRoot + value.slice(sourceRoot.length)
      : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => replacePathStrings(entry, sourceRoot, destinationRoot));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        replacePathStrings(entry, sourceRoot, destinationRoot),
      ]),
    );
  }
  return value;
}

async function mapWithConcurrency(values, concurrency, worker) {
  const output = new Array(values.length);
  let nextIndex = 0;
  await Promise.all(Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex++;
        output[index] = await worker(values[index], index);
      }
    },
  ));
  return output;
}

async function copyEvidencePackage(
  sourceRoot,
  destinationRoot,
  workerRoot,
  gradingSessionId,
) {
  cpSync(sourceRoot, destinationRoot, { recursive: true, errorOnExist: true });
  const copiedManifestPath = path.join(destinationRoot, "manifest.json");
  const copiedManifest = replacePathStrings(
    JSON.parse(readFileSync(copiedManifestPath, "utf8")),
    sourceRoot,
    destinationRoot,
  );
  const sideName = copiedManifest.evidenceSide;
  const side = copiedManifest[sideName];
  const geometryAuthorityRole = "all_on";
  const authorityCapture = side.allOn.capture;
  const selectedBracketCell = side.photometricExposureBracket.cells.find(
    (cell) => cell.exposureUs === 37500,
  );
  if (!selectedBracketCell) {
    throw new Error(`${sideName} copied evidence omitted the native 37.5 ms bracket cell.`);
  }
  const allOn = { ...side.allOn, role: "all_on" };
  const acceptedProfile = {
    ...side.acceptedProfile,
    role: "accepted_profile",
  };
  const captureBatch = {
    executionPath: "warm_full_forensic_runner",
    packageId: copiedManifest.packageId,
    packageDir: destinationRoot,
    sideDir: path.join(destinationRoot, sideName),
    side: sideName,
    captureProfile: copiedManifest.captureProfile,
    rawEvidenceFormat: "tiff",
    activeLightingProfile: copiedManifest.activeLightingProfile,
    batch: {
      captures: {
        allOn,
        acceptedProfile,
        channels: selectedBracketCell.channels,
        photometricBracket: side.photometricExposureBracket,
      },
    },
  };
  const workerRequest = await createFixedRigProcessingWorkerRequest({
    allowedOutputRoot: workerRoot,
    requestId: `${sideName}-preserved-copy-worker`,
    sessionId: gradingSessionId,
    captureBatch,
  });
  const workerResponse = await executeFixedRigProcessingWorkerRequest(
    workerRequest,
    workerRoot,
  );
  await validateFixedRigProcessingWorkerAuthorityInput(
    workerRequest,
    {
      packageId: copiedManifest.packageId,
      side: sideName,
      allOn,
    },
    workerRoot,
  );
  const geometry = workerResponse.authority.source.geometry;
  if (geometry.placementState !== "ready" || !geometry.observedDenseContour) {
    throw new Error(
      `${sideName} copied authoritative TIFF did not produce a ready dense pixel contour: ` +
      `${geometry.placementState}; ${geometry.warnings.join("; ")}`,
    );
  }
  const normalizedDir = path.join(destinationRoot, sideName, "normalized-replay");
  mkdirSync(normalizedDir, { recursive: true });
  const authorityRegistration = await normalizeCardImageWithGeometry({
    sourceImagePath: authorityCapture.outputFilePath,
    normalizedOutputPath: path.join(
      normalizedDir,
      `${sideName}-${geometryAuthorityRole.replaceAll("_", "-")}-authority.png`,
    ),
    geometry,
  });
  if (!authorityRegistration.normalizedArtifact) {
    throw new Error(`${sideName} authority normalization produced no artifact.`);
  }
  const secondaryRole = "accepted_profile";
  const secondaryCapture = side.acceptedProfile.capture;
  const secondaryRegistration = await normalizeCardImageWithGeometry({
    sourceImagePath: secondaryCapture.outputFilePath,
    normalizedOutputPath: path.join(
      normalizedDir,
      `${sideName}-${secondaryRole.replaceAll("_", "-")}-registered.png`,
    ),
    geometry,
  });
  if (!secondaryRegistration.normalizedArtifact) {
    throw new Error(`${sideName} secondary-role normalization produced no artifact.`);
  }
  const bracketRoles = side.photometricExposureBracket.cells.flatMap((cell) => [
    ...cell.references,
    ...cell.channels,
  ]);
  const bracketRegistrations = await mapWithConcurrency(
    bracketRoles,
    4,
    async (role, index) => {
      const registration = await normalizeCardImageWithGeometry({
        sourceImagePath: role.capture.outputFilePath,
        normalizedOutputPath: path.join(
          normalizedDir,
          `${sideName}-bracket-${String(index + 1).padStart(2, "0")}-${role.role.replaceAll("_", "-")}.png`,
        ),
        geometry,
      });
      if (!registration.normalizedArtifact) {
        throw new Error(`${sideName} ${role.role} normalization produced no artifact.`);
      }
      return registration;
    },
  );
  bracketRoles.forEach((role, index) => {
    role.normalized = {
      ...(role.normalized ?? {}),
      analysisArtifact: bracketRegistrations[index].normalizedArtifact,
    };
  });
  side.normalizedCard = authorityRegistration;
  side.allOn.analysisArtifact = authorityRegistration.normalizedArtifact;
  side.acceptedProfile.analysisArtifact = secondaryRegistration.normalizedArtifact;
  side.fullResolutionGeometryAuthority = workerResponse.authority;
  writeFileSync(copiedManifestPath, `${JSON.stringify(copiedManifest, null, 2)}\n`, "utf8");
  return {
    manifestPath: copiedManifestPath,
    manifestSha256: hashFile(copiedManifestPath),
    workerProtocol: {
      requestIdentity: workerRequest.identity,
      responseIdentity: workerResponse.identity,
      authorityResolution: workerResponse.authority.resolution,
      sourceSha256: workerResponse.authority.source.sourceSha256,
      contourSha256:
        workerResponse.authority.source.geometry.observedDenseContour.contourSha256,
    },
  };
}

const sourceLedgersBefore = {
  front: tiffLedger(frontPackageSource),
  back: tiffLedger(backPackageSource),
};
if (
  sourceLedgersBefore.front.entries.length !== 35 ||
  sourceLedgersBefore.back.entries.length !== 35
) {
  throw new Error("Preserved replay requires exactly 35 Front and 35 Back TIFF roles.");
}

mkdirSync(replayRoot, { recursive: false });
const station = JSON.parse(readFileSync(stationManifestPath, "utf8"));
const copiedPackagesRoot = path.join(replayRoot, "worker-packages");
mkdirSync(copiedPackagesRoot, { recursive: false });
const frontSourceManifest = JSON.parse(
  readFileSync(path.join(frontPackageSource, "manifest.json"), "utf8"),
);
const backSourceManifest = JSON.parse(
  readFileSync(path.join(backPackageSource, "manifest.json"), "utf8"),
);
const copiedFrontRoot = path.join(copiedPackagesRoot, frontSourceManifest.packageId);
const copiedBackRoot = path.join(copiedPackagesRoot, backSourceManifest.packageId);
const copiedFront = await copyEvidencePackage(
  frontPackageSource,
  copiedFrontRoot,
  copiedPackagesRoot,
  station.sessionId,
);
const copiedBack = await copyEvidencePackage(
  backPackageSource,
  copiedBackRoot,
  copiedPackagesRoot,
  station.sessionId,
);

const copiedLedgers = {
  front: tiffLedger(copiedFrontRoot),
  back: tiffLedger(copiedBackRoot),
};
for (const side of ["front", "back"]) {
  if (
    JSON.stringify(copiedLedgers[side].entries) !==
    JSON.stringify(sourceLedgersBefore[side].entries)
  ) {
    throw new Error(`${side} TIFF copy ledger differs from preserved source evidence.`);
  }
}

const persistedAuthority = station.mathematicalV1?.gradingAuthority;
if (!persistedAuthority) {
  throw new Error("Station manifest lacks its Mathematical grading authority.");
}
const authority = {
  schemaVersion: persistedAuthority.schemaVersion,
  cardIdentity: persistedAuthority.cardIdentity,
  cardFormatId: "standard_trading_card_63_50x88_90_r3_18_v1",
  sides: persistedAuthority.sides,
  publication: {
    certId: `OFFLINE-REPLAY-${station.reportId}`,
    publicReportUrl: `/ai-grader/reports/${station.reportId}`,
    qrPayloadUrl: `/ai-grader/reports/${station.reportId}`,
  },
};

const {
  buildFixedRigMathematicalCalibrationStationPackageV1,
} = await import(
  pathToFileURL(path.join(
    repositoryRoot,
    "packages",
    "ai-grader-capture-helper",
    "dist",
    "drivers",
    "fixedRigMathematicalStationAdapterV1.js",
  )).href
);

const result = await buildFixedRigMathematicalCalibrationStationPackageV1({
  authority,
  queueItemId: station.rapidCapture.queueItemId,
  gradingSessionId: station.sessionId,
  generatedAt: station.mathematicalV1.generatedAt,
  reportId: station.reportId,
  outputDir: path.join(replayRoot, "report-package"),
  captureProfileVersion: "ten-kings-fixed-rig-production-fast-v1",
  calibration: {
    bundlePath: calibrationBundlePath,
    bundleSha256: hashFile(calibrationBundlePath),
    expectedRigId: station.mathematicalV1.calibrationActivationAuthority.rigId,
    activationAuthority: station.mathematicalV1.calibrationActivationAuthority,
  },
  warmSides: {
    front: copiedFront,
    back: copiedBack,
  },
});

if (result.status === "insufficient_evidence") {
  throw new Error(
    `Exact evidence copy replay failed at ${result.failedStage}: ${result.reasons.join("; ")}`,
  );
}
if (result.status !== "operator_resolution_required") {
  throw new Error(`Expected operator_resolution_required, received ${result.status}.`);
}
if (
  result.request.binding.queueItemId !== station.rapidCapture.queueItemId ||
  result.request.binding.gradingSessionId !== station.sessionId ||
  result.request.binding.reportId !== station.reportId
) {
  throw new Error("Replay changed the exact queue/session/report identity.");
}
const expectedGalleryCounts = {
  centering: 2,
  corners: 8,
  edges: 8,
  surface: 2,
};
for (const [element, count] of Object.entries(expectedGalleryCounts)) {
  if (result.workspace.galleries[element].length !== count) {
    throw new Error(
      `${element} replay gallery has ${result.workspace.galleries[element].length}, expected ${count}.`,
    );
  }
}
if (result.workspaceAssets.length !== 20) {
  throw new Error(`Replay workspace has ${result.workspaceAssets.length} assets, expected 20.`);
}

const sourceLedgersAfter = {
  front: tiffLedger(frontPackageSource),
  back: tiffLedger(backPackageSource),
};
for (const side of ["front", "back"]) {
  if (
    JSON.stringify(sourceLedgersAfter[side]) !==
    JSON.stringify(sourceLedgersBefore[side])
  ) {
    throw new Error(`${side} preserved evidence changed during replay.`);
  }
}

const summary = {
  status: result.status,
  formatAuthorityMode:
    "offline_generic_shape_authority_no_expected_pokemon_profile_seed",
  exactIdentity: result.request.binding,
  originalElements: Object.fromEntries(
    Object.entries(result.request.originalElements).map(([element, value]) => [
      element,
      {
        status: value.status,
        score: value.score,
        failureReasons: value.failureReasons,
      },
    ]),
  ),
  galleryCounts: Object.fromEntries(
    Object.entries(result.workspace.galleries).map(([element, gallery]) => [
      element,
      gallery.length,
    ]),
  ),
  galleryMeasurementSummaries: Object.fromEntries(
    Object.entries(result.workspace.galleries).map(([element, gallery]) => [
      element,
      gallery.map((asset) => ({
        side: asset.side,
        location: asset.location,
        measurementSummary: asset.measurementSummary,
      })),
    ]),
  ),
  workspaceAssetCount: result.workspaceAssets.length,
  sourceTiffRoles: {
    front: sourceLedgersBefore.front.entries.length,
    back: sourceLedgersBefore.back.entries.length,
  },
  sourceTiffLedgerSha256: {
    front: sourceLedgersBefore.front.ledgerSha256,
    back: sourceLedgersBefore.back.ledgerSha256,
  },
  copiedTiffLedgerSha256: {
    front: copiedLedgers.front.ledgerSha256,
    back: copiedLedgers.back.ledgerSha256,
  },
  actualWorkerProtocol: {
    front: copiedFront.workerProtocol,
    back: copiedBack.workerProtocol,
  },
  preservedSourcesUnchanged: true,
  replayRoot,
};
writeFileSync(
  path.join(replayRoot, "replay-summary.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
  "utf8",
);
console.log(JSON.stringify(summary, null, 2));
