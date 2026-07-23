import assert from "node:assert/strict";
import test from "node:test";
import { buildAuthSessionResponse } from "./authSessionResponse.js";

test("auth session response preserves the server session creation and expiry timestamps", () => {
  const createdAt = new Date("2026-07-23T07:37:53.286Z");
  const expiresAt = new Date("2026-08-22T07:37:53.286Z");
  const response = buildAuthSessionResponse(
    {
      id: "session-id",
      tokenHash: "a".repeat(64),
      createdAt,
      expiresAt,
      user: {
        id: "user-id",
        phone: "+15555550100",
        displayName: "Admin",
        avatarUrl: null,
      },
    },
    { id: "wallet-id", balance: 10 },
  );

  assert.equal(response.session.createdAt, createdAt);
  assert.equal(response.session.expiresAt, expiresAt);
  assert.deepEqual(JSON.parse(JSON.stringify(response.session)), {
    id: "session-id",
    tokenHash: "a".repeat(64),
    createdAt: "2026-07-23T07:37:53.286Z",
    expiresAt: "2026-08-22T07:37:53.286Z",
    user: {
      id: "user-id",
      phone: "+15555550100",
      displayName: "Admin",
      avatarUrl: null,
    },
  });
});
