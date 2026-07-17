import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  buildAiGraderFinishCardsQueueResult,
  validateAiGraderInventoryReadiness,
} from "../lib/server/aiGraderProductionApi";
import {
  isValidAiGraderNfcPublicTagId,
  readAiGraderPublicNfcRegistration,
  readAiGraderNfcPublicTap,
} from "../lib/server/aiGraderNfcPublic";
import { readAiGraderNfcStatusesForReports } from "../lib/server/aiGraderNfcReadProjection";

const PUBLIC_TAG_ID = "Abcdefghijklmnopqrstuvwxyz012345";

function publicRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "tag-row-1",
    publicTagId: PUBLIC_TAG_ID,
    chipType: "NTAG215",
    securityMode: "static_url_v1",
    status: "active",
    aiGraderReportId: "report-row-1",
    reportId: "report-1",
    cardAssetId: "card-1",
    itemId: "item-1",
    aiGraderLabelId: "label-1",
    certId: "TK-AIG-1",
    ndefPayloadVersion: 1,
    uidFingerprintSha256: "f".repeat(64),
    attestationChallenge: "must-not-leak",
    workstationKeyId: "e".repeat(64),
    signature: "must-not-leak",
    readbackEvidence: { workstationOperationalAttestation: true },
    activatedAt: new Date("2026-07-12T20:00:00.000Z"),
    report: {
      id: "report-row-1",
      reportId: "report-1",
      publicationStatus: "published",
      visibilityStatus: "public",
      cardAssetId: "card-1",
      itemId: "item-1",
      finalOverallGrade: 8.6,
    },
    item: { id: "item-1", name: "2025 Test Player #7", set: "Test Set" },
    label: { id: "label-1", certId: "TK-AIG-1" },
    ...overrides,
  };
}

test("public NFC validates the bounded identifier before DB lookup", async () => {
  let calls = 0;
  const db = { aiGraderNfcTag: { async findUnique() { calls += 1; return null; }, async findFirst() { return null; } } };
  assert.equal(isValidAiGraderNfcPublicTagId(PUBLIC_TAG_ID), true);
  assert.equal(isValidAiGraderNfcPublicTagId("short"), false);
  assert.deepEqual(await readAiGraderNfcPublicTap("../private", { dbClient: db }), { state: "not_valid" });
  assert.equal(calls, 0);
});

test("public NFC active projection is DB-backed, exact-linkage-only, and honest about NTAG215", async () => {
  const db = { aiGraderNfcTag: { async findUnique() { return publicRow(); }, async findFirst() { return null; } } };
  const tap = await readAiGraderNfcPublicTap(PUBLIC_TAG_ID, { dbClient: db });
  assert.deepEqual(tap, {
    state: "active",
    registrationKind: "registered_link",
    publicTagId: PUBLIC_TAG_ID,
    chipType: "NTAG215",
    securityMode: "static_url_v1",
    nfcTagUrl: `https://collect.tenkings.co/nfc/${PUBLIC_TAG_ID}`,
    reportId: "report-1",
    reportUrl: "/ai-grader/reports/report-1",
    certId: "TK-AIG-1",
    cardTitle: "2025 Test Player #7",
    cardSet: "Test Set",
    grade: 8.6,
  });
  const json = JSON.stringify(tap);
  for (const forbidden of [
    "uidFingerprint",
    "cardAssetId",
    "itemId",
    "storageKey",
    "localPath",
    "presigned",
    "helper",
    "PCSC",
    "attestationChallenge",
    "workstationKeyId",
    "signature",
    "readbackEvidence",
  ]) {
    assert.equal(json.includes(forbidden), false);
  }
  assert.equal(json.includes("cryptographically_verified"), false);
});

test("public NFC exposes a Feiju F8215 only as a write-protected registered static link", async () => {
  const db = { aiGraderNfcTag: { async findUnique() { return publicRow({ chipType: "FEIJU_F8215" }); }, async findFirst() { return null; } } };
  const tap = await readAiGraderNfcPublicTap(PUBLIC_TAG_ID, { dbClient: db });
  assert.equal(tap.state, "active");
  if (tap.state !== "active") return;
  assert.equal(tap.chipType, "FEIJU_F8215");
  assert.equal(tap.registrationKind, "registered_link");
  assert.equal(tap.securityMode, "static_url_v1");
  const serialized = JSON.stringify(tap);
  for (const forbidden of ["uid", "workstation", "GoToTags", "adapter", "localPath", "cryptographically_verified"]) {
    assert.equal(serialized.toLowerCase().includes(forbidden.toLowerCase()), false);
  }
});

