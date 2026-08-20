import type {
  SpeedsterConditionZone,
  SpeedsterDefectMeasurement,
  SpeedsterDefectType,
  SpeedsterMeasuredDefect,
  SpeedsterReviewFinding,
  SpeedsterReviewResult,
  SpeedsterSourceMeasuredDefect,
} from "./contracts";
import { isSpeedsterSourceMeasuredDefect } from "./contracts";
import { parseSpeedsterTraceRleV1, type SpeedsterTraceRleV1 } from "./trace-codec";

const SIDES = new Set(["FRONT", "BACK"]);
const ZONES = new Set<SpeedsterConditionZone>(["CORNERS", "EDGES", "SURFACE"]);
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
const REVIEW_RESULTS = new Set<SpeedsterReviewResult>([
  "UNREVIEWED", "ACCEPTED", "REMOVED", "SMART_MARKED", "TYPE_CORRECTED",
]);
const ORIGINS = new Set(["DETECTOR", "MEMORY", "SMART_MARK"]);
const INSTRUMENTATION_PROPOSAL_ID = /^(FRONT|BACK):\d+$/;
const RAW_CANDIDATE_ID = /^raw-[a-f0-9]{24}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const finiteNonnegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

function parseContour(value: unknown) {
  if (!Array.isArray(value) || value.length < 3) throw new Error("Speedster finding contour is malformed.");
  return value.map((entry) => {
    if (!isRecord(entry) || !finiteNonnegative(entry.x) || !finiteNonnegative(entry.y) || entry.x > 1 || entry.y > 1) {
      throw new Error("Speedster finding contour is malformed.");
    }
    return { x: entry.x, y: entry.y };
  });
}

function parseMeasurement(value: unknown): SpeedsterDefectMeasurement {
  if (!isRecord(value)) throw new Error("Speedster finding measurement is malformed.");
  const fields = [
    "widthMm", "heightMm", "areaMm2", "zonePercent", "multiplier", "weightedAreaMm2", "subgradeEffect",
  ] as const;
  if (fields.some((field) => !finiteNonnegative(value[field]))) {
    throw new Error("Speedster finding measurement is malformed.");
  }
  if (value.pixelCount !== undefined && (!Number.isSafeInteger(value.pixelCount) || Number(value.pixelCount) < 0)) {
    throw new Error("Speedster exact-region pixel count is malformed.");
  }
  return {
    ...(value.pixelCount !== undefined ? { pixelCount: Number(value.pixelCount) } : {}),
    widthMm: Number(value.widthMm),
    heightMm: Number(value.heightMm),
    areaMm2: Number(value.areaMm2),
    zonePercent: Number(value.zonePercent),
    multiplier: Number(value.multiplier),
    weightedAreaMm2: Number(value.weightedAreaMm2),
    subgradeEffect: Number(value.subgradeEffect),
  };
}

