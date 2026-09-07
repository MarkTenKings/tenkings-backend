import { randomUUID } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { prisma, type Prisma } from "@tenkings/database";
import { z } from "zod";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import {
  parsePersistedSpeedsterReviewFindings,
  stripSpeedsterTraceBodies,
} from "../../../../../lib/ai-grader-v2/review-findings";
import {
  SPEEDSTER_MAP_FILTER_POLICY_VERSION,
  SPEEDSTER_MAP_FILTER_POLICY_VERSION_V2,
  type SpeedsterMapFilterPolicyVersion,
} from "../../../../../lib/ai-grader-v2/card-type-map-contracts";
import {
  SpeedsterMapIntegrityError,
  hashSpeedsterMapStorageEvidence,
  loadEffectiveActiveSpeedsterMapRevision,
  parseSpeedsterMapSourceSession,
  parseSpeedsterMapRegistration,
  speedsterPhysicalQuadHash,
  type SpeedsterAppliedMapRevision,
  type SpeedsterMapSourceSession,
} from "../../../../../lib/server/speedsterCardTypeMaps";
import {
  insertSpeedsterInstrumentationEvents,
  speedsterCardMapApplicationEvent,
  type SpeedsterInstrumentationEvent,
} from "../../../../../lib/server/aiGraderV2Instrumentation";
import { verifySpeedsterMapRegistrationReceipt } from "../../../../../lib/server/speedsterMapRegistrationAuthority";
import {
  verifySpeedsterRegistrationLessonCaptureAuthority,
  verifySpeedsterRegistrationLessonReferenceAuthority,
} from "../../../../../lib/server/speedsterMapRegistrationLessons";
import {
  parseSpeedsterColorGeometryProposal,
  speedsterQuadsDiffer,
  type SpeedsterColorGeometryEngineVersion,
  type SpeedsterColorGeometryMode,
  type SpeedsterColorGeometryPolicyProvenance,
} from "../../../../../lib/ai-grader-v2/color-geometry";
import { sanitizeSpeedsterUnitQuad } from "../../../../../lib/ai-grader-v2/geometry";
import {
  SpeedsterColorGeometryReceiptExpiredError,
  verifySpeedsterColorGeometryReceipt,
} from "../../../../../lib/server/speedsterColorGeometryAuthority";
import {
  verifySpeedsterPhysicalGeometryLearningCapture,
  type SpeedsterPhysicalGeometryLessonRow,
} from "../../../../../lib/server/speedsterPhysicalGeometryLessons";
import {
  appendSpeedsterMapAuthorityEvidence,
  speedsterMapAuthorityEvidenceFromCapture,
  type SpeedsterMapAuthorityEvent,
} from "../../../../../lib/ai-grader-v2/map-authority";

const jsonObject = z.record(z.string(), z.unknown());
const patchSchema = z
  .object({
    workflowState: z.literal("CAPTURED"),
    capture: jsonObject.refine((value) => Object.keys(value).length > 0),
    mapBinding: z.object({
      revisionId: z.string().trim().min(1).max(80),
      filterPolicyVersion: z.union([
        z.literal(SPEEDSTER_MAP_FILTER_POLICY_VERSION),
        z.literal(SPEEDSTER_MAP_FILTER_POLICY_VERSION_V2),
      ]),
      registration: z.object({ front: jsonObject, back: jsonObject }).strict(),
    }).strict().optional(),
  })
  .strict();

type PersistedSession = {
  publicReportSlug?: string | null;
  workflowState?: string;
  reviewedDefects?: unknown;
  updatedAt?: Date;
  [key: string]: unknown;
};

type UpdateSessionData = {
  workflowState: "CAPTURED";
  capture: Prisma.InputJsonValue;
  mapRevisionId?: string;
  mapFilterPolicyVersion?: SpeedsterMapFilterPolicyVersion;
  mapRegistration?: Prisma.InputJsonValue;
};

