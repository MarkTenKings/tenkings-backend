import { createHash, createHmac } from "node:crypto";
import sharp from "sharp";
import {
  AI_GRADER_DEFECT_FINDING_V2_VERSION,
  AI_GRADER_REPORT_BUNDLE_V03_VERSION,
  MATHEMATICAL_FINDING_V1_SCHEMA_VERSION,
  MATHEMATICAL_DESIGN_REFERENCE_V1_SCHEMA_VERSION,
  MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
  POKEMON_TCG_STANDARD_CORNER_PROFILE,
  POKEMON_TCG_STANDARD_CORNER_PROFILE_ID,
  POKEMON_TCG_STANDARD_CORNER_PROFILE_RADIUS_MM,
  POKEMON_TCG_STANDARD_CORNER_PROFILE_SHA256,
  POKEMON_TCG_STANDARD_CORNER_PROFILE_VERSION,
  POKEMON_TCG_STANDARD_MEASUREMENT_AUTHENTICATION_DOMAIN,
  POKEMON_TCG_STANDARD_MEASUREMENT_AUTHORITY_SCHEMA_VERSION,
  aiGraderReportBundleV03Schema,
  aiGraderPublishedDefectFindingV2Schema,
  canonicalJsonV1,
  type AiGraderPublishedDefectFindingV2,
  type AiGraderCalibrationActivationAuthorityV1,
  type AiGraderReportBundleV03,
  type OperationallyUsableMathematicalCalibrationProfileV1 as MathematicalCalibrationProfileV1,
  type MathematicalDesignReferenceV1,
  type MathematicalGradingElementV1,
  type RegisteredDesignTemplateAxisCalculationV1,
  type TrustedPokemonCardFormatAuthorityV1,
} from "@tenkings/shared";
import type { FixedRigCenteringElementResultV1, FixedRigPointV1 } from "./fixedRigCenteringV1";
import { validateMathematicalCalibrationForOperationalUseV1 } from "./productOwnerOperationalAcceptanceV1";
import type { FixedRigConditionElementResultV1 } from "./fixedRigCornerEdgeV1";
import type {
  FixedRigMathematicalGradeV1Result,
} from "./fixedRigMathematicalGradeV1";
import type { FixedRigSurfaceV1Result } from "./fixedRigSurfaceV1";
import { verifyTrustedPokemonCardFormatAuthorityV1 } from "./fixedRigPokemonStandardCornerProfileV1";

export const AI_GRADER_MATHEMATICAL_REPORT_ADAPTER_V1_VERSION =
  "ai_grader_mathematical_report_adapter_v1" as const;

type ComputedCenteringV1 = Extract<FixedRigCenteringElementResultV1, { status: "computed" }>;
type FinalMathematicalGradeV1 = Extract<
  FixedRigMathematicalGradeV1Result,
  { status: "final_mathematical_grade_v1" }
>;

export type AiGraderMathematicalReportEvidenceRoleV1 =
  | "normalized_card"
  | "surface_heatmap"
  | "surface_vision"
  | "confidence_mask"
  | "measurement_overlay"
  | "deduction_overlay"
  | "segmentation_mask"
  | "illumination_mask"
  | "common_mode_response"
  | "outer_cut_contour"
  | "printed_design_contour"
  | "design_reference"
  | "centering_overlay"
  | "flat_field"
  | "directional_channel"
  | "roi_crop"
  | "other_evidence";

export interface AiGraderMathematicalReportAssetBindingV1 {
  id: string;
  side: "front" | "back";
  evidenceRole: AiGraderMathematicalReportEvidenceRoleV1;
  fileName: string;
  contentType: string;
  publicUrl?: string;
  storageKey?: string;
  bytes?: Uint8Array;
  sha256?: string;
  byteSize?: number;
  widthPx?: number;
  heightPx?: number;
}

export interface AiGraderMathematicalReportConfidenceV1 {
  score: number;
  band: "low" | "medium" | "high";
  validEvidenceCoverage: number;
  warnings: string[];
}

export type AiGraderMathematicalFindingGeometryV1 =
  | { kind: "box"; x: number; y: number; width: number; height: number }
  | { kind: "polygon"; points: Array<{ x: number; y: number }> };

export interface AiGraderMathematicalFindingPresentationV1 {
  findingId: string;
  geometry: AiGraderMathematicalFindingGeometryV1;
  detector: {
    id: string;
    version: string;
    captureProfileVersion: string;
  };
  confidence: number;
  evidenceQuality: "sufficient" | "limited";
  trueViewAssetId: string;
  segmentationMaskAssetId: string;
  confidenceMaskAssetId: string;
  illuminationMaskAssetId: string;
  channelAssetIds: string[];
  roiAssetIds: string[];
  additionalEvidenceAssetIds?: string[];
  heatmapAssetId?: string;
  surfaceVisionAssetId?: string;
  secondaryEvidenceCategories: string[];
  review: {
    status: "confirmed" | "adjusted";
    reviewedAt: string;
  };
}

export interface AiGraderMathematicalConditionObservationPresentationV1 {
  element: "corners" | "edges";
  side: "front" | "back";
  location: string;
  regionId: string;
  score: number;
  penalty: number;
  validEvidenceCoverage: number;
  usableDirectionalChannelCount: number;
  findingIds: string[];
  measurementIds: string[];
  roiAssetId: string;
  segmentationMaskAssetId: string;
  confidenceMaskAssetId: string;
  illuminationMaskAssetId: string;
  channelAssetIds: string[];
}

export interface AiGraderMathematicalEvidenceQualityLimitationV1 {
  limitationId: string;
  side: "front" | "back";
  regionId: string;
  classification:
    | "clipping"
    | "underexposure"
    | "common_mode_specular_glare"
    | "low_confidence"
    | "insufficient_directional_observations"
    | "ungradable";
  validEvidenceCoverage: number;
  excludedPixelFraction: number;
  recoveredFromAlternateChannels: boolean;
  recaptureRequired: boolean;
  evidenceAssetIds: string[];
  explanation: string;
}

export interface BuildAiGraderMathematicalReportBundleV1Input {
  generatedAt: string;
  gradingSessionId?: string;
  reportId: string;
  cardIdentity: AiGraderReportBundleV03["cardIdentity"];
  pokemonStandardCornerAuthority?: TrustedPokemonCardFormatAuthorityV1;
  pokemonStandardCornerAuthorityVerification?: { hmacKey: string; keyId: string };
  calibrationProfile: MathematicalCalibrationProfileV1;
  calibrationBundleAuthority: AiGraderReportBundleV03["calibrationBundleAuthority"];
  calibrationActivationAuthority?: AiGraderCalibrationActivationAuthorityV1;
  designReferences: MathematicalDesignReferenceV1[];
  centering: FixedRigCenteringElementResultV1;
  corners: FixedRigConditionElementResultV1;
  edges: FixedRigConditionElementResultV1;
  surface: { front: FixedRigSurfaceV1Result; back: FixedRigSurfaceV1Result };
  outerCutGeometryEvidence: {
    front: AiGraderReportBundleV03["centeringEvidence"]["front"]["outerCutGeometryEvidence"];
    back: AiGraderReportBundleV03["centeringEvidence"]["back"]["outerCutGeometryEvidence"];
  };
  grade: FixedRigMathematicalGradeV1Result;
  publication: {
    certId: string;
    publicReportUrl: string;
    qrPayloadUrl: string;
  };
  confidence: {
    overall: AiGraderMathematicalReportConfidenceV1;
    elements: Record<MathematicalGradingElementV1, AiGraderMathematicalReportConfidenceV1>;
  };
  findingPresentations: AiGraderMathematicalFindingPresentationV1[];
  conditionObservationPresentations: AiGraderMathematicalConditionObservationPresentationV1[];
  assetBindings: AiGraderMathematicalReportAssetBindingV1[];
  evidenceQualityLimitations?: AiGraderMathematicalEvidenceQualityLimitationV1[];
  geometry?: Record<string, unknown>;
  geometryCaptureDecisions?: Record<string, unknown>;
  captureTiming?: Record<string, unknown>;
  ocrPrefill?: Record<string, unknown>;
  warnings?: string[];
  limitations?: string[];
}

export interface AiGraderMathematicalReportAssetPayloadV1 {
  id: string;
  bytes: Buffer;
  sha256: string;
  byteSize: number;
  contentType: string;
}

export interface AiGraderMathematicalReportBundleV1Artifact {
  adapterVersion: typeof AI_GRADER_MATHEMATICAL_REPORT_ADAPTER_V1_VERSION;
  bundle: AiGraderReportBundleV03;
  assetPayloads: AiGraderMathematicalReportAssetPayloadV1[];
}

type PublishedAssetV03 = AiGraderReportBundleV03["publicAssets"][number];

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

