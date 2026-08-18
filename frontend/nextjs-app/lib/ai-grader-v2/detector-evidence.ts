import type {
  SpeedsterDefectOrigin,
  SpeedsterDefectType,
  SpeedsterMemoryProposal,
} from "./contracts";
import { parseSpeedsterTraceRleV1, type SpeedsterTraceRleV1 } from "./trace-codec";

export const SPEEDSTER_DETECTOR_EVIDENCE_VERSION = "speedster-detector-evidence-v1" as const;
export const SPEEDSTER_RAW_CANDIDATE_VERSION = "speedster-raw-detector-candidate-v1" as const;
export const SPEEDSTER_MEMORY_DECISION_EVIDENCE_VERSION = "speedster-memory-decision-evidence-v1" as const;

const RAW_CANDIDATE_ID = /^raw-[a-f0-9]{24}$/;
const DEFECT_TYPES = new Set<SpeedsterDefectType>([
  "FAINT_COLOR_VARIATION",
  "VISIBLE_WHITENING",
  "FRAYING",
  "CHIPPING_EXPOSED_STOCK",
  "LIFTING_DEFORMATION",
  "LIGHT_SCRATCH_SCUFF",
  "VISIBLE_SCRATCH_PRINT_COATING_LOSS",
  "DENT_MATERIAL_DAMAGE",
  "PEELING_HEAVY_DAMAGE",
]);
const ORIGINS = new Set<SpeedsterDefectOrigin>(["DETECTOR", "MEMORY"]);
const POLICIES = new Set(["SAM_MEMORY_V2", "LEGACY_MEMORY_V1", "NONE"]);
const ACTIONS = new Set(["retained", "protected", "vetoed"]);
const DISPOSITIONS = new Set([
  "VETOED_BY_MEMORY",
  "SUPPRESSED_BELOW_COLLECTION_THRESHOLD",
  "NOT_SELECTED_LOWER_ADJUSTED_CONFIDENCE",
  "SUPPRESSED_BY_SIDE_MEMORY_CAP",
  "RETAINED_FOR_MEASUREMENT",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const finiteUnit = (value: unknown): value is number => finite(value) && value >= 0 && value <= 1;
const nonnegativeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;

export type SpeedsterRawDetectorCandidateEvidenceV1 = Readonly<{
  version: typeof SPEEDSTER_RAW_CANDIDATE_VERSION;
  candidateId: string;
  evidenceOrdinal: number;
  sourceViewId: string;
  promptIndex: number;
  maskIndex: number;
  promptBox: readonly [number, number, number, number];
  defectType: SpeedsterDefectType;
  origin: Exclude<SpeedsterDefectOrigin, "SMART_MARK">;
  rawConfidence: number;
  featureFingerprint: readonly number[] | null;
  canonicalMask: SpeedsterTraceRleV1;
  memoryProposal?: SpeedsterMemoryProposal;
}>;

export type SpeedsterMemoryDecisionEvidenceV1 = Readonly<{
  version: typeof SPEEDSTER_MEMORY_DECISION_EVIDENCE_VERSION;
  candidateId: string;
  policy: "SAM_MEMORY_V2" | "LEGACY_MEMORY_V1" | "NONE";
  action: "retained" | "protected" | "vetoed";
  adjustment: number;
  adjustedConfidence: number;
  collectionThreshold: 0.5;
  disposition:
    | "VETOED_BY_MEMORY"
    | "SUPPRESSED_BELOW_COLLECTION_THRESHOLD"
    | "NOT_SELECTED_LOWER_ADJUSTED_CONFIDENCE"
    | "SUPPRESSED_BY_SIDE_MEMORY_CAP"
    | "RETAINED_FOR_MEASUREMENT";
  diagnostic?: Readonly<Record<string, unknown>>;
}>;

export type SpeedsterDetectorEvidenceV1 = Readonly<{
  version: typeof SPEEDSTER_DETECTOR_EVIDENCE_VERSION;
  rawCandidates: readonly SpeedsterRawDetectorCandidateEvidenceV1[];
  memoryDecisions: readonly SpeedsterMemoryDecisionEvidenceV1[];
}>;

function memoryProposal(value: unknown): SpeedsterMemoryProposal | undefined {
  if (value === undefined) return undefined;
  if (
    !isRecord(value) || typeof value.lessonSessionId !== "string" || !value.lessonSessionId ||
    !Number.isSafeInteger(value.lessonCompletionOrder) || Number(value.lessonCompletionOrder) < 1 ||
    !nonnegativeInteger(value.lessonProposalOrder) || !nonnegativeInteger(value.lessonOrder) ||
    typeof value.lessonSourceViewId !== "string" || !value.lessonSourceViewId ||
    !finiteUnit(value.similarity)
  ) throw new Error("Speedster raw candidate Memory proposal is malformed.");
  return value as unknown as SpeedsterMemoryProposal;
}

function rawCandidate(value: unknown): SpeedsterRawDetectorCandidateEvidenceV1 {
  if (
    !isRecord(value) || value.version !== SPEEDSTER_RAW_CANDIDATE_VERSION ||
    typeof value.candidateId !== "string" || !RAW_CANDIDATE_ID.test(value.candidateId) ||
    !nonnegativeInteger(value.evidenceOrdinal) ||
    typeof value.sourceViewId !== "string" || !value.sourceViewId ||
    !nonnegativeInteger(value.promptIndex) || !nonnegativeInteger(value.maskIndex) ||
    !Array.isArray(value.promptBox) || value.promptBox.length !== 4 ||
    !value.promptBox.every(nonnegativeInteger) ||
    typeof value.defectType !== "string" || !DEFECT_TYPES.has(value.defectType as SpeedsterDefectType) ||
    typeof value.origin !== "string" || !ORIGINS.has(value.origin as SpeedsterDefectOrigin) ||
    !finiteUnit(value.rawConfidence) ||
    !(value.featureFingerprint === null || (
      Array.isArray(value.featureFingerprint) && value.featureFingerprint.length === 32 &&
      value.featureFingerprint.every(finite)
    ))
  ) throw new Error("Speedster raw detector candidate evidence is malformed.");
  const proposal = memoryProposal(value.memoryProposal);
  if ((value.origin === "MEMORY") !== Boolean(proposal)) {
    throw new Error("Speedster raw detector candidate origin and Memory proposal disagree.");
  }
  return {
    version: SPEEDSTER_RAW_CANDIDATE_VERSION,
    candidateId: value.candidateId,
    evidenceOrdinal: Number(value.evidenceOrdinal),
    sourceViewId: value.sourceViewId,
    promptIndex: Number(value.promptIndex),
    maskIndex: Number(value.maskIndex),
    promptBox: value.promptBox as [number, number, number, number],
    defectType: value.defectType as SpeedsterDefectType,
    origin: value.origin as Exclude<SpeedsterDefectOrigin, "SMART_MARK">,
    rawConfidence: value.rawConfidence,
    featureFingerprint: value.featureFingerprint as readonly number[] | null,
    canonicalMask: parseSpeedsterTraceRleV1(value.canonicalMask),
    ...(proposal ? { memoryProposal: proposal } : {}),
  };
}

function memoryDecision(value: unknown): SpeedsterMemoryDecisionEvidenceV1 {
  if (
    !isRecord(value) || value.version !== SPEEDSTER_MEMORY_DECISION_EVIDENCE_VERSION ||
    typeof value.candidateId !== "string" || !RAW_CANDIDATE_ID.test(value.candidateId) ||
    typeof value.policy !== "string" || !POLICIES.has(value.policy) ||
    typeof value.action !== "string" || !ACTIONS.has(value.action) ||
    !finite(value.adjustment) || Math.abs(value.adjustment) > 0.060001 ||
    !finiteUnit(value.adjustedConfidence) || value.collectionThreshold !== 0.5 ||
    typeof value.disposition !== "string" || !DISPOSITIONS.has(value.disposition) ||
    (value.diagnostic !== undefined && !isRecord(value.diagnostic))
  ) throw new Error("Speedster Memory decision evidence is malformed.");
  if ((value.action === "vetoed") !== (value.disposition === "VETOED_BY_MEMORY")) {
    throw new Error("Speedster Memory veto and disposition disagree.");
  }
  if (
    value.disposition === "SUPPRESSED_BELOW_COLLECTION_THRESHOLD" &&
    value.adjustedConfidence >= value.collectionThreshold
  ) throw new Error("Speedster sub-threshold disposition is inconsistent.");
  return value as unknown as SpeedsterMemoryDecisionEvidenceV1;
}

export function parseSpeedsterDetectorEvidence(value: unknown): SpeedsterDetectorEvidenceV1 {
  if (
    !isRecord(value) || value.version !== SPEEDSTER_DETECTOR_EVIDENCE_VERSION ||
    !Array.isArray(value.rawCandidates) || !Array.isArray(value.memoryDecisions)
  ) throw new Error("Speedster detector evidence envelope is malformed.");
  const rawCandidates = value.rawCandidates.map(rawCandidate);
  const memoryDecisions = value.memoryDecisions.map(memoryDecision);
  const rawIds = rawCandidates.map(({ candidateId }) => candidateId);
  const decisionIds = memoryDecisions.map(({ candidateId }) => candidateId);
  if (
    rawCandidates.some((candidate, index) => candidate.evidenceOrdinal !== index) ||
    new Set(rawIds).size !== rawIds.length || new Set(decisionIds).size !== decisionIds.length ||
    rawIds.length !== decisionIds.length || rawIds.some((id) => !decisionIds.includes(id))
  ) throw new Error("Every raw detector candidate requires one unique Memory disposition.");
  return { version: SPEEDSTER_DETECTOR_EVIDENCE_VERSION, rawCandidates, memoryDecisions };
}

export function assertSpeedsterDetectorEvidenceBindsFindings(
  evidence: SpeedsterDetectorEvidenceV1,
  findings: readonly import("./contracts").SpeedsterReviewFinding[],
): void {
  const rawById = new Map(evidence.rawCandidates.map((candidate) => [candidate.candidateId, candidate]));
  const decisionById = new Map(evidence.memoryDecisions.map((decision) => [decision.candidateId, decision]));
  for (const finding of findings) {
    if (!finding.detectorMask || !finding.findingProvenance) {
      throw new Error("Every detector finding requires exact mask and candidate provenance authority.");
    }
    for (const contributor of finding.findingProvenance.contributors) {
      const candidate = contributor.rawCandidateId
        ? rawById.get(contributor.rawCandidateId)
        : undefined;
      const decision = contributor.rawCandidateId
        ? decisionById.get(contributor.rawCandidateId)
        : undefined;
      if (
        !candidate || !decision || decision.disposition !== "RETAINED_FOR_MEASUREMENT" ||
        candidate.sourceViewId !== contributor.sourceViewId ||
        candidate.defectType !== contributor.defectType ||
        candidate.origin !== contributor.origin
      ) {
        throw new Error("Detector finding provenance is not bound to retained raw candidate evidence.");
      }
    }
  }
}
