import test from "node:test";
import assert from "node:assert/strict";
import {
  AI_GRADER_CALIBRATION_ACTIVATION_ROUTE_MAP_V1,
  runAiGraderCalibrationActivationWorkflowV1,
} from "../lib/aiGraderCalibrationActivationClient";

const at = {
  observed: "2026-07-23T12:00:30.000Z",
  requested: "2026-07-23T12:01:00.000Z",
  verified: "2026-07-23T12:01:30.000Z",
  activated: "2026-07-23T12:02:00.000Z",
  pendingExpires: "2026-07-23T12:11:00.000Z",
  receiptExpires: "2026-07-23T12:11:30.000Z",
  activeExpires: "2026-07-23T13:02:00.000Z",
};

const hash = (character: string) => character.repeat(64);
const signature = "A".repeat(86);
const rigId = "fixed-rig-dell-v1";
const snapshotId = "snapshot-exact";
const observationId = "observation-exact";
const activationId = "activation-exact";
const bundleManifestSha256 = hash("b");
const memberLedgerSha256 = hash("c");
const runtimeContextHash = hash("d");
const rigCharacterizationSha256 = hash("e");
const operatingContextHash = hash("f");
const registryRevision = hash("a");
const pendingRevision = hash("1");
const activeRevision = hash("2");
const activationHash = hash("3");
const workstationObservationSha256 = hash("4");
const workstationReceiptSha256 = hash("5");

const members = [
  ["calibration_profile", undefined, "mathematical-calibration-profile-v1.json"],
  ["physical_calibration_artifact", undefined, "mathematical-calibration-artifact-v1.json"],
  ["calibration_acceptance", undefined, "mathematical-calibration-acceptance-v1.json"],
  ...Array.from({ length: 8 }, (_, index) => [
    "flat_field",
    index + 1,
    `flat-field-channel-${index + 1}-v1.json`,
  ]),
  ["illumination_pattern", undefined, "illumination-pattern-v1.json"],
].map(([role, channelIndex, fileName], index) => ({
  role,
  ...(channelIndex === undefined ? {} : { channelIndex }),
  fileName,
  sha256: (index % 10).toString().repeat(64),
}));

const operatingContext = {
  schemaVersion: "ten-kings-ai-grader-operating-context-v1",
  rig: {
    tenantId: "ten-kings",
    rigId,
    rigVersion: "owner-operational-v1",
    locationId: "ten-kings-dell-ai-grader-station",
    locationIdentity: "owner-declared-ten-kings-dell-ai-grader-location-v1",
  },
  camera: { serial: "41934475", model: "a2A2448-23gmBAS" },
  optics: {
    lensIdentity: "owner-declared-installed-lens-unserialized-v1",
    mountIdentity: "owner-declared-fixed-camera-mount-unserialized-v1",
  },
  controller: {
    controllerIdentity: "owner-declared-leimac-idmu-controller-unit-1-v1",
    channelWiringMapIdentity: "owner-declared-ordered-output-map-unresolved-directions-v1",
    channelMap: Array.from({ length: 8 }, (_, index) => ({
      channelIndex: index + 1,
      controllerOutput: `leimac-output-${index + 1}`,
      lightingRole: `unresolved-physical-direction-channel-${index + 1}`,
    })),
  },
  lighting: {
    configurationIdentity: "owner-declared-existing-eight-channel-lighting-configuration-v1",
    selectedChannels: [1, 2, 3, 4, 5, 6, 7, 8],
    dutyPercent: 20,
  },
  capture: {
    exposureUs: 10000,
    gain: 0,
    pixelFormat: "Mono8",
    widthPx: 2448,
    heightPx: 2048,
  },
  calibration: {
    targetSha256: hash("6"),
    rigCharacterizationSha256,
    bundleSchemaVersion: "ten-kings-mathematical-calibration-bundle-v1",
    bundleManifestSha256,
    sourceCaptureManifestSha256: hash("7"),
    memberLedgerSha256,
    members,
  },
  software: {
    captureProfileVersion: "fixed-rig-capture-v1",
    calibrationAlgorithmVersion: "fixed-rig-physical-calibration-v1.0.0",
    analysisAlgorithmVersion: "opencv-physical-calibration-analysis-v1",
    thresholdSetId: "ten-kings-mathematical-grading-v1.0.1",
    thresholdSetHash: hash("8"),
    helperInstanceId: "local-dell-ai-grader-station",
    helperVersion: "ai-grader-local-station-bridge-v0.10",
  },
};

