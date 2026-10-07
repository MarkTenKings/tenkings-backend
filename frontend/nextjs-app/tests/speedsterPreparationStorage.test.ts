import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { SPEEDSTER_PREPARATION_FRAME, SPEEDSTER_PREPARATION_ROLES } from "../lib/ai-grader-v2/preparation";
import { freezeSpeedsterPreparationSource, verifyAndFreezeSpeedsterPreparation, verifySpeedsterPreparationManifestBytes } from "../lib/server/speedsterPreparationStorage";
import { preparationArtifactKey, preparationBytesHash, preparationHash, preparationStagingKey } from "../lib/server/speedsterPreparationIntegrity";
import { createPrivatePreparationEvidenceBuffer, createPrivateSpeedsterUploadCommand, presignUploadUrl, uploadPrivateChecksumBuffer } from "../lib/server/storage";
import { FixturePreparationStorage, fixturePreparationColor, fixturePreparationIdentity, fixturePreparationInput, fixturePreparationScope, fixturePreparationTransform } from "./fixtures/speedsterPreparation";

const images = Promise.all([
  sharp({ create: { width: 800, height: 1000, channels: 3, background: "#8642a5" } }).jpeg().toBuffer(),
  sharp({ create: { width: 1270, height: 1778, channels: 3, background: "#dfac73" } }).webp().toBuffer(),
  sharp({ create: { width: 1350, height: 1858, channels: 3, background: "#349cab" } }).webp().toBuffer(),
]);

async function preparedFixture() {
  const [original, rectified, inspection] = await images;
  const storage = new FixturePreparationStorage();
  const input = fixturePreparationInput();
  storage.objects.set(input.source.originalStorageKey, Buffer.from(original));
  const source = await freezeSpeedsterPreparationSource(fixturePreparationScope, input.source.originalStorageKey, storage);
  const attempt = { ...fixturePreparationScope, id: randomUUID(), sideRevision: 1, input: { ...input, source }, requestSha256: preparationHash({ fixture: true }), dispatchClaimId: randomUUID() };
  for (const role of SPEEDSTER_PREPARATION_ROLES) storage.objects.set(preparationStagingKey(attempt, attempt.id, role), Buffer.from(role === "RECTIFIED" ? rectified : inspection));
  const { originalStorageKey: _original, originalSha256: _originalHash, storageKey: _snapshotKey, ...sourceEvidence } = source;
  const response = { preparationIdentity: fixturePreparationIdentity, transform: fixturePreparationTransform(attempt.input), inspectionFrame: structuredClone(SPEEDSTER_PREPARATION_FRAME), printedColorResult: fixturePreparationColor,
    printedColorReceipt: "fixture receipt for byte-only tests",
    preparationEvidence: { attemptId: attempt.id, dispatchClaimId: attempt.dispatchClaimId, requestSha256: attempt.requestSha256, inputSha256: preparationHash(attempt.input), sourceSha256: source.sha256, source: sourceEvidence } };
  return { storage, attempt, response };
}

test("preparation bytes: source and exactly five decoded roles freeze to hash-bound destinations", async () => {
  const { storage, attempt, response } = await preparedFixture();
  const body = await verifyAndFreezeSpeedsterPreparation(attempt, response, storage);
  assert.equal(storage.writes.length, 6);
  await verifySpeedsterPreparationManifestBytes(body, storage);
  assert.equal(body.input.source.originalSha256, body.input.source.sha256);
  for (const role of SPEEDSTER_PREPARATION_ROLES) {
    const artifact = body.artifacts[role];
    assert.ok(artifact.storageKey.includes(`/prepared-evidence/front/${attempt.id}/`));
    assert.equal(preparationBytesHash(storage.objects.get(artifact.storageKey)!), artifact.sha256);
  }
  assert.deepEqual(await verifyAndFreezeSpeedsterPreparation(attempt, response, storage), body);
  assert.equal(storage.writes.length, 6, "idempotent finalization must not overwrite");
});

test("preparation bytes: mutable original changes cannot alter the frozen source", async () => {
  const { storage, attempt, response } = await preparedFixture();
  const originalA = Buffer.from(storage.objects.get(attempt.input.source.originalStorageKey)!);
  storage.objects.set(attempt.input.source.originalStorageKey, Buffer.from("source B"));
  const body = await verifyAndFreezeSpeedsterPreparation(attempt, response, storage);
  storage.objects.set(attempt.input.source.originalStorageKey, originalA);
  await verifySpeedsterPreparationManifestBytes(body, storage);
  assert.deepEqual(storage.objects.get(body.input.source.storageKey), originalA);
});

