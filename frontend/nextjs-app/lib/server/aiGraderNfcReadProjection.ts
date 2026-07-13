export type AiGraderNfcReadStatus =
  | "missing"
  | "reserved"
  | "programming"
  | "verified"
  | "active"
  | "revoked"
  | "error";

export type AiGraderNfcSafeReadProjection = {
  status: AiGraderNfcReadStatus;
  publicTagId?: string;
  nfcTagUrl?: string;
  chipType?: "NTAG215" | "NTAG424_DNA";
  securityMode?: "static_url_v1" | "ntag424_sun_v1";
  registrationKind?: "registered_link";
};

type ExpectedLink = {
  reportId: string;
  reportRowId?: string | null;
  cardAssetId?: string | null;
  itemId?: string | null;
  labelId?: string | null;
  certId?: string | null;
};
type JsonRecord = Record<string, unknown>;

const AI_GRADER_NFC_STATUS_BATCH_LIMIT = 500;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function status(value: unknown): AiGraderNfcReadStatus {
  const normalized = text(value)?.toLowerCase();
  return normalized === "reserved" ||
    normalized === "programming" ||
    normalized === "verified" ||
    normalized === "active" ||
    normalized === "revoked" ||
    normalized === "error"
    ? normalized
    : "error";
}

function project(row: JsonRecord): AiGraderNfcSafeReadProjection {
  const publicTagId = text(row.publicTagId);
  const safePublicTagId = publicTagId && /^[A-Za-z0-9_-]{32}$/.test(publicTagId) ? publicTagId : undefined;
  const chipType = row.chipType === "NTAG215" || row.chipType === "NTAG424_DNA" ? row.chipType : undefined;
  const securityMode = row.securityMode === "STATIC_URL_V1" || row.securityMode === "static_url_v1"
    ? "static_url_v1"
    : row.securityMode === "NTAG424_SUN_V1" || row.securityMode === "ntag424_sun_v1"
      ? "ntag424_sun_v1"
      : undefined;
  const normalizedStatus = status(row.status);
  const safeStatus = normalizedStatus === "active" && row.revokedAt ? "error" : normalizedStatus;
  return {
    status: safeStatus,
    ...(safePublicTagId ? {
      publicTagId: safePublicTagId,
      nfcTagUrl: `https://collect.tenkings.co/nfc/${safePublicTagId}`,
    } : {}),
    ...(chipType ? { chipType } : {}),
    ...(securityMode ? { securityMode } : {}),
    ...(safeStatus === "active" && chipType === "NTAG215" && securityMode === "static_url_v1"
      ? { registrationKind: "registered_link" as const }
      : {}),
  };
}

export async function readAiGraderNfcStatusesForReports(input: {
  dbClient: any;
  tenantId: string;
  reports: ExpectedLink[];
}) {
  const expected = new Map<string, ExpectedLink>();
  for (const link of input.reports) {
    if (!link.reportId || expected.has(link.reportId) || expected.size >= AI_GRADER_NFC_STATUS_BATCH_LIMIT) continue;
    expected.set(link.reportId, link);
  }
  const result = new Map<string, AiGraderNfcSafeReadProjection>();
  for (const reportId of expected.keys()) result.set(reportId, { status: "missing" });
  if (!expected.size) return result;

  let rows: unknown[];
  try {
    const found = await input.dbClient.aiGraderNfcTag.findMany({
      where: {
        tenantId: input.tenantId,
        reportId: { in: Array.from(expected.keys()) },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: {
        tenantId: true,
        reportId: true,
        aiGraderReportId: true,
        cardAssetId: true,
        itemId: true,
        aiGraderLabelId: true,
        certId: true,
        status: true,
        revokedAt: true,
        publicTagId: true,
        chipType: true,
        securityMode: true,
      },
    });
    rows = Array.isArray(found) ? found : [];
  } catch {
    for (const reportId of expected.keys()) result.set(reportId, { status: "error" });
    return result;
  }

  const grouped = new Map<string, JsonRecord[]>();
  for (const candidate of rows) {
    if (!isRecord(candidate)) continue;
    const reportId = text(candidate.reportId);
    if (!reportId || !expected.has(reportId)) continue;
    const group = grouped.get(reportId) ?? [];
    group.push(candidate);
    grouped.set(reportId, group);
  }

  for (const [reportId, link] of expected) {
    const group = grouped.get(reportId) ?? [];
    if (!group.length) continue;
    const mismatch = group.some((row) =>
      text(row.tenantId) !== input.tenantId ||
      (text(link.reportRowId) && text(row.aiGraderReportId) !== text(link.reportRowId)) ||
      text(row.cardAssetId) !== text(link.cardAssetId) ||
      text(row.itemId) !== text(link.itemId) ||
      (text(link.labelId) && text(row.aiGraderLabelId) !== text(link.labelId)) ||
      (text(link.certId) && text(row.certId) !== text(link.certId)));
    if (mismatch) {
      result.set(reportId, { status: "error" });
      continue;
    }
    result.set(reportId, project(group[0]));
  }
  return result;
}