function verifyCalibrationBundleAuthorityV1(
  authority: BuildAiGraderMathematicalReportBundleV1Input["calibrationBundleAuthority"],
): void {
  const observedLedgerSha256 = sha256(
    Buffer.from(JSON.stringify(canonical(authority.members)), "utf8"),
  );
  if (observedLedgerSha256 !== authority.memberLedgerSha256) {
    throw new Error("Calibration bundle authority member-ledger SHA-256 mismatch.");
  }
}

function uniqueCaseInsensitive(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function assetPublicUrl(reportId: string, assetId: string): string {
  const encoded = assetId.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  return `/api/ai-grader/reports/${encodeURIComponent(reportId)}/assets/${encoded}`;
}

function assertFiniteFraction(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be a finite fraction from 0 through 1.`);
  }
}

class PublicAssetRegistryV1 {
  private readonly assets = new Map<string, PublishedAssetV03>();
  private readonly payloads = new Map<string, AiGraderMathematicalReportAssetPayloadV1>();

  constructor(private readonly reportId: string) {}

  addBinding(binding: AiGraderMathematicalReportAssetBindingV1): void {
    const bytes = binding.bytes === undefined ? undefined : Buffer.from(binding.bytes);
    const computedSha = bytes === undefined ? undefined : sha256(bytes);
    if (computedSha && binding.sha256 && computedSha !== binding.sha256.toLowerCase()) {
      throw new Error(`Immutable evidence hash mismatch for ${binding.id}.`);
    }
    const hash = computedSha ?? binding.sha256?.toLowerCase();
    const byteSize = bytes?.byteLength ?? binding.byteSize;
    if (!hash || !/^[a-f0-9]{64}$/.test(hash) || byteSize === undefined || byteSize < 0) {
      throw new Error(`Evidence ${binding.id} requires exact bytes or a SHA-256 and byte size.`);
    }
    if ((binding.widthPx === undefined) !== (binding.heightPx === undefined)) {
      throw new Error(`Evidence ${binding.id} must provide both raster dimensions or neither.`);
    }
    this.add({
      id: binding.id,
      kind: binding.contentType.toLowerCase().startsWith("image/")
        ? "report-image"
        : "report-evidence",
      fileName: binding.fileName,
      contentType: binding.contentType,
      ...(binding.storageKey ? { storageKey: binding.storageKey } : {}),
      publicUrl: binding.publicUrl ?? assetPublicUrl(this.reportId, binding.id),
      byteSize,
      sha256: hash,
      side: binding.side,
      evidenceRole: binding.evidenceRole,
      ...(binding.widthPx === undefined
        ? {}
        : { widthPx: binding.widthPx, heightPx: binding.heightPx }),
    }, bytes);
  }

  addGenerated(input: {
    id: string;
    side: "front" | "back";
    evidenceRole: AiGraderMathematicalReportEvidenceRoleV1;
    fileName: string;
    contentType: string;
    bytes: Buffer;
    widthPx: number;
    heightPx: number;
  }): void {
    const hash = sha256(input.bytes);
    this.add({
      id: input.id,
      kind: "report-image",
      fileName: input.fileName,
      contentType: input.contentType,
      publicUrl: assetPublicUrl(this.reportId, input.id),
      byteSize: input.bytes.byteLength,
      sha256: hash,
      side: input.side,
      evidenceRole: input.evidenceRole,
      widthPx: input.widthPx,
      heightPx: input.heightPx,
    }, input.bytes);
  }

  private add(asset: PublishedAssetV03, bytes?: Buffer): void {
    const key = asset.id.toLowerCase();
    if (this.assets.has(key)) throw new Error(`Duplicate public evidence asset ID ${asset.id}.`);
    this.assets.set(key, asset);
    if (bytes) {
      this.payloads.set(key, {
        id: asset.id,
        bytes,
        sha256: asset.sha256!,
        byteSize: asset.byteSize!,
        contentType: asset.contentType!,
      });
    }
  }

  require(assetId: string): PublishedAssetV03 {
    const asset = this.assets.get(assetId.toLowerCase());
    if (!asset) throw new Error(`Missing immutable public evidence asset ${assetId}.`);
    return asset;
  }

  listAssets(): PublishedAssetV03[] {
    return [...this.assets.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  listPayloads(): AiGraderMathematicalReportAssetPayloadV1[] {
    return [...this.payloads.values()].sort((left, right) => left.id.localeCompare(right.id));
  }
}

function xmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function svgNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error("An overlay coordinate is not finite.");
  return String(Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000);
}

function contourPoints(points: readonly FixedRigPointV1[]): string {
  if (points.length < 4) throw new Error("A measured card contour requires at least four points.");
  return points.map((point) => `${svgNumber(point.x)},${svgNumber(point.y)}`).join(" ");
}

function svgDocument(width: number, height: number, body: string): Buffer {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error("Overlay dimensions must be positive calibrated pixel integers.");
  }
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`,
    "utf8",
  );
}

async function rasterizeGeneratedSvgV1(
  svg: Buffer,
  width: number,
  height: number,
): Promise<Buffer> {
  const png = await sharp(svg, {
    density: 72,
    failOn: "error",
    limitInputPixels: false,
  })
    .resize(width, height, { fit: "fill", kernel: "nearest" })
    .png({
      compressionLevel: 9,
      adaptiveFiltering: false,
      palette: false,
      force: true,
    })
    .toBuffer();
  const metadata = await sharp(png, { failOn: "error" }).metadata();
  if (metadata.format !== "png" || metadata.width !== width || metadata.height !== height) {
    throw new Error("Generated report overlay did not rasterize to its exact calibrated PNG frame.");
  }
  return png;
}

function contourSvg(
  width: number,
  height: number,
  points: readonly FixedRigPointV1[],
  stroke: string,
  label: string,
): Buffer {
  return svgDocument(
    width,
    height,
    `<rect width="100%" height="100%" fill="none"/>` +
      `<polygon points="${contourPoints(points)}" fill="none" stroke="${stroke}" stroke-width="3"/>` +
      `<text x="12" y="28" font-family="Arial,sans-serif" font-size="18" fill="${stroke}">${xmlText(label)}</text>`,
  );
}

