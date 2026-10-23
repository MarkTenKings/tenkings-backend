import test from 'node:test';
import assert from 'node:assert/strict';
import { createProofDecoderClient } from '../src/proof-decoder-client.mjs';
import { assertProofImageValidator } from '../src/proof-image.mjs';
import { instantiateMarketplacePhysical } from '../src/physical-runtime.mjs';
import { createProofDecoderLaunchPlan } from '../src/proof-decoder-profile.mjs';
import { syntheticDecoderProfile } from './proof-decoder-profile-fixtures.mjs';

test('an unqualified protocol client cannot become an accepted proof validator or physical factory', async () => {
  const client = createProofDecoderClient({
    enabled: true,
    socketPath: '/tmp/atlas-decoder-admission-test-never-opened.sock',
    expectedQualificationHash: 'a'.repeat(64),
    expectedEpoch: 'synthetic-admission-boundary',
    limits: { maxObjectBytes: 10485760, maxPixels: 16000000, timeoutMs: 15000, maxConcurrent: 2 },
  });
  try {
    assert.throws(() => assertProofImageValidator(client), { code: 'PROOF_DECODER_UNAVAILABLE' });
    assert.throws(() => instantiateMarketplacePhysical(client, {}), { code: 'PHYSICAL_FACTORY_UNQUALIFIED' });
    assert.throws(() => assertProofImageValidator(Object.freeze({ ...client, qualified: true, assertReady: () => true })), { code: 'PROOF_DECODER_UNAVAILABLE' });
  } finally {
    await client.close();
  }
});

test('independent launch-plan and client contracts bind the same exact limits without conferring authority', async () => {
  const profile = syntheticDecoderProfile();
  const plan = createProofDecoderLaunchPlan({ enabled: true, profile });
  const client = createProofDecoderClient({
    enabled: true,
    socketPath: profile.ipc.socketPath,
    expectedQualificationHash: 'b'.repeat(64),
    expectedEpoch: 'synthetic-cross-contract',
    limits: profile.limits,
  });
  try {
    assert.equal(client.status().limitsHash, plan.limitsHash);
    assert.equal(client.status().classification, 'UNQUALIFIED');
    assert.equal(plan.executionAllowed, false);
    assert.notEqual(plan.profileHash, plan.limitsHash);
  } finally {
    await client.close();
  }
});
