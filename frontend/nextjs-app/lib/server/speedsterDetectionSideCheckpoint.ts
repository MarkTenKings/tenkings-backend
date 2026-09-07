import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Prisma } from "@prisma/client";

import type { SpeedsterCardSide } from "../ai-grader-v2/contracts";
import type { SpeedsterInstrumentationEvent } from "./aiGraderV2Instrumentation";

const SHA256 = /^[a-f0-9]{64}$/;
const OPERATION_ID = /^[a-f0-9]{24}$/;
const REQUEST_ID = /^[A-Za-z0-9:_-]{20,220}$/;

export const SPEEDSTER_DETECTION_SIDE_CHECKPOINT_VERSION =
  "speedster-detection-side-checkpoint-v1" as const;
export const SPEEDSTER_DETECTION_SIDE_RECEIPT_VERSION =
  "speedster-detection-side-receipt-v1" as const;
export const SPEEDSTER_DETECTOR_IDENTITY_VERSION =
  "speedster-detector-identity-v1" as const;

export type SpeedsterDetectorIdentityV1 = Readonly<{
  version: typeof SPEEDSTER_DETECTOR_IDENTITY_VERSION;
  detectorVersion: string;
  source: Readonly<{
    repository: string;
    commitSha: string;
    treeSha: string;
  }>;
  runtime: Readonly<{
    ociDigest: string;
    ociDigestProvenance: "DEPLOYMENT_INJECTED";
    ociImageReference: string;
    buildId: string;
    buildIdentityProvenance: "OCI_IMAGE_ENV";
    platform: string;
    pythonVersion: string;
    frameworkVersion: string;
    torchVersion: string;
    cudaVersion: string;
    cudnnVersion: string;
    accelerator: string;
    gpuName: string;
    gpuCapability: string;
    gpuCount: number;
  }>;
  model: Readonly<{
    name: string;
    repository: string;
    revision: string;
    checkpointSha256: string;
    sourceCommitSha: string;
  }>;
  policy: Readonly<{
    detectorVersion: string;
    promptVersion: string;
    fusionVersion: string;
    measurementVersion: string;
    memoryVersion: string;
  }>;
  determinism: Readonly<{
    deterministicAlgorithms: boolean;
    cudnnDeterministic: boolean;
    cudnnBenchmark: boolean;
    allowTf32: boolean;
    evalMode: boolean;
    compile: boolean;
    autocastDtype: string;
  }>;
}>;

export type SpeedsterDetectionAssetBinding = Readonly<{
  role: "SOURCE_ORIGINAL" | "RECTIFIED" | "INSPECTION" | "NORMALIZED" | "MICRO_DEFECT" | "DIRECTIONAL";
  storageKey: string;
  sha256: string;
}>;

export type SpeedsterDetectionSideBinding = Readonly<{
  side: SpeedsterCardSide;
  assets: readonly SpeedsterDetectionAssetBinding[];
  bindingSha256: string;
}>;

export type SpeedsterDetectionSideCheckpoint = Readonly<{
  version: typeof SPEEDSTER_DETECTION_SIDE_CHECKPOINT_VERSION;
  sessionId: string;
  createdByUserId: string;
  sessionRevision: string;
  operationId: string;
  captureBindingSha256: string;
  side: SpeedsterCardSide;
  sideBinding: SpeedsterDetectionSideBinding;
  memorySnapshot: unknown;
  memorySnapshotSha256: string;
  detectorVersion: string;
  detectorIdentity: SpeedsterDetectorIdentityV1 | null;
  detectorIdentitySha256: string | null;
  requestTraceId: string;
  result: unknown;
  resultSha256: string;
  receipt: Readonly<{
    version: typeof SPEEDSTER_DETECTION_SIDE_RECEIPT_VERSION;
    keyId: string;
    hmacSha256: string;
  }>;
  createdAt: string;
}>;

export type UnsignedSpeedsterDetectionSideCheckpoint = Omit<SpeedsterDetectionSideCheckpoint, "receipt">;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function speedsterDetectionCanonicalJson(value: unknown): string {
  if (value === undefined) throw new Error("Undefined values cannot enter Speedster detection authority.");
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("Speedster detection authority is not JSON-serializable.");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(speedsterDetectionCanonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, nested]) => nested !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${speedsterDetectionCanonicalJson(nested)}`)
    .join(",")}}`;
}

export function speedsterDetectionSha256(value: unknown): string {
  return createHash("sha256").update(speedsterDetectionCanonicalJson(value)).digest("hex");
}

