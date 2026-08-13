import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { NextApiRequest, NextApiResponse } from "next";
import {
  SPEEDSTER_MAP_FILTER_POLICY_VERSION,
  SPEEDSTER_MAP_FILTER_POLICY_VERSION_V2,
  SPEEDSTER_MAP_SCHEMA_VERSION,
  SPEEDSTER_MAP_SCHEMA_VERSION_V2,
  speedsterCardTypeMapKey,
  speedsterFamilyCardTypeMapKey,
  type SpeedsterCardTypeMapSide,
} from "../lib/ai-grader-v2/card-type-map-contracts";
import {
  SpeedsterMapIntegrityError,
  canonicalSpeedsterMapRevisionPayload,
  assertSpeedsterMapRevisionAppliesToIdentity,
  loadEffectiveActiveSpeedsterMapRevision,
  loadExactActiveSpeedsterMapRevision,
  loadPinnedSpeedsterMapRevision,
  normalizedSpeedsterMapRevisionPayload,
  parseSpeedsterMapSourceSession,
  promoteSpeedsterExactMapRevisionToFamily,
  registerRestoredMapSide,
  restoreSpeedsterCardTypeMapRevision,
  SPEEDSTER_MAP_FILTER_V2_ACTIVATION_AUTHORITY,
  SPEEDSTER_MAP_FILTER_V2_VERIFICATION_STATUS,
  saveSpeedsterCardTypeMapRevision,
  saveSpeedsterFamilyAndExactMapRevisions,
  speedsterIdentityMapRegistration,
  speedsterMapDisplayName,
  speedsterMapMatchKeyHash,
  speedsterPhysicalQuadHash,
  speedsterMapRevisionHash,
  validateSpeedsterLoadedMapRevision,
  type SpeedsterMapRevisionHashPayload,
  type SpeedsterMapTransactionRunner,
} from "../lib/server/speedsterCardTypeMaps";
import { createSpeedsterCardTypeMapHandler } from "../pages/api/admin/ai-grader-v2/maps/[...action]";
import {
  calculateCenteringBalance,
  calculateCenteringScore,
  measureSpeedsterCenteringBorders,
} from "../lib/ai-grader-v2/scoring";

const SESSION_ID = "speedster-map-session-0001";
const identity = {
  playerName: "Nick Bosa",
  year: "2021",
  manufacturer: "Panini",
  productSet: "Obsidian",
  parallel: "Orange",
  insert: null,
  cardNumber: "12",
} as const;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const quad = [
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.9, y: 0.9 },
  { x: 0.1, y: 0.9 },
] as const;
const anchors = [
  { id: "a1", label: "Anchor 1", point: { x: 0.2, y: 0.2 } },
  { id: "a2", label: "Anchor 2", point: { x: 0.8, y: 0.2 } },
  { id: "a3", label: "Anchor 3", point: { x: 0.8, y: 0.8 } },
  { id: "a4", label: "Anchor 4", point: { x: 0.2, y: 0.8 } },
] as const;
const zones = [{
  id: "zone-1",
  label: "Printed name",
  semanticType: "PRINT_TEXT" as const,
  polygon: quad,
}];

function mapSide(side: "FRONT" | "BACK"): SpeedsterCardTypeMapSide {
  const evidence = { storageKey: `ai-grader-v2/admin-1/${SESSION_ID}/prepared/${side.toLowerCase()}/inspection.webp`, sha256: sha(side) };
  return {
    side,
    referenceInspection: evidence,
    sourcePhysicalQuadSha256: sha(`${side}:quad`),
    designBoundary: { kind: "QUAD", points: quad },
    anchors: anchors.map((anchor) => ({ ...anchor, referencePatch: evidence })),
    zones,
  };
}

function payload(patch: Partial<SpeedsterMapRevisionHashPayload> = {}): SpeedsterMapRevisionHashPayload {
  const matchKey = speedsterCardTypeMapKey("SPORTS", identity);
  return {
    mapId: "map-1",
    version: 1,
    matchKeyHash: speedsterMapMatchKeyHash(matchKey),
    matchKey,
    displayIdentity: identity,
    normalizedIdentity: matchKey,
    sourceSessionId: SESSION_ID,
    authorAdminId: "admin-1",
    frontMap: mapSide("FRONT"),
    backMap: mapSide("BACK"),
    mapSchemaVersion: SPEEDSTER_MAP_SCHEMA_VERSION,
    filterPolicyVersion: SPEEDSTER_MAP_FILTER_POLICY_VERSION,
    supersedesRevisionId: null,
    ...patch,
  };
}

function familyPayload(patch: Partial<SpeedsterMapRevisionHashPayload> = {}): SpeedsterMapRevisionHashPayload {
  const matchKey = speedsterFamilyCardTypeMapKey("SPORTS", identity);
  return payload({
    mapId: "family-map-1",
    matchKeyHash: speedsterMapMatchKeyHash(matchKey),
    matchKey,
    normalizedIdentity: matchKey,
    ...patch,
  });
}

function record(source = payload()) {
  return {
    id: `revision-${source.version}`,
    ...source,
    revisionHash: speedsterMapRevisionHash(source),
    createdAt: new Date("2026-08-10T20:00:00.000Z"),
  };
}

function captureRecord(workflowState: "CAPTURED" | "COMPLETED") {
  const side = (name: "front" | "back") => ({
    originalStorageKey: `ai-grader-v2/admin-1/${SESSION_ID}/original/${name}.jpg`,
    rectifiedStorageKey: `ai-grader-v2/admin-1/${SESSION_ID}/prepared/${name}/rectified.webp`,
    inspectionStorageKey: `ai-grader-v2/admin-1/${SESSION_ID}/prepared/${name}/inspection.webp`,
    sourceCorners: quad,
    centeringQuad: quad,
    centeringBorders: { leftMm: 6, rightMm: 6, topMm: 8, bottomMm: 8 },
    inspectionFrame: { width: 1350, height: 1858, cardBounds: { x: 40, y: 40, width: 1270, height: 1778 } },
    transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    viewStorageKeys: {
      NORMALIZED: `ai-grader-v2/admin-1/${SESSION_ID}/prepared/${name}/normalized.webp`,
      MICRO_DEFECT: `ai-grader-v2/admin-1/${SESSION_ID}/prepared/${name}/micro_defect.webp`,
      DIRECTIONAL: `ai-grader-v2/admin-1/${SESSION_ID}/prepared/${name}/directional.webp`,
    },
  });
  return {
    id: SESSION_ID,
    createdByUserId: "admin-1",
    cardProfile: "SPORTS",
    workflowState,
    identity,
    capture: { cornerShape: "ROUNDED_3_18_MM", front: side("front"), back: side("back") },
    reviewedDefects: workflowState === "CAPTURED" ? [] : [{ id: "completed-finding" }],
    gradeReport: workflowState === "CAPTURED" ? {} : { overall: 9.7 },
    mapFilterDecisions: [],
  };
}

function request(method: string, action: string, body?: unknown): NextApiRequest {
  return { method, body, query: { action: [action] }, headers: {} } as unknown as NextApiRequest;
}

function response() {
  const state: { status?: number; body?: unknown; headers: Record<string, string> } = { headers: {} };
  const res = {
    setHeader(name: string, value: string) { state.headers[name] = value; return this; },
    status(code: number) { state.status = code; return this; },
    json(body: unknown) { state.body = body; return this; },
  } as unknown as NextApiResponse;
  return { state, res };
}

type RecordingTransaction = Parameters<Parameters<SpeedsterMapTransactionRunner>[0]>[0];

