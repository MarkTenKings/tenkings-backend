import assert from "node:assert/strict";
import test from "node:test";
import {
  AiGraderDirectUploadError,
  uploadAiGraderArtifactDirectly,
  type AiGraderDirectUploadPurpose,
} from "../lib/aiGraderDirectUpload";

const plannedChecksum = "1".repeat(64);
const plannedChecksumBase64 = Buffer.from(plannedChecksum, "hex").toString("base64");

function signedUploadHeaders() {
  return {
    "Content-Type": "image/png",
    "x-amz-acl": "public-read",
    "x-amz-checksum-sha256": plannedChecksumBase64,
  };
}

test("shared AI Grader upload adapter sends only the exact signed checksum and safe headers for OCR, publish, and slab flows", async () => {
  for (const purpose of ["ocr", "publish", "slab-photo"] as AiGraderDirectUploadPurpose[]) {
    let request: RequestInit | undefined;
    await uploadAiGraderArtifactDirectly({
      purpose,
      uploadUrl: "https://storage.example.invalid/object?signed=redacted",
      uploadMethod: "PUT",
      uploadHeaders: {
        "x-amz-meta-sha256": "metadata-must-not-be-sent",
        "X-Amz-Checksum-Sha256": plannedChecksumBase64,
        "x-amz-acl": "public-read",
        "content-type": "image/png",
        "x-unsafe-extra": "must-not-be-sent",
      },
      contentType: "image/png",
      checksumSha256: plannedChecksum,
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
    assert.equal(headers["x-amz-checksum-sha256"], plannedChecksumBase64);
    assert.equal(Object.keys(headers).some((name) => name.toLowerCase() === "x-unsafe-extra"), false);
  }
});

test("shared AI Grader upload adapter rejects missing, tampered, or duplicate signed checksum headers before PUT", async () => {
  const invalidPlans = [
    { headers: { "Content-Type": "image/png" } },
    { headers: { ...signedUploadHeaders(), "x-amz-checksum-sha256": Buffer.from("2".repeat(64), "hex").toString("base64") } },
    { headers: { ...signedUploadHeaders(), "X-Amz-Checksum-Sha256": plannedChecksumBase64 } },
  ];
  for (const purpose of ["ocr", "publish", "slab-photo"] as AiGraderDirectUploadPurpose[]) {
  for (const invalid of invalidPlans) {
    let fetchCalls = 0;
    await assert.rejects(
      uploadAiGraderArtifactDirectly({
        purpose,
        uploadUrl: "https://storage.example.invalid/object?signed=redacted",
        uploadMethod: "PUT",
        uploadHeaders: invalid.headers,
        contentType: "image/png",
        checksumSha256: plannedChecksum,
        body: new Uint8Array([1]),
      }, async () => {
        fetchCalls += 1;
        return new Response(null, { status: 200 });
      }),
      (error) => error instanceof AiGraderDirectUploadError && error.code === "invalid_plan",
    );
    assert.equal(fetchCalls, 0);
  }
  }
});

test("shared AI Grader upload adapter emits fixed redacted network, HTTP, and plan errors", async () => {
  const secretUrl = "https://storage.example.invalid/private-key?token=secret-sentinel";
  await assert.rejects(
    uploadAiGraderArtifactDirectly({
      purpose: "ocr",
      uploadUrl: secretUrl,
      uploadHeaders: signedUploadHeaders(),
      contentType: "image/png",
      checksumSha256: plannedChecksum,
      body: new Uint8Array([1]),
    }, async () => { throw new TypeError("Failed to fetch secret-sentinel"); }),
    (error) => error instanceof AiGraderDirectUploadError && error.code === "network" &&
      error.message === "Direct storage upload could not reach storage." && !error.message.includes("secret-sentinel"),
  );
  await assert.rejects(
    uploadAiGraderArtifactDirectly({
      purpose: "publish",
      uploadUrl: secretUrl,
      uploadHeaders: signedUploadHeaders(),
      contentType: "image/png",
      checksumSha256: plannedChecksum,
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
      checksumSha256: plannedChecksum,
      body: new Uint8Array([1]),
    }),
    (error) => error instanceof AiGraderDirectUploadError && error.code === "invalid_plan" &&
      error.message === "Direct storage upload plan is invalid.",
  );
});