type ColorGeometryEvidenceRow = Readonly<{
  sessionId: string;
  createdByUserId: string;
  side: "FRONT" | "BACK";
  mode: SpeedsterColorGeometryMode;
  matColor: "BLACK" | "WHITE" | "MAGENTA";
  outcome: "ACCEPTED" | "INSUFFICIENT_EVIDENCE" | "NOT_APPLICABLE" | "ABSTAIN";
  engineVersion: SpeedsterColorGeometryEngineVersion;
  policyProvenance: SpeedsterColorGeometryPolicyProvenance;
  sourceImageStorageKey: string;
  sourceImageSha256: string;
  proposal?: Prisma.InputJsonValue;
  confirmedQuad: Prisma.InputJsonValue;
  diagnostics: Prisma.InputJsonValue;
  proposalChanged: boolean | null;
}>;

export class SpeedsterColorGeometryCaptureReceiptExpiredError extends SpeedsterMapIntegrityError {
  constructor(
    readonly side: "FRONT" | "BACK",
    readonly mode: SpeedsterColorGeometryMode,
  ) {
    super(
      `${side} ${mode} color geometry receipt expired. Every completed sibling and nonexpired mode remains preserved. Explicitly rerun and reconfirm only ${side} ${mode}.`,
    );
    this.name = "SpeedsterColorGeometryCaptureReceiptExpiredError";
  }
}

export type MapBindingInput = NonNullable<z.output<typeof patchSchema>["mapBinding"]>;

type MapBindingValidationResult = Pick<
  UpdateSessionData,
  "mapRevisionId" | "mapFilterPolicyVersion" | "mapRegistration"
> & Readonly<{
  appliedMap?: SpeedsterAppliedMapRevision | null;
  selectedMap?: SpeedsterAppliedMapRevision | null;
  mapFailureCode?: "MAP_LOOKUP_INTEGRITY_FAILED" | "MAP_REGISTRATION_NOT_APPLIED" | "MAP_AUTHORITY_HUMAN_REVIEW" | null;
}>;

type MapBindingValidationDependencies = Readonly<{
  loadActiveMap: typeof loadEffectiveActiveSpeedsterMapRevision;
  hashEvidence: typeof hashSpeedsterMapStorageEvidence;
  verifyReceipt?: typeof verifySpeedsterMapRegistrationReceipt;
  verifyHumanLesson?: typeof verifySpeedsterRegistrationLessonCaptureAuthority;
  verifyReferenceLesson?: typeof verifySpeedsterRegistrationLessonReferenceAuthority;
}>;

const mapBindingValidationDependencies: MapBindingValidationDependencies = {
  loadActiveMap: loadEffectiveActiveSpeedsterMapRevision,
  hashEvidence: hashSpeedsterMapStorageEvidence,
  verifyReceipt: verifySpeedsterMapRegistrationReceipt,
  verifyHumanLesson: verifySpeedsterRegistrationLessonCaptureAuthority,
  verifyReferenceLesson: verifySpeedsterRegistrationLessonReferenceAuthority,
};

