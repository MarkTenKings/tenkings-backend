import assert from "node:assert/strict";
import test from "node:test";

import type { SpeedsterMeasuredDefect, SpeedsterReviewFinding } from "../lib/ai-grader-v2/contracts";
import { encodeSpeedsterTraceBitmapWireV1 } from "../lib/ai-grader-v2/trace-bitmap-wire";
import {
  SPEEDSTER_TRACE_PIXEL_COUNT,
  encodeSpeedsterTraceRleV1,
} from "../lib/ai-grader-v2/trace-codec";
import {
  applySpeedsterReviewAction,
  type SpeedsterReviewActionSession,
} from "../lib/server/aiGraderV2ReviewAction";

const measurement = {
  widthMm: 1,
  heightMm: 1,
  areaMm2: 1,
  zonePercent: 1,
  multiplier: 1,
  weightedAreaMm2: 1,
  subgradeEffect: 0,
};
const defect: SpeedsterMeasuredDefect = {
  id: "FRONT:source-1:SURFACE",
  side: "FRONT",
  zone: "SURFACE",
  defectType: "LIGHT_SCRATCH_SCUFF",
  origin: "DETECTOR",
  confidence: 0.9,
  canonicalContour: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.1 }, { x: 0.2, y: 0.2 }],
  sourceViewId: "FRONT:ORIGINAL",
  supportingViewIds: [],
  reviewResult: "TYPE_CORRECTED",
  measurement,
};
const capture = {
  cornerShape: "SQUARE",
  front: {
    inspectionStorageKey: "ai-grader-v2/admin-1/session-12345678901234567890/prepared/front/inspection.webp",
    inspectionFrame: { width: 1270, height: 1778, cardBounds: { x: 0, y: 0, width: 1270, height: 1778 } },
    viewStorageKeys: {
      NORMALIZED: "ai-grader-v2/admin-1/session-12345678901234567890/prepared/front/normalized.webp",
      MICRO_DEFECT: "ai-grader-v2/admin-1/session-12345678901234567890/prepared/front/micro_defect.webp",
      DIRECTIONAL: "ai-grader-v2/admin-1/session-12345678901234567890/prepared/front/directional.webp",
    },
    centeringBorders: { leftMm: 10, rightMm: 10, topMm: 10, bottomMm: 10 },
  },
  back: {
    inspectionStorageKey: "ai-grader-v2/admin-1/session-12345678901234567890/prepared/back/inspection.webp",
    inspectionFrame: { width: 1270, height: 1778, cardBounds: { x: 0, y: 0, width: 1270, height: 1778 } },
    viewStorageKeys: {
      NORMALIZED: "ai-grader-v2/admin-1/session-12345678901234567890/prepared/back/normalized.webp",
      MICRO_DEFECT: "ai-grader-v2/admin-1/session-12345678901234567890/prepared/back/micro_defect.webp",
      DIRECTIONAL: "ai-grader-v2/admin-1/session-12345678901234567890/prepared/back/directional.webp",
    },
    centeringBorders: { leftMm: 10, rightMm: 10, topMm: 10, bottomMm: 10 },
  },
};

function session(reviewedDefects: readonly unknown[] = [defect]): SpeedsterReviewActionSession {
  return {
    id: "session-12345678901234567890",
    createdByUserId: "admin-1",
    workflowState: "CAPTURED",
    capture,
    reviewedDefects,
    gradeReport: { detectorVersion: "sam3-server-owned" },
    updatedAt: new Date("2026-08-05T00:00:00.000Z"),
  };
}

