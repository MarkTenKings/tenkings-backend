function boolFromEnv(value: string | undefined): boolean | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
  return null;
}

function resolveFlag(explicit: boolean | null, fallback: boolean): boolean {
  if (explicit == null) return fallback;
  return explicit;
}

type SurfaceFlags = {
  workstation: boolean;
  overviewV2: boolean;
  ingestStepper: boolean;
  variantStudio: boolean;
  aiQuality: boolean;
};

export function readCatalogOpsFlags(): SurfaceFlags {
  const productionDefault = process.env.NODE_ENV === "production";

  const workstationRaw =
    boolFromEnv(process.env.CATALOG_OPS_WORKSTATION) ?? boolFromEnv(process.env.NEXT_PUBLIC_CATALOG_OPS_WORKSTATION);
  const workstation = resolveFlag(workstationRaw, !productionDefault);

  const overviewRaw =
    boolFromEnv(process.env.CATALOG_OPS_OVERVIEW_V2) ?? boolFromEnv(process.env.NEXT_PUBLIC_CATALOG_OPS_OVERVIEW_V2);
  const ingestRaw =
    boolFromEnv(process.env.CATALOG_OPS_INGEST_STEPPER) ?? boolFromEnv(process.env.NEXT_PUBLIC_CATALOG_OPS_INGEST_STEPPER);
  const variantRaw =
    boolFromEnv(process.env.CATALOG_OPS_VARIANT_STUDIO) ?? boolFromEnv(process.env.NEXT_PUBLIC_CATALOG_OPS_VARIANT_STUDIO);
  const aiRaw = boolFromEnv(process.env.CATALOG_OPS_AI_QUALITY) ?? boolFromEnv(process.env.NEXT_PUBLIC_CATALOG_OPS_AI_QUALITY);

  return {
    workstation,
    overviewV2: resolveFlag(overviewRaw, workstation),
    ingestStepper: resolveFlag(ingestRaw, workstation),
    variantStudio: resolveFlag(variantRaw, workstation),
    aiQuality: resolveFlag(aiRaw, workstation),
  };
}
