import { requireThat } from '@atlas/manual-service/contract';
import { cardProvenanceRoute, cardProvenanceQuery } from './card-provenance-contract.mjs';

export function createCardProvenanceHandler({ connected, boundary }) {
  return async (req, res, url) => {
    if (!cardProvenanceRoute(url.pathname)) return false;
    res.setHeader('Cache-Control', 'private, no-store');
    requireThat(req.method === 'GET', 405, 'METHOD_NOT_ALLOWED');
    const { cardId, input } = cardProvenanceQuery(url);
    const staff = await boundary.authenticate(req.headers.cookie ?? '');
    requireThat(connected.cardProvenance, 503, 'CARD_PROVENANCE_UNAVAILABLE');
    res.status(200).json(await connected.cardProvenance.read(staff, cardId, input));
    return true;
  };
}