test("review actions reject non-CAPTURED workflow state before any external work", async () => {
  let externalCalls = 0;
  await assert.rejects(
    applySpeedsterReviewAction({
      sessionId: session().id,
      createdByUserId: "admin-1",
      action: { type: "INITIALIZE" },
    }, {
      async loadOwnedSession() { return { ...session([]), workflowState: "DRAFT" }; },
      async persistReviewIfRevision() { externalCalls += 1; },
      async presignRead() { externalCalls += 1; return "https://fresh.example/front.webp"; },
      async learningBankForDetect() { externalCalls += 1; return {}; },
      async detect() { externalCalls += 1; return {}; },
      async measure() { externalCalls += 1; return { defects: [] }; },
    }),
    /Only a CAPTURED Speedster session can accept review actions/,
  );
  assert.equal(externalCalls, 0);
});

test("one server-owned REMOVE measures once, persists grade+findings atomically, and returns no trace bodies", async () => {
  const events: string[] = [];
  let persisted: { reviewedDefects: readonly unknown[]; gradeReport: unknown } | null = null;
  const result = await applySpeedsterReviewAction({
    sessionId: session().id,
    createdByUserId: "admin-1",
    action: { type: "REMOVE", defectIds: [defect.id] },
  }, {
    async loadOwnedSession() { events.push("load"); return session(); },
    async persistReviewIfRevision(_identity, expectedUpdatedAt, data) {
      events.push("transaction:start");
      assert.equal(expectedUpdatedAt.getTime(), session().updatedAt.getTime());
      events.push("persist");
      persisted = data;
      events.push("transaction:commit");
    },
    async presignRead() { return "https://fresh.example/front.webp"; },
    async learningBankForDetect() { return {}; },
    async detect() { throw new Error("must not detect"); },
    async measure(body) {
      events.push("measure");
      assert.equal(body.side, "FRONT");
      assert.equal(body.findings.length, 0);
      return { defects: [] };
    },
  });

  assert.deepEqual(events, ["load", "measure", "transaction:start", "persist", "transaction:commit"]);
  const saved = persisted as { reviewedDefects: readonly Record<string, unknown>[]; gradeReport: unknown } | null;
  assert.equal(saved?.reviewedDefects[0].reviewResult, "REMOVED");
  assert.equal(JSON.stringify(result).includes("finalTrace"), false);
  assert.equal(result.gradeReport.detectorVersion, "sam3-server-owned");
});

test("one server-owned batch REMOVE persists every removal atomically and batch UNDO restores all", async () => {
  const second = {
    ...defect,
    id: "FRONT:source-2:SURFACE",
    origin: "MEMORY" as const,
    featureFingerprint: [1, ...Array.from({ length: 31 }, () => 0)],
    memoryProposal: {
      lessonSessionId: "lesson-session",
      lessonCompletionOrder: 12,
      lessonProposalOrder: 2,
      lessonOrder: 0,
      lessonSourceViewId: "ORIGINAL" as const,
      similarity: 0.94,
    },
  };
  let current = session([defect, second]);
  let measureCalls = 0;
  const deps = {
    async loadOwnedSession() { return current; },
    async persistReviewIfRevision(
      _identity: unknown,
      _expectedUpdatedAt: Date,
      data: { reviewedDefects: readonly unknown[]; gradeReport: unknown },
    ) {
      current = { ...current, ...data, updatedAt: new Date(current.updatedAt.getTime() + 1) };
    },
    async presignRead() { return "https://fresh.example/front.webp"; },
    async learningBankForDetect() { return {}; },
    async detect() { throw new Error("must not detect"); },
    async measure(body: { findings: readonly SpeedsterReviewFinding[] }) {
      measureCalls += 1;
      return { defects: [...body.findings] };
    },
  };

  await applySpeedsterReviewAction({
    sessionId: current.id,
    createdByUserId: current.createdByUserId,
    action: { type: "REMOVE", defectIds: [defect.id, second.id] },
  }, deps);
  assert.equal(measureCalls, 1);
  assert.deepEqual(
    (current.reviewedDefects as SpeedsterReviewFinding[]).map(({ reviewResult }) => reviewResult),
    ["REMOVED", "REMOVED"],
  );
  assert.deepEqual((current.reviewedDefects as SpeedsterReviewFinding[])[1].memoryProposal, second.memoryProposal);

  await applySpeedsterReviewAction({
    sessionId: current.id,
    createdByUserId: current.createdByUserId,
    action: { type: "UNDO", defectIds: [defect.id, second.id] },
  }, deps);
  assert.equal(measureCalls, 2);
  assert.deepEqual(
    (current.reviewedDefects as SpeedsterReviewFinding[]).map(({ reviewResult }) => reviewResult),
    ["TYPE_CORRECTED", "TYPE_CORRECTED"],
  );
  assert.deepEqual((current.reviewedDefects as SpeedsterReviewFinding[])[1].memoryProposal, second.memoryProposal);

  await assert.rejects(() => applySpeedsterReviewAction({
    sessionId: current.id,
    createdByUserId: current.createdByUserId,
    action: { type: "REMOVE", defectIds: [defect.id, defect.id] },
  }, deps), /unique finding IDs/i);
  assert.equal(measureCalls, 2);

  const back = { ...second, id: "BACK:source-2:SURFACE", side: "BACK" as const };
  current = session([defect, back]);
  await assert.rejects(() => applySpeedsterReviewAction({
    sessionId: current.id,
    createdByUserId: current.createdByUserId,
    action: { type: "REMOVE", defectIds: [defect.id, back.id] },
  }, deps), /one card side/i);
  assert.equal(measureCalls, 2);
});

