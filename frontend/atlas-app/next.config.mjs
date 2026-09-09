import { STAFF_BASE_PATH } from './lib/routes.mjs';
/** Dedicated staff build; the public path router preserves this complete mount. */
const config = {
    basePath: STAFF_BASE_PATH,
    poweredByHeader: false,
    reactStrictMode: true,
    transpilePackages: ['@atlas/report-view'],
    experimental: { cpus: 2 },
    outputFileTracingIncludes: { '/*': ['./.generated/staff-database/**/*'] },
    async headers() {
        return [{ source: '/:path*', headers: [
                    { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
                    { key: 'Referrer-Policy', value: 'no-referrer' },
                    { key: 'X-Content-Type-Options', value: 'nosniff' },
                    { key: 'X-Frame-Options', value: 'DENY' },
                    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
                    { key: 'Content-Security-Policy', value: `default-src 'self'; script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self' http://127.0.0.1:47662; font-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'` }
                ] }];
    }
};
export default config;
