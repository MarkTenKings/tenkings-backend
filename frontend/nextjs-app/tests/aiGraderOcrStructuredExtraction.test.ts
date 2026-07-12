import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_GRADER_OCR_STRUCTURED_OUTPUT_SCHEMA,
  AiGraderOcrStructuredExtractionError,
  buildAiGraderOcrBoundedEvidence,
  runAiGraderOcrStructuredExtraction,
} from "../lib/server/aiGraderOcrStructuredExtraction";

function ocrFixture(tokenCount = 2) {
  return {
    results: (["front", "back"] as const).map((side) => ({
      id: side,
      text: side === "front" ? "1990 SkyBox Michael Jordan" : "Basketball Card No. 41",
      confidence: 0.92,
      tokens: Array.from({ length: tokenCount }, (_, index) => ({
        text: `${side}-${index}`,
        confidence: 0.9,
        image_id: side,
        bbox: [{ x: index, y: index + 1 }],
      })),
    })),
    combined_text: "1990 SkyBox Michael Jordan\nBasketball Card No. 41",
  };
}

function structuredFields() {
  const supported = <T extends string | boolean>(value: T, ref: string) => ({
    state: "supported",
    value,
    confidence: 0.94,
    evidenceRefs: [ref],
  });
  const unknown = () => ({ state: "unknown", value: null, confidence: 0.65, evidenceRefs: [] });
  return {
    category: supported("sport", "image.front"),
    playerName: supported("Michael Jordan", "google.front.text"),
    cardName: unknown(),
    year: supported("1990", "google.front.text"),
    manufacturer: supported("SkyBox", "google.front.text"),
    sport: supported("basketball", "google.back.text"),
    game: unknown(),
    productSet: supported("1990 SkyBox Basketball", "image.front"),
    cardNumber: supported("41", "google.back.text"),
    insert: unknown(),
    parallel: supported("Base", "image.front"),
    numbered: unknown(),
    autograph: supported(false, "image.front"),
    memorabilia: supported(false, "image.front"),
  };
}

function responsePayload(fields = structuredFields()) {
  return {
    status: "completed",
    output: [{
      type: "message",
      content: [{ type: "output_text", text: JSON.stringify({ fields }) }],
    }],
  };
}

