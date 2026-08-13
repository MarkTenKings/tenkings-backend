import { createHash } from "node:crypto";
import { Prisma as PrismaRuntime } from "@prisma/client";
import { prisma, type Prisma } from "@tenkings/database";
import type { SpeedsterCardSide, SpeedsterPoint, SpeedsterQuad } from "../ai-grader-v2/contracts";
import {
  SPEEDSTER_MAP_REGISTRATION_POLICY_VERSION,
  SPEEDSTER_MAP_REGISTRATION_VERSION_V2,
  type SpeedsterMapRegistration,
  type SpeedsterMapRegistrationFailure,
} from "../ai-grader-v2/card-type-map-contracts";
import { hashSpeedsterMapStorageEvidence, speedsterPhysicalQuadHash } from "./speedsterCardTypeMaps";
import { readStorageBuffer, uploadBufferIfAbsent } from "./storage";

const SHA256 = /^[a-f0-9]{64}$/;
const TENANT_ID = () => process.env.AI_GRADER_PRODUCTION_TENANT_ID?.trim() || "ten-kings";
const MAX_LESSON_CANDIDATES = 3;
const SAFE_STORAGE_SEGMENT = /^[A-Za-z0-9_-]{1,120}$/;

type RegistrationAnchor = Readonly<{ id: string; point: SpeedsterPoint }>;
type CorrectedAnchor = Readonly<{ anchorId: string; point: SpeedsterPoint }>;
type LessonTransaction = Pick<Prisma.TransactionClient, "aiGraderV2MapRegistrationLesson">;
export type SpeedsterRegistrationLessonTransactionRunner = <T>(
  operation: (tx: LessonTransaction) => Promise<T>,
  options: { isolationLevel: Prisma.TransactionIsolationLevel },
) => Promise<T>;

type RegistrationLessonRow = Readonly<{
  id: string;
  tenantId: string;
  operatorAdminId: string;
  mapRevisionId: string;
  side: string;
  evidenceSessionId: string;
  currentInspectionKey: string;
  currentInspectionSha256: string;
  currentPhysicalQuadSha256: string;
  originalExpectedAnchors: unknown;
  automaticDiagnostics: unknown;
  humanCorrectedAnchors: unknown;
  validatedRegistration: unknown;
  algorithmVersion: string;
  policyVersion: string;
  rescueAttemptId: string;
  lessonHash: string;
  createdAt: Date;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function normalizedJson(value: unknown): unknown {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Registration lesson contains a non-finite number.");
    const normalized = Number(value.toFixed(12));
    return Object.is(normalized, -0) ? 0 : normalized;
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(normalizedJson);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalizedJson(value[key])]));
  }
  throw new Error("Registration lesson contains a non-JSON value.");
}

function canonicalJson(value: unknown) {
  return JSON.stringify(normalizedJson(value));
}

function lessonPayload(row: Omit<RegistrationLessonRow, "id" | "lessonHash">) {
  return {
    tenantId: row.tenantId,
    operatorAdminId: row.operatorAdminId,
    mapRevisionId: row.mapRevisionId,
    side: row.side,
    evidenceSessionId: row.evidenceSessionId,
    currentInspectionKey: row.currentInspectionKey,
    currentInspectionSha256: row.currentInspectionSha256,
    currentPhysicalQuadSha256: row.currentPhysicalQuadSha256,
    originalExpectedAnchors: row.originalExpectedAnchors,
    automaticDiagnostics: row.automaticDiagnostics,
    humanCorrectedAnchors: row.humanCorrectedAnchors,
    validatedRegistration: row.validatedRegistration,
    algorithmVersion: row.algorithmVersion,
    policyVersion: row.policyVersion,
    rescueAttemptId: row.rescueAttemptId,
    createdAt: row.createdAt.toISOString(),
  };
}

function lessonAttemptPayload(row: Omit<RegistrationLessonRow, "id" | "lessonHash" | "createdAt">) {
  return {
    tenantId: row.tenantId,
    operatorAdminId: row.operatorAdminId,
    mapRevisionId: row.mapRevisionId,
    side: row.side,
    evidenceSessionId: row.evidenceSessionId,
    currentInspectionKey: row.currentInspectionKey,
    currentInspectionSha256: row.currentInspectionSha256,
    currentPhysicalQuadSha256: row.currentPhysicalQuadSha256,
    originalExpectedAnchors: row.originalExpectedAnchors,
    automaticDiagnostics: row.automaticDiagnostics,
    humanCorrectedAnchors: row.humanCorrectedAnchors,
    validatedRegistration: row.validatedRegistration,
    algorithmVersion: row.algorithmVersion,
    policyVersion: row.policyVersion,
    rescueAttemptId: row.rescueAttemptId,
  };
}

