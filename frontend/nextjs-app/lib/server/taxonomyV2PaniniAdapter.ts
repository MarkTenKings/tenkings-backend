import type { TaxonomyAdapterParams } from "./taxonomyV2AdapterTypes";
import {
  buildManufacturerTaxonomyAdapterOutput,
  canRunManufacturerAdapter,
  looksLikeManufacturerSource,
} from "./taxonomyV2ManufacturerAdapter";

const PANINI_MATCHER = {
  nameTokens: ["panini"],
  domainTokens: ["paniniamerica.net", "paniniamerica.com", "panini"],
  providerTokens: ["panini"],
} as const;

export function looksLikePaniniSource(params: {
  setId: string;
  sourceUrl?: string | null;
  parseSummary?: Record<string, unknown> | null;
}): boolean {
  return looksLikeManufacturerSource(params, PANINI_MATCHER);
}

export function buildPaniniTaxonomyAdapterOutput(params: TaxonomyAdapterParams) {
  return buildManufacturerTaxonomyAdapterOutput(params, {
    adapterId: "panini",
    sourceMatcher: PANINI_MATCHER,
  });
}

export function canRunPaniniAdapter(params: TaxonomyAdapterParams): boolean {
  return canRunManufacturerAdapter(params, PANINI_MATCHER);
}
