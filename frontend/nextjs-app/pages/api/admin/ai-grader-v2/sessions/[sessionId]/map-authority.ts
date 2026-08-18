import { randomUUID } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { prisma, type Prisma } from "@tenkings/database";
import { z } from "zod";
import {
  appendSpeedsterMapAuthorityEvidence,
  speedsterMapAuthorityEvidenceFromCapture,
  type SpeedsterMapAuthorityEvent,
  type SpeedsterMapAuthorityFailure,
} from "../../../../../../lib/ai-grader-v2/map-authority";
import {
  canonicalizeSpeedsterSessionIdentity,
  type SpeedsterSessionIdentity,
} from "../../../../../../lib/ai-grader-v2/identity";
import type { SpeedsterCardProfile } from "../../../../../../lib/ai-grader-v2/contracts";
import { requireAdminSession, toErrorResponse } from "../../../../../../lib/server/admin";
import {
  SpeedsterMapIntegrityError,
  loadEffectiveActiveSpeedsterMapRevision,
  type SpeedsterAppliedMapRevision,
} from "../../../../../../lib/server/speedsterCardTypeMaps";

const resolveSchema = z.object({ action: z.literal("RESOLVE_LOOKUP") }).strict();
const failureSchema = z.object({
  side: z.enum(["FRONT", "BACK"]),
  source: z.enum([
    "PROVIDER_GATEWAY",
    "PROVIDER",
    "PROVIDER_NETWORK",
    "TEN_KINGS_API",
    "CLIENT_NETWORK",
    "CLIENT_PROTOCOL",
    "HUMAN_CORRECTION",
  ]),
  code: z.string().trim().min(1).max(160),
  httpStatus: z.number().int().min(100).max(599).nullable(),
  requestId: z.string().trim().min(1).max(180).optional(),
}).strict();
const blockRegistrationSchema = z.object({
  action: z.literal("BLOCK_REGISTRATION"),
  mapRevisionId: z.string().trim().min(1).max(80),
  mapRevisionHash: z.string().regex(/^[a-f0-9]{64}$/),
  mapScope: z.enum(["EXACT", "FAMILY"]),
  operationId: z.string().trim().min(1).max(180),
  failures: z.array(failureSchema).min(1).max(2),
}).strict();
const requestSchema = z.discriminatedUnion("action", [resolveSchema, blockRegistrationSchema]);

type DraftSession = Readonly<{
  id: string;
  createdByUserId: string;
  cardProfile: string;
  workflowState: string;
  identity: unknown;
  capture: unknown;
  updatedAt: Date;
}>;

type Dependencies = Readonly<{
  requireAdminSession: (req: NextApiRequest) => Promise<{ user: { id: string } }>;
  findSession: (sessionId: string, adminId: string) => Promise<DraftSession | null>;
  loadEffectiveMap: (input: Readonly<{
    cardProfile: SpeedsterCardProfile;
    identity: SpeedsterSessionIdentity;
  }>) => Promise<SpeedsterAppliedMapRevision | null>;
  persistEvidence: (
    session: DraftSession,
    adminId: string,
    event: SpeedsterMapAuthorityEvent,
  ) => Promise<DraftSession | null>;
  now?: () => Date;
  randomId?: () => string;
}>;

const dependencies: Dependencies = {
  requireAdminSession,
  findSession: (sessionId, adminId) => prisma.aiGraderV2Session.findFirst({
    where: { id: sessionId, createdByUserId: adminId },
    select: {
      id: true,
      createdByUserId: true,
      cardProfile: true,
      workflowState: true,
      identity: true,
      capture: true,
      updatedAt: true,
    },
  }),
  loadEffectiveMap: loadEffectiveActiveSpeedsterMapRevision,
  persistEvidence: async (session, adminId, event) => {
    const capture = appendSpeedsterMapAuthorityEvidence(session.capture, event) as Prisma.InputJsonValue;
    const updated = await prisma.aiGraderV2Session.updateMany({
      where: {
        id: session.id,
        createdByUserId: adminId,
        workflowState: "DRAFT",
        updatedAt: session.updatedAt,
      },
      data: { capture },
    });
    if (updated.count !== 1) return null;
    return prisma.aiGraderV2Session.findFirst({
      where: { id: session.id, createdByUserId: adminId },
      select: {
        id: true,
        createdByUserId: true,
        cardProfile: true,
        workflowState: true,
        identity: true,
        capture: true,
        updatedAt: true,
      },
    });
  },
};

function sessionIdFrom(req: NextApiRequest) {
  const raw = Array.isArray(req.query.sessionId) ? req.query.sessionId[0] : req.query.sessionId;
  return typeof raw === "string" && /^[a-z0-9-]{20,80}$/i.test(raw) ? raw : null;
}

function revisionEvidence(selected: SpeedsterAppliedMapRevision) {
  return {
    revisionId: selected.revision.revisionId,
    revisionHash: selected.revision.revisionHash,
    version: selected.revision.version,
    scope: selected.appliedScope,
    name: selected.appliedMapName,
  } as const;
}

function clientMap(selected: SpeedsterAppliedMapRevision | null) {
  if (!selected) {
    return { status: "MISSING" as const, scope: null, name: "", revision: null, revisions: [], editable: null };
  }
  const revision = selected.revision;
  return {
    status: "LOADED" as const,
    scope: selected.appliedScope,
    name: selected.appliedMapName,
    revision: {
      mapId: revision.mapId,
      revisionId: revision.revisionId,
      version: revision.version,
      revisionHash: revision.revisionHash,
      displayIdentity: revision.displayIdentity,
      mapSchemaVersion: revision.mapSchemaVersion,
      filterPolicyVersion: revision.filterPolicyVersion,
      createdAt: revision.createdAt.toISOString(),
      sourceProvenance: selected.sourceProvenance,
    },
    revisions: [],
    editable: null,
  };
}

