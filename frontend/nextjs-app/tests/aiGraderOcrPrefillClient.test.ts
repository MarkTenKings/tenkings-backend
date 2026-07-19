import assert from "node:assert/strict";
import test from "node:test";
import {
  aiGraderOcrPrefillReportMetadata,
  AiGraderOcrPrefillStageError,
  fetchAiGraderQueuedOcrAsset,
  fetchAiGraderQueuedOcrDescriptor,
  mergeAiGraderOcrPrefillIntoIdentityDraft,
  runAiGraderOcrPrefillFromLocalReport,
  type AiGraderOcrPrefillResult,
  type AiGraderOcrPrefillStage,
  type AiGraderQueuedOcrDescriptor,
} from "../lib/aiGraderOcrPrefillClient";
import {
  AI_GRADER_OCR_FAILURE_CODES,
  aiGraderOcrFailurePresentation,
  type AiGraderOcrFailureCode,
} from "../lib/aiGraderOcrFailure";

const IDENTITY = {
  queueItemId: "queue-card-1",
  gradingSessionId: "grading-session-1",
  reportId: "ocr-client-report",
} as const;
const FRONT_HASH = "1".repeat(64);
const BACK_HASH = "2".repeat(64);

test("every queued OCR provider failure is terminal exact-item guidance with no retry or removed Confirm path", () => {
  for (const code of AI_GRADER_OCR_FAILURE_CODES) {
    const presentation = aiGraderOcrFailurePresentation(code);
    assert.match(presentation.message, /terminal failure/i);
    assert.match(presentation.message, /exact (?:item|normalized)/i);
    assert.match(presentation.message, /cannot be reviewed or published in the station/i);
    assert.match(presentation.message, /will not rerun/i);
    assert.doesNotMatch(presentation.message, /retry|confirm card|manual|Finish\/Review form/i);
  }
});

function descriptor(overrides: Partial<AiGraderQueuedOcrDescriptor> = {}): AiGraderQueuedOcrDescriptor {
  return {
    ...IDENTITY,
    status: "in_flight",
    images: [
      {
        side: "front",
        artifactRole: "normalized_card",
        fileName: "front-normalized-card.png",
        mimeType: "image/png",
        checksumSha256: FRONT_HASH,
        byteSize: 5,
        widthPx: 1200,
        heightPx: 1680,
      },
      {
        side: "back",
        artifactRole: "normalized_card",
        fileName: "back-normalized-card.png",
        mimeType: "image/png",
        checksumSha256: BACK_HASH,
        byteSize: 4,
        widthPx: 1200,
        heightPx: 1680,
      },
    ],
    ...overrides,
  };
}

function resultFixture(overrides: Partial<AiGraderOcrPrefillResult> = {}): AiGraderOcrPrefillResult {
  const known = <T extends string | boolean>(value: T, confidence = 0.9) => ({
    state: "supported" as const,
    value,
    confidence,
    reviewRequired: confidence < 0.8,
    evidenceRefs: ["google.front.text"],
  });
  const missing = { state: "unknown" as const, value: null, confidence: 0, reviewRequired: true, evidenceRefs: [] };
  return {
    ...IDENTITY,
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
      ocrEngine: "google_vision_document_text_detection_url_only",
      attributeExtractor: "@tenkings/shared/extractCardAttributes",
      structuredExtractor: "openai_responses_strict_json_schema",
      structuredExtractionModel: "gpt-5.6-sol",
      setLookupUsed: true,
      setIdentificationUsed: true,
    },
    warnings: ["Human review required."],
    ...overrides,
  };
}

function asset(side: "front" | "back", identity: {
  queueItemId: string;
  gradingSessionId: string;
  reportId: string;
} = IDENTITY) {
  const bytes = new Uint8Array(side === "front" ? [1, 2, 3, 4, 5] : [6, 7, 8, 9]).buffer;
  return {
    ...identity,
    side,
    bytes,
    contentType: "image/png",
    byteSize: bytes.byteLength,
    checksumSha256: side === "front" ? FRONT_HASH : BACK_HASH,
  };
}

