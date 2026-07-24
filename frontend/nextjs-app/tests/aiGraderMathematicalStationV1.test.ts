import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { AiGraderCalibrationActivationAuthorityV1 } from "@tenkings/shared";
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
  sanitizeAiGraderMathematicalV1StateForDisplay,
  sanitizeAiGraderRapidCaptureQueue,
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

function activeCalibrationAuthority(): AiGraderCalibrationActivationAuthorityV1 {
  return {
    schemaVersion: "ten-kings-ai-grader-calibration-activation-authority-v1",
    authorityPhase: "ACTIVE",
    activationId: "calibration-activation-station-v1",
    activationHash: "1".repeat(64),
    activationRevision: "2".repeat(64),
    snapshotId: "calibration-snapshot-station-v1",
    rigId: "fixed-rig-dell-v1",
    bundleManifestSha256: "3".repeat(64),
    memberLedgerSha256: "4".repeat(64),
    runtimeContextHash: "5".repeat(64),
    rigCharacterizationSha256: "6".repeat(64),
    operatingContextHash: "7".repeat(64),
    observationId: "calibration-observation-station-v1",
    workstationObservationSha256: "0".repeat(64),
    workstationReceiptSha256: "8".repeat(64),
    activatedAt: "2026-07-21T18:45:00.000Z",
    hostedAuthorityKeyId: "9".repeat(64),
    hostedAuthoritySignatureAlgorithm: "ecdsa-p256-sha256-ieee-p1363",
    hostedAuthorityIssuedAt: "2026-07-21T18:45:30.000Z",
    hostedAuthorityExpiresAt: "2026-07-21T18:47:30.000Z",
    hostedAuthoritySignature: "A".repeat(86),
  };
}

test("initial Mathematical V1 request uses the one-road production_fast profile with exact authority", () => {
  const { authority } = exactAuthority();
  const activationAuthority = activeCalibrationAuthority();
  const request = buildAiGraderCaptureProfileRequest(
    "production_fast",
    "mathematical_calibration_v1",
    authority,
    activationAuthority,
  );
  assert.deepEqual(Object.keys(request).sort(), [
    "calibrationActivationAuthority",
    "captureProfile",
    "gradingContract",
    "mathematicalGradingAuthority",
  ]);
  assert.equal(request.captureProfile, "production_fast");
  assert.equal(request.mathematicalGradingAuthority, authority);
  assert.equal(request.calibrationActivationAuthority, activationAuthority);
  const serialized = JSON.stringify(request);
  assert.equal(serialized.includes("full_forensic"), false);
  assert.equal(serialized.includes("publication"), false);
  assert.equal(serialized.includes("transform"), false);
  assert.equal(serialized.includes("confidence"), false);
  assert.throws(
    () => buildAiGraderCaptureProfileRequest("production_fast", "mathematical_calibration_v1"),
    /requires exact card and centering authority/i,
  );
  assert.throws(
    () => buildAiGraderCaptureProfileRequest("production_fast", "mathematical_calibration_v1", authority),
    /requires exact hosted\/local ACTIVE calibration authority/i,
  );
  assert.throws(
    () => buildAiGraderCaptureProfileRequest("production_fast"),
    /requires the explicit Mathematical Calibration V1 contract.*omitted contracts are prohibited/i,
  );
  assert.throws(
    () => buildAiGraderCaptureProfileRequest("production_fast", "legacy_v0", authority),
    /requires the explicit Mathematical Calibration V1 contract.*Legacy V0/i,
  );
});

test("Production station exposes Mathematical V1 as a fixed contract with no Legacy selector", () => {
  const source = readFileSync(new URL("../pages/ai-grader/station.tsx", import.meta.url), "utf8");
  assert.match(
    source,
    /selectedGradingContract:\s*AiGraderGradingContract\s*=\s*"mathematical_calibration_v1"/,
  );
  assert.match(source, /Mathematical Calibration V1 \(required\)/);
  assert.doesNotMatch(source, /<option value="legacy_v0">/);
  assert.doesNotMatch(source, /setSelectedGradingContract/);
});

