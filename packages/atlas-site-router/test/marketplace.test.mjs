import test from 'node:test';
import assert from 'node:assert/strict';
import { marketplaceForwarding } from '../marketplace.mjs';
import { forwardingHeaders } from '../proof.mjs';
import { acceptsSiteRequest } from '../server.mjs';
import { assertMarketplaceSignedTarget } from '../../atlas-marketplace/src/auth-r1.mjs';

const env = { ATLAS_MARKETPLACE_ENABLED: '1', ATLAS_MARKETPLACE_PUBLIC_ORIGIN: 'https://market-public.atlasgrading.com',
    ATLAS_MARKETPLACE_STAFF_ORIGIN: 'https://market-staff.atlasgrading.com', ATLAS_MARKETPLACE_CUSTOMER_ORIGIN: 'https://market-customer.atlasgrading.com' };

test('only whole canonical marketplace mounts select owned ingress; absent setting preserves old routing', () => {
    for (const target of ['/marketplace/catalog?x=%2F&x=1', '/admin/marketplace/api', '/account/marketplace/seller/api']) {
        assert.equal(marketplaceForwarding(target, {}), null);
    }
});

test('raw canonical targets and query bytes survive routing without an API alias', () => {
    for (const [zone, target] of [['public', '/marketplace/catalog?x=%2F&x=1'], ['staff', '/admin/marketplace/api/provider/webhook'], ['customer', '/account/marketplace/api/proofs/upload/original']]) {
        const value = marketplaceForwarding(target, env);
        assert.equal(value.zone, zone); assert.equal(value.target, target);
        assert.equal(new URL(target, value.origin).pathname + new URL(target, value.origin).search, target);
    }
    for (const target of ['/marketplaces/catalog', '/admin/marketplace-extra', '/account/settings', '/admin/api/staff/grading']) assert.equal(marketplaceForwarding(target, env), null);
    for (const [zone, target] of [['staff', '/admin/api/staff/auth/logout'], ['customer', '/account/api/customer/auth/logout']]) assert.equal(marketplaceForwarding(target, env).zone, zone);
    // An alias reaches the owned handler's exact-target refusal, never falls
    // back to a separate web auth object that lacks the private drain owner.
    assert.equal(marketplaceForwarding('/admin/api/staff/auth/logout?alias=1', env).zone, 'staff');
});

test('configured marketplace routes refuse malformed enablement, encoded mounts and unowned destinations', () => {
    for (const origin of ['http://market.atlasgrading.com', 'https://atlasgrading.com', 'https://market.atlasgrading.com/path', 'https://market.atlasgrading.com:444', 'https://example.com', 'https://u:p@market.atlasgrading.com'])
        assert.throws(() => marketplaceForwarding('/marketplace/catalog', { ...env, ATLAS_MARKETPLACE_PUBLIC_ORIGIN: origin }));
    assert.throws(() => marketplaceForwarding('/marketplace/catalog', { ...env, ATLAS_MARKETPLACE_ENABLED: 'true' }));
    assert.throws(() => marketplaceForwarding('/admin/%2e%2e/marketplace', env));
});

test('private forwarding retains existing canonical deployment HMAC, no deployment bypass credential', async () => {
    const key = Buffer.alloc(32, 7), target = '/account/marketplace/api?b=2&a=%2F', deployment = 'https://customer-test.vercel.app';
    const headers = await forwardingHeaders(new Headers({ host: 'atlasgrading.com', 'x-forwarded-host': 'atlasgrading.com', 'x-forwarded-proto': 'https', 'x-vercel-protection-bypass': 'incoming-must-be-removed' }),
        { zone: 'customer', deployment, method: 'POST', target, issuedAt: Date.now() }, key.toString('base64'));
    assert.equal(headers.has('x-vercel-protection-bypass'), false);
    const request = { method: 'POST', url: target, headers: Object.fromEntries(headers) };
    assert.equal(acceptsSiteRequest(request, { zone: 'customer', deploymentId: 'customer-test.vercel.app', routerKey: key }), true);
    assert.equal(assertMarketplaceSignedTarget(request, { mode: 'PRODUCTION' }), true);
    assert.throws(() => assertMarketplaceSignedTarget({ ...request, url: '/account/marketplace/api?b=3' }, { mode: 'PRODUCTION' }), { code: 'SIGNED_TARGET_REFUSED' });
});
