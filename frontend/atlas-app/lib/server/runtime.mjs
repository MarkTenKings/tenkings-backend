import { LocalStaffAuth } from './auth.mjs';
import { LocalReviewStore } from './review.mjs';
import { assertLocalRequest, privateHeaders } from './policy.mjs';
export function runtime() {
    // Next development reloads preserve this fixture process only. Restart clears it.
    const key = Symbol.for('atlas.staff.local.v1');
    globalThis[key] ??= { auth: new LocalStaffAuth(), review: new LocalReviewStore() };
    // Preserve fixture records, but apply current guards after a development reload.
    Object.setPrototypeOf(globalThis[key].auth, LocalStaffAuth.prototype);
    Object.setPrototypeOf(globalThis[key].review, LocalReviewStore.prototype);
    return globalThis[key];
}
export function pageAccess(ctx, { authenticated = true } = {}) {
    privateHeaders(ctx.res);
    if (!['GET', 'HEAD'].includes(ctx.req.method)) {
        ctx.res.setHeader('Allow', 'GET, HEAD');
        ctx.res.statusCode = 405;
        return { props: { unavailable: true } };
    }
    try {
        assertLocalRequest(ctx.req, process.env);
    }
    catch {
        ctx.res.statusCode = 503;
        return { props: { unavailable: true } };
    }
    if (!authenticated)
        return { props: {} };
    const staff = runtime().auth.maybeAuthenticate(ctx.req.headers.cookie);
    if (!staff)
        return { redirect: { destination: '/', permanent: false } };
    return { props: { staff } };
}
