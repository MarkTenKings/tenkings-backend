import { z } from "zod";
import {
  POKEMON_TCG_STANDARD_CONTOUR_ARC_SEGMENTS_PER_CORNER,
  POKEMON_TCG_STANDARD_CORNER_PROFILE_HEIGHT_MM,
  POKEMON_TCG_STANDARD_CORNER_PROFILE_RADIUS_MM,
  POKEMON_TCG_STANDARD_CORNER_PROFILE_WIDTH_MM,
} from "./aiGraderPokemonStandardCornerProfileV1";

export const AI_GRADER_HUMAN_GEOMETRY_ASSIST_SCHEMA_VERSION =
  "ai-grader-human-geometry-assist-v1" as const;
export const AI_GRADER_HUMAN_GEOMETRY_RECEIPT_SCHEMA_VERSION =
  "ai-grader-human-geometry-receipt-v1" as const;
export const AI_GRADER_HUMAN_GEOMETRY_TOOL_VERSION =
  "ten-kings-human-geometry-tools-v1.0.0" as const;
export const AI_GRADER_HUMAN_GEOMETRY_SOFTWARE_VERSION =
  "ten-kings-ai-grader-human-geometry-assist-v1.0.0" as const;
export const AI_GRADER_HUMAN_GEOMETRY_COORDINATE_FRAME =
  "normalized_card_portrait_pixels_1200x1680" as const;
export const AI_GRADER_HUMAN_GEOMETRY_IMAGE_WIDTH = 1200 as const;
export const AI_GRADER_HUMAN_GEOMETRY_IMAGE_HEIGHT = 1680 as const;
export const AI_GRADER_OWNER_HUMAN_GEOMETRY_MEASUREMENT_UNCERTAINTY_POLICY_ID =
  "owner_human_geometry_measurement_uncertainty_v1" as const;
export const AI_GRADER_OWNER_HUMAN_GEOMETRY_MEASUREMENT_UNCERTAINTY_POLICY_VERSION =
  "v1" as const;
export const AI_GRADER_OWNER_HUMAN_GEOMETRY_REPEATED_PLACEMENT_U95_MM =
  0.05 as const;
export const AI_GRADER_OWNER_HUMAN_GEOMETRY_MEASUREMENT_UNCERTAINTY_POLICY_SHA256 =
  "f841b3645cf86ae746423786930b75830f03c168283c0910f745276e1ac7b87b" as const;
export const AI_GRADER_OWNER_HUMAN_GEOMETRY_MEASUREMENT_UNCERTAINTY_AUTHORITY_V1 = {
  authorityBasis: "owner_approved_grading_policy_not_empirical_calibration",
  policyId: AI_GRADER_OWNER_HUMAN_GEOMETRY_MEASUREMENT_UNCERTAINTY_POLICY_ID,
  policyVersion:
    AI_GRADER_OWNER_HUMAN_GEOMETRY_MEASUREMENT_UNCERTAINTY_POLICY_VERSION,
  repeatedPlacementU95Mm:
    AI_GRADER_OWNER_HUMAN_GEOMETRY_REPEATED_PLACEMENT_U95_MM,
  policySha256:
    AI_GRADER_OWNER_HUMAN_GEOMETRY_MEASUREMENT_UNCERTAINTY_POLICY_SHA256,
} as const;

export const AI_GRADER_GEOMETRY_SIDES = ["front", "back"] as const;
export const AI_GRADER_GEOMETRY_EDGES = ["top", "right", "bottom", "left"] as const;
export const AI_GRADER_GEOMETRY_CORNERS =
  ["top_left", "top_right", "bottom_right", "bottom_left"] as const;

