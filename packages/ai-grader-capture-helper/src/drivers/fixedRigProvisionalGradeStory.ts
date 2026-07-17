export const PROVISIONAL_GRADE_RULES_VERSION = "provisional_grade_rules_v0.2";
export const PROVISIONAL_GRADE_STORY_ENGINE_VERSION = "ten-kings-grade-story-engine-v0.2";

type JsonObject = Record<string, any>;
type GradeSide = "front" | "back" | "both";
type GradeCategory = "centering" | "corner" | "edge" | "surface" | "confidence";
type GateStatus = "pass" | "accepted_warning" | "fail";
type ConfidenceBand = "low" | "medium" | "high";
type SeverityBand = "low" | "medium" | "high";

export interface FixedRigProvisionalGateResult {
  gate: string;
  status: GateStatus;
  required: boolean;
  summary: string;
  evidenceRefs: string[];
}

export interface FixedRigProvisionalElementScore {
  category: Exclude<GradeCategory, "confidence">;
  status: "provisional_diagnostic" | "insufficient_evidence";
  score?: number;
  confidence: number;
  confidenceBand: ConfidenceBand;
  primaryMetrics: JsonObject;
  warnings: string[];
  evidenceRefs: string[];
  explanation: string;
  weakestFinding?: string;
}

export interface FixedRigGradeImpactCandidate {
  id: string;
  category: GradeCategory;
  side: GradeSide;
  severity: SeverityBand;
  confidence: number;
  confidenceBand: ConfidenceBand;
  provisionalGradeImpact: number;
  evidenceRefs: string[];
  sourceChannels?: number[];
  recommendedFollowUp?: string;
  explanation: string;
}

export interface FixedRigGradeStoryClaim {
  id: string;
  category: GradeCategory | "overall";
  text: string;
  evidenceRefs: string[];
}

export interface FixedRigWhyNot10Reason {
  id: string;
  category: GradeCategory;
  severity: SeverityBand;
  reason: string;
  evidenceRefs: string[];
}

export interface FixedRigProvisionalGradeStoryResult {
  schemaVersion: typeof PROVISIONAL_GRADE_STORY_ENGINE_VERSION;
  rulesVersion: typeof PROVISIONAL_GRADE_RULES_VERSION;
  status: "provisional_diagnostic_grade" | "insufficient_evidence";
  certificationStatus: "not_certified";
  finalGradeComputed: false;
  certifiedClaim: false;
  labelGenerated: false;
  qrGenerated: false;
  certificateGenerated: false;
  provisionalGradeComputed: boolean;
  gradeScale: "1_to_10";
  provisionalOverallGrade?: number;
  elementScores: {
    centering: FixedRigProvisionalElementScore;
    corners: FixedRigProvisionalElementScore;
    edges: FixedRigProvisionalElementScore;
    surface: FixedRigProvisionalElementScore;
  };
  confidence: {
    score: number;
    band: ConfidenceBand;
    explanation: string;
    warnings: string[];
  };
  gates: {
    requiredGatesPassed: boolean;
    allowAcceptedWarnings: boolean;
    results: FixedRigProvisionalGateResult[];
    blockers: string[];
    acceptedWarnings: string[];
  };
  formulas: {
    weights: { centering: number; corners: number; edges: number; surface: number };
    appliedWeights: { centering: number; corners: number; edges: number; surface: number };
    missingElementPolicy: string;
    clippingSoftThreshold: number;
    clippingHardBlockThreshold: number;
    sharpnessSoftThreshold: number;
    capRules: string[];
    note: string;
  };
  gradeImpactCandidates: FixedRigGradeImpactCandidate[];
  whyNot10: FixedRigWhyNot10Reason[];
  story: {
    mode: "grade_story_engine_v0";
    headline: string;
    summary: string;
    strongestPositiveFinding: string;
    strongestWarning: string;
    confidenceExplanation: string;
    elementSummaries: Record<Exclude<GradeCategory, "confidence">, string>;
    claims: FixedRigGradeStoryClaim[];
  };
  limitations: string[];
}

export interface BuildFixedRigProvisionalGradeStoryInput {
  packageId?: string;
  generatedAt?: string;
  frontDiagnostic?: JsonObject;
  backDiagnostic?: JsonObject;
  frontSurface?: JsonObject;
  backSurface?: JsonObject;
  frontStats?: JsonObject;
  backStats?: JsonObject;
  fixtureProfile?: JsonObject;
  frontFixtureProfile?: JsonObject;
  backFixtureProfile?: JsonObject;
  activeLightingProfile?: JsonObject;
  warnings?: string[];
  allowAcceptedWarnings?: boolean;
}

const WEIGHTS = { centering: 0.3, corners: 0.25, edges: 0.25, surface: 0.2 };
const NORMALIZED_MISSING_CENTERING_GRADE_CAP = 9;
const NORMALIZED_MISSING_CENTERING_CONFIDENCE_PENALTY = 0.18;
const ACCEPTED_WARNING_CONFIDENCE_PENALTY = 0.08;
const CLIPPING_SOFT_THRESHOLD = 0.02;
const CLIPPING_HARD_BLOCK_THRESHOLD = 0.95;
const SHARPNESS_SOFT_THRESHOLD = 60;

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function roundMetric(value: number, places = 3): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function confidenceBand(score: number): ConfidenceBand {
  if (score >= 0.72) return "high";
  if (score >= 0.45) return "medium";
  return "low";
}

function severityFromImpact(impact: number): SeverityBand {
  if (impact >= 1.25) return "high";
  if (impact >= 0.55) return "medium";
  return "low";
}

