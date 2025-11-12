import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import OBSWebSocket from "obs-websocket-js";
import type { OBSResponseTypes } from "obs-websocket-js";
import dotenv from "dotenv";

const envCandidates = [
  path.resolve(__dirname, "../.env.local"),
  path.resolve(__dirname, "../.env"),
  path.resolve(process.cwd(), ".env.local"),
  path.resolve(process.cwd(), ".env"),
];

for (const candidate of envCandidates) {
  if (fs.existsSync(candidate)) {
    dotenv.config({ path: candidate });
    break;
  }
}

type Stage = "STANDBY" | "COUNTDOWN" | "LIVE" | "REVEAL";

interface SerializedKioskSession {
  id: string;
  status: Stage | "COMPLETE" | "CANCELLED" | "UNKNOWN";
}

interface DisplayResponse {
  location: {
    id: string;
    name: string;
    slug: string;
  };
  session: SerializedKioskSession | null;
}

interface AgentConfig {
  baseUrl: string;
  pollIntervalMs: number;
  locationId?: string;
  locationSlug?: string;
  secretHeader?: string;
  obsAddress: string;
  obsPassword?: string;
  sceneAttract: string;
  sceneCountdown: string;
  sceneLive: string;
  sceneReveal: string;
  autoStartStream: boolean;
  autoStopStream: boolean;
  autoRecord: boolean;
  scannerEnabled: boolean;
  scannerMinLength: number;
  scannerCooldownMs: number;
  scannerIdleResetMs: number;
  countdownSeconds: number;
  liveSeconds: number;
}

const config: AgentConfig = {
  baseUrl: process.env.KIOSK_AGENT_BASE_URL?.trim() || "https://collect.tenkings.co",
  pollIntervalMs: Number(process.env.KIOSK_AGENT_POLL_INTERVAL_MS || "4000"),
  locationId: process.env.KIOSK_AGENT_LOCATION_ID?.trim() || undefined,
  locationSlug: process.env.KIOSK_AGENT_LOCATION_SLUG?.trim() || undefined,
  secretHeader: process.env.KIOSK_AGENT_SECRET?.trim() || undefined,
  obsAddress: process.env.OBS_ADDRESS?.trim() || "ws://127.0.0.1:4455",
  obsPassword: process.env.OBS_PASSWORD?.trim() || undefined,
  sceneAttract: process.env.OBS_SCENE_ATTRACT?.trim() || "Attract Loop",
  sceneCountdown: process.env.OBS_SCENE_COUNTDOWN?.trim() || "Countdown",
  sceneLive: process.env.OBS_SCENE_LIVE?.trim() || "Live Rip",
  sceneReveal: process.env.OBS_SCENE_REVEAL?.trim() || "Highlight",
  autoStartStream: /^true$/i.test(process.env.OBS_AUTO_START_STREAM ?? "true"),
  autoStopStream: !/^false$/i.test(process.env.OBS_AUTO_STOP_STREAM ?? "true"),
  autoRecord: /^true$/i.test(process.env.OBS_AUTO_RECORD ?? "false"),
  scannerEnabled: /^true$/i.test(process.env.KIOSK_AGENT_SCANNER_ENABLED ?? "false"),
  scannerMinLength: Number(process.env.KIOSK_AGENT_SCANNER_MIN_LENGTH ?? "4"),
  scannerCooldownMs: Number(process.env.KIOSK_AGENT_SCANNER_COOLDOWN_MS ?? "1500"),
  scannerIdleResetMs: Number(process.env.KIOSK_AGENT_SCANNER_IDLE_RESET_MS ?? "250"),
  countdownSeconds: Number(process.env.KIOSK_AGENT_COUNTDOWN_SECONDS ?? "10"),
  liveSeconds: Number(process.env.KIOSK_AGENT_LIVE_SECONDS ?? "60"),
};

if (!config.locationId && !config.locationSlug) {
  console.error("[agent] Missing KIOSK_AGENT_LOCATION_ID or KIOSK_AGENT_LOCATION_SLUG.");
  process.exit(1);
}

class ObsController {
  private obs = new OBSWebSocket();
  private address: string;
  private password?: string;
  private connected = false;
  private connecting: Promise<void> | null = null;
  private currentScene?: string;

  constructor(address: string, password?: string) {
    this.address = address;
    this.password = password;

    this.obs.on("ConnectionClosed", () => {
      this.connected = false;
      this.connecting = null;
      console.warn("[agent] OBS connection closed. Will retry on next action.");
    });

    this.obs.on("ConnectionError", (error) => {
      this.connected = false;
      this.connecting = null;
      console.error("[agent] OBS connection error", error);
    });

    this.obs.on("CurrentProgramSceneChanged", (payload) => {
      this.currentScene = payload.sceneName;
    });
  }

