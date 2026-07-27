const assert = require("node:assert/strict");
const test = require("node:test");

const {
  FIXED_RIG_OPERATOR_RESOLUTION_SUBMISSION_V1_VERSION,
  buildFixedRigOperatorResolutionAuthorityV1,
  buildFixedRigOperatorResolutionRequestV1,
  hashFixedRigOperatorResolutionValueV1,
  latestFixedRigOperatorElementResolutionV1,
  parseFixedRigOperatorResolutionSubmissionV1,
  verifyFixedRigOperatorResolutionAuthorityV1,
} = require("../dist/drivers/fixedRigOperatorResolutionAuthorityV1");
const {
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
} = require("@tenkings/shared");

const sha = (value) => hashFixedRigOperatorResolutionValueV1(value);

function binding() {
  const side = (name) => {
    const nativeRoles = Array.from({ length: 35 }, (_, index) => ({
      captureRole: `${name}-role-${String(index + 1).padStart(2, "0")}`,
      sha256: sha(`${name}-role-${index + 1}`),
    }));
    return {
      rawAllOnAssetId: `${name}-raw-all-on`,
      rawAllOnSha256: sha(`${name}-raw-all-on`),
      normalizedAllOnAssetId: `${name}-normalized-all-on`,
      normalizedAllOnSha256: sha(`${name}-normalized-all-on`),
      rawToNormalizedTransformSha256: sha(`${name}-transform`),
      authenticatedOuterCutArtifactSha256: sha(`${name}-outer-cut`),
      warmManifestSha256: sha(`${name}-warm-manifest`),
      nativeRoles,
      nativeRoleLedgerSha256: sha(nativeRoles),
    };
  };
  return {
    queueItemId: "queue-1",
    gradingSessionId: "session-1",
    reportId: "report-1",
    cardIdentitySha256: sha("card"),
    calibrationProfileId: "profile-1",
    calibrationVersion: "1.0.0",
    calibrationArtifactSha256: sha("calibration"),
    calibrationBundleManifestSha256: sha("bundle"),
    thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
    thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    sides: { front: side("front"), back: side("back") },
  };
}

function request() {
  const originals = Object.fromEntries(
    ["centering", "corners", "edges", "surface"].map((element) => [
      element,
      {
        status: element === "centering" ? "insufficient_evidence" : "computed",
        score: element === "centering" ? null : 9.25,
        explanation: element === "centering" ? null : `${element} automatic explanation`,
        failureReasons: element === "centering" ? ["printed border was not resolved"] : [],
        resultSha256: sha(`original-${element}`),
      },
    ]),
  );
  return buildFixedRigOperatorResolutionRequestV1({
    generatedAt: "2026-07-24T22:00:00.000Z",
    binding: binding(),
    originalElements: originals,
  });
}

function submission(requestSha256) {
  return {
    schemaVersion: FIXED_RIG_OPERATOR_RESOLUTION_SUBMISSION_V1_VERSION,
    requestSha256,
    operatorConfirmed: true,
    resolutions: [
      {
        element: "centering",
        publicExplanation: "The printed borders are evenly balanced on both sides.",
        internalReason: "Original automated border fit was insufficient; bound measurements were supplied.",
        measurements: {
          unit: "mm",
          order: ["left", "right", "top", "bottom"],
          front: [2.1, 2.2, 2.4, 2.3],
          back: [2.3, 2.2, 2.1, 2.4],
        },
      },
      {
        element: "corners",
        score: 9.4,
        publicExplanation: "Corners show slight wear at the upper left.",
        internalReason: "Owner reconciled the exact corner evidence.",
      },
      {
        element: "edges",
        score: 9.15,
        publicExplanation: "Edges show light wear along the lower border.",
        internalReason: "Owner reconciled the exact edge evidence.",
      },
      {
        element: "surface",
        score: 8.75,
        publicExplanation: "Surface shows a visible scuff near the center.",
        internalReason: "Owner reconciled the exact surface evidence.",
      },
    ],
  };
}

