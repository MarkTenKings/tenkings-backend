import assert from "node:assert/strict";
import test from "node:test";
import type { NextApiRequest, NextApiResponse } from "next";
import {
  speedsterIphonePairingUrl,
  speedsterIphoneStorageKey,
} from "../lib/server/aiGraderV2IphoneCapture";
import { createAiGraderV2AdminIphoneCaptureHandler } from "../pages/api/admin/ai-grader-v2/iphone-capture";
import { createAiGraderV2IphoneCaptureHandler } from "../pages/api/ai-grader-v2/iphone-capture";

function request(method: string, body?: unknown, query: Record<string, string> = {}): NextApiRequest {
  return { method, body, query, headers: {} } as unknown as NextApiRequest;
}

function response() {
  const state: { status?: number; body?: any; allow?: string; cache?: string } = {};
  const res = {
    setHeader(name: string, value: string) {
      if (name === "Allow") state.allow = value;
      if (name === "Cache-Control") state.cache = value;
      return this;
    },
    status(code: number) {
      state.status = code;
      return this;
    },
    json(body: unknown) {
      state.body = body;
      return this;
    },
  } as unknown as NextApiResponse;
  return { state, res };
}

const sessionId = "speedster-session-123456789";

test("iPhone capture keys reuse the existing original-image path", () => {
  assert.equal(
    speedsterIphoneStorageKey("admin-1", sessionId, "FRONT"),
    `ai-grader-v2/admin-1/${sessionId}/original/front.jpg`,
  );
  assert.equal(
    speedsterIphoneStorageKey("admin-1", sessionId, "BACK"),
    `ai-grader-v2/admin-1/${sessionId}/original/back.jpg`,
  );
  assert.equal(
    speedsterIphonePairingUrl("device-12345678901234567890"),
    "shortcuts://run-shortcut?name=Ten%20Kings%20Speedster%20Capture&input=text&text=device-12345678901234567890",
  );
});

test("admin activation keeps one device and preserves a ready capture on reload", async () => {
  let device: any = null;
  let creates = 0;
  let activations = 0;
  const handler = createAiGraderV2AdminIphoneCaptureHandler({
    requireAdminSession: async () => ({ user: { id: "admin-1" } }),
    findSession: async (id) => ({ id, createdByUserId: "admin-1", workflowState: "DRAFT" }),
    findDevice: async () => device,
    createDevice: async (createdByUserId, activeSessionId) => {
      creates += 1;
      device = {
        id: "device-12345678901234567890",
        createdByUserId,
        activeSessionId,
        uploadVersion: 0,
        readyVersion: 0,
      };
      return device;
    },
    activateDevice: async () => {
      activations += 1;
      return device;
    },
    presignReadUrl: async (key) => `read:${key}`,
  });

  const first = response();
  await handler(request("POST", { sessionId }), first.res);
  device.readyVersion = 3;
  const reload = response();
  await handler(request("POST", { sessionId }), reload.res);

  assert.equal(first.state.status, 200);
  assert.equal(creates, 1);
  assert.equal(activations, 0);
  assert.equal(reload.state.body.readyVersion, 3);
});

test("switching drafts resets only that admin device", async () => {
  let activated: { id: string; sessionId: string } | undefined;
  const handler = createAiGraderV2AdminIphoneCaptureHandler({
    requireAdminSession: async () => ({ user: { id: "admin-1" } }),
    findSession: async (id) => ({ id, createdByUserId: "admin-1", workflowState: "DRAFT" }),
    findDevice: async () => ({
      id: "device-12345678901234567890",
      createdByUserId: "admin-1",
      activeSessionId: "speedster-session-old-12345",
      uploadVersion: 8,
      readyVersion: 8,
    }),
    createDevice: async () => { throw new Error("not used"); },
    activateDevice: async (id, nextSessionId) => {
      activated = { id, sessionId: nextSessionId };
      return {
        id,
        createdByUserId: "admin-1",
        activeSessionId: nextSessionId,
        uploadVersion: 0,
        readyVersion: 0,
      };
    },
    presignReadUrl: async (key) => `read:${key}`,
  });
  const { state, res } = response();

  await handler(request("POST", { sessionId }), res);

  assert.equal(state.status, 200);
  assert.deepEqual(activated, { id: "device-12345678901234567890", sessionId });
  assert.equal(state.body.readyVersion, 0);
});

