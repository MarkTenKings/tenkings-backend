import { sanitizeSpeedsterUnitQuad } from "./geometry";
import type { SpeedsterCardSide, SpeedsterQuad } from "./contracts";

export const SPEEDSTER_COLOR_GEOMETRY_ENGINE_VERSION = "speedster-color-geometry-v2" as const;
export const SPEEDSTER_COLOR_GEOMETRY_LEGACY_ENGINE_VERSION = "speedster-color-geometry-v1" as const;
export const SPEEDSTER_COLOR_GEOMETRY_AUTHORITY = "PROPOSER_ONLY" as const;

export type SpeedsterColorGeometryEngineVersion =
  | typeof SPEEDSTER_COLOR_GEOMETRY_ENGINE_VERSION
  | typeof SPEEDSTER_COLOR_GEOMETRY_LEGACY_ENGINE_VERSION;
export type SpeedsterColorGeometryPolicyProvenance =
  | "OWNER_APPROVED_VISIBLE_OUTLINE_V2"
  | "OWNER_APPROVED_OFFLINE_ESTIMATE_V1_NOT_LIVE_CALIBRATED";

export type SpeedsterColorGeometryMode = "PHYSICAL_OUTER" | "PRINTED_FRAME";
export type SpeedsterColorGeometryOutcome = "ACCEPTED" | "INSUFFICIENT_EVIDENCE" | "NOT_APPLICABLE" | "ABSTAIN";
export type SpeedsterMatColor = "BLACK" | "WHITE" | "MAGENTA";
export type SpeedsterColorGeometrySideName = "top" | "right" | "bottom" | "left";
export type SpeedsterPhysicalGeometryPlacement = "AUTO_ACCEPTED" | "DIAGNOSTIC_DRAFT" | "MANUAL_EMPTY";

const SPEEDSTER_COLOR_GEOMETRY_V1_POLICY = {
  PHYSICAL_OUTER: { contrastFloorDeltaE: 18, minimumSideSupport: 0.7, ambiguityRatio: 0.92 },
  PRINTED_FRAME: { contrastFloorDeltaE: 12, minimumSideSupport: 0.55, ambiguityRatio: 0.9 },
} as const;

export type SpeedsterColorGeometrySideEvidence = Readonly<{
  medianContrastDeltaE: number;
  medianLightnessContrast?: number;
  medianChromaContrast?: number;
  supportFraction: number;
  sampleCount: number;
  candidateCount: number;
  ambiguous: boolean;
}>;

export type SpeedsterColorGeometryRejectedGate = Readonly<{
  code:
    | "SIDE_MEDIAN_CONTRAST_BELOW_FLOOR"
    | "SIDE_SUPPORT_BELOW_FLOOR"
    | "SIDE_OUTSIDE_MAT_SUPPORT_BELOW_FLOOR"
    | "SIDE_INSIDE_NON_MAT_SUPPORT_BELOW_FLOOR"
    | "DARK_EDGE_LIGHTNESS_AMBIGUOUS"
    | "FRAME_COVERAGE_BELOW_FLOOR"
    | "RUNNER_UP_AMBIGUOUS";
  side: SpeedsterColorGeometrySideName | null;
  metric:
    | "medianContrastDeltaE"
    | "supportFraction"
    | "outsideMatSupportFraction"
    | "insideNonMatSupportFraction"
    | "medianLightnessContrast"
    | "frameCoverage"
    | "runnerUpScoreRatio";
  observed: number;
  threshold: number;
  comparison: "GTE" | "LT";
}>;

export type SpeedsterColorGeometryDiagnosticCandidate = Readonly<{
  version: "speedster-color-geometry-diagnostic-candidate-v1";
  authority: "HUMAN_DRAFT_ONLY";
  quad: SpeedsterQuad;
  rank: number;
  contourScore: number;
  frameCoverage: number;
  rejectedGates: readonly SpeedsterColorGeometryRejectedGate[];
}>;

