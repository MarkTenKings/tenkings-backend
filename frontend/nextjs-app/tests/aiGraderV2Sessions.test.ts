import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { NextApiRequest, NextApiResponse } from "next";
import { SPEEDSTER_RULE_VERSION } from "../lib/ai-grader-v2/contracts";
import { SPEEDSTER_TRACE_PIXEL_COUNT, encodeSpeedsterTraceRleV1 } from "../lib/ai-grader-v2/trace-codec";
import { HttpError } from "../lib/server/adminSessionAuthority";
import { createAiGraderV2SessionsHandler } from "../pages/api/admin/ai-grader-v2/sessions";
import {
  createAiGraderV2SessionHandler as createAiGraderV2SessionHandlerBase,
  validateSpeedsterSubmittedMapBinding,
} from "../pages/api/admin/ai-grader-v2/sessions/[sessionId]";
import type { SpeedsterColorGeometryProposal } from "../lib/ai-grader-v2/color-geometry";
import {
  SPEEDSTER_MAP_FILTER_POLICY_VERSION,
  SPEEDSTER_MAP_FILTER_POLICY_VERSION_V2,
  SPEEDSTER_MAP_SCHEMA_VERSION,
  SPEEDSTER_MAP_SCHEMA_VERSION_V2,
  speedsterCardTypeMapKey,
  speedsterFamilyCardTypeMapKey,
  type SpeedsterMapRegistration,
} from "../lib/ai-grader-v2/card-type-map-contracts";
import {
  SpeedsterMapIntegrityError,
  parseSpeedsterMapRegistration,
  speedsterPhysicalQuadHash,
} from "../lib/server/speedsterCardTypeMaps";
import {
  issueSpeedsterMapRegistrationReceipt,
  SPEEDSTER_MAP_REGISTRATION_RECEIPT_MAX_AGE_MS,
  verifySpeedsterMapRegistrationReceipt,
} from "../lib/server/speedsterMapRegistrationAuthority";
import {
  issueSpeedsterColorGeometryReceipt,
  SpeedsterColorGeometryReceiptExpiredError,
  verifySpeedsterColorGeometryReceipt,
} from "../lib/server/speedsterColorGeometryAuthority";
import {
  fetchSpeedsterImageUpstream,
  sanitizeSpeedsterImageFailure,
  sanitizeSpeedsterTraceProposalFailure,
  sanitizeSpeedsterGeometryPayload,
  sanitizeSpeedsterPreparePayload,
  sanitizeSpeedsterColorGeometryPayload,
  parseSpeedsterRegistrationFailure,
  assertSpeedsterRegistrationCandidateAuthority,
  selectSpeedsterRegistrationLessonCandidates,
  SpeedsterImageUpstreamTimeoutError,
  speedsterServiceBody,
  speedsterServiceHeaders,
  speedsterMapRegistrationErrorEnvelope,
  classifySpeedsterMapRegistrationUpstreamFailure,
  parseSpeedsterMapRegistrationOrchestration,
  speedsterMapRegistrationAuditFailureSignal,
  speedsterMapRegistrationTimeoutEnvelope,
  settleSpeedsterMapRegistrationAuditWrite,
  resolveSpeedsterMapRegistrationOrchestration,
} from "../pages/api/admin/ai-grader-v2/image/[action]";

function request(method: string, body?: unknown, sessionId?: string): NextApiRequest {
  return {
    method,
    body,
    query: sessionId ? { sessionId } : {},
    headers: {},
  } as unknown as NextApiRequest;
}

function response() {
  const state: { status?: number; body?: unknown; allow?: string } = {};
  const res = {
    setHeader(name: string, value: string) {
      if (name === "Allow") state.allow = value;
      return this;
    },
    status(code: number) {
      state.status = code;
      return this;
    },
    json(body: unknown) {
      state.body = body;
      return this;
    },
  } as unknown as NextApiResponse;
  return { state, res };
}

const admin = async () => ({ user: { id: "admin-1" } });

const mapBindingSha = (value: string) => createHash("sha256").update(value).digest("hex");
const mapBindingQuad = [
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.9, y: 0.9 },
  { x: 0.1, y: 0.9 },
] as const;
const mapBindingV2Zone = {
  id: "zone-1",
  label: "Printed text",
  semanticType: "PRINT_TEXT" as const,
  polygon: mapBindingQuad,
  contentType: "ATTACK" as const,
  filterAuthority: true,
  filterAuthoritySource: "HUMAN_OVERRIDE" as const,
  filterPaddingMm: 0.6 as const,
  proposalSource: "HUMAN" as const,
  proposalConfidence: null,
};
const registrationReceiptEnv = {
  SPEEDSTER_MAP_REGISTRATION_RECEIPT_HMAC_KEY: "test_speedster_registration_authority_secret_0123456789",
  SPEEDSTER_MAP_REGISTRATION_RECEIPT_HMAC_KEY_ID: "test-speedster-registration-key-v1",
} as unknown as NodeJS.ProcessEnv;
process.env.SPEEDSTER_MAP_REGISTRATION_RECEIPT_HMAC_KEY = registrationReceiptEnv.SPEEDSTER_MAP_REGISTRATION_RECEIPT_HMAC_KEY;
process.env.SPEEDSTER_MAP_REGISTRATION_RECEIPT_HMAC_KEY_ID = registrationReceiptEnv.SPEEDSTER_MAP_REGISTRATION_RECEIPT_HMAC_KEY_ID;
const colorReceiptEnv = {
  SPEEDSTER_COLOR_GEOMETRY_RECEIPT_HMAC_KEY: "test_speedster_color_geometry_authority_secret_0123456789",
  SPEEDSTER_COLOR_GEOMETRY_RECEIPT_HMAC_KEY_ID: "test-speedster-color-key-v1",
} as unknown as NodeJS.ProcessEnv;

function createAiGraderV2SessionHandler(
  deps: NonNullable<Parameters<typeof createAiGraderV2SessionHandlerBase>[0]>,
) {
  return createAiGraderV2SessionHandlerBase({
    ...deps,
    hashEvidence: deps.hashEvidence ?? (async (storageKey: string) => mapBindingSha(storageKey)),
    verifyColorGeometryReceipt: deps.verifyColorGeometryReceipt ?? ((receipt, binding) => (
      verifySpeedsterColorGeometryReceipt(receipt, binding, { env: colorReceiptEnv })
    )),
  });
}

const colorResult = (
  mode: "PHYSICAL_OUTER" | "PRINTED_FRAME",
  matColor: "BLACK" | "WHITE",
): SpeedsterColorGeometryProposal => ({
  version: "speedster-color-geometry-proposal-v1",
  engineVersion: "speedster-color-geometry-v2",
  authority: "PROPOSER_ONLY",
  policyProvenance: "OWNER_APPROVED_VISIBLE_OUTLINE_V2",
  mode,
  outcome: "ACCEPTED",
  matColor,
  proposal: mapBindingQuad,
  contrastFloorDeltaE: mode === "PHYSICAL_OUTER" ? 18 : 12,
  minimumSideSupport: mode === "PHYSICAL_OUTER" ? 0.7 : 0.55,
  sideEvidence: Object.fromEntries(["top", "right", "bottom", "left"].map((side) => [side, {
    medianContrastDeltaE: 30,
    medianLightnessContrast: 30,
    supportFraction: 0.8,
    sampleCount: 33,
    candidateCount: 1,
    ambiguous: false,
  }])) as SpeedsterColorGeometryProposal["sideEvidence"],
  ambiguity: { candidateCount: 1, runnerUpScoreRatio: null, ambiguous: false },
  advisory: null,
});

function mapBindingFixture() {
  const sessionId = "speedster-map-binding-0001";
  const side = (name: "front" | "back") => {
    const prefix = `ai-grader-v2/admin-1/${sessionId}/prepared/${name}`;
    const sideName = name === "front" ? "FRONT" as const : "BACK" as const;
    const matColor = name === "front" ? "BLACK" as const : "WHITE" as const;
    const originalStorageKey = `ai-grader-v2/admin-1/${sessionId}/original/${name}.jpg`;
    const evidence = (mode: "PHYSICAL_OUTER" | "PRINTED_FRAME") => {
      const result = colorResult(mode, matColor);
      return {
        side: sideName,
        sourceImageStorageKey: originalStorageKey,
        mode,
        matColor,
        result,
        serverReceipt: issueSpeedsterColorGeometryReceipt({
          operatorAdminId: "admin-1",
          sessionId,
          side: sideName,
          mode,
          sourceImageStorageKey: originalStorageKey,
          sourceImageSha256: mapBindingSha(originalStorageKey),
          matColor,
          physicalQuadSha256: mode === "PRINTED_FRAME" ? speedsterPhysicalQuadHash(mapBindingQuad) : null,
          result,
        }, { env: colorReceiptEnv }),
        confirmedQuad: mapBindingQuad,
      };
    };
    return {
      originalStorageKey,
      rectifiedStorageKey: `${prefix}/rectified.webp`,
      inspectionStorageKey: `${prefix}/inspection.webp`,
      sourceCorners: mapBindingQuad,
      centeringQuad: mapBindingQuad,
      centeringBorders: { leftMm: 6, rightMm: 6, topMm: 8, bottomMm: 8 },
      inspectionFrame: { width: 1350, height: 1858, cardBounds: { x: 40, y: 40, width: 1270, height: 1778 } },
      transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      viewStorageKeys: {
        NORMALIZED: `${prefix}/normalized.webp`,
        MICRO_DEFECT: `${prefix}/micro_defect.webp`,
        DIRECTIONAL: `${prefix}/directional.webp`,
      },
      colorGeometryEvidence: [evidence("PHYSICAL_OUTER"), evidence("PRINTED_FRAME")],
    };
  };
  const capture = { cornerShape: "ROUNDED_3_18_MM", front: side("front"), back: side("back") };
  const session = {
    id: sessionId,
    createdByUserId: "admin-1",
    cardProfile: "SPORTS",
    workflowState: "DRAFT",
    updatedAt: new Date("2026-08-18T12:00:00.000Z"),
    identity: {
      playerName: "Nick Bosa",
      year: "2021",
      manufacturer: "Panini",
      productSet: "Obsidian",
      parallel: "Orange",
      insert: null,
      cardNumber: "12",
    },
  };
  const registration = (name: "front" | "back") => ({
    version: "opencv-human-anchor-registration-v1" as const,
    side: (name === "front" ? "FRONT" : "BACK") as "FRONT" | "BACK",
    mapRevisionId: "map-revision-1",
    currentPhysicalQuadSha256: speedsterPhysicalQuadHash(mapBindingQuad),
    currentInspectionSha256: mapBindingSha(capture[name].inspectionStorageKey),
    homography: [1, 0, 0, 0, 1, 0, 0, 0, 1] as const,
    anchors: [1, 2, 3, 4].map((number) => ({
      anchorId: `anchor-${number}`,
      expectedPoint: { x: number % 2 ? 0.2 : 0.8, y: number < 3 ? 0.2 : 0.8 },
      locatedPoint: { x: number % 2 ? 0.2 : 0.8, y: number < 3 ? 0.2 : 0.8 },
      score: 1,
    })),
    projectedDesignBoundary: { kind: "QUAD" as const, points: mapBindingQuad },
    projectedZones: [mapBindingV2Zone],
  });
  const frontRegistration = registration("front");
  const backRegistration = registration("back");
  const authorize = (candidate: ReturnType<typeof registration>) => ({
    ...candidate,
    serverReceipt: issueSpeedsterMapRegistrationReceipt({
      operatorAdminId: "admin-1",
      sessionId,
      registration: candidate as SpeedsterMapRegistration,
      env: registrationReceiptEnv,
    }),
  });
  return {
    sessionId,
    session,
    capture,
    binding: {
      revisionId: "map-revision-1",
      filterPolicyVersion: SPEEDSTER_MAP_FILTER_POLICY_VERSION_V2,
      registration: { front: authorize(frontRegistration), back: authorize(backRegistration) },
    },
  };
}

function appliedMapFixture(
  fixture: ReturnType<typeof mapBindingFixture>,
  appliedScope: "EXACT" | "FAMILY" = "EXACT",
  schemaVersion: "V1" | "V2" = "V2",
) {
  const identity = fixture.session.identity;
  const matchKey = appliedScope === "EXACT"
    ? speedsterCardTypeMapKey("SPORTS", identity)
    : speedsterFamilyCardTypeMapKey("SPORTS", identity);
  const mapSide = (side: "FRONT" | "BACK") => ({
    side,
    designBoundary: { kind: "QUAD", points: mapBindingQuad },
    anchors: [1, 2, 3, 4].map((number) => ({
      id: `anchor-${number}`,
      point: { x: number % 2 ? 0.2 : 0.8, y: number < 3 ? 0.2 : 0.8 },
    })),
    zones: schemaVersion === "V2" ? [mapBindingV2Zone] : [{
      id: "zone-1",
      label: "Printed text",
      semanticType: "PRINT_TEXT",
      polygon: mapBindingQuad,
    }],
  });
  return {
    appliedScope,
    appliedMapName: appliedScope === "EXACT"
      ? "2021 Panini Obsidian Orange · Nick Bosa #12"
      : "2021 Panini Obsidian Orange",
    revision: {
      mapId: "map-12345678901234567890",
      revisionId: fixture.binding.revisionId,
      version: 1,
      revisionHash: mapBindingSha(fixture.binding.revisionId),
      matchKeyHash: mapBindingSha(JSON.stringify(matchKey)),
      matchKey,
      mapSchemaVersion: schemaVersion === "V2"
        ? SPEEDSTER_MAP_SCHEMA_VERSION_V2
        : SPEEDSTER_MAP_SCHEMA_VERSION,
      filterPolicyVersion: schemaVersion === "V2"
        ? SPEEDSTER_MAP_FILTER_POLICY_VERSION_V2
        : SPEEDSTER_MAP_FILTER_POLICY_VERSION,
      frontMap: mapSide("FRONT"),
      backMap: mapSide("BACK"),
    },
    sourceProvenance: {
      sourceSessionId: "source-session-1234567890",
      sourceIdentity: identity,
    },
  } as never;
}

