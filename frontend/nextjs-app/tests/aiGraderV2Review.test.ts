import assert from "node:assert/strict";
import test from "node:test";

import type {
  SpeedsterMeasuredDefect,
  SpeedsterReviewFinding,
  SpeedsterSourceMeasuredDefect,
} from "../lib/ai-grader-v2/contracts";
import { parseSpeedsterTraceRleV1 } from "../lib/ai-grader-v2/trace-codec";
import {
  calculateSpeedsterReview,
  completeSpeedsterReview,
  correctSpeedsterDefectType,
  prepareSpeedsterCompletion,
  publicSpeedsterDefects,
  remeasureSpeedsterReviewAction,
  removeSpeedsterDefect,
  replaceSpeedsterSideMeasurements,
  restoreSpeedsterDefect,
  scanSpeedsterCapture,
} from "../lib/ai-grader-v2/review";

const finalTrace = parseSpeedsterTraceRleV1({
  format: "TK_SPEEDSTER_TRACE_RLE_V1",
  width: 1270,
  height: 1778,
  origin: "TOP_LEFT",
  order: "ROW_MAJOR_Y_X",
  runs: [1_129_665, 1, 1_128_394],
  sha256: "928e33389ba8eb03acf1325532e93cfb615cf1527099bd53dbecd7e769cc6ed0",
});
const traceProvenance = {
  version: "speedster-trace-provenance-v1" as const,
  sourceViewId: "FRONT:ORIGINAL",
  cropTransform: {
    version: "speedster-canonical-crop-affine-v1" as const,
    crop: { x: 435, y: 689, width: 400, height: 400 },
  },
  highlighterStrokes: [{
    canonicalPoints: [{ x: 635, y: 889 }],
    strokeWidthMm: 1.5,
  }],
  finalTraceSha256: finalTrace.sha256,
};

const capture = {
  front: { centeringBorders: { leftMm: 3, rightMm: 3, topMm: 3, bottomMm: 3 } },
  back: { centeringBorders: { leftMm: 3, rightMm: 3, topMm: 3, bottomMm: 3 } },
};

const detectorCapture = {
  cornerShape: "ROUNDED_3_18_MM" as const,
  front: {
    side: "FRONT" as const,
    rectifiedUrl: "https://images.test/front-original",
    inspectionUrl: "https://images.test/front-inspection",
    views: {
      NORMALIZED: "https://images.test/front-normalized",
      MICRO_DEFECT: "https://images.test/front-micro",
      DIRECTIONAL: "https://images.test/front-directional",
    },
  },
  back: {
    side: "BACK" as const,
    rectifiedUrl: "https://images.test/back-original",
    inspectionUrl: "https://images.test/back-inspection",
    views: {
      NORMALIZED: "https://images.test/back-normalized",
      MICRO_DEFECT: "https://images.test/back-micro",
      DIRECTIONAL: "https://images.test/back-directional",
    },
  },
};

const defect: SpeedsterMeasuredDefect = {
  id: "front-1",
  side: "FRONT",
  zone: "SURFACE",
  defectType: "LIGHT_SCRATCH_SCUFF",
  confidence: 0.9,
  canonicalContour: [{ x: 0.2, y: 0.2 }, { x: 0.3, y: 0.2 }, { x: 0.3, y: 0.3 }],
  sourceViewId: "FRONT:DIRECTIONAL",
  supportingViewIds: ["FRONT:MICRO_DEFECT"],
  reviewResult: "UNREVIEWED",
  measurement: {
    widthMm: 1,
    heightMm: 1,
    areaMm2: 1,
    zonePercent: 2,
    multiplier: 1,
    weightedAreaMm2: 1,
    subgradeEffect: 0,
  },
};

test("derives the exact eligible zone area from the measured defect and excludes removed findings", () => {
  const active = calculateSpeedsterReview(capture, [defect]);
  assert.equal(active.grade.front.surface.weightedDamagePercent, 2);
  assert.equal(active.grade.front.surface.score, 8);
  assert.equal(active.grade.front.corners.score, 10);
  assert.equal(active.defects[0].measurement.subgradeEffect, 1.4);

  const removed = calculateSpeedsterReview(capture, removeSpeedsterDefect([defect], defect.id));
  assert.equal(removed.grade.front.surface.weightedDamagePercent, 0);
  assert.equal(removed.grade.front.surface.score, 10);
  assert.equal(removed.defects[0].reviewResult, "REMOVED");
});

