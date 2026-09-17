import { createCardCatalogServiceHandler } from '../../../../../lib/server/cardCatalogService';
export const config = { api: { bodyParser: { sizeLimit: '32kb' } } };
export default createCardCatalogServiceHandler('lookup');
