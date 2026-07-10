import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type {
  FixedRigCardSide,
  FixedRigDisplayArtifact,
  FixedRigDisplayTransform,
  FixedRigQualityMetrics,
  FixedRigRoiDefinition,
  FixedRigSurfaceAnalysis,
  FixedRigSurfaceAnomalyCandidate,
} from "./baslerFixedRigV1";

export const PRELIMINARY_SURFACE_INTELLIGENCE_VERSION = "preliminary_surface_intelligence_v0";

type SeverityBand = "low" | "medium" | "high";
type ConfidenceBand = "low" | "medium" | "high";

export interface SurfaceIntelligenceImageInput {
  outputFilePath?: string;
  displayTransform?: FixedRigDisplayTransform;
  rawSourceFilePath?: string;
  rawSourceSha256?: string;
  imageWidth?: number;
  imageHeight?: number;
  analysisCoordinateFrame?: "normalized_card_portrait_pixels";
}

export interface SurfaceIntelligenceChannelInput {
  channel: number;
  displayImage?: SurfaceIntelligenceImageInput;
  stats?: Partial<FixedRigQualityMetrics>;
}

export interface BuildPreliminarySurfaceIntelligenceInput {
  side: FixedRigCardSide;
  outputDir: string;
  trueView?: SurfaceIntelligenceImageInput;
  darkControl?: SurfaceIntelligenceImageInput;
  allOn?: SurfaceIntelligenceImageInput;
  acceptedProfile?: SurfaceIntelligenceImageInput;
  channelImages: SurfaceIntelligenceChannelInput[];
  roiDefinitions?: FixedRigRoiDefinition[];
  roiCrops?: Array<{ roiId?: string; outputFilePath?: string; displayRect?: { x: number; y: number; width: number; height: number } }>;
  quality?: Partial<FixedRigQualityMetrics>;
  inheritedWarnings?: string[];
  registrationStatus?: "assumed_fixed_rig" | "normalized_geometry_transform";
  normalizedCardProjection?: SurfaceIntelligenceNormalizedCardProjection;
}

interface SurfaceIntelligenceProjectionFingerprints {
  sourceSha256: string;
  normalizedArtifactSha256: string;
}

export interface SurfaceIntelligenceDirectNormalizedCardProjection extends SurfaceIntelligenceProjectionFingerprints {
  projectionMode: "normalized_card_direct";
  inputCoordinateFrame: "normalized_card_portrait_pixels";
  normalizedImageWidth: number;
  normalizedImageHeight: number;
}

export interface SurfaceIntelligenceSourceDisplayProjection extends SurfaceIntelligenceProjectionFingerprints {
  projectionMode?: "source_display_rotation_crop";
  inputCoordinateFrame?: "ai_grader_card_portrait_display";
  sourceImageWidth: number;
  sourceImageHeight: number;
  displayTransform: FixedRigDisplayTransform;
  rotationDegrees: number;
  deskewAppliedDegrees?: number;
  corners: {
    topLeft: { x: number; y: number };
    topRight: { x: number; y: number };
    bottomRight: { x: number; y: number };
    bottomLeft: { x: number; y: number };
  };
}

export type SurfaceIntelligenceNormalizedCardProjection =
  | SurfaceIntelligenceDirectNormalizedCardProjection
  | SurfaceIntelligenceSourceDisplayProjection;

interface LoadedImage {
  filePath: string;
  data: Uint8Array;
  width: number;
  height: number;
}

interface LoadedChannel extends LoadedImage {
  channel: number;
  stats?: Partial<FixedRigQualityMetrics>;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function inverseDisplayPoint(
  point: { x: number; y: number },
  projection: SurfaceIntelligenceSourceDisplayProjection,
) {
  const { sourceImageWidth: width, sourceImageHeight: height, displayTransform } = projection;
  if (displayTransform === "none") return { ...point };
  if (displayTransform === "rotate180") return { x: width - point.x, y: height - point.y };
  if (displayTransform === "rotate90ccw") return { x: width - point.y, y: point.x };
  return { x: point.y, y: height - point.x };
}

function rotatedImageDimensions(width: number, height: number, degrees: number) {
  const radians = (degrees * Math.PI) / 180;
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));
  return {
    width: Math.max(1, Math.round(width * cosine + height * sine)),
    height: Math.max(1, Math.round(width * sine + height * cosine)),
  };
}

