import { NextApiRequest, NextApiResponse } from "next";
import { requireAdminSession, toErrorResponse } from "../../../lib/server/admin";

const HEADER_ALLOWLIST = new Set([
  "content-type",
  "content-length",
  "etag",
  "last-modified",
  "cache-control",
]);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await requireAdminSession(req);

    if (req.method !== "POST") {
      return res.status(405).json({ message: "Method not allowed" });
    }

    const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
    if (!url) {
      return res.status(400).json({ message: "Missing url" });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);

    try {
      const response = await fetch(url, {
        method: "HEAD",
        signal: controller.signal,
      });

      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        if (HEADER_ALLOWLIST.has(key.toLowerCase())) {
          headers[key.toLowerCase()] = value;
        }
      });

      return res.status(200).json({
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    const { status, message } = toErrorResponse(error);
    return res.status(status).json({ message });
  }
}