export type SpeedsterColorGeometryProposal = Readonly<{
  version: "speedster-color-geometry-proposal-v1";
  engineVersion: SpeedsterColorGeometryEngineVersion;
  authority: typeof SPEEDSTER_COLOR_GEOMETRY_AUTHORITY;
  policyProvenance: SpeedsterColorGeometryPolicyProvenance;
  mode: SpeedsterColorGeometryMode;
  outcome: SpeedsterColorGeometryOutcome;
  matColor: SpeedsterMatColor;
  proposal: SpeedsterQuad | null;
  contrastFloorDeltaE: number;
  minimumSideSupport: number;
  sideEvidence: Readonly<Record<SpeedsterColorGeometrySideName, SpeedsterColorGeometrySideEvidence>>;
  ambiguity: Readonly<{
    candidateCount: number;
    runnerUpScoreRatio: number | null;
    ambiguous: boolean;
  }>;
  advisory: Readonly<{
    code: string;
    recommendedMat: SpeedsterMatColor | null;
    message: string;
  }> | null;
  diagnosticCandidate?: SpeedsterColorGeometryDiagnosticCandidate | null;
}>;

export type SpeedsterColorGeometryCaptureEvidence = Readonly<{
  side: SpeedsterCardSide;
  sourceImageStorageKey: string;
  mode: SpeedsterColorGeometryMode;
  matColor: SpeedsterMatColor;
  result: SpeedsterColorGeometryProposal;
  serverReceipt: string;
  confirmedQuad: SpeedsterQuad;
}>;

const record = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);
const finite = (value: unknown, minimum: number, maximum: number) => (
  typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : null
);
const integer = (value: unknown, maximum: number) => (
  Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= maximum
    ? value as number
    : null
);

