import assert from "node:assert/strict";
import test from "node:test";
import {
  AiGraderGoogleVisionError,
  runGoogleVisionDocumentTextDetectionByUrl,
} from "../lib/server/googleVisionOcr";

test("AI Grader Google Vision uses DOCUMENT_TEXT_DETECTION with URL inputs only", async () => {
  const requests: any[] = [];
  const result = await runGoogleVisionDocumentTextDetectionByUrl([
    { id: "front", url: "https://cdn.tenkings.test/front.png" },
    { id: "back", url: "https://cdn.tenkings.test/back.png" },
  ], {
    env: { GOOGLE_VISION_API_KEY: "redacted-test-key" },
    async fetchImpl(_request, init) {
      requests.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({
        responses: [
          { fullTextAnnotation: { text: "Front text", pages: [] } },
          { fullTextAnnotation: { text: "Back text", pages: [] } },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].requests.map((entry: any) => entry.features), [
    [{ type: "DOCUMENT_TEXT_DETECTION" }],
    [{ type: "DOCUMENT_TEXT_DETECTION" }],
  ]);
  assert.deepEqual(requests[0].requests.map((entry: any) => entry.image.source.imageUri), [
    "https://cdn.tenkings.test/front.png",
    "https://cdn.tenkings.test/back.png",
  ]);
  assert.equal(requests[0].requests.some((entry: any) => "content" in entry.image), false);
  assert.equal(JSON.stringify(requests).includes("base64"), false);
  assert.equal(result.combined_text, "Front text\n\nBack text");
});

test("AI Grader Google Vision ignores the generic server-fetch switch and emits safe failures", async () => {
  let calls = 0;
  await assert.rejects(
    runGoogleVisionDocumentTextDetectionByUrl([
      { id: "front", url: "https://cdn.tenkings.test/front.png" },
    ], {
      env: {
        GOOGLE_VISION_API_KEY: "redacted-test-key",
        GOOGLE_VISION_USE_IMAGE_URI: "false",
      },
      async fetchImpl(_request, init) {
        calls += 1;
        const body = JSON.parse(String(init?.body));
        assert.equal(body.requests[0].image.source.imageUri, "https://cdn.tenkings.test/front.png");
        return new Response("secret-sentinel URL token path", { status: 500 });
      },
    }),
    (error) => error instanceof Error &&
      /rejected the AI Grader OCR request/.test(error.message) &&
      !/secret-sentinel|token|path/.test(error.message),
  );
  assert.equal(calls, 1);
});

test("AI Grader Google Vision requires one response per requested side", async () => {
  await assert.rejects(
    runGoogleVisionDocumentTextDetectionByUrl([
      { id: "front", url: "https://cdn.tenkings.test/front.png" },
      { id: "back", url: "https://cdn.tenkings.test/back.png" },
    ], {
      env: { GOOGLE_VISION_API_KEY: "redacted-test-key" },
      async fetchImpl() {
        return new Response(JSON.stringify({ responses: [{ fullTextAnnotation: { text: "front", pages: [] } }] }), {
          status: 200,
        });
      },
    }),
    (error) => error instanceof AiGraderGoogleVisionError && error.code === "response_count_mismatch",
  );
});

for (const side of ["front", "back"] as const) {
  test(`AI Grader Google Vision rejects an HTTP-200 ${side} image error safely`, async () => {
    const responses = [
      { fullTextAnnotation: { text: "front", pages: [] } },
      { fullTextAnnotation: { text: "back", pages: [] } },
    ];
    responses[side === "front" ? 0 : 1] = { error: { message: "secret provider URL key token" } } as any;
    await assert.rejects(
      runGoogleVisionDocumentTextDetectionByUrl([
        { id: "front", url: "https://cdn.tenkings.test/front.png" },
        { id: "back", url: "https://cdn.tenkings.test/back.png" },
      ], {
        env: { GOOGLE_VISION_API_KEY: "redacted-test-key" },
        async fetchImpl() {
          return new Response(JSON.stringify({ responses }), { status: 200 });
        },
      }),
      (error) => error instanceof AiGraderGoogleVisionError &&
        error.code === "provider_error" && error.side === side &&
        error.message.includes(side) && !/secret|url|key|token/i.test(error.message),
    );
  });
}

test("AI Grader Google Vision rejects top-level errors and malformed side responses", async () => {
  const cases = [
    {
      payload: { error: { message: "secret provider message" }, responses: [] },
      code: "provider_error",
      side: undefined,
    },
    {
      payload: { responses: [null, { fullTextAnnotation: { text: "back", pages: [] } }] },
      code: "malformed_response",
      side: "front",
    },
  ];
  for (const entry of cases) {
    await assert.rejects(
      runGoogleVisionDocumentTextDetectionByUrl([
        { id: "front", url: "https://cdn.tenkings.test/front.png" },
        { id: "back", url: "https://cdn.tenkings.test/back.png" },
      ], {
        env: { GOOGLE_VISION_API_KEY: "redacted-test-key" },
        async fetchImpl() {
          return new Response(JSON.stringify(entry.payload), { status: 200 });
        },
      }),
      (error) => error instanceof AiGraderGoogleVisionError &&
        error.code === entry.code && error.side === entry.side && !/secret provider message/.test(error.message),
    );
  }
});

test("AI Grader Google Vision applies a bounded timeout", async () => {
  await assert.rejects(
    runGoogleVisionDocumentTextDetectionByUrl([
      { id: "front", url: "https://cdn.tenkings.test/front.png" },
    ], {
      env: { GOOGLE_VISION_API_KEY: "redacted-test-key" },
      timeoutMs: 5,
      fetchImpl: async (_request, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("secret abort details");
          error.name = "AbortError";
          reject(error);
        });
      }),
    }),
    (error) => error instanceof AiGraderGoogleVisionError &&
      error.code === "timeout" && !/secret/.test(error.message),
  );
});

test("AI Grader Google Vision rejects malformed JSON and non-2xx responses safely", async () => {
  const cases = [
    { response: new Response("not-json secret", { status: 200 }), code: "malformed_response" },
    { response: new Response("provider secret", { status: 503 }), code: "non_2xx" },
  ];
  for (const entry of cases) {
    await assert.rejects(
      runGoogleVisionDocumentTextDetectionByUrl([
        { id: "front", url: "https://cdn.tenkings.test/front.png" },
      ], {
        env: { GOOGLE_VISION_API_KEY: "redacted-test-key" },
        async fetchImpl() {
          return entry.response;
        },
      }),
      (error) => error instanceof AiGraderGoogleVisionError &&
        error.code === entry.code && !/secret/.test(error.message),
    );
  }
});

test("AI Grader Google Vision rejects missing configuration and caller-style URLs", async () => {
  await assert.rejects(
    runGoogleVisionDocumentTextDetectionByUrl([
      { id: "front", url: "https://cdn.tenkings.test/front.png" },
    ], { env: {} }),
    /not configured/,
  );
  await assert.rejects(
    runGoogleVisionDocumentTextDetectionByUrl([
      { id: "front", url: "https://cdn.tenkings.test/front.png?signature=redacted" },
    ], { env: { GOOGLE_VISION_API_KEY: "redacted-test-key" } }),
    /verified public HTTPS image URLs/,
  );
});
