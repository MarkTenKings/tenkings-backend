import assert from "node:assert/strict";
import test from "node:test";

import { admitCurrentSpeedsterDetectorIdentity } from "../lib/server/speedsterCurrentRelease";
import { parseSpeedsterDetectorIdentityV1 } from "../lib/server/speedsterDetectionSideCheckpoint";
import { currentSpeedsterIdentityFixture } from "./fixtures/speedsterCurrentRelease";

test("current release admission accepts the verified image contract and preserves observed evidence", () => {
  const identity = currentSpeedsterIdentityFixture();
  const original = JSON.stringify(identity);
  assert.equal(admitCurrentSpeedsterDetectorIdentity(identity), identity);
  assert.equal(JSON.stringify(identity), original);
});

test("historical shape parsing remains compatible without giving old evidence current authority", () => {
  const current = currentSpeedsterIdentityFixture();
  const { gpuPolicy: _gpu, compiler: _compiler, ...runtime } = current.runtime;
  const { cublasWorkspaceConfig: _cublas, ...determinism } = current.determinism;
  const old = {
    ...current,
    source: { ...current.source, commitSha: "a".repeat(40) },
    runtime: { ...runtime, ociDigest: `sha256:${"b".repeat(64)}` },
    policy: { ...current.policy, memoryVersion: "sam-memory-v2" },
    determinism,
  };
  const original = JSON.stringify(old);
  assert.equal(parseSpeedsterDetectorIdentityV1(old), old);
  assert.throws(() => admitCurrentSpeedsterDetectorIdentity(old), /current release identity/);
  assert.equal(JSON.stringify(old), original);
});
