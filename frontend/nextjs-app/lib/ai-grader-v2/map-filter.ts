import type {
  SpeedsterCardSide,
  SpeedsterPoint,
  SpeedsterReviewFinding,
} from "./contracts";
import type {
  SpeedsterFilterDecisionEvidence,
  SpeedsterMapRegistration,
  SpeedsterMapZone,
} from "./card-type-map-contracts";
import {
  SPEEDSTER_MAP_FILTER_POLICY_VERSION,
  SPEEDSTER_MAP_FILTER_POLICY_VERSION_V2,
  SPEEDSTER_MAP_FILTER_RULE_ID_V2,
  SPEEDSTER_MAP_FILTER_RULE_ID,
  SPEEDSTER_MAP_REGISTRATION_VERSION,
  SPEEDSTER_MAP_ZONE_OVERLAP_METHOD,
  isSpeedsterMapZoneV2,
  isSpeedsterNondegenerateAnchorSet,
  isSpeedsterSimplePolygon,
  isSpeedsterStrictConvexPolygon,
} from "./card-type-map-contracts";
import { SPEEDSTER_LEARNING_COMPATIBLE_DETECTOR_VERSION } from "./detector-version";
import type { SpeedsterSessionIdentity } from "./identity";
import { speedsterFindingRegions } from "./review-findings";
import type { SpeedsterLoadedMapRevision } from "../server/speedsterCardTypeMaps";

const SHA256 = /^[a-f0-9]{64}$/;
const REGISTRATION_PROJECTION_TOLERANCE = 1e-6;
const PHYSICAL_CARD_WIDTH_MM = 63.5;
const PHYSICAL_CARD_HEIGHT_MM = 88.9;
const BUFFER_CONTAINMENT_EPSILON_MM = 1e-9;
// Ambiguous sub-segments fail closed after this deterministic bound. That may
// retain a borderline fake; it can never hide a borderline real defect.
const BUFFER_CONTAINMENT_MAX_DEPTH = 10;
const ZONE_TYPES = new Set([
  "PRINT_TEXT",
  "PRINT_LOGO",
  "PRINT_ARTWORK",
  "PRINT_BORDER",
  "PRINT_FOIL",
  "OTHER_PRINT_CONTEXT",
]);

export type SpeedsterPinnedMapFilterInput = Readonly<{
  revision: SpeedsterLoadedMapRevision;
  registration: unknown;
}>;

