import type { AiGraderReportBundle, AiGraderReportPublicAsset } from "./aiGraderReportBundle";
import {
  fetchAiGraderStationReportAsset,
  fetchAiGraderStationReportBundle,
} from "./aiGraderStationBridgeClient";

export type AiGraderOcrPrefillField<T extends string | boolean | null = string | boolean | null> = {
  value: T;
  confidence: number;
  reviewRequired: boolean;
  sources: string[];
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
    productSet: AiGraderOcrPrefillField<string | null>;
    cardNumber: AiGraderOcrPrefillField<string | null>;
    parallel: AiGraderOcrPrefillField<string | null>;
    insert: AiGraderOcrPrefillField<string | null>;
    numbered: AiGraderOcrPrefillField<string | null>;
    auto: AiGraderOcrPrefillField<boolean | null>;
    mem: AiGraderOcrPrefillField<boolean | null>;
  };
  reviewFieldNames: string[];
  provenance: {
    ocrEngine: string;
    attributeExtractor: string;
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
  storageKey: string;
  publicUrl: string;
  uploadUrl: string;
  uploadMethod: "PUT";
  uploadHeaders: Record<string, string>;
};

type OcrInitResult = {
  reportId: string;
  uploadSessionId: string;
  humanConfirmationRequired: true;
  uploadPlan: OcrUploadPlan[];
  requiredFinalizeManifest: {
    reportId: string;
    uploadSessionId: string;
    images: Array<{
      side: "front" | "back";
      artifactRole: "normalized_card";
      fileName: string;
      mimeType: string;
      checksumSha256: string;
      byteSize: number;
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
  "productSet",
  "cardNumber",
  "parallel",
  "insert",
  "numbered",
  "auto",
  "mem",
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
        return [
          fieldName,
          {
            value: field.value,
            confidence: field.confidence,
            reviewRequired: field.reviewRequired,
            sources: [...field.sources],
          },
        ];
      })
    ) as AiGraderOcrPrefillResult["fields"],
    reviewFieldNames: [...result.reviewFieldNames],
    provenance: {
      ocrEngine: result.provenance.ocrEngine,
      attributeExtractor: result.provenance.attributeExtractor,
      setLookupUsed: result.provenance.setLookupUsed,
      setIdentificationUsed: result.provenance.setIdentificationUsed,
    },
    warnings: [...result.warnings],
  };
}

export function aiGraderOcrPrefillReportMetadata(result: AiGraderOcrPrefillResult): Record<string, unknown> {
  return safeAiGraderOcrPrefillResult(result) as unknown as Record<string, unknown>;
}

function normalizedAssetSide(asset: AiGraderReportPublicAsset): "front" | "back" | null {
  const text = `${asset.id ?? ""} ${asset.fileName ?? ""}`.toLowerCase().replace(/\\/g, "/");
  if (!/(normalized[-_/ ]card|normalized\/.*normalized-card)/.test(text)) return null;
  if (asset.side === "front" || /(^|\/)front(\/|-)/.test(text) || /front-normalized/.test(text)) return "front";
  if (asset.side === "back" || /(^|\/)back(\/|-)/.test(text) || /back-normalized/.test(text)) return "back";
  return null;
}

