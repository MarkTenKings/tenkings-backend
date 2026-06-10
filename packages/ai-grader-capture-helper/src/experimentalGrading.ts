import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import type { DinoLiteBridgeOperatorWorkflowResult } from "./drivers";

export const DINOLITE_GRADING_ALGORITHM_VERSION = "tenkings-dinolite-grading-v0.1";
export const DINOLITE_GRADING_THRESHOLD_SET_VERSION = "tenkings-dinolite-thresholds-v0.1";

export type AnalysisStatus = "computed" | "not_computed" | "failed";
export type TargetElement = "centering" | "corners" | "edges" | "surface" | "overall";

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface ElementAnalysis {
  element: TargetElement;
  status: AnalysisStatus;
  score?: number;
  displayScore?: string;
  scoreBand?: string;
  confidence: number;
  rawMetrics: Record<string, unknown>;
  evidenceArtifactIds: string[];
  evidencePaths: string[];
  limitations: string[];
  notComputedReason?: string;
  definition?: string;
  perfectScoreDefinition?: string;
  why?: {
    summary: string;
    topContributingMetrics: string[];
    topPenalties: string[];
    affectedTargetImages: string[];
    qualityWarnings: string[];
  };
  algorithmVersion: string;
  thresholdSetVersion: string;
}

export interface TargetQualityDiagnostics {
  artifactId: string;
  targetId: string;
  targetName: string;
  targetType: string;
  filename: string;
  cardCoverageEstimate: number;
  backgroundRisk: "low" | "medium" | "high";
  sharpness: number;
  blurRisk: "low" | "medium" | "high";
  brightnessMean: number;
  contrastRange: number;
  overexposureRisk: "low" | "medium" | "high";
  underexposureRisk: "low" | "medium" | "high";
  targetAlignmentConfidence: number;
  warnings: string[];
}

export interface ExperimentalGradingAnalysis {
  title: "Experimental AI Grader Test Run - Not Certified";
  status: "computed" | "partial" | "not_computed";
  label: string;
  sessionId: string;
  generatedAt: string;
  algorithmVersion: string;
  thresholdSetVersion: string;
  elements: {
    centering: ElementAnalysis;
    corners: ElementAnalysis;
    edges: ElementAnalysis;
    surface: ElementAnalysis;
    overall: ElementAnalysis;
  };
  scoreScale: {
    min: 1;
    max: 10;
    higherIsBetter: true;
    displayFormat: "x.xx / 10";
    bands: Array<{ range: string; label: string }>;
  };
  perfectScoreDefinitions: Record<TargetElement, string>;
  elementDefinitions: Record<Exclude<TargetElement, "overall">, string>;
  operatorOptions: {
    cornerProfile: "sharp_90";
    captureGuides: boolean;
  };
  qualityDiagnostics: TargetQualityDiagnostics[];
  warnings: string[];
  limitations: string[];
  captureManifestPath: string;
  analysisPath: string;
  previewReportPath: string;
}

interface TargetImage {
  targetId: string;
  targetName: string;
  targetType: string;
  reportLabel: string;
  artifactId: string;
  path: string;
  filename: string;
  sha256?: string | null;
  byteSize?: number;
  image: RgbaImage;
  quality?: TargetQualityDiagnostics;
}

export interface ExperimentalGradingAnalyzeOptions {
  cornerProfile?: "sharp_90";
  captureGuides?: boolean;
}

function baseResult(element: TargetElement, evidence: TargetImage[], limitations: string[]): ElementAnalysis {
  return {
    element,
    status: "not_computed",
    confidence: 0,
    rawMetrics: {},
    evidenceArtifactIds: evidence.map((item) => item.artifactId),
    evidencePaths: evidence.map((item) => item.path),
    limitations,
    algorithmVersion: DINOLITE_GRADING_ALGORITHM_VERSION,
    thresholdSetVersion: DINOLITE_GRADING_THRESHOLD_SET_VERSION,
  };
}

function clamp(value: number, min = 1, max = 10): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 4): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

const SCORE_BANDS = [
  { range: "9.0-10.0", label: "Excellent" },
  { range: "8.0-8.9", label: "Very Good" },
  { range: "7.0-7.9", label: "Good" },
  { range: "6.0-6.9", label: "Fair / Review" },
  { range: "below 6.0", label: "Needs Review" },
];

const ELEMENT_DEFINITIONS = {
  centering: "Centering measures balance of card borders and inner print area in the interim full-card overview.",
  corners: "Corners measure corner geometry, chipping/whitening, edge continuity, and sharpness in close-up corner targets.",
  edges: "Edges measure edge whitening/chipping/roughness and line defect signals in close-up edge targets.",
  surface: "Surface measures specks, scratches, texture anomalies, and print/surface defect signals in close-up surface targets.",
};

const PERFECT_SCORE_DEFINITIONS: Record<TargetElement, string> = {
  centering:
    "10/10 means left/right and top/bottom border balance are nearly equal under detected geometry, rectangle detection is strong, blur is low, and no major framing limitation is present.",
  corners:
    "10/10 means intact expected corner geometry for the selected sharp_90 profile, a clean 90-degree corner shape, no detected whitening/chipping/crushing/delamination, clean edge continuity, good focus, and minimal background interference.",
  edges:
    "10/10 means a clean continuous edge with no detected whitening/chipping/fraying/roughness, no strong scratch/line defect signal near the edge band, good focus, and minimal background interference.",
  surface:
    "10/10 means a clean print/surface patch with no detected scratches, specks, stains, dents, or anomaly clusters; normal print texture is not over-penalized, focus is good, and background interference is minimal.",
  overall:
    "10/10 means all required element scores are near 10, no severe defect caps apply, confidence is high, and capture quality is sufficient.",
};

