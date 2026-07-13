import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";
import sharp from "sharp";
import {
  CARD_GEOMETRY_VERSION,
  detectCardGeometryFromBuffer,
  type CardGeometryCorners,
  type CardGeometryPoint,
  type CardGeometrySide,
} from "./cardGeometry";

export const NATIVE_CAMERA_SHARP_COMPARATOR_MANIFEST_VERSION =
  "tenkings.ai-grader.sharp-comparator-manifest.v1" as const;
export const NATIVE_CAMERA_SHARP_COMPARATOR_REPORT_VERSION =
  "tenkings.ai-grader.sharp-comparator-report.v1" as const;

const MAX_MANIFEST_BYTES = 2_000_000;
const MAX_CASES = 10_000;
const MAX_IMAGE_BYTES = 96 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 8_192;
const MAX_IMAGE_PIXELS = 96 * 1024 * 1024;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const PUBLIC_CATEGORY = /^[A-Za-z0-9][A-Za-z0-9 .,_+%()-]{0,159}$/;
const FIXED_TIMESTAMP = "1970-01-01T00:00:00.000Z";
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true });

export interface NativeCameraSharpComparatorPoint {
  x: number;
  y: number;
}

export interface NativeCameraSharpComparatorCase {
  id: string;
  pairId: string;
  side: CardGeometrySide;
  category: string;
  expectedCard: boolean;
  expectedDetection: boolean;
  expectedReady: boolean;
  relativeFile: string;
  permittedSha256: string;
  imageWidth: number;
  imageHeight: number;
  groundTruthCorners: readonly NativeCameraSharpComparatorPoint[] | null;
}

export interface NativeCameraSharpComparatorManifest {
  schemaVersion: typeof NATIVE_CAMERA_SHARP_COMPARATOR_MANIFEST_VERSION;
  corpusKind: "safe" | "private" | "mixed";
  missingRealCorpusCategories: readonly string[];
  cases: readonly NativeCameraSharpComparatorCase[];
}

export interface NativeCameraSharpComparatorCaseResult {
  caseId: string;
  pairId: string;
  side: CardGeometrySide;
  category: string;
  expectedCard: boolean;
  expectedDetection: boolean;
  expectedReady: boolean;
  placementState: "not_detected" | "adjust_card" | "ready";
  adjustmentReason: string | null;
  detected: boolean;
  ready: boolean;
  confidence: number;
  meanCornerErrorPixels: number | null;
  imageWidth: number;
  imageHeight: number;
  expectationMet: boolean;
}

export interface NativeCameraSharpComparatorAggregate {
  cases: number;
  expectedCards: number;
  negatives: number;
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;
  falseDetection: number;
  falseReady: number;
  detectionRecall: number | null;
  detectionPrecision: number | null;
  readyRecall: number | null;
  readyPrecision: number | null;
  meanCornerErrorPixels: number | null;
}

export interface NativeCameraSharpComparatorReport {
  schemaVersion: typeof NATIVE_CAMERA_SHARP_COMPARATOR_REPORT_VERSION;
  detectorVersion: typeof CARD_GEOMETRY_VERSION;
  decisionDigest: string;
  corpusKind: NativeCameraSharpComparatorManifest["corpusKind"];
  corpusAvailable: boolean;
  syntheticOnly: boolean;
  accuracyDisclaimer: string;
  missingRealCorpusCategories: readonly string[];
  aggregate: NativeCameraSharpComparatorAggregate;
  cases: readonly NativeCameraSharpComparatorCaseResult[];
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(value: JsonRecord, required: readonly string[], optional: readonly string[], subject: string): void {
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    throw new Error(`${subject} is missing a required property.`);
  }
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error(`${subject} contains an unsupported property.`);
  }
}

function assertSafeId(value: unknown, subject: string): asserts value is string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) throw new Error(`${subject} must be a safe identifier.`);
}

function assertBoolean(value: unknown, subject: string): asserts value is boolean {
  if (typeof value !== "boolean") throw new Error(`${subject} must be boolean.`);
}

function assertDimension(value: unknown, subject: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 64 || (value as number) > MAX_IMAGE_DIMENSION) {
    throw new Error(`${subject} is outside the supported image bound.`);
  }
}