export async function validateSpeedsterSubmittedMapBinding(
  session: PersistedSession,
  binding: MapBindingInput | undefined,
  capture: Record<string, unknown>,
  deps: MapBindingValidationDependencies = mapBindingValidationDependencies,
): Promise<MapBindingValidationResult> {
  if (
    typeof session.id !== "string" ||
    typeof session.createdByUserId !== "string" ||
    typeof session.workflowState !== "string" ||
    (session.cardProfile !== "SPORTS" && session.cardProfile !== "POKEMON") ||
    !session.identity
  ) {
    throw new SpeedsterMapIntegrityError("Speedster map binding source identity is unavailable.");
  }
  const source = parseSpeedsterMapSourceSession({
    id: session.id,
    createdByUserId: session.createdByUserId,
    workflowState: session.workflowState,
    cardProfile: session.cardProfile,
    identity: session.identity,
    capture,
  });
  const authority = speedsterMapAuthorityEvidenceFromCapture(session.capture)?.current;
  if (authority?.status === "HUMAN_REVIEW_WITHOUT_MAP") {
    if (binding) {
      throw new SpeedsterMapIntegrityError(
        "This capture explicitly continued without a Card Map, but a map binding was submitted.",
      );
    }
    return {
      appliedMap: null,
      selectedMap: null,
      mapFailureCode: "MAP_AUTHORITY_HUMAN_REVIEW",
    };
  }
  let selectedMap: SpeedsterAppliedMapRevision | null;
  try {
    selectedMap = await deps.loadActiveMap({ cardProfile: source.cardProfile, identity: source.identity });
  } catch (error) {
    throw error;
  }
  if (!selectedMap) {
    if (binding) {
      throw new SpeedsterMapIntegrityError("Speedster map binding was submitted without an active revision.");
    }
    return { appliedMap: null, selectedMap: null };
  }
  if (!binding) {
    throw new SpeedsterMapIntegrityError(
      "An eligible Card Map exists, but validated Front + Back registration was not submitted. Retry registration or explicitly record human review without the map.",
    );
  }
  const revision = selectedMap.revision;
  if (revision.revisionId !== binding.revisionId) {
    throw new SpeedsterMapIntegrityError("Speedster map binding does not match the active revision.");
  }
  const revisionFilterPolicyVersion = revision.filterPolicyVersion
    ?? SPEEDSTER_MAP_FILTER_POLICY_VERSION;
  if (revisionFilterPolicyVersion !== binding.filterPolicyVersion) {
    throw new SpeedsterMapIntegrityError("Speedster map binding does not match the active filter policy.");
  }
  if (revisionFilterPolicyVersion === SPEEDSTER_MAP_FILTER_POLICY_VERSION_V2
    && (!revision.frontMap?.zones || !revision.backMap?.zones)) {
    throw new SpeedsterMapIntegrityError("Speedster v2 map binding is missing immutable zone authority.");
  }
  const parseAuthorized = async (raw: Record<string, unknown>, side: "FRONT" | "BACK") => {
    const receipt = typeof raw.serverReceipt === "string" ? raw.serverReceipt : "";
    const { serverReceipt: _serverReceipt, ...unsigned } = raw;
    const mapSide = side === "FRONT" ? revision.frontMap : revision.backMap;
    const parsed = parseSpeedsterMapRegistration(unsigned, {
      side,
      mapRevisionId: revision.revisionId,
      zones: mapSide?.zones,
      anchors: mapSide?.anchors,
      designBoundary: mapSide?.designBoundary,
    });
    const verifyReceipt = deps.verifyReceipt ?? mapBindingValidationDependencies.verifyReceipt;
    const verifyHumanLesson = deps.verifyHumanLesson ?? mapBindingValidationDependencies.verifyHumanLesson;
    const verifyReferenceLesson = deps.verifyReferenceLesson ?? mapBindingValidationDependencies.verifyReferenceLesson;
    if (!receipt || !verifyReceipt) {
      throw new SpeedsterMapIntegrityError("Submitted map registration lacks server authority.");
    }
    try {
      verifyReceipt({
        receipt,
        operatorAdminId: session.createdByUserId as string,
        sessionId: session.id as string,
        registration: parsed,
      });
    } catch {
      throw new SpeedsterMapIntegrityError("Submitted map registration server authority is invalid.");
    }
    if (parsed.version === "opencv-redundant-ransac-registration-v2") {
      if (parsed.candidateProvenance?.source === "HUMAN_CORRECTION") {
        const lessonId = parsed.candidateProvenance.lessonId;
        if (!lessonId || lessonId !== parsed.candidateProvenance.candidateId || !verifyHumanLesson) {
          throw new SpeedsterMapIntegrityError("Human registration lacks immutable lesson authority.");
        }
        try {
          await verifyHumanLesson({
            lessonId,
            mapRevisionId: revision.revisionId,
            side,
            currentInspectionSha256: parsed.currentInspectionSha256,
            currentPhysicalQuadSha256: parsed.currentPhysicalQuadSha256,
            registration: parsed,
            hashEvidence: deps.hashEvidence,
          });
        } catch {
          throw new SpeedsterMapIntegrityError("Human registration immutable lesson authority is invalid.");
        }
      }
      if (parsed.candidateProvenance?.source === "REGISTRATION_LESSON") {
        const lessonId = parsed.candidateProvenance.lessonId;
        if (!lessonId || lessonId !== parsed.candidateProvenance.candidateId
          || !mapSide?.anchors || !verifyReferenceLesson) {
          throw new SpeedsterMapIntegrityError("Automatic lesson registration lacks immutable lesson authority.");
        }
        try {
          await verifyReferenceLesson({
            lessonId,
            mapRevisionId: revision.revisionId,
            side,
            expectedAnchors: mapSide.anchors.map(({ id, point }) => ({ id, point })),
            hashEvidence: deps.hashEvidence,
          });
        } catch {
          throw new SpeedsterMapIntegrityError("Automatic lesson registration immutable authority is invalid.");
        }
      }
    }
    return parsed;
  };
  const front = await parseAuthorized(binding.registration.front, "FRONT");
  const back = await parseAuthorized(binding.registration.back, "BACK");
  if (
    front.currentPhysicalQuadSha256 !== speedsterPhysicalQuadHash(source.front.sourceCorners) ||
    back.currentPhysicalQuadSha256 !== speedsterPhysicalQuadHash(source.back.sourceCorners)
  ) {
    throw new SpeedsterMapIntegrityError("Speedster map registration does not match the submitted physical geometry.");
  }
  const [frontInspectionSha256, backInspectionSha256] = await Promise.all([
    deps.hashEvidence(source.front.inspectionStorageKey),
    deps.hashEvidence(source.back.inspectionStorageKey),
  ]);
  if (
    front.currentInspectionSha256 !== frontInspectionSha256 ||
    back.currentInspectionSha256 !== backInspectionSha256
  ) {
    throw new SpeedsterMapIntegrityError("Speedster map registration does not match the submitted inspection evidence.");
  }
  return {
    mapRevisionId: revision.revisionId,
    mapFilterPolicyVersion: revisionFilterPolicyVersion,
    mapRegistration: { front, back } as unknown as Prisma.InputJsonValue,
    appliedMap: selectedMap,
    selectedMap,
    mapFailureCode: null,
  };
}

