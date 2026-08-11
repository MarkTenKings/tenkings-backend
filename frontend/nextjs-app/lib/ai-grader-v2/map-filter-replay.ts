import type { SpeedsterReviewFinding } from "./contracts";
import type { SpeedsterSessionIdentity } from "./identity";
import {
  splitSpeedsterMapFilteredCandidates,
  type SpeedsterPinnedMapFilterInput,
} from "./map-filter";
import { calculateSpeedsterReview } from "./review";

export const SPEEDSTER_MAP_FILTER_VERIFICATION_STATUS = "defect filter verification: PENDING" as const;

export type SpeedsterReplayFinding = Readonly<{
  finding: SpeedsterReviewFinding;
  humanTruth: "HUMAN_REMOVED_FAKE" | "HUMAN_KEPT_REAL";
  printOverlap: boolean;
}>;

export type SpeedsterReplayBoundaryComparison = Readonly<{
  side: "FRONT" | "BACK";
  savedHumanBoundary: unknown;
  projectedBoundary: unknown;
  boundaryReprojectionErrorPx: number | null;
  savedCenteringRatio: unknown;
  replayCenteringRatio: unknown;
  centeringRatioDifference: number | null;
  savedCenteringGrade: number | null;
  replayCenteringGrade: number | null;
  centeringGradeDifference: number | null;
}>;

export type SpeedsterMapFilterReplayCard = Readonly<{
  sessionId: string;
  cardIdentity: SpeedsterSessionIdentity;
  detectorVersion: string;
  corpus: "CONTAMINATED_50" | "HELD_OUT";
  map: SpeedsterPinnedMapFilterInput | null;
  capture: Readonly<{
    front: { centeringBorders: unknown };
    back: { centeringBorders: unknown };
  }>;
  findings: readonly SpeedsterReplayFinding[];
  boundaryComparisons: readonly SpeedsterReplayBoundaryComparison[];
}>;

function grade(capture: SpeedsterMapFilterReplayCard["capture"], findings: readonly SpeedsterReviewFinding[]) {
  return calculateSpeedsterReview(
    capture as Parameters<typeof calculateSpeedsterReview>[0],
    findings,
  ).grade;
}