function measurementSegments(front, back) {
  const build = (values) => [
    {
      margin: "left",
      start: { x: 0, y: 460 },
      end: { x: values[0] * 1200 / 63.5, y: 460 },
    },
    {
      margin: "right",
      start: { x: 1200, y: 760 },
      end: { x: 1200 - values[1] * 1200 / 63.5, y: 760 },
    },
    {
      margin: "top",
      start: { x: 340, y: 0 },
      end: { x: 340, y: values[2] * 1680 / 88.9 },
    },
    {
      margin: "bottom",
      start: { x: 880, y: 1680 },
      end: { x: 880, y: 1680 - values[3] * 1680 / 88.9 },
    },
  ];
  return {
    coordinateFrame: "normalized_card_portrait_pixels",
    widthPx: 1200,
    heightPx: 1680,
    order: ["left", "right", "top", "bottom"],
    front: build(front),
    back: build(back),
  };
}

test("strict submission accepts all four legal element forms and preserves owner text", () => {
  const pending = request();
  const candidate = submission(pending.requestSha256);
  candidate.resolutions[1].score = 8.03;
  candidate.resolutions[2].score = 1.11;
  const parsed = parseFixedRigOperatorResolutionSubmissionV1(
    candidate,
    { width: 63.5, height: 88.9 },
  );
  assert.equal(parsed.resolutions.length, 4);
  assert.equal(parsed.resolutions[1].score, 8.03);
  assert.equal(parsed.resolutions[2].score, 1.11);
  assert.equal(
    parsed.resolutions[2].publicExplanation,
    "Edges show light wear along the lower border.",
  );
  assert.deepEqual(parsed.resolutions[0].measurements.front, [2.1, 2.2, 2.4, 2.3]);
});

test("public explanations reject every prohibited term before authority construction", () => {
  const pending = request();
  for (const word of [
    "provisional",
    "INSUFFICIENT",
    "Human",
    "manually",
    "exceptional",
    "admission",
  ]) {
    const candidate = submission(pending.requestSha256);
    candidate.resolutions[1].publicExplanation = `Benign text followed by ${word}.`;
    assert.throws(
      () => parseFixedRigOperatorResolutionSubmissionV1(
        candidate,
        { width: 63.5, height: 88.9 },
      ),
      /prohibited workflow or disclosure term/,
      word,
    );
  }
});

test("strict schema rejects score and policy mutation fields plus malformed values", () => {
  const pending = request();
  const dimensions = { width: 63.5, height: 88.9 };
  for (const forbiddenField of [
    "overall",
    "labelGrade",
    "penalty",
    "finding",
    "cap",
    "threshold",
    "calibration",
    "transform",
    "evidence",
  ]) {
    const candidate = submission(pending.requestSha256);
    candidate.resolutions[1][forbiddenField] = 7;
    assert.throws(
      () => parseFixedRigOperatorResolutionSubmissionV1(candidate, dimensions),
      /must contain exactly/,
      forbiddenField,
    );
  }
  for (const value of ["9.25", Number.NaN, 0.99, 10.01, 9.123]) {
    const candidate = submission(pending.requestSha256);
    candidate.resolutions[1].score = value;
    assert.throws(
      () => parseFixedRigOperatorResolutionSubmissionV1(candidate, dimensions),
      /finite numeric score/,
    );
  }
});

test("every computed original requires a numeric score", () => {
  const pending = request();
  const originalElements = structuredClone(pending.originalElements);
  originalElements.surface.score = null;
  assert.throws(
    () => buildFixedRigOperatorResolutionRequestV1({
      generatedAt: pending.generatedAt,
      binding: pending.binding,
      originalElements,
    }),
    /surface computed original score/i,
  );
});

test("centering rejects wrong unit, order, count, negatives, impossible sums, and score fields", () => {
  const pending = request();
  const dimensions = { width: 63.5, height: 88.9 };
  const mutate = [
    (candidate) => { candidate.resolutions[0].measurements.unit = "px"; },
    (candidate) => { candidate.resolutions[0].measurements.order = ["right", "left", "top", "bottom"]; },
    (candidate) => { candidate.resolutions[0].measurements.front = [1, 2, 3]; },
    (candidate) => { candidate.resolutions[0].measurements.front[0] = -1; },
    (candidate) => { candidate.resolutions[0].measurements.front = [32, 32, 1, 1]; },
    (candidate) => { candidate.resolutions[0].score = 9; },
  ];
  for (const change of mutate) {
    const candidate = submission(pending.requestSha256);
    change(candidate);
    assert.throws(
      () => parseFixedRigOperatorResolutionSubmissionV1(candidate, dimensions),
    );
  }
});

