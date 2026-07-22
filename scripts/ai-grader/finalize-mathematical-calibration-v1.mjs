#!/usr/bin/env node

import crypto from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ANALYSIS_SCHEMA = "ten-kings-mathematical-calibration-analysis-v1";
const ANALYSIS_ALGORITHM = "opencv_physical_calibration_analysis_v1";
const HASH_POLICY = "sha256-exact-utf8-analysisPayloadJson";
const BUNDLE_SCHEMA = "ten-kings-mathematical-calibration-bundle-v1";
const PROFILE_FILE_NAME = "mathematical-calibration-profile-v1.json";
const PHYSICAL_ARTIFACT_FILE_NAME = "mathematical-calibration-artifact-v1.json";
const ACCEPTANCE_FILE_NAME = "mathematical-calibration-acceptance-v1.json";
const PRODUCT_OWNER_AUTHORITY_FILE_NAME = "product-owner-operational-acceptance-v1.json";
const BUNDLE_FILE_NAME = "mathematical-calibration-bundle-v1.json";
const REGISTRY_HANDOFF_SCHEMA = "ten-kings-mathematical-calibration-finalizer-handoff-v1";
const REGISTRY_HANDOFF_AUTHORITY = "trusted-local-mathematical-calibration-finalizer-v1";
const REGISTRY_HANDOFF_FILE_NAME = "mathematical-calibration-finalizer-handoff-v1.json";


function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

function parseArguments(argv) {
  let analysisPath;
  let outputDir;
  let registryStagingRoot;
  let productOwnerOperationalAcceptancePath;
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--analysis") analysisPath = argv[++index];
    else if (option === "--output-dir") outputDir = argv[++index];
    else if (option === "--registry-staging-root") registryStagingRoot = argv[++index];
    else if (option === "--product-owner-operational-acceptance") {
      productOwnerOperationalAcceptancePath = argv[++index];
    }
    else if (option === "--help" || option === "-h") {
      return { help: true };
    } else {
      throw new Error(`Unknown or incomplete option: ${option ?? "(missing)"}`);
    }
  }
  if (!analysisPath || !outputDir) {
    throw new Error("--analysis and --output-dir are required");
  }
  return {
    analysisPath: path.resolve(analysisPath),
    outputDir: path.resolve(outputDir),
    registryStagingRoot: registryStagingRoot ? path.resolve(registryStagingRoot) : undefined,
    productOwnerOperationalAcceptancePath: productOwnerOperationalAcceptancePath
      ? path.resolve(productOwnerOperationalAcceptancePath)
      : undefined,
  };
}

