import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  parseSpeedsterColorGeometryProposal,
  speedsterColorCenteringDraft,
  speedsterColorPhysicalDraft,
  type SpeedsterColorGeometryProposal,
} from "../lib/ai-grader-v2/color-geometry";
import {
  buildSpeedsterColorGeometryScore,
  buildSpeedsterColorGeometryScoreFromAggregates,
} from "../lib/ai-grader-v2/color-geometry-score";
import {
  issueSpeedsterColorGeometryReceipt,
  SPEEDSTER_COLOR_GEOMETRY_RECEIPT_MAX_AGE_MS,
  SpeedsterColorGeometryReceiptExpiredError,
  verifySpeedsterColorGeometryReceipt,
  type SpeedsterColorGeometryReceiptBinding,
} from "../lib/server/speedsterColorGeometryAuthority";

const quad = [
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.9, y: 0.9 },
  { x: 0.1, y: 0.9 },
] as const;

const proposal: SpeedsterColorGeometryProposal = {
  version: "speedster-color-geometry-proposal-v1",
  engineVersion: "speedster-color-geometry-v1",
  authority: "PROPOSER_ONLY",
  policyProvenance: "OWNER_APPROVED_OFFLINE_ESTIMATE_V1_NOT_LIVE_CALIBRATED",
  mode: "PRINTED_FRAME",
  outcome: "ACCEPTED",
  matColor: "WHITE",
  proposal: quad,
  contrastFloorDeltaE: 12,
  minimumSideSupport: 0.55,
  sideEvidence: Object.fromEntries(["top", "right", "bottom", "left"].map((side) => [side, {
    medianContrastDeltaE: 30,
    supportFraction: 0.8,
    sampleCount: 100,
    candidateCount: 1,
    ambiguous: false,
  }])) as SpeedsterColorGeometryProposal["sideEvidence"],
  ambiguity: { candidateCount: 1, runnerUpScoreRatio: null, ambiguous: false },
  advisory: null,
};

const receiptEnv = {
  SPEEDSTER_COLOR_GEOMETRY_RECEIPT_HMAC_KEY: "test_speedster_color_geometry_authority_secret_0123456789",
  SPEEDSTER_COLOR_GEOMETRY_RECEIPT_HMAC_KEY_ID: "test-speedster-color-key-v1",
} as unknown as NodeJS.ProcessEnv;

const binding: SpeedsterColorGeometryReceiptBinding = {
  operatorAdminId: "admin-1",
  sessionId: "session-1",
  side: "BACK",
  mode: "PRINTED_FRAME",
  sourceImageStorageKey: "ai-grader-v2/admin-1/session-1/original/back.jpg",
  sourceImageSha256: "a".repeat(64),
  matColor: "WHITE",
  physicalQuadSha256: "b".repeat(64),
  result: proposal,
};

test("color result contract is proposer-only and accepted requires an exact quad", () => {
  assert.deepEqual(parseSpeedsterColorGeometryProposal(proposal, {
    mode: "PRINTED_FRAME",
    matColor: "WHITE",
  }), proposal);
  assert.throws(() => parseSpeedsterColorGeometryProposal({ ...proposal, authority: "AUTOMATIC_COLOR_FRAME" }), /identity/);
  assert.throws(() => parseSpeedsterColorGeometryProposal({ ...proposal, proposal: null }), /inconsistent/);
});