function rotatePoint(
  point: { x: number; y: number },
  sourceWidth: number,
  sourceHeight: number,
  outputWidth: number,
  outputHeight: number,
  degrees: number,
) {
  const radians = (degrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const dx = point.x - sourceWidth / 2;
  const dy = point.y - sourceHeight / 2;
  return {
    x: outputWidth / 2 + cosine * dx - sine * dy,
    y: outputHeight / 2 + sine * dx + cosine * dy,
  };
}

export function projectFixedRigDisplayRectToNormalizedCardGeometry(
  rect: Rect,
  projection: SurfaceIntelligenceNormalizedCardProjection,
): FixedRigSurfaceAnomalyCandidate["analysisGeometry"] | undefined {
  if (projection.projectionMode === "normalized_card_direct") {
    if (
      projection.inputCoordinateFrame !== "normalized_card_portrait_pixels" ||
      ![rect.x, rect.y, rect.width, rect.height, projection.normalizedImageWidth, projection.normalizedImageHeight]
        .every(Number.isFinite) ||
      rect.width <= 0 ||
      rect.height <= 0 ||
      projection.normalizedImageWidth <= 0 ||
      projection.normalizedImageHeight <= 0 ||
      !/^[a-f0-9]{64}$/i.test(projection.sourceSha256) ||
      !/^[a-f0-9]{64}$/i.test(projection.normalizedArtifactSha256)
    ) return undefined;
    const points = [
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.width, y: rect.y },
      { x: rect.x + rect.width, y: rect.y + rect.height },
      { x: rect.x, y: rect.y + rect.height },
    ].map((point) => ({
      x: roundMetric(point.x / projection.normalizedImageWidth, 6),
      y: roundMetric(point.y / projection.normalizedImageHeight, 6),
    }));
    if (points.some((point) => point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)) return undefined;
    return {
      coordinateFrame: "normalized_card",
      units: "fraction",
      sourceSha256: projection.sourceSha256.toLowerCase(),
      normalizedArtifactSha256: projection.normalizedArtifactSha256.toLowerCase(),
      shape: { type: "polygon", points },
    };
  }
  if (
    ![rect.x, rect.y, rect.width, rect.height, projection.sourceImageWidth, projection.sourceImageHeight, projection.rotationDegrees]
      .every(Number.isFinite) ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    projection.sourceImageWidth <= 0 ||
    projection.sourceImageHeight <= 0 ||
    !/^[a-f0-9]{64}$/i.test(projection.sourceSha256) ||
    !/^[a-f0-9]{64}$/i.test(projection.normalizedArtifactSha256)
  ) return undefined;
  const cardPoints = [
    projection.corners.topLeft,
    projection.corners.topRight,
    projection.corners.bottomRight,
    projection.corners.bottomLeft,
  ];
  if (cardPoints.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return undefined;
  const deskewDegrees = Number.isFinite(projection.deskewAppliedDegrees)
    ? Number(projection.deskewAppliedDegrees)
    : -projection.rotationDegrees;
  const rotatedImage = rotatedImageDimensions(
    projection.sourceImageWidth,
    projection.sourceImageHeight,
    deskewDegrees,
  );
  const rotateSourcePoint = (point: { x: number; y: number }) => rotatePoint(
    point,
    projection.sourceImageWidth,
    projection.sourceImageHeight,
    rotatedImage.width,
    rotatedImage.height,
    deskewDegrees,
  );
  const rotatedCard = cardPoints.map(rotateSourcePoint);
  const left = clamp(Math.floor(Math.min(...rotatedCard.map((point) => point.x))), 0, rotatedImage.width - 1);
  const top = clamp(Math.floor(Math.min(...rotatedCard.map((point) => point.y))), 0, rotatedImage.height - 1);
  const right = clamp(Math.ceil(Math.max(...rotatedCard.map((point) => point.x))), left + 1, rotatedImage.width);
  const bottom = clamp(Math.ceil(Math.max(...rotatedCard.map((point) => point.y))), top + 1, rotatedImage.height);
  const width = right - left;
  const height = bottom - top;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined;
  const displayPoints = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
  const points = displayPoints.map((point) => {
    const sourcePoint = inverseDisplayPoint(point, projection);
    const rotated = rotateSourcePoint(sourcePoint);
    return { x: roundMetric((rotated.x - left) / width, 6), y: roundMetric((rotated.y - top) / height, 6) };
  });
  if (points.some((point) => point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)) return undefined;
  return {
    coordinateFrame: "normalized_card",
    units: "fraction",
    sourceSha256: projection.sourceSha256.toLowerCase(),
    normalizedArtifactSha256: projection.normalizedArtifactSha256.toLowerCase(),
    shape: { type: "polygon", points },
  };
}

interface CandidateCell {
  rect: Rect;
  mean: number;
  max: number;
  clippedFraction: number;
  darkFraction: number;
  sourceChannels: number[];
  strongestChannel?: number;
}

function roundMetric(value: number, places = 4): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

async function fileMetadata(filePath: string): Promise<{ sha256: string; byteSize: number }> {
  const [bytes, stats] = await Promise.all([readFile(filePath), stat(filePath)]);
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    byteSize: stats.size,
  };
}

