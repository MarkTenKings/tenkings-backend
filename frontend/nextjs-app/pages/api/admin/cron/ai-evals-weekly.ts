import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "node:crypto";

type CronEvalResponse =
  | {
      ok: true;
      triggeredAt: string;
      runId: string;
      gatePass: boolean;
      failedChecks: string[];
    }
  | {
      ok: false;
      message: string;
    };

function readHeaderFirst(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return String(value[0] || "").trim();
  }
  return String(value || "").trim();
}

function safeEqual(a: string, b: string): boolean {
  if (!a || !b) {
    return false;
  }
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

function buildBaseUrl(req: NextApiRequest): string {
  const host = readHeaderFirst(req.headers.host);
  if (!host) {
    throw new Error("Missing host header");
  }
  const protocol = readHeaderFirst(req.headers["x-forwarded-proto"]) || "https";
  return `${protocol}://${host}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<CronEvalResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, message: "Method not allowed" });
  }

  try {
    const cronSecret = (process.env.AI_EVAL_CRON_SECRET ?? "").trim();
    const incoming = readHeaderFirst(req.headers["x-ai-eval-cron-secret"]);
    if (!safeEqual(incoming, cronSecret)) {
      return res.status(401).json({ ok: false, message: "Unauthorized" });
    }

    const baseUrl = buildBaseUrl(req);
    const runResponse = await fetch(`${baseUrl}/api/admin/ai-ops/evals/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-ai-eval-cron-secret": cronSecret,
      },
      body: JSON.stringify({
        trigger: "scheduled",
      }),
    });
    const payload = await runResponse.json().catch(() => ({}));
    if (!runResponse.ok || !payload || typeof payload !== "object") {
      return res.status(500).json({ ok: false, message: "Failed to run weekly eval" });
    }
    const typed = payload as {
      runId?: string;
      summary?: { gate?: { pass?: boolean; failedChecks?: string[] } };
    };
    return res.status(200).json({
      ok: true,
      triggeredAt: new Date().toISOString(),
      runId: typed.runId || "",
      gatePass: typed.summary?.gate?.pass === true,
      failedChecks: Array.isArray(typed.summary?.gate?.failedChecks)
        ? typed.summary?.gate?.failedChecks.filter((entry): entry is string => typeof entry === "string")
        : [],
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : "Failed to trigger weekly eval",
    });
  }
}