export type AiGraderHumanGeometrySide = (typeof AI_GRADER_GEOMETRY_SIDES)[number];
export type AiGraderHumanGeometryEdge = (typeof AI_GRADER_GEOMETRY_EDGES)[number];
export type AiGraderHumanGeometryCorner = (typeof AI_GRADER_GEOMETRY_CORNERS)[number];
export type AiGraderHumanGeometryCornerTool = "rounded_3_18_mm" | "square_90_degree";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const identifierSchema = z.string().trim().min(1).max(256);
const pointSchema = z.strictObject({
  x: z.number().finite().min(0).max(AI_GRADER_HUMAN_GEOMETRY_IMAGE_WIDTH),
  y: z.number().finite().min(0).max(AI_GRADER_HUMAN_GEOMETRY_IMAGE_HEIGHT),
});
const lineSchema = z.strictObject({
  start: pointSchema,
  end: pointSchema,
});
const adjustmentEvidenceSchema = z.strictObject({
  source: z.enum(["candidate", "manual"]),
  snapApplied: z.boolean(),
  snapDistancePx: z.number().finite().min(0).max(100),
  gradientStrength: z.number().finite().min(0).max(1),
});
const borderCandidateSchema = z.strictObject({
  id: identifierSchema,
  line: lineSchema,
  rank: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});
const borderSchema = z.strictObject({
  candidates: z.array(borderCandidateSchema).length(3),
  selectedCandidateId: identifierSchema.nullable(),
  finalLine: lineSchema,
  adjustment: adjustmentEvidenceSchema,
  reviewed: z.boolean(),
});
const cornerSchema = z.strictObject({
  vertex: pointSchema,
  horizontalTangent: pointSchema,
  verticalTangent: pointSchema,
  toolType: z.enum(["rounded_3_18_mm", "square_90_degree"]),
  adjustment: adjustmentEvidenceSchema,
  reviewed: z.boolean(),
});
const polygonSchema = z.array(pointSchema).min(3);
const derivedRegionsSchema = z.strictObject({
  edgeBands: z.strictObject({
    top: polygonSchema,
    right: polygonSchema,
    bottom: polygonSchema,
    left: polygonSchema,
  }),
  surfaceRegion: polygonSchema,
  physicalOuterContour: polygonSchema,
});
const sideSchema = z.strictObject({
  printedBorders: z.strictObject({
    top: borderSchema,
    right: borderSchema,
    bottom: borderSchema,
    left: borderSchema,
  }),
  physicalCorners: z.strictObject({
    top_left: cornerSchema,
    top_right: cornerSchema,
    bottom_right: cornerSchema,
    bottom_left: cornerSchema,
  }),
  derivedRegions: derivedRegionsSchema,
  edgeRegionsReviewed: z.boolean(),
  surfaceRegionReviewed: z.boolean(),
  confirmed: z.boolean(),
});

export const aiGraderHumanGeometryAssistSideV1Schema = sideSchema;
export const aiGraderOwnerHumanGeometryMeasurementUncertaintyAuthorityV1Schema =
  z.strictObject({
    authorityBasis: z.literal(
      "owner_approved_grading_policy_not_empirical_calibration",
    ),
    policyId: z.literal(
      AI_GRADER_OWNER_HUMAN_GEOMETRY_MEASUREMENT_UNCERTAINTY_POLICY_ID,
    ),
    policyVersion: z.literal(
      AI_GRADER_OWNER_HUMAN_GEOMETRY_MEASUREMENT_UNCERTAINTY_POLICY_VERSION,
    ),
    repeatedPlacementU95Mm: z.literal(
      AI_GRADER_OWNER_HUMAN_GEOMETRY_REPEATED_PLACEMENT_U95_MM,
    ),
    policySha256: z.literal(
      AI_GRADER_OWNER_HUMAN_GEOMETRY_MEASUREMENT_UNCERTAINTY_POLICY_SHA256,
    ),
  });

export const aiGraderHumanGeometryAssistDraftV1Schema = z.strictObject({
  schemaVersion: z.literal(AI_GRADER_HUMAN_GEOMETRY_ASSIST_SCHEMA_VERSION),
  coordinateFrame: z.literal(AI_GRADER_HUMAN_GEOMETRY_COORDINATE_FRAME),
  image: z.strictObject({
    width: z.literal(AI_GRADER_HUMAN_GEOMETRY_IMAGE_WIDTH),
    height: z.literal(AI_GRADER_HUMAN_GEOMETRY_IMAGE_HEIGHT),
  }),
  suggestionStatus: z.enum(["ready", "manual_ready"]),
  sides: z.strictObject({
    front: sideSchema,
    back: sideSchema,
  }),
});