export type SpeedsterMapFilterSplit = Readonly<{
  activeFindings: readonly SpeedsterReviewFinding[];
  filteredDecisions: readonly SpeedsterFilterDecisionEvidence[];
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const finiteUnit = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
const nonemptyText = (value: unknown): value is string =>
  typeof value === "string" && Boolean(value.trim()) && value.length <= 240;

function point(value: unknown): value is SpeedsterPoint {
  return isRecord(value) && finiteUnit(value.x) && finiteUnit(value.y);
}

function polygon(value: unknown): value is readonly SpeedsterPoint[] {
  return Array.isArray(value)
    && value.length >= 3
    && value.every(point)
    && isSpeedsterSimplePolygon(value);
}

function zone(value: unknown): value is SpeedsterMapZone {
  return isRecord(value)
    && nonemptyText(value.id)
    && nonemptyText(value.label)
    && typeof value.semanticType === "string"
    && ZONE_TYPES.has(value.semanticType)
    && polygon(value.polygon);
}

function designBoundary(value: unknown) {
  return isRecord(value) && (
    value.kind === "FULL_BLEED"
    || (
      value.kind === "QUAD"
      && Array.isArray(value.points)
      && value.points.length === 4
      && value.points.every(point)
      && isSpeedsterStrictConvexPolygon(value.points)
    )
  );
}

function registrationSide(
  value: unknown,
  side: SpeedsterCardSide,
  revisionId: string,
  expectedAnchors: SpeedsterLoadedMapRevision["frontMap"]["anchors"],
  expectedZones: readonly SpeedsterMapZone[],
  expectedBoundary: SpeedsterLoadedMapRevision["frontMap"]["designBoundary"],
): SpeedsterMapRegistration {
  if (
    !isRecord(value)
    || value.version !== SPEEDSTER_MAP_REGISTRATION_VERSION
    || value.side !== side
    || value.mapRevisionId !== revisionId
    || typeof value.currentPhysicalQuadSha256 !== "string"
    || !SHA256.test(value.currentPhysicalQuadSha256)
    || typeof value.currentInspectionSha256 !== "string"
    || !SHA256.test(value.currentInspectionSha256)
    || !Array.isArray(value.homography)
    || value.homography.length !== 9
    || value.homography.some((part) => typeof part !== "number" || !Number.isFinite(part))
    || !Array.isArray(value.anchors)
    || value.anchors.length !== 4
    || value.anchors.some((entry) => !isRecord(entry)
      || !nonemptyText(entry.anchorId)
      || !point(entry.expectedPoint)
      || !point(entry.locatedPoint)
      || !finiteUnit(entry.score))
    || !Array.isArray(value.projectedZones)
    || !value.projectedZones.every(zone)
    || !designBoundary(value.projectedDesignBoundary)
  ) {
    throw new Error(`The pinned ${side} Speedster map registration is malformed.`);
  }
  const locatedPoints = value.anchors.map((entry) => (entry as Record<string, unknown>).locatedPoint as SpeedsterPoint);
  if (!isSpeedsterNondegenerateAnchorSet(locatedPoints)) {
    throw new Error(`The pinned ${side} Speedster map registration located anchors are degenerate.`);
  }
  if (!isSpeedsterNondegenerateAnchorSet(expectedAnchors.map((entry) => entry.point))) {
    throw new Error(`The pinned ${side} Speedster map anchors are degenerate.`);
  }
  const expected = expectedZones.map(({ id, semanticType }) => `${id}\u0000${semanticType}`);
  const projected = value.projectedZones.map((entry) => `${entry.id}\u0000${entry.semanticType}`);
  if (new Set(projected).size !== projected.length || expected.join("\u0001") !== projected.join("\u0001")) {
    throw new Error(`The pinned ${side} Speedster map registration does not match its immutable zones.`);
  }
  const expectedAnchorJson = expectedAnchors.map(({ id, point: expectedPoint }) =>
    JSON.stringify({ anchorId: id, expectedPoint }));
  const registeredAnchorJson = value.anchors.map((entry) =>
    JSON.stringify({ anchorId: entry.anchorId, expectedPoint: entry.expectedPoint }));
  if (expectedAnchorJson.join("\u0001") !== registeredAnchorJson.join("\u0001")) {
    throw new Error(`The pinned ${side} Speedster map registration does not match its immutable anchors.`);
  }
  const rawRegistration = value as unknown as SpeedsterMapRegistration;
  const project = (source: SpeedsterPoint) => {
    const [h0, h1, h2, h3, h4, h5, h6, h7, h8] = rawRegistration.homography;
    const divisor = h6 * source.x + h7 * source.y + h8;
    if (!Number.isFinite(divisor) || Math.abs(divisor) <= 1e-12) {
      throw new Error(`The pinned ${side} Speedster map registration has a singular projection.`);
    }
    const projected = {
      x: (h0 * source.x + h1 * source.y + h2) / divisor,
      y: (h3 * source.x + h4 * source.y + h5) / divisor,
    };
    if (!finiteUnit(projected.x) || !finiteUnit(projected.y)) {
      throw new Error(`The pinned ${side} Speedster map registration projects outside the physical card.`);
    }
    return projected;
  };
  const samePoint = (left: SpeedsterPoint, right: SpeedsterPoint) =>
    Math.abs(left.x - right.x) <= REGISTRATION_PROJECTION_TOLERANCE
    && Math.abs(left.y - right.y) <= REGISTRATION_PROJECTION_TOLERANCE;
  expectedAnchors.forEach((expectedAnchor, index) => {
    if (!samePoint(project(expectedAnchor.point), rawRegistration.anchors[index].locatedPoint)) {
      throw new Error(`The pinned ${side} Speedster map registration anchor projection is incoherent.`);
    }
  });
  expectedZones.forEach((expectedZone, zoneIndex) => {
    const projectedZone = rawRegistration.projectedZones[zoneIndex];
    if (
      projectedZone.polygon.length !== expectedZone.polygon.length
      || expectedZone.polygon.some((source, pointIndex) =>
        !samePoint(project(source), projectedZone.polygon[pointIndex]))
    ) {
      throw new Error(`The pinned ${side} Speedster map registration projected zone geometry is incoherent.`);
    }
  });
  if (expectedBoundary.kind === "FULL_BLEED") {
    if (rawRegistration.projectedDesignBoundary.kind !== "FULL_BLEED") {
      throw new Error(`The pinned ${side} Speedster map registration design boundary is incoherent.`);
    }
  } else if (
    rawRegistration.projectedDesignBoundary.kind !== "QUAD"
    || expectedBoundary.points.some((source, pointIndex) =>
      !samePoint(project(source), rawRegistration.projectedDesignBoundary.kind === "QUAD"
        ? rawRegistration.projectedDesignBoundary.points[pointIndex]
        : source))
  ) {
    throw new Error(`The pinned ${side} Speedster map registration design boundary is incoherent.`);
  }
  return {
    ...rawRegistration,
    projectedZones: rawRegistration.projectedZones.map((projectedZone, index) => {
      const expectedZone = expectedZones[index];
      return isSpeedsterMapZoneV2(expectedZone)
        ? {
            ...projectedZone,
            contentType: expectedZone.contentType,
            filterAuthority: expectedZone.filterAuthority,
            filterAuthoritySource: expectedZone.filterAuthoritySource,
            filterPaddingMm: expectedZone.filterPaddingMm,
            proposalSource: expectedZone.proposalSource,
            proposalConfidence: expectedZone.proposalConfidence,
          }
        : projectedZone;
    }),
  };
}

function coherentMap(input: SpeedsterPinnedMapFilterInput) {
  const { revision } = input;
  if (!isRecord(input.registration)) {
    throw new Error("The pinned Speedster map registration is missing.");
  }
  const front = registrationSide(
    input.registration.front,
    "FRONT",
    revision.revisionId,
    revision.frontMap.anchors,
    revision.frontMap.zones,
    revision.frontMap.designBoundary,
  );
  const back = registrationSide(
    input.registration.back,
    "BACK",
    revision.revisionId,
    revision.backMap.anchors,
    revision.backMap.zones,
    revision.backMap.designBoundary,
  );
  return { FRONT: front, BACK: back } as const;
}

export function validateSpeedsterPinnedMapFilterInput(input: SpeedsterPinnedMapFilterInput): void {
  coherentMap(input);
}

function onSegment(pointValue: SpeedsterPoint, left: SpeedsterPoint, right: SpeedsterPoint) {
  const cross = (pointValue.y - left.y) * (right.x - left.x)
    - (pointValue.x - left.x) * (right.y - left.y);
  if (Math.abs(cross) > 1e-12) return false;
  return pointValue.x >= Math.min(left.x, right.x) - 1e-12
    && pointValue.x <= Math.max(left.x, right.x) + 1e-12
    && pointValue.y >= Math.min(left.y, right.y) - 1e-12
    && pointValue.y <= Math.max(left.y, right.y) + 1e-12;
}

function pointInPolygon(pointValue: SpeedsterPoint, polygonValue: readonly SpeedsterPoint[]) {
  let inside = false;
  for (let index = 0, prior = polygonValue.length - 1; index < polygonValue.length; prior = index, index += 1) {
    const left = polygonValue[prior];
    const right = polygonValue[index];
    if (onSegment(pointValue, left, right)) return true;
    if (
      ((right.y > pointValue.y) !== (left.y > pointValue.y))
      && pointValue.x < ((left.x - right.x) * (pointValue.y - right.y)) / (left.y - right.y) + right.x
    ) inside = !inside;
  }
  return inside;
}

function segmentIntersectionParameters(
  start: SpeedsterPoint,
  end: SpeedsterPoint,
  edgeStart: SpeedsterPoint,
  edgeEnd: SpeedsterPoint,
) {
  const ray = { x: end.x - start.x, y: end.y - start.y };
  const edge = { x: edgeEnd.x - edgeStart.x, y: edgeEnd.y - edgeStart.y };
  const offset = { x: edgeStart.x - start.x, y: edgeStart.y - start.y };
  const denominator = ray.x * edge.y - ray.y * edge.x;
  if (Math.abs(denominator) > 1e-12) {
    const parameter = (offset.x * edge.y - offset.y * edge.x) / denominator;
    const edgeParameter = (offset.x * ray.y - offset.y * ray.x) / denominator;
    return parameter >= -1e-12 && parameter <= 1 + 1e-12
      && edgeParameter >= -1e-12 && edgeParameter <= 1 + 1e-12
      ? [Math.min(1, Math.max(0, parameter))]
      : [];
  }
  if (Math.abs(offset.x * ray.y - offset.y * ray.x) > 1e-12) return [];
  const axis = Math.abs(ray.x) >= Math.abs(ray.y) ? "x" : "y";
  const length = ray[axis];
  if (Math.abs(length) <= 1e-12) return [];
  return [
    (edgeStart[axis] - start[axis]) / length,
    (edgeEnd[axis] - start[axis]) / length,
  ].filter((parameter) => parameter >= -1e-12 && parameter <= 1 + 1e-12)
    .map((parameter) => Math.min(1, Math.max(0, parameter)));
}

function segmentInsidePolygon(
  start: SpeedsterPoint,
  end: SpeedsterPoint,
  polygonValue: readonly SpeedsterPoint[],
) {
  const parameters = [0, 1];
  for (let index = 0; index < polygonValue.length; index += 1) {
    parameters.push(...segmentIntersectionParameters(
      start,
      end,
      polygonValue[index],
      polygonValue[(index + 1) % polygonValue.length],
    ));
  }
  const ordered = [...new Set(parameters.map((value) => Math.round(value * 1e12) / 1e12))]
    .sort((left, right) => left - right);
  for (let index = 0; index < ordered.length - 1; index += 1) {
    if (ordered[index + 1] - ordered[index] <= 1e-12) continue;
    const middle = (ordered[index] + ordered[index + 1]) / 2;
    if (!pointInPolygon({
      x: start.x + (end.x - start.x) * middle,
      y: start.y + (end.y - start.y) * middle,
    }, polygonValue)) return false;
  }
  return true;
}

function contourInsidePolygon(
  contour: readonly SpeedsterPoint[],
  polygonValue: readonly SpeedsterPoint[],
) {
  return contour.length >= 3
    && contour.every((entry) => pointInPolygon(entry, polygonValue))
    && contour.every((entry, index) => segmentInsidePolygon(
      entry,
      contour[(index + 1) % contour.length],
      polygonValue,
    ));
}

function physicalPoint(pointValue: SpeedsterPoint): SpeedsterPoint {
  return { x: pointValue.x * PHYSICAL_CARD_WIDTH_MM, y: pointValue.y * PHYSICAL_CARD_HEIGHT_MM };
}

function pointToSegmentDistance(
  pointValue: SpeedsterPoint,
  start: SpeedsterPoint,
  end: SpeedsterPoint,
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const squaredLength = dx * dx + dy * dy;
  if (squaredLength <= BUFFER_CONTAINMENT_EPSILON_MM) {
    return Math.hypot(pointValue.x - start.x, pointValue.y - start.y);
  }
  const parameter = Math.max(0, Math.min(1, (
    (pointValue.x - start.x) * dx + (pointValue.y - start.y) * dy
  ) / squaredLength));
  return Math.hypot(
    pointValue.x - (start.x + parameter * dx),
    pointValue.y - (start.y + parameter * dy),
  );
}

function pointDistanceMmToPolygon(
  pointValue: SpeedsterPoint,
  polygonValue: readonly SpeedsterPoint[],
) {
  if (pointInPolygon(pointValue, polygonValue)) return 0;
  return polygonValue.reduce((minimum, start, index) => Math.min(
    minimum,
    pointToSegmentDistance(pointValue, start, polygonValue[(index + 1) % polygonValue.length]),
  ), Number.POSITIVE_INFINITY);
}

function segmentInsidePaddedPolygon(
  start: SpeedsterPoint,
  end: SpeedsterPoint,
  polygonValue: readonly SpeedsterPoint[],
  paddingMm: number,
  depth = 0,
): boolean {
  const middle = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const distances = [start, middle, end].map((pointValue) => pointDistanceMmToPolygon(pointValue, polygonValue));
  if (distances.some((distance) => distance > paddingMm + BUFFER_CONTAINMENT_EPSILON_MM)) return false;
  const quarterLength = Math.hypot(end.x - start.x, end.y - start.y) / 4;
  if (Math.max(...distances) + quarterLength <= paddingMm + BUFFER_CONTAINMENT_EPSILON_MM) return true;
  if (depth >= BUFFER_CONTAINMENT_MAX_DEPTH) return false;
  return segmentInsidePaddedPolygon(start, middle, polygonValue, paddingMm, depth + 1)
    && segmentInsidePaddedPolygon(middle, end, polygonValue, paddingMm, depth + 1);
}

function contourInsidePaddedPolygon(
  contour: readonly SpeedsterPoint[],
  polygonValue: readonly SpeedsterPoint[],
  paddingMm: number,
) {
  const physicalContour = contour.map(physicalPoint);
  const physicalPolygon = polygonValue.map(physicalPoint);
  return physicalContour.length >= 3
    && physicalContour.every((entry) => (
      pointDistanceMmToPolygon(entry, physicalPolygon) <= paddingMm + BUFFER_CONTAINMENT_EPSILON_MM
    ))
    && physicalContour.every((entry, index) => segmentInsidePaddedPolygon(
      entry,
      physicalContour[(index + 1) % physicalContour.length],
      physicalPolygon,
      paddingMm,
    ));
}

export function speedsterMapZoneOverlap(
  finding: SpeedsterReviewFinding,
  candidateZone: SpeedsterMapZone,
) {
  const contours = speedsterFindingRegions(finding).map(({ canonicalContour }) => canonicalContour);
  const vertices = contours.flat();
  const paddingMm = isSpeedsterMapZoneV2(candidateZone) ? candidateZone.filterPaddingMm : 0;
  const physicalPolygon = paddingMm > 0 ? candidateZone.polygon.map(physicalPoint) : null;
  const coveredVertices = vertices.filter((entry) => paddingMm > 0 && physicalPolygon
    ? pointDistanceMmToPolygon(physicalPoint(entry), physicalPolygon) <= paddingMm + BUFFER_CONTAINMENT_EPSILON_MM
    : pointInPolygon(entry, candidateZone.polygon)).length;
  return {
    method: SPEEDSTER_MAP_ZONE_OVERLAP_METHOD,
    coveredVertices,
    totalVertices: vertices.length,
    ratio: vertices.length === 0 ? 0 : coveredVertices / vertices.length,
    fullyContained: contours.length > 0 && contours.every((contour) => paddingMm > 0
      ? contourInsidePaddedPolygon(contour, candidateZone.polygon, paddingMm)
      : contourInsidePolygon(contour, candidateZone.polygon)),
  } as const;
}

export function speedsterBestAuthorizedMapZoneDiagnostic(
  finding: SpeedsterReviewFinding,
  zones: readonly SpeedsterMapZone[],
) {
  return zones
    .filter((zone) => !isSpeedsterMapZoneV2(zone) || zone.filterAuthority)
    .map((zone) => ({ zone, overlap: speedsterMapZoneOverlap(finding, zone) }))
    .sort((left, right) => (
      Number(right.overlap.fullyContained) - Number(left.overlap.fullyContained)
      || right.overlap.ratio - left.overlap.ratio
      || left.zone.id.localeCompare(right.zone.id)
    ))[0] ?? null;
}

export function splitSpeedsterMapFilteredCandidates(input: {
  findings: readonly SpeedsterReviewFinding[];
  cardIdentity: SpeedsterSessionIdentity;
  detectorVersion: string;
  map: SpeedsterPinnedMapFilterInput;
}): SpeedsterMapFilterSplit {
  if (input.detectorVersion !== SPEEDSTER_LEARNING_COMPATIBLE_DETECTOR_VERSION) {
    throw new Error("The pinned Speedster map cannot run with an incompatible detector version.");
  }
  const registrations = coherentMap(input.map);
  const v2Policy = input.map.revision.filterPolicyVersion === SPEEDSTER_MAP_FILTER_POLICY_VERSION_V2;
  if (
    !v2Policy
    && input.map.revision.filterPolicyVersion !== SPEEDSTER_MAP_FILTER_POLICY_VERSION
  ) throw new Error("The pinned Speedster map filter policy is unsupported.");
  const activeFindings: SpeedsterReviewFinding[] = [];
  const filteredDecisions: SpeedsterFilterDecisionEvidence[] = [];

  for (const finding of input.findings) {
    if (finding.origin === "SMART_MARK") {
      activeFindings.push(finding);
      continue;
    }
    if (finding.origin !== "DETECTOR" && finding.origin !== "MEMORY") {
      throw new Error("A map-filter candidate is missing exact Detector or Memory provenance.");
    }
    const matching = registrations[finding.side].projectedZones
      .filter((candidateZone) => {
        if (!v2Policy) return true;
        if (!isSpeedsterMapZoneV2(candidateZone)) {
          throw new Error("The pinned Speedster v2 map zone is missing explicit filter authority.");
        }
        return candidateZone.filterAuthority;
      })
      .map((candidateZone) => ({
        candidateZone,
        zoneOverlap: speedsterMapZoneOverlap(finding, candidateZone),
      }))
      .find(({ zoneOverlap }) => zoneOverlap.fullyContained);
    if (!matching) {
      activeFindings.push(finding);
      continue;
    }
    filteredDecisions.push({
      finding,
      cardIdentity: input.cardIdentity,
      mapId: input.map.revision.mapId,
      mapRevisionId: input.map.revision.revisionId,
      zoneId: matching.candidateZone.id,
      zoneType: matching.candidateZone.semanticType,
      zoneOverlap: matching.zoneOverlap,
      filterPolicyVersion: v2Policy
        ? SPEEDSTER_MAP_FILTER_POLICY_VERSION_V2
        : SPEEDSTER_MAP_FILTER_POLICY_VERSION,
      ruleId: v2Policy ? SPEEDSTER_MAP_FILTER_RULE_ID_V2 : SPEEDSTER_MAP_FILTER_RULE_ID,
      ruleInputs: {
        findingOrigin: finding.origin,
        requiredCoverageRatio: 1,
        ...(v2Policy && isSpeedsterMapZoneV2(matching.candidateZone) ? {
          filterAuthority: true as const,
          filterPaddingMm: matching.candidateZone.filterPaddingMm,
        } : {}),
      },
      detectorVersion: input.detectorVersion,
    });
  }
  return { activeFindings, filteredDecisions };
}