function recordingMapTransaction(seed?: Readonly<{
  map?: Record<string, unknown>;
  exactMap?: Record<string, unknown>;
  corruptPersistedRevision?: boolean;
  session?: Readonly<{
    workflowState: string;
    reviewedDefects: unknown;
    gradeReport: unknown;
    mapRevisionId?: string | null;
    mapFilterDecisions: readonly Readonly<{ id: string }>[];
  }>;
}>) {
  const operations: string[] = [];
  const writes = {
    mapCreate: 0,
    revisionCreate: 0,
    currentPointer: 0,
    session: 0,
    label: 0,
    card: 0,
    report: 0,
    memory: 0,
  };
  let committedMap: Record<string, unknown> | null = seed?.map ? structuredClone(seed.map) : null;
  let committedExactMap: Record<string, unknown> | null = seed?.exactMap ? structuredClone(seed.exactMap) : null;
  let committedRevision: Record<string, unknown> | null = null;
  let committedSessionData: Record<string, unknown> | null = null;
  const currentSession = seed?.session ?? {
    workflowState: "CAPTURED",
    reviewedDefects: [],
    gradeReport: {},
    mapRevisionId: null,
    mapFilterDecisions: [],
  };
  let transactionCount = 0;

  const transaction: SpeedsterMapTransactionRunner = async (operation) => {
    transactionCount += 1;
    operations.push("transaction.begin");
    let workingMap = committedMap ? structuredClone(committedMap) : null;
    const workingExactMap = committedExactMap ? structuredClone(committedExactMap) : null;
    let workingRevision = committedRevision ? structuredClone(committedRevision) : null;
    let workingSessionData = committedSessionData ? structuredClone(committedSessionData) : null;
    const delegates = {
      async $queryRaw(..._args: unknown[]) {
        operations.push("session.lock");
        return [{ id: SESSION_ID }];
      },
      async $executeRaw(..._args: unknown[]) {
        operations.push("map.lock");
        return 1;
      },
      aiGraderV2CardTypeMap: {
        async findUnique(args: unknown) {
          operations.push("map.findUnique");
          const requestedHash = (args as { where?: { matchKeyHash?: string } }).where?.matchKeyHash;
          if (requestedHash && workingExactMap?.matchKeyHash === requestedHash) return workingExactMap;
          if (requestedHash && workingMap?.matchKeyHash !== requestedHash) return null;
          return workingMap;
        },
        async create(args: unknown) {
          operations.push("map.create");
          writes.mapCreate += 1;
          const data = (args as { data: Record<string, unknown> }).data;
          workingMap = { id: "map-created", ...data, currentRevision: null, currentRevisionId: null };
          return workingMap;
        },
        async update(args: unknown) {
          operations.push("map.updateCurrent");
          writes.currentPointer += 1;
          const data = (args as { data: Record<string, unknown> }).data;
          workingMap = { ...workingMap, ...data };
          return workingMap;
        },
      },
      aiGraderV2CardTypeMapRevision: {
        async create(args: unknown) {
          operations.push("revision.create");
          writes.revisionCreate += 1;
          const data = (args as { data: Record<string, unknown> }).data;
          workingRevision = {
            id: "revision-created",
            ...data,
            createdAt: new Date("2026-08-10T20:00:00.000Z"),
          };
          return workingRevision;
        },
        async findUnique() {
          operations.push("revision.findUnique");
          return seed?.corruptPersistedRevision && workingRevision
            ? { ...workingRevision, authorAdminId: "persisted-other-admin" }
            : workingRevision;
        },
      },
      aiGraderV2Session: {
        async findFirst() {
          operations.push("session.findWritable");
          return structuredClone(currentSession);
        },
        async updateMany(args: unknown) {
          operations.push("session.updateMany");
          writes.session += 1;
          workingSessionData = structuredClone((args as { data: Record<string, unknown> }).data);
          return { count: 1 };
        },
      },
    };
    const tx = new Proxy(delegates, {
      get(target, property, receiver) {
        if (typeof property === "string" && !(property in target)) {
          if (/label/i.test(property)) writes.label += 1;
          else if (/card/i.test(property)) writes.card += 1;
          else if (/report/i.test(property)) writes.report += 1;
          else if (/memory/i.test(property)) writes.memory += 1;
          throw new Error(`Unexpected authority delegate access: ${property}`);
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const result = await operation(tx as unknown as RecordingTransaction);
    committedMap = workingMap;
    committedExactMap = workingExactMap;
    committedRevision = workingRevision;
    committedSessionData = workingSessionData;
    operations.push("transaction.commit");
    return result;
  };

  return {
    transaction,
    operations,
    writes,
    transactionCount: () => transactionCount,
    committed: () => ({
      map: committedMap,
      revision: committedRevision,
      sessionData: committedSessionData,
    }),
  };
}

const trainingSide = {
  designBoundary: { kind: "QUAD" as const, points: quad },
  anchors,
  zones,
};
const v2TrainingSide = {
  ...trainingSide,
  zones: zones.map((zone) => ({
    ...zone,
    contentType: "HEADER" as const,
    filterAuthority: true,
    filterAuthoritySource: "TYPE_DEFAULT" as const,
    filterPaddingMm: 0.6 as const,
    proposalSource: "HUMAN" as const,
    proposalConfidence: null,
  })),
};

function dualMapTransaction(options: Readonly<{
  failScope?: "FAMILY" | "EXACT";
  corruptScope?: "FAMILY" | "EXACT";
  familyCurrent?: Readonly<{ id: string; version: number }>;
}> = {}) {
  type MapRow = Record<string, unknown> & { id: string; matchKeyHash: string; currentRevision: { id: string; version: number } | null };
  let committedMaps = new Map<string, MapRow>();
  let committedRevisions = new Map<string, Record<string, unknown>>();
  let committedSession: Record<string, unknown> | null = null;
  let transactionCount = 0;
  let rolledBack = 0;
  const transaction: SpeedsterMapTransactionRunner = async (operation) => {
    transactionCount += 1;
    const maps = new Map([...committedMaps].map(([key, value]) => [key, structuredClone(value)]));
    const revisions = new Map([...committedRevisions].map(([key, value]) => [key, structuredClone(value)]));
    let session = committedSession ? structuredClone(committedSession) : null;
    let mapSequence = maps.size;
    let revisionSequence = revisions.size;
    const scopeOf = (value: Record<string, unknown>) => (
      (value.matchKey as { scope?: string }).scope === "FAMILY" ? "FAMILY" : "EXACT"
    ) as "FAMILY" | "EXACT";
    const tx = {
      async $queryRaw() { return [{ id: SESSION_ID }]; },
      async $executeRaw() { return 1; },
      aiGraderV2Session: {
        async findFirst() {
          return {
            workflowState: "CAPTURED",
            reviewedDefects: [],
            gradeReport: {},
            mapRevisionId: null,
            mapFilterDecisions: [],
          };
        },
        async updateMany(args: unknown) {
          session = structuredClone((args as { data: Record<string, unknown> }).data);
          return { count: 1 };
        },
      },
      aiGraderV2CardTypeMap: {
        async findUnique(args: unknown) {
          const hash = (args as { where: { matchKeyHash: string } }).where.matchKeyHash;
          let found = maps.get(hash) ?? null;
          if (!found && options.familyCurrent && maps.size === 0) {
            found = {
              id: "existing-family-map",
              matchKeyHash: hash,
              cardProfile: "SPORTS",
              currentRevisionId: options.familyCurrent.id,
              currentRevision: options.familyCurrent,
            };
            maps.set(hash, found);
          }
          return found;
        },
        async create(args: unknown) {
          const data = (args as { data: Record<string, unknown> }).data;
          mapSequence += 1;
          const row: MapRow = {
            id: `dual-map-${mapSequence}`,
            ...data,
            matchKeyHash: data.matchKeyHash as string,
            currentRevisionId: null,
            currentRevision: null,
          };
          maps.set(row.matchKeyHash, row);
          return row;
        },
        async update(args: unknown) {
          const { where, data } = args as { where: { id: string }; data: { currentRevisionId: string } };
          const row = [...maps.values()].find((candidate) => candidate.id === where.id)!;
          const revision = revisions.get(data.currentRevisionId)!;
          const next = {
            ...row,
            currentRevisionId: data.currentRevisionId,
            currentRevision: { id: data.currentRevisionId, version: revision.version as number },
          };
          maps.set(next.matchKeyHash, next);
          return next;
        },
      },
      aiGraderV2CardTypeMapRevision: {
        async create(args: unknown) {
          const data = structuredClone((args as { data: Record<string, unknown> }).data);
          const scope = scopeOf(data);
          if (options.failScope === scope) throw new Error(`injected ${scope} revision failure`);
          revisionSequence += 1;
          const id = (data.id as string | undefined) ?? `dual-revision-${revisionSequence}`;
          const row = { id, ...data, createdAt: new Date("2026-08-11T20:00:00.000Z") };
          revisions.set(id, row);
          return { id };
        },
        async findUnique(args: unknown) {
          const id = (args as { where: { id: string } }).where.id;
          const row = revisions.get(id);
          if (!row) return null;
          if (options.corruptScope === scopeOf(row)) {
            return { ...structuredClone(row), authorAdminId: "persisted-other-admin" };
          }
          return structuredClone(row);
        },
      },
    };
    try {
      const result = await operation(tx as unknown as RecordingTransaction);
      committedMaps = maps;
      committedRevisions = revisions;
      committedSession = session;
      return result;
    } catch (error) {
      rolledBack += 1;
      throw error;
    }
  };
  return {
    transaction,
    state: () => ({
      maps: [...committedMaps.values()],
      revisions: [...committedRevisions.values()],
      session: committedSession,
      transactionCount,
      rolledBack,
    }),
  };
}

test("revision hashing is deterministic, canonical, and rejects any immutable-field change", () => {
  const first = payload();
  const reordered = JSON.parse(JSON.stringify(first)) as SpeedsterMapRevisionHashPayload;
  assert.equal(canonicalSpeedsterMapRevisionPayload(first), canonicalSpeedsterMapRevisionPayload(reordered));
  assert.equal(speedsterMapRevisionHash(first), speedsterMapRevisionHash(reordered));
  assert.notEqual(speedsterMapRevisionHash(first), speedsterMapRevisionHash({ ...first, version: 2 }));
  assert.notEqual(speedsterMapRevisionHash(first), speedsterMapRevisionHash({ ...first, authorAdminId: "admin-2" }));

  const valid = record(first);
  assert.equal(validateSpeedsterLoadedMapRevision(valid).revisionHash, valid.revisionHash);
  assert.throws(
    () => validateSpeedsterLoadedMapRevision({ ...valid, frontMap: { ...valid.frontMap, zones: [] } }),
    SpeedsterMapIntegrityError,
  );

  const negativeZero = payload({
    frontMap: {
      ...first.frontMap,
      anchors: first.frontMap.anchors.map((anchor, index) => index === 0
        ? { ...anchor, point: { x: -0, y: anchor.point.y } }
        : anchor),
    },
  });
  const normalized = normalizedSpeedsterMapRevisionPayload(negativeZero);
  assert.equal(Object.is(normalized.frontMap.anchors[0].point.x, -0), false);
  assert.equal(speedsterMapRevisionHash(negativeZero), speedsterMapRevisionHash(normalized));

  // Production Prisma JSON transport rounded this recovered anchor from
  // 0.11073133680555555 to 0.1107313368055556 during revision persistence.
  // New revisions quantize before both hashing and insertion so read-back is
  // deterministic while the legacy hash algorithm itself stays unchanged.
  const productionPrecision = payload({
    backMap: {
      ...first.backMap,
      anchors: first.backMap.anchors.map((anchor, index) => index === 3
        ? { ...anchor, point: { x: 0.11073133680555555, y: anchor.point.y } }
        : anchor),
    },
  });
  const persistenceNormalized = normalizedSpeedsterMapRevisionPayload(productionPrecision);
  assert.equal(persistenceNormalized.backMap.anchors[3].point.x, 0.110731336806);
  assert.notEqual(speedsterMapRevisionHash(productionPrecision), speedsterMapRevisionHash(persistenceNormalized));
  assert.equal(
    validateSpeedsterLoadedMapRevision(record(persistenceNormalized)).revisionHash,
    speedsterMapRevisionHash(persistenceNormalized),
  );
});

test("legacy exact map key serialization and hash remain byte-for-byte compatible", () => {
  const sportsKey = speedsterCardTypeMapKey("SPORTS", identity);
  assert.equal(
    JSON.stringify(sportsKey),
    '{"category":"SPORTS","year":"2021","manufacturer":"panini","productSet":"obsidian","insert":null,"parallel":"orange","playerName":"nick bosa","cardNumber":"12"}',
  );
  assert.equal(speedsterMapMatchKeyHash(sportsKey), "416907b9c72bf6e81ff4236a15cb8c645e2020bdd4e900d7fc8e0d7f595ebdb7");

  const pokemonKey = speedsterCardTypeMapKey("POKEMON", {
    cardName: "cubone",
    year: "1999 pokemon",
    productSet: "jungle",
    parallel: null,
    cardNumber: "50/64",
  });
  assert.equal(
    JSON.stringify(pokemonKey),
    '{"category":"POKEMON","year":"1999 pokemon","productSet":"jungle","parallel":null,"cardName":"cubone","cardNumber":"50/64"}',
  );
  assert.equal(speedsterMapMatchKeyHash(pokemonKey), "271543b80a268722b81e819daa1a97caccf0bbb8c954746a9fd04b94a06302ff");
});

test("map parsing rejects collapsed boundaries, singular anchors, and invalid zone polygons", () => {
  const base = payload();
  const invalidFrontMaps = [
    {
      ...base.frontMap,
      designBoundary: { kind: "QUAD" as const, points: [quad[0], quad[0], quad[0], quad[0]] as unknown as typeof quad },
    },
    {
      ...base.frontMap,
      anchors: base.frontMap.anchors.map((anchor) => ({ ...anchor, point: { x: 0.5, y: 0.5 } })),
    },
    {
      ...base.frontMap,
      zones: [{ ...base.frontMap.zones[0], polygon: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }, { x: 0.9, y: 0.9 }] }],
    },
    {
      ...base.frontMap,
      zones: [{
        ...base.frontMap.zones[0],
        polygon: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }, { x: 0.9, y: 0.1 }],
      }],
    },
  ];
  for (const frontMap of invalidFrontMaps) {
    assert.throws(
      () => validateSpeedsterLoadedMapRevision(record({ ...base, frontMap } as SpeedsterMapRevisionHashPayload)),
      SpeedsterMapIntegrityError,
    );
  }
  const concave = {
    ...base,
    frontMap: {
      ...base.frontMap,
      zones: [{
        ...base.frontMap.zones[0],
        polygon: [
          { x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 },
          { x: 0.6, y: 0.9 }, { x: 0.6, y: 0.4 }, { x: 0.4, y: 0.4 },
          { x: 0.4, y: 0.9 }, { x: 0.1, y: 0.9 },
        ],
      }],
    },
  };
  assert.equal(validateSpeedsterLoadedMapRevision(record(concave)).frontMap.zones[0].polygon.length, 8);
});