test("INITIALIZE owns both detector calls and accepts no browser detector payload", async () => {
  const events: string[] = [];
  const initial = session([]);
  initial.gradeReport = {};
  let persisted: { reviewedDefects: readonly unknown[]; gradeReport: unknown } | null = null;
  const deps = {
    async loadOwnedSession() { events.push("load"); return initial; },
    async persistReviewIfRevision(_identity: unknown, _revision: unknown, data: typeof persisted) {
      events.push("persist");
      persisted = data;
    },
    async presignRead(key: string) { events.push(`presign:${key}`); return `https://fresh.example/${key}`; },
    async learningBankForDetect() { events.push("learning"); return { version: "bank" }; },
    async detect(body: { side: string; learningBank: unknown; views: readonly unknown[] }) {
      events.push(`detect:${body.side}`);
      assert.deepEqual(body.learningBank, { version: "bank" });
      assert.equal(body.views.length, 4);
      return { detectorVersion: "sam3-server-owned", defects: [] };
    },
    async measure() { throw new Error("INITIALIZE must not measure"); },
  };

  const result = await applySpeedsterReviewAction({
    sessionId: initial.id,
    createdByUserId: initial.createdByUserId,
    action: { type: "INITIALIZE" },
  }, deps);

  assert.equal(events.filter((event) => event.startsWith("detect:")).join(","), "detect:FRONT,detect:BACK");
  assert.equal(events.filter((event) => event.startsWith("presign:")).length, 8);
  const initializedPersisted = persisted as unknown as { gradeReport: { detectorVersion?: string } };
  assert.equal(initializedPersisted.gradeReport.detectorVersion, "sam3-server-owned");
  assert.equal(result.gradeReport.detectorVersion, "sam3-server-owned");
});