test("restores only the last removed finding without replacing later defect edits", () => {
  const detected = {
    ...defect,
    origin: "DETECTOR" as const,
    detectedDefectType: "LIGHT_SCRATCH_SCUFF" as const,
  };
  const other = {
    ...defect,
    id: "front-2",
    defectType: "VISIBLE_WHITENING" as const,
    origin: "DETECTOR" as const,
    detectedDefectType: "VISIBLE_WHITENING" as const,
  };
  const removed = removeSpeedsterDefect([detected, other], detected.id);
  assert.equal(removed[0].origin, "DETECTOR");
  assert.equal(removed[0].detectedDefectType, "LIGHT_SCRATCH_SCUFF");
  const corrected = correctSpeedsterDefectType(removed, other.id, "FRAYING");
  const restored = restoreSpeedsterDefect(corrected, detected);
  assert.equal(restored[0].reviewResult, "UNREVIEWED");
  assert.equal(restored[0].origin, "DETECTOR");
  assert.equal(restored[0].detectedDefectType, "LIGHT_SCRATCH_SCUFF");
  assert.equal(restored[1].defectType, "FRAYING");
  assert.equal(restored[1].origin, "DETECTOR");
  assert.equal(restored[1].detectedDefectType, "VISIBLE_WHITENING");
  assert.equal(restored[1].reviewResult, "TYPE_CORRECTED");
});

test("side remeasurement replaces active findings and preserves removed provenance byte-for-byte", () => {
  const removed = {
    ...defect,
    id: "front-removed",
    origin: "MEMORY" as const,
    reviewResult: "REMOVED" as const,
    featureFingerprint: [1, ...Array.from({ length: 31 }, () => 0)],
    memoryProposal: {
      lessonSessionId: "cubone-reviewed-session",
      lessonCompletionOrder: 228,
      lessonProposalOrder: 7,
      lessonOrder: 0,
      lessonSourceViewId: "ORIGINAL" as const,
      similarity: 0.94,
    },
  };
  const back = { ...defect, id: "back-1", side: "BACK" as const };
  const remeasured = {
    ...defect,
    id: "front-remeasured",
    origin: "SMART_MARK" as const,
    reviewResult: "SMART_MARKED" as const,
  };

  const result = replaceSpeedsterSideMeasurements(
    [defect, removed, back],
    "FRONT",
    [remeasured],
  );

  assert.deepEqual(result, [removed, back, remeasured]);
  assert.equal(result[0], removed);
  assert.equal(result[1], back);
  assert.equal(result[2], remeasured);
});

test("Smart-Mark Save, Remove, Undo, and Change Type each run the same immediate measurement pass", async () => {
  const memory = {
    ...defect,
    id: "front-memory",
    origin: "MEMORY" as const,
    detectedDefectType: "VISIBLE_WHITENING" as const,
    featureFingerprint: [1, ...Array.from({ length: 31 }, () => 0)],
    memoryProposal: {
      lessonSessionId: "cubone-reviewed-session",
      lessonCompletionOrder: 228,
      lessonProposalOrder: 7,
      lessonOrder: 0,
      lessonSourceViewId: "ORIGINAL" as const,
      similarity: 0.94,
    },
  };
  const back = { ...defect, id: "back-1", side: "BACK" as const };
  const removedMemory = {
    ...removeSpeedsterDefect([memory], memory.id)[0],
    reviewResultBeforeRemoval: memory.reviewResult,
  };
  const mark = {
    id: "FRONT:smart-no-op",
    defectType: "FAINT_COLOR_VARIATION" as const,
    sourceViewId: "FRONT:ORIGINAL",
    finalTrace,
    traceProvenance,
  };
  const cases = [
    {
      name: "Smart-Mark Save",
      defects: [memory, back],
      action: { type: "TRACE_SAVE" as const, side: "FRONT" as const, findingId: null, trace: mark },
      expectedReviewResult: "UNREVIEWED",
      expectedDefectType: "LIGHT_SCRATCH_SCUFF",
      expectedMarkCount: 1,
    },
    {
      name: "Remove",
      defects: [memory, back],
      action: { type: "REMOVE" as const, defectIds: [memory.id] },
      expectedReviewResult: undefined,
      expectedDefectType: undefined,
      expectedMarkCount: 0,
    },
    {
      name: "Undo",
      defects: [removedMemory, back],
      action: { type: "UNDO" as const, defectIds: [memory.id] },
      expectedReviewResult: "UNREVIEWED",
      expectedDefectType: "LIGHT_SCRATCH_SCUFF",
      expectedMarkCount: 0,
    },
    {
      name: "Change Type",
      defects: [memory, back],
      action: {
        type: "CHANGE_TYPE" as const,
        defectId: memory.id,
        defectType: "PEELING_HEAVY_DAMAGE" as const,
      },
      expectedReviewResult: "TYPE_CORRECTED",
      expectedDefectType: "PEELING_HEAVY_DAMAGE",
      expectedMarkCount: 0,
    },
  ];

  for (const scenario of cases) {
    let calls = 0;
    const result = await remeasureSpeedsterReviewAction({
      defects: scenario.defects,
      action: scenario.action,
      measure: async ({ side, findings, marks }) => {
        calls += 1;
        assert.equal(side, "FRONT", scenario.name);
        assert.equal(marks.length, scenario.expectedMarkCount, scenario.name);
        assert.equal(findings.some(({ side: findingSide }) => findingSide === "BACK"), false, scenario.name);
        if (scenario.expectedReviewResult) {
          assert.equal(findings[0].reviewResult, scenario.expectedReviewResult, scenario.name);
          assert.equal(findings[0].defectType, scenario.expectedDefectType, scenario.name);
        } else {
          assert.equal(findings.length, 0, scenario.name);
        }
        return {
          defects: findings.map((finding) => "measurement" in finding ? ({
              ...finding,
              measurement: {
                ...finding.measurement,
                areaMm2: 7,
                zonePercent: 14,
                weightedAreaMm2: 14,
              },
            }) : finding),
        };
      },
    });

    assert.equal(calls, 1, scenario.name);
    assert.equal(result.find(({ id }) => id === back.id), back, scenario.name);
    if (scenario.name === "Remove") {
      const removed = result.find(({ id }) => id === memory.id);
      assert.equal(removed?.reviewResult, "REMOVED");
      assert.deepEqual(removed?.featureFingerprint, memory.featureFingerprint);
      assert.deepEqual(removed?.memoryProposal, memory.memoryProposal);
    } else {
      const remeasured = result.find(({ id }) => id === memory.id);
      assert.ok(remeasured && "measurement" in remeasured, scenario.name);
      assert.equal(remeasured.measurement.areaMm2, 7, scenario.name);
    }
  }
});

