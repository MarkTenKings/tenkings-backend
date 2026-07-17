#!/usr/bin/env node

import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";
import { createRequire } from "node:module";
import { sanitizeAiGraderNfcValidationOutput } from "./aiGraderNfcValidationRedaction.mjs";
import {
  assertDisposableDatabaseTarget,
  requireValidationProof,
} from "./aiGraderNfcValidationSafety.mjs";

const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");
const {
  buildAiGraderPublishAuthorityRecord,
} = require("../dist/database/src/aiGraderProductionService");
const {
  AI_GRADER_NFC_ATTESTATION_ALGORITHM,
  AI_GRADER_NFC_ATTESTATION_SCHEMA_VERSION,
  AI_GRADER_NFC_ATTESTATION_SCHEMA_VERSION_V2,
  AI_GRADER_NFC_EXPECTED_HELPER_PROTOCOL_VERSION,
  AI_GRADER_NFC_FEIJU_PROGRAMMING_PROFILE,
  AI_GRADER_NFC_FEIJU_FRESH_INVENTORY_CONFIRMATION,
  AI_GRADER_NFC_FEIJU_READER_RESULT,
  AI_GRADER_NFC_FEIJU_WRITE_PROTECTION_STATE,
  AI_GRADER_NFC_GOTOTAGS_ADAPTER_IDENTITY,
  AI_GRADER_NFC_GOTOTAGS_APPROVED_VERSION,
  buildAiGraderNfcOperationalAttestationStatement,
  completeAiGraderNfcProgramming,
  getAiGraderNfcStatus,
  initAiGraderNfcProgramming,
  replaceAiGraderNfcTag,
  revokeAiGraderNfcTag,
} = require("../dist/database/src/aiGraderNfcService");

const EXPECTED_DATABASE = "tenkings_ai_grader_nfc_validation";
const EXPECTED_USER = "tenkings_nfc_validation";
const TENANT_ID = "nfc-validation-tenant";
const ACTOR_ID = "nfc-validation-user";
const NOW = new Date("2026-07-13T12:00:00.000Z");
const linkage = {
  tenantId: TENANT_ID,
  reportId: "nfc-service-validation-report",
  cardAssetId: "nfc-service-validation-card",
  itemId: "nfc-service-validation-item",
  certId: "NFC-SERVICE-VALIDATION-CERT",
};

function requireProof(condition, code) {
  requireValidationProof(condition, `REAL_SERVICE_${code}`);
}

async function requireRejectionCode(promise, expectedCode, proofCode) {
  let observedCode = "";
  try {
    await promise;
  } catch (error) {
    observedCode = typeof error?.code === "string" ? error.code : "";
  }
  requireProof(observedCode === expectedCode, proofCode);
}

function assertDisposableDatabase() {
  assertDisposableDatabaseTarget({
    acknowledgement: process.env.AI_GRADER_NFC_DISPOSABLE_VALIDATION,
    databaseUrl: process.env.DATABASE_URL,
    expectedUser: EXPECTED_USER,
    expectedDatabase: EXPECTED_DATABASE,
  });
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function workstation() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const publicDer = publicKey.export({ format: "der", type: "spki" });
  const keyId = createHash("sha256").update(publicDer).digest("hex");
  return {
    keyId,
    privateKey,
    allowlist: JSON.stringify({
      [keyId]: {
        tenantId: TENANT_ID,
        algorithm: AI_GRADER_NFC_ATTESTATION_ALGORITHM,
        publicSpkiDerBase64: publicDer.toString("base64"),
      },
    }),
  };
}

