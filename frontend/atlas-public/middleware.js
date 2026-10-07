import { NextResponse } from 'next/server';
import { deploymentOrigin, routeTarget, SITE_ORIGIN } from '@atlas/site-router/routes';
import { forwardingHeaders } from '@atlas/site-router/proof';

export async function middleware(request) {
    // Local cross-app tests use the owned loopback router. Fixture flags can
    // never turn on this production forwarding path.
    if (process.env.NODE_ENV !== 'production') return NextResponse.next();
    const unavailable = () => new NextResponse('This ATLAS area is not available yet.', { status: 503,
        headers: { 'Cache-Control': 'no-store, max-age=0', 'CDN-Cache-Control': 'no-store',
            'Vercel-CDN-Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Content-Type': 'text/plain; charset=utf-8' } });
    try {
        const target = `${request.nextUrl.pathname}${request.nextUrl.search}`, route = routeTarget(target);
        if (route.zone === 'public') return NextResponse.next();
        if (process.env.VERCEL_ENV !== 'production' || request.headers.get('host') !== new URL(SITE_ORIGIN).host
            || request.nextUrl.protocol !== 'https:') return unavailable();
        const deployment = deploymentOrigin(route.zone === 'staff' ? process.env.ATLAS_STAFF_DEPLOYMENT_ORIGIN : process.env.ATLAS_CUSTOMER_DEPLOYMENT_ORIGIN);
        const key = route.zone === 'staff' ? process.env.ATLAS_STAFF_ROUTER_KEY : process.env.ATLAS_CUSTOMER_ROUTER_KEY;
        const bypass = route.zone === 'staff' ? process.env.ATLAS_STAFF_DEPLOYMENT_BYPASS : process.env.ATLAS_CUSTOMER_DEPLOYMENT_BYPASS;
        const headers = await forwardingHeaders(request.headers,
            { zone: route.zone, deployment, method: request.method, target, issuedAt: Date.now() }, key, bypass);
        return NextResponse.rewrite(new URL(target, deployment), { request: { headers } });
    } catch { return unavailable(); }
}
export const config = { matcher: ['/admin/:path*', '/account/:path*'] };
