import { createHandler } from '../../../lib/server/http.mjs';
import { runtime } from '../../../lib/server/runtime.mjs';
export const config = { api: { bodyParser: { sizeLimit: '32kb' } }, maxDuration: 30 };
export default createHandler(runtime);
