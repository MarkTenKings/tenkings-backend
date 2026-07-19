import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import test from "node:test";
import type { NextApiRequest, NextApiResponse } from "next";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV,
  createAiGraderProductionApiHandler,
} from "../lib/server/aiGraderProductionApi";
import {
  AI_GRADER_OCR_PROVIDER_TIME_BUDGET_MS,
  runAiGraderOcrPrefillRuntime as runExactAiGraderOcrPrefillRuntime,
  type AiGraderOcrPrefillRuntimeDependencies,
} from "../lib/server/aiGraderOcrPrefill";
import {
  AiGraderOcrFailure,
  aiGraderOcrFailurePresentation,
  type AiGraderOcrFailureCode,
} from "../lib/aiGraderOcrFailure";
import { AiGraderGoogleVisionError } from "../lib/server/googleVisionOcr";
import { AiGraderOcrStructuredExtractionError } from "../lib/server/aiGraderOcrStructuredExtraction";
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

function exactOcrIdentity(reportId: string) {
  return {
    queueItemId: `${reportId}-queue-item`,
    gradingSessionId: `${reportId}-grading-session`,
    reportId,
  };
}

type OcrRuntimeInput = Parameters<typeof runExactAiGraderOcrPrefillRuntime>[0];

function runAiGraderOcrPrefillRuntime(
  input: Omit<OcrRuntimeInput, "queueItemId" | "gradingSessionId">,
  dependencies?: AiGraderOcrPrefillRuntimeDependencies,
) {
  return runExactAiGraderOcrPrefillRuntime({ ...exactOcrIdentity(input.reportId), ...input }, dependencies);
}

function mockRequest(method: string, action: string[], body: unknown = {}): NextApiRequest {
  let requestBody = body;
  if (action[0] === "ocr-prefill-init" && body && typeof body === "object" && !Array.isArray(body)) {
    const source = body as Record<string, unknown>;
    const reportId = String(source.reportId ?? "ocr-test-report");
    const identity = {
      ...exactOcrIdentity(reportId),
      ...(typeof source.queueItemId === "string" ? { queueItemId: source.queueItemId } : {}),
      ...(typeof source.gradingSessionId === "string" ? { gradingSessionId: source.gradingSessionId } : {}),
    };
    requestBody = {
      reportProducerContractVersion: "ai-grader-report-producer-v0.2",
      ...identity,
      ...source,
      images: Array.isArray(source.images)
        ? source.images.map((image) => ({ ...identity, ...(image as Record<string, unknown>) }))
        : source.images,
    };
  }
  return {
    method,
    query: { action },
    body: requestBody,
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
      artifactRole: "normalized_card",
      fileName: "front-normalized-card.png",
      mimeType: "image/png",
      checksumSha256: sha256("front-normalized"),
      byteSize: 2048,
      widthPx: 1200,
      heightPx: 1680,
    },
    {
      side: "back",
      artifactRole: "normalized_card",
      fileName: "back-normalized-card.png",
      mimeType: "image/png",
      checksumSha256: sha256("back-normalized"),
      byteSize: 3072,
      widthPx: 1200,
      heightPx: 1680,
    },
  ];
}

function prefillFields() {
  const known = <T extends string | boolean>(value: T, confidence = 0.9) => ({
    state: "supported" as const,
    value,
    confidence,
    reviewRequired: confidence < 0.8,
    evidenceRefs: ["google.front.text"],
  });
  const missing = { state: "unknown" as const, value: null, confidence: 0, reviewRequired: true, evidenceRefs: [] };
  return {
    category: known("sport"),
    playerName: known("Michael Jordan"),
    cardName: missing,
    year: known("1990"),
    manufacturer: known("SkyBox"),
    sport: known("basketball"),
    game: missing,
    productSet: known("1990 SkyBox Basketball"),
    cardNumber: known("41"),
    parallel: missing,
    insert: missing,
    numbered: missing,
    autograph: missing,
    memorabilia: missing,
  };
}