function displayScore(score: number | undefined): string {
  return score == null ? "not_computed" : `${score.toFixed(2)} / 10`;
}

function scoreBand(score: number | undefined): string | undefined {
  if (score == null) return undefined;
  if (score >= 9) return "Excellent";
  if (score >= 8) return "Very Good";
  if (score >= 7) return "Good";
  if (score >= 6) return "Fair / Review";
  return "Needs Review";
}

export function scoreFromRatio(ratioPercent: number): number {
  if (ratioPercent >= 95) return 10;
  if (ratioPercent >= 90) return 9 + (ratioPercent - 90) / 5;
  if (ratioPercent >= 85) return 8 + (ratioPercent - 85) / 5;
  if (ratioPercent >= 80) return 7 + (ratioPercent - 80) / 5;
  if (ratioPercent >= 75) return 6 + (ratioPercent - 75) / 5;
  if (ratioPercent >= 70) return 5 + (ratioPercent - 70) / 5;
  return Math.max(1, (ratioPercent / 70) * 5);
}

function pixelOffset(image: RgbaImage, x: number, y: number): number {
  return (y * image.width + x) * 4;
}

function rgbAt(image: RgbaImage, x: number, y: number) {
  const offset = pixelOffset(image, x, y);
  return {
    r: image.data[offset],
    g: image.data[offset + 1],
    b: image.data[offset + 2],
  };
}

function grayAt(image: RgbaImage, x: number, y: number): number {
  const { r, g, b } = rgbAt(image, x, y);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function saturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

function imageMeanGray(image: RgbaImage, rect = { x: 0, y: 0, w: image.width, h: image.height }): number {
  let sum = 0;
  let count = 0;
  for (let y = rect.y; y < rect.y + rect.h; y += 1) {
    for (let x = rect.x; x < rect.x + rect.w; x += 1) {
      sum += grayAt(image, x, y);
      count += 1;
    }
  }
  return count ? sum / count : 0;
}

function boundingBoxFromPredicate(image: RgbaImage, predicate: (gray: number, x: number, y: number) => boolean) {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  let count = 0;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const gray = grayAt(image, x, y);
      if (!predicate(gray, x, y)) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      count += 1;
    }
  }
  if (maxX < minX || maxY < minY) return undefined;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, count };
}

function varianceOfLaplacian(image: RgbaImage, rect = { x: 0, y: 0, w: image.width, h: image.height }): number {
  const values: number[] = [];
  const x0 = Math.max(1, rect.x);
  const y0 = Math.max(1, rect.y);
  const x1 = Math.min(image.width - 1, rect.x + rect.w - 1);
  const y1 = Math.min(image.height - 1, rect.y + rect.h - 1);
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const center = grayAt(image, x, y) * 4;
      values.push(center - grayAt(image, x - 1, y) - grayAt(image, x + 1, y) - grayAt(image, x, y - 1) - grayAt(image, x, y + 1));
    }
  }
  if (!values.length) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
}

function gradientDensity(image: RgbaImage, rect: { x: number; y: number; w: number; h: number }, threshold: number): number {
  let hits = 0;
  let count = 0;
  const x0 = Math.max(1, rect.x);
  const y0 = Math.max(1, rect.y);
  const x1 = Math.min(image.width - 1, rect.x + rect.w - 1);
  const y1 = Math.min(image.height - 1, rect.y + rect.h - 1);
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const gx = Math.abs(grayAt(image, x + 1, y) - grayAt(image, x - 1, y));
      const gy = Math.abs(grayAt(image, x, y + 1) - grayAt(image, x, y - 1));
      if (gx + gy > threshold) hits += 1;
      count += 1;
    }
  }
  return count ? hits / count : 0;
}

function zoneForTarget(image: RgbaImage, targetId: string, kind: "corner" | "edge" | "surface") {
  if (kind === "surface") {
    const marginX = Math.floor(image.width * 0.12);
    const marginY = Math.floor(image.height * 0.12);
    return { x: marginX, y: marginY, w: image.width - marginX * 2, h: image.height - marginY * 2 };
  }
  if (kind === "edge") {
    const band = Math.max(4, Math.floor((targetId.includes("left") || targetId.includes("right") ? image.width : image.height) * 0.18));
    if (targetId.includes("top")) return { x: 0, y: 0, w: image.width, h: band };
    if (targetId.includes("bottom")) return { x: 0, y: image.height - band, w: image.width, h: band };
    if (targetId.includes("left")) return { x: 0, y: 0, w: band, h: image.height };
    return { x: image.width - band, y: 0, w: band, h: image.height };
  }
  const w = Math.max(4, Math.floor(image.width * 0.35));
  const h = Math.max(4, Math.floor(image.height * 0.35));
  const x = targetId.includes("right") ? image.width - w : 0;
  const y = targetId.includes("bottom") ? image.height - h : 0;
  return { x, y, w, h };
}

function densityMetrics(image: RgbaImage, rect: { x: number; y: number; w: number; h: number }) {
  const localMean = imageMeanGray(image, rect);
  let bright = 0;
  let dark = 0;
  let count = 0;
  for (let y = rect.y; y < rect.y + rect.h; y += 1) {
    for (let x = rect.x; x < rect.x + rect.w; x += 1) {
      const { r, g, b } = rgbAt(image, x, y);
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      const sat = saturation(r, g, b);
      if (gray > Math.max(220, localMean + 45) && sat < 0.28) bright += 1;
      if (gray < Math.min(55, localMean - 45)) dark += 1;
      count += 1;
    }
  }
  return {
    brightDensity: count ? bright / count : 0,
    darkDensity: count ? dark / count : 0,
    localMean,
  };
}