function v2Registration(
  legacy: ReturnType<typeof mapBindingFixture>["binding"]["registration"]["front"],
  provenance: Readonly<{
    candidateId: string;
    source: "ORIGINAL_REFERENCE" | "REGISTRATION_LESSON" | "HUMAN_CORRECTION";
    lessonId?: string;
  }> = { candidateId: "original-reference", source: "ORIGINAL_REFERENCE" },
): SpeedsterMapRegistration {
  const human = provenance.source === "HUMAN_CORRECTION";
  const { serverReceipt: _legacyReceipt, ...unsignedLegacy } = legacy;
  return {
    ...unsignedLegacy,
    version: "opencv-redundant-ransac-registration-v2" as const,
    candidateProvenance: provenance,
    acceptance: human ? {
      policyVersion: "speedster-map-registration-acceptance-v2" as const,
      mode: "HUMAN_CONFIRMED" as const,
      featureCount: 4,
      usableFeatureCount: 4,
      inlierCount: 4,
      inlierFraction: 1,
      perAnchorFeatureCounts: [1, 1, 1, 1] as const,
      perAnchorInlierCounts: [1, 1, 1, 1] as const,
      medianReprojectionErrorPx: 0,
      maxReprojectionErrorPx: 0,
    } : {
      policyVersion: "speedster-map-registration-acceptance-v2" as const,
      mode: "AUTOMATIC_RANSAC" as const,
      featureCount: 16,
      usableFeatureCount: 12,
      inlierCount: 10,
      inlierFraction: 10 / 12,
      perAnchorFeatureCounts: [3, 3, 3, 3] as const,
      perAnchorInlierCounts: [2, 2, 3, 3] as const,
      medianReprojectionErrorPx: 0.8,
      maxReprojectionErrorPx: 2.4,
    },
  } as SpeedsterMapRegistration;
}

function authorizedV2Binding(
  fixture: ReturnType<typeof mapBindingFixture>,
  provenance?: Parameters<typeof v2Registration>[1],
  now = 10_000,
) {
  const front = v2Registration(fixture.binding.registration.front, provenance);
  const back = v2Registration(fixture.binding.registration.back, provenance);
  return {
    ...fixture.binding,
    registration: {
      front: {
        ...front,
        serverReceipt: issueSpeedsterMapRegistrationReceipt({
          operatorAdminId: "admin-1", sessionId: fixture.sessionId,
          registration: front, now, env: registrationReceiptEnv,
        }),
      },
      back: {
        ...back,
        serverReceipt: issueSpeedsterMapRegistrationReceipt({
          operatorAdminId: "admin-1", sessionId: fixture.sessionId,
          registration: back, now, env: registrationReceiptEnv,
        }),
      },
    },
  };
}

function authorizedEnrichedV2HumanBinding(
  fixture: ReturnType<typeof mapBindingFixture>,
  now = 60_000,
) {
  const signedSide = (side: "front" | "back", lessonId: string) => {
    const registration = parseSpeedsterMapRegistration(v2Registration(
      fixture.binding.registration[side],
      { candidateId: lessonId, source: "HUMAN_CORRECTION", lessonId },
    ), {
      side: side === "front" ? "FRONT" : "BACK",
      mapRevisionId: fixture.binding.revisionId,
      zones: [mapBindingV2Zone],
    });
    return {
      ...registration,
      serverReceipt: issueSpeedsterMapRegistrationReceipt({
        operatorAdminId: "admin-1",
        sessionId: fixture.sessionId,
        registration,
        now,
        env: registrationReceiptEnv,
      }),
    };
  };
  return {
    revisionId: fixture.binding.revisionId,
    filterPolicyVersion: SPEEDSTER_MAP_FILTER_POLICY_VERSION_V2,
    registration: {
      front: signedSide("front", "lesson-front-v2"),
      back: signedSide("back", "lesson-back-v2"),
    },
  };
}

const receiptVerifierAt = (now: number) => (
  input: Parameters<typeof verifySpeedsterMapRegistrationReceipt>[0]
) => verifySpeedsterMapRegistrationReceipt({ ...input, now, env: registrationReceiptEnv });

test("geometry proxy rejects automatic handles outside the exact source boundary", () => {
  assert.throws(() => sanitizeSpeedsterGeometryPayload({
    width: 1200,
    height: 1600,
    corners: [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.9, y: 0.9 },
      { x: -0.3, y: 1.4 },
    ],
  }), /invalid perimeter quad/);
});

test("proxy rejects accepted color authority when returned geometry differs from its proposal", () => {
  const differentQuad = [
    ...mapBindingQuad.slice(0, 3),
    { x: 0.2, y: 0.9 },
  ];
  const physical = colorResult("PHYSICAL_OUTER", "BLACK");
  const printed = colorResult("PRINTED_FRAME", "WHITE");
  assert.deepEqual(sanitizeSpeedsterGeometryPayload({
    corners: mapBindingQuad,
    colorGeometry: physical,
  }, { mode: "PHYSICAL_OUTER", matColor: "BLACK" }), {
    corners: mapBindingQuad,
    colorGeometry: physical,
  });
  assert.throws(
    () => sanitizeSpeedsterGeometryPayload({
      corners: differentQuad,
      colorGeometry: physical,
    }, { mode: "PHYSICAL_OUTER", matColor: "BLACK" }),
    /does not match its accepted color proposal/,
  );
  for (const outcome of ["INSUFFICIENT_EVIDENCE", "NOT_APPLICABLE", "ABSTAIN"] as const) {
    assert.throws(
      () => sanitizeSpeedsterGeometryPayload({
        corners: mapBindingQuad,
        colorGeometry: { ...physical, outcome, proposal: null },
      }, { mode: "PHYSICAL_OUTER", matColor: "BLACK" }),
      /corners contradict the Color outcome authority/,
    );
  }
  assert.deepEqual(sanitizeSpeedsterPreparePayload({
    borders: mapBindingQuad,
    colorGeometry: printed,
  }, { matColor: "WHITE" }), {
    borders: mapBindingQuad,
    colorGeometry: printed,
  });
  assert.throws(
    () => sanitizeSpeedsterPreparePayload({
      borders: differentQuad,
      colorGeometry: printed,
    }, { matColor: "WHITE" }),
    /does not match its accepted color proposal/,
  );
  const retiredPrinted = {
    ...printed,
    engineVersion: "speedster-color-geometry-v1",
    policyProvenance: "OWNER_APPROVED_OFFLINE_ESTIMATE_V1_NOT_LIVE_CALIBRATED",
  } as SpeedsterColorGeometryProposal;
  assert.throws(
    () => sanitizeSpeedsterPreparePayload({
      borders: mapBindingQuad,
      colorGeometry: retiredPrinted,
    }, { matColor: "WHITE" }),
    /retired Color Geometry engine.*no old-engine result was accepted/i,
  );
});

test("color geometry proxy replaces browser URLs and binds exact image bytes plus rectification quad", async () => {
  const fixture = mapBindingFixture();
  const sourceGeneration = `iphone-v4-sha256-${"1".repeat(64)}`;
  const sourceImageStorageKey = `ai-grader-v2/admin-1/${fixture.sessionId}/original/${sourceGeneration}/back.jpg`;
  const body = await speedsterServiceBody("prepare", {
    sessionId: fixture.sessionId,
    side: "BACK",
    imageUrl: "https://browser-controlled.example/ignore.jpg",
    sourceImageStorageKey,
    matColor: "WHITE",
    corners: mapBindingQuad,
  }, "admin-1", {
    async findOwnedCapture() { return null; },
    async findOwnedMapSession() { return fixture.session; },
    async presignRead(storageKey) { return `https://server-read.example/${storageKey}`; },
    async presignUpload(storageKey) { return `https://server-upload.example/${storageKey}`; },
    async hashMapEvidence(storageKey) { return mapBindingSha(storageKey); },
  });
  assert.equal(body.imageUrl, `https://server-read.example/${sourceImageStorageKey}`);
  assert.equal(body.sessionId, undefined);
  assert.deepEqual(body.corners, mapBindingQuad);
  assert.deepEqual(body.outputUploads, {
    rectified: `https://server-upload.example/ai-grader-v2/admin-1/${fixture.sessionId}/prepared/back/${sourceGeneration}/rectified.webp`,
    inspection: `https://server-upload.example/ai-grader-v2/admin-1/${fixture.sessionId}/prepared/back/${sourceGeneration}/inspection.webp`,
    normalized: `https://server-upload.example/ai-grader-v2/admin-1/${fixture.sessionId}/prepared/back/${sourceGeneration}/normalized.webp`,
    microDefect: `https://server-upload.example/ai-grader-v2/admin-1/${fixture.sessionId}/prepared/back/${sourceGeneration}/micro_defect.webp`,
    directional: `https://server-upload.example/ai-grader-v2/admin-1/${fixture.sessionId}/prepared/back/${sourceGeneration}/directional.webp`,
  });
  let hostilePresigns = 0;
  await assert.rejects(() => speedsterServiceBody("prepare", {
    sessionId: fixture.sessionId,
    side: "BACK",
    sourceImageStorageKey,
    matColor: "WHITE",
    corners: mapBindingQuad,
    outputUploads: { rectified: "https://browser-controlled.example/old-put" },
  }, "admin-1", {
    async findOwnedCapture() { return null; },
    async findOwnedMapSession() { return fixture.session; },
    async presignRead() { hostilePresigns += 1; return "unexpected"; },
    async presignUpload() { hostilePresigns += 1; return "unexpected"; },
    async hashMapEvidence() { hostilePresigns += 1; return mapBindingSha(sourceImageStorageKey); },
  }), /Browser-selected.*destinations are not accepted/);
  assert.equal(hostilePresigns, 0);
  assert.deepEqual(body.colorGeometryAuthorityBinding, {
    sessionId: fixture.sessionId,
    side: "BACK",
    mode: "PRINTED_FRAME",
    sourceImageStorageKey,
    sourceImageSha256: mapBindingSha(sourceImageStorageKey),
    matColor: "WHITE",
    physicalQuadSha256: speedsterPhysicalQuadHash(mapBindingQuad),
  });
});

test("targeted color recovery is read-only and binds the exact original plus preserved physical quad", async () => {
  const fixture = mapBindingFixture();
  const sourceImageStorageKey = `ai-grader-v2/admin-1/${fixture.sessionId}/original/iphone-v4-sha256-${"2".repeat(64)}/front.jpg`;
  const deps = {
    async findOwnedCapture() { return null; },
    async findOwnedMapSession() { return fixture.session; },
    async presignRead(storageKey: string) { return `https://server-read.example/${storageKey}`; },
    async hashMapEvidence(storageKey: string) { return mapBindingSha(storageKey); },
  };
  const physical = await speedsterServiceBody("color-geometry", {
    sessionId: fixture.sessionId,
    side: "FRONT",
    sourceImageStorageKey,
    mode: "PHYSICAL_OUTER",
    matColor: "BLACK",
    corners: mapBindingQuad,
  }, "admin-1", deps);
  assert.deepEqual(physical, {
    imageUrl: `https://server-read.example/${sourceImageStorageKey}`,
    matColor: "BLACK",
    mode: "PHYSICAL_OUTER",
    colorGeometryAuthorityBinding: {
      sessionId: fixture.sessionId,
      side: "FRONT",
      mode: "PHYSICAL_OUTER",
      sourceImageStorageKey,
      sourceImageSha256: mapBindingSha(sourceImageStorageKey),
      matColor: "BLACK",
      physicalQuadSha256: null,
    },
  });
  const printed = await speedsterServiceBody("color-geometry", {
    sessionId: fixture.sessionId,
    side: "FRONT",
    sourceImageStorageKey,
    mode: "PRINTED_FRAME",
    matColor: "BLACK",
    corners: mapBindingQuad,
  }, "admin-1", deps);
  assert.equal(printed.imageUrl, `https://server-read.example/${sourceImageStorageKey}`);
  assert.deepEqual(printed.corners, mapBindingQuad);
  assert.equal(printed.outputUploads, undefined, "targeted recovery must not write or plan prepared artifacts");
  assert.deepEqual((printed.colorGeometryAuthorityBinding as Record<string, unknown>).physicalQuadSha256, speedsterPhysicalQuadHash(mapBindingQuad));

  const accepted = colorResult("PRINTED_FRAME", "BLACK");
  assert.deepEqual(sanitizeSpeedsterColorGeometryPayload({ colorGeometry: accepted }, {
    mode: "PRINTED_FRAME",
    matColor: "BLACK",
  }), { colorGeometry: accepted });
  assert.throws(() => sanitizeSpeedsterColorGeometryPayload({
    colorGeometry: colorResult("PHYSICAL_OUTER", "BLACK"),
  }, { mode: "PRINTED_FRAME", matColor: "BLACK" }), /proposal identity is malformed/i);
});

test("image proxy deadline rejects a non-cooperative late response body", async () => {
  let aborted = false;
  const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => ({
    ok: true,
    status: 200,
    json: () => new Promise((resolve) => {
      init?.signal?.addEventListener("abort", () => {
        aborted = true;
      }, { once: true });
      setTimeout(() => resolve({ corners: [] }), 25);
    }),
  } as Response)) as typeof fetch;

  await assert.rejects(
    fetchSpeedsterImageUpstream({
      url: "https://speedster.example.test/geometry",
      action: "geometry",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      timeoutMs: 10,
      fetchImpl,
    }),
    (error: unknown) => error instanceof SpeedsterImageUpstreamTimeoutError
      && error.action === "geometry"
      && error.timeoutMs === 10,
  );
  assert.equal(aborted, true);
});

