const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash, generateKeyPairSync, sign } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { buildAiGraderPublishAuthorityRecord } = require("../dist/database/src/aiGraderProductionService");
const {
  AI_GRADER_NFC_ATTESTATION_ALGORITHM,
  AI_GRADER_NFC_ATTESTATION_SCHEMA_VERSION,
  AI_GRADER_NFC_EXPECTED_HELPER_PROTOCOL_VERSION,
  buildAiGraderNfcOperationalAttestationStatement,
  buildAiGraderNfcTagUrl,
  completeAiGraderNfcProgramming,
  completeAiGraderNfcManualIos,
  confirmAiGraderNfcManualIosLock,
  describeAiGraderNfcSecurityStrategy,
  generateAiGraderNfcPublicTagId,
  getAiGraderNfcWorkstationKeyReadiness,
  getAiGraderNfcStatus,
  initAiGraderNfcManualIos,
  initAiGraderNfcProgramming,
  observeAiGraderNfcManualIosTap,
  parseAiGraderNfcWorkstationPublicKeys,
  replaceAiGraderNfcTag,
  replaceAiGraderNfcManualIos,
  revokeAiGraderNfcTag,
} = require("../dist/database/src/aiGraderNfcService");
const {
  isAiGraderNfcSchemaMissingError,
  readCachedAiGraderNfcSchemaReadiness,
  readAiGraderNfcSchemaReadiness,
} = require("../dist/database/src/aiGraderNfcSchemaReadiness");

const TOKEN_SECRET = "nfc-test-token-secret-32-bytes-minimum-value";
const NOW = new Date("2026-07-12T20:00:00.000Z");
const linkage = {
  tenantId: "ten-kings",
  reportId: "report-1",
  cardAssetId: "card-1",
  itemId: "item-1",
  certId: "TK-AIG-1",
};

function createWorkstationKey(tenantId = "ten-kings", namedCurve = "prime256v1") {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve });
  const der = publicKey.export({ format: "der", type: "spki" });
  const keyId = createHash("sha256").update(der).digest("hex");
  const publicSpkiDerBase64 = der.toString("base64");
  return {
    keyId,
    publicKey,
    privateKey,
    publicSpkiDerBase64,
    json: JSON.stringify({
      [keyId]: {
        tenantId,
        algorithm: AI_GRADER_NFC_ATTESTATION_ALGORITHM,
        publicSpkiDerBase64,
      },
    }),
  };
}

function workstationAllowlist(...workstations) {
  return JSON.stringify(Object.fromEntries(workstations.map((workstation) => [
    workstation.keyId,
    {
      tenantId: JSON.parse(workstation.json)[workstation.keyId].tenantId,
      algorithm: AI_GRADER_NFC_ATTESTATION_ALGORITHM,
      publicSpkiDerBase64: workstation.publicSpkiDerBase64,
    },
  ])));
}

const WORKSTATION = createWorkstationKey();
const PROGRAMMING_RUNTIME = {
  programmingEnabled: true,
  tokenSecret: TOKEN_SECRET,
  workstationPublicKeysJson: WORKSTATION.json,
};

test("NFC schema readiness checks every migrated runtime column and exact catalog safety objects", async () => {
  let sql = "";
  let queries = 0;
  const ready = await readAiGraderNfcSchemaReadiness({
    async $queryRaw(strings) {
      queries += 1;
      sql += strings.join("");
      if (queries === 1) return [{
        migrationLedgerReady: true,
        tagTableReady: true,
        attemptTableReady: true,
        manualIosAttemptTableReady: true,
        auditTableReady: true,
      }];
      return [{ ready: true }];
    },
  });
  assert.deepEqual(ready, { ready: true });
  assert.equal(queries, 2);
  const expectedColumns = {
    AiGraderNfcTag: [
      "id", "tenantId", "publicTagId", "chipType", "securityMode", "status",
      "uidFingerprintSha256", "ndefPayloadVersion", "expectedPayloadSha256",
      "readbackPayloadSha256", "aiGraderReportId", "reportId", "cardAssetId",
      "itemId", "aiGraderLabelId", "certId", "createdByUserId",
      "programmedByUserId", "verifiedByUserId", "activatedByUserId",
      "revokedByUserId", "programmedAt", "verifiedAt", "activatedAt",
      "revokedAt", "revocationReason", "errorCode", "metadata", "createdAt", "updatedAt",
    ],
    AiGraderNfcProgrammingAttempt: [
      "id", "tagId", "tenantId", "reportId", "cardAssetId", "itemId", "certId",
      "requestedByUserId", "idempotencyKeyHash", "completionIdempotencyKeyHash",
      "tokenHash", "attestationChallengeHash", "expectedAttestationAlgorithm",
      "completedWorkstationKeyId", "state", "requestedAt", "expiresAt", "failureCode",
      "readbackEvidence", "consumedAt", "createdAt", "updatedAt",
    ],
    AiGraderNfcManualIosAttempt: [
      "id", "tagId", "tenantId", "reportId", "cardAssetId", "itemId", "certId",
      "requestedByUserId", "idempotencyKeyHash", "completionIdempotencyKeyHash", "state",
      "profileVersion", "qualificationProfile", "expectedPayloadSha256", "readbackPayloadSha256",
      "preLockTapObservedAt", "lockStatusConfirmedAt", "lockStatusConfirmedByUserId",
      "writeProtectionEvidence", "postLockTapObservedAt", "workstationOperationalAttestation",
      "cryptographicTagAuthentication", "requestedAt", "expiresAt", "failureCode",
      "consumedAt", "createdAt", "updatedAt",
    ],
    AiGraderNfcAuditEvent: [
      "id", "tagId", "attemptId", "tenantId", "reportId", "action", "fromStatus",
      "toStatus", "actorUserId", "reasonCode", "safeDetails", "createdAt",
    ],
  };
  for (const [tableName, columnNames] of Object.entries(expectedColumns)) {
    for (const columnName of columnNames) {
      assert.equal(sql.includes(`('${tableName}', '${columnName}')`), true, `${tableName}.${columnName}`);
    }
  }
  for (const expected of [
    "AiGraderNfcTag",
    "AiGraderNfcProgrammingAttempt",
    "AiGraderNfcManualIosAttempt",
    "AiGraderNfcAuditEvent",
    "attestationChallengeHash",
    "completedWorkstationKeyId",
    "readbackEvidence",
    "20260712160000_ai_grader_nfc_static_url_v1",
    "AiGraderNfcTag_publicTagId_key",
    "AiGraderNfcProgrammingAttempt_tokenHash_key",
    "AiGraderNfcAttempt_request_idempotency_key",
    "AiGraderNfcManualIosAttempt_request_idempotency_key",
    "AiGraderNfcManualIosAttempt_one_live_per_tag",
    "AiGraderNfcTag_one_open_report",
    "AiGraderNfcTag_one_open_card",
    "AiGraderNfcTag_one_open_item",
    "AiGraderNfcTag_one_active_uid",
    "AiGraderNfcProgrammingAttempt_one_live_per_tag",
    "AiGraderNfcTag_aiGraderReportId_fkey",
    "AiGraderNfcAuditEvent_attemptId_fkey",
    "AiGraderNfcManualIosAttempt_profile",
    "AiGraderNfcManualIosAttempt_state_evidence",
    "AiGraderNfcProgrammingAttempt_completion_state",
    "AiGraderNfcProgrammingAttempt_attestation_evidence",
    "AiGraderNfcAuditEvent_immutable_update",
    "AiGraderNfcAuditEvent_immutable_delete",
    "expected_indexes",
    "normalizedPredicate",
    "index_row.indkey",
    "expected_fks",
    "sourceColumns",
    "targetColumns",
    "confdeltype",
    "confupdtype",
    "pg_get_constraintdef",
    "expected_constraint_fragments",
    "expected_triggers",
    "actual_triggers",
    "trigger_row.tgtype",
    "trigger_row.tgenabled",
    "trigger_function.proname",
    "trigger_function.prosrc",
  ]) assert.match(sql, new RegExp(expected));
  for (const exactDefinitionEvidence of [
    "'AiGraderNfcTag_publicTagId_key', 'AiGraderNfcTag', ARRAY['publicTagId']::text[], NULL::text",
    "'AiGraderNfcProgrammingAttempt_tokenHash_key', 'AiGraderNfcProgrammingAttempt', ARRAY['tokenHash']::text[], NULL::text",
    "'AiGraderNfcAttempt_request_idempotency_key', 'AiGraderNfcProgrammingAttempt', ARRAY['tenantId', 'requestedByUserId', 'idempotencyKeyHash']::text[], NULL::text",
    "ARRAY['tenantId', 'aiGraderReportId']::text[]",
    "ARRAY['uidFingerprintSha256']::text[]",
    "status=anyarray[''reserved'',''programming'',''verified'',''active'']",
    "state=anyarray[''initialized'',''writing'',''verified'']",
    "'AiGraderNfcTag_aiGraderReportId_fkey', 'AiGraderNfcTag', ARRAY['aiGraderReportId']::text[], 'AiGraderReport', ARRAY['id']::text[], 'r', 'c'",
    "'AiGraderNfcAuditEvent_attemptId_fkey', 'AiGraderNfcAuditEvent', ARRAY['attemptId']::text[], 'AiGraderNfcProgrammingAttempt', ARRAY['id']::text[], 'r', 'c'",
    "completionidempotencykeyhashisnotnull",
    "completionidempotencykeyhashisnull",
    "readbackevidenceisnullor",
    "readbackevidence->>''observedat''~''^[0-9]{4}-[0-9]{2}-[0-9]{2}t[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}z$''",
    "readbackevidence=jsonb_build_object",
    "cryptographictagauthentication'',false",
    "workstationoperationalattestation'',true",
    "'AiGraderNfcAuditEvent_immutable_update', 19, 'reject_ai_grader_nfc_audit_mutation'",
    "'AiGraderNfcAuditEvent_immutable_delete', 11, 'reject_ai_grader_nfc_audit_mutation'",
    "beginraiseexception''aigradernfcauditeventrowsareimmutable''end",
    'actual."normalizedPredicate" IS NOT DISTINCT FROM expected."normalizedPredicate"',
  ]) assert.equal(sql.includes(exactDefinitionEvidence), true, exactDefinitionEvidence);

  const requiredOrdinaryUniqueIndexDefinitions = [
    "('AiGraderNfcTag_publicTagId_key', 'AiGraderNfcTag', ARRAY['publicTagId']::text[], NULL::text)",
    "('AiGraderNfcProgrammingAttempt_tokenHash_key', 'AiGraderNfcProgrammingAttempt', ARRAY['tokenHash']::text[], NULL::text)",
    "('AiGraderNfcAttempt_request_idempotency_key', 'AiGraderNfcProgrammingAttempt', ARRAY['tenantId', 'requestedByUserId', 'idempotencyKeyHash']::text[], NULL::text)",
  ];
  const assertReadinessRequiresOrdinaryUniqueIndexes = (candidateSql) => {
    for (const requiredDefinition of requiredOrdinaryUniqueIndexDefinitions) {
      assert.equal(
        candidateSql.includes(requiredDefinition),
        true,
        `${requiredDefinition} must remain schema-readiness required`,
      );
    }
  };
  assert.doesNotThrow(() => assertReadinessRequiresOrdinaryUniqueIndexes(sql));
  for (const removedDefinition of requiredOrdinaryUniqueIndexDefinitions) {
    assert.throws(() => assertReadinessRequiresOrdinaryUniqueIndexes(sql.replace(removedDefinition, "")));
  }

  let absentQueries = 0;
  assert.deepEqual(await readAiGraderNfcSchemaReadiness({
    async $queryRaw() {
      absentQueries += 1;
      return [{
        migrationLedgerReady: false,
        tagTableReady: false,
        attemptTableReady: false,
        manualIosAttemptTableReady: false,
        auditTableReady: false,
      }];
    },
  }), { ready: false });
  assert.equal(absentQueries, 1);
  await assert.rejects(readAiGraderNfcSchemaReadiness({
    async $queryRaw() { throw Object.assign(new Error("database unavailable"), { code: "P1001" }); },
  }), /database unavailable/);
  let detailQueries = 0;
  await assert.rejects(readAiGraderNfcSchemaReadiness({
    async $queryRaw() {
      detailQueries += 1;
      if (detailQueries === 1) return [{
        migrationLedgerReady: true,
        tagTableReady: true,
        attemptTableReady: true,
        manualIosAttemptTableReady: true,
        auditTableReady: true,
      }];
      throw Object.assign(new Error("catalog read failed"), { code: "P1001" });
    },
  }), /catalog read failed/);
  assert.equal(detailQueries, 2);
});

