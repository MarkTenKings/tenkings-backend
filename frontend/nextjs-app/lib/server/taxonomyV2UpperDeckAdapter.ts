import type { TaxonomyAdapterParams } from "./taxonomyV2AdapterTypes";
import {
  buildManufacturerTaxonomyAdapterOutput,
  canRunManufacturerAdapter,
  looksLikeManufacturerSource,
} from "./taxonomyV2ManufacturerAdapter";

const UPPER_DECK_MATCHER = {
  nameTokens: ["upper deck", "upperdeck"],
  domainTokens: ["upperdeck.com", "upperdeckblog.com", "upper deck"],
  providerTokens: ["upper deck", "upperdeck"],
} as const;

export function looksLikeUpperDeckSource(params: {
  setId: string;
  sourceUrl?: string | null;
  parseSummary?: Record<string, unknown> | null;
}): boolean {
  return looksLikeManufacturerSource(params, UPPER_DECK_MATCHER);
}

export function buildUpperDeckTaxonomyAdapterOutput(params: TaxonomyAdapterParams) {
  return buildManufacturerTaxonomyAdapterOutput(params, {
    adapterId: "upperdeck",
    sourceMatcher: UPPER_DECK_MATCHER,
  });
}

export function canRunUpperDeckAdapter(params: TaxonomyAdapterParams): boolean {
  return canRunManufacturerAdapter(params, UPPER_DECK_MATCHER);
}