function authorityEvent(input: Readonly<{
  now: Date;
  attemptId: string;
  status: SpeedsterMapAuthorityEvent["status"];
  message: string;
  failureCode?: string | null;
  selected?: SpeedsterAppliedMapRevision | null;
  operationId?: string | null;
  failures?: readonly SpeedsterMapAuthorityFailure[];
}>): SpeedsterMapAuthorityEvent {
  return {
    attemptId: input.attemptId,
    recordedAt: input.now.toISOString(),
    status: input.status,
    failureCode: input.failureCode ?? null,
    message: input.message,
    revision: input.selected ? revisionEvidence(input.selected) : null,
    registrationOperationId: input.operationId ?? null,
    registrationFailures: input.failures ?? [],
  };
}

export function createSpeedsterMapAuthorityHandler(deps: Dependencies = dependencies) {
  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ message: "Method not allowed" });
    }
    try {
      const admin = await deps.requireAdminSession(req);
      const sessionId = sessionIdFrom(req);
      if (!sessionId) return res.status(400).json({ message: "Invalid Speedster session ID" });
      const parsed = requestSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ message: "Invalid Card Map authority request" });
      const session = await deps.findSession(sessionId, admin.user.id);
      if (!session) return res.status(404).json({ message: "Speedster session not found" });
      if (session.workflowState !== "DRAFT") {
        return res.status(409).json({ message: "Card Map authority can only be resolved for a DRAFT session" });
      }
      if (session.cardProfile !== "SPORTS" && session.cardProfile !== "POKEMON") {
        throw new SpeedsterMapIntegrityError("Card Map authority session category is unsupported.");
      }
      const identity = canonicalizeSpeedsterSessionIdentity(session.cardProfile, session.identity);
      const now = (deps.now ?? (() => new Date()))();
      const attemptId = (deps.randomId ?? randomUUID)();

      let selected: SpeedsterAppliedMapRevision | null;
      try {
        selected = await deps.loadEffectiveMap({ cardProfile: session.cardProfile, identity });
      } catch (error) {
        const integrity = error instanceof SpeedsterMapIntegrityError;
        const event = authorityEvent({
          now,
          attemptId,
          status: integrity ? "INTEGRITY_ERROR" : "LOOKUP_FAILED",
          failureCode: integrity ? error.code : "CARD_MAP_LOOKUP_TRANSPORT_FAILED",
          message: integrity
            ? error.message
            : "Card Map lookup could not reach its authoritative store. No mapless continuation is allowed.",
        });
        const persisted = await deps.persistEvidence(session, admin.user.id, event);
        if (!persisted) return res.status(409).json({ message: "Card Map authority state changed before the blocker could be recorded" });
        return res.status(integrity ? 409 : 503).json({ authority: event, message: event.message });
      }

      if (parsed.data.action === "BLOCK_REGISTRATION") {
        const exactBinding = Boolean(
          selected
          && selected.revision.revisionId === parsed.data.mapRevisionId
          && selected.revision.revisionHash === parsed.data.mapRevisionHash
          && selected.appliedScope === parsed.data.mapScope,
        );
        if (!exactBinding) {
          const event = authorityEvent({
            now,
            attemptId,
            status: "INTEGRITY_ERROR",
            failureCode: "CARD_MAP_REGISTRATION_REVISION_MISMATCH",
            message: "Registration failure evidence does not match the exact active Card Map revision. No map was applied.",
            selected,
          });
          const persisted = await deps.persistEvidence(session, admin.user.id, event);
          if (!persisted) return res.status(409).json({ message: "Card Map authority state changed before the blocker could be recorded" });
          return res.status(409).json({ authority: event, message: event.message });
        }
        const event = authorityEvent({
          now,
          attemptId,
          status: "REGISTRATION_BLOCKED",
          failureCode: "CARD_MAP_REGISTRATION_BLOCKED",
          message: "Card Map registration is blocked. Retry or correct every failed side; mapless continuation is not allowed.",
          selected,
          operationId: parsed.data.operationId,
          failures: parsed.data.failures,
        });
        const persisted = await deps.persistEvidence(session, admin.user.id, event);
        if (!persisted) return res.status(409).json({ message: "Card Map authority state changed before the blocker could be recorded" });
        return res.status(200).json({ authority: event });
      }

      const priorAuthority = speedsterMapAuthorityEvidenceFromCapture(session.capture)?.current;
      if (priorAuthority?.status === "REGISTRATION_BLOCKED"
        && selected
        && priorAuthority.revision?.revisionId === selected.revision.revisionId
        && priorAuthority.revision.revisionHash === selected.revision.revisionHash
        && priorAuthority.revision.scope === selected.appliedScope) {
        return res.status(200).json({ authority: priorAuthority, map: clientMap(selected) });
      }

      const event = authorityEvent({
        now,
        attemptId,
        status: selected ? "LOADED" : "NO_MAP",
        message: selected
          ? `Exact Card Map authority resolved to immutable revision ${selected.revision.revisionId}.`
          : "No eligible Exact or Family Card Map exists for this session identity.",
        selected,
      });
      const persisted = await deps.persistEvidence(session, admin.user.id, event);
      if (!persisted) return res.status(409).json({ message: "Card Map authority state changed before it could be recorded" });
      return res.status(200).json({ authority: event, map: clientMap(selected) });
    } catch (error) {
      const response = toErrorResponse(error);
      return res.status(response.status).json({ message: response.message });
    }
  };
}

export default createSpeedsterMapAuthorityHandler();