test("public NFC revoked/missing/unpublished/mismatched states never resolve a report", async () => {
  const cases: Array<[Record<string, unknown> | null, "revoked" | "not_valid" | "contradictory_linkage"]> = [
    [publicRow({ status: "revoked" }), "revoked"],
    [null, "not_valid"],
    [publicRow({ report: { ...publicRow().report as Record<string, unknown>, publicationStatus: "draft" } }), "not_valid"],
    [publicRow({ itemId: "other-item" }), "contradictory_linkage"],
    [publicRow({ aiGraderLabelId: "other-label" }), "contradictory_linkage"],
    [publicRow({ revokedAt: new Date("2026-07-12T21:00:00.000Z") }), "not_valid"],
  ];
  for (const [row, expectedState] of cases) {
    const db = { aiGraderNfcTag: { async findUnique() { return row; }, async findFirst() { return null; } } };
    const tap = await readAiGraderNfcPublicTap(PUBLIC_TAG_ID, { dbClient: db });
    assert.equal(tap.state, expectedState);
    assert.equal("reportUrl" in tap, false);
  }
});

test("public NFC distinguishes unavailable persistence from invalid tags without leaking database details", async () => {
  let reads = 0;
  const db = { aiGraderNfcTag: {
    async findUnique() { reads += 1; return publicRow(); },
    async findFirst() { reads += 1; return publicRow(); },
  } };
  assert.deepEqual(await readAiGraderNfcPublicTap(PUBLIC_TAG_ID, {
    dbClient: db,
    schemaReadiness: async () => false,
  }), { state: "unavailable" });
  assert.equal(reads, 0);
  assert.deepEqual(await readAiGraderNfcPublicTap(PUBLIC_TAG_ID, {
    dbClient: db,
    schemaReadiness: async () => { throw new Error("private database sentinel"); },
  }), { state: "unavailable" });
  assert.equal(reads, 0);
  assert.equal(await readAiGraderPublicNfcRegistration("report-1", {
    dbClient: db,
    schemaReadiness: async () => false,
  }), null);
  await assert.rejects(readAiGraderPublicNfcRegistration("report-1", {
    dbClient: db,
    schemaReadiness: async () => { throw new Error("unexpected database failure"); },
  }), /unexpected database failure/);
});

test("batched Finish/label NFC read uses one query and fails closed on exact linkage mismatch", async () => {
  let calls = 0;
  const db = { aiGraderNfcTag: { async findMany() {
    calls += 1;
    return [{
      tenantId: "ten-kings", reportId: "report-1", aiGraderReportId: "report-row-1",
      cardAssetId: "card-1", itemId: "item-1", aiGraderLabelId: "label-1", certId: "TK-AIG-1",
      status: "active", publicTagId: PUBLIC_TAG_ID, chipType: "NTAG215", securityMode: "static_url_v1",
    }];
  } } };
  const good = await readAiGraderNfcStatusesForReports({
    dbClient: db, tenantId: "ten-kings",
    schemaReadiness: async () => true,
    reports: [{ reportId: "report-1", reportRowId: "report-row-1", cardAssetId: "card-1", itemId: "item-1", labelId: "label-1", certId: "TK-AIG-1" }],
  });
  assert.equal(calls, 1);
  assert.equal(good.get("report-1")?.status, "active");
  assert.equal(good.get("report-1")?.registrationKind, "registered_link");
  const mismatch = await readAiGraderNfcStatusesForReports({
    dbClient: db, tenantId: "ten-kings",
    schemaReadiness: async () => true,
    reports: [{ reportId: "report-1", reportRowId: "report-row-1", cardAssetId: "other-card", itemId: "item-1", labelId: "label-1", certId: "TK-AIG-1" }],
  });
  assert.equal(mismatch.get("report-1")?.status, "error");
});

