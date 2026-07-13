const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { buildAiGraderPublishAuthorityRecord } = require("../dist/database/src/aiGraderProductionService");
const {
  buildAiGraderNfcTagUrl,
  completeAiGraderNfcProgramming,
  describeAiGraderNfcSecurityStrategy,
  generateAiGraderNfcPublicTagId,
  getAiGraderNfcStatus,
  initAiGraderNfcProgramming,
  replaceAiGraderNfcTag,
  revokeAiGraderNfcTag,
} = require("../dist/database/src/aiGraderNfcService");

const TOKEN_SECRET = "nfc-test-token-secret-32-bytes-minimum-value";
const NOW = new Date("2026-07-12T20:00:00.000Z");
const linkage = {
  tenantId: "ten-kings",
  reportId: "report-1",
  cardAssetId: "card-1",
  itemId: "item-1",
  certId: "TK-AIG-1",
};

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function authority() {
  return buildAiGraderPublishAuthorityRecord({
    reportBundle: { reportId: "report-1", gradingSessionId: "grading-1" },
    productionRelease: {
      reportId: "report-1",
      gradingSessionId: "grading-1",
      finalGrade: { overall: 8.6 },
      label: { reportId: "report-1", certId: "TK-AIG-1" },
    },
  });
}

function matches(value, expected) {
  if (expected && typeof expected === "object" && !Array.isArray(expected)) {
    if (Array.isArray(expected.in)) return expected.in.includes(value);
    if (Object.hasOwn(expected, "not")) return value !== expected.not;
    if (Object.hasOwn(expected, "gt")) return new Date(value).getTime() > new Date(expected.gt).getTime();
  }
  return value === expected;
}

function rowMatches(row, where = {}) {
  return Object.entries(where).every(([key, expected]) => matches(row[key], expected));
}