export function speedsterDetectionOperationId(input: Readonly<{
  sessionId: string;
  sessionRevision: string;
  captureBindingSha256: string;
}>): string {
  return speedsterDetectionSha256({
    version: SPEEDSTER_DETECTION_SIDE_CHECKPOINT_VERSION,
    sessionId: input.sessionId,
    sessionRevision: input.sessionRevision,
    captureBindingSha256: input.captureBindingSha256,
  }).slice(0, 24);
}

function receiptPreimage(value: UnsignedSpeedsterDetectionSideCheckpoint) {
  return speedsterDetectionCanonicalJson(value);
}

export function sealSpeedsterDetectionSideCheckpoint(
  value: UnsignedSpeedsterDetectionSideCheckpoint,
  authority: Readonly<{ keyId: string; secret: string }>,
): SpeedsterDetectionSideCheckpoint {
  const keyId = authority.keyId.trim();
  const secret = authority.secret.trim();
  if (!keyId || keyId.length > 80 || secret.length < 32) {
    throw new Error("Speedster detection side receipt authority is unavailable.");
  }
  const hmacSha256 = createHmac("sha256", secret).update(receiptPreimage(value)).digest("hex");
  return {
    ...value,
    receipt: {
      version: SPEEDSTER_DETECTION_SIDE_RECEIPT_VERSION,
      keyId,
      hmacSha256,
    },
  };
}

function parseAsset(value: unknown): SpeedsterDetectionAssetBinding {
  const candidate = record(value);
  const roles = new Set([
    "SOURCE_ORIGINAL",
    "RECTIFIED",
    "INSPECTION",
    "NORMALIZED",
    "MICRO_DEFECT",
    "DIRECTIONAL",
  ]);
  if (!candidate || !roles.has(String(candidate.role))
    || typeof candidate.storageKey !== "string" || !candidate.storageKey
    || typeof candidate.sha256 !== "string" || !SHA256.test(candidate.sha256)) {
    throw new Error("Speedster detection asset binding is malformed.");
  }
  return candidate as unknown as SpeedsterDetectionAssetBinding;
}

export function parseSpeedsterDetectorIdentityV1(value: unknown): SpeedsterDetectorIdentityV1 {
  const candidate = record(value);
  const source = record(candidate?.source);
  const runtime = record(candidate?.runtime);
  const model = record(candidate?.model);
  const policy = record(candidate?.policy);
  const determinism = record(candidate?.determinism);
  const text = (entry: unknown, maximum = 180) => (
    typeof entry === "string" && entry.trim() && entry.length <= maximum ? entry : null
  );
  if (
    !candidate || candidate.version !== SPEEDSTER_DETECTOR_IDENTITY_VERSION
    || !text(candidate.detectorVersion)
    || !text(source?.repository)
    || !text(source?.commitSha) || !/^[a-f0-9]{40}$/.test(String(source?.commitSha))
    || !text(source?.treeSha) || !/^[a-f0-9]{40}$/.test(String(source?.treeSha))
    || !text(runtime?.ociDigest) || !/^sha256:[a-f0-9]{64}$/.test(String(runtime?.ociDigest))
    || runtime?.ociDigestProvenance !== "DEPLOYMENT_INJECTED"
    || !text(runtime?.ociImageReference) || !text(runtime?.buildId)
    || runtime?.buildIdentityProvenance !== "OCI_IMAGE_ENV"
    || !text(runtime?.platform) || !text(runtime?.pythonVersion)
    || !text(runtime?.frameworkVersion) || !text(runtime?.torchVersion)
    || !text(runtime?.cudaVersion) || !text(runtime?.cudnnVersion)
    || !text(runtime?.accelerator) || !text(runtime?.gpuName)
    || !text(runtime?.gpuCapability)
    || !Number.isSafeInteger(runtime?.gpuCount) || Number(runtime?.gpuCount) < 1
    || !text(model?.name) || !text(model?.repository) || !text(model?.revision)
    || !text(model?.checkpointSha256) || !SHA256.test(String(model?.checkpointSha256))
    || !text(model?.sourceCommitSha) || !/^[a-f0-9]{40}$/.test(String(model?.sourceCommitSha))
    || !text(policy?.detectorVersion) || !text(policy?.promptVersion)
    || !text(policy?.fusionVersion) || !text(policy?.measurementVersion)
    || !text(policy?.memoryVersion)
    || typeof determinism?.deterministicAlgorithms !== "boolean"
    || typeof determinism?.cudnnDeterministic !== "boolean"
    || typeof determinism?.cudnnBenchmark !== "boolean"
    || typeof determinism?.allowTf32 !== "boolean"
    || typeof determinism?.evalMode !== "boolean"
    || typeof determinism?.compile !== "boolean"
    || !text(determinism?.autocastDtype)
  ) {
    throw new Error("Speedster detector identity is malformed or incomplete.");
  }
  return candidate as unknown as SpeedsterDetectorIdentityV1;
}