test("batch Remove and Undo each measure once and preserve every finding's provenance", async () => {
  const memoryA = {
    ...defect,
    id: "front-memory-a",
    origin: "MEMORY" as const,
    detectedDefectType: "LIGHT_SCRATCH_SCUFF" as const,
    featureFingerprint: [1, ...Array.from({ length: 31 }, () => 0)],
    memoryProposal: {
      lessonSessionId: "lesson-a",
      lessonCompletionOrder: 100,
      lessonProposalOrder: 1,
      lessonOrder: 0,
      lessonSourceViewId: "ORIGINAL" as const,
      similarity: 0.94,
    },
  };
  const memoryB = {
    ...memoryA,
    id: "front-memory-b",
    featureFingerprint: [0, 1, ...Array.from({ length: 30 }, () => 0)],
    memoryProposal: { ...memoryA.memoryProposal, lessonSessionId: "lesson-b", lessonProposalOrder: 2 },
  };
  const back = { ...defect, id: "back-control", side: "BACK" as const };
  let calls = 0;
  const measure = async ({ side, findings }: {
    side: "FRONT" | "BACK";
    findings: readonly SpeedsterReviewFinding[];
  }) => {
    calls += 1;
    assert.equal(side, "FRONT");
    return { defects: [...findings] };
  };

  const removed = await remeasureSpeedsterReviewAction({
    defects: [memoryA, memoryB, back],
    action: { type: "REMOVE", defectIds: [memoryA.id, memoryB.id] },
    measure,
  });
  assert.equal(calls, 1);
  assert.deepEqual(
    removed.filter(({ side }) => side === "FRONT").map(({ reviewResult }) => reviewResult),
    ["REMOVED", "REMOVED"],
  );
  assert.deepEqual(removed[0].featureFingerprint, memoryA.featureFingerprint);
  assert.deepEqual(removed[0].memoryProposal, memoryA.memoryProposal);
  assert.deepEqual(removed[1].featureFingerprint, memoryB.featureFingerprint);
  assert.deepEqual(removed[1].memoryProposal, memoryB.memoryProposal);
  assert.equal(removed.find(({ id }) => id === back.id), back);

  const restored = await remeasureSpeedsterReviewAction({
    defects: removed,
    action: { type: "UNDO", defectIds: [memoryA.id, memoryB.id] },
    measure,
  });
  assert.equal(calls, 2);
  assert.deepEqual(
    restored.filter(({ side }) => side === "FRONT").map(({ reviewResult }) => reviewResult),
    ["UNREVIEWED", "UNREVIEWED"],
  );
  assert.deepEqual(restored.find(({ id }) => id === memoryA.id)?.memoryProposal, memoryA.memoryProposal);
  assert.deepEqual(restored.find(({ id }) => id === memoryB.id)?.memoryProposal, memoryB.memoryProposal);
  assert.equal(restored.find(({ id }) => id === back.id), back);
});

test("a fully contained Smart-Mark Save is an idempotent successful remeasurement", async () => {
  let calls = 0;
  const result = await remeasureSpeedsterReviewAction({
    defects: [defect],
    action: {
      type: "TRACE_SAVE",
      side: "FRONT",
      findingId: null,
      trace: {
        id: "FRONT:smart-contained",
        defectType: "FAINT_COLOR_VARIATION",
        sourceViewId: "FRONT:ORIGINAL",
        finalTrace,
        traceProvenance,
      },
    },
    measure: async ({ findings, marks }) => {
      calls += 1;
      assert.equal(marks.length, 1);
      return { defects: [...findings] };
    },
  });

  assert.equal(calls, 1);
  assert.deepEqual(result, [defect]);
});

