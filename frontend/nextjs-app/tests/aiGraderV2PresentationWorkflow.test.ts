import assert from "node:assert/strict";
import test from "node:test";
import {
  completeSpeedsterPresentationImages,
  speedsterPresentationStorageKey,
} from "../lib/server/aiGraderV2PresentationWorkflow";

const sessionId = "presentation-session-123";
const createdByUserId = "admin-1";
const frontRectifiedStorageKey = `ai-grader-v2/${createdByUserId}/${sessionId}/prepared/front/rectified.webp`;
const backRectifiedStorageKey = `ai-grader-v2/${createdByUserId}/${sessionId}/prepared/back/rectified.webp`;
const frontInspectionStorageKey = `ai-grader-v2/${createdByUserId}/${sessionId}/prepared/front/inspection.webp`;
const backInspectionStorageKey = `ai-grader-v2/${createdByUserId}/${sessionId}/prepared/back/inspection.webp`;
const capture = {
  cornerShape: "ROUNDED",
  front: { rectifiedStorageKey: frontRectifiedStorageKey, inspectionStorageKey: frontInspectionStorageKey, evidence: "front-evidence" },
  back: { rectifiedStorageKey: backRectifiedStorageKey, inspectionStorageKey: backInspectionStorageKey, evidence: "back-evidence" },
};

test("presentation storage keys are stable and independent of the source-image stage", () => {
  assert.equal(
    speedsterPresentationStorageKey({ createdByUserId, sessionId, side: "FRONT" }),
    `ai-grader-v2/${createdByUserId}/${sessionId}/report/front-clean.png`,
  );
  assert.equal(
    speedsterPresentationStorageKey({ createdByUserId, sessionId, side: "BACK" }),
    `ai-grader-v2/${createdByUserId}/${sessionId}/report/back-clean.png`,
  );
});

test("post-grade workflow sends expanded inspection evidence to the isolated adapter and saves both report keys", async () => {
  let savedCapture: unknown;
  const result = await completeSpeedsterPresentationImages({ sessionId, createdByUserId }, {
    async findCompletedSession(id, userId) {
      assert.equal(id, sessionId);
      assert.equal(userId, createdByUserId);
      return { capture };
    },
    async createImages(input) {
      assert.deepEqual(input, {
        front: {
          sourceStorageKey: frontInspectionStorageKey,
          sourceContentType: "image/webp",
          outputStorageKey: `ai-grader-v2/${createdByUserId}/${sessionId}/report/front-clean.png`,
        },
        back: {
          sourceStorageKey: backInspectionStorageKey,
          sourceContentType: "image/webp",
          outputStorageKey: `ai-grader-v2/${createdByUserId}/${sessionId}/report/back-clean.png`,
        },
      });
      return {
        frontCleanStorageKey: input.front.outputStorageKey,
        backCleanStorageKey: input.back.outputStorageKey,
      };
    },
    async saveCapture(id, userId, value) {
      assert.equal(id, sessionId);
      assert.equal(userId, createdByUserId);
      savedCapture = value;
      return true;
    },
  });

  assert.equal(result.outcome, "CREATED");
  assert.deepEqual(savedCapture, {
    ...capture,
    front: {
      ...capture.front,
      reportStorageKey: `ai-grader-v2/${createdByUserId}/${sessionId}/report/front-clean.png`,
    },
    back: {
      ...capture.back,
      reportStorageKey: `ai-grader-v2/${createdByUserId}/${sessionId}/report/back-clean.png`,
    },
  });
});

test("an existing presentation is idempotent and consumes no additional PhotoRoom calls", async () => {
  let calls = 0;
  const frontCleanStorageKey = "report/front-clean.png";
  const backCleanStorageKey = "report/back-clean.png";
  const result = await completeSpeedsterPresentationImages({ sessionId, createdByUserId }, {
    async findCompletedSession() {
      return {
        capture: {
          ...capture,
          front: { ...capture.front, reportStorageKey: frontCleanStorageKey },
          back: { ...capture.back, reportStorageKey: backCleanStorageKey },
        },
      };
    },
    async createImages() {
      calls += 1;
      throw new Error("not used");
    },
    async saveCapture() {
      calls += 1;
      return true;
    },
  });

  assert.deepEqual(result, {
    outcome: "EXISTING",
    frontCleanStorageKey,
    backCleanStorageKey,
  });
  assert.equal(calls, 0);
});

test("a PhotoRoom failure leaves the completed capture unchanged for a clean retry", async () => {
  let saves = 0;
  await assert.rejects(
    completeSpeedsterPresentationImages({ sessionId, createdByUserId }, {
      async findCompletedSession() { return { capture }; },
      async createImages() { throw new Error("PhotoRoom unavailable"); },
      async saveCapture() { saves += 1; return true; },
    }),
    /PhotoRoom unavailable/,
  );
  assert.equal(saves, 0);
});

test("legacy completed captures still use rectified evidence when no inspection image exists", async () => {
  const legacyCapture = {
    front: { rectifiedStorageKey: frontRectifiedStorageKey },
    back: { rectifiedStorageKey: backRectifiedStorageKey },
  };
  await completeSpeedsterPresentationImages({ sessionId, createdByUserId }, {
    async findCompletedSession() { return { capture: legacyCapture }; },
    async createImages(input) {
      assert.equal(input.front.sourceStorageKey, frontRectifiedStorageKey);
      assert.equal(input.back.sourceStorageKey, backRectifiedStorageKey);
      return {
        frontCleanStorageKey: input.front.outputStorageKey,
        backCleanStorageKey: input.back.outputStorageKey,
      };
    },
    async saveCapture() { return true; },
  });
});
