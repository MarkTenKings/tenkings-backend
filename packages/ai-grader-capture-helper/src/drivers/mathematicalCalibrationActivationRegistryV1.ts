import { constants as fsConstants } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
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
  AI_GRADER_CALIBRATION_WORKSTATION_RECEIPT_V1_SCHEMA_VERSION,
  aiGraderCalibrationActivationAuthorityV1Schema,
  aiGraderCalibrationLocalPointerV1Schema,
  aiGraderCalibrationPendingAuthorityV1Schema,
  aiGraderCalibrationWorkstationReceiptStatementV1,
  aiGraderCalibrationWorkstationReceiptV1Schema,
  aiGraderOperatingContextV1Schema,
  canonicalAiGraderCalibrationJsonV1,
  canonicalAiGraderCalibrationHostedAuthorityStatementV1,
  canonicalAiGraderOperatingContextV1,
  canonicalAiGraderRuntimeContextV1,
  type AiGraderCalibrationActivationAuthorityV1,
  type AiGraderCalibrationLocalPointerV1,
  type AiGraderCalibrationPendingAuthorityV1,
  type AiGraderCalibrationWorkstationReceiptV1,
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
    expectedPhase: "PENDING",
  ): AiGraderCalibrationPendingAuthorityV1;
  function verifyHostedAuthority(
    value: unknown,
    expectedPhase: "ACTIVE",
    allowExpiredActive?: boolean,
  ): AiGraderCalibrationActivationAuthorityV1;
  function verifyHostedAuthority(
    value: unknown,
    expectedPhase: "PENDING" | "ACTIVE",
    allowExpiredActive = false,
  ): AiGraderCalibrationPendingAuthorityV1 | AiGraderCalibrationActivationAuthorityV1 {
    const parsed = expectedPhase === "PENDING"
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
        (expiresAt.getTime() <= exactNow.getTime() &&
          !(expectedPhase === "ACTIVE" && allowExpiredActive))) {
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
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx", flush: true });
    await rename(tempPath, filePath);
  }

  async function writeImmutable(filePath: string, value: unknown) {
    const serialized = canonicalAiGraderCalibrationJsonV1(value);
    await mkdir(path.dirname(filePath), { recursive: true });
    try {
      await writeFile(filePath, serialized, { encoding: "utf8", flag: "wx", flush: true });
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
        typeof handoff.sourceAnalysisSha256 !== "string" || !SHA256.test(handoff.sourceAnalysisSha256)) {
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
        source.profile.finalizedAt !== handoff.finalizedAt) {
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
      if (current.activationId === pending.activationId) {
        fail(
          "AI_GRADER_LOCAL_CALIBRATION_HOSTED_AUTHORITY_REPLAYED",
          "A hosted pending authority for an activation already seen locally cannot be replayed.",
        );
      }
    }
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
      pendingExpiresAt: pending.pendingExpiresAt,
      writtenAt: exactNow.toISOString(),
    };
    await writeAtomic(pointerPath, aiGraderCalibrationLocalPointerV1Schema.parse(pendingPointer));
    const expectedContext = aiGraderOperatingContextV1Schema.parse(pending.operatingContextV1);
    const expectedContextHash = sha256(canonicalAiGraderOperatingContextV1(expectedContext));
    if (expectedContextHash !== pending.operatingContextHash) {
      fail("AI_GRADER_LOCAL_CALIBRATION_CONTEXT_MISMATCH", "Hosted pending operating context does not reproduce its exact hash.");
    }
    await writeImmutable(operatingContextPath(pending.activationId), expectedContext);
    verifyBundle(pending);
    const { observedHash } = await liveContext(
      expectedContext,
      pending.operatingContextHash,
      pending.runtimeContextHash,
    );
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
      observedOperatingContextHash: observedHash,
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
    const receipt = aiGraderCalibrationWorkstationReceiptV1Schema.parse({ ...unsigned, signature });
    await writeImmutable(path.join(receiptsRoot, `${pending.activationId}.json`), receipt);
    return receipt;
  }

  async function confirmHostedActivation(value: unknown) {
    const authority = verifyHostedAuthority(value, "ACTIVE");
    const pointer = await readPointer();
    if (pointer.state !== "PENDING" || pointer.activationId !== authority.activationId ||
        pointer.activationHash !== authority.activationHash || pointer.snapshotId !== authority.snapshotId ||
        pointer.rigId !== authority.rigId || pointer.bundleManifestSha256 !== authority.bundleManifestSha256 ||
        pointer.memberLedgerSha256 !== authority.memberLedgerSha256 || pointer.runtimeContextHash !== authority.runtimeContextHash ||
        pointer.rigCharacterizationSha256 !== authority.rigCharacterizationSha256 ||
        pointer.operatingContextHash !== authority.operatingContextHash) {
      fail("AI_GRADER_LOCAL_CALIBRATION_HOSTED_MISMATCH", "Hosted ACTIVE authority does not match the exact local pending pointer.");
    }
    const receiptBytes = await readFile(path.join(receiptsRoot, `${authority.activationId}.json`));
    if (sha256(receiptBytes) !== authority.workstationReceiptSha256) {
      fail("AI_GRADER_LOCAL_CALIBRATION_RECEIPT_MISMATCH", "Hosted ACTIVE receipt hash does not match exact immutable local receipt bytes.");
    }
    verifyBundle(authority);
    const expectedContext = await readExpectedOperatingContext(
      authority.activationId,
      authority.operatingContextHash,
    );
    await liveContext(expectedContext, authority.operatingContextHash, authority.runtimeContextHash);
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

  async function assertActiveAuthority(value: unknown, allowExpiredActive: boolean) {
    const hosted = verifyHostedAuthority(value, "ACTIVE", allowExpiredActive);
    const pointer = await readPointer();
    const exactFields: (keyof AiGraderCalibrationActivationAuthorityV1)[] = [
      "activationId", "activationHash", "activationRevision", "snapshotId", "rigId",
      "bundleManifestSha256", "memberLedgerSha256", "runtimeContextHash",
      "rigCharacterizationSha256", "operatingContextHash", "workstationReceiptSha256", "activatedAt",
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
    prepareActivation,
    confirmHostedActivation,
    assertStartAuthority,
    assertBoundSessionAuthority,
    readPointer,
    paths: { rootDir, finalizedBundleStagingRoot, bundlesRoot, receiptsRoot, contextsRoot, pointerPath },
  };
}