test("accepted color result must satisfy the exact fixed v1 four-side policy", () => {
  const withTop = (top: Partial<SpeedsterColorGeometryProposal["sideEvidence"]["top"]>) => ({
    ...proposal,
    sideEvidence: {
      ...proposal.sideEvidence,
      top: { ...proposal.sideEvidence.top, ...top },
    },
  });
  assert.equal(parseSpeedsterColorGeometryProposal({
    ...proposal,
    ambiguity: { candidateCount: 2, runnerUpScoreRatio: 0.8999, ambiguous: false },
  }).outcome, "ACCEPTED");
  const acceptedPhysicalBlack = {
    ...proposal,
    mode: "PHYSICAL_OUTER",
    matColor: "BLACK",
    contrastFloorDeltaE: 18,
    minimumSideSupport: 0.7,
    sideEvidence: Object.fromEntries(Object.entries(proposal.sideEvidence).map(([side, evidence]) => [side, {
      ...evidence,
      medianLightnessContrast: 20,
    }])) as SpeedsterColorGeometryProposal["sideEvidence"],
    ambiguity: { candidateCount: 2, runnerUpScoreRatio: 0.9199, ambiguous: false },
  } as const;
  assert.equal(parseSpeedsterColorGeometryProposal(acceptedPhysicalBlack).outcome, "ACCEPTED");
  assert.throws(
    () => parseSpeedsterColorGeometryProposal({
      ...acceptedPhysicalBlack,
      sideEvidence: proposal.sideEvidence,
    }),
    /fixed v1 acceptance policy/,
  );
  assert.throws(
    () => parseSpeedsterColorGeometryProposal({
      ...acceptedPhysicalBlack,
      sideEvidence: {
        ...acceptedPhysicalBlack.sideEvidence,
        top: { ...acceptedPhysicalBlack.sideEvidence.top, medianLightnessContrast: 19.999 },
      },
    }),
    /fixed v1 acceptance policy/,
  );
  assert.throws(
    () => issueSpeedsterColorGeometryReceipt({
      ...binding,
      side: "FRONT",
      mode: "PHYSICAL_OUTER",
      matColor: "BLACK",
      physicalQuadSha256: null,
      result: { ...acceptedPhysicalBlack, sideEvidence: proposal.sideEvidence },
    }, { now: 1_000_000, env: receiptEnv }),
    /fixed v1 acceptance policy/,
    "A dark-on-black result that Python would abstain cannot receive server signing authority",
  );
  assert.throws(
    () => parseSpeedsterColorGeometryProposal({ ...proposal, contrastFloorDeltaE: 13 }),
    /evidence is malformed/,
  );
  assert.throws(
    () => parseSpeedsterColorGeometryProposal({ ...proposal, minimumSideSupport: 0.56 }),
    /evidence is malformed/,
  );
  assert.throws(
    () => parseSpeedsterColorGeometryProposal(withTop({ medianContrastDeltaE: 11.99 })),
    /fixed v1 acceptance policy/,
  );
  assert.throws(
    () => parseSpeedsterColorGeometryProposal(withTop({ supportFraction: 0.549 })),
    /fixed v1 acceptance policy/,
  );
  assert.throws(
    () => parseSpeedsterColorGeometryProposal(withTop({ ambiguous: true })),
    /fixed v1 acceptance policy/,
  );
  assert.throws(
    () => parseSpeedsterColorGeometryProposal({
      ...proposal,
      ambiguity: { candidateCount: 1, runnerUpScoreRatio: 0.9, ambiguous: false },
    }),
    /ambiguity evidence contradicts/,
  );
  assert.throws(
    () => parseSpeedsterColorGeometryProposal({
      ...proposal,
      ambiguity: { candidateCount: 1, runnerUpScoreRatio: null, ambiguous: true },
    }),
    /ambiguity evidence contradicts/,
  );
  assert.throws(
    () => parseSpeedsterColorGeometryProposal({
      ...proposal,
      ambiguity: { candidateCount: 2, runnerUpScoreRatio: null, ambiguous: false },
    }),
    /ambiguity evidence contradicts/,
  );
  assert.throws(
    () => parseSpeedsterColorGeometryProposal({
      ...proposal,
      ambiguity: { candidateCount: 2, runnerUpScoreRatio: 0.91, ambiguous: false },
    }),
    /ambiguity evidence contradicts/,
  );
  assert.throws(
    () => parseSpeedsterColorGeometryProposal({
      ...proposal,
      ambiguity: { candidateCount: 2, runnerUpScoreRatio: 0.89, ambiguous: true },
    }),
    /ambiguity evidence contradicts/,
  );
});