function initResult(body: any, topLevelOverrides: Record<string, unknown> = {}) {
  const images = body.images.map((image: any) => ({
    ...image,
    storageKey: `ai-grader/reports/${body.reportId}/ocr-prefill/${body.queueItemId}/${body.gradingSessionId}/${image.side}.png`,
  }));
  const exactIdentity = {
    queueItemId: body.queueItemId,
    gradingSessionId: body.gradingSessionId,
    reportId: body.reportId,
  };
  return {
    ...exactIdentity,
    reportProducerContractVersion: "ai-grader-report-producer-v0.2",
    uploadSessionId: "aigocr_test",
    humanConfirmationRequired: true,
    uploadPlan: images.map((image: any) => ({
      ...image,
      publicUrl: `https://cdn.tenkings.test/${image.storageKey}`,
      uploadUrl: `https://uploads.tenkings.test/${image.side}`,
      uploadMethod: "PUT",
      uploadHeaders: { "Content-Type": "image/png" },
    })),
    requiredFinalizeManifest: {
      ...exactIdentity,
      reportProducerContractVersion: "ai-grader-report-producer-v0.2",
      uploadSessionId: "aigocr_test",
      images,
    },
    ...topLevelOverrides,
  };
}

function runnerDependencies(fetchImpl: typeof fetch, overrides: Record<string, unknown> = {}) {
  return {
    fetchImpl,
    async fetchDescriptor() { return descriptor(); },
    async fetchAsset({ side }: { side: "front" | "back" }) { return asset(side); },
    async digestSha256(bytes: ArrayBuffer) { return bytes.byteLength === 5 ? FRONT_HASH : BACK_HASH; },
    async uploadDirect() {},
    ...overrides,
  } as any;
}

