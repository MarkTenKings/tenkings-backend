import { createCardCatalogServiceHandler } from '../../../../../lib/server/cardCatalogService';
export const config = { api: { bodyParser: { sizeLimit: '16kb' } } };
export default createCardCatalogServiceHandler('demand');
