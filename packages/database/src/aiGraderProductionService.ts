import { createHash } from "crypto";
import { Prisma } from "@prisma/client";

type JsonRecord = Record<string, unknown>;

export type AiGraderProductionPublicationStatus =
  | "draft"
  | "finalized"
  | "published"
  | "unpublished"
  | "revoked"
  | "error";

export type AiGraderValuationStatus =
  | "not_ready_missing_grade"
  | "not_ready_missing_identity"
  | "ready"
  | "running"
  | "completed"
  | "failed";

export type AiGraderProductionDbDelegate = {
  upsert(args: unknown): Promise<unknown>;
  findUnique?(args: unknown): Promise<unknown | null>;
  findMany?(args: unknown): Promise<unknown[]>;
  updateMany?(args: unknown): Promise<{ count: number }>;
};

export type AiGraderProductionTransactionClient = {
  $queryRaw?: (...args: any[]) => Promise<unknown>;
  aiGraderSession: AiGraderProductionDbDelegate;
  aiGraderReport: AiGraderProductionDbDelegate;
  aiGraderEvidenceAsset: AiGraderProductionDbDelegate;
  aiGraderGrade: AiGraderProductionDbDelegate;
  aiGraderLabel: AiGraderProductionDbDelegate;
  aiGraderPublication: AiGraderProductionDbDelegate;
  aiGraderValuation: AiGraderProductionDbDelegate;
  cardAsset?: Pick<AiGraderProductionDbDelegate, "updateMany">;
  item?: Pick<AiGraderProductionDbDelegate, "findUnique" | "updateMany">;
};

export type AiGraderProductionPrismaClient = AiGraderProductionTransactionClient & {
  $transaction?: <T>(fn: (tx: AiGraderProductionTransactionClient) => Promise<T>) => Promise<T>;
};

export type AiGraderProductionReportBundleLike = JsonRecord & {
  gradingSessionId?: string;
  reportId?: string;
  generatedAt?: string;
  reportStatus?: string;
  cardIdentity?: JsonRecord;
  provisionalGrade?: JsonRecord;
  evidenceReferences?: JsonRecord;
  visionLab?: JsonRecord;
  calibrationProfile?: JsonRecord;
  rulerCalibration?: JsonRecord;
  lightingProfile?: JsonRecord;
  geometry?: JsonRecord;
  geometryCaptureDecisions?: JsonRecord;
  captureTiming?: JsonRecord;
  ocrPrefill?: JsonRecord;
  assets?: unknown[];
  publicAssets?: unknown[];
  warnings?: unknown[];
};

export type AiGraderProductionReleaseLike = JsonRecord & {
  gradingSessionId?: string;
  reportId?: string;
  reportStatus?: string;
  finalStatus?: string;
  finalGradeComputed?: boolean;
  finalGrade?: JsonRecord;
  label?: JsonRecord;
  publication?: JsonRecord;
  operatorFinalization?: JsonRecord;
  gates?: unknown[];
  warnings?: unknown[];
  slabbedPhotoContract?: JsonRecord;
  ebayCompsContract?: JsonRecord;
  cardInventoryLinkage?: JsonRecord;
};

export type AiGraderProductionArtifactPlan = {
  artifactId: string;
  artifactClass:
    | "report_bundle"
    | "production_release"
    | "label_data"
    | "publication_manifest"
    | "integration_contract"
    | "asset_manifest"
    | "checksums"
    | "label_preview"
    | "report_asset";
  kind: string;
  storageKey: string;
  contentType: string;
  body?: string;
  bodyEncoding?: "utf8" | "base64";
  checksumSha256: string;
  byteSize: number;
  publicUrl?: string;
  sourceAssetId?: string;
};

export type AiGraderProductionStoragePlan = {
  storageKeyPrefix: string;
  publicReportUrl: string;
  qrPayloadUrl: string;
  artifacts: AiGraderProductionArtifactPlan[];
  assetManifest: Array<{
    artifactId: string;
    kind: string;
    storageKey: string;
    checksumSha256: string;
    byteSize: number;
    publicUrl?: string;
  }>;
};

export type AiGraderProductionActorAudit = JsonRecord & {
  actorType: "human_operator" | "service_account";
  action: string;
  requestedAt: string;
  userId?: string | null;
  serviceAccountId?: string | null;
  role?: string | null;
};

export type AiGraderProductionPersistInput = {
  tenantId: string;
  reportBundle: AiGraderProductionReportBundleLike;
  productionRelease: AiGraderProductionReleaseLike;
  storagePlan: AiGraderProductionStoragePlan;
  publicationStatus?: AiGraderProductionPublicationStatus;
  operatorUserId?: string | null;
  cardAssetId?: string | null;
  itemId?: string | null;
  actorAudit?: AiGraderProductionActorAudit | null;
  persistedAt?: string | Date;
};

export type AiGraderProductionPersistResult = {
  gradingSessionId: string;
  reportId: string;
  publicationStatus: AiGraderProductionPublicationStatus;
  session: unknown;
  report: unknown;
  grade: unknown;
  label: unknown;
  publication: unknown;
  valuation: unknown;
  evidenceAssetCount: number;
  cardAssetUpdatedCount: number;
  itemUpdatedCount: number;
  storagePlan: AiGraderProductionStoragePlan;
};

export type AiGraderCardItemSelection = {
  source: "card_asset" | "item" | "manual_draft";
  cardAssetId?: string | null;
  itemId?: string | null;
  title?: string | null;
  set?: string | null;
  cardNumber?: string | null;
  category?: string | null;
  imageUrl?: string | null;
  details?: JsonRecord;
};

export type AiGraderSlabbedPhotoSide = "front" | "back";

export type AiGraderSlabbedPhotoPersistInput = {
  tenantId: string;
  reportId: string;
  side: AiGraderSlabbedPhotoSide;
  storageKey: string;
  publicUrl: string;
  mimeType: string;
  byteSize: number;
  checksumSha256?: string | null;
  widthPx?: number | null;
  heightPx?: number | null;
  operatorUserId?: string | null;
  uploadedAt?: string | Date;
  metadata?: JsonRecord;
  actorAudit?: AiGraderProductionActorAudit | null;
};

export type AiGraderSlabbedPhotoPersistResult = {
  reportId: string;
  artifactId: string;
  side: AiGraderSlabbedPhotoSide;
  storageKey: string;
  publicUrl: string;
  asset: unknown;
};

export type AiGraderValuationPersistInput = {
  tenantId: string;
  reportId: string;
  status: AiGraderValuationStatus;
  source?: string;
  searchQuery?: string | null;
  compsRefs?: unknown;
  resultSummary?: unknown;
  valuationMinor?: number | null;
  valuationCurrency?: string | null;
  requestedByUserId?: string | null;
  actorAudit?: AiGraderProductionActorAudit | null;
  requestedAt?: string | Date;
  completedAt?: string | Date | null;
  errorCode?: string | null;
};

export type AiGraderValuationPersistResult = {
  reportId: string;
  status: AiGraderValuationStatus;
  valuation: unknown;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function trimmedString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function positiveIntegerValue(value: unknown) {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : undefined;
}

function dateValue(value: string | Date | undefined, fallback = new Date()) {
  if (value instanceof Date) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallback;
}

function json(value: unknown): Prisma.InputJsonValue {
  if (value === undefined) return {};
  return value as Prisma.InputJsonValue;
}

function nullableJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === undefined || value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

function mergePersistedLabelPayload(existing: unknown, canonical: JsonRecord): Prisma.InputJsonValue {
  const existingPayload = isRecord(existing) ? existing : {};
  return {
    ...existingPayload,
    ...canonical,
    ...(existingPayload.labelSheet !== undefined ? { labelSheet: existingPayload.labelSheet } : {}),
    ...(existingPayload.physicalPrint !== undefined ? { physicalPrint: existingPayload.physicalPrint } : {}),
  } as Prisma.InputJsonValue;
}

function invalidatePersistedLabelPrint(payload: unknown, now: Date): Prisma.InputJsonValue {
  const current = isRecord(payload) ? payload : {};
  const labelSheet = isRecord(current.labelSheet) ? { ...current.labelSheet } : null;
  if (labelSheet) {
    delete labelSheet.printedAt;
    delete labelSheet.printedByUserId;
  }
  return {
    ...current,
    ...(labelSheet ? { labelSheet } : {}),
    physicalPrint: {
      status: "not_printed",
      invalidatedAt: now.toISOString(),
      reason: "printable_label_content_changed",
    },
  } as Prisma.InputJsonValue;
}

function hasProgressedRuntimeValuation(value: unknown) {
  if (!isRecord(value)) return false;
  return ["ready", "running", "completed", "failed"].includes(stringValue(value.status, ""));
}

function actorAuditJson(value: AiGraderProductionActorAudit | null | undefined): JsonRecord | null {
  if (!isRecord(value)) return null;
  return {
    actorType: stringValue(value.actorType, "unknown"),
    action: stringValue(value.action, "unknown"),
    requestedAt: stringValue(value.requestedAt, new Date().toISOString()),
    userId: stringValue(value.userId, "") || null,
    serviceAccountId: stringValue(value.serviceAccountId, "") || null,
    role: stringValue(value.role, "") || null,
  };
}

function withActorAudit(value: unknown, audit: AiGraderProductionActorAudit | null | undefined): JsonRecord {
  const base = isRecord(value) ? value : {};
  const cleanedAudit = actorAuditJson(audit);
  return cleanedAudit ? { ...base, actorAudit: cleanedAudit } : base;
}

export function aiGraderSha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function safeSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "ai-grader-report";
}

