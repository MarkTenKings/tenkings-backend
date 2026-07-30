const assert = require("node:assert/strict");
const test = require("node:test");

const {
  AI_GRADER_GEOMETRY_CORNERS,
  AI_GRADER_GEOMETRY_EDGES,
  AI_GRADER_OWNER_HUMAN_GEOMETRY_MEASUREMENT_UNCERTAINTY_AUTHORITY_V1,
} = require("../../shared/dist");
const {
  assertFixedRigHumanGeometryReceiptIdentityV1,
  lockFixedRigHumanGeometryReceiptV1,
  prepareFixedRigHumanGeometryReviewV1,
  reopenFixedRigHumanGeometryReviewV1,
} = require("../dist/drivers/fixedRigHumanGeometryAssistV1");

const SHA = {
  frontRaw: "1".repeat(64),
  frontNormalized: "2".repeat(64),
  backRaw: "3".repeat(64),
  backNormalized: "4".repeat(64),
};

function warm(side) {
  const front = side === "front";
  const contour = Array.from({ length: 32 }, (_, index) => {
    const phase = index / 32;
    if (phase < 0.25) return { x: 20 + phase * 4 * 1160, y: 20 };
    if (phase < 0.5) return { x: 1180, y: 20 + (phase - 0.25) * 4 * 1640 };
    if (phase < 0.75) return { x: 1180 - (phase - 0.5) * 4 * 1160, y: 1660 };
    return { x: 20, y: 1660 - (phase - 0.75) * 4 * 1640 };
  });
  return {
    evidenceSide: side,
    status: "completed",
    side: {
      normalizedCard: {
        normalizedArtifact: {
          imageWidth: 1200,
          imageHeight: 1680,
          sha256: front ? SHA.frontNormalized : SHA.backNormalized,
          normalizedDenseContour: { points: contour },
        },
      },
      fullResolutionGeometryAuthority: {
        source: {
          sourceSha256: front ? SHA.frontRaw : SHA.backRaw,
        },
      },
      acceptedProfile: {
        capture: { sha256: front ? SHA.frontRaw : SHA.backRaw },
        analysisArtifact: { sha256: front ? SHA.frontNormalized : SHA.backNormalized },
      },
    },
  };
}

function confirm(side) {
  const next = structuredClone(side);
  for (const edge of AI_GRADER_GEOMETRY_EDGES) next.printedBorders[edge].reviewed = true;
  for (const corner of AI_GRADER_GEOMETRY_CORNERS) next.physicalCorners[corner].reviewed = true;
  next.edgeRegionsReviewed = true;
  next.surfaceRegionReviewed = true;
  next.confirmed = true;
  return next;
}

test("capture produces geometry-review-required and no grading result", () => {
  const review = prepareFixedRigHumanGeometryReviewV1({
    frontWarmManifest: warm("front"),
    backWarmManifest: warm("back"),
  });
  assert.equal(review.state, "geometry_review_required");
  assert.equal(review.lockedReceipt, undefined);
  assert.equal(review.draft.sides.front.printedBorders.top.candidates.length, 3);
  assert.equal(review.draft.sides.back.printedBorders.left.candidates.length, 3);
});

test("automatic contour suggestion failure exposes manual tools immediately", () => {
  const front = warm("front");
  delete front.side.normalizedCard.normalizedArtifact.normalizedDenseContour;
  const review = prepareFixedRigHumanGeometryReviewV1({
    frontWarmManifest: front,
    backWarmManifest: warm("back"),
  });
  assert.equal(review.state, "geometry_review_required");
  assert.equal(review.draft.suggestionStatus, "manual_ready");
  assert.equal(review.draft.sides.front.printedBorders.top.candidates.length, 3);
});

test("confirmed receipt is immutable, identity-bound, and reopening versions it", () => {
  const review = prepareFixedRigHumanGeometryReviewV1({
    frontWarmManifest: warm("front"),
    backWarmManifest: warm("back"),
  });
  const receipt = lockFixedRigHumanGeometryReceiptV1({
    review,
    sides: {
      front: confirm(review.draft.sides.front),
      back: confirm(review.draft.sides.back),
    },
    queueItemId: "queue-1",
    stationSessionId: "session-1",
    gradingSessionId: "session-1",
    reportId: "report-1",
    operatorUserId: "operator-1",
    confirmedAt: "2026-07-29T13:00:00.000Z",
  });
  assert.equal(receipt.receiptVersion, 1);
  assert.equal(receipt.sides.front.physicalCorners.top_left.toolType, "rounded_3_18_mm");
  assert.deepEqual(
    receipt.measurementUncertaintyAuthority,
    AI_GRADER_OWNER_HUMAN_GEOMETRY_MEASUREMENT_UNCERTAINTY_AUTHORITY_V1,
  );
  assert.doesNotThrow(() => assertFixedRigHumanGeometryReceiptIdentityV1({
    receipt,
    queueItemId: "queue-1",
    stationSessionId: "session-1",
    gradingSessionId: "session-1",
    reportId: "report-1",
    captureAuthority: review.captureAuthority,
  }));
  assert.throws(() => assertFixedRigHumanGeometryReceiptIdentityV1({
    receipt,
    queueItemId: "queue-other",
    stationSessionId: "session-1",
    gradingSessionId: "session-1",
    reportId: "report-1",
    captureAuthority: review.captureAuthority,
  }), /identity mismatch/);
  const reopened = reopenFixedRigHumanGeometryReviewV1({
    ...review,
    state: "locked",
    lockedReceipt: receipt,
  });
  assert.equal(reopened.receiptVersion, 2);
  assert.equal(reopened.supersedesReceiptSha256, receipt.receiptSha256);
  assert.equal(reopened.draft.sides.front.confirmed, false);
});

test("geometry lock requires the exact owner policy and never loads a calibration profile", () => {
  const review = prepareFixedRigHumanGeometryReviewV1({
    frontWarmManifest: warm("front"),
    backWarmManifest: warm("back"),
  });
  assert.doesNotThrow(() => lockFixedRigHumanGeometryReceiptV1({
    review,
    sides: { front: confirm(review.draft.sides.front), back: confirm(review.draft.sides.back) },
    queueItemId: "queue-1",
    stationSessionId: "session-1",
    gradingSessionId: "session-1",
    reportId: "report-1",
    operatorUserId: "operator-1",
    confirmedAt: "2026-07-29T13:00:00.000Z",
  }));
  const wrongPolicyReview = prepareFixedRigHumanGeometryReviewV1({
    frontWarmManifest: warm("front"),
    backWarmManifest: warm("back"),
  });
  assert.throws(() => lockFixedRigHumanGeometryReceiptV1({
    review: wrongPolicyReview,
    sides: {
      front: confirm(wrongPolicyReview.draft.sides.front),
      back: confirm(wrongPolicyReview.draft.sides.back),
    },
    queueItemId: "queue-2",
    stationSessionId: "session-2",
    gradingSessionId: "session-2",
    reportId: "report-2",
    operatorUserId: "operator-1",
    confirmedAt: "2026-07-29T13:00:00.000Z",
    measurementUncertaintyAuthority: {
      ...AI_GRADER_OWNER_HUMAN_GEOMETRY_MEASUREMENT_UNCERTAINTY_AUTHORITY_V1,
      repeatedPlacementU95Mm: 4.306362,
    },
  }), /Invalid input/);
});