function parseCommon(value: Record<string, unknown>) {
  if (
    typeof value.id !== "string" || !value.id ||
    typeof value.side !== "string" || !SIDES.has(value.side) ||
    typeof value.defectType !== "string" || !DEFECT_TYPES.has(value.defectType as SpeedsterDefectType) ||
    typeof value.reviewResult !== "string" || !REVIEW_RESULTS.has(value.reviewResult as SpeedsterReviewResult) ||
    typeof value.sourceViewId !== "string" || !value.sourceViewId ||
    !finiteNonnegative(value.confidence) ||
    !Array.isArray(value.supportingViewIds) || value.supportingViewIds.some((entry) => typeof entry !== "string")
  ) {
    throw new Error("Speedster persisted finding is malformed.");
  }
  if (
    value.reviewResultBeforeRemoval !== undefined &&
    (value.reviewResult !== "REMOVED" ||
      typeof value.reviewResultBeforeRemoval !== "string" ||
      value.reviewResultBeforeRemoval === "REMOVED" ||
      !REVIEW_RESULTS.has(value.reviewResultBeforeRemoval as SpeedsterReviewResult))
  ) {
    throw new Error("Speedster private removal state is malformed.");
  }
  if (value.findingProvenance !== undefined) {
    const provenance = value.findingProvenance;
    if (
      !isRecord(provenance) || provenance.version !== "speedster-finding-provenance-v1" ||
      typeof provenance.primaryProposalId !== "string" ||
      !INSTRUMENTATION_PROPOSAL_ID.test(provenance.primaryProposalId) ||
      !Array.isArray(provenance.contributors) || provenance.contributors.length === 0 ||
      provenance.contributors.length > 64
    ) {
      throw new Error("Speedster finding instrumentation provenance is malformed.");
    }
    const contributorIds = new Set<string>();
    for (const contributor of provenance.contributors) {
      if (
        !isRecord(contributor) || typeof contributor.proposalId !== "string" ||
        !INSTRUMENTATION_PROPOSAL_ID.test(contributor.proposalId) ||
        (contributor.rawCandidateId !== undefined && (
          typeof contributor.rawCandidateId !== "string" || !RAW_CANDIDATE_ID.test(contributor.rawCandidateId)
        )) ||
        typeof contributor.origin !== "string" || !ORIGINS.has(contributor.origin) ||
        typeof contributor.sourceViewId !== "string" || !contributor.sourceViewId ||
        typeof contributor.defectType !== "string" || !DEFECT_TYPES.has(contributor.defectType as SpeedsterDefectType) ||
        !finiteNonnegative(contributor.confidence) || !finiteNonnegative(contributor.rankingConfidence)
      ) {
        throw new Error("Speedster finding instrumentation contributor is malformed.");
      }
      const memory = contributor.memoryProposal;
      if (contributor.origin === "MEMORY") {
        if (
          !isRecord(memory) || typeof memory.lessonSessionId !== "string" || !memory.lessonSessionId ||
          (memory.lessonKey !== undefined && (
            typeof memory.lessonKey !== "string" || !/^[a-f0-9]{64}$/.test(memory.lessonKey)
          )) ||
          !Number.isSafeInteger(memory.lessonCompletionOrder) || Number(memory.lessonCompletionOrder) < 1 ||
          !Number.isSafeInteger(memory.lessonProposalOrder) || Number(memory.lessonProposalOrder) < 0 ||
          !Number.isSafeInteger(memory.lessonOrder) || Number(memory.lessonOrder) < 0 ||
          typeof memory.lessonSourceViewId !== "string" || !memory.lessonSourceViewId ||
          !finiteNonnegative(memory.similarity)
        ) {
          throw new Error("Speedster finding instrumentation Memory contributor is malformed.");
        }
      } else if (memory !== undefined) {
        throw new Error("Only a Memory contributor can own Memory proposal provenance.");
      }
      contributorIds.add(contributor.proposalId);
    }
    if (contributorIds.size !== provenance.contributors.length) {
      throw new Error("Speedster finding instrumentation contributors are duplicated.");
    }
    if (!contributorIds.has(provenance.primaryProposalId)) {
      throw new Error("Speedster finding instrumentation primary contributor is missing.");
    }
  }
  const detectorMask = value.detectorMask === undefined
    ? undefined
    : parseSpeedsterTraceRleV1(value.detectorMask);
  return {
    ...value,
    ...(detectorMask ? { detectorMask } : {}),
  } as unknown as SpeedsterReviewFinding;
}

