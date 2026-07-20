import { AI_GRADER_REPORT_PRODUCER_CONTRACT_VERSION } from "./aiGraderLocalStation";
import {
  fetchAiGraderQueuedOcrAsset,
  fetchAiGraderQueuedOcrDescriptor,
  type AiGraderQueuedOcrDescriptor,
} from "./aiGraderStationBridgeClient";
import { uploadAiGraderArtifactDirectly } from "./aiGraderDirectUpload";
import {
  aiGraderOcrFailurePresentation,
  isAiGraderOcrFailureCode,
  type AiGraderOcrFailureCategory,
  type AiGraderOcrFailureCode,
} from "./aiGraderOcrFailure";

export type AiGraderOcrPrefillStage =
  | "descriptor_fetch"
  | "front_asset_fetch"
  | "back_asset_fetch"
  | "init"
  | "front_put"
  | "back_put"
  | "finalize"
  | "provider"
  | "ocr_response";

const OCR_STAGE_MESSAGES: Record<AiGraderOcrPrefillStage, string> = {
  descriptor_fetch: "OCR Prefill could not read the exact queued normalized-image descriptor from the local bridge.",
  front_asset_fetch: "OCR Prefill could not read the normalized front image from the local bridge.",
  back_asset_fetch: "OCR Prefill could not read the normalized back image from the local bridge.",
  init: "OCR Prefill upload initialization failed.",
  front_put: "OCR Prefill direct upload failed for the normalized front image.",
  back_put: "OCR Prefill direct upload failed for the normalized back image.",
  finalize: "OCR Prefill finalize request failed.",
  provider: "OCR Prefill provider processing failed.",
  ocr_response: "OCR Prefill response was invalid or incomplete.",
};

export class AiGraderOcrPrefillStageError extends Error {
  readonly stage: AiGraderOcrPrefillStage;
  readonly failureCode?: AiGraderOcrFailureCode;
  readonly failureCategory?: AiGraderOcrFailureCategory;
  readonly failureLabel?: string;

  constructor(
    stage: AiGraderOcrPrefillStage,
    message = OCR_STAGE_MESSAGES[stage],
    failureCode?: AiGraderOcrFailureCode
  ) {
    super(message);
    this.name = "AiGraderOcrPrefillStageError";
    this.stage = stage;
    this.failureCode = failureCode;
    if (failureCode) {
      const presentation = aiGraderOcrFailurePresentation(failureCode);
      this.failureCategory = presentation.category;
      this.failureLabel = presentation.label;
    }
  }
}

const OCR_STORAGE_INTEGRITY_BLOCKER =
  "OCR Prefill stopped because the stored image bytes could not be verified by SHA-256.";

export type AiGraderOcrPrefillField<T extends string | boolean | null = string | boolean | null> = {
  state: "supported" | "unknown" | "disagreement";
  value: T;
  confidence: number;
  reviewRequired: boolean;
  evidenceRefs: string[];
};

export type AiGraderOcrPrefillResult = {
  queueItemId: string;
  gradingSessionId: string;
  reportId: string;
  status: "prefill_ready";
  humanConfirmationRequired: true;
  inventoryMutationPerformed: false;
  publishMutationPerformed: false;
  sourceSides: Array<"front" | "back">;
  fields: {
    category: AiGraderOcrPrefillField<string | null>;
    playerName: AiGraderOcrPrefillField<string | null>;
    cardName: AiGraderOcrPrefillField<string | null>;
    year: AiGraderOcrPrefillField<string | null>;
    manufacturer: AiGraderOcrPrefillField<string | null>;
    sport: AiGraderOcrPrefillField<string | null>;
    game: AiGraderOcrPrefillField<string | null>;
    productSet: AiGraderOcrPrefillField<string | null>;
    cardNumber: AiGraderOcrPrefillField<string | null>;
    parallel: AiGraderOcrPrefillField<string | null>;
    insert: AiGraderOcrPrefillField<string | null>;
    numbered: AiGraderOcrPrefillField<string | null>;
    autograph: AiGraderOcrPrefillField<boolean | null>;
    memorabilia: AiGraderOcrPrefillField<boolean | null>;
  };
  reviewFieldNames: string[];
  provenance: {
    ocrEngine: string;
    attributeExtractor: string;
    structuredExtractor: string;
    structuredExtractionModel: string;
    setLookupUsed: boolean;
    setIdentificationUsed: boolean;
  };
  warnings: string[];
};