export function verifyMathematicalCalibrationAnalysisV1(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Calibration analysis must be a JSON object.");
  }
  if (value.schemaVersion !== ANALYSIS_SCHEMA) {
    throw new Error(`Calibration analysis schema must be ${ANALYSIS_SCHEMA}.`);
  }
  if (value.hashPolicy !== HASH_POLICY) {
    throw new Error(`Calibration analysis hash policy must be ${HASH_POLICY}.`);
  }
  if (value.algorithmVersion !== ANALYSIS_ALGORITHM) {
    throw new Error(`Calibration analysis algorithmVersion must be ${ANALYSIS_ALGORITHM}.`);
  }
  if (!/^[0-9a-f]{64}$/.test(value.analysisSha256 ?? "")) {
    throw new Error("Calibration analysis must contain an exact lowercase SHA-256.");
  }
  if (typeof value.analysisPayloadJson !== "string") {
    throw new Error("Calibration analysis must contain the exact UTF-8 analysis payload.");
  }
  const recomputed = crypto
    .createHash("sha256")
    .update(Buffer.from(value.analysisPayloadJson, "utf8"))
    .digest("hex");
  if (recomputed !== value.analysisSha256) {
    throw new Error("Calibration analysis SHA-256 mismatch.");
  }
  let certifiedPayload;
  try {
    certifiedPayload = JSON.parse(value.analysisPayloadJson);
  } catch {
    throw new Error("Calibration analysis payload must be valid JSON.");
  }
  const readablePayload = {
    schemaVersion: value.schemaVersion,
    algorithmVersion: value.algorithmVersion,
    sourceManifestSha256: value.sourceManifestSha256,
    sourceCapturePackage: value.sourceCapturePackage,
    captureEvidenceAudit: value.captureEvidenceAudit,
    builderInput: value.builderInput,
    flatFieldArtifacts: value.flatFieldArtifacts,
    illuminationPatternArtifact: value.illuminationPatternArtifact,
  };
  if (
    JSON.stringify(canonical(readablePayload)) !==
    JSON.stringify(canonical(certifiedPayload))
  ) {
    throw new Error("Calibration analysis certified payload does not match readable fields.");
  }
  if (
    certifiedPayload.schemaVersion !== ANALYSIS_SCHEMA ||
    !certifiedPayload.builderInput ||
    typeof certifiedPayload.builderInput !== "object"
  ) {
    throw new Error("Calibration analysis must contain builderInput.");
  }
  return { ...value, ...certifiedPayload };
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function buildMathematicalCalibrationAcceptanceV1(analysis, result) {
  return {
    schemaVersion: "ten-kings-mathematical-calibration-acceptance-v1",
    analysisSha256: analysis.analysisSha256,
    sourceManifestSha256: analysis.sourceManifestSha256,
    sourceCapturePackage: analysis.sourceCapturePackage,
    status: result.status,
    isCalibrated: result.isCalibrated,
    issues: result.issues,
    artifactId: result.artifact.artifactId,
    artifactSha256: result.artifact.artifactSha256,
    profileId: result.profile?.profileId ?? null,
    calibrationVersion: result.profile?.calibrationVersion ?? null,
  };
}

async function writeJson(filePath, value) {
  const bytes = jsonBytes(value);
  await writeFile(filePath, bytes, { flag: "wx" });
  return { bytes, sha256: sha256(bytes) };
}

function exactLeafFileName(value, expected) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    path.basename(value) !== value ||
    value === "." ||
    value === ".." ||
    (expected && value !== expected)
  ) {
    throw new Error(
      `Calibration analysis artifact filename must be the exact safe leaf ${expected ?? "name"}.`,
    );
  }
  return value;
}

function exactSha256(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label} must be an exact lowercase SHA-256.`);
  }
  return value;
}

function exactNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function exactObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be one JSON object.`);
  }
  return value;
}

function exactObjectKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (
    actual.length !== required.length ||
    actual.some((key, index) => key !== required[index])
  ) {
    throw new Error(`${label} fields do not match the exact V1 contract.`);
  }
}