export function speedsterRegistrationLessonHash(row: Omit<RegistrationLessonRow, "id" | "lessonHash">) {
  return createHash("sha256").update(canonicalJson(lessonPayload(row))).digest("hex");
}

function point(value: unknown, label: string, requireInCard = true): SpeedsterPoint {
  if (!isRecord(value) || typeof value.x !== "number" || typeof value.y !== "number"
    || !Number.isFinite(value.x) || !Number.isFinite(value.y)
    || (requireInCard && (value.x < 0 || value.x > 1 || value.y < 0 || value.y > 1))) {
    throw new Error(`${label} is invalid.`);
  }
  return { x: value.x, y: value.y };
}

function correctedAnchors(value: unknown, expected: readonly RegistrationAnchor[]): CorrectedAnchor[] {
  if (!Array.isArray(value) || value.length !== 4) throw new Error("Registration lesson corrected anchors are invalid.");
  const parsed = value.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.anchorId !== "string") {
      throw new Error(`Registration lesson corrected anchor ${index} is invalid.`);
    }
    return { anchorId: entry.anchorId, point: point(entry.point, `Registration lesson corrected anchor ${index}`) };
  });
  if (parsed.map(({ anchorId }) => anchorId).join("\0") !== expected.map(({ id }) => id).join("\0")) {
    throw new Error("Registration lesson corrected anchors do not match the immutable map.");
  }
  return parsed;
}

function originalAnchors(value: unknown, expected: readonly RegistrationAnchor[]): RegistrationAnchor[] {
  if (!Array.isArray(value) || value.length !== 4) throw new Error("Registration lesson expected anchors are invalid.");
  const parsed = value.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.id !== "string") throw new Error(`Registration lesson expected anchor ${index} is invalid.`);
    return { id: entry.id, point: point(entry.point, `Registration lesson expected anchor ${index}`) };
  });
  if (canonicalJson(parsed) !== canonicalJson(expected)) {
    throw new Error("Registration lesson expected anchors do not match the immutable map.");
  }
  return parsed;
}

export type SpeedsterRegistrationLessonCandidate = Readonly<{
  lessonId: string;
  currentInspectionKey: string;
  currentInspectionSha256: string;
  anchors: readonly RegistrationAnchor[];
  sourceHomography: readonly number[];
}>;

export type SpeedsterRegistrationLessonEvidenceSnapshot = Readonly<{
  storageKey: string;
  sha256: string;
  created: boolean;
}>;

/**
 * Freezes the current prepared image under a rescue-attempt-specific key before
 * the rescue can become lesson authority. An unattached object is quarantined
 * by that deterministic attempt key and can only be reused after hash equality.
 */
export async function ensureSpeedsterRegistrationLessonEvidenceSnapshot(input: Readonly<{
  operatorAdminId: string;
  evidenceSessionId: string;
  mapRevisionId: string;
  side: SpeedsterCardSide;
  rescueAttemptId: string;
  sourceStorageKey: string;
  expectedSha256: string;
  hashEvidence?: typeof hashSpeedsterMapStorageEvidence;
  readEvidence?: typeof readStorageBuffer;
  writeIfAbsent?: typeof uploadBufferIfAbsent;
}>): Promise<SpeedsterRegistrationLessonEvidenceSnapshot> {
  const segments = [input.operatorAdminId, input.evidenceSessionId, input.mapRevisionId, input.rescueAttemptId];
  if (segments.some((segment) => !SAFE_STORAGE_SEGMENT.test(segment)) || !SHA256.test(input.expectedSha256)) {
    throw new Error("Registration rescue immutable evidence identity is invalid.");
  }
  const storageKey = [
    "ai-grader-v2",
    input.operatorAdminId,
    input.evidenceSessionId,
    "registration-lessons",
    input.mapRevisionId,
    input.side.toLowerCase(),
    input.rescueAttemptId,
    "inspection.webp",
  ].join("/");
  const hashEvidence = input.hashEvidence ?? hashSpeedsterMapStorageEvidence;
  try {
    if (await hashEvidence(storageKey) === input.expectedSha256) {
      return { storageKey, sha256: input.expectedSha256, created: false };
    }
    throw new Error("Registration rescue immutable evidence conflicts with this attempt ID.");
  } catch (error) {
    if (error instanceof Error && error.message.includes("conflicts with this attempt ID")) throw error;
  }

  const buffer = await (input.readEvidence ?? readStorageBuffer)(input.sourceStorageKey);
  const sourceSha256 = createHash("sha256").update(buffer).digest("hex");
  if (sourceSha256 !== input.expectedSha256) {
    throw new Error("Registration rescue source evidence changed before it could be frozen.");
  }
  const written = await (input.writeIfAbsent ?? uploadBufferIfAbsent)(
    storageKey,
    buffer,
    "image/webp",
    { checksumSha256: input.expectedSha256, cacheControl: "private, immutable, max-age=31536000" },
  );
  if (await hashEvidence(storageKey) !== input.expectedSha256) {
    throw new Error("Registration rescue immutable evidence failed hash verification.");
  }
  return { storageKey, sha256: input.expectedSha256, created: written.created };
}

