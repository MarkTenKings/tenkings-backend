import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import { HttpError } from "../lib/server/adminSessionAuthority";
import { currentSpeedsterPreparationRelease } from "../lib/server/speedsterPreparationRelease";
import { legacySpeedsterPreparationTransport, prepareLegacySpeedsterSide } from "../lib/server/speedsterPreparationRuntime";
import { createSpeedsterReviewDependencies } from "../lib/server/speedsterReviewDependencies";
import { fetchSpeedsterImageUpstream } from "../pages/api/admin/ai-grader-v2/image/[action]";
import { beginSpeedsterPreparation, claimSpeedsterPreparationDispatch, adoptSpeedsterPreparation } from "../lib/server/speedsterPreparationAuthority";
import { FixturePreparationStorage, FixturePreparationStore, fixturePreparationBody, fixturePreparationColor,
  fixturePreparationIdentity, fixturePreparationInput, fixturePreparationRequest, fixturePreparationScope } from "./fixtures/speedsterPreparation";

const configuredEnv = (): NodeJS.ProcessEnv => ({ NODE_ENV: "test",
  AI_GRADER_SPEEDSTER_PREPARATION_SERVICE_URL: "https://prepare.atlasgrading.com",
  AI_GRADER_SPEEDSTER_PREPARATION_SERVICE_API_KEY: "cpu-" + "c".repeat(40),
  AI_GRADER_SPEEDSTER_SERVICE_URL: "https://detector.example.invalid/v2/fixture",
  AI_GRADER_SPEEDSTER_SERVICE_API_KEY: "gpu-" + "g".repeat(40) });
const unavailable = (error: unknown) => error instanceof HttpError && error.statusCode === 503;
const originalImage = sharp({ create: { width: 800, height: 1000, channels: 3, background: "#bbaabb" } }).jpeg().toBuffer();

async function fixture() {
  const store = new FixturePreparationStore(), storage = new FixturePreparationStorage();
  const input = fixturePreparationInput();
  storage.objects.set(input.source.originalStorageKey, await originalImage);
  let sourceReads = 0, grants = 0;
  const calls: Array<{ body: Record<string, unknown>; transport: ReturnType<typeof legacySpeedsterPreparationTransport> }> = [];
  storage.beforeRead = () => { sourceReads++; };
  const deps: Parameters<typeof prepareLegacySpeedsterSide>[2] = {
    store, storage, approvedRelease: () => fixturePreparationIdentity,
    readUrl: async (key) => `fixture-read:${key}`,
    stagingUpload: async (key) => { grants++; return `fixture-put:${key}`; },
    issueColorReceipt: () => "fixture-color-receipt",
    invokeWorker: async (body, transport) => { calls.push({ body, transport }); return { ok: false, status: 422, payload: {} }; },
  };
  const request = { sessionId: fixturePreparationScope.sessionId, side: "FRONT", sourceImageStorageKey: input.source.originalStorageKey,
    corners: input.physicalQuad, matColor: input.matColor, preparationRequest: { idempotencyKey: randomUUID(), expectedHead: { sideRevision: 0, attemptId: null } } };
  return { store, storage, deps, request, calls, sourceReads: () => sourceReads, grants: () => grants };
}

