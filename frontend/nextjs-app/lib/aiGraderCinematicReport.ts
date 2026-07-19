import type { AiGraderDefectFindingV1 } from "@tenkings/shared";
import {
  aiGraderReportDefectFindings,
  type AiGraderCompatibleReportBundle,
} from "./aiGraderReportBundle";
import {
  reportImageAssets,
  type AiGraderRenderableReportImage,
} from "./aiGraderReportImages";

export type CinematicSide = "front" | "back";
export type CinematicEvidenceMode = "trueView" | "heatmap" | "surfaceVision" | "directional";

export type CinematicImage = AiGraderRenderableReportImage & {
  side: CinematicSide;
  evidenceRole:
    | "normalized_card"
    | "surface_heatmap"
    | "surface_vision"
    | "confidence_mask"
    | "measurement_overlay"
    | "directional_channel"
    | "roi_crop"
    | "other_evidence";
};

export type CinematicMeasurement = {
  lengthMm?: number;
  widthMm?: number;
  calibrationVersion: string;
};

export type CinematicFinding = {
  finding: AiGraderDefectFindingV1;
  statusLabel: "Confirmed" | "AI candidate";
  trueView: CinematicImage;
  measurements?: CinematicMeasurement;
  heatmap?: CinematicImage;
  directional?: CinematicImage;
};

export type CinematicElement = {
  key: "centering" | "corners" | "edges" | "surface";
  score: number;
  confidence?: string;
  explanation?: string;
};

export type CinematicNote = { id: string; title: string; explanation?: string };

export type CinematicReport = {
  reportId?: string;
  title?: string;
  set?: string;
  cardNumber?: string;
  generatedAt?: string;
  grade?: {
    score: number;
    tkScore: number;
    confidenceScore?: number;
    confidenceBand?: string;
    elements: CinematicElement[];
    reportLabelId?: string;
  };
  notes: CinematicNote[];
  images: Partial<Record<CinematicSide, {
    trueView?: CinematicImage;
    heatmap?: CinematicImage;
    surfaceVision?: CinematicImage;
    confidenceMask?: CinematicImage;
  }>>;
  findings: Record<CinematicSide, CinematicFinding[]>;
  certifiedPresentation: false;
};

type JsonRecord = Record<string, unknown>;

