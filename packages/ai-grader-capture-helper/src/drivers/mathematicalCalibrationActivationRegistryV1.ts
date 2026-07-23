import { constants as fsConstants } from "node:fs";
import { chmod, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import {
  createHash,
  createPublicKey,
  randomUUID,
  sign as signBytes,
  verify as verifyBytes,
  type KeyObject,
} from "node:crypto";
import path from "node:path";
import {
  AI_GRADER_CALIBRATION_HOSTED_AUTHORITY_SIGNATURE_ALGORITHM_V1,
  AI_GRADER_CALIBRATION_LOCAL_POINTER_V1_SCHEMA_VERSION,
  AI_GRADER_CALIBRATION_WORKSTATION_OBSERVATION_V1_SCHEMA_VERSION,
  AI_GRADER_CALIBRATION_WORKSTATION_RECEIPT_V1_SCHEMA_VERSION,
  aiGraderCalibrationActivationAuthorityV1Schema,
  aiGraderCalibrationLocalPointerV1Schema,
  aiGraderCalibrationObservationAuthorityV1Schema,
  aiGraderCalibrationPendingAuthorityV1Schema,
  aiGraderCalibrationWorkstationReceiptStatementV1,
  aiGraderCalibrationWorkstationReceiptV1Schema,
  aiGraderCalibrationWorkstationObservationStatementV1,
  aiGraderCalibrationWorkstationObservationV1Schema,
  aiGraderCalibrationRuntimeObservationV1Schema,
  aiGraderOperatingContextV1Schema,
  canonicalAiGraderCalibrationJsonV1,
  canonicalAiGraderCalibrationHostedAuthorityStatementV1,
  canonicalAiGraderOperatingContextV1,
  canonicalAiGraderRuntimeContextV1,
  type AiGraderCalibrationActivationAuthorityV1,
  type AiGraderCalibrationLocalPointerV1,
  type AiGraderCalibrationObservationAuthorityV1,
  type AiGraderCalibrationPendingAuthorityV1,
  type AiGraderCalibrationWorkstationReceiptV1,
  type AiGraderCalibrationWorkstationObservationV1,
  type AiGraderCalibrationRuntimeObservationV1,
  type AiGraderOperatingContextV1,
} from "@tenkings/shared";
import {
  FIXED_RIG_MATHEMATICAL_CALIBRATION_BUNDLE_FILE_V1,
  loadFixedRigMathematicalCalibrationBundleV1,
} from "./fixedRigMathematicalCalibrationBundleV1";

const SHA256 = /^[a-f0-9]{64}$/;
export const MATHEMATICAL_CALIBRATION_FINALIZER_HANDOFF_V1 =
  "ten-kings-mathematical-calibration-finalizer-handoff-v1" as const;
export const MATHEMATICAL_CALIBRATION_FINALIZER_HANDOFF_FILE_V1 =
  "mathematical-calibration-finalizer-handoff-v1.json" as const;

export type MathematicalCalibrationHostedAuthorityPublicKeyV1 = {
  keyId: string;
  rigId: string;
  publicKey: KeyObject;
};

export type MathematicalCalibrationFinalizerHandoffV1 = {
  schemaVersion: typeof MATHEMATICAL_CALIBRATION_FINALIZER_HANDOFF_V1;
  authority: "trusted-local-mathematical-calibration-finalizer-v1";
  rigId: string;
  profileId: string;
  calibrationVersion: string;
  finalizedAt: string;
  bundleFileName: typeof FIXED_RIG_MATHEMATICAL_CALIBRATION_BUNDLE_FILE_V1;
  bundleManifestSha256: string;
  sourceAnalysisSha256: string;
  operationalAcceptanceStatus?: "OWNER_ACCEPTED_WITH_RECORDED_EXCEPTIONS";
  operationalAcceptanceAuthoritySha256?: string;
  operationalAcceptanceAuthorityFileSha256?: string;
};


export type MathematicalCalibrationActivationRegistryV1Options = {
  rootDir: string;
  finalizedBundleStagingRoot: string;
  expectedRigId: string;
  helperInstanceId: string;
  helperVersion: string;
  workstationKeyId: string;
  workstationPrivateKey: KeyObject;
  hostedAuthorityPublicKeys: Map<string, MathematicalCalibrationHostedAuthorityPublicKeyV1>;
  liveOperatingContext(
    expected: AiGraderOperatingContextV1,
  ): AiGraderOperatingContextV1 | Promise<AiGraderOperatingContextV1>;
  observeActivationRuntime(
    expected: AiGraderOperatingContextV1,
    evidenceDirectory: string,
  ): Promise<{
    runtimeObservation: AiGraderCalibrationRuntimeObservationV1;
    evidenceImage: {
      fileName: "activation-runtime-evidence.png";
      mediaType: "image/png";
      sha256: string;
      byteSize: number;
      observedAt: string;
    };
  }>;
  isIdle(): boolean | Promise<boolean>;
  now?: () => Date;
};

export class MathematicalCalibrationActivationRegistryV1Error extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MathematicalCalibrationActivationRegistryV1Error";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new MathematicalCalibrationActivationRegistryV1Error(code, message);
}

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalSha(value: unknown) {
  return sha256(canonicalAiGraderCalibrationJsonV1(value));
}

