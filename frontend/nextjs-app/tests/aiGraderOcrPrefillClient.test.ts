import assert from "node:assert/strict";
import test from "node:test";
import {
  SAMPLE_AI_GRADER_REPORT_BUNDLE,
  type AiGraderReportBundle,
  type AiGraderReportPublicAsset,
} from "../lib/aiGraderReportBundle";
import {
  aiGraderOcrPrefillReportMetadata,
  AiGraderOcrPrefillStageError,
  findAiGraderNormalizedOcrAssets,
  mergeAiGraderOcrPrefillIntoIdentityDraft,
  runAiGraderOcrPrefillFromLocalReport,
  type AiGraderOcrPrefillResult,
  type AiGraderOcrPrefillStage,
} from "../lib/aiGraderOcrPrefillClient";
import {
  aiGraderOcrFailurePresentation,
  type AiGraderOcrFailureCode,
} from "../lib/aiGraderOcrFailure";

const FRONT_HASH = "1".repeat(64);
const BACK_HASH = "2".repeat(64);

function checksumBase64(value: string) {
  return Buffer.from(value, "hex").toString("base64");
}

function normalizedBundle(): AiGraderReportBundle & { assets: AiGraderReportPublicAsset[] } {
  return {
    ...SAMPLE_AI_GRADER_REPORT_BUNDLE,
    reportId: "ocr-client-report",
    reportProducer: {
      contractVersion: "ai-grader-report-producer-v0.2",
      capabilities: ["finding-validation-v1", "capture-profile-provenance-v1", "raster-dimensions-v1"],
    },
    assets: [
      {
        id: "front/normalized/front-normalized-card.png",
        kind: "image",
        fileName: "front-normalized-card.png",
        contentType: "image/png",
        checksumSha256: FRONT_HASH,
        byteSize: 5,
        widthPx: 1200,
        heightPx: 1680,
        side: "front",
        evidenceRole: "normalized_card",
      },
      {
        id: "back/normalized/back-normalized-card.png",
        kind: "image",
        fileName: "back-normalized-card.png",
        contentType: "image/png",
        checksumSha256: BACK_HASH,
        byteSize: 4,
        widthPx: 1200,
        heightPx: 1680,
        side: "back",
        evidenceRole: "normalized_card",
      },
      {
        id: "front/channel-1.png",
        kind: "image",
        fileName: "channel-1.png",
        contentType: "image/png",
      },
    ],
  };
}

function resultFixture(): AiGraderOcrPrefillResult {
  const known = <T extends string | boolean>(value: T, confidence = 0.9) => ({
    state: "supported" as const,
    value,
    confidence,
    reviewRequired: confidence < 0.8,
    evidenceRefs: ["google.front.text"],
  });
  const missing = { state: "unknown" as const, value: null, confidence: 0, reviewRequired: true, evidenceRefs: [] };
  return {
    reportId: "ocr-client-report",
    status: "prefill_ready",
    humanConfirmationRequired: true,
    inventoryMutationPerformed: false,
    publishMutationPerformed: false,
    sourceSides: ["front", "back"],
    fields: {
      category: known("sport"),
      playerName: known("Michael Jordan"),
      cardName: missing,
      year: known("1990"),
      manufacturer: known("SkyBox"),
      sport: known("basketball"),
      game: missing,
      productSet: known("1990 SkyBox Basketball"),
      cardNumber: known("41"),
      parallel: known("Base", 0.74),
      insert: missing,
      numbered: missing,
      autograph: known(true, 0.84),
      memorabilia: missing,
    },
    reviewFieldNames: ["cardName", "game", "parallel", "insert", "numbered", "memorabilia"],
    provenance: {
      ocrEngine: "google_vision_document_text_detection",
      attributeExtractor: "@tenkings/shared/extractCardAttributes",
      structuredExtractor: "openai_responses_strict_json_schema",
      structuredExtractionModel: "gpt-5.6-sol",
      setLookupUsed: true,
      setIdentificationUsed: true,
    },
    warnings: ["Human review required."],
  };
}