export function parseSpeedsterColorGeometryProposal(
  value: unknown,
  expected?: Readonly<{ mode?: SpeedsterColorGeometryMode; matColor?: SpeedsterMatColor }>,
): SpeedsterColorGeometryProposal {
  const candidate = record(value);
  const legacyIdentity = candidate?.engineVersion === SPEEDSTER_COLOR_GEOMETRY_LEGACY_ENGINE_VERSION
    && candidate.policyProvenance === "OWNER_APPROVED_OFFLINE_ESTIMATE_V1_NOT_LIVE_CALIBRATED";
  const currentIdentity = candidate?.engineVersion === SPEEDSTER_COLOR_GEOMETRY_ENGINE_VERSION
    && candidate.policyProvenance === "OWNER_APPROVED_VISIBLE_OUTLINE_V2";
  if (!candidate
    || candidate.version !== "speedster-color-geometry-proposal-v1"
    || (!legacyIdentity && !currentIdentity)
    || candidate.authority !== SPEEDSTER_COLOR_GEOMETRY_AUTHORITY
    || !["PHYSICAL_OUTER", "PRINTED_FRAME"].includes(String(candidate.mode))
    || !["ACCEPTED", "INSUFFICIENT_EVIDENCE", "NOT_APPLICABLE", "ABSTAIN"].includes(String(candidate.outcome))
    || !["BLACK", "WHITE", "MAGENTA"].includes(String(candidate.matColor))
    || (expected?.mode && candidate.mode !== expected.mode)
    || (expected?.matColor && candidate.matColor !== expected.matColor)) {
    throw new Error("Color geometry proposal identity is malformed.");
  }
  const proposal = candidate.proposal === null ? null : sanitizeSpeedsterUnitQuad(candidate.proposal);
  if ((candidate.outcome === "ACCEPTED") !== Boolean(proposal)) {
    throw new Error("Color geometry proposal/outcome authority is inconsistent.");
  }
  const contrastFloorDeltaE = finite(candidate.contrastFloorDeltaE, 0.1, 200);
  const minimumSideSupport = finite(candidate.minimumSideSupport, 0.01, 1);
  const fixedPolicy = SPEEDSTER_COLOR_GEOMETRY_V1_POLICY[candidate.mode as SpeedsterColorGeometryMode];
  const sideEvidenceValue = record(candidate.sideEvidence);
  const ambiguityValue = record(candidate.ambiguity);
  if (contrastFloorDeltaE === null || minimumSideSupport === null
    || contrastFloorDeltaE !== fixedPolicy.contrastFloorDeltaE
    || minimumSideSupport !== fixedPolicy.minimumSideSupport
    || !sideEvidenceValue || !ambiguityValue) {
    throw new Error("Color geometry evidence is malformed.");
  }
  const sideEvidence = Object.fromEntries(
    (["top", "right", "bottom", "left"] as const).map((side) => {
      const evidence = record(sideEvidenceValue[side]);
      const medianContrastDeltaE = evidence ? finite(evidence.medianContrastDeltaE, 0, 300) : null;
      const supportFraction = evidence ? finite(evidence.supportFraction, 0, 1) : null;
      const medianLightnessContrast = evidence?.medianLightnessContrast === undefined
        ? undefined
        : finite(evidence.medianLightnessContrast, 0, 300);
      const medianChromaContrast = evidence?.medianChromaContrast === undefined
        ? undefined
        : finite(evidence.medianChromaContrast, 0, 300);
      const sampleCount = evidence ? integer(evidence.sampleCount, 10_000) : null;
      const candidateCount = evidence ? integer(evidence.candidateCount, 10_000) : null;
      if (!evidence || medianContrastDeltaE === null || supportFraction === null
        || sampleCount === null || candidateCount === null || typeof evidence.ambiguous !== "boolean"
        || medianLightnessContrast === null || medianChromaContrast === null) {
        throw new Error("Color geometry four-side evidence is malformed.");
      }
      return [side, {
        medianContrastDeltaE,
        ...(medianLightnessContrast === undefined ? {} : { medianLightnessContrast }),
        ...(medianChromaContrast === undefined ? {} : { medianChromaContrast }),
        supportFraction,
        sampleCount,
        candidateCount,
        ambiguous: evidence.ambiguous,
      }];
    }),
  ) as Record<SpeedsterColorGeometrySideName, SpeedsterColorGeometrySideEvidence>;
  const ambiguityCandidateCount = integer(ambiguityValue.candidateCount, 10_000);
  const runnerUpScoreRatio = ambiguityValue.runnerUpScoreRatio === null
    ? null
    : finite(ambiguityValue.runnerUpScoreRatio, 0, 10);
  if (ambiguityCandidateCount === null || runnerUpScoreRatio === null && ambiguityValue.runnerUpScoreRatio !== null
    || typeof ambiguityValue.ambiguous !== "boolean") {
    throw new Error("Color geometry ambiguity evidence is malformed.");
  }
  const ratioImpliesAmbiguity = runnerUpScoreRatio !== null
    && runnerUpScoreRatio >= fixedPolicy.ambiguityRatio;
  if ((ambiguityCandidateCount > 1) !== (runnerUpScoreRatio !== null)
    || ambiguityValue.ambiguous !== ratioImpliesAmbiguity) {
    throw new Error("Color geometry ambiguity evidence contradicts the fixed v1 threshold.");
  }
  const advisoryValue = candidate.advisory === null ? null : record(candidate.advisory);
  if (candidate.advisory !== null && (!advisoryValue
    || typeof advisoryValue.code !== "string" || advisoryValue.code.length < 1 || advisoryValue.code.length > 80
    || typeof advisoryValue.message !== "string" || advisoryValue.message.length < 1 || advisoryValue.message.length > 300
    || advisoryValue.recommendedMat !== null
      && !["BLACK", "WHITE", "MAGENTA"].includes(String(advisoryValue.recommendedMat)))) {
    throw new Error("Color geometry advisory is malformed.");
  }
  const diagnosticValue = candidate.diagnosticCandidate === null || candidate.diagnosticCandidate === undefined
    ? null
    : record(candidate.diagnosticCandidate);
  let diagnosticCandidate: SpeedsterColorGeometryDiagnosticCandidate | null = null;
  if (diagnosticValue) {
    const quad = sanitizeSpeedsterUnitQuad(diagnosticValue.quad);
    const rank = integer(diagnosticValue.rank, 4);
    const contourScore = finite(diagnosticValue.contourScore, 0, 1e18);
    const frameCoverage = finite(diagnosticValue.frameCoverage, 0, 1);
    const gateValues = Array.isArray(diagnosticValue.rejectedGates)
      ? diagnosticValue.rejectedGates
      : null;
    const gates = gateValues?.map((value) => {
      const gate = record(value);
      const observed = gate ? finite(gate.observed, 0, 1e9) : null;
      const threshold = gate ? finite(gate.threshold, 0, 1e9) : null;
      const code = gate?.code;
      const metric = gate?.metric;
      const side = gate?.side;
      const comparison = gate?.comparison;
      const validIdentity = (
        code === "SIDE_MEDIAN_CONTRAST_BELOW_FLOOR" && metric === "medianContrastDeltaE"
        || code === "SIDE_SUPPORT_BELOW_FLOOR" && metric === "supportFraction"
        || code === "SIDE_OUTSIDE_MAT_SUPPORT_BELOW_FLOOR" && metric === "outsideMatSupportFraction"
        || code === "SIDE_INSIDE_NON_MAT_SUPPORT_BELOW_FLOOR" && metric === "insideNonMatSupportFraction"
        || code === "DARK_EDGE_LIGHTNESS_AMBIGUOUS" && metric === "medianLightnessContrast"
        || code === "FRAME_COVERAGE_BELOW_FLOOR" && metric === "frameCoverage"
        || code === "RUNNER_UP_AMBIGUOUS" && metric === "runnerUpScoreRatio"
      );
      const globalGate = code === "FRAME_COVERAGE_BELOW_FLOOR" || code === "RUNNER_UP_AMBIGUOUS";
      if (!gate || !validIdentity || observed === null || threshold === null
        || !["GTE", "LT"].includes(String(comparison))
        || (globalGate ? side !== null : !["top", "right", "bottom", "left"].includes(String(side)))) {
        return null;
      }
      return { code, metric, side, observed, threshold, comparison } as SpeedsterColorGeometryRejectedGate;
    }) ?? null;
    if (candidate.mode !== "PHYSICAL_OUTER" || candidate.outcome === "ACCEPTED"
      || diagnosticValue.version !== "speedster-color-geometry-diagnostic-candidate-v1"
      || diagnosticValue.authority !== "HUMAN_DRAFT_ONLY" || !quad || rank === null || rank < 1
      || contourScore === null || frameCoverage === null || !gates || gates.length < 1
      || gates.length > 32 || gates.some((gate) => gate === null)) {
      throw new Error("Color geometry diagnostic candidate is malformed.");
    }
    diagnosticCandidate = {
      version: "speedster-color-geometry-diagnostic-candidate-v1",
      authority: "HUMAN_DRAFT_ONLY",
      quad,
      rank,
      contourScore,
      frameCoverage,
      rejectedGates: gates as readonly SpeedsterColorGeometryRejectedGate[],
    };
  } else if (candidate.diagnosticCandidate !== null && candidate.diagnosticCandidate !== undefined) {
    throw new Error("Color geometry diagnostic candidate is malformed.");
  }
  const currentPhysicalOutline = currentIdentity && candidate.mode === "PHYSICAL_OUTER";
  const acceptedEvidenceInvalid = candidate.outcome === "ACCEPTED" && (
    ambiguityCandidateCount < 1
    || advisoryValue !== null
    || Object.values(sideEvidence).some((side) => side.sampleCount < 1 || side.candidateCount < 1)
    || !currentPhysicalOutline && (
      ambiguityValue.ambiguous
      || ratioImpliesAmbiguity
      || Object.values(sideEvidence).some((side) => (
        side.medianContrastDeltaE < fixedPolicy.contrastFloorDeltaE
        || side.supportFraction < fixedPolicy.minimumSideSupport
        || side.ambiguous
      ))
      || legacyIdentity && candidate.mode === "PHYSICAL_OUTER" && candidate.matColor === "BLACK"
        && Object.values(sideEvidence).some((side) => (
          side.medianLightnessContrast === undefined
          || side.medianLightnessContrast < 20
        ))
    )
  );
  if (acceptedEvidenceInvalid) {
    throw new Error("Accepted color geometry violates its declared engine policy.");
  }
  return {
    version: "speedster-color-geometry-proposal-v1",
    engineVersion: candidate.engineVersion as SpeedsterColorGeometryEngineVersion,
    authority: SPEEDSTER_COLOR_GEOMETRY_AUTHORITY,
    policyProvenance: candidate.policyProvenance as SpeedsterColorGeometryPolicyProvenance,
    mode: candidate.mode as SpeedsterColorGeometryMode,
    outcome: candidate.outcome as SpeedsterColorGeometryOutcome,
    matColor: candidate.matColor as SpeedsterMatColor,
    proposal,
    contrastFloorDeltaE,
    minimumSideSupport,
    sideEvidence,
    ambiguity: {
      candidateCount: ambiguityCandidateCount,
      runnerUpScoreRatio,
      ambiguous: ambiguityValue.ambiguous,
    },
    advisory: advisoryValue ? {
      code: advisoryValue.code as string,
      recommendedMat: advisoryValue.recommendedMat as SpeedsterMatColor | null,
      message: advisoryValue.message as string,
    } : null,
    ...(candidate.diagnosticCandidate === undefined ? {} : { diagnosticCandidate }),
  };
}