export function parseMathematicalCalibrationHostedAuthorityPublicKeysV1(
  raw: unknown,
  expectedRigId: string,
): Map<string, MathematicalCalibrationHostedAuthorityPublicKeyV1> {
  if (typeof raw !== "string" || raw.length < 2 || raw.length > 128 * 1024 ||
      typeof expectedRigId !== "string" || !expectedRigId.trim()) {
    return fail(
      "AI_GRADER_LOCAL_CALIBRATION_HOSTED_KEY_CONFIGURATION_INVALID",
      "Hosted calibration authority public-key configuration is unavailable.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail(
      "AI_GRADER_LOCAL_CALIBRATION_HOSTED_KEY_CONFIGURATION_INVALID",
      "Hosted calibration authority public-key configuration is invalid.",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return fail(
      "AI_GRADER_LOCAL_CALIBRATION_HOSTED_KEY_CONFIGURATION_INVALID",
      "Hosted calibration authority public-key configuration is invalid.",
    );
  }
  const result = new Map<string, MathematicalCalibrationHostedAuthorityPublicKeyV1>();
  for (const [keyId, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!SHA256.test(keyId) || result.has(keyId) || !value || typeof value !== "object" ||
        Array.isArray(value)) {
      return fail(
        "AI_GRADER_LOCAL_CALIBRATION_HOSTED_KEY_CONFIGURATION_INVALID",
        "Hosted calibration authority public-key entry is invalid.",
      );
    }
    const entry = value as Record<string, unknown>;
    if (Object.keys(entry).sort().join("|") !==
        ["algorithm", "publicSpkiDerBase64", "rigId"].sort().join("|") ||
        entry.algorithm !== AI_GRADER_CALIBRATION_HOSTED_AUTHORITY_SIGNATURE_ALGORITHM_V1 ||
        entry.rigId !== expectedRigId || typeof entry.publicSpkiDerBase64 !== "string" ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(entry.publicSpkiDerBase64)) {
      return fail(
        "AI_GRADER_LOCAL_CALIBRATION_HOSTED_KEY_CONFIGURATION_INVALID",
        "Hosted calibration authority public-key entry is invalid.",
      );
    }
    const der = Buffer.from(entry.publicSpkiDerBase64, "base64");
    if (der.toString("base64") !== entry.publicSpkiDerBase64 || sha256(der) !== keyId) {
      return fail(
        "AI_GRADER_LOCAL_CALIBRATION_HOSTED_KEY_CONFIGURATION_INVALID",
        "Hosted calibration authority public-key identity is invalid.",
      );
    }
    try {
      const publicKey = createPublicKey({ key: der, format: "der", type: "spki" });
      if (publicKey.asymmetricKeyType !== "ec" ||
          publicKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
        throw new Error("wrong key");
      }
      result.set(keyId, { keyId, rigId: expectedRigId, publicKey });
    } catch {
      return fail(
        "AI_GRADER_LOCAL_CALIBRATION_HOSTED_KEY_CONFIGURATION_INVALID",
        "Hosted calibration authority public key is invalid.",
      );
    }
  }
  if (result.size < 1) {
    return fail(
      "AI_GRADER_LOCAL_CALIBRATION_HOSTED_KEY_CONFIGURATION_INVALID",
      "At least one pinned hosted calibration authority key is required.",
    );
  }
  return result;
}

function validHostedAuthorityKeys(
  value: Map<string, MathematicalCalibrationHostedAuthorityPublicKeyV1>,
  expectedRigId: string,
) {
  if (!(value instanceof Map) || value.size < 1) return false;
  return [...value.entries()].every(([keyId, entry]) =>
    SHA256.test(keyId) && entry.keyId === keyId && entry.rigId === expectedRigId &&
    entry.publicKey.type === "public" && entry.publicKey.asymmetricKeyType === "ec" &&
    entry.publicKey.asymmetricKeyDetails?.namedCurve === "prime256v1");
}

async function exists(filePath: string) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export function createMathematicalCalibrationActivationRegistryV1(
  options: MathematicalCalibrationActivationRegistryV1Options,
) {
  const rootDir = path.resolve(options.rootDir);
  const finalizedBundleStagingRoot = path.resolve(options.finalizedBundleStagingRoot);
  const bundlesRoot = path.join(rootDir, "bundles", "sha256");
  const receiptsRoot = path.join(rootDir, "receipts");
  const contextsRoot = path.join(rootDir, "operating-contexts");
  const evidenceRoot = path.join(rootDir, "activation-evidence");
  const successfulEvidenceRoot = path.join(evidenceRoot, "successful");
  const failedEvidenceRoot = path.join(evidenceRoot, "failed");
  const pointerPath = path.join(rootDir, "active-pointer-v1.json");
  const now = options.now ?? (() => new Date());
  if (!path.isAbsolute(options.rootDir) || !path.isAbsolute(options.finalizedBundleStagingRoot) ||
      !options.expectedRigId.trim() ||
      !options.helperInstanceId.trim() || !options.helperVersion.trim() ||
      !SHA256.test(options.workstationKeyId) ||
      options.workstationPrivateKey.type !== "private" ||
      options.workstationPrivateKey.asymmetricKeyType !== "ec" ||
      options.workstationPrivateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1" ||
      !validHostedAuthorityKeys(options.hostedAuthorityPublicKeys, options.expectedRigId)) {
    fail("AI_GRADER_LOCAL_CALIBRATION_REGISTRY_INVALID", "Local calibration activation registry configuration is invalid.");
  }

  function verifyHostedAuthority(
    value: unknown,
    expectedPhase: "OBSERVATION",
  ): AiGraderCalibrationObservationAuthorityV1;
  function verifyHostedAuthority(
    value: unknown,
    expectedPhase: "PENDING",
    allowExpiredPending?: boolean,
  ): AiGraderCalibrationPendingAuthorityV1;
  function verifyHostedAuthority(
    value: unknown,
    expectedPhase: "ACTIVE",
    allowExpiredActive?: boolean,
  ): AiGraderCalibrationActivationAuthorityV1;
  function verifyHostedAuthority(
    value: unknown,
    expectedPhase: "OBSERVATION" | "PENDING" | "ACTIVE",
    allowExpired = false,
  ): AiGraderCalibrationObservationAuthorityV1 |
    AiGraderCalibrationPendingAuthorityV1 |
    AiGraderCalibrationActivationAuthorityV1 {
    const parsed = expectedPhase === "OBSERVATION"
      ? aiGraderCalibrationObservationAuthorityV1Schema.safeParse(value)
      : expectedPhase === "PENDING"
        ? aiGraderCalibrationPendingAuthorityV1Schema.safeParse(value)
        : aiGraderCalibrationActivationAuthorityV1Schema.safeParse(value);
    if (!parsed.success || parsed.data.authorityPhase !== expectedPhase) {
      return fail(
        "AI_GRADER_LOCAL_CALIBRATION_HOSTED_AUTHORITY_REJECTED",
        "Hosted " + expectedPhase + " calibration authority is unsigned, malformed, or in the wrong phase.",
      );
    }
    const authority = parsed.data;
    if (authority.rigId !== options.expectedRigId) {
      return fail(
        "AI_GRADER_LOCAL_CALIBRATION_HOSTED_AUTHORITY_REJECTED",
        "Hosted calibration authority belongs to a different rig.",
      );
    }
    const key = options.hostedAuthorityPublicKeys.get(authority.hostedAuthorityKeyId);
    if (!key || key.rigId !== options.expectedRigId) {
      return fail(
        "AI_GRADER_LOCAL_CALIBRATION_HOSTED_AUTHORITY_REJECTED",
        "Hosted calibration authority signer is not pinned for this rig.",
      );
    }
    const exactNow = now();
    const issuedAt = new Date(authority.hostedAuthorityIssuedAt);
    const expiresAt = new Date(authority.hostedAuthorityExpiresAt);
    if (!Number.isFinite(exactNow.getTime()) || !Number.isFinite(issuedAt.getTime()) ||
        !Number.isFinite(expiresAt.getTime()) ||
        issuedAt.getTime() > exactNow.getTime() + 30_000 ||
        (expiresAt.getTime() <= exactNow.getTime() && !allowExpired)) {
      return fail(
        "AI_GRADER_LOCAL_CALIBRATION_HOSTED_AUTHORITY_EXPIRED",
        "Hosted calibration authority is expired or outside the accepted clock window.",
      );
    }
    let signatureValid = false;
    try {
      signatureValid = verifyBytes(
        "sha256",
        Buffer.from(canonicalAiGraderCalibrationHostedAuthorityStatementV1(authority), "utf8"),
        { key: key.publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(authority.hostedAuthoritySignature, "base64url"),
      );
    } catch {
      signatureValid = false;
    }
    if (!signatureValid) {
      return fail(
        "AI_GRADER_LOCAL_CALIBRATION_HOSTED_AUTHORITY_REJECTED",
        "Hosted calibration authority signature was rejected.",
      );
    }
    return authority;
  }

  function bundlePath(bundleManifestSha256: string) {
    if (!SHA256.test(bundleManifestSha256)) fail("AI_GRADER_LOCAL_CALIBRATION_HASH_INVALID", "Bundle manifest SHA-256 is invalid.");
    return path.join(bundlesRoot, bundleManifestSha256, FIXED_RIG_MATHEMATICAL_CALIBRATION_BUNDLE_FILE_V1);
  }

  function assertTemporaryPath(candidate: string) {
    const relative = path.relative(rootDir, path.resolve(candidate));
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !path.basename(candidate).startsWith(".import-")) {
      fail("AI_GRADER_LOCAL_CALIBRATION_PATH_REJECTED", "Temporary calibration path escaped the registry root.");
    }
  }

  async function writeAtomic(filePath: string, value: unknown) {
    await mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8", flag: "wx", flush: true, mode: 0o600,
    });
    await rename(tempPath, filePath);
  }

  async function writeImmutable(filePath: string, value: unknown) {
    const serialized = canonicalAiGraderCalibrationJsonV1(value);
    await mkdir(path.dirname(filePath), { recursive: true });
    try {
      await writeFile(filePath, serialized, { encoding: "utf8", flag: "wx", flush: true, mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (await readFile(filePath, "utf8") !== serialized) {
        fail("AI_GRADER_LOCAL_CALIBRATION_IMMUTABLE_CONFLICT", "Immutable activation receipt already exists with different bytes.");
      }
    }
  }

  function verifyBundle(expected: {
    bundleManifestSha256: string;
    memberLedgerSha256: string;
    rigCharacterizationSha256: string;
  }) {
    const loaded = loadFixedRigMathematicalCalibrationBundleV1({
      bundlePath: bundlePath(expected.bundleManifestSha256),
      bundleSha256: expected.bundleManifestSha256,
      expectedRigId: options.expectedRigId,
    });
    if (loaded.authority.memberLedgerSha256 !== expected.memberLedgerSha256 ||
        loaded.profile.artifactSha256 !== expected.rigCharacterizationSha256) {
      fail("AI_GRADER_LOCAL_CALIBRATION_BUNDLE_MISMATCH", "Content-addressed bundle/member/rig-characterization hashes do not match exact activation authority.");
    }
    return loaded;
  }

  function operatingContextPath(activationId: string) {
    if (!activationId.trim() || path.basename(activationId) !== activationId) {
      fail("AI_GRADER_LOCAL_CALIBRATION_PATH_REJECTED", "Activation ID is unsafe for immutable context storage.");
    }
    return path.join(contextsRoot, `${activationId}.json`);
  }

  async function readExpectedOperatingContext(
    activationId: string,
    expectedHash: string,
  ): Promise<AiGraderOperatingContextV1> {
    let value: unknown;
    try {
      value = JSON.parse(await readFile(operatingContextPath(activationId), "utf8"));
    } catch {
      return fail("AI_GRADER_LOCAL_CALIBRATION_CONTEXT_MISSING", "Exact hosted operating context bytes are missing or corrupt.");
    }
    const context = aiGraderOperatingContextV1Schema.parse(value);
    if (sha256(canonicalAiGraderOperatingContextV1(context)) !== expectedHash) {
      return fail("AI_GRADER_LOCAL_CALIBRATION_CONTEXT_MISMATCH", "Stored hosted operating context does not reproduce its exact hash.");
    }
    return context;
  }

  async function liveContext(
    expected: AiGraderOperatingContextV1,
    expectedHash: string,
    expectedRuntimeHash: string,
  ) {
    const observed = aiGraderOperatingContextV1Schema.parse(await options.liveOperatingContext(expected));
    const observedHash = sha256(canonicalAiGraderOperatingContextV1(observed));
    const runtimeHash = sha256(canonicalAiGraderRuntimeContextV1(observed));
    if (observedHash !== expectedHash || runtimeHash !== expectedRuntimeHash || observed.rig.rigId !== options.expectedRigId) {
      fail("AI_GRADER_LOCAL_CALIBRATION_CONTEXT_MISMATCH", "Trusted live operating context does not match the exact activation context/runtime hashes.");
    }
    return { observed, observedHash };
  }

  function observationDirectory(root: string, observationId: string) {
    if (!observationId.trim() || path.basename(observationId) !== observationId) {
      fail("AI_GRADER_LOCAL_CALIBRATION_PATH_REJECTED", "Observation ID is unsafe for activation evidence storage.");
    }
    return path.join(root, observationId);
  }

  function verifyWorkstationSignature(
    observation: AiGraderCalibrationWorkstationObservationV1,
  ) {
    let valid = false;
    try {
      valid = observation.workstationKeyId === options.workstationKeyId && verifyBytes(
        "sha256",
        Buffer.from(aiGraderCalibrationWorkstationObservationStatementV1(observation), "utf8"),
        { key: createPublicKey(options.workstationPrivateKey), dsaEncoding: "ieee-p1363" },
        Buffer.from(observation.signature, "base64url"),
      );
    } catch { valid = false; }
    if (!valid) {
      fail("AI_GRADER_LOCAL_CALIBRATION_OBSERVATION_REJECTED", "Immutable workstation observation signature was rejected.");
    }
  }

  async function readWorkstationObservation(
    observationId: string,
    expectedSha256: string,
  ): Promise<AiGraderCalibrationWorkstationObservationV1> {
    const evidencePath = path.join(
      observationDirectory(successfulEvidenceRoot, observationId),
      "workstation-observation-v1.json",
    );
    let bytes: Buffer;
    try {
      bytes = await readFile(evidencePath);
    } catch {
      return fail("AI_GRADER_LOCAL_CALIBRATION_OBSERVATION_MISSING", "Exact immutable workstation observation is missing.");
    }
    if (sha256(bytes) !== expectedSha256) {
      return fail("AI_GRADER_LOCAL_CALIBRATION_OBSERVATION_REJECTED", "Immutable workstation observation bytes do not match hosted authority.");
    }
    let parsed: unknown;
    try { parsed = JSON.parse(bytes.toString("utf8")); } catch {
      return fail("AI_GRADER_LOCAL_CALIBRATION_OBSERVATION_REJECTED", "Immutable workstation observation is corrupt.");
    }
    const observation = aiGraderCalibrationWorkstationObservationV1Schema.parse(parsed);
    if (canonicalSha(observation) !== expectedSha256 || observation.observationId !== observationId) {
      return fail("AI_GRADER_LOCAL_CALIBRATION_OBSERVATION_REJECTED", "Immutable workstation observation does not reproduce its exact identity.");
    }
    verifyWorkstationSignature(observation);
    const imagePath = path.join(path.dirname(evidencePath), observation.evidenceImageFileName);
    const imageBytes = await readFile(imagePath);
    if (
      sha256(imageBytes) !== observation.evidenceImageSha256 ||
      imageBytes.byteLength !== observation.evidenceImageByteSize
    ) {
      return fail("AI_GRADER_LOCAL_CALIBRATION_OBSERVATION_REJECTED", "Retained activation evidence image is missing or changed.");
    }
    return observation;
  }

  async function observeActivation(value: unknown): Promise<AiGraderCalibrationWorkstationObservationV1> {
    const authority = verifyHostedAuthority(value, "OBSERVATION");
    if (!await options.isIdle()) {
      fail("AI_GRADER_LOCAL_CALIBRATION_NOT_IDLE", "Local helper must be idle before the one activation runtime observation.");
    }
    if (await exists(pointerPath)) {
      fail("AI_GRADER_LOCAL_CALIBRATION_POINTER_CONFLICT", "Runtime observation requires no local activation pointer.");
    }
    const expectedContext = aiGraderOperatingContextV1Schema.parse(authority.operatingContextV1);
    if (
      sha256(canonicalAiGraderOperatingContextV1(expectedContext)) !== authority.operatingContextHash ||
      sha256(canonicalAiGraderRuntimeContextV1(expectedContext)) !== authority.runtimeContextHash
    ) {
      fail("AI_GRADER_LOCAL_CALIBRATION_CONTEXT_MISMATCH", "Hosted observation context does not reproduce its exact hashes.");
    }
    verifyBundle(authority);
    await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
    await mkdir(successfulEvidenceRoot, { recursive: true, mode: 0o700 });
    await mkdir(failedEvidenceRoot, { recursive: true, mode: 0o700 });
    const successfulDir = observationDirectory(successfulEvidenceRoot, authority.observationId);
    const failedDir = observationDirectory(failedEvidenceRoot, authority.observationId);
    const stagingDir = path.join(evidenceRoot, `.observation-${authority.observationId}`);
    if (await exists(successfulDir)) {
      try {
        const storedAuthority = aiGraderCalibrationObservationAuthorityV1Schema.parse(
          JSON.parse(await readFile(
            path.join(successfulDir, "hosted-observation-authority-v1.json"),
            "utf8",
          )),
        );
        const storedObservation = aiGraderCalibrationWorkstationObservationV1Schema.parse(
          JSON.parse(await readFile(
            path.join(successfulDir, "workstation-observation-v1.json"),
            "utf8",
          )),
        );
        if (
          canonicalSha(storedAuthority) !== canonicalSha(authority) ||
          storedObservation.hostedObservationAuthoritySha256 !== canonicalSha(authority)
        ) {
          fail("AI_GRADER_LOCAL_CALIBRATION_IMMUTABLE_CONFLICT", "Existing activation observation evidence belongs to different hosted authority.");
        }
        return await readWorkstationObservation(
          authority.observationId,
          canonicalSha(storedObservation),
        );
      } catch (error) {
        if (error instanceof MathematicalCalibrationActivationRegistryV1Error) throw error;
        fail("AI_GRADER_LOCAL_CALIBRATION_IMMUTABLE_CONFLICT", "Existing activation observation evidence is incomplete or corrupt.");
      }
    }
    if (await exists(failedDir) || await exists(stagingDir)) {
      fail("AI_GRADER_LOCAL_CALIBRATION_IMMUTABLE_CONFLICT", "Activation observation evidence identity already exists; automatic hardware retry is prohibited.");
    }
    await mkdir(stagingDir, { recursive: false, mode: 0o700 });
    const imagePath = path.join(stagingDir, "activation-runtime-evidence.png");
    let imageCreated = false;
    try {
      const result = await options.observeActivationRuntime(expectedContext, stagingDir);
      const runtimeObservation = aiGraderCalibrationRuntimeObservationV1Schema.parse(result.runtimeObservation);
      const observedAt = new Date(result.evidenceImage.observedAt);
      const issuedAt = new Date(authority.hostedAuthorityIssuedAt);
      const expiresAt = new Date(authority.hostedAuthorityExpiresAt);
      if (
        result.evidenceImage.fileName !== "activation-runtime-evidence.png" ||
        result.evidenceImage.mediaType !== "image/png" ||
        !SHA256.test(result.evidenceImage.sha256) ||
        !Number.isSafeInteger(result.evidenceImage.byteSize) ||
        result.evidenceImage.byteSize < 1 ||
        !Number.isFinite(observedAt.getTime()) ||
        observedAt.getTime() < issuedAt.getTime() - 30_000 ||
        observedAt.getTime() > expiresAt.getTime() ||
        runtimeObservation.camera.serial !== expectedContext.camera.serial ||
        runtimeObservation.camera.model !== expectedContext.camera.model ||
        canonicalAiGraderCalibrationJsonV1(runtimeObservation.capture) !==
          canonicalAiGraderCalibrationJsonV1(expectedContext.capture) ||
        canonicalAiGraderCalibrationJsonV1(runtimeObservation.controller.selectedChannels) !==
          canonicalAiGraderCalibrationJsonV1(expectedContext.lighting.selectedChannels) ||
        runtimeObservation.controller.dutyPercent !== expectedContext.lighting.dutyPercent ||
        runtimeObservation.software.helperInstanceId !== options.helperInstanceId ||
        runtimeObservation.software.helperVersion !== options.helperVersion
      ) {
        fail("AI_GRADER_LOCAL_CALIBRATION_OBSERVATION_REJECTED", "Runtime observation did not match the exact hosted context and evidence contract.");
      }
      const imageBytes = await readFile(imagePath);
      imageCreated = true;
      if (
        sha256(imageBytes) !== result.evidenceImage.sha256 ||
        imageBytes.byteLength !== result.evidenceImage.byteSize
      ) {
        fail("AI_GRADER_LOCAL_CALIBRATION_OBSERVATION_REJECTED", "Captured activation evidence image bytes do not match the runtime result.");
      }
      await chmod(imagePath, 0o600);
      const unsigned = {
        schemaVersion: AI_GRADER_CALIBRATION_WORKSTATION_OBSERVATION_V1_SCHEMA_VERSION,
        observationId: authority.observationId,
        hostedObservationAuthoritySha256: canonicalSha(authority),
        registryRevision: authority.registryRevision,
        snapshotId: authority.snapshotId,
        rigId: authority.rigId,
        bundleManifestSha256: authority.bundleManifestSha256,
        memberLedgerSha256: authority.memberLedgerSha256,
        runtimeContextHash: authority.runtimeContextHash,
        rigCharacterizationSha256: authority.rigCharacterizationSha256,
        expectedOperatingContextHash: authority.operatingContextHash,
        observedOperatingContextHash: authority.operatingContextHash,
        runtimeObservation,
        runtimeObservationSha256: canonicalSha(runtimeObservation),
        evidenceImageFileName: "activation-runtime-evidence.png" as const,
        evidenceImageMediaType: "image/png" as const,
        evidenceImageSha256: result.evidenceImage.sha256,
        evidenceImageByteSize: result.evidenceImage.byteSize,
        helperInstanceId: options.helperInstanceId,
        helperVersion: options.helperVersion,
        workstationKeyId: options.workstationKeyId,
        signatureAlgorithm: "ecdsa-p256-sha256-ieee-p1363" as const,
        observedAt: observedAt.toISOString(),
      };
      const signature = signBytes(
        "sha256",
        Buffer.from(canonicalAiGraderCalibrationJsonV1(unsigned), "utf8"),
        { key: options.workstationPrivateKey, dsaEncoding: "ieee-p1363" },
      ).toString("base64url");
      const observation = aiGraderCalibrationWorkstationObservationV1Schema.parse({ ...unsigned, signature });
      await writeImmutable(path.join(stagingDir, "hosted-observation-authority-v1.json"), authority);
      await writeImmutable(path.join(stagingDir, "workstation-observation-v1.json"), observation);
      await rename(stagingDir, successfulDir);
      return observation;
    } catch (error) {
      if (!imageCreated) imageCreated = await exists(imagePath);
      if (imageCreated) {
        try {
          const imageBytes = await readFile(imagePath);
          await chmod(imagePath, 0o600);
          await writeImmutable(path.join(stagingDir, "failed-observation-v1.json"), {
            schemaVersion: "ten-kings-ai-grader-calibration-failed-observation-v1",
            state: "FAILED_BEFORE_ACTIVATION_AUTHORITY",
            observationId: authority.observationId,
            snapshotId: authority.snapshotId,
            rigId: authority.rigId,
            bundleManifestSha256: authority.bundleManifestSha256,
            memberLedgerSha256: authority.memberLedgerSha256,
            runtimeContextHash: authority.runtimeContextHash,
            operatingContextHash: authority.operatingContextHash,
            evidenceImageFileName: "activation-runtime-evidence.png",
            evidenceImageSha256: sha256(imageBytes),
            evidenceImageByteSize: imageBytes.byteLength,
            failureCode: error instanceof MathematicalCalibrationActivationRegistryV1Error
              ? error.code
              : "AI_GRADER_LOCAL_CALIBRATION_OBSERVATION_FAILED",
            failedAt: now().toISOString(),
          });
        } finally {
          await rename(stagingDir, failedDir);
        }
      } else if (await exists(stagingDir)) {
        await rm(stagingDir, { recursive: true, force: false });
      }
      throw error;
    }
  }

  async function readPointer(): Promise<AiGraderCalibrationLocalPointerV1> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(pointerPath, "utf8"));
    } catch {
      return fail("AI_GRADER_LOCAL_CALIBRATION_POINTER_MISSING", "Exact local calibration activation pointer is missing or corrupt.");
    }
    const result = aiGraderCalibrationLocalPointerV1Schema.safeParse(parsed);
    if (!result.success) return fail("AI_GRADER_LOCAL_CALIBRATION_POINTER_CORRUPT", "Exact local calibration activation pointer is invalid.");
    return result.data;
  }

  async function ingestFinalizedBundle(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        Object.keys(value).length !== 1 || !Object.prototype.hasOwnProperty.call(value, "bundleManifestSha256")) {
      fail(
        "AI_GRADER_LOCAL_CALIBRATION_IMPORT_INVALID",
        "Finalized calibration ingestion accepts only one exact bundleManifestSha256; caller paths are prohibited.",
      );
    }
    const bundleManifestSha256 = (value as { bundleManifestSha256?: unknown }).bundleManifestSha256;
    if (typeof bundleManifestSha256 !== "string" || !SHA256.test(bundleManifestSha256)) {
      fail("AI_GRADER_LOCAL_CALIBRATION_IMPORT_INVALID", "Finalized calibration ingestion requires one exact SHA-256.");
    }
    const stagingDir = path.join(finalizedBundleStagingRoot, bundleManifestSha256);
    const handoffPath = path.join(stagingDir, MATHEMATICAL_CALIBRATION_FINALIZER_HANDOFF_FILE_V1);
    let handoffValue: unknown;
    try {
      handoffValue = JSON.parse(await readFile(handoffPath, "utf8"));
    } catch {
      return fail(
        "AI_GRADER_LOCAL_CALIBRATION_FINALIZER_HANDOFF_MISSING",
        "Trusted finalizer handoff is missing or corrupt for the exact bundle hash.",
      );
    }
    if (!handoffValue || typeof handoffValue !== "object" || Array.isArray(handoffValue)) {
      return fail("AI_GRADER_LOCAL_CALIBRATION_FINALIZER_HANDOFF_INVALID", "Trusted finalizer handoff is invalid.");
    }
    const handoff = handoffValue as Record<string, unknown>;
    const hasOperationalAcceptance = handoff.operationalAcceptanceStatus !== undefined;
    const expectedHandoffKeys = [
      "schemaVersion",
      "authority",
      "rigId",
      "profileId",
      "calibrationVersion",
      "finalizedAt",
      "bundleFileName",
      "bundleManifestSha256",
      "sourceAnalysisSha256",
      ...(hasOperationalAcceptance ? [
        "operationalAcceptanceStatus",
        "operationalAcceptanceAuthoritySha256",
        "operationalAcceptanceAuthorityFileSha256",
      ] : []),
    ].sort();
    const actualHandoffKeys = Object.keys(handoff).sort();
    if (actualHandoffKeys.length !== expectedHandoffKeys.length ||
        actualHandoffKeys.some((key, index) => key !== expectedHandoffKeys[index]) ||
        handoff.schemaVersion !== MATHEMATICAL_CALIBRATION_FINALIZER_HANDOFF_V1 ||
        handoff.authority !== "trusted-local-mathematical-calibration-finalizer-v1" ||
        handoff.rigId !== options.expectedRigId ||
        handoff.bundleFileName !== FIXED_RIG_MATHEMATICAL_CALIBRATION_BUNDLE_FILE_V1 ||
        handoff.bundleManifestSha256 !== bundleManifestSha256 ||
        typeof handoff.profileId !== "string" || !handoff.profileId.trim() ||
        typeof handoff.calibrationVersion !== "string" || !handoff.calibrationVersion.trim() ||
         typeof handoff.finalizedAt !== "string" || !Number.isFinite(new Date(handoff.finalizedAt).getTime()) ||
         typeof handoff.sourceAnalysisSha256 !== "string" || !SHA256.test(handoff.sourceAnalysisSha256) ||
         (hasOperationalAcceptance && (
           handoff.operationalAcceptanceStatus !== "OWNER_ACCEPTED_WITH_RECORDED_EXCEPTIONS" ||
           typeof handoff.operationalAcceptanceAuthoritySha256 !== "string" ||
           !SHA256.test(handoff.operationalAcceptanceAuthoritySha256) ||
           typeof handoff.operationalAcceptanceAuthorityFileSha256 !== "string" ||
           !SHA256.test(handoff.operationalAcceptanceAuthorityFileSha256)
         ))) {
      return fail(
        "AI_GRADER_LOCAL_CALIBRATION_FINALIZER_HANDOFF_INVALID",
        "Trusted finalizer handoff does not match the exact rig, bundle, and immutable finalizer contract.",
      );
    }
    const input = {
      sourceBundlePath: path.join(stagingDir, FIXED_RIG_MATHEMATICAL_CALIBRATION_BUNDLE_FILE_V1),
      bundleManifestSha256,
    };
    const source = loadFixedRigMathematicalCalibrationBundleV1({
      bundlePath: input.sourceBundlePath,
      bundleSha256: input.bundleManifestSha256,
      expectedRigId: options.expectedRigId,
    });
    if (source.profile.profileId !== handoff.profileId ||
         source.profile.calibrationVersion !== handoff.calibrationVersion ||
         source.profile.finalizedAt !== handoff.finalizedAt ||
         (hasOperationalAcceptance
           ? !source.operationalAcceptance ||
             source.operationalAcceptance.authorityStatus !== handoff.operationalAcceptanceStatus ||
             source.operationalAcceptance.authoritySha256 !== handoff.operationalAcceptanceAuthoritySha256 ||
             source.files.operationalAcceptance?.sha256 !== handoff.operationalAcceptanceAuthorityFileSha256
           : source.operationalAcceptance !== undefined)) {
      fail(
        "AI_GRADER_LOCAL_CALIBRATION_FINALIZER_HANDOFF_INVALID",
        "Finalized bundle profile identity does not match the trusted finalizer handoff.",
      );
    }
    const finalManifestPath = bundlePath(input.bundleManifestSha256);
    if (await exists(finalManifestPath)) {
      const existing = verifyBundle({
        bundleManifestSha256: input.bundleManifestSha256,
        memberLedgerSha256: source.authority.memberLedgerSha256,
        rigCharacterizationSha256: source.profile.artifactSha256,
      });
      return { bundlePath: existing.bundlePath, authority: existing.authority };
    }
    await mkdir(bundlesRoot, { recursive: true });
    const temporaryDir = path.join(bundlesRoot, `.import-${input.bundleManifestSha256}-${randomUUID()}`);
    assertTemporaryPath(temporaryDir);
    await mkdir(temporaryDir, { recursive: false });
    try {
      await copyFile(source.bundlePath, path.join(temporaryDir, FIXED_RIG_MATHEMATICAL_CALIBRATION_BUNDLE_FILE_V1), fsConstants.COPYFILE_EXCL);
      for (const member of source.authority.members) {
        await copyFile(path.join(path.dirname(source.bundlePath), member.fileName), path.join(temporaryDir, member.fileName), fsConstants.COPYFILE_EXCL);
      }
      loadFixedRigMathematicalCalibrationBundleV1({
        bundlePath: path.join(temporaryDir, FIXED_RIG_MATHEMATICAL_CALIBRATION_BUNDLE_FILE_V1),
        bundleSha256: input.bundleManifestSha256,
        expectedRigId: options.expectedRigId,
      });
      try {
        await rename(temporaryDir, path.dirname(finalManifestPath));
      } catch (error) {
        if (!await exists(finalManifestPath)) throw error;
        assertTemporaryPath(temporaryDir);
        await rm(temporaryDir, { recursive: true, force: true });
      }
    } catch (error) {
      if (await exists(temporaryDir)) {
        assertTemporaryPath(temporaryDir);
        await rm(temporaryDir, { recursive: true, force: true });
      }
      throw error;
    }
    const stored = verifyBundle({
      bundleManifestSha256: input.bundleManifestSha256,
      memberLedgerSha256: source.authority.memberLedgerSha256,
      rigCharacterizationSha256: source.profile.artifactSha256,
    });
    return { bundlePath: stored.bundlePath, authority: stored.authority };
  }

  async function prepareActivation(value: unknown): Promise<AiGraderCalibrationWorkstationReceiptV1> {
    const pending = verifyHostedAuthority(value, "PENDING");
    const exactNow = now();
    if (!Number.isFinite(exactNow.getTime()) || exactNow.getTime() >= new Date(pending.pendingExpiresAt).getTime()) {
      fail("AI_GRADER_LOCAL_CALIBRATION_PENDING_EXPIRED", "Pending activation is expired.");
    }
    if (!await options.isIdle()) fail("AI_GRADER_LOCAL_CALIBRATION_NOT_IDLE", "Local helper must be idle before activation verification.");
    if (await exists(pointerPath)) {
      const current = await readPointer();
      if (
        current.state === "PENDING" &&
        current.activationId === pending.activationId &&
        current.activationHash === pending.activationHash &&
        current.activationRevision === pending.activationRevision &&
        current.observationId === pending.observationId &&
        current.workstationObservationSha256 === pending.workstationObservationSha256
      ) {
        const receiptBytes = await readFile(path.join(receiptsRoot, `${pending.activationId}.json`));
        if (sha256(receiptBytes) !== current.workstationReceiptSha256) {
          fail("AI_GRADER_LOCAL_CALIBRATION_RECEIPT_MISMATCH", "Idempotent local preparation found a changed receipt.");
        }
        return aiGraderCalibrationWorkstationReceiptV1Schema.parse(JSON.parse(receiptBytes.toString("utf8")));
      }
      fail("AI_GRADER_LOCAL_CALIBRATION_POINTER_CONFLICT", "A different local activation pointer already exists.");
    }
    const expectedContext = aiGraderOperatingContextV1Schema.parse(pending.operatingContextV1);
    const expectedContextHash = sha256(canonicalAiGraderOperatingContextV1(expectedContext));
    if (expectedContextHash !== pending.operatingContextHash) {
      fail("AI_GRADER_LOCAL_CALIBRATION_CONTEXT_MISMATCH", "Hosted pending operating context does not reproduce its exact hash.");
    }
    verifyBundle(pending);
    const observation = await readWorkstationObservation(
      pending.observationId,
      pending.workstationObservationSha256,
    );
    if (
      observation.snapshotId !== pending.snapshotId ||
      observation.rigId !== pending.rigId ||
      observation.bundleManifestSha256 !== pending.bundleManifestSha256 ||
      observation.memberLedgerSha256 !== pending.memberLedgerSha256 ||
      observation.runtimeContextHash !== pending.runtimeContextHash ||
      observation.rigCharacterizationSha256 !== pending.rigCharacterizationSha256 ||
      observation.expectedOperatingContextHash !== pending.operatingContextHash ||
      observation.observedOperatingContextHash !== pending.operatingContextHash
    ) {
      fail("AI_GRADER_LOCAL_CALIBRATION_OBSERVATION_REJECTED", "Pending authority does not match the exact immutable workstation observation.");
    }
    const receiptPath = path.join(receiptsRoot, `${pending.activationId}.json`);
    let receipt: AiGraderCalibrationWorkstationReceiptV1;
    if (await exists(receiptPath)) {
      const parsed = aiGraderCalibrationWorkstationReceiptV1Schema.safeParse(
        JSON.parse(await readFile(receiptPath, "utf8")),
      );
      if (!parsed.success) {
        fail("AI_GRADER_LOCAL_CALIBRATION_RECEIPT_MISMATCH", "Existing immutable workstation receipt is corrupt.");
      }
      receipt = parsed.data;
      let receiptSignatureValid = false;
      try {
        receiptSignatureValid = verifyBytes(
          "sha256",
          Buffer.from(aiGraderCalibrationWorkstationReceiptStatementV1(receipt), "utf8"),
          { key: createPublicKey(options.workstationPrivateKey), dsaEncoding: "ieee-p1363" },
          Buffer.from(receipt.signature, "base64url"),
        );
      } catch { receiptSignatureValid = false; }
      const exactReceiptFields = {
        activationId: pending.activationId,
        activationHash: pending.activationHash,
        activationRevision: pending.activationRevision,
        snapshotId: pending.snapshotId,
        rigId: pending.rigId,
        bundleManifestSha256: pending.bundleManifestSha256,
        memberLedgerSha256: pending.memberLedgerSha256,
        runtimeContextHash: pending.runtimeContextHash,
        rigCharacterizationSha256: pending.rigCharacterizationSha256,
        expectedOperatingContextHash: pending.operatingContextHash,
        observedOperatingContextHash: observation.observedOperatingContextHash,
        observationId: observation.observationId,
        workstationObservationSha256: pending.workstationObservationSha256,
        runtimeObservationSha256: observation.runtimeObservationSha256,
        evidenceImageSha256: observation.evidenceImageSha256,
        helperInstanceId: options.helperInstanceId,
        helperVersion: options.helperVersion,
        workstationKeyId: options.workstationKeyId,
        expiresAt: pending.pendingExpiresAt,
      };
      if (
        !receiptSignatureValid ||
        Object.entries(exactReceiptFields).some(
          ([key, expected]) => receipt[key as keyof AiGraderCalibrationWorkstationReceiptV1] !== expected,
        )
      ) {
        fail("AI_GRADER_LOCAL_CALIBRATION_RECEIPT_MISMATCH", "Existing immutable workstation receipt does not match the exact pending authority and observation.");
      }
    } else {
      const unsigned = {
        schemaVersion: AI_GRADER_CALIBRATION_WORKSTATION_RECEIPT_V1_SCHEMA_VERSION,
        activationId: pending.activationId,
        activationHash: pending.activationHash,
        activationRevision: pending.activationRevision,
        snapshotId: pending.snapshotId,
        rigId: pending.rigId,
        bundleManifestSha256: pending.bundleManifestSha256,
        memberLedgerSha256: pending.memberLedgerSha256,
        runtimeContextHash: pending.runtimeContextHash,
        rigCharacterizationSha256: pending.rigCharacterizationSha256,
        expectedOperatingContextHash: pending.operatingContextHash,
        observedOperatingContextHash: observation.observedOperatingContextHash,
        observationId: observation.observationId,
        workstationObservationSha256: pending.workstationObservationSha256,
        runtimeObservationSha256: observation.runtimeObservationSha256,
        evidenceImageSha256: observation.evidenceImageSha256,
        helperInstanceId: options.helperInstanceId,
        helperVersion: options.helperVersion,
        workstationKeyId: options.workstationKeyId,
        signatureAlgorithm: "ecdsa-p256-sha256-ieee-p1363" as const,
        verifiedAt: exactNow.toISOString(),
        expiresAt: pending.pendingExpiresAt,
      };
      const signature = signBytes(
        "sha256",
        Buffer.from(canonicalAiGraderCalibrationJsonV1(unsigned), "utf8"),
        { key: options.workstationPrivateKey, dsaEncoding: "ieee-p1363" },
      ).toString("base64url");
      receipt = aiGraderCalibrationWorkstationReceiptV1Schema.parse({ ...unsigned, signature });
    }
    await writeImmutable(operatingContextPath(pending.activationId), expectedContext);
    await writeImmutable(receiptPath, receipt);
    const receiptSha256 = canonicalSha(receipt);
    const pendingPointer: AiGraderCalibrationLocalPointerV1 = {
      schemaVersion: AI_GRADER_CALIBRATION_LOCAL_POINTER_V1_SCHEMA_VERSION,
      state: "PENDING",
      activationId: pending.activationId,
      activationHash: pending.activationHash,
      activationRevision: pending.activationRevision,
      snapshotId: pending.snapshotId,
      rigId: pending.rigId,
      bundleManifestSha256: pending.bundleManifestSha256,
      memberLedgerSha256: pending.memberLedgerSha256,
      runtimeContextHash: pending.runtimeContextHash,
      rigCharacterizationSha256: pending.rigCharacterizationSha256,
      operatingContextHash: pending.operatingContextHash,
      observationId: pending.observationId,
      workstationObservationSha256: pending.workstationObservationSha256,
      workstationReceiptSha256: receiptSha256,
      pendingExpiresAt: pending.pendingExpiresAt,
      writtenAt: exactNow.toISOString(),
    };
    await writeAtomic(pointerPath, aiGraderCalibrationLocalPointerV1Schema.parse(pendingPointer));
    return receipt;
  }

  async function confirmHostedActivation(value: unknown) {
    // ACTIVE expiry limits authorization to start a new card. It does not make an
    // exact hosted/local recovery unsafe: confirmation still requires the signed
    // authority to match the immutable receipt, observation, and PENDING pointer.
    const authority = verifyHostedAuthority(value, "ACTIVE", true);
    const pointer = await readPointer();
    if (pointer.state === "ACTIVE") {
      const exactActiveFields: (keyof AiGraderCalibrationActivationAuthorityV1)[] = [
        "activationId", "activationHash", "activationRevision", "snapshotId", "rigId",
        "bundleManifestSha256", "memberLedgerSha256", "runtimeContextHash",
        "rigCharacterizationSha256", "operatingContextHash", "observationId",
        "workstationObservationSha256", "workstationReceiptSha256", "activatedAt",
      ];
      if (exactActiveFields.some((field) => pointer[field as keyof typeof pointer] !== authority[field])) {
        fail("AI_GRADER_LOCAL_CALIBRATION_HOSTED_MISMATCH", "Existing local ACTIVE pointer does not match hosted ACTIVE authority.");
      }
      return pointer;
    }
    if (pointer.state !== "PENDING" || pointer.activationId !== authority.activationId ||
        pointer.activationHash !== authority.activationHash || pointer.snapshotId !== authority.snapshotId ||
        pointer.rigId !== authority.rigId || pointer.bundleManifestSha256 !== authority.bundleManifestSha256 ||
        pointer.memberLedgerSha256 !== authority.memberLedgerSha256 || pointer.runtimeContextHash !== authority.runtimeContextHash ||
        pointer.rigCharacterizationSha256 !== authority.rigCharacterizationSha256 ||
        pointer.operatingContextHash !== authority.operatingContextHash ||
        pointer.observationId !== authority.observationId ||
        pointer.workstationObservationSha256 !== authority.workstationObservationSha256 ||
        pointer.workstationReceiptSha256 !== authority.workstationReceiptSha256) {
      fail("AI_GRADER_LOCAL_CALIBRATION_HOSTED_MISMATCH", "Hosted ACTIVE authority does not match the exact local pending pointer.");
    }
    const receiptBytes = await readFile(path.join(receiptsRoot, `${authority.activationId}.json`));
    if (sha256(receiptBytes) !== authority.workstationReceiptSha256) {
      fail("AI_GRADER_LOCAL_CALIBRATION_RECEIPT_MISMATCH", "Hosted ACTIVE receipt hash does not match exact immutable local receipt bytes.");
    }
    verifyBundle(authority);
    await readExpectedOperatingContext(
      authority.activationId,
      authority.operatingContextHash,
    );
    await readWorkstationObservation(authority.observationId, authority.workstationObservationSha256);
    const activePointer: AiGraderCalibrationLocalPointerV1 = {
      ...pointer,
      state: "ACTIVE",
      activationRevision: authority.activationRevision,
      workstationReceiptSha256: authority.workstationReceiptSha256,
      activatedAt: authority.activatedAt,
      pendingExpiresAt: undefined,
      writtenAt: now().toISOString(),
    };
    await writeAtomic(pointerPath, aiGraderCalibrationLocalPointerV1Schema.parse(activePointer));
    return activePointer;
  }

  async function abortPendingActivation(value: unknown) {
    // A hosted failure can be recorded at the pending-expiry boundary. The exact
    // signed PENDING authority remains sufficient to remove only its matching
    // local pointer; expiry must not strand that pointer indefinitely.
    const pending = verifyHostedAuthority(value, "PENDING", true);
    if (!await exists(pointerPath)) return { aborted: false };
    const pointer = await readPointer();
    if (
      pointer.state !== "PENDING" ||
      pointer.activationId !== pending.activationId ||
      pointer.activationHash !== pending.activationHash ||
      pointer.activationRevision !== pending.activationRevision ||
      pointer.observationId !== pending.observationId ||
      pointer.workstationObservationSha256 !== pending.workstationObservationSha256
    ) {
      fail("AI_GRADER_LOCAL_CALIBRATION_POINTER_CONFLICT", "Local pending pointer does not match the exact hosted failure authority.");
    }
    const failedPointersRoot = path.join(rootDir, "failed-pointers");
    await mkdir(failedPointersRoot, { recursive: true, mode: 0o700 });
    const archivedPointerPath = path.join(failedPointersRoot, `${pending.activationId}.json`);
    if (await exists(archivedPointerPath)) {
      fail("AI_GRADER_LOCAL_CALIBRATION_IMMUTABLE_CONFLICT", "Failed local pointer archive already exists.");
    }
    await rename(pointerPath, archivedPointerPath);
    await chmod(archivedPointerPath, 0o600);
    return { aborted: true };
  }

  async function assertActiveAuthority(value: unknown, allowExpiredActive: boolean) {
    const hosted = verifyHostedAuthority(value, "ACTIVE", allowExpiredActive);
    const pointer = await readPointer();
    const exactFields: (keyof AiGraderCalibrationActivationAuthorityV1)[] = [
      "activationId", "activationHash", "activationRevision", "snapshotId", "rigId",
      "bundleManifestSha256", "memberLedgerSha256", "runtimeContextHash",
      "rigCharacterizationSha256", "operatingContextHash", "observationId",
      "workstationObservationSha256", "workstationReceiptSha256", "activatedAt",
    ];
    if (pointer.state !== "ACTIVE" || exactFields.some((field) => pointer[field as keyof typeof pointer] !== hosted[field])) {
      fail("AI_GRADER_LOCAL_CALIBRATION_AUTHORITY_MISMATCH", "Start New Card requires exact local/hosted ACTIVE activation agreement.");
    }
    const receiptPath = path.join(receiptsRoot, `${hosted.activationId}.json`);
    const receiptBytes = await readFile(receiptPath);
    if (sha256(receiptBytes) !== hosted.workstationReceiptSha256) {
      fail("AI_GRADER_LOCAL_CALIBRATION_RECEIPT_MISMATCH", "Start New Card exact activation receipt is missing, corrupt, or mismatched.");
    }
    aiGraderCalibrationWorkstationReceiptV1Schema.parse(JSON.parse(receiptBytes.toString("utf8")));
    const loaded = verifyBundle(hosted);
    const expectedContext = await readExpectedOperatingContext(
      hosted.activationId,
      hosted.operatingContextHash,
    );
    await liveContext(expectedContext, hosted.operatingContextHash, hosted.runtimeContextHash);
    return { authority: hosted, bundlePath: loaded.bundlePath, receiptPath };
  }

  function assertStartAuthority(value: unknown) {
    return assertActiveAuthority(value, false);
  }

  function assertBoundSessionAuthority(value: unknown) {
    return assertActiveAuthority(value, true);
  }

  return {
    ingestFinalizedBundle,
    observeActivation,
    prepareActivation,
    confirmHostedActivation,
    abortPendingActivation,
    assertStartAuthority,
    assertBoundSessionAuthority,
    readPointer,
    paths: {
      rootDir,
      finalizedBundleStagingRoot,
      bundlesRoot,
      receiptsRoot,
      contextsRoot,
      evidenceRoot,
      successfulEvidenceRoot,
      failedEvidenceRoot,
      pointerPath,
    },
  };
}
