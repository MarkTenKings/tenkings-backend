import assert from "node:assert/strict";
import test from "node:test";
import {
  claimTenKingsV2AutomaticTerminalAttempt,
  reconcileMissingTenKingsV2LocalOperation,
  tenKingsV2ClosingRecovery,
  tenKingsV2ExactKeySetMatches,
  tenKingsV2HelperSignerAllowed,
  tenKingsV2LocalOperationMatchesStored,
  tenKingsV2PermanentCompletionRejection,
  tenKingsV2ProvisionalRecoveryAction,
} from "../lib/tenKingsV2NfcBrowserState";

const HASH = "a".repeat(64);
const NONCE = "A".repeat(32);
const base = {
  cardId: "card-v2.001",
  jobEnvelopeSha256: HASH,
  job: { cardId: "card-v2.001", issuedAt: "2026-08-06T20:00:00.000Z" },
};

test("all recovered closing phases select only their matching idempotent acknowledgement", () => {
  assert.deepEqual(tenKingsV2ClosingRecovery("closing_success"), { kind: "success" });
  assert.deepEqual(tenKingsV2ClosingRecovery("closing_discard_failed"), { kind: "discard", phase: "failed" });
  assert.deepEqual(tenKingsV2ClosingRecovery("closing_discard_uncertain"), { kind: "discard", phase: "uncertain" });
  assert.deepEqual(tenKingsV2ClosingRecovery("closing_discard_completed_unrecorded"), { kind: "discard", phase: "completed_unrecorded" });
  assert.equal(tenKingsV2ClosingRecovery("completed"), null);
  assert.equal(tenKingsV2ClosingRecovery("uncertain"), null);
});

test("missing helper state clears only from a verification at or after signed job issuance", () => {
  assert.equal(reconcileMissingTenKingsV2LocalOperation(base, {
    id: base.cardId,
    nfcVerifiedAt: "2026-08-06T20:00:00.000Z",
  }), "verified");
  assert.equal(reconcileMissingTenKingsV2LocalOperation(base, {
    id: base.cardId,
    nfcVerifiedAt: "2026-08-06T19:59:59.999Z",
  }), "unresolved");
  assert.equal(reconcileMissingTenKingsV2LocalOperation(base, {
    id: "another-card",
    nfcVerifiedAt: "2026-08-07T20:00:00.000Z",
  }), "unresolved");
});

test("discard response loss clears only after the exact bounded human acknowledgement fact", () => {
  assert.equal(reconcileMissingTenKingsV2LocalOperation({
    ...base,
    discardAcknowledgement: {
      jobEnvelopeSha256: HASH,
      acknowledgementNonce: NONCE,
      phase: "uncertain",
    },
  }, { id: base.cardId, nfcVerifiedAt: null }), "discard_acknowledged");
  assert.equal(reconcileMissingTenKingsV2LocalOperation({
    ...base,
    discardAcknowledgement: {
      jobEnvelopeSha256: "b".repeat(64),
      acknowledgementNonce: NONCE,
      phase: "uncertain",
    },
  }, { id: base.cardId, nfcVerifiedAt: null }), "unresolved");
  assert.equal(reconcileMissingTenKingsV2LocalOperation({
    ...base,
    discardAcknowledgement: {
      jobEnvelopeSha256: HASH,
      acknowledgementNonce: NONCE,
      phase: "failed",
    },
  }, { id: "another-card", nfcVerifiedAt: null }), "unresolved");
  assert.equal(reconcileMissingTenKingsV2LocalOperation(base, {
    id: base.cardId,
    nfcVerifiedAt: null,
  }), "unresolved");
});

test("provisional recovery binds exact card and digest and helper readiness rejects signer mismatch", () => {
  assert.equal(tenKingsV2LocalOperationMatchesStored(base, { cardId: base.cardId, jobEnvelopeSha256: HASH }), true);
  assert.equal(tenKingsV2LocalOperationMatchesStored(base, { cardId: "other-card", jobEnvelopeSha256: HASH }), false);
  assert.equal(tenKingsV2LocalOperationMatchesStored(base, { cardId: base.cardId, jobEnvelopeSha256: "b".repeat(64) }), false);
  assert.equal(tenKingsV2ExactKeySetMatches(["prior", "current"], ["current", "prior"]), true);
  assert.equal(tenKingsV2ExactKeySetMatches(["current", "extra"], ["current"]), false);
  assert.equal(tenKingsV2HelperSignerAllowed("dell-key", ["dell-key"]), true);
  assert.equal(tenKingsV2HelperSignerAllowed("other-key", ["dell-key"]), false);
});

test("lost prepare responses resume only the exact issued pointer before or after helper persistence", () => {
  assert.equal(tenKingsV2ProvisionalRecoveryAction(base, null), "PREPARE_EXACT_ISSUED_JOB");
  assert.equal(tenKingsV2ProvisionalRecoveryAction(base, {
    cardId: base.cardId,
    jobEnvelopeSha256: HASH,
  }), "ACCEPT_EXACT_HELPER_STATE");
  assert.equal(tenKingsV2ProvisionalRecoveryAction(base, {
    cardId: base.cardId,
    jobEnvelopeSha256: "b".repeat(64),
  }), "BLOCK_MISMATCH");
  assert.equal(tenKingsV2ProvisionalRecoveryAction({
    ...base,
    job: { ...base.job, cardId: "other-card" },
  }, null), "BLOCK_MISMATCH");
});

test("each exact terminal digest and phase receives at most one automatic attempt", () => {
  const first = claimTenKingsV2AutomaticTerminalAttempt(base, "completed");
  assert.equal(first.claimed, true);
  const replay = claimTenKingsV2AutomaticTerminalAttempt({
    ...base,
    automaticTerminalAttempts: first.attempts,
  }, "completed");
  assert.equal(replay.claimed, false);
  assert.equal(claimTenKingsV2AutomaticTerminalAttempt({
    ...base,
    automaticTerminalAttempts: first.attempts,
  }, "closing_success").claimed, true);
});

test("only permanent signed-evidence or card-binding rejection exposes completed-tag discard", () => {
  assert.equal(tenKingsV2PermanentCompletionRejection(409, "TEN_KINGS_V2_NFC_RESULT_JOB_MISMATCH"), true);
  assert.equal(tenKingsV2PermanentCompletionRejection(409, "TEN_KINGS_V2_NFC_CARD_NO_LONGER_RECORDABLE"), true);
  assert.equal(tenKingsV2PermanentCompletionRejection(409, "TEN_KINGS_V2_NFC_RESULT_TIME_REJECTED"), false);
  assert.equal(tenKingsV2PermanentCompletionRejection(409, "TEN_KINGS_V2_NFC_WORKSTATION_UNTRUSTED"), false);
  assert.equal(tenKingsV2PermanentCompletionRejection(503, "TEN_KINGS_V2_NFC_RESULT_JOB_MISMATCH"), false);
});