test("map-registration uses the same server deadline and late completion cannot reach lesson persistence", async () => {
  let lateBodyCompleted = false;
  let completeLateBody!: () => void;
  const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => ({
    ok: true,
    status: 200,
    json: () => new Promise((resolve) => {
      init?.signal?.addEventListener("abort", () => undefined, { once: true });
      completeLateBody = () => { lateBodyCompleted = true; resolve({ accepted: true }); };
    }),
  } as Response)) as typeof fetch;
  await assert.rejects(fetchSpeedsterImageUpstream({
    url: "https://speedster.example.test/map-registration",
    action: "map-registration",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    timeoutMs: 10,
    fetchImpl,
  }), (error: unknown) => error instanceof SpeedsterImageUpstreamTimeoutError
    && error.action === "map-registration");
  completeLateBody();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lateBodyCompleted, true, "the test upstream deliberately ignores abort and completes late");
  const source = readFileSync(fileURLToPath(new URL("../pages/api/admin/ai-grader-v2/image/[action].ts", import.meta.url)), "utf8");
  assert.match(source, /action === "geometry" \|\| action === "color-geometry" \|\| action === "map-registration"/);
  assert.ok(source.indexOf("fetchSpeedsterImageUpstream") < source.indexOf("persistSpeedsterRegistrationLesson({"));
});

test("non-trace upstream failures redact private URLs and credentials", () => {
  assert.deepEqual(sanitizeSpeedsterImageFailure({
    detail: "requests failed for https://signed.example/object?token=secret Bearer sk-secret12345678",
  }, "geometry", "geometry-request-123"), {
    message: "Speedster geometry failed: requests failed for [redacted-url] Bearer [redacted-credential] (request geometry-request-123).",
    requestId: "geometry-request-123",
  });
});

test("registration error envelope exposes only bounded retry classification and request evidence", () => {
  assert.deepEqual(speedsterMapRegistrationErrorEnvelope({
    source: "PROVIDER_GATEWAY",
    code: "PROVIDER_GATEWAY_HTTP_503",
    httpStatus: 503,
    retryable: true,
    requestId: "registration-request-503",
  }), {
    version: "speedster-map-registration-error-v1",
    source: "PROVIDER_GATEWAY",
    code: "PROVIDER_GATEWAY_HTTP_503",
    httpStatus: 503,
    retryable: true,
    requestId: "registration-request-503",
  });
});

test("server registration upstream classification is factual and retries only automatic 502/503", () => {
  const requestId = "registration-request-402";
  const paymentRequired = classifySpeedsterMapRegistrationUpstreamFailure({
    status: 402,
    mode: "AUTOMATIC",
    requestId,
  });
  assert.deepEqual(paymentRequired, {
    source: "PROVIDER",
    code: "PROVIDER_HTTP_402",
    retryable: false,
    message: "CARD MAP provider rejected the request (HTTP 402) (request registration-request-402). No map was applied.",
    registrationError: {
      version: "speedster-map-registration-error-v1",
      source: "PROVIDER",
      code: "PROVIDER_HTTP_402",
      httpStatus: 402,
      retryable: false,
      requestId,
    },
  });
  assert.doesNotMatch(paymentRequired.message, /fund|balance|credit/i);

  for (const status of [502, 503]) {
    const gateway = classifySpeedsterMapRegistrationUpstreamFailure({ status, mode: "AUTOMATIC", requestId });
    assert.equal(gateway.source, "PROVIDER_GATEWAY");
    assert.equal(gateway.code, `PROVIDER_GATEWAY_HTTP_${status}`);
    assert.equal(gateway.retryable, true);
    assert.equal(gateway.registrationError.retryable, true);
  }
  assert.equal(classifySpeedsterMapRegistrationUpstreamFailure({
    status: 503,
    mode: "HUMAN_RESCUE",
    requestId,
  }).retryable, false, "human rescue is never automatically retried");
  for (const status of [408, 409, 429, 500, 504]) {
    const nonGateway = classifySpeedsterMapRegistrationUpstreamFailure({ status, mode: "AUTOMATIC", requestId });
    assert.equal(nonGateway.source, "PROVIDER");
    assert.equal(nonGateway.retryable, false);
  }
  assert.deepEqual(speedsterMapRegistrationTimeoutEnvelope(requestId), {
    version: "speedster-map-registration-error-v1",
    source: "PROVIDER",
    code: "PROVIDER_TIMEOUT",
    httpStatus: 504,
    retryable: false,
    requestId,
  });
});

test("server audit failure signal is sanitized, visible to the client, and non-gating", () => {
  assert.deepEqual(speedsterMapRegistrationAuditFailureSignal("registration-request-audit-1"), {
    headerValue: "write-failed",
    responseFields: {
      registrationAuditWarning: {
        status: "WRITE_FAILED",
        requestId: "registration-request-audit-1",
      },
    },
  });
});

test("registration orchestration accepts only bounded exact metadata", () => {
  const valid = {
    operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    attemptNumber: 1,
    trigger: "INITIAL",
    successfulSiblingPreservedAtAttemptStart: false,
  } as const;
  assert.deepEqual(parseSpeedsterMapRegistrationOrchestration(valid), valid);
  for (const invalid of [
    { ...valid, operationId: "not-a-uuid" },
    { ...valid, attemptNumber: 0 },
    { ...valid, attemptNumber: 51 },
    { ...valid, trigger: "SILENT_FALLBACK" },
    { ...valid, successfulSiblingPreservedAtAttemptStart: "false" },
    { ...valid, extra: true },
    (({ trigger: _trigger, ...missing }) => missing)(valid),
  ]) {
    assert.throws(() => parseSpeedsterMapRegistrationOrchestration(invalid), /orchestration metadata is invalid/);
  }
});