function validateRelativeFixturePath(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 240 || path.isAbsolute(value)) {
    throw new Error("Comparator fixture path must be a bounded root-relative path.");
  }
  const normalized = path.normalize(value);
  if (normalized === ".." || normalized.startsWith(`..${path.sep}`) || normalized.includes(`:${path.sep}`)) {
    throw new Error("Comparator fixture path escaped its authorized root.");
  }
  return value;
}

function validateGroundTruth(value: unknown, expectedCard: boolean, subject: string): readonly NativeCameraSharpComparatorPoint[] | null {
  if (value === null) {
    if (expectedCard) throw new Error(`${subject} requires four raw-source ground-truth corners.`);
    return null;
  }
  if (!Array.isArray(value) || value.length !== 4) {
    throw new Error(`${subject} ground truth must contain exactly four ordered corners.`);
  }
  return value.map((point) => {
    if (!isRecord(point)) throw new Error(`${subject} ground truth corner is invalid.`);
    assertExactKeys(point, ["x", "y"], [], `${subject} ground truth corner`);
    if (typeof point.x !== "number" || typeof point.y !== "number" || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new Error(`${subject} ground truth corner must be finite.`);
    }
    return { x: point.x, y: point.y };
  });
}

function validateManifestCase(value: unknown, index: number): NativeCameraSharpComparatorCase {
  if (!isRecord(value)) throw new Error(`Comparator case ${index} is invalid.`);
  const required = [
    "id",
    "pairId",
    "side",
    "category",
    "expectedCard",
    "expectedDetection",
    "expectedReady",
    "relativeFile",
    "permittedSha256",
    "imageWidth",
    "imageHeight",
    "groundTruthCorners",
  ] as const;
  assertExactKeys(value, required, [], `Comparator case ${index}`);
  assertSafeId(value.id, `Comparator case ${index} id`);
  assertSafeId(value.pairId, `Comparator case ${index} pairId`);
  assertSafeId(value.category, `Comparator case ${index} category`);
  if (value.side !== "front" && value.side !== "back") throw new Error(`Comparator case ${index} side is invalid.`);
  assertBoolean(value.expectedCard, `Comparator case ${index} expectedCard`);
  assertBoolean(value.expectedDetection, `Comparator case ${index} expectedDetection`);
  assertBoolean(value.expectedReady, `Comparator case ${index} expectedReady`);
  if (value.expectedReady && (!value.expectedDetection || !value.expectedCard)) {
    throw new Error(`Comparator case ${index} cannot expect Ready without a card and detection.`);
  }
  if (typeof value.permittedSha256 !== "string" || !SHA256.test(value.permittedSha256)) {
    throw new Error(`Comparator case ${index} SHA-256 is invalid.`);
  }
  assertDimension(value.imageWidth, `Comparator case ${index} imageWidth`);
  assertDimension(value.imageHeight, `Comparator case ${index} imageHeight`);
  if (value.imageWidth * value.imageHeight > MAX_IMAGE_PIXELS) {
    throw new Error(`Comparator case ${index} image area is outside the supported bound.`);
  }
  const groundTruthCorners = validateGroundTruth(value.groundTruthCorners, value.expectedCard, `Comparator case ${index}`);
  if (groundTruthCorners?.some((point) =>
    point.x < 0 || point.x > (value.imageWidth as number) - 1 || point.y < 0 || point.y > (value.imageHeight as number) - 1)) {
    throw new Error(`Comparator case ${index} ground truth is outside the declared raw-source frame.`);
  }
  return {
    id: value.id,
    pairId: value.pairId,
    side: value.side,
    category: value.category,
    expectedCard: value.expectedCard,
    expectedDetection: value.expectedDetection,
    expectedReady: value.expectedReady,
    relativeFile: validateRelativeFixturePath(value.relativeFile),
    permittedSha256: value.permittedSha256,
    imageWidth: value.imageWidth,
    imageHeight: value.imageHeight,
    groundTruthCorners,
  };
}

