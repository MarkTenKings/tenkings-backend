import type { AiGraderReportBundle, AiGraderReportPublicAsset } from "./aiGraderReportBundle";
import { AI_GRADER_REPORT_PRODUCER_CONTRACT_VERSION } from "./aiGraderLocalStation";
import {
  fetchAiGraderStationReportAsset,
  fetchAiGraderStationReportBundle,
} from "./aiGraderStationBridgeClient";
import { uploadAiGraderArtifactDirectly } from "./aiGraderDirectUpload";

export type AiGraderOcrPrefillStage =
  | "bundle_fetch"
  | "front_asset_fetch"
  | "back_asset_fetch"
  | "init"
  | "front_put"
  | "back_put"
  | "finalize"
  | "ocr_response";

const OCR_STAGE_MESSAGES: Record<AiGraderOcrPrefillStage, string> = {
  bundle_fetch: "OCR Prefill could not read the local report bundle. Update or re-export the existing report and retry.",
  front_asset_fetch: "OCR Prefill could not read the normalized front image from the local bridge.",
  back_asset_fetch: "OCR Prefill could not read the normalized back image from the local bridge.",
  init: "OCR Prefill upload initialization failed.",
  front_put: "OCR Prefill direct upload failed for the normalized front image.",
  back_put: "OCR Prefill direct upload failed for the normalized back image.",
  finalize: "OCR Prefill finalize request failed.",
  ocr_response: "OCR Prefill response was invalid or incomplete.",
};

export class AiGraderOcrPrefillStageError extends Error {
  readonly stage: AiGraderOcrPrefillStage;

  constructor(stage: AiGraderOcrPrefillStage, message = OCR_STAGE_MESSAGES[stage]) {
    super(message);
    this.name = "AiGraderOcrPrefillStageError";
    this.stage = stage;
  }
}

const OCR_NATIVE_CHECKSUM_BLOCKER =
  "OCR Prefill stopped because storage did not return a native SHA-256 checksum. Storage checksum support must be confirmed before retrying.";

export type AiGraderOcrPrefillField<T extends string | boolean | null = string | boolean | null> = {
  state: "supported" | "unknown" | "disagreement";
  value: T;
  confidence: number;
  reviewRequired: boolean;
  evidenceRefs: string[];
};

export type AiGraderOcrPrefillResult = {
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
  reportId?: string;
  result?: AiGraderOcrPrefillResult;
};

type NormalizedAsset = {
  side: "front" | "back";
  asset: AiGraderReportPublicAsset;
};