async function fileExists(filePath: string | undefined): Promise<boolean> {
  if (!filePath) return false;
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadGrayscale(filePath: string, resizeTo?: { width: number; height: number }): Promise<LoadedImage> {
  let pipeline = sharp(filePath).greyscale();
  if (resizeTo) pipeline = pipeline.resize(resizeTo.width, resizeTo.height, { fit: "fill" });
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  return {
    filePath,
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    width: info.width,
    height: info.height,
  };
}

function percentile(values: number[], percentileValue: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = clamp(Math.floor((percentileValue / 100) * (sorted.length - 1)), 0, sorted.length - 1);
  return sorted[index] ?? 0;
}

function colorForSeverity(normalized: number): { r: number; g: number; b: number; a: number } {
  if (normalized < 0.2) return { r: 40, g: 160, b: 86, a: 42 };
  if (normalized < 0.5) return { r: 224, g: 194, b: 54, a: 88 };
  if (normalized < 0.75) return { r: 230, g: 126, b: 44, a: 142 };
  return { r: 210, g: 54, b: 48, a: 198 };
}

function severityBand(score: number): SeverityBand {
  if (score >= 68) return "high";
  if (score >= 38) return "medium";
  return "low";
}

function confidenceBand(score: number): ConfidenceBand {
  if (score >= 0.72) return "high";
  if (score >= 0.45) return "medium";
  return "low";
}

function cardRectForAnalysis(width: number, height: number, rois?: FixedRigRoiDefinition[]): Rect {
  const fullCard = rois?.find((roi) => roi.id === "full-card" && roi.status === "computed" && (roi.displayRect || roi.rect));
  const rect = fullCard?.displayRect ?? fullCard?.rect;
  if (!rect) return { x: 0, y: 0, width, height };
  const x = clamp(Math.floor(rect.x), 0, Math.max(0, width - 1));
  const y = clamp(Math.floor(rect.y), 0, Math.max(0, height - 1));
  return {
    x,
    y,
    width: clamp(Math.floor(rect.width), 1, width - x),
    height: clamp(Math.floor(rect.height), 1, height - y),
  };
}

function rectContains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;
}

function rectIntersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function matchingRoiRefs(
  rect: Rect,
  roiCrops?: Array<{ roiId?: string; outputFilePath?: string; displayRect?: { x: number; y: number; width: number; height: number } }>
): Array<{ roiId?: string; outputFilePath?: string }> {
  if (!roiCrops?.length) return [];
  return roiCrops
    .filter((crop) => crop.outputFilePath && (!crop.displayRect || rectIntersects(rect, crop.displayRect)))
    .slice(0, 4)
    .map((crop) => ({ roiId: crop.roiId, outputFilePath: crop.outputFilePath }));
}

async function writeArtifact(input: {
  outputFilePath: string;
  kind: FixedRigDisplayArtifact["kind"];
  artifactRole: NonNullable<FixedRigDisplayArtifact["artifactRole"]>;
  width: number;
  height: number;
  rawSourceFilePath: string;
  rawSourceSha256?: string;
  displayTransform?: FixedRigDisplayTransform;
  sourceInputPaths: string[];
  note: string;
  buffer: Uint8Array | Buffer;
  channels: 3 | 4;
}): Promise<FixedRigDisplayArtifact> {
  await sharp(input.buffer, {
    raw: {
      width: input.width,
      height: input.height,
      channels: input.channels,
    },
  })
    .png()
    .toFile(input.outputFilePath);
  const meta = await fileMetadata(input.outputFilePath);
  return {
    kind: input.kind,
    outputFilePath: input.outputFilePath,
    sha256: meta.sha256,
    byteSize: meta.byteSize,
    mimeType: "image/png",
    imageWidth: input.width,
    imageHeight: input.height,
    rawSourceFilePath: input.rawSourceFilePath,
    ...(input.rawSourceSha256 ? { rawSourceSha256: input.rawSourceSha256 } : {}),
    rawCoordinateFrame: "basler_sensor_pixels",
    displayTransform: input.displayTransform ?? "none",
    displayCoordinateFrame: "ai_grader_card_portrait_display",
    rawEvidenceUnmodified: true,
    artifactRole: input.artifactRole,
    sourceInputPaths: input.sourceInputPaths,
    physicalDirectionMappingStatus: "pending",
    note: input.note,
  };
}

function buildResponseMaps(input: {
  channels: LoadedChannel[];
  dark?: LoadedImage;
  allOn?: LoadedImage;
  cardRect: Rect;
}): {
  response: Float32Array;
  normalized: Float32Array;
  base: Uint8Array;
  clipped: Uint8Array;
  darkMask: Uint8Array;
  samples: number[];
  clippedFraction: number;
  darkFraction: number;
  p50: number;
  p95: number;
  p99: number;
} {
  const { width, height } = input.channels[0];
  const pixelCount = width * height;
  const response = new Float32Array(pixelCount);
  const normalized = new Float32Array(pixelCount);
  const base = new Uint8Array(pixelCount);
  const clipped = new Uint8Array(pixelCount);
  const darkMask = new Uint8Array(pixelCount);
  const samples: number[] = [];
  let clippedCount = 0;
  let darkCount = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    const x = index % width;
    const y = Math.floor(index / width);
    if (!rectContains(input.cardRect, x, y)) continue;
    let min = 255;
    let max = 0;
    let sum = 0;
    for (const channel of input.channels) {
      const darkValue = input.dark?.data[index] ?? 0;
      const value = clamp(channel.data[index] - darkValue, 0, 255);
      min = Math.min(min, value);
      max = Math.max(max, value);
      sum += value;
    }
    const mean = sum / input.channels.length;
    const allOnValue = input.allOn?.data[index] ?? max;
    const responseValue = ((max - min) / Math.max(mean + 12, 18)) * 100;
    response[index] = responseValue;
    base[index] = clamp(Math.round(input.allOn ? allOnValue : mean), 0, 255);
    if (allOnValue >= 248 || max >= 252) {
      clipped[index] = 1;
      clippedCount += 1;
    }
    if (mean <= 8) {
      darkMask[index] = 1;
      darkCount += 1;
    }
    samples.push(responseValue);
  }
  const p50 = percentile(samples, 50);
  const p95 = percentile(samples, 95);
  const p99 = percentile(samples, 99);
  const range = Math.max(0.001, p95 - p50);
  for (let index = 0; index < pixelCount; index += 1) {
    normalized[index] = clamp((response[index] - p50) / range, 0, 1);
  }
  const cardPixels = Math.max(1, input.cardRect.width * input.cardRect.height);
  return {
    response,
    normalized,
    base,
    clipped,
    darkMask,
    samples,
    clippedFraction: clippedCount / cardPixels,
    darkFraction: darkCount / cardPixels,
    p50,
    p95,
    p99,
  };
}

