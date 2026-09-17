import { createHandler } from '../../../lib/server/http.mjs';
import { runtime } from '../../../lib/server/runtime.mjs';
// Match the manual proxy's 2 MiB transport bound. Route handlers retain their
// smaller action limits, including legacy grading, learning and ordinary writes.
export const config = { api: { bodyParser: { sizeLimit: '2mb' } }, maxDuration: 240 };
export default function handler(req, res) { return createHandler(runtime)(req, res); }