export function parseNativeCameraSharpComparatorManifest(value: unknown): NativeCameraSharpComparatorManifest {
  if (!isRecord(value)) throw new Error("Sharp comparator manifest must be an object.");
  assertExactKeys(
    value,
    ["schemaVersion", "corpusKind", "missingRealCorpusCategories", "cases"],
    [],
    "Sharp comparator manifest",
  );
  if (value.schemaVersion !== NATIVE_CAMERA_SHARP_COMPARATOR_MANIFEST_VERSION) {
    throw new Error("Sharp comparator manifest schema version is unsupported.");
  }
  if (value.corpusKind !== "safe" && value.corpusKind !== "private" && value.corpusKind !== "mixed") {
    throw new Error("Sharp comparator corpus kind is unsupported.");
  }
  if (!Array.isArray(value.cases) || value.cases.length > MAX_CASES) {
    throw new Error("Sharp comparator case count is outside the supported bound.");
  }
  if (!Array.isArray(value.missingRealCorpusCategories) || value.missingRealCorpusCategories.length > 100 ||
      value.missingRealCorpusCategories.some((item) => typeof item !== "string" || !PUBLIC_CATEGORY.test(item))) {
    throw new Error("Sharp comparator missing-corpus categories are invalid.");
  }
  if (value.cases.length === 0 && value.missingRealCorpusCategories.length === 0) {
    throw new Error("An empty comparator corpus must declare the missing real corpus categories.");
  }
  const cases = value.cases.map(validateManifestCase);
  if (new Set(cases.map((item) => item.id)).size !== cases.length) {
    throw new Error("Sharp comparator case IDs must be unique.");
  }
  return {
    schemaVersion: value.schemaVersion,
    corpusKind: value.corpusKind,
    missingRealCorpusCategories: [...value.missingRealCorpusCategories] as string[],
    cases,
  };
}

export async function loadNativeCameraSharpComparatorManifest(
  manifestPath: string,
): Promise<NativeCameraSharpComparatorManifest> {
  let metadata: Stats;
  let bytes: Buffer;
  try {
    metadata = await stat(manifestPath);
    bytes = await readFile(manifestPath);
  } catch {
    throw new Error("Sharp comparator manifest is unavailable.");
  }
  if (!metadata.isFile() || metadata.size < 2 || metadata.size > MAX_MANIFEST_BYTES) {
    throw new Error("Sharp comparator manifest size is invalid.");
  }
  let text: string;
  try {
    text = STRICT_UTF8.decode(bytes);
  } catch {
    throw new Error("Sharp comparator manifest is not valid UTF-8.");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Sharp comparator manifest is not valid JSON.");
  }
  return parseNativeCameraSharpComparatorManifest(value);
}

function round(value: number, places = 6): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : round(numerator / denominator);
}

function detectedCornersAsArray(corners: CardGeometryCorners): readonly CardGeometryPoint[] {
  return [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft];
}

function cyclicCornerError(
  actual: readonly CardGeometryPoint[],
  expected: readonly NativeCameraSharpComparatorPoint[],
): number {
  const variants: NativeCameraSharpComparatorPoint[][] = [];
  for (let offset = 0; offset < 4; offset += 1) {
    variants.push(Array.from({ length: 4 }, (_, index) => expected[(index + offset) % 4]!));
  }
  const reversed = [...expected].reverse();
  for (let offset = 0; offset < 4; offset += 1) {
    variants.push(Array.from({ length: 4 }, (_, index) => reversed[(index + offset) % 4]!));
  }
  return Math.min(...variants.map((variant) =>
    variant.reduce((sum, point, index) => {
      const detected = actual[index]!;
      return sum + Math.hypot(detected.x - point.x, detected.y - point.y);
    }, 0) / 4));
}

async function resolveFixture(root: string, fixtureCase: NativeCameraSharpComparatorCase): Promise<string> {
  let canonicalRoot: string;
  try {
    canonicalRoot = await realpath(root);
  } catch {
    throw new Error("Comparator fixture root is unavailable.");
  }
  const candidate = path.resolve(canonicalRoot, fixtureCase.relativeFile);
  let canonicalCandidate: string;
  try {
    canonicalCandidate = await realpath(candidate);
  } catch {
    throw new Error(`Comparator fixture ${fixtureCase.id} is unavailable.`);
  }
  const relative = path.relative(canonicalRoot, canonicalCandidate);
  if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`Comparator fixture ${fixtureCase.id} escaped its authorized root.`);
  }
  return canonicalCandidate;
}

