import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import test from "node:test";
import {
  buildAiGraderCaptureProfileRequest,
  buildAiGraderMathematicalAuthorityBindingRequest,
  buildAiGraderMathematicalFindingReviewSubmission,
  buildAiGraderMathematicalGradingAuthorityV1,
  collectAiGraderMathematicalReviewAssets,
  fetchAiGraderMathematicalReviewAsset,
  stageAiGraderMathematicalDesignReference,
  type AiGraderPreparedRegisteredDesignReferenceV1,
} from "../lib/aiGraderStationBridgeClient";
import {
  buildAiGraderLocalStationStatus,
  parseAiGraderStationAction,
  sanitizeAiGraderLocalStationStatusForDisplay,
  type AiGraderMathematicalFindingReviewRequestV1,
  type AiGraderMathematicalGradingAuthorityV1,
  type AiGraderMathematicalReviewAssetMetadataV1,
} from "../lib/aiGraderLocalStation";

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: webcrypto as unknown as Crypto,
  });
}

const identity = {
  title: "2026 Ten Kings Calibration Test Card 7",
  tenantId: "tenant-1",
  setId: "set-2026",
  programId: "program-main",
  cardNumber: "7",
  variantId: null,
  parallelId: null,
} as const;

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function registeredReference(): AiGraderPreparedRegisteredDesignReferenceV1 {
  const bytes = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
  const artifactSha256 = sha256(bytes);
  return {
    operatorAuthority: {
      databaseReferenceId: "design-ref-front-1",
      mathematicalReference: {
        schemaVersion: "ai-grader-design-reference-v1",
        designReferenceId: "design-ref-front-1",
        profile: "registered_design_template_v1",
        tenantId: identity.tenantId,
        setId: identity.setId,
        programId: identity.programId,
        cardNumber: identity.cardNumber,
        variantId: identity.variantId,
        parallelId: identity.parallelId,
        side: "front",
        artifactId: "design-artifact-front-1",
        artifactSha256,
        version: 3,
        widthPx: 1200,
        heightPx: 1680,
        intendedPrintBoundary: [
          { x: 0.08, y: 0.08 },
          { x: 0.92, y: 0.08 },
          { x: 0.92, y: 0.92 },
          { x: 0.08, y: 0.92 },
        ],
        approvedBy: "operator-1",
        approvedAt: "2026-07-19T12:00:00.000Z",
      },
      artifactMimeType: "image/png",
      intendedDesignBoundaryPixels: {
        schemaVersion: "ai-grader-intended-design-boundary-v1",
        coordinateFrame: "design_reference_pixels",
        contour: [[96, 134], [1104, 134], [1104, 1546], [96, 1546]],
      },
      registrationAcceptance: { maxResidualPx: 1.5 },
      provenance: { source: "approved_admin_workflow" },
    },
    artifact: {
      referenceId: "design-ref-front-1",
      sha256: artifactSha256,
      mimeType: "image/png",
      bytes,
    },
  };
}

function exactAuthority(): {
  authority: AiGraderMathematicalGradingAuthorityV1;
  prepared: AiGraderPreparedRegisteredDesignReferenceV1;
} {
  const prepared = registeredReference();
  return {
    prepared,
    authority: buildAiGraderMathematicalGradingAuthorityV1({
      identity: { ...identity },
      profiles: {
        front: "registered_design_template_v1",
        back: "printed_border_v1",
      },
      registeredDesignReferences: { front: prepared },
    }),
  };
}

test("initial Mathematical V1 request carries exact authority but no caller publication, transform, or confidence", () => {
  const { authority } = exactAuthority();
  const request = buildAiGraderCaptureProfileRequest(
    "full_forensic",
    "mathematical_calibration_v1",
    authority,
  );
  assert.deepEqual(Object.keys(request).sort(), [
    "captureProfile",
    "gradingContract",
    "mathematicalGradingAuthority",
  ]);
  assert.equal(request.mathematicalGradingAuthority, authority);
  const serialized = JSON.stringify(request);
  assert.equal(serialized.includes("publication"), false);
  assert.equal(serialized.includes("transform"), false);
  assert.equal(serialized.includes("confidence"), false);
  assert.throws(
    () => buildAiGraderCaptureProfileRequest("full_forensic", "mathematical_calibration_v1"),
    /requires exact card and centering authority/i,
  );
});

test("Rapid continuation binds the same publication-free exact authority before capture", () => {
  const { authority } = exactAuthority();
  assert.equal(
    parseAiGraderStationAction("bind-mathematical-grading-authority"),
    "bind-mathematical-grading-authority",
  );
  assert.deepEqual(buildAiGraderMathematicalAuthorityBindingRequest(authority), {
    mathematicalGradingAuthority: authority,
  });
});

