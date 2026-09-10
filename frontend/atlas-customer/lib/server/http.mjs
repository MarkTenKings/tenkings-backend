import { BoundaryError, deny, keys, privateHeaders, profile, submission, UUID } from './policy.mjs';

export function createHandler(resolveRuntime) {
    return async (req, res) => {
        privateHeaders(res);
        try {
            const state = typeof resolveRuntime === 'function' ? await resolveRuntime() : resolveRuntime;
            state.assertRequest(req);
            const path = (req.url ?? '').split('?')[0], method = req.method;
            const known = [
                ['GET', /^\/api\/customer\/session$/], ['POST', /^\/api\/customer\/auth\/(request|verify|logout)$/],
                ['POST', /^\/api\/customer\/profile$/], ['GET', /^\/api\/customer\/submissions$/],
                ['POST', /^\/api\/customer\/submissions$/],
                ['GET', /^\/api\/customer\/(submissions|submission-requests|cards)\/([a-f0-9-]{36})$/],
            ];
            if (!known.some(([, pattern]) => pattern.test(path))) deny(404, 'NOT_FOUND');
            if (!known.some(([verb, pattern]) => method === verb && pattern.test(path))) deny(405, 'METHOD_NOT_ALLOWED');
            if (method === 'POST') {
                if (req.headers.origin !== state.config.origin || !/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')
                    || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) deny(403, 'ORIGIN_NOT_ALLOWED');
                if (Buffer.byteLength(JSON.stringify(req.body ?? {})) > 32768) deny(413, 'REQUEST_TOO_LARGE');
            } else if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) deny(403, 'ORIGIN_NOT_ALLOWED');
            const auth = state.auth, cookieHeader = req.headers.cookie, csrf = req.headers['x-atlas-customer-csrf'];
            const client = state.clientAddress(req); let body;
            if (path.endsWith('/session')) {
                const boot = await auth.bootstrap(cookieHeader, client);
                res.setHeader('Set-Cookie', state.cookie(state.config.cookies.browser, boot.browserToken, 604800));
                body = { customer: boot.customer, csrf: boot.csrf, mode: state.config.mode };
            } else if (path.endsWith('/auth/request')) body = await auth.send(cookieHeader, csrf ?? '', req.body, client);
            else if (path.endsWith('/auth/verify')) {
                const result = await auth.verify(cookieHeader, csrf ?? '', req.body, client);
                res.setHeader('Set-Cookie', state.cookie(state.config.cookies.session, result.token, 43200));
                body = { customer: result.customer, csrf: result.csrf };
            } else if (path.endsWith('/auth/logout')) {
                keys(req.body, []); body = await auth.logout(cookieHeader, csrf ?? '');
                res.setHeader('Set-Cookie', state.cookie(state.config.cookies.session, '', 0));
            } else if (path.endsWith('/profile')) {
                keys(req.body, ['profile']); body = await auth.call(cookieHeader, 'profile', { profile: profile(req.body.profile) }, csrf ?? '');
            } else if (path === '/api/customer/submissions') {
                if (method === 'POST') body = await auth.call(cookieHeader, 'submit', { submission: submission(req.body) }, csrf ?? '');
                else {
                    const params = new URL(req.url, state.config.origin).searchParams;
                    if ([...params.keys()].some(key => key !== 'cursor') || params.getAll('cursor').length > 1) deny(400, 'INVALID_REQUEST');
                    const cursor = params.get('cursor'); if (cursor !== null && !UUID.test(cursor)) deny(400, 'INVALID_REQUEST');
                    body = await auth.call(cookieHeader, 'list', { cursor });
                }
            } else {
                const match = path.match(/^\/api\/customer\/(submissions|submission-requests|cards)\/([a-f0-9-]{36})$/);
                if (!match || !UUID.test(match[2])) deny(404, 'NOT_FOUND');
                body = await auth.call(cookieHeader, match[1] === 'cards' ? 'card' : match[1] === 'submission-requests' ? 'submission_request' : 'submission', { id: match[2] });
            }
            return res.status(200).json(body);
        } catch (error) {
            return res.status(error instanceof BoundaryError ? error.status : 503).json({ error: error instanceof BoundaryError ? error.code : 'TEMPORARILY_UNAVAILABLE' });
        }
    };
}
