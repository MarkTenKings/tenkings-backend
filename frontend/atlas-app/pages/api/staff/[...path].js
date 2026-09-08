import { createHandler } from '../../../lib/server/http.mjs';
import { runtime } from '../../../lib/server/runtime.mjs';
// Only the named grading action accepts this bound; all other writes retain
// their 16 KiB handler cap. The bitmap contract has exactly 376,344 base64 bytes.
export const config = { api: { bodyParser: { sizeLimit: '1mb' } }, maxDuration: 240 };
export default function handler(req, res) { return createHandler(runtime)(req, res); }
