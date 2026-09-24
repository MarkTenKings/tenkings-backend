import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMERCE_KEYS } from '../src/config.mjs';
import { inspectCommerceConfiguration } from '../src/readiness.mjs';

function settings() {
    const env = Object.fromEntries(COMMERCE_KEYS.map(key => [key, 'PRIVATE_FIXTURE_VALUE_NEVER_PRINT']));
    return { ...env, ATLAS_COMMERCE_ENABLED: 'true', ATLAS_COMMERCE_CONFIG_HASH: 'a'.repeat(64),
        ATLAS_COMMERCE_PROVIDER: 'STRIPE', ATLAS_COMMERCE_MODE: 'TEST',
        ATLAS_COMMERCE_STRIPE_ACCOUNT_ID: 'acct_fixture', ATLAS_COMMERCE_STRIPE_SECRET_KEY: 'sk_test_PRIVATE_FIXTURE',
        ATLAS_COMMERCE_STRIPE_PUBLISHABLE_KEY: 'pk_test_PRIVATE_FIXTURE', ATLAS_COMMERCE_STRIPE_API_VERSION: '2026-01-01',
        ATLAS_COMMERCE_STRIPE_WEBHOOK_SECRET: 'whsec_PRIVATE_FIXTURE',
        ATLAS_COMMERCE_TAX_CODE: 'txcd_10000000', ATLAS_COMMERCE_SHIPPING_TAX_CODE: 'txcd_92010001',
        ATLAS_COMMERCE_TAX_ADDRESS_SOURCE: 'shipping', ATLAS_COMMERCE_TAX_SOURCING_POLICY: 'MAIL_RETURN_ADDRESS_KIOSK_LOCATION',
        ATLAS_COMMERCE_FEDEX_ACCOUNT_NUMBER: '123456789', ATLAS_COMMERCE_FEDEX_ENVIRONMENT: 'SANDBOX',
        ATLAS_COMMERCE_MAIL_CLOCK_START: 'ATLAS_RECEIPT', ATLAS_COMMERCE_MAIL_CHARGED_LEGS: 'BOTH_LEGS',
        ATLAS_COMMERCE_EMAIL_PROVIDER: 'SENDGRID', ATLAS_COMMERCE_EMAIL_FROM: 'fixture@example.invalid',
        ATLAS_COMMERCE_SMS_PROVIDER: 'TWILIO', ATLAS_COMMERCE_SMS_ACCOUNT_SID: `AC${'a'.repeat(32)}`,
        ATLAS_COMMERCE_SMS_API_KEY_SID: `SK${'b'.repeat(32)}`, ATLAS_COMMERCE_SMS_SERVICE_SID: `MG${'c'.repeat(32)}` };
}

test('absent settings remain cold and report only key names', () => {
    const result = inspectCommerceConfiguration({ UNRELATED_SECRET: 'do-not-read' });
    assert.equal(result.status, 'COLD');
    assert.equal(result.adaptersValid, false);
    assert.equal(result.missing.length, COMMERCE_KEYS.length - 1);
    assert.doesNotMatch(JSON.stringify(result), /do-not-read|UNRELATED_SECRET/);
});

test('complete static configuration never claims live readiness or exposes values', () => {
    const env = settings();
    const result = inspectCommerceConfiguration(env);
    assert.equal(result.status, 'READY_FOR_PROVIDER_QUALIFICATION');
    assert.equal(result.externalVerification, 'NOT_PERFORMED');
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.invalid, []);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_FIXTURE|fixture@example|123456789|acct_fixture/);
    assert.equal(inspectCommerceConfiguration({ ...env, ATLAS_COMMERCE_ENABLED: 'false' }).status, 'COLD');
});

test('missing webhook and mismatched provider modes refuse qualification', () => {
    const env = settings();
    delete env.ATLAS_COMMERCE_STRIPE_WEBHOOK_SECRET;
    env.ATLAS_COMMERCE_STRIPE_SECRET_KEY = 'sk_live_PRIVATE_FIXTURE';
    env.ATLAS_COMMERCE_FEDEX_ENVIRONMENT = 'PRODUCTION';
    const result = inspectCommerceConfiguration(env);
    assert.equal(result.status, 'INCOMPLETE');
    assert.deepEqual(result.missing, ['ATLAS_COMMERCE_STRIPE_WEBHOOK_SECRET']);
    assert.deepEqual(result.invalid, ['ATLAS_COMMERCE_STRIPE_SECRET_KEY', 'ATLAS_COMMERCE_FEDEX_ENVIRONMENT']);
    assert.doesNotMatch(JSON.stringify(result), /sk_live_PRIVATE/);
});

test('unsettled mail terms and malformed activation switches are explicit', () => {
    const env = settings();
    env.ATLAS_COMMERCE_MAIL_CLOCK_START = 'UNCONFIGURED';
    env.ATLAS_COMMERCE_MAIL_CHARGED_LEGS = 'UNCONFIGURED';
    env.ATLAS_COMMERCE_ENABLED = 'yes';
    const result = inspectCommerceConfiguration(env);
    assert.equal(result.enabled, false);
    assert.equal(result.adaptersValid, false);
    assert.deepEqual(result.invalid, ['ATLAS_COMMERCE_ENABLED', 'ATLAS_COMMERCE_MAIL_CLOCK_START', 'ATLAS_COMMERCE_MAIL_CHARGED_LEGS']);
});
