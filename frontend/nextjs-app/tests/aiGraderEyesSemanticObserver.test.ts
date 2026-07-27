import assert from "node:assert/strict";
import test from "node:test";
import {
  AiGraderEyesError,
  aiGraderEyesRequestSha256,
  runAiGraderEyesSemanticObservation,
  unavailableAiGraderEyesReceipt,
} from "../lib/server/aiGraderEyesSemanticObserver";

const images = [
  {
    side: "front" as const,
    url: "https://cdn.tenkings.test/front.png",
    checksumSha256: "a".repeat(64),
  },
  {
    side: "back" as const,
    url: "https://cdn.tenkings.test/back.png",
    checksumSha256: "b".repeat(64),
  },
];

function observations() {
  return [
    {
      element: "centering",
      semanticState: "artwork_or_layout_not_border",
      challengeDeterministicInterpretation: true,
      requiresOperatorReview: true,
      confidence: 0.94,
      evidenceRefs: ["image.front"],
      rationale: "The apparent inner line follows artwork rather than a coherent printed border.",
    },
    {
      element: "corners",
      semanticState: "visible_physical_concern",
      challengeDeterministicInterpretation: true,
      requiresOperatorReview: true,
      confidence: 0.88,
      evidenceRefs: ["image.front"],
      rationale: "The upper-left corner shows visible material wear.",
    },
    {
      element: "edges",
      semanticState: "no_visible_physical_concern",
      challengeDeterministicInterpretation: false,
      requiresOperatorReview: false,
      confidence: 0.84,
      evidenceRefs: ["image.front", "image.back"],
      rationale: "Visible edge variation is consistent with printing and lighting.",
    },
    {
      element: "surface",
      semanticState: "unclear",
      challengeDeterministicInterpretation: false,
      requiresOperatorReview: true,
      confidence: 0.51,
      evidenceRefs: ["image.front"],
      rationale: "A bright region may be glare, so semantic condition is unclear.",
    },
  ];
}

function payload() {
  return {
    status: "completed",
    model: "gpt-5.6-sol-2026-07-01",
    output: [{
      type: "message",
      content: [{
        type: "output_text",
        text: JSON.stringify({ observations: observations() }),
      }],
    }],
  };
}

test("EYES uses exact hash-bound images at original detail and cannot request metric authority", async () => {
  let requestBody: any;
  const receipt = await runAiGraderEyesSemanticObservation({ images }, {
    env: { OPENAI_API_KEY: "redacted-test-key" },
    async fetchImpl(_request, init) {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(payload()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.equal(requestBody.model, "gpt-5.6-sol");
  assert.equal(requestBody.store, false);
  assert.equal(requestBody.reasoning.effort, "medium");
  assert.equal(requestBody.text.format.type, "json_schema");
  assert.equal(requestBody.text.format.strict, true);
  const imageInputs = requestBody.input[0].content.filter((entry: any) => entry.type === "input_image");
  assert.equal(imageInputs.length, 2);
  assert.equal(imageInputs.every((entry: any) => entry.detail === "original"), true);
  const instructions = requestBody.input[0].content[0].text;
  assert.match(instructions, /Do not estimate dimensions, radius, centering ratios, defect sizes, scores, or grades/);
  assert.match(instructions, /Deterministic calibrated pixels remain the only measurement authority/);
  assert.equal(receipt.requestSha256, aiGraderEyesRequestSha256(images));
  assert.deepEqual(receipt.imageBindings.map((binding) => binding.checksumSha256), [
    "a".repeat(64),
    "b".repeat(64),
  ]);
  assert.deepEqual(receipt.reviewElements, ["centering", "corners", "surface"]);
  assert.equal(receipt.metricAuthority, "deterministic_calibrated_pixels_only");
  assert.equal(receipt.wholeCardFailureAuthority, false);
});

test("EYES rejects a response whose review flag does not match its element state", async () => {
  const invalid = observations();
  invalid[3]!.requiresOperatorReview = false;
  await assert.rejects(
    runAiGraderEyesSemanticObservation({ images }, {
      env: { OPENAI_API_KEY: "redacted-test-key" },
      async fetchImpl() {
        return new Response(JSON.stringify({
          ...payload(),
          output: [{
            type: "message",
            content: [{ type: "output_text", text: JSON.stringify({ observations: invalid }) }],
          }],
        }), { status: 200 });
      },
    }),
    (error: unknown) => error instanceof AiGraderEyesError && error.code === "malformed_response",
  );
});

test("EYES provider failure produces a non-blocking receipt with no review or whole-card authority", () => {
  const receipt = unavailableAiGraderEyesReceipt(images, new AiGraderEyesError("timeout"));
  assert.equal(receipt.status, "unavailable");
  assert.equal(receipt.reason, "timeout");
  assert.deepEqual(receipt.observations, []);
  assert.deepEqual(receipt.reviewElements, []);
  assert.equal(receipt.wholeCardFailureAuthority, false);
});

test("EYES retains only bounded sanitized OpenAI non-2xx diagnostics", async () => {
  await assert.rejects(
    runAiGraderEyesSemanticObservation({ images }, {
      env: { OPENAI_API_KEY: "redacted-test-key" },
      async fetchImpl() {
        return new Response(JSON.stringify({
          error: {
            type: "rate_limit_error",
            code: "rate_limit_exceeded",
            param: "requests",
            message:
              "Retry https://provider.test/path with sk-secret-value-12345678 and " +
              "data:image/png;base64,AAAA.",
          },
        }), {
          status: 429,
          headers: { "x-request-id": "req_eyes_safe_123" },
        });
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof AiGraderEyesError);
      assert.equal(error.code, "non_2xx");
      assert.deepEqual(error.upstreamDiagnostic, {
        status: 429,
        requestId: "req_eyes_safe_123",
        errorType: "rate_limit_error",
        errorCode: "rate_limit_exceeded",
        errorParam: "requests",
        sanitizedMessage:
          "Retry [redacted-url] with [redacted-credential] and [redacted-image].",
      });
      return true;
    },
  );
});