function mockDb() {
  const publishAuthority = authority();
  const state = { tags: [], attempts: [], audits: [], lockCalls: 0 };
  const report = {
    id: "report-row-1",
    tenantId: "ten-kings",
    sessionId: "session-row-1",
    reportId: "report-1",
    publicationStatus: "published",
    publishedAt: NOW,
    cardAssetId: "card-1",
    itemId: "item-1",
    finalOverallGrade: 8.6,
    labels: [{ id: "label-row-1", certId: "TK-AIG-1" }],
  };
  const tx = {
    async $queryRaw() { state.lockCalls += 1; return []; },
    aiGraderReport: { async findUnique() { return { ...report }; } },
    aiGraderSession: { async findUnique() { return {
      id: "session-row-1", tenantId: "ten-kings", gradingSessionId: "grading-1", reportId: "report-1",
      status: "published", cardAssetId: "card-1", itemId: "item-1",
      cardIdentity: { source: "card_asset", status: "linked", cardAssetId: "card-1", itemId: "item-1" },
    }; } },
    cardAsset: { async findUnique() { return {
      id: "card-1", batchId: "batch-1",
      classificationSourcesJson: { aiGraderPublishAuthority: publishAuthority },
      aiGradingJson: { publishAuthority },
    }; } },
    item: { async findUnique() { return { id: "item-1", number: "card-1" }; } },
    aiGraderLabel: { async findUnique() { return { id: "label-row-1", tenantId: "ten-kings", reportId: "report-row-1", certId: "TK-AIG-1" }; } },
    aiGraderPublication: { async findUnique() { return { tenantId: "ten-kings", status: "published", publishedAt: NOW, revokedAt: null }; } },
    aiGraderNfcTag: {
      async findUnique({ where }) {
        if (where.publicTagId) return state.tags.find((row) => row.publicTagId === where.publicTagId) ?? null;
        if (where.id) return state.tags.find((row) => row.id === where.id) ?? null;
        return null;
      },
      async findFirst({ where = {}, orderBy } = {}) {
        const rows = state.tags.filter((row) => rowMatches(row, where));
        if (orderBy?.createdAt === "desc") rows.sort((a, b) => b.createdAt - a.createdAt);
        return rows[0] ?? null;
      },
      async create({ data }) {
        const row = { id: `tag-${state.tags.length + 1}`, uidFingerprintSha256: null, readbackPayloadSha256: null,
          programmedAt: null, verifiedAt: null, activatedAt: null, revokedAt: null, revocationReason: null,
          errorCode: null, ...data };
        state.tags.push(row);
        return row;
      },
      async update({ where, data }) {
        const row = state.tags.find((entry) => entry.id === where.id);
        if (!row) throw new Error("tag missing");
        Object.assign(row, data);
        return row;
      },
    },
    aiGraderNfcProgrammingAttempt: {
      async findUnique({ where, include }) {
        let row;
        if (where.id) row = state.attempts.find((entry) => entry.id === where.id);
        else if (where.tenantId_requestedByUserId_idempotencyKeyHash) {
          row = state.attempts.find((entry) => rowMatches(entry, where.tenantId_requestedByUserId_idempotencyKeyHash));
        }
        if (!row) return null;
        return include?.tag ? { ...row, tag: state.tags.find((tag) => tag.id === row.tagId) } : row;
      },
      async findFirst({ where = {}, orderBy } = {}) {
        const rows = state.attempts.filter((row) => rowMatches(row, where));
        if (orderBy?.requestedAt === "desc") rows.sort((a, b) => b.requestedAt - a.requestedAt);
        return rows[0] ?? null;
      },
      async create({ data }) { const row = { completionIdempotencyKeyHash: null, ...data }; state.attempts.push(row); return row; },
      async update({ where, data }) { const row = state.attempts.find((entry) => entry.id === where.id); Object.assign(row, data); return row; },
      async updateMany({ where, data }) {
        let count = 0;
        for (const row of state.attempts) if (rowMatches(row, where)) { Object.assign(row, data); count += 1; }
        return { count };
      },
    },
    aiGraderNfcAuditEvent: {
      async create({ data }) { const row = { id: `audit-${state.audits.length + 1}`, ...data }; state.audits.push(row); return row; },
      async findFirst({ where, orderBy }) {
        const rows = state.audits.filter((row) => rowMatches(row, where));
        if (orderBy?.createdAt === "desc") rows.sort((a, b) => b.createdAt - a.createdAt);
        return rows[0] ?? null;
      },
    },
  };
  let queue = Promise.resolve();
  const db = {
    ...tx,
    $transaction(callback) {
      const run = queue.then(() => callback(tx));
      queue = run.catch(() => undefined);
      return run;
    },
  };
  return { db, state };
}

async function reserve(runtime, idempotencyKey = "init-report-1") {
  return initAiGraderNfcProgramming({
    ...linkage, requestedByUserId: "operator-1", idempotencyKey,
    tokenSecret: TOKEN_SECRET, attemptTtlMs: 5 * 60_000, now: NOW, dbClient: runtime.db,
  });
}

async function complete(runtime, init, overrides = {}) {
  return completeAiGraderNfcProgramming({
    ...linkage,
    requestedByUserId: "operator-1",
    attemptId: init.attemptId,
    attemptToken: init.attemptToken,
    idempotencyKey: "complete-report-1",
    uidFingerprintSha256: "a".repeat(64),
    normalizedNdefUrl: init.expectedNdefUrl,
    readbackPayloadSha256: sha256(init.expectedNdefUrl),
    chipType: "NTAG215",
    securityMode: "static_url_v1",
    dbClient: runtime.db,
    now: new Date(NOW.getTime() + 5_000),
    ...overrides,
  });
}

test("NFC publicTagId is 192-bit random, URL-safe, unique, and server constructs the only URL", () => {
  const ids = new Set(Array.from({ length: 256 }, () => generateAiGraderNfcPublicTagId()));
  assert.equal(ids.size, 256);
  for (const id of ids) {
    assert.match(id, /^[A-Za-z0-9_-]{32}$/);
    assert.equal(buildAiGraderNfcTagUrl(id), `https://collect.tenkings.co/nfc/${id}`);
  }
  assert.throws(() => buildAiGraderNfcTagUrl("caller-selected"), /public tag ID is invalid/i);
});

