import { BROWSER_COOKIE, SESSION_COOKIE, isBoundaryError, assertLocalRequest, assertWrite, deny, fixtureCookie, identifier, privateHeaders, strictObject } from './policy.mjs';
export function createHandler({ auth, review }, env = process.env) {
    return async function handler(req, res) {
        privateHeaders(res);
        try {
            assertLocalRequest(req, env);
            const path = (req.url ?? '').split('?')[0];
            const patterns = [
                ['GET', /^\/api\/staff\/session$/], ['POST', /^\/api\/staff\/auth\/request$/],
                ['POST', /^\/api\/staff\/auth\/verify$/], ['POST', /^\/api\/staff\/auth\/logout$/],
                ['GET', /^\/api\/staff\/cards$/], ['GET', /^\/api\/staff\/cards\/(sample-\d{3})$/],
                ['POST', /^\/api\/staff\/cards\/(sample-\d{3})\/draft$/],
                ['GET', /^\/api\/staff\/evidence\/(sample-\d{3})\/(FRONT|BACK)$/]
            ];
            const matched = patterns.find(([, pattern]) => pattern.test(path));
            if (!matched)
                deny(404, 'NOT_FOUND');
            if (req.method !== matched[0]) {
                res.setHeader('Allow', matched[0]);
                deny(405, 'METHOD_NOT_ALLOWED');
            }
            const match = path.match(matched[1]);
            const cookie = req.headers.cookie;
            const csrf = req.headers['x-atlas-csrf'];
            const client = req.socket.remoteAddress; // No client-selected forwarding authority.
            if (req.method === 'POST') {
                assertWrite(req);
                if (JSON.stringify(req.body ?? {}).length > 16384)
                    deny(413, 'REQUEST_TOO_LARGE');
            }
            let body;
            if (path === '/api/staff/session') {
                const boot = auth.bootstrap(cookie);
                res.setHeader('Set-Cookie', fixtureCookie(BROWSER_COOKIE, boot.browserToken, 3600));
                body = { mode: 'SYNTHETIC_LOCAL', csrf: boot.csrf, staff: boot.staff };
            }
            else if (path === '/api/staff/auth/request') {
                strictObject(req.body, ['phone', 'requestId']);
                identifier(req.body.requestId);
                body = await auth.send(cookie, csrf, req.body, client);
            }
            else if (path === '/api/staff/auth/verify') {
                strictObject(req.body, ['challengeId', 'code']);
                identifier(req.body.challengeId);
                if (typeof req.body.code !== 'string' || !/^\d{6}$/.test(req.body.code))
                    deny(400, 'CODE_NOT_ACCEPTED');
                const result = await auth.verify(cookie, csrf, req.body, client);
                res.setHeader('Set-Cookie', fixtureCookie(SESSION_COOKIE, result.token, 1800));
                body = { staff: result.staff, csrf: result.csrf };
            }
            else {
                const staff = req.method === 'POST' ? auth.authenticate(cookie, csrf ?? '') : auth.authenticate(cookie);
                if (path === '/api/staff/auth/logout') {
                    strictObject(req.body, []);
                    auth.logout(cookie, csrf);
                    res.setHeader('Set-Cookie', fixtureCookie(SESSION_COOKIE, '', 0));
                    body = { signedOut: true };
                }
                else if (path === '/api/staff/cards')
                    body = { cards: review.list(staff) };
                else if (path.startsWith('/api/staff/evidence/')) {
                    const asset = review.asset(staff, match[1], match[2]);
                    res.setHeader('Content-Type', 'image/svg+xml');
                    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
                    return res.status(200).send(asset);
                }
                else if (req.method === 'POST')
                    body = { card: review.save(staff, match[1], req.body) };
                else
                    body = { card: review.read(staff, match[1]) };
            }
            return res.status(200).json(body);
        }
        catch (error) {
            return res.status(isBoundaryError(error) ? error.status : 503).json({ error: isBoundaryError(error) ? error.code : 'TEMPORARILY_UNAVAILABLE' });
        }
    };
}
