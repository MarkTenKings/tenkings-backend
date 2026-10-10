import test from 'node:test';
import assert from 'node:assert/strict';
import { orderDeskPhotoSettings, validateOrderDeskConfiguration } from '../lib/server/order-desk-runtime-settings.mjs';

const configured = () => ({ ATLAS_MANUAL_DEALER_OPERATIONS_ENABLED: 'true', ATLAS_CUSTOMER_INTAKE_ENABLED: 'true',
  ATLAS_CUSTOMER_STORAGE_ENDPOINT: 'https://storage.example.invalid', ATLAS_CUSTOMER_STORAGE_BUCKET: 'customer-private-photos',
  ATLAS_CUSTOMER_STORAGE_REGION: 'region1', ATLAS_CUSTOMER_STORAGE_ACCESS_KEY: 'fixture-access', ATLAS_CUSTOMER_STORAGE_SECRET_KEY: 'fixture-secret-value' });
test('photo settings use the existing customer namespace and remain inert when disabled', () => {
  assert.equal(orderDeskPhotoSettings({}), null);
  assert.deepEqual(orderDeskPhotoSettings(configured()), { endpoint: 'https://storage.example.invalid', bucket: 'customer-private-photos', region: 'region1' });
  for (const endpoint of ['http://storage.invalid', 'https://name:password@storage.invalid', 'https://storage.invalid/path', 'https://storage.invalid/?query=yes'])
    assert.throws(() => orderDeskPhotoSettings({ ...configured(), ATLAS_CUSTOMER_STORAGE_ENDPOINT: endpoint }), { code: 'ORDER_DESK_PHOTO_CONFIGURATION_INVALID' });
  assert.throws(() => orderDeskPhotoSettings({ ...configured(), ATLAS_CUSTOMER_STORAGE_SECRET_KEY: '' }));
});
test('startup requires both narrow SQL functions and serving EXECUTE grants', async () => {
  let calls = 0;
  await validateOrderDeskConfiguration({ enabled: false, client: { $queryRawUnsafe() { throw Error('disabled'); } } });
  await validateOrderDeskConfiguration({ enabled: true, client: { async $queryRawUnsafe() { calls++; return calls === 1 ? [{ installed: true }] : [{ allowed: true }]; } } });
  assert.equal(calls, 2);
  await assert.rejects(validateOrderDeskConfiguration({ enabled: true, client: { async $queryRawUnsafe() { return [{ installed: false }]; } } }), { code: 'ORDER_DESK_SCHEMA_REQUIRED' });
  calls = 0;
  await assert.rejects(validateOrderDeskConfiguration({ enabled: true, client: { async $queryRawUnsafe() { return ++calls === 1 ? [{ installed: true }] : [{ allowed: false }]; } } }), { code: 'ORDER_DESK_GRANTS_REQUIRED' });
});