async function loadCertifiedPhotometricArtifacts(analysis, analysisPath) {
  if (!Array.isArray(analysis.flatFieldArtifacts) || analysis.flatFieldArtifacts.length !== 8) {
    throw new Error("Finalized calibration requires exact flat-field channels 1 through 8.");
  }
  const seenChannels = new Set();
  const sourceDirectory = path.dirname(analysisPath);
  const flatFields = [];
  for (const descriptor of analysis.flatFieldArtifacts) {
    const channelIndex = descriptor?.channelIndex;
    if (!Number.isInteger(channelIndex) || channelIndex < 1 || channelIndex > 8) {
      throw new Error("Flat-field calibration channelIndex must be an integer from 1 through 8.");
    }
    if (seenChannels.has(channelIndex)) {
      throw new Error(`Flat-field calibration channel ${channelIndex} is duplicated.`);
    }
    seenChannels.add(channelIndex);
    const fileName = exactLeafFileName(
      descriptor.artifactFileName,
      `flat-field-channel-${channelIndex}-v1.json`,
    );
    const expectedSha256 = exactSha256(
      descriptor.artifactFileSha256,
      `Flat-field channel ${channelIndex} artifactFileSha256`,
    );
    const sourcePath = path.join(sourceDirectory, fileName);
    const bytes = await readFile(sourcePath);
    if (sha256(bytes) !== expectedSha256) {
      throw new Error(`Flat-field channel ${channelIndex} exact file SHA-256 mismatch.`);
    }
    flatFields.push({
      role: "flat_field",
      channelIndex,
      fileName,
      sha256: expectedSha256,
      sourcePath,
    });
  }
  flatFields.sort((left, right) => left.channelIndex - right.channelIndex);
  if (flatFields.some((entry, index) => entry.channelIndex !== index + 1)) {
    throw new Error("Finalized calibration requires exact flat-field channels 1 through 8.");
  }

  const patternDescriptor = analysis.illuminationPatternArtifact;
  if (!patternDescriptor || typeof patternDescriptor !== "object") {
    throw new Error("Finalized calibration requires an illumination-pattern artifact.");
  }
  const patternFileName = exactLeafFileName(
    patternDescriptor.artifactFileName,
    "illumination-pattern-v1.json",
  );
  const patternSha256 = exactSha256(
    patternDescriptor.artifactFileSha256,
    "Illumination-pattern artifactFileSha256",
  );
  const patternSourcePath = path.join(sourceDirectory, patternFileName);
  const patternBytes = await readFile(patternSourcePath);
  if (sha256(patternBytes) !== patternSha256) {
    throw new Error("Illumination-pattern exact file SHA-256 mismatch.");
  }
  return {
    flatFields,
    illuminationPattern: {
      role: "illumination_pattern",
      fileName: patternFileName,
      sha256: patternSha256,
      sourcePath: patternSourcePath,
    },
  };
}

async function copyCertifiedArtifact(source, outputDir) {
  const destination = path.join(outputDir, source.fileName);
  await copyFile(source.sourcePath, destination, fsConstants.COPYFILE_EXCL);
  const copiedSha256 = sha256(await readFile(destination));
  if (copiedSha256 !== source.sha256) {
    throw new Error(`${source.fileName} changed while the calibration bundle was finalized.`);
  }
}