test("OCR prefill client selects only normalized front/back report assets", () => {
  const assets = findAiGraderNormalizedOcrAssets(normalizedBundle());
  assert.deepEqual(assets.map((entry) => entry.side), ["front", "back"]);
  assert.equal(assets[0]?.asset.id, "front/normalized/front-normalized-card.png");
  assert.equal(assets[1]?.asset.id, "back/normalized/back-normalized-card.png");
  assert.throws(
    () => findAiGraderNormalizedOcrAssets({ ...normalizedBundle(), assets: [] }),
    /exactly one verified normalized front asset/
  );
});

test("OCR input selection rejects stale producers and every normalized asset identity violation", () => {
  const base = normalizedBundle();
  const cases: Array<{ bundle: any; message: RegExp }> = [
    {
      bundle: { ...base, reportProducer: { contractVersion: "ai-grader-report-producer-v0.1", capabilities: [] } },
      message: /current report-producer v0\.2/,
    },
    {
      bundle: { ...base, assets: base.assets.map((asset: any, index: number) =>
        index === 0 ? { ...asset, evidenceRole: "directional_channel" } : asset) },
      message: /exactly one verified normalized front asset/,
    },
    {
      bundle: { ...base, assets: base.assets.map((asset: any, index: number) =>
        index === 0 ? { ...asset, contentType: "image\/tiff", fileName: "front-raw.tiff" } : asset) },
      message: /image\/png at exactly 1200x1680/,
    },
    {
      bundle: { ...base, assets: base.assets.map((asset: any, index: number) =>
        index === 0 ? { ...asset, widthPx: 1199 } : asset) },
      message: /1200x1680/,
    },
    {
      bundle: { ...base, assets: base.assets.map((asset: any, index: number) =>
        index === 0 ? { ...asset, checksumSha256: "bad" } : asset) },
      message: /valid, consistent SHA-256/,
    },
    {
      bundle: { ...base, assets: base.assets.map((asset: any, index: number) =>
        index === 0 ? { ...asset, byteSize: 0 } : asset) },
      message: /positive byte size/,
    },
    {
      bundle: { ...base, assets: base.assets.map((asset: any, index: number) =>
        index === 1 ? { ...asset, id: base.assets[0].id } : asset) },
      message: /unique asset identities/,
    },
    {
      bundle: { ...base, assets: [...base.assets, { ...base.assets[0], id: "another-front" }] },
      message: /exactly one verified normalized front asset/,
    },
  ];
  for (const entry of cases) {
    assert.throws(() => findAiGraderNormalizedOcrAssets(entry.bundle), entry.message);
  }
});