test("exact active and pinned loaders never guess another key or revision", async () => {
  const revision = record();
  const exact = await loadExactActiveSpeedsterMapRevision({ cardProfile: "SPORTS", identity }, {
    async findActiveMap(matchKeyHash) {
      return { id: "map-1", matchKeyHash, currentRevisionId: revision.id, currentRevision: revision };
    },
    async findPinnedRevision() { return revision; },
  });
  assert.equal(exact?.revisionId, revision.id);

  const missing = await loadExactActiveSpeedsterMapRevision({ cardProfile: "SPORTS", identity }, {
    async findActiveMap() { return null; },
    async findPinnedRevision() { return null; },
  });
  assert.equal(missing, null);

  await assert.rejects(
    loadPinnedSpeedsterMapRevision({ sessionId: SESSION_ID, mapRevisionId: "wrong-revision" }, {
      async findActiveMap() { return null; },
      async findPinnedRevision() { return revision; },
    }),
    /does not match the pinned revision/,
  );
  await assert.rejects(
    loadExactActiveSpeedsterMapRevision({ cardProfile: "SPORTS", identity }, {
      async findActiveMap(matchKeyHash) {
        return { id: "map-1", matchKeyHash, currentRevisionId: "wrong", currentRevision: revision };
      },
      async findPinnedRevision() { return null; },
    }),
    /active-revision relationship is invalid/,
  );
});

test("effective lookup uses one query and deterministically selects exact before family", async () => {
  const exact = record(payload({ mapId: "exact-map" }));
  const family = record(familyPayload({ mapId: "family-map" }));
  let calls = 0;
  const applied = await loadEffectiveActiveSpeedsterMapRevision({ cardProfile: "SPORTS", identity }, {
    async findActiveMap() { throw new Error("single-map lookup must not run"); },
    async findActiveMaps(hashes) {
      calls += 1;
      assert.equal(hashes.length, 2);
      return [family, exact].map((revision) => ({
        id: revision.mapId,
        matchKeyHash: revision.matchKeyHash,
        currentRevisionId: revision.id,
        currentRevision: revision,
      }));
    },
    async findPinnedRevision() { return null; },
  });
  assert.equal(calls, 1);
  assert.equal(applied?.appliedScope, "EXACT");
  assert.equal(applied?.revision.mapId, "exact-map");
  assert.equal(applied?.sourceProvenance.sourceSessionId, SESSION_ID);
  assert.equal(applied?.appliedMapName, "2021 · Panini · Obsidian · Orange · Nick Bosa · #12");
});

test("effective lookup selects family for another subject and returns null when neither key exists", async () => {
  const family = record(familyPayload({ mapId: "family-map" }));
  const sibling = { ...identity, playerName: "Brock Purdy", cardNumber: "13" };
  const applied = await loadEffectiveActiveSpeedsterMapRevision({ cardProfile: "SPORTS", identity: sibling }, {
    async findActiveMap() { return null; },
    async findActiveMaps() {
      return [{
        id: family.mapId,
        matchKeyHash: family.matchKeyHash,
        currentRevisionId: family.id,
        currentRevision: family,
      }];
    },
    async findPinnedRevision() { return null; },
  });
  assert.equal(applied?.appliedScope, "FAMILY");
  assert.equal(applied?.appliedMapName, "2021 · Panini · Obsidian · Orange");
  assert.doesNotThrow(() => assertSpeedsterMapRevisionAppliesToIdentity(applied!.revision, {
    cardProfile: "SPORTS",
    identity: sibling,
  }));
  assert.throws(() => assertSpeedsterMapRevisionAppliesToIdentity(validateSpeedsterLoadedMapRevision(record()), {
    cardProfile: "SPORTS",
    identity: sibling,
  }), /does not apply/);

  const missing = await loadEffectiveActiveSpeedsterMapRevision({ cardProfile: "SPORTS", identity: sibling }, {
    async findActiveMap() { return null; },
    async findActiveMaps() { return []; },
    async findPinnedRevision() { return null; },
  });
  assert.equal(missing, null);
  assert.equal(speedsterMapDisplayName("FAMILY", "SPORTS", sibling), "2021 · Panini · Obsidian · Orange");
});

test("effective lookup never falls through from a malformed exact override to a valid family map", async () => {
  const exact = record(payload({ mapId: "exact-map" }));
  const malformedExact = { ...exact, revisionHash: sha("malformed-exact") };
  const family = record(familyPayload({ mapId: "family-map" }));
  await assert.rejects(loadEffectiveActiveSpeedsterMapRevision({ cardProfile: "SPORTS", identity }, {
    async findActiveMap() { throw new Error("single-map lookup must not run"); },
    async findActiveMaps() {
      return [malformedExact, family].map((revision) => ({
        id: revision.mapId,
        matchKeyHash: revision.matchKeyHash,
        currentRevisionId: revision.id,
        currentRevision: revision,
      }));
    },
    async findPinnedRevision() { return null; },
  }), /hash verification failed/);
});