function buildHeatmapBuffer(width: number, height: number, cardRect: Rect, normalized: Float32Array): Uint8Array {
  const output = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const x = index % width;
    const y = Math.floor(index / width);
    const offset = index * 4;
    if (!rectContains(cardRect, x, y)) {
      output[offset + 3] = 0;
      continue;
    }
    const color = colorForSeverity(normalized[index] ?? 0);
    output[offset] = color.r;
    output[offset + 1] = color.g;
    output[offset + 2] = color.b;
    output[offset + 3] = color.a;
  }
  return output;
}

function buildSurfaceVisionBuffer(width: number, height: number, cardRect: Rect, base: Uint8Array, normalized: Float32Array): Uint8Array {
  const output = new Uint8Array(width * height * 3);
  for (let index = 0; index < width * height; index += 1) {
    const x = index % width;
    const y = Math.floor(index / width);
    const offset = index * 3;
    const gray = base[index] ?? 0;
    if (!rectContains(cardRect, x, y)) {
      output[offset] = Math.round(gray * 0.34);
      output[offset + 1] = Math.round(gray * 0.34);
      output[offset + 2] = Math.round(gray * 0.34);
      continue;
    }
    const n = normalized[index] ?? 0;
    const tint = colorForSeverity(n);
    const blend = clamp(0.18 + n * 0.58, 0.18, 0.76);
    output[offset] = clamp(Math.round(gray * (1 - blend) + tint.r * blend), 0, 255);
    output[offset + 1] = clamp(Math.round(gray * (1 - blend) + tint.g * blend), 0, 255);
    output[offset + 2] = clamp(Math.round(gray * (1 - blend) + tint.b * blend), 0, 255);
  }
  return output;
}

function buildMaskBuffer(width: number, height: number, mask: Uint8Array, rgb: { r: number; g: number; b: number }): Uint8Array {
  const output = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    output[offset] = rgb.r;
    output[offset + 1] = rgb.g;
    output[offset + 2] = rgb.b;
    output[offset + 3] = mask[index] ? 170 : 0;
  }
  return output;
}

function channelAveragesForRect(channels: LoadedChannel[], rect: Rect, width: number, height: number): Array<{ channel: number; average: number }> {
  return channels.map((channel) => {
    let sum = 0;
    let count = 0;
    const xMax = clamp(rect.x + rect.width, 0, width);
    const yMax = clamp(rect.y + rect.height, 0, height);
    for (let y = clamp(rect.y, 0, height - 1); y < yMax; y += 1) {
      for (let x = clamp(rect.x, 0, width - 1); x < xMax; x += 1) {
        sum += channel.data[y * width + x] ?? 0;
        count += 1;
      }
    }
    return { channel: channel.channel, average: count ? sum / count : 0 };
  });
}

function sourceChannelsForRect(channels: LoadedChannel[], rect: Rect, width: number, height: number): { sourceChannels: number[]; strongestChannel?: number } {
  const averages = channelAveragesForRect(channels, rect, width, height);
  const mean = averages.reduce((sum, entry) => sum + entry.average, 0) / Math.max(1, averages.length);
  const ranked = averages
    .map((entry) => ({ channel: entry.channel, delta: Math.abs(entry.average - mean) }))
    .sort((a, b) => b.delta - a.delta);
  const strongestChannel = ranked[0]?.channel;
  return {
    sourceChannels: ranked.slice(0, 3).filter((entry) => entry.delta > 0.4).map((entry) => entry.channel),
    ...(strongestChannel ? { strongestChannel } : {}),
  };
}

function buildCandidateCells(input: {
  width: number;
  height: number;
  cardRect: Rect;
  normalized: Float32Array;
  clipped: Uint8Array;
  darkMask: Uint8Array;
  channels: LoadedChannel[];
}): CandidateCell[] {
  const cells: CandidateCell[] = [];
  const gridX = 12;
  const gridY = 16;
  const cellWidth = Math.max(8, Math.floor(input.cardRect.width / gridX));
  const cellHeight = Math.max(8, Math.floor(input.cardRect.height / gridY));
  for (let y = input.cardRect.y; y < input.cardRect.y + input.cardRect.height; y += cellHeight) {
    for (let x = input.cardRect.x; x < input.cardRect.x + input.cardRect.width; x += cellWidth) {
      const rect = {
        x,
        y,
        width: Math.min(cellWidth, input.cardRect.x + input.cardRect.width - x),
        height: Math.min(cellHeight, input.cardRect.y + input.cardRect.height - y),
      };
      let sum = 0;
      let max = 0;
      let clippedCount = 0;
      let darkCount = 0;
      let count = 0;
      for (let yy = rect.y; yy < rect.y + rect.height; yy += 1) {
        for (let xx = rect.x; xx < rect.x + rect.width; xx += 1) {
          const index = yy * input.width + xx;
          const value = input.normalized[index] ?? 0;
          sum += value;
          max = Math.max(max, value);
          clippedCount += input.clipped[index] ? 1 : 0;
          darkCount += input.darkMask[index] ? 1 : 0;
          count += 1;
        }
      }
      if (!count) continue;
      const mean = sum / count;
      const clippedFraction = clippedCount / count;
      const darkFraction = darkCount / count;
      if (mean < 0.36 && max < 0.82) continue;
      const attribution = sourceChannelsForRect(input.channels, rect, input.width, input.height);
      cells.push({
        rect,
        mean,
        max,
        clippedFraction,
        darkFraction,
        sourceChannels: attribution.sourceChannels,
        strongestChannel: attribution.strongestChannel,
      });
    }
  }
  return cells.sort((a, b) => b.mean * 0.65 + b.max * 0.35 - (a.mean * 0.65 + a.max * 0.35)).slice(0, 8);
}

