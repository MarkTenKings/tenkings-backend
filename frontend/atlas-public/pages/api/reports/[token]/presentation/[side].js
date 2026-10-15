import { publicHeaders, reportSelector } from '../../../../../lib/server/policy.mjs';
import { runtime } from '../../../../../lib/server/runtime.mjs';

export const config = { api: { bodyParser: false, responseLimit: false }, maxDuration: 40 };

// Presentation media is separate from the immutable grading photographs.
// Every read still checks current publication authority, including HEAD.
export default async function handler(req, res) {
  publicHeaders(res);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).end();
  }
  let selector;
  try {
    selector = reportSelector(req.query.token, req.query.v);
    if (!selector.version || !['FRONT', 'BACK'].includes(req.query.side)
      || typeof req.query.sha !== 'string' || !/^[a-f0-9]{64}$/.test(req.query.sha)
      || req.query.delivery !== undefined && req.query.delivery !== 'direct') throw new Error('INVALID_PRESENTATION');
    selector = { ...selector, side: req.query.side, outputSha256: req.query.sha };
  } catch { return res.status(404).end(); }
  try {
    const result = await runtime(req).reportImage(selector);
    if (!result) return res.status(404).end();
    if (result.access) {
      if (req.query.delivery === 'direct') {
        res.setHeader('Content-Type', 'application/json');
        return req.method === 'HEAD' ? res.status(200).end() : res.status(200).json(result.access);
      }
      res.setHeader('Location', result.access.image.url);
      return res.status(307).end();
    }
    if (req.query.delivery === 'direct') return res.status(404).end();
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Length', result.bytes.length);
    res.setHeader('Content-Disposition', 'inline');
    return req.method === 'HEAD' ? res.status(200).end() : res.status(200).send(result.bytes);
  } catch { return res.status(503).end(); }
}