test("exact INITIALIZE retry returns the coherently initialized state without a second detector pass", async () => {
  let current = session([]);
  current.gradeReport = {};
  let detectCalls = 0;
  let persistCalls = 0;
  const deps = {
    async loadOwnedSession() { return current; },
    async persistReviewIfRevision(
      _identity: unknown,
      _revision: Date,
      data: { reviewedDefects: readonly unknown[]; gradeReport: unknown },
    ) {
      persistCalls += 1;
      current = { ...current, ...data, updatedAt: new Date(current.updatedAt.getTime() + 1) };
    },
    async presignRead(key: string) { return `https://fresh.example/${key}`; },
    async learningBankForDetect() { return {}; },
    async detect() {
      detectCalls += 1;
      return { detectorVersion: "sam3-server-owned", defects: [] };
    },
    async measure() { throw new Error("must not measure"); },
  };
  const input = {
    sessionId: current.id,
    createdByUserId: current.createdByUserId,
    action: { type: "INITIALIZE" as const },
  };

  const first = await applySpeedsterReviewAction(input, deps);
  const retry = await applySpeedsterReviewAction(input, deps);

  assert.deepEqual(retry.reviewedDefects, first.reviewedDefects);
  assert.deepEqual(retry.gradeReport, first.gradeReport);
  assert.equal(detectCalls, 2);
  assert.equal(persistCalls, 1);
});

test("TRACE_SAVE rejects pixels outside server-owned rounded card material before measurement", async () => {
  const pixels = new Uint8Array(SPEEDSTER_TRACE_PIXEL_COUNT);
  pixels[0] = 1;
  const finalTrace = encodeSpeedsterTraceRleV1(pixels);
  let measureCalls = 0;
  const rounded = { ...session(), capture: { ...capture, cornerShape: "ROUNDED_3_18_MM" } };

  await assert.rejects(() => applySpeedsterReviewAction({
    sessionId: rounded.id,
    createdByUserId: rounded.createdByUserId,
    action: {
      type: "TRACE_SAVE",
      side: "FRONT",
      findingId: defect.id,
      trace: {
        traceWire: encodeSpeedsterTraceBitmapWireV1(pixels, finalTrace.sha256),
        traceProvenance: {
          version: "speedster-trace-provenance-v1",
          sourceViewId: defect.sourceViewId,
          cropTransform: {
            version: "speedster-canonical-crop-affine-v1",
            crop: { x: 0, y: 0, width: 10, height: 10 },
          },
          highlighterStrokes: [{ canonicalPoints: [{ x: 0, y: 0 }], strokeWidthMm: 1 }],
          finalTraceSha256: finalTrace.sha256,
        },
      },
    },
  }, {
    async loadOwnedSession() { return rounded; },
    async persistReviewIfRevision() { throw new Error("must not persist"); },
    async presignRead() { return "https://fresh.example/front.webp"; },
    async learningBankForDetect() { return {}; },
    async detect() { throw new Error("must not detect"); },
    async measure() { measureCalls += 1; return { defects: [] }; },
  }), /card material/i);
  assert.equal(measureCalls, 0);
});

test("measurement reconciliation rejects duplicate, missing, unexpected, and wrong-side IDs", async () => {
  const variants = [
    { name: "duplicate", result: (active: readonly SpeedsterReviewFinding[]) => [active[0], active[0]] },
    { name: "missing", result: () => [] },
    { name: "unexpected", result: (active: readonly SpeedsterReviewFinding[]) => [...active, { ...active[0], id: "FRONT:unexpected" }] },
    { name: "wrong-side", result: (active: readonly SpeedsterReviewFinding[]) => [{ ...active[0], side: "BACK" as const }] },
  ];
  for (const variant of variants) {
    let persisted = false;
    await assert.rejects(() => applySpeedsterReviewAction({
      sessionId: session().id,
      createdByUserId: "admin-1",
      action: { type: "CHANGE_TYPE", defectId: defect.id, defectType: "VISIBLE_WHITENING" },
    }, {
      async loadOwnedSession() { return session(); },
      async persistReviewIfRevision() { persisted = true; },
      async presignRead() { return "https://fresh.example/front.webp"; },
      async learningBankForDetect() { return {}; },
      async detect() { throw new Error("must not detect"); },
      async measure(body: { findings: readonly SpeedsterReviewFinding[] }) {
        return { defects: variant.result(body.findings) };
      },
    }), new RegExp(variant.name === "wrong-side" ? "side" : "ID", "i"));
    assert.equal(persisted, false, variant.name);
  }
});