function grayStats(image: RgbaImage) {
  let min = 255;
  let max = 0;
  let sum = 0;
  let over = 0;
  let under = 0;
  const count = image.width * image.height;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const gray = grayAt(image, x, y);
      min = Math.min(min, gray);
      max = Math.max(max, gray);
      sum += gray;
      if (gray > 245) over += 1;
      if (gray < 15) under += 1;
    }
  }
  return {
    min,
    max,
    mean: count ? sum / count : 0,
    overexposedFraction: count ? over / count : 0,
    underexposedFraction: count ? under / count : 0,
  };
}

function estimateCardCoverage(image: RgbaImage): number {
  const background = (grayAt(image, 0, 0) + grayAt(image, image.width - 1, 0) + grayAt(image, 0, image.height - 1) + grayAt(image, image.width - 1, image.height - 1)) / 4;
  const box = boundingBoxFromPredicate(image, (gray) => Math.abs(gray - background) > 18);
  if (!box) return 0;
  return (box.w * box.h) / (image.width * image.height);
}

function riskFrom(value: number, medium: number, high: number, inverse = false): "low" | "medium" | "high" {
  if (inverse) {
    if (value <= high) return "high";
    if (value <= medium) return "medium";
    return "low";
  }
  if (value >= high) return "high";
  if (value >= medium) return "medium";
  return "low";
}

function buildQualityDiagnostics(input: TargetImage): TargetQualityDiagnostics {
  const stats = grayStats(input.image);
  const sharpness = varianceOfLaplacian(input.image);
  const cardCoverageEstimate = round(estimateCardCoverage(input.image), 4);
  const blurRisk = riskFrom(sharpness, 180, 70, true);
  const overexposureRisk = riskFrom(stats.overexposedFraction, 0.01, 0.05);
  const underexposureRisk = riskFrom(stats.underexposedFraction, 0.01, 0.05);
  const expectedCoverage = input.targetType === "surface" ? 0.85 : input.targetType === "interim_macro_overview" ? 0.2 : 0.55;
  const backgroundRisk = cardCoverageEstimate < expectedCoverage ? (cardCoverageEstimate < expectedCoverage * 0.65 ? "high" : "medium") : "low";
  const contrastRange = stats.max - stats.min;
  const warnings: string[] = [];
  if (backgroundRisk !== "low") warnings.push(backgroundRisk === "high" ? "Possible background interference" : "Low card coverage");
  if (cardCoverageEstimate < expectedCoverage) warnings.push("Target may not be centered");
  if (blurRisk !== "low") warnings.push("Image may be blurry");
  if (contrastRange < 35) warnings.push("Lighting may be uneven");
  if (overexposureRisk !== "low") warnings.push("Overexposure risk");
  if (underexposureRisk !== "low") warnings.push("Underexposure risk");
  if (warnings.length) warnings.push("Score confidence reduced");
  return {
    artifactId: input.artifactId,
    targetId: input.targetId,
    targetName: input.targetName,
    targetType: input.targetType,
    filename: input.filename,
    cardCoverageEstimate,
    backgroundRisk,
    sharpness: round(sharpness, 3),
    blurRisk,
    brightnessMean: round(stats.mean, 3),
    contrastRange: round(contrastRange, 3),
    overexposureRisk,
    underexposureRisk,
    targetAlignmentConfidence: round(Math.max(0.1, Math.min(0.95, 1 - Math.max(0, expectedCoverage - cardCoverageEstimate))), 3),
    warnings,
  };
}

export function analyzeCenteringImage(image: RgbaImage, evidence: TargetImage[] = []): ElementAnalysis {
  const limitations = [
    "Dino-Lite overview is interim and not calibrated macro capture; centering is experimental and unvalidated.",
  ];
  const result = baseResult("centering", evidence, limitations);
  const background = (grayAt(image, 0, 0) + grayAt(image, image.width - 1, 0) + grayAt(image, 0, image.height - 1) + grayAt(image, image.width - 1, image.height - 1)) / 4;
  const outer = boundingBoxFromPredicate(image, (gray) => Math.abs(gray - background) > 18);
  if (!outer || (outer.w * outer.h) / (image.width * image.height) < 0.2) {
    return { ...result, notComputedReason: "CARD_OUTER_RECT_NOT_DETECTED" };
  }
  const outerMean = imageMeanGray(image, outer);
  const inner = boundingBoxFromPredicate(image, (gray, x, y) => {
    const inset = Math.max(3, Math.floor(Math.min(outer.w, outer.h) * 0.04));
    return x > outer.x + inset && x < outer.x + outer.w - inset && y > outer.y + inset && y < outer.y + outer.h - inset && gray < outerMean - 22;
  });
  if (!inner || inner.x <= outer.x || inner.y <= outer.y || inner.x + inner.w >= outer.x + outer.w || inner.y + inner.h >= outer.y + outer.h) {
    return { ...result, rawMetrics: { outer }, notComputedReason: "INNER_PRINT_RECT_NOT_DETECTED" };
  }
  const leftBorder = inner.x - outer.x;
  const rightBorder = outer.x + outer.w - (inner.x + inner.w);
  const topBorder = inner.y - outer.y;
  const bottomBorder = outer.y + outer.h - (inner.y + inner.h);
  if (Math.min(leftBorder, rightBorder, topBorder, bottomBorder) <= 0) {
    return { ...result, rawMetrics: { outer, inner }, notComputedReason: "INVALID_BORDER_MEASUREMENT" };
  }
  const horizontalRatioPercent = (Math.min(leftBorder, rightBorder) / Math.max(leftBorder, rightBorder)) * 100;
  const verticalRatioPercent = (Math.min(topBorder, bottomBorder) / Math.max(topBorder, bottomBorder)) * 100;
  const horizontalScore = scoreFromRatio(horizontalRatioPercent);
  const verticalScore = scoreFromRatio(verticalRatioPercent);
  const blur = varianceOfLaplacian(image, outer);
  const borderConsistency = Math.min(horizontalRatioPercent, verticalRatioPercent) / 100;
  return {
    ...result,
    status: "computed",
    score: round(clamp(Math.min(horizontalScore, verticalScore)), 2),
    confidence: round(clamp((0.35 + borderConsistency * 0.45 + Math.min(blur / 1200, 0.2)) * 10, 1, 10) / 10, 3),
    rawMetrics: {
      outerRect: outer,
      innerRect: inner,
      leftBorder,
      rightBorder,
      topBorder,
      bottomBorder,
      horizontalRatioPercent: round(horizontalRatioPercent, 3),
      verticalRatioPercent: round(verticalRatioPercent, 3),
      horizontalScore: round(horizontalScore, 3),
      verticalScore: round(verticalScore, 3),
      sharpness: round(blur, 3),
    },
  };
}

