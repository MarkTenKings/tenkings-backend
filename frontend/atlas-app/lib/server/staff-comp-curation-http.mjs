// Standalone/unregistered. Composition must supply the existing staff auth,
// ingress guard and the actual saved-evidence curation service. No fallback.
import { ManualServiceError } from '@atlas/manual-service/contract';
import { compCurationInput, compCurationReadInput } from '../../../../packages/atlas-connected-manual/src/comp-curation-contract.mjs';
import { assertWrite, deny, isBoundaryError, privateHeaders } from './policy.mjs';
import { curationStaff, curationSame, parseCurationResponse } from '../staff-comp-curation-client.mjs';

const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
const route = new RegExp(`^/api/staff/comp-curation/cards/(${UUID})(/decision)?$`);
function emptyGet(req) {
  const v = req.body;
  return (v == null || v === '' || Buffer.isBuffer(v) && v.length === 0
    || v && Object.getPrototypeOf(v) === Object.prototype && Reflect.ownKeys(v).length === 0)
    && [undefined, '0'].includes(req.headers['content-length']) && req.headers['transfer-encoding'] === undefined
    && (req.rawBody === undefined || Buffer.isBuffer(req.rawBody) && req.rawBody.length === 0) && !(req.readableLength > 0);
}
export function createStaffCompCurationHandler(options = {}) {
  const { auth, service, assertRequest, origin } = options;
  const designationReviewsEnabled = options.designationReviewsEnabled;
  const authenticate = auth?.authenticate, read = service?.read, decide = service?.decide;
  const configured = () => {
    if (typeof authenticate !== 'function' || typeof read !== 'function' || typeof decide !== 'function'
      || typeof assertRequest !== 'function' || typeof origin !== 'string') deny(503, 'COMP_NOT_CONFIGURED');
    let url; try { url = new URL(origin); } catch { deny(503, 'COMP_NOT_CONFIGURED'); }
    if (url.origin !== origin || !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
      || options.auth !== auth || options.service !== service || options.assertRequest !== assertRequest || options.origin !== origin
      || auth.authenticate !== authenticate || service.read !== read || service.decide !== decide
      || options.designationReviewsEnabled !== designationReviewsEnabled
      || designationReviewsEnabled !== undefined && typeof designationReviewsEnabled !== 'boolean') deny(503, 'COMP_NOT_CONFIGURED');
  };
  const admitted = req => {
    configured();
    // Existing staff ingress is a synchronous throwing/void guard. A predicate
    // or an unfinished Promise cannot attest admission. Observe a rejected
    // Promise solely to prevent an unhandled rejection; never await/admit it.
    const result = Reflect.apply(assertRequest, options, [req]);
    if (result && typeof result.then === 'function') { void Promise.resolve(result).catch(() => {}); deny(503, 'COMP_NOT_CONFIGURED'); }
    if (result !== undefined) deny(503, 'COMP_NOT_CONFIGURED');
    configured();
  };
  return async function handler(req, res) {
    privateHeaders(res);
    try {
      admitted(req);
      if (typeof req.url !== 'string' || req.url.length > 1200 || !req.url.startsWith('/') || /[\\#%]/.test(req.url)) deny(400, 'COMP_REQUEST_INVALID');
      const url = new URL(req.url, origin), match = route.exec(url.pathname);
      if (url.origin !== origin || url.pathname !== req.url.split('?')[0] || !match) deny(404, 'NOT_FOUND');
      const action = match[2] ? 'decide' : 'read', method = action === 'read' ? 'GET' : 'POST';
      if (req.method !== method) { res.setHeader('Allow', method); deny(405, 'METHOD_NOT_ALLOWED'); }
      let input, csrf;
      if (action === 'read') {
        if (!emptyGet(req) || [...url.searchParams.keys()].length !== 2
          || url.searchParams.getAll('approvalActionId').length !== 1 || url.searchParams.getAll('previewId').length !== 1) deny(400, 'COMP_REQUEST_INVALID');
        input = compCurationReadInput({ approvalActionId: url.searchParams.get('approvalActionId'), previewId: url.searchParams.get('previewId') === 'none' ? null : url.searchParams.get('previewId') });
      } else {
        if (url.search || req.headers['transfer-encoding'] !== undefined) deny(400, 'COMP_REQUEST_INVALID');
        const length = req.headers['content-length'];
        if (length !== undefined && (typeof length !== 'string' || !/^\d{1,5}$/.test(length))) deny(400, 'COMP_REQUEST_INVALID');
        if (length !== undefined && Number(length) > 4096) deny(413, 'COMP_REQUEST_TOO_LARGE');
        assertWrite(req, origin); csrf = req.headers['x-atlas-csrf'];
        if (typeof csrf !== 'string' || !csrf || csrf.length > 512) deny(403, 'CSRF_REQUIRED');
        if (Buffer.byteLength(JSON.stringify(req.body ?? null)) > 4096) deny(413, 'COMP_REQUEST_TOO_LARGE');
        input = compCurationInput(req.body, { designationReviewsEnabled: designationReviewsEnabled === true });
      }
      const cookie = req.headers.cookie ?? '';
      if (typeof cookie !== 'string' || cookie.length > 8192) deny(401, 'SIGN_IN_REQUIRED');
      const staff = await authenticate.call(auth, cookie, csrf), actor = curationStaff(staff);
      configured();
      const result = await (action === 'read' ? read : decide).call(service, staff, match[1], input);
      admitted(req);
      const current = curationStaff(await authenticate.call(auth, cookie, csrf));
      admitted(req); // Final authentication can itself await live state/locks.
      if (!curationSame(actor, current)) deny(401, 'SIGN_IN_REQUIRED');
      const body = { schema: 'atlas-staff-comp-curation-response-v1', staff: actor, result };
      parseCurationResponse(body, { staff: actor, cardId: match[1], input, action });
      if (Buffer.byteLength(JSON.stringify(body)) > 2097152) deny(503, 'COMP_RESPONSE_UNAVAILABLE');
      return res.status(200).json(body);
    } catch (error) {
      const known = isBoundaryError(error) || error instanceof ManualServiceError;
      const status = error?.code === 'COMP_ACCESS_ENDED' ? 401 : known && [400, 401, 403, 404, 405, 409, 410, 413, 415, 429, 503].includes(error.status) ? error.status : 503;
      // No HTTP error claims a confirmed rollback. Post-commit auth/transport
      // failure is intentionally indistinguishable from an uncertain outcome.
      const code = known && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.code) ? error.code : status === 401 ? 'SIGN_IN_REQUIRED' : 'COMP_UNAVAILABLE';
      return res.status(status).json({ error: code });
    }
  };
}