async function evaluateCase(
  root: string,
  fixtureCase: NativeCameraSharpComparatorCase,
): Promise<NativeCameraSharpComparatorCaseResult> {
  const fixturePath = await resolveFixture(root, fixtureCase);
  let metadata: Stats;
  let encoded: Buffer;
  try {
    metadata = await stat(fixturePath);
    encoded = await readFile(fixturePath);
  } catch {
    throw new Error(`Comparator fixture ${fixtureCase.id} became unavailable.`);
  }
  if (!metadata.isFile() || metadata.size < 1 || metadata.size > MAX_IMAGE_BYTES) {
    throw new Error(`Comparator fixture ${fixtureCase.id} has an invalid byte size.`);
  }
  const digest = createHash("sha256").update(encoded).digest("hex");
  if (digest !== fixtureCase.permittedSha256) {
    throw new Error(`Comparator fixture ${fixtureCase.id} failed its permitted SHA-256 check.`);
  }
  let decoded: sharp.Metadata;
  try {
    decoded = await sharp(encoded, { failOn: "error", limitInputPixels: MAX_IMAGE_PIXELS }).metadata();
  } catch {
    throw new Error(`Comparator fixture ${fixtureCase.id} is not a bounded decodable image.`);
  }
  const width = decoded.autoOrient?.width ?? decoded.width;
  const height = decoded.autoOrient?.height ?? decoded.height;
  if (width !== fixtureCase.imageWidth || height !== fixtureCase.imageHeight) {
    throw new Error(`Comparator fixture ${fixtureCase.id} dimensions do not match its redacted manifest.`);
  }
  const geometry = await detectCardGeometryFromBuffer({
    imageBuffer: encoded,
    fileName: "redacted-fixture",
    side: fixtureCase.side,
    sourceImageId: fixtureCase.id,
    sourceFrameId: fixtureCase.id,
    timestamp: FIXED_TIMESTAMP,
  });
  if (geometry.version !== CARD_GEOMETRY_VERSION || geometry.side !== fixtureCase.side ||
      geometry.image.width !== fixtureCase.imageWidth || geometry.image.height !== fixtureCase.imageHeight) {
    throw new Error(`Comparator fixture ${fixtureCase.id} produced incoherent detector metadata.`);
  }
  const detected = geometry.detectionUsed && geometry.geometrySource === "detected";
  const ready = geometry.placementState === "ready";
  const cornerError = geometry.detectedCorners && fixtureCase.groundTruthCorners
    ? round(cyclicCornerError(detectedCornersAsArray(geometry.detectedCorners), fixtureCase.groundTruthCorners), 3)
    : null;
  return {
    caseId: fixtureCase.id,
    pairId: fixtureCase.pairId,
    side: fixtureCase.side,
    category: fixtureCase.category,
    expectedCard: fixtureCase.expectedCard,
    expectedDetection: fixtureCase.expectedDetection,
    expectedReady: fixtureCase.expectedReady,
    placementState: geometry.placementState,
    adjustmentReason: geometry.adjustmentReason,
    detected,
    ready,
    confidence: round(geometry.confidence),
    meanCornerErrorPixels: cornerError,
    imageWidth: geometry.image.width,
    imageHeight: geometry.image.height,
    expectationMet: detected === fixtureCase.expectedDetection && ready === fixtureCase.expectedReady,
  };
}

function aggregate(results: readonly NativeCameraSharpComparatorCaseResult[]): NativeCameraSharpComparatorAggregate {
  const truePositive = results.filter((item) => item.expectedDetection && item.detected).length;
  const falsePositive = results.filter((item) => !item.expectedDetection && item.detected).length;
  const trueNegative = results.filter((item) => !item.expectedDetection && !item.detected).length;
  const falseNegative = results.filter((item) => item.expectedDetection && !item.detected).length;
  const readyTruePositive = results.filter((item) => item.expectedReady && item.ready).length;
  const readyFalsePositive = results.filter((item) => !item.expectedReady && item.ready).length;
  const readyFalseNegative = results.filter((item) => item.expectedReady && !item.ready).length;
  const errors = results.map((item) => item.meanCornerErrorPixels).filter((value): value is number => value !== null);
  return {
    cases: results.length,
    expectedCards: results.filter((item) => item.expectedCard).length,
    negatives: results.filter((item) => !item.expectedCard).length,
    truePositive,
    falsePositive,
    trueNegative,
    falseNegative,
    falseDetection: results.filter((item) => !item.expectedCard && item.detected).length,
    falseReady: results.filter((item) => !item.expectedReady && item.ready).length,
    detectionRecall: rate(truePositive, truePositive + falseNegative),
    detectionPrecision: rate(truePositive, truePositive + falsePositive),
    readyRecall: rate(readyTruePositive, readyTruePositive + readyFalseNegative),
    readyPrecision: rate(readyTruePositive, readyTruePositive + readyFalsePositive),
    meanCornerErrorPixels: errors.length === 0 ? null : round(errors.reduce((sum, value) => sum + value, 0) / errors.length, 3),
  };
}

