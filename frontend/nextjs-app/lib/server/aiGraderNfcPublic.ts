import { aiGraderReportEditorialRevisionFromGradeStory } from "../aiGraderReportRevision";
import { readStorageBuffer } from "./storage";

export const AI_GRADER_NFC_PUBLIC_BASE_URL = "https://collect.tenkings.co/nfc" as const;

export type AiGraderNfcPublicTapData =
  | {
      state: "active";
      registrationKind: "registered_link";
      publicTagId: string;
      chipType: "NTAG215" | "FEIJU_F8215";
      securityMode: "static_url_v1";
      nfcTagUrl: string;
      reportId: string;
      reportUrl: string;
      certId: string;
      cardTitle: string;
      cardSet?: string;
      grade?: number;
      reportVisibility: "public" | "coming_soon";
      comingSoon: boolean;
    }
  | { state: "revoked" | "not_valid" | "contradictory_linkage" | "unavailable" };

type PublicNfcDb = {
  aiGraderNfcTag?: {
    findUnique(input: unknown): Promise<unknown>;
    findFirst(input: unknown): Promise<unknown>;
  };
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validOperatorRevisionAuditHead(value: unknown, input: {
  revision: number;
  sourceBundleSha256: string;
}) {
  return isRecord(value) &&
    value.schemaVersion === "ten-kings-ai-grader-report-editor-audit-head-v1" &&
    Number.isSafeInteger(value.sequence) &&
    Number(value.sequence) >= input.revision &&
    typeof value.headEventId === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/.test(value.headEventId) &&
    typeof value.headChecksum === "string" &&
    /^[a-f0-9]{64}$/.test(value.headChecksum) &&
    value.sourceBundleSha256 === input.sourceBundleSha256;
}

export type AiGraderPublicNfcRegistration = Pick<
  Extract<AiGraderNfcPublicTapData, { state: "active" }>,
  "registrationKind" | "publicTagId" | "chipType" | "securityMode" | "nfcTagUrl"
> & { status: "active" };

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function isValidAiGraderNfcPublicTagId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{32}$/.test(value);
}

export function buildAiGraderNfcPublicTagUrl(publicTagId: string) {
  if (!isValidAiGraderNfcPublicTagId(publicTagId)) throw new Error("Invalid NFC public tag identifier.");
  return `${AI_GRADER_NFC_PUBLIC_BASE_URL}/${publicTagId}`;
}