type OcrUploadPlan = {
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
  reportId: string;
  reportProducerContractVersion: typeof AI_GRADER_REPORT_PRODUCER_CONTRACT_VERSION;
  uploadSessionId: string;
  humanConfirmationRequired: true;
  uploadPlan: OcrUploadPlan[];
  requiredFinalizeManifest: {
    reportId: string;
    reportProducerContractVersion: typeof AI_GRADER_REPORT_PRODUCER_CONTRACT_VERSION;
    uploadSessionId: string;
    images: Array<{
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

export function safeAiGraderOcrPrefillResult(result: AiGraderOcrPrefillResult): AiGraderOcrPrefillResult {
  return {
    reportId: result.reportId,
    status: result.status,
    humanConfirmationRequired: true,
    inventoryMutationPerformed: false,
    publishMutationPerformed: false,
    sourceSides: [...result.sourceSides],
    fields: Object.fromEntries(
      OCR_RESULT_FIELD_NAMES.map((fieldName) => {
        const field = result.fields[fieldName];
        if (!field || !["supported", "unknown", "disagreement"].includes(field.state) ||
            !Array.isArray(field.evidenceRefs) ||
            (field.state === "supported" ? field.value === null : field.value !== null)) {
          throw new Error("Invalid OCR structured field.");
        }
        return [
          fieldName,
          {
            state: field.state,
            value: field.value,
            confidence: field.confidence,
            reviewRequired: field.reviewRequired,
            evidenceRefs: [...field.evidenceRefs],
          },
        ];
      })
    ) as AiGraderOcrPrefillResult["fields"],
    reviewFieldNames: [...result.reviewFieldNames],
    provenance: {
      ocrEngine: result.provenance.ocrEngine,
      attributeExtractor: result.provenance.attributeExtractor,
      structuredExtractor: result.provenance.structuredExtractor,
      structuredExtractionModel: result.provenance.structuredExtractionModel,
      setLookupUsed: result.provenance.setLookupUsed,
      setIdentificationUsed: result.provenance.setIdentificationUsed,
    },
    warnings: [...result.warnings],
  };
}

export function aiGraderOcrPrefillReportMetadata(result: AiGraderOcrPrefillResult): Record<string, unknown> {
  return safeAiGraderOcrPrefillResult(result) as unknown as Record<string, unknown>;
}

export function findAiGraderNormalizedOcrAssets(bundle: AiGraderReportBundle): NormalizedAsset[] {
  if (bundle.reportProducer?.contractVersion !== AI_GRADER_REPORT_PRODUCER_CONTRACT_VERSION) {
    throw new Error("OCR Prefill requires a current report-producer v0.2 package. Update the Dell helper and capture a new card.");
  }
  const normalizedAssets = [...(bundle.assets ?? []), ...(bundle.publicAssets ?? [])]
    .filter((asset) => asset.evidenceRole === "normalized_card");
  if (normalizedAssets.length !== 2) {
    throw new Error("OCR Prefill requires exactly one verified normalized front asset and one verified normalized back asset.");
  }
  const selected = new Map<"front" | "back", AiGraderReportPublicAsset>();
  const assetIds = new Set<string>();
  for (const asset of normalizedAssets) {
    const id = String(asset.id ?? "").trim();
    const side = asset.side;
    const checksum = String(asset.checksumSha256 ?? asset.sha256 ?? "").toLowerCase();
    const alternateChecksum = String(asset.sha256 ?? asset.checksumSha256 ?? "").toLowerCase();
    if (!id || assetIds.has(id)) throw new Error("Normalized OCR assets must have unique asset identities.");
    if (asset.kind !== "image" || (side !== "front" && side !== "back") || selected.has(side)) {
      throw new Error("Normalized OCR assets must contain one exact front image and one exact back image.");
    }
    if (asset.contentType?.toLowerCase() !== "image/png" ||
        asset.widthPx !== 1200 || asset.heightPx !== 1680) {
      throw new Error("Normalized OCR assets must be image/png at exactly 1200x1680.");
    }
    if (!/^[a-f0-9]{64}$/.test(checksum) || checksum !== alternateChecksum) {
      throw new Error("Normalized OCR assets must include one valid, consistent SHA-256 digest.");
    }
    if (!Number.isInteger(asset.byteSize) || Number(asset.byteSize) <= 0) {
      throw new Error("Normalized OCR assets must include a positive byte size.");
    }
    assetIds.add(id);
    selected.set(side, asset);
  }
  if (!selected.has("front") || !selected.has("back")) {
    throw new Error("Normalized OCR assets must contain one exact front image and one exact back image.");
  }
  return (["front", "back"] as const).map((side) => ({ side, asset: selected.get(side)! }));
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
  const baseName = String(value ?? "").replace(/\\/g, "/").split("/").pop()?.trim() ?? "";
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.png$/i.test(baseName)
    ? baseName
    : `${side}-normalized-card.png`;
}

async function responsePayload(response: Response): Promise<Record<string, any> | null> {
  try {
    const payload = await response.json();
    return typeof payload === "object" && payload !== null && !Array.isArray(payload) ? payload : null;
  } catch {
    return null;
  }
}

function isOcrInitResult(value: unknown): value is OcrInitResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const result = value as Partial<OcrInitResult>;
  return typeof result.reportId === "string" &&
    result.reportProducerContractVersion === AI_GRADER_REPORT_PRODUCER_CONTRACT_VERSION &&
    typeof result.uploadSessionId === "string" &&
    Array.isArray(result.uploadPlan) && typeof result.requiredFinalizeManifest === "object" &&
    result.requiredFinalizeManifest !== null;
}

function safeOcrResult(value: unknown, reportId: string) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AiGraderOcrPrefillStageError("ocr_response");
  }
  const result = value as AiGraderOcrPrefillResult;
  if (result.reportId !== reportId || result.status !== "prefill_ready" ||
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
    reportId: string;
    authHeaders: Record<string, string>;
    bundle?: AiGraderReportBundle;
  },
  dependencies: {
    fetchImpl?: typeof fetch;
    fetchBundle?: typeof fetchAiGraderStationReportBundle;
    fetchAsset?: typeof fetchAiGraderStationReportAsset;
    digestSha256?: (bytes: ArrayBuffer) => Promise<string>;
    uploadDirect?: typeof uploadAiGraderArtifactDirectly;
  } = {}
): Promise<AiGraderOcrPrefillResult> {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const fetchBundle = dependencies.fetchBundle ?? fetchAiGraderStationReportBundle;
  const fetchAsset = dependencies.fetchAsset ?? fetchAiGraderStationReportAsset;
  const digestSha256 = dependencies.digestSha256 ?? sha256Hex;
  const uploadDirect = dependencies.uploadDirect ?? uploadAiGraderArtifactDirectly;
  let bundle: AiGraderReportBundle;
  let normalizedAssets: NormalizedAsset[];
  try {
    bundle = input.bundle ?? await fetchBundle({
      baseUrl: input.baseUrl,
      stationToken: input.stationToken,
      reportId: input.reportId,
    });
    if (bundle.reportId !== input.reportId) throw new Error("report identity mismatch");
    normalizedAssets = findAiGraderNormalizedOcrAssets(bundle);
  } catch {
    throw new AiGraderOcrPrefillStageError("bundle_fetch");
  }
  const localImages = [] as Array<{
    side: "front" | "back";
    assetId: string;
    bytes: ArrayBuffer;
    fileName: string;
    mimeType: string;
    checksumSha256: string;
    byteSize: number;
    widthPx: 1200;
    heightPx: 1680;
  }>;
  for (const { side, asset } of normalizedAssets) {
    try {
      const fetched = await fetchAsset({
        baseUrl: input.baseUrl,
        stationToken: input.stationToken,
        reportId: input.reportId,
        assetId: asset.id,
      });
      const checksumSha256 = (await digestSha256(fetched.bytes)).toLowerCase();
      const expectedChecksum = String(asset.checksumSha256 ?? asset.sha256 ?? fetched.checksumSha256 ?? "").toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(checksumSha256) || (expectedChecksum && expectedChecksum !== checksumSha256)) {
        throw new Error("invalid local checksum");
      }
      if (fetched.bytes.byteLength !== asset.byteSize || fetched.byteSize !== asset.byteSize ||
          normalizedMimeType(fetched.contentType) !== "image/png") {
        throw new Error("invalid local normalized image metadata");
      }
      localImages.push({
        side,
        assetId: asset.id,
        bytes: fetched.bytes,
        fileName: safeNormalizedFileName(asset.fileName, side),
        mimeType: normalizedMimeType(asset.contentType),
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
        reportId: input.reportId,
        reportProducerContractVersion: AI_GRADER_REPORT_PRODUCER_CONTRACT_VERSION,
        images: localImages.map(({ side, fileName, mimeType, checksumSha256, byteSize, widthPx, heightPx }) => ({
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
    if (!initResponse.ok || payload?.ok !== true || !isOcrInitResult(payload.result) ||
        payload.result.reportId !== input.reportId || payload.result.uploadPlan.length !== localImages.length) {
      throw new Error("invalid init response");
    }
    init = payload.result;
  } catch {
    throw new AiGraderOcrPrefillStageError("init");
  }
  for (const localImage of localImages) {
    const plan = init.uploadPlan.find((entry) => entry.side === localImage.side);
    if (!plan) throw new AiGraderOcrPrefillStageError("init");
    try {
      await uploadDirect({
        purpose: "ocr",
        uploadUrl: plan.uploadUrl,
        uploadMethod: plan.uploadMethod,
        uploadHeaders: plan.uploadHeaders,
        contentType: localImage.mimeType,
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
      throw new AiGraderOcrPrefillStageError("finalize", OCR_NATIVE_CHECKSUM_BLOCKER);
    }
    throw new AiGraderOcrPrefillStageError("finalize");
  }
  if (finalizePayload?.ok !== true) throw new AiGraderOcrPrefillStageError("ocr_response");
  return safeOcrResult(finalizePayload.result, input.reportId);
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
