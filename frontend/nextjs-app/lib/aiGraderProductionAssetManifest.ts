import { isAiGraderReportBundleV03, type AiGraderStationReportBundle } from "./aiGraderReportBundle";

const AI_GRADER_EVIDENCE_ROLES = new Set([
  "normalized_card",
  "surface_heatmap",
  "surface_vision",
  "confidence_mask",
  "measurement_overlay",
  "deduction_overlay",
  "segmentation_mask",
  "illumination_mask",
  "common_mode_response",
  "outer_cut_contour",
  "printed_design_contour",
  "centering_overlay",
  "flat_field",
  "directional_channel",
  "roi_crop",
  "other_evidence",
]);

function safePixelDimension(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 100_000
    ? value
    : undefined;
}

export function productionAssetManifest(bundle: AiGraderStationReportBundle | null) {
  const assets = isAiGraderReportBundleV03(bundle)
    ? bundle.publicAssets
    : bundle?.assets ?? [];
  return assets
    .filter((asset) => {
      const haystack = `${asset.contentType ?? ""} ${asset.fileName ?? ""} ${asset.id ?? ""} ${asset.kind ?? ""}`.toLowerCase();
      return haystack.includes("image") || /\.(png|jpe?g|webp)$/i.test(asset.fileName ?? asset.id ?? "");
    })
    .map((asset) => {
      const checksumSha256 = asset.checksumSha256 ?? asset.sha256;
      const widthPx = safePixelDimension(asset.widthPx);
      const heightPx = safePixelDimension(asset.heightPx);
      const side = asset.side === "front" || asset.side === "back" ? asset.side : undefined;
      const evidenceRole = asset.evidenceRole && AI_GRADER_EVIDENCE_ROLES.has(asset.evidenceRole)
        ? asset.evidenceRole
        : undefined;
      return {
        id: asset.id,
        kind: asset.kind,
        fileName: asset.fileName,
        contentType: asset.contentType,
        checksumSha256,
        byteSize: asset.byteSize,
        ...(side ? { side } : {}),
        ...(evidenceRole ? { evidenceRole } : {}),
        ...(widthPx ? { widthPx } : {}),
        ...(heightPx ? { heightPx } : {}),
        required: true as const,
      };
    })
    .filter(
      (asset) =>
        typeof asset.checksumSha256 === "string" &&
        /^[a-f0-9]{64}$/i.test(asset.checksumSha256) &&
        typeof asset.byteSize === "number" &&
        Number.isSafeInteger(asset.byteSize) &&
        asset.byteSize > 0,
    );
}