test("legacy preparation requires the exact private CPU origin and a distinct valid credential", () => {
  const env = configuredEnv();
  const transport = legacySpeedsterPreparationTransport(env);
  assert.equal(transport.origin, "https://prepare.atlasgrading.com");
  assert.deepEqual(transport.headers, { "Content-Type": "application/json", Authorization: `Bearer ${env.AI_GRADER_SPEEDSTER_PREPARATION_SERVICE_API_KEY}` });
  for (const origin of [undefined, "", env.AI_GRADER_SPEEDSTER_SERVICE_URL, "http://prepare.atlasgrading.com",
    "https://prepare.atlasgrading.com/", "https://prepare.atlasgrading.com:443", "https://prepare.atlasgrading.com/prepare",
    "https://prepare.atlasgrading.com?target=detector", "https://prepare.atlasgrading.com#fragment",
    "https://user:password@prepare.atlasgrading.com", "https://prepare.atlasgrading.com.evil.invalid"]) {
    assert.throws(() => legacySpeedsterPreparationTransport({ ...env, AI_GRADER_SPEEDSTER_PREPARATION_SERVICE_URL: origin }), unavailable);
  }
  for (const key of [undefined, "", "x".repeat(31), "x".repeat(129), "invalid key " + "x".repeat(32), env.AI_GRADER_SPEEDSTER_SERVICE_API_KEY]) {
    assert.throws(() => legacySpeedsterPreparationTransport({ ...env, AI_GRADER_SPEEDSTER_PREPARATION_SERVICE_API_KEY: key }), unavailable);
  }
  assert.throws(() => legacySpeedsterPreparationTransport({ ...env, AI_GRADER_SPEEDSTER_SERVICE_URL: transport.origin + "/v2/fixture" }), unavailable);
});

test("legacy preparation binds only the CPU endpoint/key while detection retains its existing endpoint/key", async () => {
  const f = await fixture(), env = configuredEnv();
  await assert.rejects(prepareLegacySpeedsterSide(f.request, fixturePreparationScope.createdByUserId, f.deps, env), /did not complete/);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].transport.origin + "/prepare", "https://prepare.atlasgrading.com/prepare");
  assert.equal(f.calls[0].transport.headers.Authorization, `Bearer ${env.AI_GRADER_SPEEDSTER_PREPARATION_SERVICE_API_KEY}`);
  assert.equal(f.grants(), 5);
  assert.ok(f.calls[0].body.preparationBinding);
  const detectorCalls: Array<{ url: unknown; init?: RequestInit }> = [];
  const detector = createSpeedsterReviewDependencies({} as PrismaClient, { env,
    fetchImpl: (async (url, init) => { detectorCalls.push({ url, init }); return Response.json({ defects: [] }); }) as typeof fetch });
  await detector.detect({ side: "FRONT", cornerShape: "SQUARE", views: [], sessionId: "fixture", requestTraceId: "fixture", learningBank: null });
  assert.equal(detectorCalls[0].url, env.AI_GRADER_SPEEDSTER_SERVICE_URL + "/detect");
  assert.equal((detectorCalls[0].init?.headers as Record<string, string>).Authorization, `Bearer ${env.AI_GRADER_SPEEDSTER_SERVICE_API_KEY}`);
});

test("invalid or absent CPU bindings fail before source reads, grants, claims, or provider work", async () => {
  for (const override of [{ AI_GRADER_SPEEDSTER_PREPARATION_SERVICE_URL: undefined },
    { AI_GRADER_SPEEDSTER_PREPARATION_SERVICE_API_KEY: undefined },
    { AI_GRADER_SPEEDSTER_PREPARATION_SERVICE_URL: configuredEnv().AI_GRADER_SPEEDSTER_SERVICE_URL },
    { AI_GRADER_SPEEDSTER_PREPARATION_SERVICE_API_KEY: configuredEnv().AI_GRADER_SPEEDSTER_SERVICE_API_KEY }]) {
    const f = await fixture();
    await assert.rejects(prepareLegacySpeedsterSide(f.request, fixturePreparationScope.createdByUserId, f.deps, { ...configuredEnv(), ...override }), unavailable);
    assert.equal(f.sourceReads(), 0); assert.equal(f.grants(), 0); assert.equal(f.calls.length, 0);
    assert.equal(f.store.attempts.size, 0); assert.equal(f.store.events.length, 0); assert.equal(f.storage.writes.length, 0);
  }
});

