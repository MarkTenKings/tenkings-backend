import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { BaslerCaptureStillResult, BaslerFixedRigSideBatchRoleCapture } from "./baslerPylonClient";
import {
  resolveFixedRigFullResolutionGeometryAuthorityInProcess,
  type FixedRigCardSide,
  type FixedRigFullResolutionGeometryAuthority,
  type FixedRigFullResolutionGeometryAuthorityInput,
  type FixedRigWarmSideCaptureBatch,
} from "./baslerFixedRigV1";

export const FIXED_RIG_PROCESSING_WORKER_PROTOCOL_VERSION =
  "fixed-rig-geometry-processing-worker-v1" as const;
export const FIXED_RIG_PROCESSING_WORKER_OPERATION =
  "resolve_captured_evidence_geometry_authority" as const;

const SHA256_RE = /^[a-f0-9]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9._:-]{1,180}$/;
const CAPTURE_STAMP_RE = /\d{8}T\d{9}Z/;
const MAX_CAPTURE_BYTES = 512 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 20_000;
const MAX_PROTOCOL_BYTES = 256 * 1024;

export type FixedRigProcessingWorkerSourceRole =
  | "all_on"
  | "accepted_profile"
  | `channel_${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`;

export interface FixedRigProcessingWorkerIdentity {
  protocolVersion: typeof FIXED_RIG_PROCESSING_WORKER_PROTOCOL_VERSION;
  requestId: string;
  sessionId: string;
  packageId: string;
  side: FixedRigCardSide;
  sourceSetSha256: string;
}

export interface FixedRigProcessingWorkerSourceRef {
  role: FixedRigProcessingWorkerSourceRole;
  label: string;
  channel: "all" | number[] | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  relativePath: string;
  sha256: string;
  byteSize: number;
  imageWidth: number;
  imageHeight: number;
  mimeType: "image/png" | "image/tiff" | "image/jpeg";
  timestamp: string;
  sourceImageId: string;
  sourceFrameId: string;
}

export interface FixedRigProcessingWorkerRequest {
  protocolVersion: typeof FIXED_RIG_PROCESSING_WORKER_PROTOCOL_VERSION;
  operation: typeof FIXED_RIG_PROCESSING_WORKER_OPERATION;
  identity: FixedRigProcessingWorkerIdentity;
  packageRelativePath: string;
  sideRelativePath: string;
  sources: FixedRigProcessingWorkerSourceRef[];
}

export interface FixedRigProcessingWorkerSuccessResponse {
  protocolVersion: typeof FIXED_RIG_PROCESSING_WORKER_PROTOCOL_VERSION;
  operation: typeof FIXED_RIG_PROCESSING_WORKER_OPERATION;
  ok: true;
  identity: FixedRigProcessingWorkerIdentity;
  authority: FixedRigFullResolutionGeometryAuthority;
}

export interface FixedRigProcessingWorkerFailureResponse {
  protocolVersion: typeof FIXED_RIG_PROCESSING_WORKER_PROTOCOL_VERSION;
  operation: typeof FIXED_RIG_PROCESSING_WORKER_OPERATION;
  ok: false;
  identity?: FixedRigProcessingWorkerIdentity;
  error: {
    code:
      | "invalid_request"
      | "containment_failed"
      | "source_identity_failed"
      | "source_integrity_failed"
      | "authority_identity_failed"
      | "processing_failed";
    message: string;
  };
}

export type FixedRigProcessingWorkerResponse =
  | FixedRigProcessingWorkerSuccessResponse
  | FixedRigProcessingWorkerFailureResponse;

export class FixedRigProcessingWorkerProtocolError extends Error {
  constructor(
    readonly code:
      | "invalid_request"
      | "containment_failed"
      | "source_identity_failed"
      | "source_integrity_failed"
      | "authority_identity_failed",
    message: string,
  ) {
    super(message);
    this.name = "FixedRigProcessingWorkerProtocolError";
  }
}

function assertSafeId(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !SAFE_ID_RE.test(value)) {
    throw new FixedRigProcessingWorkerProtocolError("invalid_request", `${label} is invalid.`);
  }
}

function canonicalTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length > 40) {
    throw new FixedRigProcessingWorkerProtocolError("source_identity_failed", `${label} timestamp is invalid.`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new FixedRigProcessingWorkerProtocolError("source_identity_failed", `${label} timestamp is invalid.`);
  }
  return new Date(parsed).toISOString();
}

function assertRelativePath(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > 400 ||
    path.isAbsolute(value) ||
    value.includes(String.fromCharCode(92)) ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new FixedRigProcessingWorkerProtocolError("invalid_request", `${label} is not a canonical relative path.`);
  }
}

function assertExactKeys(value: object, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new FixedRigProcessingWorkerProtocolError("invalid_request", `${label} contains unsupported fields.`);
  }
}

function assertAllowedKeys(value: object, allowed: readonly string[], label: string): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length) {
    throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", `${label} contains unsupported fields.`);
  }
}