test("registration attempt audit deadline is fail-open for a never-settling writer and handles late rejection", async () => {
  assert.equal(await settleSpeedsterMapRegistrationAuditWrite(
    () => new Promise(() => {}),
    5,
  ), "TIMED_OUT");

  let rejectLate: ((reason: Error) => void) | undefined;
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    assert.equal(await settleSpeedsterMapRegistrationAuditWrite(
      () => new Promise((_resolve, reject) => { rejectLate = reject; }),
      5,
    ), "TIMED_OUT");
    rejectLate?.(new Error("late audit failure"));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("missing stale-client orchestration fails clearly instead of synthesizing compatibility metadata", () => {
  assert.throws(() => resolveSpeedsterMapRegistrationOrchestration(
    undefined,
    "AUTOMATIC",
    "11111111-1111-4111-8111-111111111111",
  ), /stale.*Refresh.*no compatibility geometry was synthesized/i);
  assert.equal(resolveSpeedsterMapRegistrationOrchestration(
    {
      operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      attemptNumber: 1,
      trigger: "INITIAL",
      successfulSiblingPreservedAtAttemptStart: false,
    },
    "AUTOMATIC",
    "11111111-1111-4111-8111-111111111111",
  ).orchestrationMetadataSource, "CLIENT_REPORTED");
});

test("POST creates one compact draft with server-owned rule and creator identity", async () => {
  let saved: Record<string, unknown> | undefined;
  const handler = createAiGraderV2SessionsHandler({
    requireAdminSession: admin,
    async createSession(data) {
      saved = data;
      return { id: "speedster-1", ...data };
    },
  });
  const { state, res } = response();

  await handler(
    request("POST", {
      cardProfile: "POKEMON",
      identity: {
        cardName: "  Charizard  ",
        layoutType: "POKEMON",
        year: "1999",
        productSet: "Base Set",
        parallel: "Holo",
        cardNumber: "4/102",
      },
    }),
    res,
  );

  assert.equal(state.status, 201);
  assert.equal(saved?.createdByUserId, "admin-1");
  assert.equal(saved?.workflowState, "DRAFT");
  assert.equal(saved?.ruleVersion, SPEEDSTER_RULE_VERSION);
  assert.deepEqual(saved?.identity, {
    cardName: "Charizard",
    layoutType: "POKEMON",
    year: "1999",
    productSet: "Base Set",
    parallel: "Holo",
    cardNumber: "4/102",
  });
  assert.deepEqual(saved?.capture, {});
  assert.deepEqual(saved?.reviewedDefects, []);
  assert.deepEqual(saved?.gradeReport, {});
});

test("POST creates a Sports draft with only category-valid identity fields", async () => {
  let saved: Record<string, unknown> | undefined;
  const handler = createAiGraderV2SessionsHandler({
    requireAdminSession: admin,
    async createSession(data) { saved = data; return data; },
  });
  const { state, res } = response();
  await handler(request("POST", {
    cardProfile: "SPORTS",
    identity: {
      playerName: "Victor Wembanyama",
      year: "2023",
      manufacturer: "Panini",
      productSet: "Prizm",
      parallel: null,
      insert: "Rookie",
      cardNumber: "136",
    },
  }), res);
  assert.equal(state.status, 201);
  assert.deepEqual(saved?.identity, {
    playerName: "Victor Wembanyama",
    year: "2023",
    manufacturer: "Panini",
    productSet: "Prizm",
    parallel: null,
    insert: "Rookie",
    cardNumber: "136",
  });
  assert.equal(JSON.stringify(saved?.identity).includes("cardName"), false);
});

test("POST rejects inactive category fields and arbitrary identity keys before persistence", async () => {
  let calls = 0;
  const handler = createAiGraderV2SessionsHandler({
    requireAdminSession: admin,
    async createSession() { calls += 1; return {}; },
  });
  const attempts = [
    {
      cardProfile: "SPORTS",
      identity: {
        playerName: "Nick Bosa",
        cardName: "stale pokemon value",
        year: "2021",
        manufacturer: "Panini",
        productSet: "Obsidian",
      },
    },
    {
      cardProfile: "POKEMON",
      identity: {
        cardName: "Charizard",
        playerName: "stale sports value",
        year: "1999",
        productSet: "Base Set",
      },
    },
    {
      cardProfile: "POKEMON",
      identity: {
        cardName: "Charizard",
        year: "1999",
        productSet: "Base Set",
        manufacturer: "forbidden",
      },
    },
    {
      cardProfile: "POKEMON",
      identity: {
        cardName: "Charizard",
        year: "1999",
        productSet: "Base Set",
        centeringGrade: "10",
      },
    },
  ];
  for (const body of attempts) {
    const { state, res } = response();
    await handler(request("POST", body), res);
    assert.equal(state.status, 400);
  }
  assert.equal(calls, 0);
});

test("POST accepts only the two Speedster card profiles", async () => {
  let calls = 0;
  const handler = createAiGraderV2SessionsHandler({
    requireAdminSession: admin,
    async createSession() {
      calls += 1;
      return {};
    },
  });
  const { state, res } = response();

  await handler(request("POST", { cardProfile: "BASEBALL" }), res);

  assert.equal(state.status, 400);
  assert.equal(calls, 0);
});

test("POST cannot inject capture, reviewed findings, or grade authority into a draft", async () => {
  let calls = 0;
  const handler = createAiGraderV2SessionsHandler({
    requireAdminSession: admin,
    async createSession() {
      calls += 1;
      return {};
    },
  });

  for (const injected of [
    { capture: { cornerShape: "SQUARE" } },
    { reviewedDefects: [{ id: "browser-owned" }] },
    { gradeReport: { detectorVersion: "browser-owned" } },
  ]) {
    const { state, res } = response();
    await handler(request("POST", { cardProfile: "POKEMON", ...injected }), res);
    assert.equal(state.status, 400);
  }
  assert.equal(calls, 0);
});

test("POST requires the existing admin session", async () => {
  let calls = 0;
  const handler = createAiGraderV2SessionsHandler({
    async requireAdminSession() {
      throw new HttpError(401, "Missing or invalid Authorization header");
    },
    async createSession() {
      calls += 1;
      return {};
    },
  });
  const { state, res } = response();

  await handler(request("POST", { cardProfile: "SPORTS" }), res);

  assert.equal(state.status, 401);
  assert.equal(calls, 0);
});

test("GET returns one V2 session after admin authentication", async () => {
  let authenticated = false;
  const existing = { id: "speedster-1", publicReportSlug: null };
  const handler = createAiGraderV2SessionHandler({
    async requireAdminSession() {
      authenticated = true;
      return { user: { id: "admin-1" } };
    },
    async findSession(id, createdByUserId) {
      assert.equal(authenticated, true);
      assert.equal(id, "speedster-1");
      assert.equal(createdByUserId, "admin-1");
      return existing;
    },
    async updateSession() {
      throw new Error("not used");
    },
  });
  const { state, res } = response();

  await handler(request("GET", undefined, "speedster-1"), res);

  assert.equal(state.status, 200);
  assert.deepEqual(state.body, { session: existing });
});

test("generic PATCH rejects client-owned reviewedDefects and gradeReport authority", async () => {
  let update: Record<string, unknown> | undefined;
  const handler = createAiGraderV2SessionHandler({
    requireAdminSession: admin,
    async findSession() {
      return { id: "speedster-1", publicReportSlug: null };
    },
    async updateSession(id, createdByUserId, data) {
      assert.equal(id, "speedster-1");
      assert.equal(createdByUserId, "admin-1");
      update = data;
      return { id, ...data };
    },
  });
  const { state, res } = response();

  await handler(
    request("PATCH", { reviewedDefects: [{ id: "defect-1", reviewResult: "ACCEPTED" }] }, "speedster-1"),
    res,
  );

  assert.equal(state.status, 400);
  assert.equal(update, undefined);
});

test("generic PATCH permits only the DRAFT to CAPTURED transition with required capture", async () => {
  const attempts = [
    { workflowState: "REVIEWED", capture: {} },
    { workflowState: "CAPTURED" },
    { workflowState: "CAPTURED", capture: {}, identity: { cardName: "bypass" } },
    { cardProfile: "SPORTS" },
    { publicReportSlug: "client-owned" },
  ];
  for (const body of attempts) {
    let updateCalls = 0;
    const handler = createAiGraderV2SessionHandler({
      requireAdminSession: admin,
      async findSession() {
        return { id: "speedster-1", publicReportSlug: null, workflowState: "DRAFT", reviewedDefects: [] };
      },
      async updateSession() { updateCalls += 1; return {}; },
    });
    const result = response();
    await handler(request("PATCH", body, "speedster-1"), result.res);
    assert.equal(result.state.status, 400, JSON.stringify(body));
    assert.equal(updateCalls, 0, JSON.stringify(body));
  }
});

test("capture PATCH accepts an exact active-map registration bound to submitted quads and server-hashed inspections", async () => {
  const fixture = mapBindingFixture();
  const submittedCapture = {
    ...fixture.capture,
    serverReceipt: "browser-injected-capture-field",
    unknownBrowserField: { accepted: true },
    front: { ...fixture.capture.front, serverReceipt: "browser-injected-side-field" },
  };
  const hashedKeys: string[] = [];
  const saves: Record<string, unknown>[] = [];
  let savedColorRows: readonly Record<string, unknown>[] = [];
  let events: readonly { eventType: string; details?: unknown }[] = [];
  const handler = createAiGraderV2SessionHandler({
    requireAdminSession: admin,
    async findSession() { return fixture.session; },
    async validateMapBinding(session, binding, capture) {
      return validateSpeedsterSubmittedMapBinding(session, binding, capture, {
        async loadActiveMap() { return appliedMapFixture(fixture); },
        async hashEvidence(storageKey) {
          hashedKeys.push(storageKey);
          return mapBindingSha(storageKey);
        },
      });
    },
    async updateSession(_id, _createdByUserId, data, colorRows) {
      saves.push(data as unknown as Record<string, unknown>);
      savedColorRows = colorRows as readonly Record<string, unknown>[];
      return { ...fixture.session, ...data };
    },
    async recordInstrumentation(input) { events = input; },
  });
  const result = response();
  await handler(request("PATCH", {
    workflowState: "CAPTURED",
    capture: submittedCapture,
    mapBinding: fixture.binding,
  }, fixture.sessionId), result.res);
  assert.equal(result.state.status, 200);
  assert.deepEqual(hashedKeys.sort(), [
    fixture.capture.front.inspectionStorageKey,
    fixture.capture.back.inspectionStorageKey,
  ].sort());
  assert.equal(saves[0]?.mapRevisionId, fixture.binding.revisionId);
  assert.equal(saves[0]?.mapFilterPolicyVersion, SPEEDSTER_MAP_FILTER_POLICY_VERSION_V2);
  const canonicalCapture = structuredClone(fixture.capture);
  delete (canonicalCapture.front as { colorGeometryEvidence?: unknown }).colorGeometryEvidence;
  delete (canonicalCapture.back as { colorGeometryEvidence?: unknown }).colorGeometryEvidence;
  const savedCapture = saves[0]?.capture as typeof canonicalCapture & {
    mapAuthority?: {
      current?: {
        status?: string;
        revision?: { revisionId?: string; revisionHash?: string; version?: number; scope?: string };
      };
    };
  };
  const { mapAuthority, ...savedCanonicalCapture } = savedCapture;
  assert.deepEqual(savedCanonicalCapture, canonicalCapture, "capture persistence is rebuilt from validated canonical fields");
  assert.deepEqual(mapAuthority?.current?.revision, {
    revisionId: fixture.binding.revisionId,
    revisionHash: mapBindingSha(fixture.binding.revisionId),
    version: 1,
    scope: "EXACT",
    name: "2021 Panini Obsidian Orange · Nick Bosa #12",
  }, "capture persistence binds the exact immutable applied revision");
  assert.equal(mapAuthority?.current?.status, "APPLIED");
  assert.equal(savedColorRows.length, 4, "all accepted/fallback outcomes are persisted side by side");
  assert.deepEqual(savedColorRows.map(({ side, mode }) => `${side}:${mode}`).sort(), [
    "BACK:PHYSICAL_OUTER", "BACK:PRINTED_FRAME", "FRONT:PHYSICAL_OUTER", "FRONT:PRINTED_FRAME",
  ]);
  assert.equal(JSON.stringify(saves[0]).includes("serverReceipt"), false, "opaque authority is never persisted");
  assert.equal(events[0]?.eventType, "CARD_MAP_APPLIED");
  assert.match(JSON.stringify(events[0]?.details), /"appliedScope":"EXACT"/);
});

test("capture persistence verifies both signed color proposals and rejects tamper or cross-side replay", async () => {
  const fixture = mapBindingFixture();
  const attempts = [
    (() => {
      const capture = structuredClone(fixture.capture);
      (capture.front.colorGeometryEvidence[0].result as { minimumSideSupport: number }).minimumSideSupport = 0.71;
      return capture;
    })(),
    (() => {
      const capture = structuredClone(fixture.capture);
      capture.front.colorGeometryEvidence[0].serverReceipt = capture.back.colorGeometryEvidence[0].serverReceipt;
      return capture;
    })(),
    (() => {
      const capture = structuredClone(fixture.capture);
      capture.back.colorGeometryEvidence[1].serverReceipt = "";
      return capture;
    })(),
  ];
  for (const capture of attempts) {
    let updates = 0;
    const handler = createAiGraderV2SessionHandler({
      requireAdminSession: admin,
      async findSession() { return fixture.session; },
      async validateMapBinding() { return { appliedMap: null, selectedMap: null }; },
      async updateSession() { updates += 1; return fixture.session; },
    });
    const result = response();
    await handler(request("PATCH", { workflowState: "CAPTURED", capture }, fixture.sessionId), result.res);
    assert.equal(result.state.status, 409);
    assert.match(JSON.stringify(result.state.body), /server proposal authority/);
    assert.equal(updates, 0);
  }
});

test("one expired color receipt identifies exact side and mode without consuming sibling evidence", async () => {
  const fixture = mapBindingFixture();
  const before = JSON.stringify(fixture.capture);
  const checked: string[] = [];
  let updates = 0;
  const handler = createAiGraderV2SessionHandler({
    requireAdminSession: admin,
    async findSession() { return fixture.session; },
    async validateMapBinding() { return { appliedMap: null, selectedMap: null }; },
    verifyColorGeometryReceipt(receipt, binding) {
      checked.push(`${binding.side}:${binding.mode}`);
      if (binding.side === "FRONT" && binding.mode === "PRINTED_FRAME") {
        throw new SpeedsterColorGeometryReceiptExpiredError();
      }
      verifySpeedsterColorGeometryReceipt(receipt, binding, { env: colorReceiptEnv });
    },
    async updateSession() { updates += 1; return fixture.session; },
  });
  const result = response();
  await handler(request("PATCH", {
    workflowState: "CAPTURED",
    capture: fixture.capture,
  }, fixture.sessionId), result.res);
  assert.equal(result.state.status, 409);
  assert.match(
    JSON.stringify(result.state.body),
    /FRONT PRINTED_FRAME color geometry receipt expired.*completed sibling and nonexpired mode remains preserved.*rerun and reconfirm only FRONT PRINTED_FRAME/i,
  );
  assert.deepEqual(result.state.body, {
    message: "FRONT PRINTED_FRAME color geometry receipt expired. Every completed sibling and nonexpired mode remains preserved. Explicitly rerun and reconfirm only FRONT PRINTED_FRAME.",
    colorGeometryReceiptExpired: { side: "FRONT", mode: "PRINTED_FRAME" },
  });
  assert.deepEqual(checked, ["FRONT:PHYSICAL_OUTER", "FRONT:PRINTED_FRAME"]);
  assert.equal(updates, 0, "no capture or evidence row may persist after one exact-mode expiry");
  assert.equal(JSON.stringify(fixture.capture), before, "all browser-held sibling and nonexpired evidence remains byte-identical");
});

test("v2 capture accepts exact server receipts and rejects browser-fabricated or altered automatic authority", async () => {
  const fixture = mapBindingFixture();
  const now = 20_000;
  const binding = authorizedV2Binding(fixture, undefined, now);
  const dependencies = {
    async loadActiveMap() { return appliedMapFixture(fixture); },
    async hashEvidence(storageKey: string) { return mapBindingSha(storageKey); },
    verifyReceipt: receiptVerifierAt(now + 1),
    async verifyHumanLesson() { throw new Error("automatic registration must not consult human lessons"); },
  };
  const accepted = await validateSpeedsterSubmittedMapBinding(
    fixture.session, binding, fixture.capture, dependencies,
  );
  assert.equal(accepted?.mapRevisionId, fixture.binding.revisionId);

  const missing = structuredClone(binding);
  delete (missing.registration.front as { serverReceipt?: string }).serverReceipt;
  await assert.rejects(() => validateSpeedsterSubmittedMapBinding(
    fixture.session, missing, fixture.capture, dependencies,
  ), /lacks server authority/);

  const forged = structuredClone(binding);
  forged.registration.front.serverReceipt = "browser-authored.not-a-signature";
  await assert.rejects(() => validateSpeedsterSubmittedMapBinding(
    fixture.session, forged, fixture.capture, dependencies,
  ), /server authority is invalid/);

  const altered = structuredClone(binding);
  (altered.registration.front.anchors[0] as { score: number }).score = 0.9;
  await assert.rejects(() => validateSpeedsterSubmittedMapBinding(
    fixture.session, altered, fixture.capture, dependencies,
  ), /server authority is invalid/);
});

test("v2 human capture requires receipt plus exact side-bound immutable lesson authority", async () => {
  const fixture = mapBindingFixture();
  const now = 30_000;
  const signedHuman = (side: "front" | "back", lessonId: string) => {
    const registration = v2Registration(fixture.binding.registration[side], {
      candidateId: lessonId,
      source: "HUMAN_CORRECTION",
      lessonId,
    });
    return {
      ...registration,
      serverReceipt: issueSpeedsterMapRegistrationReceipt({
        operatorAdminId: "admin-1", sessionId: fixture.sessionId,
        registration, now, env: registrationReceiptEnv,
      }),
    };
  };
  const binding = {
    ...fixture.binding,
    registration: {
      front: signedHuman("front", "lesson-front"),
      back: signedHuman("back", "lesson-back"),
    },
  };
  const verified: string[] = [];
  const dependencies = {
    async loadActiveMap() { return appliedMapFixture(fixture); },
    async hashEvidence(storageKey: string) { return mapBindingSha(storageKey); },
    verifyReceipt: receiptVerifierAt(now + 1),
    async verifyHumanLesson(input: { lessonId: string; side: string; registration: { candidateProvenance?: { lessonId?: string } } }) {
      assert.equal(input.lessonId, input.side === "FRONT" ? "lesson-front" : "lesson-back");
      assert.equal(input.registration.candidateProvenance?.lessonId, input.lessonId);
      verified.push(`${input.side}:${input.lessonId}`);
    },
  };
  await validateSpeedsterSubmittedMapBinding(fixture.session, binding, fixture.capture, dependencies as any);
  assert.deepEqual(verified, ["FRONT:lesson-front", "BACK:lesson-back"]);

  const fabricated = structuredClone(binding);
  delete (fabricated.registration.front.candidateProvenance as { lessonId?: string }).lessonId;
  const unsignedFront = { ...fabricated.registration.front };
  delete (unsignedFront as { serverReceipt?: string }).serverReceipt;
  fabricated.registration.front.serverReceipt = issueSpeedsterMapRegistrationReceipt({
    operatorAdminId: "admin-1", sessionId: fixture.sessionId,
    registration: unsignedFront as any, now, env: registrationReceiptEnv,
  });
  await assert.rejects(() => validateSpeedsterSubmittedMapBinding(
    fixture.session, fabricated, fixture.capture, dependencies as any,
  ), /lacks immutable lesson authority/);

  await assert.rejects(() => validateSpeedsterSubmittedMapBinding(
    fixture.session, binding, fixture.capture, {
      ...dependencies,
      async verifyHumanLesson() { throw new Error("lesson evidence hash changed"); },
    } as any,
  ), /immutable lesson authority is invalid/);
});

test("registration receipts bind exact authority and remain valid for the operator-safe 24-hour window", () => {
  const fixture = mapBindingFixture();
  const registration = v2Registration(fixture.binding.registration.front);
  const issuedAt = 40_000;
  const receipt = issueSpeedsterMapRegistrationReceipt({
    operatorAdminId: "admin-1", sessionId: fixture.sessionId,
    registration, now: issuedAt, env: registrationReceiptEnv,
  });
  verifySpeedsterMapRegistrationReceipt({
    receipt, operatorAdminId: "admin-1", sessionId: fixture.sessionId,
    registration, now: issuedAt + SPEEDSTER_MAP_REGISTRATION_RECEIPT_MAX_AGE_MS,
    env: registrationReceiptEnv,
  });
  assert.throws(() => verifySpeedsterMapRegistrationReceipt({
    receipt, operatorAdminId: "admin-1", sessionId: fixture.sessionId,
    registration, now: issuedAt + SPEEDSTER_MAP_REGISTRATION_RECEIPT_MAX_AGE_MS + 1,
    env: registrationReceiptEnv,
  }), /does not match/);
  assert.throws(() => verifySpeedsterMapRegistrationReceipt({
    receipt, operatorAdminId: "other-admin", sessionId: fixture.sessionId,
    registration, now: issuedAt + 1, env: registrationReceiptEnv,
  }), /does not match/);
  assert.throws(() => verifySpeedsterMapRegistrationReceipt({
    receipt, operatorAdminId: "admin-1", sessionId: "other-session",
    registration, now: issuedAt + 1, env: registrationReceiptEnv,
  }), /does not match/);
  const tinyMutation = {
    ...registration,
    homography: registration.homography.map((value, index) => index === 1 ? 4e-13 : value),
  } as unknown as typeof registration;
  assert.throws(() => verifySpeedsterMapRegistrationReceipt({
    receipt, operatorAdminId: "admin-1", sessionId: fixture.sessionId,
    registration: tinyMutation, now: issuedAt + 1, env: registrationReceiptEnv,
  }), /does not match/, "sub-1e-12 numeric mutations must never collide with exact receipt authority");
  for (const env of [
    {},
    { SPEEDSTER_MAP_REGISTRATION_RECEIPT_HMAC_KEY: "weak", SPEEDSTER_MAP_REGISTRATION_RECEIPT_HMAC_KEY_ID: "key" },
    { SPEEDSTER_MAP_REGISTRATION_RECEIPT_HMAC_KEY: "not valid spaces despite being sufficiently long 0123456789", SPEEDSTER_MAP_REGISTRATION_RECEIPT_HMAC_KEY_ID: "key" },
  ] as unknown as NodeJS.ProcessEnv[]) {
    assert.throws(() => issueSpeedsterMapRegistrationReceipt({
      operatorAdminId: "admin-1", sessionId: fixture.sessionId,
      registration, now: issuedAt, env,
    }), /authority is unavailable/);
  }
});

test("new capture rejects unsigned v1 downgrade while signed v1 remains valid during rolling service cutover", async () => {
  const fixture = mapBindingFixture();
  const unsigned = structuredClone(fixture.binding);
  delete (unsigned.registration.front as { serverReceipt?: string }).serverReceipt;
  await assert.rejects(() => validateSpeedsterSubmittedMapBinding(
    fixture.session, unsigned, fixture.capture, {
      async loadActiveMap() { return appliedMapFixture(fixture); },
      async hashEvidence(storageKey) { return mapBindingSha(storageKey); },
      verifyReceipt: receiptVerifierAt(Date.now()),
    },
  ), /lacks server authority/);
  const signed = await validateSpeedsterSubmittedMapBinding(
    fixture.session, fixture.binding, fixture.capture, {
      async loadActiveMap() { return appliedMapFixture(fixture); },
      async hashEvidence(storageKey) { return mapBindingSha(storageKey); },
      verifyReceipt: receiptVerifierAt(Date.now()),
    },
  );
  assert.equal(signed?.mapRevisionId, fixture.binding.revisionId);
});

test("automatic lesson result must be in the exact verified request roster before receipt issuance", () => {
  const fixture = mapBindingFixture();
  const { serverReceipt: _receipt, ...legacy } = fixture.binding.registration.front;
  const registration = v2Registration(legacy as any, {
    candidateId: "lesson-1", source: "REGISTRATION_LESSON", lessonId: "lesson-1",
  });
  assert.doesNotThrow(() => assertSpeedsterRegistrationCandidateAuthority(registration as any, {
    lessonCandidates: [{ candidateId: "lesson-1", referenceInspectionSha256: "a".repeat(64) }],
  }, false));
  assert.throws(() => assertSpeedsterRegistrationCandidateAuthority(registration as any, {
    lessonCandidates: [{ candidateId: "different-lesson", referenceInspectionSha256: "b".repeat(64) }],
  }, false), /outside the exact server-verified candidate roster/);
  assert.throws(() => assertSpeedsterRegistrationCandidateAuthority({
    ...registration,
    candidateProvenance: { candidateId: "lesson-1", source: "REGISTRATION_LESSON", lessonId: "lesson-2" },
  } as any, {
    lessonCandidates: [{ candidateId: "lesson-1", referenceInspectionSha256: "a".repeat(64) }],
  }, false), /outside the exact server-verified candidate roster/);
});

test("automatic lesson capture reloads exact immutable lesson authority before accepting its receipt", async () => {
  const fixture = mapBindingFixture();
  const now = 50_000;
  const provenance = { candidateId: "lesson-1", source: "REGISTRATION_LESSON" as const, lessonId: "lesson-1" };
  const binding = authorizedV2Binding(fixture, provenance, now);
  const verified: string[] = [];
  const dependencies = {
    async loadActiveMap() { return appliedMapFixture(fixture); },
    async hashEvidence(storageKey: string) { return mapBindingSha(storageKey); },
    verifyReceipt: receiptVerifierAt(now + 1),
    async verifyReferenceLesson(input: { lessonId: string; side: string; expectedAnchors: unknown[] }) {
      assert.equal(input.lessonId, "lesson-1");
      assert.equal(input.expectedAnchors.length, 4);
      verified.push(input.side);
    },
  };
  await validateSpeedsterSubmittedMapBinding(fixture.session, binding, fixture.capture, dependencies as any);
  assert.deepEqual(verified, ["FRONT", "BACK"]);
  await assert.rejects(() => validateSpeedsterSubmittedMapBinding(
    fixture.session, binding, fixture.capture, {
      ...dependencies,
      async verifyReferenceLesson() { throw new Error("lesson source evidence changed"); },
    } as any,
  ), /immutable authority is invalid/);
});

test("capture PATCH rejects browser-tampered projected map geometry before persistence", async () => {
  const fixture = mapBindingFixture();
  const tampered = structuredClone(fixture.binding);
  (tampered.registration.front.projectedZones[0].polygon as unknown as { x: number; y: number }[])[0] = { x: 0.11, y: 0.1 };
  await assert.rejects(() => validateSpeedsterSubmittedMapBinding(
    fixture.session,
    tampered,
    fixture.capture,
    {
      async loadActiveMap() { return appliedMapFixture(fixture); },
      async hashEvidence(storageKey) { return mapBindingSha(storageKey); },
    },
  ), /zone projection is incoherent/);
});

test("capture PATCH pins a family registration for a matching Card Type", async () => {
  const fixture = mapBindingFixture();
  let events: readonly { eventType: string; details?: unknown }[] = [];
  const handler = createAiGraderV2SessionHandler({
    requireAdminSession: admin,
    async findSession() { return fixture.session; },
    async validateMapBinding(session, binding, capture) {
      return validateSpeedsterSubmittedMapBinding(session, binding, capture, {
        async loadActiveMap() { return appliedMapFixture(fixture, "FAMILY"); },
        async hashEvidence(storageKey) { return mapBindingSha(storageKey); },
      });
    },
    async updateSession(_id, _createdByUserId, data) {
      return { ...fixture.session, ...data };
    },
    async recordInstrumentation(input) { events = input; },
  });
  const result = response();

  await handler(request("PATCH", {
    workflowState: "CAPTURED",
    capture: fixture.capture,
    mapBinding: fixture.binding,
  }, fixture.sessionId), result.res);

  assert.equal(result.state.status, 200);
  assert.equal(events[0]?.eventType, "CARD_MAP_APPLIED");
  assert.match(JSON.stringify(events[0]?.details), /"appliedScope":"FAMILY"/);
  assert.match(JSON.stringify(events[0]?.details), /"scope":"FAMILY"/);
});

test("capture PATCH accepts a rescue-style signed enriched V2 FAMILY registration through final binding", async () => {
  const fixture = mapBindingFixture();
  const now = 60_000;
  const binding = authorizedEnrichedV2HumanBinding(fixture, now);
  const saves: Record<string, unknown>[] = [];
  const verifiedLessons: string[] = [];
  let events: readonly { eventType: string; details?: unknown }[] = [];
  const handler = createAiGraderV2SessionHandler({
    requireAdminSession: admin,
    async findSession() { return fixture.session; },
    async validateMapBinding(session, submittedBinding, capture) {
      return validateSpeedsterSubmittedMapBinding(session, submittedBinding, capture, {
        async loadActiveMap() { return appliedMapFixture(fixture, "FAMILY", "V2"); },
        async hashEvidence(storageKey) { return mapBindingSha(storageKey); },
        verifyReceipt: receiptVerifierAt(now + 1),
        async verifyHumanLesson(input) { verifiedLessons.push(`${input.side}:${input.lessonId}`); },
      });
    },
    async updateSession(_id, _createdByUserId, data) {
      saves.push(data as unknown as Record<string, unknown>);
      return { ...fixture.session, ...data };
    },
    async recordInstrumentation(input) { events = input; },
  });
  const result = response();

  await handler(request("PATCH", {
    workflowState: "CAPTURED",
    capture: fixture.capture,
    mapBinding: binding,
  }, fixture.sessionId), result.res);

  assert.equal(result.state.status, 200);
  assert.equal(saves[0]?.mapFilterPolicyVersion, SPEEDSTER_MAP_FILTER_POLICY_VERSION_V2);
  const persistedRegistration = saves[0]?.mapRegistration as {
    front: { projectedZones: unknown[] };
    back: { projectedZones: unknown[] };
  };
  assert.deepEqual(persistedRegistration.front.projectedZones, [mapBindingV2Zone]);
  assert.deepEqual(persistedRegistration.back.projectedZones, [mapBindingV2Zone]);
  assert.equal(JSON.stringify(persistedRegistration).includes("serverReceipt"), false);
  assert.deepEqual(verifiedLessons, ["FRONT:lesson-front-v2", "BACK:lesson-back-v2"]);
  assert.equal(events[0]?.eventType, "CARD_MAP_APPLIED");
  assert.match(JSON.stringify(events[0]?.details), /"appliedScope":"FAMILY"/);
});

test("capture PATCH blocks when selected-map registration is omitted", async () => {
  const fixture = mapBindingFixture();
  const saves: Record<string, unknown>[] = [];
  let events: readonly { eventType: string; details?: unknown }[] = [];
  const handler = createAiGraderV2SessionHandler({
    requireAdminSession: admin,
    async findSession() { return fixture.session; },
    async validateMapBinding(session, binding, capture) {
      assert.equal(binding, undefined);
      return validateSpeedsterSubmittedMapBinding(session, binding, capture, {
        async loadActiveMap() { return appliedMapFixture(fixture); },
        async hashEvidence() { throw new Error("not reached"); },
      });
    },
    async updateSession(_id, _createdByUserId, data) {
      saves.push(data as unknown as Record<string, unknown>);
      return { ...fixture.session, ...data };
    },
    async recordInstrumentation(input) { events = input; },
  });
  const result = response();
  await handler(request("PATCH", {
    workflowState: "CAPTURED",
    capture: fixture.capture,
  }, fixture.sessionId), result.res);
  assert.equal(result.state.status, 409);
  assert.equal(saves.length, 0);
  assert.equal(events.length, 0);
  assert.match(JSON.stringify(result.state.body), /explicitly record human review without the map/);
});

test("capture PATCH blocks when effective map lookup fails before binding", async () => {
  const fixture = mapBindingFixture();
  let events: readonly { eventType: string; details?: unknown }[] = [];
  const handler = createAiGraderV2SessionHandler({
    requireAdminSession: admin,
    async findSession() { return fixture.session; },
    async validateMapBinding(session, binding, capture) {
      return validateSpeedsterSubmittedMapBinding(session, binding, capture, {
        async loadActiveMap() { throw new Error("effective lookup unavailable"); },
        async hashEvidence() { throw new Error("not reached"); },
      });
    },
    async updateSession(_id, _createdByUserId, data) {
      return { ...fixture.session, ...data };
    },
    async recordInstrumentation(input) { events = input; },
  });
  const result = response();

  await handler(request("PATCH", {
    workflowState: "CAPTURED",
    capture: fixture.capture,
  }, fixture.sessionId), result.res);

  assert.equal(result.state.status, 500);
  assert.equal(events.length, 0);
  assert.match(JSON.stringify(result.state.body), /effective lookup unavailable/);
});

test("capture PATCH never ignores an integrity failure after a map binding is submitted", async () => {
  const fixture = mapBindingFixture();
  let updates = 0;
  const handler = createAiGraderV2SessionHandler({
    requireAdminSession: admin,
    async findSession() { return fixture.session; },
    async validateMapBinding(session, binding, capture) {
      return validateSpeedsterSubmittedMapBinding(session, binding, capture, {
        async loadActiveMap() { throw new SpeedsterMapIntegrityError("pinned effective revision is malformed"); },
        async hashEvidence() { throw new Error("not reached"); },
      });
    },
    async updateSession() { updates += 1; return fixture.session; },
  });
  const result = response();

  await handler(request("PATCH", {
    workflowState: "CAPTURED",
    capture: fixture.capture,
    mapBinding: fixture.binding,
  }, fixture.sessionId), result.res);

  assert.equal(result.state.status, 409);
  assert.equal(updates, 0);
});

test("capture PATCH keeps the unchanged no-map path only after effective server lookup", async () => {
  const fixture = mapBindingFixture();
  let validationCalls = 0;
  let updateCalls = 0;
  const handler = createAiGraderV2SessionHandler({
    requireAdminSession: admin,
    async findSession() { return fixture.session; },
    async validateMapBinding(session, binding, capture) {
      validationCalls += 1;
      return validateSpeedsterSubmittedMapBinding(session, binding, capture, {
        async loadActiveMap() { return null; },
        async hashEvidence() { throw new Error("not reached"); },
      });
    },
    async updateSession(_id, _createdByUserId, data) {
      updateCalls += 1;
      return { ...fixture.session, ...data };
    },
  });
  const result = response();
  await handler(request("PATCH", {
    workflowState: "CAPTURED",
    capture: fixture.capture,
  }, fixture.sessionId), result.res);
  assert.equal(result.state.status, 200);
  assert.equal(validationCalls, 1);
  assert.equal(updateCalls, 1);
});

test("durable human review commits without a map, preserves the exact failure, and rejects a stale map binding", async () => {
  const fixture = mapBindingFixture();
  const failure = {
    attemptId: "attempt-registration-failure",
    recordedAt: "2026-08-18T11:55:00.000Z",
    status: "REGISTRATION_BLOCKED" as const,
    failureCode: "CARD_MAP_REGISTRATION_BLOCKED",
    message: "Back registration failed.",
    revision: {
      revisionId: fixture.binding.revisionId,
      revisionHash: mapBindingSha(fixture.binding.revisionId),
      version: 1,
      scope: "EXACT" as const,
      name: "2021 Panini Obsidian Orange · Nick Bosa #12",
    },
    registrationOperationId: "operation-registration-failure",
    registrationFailures: [{
      side: "BACK" as const,
      source: "PROVIDER_GATEWAY" as const,
      code: "PROVIDER_GATEWAY_HTTP_502",
      httpStatus: 502,
      requestId: "request-registration-failure",
    }],
  };
  const human = {
    ...failure,
    attemptId: "attempt-human-review",
    recordedAt: "2026-08-18T11:56:00.000Z",
    status: "HUMAN_REVIEW_WITHOUT_MAP" as const,
    message: "Operator explicitly selected human review.",
    operatorDecisionId: "0d654ba6-1df3-47a0-9f30-8f0a4e719206",
  };
  const serverSession = {
    ...fixture.session,
    capture: {
      mapAuthority: {
        version: "speedster-map-authority-evidence-v1",
        current: human,
        history: [failure, human],
      },
    },
  };
  let mapLookups = 0;
  const validationDependencies = {
    async loadActiveMap() { mapLookups += 1; return appliedMapFixture(fixture); },
    async hashEvidence() { throw new Error("not reached"); },
  };
  const validated = await validateSpeedsterSubmittedMapBinding(
    serverSession,
    undefined,
    fixture.capture,
    validationDependencies,
  );
  assert.equal(validated.mapFailureCode, "MAP_AUTHORITY_HUMAN_REVIEW");
  assert.equal(validated.appliedMap, null);
  assert.equal(mapLookups, 0, "the durable decision must not silently retry or apply a map");
  await assert.rejects(() => validateSpeedsterSubmittedMapBinding(
    serverSession,
    fixture.binding,
    fixture.capture,
    validationDependencies,
  ), /explicitly continued without a Card Map.*map binding was submitted/i);

  const saves: Record<string, unknown>[] = [];
  const handler = createAiGraderV2SessionHandler({
    requireAdminSession: admin,
    async findSession() { return serverSession; },
    async validateMapBinding(session, binding, capture) {
      return validateSpeedsterSubmittedMapBinding(session, binding, capture, validationDependencies);
    },
    async updateSession(_id, _createdByUserId, data, _rows, expectedUpdatedAt) {
      assert.equal(expectedUpdatedAt, fixture.session.updatedAt);
      saves.push(data as unknown as Record<string, unknown>);
      return { ...serverSession, ...data };
    },
  });
  const result = response();
  await handler(request("PATCH", {
    workflowState: "CAPTURED",
    capture: fixture.capture,
  }, fixture.sessionId), result.res);
  assert.equal(result.state.status, 200);
  const saved = saves[0];
  assert.ok(saved);
  assert.equal(saved.mapRevisionId, undefined);
  assert.equal(saved.mapRegistration, undefined);
  const authority = (saved.capture as {
    mapAuthority: {
      current: typeof human;
      history: readonly (typeof failure | typeof human)[];
    };
  }).mapAuthority;
  assert.equal(authority.current.status, "HUMAN_REVIEW_WITHOUT_MAP");
  assert.equal(authority.current.operatorDecisionId, human.operatorDecisionId);
  assert.deepEqual(authority.current.registrationFailures, failure.registrationFailures);
  assert.deepEqual(authority.history.slice(0, 2), [failure, human]);
});

test("capture PATCH rejects either side when registration physical geometry is from another submitted capture", async () => {
  for (const side of ["front", "back"] as const) {
    const fixture = mapBindingFixture();
    const capture = {
      ...fixture.capture,
      [side]: {
        ...fixture.capture[side],
        sourceCorners: [
          { x: 0.15, y: 0.1 },
          ...fixture.capture[side].sourceCorners.slice(1),
        ],
      },
    };
    let updateCalls = 0;
    const handler = createAiGraderV2SessionHandler({
      requireAdminSession: admin,
      async findSession() { return fixture.session; },
      async validateMapBinding(session, binding, submittedCapture) {
        return validateSpeedsterSubmittedMapBinding(session, binding, submittedCapture, {
          async loadActiveMap() { return appliedMapFixture(fixture); },
          async hashEvidence(storageKey) { return mapBindingSha(storageKey); },
        });
      },
      async updateSession() { updateCalls += 1; return fixture.session; },
    });
    const result = response();
    await handler(request("PATCH", {
      workflowState: "CAPTURED",
      capture,
      mapBinding: fixture.binding,
    }, fixture.sessionId), result.res);
    assert.equal(result.state.status, 409, side);
    assert.equal(updateCalls, 0, side);
    assert.match(JSON.stringify(result.state.body), /does not match (?:the submitted physical geometry|the exact human-confirmed capture geometry)/);
  }
});

test("capture PATCH rejects either side when server-hashed current inspection differs from registration evidence", async () => {
  for (const side of ["front", "back"] as const) {
    const fixture = mapBindingFixture();
    let updateCalls = 0;
    const mismatchedKey = fixture.capture[side].inspectionStorageKey;
    const handler = createAiGraderV2SessionHandler({
      requireAdminSession: admin,
      async findSession() { return fixture.session; },
      async validateMapBinding(session, binding, submittedCapture) {
        return validateSpeedsterSubmittedMapBinding(session, binding, submittedCapture, {
          async loadActiveMap() { return appliedMapFixture(fixture); },
          async hashEvidence(storageKey) {
            return mapBindingSha(storageKey === mismatchedKey ? `different:${storageKey}` : storageKey);
          },
        });
      },
      async updateSession() { updateCalls += 1; return fixture.session; },
    });
    const result = response();
    await handler(request("PATCH", {
      workflowState: "CAPTURED",
      capture: fixture.capture,
      mapBinding: fixture.binding,
    }, fixture.sessionId), result.res);
    assert.equal(result.state.status, 409, side);
    assert.equal(updateCalls, 0, side);
    assert.match(JSON.stringify(result.state.body), /does not match the submitted inspection evidence/);
  }
});

test("generic capture PATCH rejects a non-DRAFT session", async () => {
  let updateCalls = 0;
  const handler = createAiGraderV2SessionHandler({
    requireAdminSession: admin,
    async findSession() {
      return { id: "speedster-1", publicReportSlug: null, workflowState: "COMPLETED", reviewedDefects: [] };
    },
    async updateSession() { updateCalls += 1; return {}; },
  });
  const result = response();
  await handler(request("PATCH", { workflowState: "CAPTURED", capture: { cornerShape: "SQUARE" } }, "speedster-1"), result.res);
  assert.equal(result.state.status, 409);
  assert.equal(updateCalls, 0);
});

test("GET and PATCH responses strip private removal state from aggregate findings", async () => {
  const tracePixels = new Uint8Array(SPEEDSTER_TRACE_PIXEL_COUNT);
  tracePixels[1000] = 1;
  const finalTrace = encodeSpeedsterTraceRleV1(tracePixels);
  const privateFinding = {
    id: "FRONT:removed",
    side: "FRONT",
    zone: "SURFACE",
    defectType: "LIGHT_SCRATCH_SCUFF",
    origin: "DETECTOR",
    confidence: 0.9,
    canonicalContour: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.1 }, { x: 0.2, y: 0.2 }],
    sourceViewId: "FRONT:ORIGINAL",
    supportingViewIds: [],
    reviewResult: "REMOVED",
    reviewResultBeforeRemoval: "TYPE_CORRECTED",
    measurement: {
      widthMm: 1, heightMm: 1, areaMm2: 1, zonePercent: 1,
      multiplier: 1, weightedAreaMm2: 1, subgradeEffect: 0,
    },
  };
  const {
    zone: _zone,
    canonicalContour: _contour,
    measurement: _measurement,
    reviewResultBeforeRemoval: _prior,
    ...sourceCommon
  } = privateFinding;
  const existing = {
    id: "speedster-1",
    publicReportSlug: null,
    workflowState: "DRAFT",
    reviewedDefects: [privateFinding, {
      ...sourceCommon,
      id: "FRONT:trace-source",
      reviewResult: "TYPE_CORRECTED",
      finalTrace,
      traceProvenance: { finalTraceSha256: finalTrace.sha256 },
      measurementRegions: [{
        zone: "SURFACE",
        canonicalContour: privateFinding.canonicalContour,
        measurement: { ...privateFinding.measurement, pixelCount: 1 },
      }],
    }],
  };
  const handler = createAiGraderV2SessionHandler({
    requireAdminSession: admin,
    async findSession() { return existing; },
    async validateMapBinding() { return {}; },
    async updateSession() { return { ...existing, workflowState: "CAPTURED" }; },
  });
  const getResult = response();
  await handler(request("GET", undefined, "speedster-1"), getResult.res);
  assert.equal(JSON.stringify(getResult.state.body).includes("reviewResultBeforeRemoval"), false);
  assert.equal(JSON.stringify(getResult.state.body).includes("\"runs\""), false);
  const patchResult = response();
  await handler(request("PATCH", { workflowState: "CAPTURED", capture: { cornerShape: "SQUARE" } }, "speedster-1"), patchResult.res);
  assert.equal(JSON.stringify(patchResult.state.body).includes("reviewResultBeforeRemoval"), false);
  assert.equal(JSON.stringify(patchResult.state.body).includes("\"runs\""), false);
});