test("registered design-reference staging is binary, token-gated, exact, and path-free", async () => {
  const { authority, prepared } = exactAuthority();
  let observedUrl = "";
  await stageAiGraderMathematicalDesignReference({
    baseUrl: "http://127.0.0.1:47652",
    stationToken: "paired-token",
    sessionId: "session-1",
    side: "front",
    authority,
    artifact: prepared.artifact,
  }, (async (url, init) => {
    observedUrl = String(url);
    assert.equal(init?.method, "POST");
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers["x-ai-grader-session-id"], "session-1");
    assert.equal(headers["x-ai-grader-side"], "front");
    assert.equal(headers["x-ai-grader-reference-id"], "design-ref-front-1");
    assert.equal(headers["x-ai-grader-sha256"], prepared.artifact.sha256);
    assert.deepEqual(
      new Uint8Array(init?.body as ArrayBuffer),
      prepared.artifact.bytes,
    );
    return new Response(JSON.stringify({
      ok: true,
      result: {
        side: "front",
        referenceId: "design-ref-front-1",
        assetId: "design-artifact-front-1",
        sha256: prepared.artifact.sha256,
        byteSize: prepared.artifact.bytes.byteLength,
        contentType: "image/png",
        stagedAt: "2026-07-19T12:01:00.000Z",
        createNew: true,
      },
    }), { status: 201, headers: { "content-type": "application/json" } });
  }) as typeof fetch);
  assert.equal(
    observedUrl,
    "http://127.0.0.1:47652/mathematical-v1/design-reference-artifacts/front",
  );
  assert.equal(/[?]|filePath|localPath/i.test(observedUrl), false);
});

function reviewAsset(
  assetId: string,
  evidenceRole: AiGraderMathematicalReviewAssetMetadataV1["evidenceRole"],
  bytes: Uint8Array,
): AiGraderMathematicalReviewAssetMetadataV1 {
  return {
    assetId,
    evidenceRole,
    sha256: sha256(bytes),
    fileName: assetId + ".png",
    contentType: "image/png",
    byteSize: bytes.byteLength,
    widthPx: 4,
    heightPx: 8,
  };
}

test("review asset tampering is rejected after exact header verification", async () => {
  const expectedBytes = Uint8Array.from({ length: 32 }, (_, index) => index + 10);
  const tamperedBytes = expectedBytes.slice();
  tamperedBytes[4] ^= 0xff;
  const metadata = reviewAsset("finding-1-roi", "roi_crop", expectedBytes);
  await assert.rejects(
    fetchAiGraderMathematicalReviewAsset({
      baseUrl: "http://127.0.0.1:47652",
      stationToken: "paired-token",
      reportId: "report-1",
      requirement: { side: "front", metadata },
    }, (async () => new Response(tamperedBytes, {
      status: 200,
      headers: {
        "content-type": metadata.contentType,
        "content-length": String(metadata.byteSize),
        "x-ai-grader-asset-id": metadata.assetId,
        "x-ai-grader-sha256": metadata.sha256,
        "x-ai-grader-side": "front",
        "x-ai-grader-evidence-role": metadata.evidenceRole,
        "x-ai-grader-width-px": String(metadata.widthPx),
        "x-ai-grader-height-px": String(metadata.heightPx),
      },
    })) as typeof fetch),
    /body does not match its exact SHA-256/i,
  );
});

function reviewRequest(): AiGraderMathematicalFindingReviewRequestV1 {
  const bytes = Uint8Array.from({ length: 32 }, (_, index) => index + 20);
  const trueView = reviewAsset("front-true-view", "normalized_card", bytes);
  const directionalChannels = Array.from({ length: 8 }, (_, index) =>
    reviewAsset("front-direction-" + String(index + 1), "directional_channel", bytes));
  const finding = (findingId: string) => ({
    findingId,
    physicalDefectId: "physical-" + findingId,
    element: "surface" as const,
    category: "scratch",
    side: "front" as const,
    location: "center",
    regionId: "front-center",
    geometry: {
      coordinateFrame: "normalized_card" as const,
      kind: "box" as const,
      x: 0.2,
      y: 0.3,
      width: 0.1,
      height: 0.2,
    },
    detector: { id: "surface-v1", version: "1.0.0" },
    measuredDeduction: 0.25,
    measurements: [],
    evidenceAssetIds: ["front-true-view"],
    trueView,
    directionalChannels,
    reviewEvidence: {
      roi: reviewAsset(findingId + "-roi", "roi_crop", bytes),
      segmentationMask: reviewAsset(findingId + "-seg", "segmentation_mask", bytes),
      confidenceMask: reviewAsset(findingId + "-confidence", "confidence_mask", bytes),
      illuminationMask: reviewAsset(findingId + "-illumination", "illumination_mask", bytes),
    },
    explanation: "Measured scratch evidence.",
  });
  return {
    schemaVersion: "fixed_rig_mathematical_finding_review_request_v1",
    gradingContract: "mathematical_calibration_v1",
    gradingSessionId: "session-1",
    reportId: "report-1",
    generatedAt: "2026-07-19T12:00:00.000Z",
    calibration: {
      profileId: "profile-1",
      calibrationVersion: "1.0.0",
      artifactSha256: "1".repeat(64),
    },
    findings: [finding("finding-1"), finding("finding-2")],
    hashPolicy: "sha256-canonical-json-with-artifactSha256-omitted",
    artifactSha256: "2".repeat(64),
  };
}

