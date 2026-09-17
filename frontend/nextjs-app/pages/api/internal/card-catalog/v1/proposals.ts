import { createCardCatalogServiceHandler } from '../../../../../lib/server/cardCatalogService';
export const config = { api: { bodyParser: { sizeLimit: '512kb' } } };
export default createCardCatalogServiceHandler('proposals');
