import { isAiGraderReportBundleV03, type AiGraderStationReportBundle } from "./aiGraderReportBundle";
import type { AiGraderStationProductionRelease } from "./aiGraderProductionRelease";

export interface AiGraderReleaseAuthorityStatus {
  reportBundle?: AiGraderStationReportBundle;
  productionRelease?: AiGraderStationProductionRelease;
  latestReport: {
    reportId?: string;
  };
}

function reportIdFromStatus(status: AiGraderReleaseAuthorityStatus, fallback?: string) {
  return status.reportBundle?.reportId ??
    status.latestReport.reportId ??
    status.productionRelease?.reportId ??
    fallback;
}

function authoritativeRelease(input: {
  bridgeBundleFetched: boolean;
  sourceBundle?: AiGraderStationReportBundle;
  cachedRelease?: AiGraderStationProductionRelease;
}) {
  if (isAiGraderReportBundleV03(input.sourceBundle)) {
    return input.cachedRelease;
  }
  const embeddedRelease = input.sourceBundle?.productionRelease as AiGraderStationProductionRelease | undefined;
  return input.bridgeBundleFetched
    ? embeddedRelease
    : embeddedRelease ?? input.cachedRelease;
}

export async function resolveAiGraderAuthoritativeProductionPackage<
  TStatus extends AiGraderReleaseAuthorityStatus,
>(input: {
  initialStatus: TStatus;
  fetchBridgeBundle?: (reportId: string) => Promise<AiGraderStationReportBundle>;
  explicitlyFinalize: () => Promise<TStatus>;
}) {
  let latestStatus = input.initialStatus;
  let reportId = reportIdFromStatus(latestStatus);
  let sourceBundle = latestStatus.reportBundle;
  let bridgeBundleFetched = false;
  if (input.fetchBridgeBundle && reportId) {
    sourceBundle = await input.fetchBridgeBundle(reportId);
    bridgeBundleFetched = true;
  }
  let productionRelease = authoritativeRelease({
    bridgeBundleFetched,
    sourceBundle,
    cachedRelease: latestStatus.productionRelease,
  });
  if (!productionRelease?.finalGradeComputed && (sourceBundle || reportId)) {
    latestStatus = await input.explicitlyFinalize();
    reportId = reportIdFromStatus(latestStatus, reportId);
    sourceBundle = latestStatus.reportBundle;
    if (input.fetchBridgeBundle && reportId) {
      sourceBundle = await input.fetchBridgeBundle(reportId);
      bridgeBundleFetched = true;
    }
    productionRelease = authoritativeRelease({
      bridgeBundleFetched,
      sourceBundle,
      cachedRelease: latestStatus.productionRelease,
    });
  }
  return {
    latestStatus,
    reportId,
    sourceBundle,
    productionRelease,
    bridgeBundleFetched,
  };
}
