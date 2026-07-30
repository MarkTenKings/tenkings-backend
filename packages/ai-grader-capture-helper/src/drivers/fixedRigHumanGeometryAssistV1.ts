import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  AI_GRADER_HUMAN_GEOMETRY_ASSIST_SCHEMA_VERSION,
  AI_GRADER_HUMAN_GEOMETRY_COORDINATE_FRAME,
  AI_GRADER_HUMAN_GEOMETRY_IMAGE_HEIGHT,
  AI_GRADER_HUMAN_GEOMETRY_IMAGE_WIDTH,
  AI_GRADER_HUMAN_GEOMETRY_RECEIPT_SCHEMA_VERSION,
  AI_GRADER_HUMAN_GEOMETRY_SOFTWARE_VERSION,
  AI_GRADER_HUMAN_GEOMETRY_TOOL_VERSION,
  AI_GRADER_OWNER_HUMAN_GEOMETRY_MEASUREMENT_UNCERTAINTY_AUTHORITY_V1,
  POKEMON_TCG_STANDARD_CORNER_PROFILE_ID,
  POKEMON_TCG_STANDARD_CORNER_PROFILE_SHA256,
  POKEMON_TCG_STANDARD_CORNER_PROFILE_VERSION,
  aiGraderHumanGeometryReceiptV1Schema,
  assertAiGraderHumanGeometrySideConfirmedV1,
  buildAiGraderHumanGeometryAssistSideV1,
  canonicalJsonV1,
  aiGraderOwnerHumanGeometryMeasurementUncertaintyAuthorityV1Schema,
  type AiGraderHumanGeometryAssistDraftV1,
  type AiGraderOwnerHumanGeometryMeasurementUncertaintyAuthorityV1,
  type AiGraderHumanGeometryPointV1,
  type AiGraderHumanGeometryReceiptV1,
  type AiGraderHumanGeometrySideV1,
} from "@tenkings/shared";

export const FIXED_RIG_HUMAN_GEOMETRY_ASSIST_V1_VERSION =
  "fixed_rig_human_geometry_assist_v1" as const;

export interface FixedRigHumanGeometryCaptureAuthorityV1 {
  front: { exactCaptureSha256: string; normalizedImageSha256: string };
  back: { exactCaptureSha256: string; normalizedImageSha256: string };
}

export interface FixedRigHumanGeometryReviewV1 {
  version: typeof FIXED_RIG_HUMAN_GEOMETRY_ASSIST_V1_VERSION;
  state: "geometry_review_required" | "locked";
  receiptVersion: number;
  supersedesReceiptSha256: string | null;
  captureAuthority: FixedRigHumanGeometryCaptureAuthorityV1;
  draft: AiGraderHumanGeometryAssistDraftV1;
  lockedReceipt?: AiGraderHumanGeometryReceiptV1;
  receiptPath?: string;
}

type RecordValue = Record<string, unknown>;

function record(value: unknown, label: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is unavailable.`);
  }
  return value as RecordValue;
}

function exactSha(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} SHA-256 is unavailable.`);
  }
  return value;
}