test("complete finding review submits one exact SHA-bound disposition per finding and nothing subjective", () => {
  const request = reviewRequest();
  assert.equal(collectAiGraderMathematicalReviewAssets(request).length, 17);
  const submission = buildAiGraderMathematicalFindingReviewSubmission({
    request,
    dispositions: {
      "finding-1": "confirmed",
      "finding-2": "adjusted",
    },
    reviewedAt: "2026-07-19T12:05:00.000Z",
    operatorId: "operator-1",
  });
  assert.deepEqual(submission.mathematicalFindingReviews, [
    {
      findingId: "finding-1",
      reviewRequestSha256: request.artifactSha256,
      status: "confirmed",
      reviewedAt: "2026-07-19T12:05:00.000Z",
    },
    {
      findingId: "finding-2",
      reviewRequestSha256: request.artifactSha256,
      status: "adjusted",
      reviewedAt: "2026-07-19T12:05:00.000Z",
    },
  ]);
  assert.equal(JSON.stringify(submission).includes("confidence"), false);
  assert.throws(
    () => buildAiGraderMathematicalFindingReviewSubmission({
      request,
      dispositions: { "finding-1": "confirmed" },
    }),
    /every exact Mathematical finding/i,
  );
});

test("insufficient Mathematical state is explicit, path-free, and never introduces V0 fallback", () => {
  const raw = buildAiGraderLocalStationStatus();
  const authority = buildAiGraderMathematicalGradingAuthorityV1({
    identity: { ...identity },
    profiles: { front: "printed_border_v1", back: "printed_border_v1" },
  });
  raw.gradingContract = "mathematical_calibration_v1";
  raw.frontCaptureReadiness = {
    ready: false,
    code: "mathematical_authority_required",
    message: "Bind exact Mathematical V1 authority before capture.",
  };
  (raw as unknown as Record<string, unknown>).mathematicalV1 = {
    schemaVersion: "ten-kings-ai-grader-local-station-mathematical-v1-state-v1",
    generatedAt: "2026-07-19T12:00:00.000Z",
    gradingAuthority: authority,
    stagedDesignReferences: {
      front: {
        side: "front",
        referenceId: "design-ref-front-1",
        assetId: "design-artifact-front-1",
        fileName: "front.png",
        contentType: "image/png",
        sha256: "3".repeat(64),
        byteSize: 32,
        stagedAt: "2026-07-19T12:01:00.000Z",
        filePath: "C:\\TenKings\\private\\front.png",
      },
    },
    reviewAssets: {
      private: { filePath: "C:\\TenKings\\private\\review.png" },
    },
    execution: {
      status: "insufficient_evidence",
      completedAt: "2026-07-19T12:02:00.000Z",
      attempt: 1,
      v0FallbackUsed: false,
      failedStage: "surface_measurement",
      reasons: ["Glare obscures every usable directional channel in one region."],
      requiresRecapture: true,
      requiresApprovedDesignReference: false,
      requiresCalibration: false,
      requiresImplementationCorrection: false,
      reportBundlePath: "C:\\TenKings\\private\\report-bundle.json",
    },
  };
  const sanitized = sanitizeAiGraderLocalStationStatusForDisplay(raw);
  assert.equal(sanitized.gradingContract, "mathematical_calibration_v1");
  assert.equal(sanitized.frontCaptureReadiness.code, "mathematical_authority_required");
  assert.equal(sanitized.mathematicalV1?.execution?.status, "insufficient_evidence");
  assert.equal(sanitized.mathematicalV1?.execution?.v0FallbackUsed, false);
  if (sanitized.mathematicalV1?.execution?.status === "insufficient_evidence") {
    assert.equal(sanitized.mathematicalV1.execution.requiresRecapture, true);
    assert.equal(sanitized.mathematicalV1.execution.reasons.length, 1);
  }
  const serialized = JSON.stringify(sanitized.mathematicalV1);
  assert.equal(/[A-Z]:\\|filePath|reportBundlePath|reviewAssets/i.test(serialized), false);
  assert.equal(serialized.includes("fallbackUsed"), false);
});
