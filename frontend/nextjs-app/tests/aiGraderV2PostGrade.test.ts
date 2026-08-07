import assert from "node:assert/strict";
import test from "node:test";
import type { NextApiRequest, NextApiResponse } from "next";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createCompletedCardsHandler } from "../pages/api/admin/ai-grader-v2/completed";
import { createCompletedCardHandler } from "../pages/api/admin/ai-grader-v2/completed/[sessionId]";
import { createCompletedCardLabelHandler } from "../pages/api/admin/ai-grader-v2/completed/[sessionId]/label";

const SESSION_ID = "speedster-session-0001";
const admin = async () => ({ user: { id: "admin-2" } });
const completed = {
  id: SESSION_ID,
  createdByUserId: "admin-1",
  workflowState: "COMPLETED",
  cardProfile: "SPORTS",
  publicReportSlug: "speedster-session-0001",
  identity: { playerName: "Nick Bosa", year: "2021", productSet: "Obsidian" },
  gradeReport: { overall: { displayGrade: 9.7 } },
  slabFrontKey: null,
  slabBackKey: null,
  nfcDone: false,
  compsDone: false,
  inventoryDone: false,
  collectibleCardV2: {
    id: "card-v2-1",
    publicToken: `tk2c_${"A".repeat(32)}`,
    lifecycleState: "GRADED",
    nfcVerifiedAt: null,
  },
  createdAt: new Date("2026-08-01T12:00:00.000Z"),
};
const cardActions = {
  async correctIdentity() { return undefined; },
  async voidCard() { return undefined; },
  logAdminAction() { return undefined; },
};

const speedsterLabel = {
  id: "label-1",
  source: "SPEEDSTER" as const,
  sourceSessionId: SESSION_ID,
  certificateNumber: "TKH-000001",
  gradingFormulaVersion: "EQUAL_25" as const,
  cardType: "SPORTS" as const,
  playerName: "Nick Bosa",
  cardName: null,
  year: "2021",
  manufacturer: "Panini",
  productSet: "Obsidian",
  parallel: "Orange",
  insert: null,
  cardNumber: "12",
  centeringGrade: "9.8",
  cornersGrade: "9.7",
  edgesGrade: "9.6",
  surfaceGrade: "9.7",
  grade: "9.7",
  slot: 3,
  sheet: { sheetNumber: 14 },
};

function request(method: string, body?: unknown): NextApiRequest {
  return { method, body, query: { sessionId: SESSION_ID }, headers: {} } as unknown as NextApiRequest;
}

function response() {
  const state: { status?: number; body?: unknown; allow?: string; headers: Record<string, string> } = {
    headers: {},
  };
  const res = {
    setHeader(name: string, value: string) {
      state.headers[name] = value;
      if (name === "Allow") state.allow = value;
      return this;
    },
    status(code: number) { state.status = code; return this; },
    json(body: unknown) { state.body = body; return this; },
    send(body: unknown) { state.body = body; return this; },
  } as unknown as NextApiResponse;
  return { state, res };
}

test("completed cards are shared across admins and expose only compact post-grade state", async () => {
  const handler = createCompletedCardsHandler({
    requireAdminSession: admin,
    async listSessions() { return [completed]; },
    async listLabels(ids) {
      assert.deepEqual(ids, [SESSION_ID]);
      return [{ sourceSessionId: SESSION_ID, certificateNumber: "TKS-000001", slot: 3, sheet: { sheetNumber: 14 } }];
    },
  });
  const { state, res } = response();
  await handler(request("GET"), res);
  assert.equal(state.status, 200);
  const body = state.body as { cards: Array<Record<string, unknown>> };
  assert.equal(body.cards[0].title, "Nick Bosa");
  assert.equal(body.cards[0].grade, 9.7);
  assert.equal(body.cards[0].certificateNumber, "TKS-000001");
  assert.equal(JSON.stringify(body).includes("createdByUserId"), false);
});

