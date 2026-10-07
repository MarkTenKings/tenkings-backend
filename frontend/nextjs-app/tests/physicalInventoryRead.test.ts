import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { CardInventoryRowV2 } from "@tenkings/database";
import { readPhysicalInventoryCard, createPhysicalInventoryCardHandler } from "../lib/server/physicalInventoryRead";
import { fixtureEmptyCard, fixtureHeldCard, fixtureRow } from "./physicalInventoryFixtures";

const query = (rows: CardInventoryRowV2[]) => async (sql: { sql: string }) => sql.sql.includes("COUNT(*)")
  ? [{ count: BigInt(rows.length), bytes: BigInt(rows.reduce((sum, row) => sum + Buffer.byteLength(row.content), 0)) }]
  : rows;

test("exact-card read derives recorded custody/cost/history from verified immutable rows", async () => {
  const held = fixtureHeldCard();
  const db = {
    location: { async findMany() { return fixtureEmptyCard().locations; } },
    collectibleCardV2: { async findUnique(args: { where: { id: string } }) { assert.equal(args.where.id, held.card.id); return held.card; } },
    $queryRaw: query([fixtureRow()]),
  } as unknown as Parameters<typeof readPhysicalInventoryCard>[0];
  const result = await readPhysicalInventoryCard(db, held.card.id);
  assert.deepEqual(result, held);
  assert.equal(result!.position!.origin.components[0].cost_cents, 1201);
  assert.equal(result!.actions.sale, false);
});

test("empty source history remains unset and incompatible cards cannot receive invented stock", async () => {
  let card = fixtureEmptyCard().card;
  const db = { location: { async findMany() { return fixtureEmptyCard().locations; } }, collectibleCardV2: { async findUnique() { return card; } }, $queryRaw: query([]) } as unknown as Parameters<typeof readPhysicalInventoryCard>[0];
  const result = await readPhysicalInventoryCard(db, card.id);
  assert.equal(result!.position, null); assert.equal(result!.actions.receive, true);
  card = { ...card, currentOwnerType: "ACCOUNT", currentOwnerId: "isolated-customer", lifecycleState: "VAULTED" };
  const incompatible = await readPhysicalInventoryCard(db, card.id);
  assert.deepEqual([incompatible!.actions.receive, incompatible!.actions.pack, incompatible!.actions.move, incompatible!.actions.sale, incompatible!.actions.return, incompatible!.actions.refund], [false, false, false, false, false, false]);
  assert.match(incompatible!.actions.reason!, /outside/);
});

test("read rejects corrupt journal data and a stale or mismatched card projection", async () => {
  const db = { location: { async findMany() { return fixtureEmptyCard().locations; } }, collectibleCardV2: { async findUnique() { return fixtureEmptyCard().card; } }, $queryRaw: query([fixtureRow()]) } as unknown as Parameters<typeof readPhysicalInventoryCard>[0];
  await assert.rejects(readPhysicalInventoryCard(db, "isolated-card"), /integrity/);
  const row = fixtureRow(); row.contentHash = "0".repeat(64);
  const corrupt = { location: { async findMany() { return fixtureEmptyCard().locations; } }, collectibleCardV2: { async findUnique() { return fixtureHeldCard().card; } }, $queryRaw: query([row]) } as unknown as Parameters<typeof readPhysicalInventoryCard>[0];
  await assert.rejects(readPhysicalInventoryCard(corrupt, "isolated-card"), /integrity/);
});

function response() {
  const result = { statusCode: 0, body: undefined as unknown, headers: {} as Record<string, string>,
    setHeader(key: string, value: string) { result.headers[key] = value; return result; },
    status(code: number) { result.statusCode = code; return result; }, json(body: unknown) { result.body = body; return result; } };
  return result;
}
const request = (patch: Partial<Parameters<ReturnType<typeof createPhysicalInventoryCardHandler>>[0]> = {}) => ({ method: "GET", headers: {}, query: { card_id: "isolated-card" }, ...patch });

test("card route rejects read token and static operator keys before human auth or reads", async () => {
  const token = "isolated-financial-reader-token-00000000";
  let calls = 0;
  const handler = createPhysicalInventoryCardHandler({ readTokenHash: () => createHash("sha256").update(token).digest("hex"),
    async requireAdmin() { calls += 1; return { authority: "local-database" }; }, async readCard() { calls += 1; return fixtureEmptyCard(); } });
  for (const headers of [{ authorization: `Bearer ${token}` }, { "x-operator-key": "isolated-key" }, { "x-operator-key": ["isolated-key"] }]) {
    const res = response(); await handler(request({ headers }), res);
    assert.equal(res.statusCode, 403); assert.equal(calls, 0);
    assert.equal(res.headers["Cache-Control"], "private, no-store");
  }
});

test("human auth failures, static authority, method and exact-ID validation fail closed", async () => {
  let authority = "operator-key";
  let error: unknown = null;
  let reads = 0;
  const handler = createPhysicalInventoryCardHandler({ readTokenHash: () => undefined,
    async requireAdmin() { if (error) throw error; return { authority }; }, async readCard() { reads++; return fixtureEmptyCard(); } });
  let res = response(); await handler(request(), res); assert.equal(res.statusCode, 403);
  authority = "local-database"; error = { statusCode: 401, message: "RAW_SECRET_MUST_NOT_APPEAR" };
  res = response(); await handler(request(), res); assert.equal(res.statusCode, 401);
  error = new Error("RAW_SECRET_MUST_NOT_APPEAR");
  res = response(); await handler(request(), res); assert.equal(res.statusCode, 503); assert.doesNotMatch(JSON.stringify(res.body), /RAW_SECRET/);
  error = null;
  for (const req of [request({ method: "POST" }), request({ query: { card_id: ["a", "b"] } }), request({ query: { card_id: " isolated-card" } }), request({ query: { card_id: "isolated-card", extra: "no" } })]) {
    res = response(); await handler(req, res); assert.ok([400, 405].includes(res.statusCode));
  }
  assert.equal(reads, 0);
});

test("read route returns verified data or controlled not-found/unavailable without raw errors", async () => {
  let mode = "ok";
  const handler = createPhysicalInventoryCardHandler({ readTokenHash: () => undefined, async requireAdmin() { return { authority: "local-database" }; },
    async readCard(id) { assert.equal(id, "isolated-card"); if (mode === "error") throw new Error("RAW_DATABASE_OR_CREDENTIAL_DETAIL"); return mode === "missing" ? null : fixtureEmptyCard(); } });
  const success = response(); await handler(request(), success); assert.equal(success.statusCode, 200); assert.deepEqual(success.body, fixtureEmptyCard());
  mode = "missing"; const missing = response(); await handler(request(), missing); assert.equal(missing.statusCode, 404);
  mode = "error"; const failed = response(); await handler(request(), failed); assert.equal(failed.statusCode, 503); assert.doesNotMatch(JSON.stringify(failed.body), /RAW_DATABASE/);
  assert.match(failed.headers["X-Robots-Tag"], /noindex/);
});
