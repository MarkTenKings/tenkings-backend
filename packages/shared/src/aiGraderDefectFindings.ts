export const AI_GRADER_DEFECT_FINDING_VERSION = "ai-grader-defect-finding-v1" as const;
export const AI_GRADER_DEFECT_FINDING_MAX_COUNT = 100;

export const AI_GRADER_DEFECT_CATEGORIES = [
  "corner_wear",
  "edge_chipping",
  "scratch",
  "crease",
  "dent",
  "stain",
  "print_defect",
  "surface_anomaly",
] as const;

export const AI_GRADER_DEFECT_REVIEW_STATUSES = ["unreviewed", "confirmed", "rejected", "adjusted"] as const;
export const AI_GRADER_DEFECT_SEVERITY_BANDS = ["low", "medium", "high"] as const;

export type AiGraderDefectCategory = (typeof AI_GRADER_DEFECT_CATEGORIES)[number];
export type AiGraderDefectReviewStatus = (typeof AI_GRADER_DEFECT_REVIEW_STATUSES)[number];
export type AiGraderDefectSeverityBand = (typeof AI_GRADER_DEFECT_SEVERITY_BANDS)[number];

export type AiGraderDefectFindingPoint = { x: number; y: number };

export type AiGraderDefectFindingShape =
  | { type: "box"; x: number; y: number; width: number; height: number }
  | { type: "polygon"; points: AiGraderDefectFindingPoint[] };

export type AiGraderDefectFindingV1 = {
  schemaVersion: typeof AI_GRADER_DEFECT_FINDING_VERSION;
  findingId: string;
  side: "front" | "back";
  category: AiGraderDefectCategory;
  detector: {
    id: string;
    version: string;
    captureProfileVersion?: string;
  };
  severity: {
    score?: number;
    band: AiGraderDefectSeverityBand;
  };
  confidence: number;
  review: {
    status: AiGraderDefectReviewStatus;
    reviewedAt?: string;
  };
  geometry: {
    coordinateFrame: "normalized_card";
    units: "fraction";
    shape: AiGraderDefectFindingShape;
  };
  evidence: {
    trueViewAssetId?: string;
    heatmapAssetId?: string;
    surfaceVisionAssetId?: string;
    maskAssetId?: string;
    overlayAssetId?: string;
    channelAssetIds: string[];
    roiAssetIds: string[];
  };
  explanation: string;
};

export type AiGraderDefectFindingValidationIssue = {
  path: string;
  message: string;
};

export type AiGraderDefectFindingParseResult =
  | { success: true; data: AiGraderDefectFindingV1 }
  | { success: false; issues: AiGraderDefectFindingValidationIssue[] };

export type AiGraderDefectFindingsParseResult = {
  findings: AiGraderDefectFindingV1[];
  issues: AiGraderDefectFindingValidationIssue[];
};

type ParseOptions = {
  knownAssetIds?: ReadonlySet<string>;
  requireTrueViewAsset?: boolean;
  maxFindings?: number;
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issue(path: string, message: string): AiGraderDefectFindingValidationIssue {
  return { path, message };
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function boundedText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength || /[\u0000-\u001f\u007f]/.test(trimmed)) return "";
  return trimmed;
}

function unsafePublicText(value: string) {
  return (
    /(?:https?|data|blob|file):/i.test(value) ||
    /[a-z]:[\\/]/i.test(value) ||
    /\\\\/.test(value) ||
    /(?:^|\s)(?:\/Users\/|\/home\/|\/root\/|\/tmp\/|\/app\/|\/workspace\/)/i.test(value) ||
    /(?:authorization\s*:|bearer\s+|api[_ -]?key\s*[=:]|password\s*[=:]|token\s*[=:]|secret\s*[=:]|credential\s*[=:])/i.test(value) ||
    /[<>]/.test(value)
  );
}

function publicIdentifier(value: unknown) {
  const text = boundedText(value, 128);
  return text && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(text) ? text : "";
}

