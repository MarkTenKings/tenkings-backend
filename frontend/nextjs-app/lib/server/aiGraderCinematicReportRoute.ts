import { getAiGraderReportBundle } from "../aiGraderReportBundle";
import { toAiGraderCinematicReport, type CinematicReport } from "../aiGraderCinematicReport";
import { aiGraderPublicReportDbReadsEnabled } from "./aiGraderProductionApi";
import { readAiGraderPublicReportBundle } from "./aiGraderPublicReportData";

type JsonRecord = Record<string, unknown>;

const REPORT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const CINEMATIC_FIXTURE_REPORT_ID = "sample-defect-v1";

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export type AiGraderCinematicReportRouteResult = {
  bundle: JsonRecord;
  fixture: boolean;
};

export type AiGraderCinematicReportPageProps = {
  report: CinematicReport;
  fixture: boolean;
};

export type AiGraderCinematicReportRouteDependencies = {
  publicReadsEnabled: () => boolean;
  readPublicBundle: (reportId: string) => Promise<JsonRecord | null>;
  fixtureBundle: (reportId: string) => JsonRecord;
};

const defaultDependencies: AiGraderCinematicReportRouteDependencies = {
  publicReadsEnabled: () => aiGraderPublicReportDbReadsEnabled(),
  readPublicBundle: readAiGraderPublicReportBundle,
  fixtureBundle: (reportId) => getAiGraderReportBundle(reportId) as unknown as JsonRecord,
};

function isSupportedStoredSchema(value: JsonRecord) {
  return (
    value.schemaVersion === undefined ||
    value.schemaVersion === "ai-grader-report-bundle-v0.1" ||
    value.schemaVersion === "ai-grader-report-bundle-v0.2"
  );
}

/**
 * Resolves only one deliberate fixture ID. Every other report ID must come
 * from the persisted, already-sanitized public bundle path; no generated ID
 * can fall back to a sample bundle.
 */
export async function resolveAiGraderCinematicReportRoute(
  inputReportId: string | string[] | undefined,
  dependencies: AiGraderCinematicReportRouteDependencies = defaultDependencies,
): Promise<AiGraderCinematicReportRouteResult | null> {
  const reportId = (Array.isArray(inputReportId) ? inputReportId[0] : inputReportId)?.trim() ?? "";
  if (!REPORT_ID.test(reportId)) return null;
  if (reportId === CINEMATIC_FIXTURE_REPORT_ID) {
    const bundle = dependencies.fixtureBundle(reportId);
    return isRecord(bundle) && bundle.reportId === reportId ? { bundle, fixture: true } : null;
  }
  if (reportId.startsWith("sample-")) return null;
  if (!dependencies.publicReadsEnabled()) return null;
  const bundle = await dependencies.readPublicBundle(reportId);
  if (!isRecord(bundle) || bundle.reportId !== reportId || !isSupportedStoredSchema(bundle)) return null;
  return { bundle, fixture: false };
}

/** The page-level SSR boundary: only a narrow display DTO is serializable. */
export async function resolveAiGraderCinematicReportPageProps(
  inputReportId: string | string[] | undefined,
  dependencies: AiGraderCinematicReportRouteDependencies = defaultDependencies,
): Promise<AiGraderCinematicReportPageProps | null> {
  const result = await resolveAiGraderCinematicReportRoute(inputReportId, dependencies);
  if (!result) return null;
  const report = toAiGraderCinematicReport(result.bundle);
  return report?.reportId ? { report, fixture: result.fixture } : null;
}

export { CINEMATIC_FIXTURE_REPORT_ID };
