import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { NextApiRequest, NextApiResponse } from "next";
import {
  SPEEDSTER_MAP_FILTER_POLICY_VERSION,
  SPEEDSTER_MAP_SCHEMA_VERSION,
  speedsterCardTypeMapKey,
  type SpeedsterCardTypeMapSide,
} from "../lib/ai-grader-v2/card-type-map-contracts";
import {
  SpeedsterMapIntegrityError,
  canonicalSpeedsterMapRevisionPayload,
  loadExactActiveSpeedsterMapRevision,
  loadPinnedSpeedsterMapRevision,
  parseSpeedsterMapSourceSession,
  restoreSpeedsterCardTypeMapRevision,
  saveSpeedsterCardTypeMapRevision,
  speedsterIdentityMapRegistration,
  speedsterMapMatchKeyHash,
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
  map: Record<string, unknown>;
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
  let committedMap: Record<string, unknown> | null = seed ? structuredClone(seed.map) : null;
  let committedRevision: Record<string, unknown> | null = null;
  let committedSessionData: Record<string, unknown> | null = null;
  let transactionCount = 0;

  const transaction: SpeedsterMapTransactionRunner = async (operation) => {
    transactionCount += 1;
    operations.push("transaction.begin");
    let workingMap = committedMap ? structuredClone(committedMap) : null;
    let workingRevision = committedRevision ? structuredClone(committedRevision) : null;
    let workingSessionData = committedSessionData ? structuredClone(committedSessionData) : null;
    const delegates = {
      async $executeRaw(..._args: unknown[]) {
        operations.push("map.lock");
        return 1;
      },
      aiGraderV2CardTypeMap: {
        async findUnique() {
          operations.push("map.findUnique");
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
      },
      aiGraderV2Session: {
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
    "map.lock",
    "map.findUnique",
    "map.create",
    "revision.create",
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
    "map.lock",
    "map.findUnique",
    "revision.create",
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
    async saveRevision() { throw new Error("not used"); },
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
