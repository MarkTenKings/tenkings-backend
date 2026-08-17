import test from "node:test";
import assert from "node:assert/strict";
import type { NextApiRequest } from "next";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SIMULATOR_DOOR_MAPPING,
  VAULT_DOOR_MAP,
  VaultHeartbeatSchema,
  redactVaultValue,
  type VaultConfigPayload,
  type VaultMachineEvent,
} from "@tenkings/vault-contracts";
import {
  validateVaultConfigPayload,
  vaultConfigImpact,
} from "../lib/server/vaultV1/config";
import {
  VaultApiError,
  requireVaultContract,
  requireVaultJson,
  vaultRequestId,
} from "../lib/server/vaultV1/http";
import {
  evaluateVaultCertificationApproval,
  VaultCertificationEvidenceManifestSchema,
} from "../lib/server/vaultV1/certification";
import { normalizeTypedVaultEvent } from "../lib/server/vaultV1/events";
import { VaultFinancialResolutionSchema, vaultSaleAdminDto, vaultSupportCaseAdminDto } from "../lib/server/vaultV1/support";

function request(headers: Record<string, string>): NextApiRequest {
  return { headers } as unknown as NextApiRequest;
}

function validPayload(): VaultConfigPayload {
  return {
    schemaVersion: 1,
    version: 1,
    machineId: "00000000-0000-4000-8000-000000000001",
    timezone: "America/Los_Angeles",
    city: "Los Angeles",
    state: "CA",
    taxRateBasisPoints: 950,
    taxCalculationVersion: "half-up-subtotal-bps-v1",
    products: [{
      id: "sports-25",
      name: "Sports Mystery Pack",
      photoUrl: "https://example.test/sports-25.jpg",
      description: "Factory sealed sports mystery pack.",
      priceCents: 2500,
      category: "SPORTS",
      taxClass: "GENERAL",
      active: true,
    }],
    doorMapping: [...SIMULATOR_DOOR_MAPPING],
    assignments: Object.fromEntries(VAULT_DOOR_MAP.map(({ doorId }) => [doorId, null])),
    support: {
      pageUrl: "https://example.test/support",
      email: "support@example.test",
      textNumber: "+12135550100",
      phoneNumber: "+12135550101",
      hours: "Daily 9am-9pm PT",
    },
    minimumAppVersion: "0.1.0",
    cloudFreshnessMs: 120_000,
    retrievalSeconds: 60,
    retryExtensionSeconds: 45,
    createdAt: "2026-08-17T01:00:00.000Z",
    expiresAt: "2026-09-16T01:00:00.000Z",
  };
}

test("Vault requests require the exact contract header", () => {
  assert.doesNotThrow(() => requireVaultContract(request({ "x-vault-contract-version": "1" })));
  assert.throws(
    () => requireVaultContract(request({ "x-vault-contract-version": "2" })),
    (error: unknown) => error instanceof VaultApiError
      && error.statusCode === 426
      && error.code === "UNSUPPORTED_CONTRACT_VERSION",
  );
});

test("Vault JSON enforcement rejects wrong media types and oversized bodies", () => {
  assert.doesNotThrow(() => requireVaultJson(request({
    "x-vault-contract-version": "1",
    "content-type": "application/json; charset=utf-8",
    "content-length": "64",
  }), 128));
  assert.throws(
    () => requireVaultJson(request({ "x-vault-contract-version": "1", "content-type": "text/plain" }), 128),
    (error: unknown) => error instanceof VaultApiError && error.statusCode === 415,
  );
  assert.throws(
    () => requireVaultJson(request({
      "x-vault-contract-version": "1",
      "content-type": "application/json",
      "content-length": "129",
    }), 128),
    (error: unknown) => error instanceof VaultApiError && error.statusCode === 413,
  );
});

test("Vault request IDs accept safe caller IDs and replace unsafe values", () => {
  assert.equal(vaultRequestId(request({ "x-request-id": "vault-request-0001" })), "vault-request-0001");
  const unsafe = request({ "x-request-id": "bad id" });
  const generated = vaultRequestId(unsafe);
  assert.match(generated, /^[0-9a-f-]{36}$/);
  assert.equal(vaultRequestId(unsafe), generated, "response and immutable audit must share one request ID");
});