export function findAiGraderNormalizedOcrAssets(bundle: AiGraderReportBundle): NormalizedAsset[] {
  const assets = [...(bundle.assets ?? []), ...(bundle.publicAssets ?? [])];
  const selected = new Map<"front" | "back", AiGraderReportPublicAsset>();
  for (const asset of assets) {
    if (asset.kind && asset.kind !== "image") continue;
    const side = normalizedAssetSide(asset);
    if (!side || selected.has(side)) continue;
    selected.set(side, asset);
  }
  if (!selected.has("front") || !selected.has("back")) {
    throw new Error("Normalized front/back card artifacts are not available for OCR prefill yet.");
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
  const mimeType = String(value ?? "image/png").split(";")[0]?.trim().toLowerCase() ?? "image/png";
  if (!new Set(["image/png", "image/jpeg", "image/webp"]).has(mimeType)) {
    throw new Error(`Normalized OCR image content type ${mimeType} is not supported.`);
  }
  return mimeType;
}

async function jsonResponse<T>(response: Response, label: string): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok !== true) {
    throw new Error(payload?.message ?? `${label} failed with HTTP ${response.status}.`);
  }
  return payload.result as T;
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
  } = {}
): Promise<AiGraderOcrPrefillResult> {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const fetchBundle = dependencies.fetchBundle ?? fetchAiGraderStationReportBundle;
  const fetchAsset = dependencies.fetchAsset ?? fetchAiGraderStationReportAsset;
  const digestSha256 = dependencies.digestSha256 ?? sha256Hex;
  const bundle =
    input.bundle ??
    (await fetchBundle({
      baseUrl: input.baseUrl,
      stationToken: input.stationToken,
      reportId: input.reportId,
    }));
  const normalizedAssets = findAiGraderNormalizedOcrAssets(bundle);
  const localImages = [] as Array<{
    side: "front" | "back";
    assetId: string;
    bytes: ArrayBuffer;
    fileName: string;
    mimeType: string;
    checksumSha256: string;
    byteSize: number;
  }>;
  for (const { side, asset } of normalizedAssets) {
    const fetched = await fetchAsset({
      baseUrl: input.baseUrl,
      stationToken: input.stationToken,
      reportId: input.reportId,
      assetId: asset.id,
    });
    const checksumSha256 = (await digestSha256(fetched.bytes)).toLowerCase();
    const expectedChecksum = String(asset.checksumSha256 ?? asset.sha256 ?? fetched.checksumSha256 ?? "").toLowerCase();
    if (expectedChecksum && expectedChecksum !== checksumSha256) {
      throw new Error(`Normalized ${side} OCR image checksum does not match the local report manifest.`);
    }
    localImages.push({
      side,
      assetId: asset.id,
      bytes: fetched.bytes,
      fileName: asset.fileName || `${side}-normalized-card.png`,
      mimeType: normalizedMimeType(asset.contentType ?? fetched.contentType),
      checksumSha256,
      byteSize: fetched.bytes.byteLength,
    });
  }
  const authHeaders = { ...input.authHeaders, "content-type": "application/json" };
  const initResponse = await fetchImpl("/api/admin/ai-grader/production/ocr-prefill-init", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      reportId: input.reportId,
      images: localImages.map(({ side, fileName, mimeType, checksumSha256, byteSize }) => ({
        side,
        artifactRole: "normalized_card",
        fileName,
        mimeType,
        checksumSha256,
        byteSize,
      })),
    }),
  });
  const init = await jsonResponse<OcrInitResult>(initResponse, "OCR prefill upload planning");
  for (const localImage of localImages) {
    const plan = init.uploadPlan.find((entry) => entry.side === localImage.side);
    if (!plan) throw new Error(`OCR prefill upload plan is missing the normalized ${localImage.side} image.`);
    const uploadResponse = await fetchImpl(plan.uploadUrl, {
      method: plan.uploadMethod,
      headers: plan.uploadHeaders,
      body: new Blob([localImage.bytes], { type: localImage.mimeType }),
    });
    if (!uploadResponse.ok) {
      throw new Error(`Direct storage upload failed for normalized ${localImage.side} image with HTTP ${uploadResponse.status}.`);
    }
  }
  const finalizeResponse = await fetchImpl("/api/admin/ai-grader/production/ocr-prefill-finalize", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(init.requiredFinalizeManifest),
  });
  return safeAiGraderOcrPrefillResult(
    await jsonResponse<AiGraderOcrPrefillResult>(finalizeResponse, "OCR prefill finalize")
  );
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
  if (category === "sport" || category === "tcg" || category === "comics") {
    apply("category", category as T["category"], true);
  }
  for (const [resultKey, draftKey] of Object.entries(OCR_STRING_FIELD_MAP) as Array<
    [keyof typeof OCR_STRING_FIELD_MAP, (typeof OCR_STRING_FIELD_MAP)[keyof typeof OCR_STRING_FIELD_MAP]]
  >) {
    const value = input.result.fields[resultKey].value;
    if (typeof value === "string" && value.trim()) apply(draftKey as keyof T, value.trim() as T[keyof T]);
  }
  if (input.result.fields.auto.value === true) apply("autograph", true as T["autograph"]);
  if (input.result.fields.mem.value === true) apply("memorabilia", true as T["memorabilia"]);
  return { draft: next, appliedFields };
}