test("registered saved human boundaries drive unchanged current-copy borders, ratios, and centering grade", () => {
  const savedHumanBoundary = [
    { x: 0.1, y: 0.1 },
    { x: 0.9, y: 0.1 },
    { x: 0.9, y: 0.9 },
    { x: 0.1, y: 0.9 },
  ] as const;
  const copyOneProjectedBoundary = savedHumanBoundary.map((point) => ({ ...point })) as unknown as typeof quad;
  const copyTwoProjectedBoundary = savedHumanBoundary.map((point) => ({
    x: point.x + 0.05,
    y: point.y,
  })) as unknown as typeof quad;
  const copyOneBorders = measureSpeedsterCenteringBorders(copyOneProjectedBoundary);
  const copyTwoBorders = measureSpeedsterCenteringBorders(copyTwoProjectedBoundary);
  assert.deepEqual(savedHumanBoundary, [
    { x: 0.1, y: 0.1 },
    { x: 0.9, y: 0.1 },
    { x: 0.9, y: 0.9 },
    { x: 0.1, y: 0.9 },
  ]);
  assert.ok(Math.abs(copyOneBorders.leftMm - 6.35) < 1e-12);
  assert.ok(Math.abs(copyOneBorders.rightMm - 6.35) < 1e-12);
  assert.ok(Math.abs(copyOneBorders.topMm - 8.89) < 1e-12);
  assert.ok(Math.abs(copyOneBorders.bottomMm - 8.89) < 1e-12);
  assert.deepEqual(calculateCenteringBalance(copyOneBorders.leftMm, copyOneBorders.rightMm), [50, 50]);
  assert.equal(calculateCenteringScore(copyOneBorders), 10);
  assert.ok(Math.abs(copyTwoBorders.leftMm - 9.525) < 1e-12);
  assert.ok(Math.abs(copyTwoBorders.rightMm - 3.175) < 1e-12);
  assert.deepEqual(calculateCenteringBalance(copyTwoBorders.leftMm, copyTwoBorders.rightMm), [75, 25]);
  assert.equal(calculateCenteringScore(copyTwoBorders), 6);
  assert.notDeepEqual(copyTwoBorders, copyOneBorders);
});

test("one authoring operation atomically creates independently verified FAMILY and EXACT revisions", async () => {
  const source = parseSpeedsterMapSourceSession(captureRecord("COMPLETED"));
  const harness = dualMapTransaction();
  const saved = await saveSpeedsterFamilyAndExactMapRevisions({
    source,
    authorAdminId: "admin-1",
    front: trainingSide,
    back: trainingSide,
    hashEvidence: async (storageKey) => sha(storageKey),
    transaction: harness.transaction,
  });
  const state = harness.state();
  assert.equal(state.transactionCount, 1);
  assert.equal(state.rolledBack, 0);
  assert.equal(state.maps.length, 2);
  assert.equal(state.revisions.length, 2);
  assert.equal("scope" in saved.family.revision.matchKey ? saved.family.revision.matchKey.scope : null, "FAMILY");
  assert.equal("scope" in saved.exact.revision.matchKey, false);
  assert.notEqual(saved.family.mapId, saved.exact.mapId);
  assert.notEqual(saved.family.revision.revisionId, saved.exact.revision.revisionId);
  assert.notEqual(saved.family.revision.revisionHash, saved.exact.revision.revisionHash);
  assert.deepEqual(saved.family.revision.frontMap, saved.exact.revision.frontMap);
  assert.deepEqual(saved.family.revision.backMap, saved.exact.revision.backMap);
  assert.deepEqual(saved.family.revision.displayIdentity, identity);
  assert.deepEqual(saved.exact.revision.displayIdentity, identity);
  assert.equal(saved.family.revision.sourceSessionId, SESSION_ID);
  assert.equal(saved.exact.revision.sourceSessionId, SESSION_ID);
  for (const result of [saved.family, saved.exact]) {
    const { revisionId: _revisionId, revisionHash, createdAt: _createdAt, ...hashPayload } = result.revision;
    assert.equal(revisionHash, speedsterMapRevisionHash(hashPayload));
  }
});

test("owner-authorized v2 authoring keeps replay pending and hashes both explicit authority revisions independently", async () => {
  const source = parseSpeedsterMapSourceSession(captureRecord("COMPLETED"));
  const harness = dualMapTransaction();
  const saved = await saveSpeedsterFamilyAndExactMapRevisions({
    source,
    authorAdminId: "admin-1",
    front: v2TrainingSide,
    back: v2TrainingSide,
    hashEvidence: async (storageKey) => sha(storageKey),
    transaction: harness.transaction,
  });
  assert.equal(SPEEDSTER_MAP_FILTER_V2_ACTIVATION_AUTHORITY, "OWNER_WAIVER_2026_08_12");
  assert.equal(SPEEDSTER_MAP_FILTER_V2_VERIFICATION_STATUS, "defect filter verification: PENDING");
  assert.equal(harness.state().transactionCount, 1);
  assert.equal(harness.state().revisions.length, 2);
  assert.equal(harness.state().maps.every((map) => Boolean(map.currentRevisionId)), true);
  assert.equal(saved.family.revision.mapSchemaVersion, SPEEDSTER_MAP_SCHEMA_VERSION_V2);
  assert.equal(saved.exact.revision.filterPolicyVersion, SPEEDSTER_MAP_FILTER_POLICY_VERSION_V2);
  assert.notEqual(saved.family.revision.revisionHash, saved.exact.revision.revisionHash);
  assert.deepEqual(saved.family.revision.frontMap.zones, v2TrainingSide.zones.map((zone) => ({
    ...zone,
    polygon: zone.polygon.map((point) => ({ ...point })),
  })));
  for (const result of [saved.family, saved.exact]) {
    const { revisionId: _revisionId, revisionHash, createdAt: _createdAt, ...hashPayload } = result.revision;
    assert.equal(revisionHash, speedsterMapRevisionHash(hashPayload));
  }
});

test("v2 activation authorization failure occurs before evidence hashing or any transaction write", async () => {
  const source = parseSpeedsterMapSourceSession(captureRecord("COMPLETED"));
  const harness = dualMapTransaction();
  let evidenceReads = 0;
  await assert.rejects(saveSpeedsterFamilyAndExactMapRevisions({
    source,
    authorAdminId: "admin-1",
    front: v2TrainingSide,
    back: v2TrainingSide,
    async hashEvidence(storageKey) {
      evidenceReads += 1;
      return sha(storageKey);
    },
    transaction: harness.transaction,
    v2ActivationGate() {
      throw new SpeedsterMapIntegrityError("injected missing activation authority", { stage: "VALIDATION" });
    },
  }), /injected missing activation authority/);
  assert.equal(evidenceReads, 0);
  assert.equal(harness.state().transactionCount, 0);
  assert.equal(harness.state().maps.length, 0);
  assert.equal(harness.state().revisions.length, 0);
});

test("dual authoring rolls back both maps when either revision create or persisted hash verification fails", async () => {
  const source = parseSpeedsterMapSourceSession(captureRecord("COMPLETED"));
  for (const harness of [
    dualMapTransaction({ failScope: "FAMILY" }),
    dualMapTransaction({ corruptScope: "FAMILY" }),
    dualMapTransaction({ failScope: "EXACT" }),
    dualMapTransaction({ corruptScope: "EXACT" }),
  ]) {
    await assert.rejects(saveSpeedsterFamilyAndExactMapRevisions({
      source,
      authorAdminId: "admin-1",
      front: trainingSide,
      back: trainingSide,
      hashEvidence: async (storageKey) => sha(storageKey),
      transaction: harness.transaction,
    }));
    assert.deepEqual(harness.state(), {
      maps: [],
      revisions: [],
      session: null,
      transactionCount: 1,
      rolledBack: 1,
    });
  }
});

test("captured dual authoring pins both Front and Back registrations to the new EXACT revision", async () => {
  const source = parseSpeedsterMapSourceSession(captureRecord("CAPTURED"));
  const harness = dualMapTransaction();
  const saved = await saveSpeedsterFamilyAndExactMapRevisions({
    source,
    authorAdminId: "admin-1",
    front: trainingSide,
    back: trainingSide,
    hashEvidence: async (storageKey) => sha(storageKey),
    transaction: harness.transaction,
  });
  const session = harness.state().session as {
    mapRevisionId: string;
    mapRegistration: { front: { mapRevisionId: string }; back: { mapRevisionId: string } };
  };
  assert.equal(session.mapRevisionId, saved.exact.revision.revisionId);
  assert.equal(session.mapRegistration.front.mapRevisionId, saved.exact.revision.revisionId);
  assert.equal(session.mapRegistration.back.mapRevisionId, saved.exact.revision.revisionId);
  assert.notEqual(session.mapRevisionId, saved.family.revision.revisionId);
});

test("dual authoring recovers append-only from an invalid historical FAMILY pointer without rewriting it", async () => {
  const source = parseSpeedsterMapSourceSession(captureRecord("COMPLETED"));
  const harness = dualMapTransaction({ familyCurrent: { id: "invalid-family-revision-v4", version: 4 } });
  const saved = await saveSpeedsterFamilyAndExactMapRevisions({
    source,
    authorAdminId: "admin-1",
    front: trainingSide,
    back: trainingSide,
    hashEvidence: async (storageKey) => sha(storageKey),
    transaction: harness.transaction,
  });
  assert.equal(saved.family.revision.version, 5);
  assert.equal(saved.family.revision.supersedesRevisionId, "invalid-family-revision-v4");
  assert.equal(saved.exact.revision.version, 1);
  assert.equal(saved.exact.revision.supersedesRevisionId, null);
});

