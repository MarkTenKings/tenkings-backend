const config = {
    poweredByHeader: false, reactStrictMode: true, transpilePackages: ['@atlas/report-view'], experimental: { cpus: 2, proxyTimeout: 240_000 },
    skipMiddlewareUrlNormalize: true,
    outputFileTracingIncludes: { '/*': ['./.generated/public-database/**/*'] },
    async headers() { return [{ source: '/:path*', headers: [
        { key: 'Referrer-Policy', value: 'no-referrer' }, { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; font-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" },
    ] }]; },
};
export default config;
