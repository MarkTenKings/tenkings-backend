import assert from 'node:assert/strict';
import test from 'node:test';
import { webcrypto } from 'node:crypto';
import { routeTarget, deploymentOrigin, normalizedAppPath } from '../routes.mjs';
import { signRoute, forwardingHeaders } from '../proof.mjs';
import { acceptsSiteRequest } from '../server.mjs';
const key = Buffer.alloc(32, 17), now = 1788967000000, deploymentId = 'atlas-staff-release.vercel.app';
const config = { zone: 'staff', deploymentId, routerKey: key };
test('gateway strips injected platform routing headers and keeps optional protection secret server-side', async () => {
    const incoming = new Headers({ cookie: 'customer-session=opaque', 'x-middleware-rewrite': 'https://outside.invalid',
        'x-atlas-route-proof': 'injected', 'x-atlas-route-other': 'injected', 'x-matched-path': '/admin',
        'x-now-route-matches': 'injected', 'x-nextjs-data': '1', 'x-vercel-protection-bypass': 'user-value', 'x-vercel-set-bypass-cookie': 'true' });
    const input = { zone: 'staff', deployment: `https://${deploymentId}`, method: 'GET', target: '/admin/grading', issuedAt: now };
    const fresh = await forwardingHeaders(incoming, input, key.toString('base64'), 'fixture-server-only-secret', webcrypto);
    assert.equal(fresh.get('cookie'), 'customer-session=opaque');
    assert.equal(fresh.get('x-vercel-protection-bypass'), 'fixture-server-only-secret');
    for (const name of ['x-middleware-rewrite', 'x-atlas-route-other', 'x-matched-path', 'x-now-route-matches', 'x-nextjs-data', 'x-vercel-set-bypass-cookie']) assert.equal(fresh.get(name), null);
    assert.match(fresh.get('x-atlas-route-proof'), /^[a-f0-9]{64}$/);
    const noProtection = await forwardingHeaders(incoming, input, key.toString('base64'), undefined, webcrypto);
    assert.equal(noProtection.get('x-vercel-protection-bypass'), null);
    for (const secret of ['', 'short', 'unsafe\r\nheader']) await assert.rejects(() => forwardingHeaders(incoming, input, key.toString('base64'), secret, webcrypto));
    assert.equal(incoming.get('x-vercel-protection-bypass'), 'user-value');
});
async function request(target = '/admin/api/staff/session') {
    return { method: 'GET', url: target.slice('/admin'.length), headers: { host: deploymentId, 'x-forwarded-proto': 'https',
        'x-forwarded-host': deploymentId, ...await signRoute({ zone: 'staff', deployment: `https://${deploymentId}`, method: 'GET', target, issuedAt: now }, key.toString('base64'), webcrypto) } };
}
test('whole-segment route ownership excludes lookalikes and ambiguous normalized paths', () => {
    for (const path of ['/admin', '/admin/', '/admin/cards/123', '/admin/_next/static/a.js']) assert.equal(routeTarget(path).zone, 'staff');
    for (const path of ['/account', '/account/submissions/123']) assert.equal(routeTarget(path).zone, 'customer');
    for (const path of ['/', '/reports/ar_abc', '/administrator', '/accounting', '/ADMIN']) assert.equal(routeTarget(path).zone, 'public');
    for (const path of ['//admin', '/admin/../account', '/%61dmin', '/admin%2fapi', '/admin/%252e%252e', '/account\\api', '/admin//api']) assert.throws(() => routeTarget(path));
    for (const origin of ['http://a.vercel.app', 'https://a.vercel.app/', 'https://user@a.vercel.app', 'https://a.vercel.app.evil.test']) assert.throws(() => deploymentOrigin(origin));
});
test('signed ingress survives deployment Host rewriting and Next basePath stripping', async () => {
    const req = await request(); assert.equal(acceptsSiteRequest(req, config, now), true);
    for (const forwarded of ['atlasgrading.com', deploymentId, undefined]) {
        const headers = { ...req.headers }; delete headers['x-forwarded-host'];
        if (forwarded !== undefined) headers['x-forwarded-host'] = forwarded;
        assert.equal(acceptsSiteRequest({ ...req, headers }, config, now), true);
    }
    for (const forwarded of ['old.vercel.app', 'atlasgrading.com, old.vercel.app', ['atlasgrading.com']])
        assert.equal(acceptsSiteRequest({ ...req, headers: { ...req.headers, 'x-forwarded-host': forwarded } }, config, now), false);
    req.url = '/admin/api/staff/session'; assert.equal(acceptsSiteRequest(req, config, now), true);
    assert.equal(acceptsSiteRequest({ ...req, headers: { ...req.headers, 'x-atlas-route-proof': '0'.repeat(64) } }, config, now), false);
});
test('direct deployment, tampered method/path/query, expired proof and cross-zone keys fail closed', async () => {
    const req = await request('/admin/api/staff/session?version=2');
    assert.equal(acceptsSiteRequest(req, config, now), true);
    for (const changed of [{ ...req, url: '/api/staff/cards' }, { ...req, url: '/api/staff/session?version=3' },
        { ...req, method: 'POST' }, { ...req, headers: { host: deploymentId, 'x-forwarded-host': 'atlasgrading.com', 'x-forwarded-proto': 'https' } }])
        assert.equal(acceptsSiteRequest(changed, config, now), false);
    assert.equal(acceptsSiteRequest(req, config, now + 30_001), false);
    assert.equal(acceptsSiteRequest(req, { ...config, zone: 'customer' }, now), false);
    assert.equal(acceptsSiteRequest(req, { ...config, routerKey: Buffer.alloc(32, 18) }, now), false);
});
test('Next page-data normalization retains the signed zone and page', async () => {
    const req = await request('/admin/_next/data/build-123/grading.json'); req.url = '/grading';
    assert.equal(normalizedAppPath(req.headers['x-atlas-route-target'], 'staff'), '/grading');
    assert.equal(acceptsSiteRequest(req, config, now), true);
    req.url = '/operations'; assert.equal(acceptsSiteRequest(req, config, now), false);
});
test('apex forwarding headers never replace proof and absolute request targets are rejected', async () => {
    const req = await request(); req.headers.host = 'atlasgrading.com'; req.headers['x-forwarded-host'] = 'atlasgrading.com';
    assert.equal(acceptsSiteRequest(req, config, now), true);
    const unsigned = { ...req, headers: { host: 'atlasgrading.com', 'x-forwarded-host': 'atlasgrading.com', 'x-forwarded-proto': 'https' } };
    assert.equal(acceptsSiteRequest(unsigned, config, now), false);
    for (const url of ['//outside.invalid/api/staff/session', 'https://outside.invalid/api/staff/session', '/api/staff/../staff/session'])
        assert.equal(acceptsSiteRequest({ ...req, url }, config, now), false);
});
