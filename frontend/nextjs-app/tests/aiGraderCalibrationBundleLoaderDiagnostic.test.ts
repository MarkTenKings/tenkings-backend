import assert from "node:assert/strict";
import test from "node:test";
import {
  calibrationBundleLoaderFailureEvent,
  withCalibrationBundleLoaderDiagnostics,
  type AiGraderCalibrationBundleLoaderFailureEvent,
} from "../lib/server/aiGraderCalibrationBundleLoaderDiagnostic";

test("loader diagnostics preserve successful return identity and emit nothing", async () => {
  const result = { exact: true };
  const events: AiGraderCalibrationBundleLoaderFailureEvent[] = [];
  const wrapped = withCalibrationBundleLoaderDiagnostics(
    async (input: { value: number }) => {
      assert.deepEqual(input, { value: 7 });
      return result;
    },
    (event) => events.push(event),
  );

  assert.equal(await wrapped({ value: 7 }), result);
  assert.deepEqual(events, []);
});

test("loader diagnostics emit once and rethrow the exact original error", async () => {
  const failure = Object.assign(new Error("The specified key does not exist."), {
    name: "NoSuchKey",
    code: "NoSuchKey",
    $metadata: {
      httpStatusCode: 404,
      requestId: "req-1234",
    },
  });
  const events: AiGraderCalibrationBundleLoaderFailureEvent[] = [];
  const wrapped = withCalibrationBundleLoaderDiagnostics(
    async () => {
      throw failure;
    },
    (event) => events.push(event),
  );

  await assert.rejects(wrapped({}), (error) => error === failure);
  assert.deepEqual(events, [{
    event: "ai_grader_calibration_snapshot_canonical_bundle_loader_failed",
    errorName: "NoSuchKey",
    message: "The specified key does not exist.",
    providerCode: "NoSuchKey",
    httpStatusCode: 404,
    requestId: "req-1234",
  }]);
});

test("loader diagnostics redact secrets, URLs, paths, digests, and private keys", () => {
  const secret = "secret-value-that-must-never-appear";
  const event = calibrationBundleLoaderFailureEvent({
    name: "AccessDenied",
    code: "AccessDenied",
    message: [
      `GET https://storage.example.test/bucket/private/object.json?X-Amz-Signature=${secret}`,
      `token=${secret}`,
      `secretAccessKey=${secret}`,
      `CARD_STORAGE_SECRET_ACCESS_KEY=${secret}`,
      `payload={"private":"${secret}"}`,
      `path=ai-grader/calibration-bundles/sha256/${"a".repeat(64)}/member.json`,
      `localPath=C:\\protected\\calibration\\${secret}.json`,
      "-----BEGIN PRIVATE KEY-----",
      secret,
      "-----END PRIVATE KEY-----",
    ].join("\n"),
    stack: `stack contains ${secret}`,
    payload: { signedUrl: `https://example.test/?token=${secret}` },
    $metadata: {
      httpStatusCode: 403,
      requestId: "request-safe-1",
    },
  });
  const serialized = JSON.stringify(event);

  assert.equal(event.httpStatusCode, 403);
  assert.equal(event.requestId, "request-safe-1");
  assert.ok(event.message.length <= 512);
  for (const forbidden of [
    secret,
    "storage.example.test",
    "object.json",
    "ai-grader/calibration-bundles",
    "C:\\protected\\calibration",
    "PRIVATE KEY",
    "stack contains",
    "signedUrl",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("loader diagnostics reject unsafe metadata and survive a failing logger", async () => {
  const failure = Object.assign(new Error("safe provider message"), {
    name: "Error\nforged",
    code: "NoSuchKey token=provider-secret",
    requestId: "request id with spaces",
    $metadata: {
      httpStatusCode: 700,
      requestId: "request id with spaces",
    },
  });
  const event = calibrationBundleLoaderFailureEvent(failure);
  assert.deepEqual(event, {
    event: "ai_grader_calibration_snapshot_canonical_bundle_loader_failed",
    errorName: "Error",
    message: "safe provider message",
    providerCode: null,
    httpStatusCode: null,
    requestId: null,
  });

  const wrapped = withCalibrationBundleLoaderDiagnostics(
    async () => {
      throw failure;
    },
    () => {
      throw new Error("logger unavailable");
    },
  );
  await assert.rejects(wrapped({}), (error) => error === failure);
});
