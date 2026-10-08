import test from 'node:test';
import assert from 'node:assert/strict';
import { settings, preflight } from './vault-stripe-sandbox.mjs';
const env = { VAULT_STRIPE_TEST_SECRET_KEY: 'rk_test_fixture', VAULT_STRIPE_TEST_READER_ID: 'tmr_fixture', VAULT_STRIPE_TEST_LOCATION_ID: 'tml_fixture', VAULT_STRIPE_TEST_MACHINE_ID: '00000000-0000-4000-8000-000000000001' };
test('defaults to read only and rejects live credentials and unknown switches', () => {
  assert.equal(settings(env, []).run, false);
  assert.throws(() => settings({ ...env, VAULT_STRIPE_TEST_SECRET_KEY: 'sk_live_fixture' }, ['--run-test-payment']));
  assert.throws(() => settings(env, ['--live']));
});
const reader = { id: 'tmr_fixture', object: 'terminal.reader', livemode: false, location: 'tml_fixture', device_type: 'simulated_wisepos_e', action: null };
const location = { id: 'tml_fixture', object: 'terminal.location', livemode: false, address: { country: 'US' } };
test('preflight performs only GET and rejects physical, live, busy and cross-location readers', async () => {
  for (const patch of [{ device_type: 'verifone_ux700' }, { livemode: true }, { location: 'tml_other' }, { action: { status: 'in_progress' } }]) {
    await assert.rejects(preflight(settings(env, []), async method => { assert.equal(method, 'GET'); return { ...reader, ...patch }; }));
  }
  const result = await preflight(settings(env, []), async (method, path) => { assert.equal(method, 'GET'); return path.includes('/readers/') ? reader : location; });
  assert.equal(result.unattended, false);
});