function analyzeCornerImage(input: TargetImage) {
  const zone = zoneForTarget(input.image, input.targetId, "corner");
  const densities = densityMetrics(input.image, zone);
  const edgeRoughness = gradientDensity(input.image, zone, 75);
  const sharpness = varianceOfLaplacian(input.image, zone);
  const blurPenalty = Math.min(0.35, Math.max(0, 1 - Math.min(sharpness / 900, 1)));
  const defectIndex = densities.brightDensity * 45 + densities.darkDensity * 25 + edgeRoughness * 20 + blurPenalty * 10;
  return {
    targetId: input.targetId,
    score: round(clamp(10 - defectIndex), 2),
    metrics: { ...densities, edgeRoughness: round(edgeRoughness, 5), sharpness: round(sharpness, 3), blurPenalty: round(blurPenalty, 4), defectIndex: round(defectIndex, 4) },
  };
}

export function analyzeCornerImageForTests(image: RgbaImage, targetId = "top-left-corner") {
  return analyzeCornerImage({
    targetId,
    targetName: targetId,
    targetType: "corner",
    reportLabel: targetId,
    artifactId: targetId,
    path: targetId,
    filename: `${targetId}.jpg`,
    image,
  });
}

function analyzeEdgeImage(input: TargetImage) {
  const zone = zoneForTarget(input.image, input.targetId, "edge");
  const densities = densityMetrics(input.image, zone);
  const scratchLineDensity = gradientDensity(input.image, zone, 95);
  const roughness = gradientDensity(input.image, zone, 45);
  const sharpness = varianceOfLaplacian(input.image, zone);
  const blurPenalty = Math.min(0.35, Math.max(0, 1 - Math.min(sharpness / 900, 1)));
  const defectIndex = densities.brightDensity * 40 + densities.darkDensity * 20 + scratchLineDensity * 25 + roughness * 15 + blurPenalty * 10;
  return {
    targetId: input.targetId,
    score: round(clamp(10 - defectIndex), 2),
    metrics: { whiteningDensity: densities.brightDensity, darkDefectDensity: densities.darkDensity, scratchLineDensity: round(scratchLineDensity, 5), roughness: round(roughness, 5), sharpness: round(sharpness, 3), blurPenalty: round(blurPenalty, 4), defectIndex: round(defectIndex, 4) },
  };
}

export function analyzeEdgeImageForTests(image: RgbaImage, targetId = "top-edge") {
  return analyzeEdgeImage({
    targetId,
    targetName: targetId,
    targetType: "edge",
    reportLabel: targetId,
    artifactId: targetId,
    path: targetId,
    filename: `${targetId}.jpg`,
    image,
  });
}

function analyzeSurfaceImage(input: TargetImage) {
  const zone = zoneForTarget(input.image, input.targetId, "surface");
  const densities = densityMetrics(input.image, zone);
  const scratchLineDensity = gradientDensity(input.image, zone, 95);
  const highGradientOutlierDensity = gradientDensity(input.image, zone, 120);
  const textureAnomalyDensity = gradientDensity(input.image, zone, 55);
  const sharpness = varianceOfLaplacian(input.image, zone);
  const blurPenalty = Math.min(0.35, Math.max(0, 1 - Math.min(sharpness / 900, 1)));
  const defectIndex = densities.brightDensity * 25 + densities.darkDensity * 25 + scratchLineDensity * 35 + textureAnomalyDensity * 20 + blurPenalty * 10;
  return {
    targetId: input.targetId,
    score: round(clamp(10 - defectIndex), 2),
    metrics: { brightSpeckDensity: densities.brightDensity, darkSpeckDensity: densities.darkDensity, scratchLineDensity: round(scratchLineDensity, 5), highGradientOutlierDensity: round(highGradientOutlierDensity, 5), textureAnomalyDensity: round(textureAnomalyDensity, 5), sharpness: round(sharpness, 3), blurPenalty: round(blurPenalty, 4), defectIndex: round(defectIndex, 4) },
  };
}