export function speedsterQuadsDiffer(first: SpeedsterQuad, second: SpeedsterQuad, epsilon = 1e-6) {
  return first.some((point, index) => (
    Math.abs(point.x - second[index].x) > epsilon
    || Math.abs(point.y - second[index].y) > epsilon
  ));
}

/** An accepted physical outline may seed the first editable GeometryAssist draft. */
export function speedsterColorPhysicalDraft(
  color: SpeedsterColorGeometryProposal,
  unchangedManualDraft: SpeedsterQuad,
): SpeedsterQuad {
  return color.mode === "PHYSICAL_OUTER" && color.outcome === "ACCEPTED" && color.proposal
    ? color.proposal
    : unchangedManualDraft;
}

/** Preserve provenance when selecting the first editable physical-card draft. */
export function speedsterColorPhysicalDraftState(
  color: SpeedsterColorGeometryProposal,
): Readonly<{ quad: SpeedsterQuad | null; placement: SpeedsterPhysicalGeometryPlacement }> {
  if (color.mode === "PHYSICAL_OUTER" && color.outcome === "ACCEPTED" && color.proposal) {
    return { quad: color.proposal, placement: "AUTO_ACCEPTED" };
  }
  if (color.mode === "PHYSICAL_OUTER" && color.diagnosticCandidate) {
    return { quad: color.diagnosticCandidate.quad, placement: "DIAGNOSTIC_DRAFT" };
  }
  return { quad: null, placement: "MANUAL_EMPTY" };
}

/** An accepted printed frame may seed the first editable CenteringAssist draft. */
export function speedsterColorCenteringDraft(
  color: SpeedsterColorGeometryProposal,
  unchangedManualDraft: SpeedsterQuad | null,
): SpeedsterQuad | null {
  return color.mode === "PRINTED_FRAME" && color.outcome === "ACCEPTED" && color.proposal
    ? color.proposal
    : unchangedManualDraft;
}