test("queued OCR descriptor and body use only the exact token-gated loopback paths", async () => {
  const requests: Array<{ url: string; token: string | null }> = [];
  const fetchImpl: typeof fetch = async (request, init) => {
    const url = String(request);
    const headers = new Headers(init?.headers);
    requests.push({ url, token: headers.get("x-ai-grader-station-token") });
    if (url.includes("/ocr/asset?")) {
      return new Response(new Uint8Array([1, 2, 3, 4, 5]), {
        status: 200,
        headers: {
          "content-type": "image/png",
          "x-ai-grader-queue-item-id": IDENTITY.queueItemId,
          "x-ai-grader-grading-session-id": IDENTITY.gradingSessionId,
          "x-ai-grader-report-id": IDENTITY.reportId,
          "x-ai-grader-side": "front",
          "x-ai-grader-sha256": FRONT_HASH,
        },
      });
    }
    return new Response(JSON.stringify({ ok: true, result: descriptor() }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const common = { baseUrl: "http://127.0.0.1:47652/private", stationToken: "local-token", ...IDENTITY };
  const queued = await fetchAiGraderQueuedOcrDescriptor(common, fetchImpl);
  const front = await fetchAiGraderQueuedOcrAsset({ ...common, side: "front" }, fetchImpl);
  assert.deepEqual(queued.images.map((image) => image.side), ["front", "back"]);
  assert.equal(front.byteSize, 5);
  assert.equal(requests.every((entry) => entry.url.startsWith("http://127.0.0.1:47652/rapid-queue/queue-card-1/ocr")), true);
  assert.equal(requests.every((entry) => entry.url.includes("gradingSessionId=grading-session-1") && entry.url.includes("reportId=ocr-client-report")), true);
  assert.equal(requests.every((entry) => entry.token === "local-token"), true);
});

test("queued OCR carries the exact queue/session/report identity through init, both uploads, finalize, and result", async () => {
  const productionBodies: any[] = [];
  const uploads: Array<{ side: string; checksum: string }> = [];
  const fetchImpl: typeof fetch = async (request, init) => {
    const url = String(request);
    if (url.endsWith("/ocr-prefill-init")) {
      const body = JSON.parse(String(init?.body));
      productionBodies.push(body);
      assert.deepEqual({ queueItemId: body.queueItemId, gradingSessionId: body.gradingSessionId, reportId: body.reportId }, IDENTITY);
      assert.equal(body.images.every((image: any) =>
        image.queueItemId === IDENTITY.queueItemId && image.gradingSessionId === IDENTITY.gradingSessionId && image.reportId === IDENTITY.reportId), true);
      assert.equal(JSON.stringify(body).includes("bodyBase64"), false);
      return new Response(JSON.stringify({ ok: true, result: initResult(body) }), { status: 200 });
    }
    if (url.endsWith("/ocr-prefill-finalize")) {
      const body = JSON.parse(String(init?.body));
      productionBodies.push(body);
      assert.deepEqual({ queueItemId: body.queueItemId, gradingSessionId: body.gradingSessionId, reportId: body.reportId }, IDENTITY);
      return new Response(JSON.stringify({ ok: true, result: resultFixture() }), { status: 200 });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  const response = await runAiGraderOcrPrefillFromLocalReport({
    baseUrl: "http://127.0.0.1:47652",
    stationToken: "browser-local-token",
    ...IDENTITY,
    authHeaders: { Authorization: "Bearer operator-session" },
  }, runnerDependencies(fetchImpl, {
    async uploadDirect(input: any) {
      uploads.push({ side: input.uploadUrl.endsWith("/front") ? "front" : "back", checksum: input.checksumSha256 });
    },
  }));
  assert.deepEqual({ queueItemId: response.queueItemId, gradingSessionId: response.gradingSessionId, reportId: response.reportId }, IDENTITY);
  assert.deepEqual(uploads, [{ side: "front", checksum: FRONT_HASH }, { side: "back", checksum: BACK_HASH }]);
  assert.equal(productionBodies.length, 2);
  assert.doesNotMatch(JSON.stringify(productionBodies), /browser-local-token|operator-session|C:\\TenKings/);
});

test("queued OCR rejects every cross-card identity mismatch before accepting a result", async () => {
  let hostedCalls = 0;
  const neverHosted: typeof fetch = async () => { hostedCalls += 1; throw new Error("must not call hosted API"); };
  await assert.rejects(
    runAiGraderOcrPrefillFromLocalReport({ baseUrl: "http://127.0.0.1:47652", stationToken: "token", ...IDENTITY, authHeaders: {} },
      runnerDependencies(neverHosted, { async fetchDescriptor() { return descriptor({ queueItemId: "queue-card-2" }); } })),
    (error) => error instanceof AiGraderOcrPrefillStageError && error.stage === "descriptor_fetch",
  );
  assert.equal(hostedCalls, 0);

  await assert.rejects(
    runAiGraderOcrPrefillFromLocalReport({ baseUrl: "http://127.0.0.1:47652", stationToken: "token", ...IDENTITY, authHeaders: {} },
      runnerDependencies(neverHosted, { async fetchAsset({ side }: any) { return asset(side, { ...IDENTITY, gradingSessionId: "grading-session-2" }); } })),
    (error) => error instanceof AiGraderOcrPrefillStageError && error.stage === "front_asset_fetch",
  );
  assert.equal(hostedCalls, 0);

  const mismatchedInit: typeof fetch = async (_request, init) => {
    const body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ ok: true, result: initResult(body, { reportId: "other-report" }) }), { status: 200 });
  };
  await assert.rejects(
    runAiGraderOcrPrefillFromLocalReport({ baseUrl: "http://127.0.0.1:47652", stationToken: "token", ...IDENTITY, authHeaders: {} }, runnerDependencies(mismatchedInit)),
    (error) => error instanceof AiGraderOcrPrefillStageError && error.stage === "init",
  );

  let requestCount = 0;
  const mismatchedResult: typeof fetch = async (_request, init) => {
    requestCount += 1;
    if (requestCount === 1) {
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ ok: true, result: initResult(body) }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true, result: resultFixture({ queueItemId: "queue-card-2" }) }), { status: 200 });
  };
  await assert.rejects(
    runAiGraderOcrPrefillFromLocalReport({ baseUrl: "http://127.0.0.1:47652", stationToken: "token", ...IDENTITY, authHeaders: {} }, runnerDependencies(mismatchedResult)),
    (error) => error instanceof AiGraderOcrPrefillStageError && error.stage === "ocr_response",
  );
});

