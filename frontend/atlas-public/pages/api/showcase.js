import { runtime } from '../../lib/server/runtime.mjs';
import { createShowcaseHandler } from '../../lib/server/showcase-http.mjs';

export const config = { api: { bodyParser: false, responseLimit: false }, maxDuration: 40 };
export default createShowcaseHandler({ readerForRequest: runtime });
