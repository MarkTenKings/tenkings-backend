import type { NextApiRequest, NextApiResponse } from "next";
import { ElevenLabsWebhookError, verifyAndParseElevenLabsWebhook } from "../../../../lib/server/elevenlabs";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const verified = await verifyAndParseElevenLabsWebhook(req);
    return res.status(200).json({
      ok: true,
      authMode: verified.authMode,
    });
  } catch (error) {
    if (error instanceof ElevenLabsWebhookError) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    if (error instanceof Error) {
      return res.status(401).json({ message: error.message });
    }
    return res.status(401).json({ message: "Invalid webhook" });
  }
}