test("preparation bytes: staging changes during final upload cannot substitute the hashed buffer", async () => {
  const { storage, attempt, response } = await preparedFixture();
  const expected = preparationBytesHash(storage.objects.get(preparationStagingKey(attempt, attempt.id, "RECTIFIED"))!);
  storage.beforeCreate = (key) => {
    if (key.includes("/prepared-evidence/")) {
      for (const role of SPEEDSTER_PREPARATION_ROLES) storage.objects.set(preparationStagingKey(attempt, attempt.id, role), Buffer.from("late PUT"));
    }
  };
  const body = await verifyAndFreezeSpeedsterPreparation(attempt, response, storage);
  assert.equal(body.artifacts.RECTIFIED.sha256, expected);
  await verifySpeedsterPreparationManifestBytes(body, storage);
});

test("preparation bytes: an adapter's reused read buffer cannot change server-owned bytes", async () => {
  const { storage, attempt, response } = await preparedFixture();
  const buffers = SPEEDSTER_PREPARATION_ROLES.map((role) => storage.objects.get(preparationStagingKey(attempt, attempt.id, role))!);
  storage.beforeCreate = (key) => { if (key.includes("/prepared-evidence/")) for (const bytes of buffers) bytes.fill(0); };
  const body = await verifyAndFreezeSpeedsterPreparation(attempt, response, storage);
  await verifySpeedsterPreparationManifestBytes(body, storage);
});

test("preparation bytes: conflicting pre-existing destination fails without overwrite", async () => {
  const { storage, attempt, response } = await preparedFixture();
  const sha256 = preparationBytesHash(storage.objects.get(preparationStagingKey(attempt, attempt.id, "RECTIFIED"))!);
  const destination = preparationArtifactKey(attempt, attempt.id, "RECTIFIED", sha256);
  storage.objects.set(destination, Buffer.from("conflicting existing object"));
  await assert.rejects(verifyAndFreezeSpeedsterPreparation(attempt, response, storage), /cannot be overwritten/);
  assert.equal(storage.objects.get(destination)?.toString(), "conflicting existing object");
  assert.ok(!storage.writes.includes(destination));
});

test("preparation bytes: a create-only collision is re-read and accepted only for identical bytes", async () => {
  const { storage, attempt, response } = await preparedFixture();
  storage.beforeCreate = (key, bytes) => { storage.objects.set(key, Buffer.from(bytes)); };
  const body = await verifyAndFreezeSpeedsterPreparation(attempt, response, storage);
  await verifySpeedsterPreparationManifestBytes(body, storage);
  const other = await preparedFixture();
  other.storage.beforeCreate = (key) => { other.storage.objects.set(key, Buffer.from("different concurrent write")); };
  await assert.rejects(verifyAndFreezeSpeedsterPreparation(other.attempt, other.response, other.storage), /exact-byte verification/);
});

for (const issue of ["missing", "truncated", "dimensions", "format", "transform", "frame", "release", "source", "worker-attempt", "worker-source", "worker-dimensions"] as const) {
  test(`preparation bytes: ${issue} failure creates no accepted outputs`, async () => {
    const { storage, attempt, response } = await preparedFixture();
    const key = preparationStagingKey(attempt, attempt.id, "NORMALIZED");
    if (issue === "missing") storage.objects.delete(key);
    if (issue === "truncated") storage.objects.set(key, storage.objects.get(key)!.subarray(0, 40));
    if (issue === "dimensions") storage.objects.set(key, (await images)[1]);
    if (issue === "format") storage.objects.set(key, await sharp((await images)[2]).png().toBuffer());
    if (issue === "transform") response.transform[2] += 1;
    if (issue === "frame") response.inspectionFrame.cardBounds.x = 0;
    if (issue === "release") response.preparationIdentity = { ...response.preparationIdentity, sourceCommitSha: "f".repeat(40) };
    if (issue === "source") storage.objects.set(attempt.input.source.storageKey, Buffer.from("changed frozen source"));
    if (issue === "worker-attempt") response.preparationEvidence.attemptId = randomUUID();
    if (issue === "worker-source") response.preparationEvidence.source.sha256 = "e".repeat(64);
    if (issue === "worker-dimensions") response.preparationEvidence.source.width += 1;
    await assert.rejects(verifyAndFreezeSpeedsterPreparation(attempt, response, storage));
    assert.equal(storage.writes.length, 1, "only the earlier source snapshot exists");
  });
}

test("preparation bytes: encoded source-generation checksum and owner/side replay are rejected", async () => {
  const storage = new FixturePreparationStorage();
  const key = `ai-grader-v2/${fixturePreparationScope.createdByUserId}/${fixturePreparationScope.sessionId}/original/iphone-v2-sha256-${"f".repeat(64)}/front.jpg`;
  storage.objects.set(key, (await images)[0]);
  await assert.rejects(freezeSpeedsterPreparationSource(fixturePreparationScope, key, storage), /checksum/);
  await assert.rejects(freezeSpeedsterPreparationSource({ ...fixturePreparationScope, side: "BACK" }, key, storage), /owned preparation side/);
  assert.equal(storage.writes.length, 0);
});