function normalizedSideAuthority(
  warmManifest: unknown,
  side: "front" | "back",
): {
  contour: AiGraderHumanGeometryPointV1[];
  exactCaptureSha256: string;
  normalizedImageSha256: string;
  suggestionReady: boolean;
} {
  const root = record(warmManifest, `${side} processed manifest`);
  if (root.evidenceSide !== side || root.status !== "completed") {
    throw new Error(`${side} processed evidence is not durably complete.`);
  }
  const sideEvidence = record(root[side] ?? root.side, `${side} evidence`);
  const normalizedCard = record(sideEvidence.normalizedCard, `${side} normalized card`);
  const artifact = record(normalizedCard.normalizedArtifact, `${side} normalized artifact`);
  const acceptedProfile = record(sideEvidence.acceptedProfile, `${side} accepted profile`);
  const acceptedCapture = record(acceptedProfile.capture, `${side} exact accepted capture`);
  const allOn = sideEvidence.allOn && typeof sideEvidence.allOn === "object"
    ? sideEvidence.allOn as RecordValue
    : undefined;
  const allOnCapture = allOn?.capture && typeof allOn.capture === "object"
    ? allOn.capture as RecordValue
    : undefined;
  const geometryAuthority =
    sideEvidence.fullResolutionGeometryAuthority &&
    typeof sideEvidence.fullResolutionGeometryAuthority === "object"
      ? sideEvidence.fullResolutionGeometryAuthority as RecordValue
      : undefined;
  const geometrySource =
    geometryAuthority?.source &&
    typeof geometryAuthority.source === "object"
      ? geometryAuthority.source as RecordValue
      : undefined;
  const dense =
    artifact.normalizedDenseContour &&
    typeof artifact.normalizedDenseContour === "object"
      ? artifact.normalizedDenseContour as RecordValue
      : undefined;
  let points = Array.isArray(dense?.points)
    ? dense.points.map((entry) => {
        const candidate = record(entry, `${side} contour point`);
        if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) {
          throw new Error(`${side} normalized physical contour contains an invalid point.`);
        }
        return { x: Number(candidate.x), y: Number(candidate.y) };
      })
    : [];
  if (
    artifact.imageWidth !== AI_GRADER_HUMAN_GEOMETRY_IMAGE_WIDTH ||
    artifact.imageHeight !== AI_GRADER_HUMAN_GEOMETRY_IMAGE_HEIGHT
  ) {
    throw new Error(`${side} normalized full-resolution image authority is unavailable.`);
  }
  const suggestionReady = points.length >= 16;
  if (!suggestionReady) {
    points = [
      { x: 20, y: 20 },
      { x: AI_GRADER_HUMAN_GEOMETRY_IMAGE_WIDTH - 20, y: 20 },
      {
        x: AI_GRADER_HUMAN_GEOMETRY_IMAGE_WIDTH - 20,
        y: AI_GRADER_HUMAN_GEOMETRY_IMAGE_HEIGHT - 20,
      },
      { x: 20, y: AI_GRADER_HUMAN_GEOMETRY_IMAGE_HEIGHT - 20 },
    ];
  }
  return {
    contour: points,
    exactCaptureSha256: exactSha(
      geometrySource?.sourceSha256 ?? allOnCapture?.sha256 ?? acceptedCapture.sha256,
      `${side} exact capture`,
    ),
    normalizedImageSha256: exactSha(artifact.sha256, `${side} normalized image`),
    suggestionReady,
  };
}

/**
 * Reuses the processing worker's already-durable normalized dense contour.
 * It intentionally performs no image detection and has a manual-ready fallback.
 */
export function prepareFixedRigHumanGeometryReviewV1(input: {
  frontWarmManifest: unknown;
  backWarmManifest: unknown;
  receiptVersion?: number;
  supersedesReceiptSha256?: string | null;
}): FixedRigHumanGeometryReviewV1 {
  const front = normalizedSideAuthority(input.frontWarmManifest, "front");
  const back = normalizedSideAuthority(input.backWarmManifest, "back");
  const draft: AiGraderHumanGeometryAssistDraftV1 = {
    schemaVersion: AI_GRADER_HUMAN_GEOMETRY_ASSIST_SCHEMA_VERSION,
    coordinateFrame: AI_GRADER_HUMAN_GEOMETRY_COORDINATE_FRAME,
    image: {
      width: AI_GRADER_HUMAN_GEOMETRY_IMAGE_WIDTH,
      height: AI_GRADER_HUMAN_GEOMETRY_IMAGE_HEIGHT,
    },
    suggestionStatus: front.suggestionReady && back.suggestionReady
      ? "ready"
      : "manual_ready",
    sides: {
      front: buildAiGraderHumanGeometryAssistSideV1("front", front.contour),
      back: buildAiGraderHumanGeometryAssistSideV1("back", back.contour),
    },
  };
  return {
    version: FIXED_RIG_HUMAN_GEOMETRY_ASSIST_V1_VERSION,
    state: "geometry_review_required",
    receiptVersion: input.receiptVersion ?? 1,
    supersedesReceiptSha256: input.supersedesReceiptSha256 ?? null,
    captureAuthority: {
      front: {
        exactCaptureSha256: front.exactCaptureSha256,
        normalizedImageSha256: front.normalizedImageSha256,
      },
      back: {
        exactCaptureSha256: back.exactCaptureSha256,
        normalizedImageSha256: back.normalizedImageSha256,
      },
    },
    draft,
  };
}