function projectDesignReferencePoint(
  point: FixedRigPointV1,
  transformType: "affine" | "homography",
  matrix: readonly number[],
): FixedRigPointV1 | null {
  if (transformType === "affine") {
    const x = matrix[0]! * point.x + matrix[1]! * point.y + matrix[2]!;
    const y = matrix[3]! * point.x + matrix[4]! * point.y + matrix[5]!;
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }
  const denominator = matrix[6]! * point.x + matrix[7]! * point.y + matrix[8]!;
  if (!Number.isFinite(denominator) || Math.abs(denominator) <= Number.EPSILON) return null;
  const x = (matrix[0]! * point.x + matrix[1]! * point.y + matrix[2]!) / denominator;
  const y = (matrix[3]! * point.x + matrix[4]! * point.y + matrix[5]!) / denominator;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function closedContourPath(points: readonly FixedRigPointV1[]): string {
  if (points.length < 4) throw new Error("A centering mask contour requires at least four points.");
  return `M ${points.map((point) => `${svgNumber(point.x)} ${svgNumber(point.y)}`).join(" L ")} Z`;
}

function centeringOverlaySvg(
  width: number,
  height: number,
  side: ComputedCenteringV1["front"],
  calibration: MathematicalCalibrationProfileV1,
): Buffer {
  const binding = side.registrationBinding;
  const inlierIds = new Set(binding?.inlierCorrespondenceIds ?? []);
  const correspondenceQa = binding
    ? binding.correspondenceLedger.correspondences.map((correspondence) => {
        const projected = projectDesignReferencePoint(
          correspondence.designReferencePointPx,
          binding.correspondenceLedger.transformType,
          side.registration.transformMatrix,
        );
        if (!projected) {
          throw new Error(`${side.side} design-reference correspondence ${correspondence.correspondenceId} cannot be projected for its QA overlay.`);
        }
        const observed = correspondence.normalizedSourcePointPx;
        const residual = Math.hypot(projected.x - observed.x, projected.y - observed.y);
        const color = inlierIds.has(correspondence.correspondenceId) ? "#00ff8c" : "#ff476f";
        return `<g data-correspondence-id="${xmlText(correspondence.correspondenceId)}">` +
          `<title>${xmlText(correspondence.correspondenceId)} residual ${residual.toFixed(4)} px</title>` +
          `<line x1="${svgNumber(projected.x)}" y1="${svgNumber(projected.y)}" x2="${svgNumber(observed.x)}" y2="${svgNumber(observed.y)}" stroke="${color}" stroke-width="3"/>` +
          `<circle cx="${svgNumber(projected.x)}" cy="${svgNumber(projected.y)}" r="5" fill="none" stroke="#ffffff" stroke-width="2"/>` +
          `<circle cx="${svgNumber(observed.x)}" cy="${svgNumber(observed.y)}" r="4" fill="${color}" stroke="#000000" stroke-width="1"/>` +
          `<text x="${svgNumber(observed.x + 7)}" y="${svgNumber(observed.y - 7)}" font-family="Arial,sans-serif" font-size="13" fill="#ffffff" stroke="#000000" stroke-width="0.5">${xmlText(correspondence.correspondenceId)} ${residual.toFixed(2)}px</text></g>`;
      }).join("")
    : "";
  const orientationQa = binding
    ? (() => {
        const referenceCenter = {
          x: binding.correspondenceLedger.designReferenceWidthPx / 2,
          y: binding.correspondenceLedger.designReferenceHeightPx / 2,
        };
        const referenceTop = { x: referenceCenter.x, y: 0 };
        const center = projectDesignReferencePoint(
          referenceCenter,
          binding.correspondenceLedger.transformType,
          side.registration.transformMatrix,
        );
        const top = projectDesignReferencePoint(
          referenceTop,
          binding.correspondenceLedger.transformType,
          side.registration.transformMatrix,
        );
        if (!center || !top) throw new Error(`${side.side} design-reference orientation cannot be projected for its QA overlay.`);
        return `<g data-registration-orientation="design-reference-top">` +
          `<line x1="${svgNumber(center.x)}" y1="${svgNumber(center.y)}" x2="${svgNumber(top.x)}" y2="${svgNumber(top.y)}" stroke="#ff4dff" stroke-width="4" marker-end="url(#orientation-arrow)"/>` +
          `<text x="${svgNumber(top.x + 10)}" y="${svgNumber(top.y + 20)}" font-family="Arial,sans-serif" font-size="16" fill="#ffb3ff" stroke="#000000" stroke-width="0.5">APPROVED DESIGN TOP</text></g>`;
      })()
    : "";
  const tenMillimetersX = 10 / calibration.mmPerPixelX;
  const tenMillimetersY = 10 / calibration.mmPerPixelY;
  const physicalOrigin = { x: 22, y: Math.max(130, height - 118) };
  const maskPath = `${closedContourPath(side.outerCutContour)} ${closedContourPath(side.printedDesignContour)}`;
  const lines = side.measurementLines.map((line, index) => {
    const y = 34 + index * 24;
    return `<g data-measurement-id="${xmlText(line.id)}">` +
      `<line x1="${svgNumber(line.start.x)}" y1="${svgNumber(line.start.y)}" ` +
      `x2="${svgNumber(line.end.x)}" y2="${svgNumber(line.end.y)}" stroke="#00e5ff" stroke-width="3"/>` +
      `<text x="12" y="${y}" font-family="Arial,sans-serif" font-size="17" fill="#ffffff">` +
      `${xmlText(line.side)} ${line.pixels.toFixed(3)} px = ${line.millimeters.toFixed(4)} mm</text></g>`;
  }).join("");
  const summaryY = height - 58;
  const summary =
    `H ${side.horizontal.balanceRatio.toFixed(2)}% / ${side.horizontal.score.toFixed(2)}; ` +
    `V ${side.vertical.balanceRatio.toFixed(2)}% / ${side.vertical.score.toFixed(2)}; ` +
    `U95 H ${side.u95Mm.horizontal.toFixed(4)} mm V ${side.u95Mm.vertical.toFixed(4)} mm; ` +
    `Grade-10 tolerance ${side.grade10ToleranceMm.toFixed(4)} mm`;
  const authority = binding
    ? `registered exact reference ${binding.designReferenceId} v${binding.designReferenceVersion}; residual ${side.registration.registrationResidualPx.toFixed(4)} px; inliers ${side.registration.inlierCount}/${side.registration.inlierFraction.toFixed(4)}; confidence ${side.registration.confidence.toFixed(4)}`
    : `detected printed border; robust fit residual ${side.registration.registrationResidualPx.toFixed(4)} px; confidence ${side.registration.confidence.toFixed(4)}`;
  return svgDocument(
    width,
    height,
    `<defs><marker id="orientation-arrow" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#ff4dff"/></marker></defs>` +
      `<rect width="100%" height="100%" fill="#000000" fill-opacity="0.12"/>` +
      `<path d="${maskPath}" fill="#ff9f1c" fill-opacity="0.22" fill-rule="evenodd" data-mask="outer-cut-minus-printed-design"/>` +
      `<polygon points="${contourPoints(side.outerCutContour)}" fill="none" stroke="#ffcc00" stroke-width="3"/>` +
      `<polygon points="${contourPoints(side.printedDesignContour)}" fill="none" stroke="#00ff8c" stroke-width="3"/>` +
      lines +
      correspondenceQa +
      orientationQa +
      `<g data-physical-coordinate-mapping="calibrated-millimeters">` +
      `<line x1="${physicalOrigin.x}" y1="${physicalOrigin.y}" x2="${svgNumber(physicalOrigin.x + tenMillimetersX)}" y2="${physicalOrigin.y}" stroke="#00e5ff" stroke-width="4"/>` +
      `<line x1="${physicalOrigin.x}" y1="${physicalOrigin.y}" x2="${physicalOrigin.x}" y2="${svgNumber(physicalOrigin.y - tenMillimetersY)}" stroke="#00e5ff" stroke-width="4"/>` +
      `<text x="${physicalOrigin.x + 6}" y="${physicalOrigin.y - 8}" font-family="Arial,sans-serif" font-size="14" fill="#ffffff">10 mm X / 10 mm Y (calibrated)</text></g>` +
      `<rect x="4" y="${summaryY - 24}" width="${width - 8}" height="72" fill="#000000" fill-opacity="0.75"/>` +
      `<text x="12" y="${summaryY}" font-family="Arial,sans-serif" font-size="16" fill="#ffffff">${xmlText(summary)}</text>` +
      `<text x="12" y="${summaryY + 24}" font-family="Arial,sans-serif" font-size="16" fill="#ffffff">` +
      `${xmlText(side.profile)} side score ${side.score.toFixed(2)}; exact deduction ${side.centeringDeduction.toFixed(2)}; ${xmlText(authority)}</text>`,
  );
}

function verifyEvidenceReference(
  registry: PublicAssetRegistryV1,
  reference: ComputedCenteringV1["front"]["evidence"][number],
): void {
  const asset = registry.require(reference.assetId);
  if (asset.side !== reference.side || asset.sha256?.toLowerCase() !== reference.sha256.toLowerCase()) {
    throw new Error(`Centering evidence ${reference.assetId} does not match its immutable side/hash binding.`);
  }
}

function centeringAxisEvidence(
  axisName: "horizontal" | "vertical",
  side: ComputedCenteringV1["front"],
  calibration: MathematicalCalibrationProfileV1,
): AiGraderReportBundleV03["centeringEvidence"]["front"]["horizontal"] {
  const axis = axisName === "horizontal" ? side.horizontal : side.vertical;
  const mmPerPixel = axisName === "horizontal" ? calibration.mmPerPixelX : calibration.mmPerPixelY;
  const registered = side.profile === "registered_design_template_v1"
    ? axis as RegisteredDesignTemplateAxisCalculationV1
    : undefined;
  return {
    axis: axisName,
    marginAName: axisName === "horizontal" ? "left" : "top",
    marginBName: axisName === "horizontal" ? "right" : "bottom",
    marginAPx: axis.marginA / mmPerPixel,
    marginBPx: axis.marginB / mmPerPixel,
    marginAMm: axis.marginA,
    marginBMm: axis.marginB,
    measuredDifferenceMm: axis.measuredDifference,
    u95Mm: axis.differenceU95,
    u95Components:
      side.u95ComponentsMm.calibratedMarginDifferenceComponents[axisName],
    ...(side.u95ComponentsMm.printedBoundaryFit
      ? { boundaryFitU95Mm: side.u95ComponentsMm.printedBoundaryFit[axisName] }
      : {}),
    effectiveDifferenceMm: axis.effectiveDifference,
    grade10ToleranceMm: side.grade10ToleranceMm,
    balanceRatio: axis.balanceRatio,
    score: axis.score,
    ...(registered
      ? {
          observedMarginAMm: registered.observedMarginA,
          observedMarginBMm: registered.observedMarginB,
          expectedMarginAMm: registered.expectedMarginA,
          expectedMarginBMm: registered.expectedMarginB,
          physicalAxisSpanMm: registered.physicalAxisSpan,
          axisErrorMm: registered.axisError,
        }
      : {}),
  };
}

async function addCenteringAssetsAndEvidence(
  registry: PublicAssetRegistryV1,
  centering: ComputedCenteringV1,
  calibration: MathematicalCalibrationProfileV1,
  geometryEvidence: BuildAiGraderMathematicalReportBundleV1Input["outerCutGeometryEvidence"],
): Promise<AiGraderReportBundleV03["centeringEvidence"]> {
  const buildSide = async (side: ComputedCenteringV1["front"]) => {
    side.evidence.forEach((reference) => verifyEvidenceReference(registry, reference));
    const prefix = `${side.side}/mathematical-v1`;
    const outerCutContourAssetId = `${prefix}/outer-cut-contour.png`;
    const printedDesignContourAssetId = `${prefix}/printed-design-contour.png`;
    const measurementOverlayAssetId = `${prefix}/centering-overlay.png`;
    const correspondenceLedgerAssetId = side.registrationBinding
      ? `${prefix}/registration/correspondence-ledger.json`
      : undefined;
    if (side.registrationBinding && correspondenceLedgerAssetId) {
      const ledgerBytes = Buffer.from(
        JSON.stringify(side.registrationBinding.correspondenceLedger),
        "utf8",
      );
      if (sha256(ledgerBytes) !== side.registrationBinding.correspondenceLedgerSha256) {
        throw new Error(
          `${side.side} correspondence ledger bytes do not reproduce the registration binding SHA-256.`,
        );
      }
      registry.addBinding({
        id: correspondenceLedgerAssetId,
        side: side.side,
        evidenceRole: "other_evidence",
        fileName: `${side.side}-correspondence-ledger.json`,
        contentType: "application/json",
        bytes: ledgerBytes,
        sha256: side.registrationBinding.correspondenceLedgerSha256,
        byteSize: ledgerBytes.byteLength,
      });
    }
    const common = {
      side: side.side,
      contentType: "image/png",
      widthPx: calibration.normalizedWidthPx,
      heightPx: calibration.normalizedHeightPx,
    } as const;
    const [outerCutBytes, printedDesignBytes, measurementOverlayBytes] = await Promise.all([
      rasterizeGeneratedSvgV1(
        contourSvg(
          calibration.normalizedWidthPx,
          calibration.normalizedHeightPx,
          side.outerCutContour,
          "#ffcc00",
          `${side.side} measured outer physical cut contour`,
        ),
        calibration.normalizedWidthPx,
        calibration.normalizedHeightPx,
      ),
      rasterizeGeneratedSvgV1(
        contourSvg(
          calibration.normalizedWidthPx,
          calibration.normalizedHeightPx,
          side.printedDesignContour,
          "#00ff8c",
          `${side.side} measured printed-design contour`,
        ),
        calibration.normalizedWidthPx,
        calibration.normalizedHeightPx,
      ),
      rasterizeGeneratedSvgV1(
        centeringOverlaySvg(
          calibration.normalizedWidthPx,
          calibration.normalizedHeightPx,
          side,
          calibration,
        ),
        calibration.normalizedWidthPx,
        calibration.normalizedHeightPx,
      ),
    ]);
    registry.addGenerated({
      ...common,
      id: outerCutContourAssetId,
      fileName: `${side.side}-outer-cut-contour.png`,
      evidenceRole: "outer_cut_contour",
      bytes: outerCutBytes,
    });
    registry.addGenerated({
      ...common,
      id: printedDesignContourAssetId,
      fileName: `${side.side}-printed-design-contour.png`,
      evidenceRole: "printed_design_contour",
      bytes: printedDesignBytes,
    });
    registry.addGenerated({
      ...common,
      id: measurementOverlayAssetId,
      fileName: `${side.side}-centering-overlay.png`,
      evidenceRole: "centering_overlay",
      bytes: measurementOverlayBytes,
    });
    return {
      side: side.side,
      profile: side.profile,
      score: side.score,
      horizontal: centeringAxisEvidence("horizontal", side, calibration),
      vertical: centeringAxisEvidence("vertical", side, calibration),
      outerCutContourAssetId,
      printedDesignContourAssetId,
      measurementOverlayAssetId,
      registration: side.registration,
      outerCutGeometryEvidence: { ...geometryEvidence[side.side] },
      ...(side.registrationBinding
        ? {
            registrationEvidence: {
              designReferenceId: side.registrationBinding.designReferenceId,
              designReferenceVersion: side.registrationBinding.designReferenceVersion,
              designReferenceSha256: side.registrationBinding.designReferenceSha256,
              normalizedSourceEvidenceId: side.registrationBinding.normalizedSourceEvidenceId,
              normalizedSourceEvidenceSha256: side.registrationBinding.normalizedSourceEvidenceSha256,
              registrationAlgorithmVersion: side.registrationBinding.registrationAlgorithmVersion,
              correspondenceCount: side.registrationBinding.correspondenceCount,
              inlierCorrespondenceIds: [...side.registrationBinding.inlierCorrespondenceIds],
              correspondenceLedgerSha256: side.registrationBinding.correspondenceLedgerSha256,
              correspondenceLedgerAssetId: correspondenceLedgerAssetId!,
              registrationSha256: side.registrationBinding.registrationSha256,
            },
          }
        : {}),
      evidenceAssetIds: uniqueCaseInsensitive([
        outerCutContourAssetId,
        printedDesignContourAssetId,
        measurementOverlayAssetId,
        ...(correspondenceLedgerAssetId ? [correspondenceLedgerAssetId] : []),
        geometryEvidence[side.side].rawAllOnAssetId,
        geometryEvidence[side.side].normalizedAllOnAssetId,
        ...side.evidence.map((reference) => reference.assetId),
      ]),
    };
  };
  const [front, back] = await Promise.all([
    buildSide(centering.front),
    buildSide(centering.back),
  ]);
  return {
    front,
    back,
    fusedScore: centering.score,
    deduction: centering.centeringDeduction,
    formula: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.centering.frontBackFusion.formula,
    balanceCurve: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.centering.balanceCurve.map(
      (entry) => ({ ...entry }),
    ),
  };
}

function validateConfidence(
  confidence: AiGraderMathematicalReportConfidenceV1,
  label: string,
): AiGraderMathematicalReportConfidenceV1 {
  assertFiniteFraction(confidence.score, `${label} confidence score`);
  assertFiniteFraction(confidence.validEvidenceCoverage, `${label} valid evidence coverage`);
  const bands = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.reportConfidenceBands;
  return {
    score: confidence.score,
    band: confidence.score >= bands.highMinimum
      ? "high"
      : confidence.score >= bands.mediumMinimum ? "medium" : "low",
    validEvidenceCoverage: confidence.validEvidenceCoverage,
    warnings: [...confidence.warnings],
  };
}

function reportConfidenceBand(score: number): "low" | "medium" | "high" {
  const bands = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.reportConfidenceBands;
  return score >= bands.highMinimum
    ? "high"
    : score >= bands.mediumMinimum ? "medium" : "low";
}

function geometrySvgShape(
  geometry: AiGraderMathematicalFindingGeometryV1,
  width: number,
  height: number,
): string {
  if (geometry.kind === "box") {
    const values = [geometry.x, geometry.y, geometry.width, geometry.height];
    values.forEach((value, index) => assertFiniteFraction(value, `finding box coordinate ${index}`));
    if (geometry.width <= 0 || geometry.height <= 0 ||
        geometry.x + geometry.width > 1 + 1e-9 || geometry.y + geometry.height > 1 + 1e-9) {
      throw new Error("A finding box must have nonzero area inside the normalized card.");
    }
    return `<rect x="${svgNumber(geometry.x * width)}" y="${svgNumber(geometry.y * height)}" ` +
      `width="${svgNumber(geometry.width * width)}" height="${svgNumber(geometry.height * height)}" ` +
      `fill="#ff1744" fill-opacity="0.18" stroke="#ff1744" stroke-width="4"/>`;
  }
  if (geometry.points.length < 3) throw new Error("A finding polygon requires at least three points.");
  const points = geometry.points.map((point, index) => {
    assertFiniteFraction(point.x, `finding polygon x ${index}`);
    assertFiniteFraction(point.y, `finding polygon y ${index}`);
    return `${svgNumber(point.x * width)},${svgNumber(point.y * height)}`;
  });
  return `<polygon points="${points.join(" ")}" fill="#ff1744" fill-opacity="0.18" ` +
    `stroke="#ff1744" stroke-width="4"/>`;
}

function findingOverlaySvg(
  width: number,
  height: number,
  finding: FinalMathematicalGradeV1["findings"][number],
  presentation: AiGraderMathematicalFindingPresentationV1,
): Buffer {
  const basis = finding.measurements.find(
    (measurement) => measurement.measurementId.toLowerCase() ===
      finding.deductionBasisMeasurementId.toLowerCase(),
  );
  if (!basis) throw new Error(`Finding ${finding.findingId} has no deduction-basis measurement.`);
  const detail =
    `${finding.category}: ${basis.measuredMeasurement} ${basis.unit}; U95 ${basis.u95}; ` +
    `Grade-10 tolerance ${basis.explicitGrade10Tolerance}; effective ${basis.effectiveMeasurement}; ` +
    `deduction ${finding.deduction.toFixed(2)}`;
  return svgDocument(
    width,
    height,
    `<g data-finding-id="${xmlText(finding.findingId)}" data-physical-defect-id="${xmlText(finding.physicalDefectId)}">` +
      geometrySvgShape(presentation.geometry, width, height) +
      `<rect x="4" y="${height - 74}" width="${width - 8}" height="70" fill="#000000" fill-opacity="0.78"/>` +
      `<text x="12" y="${height - 44}" font-family="Arial,sans-serif" font-size="17" fill="#ffffff">` +
      `${xmlText(`${finding.side} ${finding.location} ${finding.findingId}`)}</text>` +
      `<text x="12" y="${height - 18}" font-family="Arial,sans-serif" font-size="16" fill="#ffffff">` +
      `${xmlText(detail)}</text></g>`,
  );
}

function compareStringSets(left: readonly string[], right: readonly string[]): boolean {
  const a = [...new Set(left.map((entry) => entry.toLowerCase()))].sort();
  const b = [...new Set(right.map((entry) => entry.toLowerCase()))].sort();
  return a.length === b.length && a.every((entry, index) => entry === b[index]);
}

function validateFindingAgainstComputedSources(
  input: BuildAiGraderMathematicalReportBundleV1Input,
  finding: FinalMathematicalGradeV1["findings"][number],
  presentation: AiGraderMathematicalFindingPresentationV1,
): void {
  if (finding.source === "corner_edge") {
    const sourceElement = finding.element === "corners" ? input.corners : input.edges;
    if (sourceElement.status !== "computed") {
      throw new Error(`A final report cannot bind ${finding.findingId} to incomplete ${finding.element} evidence.`);
    }
    const source = sourceElement.observations
      .flatMap((observation) => observation.findings)
      .find((candidate) => candidate.finding.findingId === finding.findingId);
    if (!source || source.finding.category !== finding.category ||
        source.finding.side !== finding.side || source.finding.location !== finding.location ||
        source.finding.physicalDefectId !== finding.originalPhysicalDefectId ||
        source.finding.deduction !== finding.deduction ||
        JSON.stringify(source.finding.measurements) !== JSON.stringify(finding.measurements)) {
      throw new Error(`Published finding ${finding.findingId} does not exactly match computed corner/edge evidence.`);
    }
    if (presentation.detector.id !== source.finding.detectorId ||
        presentation.detector.version !== source.finding.detectorVersion ||
        !compareStringSets(presentation.secondaryEvidenceCategories, source.finding.secondaryEvidenceCategories)) {
      throw new Error(`Presentation provenance for ${finding.findingId} does not match its exact detector evidence.`);
    }
    return;
  }
  const source = input.surface[finding.side].findings.find(
    (candidate) => candidate.findingId === finding.findingId,
  );
  if (!source || source.category !== finding.category ||
      source.physicalDefectId !== finding.originalPhysicalDefectId ||
      source.deduction !== finding.deduction ||
      JSON.stringify(source.measurements) !== JSON.stringify(finding.measurements)) {
    throw new Error(`Published finding ${finding.findingId} does not exactly match computed surface evidence.`);
  }
  if (!source.detectorIds.includes(presentation.detector.id) ||
      !source.detectorVersions.includes(presentation.detector.version) ||
      !compareStringSets(presentation.secondaryEvidenceCategories, source.secondaryEvidenceCategories)) {
    throw new Error(`Presentation provenance for ${finding.findingId} does not match its exact surface detector evidence.`);
  }
  if (presentation.geometry.kind === "box") {
    const expected = source.overlay.normalizedBoundingBox;
    for (const key of ["x", "y", "width", "height"] as const) {
      if (Math.abs(presentation.geometry[key] - expected[key]) > 1e-6) {
        throw new Error(`Surface overlay geometry for ${finding.findingId} does not match its measured component.`);
      }
    }
  }
}

function severityBand(
  category: FinalMathematicalGradeV1["findings"][number]["category"],
  normalizedSeverity: number,
): "low" | "medium" | "high" {
  const breakpoints = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.findings[category].severityBreakpoints;
  return normalizedSeverity >= breakpoints.high
    ? "high"
    : normalizedSeverity >= breakpoints.medium
      ? "medium"
      : "low";
}

function requireAssetRole(
  registry: PublicAssetRegistryV1,
  assetId: string,
  side: "front" | "back",
  role: AiGraderMathematicalReportEvidenceRoleV1,
): PublishedAssetV03 {
  const asset = registry.require(assetId);
  if (asset.side !== side || asset.evidenceRole !== role) {
    throw new Error(`Evidence ${assetId} must be the ${side} ${role} artifact.`);
  }
  return asset;
}

async function buildPublishedFindings(
  input: BuildAiGraderMathematicalReportBundleV1Input & { grade: FinalMathematicalGradeV1 },
  registry: PublicAssetRegistryV1,
): Promise<{
  findings: AiGraderPublishedDefectFindingV2[];
  overlayAssetIdByFindingId: Map<string, string>;
}> {
  const presentations = new Map<string, AiGraderMathematicalFindingPresentationV1>();
  for (const presentation of input.findingPresentations) {
    const key = presentation.findingId.toLowerCase();
    if (presentations.has(key)) throw new Error(`Duplicate finding presentation ${presentation.findingId}.`);
    presentations.set(key, presentation);
  }
  if (presentations.size !== input.grade.findings.length) {
    throw new Error("Every and only retained physical finding requires one exact report presentation.");
  }
  const overlayAssetIdByFindingId = new Map<string, string>();
  const findings = await Promise.all(input.grade.findings.map(async (finding) => {
    const presentation = presentations.get(finding.findingId.toLowerCase());
    if (!presentation) throw new Error(`Missing report presentation for ${finding.findingId}.`);
    validateFindingAgainstComputedSources(input, finding, presentation);
    assertFiniteFraction(presentation.confidence, `${finding.findingId} confidence`);
    const sourceEvidenceIds = uniqueCaseInsensitive([
      presentation.trueViewAssetId,
      presentation.segmentationMaskAssetId,
      presentation.confidenceMaskAssetId,
      presentation.illuminationMaskAssetId,
      ...(presentation.heatmapAssetId ? [presentation.heatmapAssetId] : []),
      ...(presentation.surfaceVisionAssetId ? [presentation.surfaceVisionAssetId] : []),
      ...presentation.channelAssetIds,
      ...presentation.roiAssetIds,
      ...(presentation.additionalEvidenceAssetIds ?? []),
    ]);
    requireAssetRole(registry, presentation.trueViewAssetId, finding.side, "normalized_card");
    requireAssetRole(registry, presentation.segmentationMaskAssetId, finding.side, "segmentation_mask");
    requireAssetRole(registry, presentation.confidenceMaskAssetId, finding.side, "confidence_mask");
    requireAssetRole(registry, presentation.illuminationMaskAssetId, finding.side, "illumination_mask");
    presentation.channelAssetIds.forEach((assetId) =>
      requireAssetRole(registry, assetId, finding.side, "directional_channel"));
    presentation.roiAssetIds.forEach((assetId) =>
      requireAssetRole(registry, assetId, finding.side, "roi_crop"));
    (presentation.additionalEvidenceAssetIds ?? []).forEach((assetId) => registry.require(assetId));
    if (!presentation.channelAssetIds.length || !presentation.roiAssetIds.length) {
      throw new Error(`Finding ${finding.findingId} requires directional-channel and exact ROI artifacts.`);
    }
    if (presentation.heatmapAssetId) {
      requireAssetRole(registry, presentation.heatmapAssetId, finding.side, "surface_heatmap");
    }
    if (presentation.surfaceVisionAssetId) {
      requireAssetRole(registry, presentation.surfaceVisionAssetId, finding.side, "surface_vision");
    }
    const sourceEvidenceSet = new Set(sourceEvidenceIds.map((entry) => entry.toLowerCase()));
    for (const measurement of finding.measurements) {
      for (const binding of measurement.evidence) {
        const asset = registry.require(binding.assetId);
        if (asset.side !== binding.side || asset.sha256?.toLowerCase() !== binding.sha256.toLowerCase()) {
          throw new Error(`Measurement ${measurement.measurementId} has a mismatched immutable evidence binding.`);
        }
        if (measurement.measurementId === finding.deductionBasisMeasurementId &&
            !sourceEvidenceSet.has(binding.assetId.toLowerCase())) {
          throw new Error(`Deduction-basis evidence ${binding.assetId} is not exposed by finding ${finding.findingId}.`);
        }
      }
    }
    const overlayAssetId =
      `${finding.side}/mathematical-v1/findings/${finding.findingId}/deduction-overlay.png`;
    const overlayBytes = await rasterizeGeneratedSvgV1(
      findingOverlaySvg(
        input.calibrationProfile.normalizedWidthPx,
        input.calibrationProfile.normalizedHeightPx,
        finding,
        presentation,
      ),
      input.calibrationProfile.normalizedWidthPx,
      input.calibrationProfile.normalizedHeightPx,
    );
    registry.addGenerated({
      id: overlayAssetId,
      side: finding.side,
      evidenceRole: "deduction_overlay",
      fileName: `${finding.findingId}-deduction-overlay.png`,
      contentType: "image/png",
      bytes: overlayBytes,
      widthPx: input.calibrationProfile.normalizedWidthPx,
      heightPx: input.calibrationProfile.normalizedHeightPx,
    });
    overlayAssetIdByFindingId.set(finding.findingId.toLowerCase(), overlayAssetId);
    return aiGraderPublishedDefectFindingV2Schema.parse({
      schemaVersion: AI_GRADER_DEFECT_FINDING_V2_VERSION,
      mathematicalSchemaVersion: MATHEMATICAL_FINDING_V1_SCHEMA_VERSION,
      findingId: finding.findingId,
      physicalDefectId: finding.physicalDefectId,
      side: finding.side,
      category: finding.category,
      primaryElement: finding.element,
      location: finding.location,
      regionId: finding.regionId,
      detector: {
        ...presentation.detector,
        algorithmVersion: finding.algorithmVersion,
      },
      thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
      thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
      calibrationProfileId: finding.calibrationProfileId,
      calibrationVersion: finding.calibrationVersion,
      severity: {
        normalized: finding.normalizedSeverity,
        band: severityBand(finding.category, finding.normalizedSeverity),
      },
      confidence: presentation.confidence,
      evidenceQuality: presentation.evidenceQuality,
      geometry: {
        coordinateFrame: "normalized_card",
        units: "fraction",
        shape: presentation.geometry,
      },
      evidence: {
        trueViewAssetId: presentation.trueViewAssetId,
        overlayAssetId,
        segmentationMaskAssetId: presentation.segmentationMaskAssetId,
        confidenceMaskAssetId: presentation.confidenceMaskAssetId,
        illuminationMaskAssetId: presentation.illuminationMaskAssetId,
        ...(presentation.heatmapAssetId ? { heatmapAssetId: presentation.heatmapAssetId } : {}),
        ...(presentation.surfaceVisionAssetId
          ? { surfaceVisionAssetId: presentation.surfaceVisionAssetId }
          : {}),
        channelAssetIds: uniqueCaseInsensitive(presentation.channelAssetIds),
        roiAssetIds: uniqueCaseInsensitive(presentation.roiAssetIds),
        ...(presentation.additionalEvidenceAssetIds?.length
          ? { additionalEvidenceAssetIds: uniqueCaseInsensitive(presentation.additionalEvidenceAssetIds) }
          : {}),
      },
      measurements: finding.measurements,
      deductionBasisMeasurementId: finding.deductionBasisMeasurementId,
      deduction: finding.deduction,
      ...(finding.severeDefectCap === undefined
        ? {}
        : { severeDefectCap: finding.severeDefectCap }),
      secondaryEvidenceCategories: uniqueCaseInsensitive(presentation.secondaryEvidenceCategories),
      explanation: finding.explanation,
      review: presentation.review,
    });
  }));
  return { findings, overlayAssetIdByFindingId };
}

function assertFinalSourceContract(
  input: BuildAiGraderMathematicalReportBundleV1Input,
): asserts input is BuildAiGraderMathematicalReportBundleV1Input & {
  grade: FinalMathematicalGradeV1;
  centering: ComputedCenteringV1;
} {
  const calibration = validateMathematicalCalibrationForOperationalUseV1(input.calibrationProfile);
  if (!calibration.valid || (!calibration.isCalibrated && !calibration.isOperationallyAccepted)) {
    throw new Error(
      `Calibrated V1 report rejected: ${calibration.issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("; ") || "the physical calibration is not finalized"}.`,
    );
  }
  if (input.grade.status !== "final_mathematical_grade_v1") {
    throw new Error(
      "Calibrated V1 report rejected: all four measured elements are mandatory; no V0 or manual-grade fallback is permitted.",
    );
  }
  if (input.centering.status !== "computed" || input.corners.status !== "computed" ||
      input.edges.status !== "computed" || input.surface.front.status !== "computed" ||
      input.surface.back.status !== "computed") {
    throw new Error("Calibrated V1 report rejected: incomplete or recapture-required physical evidence remains.");
  }
  if (
    input.grade.v0FallbackUsed !== false ||
    input.grade.thresholdSetId !== MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID ||
    input.grade.thresholdSetHash !== MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH ||
    input.grade.calibration.profileId !== input.calibrationProfile.profileId ||
    input.grade.calibration.version !== input.calibrationProfile.calibrationVersion ||
    input.grade.calibration.artifactSha256.toLowerCase() !== input.calibrationProfile.artifactSha256.toLowerCase()
  ) {
    throw new Error("Calibrated V1 report rejected: grade, threshold manifest, and finalized calibration identity do not match.");
  }
  if (
    input.centering.score !== input.grade.elements.centering.score ||
    input.corners.score !== input.grade.elements.corners.score ||
    input.edges.score !== input.grade.elements.edges.score
  ) {
    throw new Error("Calibrated V1 report rejected: composed element scores do not match their exact measured source results.");
  }
  if (input.surface.front.evidenceQualityLimitations.length ||
      input.surface.back.evidenceQualityLimitations.length) {
    throw new Error("Calibrated V1 report rejected: surface evidence still requires recapture and cannot receive a final grade.");
  }
}

function reportElement(
  element: MathematicalGradingElementV1,
  grade: FinalMathematicalGradeV1,
  confidence: AiGraderMathematicalReportConfidenceV1,
  observations: readonly AiGraderMathematicalConditionObservationPresentationV1[],
): AiGraderReportBundleV03["productionRelease"]["finalGrade"]["elements"][MathematicalGradingElementV1] {
  const source = grade.elements[element];
  const validatedConfidence = validateConfidence(confidence, element);
  return {
    score: source.score,
    startingScore: 10,
    frontScore: source.frontScore,
    backScore: source.backScore,
    aggregatePenalty: source.aggregatePenalty,
    locationScores: source.locationScores.map((location) => {
      const observation = observations.find((entry) =>
        entry.element === element &&
        entry.side === location.side &&
        entry.location === location.location
      );
      return {
        side: location.side,
        location: location.location,
        score: location.score,
        penalty: location.penalty,
        findingIds: [...location.findingIds],
        confidence: observation
          ? {
              score: Math.min(validatedConfidence.score, observation.validEvidenceCoverage),
              band: reportConfidenceBand(
                Math.min(validatedConfidence.score, observation.validEvidenceCoverage),
              ),
              validEvidenceCoverage: observation.validEvidenceCoverage,
              warnings: [...validatedConfidence.warnings],
            }
          : { ...validatedConfidence, warnings: [...validatedConfidence.warnings] },
      };
    }),
    findingIds: [...source.findingIds],
    confidence: validatedConfidence,
    formula: source.formula,
    explanation: source.explanation,
  };
}

function conditionObservationEvidence(
  input: BuildAiGraderMathematicalReportBundleV1Input & { grade: FinalMathematicalGradeV1 },
  registry: PublicAssetRegistryV1,
): AiGraderReportBundleV03["conditionObservationEvidence"] {
  const expectedCount =
    MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.corners.requiredObservationCount +
    MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.edges.requiredObservationCount;
  if (input.conditionObservationPresentations.length !== expectedCount) {
    throw new Error("Every one of the eight corner and eight edge observations requires exact report evidence.");
  }
  const seen = new Set<string>();
  const observations = input.conditionObservationPresentations.map((observation) => {
    assertFiniteFraction(
      observation.validEvidenceCoverage,
      `${observation.side} ${observation.element} ${observation.location} valid evidence coverage`,
    );
    const key = `${observation.element}:${observation.side}:${observation.location}`.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate physical observation report evidence ${key}.`);
    seen.add(key);
    const location = input.grade.elements[observation.element].locationScores.find((entry) =>
      entry.side === observation.side && entry.location === observation.location
    );
    const findings = input.grade.findings.filter((finding) =>
      finding.element === observation.element &&
      finding.side === observation.side &&
      finding.location === observation.location
    );
    const findingIds = uniqueCaseInsensitive(findings.map((finding) => finding.findingId));
    const measurementIds = uniqueCaseInsensitive(
      findings.flatMap((finding) =>
        finding.measurements.map((measurement) => measurement.measurementId),
      ),
    );
    if (
      !location ||
      observation.score !== location.score ||
      observation.penalty !== location.penalty ||
      !compareStringSets(observation.findingIds, findingIds) ||
      !compareStringSets(observation.measurementIds, measurementIds) ||
      findings.some((finding) => finding.regionId !== observation.regionId)
    ) {
      throw new Error(
        `Observation evidence ${key} does not match its exact measured location, findings, and deductions.`,
      );
    }
    requireAssetRole(registry, observation.roiAssetId, observation.side, "roi_crop");
    requireAssetRole(
      registry,
      observation.segmentationMaskAssetId,
      observation.side,
      "segmentation_mask",
    );
    requireAssetRole(
      registry,
      observation.confidenceMaskAssetId,
      observation.side,
      "confidence_mask",
    );
    requireAssetRole(
      registry,
      observation.illuminationMaskAssetId,
      observation.side,
      "illumination_mask",
    );
    const channelIds = uniqueCaseInsensitive(observation.channelAssetIds);
    if (
      channelIds.length !==
        MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.calibrationAcceptance.requiredChannelCount ||
      observation.usableDirectionalChannelCount > channelIds.length
    ) {
      throw new Error(`Observation evidence ${key} must expose every calibrated directional channel.`);
    }
    channelIds.forEach((assetId) =>
      requireAssetRole(registry, assetId, observation.side, "directional_channel"));
    return {
      ...observation,
      findingIds,
      measurementIds,
      channelAssetIds: channelIds,
    };
  });
  return {
    corners: observations.filter((entry) => entry.element === "corners"),
    edges: observations.filter((entry) => entry.element === "edges"),
  };
}

function publicWhyNot10(
  grade: FinalMathematicalGradeV1,
  centeringEvidence: AiGraderReportBundleV03["centeringEvidence"],
  overlayAssetIdByFindingId: ReadonlyMap<string, string>,
): AiGraderReportBundleV03["productionRelease"]["finalGrade"]["whyNot10"] {
  return grade.whyNot10.map((reason) => {
    const overlayAssetIds = reason.element === "centering"
      ? [
          centeringEvidence.front.measurementOverlayAssetId,
          centeringEvidence.back.measurementOverlayAssetId,
        ]
      : reason.findingIds.map((findingId) => {
          const overlay = overlayAssetIdByFindingId.get(findingId.toLowerCase());
          if (!overlay) throw new Error(`Why Not 10 cannot find the deduction overlay for ${findingId}.`);
          return overlay;
        });
    if (!overlayAssetIds.length) {
      throw new Error(`Why Not 10 reason ${reason.id} is not linked to an exact measurement overlay.`);
    }
    return {
      id: reason.id,
      element: reason.element,
      findingIds: [...reason.findingIds],
      overlayAssetIds: uniqueCaseInsensitive(overlayAssetIds),
      explanation: reason.explanation,
    };
  });
}

function reportEvidenceLimitations(
  input: readonly AiGraderMathematicalEvidenceQualityLimitationV1[],
  registry: PublicAssetRegistryV1,
): AiGraderReportBundleV03["evidenceQualityLimitations"] {
  return input.map((limitation) => {
    if (limitation.recaptureRequired || limitation.classification === "ungradable") {
      throw new Error(
        `Evidence limitation ${limitation.limitationId} requires recapture and cannot be published as a final calibrated grade.`,
      );
    }
    assertFiniteFraction(limitation.validEvidenceCoverage, `${limitation.limitationId} valid evidence coverage`);
    assertFiniteFraction(limitation.excludedPixelFraction, `${limitation.limitationId} excluded pixel fraction`);
    if (!limitation.evidenceAssetIds.length) {
      throw new Error(`Evidence limitation ${limitation.limitationId} requires immutable confidence/illumination evidence.`);
    }
    const allowedRoles: ReadonlySet<AiGraderMathematicalReportEvidenceRoleV1> =
      limitation.classification === "common_mode_specular_glare"
        ? new Set(["common_mode_response", "illumination_mask", "confidence_mask"])
        : limitation.classification === "low_confidence"
          ? new Set(["confidence_mask"])
          : limitation.classification === "clipping" ||
              limitation.classification === "underexposure"
            ? new Set(["illumination_mask", "confidence_mask"])
            : new Set(["illumination_mask", "confidence_mask", "common_mode_response"]);
    const roles = new Set<AiGraderMathematicalReportEvidenceRoleV1>();
    limitation.evidenceAssetIds.forEach((assetId) => {
      const asset = registry.require(assetId);
      if (
        asset.side !== limitation.side ||
        !asset.evidenceRole ||
        !allowedRoles.has(asset.evidenceRole as AiGraderMathematicalReportEvidenceRoleV1)
      ) {
        throw new Error(
          `Evidence limitation ${limitation.limitationId} cites an asset outside its exact same-side confidence/illumination authority.`,
        );
      }
      roles.add(asset.evidenceRole as AiGraderMathematicalReportEvidenceRoleV1);
    });
    const requiredRole: AiGraderMathematicalReportEvidenceRoleV1 =
      limitation.classification === "common_mode_specular_glare"
        ? "common_mode_response"
        : limitation.classification === "low_confidence"
          ? "confidence_mask"
          : "illumination_mask";
    if (!roles.has(requiredRole)) {
      throw new Error(
        `Evidence limitation ${limitation.limitationId} is missing its exact ${requiredRole} authority.`,
      );
    }
    return {
      limitationId: limitation.limitationId,
      side: limitation.side,
      regionId: limitation.regionId,
      classification: limitation.classification,
      validEvidenceCoverage: limitation.validEvidenceCoverage,
      excludedPixelFraction: limitation.excludedPixelFraction,
      recoveredFromAlternateChannels: limitation.recoveredFromAlternateChannels,
      recaptureRequired: false as const,
      deduction: 0 as const,
      evidenceAssetIds: uniqueCaseInsensitive(limitation.evidenceAssetIds),
      explanation: limitation.explanation,
    };
  });
}

function verifySurfaceSourceEvidence(
  input: BuildAiGraderMathematicalReportBundleV1Input & { grade: FinalMathematicalGradeV1 },
  registry: PublicAssetRegistryV1,
): void {
  for (const side of ["front", "back"] as const) {
    const references = input.surface[side].sourceEvidence;
    const expectedCount = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.calibrationAcceptance.requiredChannelCount;
    const indexes = references.map((reference) => reference.channelIndex);
    if (references.length !== expectedCount || new Set(indexes).size !== expectedCount ||
        indexes.some((index) => index === undefined || index < 1 || index > expectedCount)) {
      throw new Error(`${side} surface replay requires each of the ${expectedCount} immutable directional channels exactly once.`);
    }
    for (const reference of references) {
      const asset = requireAssetRole(registry, reference.assetId, side, "directional_channel");
      if (reference.side !== side || asset.sha256?.toLowerCase() !== reference.sha256.toLowerCase()) {
        throw new Error(`${side} surface channel ${reference.channelIndex} does not match its immutable asset hash.`);
      }
    }
    const composedReferences = input.grade.surfaceSourceEvidence[side];
    if (JSON.stringify(composedReferences) !== JSON.stringify(references)) {
      throw new Error(`${side} public surface replay does not match the exact evidence composed into the grade.`);
    }
  }
}

function buildPokemonStandardCornerAuthorityV1(
  input: BuildAiGraderMathematicalReportBundleV1Input & { grade: FinalMathematicalGradeV1 },
): AiGraderReportBundleV03["pokemonStandardCornerAuthority"] | undefined {
  if (!input.pokemonStandardCornerAuthority) return undefined;
  const verification = input.pokemonStandardCornerAuthorityVerification;
  const verifiedAuthority = verifyTrustedPokemonCardFormatAuthorityV1({
    authority: input.pokemonStandardCornerAuthority,
    hmacKey: verification?.hmacKey,
    expectedKeyId: verification?.keyId,
  });
  if (!input.gradingSessionId) {
    throw new Error("The trusted Pokémon standard profile requires the exact grading session ID.");
  }
  if (input.corners.status !== "computed") {
    throw new Error("The trusted Pokémon standard profile requires eight computed physical corner observations.");
  }
  const measurements = input.corners.observations.map((observation) => {
    const contour = observation.cornerContourDeviation;
    if (!contour) {
      throw new Error(`${observation.side} ${observation.location} has no analyzer-created contour result.`);
    }
    const geometry = input.outerCutGeometryEvidence[observation.side];
    const observed = geometry.observedArtifact;
    return {
      side: observation.side,
      location: observation.location as "top_left" | "top_right" | "bottom_right" | "bottom_left",
      profileId: POKEMON_TCG_STANDARD_CORNER_PROFILE_ID,
      profileVersion: POKEMON_TCG_STANDARD_CORNER_PROFILE_VERSION,
      profileArtifactSha256: POKEMON_TCG_STANDARD_CORNER_PROFILE_SHA256,
      expectedRadiusMm: POKEMON_TCG_STANDARD_CORNER_PROFILE_RADIUS_MM,
      measuredContourDeviationMm: contour.measurement.measuredMeasurement,
      calibratedU95Mm: contour.measurement.u95,
      effectiveContourDeviationMm: contour.measurement.effectiveMeasurement,
      grade10ToleranceMm: contour.measurement.explicitGrade10Tolerance,
      thresholdDecision: contour.thresholdDecision,
      thresholdDeduction: contour.thresholdDeduction,
      appliedContourDeduction: contour.appliedContourDeduction,
      measurementId: contour.measurement.measurementId,
      sourceImageAssetId: observed.rawAllOnAssetId,
      sourceImageSha256: observed.rawAllOnAssetSha256,
      observedContourSha256: observed.artifactSha256,
      intendedContourSha256: observed.intendedBoundaryArtifactSha256,
      contourFindingIds: [...contour.contourFindingIds],
      damageFindingIds: {
        whitening: [...contour.damageFindingIds.whitening],
        chippingOrMaterialLoss: [...contour.damageFindingIds.chippingOrMaterialLoss],
        deformation: [...contour.damageFindingIds.deformation],
        delamination: [...contour.damageFindingIds.delamination],
        otherVisibleDamage: [...contour.damageFindingIds.otherVisibleDamage],
      },
    };
  });
  const measurementArtifact = {
    gradingSessionId: input.gradingSessionId,
    reportId: input.reportId,
    analyzerVersions: {
      conditionSegmentation: "fixed_rig_condition_segmentation_v1.2.0" as const,
      cornerMeasurement: "fixed_rig_corner_edge_v1" as const,
      stationAdapter: "fixed_rig_mathematical_station_adapter_v1" as const,
    },
    thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
    thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    calibration: {
      profileId: input.calibrationProfile.profileId,
      version: input.calibrationProfile.calibrationVersion,
      artifactSha256: input.calibrationProfile.artifactSha256,
      bundleManifestSha256: input.calibrationBundleAuthority.bundleManifestSha256,
      sourceCaptureManifestSha256: input.calibrationBundleAuthority.sourceCaptureManifestSha256,
      memberLedgerSha256: input.calibrationBundleAuthority.memberLedgerSha256,
    },
    callerCreatedProfilesAccepted: false as const,
    callerCreatedMeasurementsAccepted: false as const,
    measurements,
  };
  const measurementArtifactBytes = canonicalJsonV1(measurementArtifact);
  return {
    profile: POKEMON_TCG_STANDARD_CORNER_PROFILE,
    profileArtifactSha256: POKEMON_TCG_STANDARD_CORNER_PROFILE_SHA256,
    trustedCardFormatAuthority: verifiedAuthority,
    productionMeasurementAuthority: {
      schemaVersion: POKEMON_TCG_STANDARD_MEASUREMENT_AUTHORITY_SCHEMA_VERSION,
      artifact: measurementArtifact,
      artifactSha256: sha256(Buffer.from(measurementArtifactBytes, "utf8")),
      authentication: {
        algorithm: "hmac-sha256",
        keyId: verification!.keyId,
        signature: createHmac("sha256", verification!.hmacKey)
          .update(POKEMON_TCG_STANDARD_MEASUREMENT_AUTHENTICATION_DOMAIN, "utf8")
          .update(measurementArtifactBytes, "utf8")
          .digest("hex"),
      },
    },
  };
}

/**
 * Builds the public Mathematical Grading V1 artifact only from finalized,
 * physically calibrated evidence. The function intentionally has no V0 path:
 * incomplete evidence throws before any report artifact is returned.
 */
export async function buildAiGraderMathematicalReportBundleV1(
  input: BuildAiGraderMathematicalReportBundleV1Input,
): Promise<AiGraderMathematicalReportBundleV1Artifact> {
  assertFinalSourceContract(input);
  verifyCalibrationBundleAuthorityV1(input.calibrationBundleAuthority);
  const registry = new PublicAssetRegistryV1(input.reportId);
  input.assetBindings.forEach((binding) => registry.addBinding(binding));
  verifySurfaceSourceEvidence(input, registry);

  const centeringEvidence = await addCenteringAssetsAndEvidence(
    registry,
    input.centering,
    input.calibrationProfile,
    input.outerCutGeometryEvidence,
  );
  const { findings, overlayAssetIdByFindingId } = await buildPublishedFindings(input, registry);
  const observationEvidence = conditionObservationEvidence(input, registry);
  for (const entry of input.grade.deductionLedger.entries) {
    entry.evidenceAssetIds.forEach((assetId) => registry.require(assetId));
  }
  const evidenceQualityLimitations = reportEvidenceLimitations(
    input.evidenceQualityLimitations ?? [],
    registry,
  );
  const whyNot10 = publicWhyNot10(input.grade, centeringEvidence, overlayAssetIdByFindingId);
  const overallConfidence = validateConfidence(input.confidence.overall, "overall");
  const pokemonStandardCornerAuthority = buildPokemonStandardCornerAuthorityV1(input);
  const rawBundle = {
    schemaVersion: AI_GRADER_REPORT_BUNDLE_V03_VERSION,
    generatedAt: input.generatedAt,
    reportId: input.reportId,
    certifiedClaim: false,
    cardIdentity: input.cardIdentity,
    gradingStandard: {
      id: "mathematical_calibration_v1",
      thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
      thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
      algorithmVersion: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.algorithmVersion,
      defectFindingSchemaVersion: AI_GRADER_DEFECT_FINDING_V2_VERSION,
      designReferenceSchemaVersion: MATHEMATICAL_DESIGN_REFERENCE_V1_SCHEMA_VERSION,
    },
    ...(pokemonStandardCornerAuthority ? { pokemonStandardCornerAuthority } : {}),
    productionRelease: {
      finalGrade: {
        status: "final_mathematical_grade_v1",
        overall: input.grade.overall,
        labelGrade: input.grade.labelGrade,
        weightedGrade: input.grade.weightedGrade,
        weakestElement: input.grade.weakestElement,
        weakestScore: input.grade.weakestScore,
        weakestElementCap: input.grade.weakestElementCap,
        ...(input.grade.applicableSevereDefectCap === undefined
          ? {}
          : { applicableSevereDefectCap: input.grade.applicableSevereDefectCap }),
        elements: {
          centering: reportElement(
            "centering",
            input.grade,
            input.confidence.elements.centering,
            input.conditionObservationPresentations,
          ),
          corners: reportElement(
            "corners",
            input.grade,
            input.confidence.elements.corners,
            input.conditionObservationPresentations,
          ),
          edges: reportElement(
            "edges",
            input.grade,
            input.confidence.elements.edges,
            input.conditionObservationPresentations,
          ),
          surface: reportElement(
            "surface",
            input.grade,
            input.confidence.elements.surface,
            input.conditionObservationPresentations,
          ),
        },
        confidence: overallConfidence,
        weights: { ...MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.overall.weights },
        weightedFormula: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.overall.weightedFormula,
        formula: input.grade.formula,
        whyNot10,
      },
      label: {
        certId: input.publication.certId,
        labelGradeText: input.grade.labelGradeText,
        publicReportUrl: input.publication.publicReportUrl,
        qrPayloadUrl: input.publication.qrPayloadUrl,
      },
      publication: { publicReportUrl: input.publication.publicReportUrl },
    },
    calibrationProfile: input.calibrationProfile,
    ...(input.calibrationActivationAuthority ? { calibrationActivationAuthority: input.calibrationActivationAuthority } : {}),
    calibrationBundleAuthority: input.calibrationBundleAuthority,
    designReferences: input.designReferences,
    centeringEvidence,
    conditionObservationEvidence: observationEvidence,
    defectFindings: findings,
    deductionLedger: input.grade.deductionLedger,
    evidenceQualityLimitations,
    publicAssets: registry.listAssets(),
    ...(input.geometry ? { geometry: input.geometry } : {}),
    ...(input.geometryCaptureDecisions
      ? { geometryCaptureDecisions: input.geometryCaptureDecisions }
      : {}),
    ...(input.captureTiming ? { captureTiming: input.captureTiming } : {}),
    ...(input.ocrPrefill ? { ocrPrefill: input.ocrPrefill } : {}),
    ...(input.warnings?.length ? { warnings: [...input.warnings] } : {}),
    ...(input.limitations?.length ? { limitations: [...input.limitations] } : {}),
  };
  const parsed = aiGraderReportBundleV03Schema.safeParse(rawBundle);
  if (!parsed.success) {
    throw new Error(
      `Calibrated V1 report contract rejected the artifact: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return {
    adapterVersion: AI_GRADER_MATHEMATICAL_REPORT_ADAPTER_V1_VERSION,
    bundle: parsed.data,
    assetPayloads: registry.listPayloads(),
  };
}
