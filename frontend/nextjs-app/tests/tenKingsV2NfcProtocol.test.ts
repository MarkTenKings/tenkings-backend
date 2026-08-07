import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import {
  TEN_KINGS_V2_NFC_JOB_SCHEMA,
  TEN_KINGS_V2_NFC_MAX_JOB_TTL_MS,
  assertTenKingsV2NfcJobMayStart,
  createTenKingsV2NfcResult,
  decideTenKingsV2NfcVerificationWrite,
  issueTenKingsV2NfcJob,
  tenKingsV2NfcJobCanonicalStatement,
  tenKingsV2NfcKeyId,
  tenKingsV2NfcResultCanonicalStatement,
  verifyTenKingsV2NfcCompletion,
  verifyTenKingsV2NfcJob,
  type TenKingsV2NfcSignedJob,
} from "../lib/server/tenKingsV2NfcProtocol";

const TOKEN = `tk2c_${"A".repeat(32)}`;
const OTHER_TOKEN = `tk2c_${"B".repeat(32)}`;
const ISSUED_AT = new Date("2026-08-06T20:00:00.000Z");
const NONCE = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function keyPair() {
  return generateKeyPairSync("ec", { namedCurve: "prime256v1" });
}

function tamperCanonicalSignature(signature: string) {
  const bytes = Buffer.from(signature, "base64url");
  bytes[0] ^= 1;
  return bytes.toString("base64url");
}

function fixture() {
  const server = keyPair();
  const workstation = keyPair();
  const job = issueTenKingsV2NfcJob({
    cardId: "card-v2.001",
    publicToken: TOKEN,
    privateKey: server.privateKey,
    now: ISSUED_AT,
    ttlMs: 10 * 60 * 1000,
    nonce: NONCE,
  });
  const result = createTenKingsV2NfcResult({
    job,
    trustedJobSigningKeys: { [tenKingsV2NfcKeyId(server.publicKey)]: server.publicKey },
    workstationPrivateKey: workstation.privateKey,
    readbackPayloadSha256: "a".repeat(64),
    observedAt: "2026-08-06T20:04:00.000Z",
  });
  return { server, workstation, job, result };
}

test("V2 job is domain-separated, exact, signed, and start-window bounded", () => {
  const { server, job } = fixture();
  const keyId = tenKingsV2NfcKeyId(server.publicKey);
  assert.equal(job.schemaVersion, TEN_KINGS_V2_NFC_JOB_SCHEMA);
  assert.equal(job.signingKeyId, keyId);
  assert.equal(job.url, `https://collect.tenkings.co/c/${TOKEN}`);
  assert.equal(tenKingsV2NfcJobCanonicalStatement(job), [
    "ten-kings-v2-nfc-job-v1",
    "ecdsa-p256-sha256-p1363",
    keyId,
    "program-permanent-card-url",
    NONCE,
    "card-v2.001",
    TOKEN,
    `https://collect.tenkings.co/c/${TOKEN}`,
    "FEIJU_F8215",
    "static_url_v1",
    "gototags_manual_start_v1",
    "2026-08-06T20:00:00.000Z",
    "2026-08-06T20:10:00.000Z",
  ].join("\n"));
  assert.deepEqual(verifyTenKingsV2NfcJob(job, { [keyId]: server.publicKey }), job);
  assert.deepEqual(assertTenKingsV2NfcJobMayStart(job, new Date("2026-08-06T20:09:59.999Z")), job);
  assert.throws(
    () => assertTenKingsV2NfcJobMayStart(job, new Date("2026-08-06T20:10:00.001Z")),
    /expired before it started/,
  );
});