export function isSafeAiGraderPublicAssetId(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 256) return false;
  if (/^[\\/]/.test(value) || /[\\?#\u0000-\u001f\u007f]/.test(value)) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.includes("://")) return false;
  const segments = value.split("/");
  if (!segments.length || segments.some((segment) => !segment || segment === "." || segment === "..")) return false;
  return segments.every((segment) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(segment));
}

function parseAssetId(
  value: unknown,
  path: string,
  issues: AiGraderDefectFindingValidationIssue[],
  options: ParseOptions,
) {
  if (!isSafeAiGraderPublicAssetId(value)) {
    issues.push(issue(path, "must be a safe logical public asset ID"));
    return undefined;
  }
  if (options.knownAssetIds && !options.knownAssetIds.has(value)) {
    issues.push(issue(path, "must reference a published image asset"));
    return undefined;
  }
  return value;
}

function parseAssetIds(
  value: unknown,
  path: string,
  issues: AiGraderDefectFindingValidationIssue[],
  options: ParseOptions,
) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 32) {
    issues.push(issue(path, "must be an array with at most 32 asset IDs"));
    return [];
  }
  const parsed: string[] = [];
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    const assetId = parseAssetId(entry, `${path}[${index}]`, issues, options);
    if (!assetId) return;
    const canonical = assetId.toLowerCase();
    if (seen.has(canonical)) return;
    seen.add(canonical);
    parsed.push(assetId);
  });
  return parsed;
}

function parseFraction(value: unknown, path: string, issues: AiGraderDefectFindingValidationIssue[]) {
  if (!finiteNumber(value) || value < 0 || value > 1) {
    issues.push(issue(path, "must be a finite fraction between 0 and 1"));
    return undefined;
  }
  return value;
}

function polygonArea(points: AiGraderDefectFindingPoint[]) {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    twiceArea += current.x * next.y - next.x * current.y;
  }
  return Math.abs(twiceArea) / 2;
}

function parseShape(value: unknown, path: string, issues: AiGraderDefectFindingValidationIssue[]) {
  if (!isRecord(value)) {
    issues.push(issue(path, "must be a box or polygon"));
    return undefined;
  }
  if (value.type === "box") {
    const x = parseFraction(value.x, `${path}.x`, issues);
    const y = parseFraction(value.y, `${path}.y`, issues);
    const width = parseFraction(value.width, `${path}.width`, issues);
    const height = parseFraction(value.height, `${path}.height`, issues);
    if (x === undefined || y === undefined || width === undefined || height === undefined) return undefined;
    if (width <= 0 || height <= 0 || x + width > 1 + 1e-9 || y + height > 1 + 1e-9) {
      issues.push(issue(path, "box must have positive area and remain inside the normalized card"));
      return undefined;
    }
    return { type: "box" as const, x, y, width, height };
  }
  if (value.type === "polygon") {
    if (!Array.isArray(value.points) || value.points.length < 3 || value.points.length > 64) {
      issues.push(issue(`${path}.points`, "must contain 3 to 64 points"));
      return undefined;
    }
    const points: AiGraderDefectFindingPoint[] = [];
    value.points.forEach((entry, index) => {
      if (!isRecord(entry)) {
        issues.push(issue(`${path}.points[${index}]`, "must be a normalized point"));
        return;
      }
      const x = parseFraction(entry.x, `${path}.points[${index}].x`, issues);
      const y = parseFraction(entry.y, `${path}.points[${index}].y`, issues);
      if (x !== undefined && y !== undefined) points.push({ x, y });
    });
    if (points.length !== value.points.length || polygonArea(points) <= 1e-8) {
      issues.push(issue(path, "polygon must have nonzero area inside the normalized card"));
      return undefined;
    }
    return { type: "polygon" as const, points };
  }
  issues.push(issue(`${path}.type`, "must be box or polygon"));
  return undefined;
}