export const aiGraderHumanGeometryReceiptV1Schema = z.strictObject({
  schemaVersion: z.literal(AI_GRADER_HUMAN_GEOMETRY_RECEIPT_SCHEMA_VERSION),
  receiptVersion: z.number().int().positive(),
  supersedesReceiptSha256: sha256Schema.nullable(),
  queueItemId: identifierSchema,
  stationSessionId: identifierSchema,
  gradingSessionId: identifierSchema,
  reportId: identifierSchema,
  captureAuthority: z.strictObject({
    front: z.strictObject({
      exactCaptureSha256: sha256Schema,
      normalizedImageSha256: sha256Schema,
    }),
    back: z.strictObject({
      exactCaptureSha256: sha256Schema,
      normalizedImageSha256: sha256Schema,
    }),
  }),
  measurementUncertaintyAuthority:
    aiGraderOwnerHumanGeometryMeasurementUncertaintyAuthorityV1Schema,
  cardStandardAuthority: z.strictObject({
    profileId: identifierSchema,
    profileVersion: identifierSchema,
    profileSha256: sha256Schema,
  }),
  geometryToolVersion: z.literal(AI_GRADER_HUMAN_GEOMETRY_TOOL_VERSION),
  softwareVersion: z.literal(AI_GRADER_HUMAN_GEOMETRY_SOFTWARE_VERSION),
  coordinateFrame: z.literal(AI_GRADER_HUMAN_GEOMETRY_COORDINATE_FRAME),
  image: z.strictObject({
    width: z.literal(AI_GRADER_HUMAN_GEOMETRY_IMAGE_WIDTH),
    height: z.literal(AI_GRADER_HUMAN_GEOMETRY_IMAGE_HEIGHT),
  }),
  operator: z.strictObject({
    userId: identifierSchema,
    confirmedAt: z.string().datetime({ offset: true }),
  }),
  sides: z.strictObject({
    front: sideSchema,
    back: sideSchema,
  }),
  receiptSha256: sha256Schema,
});

export type AiGraderHumanGeometryPointV1 = z.infer<typeof pointSchema>;
export type AiGraderHumanGeometryLineV1 = z.infer<typeof lineSchema>;
export type AiGraderHumanGeometrySideV1 = z.infer<typeof sideSchema>;
export type AiGraderOwnerHumanGeometryMeasurementUncertaintyAuthorityV1 =
  z.infer<
    typeof aiGraderOwnerHumanGeometryMeasurementUncertaintyAuthorityV1Schema
  >;
export type AiGraderHumanGeometryAssistDraftV1 =
  z.infer<typeof aiGraderHumanGeometryAssistDraftV1Schema>;
export type AiGraderHumanGeometryReceiptV1 =
  z.infer<typeof aiGraderHumanGeometryReceiptV1Schema>;

const round = (value: number) => Math.round(value * 1_000) / 1_000;
const point = (x: number, y: number): AiGraderHumanGeometryPointV1 => ({
  x: round(Math.max(0, Math.min(AI_GRADER_HUMAN_GEOMETRY_IMAGE_WIDTH, x))),
  y: round(Math.max(0, Math.min(AI_GRADER_HUMAN_GEOMETRY_IMAGE_HEIGHT, y))),
});

export function aiGraderHumanGeometryRoundedCornerRadiusPxV1() {
  return {
    x: round(
      AI_GRADER_HUMAN_GEOMETRY_IMAGE_WIDTH *
      POKEMON_TCG_STANDARD_CORNER_PROFILE_RADIUS_MM /
      POKEMON_TCG_STANDARD_CORNER_PROFILE_WIDTH_MM,
    ),
    y: round(
      AI_GRADER_HUMAN_GEOMETRY_IMAGE_HEIGHT *
      POKEMON_TCG_STANDARD_CORNER_PROFILE_RADIUS_MM /
      POKEMON_TCG_STANDARD_CORNER_PROFILE_HEIGHT_MM,
    ),
  };
}

function contourBounds(contour: readonly AiGraderHumanGeometryPointV1[]) {
  if (contour.length < 4) throw new Error("A physical contour requires at least four points.");
  return {
    left: Math.min(...contour.map((entry) => entry.x)),
    top: Math.min(...contour.map((entry) => entry.y)),
    right: Math.max(...contour.map((entry) => entry.x)),
    bottom: Math.max(...contour.map((entry) => entry.y)),
  };
}

