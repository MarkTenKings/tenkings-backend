import { createHandler } from '../../../lib/server/http.mjs';
import { runtime } from '../../../lib/server/runtime.mjs';
// The signed private call has a 95-second deadline. Allow authentication and an
// explicit recovery response before the public external rewrite's 120s limit.
export const config = { api: { bodyParser: { sizeLimit: '32kb' } }, maxDuration: 110 };
export default createHandler(runtime);