export function analyzeSurfaceImageForTests(image: RgbaImage, targetId = "center-surface") {
  return analyzeSurfaceImage({
    targetId,
    targetName: targetId,
    targetType: "surface",
    reportLabel: targetId,
    artifactId: targetId,
    path: targetId,
    filename: `${targetId}.jpg`,
    image,
  });
}

function aggregateElement(element: "corners" | "edges" | "surface", evidence: TargetImage[], minimum: number): ElementAnalysis {
  const result = baseResult(element, evidence, ["Experimental Dino-Lite close-up analysis is unvalidated until calibrated rig acceptance passes."]);
  if (evidence.length < minimum) {
    return { ...result, notComputedReason: `${element.toUpperCase()}_INSUFFICIENT_INPUTS` };
  }
  const perImage =
    element === "corners"
      ? evidence.map(analyzeCornerImage)
      : element === "edges"
        ? evidence.map(analyzeEdgeImage)
        : evidence.map(analyzeSurfaceImage);
  let score = 0;
  const scores = perImage.map((item) => item.score);
  const minScore = Math.min(...scores);
  const avgScore = scores.reduce((sum, value) => sum + value, 0) / scores.length;
  if (element === "corners") score = minScore * 0.55 + avgScore * 0.45;
  if (element === "edges") score = minScore * 0.5 + avgScore * 0.5;
  if (element === "surface") score = minScore * 0.4 + avgScore * 0.6;
  if (element === "corners" && minScore <= 5) score = Math.min(score, 6);
  const meanConfidence = Math.max(0.25, Math.min(0.82, 0.45 + Math.min(evidence.length / 8, 0.25) + avgScore / 100));
  return {
    ...result,
    status: "computed",
    score: round(clamp(score), 2),
    confidence: round(meanConfidence, 3),
    rawMetrics: { perImage, minScore: round(minScore, 3), averageScore: round(avgScore, 3) },
  };
}

export function fuseExperimentalScores(elements: {
  centering: ElementAnalysis;
  corners: ElementAnalysis;
  edges: ElementAnalysis;
  surface: ElementAnalysis;
}): ElementAnalysis {
  const evidence = [
    ...elements.centering.evidencePaths,
    ...elements.corners.evidencePaths,
    ...elements.edges.evidencePaths,
    ...elements.surface.evidencePaths,
  ];
  const result = baseResult("overall", [], ["Overall score is experimental, unvalidated, and not certifiable."]);
  const requiredMissing = [];
  if (elements.corners.status !== "computed") requiredMissing.push("corners");
  if (elements.surface.status !== "computed") requiredMissing.push("surface");
  if (elements.centering.status !== "computed" && elements.edges.status !== "computed") requiredMissing.push("centering_or_edges");
  if (requiredMissing.length) {
    return { ...result, evidencePaths: evidence, notComputedReason: `FUSION_MISSING_REQUIRED_ELEMENTS:${requiredMissing.join(",")}` };
  }
  const available = {
    centering: elements.centering.status === "computed" ? elements.centering.score! : undefined,
    corners: elements.corners.score!,
    edges: elements.edges.status === "computed" ? elements.edges.score! : undefined,
    surface: elements.surface.score!,
  };
  const baseWeights = { centering: 0.25, corners: 0.3, edges: 0.2, surface: 0.25 };
  let activeWeight = baseWeights.corners + baseWeights.surface;
  if (available.centering != null) activeWeight += baseWeights.centering;
  if (available.edges != null) activeWeight += baseWeights.edges;
  let overall =
    (available.corners * baseWeights.corners + available.surface * baseWeights.surface + (available.centering ?? 0) * baseWeights.centering + (available.edges ?? 0) * baseWeights.edges) /
    activeWeight;
  const computedElements = [available.centering, available.corners, available.edges, available.surface].filter((value): value is number => value != null);
  if (computedElements.some((value) => value <= 5)) overall = Math.min(overall, 6);
  else if (computedElements.some((value) => value <= 6)) overall = Math.min(overall, 7);
  const missingPenalty = (available.centering == null ? 0.12 : 0) + (available.edges == null ? 0.1 : 0);
  const confidence = Math.max(0.15, Math.min(0.72, Math.min(elements.corners.confidence, elements.surface.confidence, elements.centering.confidence || 1, elements.edges.confidence || 1) - missingPenalty));
  return {
    ...result,
    status: "computed",
    score: round(clamp(overall), 2),
    confidence: round(confidence, 3),
    evidencePaths: evidence,
    rawMetrics: { availableScores: available, weights: baseWeights, activeWeight: round(activeWeight, 3), severeDefectCapsApplied: computedElements.some((value) => value <= 6) },
  };
}

async function loadImage(filePath: string): Promise<RgbaImage> {
  const { data, info } = await sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength) };
}

function normalArtifacts(workflow: DinoLiteBridgeOperatorWorkflowResult) {
  return workflow.targets.flatMap((target) =>
    target.artifacts
      .filter((artifact) => artifact.status === "success" && artifact.captureKind === "normal" && artifact.mimeType === "image/jpeg")
      .map((artifact) => ({ target, artifact }))
  );
}