test("new-card save invokes one production transaction for revision, current pointer, and exact captured-session pin", async () => {
  const source = parseSpeedsterMapSourceSession(captureRecord("CAPTURED"));
  const harness = recordingMapTransaction();
  const saved = await saveSpeedsterCardTypeMapRevision({
    source,
    authorAdminId: "admin-1",
    front: trainingSide,
    back: trainingSide,
    hashEvidence: async (storageKey) => sha(storageKey),
    transaction: harness.transaction,
  });
  const committed = harness.committed();
  const sessionData = committed.sessionData as {
    mapRevisionId: string;
    mapFilterPolicyVersion: string;
    mapRegistration: { front: ReturnType<typeof speedsterIdentityMapRegistration>; back: ReturnType<typeof speedsterIdentityMapRegistration> };
  };
  const front = sessionData.mapRegistration.front;
  const back = sessionData.mapRegistration.back;
  assert.equal(saved.revision.revisionId, "revision-created");
  assert.equal(harness.transactionCount(), 1);
  assert.deepEqual(harness.operations, [
    "transaction.begin",
    "session.lock",
    "session.findWritable",
    "map.lock",
    "map.findUnique",
    "map.create",
    "revision.create",
    "revision.findUnique",
    "map.updateCurrent",
    "session.updateMany",
    "transaction.commit",
  ]);
  assert.deepEqual(harness.writes, {
    mapCreate: 1,
    revisionCreate: 1,
    currentPointer: 1,
    session: 1,
    label: 0,
    card: 0,
    report: 0,
    memory: 0,
  });
  assert.equal((committed.map as { currentRevisionId: string }).currentRevisionId, saved.revision.revisionId);
  assert.equal(sessionData.mapRevisionId, saved.revision.revisionId);
  assert.equal(sessionData.mapFilterPolicyVersion, SPEEDSTER_MAP_FILTER_POLICY_VERSION);
  assert.equal(front.mapRevisionId, saved.revision.revisionId);
  assert.equal(back.mapRevisionId, saved.revision.revisionId);
  assert.deepEqual(front.homography, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  assert.deepEqual(front.projectedDesignBoundary, saved.revision.frontMap.designBoundary);
  assert.deepEqual(front.projectedZones, saved.revision.frontMap.zones);
  assert.equal(front.currentInspectionSha256, saved.revision.frontMap.referenceInspection.sha256);
});

test("completed-card production save writes only map state and preserves authority hashes and updatedAt", async () => {
  const completed = captureRecord("COMPLETED");
  const authority = {
    session: {
      ...completed,
      updatedAt: "2026-08-10T19:00:00.000Z",
      reviewedDefects: [{ id: "kept" }],
      gradeReport: { overall: 9.7 },
    },
    label: { certificateNumber: "TKH-000777", grade: "9.7" },
    card: { id: "card-1", publicToken: "tk2c_exact", gradeSnapshot: { overall: 9.7 } },
    memory: { id: "GLOBAL", state: { replayCursor: 777 } },
  };
  const before = sha(JSON.stringify(authority));
  const harness = recordingMapTransaction();
  const saved = await saveSpeedsterCardTypeMapRevision({
    source: parseSpeedsterMapSourceSession(authority.session),
    authorAdminId: "admin-2",
    front: trainingSide,
    back: trainingSide,
    hashEvidence: async (storageKey) => sha(storageKey),
    transaction: harness.transaction,
  });
  assert.equal(saved.revision.revisionId, "revision-created");
  assert.equal(harness.transactionCount(), 1);
  assert.deepEqual(harness.operations, [
    "transaction.begin",
    "map.lock",
    "map.findUnique",
    "map.create",
    "revision.create",
    "revision.findUnique",
    "map.updateCurrent",
    "transaction.commit",
  ]);
  assert.deepEqual(harness.writes, {
    mapCreate: 1,
    revisionCreate: 1,
    currentPointer: 1,
    session: 0,
    label: 0,
    card: 0,
    report: 0,
    memory: 0,
  });
  assert.equal(harness.committed().sessionData, null);
  assert.equal(sha(JSON.stringify(authority)), before);
  assert.equal(authority.session.updatedAt, "2026-08-10T19:00:00.000Z");
});

test("family save omits subject identity from the key while retaining exact source provenance and imagery", async () => {
  const source = parseSpeedsterMapSourceSession(captureRecord("COMPLETED"));
  const harness = recordingMapTransaction();
  const saved = await saveSpeedsterCardTypeMapRevision({
    source,
    authorAdminId: "admin-1",
    scope: "FAMILY",
    front: trainingSide,
    back: trainingSide,
    hashEvidence: async (storageKey) => sha(storageKey),
    transaction: harness.transaction,
  });
  assert.deepEqual(saved.revision.matchKey, speedsterFamilyCardTypeMapKey("SPORTS", identity));
  assert.deepEqual(saved.revision.normalizedIdentity, saved.revision.matchKey);
  assert.deepEqual(saved.revision.displayIdentity, identity);
  assert.equal(saved.revision.sourceSessionId, SESSION_ID);
  assert.equal(saved.revision.frontMap.referenceInspection.storageKey, source.front.inspectionStorageKey);
  assert.equal(saved.revision.backMap.referenceInspection.storageKey, source.back.inspectionStorageKey);
});

test("captured family save never replaces an active exact override pin", async () => {
  const source = parseSpeedsterMapSourceSession(captureRecord("CAPTURED"));
  const exact = record();
  const harness = recordingMapTransaction({
    exactMap: {
      id: exact.mapId,
      matchKeyHash: exact.matchKeyHash,
      cardProfile: "SPORTS",
      currentRevisionId: exact.id,
      currentRevision: { id: exact.id, version: exact.version },
    },
    session: {
      workflowState: "CAPTURED",
      reviewedDefects: [],
      gradeReport: {},
      mapRevisionId: "old-family-revision",
      mapFilterDecisions: [],
    },
  });
  const saved = await saveSpeedsterCardTypeMapRevision({
    source,
    authorAdminId: "admin-1",
    scope: "FAMILY",
    front: trainingSide,
    back: trainingSide,
    hashEvidence: async (storageKey) => sha(storageKey),
    transaction: harness.transaction,
  });
  assert.deepEqual(saved.revision.matchKey, speedsterFamilyCardTypeMapKey("SPORTS", identity));
  assert.equal(harness.writes.revisionCreate, 1);
  assert.equal(harness.writes.currentPointer, 1);
  assert.equal(harness.writes.session, 1);
  const cleared = harness.committed().sessionData as Record<string, unknown>;
  assert.equal(cleared.mapRevisionId, null);
  assert.equal(cleared.mapFilterPolicyVersion, null);
  assert.ok("mapRegistration" in cleared);
});

test("restore rejects revisions from another scope before opening a transaction", async () => {
  const source = parseSpeedsterMapSourceSession(captureRecord("COMPLETED"));
  const exact = record();
  const harness = recordingMapTransaction();
  await assert.rejects(restoreSpeedsterCardTypeMapRevision({
    source,
    scope: "FAMILY",
    targetRevisionId: exact.id,
    authorAdminId: "admin-1",
    transaction: harness.transaction,
    async findTargetRevision() { return exact; },
  }), /not a revision of this scoped card-type map/);
  assert.equal(harness.transactionCount(), 0);
});

test("captured family restore keeps an active exact override and skips family registration", async () => {
  const source = parseSpeedsterMapSourceSession(captureRecord("CAPTURED"));
  const exact = record(payload({ mapId: "exact-map" }));
  const family = record(familyPayload({ mapId: "family-map" }));
  const exactMap = {
    id: exact.mapId,
    matchKeyHash: exact.matchKeyHash,
    cardProfile: "SPORTS",
    currentRevisionId: exact.id,
    currentRevision: { id: exact.id, version: exact.version },
  };
  const harness = recordingMapTransaction({
    exactMap,
    map: {
      id: family.mapId,
      matchKeyHash: family.matchKeyHash,
      cardProfile: "SPORTS",
      currentRevisionId: "family-current",
      currentRevision: { id: "family-current", version: 2 },
    },
    session: {
      workflowState: "CAPTURED",
      reviewedDefects: [],
      gradeReport: {},
      mapRevisionId: exact.id,
      mapFilterDecisions: [],
    },
  });
  let registrations = 0;
  const restored = await restoreSpeedsterCardTypeMapRevision({
    source,
    scope: "FAMILY",
    targetRevisionId: family.id,
    authorAdminId: "admin-1",
    transaction: harness.transaction,
    async findTargetRevision() { return family; },
    async findActiveMap() { return { ...exactMap, currentRevision: exact }; },
    async registerCapturedRestore() {
      registrations += 1;
      throw new Error("family registration must not run while exact is active");
    },
  });
  assert.deepEqual(restored.revision.matchKey, family.matchKey);
  assert.equal(registrations, 0);
  assert.equal(harness.writes.session, 0);
  assert.equal(harness.committed().sessionData, null);
});

test("promotion copies an exact immutable revision into family scope without discarding provenance or imagery", async () => {
  const source = parseSpeedsterMapSourceSession(captureRecord("COMPLETED"));
  const exact = record();
  const harness = recordingMapTransaction();
  const promoted = await promoteSpeedsterExactMapRevisionToFamily({
    source,
    targetRevisionId: exact.id,
    authorAdminId: "admin-2",
    transaction: harness.transaction,
    async findTargetRevision() { return exact; },
  });
  assert.deepEqual(promoted.revision.matchKey, speedsterFamilyCardTypeMapKey("SPORTS", identity));
  assert.equal(promoted.revision.sourceSessionId, exact.sourceSessionId);
  assert.deepEqual(promoted.revision.displayIdentity, exact.displayIdentity);
  assert.deepEqual(promoted.revision.frontMap, exact.frontMap);
  assert.deepEqual(promoted.revision.backMap, exact.backMap);
  assert.deepEqual(exact.matchKey, payload().matchKey);
  assert.deepEqual(harness.writes, {
    mapCreate: 1,
    revisionCreate: 1,
    currentPointer: 1,
    session: 0,
    label: 0,
    card: 0,
    report: 0,
    memory: 0,
  });
});

test("captured exact-to-family promotion keeps the active exact override and skips family registration", async () => {
  const source = parseSpeedsterMapSourceSession(captureRecord("CAPTURED"));
  const exact = record();
  const exactMap = {
    id: exact.mapId,
    matchKeyHash: exact.matchKeyHash,
    cardProfile: "SPORTS",
    currentRevisionId: exact.id,
    currentRevision: { id: exact.id, version: exact.version },
  };
  const harness = recordingMapTransaction({
    exactMap,
    session: {
      workflowState: "CAPTURED",
      reviewedDefects: [],
      gradeReport: {},
      mapRevisionId: exact.id,
      mapFilterDecisions: [],
    },
  });
  let registrations = 0;
  const promoted = await promoteSpeedsterExactMapRevisionToFamily({
    source,
    targetRevisionId: exact.id,
    authorAdminId: "admin-1",
    transaction: harness.transaction,
    async findTargetRevision() { return exact; },
    async findActiveMap() {
      return { ...exactMap, currentRevision: exact };
    },
    async registerCapturedPromotion() {
      registrations += 1;
      throw new Error("family registration must not run while exact is active");
    },
  });
  assert.deepEqual(promoted.revision.matchKey, speedsterFamilyCardTypeMapKey("SPORTS", identity));
  assert.equal(registrations, 0);
  assert.equal(harness.writes.revisionCreate, 1);
  assert.equal(harness.writes.currentPointer, 1);
  assert.equal(harness.writes.session, 0);
  assert.equal(harness.committed().sessionData, null);
});

test("captured-card version restore registers and pins the exact restored revision in the same production transaction", async () => {
  const source = parseSpeedsterMapSourceSession(captureRecord("CAPTURED"));
  const target = record();
  const harness = recordingMapTransaction({
    map: {
      id: target.mapId,
      matchKeyHash: target.matchKeyHash,
      cardProfile: "SPORTS",
      currentRevisionId: "revision-current",
      currentRevision: { id: "revision-current", version: 2 },
    },
  });
  let registrations = 0;
  const restored = await restoreSpeedsterCardTypeMapRevision({
    source,
    targetRevisionId: target.id,
    authorAdminId: "admin-1",
    transaction: harness.transaction,
    async findTargetRevision(revisionId) {
      assert.equal(revisionId, target.id);
      return target;
    },
    async registerCapturedRestore(currentSource, revision) {
      registrations += 1;
      return {
        front: speedsterIdentityMapRegistration(revision.frontMap, currentSource.front, revision.revisionId),
        back: speedsterIdentityMapRegistration(revision.backMap, currentSource.back, revision.revisionId),
      };
    },
  });
  const committed = harness.committed();
  const sessionData = committed.sessionData as {
    mapRevisionId: string;
    mapFilterPolicyVersion: string;
    mapRegistration: { front: { mapRevisionId: string }; back: { mapRevisionId: string } };
  };
  assert.equal(registrations, 1);
  assert.equal(harness.transactionCount(), 1);
  assert.deepEqual(harness.operations, [
    "transaction.begin",
    "session.lock",
    "session.findWritable",
    "map.lock",
    "map.findUnique",
    "revision.create",
    "revision.findUnique",
    "map.updateCurrent",
    "session.updateMany",
    "transaction.commit",
  ]);
  assert.equal((committed.map as { currentRevisionId: string }).currentRevisionId, restored.revision.revisionId);
  assert.equal(sessionData.mapRevisionId, restored.revision.revisionId);
  assert.equal(sessionData.mapFilterPolicyVersion, SPEEDSTER_MAP_FILTER_POLICY_VERSION);
  assert.equal(sessionData.mapRegistration.front.mapRevisionId, restored.revision.revisionId);
  assert.equal(sessionData.mapRegistration.back.mapRevisionId, restored.revision.revisionId);
});

test("default captured restore wire binds the exact reference hash required by v2 and accepts legacy v1 responses", async () => {
  const source = parseSpeedsterMapSourceSession(captureRecord("CAPTURED")).front;
  const referenceSha256 = sha("restore-reference-front");
  const currentInspectionSha256 = sha("restore-current-front");
  const referenceInspection = {
    storageKey: "private/card-maps/restored/front.webp",
    sha256: referenceSha256,
  };
  const sideMap: SpeedsterCardTypeMapSide = {
    ...mapSide("FRONT"),
    referenceInspection,
    anchors: anchors.map((anchor) => ({ ...anchor, referencePatch: referenceInspection })),
  };
  const requests: Record<string, unknown>[] = [];
  let presignCalls = 0;
  let responseVersion: "opencv-redundant-ransac-registration-v2" | "opencv-human-anchor-registration-v1"
    = "opencv-redundant-ransac-registration-v2";
  const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, any>;
    requests.push(body);
    const responseBody = {
      version: responseVersion,
      side: body.side,
      mapRevisionId: body.mapRevisionId,
      currentPhysicalQuadSha256: body.currentPhysicalQuadSha256,
      currentInspectionSha256: body.currentInspectionSha256,
      homography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      anchors: body.anchors.map((anchor: { id: string; point: { x: number; y: number } }) => ({
        anchorId: anchor.id,
        expectedPoint: anchor.point,
        locatedPoint: anchor.point,
        score: 1,
      })),
      projectedDesignBoundary: body.designBoundary,
      projectedZones: body.zones,
      ...(responseVersion === "opencv-redundant-ransac-registration-v2" ? {
        candidateProvenance: { candidateId: "original-reference", source: "ORIGINAL_REFERENCE" },
        acceptance: {
          policyVersion: "speedster-map-registration-acceptance-v2",
          mode: "AUTOMATIC_RANSAC",
          featureCount: 16,
          usableFeatureCount: 12,
          inlierCount: 10,
          inlierFraction: 10 / 12,
          perAnchorFeatureCounts: [3, 3, 3, 3],
          perAnchorInlierCounts: [2, 2, 3, 3],
          medianReprojectionErrorPx: 0.8,
          maxReprojectionErrorPx: 2.4,
        },
      } : {}),
    };
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  const dependencies = {
    serviceUrl: "https://speedster.example.test",
    apiKey: "test-key",
    fetchImpl,
    async hashEvidence(storageKey: string) {
      if (storageKey === referenceInspection.storageKey) return referenceSha256;
      if (storageKey === source.inspectionStorageKey) return currentInspectionSha256;
      throw new Error(`unexpected storage key: ${storageKey}`);
    },
    async presignRead(storageKey: string) {
      presignCalls += 1;
      return `https://signed.example.test/${storageKey}`;
    },
  };

  const v2 = await registerRestoredMapSide(source, "map-restored", "revision-restored", sideMap, dependencies);
  assert.equal(v2.version, "opencv-redundant-ransac-registration-v2");
  const wire = requests[0];
  assert.equal(wire.referenceInspectionSha256, referenceSha256);
  assert.equal(wire.currentInspectionSha256, currentInspectionSha256);
  assert.equal(wire.currentPhysicalQuadSha256, speedsterPhysicalQuadHash(source.sourceCorners));
  assert.deepEqual(Object.keys(wire).sort(), [
    "anchors", "currentImage", "currentInspectionSha256", "currentPhysicalQuadSha256",
    "designBoundary", "mapId", "mapRevisionId", "referenceImage",
    "referenceInspectionSha256", "side", "zones",
  ].sort());

  const backendSource = readFileSync(fileURLToPath(new URL(
    "../../../backend/ai-grader-speedster-service/app.py",
    import.meta.url,
  )), "utf8");
  const schema = backendSource.slice(
    backendSource.indexOf("class MapRegistrationRequest(BaseModel):"),
    backendSource.indexOf("class CanonicalView", backendSource.indexOf("class MapRegistrationRequest(BaseModel):")),
  );
  const requiredSchemaFields = [...schema.matchAll(/^    ([A-Za-z][A-Za-z0-9_]*): ([^\n]+)$/gm)]
    .filter(([, , declaration]) => !declaration.includes("Optional[") && !declaration.includes("Field(default"))
    .map(([, field]) => field)
    .sort();
  assert.deepEqual(Object.keys(wire).sort(), requiredSchemaFields,
    "the restore request must provide every field required by the current Python v2 schema");

  responseVersion = "opencv-human-anchor-registration-v1";
  const legacy = await registerRestoredMapSide(
    source, "map-restored", "revision-restored", sideMap, dependencies,
  );
  assert.equal(legacy.version, "opencv-human-anchor-registration-v1");
  assert.equal(requests[1].referenceInspectionSha256, referenceSha256,
    "the additive v2 field remains safe for rolling compatibility with a legacy response");

  await assert.rejects(() => registerRestoredMapSide(
    source, "map-restored", "revision-restored", sideMap, {
      ...dependencies,
      async hashEvidence(storageKey: string) {
        return storageKey === referenceInspection.storageKey
          ? sha("changed-reference-bytes")
          : currentInspectionSha256;
      },
    },
  ), /reference evidence failed hash verification/);
  assert.equal(presignCalls, 4, "reference drift must fail before either URL is signed");
  assert.equal(requests.length, 2, "reference drift must fail before URL signing or service dispatch");
});

test("captured restore deadline discards a non-cooperative late body before any transaction mutation", async () => {
  const source = parseSpeedsterMapSourceSession(captureRecord("CAPTURED"));
  const target = record();
  let transactionCalls = 0;
  let aborted = false;
  let lateBodyCompleted = false;
  let completeLateBody!: () => void;
  const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => ({
    ok: true,
    status: 200,
    json: () => new Promise((resolve) => {
      init?.signal?.addEventListener("abort", () => { aborted = true; }, { once: true });
      completeLateBody = () => { lateBodyCompleted = true; resolve({ accepted: true }); };
    }),
  } as Response)) as typeof fetch;

  await assert.rejects(() => restoreSpeedsterCardTypeMapRevision({
    source,
    targetRevisionId: target.id,
    authorAdminId: "admin-1",
    async findTargetRevision() { return target; },
    transaction: async () => {
      transactionCalls += 1;
      throw new Error("transaction must not open after registration timeout");
    },
    async registerCapturedRestore(currentSource, revision) {
      await registerRestoredMapSide(
        currentSource.front,
        revision.mapId,
        revision.revisionId,
        revision.frontMap,
        {
          serviceUrl: "https://speedster.example.test",
          timeoutMs: 10,
          fetchImpl,
          async hashEvidence() { return revision.frontMap.referenceInspection.sha256; },
          async presignRead(storageKey: string) { return `https://signed.example.test/${storageKey}`; },
        },
      );
      throw new Error("late response must never become registration authority");
    },
  }), /timed out; no map revision was changed/);
  assert.equal(aborted, true);
  assert.equal(transactionCalls, 0, "timeout occurs before revision, pointer, or session writes can begin");
  completeLateBody();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lateBodyCompleted, true, "the deliberately non-cooperative response completed only after rejection");
  assert.equal(transactionCalls, 0, "late success cannot open or mutate the restore transaction");
});

