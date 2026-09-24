import { publicHeaders, reportSelector } from '../../../../../lib/server/policy.mjs';
import { runtime } from '../../../../../lib/server/runtime.mjs';
export const config = { api: { bodyParser: false, responseLimit: false }, maxDuration: 40 };
export default async function handler(req, res) {
  publicHeaders(res); res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!['GET','HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); return res.status(405).end(); }
  let selected;
  try {
    selected = reportSelector(req.query.token, req.query.v);
    if (!selected.version || typeof req.query.revision !== 'string' || !/^[1-9][0-9]{0,9}$/.test(req.query.revision) || Number(req.query.revision) > 2147483647) throw new Error();
    selected.revision = Number(req.query.revision);
  } catch { return res.status(404).end(); }
  try {
    const result = await runtime(req).presentationImage(selected);
    if (!result) return res.status(404).end();
    res.setHeader('Content-Type', result.contentType); res.setHeader('Content-Length', result.bytes.length);
    res.setHeader('Content-Disposition', 'inline');
    return req.method === 'HEAD' ? res.status(200).end() : res.status(200).send(result.bytes);
  } catch { return res.status(503).end(); }
}
