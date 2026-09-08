import { BROWSER_COOKIE, SESSION_COOKIE, isBoundaryError, assertLocalRequest, assertWrite, deny, fixtureCookie, identifier, privateHeaders, strictObject } from './policy.mjs';
export function createHandler(resolveRuntime, env = process.env) {
    return async function handler(req, res) {
        privateHeaders(res);
        try {
            const state = typeof resolveRuntime === 'function' ? await resolveRuntime(req) : resolveRuntime;
            const { auth, review } = state;
            if (state.assertRequest) state.assertRequest(req);
            else assertLocalRequest(req, env);
            const cookieNames = state.cookies ?? { browser: BROWSER_COOKIE, session: SESSION_COOKIE };
            const serializeCookie = state.cookie ?? fixtureCookie;
            const cardPattern = '(sample-\\d{3}|[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})';
            const path = (req.url ?? '').split('?')[0];
            const patterns = [
                ['GET', /^\/api\/staff\/session$/], ['POST', /^\/api\/staff\/auth\/request$/],
                ['POST', /^\/api\/staff\/auth\/verify$/], ['POST', /^\/api\/staff\/auth\/logout$/],
                ['GET', /^\/api\/staff\/cards$/], ['GET', new RegExp(`^/api/staff/cards/${cardPattern}$`)],
                ['POST', new RegExp(`^/api/staff/cards/${cardPattern}/draft$`)],
                ['GET', new RegExp(`^/api/staff/evidence/${cardPattern}/(FRONT|BACK)$`)]
            ];
            if (state.reports) patterns.push(['POST', new RegExp(`^/api/staff/cards/${cardPattern}/approve$`)]);
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
            const client = state.clientAddress ? state.clientAddress(req) : req.socket.remoteAddress;
            if (req.method === 'POST') {
                assertWrite(req, state.origin);
                if (JSON.stringify(req.body ?? {}).length > 16384)
                    deny(413, 'REQUEST_TOO_LARGE');
            }
            let body;
            if (path === '/api/staff/session') {
                const boot = await auth.bootstrap(cookie, client);
                res.setHeader('Set-Cookie', serializeCookie(cookieNames.browser, boot.browserToken, 3600));
                body = { mode: state.mode ?? 'SYNTHETIC_LOCAL', csrf: boot.csrf, staff: boot.staff };
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
                res.setHeader('Set-Cookie', serializeCookie(cookieNames.session, result.token, 1800));
                body = { staff: result.staff, csrf: result.csrf };
            }
            else {
                const staff = req.method === 'POST' ? await auth.authenticate(cookie, csrf ?? '') : await auth.authenticate(cookie);
                if (path === '/api/staff/auth/logout') {
                    strictObject(req.body, []);
                    await auth.logout(cookie, csrf);
                    res.setHeader('Set-Cookie', serializeCookie(cookieNames.session, '', 0));
                    body = { signedOut: true };
                }
                else if (path === '/api/staff/cards')
                    body = { cards: await review.list(staff) };
                else if (path.startsWith('/api/staff/evidence/')) {
                    const asset = await review.asset(staff, match[1], match[2]);
                    res.setHeader('Content-Type', asset.contentType ?? 'image/svg+xml');
                    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
                    return res.status(200).send(asset.bytes ?? asset);
                }
                else if (path.endsWith('/approve'))
                    body = await state.reports.approve(staff, match[1], req.body);
                else if (req.method === 'POST')
                    body = { card: await review.save(staff, match[1], req.body) };
                else
                    body = { card: await review.read(staff, match[1]) };
            }
            return res.status(200).json(body);
        }
        catch (error) {
            return res.status(isBoundaryError(error) ? error.status : 503).json({ error: isBoundaryError(error) ? error.code : 'TEMPORARILY_UNAVAILABLE' });
        }
    };
}