function isContained(parentRealPath: string, childRealPath: string): boolean {
  const relative = path.relative(parentRealPath, childRealPath);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function toProtocolRelative(parentRealPath: string, childRealPath: string): string {
  if (!isContained(parentRealPath, childRealPath) || parentRealPath === childRealPath) {
    throw new FixedRigProcessingWorkerProtocolError("containment_failed", "Capture source escaped its immutable side package.");
  }
  return path.relative(parentRealPath, childRealPath).split(path.sep).join("/");
}

function roleLabel(side: FixedRigCardSide, role: FixedRigProcessingWorkerSourceRole): string {
  if (role === "all_on") return `${side}-all-on`;
  if (role === "accepted_profile") return `${side}-accepted-lighting-profile`;
  return `${side}-channel-${Number(role.slice("channel_".length))}`;
}

function expectedFilename(label: string, mimeType: FixedRigProcessingWorkerSourceRef["mimeType"]): RegExp {
  const extension = mimeType === "image/png" ? "png" : mimeType === "image/tiff" ? "tiff" : "jpg";
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^basler-${escapedLabel}-${CAPTURE_STAMP_RE.source}\\.${extension}$`, "i");
}

function expectedRoles(): FixedRigProcessingWorkerSourceRole[] {
  return [
    "all_on",
    "accepted_profile",
    "channel_1",
    "channel_2",
    "channel_3",
    "channel_4",
    "channel_5",
    "channel_6",
    "channel_7",
    "channel_8",
  ];
}

function sourceSetSha256(sources: readonly FixedRigProcessingWorkerSourceRef[]): string {
  const canonical = sources.map((source) => ({
    role: source.role,
    label: source.label,
    channel: source.channel,
    relativePath: source.relativePath,
    sha256: source.sha256,
    byteSize: source.byteSize,
    imageWidth: source.imageWidth,
    imageHeight: source.imageHeight,
    mimeType: source.mimeType,
    timestamp: source.timestamp,
    sourceImageId: source.sourceImageId,
    sourceFrameId: source.sourceFrameId,
  }));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

async function fileIdentity(filePath: string): Promise<{
  sha256: string;
  byteSize: number;
  imageWidth: number;
  imageHeight: number;
}> {
  const [bytes, fileStat, image] = await Promise.all([
    readFile(filePath),
    stat(filePath),
    sharp(filePath).metadata(),
  ]);
  if (!fileStat.isFile() || !image.width || !image.height) {
    throw new FixedRigProcessingWorkerProtocolError("source_integrity_failed", "Captured source is not a readable image file.");
  }
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    byteSize: fileStat.size,
    imageWidth: image.width,
    imageHeight: image.height,
  };
}

function roleCaptures(captureBatch: FixedRigWarmSideCaptureBatch): BaslerFixedRigSideBatchRoleCapture[] {
  return [
    captureBatch.batch.captures.allOn,
    captureBatch.batch.captures.acceptedProfile,
    ...captureBatch.batch.captures.channels.slice().sort((left, right) => Number(left.channel) - Number(right.channel)),
  ];
}

export async function createFixedRigProcessingWorkerRequest(input: {
  allowedOutputRoot: string;
  requestId: string;
  sessionId: string;
  captureBatch: FixedRigWarmSideCaptureBatch;
}): Promise<FixedRigProcessingWorkerRequest> {
  assertSafeId(input.requestId, "requestId");
  assertSafeId(input.sessionId, "sessionId");
  assertSafeId(input.captureBatch.packageId, "packageId");
  const rootReal = await realpath(input.allowedOutputRoot);
  const packageReal = await realpath(input.captureBatch.packageDir);
  const sideReal = await realpath(input.captureBatch.sideDir);
  if (
    !isContained(rootReal, packageReal) ||
    path.basename(packageReal) !== input.captureBatch.packageId ||
    path.dirname(sideReal) !== packageReal ||
    path.basename(sideReal) !== input.captureBatch.side
  ) {
    throw new FixedRigProcessingWorkerProtocolError(
      "containment_failed",
      "Captured package identity is not an immutable side package under the configured output root.",
    );
  }
  const captures = roleCaptures(input.captureBatch);
  const roles = expectedRoles();
  if (captures.length !== roles.length || captures.some((capture, index) => capture.role !== roles[index])) {
    throw new FixedRigProcessingWorkerProtocolError("source_identity_failed", "Captured authority roles are missing, duplicated, or out of order.");
  }
  const seenFiles = new Set<string>();
  const sources: FixedRigProcessingWorkerSourceRef[] = [];
  for (const [index, roleCapture] of captures.entries()) {
    const role = roles[index]!;
    const capture = roleCapture.capture;
    const fileReal = await realpath(capture.outputFilePath);
    const relativePath = toProtocolRelative(sideReal, fileReal);
    const label = roleLabel(input.captureBatch.side, role);
    const channel = role === "all_on"
      ? "all"
      : role === "accepted_profile"
        ? [...input.captureBatch.activeLightingProfile.selectedChannels]
        : Number(role.slice(8)) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
    if (
      roleCapture.label !== label || JSON.stringify(roleCapture.channel) !== JSON.stringify(channel) ||
      !expectedFilename(label, capture.mimeType).test(path.basename(fileReal))
    ) {
      throw new FixedRigProcessingWorkerProtocolError("source_identity_failed", `Captured ${role} filename or role label is invalid.`);
    }
    if (
      !SHA256_RE.test(capture.sha256) ||
      !Number.isSafeInteger(capture.byteSize) || capture.byteSize <= 0 || capture.byteSize > MAX_CAPTURE_BYTES ||
      !Number.isSafeInteger(capture.imageWidth) || capture.imageWidth <= 0 || capture.imageWidth > MAX_IMAGE_DIMENSION ||
      !Number.isSafeInteger(capture.imageHeight) || capture.imageHeight <= 0 || capture.imageHeight > MAX_IMAGE_DIMENSION
    ) {
      throw new FixedRigProcessingWorkerProtocolError("source_identity_failed", `Captured ${role} manifest identity is invalid.`);
    }
    if (seenFiles.has(fileReal)) {
      throw new FixedRigProcessingWorkerProtocolError("source_identity_failed", "Captured authority roles must reference distinct immutable files.");
    }
    seenFiles.add(fileReal);
    const sourceImageId = `${input.captureBatch.packageId}-${input.captureBatch.side}-${role}`;
    const sourceFrameId = `${input.captureBatch.side}-${role}-${capture.sha256.slice(0, 16)}`;
    sources.push({
      role,
      label,
      channel,
      relativePath,
      sha256: capture.sha256,
      byteSize: capture.byteSize,
      imageWidth: capture.imageWidth,
      imageHeight: capture.imageHeight,
      mimeType: capture.mimeType,
      timestamp: canonicalTimestamp(capture.timestamp, role),
      sourceImageId,
      sourceFrameId,
    });
  }
  const digest = sourceSetSha256(sources);
  const request: FixedRigProcessingWorkerRequest = {
    protocolVersion: FIXED_RIG_PROCESSING_WORKER_PROTOCOL_VERSION,
    operation: FIXED_RIG_PROCESSING_WORKER_OPERATION,
    identity: {
      protocolVersion: FIXED_RIG_PROCESSING_WORKER_PROTOCOL_VERSION,
      requestId: input.requestId,
      sessionId: input.sessionId,
      packageId: input.captureBatch.packageId,
      side: input.captureBatch.side,
      sourceSetSha256: digest,
    },
    packageRelativePath: toProtocolRelative(rootReal, packageReal),
    sideRelativePath: input.captureBatch.side,
    sources,
  };
  validateFixedRigProcessingWorkerRequest(request);
  return request;
}

export function validateFixedRigProcessingWorkerRequest(value: unknown): asserts value is FixedRigProcessingWorkerRequest {
  if (!value || typeof value !== "object") {
    throw new FixedRigProcessingWorkerProtocolError("invalid_request", "Worker request must be an object.");
  }
  const request = value as FixedRigProcessingWorkerRequest;
  assertExactKeys(request, ["protocolVersion", "operation", "identity", "packageRelativePath", "sideRelativePath", "sources"], "Worker request");
  if (request.protocolVersion !== FIXED_RIG_PROCESSING_WORKER_PROTOCOL_VERSION || request.operation !== FIXED_RIG_PROCESSING_WORKER_OPERATION) {
    throw new FixedRigProcessingWorkerProtocolError("invalid_request", "Worker protocol version or operation is unsupported.");
  }
  if (!request.identity || typeof request.identity !== "object") {
    throw new FixedRigProcessingWorkerProtocolError("invalid_request", "Worker request identity is missing.");
  }
  assertExactKeys(request.identity, ["protocolVersion", "requestId", "sessionId", "packageId", "side", "sourceSetSha256"], "Worker identity");
  assertSafeId(request.identity?.requestId, "requestId");
  assertSafeId(request.identity?.sessionId, "sessionId");
  assertSafeId(request.identity?.packageId, "packageId");
  if (request.identity.protocolVersion !== request.protocolVersion || !["front", "back"].includes(request.identity.side)) {
    throw new FixedRigProcessingWorkerProtocolError("invalid_request", "Worker request identity is incoherent.");
  }
  assertRelativePath(request.packageRelativePath, "packageRelativePath");
  assertRelativePath(request.sideRelativePath, "sideRelativePath");
  if (request.sideRelativePath !== request.identity.side || !SHA256_RE.test(request.identity.sourceSetSha256)) {
    throw new FixedRigProcessingWorkerProtocolError("invalid_request", "Worker side or source-set identity is invalid.");
  }
  if (!Array.isArray(request.sources) || request.sources.length !== expectedRoles().length) {
    throw new FixedRigProcessingWorkerProtocolError("invalid_request", "Worker request must contain the exact authority source set.");
  }
  const roles = expectedRoles();
  const seenPaths = new Set<string>();
  request.sources.forEach((source, index) => {
    const role = roles[index]!;
    if (!source || typeof source !== "object") {
      throw new FixedRigProcessingWorkerProtocolError("source_identity_failed", "Worker authority source must be an object.");
    }
    assertExactKeys(source, [
      "role", "label", "channel", "relativePath", "sha256", "byteSize", "imageWidth", "imageHeight",
      "mimeType", "timestamp", "sourceImageId", "sourceFrameId",
    ], `Worker ${role} source`);
    if (source.role !== role || source.label !== roleLabel(request.identity.side, role)) {
      throw new FixedRigProcessingWorkerProtocolError("source_identity_failed", "Worker authority source order or label is invalid.");
    }
    assertRelativePath(source.relativePath, `${role}.relativePath`);
    if (seenPaths.has(source.relativePath)) {
      throw new FixedRigProcessingWorkerProtocolError("source_identity_failed", "Worker authority source paths must be unique.");
    }
    seenPaths.add(source.relativePath);
    if (
      typeof source.label !== "string" || source.label.length < 3 || source.label.length > 80 ||
      !["image/png", "image/tiff", "image/jpeg"].includes(source.mimeType) ||
      !SHA256_RE.test(source.sha256) ||
      !Number.isSafeInteger(source.byteSize) || source.byteSize <= 0 || source.byteSize > MAX_CAPTURE_BYTES ||
      !Number.isSafeInteger(source.imageWidth) || source.imageWidth <= 0 || source.imageWidth > MAX_IMAGE_DIMENSION ||
      !Number.isSafeInteger(source.imageHeight) || source.imageHeight <= 0 || source.imageHeight > MAX_IMAGE_DIMENSION ||
      source.timestamp !== canonicalTimestamp(source.timestamp, role) ||
      source.sourceImageId !== `${request.identity.packageId}-${request.identity.side}-${role}` ||
      source.sourceFrameId !== `${request.identity.side}-${role}-${source.sha256.slice(0, 16)}` ||
      !expectedFilename(source.label, source.mimeType).test(path.posix.basename(source.relativePath))
    ) {
      throw new FixedRigProcessingWorkerProtocolError("source_identity_failed", `Worker ${role} metadata is invalid.`);
    }
  });
  const accepted = request.sources[1]!;
  if (
    request.sources[0]!.channel !== "all" ||
    !Array.isArray(accepted.channel) ||
    accepted.channel.length < 1 || accepted.channel.length > 8 ||
    accepted.channel.some((channel) => !Number.isInteger(channel) || channel < 1 || channel > 8) ||
    new Set(accepted.channel).size !== accepted.channel.length ||
    request.sources.slice(2).some((source, index) => source.channel !== index + 1)
  ) {
    throw new FixedRigProcessingWorkerProtocolError("source_identity_failed", "Worker source channels do not match their exact captured roles.");
  }
  if (sourceSetSha256(request.sources) !== request.identity.sourceSetSha256) {
    throw new FixedRigProcessingWorkerProtocolError("source_identity_failed", "Worker source-set digest does not match its exact sources.");
  }
  if (Buffer.byteLength(JSON.stringify(request), "utf8") > MAX_PROTOCOL_BYTES) {
    throw new FixedRigProcessingWorkerProtocolError("invalid_request", "Worker request exceeds the bounded protocol size.");
  }
}

function minimalCapture(filePath: string, source: FixedRigProcessingWorkerSourceRef): BaslerCaptureStillResult {
  return {
    outputFilePath: filePath,
    sha256: source.sha256,
    byteSize: source.byteSize,
    mimeType: source.mimeType,
    timestamp: source.timestamp,
    camera: { index: 0 },
    imageWidth: source.imageWidth,
    imageHeight: source.imageHeight,
    sourcePixelFormat: "Mono8",
    savedImageFormat: source.mimeType === "image/png" ? "PNG" : source.mimeType === "image/tiff" ? "TIFF" : "JPG",
    transport: "GigE",
    pylon: { installed: true, status: "installed" },
    calibration: {
      isCalibrated: false,
      calibrationProfileId: null,
      cameraRole: "macro_overview",
      evidenceClass: "macro_raw_smoke",
      coordinateFrame: "basler_sensor_pixels",
    },
    note: source.label,
  };
}

async function resolveRequestSources(
  request: FixedRigProcessingWorkerRequest,
  allowedOutputRoot: string,
): Promise<{ input: FixedRigFullResolutionGeometryAuthorityInput; verifyUnchanged(): Promise<void> }> {
  validateFixedRigProcessingWorkerRequest(request);
  const rootReal = await realpath(allowedOutputRoot);
  const packageReal = await realpath(path.join(rootReal, ...request.packageRelativePath.split("/")));
  const sideReal = await realpath(path.join(packageReal, request.sideRelativePath));
  if (
    !isContained(rootReal, packageReal) ||
    path.basename(packageReal) !== request.identity.packageId ||
    path.dirname(sideReal) !== packageReal ||
    path.basename(sideReal) !== request.identity.side
  ) {
    throw new FixedRigProcessingWorkerProtocolError("containment_failed", "Worker package escaped the configured output root.");
  }
  const resolved: Array<{ source: FixedRigProcessingWorkerSourceRef; filePath: string }> = [];
  for (const source of request.sources) {
    const filePath = await realpath(path.join(sideReal, ...source.relativePath.split("/")));
    if (!isContained(sideReal, filePath)) {
      throw new FixedRigProcessingWorkerProtocolError("containment_failed", "Worker source escaped its immutable side package.");
    }
    const current = await fileIdentity(filePath);
    if (
      current.sha256 !== source.sha256 || current.byteSize !== source.byteSize ||
      current.imageWidth !== source.imageWidth || current.imageHeight !== source.imageHeight
    ) {
      throw new FixedRigProcessingWorkerProtocolError("source_integrity_failed", `Worker ${source.role} source identity changed.`);
    }
    resolved.push({ source, filePath });
  }
  const roleCapture = (role: FixedRigProcessingWorkerSourceRole): BaslerFixedRigSideBatchRoleCapture => {
    const entry = resolved.find((candidate) => candidate.source.role === role)!;
    return {
      role,
      label: entry.source.label,
      channel: entry.source.channel,
      capture: minimalCapture(entry.filePath, entry.source),
    };
  };
  return {
    input: {
      packageId: request.identity.packageId,
      side: request.identity.side,
      allOn: roleCapture("all_on"),
      acceptedProfile: roleCapture("accepted_profile"),
      channels: expectedRoles().slice(2).map((role) => roleCapture(role)),
    },
    async verifyUnchanged() {
      for (const entry of resolved) {
        const current = await fileIdentity(entry.filePath);
        if (
          current.sha256 !== entry.source.sha256 || current.byteSize !== entry.source.byteSize ||
          current.imageWidth !== entry.source.imageWidth || current.imageHeight !== entry.source.imageHeight
        ) {
          throw new FixedRigProcessingWorkerProtocolError("source_integrity_failed", `Worker ${entry.source.role} source changed during detection.`);
        }
      }
    },
  };
}

export async function revalidateFixedRigProcessingWorkerSources(
  request: FixedRigProcessingWorkerRequest,
  allowedOutputRoot: string,
): Promise<void> {
  const resolved = await resolveRequestSources(request, allowedOutputRoot);
  await resolved.verifyUnchanged();
}

/** Bind the main-process consumer input to the exact immutable request that the worker revalidated. */
export async function validateFixedRigProcessingWorkerAuthorityInput(
  request: FixedRigProcessingWorkerRequest,
  authorityInput: FixedRigFullResolutionGeometryAuthorityInput,
  allowedOutputRoot: string,
): Promise<void> {
  validateFixedRigProcessingWorkerRequest(request);
  if (authorityInput.packageId !== request.identity.packageId || authorityInput.side !== request.identity.side) {
    throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", "Main processing requested a different package or side authority.");
  }
  const rootReal = await realpath(allowedOutputRoot);
  const packageReal = await realpath(path.join(rootReal, ...request.packageRelativePath.split("/")));
  const sideReal = await realpath(path.join(packageReal, request.sideRelativePath));
  if (
    !isContained(rootReal, packageReal) || path.basename(packageReal) !== request.identity.packageId ||
    path.dirname(sideReal) !== packageReal || path.basename(sideReal) !== request.identity.side
  ) {
    throw new FixedRigProcessingWorkerProtocolError("containment_failed", "Main processing package containment changed after worker revalidation.");
  }
  const captures = [authorityInput.allOn, authorityInput.acceptedProfile, ...authorityInput.channels];
  const roles = expectedRoles();
  if (captures.length !== roles.length || captures.some((capture, index) => capture.role !== roles[index])) {
    throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", "Main processing authority roles were missing, duplicated, or reordered.");
  }
  for (const [index, roleCapture] of captures.entries()) {
    const source = request.sources[index]!;
    const capture = roleCapture.capture;
    const expectedReal = await realpath(path.join(sideReal, ...source.relativePath.split("/")));
    const actualReal = await realpath(capture.outputFilePath);
    if (
      !isContained(sideReal, expectedReal) || !isContained(sideReal, actualReal) ||
      path.relative(expectedReal, actualReal) !== "" ||
      roleCapture.label !== source.label ||
      JSON.stringify(roleCapture.channel) !== JSON.stringify(source.channel) ||
      capture.sha256 !== source.sha256 || capture.byteSize !== source.byteSize ||
      capture.imageWidth !== source.imageWidth || capture.imageHeight !== source.imageHeight ||
      capture.mimeType !== source.mimeType || canonicalTimestamp(capture.timestamp, source.role) !== source.timestamp
    ) {
      throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", `Main processing ${source.role} input did not match its revalidated worker source.`);
    }
  }
}

function sameOrderedRoles(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((role, index) => role === expected[index]);
}

function assertFiniteNonNegative(value: unknown, label: string, maximum: number): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > maximum) {
    throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", `${label} is outside its bounded range.`);
  }
}

function assertFiniteBounded(value: unknown, label: string, minimum: number, maximum: number, integer = false): void {
  if (
    typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum ||
    (integer && !Number.isInteger(value))
  ) {
    throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", `${label} is outside its bounded range.`);
  }
}

function assertExactEnum(value: unknown, allowed: readonly string[], label: string): void {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", `${label} is invalid.`);
  }
}

function assertBoundedTextArray(value: unknown, label: string, maximumItems = 100): void {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", `${label} exceeded its bounded shape.`);
  }
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length > 500 || /[\u0000-\u001f\u007f]/.test(entry)) {
      throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", `${label} contained invalid text.`);
    }
  }
}

function assertNumberTuple(value: unknown, label: string, minimum: number, maximum: number): void {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", `${label} was not an exact four-value tuple.`);
  }
  value.forEach((entry, index) => assertFiniteBounded(entry, `${label}[${index}]`, minimum, maximum));
}

function authorityStringContainsForbiddenValue(value: string): boolean {
  return (
    /[\u0000-\u001f\u007f]/.test(value) ||
    /(?:data|blob|file|https?):/i.test(value) ||
    /(?:^|[=:,;\s"'([{])[A-Za-z]:[\\/]/.test(value) ||
    /\\\\[^\\]/.test(value) ||
    /(?:^|[=:,;\s"'([{])\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*/.test(value) ||
    /(?:^|[^A-Za-z0-9._~-])(?:\.{0,2}[\\/])?(?:[A-Za-z0-9._~-]+[\\/])+[A-Za-z0-9._~-]+(?:[^A-Za-z0-9._~-]|$)/.test(value) ||
    /(?:^|[^A-Za-z0-9._~-])(?:\.{0,2}[\\/])?(?:[A-Za-z0-9._~-]+[\\/])+[A-Za-z0-9._~-]+\.(?:png|jpe?g|tiff?|bmp|webp|gif)(?:[^A-Za-z0-9]|$)/i.test(value) ||
    /(?:^|[=:,;\s"'([{])(?:[A-Za-z0-9._~-]+\.)+(?:png|jpe?g|tiff?|bmp|webp|gif|json|ya?ml|txt|log|csv|html?|xml|bin|raw)(?:[^A-Za-z0-9]|$)/i.test(value) ||
    /\[[0-9A-Fa-f:]{2,}\](?::\d{1,5})?/.test(value) ||
    /(?:^|[^0-9A-Fa-f:])(?:::1|fe80:[0-9A-Fa-f:]*|f[cd][0-9A-Fa-f]{2}:[0-9A-Fa-f:]*|::ffff:[0-9A-Fa-f:.]+)(?:[^0-9A-Fa-f:]|$)/i.test(value) ||
    /(?:^|[^0-9A-Fa-f:])(?:0:){7}[01](?:[^0-9A-Fa-f:]|$)/i.test(value) ||
    /(?:^|[^0-9A-Fa-f:])(?:0:){5}(?:ffff:)?(?:127(?:\.\d{1,3}){3}|0\.0\.0\.0)(?:[^0-9A-Fa-f:.]|$)/i.test(value) ||
    /(?:^|[^A-Za-z0-9])(?:localhost|0\.0\.0\.0|127(?:\.\d{1,3}){3}|169\.254(?:\.\d{1,3}){2}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})(?::\d{1,5})?(?:[\s/?#:]|$)/i.test(value) ||
    /base64\s*,/i.test(value) ||
    /[A-Za-z0-9+/]{256,}={0,2}/.test(value)
  );
}

function assertPathFreeAuthorityValue(value: unknown, depth = 0): void {
  if (depth > 16) {
    throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", "Worker authority nesting exceeded its bounded protocol.");
  }
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", "Worker authority contained a non-finite number.");
    }
    return;
  }
  if (typeof value === "string") {
    if (value.length > 1_000 || authorityStringContainsForbiddenValue(value)) {
      throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", "Worker authority included a forbidden path, URL, or image-body value.");
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 500) {
      throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", "Worker authority array exceeded its bounded protocol.");
    }
    value.forEach((entry) => assertPathFreeAuthorityValue(entry, depth + 1));
    return;
  }
  if (typeof value !== "object" || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", "Worker authority contained a non-plain or unsupported value.");
  }
  if (Object.keys(value).length > 100) {
    throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", "Worker authority object exceeded its bounded protocol.");
  }
  for (const [key, entry] of Object.entries(value)) {
    if (/(?:path|file|uri|url|body|blob|buffer|base64|bytes|binary|payload)/i.test(key) && key !== "sourceByteSize") {
      throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", "Worker authority included a forbidden path or image-body field.");
    }
    assertPathFreeAuthorityValue(entry, depth + 1);
  }
}

function cornerDelta(
  left: NonNullable<FixedRigFullResolutionGeometryAuthority["inspectedRoles"][number]["corners"]>,
  right: NonNullable<FixedRigFullResolutionGeometryAuthority["inspectedRoles"][number]["corners"]>,
): number {
  return Math.max(...(["topLeft", "topRight", "bottomRight", "bottomLeft"] as const).map((corner) =>
    Math.hypot(left[corner].x - right[corner].x, left[corner].y - right[corner].y)));
}

function rotationDelta(left: number, right: number): number {
  let delta = Math.abs(left - right) % 180;
  if (delta > 90) delta = 180 - delta;
  return delta;
}

function assertFinitePoint(value: unknown, label: string): void {
  if (!value || typeof value !== "object") {
    throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", `${label} was malformed.`);
  }
  assertExactKeys(value, ["x", "y"], label);
  const point = value as { x?: unknown; y?: unknown };
  if (
    typeof point.x !== "number" || !Number.isFinite(point.x) || Math.abs(point.x) > MAX_IMAGE_DIMENSION * 2 ||
    typeof point.y !== "number" || !Number.isFinite(point.y) || Math.abs(point.y) > MAX_IMAGE_DIMENSION * 2
  ) {
    throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", `${label} was outside its bounded numeric shape.`);
  }
}

function assertFiniteCorners(value: unknown, label: string): void {
  if (!value || typeof value !== "object") {
    throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", `${label} was malformed.`);
  }
  assertExactKeys(value, ["topLeft", "topRight", "bottomRight", "bottomLeft"], label);
  const corners = value as Record<string, unknown>;
  for (const corner of ["topLeft", "topRight", "bottomRight", "bottomLeft"] as const) {
    assertFinitePoint(corners[corner], `${label} ${corner}`);
  }
}

function assertCornersWithinImage(
  corners: NonNullable<FixedRigFullResolutionGeometryAuthority["source"]["geometry"]["corners"]>,
  width: number,
  height: number,
  label: string,
): void {
  for (const [name, point] of Object.entries(corners)) {
    if (point.x < 0 || point.x > width || point.y < 0 || point.y > height) {
      throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", `${label} ${name} escaped its source image.`);
    }
  }
}

function assertPlacementOffset(value: unknown, label: string, maximum: number): void {
  if (!value || typeof value !== "object") {
    throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", `${label} was malformed.`);
  }
  assertExactKeys(value, ["x", "y", "distance", "maxAxis"], label);
  const offset = value as Record<string, unknown>;
  assertFiniteBounded(offset.x, `${label}.x`, -maximum, maximum);
  assertFiniteBounded(offset.y, `${label}.y`, -maximum, maximum);
  assertFiniteBounded(offset.distance, `${label}.distance`, 0, maximum * 2);
  assertFiniteBounded(offset.maxAxis, `${label}.maxAxis`, 0, maximum);
}

function assertPolarityTuple(value: unknown, label: string): void {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", `${label} was not an exact four-value tuple.`);
  }
  value.forEach((entry, index) => assertExactEnum(entry, ["lighter_inside", "darker_inside"], `${label}[${index}]`));
}

function assertReasonList(value: unknown, label: string): void {
  const allowed = [
    "coverage", "aspect", "clearance", "side_gradient", "side_signed_gradient",
    "side_polarity_coherence", "total_gradient",
  ];
  if (!Array.isArray(value) || value.length > allowed.length || new Set(value).size !== value.length) {
    throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", `${label} was malformed.`);
  }
  value.forEach((entry, index) => assertExactEnum(entry, allowed, `${label}[${index}]`));
}

export function validateFixedRigProcessingWorkerAuthority(
  request: FixedRigProcessingWorkerRequest,
  authority: FixedRigFullResolutionGeometryAuthority,
): void {
  if (!authority || typeof authority !== "object") {
    throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", "Worker geometry authority was missing.");
  }
  assertExactKeys(authority, ["version", "primaryRole", "authoritativeRole", "resolution", "source", "consensus", "inspectedRoles"], "Worker authority");
  if (!authority.source || typeof authority.source !== "object" || !authority.consensus || typeof authority.consensus !== "object") {
    throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", "Worker authority source or consensus was missing.");
  }
  assertExactKeys(authority.source, ["role", "sourceSha256", "sourceByteSize", "sourceImageId", "sourceFrameId", "image", "geometry"], "Worker authority source");
  assertExactKeys(authority.consensus, ["required", "agreeingRoles", "maximumCornerDeltaPixels", "maximumRotationDeltaDegrees"], "Worker authority consensus");
  if (!authority.source.image || typeof authority.source.image !== "object" || !authority.source.geometry || typeof authority.source.geometry !== "object") {
    throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", "Worker authority geometry or image metadata was missing.");
  }
  assertExactKeys(authority.source.image, ["width", "height", "coordinateFrame"], "Worker authority source image");
  assertFiniteBounded(authority.source.image.width, "Worker authority source image width", 1, MAX_IMAGE_DIMENSION, true);
  assertFiniteBounded(authority.source.image.height, "Worker authority source image height", 1, MAX_IMAGE_DIMENSION, true);
  if (authority.source.image.coordinateFrame !== "source_image_pixels") {
    throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", "Worker authority source coordinate frame was invalid.");
  }
  const geometry = authority.source.geometry;
  assertAllowedKeys(geometry, [
    "version", "detectionPolicy", "side", "placementState", "adjustmentReason", "geometrySource", "captureMode",
    "confidenceBasis", "detectionUsed", "manualOverrideUsed", "corners", "detectedCorners", "boundingBox",
    "rotationDegrees", "skewDegrees", "confidence", "sourceImageId", "sourceFrameId", "timestamp", "image",
    "semanticOrientation", "placement", "detection", "warnings",
  ], "Worker authority geometry");
  if (!geometry.image || typeof geometry.image !== "object" || !geometry.semanticOrientation || typeof geometry.semanticOrientation !== "object" ||
      !geometry.placement || typeof geometry.placement !== "object" || !geometry.detection || typeof geometry.detection !== "object") {
    throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", "Worker authority nested geometry metadata was missing.");
  }
  assertExactKeys(geometry.image, ["width", "height", "coordinateFrame"], "Worker geometry image");
  assertExactKeys(geometry.semanticOrientation, ["canonicalOrientation", "basis", "contentUprightVerified"], "Worker geometry semantic orientation");
  assertFiniteBounded(geometry.image.width, "Worker geometry image width", 1, MAX_IMAGE_DIMENSION, true);
  assertFiniteBounded(geometry.image.height, "Worker geometry image height", 1, MAX_IMAGE_DIMENSION, true);
  if (
    geometry.version !== "ten-kings-card-geometry-v1" ||
    geometry.image.coordinateFrame !== "source_image_pixels" ||
    geometry.semanticOrientation.canonicalOrientation !== "portrait" ||
    geometry.semanticOrientation.basis !== "operator_top_toward_preview_top" ||
    geometry.semanticOrientation.contentUprightVerified !== false ||
    geometry.adjustmentReason !== null
  ) {
    throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", "Worker authority geometry semantics were invalid.");
  }
  assertFiniteBounded(geometry.rotationDegrees, "Worker geometry rotation", -180, 180);
  assertFiniteBounded(geometry.skewDegrees, "Worker geometry skew", -180, 180);
  assertFiniteBounded(geometry.confidence, "Worker geometry confidence", 0, 1);
  assertBoundedTextArray(geometry.warnings, "Worker geometry warnings");
  assertExactKeys(geometry.placement, [
    "centerOffsetPixels", "centerOffsetInches", "estimatedPixelsPerInch", "maxCenterOffsetInches", "maxSkewDegrees",
    "maxNormalizationSkewDegrees", "minReadyConfidence", "withinCenterTolerance", "withinSkewTolerance",
    "withinNormalizationSkewTolerance", "withinAspectTolerance", "withinCoverageTolerance", "withinFrame", "confidenceReady", "cardCoverage",
  ], "Worker geometry placement");
  assertPlacementOffset(geometry.placement.centerOffsetPixels, "Worker pixel placement offset", MAX_IMAGE_DIMENSION);
  assertPlacementOffset(geometry.placement.centerOffsetInches, "Worker inch placement offset", 100);
  assertFiniteBounded(geometry.placement.estimatedPixelsPerInch, "Worker estimated pixels per inch", 1, MAX_IMAGE_DIMENSION * 2);
  assertFiniteBounded(geometry.placement.maxCenterOffsetInches, "Worker maximum center offset", 0, 100);
  assertFiniteBounded(geometry.placement.maxSkewDegrees, "Worker maximum skew", 0, 180);
  assertFiniteBounded(geometry.placement.maxNormalizationSkewDegrees, "Worker maximum normalization skew", 0, 180);
  assertFiniteBounded(geometry.placement.minReadyConfidence, "Worker minimum Ready confidence", 0, 1);
  assertFiniteBounded(geometry.placement.cardCoverage, "Worker card coverage", 0, 1);
  for (const [key, value] of Object.entries(geometry.placement)) {
    if (key.startsWith("within") || key === "confidenceReady") {
      if (typeof value !== "boolean") {
        throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", `Worker geometry placement ${key} was not boolean.`);
      }
    }
  }
  if (
    geometry.placement.withinFrame !== true || geometry.placement.withinAspectTolerance !== true ||
    geometry.placement.withinCoverageTolerance !== true || geometry.placement.withinNormalizationSkewTolerance !== true ||
    geometry.placement.confidenceReady !== true
  ) {
    throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", "Worker Ready geometry contradicted its placement gates.");
  }
  const reportedSkew = geometry.skewDegrees as number;
  const expectedConfidenceReady = geometry.confidence >= geometry.placement.minReadyConfidence;
  const expectedSkewReady = Math.abs(reportedSkew) <= geometry.placement.maxSkewDegrees + 0.25;
  const expectedNormalizationSkewReady =
    Math.abs(reportedSkew) <= geometry.placement.maxNormalizationSkewDegrees + 0.25;
  if (
    geometry.placement.confidenceReady !== expectedConfidenceReady ||
    geometry.placement.withinSkewTolerance !== expectedSkewReady ||
    geometry.placement.withinNormalizationSkewTolerance !== expectedNormalizationSkewReady ||
    geometry.placement.maxNormalizationSkewDegrees < geometry.placement.maxSkewDegrees
  ) {
    throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", "Worker Ready geometry placement booleans contradicted its recorded thresholds.");
  }
  assertAllowedKeys(geometry.detection, [
    "method", "backgroundLuma", "backgroundColor", "backgroundNoise", "contrastRange", "foregroundThreshold",
    "foregroundPixelFraction", "morphologyRadius", "componentPixelFraction", "rectangularFill", "measuredAspectRatio",
    "expectedAspectRatio", "relativeAspectError", "analysisWidth", "analysisHeight", "perimeterGradientStrength",
    "perimeterSideStrengths", "perimeterSignedSideStrengths", "perimeterSidePolarityConsistency", "perimeterSidePolarity",
    "perimeterProvisionalCandidateCount", "perimeterClosestRejectedCandidate", "perimeterCandidateCount",
  ], "Worker geometry detection");
  assertExactEnum(
    geometry.detection.method,
    ["solid_plate_color_component_pca_v2", "perimeter_gradient_rectangle_v3"],
    "Worker geometry detection method",
  );
  if (geometry.detection.method === "solid_plate_color_component_pca_v2") {
    assertExactKeys(geometry.detection, [
      "method", "backgroundLuma", "backgroundColor", "backgroundNoise", "contrastRange", "foregroundThreshold",
      "foregroundPixelFraction", "morphologyRadius", "componentPixelFraction", "rectangularFill", "measuredAspectRatio",
      "expectedAspectRatio", "relativeAspectError", "analysisWidth", "analysisHeight",
    ], "Worker Ready solid-plate diagnostics");
  } else {
    assertExactKeys(geometry.detection, [
      "method", "backgroundLuma", "contrastRange", "foregroundThreshold", "foregroundPixelFraction",
      "expectedAspectRatio", "analysisWidth", "analysisHeight", "measuredAspectRatio", "relativeAspectError",
      "perimeterGradientStrength", "perimeterSideStrengths", "perimeterSignedSideStrengths",
      "perimeterSidePolarityConsistency", "perimeterSidePolarity", "perimeterCandidateCount",
      "perimeterProvisionalCandidateCount",
    ], "Worker Ready perimeter diagnostics");
  }
  assertFiniteBounded(geometry.detection.backgroundLuma, "Worker detection background luma", 0, 255);
  assertFiniteBounded(geometry.detection.contrastRange, "Worker detection contrast range", 0, 255);
  assertFiniteBounded(geometry.detection.foregroundThreshold, "Worker detection threshold", 0, 255);
  assertFiniteBounded(geometry.detection.foregroundPixelFraction, "Worker foreground fraction", 0, 1);
  assertFiniteBounded(geometry.detection.expectedAspectRatio, "Worker expected aspect ratio", 1, 10);
  assertFiniteBounded(geometry.detection.analysisWidth, "Worker detection analysis width", 1, MAX_IMAGE_DIMENSION, true);
  assertFiniteBounded(geometry.detection.analysisHeight, "Worker detection analysis height", 1, MAX_IMAGE_DIMENSION, true);
  for (const [key, maximum] of [
    ["backgroundNoise", 255], ["componentPixelFraction", 1], ["rectangularFill", 1],
    ["measuredAspectRatio", 10], ["relativeAspectError", 10], ["perimeterGradientStrength", 2_048],
  ] as const) {
    const value = geometry.detection[key];
    if (value !== undefined) assertFiniteBounded(value, `Worker detection ${key}`, 0, maximum);
  }
  if (geometry.detection.morphologyRadius !== undefined) {
    assertFiniteBounded(geometry.detection.morphologyRadius, "Worker detection morphology radius", 0, 100, true);
  }
  for (const key of ["perimeterCandidateCount", "perimeterProvisionalCandidateCount"] as const) {
    const value = geometry.detection[key];
    if (value !== undefined) assertFiniteBounded(value, `Worker detection ${key}`, 0, 10_000_000, true);
  }
  if (geometry.detection.perimeterSideStrengths !== undefined) {
    assertNumberTuple(geometry.detection.perimeterSideStrengths, "Worker perimeter side strengths", 0, 255);
  }
  if (geometry.detection.perimeterSignedSideStrengths !== undefined) {
    assertNumberTuple(geometry.detection.perimeterSignedSideStrengths, "Worker signed perimeter side strengths", -255, 255);
  }
  if (geometry.detection.perimeterSidePolarityConsistency !== undefined) {
    assertNumberTuple(geometry.detection.perimeterSidePolarityConsistency, "Worker perimeter polarity consistency", 0, 1);
  }
  if (geometry.detection.perimeterSidePolarity !== undefined) {
    assertPolarityTuple(geometry.detection.perimeterSidePolarity, "Worker perimeter polarity");
  }
  assertFiniteCorners(geometry.corners, "Worker geometry corners");
  if (geometry.detectedCorners === null || geometry.detectedCorners === undefined) {
    throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", "Worker detected Ready geometry omitted its detected corners.");
  }
  assertFiniteCorners(geometry.detectedCorners, "Worker detected corners");
  if (JSON.stringify(geometry.detectedCorners) !== JSON.stringify(geometry.corners)) {
    throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", "Worker detected corners did not match its authoritative corners.");
  }
  if (!geometry.boundingBox || typeof geometry.boundingBox !== "object") {
    throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", "Worker Ready geometry bounding box was missing or malformed.");
  }
  assertExactKeys(geometry.boundingBox, ["x", "y", "width", "height"], "Worker geometry bounding box");
  const box = geometry.boundingBox as unknown as Record<string, unknown>;
  assertFiniteBounded(box.x, "Worker geometry bounding box x", 0, geometry.image.width);
  assertFiniteBounded(box.y, "Worker geometry bounding box y", 0, geometry.image.height);
  assertFiniteBounded(box.width, "Worker geometry bounding box width", 1, geometry.image.width);
  assertFiniteBounded(box.height, "Worker geometry bounding box height", 1, geometry.image.height);
  if ((box.x as number) + (box.width as number) > geometry.image.width || (box.y as number) + (box.height as number) > geometry.image.height) {
    throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", "Worker geometry bounding box escaped its source image.");
  }
  const cornerPoints = Object.values(geometry.corners as NonNullable<typeof geometry.corners>);
  const cornerXs = cornerPoints.map((point) => point.x);
  const cornerYs = cornerPoints.map((point) => point.y);
  const roundToThree = (value: number): number => Math.round(value * 1_000) / 1_000;
  const expectedBox = {
    x: roundToThree(Math.min(...cornerXs)),
    y: roundToThree(Math.min(...cornerYs)),
    width: roundToThree(Math.max(...cornerXs) - Math.min(...cornerXs)),
    height: roundToThree(Math.max(...cornerYs) - Math.min(...cornerYs)),
  };
  if (
    box.x !== expectedBox.x || box.y !== expectedBox.y ||
    box.width !== expectedBox.width || box.height !== expectedBox.height
  ) {
    throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", "Worker geometry bounding box did not match its authoritative corners.");
  }
  if (geometry.detection.backgroundColor !== undefined) {
    if (!geometry.detection.backgroundColor || typeof geometry.detection.backgroundColor !== "object") {
      throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", "Worker geometry background color was malformed.");
    }
    assertExactKeys(geometry.detection.backgroundColor, ["r", "g", "b"], "Worker geometry background color");
    assertFiniteBounded(geometry.detection.backgroundColor.r, "Worker background red", 0, 255, true);
    assertFiniteBounded(geometry.detection.backgroundColor.g, "Worker background green", 0, 255, true);
    assertFiniteBounded(geometry.detection.backgroundColor.b, "Worker background blue", 0, 255, true);
  }
  if (geometry.detection.perimeterClosestRejectedCandidate !== undefined) {
    const rejected = geometry.detection.perimeterClosestRejectedCandidate;
    if (!rejected || typeof rejected !== "object") {
      throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", "Worker rejected-candidate diagnostics were malformed.");
    }
    assertExactKeys(rejected, [
      "reasons", "measuredAspectRatio", "cardCoverage", "clearance", "sideStrengths", "signedSideStrengths",
      "sidePolarityConsistency", "sidePolarity",
    ], "Worker rejected-candidate diagnostics");
    assertReasonList(rejected.reasons, "Worker rejected-candidate reasons");
    assertFiniteBounded(rejected.measuredAspectRatio, "Worker rejected-candidate aspect ratio", 0, 10);
    assertFiniteBounded(rejected.cardCoverage, "Worker rejected-candidate coverage", 0, 1);
    assertFiniteBounded(rejected.clearance, "Worker rejected-candidate clearance", 0, MAX_IMAGE_DIMENSION);
    assertNumberTuple(rejected.sideStrengths, "Worker rejected-candidate side strengths", 0, 255);
    assertNumberTuple(rejected.signedSideStrengths, "Worker rejected-candidate signed strengths", -255, 255);
    assertNumberTuple(rejected.sidePolarityConsistency, "Worker rejected-candidate polarity consistency", 0, 1);
    assertPolarityTuple(rejected.sidePolarity, "Worker rejected-candidate polarity");
  }
  if (geometry.detection.method === "perimeter_gradient_rectangle_v3") {
    for (const value of [
      geometry.detection.perimeterGradientStrength,
      geometry.detection.perimeterSideStrengths,
      geometry.detection.perimeterSignedSideStrengths,
      geometry.detection.perimeterSidePolarityConsistency,
      geometry.detection.perimeterSidePolarity,
      geometry.detection.perimeterCandidateCount,
      geometry.detection.perimeterProvisionalCandidateCount,
    ]) {
      if (value === undefined) {
        throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", "Worker Ready perimeter authority omitted required diagnostics.");
      }
    }
  }
  const source = request.sources.find((candidate) => candidate.role === authority.authoritativeRole);
  const allOnSource = request.sources[0]!;
  const acceptedSource = request.sources[1]!;
  if (
    authority.version !== "fixed-rig-full-resolution-geometry-authority-v1" ||
    !source ||
    authority.primaryRole !== "all_on" ||
    authority.source.role !== source.role ||
    authority.source.sourceSha256 !== source.sha256 ||
    authority.source.sourceByteSize !== source.byteSize ||
    authority.source.sourceImageId !== source.sourceImageId ||
    authority.source.sourceFrameId !== source.sourceFrameId ||
    authority.source.image.width !== source.imageWidth ||
    authority.source.image.height !== source.imageHeight ||
    authority.source.geometry.image.width !== source.imageWidth ||
    authority.source.geometry.image.height !== source.imageHeight ||
    authority.source.geometry.image.coordinateFrame !== authority.source.image.coordinateFrame ||
    authority.source.geometry.side !== request.identity.side ||
    authority.source.geometry.sourceImageId !== source.sourceImageId ||
    authority.source.geometry.sourceFrameId !== source.sourceFrameId ||
    authority.source.geometry.timestamp !== source.timestamp ||
    authority.source.geometry.detectionPolicy !== "captured_evidence_full" ||
    authority.source.geometry.geometrySource !== "detected" ||
    authority.source.geometry.captureMode !== "automatic_detection" ||
    authority.source.geometry.confidenceBasis !== "automatic_detection" ||
    authority.source.geometry.detectionUsed !== true || authority.source.geometry.manualOverrideUsed !== false ||
    authority.source.geometry.placementState !== "ready" || authority.source.geometry.corners === null ||
    authority.source.geometry.rotationDegrees === null || !Number.isFinite(authority.source.geometry.rotationDegrees)
  ) {
    throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", "Worker geometry authority did not match the exact captured source identity.");
  }
  assertCornersWithinImage(authority.source.geometry.corners, source.imageWidth, source.imageHeight, "Worker authoritative corners");
  if (allOnSource.imageWidth !== acceptedSource.imageWidth || allOnSource.imageHeight !== acceptedSource.imageHeight) {
    throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", "Worker authority primary captured-role dimensions did not match.");
  }
  if (!Array.isArray(authority.inspectedRoles) || !Array.isArray(authority.consensus?.agreeingRoles)) {
    throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", "Worker authority inspection or consensus metadata is missing.");
  }
  if (typeof authority.consensus.required !== "boolean" || authority.inspectedRoles.length > expectedRoles().length) {
    throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", "Worker authority consensus primitives were invalid.");
  }
  const inspectedRoles = authority.inspectedRoles.map((inspection) => inspection.role);
  const agreeingRoles = authority.consensus.agreeingRoles;
  if (new Set(inspectedRoles).size !== inspectedRoles.length || new Set(agreeingRoles).size !== agreeingRoles.length) {
    throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", "Worker authority contains duplicate inspected or agreeing roles.");
  }
  for (const inspection of authority.inspectedRoles) {
    if (!inspection || typeof inspection !== "object") {
      throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", "Worker authority inspection was malformed.");
    }
    assertExactKeys(inspection, [
      "role", "authorityEligibility", "sourceSha256", "sourceByteSize", "placementState", "adjustmentReason",
      "confidence", "corners", "rotationDegrees", "detectionMethod", "warnings",
    ], "Worker authority inspection");
    const inspectedSource = request.sources.find((candidate) => candidate.role === inspection.role);
    const expectedEligibility = inspection.role === "all_on"
      ? "primary"
      : inspection.role === "accepted_profile" ? "secondary" : "directional_consensus";
    if (
      !inspectedSource || inspection.authorityEligibility !== expectedEligibility ||
      inspection.sourceSha256 !== inspectedSource.sha256 || inspection.sourceByteSize !== inspectedSource.byteSize ||
      typeof inspection.confidence !== "number" || !Number.isFinite(inspection.confidence)
    ) {
      throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", "Worker authority inspection did not match its exact source role.");
    }
    assertExactEnum(inspection.placementState, ["not_detected", "adjust_card", "ready"], `Worker ${inspection.role} placement state`);
    if (inspection.placementState === "ready") {
      if (inspection.adjustmentReason !== null || inspection.corners === null || inspection.rotationDegrees === null) {
        throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", `Worker ${inspection.role} Ready inspection contradicted its geometry or reason.`);
      }
    } else if (inspection.placementState === "not_detected") {
      if (inspection.adjustmentReason !== "not_detected" || inspection.corners !== null || inspection.rotationDegrees !== null) {
        throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", `Worker ${inspection.role} not-detected inspection contradicted its geometry or reason.`);
      }
    } else {
      assertExactEnum(inspection.adjustmentReason, [
        "outside_frame", "unsafe_scale", "rotate_top_up", "wrong_aspect", "low_confidence",
      ], `Worker ${inspection.role} adjustment reason`);
      if (inspection.corners === null || inspection.rotationDegrees === null) {
        throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", `Worker ${inspection.role} Adjust Card inspection omitted detected geometry.`);
      }
    }
    assertFiniteBounded(inspection.confidence, `Worker ${inspection.role} confidence`, 0, 1);
    assertExactEnum(
      inspection.detectionMethod,
      ["solid_plate_color_component_pca_v2", "perimeter_gradient_rectangle_v3"],
      `Worker ${inspection.role} detection method`,
    );
    assertBoundedTextArray(inspection.warnings, `Worker ${inspection.role} warnings`);
    if (inspection.corners !== null) assertFiniteCorners(inspection.corners, `Worker ${inspection.role} inspection corners`);
    if (inspection.rotationDegrees !== null) {
      assertFiniteBounded(inspection.rotationDegrees, `Worker ${inspection.role} rotation`, -180, 180);
    }
    if (inspection.placementState === "ready" && inspection.corners !== null) {
      assertCornersWithinImage(inspection.corners, inspectedSource.imageWidth, inspectedSource.imageHeight, `Worker ${inspection.role} inspection corners`);
    }
  }
  const authoritativeInspection = authority.inspectedRoles.find((inspection) => inspection.role === authority.authoritativeRole);
  if (
    !authoritativeInspection ||
    authoritativeInspection.placementState !== authority.source.geometry.placementState ||
    authoritativeInspection.adjustmentReason !== authority.source.geometry.adjustmentReason ||
    authoritativeInspection.confidence !== authority.source.geometry.confidence ||
    JSON.stringify(authoritativeInspection.corners) !== JSON.stringify(authority.source.geometry.corners) ||
    authoritativeInspection.rotationDegrees !== authority.source.geometry.rotationDegrees ||
    authoritativeInspection.detectionMethod !== authority.source.geometry.detection.method ||
    JSON.stringify(authoritativeInspection.warnings) !== JSON.stringify(authority.source.geometry.warnings)
  ) {
    throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", "Worker authoritative inspection did not match its geometry source.");
  }
  for (const role of agreeingRoles) {
    const inspection = authority.inspectedRoles.find((candidate) => candidate.role === role);
    if (!inspection || inspection.placementState !== "ready" || !inspection.corners || inspection.rotationDegrees == null) {
      throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", "Worker consensus included a source that was not inspected Ready.");
    }
  }
  if (authority.resolution === "primary_all_on") {
    const acceptedReady = authority.inspectedRoles[1]?.placementState === "ready";
    const expectedAgreeing = acceptedReady ? ["all_on", "accepted_profile"] : ["all_on"];
    if (
      authority.authoritativeRole !== "all_on" || authority.consensus.required !== false ||
      !sameOrderedRoles(inspectedRoles, ["all_on", "accepted_profile"]) ||
      !sameOrderedRoles(agreeingRoles, expectedAgreeing)
    ) {
      throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", "Primary worker authority did not preserve exact all-on inspection and consensus semantics.");
    }
  } else if (authority.resolution === "secondary_accepted_profile_consensus") {
    const expectedAgreeing = [
      "accepted_profile",
      ...authority.inspectedRoles.filter((inspection) => /^channel_[1-8]$/.test(inspection.role) && inspection.placementState === "ready").map((inspection) => inspection.role),
    ];
    if (
      authority.authoritativeRole !== "accepted_profile" || authority.consensus.required !== true ||
      !sameOrderedRoles(inspectedRoles, expectedRoles()) || agreeingRoles[0] !== "accepted_profile" ||
      agreeingRoles.length < 2 || agreeingRoles.includes("all_on") ||
      agreeingRoles.slice(1).some((role) => !/^channel_[1-8]$/.test(role)) ||
      !sameOrderedRoles(agreeingRoles, expectedAgreeing) || authority.inspectedRoles[0]?.placementState === "ready"
    ) {
      throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", "Secondary worker authority did not preserve exact captured-role consensus semantics.");
    }
  } else {
    throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", "Worker authority cannot claim a manual or unknown resolution.");
  }
  assertFiniteNonNegative(authority.consensus.maximumCornerDeltaPixels, "Worker consensus corner delta", MAX_IMAGE_DIMENSION);
  assertFiniteNonNegative(authority.consensus.maximumRotationDeltaDegrees, "Worker consensus rotation delta", 180);
  const agreeingInspections = agreeingRoles.map((role) => authority.inspectedRoles.find((inspection) => inspection.role === role)!);
  const agreeingSources = agreeingRoles.map((role) => request.sources.find((candidate) => candidate.role === role)!);
  if (agreeingSources.some((candidate) =>
    candidate.imageWidth !== agreeingSources[0]!.imageWidth || candidate.imageHeight !== agreeingSources[0]!.imageHeight)) {
    throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", "Worker consensus claimed agreement across mismatched source dimensions.");
  }
  let expectedMaximumCornerDelta = 0;
  let expectedMaximumRotationDelta = 0;
  for (let leftIndex = 0; leftIndex < agreeingInspections.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < agreeingInspections.length; rightIndex += 1) {
      const left = agreeingInspections[leftIndex]!;
      const right = agreeingInspections[rightIndex]!;
      const currentCornerDelta = cornerDelta(left.corners!, right.corners!);
      const currentRotationDelta = rotationDelta(left.rotationDegrees!, right.rotationDegrees!);
      const leftSource = request.sources.find((candidate) => candidate.role === left.role)!;
      const rightSource = request.sources.find((candidate) => candidate.role === right.role)!;
      const tolerance = Math.min(leftSource.imageWidth, leftSource.imageHeight, rightSource.imageWidth, rightSource.imageHeight) * 0.025;
      if (currentCornerDelta > tolerance || currentRotationDelta > 3) {
        throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", "Worker consensus sources did not agree pairwise.");
      }
      expectedMaximumCornerDelta = Math.max(expectedMaximumCornerDelta, currentCornerDelta);
      expectedMaximumRotationDelta = Math.max(expectedMaximumRotationDelta, currentRotationDelta);
    }
  }
  const roundedCornerDelta = Math.round(expectedMaximumCornerDelta * 1000) / 1000;
  const roundedRotationDelta = Math.round(expectedMaximumRotationDelta * 1000) / 1000;
  if (
    authority.consensus.maximumCornerDeltaPixels !== roundedCornerDelta ||
    authority.consensus.maximumRotationDeltaDegrees !== roundedRotationDelta
  ) {
    throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", "Worker consensus metrics did not match the inspected captured roles.");
  }
  assertPathFreeAuthorityValue(authority);
  const serialized = JSON.stringify(authority);
  if (
    Buffer.byteLength(serialized, "utf8") > MAX_PROTOCOL_BYTES ||
    /(?:output|local|source)?filePath|localOutputPath|sourceImagePath|imageBytes|imageBody|blob|buffer|base64|dataUrl/i.test(serialized) ||
    /[A-Za-z]:[\\/]|\\\\[^\\]|\/(?:Users|home|var|tmp|private)\//i.test(serialized)
  ) {
    throw new FixedRigProcessingWorkerProtocolError("authority_identity_failed", "Worker geometry authority is not bounded and path-free.");
  }
}

export async function executeFixedRigProcessingWorkerRequest(
  request: FixedRigProcessingWorkerRequest,
  allowedOutputRoot: string,
): Promise<FixedRigProcessingWorkerSuccessResponse> {
  const resolved = await resolveRequestSources(request, allowedOutputRoot);
  const authority = await resolveFixedRigFullResolutionGeometryAuthorityInProcess(resolved.input);
  await resolved.verifyUnchanged();
  validateFixedRigProcessingWorkerAuthority(request, authority);
  return {
    protocolVersion: FIXED_RIG_PROCESSING_WORKER_PROTOCOL_VERSION,
    operation: FIXED_RIG_PROCESSING_WORKER_OPERATION,
    ok: true,
    identity: { ...request.identity },
    authority,
  };
}

export function fixedRigProcessingWorkerSafeError(error: unknown): string {
  if (error instanceof FixedRigProcessingWorkerProtocolError) {
    const messages: Record<FixedRigProcessingWorkerProtocolError["code"], string> = {
      invalid_request: "Captured-evidence processing request was invalid; processing stopped.",
      containment_failed: "Captured-evidence package containment verification failed; processing stopped.",
      source_identity_failed: "Captured-evidence source identity verification failed; processing stopped.",
      source_integrity_failed: "Captured-evidence source integrity verification failed; processing stopped.",
      authority_identity_failed: "Captured-evidence geometry authority verification failed; processing stopped.",
    };
    return messages[error.code];
  }
  return "Captured-evidence geometry processing failed safely; processing stopped.";
}
