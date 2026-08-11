import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { z } from "zod";
import type { SpeedsterCardProfile } from "../../../../../lib/ai-grader-v2/contracts";
import {
  canonicalizeSpeedsterSessionIdentity,
  type SpeedsterSessionIdentity,
} from "../../../../../lib/ai-grader-v2/identity";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import {
  SpeedsterMapIntegrityError,
  listSpeedsterMapRevisionSummaries,
  loadExactActiveSpeedsterMapRevision,
  parseSpeedsterMapSourceSession,
  restoreSpeedsterCardTypeMapRevision,
  saveSpeedsterCardTypeMapRevision,
  speedsterMapSourceClientState,
  type SpeedsterLoadedMapRevision,
  type SpeedsterMapSaveResult,
  type SpeedsterMapSourceSession,
  type SpeedsterMapTrainingSideInput,
} from "../../../../../lib/server/speedsterCardTypeMaps";

const sessionIdSchema = z.string().trim().min(20).max(80);
const pointSchema = z.object({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
}).strict();
const boundarySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("FULL_BLEED") }).strict(),
  z.object({ kind: z.literal("QUAD"), points: z.tuple([
    pointSchema,
    pointSchema,
    pointSchema,
    pointSchema,
  ]) }).strict(),
]);
const anchorSchema = z.object({
  id: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(80),
  point: pointSchema,
}).strict();
const zoneSchema = z.object({
  id: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(80),
  semanticType: z.enum([
    "PRINT_TEXT",
    "PRINT_LOGO",
    "PRINT_ARTWORK",
    "PRINT_BORDER",
    "PRINT_FOIL",
    "OTHER_PRINT_CONTEXT",
  ]),
  polygon: z.array(pointSchema).min(3).max(64),
}).strict();
const sideSchema = z.object({
  designBoundary: boundarySchema,
  anchors: z.array(anchorSchema).length(4),
  zones: z.array(zoneSchema).min(1).max(100),
}).strict();
const saveSchema = z.object({
  sessionId: sessionIdSchema,
  front: sideSchema,
  back: sideSchema,
}).strict();
const restoreSchema = z.object({
  sessionId: sessionIdSchema,
  revisionId: z.string().trim().min(1).max(80),
}).strict();

type SourceRecord = Readonly<{
  id: string;
  createdByUserId: string;
  cardProfile: string;
  workflowState: string;
  identity: unknown;
  capture: unknown;
}>;

type Dependencies = Readonly<{
  requireAdminSession: (req: NextApiRequest) => Promise<{ user: { id: string } }>;
  findSourceSession: (sessionId: string, adminId: string) => Promise<SourceRecord | null>;
  loadActiveMap: (input: Readonly<{
    cardProfile: SpeedsterCardProfile;
    identity: SpeedsterSessionIdentity;
  }>) => Promise<SpeedsterLoadedMapRevision | null>;
  listRevisions: (mapId: string, currentRevisionId: string) => Promise<Awaited<ReturnType<typeof listSpeedsterMapRevisionSummaries>>>;
  saveRevision: (input: Readonly<{
    source: SpeedsterMapSourceSession;
    authorAdminId: string;
    front: SpeedsterMapTrainingSideInput;
    back: SpeedsterMapTrainingSideInput;
  }>) => Promise<SpeedsterMapSaveResult>;
  restoreRevision: (input: Readonly<{
    source: SpeedsterMapSourceSession;
    targetRevisionId: string;
    authorAdminId: string;
  }>) => Promise<SpeedsterMapSaveResult>;
  sourceClientState: typeof speedsterMapSourceClientState;
}>;

const dependencies: Dependencies = {
  requireAdminSession,
  findSourceSession: (sessionId, adminId) => prisma.aiGraderV2Session.findFirst({
    where: {
      id: sessionId,
      OR: [
        { createdByUserId: adminId },
        { workflowState: "COMPLETED" },
      ],
    },
    select: {
      id: true,
      createdByUserId: true,
      cardProfile: true,
      workflowState: true,
      identity: true,
      capture: true,
    },
  }),
  loadActiveMap: loadExactActiveSpeedsterMapRevision,
  listRevisions: listSpeedsterMapRevisionSummaries,
  saveRevision: saveSpeedsterCardTypeMapRevision,
  restoreRevision: restoreSpeedsterCardTypeMapRevision,
  sourceClientState: speedsterMapSourceClientState,
};

function actionFrom(req: NextApiRequest) {
  const raw = req.query.action;
  return Array.isArray(raw) ? raw.length === 1 ? raw[0] : null : raw ?? null;
}