const ELEMENT_KEYS = ["centering", "corners", "edges", "surface"] as const;
const SAFE_PUBLIC_TEXT = /(?:data|blob|file):|(?:[a-z]:[\\/])|\\\\|(?:authorization\s*:|bearer\s+|api[_ -]?key\s*[=:]|password\s*[=:]|token\s*[=:]|secret\s*[=:]|credential\s*[=:])|[<>]/i;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function text(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed && !SAFE_PUBLIC_TEXT.test(trimmed) ? trimmed : undefined;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function safePublicImageUrl(value: unknown) {
  if (typeof value !== "string") return false;
  const candidate = value.trim();
  if (!candidate || /^(?:data|blob|file):/i.test(candidate) || /(?:x-amz-|x-goog-|signature=|[?&]token=|presign)/i.test(candidate)) return false;
  if (candidate.startsWith("/")) return !candidate.startsWith("//") && !/[?#\\\u0000-\u001f\u007f]/.test(candidate);
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!host || host === "::" || host === "::1" || host.startsWith("::ffff:") || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan")) return false;
    const octets = host.split(".");
    if (octets.length === 4 && octets.every((part) => /^\d{1,3}$/.test(part))) {
      const [first, second] = octets.map(Number);
      if (first === 0 || first === 10 || first === 127 || first >= 224 || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function cinematicImage(asset: AiGraderRenderableReportImage): CinematicImage | undefined {
  if (
    (asset.side !== "front" && asset.side !== "back") ||
    !asset.evidenceRole ||
    !safePublicImageUrl(asset.renderUrl)
  ) return undefined;
  return {
    id: asset.id,
    ...(text(asset.fileName) ? { fileName: text(asset.fileName) } : {}),
    side: asset.side,
    evidenceRole: asset.evidenceRole,
    renderUrl: asset.renderUrl,
    renderSource: "public_url",
  } as CinematicImage;
}

function imagesForBundle(bundle: JsonRecord): CinematicImage[] {
  return reportImageAssets(bundle as AiGraderCompatibleReportBundle)
    .map(cinematicImage)
    .filter((asset): asset is CinematicImage => Boolean(asset));
}

function matchingImage(
  images: CinematicImage[],
  side: CinematicSide,
  role: CinematicImage["evidenceRole"],
  exactAssetId?: string,
) {
  return images.find((image) =>
    image.side === side &&
    image.evidenceRole === role &&
    (!exactAssetId || image.id.toLowerCase() === exactAssetId.toLowerCase()),
  );
}

function legacyOrPublishedFindings(bundle: JsonRecord): AiGraderDefectFindingV1[] {
  if (bundle.schemaVersion === "ai-grader-report-bundle-v0.2" && Array.isArray(bundle.defectFindings)) {
    return aiGraderReportDefectFindings(bundle as AiGraderCompatibleReportBundle);
  }
  const visionLab = isRecord(bundle.visionLab) ? bundle.visionLab : {};
  const rawFindings = Array.isArray(visionLab.defectFindings) ? visionLab.defectFindings : [];
  return rawFindings.filter((finding): finding is AiGraderDefectFindingV1 => {
    if (!isRecord(finding) || finding.schemaVersion !== "ai-grader-defect-finding-v1") return false;
    const side = finding.side;
    const geometry = isRecord(finding.geometry) ? finding.geometry : undefined;
    const shape = geometry && isRecord(geometry.shape) ? geometry.shape : undefined;
    return (
      (side === "front" || side === "back") &&
      geometry?.coordinateFrame === "normalized_card" &&
      geometry.units === "fraction" &&
      (shape?.type === "box" || shape?.type === "polygon")
    );
  });
}

function publishedMeasurementsByFindingId(bundle: JsonRecord, calibrationVersion: string | undefined) {
  const measurements = new Map<string, CinematicMeasurement>();
  if (!calibrationVersion || !Array.isArray(bundle.defectFindings)) return measurements;
  for (const entry of bundle.defectFindings) {
    if (!isRecord(entry) || !isRecord(entry.measurements)) continue;
    const findingId = text(entry.findingId);
    const version = text(entry.measurements.calibrationVersion);
    if (!findingId || version !== calibrationVersion) continue;
    const lengthMm = finiteNumber(entry.measurements.lengthMm);
    const widthMm = finiteNumber(entry.measurements.widthMm);
    if (lengthMm === undefined && widthMm === undefined) continue;
    measurements.set(findingId, { lengthMm, widthMm, calibrationVersion: version });
  }
  return measurements;
}

function gradeData(bundle: JsonRecord, minimumScore: 0 | 1) {
  const productionRelease = isRecord(bundle.productionRelease) ? bundle.productionRelease : undefined;
  const finalGrade = productionRelease && isRecord(productionRelease.finalGrade) ? productionRelease.finalGrade : undefined;
  const provisionalGrade = isRecord(bundle.provisionalGrade) ? bundle.provisionalGrade : undefined;
  const source = finalGrade && finiteNumber(finalGrade.overall) !== undefined ? finalGrade : provisionalGrade;
  if (!source) return undefined;
  const score = finiteNumber(source.overall);
  if (score === undefined || score < minimumScore || score > 10) return undefined;
  const confidence = isRecord(source.confidence) ? source.confidence : undefined;
  const elementSource = isRecord(source.elements)
    ? source.elements
    : isRecord(source.elementScores)
      ? source.elementScores
      : {};
  const elements: CinematicElement[] = ELEMENT_KEYS.flatMap((key) => {
    const value = isRecord(elementSource[key]) ? elementSource[key] : undefined;
    const elementScore = value && finiteNumber(value.score);
    if (elementScore === undefined || elementScore < minimumScore || elementScore > 10) return [];
    return [{
      key,
      score: elementScore,
      ...(text(value?.confidence) ? { confidence: text(value?.confidence) } : {}),
      ...(text(value?.explanation) ? { explanation: text(value?.explanation) } : {}),
    }];
  });
  const label = productionRelease && isRecord(productionRelease.label) ? productionRelease.label : undefined;
  return {
    score,
    tkScore: Math.round(score * 100),
    ...(confidence && finiteNumber(confidence.score) !== undefined ? { confidenceScore: finiteNumber(confidence.score) } : {}),
    ...(confidence && text(confidence.band) ? { confidenceBand: text(confidence.band) } : {}),
    elements,
    ...(label && text(label.certId) ? { reportLabelId: text(label.certId) } : {}),
  };
}

function reportNotes(bundle: JsonRecord): CinematicNote[] {
  const productionRelease = isRecord(bundle.productionRelease) ? bundle.productionRelease : undefined;
  const finalGrade = productionRelease && isRecord(productionRelease.finalGrade) ? productionRelease.finalGrade : undefined;
  const provisionalGrade = isRecord(bundle.provisionalGrade) ? bundle.provisionalGrade : undefined;
  const source = finalGrade ?? provisionalGrade;
  if (!source || !Array.isArray(source.whyNot10)) return [];
  return source.whyNot10.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const id = text(entry.id);
    const title = text(entry.title);
    if (!id || !title) return [];
    return [{ id, title, ...(text(entry.explanation) ? { explanation: text(entry.explanation) } : {}) }];
  });
}

/**
 * Converts only public bundle fields into display data. No report number,
 * score, date, measurement, evidence image, or optional room is synthesized.
 * Current public policy does not permit a certified cinematic presentation.
 */
function toAiGraderCinematicReportWithMinimumScore(value: unknown, minimumScore: 0 | 1): CinematicReport | null {
  if (!isRecord(value)) return null;
  const images = imagesForBundle(value);
  const cardIdentity = isRecord(value.cardIdentity) ? value.cardIdentity : {};
  const calibrationProfile = isRecord(value.calibrationProfile) ? value.calibrationProfile : undefined;
  const calibrated = calibrationProfile?.isCalibrated === true;
  const calibrationVersion = calibrated ? text(calibrationProfile?.calibrationVersion) : undefined;
  const measurements = publishedMeasurementsByFindingId(value, calibrationVersion);
  const allFindings = legacyOrPublishedFindings(value).filter((finding) => finding.review.status !== "rejected");
  const cinematicFindings = (side: CinematicSide): CinematicFinding[] => allFindings
    .filter((finding) => finding.side === side)
    .flatMap((finding) => {
      const trueView = matchingImage(images, side, "normalized_card", finding.evidence.trueViewAssetId);
      if (!trueView) return [];
      const heatmap = matchingImage(images, side, "surface_heatmap", finding.evidence.heatmapAssetId);
      const directional = finding.evidence.channelAssetIds
        .map((assetId) => matchingImage(images, side, "directional_channel", assetId))
        .find((asset): asset is CinematicImage => Boolean(asset));
      const review = finding.review.status;
      return [{
        finding,
        statusLabel: review === "confirmed" || review === "adjusted" ? "Confirmed" : "AI candidate",
        trueView,
        ...(measurements.get(finding.findingId) ? { measurements: measurements.get(finding.findingId) } : {}),
        ...(heatmap ? { heatmap } : {}),
        ...(directional ? { directional } : {}),
      }];
    });
  const sideImages = (side: CinematicSide) => ({
    ...(matchingImage(images, side, "normalized_card") ? { trueView: matchingImage(images, side, "normalized_card") } : {}),
    ...(matchingImage(images, side, "surface_heatmap") ? { heatmap: matchingImage(images, side, "surface_heatmap") } : {}),
    ...(matchingImage(images, side, "surface_vision") ? { surfaceVision: matchingImage(images, side, "surface_vision") } : {}),
    ...(matchingImage(images, side, "confidence_mask") ? { confidenceMask: matchingImage(images, side, "confidence_mask") } : {}),
  });
  const generatedAt = text(value.generatedAt);
  const validGeneratedAt = generatedAt && Number.isFinite(Date.parse(generatedAt)) ? generatedAt : undefined;
  const grade = gradeData(value, minimumScore);
  return {
    ...(text(value.reportId) ? { reportId: text(value.reportId) } : {}),
    ...(text(cardIdentity.title) ? { title: text(cardIdentity.title) } : {}),
    ...(text(cardIdentity.set) ? { set: text(cardIdentity.set) } : {}),
    ...(text(cardIdentity.cardNumber) ? { cardNumber: text(cardIdentity.cardNumber) } : {}),
    ...(validGeneratedAt ? { generatedAt: validGeneratedAt } : {}),
    ...(grade ? { grade } : {}),
    notes: reportNotes(value),
    images: {
      ...(Object.keys(sideImages("front")).length ? { front: sideImages("front") } : {}),
      ...(Object.keys(sideImages("back")).length ? { back: sideImages("back") } : {}),
    },
    findings: { front: cinematicFindings("front"), back: cinematicFindings("back") },
    certifiedPresentation: false,
  };
}

/** Current adapters require every grade and element score to be within 1.00-10.00. */
export function toAiGraderCinematicReport(value: unknown): CinematicReport | null {
  return toAiGraderCinematicReportWithMinimumScore(value, 1);
}

/**
 * Explicit read-only compatibility for stored V0 reports whose historical
 * score contract allowed 0.00. Non-V0 payloads still use the current minimum.
 */
export function toAiGraderLegacyCinematicReportForRead(value: unknown): CinematicReport | null {
  const legacyV0 = isRecord(value) && (
    value.schemaVersion === undefined ||
    value.schemaVersion === "ai-grader-report-bundle-v0.1" ||
    value.schemaVersion === "ai-grader-report-bundle-v0.2"
  );
  return toAiGraderCinematicReportWithMinimumScore(value, legacyV0 ? 0 : 1);
}

export function cinematicEvidenceImage(
  mode: CinematicEvidenceMode,
  sideImages: CinematicReport["images"][CinematicSide] | undefined,
  selectedFinding: CinematicFinding | undefined,
) {
  if (mode === "trueView") return selectedFinding?.trueView ?? sideImages?.trueView;
  if (mode === "heatmap") return selectedFinding?.heatmap ?? sideImages?.heatmap;
  if (mode === "surfaceVision") return sideImages?.surfaceVision;
  return selectedFinding?.directional;
}

export function cinematicFindingsForExactImage(findings: CinematicFinding[], image: CinematicImage | undefined) {
  if (!image) return [];
  return findings.filter((entry) => entry.trueView.id.toLowerCase() === image.id.toLowerCase());
}

export function cinematicFindingLabel(finding: CinematicFinding) {
  return finding.finding.category.replace(/_/g, " ");
}

export function cinematicConfidenceText(value: number | undefined) {
  if (value === undefined || value < 0 || value > 1) return undefined;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(value * 100) + "%";
}

export function cinematicMeasurementRows(measurements: CinematicMeasurement | undefined) {
  if (!measurements) return [];
  return [
    ...(measurements.lengthMm !== undefined ? [["Length", `${measurements.lengthMm} mm`] as const] : []),
    ...(measurements.widthMm !== undefined ? [["Width", `${measurements.widthMm} mm`] as const] : []),
  ];
}
