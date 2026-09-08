import { approvedMediaHandler } from '../../../../../lib/server/media-http.mjs';
export const config = { api: { bodyParser: false, responseLimit: false }, maxDuration: 40 };
export default approvedMediaHandler('image');