async function buildTargetImages(workflow: DinoLiteBridgeOperatorWorkflowResult): Promise<TargetImage[]> {
  const images: TargetImage[] = [];
  for (const { target, artifact } of normalArtifacts(workflow)) {
    const image = await loadImage(artifact.path);
    const record: TargetImage = {
      targetId: target.target.id,
      targetName: target.target.name,
      targetType: target.target.type,
      reportLabel: target.target.reportLabel,
      artifactId: `${target.target.id}:${artifact.filename}`,
      path: artifact.path,
      filename: artifact.filename,
      sha256: artifact.sha256,
      byteSize: artifact.byteSize,
      image,
    };
    record.quality = buildQualityDiagnostics(record);
    images.push(record);
  }
  return images;
}

function relatedImages(element: TargetElement, images: TargetImage[]): TargetImage[] {
  if (element === "centering") return images.filter((image) => image.targetType === "interim_macro_overview");
  if (element === "corners") return images.filter((image) => image.targetType === "corner");
  if (element === "edges") return images.filter((image) => image.targetType === "edge");
  if (element === "surface") return images.filter((image) => image.targetType === "surface");
  return images;
}

function metricRows(rawMetrics: Record<string, unknown>): string[] {
  const rows: string[] = [];
  for (const [key, value] of Object.entries(rawMetrics)) {
    if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
      rows.push(`${key}: ${value}`);
    }
  }
  const perImage = rawMetrics.perImage;
  if (Array.isArray(perImage)) {
    for (const item of perImage.slice().sort((a, b) => Number(b.metrics?.defectIndex ?? 0) - Number(a.metrics?.defectIndex ?? 0)).slice(0, 3)) {
      rows.push(`${item.targetId}: defectIndex ${item.metrics?.defectIndex ?? "unavailable"}, score ${item.score ?? "unavailable"}`);
    }
  }
  const availableScores = rawMetrics.availableScores;
  if (availableScores && typeof availableScores === "object") {
    for (const [key, value] of Object.entries(availableScores as Record<string, unknown>)) {
      if (value != null) rows.push(`${key}: ${value}`);
    }
  }
  return rows.length ? rows : ["Metric details unavailable."];
}

function penaltyRows(element: ElementAnalysis): string[] {
  const rows: string[] = [];
  const perImage = element.rawMetrics.perImage;
  if (Array.isArray(perImage)) {
    for (const item of perImage.slice().sort((a, b) => Number(b.metrics?.defectIndex ?? 0) - Number(a.metrics?.defectIndex ?? 0)).slice(0, 3)) {
      rows.push(`${item.targetId}: strongest penalty signal defectIndex=${item.metrics?.defectIndex ?? "unavailable"}, blurPenalty=${item.metrics?.blurPenalty ?? "unavailable"}`);
    }
  }
  if (element.element === "centering") {
    rows.push(`horizontal ratio ${element.rawMetrics.horizontalRatioPercent ?? "unavailable"}%, vertical ratio ${element.rawMetrics.verticalRatioPercent ?? "unavailable"}%`);
  }
  if (element.element === "overall") {
    rows.push(element.rawMetrics.severeDefectCapsApplied ? "Severe defect cap applied because at least one computed element was 6.0 or below." : "No severe defect cap applied.");
  }
  return rows.length ? rows : ["No dominant penalty metric available."];
}

function enrichElement(element: ElementAnalysis, images: TargetImage[]): ElementAnalysis {
  const affected = relatedImages(element.element, images);
  const qualityWarnings = Array.from(new Set(affected.flatMap((image) => image.quality?.warnings ?? [])));
  const computedText = element.status === "computed" ? `${element.element} scored ${displayScore(element.score)} (${scoreBand(element.score)}).` : `${element.element} was ${element.status}: ${element.notComputedReason ?? "reason unavailable"}.`;
  return {
    ...element,
    displayScore: displayScore(element.score),
    scoreBand: scoreBand(element.score),
    definition: element.element === "overall" ? "Overall combines computed element scores using the v0.1 fusion weights and severe defect caps." : ELEMENT_DEFINITIONS[element.element],
    perfectScoreDefinition: PERFECT_SCORE_DEFINITIONS[element.element],
    why: {
      summary: computedText,
      topContributingMetrics: metricRows(element.rawMetrics),
      topPenalties: penaltyRows(element),
      affectedTargetImages: affected.map((image) => image.filename),
      qualityWarnings: qualityWarnings.length ? qualityWarnings : ["No target-level quality warnings recorded."],
    },
  };
}

function enrichElements(elements: {
  centering: ElementAnalysis;
  corners: ElementAnalysis;
  edges: ElementAnalysis;
  surface: ElementAnalysis;
  overall: ElementAnalysis;
}, images: TargetImage[]) {
  return {
    centering: enrichElement(elements.centering, images),
    corners: enrichElement(elements.corners, images),
    edges: enrichElement(elements.edges, images),
    surface: enrichElement(elements.surface, images),
    overall: enrichElement(elements.overall, images),
  };
}

