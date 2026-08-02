import type { SpeedsterDefectType, SpeedsterMeasuredDefect } from "./contracts";

export const SPEEDSTER_FINGERPRINT_SIZE = 32;

type Prototype = { count: number; sum: number[] };
type TypeBank = { positive?: Prototype; negative?: Prototype };
export type SpeedsterLearningBank = { version: 1; types: Partial<Record<SpeedsterDefectType, TypeBank>> };

const DEFECT_TYPES: readonly SpeedsterDefectType[] = [
  "FAINT_COLOR_VARIATION",
  "VISIBLE_WHITENING",
  "FRAYING",
  "CHIPPING_EXPOSED_STOCK",
  "LIFTING_DEFORMATION",
  "LIGHT_SCRATCH_SCUFF",
  "VISIBLE_SCRATCH_PRINT_COATING_LOSS",
  "DENT_MATERIAL_DAMAGE",
  "PEELING_HEAVY_DAMAGE",
];
const isDefectType = (value: unknown): value is SpeedsterDefectType =>
  typeof value === "string" && DEFECT_TYPES.includes(value as SpeedsterDefectType);

const normalizedFingerprint = (value: unknown): number[] | null => {
  if (!Array.isArray(value) || value.length !== SPEEDSTER_FINGERPRINT_SIZE) return null;
  const vector = value.map(Number);
  if (vector.some((part) => !Number.isFinite(part))) return null;
  const norm = Math.hypot(...vector);
  return norm > 0 ? vector.map((part) => part / norm) : null;
};

const cleanPrototype = (value: unknown): Prototype | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as { count?: unknown; sum?: unknown };
  const count = Number(raw.count);
  if (!Number.isInteger(count) || count < 1) return undefined;
  const sum = Array.isArray(raw.sum) ? raw.sum.map(Number) : [];
  if (sum.length !== SPEEDSTER_FINGERPRINT_SIZE || sum.some((part) => !Number.isFinite(part))) {
    return undefined;
  }
  return { count, sum };
};

export function cleanSpeedsterLearningBank(value: unknown): SpeedsterLearningBank {
  const types = value && typeof value === "object"
    ? (value as { types?: unknown }).types
    : undefined;
  const cleaned: SpeedsterLearningBank = { version: 1, types: {} };
  if (!types || typeof types !== "object") return cleaned;
  for (const defectType of DEFECT_TYPES) {
    const entry = (types as Record<string, unknown>)[defectType];
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as { positive?: unknown; negative?: unknown };
    const positive = cleanPrototype(raw.positive);
    const negative = cleanPrototype(raw.negative);
    if (positive || negative) cleaned.types[defectType] = { positive, negative };
  }
  return cleaned;
}

function add(
  bank: SpeedsterLearningBank,
  defectType: SpeedsterDefectType,
  outcome: "positive" | "negative",
  fingerprint: number[],
) {
  const typeBank = bank.types[defectType] ?? {};
  const current = typeBank[outcome] ?? {
    count: 0,
    sum: Array.from({ length: SPEEDSTER_FINGERPRINT_SIZE }, () => 0),
  };
  typeBank[outcome] = {
    count: current.count + 1,
    sum: current.sum.map((part, index) => part + fingerprint[index]),
  };
  bank.types[defectType] = typeBank;
}

export function updateSpeedsterLearningBank(
  current: unknown,
  reviewedDefects: readonly unknown[],
): SpeedsterLearningBank {
  const bank = cleanSpeedsterLearningBank(current);
  for (const raw of reviewedDefects) {
    if (!raw || typeof raw !== "object") continue;
    const defect = raw as Partial<SpeedsterMeasuredDefect>;
    if (defect.origin !== "DETECTOR") continue;
    const fingerprint = normalizedFingerprint(defect.featureFingerprint);
    if (!fingerprint || !isDefectType(defect.defectType)) continue;
    const detected = isDefectType(defect.detectedDefectType)
      ? defect.detectedDefectType
      : defect.defectType;
    if (defect.reviewResult === "REMOVED") add(bank, detected, "negative", fingerprint);
    if (defect.reviewResult === "ACCEPTED") add(bank, defect.defectType, "positive", fingerprint);
    if (defect.reviewResult === "TYPE_CORRECTED") {
      add(bank, detected, "negative", fingerprint);
      add(bank, defect.defectType, "positive", fingerprint);
    }
  }
  return bank;
}
