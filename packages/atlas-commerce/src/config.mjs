import { requireValue } from './contract.mjs';
import { fedexAdapter, stripePaymentAdapter, stripeTaxAdapter, stripeTransport } from './providers.mjs';
import { notificationAdapter } from './notifications.mjs';
import { createPackageLabel } from './package-label.mjs';
import { shipStationAdapter } from './shipstation.mjs';

export const COMMERCE_KEYS = Object.freeze([
    'ATLAS_COMMERCE_ENABLED','ATLAS_COMMERCE_CONFIG_HASH','ATLAS_COMMERCE_PROVIDER','ATLAS_COMMERCE_MODE',
    'ATLAS_COMMERCE_STRIPE_ACCOUNT_ID','ATLAS_COMMERCE_STRIPE_SECRET_KEY','ATLAS_COMMERCE_STRIPE_PUBLISHABLE_KEY',
    'ATLAS_COMMERCE_STRIPE_API_VERSION','ATLAS_COMMERCE_STRIPE_WEBHOOK_SECRET','ATLAS_COMMERCE_TAX_CODE',
    'ATLAS_COMMERCE_SHIPPING_TAX_CODE','ATLAS_COMMERCE_TAX_ADDRESS_SOURCE','ATLAS_COMMERCE_TAX_SOURCING_POLICY',
    'ATLAS_COMMERCE_FEDEX_CLIENT_ID','ATLAS_COMMERCE_FEDEX_CLIENT_SECRET','ATLAS_COMMERCE_FEDEX_ACCOUNT_NUMBER',
    'ATLAS_COMMERCE_FEDEX_ENVIRONMENT','ATLAS_COMMERCE_MAIL_CLOCK_START','ATLAS_COMMERCE_MAIL_CHARGED_LEGS',
    'ATLAS_COMMERCE_MAIL_SHIPPING_PAYMENT','ATLAS_COMMERCE_SHIPPING_PROVIDER','ATLAS_COMMERCE_SHIPSTATION_API_KEY','ATLAS_COMMERCE_SHIPSTATION_ENVIRONMENT',
    'ATLAS_COMMERCE_EMAIL_PROVIDER','ATLAS_COMMERCE_EMAIL_API_KEY','ATLAS_COMMERCE_EMAIL_FROM','ATLAS_COMMERCE_SMS_PROVIDER','ATLAS_COMMERCE_SMS_ACCOUNT_SID',
    'ATLAS_COMMERCE_SMS_API_KEY_SID','ATLAS_COMMERCE_SMS_API_KEY_SECRET','ATLAS_COMMERCE_SMS_SERVICE_SID',
]);
/** Safe key presence only. This never returns credential values. */
export function configurationPresence(env) { return Object.fromEntries(COMMERCE_KEYS.map(key=>[key,Boolean(env[key])])); }
export function createCommerceProviders(env, dependencies = {}) {
    if(env.ATLAS_COMMERCE_ENABLED!=='true') return { enabled:false,terms:{mailClockStart:'UNCONFIGURED',mailChargedLegs:'UNCONFIGURED'} };
    requireValue(env.ATLAS_COMMERCE_PROVIDER==='STRIPE' && ['LIVE','TEST'].includes(env.ATLAS_COMMERCE_MODE)
        && /^[a-f0-9]{64}$/.test(env.ATLAS_COMMERCE_CONFIG_HASH??''), 'COMMERCE_NOT_CONFIGURED',503);
    const shippingPayment=env.ATLAS_COMMERCE_MAIL_SHIPPING_PAYMENT??'UPFRONT';
    requireValue(['UPFRONT','SEPARATE_PAYMENT'].includes(shippingPayment),'MAIL_SHIPPING_TERMS_NOT_CONFIGURED',503);
    const transport=stripeTransport({secretKey:env.ATLAS_COMMERCE_STRIPE_SECRET_KEY,apiVersion:env.ATLAS_COMMERCE_STRIPE_API_VERSION,
        accountId:env.ATLAS_COMMERCE_STRIPE_ACCOUNT_ID,livemode:env.ATLAS_COMMERCE_MODE==='LIVE',fetchImpl:dependencies.fetchImpl});
    const payment=stripePaymentAdapter({transport,publishableKey:env.ATLAS_COMMERCE_STRIPE_PUBLISHABLE_KEY});
    const tax=stripeTaxAdapter({transport,taxCode:env.ATLAS_COMMERCE_TAX_CODE,shippingTaxCode:env.ATLAS_COMMERCE_SHIPPING_TAX_CODE,
        addressSource:env.ATLAS_COMMERCE_TAX_ADDRESS_SOURCE,sourcingPolicy:env.ATLAS_COMMERCE_TAX_SOURCING_POLICY,
        allowDeferredShippingTax:shippingPayment==='SEPARATE_PAYMENT'});
    requireValue(env.ATLAS_COMMERCE_EMAIL_PROVIDER==='SENDGRID'&&['TWILIO','DISABLED'].includes(env.ATLAS_COMMERCE_SMS_PROVIDER),'RECEIPTS_NOT_CONFIGURED',503);
    const notifications=notificationAdapter({smsEnabled:env.ATLAS_COMMERCE_SMS_PROVIDER==='TWILIO',emailApiKey:env.ATLAS_COMMERCE_EMAIL_API_KEY,emailFrom:env.ATLAS_COMMERCE_EMAIL_FROM,
        smsAccountSid:env.ATLAS_COMMERCE_SMS_ACCOUNT_SID,smsApiKeySid:env.ATLAS_COMMERCE_SMS_API_KEY_SID,smsApiKeySecret:env.ATLAS_COMMERCE_SMS_API_KEY_SECRET,
        smsServiceSid:env.ATLAS_COMMERCE_SMS_SERVICE_SID,fetchImpl:dependencies.fetchImpl});
    const fedexConfigured=Boolean(env.ATLAS_COMMERCE_FEDEX_CLIENT_ID||env.ATLAS_COMMERCE_FEDEX_CLIENT_SECRET||env.ATLAS_COMMERCE_FEDEX_ACCOUNT_NUMBER);
    const fedex=fedexConfigured?fedexAdapter({clientId:env.ATLAS_COMMERCE_FEDEX_CLIENT_ID,clientSecret:env.ATLAS_COMMERCE_FEDEX_CLIENT_SECRET,
        accountNumber:env.ATLAS_COMMERCE_FEDEX_ACCOUNT_NUMBER,environment:env.ATLAS_COMMERCE_FEDEX_ENVIRONMENT,fetchImpl:dependencies.fetchImpl}):null;
    const provider=env.ATLAS_COMMERCE_SHIPPING_PROVIDER??'FEDEX';
    requireValue(['FEDEX','SHIPSTATION'].includes(provider),'SHIPPING_NOT_CONFIGURED',503);
    const shipstation=env.ATLAS_COMMERCE_SHIPSTATION_API_KEY ? shipStationAdapter({apiKey:env.ATLAS_COMMERCE_SHIPSTATION_API_KEY,
        environment:env.ATLAS_COMMERCE_SHIPSTATION_ENVIRONMENT,fetchImpl:dependencies.fetchImpl}):null;
    requireValue(!fedex || (env.ATLAS_COMMERCE_MODE==='LIVE')===(env.ATLAS_COMMERCE_FEDEX_ENVIRONMENT==='PRODUCTION'),'COMMERCE_PROVIDER_MODE_MISMATCH',503);
    requireValue(!shipstation || (env.ATLAS_COMMERCE_MODE==='LIVE')===(env.ATLAS_COMMERCE_SHIPSTATION_ENVIRONMENT==='PRODUCTION'),'COMMERCE_PROVIDER_MODE_MISMATCH',503);
    const carriers={FEDEX:fedex,SHIPSTATION:shipstation},carrier=carriers[provider];
    return {enabled:true,payment,tax,carrier,carriers,notifications,packageLabel:createPackageLabel,binding:{configHash:env.ATLAS_COMMERCE_CONFIG_HASH,merchant:payment.binding},
        terms:{shippingPayment,mailClockStart:env.ATLAS_COMMERCE_MAIL_CLOCK_START??'UNCONFIGURED',mailChargedLegs:env.ATLAS_COMMERCE_MAIL_CHARGED_LEGS??'UNCONFIGURED'}};
}