for (const orientation of [1, 2, 3, 4, 5, 6, 7, 8]) {
  test(`preparation bytes: JPEG EXIF orientation ${orientation} preserves raw bytes and displayed dimensions`, async () => {
    const storage = new FixturePreparationStorage();
    const key = fixturePreparationInput().source.originalStorageKey;
    const bytes = await sharp((await images)[0]).withMetadata({ orientation }).jpeg().toBuffer();
    storage.objects.set(key, bytes);
    const frozen = await freezeSpeedsterPreparationSource(fixturePreparationScope, key, storage);
    assert.equal(frozen.orientation, orientation);
    assert.equal(frozen.width, orientation >= 5 ? 1000 : 800);
    assert.equal(frozen.height, orientation >= 5 ? 800 : 1000);
    assert.deepEqual(storage.objects.get(frozen.storageKey), bytes);
  });
}

test("preparation bytes: oriented WebP is rejected before source creation or worker dispatch", async () => {
  for (const orientation of [2, 3, 4, 5, 6, 7, 8]) {
    const storage = new FixturePreparationStorage();
    const key = fixturePreparationInput().source.originalStorageKey.replace(/\.jpg$/, ".webp");
    storage.objects.set(key, await sharp((await images)[0]).withMetadata({ orientation }).webp().toBuffer());
    await assert.rejects(freezeSpeedsterPreparationSource(fixturePreparationScope, key, storage), /unsupported orientation/);
    assert.equal(storage.writes.length, 0);
  }
});

test("preparation storage adapter: final PUT is private, checksum-bound and conditional", async () => {
  const bytes = (await images)[1];
  const hash = preparationBytesHash(bytes);
  const key = preparationArtifactKey(fixturePreparationScope, randomUUID(), "RECTIFIED", hash);
  let calls = 0;
  await createPrivatePreparationEvidenceBuffer(key, bytes, "image/webp", hash, { storageMode: "s3", sendS3: async (command) => {
    calls += 1;
    assert.equal(command.input.IfNoneMatch, "*");
    assert.equal(command.input.ACL, "private");
    assert.equal(command.input.ChecksumSHA256, Buffer.from(hash, "hex").toString("base64"));
    assert.equal(command.input.Body, bytes);
  } });
  assert.equal(calls, 1);
  await assert.rejects(createPrivatePreparationEvidenceBuffer(key, Buffer.from("substituted"), "image/webp", hash, { storageMode: "s3", sendS3: async () => { calls += 1; } }), /exact bytes/);
  assert.equal(calls, 1);
  assert.throws(() => createPrivateSpeedsterUploadCommand({ storageKey: key, contentType: "image/webp" }, "fixture-bucket"), /create-only/);
  await assert.rejects(presignUploadUrl(key, "image/webp"), /create-only/);
  await assert.rejects(uploadPrivateChecksumBuffer(key, bytes, "image/webp", { checksumSha256: hash }), /create-only/);
});

test("preparation local adapter: dot aliases and ordinary writes cannot overwrite accepted bytes", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "atlas-preparation-local-"));
  try {
    execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
      import assert from 'node:assert/strict';
      import { createHash } from 'node:crypto';
      import storage from './lib/server/storage.ts';
      const bytes = Buffer.from('disposable exact bytes');
      const hash = createHash('sha256').update(bytes).digest('hex');
      const key = 'ai-grader-v2/fixture-owner/fixture-session/source-evidence/' + hash + '.jpg';
      await storage.createPrivatePreparationEvidenceBuffer(key, bytes, 'image/jpeg', hash);
      await assert.rejects(storage.createPrivatePreparationEvidenceBuffer(key, bytes, 'image/jpeg', hash), { code: 'EEXIST' });
      for (const alias of [key, key.replace('/source-evidence/', '/tmp/../source-evidence/'), key.replace('/source-evidence/', '/tmp/%2e%2e/source-evidence/')]) {
        await assert.rejects(storage.writeLocalFile(alias, Buffer.from('overwrite')), /create-only/);
        await assert.rejects(storage.uploadBuffer(alias, Buffer.from('overwrite'), 'image/jpeg'), /create-only/);
      }
      assert.deepEqual(await storage.readStorageBufferBounded(key), bytes);
    `], { cwd: process.cwd(), env: { ...process.env, CARD_STORAGE_MODE: "local", CARD_STORAGE_LOCAL_ROOT: directory }, stdio: "pipe" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