function crop(finding: SpeedsterReviewFinding) {
  const points = "measurementRegions" in finding
    ? finding.measurementRegions.flatMap(({ canonicalContour }) => canonicalContour)
    : finding.canonicalContour;
  const xs = points.map(({ x }) => x);
  const ys = points.map(({ y }) => y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

export function replaySpeedsterMapFilter(cards: readonly SpeedsterMapFilterReplayCard[]) {
  const cardReports = [];
  const decisions = [];
  const immediateAlerts = [];
  const missingMaps: string[] = [];
  const unusableMaps: Array<{ sessionId: string; error: string }> = [];
  const unexpectedCards: Array<{ sessionId: string; reason: string }> = [];
  let fakeCount = 0;
  let realCount = 0;
  let printOverlapRealCount = 0;
  let printOverlapRealFiltered = 0;
  let fakesFiltered = 0;
  let realFindingsFiltered = 0;
  let mapCoveredReal = 0;
  let filterEligibleReal = 0;
  let mapCoveredRealRetained = 0;
  let filterEligibleRealRetained = 0;

  for (const card of cards) {
    const findingById = new Map(card.findings.map((entry) => [entry.finding.id, entry] as const));
    fakeCount += card.findings.filter(({ humanTruth }) => humanTruth === "HUMAN_REMOVED_FAKE").length;
    const real = card.findings.filter(({ humanTruth }) => humanTruth === "HUMAN_KEPT_REAL");
    realCount += real.length;
    printOverlapRealCount += real.filter(({ printOverlap }) => printOverlap).length;
    const baselineGradeFindings = real.map(({ finding }) => ({ ...finding, reviewResult: "ACCEPTED" as const }));
    let activeFindings = card.findings.map(({ finding }) => finding);
    let filtered = [] as ReturnType<typeof splitSpeedsterMapFilteredCandidates>["filteredDecisions"];
    let mapUsable = false;
    if (!card.map) {
      missingMaps.push(card.sessionId);
    } else {
      try {
        const split = splitSpeedsterMapFilteredCandidates({
          findings: activeFindings,
          cardIdentity: card.cardIdentity,
          detectorVersion: card.detectorVersion,
          map: card.map,
        });
        activeFindings = [...split.activeFindings];
        filtered = split.filteredDecisions;
        mapUsable = true;
      } catch (error) {
        unusableMaps.push({
          sessionId: card.sessionId,
          error: error instanceof Error ? error.message : "unknown map error",
        });
      }
    }

    if (mapUsable) {
      mapCoveredReal += real.length;
      filterEligibleReal += real.filter(({ finding }) => finding.origin !== "SMART_MARK").length;
    }
    const filteredIds = new Set(filtered.map(({ finding }) => finding.id));
    for (const decision of filtered) {
      const truth = findingById.get(decision.finding.id);
      if (!truth) {
        unexpectedCards.push({ sessionId: card.sessionId, reason: `Unlabeled finding ${decision.finding.id}` });
        continue;
      }
      const reportDecision = {
        sessionId: card.sessionId,
        findingId: decision.finding.id,
        side: decision.finding.side,
        origin: decision.finding.origin,
        defectType: decision.finding.defectType,
        sourceViewId: decision.finding.sourceViewId,
        mapId: decision.mapId,
        mapRevisionId: decision.mapRevisionId,
        zoneId: decision.zoneId,
        zoneType: decision.zoneType,
        zoneOverlap: decision.zoneOverlap,
        ruleId: decision.ruleId,
        ruleInputs: decision.ruleInputs,
        filterPolicyVersion: decision.filterPolicyVersion,
        detectorVersion: decision.detectorVersion,
        humanTruth: truth.humanTruth,
      };
      decisions.push(reportDecision);
      if (truth.humanTruth === "HUMAN_REMOVED_FAKE") {
        fakesFiltered += 1;
      } else {
        realFindingsFiltered += 1;
        if (truth.printOverlap) printOverlapRealFiltered += 1;
        immediateAlerts.push({
          ...reportDecision,
          imageCrop: crop(decision.finding),
        });
      }
    }
    if (mapUsable) {
      mapCoveredRealRetained += real.filter(({ finding }) => !filteredIds.has(finding.id)).length;
      filterEligibleRealRetained += real.filter(({ finding }) =>
        finding.origin !== "SMART_MARK" && !filteredIds.has(finding.id)).length;
    }
    const afterGradeFindings = baselineGradeFindings.filter(({ id }) => !filteredIds.has(id));
    cardReports.push({
      sessionId: card.sessionId,
      corpus: card.corpus,
      mapCoverage: card.map
        ? {
            status: mapUsable ? "COVERED" : "UNUSABLE",
            mapId: card.map.revision.mapId,
            mapRevisionId: card.map.revision.revisionId,
            trainingCard: card.map.revision.sourceSessionId === card.sessionId,
            independentValidation: card.map.revision.sourceSessionId !== card.sessionId,
          }
        : { status: "MISSING" },
      beforeCandidateCount: card.findings.length,
      afterCandidateCount: activeFindings.length,
      filteredCount: filtered.length,
      gradeBefore: grade(card.capture, baselineGradeFindings),
      gradeAfter: grade(card.capture, afterGradeFindings),
      boundaryComparisons: card.boundaryComparisons,
    });
  }

  const retention = (retained: number, total: number) => total === 0 ? null : retained / total;
  return {
    status: SPEEDSTER_MAP_FILTER_VERIFICATION_STATUS,
    zeroWrite: true,
    contamination: {
      historicalCorpus: "The full 50-card corpus was used during earlier detector research.",
      trainedMaps: "Human maps may be created from cards in the same 50-card corpus.",
      trainingCardsAreIndependentValidation: false,
      singleCopyResults: "DESCRIPTIVE_ONLY",
    },
    totals: {
      cards: cards.length,
      contaminatedCards: cards.filter(({ corpus }) => corpus === "CONTAMINATED_50").length,
      heldOutCards: cards.filter(({ corpus }) => corpus === "HELD_OUT").length,
      fakes: fakeCount,
      realFindings: realCount,
      printOverlapRealFindings: printOverlapRealCount,
      printOverlapRealFindingsFiltered: printOverlapRealFiltered,
      mapCoveredCards: cardReports.filter(({ mapCoverage }) => mapCoverage.status === "COVERED").length,
      fakesFiltered,
      realFindingsFiltered,
      allRealRetention: retention(realCount - realFindingsFiltered, realCount),
      printOverlapRealRetention: retention(
        printOverlapRealCount - printOverlapRealFiltered,
        printOverlapRealCount,
      ),
      mapCoveredRealRetention: retention(mapCoveredRealRetained, mapCoveredReal),
      actuallyFilterEligibleRealRetention: retention(filterEligibleRealRetained, filterEligibleReal),
    },
    immediateAlertRequired: immediateAlerts.length > 0,
    immediateAlerts,
    decisions,
    perCard: cardReports,
    contaminated: cardReports.filter(({ corpus }) => corpus === "CONTAMINATED_50"),
    heldOut: cardReports.filter(({ corpus }) => corpus === "HELD_OUT"),
    missingMaps,
    unusableMaps,
    unexpectedCards,
  };
}
