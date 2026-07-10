import { createHash } from "node:crypto";
import {
  AI_GRADER_DEFECT_FINDING_VERSION,
  parseAiGraderDefectFindingV1,
  parseAiGraderDefectFindings,
  type AiGraderDefectCategory,
  type AiGraderDefectFindingV1,
  type AiGraderDefectFindingValidationIssue,
} from "@tenkings/shared";

type JsonRecord = Record<string, unknown>;
type Side = "front" | "back";

export type AiGraderApprovedDefectEvidence = Partial<AiGraderDefectFindingV1["evidence"]>;

export interface ExtractAiGraderDefectFindingsOptions {
  captureProfileVersion?: string;
  captureProfileVersionBySide?: Partial<Record<Side, string>>;
  approvedEvidenceBySide?: Partial<Record<Side, AiGraderApprovedDefectEvidence>>;
  approvedEvidenceByCandidateKey?: Record<string, AiGraderApprovedDefectEvidence>;
  normalizedSourceSha256BySide?: Partial<Record<Side, string>>;
  normalizedArtifactSha256BySide?: Partial<Record<Side, string>>;
  requireNormalizedSourceMatch?: boolean;
  knownAssetIds?: ReadonlySet<string>;
  requireTrueViewAsset?: boolean;
}

export interface AiGraderDefectFindingExtractionResult {
  findings: AiGraderDefectFindingV1[];
  issues: AiGraderDefectFindingValidationIssue[];
  sourceCandidateFindingIds: Record<string, string>;
  sourceCandidateCount: number;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonemptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function categoryFor(value: unknown): AiGraderDefectCategory | undefined {
  if (value === "surface") return "surface_anomaly";
  if (
    value === "corner_wear" ||
    value === "edge_chipping" ||
    value === "scratch" ||
    value === "crease" ||
    value === "dent" ||
    value === "stain" ||
    value === "print_defect" ||
    value === "surface_anomaly"
  ) {
    return value;
  }
  return undefined;
}

function round(value: number) {
  return Number(value.toFixed(6));
}

function canonicalPolygonPoints(points: Array<{ x: number; y: number }>) {
  const withoutClosingPoint = points.length > 3 &&
    points[0]?.x === points.at(-1)?.x &&
    points[0]?.y === points.at(-1)?.y
    ? points.slice(0, -1)
    : points;
  const sequences: Array<Array<{ x: number; y: number }>> = [];
  for (const ordered of [withoutClosingPoint, [...withoutClosingPoint].reverse()]) {
    for (let offset = 0; offset < ordered.length; offset += 1) {
      sequences.push([...ordered.slice(offset), ...ordered.slice(0, offset)]);
    }
  }
  return sequences.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))[0] ?? [];
}

function canonicalGeometry(value: unknown): AiGraderDefectFindingV1["geometry"] | undefined {
  if (!isRecord(value) || value.coordinateFrame !== "normalized_card" || value.units !== "fraction" || !isRecord(value.shape)) {
    return undefined;
  }
  const shape = value.shape;
  if (shape.type === "box") {
    if (![shape.x, shape.y, shape.width, shape.height].every(finiteNumber)) return undefined;
    return {
      coordinateFrame: "normalized_card",
      units: "fraction",
      shape: {
        type: "box",
        x: round(shape.x as number),
        y: round(shape.y as number),
        width: round(shape.width as number),
        height: round(shape.height as number),
      },
    };
  }
  if (shape.type === "polygon" && Array.isArray(shape.points)) {
    const points = shape.points.map((point) => {
      if (!isRecord(point) || !finiteNumber(point.x) || !finiteNumber(point.y)) return undefined;
      return { x: round(point.x), y: round(point.y) };
    });
    if (points.some((point) => !point)) return undefined;
    return {
      coordinateFrame: "normalized_card",
      units: "fraction",
      shape: { type: "polygon", points: canonicalPolygonPoints(points as Array<{ x: number; y: number }>) },
    };
  }
  return undefined;
}

function severityBand(value: unknown, score: number | undefined): "low" | "medium" | "high" | undefined {
  if (value === "low" || value === "medium" || value === "high") return value;
  if (score === undefined) return undefined;
  if ((score ?? 0) >= 68) return "high";
  if ((score ?? 0) >= 38) return "medium";
  return "low";
}

function mergeEvidence(
  sideEvidence: AiGraderApprovedDefectEvidence | undefined,
  candidateEvidence: AiGraderApprovedDefectEvidence | undefined,
): AiGraderDefectFindingV1["evidence"] {
  const scalar = (key: "trueViewAssetId" | "heatmapAssetId" | "surfaceVisionAssetId" | "maskAssetId" | "overlayAssetId") =>
    candidateEvidence?.[key] ?? sideEvidence?.[key];
  const mergeIds = (key: "channelAssetIds" | "roiAssetIds") =>
    Array.from(new Set([...(sideEvidence?.[key] ?? []), ...(candidateEvidence?.[key] ?? [])]));
  return {
    ...(scalar("trueViewAssetId") ? { trueViewAssetId: scalar("trueViewAssetId") } : {}),
    ...(scalar("heatmapAssetId") ? { heatmapAssetId: scalar("heatmapAssetId") } : {}),
    ...(scalar("surfaceVisionAssetId") ? { surfaceVisionAssetId: scalar("surfaceVisionAssetId") } : {}),
    ...(scalar("maskAssetId") ? { maskAssetId: scalar("maskAssetId") } : {}),
    ...(scalar("overlayAssetId") ? { overlayAssetId: scalar("overlayAssetId") } : {}),
    channelAssetIds: mergeIds("channelAssetIds"),
    roiAssetIds: mergeIds("roiAssetIds"),
  };
}