export type AiGraderOcrPrefillState = {
  status: "idle" | "waiting" | "running" | "ready" | "failed";
  message: string;
  queueItemId?: string;
  gradingSessionId?: string;
  reportId?: string;
  result?: AiGraderOcrPrefillResult;
  failureCode?: AiGraderOcrFailureCode;
  failureCategory?: AiGraderOcrFailureCategory;
  failureLabel?: string;
};

export { fetchAiGraderQueuedOcrAsset, fetchAiGraderQueuedOcrDescriptor };
export type { AiGraderQueuedOcrDescriptor };

type OcrUploadPlan = {
  queueItemId: string;
  gradingSessionId: string;
  reportId: string;
  side: "front" | "back";
  artifactRole: "normalized_card";
  fileName: string;
  mimeType: string;
  checksumSha256: string;
  byteSize: number;
  widthPx: 1200;
  heightPx: 1680;
  storageKey: string;
  publicUrl: string;
  uploadUrl: string;
  uploadMethod: "PUT";
  uploadHeaders: Record<string, string>;
};

type OcrInitResult = {
  queueItemId: string;
  gradingSessionId: string;
  reportId: string;
  reportProducerContractVersion: typeof AI_GRADER_REPORT_PRODUCER_CONTRACT_VERSION;
  uploadSessionId: string;
  humanConfirmationRequired: true;
  uploadPlan: OcrUploadPlan[];
  requiredFinalizeManifest: {
    queueItemId: string;
    gradingSessionId: string;
    reportId: string;
    reportProducerContractVersion: typeof AI_GRADER_REPORT_PRODUCER_CONTRACT_VERSION;
    uploadSessionId: string;
    images: Array<{
      queueItemId: string;
      gradingSessionId: string;
      reportId: string;
      side: "front" | "back";
      artifactRole: "normalized_card";
      fileName: string;
      mimeType: string;
      checksumSha256: string;
      byteSize: number;
      widthPx: 1200;
      heightPx: 1680;
      storageKey: string;
    }>;
  };
};

export type AiGraderIdentityDraftLike = {
  category: "sport" | "tcg" | "comics";
  playerName: string;
  cardName: string;
  year: string;
  manufacturer: string;
  sport: string;
  game: string;
  productSet: string;
  cardNumber: string;
  insert: string;
  parallel: string;
  numbered: string;
  autograph: boolean;
  memorabilia: boolean;
};

const OCR_STRING_FIELD_MAP = {
  playerName: "playerName",
  cardName: "cardName",
  year: "year",
  manufacturer: "manufacturer",
  sport: "sport",
  game: "game",
  productSet: "productSet",
  cardNumber: "cardNumber",
  insert: "insert",
  parallel: "parallel",
  numbered: "numbered",
} as const;

const OCR_RESULT_FIELD_NAMES = [
  "category",
  "playerName",
  "cardName",
  "year",
  "manufacturer",
  "sport",
  "game",
  "productSet",
  "cardNumber",
  "parallel",
  "insert",
  "numbered",
  "autograph",
  "memorabilia",
] as const;

const OCR_BOOLEAN_FIELD_NAMES = new Set<string>(["autograph", "memorabilia"]);
const OCR_STRING_FIELD_NAMES = new Set<string>([
  "category",
  "playerName",
  "cardName",
  "year",
  "manufacturer",
  "sport",
  "game",
  "productSet",
  "cardNumber",
  "parallel",
  "insert",
  "numbered",
]);

export function safeAiGraderOcrPrefillResult(result: AiGraderOcrPrefillResult): AiGraderOcrPrefillResult {
  assertExactOcrIdentity(result);
  if (result.status !== "prefill_ready" || result.humanConfirmationRequired !== true ||
      result.inventoryMutationPerformed !== false || result.publishMutationPerformed !== false) {
    throw new Error("Invalid OCR result lifecycle contract.");
  }
  if (!Array.isArray(result.sourceSides) || result.sourceSides.length !== 2 ||
      result.sourceSides[0] !== "front" || result.sourceSides[1] !== "back") {
    throw new Error("OCR result requires the exact normalized front and back sources.");
  }
  if (!result.fields || typeof result.fields !== "object" || Array.isArray(result.fields)) {
    throw new Error("Invalid OCR structured fields.");
  }
  const fields = Object.fromEntries(
    OCR_RESULT_FIELD_NAMES.map((fieldName) => [fieldName, safeOcrResultField(fieldName, result.fields[fieldName])])
  ) as AiGraderOcrPrefillResult["fields"];
  const reviewFieldNames = safeReviewFieldNames(result.reviewFieldNames, fields);
  const provenance = safeOcrProvenance(result.provenance);
  const warnings = safeOcrWarnings(result.warnings);
  return {
    queueItemId: result.queueItemId,
    gradingSessionId: result.gradingSessionId,
    reportId: result.reportId,
    status: result.status,
    humanConfirmationRequired: true,
    inventoryMutationPerformed: false,
    publishMutationPerformed: false,
    sourceSides: ["front", "back"],
    fields,
    reviewFieldNames,
    provenance,
    warnings,
  };
}

