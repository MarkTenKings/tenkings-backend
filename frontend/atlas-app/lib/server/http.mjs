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
            if (state.proposals) patterns.push(['POST', new RegExp(`^/api/staff/cards/${cardPattern}/proposals$`)]);
            if (state.identityCorrection) patterns.push(['POST', new RegExp(`^/api/staff/cards/${cardPattern}/identity-correction$`)]);
            if (state.learning) patterns.push(['GET', new RegExp(`^/api/staff/cards/${cardPattern}/learning$`)],
                ['POST', new RegExp(`^/api/staff/cards/${cardPattern}/learning/(preview|decisions)$`)]);
            if (state.finishing) patterns.push(['GET', new RegExp(`^/api/staff/cards/${cardPattern}/finishing$`)],
                ['POST', new RegExp(`^/api/staff/cards/${cardPattern}/finishing/(label|nfc-job|nfc-verify|physical)$`)],
                ['GET', new RegExp(`^/api/staff/cards/${cardPattern}/finishing/nfc-job/([a-f0-9-]{36})$`)]);
            if (state.resolution) patterns.push(['POST', /^\/api\/staff\/operations\/resolution\/(inspect|cancel-initialization|abandon)$/]);
            if (state.machine) patterns.push(['POST', /^\/api\/staff\/operations\/machine\/admit$/],
                ['GET', /^\/api\/staff\/operations\/machine\/([a-f0-9-]{36})$/]);
            if (state.operations) patterns.push(['GET', /^\/api\/staff\/operations\/roster$/],
                ['POST', /^\/api\/staff\/operations\/(roster\/update|assign|intake\/preview|intake\/admit|pilots\/prepare|invoices\/reconcile)$/],
                ['GET', /^\/api\/staff\/operations\/pilots\/([a-f0-9-]{36})$/]);
            if (state.grading) patterns.push(['POST', new RegExp(`^/api/staff/cards/${cardPattern}/grade$`)],
                ['POST', new RegExp(`^/api/staff/cards/${cardPattern}/trace$`)],
                ['GET', new RegExp(`^/api/staff/cards/${cardPattern}/operations/([a-f0-9-]{36})$`)]);
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
                if (Buffer.byteLength(JSON.stringify(req.body ?? {})) > (path.endsWith('/grade') ? 1_040_000
                    : path.endsWith('/learning/decisions') ? 32768 : 16384))
                    deny(413, 'REQUEST_TOO_LARGE');
            }
            let body;
            if (path === '/api/staff/session') {
                const reauthenticate = new URL(req.url, state.origin ?? 'http://127.0.0.1').searchParams.getAll('reauthenticate');
                const boot = await auth.bootstrap(cookie, client, { reauthenticate: reauthenticate.length === 1 && reauthenticate[0] === '1' });
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
                else if (path.startsWith('/api/staff/operations/')) {
                    const operation = path.slice('/api/staff/operations/'.length);
                    if (operation === 'machine/admit') body = { receipt: await state.machine.admit(staff, req.body) };
                    else if (operation.startsWith('machine/')) body = { receipt: await state.machine.status(staff, match[1]) };
                    else if (operation === 'resolution/inspect') body = { record: await state.resolution.inspect(staff, req.body) };
                    else if (operation === 'resolution/cancel-initialization') body = { receipt: await state.resolution.cancelUndispatchedInitialization(staff, req.body) };
                    else if (operation === 'resolution/abandon') body = { receipt: await state.resolution.abandonUnknown(staff, req.body) };
                    else if (operation === 'roster') body = { roster: await state.operations.roster(staff) };
                    else if (operation === 'roster/update') body = { receipt: await state.operations.updateRoster(staff, req.body) };
                    else if (operation === 'assign') body = { receipt: await state.operations.assign(staff, req.body) };
                    else if (operation === 'intake/preview') body = { preview: await state.operations.previewIntake(staff, req.body) };
                    else if (operation === 'intake/admit') body = { receipt: await state.operations.admitIntake(staff, req.body) };
                    else if (operation === 'pilots/prepare') body = { receipt: await state.operations.preparePilot(staff, req.body) };
                    else if (operation === 'invoices/reconcile') body = { receipt: await state.operations.reconcileInvoice(staff, req.body) };
                    else body = { summary: await state.operations.pilotSummary(staff, match[1]) };
                }
                else if (path.startsWith('/api/staff/evidence/')) {
                    const asset = await review.asset(staff, match[1], match[2]);
                    res.setHeader('Content-Type', asset.contentType ?? 'image/svg+xml');
                    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
                    return res.status(200).send(asset.bytes ?? asset);
                }
                else if (path.includes('/learning')) {
                    if (path.endsWith('/learning')) body = { learning: await state.learning.read(staff, match[1]) };
                    else if (match[2] === 'preview') body = { preview: await state.learning.preview(staff, match[1], req.body) };
                    else body = { receipt: await state.learning.decide(staff, match[1], req.body) };
                }
                else if (path.includes('/finishing')) {
                    if (path.endsWith('/finishing')) body = { finishing: await state.finishing.read(staff, match[1]) };
                    else if (req.method === 'GET') body = await state.finishing.retrieveNfcJob(staff, match[1], match[2]);
                    else if (match[2] === 'label') body = { receipt: await state.finishing.issueLabel(staff, match[1], req.body) };
                    else if (match[2] === 'nfc-job') body = { receipt: await state.finishing.createNfcJob(staff, match[1], req.body) };
                    else if (match[2] === 'nfc-verify') body = { receipt: await state.finishing.recordNfcVerification(staff, match[1], req.body) };
                    else body = { receipt: await state.finishing.recordPhysical(staff, match[1], req.body) };
                }
                else if (path.endsWith('/approve'))
                    body = await state.reports.approve(staff, match[1], req.body);
                else if (path.endsWith('/proposals'))
                    body = await state.proposals.decide(staff, match[1], req.body);
                else if (path.endsWith('/identity-correction'))
                    body = { correction: await state.identityCorrection.correct(staff, match[1], req.body) };
                else if (path.endsWith('/grade'))
                    body = await state.grading.run(staff, match[1], req.body);
                else if (path.endsWith('/trace'))
                    body = await state.grading.trace(staff, match[1], req.body);
                else if (path.includes('/operations/'))
                    body = await state.grading.status(staff, match[1], match[2]);
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
