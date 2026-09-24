import { BoundaryError, deny, keys, privateHeaders, profile, submission, UUID } from './policy.mjs';
import { cardInput, createInput, identityInput, revision, CustomerIntakeError } from '@atlas/customer-intake/contract';
import { CustomerServiceError } from '@atlas/service-bridge/customer-service';
import {dealerRoute} from './dealer.mjs';

export function createHandler(resolveRuntime) {
    return async (req, res) => {
        privateHeaders(res);
        try {
            const state = typeof resolveRuntime === 'function' ? await resolveRuntime() : resolveRuntime;
            state.assertRequest(req);
            const path = (req.url ?? '').split('?')[0], method = req.method;
            const known = [
                ['GET', /^\/api\/customer\/session$/], ['GET', /^\/api\/customer\/dealer\/(session|memberships)$/], ['POST', /^\/api\/customer\/dealer\/(session|logout)$/], ['POST', /^\/api\/customer\/auth\/(request|verify|logout)$/],
                ['POST', /^\/api\/customer\/profile$/], ['GET', /^\/api\/customer\/submissions$/],
                ['POST', /^\/api\/customer\/submissions$/],
                ['GET', /^\/api\/customer\/(submissions|submission-requests|cards)\/([a-f0-9-]{36})$/],
                ['GET', /^\/api\/customer\/intake\/drafts(?:\/[a-f0-9-]{36})?$/],
                ['POST', /^\/api\/customer\/intake\/drafts(?:\/[a-f0-9-]{36}\/(?:cards|review|cards\/[a-f0-9-]{36}\/(?:correct|uploads\/[a-f0-9-]{36}\/(?:sign|complete))))?$/],
                ['GET', /^\/api\/customer\/intake\/locations$/],
                ['GET', /^\/api\/customer\/orders(?:\/[a-f0-9-]{36})?$/], ['POST', /^\/api\/customer\/orders\/[a-f0-9-]{36}\/deposit$/],
                ['GET', /^\/api\/customer\/commerce\/(?:checkout|orders\/[a-f0-9-]{36})$/],
                ['GET', /^\/api\/customer\/commerce\/orders\/[a-f0-9-]{36}\/labels\/[^/]{1,450}$/],
                ['POST', /^\/api\/customer\/commerce\/(?:quotes|payments|payments\/[a-f0-9-]{36}\/reconcile)$/],
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
            if (dealerRoute(path)) {
                if (!state.dealer) deny(503, 'DEALER_ACCESS_NOT_ENABLED');
                body = await state.dealer.handle(req,res);
            } else if (path.endsWith('/session')) {
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
            } else if (path === '/api/customer/intake/locations') {
                const params = new URL(req.url, state.config.origin).searchParams;
                if ([...params.keys()].some(key => !['query', 'lat', 'lng', 'entry'].includes(key)) || [...params.keys()].some(key => params.getAll(key).length !== 1)) deny(400, 'INVALID_REQUEST');
                const input = Object.fromEntries(params);
                if (input.query && (input.query.length > 100 || /[\x00-\x1f\x7f]/.test(input.query))) deny(400, 'INVALID_REQUEST');
                if (input.entry && !/^[A-Za-z0-9_-]{8,128}$/.test(input.entry)) deny(400, 'INVALID_REQUEST');
                if ((input.lat === undefined) !== (input.lng === undefined) || input.lat !== undefined && (!Number.isFinite(Number(input.lat)) || !Number.isFinite(Number(input.lng)) || Math.abs(Number(input.lat)) > 90 || Math.abs(Number(input.lng)) > 180)) deny(400, 'INVALID_REQUEST');
                if (!state.directory) deny(503, 'KIOSK_DIRECTORY_UNAVAILABLE');
                body = await state.directory(input);
            } else if (path === '/api/customer/orders' || path.startsWith('/api/customer/orders/')) {
                const params=new URL(req.url,state.config.origin).searchParams;
                if(path==='/api/customer/orders') {
                    if([...params.keys()].some(key=>key!=='cursor')||params.getAll('cursor').length>1||params.has('cursor')&&!UUID.test(params.get('cursor')))deny(400,'INVALID_REQUEST');
                    body=await auth.call(cookieHeader,'dealer_orders',{cursor:params.get('cursor')});
                } else {
                    const match=/^\/api\/customer\/orders\/([a-f0-9-]{36})(\/deposit)?$/.exec(path);
                    if(!match||!UUID.test(match[1])||params.size)deny(400,'INVALID_REQUEST');
                    if(match[2]){keys(req.body,['cardId','requestId']);if(!UUID.test(req.body.cardId??'')||!UUID.test(req.body.requestId??''))deny(400,'INVALID_REQUEST');
                        body=await auth.call(cookieHeader,'dealer_deposit',{orderId:match[1],...req.body},csrf??'');
                    } else body=await auth.call(cookieHeader,'dealer_tracking',{orderId:match[1]});
                }
            } else if (path.startsWith('/api/customer/commerce/')) {
                const authority = { ...auth.authority(cookieHeader, method === 'POST' ? csrf ?? '' : undefined), binding: state.config.binding };
                const params = new URL(req.url, state.config.origin).searchParams;
                const invoke = async (operation, input) => {
                    if (!state.commerce || typeof state.commerce[operation] !== 'function') deny(503, 'COMMERCE_NOT_CONFIGURED');
                    return state.commerce[operation](authority, input);
                };
                if (path === '/api/customer/commerce/checkout') {
                    if ([...params.keys()].length !== 1 || params.getAll('draftId').length !== 1 || !UUID.test(params.get('draftId') ?? '')) deny(400, 'INVALID_REQUEST');
                    body = await invoke('checkout', { draftId: params.get('draftId') });
                } else {
                    if (params.size) deny(400, 'INVALID_REQUEST');
                    if (path.includes('/labels/')) {
                        const match = /^\/api\/customer\/commerce\/orders\/([a-f0-9-]{36})\/labels\/([^/]{1,450})$/.exec(path);
                        let effectId; try { effectId = decodeURIComponent(match?.[2] ?? ''); } catch { deny(400, 'INVALID_REQUEST'); }
                        if (!match || !UUID.test(match[1]) || !/^[A-Za-z0-9:_-]{1,150}$/.test(effectId)) deny(400, 'INVALID_REQUEST');
                        body = await auth.call(cookieHeader, 'commerce_label', { orderId: match[1], effectId });
                    } else if (path === '/api/customer/commerce/quotes') {
                        const input = req.body;
                        if (!input || typeof input !== 'object' || Array.isArray(input) || !['draftId', 'expectedRevision'].every(key => Object.hasOwn(input, key)) || Object.keys(input).some(key => !['draftId', 'expectedRevision', 'packingPresetId', 'shippingServiceCode'].includes(key)) || !UUID.test(input.draftId ?? '')) deny(400, 'INVALID_REQUEST');
                        revision(input.expectedRevision);
                        for (const field of ['packingPresetId', 'shippingServiceCode']) if (Object.hasOwn(input, field) && (typeof input[field] !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(input[field]))) deny(400, 'INVALID_REQUEST');
                        body = await invoke('quote', input);
                    } else if (path === '/api/customer/commerce/payments') {
                        keys(req.body, ['quoteId', 'requestId']);
                        if (![req.body.quoteId, req.body.requestId].every(value => UUID.test(value ?? ''))) deny(400, 'INVALID_REQUEST');
                        body = await invoke('pay', req.body);
                    } else {
                        const match = /^\/api\/customer\/commerce\/(orders|payments)\/([a-f0-9-]{36})(?:\/reconcile)?$/.exec(path);
                        if (!match || !UUID.test(match[2])) deny(400, 'INVALID_REQUEST');
                        if (match[1] === 'orders') body = await auth.call(cookieHeader, 'commerce_order', { orderId: match[2] });
                        else { keys(req.body, []); body = await invoke('reconcile', { attemptId: match[2] }); }
                    }
                }
            } else if (path.startsWith('/api/customer/intake/')) {
                const match = /^\/api\/customer\/intake\/drafts(?:\/([a-f0-9-]{36})(?:\/(cards|review)(?:\/([a-f0-9-]{36})\/(correct|uploads)(?:\/([a-f0-9-]{36})\/(sign|complete))?)?)?)?$/.exec(path);
                if (!match) deny(404, 'NOT_FOUND');
                const [, id, section, cardId, action, uploadId, effect] = match;
                for (const value of [id, cardId, uploadId]) if (value && !UUID.test(value)) deny(400, 'INVALID_REQUEST');
                if (new URL(req.url, state.config.origin).search) deny(400, 'INVALID_REQUEST');
                if (method === 'GET') body = await auth.call(cookieHeader, id ? 'intake_read' : 'intake_list', id ? { id } : {});
                else if (!id) body = await auth.call(cookieHeader, 'intake_create', createInput(req.body), csrf ?? '');
                else if (effect) {
                    keys(req.body, []);
                    const authority = { ...auth.authority(cookieHeader, csrf ?? ''), binding: state.config.binding };
                    if (!state.intake || typeof state.intake[effect] !== 'function') deny(503, 'INTAKE_CONFIGURATION_REQUIRED');
                    body = await state.intake[effect](authority, { id, cardId, uploadId });
                } else if (action === 'correct') {
                    keys(req.body, ['expectedRevision', 'identity']);
                    body = await auth.call(cookieHeader, 'intake_correct', { id, cardId, expectedRevision: revision(req.body.expectedRevision), identity: identityInput(req.body.identity) }, csrf ?? '');
                } else if (section === 'cards') body = await auth.call(cookieHeader, 'intake_card', { id, card: cardInput(req.body) }, csrf ?? '');
                else if (section === 'review') {
                    keys(req.body, ['expectedRevision', 'profile']);
                    body = await auth.call(cookieHeader, 'intake_review', { id, expectedRevision: revision(req.body.expectedRevision), profile: profile(req.body.profile) }, csrf ?? '');
                } else deny(405, 'METHOD_NOT_ALLOWED');
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
            const known = error instanceof BoundaryError || error instanceof CustomerIntakeError || error instanceof CustomerServiceError;
            return res.status(known ? error.status : 503).json({ error: known ? error.code : 'TEMPORARILY_UNAVAILABLE' });
        }
    };
}
