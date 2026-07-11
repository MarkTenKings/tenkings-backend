import type { AiGraderReportBundle } from "./aiGraderReportBundle";
import type { AiGraderProductionRelease } from "./aiGraderProductionRelease";

export interface AiGraderReleaseAuthorityStatus {
  reportBundle?: AiGraderReportBundle;
  productionRelease?: AiGraderProductionRelease;
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
  sourceBundle?: AiGraderReportBundle;
  cachedRelease?: AiGraderProductionRelease;
}) {
  return input.bridgeBundleFetched
    ? input.sourceBundle?.productionRelease
    : input.sourceBundle?.productionRelease ?? input.cachedRelease;
}

export async function resolveAiGraderAuthoritativeProductionPackage<
  TStatus extends AiGraderReleaseAuthorityStatus,
>(input: {
  initialStatus: TStatus;
  fetchBridgeBundle?: (reportId: string) => Promise<AiGraderReportBundle>;
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