function candidatesFromCells(input: {
  side: FixedRigCardSide;
  cells: CandidateCell[];
  normalizedCardProjection?: SurfaceIntelligenceNormalizedCardProjection;
  confidenceScore: number;
  heatmap?: FixedRigDisplayArtifact;
  surfaceVision?: FixedRigDisplayArtifact;
  channelInputs: SurfaceIntelligenceChannelInput[];
  roiCrops?: BuildPreliminarySurfaceIntelligenceInput["roiCrops"];
}): FixedRigSurfaceAnomalyCandidate[] {
  return input.cells.map((cell, index) => {
    const severityProxy = roundMetric((cell.mean * 0.65 + cell.max * 0.35) * 100 * Math.max(0.55, 1 - cell.clippedFraction * 0.3), 2);
    const band = severityBand(severityProxy);
    const sourceChannels = cell.sourceChannels.length ? cell.sourceChannels : cell.strongestChannel ? [cell.strongestChannel] : [];
    const channelRefs = sourceChannels
      .map((channel) => input.channelInputs.find((entry) => entry.channel === channel))
      .filter((entry): entry is SurfaceIntelligenceChannelInput => Boolean(entry?.displayImage?.outputFilePath))
      .map((entry) => ({ channel: entry.channel, outputFilePath: entry.displayImage?.outputFilePath }));
    const analysisGeometry = input.normalizedCardProjection
      ? projectFixedRigDisplayRectToNormalizedCardGeometry(cell.rect, input.normalizedCardProjection)
      : undefined;
    const usesCanonicalNormalizedPixels =
      input.normalizedCardProjection?.projectionMode === "normalized_card_direct";
    return {
      candidateId: `${input.side}-surface-intelligence-v0-${String(index + 1).padStart(3, "0")}`,
      side: input.side,
      category: "surface",
      ...(analysisGeometry ? { analysisGeometry } : {}),
      ...(usesCanonicalNormalizedPixels
        ? {
            analysisRect: cell.rect,
            analysisCoordinateFrame: "normalized_card_portrait_pixels" as const,
            displayCoordinateFrame: "normalized_card_portrait_pixels" as const,
          }
        : { displayCoordinateFrame: "ai_grader_card_portrait_display" as const }),
      displayRect: cell.rect,
      sourceChannels,
      strongestChannel: cell.strongestChannel,
      physicalDirectionMappingStatus: "pending",
      anomalyProxyScore: severityProxy,
      severityProxy,
      severityBand: band,
      confidence: roundMetric(input.confidenceScore, 3),
      confidenceBand: confidenceBand(input.confidenceScore),
      needsDinoLiteFollowUp: band !== "low" || input.confidenceScore < 0.55 || cell.clippedFraction > 0.08,
      evidenceRefs: {
        heatmap: input.heatmap?.outputFilePath,
        surfaceVision: input.surfaceVision?.outputFilePath,
        sourceChannels: channelRefs,
        roiCrops: matchingRoiRefs(cell.rect, input.roiCrops),
      },
      explanation:
        "Preliminary Surface Intelligence V0 detected a directional-light contrast response in this card-surface region. Source channels are numeric because physical light direction mapping is pending.",
    };
  });
}

function mergeWarnings(input: {
  inheritedWarnings?: string[];
  clippedFraction: number;
  darkFraction: number;
  channelCount: number;
  candidates: FixedRigSurfaceAnomalyCandidate[];
}): string[] {
  return [
    "Surface Intelligence V0 is provisional_diagnostic only; no final surface grade, certificate, or certified photometric-stereo claim is made.",
    "Leimac physical direction mapping is pending, so source attribution is numeric Channel 1-8 only.",
    ...(input.clippedFraction > 0.1
      ? [`Glare/clipping mask is high (${roundMetric(input.clippedFraction, 6)}); surface confidence is reduced.`]
      : input.clippedFraction > 0.02
        ? [`Glare/clipping mask exceeds soft target (${roundMetric(input.clippedFraction, 6)}); review lighting/exposure.`]
        : []),
    ...(input.darkFraction > 0.35 ? [`Underexposure mask is elevated (${roundMetric(input.darkFraction, 6)}); review exposure/duty.`] : []),
    ...(input.channelCount < 8 ? ["Complete 8-channel evidence is required for the strongest V0 surface analysis."] : []),
    ...(input.candidates.length ? [] : ["No conservative V0 surface candidate exceeded the response threshold."]),
    ...(input.inheritedWarnings ?? []),
  ];
}