test("Production station uses plain-language card and border labels", () => {
  const source = readFileSync(new URL("../pages/ai-grader/station.tsx", import.meta.url), "utf8");
  assert.match(source, /<option value="generic_standard">Sports<\/option>/);
  assert.match(source, /<option value="pokemon_tcg_standard">Pokémon<\/option>/);
  assert.match(source, /<option value="printed_border_v1">Border<\/option>/);
  assert.match(source, /<option value="registered_design_template_v1">No Border<\/option>/);
  assert.doesNotMatch(source, />Existing standard trading card<\/option>/);
  assert.doesNotMatch(source, />Trusted Pokémon TCG standard<\/option>/);
  assert.doesNotMatch(source, />Printed border V1<\/option>/);
  assert.doesNotMatch(source, />Approved registered template V1<\/option>/);
});

test("Production station uses one contextual card-information form for grading and publishing", () => {
  const source = readFileSync(new URL("../pages/ai-grader/station.tsx", import.meta.url), "utf8");
  assert.match(source, /<p className="eyebrow">Card Information<\/p>/);
  assert.match(source, /Enter Once Before Grading/);
  assert.match(source, /One form \/ all outputs/);
  assert.match(source, /Card Type/);
  assert.match(source, /Pokémon \/ Card Name/);
  assert.match(source, /Pokémon Set/);
  assert.match(source, /Subset/);
  assert.match(source, /Finish \/ Parallel/);
  assert.match(source, /Card \/ Player/);
  assert.match(source, /Sports Set/);
  assert.match(source, /Subset \/ Insert/);
  assert.match(source, /\{label\}\{optional \? " \(Optional\)" : ""\}/);
  assert.doesNotMatch(source, /\["tenantId", "Tenant ID"\]/);
  assert.doesNotMatch(source, /<p className="eyebrow">Card Identity<\/p>/);
  assert.doesNotMatch(source, /Review before Approve & Publish/);
  assert.match(source, /tenantId:\s*"ten-kings"/);
  assert.match(source, /programId:\s*mathematicalAuthorityDraft\.programId\.trim\(\) \|\| "base"/);
  assert.match(source, /updateSharedCardInformation\(field, event\.target\.value\)/);
  assert.match(source, /field === "setId"[\s\S]*?updateIdentityDraft\("productSet", value\)/);
  assert.match(source, /field === "programId"[\s\S]*?updateIdentityDraft\("insert", value\)/);
  assert.match(source, /field === "parallelId"[\s\S]*?updateIdentityDraft\("parallel", value\)/);
  assert.match(source, /preCaptureDraftBySessionRef\.current\.set\(started\.sessionManifest\.gradingSessionId/);
  assert.match(source, /preCaptureDraftBySessionRef\.current\.get\(activeReview\.gradingSessionId\)/);
  assert.match(
    source,
    /const mathematicalAuthorityDraftComplete = \[\s*mathematicalAuthorityDraft\.title,\s*mathematicalAuthorityDraft\.setId,\s*mathematicalAuthorityDraft\.cardNumber,\s*\]/,
  );
});

test("Production station uses the configured activation registry instead of the retired direct-bundle UI gate", () => {
  const source = readFileSync(new URL("../pages/ai-grader/station.tsx", import.meta.url), "utf8");
  assert.match(
    source,
    /const mathematicalActivationPreflightReady =\s*bridgeConnected &&\s*status\.calibrationActivation\?\.configured === true &&\s*Boolean\(status\.mathematicalCalibration\?\.rigId\)/,
  );
  assert.match(
    source,
    /const mathematicalCalibrationReady =\s*status\.mathematicalCalibration\?\.ready === true \|\|\s*mathematicalActivationPreflightReady/,
  );
  assert.match(source, /Exact hosted\/local ACTIVE calibration authority will be verified at Start New Card/);
  assert.match(source, /await fetch\(AI_GRADER_CALIBRATION_START_AUTHORITY_API_V1/);
  assert.match(source, /buildAiGraderCaptureProfileRequest\([\s\S]*?activationPayload\.authority/);
});

test("Mathematical V1 does not restore retired profile or separate Rapid queue actions", () => {
  const status = buildAiGraderLocalStationStatus();
  assert.equal(status.captureProfile, "production_fast");
  assert.deepEqual(status.captureProfileGuard.availableCaptureProfiles, ["production_fast"]);
  assert.equal(parseAiGraderStationAction("configure-rapid-capture"), null);
  assert.equal(parseAiGraderStationAction("queue-current-card"), null);
});

test("Mathematical review activation accepts V1 review states without weakening publication eligibility", () => {
  const source = readFileSync(new URL("../pages/ai-grader/station.tsx", import.meta.url), "utf8");
  const activationStart = source.indexOf("const activateRapidQueueItem");
  const activationEnd = source.indexOf("const submitMathematicalFindingReviews", activationStart);
  assert.ok(activationStart >= 0 && activationEnd > activationStart);
  const activationBlock = source.slice(activationStart, activationEnd);
  assert.match(activationBlock, /RAPID_REVIEWABLE_STATES\.has\(item\.state\)/);
  assert.doesNotMatch(activationBlock, /aiGraderRapidItemPublishable\(item\.state\)/);
  assert.match(
    source,
    /RAPID_REVIEWABLE_STATES[\s\S]*?"finding_review_required"[\s\S]*?"insufficient_evidence"/,
  );

  const publicationStart = source.indexOf("const productionReleaseBody");
  const publicationEnd = source.indexOf("const buildReportBundleForProduction", publicationStart);
  assert.ok(publicationStart >= 0 && publicationEnd > publicationStart);
  assert.match(
    source.slice(publicationStart, publicationEnd),
    /assertAiGraderRapidItemPublishable\(activeReviewItem\?\.state\)/,
  );
});

test("queued Mathematical review state and assets bind to the exact activated queue identity", () => {
  const source = readFileSync(new URL("../pages/ai-grader/station.tsx", import.meta.url), "utf8");
  const reviewStateStart = source.indexOf("const activeReview = status.rapidCaptureQueue.activeReview;");
  const reviewStateEnd = source.indexOf("const revokeMathematicalReviewObjectUrls", reviewStateStart);
  assert.ok(reviewStateStart >= 0 && reviewStateEnd > reviewStateStart);
  const reviewStateBlock = source.slice(reviewStateStart, reviewStateEnd);
  assert.match(
    reviewStateBlock,
    /const mathematicalExecution = activeReviewManifest\?\.mathematicalV1\?\.execution/,
  );
  assert.doesNotMatch(reviewStateBlock, /status\.mathematicalV1\?\.execution/);
  assert.match(reviewStateBlock, /const cleanSessionMathematicalV1 = status\.mathematicalV1/);
  assert.match(
    reviewStateBlock,
    /const mathematicalAuthorityBound = Boolean\(cleanSessionMathematicalV1\?\.gradingAuthority\)/,
  );

  const assetEffectStart = source.indexOf("const request = mathematicalReviewRequest;", reviewStateEnd);
  const assetEffectEnd = source.indexOf(
    "useEffect(() => () => revokeMathematicalReviewObjectUrls()",
    assetEffectStart,
  );
  assert.ok(assetEffectStart >= 0 && assetEffectEnd > assetEffectStart);
  const assetEffectBlock = source.slice(assetEffectStart, assetEffectEnd);
  assert.match(
    assetEffectBlock,
    /request\.gradingSessionId !== activeReviewQueueIdentity\.gradingSessionId/,
  );
  assert.match(assetEffectBlock, /request\.reportId !== activeReviewQueueIdentity\.reportId/);
  assert.match(
    assetEffectBlock,
    /fetchAiGraderMathematicalReviewAsset\(\{[\s\S]*?queueItemId: activeReviewQueueIdentity\.queueItemId,[\s\S]*?gradingSessionId: activeReviewQueueIdentity\.gradingSessionId,[\s\S]*?reportId: activeReviewQueueIdentity\.reportId,/,
  );
  assert.doesNotMatch(assetEffectBlock, /reportId: request\.reportId/);
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
      queueItemId: "queue-item-1",
      gradingSessionId: "grading-session-1",
      reportId: "report-1",
      requirement: { side: "front", metadata },
    }, (async () => new Response(tamperedBytes, {
      status: 200,
      headers: {
        "content-type": metadata.contentType,
        "content-length": String(metadata.byteSize),
        "x-ai-grader-queue-item-id": "queue-item-1",
        "x-ai-grader-grading-session-id": "grading-session-1",
        "x-ai-grader-report-id": "report-1",
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
    measurements: [{
      measurementId: findingId + "-length",
      kind: "length",
      unit: "mm",
      measuredMeasurement: 1,
      u95: 0.1,
      effectiveMeasurement: 0.9,
      explicitGrade10Tolerance: 0.05,
      grade10Buffer: 0.1,
      calibrationProfileId: "profile-1",
      calibrationVersion: "1.0.0",
      algorithmVersion: "surface-v1",
      validEvidenceCoverage: 0.95,
      usableDirectionalChannelCount: 8,
    }],
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

test("queued finding and insufficient reviews retain exact Mathematical state without a completed report", () => {
  const request = reviewRequest();
  const authority = buildAiGraderMathematicalGradingAuthorityV1({
    identity: { ...identity },
    profiles: { front: "printed_border_v1", back: "printed_border_v1" },
  });
  const at = "2026-07-19T12:10:00.000Z";
  const findingPayload = {
    activeQueueItemId: "queue-1",
    activeReview: {
      queueItemId: "queue-1",
      gradingSessionId: request.gradingSessionId,
      reportId: request.reportId,
      manifest: {
        latestReport: { reportId: request.reportId, exists: false },
        mathematicalV1: {
          schemaVersion: "ten-kings-ai-grader-local-station-mathematical-v1-state-v1",
          generatedAt: request.generatedAt,
          gradingAuthority: authority,
          stagedDesignReferences: {},
          execution: {
            status: "finding_review_required",
            completedAt: at,
            attempt: 1,
            v0FallbackUsed: false,
            reviewRequest: request,
            reviewIssues: [],
          },
        },
      },
    },
    items: [{
      queueItemId: "queue-1",
      sessionId: request.gradingSessionId,
      reportId: request.reportId,
      state: "finding_review_required",
      queuedAt: at,
      updatedAt: at,
      history: [],
      mathematicalV1: {
        status: "finding_review_required",
        reviewRequestSha256: request.artifactSha256,
      },
      ocr: { state: "waiting_for_normalized", updatedAt: at, attemptCount: 0 },
    }],
  };
  assert.equal(
    sanitizeAiGraderMathematicalV1StateForDisplay(
      findingPayload.activeReview.manifest.mathematicalV1,
    )?.execution?.status,
    "finding_review_required",
  );
  const finding = sanitizeAiGraderRapidCaptureQueue(findingPayload);
  assert.equal(finding.activeReview?.manifest.latestReport.exists, false);
  assert.equal(
    finding.activeReview?.manifest.mathematicalV1?.execution?.status,
    "finding_review_required",
  );

  const insufficientPayload = structuredClone(findingPayload) as any;
  insufficientPayload.activeReview.manifest.mathematicalV1.execution = {
    status: "insufficient_evidence",
    completedAt: at,
    attempt: 1,
    v0FallbackUsed: false,
    failedStage: "centering",
    reasons: ["Exact intended design evidence is unavailable."],
    requiresRecapture: false,
    requiresApprovedDesignReference: true,
    requiresCalibration: false,
    requiresImplementationCorrection: false,
  };
  insufficientPayload.items[0].state = "insufficient_evidence";
  insufficientPayload.items[0].mathematicalV1 = {
    status: "insufficient_evidence",
    failedStage: "centering",
    requiresApprovedDesignReference: true,
  };
  const insufficient = sanitizeAiGraderRapidCaptureQueue(insufficientPayload);
  assert.equal(insufficient.activeReview?.manifest.latestReport.exists, false);
  assert.equal(
    insufficient.activeReview?.manifest.mathematicalV1?.execution?.status,
    "insufficient_evidence",
  );

  const forged = structuredClone(findingPayload) as any;
  forged.activeReview.manifest.mathematicalV1.execution.reviewRequest.reportId = "report-other";
  assert.equal(sanitizeAiGraderRapidCaptureQueue(forged).activeReview, undefined);
});

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
