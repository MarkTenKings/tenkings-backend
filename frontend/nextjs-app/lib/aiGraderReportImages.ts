import type { AiGraderReportPublicAsset, AiGraderStationReportBundle } from "./aiGraderReportBundle";

type ReportAssetWithBody = AiGraderReportPublicAsset & {
  bodyEncoding?: "base64" | string;
  bodyBase64?: string;
};

export type AiGraderRenderableReportImage = ReportAssetWithBody & {
  renderUrl: string;
  renderSource: "public_url" | "embedded_body";
};

function imageLike(asset: AiGraderReportPublicAsset) {
  const haystack = `${asset.contentType ?? ""} ${asset.fileName ?? ""} ${asset.id ?? ""} ${asset.kind ?? ""}`.toLowerCase();
  return haystack.includes("image") || /\.(png|jpe?g|webp)$/i.test(asset.publicUrl ?? asset.fileName ?? asset.storageKey ?? asset.id ?? "");
}

function safePublicImageUrl(value: unknown) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
  return "";
}

function embeddedImageUrl(asset: ReportAssetWithBody, allowEmbeddedBodies: boolean) {
  if (!allowEmbeddedBodies) return "";
  if (!asset.bodyBase64 || (asset.bodyEncoding && asset.bodyEncoding !== "base64")) return "";
  const contentType = asset.contentType?.trim() || "image/png";
  if (!contentType.toLowerCase().startsWith("image/")) return "";
  return `data:${contentType};base64,${asset.bodyBase64}`;
}

export function reportImageAssets(
  bundle: AiGraderStationReportBundle,
  options: { allowEmbeddedBodies?: boolean; limit?: number } = {}
): AiGraderRenderableReportImage[] {
  const assets = (bundle.publicAssets ?? ("assets" in bundle ? bundle.assets : []) ?? []) as unknown as ReportAssetWithBody[];
  const deduped = new Map<string, AiGraderRenderableReportImage>();
  for (const asset of assets) {
    if (!asset || !imageLike(asset)) continue;
    const publicUrl = safePublicImageUrl(asset.publicUrl);
    const embeddedUrl = embeddedImageUrl(asset, options.allowEmbeddedBodies === true);
    const renderUrl = publicUrl || embeddedUrl;
    if (!renderUrl) continue;
    const key = publicUrl || asset.storageKey || asset.id || asset.fileName || renderUrl;
    if (deduped.has(key)) continue;
    deduped.set(key, {
      ...asset,
      renderUrl,
      renderSource: publicUrl ? "public_url" : "embedded_body",
    });
  }
  const images = Array.from(deduped.values());
  return typeof options.limit === "number" ? images.slice(0, options.limit) : images;
}

export function findReportImage(assets: AiGraderRenderableReportImage[], terms: string[]) {
  const normalizedTerms = terms.map((term) => term.toLowerCase());
  return assets.find((asset) => {
    const haystack = `${asset.id ?? ""} ${asset.fileName ?? ""} ${asset.storageKey ?? ""}`.toLowerCase();
    return normalizedTerms.every((term) => haystack.includes(term));
  });
}

export function findReportImageByExactAssetId(assets: AiGraderRenderableReportImage[], assetId: string | undefined) {
  if (!assetId) return undefined;
  return assets.find((asset) => asset.id === assetId);
}

export function findReportNormalizedCardImageByExactAssetId(
  assets: AiGraderRenderableReportImage[],
  assetId: string | undefined,
  side: "front" | "back",
) {
  const asset = findReportImageByExactAssetId(assets, assetId);
  return asset?.side === side && asset.evidenceRole === "normalized_card" ? asset : undefined;
}