test("NFC schema readiness cache coalesces probes, expires briefly, and never caches failures", async () => {
  let now = 1_000;
  let queries = 0;
  const db = {
    async $queryRaw() {
      queries += 1;
      await Promise.resolve();
      return queries % 2 === 1
        ? [{ migrationLedgerReady: true, tagTableReady: true, attemptTableReady: true, manualIosAttemptTableReady: true, auditTableReady: true }]
        : [{ ready: true }];
    },
  };
  const options = { now: () => now, readyTtlMs: 100, unavailableTtlMs: 20 };
  const [first, concurrent] = await Promise.all([
    readCachedAiGraderNfcSchemaReadiness(db, options),
    readCachedAiGraderNfcSchemaReadiness(db, options),
  ]);
  assert.deepEqual(first, { ready: true });
  assert.deepEqual(concurrent, first);
  assert.equal(queries, 2);
  assert.deepEqual(await readCachedAiGraderNfcSchemaReadiness(db, options), first);
  assert.equal(queries, 2);
  now += 100;
  assert.deepEqual(await readCachedAiGraderNfcSchemaReadiness(db, options), first);
  assert.equal(queries, 4);

  let absentQueries = 0;
  const absentDb = {
    async $queryRaw() {
      absentQueries += 1;
      return [{ migrationLedgerReady: false, tagTableReady: false, attemptTableReady: false, manualIosAttemptTableReady: false, auditTableReady: false }];
    },
  };
  assert.deepEqual(await readCachedAiGraderNfcSchemaReadiness(absentDb, options), { ready: false });
  assert.deepEqual(await readCachedAiGraderNfcSchemaReadiness(absentDb, options), { ready: false });
  assert.equal(absentQueries, 1);
  now += 20;
  assert.deepEqual(await readCachedAiGraderNfcSchemaReadiness(absentDb, options), { ready: false });
  assert.equal(absentQueries, 2);

  let failures = 0;
  const failedDb = {
    async $queryRaw() {
      failures += 1;
      throw new Error("catalog probe unavailable");
    },
  };
  await assert.rejects(readCachedAiGraderNfcSchemaReadiness(failedDb, options), /catalog probe unavailable/);
  await assert.rejects(readCachedAiGraderNfcSchemaReadiness(failedDb, options), /catalog probe unavailable/);
  assert.equal(failures, 2);
});

test("NFC missing-schema classification never masks unrelated database failures", () => {
  assert.equal(isAiGraderNfcSchemaMissingError({
    code: "P2021", meta: { table: "public.AiGraderNfcTag" },
  }), true);
  assert.equal(isAiGraderNfcSchemaMissingError({
    code: "42P01", table: "AiGraderNfcProgrammingAttempt",
  }), true);
  assert.equal(isAiGraderNfcSchemaMissingError({
    code: "P2010",
    meta: { code: "42P01", message: 'relation "AiGraderNfcAuditEvent" does not exist' },
  }), true);
  assert.equal(isAiGraderNfcSchemaMissingError({
    code: "P2010",
    meta: { code: "42P01", message: 'relation "Item" does not exist' },
  }), false);
  assert.equal(isAiGraderNfcSchemaMissingError({ code: "P2021", meta: { table: "Item" } }), false);
  assert.equal(isAiGraderNfcSchemaMissingError({ code: "P1001", meta: { table: "AiGraderNfcTag" } }), false);
  assert.equal(isAiGraderNfcSchemaMissingError(new Error("relation AiGraderNfcTag does not exist")), false);
});

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
    if (Object.hasOwn(expected, "lte")) return new Date(value).getTime() <= new Date(expected.lte).getTime();
  }
  return value === expected;
}

function rowMatches(row, where = {}) {
  return Object.entries(where).every(([key, expected]) => matches(row[key], expected));
}