type Dependencies = {
  requireAdminSession: (req: NextApiRequest) => Promise<{ user: { id: string } }>;
  findSession: (id: string, createdByUserId: string) => Promise<PersistedSession | null>;
  updateSession: (
    id: string,
    createdByUserId: string,
    data: UpdateSessionData,
    colorGeometryEvidence: readonly ColorGeometryEvidenceRow[],
    expectedUpdatedAt: Date | undefined,
  ) => Promise<PersistedSession | null>;
  hashEvidence?: typeof hashSpeedsterMapStorageEvidence;
  verifyColorGeometryReceipt?: typeof verifySpeedsterColorGeometryReceipt;
  validateMapBinding?: (session: PersistedSession, binding: MapBindingInput | undefined, capture: Record<string, unknown>) => Promise<Pick<
    UpdateSessionData,
    "mapRevisionId" | "mapFilterPolicyVersion" | "mapRegistration"
  > & Readonly<{
    appliedMap?: SpeedsterAppliedMapRevision | null;
    selectedMap?: SpeedsterAppliedMapRevision | null;
    mapFailureCode?: "MAP_LOOKUP_INTEGRITY_FAILED" | "MAP_REGISTRATION_NOT_APPLIED" | "MAP_AUTHORITY_HUMAN_REVIEW" | null;
  }>>;
  loadPhysicalLearningEvent?: (eventKey: string) => Promise<Readonly<{
    eventKey: string;
    sessionId: string;
    createdByUserId: string;
    category: string;
    eventType: string;
    details: unknown;
  }> | null>;
  loadPhysicalLearningEvidence?: (evidenceId: string) => Promise<(SpeedsterPhysicalGeometryLessonRow & Readonly<{
    createdByUserId: string;
    workflowState: string;
  }>) | null>;
  recordInstrumentation?: (events: readonly SpeedsterInstrumentationEvent[]) => Promise<unknown>;
};

