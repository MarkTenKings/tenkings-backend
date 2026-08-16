import assert from "node:assert/strict";
import test from "node:test";
import type { NextApiRequest, NextApiResponse } from "next";

import {
  canonicalizeNewSpeedsterSessionIdentity,
  canonicalizeSpeedsterSessionIdentity,
} from "../lib/ai-grader-v2/identity";
import { createAiGraderV2SessionsHandler } from "../pages/api/admin/ai-grader-v2/sessions";

const legacyPokemon = {
  cardName: "Squirtle",
  year: "2023 Pokemon",
  productSet: "MEW EN",
  parallel: "Reverse Holo",
  cardNumber: "007/165",
} as const;

function response() {
  const state: { status?: number; body?: unknown } = {};
  const res = {
    setHeader() { return this; },
    status(code: number) { state.status = code; return this; },
    json(body: unknown) { state.body = body; return this; },
  } as unknown as NextApiResponse;
  return { state, res };
}

test("historical Pokemon identity stays readable but the new-session boundary requires layoutType", () => {
  assert.deepEqual(canonicalizeSpeedsterSessionIdentity("POKEMON", legacyPokemon), {
    ...legacyPokemon,
    parallel: "Reverse Holo",
    cardNumber: "007/165",
  });
  assert.throws(
    () => canonicalizeNewSpeedsterSessionIdentity("POKEMON", legacyPokemon),
    /Complete the required Speedster identity fields/,
  );
  assert.deepEqual(canonicalizeNewSpeedsterSessionIdentity("POKEMON", {
    ...legacyPokemon,
    layoutType: "TRAINER",
  }), {
    ...legacyPokemon,
    parallel: "Reverse Holo",
    cardNumber: "007/165",
    layoutType: "TRAINER",
  });
});

test("session API rejects layoutless new Pokemon identity and persists the human selection verbatim", async () => {
  const created: unknown[] = [];
  const handler = createAiGraderV2SessionsHandler({
    async requireAdminSession() { return { user: { id: "admin-1" } }; },
    async createSession(data) { created.push(data); return { id: "session-v2", ...data }; },
  });

  const missing = response();
  await handler({
    method: "POST",
    body: { cardProfile: "POKEMON", identity: legacyPokemon },
    headers: {},
  } as NextApiRequest, missing.res);
  assert.equal(missing.state.status, 400);
  assert.equal(created.length, 0);
  assert.match(JSON.stringify(missing.state.body), /layout type is required/i);

  const accepted = response();
  await handler({
    method: "POST",
    body: { cardProfile: "POKEMON", identity: { ...legacyPokemon, layoutType: "ENERGY" } },
    headers: {},
  } as NextApiRequest, accepted.res);
  assert.equal(accepted.state.status, 201);
  assert.equal(created.length, 1);
  assert.equal((created[0] as { identity: { layoutType: string } }).identity.layoutType, "ENERGY");
});
