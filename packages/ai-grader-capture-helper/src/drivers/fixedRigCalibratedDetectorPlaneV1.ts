import { createHash } from "node:crypto";
import {
  mathematicalEvidenceReferenceV1Schema,
  type MathematicalMeasurementV1,
} from "@tenkings/shared";
import type { FixedRigScalarPlaneV1 } from "./fixedRigPhotometricEvidenceV1";

export const FIXED_RIG_CALIBRATED_DETECTOR_PLANE_V1_VERSION =
  "fixed_rig_calibrated_detector_plane_v1" as const;

const MAGIC = Buffer.from("TKPLN1\r\n", "ascii");
const HEADER_LENGTH_BYTES = 4;
const MAX_HEADER_BYTES = 1024 * 1024;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ASSET_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,299}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export const FIXED_RIG_CONDITION_DETECTOR_PLANE_NAMES_V1 = [
  "expectedOuterCardMask",
  "materialPresenceConfidence",
  "segmentationConfidence",
  "boundaryConfidence",
  "exposedFiberResponse",
  "boundaryDeviationMm",
  "deformationResponse",
  "delaminationResponse",
  "edgeRoughnessIndex",
  "frayingResponse",
  "scratchLineResponse",
  "scuffTextureResponse",
  "creaseLineResponse",
  "chipDepthMm",
  "reliefIndex",
  "depthMm",
  "registeredColorDeltaE",
  "registeredPrintDeltaE",
  "registeredResidueDeltaE",
] as const;

export type FixedRigConditionDetectorPlaneNameV1 =
  typeof FIXED_RIG_CONDITION_DETECTOR_PLANE_NAMES_V1[number];

export type FixedRigDetectorPlaneDerivationV1 =
  | "normalized_physical_segmentation"
  | "directional_photometric_response"
  | "approved_design_reference_comparison"
  | "fused_calibrated_detector";

type EvidenceReferenceV1 = MathematicalMeasurementV1["evidence"][number];

/**
 * Immutable metadata embedded in the same checksum-bound binary as the plane.
 * The artifact deliberately cannot describe a rendered heatmap or a manual
 * override as detector evidence.
 */
export interface FixedRigCalibratedDetectorPlaneHeaderV1 {
  schemaVersion: typeof FIXED_RIG_CALIBRATED_DETECTOR_PLANE_V1_VERSION;
  assetId: string;
  side: "front" | "back";
  planeName: FixedRigConditionDetectorPlaneNameV1;
  coordinateFrame: "normalized_card_portrait_pixels";
  width: number;
  height: number;
  dataType: "float32le";
  detector: {
    id: string;
    version: string;
  };
  calibration: {
    profileId: string;
    version: string;
    sha256: string;
  };
  derivation: FixedRigDetectorPlaneDerivationV1;
  sourceEvidence: EvidenceReferenceV1[];
  heatmapUsedAsInput: false;
  manualOverrideUsed: false;
}

export interface FixedRigCalibratedDetectorPlaneArtifactV1 {
  header: FixedRigCalibratedDetectorPlaneHeaderV1;
  plane: FixedRigScalarPlaneV1;
  fileSha256: string;
  fileBytes: Buffer;
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

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}

function assertExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} has missing or unsupported fields.`);
  }
}

function assertHeader(value: unknown): asserts value is FixedRigCalibratedDetectorPlaneHeaderV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Calibrated detector plane header must be one object.");
  }
  const header = value as Record<string, unknown>;
  assertExactKeys(header, [
    "schemaVersion",
    "assetId",
    "side",
    "planeName",
    "coordinateFrame",
    "width",
    "height",
    "dataType",
    "detector",
    "calibration",
    "derivation",
    "sourceEvidence",
    "heatmapUsedAsInput",
    "manualOverrideUsed",
  ], "Calibrated detector plane header");
  if (
    header.schemaVersion !== FIXED_RIG_CALIBRATED_DETECTOR_PLANE_V1_VERSION ||
    typeof header.assetId !== "string" || !ASSET_ID.test(header.assetId) ||
    (header.side !== "front" && header.side !== "back") ||
    !FIXED_RIG_CONDITION_DETECTOR_PLANE_NAMES_V1.includes(
      header.planeName as FixedRigConditionDetectorPlaneNameV1,
    ) ||
    header.coordinateFrame !== "normalized_card_portrait_pixels" ||
    !Number.isSafeInteger(header.width) || Number(header.width) <= 0 ||
    !Number.isSafeInteger(header.height) || Number(header.height) <= 0 ||
    Number(header.width) * Number(header.height) > 100_000_000 ||
    header.dataType !== "float32le" ||
    ![
      "normalized_physical_segmentation",
      "directional_photometric_response",
      "approved_design_reference_comparison",
      "fused_calibrated_detector",
    ].includes(String(header.derivation)) ||
    header.heatmapUsedAsInput !== false ||
    header.manualOverrideUsed !== false
  ) {
    throw new Error("Calibrated detector plane header violates the V1 physical-evidence contract.");
  }
  if (!header.detector || typeof header.detector !== "object" || Array.isArray(header.detector)) {
    throw new Error("Calibrated detector plane requires immutable detector identity.");
  }
  const detector = header.detector as Record<string, unknown>;
  assertExactKeys(detector, ["id", "version"], "Calibrated detector identity");
  if (
    typeof detector.id !== "string" || !IDENTIFIER.test(detector.id) ||
    typeof detector.version !== "string" || !IDENTIFIER.test(detector.version)
  ) {
    throw new Error("Calibrated detector identity is invalid.");
  }
  if (!header.calibration || typeof header.calibration !== "object" || Array.isArray(header.calibration)) {
    throw new Error("Calibrated detector plane requires finalized calibration identity.");
  }
  const calibration = header.calibration as Record<string, unknown>;
  assertExactKeys(calibration, ["profileId", "version", "sha256"], "Detector plane calibration");
  if (
    typeof calibration.profileId !== "string" || !IDENTIFIER.test(calibration.profileId) ||
    typeof calibration.version !== "string" || !IDENTIFIER.test(calibration.version) ||
    typeof calibration.sha256 !== "string" || !SHA256.test(calibration.sha256)
  ) {
    throw new Error("Calibrated detector plane calibration identity is invalid.");
  }
  if (!Array.isArray(header.sourceEvidence) || header.sourceEvidence.length === 0 ||
      header.sourceEvidence.length > 64) {
    throw new Error("Calibrated detector plane requires one through 64 immutable source references.");
  }
  const roles = new Set<string>();
  for (const reference of header.sourceEvidence) {
    const parsed = mathematicalEvidenceReferenceV1Schema.safeParse(reference);
    if (!parsed.success || parsed.data.side !== header.side ||
        !["all_on", "normalized_card", "design_reference", "directional_channel"].includes(parsed.data.role)) {
      throw new Error("Calibrated detector plane source evidence is invalid or unsupported.");
    }
    roles.add(parsed.data.role);
  }
  if (header.derivation === "normalized_physical_segmentation" && !roles.has("normalized_card")) {
    throw new Error("Normalized physical segmentation must bind the exact normalized card.");
  }
  if (header.derivation === "directional_photometric_response" && !roles.has("directional_channel")) {
    throw new Error("Directional detector evidence must bind at least one exact directional channel.");
  }
  if (header.derivation === "approved_design_reference_comparison" && !roles.has("design_reference")) {
    throw new Error("Registered design comparison must bind the exact approved design artifact.");
  }
  if (header.derivation === "fused_calibrated_detector" &&
      (!roles.has("all_on") || !roles.has("normalized_card") ||
       !roles.has("directional_channel"))) {
    throw new Error("Fused detector evidence must bind all-on, normalized, and directional sources; an approved design reference is additionally bound only when used.");
  }
}

function buildBytes(
  header: FixedRigCalibratedDetectorPlaneHeaderV1,
  plane: FixedRigScalarPlaneV1,
): Buffer {
  assertHeader(header);
  if (
    plane.width !== header.width || plane.height !== header.height ||
    plane.data.length !== header.width * header.height
  ) {
    throw new Error("Calibrated detector plane dimensions do not match its immutable header.");
  }
  const headerBytes = Buffer.from(canonicalJson(header), "utf8");
  if (headerBytes.byteLength > MAX_HEADER_BYTES) {
    throw new Error("Calibrated detector plane header is too large.");
  }
  const dataBytes = Buffer.allocUnsafe(plane.data.length * 4);
  for (let index = 0; index < plane.data.length; index += 1) {
    const value = Number(plane.data[index]);
    if (!Number.isFinite(value)) throw new Error("Calibrated detector plane contains a non-finite value.");
    dataBytes.writeFloatLE(value, index * 4);
  }
  const lengthBytes = Buffer.alloc(HEADER_LENGTH_BYTES);
  lengthBytes.writeUInt32LE(headerBytes.byteLength, 0);
  return Buffer.concat([MAGIC, lengthBytes, headerBytes, dataBytes]);
}

export function encodeFixedRigCalibratedDetectorPlaneV1(input: {
  header: FixedRigCalibratedDetectorPlaneHeaderV1;
  plane: FixedRigScalarPlaneV1;
}): Buffer {
  return buildBytes(input.header, input.plane);
}

export function decodeFixedRigCalibratedDetectorPlaneV1(
  fileBytes: Uint8Array,
): FixedRigCalibratedDetectorPlaneArtifactV1 {
  const bytes = Buffer.from(fileBytes);
  if (bytes.byteLength < MAGIC.byteLength + HEADER_LENGTH_BYTES ||
      !bytes.subarray(0, MAGIC.byteLength).equals(MAGIC)) {
    throw new Error("Calibrated detector plane file has an invalid V1 signature.");
  }
  const headerLength = bytes.readUInt32LE(MAGIC.byteLength);
  if (headerLength <= 0 || headerLength > MAX_HEADER_BYTES) {
    throw new Error("Calibrated detector plane header length is invalid.");
  }
  const headerStart = MAGIC.byteLength + HEADER_LENGTH_BYTES;
  const headerEnd = headerStart + headerLength;
  if (headerEnd > bytes.byteLength) throw new Error("Calibrated detector plane file is truncated.");
  const headerJson = bytes.subarray(headerStart, headerEnd).toString("utf8");
  let header: unknown;
  try {
    header = JSON.parse(headerJson);
  } catch {
    throw new Error("Calibrated detector plane header is not valid UTF-8 JSON.");
  }
  assertHeader(header);
  if (headerJson !== canonicalJson(header)) {
    throw new Error("Calibrated detector plane header is not canonical JSON.");
  }
  const expectedDataLength = header.width * header.height * 4;
  if (bytes.byteLength - headerEnd !== expectedDataLength) {
    throw new Error("Calibrated detector plane payload length does not match its dimensions.");
  }
  const data = new Float32Array(header.width * header.height);
  for (let index = 0; index < data.length; index += 1) {
    const value = bytes.readFloatLE(headerEnd + index * 4);
    if (!Number.isFinite(value)) throw new Error("Calibrated detector plane contains a non-finite value.");
    data[index] = value;
  }
  return {
    header,
    plane: { width: header.width, height: header.height, data },
    fileSha256: createHash("sha256").update(bytes).digest("hex"),
    fileBytes: bytes,
  };
}
