import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSiteHost, normalizeSitePath, resolveSiteRoute, siteRouteConfig, isMainSiteHost, MAIN_SITE_PUBLIC_IMAGES } from '../lib/siteRoutes';
import { NextRequest } from 'next/server';
import { middleware } from '../middleware';

const config = siteRouteConfig({ NODE_ENV: 'production', MAIN_SITE_ENABLED: 'true', MAIN_SITE_PREVIEW_HOSTS: 'preview.example', VERCEL_URL: 'release-team.vercel.app', VERCEL_BRANCH_URL: 'branch-team.vercel.app', VERCEL_PROJECT_PRODUCTION_URL: 'project.vercel.app' });
const route = (pathname: string, host = 'tenkings.co', method = 'GET', search = '') => resolveSiteRoute({ pathname, host, method, search }, config);

test('activation is off by default and collect/platform/local development remain the legacy app', () => {
  const disabled = siteRouteConfig({ VERCEL_URL: 'release-team.vercel.app' });
  for (const host of ['collect.tenkings.co', 'release-team.vercel.app', 'localhost:3000']) {
    for (const pathname of ['/', '/admin/physical-inventory', '/api/cron/inventory-research', '/c/tk2c_existing', '/api/admin/set-ops/sets', '/_next/data/build/admin.json']) assert.equal(resolveSiteRoute({ host, pathname, method: 'GET' }, disabled).kind, 'next');
    for (const pathname of ['/staff', '/staff/inventory', '/main-site', '/_next/data/build/staff.json']) assert.equal(resolveSiteRoute({ host, pathname, method: 'GET' }, disabled).kind, 'not-found');
  }
  for (const host of ['tenkings.co', 'www.tenkings.co', 'attacker.vercel.app']) assert.equal(resolveSiteRoute({ host, pathname: '/', method: 'GET' }, disabled).kind, 'not-found');
});

test('configured hosts are exact, reject malformed authority, and cannot turn collect into a preview', () => {
  assert.equal(normalizeSiteHost('TENKINGS.CO:443'), 'tenkings.co');
  for (const host of [null, '', ' tenkings.co', 'tenkings.co,evil', 'https://tenkings.co', 'tenkings.co/evil', 'tenkings.co@evil', 'tenkings.co:99999', 'tenkings..co', 'tenkings.co.']) assert.equal(normalizeSiteHost(host), null);
  for (const host of ['tenkings.co.evil', 'evil.tenkings.co', 'attacker.vercel.app', 'unknown.example']) assert.equal(route('/', host).kind, 'not-found');
  assert.equal(route('/', 'preview.example').kind, 'rewrite');
  assert.equal(isMainSiteHost('collect.tenkings.co', { ...config, previewHosts: ['collect.tenkings.co'] }), false);
  assert.equal(route('/admin', 'project.vercel.app').kind, 'next');
  assert.equal(route('/admin', 'branch-team.vercel.app').kind, 'next');
});

test('main pages and normalized page data follow the same host boundary', () => {
  assert.deepEqual(route('/'), { kind: 'rewrite', pathname: '/main-site', noIndex: false });
  assert.deepEqual(route('/_next/data/build/index.json'), route('/'));
  for (const page of ['staff', 'staff/inventory']) {
    assert.deepEqual(route(`/${page}`), { kind: 'next', surface: 'main', noIndex: true });
    assert.deepEqual(route(`/_next/data/build/${page}.json`), route(`/${page}`));
    assert.deepEqual(route(`/${page}/`), route(`/${page}`));
  }
  for (const path of ['/admin', '/admin/physical-inventory', '/main-site', '/ai-grader/station', '/_next/data/build/admin.json', '/_next/data/build/main-site.json', '/api/admin/cards.json', '/staff/unknown', '/blog/old']) assert.equal(route(path).kind, 'not-found', path);
  for (const path of ['//admin', '/staff\\inventory', '/staff/../admin', '/%73taff', '/staff%2finventory', '/%252e%252e/admin', '/_next/data/build/staff', '/staff?x=1']) assert.equal(normalizeSitePath(path), null, path);
});

