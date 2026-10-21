import { requireThat } from '@atlas/manual-service/contract';
import { GRADED_CARDS_PATH, gradedCardsQuery } from './graded-cards-contract.mjs';
export { GRADED_CARDS_PATH, gradedCardsQuery } from './graded-cards-contract.mjs';
export function createGradedCardsHandler({ connected, boundary }) {
  return async (req, res, url) => {
    if (url.pathname !== GRADED_CARDS_PATH) return false;
    res.setHeader('Cache-Control', 'private, no-store');
    requireThat(req.method === 'GET', 405, 'METHOD_NOT_ALLOWED');
    const input = gradedCardsQuery(url);
    const staff = await boundary.authenticate(req.headers.cookie ?? '');
    requireThat(connected.gradedCards, 503, 'GRADED_CARDS_UNAVAILABLE');
    res.status(200).json(await connected.gradedCards.list(staff, input));
    return true;
  };
}