const runtimeObservation = {
  schemaVersion: "ten-kings-mathematical-calibration-runtime-observation-v1",
  source: "opened-basler-pylon-and-leimac-acknowledgement-v1",
  camera: operatingContext.camera,
  capture: operatingContext.capture,
  controller: {
    controllerTransportIdentity: "leimac-idmu-tcp:169.254.191.156:1000:unit:1",
    selectedChannels: operatingContext.lighting.selectedChannels,
    dutyPercent: operatingContext.lighting.dutyPercent,
    expectedWriteCount: 4,
    acknowledgedWriteCount: 4,
    allWritesAcknowledged: true,
  },
  software: {
    helperInstanceId: operatingContext.software.helperInstanceId,
    helperVersion: operatingContext.software.helperVersion,
  },
};

const hostedSignature = {
  hostedAuthorityKeyId: hash("9"),
  hostedAuthoritySignatureAlgorithm: "ecdsa-p256-sha256-ieee-p1363",
  hostedAuthoritySignature: signature,
};

const observationAuthority = {
  schemaVersion: "ten-kings-ai-grader-calibration-observation-authority-v1",
  authorityPhase: "OBSERVATION",
  observationId,
  registryRevision,
  snapshotId,
  rigId,
  bundleManifestSha256,
  memberLedgerSha256,
  runtimeContextHash,
  rigCharacterizationSha256,
  operatingContextHash,
  operatingContextV1: operatingContext,
  ...hostedSignature,
  hostedAuthorityIssuedAt: "2026-07-23T12:00:00.000Z",
  hostedAuthorityExpiresAt: at.pendingExpires,
};

const workstationObservation = {
  schemaVersion: "ten-kings-ai-grader-calibration-workstation-observation-v1",
  observationId,
  hostedObservationAuthoritySha256: hash("0"),
  registryRevision,
  snapshotId,
  rigId,
  bundleManifestSha256,
  memberLedgerSha256,
  runtimeContextHash,
  rigCharacterizationSha256,
  expectedOperatingContextHash: operatingContextHash,
  observedOperatingContextHash: operatingContextHash,
  runtimeObservation,
  runtimeObservationSha256: hash("1"),
  evidenceImageFileName: "activation-runtime-evidence.png",
  evidenceImageMediaType: "image/png",
  evidenceImageSha256: hash("2"),
  evidenceImageByteSize: 128,
  helperInstanceId: operatingContext.software.helperInstanceId,
  helperVersion: operatingContext.software.helperVersion,
  workstationKeyId: hash("3"),
  signatureAlgorithm: "ecdsa-p256-sha256-ieee-p1363",
  observedAt: at.observed,
  signature,
};

const pendingAuthority = {
  schemaVersion: "ten-kings-ai-grader-calibration-pending-authority-v1",
  authorityPhase: "PENDING",
  activationId,
  activationHash,
  activationRevision: pendingRevision,
  snapshotId,
  rigId,
  bundleManifestSha256,
  memberLedgerSha256,
  runtimeContextHash,
  rigCharacterizationSha256,
  operatingContextHash,
  observationId,
  workstationObservationSha256,
  operatingContextV1: operatingContext,
  requestedAt: at.requested,
  pendingExpiresAt: at.pendingExpires,
  ...hostedSignature,
  hostedAuthorityIssuedAt: at.requested,
  hostedAuthorityExpiresAt: at.pendingExpires,
};

const workstationReceipt = {
  schemaVersion: "ten-kings-ai-grader-calibration-workstation-receipt-v1",
  activationId,
  activationHash,
  activationRevision: pendingRevision,
  snapshotId,
  rigId,
  bundleManifestSha256,
  memberLedgerSha256,
  runtimeContextHash,
  rigCharacterizationSha256,
  expectedOperatingContextHash: operatingContextHash,
  observedOperatingContextHash: operatingContextHash,
  observationId,
  workstationObservationSha256,
  runtimeObservationSha256: workstationObservation.runtimeObservationSha256,
  evidenceImageSha256: workstationObservation.evidenceImageSha256,
  helperInstanceId: operatingContext.software.helperInstanceId,
  helperVersion: operatingContext.software.helperVersion,
  workstationKeyId: workstationObservation.workstationKeyId,
  signatureAlgorithm: "ecdsa-p256-sha256-ieee-p1363",
  verifiedAt: at.verified,
  expiresAt: at.receiptExpires,
  signature,
};

