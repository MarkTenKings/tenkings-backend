import type { NextApiRequest, NextApiResponse } from "next";
import { prisma, type Prisma } from "@tenkings/database";
import { z } from "zod";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import {
  parseSpeedsterReviewFindings,
  stripSpeedsterTraceBodies,
} from "../../../../../lib/ai-grader-v2/review-findings";
import { SPEEDSTER_MAP_FILTER_POLICY_VERSION } from "../../../../../lib/ai-grader-v2/card-type-map-contracts";
import {
  SpeedsterMapIntegrityError,
  hashSpeedsterMapStorageEvidence,
  loadExactActiveSpeedsterMapRevision,
  parseSpeedsterMapSourceSession,
  parseSpeedsterMapRegistration,
  speedsterPhysicalQuadHash,
} from "../../../../../lib/server/speedsterCardTypeMaps";

const jsonObject = z.record(z.string(), z.unknown());
const patchSchema = z
  .object({
    workflowState: z.literal("CAPTURED"),
    capture: jsonObject.refine((value) => Object.keys(value).length > 0),
    mapBinding: z.object({
      revisionId: z.string().trim().min(1).max(80),
      filterPolicyVersion: z.literal(SPEEDSTER_MAP_FILTER_POLICY_VERSION),
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
  mapFilterPolicyVersion?: typeof SPEEDSTER_MAP_FILTER_POLICY_VERSION;
  mapRegistration?: Prisma.InputJsonValue;
};

export type MapBindingInput = NonNullable<z.output<typeof patchSchema>["mapBinding"]>;

type MapBindingValidationDependencies = Readonly<{
  loadActiveMap: typeof loadExactActiveSpeedsterMapRevision;
  hashEvidence: typeof hashSpeedsterMapStorageEvidence;
}>;

const mapBindingValidationDependencies: MapBindingValidationDependencies = {
  loadActiveMap: loadExactActiveSpeedsterMapRevision,
  hashEvidence: hashSpeedsterMapStorageEvidence,
};

export async function validateSpeedsterSubmittedMapBinding(
  session: PersistedSession,
  binding: MapBindingInput | undefined,
  capture: Record<string, unknown>,
  deps: MapBindingValidationDependencies = mapBindingValidationDependencies,
): Promise<Pick<UpdateSessionData, "mapRevisionId" | "mapFilterPolicyVersion" | "mapRegistration">> {
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
  const revision = await deps.loadActiveMap({ cardProfile: source.cardProfile, identity: source.identity });
  if (!revision) {
    if (binding) {
      throw new SpeedsterMapIntegrityError("Speedster map binding was submitted without an exact active revision.");
    }
    return {};
  }
  if (!binding || revision.revisionId !== binding.revisionId) {
    throw new SpeedsterMapIntegrityError("Speedster map binding does not match the exact active revision.");
  }
  const front = parseSpeedsterMapRegistration(binding.registration.front, {
    side: "FRONT",
    mapRevisionId: revision.revisionId,
  });
  const back = parseSpeedsterMapRegistration(binding.registration.back, {
    side: "BACK",
    mapRevisionId: revision.revisionId,
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
    mapFilterPolicyVersion: SPEEDSTER_MAP_FILTER_POLICY_VERSION,
    mapRegistration: { front, back } as unknown as Prisma.InputJsonValue,
  };
}

type Dependencies = {
  requireAdminSession: (req: NextApiRequest) => Promise<{ user: { id: string } }>;
  findSession: (id: string, createdByUserId: string) => Promise<PersistedSession | null>;
  updateSession: (id: string, createdByUserId: string, data: UpdateSessionData) => Promise<PersistedSession | null>;
  validateMapBinding?: (session: PersistedSession, binding: MapBindingInput | undefined, capture: Record<string, unknown>) => Promise<Pick<
    UpdateSessionData,
    "mapRevisionId" | "mapFilterPolicyVersion" | "mapRegistration"
  >>;
};

const dependencies: Dependencies = {
  requireAdminSession,
  findSession: (id, createdByUserId) => prisma.aiGraderV2Session.findFirst({ where: { id, createdByUserId } }),
  updateSession: (id, createdByUserId, data) => prisma.$transaction(async (tx) => {
    const updated = await tx.aiGraderV2Session.updateMany({
      where: { id, createdByUserId, workflowState: "DRAFT" },
      data,
    });
    if (updated.count !== 1) return null;
    return tx.aiGraderV2Session.findFirst({ where: { id, createdByUserId } });
  }),
  validateMapBinding: validateSpeedsterSubmittedMapBinding,
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
      const mapBinding = await deps.validateMapBinding?.(existing, parsed.data.mapBinding, parsed.data.capture);
      if (!mapBinding) {
        throw new Error("Speedster map binding validation is unavailable.");
      }
      const session = await deps.updateSession(sessionId, admin.user.id, {
        workflowState: "CAPTURED",
        capture: parsed.data.capture as Prisma.InputJsonValue,
        ...mapBinding,
      });
      if (!session) {
        return res.status(409).json({ message: "Speedster capture state changed before it could be saved" });
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
