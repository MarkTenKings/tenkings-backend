import { approvedMediaHandler } from '../../../../../lib/server/media-http.mjs';
export const config = { api: { bodyParser: false } };
export default approvedMediaHandler('trace');
