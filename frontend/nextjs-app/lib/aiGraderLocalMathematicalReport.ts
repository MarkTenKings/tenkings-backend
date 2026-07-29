import type { AiGraderReportBundleV03 } from "@tenkings/shared";
import { assertAiGraderBrowserRaster } from "./aiGraderRasterValidation";

const SAFE_LOCAL_REPORT_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const MAX_CURATED_ASSET_COUNT = 96;
const MAX_CURATED_ASSET_BYTES = 256 * 1024 * 1024;
const MAX_CURATED_ASSET_CONCURRENCY = 4;

type PublicAsset = AiGraderReportBundleV03["publicAssets"][number];

export type AiGraderLocalMathematicalAssetResponse = {
  reportId: string;
  assetId: string;
  bytes: ArrayBuffer;
  contentType: string;
  byteSize: number;
  checksumSha256?: string;
};

export type AiGraderLocalMathematicalAssetSet = {
  reportId: string;
  assetIds: string[];
  urlsByAssetId: Record<string, string>;
  objectUrls: string[];
};

export type AiGraderLocalMathematicalAssetDependencies = {
  fetchAsset(input: {
    reportId: string;
    assetId: string;
    signal?: AbortSignal;
  }): Promise<AiGraderLocalMathematicalAssetResponse>;
  createObjectUrl(blob: Blob): string;
  revokeObjectUrl(url: string): void;
  sha256Hex(bytes: ArrayBuffer): Promise<string>;
  assertRaster(
    bytes: ArrayBuffer,
    contentType: string,
    dimensions?: { widthPx: number; heightPx: number },
  ): Promise<{ widthPx: number; heightPx: number }>;
};

function normalizedImageType(value: string | undefined) {
  const normalized = value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return SAFE_LOCAL_REPORT_IMAGE_TYPES.has(normalized) ? normalized : undefined;
}

function exactAssetHash(asset: PublicAsset) {
  const sha256 = asset.sha256?.toLowerCase();
  const checksumSha256 = asset.checksumSha256?.toLowerCase();
  if (sha256 && checksumSha256 && sha256 !== checksumSha256) {
    throw new Error(`Strict Mathematical V1 asset ${asset.id} declares conflicting hashes.`);
  }
  const expected = sha256 ?? checksumSha256;
  if (!expected || !/^[a-f0-9]{64}$/.test(expected)) {
    throw new Error(`Strict Mathematical V1 asset ${asset.id} has no exact SHA-256.`);
  }
  return expected;
}

function addAssetId(target: Set<string>, assetId: string | undefined) {
  if (assetId) target.add(assetId.toLowerCase());
}

/**
 * Selects only evidence used by the advanced Mathematical V1 presentation.
 * Directional-channel files remain hash-linked in the report but are not bulk
 * downloaded by the local review viewer.
 */
export function curatedAiGraderMathematicalAssetMetadata(
  bundle: AiGraderReportBundleV03,
): PublicAsset[] {
  const selectedIds = new Set<string>();
  for (const side of [bundle.centeringEvidence.front, bundle.centeringEvidence.back]) {
    addAssetId(selectedIds, side.measurementOverlayAssetId);
    addAssetId(selectedIds, side.outerCutGeometryEvidence?.normalizedAllOnAssetId);
  }
  for (const observation of [
    ...bundle.conditionObservationEvidence.corners,
    ...bundle.conditionObservationEvidence.edges,
  ]) {
    addAssetId(selectedIds, observation.roiAssetId);
    addAssetId(selectedIds, observation.segmentationMaskAssetId);
    addAssetId(selectedIds, observation.illuminationMaskAssetId);
  }
  for (const finding of bundle.defectFindings) {
    addAssetId(selectedIds, finding.evidence.trueViewAssetId);
    addAssetId(selectedIds, finding.evidence.overlayAssetId);
    addAssetId(selectedIds, finding.evidence.segmentationMaskAssetId);
    addAssetId(selectedIds, finding.evidence.heatmapAssetId);
    addAssetId(selectedIds, finding.evidence.surfaceVisionAssetId);
  }
  for (const limitation of bundle.evidenceQualityLimitations) {
    for (const assetId of limitation.evidenceAssetIds) addAssetId(selectedIds, assetId);
  }
  for (const asset of bundle.publicAssets) {
    if (
      asset.evidenceRole === "normalized_card" ||
      asset.evidenceRole === "surface_vision" ||
      asset.evidenceRole === "surface_heatmap"
    ) {
      addAssetId(selectedIds, asset.id);
    }
  }

  const assetsById = new Map(
    bundle.publicAssets.map((asset) => [asset.id.toLowerCase(), asset] as const),
  );
  const missingIds = [...selectedIds].filter((assetId) => !assetsById.has(assetId));
  if (missingIds.length) {
    throw new Error(
      `Strict Mathematical V1 curated evidence is missing declared asset ${missingIds[0]}.`,
    );
  }
  const selected = bundle.publicAssets.filter((asset) =>
    selectedIds.has(asset.id.toLowerCase()));
  if (selected.length < 1 || selected.length > MAX_CURATED_ASSET_COUNT) {
    throw new Error(
      `Strict Mathematical V1 curated evidence count must be between 1 and ${MAX_CURATED_ASSET_COUNT}.`,
    );
  }
  let totalBytes = 0;
  for (const asset of selected) {
    if (
      !Number.isSafeInteger(asset.byteSize) ||
      !asset.byteSize ||
      asset.byteSize < 1
    ) {
      throw new Error(`Strict Mathematical V1 asset ${asset.id} has no exact byte size.`);
    }
    if (!normalizedImageType(asset.contentType)) {
      throw new Error(`Strict Mathematical V1 asset ${asset.id} has an unsafe image MIME type.`);
    }
    exactAssetHash(asset);
    totalBytes += asset.byteSize;
  }
  if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_CURATED_ASSET_BYTES) {
    throw new Error("Strict Mathematical V1 curated evidence exceeds the browser byte bound.");
  }
  return selected;
}