function scoreFromDiagnostics(values: Array<JsonObject | undefined>): { score?: number; confidence: number; warnings: string[]; metrics: JsonObject } {
  const computed = values.filter(
    (value): value is JsonObject => Boolean(value && value.status === "computed_diagnostic" && finiteNumber(value.score))
  );
  const warnings = values.flatMap((value) => (Array.isArray(value?.warnings) ? value.warnings : []));
  if (!computed.length) {
    return {
      confidence: 0,
      warnings: [...warnings, "Required diagnostic scores were not computed."],
      metrics: { computedCount: 0, requiredCount: values.length },
    };
  }
  const score = roundMetric(computed.reduce((sum, value) => sum + Number(value.score), 0) / computed.length, 2);
  const confidenceValues = computed.map((value) => Number(value.confidence)).filter((value) => Number.isFinite(value));
  const confidence = roundMetric(confidenceValues.reduce((sum, value) => sum + value, 0) / Math.max(1, confidenceValues.length), 3);
  return {
    score,
    confidence,
    warnings,
    metrics: { computedCount: computed.length, requiredCount: values.length, sourceScores: computed.map((value) => value.score) },
  };
}

function elementResult(input: {
  category: Exclude<GradeCategory, "confidence">;
  score?: number;
  confidence: number;
  metrics: JsonObject;
  warnings: string[];
  evidenceRefs: string[];
  explanation: string;
  weakestFinding?: string;
}): FixedRigProvisionalElementScore {
  const status = finiteNumber(input.score) ? "provisional_diagnostic" : "insufficient_evidence";
  return {
    category: input.category,
    status,
    ...(finiteNumber(input.score) ? { score: roundMetric(input.score, 2) } : {}),
    confidence: roundMetric(input.confidence, 3),
    confidenceBand: confidenceBand(input.confidence),
    primaryMetrics: input.metrics,
    warnings: input.warnings,
    evidenceRefs: input.evidenceRefs,
    explanation: input.explanation,
    ...(input.weakestFinding ? { weakestFinding: input.weakestFinding } : {}),
  };
}

function gate(
  gateName: string,
  pass: boolean,
  acceptedWarning: boolean,
  summary: string,
  evidenceRefs: string[]
): FixedRigProvisionalGateResult {
  return {
    gate: gateName,
    status: pass ? "pass" : acceptedWarning ? "accepted_warning" : "fail",
    required: true,
    summary,
    evidenceRefs,
  };
}

function allSideEvidenceComplete(diagnostic: JsonObject | undefined, surface: JsonObject | undefined): boolean {
  return Boolean(
    diagnostic?.centering &&
      diagnostic?.corners &&
      diagnostic?.edges &&
      diagnostic?.surface &&
      (surface?.status === "computed_diagnostic" || diagnostic?.surface?.status === "computed_diagnostic")
  );
}

function usesNormalizedCardAnalysis(profile: JsonObject | undefined): boolean {
  return profile?.analysisCoordinateFrame === "normalized_card_portrait_pixels";
}

function normalizedCardAnalysisBasisPasses(profile: JsonObject | undefined): boolean {
  return Boolean(
    usesNormalizedCardAnalysis(profile) &&
      profile?.acquisitionPlacementExcludedFromGrade === true &&
      profile?.normalizedCoordinateOutcome?.boundaryFillsCanonicalFrame === true &&
      profile?.normalizedCoordinateOutcome?.framingStatus === "pass" &&
      profile?.normalizedCoordinateOutcome?.overlayAlignmentStatus === "pass"
  );
}

function normalizedDetectedGeometryPasses(profile: JsonObject | undefined): boolean {
  const geometry = profile?.sourceGeometry;
  return Boolean(
    usesNormalizedCardAnalysis(profile) &&
      geometry?.geometrySource === "detected" &&
      geometry?.captureMode === "automatic_detection" &&
      geometry?.detectionUsed === true &&
      geometry?.manualOverrideUsed === false &&
      geometry?.placementState === "ready" &&
      finiteNumber(geometry?.confidence)
  );
}

function surfaceCandidates(surface: JsonObject | undefined): JsonObject[] {
  return Array.isArray(surface?.candidates) ? surface.candidates : [];
}