  async ensureConnected() {
    if (this.connected) {
      return;
    }
    if (this.connecting) {
      return this.connecting;
    }

    this.connecting = this.obs
      .connect(this.address, this.password)
      .then(async () => {
        this.connected = true;
        const { currentProgramSceneName } = await this.obs.call("GetCurrentProgramScene");
        this.currentScene = currentProgramSceneName;
        console.info("[agent] Connected to OBS", this.address);
      })
      .catch((error) => {
        this.connected = false;
        console.error("[agent] Failed to connect to OBS", error);
        throw error;
      })
      .finally(() => {
        this.connecting = null;
      });

    return this.connecting;
  }

  async setScene(sceneName: string) {
    await this.ensureConnected();
    if (!this.connected) {
      return;
    }

    if (this.currentScene === sceneName) {
      return;
    }

    await this.obs.call("SetCurrentProgramScene", { sceneName });
    this.currentScene = sceneName;
    console.info("[agent] Switched OBS scene ->", sceneName);
  }

  async startStreamIfNeeded() {
    if (!config.autoStartStream) {
      return;
    }
    await this.ensureConnected();
    if (!this.connected) {
      return;
    }
    const status = (await this.obs.call("GetStreamStatus")) as StreamStatus;
    if (!status.outputActive) {
      await this.obs.call("StartStream");
      console.info("[agent] OBS stream started");
    }
    if (config.autoRecord && !status.outputRecordingActive) {
      await this.obs.call("StartRecord");
      console.info("[agent] OBS recording started");
    }
  }

  async stopStreamIfIdle() {
    if (!config.autoStopStream) {
      return;
    }
    await this.ensureConnected();
    if (!this.connected) {
      return;
    }
    const status = (await this.obs.call("GetStreamStatus")) as StreamStatus;
    if (status.outputActive) {
      await this.obs.call("StopStream");
      console.info("[agent] OBS stream stopped");
    }
    if (config.autoRecord && status.outputRecordingActive) {
      await this.obs.call("StopRecord");
      console.info("[agent] OBS recording stopped");
    }
  }
}

type StreamStatus = OBSResponseTypes["GetStreamStatus"] & {
  outputRecordingActive?: boolean;
};

const obsController = new ObsController(config.obsAddress, config.obsPassword);

let lastStage: Stage | "INIT" = "INIT";
let lastSessionId: string | null = null;
let lastPackCode: string | null = null;
let lastPackStartedAt = 0;
let scannerStopper: (() => void) | null = null;
let startingSession = false;

function deriveStage(session: SerializedKioskSession | null): Stage {
  if (!session) {
    return "STANDBY";
  }
  switch (session.status) {
    case "COUNTDOWN":
    case "LIVE":
    case "REVEAL":
      return session.status;
    default:
      return "STANDBY";
  }
}

async function applyStage(stage: Stage, sessionId: string | null) {
  const sceneMap: Record<Stage, string> = {
    STANDBY: config.sceneAttract,
    COUNTDOWN: config.sceneCountdown,
    LIVE: config.sceneLive,
    REVEAL: config.sceneReveal,
  };

  if (stage !== lastStage || sessionId !== lastSessionId) {
    console.info(
      "[agent] Stage",
      stage,
      sessionId ? `session=${sessionId}` : "(idle)"
    );
  }

  switch (stage) {
    case "STANDBY":
      await obsController.setScene(sceneMap[stage]);
      await obsController.stopStreamIfIdle();
      break;
    case "COUNTDOWN":
      await obsController.startStreamIfNeeded();
      await obsController.setScene(sceneMap[stage]);
      break;
    case "LIVE":
      await obsController.startStreamIfNeeded();
      await obsController.setScene(sceneMap[stage]);
      break;
    case "REVEAL":
      await obsController.setScene(sceneMap[stage]);
      break;
    default:
      break;
  }

  lastStage = stage;
  lastSessionId = sessionId;
}

async function fetchDisplay(): Promise<DisplayResponse | null> {
  const params = new URLSearchParams();
  if (config.locationId) {
    params.set("locationId", config.locationId);
  } else if (config.locationSlug) {
    params.set("slug", config.locationSlug);
  }

  const target = `${config.baseUrl.replace(/\/$/, "")}/api/kiosk/display?${params.toString()}`;
  const headers: Record<string, string> = { "cache-control": "no-cache" };
  if (config.secretHeader) {
    headers["x-kiosk-secret"] = config.secretHeader;
  }

  const response = await fetch(target, { headers });
  if (!response.ok) {
    throw new Error(`Display fetch failed (${response.status})`);
  }
  return (await response.json()) as DisplayResponse;
}