test("Finish NFC projection treats absent schema as unavailable and unexpected database failure as error", async () => {
  let reads = 0;
  const db = { aiGraderNfcTag: { async findMany() { reads += 1; return []; } } };
  const reports = [{ reportId: "report-1", reportRowId: "report-row-1", cardAssetId: "card-1", itemId: "item-1" }];
  const absent = await readAiGraderNfcStatusesForReports({
    dbClient: db,
    tenantId: "ten-kings",
    reports,
    schemaReadiness: async () => false,
  });
  assert.equal(absent.get("report-1")?.status, "unavailable");
  assert.equal(reads, 0);
  const failed = await readAiGraderNfcStatusesForReports({
    dbClient: db,
    tenantId: "ten-kings",
    reports,
    schemaReadiness: async () => { throw new Error("database unavailable"); },
  });
  assert.equal(failed.get("report-1")?.status, "error");
  assert.equal(reads, 0);
});

function finishRow(nfc: Record<string, unknown>) {
  return {
    id: "report-row-1",
    reportId: "report-1",
    finalOverallGrade: 8.6,
    cardAssetId: "card-1",
    itemId: "item-1",
    qrPayloadUrl: "https://collect.tenkings.co/ai-grader/reports/report-1",
    session: { status: "published" },
    cardAsset: { reviewStage: null, customTitle: "Test card" },
    labels: [{ id: "label-1", certId: "TK-AIG-1", physicalPrintStatus: "printed" }],
    evidenceAssets: [
      { side: "front", storageKey: "safe/front", publicUrl: "https://cdn.example/front", byteSize: 100 },
      { side: "back", storageKey: "safe/back", publicUrl: "https://cdn.example/back", byteSize: 100 },
    ],
    valuations: [{ status: "completed", valuationMinor: 1000, valuationCurrency: "USD", compsRefs: [] }],
    nfc,
  };
}

test("Finish inventory gate requires exact active NFC only when policy is enabled and preserves QR", () => {
  const disabled = buildAiGraderFinishCardsQueueResult([finishRow({ status: "missing" })], { nfcRequired: false });
  assert.equal(disabled.items[0].nfcRequired, false);
  assert.equal(disabled.items[0].inventory.canAddToInventory, true);
  assert.equal(disabled.items[0].qrPayloadUrl, "https://collect.tenkings.co/ai-grader/reports/report-1");

  const requiredMissing = buildAiGraderFinishCardsQueueResult([finishRow({ status: "missing" })], { nfcRequired: true });
  assert.equal(requiredMissing.items[0].inventory.canAddToInventory, false);
  assert.equal(requiredMissing.items[0].needs.includes("Program NFC"), true);

  const requiredActive = buildAiGraderFinishCardsQueueResult([finishRow({
    status: "active", publicTagId: PUBLIC_TAG_ID, nfcTagUrl: `https://collect.tenkings.co/nfc/${PUBLIC_TAG_ID}`,
    chipType: "NTAG215", securityMode: "static_url_v1",
  })], { nfcRequired: true });
  assert.equal(requiredActive.items[0].inventory.canAddToInventory, true);
  assert.equal(requiredActive.items[0].nfcStatus, "active");
});

function inventoryDb(
  nfcTag: Record<string, unknown> | null,
  schema: "ready" | "missing" | "failed" = "ready",
  nfcStatus: "ready" | "failed" = "ready",
) {
  let schemaQueries = 0;
  const report = {
    id: "report-row-1", tenantId: "ten-kings", sessionId: "session-1", reportId: "report-1",
    publicationStatus: "published", cardAssetId: "card-1", itemId: "item-1",
    labels: [{ id: "label-1", certId: "TK-AIG-1" }],
  };
  return {
    async $queryRaw() {
      schemaQueries += 1;
      if (schema === "failed") throw new Error("private database sentinel");
      if (schemaQueries === 1) return [{
        migrationLedgerReady: schema === "ready",
        tagTableReady: schema === "ready",
        attemptTableReady: schema === "ready",
        auditTableReady: schema === "ready",
      }];
      return [{ ready: schema === "ready" }];
    },
    aiGraderReport: { async findUnique() { return report; } },
    aiGraderLabel: { async findFirst() { return { id: "label-1", physicalPrintStatus: "printed" }; } },
    aiGraderEvidenceAsset: { async findMany() { return [
      { id: "front", side: "front", storageKey: "front", publicUrl: "https://cdn.example/front", byteSize: 10 },
      { id: "back", side: "back", storageKey: "back", publicUrl: "https://cdn.example/back", byteSize: 10 },
    ]; } },
    aiGraderValuation: { async findFirst() { return { id: "valuation", status: "completed", valuationMinor: 1000 }; } },
    aiGraderNfcTag: { async findFirst() {
      if (nfcStatus === "failed") throw new Error("private NFC status database sentinel");
      return nfcTag;
    } },
  };
}