export async function loadVerifiedSpeedsterRegistrationLessonCandidates(input: Readonly<{
  mapRevisionId: string;
  side: SpeedsterCardSide;
  expectedAnchors: readonly RegistrationAnchor[];
  hashEvidence?: typeof hashSpeedsterMapStorageEvidence;
  findLessons?: () => Promise<readonly RegistrationLessonRow[]>;
}>): Promise<readonly SpeedsterRegistrationLessonCandidate[]> {
  const rows = input.findLessons
    ? await input.findLessons()
    : await prisma.aiGraderV2MapRegistrationLesson.findMany({
        where: { tenantId: TENANT_ID(), mapRevisionId: input.mapRevisionId, side: input.side },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: MAX_LESSON_CANDIDATES,
      }) as RegistrationLessonRow[];
  const candidates: SpeedsterRegistrationLessonCandidate[] = [];
  for (const row of rows as RegistrationLessonRow[]) {
    if (candidates.length >= MAX_LESSON_CANDIDATES) break;
    if (row.tenantId !== TENANT_ID() || row.mapRevisionId !== input.mapRevisionId || row.side !== input.side) continue;
    if (!SHA256.test(row.lessonHash) || speedsterRegistrationLessonHash(row) !== row.lessonHash) continue;
    let parsedOriginal: RegistrationAnchor[];
    let parsedCorrected: CorrectedAnchor[];
    try {
      parsedOriginal = originalAnchors(row.originalExpectedAnchors, input.expectedAnchors);
      parsedCorrected = correctedAnchors(row.humanCorrectedAnchors, input.expectedAnchors);
    } catch {
      continue;
    }
    let currentEvidenceSha256: string;
    try {
      currentEvidenceSha256 = await (input.hashEvidence ?? hashSpeedsterMapStorageEvidence)(row.currentInspectionKey);
    } catch {
      continue;
    }
    if (
      row.algorithmVersion !== SPEEDSTER_MAP_REGISTRATION_VERSION_V2
      || row.policyVersion !== SPEEDSTER_MAP_REGISTRATION_POLICY_VERSION
      || !SHA256.test(row.currentInspectionSha256)
      || currentEvidenceSha256 !== row.currentInspectionSha256
      || !isRecord(row.validatedRegistration)
      || !Array.isArray(row.validatedRegistration.homography)
      || row.validatedRegistration.homography.length !== 9
      || row.validatedRegistration.homography.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))
    ) continue;
    const registration = row.validatedRegistration;
    if (registration.version !== SPEEDSTER_MAP_REGISTRATION_VERSION_V2
      || registration.side !== row.side
      || registration.mapRevisionId !== row.mapRevisionId
      || registration.currentInspectionSha256 !== row.currentInspectionSha256
      || registration.currentPhysicalQuadSha256 !== row.currentPhysicalQuadSha256
      || !isRecord(registration.acceptance)
      || registration.acceptance.policyVersion !== SPEEDSTER_MAP_REGISTRATION_POLICY_VERSION
      || registration.acceptance.mode !== "HUMAN_CONFIRMED"
      || !isRecord(registration.candidateProvenance)
      || registration.candidateProvenance.source !== "HUMAN_CORRECTION"
      || !Array.isArray(registration.anchors)
      || registration.anchors.length !== 4) continue;
    const homography = registration.homography as number[];
    const registrationAnchors = registration.anchors as unknown[];
    const coherentAnchors = parsedOriginal.every((expected, index) => {
      const corrected = parsedCorrected[index];
      const registered = registrationAnchors[index];
      if (!isRecord(registered) || registered.anchorId !== expected.id
        || corrected.anchorId !== expected.id) return false;
      try {
        const registeredExpected = point(registered.expectedPoint, "Registration lesson expected point");
        const registeredLocated = point(registered.locatedPoint, "Registration lesson located point");
        const divisor = homography[6] * expected.point.x + homography[7] * expected.point.y + homography[8];
        if (!Number.isFinite(divisor) || Math.abs(divisor) <= 1e-12) return false;
        const projected = {
          x: (homography[0] * expected.point.x + homography[1] * expected.point.y + homography[2]) / divisor,
          y: (homography[3] * expected.point.x + homography[4] * expected.point.y + homography[5]) / divisor,
        };
        return canonicalJson(registeredExpected) === canonicalJson(expected.point)
          && canonicalJson(registeredLocated) === canonicalJson(corrected.point)
          && Math.abs(projected.x - corrected.point.x) <= 1e-6
          && Math.abs(projected.y - corrected.point.y) <= 1e-6;
      } catch {
        return false;
      }
    });
    if (!coherentAnchors) continue;
    candidates.push({
      lessonId: row.id,
      currentInspectionKey: row.currentInspectionKey,
      currentInspectionSha256: row.currentInspectionSha256,
      anchors: parsedCorrected.map((entry) => ({ id: entry.anchorId, point: entry.point })),
      sourceHomography: homography,
    });
  }
  return candidates;
}