test("review changes use the one owned review-action route and never call client measure or generic PATCH", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const page = readFileSync(`${root}/pages/admin/ai-grader-v2.tsx`, "utf8");
  const start = page.indexOf("const runReviewRemeasurement");
  const end = page.indexOf("const traceProposal", start);
  const action = page.slice(start, end);

  assert.match(action, /\/review-action/);
  assert.match(action, /method: "POST"/);
  assert.doesNotMatch(action, /speedsterImageService\.measure/);
  assert.doesNotMatch(action, /method: "PATCH"/);
  assert.ok(action.indexOf("await fetch") < action.indexOf("setDefects(payload.reviewedDefects)"));
  assert.doesNotMatch(action, /hydratedById|new Map\(|setDefects\(nextDefects\)/);
  assert.doesNotMatch(action, /finalTrace:\s*undefined/);
  assert.match(action, /const \{ finalTrace, \.\.\.trace \} = action\.trace/);
  assert.match(action, /traceWire: encodeSpeedsterTraceBitmapWireV1/);
  assert.match(page, /Scanning FRONT, then BACK/);
  assert.match(page, /one automatic RunPod HTTP 502 retry/);
  assert.match(page, /retryRequestId/);

  const loaderStart = page.indexOf("const loadTrace", start);
  const loaderEnd = page.indexOf("const traceProposal", loaderStart);
  const loader = page.slice(loaderStart, loaderEnd);
  assert.match(loader, /method:\s*"GET"/);
  assert.match(loader, /\/review-action\?findingId=/);
  assert.match(loader, /decodeSpeedsterTraceBitmapWireV1/);
  assert.match(page, /onTraceLoad=\{loadTrace\}/);

  const workspace = readFileSync(
    `${root}/components/ai-grader-v2/ReviewWorkspace.tsx`,
    "utf8",
  );
  assert.match(workspace, /onTraceLoad\?:/);
  assert.match(workspace, /onTraceLoad=\{onTraceLoad\}/);

  const proposalEnd = page.indexOf("const saveTrace", loaderEnd);
  const proposal = page.slice(loaderEnd, proposalEnd);
  assert.match(proposal, /findingId: input\.target\.findingId/);
  assert.match(proposal, /currentTraceWire/);
  assert.doesNotMatch(proposal, /evidenceView|sourceImageUrls|sourceViewId|cornerShape/);

  assert.match(page, /JSON\.stringify\(\{ action: \{ type: "INITIALIZE" \} \}\)/);
  assert.doesNotMatch(page, /speedsterImageService\.detect|initialDefects|detectorVersion/);
  assert.match(page, /Retry server scan/);
  assert.match(page, /void initializeReview\(\)/);

  const imageProxy = readFileSync(`${root}/pages/api/admin/ai-grader-v2/image/[action].ts`, "utf8");
  assert.doesNotMatch(imageProxy, /ACTIONS[^\n]+detect/);
  const reviewRoute = readFileSync(
    `${root}/pages/api/admin/ai-grader-v2/sessions/[sessionId]/review-action.ts`,
    "utf8",
  );
  assert.match(reviewRoute, /z\.object\(\{ type: z\.literal\("INITIALIZE"\) \}\)\.strict\(\)/);
  assert.doesNotMatch(reviewRoute, /initialDefects/);
});