test("restore and promotion verify persisted immutable content before publishing a new current pointer", async () => {
  const completedSource = parseSpeedsterMapSourceSession(captureRecord("COMPLETED"));
  const target = record();
  const restoreHarness = recordingMapTransaction({
    map: {
      id: target.mapId,
      matchKeyHash: target.matchKeyHash,
      cardProfile: "SPORTS",
      currentRevisionId: "revision-current",
      currentRevision: { id: "revision-current", version: 2 },
    },
    corruptPersistedRevision: true,
  });
  await assert.rejects(restoreSpeedsterCardTypeMapRevision({
    source: completedSource,
    targetRevisionId: target.id,
    authorAdminId: "admin-1",
    transaction: restoreHarness.transaction,
    async findTargetRevision() { return target; },
  }), /failed deterministic hash verification/);
  assert.equal(restoreHarness.writes.currentPointer, 0);
  assert.equal((restoreHarness.committed().map as { currentRevisionId: string }).currentRevisionId, "revision-current");

  const promotionHarness = recordingMapTransaction({ corruptPersistedRevision: true });
  await assert.rejects(promoteSpeedsterExactMapRevisionToFamily({
    source: completedSource,
    targetRevisionId: target.id,
    authorAdminId: "admin-1",
    transaction: promotionHarness.transaction,
    async findTargetRevision() { return target; },
  }), /failed deterministic hash verification/);
  assert.equal(promotionHarness.writes.currentPointer, 0);
  assert.equal(promotionHarness.committed().map, null);
});