test("NTAG215 is registered-link only and future NTAG424 seam cannot claim crypto success", () => {
  assert.deepEqual(describeAiGraderNfcSecurityStrategy("NTAG215", "static_url_v1"), {
    chipType: "NTAG215", securityMode: "static_url_v1", implemented: true,
    registrationKind: "registered_link", cryptographicVerificationAvailable: false,
  });
  const future = describeAiGraderNfcSecurityStrategy("NTAG424_DNA", "ntag424_sun_v1");
  assert.equal(future.implemented, false);
  assert.equal(future.registrationKind, null);
  assert.equal(future.cryptographicVerificationAvailable, false);
});

test("concurrent init is report-locked and idempotently returns one reservation/attempt without raw token at rest", async () => {
  const runtime = mockDb();
  const [first, second] = await Promise.all([reserve(runtime), reserve(runtime)]);
  assert.equal(first.publicTagId, second.publicTagId);
  assert.equal(first.attemptId, second.attemptId);
  assert.equal(first.attemptToken, second.attemptToken);
  assert.equal(runtime.state.tags.length, 1);
  assert.equal(runtime.state.attempts.length, 1);
  assert.equal("attemptToken" in runtime.state.attempts[0], false);
  assert.match(runtime.state.attempts[0].tokenHash, /^[a-f0-9]{64}$/);
  assert.ok(runtime.state.lockCalls >= 2);
});

test("complete activates exactly once, allows only exact idempotent retry, and never returns UID evidence", async () => {
  const runtime = mockDb();
  const init = await reserve(runtime);
  const active = await complete(runtime, init);
  assert.equal(active.status, "active");
  assert.equal(active.registrationKind, "registered_link");
  assert.equal(active.cryptographicallyVerified, false);
  assert.equal("uidFingerprintSha256" in active, false);
  assert.equal(runtime.state.attempts[0].state, "consumed");
  assert.match(runtime.state.attempts[0].completionIdempotencyKeyHash, /^[a-f0-9]{64}$/);
  assert.equal((await complete(runtime, init)).status, "active");
  assert.equal((await complete(runtime, init, { now: new Date(NOW.getTime() + 20 * 60_000) })).status, "active");
  await assert.rejects(complete(runtime, init, { idempotencyKey: "different-complete-key" }), { code: "AI_GRADER_NFC_TOKEN_REPLAY" });
});

test("complete fails closed for wrong actor/linkage/url/fingerprint, expiry, duplicate UID, and raw UID", async () => {
  for (const overrides of [
    { requestedByUserId: "operator-2" },
    { itemId: "wrong-item" },
    { normalizedNdefUrl: "https://collect.tenkings.co/nfc/" + "Z".repeat(32) },
    { uidFingerprintSha256: "raw-uid" },
  ]) {
    const runtime = mockDb();
    const init = await reserve(runtime);
    await assert.rejects(complete(runtime, init, overrides));
    assert.notEqual(runtime.state.tags[0].status, "active");
  }

  const expiredRuntime = mockDb();
  const expiredInit = await reserve(expiredRuntime);
  await assert.rejects(complete(expiredRuntime, expiredInit, { now: new Date(NOW.getTime() + 6 * 60_000) }), { code: "AI_GRADER_NFC_ATTEMPT_EXPIRED" });
  assert.equal(expiredRuntime.state.attempts[0].state, "expired");
  assert.equal(expiredRuntime.state.attempts[0].failureCode, "AI_GRADER_NFC_ATTEMPT_EXPIRED");

  const duplicateRuntime = mockDb();
  const duplicateInit = await reserve(duplicateRuntime);
  duplicateRuntime.state.tags.push({ ...duplicateRuntime.state.tags[0], id: "other-tag", publicTagId: "Z".repeat(32), reportId: "other-report", status: "active", uidFingerprintSha256: "a".repeat(64) });
  await assert.rejects(complete(duplicateRuntime, duplicateInit), { code: "AI_GRADER_NFC_UID_ALREADY_ACTIVE" });

  await assert.rejects(initAiGraderNfcProgramming({
    ...linkage, requestedByUserId: "operator-1", idempotencyKey: "raw-uid-init", rawUid: "04AABBCC",
    tokenSecret: TOKEN_SECRET, dbClient: mockDb().db,
  }), { code: "AI_GRADER_NFC_RAW_UID_REJECTED" });
});

