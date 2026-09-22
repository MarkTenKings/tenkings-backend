import { providerQualificationPreviewHost } from './staffResearchQualificationHost';

/** Host routing is presentation policy. Every private API still checks its own session. */
export const MAIN_SITE_ORIGIN = 'https://tenkings.co';
export const COLLECT_SITE_ORIGIN = 'https://collect.tenkings.co';
export const MAIN_HOME_PATH = '/main-site';

export type SiteRouteConfig = { enabled: boolean; legacyHosts: readonly string[]; previewHosts: readonly string[]; qualificationPreviewHost?: string | null };
export type SiteRouteDecision =
  | { kind: 'next'; surface: 'legacy' | 'main'; noIndex: boolean }
  | { kind: 'rewrite'; pathname: string; noIndex: boolean }
  | { kind: 'redirect'; location: string }
  | { kind: 'robots' | 'sitemap'; noIndex: boolean }
  | { kind: 'not-found' };

/** Read Host, never client-supplied forwarded-host or a surface header. */
export function normalizeSiteHost(value: string | null | undefined): string | null {
  if (!value || value !== value.trim() || /[\s,\/@\\?#%]/.test(value)) return null;
  const match = /^(\[[0-9a-f:]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::([0-9]{1,5}))?$/i.exec(value);
  if (!match || (match[2] && (Number(match[2]) < 1 || Number(match[2]) > 65535))) return null;
  const host = match[1].toLowerCase();
  if (host.includes('..') || host.split('.').some(label => label.startsWith('-') || label.endsWith('-'))) return null;
  return host;
}

function configuredHosts(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(',').map(value => value.trim()).filter(value => normalizeSiteHost(value) === value.toLowerCase()).map(value => value.toLowerCase());
}

export function siteRouteConfig(env: Record<string, string | undefined>): SiteRouteConfig {
  const legacyHosts = new Set([
    'collect.tenkings.co',
    ...configuredHosts(env.VERCEL_URL), ...configuredHosts(env.VERCEL_BRANCH_URL),
    ...configuredHosts(env.VERCEL_PROJECT_PRODUCTION_URL), ...configuredHosts(env.SITE_ROUTE_LEGACY_HOSTS),
  ]);
  if (env.NODE_ENV !== 'production') ['localhost', '127.0.0.1', '[::1]'].forEach(host => legacyHosts.add(host));
  return { enabled: env.MAIN_SITE_ENABLED === 'true', legacyHosts: [...legacyHosts], previewHosts: configuredHosts(env.MAIN_SITE_PREVIEW_HOSTS), qualificationPreviewHost: providerQualificationPreviewHost(env) };
}

export function isMainSiteHost(hostHeader: string | null | undefined, config: SiteRouteConfig): boolean {
  const host = normalizeSiteHost(hostHeader);
  return Boolean(config.enabled && host && (host === 'tenkings.co' || (host !== 'www.tenkings.co' && host !== 'collect.tenkings.co' && config.previewHosts.includes(host))));
}

/** Covers both raw page-data URLs and Next's default normalized pathname. */
export function normalizeSitePath(pathname: string): string | null {
  if (!pathname.startsWith('/') || pathname.startsWith('//') || /[\\\u0000-\u0020?#]/.test(pathname)) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  // No alternate spellings of route separators, dot segments or a second decode.
  if (decoded !== pathname || pathname.split('/').some(part => part === '.' || part === '..')) return null;
  const data = /^\/_next\/data\/[^/]+\/(.+)\.json$/.exec(pathname);
  if (pathname.startsWith('/_next/data/') && !data) return null;
  const page = data ? data[1] === 'index' ? '/' : `/${data[1]}` : pathname;
  return page.length > 1 ? page.replace(/\/$/, '') : page;
}

const apiMethods: Record<string, readonly string[]> = {
  '/api/v2/admin/inventory/access': ['GET'],
  '/api/v2/admin/inventory/workspace': ['GET', 'POST'],
  '/api/v2/admin/inventory/photo': ['POST'],
  '/api/v2/admin/inventory/identify': ['POST'],
  '/api/v2/admin/inventory/research': ['GET', 'POST'],
  '/api/v2/admin/inventory/research-review': ['POST'],
  '/api/v2/admin/inventory/location-map': ['GET'],
  '/api/admin/locations': ['GET', 'POST'],
  '/api/wallet/me': ['GET'],
};
const customerPaths = new Set(['/packs', '/locations', '/live', '/collection', '/profile', '/terms', '/privacy']);
export const MAIN_SITE_PUBLIC_IMAGES = ['/images/50-pokemon-pack-tier.png', '/images/100-sports-pack-tier.png'] as const;
const publicAssets = new Set<string>([...MAIN_SITE_PUBLIC_IMAGES, '/brand/tenkings-logo.png', '/favicon.ico']);

export function resolveSiteRoute(input: { host: string | null | undefined; pathname: string; method: string; search?: string }, config: SiteRouteConfig): SiteRouteDecision {
  const host = normalizeSiteHost(input.host);
  if (!host) return { kind: 'not-found' };
  // Vercel may select its configured production URL for scheduling. The existing
  // handler still requires CRON_SECRET; no browser/hostname grants job authority.
  if (config.legacyHosts.includes(host) && input.pathname === '/api/cron/inventory-research' && input.method === 'GET') return { kind: 'next', surface: 'legacy', noIndex: true };
  const main = isMainSiteHost(host, config);
  // Existing collect/platform routes remain byte-for-byte Next paths. No global
  // path normalization is imposed on issued URLs or specialist APIs.
  if (!main && host !== 'tenkings.co' && host !== 'www.tenkings.co' && config.legacyHosts.includes(host)) {
    const page = normalizeSitePath(input.pathname);
    if (page === MAIN_HOME_PATH || page === '/staff' || page?.startsWith('/staff/')) return { kind: 'not-found' };
    return { kind: 'next', surface: 'legacy', noIndex: false };
  }
  if (!config.enabled || (!main && host !== 'www.tenkings.co')) return { kind: 'not-found' };
  const path = normalizeSitePath(input.pathname);
  if (!path) return { kind: 'not-found' };
  const safe = input.method === 'GET' || input.method === 'HEAD';
  if (host === 'www.tenkings.co') {
    // Never forward a credential-bearing API request or write to another host.
    if (!safe || path.startsWith('/api/') || input.pathname.startsWith('/_next/')) return { kind: 'not-found' };
    return { kind: 'redirect', location: `${MAIN_SITE_ORIGIN}${path}` };
  }
  const noIndex = host !== 'tenkings.co' || path === '/staff' || path.startsWith('/staff/') || path.startsWith('/api/');
  // Only this explicitly configured branch Preview can host the private probe.
  // The handler independently requires a current human admin and same-origin POST.
  if (host === config.qualificationPreviewHost) {
    if (path === '/admin/inventory-research-qualification' && safe) return { kind: 'next', surface: 'main', noIndex: true };
    if (['/api/v2/admin/inventory/provider-qualification', '/api/v2/admin/inventory/research-qualification'].includes(path) && ['GET', 'POST'].includes(input.method)) return { kind: 'next', surface: 'main', noIndex: true };
  }
  if (path.startsWith('/api/')) return apiMethods[path]?.includes(input.method) ? { kind: 'next', surface: 'main', noIndex: true } : { kind: 'not-found' };
  if (!safe) return { kind: 'not-found' };
  if (path.startsWith('/_next/static/')) return { kind: 'next', surface: 'main', noIndex };
  if (path === '/_next/image') {
    const url = new URLSearchParams(input.search ?? '').get('url');
    return url && publicAssets.has(url) ? { kind: 'next', surface: 'main', noIndex } : { kind: 'not-found' };
  }
  if (publicAssets.has(path)) return { kind: 'next', surface: 'main', noIndex };
  if (path === '/robots.txt') return { kind: 'robots', noIndex };
  if (path === '/sitemap.xml') return { kind: 'sitemap', noIndex };
  if (path === '/') return { kind: 'rewrite', pathname: MAIN_HOME_PATH, noIndex };
  if (path === '/staff' || path === '/staff/inventory') return { kind: 'next', surface: 'main', noIndex: true };
  // Explicit compatibility links only. Do not forward token-bearing query strings.
  if (customerPaths.has(path) || /^\/c\/tk2c_[A-Za-z0-9_-]+$/.test(path) || /^\/nfc\/[A-Za-z0-9_-]+$/.test(path)) {
    return { kind: 'redirect', location: `${COLLECT_SITE_ORIGIN}${path}` };
  }
  return { kind: 'not-found' };
}