test("review CAS is short, serializable, and compares the exact persisted updatedAt after external work", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const core = readFileSync(`${root}/lib/server/aiGraderV2ReviewAction.ts`, "utf8");
  const route = readFileSync(
    `${root}/pages/api/admin/ai-grader-v2/sessions/[sessionId]/review-action.ts`,
    "utf8",
  );
  assert.ok(core.indexOf("await deps.measure") < core.lastIndexOf("await deps.persistReviewIfRevision"));
  assert.ok(core.indexOf("serverOwnedInitialization") < core.indexOf("await deps.persistReviewIfRevision"));
  assert.match(route, /current\.updatedAt\.getTime\(\) !== expectedUpdatedAt\.getTime\(\)/);
  assert.match(route, /updatedAt: expectedUpdatedAt/);
  assert.match(route, /FOR UPDATE/);
  assert.match(route, /isolationLevel: "Serializable"/);
  const casStart = route.indexOf("persistReviewIfRevision:");
  const casEnd = route.indexOf("},\n};", casStart);
  assert.doesNotMatch(route.slice(casStart, casEnd), /presignRead|fetch\(|\/measure|\/detect/);
  const evidenceInsert = route.indexOf(
    "insertSpeedsterInstrumentationEvents(tx, data.detectorEvidenceEvents)",
    casStart,
  );
  const reviewUpdate = route.indexOf("tx.aiGraderV2Session.updateMany", casStart);
  const filterDecisionInsert = route.indexOf("tx.aiGraderV2MapFilterDecision.createMany", casStart);
  assert.ok(evidenceInsert > casStart);
  assert.ok(evidenceInsert < reviewUpdate);
  assert.ok(evidenceInsert < filterDecisionInsert);
  assert.match(route, /inserted !== data\.detectorEvidenceEvents\.length/);
});

