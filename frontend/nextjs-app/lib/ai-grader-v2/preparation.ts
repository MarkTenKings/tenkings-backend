import type { SpeedsterCardSide, SpeedsterQuad } from "./contracts";
import type { SpeedsterColorGeometryProposal, SpeedsterMatColor } from "./color-geometry";
import type { SpeedsterInspectionFrame } from "./inspection-frame";

export const SPEEDSTER_PREPARATION_VERSION = "speedster-prepared-evidence-v1" as const;
export const SPEEDSTER_PREPARATION_DECODER = "original-single-frame-exif-oriented-raster-v1" as const;
export const SPEEDSTER_PREPARATION_ROLES = ["RECTIFIED", "INSPECTION", "NORMALIZED", "MICRO_DEFECT", "DIRECTIONAL"] as const;
export type SpeedsterPreparationRole = typeof SPEEDSTER_PREPARATION_ROLES[number];

// Matches card_geometry.py: a 1270 x 1778 card and 2 mm (40 px) context.
export const SPEEDSTER_PREPARATION_FRAME: Readonly<SpeedsterInspectionFrame> = Object.freeze({
  width: 1350,
  height: 1858,
  cardBounds: Object.freeze({ x: 40, y: 40, width: 1270, height: 1778 }),
});

export type SpeedsterPreparationIdentity = Readonly<{
  version: "speedster-preparation-identity-v1";
  sourceCommitSha: string;
  sourceTreeSha: string;
  ociDigest: string;
  buildId: string;
  pythonVersion: string;
  opencvVersion: string;
  numpyVersion: string;
  decoder: typeof SPEEDSTER_PREPARATION_DECODER;
  rectification: "opencv-float32-source-width-height-card-1270x1778-context-40-v1";
  reveals: "lab-clahe-2-8-morph-9-sobel-v1";
  encoding: "opencv-webp-quality-92-v1";
}>;

export type SpeedsterPreparationScope = Readonly<{
  sessionId: string;
  createdByUserId: string;
  side: SpeedsterCardSide;
}>;

export type SpeedsterPreparationSource = Readonly<{
  originalStorageKey: string;
  originalSha256: string;
  storageKey: string;
  sha256: string;
  byteCount: number;
  width: number;
  height: number;
  format: "jpeg" | "png" | "webp";
  orientation: number;
  decoder: typeof SPEEDSTER_PREPARATION_DECODER;
}>;

export type SpeedsterPreparationInput = Readonly<{
  version: typeof SPEEDSTER_PREPARATION_VERSION;
  source: SpeedsterPreparationSource;
  physicalQuad: SpeedsterQuad;
  physicalQuadSha256: string;
  matColor: SpeedsterMatColor;
  preparationIdentity: SpeedsterPreparationIdentity;
}>;

export type SpeedsterPreparationWorkerEvidence = Readonly<{
  attemptId: string;
  dispatchClaimId: string;
  requestSha256: string;
  inputSha256: string;
  sourceSha256: string;
  source: Omit<SpeedsterPreparationSource, "originalStorageKey" | "originalSha256" | "storageKey">;
}>;

export type SpeedsterPreparationArtifact = Readonly<{
  storageKey: string;
  sha256: string;
  byteCount: number;
  width: number;
  height: number;
  format: "webp";
}>;

export type SpeedsterPreparationManifestBody = SpeedsterPreparationScope & Readonly<{
  version: typeof SPEEDSTER_PREPARATION_VERSION;
  attemptId: string;
  sideRevision: number;
  input: SpeedsterPreparationInput;
  artifacts: Readonly<Record<SpeedsterPreparationRole, SpeedsterPreparationArtifact>>;
  transform: readonly number[];
  inspectionFrame: SpeedsterInspectionFrame;
  // The authenticated worker's actual response is bound before receipt issuance.
  printedColorResultSha256: string;
  printedColorResult: SpeedsterColorGeometryProposal;
  printedColorReceipt: string;
}>;

export type SpeedsterPreparationReference = SpeedsterPreparationScope & Readonly<{
  version: typeof SPEEDSTER_PREPARATION_VERSION;
  attemptId: string;
  sideRevision: number;
  manifestId: string;
  manifestSha256: string;
}>;

export type SpeedsterPreparationExpectedHead = Readonly<{
  sideRevision: number;
  attemptId: string | null;
}>;

export type SpeedsterPreparationState = "READY" | "RUNNING_OR_UNRESOLVED" | "ADOPTED" | "FAILED" | "SUPERSEDED";

/** A reference is only a selector. The server must load and validate its record. */
export function parseSpeedsterPreparationReference(value: unknown): SpeedsterPreparationReference | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.version !== SPEEDSTER_PREPARATION_VERSION
    || (row.side !== "FRONT" && row.side !== "BACK")
    || !Number.isSafeInteger(row.sideRevision) || Number(row.sideRevision) < 1
    || typeof row.manifestSha256 !== "string" || !/^[a-f0-9]{64}$/.test(row.manifestSha256)
    || ![row.sessionId, row.createdByUserId, row.attemptId, row.manifestId]
      .every((entry) => typeof entry === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(entry))) return null;
  return {
    version: SPEEDSTER_PREPARATION_VERSION,
    sessionId: row.sessionId as string,
    createdByUserId: row.createdByUserId as string,
    side: row.side,
    sideRevision: row.sideRevision as number,
    attemptId: row.attemptId as string,
    manifestId: row.manifestId as string,
    manifestSha256: row.manifestSha256,
  };
}
