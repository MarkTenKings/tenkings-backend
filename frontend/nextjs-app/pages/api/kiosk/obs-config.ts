import type { NextApiRequest, NextApiResponse } from "next";

type ObsConfigResponse =
  | { enabled: false }
  | {
      enabled: true;
      wsUrl: string;
      password: string;
      sceneAttract: string;
      sceneCountdown: string;
      sceneLive: string;
      sceneReveal: string;
      maxAttempts: number;
      retryDelayMs: number;
    };

export default function handler(req: NextApiRequest, res: NextApiResponse<ObsConfigResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end("Method Not Allowed");
  }

  const wsUrl = process.env.OBS_WS_URL;
  if (!wsUrl) {
    return res.status(200).json({ enabled: false });
  }

  const password = process.env.OBS_WS_PASSWORD ?? "";

  const sceneAttract = process.env.OBS_SCENE_ATTRACT ?? "Attract Loop";
  const sceneCountdown = process.env.OBS_SCENE_COUNTDOWN ?? "Intro Countdown";
  const sceneLive = process.env.OBS_SCENE_LIVE ?? "Live Rip";
  const sceneReveal = process.env.OBS_SCENE_REVEAL ?? "Slab Reveal";

  const maxAttemptsRaw = process.env.OBS_WS_MAX_ATTEMPTS ?? process.env.NEXT_PUBLIC_OBS_MAX_ATTEMPTS;
  const retryDelayRaw = process.env.OBS_WS_RETRY_DELAY_MS ?? process.env.NEXT_PUBLIC_OBS_RETRY_MS;

  const maxAttempts = maxAttemptsRaw != null ? Number(maxAttemptsRaw) || 5 : 5;
  const retryDelayMs = retryDelayRaw != null ? Number(retryDelayRaw) || 2000 : 2000;

  return res.status(200).json({
    enabled: true,
    wsUrl,
    password,
    sceneAttract,
    sceneCountdown,
    sceneLive,
    sceneReveal,
    maxAttempts,
    retryDelayMs,
  });
}
