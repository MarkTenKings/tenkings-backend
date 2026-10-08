/** Explicit sandbox-only API acceptance. No machine runtime, DB or controller is loaded. */
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

export function settings(env, args) {
  if (args.some(arg => !['--run-test-payment', '--scenario=success', '--scenario=decline', '--scenario=cancel'].includes(arg))) throw new Error('USAGE');
  if (args.filter(arg => arg.startsWith('--scenario=')).length > 1) throw new Error('USAGE');
  const secretKey = env.VAULT_STRIPE_TEST_SECRET_KEY;
  const readerId = env.VAULT_STRIPE_TEST_READER_ID;
  const locationId = env.VAULT_STRIPE_TEST_LOCATION_ID;
  const machineId = env.VAULT_STRIPE_TEST_MACHINE_ID;
  if (!/^(sk|rk)_test_[A-Za-z0-9_]+$/.test(secretKey ?? '') || !/^tmr_[A-Za-z0-9]+$/.test(readerId ?? '') || !/^tml_[A-Za-z0-9]+$/.test(locationId ?? '') || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(machineId ?? '')) throw new Error('TEST_CONFIGURATION_REQUIRED');
  return { secretKey, readerId, locationId, machineId, run: args.includes('--run-test-payment'), scenario: args.find(arg => arg.startsWith('--scenario='))?.split('=')[1] ?? 'success' };
}

export async function preflight(config, api) {
  const reader = await api('GET', `/v1/terminal/readers/${config.readerId}`);
  if (reader.id !== config.readerId || reader.object !== 'terminal.reader' || reader.livemode !== false || reader.location !== config.locationId || reader.device_type !== 'simulated_wisepos_e') throw new Error('SIMULATED_TEST_READER_REQUIRED');
  if (reader.action?.status === 'in_progress') throw new Error('READER_BUSY');
  const location = await api('GET', `/v1/terminal/locations/${config.locationId}`);
  if (location.id !== config.locationId || location.object !== 'terminal.location' || location.livemode !== false || location.address?.country !== 'US') throw new Error('US_TEST_LOCATION_REQUIRED');
  return { readerId: reader.id, locationId: location.id, readerType: reader.device_type, unattended: location.attended_type === 'UNATTENDED' && location.unattended?.premise_type === 'OFF_PREMISE' };
}

async function main() {
  const config = settings(process.env, process.argv.slice(2));
  const api = async (method, path, fields) => {
    let response;
    try {
      response = await fetch(`https://api.stripe.com${path}`, { method, redirect: 'error', headers: { Authorization: `Bearer ${config.secretKey}`, ...(fields ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }, ...(fields ? { body: new URLSearchParams(fields) } : {}), signal: AbortSignal.timeout(12000) });
    } catch { throw new Error('STRIPE_NETWORK_OUTCOME_UNKNOWN'); }
    if (!response.ok) throw new Error(`STRIPE_HTTP_${response.status}`);
    try { return await response.json(); } catch { throw new Error('STRIPE_RESPONSE_INVALID'); }
  };
  const checked = await preflight(config, api);
  console.log(JSON.stringify({ phase: 'read-only-preflight', ...checked }));
  if (!config.run) return;
  const require = createRequire(import.meta.url);
  const { StripeTerminalTestAdapter } = require('../packages/vault-machine/dist/stripe-terminal-test-adapter.js');
  const adapter = new StripeTerminalTestAdapter(config);
  const saleId = randomUUID();
  const request = { saleId, idempotencyKey: saleId, mode: 'CERTIFICATION', currency: 'USD', totalCents: 100, items: [{ lineId: randomUUID(), name: 'Vault sandbox acceptance', priceCents: 100 }] };
  // Print safe identity before the first mutation so a lost response remains traceable.
  console.log(JSON.stringify({ phase: 'starting-test-payment', machineId: config.machineId, saleId, scenario: config.scenario }));
  const started = await adapter.startSession(request);
  console.log(JSON.stringify({ phase: 'started', saleId, paymentIntentId: started.providerSessionId, state: started.state }));
  let result;
  if (config.scenario === 'cancel') result = await adapter.cancelSession(started.providerSessionId, saleId);
  else {
    await api('POST', `/v1/test_helpers/terminal/readers/${config.readerId}/present_payment_method`, { type: 'card_present', 'card_present[number]': config.scenario === 'decline' ? '4000000000000002' : '4242424242424242' });
    for (let attempt = 0; attempt < 12; attempt++) {
      result = await adapter.reconcile(started.providerSessionId);
      if (['SETTLED', 'DECLINED', 'CANCELLED'].includes(result.state)) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  const expected = { success: 'SETTLED', decline: 'DECLINED', cancel: 'CANCELLED' }[config.scenario];
  console.log(JSON.stringify({ phase: 'result', saleId, paymentIntentId: started.providerSessionId, expected, observed: result?.state, passed: result?.state === expected }));
  if (result?.state !== expected) throw new Error('TEST_OUTCOME_REQUIRES_REVIEW');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  // Never print provider bodies, stacks, keys, customer fields, or raw network errors.
  const code = String(error?.code ?? error?.message ?? 'SANDBOX_FAILED');
  console.error(/^[A-Z][A-Z0-9_]{1,100}$/.test(code) ? code : 'SANDBOX_FAILED');
  process.exitCode = 1;
});