export async function persistSpeedsterRegistrationLesson(input: Readonly<{
  operatorAdminId: string;
  mapRevisionId: string;
  side: SpeedsterCardSide;
  evidenceSessionId: string;
  currentInspectionKey: string;
  currentInspectionSha256: string;
  currentPhysicalQuad: SpeedsterQuad;
  originalExpectedAnchors: readonly RegistrationAnchor[];
  automaticDiagnostics: SpeedsterMapRegistrationFailure;
  humanCorrectedAnchors: readonly CorrectedAnchor[];
  validatedRegistration: SpeedsterMapRegistration;
  rescueAttemptId: string;
  transaction?: SpeedsterRegistrationLessonTransactionRunner;
  hashEvidence?: typeof hashSpeedsterMapStorageEvidence;
}>): Promise<{ lessonId: string; lessonHash: string; registration: SpeedsterMapRegistration }> {
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(input.rescueAttemptId)) throw new Error("Registration rescue attempt ID is invalid.");
  if (input.validatedRegistration.version !== SPEEDSTER_MAP_REGISTRATION_VERSION_V2
    || input.validatedRegistration.acceptance?.mode !== "HUMAN_CONFIRMED"
    || input.validatedRegistration.acceptance.policyVersion !== SPEEDSTER_MAP_REGISTRATION_POLICY_VERSION
    || input.validatedRegistration.candidateProvenance?.source !== "HUMAN_CORRECTION"
    || input.validatedRegistration.side !== input.side
    || input.validatedRegistration.mapRevisionId !== input.mapRevisionId) {
    throw new Error("Registration rescue result did not pass the server acceptance policy.");
  }
  const currentPhysicalQuadSha256 = speedsterPhysicalQuadHash(input.currentPhysicalQuad);
  if (input.validatedRegistration.currentInspectionSha256 !== input.currentInspectionSha256
    || input.validatedRegistration.currentPhysicalQuadSha256 !== currentPhysicalQuadSha256
    || input.originalExpectedAnchors.length !== 4
    || input.humanCorrectedAnchors.length !== 4
    || input.validatedRegistration.anchors.length !== 4) {
    throw new Error("Registration rescue result does not match its immutable evidence.");
  }
  const homography = input.validatedRegistration.homography;
  const project = (source: SpeedsterPoint) => {
    const divisor = homography[6] * source.x + homography[7] * source.y + homography[8];
    if (!Number.isFinite(divisor) || Math.abs(divisor) <= 1e-12) {
      throw new Error("Registration rescue transform is singular.");
    }
    return {
      x: (homography[0] * source.x + homography[1] * source.y + homography[2]) / divisor,
      y: (homography[3] * source.x + homography[4] * source.y + homography[5]) / divisor,
    };
  };
  const samePoint = (left: SpeedsterPoint, right: SpeedsterPoint) => (
    Number.isFinite(left.x) && Number.isFinite(left.y)
    && Math.abs(left.x - right.x) <= 1e-6
    && Math.abs(left.y - right.y) <= 1e-6
  );
  input.originalExpectedAnchors.forEach((expected, index) => {
    const corrected = input.humanCorrectedAnchors[index];
    const registered = input.validatedRegistration.anchors[index];
    if (expected.id !== corrected.anchorId
      || expected.id !== registered.anchorId
      || !samePoint(expected.point, registered.expectedPoint)
      || !samePoint(corrected.point, registered.locatedPoint)
      || !samePoint(project(expected.point), corrected.point)) {
      throw new Error("Registration rescue anchors do not match the server-validated transform.");
    }
  });
  const expectedInspectionHash = await (input.hashEvidence ?? hashSpeedsterMapStorageEvidence)(input.currentInspectionKey);
  if (expectedInspectionHash !== input.currentInspectionSha256) {
    throw new Error("Registration rescue evidence failed hash verification.");
  }
  const createdAt = new Date();
  const payload = {
    tenantId: TENANT_ID(),
    operatorAdminId: input.operatorAdminId,
    mapRevisionId: input.mapRevisionId,
    side: input.side,
    evidenceSessionId: input.evidenceSessionId,
    currentInspectionKey: input.currentInspectionKey,
    currentInspectionSha256: input.currentInspectionSha256,
    currentPhysicalQuadSha256,
    originalExpectedAnchors: normalizedJson(input.originalExpectedAnchors),
    automaticDiagnostics: normalizedJson(input.automaticDiagnostics),
    humanCorrectedAnchors: normalizedJson(input.humanCorrectedAnchors),
    validatedRegistration: normalizedJson(input.validatedRegistration),
    algorithmVersion: SPEEDSTER_MAP_REGISTRATION_VERSION_V2,
    policyVersion: SPEEDSTER_MAP_REGISTRATION_POLICY_VERSION,
    rescueAttemptId: input.rescueAttemptId,
    createdAt,
  } satisfies Omit<RegistrationLessonRow, "id" | "lessonHash">;
  const lessonHash = speedsterRegistrationLessonHash(payload);
  const runTransaction = input.transaction ?? (prisma.$transaction.bind(prisma) as SpeedsterRegistrationLessonTransactionRunner);
  const execute = () => runTransaction(async (tx) => {
    const existing = await tx.aiGraderV2MapRegistrationLesson.findUnique({
      where: { rescueAttemptId: input.rescueAttemptId },
    });
    if (existing) {
      if (
        speedsterRegistrationLessonHash(existing as RegistrationLessonRow) !== existing.lessonHash
        || canonicalJson(lessonAttemptPayload(existing as RegistrationLessonRow))
          !== canonicalJson(lessonAttemptPayload(payload))
      ) throw new Error("Registration rescue attempt conflicts with immutable lesson evidence.");
      return {
        lessonId: existing.id,
        lessonHash: existing.lessonHash,
        registration: existing.validatedRegistration as unknown as SpeedsterMapRegistration,
      };
    }
    const created = await tx.aiGraderV2MapRegistrationLesson.create({
      data: {
        ...payload,
        originalExpectedAnchors: payload.originalExpectedAnchors as Prisma.InputJsonValue,
        automaticDiagnostics: payload.automaticDiagnostics as Prisma.InputJsonValue,
        humanCorrectedAnchors: payload.humanCorrectedAnchors as Prisma.InputJsonValue,
        validatedRegistration: payload.validatedRegistration as Prisma.InputJsonValue,
        lessonHash,
      },
    });
    const persisted = await tx.aiGraderV2MapRegistrationLesson.findUnique({ where: { id: created.id } });
    if (!persisted || speedsterRegistrationLessonHash(persisted as RegistrationLessonRow) !== lessonHash) {
      throw new Error("Registration lesson hash verification failed; no rescue was applied.");
    }
    return {
      lessonId: persisted.id,
      lessonHash,
      registration: persisted.validatedRegistration as unknown as SpeedsterMapRegistration,
    };
  }, { isolationLevel: PrismaRuntime.TransactionIsolationLevel.Serializable });
  try {
    return await execute();
  } catch (error) {
    const code = String((error as { code?: unknown })?.code ?? "");
    if (code !== "P2002" && code !== "P2034") throw error;
    // A concurrent identical attempt may win the unique insert. Re-enter a new
    // serializable transaction and verify/read that immutable winner verbatim.
    return execute();
  }
}
