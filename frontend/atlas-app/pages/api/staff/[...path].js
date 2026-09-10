import { createHandler } from '../../../lib/server/http.mjs';
import { runtime } from '../../../lib/server/runtime.mjs';
// The named grading action accepts this parser bound. Learning decisions allow
// 32 KiB for 256 selected IDs; other writes retain a 16 KiB handler cap.
// The bitmap contract has exactly 376,344 base64 bytes.
export const config = { api: { bodyParser: { sizeLimit: '1mb' } }, maxDuration: 240 };
export default function handler(req, res) { return createHandler(runtime)(req, res); }
