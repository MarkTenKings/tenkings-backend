import type { TaxonomyAdapterParams } from "./taxonomyV2AdapterTypes";
import {
  buildManufacturerTaxonomyAdapterOutput,
  canRunManufacturerAdapter,
  looksLikeManufacturerSource,
} from "./taxonomyV2ManufacturerAdapter";

const TOPPS_MATCHER = {
  nameTokens: ["topps"],
  domainTokens: ["topps.com", "ripped.topps.com"],
  providerTokens: ["topps"],
} as const;

export function looksLikeToppsSource(params: {
  setId: string;
  sourceUrl?: string | null;
  parseSummary?: Record<string, unknown> | null;
}): boolean {
  return looksLikeManufacturerSource(params, TOPPS_MATCHER);
}

export function buildToppsTaxonomyAdapterOutput(params: TaxonomyAdapterParams) {
  return buildManufacturerTaxonomyAdapterOutput(params, {
    adapterId: "topps",
    sourceMatcher: TOPPS_MATCHER,
  });
}

export function canRunToppsAdapter(params: TaxonomyAdapterParams): boolean {
  return canRunManufacturerAdapter(params, TOPPS_MATCHER);
}
