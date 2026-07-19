import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("the obsolete manual Confirm Card fallback is absent from the one-road production station", () => {
  assert.equal(existsSync(new URL("../lib/aiGraderForwardConfirm.ts", import.meta.url)), false);
  const station = readFileSync(new URL("../pages/ai-grader/station.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(station, /canConfirmAiGraderCardManually|fully manual Confirm Card|OCR provider failure.*Confirm Card/i);
  assert.match(station, /Approve & Publish/);
});