test("revoke is immutable/idempotent and replacement revokes before creating a distinct reservation", async () => {
  const runtime = mockDb();
  const init = await reserve(runtime);
  await complete(runtime, init);
  const revoked = await revokeAiGraderNfcTag({
    ...linkage, publicTagId: init.publicTagId, requestedByUserId: "operator-1",
    reason: "Operator replaced damaged slab tag", idempotencyKey: "revoke-report-1", dbClient: runtime.db,
    now: new Date(NOW.getTime() + 10_000),
  });
  assert.equal(revoked.status, "revoked");
  assert.equal(revoked.revocationReason, "Operator replaced damaged slab tag");
  assert.equal((await revokeAiGraderNfcTag({
    ...linkage, publicTagId: init.publicTagId, requestedByUserId: "operator-1",
    reason: "Operator replaced damaged slab tag", idempotencyKey: "revoke-report-1", dbClient: runtime.db,
  })).status, "revoked");
  await assert.rejects(revokeAiGraderNfcTag({
    ...linkage, publicTagId: init.publicTagId, requestedByUserId: "operator-1",
    reason: "Different reason must not rewrite audit", idempotencyKey: "different-revoke", dbClient: runtime.db,
  }), { code: "AI_GRADER_NFC_ALREADY_REVOKED" });

  const replacementRuntime = mockDb();
  const original = await reserve(replacementRuntime);
  await complete(replacementRuntime, original);
  const replacement = await replaceAiGraderNfcTag({
    ...linkage, replacedPublicTagId: original.publicTagId, requestedByUserId: "operator-1",
    revocationReason: "Replace exact active NFC registration", idempotencyKey: "replace-report-1",
    tokenSecret: TOKEN_SECRET, attemptTtlMs: 5 * 60_000, dbClient: replacementRuntime.db,
    now: new Date(NOW.getTime() + 20_000),
  });
  assert.equal(replacementRuntime.state.tags[0].status, "revoked");
  assert.equal(replacement.status, "programming");
  assert.notEqual(replacement.publicTagId, original.publicTagId);
  assert.equal(replacementRuntime.state.tags.length, 2);
  const retriedReplacement = await replaceAiGraderNfcTag({
    ...linkage, replacedPublicTagId: original.publicTagId, requestedByUserId: "operator-1",
    revocationReason: "Replace exact active NFC registration", idempotencyKey: "replace-report-1",
    tokenSecret: TOKEN_SECRET, attemptTtlMs: 5 * 60_000, dbClient: replacementRuntime.db,
    now: new Date(NOW.getTime() + 20_000),
  });
  assert.equal(retriedReplacement.publicTagId, replacement.publicTagId);
  assert.equal(replacementRuntime.state.tags.length, 2);
});

test("safe status returns exact linkage and no UID fingerprint, token, attempt, path, or helper details", async () => {
  const runtime = mockDb();
  const missing = await getAiGraderNfcStatus({ tenantId: "ten-kings", reportId: "report-1", dbClient: runtime.db });
  assert.deepEqual({ status: missing.status, cardAssetId: missing.cardAssetId, itemId: missing.itemId, certId: missing.certId }, {
    status: "missing", cardAssetId: "card-1", itemId: "item-1", certId: "TK-AIG-1",
  });
  const json = JSON.stringify(await reserve(runtime));
  assert.equal(json.includes("uidFingerprint"), false);
  assert.equal(json.includes("rawUid"), false);
  assert.equal(json.includes("localPath"), false);
  assert.equal(json.includes("helper"), false);
});