function sessionIdFrom(req: NextApiRequest) {
  const raw = Array.isArray(req.query.sessionId) ? req.query.sessionId[0] : req.query.sessionId;
  const parsed = sessionIdSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function editableMap(revision: SpeedsterLoadedMapRevision) {
  const side = (value: SpeedsterLoadedMapRevision["frontMap"]) => ({
    designBoundary: value.designBoundary,
    anchors: value.anchors.map(({ id, label, point }) => ({ id, label, point })),
    zones: value.zones,
  });
  return { front: side(revision.frontMap), back: side(revision.backMap) };
}

async function mapState(revision: SpeedsterLoadedMapRevision | null, deps: Dependencies) {
  if (!revision) return { status: "MISSING" as const, revision: null, revisions: [], editable: null };
  return {
    status: "LOADED" as const,
    revision: {
      mapId: revision.mapId,
      revisionId: revision.revisionId,
      version: revision.version,
      revisionHash: revision.revisionHash,
      displayIdentity: revision.displayIdentity,
      mapSchemaVersion: revision.mapSchemaVersion,
      filterPolicyVersion: revision.filterPolicyVersion,
      createdAt: revision.createdAt.toISOString(),
    },
    revisions: await deps.listRevisions(revision.mapId, revision.revisionId),
    editable: editableMap(revision),
  };
}

async function sourceFor(
  sessionId: string,
  adminId: string,
  deps: Dependencies,
) {
  const record = await deps.findSourceSession(sessionId, adminId);
  if (!record) return null;
  const source = parseSpeedsterMapSourceSession(record);
  if (source.workflowState !== "CAPTURED" && source.workflowState !== "COMPLETED") {
    throw new SpeedsterMapIntegrityError("TRAIN requires saved Front and Back physical geometry.");
  }
  return source;
}

export function createSpeedsterCardTypeMapHandler(deps: Dependencies = dependencies) {
  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "GET" && req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ message: "Method not allowed" });
    }
    try {
      const admin = await deps.requireAdminSession(req);
      const action = actionFrom(req);
      if (req.method === "GET" && (action === "current" || action === "source")) {
        const sessionId = sessionIdFrom(req);
        if (!sessionId) return res.status(400).json({ message: "Invalid Speedster session ID" });
        const record = await deps.findSourceSession(sessionId, admin.user.id);
        if (!record) return res.status(404).json({ message: "Speedster TRAIN source not found" });
        if (record.cardProfile !== "SPORTS" && record.cardProfile !== "POKEMON") {
          throw new SpeedsterMapIntegrityError("TRAIN source category is unsupported.");
        }
        let identity: SpeedsterSessionIdentity;
        try {
          identity = canonicalizeSpeedsterSessionIdentity(record.cardProfile, record.identity);
        } catch {
          throw new SpeedsterMapIntegrityError("TRAIN source identity is malformed.");
        }
        const revision = await deps.loadActiveMap({ cardProfile: record.cardProfile, identity });
        const map = await mapState(revision, deps);
        if (action === "current") {
          res.setHeader("Cache-Control", "no-store");
          return res.status(200).json({ map });
        }
        const source = parseSpeedsterMapSourceSession(record);
        if (source.workflowState !== "CAPTURED" && source.workflowState !== "COMPLETED") {
          return res.status(409).json({ message: "TRAIN requires saved Front and Back physical geometry." });
        }
        res.setHeader("Cache-Control", "no-store");
        return res.status(200).json({ source: await deps.sourceClientState(source), map });
      }

      if (req.method !== "POST" || (action !== "save" && action !== "restore")) {
        return res.status(404).json({ message: "Unknown Speedster TRAIN map action" });
      }
      if (action === "save") {
        const parsed = saveSchema.safeParse(req.body ?? {});
        if (!parsed.success) return res.status(400).json({ message: "Invalid TRAIN map revision" });
        const source = await sourceFor(parsed.data.sessionId, admin.user.id, deps);
        if (!source) return res.status(404).json({ message: "Speedster TRAIN source not found" });
        const saved = await deps.saveRevision({
          source,
          authorAdminId: admin.user.id,
          front: parsed.data.front as SpeedsterMapTrainingSideInput,
          back: parsed.data.back as SpeedsterMapTrainingSideInput,
        });
        return res.status(201).json({ map: await mapState(saved.revision, deps) });
      }

      const parsed = restoreSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ message: "Invalid TRAIN map restore" });
      const source = await sourceFor(parsed.data.sessionId, admin.user.id, deps);
      if (!source) return res.status(404).json({ message: "Speedster TRAIN source not found" });
      const restored = await deps.restoreRevision({
        source,
        targetRevisionId: parsed.data.revisionId,
        authorAdminId: admin.user.id,
      });
      return res.status(201).json({ map: await mapState(restored.revision, deps) });
    } catch (error) {
      if (error instanceof SpeedsterMapIntegrityError) {
        return res.status(409).json({ message: error.message });
      }
      const response = toErrorResponse(error);
      return res.status(response.status).json({ message: response.message });
    }
  };
}

export default createSpeedsterCardTypeMapHandler();
