import { requireThat } from '@atlas/manual-service/contract';
const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
const route = new RegExp(`^/api/staff/manual-connected/cards/(${UUID})/(gallery|gallery-preview)$`);
const HASH = /^[a-f0-9]{64}$/;
const need = value => requireThat(value, 400, 'GALLERY_REQUEST_INVALID');
export function galleryPreviewQuery(url) {
  const keys = ['intakeRevision', 'sourceHash', 'uploadId', 'version', 'originalSha256', 'manualRevision', 'manualContentHash'];
  need([...url.searchParams.keys()].length === keys.length && keys.every(key => url.searchParams.getAll(key).length === 1));
  const values = Object.fromEntries(url.searchParams);
  const number = value => { need(/^[1-9][0-9]{0,9}$/.test(value) && Number(value) < 2147483647); return Number(value); };
  const hash = value => { need(value === 'none' || HASH.test(value)); return value === 'none' ? null : value; };
  need(new RegExp(`^${UUID}$`).test(values.uploadId) && HASH.test(values.originalSha256));
  const result = { intakeRevision: number(values.intakeRevision), sourceHash: hash(values.sourceHash), uploadId: values.uploadId,
    version: number(values.version), originalSha256: values.originalSha256,
    manualRevision: values.manualRevision === 'none' ? null : number(values.manualRevision), manualContentHash: hash(values.manualContentHash) };
  need((result.manualRevision === null) === (result.manualContentHash === null)); return result;
}
export function createStaffCardGalleryHandler({ connected, boundary }) {
  return async (req, res, url) => {
    const found = route.exec(url.pathname); if (!found) return false;
    // Error replies must retain the same private policy so callers can safely
    // distinguish stale source/access from a retryable display failure.
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    requireThat(req.method === 'GET', 405, 'METHOD_NOT_ALLOWED');
    need(!req.headers['transfer-encoding'] && (req.headers['content-length'] === undefined || req.headers['content-length'] === '0')
      && (req.body === undefined || req.body === null || req.body === '' || Object.getPrototypeOf(req.body) === Object.prototype && !Object.keys(req.body).length));
    const preview = found[2] === 'gallery-preview';
    if (!preview) need(!url.search);
    const input = preview ? galleryPreviewQuery(url) : null;
    requireThat(connected.gallery, 503, 'GALLERY_UNAVAILABLE');
    const staff = await boundary.authenticate(req.headers.cookie ?? '');
    const result = preview ? await connected.gallery.preview(staff, found[1], input) : await connected.gallery.read(staff, found[1]);
    res.status(200).json(result); return true;
  };
}
