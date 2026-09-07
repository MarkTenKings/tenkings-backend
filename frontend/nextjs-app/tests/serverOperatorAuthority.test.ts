import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  matchesServerOperatorKey,
  resolveServerOperatorAuthority,
} from "../lib/server/serverOperatorAuthority";

test("operator authority requires a server-only key and one exact scoped user ID", () => {
  const operatorKey = "server-only-operator-key-0123456789abcdef";
  assert.deepEqual(resolveServerOperatorAuthority({
    OPERATOR_API_KEY: operatorKey,
    OPERATOR_USER_ID: "admin-exact-id",
    OPERATOR_API_CAPABILITIES: "set-ops:batch-import",
  }), { operatorKey, operatorUserId: "admin-exact-id", capabilities: ["set-ops:batch-import"] });

  assert.equal(resolveServerOperatorAuthority({
    OPERATOR_USER_ID: "admin-exact-id",
    OPERATOR_API_CAPABILITIES: "set-ops:batch-import",
    [["NEXT", "PUBLIC", "OPERATOR", "KEY"].join("_")]: operatorKey,
  } as any), null);
  assert.equal(resolveServerOperatorAuthority({ OPERATOR_API_KEY: operatorKey }), null);
  assert.equal(resolveServerOperatorAuthority({
    OPERATOR_API_KEY: "too-short",
    OPERATOR_USER_ID: "admin-exact-id",
    OPERATOR_API_CAPABILITIES: "set-ops:batch-import",
  }), null);
  assert.equal(resolveServerOperatorAuthority({
    OPERATOR_API_KEY: operatorKey,
    OPERATOR_USER_ID: "admin,second-admin",
    OPERATOR_API_CAPABILITIES: "set-ops:batch-import",
  }), null);
  assert.equal(resolveServerOperatorAuthority({
    OPERATOR_API_KEY: operatorKey,
    OPERATOR_USER_ID: "admin-exact-id",
    OPERATOR_API_CAPABILITIES: "all-admin-routes",
  }), null);
  assert.equal(resolveServerOperatorAuthority({
    OPERATOR_API_KEY: operatorKey,
    OPERATOR_USER_ID: "admin-exact-id",
  }), null);
});

test("operator key comparison is exact and server routes contain no public-key fallback", () => {
  const key = "server-only-operator-key-0123456789abcdef";
  assert.equal(matchesServerOperatorKey(key, key), true);
  assert.equal(matchesServerOperatorKey(`${key}x`, key), false);
  assert.equal(matchesServerOperatorKey(key.replace("a", "b"), key), false);

  const root = fileURLToPath(new URL("..", import.meta.url));
  for (const relativePath of [
    "lib/server/admin.ts",
    "pages/api/collection/[itemId]/shipping-request.ts",
    "pages/api/admin/shipping/[requestId].ts",
    "pages/api/admin/shipping/requests.ts",
  ]) {
    assert.equal(readFileSync(`${root}/${relativePath}`, "utf8").includes(
      ["NEXT", "PUBLIC", "OPERATOR", "KEY"].join("_"),
    ), false);
  }
});

test("operator capability is present only on the five batch-import API dependencies", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const allowed = [
    "pages/api/admin/set-ops/sets.ts",
    "pages/api/admin/set-ops/ingestion/index.ts",
    "pages/api/admin/set-ops/drafts/build.ts",
    "pages/api/admin/set-ops/drafts/index.ts",
    "pages/api/admin/set-ops/approval.ts",
  ];
  for (const relativePath of allowed) {
    assert.match(readFileSync(`${root}/${relativePath}`, "utf8"),
      /requireAdminSessionOrOperatorCapability\(req, "set-ops:batch-import"\)/);
  }
  assert.match(readFileSync(`${root}/pages/api/admin/set-ops/ingestion/index.ts`, "utf8"),
    /req\.method === "POST"[\s\S]*requireAdminSessionOrOperatorCapability[\s\S]*requireAdminSession\(req\)/);
  const adminSource = readFileSync(`${root}/lib/server/admin.ts`, "utf8");
  const general = adminSource.slice(
    adminSource.indexOf("export async function requireAdminSession("),
    adminSource.indexOf("async function requireAdminSessionForToken"),
  );
  assert.doesNotMatch(general, /x-operator-key|resolveServerOperatorAuthority/);
});