export async function readAiGraderNfcPublicTap(
  publicTagId: string,
  options: { dbClient?: PublicNfcDb; schemaReadiness?: () => Promise<boolean> } = {},
): Promise<AiGraderNfcPublicTapData> {
  if (!isValidAiGraderNfcPublicTagId(publicTagId)) return { state: "not_valid" };

  const database = await import("@tenkings/database");
  const db = options.dbClient ?? (database.prisma as unknown as PublicNfcDb);
  try {
    const schemaReady = options.schemaReadiness
      ? await options.schemaReadiness()
      : options.dbClient
        ? true
        : (await database.readCachedAiGraderNfcSchemaReadiness(database.prisma as any)).ready;
    if (!schemaReady) return { state: "unavailable" };
  } catch {
    return { state: "unavailable" };
  }
  let row: unknown;
  try {
    row = await db.aiGraderNfcTag?.findUnique({
    where: { publicTagId },
    select: {
      id: true,
      publicTagId: true,
      chipType: true,
      securityMode: true,
      status: true,
      revokedAt: true,
      aiGraderReportId: true,
      reportId: true,
      cardAssetId: true,
      itemId: true,
      aiGraderLabelId: true,
      certId: true,
      report: {
        select: {
          id: true,
          reportId: true,
          publicationStatus: true,
          visibilityStatus: true,
          cardAssetId: true,
          itemId: true,
          finalOverallGrade: true,
          gradeStory: true,
          reportBundleStorageKey: true,
        },
      },
      item: {
        select: {
          id: true,
          name: true,
          set: true,
        },
      },
      label: {
        select: {
          id: true,
          certId: true,
        },
      },
    },
    });
  } catch {
    // The public boundary must not disclose database/schema internals. A
    // failed read is unavailable, never a false invalid-registration claim.
    return { state: "unavailable" };
  }
  if (!isRecord(row)) return { state: "not_valid" };
  if (text(row.status)?.toLowerCase() === "revoked") return { state: "revoked" };

  const report = isRecord(row.report) ? row.report : undefined;
  const item = isRecord(row.item) ? row.item : undefined;
  const label = isRecord(row.label) ? row.label : undefined;
  const activeRegistrationShape =
    text(row.status)?.toLowerCase() === "active" &&
    !row.revokedAt &&
    (row.chipType === "NTAG215" || row.chipType === "FEIJU_F8215") &&
    text(row.securityMode)?.toLowerCase() === "static_url_v1";
  if (!activeRegistrationShape) return { state: "not_valid" };
  const exactLinkage =
    text(row.publicTagId) === publicTagId &&
    text(row.aiGraderReportId) === text(report?.id) &&
    text(row.reportId) === text(report?.reportId) &&
    text(row.cardAssetId) === text(report?.cardAssetId) &&
    text(row.itemId) === text(report?.itemId) &&
    text(row.itemId) === text(item?.id) &&
    text(row.aiGraderLabelId) === text(label?.id) &&
    text(row.certId) === text(label?.certId);
  if (!exactLinkage) return { state: "contradictory_linkage" };
  const reportVisibility = report?.visibilityStatus === "public" || report?.visibilityStatus === "coming_soon"
    ? report.visibilityStatus
    : undefined;
  const publiclyPublished = report?.publicationStatus === "published" && Boolean(reportVisibility);
  const reportId = text(report?.reportId);
  const certId = text(label?.certId);
  const cardTitle = text(item?.name);
  if (!publiclyPublished || !reportId || !certId || !cardTitle) return { state: "not_valid" };

  const gradeStory = isRecord(report?.gradeStory) ? report.gradeStory : {};
  let grade = typeof report?.finalOverallGrade === "number" && Number.isFinite(report.finalOverallGrade)
    ? report.finalOverallGrade
    : undefined;
  if (Object.prototype.hasOwnProperty.call(gradeStory, "manualReportRevision")) {
    const revision = aiGraderReportEditorialRevisionFromGradeStory(gradeStory, reportId);
    const storageKey = text(report?.reportBundleStorageKey);
    if (
      !revision ||
      !storageKey ||
      !validOperatorRevisionAuditHead(
        gradeStory.manualReportRevisionAudit,
        revision,
      )
    ) return { state: "unavailable" };
    const sourceBytes = await readStorageBuffer(storageKey).catch(() => null);
    if (!sourceBytes || database.aiGraderSha256(sourceBytes) !== revision.sourceBundleSha256) {
      return { state: "unavailable" };
    }
    grade = revision.calculation.overall;
  }
  return {
    state: "active",
    registrationKind: "registered_link",
    publicTagId,
    chipType: row.chipType as "NTAG215" | "FEIJU_F8215",
    securityMode: "static_url_v1",
    nfcTagUrl: buildAiGraderNfcPublicTagUrl(publicTagId),
    reportId,
    reportUrl: `/ai-grader/reports/${encodeURIComponent(reportId)}`,
    reportVisibility: reportVisibility as "public" | "coming_soon",
    comingSoon: reportVisibility === "coming_soon",
    certId,
    cardTitle,
    ...(text(item?.set) ? { cardSet: text(item?.set) } : {}),
    ...(grade !== undefined ? { grade } : {}),
  };
}

export async function readAiGraderPublicNfcRegistration(
  reportId: string,
  options: { dbClient?: PublicNfcDb; schemaReadiness?: () => Promise<boolean> } = {},
): Promise<AiGraderPublicNfcRegistration | null> {
  if (!reportId || reportId.length > 200) return null;
  const database = await import("@tenkings/database");
  const db = options.dbClient ?? (database.prisma as unknown as PublicNfcDb);
  const schemaReady = options.schemaReadiness
    ? await options.schemaReadiness()
    : options.dbClient
      ? true
      : (await database.readCachedAiGraderNfcSchemaReadiness(database.prisma as any)).ready;
  if (!schemaReady) return null;
  let match: unknown;
  try {
    match = await db.aiGraderNfcTag?.findFirst({
      where: { reportId, status: "active" },
      select: { publicTagId: true },
    });
  } catch (error) {
    if (database.isAiGraderNfcSchemaMissingError(error)) return null;
    throw error;
  }
  const publicTagId = isRecord(match) ? text(match.publicTagId) : undefined;
  if (!publicTagId) return null;
  const tap = await readAiGraderNfcPublicTap(publicTagId, { dbClient: db });
  if (tap.state !== "active" || tap.reportId !== reportId) return null;
  return {
    status: "active",
    registrationKind: tap.registrationKind,
    publicTagId: tap.publicTagId,
    chipType: tap.chipType,
    securityMode: tap.securityMode,
    nfcTagUrl: tap.nfcTagUrl,
  };
}
