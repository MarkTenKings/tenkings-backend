import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { customerServiceSettings, createServingCustomerService } from '../scripts/customer-runtime.mjs';
import { createCustomerServiceClient } from '@atlas/service-bridge/customer-service';

function environment() {
  return {
    ATLAS_CUSTOMER_SERVICE_ENABLED: 'true',
    ATLAS_CUSTOMER_SERVICE_BINDING_JSON: JSON.stringify({ mode: 'PRODUCTION', origin: 'https://atlasgrading.com',
      deploymentId: 'atlas-customer-fixture.vercel.app', releaseSha: 'a'.repeat(40), configHash: 'b'.repeat(64) }),
    ATLAS_CUSTOMER_PRIVATE_DATABASE_URL: 'postgresql://fixture:synthetic@database.invalid/customer?schema=atlas_customer&sslmode=require',
    ATLAS_CUSTOMER_SERVICE_KEY: randomBytes(32).toString('base64'),
    ATLAS_CUSTOMER_DIRECTORY_KEY: randomBytes(32).toString('base64'),
  };
}

test('disabled private customer service constructs no database or provider client', () => {
  let constructions = 0;
  class Client { constructor() { constructions++; } }
  for (const enabled of [undefined, 'false', 'TRUE']) {
    const env = { ATLAS_CUSTOMER_SERVICE_ENABLED: enabled, ATLAS_COMMERCE_ENABLED: 'true' };
    assert.equal(customerServiceSettings(env), null);
    assert.equal(createServingCustomerService({ env, Client }), null);
  }
  assert.equal(constructions, 0);
});

test('production customer service rejects hosted execution, weak binding and reused credentials', () => {
  const base = environment();
  const mutations = [
    { VERCEL: '1' }, { AWS_LAMBDA_FUNCTION_NAME: 'fixture' },
    { ATLAS_CUSTOMER_SERVICE_KEY: 'invalid' },
    { ATLAS_CUSTOMER_DIRECTORY_KEY: base.ATLAS_CUSTOMER_SERVICE_KEY },
    { ATLAS_CUSTOMER_PRIVATE_DATABASE_URL: base.ATLAS_CUSTOMER_PRIVATE_DATABASE_URL.replace('atlas_customer', 'public') },
    { ATLAS_CUSTOMER_PRIVATE_DATABASE_URL: base.ATLAS_CUSTOMER_PRIVATE_DATABASE_URL.replace('require', 'disable') },
    { ATLAS_CUSTOMER_SERVICE_BINDING_JSON: JSON.stringify({ ...JSON.parse(base.ATLAS_CUSTOMER_SERVICE_BINDING_JSON), accountId: 'forged' }) },
    { ATLAS_CUSTOMER_IDENTIFICATION_ENABLED: 'true' },
    ...['ATLAS_MANUAL_SERVICE_KEY', 'ATLAS_MANUAL_PUBLIC_READ_KEY', 'ATLAS_CUSTOMER_SESSION_KEY', 'ATLAS_CUSTOMER_PHONE_KEY', 'ATLAS_CUSTOMER_ROUTER_KEY']
      .flatMap(key => [{ [key]: base.ATLAS_CUSTOMER_SERVICE_KEY }, { [key]: base.ATLAS_CUSTOMER_DIRECTORY_KEY }]),
  ];
  for (const mutation of mutations) assert.throws(() => customerServiceSettings({ ...base, ...mutation }),
    { code: 'CUSTOMER_SERVICE_CONFIGURATION_REQUIRED' });
  assert.equal(customerServiceSettings(base).identificationEnabled, false);
});

