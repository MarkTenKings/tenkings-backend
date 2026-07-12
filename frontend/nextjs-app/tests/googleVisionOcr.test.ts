import assert from "node:assert/strict";
import test from "node:test";
import { runGoogleVisionDocumentTextDetectionByUrl } from "../lib/server/googleVisionOcr";

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
