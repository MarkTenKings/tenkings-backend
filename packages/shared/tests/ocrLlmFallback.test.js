const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildOcrLlmAttemptPlan,
  isStructuredOutputUnsupported,
  resolveOcrLlmAttempt,
} = require("../dist/ocrLlmFallback");

test("buildOcrLlmAttemptPlan emits primary and fallback attempts in order", () => {
  const plan = buildOcrLlmAttemptPlan("gpt-5", "gpt-5-mini");
  assert.deepEqual(plan, [
    { model: "gpt-5", format: "json_schema" },
    { model: "gpt-5", format: "json_object" },
    { model: "gpt-5-mini", format: "json_schema" },
    { model: "gpt-5-mini", format: "json_object" },
  ]);
});

test("buildOcrLlmAttemptPlan omits duplicate fallback", () => {
  const plan = buildOcrLlmAttemptPlan("gpt-5", "gpt-5");
  assert.deepEqual(plan, [
    { model: "gpt-5", format: "json_schema" },
    { model: "gpt-5", format: "json_object" },
  ]);
});

test("isStructuredOutputUnsupported detects unsupported json_schema payloads", () => {
  assert.equal(
    isStructuredOutputUnsupported(400, "This model does not support structured output json_schema"),
    true
  );
  assert.equal(isStructuredOutputUnsupported(422, "json_schema unsupported for this model"), true);
  assert.equal(isStructuredOutputUnsupported(500, "json_schema unsupported for this model"), false);
  assert.equal(isStructuredOutputUnsupported(400, "invalid API key"), false);
});

test("resolveOcrLlmAttempt falls back from unsupported json_schema to json_object", async () => {
  const calls = [];
  const output = await resolveOcrLlmAttempt({
    primaryModel: "gpt-5",
    fallbackModel: "gpt-5-mini",
    execute: async (attempt) => {
      calls.push(attempt);
      if (attempt.model === "gpt-5" && attempt.format === "json_schema") {
        return {
          ok: false,
          status: 400,
          bodyText: "This model does not support structured output json_schema",
          parsed: null,
        };
      }
      if (attempt.model === "gpt-5" && attempt.format === "json_object") {
        return {
          ok: true,
          status: 200,
          bodyText: "",
          parsed: { fields: { cardNumber: "10" } },
        };
      }
      return {
        ok: true,
        status: 200,
        bodyText: "",
        parsed: null,
      };
    },
  });

  assert.deepEqual(calls, [
    { model: "gpt-5", format: "json_schema" },
    { model: "gpt-5", format: "json_object" },
  ]);
  assert.equal(output?.attempt.model, "gpt-5");
  assert.equal(output?.attempt.format, "json_object");
  assert.equal(output?.fallbackUsed, true);
});

test("resolveOcrLlmAttempt throws on non-fallback errors", async () => {
  await assert.rejects(
    () =>
      resolveOcrLlmAttempt({
        primaryModel: "gpt-5",
        fallbackModel: "gpt-5-mini",
        execute: async () => ({
          ok: false,
          status: 401,
          bodyText: "invalid API key",
          parsed: null,
        }),
      }),
    /OpenAI responses parse failed \(401\)/
  );
});

test("resolveOcrLlmAttempt returns null when no attempt yields parsed payload", async () => {
  const output = await resolveOcrLlmAttempt({
    primaryModel: "gpt-5",
    fallbackModel: "gpt-5-mini",
    execute: async () => ({
      ok: true,
      status: 200,
      bodyText: "",
      parsed: null,
    }),
  });
  assert.equal(output, null);
});
