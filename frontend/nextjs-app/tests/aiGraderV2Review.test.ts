import assert from "node:assert/strict";
import test from "node:test";

import type { SpeedsterMeasuredDefect } from "../lib/ai-grader-v2/contracts";
import {
  calculateSpeedsterReview,
  completeSpeedsterReview,
  correctSpeedsterDefectType,
  prepareSpeedsterCompletion,
  publicSpeedsterDefects,
  removeSpeedsterDefect,
  replaceSpeedsterSideMeasurements,
  restoreSpeedsterDefect,
  scanSpeedsterCapture,
} from "../lib/ai-grader-v2/review";

const capture = {
  front: { centeringBorders: { leftMm: 3, rightMm: 3, topMm: 3, bottomMm: 3 } },
  back: { centeringBorders: { leftMm: 3, rightMm: 3, topMm: 3, bottomMm: 3 } },
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

test("Smart-Mark fingerprint branches cannot change geometry, measurement, grade, or completion", () => {
  const smartMark = {
    ...defect,
    origin: "SMART_MARK" as const,
    reviewResult: "SMART_MARKED" as const,
  };
  const branches: SpeedsterMeasuredDefect[] = [
    {
      ...smartMark,
      featureFingerprint: [1, ...Array.from({ length: 31 }, () => 0)],
      smartMarkLearning: {
        fingerprintProvenance: "SAM_TRACE",
        traceAttempts: 1,
        proposalOverlapIouGt03: true,
        proposalMaxIou: 0.5,
      },
    },
    {
      ...smartMark,
      featureFingerprint: [1, ...Array.from({ length: 31 }, () => 0)],
      smartMarkLearning: {
        fingerprintProvenance: "HUMAN_BOX_POOL",
        traceAttempts: 1,
        proposalOverlapIouGt03: false,
        proposalMaxIou: 0,
      },
    },
    {
      ...smartMark,
      smartMarkLearning: {
        fingerprintProvenance: "HARD_FAILURE",
        traceAttempts: 0,
        proposalOverlapIouGt03: false,
        proposalMaxIou: 0,
      },
    },
  ];
  const reviews = branches.map((branch) => calculateSpeedsterReview(capture, [branch]));
  const completions = reviews.map((review, index) =>
    prepareSpeedsterCompletion([branches[index]], review.grade, "sam3-test"));

  assert.deepEqual(reviews[1].defects[0].canonicalContour, reviews[0].defects[0].canonicalContour);
  assert.deepEqual(reviews[2].defects[0].canonicalContour, reviews[0].defects[0].canonicalContour);
  assert.deepEqual(reviews[1].defects[0].measurement, reviews[0].defects[0].measurement);
  assert.deepEqual(reviews[2].defects[0].measurement, reviews[0].defects[0].measurement);
  assert.deepEqual(reviews[1].grade, reviews[0].grade);
  assert.deepEqual(reviews[2].grade, reviews[0].grade);
  assert.equal(completions.every(({ completedDefects }) => completedDefects[0].reviewResult === "SMART_MARKED"), true);
  assert.equal(completions[2].body.reviewedDefects[0].featureFingerprint, undefined);
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

test("the production orchestration scans Front then Back and produces a completable report payload", async () => {
  const scanOrder: string[] = [];
  const scanned = await scanSpeedsterCapture({
    capture: {
      cornerShape: "ROUNDED_3_18_MM",
      front: {
        side: "FRONT",
        rectifiedUrl: "https://images.test/front-original",
        inspectionUrl: "https://images.test/front-inspection",
        views: {
          NORMALIZED: "https://images.test/front-normalized",
          MICRO_DEFECT: "https://images.test/front-micro",
          DIRECTIONAL: "https://images.test/front-directional",
        },
      },
      back: {
        side: "BACK",
        rectifiedUrl: "https://images.test/back-original",
        inspectionUrl: "https://images.test/back-inspection",
        views: {
          NORMALIZED: "https://images.test/back-normalized",
          MICRO_DEFECT: "https://images.test/back-micro",
          DIRECTIONAL: "https://images.test/back-directional",
        },
      },
    },
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
