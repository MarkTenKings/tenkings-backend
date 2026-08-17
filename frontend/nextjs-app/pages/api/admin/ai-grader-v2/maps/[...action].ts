import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { z } from "zod";
import type { SpeedsterCardProfile } from "../../../../../lib/ai-grader-v2/contracts";
import {
  isSpeedsterPokemonFamilyKeyV2,
  speedsterMapScopeForKey,
  type SpeedsterMapScope,
} from "../../../../../lib/ai-grader-v2/card-type-map-contracts";
import {
  canonicalizeSpeedsterSessionIdentity,
  type SpeedsterSessionIdentity,
} from "../../../../../lib/ai-grader-v2/identity";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import {
  SpeedsterMapIntegrityError,
  listSpeedsterMappedSourceCards,
  listSpeedsterMapRevisionSummaries,
  loadEffectiveActiveSpeedsterMapRevision,
  loadScopedActiveSpeedsterMapRevision,
  parseSpeedsterMapSourceSession,
  promoteSpeedsterExactMapRevisionToFamily,
  restoreSpeedsterCardTypeMapRevision,
  saveSpeedsterFamilyAndExactMapRevisions,
  speedsterPhysicalQuadHash,
  speedsterMapSourceClientState,
  speedsterMapDisplayName,
  type SpeedsterLoadedMapRevision,
  type SpeedsterAppliedMapRevision,
  type SpeedsterMapDualSaveResult,
  type SpeedsterMappedSourceCard,
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
const zoneBase = {
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
} as const;
const zoneSchema = z.union([
  z.object(zoneBase).strict(),
  z.object({
    ...zoneBase,
    contentType: z.enum([
      "HEADER",
      "ARTWORK",
      "SPECIES_STRIP",
      "ATTACK",
      "STATS_BAR",
      "ARTIST_AND_CARD_ID",
      "FLAVOR_TEXT",
      "COPYRIGHT",
      "OTHER",
    ]),
    filterAuthority: z.boolean(),
    filterAuthoritySource: z.enum(["TYPE_DEFAULT", "HUMAN_OVERRIDE"]),
    filterPaddingMm: z.literal(0.6),
    proposalSource: z.enum([
      "HUMAN",
      "POKEMON_STANDARD_TEMPLATE",
      "VISUAL_SNAP",
      "COPIED_COMPATIBLE_MAP",
    ]),
    proposalConfidence: z.number().finite().min(0).max(1).nullable(),
  }).strict(),
]);
const sideSchema = z.object({
  designBoundary: boundarySchema,
  anchors: z.array(anchorSchema).length(4),
  zones: z.array(zoneSchema).min(1).max(100),
}).strict();
const saveSchema = z.object({
  sessionId: sessionIdSchema,
  familyLayoutType: z.enum(["POKEMON", "TRAINER", "ENERGY"]).optional(),
  familyYear: z.string().trim().min(1).max(24).optional(),
  front: sideSchema,
  back: sideSchema,
}).strict();
const restoreSchema = z.object({
  sessionId: sessionIdSchema,
  scope: z.enum(["EXACT", "FAMILY"]).default("EXACT"),
  revisionId: z.string().trim().min(1).max(80),
}).strict();
const promoteSchema = z.object({
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
  reviewedDefects: unknown;
  gradeReport: unknown;
  mapFilterDecisions: readonly Readonly<{ id: string }>[];
  legacyMapLayoutAuthority?: unknown;
}>;

type Dependencies = Readonly<{
  requireAdminSession: (req: NextApiRequest) => Promise<{ user: { id: string } }>;
  findSourceSession: (sessionId: string, adminId: string) => Promise<SourceRecord | null>;
  loadActiveMap: (input: Readonly<{
    cardProfile: SpeedsterCardProfile;
    identity: SpeedsterSessionIdentity;
    scope: SpeedsterMapScope;
  }>) => Promise<SpeedsterLoadedMapRevision | null>;
  loadEffectiveMap?: (input: Readonly<{
    cardProfile: SpeedsterCardProfile;
    identity: SpeedsterSessionIdentity;
  }>) => Promise<SpeedsterAppliedMapRevision | null>;
  listRevisions: (mapId: string, currentRevisionId: string) => Promise<Awaited<ReturnType<typeof listSpeedsterMapRevisionSummaries>>>;
  listMappedCards?: (adminId: string) => Promise<readonly SpeedsterMappedSourceCard[]>;
  saveDualRevisions: (input: Readonly<{
    source: SpeedsterMapSourceSession;
    authorAdminId: string;
    familyLayoutType?: "POKEMON" | "TRAINER" | "ENERGY";
    familyYear?: string;
    front: SpeedsterMapTrainingSideInput;
    back: SpeedsterMapTrainingSideInput;
  }>) => Promise<SpeedsterMapDualSaveResult>;
  restoreRevision: (input: Readonly<{
    source: SpeedsterMapSourceSession;
    targetRevisionId: string;
    authorAdminId: string;
    scope: SpeedsterMapScope;
  }>) => Promise<SpeedsterMapSaveResult>;
  promoteRevision?: (input: Readonly<{
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
      reviewedDefects: true,
      gradeReport: true,
      mapFilterDecisions: { take: 1, select: { id: true } },
      legacyMapLayoutAuthority: {
        select: { layoutType: true, selectedByAdminId: true, createdAt: true },
      },
    },
  }),
  loadActiveMap: loadScopedActiveSpeedsterMapRevision,
  loadEffectiveMap: loadEffectiveActiveSpeedsterMapRevision,
  listRevisions: listSpeedsterMapRevisionSummaries,
  listMappedCards: listSpeedsterMappedSourceCards,
  saveDualRevisions: saveSpeedsterFamilyAndExactMapRevisions,
  restoreRevision: restoreSpeedsterCardTypeMapRevision,
  promoteRevision: promoteSpeedsterExactMapRevisionToFamily,
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

function scopeFrom(req: NextApiRequest) {
  const raw = Array.isArray(req.query.scope) ? req.query.scope[0] : req.query.scope;
  const parsed = z.enum(["EXACT", "FAMILY", "EFFECTIVE"]).default("EXACT").safeParse(raw);
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

function sharesMapCoordinateBasis(revision: SpeedsterLoadedMapRevision, source: SpeedsterMapSourceSession) {
  return revision.frontMap.referenceInspection.storageKey === source.front.inspectionStorageKey
    && revision.backMap.referenceInspection.storageKey === source.back.inspectionStorageKey
    && revision.frontMap.sourcePhysicalQuadSha256 === speedsterPhysicalQuadHash(source.front.sourceCorners)
    && revision.backMap.sourcePhysicalQuadSha256 === speedsterPhysicalQuadHash(source.back.sourceCorners);
}

async function mapState(
  revision: SpeedsterLoadedMapRevision | null,
  deps: Dependencies,
  source?: SpeedsterMapSourceSession,
  requested?: Readonly<{
    scope: SpeedsterMapScope | null;
    cardProfile: SpeedsterCardProfile;
    identity: SpeedsterSessionIdentity;
  }>,
) {
  const scope = revision ? speedsterMapScopeForKey(revision.matchKey) : requested?.scope ?? null;
  const identity = revision?.displayIdentity ?? requested?.identity;
  const cardProfile = revision?.matchKey.category ?? requested?.cardProfile;
  const name = scope && identity && cardProfile ? speedsterMapDisplayName(scope, cardProfile, identity) : "";
  if (!revision) return { status: "MISSING" as const, scope, name, revision: null, revisions: [], editable: null };
  return {
    status: "LOADED" as const,
    scope,
    name,
    revision: {
      mapId: revision.mapId,
      revisionId: revision.revisionId,
      version: revision.version,
      revisionHash: revision.revisionHash,
      displayIdentity: revision.displayIdentity,
      mapSchemaVersion: revision.mapSchemaVersion,
      filterPolicyVersion: revision.filterPolicyVersion,
      createdAt: revision.createdAt.toISOString(),
      sourceProvenance: {
        sourceSessionId: revision.sourceSessionId,
        sourceIdentity: revision.displayIdentity,
      },
    },
    revisions: await deps.listRevisions(revision.mapId, revision.revisionId),
    editable: source && sharesMapCoordinateBasis(revision, source) ? editableMap(revision) : null,
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
  if (
    source.workflowState === "CAPTURED"
    && (
      !Array.isArray(record.reviewedDefects)
      || record.reviewedDefects.length !== 0
      || !record.gradeReport
      || typeof record.gradeReport !== "object"
      || Array.isArray(record.gradeReport)
      || Object.keys(record.gradeReport).length !== 0
      || record.mapFilterDecisions.length !== 0
    )
  ) {
    throw new SpeedsterMapIntegrityError(
      "Captured-card TRAIN can change its pinned map only before detector review is initialized.",
    );
  }
  return source;
}

function dualSaveSummary(
  scope: SpeedsterMapScope,
  saved: SpeedsterMapSaveResult,
  source: SpeedsterMapSourceSession,
) {
  const displayIdentity = scope === "FAMILY"
    && isSpeedsterPokemonFamilyKeyV2(saved.revision.matchKey)
    && "cardName" in source.identity
    ? {
        ...source.identity,
        year: saved.revision.matchKey.year,
        layoutType: saved.revision.matchKey.layoutType,
      }
    : source.identity;
  const name = speedsterMapDisplayName(scope, source.cardProfile, displayIdentity);
  return {
    scope,
    applicability: scope === "FAMILY" ? `All ${name} cards` : `This exact source card — ${name}`,
    mapId: saved.mapId,
    revisionId: saved.revision.revisionId,
    version: saved.revision.version,
    revisionHash: saved.revision.revisionHash,
    matchKeyHash: saved.revision.matchKeyHash,
    sourceSessionId: saved.revision.sourceSessionId,
  };
}

function integrityFailureBody(error: SpeedsterMapIntegrityError) {
  return {
    message: error.message,
    code: error.code,
    ...(error.diagnostics ? { diagnostics: error.diagnostics } : {}),
  };
}

function repairableAuthoringMapState(
  error: SpeedsterMapIntegrityError,
  requested: Readonly<{
    scope: SpeedsterMapScope;
    cardProfile: SpeedsterCardProfile;
    identity: SpeedsterSessionIdentity;
  }>,
) {
  return {
    status: "INTEGRITY_ERROR" as const,
    scope: requested.scope,
    name: speedsterMapDisplayName(requested.scope, requested.cardProfile, requested.identity),
    revision: null,
    revisions: [],
    editable: null,
    integrity: {
      code: error.code,
      message: error.message,
    },
  };
}

export function createSpeedsterCardTypeMapHandler(deps: Dependencies = dependencies) {
  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "GET" && req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ message: "Method not allowed" });
    }
    const requestedAction = actionFrom(req);
    if (req.method === "GET" && requestedAction === "list") {
      res.setHeader("Cache-Control", "no-store");
    }
    try {
      const admin = await deps.requireAdminSession(req);
      const action = requestedAction;
      if (req.method === "GET" && action === "list") {
        if (!deps.listMappedCards) throw new SpeedsterMapIntegrityError("Card Map library is unavailable.");
        const cards = await deps.listMappedCards(admin.user.id);
        return res.status(200).json({ cards });
      }
      if (req.method === "GET" && (action === "current" || action === "source")) {
        const sessionId = sessionIdFrom(req);
        if (!sessionId) return res.status(400).json({ message: "Invalid Speedster session ID" });
        const scope = scopeFrom(req);
        if (!scope) return res.status(400).json({ message: "Invalid card map scope" });
        if (scope === "EFFECTIVE" && action === "source") {
          return res.status(400).json({ message: "Effective card map lookup is read-only" });
        }
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
        const source = action === "source" ? parseSpeedsterMapSourceSession(record) : null;
        if (source && source.workflowState !== "CAPTURED" && source.workflowState !== "COMPLETED") {
          return res.status(409).json({ message: "TRAIN requires saved Front and Back physical geometry." });
        }
        const lookupIdentity = scope === "FAMILY"
          && record.cardProfile === "POKEMON"
          && source?.legacyLayoutAuthority
          && "cardName" in identity
          ? { ...identity, layoutType: source.legacyLayoutAuthority.layoutType }
          : identity;
        if (scope === "EFFECTIVE" && !deps.loadEffectiveMap) {
          throw new SpeedsterMapIntegrityError("Effective card map lookup is unavailable.");
        }
        let revision: SpeedsterLoadedMapRevision | null = null;
        let authoringIntegrityError: SpeedsterMapIntegrityError | null = null;
        try {
          revision = scope === "EFFECTIVE"
            ? (await deps.loadEffectiveMap!({ cardProfile: record.cardProfile, identity }))?.revision ?? null
            : await deps.loadActiveMap({
                cardProfile: record.cardProfile,
                identity: lookupIdentity,
                scope,
              });
        } catch (error) {
          if (action === "source" && scope !== "EFFECTIVE" && error instanceof SpeedsterMapIntegrityError) {
            authoringIntegrityError = error;
          } else {
            throw error;
          }
        }
        const requestedMap = {
          scope: scope === "EFFECTIVE" ? null : scope,
          cardProfile: record.cardProfile,
          identity,
        } as const;
        if (action === "current") {
          res.setHeader("Cache-Control", "no-store");
          return res.status(200).json({ map: await mapState(revision, deps, undefined, requestedMap) });
        }
        if (!source) throw new SpeedsterMapIntegrityError("TRAIN source is unavailable.");
        res.setHeader("Cache-Control", "no-store");
        return res.status(200).json({
          source: await deps.sourceClientState(source),
          map: authoringIntegrityError
            ? repairableAuthoringMapState(authoringIntegrityError, {
                scope: scope as SpeedsterMapScope,
                cardProfile: record.cardProfile,
                identity,
              })
            : await mapState(revision, deps, source, requestedMap),
        });
      }

      if (req.method !== "POST" || (action !== "save" && action !== "restore" && action !== "promote")) {
        return res.status(404).json({ message: "Unknown Speedster TRAIN map action" });
      }
      if (action === "save") {
        const parsed = saveSchema.safeParse(req.body ?? {});
        if (!parsed.success) return res.status(400).json({
          message: "Invalid Card Map authoring request.",
          code: "CARD_MAP_INVALID_REQUEST",
          diagnostics: { stage: "VALIDATION" },
        });
        const source = await sourceFor(parsed.data.sessionId, admin.user.id, deps);
        if (!source) return res.status(404).json({
          message: "Card Map source was not found.",
          code: "CARD_MAP_SOURCE_NOT_FOUND",
          diagnostics: { stage: "SOURCE" },
        });
        if (source.cardProfile === "POKEMON"
          && (!parsed.data.familyLayoutType || !parsed.data.familyYear)) {
          return res.status(400).json({
            message: "Pokémon Card Map authoring requires an explicit Family layout and canonical Family year.",
            code: "CARD_MAP_INVALID_REQUEST",
            diagnostics: { stage: "VALIDATION", scope: "FAMILY" },
          });
        }
        if (source.cardProfile === "SPORTS"
          && (parsed.data.familyLayoutType || parsed.data.familyYear)) {
          return res.status(400).json({
            message: "Sports Card Map authoring cannot carry Pokémon Family authority fields.",
            code: "CARD_MAP_INVALID_REQUEST",
            diagnostics: { stage: "VALIDATION", scope: "FAMILY" },
          });
        }
        const saved = await deps.saveDualRevisions({
          source,
          authorAdminId: admin.user.id,
          ...(parsed.data.familyLayoutType ? { familyLayoutType: parsed.data.familyLayoutType } : {}),
          ...(parsed.data.familyYear ? { familyYear: parsed.data.familyYear } : {}),
          front: parsed.data.front as SpeedsterMapTrainingSideInput,
          back: parsed.data.back as SpeedsterMapTrainingSideInput,
        });
        return res.status(201).json({
          maps: {
            family: dualSaveSummary("FAMILY", saved.family, source),
            exact: dualSaveSummary("EXACT", saved.exact, source),
          },
        });
      }

      if (action === "promote") {
        const parsed = promoteSchema.safeParse(req.body ?? {});
        if (!parsed.success) return res.status(400).json({ message: "Invalid card map promotion" });
        const source = await sourceFor(parsed.data.sessionId, admin.user.id, deps);
        if (!source) return res.status(404).json({ message: "Speedster TRAIN source not found" });
        if (!deps.promoteRevision) throw new SpeedsterMapIntegrityError("Card map promotion is unavailable.");
        const promoted = await deps.promoteRevision({
          source,
          targetRevisionId: parsed.data.revisionId,
          authorAdminId: admin.user.id,
        });
        return res.status(201).json({ map: await mapState(promoted.revision, deps, source) });
      }

      const parsed = restoreSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ message: "Invalid TRAIN map restore" });
      const source = await sourceFor(parsed.data.sessionId, admin.user.id, deps);
      if (!source) return res.status(404).json({ message: "Speedster TRAIN source not found" });
      const restored = await deps.restoreRevision({
        source,
        targetRevisionId: parsed.data.revisionId,
        authorAdminId: admin.user.id,
        scope: parsed.data.scope,
      });
      return res.status(201).json({ map: await mapState(restored.revision, deps, source) });
    } catch (error) {
      if (error instanceof SpeedsterMapIntegrityError) {
        return res.status(409).json(
          requestedAction === "save" ? integrityFailureBody(error) : { message: error.message },
        );
      }
      const response = toErrorResponse(error);
      if (requestedAction !== "save") {
        return res.status(response.status).json({ message: response.message });
      }
      if (response.status === 401 || response.status === 403) {
        return res.status(response.status).json({ message: response.message });
      }
      return res.status(response.status).json({
        message: response.message,
        code: "CARD_MAP_DUAL_CREATE_FAILED",
        diagnostics: { stage: "TRANSACTION" },
      });
    }
  };
}

export default createSpeedsterCardTypeMapHandler();
