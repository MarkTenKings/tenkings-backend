export const AI_GRADER_LABEL_SHEET_SCHEMA_VERSION = "ai-grader-label-sheet-v1" as const;
export const AI_GRADER_LABEL_SHEET_COLUMNS = 2;
export const AI_GRADER_LABEL_SHEET_ROWS = 8;
export const AI_GRADER_LABEL_SHEET_CAPACITY = AI_GRADER_LABEL_SHEET_COLUMNS * AI_GRADER_LABEL_SHEET_ROWS;

type JsonRecord = Record<string, unknown>;

export type AiGraderLabelSheetStatus = "open" | "full" | "sealed" | "printed";

export type AiGraderSafeConfirmedCardIdentity = {
  category?: "sport" | "tcg" | "comics";
  title?: string;
  playerName?: string;
  cardName?: string;
  teamName?: string;
  year?: string;
  manufacturer?: string;
  sport?: string;
  game?: string;
  productSet?: string;
  productLine?: string;
  insert?: string;
  insertSet?: string;
  parallel?: string;
  cardNumber?: string;
  numbered?: string;
  autograph?: boolean;
  memorabilia?: boolean;
};

export type AiGraderLabelSheetAssignment = {
  schemaVersion: typeof AI_GRADER_LABEL_SHEET_SCHEMA_VERSION;
  sheetId: string;
  sheetNumber: number;
  slot: number;
  capacity: typeof AI_GRADER_LABEL_SHEET_CAPACITY;
  assignedAt: string;
  assignedByUserId?: string;
  sealedAt?: string;
  sealedByUserId?: string;
  printedAt?: string;
  printedByUserId?: string;
};

export type AiGraderLabelSheetSourceRow = {
  id?: unknown;
  reportId?: unknown;
  certId?: unknown;
  labelGradeText?: unknown;
  qrPayloadUrl?: unknown;
  publicReportUrl?: unknown;
  physicalPrintStatus?: unknown;
  payload?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  publicationStatus?: unknown;
  nfc?: unknown;
  report?: unknown;
};

export type AiGraderLabelNfcRegistrationDto = {
  status: "active";
  registrationKind: "registered_link";
  publicTagId: string;
  nfcTagUrl: string;
  chipType: "NTAG215";
  securityMode: "static_url_v1";
};

export type AiGraderLabelSheetLabelDto = {
  labelId: string;
  reportId: string;
  certId?: string;
  grade: string;
  slot: number;
  assignedAt: string;
  qrPayloadUrl?: string;
  publicReportUrl?: string;
  publicationStatus?: "draft" | "finalized" | "published" | "unpublished" | "revoked" | "error";
  physicalPrintStatus: "not_printed" | "printed";
  confirmedCardIdentity: AiGraderSafeConfirmedCardIdentity;
  nfc?: AiGraderLabelNfcRegistrationDto;
};

export type AiGraderLabelSheetDto = {
  sheetId: string;
  sheetNumber: number;
  capacity: typeof AI_GRADER_LABEL_SHEET_CAPACITY;
  status: AiGraderLabelSheetStatus;
  labelCount: number;
  openSlotCount: number;
  firstAssignedAt: string;
  lastAssignedAt: string;
  sealedAt?: string;
  printedAt?: string;
  revision: string;
  slotConflict: boolean;
  labels: AiGraderLabelSheetLabelDto[];
};

export type AiGraderLabelSheetsResult = {
  source: "persisted_records";
  orderedBy: "sheetNumber_asc_slot_asc";
  sheets: AiGraderLabelSheetDto[];
  openSheetId?: string;
  unassignedLabelCount: number;
  stats: {
    totalSheets: number;
    openSheets: number;
    sealedSheets: number;
    printedSheets: number;
    totalLabels: number;
  };
};

export type AiGraderLabelSheetSlotSelection = {
  assignment: AiGraderLabelSheetAssignment;
  existing: boolean;
  sheetStatus: AiGraderLabelSheetStatus;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function optionalBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function isoDateString(value: unknown) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  const text = optionalString(value);
  if (!text) return undefined;
  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
}

function safePublicationStatus(value: unknown): AiGraderLabelSheetLabelDto["publicationStatus"] {
  const status = optionalString(value);
  return status && ["draft", "finalized", "published", "unpublished", "revoked", "error"].includes(status)
    ? (status as NonNullable<AiGraderLabelSheetLabelDto["publicationStatus"]>)
    : undefined;
}

