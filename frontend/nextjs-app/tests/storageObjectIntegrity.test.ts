import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  verifyStorageObjectIntegrity,
  type StorageObjectIntegrityDependencies,
} from "../lib/server/storage";

const STORAGE_KEY = "ai-grader/reports/integrity-test/front.png";

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function source(input: {
  bytes: Buffer;
  nativeChecksum?: string | null;
  headByteSize?: number;
  readByteSize?: number;
  body?: AsyncIterable<Uint8Array> & { destroy?: () => void };
  openRead?: () => Promise<never>;
}): StorageObjectIntegrityDependencies {
  return {
    async headObject(storageKey) {
      return {
        storageKey,
        byteSize: input.headByteSize ?? input.bytes.byteLength,
        contentType: "image/png",
        metadata: { sha256: "caller-controlled-and-ignored" },
        checksumSha256: input.nativeChecksum ?? null,
        nativeChecksumPresent: input.nativeChecksum !== undefined && input.nativeChecksum !== null,
        ...(input.nativeChecksum ? { checksumSource: "provider_native" as const } : {}),
      };
    },
    async openRead(storageKey) {
      if (input.openRead) return input.openRead();
      return {
        storageKey,
        byteSize: input.readByteSize ?? input.bytes.byteLength,
        body: input.body ?? Readable.from([input.bytes]),
      };
    },
  };
}

