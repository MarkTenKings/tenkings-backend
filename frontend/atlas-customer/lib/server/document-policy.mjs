import { randomBytes } from 'node:crypto';
import { privateHeaders } from './policy.mjs';

// Generate the nonce where Pages Router renders the HTML. Customer page and
// API ingress checks stay in their server handlers; data requests need no
// middleware normalization or caller-supplied nonce header.
export function documentPolicy(response) {
    const nonce = randomBytes(16).toString('base64');
    if (response && !response.headersSent) {
        privateHeaders(response);
        response.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self' 'nonce-${nonce}'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`);
    }
    return nonce;
}