function lineForEdge(
  edge: AiGraderHumanGeometryEdge,
  bounds: ReturnType<typeof contourBounds>,
  inset: number,
): AiGraderHumanGeometryLineV1 {
  if (edge === "top") {
    return { start: point(bounds.left, bounds.top + inset), end: point(bounds.right, bounds.top + inset) };
  }
  if (edge === "right") {
    return { start: point(bounds.right - inset, bounds.top), end: point(bounds.right - inset, bounds.bottom) };
  }
  if (edge === "bottom") {
    return { start: point(bounds.left, bounds.bottom - inset), end: point(bounds.right, bounds.bottom - inset) };
  }
  return { start: point(bounds.left + inset, bounds.top), end: point(bounds.left + inset, bounds.bottom) };
}

function cornerFor(
  corner: AiGraderHumanGeometryCorner,
  bounds: ReturnType<typeof contourBounds>,
  radiusX: number,
  radiusY: number,
) {
  const right = corner === "top_right" || corner === "bottom_right";
  const bottom = corner === "bottom_left" || corner === "bottom_right";
  const vertex = point(right ? bounds.right : bounds.left, bottom ? bounds.bottom : bounds.top);
  return {
    vertex,
    horizontalTangent: point(vertex.x + (right ? -radiusX : radiusX), vertex.y),
    verticalTangent: point(vertex.x, vertex.y + (bottom ? -radiusY : radiusY)),
    toolType: "rounded_3_18_mm" as const,
    adjustment: {
      source: "candidate" as const,
      snapApplied: true,
      snapDistancePx: 0,
      gradientStrength: 1,
    },
    reviewed: false,
  };
}

function arcPoints(
  corner: AiGraderHumanGeometryCorner,
  geometry: AiGraderHumanGeometrySideV1["physicalCorners"][AiGraderHumanGeometryCorner],
) {
  if (geometry.toolType === "square_90_degree") return [geometry.vertex];
  const rx = Math.abs(geometry.vertex.x - geometry.horizontalTangent.x);
  const ry = Math.abs(geometry.vertex.y - geometry.verticalTangent.y);
  const right = corner === "top_right" || corner === "bottom_right";
  const bottom = corner === "bottom_left" || corner === "bottom_right";
  const center = point(
    geometry.vertex.x + (right ? -rx : rx),
    geometry.vertex.y + (bottom ? -ry : ry),
  );
  const startAngle = corner === "top_left" ? Math.PI
    : corner === "top_right" ? -Math.PI / 2
      : corner === "bottom_right" ? 0
        : Math.PI / 2;
  return Array.from(
    { length: POKEMON_TCG_STANDARD_CONTOUR_ARC_SEGMENTS_PER_CORNER + 1 },
    (_, index) => {
      const angle = startAngle + index * (Math.PI / 2) /
        POKEMON_TCG_STANDARD_CONTOUR_ARC_SEGMENTS_PER_CORNER;
      return point(center.x + rx * Math.cos(angle), center.y + ry * Math.sin(angle));
    },
  );
}