test("color receipt rejects result tampering and cross-session/side/image/physical-quad replay", () => {
  const now = 1_000_000;
  const receipt = issueSpeedsterColorGeometryReceipt(binding, { now, env: receiptEnv });
  verifySpeedsterColorGeometryReceipt(receipt, binding, { now: now + 1, env: receiptEnv });
  const attempts: SpeedsterColorGeometryReceiptBinding[] = [
    { ...binding, operatorAdminId: "admin-2" },
    { ...binding, sessionId: "session-2" },
    { ...binding, side: "FRONT" },
    { ...binding, mode: "PHYSICAL_OUTER" },
    { ...binding, matColor: "MAGENTA" },
    { ...binding, sourceImageStorageKey: "ai-grader-v2/admin-1/session-1/original/front.jpg" },
    { ...binding, sourceImageSha256: "c".repeat(64) },
    { ...binding, physicalQuadSha256: "d".repeat(64) },
    { ...binding, result: { ...proposal, minimumSideSupport: 0.56 } },
  ];
  for (const replay of attempts) {
    assert.throws(
      () => verifySpeedsterColorGeometryReceipt(receipt, replay, { now: now + 1, env: receiptEnv }),
      /does not match/,
    );
  }
  assert.throws(
    () => verifySpeedsterColorGeometryReceipt(receipt, binding, {
      now: now + SPEEDSTER_COLOR_GEOMETRY_RECEIPT_MAX_AGE_MS + 1,
      env: receiptEnv,
    }),
    (error: unknown) => error instanceof SpeedsterColorGeometryReceiptExpiredError,
  );
  const futureReceipt = issueSpeedsterColorGeometryReceipt(binding, { now: now + 5_001, env: receiptEnv });
  assert.throws(
    () => verifySpeedsterColorGeometryReceipt(futureReceipt, binding, { now, env: receiptEnv }),
    /does not match/,
  );
  assert.throws(
    () => issueSpeedsterColorGeometryReceipt(binding, { now, env: {} as NodeJS.ProcessEnv }),
    /authority is unavailable/,
  );
});

test("deterministic engine-error abstention parses and receives exact server receipt authority", () => {
  const engineError: SpeedsterColorGeometryProposal = {
    ...proposal,
    mode: "PHYSICAL_OUTER",
    outcome: "ABSTAIN",
    matColor: "BLACK",
    proposal: null,
    contrastFloorDeltaE: 18,
    minimumSideSupport: 0.7,
    sideEvidence: Object.fromEntries(["top", "right", "bottom", "left"].map((side) => [side, {
      medianContrastDeltaE: 0,
      supportFraction: 0,
      sampleCount: 0,
      candidateCount: 0,
      ambiguous: false,
    }])) as SpeedsterColorGeometryProposal["sideEvidence"],
    ambiguity: { candidateCount: 0, runnerUpScoreRatio: null, ambiguous: false },
    advisory: {
      code: "COLOR_ENGINE_ERROR",
      recommendedMat: null,
      message: "Color geometry could not evaluate this image. The unchanged legacy proposal remains active.",
    },
  };
  const parsed = parseSpeedsterColorGeometryProposal(engineError, {
    mode: "PHYSICAL_OUTER",
    matColor: "BLACK",
  });
  assert.deepEqual(parsed, engineError);
  const engineErrorBinding: SpeedsterColorGeometryReceiptBinding = {
    ...binding,
    side: "FRONT",
    mode: "PHYSICAL_OUTER",
    matColor: "BLACK",
    physicalQuadSha256: null,
    result: parsed,
  };
  const receipt = issueSpeedsterColorGeometryReceipt(engineErrorBinding, { now: 2_000_000, env: receiptEnv });
  verifySpeedsterColorGeometryReceipt(receipt, engineErrorBinding, { now: 2_000_001, env: receiptEnv });
});

