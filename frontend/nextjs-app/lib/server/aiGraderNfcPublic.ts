export const AI_GRADER_NFC_PUBLIC_BASE_URL = "https://collect.tenkings.co/nfc" as const;

export type AiGraderNfcPublicTapData =
  | {
      state: "active";
      registrationKind: "registered_link";
      publicTagId: string;
      chipType: "NTAG215" | "FEIJU_PROPRIETARY_ISODEP";
      securityMode: "static_url_v1" | "manual_ios_locked_static_url_v1";
      nfcTagUrl: string;
      reportId: string;
      reportUrl: string;
      certId: string;
      cardTitle: string;
      cardSet?: string;
      grade?: number;
    }
  | { state: "setup_verification"; stage: "pre_lock" | "lock_confirmation" | "post_lock" | "ready_to_complete" }
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
  options: {
    dbClient?: PublicNfcDb;
    schemaReadiness?: () => Promise<boolean>;
    observeManualIosTap?: (publicTagId: string) => Promise<{ state: "not_applicable" } | { state: "setup_verification"; stage: "pre_lock" | "lock_confirmation" | "post_lock" | "ready_to_complete" }>;
  } = {},
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
  const observeManualIosTap = options.observeManualIosTap ?? (!options.dbClient
    ? (id: string) => database.observeAiGraderNfcManualIosTap({ publicTagId: id })
    : undefined);
  if (observeManualIosTap) {
    try {
      const setup = await observeManualIosTap(publicTagId);
      if (setup.state === "setup_verification") return setup;
    } catch {
      return { state: "unavailable" };
    }
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
  const activeStrategy =
    (row.chipType === "NTAG215" && text(row.securityMode)?.toLowerCase() === "static_url_v1") ||
    (row.chipType === "FEIJU_PROPRIETARY_ISODEP" && text(row.securityMode)?.toLowerCase() === "manual_ios_locked_static_url_v1");
  const activeRegistrationShape =
    text(row.status)?.toLowerCase() === "active" &&
    !row.revokedAt &&
    activeStrategy;
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
  const publiclyPublished = report?.publicationStatus === "published" && report?.visibilityStatus === "public";
  const reportId = text(report?.reportId);
  const certId = text(label?.certId);
  const cardTitle = text(item?.name);
  if (!publiclyPublished || !reportId || !certId || !cardTitle) return { state: "not_valid" };

  const grade = typeof report?.finalOverallGrade === "number" && Number.isFinite(report.finalOverallGrade)
    ? report.finalOverallGrade
    : undefined;
  return {
    state: "active",
    registrationKind: "registered_link",
    publicTagId,
    chipType: row.chipType as "NTAG215" | "FEIJU_PROPRIETARY_ISODEP",
    securityMode: text(row.securityMode)?.toLowerCase() as "static_url_v1" | "manual_ios_locked_static_url_v1",
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
