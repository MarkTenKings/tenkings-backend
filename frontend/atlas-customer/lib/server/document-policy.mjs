import { randomBytes } from 'node:crypto';
import { privateHeaders } from './policy.mjs';

// Generate the nonce where Pages Router renders the HTML. Customer page and
// API ingress checks stay in their server handlers; data requests need no
// middleware normalization or caller-supplied nonce header.
export function documentPolicy(response) {
    const nonce = randomBytes(16).toString('base64');
    // Only this configured object-storage origin is admitted for direct,
    // checksum-bound uploads. Arbitrary provider/CDN wildcards stay excluded.
    let uploadSource = '';
    try { const url = new URL(process.env.ATLAS_CUSTOMER_UPLOAD_ORIGIN); if (url.protocol === 'https:' && url.origin === process.env.ATLAS_CUSTOMER_UPLOAD_ORIGIN && !url.username && !url.password) uploadSource = ` ${url.origin}`; } catch { /* Disabled until configured. */ }
    const payments = process.env.ATLAS_COMMERCE_ENABLED === 'true';
    const paymentScripts = payments ? ' https://js.stripe.com https://*.js.stripe.com' : '';
    const paymentFrames = payments ? ' https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com' : '';
    const paymentConnections = payments ? ' https://api.stripe.com' : '';
    if (response && !response.headersSent) {
        privateHeaders(response);
        response.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self' 'nonce-${nonce}'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}${paymentScripts}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'${uploadSource}${paymentConnections}; font-src 'self'; frame-src https://maps.google.com${paymentFrames}; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`);
    }
    return nonce;
}