test("all four visible outcomes retain exact evidence while only ACCEPTED can seed its matching draft", () => {
  const manual = [
    { x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.8, y: 0.8 }, { x: 0.2, y: 0.8 },
  ] as const;
  const outcomes = ["ACCEPTED", "INSUFFICIENT_EVIDENCE", "NOT_APPLICABLE", "ABSTAIN"] as const;
  for (const [index, outcome] of outcomes.entries()) {
    const result: SpeedsterColorGeometryProposal = outcome === "ACCEPTED" ? proposal : {
      ...proposal,
      outcome,
      proposal: null,
      advisory: {
        code: `VISIBLE_${outcome}`,
        recommendedMat: outcome === "ABSTAIN" ? "MAGENTA" : null,
        message: `${outcome} remains visible and requires human geometry.`,
      },
    };
    const parsed = parseSpeedsterColorGeometryProposal(result, {
      mode: "PRINTED_FRAME",
      matColor: "WHITE",
    });
    const outcomeBinding = { ...binding, result: parsed };
    const receipt = issueSpeedsterColorGeometryReceipt(outcomeBinding, {
      now: 3_000_000 + index,
      env: receiptEnv,
    });
    verifySpeedsterColorGeometryReceipt(receipt, outcomeBinding, {
      now: 3_000_100,
      env: receiptEnv,
    });
    assert.deepEqual(
      speedsterColorCenteringDraft(parsed, manual),
      outcome === "ACCEPTED" ? quad : manual,
      `${outcome} must not silently replace human geometry`,
    );
    assert.deepEqual(
      speedsterColorPhysicalDraft({
        ...parsed,
        mode: "PHYSICAL_OUTER",
        contrastFloorDeltaE: 18,
        minimumSideSupport: 0.7,
      }, manual),
      outcome === "ACCEPTED" ? quad : manual,
      `${outcome} must not silently replace physical geometry`,
    );
    if (outcome !== "ACCEPTED") {
      assert.throws(
        () => parseSpeedsterColorGeometryProposal({ ...result, proposal: quad }),
        /inconsistent/,
        `${outcome} cannot carry an autoaccepted proposal`,
      );
    }
  }
  assert.deepEqual(speedsterColorCenteringDraft({
    ...proposal,
    mode: "PHYSICAL_OUTER",
    contrastFloorDeltaE: 18,
    minimumSideSupport: 0.7,
  }, manual), manual, "physical color geometry never owns a centering draft");
  assert.deepEqual(speedsterColorPhysicalDraft(proposal, manual), manual, "printed color geometry never owns a physical draft");
});