test("final capture persistence compares the exact draft revision before replacing authority evidence", () => {
  const route = readFileSync(
    fileURLToPath(new URL("../pages/api/admin/ai-grader-v2/sessions/[sessionId].ts", import.meta.url)),
    "utf8",
  );
  assert.match(route, /updatedAt: expectedUpdatedAt/);
  assert.match(route, /colorGeometryEvidence, existing\.updatedAt/);
  assert.match(route, /if \(updated\.count !== 1\) return null/);
});

test("review presents the exact detector mask as authority before any contour projection", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const viewer = readFileSync(
    `${root}/components/ai-grader-v2/DefectEvidenceViewer.tsx`,
    "utf8",
  );
  assert.match(viewer, /active\?\.finalTrace \?\? active\?\.detectorMask/);
  assert.match(viewer, /resolvedTrace \?\? defect\.detectorMask/);
  assert.match(viewer, /<ExactTraceOverlay trace=\{activeTrace\}/);
});

test("upload planning binds the requested session to the existing admin identity", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const source = readFileSync(`${root}/pages/api/admin/ai-grader-v2/upload-plan.ts`, "utf8");
  assert.match(source, /where: \{ id: sessionId, createdByUserId \}/);
  assert.match(source, /findOwnedSession\(sessionId, admin\.user\.id\)/);
  assert.match(source, /if \(!session\) return res\.status\(404\)/);
  assert.match(source, /"RECTIFIED", "INSPECTION", "NORMALIZED", "MICRO_DEFECT", "DIRECTIONAL"/);
});

test("SAM proxy adds its one optional server-only bearer header", () => {
  const original = process.env.AI_GRADER_SPEEDSTER_SERVICE_API_KEY;
  try {
    delete process.env.AI_GRADER_SPEEDSTER_SERVICE_API_KEY;
    assert.deepEqual(speedsterServiceHeaders(), { "Content-Type": "application/json" });
    process.env.AI_GRADER_SPEEDSTER_SERVICE_API_KEY = "runpod-key";
    assert.deepEqual(speedsterServiceHeaders(), {
      "Content-Type": "application/json",
      Authorization: "Bearer runpod-key",
    });
  } finally {
    if (original === undefined) delete process.env.AI_GRADER_SPEEDSTER_SERVICE_API_KEY;
    else process.env.AI_GRADER_SPEEDSTER_SERVICE_API_KEY = original;
  }
});

test("map registration uses the effective family revision for projected boundary auto-positioning", async () => {
  const fixture = mapBindingFixture();
  const selected = appliedMapFixture(fixture, "FAMILY") as unknown as {
    revision: Record<string, unknown>;
  } & Record<string, unknown>;
  const referenceSha256 = mapBindingSha("family-reference-front");
  selected.revision = {
    ...selected.revision,
    frontMap: {
      side: "FRONT",
      referenceInspection: {
        storageKey: "private/card-maps/family/front.webp",
        sha256: referenceSha256,
      },
      designBoundary: { kind: "QUAD", points: mapBindingQuad },
      anchors: [1, 2, 3, 4].map((number) => ({
        id: `anchor-${number}`,
        point: { x: number % 2 ? 0.2 : 0.8, y: number < 3 ? 0.2 : 0.8 },
      })),
      zones: [{
        id: "zone-1",
        label: "Shared printed frame",
        semanticType: "PRINT_BORDER",
        polygon: mapBindingQuad,
      }],
    },
  };
  const recaptureGeneration = "recapture-00000000-0000-4000-8000-000000000007";
  const currentOriginalStorageKey = `ai-grader-v2/admin-1/${fixture.sessionId}/original/${recaptureGeneration}/front.jpg`;
  const currentInspectionStorageKey = `ai-grader-v2/admin-1/${fixture.sessionId}/prepared/front/${recaptureGeneration}/inspection.webp`;
  const hashed: string[] = [];
  const body = await speedsterServiceBody("map-registration", {
    sessionId: fixture.sessionId,
    side: "FRONT",
    currentPhysicalQuad: mapBindingQuad,
    currentOriginalStorageKey,
    currentInspectionStorageKey,
  }, "admin-1", {
    async findOwnedCapture() { return null; },
    async presignRead(storageKey) { return `https://signed.invalid/${storageKey}`; },
    async findOwnedMapSession() { return fixture.session; },
    async loadActiveMap() { return selected as never; },
    async hashMapEvidence(storageKey) {
      hashed.push(storageKey);
      return storageKey === "private/card-maps/family/front.webp"
        ? referenceSha256
        : mapBindingSha(storageKey);
    },
    async loadRegistrationLessons() {
      return [{
        lessonId: "lesson-1",
        currentInspectionKey: "private/card-maps/lesson/back.webp",
        currentInspectionSha256: mapBindingSha("lesson"),
        anchors: [1, 2, 3, 4].map((number) => ({
          id: `anchor-${number}`,
          point: { x: number % 2 ? 0.21 : 0.81, y: number < 3 ? 0.21 : 0.81 },
        })),
        sourceHomography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      }];
    },
  }) as Record<string, unknown>;

  assert.equal(body.mapRevisionId, fixture.binding.revisionId);
  assert.equal((body.currentImage as { imageUrl: string }).imageUrl, `https://signed.invalid/${currentInspectionStorageKey}`);
  assert.ok(hashed.includes(currentInspectionStorageKey), "Exact versioned inspection must be hashed before registration");
  assert.deepEqual(body.designBoundary, { kind: "QUAD", points: mapBindingQuad });
  assert.equal((body.anchors as unknown[]).length, 4);
  assert.deepEqual(body.lessonCandidates, [{
    candidateId: "lesson-1",
    referenceInspectionSha256: mapBindingSha("lesson"),
    referenceImage: { imageUrl: "https://signed.invalid/private/card-maps/lesson/back.webp" },
    anchors: [1, 2, 3, 4].map((number) => ({
      id: `anchor-${number}`,
      point: { x: number % 2 ? 0.21 : 0.81, y: number < 3 ? 0.21 : 0.81 },
    })),
    sourceHomography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  }]);

  const invalidPairs = [
    {
      label: "mixed generations",
      original: currentOriginalStorageKey,
      inspection: `ai-grader-v2/admin-1/${fixture.sessionId}/prepared/front/inspection.webp`,
    },
    {
      label: "cross-side prepared evidence",
      original: currentOriginalStorageKey,
      inspection: `ai-grader-v2/admin-1/${fixture.sessionId}/prepared/back/${recaptureGeneration}/inspection.webp`,
    },
    {
      label: "cross-session prepared evidence",
      original: currentOriginalStorageKey,
      inspection: `ai-grader-v2/admin-1/speedster-other-session-12345/prepared/front/${recaptureGeneration}/inspection.webp`,
    },
  ];
  for (const invalidPair of invalidPairs) {
    let authorityCalls = 0;
    await assert.rejects(() => speedsterServiceBody("map-registration", {
      sessionId: fixture.sessionId,
      side: "FRONT",
      currentPhysicalQuad: mapBindingQuad,
      currentOriginalStorageKey: invalidPair.original,
      currentInspectionStorageKey: invalidPair.inspection,
    }, "admin-1", {
      async findOwnedCapture() { authorityCalls += 1; return null; },
      async presignRead() { authorityCalls += 1; return "unexpected"; },
      async findOwnedMapSession() { authorityCalls += 1; return fixture.session; },
      async loadActiveMap() { authorityCalls += 1; return selected as never; },
      async hashMapEvidence() { authorityCalls += 1; return referenceSha256; },
    }), /map registration request is invalid/i, invalidPair.label);
    assert.equal(
      authorityCalls,
      0,
      `${invalidPair.label} must fail before lookup, hashing, signing, or upstream authority`,
    );
  }
});

test("rescue rejects active-revision drift before snapshot or upstream authority can be prepared", async () => {
  const fixture = mapBindingFixture();
  const selected = appliedMapFixture(fixture, "FAMILY") as any;
  const referenceSha256 = mapBindingSha("family-reference-front");
  const expectedAnchors = [1, 2, 3, 4].map((number) => ({
    id: `anchor-${number}`,
    point: { x: number % 2 ? 0.2 : 0.8, y: number < 3 ? 0.2 : 0.8 },
  }));
  selected.revision = {
    ...selected.revision,
    frontMap: {
      side: "FRONT",
      referenceInspection: { storageKey: "private/card-maps/family/front.webp", sha256: referenceSha256 },
      designBoundary: { kind: "QUAD", points: mapBindingQuad },
      anchors: expectedAnchors,
      zones: [],
    },
  };
  const currentKey = `ai-grader-v2/admin-1/${fixture.sessionId}/prepared/front/inspection.webp`;
  let snapshots = 0;
  const failure = {
    algorithmVersion: "opencv-redundant-ransac-registration-v2",
    policyVersion: "speedster-map-registration-acceptance-v2",
    accepted: false,
    failureCode: "LOW_RANSAC_INLIER_FRACTION",
    message: "Registration inlier fraction is below policy.",
    candidateCount: 1,
    candidateIds: ["original-reference"],
    binding: {
      side: "FRONT",
      mapRevisionId: "stale-revision",
      currentInspectionSha256: mapBindingSha(currentKey),
      currentPhysicalQuadSha256: speedsterPhysicalQuadHash(mapBindingQuad),
      candidates: [{ candidateId: "original-reference", referenceInspectionSha256: referenceSha256 }],
    },
    bestCandidate: {
      candidateId: "original-reference", provenance: "ORIGINAL_REFERENCE", accepted: false,
      failureCode: "LOW_RANSAC_INLIER_FRACTION", message: "Registration inlier fraction is below policy.",
      anchors: expectedAnchors.map(({ id, point }) => ({
        anchorId: id, expectedPoint: point, trackedPoint: point, locatedPoint: point,
        score: 0.9, status: "TRACKED",
      })),
      featureCount: 40, usableFeatureCount: 30, inlierCount: 15, inlierFraction: 0.5,
      perAnchorFeatureCounts: [7, 7, 8, 8], perAnchorInlierCounts: [4, 4, 4, 3],
      medianReprojectionErrorPx: 0.8, maxReprojectionErrorPx: 2.1,
    },
  };
  await assert.rejects(() => speedsterServiceBody("map-registration", {
    sessionId: fixture.sessionId,
    side: "FRONT",
    currentPhysicalQuad: mapBindingQuad,
    currentOriginalStorageKey: `ai-grader-v2/admin-1/${fixture.sessionId}/original/front.jpg`,
    currentInspectionStorageKey: currentKey,
    rescue: true,
    rescueAttemptId: "rescue-drift-1",
    automaticFailure: failure,
    correctedAnchors: expectedAnchors.map(({ id, point }) => ({ anchorId: id, point })),
  }, "admin-1", {
    async findOwnedCapture() { return null; },
    async presignRead() { return "https://signed.invalid/not-reached"; },
    async findOwnedMapSession() { return fixture.session; },
    async loadActiveMap() { return selected; },
    async hashMapEvidence(key) { return key === "private/card-maps/family/front.webp" ? referenceSha256 : mapBindingSha(key); },
    async loadRegistrationLessons() { return []; },
    async snapshotRegistrationEvidence() { snapshots += 1; throw new Error("not reached"); },
  }), /no longer matches the active map revision/);
  assert.equal(snapshots, 0);
});

test("map registration failure diagnostics preserve off-card proposals but reject malformed/unbounded evidence", () => {
  const failure = parseSpeedsterRegistrationFailure({
    algorithmVersion: "opencv-redundant-ransac-registration-v2",
    policyVersion: "speedster-map-registration-acceptance-v2",
    accepted: false,
    failureCode: "LOW_ANCHOR_CONFIDENCE",
    message: "low confidence",
    candidateCount: 1,
    candidateIds: ["original-reference"],
    binding: {
      side: "FRONT",
      mapRevisionId: "map-revision-1",
      currentInspectionSha256: "a".repeat(64),
      currentPhysicalQuadSha256: "b".repeat(64),
      candidates: [{ candidateId: "original-reference", referenceInspectionSha256: "c".repeat(64) }],
    },
    bestCandidate: {
      candidateId: "original-reference",
      provenance: "ORIGINAL_REFERENCE",
      accepted: false,
      failureCode: "LOW_ANCHOR_CONFIDENCE",
      message: "low confidence",
      anchors: [1, 2, 3, 4].map((number) => ({
        anchorId: `a${number}`,
        expectedPoint: { x: number % 2 ? 0.1 : 0.9, y: number < 3 ? 0.1 : 0.9 },
        trackedPoint: number === 1 ? { x: -0.131, y: 0.06 } : { x: 0.5, y: 0.5 },
        locatedPoint: number === 1 ? { x: -0.131, y: 0.06 } : { x: 0.5, y: 0.5 },
        score: number === 1 ? 0 : 0.9,
        status: number === 1 ? "OUT_OF_CARD" : "TRACKED",
      })),
      featureCount: 40,
      usableFeatureCount: 30,
      inlierCount: 20,
      inlierFraction: 2 / 3,
      perAnchorFeatureCounts: [4, 8, 9, 9],
      perAnchorInlierCounts: [1, 6, 7, 6],
      medianReprojectionErrorPx: 0.8,
      maxReprojectionErrorPx: 2.1,
    },
  });
  assert.equal(failure.bestCandidate.anchors[0].trackedPoint?.x, -0.131);
  const lesson = {
    lessonId: "lesson-1",
    currentInspectionKey: "lesson.webp",
    currentInspectionSha256: "a".repeat(64),
    anchors: [],
    sourceHomography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  };
  assert.deepEqual(
    selectSpeedsterRegistrationLessonCandidates([lesson], failure),
    [],
    "A retry must not add a lesson that was absent from the original failed candidate set",
  );
  assert.deepEqual(
    selectSpeedsterRegistrationLessonCandidates([lesson], {
      ...failure,
      candidateCount: 2,
      candidateIds: ["original-reference", "lesson-1"],
      binding: {
        ...failure.binding,
        candidates: [
          ...failure.binding.candidates,
          { candidateId: "lesson-1", referenceInspectionSha256: lesson.currentInspectionSha256 },
        ],
      },
    }),
    [lesson],
    "A retry must reconstruct the exact original lesson candidate set and order",
  );
  assert.throws(() => parseSpeedsterRegistrationFailure({
    ...failure,
    bestCandidate: { ...failure.bestCandidate, featureCount: 1000 },
  }), /malformed/);
});

