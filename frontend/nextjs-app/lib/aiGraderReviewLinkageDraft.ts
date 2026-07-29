import type {
  AiGraderMathematicalGradingAuthorityV1,
  AiGraderRapidQueueIdentity,
} from "./aiGraderLocalStation";

export const AI_GRADER_REVIEW_LINKAGE_DRAFT_STORAGE_KEY =
  "tenkings.aiGraderStation.reviewLinkageDraft.v1";

const MAX_PERSISTED_REVIEW_LINKAGE_DRAFTS = 25;
const LINKAGE_FIELDS = ["year", "manufacturer", "sport"] as const;
type LinkageField = (typeof LINKAGE_FIELDS)[number];

export type AiGraderReviewLinkageFields = Partial<Record<LinkageField, string>>;

type PersistedRecord = AiGraderRapidQueueIdentity & {
  updatedAt: string;
  fields: AiGraderReviewLinkageFields;
};

type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "getItem" | "setItem">;

function safeIdentityText(value: unknown) {
  return typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value)
    ? value
    : undefined;
}

function safeLinkageText(value: unknown) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized &&
    normalized.length <= 300 &&
    !/[\u0000-\u001f\u007f<>]/.test(normalized) &&
    !/(?:data|blob|file):/i.test(normalized) &&
    !/(?:authorization\s*:|bearer\s+|password\s*[=:]|token\s*[=:]|secret\s*[=:])/i.test(normalized)
    ? normalized
    : undefined;
}

function identityKey(identity: AiGraderRapidQueueIdentity) {
  return [
    identity.queueItemId,
    identity.gradingSessionId,
    identity.reportId,
  ].join("\u001f");
}

function safeRecord(value: unknown): PersistedRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const queueItemId = safeIdentityText(candidate.queueItemId);
  const gradingSessionId = safeIdentityText(candidate.gradingSessionId);
  const reportId = safeIdentityText(candidate.reportId);
  const updatedAt = typeof candidate.updatedAt === "string" &&
    Number.isFinite(Date.parse(candidate.updatedAt))
    ? new Date(candidate.updatedAt).toISOString()
    : undefined;
  if (
    !queueItemId ||
    !gradingSessionId ||
    !reportId ||
    !updatedAt ||
    !candidate.fields ||
    typeof candidate.fields !== "object" ||
    Array.isArray(candidate.fields)
  ) {
    return undefined;
  }
  const fields = Object.fromEntries(
    LINKAGE_FIELDS.flatMap((field) => {
      const text = safeLinkageText(
        (candidate.fields as Record<string, unknown>)[field],
      );
      return text ? [[field, text]] : [];
    }),
  ) as AiGraderReviewLinkageFields;
  if (!Object.keys(fields).length) return undefined;
  return { queueItemId, gradingSessionId, reportId, updatedAt, fields };
}

function readRecords(storage: StorageReader): PersistedRecord[] {
  try {
    const parsed = JSON.parse(
      storage.getItem(AI_GRADER_REVIEW_LINKAGE_DRAFT_STORAGE_KEY) ?? "[]",
    );
    if (!Array.isArray(parsed)) return [];
    const unique = new Map<string, PersistedRecord>();
    for (const value of parsed.slice(0, MAX_PERSISTED_REVIEW_LINKAGE_DRAFTS * 2)) {
      const record = safeRecord(value);
      if (record) unique.set(identityKey(record), record);
    }
    return [...unique.values()]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, MAX_PERSISTED_REVIEW_LINKAGE_DRAFTS);
  } catch {
    return [];
  }
}

export function readAiGraderReviewLinkageDraft(
  identity: AiGraderRapidQueueIdentity,
  storage: StorageReader,
) {
  return readRecords(storage).find(
    (record) => identityKey(record) === identityKey(identity),
  )?.fields;
}

export function persistAiGraderReviewLinkageField(
  identity: AiGraderRapidQueueIdentity,
  field: LinkageField,
  value: string,
  storage: StorageWriter,
  now = new Date(),
) {
  const exactIdentity = {
    queueItemId: safeIdentityText(identity.queueItemId),
    gradingSessionId: safeIdentityText(identity.gradingSessionId),
    reportId: safeIdentityText(identity.reportId),
  };
  if (
    !exactIdentity.queueItemId ||
    !exactIdentity.gradingSessionId ||
    !exactIdentity.reportId
  ) {
    throw new Error("Review linkage draft requires one exact queue/session/report identity.");
  }
  const records = readRecords(storage);
  const key = identityKey(identity);
  const existing = records.find((record) => identityKey(record) === key);
  const fields = { ...(existing?.fields ?? {}) };
  const text = safeLinkageText(value);
  if (text) fields[field] = text;
  else delete fields[field];
  const remaining = records.filter((record) => identityKey(record) !== key);
  if (Object.keys(fields).length) {
    remaining.unshift({
      queueItemId: exactIdentity.queueItemId,
      gradingSessionId: exactIdentity.gradingSessionId,
      reportId: exactIdentity.reportId,
      updatedAt: now.toISOString(),
      fields,
    });
  }
  storage.setItem(
    AI_GRADER_REVIEW_LINKAGE_DRAFT_STORAGE_KEY,
    JSON.stringify(remaining.slice(0, MAX_PERSISTED_REVIEW_LINKAGE_DRAFTS)),
  );
}

export function boundAiGraderReviewDraftPatch(
  authority: AiGraderMathematicalGradingAuthorityV1,
) {
  const pokemon = authority.cardFormatId === "pokemon_tcg_standard";
  const identity = authority.cardIdentity;
  return {
    category: pokemon ? "tcg" as const : "sport" as const,
    playerName: pokemon ? "" : identity.title,
    cardName: pokemon ? identity.title : "",
    game: pokemon ? "Pokemon" : "",
    productSet: identity.setId,
    cardNumber: identity.cardNumber,
    insert: identity.programId === "base" ? "" : identity.programId,
    parallel: identity.parallelId ?? "",
  };
}

export function boundAiGraderMathematicalAuthorityDraft(
  authority: AiGraderMathematicalGradingAuthorityV1,
) {
  return {
    cardFormatProfile:
      authority.cardFormatId === "pokemon_tcg_standard"
        ? "pokemon_tcg_standard" as const
        : "generic_standard" as const,
    title: authority.cardIdentity.title,
    tenantId: authority.cardIdentity.tenantId,
    setId: authority.cardIdentity.setId,
    programId: authority.cardIdentity.programId,
    cardNumber: authority.cardIdentity.cardNumber,
    variantId: authority.cardIdentity.variantId ?? "",
    parallelId: authority.cardIdentity.parallelId ?? "",
    profiles: {
      front: authority.sides.front.centering.profile,
      back: authority.sides.back.centering.profile,
    },
  };
}