const projectionBase = {
  activationId,
  activationHash,
  snapshotId,
  rigId,
  bundleManifestSha256,
  memberLedgerSha256,
  runtimeContextHash,
  rigCharacterizationSha256,
  operatingContextHash,
  observationId,
  workstationObservationSha256,
  requestedAt: at.requested,
  pendingExpiresAt: at.pendingExpires,
  terminatedAt: null,
  priorActivationId: null,
  supersededByActivationId: null,
};

const pendingProjection = {
  ...projectionBase,
  activationRevision: pendingRevision,
  state: "PENDING",
  workstationReceiptSha256: null,
  locallyVerifiedAt: null,
  activatedAt: null,
};

const activeProjection = {
  ...projectionBase,
  activationRevision: activeRevision,
  state: "ACTIVE",
  workstationReceiptSha256,
  locallyVerifiedAt: at.verified,
  activatedAt: at.activated,
};

const activeAuthority = {
  schemaVersion: "ten-kings-ai-grader-calibration-activation-authority-v1",
  authorityPhase: "ACTIVE",
  activationId,
  activationHash,
  activationRevision: activeRevision,
  snapshotId,
  rigId,
  bundleManifestSha256,
  memberLedgerSha256,
  runtimeContextHash,
  rigCharacterizationSha256,
  operatingContextHash,
  observationId,
  workstationObservationSha256,
  workstationReceiptSha256,
  activatedAt: at.activated,
  ...hostedSignature,
  hostedAuthorityIssuedAt: at.activated,
  hostedAuthorityExpiresAt: at.activeExpires,
};

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("hosted ACTIVE local-confirm interruption converges without a second observation or hosted write", async () => {
  const routeCalls: string[] = [];
  const localConfirmBodies: unknown[] = [];
  let localObservationCalls = 0;
  let localConfirmCalls = 0;
  const localBaseUrl = "http://127.0.0.1:47652";

  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    routeCalls.push(url);
    if (url === AI_GRADER_CALIBRATION_ACTIVATION_ROUTE_MAP_V1.observe) {
      return jsonResponse({ ok: true, observationAuthority });
    }
    if (url === `${localBaseUrl}/actions/observe-calibration-activation`) {
      localObservationCalls += 1;
      return jsonResponse({
        ok: true,
        result: {
          calibrationActivation: {
            configured: true,
            state: "IDLE",
            observation: workstationObservation,
          },
        },
      });
    }
    if (url === AI_GRADER_CALIBRATION_ACTIVATION_ROUTE_MAP_V1.activate) {
      return jsonResponse({
        ok: true,
        registryRevision: hash("4"),
        activation: pendingProjection,
        pendingAuthority,
      });
    }
    if (url === `${localBaseUrl}/actions/prepare-calibration-activation`) {
      return jsonResponse({
        ok: true,
        result: {
          calibrationActivation: {
            configured: true,
            state: "PENDING",
            receipt: workstationReceipt,
          },
        },
      });
    }
    if (url === AI_GRADER_CALIBRATION_ACTIVATION_ROUTE_MAP_V1.complete) {
      return jsonResponse({
        ok: true,
        registryRevision: hash("5"),
        activation: activeProjection,
        authority: activeAuthority,
      });
    }
    if (url === `${localBaseUrl}/actions/confirm-calibration-activation`) {
      localConfirmCalls += 1;
      localConfirmBodies.push(JSON.parse(String(init?.body)));
      if (localConfirmCalls === 1) {
        throw new TypeError("simulated lost local-confirm transport response");
      }
      return jsonResponse({
        ok: true,
        result: {
          calibrationActivation: {
            configured: true,
            state: "ACTIVE",
            authority: activeAuthority,
          },
        },
      });
    }
    throw new Error(`Unexpected activation workflow route: ${url}`);
  };

  const result = await runAiGraderCalibrationActivationWorkflowV1({
    freshAdminToken: "fresh-admin-token-not-logged",
    baseUrl: localBaseUrl,
    stationToken: "station-token-not-logged",
    selection: {
      action: "activate",
      snapshot: {
        snapshotId,
        rigId,
        trustStatus: "TRUSTED",
        activationEligible: true,
        activationIneligibilityCode: null,
        profileId: "profile-v1",
        calibrationVersion: "calibration-v1",
        artifactSha256: hash("0"),
        bundleManifestSha256,
        memberLedgerSha256,
        runtimeContextHash,
        rigCharacterizationSha256,
        operatingContextHash,
        importedAt: "2026-07-23T11:00:00.000Z",
        trustedAt: "2026-07-23T11:30:00.000Z",
        revokedAt: null,
      },
      expectedRegistryRevision: registryRevision,
      reason: "Owner accepted with recorded exceptions.",
    },
    idempotencyKeyFactory: (stage) => `test-${stage}-idempotency`,
  }, fetchImpl as typeof fetch);

  assert.equal(localObservationCalls, 1, "the complete workflow performs exactly one physical observation");
  assert.equal(localConfirmCalls, 2, "one interrupted local confirmation receives one hardware-free retry");
  assert.deepEqual(localConfirmBodies, [
    { hostedCalibrationActivationAuthority: activeAuthority },
    { hostedCalibrationActivationAuthority: activeAuthority },
  ], "both local confirmations reuse the exact returned signed ACTIVE authority");
  assert.equal(
    routeCalls.filter((route) => route === AI_GRADER_CALIBRATION_ACTIVATION_ROUTE_MAP_V1.observe).length,
    1,
  );
  assert.equal(
    routeCalls.filter((route) => route === AI_GRADER_CALIBRATION_ACTIVATION_ROUTE_MAP_V1.activate).length,
    1,
  );
  assert.equal(
    routeCalls.filter((route) => route === AI_GRADER_CALIBRATION_ACTIVATION_ROUTE_MAP_V1.complete).length,
    1,
  );
  assert.equal(
    routeCalls.filter((route) => route === AI_GRADER_CALIBRATION_ACTIVATION_ROUTE_MAP_V1.fail).length,
    0,
  );
  assert.equal(result.completed.authority.activationId, activationId);
  assert.equal(result.localActive.authority?.activationId, activationId);
  assert.equal(result.completed.authority.activationRevision, activeRevision);
  assert.equal(result.localActive.authority?.activationRevision, activeRevision);
});

