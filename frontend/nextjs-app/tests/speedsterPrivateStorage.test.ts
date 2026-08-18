import assert from "node:assert/strict";
import test from "node:test";
import {
  createPrivateSpeedsterUploadCommand,
  presignPrivateSpeedsterUploadUrl,
} from "../lib/server/storage";

const STORAGE_KEY = "ai-grader-v2/admin-1/speedster-session-123456789/original/front.jpg";
const CHECKSUM = "a".repeat(64);

test("Speedster uploads are private regardless of unset, invalid, or public global ACL configuration", async () => {
  for (const configuredAcl of [undefined, "not-an-acl", "public-read"]) {
    const previous = process.env.CARD_STORAGE_ACL;
    if (configuredAcl === undefined) delete process.env.CARD_STORAGE_ACL;
    else process.env.CARD_STORAGE_ACL = configuredAcl;
    try {
      const command = createPrivateSpeedsterUploadCommand({
        storageKey: STORAGE_KEY,
        contentType: "image/jpeg",
        checksumSha256: CHECKSUM,
      }, "private-speedster-bucket");
      assert.equal(command.input.ACL, "private");
      assert.notEqual(command.input.ACL, "public-read");

      let signedAcl: unknown;
      let signedChecksum: unknown;
      let unhoistableHeaders: Set<string> | undefined;
      await presignPrivateSpeedsterUploadUrl({
        storageKey: STORAGE_KEY,
        contentType: "image/jpeg",
        checksumSha256: CHECKSUM,
        requireAclHeader: true,
      }, {
        bucket: "private-speedster-bucket",
        client: {} as any,
        async sign(_client, signedCommand, options) {
          signedAcl = (signedCommand as any).input.ACL;
          signedChecksum = (signedCommand as any).input.ChecksumSHA256;
          unhoistableHeaders = options?.unhoistableHeaders;
          return "https://private-storage.example.test/exact";
        },
      });
      assert.equal(signedAcl, "private");
      assert.equal(typeof signedChecksum, "string");
      assert.equal(unhoistableHeaders?.has("x-amz-acl"), true);
      assert.equal(unhoistableHeaders?.has("x-amz-checksum-sha256"), true);
    } finally {
      if (previous === undefined) delete process.env.CARD_STORAGE_ACL;
      else process.env.CARD_STORAGE_ACL = previous;
    }
  }
});

test("private Speedster signer rejects keys, media types, and checksums outside its exact contract", () => {
  assert.throws(() => createPrivateSpeedsterUploadCommand({
    storageKey: "uploads/public/front.jpg",
    contentType: "image/jpeg",
  }, "private-speedster-bucket"), /controlled prefix/);
  assert.throws(() => createPrivateSpeedsterUploadCommand({
    storageKey: "ai-grader-v2/admin-1/../public/front.jpg",
    contentType: "image/jpeg",
  }, "private-speedster-bucket"), /controlled prefix/);
  assert.throws(() => createPrivateSpeedsterUploadCommand({
    storageKey: STORAGE_KEY,
    contentType: "image/svg+xml",
  }, "private-speedster-bucket"), /JPEG, PNG, or WebP/);
  assert.throws(() => createPrivateSpeedsterUploadCommand({
    storageKey: STORAGE_KEY,
    contentType: "image/jpeg",
    checksumSha256: "caller-metadata-is-not-integrity",
  }, "private-speedster-bucket"), /64-character hex digest/);
});