test("AI Grader structured extraction uses one strict Responses request with both original-detail URLs", async () => {
  let requestCount = 0;
  let requestBody: any = null;
  const result = await runAiGraderOcrStructuredExtraction({
    images: [
      { side: "front", url: "https://cdn.tenkings.test/front.png" },
      { side: "back", url: "https://cdn.tenkings.test/back.png" },
    ],
    ocr: ocrFixture(),
    heuristicHints: { playerName: "Michael Jordan", autograph: false },
  }, {
    env: { OPENAI_API_KEY: "redacted-test-key" },
    async fetchImpl(_request, init) {
      requestCount += 1;
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(responsePayload()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert.equal(requestCount, 1);
  assert.equal(requestBody.model, "gpt-5.6-sol");
  assert.equal(requestBody.text.format.type, "json_schema");
  assert.equal(requestBody.text.format.strict, true);
  assert.deepEqual(requestBody.text.format.schema, AI_GRADER_OCR_STRUCTURED_OUTPUT_SCHEMA);
  const imageInputs = requestBody.input.flatMap((entry: any) => entry.content)
    .filter((entry: any) => entry.type === "input_image");
  assert.equal(imageInputs.length, 2);
  assert.equal(imageInputs.every((entry: any) => entry.detail === "original"), true);
  assert.deepEqual(imageInputs.map((entry: any) => entry.image_url), [
    "https://cdn.tenkings.test/front.png",
    "https://cdn.tenkings.test/back.png",
  ]);
  const serialized = JSON.stringify(requestBody);
  assert.equal(/data:image|base64|json_object|fallback/i.test(serialized), false);
  assert.equal(result.model, "gpt-5.6-sol");
  assert.equal(result.fields.autograph.value, false);
});

test("bounded Google evidence caps text, tokens, confidence, side, and boxes", () => {
  const evidence = buildAiGraderOcrBoundedEvidence({
    ocr: ocrFixture(400),
    heuristicHints: { productSet: "Synthetic Set" },
  });
  assert.deepEqual(evidence.sides.map((side) => side.side), ["front", "back"]);
  assert.equal(evidence.sides.every((side) => side.tokens.length === 250), true);
  assert.equal(evidence.sides[0]?.tokens[0]?.evidenceRef, "google.front.token.0");
  assert.deepEqual(evidence.sides[0]?.tokens[0]?.boundingBox, [{ x: 0, y: 1 }]);
  assert.equal(evidence.heuristicHints.productSet, "Synthetic Set");
});

test("structured extraction fails closed for missing config, non-2xx, refusal, malformed output, and timeout", async () => {
  const input = {
    images: [
      { side: "front" as const, url: "https://cdn.tenkings.test/front.png" },
      { side: "back" as const, url: "https://cdn.tenkings.test/back.png" },
    ],
    ocr: ocrFixture(),
  };
  await assert.rejects(
    runAiGraderOcrStructuredExtraction(input, { env: {} }),
    (error) => error instanceof AiGraderOcrStructuredExtractionError && error.code === "missing_config",
  );

  const cases: Array<{
    code: string;
    fetchImpl: typeof fetch;
  }> = [
    {
      code: "non_2xx",
      fetchImpl: async () => new Response("secret-sentinel provider body", { status: 503 }),
    },
    {
      code: "refusal",
      fetchImpl: async () => new Response(JSON.stringify({
        output: [{ content: [{ type: "refusal", refusal: "secret-sentinel" }] }],
      }), { status: 200 }),
    },
    {
      code: "malformed_response",
      fetchImpl: async () => new Response(JSON.stringify({
        output: [{ content: [{ type: "output_text", text: "not-json" }] }],
      }), { status: 200 }),
    },
  ];
  for (const failure of cases) {
    let calls = 0;
    await assert.rejects(
      runAiGraderOcrStructuredExtraction(input, {
        env: { OPENAI_API_KEY: "redacted-test-key" },
        fetchImpl: async (...args) => {
          calls += 1;
          return failure.fetchImpl(...args);
        },
      }),
      (error) => error instanceof AiGraderOcrStructuredExtractionError &&
        error.code === failure.code && !error.message.includes("secret-sentinel"),
    );
    assert.equal(calls, 1);
  }

  await assert.rejects(
    runAiGraderOcrStructuredExtraction(input, {
      env: { OPENAI_API_KEY: "redacted-test-key" },
      timeoutMs: 5,
      fetchImpl: async (_request, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      }),
    }),
    (error) => error instanceof AiGraderOcrStructuredExtractionError && error.code === "timeout",
  );
});

test("structured extraction rejects extra fields, unsupported evidence refs, and non-null unknowns", async () => {
  const invalidFields: any = structuredFields();
  invalidFields.year = { ...invalidFields.year, extra: "not allowed" };
  const unknownWithValue: any = structuredFields();
  unknownWithValue.insert = { state: "unknown", value: "Guess", confidence: 0.4, evidenceRefs: [] };
  const unsupportedRef: any = structuredFields();
  unsupportedRef.playerName = { ...unsupportedRef.playerName, evidenceRefs: ["caller.url"] };
  for (const fields of [invalidFields, unknownWithValue, unsupportedRef]) {
    await assert.rejects(
      runAiGraderOcrStructuredExtraction({
        images: [
          { side: "front", url: "https://cdn.tenkings.test/front.png" },
          { side: "back", url: "https://cdn.tenkings.test/back.png" },
        ],
        ocr: ocrFixture(),
      }, {
        env: { OPENAI_API_KEY: "redacted-test-key" },
        fetchImpl: async () => new Response(JSON.stringify(responsePayload(fields)), { status: 200 }),
      }),
      (error) => error instanceof AiGraderOcrStructuredExtractionError && error.code === "malformed_response",
    );
  }
});