export function deriveAiGraderHumanGeometryRegionsV1(
  corners: AiGraderHumanGeometrySideV1["physicalCorners"],
): AiGraderHumanGeometrySideV1["derivedRegions"] {
  const tl = corners.top_left;
  const tr = corners.top_right;
  const br = corners.bottom_right;
  const bl = corners.bottom_left;
  const band = 8;
  const top = [
    tl.horizontalTangent,
    tr.horizontalTangent,
    point(tr.horizontalTangent.x, tr.horizontalTangent.y + band),
    point(tl.horizontalTangent.x, tl.horizontalTangent.y + band),
  ];
  const right = [
    tr.verticalTangent,
    br.verticalTangent,
    point(br.verticalTangent.x - band, br.verticalTangent.y),
    point(tr.verticalTangent.x - band, tr.verticalTangent.y),
  ];
  const bottom = [
    br.horizontalTangent,
    bl.horizontalTangent,
    point(bl.horizontalTangent.x, bl.horizontalTangent.y - band),
    point(br.horizontalTangent.x, br.horizontalTangent.y - band),
  ];
  const left = [
    bl.verticalTangent,
    tl.verticalTangent,
    point(tl.verticalTangent.x + band, tl.verticalTangent.y),
    point(bl.verticalTangent.x + band, bl.verticalTangent.y),
  ];
  const physicalOuterContour = [
    ...arcPoints("top_left", tl),
    ...arcPoints("top_right", tr),
    ...arcPoints("bottom_right", br),
    ...arcPoints("bottom_left", bl),
  ];
  const center = physicalOuterContour.reduce(
    (sum, entry) => ({ x: sum.x + entry.x / physicalOuterContour.length, y: sum.y + entry.y / physicalOuterContour.length }),
    { x: 0, y: 0 },
  );
  const surfaceRegion = physicalOuterContour.map((entry) => {
    const distance = Math.hypot(entry.x - center.x, entry.y - center.y) || 1;
    return point(
      entry.x + (center.x - entry.x) * Math.min(1, 10 / distance),
      entry.y + (center.y - entry.y) * Math.min(1, 10 / distance),
    );
  });
  return { edgeBands: { top, right, bottom, left }, surfaceRegion, physicalOuterContour };
}

export function buildAiGraderHumanGeometryAssistSideV1(
  side: AiGraderHumanGeometrySide,
  observedOuterContour: readonly AiGraderHumanGeometryPointV1[],
): AiGraderHumanGeometrySideV1 {
  const bounds = contourBounds(observedOuterContour);
  const { x: radiusX, y: radiusY } =
    aiGraderHumanGeometryRoundedCornerRadiusPxV1();
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  const physicalCorners = {
    top_left: cornerFor("top_left", bounds, radiusX, radiusY),
    top_right: cornerFor("top_right", bounds, radiusX, radiusY),
    bottom_right: cornerFor("bottom_right", bounds, radiusX, radiusY),
    bottom_left: cornerFor("bottom_left", bounds, radiusX, radiusY),
  };
  const printedBorders = Object.fromEntries(AI_GRADER_GEOMETRY_EDGES.map((edge) => {
    const axis = edge === "top" || edge === "bottom" ? height : width;
    const insets = [axis * 0.03, axis * 0.05, axis * 0.07];
    const candidates = insets.map((inset, index) => ({
      id: `${side}-${edge}-candidate-${index + 1}`,
      line: lineForEdge(edge, bounds, inset),
      rank: (index + 1) as 1 | 2 | 3,
    }));
    return [edge, {
      candidates,
      selectedCandidateId: candidates[1].id,
      finalLine: candidates[1].line,
      adjustment: {
        source: "candidate" as const,
        snapApplied: false,
        snapDistancePx: 0,
        gradientStrength: 0,
      },
      reviewed: false,
    }];
  })) as AiGraderHumanGeometrySideV1["printedBorders"];
  return {
    printedBorders,
    physicalCorners,
    derivedRegions: deriveAiGraderHumanGeometryRegionsV1(physicalCorners),
    edgeRegionsReviewed: false,
    surfaceRegionReviewed: false,
    confirmed: false,
  };
}

export function assertAiGraderHumanGeometrySideConfirmedV1(
  value: unknown,
): AiGraderHumanGeometrySideV1 {
  const side = aiGraderHumanGeometryAssistSideV1Schema.parse(value);
  for (const edge of AI_GRADER_GEOMETRY_EDGES) {
    if (!side.printedBorders[edge].reviewed) {
      throw new Error(`The ${edge} printed border requires human review.`);
    }
  }
  for (const corner of AI_GRADER_GEOMETRY_CORNERS) {
    if (!side.physicalCorners[corner].reviewed) {
      throw new Error(`The ${corner.replace(/_/g, " ")} physical corner requires human review.`);
    }
  }
  if (!side.edgeRegionsReviewed || !side.surfaceRegionReviewed || !side.confirmed) {
    throw new Error("Edge regions, surface region, and the side require explicit human confirmation.");
  }
  const expected = deriveAiGraderHumanGeometryRegionsV1(side.physicalCorners);
  if (JSON.stringify(expected) !== JSON.stringify(side.derivedRegions)) {
    throw new Error("Derived edge and surface regions must match the confirmed master corner geometry.");
  }
  return side;
}