function enumValue<T extends readonly string[]>(value: unknown, allowed: T) {
  return typeof value === "string" && allowed.includes(value) ? (value as T[number]) : undefined;
}

export function parseAiGraderDefectFindingV1(value: unknown, options: ParseOptions = {}): AiGraderDefectFindingParseResult {
  const issues: AiGraderDefectFindingValidationIssue[] = [];
  if (!isRecord(value)) return { success: false, issues: [issue("finding", "must be an object")] };

  if (value.schemaVersion !== AI_GRADER_DEFECT_FINDING_VERSION) {
    issues.push(issue("schemaVersion", `must be ${AI_GRADER_DEFECT_FINDING_VERSION}`));
  }
  const findingId = boundedText(value.findingId, 128);
  if (!findingId || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(findingId)) {
    issues.push(issue("findingId", "must be a safe stable identifier"));
  }
  const side = value.side === "front" || value.side === "back" ? value.side : undefined;
  if (!side) issues.push(issue("side", "must be front or back"));
  const category = enumValue(value.category, AI_GRADER_DEFECT_CATEGORIES);
  if (!category) issues.push(issue("category", "is not a supported defect category"));

  const detector = isRecord(value.detector) ? value.detector : {};
  const detectorId = publicIdentifier(detector.id);
  const detectorVersion = publicIdentifier(detector.version);
  const captureProfileVersion = detector.captureProfileVersion === undefined ? undefined : publicIdentifier(detector.captureProfileVersion);
  if (!detectorId) issues.push(issue("detector.id", "must be a safe detector identifier"));
  if (!detectorVersion) issues.push(issue("detector.version", "must be a safe detector version"));
  if (detector.captureProfileVersion !== undefined && !captureProfileVersion) {
    issues.push(issue("detector.captureProfileVersion", "must be a safe capture-profile version"));
  }

  const severity = isRecord(value.severity) ? value.severity : {};
  const severityBand = enumValue(severity.band, AI_GRADER_DEFECT_SEVERITY_BANDS);
  if (!severityBand) issues.push(issue("severity.band", "must be low, medium, or high"));
  const severityScore = severity.score === undefined ? undefined : severity.score;
  if (severityScore !== undefined && (!finiteNumber(severityScore) || severityScore < 0 || severityScore > 100)) {
    issues.push(issue("severity.score", "must be a finite number between 0 and 100"));
  }
  const confidence = value.confidence;
  if (!finiteNumber(confidence) || confidence < 0 || confidence > 1) {
    issues.push(issue("confidence", "must be a finite number between 0 and 1"));
  }

  const review = isRecord(value.review) ? value.review : {};
  const reviewStatus = enumValue(review.status, AI_GRADER_DEFECT_REVIEW_STATUSES);
  if (!reviewStatus) issues.push(issue("review.status", "is not a supported review status"));
  let reviewedAt: string | undefined;
  if (review.reviewedAt !== undefined) {
    const reviewedText = boundedText(review.reviewedAt, 40);
    const timestamp = reviewedText ? Date.parse(reviewedText) : Number.NaN;
    if (!Number.isFinite(timestamp)) issues.push(issue("review.reviewedAt", "must be an ISO timestamp"));
    else reviewedAt = new Date(timestamp).toISOString();
  }

  const geometry = isRecord(value.geometry) ? value.geometry : {};
  if (geometry.coordinateFrame !== "normalized_card") issues.push(issue("geometry.coordinateFrame", "must be normalized_card"));
  if (geometry.units !== "fraction") issues.push(issue("geometry.units", "must be fraction"));
  const shape = parseShape(geometry.shape, "geometry.shape", issues);

  const evidence = isRecord(value.evidence) ? value.evidence : {};
  const trueViewAssetId = evidence.trueViewAssetId === undefined
    ? undefined
    : parseAssetId(evidence.trueViewAssetId, "evidence.trueViewAssetId", issues, options);
  if (options.requireTrueViewAsset && !trueViewAssetId) {
    issues.push(issue("evidence.trueViewAssetId", "is required for a publishable finding"));
  }
  const optionalAsset = (key: string) => evidence[key] === undefined
    ? undefined
    : parseAssetId(evidence[key], `evidence.${key}`, issues, options);
  const heatmapAssetId = optionalAsset("heatmapAssetId");
  const surfaceVisionAssetId = optionalAsset("surfaceVisionAssetId");
  const maskAssetId = optionalAsset("maskAssetId");
  const overlayAssetId = optionalAsset("overlayAssetId");
  const channelAssetIds = parseAssetIds(evidence.channelAssetIds, "evidence.channelAssetIds", issues, options);
  const roiAssetIds = parseAssetIds(evidence.roiAssetIds, "evidence.roiAssetIds", issues, options);

  const explanation = boundedText(value.explanation, 500);
  if (!explanation || unsafePublicText(explanation)) issues.push(issue("explanation", "must be safe public text of at most 500 characters"));

  if (issues.length || !findingId || !side || !category || !detectorId || !detectorVersion || !severityBand || !reviewStatus || !shape || !finiteNumber(confidence)) {
    return { success: false, issues };
  }
  return {
    success: true,
    data: {
      schemaVersion: AI_GRADER_DEFECT_FINDING_VERSION,
      findingId,
      side,
      category,
      detector: {
        id: detectorId,
        version: detectorVersion,
        ...(captureProfileVersion ? { captureProfileVersion } : {}),
      },
      severity: {
        ...(finiteNumber(severityScore) ? { score: severityScore } : {}),
        band: severityBand,
      },
      confidence,
      review: {
        status: reviewStatus,
        ...(reviewedAt ? { reviewedAt } : {}),
      },
      geometry: {
        coordinateFrame: "normalized_card",
        units: "fraction",
        shape,
      },
      evidence: {
        ...(trueViewAssetId ? { trueViewAssetId } : {}),
        ...(heatmapAssetId ? { heatmapAssetId } : {}),
        ...(surfaceVisionAssetId ? { surfaceVisionAssetId } : {}),
        ...(maskAssetId ? { maskAssetId } : {}),
        ...(overlayAssetId ? { overlayAssetId } : {}),
        channelAssetIds,
        roiAssetIds,
      },
      explanation,
    },
  };
}

