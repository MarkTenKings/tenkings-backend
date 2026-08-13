import type { NextApiRequest, NextApiResponse } from "next";
import { prisma, type Prisma } from "@tenkings/database";
import { z } from "zod";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import {
  parseSpeedsterReviewFindings,
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
} from "../../../../../lib/server/speedsterCardTypeMaps";
import {
  insertSpeedsterInstrumentationEvents,
  speedsterCardMapApplicationEvent,
  type SpeedsterInstrumentationEvent,
} from "../../../../../lib/server/aiGraderV2Instrumentation";

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
  [key: string]: unknown;
};

type UpdateSessionData = {
  workflowState: "CAPTURED";
  capture: Prisma.InputJsonValue;
  mapRevisionId?: string;
  mapFilterPolicyVersion?: SpeedsterMapFilterPolicyVersion;
  mapRegistration?: Prisma.InputJsonValue;
};

export type MapBindingInput = NonNullable<z.output<typeof patchSchema>["mapBinding"]>;

type MapBindingValidationResult = Pick<
  UpdateSessionData,
  "mapRevisionId" | "mapFilterPolicyVersion" | "mapRegistration"
> & Readonly<{
  appliedMap?: SpeedsterAppliedMapRevision | null;
  selectedMap?: SpeedsterAppliedMapRevision | null;
  mapFailureCode?: "MAP_LOOKUP_INTEGRITY_FAILED" | "MAP_REGISTRATION_NOT_APPLIED" | null;
}>;

type MapBindingValidationDependencies = Readonly<{
  loadActiveMap: typeof loadEffectiveActiveSpeedsterMapRevision;
  hashEvidence: typeof hashSpeedsterMapStorageEvidence;
}>;

const mapBindingValidationDependencies: MapBindingValidationDependencies = {
  loadActiveMap: loadEffectiveActiveSpeedsterMapRevision,
  hashEvidence: hashSpeedsterMapStorageEvidence,
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
  let selectedMap: SpeedsterAppliedMapRevision | null;
  try {
    selectedMap = await deps.loadActiveMap({ cardProfile: source.cardProfile, identity: source.identity });
  } catch (error) {
    if (binding) throw error;
    return {
      appliedMap: null,
      selectedMap: null,
      mapFailureCode: "MAP_LOOKUP_INTEGRITY_FAILED",
    };
  }
  if (!selectedMap) {
    if (binding) {
      throw new SpeedsterMapIntegrityError("Speedster map binding was submitted without an active revision.");
    }
    return { appliedMap: null, selectedMap: null };
  }
  if (!binding) {
    return {
      appliedMap: null,
      selectedMap,
      mapFailureCode: "MAP_REGISTRATION_NOT_APPLIED",
    };
  }
  const revision = selectedMap.revision;
  if (revision.revisionId !== binding.revisionId) {
    throw new SpeedsterMapIntegrityError("Speedster map binding does not match the active revision.");
  }
  // The loader has always supplied this field, but retaining the v1 default
  // here keeps legacy/test callers from becoming a new capture blocker.
  const revisionFilterPolicyVersion = revision.filterPolicyVersion
    ?? SPEEDSTER_MAP_FILTER_POLICY_VERSION;
  if (revisionFilterPolicyVersion !== binding.filterPolicyVersion) {
    throw new SpeedsterMapIntegrityError("Speedster map binding does not match the active filter policy.");
  }
  if (revisionFilterPolicyVersion === SPEEDSTER_MAP_FILTER_POLICY_VERSION_V2
    && (!revision.frontMap?.zones || !revision.backMap?.zones)) {
    throw new SpeedsterMapIntegrityError("Speedster v2 map binding is missing immutable zone authority.");
  }
  const front = parseSpeedsterMapRegistration(binding.registration.front, {
    side: "FRONT",
    mapRevisionId: revision.revisionId,
    zones: revision.frontMap?.zones,
    anchors: revision.frontMap?.anchors,
    designBoundary: revision.frontMap?.designBoundary,
  });
  const back = parseSpeedsterMapRegistration(binding.registration.back, {
    side: "BACK",
    mapRevisionId: revision.revisionId,
    zones: revision.backMap?.zones,
    anchors: revision.backMap?.anchors,
    designBoundary: revision.backMap?.designBoundary,
  });
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
  updateSession: (id: string, createdByUserId: string, data: UpdateSessionData) => Promise<PersistedSession | null>;
  validateMapBinding?: (session: PersistedSession, binding: MapBindingInput | undefined, capture: Record<string, unknown>) => Promise<Pick<
    UpdateSessionData,
    "mapRevisionId" | "mapFilterPolicyVersion" | "mapRegistration"
  > & Readonly<{
    appliedMap?: SpeedsterAppliedMapRevision | null;
    selectedMap?: SpeedsterAppliedMapRevision | null;
    mapFailureCode?: "MAP_LOOKUP_INTEGRITY_FAILED" | "MAP_REGISTRATION_NOT_APPLIED" | null;
  }>>;
  recordInstrumentation?: (events: readonly SpeedsterInstrumentationEvent[]) => Promise<unknown>;
};

const dependencies: Dependencies = {
  requireAdminSession,
  findSession: (id, createdByUserId) => prisma.aiGraderV2Session.findFirst({ where: { id, createdByUserId } }),
  updateSession: (id, createdByUserId, data) => prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const updated = await tx.aiGraderV2Session.updateMany({
      where: { id, createdByUserId, workflowState: "DRAFT" },
      data,
    });
    if (updated.count !== 1) return null;
    return tx.aiGraderV2Session.findFirst({ where: { id, createdByUserId } });
  }),
  validateMapBinding: validateSpeedsterSubmittedMapBinding,
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
      parseSpeedsterReviewFindings(session.reviewedDefects),
    ),
  };
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
      const session = await deps.updateSession(sessionId, admin.user.id, {
        workflowState: "CAPTURED",
        capture: parsed.data.capture as Prisma.InputJsonValue,
        ...mapBinding,
      });
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
      if (error instanceof SpeedsterMapIntegrityError) {
        return res.status(409).json({ message: error.message });
      }
      const response = toErrorResponse(error);
      return res.status(response.status).json({ message: response.message });
    }
  };
}

export default createAiGraderV2SessionHandler();
