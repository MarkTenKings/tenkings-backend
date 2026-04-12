import type { NextApiRequest, NextApiResponse } from "next";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import { buildLiveStockerPositions, methodNotAllowed } from "../../../../lib/server/stocker";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);

  const token = typeof req.query.token === "string" ? req.query.token : null;
  if (!req.headers.authorization && token) {
    req.headers.authorization = `Bearer ${token}`;
  }

  try {
    await requireAdminSession(req);
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ success: false, message: response.message });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  let closed = false;
  const send = (data: unknown) => {
    if (!closed) res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  const sendPositions = async () => {
    try {
      send({ type: "positions", stockers: await buildLiveStockerPositions(), timestamp: Date.now() });
    } catch (error) {
      console.error("[stocker] live feed failed", error);
    }
  };

  await sendPositions();
  const interval = setInterval(sendPositions, 5000);
  const heartbeat = setInterval(() => {
    if (!closed) res.write(": heartbeat\n\n");
  }, 30000);

  req.on("close", () => {
    closed = true;
    clearInterval(interval);
    clearInterval(heartbeat);
    res.end();
  });
}
