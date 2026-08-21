import type {
  SpeedsterCardSide,
  SpeedsterDefectOrigin,
  SpeedsterDefectType,
  SpeedsterMemoryProposal,
  SpeedsterViewType,
} from "./contracts";
import { parseSpeedsterTraceRleV1, type SpeedsterTraceRleV1 } from "./trace-codec";

export const SPEEDSTER_DETECTOR_EVIDENCE_VERSION = "speedster-detector-evidence-v1" as const;
export const SPEEDSTER_RAW_CANDIDATE_VERSION = "speedster-raw-detector-candidate-v1" as const;
export const SPEEDSTER_MEMORY_DECISION_EVIDENCE_VERSION = "speedster-memory-decision-evidence-v1" as const;
export const SPEEDSTER_MEMORY_LESSON_SIDE_VERDICTS_VERSION =
  "speedster-memory-lesson-side-verdicts-v1" as const;
export const SPEEDSTER_MEMORY_LESSON_VERDICT_MEMORY_VERSION =
  "sam-memory-v2-lesson-verdict-v1" as const;
export const SPEEDSTER_MEMORY_LESSON_LEGACY_UNPROVEN_REASON =
  "UNPROVEN_LEGACY_NO_LESSON_VERDICT" as const;

const RAW_CANDIDATE_ID = /^raw-[a-f0-9]{24}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_RAW_CANDIDATES_PER_SIDE = 256;
const MAX_LESSON_OBSERVATIONS_PER_SIDE = 100_000;
const MAX_LESSON_CANDIDATE_REFERENCES_PER_SIDE =
  MAX_RAW_CANDIDATES_PER_SIDE * 4;
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
const USED_REASONS = new Set([
  "CLASSIFIER_GENTLE_POSITIVE_MAX",
  "CLASSIFIER_EXPLICIT_POSITIVE_MARGIN_CHECK",
  "CLASSIFIER_EXPLICIT_POSITIVE_PROTECTION",
  "CLASSIFIER_NEGATIVE_MAX",
  "SMART_MARK_PROPOSAL_RETAINED_FOR_MEASUREMENT",
]);
const REJECTED_REASONS = new Set([
  "NOT_SELECTED_AS_MAX_EXEMPLAR",
  "SELECTED_BUT_POLICY_BRANCH_INACTIVE",
  "SMART_MARK_SIMILARITY_BELOW_THRESHOLD",
  "SMART_MARK_COMPONENT_INVALID_GEOMETRY",
  "SMART_MARK_COMPONENT_IOU_DEDUP",
  "SMART_MARK_COMPONENT_TYPE_SIDE_CAP",
  "SMART_MARK_PROMPT_NO_VALID_MASK",
  "SMART_MARK_PROMPT_VETOED",
  "SMART_MARK_PROMPT_BELOW_COLLECTION_THRESHOLD",
  "SMART_MARK_PROMPT_LOWER_CONFIDENCE",
  "SMART_MARK_PROMPT_SIDE_CAP",
]);
const SKIPPED_REASONS = new Set([
  "SOURCE_VIEW_NOT_SCANNED",
  "NO_ELIGIBLE_RAW_CANDIDATE",
  "NO_ALLOWED_MATERIAL_CELLS",
  "FEATURE_MAP_UNAVAILABLE",
  "CANDIDATE_FINGERPRINT_UNAVAILABLE",
]);
const POLARITIES = new Set(["POSITIVE", "NEGATIVE"]);
const PROVENANCE = new Set([
  "DETECTOR_REMOVED",
  "DETECTOR_RELABELED_NEGATIVE",
  "DETECTOR_RELABELED_POSITIVE",
  "HUMAN_TRACE_CORRECTION_POSITIVE",
  "SMART_MARK_POSITIVE",
  "UNTOUCHED_ACCEPTED_POSITIVE",
]);
const SOURCE_VIEWS = new Set<SpeedsterViewType>([
  "ORIGINAL", "NORMALIZED", "MICRO_DEFECT", "DIRECTIONAL",
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

export type SpeedsterMemoryLessonReferenceV1 = Readonly<{
  lessonKey: string;
  sourceSessionId: string;
  sourceCompletionOrder: number;
  proposalOrder: number;
  lessonOrder: number;
  defectType: SpeedsterDefectType;
  polarity: "POSITIVE" | "NEGATIVE";
  provenance:
    | "DETECTOR_REMOVED"
    | "DETECTOR_RELABELED_NEGATIVE"
    | "DETECTOR_RELABELED_POSITIVE"
    | "HUMAN_TRACE_CORRECTION_POSITIVE"
    | "SMART_MARK_POSITIVE"
    | "UNTOUCHED_ACCEPTED_POSITIVE";
  sourceViewId: SpeedsterViewType;
}>;

export type SpeedsterMemoryLessonSideVerdictV1 = Readonly<{
  lesson: SpeedsterMemoryLessonReferenceV1;
  status: "USED" | "REJECTED" | "SKIPPED";
  reasonCode: string;
  reasonCodes: readonly string[];
  observationCount: number;
  maxSimilarity: number | null;
  candidateIds: readonly string[];
}>;

export type SpeedsterMemoryLessonSideVerdictsV1 = Readonly<{
  version: typeof SPEEDSTER_MEMORY_LESSON_SIDE_VERDICTS_VERSION;
  side: SpeedsterCardSide;
  loadedLessonCount: number;
  verdicts: readonly SpeedsterMemoryLessonSideVerdictV1[];
}>;

export type SpeedsterDetectorEvidenceV1 = Readonly<{
  version: typeof SPEEDSTER_DETECTOR_EVIDENCE_VERSION;
  rawCandidates: readonly SpeedsterRawDetectorCandidateEvidenceV1[];
  memoryDecisions: readonly SpeedsterMemoryDecisionEvidenceV1[];
  lessonVerdicts?: SpeedsterMemoryLessonSideVerdictsV1;
}>;

function memoryProposal(value: unknown): SpeedsterMemoryProposal | undefined {
  if (value === undefined) return undefined;
  if (
    !isRecord(value) || typeof value.lessonSessionId !== "string" || !value.lessonSessionId ||
    (value.lessonKey !== undefined && (
      typeof value.lessonKey !== "string" || !SHA256.test(value.lessonKey)
    )) ||
    !Number.isSafeInteger(value.lessonCompletionOrder) || Number(value.lessonCompletionOrder) < 1 ||
    !nonnegativeInteger(value.lessonProposalOrder) || !nonnegativeInteger(value.lessonOrder) ||
    typeof value.lessonSourceViewId !== "string" || !value.lessonSourceViewId ||
    !finiteUnit(value.similarity)
  ) throw new Error("Speedster raw candidate Memory proposal is malformed.");
  return value as unknown as SpeedsterMemoryProposal;
}

function lessonReference(value: unknown): SpeedsterMemoryLessonReferenceV1 {
  if (
    !isRecord(value) || typeof value.lessonKey !== "string" || !SHA256.test(value.lessonKey) ||
    typeof value.sourceSessionId !== "string" || !value.sourceSessionId.trim() ||
    !Number.isSafeInteger(value.sourceCompletionOrder) || Number(value.sourceCompletionOrder) < 1 ||
    !nonnegativeInteger(value.proposalOrder) || !nonnegativeInteger(value.lessonOrder) ||
    typeof value.defectType !== "string" || !DEFECT_TYPES.has(value.defectType as SpeedsterDefectType) ||
    typeof value.polarity !== "string" || !POLARITIES.has(value.polarity) ||
    typeof value.provenance !== "string" || !PROVENANCE.has(value.provenance) ||
    typeof value.sourceViewId !== "string" || !SOURCE_VIEWS.has(value.sourceViewId as SpeedsterViewType)
  ) throw new Error("Speedster Memory lesson reference is malformed.");
  return value as unknown as SpeedsterMemoryLessonReferenceV1;
}

function lessonSideVerdict(value: unknown): SpeedsterMemoryLessonSideVerdictV1 {
  if (!isRecord(value)) throw new Error("Speedster Memory lesson verdict is malformed.");
  const lesson = lessonReference(value.lesson);
  const reasons = value.status === "USED"
    ? USED_REASONS
    : value.status === "REJECTED"
      ? REJECTED_REASONS
      : value.status === "SKIPPED"
        ? SKIPPED_REASONS
        : null;
  if (
    !reasons || typeof value.reasonCode !== "string" || !reasons.has(value.reasonCode) ||
    !Array.isArray(value.reasonCodes) || value.reasonCodes.length < 1 ||
    value.reasonCodes.some((reason) => typeof reason !== "string" || !reasons.has(reason)) ||
    new Set(value.reasonCodes).size !== value.reasonCodes.length ||
    value.reasonCodes[0] !== value.reasonCode ||
    !Number.isSafeInteger(value.observationCount) || Number(value.observationCount) < 1 ||
    Number(value.observationCount) > MAX_LESSON_OBSERVATIONS_PER_SIDE ||
    !(value.maxSimilarity === null || finiteUnit(value.maxSimilarity)) ||
    !Array.isArray(value.candidateIds) ||
    value.candidateIds.length > MAX_RAW_CANDIDATES_PER_SIDE ||
    value.candidateIds.some((id) => typeof id !== "string" || !RAW_CANDIDATE_ID.test(id)) ||
    new Set(value.candidateIds).size !== value.candidateIds.length ||
    (value.status === "USED" && value.candidateIds.length < 1) ||
    (value.status !== "USED" && value.candidateIds.length !== 0)
  ) throw new Error("Speedster Memory lesson verdict is malformed.");
  return {
    lesson,
    status: value.status as SpeedsterMemoryLessonSideVerdictV1["status"],
    reasonCode: value.reasonCode,
    reasonCodes: value.reasonCodes as string[],
    observationCount: Number(value.observationCount),
    maxSimilarity: value.maxSimilarity as number | null,
    candidateIds: value.candidateIds as string[],
  };
}

function lessonSideVerdicts(value: unknown): SpeedsterMemoryLessonSideVerdictsV1 | undefined {
  if (value === undefined) return undefined;
  if (
    !isRecord(value) || value.version !== SPEEDSTER_MEMORY_LESSON_SIDE_VERDICTS_VERSION ||
    (value.side !== "FRONT" && value.side !== "BACK") ||
    !nonnegativeInteger(value.loadedLessonCount) || Number(value.loadedLessonCount) > 900 ||
    !Array.isArray(value.verdicts) || value.verdicts.length !== value.loadedLessonCount
  ) throw new Error("Speedster Memory lesson verdict envelope is malformed.");
  const verdicts = value.verdicts.map(lessonSideVerdict);
  if (
    new Set(verdicts.map(({ lesson }) => lesson.lessonKey)).size !== verdicts.length ||
    verdicts.reduce((count, verdict) => count + verdict.candidateIds.length, 0) >
      MAX_LESSON_CANDIDATE_REFERENCES_PER_SIDE
  ) {
    throw new Error("Speedster Memory lesson verdicts are duplicated or exceed the candidate-reference budget.");
  }
  return {
    version: SPEEDSTER_MEMORY_LESSON_SIDE_VERDICTS_VERSION,
    side: value.side,
    loadedLessonCount: Number(value.loadedLessonCount),
    verdicts,
  };
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
    !Array.isArray(value.rawCandidates) || !Array.isArray(value.memoryDecisions) ||
    value.rawCandidates.length > MAX_RAW_CANDIDATES_PER_SIDE ||
    value.memoryDecisions.length > MAX_RAW_CANDIDATES_PER_SIDE
  ) throw new Error("Speedster detector evidence envelope is malformed.");
  const rawCandidates = value.rawCandidates.map(rawCandidate);
  const memoryDecisions = value.memoryDecisions.map(memoryDecision);
  const lessonVerdicts = lessonSideVerdicts(value.lessonVerdicts);
  const rawIds = rawCandidates.map(({ candidateId }) => candidateId);
  const decisionIds = memoryDecisions.map(({ candidateId }) => candidateId);
  if (
    rawCandidates.some((candidate, index) => candidate.evidenceOrdinal !== index) ||
    new Set(rawIds).size !== rawIds.length || new Set(decisionIds).size !== decisionIds.length ||
    rawIds.length !== decisionIds.length || rawIds.some((id) => !decisionIds.includes(id))
  ) throw new Error("Every raw detector candidate requires one unique Memory disposition.");
  if (lessonVerdicts?.verdicts.some((verdict) =>
    verdict.candidateIds.some((id) => !rawIds.includes(id)))) {
    throw new Error("Speedster Memory lesson verdict references an unknown raw candidate.");
  }
  return {
    version: SPEEDSTER_DETECTOR_EVIDENCE_VERSION,
    rawCandidates,
    memoryDecisions,
    ...(lessonVerdicts ? { lessonVerdicts } : {}),
  };
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
        candidate.origin !== contributor.origin ||
        (candidate.origin === "MEMORY" && (
          !candidate.memoryProposal || !contributor.memoryProposal ||
          candidate.memoryProposal.lessonKey !== contributor.memoryProposal.lessonKey ||
          candidate.memoryProposal.lessonSessionId !== contributor.memoryProposal.lessonSessionId ||
          candidate.memoryProposal.lessonCompletionOrder !== contributor.memoryProposal.lessonCompletionOrder ||
          candidate.memoryProposal.lessonProposalOrder !== contributor.memoryProposal.lessonProposalOrder ||
          candidate.memoryProposal.lessonOrder !== contributor.memoryProposal.lessonOrder ||
          candidate.memoryProposal.lessonSourceViewId !== contributor.memoryProposal.lessonSourceViewId ||
          candidate.memoryProposal.similarity !== contributor.memoryProposal.similarity
        ))
      ) {
        throw new Error("Detector finding provenance is not bound to retained raw candidate evidence.");
      }
    }
  }
}
