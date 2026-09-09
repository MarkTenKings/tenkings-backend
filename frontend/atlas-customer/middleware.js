import { NextResponse } from 'next/server';
export function middleware(request) {
    const nonce = crypto.randomUUID().replaceAll('-', ''), headers = new Headers(request.headers);
    headers.set('x-atlas-customer-nonce', nonce);
    const response = NextResponse.next({ request: { headers } });
    const csp = `default-src 'self'; script-src 'self' 'nonce-${nonce}'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`;
    response.headers.set('Content-Security-Policy', csp);
    response.headers.set('Cache-Control', 'private, no-store, max-age=0');
    response.headers.set('CDN-Cache-Control', 'no-store');
    response.headers.set('Vercel-CDN-Cache-Control', 'no-store');
    return response;
}
export const config = { matcher: ['/', '/((?!_next/static|_next/image|favicon.ico).*)'] };