test("V2 job rejects tamper, unknown fields, wrong key, URLs, tokens, profiles, and excessive lifetime", () => {
  const { server, job } = fixture();
  const other = keyPair();
  const keyId = tenKingsV2NfcKeyId(server.publicKey);
  const trusted = { [keyId]: server.publicKey };
  const cases: unknown[] = [
    { ...job, cardId: "card-v2.002" },
    { ...job, publicToken: OTHER_TOKEN },
    { ...job, url: `https://collect.tenkings.co/c/${TOKEN}/` },
    { ...job, url: `https://COLLECT.tenkings.co/c/${TOKEN}` },
    { ...job, url: `https://collect.tenkings.co:443/c/${TOKEN}` },
    { ...job, url: `https://collect.tenkings.co/c/${TOKEN}?x=1` },
    { ...job, chipType: "NTAG215" },
    { ...job, programmingProfile: "ntag215_direct_pcsc_v1" },
    { ...job, nonce: `${NONCE}\n` },
    { ...job, extra: "not allowed" },
    { ...job, signingKeyId: tenKingsV2NfcKeyId(other.publicKey) },
    { ...job, signature: tamperCanonicalSignature(job.signature) },
    { ...job, expiresAt: new Date(ISSUED_AT.getTime() + TEN_KINGS_V2_NFC_MAX_JOB_TTL_MS + 1).toISOString() },
  ];
  for (const candidate of cases) assert.throws(() => verifyTenKingsV2NfcJob(candidate, trusted));
  assert.throws(
    () => verifyTenKingsV2NfcJob(job, { [keyId]: other.publicKey }),
    /mislabeled/,
  );
  assert.throws(() => verifyTenKingsV2NfcJob(job, {}), /not trusted/);
});

test("V2 job trust supports staged current and prior signing-key rotation", () => {
  const current = keyPair();
  const prior = keyPair();
  const currentJob = issueTenKingsV2NfcJob({
    cardId: "card-v2.current",
    publicToken: TOKEN,
    privateKey: current.privateKey,
    now: ISSUED_AT,
    nonce: NONCE,
  });
  const priorJob = issueTenKingsV2NfcJob({
    cardId: "card-v2.prior",
    publicToken: OTHER_TOKEN,
    privateKey: prior.privateKey,
    now: ISSUED_AT,
    nonce: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
  });
  const currentKeyId = tenKingsV2NfcKeyId(current.publicKey);
  const priorKeyId = tenKingsV2NfcKeyId(prior.publicKey);
  const stagedTrust = {
    [currentKeyId]: current.publicKey,
    [priorKeyId]: prior.publicKey,
  };
  assert.deepEqual(verifyTenKingsV2NfcJob(currentJob, stagedTrust), currentJob);
  assert.deepEqual(verifyTenKingsV2NfcJob(priorJob, stagedTrust), priorJob);
  assert.throws(() => verifyTenKingsV2NfcJob(priorJob, { [currentKeyId]: current.publicKey }), /not trusted/);
});

test("V2 terminal result binds the exact signed job and excludes UID authority", () => {
  const { server, workstation, job, result } = fixture();
  const serverKeyId = tenKingsV2NfcKeyId(server.publicKey);
  const workstationKeyId = tenKingsV2NfcKeyId(workstation.publicKey);
  assert.deepEqual(verifyTenKingsV2NfcCompletion({
    job,
    result,
    trustedJobSigningKeys: { [serverKeyId]: server.publicKey },
    trustedWorkstationKeys: { [workstationKeyId]: workstation.publicKey },
  }), { job, result });
  const serialized = JSON.stringify(result).toLowerCase();
  assert.equal(serialized.includes("uid"), false);
  assert.equal(serialized.includes("attempt"), false);
  assert.match(tenKingsV2NfcResultCanonicalStatement(result), /permanently_read_only_verified/);
  assert.match(tenKingsV2NfcResultCanonicalStatement(result), /write_locked_verified_gototags_readback/);
});

test("server completion composition cannot skip server-job verification", () => {
  const { server, workstation, job, result } = fixture();
  const serverKeyId = tenKingsV2NfcKeyId(server.publicKey);
  const workstationKeyId = tenKingsV2NfcKeyId(workstation.publicKey);
  assert.throws(() => verifyTenKingsV2NfcCompletion({
    job,
    result,
    trustedJobSigningKeys: {},
    trustedWorkstationKeys: { [workstationKeyId]: workstation.publicKey },
  }), /job signing key is not trusted/i);
  const forgedJob = { ...job, signature: tamperCanonicalSignature(job.signature) };
  assert.throws(() => verifyTenKingsV2NfcCompletion({
    job: forgedJob,
    result,
    trustedJobSigningKeys: { [serverKeyId]: server.publicKey },
    trustedWorkstationKeys: { [workstationKeyId]: workstation.publicKey },
  }), /job signature is invalid/i);
});

