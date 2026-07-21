const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const test = require("node:test");

const {
  mathematicalDesignReferenceV1Schema,
} = require("../../shared/dist");
const {
  FIXED_RIG_DESIGN_REFERENCE_PROJECTION_V1_VERSION,
  FIXED_RIG_DESIGN_REFERENCE_REGISTRATION_V1_VERSION,
  projectApprovedFixedRigDesignReferenceV1,
  verifyFixedRigDesignReferenceRegistrationBindingV1,
} = require("../dist/drivers/fixedRigDesignReferenceV1");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function gridCorrespondences(transform = ([x, y]) => [x, y]) {
  const result = [];
  for (let row = 0; row < 5; row += 1) {
    for (let column = 0; column < 6; column += 1) {
      const x = 100 + column * 190;
      const y = 120 + row * 350;
      const [sourceX, sourceY] = transform([x, y]);
      result.push({
        correspondenceId: `control-${String(result.length + 1).padStart(2, "0")}`,
        designReferencePointPx: { x, y },
        normalizedSourcePointPx: { x: sourceX, y: sourceY },
      });
    }
  }
  return result;
}

function input(overrides = {}) {
  const artifactBytes = overrides.artifactBytes ?? Buffer.from("approved-reference-image-v3");
  const sourceBytes = overrides.sourceBytes ?? Buffer.from("normalized-front-source-v1");
  const approvedReference = {
    referenceId: "design-reference-3",
    profile: "registered_design_template_v1",
    status: "approved",
    tenantId: "tenant-1",
    setId: "set-1",
    programId: "program-1",
    cardNumber: "42",
    variantId: "photo-a",
    parallelId: "gold",
    side: "front",
    version: 3,
    artifactSha256: sha256(artifactBytes),
    artifactWidthPx: 1200,
    artifactHeightPx: 1680,
    intendedDesignBoundary: {
      schemaVersion: "ai-grader-intended-design-boundary-v1",
      coordinateFrame: "design_reference_pixels",
      contour: [[120, 168], [1080, 168], [1080, 1512], [120, 1512]],
    },
    approvedByUserId: "approver-1",
    approvedAt: new Date("2026-07-18T18:00:00.000Z"),
    ...(overrides.approvedReference ?? {}),
  };
  return {
    approvedReference,
    artifactEvidence: {
      assetId: "approved-design-artifact-3",
      sha256: sha256(artifactBytes),
      bytes: artifactBytes,
      ...(overrides.artifactEvidence ?? {}),
    },
    normalizedSourceEvidence: {
      assetId: "normalized-front-source-3",
      sha256: sha256(sourceBytes),
      bytes: sourceBytes,
      side: "front",
      coordinateFrame: "normalized_card_portrait_pixels",
      widthPx: 1200,
      heightPx: 1680,
      ...(overrides.normalizedSourceEvidence ?? {}),
    },
    transformType: overrides.transformType ?? "affine",
    correspondences: overrides.correspondences ?? gridCorrespondences(),
    ...(overrides.root ?? {}),
  };
}

