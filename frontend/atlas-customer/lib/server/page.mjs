import { runtime } from './runtime.mjs';
import { BoundaryError, privateHeaders } from './policy.mjs';
/** Authenticate the deployment hop before serving even a neutral account shell.
 * This performs no SMS, database query or customer-data lookup. */
export async function customerPage({ req, res }, props = {}, resolve = runtime) {
    privateHeaders(res);
    try {
        const state = await resolve(); state.assertRequest(req);
        return { props };
    } catch (error) {
        res.statusCode = error instanceof BoundaryError ? error.status : 503;
        return { props: { unavailable: true } };
    }
}
