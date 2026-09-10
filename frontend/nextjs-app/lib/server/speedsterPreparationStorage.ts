import sharp from "sharp";
import { parseSpeedsterColorGeometryProposal } from "../ai-grader-v2/color-geometry";
import {
  SPEEDSTER_PREPARATION_DECODER,
  SPEEDSTER_PREPARATION_ROLES,
  SPEEDSTER_PREPARATION_VERSION,
  type SpeedsterPreparationArtifact,
  type SpeedsterPreparationIdentity,
  type SpeedsterPreparationInput,
  type SpeedsterPreparationManifestBody,
  type SpeedsterPreparationRole,
  type SpeedsterPreparationScope,
  type SpeedsterPreparationSource,
  type SpeedsterPreparationWorkerEvidence,
} from "../ai-grader-v2/preparation";
import type { SpeedsterInspectionFrame } from "../ai-grader-v2/inspection-frame";
import {
  AI_GRADER_STORAGE_MAX_OBJECT_BYTES,
  createPrivatePreparationEvidenceBuffer,
  isStorageCreateConflict,
  isStorageObjectNotFoundError,
  readStorageBufferBounded,
} from "./storage";
import {
  assertPreparationIdentity,
  assertPreparationInput,
  assertPreparationManifest,
  assertPreparationScope,
  assertPreparationTransform,
  preparationArtifactKey,
  preparationBytesHash,
  preparationHash,
  preparationRequire,
  preparationSourceKey,
  preparationStagingKey,
} from "./speedsterPreparationIntegrity";
import { isAuthorizedSpeedsterOriginalStorageKey } from "./aiGraderV2IphoneCapture";

export type SpeedsterPreparationStorage = Readonly<{
  read: (storageKey: string, maxBytes: number) => Promise<Buffer>;
  create: typeof createPrivatePreparationEvidenceBuffer;
}>;

const storageAdapter: SpeedsterPreparationStorage = {
  read: readStorageBufferBounded,
  create: createPrivatePreparationEvidenceBuffer,
};

async function exactRead(key: string, storage: SpeedsterPreparationStorage): Promise<Buffer> {
  // Take ownership: even an adapter that reuses buffers cannot change hashed bytes.
  const bytes = Buffer.from(await storage.read(key, AI_GRADER_STORAGE_MAX_OBJECT_BYTES));
  preparationRequire(bytes.length > 0 && bytes.length <= AI_GRADER_STORAGE_MAX_OBJECT_BYTES, "Preparation object exceeds the byte limit.");
  return bytes;
}

export async function inspectSpeedsterPreparationSourceBytes(bytes: Buffer): Promise<Readonly<{ width: number; height: number; orientation: number; format: "jpeg" | "png" | "webp" }>> {
  const decoder = sharp(bytes, { failOn: "warning", limitInputPixels: 64 * 1024 * 1024 });
  const metadata = await decoder.metadata();
  preparationRequire(["jpeg", "png", "webp"].includes(metadata.format ?? "")
    && (metadata.pages ?? 1) === 1 && Number.isInteger(metadata.orientation ?? 1)
    && (metadata.orientation ?? 1) >= 1 && (metadata.orientation ?? 1) <= 8
    && metadata.width && metadata.height && metadata.width >= 2 && metadata.height >= 2
    && metadata.width <= 16384 && metadata.height <= 16384
    && metadata.width * metadata.height <= 64 * 1024 * 1024,
  "Preparation requires a single-frame JPEG, PNG or WebP with valid EXIF orientation.");
  // Metadata alone accepts damaged/truncated rasters. stats forces full decoding.
  await decoder.stats();
  const orientation = metadata.orientation ?? 1;
  preparationRequire(metadata.format !== "webp" || orientation === 1,
    "This WebP has unsupported orientation metadata. Its photo is preserved; select the original JPEG or PNG before preparing.");
  const rotated = orientation >= 5;
  return { width: rotated ? metadata.height : metadata.width, height: rotated ? metadata.width : metadata.height, orientation, format: metadata.format as "jpeg" | "png" | "webp" };
}

async function freezeExactBytes(key: string, bytes: Buffer, format: "jpeg" | "png" | "webp", storage: SpeedsterPreparationStorage): Promise<void> {
  const sha256 = preparationBytesHash(bytes);
  try {
    const existing = await exactRead(key, storage);
    preparationRequire(preparationBytesHash(existing) === sha256, "Existing preparation evidence conflicts; it cannot be overwritten.");
    return;
  } catch (error) {
    if (!isStorageObjectNotFoundError(error)) throw error;
  }
  try {
    await storage.create(key, bytes, `image/${format}`, sha256);
  } catch (error) {
    if (!isStorageCreateConflict(error)) throw error;
  }
  preparationRequire(preparationBytesHash(await exactRead(key, storage)) === sha256,
    "Frozen preparation evidence failed exact-byte verification.");
}

