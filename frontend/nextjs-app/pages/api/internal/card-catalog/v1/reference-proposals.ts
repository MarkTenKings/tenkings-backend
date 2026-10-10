import { createCardCatalogServiceHandler } from '../../../../../lib/server/cardCatalogService';
export const config = { api: { bodyParser: { sizeLimit: '4300kb' } } };
export default createCardCatalogServiceHandler('reference-proposals');
