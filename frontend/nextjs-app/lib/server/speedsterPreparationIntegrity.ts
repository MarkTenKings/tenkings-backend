import { createHash } from "node:crypto";
import { sanitizeSpeedsterUnitQuad } from "../ai-grader-v2/geometry";
import { parseSpeedsterColorGeometryProposal } from "../ai-grader-v2/color-geometry";
import {
  SPEEDSTER_PREPARATION_DECODER,
  SPEEDSTER_PREPARATION_FRAME,
  SPEEDSTER_PREPARATION_ROLES,
  SPEEDSTER_PREPARATION_VERSION,
  type SpeedsterPreparationIdentity,
  type SpeedsterPreparationInput,
  type SpeedsterPreparationManifestBody,
  type SpeedsterPreparationRole,
  type SpeedsterPreparationScope,
} from "../ai-grader-v2/preparation";
import { isAuthorizedSpeedsterOriginalStorageKey } from "./aiGraderV2IphoneCapture";

export class SpeedsterPreparationConflict extends Error {
  readonly statusCode = 409;
}

export function preparationRequire(condition: unknown, message: string): asserts condition {
  if (!condition) throw new SpeedsterPreparationConflict(message);
}

export function preparationCanonicalJson(value: unknown): string {
  const normalize = (entry: unknown): unknown => {
    if (entry === null || typeof entry === "string" || typeof entry === "boolean") return entry;
    if (typeof entry === "number" && Number.isFinite(entry)) return Object.is(entry, -0) ? 0 : entry;
    if (Array.isArray(entry)) return entry.map(normalize);
    if (entry && typeof entry === "object" && Object.getPrototypeOf(entry) === Object.prototype) {
      return Object.fromEntries(Object.keys(entry).sort().map((key) => [key, normalize((entry as Record<string, unknown>)[key])]));
    }
    throw new SpeedsterPreparationConflict("Preparation evidence contains a non-JSON value.");
  };
  return JSON.stringify(normalize(value));
}

export function preparationHash(value: unknown): string {
  return createHash("sha256").update(preparationCanonicalJson(value)).digest("hex");
}

export function preparationBytesHash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function preparationSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export function preparationUuid(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
}

export function assertPreparationScope(scope: SpeedsterPreparationScope): void {
  preparationRequire([scope.createdByUserId, scope.sessionId].every((entry) =>
    typeof entry === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(entry)), "Preparation scope is invalid.");
  preparationRequire(scope.side === "FRONT" || scope.side === "BACK", "Preparation side is invalid.");
}

function preparationPrefix(scope: SpeedsterPreparationScope): string {
  assertPreparationScope(scope);
  return `ai-grader-v2/${scope.createdByUserId}/${scope.sessionId}`;
}

export function preparationSourceKey(scope: SpeedsterPreparationScope, sha256: string, format: "jpeg" | "png" | "webp"): string {
  preparationRequire(preparationSha256(sha256) && ["jpeg", "png", "webp"].includes(format), "Frozen source identity is invalid.");
  return `${preparationPrefix(scope)}/source-evidence/${sha256}.${format === "jpeg" ? "jpg" : format}`;
}

export function preparationStagingKey(scope: SpeedsterPreparationScope, attemptId: string, role: SpeedsterPreparationRole): string {
  preparationRequire(preparationUuid(attemptId) && SPEEDSTER_PREPARATION_ROLES.includes(role), "Preparation staging identity is invalid.");
  return `${preparationPrefix(scope)}/prepare-staging/${scope.side.toLowerCase()}/${attemptId}/${role.toLowerCase()}.webp`;
}

export function preparationArtifactKey(scope: SpeedsterPreparationScope, attemptId: string, role: SpeedsterPreparationRole, sha256: string): string {
  preparationRequire(preparationUuid(attemptId) && SPEEDSTER_PREPARATION_ROLES.includes(role) && preparationSha256(sha256), "Prepared artifact identity is invalid.");
  return `${preparationPrefix(scope)}/prepared-evidence/${scope.side.toLowerCase()}/${attemptId}/${role.toLowerCase()}-${sha256}.webp`;
}

export function assertPreparationIdentity(value: SpeedsterPreparationIdentity, approved?: SpeedsterPreparationIdentity): void {
  preparationRequire(value && value.version === "speedster-preparation-identity-v1"
    && /^[a-f0-9]{40}$/.test(value.sourceCommitSha) && /^[a-f0-9]{40}$/.test(value.sourceTreeSha)
    && /^sha256:[a-f0-9]{64}$/.test(value.ociDigest)
    && /^\d+-\d+$/.test(value.buildId)
    && [value.pythonVersion, value.opencvVersion, value.numpyVersion].every((entry) => /^\d+\.\d+\.\d+$/.test(entry))
    && value.decoder === SPEEDSTER_PREPARATION_DECODER
    && value.rectification === "opencv-float32-source-width-height-card-1270x1778-context-40-v1"
    && value.reveals === "lab-clahe-2-8-morph-9-sobel-v1"
    && value.encoding === "opencv-webp-quality-92-v1", "Preparation release identity is invalid.");
  if (approved) preparationRequire(preparationHash(value) === preparationHash(approved), "Preparation release is not admitted.");
}