test("OCR prefill uses authenticated direct storage init/finalize without inventory or publish mutations", async () => {
  const authActions: string[] = [];
  const verifiedSides: string[] = [];
  let ocrCalls = 0;
  let persistCalls = 0;
  let recordedDiagnostics: unknown = null;
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
    async presignUpload({ storageKey, contentType, checksumSha256 }) {
      return {
        storageKey,
        uploadUrl: `https://uploads.tenkings.test/${storageKey}?X-Amz-Signature=test-only`,
        uploadMethod: "PUT",
        uploadHeaders: {
          "Content-Type": contentType,
          "x-amz-checksum-sha256": sha256HexToBase64(checksumSha256),
        },
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
        widthPx: input.sourceImageWidthPx,
        heightPx: input.sourceImageHeightPx,
      };
    },
    async runOcrPrefill(input) {
      ocrCalls += 1;
      assert.equal(input.reportId, "ocr-report-1");
      assert.deepEqual(input.images.map((image) => image.side).sort(), ["back", "front"]);
      assert.equal(input.images.every((image) => image.url.startsWith("https://cdn.tenkings.test/")), true);
      assert.equal(JSON.stringify(input).includes("X-Amz"), false);
      return {
        queueItemId: input.queueItemId,
        gradingSessionId: input.gradingSessionId,
        reportId: input.reportId,
        status: "prefill_ready",
        humanConfirmationRequired: true,
        inventoryMutationPerformed: false,
        publishMutationPerformed: false,
        sourceSides: ["front", "back"],
        fields: prefillFields(),
        reviewFieldNames: ["cardName", "game", "parallel", "insert", "numbered", "autograph", "memorabilia"],
        provenance: {
          ocrEngine: "google_vision_document_text_detection_url_only",
          attributeExtractor: "@tenkings/shared/extractCardAttributes",
          structuredExtractor: "openai_responses_strict_json_schema",
          structuredExtractionModel: "gpt-5.6-sol",
          setLookupUsed: true,
          setIdentificationUsed: true,
        },
        warnings: ["Human review is required."],
        internalProviderDiagnostics: {
          schemaVersion: "ai-grader-ocr-provider-diagnostics-v1",
          googleElapsedMs: 321,
          openAiElapsedMs: 654,
          totalProviderElapsedMs: 975,
          actualOpenAiModel: "gpt-5.6-sol-2026-07-01",
        },
      } as any;
    },
    recordOcrProviderDiagnostics(diagnostics) {
      recordedDiagnostics = diagnostics;
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
  assert.equal(initBody.result.queueItemId, "ocr-report-1-queue-item");
  assert.equal(initBody.result.gradingSessionId, "ocr-report-1-grading-session");
  assert.equal(initBody.result.reportId, "ocr-report-1");
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
  assert.equal(finalizeBody.result.queueItemId, "ocr-report-1-queue-item");
  assert.equal(finalizeBody.result.gradingSessionId, "ocr-report-1-grading-session");
  assert.equal(finalizeBody.result.humanConfirmationRequired, true);
  assert.equal(finalizeBody.result.inventoryMutationPerformed, false);
  assert.equal(finalizeBody.result.publishMutationPerformed, false);
  assert.equal(finalizeBody.result.fields.playerName.value, "Michael Jordan");
  assert.equal(finalizeBody.result.fields.parallel.reviewRequired, true);
  const serializedFinal = JSON.stringify(finalizeBody);
  assert.equal(/https?:\/\//i.test(serializedFinal), false);
  assert.equal(/uploadUrl|publicUrl|storageKey|X-Amz|bodyBase64|data:image|C:\\TenKings/i.test(serializedFinal), false);
  assert.equal(/internalProviderDiagnostics|googleElapsedMs|openAiElapsedMs|totalProviderElapsedMs/i.test(serializedFinal), false);
  assert.deepEqual(recordedDiagnostics, {
    schemaVersion: "ai-grader-ocr-provider-diagnostics-v1",
    googleElapsedMs: 321,
    openAiElapsedMs: 654,
    totalProviderElapsedMs: 975,
    actualOpenAiModel: "gpt-5.6-sol-2026-07-01",
  });
  assert.deepEqual(authActions, ["publish", "publish"]);
  assert.deepEqual(verifiedSides.sort(), ["back", "front"]);
  assert.equal(ocrCalls, 1);
  assert.equal(persistCalls, 0);
});

test("hosted OCR rejects queue, grading-session, or report drift at init, finalize, and provider result", async () => {
  let presignCalls = 0;
  let verifyCalls = 0;
  let providerCalls = 0;
  const handler = createAiGraderProductionApiHandler({
    env: { [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true" },
    async requireAdminSession() { throw new Error("not used"); },
    async requireProductionActor(_req, action) {
      return {
        type: "service_account",
        role: "ai_grader_service",
        serviceAccountId: "ocr-identity-test",
        scopes: ["publish"],
        audit: { actorType: "service_account", action, requestedAt: "2026-07-18T12:00:00.000Z" },
      };
    },
    publicUrlFor(storageKey) { return `https://cdn.tenkings.test/${storageKey}`; },
    async presignUpload({ storageKey, contentType, checksumSha256 }) {
      presignCalls += 1;
      return {
        storageKey,
        uploadUrl: `https://uploads.tenkings.test/${storageKey}`,
        uploadMethod: "PUT",
        uploadHeaders: {
          "Content-Type": contentType,
          "x-amz-checksum-sha256": sha256HexToBase64(checksumSha256),
        },
        publicUrl: `https://cdn.tenkings.test/${storageKey}`,
      };
    },
    async verifyUploadedArtifact(input) {
      verifyCalls += 1;
      return {
        ok: true,
        byteSize: input.byteSize,
        contentType: input.contentType,
        checksumSha256: input.checksumSha256,
        widthPx: input.sourceImageWidthPx,
        heightPx: input.sourceImageHeightPx,
      };
    },
    async runOcrPrefill(input) {
      providerCalls += 1;
      return {
        ...input,
        queueItemId: "different-queue-item",
        status: "prefill_ready",
        humanConfirmationRequired: true,
        inventoryMutationPerformed: false,
        publishMutationPerformed: false,
        sourceSides: ["front", "back"],
        fields: prefillFields(),
        reviewFieldNames: [],
        provenance: {
          ocrEngine: "google_vision_document_text_detection_url_only",
          attributeExtractor: "@tenkings/shared/extractCardAttributes",
          structuredExtractor: "openai_responses_strict_json_schema",
          structuredExtractionModel: "gpt-5.6-sol",
          setLookupUsed: false,
          setIdentificationUsed: false,
        },
        warnings: [],
      } as any;
    },
    async persist() { throw new Error("OCR must not publish"); },
  });

  const invalidNameImages = normalizedImages();
  invalidNameImages[0] = { ...invalidNameImages[0]!, fileName: "../front-normalized.png" };
  const invalidNameInit = mockResponse();
  await handler(mockRequest("POST", ["ocr-prefill-init"], {
    reportId: "identity-report",
    images: invalidNameImages,
  }), invalidNameInit);
  assert.equal(invalidNameInit.statusCodeValue, 400);
  assert.match(String((invalidNameInit.jsonBody as any).message), /exact safe PNG file name/i);
  assert.equal(presignCalls, 0);

  const noncanonicalNameImages = normalizedImages();
  noncanonicalNameImages[0] = { ...noncanonicalNameImages[0]!, fileName: "different-front.png" };
  const noncanonicalNameInit = mockResponse();
  await handler(mockRequest("POST", ["ocr-prefill-init"], {
    reportId: "identity-report",
    images: noncanonicalNameImages,
  }), noncanonicalNameInit);
  assert.equal(noncanonicalNameInit.statusCodeValue, 400);
  assert.match(String((noncanonicalNameInit.jsonBody as any).message), /front-normalized-card\.png/i);
  assert.equal(presignCalls, 0);

  const crossedImages = normalizedImages();
  (crossedImages[0] as any).queueItemId = "different-queue-item";
  const crossedInit = mockResponse();
  await handler(mockRequest("POST", ["ocr-prefill-init"], { reportId: "identity-report", images: crossedImages }), crossedInit);
  assert.equal(crossedInit.statusCodeValue, 409);
  assert.equal((crossedInit.jsonBody as any).code, "AI_GRADER_OCR_IDENTITY_MISMATCH");
  assert.equal(presignCalls, 0);

  const initRes = mockResponse();
  await handler(mockRequest("POST", ["ocr-prefill-init"], { reportId: "identity-report", images: normalizedImages() }), initRes);
  assert.equal(initRes.statusCodeValue, 200);
  const manifest = (initRes.jsonBody as any).result.requiredFinalizeManifest;

  const crossedFinalize = mockResponse();
  await handler(mockRequest("POST", ["ocr-prefill-finalize"], { ...manifest, gradingSessionId: "different-session" }), crossedFinalize);
  assert.equal(crossedFinalize.statusCodeValue, 409);
  assert.equal((crossedFinalize.jsonBody as any).code, "AI_GRADER_OCR_IDENTITY_MISMATCH");
  assert.equal(verifyCalls, 0);
  assert.equal(providerCalls, 0);

  const crossedProvider = mockResponse();
  await handler(mockRequest("POST", ["ocr-prefill-finalize"], manifest), crossedProvider);
  assert.equal(crossedProvider.statusCodeValue, 409);
  assert.equal((crossedProvider.jsonBody as any).code, "AI_GRADER_OCR_IDENTITY_MISMATCH");
  assert.equal(verifyCalls, 2);
  assert.equal(providerCalls, 1);
});

test("OCR finalize API preserves safe typed provider and catalog diagnostics", async () => {
  const codes: AiGraderOcrFailureCode[] = [
    "AI_GRADER_OCR_GOOGLE_CONFIG_MISSING",
    "AI_GRADER_OCR_GOOGLE_PROVIDER_FAILED",
    "AI_GRADER_OCR_OPENAI_CONFIG_MISSING",
    "AI_GRADER_OCR_OPENAI_TIMEOUT",
    "AI_GRADER_OCR_OPENAI_NETWORK",
    "AI_GRADER_OCR_OPENAI_NON_2XX",
    "AI_GRADER_OCR_OPENAI_REFUSAL",
    "AI_GRADER_OCR_OPENAI_SCHEMA_FAILED",
    "AI_GRADER_OCR_CATALOG_FAILED",
  ];
  let currentCode = codes[0]!;
  const handler = createAiGraderProductionApiHandler({
    env: { [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true" },
    async requireAdminSession() { throw new Error("not used"); },
    async requireProductionActor(_req, action) {
      return {
        type: "service_account",
        role: "ai_grader_service",
        serviceAccountId: "typed-diagnostics-test",
        scopes: ["publish"],
        audit: { actorType: "service_account", action, requestedAt: "2026-07-11T12:00:00.000Z" },
      };
    },
    publicUrlFor(storageKey) { return `https://cdn.tenkings.test/${storageKey}`; },
    async presignUpload({ storageKey, contentType, checksumSha256 }) {
      return {
        storageKey,
        uploadUrl: `https://uploads.tenkings.test/${storageKey}`,
        uploadMethod: "PUT",
        uploadHeaders: {
          "Content-Type": contentType,
          "x-amz-checksum-sha256": sha256HexToBase64(checksumSha256),
        },
        publicUrl: `https://cdn.tenkings.test/${storageKey}`,
      };
    },
    async verifyUploadedArtifact(input) {
      return {
        ok: true,
        byteSize: input.byteSize,
        contentType: input.contentType,
        checksumSha256: input.checksumSha256,
        widthPx: input.sourceImageWidthPx,
        heightPx: input.sourceImageHeightPx,
      };
    },
    async runOcrPrefill() { throw new AiGraderOcrFailure(currentCode); },
    async persist() { throw new Error("must not persist"); },
  });

  for (const [index, code] of codes.entries()) {
    currentCode = code;
    const reportId = `typed-diagnostic-${index}`;
    const initRes = mockResponse();
    await handler(mockRequest("POST", ["ocr-prefill-init"], { reportId, images: normalizedImages() }), initRes);
    assert.equal(initRes.statusCodeValue, 200);
    const finalizeRes = mockResponse();
    await handler(
      mockRequest("POST", ["ocr-prefill-finalize"], (initRes.jsonBody as any).result.requiredFinalizeManifest),
      finalizeRes,
    );
    assert.equal(finalizeRes.statusCodeValue, aiGraderOcrFailurePresentation(code).statusCode);
    assert.equal((finalizeRes.jsonBody as any).code, code);
    assert.equal((finalizeRes.jsonBody as any).message, aiGraderOcrFailurePresentation(code).message);
    assert.doesNotMatch(JSON.stringify(finalizeRes.jsonBody), /typed-diagnostics-test|uploads\.tenkings|storageKey/i);
  }
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
      async runStructuredExtraction() {
        const supported = <T extends string | boolean>(value: T, confidence: number, ref = "google.front.text") => ({
          state: "supported" as const,
          value,
          confidence,
          evidenceRefs: [ref],
        });
        const unknown = { state: "unknown" as const, value: null, confidence: 0, evidenceRefs: [] };
        return {
          requestedModel: "gpt-5.6-sol",
          actualModel: "gpt-5.6-sol-2026-07-01",
          providerElapsedMs: 120,
          evidence: { sides: [], heuristicHints: {} },
          fields: {
            category: supported("sport", 0.9),
            playerName: supported("Michael Jordan", 0.75),
            cardName: unknown,
            year: supported("1990", 0.42),
            manufacturer: supported("SkyBox", 0.42),
            sport: supported("basketball", 0.8),
            game: unknown,
            productSet: supported("1990 SkyBox Basketball", 0.6),
            cardNumber: supported("41", 0.6),
            insert: unknown,
            parallel: unknown,
            numbered: unknown,
            autograph: unknown,
            memorabilia: unknown,
          },
        } as any;
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
  assert.equal(result.fields.cardNumber.value, null);
  assert.equal(result.fields.cardNumber.state, "unknown");
  assert.equal(result.fields.cardNumber.reviewRequired, true);
  assert.ok(result.reviewFieldNames.includes("year"));
  assert.equal(JSON.stringify(networkInputs).includes("base64"), false);
  assert.equal((networkInputs as any[]).every((image) => typeof image.url === "string"), true);
});

test("OCR heuristic hints use true for positive autograph or memorabilia evidence and null for absence", async () => {
  const observed: Array<Record<string, unknown>> = [];
  const unknown = { state: "unknown" as const, value: null, confidence: 0, evidenceRefs: [] };
  const structuredFields = {
    category: unknown,
    playerName: unknown,
    cardName: unknown,
    year: unknown,
    manufacturer: unknown,
    sport: unknown,
    game: unknown,
    productSet: unknown,
    cardNumber: unknown,
    insert: unknown,
    parallel: unknown,
    numbered: unknown,
    autograph: unknown,
    memorabilia: unknown,
  };
  for (const combinedText of ["1990 SKYBOX MICHAEL JORDAN", "AUTOGRAPH PATCH CARD"]) {
    await runAiGraderOcrPrefillRuntime({
      reportId: `heuristic-${observed.length}`,
      images: [
        { side: "front", url: "https://cdn.tenkings.test/front.png" },
        { side: "back", url: "https://cdn.tenkings.test/back.png" },
      ],
    }, {
      async runOcr() {
        return {
          results: [
            { id: "front", text: combinedText, confidence: 0.9, tokens: [] },
            { id: "back", text: "", confidence: 0, tokens: [] },
          ],
          combined_text: combinedText,
        };
      },
      async runStructuredExtraction(input) {
        observed.push(input.heuristicHints ?? {});
        return {
          requestedModel: "gpt-5.6-sol",
          actualModel: "gpt-5.6-sol-2026-07-01",
          providerElapsedMs: 10,
          evidence: { sides: [], heuristicHints: input.heuristicHints ?? {} },
          fields: structuredFields,
        } as any;
      },
    });
  }
  assert.equal(observed[0]?.autograph, null);
  assert.equal(observed[0]?.memorabilia, null);
  assert.equal(observed[1]?.autograph, true);
  assert.equal(observed[1]?.memorabilia, true);
});

test("OCR runtime rejects non-string exact identities before either provider runs", async () => {
  for (const queueItemId of [undefined, null, 123]) {
    let providerCalls = 0;
    await assert.rejects(
      runExactAiGraderOcrPrefillRuntime({
        queueItemId,
        gradingSessionId: "runtime-grading-session",
        reportId: "runtime-report",
        images: [
          { side: "front", url: "https://cdn.tenkings.test/front.png" },
          { side: "back", url: "https://cdn.tenkings.test/back.png" },
        ],
      } as any, {
        async runOcr() {
          providerCalls += 1;
          throw new Error("provider must not run");
        },
      }),
      /exact safe identifier/i,
    );
    assert.equal(providerCalls, 0);
  }
});

test("OCR runtime enforces provider phase limits inside one Vercel-compatible budget", async () => {
  const observedTimeouts: number[] = [];
  const unknown = { state: "unknown" as const, value: null, confidence: 0, evidenceRefs: [] };
  const result = await runAiGraderOcrPrefillRuntime({
    reportId: "provider-budget",
    images: [
      { side: "front", url: "https://cdn.tenkings.test/front.png" },
      { side: "back", url: "https://cdn.tenkings.test/back.png" },
    ],
  }, {
    now: () => 1_000,
    async runOcr(_images, options) {
      observedTimeouts.push(options?.timeoutMs ?? 0);
      return {
        results: [
          { id: "front", text: "", confidence: 0, tokens: [] },
          { id: "back", text: "", confidence: 0, tokens: [] },
        ],
        combined_text: "",
      };
    },
    async runStructuredExtraction(_input, options) {
      observedTimeouts.push(options?.timeoutMs ?? 0);
      return {
        requestedModel: "gpt-5.6-sol",
        actualModel: "gpt-5.6-sol-2026-07-01",
        providerElapsedMs: 0,
        evidence: { sides: [], heuristicHints: {} },
        fields: {
          category: unknown, playerName: unknown, cardName: unknown, year: unknown,
          manufacturer: unknown, sport: unknown, game: unknown, productSet: unknown,
          cardNumber: unknown, insert: unknown, parallel: unknown, numbered: unknown,
          autograph: unknown, memorabilia: unknown,
        },
      } as any;
    },
  });
  assert.equal(AI_GRADER_OCR_PROVIDER_TIME_BUDGET_MS, 45_000);
  assert.deepEqual(observedTimeouts, [12_000, 30_000]);
  assert.equal(result.provenance.structuredExtractionModel, "gpt-5.6-sol-2026-07-01");
  assert.equal(result.internalProviderDiagnostics.actualOpenAiModel, "gpt-5.6-sol-2026-07-01");
  assert.equal("requestedModel" in result.provenance, false);
});

test("OCR runtime maps Google and OpenAI failures to stable production categories", async () => {
  const input = {
    reportId: "typed-provider-failure",
    images: [
      { side: "front" as const, url: "https://cdn.tenkings.test/front.png" },
      { side: "back" as const, url: "https://cdn.tenkings.test/back.png" },
    ],
  };
  const ocr = {
    results: [
      { id: "front", text: "", confidence: 0, tokens: [] },
      { id: "back", text: "", confidence: 0, tokens: [] },
    ],
    combined_text: "",
  };
  const googleCases = [
    { error: new AiGraderGoogleVisionError("missing_config"), code: "AI_GRADER_OCR_GOOGLE_CONFIG_MISSING" },
    { error: new AiGraderGoogleVisionError("provider_error", "front"), code: "AI_GRADER_OCR_GOOGLE_FRONT_FAILED" },
    { error: new AiGraderGoogleVisionError("provider_error", "back"), code: "AI_GRADER_OCR_GOOGLE_BACK_FAILED" },
    { error: new AiGraderGoogleVisionError("response_count_mismatch"), code: "AI_GRADER_OCR_GOOGLE_PROVIDER_FAILED" },
  ] as const;
  for (const entry of googleCases) {
    await assert.rejects(
      runAiGraderOcrPrefillRuntime(input, { async runOcr() { throw entry.error; } }),
      (error) => error instanceof AiGraderOcrFailure && error.code === entry.code,
    );
  }
  const openAiCases = [
    { source: "missing_config", code: "AI_GRADER_OCR_OPENAI_CONFIG_MISSING" },
    { source: "invalid_config", code: "AI_GRADER_OCR_OPENAI_CONFIG_MISSING" },
    { source: "timeout", code: "AI_GRADER_OCR_OPENAI_TIMEOUT" },
    { source: "network", code: "AI_GRADER_OCR_OPENAI_NETWORK" },
    { source: "non_2xx", code: "AI_GRADER_OCR_OPENAI_NON_2XX" },
    { source: "refusal", code: "AI_GRADER_OCR_OPENAI_REFUSAL" },
    { source: "malformed_response", code: "AI_GRADER_OCR_OPENAI_SCHEMA_FAILED" },
  ] as const;
  for (const entry of openAiCases) {
    await assert.rejects(
      runAiGraderOcrPrefillRuntime(input, {
        async runOcr() { return ocr; },
        async runStructuredExtraction() {
          throw new AiGraderOcrStructuredExtractionError(entry.source);
        },
      }),
      (error) => error instanceof AiGraderOcrFailure && error.code === entry.code,
    );
  }
});

test("OCR runtime reports catalog infrastructure failure without exposing its cause", async () => {
  const supported = <T extends string | boolean>(value: T) => ({
    state: "supported" as const,
    value,
    confidence: 0.95,
    evidenceRefs: ["image.front"],
  });
  const unknown = { state: "unknown" as const, value: null, confidence: 0, evidenceRefs: [] };
  await assert.rejects(
    runAiGraderOcrPrefillRuntime({
      reportId: "catalog-failure",
      images: [
        { side: "front", url: "https://cdn.tenkings.test/front.png" },
        { side: "back", url: "https://cdn.tenkings.test/back.png" },
      ],
    }, {
      async runOcr() {
        return {
          results: [
            { id: "front", text: "1996 Fleer Michael Jordan #23", confidence: 0.9, tokens: [] },
            { id: "back", text: "Basketball", confidence: 0.9, tokens: [] },
          ],
          combined_text: "1996 Fleer Michael Jordan #23 Basketball",
        };
      },
      async runStructuredExtraction() {
        return {
          requestedModel: "gpt-5.6-sol",
          actualModel: "gpt-5.6-sol-2026-07-01",
          providerElapsedMs: 10,
          evidence: { sides: [], heuristicHints: {} },
          fields: {
            category: supported("sport"), playerName: supported("Michael Jordan"), cardName: unknown,
            year: supported("1996"), manufacturer: supported("Fleer"), sport: supported("basketball"), game: unknown,
            productSet: supported("1996 Fleer Basketball"), cardNumber: supported("23"), insert: unknown,
            parallel: unknown, numbered: unknown, autograph: unknown, memorabilia: unknown,
          },
        } as any;
      },
      async identifySet() {
        throw new Error("secret database path credential");
      },
    }),
    (error) => error instanceof AiGraderOcrFailure &&
      error.code === "AI_GRADER_OCR_CATALOG_FAILED" && !/secret|database|path|credential/i.test(error.message),
  );
});

test("OCR prefill finalize rejects missing or wrong checksum, byte size, and content type", async () => {
  const failures = [
    { name: "missing-checksum", patch: { checksumSha256: undefined }, message: /verified sha-256 checksum/i },
    { name: "tampered-checksum", patch: { checksumSha256: "0".repeat(64) }, message: /checksum mismatch/i },
    { name: "missing-size", patch: { byteSize: undefined }, message: /byte size mismatch/i },
    { name: "wrong-size", patch: { byteSize: 999 }, message: /byte size mismatch/i },
    { name: "missing-type", patch: { contentType: undefined }, message: /content type mismatch/i },
    { name: "wrong-type", patch: { contentType: "image/jpeg" }, message: /content type mismatch/i },
    { name: "wrong-width", patch: { widthPx: 1199 }, message: /dimensions mismatch/i },
    { name: "wrong-height", patch: { heightPx: 1679 }, message: /dimensions mismatch/i },
  ];
  for (const failure of failures) {
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
          uploadHeaders: {
            "Content-Type": contentType,
            "x-amz-meta-sha256": checksumSha256,
            "x-amz-checksum-sha256": sha256HexToBase64(checksumSha256),
          },
          publicUrl: `https://cdn.tenkings.test/${storageKey}`,
        };
      },
      async verifyUploadedArtifact(input) {
        return {
          ok: true,
          byteSize: input.byteSize,
          contentType: input.contentType,
          checksumSha256: input.checksumSha256,
          widthPx: input.sourceImageWidthPx,
          heightPx: input.sourceImageHeightPx,
          ...failure.patch,
        };
      },
      async runOcrPrefill() {
        ocrCalls += 1;
        throw new Error("OCR must not run for an unverified object");
      },
      async persist() {
        throw new Error("persist must not run for an unverified object");
      },
    });
    const initRes = mockResponse();
    await handler(
      mockRequest("POST", ["ocr-prefill-init"], {
        reportId: "integrity-" + failure.name,
        images: normalizedImages(),
      }),
      initRes
    );
    assert.equal(initRes.statusCodeValue, 200);
    const uploadHeaders = (initRes.jsonBody as any).result.uploadPlan[0].uploadHeaders;
    assert.equal(Object.keys(uploadHeaders).some((name) => name.toLowerCase() === "x-amz-meta-sha256"), false);
    assert.equal(
      uploadHeaders["x-amz-checksum-sha256"],
      sha256HexToBase64(normalizedImages()[0].checksumSha256),
    );
    const finalizeRes = mockResponse();
    await handler(
      mockRequest("POST", ["ocr-prefill-finalize"], (initRes.jsonBody as any).result.requiredFinalizeManifest),
      finalizeRes
    );
    assert.notEqual(finalizeRes.statusCodeValue, 200);
    assert.match(String((finalizeRes.jsonBody as any)?.message ?? ""), failure.message);
    if (failure.name === "missing-checksum") {
      assert.equal((finalizeRes.jsonBody as any)?.code, "AI_GRADER_STORAGE_CHECKSUM_UNAVAILABLE");
    }
    assert.equal(ocrCalls, 0);
  }
});

test("storage checksum verification rejects same-size wrong bytes and streams when the native checksum is absent", async () => {
  const expectedChecksum = sha256("same-size-expected");
  const wrongBytesChecksum = sha256("same-size-tampered");
  const byteSize = Buffer.byteLength("same-size-expected");
  assert.equal(byteSize, Buffer.byteLength("same-size-tampered"));
  const frontStorageKey = "ai-grader/reports/checksum/ocr-prefill/front.png";

  const verified = await verifyStorageObjectIntegrity({
    storageKey: frontStorageKey,
    expectedByteSize: byteSize,
    expectedChecksumSha256: expectedChecksum,
  }, {
    async headObject(storageKey) {
      return {
        storageKey,
        byteSize,
        contentType: "image/png",
        // Object metadata is caller-controlled and deliberately lies. Verification
        // must use only the checksum of the actual stored object bytes.
        metadata: { sha256: expectedChecksum },
        checksumSha256: wrongBytesChecksum,
        nativeChecksumPresent: true,
      };
    },
    async openRead() {
      throw new Error("native checksum verification must not read the object");
    },
  });

  assert.equal(verified.ok, false);
  assert.equal(verified.checksumSha256, wrongBytesChecksum);
  assert.match(String(verified.message), /storage-provided sha-256 checksum mismatch/i);

  const backStorageKey = "ai-grader/reports/checksum/ocr-prefill/back.png";
  const streamed = await verifyStorageObjectIntegrity({
    storageKey: backStorageKey,
    expectedByteSize: byteSize,
    expectedChecksumSha256: expectedChecksum,
  }, {
    async headObject(storageKey) {
      return {
        storageKey,
        byteSize,
        contentType: "image/png",
        metadata: { sha256: wrongBytesChecksum },
        checksumSha256: null,
        nativeChecksumPresent: false,
      };
    },
    async openRead(storageKey) {
      return {
        storageKey,
        byteSize,
        body: Readable.from([Buffer.from("same-size-expected")]),
      };
    },
  });
  assert.equal(streamed.ok, true);
  assert.equal(streamed.checksumSha256, expectedChecksum);
  assert.equal(streamed.checksumSource, "server_stream");
});

test("OCR provider remains gated until both missing-native-checksum objects pass streamed integrity", async () => {
  const frontBytes = Buffer.alloc(2048, 0x11);
  const backBytes = Buffer.alloc(3072, 0x22);
  const images = normalizedImages().map((image) => {
    const bytes = image.side === "front" ? frontBytes : backBytes;
    return {
      ...image,
      byteSize: bytes.byteLength,
      checksumSha256: createHash("sha256").update(bytes).digest("hex"),
    };
  });

  let tamperBack = true;
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
        serviceAccountId: "ocr-stream-integrity-test",
        scopes: ["publish"],
        audit: { actorType: "service_account", action, requestedAt: "2026-07-17T12:00:00.000Z" },
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
        uploadHeaders: {
          "Content-Type": contentType,
          "x-amz-checksum-sha256": sha256HexToBase64(checksumSha256),
        },
        publicUrl: `https://cdn.tenkings.test/${storageKey}`,
      };
    },
    async verifyUploadedArtifact(input) {
      const isBack = input.artifactId.endsWith(":back");
      const expectedBytes = isBack ? backBytes : frontBytes;
      const storedBytes = isBack && tamperBack ? Buffer.alloc(expectedBytes.byteLength, 0x33) : expectedBytes;
      const integrity = await verifyStorageObjectIntegrity({
        storageKey: input.storageKey,
        expectedByteSize: input.byteSize,
        expectedChecksumSha256: input.checksumSha256,
      }, {
        async headObject(storageKey) {
          return {
            storageKey,
            byteSize: storedBytes.byteLength,
            contentType: input.contentType,
            metadata: { sha256: input.checksumSha256 },
            checksumSha256: null,
            nativeChecksumPresent: false,
          };
        },
        async openRead(storageKey) {
          return {
            storageKey,
            byteSize: storedBytes.byteLength,
            body: Readable.from([storedBytes]),
          };
        },
      });
      return {
        ...integrity,
        widthPx: input.sourceImageWidthPx,
        heightPx: input.sourceImageHeightPx,
      };
    },
    async runOcrPrefill(input) {
      ocrCalls += 1;
      return {
        queueItemId: input.queueItemId,
        gradingSessionId: input.gradingSessionId,
        reportId: input.reportId,
        status: "prefill_ready",
        humanConfirmationRequired: true,
        inventoryMutationPerformed: false,
        publishMutationPerformed: false,
        sourceSides: ["front", "back"],
        fields: prefillFields(),
        reviewFieldNames: ["cardName"],
        provenance: {
          ocrEngine: "google_vision_document_text_detection_url_only",
          attributeExtractor: "@tenkings/shared/extractCardAttributes",
          structuredExtractor: "openai_responses_strict_json_schema",
          structuredExtractionModel: "gpt-5.6-sol",
          setLookupUsed: true,
          setIdentificationUsed: true,
        },
        warnings: ["Human review is required."],
      } as any;
    },
    async persist() {
      throw new Error("OCR integrity test must not publish");
    },
  });

  async function initAndFinalize(reportId: string) {
    const initRes = mockResponse();
    await handler(mockRequest("POST", ["ocr-prefill-init"], { reportId, images }), initRes);
    assert.equal(initRes.statusCodeValue, 200);
    const finalizeRes = mockResponse();
    await handler(
      mockRequest("POST", ["ocr-prefill-finalize"], (initRes.jsonBody as any).result.requiredFinalizeManifest),
      finalizeRes,
    );
    return finalizeRes;
  }

  const rejected = await initAndFinalize("ocr-streamed-integrity-rejected");
  assert.notEqual(rejected.statusCodeValue, 200);
  assert.match(String((rejected.jsonBody as any)?.message ?? ""), /sha-256 checksum mismatch/i);
  assert.equal(ocrCalls, 0);

  tamperBack = false;
  const accepted = await initAndFinalize("ocr-streamed-integrity-accepted");
  assert.equal(accepted.statusCodeValue, 200);
  assert.equal((accepted.jsonBody as any)?.operation, "aiGraderOcrPrefillFinalize");
  assert.equal(ocrCalls, 1);
});

