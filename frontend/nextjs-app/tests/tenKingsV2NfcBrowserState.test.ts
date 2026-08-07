import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  claimTenKingsV2AutomaticTerminalAttempt,
  reconcileMissingTenKingsV2LocalOperation,
  tenKingsV2ClosingRecovery,
  tenKingsV2ExactKeySetMatches,
  tenKingsV2HelperSignerAllowed,
  tenKingsV2LocalOperationMatchesStored,
  tenKingsV2MayClearUnstartedExpiredProvisional,
  tenKingsV2NfcRecoveryDecision,
  tenKingsV2PermanentCompletionRejection,
  tenKingsV2ProvisionalRecoveryAction,
  type TenKingsV2StoredOperationFacts,
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

test("discard response loss clears from the exact bounded acknowledgement regardless of card-row state", () => {
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
  }, { id: "another-card", nfcVerifiedAt: null }), "discard_acknowledged");
  assert.equal(reconcileMissingTenKingsV2LocalOperation(base, {
    id: base.cardId,
    nfcVerifiedAt: null,
  }), "unresolved");
});

test("helper-404 recovery decision table never prepares a missing or VOID ordinary card", () => {
  type DecisionInput = Parameters<typeof tenKingsV2NfcRecoveryDecision>[1];
  const exactFact = { id: base.cardId, nfcVerifiedAt: null };
  const exactLocal = { cardId: base.cardId, jobEnvelopeSha256: HASH };
  const cases: Array<{
    name: string;
    stored?: TenKingsV2StoredOperationFacts;
    input: DecisionInput;
    expected: ReturnType<typeof tenKingsV2NfcRecoveryDecision>;
  }> = [
    {
      name: "exact helper operation is recovered without a card lookup",
      input: { localOperation: exactLocal, helperStatusErrorCode: null, cardFact: null, ordinaryCard: null },
      expected: "RECOVER_EXACT_LOCAL",
    },
    {
      name: "different helper operation fails closed",
      input: { localOperation: { ...exactLocal, jobEnvelopeSha256: "b".repeat(64) }, helperStatusErrorCode: null, cardFact: null, ordinaryCard: { id: base.cardId } },
      expected: "FAIL_CLOSED",
    },
    {
      name: "non-404 helper failure fails closed",
      input: { localOperation: null, helperStatusErrorCode: "v2_nfc_operation_failed", cardFact: exactFact, ordinaryCard: { id: base.cardId } },
      expected: "FAIL_CLOSED",
    },
    {
      name: "exact discard acknowledgement clears before any card fact",
      stored: {
        ...base,
        discardAcknowledgement: { jobEnvelopeSha256: HASH, acknowledgementNonce: NONCE, phase: "completed_unrecorded" },
      },
      input: { localOperation: null, helperStatusErrorCode: "v2_nfc_job_not_found", cardFact: null, ordinaryCard: null },
      expected: "CLEAR_DISCARD_ACK",
    },
    {
      name: "verification at issuance clears even when ordinary card is VOID",
      input: {
        localOperation: null,
        helperStatusErrorCode: "v2_nfc_job_not_found",
        cardFact: { id: base.cardId, nfcVerifiedAt: base.job.issuedAt },
        ordinaryCard: null,
      },
      expected: "CLEAR_VERIFIED",
    },
    {
      name: "later verification clears even when ordinary card is VOID",
      input: {
        localOperation: null,
        helperStatusErrorCode: "v2_nfc_job_not_found",
        cardFact: { id: base.cardId, nfcVerifiedAt: "2026-08-06T20:00:00.001Z" },
        ordinaryCard: null,
      },
      expected: "CLEAR_VERIFIED",
    },
    {
      name: "missing ordinary card and missing recovery fact fail closed",
      input: { localOperation: null, helperStatusErrorCode: "v2_nfc_job_not_found", cardFact: null, ordinaryCard: null },
      expected: "FAIL_CLOSED",
    },
    {
      name: "VOID ordinary card without verification fails closed",
      input: { localOperation: null, helperStatusErrorCode: "v2_nfc_job_not_found", cardFact: exactFact, ordinaryCard: null },
      expected: "FAIL_CLOSED",
    },
    {
      name: "ordinary card alone without exact recovery fact fails closed",
      input: { localOperation: null, helperStatusErrorCode: "v2_nfc_job_not_found", cardFact: null, ordinaryCard: { id: base.cardId } },
      expected: "FAIL_CLOSED",
    },
    {
      name: "mismatched recovery fact fails closed",
      input: {
        localOperation: null,
        helperStatusErrorCode: "v2_nfc_job_not_found",
        cardFact: { id: "another-card", nfcVerifiedAt: "2026-08-07T20:00:00.000Z" },
        ordinaryCard: { id: base.cardId },
      },
      expected: "FAIL_CLOSED",
    },
    {
      name: "ordinary non-VOID card plus exact recovery fact may prepare",
      input: { localOperation: null, helperStatusErrorCode: "v2_nfc_job_not_found", cardFact: exactFact, ordinaryCard: { id: base.cardId } },
      expected: "PREPARE_EXACT_JOB",
    },
    {
      name: "older verification does not clear but recordable exact card may prepare",
      input: {
        localOperation: null,
        helperStatusErrorCode: "v2_nfc_job_not_found",
        cardFact: { id: base.cardId, nfcVerifiedAt: "2026-08-06T19:59:59.999Z" },
        ordinaryCard: { id: base.cardId },
      },
      expected: "PREPARE_EXACT_JOB",
    },
    {
      name: "corrupt stored card binding fails closed before discard proof",
      stored: {
        ...base,
        job: { ...base.job, cardId: "another-card" },
        discardAcknowledgement: { jobEnvelopeSha256: HASH, acknowledgementNonce: NONCE, phase: "failed" },
      },
      input: { localOperation: null, helperStatusErrorCode: "v2_nfc_job_not_found", cardFact: exactFact, ordinaryCard: { id: base.cardId } },
      expected: "FAIL_CLOSED",
    },
  ];

  for (const row of cases) {
    assert.equal(tenKingsV2NfcRecoveryDecision(row.stored ?? base, row.input), row.expected, row.name);
  }
});