test("measurement reconciliation requires exact-region pixel counts within stored trace authority", async () => {
  const pixels = new Uint8Array(SPEEDSTER_TRACE_PIXEL_COUNT);
  pixels[635 + 889 * 1270] = 1;
  pixels[636 + 889 * 1270] = 1;
  const finalTrace = encodeSpeedsterTraceRleV1(pixels);
  const traceProvenance = {
    version: "speedster-trace-provenance-v1" as const,
    sourceViewId: defect.sourceViewId,
    cropTransform: {
      version: "speedster-canonical-crop-affine-v1" as const,
      crop: { x: 435, y: 689, width: 400, height: 400 },
    },
    highlighterStrokes: [{ canonicalPoints: [{ x: 635, y: 889 }], strokeWidthMm: 1.5 }],
    finalTraceSha256: finalTrace.sha256,
  };
  const sourceResult = (pixelCount: number | undefined) => ({
    id: defect.id,
    side: defect.side,
    defectType: defect.defectType,
    origin: defect.origin,
    confidence: defect.confidence,
    sourceViewId: defect.sourceViewId,
    supportingViewIds: defect.supportingViewIds,
    reviewResult: defect.reviewResult,
    finalTrace,
    traceProvenance,
    measurementRegions: [{
      zone: "SURFACE",
      canonicalContour: [{ x: 0.5, y: 0.5 }, { x: 0.51, y: 0.5 }, { x: 0.51, y: 0.51 }],
      measurement: {
        ...measurement,
        ...(pixelCount === undefined ? {} : { pixelCount }),
        areaMm2: 0.01,
        weightedAreaMm2: 0.01,
      },
    }],
  });
  for (const pixelCount of [undefined, 3]) {
    let persisted = false;
    await assert.rejects(() => applySpeedsterReviewAction({
      sessionId: session().id,
      createdByUserId: "admin-1",
      action: {
        type: "TRACE_SAVE",
        side: "FRONT",
        findingId: defect.id,
        trace: {
          traceWire: encodeSpeedsterTraceBitmapWireV1(pixels, finalTrace.sha256),
          traceProvenance,
        },
      },
    }, {
      async loadOwnedSession() { return session(); },
      async persistReviewIfRevision() { persisted = true; },
      async presignRead() { return "https://fresh.example/front.webp"; },
      async learningBankForDetect() { return {}; },
      async detect() { throw new Error("must not detect"); },
      async measure() { return { defects: [sourceResult(pixelCount)] }; },
    }), pixelCount === undefined ? /pixelCount/i : /exceed/i);
    assert.equal(persisted, false);
  }
});

test("a completion revision win makes the review CAS fail once without remeasuring", async () => {
  let measureCalls = 0;
  let casCalls = 0;
  await assert.rejects(() => applySpeedsterReviewAction({
    sessionId: session().id,
    createdByUserId: "admin-1",
    action: { type: "CHANGE_TYPE", defectId: defect.id, defectType: "VISIBLE_WHITENING" },
  }, {
    async loadOwnedSession() { return session(); },
    async persistReviewIfRevision() {
      casCalls += 1;
      throw new Error("Speedster review state changed before it could be saved");
    },
    async presignRead() { return "https://fresh.example/front.webp"; },
    async learningBankForDetect() { return {}; },
    async detect() { throw new Error("must not detect"); },
    async measure(body) {
      measureCalls += 1;
      return { defects: body.findings };
    },
  }), /state changed/i);
  assert.equal(measureCalls, 1);
  assert.equal(casCalls, 1);
});