test("Vault heartbeat requires the active config version and digest as one snapshot", () => {
  const heartbeat = {
    contractVersion: 1,
    appVersion: "0.1.0",
    localSchemaVersion: 1,
    configVersion: 2,
    configDigest: "a".repeat(64),
    health: "READY",
    readinessReasons: [],
    availableDoorCount: 150,
    outboxPendingCount: 0,
    serviceLocked: false,
    observedAt: "2026-08-17T01:00:00.000Z",
  } as const;
  assert.equal(VaultHeartbeatSchema.parse(heartbeat).configVersion, 2);
  assert.throws(() => VaultHeartbeatSchema.parse({ ...heartbeat, configDigest: null }));
  assert.throws(() => VaultHeartbeatSchema.parse({ ...heartbeat, configVersion: null }));
});

test("Vault config validation covers all 150 canonical doors and detects impact", () => {
  const current = validPayload();
  const validated = validateVaultConfigPayload(current);
  assert.equal(validated.summary.valid, true);
  assert.equal(validated.summary.emptyDoorCount, 150);

  const proposed = structuredClone(current);
  proposed.version = 2;
  proposed.assignments["X-01"] = "sports-25";
  const impact = vaultConfigImpact(current, proposed);
  assert.equal(impact.changedDoorCount, 1);
  assert.deepEqual(impact.changedDoorIds, ["X-01"]);
  assert.equal(impact.safeBoundaryRequired, true);
});

test("Vault config validation rejects an assigned product outside the signed catalog", () => {
  const payload = validPayload();
  payload.assignments["X-01"] = "unknown-product";
  assert.throws(
    () => validateVaultConfigPayload(payload),
    (error: unknown) => error instanceof VaultApiError && error.code === "UNKNOWN_ASSIGNED_PRODUCT",
  );
});

function event(type: string, payload: Record<string, unknown>): VaultMachineEvent {
  return {
    eventId: "00000000-0000-4000-8000-000000000010",
    schemaVersion: 1,
    machineId: "00000000-0000-4000-8000-000000000001",
    sequence: 1,
    type,
    mode: "PRODUCTION",
    occurredAt: "2026-08-17T01:00:00.000Z",
    payload,
  };
}

test("typed event boundary accepts complete sale snapshots, business session IDs, and redacted auth sessions", () => {
  const sale = normalizeTypedVaultEvent(event("SALE_RESERVED", {
    saleId: "00000000-0000-4000-8000-000000000020",
    supportReference: "ABC12345",
    configVersion: 1,
    configDigest: "a".repeat(64),
    timezone: "America/Los_Angeles",
    city: "Los Angeles",
    state: "CA",
    taxRateBasisPoints: 950,
    taxCalculationVersion: "half-up-subtotal-bps-v1",
    subtotalCents: 2500,
    taxCents: 238,
    totalCents: 2738,
    currency: "USD",
    items: [{
      lineId: "00000000-0000-4000-8000-000000000021",
      doorId: "X-01",
      productId: "sports-25",
      productName: "Sports Mystery Pack",
      photoUrl: "https://example.test/pack.jpg",
      description: "Sealed pack",
      category: "SPORTS",
      priceCents: 2500,
      taxClass: "GENERAL",
      controllerChannel: 1,
      mappingVersion: "1",
    }],
  }));
  assert.equal(sale.payload.supportReference, "ABC12345");

  const restockPayload = redactVaultValue({
    restockSessionId: "00000000-0000-4000-8000-000000000030",
    expectedDoorIds: ["X-01"],
    plannedItems: [{ doorId: "X-01", plannedProductId: "sports-25" }],
    configVersion: 1,
  }) as Record<string, unknown>;
  assert.equal(restockPayload.restockSessionId, "00000000-0000-4000-8000-000000000030");
  const restock = normalizeTypedVaultEvent(event("RESTOCK_SESSION_STARTED", restockPayload));
  assert.equal(restock.payload.restockSessionId, "00000000-0000-4000-8000-000000000030");

  const staff = normalizeTypedVaultEvent(event("STAFF_AUTHENTICATED", redactVaultValue({
    sessionId: "00000000-0000-4000-8000-000000000099",
    role: "TECHNICIAN",
    grantId: "00000000-0000-4000-8000-000000000040",
  }) as Record<string, unknown>));
  assert.equal(staff.payload.sessionId, "[REDACTED]");
  assert.throws(() => normalizeTypedVaultEvent(event("FUTURE_UNREVIEWED_EVENT", {})), (error: unknown) => error instanceof VaultApiError && error.code === "EVENT_TYPE_UNSUPPORTED");
});