test("server inventory readiness enforces active non-revoked exact NFC inside the policy gate", async () => {
  const active = publicRow({ report: undefined, item: undefined, label: undefined });
  assert.equal((await validateAiGraderInventoryReadiness(inventoryDb(active), "report-1", {
    tenantId: "ten-kings", nfcRequired: true,
  })).nfc?.status, "active");
  await assert.rejects(validateAiGraderInventoryReadiness(inventoryDb(null), "report-1", {
    tenantId: "ten-kings", nfcRequired: true,
  }), (error: unknown) => error instanceof Error && (error as Error & { code?: string }).code === "AI_GRADER_NFC_ACTIVE_REQUIRED");
  await assert.rejects(validateAiGraderInventoryReadiness(inventoryDb({ ...active, status: "revoked" }), "report-1", {
    tenantId: "ten-kings", nfcRequired: true,
  }));
  await assert.rejects(validateAiGraderInventoryReadiness(inventoryDb({ ...active, itemId: "wrong-item" }), "report-1", {
    tenantId: "ten-kings", nfcRequired: true,
  }), (error: unknown) => error instanceof Error && (error as Error & { code?: string }).code === "AI_GRADER_NFC_LINKAGE_INVALID");
  await assert.rejects(validateAiGraderInventoryReadiness(inventoryDb(null, "ready", "failed"), "report-1", {
    tenantId: "ten-kings", nfcRequired: true,
  }), (error: unknown) => error instanceof Error &&
    (error as Error & { code?: string; statusCode?: number }).code === "AI_GRADER_NFC_STATUS_CHECK_FAILED" &&
    (error as Error & { statusCode?: number }).statusCode === 503 &&
    !error.message.includes("private NFC status database sentinel"));
  assert.equal((await validateAiGraderInventoryReadiness(inventoryDb(null), "report-1", {
    tenantId: "ten-kings", nfcRequired: false,
  })).nfcRequired, false);
  await assert.rejects(validateAiGraderInventoryReadiness(inventoryDb(null, "missing"), "report-1", {
    tenantId: "ten-kings", nfcRequired: true,
  }), (error: unknown) => error instanceof Error &&
    (error as Error & { code?: string; statusCode?: number }).code === "AI_GRADER_NFC_SCHEMA_UNAVAILABLE" &&
    (error as Error & { statusCode?: number }).statusCode === 503);
  await assert.rejects(validateAiGraderInventoryReadiness(inventoryDb(null, "failed"), "report-1", {
    tenantId: "ten-kings", nfcRequired: true,
  }), (error: unknown) => error instanceof Error &&
    (error as Error & { code?: string; statusCode?: number }).code === "AI_GRADER_NFC_SCHEMA_CHECK_FAILED" &&
    (error as Error & { statusCode?: number }).statusCode === 503 &&
    !error.message.includes("private database sentinel"));
  assert.equal((await validateAiGraderInventoryReadiness(inventoryDb(null, "missing"), "report-1", {
    tenantId: "ten-kings", nfcRequired: false,
  })).nfcRequired, false);
});