test("approved bytes and correspondence ledger deterministically produce the strict registration seam", () => {
  const source = input();
  const first = projectApprovedFixedRigDesignReferenceV1(source);
  const second = projectApprovedFixedRigDesignReferenceV1(source);
  assert.equal(first.version, FIXED_RIG_DESIGN_REFERENCE_PROJECTION_V1_VERSION);
  assert.deepEqual(first, second);
  assert.equal(mathematicalDesignReferenceV1Schema.safeParse(first.designReference).success, true);
  assert.deepEqual(first.designReference.intendedPrintBoundary, [
    { x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 },
    { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 },
  ]);
  assert.equal(first.registration.transformType, "affine");
  assert.deepEqual(first.registration.transformMatrix, [1, 0, 0, 0, 1, 0]);
  assert.equal(first.registration.registrationResidualPx, 0);
  assert.equal(first.registration.inlierCount, 30);
  assert.equal(first.registration.inlierFraction, 1);
  assert.equal(first.registration.confidence, 1);
  assert.equal(
    first.binding.registrationAlgorithmVersion,
    FIXED_RIG_DESIGN_REFERENCE_REGISTRATION_V1_VERSION,
  );
  assert.match(first.binding.correspondenceLedgerSha256, /^[a-f0-9]{64}$/);
  assert.match(first.binding.registrationSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(first.centeringProfileInput.registrationBinding, first.binding);
  assert.deepEqual(
    verifyFixedRigDesignReferenceRegistrationBindingV1({
      designReference: first.designReference,
      registration: first.registration,
      binding: first.binding,
    }),
    { valid: true },
  );
});

test("caller-declared transform and quality metrics have no registration authority", () => {
  const projected = projectApprovedFixedRigDesignReferenceV1(input({
    root: {
      registration: {
        transformMatrix: [9, 0, 999, 0, 9, 999],
        registrationResidualPx: 0,
        inlierCount: 999,
        inlierFraction: 1,
        confidence: 1,
      },
    },
  }));
  assert.deepEqual(projected.registration.transformMatrix, [1, 0, 0, 0, 1, 0]);
  assert.equal(projected.registration.inlierCount, 30);
});

test("affine registration is computed from source correspondences and rejects an outlier", () => {
  const controls = gridCorrespondences(([x, y]) => [0.98 * x + 0.02 * y + 8, -0.01 * x + 1.01 * y + 6]);
  controls[29].normalizedSourcePointPx = { x: 40, y: 40 };
  const projected = projectApprovedFixedRigDesignReferenceV1(input({ correspondences: controls }));
  [0.98, 0.02, 8, -0.01, 1.01, 6].forEach((value, index) => {
    assert.ok(Math.abs(projected.registration.transformMatrix[index] - value) < 1e-8);
  });
  assert.equal(projected.registration.inlierCount, 29);
  assert.equal(projected.registration.inlierFraction, 0.966667);
  assert.equal(projected.binding.inlierCorrespondenceIds.includes("control-30"), false);
});

test("homography registration is computed internally from a non-affine ledger", () => {
  const matrix = [1.01, 0.015, 4, -0.01, 0.99, 7, 0.00002, -0.00001, 1];
  const controls = gridCorrespondences(([x, y]) => {
    const denominator = matrix[6] * x + matrix[7] * y + 1;
    return [
      (matrix[0] * x + matrix[1] * y + matrix[2]) / denominator,
      (matrix[3] * x + matrix[4] * y + matrix[5]) / denominator,
    ];
  });
  const projected = projectApprovedFixedRigDesignReferenceV1(input({
    transformType: "homography",
    correspondences: controls,
  }));
  assert.equal(projected.registration.transformType, "homography");
  projected.registration.transformMatrix.forEach((value, index) => {
    assert.ok(Math.abs(value - matrix[index]) < 1e-8);
  });
  assert.equal(projected.registration.registrationResidualPx, 0);
  assert.equal(projected.registration.confidence, 1);
});

test("exact approved and normalized source byte hashes are mandatory", () => {
  assert.throws(
    () => projectApprovedFixedRigDesignReferenceV1(input({
      artifactEvidence: { bytes: Buffer.from("tampered-artifact") },
    })),
    /artifact bytes do not exactly match/,
  );
  assert.throws(
    () => projectApprovedFixedRigDesignReferenceV1(input({
      normalizedSourceEvidence: { bytes: Buffer.from("tampered-source") },
    })),
    /Normalized source evidence bytes, hash/,
  );
});

test("centering verification rejects ledger, transform, metric and result-hash tampering", () => {
  const projected = projectApprovedFixedRigDesignReferenceV1(input());
  const cases = [
    (copy) => { copy.binding.correspondenceLedger.correspondences[0].normalizedSourcePointPx.x += 1; },
    (copy) => { copy.registration.transformMatrix[2] += 1; },
    (copy) => { copy.registration.confidence = 0.99; },
    (copy) => { copy.binding.registrationSha256 = "f".repeat(64); },
  ];
  cases.forEach((mutate) => {
    const copy = structuredClone(projected);
    mutate(copy);
    const verified = verifyFixedRigDesignReferenceRegistrationBindingV1({
      designReference: copy.designReference,
      registration: copy.registration,
      binding: copy.binding,
    });
    assert.equal(verified.valid, false);
  });
});

test("projection rejects insufficient, duplicate, outside and degenerate correspondence ledgers", () => {
  const tooFew = gridCorrespondences().slice(0, 23);
  const duplicate = gridCorrespondences();
  duplicate[1].designReferencePointPx = { ...duplicate[0].designReferencePointPx };
  const outside = gridCorrespondences();
  outside[0].normalizedSourcePointPx.x = 1201;
  const degenerate = gridCorrespondences().map((entry, index) => ({
    ...entry,
    designReferencePointPx: { x: 100 + index * 10, y: 200 + index * 10 },
    normalizedSourcePointPx: { x: 120 + index * 10, y: 220 + index * 10 },
  }));
  for (const [controls, expected] of [
    [tooFew, /fewer than the manifest minimum/],
    [duplicate, /must be unique in both coordinate frames/],
    [outside, /outside the immutable source artifact/],
    [degenerate, /geometry is degenerate/],
  ]) {
    assert.throws(
      () => projectApprovedFixedRigDesignReferenceV1(input({ correspondences: controls })),
      expected,
    );
  }
});

test("projection still rejects unapproved and ambiguous approved contours", () => {
  assert.throws(
    () => projectApprovedFixedRigDesignReferenceV1(input({
      approvedReference: { status: "draft" },
    })),
    /Only an approved/,
  );
  assert.throws(
    () => projectApprovedFixedRigDesignReferenceV1(input({
      approvedReference: {
        intendedDesignBoundary: {
          schemaVersion: "ai-grader-intended-design-boundary-v1",
          coordinateFrame: "design_reference_pixels",
          contour: [[0, 0], [100, 100], [0, 100], [100, 0]],
        },
      },
    })),
    /intersect or touch ambiguously/,
  );
});

test("shared mathematical reference schema independently rejects ambiguous normalized contours", () => {
  const valid = projectApprovedFixedRigDesignReferenceV1(input()).designReference;
  assert.equal(mathematicalDesignReferenceV1Schema.safeParse({
    ...valid,
    intendedPrintBoundary: [
      { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 0 },
    ],
  }).success, false);
});
