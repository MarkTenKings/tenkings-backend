import { sanitizeSpeedsterUnitQuad } from "./geometry";
import type { SpeedsterCardSide, SpeedsterQuad } from "./contracts";

export const SPEEDSTER_COLOR_GEOMETRY_ENGINE_VERSION = "speedster-color-geometry-v1" as const;
export const SPEEDSTER_COLOR_GEOMETRY_AUTHORITY = "PROPOSER_ONLY" as const;

export type SpeedsterColorGeometryMode = "PHYSICAL_OUTER" | "PRINTED_FRAME";
export type SpeedsterColorGeometryOutcome = "ACCEPTED" | "INSUFFICIENT_EVIDENCE" | "NOT_APPLICABLE" | "ABSTAIN";
export type SpeedsterMatColor = "BLACK" | "WHITE" | "MAGENTA";
export type SpeedsterColorGeometrySideName = "top" | "right" | "bottom" | "left";

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

export type SpeedsterColorGeometryProposal = Readonly<{
  version: "speedster-color-geometry-proposal-v1";
  engineVersion: typeof SPEEDSTER_COLOR_GEOMETRY_ENGINE_VERSION;
  authority: typeof SPEEDSTER_COLOR_GEOMETRY_AUTHORITY;
  policyProvenance: "OWNER_APPROVED_OFFLINE_ESTIMATE_V1_NOT_LIVE_CALIBRATED";
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
  if (!candidate
    || candidate.version !== "speedster-color-geometry-proposal-v1"
    || candidate.engineVersion !== SPEEDSTER_COLOR_GEOMETRY_ENGINE_VERSION
    || candidate.authority !== SPEEDSTER_COLOR_GEOMETRY_AUTHORITY
    || candidate.policyProvenance !== "OWNER_APPROVED_OFFLINE_ESTIMATE_V1_NOT_LIVE_CALIBRATED"
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
  if (candidate.outcome === "ACCEPTED" && (
    ambiguityCandidateCount < 1
    || ambiguityValue.ambiguous
    || ratioImpliesAmbiguity
    || advisoryValue !== null
    || Object.values(sideEvidence).some((side) => (
      side.sampleCount < 1
      || side.candidateCount < 1
      || side.medianContrastDeltaE < fixedPolicy.contrastFloorDeltaE
      || side.supportFraction < fixedPolicy.minimumSideSupport
      || side.ambiguous
    ))
    || candidate.mode === "PHYSICAL_OUTER" && candidate.matColor === "BLACK"
      && Object.values(sideEvidence).some((side) => (
        side.medianLightnessContrast === undefined
        || side.medianLightnessContrast < 20
      ))
  )) {
    throw new Error("Accepted color geometry violates the fixed v1 acceptance policy.");
  }
  return {
    version: "speedster-color-geometry-proposal-v1",
    engineVersion: SPEEDSTER_COLOR_GEOMETRY_ENGINE_VERSION,
    authority: SPEEDSTER_COLOR_GEOMETRY_AUTHORITY,
    policyProvenance: "OWNER_APPROVED_OFFLINE_ESTIMATE_V1_NOT_LIVE_CALIBRATED",
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

/** An accepted printed frame may seed the first editable CenteringAssist draft. */
export function speedsterColorCenteringDraft(
  color: SpeedsterColorGeometryProposal,
  unchangedManualDraft: SpeedsterQuad,
): SpeedsterQuad {
  return color.mode === "PRINTED_FRAME" && color.outcome === "ACCEPTED" && color.proposal
    ? color.proposal
    : unchangedManualDraft;
}