export function aiGraderOcrPrefillReportMetadata(result: AiGraderOcrPrefillResult): Record<string, unknown> {
  return safeAiGraderOcrPrefillResult(result) as unknown as Record<string, unknown>;
}

type AiGraderOcrExactIdentity = {
  queueItemId: string;
  gradingSessionId: string;
  reportId: string;
};

function isSafeExactId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(value);
}

function assertExactOcrIdentity(value: AiGraderOcrExactIdentity) {
  if (!isSafeExactId(value.queueItemId) || !isSafeExactId(value.gradingSessionId) || !isSafeExactId(value.reportId)) {
    throw new Error("OCR Prefill requires exact safe queue, grading-session, and report identities.");
  }
}

function sameExactOcrIdentity(left: AiGraderOcrExactIdentity, right: AiGraderOcrExactIdentity) {
  return left.queueItemId === right.queueItemId &&
    left.gradingSessionId === right.gradingSessionId &&
    left.reportId === right.reportId;
}

function safeBoundedOcrText(value: unknown, maxLength: number) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > maxLength ||
      /[\u0000-\u001f\u007f]/.test(value) || /https?:\/\/|^data:|^[a-z]:\\|^\\\\/i.test(value)) {
    throw new Error("Invalid bounded OCR result text.");
  }
  return value;
}

