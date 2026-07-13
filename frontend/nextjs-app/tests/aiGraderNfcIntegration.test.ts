import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  buildAiGraderFinishCardsQueueResult,
  validateAiGraderInventoryReadiness,
} from "../lib/server/aiGraderProductionApi";
import {
  isValidAiGraderNfcPublicTagId,
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

test("public NFC revoked/missing/unpublished/mismatched states never resolve a report", async () => {
  for (const row of [
    publicRow({ status: "revoked" }),
    null,
    publicRow({ report: { ...publicRow().report as Record<string, unknown>, publicationStatus: "draft" } }),
    publicRow({ itemId: "other-item" }),
    publicRow({ aiGraderLabelId: "other-label" }),
    publicRow({ revokedAt: new Date("2026-07-12T21:00:00.000Z") }),
  ]) {
    const db = { aiGraderNfcTag: { async findUnique() { return row; }, async findFirst() { return null; } } };
    const tap = await readAiGraderNfcPublicTap(PUBLIC_TAG_ID, { dbClient: db });
    assert.notEqual(tap.state, "active");
    assert.equal("reportUrl" in tap, false);
  }
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
    reports: [{ reportId: "report-1", reportRowId: "report-row-1", cardAssetId: "card-1", itemId: "item-1", labelId: "label-1", certId: "TK-AIG-1" }],
  });
  assert.equal(calls, 1);
  assert.equal(good.get("report-1")?.status, "active");
  assert.equal(good.get("report-1")?.registrationKind, "registered_link");
  const mismatch = await readAiGraderNfcStatusesForReports({
    dbClient: db, tenantId: "ten-kings",
    reports: [{ reportId: "report-1", reportRowId: "report-row-1", cardAssetId: "other-card", itemId: "item-1", labelId: "label-1", certId: "TK-AIG-1" }],
  });
  assert.equal(mismatch.get("report-1")?.status, "error");
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

function inventoryDb(nfcTag: Record<string, unknown> | null) {
  const report = {
    id: "report-row-1", tenantId: "ten-kings", sessionId: "session-1", reportId: "report-1",
    publicationStatus: "published", cardAssetId: "card-1", itemId: "item-1",
    labels: [{ id: "label-1", certId: "TK-AIG-1" }],
  };
  return {
    aiGraderReport: { async findUnique() { return report; } },
    aiGraderLabel: { async findFirst() { return { id: "label-1", physicalPrintStatus: "printed" }; } },
    aiGraderEvidenceAsset: { async findMany() { return [
      { id: "front", side: "front", storageKey: "front", publicUrl: "https://cdn.example/front", byteSize: 10 },
      { id: "back", side: "back", storageKey: "back", publicUrl: "https://cdn.example/back", byteSize: 10 },
    ]; } },
    aiGraderValuation: { async findFirst() { return { id: "valuation", status: "completed", valuationMinor: 1000 }; } },
    aiGraderNfcTag: { async findFirst() { return nfcTag; } },
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
  assert.equal((await validateAiGraderInventoryReadiness(inventoryDb(null), "report-1", {
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
  assert.match(nfcPage, /hosted\?\.canAdmin/);
  assert.ok(nfcPage.indexOf("setReservation(currentReservation)") < nfcPage.indexOf("await writeAiGraderNfcTag"));
  const completionRetry = nfcPage.slice(
    nfcPage.indexOf("const retryHostedVerification"),
    nfcPage.indexOf("const retryCurrentAttempt"),
  );
  assert.match(completionRetry, /completeHosted\(pending\)/);
  assert.doesNotMatch(completionRetry, /writeAiGraderNfcTag|writeReservation/);
  const disabledGate = nfcPage.indexOf("if (!result.nfcProgrammingEnabled)");
  const helperStatusCall = nfcPage.indexOf("getAiGraderNfcHelperStatus", disabledGate);
  assert.ok(disabledGate >= 0 && helperStatusCall > disabledGate);
  assert.match(finishPage, /Open dedicated NFC programming route/);
  for (const forbidden of ["aiGraderStationBridgeClient", "Basler", "Leimac", "Manual APDU", "camera preview", "station token"]) {
    assert.equal(finishPage.includes(forbidden), false);
    assert.equal(publicPage.includes(forbidden), false);
  }
  assert.equal(publicPage.includes("sample"), false);
  assert.match(publicPage, /Registered Ten Kings NFC link/);
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