export function createStableAiGraderDefectFindingId(input: {
  side: Side;
  category: AiGraderDefectCategory;
  detector: AiGraderDefectFindingV1["detector"];
  geometry: AiGraderDefectFindingV1["geometry"];
}) {
  const geometry = canonicalGeometry(input.geometry);
  if (!geometry) throw new Error("Stable defect finding IDs require canonical normalized-card geometry.");
  const payload = JSON.stringify({
    schemaVersion: AI_GRADER_DEFECT_FINDING_VERSION,
    side: input.side,
    category: input.category,
    detector: {
      id: input.detector.id,
      version: input.detector.version,
      ...(input.detector.captureProfileVersion ? { captureProfileVersion: input.detector.captureProfileVersion } : {}),
    },
    geometry,
  });
  return `dfv1_${createHash("sha256").update(payload).digest("hex").slice(0, 24)}`;
}

function containersFor(analysis: JsonRecord, side: Side) {
  const containers: Array<{ candidates: unknown[]; detector: JsonRecord; path: string }> = [];
  const surfaceRoot = isRecord(analysis.surfaceIntelligence) ? analysis.surfaceIntelligence : undefined;
  const surfaceSide = surfaceRoot && isRecord(surfaceRoot[side]) ? surfaceRoot[side] as JsonRecord : undefined;
  if (surfaceSide && Array.isArray(surfaceSide.candidates)) {
    containers.push({ candidates: surfaceSide.candidates, detector: { ...surfaceRoot, ...surfaceSide }, path: `surfaceIntelligence.${side}` });
  }
  const visionLab = isRecord(analysis.visionLab) ? analysis.visionLab : undefined;
  const sides = visionLab && isRecord(visionLab.sides) ? visionLab.sides : undefined;
  const visionSide = sides && isRecord(sides[side]) ? sides[side] as JsonRecord : undefined;
  if (visionSide && Array.isArray(visionSide.candidates)) {
    const detector = isRecord(visionSide.surfaceIntelligence) ? visionSide.surfaceIntelligence : visionSide;
    containers.push({ candidates: visionSide.candidates, detector, path: `visionLab.sides.${side}` });
  }
  return containers;
}