test("recovery card fact is authenticated, exact-ID, minimal, and does not weaken ordinary VOID filtering", () => {
  const hostedSource = readFileSync(new URL("../lib/server/tenKingsV2NfcHosted.ts", import.meta.url), "utf8");
  const routeSource = readFileSync(new URL("../pages/api/v2/admin/nfc/[...action].ts", import.meta.url), "utf8");
  const recoveryStart = hostedSource.indexOf("export async function getTenKingsV2NfcRecoveryCardFact");
  const recoveryEnd = hostedSource.indexOf("export async function issueTenKingsV2NfcCardJob", recoveryStart);
  const recoveryFunction = hostedSource.slice(recoveryStart, recoveryEnd);
  const ordinaryStart = hostedSource.indexOf("export async function getTenKingsV2NfcCard");
  const ordinaryFunction = hostedSource.slice(ordinaryStart, recoveryStart);

  assert.ok(recoveryStart >= 0 && recoveryEnd > recoveryStart, "narrow recovery fact function must exist");
  assert.match(recoveryFunction, /findUnique\(\{/);
  assert.match(recoveryFunction, /where: \{ id: cardId \}/);
  assert.match(recoveryFunction, /select: \{ id: true, nfcVerifiedAt: true \}/);
  assert.doesNotMatch(recoveryFunction, /lifecycleState|publicToken|humanGradeLabel/);
  assert.match(ordinaryFunction, /lifecycleState: \{ not: "VOID" \}/);

  const adminCheck = routeSource.indexOf("requireAdminSession(req)");
  const recoveryAction = routeSource.indexOf('action === "recovery-card-fact"');
  assert.ok(adminCheck >= 0 && recoveryAction > adminCheck, "admin authentication must precede recovery fact access");
  assert.match(routeSource, /const recoveryCardFactSchema = z\.object\(\{ cardId \}\)\.strict\(\);/);
  assert.match(routeSource, /req\.method === "POST" && action === "recovery-card-fact"/);
  assert.match(routeSource, /getTenKingsV2NfcRecoveryCardFact\(parsed\.data\.cardId\)/);
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
  assert.equal(tenKingsV2PermanentCompletionRejection(409, "TEN_KINGS_V2_NFC_JOB_KEY_UNTRUSTED"), true);
  assert.equal(tenKingsV2PermanentCompletionRejection(409, "TEN_KINGS_V2_NFC_WORKSTATION_UNTRUSTED"), true);
  assert.equal(tenKingsV2PermanentCompletionRejection(409, "TEN_KINGS_V2_NFC_SIGNATURE_INVALID"), true);
  assert.equal(tenKingsV2PermanentCompletionRejection(409, "TEN_KINGS_V2_NFC_RESULT_TIME_REJECTED"), false);
  assert.equal(tenKingsV2PermanentCompletionRejection(503, "TEN_KINGS_V2_NFC_RESULT_JOB_MISMATCH"), false);
});

test("expired provisional cleanup requires exact authoritative absence and proves no operation ever started", () => {
  const expired: TenKingsV2StoredOperationFacts & { helperPrepared: boolean } = {
    ...base,
    helperPrepared: false,
    automaticTerminalAttempts: [],
    job: {
      ...base.job,
      expiresAt: "2026-08-06T20:05:00.000Z",
    },
  };
  const mayClear = (overrides: Partial<typeof expired> = {}, input: {
    helperErrorCode?: string | null;
    localOperation?: { cardId: string; jobEnvelopeSha256: string } | null;
    now?: Date;
  } = {}) => tenKingsV2MayClearUnstartedExpiredProvisional({ ...expired, ...overrides }, {
    helperStatusErrorCode: input.helperErrorCode === undefined ? "v2_nfc_job_not_found" : input.helperErrorCode,
    helperPrepareErrorCode: "v2_nfc_job_expired",
    localOperation: input.localOperation === undefined ? null : input.localOperation,
    now: input.now ?? new Date("2026-08-06T20:05:00.001Z"),
  });

  assert.equal(mayClear(), true);
  assert.equal(mayClear({}, { helperErrorCode: "v2_nfc_operation_failed" }), false);
  assert.equal(tenKingsV2MayClearUnstartedExpiredProvisional(expired, {
    helperStatusErrorCode: "v2_nfc_job_not_found",
    helperPrepareErrorCode: "v2_nfc_job_signature_invalid",
    localOperation: null,
    now: new Date("2026-08-06T20:05:00.001Z"),
  }), false);
  assert.equal(mayClear({ helperPrepared: true }), false);
  assert.equal(mayClear({ automaticTerminalAttempts: undefined }), false);
  assert.equal(mayClear({ automaticTerminalAttempts: [`${HASH}:completed`] }), false);
  assert.equal(mayClear({
    discardAcknowledgement: {
      jobEnvelopeSha256: HASH,
      acknowledgementNonce: NONCE,
      phase: "failed",
    },
  }), false);
  assert.equal(mayClear({}, { localOperation: { cardId: base.cardId, jobEnvelopeSha256: HASH } }), false);
  assert.equal(mayClear({}, { now: new Date("2026-08-06T20:05:00.000Z") }), false);
  assert.equal(mayClear({ job: { ...expired.job, expiresAt: "2026-08-06T20:05:00Z" } }), false);
  assert.equal(mayClear({ job: { ...expired.job, expiresAt: "not-a-time" } }), false);
  assert.equal(mayClear({ job: { ...expired.job, cardId: "another-card" } }), false);
});

test("admin recovery structurally reaches the helper before card lookup and exposes recovery without a card", () => {
  const source = readFileSync(new URL("../pages/admin/nfc.tsx", import.meta.url), "utf8");
  const storedBranch = source.indexOf("if (stored) {");
  const helperRecovery = source.indexOf("getTenKingsV2NfcOperationStatus(stored.jobEnvelopeSha256)", storedBranch);
  const recoveryCardLookup = source.indexOf("loadRecoveryCard(stored.cardId)", helperRecovery);
  assert.ok(storedBranch >= 0, "stored recovery branch must exist");
  assert.ok(helperRecovery > storedBranch, "stored recovery must query the exact helper operation");
  assert.ok(recoveryCardLookup > helperRecovery, "stored recovery must query helper state before the non-VOID card endpoint");
  assert.match(source, /const recoveryWorkspace = Boolean\(card \|\| operation \|\| provisionalPending\);/);
  assert.match(source, /\{!recoveryWorkspace \? \(/);
  assert.match(source, /recoveryCardUnavailable/);
  assert.match(source, /helperStatusErrorCode: error\.code/);
  assert.match(source, /helperPrepareErrorCode: prepareError\.code/);
  assert.match(source, /recoveryCardUnavailable && provisionalPending/);
  assert.match(source, /Do not take out, place, write, or lock a tag\./);
  assert.match(source, /Recheck exact saved recovery/);
  assert.match(source, /no helper preparation occurred during the recheck/);
});
