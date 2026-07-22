export type StaleReviewSafeOffReceiptConfigV1 = {
  leimacHost?: unknown;
  leimacPort?: unknown;
};

export function parseStaleReviewSafeOffReceiptConfigV1(jsonText: string): StaleReviewSafeOffReceiptConfigV1 {
  const withoutLeadingBom = jsonText.startsWith("\uFEFF") ? jsonText.slice(1) : jsonText;
  if (withoutLeadingBom.includes("\uFEFF")) {
    throw new SyntaxError("Safe-off receipt config contains an unexpected UTF-8 BOM.");
  }
  return JSON.parse(withoutLeadingBom) as StaleReviewSafeOffReceiptConfigV1;
}