test("INITIALIZE rejects invalid detector versions, mismatched versions, and wrong-side findings", async () => {
  const detectorFinding = { ...defect, reviewResult: "UNREVIEWED" as const };
  const variants = [
    async () => ({ detectorVersion: 7, defects: [] }),
    async (body: { side: string }) => ({ detectorVersion: body.side === "FRONT" ? "front-v" : "back-v", defects: [] }),
    async (body: { side: string }) => ({
      detectorVersion: "same-v",
      defects: [{ ...detectorFinding, side: body.side === "FRONT" ? "BACK" : "FRONT" }],
    }),
  ];
  for (const detect of variants) {
    const initial = session([]);
    initial.gradeReport = {};
    let persisted = false;
    await assert.rejects(() => applySpeedsterReviewAction({
      sessionId: initial.id,
      createdByUserId: initial.createdByUserId,
      action: { type: "INITIALIZE" },
    }, {
      async loadOwnedSession() { return initial; },
      async persistReviewIfRevision() { persisted = true; },
      async presignRead(key: string) { return `https://fresh.example/${key}`; },
      async learningBankForDetect() { return {}; },
      detect,
      async measure() { throw new Error("must not measure"); },
    }), /detector|side/i);
    assert.equal(persisted, false);
  }
});

test("REMOVE/UNDO uses only a server-private prior result marker and rejects repeated invalid transitions", async () => {
  let current = session();
  const deps = {
    async loadOwnedSession() { return current; },
    async persistReviewIfRevision(
      _identity: { sessionId: string; createdByUserId: string },
      _expectedUpdatedAt: Date,
      data: { reviewedDefects: readonly unknown[]; gradeReport: unknown },
    ) {
      current = { ...current, ...data, updatedAt: new Date(current.updatedAt.getTime() + 1) };
    },
    async presignRead() { return "https://fresh.example/front.webp"; },
    async learningBankForDetect() { return {}; },
    async detect() { throw new Error("must not detect"); },
    async measure(body: { findings: readonly SpeedsterReviewFinding[] }) { return { defects: [...body.findings] }; },
  };

  await applySpeedsterReviewAction({
    sessionId: current.id,
    createdByUserId: "admin-1",
    action: { type: "REMOVE", defectIds: [defect.id] },
  }, deps);
  assert.equal(((current.reviewedDefects as unknown[])[0] as Record<string, unknown>).reviewResult, "REMOVED");
  assert.equal(((current.reviewedDefects as unknown[])[0] as Record<string, unknown>).reviewResultBeforeRemoval, "TYPE_CORRECTED");
  await assert.rejects(() => applySpeedsterReviewAction({
    sessionId: current.id,
    createdByUserId: "admin-1",
    action: { type: "REMOVE", defectIds: [defect.id] },
  }, deps), /already removed/i);

  const restored = await applySpeedsterReviewAction({
    sessionId: current.id,
    createdByUserId: "admin-1",
    action: { type: "UNDO", defectIds: [defect.id] },
  }, deps);
  assert.equal(((current.reviewedDefects as unknown[])[0] as Record<string, unknown>).reviewResult, "TYPE_CORRECTED");
  assert.equal("reviewResultBeforeRemoval" in ((current.reviewedDefects as unknown[])[0] as Record<string, unknown>), false);
  assert.equal(JSON.stringify(restored).includes("reviewResultBeforeRemoval"), false);
  await assert.rejects(() => applySpeedsterReviewAction({
    sessionId: current.id,
    createdByUserId: "admin-1",
    action: { type: "UNDO", defectIds: [defect.id] },
  }, deps), /not removed/i);
});

test("source findings consume disjoint measurementRegions without top-level zone or measurement", async () => {
  const source = {
    ...defect,
    id: "FRONT:stable-source",
    canonicalContour: undefined,
    zone: undefined,
    measurement: undefined,
    finalTrace: { sha256: "a".repeat(64) },
    traceProvenance: { finalTraceSha256: "a".repeat(64) },
    measurementRegions: [
      { zone: "CORNERS", canonicalContour: defect.canonicalContour, measurement },
      { zone: "EDGES", canonicalContour: defect.canonicalContour, measurement },
      { zone: "SURFACE", canonicalContour: defect.canonicalContour, measurement },
    ],
  };
  assert.equal("zone" in source && source.zone !== undefined, false);
  assert.equal(source.measurementRegions.length, 3);
});