test('only current staff API methods are reachable on main; collect specialist APIs are preserved', () => {
  const calls: [string, string][] = [['access', 'GET'], ['workspace', 'GET'], ['workspace', 'POST'], ['photo', 'POST'], ['identify', 'POST'], ['research', 'GET'], ['research', 'POST'], ['research-review', 'POST'], ['location-map', 'GET']];
  for (const [endpoint, method] of calls) assert.equal(route(`/api/v2/admin/inventory/${endpoint}`, 'tenkings.co', method).kind, 'next');
  for (const path of ['/api/admin/locations', '/api/wallet/me']) assert.equal(route(path).kind, 'next');
  for (const [path, method] of [['/api/v2/admin/inventory/photo', 'GET'], ['/api/v2/admin/inventory/workspace', 'DELETE'], ['/api/v2/admin/inventory/access', 'POST'], ['/api/v2/admin/inventory/research-review', 'GET'], ['/api/v2/admin/inventory/research-review', 'PUT'], ['/api/admin/locations', 'PATCH'], ['/api/wallet/me', 'POST'], ['/api/admin/pack-types', 'GET'], ['/api/v2/admin/inventory/events', 'POST']]) assert.equal(route(path, 'tenkings.co', method).kind, 'not-found');
  assert.equal(route('/api/admin/pack-types', 'collect.tenkings.co', 'POST').kind, 'next');
  for (const operation of ['discover', 'lookup', 'media', 'proposals']) {
    assert.equal(route(`/api/internal/card-catalog/v1/${operation}`, 'collect.tenkings.co', 'POST').kind, 'next');
    assert.equal(route(`/api/internal/card-catalog/v1/${operation}`).kind, 'not-found');
  }
});

test('www and consumer aliases never redirect API requests, writes or credential query strings', () => {
  assert.deepEqual(route('/staff/', 'www.tenkings.co', 'GET', '?token=secret'), { kind: 'redirect', location: 'https://tenkings.co/staff' });
  assert.equal(route('/staff', 'www.tenkings.co', 'POST').kind, 'not-found');
  assert.equal(route('/api/v2/admin/inventory/workspace', 'www.tenkings.co').kind, 'not-found');
  for (const path of ['/collection', '/c/tk2c_exact', '/nfc/tag']) assert.deepEqual(route(path, 'tenkings.co', 'GET', '?token=secret'), { kind: 'redirect', location: `https://collect.tenkings.co${path}` });
  assert.equal(route('/packs', 'tenkings.co', 'POST').kind, 'not-found');
});

test('only public images are optimized; no file-extension bypass admits private routes', () => {
  for (const image of MAIN_SITE_PUBLIC_IMAGES) {
    assert.equal(route(image).kind, 'next');
    assert.equal(route('/_next/image', 'tenkings.co', 'GET', `?url=${encodeURIComponent(image)}&w=640&q=75`).kind, 'next');
  }
  for (const url of ['https://private.digitaloceanspaces.com/inventory-photos/a?signature=secret', '/api/v2/admin/inventory/photo', '/admin/launch/add-cards.mp4']) assert.equal(route('/_next/image', 'tenkings.co', 'GET', `?url=${encodeURIComponent(url)}`).kind, 'not-found');
  assert.equal(route('/admin/secret.css').kind, 'not-found');
  assert.equal(route('/_next/static/chunks/pages/admin.js').kind, 'next');
});

test('one existing cron handler is reachable on the exact deployment/production URL, behind its own secret', () => {
  for (const host of ['collect.tenkings.co', 'release-team.vercel.app', 'project.vercel.app']) assert.equal(route('/api/cron/inventory-research', host).kind, 'next');
  for (const host of ['tenkings.co', 'www.tenkings.co', 'preview.example', 'attacker.vercel.app']) assert.equal(route('/api/cron/inventory-research', host).kind, 'not-found');
  const apexProduction = siteRouteConfig({ NODE_ENV: 'production', MAIN_SITE_ENABLED: 'true', VERCEL_PROJECT_PRODUCTION_URL: 'tenkings.co' });
  assert.equal(resolveSiteRoute({ host: 'tenkings.co', pathname: '/api/cron/inventory-research', method: 'GET' }, apexProduction).kind, 'next');
});

