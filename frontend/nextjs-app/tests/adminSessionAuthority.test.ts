import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { lookupViaAuthService } from "../lib/server/admin";
import {
  HttpError,
  parseRemoteAdminSession,
  validateFreshAdminSession,
  type AdminSession,
  type LocalAdminSessionRecord,
} from "../lib/server/adminSessionAuthority";

const NOW = Date.parse("2026-07-23T08:00:00.000Z");
const TOKEN = "presented-browser-session-token";
const TOKEN_HASH = createHash("sha256").update(TOKEN).digest("hex");
const MAX_AGE_MS = 15 * 60 * 1000;

function remotePayload(overrides: Record<string, unknown> = {}) {
  const sessionOverrides =
    overrides.session && typeof overrides.session === "object" && !Array.isArray(overrides.session)
      ? (overrides.session as Record<string, unknown>)
      : {};
  const payload = {
    session: {
      id: "remote-session-id",
      tokenHash: TOKEN_HASH,
      createdAt: "2026-07-23T07:50:00.000Z",
      expiresAt: "2026-07-23T09:00:00.000Z",
      user: {
        id: "remote-admin-id",
        phone: "+15555550100",
        displayName: "Admin",
      },
    },
  };
  for (const [key, value] of Object.entries(sessionOverrides)) {
    if (key === "user" && value && typeof value === "object" && !Array.isArray(value)) {
      payload.session.user = { ...payload.session.user, ...(value as Record<string, unknown>) } as typeof payload.session.user;
    } else {
      (payload.session as Record<string, unknown>)[key] = value;
    }
  }
  return payload;
}

function localAdmin(overrides: Partial<AdminSession> = {}): AdminSession {
  return {
    sessionId: "local-session-id",
    tokenHash: TOKEN_HASH,
    authority: "local-database",
    createdAt: new Date(NOW - 5 * 60 * 1000),
    expiresAt: new Date(NOW + 60 * 60 * 1000),
    user: {
      id: "local-admin-id",
      phone: "+15555550100",
      displayName: "Admin",
    },
    ...overrides,
  };
}

function localRecord(overrides: Partial<LocalAdminSessionRecord> = {}): LocalAdminSessionRecord {
  return {
    id: "local-session-id",
    tokenHash: TOKEN_HASH,
    createdAt: new Date(NOW - 5 * 60 * 1000),
    expiresAt: new Date(NOW + 60 * 60 * 1000),
    user: { id: "local-admin-id" },
    ...overrides,
  };
}

async function rejectsStatus(action: () => Promise<unknown>, statusCode: number) {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.statusCode, statusCode);
    return true;
  });
}

test("remote fresh session succeeds while the local Session table is empty", async () => {
  const remote = parseRemoteAdminSession(remotePayload(), TOKEN, NOW);
  let localLookups = 0;
  const result = await validateFreshAdminSession(remote, {
    maximumAgeMs: MAX_AGE_MS,
    nowMs: NOW,
    async findLocalSession() {
      localLookups += 1;
      return null;
    },
  });

  assert.equal(result.authority, "auth-service");
  assert.equal(result.sessionId, "remote-session-id");
  assert.equal(localLookups, 0, "remote authority must never query the unrelated local Session table");
});

test("remote stale, future, expired, missing, invalid, and non-finite timestamps reject", async () => {
  const stale = parseRemoteAdminSession(
    remotePayload({ session: { createdAt: "2026-07-23T07:44:59.999Z" } }),
    TOKEN,
    NOW,
  );
  await rejectsStatus(
    () =>
      validateFreshAdminSession(stale, {
        maximumAgeMs: MAX_AGE_MS,
        nowMs: NOW,
        async findLocalSession() {
          throw new Error("local lookup must not run");
        },
      }),
    403,
  );

  for (const payload of [
    remotePayload({ session: { createdAt: "2026-07-23T08:00:00.001Z" } }),
    remotePayload({ session: { expiresAt: "2026-07-23T08:00:00.000Z" } }),
    remotePayload({ session: { createdAt: undefined } }),
    remotePayload({ session: { createdAt: "not-a-timestamp" } }),
    remotePayload({ session: { createdAt: "Infinity" } }),
    remotePayload({ session: { createdAt: "2026-07-23T07:50:00Z" } }),
  ]) {
    assert.throws(() => parseRemoteAdminSession(payload, TOKEN, NOW), HttpError);
  }
});