function isPrivateIpv4(hostname: string) {
  if (/^0\./.test(hostname) || /^10\./.test(hostname) || /^127\./.test(hostname) || /^169\.254\./.test(hostname) || /^192\.168\./.test(hostname)) {
    return true;
  }
  const match = hostname.match(/^172\.(\d{1,3})\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

export function safeAiGraderLabelPublicUrl(value: unknown) {
  const text = optionalString(value);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    const hostname = url.hostname.toLowerCase();
    const unwrappedHostname = hostname.replace(/^\[|\]$/g, "");
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname === "::1" ||
      unwrappedHostname.includes(":") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal") ||
      isPrivateIpv4(hostname) ||
      /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(hostname) ||
      /^198\.1[89]\./.test(hostname) ||
      /^(?:22[4-9]|23\d|24\d|25[0-5])\./.test(hostname)
    ) {
      return undefined;
    }
    if (url.search || url.hash) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export function normalizeAiGraderConfirmedCardIdentity(value: unknown): AiGraderSafeConfirmedCardIdentity {
  const source = isRecord(value) ? value : {};
  const category = optionalString(source.category);
  const normalized: AiGraderSafeConfirmedCardIdentity = {
    ...(category === "sport" || category === "tcg" || category === "comics" ? { category } : {}),
    ...(optionalString(source.title ?? source.displayTitle) ? { title: optionalString(source.title ?? source.displayTitle) } : {}),
    ...(optionalString(source.playerName) ? { playerName: optionalString(source.playerName) } : {}),
    ...(optionalString(source.cardName) ? { cardName: optionalString(source.cardName) } : {}),
    ...(optionalString(source.teamName) ? { teamName: optionalString(source.teamName) } : {}),
    ...(optionalString(source.year) ? { year: optionalString(source.year) } : {}),
    ...(optionalString(source.manufacturer ?? source.company ?? source.brand) ? {
      manufacturer: optionalString(source.manufacturer ?? source.company ?? source.brand),
    } : {}),
    ...(optionalString(source.sport) ? { sport: optionalString(source.sport) } : {}),
    ...(optionalString(source.game) ? { game: optionalString(source.game) } : {}),
    ...(optionalString(source.productSet ?? source.set) ? { productSet: optionalString(source.productSet ?? source.set) } : {}),
    ...(optionalString(source.productLine) ? { productLine: optionalString(source.productLine) } : {}),
    ...(optionalString(source.insert) ? { insert: optionalString(source.insert) } : {}),
    ...(optionalString(source.insertSet) ? { insertSet: optionalString(source.insertSet) } : {}),
    ...(optionalString(source.parallel) ? { parallel: optionalString(source.parallel) } : {}),
    ...(optionalString(source.cardNumber ?? source.number) ? { cardNumber: optionalString(source.cardNumber ?? source.number) } : {}),
    ...(optionalString(source.numbered) ? { numbered: optionalString(source.numbered) } : {}),
    ...(optionalBoolean(source.autograph) !== undefined ? { autograph: optionalBoolean(source.autograph) } : {}),
    ...(optionalBoolean(source.memorabilia) !== undefined ? { memorabilia: optionalBoolean(source.memorabilia) } : {}),
  };
  return normalized;
}

export function parseAiGraderLabelSheetAssignment(payload: unknown): AiGraderLabelSheetAssignment | null {
  const source = isRecord(payload) && isRecord(payload.labelSheet) ? payload.labelSheet : null;
  if (!source || source.schemaVersion !== AI_GRADER_LABEL_SHEET_SCHEMA_VERSION) return null;
  const sheetId = optionalString(source.sheetId);
  const sheetNumber = positiveInteger(source.sheetNumber);
  const slot = positiveInteger(source.slot);
  const capacity = positiveInteger(source.capacity);
  const assignedAt = isoDateString(source.assignedAt);
  if (!sheetId || !sheetNumber || !slot || slot > AI_GRADER_LABEL_SHEET_CAPACITY || capacity !== AI_GRADER_LABEL_SHEET_CAPACITY || !assignedAt) {
    return null;
  }
  return {
    schemaVersion: AI_GRADER_LABEL_SHEET_SCHEMA_VERSION,
    sheetId,
    sheetNumber,
    slot,
    capacity: AI_GRADER_LABEL_SHEET_CAPACITY,
    assignedAt,
    ...(optionalString(source.assignedByUserId) ? { assignedByUserId: optionalString(source.assignedByUserId) } : {}),
    ...(isoDateString(source.sealedAt) ? { sealedAt: isoDateString(source.sealedAt) } : {}),
    ...(optionalString(source.sealedByUserId) ? { sealedByUserId: optionalString(source.sealedByUserId) } : {}),
    ...(isoDateString(source.printedAt) ? { printedAt: isoDateString(source.printedAt) } : {}),
    ...(optionalString(source.printedByUserId) ? { printedByUserId: optionalString(source.printedByUserId) } : {}),
  };
}

export function mergeAiGraderLabelSheetPayload(
  payload: unknown,
  assignment: AiGraderLabelSheetAssignment,
  confirmedCardIdentity?: unknown
): JsonRecord {
  const existing = isRecord(payload) ? payload : {};
  const normalizedIdentity = normalizeAiGraderConfirmedCardIdentity(confirmedCardIdentity ?? existing.confirmedCardIdentity);
  return {
    ...existing,
    labelSheet: assignment,
    ...(Object.keys(normalizedIdentity).length ? { confirmedCardIdentity: normalizedIdentity } : {}),
  };
}

function rowPublicationStatus(row: AiGraderLabelSheetSourceRow) {
  const report = isRecord(row.report) ? row.report : {};
  return safePublicationStatus(report.publicationStatus ?? row.publicationStatus);
}

function safeLabelNfcRegistration(value: unknown): AiGraderLabelNfcRegistrationDto | undefined {
  if (!isRecord(value) || optionalString(value.status)?.toLowerCase() !== "active") return undefined;
  const publicTagId = optionalString(value.publicTagId);
  if (!publicTagId || !/^[A-Za-z0-9_-]{32}$/.test(publicTagId)) return undefined;
  const expectedUrl = `https://collect.tenkings.co/nfc/${publicTagId}`;
  const securityMode = optionalString(value.securityMode) === "STATIC_URL_V1"
    ? "static_url_v1"
    : optionalString(value.securityMode);
  if (
    optionalString(value.nfcTagUrl) !== expectedUrl ||
    optionalString(value.chipType) !== "NTAG215" ||
    securityMode !== "static_url_v1"
  ) return undefined;
  return {
    status: "active",
    registrationKind: "registered_link",
    publicTagId,
    nfcTagUrl: expectedUrl,
    chipType: "NTAG215",
    securityMode: "static_url_v1",
  };
}

export function toSafeAiGraderLabelSheetLabel(row: AiGraderLabelSheetSourceRow): AiGraderLabelSheetLabelDto | null {
  const assignment = parseAiGraderLabelSheetAssignment(row.payload);
  const labelId = optionalString(row.id);
  const reportId = optionalString(row.reportId);
  if (!assignment || !labelId || !reportId) return null;
  const payload = isRecord(row.payload) ? row.payload : {};
  const cardIdentity = payload.confirmedCardIdentity ?? payload.confirmedCard ?? payload.cardIdentity;
  const nfc = safeLabelNfcRegistration(row.nfc);
  return {
    labelId,
    reportId,
    ...(optionalString(row.certId) ? { certId: optionalString(row.certId) } : {}),
    grade: optionalString(row.labelGradeText) ?? "PENDING",
    slot: assignment.slot,
    assignedAt: assignment.assignedAt,
    ...(safeAiGraderLabelPublicUrl(row.qrPayloadUrl) ? { qrPayloadUrl: safeAiGraderLabelPublicUrl(row.qrPayloadUrl) } : {}),
    ...(safeAiGraderLabelPublicUrl(row.publicReportUrl) ? { publicReportUrl: safeAiGraderLabelPublicUrl(row.publicReportUrl) } : {}),
    ...(rowPublicationStatus(row) ? { publicationStatus: rowPublicationStatus(row) } : {}),
    physicalPrintStatus: optionalString(row.physicalPrintStatus) === "printed" ? "printed" : "not_printed",
    confirmedCardIdentity: normalizeAiGraderConfirmedCardIdentity(cardIdentity),
    ...(nfc ? { nfc } : {}),
  };
}

function fnv1a64(value: string) {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

export function buildAiGraderLabelSheetRevision(
  labels: ReadonlyArray<
    Pick<AiGraderLabelSheetLabelDto, "labelId" | "slot"> &
      Partial<
        Pick<
          AiGraderLabelSheetLabelDto,
          "certId" | "grade" | "qrPayloadUrl" | "publicReportUrl" | "confirmedCardIdentity"
        >
      >
  >
) {
  const stable = [...labels]
    .sort((left, right) => left.slot - right.slot || left.labelId.localeCompare(right.labelId))
    .map((label) =>
      JSON.stringify({
        slot: label.slot,
        labelId: label.labelId,
        certId: label.certId ?? null,
        grade: label.grade ?? null,
        qrPayloadUrl: label.qrPayloadUrl ?? null,
        publicReportUrl: label.publicReportUrl ?? null,
        confirmedCardIdentity: label.confirmedCardIdentity ?? {},
      })
    )
    .join("|");
  return `aiglsr_${fnv1a64(stable)}`;
}

function sheetStatus(labels: AiGraderLabelSheetLabelDto[], assignments: AiGraderLabelSheetAssignment[], slotConflict: boolean) {
  const printedCount = labels.filter((label) => label.physicalPrintStatus === "printed").length;
  const allPrinted = labels.length > 0 && printedCount === labels.length;
  if (allPrinted) return "printed" as const;
  if (slotConflict || printedCount > 0 || assignments.some((assignment) => Boolean(assignment.sealedAt || assignment.printedAt))) {
    return "sealed" as const;
  }
  if (new Set(labels.map((label) => label.slot)).size >= AI_GRADER_LABEL_SHEET_CAPACITY) return "full" as const;
  return "open" as const;
}

export function buildAiGraderLabelSheetsResult(rows: readonly AiGraderLabelSheetSourceRow[]): AiGraderLabelSheetsResult {
  const grouped = new Map<string, Array<{ label: AiGraderLabelSheetLabelDto; assignment: AiGraderLabelSheetAssignment }>>();
  let unassignedLabelCount = 0;
  for (const row of rows) {
    const assignment = parseAiGraderLabelSheetAssignment(row.payload);
    const label = toSafeAiGraderLabelSheetLabel(row);
    if (!assignment || !label) {
      unassignedLabelCount += 1;
      continue;
    }
    const group = grouped.get(assignment.sheetId) ?? [];
    group.push({ label, assignment });
    grouped.set(assignment.sheetId, group);
  }

  const sheets = [...grouped.entries()].map(([sheetId, entries]): AiGraderLabelSheetDto => {
    entries.sort((left, right) => left.label.slot - right.label.slot || left.label.labelId.localeCompare(right.label.labelId));
    const labels = entries.map((entry) => entry.label);
    const assignments = entries.map((entry) => entry.assignment);
    const occupiedSlots = new Set(labels.map((label) => label.slot));
    const slotConflict = occupiedSlots.size !== labels.length;
    const status = sheetStatus(labels, assignments, slotConflict);
    const assignedTimes = assignments.map((assignment) => assignment.assignedAt).sort();
    const sealedTimes = assignments.map((assignment) => assignment.sealedAt).filter((value): value is string => Boolean(value)).sort();
    const printedTimes = assignments.map((assignment) => assignment.printedAt).filter((value): value is string => Boolean(value)).sort();
    return {
      sheetId,
      sheetNumber: Math.max(...assignments.map((assignment) => assignment.sheetNumber)),
      capacity: AI_GRADER_LABEL_SHEET_CAPACITY,
      status,
      labelCount: labels.length,
      openSlotCount: Math.max(0, AI_GRADER_LABEL_SHEET_CAPACITY - occupiedSlots.size),
      firstAssignedAt: assignedTimes[0],
      lastAssignedAt: assignedTimes[assignedTimes.length - 1],
      ...(sealedTimes.length ? { sealedAt: sealedTimes[sealedTimes.length - 1] } : {}),
      ...(printedTimes.length ? { printedAt: printedTimes[printedTimes.length - 1] } : {}),
      revision: buildAiGraderLabelSheetRevision(labels),
      slotConflict,
      labels,
    };
  });
  sheets.sort((left, right) => left.sheetNumber - right.sheetNumber || left.sheetId.localeCompare(right.sheetId));
  const openSheet = [...sheets].reverse().find((sheet) => sheet.status === "open" && !sheet.slotConflict);
  return {
    source: "persisted_records",
    orderedBy: "sheetNumber_asc_slot_asc",
    sheets,
    ...(openSheet ? { openSheetId: openSheet.sheetId } : {}),
    unassignedLabelCount,
    stats: {
      totalSheets: sheets.length,
      openSheets: sheets.filter((sheet) => sheet.status === "open").length,
      sealedSheets: sheets.filter((sheet) => sheet.status === "sealed" || sheet.status === "full").length,
      printedSheets: sheets.filter((sheet) => sheet.status === "printed").length,
      totalLabels: sheets.reduce((sum, sheet) => sum + sheet.labelCount, 0),
    },
  };
}

export function selectNextAiGraderLabelSheetSlot(
  rows: readonly AiGraderLabelSheetSourceRow[],
  input: {
    reportId: string;
    assignedAt: string | Date;
    assignedByUserId?: string;
    sheetIdForNumber?: (sheetNumber: number) => string;
  }
): AiGraderLabelSheetSlotSelection {
  const reportId = input.reportId.trim();
  const assignedAt = isoDateString(input.assignedAt);
  if (!reportId) throw new Error("reportId is required for AI Grader label sheet assignment.");
  if (!assignedAt) throw new Error("assignedAt must be a valid date for AI Grader label sheet assignment.");

  for (const row of rows) {
    if (optionalString(row.reportId) !== reportId) continue;
    const existing = parseAiGraderLabelSheetAssignment(row.payload);
    if (existing) {
      const sheet = buildAiGraderLabelSheetsResult(rows).sheets.find((candidate) => candidate.sheetId === existing.sheetId);
      return { assignment: existing, existing: true, sheetStatus: sheet?.status ?? "sealed" };
    }
  }

  const result = buildAiGraderLabelSheetsResult(rows);
  const current = [...result.sheets].reverse().find((sheet) => sheet.status === "open" && !sheet.slotConflict);
  const maxSheetNumber = result.sheets.reduce((max, sheet) => Math.max(max, sheet.sheetNumber), 0);
  const sheetNumber = current?.sheetNumber ?? maxSheetNumber + 1;
  const occupied = new Set(current?.labels.map((label) => label.slot) ?? []);
  let slot = 1;
  while (occupied.has(slot) && slot <= AI_GRADER_LABEL_SHEET_CAPACITY) slot += 1;
  if (slot > AI_GRADER_LABEL_SHEET_CAPACITY) throw new Error("AI Grader label sheet has no available slot.");
  const sheetId = current?.sheetId ?? input.sheetIdForNumber?.(sheetNumber) ?? `ai-grader-label-sheet-${String(sheetNumber).padStart(6, "0")}`;
  const assignment: AiGraderLabelSheetAssignment = {
    schemaVersion: AI_GRADER_LABEL_SHEET_SCHEMA_VERSION,
    sheetId,
    sheetNumber,
    slot,
    capacity: AI_GRADER_LABEL_SHEET_CAPACITY,
    assignedAt,
    ...(optionalString(input.assignedByUserId) ? { assignedByUserId: optionalString(input.assignedByUserId) } : {}),
  };
  return {
    assignment,
    existing: false,
    sheetStatus: slot === AI_GRADER_LABEL_SHEET_CAPACITY ? "full" : "open",
  };
}

export function sealAiGraderLabelSheetAssignment(
  assignment: AiGraderLabelSheetAssignment,
  input: { sealedAt: string | Date; sealedByUserId?: string }
): AiGraderLabelSheetAssignment {
  const sealedAt = isoDateString(input.sealedAt);
  if (!sealedAt) throw new Error("sealedAt must be a valid date.");
  return {
    ...assignment,
    sealedAt: assignment.sealedAt ?? sealedAt,
    ...(assignment.sealedByUserId
      ? { sealedByUserId: assignment.sealedByUserId }
      : optionalString(input.sealedByUserId)
        ? { sealedByUserId: optionalString(input.sealedByUserId) }
        : {}),
  };
}

export function printAiGraderLabelSheetAssignment(
  assignment: AiGraderLabelSheetAssignment,
  input: { printedAt: string | Date; printedByUserId?: string }
): AiGraderLabelSheetAssignment {
  const printedAt = isoDateString(input.printedAt);
  if (!printedAt) throw new Error("printedAt must be a valid date.");
  return {
    ...assignment,
    printedAt: assignment.printedAt ?? printedAt,
    ...(assignment.printedByUserId
      ? { printedByUserId: assignment.printedByUserId }
      : optionalString(input.printedByUserId)
        ? { printedByUserId: optionalString(input.printedByUserId) }
        : {}),
  };
}
