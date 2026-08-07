export type TenKingsV2StoredOperationFacts = {
  cardId: string;
  job: Record<string, string>;
  jobEnvelopeSha256: string;
  automaticTerminalAttempts?: string[];
  discardAcknowledgement?: {
    jobEnvelopeSha256: string;
    acknowledgementNonce: string;
    phase: "failed" | "uncertain" | "completed_unrecorded";
  };
};

export type TenKingsV2LocalIdentity = { cardId: string; jobEnvelopeSha256: string };

const PERMANENT_COMPLETION_REJECTIONS = new Set([
  "TEN_KINGS_V2_NFC_CARD_NO_LONGER_RECORDABLE",
  "TEN_KINGS_V2_NFC_CARD_TOKEN_CHANGED",
  "TEN_KINGS_V2_NFC_JOB_INVALID",
  "TEN_KINGS_V2_NFC_JOB_SIGNATURE_INVALID",
  "TEN_KINGS_V2_NFC_READBACK_DIGEST_MISMATCH",
  "TEN_KINGS_V2_NFC_RESULT_INVALID",
  "TEN_KINGS_V2_NFC_RESULT_JOB_MISMATCH",
  "TEN_KINGS_V2_NFC_RESULT_OUTSIDE_JOB_WINDOW",
  "TEN_KINGS_V2_NFC_RESULT_SIGNATURE_INVALID",
]);

export function tenKingsV2PermanentCompletionRejection(status: number, code: string | null) {
  return status === 409 && typeof code === "string" && PERMANENT_COMPLETION_REJECTIONS.has(code);
}

export type TenKingsV2CardNfcFacts = {
  id: string;
  nfcVerifiedAt: string | null;
};

export function tenKingsV2ExactKeySetMatches(actual: readonly string[] | null | undefined, expected: readonly string[]) {
  if (!actual || actual.length !== expected.length) return false;
  const sortedActual = [...actual].sort();
  const sortedExpected = [...expected].sort();
  return sortedActual.every((keyId, index) => keyId === sortedExpected[index]);
}

export function tenKingsV2HelperSignerAllowed(
  workstationKeyId: string | null | undefined,
  allowedWorkstationKeyIds: readonly string[],
) {
  return typeof workstationKeyId === "string" && allowedWorkstationKeyIds.includes(workstationKeyId);
}

export function tenKingsV2LocalOperationMatchesStored(
  stored: Pick<TenKingsV2StoredOperationFacts, "cardId" | "jobEnvelopeSha256">,
  local: TenKingsV2LocalIdentity,
) {
  return local.cardId === stored.cardId && local.jobEnvelopeSha256 === stored.jobEnvelopeSha256;
}

export function tenKingsV2ProvisionalRecoveryAction(
  stored: Pick<TenKingsV2StoredOperationFacts, "cardId" | "job" | "jobEnvelopeSha256">,
  local: TenKingsV2LocalIdentity | null,
): "PREPARE_EXACT_ISSUED_JOB" | "ACCEPT_EXACT_HELPER_STATE" | "BLOCK_MISMATCH" {
  if (stored.job.cardId !== stored.cardId) return "BLOCK_MISMATCH";
  if (local === null) return "PREPARE_EXACT_ISSUED_JOB";
  return tenKingsV2LocalOperationMatchesStored(stored, local)
    ? "ACCEPT_EXACT_HELPER_STATE"
    : "BLOCK_MISMATCH";
}

export function claimTenKingsV2AutomaticTerminalAttempt(
  stored: TenKingsV2StoredOperationFacts,
  phase: string,
): { claimed: boolean; attempts: string[] } {
  const key = `${stored.jobEnvelopeSha256}:${phase}`;
  const attempts = stored.automaticTerminalAttempts ?? [];
  if (attempts.includes(key)) return { claimed: false, attempts };
  return { claimed: true, attempts: [...attempts, key].slice(-4) };
}

export function tenKingsV2ClosingRecovery(
  phase: string,
): { kind: "success" } | { kind: "discard"; phase: "failed" | "uncertain" | "completed_unrecorded" } | null {
  if (phase === "closing_success") return { kind: "success" };
  if (phase === "closing_discard_failed") return { kind: "discard", phase: "failed" };
  if (phase === "closing_discard_uncertain") return { kind: "discard", phase: "uncertain" };
  if (phase === "closing_discard_completed_unrecorded") return { kind: "discard", phase: "completed_unrecorded" };
  return null;
}

export function reconcileMissingTenKingsV2LocalOperation(
  stored: TenKingsV2StoredOperationFacts,
  card: TenKingsV2CardNfcFacts,
): "verified" | "discard_acknowledged" | "unresolved" {
  if (card.id !== stored.cardId || stored.job.cardId !== stored.cardId) return "unresolved";
  const discard = stored.discardAcknowledgement;
  if (
    discard?.jobEnvelopeSha256 === stored.jobEnvelopeSha256 &&
    /^[a-f0-9]{64}$/.test(discard.jobEnvelopeSha256) &&
    /^[A-Za-z0-9_-]{32}$/.test(discard.acknowledgementNonce) &&
    (discard.phase === "failed" || discard.phase === "uncertain" || discard.phase === "completed_unrecorded")
  ) return "discard_acknowledged";
  const issuedAt = stored.job.issuedAt;
  if (
    typeof issuedAt !== "string" ||
    !card.nfcVerifiedAt
  ) return "unresolved";
  const issuedMillis = Date.parse(issuedAt);
  const verifiedMillis = Date.parse(card.nfcVerifiedAt);
  return Number.isFinite(issuedMillis) &&
    Number.isFinite(verifiedMillis) &&
    verifiedMillis >= issuedMillis
    ? "verified"
    : "unresolved";
}