test('middleware ignores spoofed forwarded/surface headers and serves private staff/noindex discovery', () => {
  const previous = { MAIN_SITE_ENABLED: process.env.MAIN_SITE_ENABLED, MAIN_SITE_PREVIEW_HOSTS: process.env.MAIN_SITE_PREVIEW_HOSTS };
  process.env.MAIN_SITE_ENABLED = 'true'; process.env.MAIN_SITE_PREVIEW_HOSTS = 'preview.example';
  try {
    const request = (host: string, path: string) => new NextRequest(`https://${host}${path}`, { headers: { host, 'x-forwarded-host': 'collect.tenkings.co', 'x-tenkings-surface': 'legacy' } });
    assert.equal(middleware(request('tenkings.co', '/admin')).status, 404);
    const staff = middleware(request('tenkings.co', '/staff'));
    assert.equal(staff.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(staff.headers.get('X-Robots-Tag'), 'noindex, nofollow');
    assert.equal(staff.headers.get('x-middleware-request-x-tenkings-surface'), null);
    const root = middleware(request('tenkings.co', '/'));
    assert.equal(new URL(root.headers.get('x-middleware-rewrite')!).pathname, '/main-site');
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test('only the explicitly configured self branch Preview admits the private provider probe', () => {
  const host = 'qualified-branch.vercel.app';
  const env = { NODE_ENV: 'production', VERCEL_ENV: 'preview', MAIN_SITE_ENABLED: 'true', MAIN_SITE_PREVIEW_HOSTS: host,
    VERCEL_BRANCH_URL: host, STAFF_RESEARCH_PROVIDER_QUALIFICATION_PREVIEW_HOST: host };
  const page = '/admin/inventory-research-qualification', api = '/api/v2/admin/inventory/provider-qualification';
  const probe = (hostname: string, pathname: string, method = 'GET', patch = {}) => resolveSiteRoute({ host: hostname, pathname, method }, siteRouteConfig({ ...env, ...patch }));
  for (const pathname of [page, `/_next/data/build${page}.json`, api]) assert.deepEqual(probe(host, pathname), { kind: 'next', surface: 'main', noIndex: true });
  assert.equal(probe(host, api, 'POST').kind, 'next');
  for (const [pathname, method] of [[page, 'POST'], [api, 'DELETE'], ['/admin/set-ops', 'GET'], ['/api/admin/set-ops/ingestion', 'POST']]) assert.equal(probe(host, pathname, method).kind, 'not-found');
  for (const other of ['tenkings.co', 'www.tenkings.co', 'other.vercel.app', `${host}.evil.example`]) {
    assert.notEqual(probe(other, page).kind, 'next'); assert.equal(probe(other, api).kind, 'not-found');
  }
  for (const patch of [{ VERCEL_ENV: 'production' }, { VERCEL_ENV: undefined }, { VERCEL_BRANCH_URL: 'other.vercel.app' }, { STAFF_RESEARCH_PROVIDER_QUALIFICATION_PREVIEW_HOST: undefined }]) {
    assert.equal(probe(host, page, 'GET', patch).kind, 'not-found'); assert.equal(probe(host, api, 'POST', patch).kind, 'not-found');
  }
  const exact = '/api/v2/admin/inventory/research-qualification';
  for (const method of ['GET', 'POST']) assert.equal(probe(host, exact, method).kind, 'next');
  for (const other of ['tenkings.co', 'www.tenkings.co', 'other.vercel.app']) assert.equal(probe(other, exact, 'POST').kind, 'not-found');
  assert.equal(probe(host, exact, 'DELETE').kind, 'not-found');
});