test("server parser accepts validated v2 automatic and human registrations while legacy v1 stays compatible", () => {
  const fixture = mapBindingFixture();
  const { serverReceipt: _receipt, ...legacy } = fixture.binding.registration.front;
  const legacyOnly = {
    ...legacy,
    projectedZones: legacy.projectedZones.map(({ id, label, semanticType, polygon }) => ({
      id, label, semanticType, polygon,
    })),
  };
  assert.equal(parseSpeedsterMapRegistration(legacyOnly, {
    side: "FRONT", mapRevisionId: "map-revision-1",
  }).version, "opencv-human-anchor-registration-v1");
  const v2 = {
    ...legacy,
    version: "opencv-redundant-ransac-registration-v2",
    candidateProvenance: { candidateId: "lesson-1", source: "HUMAN_CORRECTION", lessonId: "lesson-1" },
    acceptance: {
      policyVersion: "speedster-map-registration-acceptance-v2",
      mode: "HUMAN_CONFIRMED",
      featureCount: 4,
      usableFeatureCount: 4,
      inlierCount: 4,
      inlierFraction: 1,
      perAnchorFeatureCounts: [1, 1, 1, 1],
      perAnchorInlierCounts: [1, 1, 1, 1],
      medianReprojectionErrorPx: 0,
      maxReprojectionErrorPx: 0,
    },
  };
  const v2Expected = {
    side: "FRONT" as const,
    mapRevisionId: "map-revision-1",
    zones: [mapBindingV2Zone],
  };
  const parsed = parseSpeedsterMapRegistration(v2, v2Expected);
  assert.equal(parsed.version, "opencv-redundant-ransac-registration-v2");
  assert.equal(parsed.acceptance?.mode, "HUMAN_CONFIRMED");
  assert.equal(parsed.candidateProvenance?.lessonId, "lesson-1");
  const automatic = {
    ...v2,
    candidateProvenance: { candidateId: "original-reference", source: "ORIGINAL_REFERENCE" },
    acceptance: {
      ...v2.acceptance,
      mode: "AUTOMATIC_RANSAC",
      featureCount: 16,
      usableFeatureCount: 12,
      inlierCount: 10,
      inlierFraction: 10 / 12,
      perAnchorFeatureCounts: [3, 3, 3, 3],
      perAnchorInlierCounts: [2, 2, 3, 3],
      medianReprojectionErrorPx: 0.8,
      maxReprojectionErrorPx: 2.4,
    },
  };
  assert.equal(parseSpeedsterMapRegistration(
    automatic, v2Expected,
  ).acceptance?.mode, "AUTOMATIC_RANSAC");
  assert.throws(() => parseSpeedsterMapRegistration({
    ...automatic,
    acceptance: {
      ...automatic.acceptance,
      inlierCount: 9,
      perAnchorInlierCounts: [2, 2, 2, 3],
    },
  }, v2Expected), /does not satisfy/);
  assert.throws(() => parseSpeedsterMapRegistration({
    ...v2,
    acceptance: { ...v2.acceptance, policyVersion: "client-policy" },
  }, v2Expected), /acceptance policy identity/);
  assert.throws(() => parseSpeedsterMapRegistration({
    ...automatic,
    anchors: automatic.anchors.map((anchor, index) => (
      index === 0 ? { ...anchor, score: 0.249 } : anchor
    )),
  }, v2Expected), /score is invalid/);
  assert.throws(() => parseSpeedsterMapRegistration({
    ...automatic,
    homography: [-1, 0, 1, 0, 1, 0, 0, 0, 1],
    anchors: automatic.anchors.map((anchor) => ({
      ...anchor,
      locatedPoint: { x: 1 - anchor.expectedPoint.x, y: anchor.expectedPoint.y },
    })),
  }, v2Expected), /reverses or folds orientation/);
});

test("server parser accepts only exact legacy or immutable-matching complete V2 projected-zone shapes", () => {
  const fixture = mapBindingFixture();
  const { serverReceipt: _receipt, ...legacy } = fixture.binding.registration.front;
  const legacyOnly = {
    ...legacy,
    projectedZones: legacy.projectedZones.map(({ id, label, semanticType, polygon }) => ({
      id, label, semanticType, polygon,
    })),
  };
  const rawV2 = v2Registration(legacy as typeof fixture.binding.registration.front);
  const expected = {
    side: "FRONT" as const,
    mapRevisionId: fixture.binding.revisionId,
    zones: [mapBindingV2Zone],
  };

  const geometryOnly = parseSpeedsterMapRegistration(rawV2, expected);
  assert.deepEqual(geometryOnly.projectedZones, [mapBindingV2Zone]);

  const complete = {
    ...rawV2,
    projectedZones: [mapBindingV2Zone],
  };
  assert.deepEqual(parseSpeedsterMapRegistration(complete, expected).projectedZones, [mapBindingV2Zone]);

  for (const [field, value] of [
    ["label", "Altered label"],
    ["contentType", "HEADER"],
    ["filterAuthority", false],
    ["filterAuthoritySource", "TYPE_DEFAULT"],
    ["filterPaddingMm", 0.7],
    ["proposalSource", "VISUAL_SNAP"],
    ["proposalConfidence", 0.9],
  ] as const) {
    assert.throws(() => parseSpeedsterMapRegistration({
      ...complete,
      projectedZones: [{ ...mapBindingV2Zone, [field]: value }],
    }, expected), /does not match the immutable revision|invalid for this immutable policy/);
  }

  const partial = structuredClone(complete);
  delete (partial.projectedZones[0] as { proposalConfidence?: unknown }).proposalConfidence;
  assert.throws(() => parseSpeedsterMapRegistration(partial, expected), /unsupported fields/);
  assert.throws(() => parseSpeedsterMapRegistration({
    ...complete,
    projectedZones: [{ ...mapBindingV2Zone, unsupportedMetadata: "browser-authored" }],
  }, expected), /unsupported fields/);

  const secondV2Zone = { ...mapBindingV2Zone, id: "zone-2", label: "Second printed text" };
  assert.throws(() => parseSpeedsterMapRegistration({
    ...complete,
    projectedZones: [
      mapBindingV2Zone,
      {
        id: secondV2Zone.id,
        label: secondV2Zone.label,
        semanticType: secondV2Zone.semanticType,
        polygon: secondV2Zone.polygon,
      },
    ],
  }, { ...expected, zones: [mapBindingV2Zone, secondV2Zone] }), /unsupported fields/);

  const expectedLegacyZone = {
    id: mapBindingV2Zone.id,
    label: mapBindingV2Zone.label,
    semanticType: mapBindingV2Zone.semanticType,
    polygon: mapBindingV2Zone.polygon,
  };
  assert.deepEqual(parseSpeedsterMapRegistration(legacyOnly, {
    side: "FRONT",
    mapRevisionId: fixture.binding.revisionId,
    zones: [expectedLegacyZone],
  }).projectedZones, [expectedLegacyZone]);
  assert.throws(() => parseSpeedsterMapRegistration(complete, {
    side: "FRONT",
    mapRevisionId: fixture.binding.revisionId,
    zones: [expectedLegacyZone],
  }), /has no immutable V2 authority/);
});

test("map registration never retries another scope after the selected revision fails", async () => {
  const fixture = mapBindingFixture();
  let lookupCalls = 0;
  let presignCalls = 0;

  await assert.rejects(() => speedsterServiceBody("map-registration", {
    sessionId: fixture.sessionId,
    side: "FRONT",
    currentPhysicalQuad: mapBindingQuad,
    currentOriginalStorageKey: `ai-grader-v2/admin-1/${fixture.sessionId}/original/front.jpg`,
    currentInspectionStorageKey: `ai-grader-v2/admin-1/${fixture.sessionId}/prepared/front/inspection.webp`,
  }, "admin-1", {
    async findOwnedCapture() { return null; },
    async presignRead() { presignCalls += 1; return "https://signed.invalid/not-reached"; },
    async findOwnedMapSession() { return fixture.session; },
    async loadActiveMap() {
      lookupCalls += 1;
      throw new Error("selected exact revision failed integrity validation");
    },
    async hashMapEvidence() { throw new Error("not reached"); },
  }), /selected exact revision failed integrity validation/);

  assert.equal(lookupCalls, 1);
  assert.equal(presignCalls, 0);
});

test("trace proposal authorizes a persisted non-ORIGINAL source view and supplies server findings", async () => {
  const sessionId = "speedster-12345678901234567890";
  const prefix = `ai-grader-v2/admin-1/${sessionId}/prepared/front`;
  const body = await speedsterServiceBody("trace-proposal", {
    sessionId,
    side: "FRONT",
    findingId: "front-directional-1",
    stroke: { canonicalPoints: [{ x: 1, y: 1 }], strokeWidthPixels: 1, strokeWidthMm: 1 },
    currentTraceWire: null,
  }, "admin-1", {
    async findOwnedCapture() {
      return {
        capture: {
          cornerShape: "SQUARE",
          front: {
            rectifiedStorageKey: `${prefix}/rectified.webp`,
            inspectionStorageKey: `${prefix}/inspection.webp`,
            inspectionFrame: { width: 1350, height: 1858, cardBounds: { x: 40, y: 40, width: 1270, height: 1778 } },
            viewStorageKeys: {
              NORMALIZED: `${prefix}/normalized.webp`,
              MICRO_DEFECT: `${prefix}/micro_defect.webp`,
              DIRECTIONAL: `${prefix}/directional.webp`,
            },
          },
        },
        reviewedDefects: [{
          id: "front-directional-1",
          side: "FRONT",
          zone: "SURFACE",
          defectType: "LIGHT_SCRATCH_SCUFF",
          confidence: 0.9,
          canonicalContour: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.1 }, { x: 0.2, y: 0.2 }],
          sourceViewId: "FRONT:DIRECTIONAL",
          supportingViewIds: [],
          reviewResult: "UNREVIEWED",
          measurement: {
            widthMm: 1,
            heightMm: 1,
            areaMm2: 1,
            zonePercent: 1,
            multiplier: 1,
            weightedAreaMm2: 1,
            subgradeEffect: 0,
          },
        }],
      };
    },
    async presignRead(storageKey) {
      assert.equal(storageKey, `${prefix}/directional.webp`);
      return "https://fresh.example/directional.webp";
    },
  }, "sam-request-123");

  assert.equal((body.evidenceView as { imageUrl: string }).imageUrl, "https://fresh.example/directional.webp");
  assert.equal((body.evidenceView as { id: string }).id, "FRONT:DIRECTIONAL");
  assert.equal(body.sourceViewId, "FRONT:DIRECTIONAL");
  assert.equal(body.cornerShape, "SQUARE");
  assert.equal(body.requestTraceId, "sam-request-123");
  assert.deepEqual(body.findings, []);
  assert.equal("sessionId" in body, false);
  assert.equal("currentTraceWire" in body, false);
});

test("trace proposal proxy preserves a sanitized upstream failure with its request ID", () => {
  assert.deepEqual(sanitizeSpeedsterTraceProposalFailure({
    detail: "RuntimeError: CUDA failed at https://signed.example/object?token=secret\nBearer sk-secret12345678",
  }, "sam-request-123"), {
    message: "SAM proposal failed: RuntimeError: CUDA failed at [redacted-url] Bearer [redacted-credential] (request sam-request-123).",
    requestId: "sam-request-123",
  });
});

test("PATCH rejects public report slug mutation through the generic route", async () => {
  let updateCalls = 0;
  const handler = createAiGraderV2SessionHandler({
    requireAdminSession: admin,
    async findSession() {
      return { id: "speedster-1", publicReportSlug: "tk-charizard-1" };
    },
    async updateSession() {
      updateCalls += 1;
      return {};
    },
  });
  const { state, res } = response();

  await handler(
    request("PATCH", { publicReportSlug: "tk-charizard-2" }, "speedster-1"),
    res,
  );

  assert.equal(state.status, 400);
  assert.equal(updateCalls, 0);
});

test("session routes expose only their direct methods", async () => {
  const create = createAiGraderV2SessionsHandler({
    requireAdminSession: admin,
    async createSession() {
      return {};
    },
  });
  const detail = createAiGraderV2SessionHandler({
    requireAdminSession: admin,
    async findSession() {
      return null;
    },
    async updateSession() {
      return {};
    },
  });
  const first = response();
  const second = response();

  await create(request("GET"), first.res);
  await detail(request("POST", {}, "speedster-1"), second.res);

  assert.equal(first.state.status, 405);
  assert.equal(first.state.allow, "POST");
  assert.equal(second.state.status, 405);
  assert.equal(second.state.allow, "GET, PATCH");
});