test("complete 150-door manifest becomes eligible only after all 1,050 artifacts and cycles are bound", () => {
  const certificationId = "00000000-0000-4000-8000-000000000050";
  const cycles = VAULT_DOOR_MAP.flatMap(({ doorId }, doorIndex) => [
    ...Array.from({ length: 5 }, (_, index) => ({
      evidenceId: `00000000-0000-4000-8000-${(doorIndex * 7 + index).toString(16).padStart(12, "0")}`,
      doorId,
      evidenceClass: "FIELD",
      outcome: "PASS",
      expectedDoorIds: [doorId],
      observedDoorIds: [doorId],
      artifactDigest: "a".repeat(64),
      cycleType: "PURCHASE" as const,
    })),
    ...Array.from({ length: 2 }, (_, index) => ({
      evidenceId: `00000000-0000-4000-8000-${(doorIndex * 7 + index + 5).toString(16).padStart(12, "0")}`,
      doorId,
      evidenceClass: "FIELD",
      outcome: "PASS",
      expectedDoorIds: [doorId],
      observedDoorIds: [doorId],
      artifactDigest: "b".repeat(64),
      cycleType: "RESTOCK" as const,
    })),
  ]);
  const evidence = cycles.map(({ cycleType: _cycleType, ...item }) => ({ ...item, artifactStorageKey: null, metadata: { unexpectedDoor: false } }));
  const manifest = VaultCertificationEvidenceManifestSchema.parse({
    certificationId,
    reason: "Attach the independently stored physical-cycle artifacts.",
    automatedTransactions: 1000,
    observedSessions: 500,
    hardwareIdentity: { machineSerial: "vault-001", controllerBoard: "qualified-controller" },
    unresolvedDeviations: [],
    evidenceBindings: cycles.map((item) => ({
      evidenceId: item.evidenceId,
      artifactStorageKey: `vault-certification/${certificationId}/${item.evidenceId}.json`,
      cycleType: item.cycleType,
    })),
  });
  assert.equal(manifest.evidenceBindings.length, 1050);
  const beforeManifest = evaluateVaultCertificationApproval({
    status: "REVIEW_REQUIRED", sourceCommit: "abcdef1234567", appBuild: "0.1.0+abcdef1", localSchemaVersion: 1, contractVersion: 1,
    configVersion: { digest: "c".repeat(64) }, nayaxAdapterVersion: "official-adapter-1", nayaxSdkVersion: "official-sdk-1",
    nayaxFlowConfig: { mode: "OFFICIAL_TEST" }, controllerIdentity: { adapter: "qualified-controller" }, hardwareIdentity: null,
    evidenceSummary: null, unresolvedDeviations: null, evidence,
  });
  assert.equal(beforeManifest.eligible, false);
  const bindingById = new Map(manifest.evidenceBindings.map((binding) => [binding.evidenceId, binding]));
  const attachedEvidence = evidence.map((item) => {
    const binding = bindingById.get(item.evidenceId)!;
    return { ...item, artifactStorageKey: binding.artifactStorageKey, metadata: { ...item.metadata, cycleType: binding.cycleType } };
  });
  const complete = {
    status: "REVIEW_REQUIRED",
    sourceCommit: "abcdef1234567",
    appBuild: "0.1.0+abcdef1",
    localSchemaVersion: 1,
    contractVersion: 1,
    configVersion: { digest: "c".repeat(64) },
    nayaxAdapterVersion: "official-adapter-1",
    nayaxSdkVersion: "official-sdk-1",
    nayaxFlowConfig: { mode: "OFFICIAL_TEST" },
    controllerIdentity: { adapter: "qualified-controller", mappingDigest: "d".repeat(64) },
    hardwareIdentity: manifest.hardwareIdentity,
    evidenceSummary: { automatedTransactions: manifest.automatedTransactions, observedSessions: manifest.observedSessions },
    unresolvedDeviations: manifest.unresolvedDeviations,
    evidence: attachedEvidence,
  };
  const accepted = evaluateVaultCertificationApproval(complete);
  assert.equal(accepted.eligible, true);
  assert.deepEqual(accepted.counts, { automatedTransactions: 1000, observedSessions: 500, purchaseDoorsComplete: 150, restockDoorsComplete: 150 });

  const rejected = evaluateVaultCertificationApproval({ ...complete, status: "ACTIVE", hardwareIdentity: null, unresolvedDeviations: ["open"], evidence: [...attachedEvidence, { ...attachedEvidence[0]!, evidenceId: "00000000-0000-4000-8000-ffffffffffff", outcome: "FAIL" }] });
  assert.equal(rejected.eligible, false);
  assert.ok(rejected.reasons.includes("STATUS_NOT_REVIEW_REQUIRED"));
  assert.ok(rejected.reasons.includes("FAIL_EVIDENCE_PRESENT"));
  assert.ok(rejected.reasons.includes("ADAPTER_OR_HARDWARE_IDENTITY_INCOMPLETE"));
  assert.ok(rejected.reasons.includes("UNRESOLVED_DEVIATIONS_PRESENT"));

  assert.equal(VaultCertificationEvidenceManifestSchema.safeParse({ ...manifest, evidenceBindings: [manifest.evidenceBindings[0], manifest.evidenceBindings[0]] }).success, false);
  assert.equal(VaultCertificationEvidenceManifestSchema.safeParse({ ...manifest, hardwareIdentity: {}, evidenceBindings: manifest.evidenceBindings }).success, false);
});