async function runAgent() {
  console.info("[agent] Starting kiosk agent for", config.locationId ?? config.locationSlug);

  scannerStopper = await initScanner(async (code) => {
    await triggerKioskSession(code);
  });

  while (true) {
    try {
      const payload = await fetchDisplay();
      const session = payload?.session ?? null;
      const stage = deriveStage(session);
      const sessionId = session?.id ?? null;
      await applyStage(stage, sessionId);
    } catch (error) {
      console.error("[agent] Poll error", error);
      await obsController.stopStreamIfIdle();
    }

    await sleep(config.pollIntervalMs);
  }
}

runAgent().catch((error) => {
  console.error("[agent] Fatal error", error);
  process.exit(1);
});

process.on("SIGINT", () => {
  console.info("[agent] Received SIGINT, exiting");
  scannerStopper?.();
  process.exit(0);
});

async function initScanner(onScan: (code: string) => Promise<void>) {
  if (!config.scannerEnabled) {
    return null;
  }

  try {
    const module = await import("iohook");
    const iohook = module.default;
    const buffer: string[] = [];
    let lastKeyTime = 0;

    const resetBuffer = () => {
      if (buffer.length) {
        buffer.length = 0;
      }
    };

    const finalizeBuffer = async () => {
      if (!buffer.length) {
        return;
      }
      const code = buffer.join("");
      buffer.length = 0;
      if (code.length < config.scannerMinLength) {
        console.warn("[agent] Ignoring short scan", code);
        return;
      }
      await onScan(code);
    };

    iohook.on("keydown", (event) => {
      const now = Date.now();
      if (now - lastKeyTime > config.scannerIdleResetMs) {
        resetBuffer();
      }
      lastKeyTime = now;

      const decoded = decodeKey(event);
      if (decoded === null) {
        return;
      }
      if (decoded === "ENTER") {
        void finalizeBuffer();
        return;
      }
      if (decoded === "BACKSPACE") {
        buffer.pop();
        return;
      }
      buffer.push(decoded);
    });

    iohook.start();
    console.info("[agent] Scanner listener enabled");

    return () => {
      iohook.stop();
    };
  } catch (error) {
    console.error("[agent] Failed to initialise scanner listener", error);
    return null;
  }
}

function decodeKey(event: { rawcode: number; shiftKey: boolean }): string | "ENTER" | "BACKSPACE" | null {
  const raw = event.rawcode;
  if (raw === 13) {
    return "ENTER";
  }
  if (raw === 8) {
    return "BACKSPACE";
  }
  if (raw >= 48 && raw <= 57) {
    return String.fromCharCode(raw);
  }
  if (raw >= 65 && raw <= 90) {
    const ch = String.fromCharCode(raw);
    return event.shiftKey ? ch : ch.toLowerCase();
  }
  // Numpad digits
  if (raw >= 96 && raw <= 105) {
    return String.fromCharCode(raw - 48);
  }
  const punctuation: Record<number, string> = {
    189: "-",
    109: "-",
    190: ".",
    191: "/",
    32: " ",
  };
  if (raw in punctuation) {
    return punctuation[raw];
  }
  return null;
}

interface StartSessionResponse {
  session?: {
    id: string;
    code: string;
  };
}

async function triggerKioskSession(packCode: string) {
  const trimmed = packCode.trim();
  const now = Date.now();
  if (!trimmed) {
    return;
  }
  if (startingSession) {
    console.warn("[agent] Scan ignored, session launch already in progress");
    return;
  }
  if (lastPackCode === trimmed && now - lastPackStartedAt < config.scannerCooldownMs) {
    console.warn("[agent] Duplicate scan ignored", trimmed);
    return;
  }

  startingSession = true;
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (config.secretHeader) {
      headers["x-kiosk-secret"] = config.secretHeader;
    }
    const payload = {
      packCode: trimmed,
      locationId: config.locationId,
      countdownSeconds: config.countdownSeconds,
      liveSeconds: config.liveSeconds,
    };
    const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/api/kiosk/start`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const data = (await response.json().catch(() => ({}))) as StartSessionResponse & {
      message?: string;
    };
    if (!response.ok) {
      throw new Error(data?.message ?? "Failed to start kiosk session");
    }
    lastPackCode = trimmed;
    lastPackStartedAt = Date.now();
    console.info(
      "[agent] Session started",
      data.session?.code ?? trimmed,
      data.session?.id ?? ""
    );
  } catch (error) {
    console.error("[agent] Unable to start session from scanner", error);
  } finally {
    startingSession = false;
  }
}
