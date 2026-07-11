import assert from "node:assert/strict";
import test from "node:test";
import {
  AiGraderDirectUploadError,
  uploadAiGraderArtifactDirectly,
  type AiGraderDirectUploadPurpose,
} from "../lib/aiGraderDirectUpload";

test("shared AI Grader upload adapter strips SHA headers for OCR, publish, and slab flows", async () => {
  for (const purpose of ["ocr", "publish", "slab-photo"] as AiGraderDirectUploadPurpose[]) {
    let request: RequestInit | undefined;
    await uploadAiGraderArtifactDirectly({
      purpose,
      uploadUrl: "https://storage.example.invalid/object?signed=redacted",
      uploadMethod: "PUT",
      uploadHeaders: {
        "x-amz-meta-sha256": "metadata-must-not-be-sent",
        "X-Amz-Checksum-Sha256": "checksum-header-must-not-be-sent",
        "x-amz-acl": "public-read",
        "content-type": "application/wrong",
      },
      contentType: "image/png",
      body: new Uint8Array([1, 2, 3]),
    }, async (_url, init) => {
      request = init;
      return new Response(null, { status: 200 });
    });
    assert.equal(request?.method, "PUT");
    assert.equal(request?.mode, "cors");
    assert.equal(request?.credentials, "omit");
    const headers = request?.headers as Record<string, string>;
    assert.equal(headers["Content-Type"], "image/png");
    assert.equal(headers["x-amz-acl"], "public-read");
    assert.equal(Object.keys(headers).some((name) => name.toLowerCase() === "x-amz-meta-sha256"), false);
    assert.equal(Object.keys(headers).some((name) => name.toLowerCase() === "x-amz-checksum-sha256"), false);
  }
});

test("shared AI Grader upload adapter emits fixed redacted network, HTTP, and plan errors", async () => {
  const secretUrl = "https://storage.example.invalid/private-key?token=secret-sentinel";
  await assert.rejects(
    uploadAiGraderArtifactDirectly({
      purpose: "ocr",
      uploadUrl: secretUrl,
      contentType: "image/png",
      body: new Uint8Array([1]),
    }, async () => { throw new TypeError("Failed to fetch secret-sentinel"); }),
    (error) => error instanceof AiGraderDirectUploadError && error.code === "network" &&
      error.message === "Direct storage upload could not reach storage." && !error.message.includes("secret-sentinel"),
  );
  await assert.rejects(
    uploadAiGraderArtifactDirectly({
      purpose: "publish",
      uploadUrl: secretUrl,
      contentType: "image/png",
      body: new Uint8Array([1]),
    }, async () => new Response(null, { status: 403 })),
    (error) => error instanceof AiGraderDirectUploadError && error.code === "http" &&
      error.message === "Direct storage upload was rejected by storage (HTTP 403)." && !error.message.includes("secret-sentinel"),
  );
  await assert.rejects(
    uploadAiGraderArtifactDirectly({
      purpose: "slab-photo",
      uploadUrl: "http://127.0.0.1/private",
      uploadMethod: "POST",
      contentType: "image/png",
      body: new Uint8Array([1]),
    }),
    (error) => error instanceof AiGraderDirectUploadError && error.code === "invalid_plan" &&
      error.message === "Direct storage upload plan is invalid.",
  );
});
