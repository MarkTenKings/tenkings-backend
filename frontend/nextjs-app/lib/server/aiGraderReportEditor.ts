import { createHash, randomUUID } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { sanitizeAiGraderPublicReportBundleForRead } from "@tenkings/database";
import {
  aiGraderReportBaseScoresFromBundle,
  aiGraderReportEditorialGradeStory,
  aiGraderReportEditorialRevisionFromGradeStory,
  aiGraderReportSevereDefectCapFromBundle,
  buildAiGraderReportEditorialRevisionV1,
  type AiGraderReportEditorialContent,
  type AiGraderReportEditorialRevisionV1,
} from "../aiGraderReportRevision";

type JsonRecord = Record<string, unknown>;

type AdminIdentity = {
  user: {
    id: string;
    displayName?: string | null;
  };
};

type ReportEditorDatabase = {
  aiGraderReport: {
    findUnique(args: unknown): Promise<unknown>;
  };
  $transaction<T>(callback: (tx: ReportEditorTransaction) => Promise<T>): Promise<T>;
};

type ReportEditorTransaction = {
  $queryRaw?: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
  aiGraderReport: {
    findUnique(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  };
  auditEvent: {
    create(args: unknown): Promise<unknown>;
    findFirst(args: unknown): Promise<unknown>;
    findUnique(args: unknown): Promise<unknown>;
  };
};

export type AiGraderReportEditorVisibility = "public" | "coming_soon";

export type AiGraderReportEditorAuditHead = {
  schemaVersion: "ten-kings-ai-grader-report-editor-audit-head-v1";
  sequence: number;
  headEventId: string;
  headChecksum: string;
  sourceBundleSha256: string;
};

export type AiGraderReportEditorState = {
  reportId: string;
  visibilityStatus: AiGraderReportEditorVisibility;
  completionStatus:
    | "machine_complete"
    | "machine_failed"
    | "human_reviewed_complete";
  revisionToken: string;
  sourceReportSchemaVersion: string;
  sourceBundleSha256: string;
  baseScores: ReturnType<typeof aiGraderReportBaseScoresFromBundle>;
  baseContent: AiGraderReportEditorialContent;
  applicableSevereDefectCap?: number;
  severeDefectCapProvenance:
    | "immutable_mathematical_v1_finding_ledger"
    | "none_source_report_has_no_v1_cap";
  machineFailure: {
    failed: boolean;
    codes: string[];
  };
  editorialRevision: AiGraderReportEditorialRevisionV1 | null;
};

export type AiGraderReportEditorService = {
  getState(input: { reportId: string }): Promise<AiGraderReportEditorState>;
  save(input: {
    reportId: string;
    expectedRevisionToken: string;
    expectedSourceBundleSha256: string;
    scores: unknown;
    content?: unknown;
    reason: string;
    actorUserId: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<AiGraderReportEditorState>;
  setVisibility(input: {
    reportId: string;
    expectedRevisionToken: string;
    visibilityStatus: AiGraderReportEditorVisibility;
    reason: string;
    actorUserId: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<AiGraderReportEditorState>;
};

export type AiGraderReportEditorApiDependencies = {
  requireAdminSession(req: NextApiRequest): Promise<AdminIdentity>;
  service: AiGraderReportEditorService;
};

type ReportRow = {
  id: string;
  tenantId: string;
  reportId: string;
  publicationStatus: string;
  visibilityStatus: string;
  publicReportUrl: string | null;
  reportBundleStorageKey: string | null;
  checksumSummary: unknown;
  gradeStory: unknown;
  publishedAt: Date | string | null;
  publication: {
    status: string;
    reportBundleStorageKey: string | null;
    assetManifest: unknown;
    publishedAt: Date | string | null;
    revokedAt: Date | string | null;
  } | null;
};

type SourceAuthority = {
  reportBundleStorageKey: string;
  sourceBundleSha256: string;
  sourceReportSchemaVersion: string;
  rawBundle: JsonRecord;
};

type EditorialSnapshot = {
  schemaVersion: "ten-kings-ai-grader-report-editor-state-v1";
  reportId: string;
  sourceReportSchemaVersion: string;
  sourceBundleSha256: string;
  visibilityStatus: AiGraderReportEditorVisibility;
  manualReportRevision: AiGraderReportEditorialRevisionV1 | null;
};

type AuditPayload = {
  schemaVersion: "ten-kings-ai-grader-report-editor-audit-event-v1";
  sequence: number;
  previousEventId: string | null;
  previousChecksum: string | null;
  privateReason: string;
  state: EditorialSnapshot;
};

const REPORT_SELECT = {
  id: true,
  tenantId: true,
  reportId: true,
  publicationStatus: true,
  visibilityStatus: true,
  publicReportUrl: true,
  reportBundleStorageKey: true,
  checksumSummary: true,
  gradeStory: true,
  publishedAt: true,
  publication: {
    select: {
      status: true,
      reportBundleStorageKey: true,
      assetManifest: true,
      publishedAt: true,
      revokedAt: true,
    },
  },
} as const;

const AUDIT_HEAD_SCHEMA_VERSION =
  "ten-kings-ai-grader-report-editor-audit-head-v1" as const;
const EDITOR_STATE_SCHEMA_VERSION =
  "ten-kings-ai-grader-report-editor-state-v1" as const;
const AUDIT_EVENT_SCHEMA_VERSION =
  "ten-kings-ai-grader-report-editor-audit-event-v1" as const;
const AUDIT_ENTITY_TYPE = "AiGraderReport";
const AUDIT_SAVE_ACTION = "ai_grader.report.editorial_revision.saved";
const AUDIT_VISIBILITY_ACTION = "ai_grader.report.visibility.changed";
const AUDIT_ACTIONS = [AUDIT_SAVE_ACTION, AUDIT_VISIBILITY_ACTION] as const;
const SHA256_RE = /^[a-f0-9]{64}$/;
const SAFE_REPORT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/;

class ReportEditorError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "ReportEditorError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function asReportRow(value: unknown): ReportRow | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    typeof value.tenantId !== "string" ||
    typeof value.reportId !== "string"
  ) return null;
  return value as unknown as ReportRow;
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as JsonRecord)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

function exactIso(value: unknown, field: string): string {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  if (!Number.isFinite(date.getTime())) {
    throw new ReportEditorError(409, "AI_GRADER_REPORT_EDITOR_AUTHORITY_INVALID", `${field} is invalid.`);
  }
  return date.toISOString();
}

function exactReportId(value: unknown): string {
  if (typeof value !== "string" || !SAFE_REPORT_ID_RE.test(value)) {
    throw new ReportEditorError(400, "AI_GRADER_REPORT_EDITOR_INVALID_INPUT", "reportId is invalid.");
  }
  return value;
}

function exactSha256(value: unknown, field: string): string {
  if (typeof value !== "string" || !SHA256_RE.test(value)) {
    throw new ReportEditorError(400, "AI_GRADER_REPORT_EDITOR_INVALID_INPUT", `${field} must be a lowercase SHA-256 checksum.`);
  }
  return value;
}

function privateReason(value: unknown): string {
  if (typeof value !== "string") {
    throw new ReportEditorError(400, "AI_GRADER_REPORT_EDITOR_INVALID_INPUT", "A private edit reason is required.");
  }
  const reason = value.replace(/\r\n?/g, "\n").trim();
  if (!reason || reason.length > 1_000 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(reason)) {
    throw new ReportEditorError(400, "AI_GRADER_REPORT_EDITOR_INVALID_INPUT", "The private edit reason is invalid or exceeds 1,000 characters.");
  }
  return reason;
}

function exactVisibility(value: unknown): AiGraderReportEditorVisibility {
  if (value !== "public" && value !== "coming_soon") {
    throw new ReportEditorError(400, "AI_GRADER_REPORT_EDITOR_INVALID_INPUT", "visibilityStatus must be public or coming_soon.");
  }
  return value;
}

function publishedDate(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  return Number.isFinite(date.getTime());
}

function assertPublishedReport(row: ReportRow, expectedReportId: string) {
  if (
    row.reportId !== expectedReportId ||
    row.publicationStatus !== "published" ||
    !publishedDate(row.publishedAt) ||
    row.publication?.status !== "published" ||
    !publishedDate(row.publication?.publishedAt) ||
    row.publication?.revokedAt
  ) {
    throw new ReportEditorError(
      409,
      "AI_GRADER_REPORT_EDITOR_NOT_PUBLISHED",
      "Only one durably published, non-revoked AI Grader report can be edited.",
    );
  }
  exactVisibility(row.visibilityStatus);
  if (
    !row.reportBundleStorageKey ||
    row.publication.reportBundleStorageKey !== row.reportBundleStorageKey
  ) {
    throw new ReportEditorError(
      409,
      "AI_GRADER_REPORT_EDITOR_AUTHORITY_INVALID",
      "Published report storage authority is missing or contradictory.",
    );
  }
}

function manifestEntry(value: unknown, storageKey: string) {
  if (!Array.isArray(value)) return null;
  const matches = value.filter((entry) =>
    isRecord(entry) &&
    entry.kind === "report-bundle.json" &&
    entry.storageKey === storageKey &&
    typeof entry.checksumSha256 === "string" &&
    SHA256_RE.test(entry.checksumSha256) &&
    Number.isSafeInteger(entry.byteSize) &&
    Number(entry.byteSize) > 0
  );
  if (matches.length !== 1) return null;
  return {
    checksumSha256: String(matches[0].checksumSha256),
    byteSize: Number(matches[0].byteSize),
  };
}

function sourceManifestAuthority(row: ReportRow) {
  const summary = isRecord(row.checksumSummary) ? row.checksumSummary : {};
  const reportEntry = manifestEntry(summary.assets, String(row.reportBundleStorageKey));
  const publicationEntry = manifestEntry(
    row.publication?.assetManifest,
    String(row.reportBundleStorageKey),
  );
  if (
    !reportEntry ||
    !publicationEntry ||
    reportEntry.checksumSha256 !== publicationEntry.checksumSha256 ||
    reportEntry.byteSize !== publicationEntry.byteSize
  ) {
    throw new ReportEditorError(
      409,
      "AI_GRADER_REPORT_EDITOR_AUTHORITY_INVALID",
      "Published report checksum authority is missing or contradictory.",
    );
  }
  return reportEntry;
}

function isMachineFailureStatus(value: unknown) {
  return typeof value === "string" &&
    /insufficient|fail|error|abort|not_computed|blocked|invalid/i.test(value);
}

function machineSourceClaimsSuccess(bundle: JsonRecord) {
  const release = isRecord(bundle.productionRelease) ? bundle.productionRelease : {};
  const finalGrade = isRecord(release.finalGrade) ? release.finalGrade : {};
  const successStatuses = [
    bundle.finalStatus,
    bundle.reportStatus,
    release.finalStatus,
    release.reportStatus,
  ].some((value) => typeof value === "string" && [
    "final_grade_computed",
    "final_ai_grader_report_v0",
    "final_ai_grader_report_v1",
  ].includes(value));
  const finalGradeClaim = typeof finalGrade.overall === "number" &&
    Number.isFinite(finalGrade.overall) &&
    typeof finalGrade.status === "string" &&
    !isMachineFailureStatus(finalGrade.status);
  return bundle.finalGradeComputed === true ||
    release.finalGradeComputed === true ||
    successStatuses ||
    finalGradeClaim;
}

function gatesExplicitlyFailed(value: unknown) {
  if (!isRecord(value)) return false;
  if (value.requiredGatesPassed === false) return true;
  if (Array.isArray(value.blockers) && value.blockers.length > 0) return true;
  return Array.isArray(value.results) && value.results.some((result) =>
    isRecord(result) &&
    typeof result.status === "string" &&
    !/^(?:pass|passed|accepted|ok|success)$/i.test(result.status));
}

function machineSourceExplicitlyFailed(bundle: JsonRecord) {
  const release = isRecord(bundle.productionRelease) ? bundle.productionRelease : {};
  const provisional = isRecord(bundle.provisionalGrade) ? bundle.provisionalGrade : {};
  const mathematicalV1 = isRecord(bundle.mathematicalV1) ? bundle.mathematicalV1 : {};
  const mathematicalExecution = isRecord(mathematicalV1.execution)
    ? mathematicalV1.execution
    : {};
  const explicitFailure = bundle.finalGradeComputed === false ||
    release.finalGradeComputed === false ||
    [
      bundle.finalStatus,
      bundle.reportStatus,
      provisional.status,
      release.finalStatus,
      release.reportStatus,
      isRecord(release.finalGrade) ? release.finalGrade.status : undefined,
      mathematicalV1.status,
      mathematicalExecution.status,
    ].some(isMachineFailureStatus) ||
    gatesExplicitlyFailed(provisional.gates) ||
    gatesExplicitlyFailed(release.gates) ||
    typeof bundle.errorCode === "string" ||
    typeof release.errorCode === "string" ||
    typeof provisional.errorCode === "string";
  if (explicitFailure) return true;
  if (machineSourceClaimsSuccess(bundle)) return false;
  const scores = aiGraderReportBaseScoresFromBundle(bundle);
  return ["centering", "corners", "edges", "surface"].some((element) =>
    typeof scores[element as keyof typeof scores] !== "number");
}

function parseBundleBytes(
  bytes: Uint8Array,
  row: ReportRow,
  publicUrlFor: (storageKey: string) => string,
): SourceAuthority {
  const manifest = sourceManifestAuthority(row);
  const buffer = Buffer.from(bytes);
  const digest = sha256(buffer);
  if (buffer.byteLength !== manifest.byteSize || digest !== manifest.checksumSha256) {
    throw new ReportEditorError(
      409,
      "AI_GRADER_REPORT_EDITOR_SOURCE_INTEGRITY_MISMATCH",
      "Stored report bytes do not match immutable Publish authority.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new ReportEditorError(409, "AI_GRADER_REPORT_EDITOR_SOURCE_INVALID", "Published report JSON is invalid.");
  }
  if (
    !isRecord(parsed) ||
    parsed.reportId !== row.reportId ||
    typeof parsed.schemaVersion !== "string" ||
    ![
      "ai-grader-report-bundle-v0.1",
      "ai-grader-report-bundle-v0.2",
      "ai-grader-report-bundle-v0.3",
    ].includes(parsed.schemaVersion)
  ) {
    throw new ReportEditorError(
      409,
      "AI_GRADER_REPORT_EDITOR_SOURCE_INVALID",
      "Published report identity or schema version is invalid.",
    );
  }
  const sanitizedSource = sanitizeAiGraderPublicReportBundleForRead(parsed, {
    expectedReportId: row.reportId,
    publicUrlFor,
  });
  if (!sanitizedSource && (
    machineSourceClaimsSuccess(parsed) ||
    !machineSourceExplicitlyFailed(parsed)
  )) {
    throw new ReportEditorError(
      409,
      "AI_GRADER_REPORT_EDITOR_SOURCE_INVALID",
      "Published report failed validation without one explicit machine-failure state eligible for admin adjudication.",
    );
  }
  return {
    reportBundleStorageKey: String(row.reportBundleStorageKey),
    sourceBundleSha256: digest,
    sourceReportSchemaVersion: parsed.schemaVersion,
    rawBundle: parsed,
  };
}

function sourceText(value: unknown, maximum: number) {
  if (typeof value !== "string") return undefined;
  const normalized = value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
  return normalized ? normalized.slice(0, maximum) : undefined;
}

function sourceExplanation(value: unknown) {
  return isRecord(value) ? sourceText(value.explanation, 1_000) : undefined;
}

function sourceWhyNot10(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const text = value
    .flatMap((entry) => {
      if (!isRecord(entry)) return [];
      const explanation = sourceText(entry.explanation, 1_000);
      return explanation ? [explanation] : [];
    })
    .join("\n\n")
    .slice(0, 2_000);
  return text || undefined;
}

function baseContentFromBundle(bundle: JsonRecord): AiGraderReportEditorialContent {
  const identity = isRecord(bundle.cardIdentity) ? bundle.cardIdentity : {};
  const provisional = isRecord(bundle.provisionalGrade) ? bundle.provisionalGrade : {};
  const story = isRecord(provisional.gradeStory) ? provisional.gradeStory : {};
  const provisionalElements = isRecord(provisional.elementScores)
    ? provisional.elementScores
    : {};
  const release = isRecord(bundle.productionRelease) ? bundle.productionRelease : {};
  const finalGrade = isRecord(release.finalGrade) ? release.finalGrade : {};
  const finalElements = isRecord(finalGrade.elements) ? finalGrade.elements : {};
  return Object.fromEntries([
    ["cardTitle", sourceText(identity.title, 240)],
    ["reportSummary", sourceText(story.summary, 2_000)],
    ["centeringExplanation", sourceExplanation(finalElements.centering) ?? sourceExplanation(provisionalElements.centering)],
    ["cornersExplanation", sourceExplanation(finalElements.corners) ?? sourceExplanation(provisionalElements.corners)],
    ["edgesExplanation", sourceExplanation(finalElements.edges) ?? sourceExplanation(provisionalElements.edges)],
    ["surfaceExplanation", sourceExplanation(finalElements.surface) ?? sourceExplanation(provisionalElements.surface)],
    ["strongestPositive", sourceText(story.strongestPositiveFinding, 1_000)],
    ["strongestWarning", sourceText(story.strongestWarning, 1_000)],
    ["whyNot10", sourceWhyNot10(finalGrade.whyNot10) ?? sourceWhyNot10(provisional.whyNot10)],
  ].filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function normalizedFailureCode(value: unknown, prefix = "") {
  if (typeof value !== "string") return null;
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9._:-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, Math.max(0, 128 - prefix.length));
  return normalized ? `${prefix}${normalized}` : null;
}

function machineFailureFromBundle(
  bundle: JsonRecord,
  baseScores: ReturnType<typeof aiGraderReportBaseScoresFromBundle>,
) {
  const codes = new Set<string>();
  const release = isRecord(bundle.productionRelease) ? bundle.productionRelease : {};
  const provisional = isRecord(bundle.provisionalGrade) ? bundle.provisionalGrade : {};
  const calibration = isRecord(bundle.calibrationProfile) ? bundle.calibrationProfile : null;
  const mathematicalV1 = isRecord(bundle.mathematicalV1) ? bundle.mathematicalV1 : {};
  const mathematicalExecution = isRecord(mathematicalV1.execution)
    ? mathematicalV1.execution
    : {};
  const collectStatus = (value: unknown, prefix: string) => {
    if (typeof value !== "string" || [
      "final_grade_computed",
      "final_ai_grader_report_v0",
      "final_ai_grader_report_v1",
      "final_ai_grader_grade_v0",
      "final_ai_grader_grade_v1",
    ].includes(value)) return;
    if (/insufficient|fail|error|abort|not_computed|blocked|invalid/i.test(value)) {
      const code = normalizedFailureCode(value, prefix);
      if (code) codes.add(code);
    }
  };
  if (bundle.finalGradeComputed === false || release.finalGradeComputed === false) {
    codes.add("MACHINE_FINAL_GRADE_NOT_COMPUTED");
  }
  if (bundle.schemaVersion !== "ai-grader-report-bundle-v0.3") {
    codes.add("SOURCE_NOT_MATHEMATICAL_CALIBRATION_V1");
  }
  if (bundle.gradingContract === "legacy_v0") {
    codes.add("SOURCE_GRADING_CONTRACT_LEGACY_V0");
  }
  if (calibration && calibration.isCalibrated !== true) {
    codes.add("MATHEMATICAL_CALIBRATION_NOT_FINALIZED");
  }
  collectStatus(bundle.finalStatus, "BUNDLE_FINAL_STATUS_");
  collectStatus(bundle.reportStatus, "BUNDLE_REPORT_STATUS_");
  collectStatus(provisional.status, "PROVISIONAL_STATUS_");
  collectStatus(release.finalStatus, "RELEASE_FINAL_STATUS_");
  collectStatus(release.reportStatus, "RELEASE_REPORT_STATUS_");
  collectStatus(isRecord(release.finalGrade) ? release.finalGrade.status : undefined, "MACHINE_GRADE_STATUS_");
  collectStatus(mathematicalV1.status, "MATHEMATICAL_V1_STATUS_");
  collectStatus(mathematicalExecution.status, "MATHEMATICAL_V1_EXECUTION_STATUS_");

  if (Array.isArray(mathematicalExecution.reasons)) {
    for (const reason of mathematicalExecution.reasons) {
      const value = isRecord(reason) ? reason.code ?? reason.reasonCode ?? reason.message : reason;
      const code = normalizedFailureCode(value, "MATHEMATICAL_V1_REASON_");
      if (code) codes.add(code);
    }
  }

  const gateSources = [
    isRecord(provisional.gates) ? provisional.gates : null,
    isRecord(release.gates) ? release.gates : null,
  ].filter((value): value is JsonRecord => Boolean(value));
  for (const gates of gateSources) {
    if (gates.requiredGatesPassed === false) codes.add("MACHINE_REQUIRED_GATES_FAILED");
    if (Array.isArray(gates.blockers)) {
      for (const blocker of gates.blockers) {
        const code = normalizedFailureCode(blocker, "GATE_BLOCKER_");
        if (code) codes.add(code);
      }
    }
    if (Array.isArray(gates.results)) {
      for (const result of gates.results) {
        if (!isRecord(result) || typeof result.status !== "string" ||
          /^(?:pass|passed|accepted|ok|success)$/i.test(result.status)) continue;
        const gate = normalizedFailureCode(result.gate, "") ?? "UNKNOWN";
        const status = normalizedFailureCode(result.status, "") ?? "FAILED";
        codes.add(`GATE_${gate}_${status}`.slice(0, 128));
      }
    }
  }
  for (const value of [bundle.errorCode, release.errorCode, provisional.errorCode]) {
    const code = normalizedFailureCode(value, "MACHINE_ERROR_");
    if (code) codes.add(code);
  }
  if (["centering", "corners", "edges", "surface"].some((key) =>
    typeof baseScores[key as keyof typeof baseScores] !== "number")) {
    codes.add("MACHINE_SUBGRADES_INCOMPLETE");
  }
  const result = [...codes].sort().slice(0, 100);
  return { failed: result.length > 0, codes: result };
}

function readAuditHead(gradeStory: unknown): AiGraderReportEditorAuditHead | null {
  if (!isRecord(gradeStory)) return null;
  const value = gradeStory.manualReportRevisionAudit;
  if (value === undefined) return null;
  if (
    !isRecord(value) ||
    value.schemaVersion !== AUDIT_HEAD_SCHEMA_VERSION ||
    !Number.isSafeInteger(value.sequence) ||
    Number(value.sequence) < 1 ||
    typeof value.headEventId !== "string" ||
    !SAFE_REPORT_ID_RE.test(value.headEventId) ||
    typeof value.headChecksum !== "string" ||
    !SHA256_RE.test(value.headChecksum) ||
    typeof value.sourceBundleSha256 !== "string" ||
    !SHA256_RE.test(value.sourceBundleSha256)
  ) {
    throw new ReportEditorError(
      409,
      "AI_GRADER_REPORT_EDITOR_REVISION_INVALID",
      "The active report revision audit head is invalid. The original report was not substituted.",
    );
  }
  return value as unknown as AiGraderReportEditorAuditHead;
}

function readManualRevision(
  gradeStory: unknown,
  reportId: string,
): AiGraderReportEditorialRevisionV1 | null {
  const hasRevision = isRecord(gradeStory) &&
    Object.prototype.hasOwnProperty.call(gradeStory, "manualReportRevision");
  const revision = aiGraderReportEditorialRevisionFromGradeStory(gradeStory, reportId);
  if (hasRevision && !revision) {
    throw new ReportEditorError(
      409,
      "AI_GRADER_REPORT_EDITOR_REVISION_INVALID",
      "The active manual report revision is invalid. The original report was not substituted.",
    );
  }
  return revision;
}

function snapshot(
  row: ReportRow,
  source: SourceAuthority,
  revision: AiGraderReportEditorialRevisionV1 | null,
): EditorialSnapshot {
  return {
    schemaVersion: EDITOR_STATE_SCHEMA_VERSION,
    reportId: row.reportId,
    sourceReportSchemaVersion: source.sourceReportSchemaVersion,
    sourceBundleSha256: source.sourceBundleSha256,
    visibilityStatus: exactVisibility(row.visibilityStatus),
    manualReportRevision: revision,
  };
}

function auditPayload(value: unknown): AuditPayload | null {
  if (!isRecord(value) || value.schemaVersion !== AUDIT_EVENT_SCHEMA_VERSION) return null;
  if (
    !Number.isSafeInteger(value.sequence) || Number(value.sequence) < 1 ||
    !(value.previousEventId === null ||
      (typeof value.previousEventId === "string" && SAFE_REPORT_ID_RE.test(value.previousEventId))) ||
    !(value.previousChecksum === null ||
      (typeof value.previousChecksum === "string" && SHA256_RE.test(value.previousChecksum))) ||
    typeof value.privateReason !== "string" ||
    !isRecord(value.state)
  ) return null;
  return value as unknown as AuditPayload;
}

function eventChecksum(event: {
  id: string;
  tenantId: string;
  actorOperatorId?: string | null;
  actorUserId?: string | null;
  entityType: string;
  entityId: string;
  action: string;
  outcome: string;
  before?: unknown;
  after?: unknown;
  reasonCode?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: Date | string;
}) {
  return sha256(canonicalJson({
    id: event.id,
    tenantId: event.tenantId,
    actorOperatorId: event.actorOperatorId ?? null,
    actorUserId: event.actorUserId ?? null,
    entityType: event.entityType,
    entityId: event.entityId,
    action: event.action,
    outcome: event.outcome,
    before: event.before ?? null,
    after: event.after ?? null,
    reasonCode: event.reasonCode ?? null,
    ipAddress: event.ipAddress ?? null,
    userAgent: event.userAgent ?? null,
    createdAt: exactIso(event.createdAt, "auditEvent.createdAt"),
  }));
}

function sameSnapshot(left: EditorialSnapshot, right: EditorialSnapshot) {
  return canonicalJson(left) === canonicalJson(right);
}

async function assertAuditChain(
  tx: ReportEditorTransaction,
  row: ReportRow,
  source: SourceAuthority,
  revision: AiGraderReportEditorialRevisionV1 | null,
  head: AiGraderReportEditorAuditHead | null,
) {
  if (revision && (
    revision.sourceBundleSha256 !== source.sourceBundleSha256 ||
    revision.sourceReportSchemaVersion !== source.sourceReportSchemaVersion
  )) {
    throw new ReportEditorError(
      409,
      "AI_GRADER_REPORT_EDITOR_SOURCE_CHANGED",
      "The active admin adjudication is not bound to the current immutable source report.",
    );
  }
  if (!head) {
    if (revision) {
      throw new ReportEditorError(409, "AI_GRADER_REPORT_EDITOR_REVISION_INVALID", "The active revision has no audit authority.");
    }
    const orphan = await tx.auditEvent.findFirst({
      where: {
        entityType: AUDIT_ENTITY_TYPE,
        entityId: row.id,
        action: { in: [...AUDIT_ACTIONS] },
      },
      select: { id: true },
    });
    if (orphan) {
      throw new ReportEditorError(
        409,
        "AI_GRADER_REPORT_EDITOR_AUDIT_HEAD_MISSING",
        "Report edit history exists but its active audit head is missing. The original report was not substituted.",
      );
    }
    return;
  }
  if (head.sourceBundleSha256 !== source.sourceBundleSha256) {
    throw new ReportEditorError(
      409,
      "AI_GRADER_REPORT_EDITOR_SOURCE_CHANGED",
      "The immutable source report changed after the active manual revision.",
    );
  }
  let expectedId: string | null = head.headEventId;
  let expectedChecksum: string | null = head.headChecksum;
  let expectedSequence = head.sequence;
  let headPayload: AuditPayload | null = null;
  const seen = new Set<string>();
  while (expectedId) {
    if (seen.has(expectedId) || seen.size >= 1_000) {
      throw new ReportEditorError(409, "AI_GRADER_REPORT_EDITOR_AUDIT_INVALID", "Report edit audit chain is cyclic or exceeds its validation limit.");
    }
    seen.add(expectedId);
    const raw = await tx.auditEvent.findUnique({ where: { id: expectedId } });
    if (!isRecord(raw)) {
      throw new ReportEditorError(409, "AI_GRADER_REPORT_EDITOR_AUDIT_INVALID", "A report edit audit event is missing.");
    }
    const computed = eventChecksum(raw as Parameters<typeof eventChecksum>[0]);
    const payload = auditPayload(raw.after);
    if (
      raw.entityType !== AUDIT_ENTITY_TYPE ||
      raw.entityId !== row.id ||
      !AUDIT_ACTIONS.includes(raw.action as typeof AUDIT_ACTIONS[number]) ||
      raw.outcome !== "SUCCESS" ||
      raw.checksum !== expectedChecksum ||
      computed !== expectedChecksum ||
      !payload ||
      payload.sequence !== expectedSequence
    ) {
      throw new ReportEditorError(409, "AI_GRADER_REPORT_EDITOR_AUDIT_INVALID", "Report edit audit integrity verification failed.");
    }
    if (!headPayload) headPayload = payload;
    expectedId = payload.previousEventId;
    expectedChecksum = payload.previousChecksum;
    expectedSequence -= 1;
    if ((expectedId === null) !== (expectedChecksum === null)) {
      throw new ReportEditorError(409, "AI_GRADER_REPORT_EDITOR_AUDIT_INVALID", "Report edit audit chain linkage is invalid.");
    }
  }
  if (expectedSequence !== 0 || !headPayload || !sameSnapshot(headPayload.state, snapshot(row, source, revision))) {
    throw new ReportEditorError(409, "AI_GRADER_REPORT_EDITOR_AUDIT_INVALID", "The active report state does not match its audit snapshot.");
  }
}

function revisionToken(
  row: ReportRow,
  source: SourceAuthority,
  revision: AiGraderReportEditorialRevisionV1 | null,
  head: AiGraderReportEditorAuditHead | null,
) {
  return sha256(canonicalJson({
    schemaVersion: "ten-kings-ai-grader-report-editor-revision-token-v1",
    state: snapshot(row, source, revision),
    head,
  }));
}

function projectedState(
  row: ReportRow,
  source: SourceAuthority,
  revision: AiGraderReportEditorialRevisionV1 | null,
  head: AiGraderReportEditorAuditHead | null,
): AiGraderReportEditorState {
  const baseScores = aiGraderReportBaseScoresFromBundle(source.rawBundle);
  const machineFailure = machineFailureFromBundle(source.rawBundle, baseScores);
  const applicableSevereDefectCap = aiGraderReportSevereDefectCapFromBundle(
    source.rawBundle,
  );
  return {
    reportId: row.reportId,
    visibilityStatus: exactVisibility(row.visibilityStatus),
    completionStatus: revision
      ? "human_reviewed_complete"
      : machineFailure.failed
        ? "machine_failed"
        : "machine_complete",
    revisionToken: revisionToken(row, source, revision, head),
    sourceReportSchemaVersion: source.sourceReportSchemaVersion,
    sourceBundleSha256: source.sourceBundleSha256,
    baseScores,
    baseContent: baseContentFromBundle(source.rawBundle),
    ...(applicableSevereDefectCap === undefined
      ? {}
      : { applicableSevereDefectCap }),
    severeDefectCapProvenance: applicableSevereDefectCap === undefined
      ? "none_source_report_has_no_v1_cap"
      : "immutable_mathematical_v1_finding_ledger",
    machineFailure,
    editorialRevision: revision,
  };
}

function withAuditHead(
  gradeStory: unknown,
  revision: AiGraderReportEditorialRevisionV1 | null,
  head: AiGraderReportEditorAuditHead,
) {
  const story = revision
    ? aiGraderReportEditorialGradeStory(gradeStory, revision)
    : { ...(isRecord(gradeStory) ? gradeStory : {}) };
  return { ...story, manualReportRevisionAudit: head };
}

function requestContextValue(value: string | null | undefined, maximum: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().slice(0, maximum);
  return normalized || null;
}

function buildAuditEvent(input: {
  row: ReportRow;
  action: typeof AUDIT_ACTIONS[number];
  before: EditorialSnapshot;
  after: EditorialSnapshot;
  previousHead: AiGraderReportEditorAuditHead | null;
  privateReason: string;
  actorUserId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const id = randomUUID();
  const createdAt = new Date();
  const sequence = (input.previousHead?.sequence ?? 0) + 1;
  const after: AuditPayload = {
    schemaVersion: AUDIT_EVENT_SCHEMA_VERSION,
    sequence,
    previousEventId: input.previousHead?.headEventId ?? null,
    previousChecksum: input.previousHead?.headChecksum ?? null,
    privateReason: input.privateReason,
    state: input.after,
  };
  const event = {
    id,
    tenantId: input.row.tenantId,
    actorOperatorId: null,
    actorUserId: input.actorUserId,
    entityType: AUDIT_ENTITY_TYPE,
    entityId: input.row.id,
    action: input.action,
    outcome: "SUCCESS",
    before: {
      schemaVersion: AUDIT_EVENT_SCHEMA_VERSION,
      sequence: input.previousHead?.sequence ?? 0,
      state: input.before,
    },
    after,
    reasonCode: input.action === AUDIT_SAVE_ACTION
      ? "ADMIN_REPORT_EDITORIAL_REVISION"
      : "ADMIN_REPORT_VISIBILITY_CHANGE",
    ipAddress: requestContextValue(input.ipAddress, 128),
    userAgent: requestContextValue(input.userAgent, 512),
    createdAt,
  };
  const checksum = eventChecksum(event);
  return {
    event: { ...event, checksum },
    head: {
      schemaVersion: AUDIT_HEAD_SCHEMA_VERSION,
      sequence,
      headEventId: id,
      headChecksum: checksum,
      sourceBundleSha256: input.after.sourceBundleSha256,
    } satisfies AiGraderReportEditorAuditHead,
  };
}

async function acquireReportLock(tx: ReportEditorTransaction, reportId: string) {
  if (typeof tx.$queryRaw !== "function") {
    throw new ReportEditorError(503, "AI_GRADER_REPORT_EDITOR_LOCK_UNAVAILABLE", "Report lifecycle locking is unavailable.");
  }
  await tx.$queryRaw`
    SELECT 1 AS "lockAcquired"
    FROM pg_advisory_xact_lock(hashtext('ai-grader-report-lifecycle'), hashtext(${reportId}))
  `;
}

function assertExpectedState(
  row: ReportRow,
  source: SourceAuthority,
  revision: AiGraderReportEditorialRevisionV1 | null,
  head: AiGraderReportEditorAuditHead | null,
  expectedRevisionToken: string,
  expectedSourceBundleSha256: string,
) {
  if (
    expectedSourceBundleSha256 !== source.sourceBundleSha256 ||
    expectedRevisionToken !== revisionToken(row, source, revision, head)
  ) {
    throw new ReportEditorError(
      409,
      "AI_GRADER_REPORT_EDITOR_STALE_REVISION",
      "The report changed after Edit Mode loaded. Reload the exact current revision before saving.",
    );
  }
}

async function preliminaryReport(db: ReportEditorDatabase, reportId: string) {
  const row = asReportRow(await db.aiGraderReport.findUnique({
    where: { reportId },
    select: REPORT_SELECT,
  }));
  if (!row) {
    throw new ReportEditorError(404, "AI_GRADER_REPORT_EDITOR_NOT_FOUND", "AI Grader report not found.");
  }
  assertPublishedReport(row, reportId);
  return row;
}

export function createAiGraderReportEditorService(input: {
  db: ReportEditorDatabase;
  readBundleBytes(storageKey: string): Promise<Uint8Array>;
  publicUrlFor(storageKey: string): string;
}): AiGraderReportEditorService {
  async function sourceBeforeLock(reportId: string) {
    const row = await preliminaryReport(input.db, reportId);
    let bytes: Uint8Array;
    try {
      bytes = await input.readBundleBytes(String(row.reportBundleStorageKey));
    } catch {
      throw new ReportEditorError(503, "AI_GRADER_REPORT_EDITOR_SOURCE_UNAVAILABLE", "Published report bytes are unavailable.");
    }
    return {
      storageKey: String(row.reportBundleStorageKey),
      bytes,
    };
  }

  async function lockedState<T>(
    reportId: string,
    operation: (context: {
      tx: ReportEditorTransaction;
      row: ReportRow;
      source: SourceAuthority;
      revision: AiGraderReportEditorialRevisionV1 | null;
      head: AiGraderReportEditorAuditHead | null;
    }) => Promise<T>,
  ) {
    const prepared = await sourceBeforeLock(reportId);
    return input.db.$transaction(async (tx) => {
      await acquireReportLock(tx, reportId);
      const row = asReportRow(await tx.aiGraderReport.findUnique({
        where: { reportId },
        select: REPORT_SELECT,
      }));
      if (!row) {
        throw new ReportEditorError(404, "AI_GRADER_REPORT_EDITOR_NOT_FOUND", "AI Grader report not found.");
      }
      assertPublishedReport(row, reportId);
      if (row.reportBundleStorageKey !== prepared.storageKey) {
        throw new ReportEditorError(409, "AI_GRADER_REPORT_EDITOR_SOURCE_CHANGED", "Published report authority changed while Edit Mode loaded.");
      }
      const source = parseBundleBytes(prepared.bytes, row, input.publicUrlFor);
      const revision = readManualRevision(row.gradeStory, reportId);
      const head = readAuditHead(row.gradeStory);
      await assertAuditChain(tx, row, source, revision, head);
      return operation({ tx, row, source, revision, head });
    });
  }

  return {
    async getState({ reportId }) {
      const exactId = exactReportId(reportId);
      return lockedState(exactId, async ({ row, source, revision, head }) =>
        projectedState(row, source, revision, head));
    },

    async save(saveInput) {
      const reportId = exactReportId(saveInput.reportId);
      const expectedToken = exactSha256(saveInput.expectedRevisionToken, "expectedRevisionToken");
      const expectedSource = exactSha256(saveInput.expectedSourceBundleSha256, "expectedSourceBundleSha256");
      const reason = privateReason(saveInput.reason);
      if (!saveInput.actorUserId) {
        throw new ReportEditorError(403, "AI_GRADER_REPORT_EDITOR_ADMIN_REQUIRED", "Admin identity is required.");
      }
      return lockedState(reportId, async ({ tx, row, source, revision, head }) => {
        assertExpectedState(row, source, revision, head, expectedToken, expectedSource);
        let nextRevision: AiGraderReportEditorialRevisionV1;
        try {
          nextRevision = buildAiGraderReportEditorialRevisionV1({
            reportId,
            sourceReportSchemaVersion: source.sourceReportSchemaVersion,
            sourceBundleSha256: source.sourceBundleSha256,
            revision: (revision?.revision ?? 0) + 1,
            editedAt: new Date().toISOString(),
            scores: saveInput.scores,
            content: saveInput.content,
            applicableSevereDefectCap: aiGraderReportSevereDefectCapFromBundle(source.rawBundle),
            adjudicatedMachineFailures: machineFailureFromBundle(
              source.rawBundle,
              aiGraderReportBaseScoresFromBundle(source.rawBundle),
            ).codes,
          });
        } catch (error) {
          throw new ReportEditorError(
            400,
            "AI_GRADER_REPORT_EDITOR_INVALID_INPUT",
            error instanceof Error ? error.message : "The report revision is invalid.",
          );
        }
        const before = snapshot(row, source, revision);
        const after = { ...before, manualReportRevision: nextRevision };
        const audit = buildAuditEvent({
          row,
          action: AUDIT_SAVE_ACTION,
          before,
          after,
          previousHead: head,
          privateReason: reason,
          actorUserId: saveInput.actorUserId,
          ipAddress: saveInput.ipAddress,
          userAgent: saveInput.userAgent,
        });
        await tx.auditEvent.create({ data: audit.event });
        const updated = asReportRow(await tx.aiGraderReport.update({
          where: { id: row.id },
          data: {
            gradeStory: withAuditHead(row.gradeStory, nextRevision, audit.head),
          },
          select: REPORT_SELECT,
        }));
        if (!updated) throw new ReportEditorError(500, "AI_GRADER_REPORT_EDITOR_UPDATE_FAILED", "Report revision update failed.");
        return projectedState(updated, source, nextRevision, audit.head);
      });
    },

    async setVisibility(visibilityInput) {
      const reportId = exactReportId(visibilityInput.reportId);
      const expectedToken = exactSha256(visibilityInput.expectedRevisionToken, "expectedRevisionToken");
      const nextVisibility = exactVisibility(visibilityInput.visibilityStatus);
      const reason = privateReason(visibilityInput.reason);
      if (!visibilityInput.actorUserId) {
        throw new ReportEditorError(403, "AI_GRADER_REPORT_EDITOR_ADMIN_REQUIRED", "Admin identity is required.");
      }
      return lockedState(reportId, async ({ tx, row, source, revision, head }) => {
        assertExpectedState(
          row,
          source,
          revision,
          head,
          expectedToken,
          source.sourceBundleSha256,
        );
        if (row.visibilityStatus === nextVisibility) {
          return projectedState(row, source, revision, head);
        }
        const before = snapshot(row, source, revision);
        const after: EditorialSnapshot = { ...before, visibilityStatus: nextVisibility };
        const audit = buildAuditEvent({
          row,
          action: AUDIT_VISIBILITY_ACTION,
          before,
          after,
          previousHead: head,
          privateReason: reason,
          actorUserId: visibilityInput.actorUserId,
          ipAddress: visibilityInput.ipAddress,
          userAgent: visibilityInput.userAgent,
        });
        await tx.auditEvent.create({ data: audit.event });
        const updated = asReportRow(await tx.aiGraderReport.update({
          where: { id: row.id },
          data: {
            visibilityStatus: nextVisibility,
            gradeStory: withAuditHead(row.gradeStory, revision, audit.head),
          },
          select: REPORT_SELECT,
        }));
        if (!updated) throw new ReportEditorError(500, "AI_GRADER_REPORT_EDITOR_UPDATE_FAILED", "Report visibility update failed.");
        return projectedState(updated, source, revision, audit.head);
      });
    },
  };
}

function actionFrom(req: NextApiRequest) {
  const values = Array.isArray(req.query.action) ? req.query.action : [req.query.action];
  return values.filter((value): value is string => typeof value === "string" && value.length > 0).join("/");
}

function exactBody(value: unknown, allowed: readonly string[]) {
  if (!isRecord(value)) {
    throw new ReportEditorError(400, "AI_GRADER_REPORT_EDITOR_INVALID_INPUT", "Request body must be an exact JSON object.");
  }
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) {
    throw new ReportEditorError(400, "AI_GRADER_REPORT_EDITOR_INVALID_INPUT", `Unsupported request fields: ${unknown.join(", ")}.`);
  }
  return value;
}

function clientIp(req: NextApiRequest) {
  const forwarded = req.headers["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return value?.split(",")[0]?.trim() ?? req.socket?.remoteAddress ?? null;
}

function userAgent(req: NextApiRequest) {
  const value = req.headers["user-agent"];
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function safeError(error: unknown) {
  const row = error as { statusCode?: unknown; code?: unknown; message?: unknown };
  if (typeof row?.statusCode === "number") {
    return {
      status: row.statusCode,
      code: typeof row.code === "string" ? row.code : "AI_GRADER_REPORT_EDITOR_REQUEST_FAILED",
      message: typeof row.message === "string" ? row.message : "AI Grader report editor request failed.",
    };
  }
  return {
    status: 500,
    code: "AI_GRADER_REPORT_EDITOR_REQUEST_FAILED",
    message: "AI Grader report editor request failed.",
  };
}

export function createAiGraderReportEditorApiHandler(
  deps: AiGraderReportEditorApiDependencies,
) {
  return async function aiGraderReportEditorApiHandler(
    req: NextApiRequest,
    res: NextApiResponse,
  ) {
    const action = actionFrom(req);
    const expectedMethod = action === "state" ? "GET"
      : action === "save" || action === "visibility" ? "POST"
        : null;
    if (!expectedMethod) {
      return res.status(404).json({ ok: false, code: "AI_GRADER_REPORT_EDITOR_ROUTE_NOT_FOUND", message: "Report editor route not found." });
    }
    if (req.method !== expectedMethod) {
      res.setHeader("Allow", expectedMethod);
      return res.status(405).json({ ok: false, code: "AI_GRADER_REPORT_EDITOR_METHOD_NOT_ALLOWED", message: "Method not allowed." });
    }
    try {
      const admin = await deps.requireAdminSession(req);
      if (action === "state") {
        const reportId = Array.isArray(req.query.reportId) ? req.query.reportId[0] : req.query.reportId;
        const state = await deps.service.getState({ reportId: exactReportId(reportId) });
        return res.status(200).json({ ok: true, state });
      }
      if (action === "save") {
        const body = exactBody(req.body, [
          "reportId",
          "expectedRevisionToken",
          "expectedSourceBundleSha256",
          "scores",
          "content",
          "reason",
        ]);
        const state = await deps.service.save({
          reportId: exactReportId(body.reportId),
          expectedRevisionToken: exactSha256(body.expectedRevisionToken, "expectedRevisionToken"),
          expectedSourceBundleSha256: exactSha256(body.expectedSourceBundleSha256, "expectedSourceBundleSha256"),
          scores: body.scores,
          content: body.content,
          reason: privateReason(body.reason),
          actorUserId: admin.user.id,
          ipAddress: clientIp(req),
          userAgent: userAgent(req),
        });
        return res.status(200).json({ ok: true, state });
      }
      const body = exactBody(req.body, [
        "reportId",
        "expectedRevisionToken",
        "visibilityStatus",
        "reason",
      ]);
      const state = await deps.service.setVisibility({
        reportId: exactReportId(body.reportId),
        expectedRevisionToken: exactSha256(body.expectedRevisionToken, "expectedRevisionToken"),
        visibilityStatus: exactVisibility(body.visibilityStatus),
        reason: privateReason(body.reason),
        actorUserId: admin.user.id,
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      return res.status(200).json({ ok: true, state });
    } catch (error) {
      const mapped = safeError(error);
      return res.status(mapped.status).json({
        ok: false,
        code: mapped.code,
        message: mapped.message,
      });
    }
  };
}
