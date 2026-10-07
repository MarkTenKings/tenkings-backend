import http from 'node:http';
import { routeTarget } from './routes.mjs';

// Test/development ingress only. Targets and logical host are fixed loopback
// addresses, never environment-provided remote destinations.
export function localSiteRouter({ port = 4318 } = {}) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('INVALID_LOCAL_PORT');
    const server = http.createServer((req, res) => {
        if (!['127.0.0.1', '::ffff:127.0.0.1', '::1'].includes(req.socket.remoteAddress)
            || req.headers.host !== `127.0.0.1:${port}`) { res.writeHead(403); res.end(); return; }
        let route;
        try { route = routeTarget(req.url); } catch { res.writeHead(400); res.end(); return; }
        const upstreamPort = { staff: 4328, customer: 4320, public: 4319 }[route.zone];
        const logicalHost = route.zone === 'public' ? '127.0.0.1:4319' : '127.0.0.1:4318';
        const headers = { ...req.headers, host: logicalHost, 'x-forwarded-host': logicalHost, 'x-forwarded-proto': 'http' };
        for (const name of Object.keys(headers)) if (name.startsWith('x-atlas-route-') || name.startsWith('x-middleware-')
            || ['connection', 'proxy-authorization', 'proxy-connection', 'upgrade', 'forwarded', 'x-forwarded-for',
                'x-matched-path', 'x-now-route-matches', 'x-nextjs-data', 'x-vercel-protection-bypass', 'x-vercel-set-bypass-cookie'].includes(name)) delete headers[name];
        if (route.zone === 'public') delete headers.cookie;
        const upstream = http.request({ hostname: '127.0.0.1', port: upstreamPort, path: req.url, method: req.method, headers }, response => {
            res.writeHead(response.statusCode, response.headers); response.pipe(res);
        });
        upstream.setTimeout(240_000, () => upstream.destroy());
        upstream.on('error', () => { if (!res.headersSent) res.writeHead(503, { 'Cache-Control': 'no-store' }); res.end('ATLAS local area unavailable.'); });
        res.on('close', () => upstream.destroy()); req.pipe(upstream);
    });
    return new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => resolve(server)); });
}