function safeOcrResultField(
  fieldName: (typeof OCR_RESULT_FIELD_NAMES)[number],
  value: unknown,
): AiGraderOcrPrefillField {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid OCR structured field ${fieldName}.`);
  }
  const field = value as Partial<AiGraderOcrPrefillField>;
  if (field.state !== "supported" && field.state !== "unknown" && field.state !== "disagreement") {
    throw new Error(`Invalid OCR structured field state for ${fieldName}.`);
  }
  let fieldValue: string | boolean | null = null;
  if (field.state === "supported") {
    if (OCR_BOOLEAN_FIELD_NAMES.has(fieldName)) {
      if (typeof field.value !== "boolean") throw new Error(`Invalid OCR boolean field ${fieldName}.`);
      fieldValue = field.value;
    } else if (OCR_STRING_FIELD_NAMES.has(fieldName)) {
      fieldValue = safeBoundedOcrText(field.value, 500);
      if (fieldName === "category" && !["sport", "tcg", "comics"].includes(fieldValue)) {
        throw new Error("Invalid OCR category field.");
      }
    }
  } else if (field.value !== null) {
    throw new Error(`Unsupported OCR field ${fieldName} must have a null value.`);
  }
  if (typeof field.confidence !== "number" || !Number.isFinite(field.confidence) ||
      field.confidence < 0 || field.confidence > 1 || typeof field.reviewRequired !== "boolean" ||
      !Array.isArray(field.evidenceRefs) || field.evidenceRefs.length > 24) {
    throw new Error(`Invalid OCR confidence or review contract for ${fieldName}.`);
  }
  const expectedReviewRequired = field.state !== "supported" || field.confidence < 0.8;
  if (field.reviewRequired !== expectedReviewRequired) {
    throw new Error(`OCR review requirement does not match ${fieldName} state and confidence.`);
  }
  const evidenceRefs = field.evidenceRefs.map((entry) => {
    const evidenceRef = safeBoundedOcrText(entry, 192);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(evidenceRef)) {
      throw new Error(`Invalid OCR evidence reference for ${fieldName}.`);
    }
    return evidenceRef;
  });
  if (new Set(evidenceRefs).size !== evidenceRefs.length ||
      (field.state === "supported" && evidenceRefs.length < 1)) {
    throw new Error(`Invalid OCR evidence reference set for ${fieldName}.`);
  }
  return {
    state: field.state,
    value: fieldValue,
    confidence: field.confidence,
    reviewRequired: field.reviewRequired,
    evidenceRefs,
  };
}

function safeReviewFieldNames(value: unknown, fields: AiGraderOcrPrefillResult["fields"]) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string") ||
      new Set(value).size !== value.length ||
      value.some((entry) => !OCR_RESULT_FIELD_NAMES.includes(entry as (typeof OCR_RESULT_FIELD_NAMES)[number]))) {
    throw new Error("Invalid OCR review-field list.");
  }
  const expected = OCR_RESULT_FIELD_NAMES.filter((fieldName) => fields[fieldName].reviewRequired);
  if (value.length !== expected.length || expected.some((fieldName) => !value.includes(fieldName))) {
    throw new Error("OCR review-field list does not match the structured fields.");
  }
  return [...value] as string[];
}

function safeOcrProvenance(value: unknown): AiGraderOcrPrefillResult["provenance"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid OCR provenance.");
  const provenance = value as Partial<AiGraderOcrPrefillResult["provenance"]>;
  if (provenance.ocrEngine !== "google_vision_document_text_detection_url_only" ||
      provenance.attributeExtractor !== "@tenkings/shared/extractCardAttributes" ||
      provenance.structuredExtractor !== "openai_responses_strict_json_schema" ||
      typeof provenance.structuredExtractionModel !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(provenance.structuredExtractionModel) ||
      typeof provenance.setLookupUsed !== "boolean" || typeof provenance.setIdentificationUsed !== "boolean") {
    throw new Error("Invalid OCR provenance contract.");
  }
  return {
    ocrEngine: provenance.ocrEngine,
    attributeExtractor: provenance.attributeExtractor,
    structuredExtractor: provenance.structuredExtractor,
    structuredExtractionModel: provenance.structuredExtractionModel,
    setLookupUsed: provenance.setLookupUsed,
    setIdentificationUsed: provenance.setIdentificationUsed,
  };
}

function safeOcrWarnings(value: unknown) {
  if (!Array.isArray(value) || value.length > 24 || value.some((warning) => typeof warning !== "string")) {
    throw new Error("Invalid OCR warning list.");
  }
  return value.map((warning) => safeBoundedOcrText(warning, 500));
}

function safeQueuedOcrDescriptor(value: unknown, expected: AiGraderOcrExactIdentity): AiGraderQueuedOcrDescriptor {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("invalid queued OCR descriptor");
  const descriptor = value as Partial<AiGraderQueuedOcrDescriptor>;
  if (!sameExactOcrIdentity(descriptor as AiGraderOcrExactIdentity, expected) ||
      descriptor.status !== "in_flight" ||
      !Array.isArray(descriptor.images) || descriptor.images.length !== 2) {
    throw new Error("queued OCR identity or lifecycle mismatch");
  }
  const sides = new Set<string>();
  const images = descriptor.images.map((image) => {
    if (!image || (image.side !== "front" && image.side !== "back") || sides.has(image.side) ||
        image.artifactRole !== "normalized_card" || image.mimeType !== "image/png" ||
        image.widthPx !== 1200 || image.heightPx !== 1680 ||
        !/^[a-f0-9]{64}$/.test(String(image.checksumSha256 ?? "").toLowerCase()) ||
        !Number.isSafeInteger(image.byteSize) || Number(image.byteSize) <= 0) {
      throw new Error("queued OCR normalized image descriptor is invalid");
    }
    sides.add(image.side);
    return {
      side: image.side,
      artifactRole: "normalized_card" as const,
      fileName: safeNormalizedFileName(image.fileName, image.side),
      mimeType: "image/png" as const,
      checksumSha256: image.checksumSha256.toLowerCase(),
      byteSize: image.byteSize,
      widthPx: 1200 as const,
      heightPx: 1680 as const,
    };
  });
  if (!sides.has("front") || !sides.has("back")) throw new Error("queued OCR requires both exact sides");
  return { ...expected, status: descriptor.status, images };
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(bytes: ArrayBuffer) {
  if (!globalThis.crypto?.subtle) throw new Error("Browser SHA-256 support is required for OCR direct upload.");
  return hex(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes)));
}

function normalizedMimeType(value: string | undefined) {
  const mimeType = String(value ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (mimeType !== "image/png") throw new Error("Normalized OCR images must use image/png.");
  return "image/png";
}

function safeNormalizedFileName(value: string | undefined, side: "front" | "back") {
  const exactName = String(value ?? "").trim();
  if (exactName !== `${side}-normalized-card.png`) {
    throw new Error(`Queued OCR ${side} normalized image file name is invalid.`);
  }
  if (exactName.includes("/") || exactName.includes("\\") ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.png$/i.test(exactName)) {
    throw new Error(`Queued OCR ${side} normalized image file name is invalid.`);
  }
  return exactName;
}

async function responsePayload(response: Response): Promise<Record<string, any> | null> {
  try {
    const payload = await response.json();
    return typeof payload === "object" && payload !== null && !Array.isArray(payload) ? payload : null;
  } catch {
    return null;
  }
}

function isOcrInitResult(value: unknown, expected: AiGraderOcrExactIdentity): value is OcrInitResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const result = value as Partial<OcrInitResult>;
  const finalize = result.requiredFinalizeManifest as Partial<OcrInitResult["requiredFinalizeManifest"]> | undefined;
  const uploadSessionId = result.uploadSessionId;
  const uploadPlan = result.uploadPlan;
  const finalizeImages = finalize?.images;
  const exactSides = (entries: Array<{ side?: unknown }>) =>
    entries.length === 2 && entries[0]?.side !== entries[1]?.side &&
    entries.every((entry) => entry.side === "front" || entry.side === "back");
  return sameExactOcrIdentity(result as AiGraderOcrExactIdentity, expected) &&
    result.reportProducerContractVersion === AI_GRADER_REPORT_PRODUCER_CONTRACT_VERSION &&
    typeof uploadSessionId === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(uploadSessionId) &&
    result.humanConfirmationRequired === true &&
    Array.isArray(uploadPlan) && exactSides(uploadPlan) &&
    uploadPlan.every((image) => sameExactOcrIdentity(image, expected)) &&
    typeof finalize === "object" && finalize !== null &&
    sameExactOcrIdentity(finalize as AiGraderOcrExactIdentity, expected) &&
    finalize.reportProducerContractVersion === AI_GRADER_REPORT_PRODUCER_CONTRACT_VERSION &&
    finalize.uploadSessionId === uploadSessionId &&
    Array.isArray(finalizeImages) && exactSides(finalizeImages) &&
    finalizeImages.every((image) => sameExactOcrIdentity(image, expected));
}

function safeOcrResult(value: unknown, identity: AiGraderOcrExactIdentity) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AiGraderOcrPrefillStageError("ocr_response");
  }
  const result = value as AiGraderOcrPrefillResult;
  if (!sameExactOcrIdentity(result, identity) || result.status !== "prefill_ready" ||
      result.humanConfirmationRequired !== true || !result.fields || !Array.isArray(result.sourceSides)) {
    throw new AiGraderOcrPrefillStageError("ocr_response");
  }
  try {
    return safeAiGraderOcrPrefillResult(result);
  } catch {
    throw new AiGraderOcrPrefillStageError("ocr_response");
  }
}

export async function runAiGraderOcrPrefillFromLocalReport(
  input: {
    baseUrl: string;
    stationToken: string;
    queueItemId: string;
    gradingSessionId: string;
    reportId: string;
    authHeaders: Record<string, string>;
  },
  dependencies: {
    fetchImpl?: typeof fetch;
    fetchDescriptor?: typeof fetchAiGraderQueuedOcrDescriptor;
    fetchAsset?: typeof fetchAiGraderQueuedOcrAsset;
    digestSha256?: (bytes: ArrayBuffer) => Promise<string>;
    uploadDirect?: typeof uploadAiGraderArtifactDirectly;
  } = {}
): Promise<AiGraderOcrPrefillResult> {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const fetchDescriptor = dependencies.fetchDescriptor ?? fetchAiGraderQueuedOcrDescriptor;
  const fetchAsset = dependencies.fetchAsset ?? fetchAiGraderQueuedOcrAsset;
  const digestSha256 = dependencies.digestSha256 ?? sha256Hex;
  const uploadDirect = dependencies.uploadDirect ?? uploadAiGraderArtifactDirectly;
  const identity = {
    queueItemId: input.queueItemId,
    gradingSessionId: input.gradingSessionId,
    reportId: input.reportId,
  };
  try {
    assertExactOcrIdentity(identity);
  } catch {
    throw new AiGraderOcrPrefillStageError("descriptor_fetch");
  }
  let descriptor: AiGraderQueuedOcrDescriptor;
  try {
    const fetched = await fetchDescriptor({
      baseUrl: input.baseUrl,
      stationToken: input.stationToken,
      ...identity,
    });
    descriptor = safeQueuedOcrDescriptor(fetched, identity);
  } catch {
    throw new AiGraderOcrPrefillStageError("descriptor_fetch");
  }
  const localImages = [] as Array<{
    queueItemId: string;
    gradingSessionId: string;
    reportId: string;
    side: "front" | "back";
    bytes: ArrayBuffer;
    fileName: string;
    mimeType: string;
    checksumSha256: string;
    byteSize: number;
    widthPx: 1200;
    heightPx: 1680;
  }>;
  for (const image of descriptor.images) {
    const { side } = image;
    try {
      const fetched = await fetchAsset({
        baseUrl: input.baseUrl,
        stationToken: input.stationToken,
        ...identity,
        side,
      });
      const checksumSha256 = (await digestSha256(fetched.bytes)).toLowerCase();
      const bridgeChecksumSha256 = String(fetched.checksumSha256 ?? "").toLowerCase();
      if (!sameExactOcrIdentity(fetched, identity) || fetched.side !== side ||
          !/^[a-f0-9]{64}$/.test(checksumSha256) ||
          bridgeChecksumSha256 !== image.checksumSha256 ||
          checksumSha256 !== image.checksumSha256) {
        throw new Error("invalid local checksum");
      }
      if (fetched.bytes.byteLength !== image.byteSize || fetched.byteSize !== image.byteSize ||
          normalizedMimeType(fetched.contentType) !== "image/png") {
        throw new Error("invalid local normalized image metadata");
      }
      localImages.push({
        ...identity,
        side,
        bytes: fetched.bytes,
        fileName: image.fileName,
        mimeType: "image/png",
        checksumSha256,
        byteSize: fetched.bytes.byteLength,
        widthPx: 1200,
        heightPx: 1680,
      });
    } catch {
      throw new AiGraderOcrPrefillStageError(side === "front" ? "front_asset_fetch" : "back_asset_fetch");
    }
  }
  const authHeaders = { ...input.authHeaders, "content-type": "application/json" };
  let init: OcrInitResult;
  try {
    const initResponse = await fetchImpl("/api/admin/ai-grader/production/ocr-prefill-init", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        ...identity,
        reportProducerContractVersion: AI_GRADER_REPORT_PRODUCER_CONTRACT_VERSION,
        images: localImages.map(({ queueItemId, gradingSessionId, reportId, side, fileName, mimeType, checksumSha256, byteSize, widthPx, heightPx }) => ({
          queueItemId,
          gradingSessionId,
          reportId,
          side,
          artifactRole: "normalized_card",
          fileName,
          mimeType,
          checksumSha256,
          byteSize,
          widthPx,
          heightPx,
        })),
      }),
    });
    const payload = await responsePayload(initResponse);
    if (!initResponse.ok || payload?.ok !== true || !isOcrInitResult(payload.result, identity) ||
        payload.result.uploadPlan.length !== localImages.length) {
      throw new Error("invalid init response");
    }
    init = payload.result;
  } catch {
    throw new AiGraderOcrPrefillStageError("init");
  }
  const validatedUploads = localImages.map((localImage) => {
    const plan = init.uploadPlan.find((entry) => entry.side === localImage.side);
    const finalizeImage = init.requiredFinalizeManifest.images.find((entry) => entry.side === localImage.side);
    if (!plan || !sameExactOcrIdentity(plan, identity) ||
        !finalizeImage || !sameExactOcrIdentity(finalizeImage, identity) ||
        plan.artifactRole !== "normalized_card" || plan.mimeType !== "image/png" ||
        plan.fileName !== localImage.fileName ||
        plan.checksumSha256 !== localImage.checksumSha256 || plan.byteSize !== localImage.byteSize ||
        plan.widthPx !== 1200 || plan.heightPx !== 1680 || plan.uploadMethod !== "PUT" ||
        typeof plan.storageKey !== "string" || !plan.storageKey || plan.storageKey.length > 1024 ||
        typeof plan.uploadUrl !== "string" || !plan.uploadUrl ||
        !plan.uploadHeaders || typeof plan.uploadHeaders !== "object" || Array.isArray(plan.uploadHeaders) ||
        finalizeImage.artifactRole !== plan.artifactRole || finalizeImage.fileName !== plan.fileName ||
        finalizeImage.mimeType !== plan.mimeType || finalizeImage.checksumSha256 !== plan.checksumSha256 ||
        finalizeImage.byteSize !== plan.byteSize || finalizeImage.widthPx !== plan.widthPx ||
        finalizeImage.heightPx !== plan.heightPx || finalizeImage.storageKey !== plan.storageKey) {
      throw new AiGraderOcrPrefillStageError("init");
    }
    return { localImage, plan };
  });
  for (const { localImage, plan } of validatedUploads) {
    try {
      await uploadDirect({
        purpose: "ocr",
        uploadUrl: plan.uploadUrl,
        uploadMethod: plan.uploadMethod,
        uploadHeaders: plan.uploadHeaders,
        contentType: localImage.mimeType,
        checksumSha256: localImage.checksumSha256,
        body: new Blob([localImage.bytes], { type: localImage.mimeType }),
      }, fetchImpl);
    } catch {
      throw new AiGraderOcrPrefillStageError(localImage.side === "front" ? "front_put" : "back_put");
    }
  }
  let finalizeResponse: Response;
  try {
    finalizeResponse = await fetchImpl("/api/admin/ai-grader/production/ocr-prefill-finalize", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(init.requiredFinalizeManifest),
    });
  } catch {
    throw new AiGraderOcrPrefillStageError("finalize");
  }
  const finalizePayload = await responsePayload(finalizeResponse);
  if (!finalizeResponse.ok) {
    if (finalizePayload?.code === "AI_GRADER_STORAGE_CHECKSUM_UNAVAILABLE") {
      throw new AiGraderOcrPrefillStageError("finalize", OCR_STORAGE_INTEGRITY_BLOCKER);
    }
    const failureCode = finalizePayload?.code;
    if (isAiGraderOcrFailureCode(failureCode)) {
      const presentation = aiGraderOcrFailurePresentation(failureCode);
      throw new AiGraderOcrPrefillStageError("provider", presentation.message, failureCode);
    }
    throw new AiGraderOcrPrefillStageError("finalize");
  }
  if (finalizePayload?.ok !== true) throw new AiGraderOcrPrefillStageError("ocr_response");
  return safeOcrResult(finalizePayload.result, identity);
}

export function mergeAiGraderOcrPrefillIntoIdentityDraft<T extends AiGraderIdentityDraftLike>(input: {
  current: T;
  result: AiGraderOcrPrefillResult;
  operatorEditedFields: ReadonlySet<keyof T>;
}) {
  const next = { ...input.current };
  const appliedFields: Array<keyof T> = [];
  const apply = <K extends keyof T>(key: K, value: T[K], allowDefaultCategory = false) => {
    if (input.operatorEditedFields.has(key)) return;
    const currentValue = input.current[key];
    const isEmpty = typeof currentValue === "string" ? currentValue.trim().length === 0 : currentValue === false;
    if (!isEmpty && !allowDefaultCategory) return;
    next[key] = value;
    appliedFields.push(key);
  };
  const category = input.result.fields.category.value;
  if (input.result.fields.category.state === "supported" &&
      (category === "sport" || category === "tcg" || category === "comics")) {
    apply("category", category as T["category"], true);
  }
  for (const [resultKey, draftKey] of Object.entries(OCR_STRING_FIELD_MAP) as Array<
    [keyof typeof OCR_STRING_FIELD_MAP, (typeof OCR_STRING_FIELD_MAP)[keyof typeof OCR_STRING_FIELD_MAP]]
  >) {
    const field = input.result.fields[resultKey];
    const value = field.value;
    if ((draftKey === "playerName" || draftKey === "sport") && next.category !== "sport") continue;
    if ((draftKey === "cardName" || draftKey === "game") && next.category === "sport") continue;
    if (field.state === "supported" && typeof value === "string" && value.trim()) {
      apply(draftKey as keyof T, value.trim() as T[keyof T]);
    }
  }
  if (input.result.fields.autograph.state === "supported") {
    apply("autograph", (input.result.fields.autograph.value === true) as T["autograph"]);
  }
  if (input.result.fields.memorabilia.state === "supported") {
    apply("memorabilia", (input.result.fields.memorabilia.value === true) as T["memorabilia"]);
  }
  return { draft: next, appliedFields };
}