test("trace Save sends one exact revision mark and installs its final-trace-bound fingerprint without changing Memory identity", async () => {
  const existing = {
    ...defect,
    id: "front-memory-trace",
    origin: "MEMORY" as const,
    reviewResult: "TYPE_CORRECTED" as const,
    defectType: "FRAYING" as const,
    featureFingerprint: [1, ...Array.from({ length: 31 }, () => 0)],
    memoryProposal: {
      lessonSessionId: "immutable-session",
      lessonCompletionOrder: 229,
      lessonProposalOrder: 4,
      lessonOrder: 0,
      lessonSourceViewId: "ORIGINAL" as const,
      similarity: 0.95,
    },
  };
  const existingTraceProvenance = { ...traceProvenance, sourceViewId: existing.sourceViewId };
  const result = await remeasureSpeedsterReviewAction({
    defects: [existing],
    action: {
      type: "TRACE_SAVE",
      side: "FRONT",
      findingId: existing.id,
      trace: { finalTrace, traceProvenance: existingTraceProvenance },
    },
    measure: async ({ findings, marks }) => {
      assert.equal(marks.length, 1);
      assert.equal(marks[0].id, existing.id);
      assert.deepEqual(marks[0].finalTrace, finalTrace);
      assert.equal(findings.length, 1);
      assert.deepEqual(findings[0].finalTrace, finalTrace);
      assert.deepEqual(findings[0].traceProvenance, existingTraceProvenance);
      return {
        defects: [{
          ...findings[0],
          origin: "DETECTOR",
          reviewResult: "ACCEPTED",
          featureFingerprint: [0, ...Array.from({ length: 31 }, () => 0)],
          featureFingerprintTraceSha256: finalTrace.sha256,
          memoryProposal: undefined,
          measurement: {
            ...("measurement" in findings[0] ? findings[0].measurement : defect.measurement),
            areaMm2: 0.0025,
          },
        }],
      };
    },
  });

  assert.equal(result[0].id, existing.id);
  assert.equal(result[0].origin, existing.origin);
  assert.equal(result[0].reviewResult, existing.reviewResult);
  assert.equal(result[0].defectType, existing.defectType);
  assert.deepEqual(result[0].featureFingerprint, [0, ...Array.from({ length: 31 }, () => 0)]);
  assert.equal(result[0].featureFingerprintTraceSha256, finalTrace.sha256);
  assert.deepEqual(result[0].memoryProposal, existing.memoryProposal);
  assert.deepEqual(result[0].finalTrace, finalTrace);
  assert.deepEqual(result[0].traceProvenance, existingTraceProvenance);
  assert.ok("measurement" in result[0]);
  assert.equal(result[0].measurement.areaMm2, 0.0025);
});

test("remeasurement keeps fresh legacy contours and fresh source measurement regions", async () => {
  const freshLegacyContour = [{ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.5 }, { x: 0.6, y: 0.6 }];
  const legacy = await remeasureSpeedsterReviewAction({
    defects: [defect],
    action: { type: "CHANGE_TYPE", defectId: defect.id, defectType: "VISIBLE_WHITENING" },
    measure: async ({ findings }) => ({
      defects: [{
        ...findings[0],
        zone: "EDGES",
        canonicalContour: freshLegacyContour,
        measurement: { ...defect.measurement, areaMm2: 4, weightedAreaMm2: 8 },
      } as SpeedsterMeasuredDefect],
    }),
  });
  assert.ok("canonicalContour" in legacy[0]);
  assert.deepEqual(legacy[0].canonicalContour, freshLegacyContour);
  assert.equal(legacy[0].zone, "EDGES");
  assert.equal(legacy[0].measurement.areaMm2, 4);

  const source: SpeedsterSourceMeasuredDefect = {
    id: "FRONT:stable-source",
    side: "FRONT",
    defectType: "LIGHT_SCRATCH_SCUFF",
    origin: "SMART_MARK",
    confidence: 1,
    sourceViewId: "FRONT:ORIGINAL",
    supportingViewIds: [],
    reviewResult: "SMART_MARKED",
    finalTrace,
    traceProvenance,
    measurementRegions: [{
      zone: "SURFACE",
      canonicalContour: defect.canonicalContour,
      measurement: defect.measurement,
    }],
  };
  const freshRegions = [{
    zone: "CORNERS" as const,
    canonicalContour: freshLegacyContour,
    measurement: { ...defect.measurement, pixelCount: 1, areaMm2: 0.01, weightedAreaMm2: 0.02 },
  }];
  const sources = await remeasureSpeedsterReviewAction({
    defects: [source],
    action: { type: "CHANGE_TYPE", defectId: source.id, defectType: "VISIBLE_WHITENING" },
    measure: async ({ findings }) => ({
      defects: [{ ...findings[0], measurementRegions: freshRegions } as SpeedsterSourceMeasuredDefect],
    }),
  });
  assert.equal("zone" in sources[0], false);
  assert.equal("canonicalContour" in sources[0], false);
  assert.equal("measurement" in sources[0], false);
  assert.ok("measurementRegions" in sources[0]);
  assert.deepEqual(sources[0].measurementRegions, freshRegions);
});