const dependencies: Dependencies = {
  requireAdminSession,
  findSession: (id, createdByUserId) => prisma.aiGraderV2Session.findFirst({ where: { id, createdByUserId } }),
  updateSession: (id, createdByUserId, data, colorGeometryEvidence, expectedUpdatedAt) => prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    if (!(expectedUpdatedAt instanceof Date)) {
      throw new Error("Speedster draft revision evidence is unavailable; capture was not changed.");
    }
    const updated = await tx.aiGraderV2Session.updateMany({
      where: { id, createdByUserId, workflowState: "DRAFT", updatedAt: expectedUpdatedAt },
      data,
    });
    if (updated.count !== 1) return null;
    await tx.aiGraderV2ColorGeometryEvidence.createMany({ data: [...colorGeometryEvidence] });
    return tx.aiGraderV2Session.findFirst({ where: { id, createdByUserId } });
  }),
  hashEvidence: hashSpeedsterMapStorageEvidence,
  verifyColorGeometryReceipt: verifySpeedsterColorGeometryReceipt,
  validateMapBinding: validateSpeedsterSubmittedMapBinding,
  loadPhysicalLearningEvent: (eventKey) => prisma.aiGraderV2InstrumentationEvent.findUnique({
    where: { eventKey },
    select: {
      eventKey: true,
      sessionId: true,
      createdByUserId: true,
      category: true,
      eventType: true,
      details: true,
    },
  }),
  loadPhysicalLearningEvidence: async (evidenceId) => {
    const evidence = await prisma.aiGraderV2ColorGeometryEvidence.findUnique({
      where: { id: evidenceId },
      select: {
        id: true,
        sessionId: true,
        createdByUserId: true,
        side: true,
        mode: true,
        matColor: true,
        outcome: true,
        engineVersion: true,
        policyProvenance: true,
        sourceImageSha256: true,
        proposal: true,
        confirmedQuad: true,
        proposalChanged: true,
        createdAt: true,
        session: {
          select: {
            workflowState: true,
            mapRevisionId: true,
            mapRevision: { select: { mapId: true } },
          },
        },
      },
    });
    const mapRevisionId = evidence?.session.mapRevisionId;
    const mapId = evidence?.session.mapRevision?.mapId;
    if (!evidence || !mapRevisionId || !mapId) return null;
    const { session, ...row } = evidence;
    return {
      ...row,
      mapId,
      mapRevisionId,
      workflowState: session.workflowState,
    };
  },
  recordInstrumentation: (events) => insertSpeedsterInstrumentationEvents(prisma, events),
};