test("captured TRAIN save and restore reject initialized review state before any map write", async () => {
  const source = parseSpeedsterMapSourceSession(captureRecord("CAPTURED"));
  const target = record();
  const initializedSession = {
    workflowState: "CAPTURED",
    reviewedDefects: [{ id: "reviewed" }],
    gradeReport: { overall: 9.4 },
    mapFilterDecisions: [{ id: "filtered" }],
  };
  const saveHarness = recordingMapTransaction({
    map: {
      id: target.mapId,
      matchKeyHash: target.matchKeyHash,
      cardProfile: "SPORTS",
      currentRevisionId: "revision-current",
      currentRevision: { id: "revision-current", version: 2 },
    },
    session: initializedSession,
  });
  await assert.rejects(saveSpeedsterCardTypeMapRevision({
    source,
    authorAdminId: "admin-1",
    front: trainingSide,
    back: trainingSide,
    hashEvidence: async (storageKey) => sha(storageKey),
    transaction: saveHarness.transaction,
  }), /only before detector review is initialized/);
  assert.deepEqual(saveHarness.operations, ["transaction.begin", "session.lock", "session.findWritable"]);
  assert.equal(saveHarness.writes.revisionCreate, 0);
  assert.equal(saveHarness.writes.currentPointer, 0);
  assert.equal(saveHarness.writes.session, 0);

  const restoreHarness = recordingMapTransaction({
    map: {
      id: target.mapId,
      matchKeyHash: target.matchKeyHash,
      cardProfile: "SPORTS",
      currentRevisionId: "revision-current",
      currentRevision: { id: "revision-current", version: 2 },
    },
    session: initializedSession,
  });
  await assert.rejects(restoreSpeedsterCardTypeMapRevision({
    source,
    targetRevisionId: target.id,
    authorAdminId: "admin-1",
    transaction: restoreHarness.transaction,
    async findTargetRevision() { return target; },
    async registerCapturedRestore(currentSource, revision) {
      return {
        front: speedsterIdentityMapRegistration(revision.frontMap, currentSource.front, revision.revisionId),
        back: speedsterIdentityMapRegistration(revision.backMap, currentSource.back, revision.revisionId),
      };
    },
  }), /only before detector review is initialized/);
  assert.deepEqual(restoreHarness.operations, ["transaction.begin", "session.lock", "session.findWritable"]);
  assert.equal(restoreHarness.writes.revisionCreate, 0);
  assert.equal(restoreHarness.writes.currentPointer, 0);
  assert.equal(restoreHarness.writes.session, 0);
});

test("map API rejects cross-admin active sources but permits shared completed-card retro-training", async () => {
  const handler = createSpeedsterCardTypeMapHandler({
    async requireAdminSession() { return { user: { id: "admin-2" } }; },
    async findSourceSession(sessionId, adminId) {
      assert.equal(sessionId, SESSION_ID);
      assert.equal(adminId, "admin-2");
      return null;
    },
    async loadActiveMap() { return null; },
    async listRevisions() { return []; },
    async saveDualRevisions() { throw new Error("not used"); },
    async restoreRevision() { throw new Error("not used"); },
    async sourceClientState() { throw new Error("not used"); },
  });
  const result = response();
  await handler(request("POST", "save", {
    sessionId: SESSION_ID,
    front: { designBoundary: { kind: "QUAD", points: quad }, anchors, zones },
    back: { designBoundary: { kind: "QUAD", points: quad }, anchors, zones },
  }), result.res);
  assert.equal(result.state.status, 404);
});

test("map API rejects a stale captured TRAIN save after review initialization", async () => {
  let saves = 0;
  const handler = createSpeedsterCardTypeMapHandler({
    async requireAdminSession() { return { user: { id: "admin-1" } }; },
    async findSourceSession() {
      return {
        ...captureRecord("CAPTURED"),
        reviewedDefects: [{ id: "reviewed" }],
        gradeReport: { overall: 9.4 },
        mapFilterDecisions: [{ id: "filtered" }],
      };
    },
    async loadActiveMap() { return null; },
    async listRevisions() { return []; },
    async saveDualRevisions() { saves += 1; throw new Error("not reached"); },
    async restoreRevision() { throw new Error("not reached"); },
    async sourceClientState() { throw new Error("not reached"); },
  });
  const result = response();
  await handler(request("POST", "save", {
    sessionId: SESSION_ID,
    front: trainingSide,
    back: trainingSide,
  }), result.res);
  assert.equal(result.state.status, 409);
  assert.equal(saves, 0);
  assert.match(JSON.stringify(result.state.body), /only before detector review is initialized/);
});

test("TRAIN editor coordinates are exposed only on their exact reference image and physical quad", async () => {
  const compatible = payload();
  const active = validateSpeedsterLoadedMapRevision(record({
    ...compatible,
    frontMap: { ...compatible.frontMap, sourcePhysicalQuadSha256: speedsterPhysicalQuadHash(quad) },
    backMap: { ...compatible.backMap, sourcePhysicalQuadSha256: speedsterPhysicalQuadHash(quad) },
  }));
  const siblingId = "speedster-map-session-0002";
  const sibling = JSON.parse(JSON.stringify(captureRecord("CAPTURED")).replaceAll(SESSION_ID, siblingId));
  for (const [sourceRecord, expectedEditable] of [
    [captureRecord("CAPTURED"), true],
    [sibling, false],
  ] as const) {
    const handler = createSpeedsterCardTypeMapHandler({
      async requireAdminSession() { return { user: { id: "admin-1" } }; },
      async findSourceSession() { return sourceRecord; },
      async loadActiveMap() { return active; },
      async listRevisions() { return []; },
      async saveDualRevisions() { throw new Error("not reached"); },
      async restoreRevision() { throw new Error("not reached"); },
      async sourceClientState(source) { return { sessionId: source.id } as never; },
    });
    const result = response();
    await handler({
      method: "GET",
      query: { action: ["source"], sessionId: sourceRecord.id },
      headers: {},
    } as unknown as NextApiRequest, result.res);
    assert.equal(result.state.status, 200);
    const body = result.state.body as { map: { editable: unknown } };
    assert.equal(Boolean(body.map.editable), expectedEditable);
  }
});