test("dedicated programming and public tap pages keep hardware controls out of Finish/public surfaces", async () => {
  const [nfcPage, finishPage, publicPage] = await Promise.all([
    readFile(new URL("../pages/ai-grader/nfc.tsx", import.meta.url), "utf8"),
    readFile(new URL("../pages/ai-grader/finish.tsx", import.meta.url), "utf8"),
    readFile(new URL("../pages/nfc/[publicTagId].tsx", import.meta.url), "utf8"),
  ]);
  assert.match(nfcPage, /Program NFC/);
  assert.match(nfcPage, /not cryptographic authentication/i);
  assert.match(nfcPage, /-overwrite-\$\{overwriteDigest\.slice\(0, 12\)\}/);
  assert.match(nfcPage, /Retry Current Attempt/);
  assert.match(nfcPage, /getOrCreateAiGraderNfcInitIdempotencyKey/);
  assert.match(nfcPage, /const attemptIdempotencyKey = getOrCreateAiGraderNfcInitIdempotencyKey\(reportId\)/);
  assert.match(nfcPage, /Program authorized replacement/);
  assert.match(nfcPage, /request\.idempotencyKey !== attemptIdempotencyKey/);
  assert.match(nfcPage, /const programmingReady = Boolean/);
  assert.match(nfcPage, /disabled=\{!programmingReady\}/);
  assert.match(nfcPage, /disabled or incomplete/);
  assert.match(nfcPage, /operationalAttestation/);
  assert.match(nfcPage, /Confirm Fresh F8215 & Prepare/);
  assert.match(nfcPage, /operator_fresh_inventory_confirmation_v1/);
  assert.match(nfcPage, /controlled unused-tag supply/);
  assert.match(nfcPage, /separate quarantine container/);
  assert.match(nfcPage, /do not electronically prove blankness/);
  assert.match(nfcPage, /GoToTags opened\. Click Start Encoding/);
  assert.match(nfcPage, /window\.addEventListener\("focus", onFocus\)/);
  assert.match(nfcPage, /acknowledgeAiGraderF8215Operation/);
  assert.match(nfcPage, /permanently_read_only_verified/);
  assert.doesNotMatch(nfcPage, /manual_ios|FEIJU_PROPRIETARY_ISODEP|NFC Tools/);
  assert.match(nfcPage, /hosted\?\.canAdmin/);
  assert.ok(nfcPage.indexOf("setReservation(currentReservation)") < nfcPage.indexOf("await writeAiGraderNfcTag"));
  const completionRetry = nfcPage.slice(
    nfcPage.indexOf("const retryHostedVerification"),
    nfcPage.indexOf("const retryCurrentAttempt"),
  );
  assert.match(completionRetry, /completeHosted\(pending\)/);
  assert.doesNotMatch(completionRetry, /writeAiGraderNfcTag|writeReservation/);
  const currentAttemptRetry = nfcPage.slice(
    nfcPage.indexOf("const retryCurrentAttempt"),
    nfcPage.indexOf("const busy"),
  );
  assert.match(currentAttemptRetry, /if \(writeRecovery === "not_retryable"\) return;/);
  assert.match(nfcPage, /const canRetryCurrentAttempt =[\s\S]*writeRecovery !== "not_retryable";/);
  assert.match(nfcPage, /\{canRetryCurrentAttempt \? \(/);
  const schemaGate = nfcPage.indexOf("if (!result.nfcSchemaReady)");
  const disabledGate = nfcPage.indexOf("if (!result.nfcProgrammingEnabled)");
  const helperStatusCall = nfcPage.indexOf("getAiGraderNfcHelperStatus", disabledGate);
  assert.ok(schemaGate >= 0 && disabledGate > schemaGate && helperStatusCall > disabledGate);
  assert.match(finishPage, /Open dedicated NFC programming route/);
  for (const forbidden of ["aiGraderStationBridgeClient", "Basler", "Leimac", "Manual APDU", "camera preview", "station token"]) {
    assert.equal(finishPage.includes(forbidden), false);
    assert.equal(publicPage.includes(forbidden), false);
  }
  assert.equal(publicPage.includes("sample"), false);
  assert.match(publicPage, /Registered Ten Kings NFC link/);
  assert.match(publicPage, /Write-protected registered NFC link/);
  assert.match(publicPage, /static URL unclonable/);
  assert.match(publicPage, /statusCode = 503/);
  assert.match(publicPage, /Cache-Control.*no-store/);
  assert.match(publicPage, /temporarily unavailable/i);
  assert.match(publicPage, /not cryptographic authentication/i);
});

test("Next and Vercel dependency graph contains no native PCSC NFC helper package", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as Record<string, Record<string, string>>;
  const dependencyText = JSON.stringify({
    dependencies: packageJson.dependencies,
    devDependencies: packageJson.devDependencies,
    optionalDependencies: packageJson.optionalDependencies,
  });
  assert.equal(dependencyText.includes("@tenkings/ai-grader-nfc-helper"), false);
  assert.equal(dependencyText.toLowerCase().includes("winscard"), false);
  const client = await readFile(new URL("../lib/aiGraderNfcHelperClient.ts", import.meta.url), "utf8");
  for (const nativeMarker of ["winscard.dll", "LibraryImport", "SCardTransmit", "TenKings.AiGrader.NfcHelper"]) {
    assert.equal(client.includes(nativeMarker), false);
  }
});
