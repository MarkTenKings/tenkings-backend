import assert from "node:assert/strict";
import test from "node:test";
import {
  reconcileMissingTenKingsV2LocalOperation,
  tenKingsV2ClosingRecovery,
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
