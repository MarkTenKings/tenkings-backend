type JsonRecord = Record<string, any>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export type AiGraderPublishedReportReadEnrichment = {
  productionRelease?: unknown;
  labelData?: unknown;
  slabbedPhotos?: unknown[];
  valuation?: unknown;
};

/**
 * A v0.2 report bundle is already the canonical, allowlisted public projection.
 * Runtime release artifacts contain internal workflow fields and must never be
 * merged back into that strict public contract during reads.
 *
 * Legacy v0.1 reports retain their existing dynamic read enrichments. They are
 * subsequently passed through the public read sanitizer before responding.
 */
export function mergeAiGraderPublishedReportReadData(
  bundle: unknown,
  enrichment: AiGraderPublishedReportReadEnrichment,
): JsonRecord | null {
  if (!isRecord(bundle)) return null;
  if (bundle.schemaVersion === "ai-grader-report-bundle-v0.2") return bundle;

  const productionRelease = isRecord(enrichment.productionRelease)
    ? enrichment.productionRelease
    : isRecord(bundle.productionRelease)
      ? bundle.productionRelease
      : null;
  if (!productionRelease) return bundle;

  const labelData = isRecord(enrichment.labelData) ? enrichment.labelData : null;
  const slabbedPhotos = Array.isArray(enrichment.slabbedPhotos) ? enrichment.slabbedPhotos : [];
  const valuation = isRecord(enrichment.valuation) ? enrichment.valuation : null;
  const existingLabel = isRecord(productionRelease.label) ? productionRelease.label : {};
  const existingSlabbedPhotoContract = isRecord(productionRelease.slabbedPhotoContract)
    ? productionRelease.slabbedPhotoContract
    : {};
  const existingEbayCompsContract = isRecord(productionRelease.ebayCompsContract)
    ? productionRelease.ebayCompsContract
    : {};

  return {
    ...bundle,
    productionRelease: {
      ...productionRelease,
      ...(labelData ? { label: { ...existingLabel, ...labelData } } : {}),
      slabbedPhotoContract: {
        ...existingSlabbedPhotoContract,
        status: slabbedPhotos.length
          ? "uploaded"
          : existingSlabbedPhotoContract.status ?? "reserved_not_uploaded",
        photos: slabbedPhotos,
      },
      ebayCompsContract: {
        ...existingEbayCompsContract,
        status: valuation?.status ?? existingEbayCompsContract.status ?? "not_run",
        searchQuery: valuation?.searchQuery ?? existingEbayCompsContract.searchQuery,
        valuationMinor: valuation?.valuationMinor ?? existingEbayCompsContract.valuationMinor,
        valuationCurrency: valuation?.valuationCurrency ?? existingEbayCompsContract.valuationCurrency,
        compsRefs: valuation?.compsRefs ?? existingEbayCompsContract.compsRefs ?? [],
        resultSummary: valuation?.resultSummary ?? existingEbayCompsContract.resultSummary,
      },
    },
    finalGradeComputed: productionRelease.finalGradeComputed === true,
    labelGenerated: productionRelease.labelDataGenerated === true,
    qrGenerated: productionRelease.qrPayloadGenerated === true,
    reportStatus: productionRelease.reportStatus ?? bundle.reportStatus,
    finalStatus: productionRelease.finalStatus ?? bundle.finalStatus,
  };
}