test("color is permitted to seed only the matching editable geometry assist and never map registration/zones/filter inputs", () => {
  assert.deepEqual(speedsterColorCenteringDraft(proposal, [
    { x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.8, y: 0.8 }, { x: 0.2, y: 0.8 },
  ]), quad);
  const fallback = { ...proposal, outcome: "ABSTAIN" as const, proposal: null };
  const manual = [
    { x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.8, y: 0.8 }, { x: 0.2, y: 0.8 },
  ] as const;
  assert.deepEqual(speedsterColorCenteringDraft(fallback, manual), manual);
  assert.deepEqual(speedsterColorPhysicalDraft({
    ...proposal,
    mode: "PHYSICAL_OUTER",
    matColor: "BLACK",
    contrastFloorDeltaE: 18,
    minimumSideSupport: 0.7,
    sideEvidence: Object.fromEntries(Object.entries(proposal.sideEvidence).map(([side, evidence]) => [side, {
      ...evidence,
      medianLightnessContrast: 20,
    }])) as SpeedsterColorGeometryProposal["sideEvidence"],
  }, manual), quad);
  assert.deepEqual(speedsterColorPhysicalDraft({
    ...fallback,
    mode: "PHYSICAL_OUTER",
    matColor: "BLACK",
    contrastFloorDeltaE: 18,
    minimumSideSupport: 0.7,
  }, manual), manual);

  const service = readFileSync(new URL("../lib/ai-grader-v2/image-service.ts", import.meta.url), "utf8");
  const registerStart = service.indexOf("  registerMap(");
  const registerEnd = service.indexOf("  rescueMapRegistration(", registerStart);
  const registerMapBody = registerStart >= 0 && registerEnd > registerStart
    ? service.slice(registerStart, registerEnd)
    : "";
  assert.ok(registerMapBody);
  assert.doesNotMatch(registerMapBody, /colorGeometry|matColor|proposal/i);
  const workspace = readFileSync(new URL("../components/ai-grader-v2/CaptureWorkspace.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(workspace, /registerMap\([^)]*colorGeometry/s);
  assert.doesNotMatch(workspace, /projectedZones\s*[:=].*color/s);
  assert.doesNotMatch(workspace, /filter.*colorGeometry/i);
  assert.doesNotMatch(workspace, /(?:gradeReport|reviewedDefects|grading)[^\n]*colorGeometry|colorGeometry[^\n]*(?:gradeReport|reviewedDefects|grading)/i);
  const sessionRoute = readFileSync(new URL("../pages/api/admin/ai-grader-v2/sessions/[sessionId].ts", import.meta.url), "utf8");
  const persistenceStart = sessionRoute.indexOf("export async function parseSpeedsterColorGeometryCaptureRows");
  const persistenceEnd = sessionRoute.indexOf("export function createAiGraderV2SessionHandler", persistenceStart);
  const persistenceBody = persistenceStart >= 0 && persistenceEnd > persistenceStart
    ? sessionRoute.slice(persistenceStart, persistenceEnd)
    : "";
  assert.ok(persistenceBody);
  assert.doesNotMatch(persistenceBody, /gradeReport|reviewedDefects|mapFilterDecision|projectedZones/i);
});

test("running score exposes accepted/corrected/manual plus side-and-mat and per-card drilldown", () => {
  const rows = [
    { sessionId: "s2", side: "BACK", mode: "PHYSICAL_OUTER", matColor: "WHITE", outcome: "ACCEPTED", proposalChanged: false, createdAt: new Date("2026-08-13T02:00:00Z"), session: { cardProfile: "POKEMON", identity: { cardName: "B" } } },
    { sessionId: "s2", side: "BACK", mode: "PRINTED_FRAME", matColor: "WHITE", outcome: "ABSTAIN", proposalChanged: null, createdAt: new Date("2026-08-13T02:00:00Z"), session: { cardProfile: "POKEMON", identity: { cardName: "B" } } },
    { sessionId: "s1", side: "FRONT", mode: "PHYSICAL_OUTER", matColor: "BLACK", outcome: "ACCEPTED", proposalChanged: true, createdAt: new Date("2026-08-13T01:00:00Z"), session: { cardProfile: "POKEMON", identity: { cardName: "A" } } },
  ] as const;
  const score = buildSpeedsterColorGeometryScore(rows);
  assert.equal(score.totalResults, 3);
  assert.equal(score.acceptedUnchanged, 1);
  assert.equal(score.correctedAccepted, 1);
  assert.equal(score.manualFallbacks, 1);
  assert.equal(score.proposalAgreementRate, 0.5);
  assert.equal(score.firstDraftYieldRate, 1 / 3);
  assert.equal(score.proposalCoverageRate, 2 / 3);
  assert.equal(score.breakdown.length, 2);
  assert.deepEqual(
    score.breakdown.map((row) => [row.side, row.matColor, row.proposalAgreementRate, row.proposalCoverageRate]),
    [["BACK", "WHITE", 1, 0.5], ["FRONT", "BLACK", 0, 1]],
  );
  assert.deepEqual(score.recentCards.map(({ sessionId }) => sessionId), ["s2", "s1"]);
  assert.deepEqual(buildSpeedsterColorGeometryScoreFromAggregates([
    { side: "BACK", matColor: "WHITE", outcome: "ACCEPTED", proposalChanged: false, count: 1 },
    { side: "BACK", matColor: "WHITE", outcome: "ABSTAIN", proposalChanged: null, count: 1 },
    { side: "FRONT", matColor: "BLACK", outcome: "ACCEPTED", proposalChanged: true, count: 1 },
  ], rows), score, "bounded database aggregates must preserve the full running score");

  const route = readFileSync(new URL("../pages/api/admin/ai-grader-v2/color-geometry-score.ts", import.meta.url), "utf8");
  assert.match(route, /requireAdminSession\(req\)/);
  assert.match(route, /Cache-Control", "no-store/);
  assert.match(route, /where: \{ createdByUserId: admin\.user\.id \}/);
  assert.match(route, /groupBy\(\{[\s\S]*by: \["side", "matColor", "outcome", "proposalChanged"\]/);
  assert.match(route, /groupBy\(\{[\s\S]*by: \["sessionId"\][\s\S]*take: RECENT_CARD_LIMIT/);
});
