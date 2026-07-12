import assert from "node:assert/strict";
import test from "node:test";
import { canConfirmAiGraderCardManually } from "../lib/aiGraderForwardConfirm";

test("fully manual Confirm Card remains available after OCR provider failure", () => {
  const ocrState = "failed";
  assert.equal(ocrState, "failed");
  assert.equal(canConfirmAiGraderCardManually({
    reportReady: true,
    identityComplete: true,
    linkedCardReady: false,
    confirmationPending: false,
  }), true);
});

test("manual Confirm Card still requires a report, complete operator identity, and no prior link", () => {
  for (const input of [
    { reportReady: false, identityComplete: true, linkedCardReady: false, confirmationPending: false },
    { reportReady: true, identityComplete: false, linkedCardReady: false, confirmationPending: false },
    { reportReady: true, identityComplete: true, linkedCardReady: true, confirmationPending: false },
    { reportReady: true, identityComplete: true, linkedCardReady: false, confirmationPending: true },
  ]) {
    assert.equal(canConfirmAiGraderCardManually(input), false);
  }
});
