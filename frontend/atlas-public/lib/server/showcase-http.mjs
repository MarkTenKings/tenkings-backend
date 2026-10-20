import { SHOWCASE_SELECTIONS, validShowcaseBinding } from '../showcase-selections.mjs';
import { digest, publicHeaders } from './policy.mjs';

export function createShowcaseHandler({ readerForRequest, selections = SHOWCASE_SELECTIONS }) {
  return async function showcase(req, res) {
    publicHeaders(res);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.setHeader('Allow', 'GET, HEAD'); return res.status(405).end();
    }
    const section = req.query?.section;
    if (typeof section !== 'string' || !Object.hasOwn(selections, section)
      || Object.keys(req.query).some(key => key !== 'section')) return res.status(404).end();
    const binding = selections[section];
    if (!validShowcaseBinding(binding)) return res.status(503).end();
    try {
      const result = await readerForRequest(req).read({ token: binding.publicToken, version: binding.approvalVersion });
      if (!result) return res.status(404).end();
      const packet = result.packet;
      if (packet?.mode !== 'PRODUCTION' || packet.publicToken !== binding.publicToken
        || packet.approvalVersion !== binding.approvalVersion || result.publicHash !== binding.publicHash
        || digest(JSON.stringify(packet)) !== binding.publicHash) return res.status(404).end();
      // Only the already-public approved projection crosses this endpoint.
      // Every request goes through the current reader; no fulfilled cache or
      // static fallback can resurrect a retired publication.
      const source = { schema: 'atlas-showcase-source-v1', section, binding: { ...binding },
        packet, publicHash: result.publicHash, explanation: result.explanation,
        ...(result.reportImages ? { reportImages: result.reportImages } : {}) };
      return req.method === 'HEAD' ? res.status(200).end() : res.status(200).json(source);
    } catch { return res.status(503).end(); }
  };
}