test("remote token hash mismatch and malformed session or user identities reject", () => {
  for (const payload of [
    remotePayload({ session: { tokenHash: "b".repeat(64) } }),
    remotePayload({ session: { tokenHash: "not-a-sha256" } }),
    remotePayload({ session: { id: " remote-session-id" } }),
    remotePayload({ session: { id: { unexpected: true } } }),
    remotePayload({ session: { user: { id: "remote-admin-id " } } }),
    remotePayload({ session: { user: null } }),
  ]) {
    assert.throws(() => parseRemoteAdminSession(payload, TOKEN, NOW), HttpError);
  }
});

test("operator authority is never accepted as a fresh human session", async () => {
  await rejectsStatus(
    () =>
      validateFreshAdminSession(
        {
          sessionId: "operator-key:admin-id",
          tokenHash: "operator-key",
          authority: "operator-key",
          user: { id: "admin-id", phone: null, displayName: null },
        },
        {
          maximumAgeMs: MAX_AGE_MS,
          nowMs: NOW,
          async findLocalSession() {
            throw new Error("operator authority must reject before local lookup");
          },
        },
      ),
    403,
  );
});

test("local fresh session still succeeds and preserves exact local revalidation", async () => {
  let lookups = 0;
  const admin = localAdmin();
  const result = await validateFreshAdminSession(admin, {
    maximumAgeMs: MAX_AGE_MS,
    nowMs: NOW,
    async findLocalSession(id) {
      lookups += 1;
      assert.equal(id, admin.sessionId);
      return localRecord();
    },
  });
  assert.equal(result, admin);
  assert.equal(lookups, 1);
});

test("local stale, expired, token mismatch, and user mismatch behavior remains fail-closed", async () => {
  for (const record of [
    localRecord({ createdAt: new Date(NOW - MAX_AGE_MS - 1) }),
    localRecord({ expiresAt: new Date(NOW) }),
    localRecord({ tokenHash: "b".repeat(64) }),
    localRecord({ user: { id: "different-user" } }),
  ]) {
    await assert.rejects(() =>
      validateFreshAdminSession(localAdmin(), {
        maximumAgeMs: MAX_AGE_MS,
        nowMs: NOW,
        async findLocalSession() {
          return record;
        },
      }),
    );
  }
});

test("authoritative non-OK and malformed auth-service responses reject without local fallback", async () => {
  const response = (status: number, payload: unknown) =>
    ({
      status,
      ok: status >= 200 && status < 300,
      async json() {
        return payload;
      },
    }) as Response;

  await rejectsStatus(
    () =>
      lookupViaAuthService(TOKEN, {
        authServiceUrl: "https://auth.example.test",
        fetchImpl: async () => response(401, { message: "Session not found" }),
        nowMs: NOW,
      }),
    401,
  );
  await rejectsStatus(
    () =>
      lookupViaAuthService(TOKEN, {
        authServiceUrl: "https://auth.example.test",
        fetchImpl: async () => response(503, { message: "Unavailable" }),
        nowMs: NOW,
      }),
    503,
  );
  await rejectsStatus(
    () =>
      lookupViaAuthService(TOKEN, {
        authServiceUrl: "https://auth.example.test",
        fetchImpl: async () => response(200, { session: { id: "incomplete" } }),
        nowMs: NOW,
      }),
    502,
  );
});

test("auth-service lookup independently binds the response to the presented bearer token", async () => {
  const result = await lookupViaAuthService(TOKEN, {
    authServiceUrl: "https://auth.example.test",
    fetchImpl: async () =>
      ({
        status: 200,
        ok: true,
        async json() {
          return remotePayload();
        },
      }) as Response,
    nowMs: NOW,
  });
  assert.equal(result?.tokenHash, TOKEN_HASH);
  assert.equal(result?.authority, "auth-service");
});