export function mergeSurfaceAnalysisWithSurfaceIntelligence(
  base: FixedRigSurfaceAnalysis | undefined,
  intelligence: FixedRigSurfaceAnalysis
): FixedRigSurfaceAnalysis {
  const candidates = intelligence.candidates.length ? intelligence.candidates : base?.candidates ?? [];
  return {
    ...(base ?? intelligence),
    detectorId: intelligence.detectorId,
    version: PRELIMINARY_SURFACE_INTELLIGENCE_VERSION,
    status: intelligence.status,
    registration: intelligence.registration,
    perChannelStats: intelligence.perChannelStats.length ? intelligence.perChannelStats : base?.perChannelStats ?? [],
    ...(intelligence.heatmap ? { heatmap: intelligence.heatmap } : base?.heatmap ? { heatmap: base.heatmap } : {}),
    ...(intelligence.surfaceVision ? { surfaceVision: intelligence.surfaceVision } : base?.surfaceVision ? { surfaceVision: base.surfaceVision } : {}),
    ...(intelligence.glareMask ? { glareMask: intelligence.glareMask } : base?.glareMask ? { glareMask: base.glareMask } : {}),
    ...(intelligence.underexposureMask
      ? { underexposureMask: intelligence.underexposureMask }
      : base?.underexposureMask
        ? { underexposureMask: base.underexposureMask }
        : {}),
    physicalDirectionMappingStatus: "pending",
    normalization: intelligence.normalization ?? base?.normalization,
    masks: intelligence.masks ?? base?.masks,
    confidence: intelligence.confidence ?? base?.confidence,
    candidates,
    warnings: Array.from(new Set([...(intelligence.warnings ?? []), ...(base?.warnings ?? [])])),
  };
}