async function browserSha256Hex(bytes: ArrayBuffer) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

const defaultDependencies: Omit<
  AiGraderLocalMathematicalAssetDependencies,
  "fetchAsset"
> = {
  createObjectUrl: (blob) => globalThis.URL.createObjectURL(blob),
  revokeObjectUrl: (url) => globalThis.URL.revokeObjectURL(url),
  sha256Hex: browserSha256Hex,
  assertRaster: assertAiGraderBrowserRaster,
};

export async function loadAiGraderLocalMathematicalAssets(input: {
  bundle: AiGraderReportBundleV03;
  reportId: string;
  signal?: AbortSignal;
  fetchAsset: AiGraderLocalMathematicalAssetDependencies["fetchAsset"];
  dependencies?: Partial<
    Omit<AiGraderLocalMathematicalAssetDependencies, "fetchAsset">
  >;
}): Promise<AiGraderLocalMathematicalAssetSet> {
  if (input.bundle.reportId !== input.reportId) {
    throw new Error("Strict Mathematical V1 report identity changed before asset hydration.");
  }
  const dependencies = {
    ...defaultDependencies,
    ...input.dependencies,
    fetchAsset: input.fetchAsset,
  };
  const assets = curatedAiGraderMathematicalAssetMetadata(input.bundle);
  const urlsByAssetId: Record<string, string> = {};
  const objectUrls: string[] = [];
  let nextIndex = 0;

  const loadOne = async (asset: PublicAsset) => {
    if (input.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const response = await dependencies.fetchAsset({
      reportId: input.reportId,
      assetId: asset.id,
      signal: input.signal,
    });
    if (
      response.reportId !== input.reportId ||
      response.assetId !== asset.id
    ) {
      throw new Error(
        `Strict Mathematical V1 bridge asset identity mismatch for ${asset.id}.`,
      );
    }
    const expectedType = normalizedImageType(asset.contentType);
    const responseType = normalizedImageType(response.contentType);
    if (!expectedType || responseType !== expectedType) {
      throw new Error(`Strict Mathematical V1 asset ${asset.id} MIME type mismatch.`);
    }
    if (
      response.byteSize !== asset.byteSize ||
      response.bytes.byteLength !== asset.byteSize
    ) {
      throw new Error(`Strict Mathematical V1 asset ${asset.id} byte size mismatch.`);
    }
    const expectedHash = exactAssetHash(asset);
    if (
      response.checksumSha256?.toLowerCase() !== expectedHash ||
      (await dependencies.sha256Hex(response.bytes)).toLowerCase() !== expectedHash
    ) {
      throw new Error(`Strict Mathematical V1 asset ${asset.id} SHA-256 mismatch.`);
    }
    await dependencies.assertRaster(
      response.bytes,
      expectedType,
      asset.widthPx && asset.heightPx
        ? { widthPx: asset.widthPx, heightPx: asset.heightPx }
        : undefined,
    );
    if (input.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const objectUrl = dependencies.createObjectUrl(
      new Blob([response.bytes], { type: expectedType }),
    );
    urlsByAssetId[asset.id] = objectUrl;
    objectUrls.push(objectUrl);
  };

  const worker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= assets.length) return;
      await loadOne(assets[index]);
    }
  };

  try {
    await Promise.all(
      Array.from(
        { length: Math.min(MAX_CURATED_ASSET_CONCURRENCY, assets.length) },
        () => worker(),
      ),
    );
    return {
      reportId: input.reportId,
      assetIds: assets.map((asset) => asset.id),
      urlsByAssetId,
      objectUrls,
    };
  } catch (error) {
    for (const objectUrl of objectUrls) dependencies.revokeObjectUrl(objectUrl);
    throw error;
  }
}

export function revokeAiGraderLocalMathematicalAssets(
  assets: Pick<AiGraderLocalMathematicalAssetSet, "objectUrls"> | undefined,
  revokeObjectUrl: (url: string) => void = (url) =>
    globalThis.URL.revokeObjectURL(url),
) {
  for (const objectUrl of assets?.objectUrls ?? []) revokeObjectUrl(objectUrl);
}
