import assert from "node:assert/strict";
import test from "node:test";
import type { NextApiRequest, NextApiResponse } from "next";
import { createCompletedCardsHandler } from "../pages/api/admin/ai-grader-v2/completed";
import { createCompletedCardHandler } from "../pages/api/admin/ai-grader-v2/completed/[sessionId]";

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
  createdAt: new Date("2026-08-01T12:00:00.000Z"),
};

function request(method: string, body?: unknown): NextApiRequest {
  return { method, body, query: { sessionId: SESSION_ID }, headers: {} } as unknown as NextApiRequest;
}

function response() {
  const state: { status?: number; body?: unknown; allow?: string } = {};
  const res = {
    setHeader(name: string, value: string) { if (name === "Allow") state.allow = value; return this; },
    status(code: number) { state.status = code; return this; },
    json(body: unknown) { state.body = body; return this; },
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
    requireAdminSession: admin,
    async findSession() { return completed; },
    async findLabel() { return { certificateNumber: "TKS-000001", slot: 3, sheet: { sheetNumber: 14 } }; },
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