test("queued OCR rejects an invalid normalized PNG file name instead of synthesizing one", async () => {
  let hostedCalls = 0;
  const invalidDescriptor = descriptor();
  invalidDescriptor.images[0] = { ...invalidDescriptor.images[0]!, fileName: "../front-normalized-card.png" };

  await assert.rejects(
    runAiGraderOcrPrefillFromLocalReport(
      { baseUrl: "http://127.0.0.1:47652", stationToken: "token", ...IDENTITY, authHeaders: {} },
      runnerDependencies(async () => {
        hostedCalls += 1;
        throw new Error("must not call hosted API");
      }, {
        async fetchDescriptor() { return invalidDescriptor; },
      }),
    ),
    (error) => error instanceof AiGraderOcrPrefillStageError && error.stage === "descriptor_fetch",
  );
  assert.equal(hostedCalls, 0);
});

test("queued OCR rejects a traversal-safe but noncanonical side basename before hosted init", async () => {
  let hostedCalls = 0;
  const invalidDescriptor = descriptor();
  invalidDescriptor.images[0] = { ...invalidDescriptor.images[0]!, fileName: "different-front.png" };

  await assert.rejects(
    runAiGraderOcrPrefillFromLocalReport(
      { baseUrl: "http://127.0.0.1:47652", stationToken: "token", ...IDENTITY, authHeaders: {} },
      runnerDependencies(async () => {
        hostedCalls += 1;
        throw new Error("must not call hosted API");
      }, {
        async fetchDescriptor() { return invalidDescriptor; },
      }),
    ),
    (error) => error instanceof AiGraderOcrPrefillStageError && error.stage === "descriptor_fetch",
  );
  assert.equal(hostedCalls, 0);
});

test("queued OCR requires the durable in-flight claim and rejects every init drift before uploading", async () => {
  let hostedCalls = 0;
  await assert.rejects(
    runAiGraderOcrPrefillFromLocalReport(
      { baseUrl: "http://127.0.0.1:47652", stationToken: "token", ...IDENTITY, authHeaders: {} },
      runnerDependencies(async () => {
        hostedCalls += 1;
        throw new Error("must not call hosted API");
      }, {
        async fetchDescriptor() { return descriptor({ status: "eligible" }); },
      }),
    ),
    (error) => error instanceof AiGraderOcrPrefillStageError && error.stage === "descriptor_fetch",
  );
  assert.equal(hostedCalls, 0);

  const initDrifts: Array<(result: any) => void> = [
    (result) => { result.requiredFinalizeManifest.uploadSessionId = "different-upload-session"; },
    (result) => { result.requiredFinalizeManifest.reportProducerContractVersion = "wrong-contract"; },
    (result) => { result.uploadPlan[1].side = "front"; },
    (result) => { result.uploadPlan[0].fileName = "different-front.png"; },
  ];
  for (const mutate of initDrifts) {
    let uploadCalls = 0;
    const fetchImpl: typeof fetch = async (_request, init) => {
      const body = JSON.parse(String(init?.body));
      const result = initResult(body);
      mutate(result);
      return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
    };
    await assert.rejects(
      runAiGraderOcrPrefillFromLocalReport(
        { baseUrl: "http://127.0.0.1:47652", stationToken: "token", ...IDENTITY, authHeaders: {} },
        runnerDependencies(fetchImpl, { async uploadDirect() { uploadCalls += 1; } }),
      ),
      (error) => error instanceof AiGraderOcrPrefillStageError && error.stage === "init",
    );
    assert.equal(uploadCalls, 0);
  }
});