test("new trace Save measures one final-RLE mark and invalid trace leaves findings untouched", async () => {
  let calls = 0;
  const saved = await remeasureSpeedsterReviewAction({
    defects: [defect],
    action: {
      type: "TRACE_SAVE",
      side: "FRONT",
      findingId: null,
      trace: {
        id: "FRONT:smart-trace",
        defectType: "FAINT_COLOR_VARIATION",
        sourceViewId: "FRONT:ORIGINAL",
        finalTrace,
        traceProvenance,
      },
    },
    measure: async ({ findings, marks }) => {
      calls += 1;
      assert.deepEqual(findings, [defect]);
      assert.equal(marks.length, 1);
      assert.deepEqual(marks[0].finalTrace, finalTrace);
      assert.equal("canonicalContour" in marks[0], false);
      return { defects: findings as SpeedsterMeasuredDefect[] };
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(saved, [defect]);

  const invalid = { ...finalTrace, sha256: "0".repeat(64) };
  await assert.rejects(() => remeasureSpeedsterReviewAction({
    defects: [defect],
    action: {
      type: "TRACE_SAVE",
      side: "FRONT",
      findingId: null,
      trace: {
        id: "FRONT:smart-invalid",
        defectType: "FAINT_COLOR_VARIATION",
        sourceViewId: "FRONT:ORIGINAL",
        finalTrace: invalid,
        traceProvenance: { ...traceProvenance, finalTraceSha256: invalid.sha256 },
      },
    },
    measure: async () => {
      calls += 1;
      return { defects: [] };
    },
  }), /SHA-256/i);
  assert.equal(calls, 1);
  assert.deepEqual(defect, { ...defect });
});

test("fully contained full and partial Smart-Mark overlaps change neither union damage nor grade", () => {
  const existing = {
    ...defect,
    id: "front-existing",
    defectType: "VISIBLE_WHITENING" as const,
    origin: "DETECTOR" as const,
    detectedDefectType: "VISIBLE_WHITENING" as const,
    measurement: {
      ...defect.measurement,
      areaMm2: 4,
      zonePercent: 8,
      weightedAreaMm2: 4,
    },
  };
  const zeroExisting = {
    ...existing,
    measurement: {
      ...existing.measurement,
      widthMm: 0,
      heightMm: 0,
      areaMm2: 0,
      zonePercent: 0,
      weightedAreaMm2: 0,
      subgradeEffect: 0,
    },
  };
  const fullSmartMark = {
    ...existing,
    id: "front-smart-full",
    origin: "SMART_MARK" as const,
    detectedDefectType: undefined,
    reviewResult: "SMART_MARKED" as const,
  };
  const partialExisting = {
    ...existing,
    measurement: {
      ...existing.measurement,
      areaMm2: 3,
      zonePercent: 6,
      weightedAreaMm2: 3,
    },
  };
  const partialSmartMark = {
    ...fullSmartMark,
    id: "front-smart-partial",
    measurement: {
      ...fullSmartMark.measurement,
      areaMm2: 1,
      zonePercent: 2,
      weightedAreaMm2: 1,
    },
  };

  const baseline = calculateSpeedsterReview(capture, [existing]);
  const fullFindings = replaceSpeedsterSideMeasurements(
    [existing],
    "FRONT",
    [fullSmartMark, zeroExisting],
  );
  const partialFindings = replaceSpeedsterSideMeasurements(
    [existing],
    "FRONT",
    [partialExisting, partialSmartMark],
  );
  const full = calculateSpeedsterReview(capture, fullFindings);
  const partial = calculateSpeedsterReview(capture, partialFindings);
  const unionArea = (findings: readonly SpeedsterMeasuredDefect[]) =>
    findings.reduce((total, finding) => total + finding.measurement.areaMm2, 0);

  assert.equal(unionArea([existing]), 4);
  assert.equal(unionArea(fullFindings), 4);
  assert.equal(unionArea(partialFindings), 4);
  assert.deepEqual(full.grade, baseline.grade);
  assert.deepEqual(partial.grade, baseline.grade);
  assert.equal(fullFindings.some(({ id }) => id === existing.id), true);
});

test("type correction preserves Smart-Mark provenance without inventing a detector label", () => {
  const smartMark = {
    ...defect,
    origin: "SMART_MARK" as const,
    reviewResult: "SMART_MARKED" as const,
    featureFingerprint: [1, ...Array.from({ length: 31 }, () => 0)],
    smartMarkLearning: {
      fingerprintProvenance: "HUMAN_BOX_POOL" as const,
      traceAttempts: 1 as const,
      proposalOverlapIouGt03: false,
      proposalMaxIou: 0.12,
    },
  };
  const corrected = correctSpeedsterDefectType([smartMark], smartMark.id, "FRAYING");
  assert.equal(corrected[0].origin, "SMART_MARK");
  assert.equal(corrected[0].detectedDefectType, undefined);
  assert.equal(corrected[0].defectType, "FRAYING");
  assert.equal(corrected[0].reviewResult, "TYPE_CORRECTED");
  assert.deepEqual(corrected[0].featureFingerprint, smartMark.featureFingerprint);
  assert.deepEqual(corrected[0].smartMarkLearning, smartMark.smartMarkLearning);

  const review = calculateSpeedsterReview(capture, corrected);
  const prepared = prepareSpeedsterCompletion(corrected, review.grade, "sam3-test");
  assert.deepEqual(prepared.body.reviewedDefects[0].featureFingerprint, smartMark.featureFingerprint);
  assert.deepEqual(prepared.body.reviewedDefects[0].smartMarkLearning, smartMark.smartMarkLearning);
});

test("type corrections change published multiplier math immediately", () => {
  const corrected = correctSpeedsterDefectType([defect], defect.id, "PEELING_HEAVY_DAMAGE");
  const review = calculateSpeedsterReview(capture, corrected);
  assert.equal(review.defects[0].reviewResult, "TYPE_CORRECTED");
  assert.equal(review.defects[0].measurement.multiplier, 2);
  assert.equal(review.grade.front.surface.weightedDamagePercent, 4);
  assert.equal(review.grade.front.surface.score, 6);
});

test("completion accepts untouched findings and keeps canonical report view IDs", () => {
  const completed = completeSpeedsterReview([defect]);
  assert.equal(completed[0].reviewResult, "ACCEPTED");
  const persisted = publicSpeedsterDefects(completed);
  assert.equal(persisted[0].sourceViewId, "DIRECTIONAL");
  assert.deepEqual(persisted[0].supportingViewIds, ["MICRO_DEFECT"]);
});

test("completion preserves removed decisions without accepting them", () => {
  const removed = removeSpeedsterDefect([defect], defect.id);
  const review = calculateSpeedsterReview(capture, removed);
  const prepared = prepareSpeedsterCompletion(removed, review.grade, "sam3-test");
  assert.equal(prepared.completedDefects[0].reviewResult, "REMOVED");
  assert.equal(prepared.body.reviewedDefects[0].reviewResult, "REMOVED");
  assert.equal(prepared.body.gradeReport.overall.displayGrade, 10);
});

test("the production orchestration dispatches Front then Back and produces a completable report payload", async () => {
  const scanOrder: string[] = [];
  const scanned = await scanSpeedsterCapture({
    capture: detectorCapture,
    async detect(request) {
      scanOrder.push(request.side);
      assert.deepEqual(request.views.map(({ id }) => id), [
        `${request.side}:ORIGINAL`,
        `${request.side}:NORMALIZED`,
        `${request.side}:MICRO_DEFECT`,
        `${request.side}:DIRECTIONAL`,
      ]);
      assert.equal(
        request.views[0].imageUrl,
        `https://images.test/${request.side.toLowerCase()}-inspection`,
      );
      return {
        detectorVersion: "sam3-test",
        defects: request.side === "FRONT" ? [] : [{
          ...defect,
          id: "sam-result-1",
          side: "BACK",
          sourceViewId: "BACK:DIRECTIONAL",
          supportingViewIds: ["BACK:MICRO_DEFECT"],
        }, {
          ...defect,
          id: "memory-result-1",
          side: "BACK",
          defectType: "VISIBLE_WHITENING",
          origin: "MEMORY",
          sourceViewId: "BACK:ORIGINAL",
          supportingViewIds: ["BACK:MICRO_DEFECT"],
          memoryProposal: {
            lessonSessionId: "cubone-reviewed-session",
            lessonCompletionOrder: 228,
            lessonProposalOrder: 7,
            lessonOrder: 0,
            lessonSourceViewId: "ORIGINAL",
            similarity: 0.94,
          },
        }],
      };
    },
  });

  assert.deepEqual(scanOrder, ["FRONT", "BACK"]);
  assert.equal(scanned.detectorVersion, "sam3-test");
  assert.equal(scanned.defects.length, 2);
  assert.equal(scanned.defects[0].id, "BACK:sam-result-1:SURFACE");
  assert.equal(scanned.defects[0].origin, "DETECTOR");
  assert.equal(scanned.defects[0].detectedDefectType, "LIGHT_SCRATCH_SCUFF");
  assert.equal(scanned.defects[0].reviewResult, "UNREVIEWED");
  assert.equal(scanned.defects[1].id, "BACK:memory-result-1:SURFACE");
  assert.equal(scanned.defects[1].origin, "MEMORY");
  assert.equal(scanned.defects[1].detectedDefectType, "VISIBLE_WHITENING");
  assert.deepEqual(scanned.defects[1].memoryProposal, {
    lessonSessionId: "cubone-reviewed-session",
    lessonCompletionOrder: 228,
    lessonProposalOrder: 7,
    lessonOrder: 0,
    lessonSourceViewId: "ORIGINAL",
    similarity: 0.94,
  });

  const review = calculateSpeedsterReview(capture, scanned.defects);
  const prepared = prepareSpeedsterCompletion(scanned.defects, review.grade, scanned.detectorVersion);
  assert.equal(prepared.completedDefects[0].reviewResult, "ACCEPTED");
  assert.equal(prepared.body.reviewedDefects[0].origin, "DETECTOR");
  assert.equal(prepared.body.reviewedDefects[0].detectedDefectType, "LIGHT_SCRATCH_SCUFF");
  assert.equal(prepared.body.reviewedDefects[0].sourceViewId, "DIRECTIONAL");
  assert.equal(prepared.completedDefects[1].reviewResult, "ACCEPTED");
  assert.equal(prepared.body.reviewedDefects[1].origin, "MEMORY");
  assert.equal(prepared.body.reviewedDefects[1].sourceViewId, "ORIGINAL");
  assert.deepEqual(prepared.body.reviewedDefects[1].memoryProposal, scanned.defects[1].memoryProposal);
  assert.equal(prepared.body.gradeReport.detectorVersion, "sam3-test");

  const { buildSpeedsterLabelData, speedsterReportSlug } = await import(
    "../pages/api/admin/ai-grader-v2/sessions/[sessionId]/complete-label"
  );
  const label = buildSpeedsterLabelData({
    id: "speedster-session-123456789",
    cardProfile: "POKEMON",
    workflowState: "CAPTURED",
    publicReportSlug: null,
    identity: { cardName: "Charizard", year: "2026", productSet: "Speedster" },
  }, prepared.body.gradeReport as unknown as Parameters<typeof buildSpeedsterLabelData>[1]);
  assert.equal(label.source, "SPEEDSTER");
  assert.equal(label.gradingFormulaVersion, "EQUAL_25");
  assert.equal(speedsterReportSlug("speedster-session-123456789"), "speedster-speedster-session-123456789");
});

test("Front completes before Back starts and both use identical side payload shapes", async () => {
  const started: string[] = [];
  const callbacks: string[] = [];
  let resolveFront!: (value: { detectorVersion: string; defects: SpeedsterMeasuredDefect[] }) => void;
  const frontResponse = new Promise<{ detectorVersion: string; defects: SpeedsterMeasuredDefect[] }>(
    (resolve) => { resolveFront = resolve; },
  );

  let finished = false;
  const scan = scanSpeedsterCapture({
    capture: detectorCapture,
    onSide(side) {
      callbacks.push(`dispatch:${side}`);
    },
    detect(request) {
      callbacks.push(`detect:${request.side}`);
      started.push(request.side);
      assert.deepEqual(request, {
        side: request.side,
        cornerShape: detectorCapture.cornerShape,
        views: [
          { id: `${request.side}:ORIGINAL`, imageUrl: `https://images.test/${request.side.toLowerCase()}-inspection` },
          { id: `${request.side}:NORMALIZED`, imageUrl: `https://images.test/${request.side.toLowerCase()}-normalized` },
          { id: `${request.side}:MICRO_DEFECT`, imageUrl: `https://images.test/${request.side.toLowerCase()}-micro` },
          { id: `${request.side}:DIRECTIONAL`, imageUrl: `https://images.test/${request.side.toLowerCase()}-directional` },
        ],
      });
      return request.side === "FRONT"
        ? frontResponse
        : Promise.resolve({ detectorVersion: "same-release", defects: [] });
    },
  });
  scan.then(
    () => { finished = true; },
    () => { finished = true; },
  );

  await Promise.resolve();
  assert.deepEqual(started, ["FRONT"]);
  assert.deepEqual(callbacks, [
    "dispatch:FRONT",
    "detect:FRONT",
  ]);
  assert.equal(finished, false);
  resolveFront({ detectorVersion: "same-release", defects: [] });
  assert.deepEqual(await scan, { detectorVersion: "same-release", defects: [] });
  assert.deepEqual(started, ["FRONT", "BACK"]);
  assert.deepEqual(callbacks, [
    "dispatch:FRONT",
    "detect:FRONT",
    "dispatch:BACK",
    "detect:BACK",
  ]);
});

test("sequential completion preserves canonical output order and calculated grade", async () => {
  const frontFinding: SpeedsterMeasuredDefect = {
    ...defect,
    id: "detector-front",
    side: "FRONT",
    origin: "DETECTOR",
    featureFingerprint: [1, ...Array.from({ length: 31 }, () => 0)],
    learningAdjustment: -0.02,
    sourceViewId: "DIRECTIONAL",
    supportingViewIds: ["MICRO_DEFECT", "ORIGINAL"],
    measurement: { ...defect.measurement, areaMm2: 2, zonePercent: 4, weightedAreaMm2: 2 },
  };
  const backFinding: SpeedsterMeasuredDefect = {
    ...defect,
    id: "memory-back",
    side: "BACK",
    defectType: "VISIBLE_WHITENING",
    origin: "MEMORY",
    featureFingerprint: [0, 1, ...Array.from({ length: 30 }, () => 0)],
    sourceViewId: "ORIGINAL",
    supportingViewIds: ["NORMALIZED"],
    memoryProposal: {
      lessonSessionId: "source-session",
      lessonCompletionOrder: 706,
      lessonProposalOrder: 9,
      lessonOrder: 2,
      lessonSourceViewId: "ORIGINAL",
      similarity: 0.93,
    },
    measurement: { ...defect.measurement, areaMm2: 3, zonePercent: 6, weightedAreaMm2: 3 },
  };
  const responses: Record<"FRONT" | "BACK", {
    detectorVersion: string;
    defects: SpeedsterMeasuredDefect[];
  }> = {
    FRONT: { detectorVersion: "sam3-fixed-release", defects: [frontFinding] },
    BACK: { detectorVersion: "sam3-fixed-release", defects: [backFinding] },
  };
  const canonicalize = (
    side: "FRONT" | "BACK",
    findings: readonly SpeedsterMeasuredDefect[],
  ): SpeedsterMeasuredDefect[] => findings.map((finding) => ({
    ...finding,
    id: `${side}:${finding.id}:${finding.zone}`,
    side,
    origin: finding.origin === "MEMORY" ? "MEMORY" : "DETECTOR",
    detectedDefectType: finding.detectedDefectType ?? finding.defectType,
    sourceViewId: `${side}:${finding.sourceViewId}`,
    supportingViewIds: finding.supportingViewIds.map((id) => `${side}:${id}`),
    reviewResult: "UNREVIEWED",
  }));
  const sequential = {
    detectorVersion: responses.FRONT.detectorVersion,
    defects: [
      ...canonicalize("FRONT", responses.FRONT.defects),
      ...canonicalize("BACK", responses.BACK.defects),
    ],
  };

  const started: Array<"FRONT" | "BACK"> = [];
  const scanned = await scanSpeedsterCapture({
    capture: detectorCapture,
    async detect(request) {
      started.push(request.side);
      return responses[request.side];
    },
  });
  assert.deepEqual(started, ["FRONT", "BACK"]);
  assert.deepEqual(scanned, sequential);
  assert.deepEqual(
    calculateSpeedsterReview(capture, scanned.defects).grade,
    calculateSpeedsterReview(capture, sequential.defects).grade,
  );
  assert.deepEqual(scanned.defects.map(({ id }) => id), [
    "FRONT:detector-front:SURFACE",
    "BACK:memory-back:SURFACE",
  ]);
});

test("a detector-version mismatch rejects the whole pair", async () => {
  await assert.rejects(() => scanSpeedsterCapture({
    capture: detectorCapture,
    async detect(request) {
      return {
        detectorVersion: request.side === "FRONT" ? "release-front" : "release-back",
        defects: [],
      };
    },
  }), /versions do not match/i);
});

test("when both detectors fail the Front error wins deterministically", async () => {
  const frontFailure = new Error("Front failed");
  const backFailure = new Error("Back failed");
  await assert.rejects(scanSpeedsterCapture({
    capture: detectorCapture,
    detect(request) {
      return Promise.reject(request.side === "FRONT" ? frontFailure : backFailure);
    },
  }), frontFailure);
});

for (const failedSide of ["FRONT", "BACK"] as const) {
  test(`${failedSide} failure stops sequential dispatch without partial output`, async () => {
    const failure = new Error(`${failedSide} failed`);
    const firstCalls: string[] = [];
    await assert.rejects(scanSpeedsterCapture({
      capture: detectorCapture,
      async detect(request) {
        firstCalls.push(request.side);
        if (request.side === failedSide) throw failure;
        return { detectorVersion: "same-release", defects: [] };
      },
    }), failure);
    assert.deepEqual(firstCalls, failedSide === "FRONT" ? ["FRONT"] : ["FRONT", "BACK"]);
  });
}