export function assertPreparationInput(scope: SpeedsterPreparationScope, input: SpeedsterPreparationInput): void {
  assertPreparationScope(scope);
  preparationRequire(input && input.version === SPEEDSTER_PREPARATION_VERSION && input.source, "Preparation input is invalid.");
  const source = input.source;
  preparationRequire(source.decoder === SPEEDSTER_PREPARATION_DECODER
    && Number.isInteger(source.orientation) && source.orientation >= 1 && source.orientation <= 8
    && (source.format !== "webp" || source.orientation === 1)
    && source.originalSha256 === source.sha256 && preparationSha256(source.sha256)
    && Number.isSafeInteger(source.byteCount) && source.byteCount > 0 && source.byteCount <= 50 * 1024 * 1024
    && [source.width, source.height].every((dimension) => Number.isSafeInteger(dimension) && dimension >= 2 && dimension <= 16384)
    && source.width * source.height <= 64 * 1024 * 1024
    && source.storageKey === preparationSourceKey(scope, source.sha256, source.format)
    && isAuthorizedSpeedsterOriginalStorageKey({ storageKey: source.originalStorageKey, userId: scope.createdByUserId, sessionId: scope.sessionId, side: scope.side }),
  "Preparation source is not bound to this exact owned original.");
  const encodedHash = /\/original\/(?:iphone-v[1-9][0-9]*-)?sha256-([a-f0-9]{64})\//.exec(source.originalStorageKey)?.[1];
  preparationRequire(!encodedHash || encodedHash === source.sha256, "Original generation checksum differs from frozen bytes.");
  const quad = sanitizeSpeedsterUnitQuad(input.physicalQuad);
  preparationRequire(quad && preparationHash(quad) === input.physicalQuadSha256
    && preparationHash(quad) === preparationHash(input.physicalQuad), "Preparation physical geometry is invalid.");
  preparationRequire(["BLACK", "WHITE", "MAGENTA"].includes(input.matColor), "Preparation mat color is invalid.");
  assertPreparationIdentity(input.preparationIdentity);
}

export function assertPreparationTransform(input: SpeedsterPreparationInput, transform: readonly number[], frame: unknown): void {
  preparationRequire(Array.isArray(transform) && transform.length === 9 && transform.every((entry) => typeof entry === "number" && Number.isFinite(entry)), "Preparation transform must contain nine finite numbers.");
  preparationRequire(preparationHash(frame) === preparationHash(SPEEDSTER_PREPARATION_FRAME), "Preparation inspection frame does not match the admitted contract.");
  const scale = Math.max(...transform.map(Math.abs));
  preparationRequire(scale > 0, "Preparation transform is singular.");
  const h = transform.map((entry) => entry / scale);
  const determinant = h[0] * (h[4] * h[8] - h[5] * h[7]) - h[1] * (h[3] * h[8] - h[5] * h[6]) + h[2] * (h[3] * h[7] - h[4] * h[6]);
  preparationRequire(Number.isFinite(determinant) && determinant !== 0, "Preparation transform is singular.");
  const target = [[0, 0], [1269, 0], [1269, 1777], [0, 1777]];
  let denominatorSign = 0;
  input.physicalQuad.forEach((point, index) => {
    // Exactly the OpenCV input convention: normalized * dimension, then float32.
    const x = Math.fround(point.x * input.source.width);
    const y = Math.fround(point.y * input.source.height);
    const denominator = h[6] * x + h[7] * y + h[8];
    preparationRequire(Number.isFinite(denominator) && Math.abs(denominator) > 1e-12, "Preparation transform crosses a projective pole.");
    const sign = Math.sign(denominator);
    preparationRequire(!denominatorSign || denominatorSign === sign, "Preparation transform crosses the physical card.");
    denominatorSign = sign;
    const actualX = (h[0] * x + h[1] * y + h[2]) / denominator;
    const actualY = (h[3] * x + h[4] * y + h[5]) / denominator;
    preparationRequire(Math.abs(actualX - target[index][0]) <= 0.01 && Math.abs(actualY - target[index][1]) <= 0.01,
      "Preparation transform does not map the confirmed physical corners to the canonical card.");
  });
}

export function assertPreparationManifest(body: SpeedsterPreparationManifestBody): void {
  assertPreparationInput(body, body.input);
  preparationRequire(body.version === SPEEDSTER_PREPARATION_VERSION && preparationUuid(body.attemptId)
    && Number.isSafeInteger(body.sideRevision) && body.sideRevision >= 1 && preparationSha256(body.printedColorResultSha256), "Preparation manifest identity is invalid.");
  const printedColor = parseSpeedsterColorGeometryProposal(body.printedColorResult, { mode: "PRINTED_FRAME", matColor: body.input.matColor });
  preparationRequire(typeof body.printedColorReceipt === "string" && body.printedColorReceipt.length > 0 && body.printedColorReceipt.length <= 16384,
    "Preparation manifest lacks its original printed Color receipt.");
  preparationRequire(preparationHash(printedColor) === body.printedColorResultSha256
    && preparationHash(body.printedColorResult) === body.printedColorResultSha256, "Preparation printed Color result is inconsistent.");
  preparationRequire(body.artifacts && preparationHash(Object.keys(body.artifacts).sort()) === preparationHash([...SPEEDSTER_PREPARATION_ROLES].sort()), "Preparation manifest must contain exactly five roles.");
  for (const role of SPEEDSTER_PREPARATION_ROLES) {
    const artifact = body.artifacts[role];
    preparationRequire(artifact && artifact.format === "webp" && preparationSha256(artifact.sha256)
      && Number.isSafeInteger(artifact.byteCount) && artifact.byteCount > 0 && artifact.byteCount <= 50 * 1024 * 1024
      && artifact.width === (role === "RECTIFIED" ? 1270 : 1350)
      && artifact.height === (role === "RECTIFIED" ? 1778 : 1858)
      && artifact.storageKey === preparationArtifactKey(body, body.attemptId, role, artifact.sha256), "Prepared artifact does not match its exact role and attempt.");
  }
  assertPreparationTransform(body.input, body.transform, body.inspectionFrame);
}
