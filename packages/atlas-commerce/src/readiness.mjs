import { COMMERCE_KEYS, createCommerceProviders } from './config.mjs';

// Static inspection only. Credentials, live account eligibility, tax registration,
// sender approval, measured packages and physical equipment remain unverified.
export function inspectCommerceConfiguration(env = {}) {
    const enabled = env.ATLAS_COMMERCE_ENABLED === 'true';
    const missing = COMMERCE_KEYS.filter(key => key !== 'ATLAS_COMMERCE_ENABLED' && !env[key]);
    const invalid = [];
    const check = (key, valid) => { if (env[key] && !valid(env[key])) invalid.push(key); };
    const oneOf = (...values) => value => values.includes(value);
    check('ATLAS_COMMERCE_ENABLED', oneOf('true', 'false'));
    check('ATLAS_COMMERCE_CONFIG_HASH', value => /^[a-f0-9]{64}$/.test(value));
    check('ATLAS_COMMERCE_PROVIDER', oneOf('STRIPE'));
    check('ATLAS_COMMERCE_MODE', oneOf('TEST', 'LIVE'));
    check('ATLAS_COMMERCE_STRIPE_ACCOUNT_ID', value => /^acct_[A-Za-z0-9]+$/.test(value));
    const mode = env.ATLAS_COMMERCE_MODE;
    check('ATLAS_COMMERCE_STRIPE_SECRET_KEY', value => value.startsWith(mode === 'LIVE' ? 'sk_live_' : 'sk_test_'));
    check('ATLAS_COMMERCE_STRIPE_PUBLISHABLE_KEY', value => value.startsWith(mode === 'LIVE' ? 'pk_live_' : 'pk_test_'));
    check('ATLAS_COMMERCE_STRIPE_API_VERSION', value => /^\d{4}-\d{2}-\d{2}(?:\.[a-z]+)?$/.test(value));
    check('ATLAS_COMMERCE_STRIPE_WEBHOOK_SECRET', value => /^whsec_\S+$/.test(value));
    for (const key of ['ATLAS_COMMERCE_TAX_CODE', 'ATLAS_COMMERCE_SHIPPING_TAX_CODE']) check(key, value => /^txcd_[0-9]+$/.test(value));
    check('ATLAS_COMMERCE_TAX_ADDRESS_SOURCE', oneOf('billing', 'shipping'));
    check('ATLAS_COMMERCE_TAX_SOURCING_POLICY', oneOf('MAIL_RETURN_ADDRESS_KIOSK_LOCATION'));
    check('ATLAS_COMMERCE_FEDEX_ACCOUNT_NUMBER', value => /^\d{6,12}$/.test(value));
    check('ATLAS_COMMERCE_FEDEX_ENVIRONMENT', oneOf(mode === 'LIVE' ? 'PRODUCTION' : 'SANDBOX'));
    check('ATLAS_COMMERCE_MAIL_CLOCK_START', oneOf('ATLAS_RECEIPT', 'CARRIER_ACCEPTANCE'));
    check('ATLAS_COMMERCE_MAIL_CHARGED_LEGS', oneOf('INBOUND_ONLY', 'BOTH_LEGS'));
    check('ATLAS_COMMERCE_EMAIL_PROVIDER', oneOf('SENDGRID'));
    check('ATLAS_COMMERCE_EMAIL_FROM', value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
    check('ATLAS_COMMERCE_SMS_PROVIDER', oneOf('TWILIO'));
    check('ATLAS_COMMERCE_SMS_ACCOUNT_SID', value => /^AC[a-fA-F0-9]{32}$/.test(value));
    check('ATLAS_COMMERCE_SMS_API_KEY_SID', value => /^SK[a-fA-F0-9]{32}$/.test(value));
    check('ATLAS_COMMERCE_SMS_SERVICE_SID', value => /^MG[a-fA-F0-9]{32}$/.test(value));
    let adaptersValid = false;
    if (missing.length === 0 && invalid.length === 0) {
        try {
            // Construction must never perform a network request. Do not echo
            // exception messages: a future adapter may include sensitive input.
            createCommerceProviders({ ...env, ATLAS_COMMERCE_ENABLED: 'true' }, {
                fetchImpl: () => { throw new Error('NETWORK_FORBIDDEN_DURING_CONFIGURATION_CHECK'); },
            });
            adaptersValid = true;
        } catch { /* Only the fixed status below is returned. */ }
    }
    return {
        status: !enabled ? 'COLD' : adaptersValid ? 'READY_FOR_PROVIDER_QUALIFICATION' : 'INCOMPLETE',
        enabled, missing, invalid, adaptersValid,
        externalVerification: 'NOT_PERFORMED',
        activationGates: ['MERCHANT_AND_TAX', 'FEDEX_ACCOUNT_AND_MEASURED_PACKAGES', 'RECEIPT_SENDERS',
            'PRIVATE_STORAGE_AND_TRANSPORT', 'DEPLOYMENT_BOUND_DATABASE_CONTROLS', 'KIOSK_LOCATION_AND_EQUIPMENT', 'END_TO_END_ACCEPTANCE'],
    };
}
