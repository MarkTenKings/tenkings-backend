import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "node:crypto";
import { toErrorResponse } from "../../../lib/server/admin";

const MAX_AGE_MS = 5 * 60 * 1000;

function getAllowedHost(): string | null {
  const base = process.env.CARD_STORAGE_PUBLIC_BASE_URL;
  if (!base) return null;
  try {
    return new URL(base).host;
  } catch {
    return null;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ message: "Method not allowed" });
    }

    const url = typeof req.query.url === "string" ? req.query.url : "";
    const exp = typeof req.query.exp === "string" ? Number(req.query.exp) : NaN;
    const sig = typeof req.query.sig === "string" ? req.query.sig : "";
    if (!url || Number.isNaN(exp) || !sig) {
      return res.status(400).json({ message: "Missing url, exp, or sig" });
    }

    if (Date.now() > exp + 5_000) {
      return res.status(401).json({ message: "Signature expired" });
    }

    const secret = process.env.OCR_PROXY_SECRET ?? process.env.OPENAI_API_KEY;
    if (!secret) {
      return res.status(503).json({ message: "OCR proxy not configured" });
    }

    const allowedHost = getAllowedHost();
    if (!allowedHost) {
      return res.status(503).json({ message: "Storage base URL not configured" });
    }

    const parsed = new URL(url);
    if (parsed.host !== allowedHost) {
      return res.status(403).json({ message: "Host not allowed" });
    }

    const payload = `${url}|${exp}`;
    const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) {
      return res.status(403).json({ message: "Invalid signature" });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        return res.status(502).json({ message: `Upstream error: ${response.status}` });
      }

      const contentType = response.headers.get("content-type") ?? "application/octet-stream";
      const contentLength = response.headers.get("content-length");
      res.setHeader("Content-Type", contentType);
      if (contentLength) {
        res.setHeader("Content-Length", contentLength);
      }
      res.setHeader("Cache-Control", `public, max-age=${Math.floor(MAX_AGE_MS / 1000)}`);

      const arrayBuffer = await response.arrayBuffer();
      return res.status(200).send(Buffer.from(arrayBuffer));
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    const { status, message } = toErrorResponse(error);
    return res.status(status).json({ message });
  }
}