export async function analyzeDinoLiteExperimentalGradingWorkflow(
  workflow: DinoLiteBridgeOperatorWorkflowResult,
  options: ExperimentalGradingAnalyzeOptions = {}
): Promise<ExperimentalGradingAnalysis> {
  const targetImages = await buildTargetImages(workflow);
  const overview = targetImages.find((item) => item.targetId === "full-card-overview");
  const corners = targetImages.filter((item) => item.targetType === "corner");
  const edges = targetImages.filter((item) => item.targetType === "edge");
  const surfaces = targetImages.filter((item) => item.targetType === "surface");
  const centering = overview ? analyzeCenteringImage(overview.image, [overview]) : { ...baseResult("centering", [], ["Dino-Lite overview is interim and not calibrated macro capture."]), notComputedReason: "FULL_CARD_OVERVIEW_MISSING" };
  const cornerResult = aggregateElement("corners", corners, corners.length >= 3 ? 3 : 4);
  const edgeResult = aggregateElement("edges", edges, 1);
  const surfaceResult = aggregateElement("surface", surfaces, 1);
  const overall = fuseExperimentalScores({ centering, corners: cornerResult, edges: edgeResult, surface: surfaceResult });
  const qualityDiagnostics = targetImages.flatMap((image) => (image.quality ? [image.quality] : []));
  const enrichedElements = enrichElements({ centering, corners: cornerResult, edges: edgeResult, surface: surfaceResult, overall }, targetImages);
  const analysisPath = path.join(workflow.sessionDir, "analysis.json");
  const analysis: ExperimentalGradingAnalysis = {
    title: "Experimental AI Grader Test Run - Not Certified",
    status: overall.status === "computed" ? "computed" : targetImages.length ? "partial" : "not_computed",
    label: workflow.label,
    sessionId: workflow.sessionId,
    generatedAt: new Date().toISOString(),
    algorithmVersion: DINOLITE_GRADING_ALGORITHM_VERSION,
    thresholdSetVersion: DINOLITE_GRADING_THRESHOLD_SET_VERSION,
    elements: enrichedElements,
    scoreScale: {
      min: 1,
      max: 10,
      higherIsBetter: true,
      displayFormat: "x.xx / 10",
      bands: SCORE_BANDS,
    },
    perfectScoreDefinitions: PERFECT_SCORE_DEFINITIONS,
    elementDefinitions: ELEMENT_DEFINITIONS,
    operatorOptions: {
      cornerProfile: options.cornerProfile ?? "sharp_90",
      captureGuides: options.captureGuides ?? true,
    },
    qualityDiagnostics,
    warnings: [
      "Experimental/unvalidated deterministic pixel analysis only.",
      "Not a certified grade, final AI grade, certificate, or calibrated production macro result.",
      ...(qualityDiagnostics.some((item) => item.warnings.length) ? ["One or more captures produced quality warnings; review target diagnostics before interpreting scores."] : []),
    ],
    limitations: [
      "Dino-Lite overview is interim and not calibrated production macro evidence.",
      "Manual positioning/refocus and uncalibrated lighting can affect measurements.",
      "If a metric cannot be computed, it is reported as not_computed instead of using a placeholder score.",
    ],
    captureManifestPath: workflow.manifestPath,
    analysisPath,
    previewReportPath: workflow.previewReportPath,
  };
  fs.writeFileSync(analysisPath, `${JSON.stringify(analysis, null, 2)}\n`);
  writeExperimentalReport(workflow, analysis, targetImages);
  return analysis;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function relativeReportPath(reportPath: string, artifactPath: string): string {
  return path.relative(path.dirname(reportPath), artifactPath).replace(/\\/g, "/");
}

function writeExperimentalReport(
  workflow: DinoLiteBridgeOperatorWorkflowResult,
  analysis: ExperimentalGradingAnalysis,
  images: TargetImage[]
): void {
  const rows = Object.values(analysis.elements)
    .map(
      (element) =>
        `<tr><td>${escapeHtml(element.element)}</td><td>${escapeHtml(element.status)}</td><td>${escapeHtml(element.displayScore ?? displayScore(element.score))}</td><td>${escapeHtml(element.scoreBand ?? "")}</td><td>${escapeHtml(element.confidence)}</td><td>${escapeHtml(element.notComputedReason ?? "")}</td></tr>`
    )
    .join("\n");
  const whySections = Object.values(analysis.elements)
    .map(
      (element) =>
        `<section class="panel"><h3>Why this score? ${escapeHtml(element.element)}</h3><p>${escapeHtml(element.why?.summary ?? "")}</p><p><strong>Definition:</strong> ${escapeHtml(element.definition ?? "")}</p><p><strong>Perfect 10/10:</strong> ${escapeHtml(element.perfectScoreDefinition ?? "")}</p><h4>Top contributing metrics</h4><ul>${(element.why?.topContributingMetrics ?? ["unavailable"]).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul><h4>Top penalties</h4><ul>${(element.why?.topPenalties ?? ["unavailable"]).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul><h4>Quality warnings</h4><ul>${(element.why?.qualityWarnings ?? ["unavailable"]).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul><p class="meta">Affected images: ${escapeHtml((element.why?.affectedTargetImages ?? []).join(", ") || "none")}</p></section>`
    )
    .join("\n");
  const qualityRows = analysis.qualityDiagnostics
    .map(
      (item) =>
        `<tr><td>${escapeHtml(item.targetName)}</td><td>${escapeHtml(item.filename)}</td><td>${escapeHtml(item.cardCoverageEstimate)}</td><td>${escapeHtml(item.backgroundRisk)}</td><td>${escapeHtml(item.sharpness)}</td><td>${escapeHtml(item.blurRisk)}</td><td>${escapeHtml(item.brightnessMean)}</td><td>${escapeHtml(item.contrastRange)}</td><td>${escapeHtml(item.targetAlignmentConfidence)}</td><td>${escapeHtml(item.warnings.join("; ") || "none")}</td></tr>`
    )
    .join("\n");
  const perfectDefinitions = Object.entries(analysis.perfectScoreDefinitions)
    .map(([element, definition]) => `<li><strong>${escapeHtml(element)} 10/10:</strong> ${escapeHtml(definition)}</li>`)
    .join("");
  const elementDefinitions = Object.entries(analysis.elementDefinitions)
    .map(([element, definition]) => `<li><strong>${escapeHtml(element)}:</strong> ${escapeHtml(definition)}</li>`)
    .join("");
  const scoreBands = analysis.scoreScale.bands
    .map((band) => `<li>${escapeHtml(band.range)} ${escapeHtml(band.label)}</li>`)
    .join("");
  const imageCards = images
    .map(
      (image) =>
        `<section class="card"><h3>${escapeHtml(image.targetName)}</h3><img src="${escapeHtml(relativeReportPath(workflow.previewReportPath, image.path))}" alt="${escapeHtml(image.targetName)} capture"><p>${escapeHtml(image.targetType)} / ${escapeHtml(image.reportLabel)}</p><p class="meta">${escapeHtml(image.filename)}<br>${escapeHtml(image.sha256 ?? "")}<br>${escapeHtml(image.byteSize ?? "")} bytes</p>${image.quality ? `<p class="meta">coverage estimate: ${escapeHtml(image.quality.cardCoverageEstimate)}<br>blur risk: ${escapeHtml(image.quality.blurRisk)}<br>warnings: ${escapeHtml(image.quality.warnings.join("; ") || "none")}</p>` : ""}</section>`
    )
    .join("\n");
  fs.writeFileSync(
    workflow.previewReportPath,
    `<!doctype html><html><head><meta charset="utf-8"><title>Experimental AI Grader Test Run - Not Certified</title><style>body{font-family:Segoe UI,Arial,sans-serif;margin:24px;color:#172033;line-height:1.45}h1{font-size:26px}.warn{font-weight:700;color:#8a3200}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}.card,.panel{border:1px solid #cbd5e1;border-radius:6px;padding:12px;margin:12px 0;background:#fff}img{max-width:100%;height:auto;border:1px solid #e2e8f0}table{border-collapse:collapse;width:100%;margin:16px 0}td,th{border:1px solid #cbd5e1;padding:8px;text-align:left;vertical-align:top}.meta{font-size:12px;word-break:break-all;color:#475569}.small{font-size:13px;color:#334155}</style></head><body><h1>Experimental AI Grader Test Run - Not Certified</h1><p class="warn">This is not a certified grade, not a certificate, not calibrated production macro evidence, and not a final AI grade.</p><p>Algorithm: ${escapeHtml(analysis.algorithmVersion)}<br>Thresholds: ${escapeHtml(analysis.thresholdSetVersion)}<br>Corner profile: ${escapeHtml(analysis.operatorOptions.cornerProfile)}<br>Capture guides: ${escapeHtml(analysis.operatorOptions.captureGuides ? "enabled" : "disabled")}</p><section class="panel"><h2>Score Scale</h2><p>All computed element scores use a 1.0 to 10.0 scale. 10.0 is the best / cleanest detected condition, 1.0 is the worst / highest detected defect signal, and higher is better. Scores are displayed as x.xx / 10.</p><ul>${scoreBands}</ul></section><section class="panel"><h2>Element Definitions</h2><ul>${elementDefinitions}</ul></section><section class="panel"><h2>Perfect 10/10 Definitions</h2><ul>${perfectDefinitions}</ul></section><section class="panel"><h2>Weighting and Formula</h2><p class="small">The v0.1 fusion uses centering 25%, corners 30%, edges 20%, and surface 25% when all are computed. Corners and surface are required, plus at least centering or edges. If centering or edges is missing, its weight is redistributed across the computed required elements and confidence is lowered. Severe defect caps remain unchanged: if any computed element is 5.0 or below, overall cannot exceed 6.0; if any computed element is 6.0 or below, overall cannot exceed 7.0.</p></section><h2>Scores</h2><table><thead><tr><th>Element</th><th>Status</th><th>Score</th><th>Band</th><th>Confidence</th><th>Reason</th></tr></thead><tbody>${rows}</tbody></table><h2>Why This Score?</h2>${whySections}<h2>Quality Warning Summary</h2><table><thead><tr><th>Target</th><th>File</th><th>Card coverage estimate</th><th>Background risk</th><th>Sharpness</th><th>Blur risk</th><th>Brightness mean</th><th>Contrast range</th><th>Alignment confidence</th><th>Warnings</th></tr></thead><tbody>${qualityRows}</tbody></table><h2>Captured Evidence</h2><div class="grid">${imageCards}</div><h2>Limitations</h2><ul>${analysis.limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul><h2>Manifest and Checksums</h2><p class="meta">${escapeHtml(workflow.manifestPath)}<br>${escapeHtml(analysis.analysisPath)}</p></body></html>`
  );
}

export function createSyntheticImage(width: number, height: number, fill: { r: number; g: number; b: number }): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = fill.r;
    data[index * 4 + 1] = fill.g;
    data[index * 4 + 2] = fill.b;
    data[index * 4 + 3] = 255;
  }
  return { width, height, data };
}

export function fillRect(image: RgbaImage, rect: { x: number; y: number; w: number; h: number }, color: { r: number; g: number; b: number }): void {
  for (let y = Math.max(0, rect.y); y < Math.min(image.height, rect.y + rect.h); y += 1) {
    for (let x = Math.max(0, rect.x); x < Math.min(image.width, rect.x + rect.w); x += 1) {
      const offset = pixelOffset(image, x, y);
      image.data[offset] = color.r;
      image.data[offset + 1] = color.g;
      image.data[offset + 2] = color.b;
      image.data[offset + 3] = 255;
    }
  }
}

export function sha256File(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}