test("queued OCR rejects changed normalized bytes before hosted init", async () => {
  let hostedCalls = 0;
  await assert.rejects(
    runAiGraderOcrPrefillFromLocalReport({ baseUrl: "http://127.0.0.1:47652", stationToken: "token", ...IDENTITY, authHeaders: {} },
      runnerDependencies(async () => { hostedCalls += 1; throw new Error("must not run"); }, {
        async digestSha256() { return "f".repeat(64); },
      })),
    (error) => error instanceof AiGraderOcrPrefillStageError && error.stage === "front_asset_fetch",
  );
  assert.equal(hostedCalls, 0);
});

test("queued OCR reports every redacted client failure stage without leaking local or hosted secrets", async () => {
  const stages: AiGraderOcrPrefillStage[] = [
    "descriptor_fetch", "front_asset_fetch", "back_asset_fetch", "init",
    "front_put", "back_put", "finalize", "ocr_response",
  ];
  const messages = new Set<string>();
  for (const injectedStage of stages) {
    let directUploadCount = 0;
    const fetchImpl: typeof fetch = async (request, init) => {
      const url = String(request);
      if (url.endsWith("/ocr-prefill-init")) {
        if (injectedStage === "init") throw new Error("secret-sentinel init token URL key");
        const body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ ok: true, result: initResult(body) }), { status: 200 });
      }
      if (url.endsWith("/ocr-prefill-finalize")) {
        if (injectedStage === "finalize") throw new Error("secret-sentinel finalize credential");
        return new Response(JSON.stringify({
          ok: true,
          result: injectedStage === "ocr_response" ? {} : resultFixture(),
        }), { status: 200 });
      }
      throw new Error("secret-sentinel unexpected URL");
    };
    await assert.rejects(
      runAiGraderOcrPrefillFromLocalReport(
        {
          baseUrl: "http://127.0.0.1:47652/private",
          stationToken: "secret-sentinel-station-token",
          ...IDENTITY,
          authHeaders: { Authorization: "Bearer secret-sentinel-credential" },
        },
        runnerDependencies(fetchImpl, {
          async fetchDescriptor() {
            if (injectedStage === "descriptor_fetch") throw new Error("secret-sentinel descriptor path token");
            return descriptor();
          },
          async fetchAsset({ side }: { side: "front" | "back" }) {
            if (injectedStage === `${side}_asset_fetch`) throw new Error("secret-sentinel local path URL");
            return asset(side);
          },
          async uploadDirect(input: any) {
            directUploadCount += 1;
            if ((injectedStage === "front_put" && input.uploadUrl.endsWith("/front")) ||
                (injectedStage === "back_put" && input.uploadUrl.endsWith("/back"))) {
              throw new Error("secret-sentinel signed URL header key");
            }
          },
        }),
      ),
      (error) => {
        assert.ok(error instanceof AiGraderOcrPrefillStageError);
        assert.equal(error.stage, injectedStage);
        assert.doesNotMatch(error.message, /secret-sentinel|token|credential|private\/|storageKey|upload\.example/i);
        messages.add(error.message);
        return true;
      },
    );
    if (injectedStage === "front_put") assert.equal(directUploadCount, 1);
    if (injectedStage === "back_put") assert.equal(directUploadCount, 2);
  }
  assert.equal(messages.size, stages.length);
});

