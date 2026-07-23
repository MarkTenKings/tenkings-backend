import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveAiGraderCalibrationRegistryForConsoleV1,
} from "../lib/aiGraderCalibrationRegistryResolver";

const SHA = "a".repeat(64);
const RIG_ID = "fixed-rig-dell-v1";

function snapshot(snapshotId = "snapshot-trusted") {
  return {
    snapshotId,
    rigId: RIG_ID,
    trustStatus: "TRUSTED" as const,
    activationEligible: true,
    activationIneligibilityCode: null,
    profileId: "profile-1",
    calibrationVersion: "v1",
    artifactSha256: SHA,
    bundleManifestSha256: SHA,
    memberLedgerSha256: SHA,
    runtimeContextHash: SHA,
    rigCharacterizationSha256: SHA,
    operatingContextHash: SHA,
    importedAt: "2026-07-23T09:00:00.000Z",
    trustedAt: "2026-07-23T09:15:00.000Z",
    revokedAt: null,
  };
}

function registry(snapshotRows = [snapshot()]) {
  return {
    schemaVersion: "ten-kings-ai-grader-calibration-activation-registry-projection-v1" as const,
    rigId: RIG_ID,
    registryRevision: SHA,
    activeActivationId: null,
    pendingActivationId: null,
    snapshots: snapshotRows,
    activations: [],
    observedAt: "2026-07-23T09:30:00.000Z",
  };
}

function status() {
  return {
    ok: true as const,
    registryRevision: SHA,
    active: null,
    pending: null,
    authority: null,
    observedAt: "2026-07-23T09:30:00.000Z",
  };
}

test("existing exact local-session rig path remains authoritative", async () => {
  const calls: string[] = [];
  const result = await resolveAiGraderCalibrationRegistryForConsoleV1({
    async readLocalRigId() {
      calls.push("local-status");
      return RIG_ID;
    },
    async listByRigId(rigId) {
      calls.push(`hosted-list:${rigId}`);
      return { registry: registry() };
    },
    async readStatusByRigId(rigId) {
      calls.push(`hosted-status:${rigId}`);
      return status();
    },
    async resolveSoleHostedTrusted() {
      calls.push("hosted-resolve");
      throw new Error("must not use hosted fallback");
    },
  });

  assert.equal(result.source, "exact_local_session");
  assert.equal(result.registry.rigId, RIG_ID);
  assert.deepEqual(calls, [
    "local-status",
    `hosted-list:${RIG_ID}`,
    `hosted-status:${RIG_ID}`,
  ]);
});

test("no local calibration session resolves the sole exact hosted TRUSTED snapshot without activation or hardware action", async () => {
  const calls: string[] = [];
  const result = await resolveAiGraderCalibrationRegistryForConsoleV1({
    async readLocalRigId() {
      calls.push("local-status-read-only");
      return undefined;
    },
    async listByRigId() {
      throw new Error("browser must not supply an inferred rig");
    },
    async readStatusByRigId() {
      throw new Error("browser must not supply an inferred rig");
    },
    async resolveSoleHostedTrusted() {
      calls.push("hosted-resolve-read-only");
      return { ok: true, registry: registry(), status: status() };
    },
  });

  assert.equal(result.source, "sole_hosted_trusted_snapshot");
  assert.equal(result.registry.snapshots[0]?.snapshotId, "snapshot-trusted");
  assert.deepEqual(calls, ["local-status-read-only", "hosted-resolve-read-only"]);
});

test("hosted fallback rejects multiple eligible snapshots or competing authority", async () => {
  const ambiguousSnapshots = registry([snapshot("snapshot-1"), snapshot("snapshot-2")]);
  await assert.rejects(
    resolveAiGraderCalibrationRegistryForConsoleV1({
      async readLocalRigId() { return undefined; },
      async listByRigId() { throw new Error("unexpected"); },
      async readStatusByRigId() { throw new Error("unexpected"); },
      async resolveSoleHostedTrusted() {
        return { ok: true, registry: ambiguousSnapshots, status: status() };
      },
    }),
    /ambiguous or already had competing activation authority/,
  );

  const competing = {
    ...registry(),
    pendingActivationId: "activation-pending",
  };
  await assert.rejects(
    resolveAiGraderCalibrationRegistryForConsoleV1({
      async readLocalRigId() { throw new Error("helper stopped"); },
      async listByRigId() { throw new Error("unexpected"); },
      async readStatusByRigId() { throw new Error("unexpected"); },
      async resolveSoleHostedTrusted() {
        return { ok: true, registry: competing, status: status() };
      },
    }),
    /ambiguous or already had competing activation authority/,
  );
});
