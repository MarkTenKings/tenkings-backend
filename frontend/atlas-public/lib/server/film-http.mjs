import { createApprovedFilmManifest } from '@atlas/report-view/approved-film-contract';
import { publicHeaders, reportSelector } from './policy.mjs';

/** Uses the existing approved reader, including retirement/replacement checks. */
export function approvedFilmHandler(resolve) {
  return async (req, res) => {
    publicHeaders(res); res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!['GET','HEAD'].includes(req.method)) { res.setHeader('Allow','GET, HEAD'); return res.status(405).end(); }
    let selector;
    try {
      if (Object.keys(req.query).some(key => !['token','v'].includes(key))) throw Error();
      selector = reportSelector(req.query.token, req.query.v);
      if (!selector.version) throw Error();
    } catch { return res.status(404).end(); }
    try {
      const result = await resolve(req).read(selector);
      if (!result || result.packet?.version !== 'atlas-public-manual-report-v2') return res.status(404).end();
      const manifest = createApprovedFilmManifest(result);
      return req.method === 'HEAD' ? res.status(200).end() : res.status(200).json(manifest);
    } catch { return res.status(503).end(); }
  };
}