export function parseSpeedsterDetectionSideCheckpoint(
  value: unknown,
  secretForKeyId: (keyId: string) => string | null,
): SpeedsterDetectionSideCheckpoint {
  const candidate = record(value);
  const sideBinding = record(candidate?.sideBinding);
  const receipt = record(candidate?.receipt);
  const detectorIdentity = candidate?.detectorIdentity === null
    ? null
    : parseSpeedsterDetectorIdentityV1(candidate?.detectorIdentity);
  const side = candidate?.side === "FRONT" || candidate?.side === "BACK" ? candidate.side : null;
  const assets = Array.isArray(sideBinding?.assets) ? sideBinding.assets.map(parseAsset) : [];
  if (
    !candidate || candidate.version !== SPEEDSTER_DETECTION_SIDE_CHECKPOINT_VERSION
    || typeof candidate.sessionId !== "string" || !candidate.sessionId
    || typeof candidate.createdByUserId !== "string" || !candidate.createdByUserId
    || typeof candidate.sessionRevision !== "string" || !Number.isFinite(Date.parse(candidate.sessionRevision))
    || typeof candidate.operationId !== "string" || !OPERATION_ID.test(candidate.operationId)
    || typeof candidate.captureBindingSha256 !== "string" || !SHA256.test(candidate.captureBindingSha256)
    || !side || sideBinding?.side !== side || assets.length !== 6
    || new Set(assets.map(({ role }) => role)).size !== 6
    || typeof sideBinding.bindingSha256 !== "string" || !SHA256.test(sideBinding.bindingSha256)
    || speedsterDetectionSha256({ side, assets }) !== sideBinding.bindingSha256
    || typeof candidate.memorySnapshotSha256 !== "string" || !SHA256.test(candidate.memorySnapshotSha256)
    || speedsterDetectionSha256(candidate.memorySnapshot) !== candidate.memorySnapshotSha256
    || typeof candidate.detectorVersion !== "string" || !candidate.detectorVersion.trim()
    || (detectorIdentity !== null && detectorIdentity.detectorVersion !== candidate.detectorVersion)
    || (detectorIdentity === null && candidate.detectorIdentitySha256 !== null)
    || (detectorIdentity !== null && (
      typeof candidate.detectorIdentitySha256 !== "string"
      || !SHA256.test(candidate.detectorIdentitySha256)
      || speedsterDetectionSha256(detectorIdentity) !== candidate.detectorIdentitySha256
    ))
    || typeof candidate.requestTraceId !== "string" || !REQUEST_ID.test(candidate.requestTraceId)
    || typeof candidate.resultSha256 !== "string" || !SHA256.test(candidate.resultSha256)
    || speedsterDetectionSha256(candidate.result) !== candidate.resultSha256
    || typeof candidate.createdAt !== "string" || !Number.isFinite(Date.parse(candidate.createdAt))
    || receipt?.version !== SPEEDSTER_DETECTION_SIDE_RECEIPT_VERSION
    || typeof receipt.keyId !== "string" || !receipt.keyId
    || typeof receipt.hmacSha256 !== "string" || !SHA256.test(receipt.hmacSha256)
  ) {
    throw new Error("Speedster detection side checkpoint is malformed.");
  }
  const parsed = candidate as unknown as SpeedsterDetectionSideCheckpoint;
  const secret = secretForKeyId(parsed.receipt.keyId)?.trim() ?? "";
  if (secret.length < 32) throw new Error("Speedster detection side receipt key is unavailable.");
  const { receipt: _receipt, ...unsigned } = parsed;
  const expected = createHmac("sha256", secret).update(receiptPreimage(unsigned)).digest();
  const supplied = Buffer.from(parsed.receipt.hmacSha256, "hex");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new Error("Speedster detection side receipt is invalid.");
  }
  return parsed;
}

export function speedsterDetectionSideCheckpointEvent(
  checkpoint: SpeedsterDetectionSideCheckpoint,
): SpeedsterInstrumentationEvent {
  return {
    eventKey: `${checkpoint.sessionId}:detection-side:${checkpoint.operationId}:${checkpoint.side}`,
    sessionId: checkpoint.sessionId,
    createdByUserId: checkpoint.createdByUserId,
    category: "DETECTOR_CHECKPOINT",
    eventType: "DETECTOR_SIDE_RESULT_PRESERVED",
    durationMs: null,
    details: checkpoint as unknown as Prisma.InputJsonValue,
  };
}
