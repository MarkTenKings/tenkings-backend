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

test('photo and payment sources are narrowly scoped and payment origins are disabled by default', () => {
    const oldUpload = process.env.ATLAS_CUSTOMER_UPLOAD_ORIGIN, oldCommerce = process.env.ATLAS_COMMERCE_ENABLED;
    const read = () => { const response = { setHeader(key, value) { this[key] = value; } }; documentPolicy(response); return response['Content-Security-Policy']; };
    try {
        delete process.env.ATLAS_COMMERCE_ENABLED; process.env.ATLAS_CUSTOMER_UPLOAD_ORIGIN = 'https://private-photos.example';
        const basic = read(); assert.match(basic, /img-src 'self' data: blob:/); assert.match(basic, /media-src 'self' blob:;/); assert.doesNotMatch(basic.split('media-src ')[1].split(';')[0], /https:|\*/); assert.match(basic, /connect-src 'self' https:\/\/private-photos.example;/); assert.doesNotMatch(basic, /stripe/);
        process.env.ATLAS_COMMERCE_ENABLED = 'true'; assert.match(read(), /https:\/\/api\.stripe\.com/); assert.match(read(), /https:\/\/hooks\.stripe\.com/);
        for (const value of ['https://evil.example; connect-src *', 'http://photos.example', 'https://photos.example/path', 'https://name:secret@photos.example']) {
            process.env.ATLAS_CUSTOMER_UPLOAD_ORIGIN = value; assert.doesNotMatch(read(), /(?:evil|photos)\.example/);
        }
    } finally {
        if (oldUpload === undefined) delete process.env.ATLAS_CUSTOMER_UPLOAD_ORIGIN; else process.env.ATLAS_CUSTOMER_UPLOAD_ORIGIN = oldUpload;
        if (oldCommerce === undefined) delete process.env.ATLAS_COMMERCE_ENABLED; else process.env.ATLAS_COMMERCE_ENABLED = oldCommerce;
    }
});
