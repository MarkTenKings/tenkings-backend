export type TenKingsV2StoredOperationFacts = {
  cardId: string;
  job: Record<string, string>;
  jobEnvelopeSha256: string;
  discardAcknowledgement?: {
    jobEnvelopeSha256: string;
    acknowledgementNonce: string;
    phase: "failed" | "uncertain";
  };
};

export type TenKingsV2CardNfcFacts = {
  id: string;
  nfcVerifiedAt: string | null;
};

export function tenKingsV2ClosingRecovery(
  phase: string,
): { kind: "success" } | { kind: "discard"; phase: "failed" | "uncertain" } | null {
  if (phase === "closing_success") return { kind: "success" };
  if (phase === "closing_discard_failed") return { kind: "discard", phase: "failed" };
  if (phase === "closing_discard_uncertain") return { kind: "discard", phase: "uncertain" };
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
    (discard.phase === "failed" || discard.phase === "uncertain")
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