test('photo storage requires its own complete canonical configuration', () => {
  const env = { ...environment(), ATLAS_CUSTOMER_INTAKE_ENABLED: 'true',
    ATLAS_CUSTOMER_STORAGE_ENDPOINT: 'https://storage.invalid', ATLAS_CUSTOMER_UPLOAD_ORIGIN: 'https://uploads.invalid',
    ATLAS_CUSTOMER_STORAGE_BUCKET: 'customer-fixture', ATLAS_CUSTOMER_STORAGE_REGION: 'us-east-1',
    ATLAS_CUSTOMER_STORAGE_ACCESS_KEY: 'synthetic-access', ATLAS_CUSTOMER_STORAGE_SECRET_KEY: 'synthetic-secret-only' };
  assert.equal(customerServiceSettings(env).storage.bucket, 'customer-fixture');
  for (const key of ['ATLAS_CUSTOMER_STORAGE_ENDPOINT', 'ATLAS_CUSTOMER_UPLOAD_ORIGIN', 'ATLAS_CUSTOMER_STORAGE_BUCKET',
    'ATLAS_CUSTOMER_STORAGE_REGION', 'ATLAS_CUSTOMER_STORAGE_ACCESS_KEY', 'ATLAS_CUSTOMER_STORAGE_SECRET_KEY'])
    assert.throws(() => customerServiceSettings({ ...env, [key]: '' }), { code: 'CUSTOMER_SERVICE_CONFIGURATION_REQUIRED' });
  for (const value of ['http://storage.invalid', 'https://storage.invalid/path', 'https://user:pass@storage.invalid', 'https://storage.invalid/'])
    assert.throws(() => customerServiceSettings({ ...env, ATLAS_CUSTOMER_STORAGE_ENDPOINT: value }), { code: 'CUSTOMER_SERVICE_CONFIGURATION_REQUIRED' });
});

test('cold runtime serves only signed directory reads through its restricted role and drains on close', async t => {
  const env = environment(), queries = [];
  let disconnected = 0, transactions = 0, options;
  class Client {
    constructor(value) { options = value; }
    async $transaction(run) {
      transactions++;
      return run({
        async $queryRaw(strings, ...values) {
          const sql = strings.join('?');
          if (sql.includes('FROM pg_roles')) return [{ unsafe: false }];
          if (sql.includes('AS schema_write')) return [{ schema_write: false, table_access: false, sequence_access: false }];
          if (sql.includes('FROM pg_proc')) return [{ schema: 'atlas_customer', name: 'customer_private_call(text, jsonb, jsonb)', definer: true }];
          assert.match(sql, /SELECT atlas_customer.customer_private_call/);
          queries.push(values);
          return [{ result: { locations: [] } }];
        },
        async $executeRaw(strings) { assert.match(strings.join(''), /SET CONSTRAINTS ALL IMMEDIATE/); },
      });
    }
    async $disconnect() { disconnected++; }
  }
  const runtime = createServingCustomerService({ env, Client });
  runtime.start();
  assert.equal(transactions, 0);
  assert.equal(new URL(options.datasources.db.url).searchParams.get('schema'), 'atlas_customer');
  const server = createServer(async (req, res) => {
    if (!await runtime.handler(req, res)) { res.statusCode = 404; res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await runtime.stopWorkers();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await runtime.close();
    assert.equal(disconnected, 1);
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const client = createCustomerServiceClient({ url, key: Buffer.from(env.ATLAS_CUSTOMER_DIRECTORY_KEY, 'base64'), allowLoopbackForTests: true });
  assert.deepEqual(await client.call('dealer-locations', { input: {} }), { locations: [] });
  assert.equal(transactions, 1);
  assert.deepEqual(queries[0], ['directory', env.ATLAS_CUSTOMER_SERVICE_BINDING_JSON, JSON.stringify({ input: {} })]);
  const authority = { binding: JSON.parse(env.ATLAS_CUSTOMER_SERVICE_BINDING_JSON), sessionHash: 'c'.repeat(64), browserHash: 'd'.repeat(64) };
  await assert.rejects(client.call('commerce-pay', { authority, input: {} }), { status: 401 });
  assert.equal((await fetch(url + '/internal/commerce/stripe-webhook', { method: 'POST', body: '{}' })).status, 503);
  assert.equal(transactions, 1);
});
