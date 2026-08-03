import {
  isSpeedsterLearningDefectTypeV2,
  normalizeSpeedsterLearningFingerprintV2,
} from "./learning-v2";

export type SpeedsterLearningHistoryRow = {
  id: string;
  completedAt: string | Date;
  completionOrder: number;
  reviewedDefects: unknown;
};

type Counts = Record<string, number>;

export type SpeedsterLearningHistorySessionInventory = {
  sessionId: string;
  completedAt: string;
  completionOrder: number;
  findings: number;
  detectorFindings: number;
  smartMarks: number;
  usableFingerprints: number;
  missingFingerprints: number;
  invalidFingerprints: number;
};

export type SpeedsterLearningHistoryInventory = {
  readOnly: true;
  inputRows: number;
  invalidHistoryRows: number;
  completedSessions: number;
  firstCompletedAt: string | null;
  lastCompletedAt: string | null;
  findings: number;
  detectorFindings: number;
  smartMarks: number;
  usableFingerprints: number;
  missingFingerprints: number;
  invalidFingerprints: number;
  byReviewResult: Counts;
  byDefectType: Counts;
  bySourceView: Counts;
  sessions: SpeedsterLearningHistorySessionInventory[];
};

const increment = (counts: Counts, key: string) => {
  counts[key] = (counts[key] ?? 0) + 1;
};

const completedAt = (value: string | Date) => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

const cleanCounts = (counts: Counts): Counts => Object.fromEntries(
  Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
);

export function inventorySpeedsterLearningHistory(
  rows: readonly SpeedsterLearningHistoryRow[],
): SpeedsterLearningHistoryInventory {
  const validRows = rows.flatMap((row, inputOrder) => {
    const timestamp = completedAt(row.completedAt);
    return timestamp && row.id.trim() && Number.isInteger(row.completionOrder) && row.completionOrder > 0
      ? [{ row, inputOrder, timestamp }]
      : [];
  }).sort((left, right) => left.row.completionOrder - right.row.completionOrder
    || left.timestamp.localeCompare(right.timestamp)
    || left.row.id.localeCompare(right.row.id)
    || left.inputOrder - right.inputOrder);
  const inventory: SpeedsterLearningHistoryInventory = {
    readOnly: true,
    inputRows: rows.length,
    invalidHistoryRows: rows.length - validRows.length,
    completedSessions: validRows.length,
    firstCompletedAt: validRows[0]?.timestamp ?? null,
    lastCompletedAt: validRows.at(-1)?.timestamp ?? null,
    findings: 0,
    detectorFindings: 0,
    smartMarks: 0,
    usableFingerprints: 0,
    missingFingerprints: 0,
    invalidFingerprints: 0,
    byReviewResult: {},
    byDefectType: {},
    bySourceView: {},
    sessions: [],
  };

  for (const { row, timestamp } of validRows) {
    const session = {
      sessionId: row.id,
      completedAt: timestamp,
      completionOrder: row.completionOrder,
      findings: 0,
      detectorFindings: 0,
      smartMarks: 0,
      usableFingerprints: 0,
      missingFingerprints: 0,
      invalidFingerprints: 0,
    };
    const findings = Array.isArray(row.reviewedDefects) ? row.reviewedDefects : [];
    for (const raw of findings) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const finding = raw as Record<string, unknown>;
      inventory.findings += 1;
      session.findings += 1;
      if (finding.origin === "DETECTOR") {
        inventory.detectorFindings += 1;
        session.detectorFindings += 1;
      } else if (finding.origin === "SMART_MARK") {
        inventory.smartMarks += 1;
        session.smartMarks += 1;
      }
      if (typeof finding.reviewResult === "string") increment(inventory.byReviewResult, finding.reviewResult);
      if (isSpeedsterLearningDefectTypeV2(finding.defectType)) increment(inventory.byDefectType, finding.defectType);
      if (typeof finding.sourceViewId === "string" && finding.sourceViewId.trim()) {
        increment(inventory.bySourceView, finding.sourceViewId.trim());
      }
      if (finding.featureFingerprint == null) {
        inventory.missingFingerprints += 1;
        session.missingFingerprints += 1;
      } else if (normalizeSpeedsterLearningFingerprintV2(finding.featureFingerprint)) {
        inventory.usableFingerprints += 1;
        session.usableFingerprints += 1;
      } else {
        inventory.invalidFingerprints += 1;
        session.invalidFingerprints += 1;
      }
    }
    inventory.sessions.push(session);
  }
  inventory.byReviewResult = cleanCounts(inventory.byReviewResult);
  inventory.byDefectType = cleanCounts(inventory.byDefectType);
  inventory.bySourceView = cleanCounts(inventory.bySourceView);
  return inventory;
}
