const config = {
    poweredByHeader: false, reactStrictMode: true, transpilePackages: ['@atlas/report-view','@atlas/manual-workspace'], experimental: { cpus: 2, proxyTimeout: 240_000 },
    skipMiddlewareUrlNormalize: true,
    outputFileTracingIncludes: { '/*': ['./.generated/public-database/**/*'] },
    async headers() { return [{ source: '/:path*', headers: [
        { key: 'Referrer-Policy', value: 'no-referrer' }, { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
    ] }, { source: '/admin/:path*', headers: [
        { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
    ] }, { source: '/((?!admin(?:/|$)|dealers(?:/|$)).*)', headers: [
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ] }, { source: '/((?!admin(?:/|$)|account(?:/|$)|dealers(?:/|$)).*)', headers: [
        // Mounted apps provide their own CSP for their pages and static assets.
        { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; font-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" },
    ] }, { source: '/dealers', headers: [
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
        { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://maps.googleapis.com https://maps.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' blob: data: https://*.googleapis.com https://*.gstatic.com https://*.google.com https://*.googleusercontent.com; connect-src 'self' https://*.googleapis.com https://*.google.com https://*.gstatic.com data: blob:; font-src 'self' https://fonts.gstatic.com; frame-src https://*.google.com; worker-src blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" },
    ] }]; },
};
export default config;
