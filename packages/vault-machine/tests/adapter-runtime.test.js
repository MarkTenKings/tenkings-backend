const test = require('node:test');
const assert = require('node:assert/strict');
const { createAdapterRuntime } = require('../dist/adapter-runtime');
const { tempDatabase, crypto } = require('./helpers');
const fs = require('node:fs');

test('missing, unknown and mixed mock-payment physical-controller selections fail before effects', () => {
  for (const env of [{}, { VAULT_PAYMENT_ADAPTER: 'MOCK', VAULT_CONTROLLER_ADAPTER: 'waveshare' }, { VAULT_PAYMENT_ADAPTER: 'LIVE', VAULT_CONTROLLER_ADAPTER: 'SIMULATOR' }, { VAULT_PAYMENT_ADAPTER: 'MOCK', VAULT_CONTROLLER_ADAPTER: 'WAVESHARE' }]) {
    assert.throws(() => createAdapterRuntime(env, '/not-created/vault.sqlite', crypto.randomUUID()));
  }
});
test('explicit simulated composition retains durable provider and rejects removed adapters', async () => {
  const dir = tempDatabase(); let adapters;
  try {
    adapters = createAdapterRuntime({ VAULT_PAYMENT_ADAPTER: 'MOCK', VAULT_CONTROLLER_ADAPTER: 'SIMULATOR' }, dir.path, crypto.randomUUID());
    await adapters.initializeReadOnly(); assert.equal((await adapters.payment.capabilities()).mode, 'MOCK');
    await adapters.close();
    assert.throws(() => createAdapterRuntime({ VAULT_PAYMENT_ADAPTER: 'REMOVED_ADAPTER', VAULT_CONTROLLER_ADAPTER: 'SIMULATOR' }, dir.path, crypto.randomUUID()), /VAULT_ADAPTER_SELECTION_REQUIRED/);
  } finally { await adapters?.close(); fs.rmSync(dir.directory, { recursive: true, force: true }); }
});

test('Spark runtime requires explicit sandbox binding and authenticated observations and never permits physical pairing', async () => {
  const dir = tempDatabase(); const machineId = crypto.randomUUID(); let adapters;
  const env = { VAULT_PAYMENT_ADAPTER: 'NAYAX_SPARK_TEST', VAULT_CONTROLLER_ADAPTER: 'SIMULATOR' };
  try {
    assert.throws(() => createAdapterRuntime(env, dir.path, machineId), /VAULT_SPARK_CONFIG_PATH/);
    assert.throws(() => createAdapterRuntime({ ...env, VAULT_CONTROLLER_ADAPTER: 'WAVESHARE' }, dir.path, machineId), /TEST_PAYMENT_CANNOT_AUTHORIZE_PHYSICAL_CONTROLLER/);
    const configPath = require('node:path').join(dir.directory, 'spark.json');
    fs.writeFileSync(configPath, JSON.stringify({ apiBase: 'https://fixture-qa.nayax.com/api', integratorId: '123', tokenId: 123,
      terminalId: '12345', terminalIdType: 2, nayaxMachineId: '12345', hwSerial: 'FIXTURE123', siteId: 1,
      environment: 'SANDBOX', sandboxConfirmed: true, preSelectionConfirmed: true, currency: 'USD', currencyConfirmed: true,
      signingProfile: 'MANUAL_BODY_SHA256', wireApiVersion: null, vendorApprovalReference: 'fixture-confirmation', maxTotalCents: 500000, acquiringOnlyConfirmed: true,
      callbackTerminalIdRepresentation: 'HW_SERIAL', cardUidPolicy: 'REJECT_AMBIGUOUS', acquiringCardBrands: [], unsupportedCardBrands: [],
      triggerReplayPolicy: 'DISABLED', cancelReplayPolicy: 'DISABLED', maxTriggerAttempts: 1, maxCancelAttempts: 1 }));
    Object.assign(env, { VAULT_SPARK_CONFIG_PATH: configPath, VAULT_SPARK_TOKEN_SECRET: '0'.repeat(32), VAULT_SPARK_SIGN_KEY: 'fixture-signing-secret' });
    assert.throws(() => createAdapterRuntime(env, dir.path, machineId), /SPARK_AUTHENTICATED_OBSERVATION_SOURCE_REQUIRED/);
    adapters = createAdapterRuntime(env, dir.path, machineId, { readSparkObservations: async () => [], readSparkReceiptFeed: async after => ({ observations: [], nextCursor: after, hasMore: false }) });
    const capabilities = await adapters.payment.capabilities();
    assert.equal(capabilities.provider, 'NAYAX_SPARK'); assert.equal(capabilities.mode, 'OFFICIAL_TEST'); assert.equal(capabilities.captureBeforeFulfillment, true);
    assert.match(capabilities.bindingDigest, /^[a-f0-9]{64}$/);
    await adapters.initializeReadOnly();
    assert.equal((await adapters.controller.identity()).mode, 'MOCK');
  } finally { await adapters?.close(); fs.rmSync(dir.directory, { recursive: true, force: true }); }
});