export function parseAiGraderDefectFindings(value: unknown, options: ParseOptions = {}): AiGraderDefectFindingsParseResult {
  if (value === undefined) return { findings: [], issues: [] };
  if (!Array.isArray(value)) return { findings: [], issues: [issue("defectFindings", "must be an array")] };
  const maxFindings = Math.min(Math.max(options.maxFindings ?? AI_GRADER_DEFECT_FINDING_MAX_COUNT, 0), AI_GRADER_DEFECT_FINDING_MAX_COUNT);
  if (value.length > maxFindings) {
    return { findings: [], issues: [issue("defectFindings", `must contain at most ${maxFindings} findings`)] };
  }
  const findings: AiGraderDefectFindingV1[] = [];
  const issues: AiGraderDefectFindingValidationIssue[] = [];
  const ids = new Set<string>();
  value.forEach((entry, index) => {
    const parsed = parseAiGraderDefectFindingV1(entry, options);
    if (!parsed.success) {
      parsed.issues.forEach((entryIssue) => issues.push({ ...entryIssue, path: `defectFindings[${index}].${entryIssue.path}` }));
      return;
    }
    const canonicalId = parsed.data.findingId.toLowerCase();
    if (ids.has(canonicalId)) {
      issues.push(issue(`defectFindings[${index}].findingId`, "must be unique case-insensitively"));
      return;
    }
    ids.add(canonicalId);
    findings.push(parsed.data);
  });
  return { findings, issues };
}

export function isAiGraderDefectFindingV1(value: unknown): value is AiGraderDefectFindingV1 {
  return parseAiGraderDefectFindingV1(value).success;
}