function decisionDigest(
  manifest: NativeCameraSharpComparatorManifest,
  results: readonly NativeCameraSharpComparatorCaseResult[],
  metrics: NativeCameraSharpComparatorAggregate,
): string {
  const projection = {
    schemaVersion: NATIVE_CAMERA_SHARP_COMPARATOR_REPORT_VERSION,
    detectorVersion: CARD_GEOMETRY_VERSION,
    corpusKind: manifest.corpusKind,
    missingRealCorpusCategories: manifest.missingRealCorpusCategories,
    aggregate: metrics,
    cases: results,
  };
  return createHash("sha256").update(JSON.stringify(projection)).digest("hex");
}

/**
 * Offline-only full-resolution comparator. This invokes the existing
 * TypeScript/Sharp detector with its production defaults; it never starts a
 * native worker, opens Pylon, or supplies hardware settings.
 */
export async function evaluateNativeCameraSharpComparator(
  manifest: NativeCameraSharpComparatorManifest,
  fixtureRoot?: string,
): Promise<NativeCameraSharpComparatorReport> {
  const validated = parseNativeCameraSharpComparatorManifest(manifest);
  if (validated.cases.length > 0 && !fixtureRoot) {
    throw new Error("A comparator fixture root is required when the manifest contains cases.");
  }
  const results: NativeCameraSharpComparatorCaseResult[] = [];
  for (const fixtureCase of validated.cases) {
    results.push(await evaluateCase(fixtureRoot!, fixtureCase));
  }
  const metrics = aggregate(results);
  return {
    schemaVersion: NATIVE_CAMERA_SHARP_COMPARATOR_REPORT_VERSION,
    detectorVersion: CARD_GEOMETRY_VERSION,
    decisionDigest: decisionDigest(validated, results, metrics),
    corpusKind: validated.corpusKind,
    corpusAvailable: results.length > 0,
    syntheticOnly: validated.corpusKind === "safe",
    accuracyDisclaimer: results.length === 0
      ? "No authorized full-resolution fixtures were supplied; this report contains no accuracy evidence."
      : "Sharp comparator results describe only the authorized manifest fixtures and are not Dell or production validation.",
    missingRealCorpusCategories: [...validated.missingRealCorpusCategories],
    aggregate: metrics,
    cases: results,
  };
}

export function serializeNativeCameraSharpComparatorReport(report: NativeCameraSharpComparatorReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

interface ComparatorCliOptions {
  manifest: string;
  fixtureRoot?: string;
}

function parseCliOptions(args: readonly string[]): ComparatorCliOptions {
  let manifest: string | undefined;
  let fixtureRoot: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    const value = args[index + 1];
    if ((option !== "--manifest" && option !== "--fixture-root") || !value || value.startsWith("--")) {
      throw new Error("Usage: --manifest <file> [--fixture-root <directory>]");
    }
    if (option === "--manifest") {
      if (manifest) throw new Error("--manifest may be specified only once.");
      manifest = value;
    } else {
      if (fixtureRoot) throw new Error("--fixture-root may be specified only once.");
      fixtureRoot = value;
    }
    index += 1;
  }
  if (!manifest) throw new Error("--manifest is required.");
  return { manifest, ...(fixtureRoot ? { fixtureRoot } : {}) };
}

export async function runNativeCameraSharpComparatorCli(args: readonly string[]): Promise<number> {
  try {
    const options = parseCliOptions(args);
    const manifest = await loadNativeCameraSharpComparatorManifest(options.manifest);
    const report = await evaluateNativeCameraSharpComparator(manifest, options.fixtureRoot);
    process.stdout.write(serializeNativeCameraSharpComparatorReport(report));
    return 0;
  } catch {
    process.stderr.write("Sharp comparator failed without exposing fixture details.\n");
    return 1;
  }
}

if (require.main === module) {
  void runNativeCameraSharpComparatorCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