function signedCompletion(init, runtime, station, profile = "NTAG215") {
  requireProof(typeof init.attemptId === "string" && init.attemptId.length > 0, "INIT_ATTEMPT_ID_MISSING");
  requireProof(typeof init.attemptToken === "string" && /^[A-Za-z0-9_-]{43}$/.test(init.attemptToken), "INIT_ATTEMPT_TOKEN_INVALID");
  requireProof(typeof init.attestationChallenge === "string" && /^[A-Za-z0-9_-]{43}$/.test(init.attestationChallenge), "INIT_CHALLENGE_INVALID");
  requireProof(typeof init.publicTagId === "string" && init.publicTagId.length > 0, "INIT_PUBLIC_TAG_ID_MISSING");
  requireProof(typeof init.expectedNdefUrl === "string" && init.expectedNdefUrl.length > 0, "INIT_NDEF_URL_MISSING");
  const observedAt = new Date(NOW.getTime() + 5_000).toISOString();
  const uidFingerprintSha256 = sha256("disposable-fake-reader-uid-fingerprint");
  const readbackPayloadSha256 = sha256(init.expectedNdefUrl);
  const feiju = profile === "FEIJU_F8215";
  const readerResultCode = feiju ? AI_GRADER_NFC_FEIJU_READER_RESULT : "write_verified_pcsc_readback";
  const schemaVersion = feiju ? AI_GRADER_NFC_ATTESTATION_SCHEMA_VERSION_V2 : AI_GRADER_NFC_ATTESTATION_SCHEMA_VERSION;
  const profileEvidence = feiju ? {
    chipType: "FEIJU_F8215",
    securityMode: "static_url_v1",
    programmingProfile: AI_GRADER_NFC_FEIJU_PROGRAMMING_PROFILE,
    adapterIdentity: AI_GRADER_NFC_GOTOTAGS_ADAPTER_IDENTITY,
    adapterVersion: AI_GRADER_NFC_GOTOTAGS_APPROVED_VERSION,
    writeProtectionState: AI_GRADER_NFC_FEIJU_WRITE_PROTECTION_STATE,
  } : {};
  const statement = buildAiGraderNfcOperationalAttestationStatement({
    schemaVersion,
    attemptId: init.attemptId,
    attestationChallenge: init.attestationChallenge,
    publicTagId: init.publicTagId,
    normalizedUrl: init.expectedNdefUrl,
    uidFingerprintSha256,
    readbackPayloadSha256,
    readerResultCode,
    helperProtocolVersion: AI_GRADER_NFC_EXPECTED_HELPER_PROTOCOL_VERSION,
    observedAt,
    ...profileEvidence,
  });
  const signature = sign("sha256", Buffer.from(statement, "utf8"), {
    key: station.privateKey,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  requireProof(/^[A-Za-z0-9_-]{86}$/.test(signature), "ATTESTATION_SIGNATURE_INVALID");
  return {
    ...linkage,
    ...runtime,
    requestedByUserId: ACTOR_ID,
    attemptId: init.attemptId,
    attemptToken: init.attemptToken,
    publicTagId: init.publicTagId,
    uidFingerprintSha256,
    normalizedNdefUrl: init.expectedNdefUrl,
    readbackPayloadSha256,
    chipType: feiju ? "FEIJU_F8215" : "NTAG215",
    securityMode: "static_url_v1",
    programmingProfile: feiju ? AI_GRADER_NFC_FEIJU_PROGRAMMING_PROFILE : "ntag215_direct_pcsc_v1",
    ...(feiju ? {
      adapterIdentity: AI_GRADER_NFC_GOTOTAGS_ADAPTER_IDENTITY,
      adapterVersion: AI_GRADER_NFC_GOTOTAGS_APPROVED_VERSION,
      writeProtectionState: AI_GRADER_NFC_FEIJU_WRITE_PROTECTION_STATE,
    } : {}),
    idempotencyKey: "service-validation-complete",
    readerResultCode,
    helperProtocolVersion: AI_GRADER_NFC_EXPECTED_HELPER_PROTOCOL_VERSION,
    operationalAttestation: {
      schemaVersion,
      workstationKeyId: station.keyId,
      algorithm: AI_GRADER_NFC_ATTESTATION_ALGORITHM,
      attestationChallenge: init.attestationChallenge,
      observedAt,
      signature,
    },
    now: new Date(NOW.getTime() + 5_000),
  };
}

async function seedPublishedAuthority(prisma) {
  const authority = buildAiGraderPublishAuthorityRecord({
    reportBundle: {
      reportId: linkage.reportId,
      gradingSessionId: "nfc-service-validation-grading-session",
    },
    productionRelease: {
      reportId: linkage.reportId,
      gradingSessionId: "nfc-service-validation-grading-session",
      finalGrade: { overall: 9.2 },
      label: { reportId: linkage.reportId, certId: linkage.certId },
    },
  });

  await prisma.$transaction(async (tx) => {
    await tx.user.create({
      data: { id: ACTOR_ID, role: "admin", createdAt: NOW },
    });
    await tx.cardBatch.create({
      data: {
        id: "nfc-service-validation-batch",
        uploadedById: ACTOR_ID,
        totalCount: 1,
        processedCount: 1,
        status: "READY",
        createdAt: NOW,
        updatedAt: NOW,
      },
    });
    await tx.cardAsset.create({
      data: {
        id: linkage.cardAssetId,
        batchId: "nfc-service-validation-batch",
        storageKey: "validation/nfc-service-card",
        fileName: "nfc-service-card.jpg",
        fileSize: 1,
        mimeType: "image/jpeg",
        imageUrl: "https://invalid.local/nfc-service-card.jpg",
        status: "READY",
        classificationSourcesJson: { aiGraderPublishAuthority: authority },
        aiGradingJson: { publishAuthority: authority },
        createdAt: NOW,
        updatedAt: NOW,
      },
    });
    await tx.item.create({
      data: {
        id: linkage.itemId,
        name: "Disposable NFC service validation card",
        set: "Disposable NFC service validation set",
        number: linkage.cardAssetId,
        ownerId: ACTOR_ID,
        createdAt: NOW,
        updatedAt: NOW,
      },
    });
    await tx.aiGraderSession.create({
      data: {
        id: "nfc-service-validation-session",
        tenantId: TENANT_ID,
        gradingSessionId: "nfc-service-validation-grading-session",
        reportId: linkage.reportId,
        cardAssetId: linkage.cardAssetId,
        itemId: linkage.itemId,
        status: "published",
        cardIdentity: {
          source: "card_asset",
          status: "linked",
          cardAssetId: linkage.cardAssetId,
          itemId: linkage.itemId,
        },
        createdAt: NOW,
        updatedAt: NOW,
      },
    });
    await tx.aiGraderReport.create({
      data: {
        id: "nfc-service-validation-report-row",
        tenantId: TENANT_ID,
        sessionId: "nfc-service-validation-session",
        reportId: linkage.reportId,
        reportStatus: "finalized",
        finalGradeStatus: "computed",
        visibilityStatus: "public",
        publicationStatus: "published",
        cardAssetId: linkage.cardAssetId,
        itemId: linkage.itemId,
        finalOverallGrade: 9.2,
        finalizedAt: NOW,
        publishedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      },
    });
    await tx.aiGraderLabel.create({
      data: {
        id: "nfc-service-validation-label",
        tenantId: TENANT_ID,
        sessionId: "nfc-service-validation-session",
        reportId: "nfc-service-validation-report-row",
        certId: linkage.certId,
        qrPayloadUrl: "https://invalid.local/qr/nfc-service",
        publicReportUrl: "https://invalid.local/report/nfc-service",
        labelGradeText: "9.2",
        payload: { validation: true },
        createdAt: NOW,
        updatedAt: NOW,
      },
    });
    await tx.aiGraderPublication.create({
      data: {
        id: "nfc-service-validation-publication",
        tenantId: TENANT_ID,
        reportId: "nfc-service-validation-report-row",
        status: "published",
        publishedByUserId: ACTOR_ID,
        publishedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      },
    });
  });
}

async function main() {
  assertDisposableDatabase();
  const prisma = new PrismaClient();
  const station = workstation();
  const runtime = {
    dbClient: prisma,
    programmingEnabled: true,
    tokenSecret: randomBytes(48).toString("base64url"),
    workstationPublicKeysJson: station.allowlist,
    feijuF8215Enabled: true,
    attemptTtlMs: 60_000,
  };

  try {
    await seedPublishedAuthority(prisma);
    const reserveInput = {
      ...linkage,
      ...runtime,
      requestedByUserId: ACTOR_ID,
      idempotencyKey: "service-validation-reserve",
      now: NOW,
    };
    let releaseReportLock = () => {};
    let reportLockAcquired = () => {};
    const reportLockAcquiredPromise = new Promise((resolve) => {
      reportLockAcquired = resolve;
    });
    const reportLockReleasePromise = new Promise((resolve) => {
      releaseReportLock = resolve;
    });
    const reportLockHolder = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT 1 AS "lockAcquired"
        FROM pg_advisory_xact_lock(hashtext('ai-grader-report-lifecycle'), hashtext(${linkage.reportId}))
      `;
      reportLockAcquired();
      await reportLockReleasePromise;
    });
    await reportLockAcquiredPromise;
    let reserveSettled = false;
    let reserveError;
    const concurrentReserve = Promise.all([
      initAiGraderNfcProgramming(reserveInput),
      initAiGraderNfcProgramming(reserveInput),
    ]).catch((error) => {
      reserveError = error;
      return [];
    }).finally(() => {
      reserveSettled = true;
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 150));
      requireProof(!reserveSettled, "REPORT_ADVISORY_LOCK_NOT_ENFORCED");
    } finally {
      releaseReportLock();
    }
    await reportLockHolder;
    const reserveResults = await concurrentReserve;
    if (reserveError) throw reserveError;
    requireProof(reserveResults.length === 2, "CONCURRENT_INIT_RESULT_COUNT");
    const [first, concurrentRetry] = reserveResults;
    requireProof(first.status === "programming", "INIT_STATUS");
    requireProof(concurrentRetry.attemptId === first.attemptId, "INIT_ATTEMPT_ID_IDEMPOTENCY");
    requireProof(concurrentRetry.publicTagId === first.publicTagId, "INIT_PUBLIC_TAG_ID_IDEMPOTENCY");
    requireProof(
      typeof concurrentRetry.attemptToken === "string" &&
        typeof first.attemptToken === "string" &&
        sha256(concurrentRetry.attemptToken) === sha256(first.attemptToken),
      "INIT_ATTEMPT_TOKEN_IDEMPOTENCY",
    );
    requireProof((await prisma.aiGraderNfcTag.count()) === 1, "INIT_TAG_COUNT");
    requireProof((await prisma.aiGraderNfcProgrammingAttempt.count()) === 1, "INIT_ATTEMPT_COUNT");

    const persistedAttempt = await prisma.aiGraderNfcProgrammingAttempt.findUniqueOrThrow({
      where: { id: first.attemptId },
    });
    requireProof(
      typeof first.attemptToken === "string" &&
        /^[a-f0-9]{64}$/.test(persistedAttempt.tokenHash) &&
        persistedAttempt.tokenHash === sha256(first.attemptToken),
      "PERSISTED_TOKEN_HASH",
    );

    const completionInput = signedCompletion(first, runtime, station);
    const [active, activeRetry] = await Promise.all([
      completeAiGraderNfcProgramming(completionInput),
      completeAiGraderNfcProgramming(completionInput),
    ]);
    requireProof(active.status === "active" && activeRetry.status === "active", "CONCURRENT_COMPLETE_STATUS");
    requireProof(active.registrationKind === "registered_link", "COMPLETE_REGISTRATION_KIND");
    requireProof(active.cryptographicallyVerified === false, "COMPLETE_CRYPTOGRAPHIC_SEMANTICS");

    const status = await getAiGraderNfcStatus({ ...linkage, dbClient: prisma });
    requireProof(status.status === "active", "STATUS_ACTIVE");
    requireProof(!Object.hasOwn(status, "uidFingerprintSha256"), "STATUS_UID_REDACTION");

    const replaceInput = {
      ...linkage,
      ...runtime,
      requestedByUserId: ACTOR_ID,
      replacedPublicTagId: first.publicTagId,
      revocationReason: "Disposable validation replacement",
      idempotencyKey: "service-validation-replace",
      chipType: "FEIJU_F8215",
      programmingProfile: AI_GRADER_NFC_FEIJU_PROGRAMMING_PROFILE,
      operatorFreshInventoryConfirmation: AI_GRADER_NFC_FEIJU_FRESH_INVENTORY_CONFIRMATION,
      now: new Date(NOW.getTime() + 15_000),
    };
    const [replacement, replacementRetry] = await Promise.all([
      replaceAiGraderNfcTag(replaceInput),
      replaceAiGraderNfcTag(replaceInput),
    ]);
    requireProof(replacement.status === "programming", "CONCURRENT_REPLACEMENT_STATUS");
    requireProof(replacement.publicTagId !== first.publicTagId, "REPLACEMENT_PUBLIC_TAG_ID");
    requireProof(replacementRetry.attemptId === replacement.attemptId, "REPLACEMENT_ATTEMPT_ID_IDEMPOTENCY");
    requireProof(replacementRetry.publicTagId === replacement.publicTagId, "REPLACEMENT_PUBLIC_TAG_ID_IDEMPOTENCY");
    const replacedTag = await prisma.aiGraderNfcTag.findUniqueOrThrow({ where: { publicTagId: first.publicTagId } });
    requireProof(replacedTag.status === "revoked", "ATOMIC_ACTIVE_REVOKE_BEFORE_REPLACEMENT");
    requireProof((await prisma.aiGraderNfcTag.count()) === 2, "REPLACEMENT_TAG_COUNT");
    requireProof(
      (await prisma.aiGraderNfcTag.count({
        where: { status: { in: ["reserved", "programming", "verified", "active"] } },
      })) === 1,
      "REPLACEMENT_OPEN_TAG_COUNT",
    );

    requireProof(replacement.chipType === "FEIJU_F8215", "REPLACEMENT_FEIJU_CHIP_TYPE");
    requireProof(replacement.programmingProfile === AI_GRADER_NFC_FEIJU_PROGRAMMING_PROFILE, "REPLACEMENT_FEIJU_PROFILE");
    const replacementCompletion = signedCompletion(replacement, runtime, station, "FEIJU_F8215");
    const [replacementActive, replacementActiveRetry] = await Promise.all([
      completeAiGraderNfcProgramming(replacementCompletion),
      completeAiGraderNfcProgramming(replacementCompletion),
    ]);
    requireProof(
      replacementActive.status === "active" && replacementActiveRetry.status === "active",
      "REPLACEMENT_CONCURRENT_COMPLETE_STATUS",
    );
    const revokeInput = {
      ...linkage,
      requestedByUserId: ACTOR_ID,
      publicTagId: replacement.publicTagId,
      reason: "Disposable validation concurrent revocation",
      idempotencyKey: "service-validation-revoke",
      dbClient: prisma,
      now: new Date(NOW.getTime() + 25_000),
    };
    const [revoked, revokedRetry] = await Promise.all([
      revokeAiGraderNfcTag(revokeInput),
      revokeAiGraderNfcTag(revokeInput),
    ]);
    requireProof(revoked.status === "revoked" && revokedRetry.status === "revoked", "CONCURRENT_REVOKE_STATUS");

    const expiringReplaceInput = {
      ...replaceInput,
      replacedPublicTagId: replacement.publicTagId,
      idempotencyKey: "service-validation-expiring-replace",
      now: new Date(NOW.getTime() + 30_000),
    };
    const expiringReplacement = await replaceAiGraderNfcTag(expiringReplaceInput);
    await requireRejectionCode(
      replaceAiGraderNfcTag({
        ...expiringReplaceInput,
        now: new Date(NOW.getTime() + 100_000),
      }),
      "AI_GRADER_NFC_ATTEMPT_EXPIRED",
      "REPLACEMENT_EXPIRY_CODE",
    );
    const expiredAttempt = await prisma.aiGraderNfcProgrammingAttempt.findUniqueOrThrow({
      where: { id: expiringReplacement.attemptId },
    });
    requireProof(expiredAttempt.state === "expired", "REPLACEMENT_ATTEMPT_EXPIRED_STATE");
    const replacementTag = await prisma.aiGraderNfcTag.findUniqueOrThrow({
      where: { publicTagId: expiringReplacement.publicTagId },
    });
    requireProof(replacementTag.status === "reserved", "REPLACEMENT_TAG_RECOVERY_STATE");

    const auditActions = await prisma.aiGraderNfcAuditEvent.findMany({
      select: { action: true },
    });
    const actions = new Set(auditActions.map((entry) => entry.action));
    for (const expected of [
      "reserve",
      "programming_attempt_initialized",
      "local_pcsc_readback_verified",
      "local_gototags_readback_lock_verified",
      "activate_registered_link",
      "revoke",
      "replacement_authorized",
      "programming_attempt_expired",
      "programming_attempts_expired_recover_reservation",
    ]) {
      requireProof(actions.has(expected), `AUDIT_ACTION_${expected.toUpperCase()}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

try {
  await main();
  console.log("AI_GRADER_NFC_REAL_SERVICE_VALIDATION_PASS");
} catch (error) {
  const message = error instanceof Error ? error.message : "AI_GRADER_NFC_VALIDATION_UNKNOWN_FAILURE";
  console.error(`AI_GRADER_NFC_REAL_SERVICE_VALIDATION_FAILED: ${sanitizeAiGraderNfcValidationOutput(message)}`);
  process.exitCode = 1;
}