function safeAssetFileName(value: string, fallback: string) {
  const normalized = value.replace(/\\/g, "/").split("/").pop() || fallback;
  const cleaned = normalized
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || fallback;
}

function fileExtensionForContentType(contentType: string) {
  const normalized = contentType.toLowerCase();
  if (normalized.includes("image/png")) return ".png";
  if (normalized.includes("image/jpeg")) return ".jpg";
  if (normalized.includes("image/webp")) return ".webp";
  return ".bin";
}

function checksumValue(value: unknown) {
  const text = stringValue(value, "").trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(text) ? text : "";
}

function isImageAssetRecord(asset: JsonRecord) {
  const haystack = `${asset.contentType ?? ""} ${asset.fileName ?? ""} ${asset.id ?? ""} ${asset.kind ?? ""}`.toLowerCase();
  return haystack.includes("image") || /\.(png|jpe?g|webp)$/i.test(String(asset.fileName ?? asset.storageKey ?? asset.id ?? ""));
}

function unsafeAiGraderPublicUrl(value: string) {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const ipv4 = host.split(".").map((part) => Number(part));
    const isIpv4 = ipv4.length === 4 && ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255);
    if (
      host === "localhost" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host === "::" ||
      host.startsWith("::ffff:") ||
      host.startsWith("fc") ||
      host.startsWith("fd") ||
      /^fe[89ab]/.test(host) ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      host.endsWith(".localhost") ||
      (!isIpv4 && !host.includes(".") && !host.includes(":")) ||
      (isIpv4 && (ipv4[0] === 0 || (ipv4[0] === 100 && ipv4[1] >= 64 && ipv4[1] <= 127))) ||
      (isIpv4 && ipv4[0] === 198 && (ipv4[1] === 18 || ipv4[1] === 19)) ||
      (isIpv4 && ipv4[0] >= 224) ||
      host.startsWith("127.") ||
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      host.startsWith("169.254.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) return true;
    const queryKeys = Array.from(parsed.searchParams.keys()).map((key) => key.toLowerCase());
    if (
      queryKeys.some(
        (key) =>
          key === "sig" ||
          key === "access_key" ||
          key.includes("signature") ||
          key.includes("credential") ||
          key.includes("security-token") ||
          key === "token" ||
          key.endsWith("_token") ||
          key.startsWith("x-amz-") ||
          key.startsWith("x-goog-")
      )
    ) return true;
    if (parsed.username || parsed.password) return true;
  } catch {}
  return false;
}

