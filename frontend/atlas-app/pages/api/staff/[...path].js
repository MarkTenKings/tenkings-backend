import { createHandler } from '../../../lib/server/http.mjs';
import { runtime } from '../../../lib/server/runtime.mjs';
export const config = { api: { bodyParser: { sizeLimit: '16kb' } } };
export default function handler(req, res) { return createHandler(runtime)(req, res); }