export function reopenFixedRigHumanGeometryReviewV1(
  review: FixedRigHumanGeometryReviewV1,
): FixedRigHumanGeometryReviewV1 {
  if (review.state !== "locked" || !review.lockedReceipt) {
    throw new Error("Only locked human geometry can be reopened.");
  }
  const sides = structuredClone(review.lockedReceipt.sides);
  for (const side of ["front", "back"] as const) {
    for (const edge of ["top", "right", "bottom", "left"] as const) {
      sides[side].printedBorders[edge].reviewed = false;
    }
    for (const corner of ["top_left", "top_right", "bottom_right", "bottom_left"] as const) {
      sides[side].physicalCorners[corner].reviewed = false;
    }
    sides[side].edgeRegionsReviewed = false;
    sides[side].surfaceRegionReviewed = false;
    sides[side].confirmed = false;
  }
  return {
    version: FIXED_RIG_HUMAN_GEOMETRY_ASSIST_V1_VERSION,
    state: "geometry_review_required",
    receiptVersion: review.receiptVersion + 1,
    supersedesReceiptSha256: review.lockedReceipt.receiptSha256,
    captureAuthority: structuredClone(review.captureAuthority),
    draft: {
      ...structuredClone(review.draft),
      sides,
    },
  };
}

function receiptHash(value: Omit<AiGraderHumanGeometryReceiptV1, "receiptSha256">) {
  return createHash("sha256").update(canonicalJsonV1(value), "utf8").digest("hex");
}

export function lockFixedRigHumanGeometryReceiptV1(input: {
  review: FixedRigHumanGeometryReviewV1;
  sides: { front: AiGraderHumanGeometrySideV1; back: AiGraderHumanGeometrySideV1 };
  queueItemId: string;
  stationSessionId: string;
  gradingSessionId: string;
  reportId: string;
  operatorUserId: string;
  confirmedAt: string;
  measurementUncertaintyAuthority?:
    AiGraderOwnerHumanGeometryMeasurementUncertaintyAuthorityV1;
}): AiGraderHumanGeometryReceiptV1 {
  if (input.review.state !== "geometry_review_required" || input.review.lockedReceipt) {
    throw new Error("Geometry can lock exactly once for the active receipt version.");
  }
  const measurementUncertaintyAuthority =
    aiGraderOwnerHumanGeometryMeasurementUncertaintyAuthorityV1Schema.parse(
      input.measurementUncertaintyAuthority ??
        AI_GRADER_OWNER_HUMAN_GEOMETRY_MEASUREMENT_UNCERTAINTY_AUTHORITY_V1,
    );
  const payload: Omit<AiGraderHumanGeometryReceiptV1, "receiptSha256"> = {
    schemaVersion: AI_GRADER_HUMAN_GEOMETRY_RECEIPT_SCHEMA_VERSION,
    receiptVersion: input.review.receiptVersion,
    supersedesReceiptSha256: input.review.supersedesReceiptSha256,
    queueItemId: input.queueItemId,
    stationSessionId: input.stationSessionId,
    gradingSessionId: input.gradingSessionId,
    reportId: input.reportId,
    captureAuthority: structuredClone(input.review.captureAuthority),
    measurementUncertaintyAuthority:
      structuredClone(measurementUncertaintyAuthority),
    cardStandardAuthority: {
      profileId: POKEMON_TCG_STANDARD_CORNER_PROFILE_ID,
      profileVersion: POKEMON_TCG_STANDARD_CORNER_PROFILE_VERSION,
      profileSha256: POKEMON_TCG_STANDARD_CORNER_PROFILE_SHA256,
    },
    geometryToolVersion: AI_GRADER_HUMAN_GEOMETRY_TOOL_VERSION,
    softwareVersion: AI_GRADER_HUMAN_GEOMETRY_SOFTWARE_VERSION,
    coordinateFrame: AI_GRADER_HUMAN_GEOMETRY_COORDINATE_FRAME,
    image: {
      width: AI_GRADER_HUMAN_GEOMETRY_IMAGE_WIDTH,
      height: AI_GRADER_HUMAN_GEOMETRY_IMAGE_HEIGHT,
    },
    operator: {
      userId: input.operatorUserId,
      confirmedAt: new Date(input.confirmedAt).toISOString(),
    },
    sides: {
      front: assertAiGraderHumanGeometrySideConfirmedV1(input.sides.front),
      back: assertAiGraderHumanGeometrySideConfirmedV1(input.sides.back),
    },
  };
  return aiGraderHumanGeometryReceiptV1Schema.parse({
    ...payload,
    receiptSha256: receiptHash(payload),
  });
}

