import type { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

const allowedOrigin = process.env.ADMIN_UPLOAD_CORS_ORIGIN ?? "*";

export function withAdminCors<T>(handler: NextApiHandler<T>): NextApiHandler<T> {
  return async (req: NextApiRequest, res: NextApiResponse<T>) => {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Access-Control-Allow-Methods", "OPTIONS,GET,POST,PUT,PATCH");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Operator-Key"
    );
    res.setHeader("Vary", "Origin");

    if (req.method === "OPTIONS") {
      res.status(200).end();
      return;
    }

    return handler(req, res);
  };
}