export function parseSpeedsterReviewFindings(value: unknown): SpeedsterReviewFinding[] {
  if (!Array.isArray(value)) throw new Error("Speedster persisted findings must be an array.");
  return value.map((entry) => {
    if (!isRecord(entry)) throw new Error("Speedster persisted finding is malformed.");
    const common = parseCommon(entry);
    if (entry.finalTrace !== undefined || entry.measurementRegions !== undefined) {
      const finalTrace = parseSpeedsterTraceRleV1(entry.finalTrace);
      if (!isRecord(entry.traceProvenance) || entry.traceProvenance.finalTraceSha256 !== finalTrace.sha256) {
        throw new Error("Speedster persisted trace provenance is malformed.");
      }
      if (
        "zone" in entry || "canonicalContour" in entry || "measurement" in entry ||
        "detectorMask" in entry ||
        !Array.isArray(entry.measurementRegions)
      ) {
        throw new Error("Speedster trace source must own only measurement-region children.");
      }
      const regions = entry.measurementRegions.map((region) => {
        if (!isRecord(region) || typeof region.zone !== "string" || !ZONES.has(region.zone as SpeedsterConditionZone)) {
          throw new Error("Speedster measurement region is malformed.");
        }
        return {
          zone: region.zone as SpeedsterConditionZone,
          canonicalContour: parseContour(region.canonicalContour),
          measurement: parseMeasurement(region.measurement),
        };
      });
      const order = regions.map(({ zone }) => zone);
      const ranks = order.map((zone) => ["CORNERS", "EDGES", "SURFACE"].indexOf(zone));
      if (new Set(order).size !== order.length || ranks.some((rank, index) => index > 0 && rank <= ranks[index - 1])) {
        throw new Error("Speedster measurement regions must be unique and canonically ordered.");
      }
      return { ...common, finalTrace, measurementRegions: regions } as SpeedsterSourceMeasuredDefect;
    }
    if (typeof entry.zone !== "string" || !ZONES.has(entry.zone as SpeedsterConditionZone)) {
      throw new Error("Speedster legacy finding zone is malformed.");
    }
    const measurement = parseMeasurement(entry.measurement);
    if (common.detectorMask) {
      const foregroundPixels = common.detectorMask.runs.reduce(
        (total, run, index) => total + (index % 2 === 1 ? run : 0),
        0,
      );
      if (measurement.pixelCount !== foregroundPixels) {
        throw new Error("Speedster detector measurement does not match its canonical mask pixels.");
      }
    }
    return {
      ...common,
      zone: entry.zone as SpeedsterConditionZone,
      canonicalContour: parseContour(entry.canonicalContour),
      measurement,
    } as SpeedsterMeasuredDefect;
  });
}

export function parsePersistedSpeedsterReviewFindings(value: unknown): SpeedsterReviewFinding[] {
  if (!Array.isArray(value)) return parseSpeedsterReviewFindings(value);
  const normalized = value.map((entry) => {
    if (
      !isRecord(entry) || entry.detectorMask === undefined ||
      (entry.finalTrace === undefined && entry.measurementRegions === undefined)
    ) {
      return entry;
    }
    const finalTrace = parseSpeedsterTraceRleV1(entry.finalTrace);
    const detectorMask = parseSpeedsterTraceRleV1(entry.detectorMask);
    if (finalTrace.sha256 !== detectorMask.sha256) {
      throw new Error("Speedster persisted trace source has conflicting detector-mask authority.");
    }
    const { detectorMask: _redundantDetectorMask, ...sourceFinding } = entry;
    return sourceFinding;
  });
  return parseSpeedsterReviewFindings(normalized);
}

export function speedsterFindingRegions(finding: SpeedsterReviewFinding) {
  return isSpeedsterSourceMeasuredDefect(finding)
    ? finding.measurementRegions
    : [{ zone: finding.zone, canonicalContour: finding.canonicalContour, measurement: finding.measurement }];
}

export function stripSpeedsterFindingPrivateFields(finding: SpeedsterReviewFinding): SpeedsterReviewFinding {
  const {
    reviewResultBeforeRemoval: _prior,
    traceSha256: _hydrationHash,
    findingProvenance: _instrumentation,
    ...safe
  } = finding as SpeedsterReviewFinding & { reviewResultBeforeRemoval?: unknown };
  return safe as SpeedsterReviewFinding;
}

export function stripSpeedsterFindingInstrumentation(
  finding: SpeedsterReviewFinding,
): SpeedsterReviewFinding {
  const { findingProvenance: _instrumentation, ...persisted } = finding;
  return persisted as SpeedsterReviewFinding;
}

export function stripSpeedsterTraceBodies(
  findings: readonly SpeedsterReviewFinding[],
): SpeedsterReviewFinding[] {
  return findings.map((finding) => {
    const safe = stripSpeedsterFindingPrivateFields(finding);
    if (!safe.finalTrace) return safe;
    const { finalTrace, ...withoutTrace } = safe;
    return { ...withoutTrace, traceSha256: finalTrace.sha256 } as SpeedsterReviewFinding;
  });
}

export function speedsterTraceHashes(findings: readonly SpeedsterReviewFinding[]) {
  return findings.flatMap((finding) => finding.finalTrace
    ? [{ findingId: finding.id, rleSha256: finding.finalTrace.sha256 }]
    : []);
}

export function findSpeedsterPersistedTrace(
  findings: readonly SpeedsterReviewFinding[],
  findingId: string,
): SpeedsterTraceRleV1 | null {
  return findings.find((finding) => finding.id === findingId)?.finalTrace ?? null;
}