test("queued OCR rejects malformed exact-result schemas before persistence", async () => {
  const malformedResults: Array<(result: AiGraderOcrPrefillResult) => void> = [
    (result) => { result.sourceSides = ["front"]; },
    (result) => { (result.fields.playerName as any).value = true; },
    (result) => { result.reviewFieldNames = []; },
    (result) => { (result.provenance as any).ocrEngine = "alternate-provider"; },
  ];
  for (const mutate of malformedResults) {
    let requestCount = 0;
    const fetchImpl: typeof fetch = async (_request, init) => {
      requestCount += 1;
      if (requestCount === 1) {
        const body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ ok: true, result: initResult(body) }), { status: 200 });
      }
      const result = resultFixture();
      mutate(result);
      return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
    };
    await assert.rejects(
      runAiGraderOcrPrefillFromLocalReport(
        { baseUrl: "http://127.0.0.1:47652", stationToken: "token", ...IDENTITY, authHeaders: {} },
        runnerDependencies(fetchImpl),
      ),
      (error) => error instanceof AiGraderOcrPrefillStageError && error.stage === "ocr_response",
    );
  }
});

test("OCR client exposes bounded storage and provider failures without signed URLs or credentials", async () => {
  let requestCount = 0;
  const storageFailure: typeof fetch = async (_request, init) => {
    requestCount += 1;
    if (requestCount === 1) {
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ ok: true, result: initResult(body) }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: false, code: "AI_GRADER_STORAGE_CHECKSUM_UNAVAILABLE", message: "secret signed URL path" }), { status: 502 });
  };
  await assert.rejects(
    runAiGraderOcrPrefillFromLocalReport({ baseUrl: "http://127.0.0.1:47652", stationToken: "token", ...IDENTITY, authHeaders: {} }, runnerDependencies(storageFailure)),
    (error) => error instanceof AiGraderOcrPrefillStageError && error.stage === "finalize" &&
      /stored image bytes could not be verified by SHA-256/i.test(error.message) && !/secret|URL|path/.test(error.message),
  );

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
    let calls = 0;
    const providerFailure: typeof fetch = async (_request, init) => {
      calls += 1;
      if (calls === 1) {
        const body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ ok: true, result: initResult(body) }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: false, code, message: "secret provider URL" }), {
        status: aiGraderOcrFailurePresentation(code).statusCode,
      });
    };
    await assert.rejects(
      runAiGraderOcrPrefillFromLocalReport({ baseUrl: "http://127.0.0.1:47652", stationToken: "token", ...IDENTITY, authHeaders: {} }, runnerDependencies(providerFailure)),
      (error) => error instanceof AiGraderOcrPrefillStageError && error.stage === "provider" &&
        error.failureCode === code &&
        error.failureCategory === aiGraderOcrFailurePresentation(code).category &&
        error.failureLabel === aiGraderOcrFailurePresentation(code).label &&
        error.message === aiGraderOcrFailurePresentation(code).message &&
        !/secret|URL/.test(error.message),
    );
  }
});

test("OCR merge fills untouched empty fields and preserves normal operator correction", () => {
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
  assert.equal(merged.draft.year, "1990");
  assert.equal(merged.draft.productSet, "1990 SkyBox Basketball");
  assert.equal(merged.draft.autograph, true);
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
  result.reviewFieldNames = Array.from(new Set([...result.reviewFieldNames, "playerName", "year"]));
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

test("persistable OCR metadata is the safe exact result only", () => {
  const unsafeFixture = Object.assign(resultFixture(), {
    uploadUrl: "https://uploads.tenkings.test/private",
    storageKey: "private/normalized-front.png",
    localPath: "C:\\TenKings\\private.png",
  });
  const metadata = aiGraderOcrPrefillReportMetadata(unsafeFixture);
  const serialized = JSON.stringify(metadata);
  assert.deepEqual(
    { queueItemId: metadata.queueItemId, gradingSessionId: metadata.gradingSessionId, reportId: metadata.reportId },
    IDENTITY,
  );
  assert.doesNotMatch(serialized, /uploadUrl|storageKey|localPath|uploads\.tenkings|C:\\TenKings/);
  assert.equal(metadata.humanConfirmationRequired, true);
  assert.equal(metadata.publishMutationPerformed, false);
});
