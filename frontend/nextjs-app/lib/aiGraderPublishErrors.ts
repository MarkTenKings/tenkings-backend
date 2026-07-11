export type AiGraderPublishStage =
  | "publish-init"
  | "local-package-read"
  | "local-asset-read"
  | "direct-storage-upload"
  | "publish-finalize"
  | "public-report-verification"
  | "slabbed-photo-init"
  | "slabbed-photo-upload"
  | "slabbed-photo-finalize";

type ArtifactContext = {
  index?: number;
  total?: number;
  kind?: string;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Unknown error.");
}

export function isAiGraderFetchReachabilityError(error: unknown) {
  if (!(error instanceof Error)) return false;
  if ((error as Error & { code?: string }).code === "network") return true;
  const message = error.message.toLowerCase();
  return (
    error.name === "TypeError" &&
    (message.includes("failed to fetch") ||
      message.includes("networkerror") ||
      message.includes("network request failed") ||
      message.includes("load failed"))
  );
}

function artifactLabel(context?: ArtifactContext) {
  if (!context) return "";
  const position =
    typeof context.index === "number" && typeof context.total === "number"
      ? `artifact ${context.index + 1}/${context.total}`
      : "artifact";
  const safeKind = context.kind
    ?.split(/[\\/]/)
    .at(-1)
    ?.replace(/[^A-Za-z0-9._-]/g, "_")
    .slice(0, 80);
  const kind = safeKind ? ` ${safeKind}` : "";
  return `${position}${kind}`;
}

export function formatAiGraderPublishStageError(input: {
  stage: AiGraderPublishStage;
  error?: unknown;
  artifact?: ArtifactContext;
  side?: "front" | "back";
}) {
  const detail = input.error ? errorMessage(input.error) : "";
  const suffix = detail ? ` ${detail}` : "";

  if (input.stage === "direct-storage-upload") {
    const label = artifactLabel(input.artifact);
    if (isAiGraderFetchReachabilityError(input.error)) {
      return `Direct storage upload could not reach storage; likely storage CORS/preflight. ${label}${suffix}`.trim();
    }
    return `Direct storage upload failed for ${label || "artifact"}.${suffix}`.trim();
  }

  if (input.stage === "slabbed-photo-upload") {
    const side = input.side ? ` slabbed ${input.side} photo` : " slabbed photo";
    if (isAiGraderFetchReachabilityError(input.error)) {
      return `Direct storage upload could not reach storage; likely storage CORS/preflight.${side}${suffix}`.trim();
    }
    return `Direct storage upload failed for${side}.${suffix}`.trim();
  }

  if (input.stage === "local-asset-read") {
    const label = artifactLabel(input.artifact);
    return `Local asset read failed for ${label || "publish artifact"}.${suffix}`.trim();
  }

  if (input.stage === "local-package-read") {
    return `Local asset read failed while reading the publish package manifest.${suffix}`.trim();
  }

  if (input.stage === "publish-init") return `publish-init failed.${suffix}`.trim();
  if (input.stage === "publish-finalize") return `publish-finalize failed.${suffix}`.trim();
  if (input.stage === "public-report-verification") return `public report verification failed.${suffix}`.trim();
  if (input.stage === "slabbed-photo-init") return `slabbed-photo-init failed.${suffix}`.trim();
  return `slabbed-photo-finalize failed.${suffix}`.trim();
}

