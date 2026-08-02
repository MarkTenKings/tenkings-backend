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
const capture = {
  cornerShape: "ROUNDED",
  front: { rectifiedStorageKey: frontRectifiedStorageKey, evidence: "front-evidence" },
  back: { rectifiedStorageKey: backRectifiedStorageKey, evidence: "back-evidence" },
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

test("post-grade workflow sends rectified evidence to the isolated adapter and saves both report keys", async () => {
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
          sourceStorageKey: frontRectifiedStorageKey,
          sourceContentType: "image/webp",
          outputStorageKey: `ai-grader-v2/${createdByUserId}/${sessionId}/report/front-clean.png`,
        },
        back: {
          sourceStorageKey: backRectifiedStorageKey,
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