test("slab plan uses the card owner's stable storage namespace", async () => {
  let signedKey = "";
  const handler = createCompletedCardHandler({
    ...cardActions,
    requireAdminSession: admin,
    async findSession() { return completed; },
    async findLabel() { return null; },
    async updateSlabKey() { throw new Error("not used"); },
    async presignUpload(key) { signedKey = key; return `https://upload.example/${key}`; },
    async presignRead(key) { return `https://read.example/${key}`; },
    storageReady: () => true,
  });
  const { state, res } = response();
  await handler(request("POST", { action: "SLAB_PLAN", side: "FRONT", contentType: "image/jpeg" }), res);
  assert.equal(state.status, 200);
  assert.equal(signedKey, `ai-grader-v2/admin-1/${SESSION_ID}/slab/front.jpg`);
});

test("slab completion accepts only the exact planned card side and returns refreshed state", async () => {
  let saved = "";
  const key = `ai-grader-v2/admin-1/${SESSION_ID}/slab/back.webp`;
  const handler = createCompletedCardHandler({
    ...cardActions,
    requireAdminSession: admin,
    async findSession() { return completed; },
    async findLabel() { return speedsterLabel; },
    async updateSlabKey(id, side, storageKey) {
      assert.equal(id, SESSION_ID);
      assert.equal(side, "BACK");
      saved = storageKey;
      return { ...completed, slabBackKey: storageKey };
    },
    async presignUpload(storageKey) { return `https://upload.example/${storageKey}`; },
    async presignRead(storageKey) { return `https://read.example/${storageKey}`; },
    storageReady: () => true,
  });
  const { state, res } = response();
  await handler(request("POST", { action: "SLAB_COMPLETE", side: "BACK", storageKey: key }), res);
  assert.equal(state.status, 200);
  assert.equal(saved, key);
  const body = state.body as { card: { slabPhotos: { back: string } } };
  assert.match(body.card.slabPhotos.back, /^https:\/\/read\.example\//);
});

test("slab completion rejects a cross-card or cross-side object key", async () => {
  let updates = 0;
  const handler = createCompletedCardHandler({
    ...cardActions,
    requireAdminSession: admin,
    async findSession() { return completed; },
    async findLabel() { return null; },
    async updateSlabKey() { updates += 1; return completed; },
    async presignUpload(key) { return `https://upload.example/${key}`; },
    async presignRead(key) { return `https://read.example/${key}`; },
    storageReady: () => true,
  });
  const { state, res } = response();
  await handler(request("POST", {
    action: "SLAB_COMPLETE",
    side: "FRONT",
    storageKey: `ai-grader-v2/admin-1/${SESSION_ID}/slab/back.jpg`,
  }), res);
  assert.equal(state.status, 400);
  assert.equal(updates, 0);
});

test("completed-card status cannot be marked by a fake comps or inventory action", async () => {
  let updates = 0;
  const handler = createCompletedCardHandler({
    ...cardActions,
    requireAdminSession: admin,
    async findSession() { return completed; },
    async findLabel() { return null; },
    async updateSlabKey() { updates += 1; return completed; },
    async presignUpload(key) { return `https://upload.example/${key}`; },
    async presignRead(key) { return `https://read.example/${key}`; },
    storageReady: () => true,
  });
  for (const action of ["COMPS_COMPLETE", "INVENTORY_COMPLETE"]) {
    const { state, res } = response();
    await handler(request("POST", { action }), res);
    assert.equal(state.status, 400);
  }
  assert.equal(updates, 0);
});

test("completed-card state reads permanent V2 facts and exposes no legacy comps or inventory status", async () => {
  const handler = createCompletedCardHandler({
    ...cardActions,
    requireAdminSession: admin,
    async findSession() { return completed; },
    async findLabel() { return null; },
    async updateSlabKey() { throw new Error("not used"); },
    async presignUpload() { throw new Error("not used"); },
    async presignRead(key) { return `https://read.example/${key}`; },
    storageReady: () => false,
  });
  const { state, res } = response();
  await handler(request("GET"), res);
  assert.equal(state.status, 200);
  const body = state.body as { card: Record<string, unknown> };
  assert.deepEqual(body.card.permanentCard, {
    id: "card-v2-1",
    publicToken: `tk2c_${"A".repeat(32)}`,
    lifecycleState: "GRADED",
    nfcVerifiedAt: null,
  });
  assert.equal(JSON.stringify(body).includes("compsDone"), false);
  assert.equal(JSON.stringify(body).includes("inventoryDone"), false);
  assert.equal(JSON.stringify(body).includes("nfcDone"), false);
});

test("one authenticated identity save targets the authoritative session and returns refreshed label state", async () => {
  const calls: unknown[] = [];
  const logs: unknown[] = [];
  let reads = 0;
  let labelReads = 0;
  const correctedIdentity = {
    playerName: "Nicholas Bosa",
    year: "2021",
    manufacturer: "Panini",
    productSet: "Obsidian",
    parallel: "Orange",
    insert: null,
    cardNumber: "12",
  };
  const handler = createCompletedCardHandler({
    ...cardActions,
    requireAdminSession: admin,
    async findSession() {
      reads += 1;
      return reads === 1 ? completed : { ...completed, identity: correctedIdentity };
    },
    async findLabel() {
      labelReads += 1;
      return labelReads === 1 ? speedsterLabel : { ...speedsterLabel, playerName: "Nicholas Bosa" };
    },
    async updateSlabKey() { throw new Error("not used"); },
    async correctIdentity(sessionId, identity, adminId) { calls.push({ sessionId, identity, adminId }); },
    async presignUpload() { throw new Error("not used"); },
    async presignRead(key) { return `https://read.example/${key}`; },
    storageReady: () => false,
    logAdminAction(entry) { logs.push(entry); },
  });
  const { state, res } = response();
  await handler(request("POST", {
    action: "UPDATE_IDENTITY",
    identity: { ...correctedIdentity, playerName: "  Nicholas Bosa  " },
  }), res);
  assert.equal(state.status, 200);
  assert.equal(reads, 2);
  assert.equal(labelReads, 2);
  assert.deepEqual(calls, [{ sessionId: SESSION_ID, identity: correctedIdentity, adminId: "admin-2" }]);
  assert.deepEqual(logs, [{
    action: "UPDATE_IDENTITY",
    adminId: "admin-2",
    cardId: "card-v2-1",
    sessionId: SESSION_ID,
    reason: "Corrected authoritative Speedster identity",
  }]);
  const body = state.body as { card: { authoritativeIdentity: { playerName: string }; linkedLabel: { playerName: string } } };
  assert.equal(body.card.authoritativeIdentity.playerName, "Nicholas Bosa");
  assert.equal(body.card.linkedLabel.playerName, "Nicholas Bosa");
});

test("identity save rejects grade injection and does not call the correction writer", async () => {
  let corrections = 0;
  const handler = createCompletedCardHandler({
    ...cardActions,
    requireAdminSession: admin,
    async findSession() { return completed; },
    async findLabel() { return speedsterLabel; },
    async updateSlabKey() { throw new Error("not used"); },
    async correctIdentity() { corrections += 1; },
    async presignUpload() { throw new Error("not used"); },
    async presignRead(key) { return `https://read.example/${key}`; },
    storageReady: () => false,
  });
  const { state, res } = response();
  await handler(request("POST", {
    action: "UPDATE_IDENTITY",
    identity: {
      playerName: "Nick Bosa",
      year: "2021",
      manufacturer: "Panini",
      productSet: "Obsidian",
      parallel: null,
      insert: null,
      cardNumber: "12",
      centeringGrade: "10",
    },
  }), res);
  assert.equal(state.status, 400);
  assert.equal(corrections, 0);
});

test("identity save fails closed on a missing linked label without repairing or creating one", async () => {
  let corrections = 0;
  const handler = createCompletedCardHandler({
    ...cardActions,
    requireAdminSession: admin,
    async findSession() { return completed; },
    async findLabel() { return null; },
    async updateSlabKey() { throw new Error("not used"); },
    async correctIdentity() { corrections += 1; },
    async presignUpload() { throw new Error("not used"); },
    async presignRead(key) { return `https://read.example/${key}`; },
    storageReady: () => false,
  });
  const { state, res } = response();
  await handler(request("POST", {
    action: "UPDATE_IDENTITY",
    identity: {
      playerName: "Nick Bosa",
      year: "2021",
      manufacturer: "Panini",
      productSet: "Obsidian",
      parallel: null,
      insert: null,
      cardNumber: "12",
    },
  }), res);
  assert.equal(state.status, 409);
  assert.equal(corrections, 0);
});

test("identity correction remains available without a permanent card and never creates one", async () => {
  let corrections = 0;
  let reads = 0;
  const withoutCard = { ...completed, collectibleCardV2: null };
  const handler = createCompletedCardHandler({
    ...cardActions,
    requireAdminSession: admin,
    async findSession() { reads += 1; return withoutCard; },
    async findLabel() { return speedsterLabel; },
    async updateSlabKey() { throw new Error("not used"); },
    async correctIdentity(sessionId) { corrections += 1; assert.equal(sessionId, SESSION_ID); },
    async presignUpload() { throw new Error("not used"); },
    async presignRead(key) { return `https://read.example/${key}`; },
    storageReady: () => false,
  });
  const { state, res } = response();
  await handler(request("POST", {
    action: "UPDATE_IDENTITY",
    identity: {
      playerName: "Nick Bosa",
      year: "2021",
      manufacturer: "Panini",
      productSet: "Obsidian",
      parallel: null,
      insert: null,
      cardNumber: "12",
    },
  }), res);
  assert.equal(state.status, 200);
  assert.equal(corrections, 1);
  assert.equal(reads, 2);
  assert.equal((state.body as { card: { permanentCard: unknown } }).card.permanentCard, null);
});

test("authenticated void records the exact reason and returns a non-public card state", async () => {
  const calls: unknown[] = [];
  const logs: unknown[] = [];
  let reads = 0;
  const voided = { ...completed, collectibleCardV2: { ...completed.collectibleCardV2, lifecycleState: "VOID" } };
  const handler = createCompletedCardHandler({
    ...cardActions,
    requireAdminSession: admin,
    async findSession() { reads += 1; return reads === 1 ? completed : voided; },
    async findLabel() { return null; },
    async updateSlabKey() { throw new Error("not used"); },
    async voidCard(cardId, reason, adminId) { calls.push({ cardId, reason, adminId }); },
    async presignUpload() { throw new Error("not used"); },
    async presignRead(key) { return `https://read.example/${key}`; },
    storageReady: () => false,
    logAdminAction(entry) { logs.push(entry); },
  });
  const { state, res } = response();
  await handler(request("POST", { action: "VOID_CARD", reason: "Wrong physical card" }), res);
  assert.equal(state.status, 200);
  assert.deepEqual(calls, [{ cardId: "card-v2-1", reason: "Wrong physical card", adminId: "admin-2" }]);
  assert.deepEqual(logs, [{
    action: "VOID_CARD",
    adminId: "admin-2",
    cardId: "card-v2-1",
    sessionId: SESSION_ID,
    reason: "Wrong physical card",
  }]);
  assert.equal((state.body as { card: { permanentCard: { lifecycleState: string } } }).card.permanentCard.lifecycleState, "VOID");
});

test("void action fails closed when the completed grade has no V2 card", async () => {
  let actions = 0;
  const handler = createCompletedCardHandler({
    ...cardActions,
    requireAdminSession: admin,
    async findSession() { return { ...completed, collectibleCardV2: null }; },
    async findLabel() { return null; },
    async updateSlabKey() { throw new Error("not used"); },
    async correctIdentity() { actions += 1; },
    async voidCard() { actions += 1; },
    async presignUpload() { throw new Error("not used"); },
    async presignRead(key) { return `https://read.example/${key}`; },
    storageReady: () => false,
  });
  const { state, res } = response();
  await handler(request("POST", { action: "VOID_CARD", reason: "Wrong card" }), res);
  assert.equal(state.status, 409);
  assert.equal(actions, 0);
});

test("linked-label preview authenticates, binds the exact SPEEDSTER label, and renders only its saved snapshot", async () => {
  let rendered: unknown;
  const handler = createCompletedCardLabelHandler({
    requireAdminSession: admin,
    async findSession(id) { assert.equal(id, SESSION_ID); return { id, workflowState: "COMPLETED" }; },
    async findLabel(id) { assert.equal(id, SESSION_ID); return speedsterLabel; },
    async renderLabel(snapshot) { rendered = snapshot; return Buffer.from("%PDF-exact-label"); },
  });
  const { state, res } = response();
  await handler(request("GET"), res);
  assert.equal(state.status, 200);
  assert.equal(state.headers["Content-Type"], "application/pdf");
  assert.equal(state.headers["Cache-Control"], "private, no-store");
  assert.equal((state.body as Buffer).toString(), "%PDF-exact-label");
  assert.deepEqual(rendered, {
    id: "label-1",
    certificateNumber: "TKH-000001",
    source: "SPEEDSTER",
    gradingFormulaVersion: "EQUAL_25",
    cardType: "SPORTS",
    playerName: "Nick Bosa",
    cardName: null,
    year: "2021",
    manufacturer: "Panini",
    productSet: "Obsidian",
    parallel: "Orange",
    insert: null,
    cardNumber: "12",
    centeringGrade: "9.8",
    cornersGrade: "9.7",
    edgesGrade: "9.6",
    surfaceGrade: "9.7",
    grade: "9.7",
  });
});

test("linked-label preview refuses a HUMAN or cross-session label before rendering", async () => {
  for (const label of [
    { ...speedsterLabel, source: "HUMAN" as const },
    { ...speedsterLabel, sourceSessionId: "speedster-session-other" },
  ]) {
    let renders = 0;
    const handler = createCompletedCardLabelHandler({
      requireAdminSession: admin,
      async findSession() { return { id: SESSION_ID, workflowState: "COMPLETED" }; },
      async findLabel() { return label; },
      async renderLabel() { renders += 1; return Buffer.from("not-used"); },
    });
    const { state, res } = response();
    await handler(request("GET"), res);
    assert.equal(state.status, 404);
    assert.equal(renders, 0);
  }
});

test("completed-card component exposes one session identity editor and an authenticated exact-PDF preview", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const page = readFileSync(`${root}/pages/admin/ai-grader-v2/completed/[sessionId].tsx`, "utf8");
  const endpoint = readFileSync(`${root}/pages/api/admin/ai-grader-v2/completed/[sessionId]/label.ts`, "utf8");
  const renderer = readFileSync(`${root}/lib/server/humanGradeLabelRenderer.ts`, "utf8");
  assert.match(page, /AUTHORITATIVE SPEEDSTER IDENTITY/);
  assert.match(page, /Save Authoritative Identity/);
  assert.match(page, /mode="SPEEDSTER"/);
  assert.match(page, /lockCardType/);
  assert.match(page, /buildAdminHeaders\(session\.token\)/);
  assert.match(page, /URL\.createObjectURL\(blob\)/);
  assert.doesNotMatch(page, /RESYNC_IDENTITY|Re-sync identity from session/);
  assert.match(endpoint, /renderHumanGradeLabelPdf/);
  assert.match(endpoint, /label\.source !== "SPEEDSTER"/);
  assert.match(endpoint, /"Cache-Control", "private, no-store"/);
  assert.match(renderer, /drawLabel\(doc, openCrown\(doc\), snapshot, 0, 0, false\)/);
});
