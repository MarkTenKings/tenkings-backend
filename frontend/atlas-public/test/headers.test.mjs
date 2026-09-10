import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import config from '../next.config.mjs';

const require = createRequire(import.meta.url);
const { getPathMatch } = require('next/dist/shared/lib/router/utils/path-match.js');
const { modifyRouteRegex } = require('next/dist/lib/redirect-status.js');
const { buildCustomRoute } = require('next/dist/lib/build-custom-route.js');

test('public CSP leaves mounted staff/customer policies intact while common headers stay global', async () => {
    const rules = (await config.headers()).map(rule => ({ ...rule,
        match: getPathMatch(rule.source, { strict: true, sensitive: false, removeUnnamedParams: true,
            regexModifier: regex => modifyRouteRegex(regex) }),
        built: new RegExp(buildCustomRoute('header', rule).regex, 'i'),
    }));
    const common = [
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ];
    const publicPolicy = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; font-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
    const mounted = ['/admin', '/admin/', '/admin/add-cards', '/admin/workspace/card',
        '/admin/licenses/libheif-js.txt', '/admin/_next/static/chunks/worker.js',
        '/admin/_next/data/build/add-cards.json', '/account', '/account/', '/account/cards',
        '/account/_next/static/chunks/index.js', '/account/_next/data/build/index.json'];
    const publicPaths = ['/', '/about', '/administrator', '/administrator/tools', '/accounting',
        '/accounting/invoices', '/_next/static/chunks/index.js', '/_next/data/build/index.json'];
    for (const [paths, expectedCsp] of [[mounted, []], [publicPaths, [{ key: 'Content-Security-Policy', value: publicPolicy }]]]) {
        for (const path of paths) {
            for (const rule of rules) assert.equal(Boolean(rule.match(path)), rule.built.test(path), path);
            const headers = rules.filter(rule => rule.match(path)).flatMap(rule => rule.headers);
            assert.deepEqual(headers.filter(h => h.key !== 'Content-Security-Policy'), common, path);
            assert.deepEqual(headers.filter(h => h.key === 'Content-Security-Policy'), expectedCsp, path);
        }
    }
});