export function assertFixedRigHumanGeometryReceiptIdentityV1(input: {
  receipt: unknown;
  queueItemId: string;
  stationSessionId: string;
  gradingSessionId: string;
  reportId: string;
  captureAuthority: FixedRigHumanGeometryCaptureAuthorityV1;
  measurementUncertaintyAuthority?:
    AiGraderOwnerHumanGeometryMeasurementUncertaintyAuthorityV1;
}): AiGraderHumanGeometryReceiptV1 {
  const receipt = aiGraderHumanGeometryReceiptV1Schema.parse(input.receipt);
  const { receiptSha256, ...payload } = receipt;
  if (receiptHash(payload) !== receiptSha256) {
    throw new Error("Human geometry receipt integrity mismatch.");
  }
  const expectedMeasurementUncertaintyAuthority =
    aiGraderOwnerHumanGeometryMeasurementUncertaintyAuthorityV1Schema.parse(
      input.measurementUncertaintyAuthority ??
        AI_GRADER_OWNER_HUMAN_GEOMETRY_MEASUREMENT_UNCERTAINTY_AUTHORITY_V1,
    );
  const identityMatches =
    receipt.queueItemId === input.queueItemId &&
    receipt.stationSessionId === input.stationSessionId &&
    receipt.gradingSessionId === input.gradingSessionId &&
    receipt.reportId === input.reportId &&
    canonicalJsonV1(receipt.captureAuthority) === canonicalJsonV1(input.captureAuthority) &&
    canonicalJsonV1(receipt.measurementUncertaintyAuthority) ===
      canonicalJsonV1(expectedMeasurementUncertaintyAuthority);
  if (!identityMatches) {
    throw new Error("Human geometry receipt identity mismatch; grading fails closed.");
  }
  return receipt;
}

export async function persistImmutableFixedRigHumanGeometryReceiptV1(input: {
  receipt: AiGraderHumanGeometryReceiptV1;
  sessionDir: string;
}): Promise<string> {
  const geometryDir = path.join(input.sessionDir, "human-geometry");
  await mkdir(geometryDir, { recursive: true });
  const receiptPath = path.join(
    geometryDir,
    `geometry-receipt-v${input.receipt.receiptVersion}-${input.receipt.receiptSha256}.json`,
  );
  await writeFile(receiptPath, `${JSON.stringify(input.receipt, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  const stored = aiGraderHumanGeometryReceiptV1Schema.parse(
    JSON.parse(await readFile(receiptPath, "utf8")),
  );
  if (stored.receiptSha256 !== input.receipt.receiptSha256) {
    throw new Error("Immutable human geometry receipt readback mismatch.");
  }
  return receiptPath;
}
