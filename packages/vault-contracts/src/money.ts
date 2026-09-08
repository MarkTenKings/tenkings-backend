export const VAULT_TAX_CALCULATION_VERSION = "half-up-subtotal-bps-v1";
export const DEFAULT_CLOUD_FRESHNESS_MS = 120_000;
export const DEFAULT_RETRIEVAL_SECONDS = 30;
export const DEFAULT_RETRY_EXTENSION_SECONDS = 30;

export function parseTaxPercentageToBasisPoints(input: string): number {
  const normalized = input.trim();
  if (!/^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error("Tax percentage must be a non-negative decimal with at most two fractional digits");
  }
  const [wholeText, fractionText = ""] = normalized.split(".");
  const basisPoints = Number(wholeText) * 100 + Number(fractionText.padEnd(2, "0"));
  if (basisPoints > 10_000) throw new Error("Tax percentage cannot exceed 100.00%");
  return basisPoints;
}

export function calculateTaxCents(subtotalCents: number, rateBasisPoints: number): number {
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents < 0) throw new RangeError("Subtotal must be non-negative integer cents");
  if (!Number.isSafeInteger(rateBasisPoints) || rateBasisPoints < 0 || rateBasisPoints > 10_000) {
    throw new RangeError("Tax rate must be integer basis points from 0 through 10000");
  }
  return Number((BigInt(subtotalCents) * BigInt(rateBasisPoints) + 5_000n) / 10_000n);
}
