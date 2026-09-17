import { NextRequest, NextResponse } from 'next/server';
import { MAIN_SITE_ORIGIN, resolveSiteRoute, siteRouteConfig } from './lib/siteRoutes';

export function middleware(request: NextRequest) {
  const decision = resolveSiteRoute({ host: request.headers.get('host'), pathname: request.nextUrl.pathname, method: request.method, search: request.nextUrl.search }, siteRouteConfig(process.env));
  const headers = new Headers(request.headers);
  headers.delete('x-tenkings-surface');
  // x-forwarded-host is never consulted for surface selection. Preserve the
  // platform's existing forwarding headers for unchanged collect handlers.
  if (decision.kind === 'not-found') return new NextResponse('Not found', { status: 404, headers: { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
  if (decision.kind === 'redirect') return NextResponse.redirect(decision.location, { status: 307, headers: { 'Cache-Control': 'private, no-store' } });
  let response: NextResponse;
  if (decision.kind === 'robots') {
    response = new NextResponse(decision.noIndex ? 'User-agent: *\nDisallow: /\n' : `User-agent: *\nAllow: /\nDisallow: /staff\nDisallow: /api/\nDisallow: /main-site\nSitemap: ${MAIN_SITE_ORIGIN}/sitemap.xml\n`, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  } else if (decision.kind === 'sitemap') {
    response = new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${decision.noIndex ? '' : `<url><loc>${MAIN_SITE_ORIGIN}/</loc></url>`}</urlset>`, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
  } else if (decision.kind === 'rewrite') {
    const target = request.nextUrl.clone();
    target.pathname = decision.pathname;
    response = NextResponse.rewrite(target, { request: { headers } });
  } else {
    response = NextResponse.next({ request: { headers } });
  }
  if (decision.noIndex) {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
    response.headers.set('Cache-Control', 'private, no-store');
  }
  return response;
}

// Includes page data and all APIs. Static-code access is not an auth boundary.
export const config = { matcher: '/:path*' };
