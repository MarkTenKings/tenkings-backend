export const AI_GRADER_NFC_PUBLIC_BASE_URL = "https://collect.tenkings.co/nfc" as const;

export type AiGraderNfcPublicTapData =
  | {
      state: "active";
      registrationKind: "registered_link";
      publicTagId: string;
      chipType: "NTAG215";
      securityMode: "static_url_v1";
      nfcTagUrl: string;
      reportId: string;
      reportUrl: string;
      certId: string;
      cardTitle: string;
      cardSet?: string;
      grade?: number;
    }
  | { state: "revoked" | "not_valid" };

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
  options: { dbClient?: PublicNfcDb } = {},
): Promise<AiGraderNfcPublicTapData> {
  if (!isValidAiGraderNfcPublicTagId(publicTagId)) return { state: "not_valid" };

  const db = options.dbClient ?? ((await import("@tenkings/database")).prisma as unknown as PublicNfcDb);
  const row = await db.aiGraderNfcTag?.findUnique({
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
  if (!isRecord(row)) return { state: "not_valid" };
  if (text(row.status)?.toLowerCase() === "revoked") return { state: "revoked" };

  const report = isRecord(row.report) ? row.report : undefined;
  const item = isRecord(row.item) ? row.item : undefined;
  const label = isRecord(row.label) ? row.label : undefined;
  const linked =
    text(row.status)?.toLowerCase() === "active" &&
    !row.revokedAt &&
    row.chipType === "NTAG215" &&
    text(row.securityMode)?.toLowerCase() === "static_url_v1" &&
    report?.publicationStatus === "published" &&
    report.visibilityStatus === "public" &&
    text(row.publicTagId) === publicTagId &&
    text(row.aiGraderReportId) === text(report.id) &&
    text(row.reportId) === text(report.reportId) &&
    text(row.cardAssetId) === text(report.cardAssetId) &&
    text(row.itemId) === text(report.itemId) &&
    text(row.itemId) === text(item?.id) &&
    text(row.aiGraderLabelId) === text(label?.id) &&
    text(row.certId) === text(label?.certId);
  const reportId = text(report?.reportId);
  const certId = text(label?.certId);
  const cardTitle = text(item?.name);
  if (!linked || !reportId || !certId || !cardTitle) return { state: "not_valid" };

  const grade = typeof report.finalOverallGrade === "number" && Number.isFinite(report.finalOverallGrade)
    ? report.finalOverallGrade
    : undefined;
  return {
    state: "active",
    registrationKind: "registered_link",
    publicTagId,
    chipType: "NTAG215",
    securityMode: "static_url_v1",
    nfcTagUrl: buildAiGraderNfcPublicTagUrl(publicTagId),
    reportId,
    reportUrl: `/ai-grader/reports/${encodeURIComponent(reportId)}`,
    certId,
    cardTitle,
    ...(text(item?.set) ? { cardSet: text(item?.set) } : {}),
    ...(grade !== undefined ? { grade } : {}),
  };
}

export async function readAiGraderPublicNfcRegistration(
  reportId: string,
  options: { dbClient?: PublicNfcDb } = {},
): Promise<AiGraderPublicNfcRegistration | null> {
  if (!reportId || reportId.length > 200) return null;
  const db = options.dbClient ?? ((await import("@tenkings/database")).prisma as unknown as PublicNfcDb);
  const match = await db.aiGraderNfcTag?.findFirst({
    where: { reportId, status: "active" },
    select: { publicTagId: true },
  });
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
