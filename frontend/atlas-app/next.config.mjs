import { STAFF_BASE_PATH } from './lib/routes.mjs';
import { staffContentSecurityPolicy } from './lib/content-security.mjs';
/** Dedicated staff build; the public path router preserves this complete mount. */
const config = {
    basePath: STAFF_BASE_PATH,
    poweredByHeader: false,
    reactStrictMode: true,
  transpilePackages: ['@atlas/report-view','@atlas/manual-workspace'],
    serverExternalPackages: ['@atlas/connected-manual','@atlas/manual-service','@atlas/manual-workflow','@atlas/manual-intake','@atlas/photo-storage','@atlas/photo-runtime','@atlas/preparation-runtime','@atlas/measurement-runtime'],
    webpack(config,{isServer}) {
        if(isServer) config.externals.unshift(({request},callback)=>{
            if(/^@atlas\/(?:connected-manual|manual-service|manual-workflow|manual-intake|photo-storage|photo-runtime|preparation-runtime|measurement-runtime)(?:\/|$)/.test(request??''))
                return callback(null,`import ${request}`);
            callback();
        });
        return config;
    },
    experimental: { cpus: 2 },
    outputFileTracingIncludes: { '/*': ['./.generated/staff-database/**/*'] },
    async headers() {
        return [{ source: '/:path*', headers: [
                    { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
                    { key: 'Referrer-Policy', value: 'no-referrer' },
                    { key: 'X-Content-Type-Options', value: 'nosniff' },
                    { key: 'X-Frame-Options', value: 'DENY' },
                    { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
                    { key: 'Content-Security-Policy', value: staffContentSecurityPolicy({development:process.env.NODE_ENV==='development',uploadOrigins:[process.env.ATLAS_WORKSPACE_UPLOAD_ORIGIN,process.env.ATLAS_MANUAL_UPLOAD_ORIGIN]}) }
                ] }];
    }
};
export default config;