test("failed local observation stops before any hosted activation authority request", async () => {
  const routeCalls: string[] = [];
  const localBaseUrl = "http://127.0.0.1:47652";
  const fetchImpl = async (input: string | URL | Request) => {
    const url = String(input);
    routeCalls.push(url);
    if (url === AI_GRADER_CALIBRATION_ACTIVATION_ROUTE_MAP_V1.observe) {
      return jsonResponse({ ok: true, observationAuthority });
    }
    if (url === `${localBaseUrl}/actions/observe-calibration-activation`) {
      return new Response(JSON.stringify({
        ok: false,
        code: "AI_GRADER_LOCAL_CALIBRATION_OBSERVATION_FAILED",
        message: "Observation evidence was quarantined before activation.",
      }), {
        status: 409,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`Unexpected post-observation route: ${url}`);
  };

  await assert.rejects(
    runAiGraderCalibrationActivationWorkflowV1({
      freshAdminToken: "fresh-admin-token-not-logged",
      baseUrl: localBaseUrl,
      stationToken: "station-token-not-logged",
      selection: {
        action: "activate",
        snapshot: {
          snapshotId,
          rigId,
          trustStatus: "TRUSTED",
          activationEligible: true,
          activationIneligibilityCode: null,
          profileId: "profile-v1",
          calibrationVersion: "calibration-v1",
          artifactSha256: hash("0"),
          bundleManifestSha256,
          memberLedgerSha256,
          runtimeContextHash,
          rigCharacterizationSha256,
          operatingContextHash,
          importedAt: "2026-07-23T11:00:00.000Z",
          trustedAt: "2026-07-23T11:30:00.000Z",
          revokedAt: null,
        },
        expectedRegistryRevision: registryRevision,
        reason: "Owner accepted with recorded exceptions.",
      },
      idempotencyKeyFactory: (stage) => `failed-observation-${stage}`,
    }, fetchImpl as typeof fetch),
    (error: unknown) => error instanceof Error &&
      error.message === "Observation evidence was quarantined before activation.",
  );

  assert.equal(
    routeCalls.filter((route) => route === AI_GRADER_CALIBRATION_ACTIVATION_ROUTE_MAP_V1.observe).length,
    1,
  );
  assert.equal(
    routeCalls.filter((route) => route.endsWith("/actions/observe-calibration-activation")).length,
    1,
  );
  assert.equal(
    routeCalls.filter((route) => route === AI_GRADER_CALIBRATION_ACTIVATION_ROUTE_MAP_V1.activate).length,
    0,
  );
  assert.equal(
    routeCalls.filter((route) => route === AI_GRADER_CALIBRATION_ACTIVATION_ROUTE_MAP_V1.complete).length,
    0,
  );
  assert.equal(
    routeCalls.filter((route) => route === AI_GRADER_CALIBRATION_ACTIVATION_ROUTE_MAP_V1.fail).length,
    0,
  );
});