function looksLikeLocalPathOrLoopback(value: string) {
  if (/\b[a-z]:[\\/]/i.test(value) || /\\TenKings\\/i.test(value) || /(^|\s)\\\\[^\\]+\\/i.test(value)) return true;
  if (/(^|[\s('"=:])(\/Users\/|\/home\/|\/root\/|\/tmp\/|\/var\/tmp\/|\/app\/|\/workspace\/)/i.test(value)) return true;
  if (/(^|[\s('"=:])(data|blob):/i.test(value) || /\bfile:\/\//i.test(value)) return true;
  if (
    /x-ai-grader-station-token|stationToken\s*[=:]|service-token|DATABASE_URL|Authorization\s*:\s*Bearer|x-amz-(?:signature|credential|security-token)|x-goog-(?:signature|credential)/i.test(value)
  ) return true;
  if (
    /\b(?:localhost|[a-z0-9-]+\.(?:local|internal|localhost)|0\.0\.0\.0|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|169\.254(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|100\.(?:6[4-9]|[789]\d|1[01]\d|12[0-7])(?:\.\d{1,3}){2}|198\.(?:18|19)(?:\.\d{1,3}){2})(?::\d{1,5})?\b/i.test(value) ||
    /(^|[\s([])(?:\[?::1\]?|fc[0-9a-f:]+|fd[0-9a-f:]+|fe[89ab][0-9a-f:]+)(?::\d{1,5})?(?=$|[\s)\],;])/i.test(value)
  ) return true;
  const embeddedUrls = value.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  return embeddedUrls.some((url) => unsafeAiGraderPublicUrl(url));
}

function unsafeAiGraderPublicKey(entryKey: string) {
  const compact = entryKey.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const credentialKey =
    compact === "bearer" ||
    compact === "authorization" ||
    compact.endsWith("token") ||
    compact.endsWith("apikey") ||
    compact.endsWith("accesskey") ||
    compact.endsWith("accesskeyid") ||
    compact.endsWith("secretkey") ||
    compact.endsWith("privatekey") ||
    compact.endsWith("password") ||
    compact.endsWith("credential") ||
    compact.endsWith("credentials") ||
    compact.includes("secret");
  const hardwareControlKey = new Set([
    "bridgeurl",
    "stationurl",
    "leimachost",
    "leimacport",
    "baslerbridgescript",
    "pylonroot",
    "hardwarecontrol",
    "hardwarecontrols",
    "hardwareaction",
    "hardwareactions",
    "hardwareactionsenabled",
    "cameracontrol",
    "cameracontrols",
    "lightingcontrol",
    "lightingcontrols",
  ]).has(compact);
  return credentialKey || hardwareControlKey;
}

export function sanitizeAiGraderPublicJson<T>(value: T): T {
  function visit(current: unknown, key = ""): unknown {
    if (typeof current === "string") {
      if (looksLikeLocalPathOrLoopback(current)) return undefined;
      return current;
    }
    if (Array.isArray(current)) {
      return current.map((item) => visit(item)).filter((item) => item !== undefined);
    }
    if (isRecord(current)) {
      const next: JsonRecord = {};
      for (const [entryKey, entryValue] of Object.entries(current)) {
        const lowerKey = entryKey.toLowerCase();
        if (
          unsafeAiGraderPublicKey(entryKey) ||
          lowerKey.includes("stationtoken") ||
          lowerKey.includes("bridgetoken") ||
          lowerKey.includes("pairingcode") ||
          lowerKey.includes("presigned") ||
          lowerKey === "uploadurl" ||
          lowerKey === "bodybase64" ||
          lowerKey === "bodyencoding" ||
          lowerKey.includes("secret") ||
          lowerKey.includes("authorization")
        ) continue;
        if (
          lowerKey.includes("local") ||
          lowerKey.endsWith("path") ||
          lowerKey.endsWith("dir") ||
          lowerKey.endsWith("folder")
        ) {
          const cleaned = visit(entryValue, entryKey);
          if (cleaned !== undefined && !looksLikeLocalPathOrLoopback(String(cleaned))) next[entryKey] = cleaned;
          continue;
        }
        const cleaned = visit(entryValue, entryKey);
        if (cleaned !== undefined) next[entryKey] = cleaned;
      }
      return next;
    }
    return current;
  }
  return visit(value) as T;
}

const PUBLIC_GEOMETRY_CAPTURE_MODES = new Set(["detected_geometry", "manual_capture"]);
const PUBLIC_GEOMETRY_PLACEMENT_STATES = new Set(["not_detected", "adjust_card", "ready"]);
const SAFE_GEOMETRY_SOURCE_FRAME_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function publicGeometryTimestamp(value: unknown) {
  if (typeof value !== "string") return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function publicManualBoundaryRect(value: unknown) {
  if (!isRecord(value) || value.coordinateFrame !== "basler_sensor_pixels") return undefined;
  const x = numberValue(value.x);
  const y = numberValue(value.y);
  const width = numberValue(value.width);
  const height = numberValue(value.height);
  if (x === undefined || y === undefined || width === undefined || height === undefined) return undefined;
  if (x < 0 || y < 0 || width <= 0 || height <= 0) return undefined;
  return { x, y, width, height, coordinateFrame: "basler_sensor_pixels" as const };
}

/**
 * Geometry capture decisions cross the local-station/production boundary, so
 * persist an explicit allowlist rather than recursively copying bridge state.
 */
export function normalizeAiGraderPublicGeometryCaptureDecisions(value: unknown): JsonRecord | undefined {
  if (!isRecord(value)) return undefined;
  const decisions: JsonRecord = {};
  for (const side of ["front", "back"] as const) {
    const raw = value[side];
    if (!isRecord(raw) || !PUBLIC_GEOMETRY_CAPTURE_MODES.has(String(raw.mode))) continue;
    const mode = String(raw.mode) as "detected_geometry" | "manual_capture";
    const rawPlacement = PUBLIC_GEOMETRY_PLACEMENT_STATES.has(String(raw.placementState))
      ? String(raw.placementState) as "not_detected" | "adjust_card" | "ready"
      : "not_detected";
    const placementState = mode === "manual_capture" && rawPlacement === "ready" ? "not_detected" : rawPlacement;
    const timestamp = publicGeometryTimestamp(raw.timestamp);
    const sourceFrameId =
      typeof raw.sourceFrameId === "string" && SAFE_GEOMETRY_SOURCE_FRAME_ID.test(raw.sourceFrameId)
        ? raw.sourceFrameId
        : undefined;

    if (mode === "manual_capture") {
      const manualBoundaryRect = publicManualBoundaryRect(raw.manualBoundaryRect);
      if (
        raw.explicitOperatorAction !== true ||
        raw.manualOverrideUsed !== true ||
        raw.detectionUsed !== false ||
        !manualBoundaryRect
      ) continue;
      decisions[side] = {
        mode,
        geometrySource: "manual_override",
        captureMode: "manual_capture",
        placementState,
        explicitOperatorAction: true,
        detectionUsed: false,
        manualOverrideUsed: true,
        manualBoundaryRect,
        ...(timestamp ? { timestamp } : {}),
        ...(sourceFrameId ? { sourceFrameId } : {}),
      };
      continue;
    }

    if (raw.detectionUsed !== true || raw.manualOverrideUsed === true) continue;
    decisions[side] = {
      mode,
      geometrySource: "detected",
      captureMode: "automatic_detection",
      placementState,
      explicitOperatorAction: false,
      detectionUsed: true,
      manualOverrideUsed: false,
      ...(timestamp ? { timestamp } : {}),
      ...(sourceFrameId ? { sourceFrameId } : {}),
    };
  }
  return Object.keys(decisions).length ? decisions : undefined;
}

const PUBLIC_CAPTURE_TIMING_SUMMARY_KEYS = [
  "previewReadyMs",
  "frontEdgeDetectionReadyMs",
  "backEdgeDetectionReadyMs",
  "frontPositioningMs",
  "backPositioningMs",
  "totalFrontMs",
  "totalBackMs",
  "frontProcessingMs",
  "backProcessingMs",
  "frontProcessingDuringFlipMs",
  "reportGenerationMs",
  "totalCardMs",
  "reportReadyTotalMs",
  "safeQueueLatencyMs",
] as const;
const PUBLIC_CAPTURE_TIMING_EVENT_IDS = new Set([
  "session_started",
  "preview_stream_started",
  "preview_ready",
  "edge_detection_ready",
  "capture_trigger",
  "raw_capture_completed",
  "side_processing_started",
  "side_processing_completed",
  "back_positioning_started",
  "report_generation_started",
  "report_ready",
  "safely_queued",
]);
const PUBLIC_CAPTURE_TIMING_PHASE_IDS = new Set([
  "lighting_profile",
  "frame_capture",
  "file_writes",
  "file_hashes",
  "crop_deskew",
  "grading_forensic_runner",
  "side_processing",
  "report_generation",
]);
const PUBLIC_OCR_FIELD_NAMES = [
  "category",
  "playerName",
  "cardName",
  "year",
  "manufacturer",
  "productSet",
  "cardNumber",
  "parallel",
  "insert",
  "numbered",
  "auto",
  "mem",
] as const;

function boundedPublicDuration(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 24 * 60 * 60 * 1000
    ? Math.round(value * 10) / 10
    : undefined;
}

/**
 * Browser publication input is not a hardware attestation. Preserve bounded
 * diagnostic timing, but never allow a caller-provided proof boolean to become
 * a public five-second claim.
 */
export function normalizeAiGraderPublicCaptureTiming(value: unknown): JsonRecord | undefined {
  if (!isRecord(value) || value.schemaVersion !== "ten-kings-ai-grader-capture-timing-v1") return undefined;
  const captureProfile = value.captureProfile === "production_fast" ? "production_fast" : "full_forensic";
  const rawSummary = isRecord(value.summary) ? value.summary : {};
  const summary: JsonRecord = {
    frontProcessingOverlappedFlip: rawSummary.frontProcessingOverlappedFlip === true,
  };
  for (const key of PUBLIC_CAPTURE_TIMING_SUMMARY_KEYS) {
    const duration = boundedPublicDuration(rawSummary[key]);
    if (duration !== undefined) summary[key] = duration;
  }
  const events = (Array.isArray(value.events) ? value.events : [])
    .filter(isRecord)
    .slice(0, 100)
    .flatMap((entry) => {
      const id = stringValue(entry.id, "");
      const at = stringValue(entry.at, "");
      const side = entry.side === "front" || entry.side === "back" ? entry.side : undefined;
      const triggerMode = entry.triggerMode === "operator" || entry.triggerMode === "auto" ? entry.triggerMode : undefined;
      if (!PUBLIC_CAPTURE_TIMING_EVENT_IDS.has(id) || !Number.isFinite(Date.parse(at))) return [];
      return [{ id, at: new Date(at).toISOString(), ...(side ? { side } : {}), ...(triggerMode ? { triggerMode } : {}) }];
    });
  const phases = (Array.isArray(value.phases) ? value.phases : [])
    .filter(isRecord)
    .slice(0, 100)
    .flatMap((entry) => {
      const id = stringValue(entry.id, "");
      const durationMs = boundedPublicDuration(entry.durationMs);
      const side = entry.side === "front" || entry.side === "back" ? entry.side : undefined;
      if (!PUBLIC_CAPTURE_TIMING_PHASE_IDS.has(id) || durationMs === undefined) return [];
      return [{ id, durationMs, ...(side ? { side } : {}) }];
    });
  const totalFrontMs = boundedPublicDuration(rawSummary.totalFrontMs);
  const totalBackMs = boundedPublicDuration(rawSummary.totalBackMs);
  return {
    schemaVersion: "ten-kings-ai-grader-capture-timing-v1",
    captureProfile,
    targetSideMs: 5000,
    hardwareMeasurement: false,
    events,
    phases,
    summary,
    target: {
      ...(totalFrontMs !== undefined ? { frontWithinTarget: totalFrontMs <= 5000 } : {}),
      ...(totalBackMs !== undefined ? { backWithinTarget: totalBackMs <= 5000 } : {}),
      fiveSecondsPerSideProven: false,
      hardwareMeasurementRequired: true,
      note: "Published browser timing is diagnostic only; five seconds per side requires a trusted supervised Dell hardware attestation.",
    },
  };
}

/**
 * OCR metadata may assist display, but it can never carry caller-controlled
 * claims that confirmation, publication, or inventory mutation occurred.
 */
export function normalizeAiGraderPublicOcrPrefill(value: unknown): JsonRecord | undefined {
  if (!isRecord(value)) return undefined;
  const rawFields = isRecord(value.fields) ? value.fields : {};
  const fields: JsonRecord = {};
  for (const name of PUBLIC_OCR_FIELD_NAMES) {
    const raw = rawFields[name];
    if (!isRecord(raw)) continue;
    const fieldValue =
      typeof raw.value === "string"
        ? raw.value.slice(0, 240)
        : typeof raw.value === "boolean" || raw.value === null
          ? raw.value
          : null;
    const confidence =
      typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
        ? Math.max(0, Math.min(1, Math.round(raw.confidence * 1000) / 1000))
        : 0;
    fields[name] = {
      value: fieldValue,
      confidence,
      reviewRequired: true,
      sources: (Array.isArray(raw.sources) ? raw.sources : [])
        .filter((source): source is string => typeof source === "string")
        .slice(0, 10)
        .map((source) => source.slice(0, 80)),
    };
  }
  const provenance = isRecord(value.provenance) ? value.provenance : {};
  return {
    ...(typeof value.reportId === "string" ? { reportId: value.reportId.slice(0, 200) } : {}),
    status: "prefill_ready",
    humanConfirmationRequired: true,
    inventoryMutationPerformed: false,
    publishMutationPerformed: false,
    sourceSides: (Array.isArray(value.sourceSides) ? value.sourceSides : []).filter(
      (side) => side === "front" || side === "back"
    ),
    fields,
    reviewFieldNames: Object.keys(fields),
    provenance: {
      ocrEngine: typeof provenance.ocrEngine === "string" ? provenance.ocrEngine.slice(0, 120) : "existing_ten_kings_ocr",
      attributeExtractor:
        typeof provenance.attributeExtractor === "string"
          ? provenance.attributeExtractor.slice(0, 120)
          : "@tenkings/shared/extractCardAttributes",
      setLookupUsed: provenance.setLookupUsed === true,
      setIdentificationUsed: provenance.setIdentificationUsed === true,
    },
    warnings: (Array.isArray(value.warnings) ? value.warnings : [])
      .filter((warning): warning is string => typeof warning === "string")
      .slice(0, 20)
      .map((warning) => warning.slice(0, 500)),
  };
}

function publicBase(publicReportBaseUrl?: string) {
  const base = publicReportBaseUrl?.trim() || "https://collect.tenkings.co";
  return base.replace(/\/$/, "");
}

function artifact(input: {
  artifactId: string;
  artifactClass: AiGraderProductionArtifactPlan["artifactClass"];
  kind: string;
  storageKey: string;
  contentType: string;
  body: string;
  bodyEncoding?: "utf8" | "base64";
  publicUrl?: string;
}): AiGraderProductionArtifactPlan {
  const bytes = Buffer.from(input.body, input.bodyEncoding === "base64" ? "base64" : "utf8");
  return {
    ...input,
    checksumSha256: aiGraderSha256(bytes),
    byteSize: bytes.length,
  };
}

function reportAssetArtifacts(input: {
  reportId: string;
  storageKeyPrefix: string;
  reportBundle: AiGraderProductionReportBundleLike;
  publicUrlFor: (storageKey: string) => string;
}): AiGraderProductionArtifactPlan[] {
  const rawAssets = Array.isArray(input.reportBundle.assets) ? input.reportBundle.assets : [];
  const seenStorageKeys = new Set<string>();
  const artifacts: AiGraderProductionArtifactPlan[] = [];
  rawAssets.filter(isRecord).forEach((asset, index) => {
    const bodyBase64 = stringValue(asset.bodyBase64, "");
    const contentType = stringValue(asset.contentType, "application/octet-stream");
    if (!contentType.toLowerCase().startsWith("image/")) return;
    if (!isImageAssetRecord(asset)) return;
    const id = stringValue(asset.id, `image-${index + 1}`);
    const checksumSha256 = bodyBase64
      ? aiGraderSha256(Buffer.from(bodyBase64, "base64"))
      : checksumValue(asset.checksumSha256 ?? asset.sha256);
    const byteSize = bodyBase64 ? Buffer.from(bodyBase64, "base64").length : positiveIntegerValue(asset.byteSize);
    if (!checksumSha256 || !byteSize) return;
    const fileName = safeAssetFileName(
      stringValue(asset.fileName ?? asset.storageKey ?? id, ""),
      `${safeSegment(id)}${fileExtensionForContentType(contentType)}`
    );
    const uniqueName = `${String(index + 1).padStart(3, "0")}-${fileName}`;
    const storageKey = `${input.storageKeyPrefix}assets/${uniqueName}`;
    if (seenStorageKeys.has(storageKey)) return;
    seenStorageKeys.add(storageKey);
    artifacts.push({
        artifactId: `${input.reportId}:report-asset:${safeSegment(id)}:${index + 1}`,
        artifactClass: "report_asset",
        kind: "report-image",
        storageKey,
        contentType,
        ...(bodyBase64 ? { body: bodyBase64, bodyEncoding: "base64" as const } : {}),
        checksumSha256,
        byteSize,
        publicUrl: input.publicUrlFor(storageKey),
        sourceAssetId: id,
    });
  });
  return artifacts;
}

export function buildAiGraderLabelPreviewHtml(productionRelease: AiGraderProductionReleaseLike) {
  const label = isRecord(productionRelease.label) ? productionRelease.label : {};
  const finalGrade = isRecord(productionRelease.finalGrade) ? productionRelease.finalGrade : {};
  const reportId = stringValue(productionRelease.reportId ?? label.reportId, "pending-report");
  const gradeText = stringValue(label.labelGradeText, numberValue(finalGrade.overall)?.toFixed(1) ?? "PENDING");
  const qrPayloadUrl = stringValue(label.qrPayloadUrl, `/ai-grader/reports/${reportId}`);
  const certId = stringValue(label.certId, reportId);
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Ten Kings AI Grader Label ${reportId}</title>
  <style>
    body { margin: 0; background: #f3efe5; color: #111; font-family: Inter, Arial, sans-serif; }
    .label { width: 3.5in; min-height: 2.1in; margin: 24px auto; padding: 0.18in; border: 1px solid #141414; background: #fffaf0; box-sizing: border-box; }
    .brand { font-size: 10px; letter-spacing: .18em; text-transform: uppercase; color: #8b6c2d; font-weight: 900; }
    .grade { margin-top: 8px; font-size: 48px; line-height: .95; font-weight: 900; }
    .meta { margin-top: 8px; font-size: 10px; line-height: 1.35; overflow-wrap: anywhere; }
    .warning { margin-top: 10px; padding-top: 8px; border-top: 1px solid #ddd0af; font-size: 9px; color: #7a2b2b; font-weight: 800; text-transform: uppercase; }
  </style>
</head>
<body>
  <section class="label">
    <div class="brand">Ten Kings AI Grader</div>
    <div class="grade">${gradeText}</div>
    <div class="meta">Report ID: ${reportId}<br />Cert/Report ID: ${certId}<br />QR URL: ${qrPayloadUrl}</div>
    <div class="warning">AI-Grader Report V0. Certification claim disabled until approved.</div>
  </section>
</body>
</html>
`;
}

export function buildAiGraderProductionStoragePlan(input: {
  reportBundle: AiGraderProductionReportBundleLike;
  productionRelease: AiGraderProductionReleaseLike;
  publicReportBaseUrl?: string;
  storageKeyPrefix?: string;
  publicUrlFor?: (storageKey: string) => string;
}): AiGraderProductionStoragePlan {
  const reportId = stringValue(input.productionRelease.reportId ?? input.reportBundle.reportId, "pending-report");
  const storageKeyPrefix = (input.storageKeyPrefix ?? `ai-grader/reports/${safeSegment(reportId)}/`).replace(/^\/+/, "").replace(/\/?$/, "/");
  const base = publicBase(input.publicReportBaseUrl);
  const generatedAt = stringValue(input.productionRelease.generatedAt ?? input.reportBundle.generatedAt, new Date().toISOString());
  const publicReportUrl = `${base}/ai-grader/reports/${encodeURIComponent(reportId)}`;
  const qrPayloadUrl = publicReportUrl;
  const publicUrlFor = input.publicUrlFor ?? ((storageKey: string) => `${base}/storage/${storageKey}`);
  const reportAssets = reportAssetArtifacts({ reportId, storageKeyPrefix, reportBundle: input.reportBundle, publicUrlFor });
  const publicCaptureTiming = normalizeAiGraderPublicCaptureTiming(input.reportBundle.captureTiming);
  const publicOcrPrefill = normalizeAiGraderPublicOcrPrefill(input.reportBundle.ocrPrefill);
  const publicGeometryCaptureDecisions = normalizeAiGraderPublicGeometryCaptureDecisions(
    input.reportBundle.geometryCaptureDecisions
  );
  const publicAssets = reportAssets.map((entry) => ({
    id: entry.artifactId.replace(`${reportId}:report-asset:`, ""),
    kind: entry.kind,
    fileName: entry.storageKey.split("/").pop(),
    contentType: entry.contentType,
    storageKey: entry.storageKey,
    publicUrl: entry.publicUrl,
    byteSize: entry.byteSize,
    checksumSha256: entry.checksumSha256,
  }));
  const sanitizedBundle = sanitizeAiGraderPublicJson({
    ...input.reportBundle,
    reportId,
    ...(publicCaptureTiming ? { captureTiming: publicCaptureTiming } : { captureTiming: undefined }),
    ...(publicOcrPrefill ? { ocrPrefill: publicOcrPrefill } : { ocrPrefill: undefined }),
    ...(publicGeometryCaptureDecisions
      ? { geometryCaptureDecisions: publicGeometryCaptureDecisions }
      : { geometryCaptureDecisions: undefined }),
    assets: publicAssets,
    publicAssets,
    publicPathPlaceholders: {
      reportViewerRoute: "/ai-grader/reports/[reportId]",
      reportUrlTemplate: "/ai-grader/reports/{reportId}",
      assetBaseUrlTemplate: `${storageKeyPrefix}assets/`,
    },
  });
  const sanitizedRelease = sanitizeAiGraderPublicJson({
    ...input.productionRelease,
    reportId,
    publication: {
      ...(isRecord(input.productionRelease.publication) ? input.productionRelease.publication : {}),
      status: "published",
      publicReportUrl,
      qrPayloadUrl,
      storageMode: "managed_storage",
      dbWritesPerformed: true,
      uploadPerformed: true,
      storageKeyPrefix,
    },
  });
  const labelData = sanitizeAiGraderPublicJson({
    ...(isRecord(sanitizedRelease.label) ? sanitizedRelease.label : {}),
    reportId,
    publicReportUrl,
    qrPayloadUrl,
  });
  const publicationManifest = sanitizeAiGraderPublicJson({
    reportId,
    status: "published",
    publicReportUrl,
    qrPayloadUrl,
    storageKeyPrefix,
    generatedAt,
    certificationClaim: false,
  });
  const integrationContract = sanitizeAiGraderPublicJson({
    reportId,
    gradingSessionId: input.productionRelease.gradingSessionId ?? input.reportBundle.gradingSessionId,
    cardIdentity: input.reportBundle.cardIdentity,
    finalGrade: input.productionRelease.finalGrade,
    label: labelData,
    publication: publicationManifest,
    slabbedPhotoContract: input.productionRelease.slabbedPhotoContract,
    ebayCompsContract: input.productionRelease.ebayCompsContract,
    cardInventoryLinkage: input.productionRelease.cardInventoryLinkage,
    noLocalDellPaths: true,
  });
  const artifacts: AiGraderProductionArtifactPlan[] = [
    artifact({
      artifactId: `${reportId}:report-bundle`,
      artifactClass: "report_bundle",
      kind: "report-bundle.json",
      storageKey: `${storageKeyPrefix}report-bundle.json`,
      contentType: "application/json",
      body: stableJson(sanitizedBundle),
    }),
    artifact({
      artifactId: `${reportId}:production-release`,
      artifactClass: "production_release",
      kind: "production-release.json",
      storageKey: `${storageKeyPrefix}production-release.json`,
      contentType: "application/json",
      body: stableJson(sanitizedRelease),
    }),
    artifact({
      artifactId: `${reportId}:label-data`,
      artifactClass: "label_data",
      kind: "label-data.json",
      storageKey: `${storageKeyPrefix}label-data.json`,
      contentType: "application/json",
      body: stableJson(labelData),
    }),
    artifact({
      artifactId: `${reportId}:publication-manifest`,
      artifactClass: "publication_manifest",
      kind: "publication-manifest.json",
      storageKey: `${storageKeyPrefix}publication-manifest.json`,
      contentType: "application/json",
      body: stableJson(publicationManifest),
    }),
    artifact({
      artifactId: `${reportId}:integration-contract`,
      artifactClass: "integration_contract",
      kind: "integration-contract.json",
      storageKey: `${storageKeyPrefix}integration-contract.json`,
      contentType: "application/json",
      body: stableJson(integrationContract),
    }),
    artifact({
      artifactId: `${reportId}:label-preview`,
      artifactClass: "label_preview",
      kind: "label-preview.html",
      storageKey: `${storageKeyPrefix}label-preview.html`,
      contentType: "text/html; charset=utf-8",
      body: buildAiGraderLabelPreviewHtml(sanitizedRelease),
    }),
    ...reportAssets,
  ];
  const assetManifest = artifacts.map((entry) => ({
    artifactId: entry.artifactId,
    kind: entry.kind,
    storageKey: entry.storageKey,
    checksumSha256: entry.checksumSha256,
    byteSize: entry.byteSize,
    publicUrl: publicUrlFor(entry.storageKey),
  }));
  const assetManifestArtifact = artifact({
    artifactId: `${reportId}:asset-manifest`,
    artifactClass: "asset_manifest",
    kind: "asset-manifest.json",
    storageKey: `${storageKeyPrefix}asset-manifest.json`,
    contentType: "application/json",
    body: stableJson({ reportId, assets: assetManifest }),
  });
  const checksumsArtifact = artifact({
    artifactId: `${reportId}:checksums`,
    artifactClass: "checksums",
    kind: "checksums.json",
    storageKey: `${storageKeyPrefix}checksums.json`,
    contentType: "application/json",
    body: stableJson({
      reportId,
      checksums: [...assetManifest, {
        artifactId: assetManifestArtifact.artifactId,
        kind: assetManifestArtifact.kind,
        storageKey: assetManifestArtifact.storageKey,
        checksumSha256: assetManifestArtifact.checksumSha256,
        byteSize: assetManifestArtifact.byteSize,
        publicUrl: publicUrlFor(assetManifestArtifact.storageKey),
      }].map((entry) => ({
        artifactId: entry.artifactId,
        kind: entry.kind,
        storageKey: entry.storageKey,
        checksumSha256: entry.checksumSha256,
        byteSize: entry.byteSize,
      })),
    }),
  });
  const allArtifacts = [...artifacts, assetManifestArtifact, checksumsArtifact].map((entry) => ({
    ...entry,
    publicUrl: publicUrlFor(entry.storageKey),
  }));
  return {
    storageKeyPrefix,
    publicReportUrl,
    qrPayloadUrl,
    artifacts: allArtifacts,
    assetManifest: allArtifacts.map((entry) => ({
      artifactId: entry.artifactId,
      kind: entry.kind,
      storageKey: entry.storageKey,
      checksumSha256: entry.checksumSha256,
      byteSize: entry.byteSize,
      publicUrl: entry.publicUrl,
    })),
  };
}

export function computeAiGraderValuationStatus(input: {
  productionRelease: AiGraderProductionReleaseLike;
  reportBundle: AiGraderProductionReportBundleLike;
}): AiGraderValuationStatus {
  if (input.productionRelease.finalGradeComputed !== true) return "not_ready_missing_grade";
  const cardIdentity = isRecord(input.reportBundle.cardIdentity) ? input.reportBundle.cardIdentity : {};
  const title = stringValue(cardIdentity.title, "");
  const set = stringValue(cardIdentity.set, "");
  const cardNumber = stringValue(cardIdentity.cardNumber, "");
  if (!title && (!set || !cardNumber)) return "not_ready_missing_identity";
  return "ready";
}

export function buildAiGraderCompsSearchQuery(input: {
  reportBundle: AiGraderProductionReportBundleLike;
  productionRelease?: AiGraderProductionReleaseLike;
  selection?: AiGraderCardItemSelection | null;
}) {
  const cardIdentity = isRecord(input.reportBundle.cardIdentity) ? input.reportBundle.cardIdentity : {};
  const selection = input.selection ?? null;
  const finalGrade = isRecord(input.productionRelease?.finalGrade) ? input.productionRelease?.finalGrade : {};
  const title = trimmedString(selection?.title) || trimmedString(cardIdentity.title);
  const setName = trimmedString(selection?.set) || trimmedString(cardIdentity.set);
  const cardNumber = trimmedString(selection?.cardNumber) || trimmedString(cardIdentity.cardNumber);
  const grade = numberValue(finalGrade?.overall);
  const parts = [title, setName, cardNumber ? `#${cardNumber}` : "", grade ? `AI Grade ${grade.toFixed(1)}` : ""].filter(Boolean);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function finalOverallGrade(productionRelease: AiGraderProductionReleaseLike) {
  const finalGrade = isRecord(productionRelease.finalGrade) ? productionRelease.finalGrade : {};
  return numberValue(finalGrade.overall);
}

function elementScores(productionRelease: AiGraderProductionReleaseLike) {
  const finalGrade = isRecord(productionRelease.finalGrade) ? productionRelease.finalGrade : {};
  return isRecord(finalGrade.elements) ? finalGrade.elements : {};
}

function confidence(productionRelease: AiGraderProductionReleaseLike) {
  const finalGrade = isRecord(productionRelease.finalGrade) ? productionRelease.finalGrade : {};
  return isRecord(finalGrade.confidence) ? finalGrade.confidence : {};
}

function labelData(productionRelease: AiGraderProductionReleaseLike, reportId: string, publicReportUrl: string) {
  return isRecord(productionRelease.label)
    ? productionRelease.label
    : {
        status: "label_data_ready",
        certId: reportId,
        reportId,
        publicReportUrl,
        qrPayloadUrl: publicReportUrl,
        labelGradeText: finalOverallGrade(productionRelease)?.toFixed(1) ?? "PENDING",
      };
}

function sessionData(input: AiGraderProductionPersistInput, gradingSessionId: string, reportId: string, now: Date) {
  const cardAssetId = input.cardAssetId ?? stringValue(input.reportBundle.cardIdentity?.cardAssetId, "");
  const itemId = input.itemId ?? stringValue(input.reportBundle.cardIdentity?.itemId, "");
  return {
    tenantId: input.tenantId,
    gradingSessionId,
    reportId,
    operatorUserId: input.operatorUserId ?? null,
    operatorId: stringValue(input.productionRelease.operatorFinalization?.operatorId, input.operatorUserId ?? "") || null,
    cardAssetId: cardAssetId || null,
    itemId: itemId || null,
    status: input.publicationStatus === "published" ? "published" : "finalized",
    source: "browser_station",
    cardIdentity: nullableJson(input.reportBundle.cardIdentity),
    acceptedProfile: nullableJson(input.reportBundle.lightingProfile),
    calibrationProfile: nullableJson(input.reportBundle.calibrationProfile ?? input.reportBundle.rulerCalibration),
    captureSummary: nullableJson({
      evidenceReferences: input.reportBundle.evidenceReferences,
      geometry: sanitizeAiGraderPublicJson(input.reportBundle.geometry),
      geometryCaptureDecisions: normalizeAiGraderPublicGeometryCaptureDecisions(
        input.reportBundle.geometryCaptureDecisions
      ),
      captureTiming: normalizeAiGraderPublicCaptureTiming(input.reportBundle.captureTiming),
      ocrPrefill: normalizeAiGraderPublicOcrPrefill(input.reportBundle.ocrPrefill),
    }),
    safetySummary: nullableJson({
      finalGradeComputed: input.productionRelease.finalGradeComputed === true,
      certifiedClaim: false,
      warnings: input.productionRelease.warnings ?? input.reportBundle.warnings ?? [],
      actorAudit: actorAuditJson(input.actorAudit),
    }),
    updatedAt: now,
  };
}

function reportData(input: AiGraderProductionPersistInput, sessionId: string, reportId: string, status: AiGraderProductionPublicationStatus, now: Date) {
  const release = input.productionRelease;
  const grade = finalOverallGrade(release);
  const cardAssetId = input.cardAssetId ?? stringValue(input.reportBundle.cardIdentity?.cardAssetId, "");
  const itemId = input.itemId ?? stringValue(input.reportBundle.cardIdentity?.itemId, "");
  return {
    tenantId: input.tenantId,
    sessionId,
    reportId,
    reportStatus: stringValue(release.reportStatus, "final_ai_grader_report_v0"),
    finalGradeStatus: stringValue(release.finalStatus, release.finalGradeComputed ? "final_grade_computed" : "insufficient_evidence"),
    visibilityStatus: status === "published" ? "public" : "private",
    publicationStatus: status,
    cardAssetId: cardAssetId || null,
    itemId: itemId || null,
    publicReportUrl: input.storagePlan.publicReportUrl,
    qrPayloadUrl: input.storagePlan.qrPayloadUrl,
    reportBundleStorageKey: `${input.storagePlan.storageKeyPrefix}report-bundle.json`,
    productionReleaseStorageKey: `${input.storagePlan.storageKeyPrefix}production-release.json`,
    labelDataStorageKey: `${input.storagePlan.storageKeyPrefix}label-data.json`,
    assetManifestStorageKey: `${input.storagePlan.storageKeyPrefix}asset-manifest.json`,
    reportHtmlStorageKey: `${input.storagePlan.storageKeyPrefix}label-preview.html`,
    finalOverallGrade: grade ?? null,
    elementScores: nullableJson(elementScores(release)),
    confidence: nullableJson(confidence(release)),
    gradeStory: nullableJson(input.reportBundle.provisionalGrade?.gradeStory),
    whyNot10: nullableJson(isRecord(release.finalGrade) ? release.finalGrade.whyNot10 : undefined),
    gradeImpactCandidates: nullableJson(isRecord(release.finalGrade) ? release.finalGrade.gradeImpactReasons : undefined),
    gates: nullableJson(release.gates),
    warnings: nullableJson(release.warnings ?? input.reportBundle.warnings),
    calibrationProfile: nullableJson(input.reportBundle.calibrationProfile ?? input.reportBundle.rulerCalibration),
    repeatabilitySummary: nullableJson(input.reportBundle.repeatabilitySummary),
    lightingProfile: nullableJson(input.reportBundle.lightingProfile),
    visionLabArtifacts: nullableJson(input.reportBundle.visionLab),
    valuationSummary: nullableJson(release.ebayCompsContract),
    checksumSummary: nullableJson({
      assets: input.storagePlan.assetManifest,
      actorAudit: actorAuditJson(input.actorAudit),
    }),
    finalizedAt: now,
    publishedAt: status === "published" ? now : null,
    updatedAt: now,
  };
}

async function runInTransaction<T>(db: AiGraderProductionPrismaClient, fn: (tx: AiGraderProductionTransactionClient) => Promise<T>) {
  if (typeof db.$transaction === "function") return db.$transaction(fn);
  return fn(db);
}

async function acquireAiGraderLabelSheetLock(tx: AiGraderProductionTransactionClient, tenantId: string) {
  if (typeof tx.$queryRaw !== "function") {
    throw new Error("AI Grader label sheet transaction locking is unavailable.");
  }
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('ai-grader-label-sheets'), hashtext(${tenantId}))`;
}

async function acquireAiGraderReportLifecycleLock(tx: AiGraderProductionTransactionClient, reportId: string) {
  if (typeof tx.$queryRaw !== "function") {
    throw new Error("AI Grader report lifecycle transaction locking is unavailable.");
  }
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('ai-grader-report-lifecycle'), hashtext(${reportId}))`;
}

export async function persistAiGraderProductionRelease(
  db: AiGraderProductionPrismaClient,
  input: AiGraderProductionPersistInput
): Promise<AiGraderProductionPersistResult> {
  const gradingSessionId = stringValue(input.productionRelease.gradingSessionId ?? input.reportBundle.gradingSessionId, "");
  const reportId = stringValue(input.productionRelease.reportId ?? input.reportBundle.reportId, "");
  if (!input.tenantId.trim()) throw new Error("tenantId is required.");
  if (!gradingSessionId) throw new Error("gradingSessionId is required.");
  if (!reportId) throw new Error("reportId is required.");
  const now = dateValue(input.persistedAt);
  const publicationStatus = input.publicationStatus ?? "published";

  return runInTransaction(db, async (tx) => {
    await acquireAiGraderReportLifecycleLock(tx, reportId);
    const baseSessionData = sessionData(input, gradingSessionId, reportId, now);
    const session = await tx.aiGraderSession.upsert({
      where: { gradingSessionId },
      update: baseSessionData,
      create: {
        ...baseSessionData,
        createdAt: now,
      },
    });
    const sessionId = stringValue((session as JsonRecord).id, gradingSessionId);
    const baseReportData = reportData(input, sessionId, reportId, publicationStatus, now);
    const report = await tx.aiGraderReport.upsert({
      where: { reportId },
      update: baseReportData,
      create: {
        ...baseReportData,
        createdAt: now,
      },
    });
    const reportRowId = stringValue((report as JsonRecord).id, reportId);
    const finalGrade = isRecord(input.productionRelease.finalGrade) ? input.productionRelease.finalGrade : {};
    const elements = elementScores(input.productionRelease);
    const confidenceData = confidence(input.productionRelease);
    const operatorFinalizationJson = withActorAudit(input.productionRelease.operatorFinalization, input.actorAudit);
    const grade = await tx.aiGraderGrade.upsert({
      where: { reportId: reportRowId },
      update: {
        tenantId: input.tenantId,
        status: stringValue(finalGrade.status, "final_ai_grader_grade_v0"),
        overall: finalOverallGrade(input.productionRelease) ?? null,
        centeringScore: numberValue((elements.centering as JsonRecord | undefined)?.score) ?? null,
        cornersScore: numberValue((elements.corners as JsonRecord | undefined)?.score) ?? null,
        edgesScore: numberValue((elements.edges as JsonRecord | undefined)?.score) ?? null,
        surfaceScore: numberValue((elements.surface as JsonRecord | undefined)?.score) ?? null,
        confidenceScore: numberValue(confidenceData.score) ?? null,
        confidenceBand: stringValue(confidenceData.band, "") || null,
        gradeImpactReasons: nullableJson(finalGrade.gradeImpactReasons),
        whyNot10: nullableJson(finalGrade.whyNot10),
        gates: nullableJson(input.productionRelease.gates),
        warnings: nullableJson(input.productionRelease.warnings),
        operatorFinalization: nullableJson(operatorFinalizationJson),
        overrideReason: stringValue(input.productionRelease.operatorFinalization?.overrideReason, "") || null,
        updatedAt: now,
      },
      create: {
        tenantId: input.tenantId,
        reportId: reportRowId,
        status: stringValue(finalGrade.status, "final_ai_grader_grade_v0"),
        overall: finalOverallGrade(input.productionRelease) ?? null,
        centeringScore: numberValue((elements.centering as JsonRecord | undefined)?.score) ?? null,
        cornersScore: numberValue((elements.corners as JsonRecord | undefined)?.score) ?? null,
        edgesScore: numberValue((elements.edges as JsonRecord | undefined)?.score) ?? null,
        surfaceScore: numberValue((elements.surface as JsonRecord | undefined)?.score) ?? null,
        confidenceScore: numberValue(confidenceData.score) ?? null,
        confidenceBand: stringValue(confidenceData.band, "") || null,
        gradeImpactReasons: nullableJson(finalGrade.gradeImpactReasons),
        whyNot10: nullableJson(finalGrade.whyNot10),
        gates: nullableJson(input.productionRelease.gates),
        warnings: nullableJson(input.productionRelease.warnings),
        operatorFinalization: nullableJson(operatorFinalizationJson),
        overrideReason: stringValue(input.productionRelease.operatorFinalization?.overrideReason, "") || null,
        createdAt: now,
        updatedAt: now,
      },
    });
    await acquireAiGraderLabelSheetLock(tx, input.tenantId);
    const label = labelData(input.productionRelease, reportId, input.storagePlan.publicReportUrl);
    const certId = stringValue(label.certId, reportId);
    const nextLabelGradeText = stringValue(label.labelGradeText, "PENDING");
    const reportLabels =
      (await tx.aiGraderLabel.findMany?.({
        where: { reportId: reportRowId },
        take: 2,
        select: {
          id: true,
          reportId: true,
          certId: true,
          payload: true,
          physicalPrintStatus: true,
          labelGradeText: true,
          qrPayloadUrl: true,
          publicReportUrl: true,
        },
      })) ?? [];
    const reportLabel = reportLabels[0] as JsonRecord | undefined;
    const certLabel = await tx.aiGraderLabel.findUnique?.({
      where: { certId },
      select: {
        id: true,
        reportId: true,
        certId: true,
        payload: true,
        physicalPrintStatus: true,
        labelGradeText: true,
        qrPayloadUrl: true,
        publicReportUrl: true,
      },
    });
    if (reportLabel && stringValue(reportLabel.certId, "") && stringValue(reportLabel.certId, "") !== certId) {
      throw new Error("AI Grader report already has a different cert ID; refusing to create a duplicate label row.");
    }
    if (isRecord(certLabel) && stringValue(certLabel.reportId, "") && stringValue(certLabel.reportId, "") !== reportRowId) {
      throw new Error("AI Grader cert ID is already linked to another report.");
    }
    const existingLabel = reportLabel ?? certLabel;
    const printableLabelChanged = Boolean(
      isRecord(existingLabel) &&
        existingLabel.physicalPrintStatus === "printed" &&
        (existingLabel.labelGradeText !== nextLabelGradeText ||
          existingLabel.qrPayloadUrl !== input.storagePlan.qrPayloadUrl ||
          existingLabel.publicReportUrl !== input.storagePlan.publicReportUrl)
    );
    const mergedLabelPayload = mergePersistedLabelPayload(
      isRecord(existingLabel) ? existingLabel.payload : undefined,
      label
    );
    const persistedLabelPayload = printableLabelChanged
      ? invalidatePersistedLabelPrint(mergedLabelPayload, now)
      : mergedLabelPayload;
    const labelRow = await tx.aiGraderLabel.upsert({
      where: { certId },
      update: {
        tenantId: input.tenantId,
        sessionId,
        reportId: reportRowId,
        labelStatus: stringValue(label.status, "label_data_ready"),
        certificateStatus: stringValue(label.certificateStatus, "report_id_issued_not_certified"),
        qrPayloadUrl: input.storagePlan.qrPayloadUrl,
        publicReportUrl: input.storagePlan.publicReportUrl,
        labelGradeText: nextLabelGradeText,
        labelDataStorageKey: `${input.storagePlan.storageKeyPrefix}label-data.json`,
        labelPreviewKey: `${input.storagePlan.storageKeyPrefix}label-preview.html`,
        labelPreviewUrl: input.storagePlan.assetManifest.find((asset) => asset.kind === "label-preview.html")?.publicUrl,
        ...(printableLabelChanged ? { physicalPrintStatus: "not_printed" } : {}),
        payload: persistedLabelPayload,
        updatedAt: now,
      },
      create: {
        tenantId: input.tenantId,
        sessionId,
        reportId: reportRowId,
        certId,
        labelStatus: stringValue(label.status, "label_data_ready"),
        certificateStatus: stringValue(label.certificateStatus, "report_id_issued_not_certified"),
        qrPayloadUrl: input.storagePlan.qrPayloadUrl,
        publicReportUrl: input.storagePlan.publicReportUrl,
        labelGradeText: nextLabelGradeText,
        labelDataStorageKey: `${input.storagePlan.storageKeyPrefix}label-data.json`,
        labelPreviewKey: `${input.storagePlan.storageKeyPrefix}label-preview.html`,
        labelPreviewUrl: input.storagePlan.assetManifest.find((asset) => asset.kind === "label-preview.html")?.publicUrl,
        payload: persistedLabelPayload,
        createdAt: now,
        updatedAt: now,
      },
    });
    const publication = await tx.aiGraderPublication.upsert({
      where: { reportId: reportRowId },
      update: {
        tenantId: input.tenantId,
        status: publicationStatus,
        publicReportUrl: input.storagePlan.publicReportUrl,
        qrPayloadUrl: input.storagePlan.qrPayloadUrl,
        reportBundleStorageKey: `${input.storagePlan.storageKeyPrefix}report-bundle.json`,
        storageKeyPrefix: input.storagePlan.storageKeyPrefix,
        assetManifest: json(input.storagePlan.assetManifest),
        publicationManifest: nullableJson(withActorAudit(input.productionRelease.publication, input.actorAudit)),
        publishedByUserId: input.operatorUserId ?? null,
        publishedAt: publicationStatus === "published" ? now : null,
        updatedAt: now,
      },
      create: {
        tenantId: input.tenantId,
        reportId: reportRowId,
        status: publicationStatus,
        publicReportUrl: input.storagePlan.publicReportUrl,
        qrPayloadUrl: input.storagePlan.qrPayloadUrl,
        reportBundleStorageKey: `${input.storagePlan.storageKeyPrefix}report-bundle.json`,
        storageKeyPrefix: input.storagePlan.storageKeyPrefix,
        assetManifest: json(input.storagePlan.assetManifest),
        publicationManifest: nullableJson(withActorAudit(input.productionRelease.publication, input.actorAudit)),
        publishedByUserId: input.operatorUserId ?? null,
        publishedAt: publicationStatus === "published" ? now : null,
        createdAt: now,
        updatedAt: now,
      },
    });
    let evidenceAssetCount = 0;
    for (const asset of input.storagePlan.artifacts) {
      await tx.aiGraderEvidenceAsset.upsert({
        where: { tenantId_artifactId: { tenantId: input.tenantId, artifactId: asset.artifactId } },
        update: {
          sessionId,
          reportId: reportRowId,
          artifactClass: asset.artifactClass,
          kind: asset.kind,
          storageKey: asset.storageKey,
          publicUrl: asset.publicUrl,
          checksumSha256: asset.checksumSha256,
          mimeType: asset.contentType,
          byteSize: asset.byteSize,
          metadata: json({
            source: "ai_grader_production_release_v0",
            actorAudit: actorAuditJson(input.actorAudit),
          }),
        },
        create: {
          tenantId: input.tenantId,
          sessionId,
          reportId: reportRowId,
          artifactId: asset.artifactId,
          artifactClass: asset.artifactClass,
          kind: asset.kind,
          storageKey: asset.storageKey,
          publicUrl: asset.publicUrl,
          checksumSha256: asset.checksumSha256,
          mimeType: asset.contentType,
          byteSize: asset.byteSize,
          metadata: json({
            source: "ai_grader_production_release_v0",
            actorAudit: actorAuditJson(input.actorAudit),
          }),
          createdAt: now,
        },
      });
      evidenceAssetCount += 1;
    }
    const valuationStatus = computeAiGraderValuationStatus(input);
    const valuationId = `ai-grader-valuation:${reportId}`;
    const existingValuation = await tx.aiGraderValuation.findUnique?.({
      where: { id: valuationId },
      select: {
        status: true,
        source: true,
        searchQuery: true,
        valuationMinor: true,
        valuationCurrency: true,
        compsRefs: true,
        resultSummary: true,
        requestedByUserId: true,
        requestedAt: true,
        completedAt: true,
        errorCode: true,
      },
    });
    const preserveRuntimeValuation = hasProgressedRuntimeValuation(existingValuation);
    const valuation = await tx.aiGraderValuation.upsert({
      where: { id: valuationId },
      update: {
        tenantId: input.tenantId,
        sessionId,
        ...(!preserveRuntimeValuation
          ? {
              status: valuationStatus,
              source: "ebay_sold",
              searchQuery: stringValue(input.reportBundle.cardIdentity?.title, "") || null,
              compsRefs: nullableJson(input.productionRelease.ebayCompsContract?.compsRefs),
              resultSummary: nullableJson(withActorAudit(input.productionRelease.ebayCompsContract, input.actorAudit)),
              updatedAt: now,
            }
          : {}),
      },
      create: {
        id: valuationId,
        tenantId: input.tenantId,
        sessionId,
        reportId: reportRowId,
        status: valuationStatus,
        source: "ebay_sold",
        searchQuery: stringValue(input.reportBundle.cardIdentity?.title, "") || null,
        compsRefs: nullableJson(input.productionRelease.ebayCompsContract?.compsRefs),
        resultSummary: nullableJson(withActorAudit(input.productionRelease.ebayCompsContract, input.actorAudit)),
        createdAt: now,
        updatedAt: now,
      },
    });
    let cardAssetUpdatedCount = 0;
    const cardAssetId = input.cardAssetId ?? stringValue(input.reportBundle.cardIdentity?.cardAssetId, "");
    if (cardAssetId && tx.cardAsset?.updateMany) {
      const update = await tx.cardAsset.updateMany({
        where: { id: cardAssetId },
        data: {
          aiGradeFinal: finalOverallGrade(input.productionRelease) ?? null,
          aiGradeLabel: label.labelGradeText ?? null,
          aiGradingJson: json({
            reportId,
            publicReportUrl: input.storagePlan.publicReportUrl,
            publicationStatus,
            finalGrade: input.productionRelease.finalGrade,
            label,
            actorAudit: actorAuditJson(input.actorAudit),
          }),
          aiGradeGeneratedAt: now,
        },
      });
      cardAssetUpdatedCount = update.count;
    }
    let itemUpdatedCount = 0;
    const itemId = input.itemId ?? stringValue(input.reportBundle.cardIdentity?.itemId, "");
    if (itemId && tx.item?.updateMany) {
      const existingItem = await tx.item.findUnique?.({
        where: { id: itemId },
        select: { detailsJson: true },
      });
      const existingDetails = isRecord(existingItem) && isRecord(existingItem.detailsJson) ? existingItem.detailsJson : {};
      const update = await tx.item.updateMany({
        where: { id: itemId },
        data: {
          detailsJson: json({
            ...existingDetails,
            aiGraderReportId: reportId,
            aiGraderPublicReportUrl: input.storagePlan.publicReportUrl,
            aiGraderFinalGrade: finalOverallGrade(input.productionRelease) ?? null,
            aiGraderLabel: label.labelGradeText ?? null,
            aiGraderActorAudit: actorAuditJson(input.actorAudit),
          }),
        },
      });
      itemUpdatedCount = update.count;
    }

    return {
      gradingSessionId,
      reportId,
      publicationStatus,
      session,
      report,
      grade,
      label: labelRow,
      publication,
      valuation,
      evidenceAssetCount,
      cardAssetUpdatedCount,
      itemUpdatedCount,
      storagePlan: input.storagePlan,
    };
  });
}

async function findAiGraderReportForProductionAsset(
  db: AiGraderProductionPrismaClient,
  reportId: string
): Promise<JsonRecord> {
  if (typeof db.aiGraderReport.findUnique !== "function") {
    throw new Error("AiGraderReport.findUnique is required for this production operation.");
  }
  const report = await db.aiGraderReport.findUnique({
    where: { reportId },
    select: {
      id: true,
      tenantId: true,
      sessionId: true,
      reportId: true,
      cardAssetId: true,
      itemId: true,
    },
  });
  if (!isRecord(report)) {
    throw new Error(`AI Grader report ${reportId} was not found.`);
  }
  return report;
}

export async function persistAiGraderSlabbedPhotoAsset(
  db: AiGraderProductionPrismaClient,
  input: AiGraderSlabbedPhotoPersistInput
): Promise<AiGraderSlabbedPhotoPersistResult> {
  if (!input.tenantId.trim()) throw new Error("tenantId is required.");
  if (!input.reportId.trim()) throw new Error("reportId is required.");
  if (input.side !== "front" && input.side !== "back") throw new Error("side must be front or back.");
  if (!input.storageKey.trim()) throw new Error("storageKey is required.");
  if (!input.publicUrl.trim()) throw new Error("publicUrl is required.");
  if (!input.mimeType.trim()) throw new Error("mimeType is required.");
  if (!Number.isFinite(input.byteSize) || input.byteSize <= 0) throw new Error("byteSize must be positive.");

  return runInTransaction(db, async (tx) => {
    const report = await findAiGraderReportForProductionAsset(tx as AiGraderProductionPrismaClient, input.reportId);
    const now = dateValue(input.uploadedAt);
    const artifactId = `slabbed-photo:${input.reportId}:${input.side}`;
    const asset = await tx.aiGraderEvidenceAsset.upsert({
      where: { tenantId_artifactId: { tenantId: input.tenantId, artifactId } },
      update: {
        sessionId: stringValue(report.sessionId, "") || null,
        reportId: stringValue(report.id, ""),
        artifactClass: "slabbed_photo",
        kind: `slabbed_${input.side}_color_photo`,
        side: input.side,
        storageKey: input.storageKey,
        publicUrl: input.publicUrl,
        checksumSha256: input.checksumSha256 ?? null,
        mimeType: input.mimeType,
        byteSize: Math.round(input.byteSize),
        widthPx: input.widthPx ?? null,
        heightPx: input.heightPx ?? null,
        metadata: json({
          ...(input.metadata ?? {}),
          source: "ai_grader_slabbed_photo_upload_v0",
          uploadedByUserId: input.operatorUserId ?? null,
          uploadedAt: now.toISOString(),
          cardAssetId: report.cardAssetId ?? null,
          itemId: report.itemId ?? null,
          actorAudit: actorAuditJson(input.actorAudit),
        }),
      },
      create: {
        tenantId: input.tenantId,
        sessionId: stringValue(report.sessionId, "") || null,
        reportId: stringValue(report.id, ""),
        artifactId,
        artifactClass: "slabbed_photo",
        kind: `slabbed_${input.side}_color_photo`,
        side: input.side,
        storageKey: input.storageKey,
        publicUrl: input.publicUrl,
        checksumSha256: input.checksumSha256 ?? null,
        mimeType: input.mimeType,
        byteSize: Math.round(input.byteSize),
        widthPx: input.widthPx ?? null,
        heightPx: input.heightPx ?? null,
        metadata: json({
          ...(input.metadata ?? {}),
          source: "ai_grader_slabbed_photo_upload_v0",
          uploadedByUserId: input.operatorUserId ?? null,
          uploadedAt: now.toISOString(),
          cardAssetId: report.cardAssetId ?? null,
          itemId: report.itemId ?? null,
          actorAudit: actorAuditJson(input.actorAudit),
        }),
        createdAt: now,
      },
    });
    return {
      reportId: input.reportId,
      artifactId,
      side: input.side,
      storageKey: input.storageKey,
      publicUrl: input.publicUrl,
      asset,
    };
  });
}

export async function persistAiGraderValuationResult(
  db: AiGraderProductionPrismaClient,
  input: AiGraderValuationPersistInput
): Promise<AiGraderValuationPersistResult> {
  if (!input.tenantId.trim()) throw new Error("tenantId is required.");
  if (!input.reportId.trim()) throw new Error("reportId is required.");
  const now = dateValue(input.requestedAt);
  const completedAt = input.completedAt === null ? null : input.status === "completed" ? dateValue(input.completedAt ?? now) : null;

  return runInTransaction(db, async (tx) => {
    const report = await findAiGraderReportForProductionAsset(tx as AiGraderProductionPrismaClient, input.reportId);
    const valuationId = `ai-grader-valuation:${input.reportId}`;
    const valuation = await tx.aiGraderValuation.upsert({
      where: { id: valuationId },
      update: {
        tenantId: input.tenantId,
        sessionId: stringValue(report.sessionId, "") || null,
        status: input.status,
        source: stringValue(input.source, "ebay_sold"),
        searchQuery: input.searchQuery ?? null,
        compsRefs: nullableJson(input.compsRefs),
        resultSummary: nullableJson(withActorAudit(input.resultSummary, input.actorAudit)),
        valuationMinor: input.valuationMinor ?? null,
        valuationCurrency: input.valuationCurrency ?? "USD",
        requestedByUserId: input.requestedByUserId ?? null,
        requestedAt: now,
        completedAt,
        errorCode: input.errorCode ?? null,
        updatedAt: now,
      },
      create: {
        id: valuationId,
        tenantId: input.tenantId,
        sessionId: stringValue(report.sessionId, "") || null,
        reportId: stringValue(report.id, ""),
        status: input.status,
        source: stringValue(input.source, "ebay_sold"),
        searchQuery: input.searchQuery ?? null,
        compsRefs: nullableJson(input.compsRefs),
        resultSummary: nullableJson(withActorAudit(input.resultSummary, input.actorAudit)),
        valuationMinor: input.valuationMinor ?? null,
        valuationCurrency: input.valuationCurrency ?? "USD",
        requestedByUserId: input.requestedByUserId ?? null,
        requestedAt: now,
        completedAt,
        errorCode: input.errorCode ?? null,
        createdAt: now,
        updatedAt: now,
      },
    });
    return {
      reportId: input.reportId,
      status: input.status,
      valuation,
    };
  });
}

export function createAiGraderProductionService(db: AiGraderProductionPrismaClient) {
  return {
    buildStoragePlan: buildAiGraderProductionStoragePlan,
    persistProductionRelease: (input: AiGraderProductionPersistInput) => persistAiGraderProductionRelease(db, input),
    persistSlabbedPhotoAsset: (input: AiGraderSlabbedPhotoPersistInput) => persistAiGraderSlabbedPhotoAsset(db, input),
    persistValuationResult: (input: AiGraderValuationPersistInput) => persistAiGraderValuationResult(db, input),
  };
}