test("slabbed-photo finalize verifies streamed storage integrity before persistence", async () => {
  const expectedBytes = Buffer.from("slabbed-photo-exact-stored-bytes");
  const expectedChecksum = createHash("sha256").update(expectedBytes).digest("hex");
  let tamperStoredBytes = true;
  let integrityCalls = 0;
  let finalizeCalls = 0;
  const handler = createAiGraderProductionApiHandler({
    env: { [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true" },
    async requireAdminSession() {
      throw new Error("not used");
    },
    async requireProductionActor(_req, action) {
      return {
        type: "service_account",
        role: "ai_grader_service",
        serviceAccountId: "slab-integrity-test",
        scopes: ["upload-slab-photo"],
        audit: { actorType: "service_account", action, requestedAt: "2026-07-17T12:00:00.000Z" },
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
        uploadHeaders: {
          "Content-Type": contentType,
          "x-amz-checksum-sha256": sha256HexToBase64(checksumSha256),
        },
        publicUrl: `https://cdn.tenkings.test/${storageKey}`,
      };
    },
    async verifyUploadedArtifact(input) {
      integrityCalls += 1;
      const storedBytes = tamperStoredBytes
        ? Buffer.alloc(expectedBytes.byteLength, 0x7f)
        : expectedBytes;
      const integrity = await verifyStorageObjectIntegrity({
        storageKey: input.storageKey,
        expectedByteSize: input.byteSize,
        expectedChecksumSha256: input.checksumSha256,
      }, {
        async headObject(storageKey) {
          return {
            storageKey,
            byteSize: storedBytes.byteLength,
            contentType: input.contentType,
            metadata: {},
            checksumSha256: null,
            nativeChecksumPresent: false,
          };
        },
        async openRead(storageKey) {
          return {
            storageKey,
            byteSize: storedBytes.byteLength,
            body: Readable.from([storedBytes]),
          };
        },
      });
      return {
        ...integrity,
        widthPx: input.sourceImageWidthPx,
        heightPx: input.sourceImageHeightPx,
      };
    },
    async finalizeSlabbedPhotoUpload(input) {
      finalizeCalls += 1;
      assert.equal(integrityCalls, 2);
      return {
        reportId: input.reportId,
        side: input.side,
        storageKey: input.storageKey,
        publicUrl: input.publicUrl,
        byteSize: input.byteSize,
        checksumSha256: input.checksumSha256,
        widthPx: input.widthPx,
        heightPx: input.heightPx,
        persisted: true,
      };
    },
    async persist() {
      throw new Error("slab integrity test must not publish");
    },
  });

  async function initAndFinalize(reportId: string) {
    const initRes = mockResponse();
    await handler(mockRequest("POST", ["slabbed-photo-init"], {
      reportId,
      side: "front",
      fileName: "front.png",
      mimeType: "image/png",
      checksumSha256: expectedChecksum,
      byteSize: expectedBytes.byteLength,
      widthPx: 100,
      heightPx: 140,
    }), initRes);
    assert.equal(initRes.statusCodeValue, 200);
    const finalizeRes = mockResponse();
    await handler(
      mockRequest("POST", ["slabbed-photo-finalize"], (initRes.jsonBody as any).result.requiredFinalizeManifest),
      finalizeRes,
    );
    return finalizeRes;
  }

  const rejected = await initAndFinalize("slab-integrity-rejected");
  assert.notEqual(rejected.statusCodeValue, 200);
  assert.equal(integrityCalls, 1);
  assert.equal(finalizeCalls, 0);

  tamperStoredBytes = false;
  const accepted = await initAndFinalize("slab-integrity-accepted");
  assert.equal(accepted.statusCodeValue, 200);
  assert.equal(integrityCalls, 2);
  assert.equal(finalizeCalls, 1);
  assert.equal((accepted.jsonBody as any)?.result?.persisted, true);
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

test("AWS presigning requires SHA-256 as an unhoistable signed browser header", async () => {
  const checksumHex = sha256("normalized-card-query-contract");
  const client = new S3Client({
    region: "us-east-1",
    endpoint: "https://storage.example.invalid",
    credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" },
  });
  try {
    const signed = await getSignedUrl(client as any, new PutObjectCommand({
      Bucket: "test-bucket",
      Key: "test-object",
      ContentType: "image/png",
      ChecksumSHA256: sha256HexToBase64(checksumHex),
    }) as any, {
      expiresIn: 600,
      unhoistableHeaders: new Set(["x-amz-checksum-sha256"]),
    });
    const url = new URL(signed);
    assert.equal(url.searchParams.get("x-amz-checksum-sha256"), null);
    assert.equal(url.searchParams.get("X-Amz-SignedHeaders"), "host;x-amz-checksum-sha256");
    assert.equal(url.searchParams.get("X-Amz-SignedHeaders")?.includes("x-amz-checksum-sha256"), true);
  } finally {
    client.destroy();
  }
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
    async presignUpload({ storageKey, contentType, checksumSha256 }) {
      return {
        storageKey,
        uploadUrl: `https://uploads.tenkings.test/${storageKey}`,
        uploadMethod: "PUT",
        uploadHeaders: {
          "Content-Type": contentType,
          "x-amz-checksum-sha256": sha256HexToBase64(checksumSha256),
        },
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
  const staleProducerRes = mockResponse();
  await handler(mockRequest("POST", ["ocr-prefill-init"], {
    reportId: "unsafe-report",
    reportProducerContractVersion: "ai-grader-report-producer-v0.1",
    images: normalizedImages(),
  }), staleProducerRes);
  assert.equal(staleProducerRes.statusCodeValue, 400);
  assert.match((staleProducerRes.jsonBody as any).message, /current report-producer v0\.2/);

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
  assert.equal(authCalls, 2);
});