test("V2 terminal result rejects substitution, profile tamper, untrusted workstation, and out-of-window evidence", () => {
  const { server, workstation, job, result } = fixture();
  const serverKeyId = tenKingsV2NfcKeyId(server.publicKey);
  const workstationKeyId = tenKingsV2NfcKeyId(workstation.publicKey);
  const trustedServer = { [serverKeyId]: server.publicKey };
  const trusted = { [workstationKeyId]: workstation.publicKey };
  const other = keyPair();
  const otherJob = issueTenKingsV2NfcJob({
    cardId: "card-v2.002",
    publicToken: OTHER_TOKEN,
    privateKey: other.privateKey,
    now: ISSUED_AT,
    nonce: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
  });
  for (const candidate of [
    { ...result, cardId: "card-v2.002" },
    { ...result, url: `https://collect.tenkings.co/c/${OTHER_TOKEN}` },
    { ...result, readerModel: "unknown_reader" },
    { ...result, adapterVersion: "4.38.0.0" },
    { ...result, writeProtectionState: "unlocked" },
    { ...result, readbackPayloadSha256: "b".repeat(64) },
    { ...result, uidFingerprintSha256: "c".repeat(64) },
  ]) {
    assert.throws(() => verifyTenKingsV2NfcCompletion({
      job,
      result: candidate,
      trustedJobSigningKeys: trustedServer,
      trustedWorkstationKeys: trusted,
    }));
  }
  const otherServerKeyId = tenKingsV2NfcKeyId(other.publicKey);
  assert.throws(() => verifyTenKingsV2NfcCompletion({
    job: otherJob,
    result,
    trustedJobSigningKeys: { [otherServerKeyId]: other.publicKey },
    trustedWorkstationKeys: trusted,
  }), /does not match/);
  assert.throws(() => verifyTenKingsV2NfcCompletion({
    job,
    result,
    trustedJobSigningKeys: trustedServer,
    trustedWorkstationKeys: {},
  }), /not allowlisted/);
  assert.throws(
    () => createTenKingsV2NfcResult({
      job,
      trustedJobSigningKeys: trustedServer,
      workstationPrivateKey: workstation.privateKey,
      readbackPayloadSha256: "a".repeat(64),
      observedAt: "2026-08-06T20:10:00.001Z",
    }),
    /inside its signed job window/,
  );
});

test("completed-in-window evidence remains verifiable after hosted receipt delay", () => {
  const { server, workstation, job, result } = fixture();
  const serverKeyId = tenKingsV2NfcKeyId(server.publicKey);
  const workstationKeyId = tenKingsV2NfcKeyId(workstation.publicKey);
  assert.doesNotThrow(() => verifyTenKingsV2NfcCompletion({
    job,
    result,
    trustedJobSigningKeys: { [serverKeyId]: server.publicKey },
    trustedWorkstationKeys: { [workstationKeyId]: workstation.publicKey },
  }));
  assert.throws(
    () => assertTenKingsV2NfcJobMayStart(job, new Date("2026-08-07T20:00:00.000Z")),
    /expired/,
  );
});

test("three-field persistence decision uses server verification time without stale overwrite", () => {
  assert.equal(decideTenKingsV2NfcVerificationWrite({
    jobIssuedAt: "2026-08-06T20:00:00.000Z",
    existingNfcVerifiedAt: null,
  }), "WRITE_SERVER_TRANSACTION_TIME");
  assert.equal(decideTenKingsV2NfcVerificationWrite({
    jobIssuedAt: "2026-08-06T20:00:00.000Z",
    existingNfcVerifiedAt: "2026-08-06T20:05:00.000Z",
  }), "NOOP_REPLAY_OR_STALE_JOB");
  assert.equal(decideTenKingsV2NfcVerificationWrite({
    jobIssuedAt: "2026-08-06T20:06:00.000Z",
    existingNfcVerifiedAt: "2026-08-06T20:05:00.000Z",
  }), "WRITE_SERVER_TRANSACTION_TIME");
});