function mockDb() {
  const publishAuthority = authority();
  const state = { tags: [], attempts: [], manualAttempts: [], audits: [], lockCalls: 0 };
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
      async findFirst({ where = {}, orderBy, include } = {}) {
        const rows = state.tags.filter((row) => rowMatches(row, where));
        if (orderBy?.createdAt === "desc") rows.sort((a, b) => b.createdAt - a.createdAt);
        const row = rows[0] ?? null;
        return row && include?.manualIosAttempts
          ? { ...row, manualIosAttempts: state.manualAttempts.filter((attempt) => attempt.tagId === row.id).sort((a, b) => b.requestedAt - a.requestedAt).slice(0, 1) }
          : row;
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
      async findMany({ where = {}, orderBy } = {}) {
        const rows = state.attempts.filter((row) => rowMatches(row, where));
        if (orderBy?.requestedAt === "asc") rows.sort((a, b) => a.requestedAt - b.requestedAt);
        if (orderBy?.requestedAt === "desc") rows.sort((a, b) => b.requestedAt - a.requestedAt);
        return rows;
      },
      async create({ data }) {
        const row = {
          completionIdempotencyKeyHash: null,
          completedWorkstationKeyId: null,
          failureCode: null,
          readbackEvidence: null,
          consumedAt: null,
          ...data,
        };
        state.attempts.push(row);
        return row;
      },
      async update({ where, data }) { const row = state.attempts.find((entry) => entry.id === where.id); Object.assign(row, data); return row; },
      async updateMany({ where, data }) {
        let count = 0;
        for (const row of state.attempts) if (rowMatches(row, where)) { Object.assign(row, data); count += 1; }
        return { count };
      },
    },
    aiGraderNfcManualIosAttempt: {
      async findUnique({ where, include }) {
        let row;
        if (where.id) row = state.manualAttempts.find((entry) => entry.id === where.id);
        else if (where.tenantId_requestedByUserId_idempotencyKeyHash) {
          row = state.manualAttempts.find((entry) => rowMatches(entry, where.tenantId_requestedByUserId_idempotencyKeyHash));
        }
        if (!row) return null;
        return include?.tag ? { ...row, tag: state.tags.find((tag) => tag.id === row.tagId) } : row;
      },
      async findFirst({ where = {}, orderBy } = {}) {
        const rows = state.manualAttempts.filter((row) => rowMatches(row, where));
        if (orderBy?.requestedAt === "desc") rows.sort((a, b) => b.requestedAt - a.requestedAt);
        return rows[0] ?? null;
      },
      async findMany({ where = {}, orderBy } = {}) {
        const rows = state.manualAttempts.filter((row) => rowMatches(row, where));
        if (orderBy?.requestedAt === "asc") rows.sort((a, b) => a.requestedAt - b.requestedAt);
        return rows;
      },      async create({ data }) {
        const row = {
          completionIdempotencyKeyHash: null,
          readbackPayloadSha256: null,
          preLockTapObservedAt: null,
          lockStatusConfirmedAt: null,
          lockStatusConfirmedByUserId: null,
          writeProtectionEvidence: null,
          postLockTapObservedAt: null,
          failureCode: null,
          consumedAt: null,
          ...data,
        };
        state.manualAttempts.push(row);
        return row;
      },
      async update({ where, data }) {
        const row = state.manualAttempts.find((entry) => entry.id === where.id);
        if (!row) throw new Error("manual attempt missing");
        Object.assign(row, data);
        return row;
      },
      async updateMany({ where, data }) {
        let count = 0;
        for (const row of state.manualAttempts) if (rowMatches(row, where)) { Object.assign(row, data); count += 1; }
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

async function reserve(runtime, idempotencyKey = "init-report-1", overrides = {}) {
  return initAiGraderNfcProgramming({
    ...linkage, requestedByUserId: "operator-1", idempotencyKey,
    ...PROGRAMMING_RUNTIME,
    attemptTtlMs: 5 * 60_000,
    now: NOW,
    dbClient: runtime.db,
    ...overrides,
  });
}

async function reserveManual(runtime, idempotencyKey = "manual-ios-init-report-1", overrides = {}) {
  return initAiGraderNfcManualIos({
    ...linkage,
    requestedByUserId: "operator-1",
    idempotencyKey,
    programmingEnabled: true,
    manualIosEnabled: true,
    attemptTtlMs: 5 * 60_000,
    now: NOW,
    dbClient: runtime.db,
    ...overrides,
  });
}

function signedCompletionInput(runtime, init, options = {}) {
  const workstation = options.workstation ?? WORKSTATION;
  const observedAt = options.observedAt ?? new Date(NOW.getTime() + 5_000).toISOString();
  const statementInput = {
    attemptId: init.attemptId,
    attestationChallenge: init.attestationChallenge,
    publicTagId: init.publicTagId,
    normalizedUrl: init.expectedNdefUrl,
    uidFingerprintSha256: options.uidFingerprintSha256 ?? "a".repeat(64),
    readbackPayloadSha256: options.readbackPayloadSha256 ?? sha256(init.expectedNdefUrl),
    readerResultCode: options.readerResultCode ?? "write_verified_pcsc_readback",
    helperProtocolVersion: options.helperProtocolVersion ?? AI_GRADER_NFC_EXPECTED_HELPER_PROTOCOL_VERSION,
    observedAt,
    ...(options.statementOverrides ?? {}),
  };
  const statement = options.rawStatement ?? buildAiGraderNfcOperationalAttestationStatement(statementInput);
  const signature = sign("sha256", Buffer.from(statement, "utf8"), {
    key: workstation.privateKey,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  return {
    ...linkage,
    requestedByUserId: "operator-1",
    attemptId: init.attemptId,
    attemptToken: init.attemptToken,
    publicTagId: init.publicTagId,
    idempotencyKey: "complete-report-1",
    uidFingerprintSha256: statementInput.uidFingerprintSha256,
    normalizedNdefUrl: init.expectedNdefUrl,
    readbackPayloadSha256: statementInput.readbackPayloadSha256,
    chipType: "NTAG215",
    securityMode: "static_url_v1",
    readerResultCode: statementInput.readerResultCode,
    helperProtocolVersion: statementInput.helperProtocolVersion,
    operationalAttestation: {
      schemaVersion: AI_GRADER_NFC_ATTESTATION_SCHEMA_VERSION,
      workstationKeyId: workstation.keyId,
      algorithm: AI_GRADER_NFC_ATTESTATION_ALGORITHM,
      attestationChallenge: init.attestationChallenge,
      observedAt,
      signature,
    },
    ...PROGRAMMING_RUNTIME,
    dbClient: runtime.db,
    now: new Date(NOW.getTime() + 5_000),
  };
}

async function complete(runtime, init, overrides = {}, signedOptions = {}) {
  const base = signedCompletionInput(runtime, init, signedOptions);
  return completeAiGraderNfcProgramming({
    ...base,
    ...overrides,
    operationalAttestation: {
      ...base.operationalAttestation,
      ...(overrides.operationalAttestation ?? {}),
    },
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

test("workstation allowlist is bounded, exact, digest-bound, P-256-only, tenant-scoped, and redacted", () => {
  const parsed = parseAiGraderNfcWorkstationPublicKeys(WORKSTATION.json);
  assert.equal(parsed.size, 1);
  assert.equal(parsed.get(WORKSTATION.keyId).tenantId, "ten-kings");
  assert.deepEqual(getAiGraderNfcWorkstationKeyReadiness(WORKSTATION.json, "ten-kings"), {
    configured: true,
    keyCount: 1,
  });
  assert.deepEqual(getAiGraderNfcWorkstationKeyReadiness(WORKSTATION.json, "other-tenant"), {
    configured: false,
    keyCount: 0,
  });

  const entry = JSON.stringify(JSON.parse(WORKSTATION.json)[WORKSTATION.keyId]);
  const p384 = createWorkstationKey("ten-kings", "secp384r1");
  const invalid = [
    "x".repeat(16 * 1024 + 1),
    `{${Array.from({ length: 9 }, (_, index) => `"${String(index).padStart(64, "0")}":{}`).join(",")}}`,
    `{"${WORKSTATION.keyId}":${entry},"${WORKSTATION.keyId}":${entry}}`,
    `{"${WORKSTATION.keyId}":{"tenantId":"other-tenant","tenantId":"ten-kings","algorithm":"${AI_GRADER_NFC_ATTESTATION_ALGORITHM}","publicSpkiDerBase64":"${WORKSTATION.publicSpkiDerBase64}"}}`,
    `{"${WORKSTATION.keyId}":{"tenantId":"ten-kings","algorithm":"wrong","algorithm":"${AI_GRADER_NFC_ATTESTATION_ALGORITHM}","publicSpkiDerBase64":"${WORKSTATION.publicSpkiDerBase64}"}}`,
    `{"${WORKSTATION.keyId}":{"tenantId":"ten-kings","algorithm":"${AI_GRADER_NFC_ATTESTATION_ALGORITHM}","publicSpkiDerBase64":"wrong","publicSpkiDerBase64":"${WORKSTATION.publicSpkiDerBase64}"}}`,
    JSON.stringify({
      ["0".repeat(64)]: JSON.parse(WORKSTATION.json)[WORKSTATION.keyId],
    }),
    JSON.stringify({
      [WORKSTATION.keyId]: {
        ...JSON.parse(WORKSTATION.json)[WORKSTATION.keyId],
        unexpected: true,
      },
    }),
    JSON.stringify({
      [WORKSTATION.keyId]: {
        tenantId: "ten-kings",
        algorithm: "ecdsa-p256-sha256-der",
        publicSpkiDerBase64: WORKSTATION.publicSpkiDerBase64,
      },
    }),
    ...["ten kings", "ten-kings\n", "ten/kings"].map((tenantId) => JSON.stringify({
      [WORKSTATION.keyId]: {
        tenantId,
        algorithm: AI_GRADER_NFC_ATTESTATION_ALGORITHM,
        publicSpkiDerBase64: WORKSTATION.publicSpkiDerBase64,
      },
    })),
    p384.json,
  ];
  for (const raw of invalid) {
    assert.throws(() => parseAiGraderNfcWorkstationPublicKeys(raw), (error) => {
      assert.equal(error.code, "AI_GRADER_NFC_WORKSTATION_ATTESTATION_UNAVAILABLE");
      assert.equal(String(error).includes(WORKSTATION.publicSpkiDerBase64), false);
      return true;
    });
    assert.deepEqual(getAiGraderNfcWorkstationKeyReadiness(raw, "ten-kings"), {
      configured: false,
      keyCount: 0,
    });
  }
});

test("programming is default-off and enabled mode requires both token secret and tenant workstation key", async () => {
  await assert.rejects(reserve(mockDb(), "disabled-attempt", {
    programmingEnabled: false,
  }), { code: "AI_GRADER_NFC_PROGRAMMING_DISABLED", statusCode: 503 });
  await assert.rejects(reserve(mockDb(), "missing-token-attempt", {
    programmingEnabled: true,
    tokenSecret: "",
  }), { code: "AI_GRADER_NFC_TOKEN_SECRET_UNAVAILABLE", statusCode: 503 });
  await assert.rejects(reserve(mockDb(), "missing-key-attempt", {
    programmingEnabled: true,
    workstationPublicKeysJson: "",
  }), { code: "AI_GRADER_NFC_WORKSTATION_ATTESTATION_UNAVAILABLE", statusCode: 503 });
});

test("concurrent init is report-locked and idempotently returns one reservation/attempt without raw token at rest", async () => {
  const runtime = mockDb();
  const [first, second] = await Promise.all([reserve(runtime), reserve(runtime)]);
  assert.equal(first.publicTagId, second.publicTagId);
  assert.equal(first.attemptId, second.attemptId);
  assert.match(first.attemptId, /^nfc_attempt_[A-Za-z0-9_-]{43}$/);
  assert.equal(first.attemptToken, second.attemptToken);
  assert.equal(first.attestationChallenge, second.attestationChallenge);
  assert.match(first.attestationChallenge, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(runtime.state.tags.length, 1);
  assert.equal(runtime.state.attempts.length, 1);
  assert.equal("attemptToken" in runtime.state.attempts[0], false);
  assert.equal("attestationChallenge" in runtime.state.attempts[0], false);
  assert.match(runtime.state.attempts[0].tokenHash, /^[a-f0-9]{64}$/);
  assert.match(runtime.state.attempts[0].attestationChallengeHash, /^[a-f0-9]{64}$/);
  assert.equal(runtime.state.attempts[0].expectedAttestationAlgorithm, AI_GRADER_NFC_ATTESTATION_ALGORITHM);
  assert.ok(runtime.state.lockCalls >= 2);
});

test("complete activates exactly once, allows only exact idempotent retry, and never returns UID evidence", async () => {
  const runtime = mockDb();
  const init = await reserve(runtime);
  const signed = signedCompletionInput(runtime, init);
  const active = await completeAiGraderNfcProgramming(signed);
  assert.equal(active.status, "active");
  assert.equal(active.registrationKind, "registered_link");
  assert.equal(active.cryptographicallyVerified, false);
  assert.equal("uidFingerprintSha256" in active, false);
  assert.equal(runtime.state.attempts[0].state, "consumed");
  assert.match(runtime.state.attempts[0].completionIdempotencyKeyHash, /^[a-f0-9]{64}$/);
  assert.equal(runtime.state.attempts[0].completedWorkstationKeyId, WORKSTATION.keyId);
  assert.deepEqual(runtime.state.attempts[0].readbackEvidence, {
    schemaVersion: AI_GRADER_NFC_ATTESTATION_SCHEMA_VERSION,
    workstationKeyId: WORKSTATION.keyId,
    algorithm: AI_GRADER_NFC_ATTESTATION_ALGORITHM,
    statementSha256: runtime.state.attempts[0].readbackEvidence.statementSha256,
    signature: signed.operationalAttestation.signature,
    observedAt: signed.operationalAttestation.observedAt,
    helperProtocolVersion: AI_GRADER_NFC_EXPECTED_HELPER_PROTOCOL_VERSION,
    readerResultCode: "write_verified_pcsc_readback",
    cryptographicTagAuthentication: false,
    workstationOperationalAttestation: true,
  });
  assert.match(runtime.state.attempts[0].readbackEvidence.statementSha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(active).includes(WORKSTATION.keyId), false);
  assert.equal(JSON.stringify(active).includes(signed.operationalAttestation.signature), false);
  assert.equal((await completeAiGraderNfcProgramming(signed)).status, "active");
  assert.equal((await completeAiGraderNfcProgramming({
    ...signed,
    now: new Date(NOW.getTime() + 20 * 60_000),
  })).status, "active");
  await assert.rejects(completeAiGraderNfcProgramming({
    ...signed,
    idempotencyKey: "different-complete-key",
  }), { code: "AI_GRADER_NFC_TOKEN_REPLAY" });
});

test("completion requires a current tenant workstation key and an exact valid P1363 operational signature", async () => {
  const cases = [
    (base) => ({
      ...base,
      operationalAttestation: { ...base.operationalAttestation, workstationKeyId: "f".repeat(64) },
    }),
    (base) => ({
      ...base,
      operationalAttestation: { ...base.operationalAttestation, signature: "A".repeat(86) },
    }),
    (base) => ({
      ...base,
      operationalAttestation: { ...base.operationalAttestation, algorithm: "ecdsa-p256-sha256-der" },
    }),
    (base) => ({
      ...base,
      operationalAttestation: { ...base.operationalAttestation, schemaVersion: "ai-grader-nfc-helper-attestation-v0" },
    }),
    (base) => ({
      ...base,
      operationalAttestation: { ...base.operationalAttestation, signature: "" },
    }),
    (base) => ({ ...base, workstationPublicKeysJson: "" }),
  ];
  for (const mutate of cases) {
    const runtime = mockDb();
    const init = await reserve(runtime);
    await assert.rejects(completeAiGraderNfcProgramming(mutate(signedCompletionInput(runtime, init))));
    assert.notEqual(runtime.state.tags[0].status, "active");
  }

  const otherTenant = createWorkstationKey("other-tenant");
  const wrongTenantRuntime = mockDb();
  const wrongTenantInit = await reserve(wrongTenantRuntime);
  const wrongTenantSigned = signedCompletionInput(wrongTenantRuntime, wrongTenantInit, { workstation: otherTenant });
  await assert.rejects(completeAiGraderNfcProgramming({
    ...wrongTenantSigned,
    workstationPublicKeysJson: workstationAllowlist(WORKSTATION, otherTenant),
  }), { code: "AI_GRADER_NFC_WORKSTATION_KEY_REJECTED" });
  assert.notEqual(wrongTenantRuntime.state.tags[0].status, "active");
});

test("every canonical attestation field is tamper-evident and replay is attempt/report/tenant bound", async () => {
  const canonicalTamperCases = [
    (base) => ({ ...base, attemptId: `nfc_attempt_${"Z".repeat(43)}` }),
    (base) => ({
      ...base,
      operationalAttestation: { ...base.operationalAttestation, attestationChallenge: "A".repeat(43) },
    }),
    (base) => ({ ...base, publicTagId: "Z".repeat(32) }),
    (base) => ({ ...base, normalizedNdefUrl: `https://collect.tenkings.co/nfc/${"Z".repeat(32)}` }),
    (base) => ({ ...base, uidFingerprintSha256: "b".repeat(64) }),
    (base) => ({ ...base, readbackPayloadSha256: "c".repeat(64) }),
    (base) => ({ ...base, readerResultCode: "already_programmed_exact" }),
    (base) => ({ ...base, helperProtocolVersion: "tenkings-ai-grader-nfc-loopback-v3" }),
    (base) => ({
      ...base,
      operationalAttestation: {
        ...base.operationalAttestation,
        observedAt: new Date(Date.parse(base.operationalAttestation.observedAt) + 1_000).toISOString(),
      },
    }),
  ];
  for (const mutate of canonicalTamperCases) {
    const runtime = mockDb();
    const init = await reserve(runtime);
    const base = signedCompletionInput(runtime, init);
    await assert.rejects(completeAiGraderNfcProgramming(mutate(base)));
    assert.notEqual(runtime.state.tags[0].status, "active");
  }

  const wrongSchemaRuntime = mockDb();
  const wrongSchemaInit = await reserve(wrongSchemaRuntime);
  const wrongSchemaBase = signedCompletionInput(wrongSchemaRuntime, wrongSchemaInit);
  const correctStatement = buildAiGraderNfcOperationalAttestationStatement({
    attemptId: wrongSchemaBase.attemptId,
    attestationChallenge: wrongSchemaBase.operationalAttestation.attestationChallenge,
    publicTagId: wrongSchemaBase.publicTagId,
    normalizedUrl: wrongSchemaBase.normalizedNdefUrl,
    uidFingerprintSha256: wrongSchemaBase.uidFingerprintSha256,
    readbackPayloadSha256: wrongSchemaBase.readbackPayloadSha256,
    readerResultCode: wrongSchemaBase.readerResultCode,
    helperProtocolVersion: wrongSchemaBase.helperProtocolVersion,
    observedAt: wrongSchemaBase.operationalAttestation.observedAt,
  });
  const wrongSchemaSignature = sign("sha256", Buffer.from(
    correctStatement.replace(AI_GRADER_NFC_ATTESTATION_SCHEMA_VERSION, "ai-grader-nfc-helper-attestation-v0"),
    "utf8",
  ), { key: WORKSTATION.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
  await assert.rejects(completeAiGraderNfcProgramming({
    ...wrongSchemaBase,
    operationalAttestation: {
      ...wrongSchemaBase.operationalAttestation,
      signature: wrongSchemaSignature,
    },
  }), { code: "AI_GRADER_NFC_ATTESTATION_SIGNATURE_REJECTED" });

  const sourceRuntime = mockDb();
  const sourceInit = await reserve(sourceRuntime);
  const sourceSigned = signedCompletionInput(sourceRuntime, sourceInit);
  const targetRuntime = mockDb();
  const targetInit = await reserve(targetRuntime);
  const targetSigned = signedCompletionInput(targetRuntime, targetInit);
  await assert.rejects(completeAiGraderNfcProgramming({
    ...targetSigned,
    operationalAttestation: sourceSigned.operationalAttestation,
  }), { code: "AI_GRADER_NFC_ATTESTATION_CHALLENGE_REJECTED" });
  assert.notEqual(targetRuntime.state.tags[0].status, "active");

  for (const linkagePatch of [
    { reportId: "other-report" },
    { tenantId: "other-tenant" },
    { cardAssetId: "other-card" },
    { itemId: "other-item" },
    { certId: "TK-AIG-OTHER" },
  ]) {
    const runtime = mockDb();
    const init = await reserve(runtime);
    await assert.rejects(completeAiGraderNfcProgramming({
      ...signedCompletionInput(runtime, init),
      ...linkagePatch,
    }));
    assert.notEqual(runtime.state.tags[0].status, "active");
  }
});

test("attestation time, helper protocol, and readback result are strict while exact already-programmed readback is accepted", async () => {
  for (const observedAt of [
    new Date(NOW.getTime() - 2 * 60_000 - 1).toISOString(),
    new Date(NOW.getTime() + 7 * 60_000 + 1).toISOString(),
    new Date(NOW.getTime() + 2 * 60_000 + 6_001).toISOString(),
  ]) {
    const runtime = mockDb();
    const init = await reserve(runtime);
    const signed = signedCompletionInput(runtime, init, { observedAt });
    await assert.rejects(completeAiGraderNfcProgramming(signed), { code: "AI_GRADER_NFC_ATTESTATION_TIME_REJECTED" });
  }

  const nonUtcRuntime = mockDb();
  const nonUtcInit = await reserve(nonUtcRuntime);
  const nonUtcSigned = signedCompletionInput(nonUtcRuntime, nonUtcInit);
  nonUtcSigned.operationalAttestation.observedAt = "2026-07-12T20:00:05.000+00:00";
  await assert.rejects(completeAiGraderNfcProgramming(nonUtcSigned), {
    code: "AI_GRADER_NFC_ATTESTATION_TIME_INVALID",
  });

  for (const patch of [
    { readerResultCode: "partial_write" },
    { helperProtocolVersion: "tenkings-ai-grader-nfc-loopback-v1" },
  ]) {
    const runtime = mockDb();
    const init = await reserve(runtime);
    await assert.rejects(complete(runtime, init, patch));
  }

  const acceptedRuntime = mockDb();
  const acceptedInit = await reserve(acceptedRuntime);
  const accepted = signedCompletionInput(acceptedRuntime, acceptedInit, {
    readerResultCode: "already_programmed_exact",
  });
  assert.equal((await completeAiGraderNfcProgramming(accepted)).status, "active");
  assert.equal(acceptedRuntime.state.attempts[0].readbackEvidence.readerResultCode, "already_programmed_exact");
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
  assert.equal(expiredRuntime.state.tags[0].status, "reserved");
  assert.ok(expiredRuntime.state.audits.some((event) => event.action === "programming_attempt_expired"));
  assert.ok(expiredRuntime.state.audits.some((event) => event.action === "programming_attempts_expired_recover_reservation"));

  const duplicateRuntime = mockDb();
  const duplicateInit = await reserve(duplicateRuntime);
  duplicateRuntime.state.tags.push({ ...duplicateRuntime.state.tags[0], id: "other-tag", publicTagId: "Z".repeat(32), reportId: "other-report", status: "active", uidFingerprintSha256: "a".repeat(64) });
  await assert.rejects(complete(duplicateRuntime, duplicateInit), { code: "AI_GRADER_NFC_UID_ALREADY_ACTIVE" });

  await assert.rejects(initAiGraderNfcProgramming({
    ...linkage, requestedByUserId: "operator-1", idempotencyKey: "raw-uid-init", rawUid: "04AABBCC",
    tokenSecret: TOKEN_SECRET, dbClient: mockDb().db,
  }), { code: "AI_GRADER_NFC_RAW_UID_REJECTED" });
});

test("new explicit init sweeps every timed-out attempt, audits recovery, and creates only one live retry", async () => {
  const runtime = mockDb();
  const first = await reserve(runtime, "expiring-attempt-one", {
    attemptTtlMs: 60_000,
  });
  const firstAttempt = runtime.state.attempts[0];
  runtime.state.attempts.push({
    ...firstAttempt,
    id: `nfc_attempt_${"B".repeat(43)}`,
    tokenHash: "b".repeat(64),
    idempotencyKeyHash: "c".repeat(64),
    requestedAt: new Date(NOW.getTime() + 1_000),
    expiresAt: new Date(NOW.getTime() + 61_000),
  });

  const retry = await reserve(runtime, "explicit-new-attempt-after-timeout", {
    now: new Date(NOW.getTime() + 2 * 60_000),
  });
  assert.notEqual(retry.attemptId, first.attemptId);
  assert.equal(runtime.state.attempts.filter((attempt) => attempt.state === "expired").length, 2);
  assert.equal(runtime.state.attempts.filter((attempt) => ["initialized", "writing", "verified"].includes(attempt.state)).length, 1);
  assert.equal(runtime.state.tags[0].status, "programming");
  assert.equal(runtime.state.audits.filter((event) => event.action === "programming_attempt_expired").length, 2);
  assert.equal(runtime.state.audits.filter((event) => event.action === "programming_attempts_expired_recover_reservation").length, 1);
  await assert.rejects(reserve(runtime, "expiring-attempt-one", {
    now: new Date(NOW.getTime() + 2 * 60_000),
  }), { code: "AI_GRADER_NFC_ATTEMPT_EXPIRED" });
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
  await assert.rejects(reserve(runtime, "ordinary-init-after-revoke", {
    now: new Date(NOW.getTime() + 15_000),
  }), { code: "AI_GRADER_NFC_REPLACEMENT_REQUIRED" });

  const preservedRevocation = {
    revokedAt: runtime.state.tags[0].revokedAt,
    revokedByUserId: runtime.state.tags[0].revokedByUserId,
    revocationReason: runtime.state.tags[0].revocationReason,
  };
  const authorizedAfterStandaloneRevoke = await replaceAiGraderNfcTag({
    ...linkage,
    replacedPublicTagId: init.publicTagId,
    requestedByUserId: "operator-1",
    revocationReason: "Authorize a replacement after the prior revocation",
    idempotencyKey: "replace-prior-revoked-report-1",
    ...PROGRAMMING_RUNTIME,
    attemptTtlMs: 5 * 60_000,
    dbClient: runtime.db,
    now: new Date(NOW.getTime() + 20_000),
  });
  assert.deepEqual({
    revokedAt: runtime.state.tags[0].revokedAt,
    revokedByUserId: runtime.state.tags[0].revokedByUserId,
    revocationReason: runtime.state.tags[0].revocationReason,
  }, preservedRevocation);
  const replacementAuthorizationEvents = runtime.state.audits.filter((event) => event.action === "replacement_authorized");
  assert.equal(replacementAuthorizationEvents.length, 1);
  assert.equal(replacementAuthorizationEvents[0].safeDetails.priorRevocationPreserved, true);
  assert.match(replacementAuthorizationEvents[0].safeDetails.replacementRequestHash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(replacementAuthorizationEvents[0].safeDetails).includes(init.publicTagId), false);

  const recoveredThroughOrdinaryInit = await reserve(runtime, "replace-prior-revoked-report-1", {
    now: new Date(NOW.getTime() + 21_000),
  });
  assert.equal(recoveredThroughOrdinaryInit.attemptId, authorizedAfterStandaloneRevoke.attemptId);
  assert.equal(recoveredThroughOrdinaryInit.attemptToken, authorizedAfterStandaloneRevoke.attemptToken);
  assert.equal(recoveredThroughOrdinaryInit.attestationChallenge, authorizedAfterStandaloneRevoke.attestationChallenge);
  await assert.rejects(reserve(runtime, "changed-key-after-authorized-replacement", {
    now: new Date(NOW.getTime() + 21_000),
  }), { code: "AI_GRADER_NFC_ATTEMPT_IN_PROGRESS" });

  const exactAuthorizedRetry = await replaceAiGraderNfcTag({
    ...linkage,
    replacedPublicTagId: init.publicTagId,
    requestedByUserId: "operator-1",
    revocationReason: "Authorize a replacement after the prior revocation",
    idempotencyKey: "replace-prior-revoked-report-1",
    ...PROGRAMMING_RUNTIME,
    attemptTtlMs: 5 * 60_000,
    dbClient: runtime.db,
    now: new Date(NOW.getTime() + 21_000),
  });
  assert.equal(exactAuthorizedRetry.attemptId, authorizedAfterStandaloneRevoke.attemptId);
  assert.equal(runtime.state.audits.filter((event) => event.action === "replacement_authorized").length, 1);
  await assert.rejects(replaceAiGraderNfcTag({
    ...linkage,
    replacedPublicTagId: init.publicTagId,
    requestedByUserId: "operator-1",
    revocationReason: "A changed replacement reason must fail closed",
    idempotencyKey: "replace-prior-revoked-report-1",
    ...PROGRAMMING_RUNTIME,
    attemptTtlMs: 5 * 60_000,
    dbClient: runtime.db,
    now: new Date(NOW.getTime() + 21_000),
  }), { code: "AI_GRADER_NFC_REPLACEMENT_ALREADY_AUTHORIZED" });

  const retryAfterReplacementAttemptExpiry = await reserve(runtime, "retry-authorized-replacement-after-expiry", {
    now: new Date(NOW.getTime() + 6 * 60_000),
  });
  assert.equal(runtime.state.attempts.find((attempt) => (
    attempt.id === authorizedAfterStandaloneRevoke.attemptId
  )).state, "expired");
  assert.notEqual(retryAfterReplacementAttemptExpiry.attemptId, authorizedAfterStandaloneRevoke.attemptId);
  assert.equal(retryAfterReplacementAttemptExpiry.publicTagId, authorizedAfterStandaloneRevoke.publicTagId);
  assert.equal(runtime.state.tags.length, 2);
  assert.equal(runtime.state.tags.filter((tag) => ["reserved", "programming", "verified", "active"].includes(tag.status)).length, 1);
  assert.equal(runtime.state.attempts.filter((attempt) => ["initialized", "writing", "verified"].includes(attempt.state)).length, 1);

  const replacementRuntime = mockDb();
  const original = await reserve(replacementRuntime);
  await complete(replacementRuntime, original);
  const replacement = await replaceAiGraderNfcTag({
    ...linkage, replacedPublicTagId: original.publicTagId, requestedByUserId: "operator-1",
    revocationReason: "Replace exact active NFC registration", idempotencyKey: "replace-report-1",
    ...PROGRAMMING_RUNTIME, attemptTtlMs: 5 * 60_000, dbClient: replacementRuntime.db,
    now: new Date(NOW.getTime() + 20_000),
  });
  assert.equal(replacementRuntime.state.tags[0].status, "revoked");
  assert.equal(replacement.status, "programming");
  assert.notEqual(replacement.publicTagId, original.publicTagId);
  assert.equal(replacementRuntime.state.tags.length, 2);
  const retriedReplacement = await replaceAiGraderNfcTag({
    ...linkage, replacedPublicTagId: original.publicTagId, requestedByUserId: "operator-1",
    revocationReason: "Replace exact active NFC registration", idempotencyKey: "replace-report-1",
    ...PROGRAMMING_RUNTIME, attemptTtlMs: 5 * 60_000, dbClient: replacementRuntime.db,
    now: new Date(NOW.getTime() + 20_000),
  });
  assert.equal(retriedReplacement.publicTagId, replacement.publicTagId);
  assert.equal(replacementRuntime.state.tags.length, 2);
  for (const patch of [
    { revocationReason: "Changed replacement reason is rejected" },
    { requestedByUserId: "operator-2" },
    { idempotencyKey: "changed-replacement-key" },
    { replacedPublicTagId: "Z".repeat(32) },
    { itemId: "other-item" },
  ]) {
    await assert.rejects(replaceAiGraderNfcTag({
      ...linkage,
      replacedPublicTagId: original.publicTagId,
      requestedByUserId: "operator-1",
      revocationReason: "Replace exact active NFC registration",
      idempotencyKey: "replace-report-1",
      ...PROGRAMMING_RUNTIME,
      attemptTtlMs: 5 * 60_000,
      dbClient: replacementRuntime.db,
      now: new Date(NOW.getTime() + 20_000),
      ...patch,
    }));
    assert.equal(replacementRuntime.state.tags.length, 2);
  }
});

test("concurrent ordinary init and authorized replace leave at most one open registration and one live attempt", async () => {
  const runtime = mockDb();
  const original = await reserve(runtime);
  await complete(runtime, original);
  const results = await Promise.allSettled([
    reserve(runtime, "concurrent-ordinary-init", { now: new Date(NOW.getTime() + 30_000) }),
    replaceAiGraderNfcTag({
      ...linkage,
      replacedPublicTagId: original.publicTagId,
      requestedByUserId: "operator-1",
      revocationReason: "Concurrent authorized replacement",
      idempotencyKey: "concurrent-replace",
      ...PROGRAMMING_RUNTIME,
      attemptTtlMs: 5 * 60_000,
      dbClient: runtime.db,
      now: new Date(NOW.getTime() + 30_000),
    }),
  ]);
  assert.ok(results.some((result) => result.status === "fulfilled"));
  assert.equal(runtime.state.tags.filter((tag) => ["reserved", "programming", "verified", "active"].includes(tag.status)).length, 1);
  assert.equal(runtime.state.attempts.filter((attempt) => ["initialized", "writing", "verified"].includes(attempt.state)).length, 1);
});

test("Feiju iPhone-assisted workflow is separately gated, idempotent, bounded, exact-URL-only, and activates without UID or workstation evidence", async () => {
  const strategy = describeAiGraderNfcSecurityStrategy("FEIJU_PROPRIETARY_ISODEP", "manual_ios_locked_static_url_v1");
  assert.deepEqual(strategy, {
    chipType: "FEIJU_PROPRIETARY_ISODEP",
    securityMode: "manual_ios_locked_static_url_v1",
    implemented: true,
    registrationKind: "registered_link",
    cryptographicVerificationAvailable: false,
    consumerWriteProtection: true,
    cryptographicTagAuthentication: false,
    clonableStaticUrl: true,
    workstationOperationalAttestation: false,
  });

  const disabled = mockDb();
  await assert.rejects(reserveManual(disabled, "manual-disabled", { manualIosEnabled: false }), {
    code: "AI_GRADER_NFC_MANUAL_IOS_DISABLED",
  });
  await assert.rejects(reserveManual(disabled, "programming-disabled", { programmingEnabled: false }), {
    code: "AI_GRADER_NFC_PROGRAMMING_DISABLED",
  });
  await assert.rejects(reserveManual(disabled, "raw-uid-rejected", { rawUid: "04AABBCC" }), {
    code: "AI_GRADER_NFC_RAW_UID_REJECTED",
  });

  const runtime = mockDb();
  const init = await reserveManual(runtime);
  const retry = await reserveManual(runtime);
  assert.equal(retry.attemptId, init.attemptId);
  assert.equal(retry.publicTagId, init.publicTagId);
  assert.equal(init.chipType, "FEIJU_PROPRIETARY_ISODEP");
  assert.equal(init.securityMode, "manual_ios_locked_static_url_v1");
  assert.equal(init.expectedNdefUrl, `https://collect.tenkings.co/nfc/${init.publicTagId}`);
  assert.equal(init.expectedPayloadSha256, sha256(init.expectedNdefUrl));
  assert.equal(runtime.state.tags[0].uidFingerprintSha256, null);
  assert.equal(runtime.state.manualAttempts.length, 1);
  assert.equal(runtime.state.manualAttempts[0].profileVersion, "feiju_iso_dep_ios_static_v1");
  assert.equal(runtime.state.manualAttempts[0].qualificationProfile, "feiju_iso_dep_ios_static_v1");
  assert.equal(runtime.state.manualAttempts[0].workstationOperationalAttestation, false);
  assert.equal(runtime.state.manualAttempts[0].cryptographicTagAuthentication, false);

  const completionInput = {
    ...linkage,
    requestedByUserId: "operator-1",
    attemptId: init.attemptId,
    publicTagId: init.publicTagId,
    normalizedNdefUrl: init.expectedNdefUrl,
    idempotencyKey: "manual-ios-complete-report-1",
    programmingEnabled: true,
    manualIosEnabled: true,
    dbClient: runtime.db,
    now: new Date(NOW.getTime() + 4_000),
  };
  await assert.rejects(completeAiGraderNfcManualIos(completionInput), {
    code: "AI_GRADER_NFC_MANUAL_IOS_EVIDENCE_INCOMPLETE",
  });
  assert.deepEqual(await observeAiGraderNfcManualIosTap({
    publicTagId: "Z".repeat(32), programmingEnabled: true, manualIosEnabled: true, dbClient: runtime.db, now: new Date(NOW.getTime() + 1_000),
  }), { state: "not_applicable" });
  assert.deepEqual(await observeAiGraderNfcManualIosTap({
    publicTagId: init.publicTagId, programmingEnabled: true, manualIosEnabled: true, dbClient: runtime.db, now: new Date(NOW.getTime() + 1_000),
  }), { state: "setup_verification", stage: "pre_lock" });
  assert.deepEqual(await observeAiGraderNfcManualIosTap({
    publicTagId: init.publicTagId, programmingEnabled: true, manualIosEnabled: true, dbClient: runtime.db, now: new Date(NOW.getTime() + 1_500),
  }), { state: "setup_verification", stage: "lock_confirmation" });

  const lockInput = {
    ...linkage,
    requestedByUserId: "operator-1",
    attemptId: init.attemptId,
    publicTagId: init.publicTagId,
    writableNoConfirmed: true,
    programmingEnabled: true,
    manualIosEnabled: true,
    dbClient: runtime.db,
    now: new Date(NOW.getTime() + 2_000),
  };
  await assert.rejects(confirmAiGraderNfcManualIosLock({ ...lockInput, writableNoConfirmed: false }), {
    code: "AI_GRADER_NFC_WRITE_PROTECTION_CONFIRMATION_REQUIRED",
  });
  assert.equal((await confirmAiGraderNfcManualIosLock(lockInput)).manualIosAttempt.state, "awaiting_postlock_tap");
  assert.equal((await confirmAiGraderNfcManualIosLock(lockInput)).manualIosAttempt.state, "awaiting_postlock_tap");
  await assert.rejects(completeAiGraderNfcManualIos({ ...completionInput, now: new Date(NOW.getTime() + 2_500) }), {
    code: "AI_GRADER_NFC_MANUAL_IOS_EVIDENCE_INCOMPLETE",
  });

  assert.deepEqual(await observeAiGraderNfcManualIosTap({
    publicTagId: init.publicTagId, programmingEnabled: true, manualIosEnabled: true, dbClient: runtime.db, now: new Date(NOW.getTime() + 3_000),
  }), { state: "setup_verification", stage: "post_lock" });
  assert.deepEqual(await observeAiGraderNfcManualIosTap({
    publicTagId: init.publicTagId, programmingEnabled: true, manualIosEnabled: true, dbClient: runtime.db, now: new Date(NOW.getTime() + 3_500),
  }), { state: "setup_verification", stage: "ready_to_complete" });
  await assert.rejects(completeAiGraderNfcManualIos({
    ...completionInput,
    normalizedNdefUrl: `${init.expectedNdefUrl}?lock-check=1`,
  }), { code: "AI_GRADER_NFC_READBACK_MISMATCH" });

  const active = await completeAiGraderNfcManualIos(completionInput);
  assert.equal(active.status, "active");
  assert.equal(active.registrationKind, "registered_link");
  assert.equal(active.cryptographicallyVerified, false);
  assert.equal(active.manualIosAttempt.state, "consumed");
  assert.equal(active.manualIosAttempt.writeProtectionEvidence, "ios_read_only_status_observed");
  assert.equal(active.manualIosAttempt.qualificationProfile, "feiju_iso_dep_ios_static_v1");
  assert.equal(active.manualIosAttempt.workstationOperationalAttestation, false);
  assert.equal(active.manualIosAttempt.cryptographicTagAuthentication, false);
  assert.equal((await completeAiGraderNfcManualIos(completionInput)).status, "active");
  await assert.rejects(completeAiGraderNfcManualIos({ ...completionInput, idempotencyKey: "manual-ios-replay-changed" }), {
    code: "AI_GRADER_NFC_TOKEN_REPLAY",
  });

  const serialized = JSON.stringify({ active, state: runtime.state });
  for (const forbidden of ["rawUid", "uidFingerprintSha256\":\"", "phoneIdentifier", "ipAddress", "workstationKeyId", "attestationChallenge", "signature", "apdu"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.ok(runtime.state.audits.some((event) => event.action === "manual_ios_prelock_tap_observed"));
  assert.ok(runtime.state.audits.some((event) => event.action === "manual_ios_write_protection_confirmed"));
  assert.ok(runtime.state.audits.some((event) => event.action === "manual_ios_postlock_tap_observed"));
  assert.ok(runtime.state.audits.some((event) => event.action === "manual_ios_locked_static_url_verified"));
});

test("Feiju iPhone-assisted attempts expire closed and preserve revoke/replace uniqueness", async () => {
  const expiredRuntime = mockDb();
  const expired = await reserveManual(expiredRuntime, "manual-expiry", { attemptTtlMs: 60_000 });
  assert.deepEqual(await observeAiGraderNfcManualIosTap({
    publicTagId: expired.publicTagId,
    programmingEnabled: true,
    manualIosEnabled: true,
    dbClient: expiredRuntime.db,
    now: new Date(NOW.getTime() + 60_001),
  }), { state: "not_applicable" });
  assert.equal(expiredRuntime.state.manualAttempts[0].state, "expired");
  assert.equal(expiredRuntime.state.tags[0].status, "reserved");
  await assert.rejects(reserveManual(expiredRuntime, "manual-expiry", { now: new Date(NOW.getTime() + 60_002) }), {
    code: "AI_GRADER_NFC_ATTEMPT_EXPIRED",
  });

  const staleRuntime = mockDb();
  const stale = await reserveManual(staleRuntime, "manual-stale-original", { attemptTtlMs: 60_000 });
  const retryAfterTimeout = await reserveManual(staleRuntime, "manual-stale-retry", {
    attemptTtlMs: 60_000,
    now: new Date(NOW.getTime() + 60_002),
  });
  assert.notEqual(retryAfterTimeout.attemptId, stale.attemptId);
  assert.equal(retryAfterTimeout.publicTagId, stale.publicTagId);
  assert.equal(staleRuntime.state.manualAttempts[0].state, "expired");
  assert.equal(staleRuntime.state.manualAttempts[1].state, "awaiting_prelock_tap");
  assert.equal(staleRuntime.state.tags[0].status, "programming");
  assert.equal(staleRuntime.state.manualAttempts.filter((attempt) => ["awaiting_prelock_tap", "awaiting_lock_confirmation", "awaiting_postlock_tap", "ready_to_complete"].includes(attempt.state)).length, 1);
  assert.ok(staleRuntime.state.audits.some((event) => event.action === "manual_ios_attempts_expired_recover_reservation"));
  const runtime = mockDb();
  const init = await reserveManual(runtime, "manual-replace-original");
  await observeAiGraderNfcManualIosTap({ publicTagId: init.publicTagId, programmingEnabled: true, manualIosEnabled: true, dbClient: runtime.db, now: new Date(NOW.getTime() + 1_000) });
  await confirmAiGraderNfcManualIosLock({
    ...linkage, requestedByUserId: "operator-1", attemptId: init.attemptId, publicTagId: init.publicTagId,
    writableNoConfirmed: true, programmingEnabled: true, manualIosEnabled: true, dbClient: runtime.db, now: new Date(NOW.getTime() + 2_000),
  });
  await observeAiGraderNfcManualIosTap({ publicTagId: init.publicTagId, programmingEnabled: true, manualIosEnabled: true, dbClient: runtime.db, now: new Date(NOW.getTime() + 3_000) });
  await completeAiGraderNfcManualIos({
    ...linkage, requestedByUserId: "operator-1", attemptId: init.attemptId, publicTagId: init.publicTagId,
    normalizedNdefUrl: init.expectedNdefUrl, idempotencyKey: "manual-replace-complete",
    programmingEnabled: true, manualIosEnabled: true, dbClient: runtime.db, now: new Date(NOW.getTime() + 4_000),
  });
  const replacement = await replaceAiGraderNfcManualIos({
    ...linkage,
    replacedPublicTagId: init.publicTagId,
    requestedByUserId: "operator-1",
    revocationReason: "Replace a damaged Feiju registered link",
    idempotencyKey: "manual-replacement",
    programmingEnabled: true,
    manualIosEnabled: true,
    dbClient: runtime.db,
    now: new Date(NOW.getTime() + 5_000),
  });
  assert.equal(runtime.state.tags[0].status, "revoked");
  assert.equal(replacement.status, "programming");
  assert.notEqual(replacement.publicTagId, init.publicTagId);
  assert.equal(runtime.state.tags.filter((tag) => ["reserved", "programming", "verified", "active"].includes(tag.status)).length, 1);
  assert.equal(runtime.state.manualAttempts.filter((attempt) => ["awaiting_prelock_tap", "awaiting_lock_confirmation", "awaiting_postlock_tap", "ready_to_complete"].includes(attempt.state)).length, 1);
});

test("safe status returns exact linkage and no UID fingerprint, token, attempt, path, or helper details", async () => {
  const runtime = mockDb();
  const missing = await getAiGraderNfcStatus({ tenantId: "ten-kings", reportId: "report-1", dbClient: runtime.db });
  assert.deepEqual({ status: missing.status, cardAssetId: missing.cardAssetId, itemId: missing.itemId, certId: missing.certId }, {
    status: "missing", cardAssetId: "card-1", itemId: "item-1", certId: "TK-AIG-1",
  });
  const init = await reserve(runtime);
  await complete(runtime, init);
  const json = JSON.stringify(await getAiGraderNfcStatus({
    tenantId: "ten-kings",
    reportId: "report-1",
    dbClient: runtime.db,
  }));
  assert.equal(json.includes("uidFingerprint"), false);
  assert.equal(json.includes("rawUid"), false);
  assert.equal(json.includes("localPath"), false);
  assert.equal(json.includes("helper"), false);
  assert.equal(json.includes("attestationChallenge"), false);
  assert.equal(json.includes("signature"), false);
  assert.equal(json.includes("workstationKeyId"), false);
  assert.equal(json.includes("readbackEvidence"), false);
});

test("additive Feiju migration is separate, UID-free, APDU-free, and preserves the NTAG workstation contract", () => {
  const enumMigration = readFileSync(join(
    __dirname,
    "..",
    "prisma",
    "migrations",
    "20260716190000_ai_grader_nfc_feiju_profile_enums",
    "migration.sql",
  ), "utf8");
  const profileMigration = readFileSync(join(
    __dirname,
    "..",
    "prisma",
    "migrations",
    "20260716190500_ai_grader_nfc_feiju_ios_profile",
    "migration.sql",
  ), "utf8");
  const migration = `${enumMigration}\n${profileMigration}`;
  for (const required of [
    "FEIJU_PROPRIETARY_ISODEP",
    "manual_ios_locked_static_url_v1",
    "AiGraderNfcManualIosAttempt",
    "feiju_iso_dep_ios_static_v1",
    "qualificationProfile",
    "ios_read_only_status_observed",
    "workstationOperationalAttestation",
    "cryptographicTagAuthentication",
    "AiGraderNfcManualIosAttempt_profile",
    "AiGraderNfcManualIosAttempt_state_evidence",
    "AiGraderNfcManualIosAttempt_request_idempotency_key",
    "AiGraderNfcManualIosAttempt_one_live_per_tag",
  ]) assert.equal(migration.includes(required), true, `migration is missing ${required}`);
  assert.doesNotMatch(migration, /"uid"\s+TEXT/i);
  assert.doesNotMatch(migration, /"rawUid"\s+TEXT/i);
  assert.doesNotMatch(migration, /"ip(Address)?"\s+TEXT/i);
  assert.doesNotMatch(migration, /"phone(Identifier)?"\s+TEXT/i);
  assert.doesNotMatch(migration, /"apdu"\s+TEXT/i);
  assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN|TYPE)/i);
  assert.equal(migration.includes("\"chipType\" = 'NTAG424_DNA' AND \"uidFingerprintSha256\" IS NOT NULL"), true);
  assert.match(migration, /"uidFingerprintSha256" IS NULL/);
  assert.match(migration, /"workstationOperationalAttestation" BOOLEAN NOT NULL DEFAULT false/);
  assert.match(migration, /"cryptographicTagAuthentication" BOOLEAN NOT NULL DEFAULT false/);
});

test("unapplied NFC migration requires operational attestation evidence without forbidden secret material", () => {
  const migration = readFileSync(join(
    __dirname,
    "..",
    "prisma",
    "migrations",
    "20260712160000_ai_grader_nfc_static_url_v1",
    "migration.sql",
  ), "utf8");
  for (const required of [
    '"attestationChallengeHash" TEXT NOT NULL',
    '"expectedAttestationAlgorithm" TEXT NOT NULL',
    '"completedWorkstationKeyId" TEXT',
    "ecdsa-p256-sha256-p1363",
    "ai-grader-nfc-helper-attestation-v1",
    "tenkings-ai-grader-nfc-loopback-v2",
    "workstationOperationalAttestation",
    "cryptographicTagAuthentication",
    "AiGraderNfcProgrammingAttempt_completion_state",
    "AiGraderNfcProgrammingAttempt_attestation_evidence",
    '"readbackEvidence" ?& ARRAY[',
    'jsonb_typeof("readbackEvidence"->\'statementSha256\') = \'string\'',
    'jsonb_typeof("readbackEvidence"->\'signature\') = \'string\'',
    'jsonb_typeof("readbackEvidence"->\'observedAt\') = \'string\'',
    'jsonb_typeof("readbackEvidence"->\'readerResultCode\') = \'string\'',
    "AiGraderNfcProgrammingAttempt_one_live_per_tag",
    "WHERE \"state\" IN ('initialized', 'writing', 'verified')",
    "AiGraderNfcAuditEvent_immutable_update",
    "AiGraderNfcAuditEvent_immutable_delete",
  ]) {
    assert.equal(migration.includes(required), true, `migration is missing ${required}`);
  }
  assert.match(migration, /"id" ~ '\^nfc_attempt_\[A-Za-z0-9_-\]\{43\}\$'/);
  assert.doesNotMatch(migration, /"attestationChallenge"\s+TEXT/);
  assert.doesNotMatch(migration, /"privateKey"\s+TEXT/i);
  assert.doesNotMatch(migration, /"rawUid"\s+TEXT/i);
  assert.doesNotMatch(migration, /"apdu"\s+TEXT/i);
  assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN|TYPE)/i);
});
