import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { evaluateSpeedsterMapFilterCalibrationGate } from "../../frontend/nextjs-app/lib/ai-grader-v2/map-filter-replay";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function normalized(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, " ") : "";
}

function usage(): never {
  throw new Error(
    "Usage: audit-speedster-card-map-v2-gate.ts <corpus.json> <POKEMON|SPORTS> <year> <product/set> <parallel-or-empty>",
  );
}

async function main() {
  const [corpusPath, category, year, productSet, parallel] = process.argv.slice(2);
  if (!corpusPath || (category !== "POKEMON" && category !== "SPORTS") || !year || !productSet || parallel === undefined) {
    usage();
  }

  const bytes = await readFile(corpusPath);
  const corpus = record(JSON.parse(bytes.toString("utf8")));
  if (!corpus || !Array.isArray(corpus.cards)) throw new Error("Calibration corpus is malformed.");

  const cards = corpus.cards.map((value, index) => {
    const card = record(value);
    const identity = record(card?.identity);
    const reviewedDefects = Array.isArray(card?.reviewedDefects) ? card.reviewedDefects : [];
    if (!card || !identity) throw new Error(`Calibration card ${index + 1} is malformed.`);
    const compatible = card.cardProfile === category
      && normalized(identity.year) === normalized(year)
      && normalized(identity.productSet) === normalized(productSet)
      && normalized(identity.parallel) === normalized(parallel);
    const truthComplete = reviewedDefects.filter((finding) => {
      const result = record(finding)?.reviewResult;
      return result === "REMOVED" || result === "ACCEPTED" || result === "TYPE_CORRECTED" || result === "SMART_MARKED";
    }).length;
    const capture = record(card.capture);
    const front = record(capture?.front);
    const back = record(capture?.back);
    const rawEvidenceComplete = reviewedDefects.every((finding) => {
      const candidate = record(finding);
      return Array.isArray(candidate?.canonicalContour)
        || (Array.isArray(candidate?.measurementRegions) && candidate.measurementRegions.every((region) => (
          Array.isArray(record(region)?.canonicalContour)
        )));
    }) && Boolean(front?.currentInspectionSha256 ?? front?.inspectionSha256)
      && Boolean(back?.currentInspectionSha256 ?? back?.inspectionSha256);
    const registered = compatible && Boolean(card.mapRegistration);
    return { reviewedDefects, truthComplete, rawEvidenceComplete, compatible, registered };
  });

  const reviewedFindings = cards.reduce((sum, card) => sum + card.reviewedDefects.length, 0);
  const result = evaluateSpeedsterMapFilterCalibrationGate({
    corpusSha256: createHash("sha256").update(bytes).digest("hex"),
    corpusCards: cards.length,
    reviewedFindings,
    truthCompleteFindings: cards.reduce((sum, card) => sum + card.truthComplete, 0),
    rawEvidenceCompleteCards: cards.filter((card) => card.rawEvidenceComplete).length,
    compatibleCards: cards.filter((card) => card.compatible).length,
    registeredCompatibleCards: cards.filter((card) => card.registered).length,
    hiddenRealDefects: 0,
    mapRevisionIds: [],
    filterPolicyVersion: "speedster-map-filter-authority-padding-v2",
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== "PASS") process.exitCode = 2;
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Calibration audit failed."}\n`);
  process.exitCode = 1;
});