test('Spark observations use scoped machine auth and reject mismatched transport envelopes', async () => {
  const { VaultCloudClient } = require('../dist/cloud-client');
  const machineId = crypto.randomUUID(), sparkId = crypto.randomUUID(); const requests = []; let body = { instruction: 'RECONCILE_ONLY', sparkTransactionId: sparkId, observations: [] };
  const cloud = new VaultCloudClient({ origin: 'https://vault-cloud.invalid', machineId, credential: () => 'vault_fixture', fetch: async (url, options) => {
    requests.push({ url, options }); return Response.json(body);
  } });
  assert.deepEqual(await cloud.sparkObservations(sparkId), []);
  assert.equal(requests[0].options.headers.Authorization, 'VaultMachine vault_fixture');
  const url = new URL(requests[0].url); assert.equal(url.searchParams.get('machineId'), machineId); assert.equal(url.searchParams.get('sparkTransactionId'), sparkId);
  body = { ...body, sparkTransactionId: crypto.randomUUID() };
  await assert.rejects(cloud.sparkObservations(sparkId), { code: 'SPARK_OBSERVATIONS_INVALID' });
  await assert.rejects(cloud.sparkObservations('invalid/query'), { code: 'SPARK_TRANSACTION_ID_INVALID' });
  assert.equal(requests.length, 2);
});

test('receipt cursor transport rejects skips, rollback, precision loss and empty continuation', async () => {
  const { VaultCloudClient } = require('../dist/cloud-client');
  const machineId = crypto.randomUUID(); let body = { instruction: 'RECONCILE_ONLY', observations: [], nextCursor: '9007199254740993', hasMore: false };
  const cloud = new VaultCloudClient({ origin: 'https://vault-cloud.invalid', machineId, credential: () => 'vault_fixture', fetch: async () => Response.json(body) });
  assert.equal((await cloud.sparkReceipts('9007199254740993')).nextCursor, '9007199254740993');
  for (const patch of [{ nextCursor: 9007199254740993 }, { nextCursor: '9007199254740992' }, { nextCursor: '9007199254740994' }, { hasMore: true }, { nextCursor: '9223372036854775808' }]) {
    const old = body; body = { ...body, ...patch }; await assert.rejects(cloud.sparkReceipts('9007199254740993')); body = old;
  }
});

test('approved action transport rejects foreign machine or duplicate action identity', async () => {
  const { VaultCloudClient } = require('../dist/cloud-client');
  const machineId = crypto.randomUUID(); const action = { actionId: crypto.randomUUID(), machineId, saleId: crypto.randomUUID(), provider: 'NAYAX_SPARK', paymentBindingDigest: 'a'.repeat(64), providerSessionReference: 'sha256:' + 'b'.repeat(64), providerTransactionReference: 'sha256:' + 'c'.repeat(64), amountCents: 100, currency: 'USD', reason: 'Reviewed full sale void', approvedByAdminId: 'admin', approvedAt: '2026-10-07T12:00:00Z', expiresAt: '2026-10-07T12:05:00Z' };
  let body = { instruction: 'APPROVED_PAYMENT_ACTIONS_ONLY', actions: [action] };
  const cloud = new VaultCloudClient({ origin: 'https://vault-cloud.invalid', machineId, credential: () => 'vault_fixture', fetch: async () => Response.json(body) });
  assert.equal((await cloud.paymentActions()).length, 1);
  body.actions = [{ ...action, machineId: crypto.randomUUID() }]; await assert.rejects(cloud.paymentActions());
  body.actions = [action, action]; await assert.rejects(cloud.paymentActions());
});