test("uses a valid provider-native SHA-256 without reading object bytes", async () => {
  const bytes = Buffer.from("provider-native-integrity");
  let reads = 0;
  const result = await verifyStorageObjectIntegrity({
    storageKey: STORAGE_KEY,
    expectedByteSize: bytes.byteLength,
    expectedChecksumSha256: sha256(bytes),
  }, {
    async headObject(storageKey) {
      return {
        storageKey,
        byteSize: bytes.byteLength,
        contentType: "image/png",
        metadata: {},
        checksumSha256: sha256(bytes),
        nativeChecksumPresent: true,
        checksumSource: "provider_native",
      };
    },
    async openRead() {
      reads += 1;
      throw new Error("must not read");
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.checksumSource, "provider_native");
  assert.equal(reads, 0);
});

test("streams and verifies exact stored bytes when the native checksum is absent", async () => {
  const bytes = Buffer.from("streamed-provider-integrity");
  const result = await verifyStorageObjectIntegrity({
    storageKey: STORAGE_KEY,
    expectedByteSize: bytes.byteLength,
    expectedChecksumSha256: sha256(bytes),
  }, source({
    bytes,
    nativeChecksum: null,
    body: Readable.from([bytes.subarray(0, 5), bytes.subarray(5)]),
  }));
  assert.equal(result.ok, true);
  assert.equal(result.checksumSha256, sha256(bytes));
  assert.equal(result.checksumSource, "server_stream");
});

test("does not trust a HeadObject digest unless it is explicitly provider-native", async () => {
  const bytes = Buffer.from("explicit-native-source-required");
  let reads = 0;
  const result = await verifyStorageObjectIntegrity({
    storageKey: STORAGE_KEY,
    expectedByteSize: bytes.byteLength,
    expectedChecksumSha256: sha256(bytes),
  }, {
    async headObject(storageKey) {
      return {
        storageKey,
        byteSize: bytes.byteLength,
        contentType: "image/png",
        metadata: {},
        checksumSha256: "0".repeat(64),
        nativeChecksumPresent: false,
      };
    },
    async openRead(storageKey) {
      reads += 1;
      return { storageKey, byteSize: bytes.byteLength, body: Readable.from([bytes]) };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.checksumSource, "server_stream");
  assert.equal(reads, 1);
});

test("fails closed on a malformed checksum explicitly reported as provider-native", async () => {
  const bytes = Buffer.from("invalid-native-checksum");
  let reads = 0;
  await assert.rejects(
    verifyStorageObjectIntegrity({
      storageKey: STORAGE_KEY,
      expectedByteSize: bytes.byteLength,
      expectedChecksumSha256: sha256(bytes),
    }, {
      async headObject(storageKey) {
        return {
          storageKey,
          byteSize: bytes.byteLength,
          contentType: "image/png",
          metadata: {},
          checksumSha256: null,
          nativeChecksumPresent: true,
        };
      },
      async openRead() {
        reads += 1;
        throw new Error("must not fall back from a malformed native checksum");
      },
    }),
    /invalid native SHA-256 checksum/i,
  );
  assert.equal(reads, 0);
});

test("rejects a same-size streamed SHA-256 mismatch", async () => {
  const expected = Buffer.from("expected-byte-body");
  const stored = Buffer.from("tampered-byte-body");
  assert.equal(stored.byteLength, expected.byteLength);
  const result = await verifyStorageObjectIntegrity({
    storageKey: STORAGE_KEY,
    expectedByteSize: expected.byteLength,
    expectedChecksumSha256: sha256(expected),
  }, source({ bytes: stored, nativeChecksum: null }));
  assert.equal(result.ok, false);
  assert.equal(result.checksumSha256, sha256(stored));
  assert.match(String(result.message), /streamed sha-256 checksum mismatch/i);
});

test("rejects a HeadObject byte-size mismatch before opening the object", async () => {
  const bytes = Buffer.from("head-size-mismatch");
  let reads = 0;
  const dependencies = source({ bytes, nativeChecksum: null, headByteSize: bytes.byteLength + 1 });
  dependencies.openRead = async () => {
    reads += 1;
    throw new Error("must not read");
  };
  const result = await verifyStorageObjectIntegrity({
    storageKey: STORAGE_KEY,
    expectedByteSize: bytes.byteLength,
    expectedChecksumSha256: sha256(bytes),
  }, dependencies);
  assert.equal(result.ok, false);
  assert.equal(result.byteSize, bytes.byteLength + 1);
  assert.equal(reads, 0);
});

test("aborts when GetObject ContentLength disagrees with the expected byte length", async () => {
  const bytes = Buffer.from("get-content-length-mismatch");
  await assert.rejects(
    verifyStorageObjectIntegrity({
      storageKey: STORAGE_KEY,
      expectedByteSize: bytes.byteLength,
      expectedChecksumSha256: sha256(bytes),
    }, source({
      bytes,
      nativeChecksum: null,
      readByteSize: bytes.byteLength - 1,
    })),
    /read byte size did not match the expected byte length/i,
  );
});

test("aborts a truncated object stream", async () => {
  const expected = Buffer.from("complete-object-body");
  await assert.rejects(
    verifyStorageObjectIntegrity({
      storageKey: STORAGE_KEY,
      expectedByteSize: expected.byteLength,
      expectedChecksumSha256: sha256(expected),
    }, source({
      bytes: expected,
      nativeChecksum: null,
      body: Readable.from([expected.subarray(0, expected.byteLength - 1)]),
    })),
    /ended before the expected byte length/i,
  );
});

test("aborts an object stream that overruns the expected byte length", async () => {
  const expected = Buffer.from("bounded-object");
  const oversized = Buffer.concat([expected, Buffer.from("x")]);
  await assert.rejects(
    verifyStorageObjectIntegrity({
      storageKey: STORAGE_KEY,
      expectedByteSize: expected.byteLength,
      expectedChecksumSha256: sha256(expected),
    }, source({
      bytes: expected,
      nativeChecksum: null,
      readByteSize: expected.byteLength,
      body: Readable.from([oversized]),
    })),
    /exceeded the expected byte length/i,
  );
});

test("aborts an object stream as soon as it crosses the configured upload-size limit", async () => {
  const expected = Buffer.from("bounded-max");
  const oversized = Buffer.concat([expected, Buffer.from("x")]);
  await assert.rejects(
    verifyStorageObjectIntegrity({
      storageKey: STORAGE_KEY,
      expectedByteSize: expected.byteLength,
      expectedChecksumSha256: sha256(expected),
      maxByteSize: expected.byteLength,
    }, source({
      bytes: expected,
      nativeChecksum: null,
      readByteSize: expected.byteLength,
      body: Readable.from([oversized]),
    })),
    /stream exceeded the configured upload-size limit/i,
  );
});

test("rejects a GetObject response for a different storage identity", async () => {
  const expected = Buffer.from("exact-get-identity");
  await assert.rejects(
    verifyStorageObjectIntegrity({
      storageKey: STORAGE_KEY,
      expectedByteSize: expected.byteLength,
      expectedChecksumSha256: sha256(expected),
    }, {
      async headObject(storageKey) {
        return {
          storageKey,
          byteSize: expected.byteLength,
          contentType: "image/png",
          metadata: {},
          checksumSha256: null,
          nativeChecksumPresent: false,
        };
      },
      async openRead() {
        return {
          storageKey: `${STORAGE_KEY}.other`,
          byteSize: expected.byteLength,
          body: Readable.from([expected]),
        };
      },
    }),
    /object identity mismatch/i,
  );
});

test("sanitizes a provider stream read failure", async () => {
  const expected = Buffer.from("provider-read-failure");
  const failingBody = Readable.from((async function* () {
    yield expected.subarray(0, 2);
    throw new Error("secret endpoint credential and object key");
  })());
  await assert.rejects(
    verifyStorageObjectIntegrity({
      storageKey: STORAGE_KEY,
      expectedByteSize: expected.byteLength,
      expectedChecksumSha256: sha256(expected),
    }, source({ bytes: expected, nativeChecksum: null, body: failingBody })),
    (error) => error instanceof Error &&
      error.message === "Storage object read failed during SHA-256 verification." &&
      !/secret|credential|object key/i.test(error.message),
  );
});

test("sanitizes a provider GetObject failure before a body is returned", async () => {
  const expected = Buffer.from("provider-get-failure");
  await assert.rejects(
    verifyStorageObjectIntegrity({
      storageKey: STORAGE_KEY,
      expectedByteSize: expected.byteLength,
      expectedChecksumSha256: sha256(expected),
    }, source({
      bytes: expected,
      nativeChecksum: null,
      async openRead(): Promise<never> {
        throw new Error("secret endpoint credential and object key");
      },
    })),
    (error) => error instanceof Error &&
      error.message === "Storage object read failed during SHA-256 verification." &&
      !/secret|credential|object key/i.test(error.message),
  );
});

test("enforces exact object identity and the configured maximum before streaming", async () => {
  const bytes = Buffer.from("identity-and-limit");
  await assert.rejects(
    verifyStorageObjectIntegrity({
      storageKey: STORAGE_KEY,
      expectedByteSize: bytes.byteLength,
      expectedChecksumSha256: sha256(bytes),
    }, {
      async headObject() {
        return {
          storageKey: `${STORAGE_KEY}.other`,
          byteSize: bytes.byteLength,
          contentType: "image/png",
          metadata: {},
          checksumSha256: null,
        };
      },
    }),
    /object identity mismatch/i,
  );
  await assert.rejects(
    verifyStorageObjectIntegrity({
      storageKey: STORAGE_KEY,
      expectedByteSize: bytes.byteLength,
      expectedChecksumSha256: sha256(bytes),
      maxByteSize: bytes.byteLength - 1,
    }, source({ bytes, nativeChecksum: null })),
    /exceeds the configured upload-size limit/i,
  );
});

test("production publish uses the sole canonical route verifier before persistence", () => {
  const routeSource = readFileSync(fileURLToPath(new URL(
    "../pages/api/admin/ai-grader/production/[...action].ts",
    import.meta.url,
  )), "utf8");
  assert.equal(routeSource.includes("headStorageObject"), false);
  assert.equal((routeSource.match(/verifyStorageObjectIntegrity\s*\(\{/g) ?? []).length, 1);

  const apiSource = readFileSync(fileURLToPath(new URL(
    "../lib/server/aiGraderProductionApi.ts",
    import.meta.url,
  )), "utf8");
  const verifyIndex = apiSource.indexOf("await verifyUploadedArtifacts(deps, uploadManifest);");
  const persistIndex = apiSource.indexOf("const result = await deps.persist({", verifyIndex);
  assert.notEqual(verifyIndex, -1);
  assert.equal(persistIndex > verifyIndex, true);
});