export async function stageFinalizedMathematicalCalibrationBundleForRegistryV1({
  bundle,
  outputDir,
  registryStagingRoot,
}) {
  if (!bundle || !bundle.path || !bundle.sha256 || !bundle.manifest) {
    throw new Error("Registry staging requires one exact finalized calibration bundle.");
  }
  if (typeof registryStagingRoot !== "string" || !path.isAbsolute(registryStagingRoot) ||
      typeof outputDir !== "string" || !path.isAbsolute(outputDir)) {
    throw new Error("Registry staging and finalized output roots must be explicit absolute paths.");
  }
  const root = path.resolve(registryStagingRoot);
  const sourceOutputDir = path.resolve(outputDir);
  if (path.resolve(bundle.path) !== path.join(sourceOutputDir, BUNDLE_FILE_NAME)) {
    throw new Error("Registry staging accepts only the exact bundle emitted in the finalized output directory.");
  }
  const finalDirectory = path.join(root, bundle.sha256);
  const handoff = {
    schemaVersion: REGISTRY_HANDOFF_SCHEMA,
    authority: REGISTRY_HANDOFF_AUTHORITY,
    rigId: bundle.manifest.rigId,
    profileId: bundle.manifest.profileId,
    calibrationVersion: bundle.manifest.calibrationVersion,
    finalizedAt: bundle.manifest.finalizedAt,
    bundleFileName: BUNDLE_FILE_NAME,
    bundleManifestSha256: bundle.sha256,
    sourceAnalysisSha256: bundle.manifest.sourceAnalysisSha256,
    ...(bundle.manifest.operationalAcceptance
      ? {
          operationalAcceptanceStatus: bundle.manifest.operationalAcceptance.status,
          operationalAcceptanceAuthoritySha256:
            bundle.manifest.operationalAcceptance.authoritySha256,
          operationalAcceptanceAuthorityFileSha256:
            bundle.manifest.operationalAcceptance.authorityFileSha256,
        }
      : {}),
  };
  const files = [
    { fileName: BUNDLE_FILE_NAME, sha256: bundle.sha256 },
    ...bundle.manifest.artifacts.map((entry) => ({
      fileName: exactLeafFileName(entry.fileName),
      sha256: exactSha256(entry.sha256, `Bundle artifact ${entry.fileName} SHA-256`),
    })),
  ];

  async function verifyStagedDirectory(directory) {
    const handoffBytes = await readFile(path.join(directory, REGISTRY_HANDOFF_FILE_NAME));
    if (!handoffBytes.equals(jsonBytes(handoff))) {
      throw new Error("Existing registry handoff bytes do not match the exact finalized bundle.");
    }
    for (const file of files) {
      const bytes = await readFile(path.join(directory, file.fileName));
      if (sha256(bytes) !== file.sha256) {
        throw new Error(`Registry-staged ${file.fileName} bytes do not match the finalized bundle.`);
      }
    }
  }

  try {
    await verifyStagedDirectory(finalDirectory);
    return {
      directory: finalDirectory,
      path: path.join(finalDirectory, REGISTRY_HANDOFF_FILE_NAME),
      sha256: sha256(jsonBytes(handoff)),
      handoff,
    };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  await mkdir(root, { recursive: true });
  const temporaryDirectory = path.join(root, `.finalizer-handoff-${bundle.sha256}-${crypto.randomUUID()}`);
  await mkdir(temporaryDirectory, { recursive: false });
  const relativeTemporary = path.relative(root, temporaryDirectory);
  if (!relativeTemporary || relativeTemporary.startsWith("..") || path.isAbsolute(relativeTemporary)) {
    throw new Error("Registry staging temporary directory escaped the fixed root.");
  }
  try {
    for (const file of files) {
      await copyFile(
        path.join(outputDir, file.fileName),
        path.join(temporaryDirectory, file.fileName),
        fsConstants.COPYFILE_EXCL,
      );
      const copied = await readFile(path.join(temporaryDirectory, file.fileName));
      if (sha256(copied) !== file.sha256) {
        throw new Error(`${file.fileName} changed during registry handoff staging.`);
      }
    }
    const handoffWrite = await writeJson(
      path.join(temporaryDirectory, REGISTRY_HANDOFF_FILE_NAME),
      handoff,
    );
    try {
      await rename(temporaryDirectory, finalDirectory);
    } catch (error) {
      try {
        await verifyStagedDirectory(finalDirectory);
        await rm(temporaryDirectory, { recursive: true, force: true });
      } catch {
        throw error;
      }
    }
    await verifyStagedDirectory(finalDirectory);
    return {
      directory: finalDirectory,
      path: path.join(finalDirectory, REGISTRY_HANDOFF_FILE_NAME),
      sha256: handoffWrite.sha256,
      handoff,
    };
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}


export async function finalizeMathematicalCalibrationV1({
  analysisPath,
  outputDir,
  registryStagingRoot,
  productOwnerOperationalAcceptancePath,
  buildFixedRigPhysicalCalibrationV1,
  verifyProductOwnerOperationalAcceptanceV1,
  validateMathematicalCalibrationForOperationalUseV1,
  implementationIdentity,
}) {
  const analysisBytes = await readFile(analysisPath);
  const analysis = verifyMathematicalCalibrationAnalysisV1(
    JSON.parse(analysisBytes.toString("utf8")),
  );
  const result = buildFixedRigPhysicalCalibrationV1(analysis.builderInput);
  if (
    result.status === "finalized" &&
    (!result.isCalibrated || !result.profile || typeof result.profile !== "object")
  ) {
    throw new Error("Calibration authority returned an inconsistent finalized result.");
  }
  // Exact analyzer artifacts remain immutable evidence even when a separate
  // physical acceptance gate rejects calibration. Never write an acceptance
  // record against missing or changed analyzer bytes.
  const certifiedPhotometricArtifacts = await loadCertifiedPhotometricArtifacts(
    analysis,
    analysisPath,
  );
  await mkdir(outputDir, { recursive: true });
  const acceptance = buildMathematicalCalibrationAcceptanceV1(analysis, result);
  const acceptanceBytes = jsonBytes(acceptance);
  let operationalAcceptance = null;
  let operationalProfile = null;
  let operationalAuthorityFileBytes = null;
  if (productOwnerOperationalAcceptancePath) {
    if (result.status !== "rejected" || result.isCalibrated || !result.operationalProfileCandidate) {
      throw new Error("Product-owner operational acceptance is valid only for the exact rejected calibration.");
    }
    if (!verifyProductOwnerOperationalAcceptanceV1 ||
        !validateMathematicalCalibrationForOperationalUseV1 ||
        !implementationIdentity) {
      throw new Error("Product-owner operational acceptance requires the protected verifier identities.");
    }
    operationalAuthorityFileBytes = await readFile(productOwnerOperationalAcceptancePath);
    const parsedAuthority = verifyProductOwnerOperationalAcceptanceV1(
      JSON.parse(operationalAuthorityFileBytes.toString("utf8")),
      implementationIdentity,
    );
    const sourcePackage = exactObject(analysis.sourceCapturePackage, "sourceCapturePackage");
    const stationAuthority = exactObject(sourcePackage.stationAuthority, "sourceCapturePackage.stationAuthority");
    const subject = parsedAuthority.subject;
    const subjectMismatches = [
      ["sessionId", subject.sessionId, stationAuthority.sessionId],
      ["sourceCaptureManifestSha256", subject.sourceCaptureManifestSha256, analysis.sourceManifestSha256],
      ["sourceCapturePackage.manifestSha256", subject.sourceCaptureManifestSha256, sourcePackage.manifestSha256],
      ["analysisSha256", subject.analysisSha256, analysis.analysisSha256],
      ["analysisFileSha256", subject.analysisFileSha256, sha256(analysisBytes)],
      ["thresholdSetHash", subject.thresholdSetHash, sourcePackage.thresholdSetHash],
      ["physicalArtifactSha256", subject.physicalArtifactSha256, result.artifact.artifactSha256],
      ["mathematicalAcceptanceFileSha256", subject.mathematicalAcceptanceFileSha256, sha256(acceptanceBytes)],
      ["mathematicalAcceptanceStatus", subject.mathematicalAcceptanceStatus, acceptance.status],
      ["mathematicalIsCalibrated", subject.mathematicalIsCalibrated, acceptance.isCalibrated],
      ["rigId", subject.rigId, result.artifact.rigId],
      ["profileId", subject.profileId, result.operationalProfileCandidate.profileId],
      ["calibrationVersion", subject.calibrationVersion, result.operationalProfileCandidate.calibrationVersion],
      ["finalizedAt", subject.finalizedAt, result.operationalProfileCandidate.finalizedAt],
      ["artifactId", subject.artifactId, result.operationalProfileCandidate.artifactId],
    ].filter(([, actual, expected]) => actual !== expected).map(([label]) => label);
    if (JSON.stringify(canonical(parsedAuthority.exceptionLedger)) !==
        JSON.stringify(canonical(result.issues))) {
      subjectMismatches.push("exceptionLedger");
    }
    if (subjectMismatches.length > 0) {
      throw new Error(
        `Product-owner operational acceptance does not match exact rejected fields: ${subjectMismatches.join(", ")}.`,
      );
    }
    operationalProfile = {
      ...result.operationalProfileCandidate,
      operationalAcceptance: parsedAuthority,
    };
    const operationalValidation = validateMathematicalCalibrationForOperationalUseV1(
      operationalProfile,
    );
    if (!operationalValidation.valid || !operationalValidation.isOperationallyAccepted ||
        operationalValidation.isCalibrated || !operationalValidation.profile) {
      throw new Error("Product-owner operational profile did not reproduce its recorded mathematical exceptions.");
    }
    operationalAcceptance = parsedAuthority;
  }
  const physicalArtifactWrite = await writeJson(
    path.join(outputDir, PHYSICAL_ARTIFACT_FILE_NAME),
    result.artifact,
  );
  const acceptanceWrite = await writeJson(
    path.join(outputDir, ACCEPTANCE_FILE_NAME),
    acceptance,
  );
  let bundle = null;
  if (result.status === "finalized" || operationalAcceptance) {
    const selectedProfile = result.status === "finalized" ? result.profile : operationalProfile;
    if (!selectedProfile) throw new Error("Calibration finalization did not produce an operational profile.");
    const profileWrite = await writeJson(
      path.join(outputDir, PROFILE_FILE_NAME),
      selectedProfile,
    );
    let operationalAuthorityWrite = null;
    if (operationalAcceptance && operationalAuthorityFileBytes) {
      const authorityDestination = path.join(outputDir, PRODUCT_OWNER_AUTHORITY_FILE_NAME);
      await writeFile(authorityDestination, operationalAuthorityFileBytes, { flag: "wx" });
      operationalAuthorityWrite = {
        sha256: sha256(operationalAuthorityFileBytes),
      };
    }
    for (const flatField of certifiedPhotometricArtifacts.flatFields) {
      await copyCertifiedArtifact(flatField, outputDir);
    }
    await copyCertifiedArtifact(certifiedPhotometricArtifacts.illuminationPattern, outputDir);

    const profile = selectedProfile;
    const physicalArtifact = result.artifact;
    const physicalMethods = exactObject(
      physicalArtifact.methods,
      "physicalArtifact.methods",
    );
    const sourceCapturePackage = exactObject(
      analysis.sourceCapturePackage,
      "sourceCapturePackage",
    );
    exactObjectKeys(sourceCapturePackage, [
      ...(sourceCapturePackage.analyzerAuthoritySupersession === undefined
        ? []
        : ["analyzerAuthoritySupersession"]),
      "captureEvidenceAcceptance",
      "captureProfileVersion",
      "evidenceDerivedAuthority",
      "manifestSha256",
      "packageId",
      "purpose",
      "rigId",
      "schemaVersion",
      "stationAuthority",
      "subject",
      "thresholdSetHash",
      "thresholdSetId",
    ], "sourceCapturePackage");
    if (sourceCapturePackage.analyzerAuthoritySupersession !== undefined) {
      const supersession = exactObject(
        sourceCapturePackage.analyzerAuthoritySupersession,
        "sourceCapturePackage.analyzerAuthoritySupersession",
      );
      exactObjectKeys(supersession, ["byteSize", "path", "rebindId", "schemaVersion", "sha256"],
        "sourceCapturePackage.analyzerAuthoritySupersession");
      exactSha256(supersession.sha256, "sourceCapturePackage.analyzerAuthoritySupersession.sha256");
    }
    const sourceSubject = exactObject(
      sourceCapturePackage.subject,
      "sourceCapturePackage.subject",
    );
    const sourceStationAuthority = exactObject(
      sourceCapturePackage.stationAuthority,
      "sourceCapturePackage.stationAuthority",
    );
    exactObject(
      sourceCapturePackage.captureEvidenceAcceptance,
      "sourceCapturePackage.captureEvidenceAcceptance",
    );
    const evidenceDerivedAuthority = exactObject(
      sourceCapturePackage.evidenceDerivedAuthority,
      "sourceCapturePackage.evidenceDerivedAuthority",
    );
    exactObjectKeys(evidenceDerivedAuthority, [
      "thresholdSetHash",
      "thresholdSetId",
      "uncertaintyCoverageFactor",
    ], "sourceCapturePackage.evidenceDerivedAuthority");
    if (
      sourceCapturePackage.purpose !== "mathematical_calibration_v1" ||
      sourceCapturePackage.rigId !== profile.rigId ||
      sourceCapturePackage.thresholdSetId !== profile.thresholdSetId ||
      sourceCapturePackage.thresholdSetHash !== profile.thresholdSetHash ||
      evidenceDerivedAuthority.thresholdSetId !== profile.thresholdSetId ||
      evidenceDerivedAuthority.thresholdSetHash !== profile.thresholdSetHash ||
      typeof evidenceDerivedAuthority.uncertaintyCoverageFactor !== "number" ||
      !Number.isFinite(evidenceDerivedAuthority.uncertaintyCoverageFactor) ||
      evidenceDerivedAuthority.uncertaintyCoverageFactor <= 0 ||
      evidenceDerivedAuthority.uncertaintyCoverageFactor !== physicalMethods.coverageFactor ||
      sourceSubject.productionCard !== false ||
      sourceStationAuthority.noProductionMutation !== true
    ) {
      throw new Error(
        "sourceCapturePackage is not the exact non-production rig/threshold authority accepted by the finalized profile.",
      );
    }
    const bundleManifest = {
      schemaVersion: BUNDLE_SCHEMA,
      rigId: exactNonEmptyString(profile.rigId, "Calibration profile rigId"),
      profileId: exactNonEmptyString(profile.profileId, "Calibration profile profileId"),
      calibrationVersion: exactNonEmptyString(
        profile.calibrationVersion,
        "Calibration profile calibrationVersion",
      ),
      finalizedAt: exactNonEmptyString(profile.finalizedAt, "Calibration profile finalizedAt"),
      thresholdSetId: exactNonEmptyString(
        profile.thresholdSetId,
        "Calibration profile thresholdSetId",
      ),
      thresholdSetHash: exactSha256(
        profile.thresholdSetHash,
        "Calibration profile thresholdSetHash",
      ),
      algorithmVersion: exactNonEmptyString(
        physicalArtifact.algorithmVersion,
        "Physical calibration algorithmVersion",
      ),
      analysisAlgorithmVersion: analysis.algorithmVersion,
      sourceAnalysisSha256: analysis.analysisSha256,
      sourceManifestSha256: exactSha256(
        analysis.sourceManifestSha256,
        "Calibration analysis sourceManifestSha256",
      ),
      sourceCapturePackage: {
        ...sourceCapturePackage,
        schemaVersion: exactNonEmptyString(
          sourceCapturePackage.schemaVersion,
          "sourceCapturePackage.schemaVersion",
        ),
        packageId: exactNonEmptyString(
          sourceCapturePackage.packageId,
          "sourceCapturePackage.packageId",
        ),
        manifestSha256: exactSha256(
          sourceCapturePackage.manifestSha256,
          "sourceCapturePackage.manifestSha256",
        ),
        captureProfileVersion: exactNonEmptyString(
          sourceCapturePackage.captureProfileVersion,
          "sourceCapturePackage.captureProfileVersion",
        ),
      },
      ...(operationalAcceptance && operationalAuthorityWrite
        ? {
            operationalAcceptance: {
              status: operationalAcceptance.authorityStatus,
              authorityId: operationalAcceptance.authorityId,
              authoritySha256: operationalAcceptance.authoritySha256,
              authorityFileSha256: operationalAuthorityWrite.sha256,
              exceptionLedgerSha256: operationalAcceptance.exceptionLedgerSha256,
              exceptionCount: operationalAcceptance.exceptionLedger.length,
            },
          }
        : {}),
      artifacts: [
        {
          role: "calibration_profile",
          fileName: PROFILE_FILE_NAME,
          sha256: profileWrite.sha256,
        },
        {
          role: "physical_calibration_artifact",
          fileName: PHYSICAL_ARTIFACT_FILE_NAME,
          sha256: physicalArtifactWrite.sha256,
        },
        {
          role: "calibration_acceptance",
          fileName: ACCEPTANCE_FILE_NAME,
          sha256: acceptanceWrite.sha256,
        },
        ...(operationalAcceptance && operationalAuthorityWrite
          ? [{
              role: "product_owner_operational_acceptance",
              fileName: PRODUCT_OWNER_AUTHORITY_FILE_NAME,
              sha256: operationalAuthorityWrite.sha256,
            }]
          : []),
        ...certifiedPhotometricArtifacts.flatFields.map((entry) => ({
          role: entry.role,
          channelIndex: entry.channelIndex,
          fileName: entry.fileName,
          sha256: entry.sha256,
        })),
        {
          role: certifiedPhotometricArtifacts.illuminationPattern.role,
          fileName: certifiedPhotometricArtifacts.illuminationPattern.fileName,
          sha256: certifiedPhotometricArtifacts.illuminationPattern.sha256,
        },
      ],
    };
    const bundlePath = path.join(outputDir, BUNDLE_FILE_NAME);
    const bundleWrite = await writeJson(bundlePath, bundleManifest);
    bundle = {
      path: bundlePath,
      sha256: bundleWrite.sha256,
      manifest: bundleManifest,
    };
    if (registryStagingRoot) {
      bundle.registryHandoff = await stageFinalizedMathematicalCalibrationBundleForRegistryV1({
        bundle,
        outputDir,
        registryStagingRoot,
      });
    }
  }
  return { result, acceptance, operationalAcceptance, bundle };
}

async function main() {
  const parsed = parseArguments(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(
      "Usage: node scripts/ai-grader/finalize-mathematical-calibration-v1.mjs " +
      "--analysis <analysis.json> --output-dir <new-empty-output-dir> " +
      "[--product-owner-operational-acceptance <authority.json>] " +
      "[--registry-staging-root <fixed-root>]\n",
    );
    return;
  }
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const require = createRequire(import.meta.url);
  const driverPath = path.resolve(
    moduleDir,
    "../../packages/ai-grader-capture-helper/dist/drivers/fixedRigPhysicalCalibrationV1.js",
  );
  const { buildFixedRigPhysicalCalibrationV1 } = require(driverPath);
  const operationalVerifierPath = path.resolve(
    moduleDir,
    "../../packages/ai-grader-capture-helper/dist/drivers/productOwnerOperationalAcceptanceV1.js",
  );
  const {
    verifyProductOwnerOperationalAcceptanceV1,
    validateMathematicalCalibrationForOperationalUseV1,
  } = require(operationalVerifierPath);
  const authorityProducerPath = path.resolve(
    moduleDir,
    "create-product-owner-operational-acceptance-v1.mjs",
  );
  const implementationIdentity = {
    finalizerSha256: sha256(await readFile(fileURLToPath(import.meta.url))),
    authorityProducerSha256: sha256(await readFile(authorityProducerPath)),
    implementationGitSha: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: path.resolve(moduleDir, "../.."),
      encoding: "utf8",
    }).trim(),
  };
  const { acceptance, operationalAcceptance, bundle } = await finalizeMathematicalCalibrationV1({
    ...parsed,
    buildFixedRigPhysicalCalibrationV1,
    verifyProductOwnerOperationalAcceptanceV1,
    validateMathematicalCalibrationForOperationalUseV1,
    implementationIdentity,
  });
  process.stdout.write(`${JSON.stringify({
    ...acceptance,
    calibrationBundle: bundle
      ? {
          path: bundle.path,
          sha256: bundle.sha256,
          registryHandoff: bundle.registryHandoff ?? null,
        }
      : null,
    operationalAcceptance: operationalAcceptance
      ? {
          status: operationalAcceptance.authorityStatus,
          authorityId: operationalAcceptance.authorityId,
          authoritySha256: operationalAcceptance.authoritySha256,
          exceptionLedgerSha256: operationalAcceptance.exceptionLedgerSha256,
          exceptionCount: operationalAcceptance.exceptionLedger.length,
        }
      : null,
  })}\n`);
  if (!acceptance.isCalibrated && !operationalAcceptance) process.exitCode = 2;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
