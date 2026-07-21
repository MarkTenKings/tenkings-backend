const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { deflateSync } = require("node:zlib");
const {
  AI_GRADER_DESIGN_REFERENCE_PROVENANCE_SCHEMA_VERSION,
  AI_GRADER_DESIGN_REFERENCE_SUPERSEDED_REASON,
  AI_GRADER_DESIGN_REFERENCE_TRANSFORM_ACCEPTANCE_SCHEMA_VERSION,
  AI_GRADER_INTENDED_DESIGN_BOUNDARY_SCHEMA_VERSION,
  AI_GRADER_REGISTERED_DESIGN_REFERENCE_PROFILE,
  createAiGraderDesignReferenceService,
} = require("../dist/database/src/aiGraderDesignReferenceService");

function pngHeader(width, height) {
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const value of bytes) {
      crc ^= value;
      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
  function chunk(type, data) {
    const typeBytes = Buffer.from(type, "ascii");
    const output = Buffer.alloc(12 + data.length);
    output.writeUInt32BE(data.length, 0);
    typeBytes.copy(output, 4);
    data.copy(output, 8);
    output.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
    return output;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(scanlines)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const ARTIFACT_BYTES = pngHeader(1200, 1680);
const HASH = createHash("sha256").update(ARTIFACT_BYTES).digest("hex");
const NOW = new Date("2026-07-18T18:00:00.000Z");
const identity = Object.freeze({
  tenantId: "ten-kings",
  setId: "2026 Ten Kings Calibration",
  programId: "base",
  cardNumber: "42",
  variantId: "photo-a",
  parallelId: "gold",
  side: "front",
  profile: AI_GRADER_REGISTERED_DESIGN_REFERENCE_PROFILE,
});

function draftInput(overrides = {}) {
  return {
    ...identity,
    version: 3,
    artifactStorageKey: "ai-grader/design-references/ten-kings/card-42/front-v3.png",
    intendedDesignBoundary: {
      schemaVersion: AI_GRADER_INTENDED_DESIGN_BOUNDARY_SCHEMA_VERSION,
      coordinateFrame: "design_reference_pixels",
      contour: [[22, 30], [1178, 30], [1178, 1650], [22, 1650]],
    },
    provenance: {
      schemaVersion: AI_GRADER_DESIGN_REFERENCE_PROVENANCE_SCHEMA_VERSION,
      sourceKind: "ten_kings_controlled_physical_reference_v1",
      approvedForPrecisionReference: true,
      evidenceArtifactId: "reference-capture-1",
    },
    transformAcceptanceMetadata: {
      schemaVersion: AI_GRADER_DESIGN_REFERENCE_TRANSFORM_ACCEPTANCE_SCHEMA_VERSION,
      registrationAlgorithmVersion: "registered-design-registration-v1",
      maxResidualPx: 1.25,
      minInlierFraction: 0.92,
    },
    createdByUserId: "operator-1",
    ...overrides,
  };
}

function referenceRow(overrides = {}) {
  return {
    id: "design-ref-3",
    ...identity,
    variantKey: identity.variantId,
    parallelKey: identity.parallelId,
    version: 3,
    status: "draft",
    artifactStorageKey: "ai-grader/design-references/ten-kings/card-42/front-v3.png",
    artifactSha256: HASH,
    artifactMimeType: "image/png",
    artifactWidthPx: 1200,
    artifactHeightPx: 1680,
    intendedDesignBoundary: draftInput().intendedDesignBoundary,
    provenance: draftInput().provenance,
    transformAcceptanceMetadata: draftInput().transformAcceptanceMetadata,
    createdByUserId: "operator-1",
    approvedByUserId: null,
    approvedAt: null,
    retiredByUserId: null,
    retiredAt: null,
    retirementReason: null,
    createdAt: new Date("2026-07-18T17:00:00.000Z"),
    updatedAt: new Date("2026-07-18T17:00:00.000Z"),
    ...overrides,
  };
}

function mockDb(delegateOverrides = {}) {
  const delegate = {
    async create({ data }) { return referenceRow({ ...data }); },
    async findFirst() { return null; },
    async findMany() { return []; },
    async updateMany() { return { count: 0 }; },
    ...delegateOverrides,
  };
  return {
    aiGraderDesignReference: delegate,
    async $transaction(operation) { return operation({ aiGraderDesignReference: delegate }); },
  };
}

function createService(db, options = {}) {
  return createAiGraderDesignReferenceService(db, {
    readArtifactBytes: async () => ARTIFACT_BYTES,
    ...options,
  });
}

test("creates an immutable draft with normalized exact identity keys", async () => {
  let createArgs;
  const db = mockDb({
    async create(args) {
      createArgs = args;
      return referenceRow({ ...args.data });
    },
  });
  const service = createService(db, { now: () => NOW });
  const input = draftInput({
    variantId: null,
    parallelId: null,
    artifactSha256: "f".repeat(64),
    artifactMimeType: "image/gif",
    artifactWidthPx: 1,
    artifactHeightPx: 1,
  });
  const created = await service.createVerifiedDraft(input);

  assert.equal(created.status, "draft");
  assert.equal(createArgs.data.variantId, null);
  assert.equal(createArgs.data.variantKey, "");
  assert.equal(createArgs.data.parallelId, null);
  assert.equal(createArgs.data.parallelKey, "");
  assert.equal(createArgs.data.artifactSha256, HASH);
  assert.equal(createArgs.data.artifactMimeType, "image/png");
  assert.equal(createArgs.data.artifactWidthPx, 1200);
  assert.equal(createArgs.data.artifactHeightPx, 1680);
  assert.equal(createArgs.data.approvedAt, undefined);
  assert.notEqual(createArgs.data.provenance, input.provenance);
  input.provenance.evidenceArtifactId = "mutated-after-create";
  assert.equal(createArgs.data.provenance.evidenceArtifactId, "reference-capture-1");
  input.intendedDesignBoundary.contour[0][0] = 999;
  assert.deepEqual(createArgs.data.intendedDesignBoundary.contour[0], [22, 30]);
});

test("storage-byte authority is mandatory and unsupported bytes fail before database mutation", async () => {
  let creates = 0;
  const db = mockDb({
    async create() { creates += 1; return referenceRow(); },
  });
  const unconfigured = createAiGraderDesignReferenceService(db);
  await assert.rejects(
    unconfigured.createVerifiedDraft(draftInput()),
    (error) => error.code === "AI_GRADER_DESIGN_REFERENCE_ARTIFACT_READ_UNAVAILABLE",
  );
  const unsupported = createService(db, {
    readArtifactBytes: async () => new Uint8Array(24),
  });
  await assert.rejects(
    unsupported.createVerifiedDraft(draftInput()),
    (error) => error.code === "AI_GRADER_DESIGN_REFERENCE_ARTIFACT_UNSUPPORTED",
  );
  const corrupt = Buffer.from(ARTIFACT_BYTES);
  corrupt[corrupt.length - 13] ^= 1;
  await assert.rejects(
    createService(db, { readArtifactBytes: async () => corrupt })
      .createVerifiedDraft(draftInput()),
    (error) => error.code === "AI_GRADER_DESIGN_REFERENCE_ARTIFACT_UNSUPPORTED",
  );
  assert.equal(creates, 0);
});

test("approval refuses storage bytes changed after draft creation before retiring an active reference", async () => {
  let reads = 0;
  let updates = 0;
  const db = mockDb({
    async findFirst() { return referenceRow(); },
    async updateMany() { updates += 1; return { count: 1 }; },
  });
  const service = createService(db, {
    now: () => NOW,
    readArtifactBytes: async () => {
      reads += 1;
      return reads === 1 ? ARTIFACT_BYTES : pngHeader(1201, 1680);
    },
  });
  await service.createVerifiedDraft(draftInput());
  await assert.rejects(
    service.approve({
      ...identity,
      version: 3,
      expectedArtifactSha256: HASH,
      referenceId: "design-ref-3",
      approvedByUserId: "approver-1",
    }),
    (error) => error.code === "AI_GRADER_DESIGN_REFERENCE_ARTIFACT_INTEGRITY_MISMATCH",
  );
  assert.equal(reads, 2);
  assert.equal(updates, 0);
});

test("rejects incomplete identities, unsafe artifacts, unapproved provenance, and invalid transform acceptance", async () => {
  let creates = 0;
  const service = createService(mockDb({
    async create() { creates += 1; return referenceRow(); },
  }));
  const missingParallel = draftInput();
  delete missingParallel.parallelId;

  const invalidInputs = [
    [missingParallel, /parallelId: is required/],
    [draftInput({ artifactStorageKey: "https://example.test/reference.png" }), /private relative object key/],
    [draftInput({
      provenance: {
        ...draftInput().provenance,
        sourceKind: "ebay_listing",
      },
    }), /not arbitrary internet or marketplace imagery/],
    [draftInput({
      provenance: {
        ...draftInput().provenance,
        sourceUrl: "https://www.ebay.com/itm/not-a-precision-reference",
      },
    }), /must not contain marketplace or scraped-image provenance/],
    [draftInput({
      provenance: {
        ...draftInput().provenance,
        approvedForPrecisionReference: false,
      },
    }), /approvedForPrecisionReference: must be explicitly true/],
    [draftInput({
      transformAcceptanceMetadata: {
        ...draftInput().transformAcceptanceMetadata,
        minInlierFraction: 1.01,
      },
    }), /minInlierFraction: must be a finite number from 0 through 1/],
    [draftInput({
      intendedDesignBoundary: {
        ...draftInput().intendedDesignBoundary,
        coordinateFrame: "normalized_card",
      },
    }), /coordinateFrame: must equal design_reference_pixels/],
    [draftInput({
      intendedDesignBoundary: {
        ...draftInput().intendedDesignBoundary,
        contour: [[0, 0], [100, 0], [100, 100]],
      },
    }), /contour must contain 4-64 vertices/],
    [draftInput({
      intendedDesignBoundary: {
        ...draftInput().intendedDesignBoundary,
        contour: [[0, 0], [1201, 0], [1200, 100], [0, 100]],
      },
    }), /must lie inside the artifact dimensions/],
    [draftInput({
      intendedDesignBoundary: {
        ...draftInput().intendedDesignBoundary,
        contour: [[0, 0], [100, 0], [100, 0], [0, 100]],
      },
    }), /vertices 1 and 2 are duplicated/],
    [draftInput({
      intendedDesignBoundary: {
        ...draftInput().intendedDesignBoundary,
        contour: [[0, 0], [100, 0], [200, 0], [300, 0]],
      },
    }), /must enclose a finite non-zero area/],
    [draftInput({
      intendedDesignBoundary: {
        ...draftInput().intendedDesignBoundary,
        contour: [[0, 0], [100, 100], [0, 100], [100, 0]],
      },
    }), /intersect or touch ambiguously/],
    [draftInput({
      intendedDesignBoundary: {
        ...draftInput().intendedDesignBoundary,
        contour: [[0, 0], [100, 0], [100, Number.NaN], [0, 100]],
      },
    }), /must not contain a non-finite number/],
  ];

  for (const [input, expected] of invalidInputs) {
    await assert.rejects(service.createVerifiedDraft(input), expected);
  }
  assert.equal(creates, 0);
});

test("accepts a finite non-self-intersecting concave contour inside the artifact", async () => {
  let storedBoundary;
  const service = createService(mockDb({
    async create({ data }) {
      storedBoundary = data.intendedDesignBoundary;
      return referenceRow({ ...data });
    },
  }));
  const contour = [[10, 10], [200, 10], [200, 200], [100, 100], [10, 200]];
  await service.createVerifiedDraft(draftInput({
    intendedDesignBoundary: {
      ...draftInput().intendedDesignBoundary,
      contour,
    },
  }));
  assert.deepEqual(storedBoundary.contour, contour);
});

test("list is exact-identity scoped and cannot become an arbitrary tenant scan", async () => {
  let findManyArgs;
  const service = createService(mockDb({
    async findMany(args) { findManyArgs = args; return [referenceRow()]; },
  }));
  assert.equal((await service.list(identity)).length, 1);
  assert.deepEqual(findManyArgs.where, {
    ...identity,
    variantKey: identity.variantId,
    parallelKey: identity.parallelId,
  });
  assert.deepEqual(findManyArgs.orderBy, [{ version: "desc" }, { createdAt: "desc" }]);
  await assert.rejects(service.list({ tenantId: identity.tenantId }), /setId: is required/);
});

test("resolve requires exact approved status, complete identity, version, and expected hash", async () => {
  let findFirstArgs;
  const service = createService(mockDb({
    async findFirst(args) {
      findFirstArgs = args;
      return referenceRow({ status: "approved", approvedByUserId: "approver-1", approvedAt: NOW });
    },
  }));
  const resolved = await service.resolveExactApproved({ ...identity, version: 3, expectedArtifactSha256: HASH });
  assert.equal(resolved.id, "design-ref-3");
  assert.deepEqual(findFirstArgs.where, {
    ...identity,
    variantKey: identity.variantId,
    parallelKey: identity.parallelId,
    version: 3,
    artifactSha256: HASH,
    status: "approved",
  });

  const mismatched = createService(mockDb({
    async findFirst() {
      return referenceRow({ version: 4, status: "approved", approvedByUserId: "approver-1", approvedAt: NOW });
    },
  }));
  await assert.rejects(
    mismatched.resolveExactApproved({ ...identity, version: 3, expectedArtifactSha256: HASH }),
    /did not match exact version/,
  );
  const absent = createService(mockDb());
  await assert.rejects(
    absent.resolveExactApproved({ ...identity, version: 3, expectedArtifactSha256: HASH }),
    /no approved design reference matched the complete identity/,
  );
});

test("resolve and list fail closed on malformed stored boundary evidence", async () => {
  const malformed = referenceRow({
    status: "approved",
    approvedByUserId: "approver-1",
    approvedAt: NOW,
    intendedDesignBoundary: {
      ...draftInput().intendedDesignBoundary,
      contour: [[0, 0], [100, 100], [0, 100], [100, 0]],
    },
  });
  const service = createService(mockDb({
    async findFirst() { return malformed; },
    async findMany() { return [malformed]; },
  }));
  await assert.rejects(
    service.resolveExactApproved({ ...identity, version: 3, expectedArtifactSha256: HASH }),
    /intersect or touch ambiguously/,
  );
  await assert.rejects(service.list(identity), /intersect or touch ambiguously/);
});

test("approval transaction retires the one prior active side then conditionally promotes the exact draft", async () => {
  const calls = [];
  let reads = 0;
  const db = mockDb({
    async findFirst(args) {
      calls.push(["findFirst", args]);
      reads += 1;
      if (reads === 1) return referenceRow();
      return referenceRow({
        status: "approved",
        approvedByUserId: "approver-1",
        approvedAt: NOW,
      });
    },
    async updateMany(args) {
      calls.push(["updateMany", args]);
      return { count: 1 };
    },
  });
  const service = createService(db, { now: () => NOW });
  const approved = await service.approve({
    ...identity,
    version: 3,
    expectedArtifactSha256: HASH,
    referenceId: "design-ref-3",
    approvedByUserId: "approver-1",
  });

  assert.equal(approved.status, "approved");
  assert.equal(calls.length, 4);
  assert.deepEqual(calls[0][1].where, {
    id: "design-ref-3",
    ...identity,
    variantKey: identity.variantId,
    parallelKey: identity.parallelId,
    version: 3,
    artifactSha256: HASH,
    status: "draft",
  });
  assert.deepEqual(calls[1][1].where, {
    tenantId: identity.tenantId,
    setId: identity.setId,
    programId: identity.programId,
    cardNumber: identity.cardNumber,
    variantId: identity.variantId,
    variantKey: identity.variantId,
    parallelId: identity.parallelId,
    parallelKey: identity.parallelId,
    side: identity.side,
    status: "approved",
    id: { not: "design-ref-3" },
  });
  assert.deepEqual(calls[1][1].data, {
    status: "retired",
    retiredByUserId: "approver-1",
    retiredAt: NOW,
    retirementReason: AI_GRADER_DESIGN_REFERENCE_SUPERSEDED_REASON,
  });
  assert.equal(calls[2][1].where.profile, AI_GRADER_REGISTERED_DESIGN_REFERENCE_PROFILE);
  assert.equal(calls[2][1].where.artifactSha256, HASH);
  assert.equal(calls[2][1].where.version, 3);
  assert.deepEqual(calls[2][1].data, {
    status: "approved",
    approvedByUserId: "approver-1",
    approvedAt: NOW,
  });
});

test("approval never retires an active reference when the exact draft/hash/version is absent", async () => {
  let updates = 0;
  const service = createService(mockDb({
    async findFirst() { return null; },
    async updateMany() { updates += 1; return { count: 1 }; },
  }), { now: () => NOW });
  await assert.rejects(service.approve({
    ...identity,
    version: 3,
    expectedArtifactSha256: HASH,
    referenceId: "design-ref-3",
    approvedByUserId: "approver-1",
  }), /no draft design reference matched the exact id/);
  assert.equal(updates, 0);
});

test("approval detects a concurrent state change after prior-active retirement inside the same transaction", async () => {
  let updates = 0;
  const service = createService(mockDb({
    async findFirst() { return referenceRow(); },
    async updateMany() {
      updates += 1;
      return { count: updates === 1 ? 1 : 0 };
    },
  }), { now: () => NOW });
  await assert.rejects(service.approve({
    ...identity,
    version: 3,
    expectedArtifactSha256: HASH,
    referenceId: "design-ref-3",
    approvedByUserId: "approver-1",
  }), /exact draft changed before approval completed/);
  assert.equal(updates, 2);
});

test("retirement conditions the lifecycle change and reread on the exact approved reference", async () => {
  const calls = [];
  const db = mockDb({
    async updateMany(args) { calls.push(["updateMany", args]); return { count: 1 }; },
    async findFirst(args) {
      calls.push(["findFirst", args]);
      return referenceRow({
        status: "retired",
        approvedByUserId: "approver-1",
        approvedAt: new Date("2026-07-18T17:30:00.000Z"),
        retiredByUserId: "approver-2",
        retiredAt: NOW,
        retirementReason: "reference replaced after controlled review",
      });
    },
  });
  const service = createService(db, { now: () => NOW });
  const retired = await service.retire({
    ...identity,
    version: 3,
    expectedArtifactSha256: HASH,
    referenceId: "design-ref-3",
    retiredByUserId: "approver-2",
    retirementReason: "reference replaced after controlled review",
  });
  assert.equal(retired.status, "retired");
  assert.deepEqual(calls[0][1].where.status, { in: ["draft", "approved"] });
  assert.equal(calls[0][1].where.artifactSha256, HASH);
  assert.equal(calls[0][1].where.version, 3);
  assert.deepEqual(calls[0][1].data, {
    status: "retired",
    retiredByUserId: "approver-2",
    retiredAt: NOW,
    retirementReason: "reference replaced after controlled review",
  });
  assert.equal(calls[1][1].where.status, "retired");
});

test("Prisma schema and additive migration enforce exact identity, lifecycle, and artifact immutability", () => {
  const packageRoot = join(__dirname, "..");
  const schema = readFileSync(join(packageRoot, "prisma", "schema.prisma"), "utf8");
  const sql = readFileSync(
    join(
      packageRoot,
      "prisma",
      "migrations",
      "20260718150000_ai_grader_design_reference_v1",
      "migration.sql",
    ),
    "utf8",
  );

  for (const expectedSchema of [
    "enum AiGraderDesignReferenceStatus",
    "model AiGraderDesignReference",
    "variantId                   String?",
    "variantKey                  String",
    "parallelId                  String?",
    "parallelKey                 String",
    "intendedDesignBoundary      Json",
    "transformAcceptanceMetadata Json",
    "artifactStorageKey          String",
    "artifactSha256              String",
    "approvedByUserId            String?",
    "retiredByUserId             String?",
    'map: "AiGraderDesignReference_identity_version_key"',
  ]) assert.match(schema, new RegExp(expectedSchema.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  for (const expectedSql of [
    'CREATE TABLE "AiGraderDesignReference"',
    '"variantKey" = COALESCE("variantId", \'\')',
    '"parallelKey" = COALESCE("parallelId", \'\')',
    '"profile" = \'registered_design_template_v1\'',
    '"artifactSha256" ~ \'^[0-9a-f]{64}$\'',
    'jsonb_typeof("intendedDesignBoundary") = \'object\'',
    '"intendedDesignBoundary"->>\'schemaVersion\' = \'ai-grader-intended-design-boundary-v1\'',
    '"provenance" @> \'{"approvedForPrecisionReference": true}\'::jsonb',
    '"transformAcceptanceMetadata"->>\'schemaVersion\' = \'ai-grader-design-reference-transform-acceptance-v1\'',
    '("transformAcceptanceMetadata"->>\'minInlierFraction\')::numeric BETWEEN 0 AND 1',
    'position(chr(92) IN "artifactStorageKey") = 0',
    'CREATE UNIQUE INDEX "AiGraderDesignReference_identity_version_key"',
    'CREATE UNIQUE INDEX "AiGraderDesignReference_one_approved_side"',
    'WHERE "status" = \'approved\'',
    'CREATE TRIGGER "AiGraderDesignReference_guard_update"',
    "identity, artifact, boundary, provenance, and acceptance metadata are immutable",
    'CREATE TRIGGER "AiGraderDesignReference_reject_delete"',
    "retire a reference instead of deleting it",
  ]) assert.equal(sql.includes(expectedSql), true, expectedSql);

  assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE)\b/i);
  assert.doesNotMatch(sql, /ALTER\s+TABLE\s+"AiGraderDesignReference"/i);
  assert.match(sql, /ALTER\s+TABLE\s+"CalibrationSnapshot"/i);
  assert.match(sql, /ALTER\s+TABLE\s+"AiGraderReport"/i);
  assert.match(sql, /ADD\s+COLUMN\s+"calibrationSnapshotId"\s+TEXT/i);
});