const sessionIdFrom = (req: NextApiRequest) => {
  const value = Array.isArray(req.query.sessionId) ? req.query.sessionId[0] : req.query.sessionId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

function safeSessionResponse(session: PersistedSession): PersistedSession {
  if (session.reviewedDefects === undefined) return session;
  return {
    ...session,
    reviewedDefects: stripSpeedsterTraceBodies(
      parsePersistedSpeedsterReviewFindings(session.reviewedDefects),
    ),
  };
}

function canonicalSpeedsterCapture(
  source: SpeedsterMapSourceSession,
  priorCapture: unknown,
  finalAuthority: SpeedsterMapAuthorityEvent,
): Prisma.InputJsonValue {
  const side = (value: SpeedsterMapSourceSession["front"]) => ({
    originalStorageKey: value.originalStorageKey,
    rectifiedStorageKey: value.rectifiedStorageKey,
    inspectionStorageKey: value.inspectionStorageKey,
    sourceCorners: value.sourceCorners,
    centeringQuad: value.centeringQuad,
    centeringBorders: value.centeringBorders,
    inspectionFrame: value.inspectionFrame,
    transform: value.transform,
    viewStorageKeys: value.viewStorageKeys,
  });
  const authorityCapture = appendSpeedsterMapAuthorityEvidence(priorCapture, finalAuthority);
  return {
    cornerShape: source.cornerShape,
    front: side(source.front),
    back: side(source.back),
    mapAuthority: authorityCapture.mapAuthority,
  } as Prisma.InputJsonValue;
}

function exactSubmittedQuad(value: unknown, expected: unknown, label: string) {
  const quad = sanitizeSpeedsterUnitQuad(value);
  const expectedQuad = sanitizeSpeedsterUnitQuad(expected);
  if (!quad || !expectedQuad || JSON.stringify(quad) !== JSON.stringify(value)
    || JSON.stringify(quad) !== JSON.stringify(expectedQuad)) {
    throw new SpeedsterMapIntegrityError(`${label} does not match the exact human-confirmed capture geometry.`);
  }
  return quad;
}

export async function parseSpeedsterColorGeometryCaptureRows(input: Readonly<{
  sessionId: string;
  createdByUserId: string;
  rawCapture: Record<string, unknown>;
  source: SpeedsterMapSourceSession;
  hashEvidence: typeof hashSpeedsterMapStorageEvidence;
  verifyReceipt: typeof verifySpeedsterColorGeometryReceipt;
  finalMapRevisionId?: string | null;
  loadPhysicalLearningEvent?: NonNullable<Dependencies["loadPhysicalLearningEvent"]>;
  loadPhysicalLearningEvidence?: NonNullable<Dependencies["loadPhysicalLearningEvidence"]>;
}>): Promise<readonly ColorGeometryEvidenceRow[]> {
  const rows: ColorGeometryEvidenceRow[] = [];
  for (const side of ["FRONT", "BACK"] as const) {
    const sourceSide = side === "FRONT" ? input.source.front : input.source.back;
    const rawSide = input.rawCapture[side.toLowerCase()];
    if (!rawSide || typeof rawSide !== "object" || Array.isArray(rawSide)) {
      throw new SpeedsterMapIntegrityError(`${side} color geometry evidence is missing.`);
    }
    const evidence = (rawSide as Record<string, unknown>).colorGeometryEvidence;
    if (!Array.isArray(evidence) || evidence.length !== 2) {
      throw new SpeedsterMapIntegrityError(`${side} must preserve both color geometry outcomes.`);
    }
    const sourceImageSha256 = await input.hashEvidence(sourceSide.originalStorageKey);
    for (const mode of ["PHYSICAL_OUTER", "PRINTED_FRAME"] as const) {
      const matching = evidence.filter((entry) => (
        entry && typeof entry === "object" && !Array.isArray(entry)
        && (entry as Record<string, unknown>).mode === mode
      ));
      if (matching.length !== 1) {
        throw new SpeedsterMapIntegrityError(`${side} ${mode} evidence must occur exactly once.`);
      }
      const submitted = matching[0] as Record<string, unknown>;
      if (submitted.side !== side
        || submitted.sourceImageStorageKey !== sourceSide.originalStorageKey
        || !["BLACK", "WHITE", "MAGENTA"].includes(String(submitted.matColor))) {
        throw new SpeedsterMapIntegrityError(`${side} ${mode} source-image/mat binding is invalid.`);
      }
      let result: ReturnType<typeof parseSpeedsterColorGeometryProposal>;
      try {
        result = parseSpeedsterColorGeometryProposal(submitted.result, {
          mode,
          matColor: submitted.matColor as "BLACK" | "WHITE" | "MAGENTA",
        });
      } catch {
        throw new SpeedsterMapIntegrityError(`${side} ${mode} server proposal authority is invalid.`);
      }
      const serverReceipt = typeof submitted.serverReceipt === "string" ? submitted.serverReceipt : "";
      if (!serverReceipt) {
        throw new SpeedsterMapIntegrityError(`${side} ${mode} lacks server proposal authority.`);
      }
      try {
        input.verifyReceipt(serverReceipt, {
          operatorAdminId: input.createdByUserId,
          sessionId: input.sessionId,
          side,
          mode,
          sourceImageStorageKey: sourceSide.originalStorageKey,
          sourceImageSha256,
          matColor: result.matColor,
          physicalQuadSha256: mode === "PRINTED_FRAME"
            ? speedsterPhysicalQuadHash(sourceSide.sourceCorners)
            : null,
          result,
        });
      } catch (error) {
        if (error instanceof SpeedsterColorGeometryReceiptExpiredError) {
          throw new SpeedsterColorGeometryCaptureReceiptExpiredError(side, mode);
        }
        throw new SpeedsterMapIntegrityError(`${side} ${mode} server proposal authority is invalid.`);
      }
      const expectedConfirmed = mode === "PHYSICAL_OUTER"
        ? sourceSide.sourceCorners
        : sourceSide.centeringQuad;
      const confirmedQuad = exactSubmittedQuad(
        submitted.confirmedQuad,
        expectedConfirmed,
        `${side} ${mode}`,
      );
      if (mode === "PRINTED_FRAME" && submitted.physicalGeometryLearning !== undefined) {
        throw new SpeedsterMapIntegrityError(`${side} printed geometry cannot claim physical-outline learning.`);
      }
      let learningDiagnostics: Awaited<ReturnType<typeof verifySpeedsterPhysicalGeometryLearningCapture>> | undefined;
      if (mode === "PHYSICAL_OUTER" && submitted.physicalGeometryLearning !== undefined) {
        if (!input.loadPhysicalLearningEvent || !input.loadPhysicalLearningEvidence) {
          throw new SpeedsterMapIntegrityError(`${side} physical geometry learning authority is unavailable.`);
        }
        try {
          learningDiagnostics = await verifySpeedsterPhysicalGeometryLearningCapture({
            learning: submitted.physicalGeometryLearning,
            targetSessionId: input.sessionId,
            createdByUserId: input.createdByUserId,
            side,
            finalMapRevisionId: input.finalMapRevisionId ?? null,
            sourceImageSha256,
            currentProposal: result,
            confirmedQuad,
            loadEvent: input.loadPhysicalLearningEvent,
            loadEvidence: input.loadPhysicalLearningEvidence,
          });
        } catch {
          throw new SpeedsterMapIntegrityError(`${side} physical geometry learning authority is invalid.`);
        }
      }
      rows.push({
        sessionId: input.sessionId,
        createdByUserId: input.createdByUserId,
        side,
        mode,
        matColor: result.matColor,
        outcome: result.outcome,
        engineVersion: result.engineVersion,
        policyProvenance: result.policyProvenance,
        sourceImageStorageKey: sourceSide.originalStorageKey,
        sourceImageSha256,
        ...(result.proposal ? { proposal: result.proposal as unknown as Prisma.InputJsonValue } : {}),
        confirmedQuad: confirmedQuad as unknown as Prisma.InputJsonValue,
        diagnostics: {
          contrastFloorDeltaE: result.contrastFloorDeltaE,
          minimumSideSupport: result.minimumSideSupport,
          sideEvidence: result.sideEvidence,
          ambiguity: result.ambiguity,
          advisory: result.advisory,
          ...(learningDiagnostics ? { learning: learningDiagnostics } : {}),
        } as unknown as Prisma.InputJsonValue,
        proposalChanged: result.proposal ? speedsterQuadsDiffer(result.proposal, confirmedQuad) : null,
      });
    }
  }
  return rows;
}

export function createAiGraderV2SessionHandler(deps: Dependencies = dependencies) {
  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "GET" && req.method !== "PATCH") {
      res.setHeader("Allow", "GET, PATCH");
      return res.status(405).json({ message: "Method not allowed" });
    }

    try {
      const admin = await deps.requireAdminSession(req);
      const sessionId = sessionIdFrom(req);
      if (!sessionId) return res.status(400).json({ message: "Session ID is required" });

      const existing = await deps.findSession(sessionId, admin.user.id);
      if (!existing) return res.status(404).json({ message: "Speedster session not found" });

      if (req.method === "GET") {
        return res.status(200).json({ session: safeSessionResponse(existing) });
      }

      const parsed = patchSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid Speedster session update" });
      }
      if (existing.workflowState !== "DRAFT") {
        return res.status(409).json({ message: "Only a DRAFT Speedster session can save its capture" });
      }
      const canonicalSource = parseSpeedsterMapSourceSession({
        id: existing.id as string,
        createdByUserId: existing.createdByUserId as string,
        workflowState: existing.workflowState,
        cardProfile: existing.cardProfile as string,
        identity: existing.identity,
        capture: parsed.data.capture,
      });
      const hashEvidence = deps.hashEvidence ?? hashSpeedsterMapStorageEvidence;
      const verifyColorGeometryReceipt = deps.verifyColorGeometryReceipt ?? verifySpeedsterColorGeometryReceipt;
      const validatedMapBinding = await deps.validateMapBinding?.(existing, parsed.data.mapBinding, parsed.data.capture);
      if (!validatedMapBinding) {
        throw new Error("Speedster map binding validation is unavailable.");
      }
      const {
        appliedMap = null,
        selectedMap = appliedMap,
        mapFailureCode = null,
        ...mapBinding
      } = validatedMapBinding;
      const colorGeometryEvidence = await parseSpeedsterColorGeometryCaptureRows({
        sessionId,
        createdByUserId: admin.user.id,
        rawCapture: parsed.data.capture,
        source: canonicalSource,
        hashEvidence,
        verifyReceipt: verifyColorGeometryReceipt,
        finalMapRevisionId: mapBinding.mapRevisionId ?? null,
        loadPhysicalLearningEvent: deps.loadPhysicalLearningEvent,
        loadPhysicalLearningEvidence: deps.loadPhysicalLearningEvidence,
      });
      const finalMapAuthority: SpeedsterMapAuthorityEvent = {
        attemptId: randomUUID(),
        recordedAt: new Date().toISOString(),
        status: appliedMap
          ? "APPLIED"
          : mapFailureCode === "MAP_AUTHORITY_HUMAN_REVIEW"
            ? "HUMAN_REVIEW_WITHOUT_MAP"
            : "NO_MAP",
        failureCode: mapFailureCode === "MAP_AUTHORITY_HUMAN_REVIEW"
          ? speedsterMapAuthorityEvidenceFromCapture(existing.capture)?.current.failureCode ?? null
          : null,
        message: appliedMap
          ? `Capture committed with validated Front + Back registration for immutable revision ${appliedMap.revision.revisionId}.`
          : mapFailureCode === "MAP_AUTHORITY_HUMAN_REVIEW"
            ? "Capture committed through the operator's durable human-review-without-map decision; the original failure remains in authority history."
            : "Capture committed after the authoritative server lookup confirmed NO_MAP.",
        revision: appliedMap ? {
          revisionId: appliedMap.revision.revisionId,
          revisionHash: appliedMap.revision.revisionHash,
          version: appliedMap.revision.version,
          scope: appliedMap.appliedScope,
          name: appliedMap.appliedMapName,
        } : mapFailureCode === "MAP_AUTHORITY_HUMAN_REVIEW"
          ? speedsterMapAuthorityEvidenceFromCapture(existing.capture)?.current.revision ?? null
          : null,
        registrationOperationId: mapFailureCode === "MAP_AUTHORITY_HUMAN_REVIEW"
          ? speedsterMapAuthorityEvidenceFromCapture(existing.capture)?.current.registrationOperationId ?? null
          : null,
        registrationFailures: mapFailureCode === "MAP_AUTHORITY_HUMAN_REVIEW"
          ? speedsterMapAuthorityEvidenceFromCapture(existing.capture)?.current.registrationFailures ?? []
          : [],
        operatorDecisionId: mapFailureCode === "MAP_AUTHORITY_HUMAN_REVIEW"
          ? speedsterMapAuthorityEvidenceFromCapture(existing.capture)?.current.operatorDecisionId ?? null
          : null,
      };
      const session = await deps.updateSession(sessionId, admin.user.id, {
        workflowState: "CAPTURED",
        capture: canonicalSpeedsterCapture(canonicalSource, existing.capture, finalMapAuthority),
        ...mapBinding,
      }, colorGeometryEvidence, existing.updatedAt);
      if (!session) {
        return res.status(409).json({ message: "Speedster capture state changed before it could be saved" });
      }
      try {
        await deps.recordInstrumentation?.([speedsterCardMapApplicationEvent({
          sessionId,
          createdByUserId: admin.user.id,
          applied: appliedMap,
          selected: selectedMap,
          failureCode: mapFailureCode,
        })]);
      } catch (error) {
        console.error(`[Speedster] Card-map instrumentation failed for ${sessionId}:`, error);
      }
      return res.status(200).json({ session: safeSessionResponse(session) });
    } catch (error) {
      if (error instanceof SpeedsterColorGeometryCaptureReceiptExpiredError) {
        return res.status(409).json({
          message: error.message,
          colorGeometryReceiptExpired: {
            side: error.side,
            mode: error.mode,
          },
        });
      }
      if (error instanceof SpeedsterMapIntegrityError) {
        return res.status(409).json({ message: error.message });
      }
      const response = toErrorResponse(error);
      return res.status(response.status).json({ message: response.message });
    }
  };
}

export default createAiGraderV2SessionHandler();