function surfaceScore(frontSurface: JsonObject | undefined, backSurface: JsonObject | undefined): {
  score?: number;
  confidence: number;
  warnings: string[];
  metrics: JsonObject;
  weakestFinding?: string;
} {
  const candidates = [...surfaceCandidates(frontSurface), ...surfaceCandidates(backSurface)];
  const warnings = [
    ...(Array.isArray(frontSurface?.warnings) ? frontSurface.warnings : []),
    ...(Array.isArray(backSurface?.warnings) ? backSurface.warnings : []),
  ];
  const complete = frontSurface?.status === "computed_diagnostic" && backSurface?.status === "computed_diagnostic";
  if (!complete) {
    return {
      confidence: 0,
      warnings: [...warnings, "Front/back Surface Intelligence V0 outputs are required for provisional surface scoring."],
      metrics: { frontStatus: frontSurface?.status ?? "missing", backStatus: backSurface?.status ?? "missing", candidateCount: candidates.length },
    };
  }
  const penalties = candidates.map((candidate) => {
    const severity = candidate.severityBand;
    const proxy = finiteNumber(candidate.severityProxy) ? candidate.severityProxy : finiteNumber(candidate.anomalyProxyScore) ? candidate.anomalyProxyScore : 0;
    const bandPenalty = severity === "high" ? 1.4 : severity === "medium" ? 0.75 : 0.24;
    return Math.max(bandPenalty, clamp(proxy / 100, 0, 1.8));
  });
  const penalty = clamp(penalties.reduce((sum, value) => sum + value, 0), 0, 4.5);
  const confidenceValues = [frontSurface?.confidence?.score, backSurface?.confidence?.score].filter(finiteNumber);
  const confidence = confidenceValues.length ? roundMetric(confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length, 3) : 0.52;
  const strongest = [...candidates].sort((a, b) => Number(b.severityProxy ?? b.anomalyProxyScore ?? 0) - Number(a.severityProxy ?? a.anomalyProxyScore ?? 0))[0];
  return {
    score: roundMetric(clamp(10 - penalty, 1, 10), 2),
    confidence,
    warnings,
    metrics: {
      detectorIds: [frontSurface?.detectorId, backSurface?.detectorId].filter(Boolean),
      candidateCount: candidates.length,
      penalty: roundMetric(penalty, 3),
      strongestCandidateId: strongest?.candidateId,
      strongestCandidateSeverity: strongest?.severityBand,
      strongestCandidateSourceChannels: strongest?.sourceChannels,
    },
    weakestFinding: strongest
      ? `${strongest.side ?? "unknown"} ${strongest.candidateId ?? "surface candidate"} (${strongest.severityBand ?? "unknown"} severity)`
      : "No surface anomaly candidate exceeded the V0 threshold.",
  };
}

function weakestNamedScore(entries: Array<{ label: string; element?: JsonObject }>): { label?: string; score?: number } {
  return entries
    .filter((entry) => finiteNumber(entry.element?.score))
    .sort((a, b) => Number(a.element?.score) - Number(b.element?.score))
    .map((entry) => ({ label: entry.label, score: Number(entry.element?.score) }))[0] ?? {};
}

function buildGradeImpactCandidates(input: {
  elements: FixedRigProvisionalGradeStoryResult["elementScores"];
  frontSurface?: JsonObject;
  backSurface?: JsonObject;
  frontStats?: JsonObject;
  backStats?: JsonObject;
  gateResults: FixedRigProvisionalGateResult[];
}): FixedRigGradeImpactCandidate[] {
  const candidates: FixedRigGradeImpactCandidate[] = [];
  const add = (candidate: FixedRigGradeImpactCandidate) => candidates.push(candidate);
  for (const surface of [input.frontSurface, input.backSurface]) {
    for (const candidate of surfaceCandidates(surface).slice(0, 6)) {
      const impact = clamp((Number(candidate.severityProxy ?? candidate.anomalyProxyScore ?? 0) || 0) / 85, 0.18, 2.4);
      add({
        id: String(candidate.candidateId ?? `surface-candidate-${candidates.length + 1}`),
        category: "surface",
        side: candidate.side === "back" ? "back" : "front",
        severity: candidate.severityBand === "high" || candidate.severityBand === "medium" ? candidate.severityBand : "low",
        confidence: finiteNumber(candidate.confidence) ? roundMetric(candidate.confidence, 3) : input.elements.surface.confidence,
        confidenceBand: confidenceBand(finiteNumber(candidate.confidence) ? candidate.confidence : input.elements.surface.confidence),
        provisionalGradeImpact: roundMetric(impact, 2),
        evidenceRefs: [
          `analysis.${candidate.side ?? "front"}.surfaceAnalysis.candidates`,
          ...(candidate.evidenceRefs?.heatmap ? [String(candidate.evidenceRefs.heatmap)] : []),
          ...(candidate.evidenceRefs?.surfaceVision ? [String(candidate.evidenceRefs.surfaceVision)] : []),
        ],
        sourceChannels: Array.isArray(candidate.sourceChannels) ? candidate.sourceChannels : undefined,
        recommendedFollowUp: candidate.needsDinoLiteFollowUp ? "Dino-Lite manual close-up confirmation recommended." : "No Dino-Lite follow-up required by V0 rule.",
        explanation: `Surface Intelligence V0 candidate ${candidate.candidateId ?? ""} reduced the provisional surface score.`,
      });
    }
  }
  for (const [category, element] of Object.entries(input.elements) as Array<[Exclude<GradeCategory, "confidence">, FixedRigProvisionalElementScore]>) {
    if (finiteNumber(element.score) && element.score < 9.5) {
      add({
        id: `${category}-weakest-proxy`,
        category,
        side: "both",
        severity: severityFromImpact(10 - element.score),
        confidence: element.confidence,
        confidenceBand: element.confidenceBand,
        provisionalGradeImpact: roundMetric(10 - element.score, 2),
        evidenceRefs: element.evidenceRefs,
        explanation: element.weakestFinding ?? `${category} provisional score is below 9.5.`,
      });
    }
  }
  const clippingCandidates = [
    { side: "front" as const, stats: input.frontStats },
    { side: "back" as const, stats: input.backStats },
  ];
  for (const entry of clippingCandidates) {
    const clipped = entry.stats?.clippedPixelFraction;
    if (finiteNumber(clipped) && clipped > CLIPPING_SOFT_THRESHOLD) {
      add({
        id: `${entry.side}-clipping-confidence-warning`,
        category: "confidence",
        side: entry.side,
        severity: clipped > 0.1 ? "high" : "medium",
        confidence: clipped > 0.1 ? 0.35 : 0.55,
        confidenceBand: clipped > 0.1 ? "low" : "medium",
        provisionalGradeImpact: roundMetric(clamp(clipped * 4, 0.1, 1.8), 2),
        evidenceRefs: [`analysis.${entry.side}.allOn.clippedPixelFraction`],
        explanation: `${entry.side} clipping ${clipped} reduced confidence in affected diagnostics.`,
      });
    }
  }
  for (const result of input.gateResults.filter((result) => result.status === "accepted_warning")) {
    add({
      id: `${result.gate}-accepted-warning`,
      category: "confidence",
      side: "both",
      severity: "medium",
      confidence: 0.5,
      confidenceBand: "medium",
      provisionalGradeImpact: 0,
      evidenceRefs: result.evidenceRefs,
      explanation: `Gate accepted as warning for provisional diagnostic only: ${result.summary}`,
    });
  }
  return candidates.sort((a, b) => b.provisionalGradeImpact - a.provisionalGradeImpact);
}

