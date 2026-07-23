import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { claimAiGraderCalibrationAdminPrompt } from "../lib/aiGraderCalibrationAuthPrompt";

test("calibration claims its automatic admin prompt only once across provider rerenders", () => {
  const claim = { current: false };
  assert.equal(claimAiGraderCalibrationAdminPrompt(claim), true);
  assert.equal(claim.current, true);
  assert.equal(claimAiGraderCalibrationAdminPrompt(claim), false);
  assert.equal(claimAiGraderCalibrationAdminPrompt(claim), false);
});

test("a completed session can rearm the automatic admin prompt for a later sign-out", () => {
  const claim = { current: true };
  claim.current = false;
  assert.equal(claimAiGraderCalibrationAdminPrompt(claim), true);
});

test("forced activation reauthentication blocks a competing automatic admin prompt", () => {
  const claim = { current: false };

  assert.equal(claimAiGraderCalibrationAdminPrompt(claim, true), false);
  assert.equal(claim.current, false);
  assert.equal(claimAiGraderCalibrationAdminPrompt(claim, true), false);

  assert.equal(claimAiGraderCalibrationAdminPrompt(claim, false), true);
  assert.equal(claim.current, true);
});

test("the calibration page binds activation busy state to the automatic prompt claim", () => {
  const source = readFileSync(new URL("../pages/ai-grader/calibration.tsx", import.meta.url), "utf8");
  assert.match(
    source,
    /claimAiGraderCalibrationAdminPrompt\(automaticAdminPromptClaimRef,\s*registryBusy\)/,
  );
});

test("automatic prompting still rearms after a later sign-out", () => {
  const claim = { current: false };
  assert.equal(claimAiGraderCalibrationAdminPrompt(claim), true);

  claim.current = false;
  assert.equal(claimAiGraderCalibrationAdminPrompt(claim), true);
});

test("the phone control exposes a usable telephone input contract", () => {
  const source = readFileSync(new URL("../components/AuthModal.tsx", import.meta.url), "utf8");
  assert.match(source, /type="tel"/);
  assert.match(source, /name="phone"/);
  assert.match(source, /inputMode="tel"/);
  assert.match(source, /autoComplete="tel"/);
  assert.match(source, /disabled=\{loading \|\| step === "code"\}/);
});