test("admin polling returns only its active draft pair", async () => {
  const base = {
    requireAdminSession: async () => ({ user: { id: "admin-1" } }),
    findDevice: async () => ({
      id: "device-12345678901234567890",
      createdByUserId: "admin-1",
      activeSessionId: sessionId,
      uploadVersion: 4,
      readyVersion: 4,
    }),
    createDevice: async () => { throw new Error("not used"); },
    activateDevice: async () => { throw new Error("not used"); },
    presignReadUrl: async (key: string) => `read:${key}`,
  };
  const allowed = createAiGraderV2AdminIphoneCaptureHandler({
    ...base,
    findSession: async (id) => ({ id, createdByUserId: "admin-1", workflowState: "DRAFT" }),
  });
  const denied = createAiGraderV2AdminIphoneCaptureHandler({
    ...base,
    findSession: async (id) => ({ id, createdByUserId: "admin-2", workflowState: "DRAFT" }),
  });
  const ok = response();
  const crossAdmin = response();

  await allowed(request("GET", undefined, { sessionId }), ok.res);
  await denied(request("GET", undefined, { sessionId }), crossAdmin.res);

  assert.equal(ok.state.status, 200);
  assert.equal(ok.state.body.readyVersion, 4);
  assert.match(ok.state.body.front.storageKey, /\/admin-1\/.*\/original\/front\.jpg$/);
  assert.equal(ok.state.cache, "no-store");
  assert.equal(crossAdmin.state.status, 404);
});

test("Shortcut PLAN and COMPLETE publish an overwriteable photo pair", async () => {
  let version = 0;
  let readyVersion = 0;
  const signed: string[] = [];
  const handler = createAiGraderV2IphoneCaptureHandler({
    storageReady: () => true,
    beginUpload: async () => ({
      userId: "admin-1",
      sessionId,
      uploadVersion: ++version,
    }),
    completeUpload: async (_deviceId, requestedVersion) => {
      if (requestedVersion !== version) return null;
      readyVersion = requestedVersion;
      return readyVersion;
    },
    presignUploadUrl: async (key, contentType) => {
      signed.push(`${contentType}:${key}`);
      return `upload:${key}`;
    },
  });

  const first = response();
  await handler(request("POST", { action: "PLAN", deviceId: "device-12345678901234567890" }), first.res);
  const complete = response();
  await handler(request("POST", {
    action: "COMPLETE",
    deviceId: "device-12345678901234567890",
    uploadVersion: first.state.body.uploadVersion,
  }), complete.res);
  const resend = response();
  await handler(request("POST", { action: "PLAN", deviceId: "device-12345678901234567890" }), resend.res);

  assert.equal(first.state.status, 200);
  assert.equal(first.state.body.contentType, "image/jpeg");
  assert.equal(first.state.body.uploadVersion, 1);
  assert.match(first.state.body.frontUploadUrl, /original\/front\.jpg$/);
  assert.match(first.state.body.backUploadUrl, /original\/back\.jpg$/);
  assert.equal("front" in first.state.body, false);
  assert.equal("back" in first.state.body, false);
  assert.equal(complete.state.body.readyVersion, 1);
  assert.equal(resend.state.body.uploadVersion, 2);
  assert.equal(resend.state.body.frontUploadUrl, first.state.body.frontUploadUrl);
  assert.equal(resend.state.body.backUploadUrl, first.state.body.backUploadUrl);
  assert.equal(signed.length, 4);
});

test("Shortcut endpoint accepts instructions, never image bytes", async () => {
  let beginCalls = 0;
  const handler = createAiGraderV2IphoneCaptureHandler({
    storageReady: () => true,
    beginUpload: async () => {
      beginCalls += 1;
      return null;
    },
    completeUpload: async () => null,
    presignUploadUrl: async () => "unused",
  });
  const { state, res } = response();

  await handler(request("POST", {
    action: "PLAN",
    deviceId: "device-12345678901234567890",
    image: "base64-does-not-belong-here",
  }), res);

  assert.equal(state.status, 400);
  assert.equal(beginCalls, 0);
});