test("centering preserves complete canonical ruler segments without making them scoring authority", () => {
  const pending = request();
  const candidate = submission(pending.requestSha256);
  const centering = candidate.resolutions[0].measurements;
  centering.segments = measurementSegments(centering.front, centering.back);
  const parsed = parseFixedRigOperatorResolutionSubmissionV1(
    candidate,
    { width: 63.5, height: 88.9 },
  );
  assert.deepEqual(parsed.resolutions[0].measurements.segments, centering.segments);
  assert.deepEqual(parsed.resolutions[0].measurements.front, [2.1, 2.2, 2.4, 2.3]);
});

test("centering ruler segments reject nonperpendicular or millimeter-mismatched overlays", () => {
  const pending = request();
  const dimensions = { width: 63.5, height: 88.9 };
  const nonperpendicular = submission(pending.requestSha256);
  const firstMeasurements = nonperpendicular.resolutions[0].measurements;
  firstMeasurements.segments = measurementSegments(
    firstMeasurements.front,
    firstMeasurements.back,
  );
  firstMeasurements.segments.front[0].end.y += 1;
  assert.throws(
    () => parseFixedRigOperatorResolutionSubmissionV1(
      nonperpendicular,
      dimensions,
    ),
    /perpendicular/,
  );

  const mismatched = submission(pending.requestSha256);
  const secondMeasurements = mismatched.resolutions[0].measurements;
  secondMeasurements.segments = measurementSegments(
    secondMeasurements.front,
    secondMeasurements.back,
  );
  secondMeasurements.segments.back[3].end.y -= 40;
  assert.throws(
    () => parseFixedRigOperatorResolutionSubmissionV1(mismatched, dimensions),
    /does not reproduce/,
  );
});

test("authority is canonical, bound, chained, and keeps private rationale separate", () => {
  const pending = request();
  const parsed = parseFixedRigOperatorResolutionSubmissionV1(
    submission(pending.requestSha256),
    { width: 63.5, height: 88.9 },
  );
  const first = buildFixedRigOperatorResolutionAuthorityV1({
    request: pending,
    submission: parsed,
    operatorId: "owner-1",
    authenticatedAt: "2026-07-24T22:01:00.000Z",
  });
  assert.equal(verifyFixedRigOperatorResolutionAuthorityV1(first), true);
  assert.equal(first.binding.queueItemId, "queue-1");
  assert.equal(first.resolutions[0].original.resultSha256, sha("original-centering"));
  assert.match(first.resolutions[0].internalReason, /insufficient/i);

  const revisionSubmission = parseFixedRigOperatorResolutionSubmissionV1({
    schemaVersion: FIXED_RIG_OPERATOR_RESOLUTION_SUBMISSION_V1_VERSION,
    requestSha256: pending.requestSha256,
    operatorConfirmed: true,
    resolutions: [{
      element: "surface",
      score: 8.5,
      publicExplanation: "Surface shows moderate scuffing near the center.",
      internalReason: "Superseding owner review of exact surface evidence.",
    }],
  }, { width: 63.5, height: 88.9 });
  const second = buildFixedRigOperatorResolutionAuthorityV1({
    request: pending,
    submission: revisionSubmission,
    operatorId: "owner-1",
    authenticatedAt: "2026-07-24T22:02:00.000Z",
    priorAuthority: first,
  });
  assert.equal(second.revision, 2);
  assert.equal(second.supersedesAuthoritySha256, first.authoritySha256);
  assert.equal(
    latestFixedRigOperatorElementResolutionV1([first, second], "surface").score,
    8.5,
  );
  assert.throws(
    () => latestFixedRigOperatorElementResolutionV1([second], "surface"),
    /stale, conflicting, or malformed/,
  );
});