test("map API current EFFECTIVE returns one server-selected family map with scope, name, and provenance", async () => {
  const family = validateSpeedsterLoadedMapRevision(record(familyPayload()));
  let effectiveCalls = 0;
  const handler = createSpeedsterCardTypeMapHandler({
    async requireAdminSession() { return { user: { id: "admin-1" } }; },
    async findSourceSession() { return captureRecord("COMPLETED"); },
    async loadActiveMap() { throw new Error("scoped lookup must not run"); },
    async loadEffectiveMap() {
      effectiveCalls += 1;
      return {
        revision: family,
        appliedScope: "FAMILY",
        appliedMapName: "2021 · Panini · Obsidian · Orange",
        sourceProvenance: { sourceSessionId: SESSION_ID, sourceIdentity: identity },
      };
    },
    async listRevisions() { return []; },
    async saveDualRevisions() { throw new Error("not reached"); },
    async restoreRevision() { throw new Error("not reached"); },
    async sourceClientState() { throw new Error("not reached"); },
  });
  const result = response();
  await handler({
    method: "GET",
    query: { action: ["current"], sessionId: SESSION_ID, scope: "EFFECTIVE" },
    headers: {},
  } as unknown as NextApiRequest, result.res);
  assert.equal(result.state.status, 200);
  assert.equal(effectiveCalls, 1);
  const map = (result.state.body as { map: Record<string, unknown> }).map;
  assert.equal(map.status, "LOADED");
  assert.equal(map.scope, "FAMILY");
  assert.equal(map.name, "2021 · Panini · Obsidian · Orange");
  assert.deepEqual((map.revision as { sourceProvenance: unknown }).sourceProvenance, {
    sourceSessionId: SESSION_ID,
    sourceIdentity: identity,
  });
});

test("map API rejects creation-time scope choice and EFFECTIVE source editing", async () => {
  const family = validateSpeedsterLoadedMapRevision(record(familyPayload()));
  const handler = createSpeedsterCardTypeMapHandler({
    async requireAdminSession() { return { user: { id: "admin-1" } }; },
    async findSourceSession() { return captureRecord("CAPTURED"); },
    async loadActiveMap() { return null; },
    async loadEffectiveMap() { throw new Error("not reached"); },
    async listRevisions() { return []; },
    async saveDualRevisions() {
      return {
        family: { mapId: family.mapId, revision: family },
        exact: { mapId: record().mapId, revision: validateSpeedsterLoadedMapRevision(record()) },
      };
    },
    async restoreRevision() { throw new Error("not reached"); },
    async sourceClientState() { return { sessionId: SESSION_ID } as never; },
  });
  const saved = response();
  await handler(request("POST", "save", {
    sessionId: SESSION_ID,
    scope: "FAMILY",
    front: trainingSide,
    back: trainingSide,
  }), saved.res);
  assert.equal(saved.state.status, 400);
  assert.equal((saved.state.body as { code: string }).code, "CARD_MAP_INVALID_REQUEST");

  const rejected = response();
  await handler({
    method: "GET",
    query: { action: ["source"], sessionId: SESSION_ID, scope: "EFFECTIVE" },
    headers: {},
  } as unknown as NextApiRequest, rejected.res);
  assert.equal(rejected.state.status, 400);
  assert.match(JSON.stringify(rejected.state.body), /read-only/);
});

test("map API returns both revision identities and actionable bounded save diagnostics", async () => {
  const family = validateSpeedsterLoadedMapRevision(record(familyPayload()));
  const exact = validateSpeedsterLoadedMapRevision(record());
  const handler = createSpeedsterCardTypeMapHandler({
    async requireAdminSession() { return { user: { id: "admin-1" } }; },
    async findSourceSession() { return captureRecord("COMPLETED"); },
    async loadActiveMap() { return null; },
    async listRevisions() { return []; },
    async saveDualRevisions() {
      return {
        family: { mapId: family.mapId, revision: family },
        exact: { mapId: exact.mapId, revision: exact },
      };
    },
    async restoreRevision() { throw new Error("not reached"); },
    async sourceClientState() { throw new Error("not reached"); },
  });
  const succeeded = response();
  await handler(request("POST", "save", {
    sessionId: SESSION_ID,
    front: trainingSide,
    back: trainingSide,
  }), succeeded.res);
  assert.equal(succeeded.state.status, 201);
  const maps = (succeeded.state.body as { maps: Record<string, Record<string, unknown>> }).maps;
  assert.deepEqual(Object.keys(maps), ["family", "exact"]);
  assert.equal(maps.family.scope, "FAMILY");
  assert.equal(maps.exact.scope, "EXACT");
  for (const map of [maps.family, maps.exact]) {
    assert.equal(typeof map.applicability, "string");
    assert.equal(typeof map.mapId, "string");
    assert.equal(typeof map.revisionId, "string");
    assert.equal(typeof map.version, "number");
    assert.equal((map.revisionHash as string).length, 64);
    assert.equal((map.matchKeyHash as string).length, 64);
    assert.equal(map.sourceSessionId, SESSION_ID);
  }

  const failed = createSpeedsterCardTypeMapHandler({
    async requireAdminSession() { return { user: { id: "admin-1" } }; },
    async findSourceSession() { return captureRecord("COMPLETED"); },
    async loadActiveMap() { return null; },
    async listRevisions() { return []; },
    async saveDualRevisions() {
      throw new SpeedsterMapIntegrityError("Persisted Card Map content failed deterministic hash verification.", {
        stage: "PERSISTED_HASH_VERIFICATION",
        scope: "EXACT",
        field: "revisionHash",
      });
    },
    async restoreRevision() { throw new Error("not reached"); },
    async sourceClientState() { throw new Error("not reached"); },
  });
  const failure = response();
  await failed(request("POST", "save", {
    sessionId: SESSION_ID,
    front: trainingSide,
    back: trainingSide,
  }), failure.res);
  assert.equal(failure.state.status, 409);
  assert.deepEqual(failure.state.body, {
    message: "Persisted Card Map content failed deterministic hash verification.",
    code: "CARD_MAP_INTEGRITY_FAILURE",
    diagnostics: {
      stage: "PERSISTED_HASH_VERIFICATION",
      scope: "EXACT",
      field: "revisionHash",
    },
  });
});

test("non-save API errors keep the legacy message-only response shape", async () => {
  const handler = createSpeedsterCardTypeMapHandler({
    async requireAdminSession() { return { user: { id: "admin-1" } }; },
    async findSourceSession() { return captureRecord("COMPLETED"); },
    async loadActiveMap() { throw new SpeedsterMapIntegrityError("Map revision hash verification failed."); },
    async listRevisions() { return []; },
    async saveDualRevisions() { throw new Error("not reached"); },
    async restoreRevision() { throw new Error("not reached"); },
    async sourceClientState() { throw new Error("not reached"); },
  });
  const result = response();
  await handler({
    method: "GET",
    query: { action: ["current"], sessionId: SESSION_ID, scope: "FAMILY" },
    headers: {},
  } as unknown as NextApiRequest, result.res);
  assert.equal(result.state.status, 409);
  assert.deepEqual(result.state.body, { message: "Map revision hash verification failed." });
});

test("authoring source remains available for append-only repair of an invalid current map", async () => {
  const handler = createSpeedsterCardTypeMapHandler({
    async requireAdminSession() { return { user: { id: "admin-1" } }; },
    async findSourceSession() { return captureRecord("COMPLETED"); },
    async loadActiveMap() { throw new SpeedsterMapIntegrityError("Map revision hash verification failed."); },
    async listRevisions() { throw new Error("invalid revision history must not be exposed as valid"); },
    async saveDualRevisions() { throw new Error("not reached"); },
    async restoreRevision() { throw new Error("not reached"); },
    async sourceClientState(source) {
      return { sessionId: source.id, front: { rectifiedUrl: "front" }, back: { rectifiedUrl: "back" } } as never;
    },
  });
  const result = response();
  await handler({
    method: "GET",
    query: { action: ["source"], sessionId: SESSION_ID, scope: "FAMILY" },
    headers: {},
  } as unknown as NextApiRequest, result.res);
  assert.equal(result.state.status, 200);
  const body = result.state.body as { source: { sessionId: string }; map: Record<string, unknown> };
  assert.equal(body.source.sessionId, SESSION_ID);
  assert.deepEqual(body.map, {
    status: "INTEGRITY_ERROR",
    scope: "FAMILY",
    name: "2021 · Panini · Obsidian · Orange",
    revision: null,
    revisions: [],
    editable: null,
    integrity: {
      code: "CARD_MAP_INTEGRITY_FAILURE",
      message: "Map revision hash verification failed.",
    },
  });
});
