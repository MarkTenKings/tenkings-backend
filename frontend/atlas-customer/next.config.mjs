export default {
    basePath: '/account',
    poweredByHeader: false,
    reactStrictMode: true,
    experimental: { cpus: 2 },
    outputFileTracingIncludes: { '/*': ['./.generated/customer-database/**/*'] },
    // Preserve mounted Next data URLs through the nonce middleware on Vercel.
    skipMiddlewareUrlNormalize: true,
    async headers() {
        return [{ source: '/:path*', headers: [
            { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
            { key: 'Referrer-Policy', value: 'no-referrer' },
            { key: 'X-Content-Type-Options', value: 'nosniff' },
            { key: 'X-Frame-Options', value: 'DENY' },
            { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ] }];
    },
};