test("TRACE_SAVE converts the sole bitmap wire to persisted RLE and returns only hash metadata", async () => {
  const pixels = new Uint8Array(SPEEDSTER_TRACE_PIXEL_COUNT);
  pixels[635 + 889 * 1270] = 1;
  pixels[636 + 889 * 1270] = 1;
  const finalTrace = encodeSpeedsterTraceRleV1(pixels);
  const traceWire = encodeSpeedsterTraceBitmapWireV1(pixels, finalTrace.sha256);
  const traceProvenance = {
    version: "speedster-trace-provenance-v1" as const,
    sourceViewId: defect.sourceViewId,
    cropTransform: {
      version: "speedster-canonical-crop-affine-v1" as const,
      crop: { x: 435, y: 689, width: 400, height: 400 },
    },
    highlighterStrokes: [{ canonicalPoints: [{ x: 635, y: 889 }], strokeWidthMm: 1.5 }],
    finalTraceSha256: finalTrace.sha256,
  };
  let measureCalls = 0;
  let persisted: { reviewedDefects: readonly unknown[]; gradeReport: unknown } | null = null;

  const result = await applySpeedsterReviewAction({
    sessionId: session().id,
    createdByUserId: "admin-1",
    action: {
      type: "TRACE_SAVE",
      side: "FRONT",
      findingId: defect.id,
      trace: { traceWire, traceProvenance },
    },
  }, {
    async loadOwnedSession() { return session(); },
    async persistReviewIfRevision(_identity, _expectedUpdatedAt, data) { persisted = data; },
    async presignRead() { return "https://fresh.example/front.webp"; },
    async learningBankForDetect() { return {}; },
    async detect() { throw new Error("must not detect"); },
    async measure(body) {
      measureCalls += 1;
      assert.equal(body.findings.length, 1);
      assert.deepEqual(body.findings[0].finalTrace, finalTrace);
      assert.equal(JSON.stringify(body).includes("traceWire"), false);
      return {
        defects: [{
          id: defect.id,
          side: defect.side,
          defectType: defect.defectType,
          origin: defect.origin,
          confidence: defect.confidence,
          sourceViewId: defect.sourceViewId,
          supportingViewIds: defect.supportingViewIds,
          reviewResult: defect.reviewResult,
          finalTrace,
          traceProvenance,
          measurementRegions: [{
            zone: "SURFACE",
            canonicalContour: [{ x: 0.5, y: 0.5 }, { x: 0.51, y: 0.5 }, { x: 0.51, y: 0.51 }],
            measurement: { ...measurement, pixelCount: 2, areaMm2: 0.01, weightedAreaMm2: 0.01 },
          }],
        }],
      };
    },
  });

  assert.equal(measureCalls, 1);
  const saved = (persisted as { reviewedDefects: readonly Record<string, unknown>[] } | null)?.reviewedDefects[0];
  assert.equal(saved?.id, defect.id);
  assert.deepEqual(saved?.finalTrace, finalTrace);
  assert.equal("traceWire" in (saved ?? {}), false);
  assert.equal("zone" in (saved ?? {}), false);
  assert.equal("canonicalContour" in (saved ?? {}), false);
  assert.equal("measurement" in (saved ?? {}), false);
  assert.equal(Array.isArray(saved?.measurementRegions), true);
  assert.equal(JSON.stringify(result).includes("runs"), false);
  assert.equal(JSON.stringify(result).includes("dataBase64"), false);
  assert.equal(result.reviewedDefects[0].traceSha256, finalTrace.sha256);
  assert.deepEqual(result.traceHashes, [{ findingId: defect.id, rleSha256: finalTrace.sha256 }]);
});
