function boolFromEnv(value: string | undefined): boolean | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
  return null;
}

function readFlag(name: string): boolean | null {
  const direct = boolFromEnv(process.env[name]);
  if (direct != null) return direct;
  return boolFromEnv(process.env[`NEXT_PUBLIC_${name}`]);
}

function resolveFlag(name: string, defaultValue: boolean): boolean {
  const explicit = readFlag(name);
  if (explicit == null) return defaultValue;
  return explicit;
}

export type TaxonomyV2Flags = {
  ingest: boolean;
  pickers: boolean;
  matcher: boolean;
  kingsreviewQuery: boolean;
  forceLegacy: boolean;
  allowLegacyFallback: boolean;
};

export function readTaxonomyV2Flags(): TaxonomyV2Flags {
  const forceLegacy = readFlag("TAXONOMY_V2_FORCE_LEGACY") === true;
  const defaultOn = resolveFlag("TAXONOMY_V2_DEFAULT_ON", true);

  if (forceLegacy) {
    return {
      ingest: false,
      pickers: false,
      matcher: false,
      kingsreviewQuery: false,
      forceLegacy: true,
      allowLegacyFallback: true,
    };
  }

  return {
    ingest: resolveFlag("TAXONOMY_V2_INGEST", defaultOn),
    pickers: resolveFlag("TAXONOMY_V2_PICKERS", defaultOn),
    matcher: resolveFlag("TAXONOMY_V2_MATCHER", defaultOn),
    kingsreviewQuery: resolveFlag("TAXONOMY_V2_KINGSREVIEW_QUERY", defaultOn),
    forceLegacy: false,
    allowLegacyFallback: resolveFlag("TAXONOMY_V2_ALLOW_LEGACY_FALLBACK", false),
  };
}
