import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { NextApiRequest, NextApiResponse } from "next";
import {
  AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV,
  createAiGraderProductionApiHandler,
} from "../lib/server/aiGraderProductionApi";
import { runAiGraderOcrPrefillRuntime } from "../lib/server/aiGraderOcrPrefill";
import {
  sha256Base64ToHex,
  sha256HexToBase64,
  verifyStorageObjectIntegrity,
} from "../lib/server/storage";

type MockResponse = NextApiResponse & {
  statusCodeValue: number | null;
  headers: Record<string, string | number | readonly string[]>;
  jsonBody: unknown;
};

function mockRequest(method: string, action: string[], body: unknown = {}): NextApiRequest {
  return {
    method,
    query: { action },
    body,
    headers: {},
  } as unknown as NextApiRequest;
}

function mockResponse(): MockResponse {
  return {
    statusCodeValue: null,
    headers: {},
    jsonBody: undefined,
    setHeader(this: MockResponse, name: string, value: string | number | readonly string[]) {
      this.headers[name] = value;
      return this;
    },
    status(this: MockResponse, statusCode: number) {
      this.statusCodeValue = statusCode;
      return this;
    },
    json(this: MockResponse, body: unknown) {
      this.jsonBody = body;
      return this;
    },
  } as unknown as MockResponse;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedImages() {
  return [
    {
      side: "front",
      fileName: "front-normalized.png",
      mimeType: "image/png",
      checksumSha256: sha256("front-normalized"),
      byteSize: 2048,
    },
    {
      side: "back",
      fileName: "back-normalized.png",
      mimeType: "image/png",
      checksumSha256: sha256("back-normalized"),
      byteSize: 3072,
    },
  ];
}

function prefillFields() {
  const known = <T extends string | boolean>(value: T, confidence = 0.9) => ({
    value,
    confidence,
    reviewRequired: confidence < 0.8,
    sources: ["front_ocr"],
  });
  const missing = { value: null, confidence: 0, reviewRequired: true, sources: [] };
  return {
    category: known("sport"),
    playerName: known("Michael Jordan"),
    cardName: missing,
    year: known("1990"),
    manufacturer: known("SkyBox"),
    productSet: known("1990 SkyBox Basketball"),
    cardNumber: known("41"),
    parallel: missing,
    insert: missing,
    numbered: missing,
    auto: missing,
    mem: missing,
  };
}

test("OCR prefill uses authenticated direct storage init/finalize without inventory or publish mutations", async () => {
  const authActions: string[] = [];
  const verifiedSides: string[] = [];
  let ocrCalls = 0;
  let persistCalls = 0;
  const handler = createAiGraderProductionApiHandler({
    env: { [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true" },
    async requireAdminSession() {
      throw new Error("production actor injection should own auth");
    },
    async requireProductionActor(_req, action) {
      authActions.push(action);
      return {
        type: "service_account",
        role: "ai_grader_service",
        serviceAccountId: "ocr-test-service",
        scopes: ["publish"],
        audit: {
          actorType: "service_account",
          action,
          requestedAt: "2026-07-09T12:00:00.000Z",
          serviceAccountId: "ocr-test-service",
          role: "ai_grader_service",
        },
      };
    },
    publicUrlFor(storageKey) {
      return `https://cdn.tenkings.test/${storageKey}`;
    },
    async presignUpload({ storageKey, contentType }) {
      return {
        storageKey,
        uploadUrl: `https://uploads.tenkings.test/${storageKey}?X-Amz-Signature=test-only`,
        uploadMethod: "PUT",
        uploadHeaders: { "Content-Type": contentType },
        publicUrl: `https://cdn.tenkings.test/${storageKey}`,
      };
    },
    async verifyUploadedArtifact(input) {
      verifiedSides.push(input.artifactId.split(":").at(-1) ?? "");
      return {
        ok: true,
        byteSize: input.byteSize,
        contentType: input.contentType,
        checksumSha256: input.checksumSha256,
      };
    },
    async runOcrPrefill(input) {
      ocrCalls += 1;
      assert.equal(input.reportId, "ocr-report-1");
      assert.deepEqual(input.images.map((image) => image.side).sort(), ["back", "front"]);
      assert.equal(input.images.every((image) => image.url.startsWith("https://cdn.tenkings.test/")), true);
      assert.equal(JSON.stringify(input).includes("X-Amz"), false);
      return {
        reportId: input.reportId,
        status: "prefill_ready",
        humanConfirmationRequired: true,
        inventoryMutationPerformed: false,
        publishMutationPerformed: false,
        sourceSides: ["front", "back"],
        fields: prefillFields(),
        reviewFieldNames: ["cardName", "parallel", "insert", "numbered", "auto", "mem"],
        provenance: {
          ocrEngine: "google_vision_document_text_detection",
          attributeExtractor: "@tenkings/shared/extractCardAttributes",
          setLookupUsed: true,
          setIdentificationUsed: true,
        },
        warnings: ["Human review is required."],
      } as any;
    },
    async persist() {
      persistCalls += 1;
      throw new Error("OCR prefill must not persist a production report");
    },
  });

  const initRes = mockResponse();
  await handler(
    mockRequest("POST", ["ocr-prefill-init"], {
      reportId: "ocr-report-1",
      images: normalizedImages(),
    }),
    initRes
  );
  assert.equal(initRes.statusCodeValue, 200);
  const initBody = initRes.jsonBody as any;
  assert.equal(initBody.operation, "aiGraderOcrPrefillInit");
  assert.match(initBody.result.uploadSessionId, /^aigocr_[a-f0-9]{32}$/);
  assert.equal(initBody.result.uploadPlan.length, 2);
  assert.equal(initBody.result.uploadPlan.every((image: any) => image.artifactRole === "normalized_card"), true);
  assert.equal(initBody.result.uploadPlan.every((image: any) => image.uploadMethod === "PUT"), true);
  assert.equal(JSON.stringify(initBody).includes("bodyBase64"), false);
  assert.equal(JSON.stringify(initBody).includes("data:image"), false);
  assert.equal(JSON.stringify(initBody).includes("C:\\TenKings"), false);

  const finalizeRes = mockResponse();
  await handler(
    mockRequest("POST", ["ocr-prefill-finalize"], initBody.result.requiredFinalizeManifest),
    finalizeRes
  );
  assert.equal(finalizeRes.statusCodeValue, 200);
  const finalizeBody = finalizeRes.jsonBody as any;
  assert.equal(finalizeBody.operation, "aiGraderOcrPrefillFinalize");
  assert.equal(finalizeBody.result.humanConfirmationRequired, true);
  assert.equal(finalizeBody.result.inventoryMutationPerformed, false);
  assert.equal(finalizeBody.result.publishMutationPerformed, false);
  assert.equal(finalizeBody.result.fields.playerName.value, "Michael Jordan");
  assert.equal(finalizeBody.result.fields.parallel.reviewRequired, true);
  const serializedFinal = JSON.stringify(finalizeBody);
  assert.equal(/https?:\/\//i.test(serializedFinal), false);
  assert.equal(/uploadUrl|publicUrl|storageKey|X-Amz|bodyBase64|data:image|C:\\TenKings/i.test(serializedFinal), false);
  assert.deepEqual(authActions, ["publish", "publish"]);
  assert.deepEqual(verifiedSides.sort(), ["back", "front"]);
  assert.equal(ocrCalls, 1);
  assert.equal(persistCalls, 0);
});

test("OCR prefill existing extractor marks low-confidence values for review", async () => {
  let networkInputs: unknown[] = [];
  const result = await runAiGraderOcrPrefillRuntime(
    {
      reportId: "low-confidence-report",
      images: [
        { side: "front", url: "https://cdn.tenkings.test/front.png" },
        { side: "back", url: "https://cdn.tenkings.test/back.png" },
      ],
    },
    {
      async runOcr(images) {
        networkInputs = images;
        return {
          results: [
            { id: "front", text: "1990 SKYBOX\nMICHAEL JORDAN", confidence: 0.42, tokens: [] },
            { id: "back", text: "BASKETBALL\nCARD NO. 41", confidence: 0.38, tokens: [] },
          ],
          combined_text: "1990 SKYBOX\nMICHAEL JORDAN\nBASKETBALL\nCARD NO. 41",
        };
      },
      async identifySet() {
        return {
          setId: null,
          setName: null,
          programId: null,
          programLabel: null,
          cardNumber: null,
          playerName: null,
          teamName: null,
          confidence: "none",
          reason: "test",
          candidateSetIds: [],
          candidateCount: 0,
          scopedSetCount: 0,
          candidates: [],
          tiebreaker: "none",
          textSource: "none",
        };
      },
      async lookupSet() {
        return {
          match: "none",
          setId: null,
          insertLabel: null,
          programId: null,
          scopedParallels: [],
          parallels: [],
          candidates: [],
        };
      },
    }
  );

  assert.equal(result.humanConfirmationRequired, true);
  assert.equal(result.inventoryMutationPerformed, false);
  assert.equal(result.publishMutationPerformed, false);
  assert.equal(result.fields.year.value, "1990");
  assert.equal(result.fields.year.reviewRequired, true);
  assert.equal(result.fields.manufacturer.value, "SkyBox");
  assert.equal(result.fields.manufacturer.reviewRequired, true);
  assert.equal(result.fields.cardNumber.value, "41");
  assert.equal(result.fields.cardNumber.reviewRequired, true);
  assert.ok(result.reviewFieldNames.includes("year"));
  assert.equal(JSON.stringify(networkInputs).includes("base64"), false);
  assert.equal((networkInputs as any[]).every((image) => typeof image.url === "string"), true);
});

test("OCR prefill finalize fails closed when the storage-provided checksum is missing or tampered", async () => {
  for (const storedChecksum of [undefined, "0".repeat(64)]) {
    let ocrCalls = 0;
    const handler = createAiGraderProductionApiHandler({
      env: { [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true" },
      async requireAdminSession() {
        throw new Error("not used");
      },
      async requireProductionActor(_req, action) {
        return {
          type: "service_account",
          role: "ai_grader_service",
          serviceAccountId: "ocr-checksum-test",
          scopes: ["publish"],
          audit: { actorType: "service_account", action, requestedAt: "2026-07-09T12:00:00.000Z" },
        };
      },
      publicUrlFor(storageKey) {
        return `https://cdn.tenkings.test/${storageKey}`;
      },
      async presignUpload({ storageKey, contentType, checksumSha256 }) {
        return {
          storageKey,
          uploadUrl: `https://uploads.tenkings.test/${storageKey}`,
          uploadMethod: "PUT",
          uploadHeaders: { "Content-Type": contentType, "x-amz-meta-sha256": checksumSha256 },
          publicUrl: `https://cdn.tenkings.test/${storageKey}`,
        };
      },
      async verifyUploadedArtifact(input) {
        return {
          ok: true,
          byteSize: input.byteSize,
          contentType: input.contentType,
          checksumSha256: storedChecksum,
        };
      },
      async runOcrPrefill() {
        ocrCalls += 1;
        throw new Error("OCR must not run for an unverified object");
      },
    });
    const initRes = mockResponse();
    await handler(
      mockRequest("POST", ["ocr-prefill-init"], {
        reportId: `checksum-${storedChecksum ? "tampered" : "missing"}`,
        images: normalizedImages(),
      }),
      initRes
    );
    assert.equal(initRes.statusCodeValue, 200);
    const finalizeRes = mockResponse();
    await handler(
      mockRequest("POST", ["ocr-prefill-finalize"], (initRes.jsonBody as any).result.requiredFinalizeManifest),
      finalizeRes
    );
    assert.notEqual(finalizeRes.statusCodeValue, 200);
    assert.match(String((finalizeRes.jsonBody as any)?.message ?? ""), /storage-provided sha-256 checksum/i);
    assert.equal(ocrCalls, 0);
  }
});

test("storage checksum verification rejects same-size wrong bytes even when mutable metadata claims the expected hash", () => {
  const expectedChecksum = sha256("same-size-expected");
  const wrongBytesChecksum = sha256("same-size-tampered");
  const byteSize = Buffer.byteLength("same-size-expected");
  assert.equal(byteSize, Buffer.byteLength("same-size-tampered"));

  const verified = verifyStorageObjectIntegrity({
    storageKey: "ai-grader/reports/checksum/ocr-prefill/front.png",
    expectedByteSize: byteSize,
    expectedChecksumSha256: expectedChecksum,
    head: {
      storageKey: "ai-grader/reports/checksum/ocr-prefill/front.png",
      byteSize,
      contentType: "image/png",
      // Object metadata is caller-controlled and deliberately lies. Verification
      // must use only the storage provider's checksum of the actual object bytes.
      metadata: { sha256: expectedChecksum },
      checksumSha256: wrongBytesChecksum,
    },
  });

  assert.equal(verified.ok, false);
  assert.equal(verified.checksumSha256, wrongBytesChecksum);
  assert.match(String(verified.message), /storage-provided sha-256 checksum mismatch/i);

  const missingActualChecksum = verifyStorageObjectIntegrity({
    storageKey: "ai-grader/reports/checksum/ocr-prefill/back.png",
    expectedByteSize: byteSize,
    expectedChecksumSha256: expectedChecksum,
    head: {
      storageKey: "ai-grader/reports/checksum/ocr-prefill/back.png",
      byteSize,
      contentType: "image/png",
      metadata: { sha256: expectedChecksum },
      checksumSha256: null,
    },
  });
  assert.equal(missingActualChecksum.ok, false);
  assert.match(String(missingActualChecksum.message), /missing or invalid/i);
});

test("OCR upload checksum conversion is strict and round-trips S3 base64 SHA-256", () => {
  const checksumHex = sha256("normalized-card-bytes");
  const checksumBase64 = sha256HexToBase64(checksumHex.toUpperCase());
  assert.equal(checksumBase64.length, 44);
  assert.equal(sha256Base64ToHex(checksumBase64), checksumHex);
  assert.equal(sha256Base64ToHex(`${checksumBase64.slice(0, -1)}A`), null);
  assert.equal(sha256Base64ToHex("not-base64"), null);
  assert.throws(() => sha256HexToBase64("0".repeat(63)), /64-character hex digest/);
});

test("OCR prefill rejects image bodies, caller URLs, and unsafe storage source URLs", async () => {
  let authCalls = 0;
  let ocrCalls = 0;
  const handler = createAiGraderProductionApiHandler({
    env: { [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true" },
    async requireAdminSession() {
      throw new Error("not used");
    },
    async requireProductionActor(_req, action) {
      authCalls += 1;
      return {
        type: "service_account",
        role: "ai_grader_service",
        serviceAccountId: "ocr-test-service",
        scopes: ["publish"],
        audit: { actorType: "service_account", action, requestedAt: "2026-07-09T12:00:00.000Z" },
      };
    },
    publicUrlFor(storageKey) {
      return `http://127.0.0.1:47652/${storageKey}?X-Amz-Signature=must-not-leak`;
    },
    async presignUpload({ storageKey, contentType }) {
      return {
        storageKey,
        uploadUrl: `https://uploads.tenkings.test/${storageKey}`,
        uploadMethod: "PUT",
        uploadHeaders: { "Content-Type": contentType },
        publicUrl: `https://cdn.tenkings.test/${storageKey}`,
      };
    },
    async runOcrPrefill() {
      ocrCalls += 1;
      throw new Error("OCR must not run for unsafe input");
    },
    async verifyUploadedArtifact() {
      return { ok: true };
    },
    async persist() {
      throw new Error("not used");
    },
  });

  const bodyRes = mockResponse();
  const imagesWithBody = normalizedImages();
  (imagesWithBody[0] as any).bodyBase64 = "embedded-image";
  await handler(mockRequest("POST", ["ocr-prefill-init"], { reportId: "unsafe-report", images: imagesWithBody }), bodyRes);
  assert.equal(bodyRes.statusCodeValue, 400);
  assert.match((bodyRes.jsonBody as any).message, /Unsafe AI Grader publish payload|direct storage upload metadata/);

  const urlRes = mockResponse();
  const imagesWithUrl = normalizedImages();
  (imagesWithUrl[0] as any).publicUrl = "https://uploads.tenkings.test/front.png?X-Amz-Signature=caller";
  await handler(mockRequest("POST", ["ocr-prefill-init"], { reportId: "unsafe-report", images: imagesWithUrl }), urlRes);
  assert.equal(urlRes.statusCodeValue, 400);
  assert.match((urlRes.jsonBody as any).message, /Unsafe AI Grader publish payload|URLs are not accepted/);

  const credentialRes = mockResponse();
  await handler(
    mockRequest("POST", ["ocr-prefill-init"], {
      reportId: "unsafe-report",
      images: normalizedImages(),
      ocrPrefill: { accessToken: "must-not-survive", nested: { apiKey: "must-not-survive" } },
    }),
    credentialRes
  );
  assert.equal(credentialRes.statusCodeValue, 400);
  assert.match((credentialRes.jsonBody as any).message, /Unsafe AI Grader publish payload/);

  const hardwareRes = mockResponse();
  await handler(
    mockRequest("POST", ["ocr-prefill-init"], {
      reportId: "unsafe-report",
      images: normalizedImages(),
      hardwareControls: { leimacOn: true },
    }),
    hardwareRes
  );
  assert.equal(hardwareRes.statusCodeValue, 400);

  const privateHostRes = mockResponse();
  await handler(
    mockRequest("POST", ["ocr-prefill-init"], {
      reportId: "unsafe-report",
      images: normalizedImages(),
      diagnosticUrl: "http://dell.local:47652/status",
    }),
    privateHostRes
  );
  assert.equal(privateHostRes.statusCodeValue, 400);

  const sourceRes = mockResponse();
  await handler(mockRequest("POST", ["ocr-prefill-init"], { reportId: "unsafe-report", images: normalizedImages() }), sourceRes);
  assert.equal(sourceRes.statusCodeValue, 400);
  assert.match((sourceRes.jsonBody as any).message, /public HTTPS object URL/);
  assert.equal(ocrCalls, 0);
  assert.equal(authCalls, 1);
});
