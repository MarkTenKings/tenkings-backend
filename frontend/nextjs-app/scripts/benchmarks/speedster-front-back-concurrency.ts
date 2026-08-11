import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import type {
  SpeedsterCardSide,
  SpeedsterMeasuredDefect,
} from "../../lib/ai-grader-v2/contracts";
import {
  calculateSpeedsterReview,
  scanSpeedsterCapture,
  speedsterDetectorViews,
} from "../../lib/ai-grader-v2/review";

const REPETITIONS = 20;
const WARMUP_PAIRS = 2;
const DETECTOR_VERSION =
  "sam3-local-box-inspection-2mm@96914d2425f90a64f45ca977c2b5165418099543";
const FIXED_LATENCY_MS = { FRONT: 24, BACK: 18 } as const;

const capture = {
  cornerShape: "ROUNDED_3_18_MM" as const,
  front: {
    side: "FRONT" as const,
    rectifiedUrl: "local://front-original",
    inspectionUrl: "local://front-inspection",
    views: {
      NORMALIZED: "local://front-normalized",
      MICRO_DEFECT: "local://front-micro",
      DIRECTIONAL: "local://front-directional",
    },
  },
  back: {
    side: "BACK" as const,
    rectifiedUrl: "local://back-original",
    inspectionUrl: "local://back-inspection",
    views: {
      NORMALIZED: "local://back-normalized",
      MICRO_DEFECT: "local://back-micro",
      DIRECTIONAL: "local://back-directional",
    },
  },
};

const reviewCapture = {
  front: { centeringBorders: { leftMm: 3, rightMm: 3, topMm: 3, bottomMm: 3 } },
  back: { centeringBorders: { leftMm: 3, rightMm: 3, topMm: 3, bottomMm: 3 } },
};

const measurement = {
  widthMm: 1,
  heightMm: 1,
  areaMm2: 1,
  zonePercent: 2,
  multiplier: 1,
  weightedAreaMm2: 1,
  subgradeEffect: 0,
};

const responses: Record<SpeedsterCardSide, {
  detectorVersion: string;
  defects: SpeedsterMeasuredDefect[];
}> = {
  FRONT: {
    detectorVersion: DETECTOR_VERSION,
    defects: [{
      id: "detector-front",
      side: "FRONT",
      zone: "SURFACE",
      defectType: "LIGHT_SCRATCH_SCUFF",
      origin: "DETECTOR",
      featureFingerprint: [1, ...Array.from({ length: 31 }, () => 0)],
      confidence: 0.91,
      canonicalContour: [{ x: 0.2, y: 0.2 }, { x: 0.3, y: 0.2 }, { x: 0.3, y: 0.3 }],
      sourceViewId: "DIRECTIONAL",
      supportingViewIds: ["MICRO_DEFECT", "ORIGINAL"],
      reviewResult: "UNREVIEWED",
      measurement: { ...measurement, areaMm2: 2, zonePercent: 4, weightedAreaMm2: 2 },
    }],
  },
  BACK: {
    detectorVersion: DETECTOR_VERSION,
    defects: [{
      id: "memory-back",
      side: "BACK",
      zone: "SURFACE",
      defectType: "VISIBLE_WHITENING",
      origin: "MEMORY",
      featureFingerprint: [0, 1, ...Array.from({ length: 30 }, () => 0)],
      confidence: 0.88,
      canonicalContour: [{ x: 0.6, y: 0.6 }, { x: 0.7, y: 0.6 }, { x: 0.7, y: 0.7 }],
      sourceViewId: "ORIGINAL",
      supportingViewIds: ["NORMALIZED"],
      reviewResult: "UNREVIEWED",
      memoryProposal: {
        lessonSessionId: "fixed-source-session",
        lessonCompletionOrder: 706,
        lessonProposalOrder: 9,
        lessonOrder: 2,
        lessonSourceViewId: "ORIGINAL",
        similarity: 0.93,
      },
      measurement: { ...measurement, areaMm2: 3, zonePercent: 6, weightedAreaMm2: 3 },
    }],
  },
};

type ScanInput = Parameters<typeof scanSpeedsterCapture>[0];
type DetectRequest = Parameters<ScanInput["detect"]>[0];
type DetectResponse = Awaited<ReturnType<ScanInput["detect"]>>;