test("preparation rejects redirects while other image actions preserve their existing HTTP behavior", async () => {
  const received: Array<{ method?: string; authorization?: string; body: string }> = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk.toString();
    if (request.url === "/redirect") { response.writeHead(307, { Location: "/detector" }).end(); return; }
    received.push({ method: request.method, authorization: request.headers.authorization, body });
    response.writeHead(200, { "Content-Type": "application/json" }).end('{"ok":true}');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const input = { url: `http://127.0.0.1:${address.port}/redirect`, headers: { Authorization: "Bearer synthetic" }, body: '{"synthetic":true}' };
    await assert.rejects(fetchSpeedsterImageUpstream({ ...input, action: "prepare" }), /fetch failed/);
    assert.equal(received.length, 0, "preparation must not follow a redirect toward another service");
    const result = await fetchSpeedsterImageUpstream({ ...input, action: "geometry" });
    assert.equal(result.response.status, 200);
    assert.deepEqual(received, [{ method: "POST", authorization: "Bearer synthetic", body: input.body }]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("valid CPU settings cannot bypass the currently null reviewed release admission", async () => {
  const f = await fixture();
  await assert.rejects(prepareLegacySpeedsterSide(f.request, fixturePreparationScope.createdByUserId,
    { ...f.deps, approvedRelease: currentSpeedsterPreparationRelease }, configuredEnv()), /compatible release/);
  assert.equal(f.sourceReads(), 0); assert.equal(f.grants(), 0); assert.equal(f.calls.length, 0); assert.equal(f.store.attempts.size, 0);
});

test("CPU transport cannot authorize a different worker release identity", async () => {
  const f = await fixture();
  await assert.rejects(prepareLegacySpeedsterSide(f.request, fixturePreparationScope.createdByUserId, { ...f.deps,
    invokeWorker: async () => ({ ok: true, status: 200, payload: { width: 1270, height: 1778, borders: null,
      colorGeometry: fixturePreparationColor, preparationIdentity: { ...fixturePreparationIdentity, ociDigest: `sha256:${"d".repeat(64)}` } } }),
  }, configuredEnv()), /not admitted/);
  assert.equal(f.store.manifests.size, 0);
  assert.equal([...f.store.attempts.values()][0].terminalOutcome, "FAILED");
});

test("CPU transport captures configuration before an asynchronous durable lookup", async () => {
  const f = await fixture(), env = configuredEnv(), originalKey = env.AI_GRADER_SPEEDSTER_PREPARATION_SERVICE_API_KEY;
  const read = f.store.read;
  f.store.read = async (owner) => {
    env.AI_GRADER_SPEEDSTER_PREPARATION_SERVICE_URL = env.AI_GRADER_SPEEDSTER_SERVICE_URL;
    env.AI_GRADER_SPEEDSTER_PREPARATION_SERVICE_API_KEY = env.AI_GRADER_SPEEDSTER_SERVICE_API_KEY;
    return read(owner);
  };
  await assert.rejects(prepareLegacySpeedsterSide(f.request, fixturePreparationScope.createdByUserId, f.deps, env), /did not complete/);
  assert.equal(f.calls[0].transport.origin, "https://prepare.atlasgrading.com");
  assert.equal(f.calls[0].transport.headers.Authorization, `Bearer ${originalKey}`);
});

test("saved preparation reconciliation needs neither live transport nor renewed release admission", async () => {
  const f = await fixture(), request = fixturePreparationRequest();
  const begun = await beginSpeedsterPreparation(request, f.store);
  const claimed = await claimSpeedsterPreparationDispatch(request.scope, begun.attempt.id, begun.attempt.sideRevision, f.store);
  const body = fixturePreparationBody(claimed.attempt);
  await adoptSpeedsterPreparation(body, claimed.attempt.dispatchClaimId!, f.store);
  f.storage.installBody(body);
  const before = structuredClone({ attempts: f.store.attempts, heads: f.store.heads, manifests: f.store.manifests, events: f.store.events });
  const result = await prepareLegacySpeedsterSide({ ...f.request, preparationRequest: { idempotencyKey: request.idempotencyKey, expectedHead: request.expected } },
    fixturePreparationScope.createdByUserId, { ...f.deps, approvedRelease: () => { throw new Error("Recovery must not read admission"); } }, { NODE_ENV: "test" });
  assert.equal(result.preparationState, "ADOPTED");
  assert.equal(f.calls.length, 0); assert.equal(f.grants(), 0);
  assert.deepEqual({ attempts: f.store.attempts, heads: f.store.heads, manifests: f.store.manifests, events: f.store.events }, before);
});