test("support and sales DTOs never expose provider evidence or provider identifiers", () => {
  const sale = {
    id: "sale", machineId: "machine", localTransactionId: "local", supportReference: "ABC12345", mode: "PRODUCTION",
    state: "SETTLED", paymentState: "SETTLED", settlementState: "SETTLED", fulfillmentState: "CUSTOMER_DONE",
    providerName: "secret-provider", providerSessionId: "provider-session", providerTransactionId: "provider-transaction",
    providerEvidence: { pan: "4111111111111111" }, items: [],
  };
  const dtoText = JSON.stringify(vaultSaleAdminDto(sale));
  assert.doesNotMatch(dtoText, /secret-provider|provider-session|provider-transaction|411111/);
  const supportText = JSON.stringify(vaultSupportCaseAdminDto({ id: "case", machineId: "machine", saleId: "sale", sale, financialResolution: null }));
  assert.doesNotMatch(supportText, /provider-session|provider-transaction|411111/);
  assert.equal(VaultFinancialResolutionSchema.safeParse({ resolutionType: "REFUND_RECORDED", amountCents: 2500, currency: "USD", note: "Recorded after provider confirmation", recordedAt: "2026-08-17T01:00:00.000Z" }).success, true);
  assert.equal(VaultFinancialResolutionSchema.safeParse({ resolutionType: "REFUND_RECORDED", amountCents: 2500, currency: "USD", note: "unsafe", recordedAt: "2026-08-17T01:00:00.000Z", providerTransactionId: "raw" }).success, false);
});

test("cloud handlers statically preserve exact-digest cache identity, atomic projection and lifecycle controls", () => {
  const apiRoot = join(process.cwd(), "pages/api/vault/v1");
  const configSource = readFileSync(join(apiRoot, "machines/[machineId]/config.ts"), "utf8");
  const actionSource = readFileSync(join(apiRoot, "machines/[machineId]/[...action].ts"), "utf8");
  const eventSource = readFileSync(join(process.cwd(), "lib/server/vaultV1/machineActions.ts"), "utf8");
  const enrollmentSource = readFileSync(join(apiRoot, "machines/enroll/complete.ts"), "utf8");
  const adminSource = readFileSync(join(apiRoot, "admin/[...path].ts"), "utf8");
  assert.equal(existsSync(join(apiRoot, "machines/[machineId]/events:batch.ts")), false);
  assert.equal(existsSync(join(apiRoot, "machines/[machineId]/staff-grants:pull.ts")), false);
  assert.match(actionSource, /handleVaultMachineAction/);
  assert.match(eventSource, /action === "events:batch"/);
  assert.match(eventSource, /action === "staff-grants:pull"/);
  assert.doesNotMatch(configSource, /knownVersion\s*===\s*config\.version/);
  assert.match(configSource, /knownDigest\s*===\s*config\.digest/);
  assert.match(eventSource, /projectEvent\(tx, typedEvent\)[\s\S]*lastEventSequence/);
  assert.match(eventSource, /CONTIGUOUS_PREFIX_BLOCKED/);
  assert.match(enrollmentSource, /MACHINE_ENROLLMENT_DISABLED/);
  assert.match(enrollmentSource, /writeVaultAdminAudit\(\{ req, tx/);
  assert.match(adminSource, /createVaultScryptPinVerifier/);
  assert.match(adminSource, /VaultStaffMachineAccess[\s\S]*FOR UPDATE/);
  assert.match(adminSource, /status: \{ in: \["PENDING_APPROVAL", "APPROVED"\] \}/);
  assert.match(adminSource, /DECOMMISSION \$\{current\.slug\}/);
  assert.match(adminSource, /machineId: identity\.machineId, fresh: true/);
  assert.match(adminSource, /CERTIFICATION_MANIFEST_EVIDENCE_MISMATCH/);
  assert.match(adminSource, /vault-certification\/\$\{session\.id\}\//);
});