test("OCR prefill browser flow fetches local normalized bytes and uploads them directly to storage", async () => {
  const bundle = normalizedBundle();
  bundle.assets[0]!.fileName = "C:\\private\\front-normalized-card.png";
  const productionBodies: unknown[] = [];
  const directUploads: Array<{ url: string; byteSize: number }> = [];
  const result = resultFixture();
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/ocr-prefill-init")) {
      const body = JSON.parse(String(init?.body));
      productionBodies.push(body);
      assert.equal(JSON.stringify(body).includes("bodyBase64"), false);
      assert.equal(JSON.stringify(body).includes("data:image"), false);
      assert.deepEqual(body.images.map((image: any) => image.side), ["front", "back"]);
      const images = body.images.map((image: any) => ({
        ...image,
        storageKey: `ai-grader/reports/ocr-client-report/ocr-prefill/${image.side}.png`,
      }));
      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            reportId: body.reportId,
            reportProducerContractVersion: "ai-grader-report-producer-v0.2",
            uploadSessionId: "aigocr_test",
            humanConfirmationRequired: true,
            uploadPlan: images.map((image: any) => ({
              ...image,
              publicUrl: `https://cdn.tenkings.test/${image.storageKey}`,
              uploadUrl: `https://uploads.tenkings.test/${image.side}`,
              uploadMethod: "PUT",
              uploadHeaders: {
                "Content-Type": image.mimeType,
                "x-amz-meta-sha256": "must-be-stripped",
                "X-Amz-Checksum-Sha256": checksumBase64(image.checksumSha256),
              },
            })),
            requiredFinalizeManifest: {
              reportId: body.reportId,
              reportProducerContractVersion: "ai-grader-report-producer-v0.2",
              uploadSessionId: "aigocr_test",
              images,
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (url.startsWith("https://uploads.tenkings.test/")) {
      assert.equal(init?.method, "PUT");
      assert.equal(init?.mode, "cors");
      assert.equal(init?.credentials, "omit");
      const headers = init?.headers as Record<string, string>;
      assert.equal(Object.keys(headers).some((name) => name.toLowerCase() === "x-amz-meta-sha256"), false);
      assert.equal(
        headers["x-amz-checksum-sha256"],
        checksumBase64(url.endsWith("/front") ? FRONT_HASH : BACK_HASH),
      );
      assert.ok(init?.body instanceof Blob);
      directUploads.push({ url, byteSize: (init.body as Blob).size });
      return new Response(null, { status: 200 });
    }
    if (url.endsWith("/ocr-prefill-finalize")) {
      const body = JSON.parse(String(init?.body));
      productionBodies.push(body);
      assert.equal(JSON.stringify(body).includes("uploadUrl"), false);
      assert.equal(JSON.stringify(body).includes("publicUrl"), false);
      return new Response(JSON.stringify({ ok: true, result }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };

  const response = await runAiGraderOcrPrefillFromLocalReport(
    {
      baseUrl: "http://127.0.0.1:47652",
      stationToken: "browser-local-token",
      reportId: bundle.reportId,
      authHeaders: { Authorization: "Bearer operator-session" },
      bundle,
    },
    {
      fetchImpl,
      async fetchAsset({ assetId }) {
        const front = assetId.startsWith("front/");
        const bytes = new Uint8Array(front ? [1, 2, 3, 4, 5] : [6, 7, 8, 9]).buffer;
        return {
          bytes,
          contentType: "image/png",
          byteSize: bytes.byteLength,
          checksumSha256: front ? FRONT_HASH : BACK_HASH,
        };
      },
      async digestSha256(bytes) {
        return bytes.byteLength === 5 ? FRONT_HASH : BACK_HASH;
      },
    }
  );

  assert.equal(response.humanConfirmationRequired, true);
  assert.equal(response.inventoryMutationPerformed, false);
  assert.equal(response.publishMutationPerformed, false);
  assert.deepEqual(directUploads, [
    { url: "https://uploads.tenkings.test/front", byteSize: 5 },
    { url: "https://uploads.tenkings.test/back", byteSize: 4 },
  ]);
  assert.equal(productionBodies.length, 2);
  assert.equal(JSON.stringify(productionBodies).includes("browser-local-token"), false);
  assert.equal(JSON.stringify(productionBodies).includes("operator-session"), false);
  assert.equal(JSON.stringify(productionBodies).includes("C:\\private"), false);
});

test("OCR prefill reports eight distinct redacted failure stages", async () => {
  const stages: AiGraderOcrPrefillStage[] = [
    "bundle_fetch", "front_asset_fetch", "back_asset_fetch", "init",
    "front_put", "back_put", "finalize", "ocr_response",
  ];
  const messages = new Set<string>();
  for (const injectedStage of stages) {
    let directUploadCount = 0;
    const fetchImpl: typeof fetch = async (request) => {
      const url = String(request);
      if (url.endsWith("/ocr-prefill-init")) {
        if (injectedStage === "init") throw new Error("secret-sentinel init token URL key");
        const images = [
          { side: "front", artifactRole: "normalized_card", fileName: "front.png", mimeType: "image/png", checksumSha256: FRONT_HASH, byteSize: 5, widthPx: 1200, heightPx: 1680, storageKey: "private/front" },
          { side: "back", artifactRole: "normalized_card", fileName: "back.png", mimeType: "image/png", checksumSha256: BACK_HASH, byteSize: 4, widthPx: 1200, heightPx: 1680, storageKey: "private/back" },
        ];
        return new Response(JSON.stringify({ ok: true, result: {
          reportId: "ocr-client-report",
          reportProducerContractVersion: "ai-grader-report-producer-v0.2",
          uploadSessionId: "aigocr_test",
          humanConfirmationRequired: true,
          uploadPlan: images.map((image) => ({
            ...image,
            publicUrl: "https://cdn.example.invalid/redacted",
            uploadUrl: "https://upload.example.invalid/" + image.side + "?secret-sentinel",
            uploadMethod: "PUT",
            uploadHeaders: { "Content-Type": "image/png" },
          })),
          requiredFinalizeManifest: { reportId: "ocr-client-report", reportProducerContractVersion: "ai-grader-report-producer-v0.2", uploadSessionId: "aigocr_test", images },
        } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/ocr-prefill-finalize")) {
        if (injectedStage === "finalize") throw new Error("secret-sentinel finalize credential");
        return new Response(JSON.stringify({ ok: true, result: injectedStage === "ocr_response" ? {} : resultFixture() }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error("secret-sentinel unexpected URL");
    };
    await assert.rejects(
      runAiGraderOcrPrefillFromLocalReport({
        baseUrl: "http://127.0.0.1:47652/private",
        stationToken: "secret-sentinel-station-token",
        reportId: "ocr-client-report",
        authHeaders: { Authorization: "Bearer secret-sentinel-credential" },
        ...(injectedStage === "bundle_fetch" ? {} : { bundle: normalizedBundle() }),
      }, {
        fetchImpl,
        async fetchBundle() {
          throw new Error("secret-sentinel bundle path token");
        },
        async fetchAsset({ assetId }) {
          const side = assetId.startsWith("front/") ? "front" : "back";
          if (injectedStage === side + "_asset_fetch") throw new Error("secret-sentinel local path URL");
          const bytes = new Uint8Array(side === "front" ? [1, 2, 3, 4, 5] : [6, 7, 8, 9]).buffer;
          return { bytes, contentType: "image/png", byteSize: bytes.byteLength, checksumSha256: side === "front" ? FRONT_HASH : BACK_HASH };
        },
        async digestSha256(bytes) {
          return bytes.byteLength === 5 ? FRONT_HASH : BACK_HASH;
        },
        async uploadDirect(input) {
          directUploadCount += 1;
          if ((injectedStage === "front_put" && input.uploadUrl.includes("/front")) ||
              (injectedStage === "back_put" && input.uploadUrl.includes("/back"))) {
            throw new Error("secret-sentinel signed URL header key");
          }
        },
      }),
      (error) => {
        assert.ok(error instanceof AiGraderOcrPrefillStageError);
        assert.equal(error.stage, injectedStage);
        assert.doesNotMatch(error.message, /secret-sentinel|token|credential|private\/|upload\.example|storageKey/i);
        messages.add(error.message);
        return true;
      },
    );
    if (injectedStage === "front_put") assert.equal(directUploadCount, 1);
    if (injectedStage === "back_put") assert.equal(directUploadCount, 2);
  }
  assert.equal(messages.size, stages.length);
});

test("OCR prefill exposes only the safe native-checksum provider blocker", async () => {
  let requestCount = 0;
  await assert.rejects(
    runAiGraderOcrPrefillFromLocalReport({
      baseUrl: "http://127.0.0.1:47652",
      stationToken: "secret-sentinel-token",
      reportId: "ocr-client-report",
      authHeaders: { Authorization: "Bearer secret-sentinel-credential" },
      bundle: normalizedBundle(),
    }, {
      async fetchAsset({ assetId }) {
        const front = assetId.startsWith("front/");
        const bytes = new Uint8Array(front ? [1, 2, 3, 4, 5] : [6, 7, 8, 9]).buffer;
        return { bytes, contentType: "image/png", byteSize: bytes.byteLength, checksumSha256: front ? FRONT_HASH : BACK_HASH };
      },
      async digestSha256(bytes) { return bytes.byteLength === 5 ? FRONT_HASH : BACK_HASH; },
      async uploadDirect() {},
      async fetchImpl() {
        requestCount += 1;
        if (requestCount === 1) {
          const images = [
            { side: "front", artifactRole: "normalized_card", fileName: "front.png", mimeType: "image/png", checksumSha256: FRONT_HASH, byteSize: 5, widthPx: 1200, heightPx: 1680, storageKey: "private/front" },
            { side: "back", artifactRole: "normalized_card", fileName: "back.png", mimeType: "image/png", checksumSha256: BACK_HASH, byteSize: 4, widthPx: 1200, heightPx: 1680, storageKey: "private/back" },
          ];
          return new Response(JSON.stringify({ ok: true, result: {
            reportId: "ocr-client-report", reportProducerContractVersion: "ai-grader-report-producer-v0.2", uploadSessionId: "aigocr_test", humanConfirmationRequired: true,
            uploadPlan: images.map((image) => ({ ...image, publicUrl: "https://cdn.example.invalid/x", uploadUrl: "https://upload.example.invalid/x", uploadMethod: "PUT", uploadHeaders: {} })),
            requiredFinalizeManifest: { reportId: "ocr-client-report", reportProducerContractVersion: "ai-grader-report-producer-v0.2", uploadSessionId: "aigocr_test", images },
          } }), { status: 200 });
        }
        return new Response(JSON.stringify({
          ok: false,
          code: "AI_GRADER_STORAGE_CHECKSUM_UNAVAILABLE",
          message: "secret-sentinel provider URL key path",
        }), { status: 502 });
      },
    }),
    (error) => error instanceof AiGraderOcrPrefillStageError && error.stage === "finalize" &&
      /storage did not return a native SHA-256 checksum/i.test(error.message) &&
      !/secret-sentinel|URL|key|path/.test(error.message),
  );
});

test("OCR prefill browser client preserves every safe provider and catalog failure category", async () => {
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
  for (const code of codes) {
    let requestCount = 0;
    await assert.rejects(
      runAiGraderOcrPrefillFromLocalReport({
        baseUrl: "http://127.0.0.1:47652",
        stationToken: "secret-sentinel-token",
        reportId: "ocr-client-report",
        authHeaders: { Authorization: "Bearer secret-sentinel-credential" },
        bundle: normalizedBundle(),
      }, {
        async fetchAsset({ assetId }) {
          const front = assetId.startsWith("front/");
          const bytes = new Uint8Array(front ? [1, 2, 3, 4, 5] : [6, 7, 8, 9]).buffer;
          return { bytes, contentType: "image/png", byteSize: bytes.byteLength, checksumSha256: front ? FRONT_HASH : BACK_HASH };
        },
        async digestSha256(bytes) { return bytes.byteLength === 5 ? FRONT_HASH : BACK_HASH; },
        async uploadDirect() {},
        async fetchImpl(_request, init) {
          requestCount += 1;
          if (requestCount === 1) {
            const requestBody = JSON.parse(String(init?.body));
            const images = requestBody.images.map((image: any) => ({
              ...image,
              storageKey: `private/${image.side}`,
            }));
            return new Response(JSON.stringify({ ok: true, result: {
              reportId: "ocr-client-report",
              reportProducerContractVersion: "ai-grader-report-producer-v0.2",
              uploadSessionId: "aigocr_test",
              humanConfirmationRequired: true,
              uploadPlan: images.map((image: any) => ({
                ...image,
                publicUrl: "https://cdn.example.invalid/redacted",
                uploadUrl: `https://upload.example.invalid/${image.side}`,
                uploadMethod: "PUT",
                uploadHeaders: {},
              })),
              requiredFinalizeManifest: {
                reportId: "ocr-client-report",
                reportProducerContractVersion: "ai-grader-report-producer-v0.2",
                uploadSessionId: "aigocr_test",
                images,
              },
            } }), { status: 200 });
          }
          return new Response(JSON.stringify({
            ok: false,
            code,
            message: "secret-sentinel provider URL token path",
          }), { status: aiGraderOcrFailurePresentation(code).statusCode });
        },
      }),
      (error) => error instanceof AiGraderOcrPrefillStageError &&
        error.stage === "provider" &&
        error.failureCode === code &&
        error.failureCategory === aiGraderOcrFailurePresentation(code).category &&
        error.failureLabel === aiGraderOcrFailurePresentation(code).label &&
        error.message === aiGraderOcrFailurePresentation(code).message &&
        !/secret-sentinel|URL|token|path/.test(error.message),
    );
  }
});

test("OCR prefill merge fills empty fields but preserves operator-edited identity", () => {
  const current = {
    category: "tcg" as const,
    playerName: "",
    cardName: "Operator Chosen Name",
    year: "",
    manufacturer: "Operator Brand",
    sport: "",
    game: "",
    productSet: "",
    cardNumber: "",
    insert: "",
    parallel: "",
    numbered: "",
    autograph: false,
    memorabilia: false,
  };
  const merged = mergeAiGraderOcrPrefillIntoIdentityDraft({
    current,
    result: resultFixture(),
    operatorEditedFields: new Set<keyof typeof current>(["category", "cardName", "manufacturer"]),
  });

  assert.equal(merged.draft.category, "tcg");
  assert.equal(merged.draft.cardName, "Operator Chosen Name");
  assert.equal(merged.draft.manufacturer, "Operator Brand");
  assert.equal(merged.draft.playerName, "");
  assert.equal(merged.draft.year, "1990");
  assert.equal(merged.draft.productSet, "1990 SkyBox Basketball");
  assert.equal(merged.draft.cardNumber, "41");
  assert.equal(merged.draft.autograph, true);
  assert.equal(merged.draft.memorabilia, false);
  assert.equal(merged.appliedFields.includes("manufacturer"), false);
});

test("unknown and disagreement fields remain empty while explicit boolean negatives stay operator-controlled", () => {
  const result = resultFixture();
  result.fields.playerName = {
    state: "disagreement",
    value: null,
    confidence: 0.9,
    reviewRequired: true,
    evidenceRefs: ["image.front", "google.front.text"],
  };
  result.fields.year = {
    state: "unknown",
    value: null,
    confidence: 0.4,
    reviewRequired: true,
    evidenceRefs: [],
  };
  result.fields.autograph = {
    state: "supported",
    value: false,
    confidence: 0.95,
    reviewRequired: false,
    evidenceRefs: ["image.front"],
  };
  const current = {
    category: "sport" as const,
    playerName: "",
    cardName: "",
    year: "",
    manufacturer: "",
    sport: "",
    game: "",
    productSet: "",
    cardNumber: "",
    insert: "",
    parallel: "",
    numbered: "",
    autograph: true,
    memorabilia: false,
  };
  const merged = mergeAiGraderOcrPrefillIntoIdentityDraft({
    current,
    result,
    operatorEditedFields: new Set<keyof typeof current>(["autograph"]),
  });
  assert.equal(merged.draft.playerName, "");
  assert.equal(merged.draft.year, "");
  assert.equal(merged.draft.autograph, true);
  assert.equal(merged.appliedFields.includes("playerName"), false);
  assert.equal(merged.appliedFields.includes("year"), false);
});

test("OCR report metadata keeps only the safe finalize contract", () => {
  const unsafeFixture = Object.assign(resultFixture(), {
    uploadUrl: "https://uploads.tenkings.test/private",
    storageKey: "private/normalized-front.png",
    localPath: "C:\\TenKings\\private.png",
  });
  const metadata = aiGraderOcrPrefillReportMetadata(unsafeFixture);
  const serialized = JSON.stringify(metadata);
  assert.equal(serialized.includes("uploadUrl"), false);
  assert.equal(serialized.includes("storageKey"), false);
  assert.equal(serialized.includes("localPath"), false);
  assert.equal(serialized.includes("uploads.tenkings.test"), false);
  assert.equal(metadata.humanConfirmationRequired, true);
  assert.equal(metadata.publishMutationPerformed, false);
});
