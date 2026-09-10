import test from 'node:test';
import assert from 'node:assert/strict';
import { documentPolicy } from '../lib/server/document-policy.mjs';

test('each customer HTML response gets its own nonce and private CSP', () => {
    const response = () => ({ headers: {}, setHeader(name, value) { this.headers[name] = value; } });
    const first = response(), second = response();
    const a = documentPolicy(first), b = documentPolicy(second);
    assert.notEqual(a, b);
    assert.equal(Buffer.from(a, 'base64').length, 16);
    for (const [res, nonce] of [[first, a], [second, b]]) {
        const csp = res.headers['Content-Security-Policy'];
        assert(csp.includes(`'nonce-${nonce}'`));
        assert.doesNotMatch(csp.split('script-src ')[1].split(';')[0], /unsafe-inline/);
        assert.match(csp, /frame-ancestors 'none'/);
        assert.match(res.headers['Cache-Control'], /private, no-store/);
        assert.equal(res.headers['CDN-Cache-Control'], 'no-store');
        assert.equal(res.headers['Vercel-CDN-Cache-Control'], 'no-store');
    }
});

test('build-time document rendering needs no request or external runtime', () => {
    assert.equal(Buffer.from(documentPolicy(), 'base64').length, 16);
});
