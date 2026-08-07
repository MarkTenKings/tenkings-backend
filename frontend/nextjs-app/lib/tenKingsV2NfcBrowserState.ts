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
  "TEN_KINGS_V2_NFC_JOB_KEY_UNTRUSTED",
  "TEN_KINGS_V2_NFC_JOB_SIGNATURE_INVALID",
  "TEN_KINGS_V2_NFC_READBACK_DIGEST_MISMATCH",
  "TEN_KINGS_V2_NFC_RESULT_INVALID",
  "TEN_KINGS_V2_NFC_RESULT_JOB_MISMATCH",
  "TEN_KINGS_V2_NFC_RESULT_OUTSIDE_JOB_WINDOW",
  "TEN_KINGS_V2_NFC_RESULT_SIGNATURE_INVALID",
  "TEN_KINGS_V2_NFC_SIGNATURE_INVALID",
  "TEN_KINGS_V2_NFC_WORKSTATION_UNTRUSTED",
]);

export function tenKingsV2PermanentCompletionRejection(status: number, code: string | null) {
  return status === 409 && typeof code === "string" && PERMANENT_COMPLETION_REJECTIONS.has(code);
}

export type TenKingsV2NfcRecoveryCardFact = {
  id: string;
  nfcVerifiedAt: string | null;
};

export type TenKingsV2NfcRecoveryDecision =
  | "RECOVER_EXACT_LOCAL"
  | "CLEAR_DISCARD_ACK"
  | "CLEAR_VERIFIED"
  | "PREPARE_EXACT_JOB"
  | "FAIL_CLOSED";

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

const hasExactDiscardAcknowledgement = (stored: TenKingsV2StoredOperationFacts) => {
  const discard = stored.discardAcknowledgement;
  return discard?.jobEnvelopeSha256 === stored.jobEnvelopeSha256 &&
    /^[a-f0-9]{64}$/.test(discard.jobEnvelopeSha256) &&
    /^[A-Za-z0-9_-]{32}$/.test(discard.acknowledgementNonce) &&
    (discard.phase === "failed" || discard.phase === "uncertain" || discard.phase === "completed_unrecorded");
};

export function tenKingsV2NfcRecoveryDecision(
  stored: TenKingsV2StoredOperationFacts,
  input: {
    localOperation: TenKingsV2LocalIdentity | null;
    helperStatusErrorCode: string | null;
    cardFact: TenKingsV2NfcRecoveryCardFact | null;
    ordinaryCard: { id: string } | null;
  },
): TenKingsV2NfcRecoveryDecision {
  if (stored.job.cardId !== stored.cardId) return "FAIL_CLOSED";
  if (input.localOperation) {
    return tenKingsV2LocalOperationMatchesStored(stored, input.localOperation)
      ? "RECOVER_EXACT_LOCAL"
      : "FAIL_CLOSED";
  }
  if (input.helperStatusErrorCode !== "v2_nfc_job_not_found") return "FAIL_CLOSED";

  // This exact human acknowledgement is sufficient even if the ordinary card
  // row was later voided or removed. Inspect no card fact before this proof.
  if (hasExactDiscardAcknowledgement(stored)) return "CLEAR_DISCARD_ACK";

  const fact = input.cardFact;
  if (!fact || fact.id !== stored.cardId) return "FAIL_CLOSED";
  const issuedAt = canonicalUtcMillis(stored.job.issuedAt);
  const verifiedAt = canonicalUtcMillis(fact.nfcVerifiedAt);
  if (issuedAt !== null && verifiedAt !== null && verifiedAt >= issuedAt) {
    return "CLEAR_VERIFIED";
  }
  return input.ordinaryCard?.id === stored.cardId ? "PREPARE_EXACT_JOB" : "FAIL_CLOSED";
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

const canonicalUtcMillis = (value: unknown) => {
  if (typeof value !== "string") return null;
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) return null;
  return new Date(millis).toISOString() === value ? millis : null;
};

export function tenKingsV2MayClearUnstartedExpiredProvisional(
  stored: TenKingsV2StoredOperationFacts & { helperPrepared: boolean },
  input: {
    helperStatusErrorCode: string | null;
    helperPrepareErrorCode: string | null;
    localOperation: TenKingsV2LocalIdentity | null;
    now: Date;
  },
) {
  if (
    input.helperStatusErrorCode !== "v2_nfc_job_not_found" ||
    input.helperPrepareErrorCode !== "v2_nfc_job_expired"
  ) return false;
  if (stored.helperPrepared || input.localOperation !== null) return false;
  if (!Array.isArray(stored.automaticTerminalAttempts) || stored.automaticTerminalAttempts.length !== 0) return false;
  if (stored.discardAcknowledgement) return false;
  if (stored.job.cardId !== stored.cardId) return false;
  const expiresAt = canonicalUtcMillis(stored.job.expiresAt);
  const nowMillis = input.now.getTime();
  return expiresAt !== null && Number.isFinite(nowMillis) && nowMillis > expiresAt;
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
  card: TenKingsV2NfcRecoveryCardFact,
): "verified" | "discard_acknowledged" | "unresolved" {
  const decision = tenKingsV2NfcRecoveryDecision(stored, {
    localOperation: null,
    helperStatusErrorCode: "v2_nfc_job_not_found",
    cardFact: card,
    ordinaryCard: { id: card.id },
  });
  if (decision === "CLEAR_DISCARD_ACK") return "discard_acknowledged";
  return decision === "CLEAR_VERIFIED" ? "verified" : "unresolved";
}