export async function buildPreliminarySurfaceIntelligenceV0(
  input: BuildPreliminarySurfaceIntelligenceInput
): Promise<FixedRigSurfaceAnalysis> {
  await mkdir(input.outputDir, { recursive: true });
  const validChannels: LoadedChannel[] = [];
  const orderedInputs = [...input.channelImages].sort((a, b) => a.channel - b.channel);
  const firstPath = orderedInputs.find((entry) => entry.displayImage?.outputFilePath)?.displayImage?.outputFilePath;
  const firstExists = await fileExists(firstPath);
  if (!firstPath || !firstExists) {
    return {
      detectorId: PRELIMINARY_SURFACE_INTELLIGENCE_VERSION,
      version: PRELIMINARY_SURFACE_INTELLIGENCE_VERSION,
      status: "insufficient_evidence",
      registration: {
        status: "not_computed",
        note: "Surface Intelligence V0 could not load a channel-image stack.",
      },
      perChannelStats: orderedInputs.map((entry) => ({
        channel: entry.channel,
        ...(entry.stats?.mean !== undefined ? { mean: entry.stats.mean } : {}),
        ...(entry.stats?.max !== undefined ? { max: entry.stats.max } : {}),
        ...(entry.stats?.clippedPixelFraction !== undefined ? { clippedPixelFraction: entry.stats.clippedPixelFraction } : {}),
        ...(entry.stats?.darkPixelFraction !== undefined ? { darkPixelFraction: entry.stats.darkPixelFraction } : {}),
        ...(entry.stats?.sharpnessScore !== undefined ? { sharpnessScore: entry.stats.sharpnessScore } : {}),
      })),
      candidates: [],
      physicalDirectionMappingStatus: "pending",
      confidence: { score: 0, band: "low", warnings: ["Channel image files were unavailable."] },
      warnings: [
        "Surface Intelligence V0 status is insufficient_evidence because channel images were missing.",
        ...(input.inheritedWarnings ?? []),
      ],
    };
  }

  const base = await loadGrayscale(firstPath);
  const normalizedProjectionMatchesAnalysisRaster =
    input.normalizedCardProjection?.projectionMode !== "normalized_card_direct" ||
    (
      input.normalizedCardProjection.inputCoordinateFrame === "normalized_card_portrait_pixels" &&
      input.normalizedCardProjection.normalizedImageWidth === base.width &&
      input.normalizedCardProjection.normalizedImageHeight === base.height
    );
  const normalizedCardProjection = normalizedProjectionMatchesAnalysisRaster
    ? input.normalizedCardProjection
    : undefined;
  const projectionWarnings = normalizedProjectionMatchesAnalysisRaster
    ? []
    : [
        "Normalized-card finding projection was suppressed because its canonical dimensions did not match the analyzed channel raster.",
      ];
  for (const entry of orderedInputs) {
    const filePath = entry.displayImage?.outputFilePath;
    if (!(await fileExists(filePath))) continue;
    const loaded = await loadGrayscale(filePath as string, { width: base.width, height: base.height });
    validChannels.push({ ...loaded, channel: entry.channel, stats: entry.stats });
  }
  const dark = (await fileExists(input.darkControl?.outputFilePath))
    ? await loadGrayscale(input.darkControl?.outputFilePath as string, { width: base.width, height: base.height })
    : undefined;
  const allOn = (await fileExists(input.allOn?.outputFilePath))
    ? await loadGrayscale(input.allOn?.outputFilePath as string, { width: base.width, height: base.height })
    : undefined;
  const trueViewPath = input.trueView?.outputFilePath ?? firstPath;
  const cardRect = cardRectForAnalysis(base.width, base.height, input.roiDefinitions);
  if (validChannels.length < 2) {
    return {
      detectorId: PRELIMINARY_SURFACE_INTELLIGENCE_VERSION,
      version: PRELIMINARY_SURFACE_INTELLIGENCE_VERSION,
      status: "insufficient_evidence",
      registration: {
        status: "not_computed",
        note: "Surface Intelligence V0 requires at least two loaded channel images.",
      },
      perChannelStats: validChannels.map((entry) => ({
        channel: entry.channel,
        mean: entry.stats?.mean,
        max: entry.stats?.max,
        clippedPixelFraction: entry.stats?.clippedPixelFraction,
        darkPixelFraction: entry.stats?.darkPixelFraction,
        sharpnessScore: entry.stats?.sharpnessScore,
      })),
      candidates: [],
      physicalDirectionMappingStatus: "pending",
      confidence: { score: 0, band: "low", warnings: ["Fewer than two channel images were loaded."] },
      warnings: [
        "Surface Intelligence V0 status is insufficient_evidence because fewer than two channel images were loaded.",
        ...(input.inheritedWarnings ?? []),
      ],
    };
  }

  const maps = buildResponseMaps({ channels: validChannels, dark, allOn, cardRect });
  const sourceInputPaths = validChannels.map((entry) => entry.filePath);
  const transform = input.trueView?.displayTransform ?? orderedInputs.find((entry) => entry.displayImage?.displayTransform)?.displayImage?.displayTransform ?? "none";
  const heatmapPath = path.join(input.outputDir, `${input.side}-surface-intelligence-v0-heatmap.png`);
  const surfaceVisionPath = path.join(input.outputDir, `${input.side}-surface-vision-v0.png`);
  const glareMaskPath = path.join(input.outputDir, `${input.side}-glare-clipping-mask.png`);
  const darkMaskPath = path.join(input.outputDir, `${input.side}-underexposure-mask.png`);
  const heatmap = await writeArtifact({
    outputFilePath: heatmapPath,
    kind: "surface_heatmap",
    artifactRole: "surface_heatmap",
    width: base.width,
    height: base.height,
    rawSourceFilePath: trueViewPath,
    rawSourceSha256: input.trueView?.rawSourceSha256,
    displayTransform: transform,
    sourceInputPaths,
    note:
      "Surface Intelligence V0 heatmap derived from portrait 8-channel evidence. Green/low to red/high is provisional diagnostic evidence, not a final surface grade.",
    buffer: buildHeatmapBuffer(base.width, base.height, cardRect, maps.normalized),
    channels: 4,
  });
  const surfaceVision = await writeArtifact({
    outputFilePath: surfaceVisionPath,
    kind: "surface_vision_image",
    artifactRole: "surface_vision",
    width: base.width,
    height: base.height,
    rawSourceFilePath: trueViewPath,
    rawSourceSha256: input.trueView?.rawSourceSha256,
    displayTransform: transform,
    sourceInputPaths,
    note:
      "Surface Vision V0 - directional light evidence visualization. This is a false-color contrast composite and not certified photometric stereo.",
    buffer: buildSurfaceVisionBuffer(base.width, base.height, cardRect, maps.base, maps.normalized),
    channels: 3,
  });
  const glareMask = await writeArtifact({
    outputFilePath: glareMaskPath,
    kind: "confidence_mask",
    artifactRole: "glare_mask",
    width: base.width,
    height: base.height,
    rawSourceFilePath: trueViewPath,
    rawSourceSha256: input.trueView?.rawSourceSha256,
    displayTransform: transform,
    sourceInputPaths,
    note: "Confidence Lens clipping/glare mask derived from the channel stack. It is a diagnostic confidence aid only.",
    buffer: buildMaskBuffer(base.width, base.height, maps.clipped, { r: 222, g: 75, b: 62 }),
    channels: 4,
  });
  const underexposureMask = await writeArtifact({
    outputFilePath: darkMaskPath,
    kind: "confidence_mask",
    artifactRole: "underexposure_mask",
    width: base.width,
    height: base.height,
    rawSourceFilePath: trueViewPath,
    rawSourceSha256: input.trueView?.rawSourceSha256,
    displayTransform: transform,
    sourceInputPaths,
    note: "Confidence Lens underexposure mask derived from the channel stack. It is a diagnostic confidence aid only.",
    buffer: buildMaskBuffer(base.width, base.height, maps.darkMask, { r: 67, g: 118, b: 230 }),
    channels: 4,
  });
  const cells = buildCandidateCells({
    width: base.width,
    height: base.height,
    cardRect,
    normalized: maps.normalized,
    clipped: maps.clipped,
    darkMask: maps.darkMask,
    channels: validChannels,
  });
  const clippingPenalty = maps.clippedFraction > 0.1 ? 0.3 : maps.clippedFraction > 0.02 ? 0.15 : 0;
  const channelPenalty = validChannels.length < 8 ? 0.18 : 0;
  const darkPenalty = maps.darkFraction > 0.35 ? 0.12 : 0;
  const confidenceScore = clamp(0.82 - clippingPenalty - channelPenalty - darkPenalty, 0.08, 0.92);
  const candidates = candidatesFromCells({
    side: input.side,
    cells,
    normalizedCardProjection,
    confidenceScore,
    heatmap,
    surfaceVision,
    channelInputs: orderedInputs,
    roiCrops: input.roiCrops,
  });
  const warnings = mergeWarnings({
    inheritedWarnings: [...(input.inheritedWarnings ?? []), ...projectionWarnings],
    clippedFraction: maps.clippedFraction,
    darkFraction: maps.darkFraction,
    channelCount: validChannels.length,
    candidates,
  });
  const perChannelStats = orderedInputs.map((entry) => ({
    channel: entry.channel,
    ...(entry.stats?.mean !== undefined ? { mean: entry.stats.mean } : {}),
    ...(entry.stats?.max !== undefined ? { max: entry.stats.max } : {}),
    ...(entry.stats?.clippedPixelFraction !== undefined ? { clippedPixelFraction: entry.stats.clippedPixelFraction } : {}),
    ...(entry.stats?.darkPixelFraction !== undefined ? { darkPixelFraction: entry.stats.darkPixelFraction } : {}),
    ...(entry.stats?.sharpnessScore !== undefined ? { sharpnessScore: entry.stats.sharpnessScore } : {}),
    anomalyProxyMetric: roundMetric(
      percentile(
        validChannels.find((loaded) => loaded.channel === entry.channel)?.data
          ? Array.from(validChannels.find((loaded) => loaded.channel === entry.channel)?.data ?? []).slice(0, 2000).map((value) => Math.abs(value - maps.p50))
          : [],
        95
      ),
      4
    ),
    ...(entry.displayImage?.outputFilePath
      ? {
          portraitDisplayImage: {
            ...(entry.displayImage as FixedRigDisplayArtifact),
            kind: "portrait_display_image" as const,
            outputFilePath: entry.displayImage.outputFilePath,
            mimeType: "image/png" as const,
            imageWidth: entry.displayImage.imageWidth ?? base.width,
            imageHeight: entry.displayImage.imageHeight ?? base.height,
            rawSourceFilePath: entry.displayImage.rawSourceFilePath ?? entry.displayImage.outputFilePath,
            rawCoordinateFrame: "basler_sensor_pixels" as const,
            ...(entry.displayImage.analysisCoordinateFrame
              ? { analysisCoordinateFrame: entry.displayImage.analysisCoordinateFrame }
              : {}),
            displayTransform: entry.displayImage.displayTransform ?? "none",
            displayCoordinateFrame: "ai_grader_card_portrait_display" as const,
            rawEvidenceUnmodified: true as const,
            note: "Portrait channel display image used as Surface Intelligence V0 input.",
          },
        }
      : {}),
  }));
  const result: FixedRigSurfaceAnalysis = {
    detectorId: PRELIMINARY_SURFACE_INTELLIGENCE_VERSION,
    version: PRELIMINARY_SURFACE_INTELLIGENCE_VERSION,
    status: validChannels.length >= 2 ? "computed_diagnostic" : "insufficient_evidence",
    registration: {
      status: input.registrationStatus ?? "assumed_fixed_rig",
      note:
        input.registrationStatus === "normalized_geometry_transform"
          ? "All channel images share the authoritative full-resolution all-on geometry transform in normalized_card_portrait_pixels."
          : "Per-channel portrait images are assumed aligned by the fixed fixture; V0 does not compute calibrated photometric light directions or homography.",
    },
    perChannelStats,
    heatmap,
    surfaceVision,
    glareMask,
    underexposureMask,
    physicalDirectionMappingStatus: "pending",
    normalization: {
      method: "dark_subtracted_directional_range_over_mean_v0",
      darkSubtraction: Boolean(dark),
      allOnNormalization: Boolean(allOn),
      responsePercentiles: {
        p50: roundMetric(maps.p50, 4),
        p95: roundMetric(maps.p95, 4),
        p99: roundMetric(maps.p99, 4),
      },
      cardRect,
      coordinateFrame:
        input.normalizedCardProjection?.projectionMode === "normalized_card_direct"
          ? "normalized_card_portrait_pixels"
          : "ai_grader_card_portrait_display",
      findingProjection:
        normalizedCardProjection?.projectionMode ??
        (input.normalizedCardProjection?.projectionMode === "normalized_card_direct"
          ? "suppressed_dimension_mismatch"
          : "not_provided"),
    },
    masks: {
      clippingFraction: roundMetric(maps.clippedFraction, 6),
      darkFraction: roundMetric(maps.darkFraction, 6),
      glareMaskPath: glareMask.outputFilePath,
      underexposureMaskPath: underexposureMask.outputFilePath,
    },
    confidence: {
      score: roundMetric(confidenceScore, 3),
      band: confidenceBand(confidenceScore),
      warnings: warnings.filter((warning) => /clipping|underexposure|Complete 8-channel|confidence/i.test(warning)),
    },
    candidates,
    warnings,
  };
  await writeFile(path.join(input.outputDir, `${input.side}-surface-intelligence-v0.json`), `${JSON.stringify(result, null, 2)}\n`, "utf-8");
  return result;
}