function canonicalDefects(side: SpeedsterCardSide, defects: readonly SpeedsterMeasuredDefect[]) {
  return defects.map((defect): SpeedsterMeasuredDefect => ({
    ...defect,
    id: `${side}:${defect.id}:${defect.zone}`,
    side,
    origin: defect.origin === "MEMORY" ? "MEMORY" : "DETECTOR",
    detectedDefectType: defect.detectedDefectType ?? defect.defectType,
    sourceViewId: `${side}:${defect.sourceViewId}`,
    supportingViewIds: defect.supportingViewIds.map((id) => `${side}:${id}`),
    reviewResult: "UNREVIEWED",
  }));
}

function request(side: SpeedsterCardSide): DetectRequest {
  return {
    side,
    cornerShape: capture.cornerShape,
    views: speedsterDetectorViews(side === "FRONT" ? capture.front : capture.back),
  };
}

function detector(sideLatencies: Record<SpeedsterCardSide, number[]>) {
  return async (input: DetectRequest): Promise<DetectResponse> => {
    assert.deepEqual(input, request(input.side));
    const startedAt = performance.now();
    await new Promise((resolve) => setTimeout(resolve, FIXED_LATENCY_MS[input.side]));
    sideLatencies[input.side].push(performance.now() - startedAt);
    return responses[input.side];
  };
}

async function scanSequential(detect: ScanInput["detect"]) {
  const front = await detect(request("FRONT"));
  const back = await detect(request("BACK"));
  assert.equal(front.detectorVersion, back.detectorVersion);
  return {
    detectorVersion: front.detectorVersion,
    defects: [
      ...canonicalDefects("FRONT", front.defects),
      ...canonicalDefects("BACK", back.defects),
    ],
  };
}

function summary(values: readonly number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = (value: number) => sorted[Math.ceil(sorted.length * value) - 1];
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return {
    p50: round(percentile(0.5)),
    p95: round(percentile(0.95)),
    max: round(sorted[sorted.length - 1]),
  };
}

async function run(strategy: "sequential" | "concurrent", measured: boolean) {
  const sideLatencies = { FRONT: [] as number[], BACK: [] as number[] };
  const pairLatencies: number[] = [];
  let reference: Awaited<ReturnType<typeof scanSequential>> | null = null;
  const repetitions = measured ? REPETITIONS : WARMUP_PAIRS;
  for (let index = 0; index < repetitions; index += 1) {
    const startedAt = performance.now();
    const result = strategy === "sequential"
      ? await scanSequential(detector(sideLatencies))
      : await scanSpeedsterCapture({ capture, detect: detector(sideLatencies) });
    pairLatencies.push(performance.now() - startedAt);
    reference ??= result;
    assert.deepEqual(result, reference);
  }
  return { reference, sideLatencies, pairLatencies };
}

async function main() {
  await run("sequential", false);
  await run("concurrent", false);
  const sequential = await run("sequential", true);
  const concurrent = await run("concurrent", true);
  assert.deepEqual(concurrent.reference, sequential.reference);
  assert.deepEqual(
    calculateSpeedsterReview(reviewCapture, concurrent.reference!.defects).grade,
    calculateSpeedsterReview(reviewCapture, sequential.reference!.defects).grade,
  );

  console.log(JSON.stringify({
    benchmark: "deterministic-local-simulated-detector",
    providerContact: false,
    detectorVersion: DETECTOR_VERSION,
    warmupPairsPerStrategy: WARMUP_PAIRS,
    measuredPairsPerStrategy: REPETITIONS,
    fixedLatencyMs: FIXED_LATENCY_MS,
    failures: 0,
    equivalent: true,
    sequential: {
      frontLatencyMs: summary(sequential.sideLatencies.FRONT),
      backLatencyMs: summary(sequential.sideLatencies.BACK),
      pairWallMs: summary(sequential.pairLatencies),
    },
    concurrent: {
      frontLatencyMs: summary(concurrent.sideLatencies.FRONT),
      backLatencyMs: summary(concurrent.sideLatencies.BACK),
      pairWallMs: summary(concurrent.pairLatencies),
    },
  }, null, 2));
}

void main();