function insufficientElement(category: Exclude<GradeCategory, "confidence">, reason: string, refs: string[]): FixedRigProvisionalElementScore {
  return {
    category,
    status: "insufficient_evidence",
    confidence: 0,
    confidenceBand: "low",
    primaryMetrics: {},
    warnings: [reason],
    evidenceRefs: refs,
    explanation: reason,
  };
}

export function buildFixedRigProvisionalGradeStory(input: BuildFixedRigProvisionalGradeStoryInput): FixedRigProvisionalGradeStoryResult {
  const allowAcceptedWarnings = input.allowAcceptedWarnings ?? true;
  const frontFixtureProfile = input.frontFixtureProfile ?? input.fixtureProfile;
  const backFixtureProfile = input.backFixtureProfile ?? input.fixtureProfile;
  const sideFixtureProfiles = [frontFixtureProfile, backFixtureProfile];
  const productionReadiness = sideFixtureProfiles.map((profile) => profile?.productionReadiness);
  const productionGates = productionReadiness.map((readiness) => readiness?.gates ?? {});
  const diagnosticAccepted =
    allowAcceptedWarnings &&
    productionReadiness.every((readiness) => readiness?.diagnosticOnlyAllowedWithOperatorAcceptance === true);
  const rulerPass = sideFixtureProfiles.every(
    (profile) =>
      profile?.referenceType === "fixed_metric_rulers" &&
      profile?.pixelToMmConsistency?.status === "pass" &&
      finiteNumber(profile?.mmPerPixelX) &&
      finiteNumber(profile?.mmPerPixelY)
  );
  const normalizedAnalysisRequested = sideFixtureProfiles.some(usesNormalizedCardAnalysis);
  const normalizedAnalysis = sideFixtureProfiles.every(usesNormalizedCardAnalysis);
  const normalizedAnalysisBasisPass = normalizedAnalysis && sideFixtureProfiles.every(normalizedCardAnalysisBasisPasses);
  const normalizedDetectedGeometryPass = normalizedAnalysis && sideFixtureProfiles.every(normalizedDetectedGeometryPasses);
  const repeatabilityPass = sideFixtureProfiles.every(
    (profile, index) =>
      productionGates[index]?.repeatability === "pass" ||
      profile?.status === "repeatability_checked" ||
      profile?.status === "production_candidate"
  );
  const framingPass = sideFixtureProfiles.every((profile) => profile?.framingGate?.status === "pass");
  const overlayPass = sideFixtureProfiles.every(
    (profile, index) =>
      profile?.framingGate?.overlayAlignmentStatus === "pass" ||
      productionGates[index]?.overlayAlignment === "pass"
  );
  const frontEvidencePass = allSideEvidenceComplete(input.frontDiagnostic, input.frontSurface);
  const backEvidencePass = allSideEvidenceComplete(input.backDiagnostic, input.backSurface);
  const surfacePass = input.frontSurface?.status === "computed_diagnostic" && input.backSurface?.status === "computed_diagnostic";
  const maxClipped = Math.max(
    finiteNumber(input.frontStats?.clippedPixelFraction) ? input.frontStats.clippedPixelFraction : Number.POSITIVE_INFINITY,
    finiteNumber(input.backStats?.clippedPixelFraction) ? input.backStats.clippedPixelFraction : Number.POSITIVE_INFINITY
  );
  const clippingPass = maxClipped <= CLIPPING_SOFT_THRESHOLD;
  const clippingHardBlock = Number.isFinite(maxClipped) && maxClipped >= CLIPPING_HARD_BLOCK_THRESHOLD;
  const clippingAccepted = allowAcceptedWarnings && Number.isFinite(maxClipped) && !clippingHardBlock;
  const clippingSummary = Number.isFinite(maxClipped)
    ? `Maximum clipped fraction is ${maxClipped}; soft target is ${CLIPPING_SOFT_THRESHOLD}. Clipping below ${CLIPPING_HARD_BLOCK_THRESHOLD} is treated as a V0 confidence warning when required evidence is otherwise present.`
    : `Maximum clipped fraction is missing; soft target is ${CLIPPING_SOFT_THRESHOLD}.`;
  const minSharpness = Math.min(
    finiteNumber(input.frontStats?.sharpnessScore) ? input.frontStats.sharpnessScore : Number.POSITIVE_INFINITY,
    finiteNumber(input.backStats?.sharpnessScore) ? input.backStats.sharpnessScore : Number.POSITIVE_INFINITY
  );
  const focusPass = minSharpness >= SHARPNESS_SOFT_THRESHOLD;
  const focusAccepted = allowAcceptedWarnings && Number.isFinite(minSharpness) && minSharpness >= SHARPNESS_SOFT_THRESHOLD * 0.65;
  const gateResults = [
    normalizedAnalysisRequested
      ? gate(
          "normalized_coordinate_basis",
          normalizedAnalysisBasisPass,
          false,
          "Canonical normalized-card framing must be explicit, complete, and separated from acquisition placement before region-relative diagnostics can be scored.",
          [
            "analysis.fixtureCalibrationProfile.analysisCoordinateFrame",
            "analysis.fixtureCalibrationProfile.normalizedCoordinateOutcome",
            "analysis.fixtureCalibrationProfile.acquisitionPlacementExcludedFromGrade",
          ]
        )
      : gate("ruler_calibration", rulerPass, diagnosticAccepted && productionGates.every((gates) => gates.rulerCalibration === "pass" || gates.rulerCalibration === "warn"), "Ruler calibration must pass using fixed metric rulers.", [
          "analysis.visionLab.measurementOverlay",
          "analysis.fixtureCalibrationProfile.pixelToMmConsistency",
        ]),
    ...(normalizedAnalysisRequested
      ? [
          gate(
            "normalized_geometry_provenance",
            normalizedDetectedGeometryPass,
            false,
            "Both front and back canonical normalizations must retain coherent Ready automatic geometry provenance.",
            [
              "analysis.fixtureCalibrationProfile.sourceGeometry",
              "analysis.front.normalizedCard.geometry",
              "analysis.back.normalizedCard.geometry",
            ]
          ),
        ]
      : []),
    gate("repeatability", repeatabilityPass, diagnosticAccepted && productionGates.every((gates) => gates.repeatability !== "fail"), "Remove/re-seat repeatability must pass or be accepted as diagnostic warning.", [
      "analysis.fixtureCalibrationProfile.productionReadiness.gates.repeatability",
    ]),
    gate("framing_overlay", framingPass && overlayPass, diagnosticAccepted && productionGates.every((gates) => gates.framing !== "fail" && gates.overlayAlignment !== "fail"), "Front/back framing and overlay alignment gates must pass.", [
      "analysis.fixtureCalibrationProfile.framingGate",
    ]),
    gate("front_evidence_complete", frontEvidencePass, false, "Front evidence package must include diagnostics and surface intelligence.", ["analysis.front"]),
    gate("back_evidence_complete", backEvidencePass, false, "Back evidence package must include diagnostics and surface intelligence.", ["analysis.back"]),
    gate("surface_intelligence_complete", surfacePass, false, "Front/back Surface Intelligence V0 must be computed.", ["analysis.surfaceIntelligence"]),
    gate("clipping", clippingPass, clippingAccepted, clippingSummary, [
      "analysis.front.allOn.clippedPixelFraction",
      "analysis.back.allOn.clippedPixelFraction",
    ]),
    gate("focus_sharpness", focusPass, focusAccepted, `Minimum sharpness is ${Number.isFinite(minSharpness) ? minSharpness : "missing"}; soft target is ${SHARPNESS_SOFT_THRESHOLD}.`, [
      "analysis.front.allOn.sharpnessScore",
      "analysis.back.allOn.sharpnessScore",
    ]),
  ];
  const evidenceGateBlockers = gateResults.filter((result) => result.status === "fail").map((result) => `${result.gate}: ${result.summary}`);
  const evidenceGatesPassed = evidenceGateBlockers.length === 0;
  const centeringRaw = scoreFromDiagnostics([input.frontDiagnostic?.centering, input.backDiagnostic?.centering]);
  const cornerEntries = [
    { label: "front top-left corner", element: input.frontDiagnostic?.corners?.topLeft },
    { label: "front top-right corner", element: input.frontDiagnostic?.corners?.topRight },
    { label: "front bottom-right corner", element: input.frontDiagnostic?.corners?.bottomRight },
    { label: "front bottom-left corner", element: input.frontDiagnostic?.corners?.bottomLeft },
    { label: "back top-left corner", element: input.backDiagnostic?.corners?.topLeft },
    { label: "back top-right corner", element: input.backDiagnostic?.corners?.topRight },
    { label: "back bottom-right corner", element: input.backDiagnostic?.corners?.bottomRight },
    { label: "back bottom-left corner", element: input.backDiagnostic?.corners?.bottomLeft },
  ];
  const edgeEntries = [
    { label: "front top edge", element: input.frontDiagnostic?.edges?.top },
    { label: "front right edge", element: input.frontDiagnostic?.edges?.right },
    { label: "front bottom edge", element: input.frontDiagnostic?.edges?.bottom },
    { label: "front left edge", element: input.frontDiagnostic?.edges?.left },
    { label: "back top edge", element: input.backDiagnostic?.edges?.top },
    { label: "back right edge", element: input.backDiagnostic?.edges?.right },
    { label: "back bottom edge", element: input.backDiagnostic?.edges?.bottom },
    { label: "back left edge", element: input.backDiagnostic?.edges?.left },
  ];
  const cornerRaw = scoreFromDiagnostics(cornerEntries.map((entry) => entry.element));
  const edgeRaw = scoreFromDiagnostics(edgeEntries.map((entry) => entry.element));
  const surfaceRaw = surfaceScore(input.frontSurface, input.backSurface);
  const weakestCorner = weakestNamedScore(cornerEntries);
  const weakestEdge = weakestNamedScore(edgeEntries);
  const normalizedCenteringExcluded = normalizedAnalysis && !finiteNumber(centeringRaw.score);
  const centeringExplanation = normalizedCenteringExcluded
    ? "Printed-design centering is not computed from canonical card-boundary geometry; camera-frame placement margins are intentionally excluded from grading."
    : "Centering uses ruler-calibrated printed-border measurements from front/back portrait geometry.";
  const elementScores = evidenceGatesPassed
    ? {
        centering: elementResult({
          category: "centering",
          score: centeringRaw.score,
          confidence: centeringRaw.confidence,
          metrics: centeringRaw.metrics,
          warnings: centeringRaw.warnings,
          evidenceRefs: ["analysis.front.diagnosticGrading.centering", "analysis.back.diagnosticGrading.centering"],
          explanation: centeringExplanation,
        }),
        corners: elementResult({
          category: "corner",
          score: cornerRaw.score,
          confidence: cornerRaw.confidence,
          metrics: { ...cornerRaw.metrics, weakestCorner },
          warnings: cornerRaw.warnings,
          evidenceRefs: ["analysis.front.diagnosticGrading.corners", "analysis.back.diagnosticGrading.corners", "manifest.front.roiCrops", "manifest.back.roiCrops"],
          explanation: "Corner score is a conservative average of front/back corner ROI proxy diagnostics.",
          weakestFinding: weakestCorner.label ? `${weakestCorner.label} score ${weakestCorner.score}` : undefined,
        }),
        edges: elementResult({
          category: "edge",
          score: edgeRaw.score,
          confidence: edgeRaw.confidence,
          metrics: { ...edgeRaw.metrics, weakestEdge },
          warnings: edgeRaw.warnings,
          evidenceRefs: ["analysis.front.diagnosticGrading.edges", "analysis.back.diagnosticGrading.edges", "manifest.front.roiCrops", "manifest.back.roiCrops"],
          explanation: "Edge score is a conservative average of front/back edge ROI proxy diagnostics.",
          weakestFinding: weakestEdge.label ? `${weakestEdge.label} score ${weakestEdge.score}` : undefined,
        }),
        surface: elementResult({
          category: "surface",
          score: surfaceRaw.score,
          confidence: surfaceRaw.confidence,
          metrics: surfaceRaw.metrics,
          warnings: surfaceRaw.warnings,
          evidenceRefs: ["analysis.surfaceIntelligence", "analysis.visionLab.sides.front.candidates", "analysis.visionLab.sides.back.candidates"],
          explanation: "Surface score uses Surface Intelligence V0 candidate severity, source-channel attribution, heatmap, and confidence outputs.",
          weakestFinding: surfaceRaw.weakestFinding,
        }),
      }
    : {
        centering: insufficientElement("centering", "Required grading gates failed; centering score is not computed.", ["analysis.provisionalGradeStory.gates"]),
        corners: insufficientElement("corner", "Required grading gates failed; corner score is not computed.", ["analysis.provisionalGradeStory.gates"]),
        edges: insufficientElement("edge", "Required grading gates failed; edge score is not computed.", ["analysis.provisionalGradeStory.gates"]),
        surface: insufficientElement("surface", "Required grading gates failed; surface score is not computed.", ["analysis.provisionalGradeStory.gates"]),
      };
  const scoreValues = elementScores;
  const normalizedPartialScoreReady =
    normalizedCenteringExcluded &&
    finiteNumber(scoreValues.corners.score) &&
    finiteNumber(scoreValues.edges.score) &&
    finiteNumber(scoreValues.surface.score);
  const completeFourElementScoreReady =
    finiteNumber(scoreValues.centering.score) &&
    finiteNumber(scoreValues.corners.score) &&
    finiteNumber(scoreValues.edges.score) &&
    finiteNumber(scoreValues.surface.score);
  const scoreCoveragePass = completeFourElementScoreReady || normalizedPartialScoreReady;
  const evaluatedGateResults = [
    ...gateResults,
    gate(
      "element_score_coverage",
      scoreCoveragePass,
      false,
      normalizedPartialScoreReady
        ? "Corner, edge, and surface diagnostics are complete. Printed-design centering is visibly unavailable, so its weight is redistributed and the provisional grade is confidence-penalized and capped."
        : "A complete legacy score requires centering, corner, edge, and surface diagnostics; normalized-card scoring may omit only printed-design centering when corner, edge, and surface diagnostics are complete.",
      [
        "analysis.provisionalGradeStory.elementScores",
        "analysis.front.diagnosticGrading",
        "analysis.back.diagnosticGrading",
      ]
    ),
  ];
  const blockers = evaluatedGateResults.filter((result) => result.status === "fail").map((result) => `${result.gate}: ${result.summary}`);
  const acceptedWarnings = evaluatedGateResults.filter((result) => result.status === "accepted_warning").map((result) => `${result.gate}: ${result.summary}`);
  const requiredGatesPassed = blockers.length === 0;
  const normalizedAvailableWeight = WEIGHTS.corners + WEIGHTS.edges + WEIGHTS.surface;
  const appliedWeights = normalizedPartialScoreReady
    ? {
        centering: 0,
        corners: roundMetric(WEIGHTS.corners / normalizedAvailableWeight, 6),
        edges: roundMetric(WEIGHTS.edges / normalizedAvailableWeight, 6),
        surface: roundMetric(WEIGHTS.surface / normalizedAvailableWeight, 6),
      }
    : { ...WEIGHTS };
  const weighted = scoreCoveragePass
    ? (finiteNumber(scoreValues.centering.score) ? scoreValues.centering.score * appliedWeights.centering : 0) +
      Number(scoreValues.corners.score) * appliedWeights.corners +
      Number(scoreValues.edges.score) * appliedWeights.edges +
      Number(scoreValues.surface.score) * appliedWeights.surface
    : undefined;
  const surfaceHighCandidates = [...surfaceCandidates(input.frontSurface), ...surfaceCandidates(input.backSurface)].filter((candidate) => candidate.severityBand === "high");
  const cap = Math.min(
    surfaceHighCandidates.length ? 8.5 : 10,
    normalizedPartialScoreReady ? NORMALIZED_MISSING_CENTERING_GRADE_CAP : 10
  );
  const provisionalOverallGrade = requiredGatesPassed && finiteNumber(weighted) ? roundMetric(Math.min(weighted, cap), 2) : undefined;
  const gatePenalty = gateResults.filter((result) => result.status === "accepted_warning").length * ACCEPTED_WARNING_CONFIDENCE_PENALTY;
  const clippingPenalty = finiteNumber(maxClipped) && maxClipped > CLIPPING_SOFT_THRESHOLD ? clamp(maxClipped * 0.5, 0.02, 0.2) : 0;
  const missingCenteringPenalty = normalizedPartialScoreReady ? NORMALIZED_MISSING_CENTERING_CONFIDENCE_PENALTY : 0;
  const elementConfidence = Object.values(elementScores)
    .filter((element) => element.status === "provisional_diagnostic")
    .map((element) => element.confidence)
    .filter(finiteNumber);
  const confidenceScore = requiredGatesPassed
    ? roundMetric(
        clamp(
          elementConfidence.reduce((sum, value) => sum + value, 0) / Math.max(1, elementConfidence.length) -
            gatePenalty -
            clippingPenalty -
            missingCenteringPenalty,
          0,
          1
        ),
        3
      )
    : 0;
  const confidenceWarnings = [
    ...acceptedWarnings,
    ...(normalizedPartialScoreReady
      ? [
          `Printed-design centering is unavailable in normalized card coordinates; camera placement was excluded, confidence was reduced by ${NORMALIZED_MISSING_CENTERING_CONFIDENCE_PENALTY}, and the provisional overall grade was capped at ${NORMALIZED_MISSING_CENTERING_GRADE_CAP}.`,
        ]
      : []),
    ...(finiteNumber(maxClipped) && maxClipped > CLIPPING_SOFT_THRESHOLD ? [`Clipping above soft target reduces confidence; max clipped fraction ${maxClipped}.`] : []),
    ...(input.warnings ?? []),
  ];
  const preliminaryCandidates = buildGradeImpactCandidates({
    elements: elementScores,
    frontSurface: input.frontSurface,
    backSurface: input.backSurface,
    frontStats: input.frontStats,
    backStats: input.backStats,
    gateResults: evaluatedGateResults,
  });
  if (normalizedPartialScoreReady) {
    preliminaryCandidates.push({
      id: "centering-not-computed-normalized-card",
      category: "centering",
      side: "both",
      severity: "medium",
      confidence: 0,
      confidenceBand: "low",
      provisionalGradeImpact: 1,
      evidenceRefs: [
        "analysis.front.diagnosticGrading.centering",
        "analysis.back.diagnosticGrading.centering",
        "analysis.fixtureCalibrationProfile.acquisitionPlacementExcludedFromGrade",
      ],
      recommendedFollowUp: "Human review of printed-design centering is required until a validated normalized-card centering detector is available.",
      explanation:
        "Printed-design centering was not computed; acquisition placement margins were not substituted, so the provisional grade is capped and confidence-reduced.",
    });
    preliminaryCandidates.sort((a, b) => b.provisionalGradeImpact - a.provisionalGradeImpact);
  }
  const whyNot10: FixedRigWhyNot10Reason[] = requiredGatesPassed
    ? preliminaryCandidates.slice(0, 5).map((candidate, index) => ({
        id: `why-not-10-${String(index + 1).padStart(2, "0")}`,
        category: candidate.category,
        severity: candidate.severity,
        reason: candidate.explanation,
        evidenceRefs: candidate.evidenceRefs,
      }))
    : blockers.map((blocker, index) => ({
        id: `why-not-10-gate-${String(index + 1).padStart(2, "0")}`,
        category: "confidence" as const,
        severity: "high" as const,
        reason: `No provisional grade was computed because ${blocker}`,
        evidenceRefs: ["analysis.provisionalGradeStory.gates"],
      }));
  const strongestPositiveFinding =
    requiredGatesPassed && elementScores.centering.status === "provisional_diagnostic"
      ? "Centering is supported by fixed-ruler scale and front/back border-balance diagnostics."
      : requiredGatesPassed && normalizedPartialScoreReady
        ? "Canonical normalized-card corner, edge, and surface diagnostics are complete; printed-design centering remains visibly uncomputed."
      : "The report identifies the exact gates that block a provisional diagnostic grade.";
  const strongestWarning =
    blockers[0] ?? acceptedWarnings[0] ?? preliminaryCandidates[0]?.explanation ?? confidenceWarnings[0] ?? "No major provisional warning emitted by Grade Story Engine V0.";
  const headline = requiredGatesPassed
    ? `Provisional diagnostic grade ${provisionalOverallGrade} / 10`
    : "Insufficient evidence for a provisional diagnostic grade";
  const summary = requiredGatesPassed
    ? normalizedPartialScoreReady
      ? `Grade Story Engine V0 combined normalized-card corner, edge, and surface diagnostics into a capped provisional diagnostic grade. Printed-design centering was not computed, camera placement was excluded, and finalGradeComputed=false.`
      : `Grade Story Engine V0 combined centering, corner, edge, and surface diagnostics into a provisional diagnostic grade. This is not certified and finalGradeComputed=false.`
    : `Grade Story Engine V0 refused to compute a provisional grade because required evidence gates failed.`;
  const claims: FixedRigGradeStoryClaim[] = [
    {
      id: "claim-overall-status",
      category: "overall",
      text: summary,
      evidenceRefs: ["analysis.provisionalGradeStory.gates", "analysis.provisionalGradeStory.elementScores"],
    },
    {
      id: "claim-centering",
      category: "centering",
      text: elementScores.centering.status === "provisional_diagnostic" ? elementScores.centering.explanation : elementScores.centering.explanation,
      evidenceRefs: elementScores.centering.evidenceRefs,
    },
    {
      id: "claim-surface",
      category: "surface",
      text: elementScores.surface.weakestFinding ?? elementScores.surface.explanation,
      evidenceRefs: elementScores.surface.evidenceRefs,
    },
  ];
  return {
    schemaVersion: PROVISIONAL_GRADE_STORY_ENGINE_VERSION,
    rulesVersion: PROVISIONAL_GRADE_RULES_VERSION,
    status: requiredGatesPassed ? "provisional_diagnostic_grade" : "insufficient_evidence",
    certificationStatus: "not_certified",
    finalGradeComputed: false,
    certifiedClaim: false,
    labelGenerated: false,
    qrGenerated: false,
    certificateGenerated: false,
    provisionalGradeComputed: requiredGatesPassed && finiteNumber(provisionalOverallGrade),
    gradeScale: "1_to_10",
    ...(finiteNumber(provisionalOverallGrade) ? { provisionalOverallGrade } : {}),
    elementScores,
    confidence: {
      score: confidenceScore,
      band: confidenceBand(confidenceScore),
      explanation:
        confidenceScore > 0
          ? `Confidence combines element confidence, accepted-warning gates, clipping, and inherited diagnostics. It is ${confidenceBand(confidenceScore)} because this remains provisional diagnostic evidence.`
          : "Confidence is low because no provisional grade was computed.",
      warnings: confidenceWarnings,
    },
    gates: {
      requiredGatesPassed,
      allowAcceptedWarnings,
      results: evaluatedGateResults,
      blockers,
      acceptedWarnings,
    },
    formulas: {
      weights: WEIGHTS,
      appliedWeights,
      missingElementPolicy: normalizedPartialScoreReady
        ? `Printed-design centering is not computed. Its ${WEIGHTS.centering} base weight is redistributed proportionally across computed corner, edge, and surface diagnostics; camera placement margins are excluded, confidence is reduced by ${NORMALIZED_MISSING_CENTERING_CONFIDENCE_PENALTY}, and the grade is capped at ${NORMALIZED_MISSING_CENTERING_GRADE_CAP}.`
        : "All four base element weights apply. Missing legacy centering, corner, edge, or surface scores prevent a provisional overall grade.",
      clippingSoftThreshold: CLIPPING_SOFT_THRESHOLD,
      clippingHardBlockThreshold: CLIPPING_HARD_BLOCK_THRESHOLD,
      sharpnessSoftThreshold: SHARPNESS_SOFT_THRESHOLD,
      capRules: [
        "Any failed required gate refuses the provisional grade.",
        "Accepted-warning gates reduce confidence but do not become certified passes.",
        "Finite clipping above the soft target is an accepted warning for V0 unless the image is near-total saturation.",
        "High-severity surface candidates cap the provisional overall grade at 8.5.",
        `When normalized-card printed-design centering is unavailable, camera placement is excluded, the remaining weights are redistributed, confidence is reduced by ${NORMALIZED_MISSING_CENTERING_CONFIDENCE_PENALTY}, and the provisional grade is capped at ${NORMALIZED_MISSING_CENTERING_GRADE_CAP}.`,
        "Clipping above the soft target reduces confidence and appears in Why Not 10.",
      ],
      note: "Rules are provisional_diagnostic only. They do not generate a certified/final Ten Kings grade.",
    },
    gradeImpactCandidates: preliminaryCandidates,
    whyNot10,
    story: {
      mode: "grade_story_engine_v0",
      headline,
      summary,
      strongestPositiveFinding,
      strongestWarning,
      confidenceExplanation:
        confidenceScore > 0
          ? `Confidence is ${confidenceBand(confidenceScore)} (${confidenceScore}) after applying accepted-warning and clipping reductions.`
          : "Confidence is low because gate failures prevented scoring.",
      elementSummaries: {
        centering: elementScores.centering.explanation,
        corner: elementScores.corners.explanation,
        edge: elementScores.edges.explanation,
        surface: elementScores.surface.explanation,
      },
      claims,
    },
    limitations: [
      "This is a provisional diagnostic grade only.",
      "certificationStatus=not_certified; finalGradeComputed=false; certifiedClaim=false.",
      "No label, QR certificate, or certified report is generated.",
      ...(normalizedPartialScoreReady
        ? [
            "Printed-design centering is not computed from normalized card-boundary geometry; acquisition placement margins are intentionally excluded.",
            `The provisional overall grade uses only computed corner, edge, and surface diagnostics, is confidence-penalized, and cannot exceed ${NORMALIZED_MISSING_CENTERING_GRADE_CAP} until validated printed-design centering exists.`,
          ]
        : []),
      "Surface Intelligence V0 and light-direction proxy maps are preliminary until physical light vectors and calibration gates are certified.",
    ],
  };
}
