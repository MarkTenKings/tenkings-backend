import { BROWSER_COOKIE, SESSION_COOKIE, isBoundaryError, assertLocalRequest, assertWrite, deny, fixtureCookie, identifier, privateHeaders, strictObject } from './policy.mjs';
import { recordApiFailure } from './api-failure.mjs';

/** Current staff boundary: authentication and the signed manual-service proxy. */
export function createHandler(resolveRuntime, env = process.env, diagnostics = {}) {
    return async function handler(req, res) {
        privateHeaders(res);
        let stage = 'RUNTIME';
        const startedAt = Date.now();
        try {
            const state = typeof resolveRuntime === 'function' ? await resolveRuntime(req) : resolveRuntime;
            const { auth } = state;
            stage = 'INGRESS';
            if (state.assertRequest) state.assertRequest(req);
            else assertLocalRequest(req, env);
            stage = 'MANUAL_PROXY';
            if (state.connectedManual && await state.connectedManual.handler(req, res)) return;
            stage = 'ROUTE';
            const path = (req.url ?? '').split('?')[0];
            const method = new Map([['/api/staff/session', 'GET'], ['/api/staff/auth/request', 'POST'],
                ['/api/staff/auth/verify', 'POST'], ['/api/staff/auth/logout', 'POST']]).get(path);
            if (!method) deny(404, 'NOT_FOUND');
            if (req.method !== method) {
                res.setHeader('Allow', method);
                deny(405, 'METHOD_NOT_ALLOWED');
            }
            const cookieNames = state.cookies ?? { browser: BROWSER_COOKIE, session: SESSION_COOKIE };
            const serializeCookie = state.cookie ?? fixtureCookie;
            const cookie = req.headers.cookie, csrf = req.headers['x-atlas-csrf'];
            const client = state.clientAddress ? state.clientAddress(req) : req.socket.remoteAddress;
            if (req.method === 'POST') {
                assertWrite(req, state.origin);
                if (Buffer.byteLength(JSON.stringify(req.body ?? {})) > 16384) deny(413, 'REQUEST_TOO_LARGE');
            }
            let body;
            stage = 'ACTION';
            if (path === '/api/staff/session') {
                stage = 'SESSION';
                const reauthenticate = new URL(req.url, state.origin ?? 'http://127.0.0.1').searchParams.getAll('reauthenticate');
                const boot = await auth.bootstrap(cookie, client, { reauthenticate: reauthenticate.length === 1 && reauthenticate[0] === '1' });
                const browserCookie = serializeCookie(cookieNames.browser, boot.browserToken, auth.cookieMaxAge ?? 3600);
                res.setHeader('Set-Cookie', boot.sessionToken
                    ? [browserCookie, serializeCookie(cookieNames.session, boot.sessionToken, auth.cookieMaxAge ?? 1800)]
                    : browserCookie);
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
                res.setHeader('Set-Cookie', serializeCookie(cookieNames.session, result.token, auth.cookieMaxAge ?? 1800));
                body = { staff: result.staff, csrf: result.csrf };
            }
            else {
                await auth.authenticate(cookie, csrf ?? '');
                strictObject(req.body, []);
                await auth.logout(cookie, csrf);
                res.setHeader('Set-Cookie', serializeCookie(cookieNames.session, '', 0));
                body = { signedOut: true };
            }
            return res.status(200).json(body);
        } catch (error) {
            const status = isBoundaryError(error) ? error.status : 503;
            const body = { error: isBoundaryError(error) ? error.code : 'TEMPORARILY_UNAVAILABLE' };
            if (!isBoundaryError(error)) body.reference = recordApiFailure({ error, stage, req,
                elapsedMs: Date.now() - startedAt, env, ...diagnostics });
            if (isBoundaryError(error) && error.outcome === 'NOT_DISPATCHED') body.outcome = 'NOT_DISPATCHED';
            return res.status(status).json(body);
        }
    };
}
