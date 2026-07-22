import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import test from "node:test";
import assert from "node:assert/strict";
import type { NextApiRequest, NextApiResponse } from "next";
import { createAiGraderDesignReferenceApiHandler } from "../lib/server/aiGraderDesignReferenceApi";
import { createAiGraderDesignReferenceUploadReceiptAuthorityV1 } from "../lib/server/aiGraderDesignReferenceUploadReceipt";
import {
  createPrivateDesignReferenceUploadCommand,
  presignPrivateDesignReferenceUploadUrl,
} from "../lib/server/storage";

function response() {
  const state: {
    status?: number;
    body?: any;
    headers: Record<string, string>;
  } = { headers: {} };
  const res = {
    status(code: number) { state.status = code; return this; },
    json(body: unknown) { state.body = body; return this; },
    send(body: unknown) { state.body = body; return this; },
    setHeader(name: string, value: string) { state.headers[name] = value; return this; },
  } as unknown as NextApiResponse;
  return { state, res };
}

function request(action: string, body: Record<string, unknown>) {
  return {
    method: "POST",
    query: { action: [action] },
    body,
    headers: {},
  } as unknown as NextApiRequest;
}

function pngBytes(width: number, height: number) {
  function crc32(bytes: Buffer) {
    let crc = 0xffffffff;
    for (const value of bytes) {
      crc ^= value;
      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
  function chunk(type: string, data: Buffer) {
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

const NOW = Date.parse("2026-07-21T15:00:00.000Z");
const SECRET = "focused-design-reference-receipt-secret-value";
const STORAGE_KEY =
  `ai-grader/design-references/imports/${"1".repeat(64)}/v4-back-11111111-1111-4111-8111-111111111111.png`;
const ARTIFACT_BYTES = pngBytes(100, 200);
const ARTIFACT_HASH = createHash("sha256").update(ARTIFACT_BYTES).digest("hex");
const MANIFEST = Object.freeze({
  tenantId: "tenant-1",
  setId: "set-1",
  programId: "program-1",
  cardNumber: "7",
  variantId: null,
  parallelId: "gold",
  side: "back",
  profile: "registered_design_template_v1",
  version: 4,
  fileName: "controlled-back.png",
  contentType: "image/png",
  byteSize: ARTIFACT_BYTES.byteLength,
  checksumSha256: ARTIFACT_HASH,
} as const);

function metadata() {
  return {
    intendedDesignBoundary: {
      schemaVersion: "ai-grader-intended-design-boundary-v1",
      coordinateFrame: "design_reference_pixels",
      contour: [[10, 20], [90, 20], [90, 180], [10, 180]],
    },
    provenance: {
      schemaVersion: "ai-grader-design-reference-provenance-v1",
      sourceKind: "controlled_scan",
      approvedForPrecisionReference: true,
    },
    transformAcceptanceMetadata: {
      schemaVersion: "ai-grader-design-reference-transform-acceptance-v1",
      registrationAlgorithmVersion: "registered-design-registration-v1",
      maxResidualPx: 2,
      minInlierFraction: 0.8,
    },
  };
}

function draftBody(uploadReceipt: string, overrides: Record<string, unknown> = {}) {
  return {
    uploadReceipt,
    tenantId: MANIFEST.tenantId,
    setId: MANIFEST.setId,
    programId: MANIFEST.programId,
    cardNumber: MANIFEST.cardNumber,
    variantId: MANIFEST.variantId,
    parallelId: MANIFEST.parallelId,
    side: MANIFEST.side,
    profile: MANIFEST.profile,
    version: MANIFEST.version,
    ...metadata(),
    ...overrides,
  };
}

function referenceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "draft-1",
    tenantId: MANIFEST.tenantId,
    setId: MANIFEST.setId,
    programId: MANIFEST.programId,
    cardNumber: MANIFEST.cardNumber,
    variantId: MANIFEST.variantId,
    variantKey: "",
    parallelId: MANIFEST.parallelId,
    parallelKey: MANIFEST.parallelId,
    side: MANIFEST.side,
    profile: MANIFEST.profile,
    version: MANIFEST.version,
    status: "draft",
    artifactStorageKey: STORAGE_KEY,
    artifactSha256: ARTIFACT_HASH,
    artifactMimeType: "image/png",
    artifactWidthPx: 100,
    artifactHeightPx: 200,
    ...metadata(),
    createdByUserId: "admin-exact",
    approvedByUserId: null,
    approvedAt: null,
    retiredByUserId: null,
    retiredAt: null,
    retirementReason: null,
    createdAt: new Date("2026-07-21T15:00:00.000Z"),
    updatedAt: new Date("2026-07-21T15:00:00.000Z"),
    ...overrides,
  };
}

function service(overrides: Record<string, unknown> = {}) {
  return {
    async createVerifiedDraft() { return referenceRow(); },
    async list() { return []; },
    async resolveExactApproved() { return referenceRow({ status: "approved" }); },
    async approve() { return referenceRow({ status: "approved" }); },
    async retire() { return referenceRow({ status: "retired" }); },
    ...overrides,
  } as any;
}

function authority(now: () => number = () => NOW, ttlMs?: number) {
  return createAiGraderDesignReferenceUploadReceiptAuthorityV1({
    secret: SECRET,
    now,
    ttlMs,
  });
}

test("private presigner cannot inherit public-read global asset ACL", async () => {
  const previousAcl = process.env.CARD_STORAGE_ACL;
  process.env.CARD_STORAGE_ACL = "public-read";
  try {
    const command = createPrivateDesignReferenceUploadCommand({
      storageKey: STORAGE_KEY,
      contentType: "image/png",
      checksumSha256: ARTIFACT_HASH,
    }, "controlled-private-bucket");
    assert.equal(command.input.ACL, "private");
    assert.notEqual(command.input.ACL, "public-read");

    let signedAcl: unknown;
    let unhoistableHeaders: Set<string> | undefined;
    const uploadUrl = await presignPrivateDesignReferenceUploadUrl({
      storageKey: STORAGE_KEY,
      contentType: "image/png",
      checksumSha256: ARTIFACT_HASH,
    }, {
      bucket: "controlled-private-bucket",
      client: {} as any,
      async sign(_client, signedCommand, options) {
        signedAcl = (signedCommand as unknown as typeof command).input.ACL;
        unhoistableHeaders = options?.unhoistableHeaders;
        return "https://private-storage.example/exact";
      },
    });
    assert.equal(uploadUrl, "https://private-storage.example/exact");
    assert.equal(signedAcl, "private");
    assert.equal(unhoistableHeaders?.has("x-amz-acl"), true);
    assert.equal(unhoistableHeaders?.has("x-amz-checksum-sha256"), true);
  } finally {
    if (previousAcl === undefined) delete process.env.CARD_STORAGE_ACL;
    else process.env.CARD_STORAGE_ACL = previousAcl;
  }
});

test("exact plan, upload, and draft binding succeeds without exposing raw storage authority", async () => {
  const receiptAuthority = authority();
  let createdInput: Record<string, unknown> | undefined;
  let readKey: string | undefined;
  const runtime = createAiGraderDesignReferenceApiHandler({
    async requireAdminSession() { return { user: { id: "admin-exact" } }; },
    uploadReceiptAuthority: receiptAuthority,
    service: service({
      async createVerifiedDraft(input: Record<string, unknown>) {
        createdInput = input;
        return referenceRow(input);
      },
    }),
    async planArtifactUpload(input) {
      assert.deepEqual(input, MANIFEST);
      return {
        storageKey: STORAGE_KEY,
        uploadUrl: "https://private-storage.example/exact",
        uploadMethod: "PUT",
        uploadHeaders: {
          "Content-Type": "image/png",
          "x-amz-acl": "private",
          "x-amz-checksum-sha256": "native-checksum",
        },
        contentType: "image/png",
        byteSize: ARTIFACT_BYTES.byteLength,
        checksumSha256: ARTIFACT_HASH,
      };
    },
    async readArtifactBytes(storageKey) {
      readKey = storageKey;
      return ARTIFACT_BYTES;
    },
  });

  const planned = response();
  await runtime(request("upload-plan", MANIFEST), planned.res);
  assert.equal(planned.state.status, 200);
  assert.equal(planned.state.headers["Cache-Control"], "private, no-store, max-age=0");
  const plan = planned.state.body.uploadPlan;
  assert.equal(plan.uploadHeaders["x-amz-acl"], "private");
  assert.equal(typeof plan.uploadReceipt, "string");
  assert.equal(Object.prototype.hasOwnProperty.call(plan, "storageKey"), false);
  assert.equal(JSON.stringify(planned.state.body).includes(STORAGE_KEY), false);
  const claims = receiptAuthority.verify(plan.uploadReceipt);
  assert.equal(claims.storageKey, STORAGE_KEY);
  assert.equal(claims.issuedToUserId, "admin-exact");
  for (const [field, value] of Object.entries(MANIFEST)) {
    assert.deepEqual(claims[field as keyof typeof claims], value);
  }

  const drafted = response();
  await runtime(request("draft", draftBody(plan.uploadReceipt)), drafted.res);
  assert.equal(drafted.state.status, 201);
  assert.equal(readKey, STORAGE_KEY);
  assert.equal(createdInput?.artifactStorageKey, STORAGE_KEY);
  assert.equal(createdInput?.expectedArtifactByteSize, ARTIFACT_BYTES.byteLength);
  assert.equal(createdInput?.expectedArtifactMimeType, "image/png");
  assert.equal(createdInput?.expectedArtifactSha256, ARTIFACT_HASH);
  assert.equal(createdInput?.createdByUserId, "admin-exact");
  assert.equal(JSON.stringify(drafted.state.body).includes(STORAGE_KEY), false);
});

test("wrong identity, side, or version is rejected before object read or create", async () => {
  let reads = 0;
  let creates = 0;
  const receiptAuthority = authority();
  const receipt = receiptAuthority.issue({
    ...MANIFEST,
    storageKey: STORAGE_KEY,
    issuedToUserId: "admin-exact",
  }).uploadReceipt;
  const runtime = createAiGraderDesignReferenceApiHandler({
    async requireAdminSession() { return { user: { id: "admin-exact" } }; },
    uploadReceiptAuthority: receiptAuthority,
    service: service({ async createVerifiedDraft() { creates += 1; return referenceRow(); } }),
    async readArtifactBytes() { reads += 1; return ARTIFACT_BYTES; },
  });

  for (const mismatch of [
    { tenantId: "cross-tenant" },
    { side: "front" },
    { version: 5 },
  ]) {
    const attempted = response();
    await runtime(request("draft", draftBody(receipt, mismatch)), attempted.res);
    assert.equal(attempted.state.status, 409);
    assert.equal(
      attempted.state.body.code,
      "AI_GRADER_DESIGN_REFERENCE_UPLOAD_RECEIPT_BINDING_MISMATCH",
    );
  }
  assert.equal(reads, 0);
  assert.equal(creates, 0);
});

test("wrong storage key, size, MIME, or checksum is rejected before create", async () => {
  let creates = 0;
  const receiptAuthority = authority();
  const alternateStorageKey =
    `ai-grader/design-references/imports/${"2".repeat(64)}/v4-back-22222222-2222-4222-8222-222222222222.png`;
  const bindings = [
    { ...MANIFEST, storageKey: alternateStorageKey, issuedToUserId: "admin-exact" },
    { ...MANIFEST, byteSize: ARTIFACT_BYTES.byteLength + 1, storageKey: STORAGE_KEY, issuedToUserId: "admin-exact" },
    {
      ...MANIFEST,
      fileName: "controlled-back.jpg",
      contentType: "image/jpeg" as const,
      storageKey: STORAGE_KEY.replace(/\.png$/, ".jpg"),
      issuedToUserId: "admin-exact",
    },
    { ...MANIFEST, checksumSha256: "c".repeat(64), storageKey: STORAGE_KEY, issuedToUserId: "admin-exact" },
  ];

  for (const binding of bindings) {
    const runtime = createAiGraderDesignReferenceApiHandler({
      async requireAdminSession() { return { user: { id: "admin-exact" } }; },
      uploadReceiptAuthority: receiptAuthority,
      service: service({ async createVerifiedDraft() { creates += 1; return referenceRow(); } }),
      async readArtifactBytes(storageKey) {
        if (storageKey === alternateStorageKey) throw new Error("unplanned object");
        return ARTIFACT_BYTES;
      },
    });
    const receipt = receiptAuthority.issue(binding).uploadReceipt;
    const attempted = response();
    await runtime(request("draft", draftBody(receipt)), attempted.res);
    assert.equal(attempted.state.status, 409);
    assert.equal(
      attempted.state.body.code,
      "AI_GRADER_DESIGN_REFERENCE_UPLOAD_RECEIPT_STORAGE_MISMATCH",
    );
  }
  assert.equal(creates, 0);
});

test("public plan, raw key, expired receipt, and replay are rejected", async () => {
  let now = NOW;
  let issues = 0;
  let creates = 0;
  const rows: any[] = [];
  const receiptAuthority = authority(() => now, 5_000);
  const publicPlan = createAiGraderDesignReferenceApiHandler({
    async requireAdminSession() { return { user: { id: "admin-exact" } }; },
    uploadReceiptAuthority: {
      issue(binding) { issues += 1; return receiptAuthority.issue(binding); },
      verify(receipt) { return receiptAuthority.verify(receipt); },
    },
    service: service(),
    async planArtifactUpload() {
      return {
        storageKey: STORAGE_KEY,
        uploadUrl: "https://private-storage.example/exact",
        uploadMethod: "PUT",
        uploadHeaders: {
          "Content-Type": "image/png",
          "x-amz-acl": "public-read",
          "x-amz-checksum-sha256": "native-checksum",
        },
        contentType: "image/png",
        byteSize: ARTIFACT_BYTES.byteLength,
        checksumSha256: ARTIFACT_HASH,
      };
    },
  });
  const leaked = response();
  await publicPlan(request("upload-plan", MANIFEST), leaked.res);
  assert.equal(leaked.state.status, 503);
  assert.equal(leaked.state.body.code, "AI_GRADER_DESIGN_REFERENCE_UPLOAD_PLAN_UNAVAILABLE");
  assert.equal(issues, 0);

  const runtime = createAiGraderDesignReferenceApiHandler({
    async requireAdminSession() { return { user: { id: "admin-exact" } }; },
    uploadReceiptAuthority: receiptAuthority,
    service: service({
      async list() { return rows; },
      async createVerifiedDraft(input: Record<string, unknown>) {
        creates += 1;
        const row = referenceRow(input);
        rows.push(row);
        return row;
      },
    }),
    async readArtifactBytes() { return ARTIFACT_BYTES; },
  });
  const raw = response();
  await runtime(request("draft", {
    ...draftBody("not-a-receipt"),
    artifactStorageKey: STORAGE_KEY,
  }), raw.res);
  assert.equal(raw.state.status, 400);
  assert.equal(raw.state.body.code, "AI_GRADER_DESIGN_REFERENCE_UPLOAD_RECEIPT_INVALID");
  assert.equal(creates, 0);

  const expiredReceipt = receiptAuthority.issue({
    ...MANIFEST,
    storageKey: STORAGE_KEY,
    issuedToUserId: "admin-exact",
  }).uploadReceipt;
  now += 5_001;
  const expired = response();
  await runtime(request("draft", draftBody(expiredReceipt)), expired.res);
  assert.equal(expired.state.status, 409);
  assert.equal(expired.state.body.code, "AI_GRADER_DESIGN_REFERENCE_UPLOAD_RECEIPT_EXPIRED");
  assert.equal(creates, 0);

  const replayReceipt = receiptAuthority.issue({
    ...MANIFEST,
    storageKey: STORAGE_KEY,
    issuedToUserId: "admin-exact",
  }).uploadReceipt;
  const first = response();
  await runtime(request("draft", draftBody(replayReceipt)), first.res);
  assert.equal(first.state.status, 201);
  const replay = response();
  await runtime(request("draft", draftBody(replayReceipt)), replay.res);
  assert.equal(replay.state.status, 409);
  assert.equal(replay.state.body.code, "AI_GRADER_DESIGN_REFERENCE_UPLOAD_RECEIPT_REPLAYED");
  assert.equal(creates, 1);
});