export async function freezeSpeedsterPreparationSource(
  scope: SpeedsterPreparationScope,
  originalStorageKey: string,
  storage: SpeedsterPreparationStorage = storageAdapter,
): Promise<SpeedsterPreparationSource> {
  assertPreparationScope(scope);
  preparationRequire(isAuthorizedSpeedsterOriginalStorageKey({ storageKey: originalStorageKey, userId: scope.createdByUserId, sessionId: scope.sessionId, side: scope.side }), "Original is outside the owned preparation side.");
  const bytes = await exactRead(originalStorageKey, storage);
  const sha256 = preparationBytesHash(bytes);
  const encodedHash = /\/original\/(?:iphone-v[1-9][0-9]*-)?sha256-([a-f0-9]{64})\//.exec(originalStorageKey)?.[1];
  preparationRequire(!encodedHash || encodedHash === sha256, "Original generation checksum differs from its exact bytes.");
  const dimensions = await inspectSpeedsterPreparationSourceBytes(bytes);
  const storageKey = preparationSourceKey(scope, sha256, dimensions.format);
  await freezeExactBytes(storageKey, bytes, dimensions.format, storage);
  return { originalStorageKey, originalSha256: sha256, storageKey, sha256, byteCount: bytes.length, ...dimensions, decoder: SPEEDSTER_PREPARATION_DECODER };
}

/** Must receive metadata directly from the authenticated response, never the browser. */
export async function verifyAndFreezeSpeedsterPreparation(
  attempt: SpeedsterPreparationScope & Readonly<{ id: string; sideRevision: number; input: SpeedsterPreparationInput; requestSha256: string; dispatchClaimId: string | null }>,
  response: Readonly<{
    preparationIdentity: SpeedsterPreparationIdentity;
    preparationEvidence: SpeedsterPreparationWorkerEvidence;
    transform: readonly number[];
    inspectionFrame: SpeedsterInspectionFrame;
    printedColorResult: unknown;
    printedColorReceipt: string;
  }>,
  storage: SpeedsterPreparationStorage = storageAdapter,
): Promise<SpeedsterPreparationManifestBody> {
  assertPreparationInput(attempt, attempt.input);
  assertPreparationIdentity(response.preparationIdentity, attempt.input.preparationIdentity);
  const { originalStorageKey: _original, originalSha256: _originalHash, storageKey: _snapshotKey, ...sourceEvidence } = attempt.input.source;
  preparationRequire(attempt.dispatchClaimId && preparationHash(response.preparationEvidence) === preparationHash({
    attemptId: attempt.id, dispatchClaimId: attempt.dispatchClaimId, requestSha256: attempt.requestSha256,
    inputSha256: preparationHash(attempt.input), sourceSha256: attempt.input.source.sha256, source: sourceEvidence,
  }), "Worker preparation evidence differs from the dispatched source and attempt.");
  assertPreparationTransform(attempt.input, response.transform, response.inspectionFrame);
  const printedColorResult = parseSpeedsterColorGeometryProposal(response.printedColorResult, { mode: "PRINTED_FRAME", matColor: attempt.input.matColor });
  const source = await exactRead(attempt.input.source.storageKey, storage);
  preparationRequire(source.length === attempt.input.source.byteCount && preparationBytesHash(source) === attempt.input.source.sha256, "Frozen preparation source changed.");
  // Validate all five buffers before creating any accepted output. No later copy
  // or second staging read can substitute bytes between hash and final upload.
  const verified = await Promise.all(SPEEDSTER_PREPARATION_ROLES.map(async (role) => {
    const bytes = await exactRead(preparationStagingKey(attempt, attempt.id, role), storage);
    const dimensions = await inspectSpeedsterPreparationSourceBytes(bytes);
    preparationRequire(dimensions.format === "webp" && dimensions.orientation === 1 && dimensions.width === (role === "RECTIFIED" ? 1270 : 1350)
      && dimensions.height === (role === "RECTIFIED" ? 1778 : 1858), "Prepared image type or dimensions do not match its role.");
    const sha256 = preparationBytesHash(bytes);
    const artifact: SpeedsterPreparationArtifact = { storageKey: preparationArtifactKey(attempt, attempt.id, role, sha256), sha256, byteCount: bytes.length, width: dimensions.width, height: dimensions.height, format: "webp" };
    return { role, bytes, artifact };
  }));
  const body: SpeedsterPreparationManifestBody = {
    version: SPEEDSTER_PREPARATION_VERSION,
    sessionId: attempt.sessionId, createdByUserId: attempt.createdByUserId, side: attempt.side,
    attemptId: attempt.id, sideRevision: attempt.sideRevision, input: structuredClone(attempt.input),
    artifacts: Object.fromEntries(verified.map(({ role, artifact }) => [role, artifact])) as Record<SpeedsterPreparationRole, SpeedsterPreparationArtifact>,
    transform: [...response.transform], inspectionFrame: structuredClone(response.inspectionFrame),
    printedColorResultSha256: preparationHash(printedColorResult), printedColorResult, printedColorReceipt: response.printedColorReceipt,
  };
  assertPreparationManifest(body);
  await Promise.all(verified.map(({ bytes, artifact }) => freezeExactBytes(artifact.storageKey, bytes, "webp", storage)));
  return body;
}

/** Storage preflight occurs before any database lock. Never consult the live alias. */
export async function verifySpeedsterPreparationManifestBytes(
  body: SpeedsterPreparationManifestBody,
  storage: SpeedsterPreparationStorage = storageAdapter,
): Promise<void> {
  assertPreparationManifest(body);
  const evidence = [body.input.source, ...SPEEDSTER_PREPARATION_ROLES.map((role) => body.artifacts[role])];
  await Promise.all(evidence.map(async (artifact) => {
    const bytes = await exactRead(artifact.storageKey, storage);
    preparationRequire(bytes.length === artifact.byteCount && preparationBytesHash(bytes) === artifact.sha256, "Adopted preparation bytes changed.");
  }));
}