export function extractAiGraderDefectFindingsV1(
  value: unknown,
  options: ExtractAiGraderDefectFindingsOptions = {},
): AiGraderDefectFindingExtractionResult {
  if (!isRecord(value)) {
    return {
      findings: [],
      issues: [{ path: "analysis", message: "must be an object" }],
      sourceCandidateFindingIds: {},
      sourceCandidateCount: 0,
    };
  }
  const findings: AiGraderDefectFindingV1[] = [];
  const issues: AiGraderDefectFindingValidationIssue[] = [];
  const sourceCandidateFindingIds: Record<string, string> = {};
  const sourceCandidateKeys = new Set<string>();
  const ids = new Set<string>();

  for (const side of ["front", "back"] as const) {
    for (const container of containersFor(value, side)) {
      if (container.candidates.length === 0) continue;
      const detectorId = nonemptyString(container.detector.detectorId);
      const detectorVersion = nonemptyString(container.detector.version);
      const captureProfileVersion =
        nonemptyString(container.detector.captureProfileVersion) ??
        nonemptyString(options.captureProfileVersionBySide?.[side]) ??
        nonemptyString(options.captureProfileVersion);
      if (!detectorId) {
        issues.push({ path: `${container.path}.detectorId`, message: "a nonempty detector id is required when candidates are present" });
      }
      if (!detectorVersion) {
        issues.push({ path: `${container.path}.version`, message: "a nonempty detector version is required when candidates are present" });
      }
      if (!captureProfileVersion) {
        issues.push({
          path: `${container.path}.captureProfileVersion`,
          message: "a nonempty capture-profile version from capture metadata is required when candidates are present",
        });
      }
      if (!detectorId || !detectorVersion || !captureProfileVersion) {
        container.candidates.forEach((candidate, index) => {
          const candidateId = isRecord(candidate) ? nonemptyString(candidate.candidateId) : undefined;
          sourceCandidateKeys.add(candidateId ? `${side}:${candidateId}` : `${container.path}.candidates[${index}]`);
        });
        continue;
      }
      for (let index = 0; index < container.candidates.length; index += 1) {
        if (findings.length >= 100) {
          issues.push({ path: container.path, message: "candidate output is capped at 100 findings" });
          break;
        }
        const candidate = container.candidates[index];
        const sourceCandidateId = isRecord(candidate) ? nonemptyString(candidate.candidateId) : undefined;
        sourceCandidateKeys.add(sourceCandidateId ? `${side}:${sourceCandidateId}` : `${container.path}.candidates[${index}]`);
        if (!isRecord(candidate)) {
          issues.push({ path: `${container.path}.candidates[${index}]`, message: "candidate must be an object" });
          continue;
        }
        if (candidate.side !== undefined && candidate.side !== side) {
          issues.push({ path: `${container.path}.candidates[${index}].side`, message: "candidate side must match its analysis container" });
          continue;
        }
        const rawGeometry = isRecord(candidate.analysisGeometry)
          ? candidate.analysisGeometry
          : isRecord(candidate.normalizedCardGeometry)
            ? candidate.normalizedCardGeometry
            : undefined;
        if (options.requireNormalizedSourceMatch) {
          const expectedSourceSha256 = options.normalizedSourceSha256BySide?.[side]?.toLowerCase();
          const geometrySourceSha256 = typeof rawGeometry?.sourceSha256 === "string"
            ? rawGeometry.sourceSha256.toLowerCase()
            : "";
          const expectedArtifactSha256 = options.normalizedArtifactSha256BySide?.[side]?.toLowerCase();
          const geometryArtifactSha256 = typeof rawGeometry?.normalizedArtifactSha256 === "string"
            ? rawGeometry.normalizedArtifactSha256.toLowerCase()
            : "";
          if (
            !/^[a-f0-9]{64}$/.test(expectedSourceSha256 ?? "") ||
            !/^[a-f0-9]{64}$/.test(expectedArtifactSha256 ?? "") ||
            geometrySourceSha256 !== expectedSourceSha256 ||
            geometryArtifactSha256 !== expectedArtifactSha256
          ) {
            issues.push({
              path: `${container.path}.candidates[${index}].analysisGeometry`,
              message: "candidate geometry must match the normalized-card source and artifact fingerprints",
            });
            continue;
          }
        }
        const category = categoryFor(candidate.category);
        const geometry = canonicalGeometry(rawGeometry);
        if (!category || !geometry) {
          issues.push({ path: `${container.path}.candidates[${index}]`, message: "candidate requires a supported category and normalized-card geometry" });
          continue;
        }
        const detector = {
          id: detectorId,
          version: detectorVersion,
          captureProfileVersion,
        };
        const scoreSource = finiteNumber(candidate.severityProxy)
          ? candidate.severityProxy
          : finiteNumber(candidate.anomalyProxyScore)
            ? candidate.anomalyProxyScore
            : undefined;
        const score = scoreSource === undefined ? undefined : Math.min(100, Math.max(0, round(scoreSource)));
        const containerConfidence = isRecord(container.detector.confidence) ? container.detector.confidence.score : undefined;
        const confidenceSource = finiteNumber(candidate.confidence) ? candidate.confidence : finiteNumber(containerConfidence) ? containerConfidence : undefined;
        const candidateId = sourceCandidateId ?? "";
        const findingId = createStableAiGraderDefectFindingId({ side, category, detector, geometry });
        if (ids.has(findingId)) {
          if (candidateId) {
            sourceCandidateFindingIds[`${side}:${candidateId}`] = findingId;
          }
          continue;
        }
        const parsed = parseAiGraderDefectFindingV1(
          {
            schemaVersion: AI_GRADER_DEFECT_FINDING_VERSION,
            findingId,
            side,
            category,
            detector,
            severity: { ...(score === undefined ? {} : { score }), band: severityBand(candidate.severityBand, score) },
            confidence: confidenceSource === undefined ? undefined : round(confidenceSource),
            review: { status: "unreviewed" },
            geometry,
            evidence: mergeEvidence(
              options.approvedEvidenceBySide?.[side],
              candidateId ? options.approvedEvidenceByCandidateKey?.[`${side}:${candidateId}`] : undefined,
            ),
            explanation: "AI-detected provisional surface finding. Review the linked evidence before relying on this finding.",
          },
          {
            knownAssetIds: options.knownAssetIds,
            requireTrueViewAsset: options.requireTrueViewAsset,
          },
        );
        if (!parsed.success) {
          parsed.issues.forEach((entry) => issues.push({ ...entry, path: `${container.path}.candidates[${index}].${entry.path}` }));
          continue;
        }
        ids.add(findingId);
        if (candidateId) {
          sourceCandidateFindingIds[`${side}:${candidateId}`] = findingId;
        }
        findings.push(parsed.data);
      }
    }
  }

  const collection = parseAiGraderDefectFindings(findings, {
    knownAssetIds: options.knownAssetIds,
    requireTrueViewAsset: options.requireTrueViewAsset,
  });
  return {
    findings: collection.findings,
    issues: [...issues, ...collection.issues],
    sourceCandidateFindingIds,
    sourceCandidateCount: sourceCandidateKeys.size,
  };
}
