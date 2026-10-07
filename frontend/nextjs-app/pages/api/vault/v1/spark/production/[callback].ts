import type { NextApiRequest, NextApiResponse } from "next";
import { receiveSparkCallback } from "../[callback]";

export const config = { api: { bodyParser: false } };
// Route-owned stage: a body, query or header cannot select another receipt domain.
export default function handler(req: NextApiRequest, res: NextApiResponse) { return receiveSparkCallback(req, res, "PRODUCTION"); }
