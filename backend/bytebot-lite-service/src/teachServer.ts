import http from "http";
import { chromium, Browser, BrowserContext, Page } from "playwright";

type TeachSession = {
  id: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  viewport: { width: number; height: number };
  createdAt: number;
};

const SESSION_TTL_MS = 30 * 60 * 1000;
let currentSession: TeachSession | null = null;

const HEADLESS = (process.env.BYTEBOT_LITE_HEADLESS ?? "true").toLowerCase() !== "false";
const VIEWPORT_WIDTH = Number(process.env.BYTEBOT_LITE_VIEWPORT_WIDTH ?? 1280);
const VIEWPORT_HEIGHT = Number(process.env.BYTEBOT_LITE_VIEWPORT_HEIGHT ?? 720);
const PORT = Number(process.env.BYTEBOT_TEACH_PORT ?? 8088);
const SECRET = process.env.BYTEBOT_TEACH_SECRET ?? "";

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function closeSession() {
  if (!currentSession) return;
  try {
    await currentSession.page.close();
  } catch {
    // ignore
  }
  try {
    await currentSession.context.close();
  } catch {
    // ignore
  }
  try {
    await currentSession.browser.close();
  } catch {
    // ignore
  }
  currentSession = null;
}

async function ensureSession(url: string) {
  if (currentSession) {
    await closeSession();
  }
  const browser = await chromium.launch({
    headless: HEADLESS,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--single-process",
      "--no-zygote",
    ],
  });
  const context = await browser.newContext({
    viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  const session: TeachSession = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    browser,
    context,
    page,
    viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
    createdAt: Date.now(),
  };
  currentSession = session;
  return session;
}

async function takeScreenshot(page: Page) {
  const buffer = await page.screenshot({ type: "jpeg", quality: 70 });
  return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}

async function selectorFromPoint(page: Page, x: number, y: number) {
  return page.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return null;
      const cssEscape =
        (window as any).CSS?.escape ??
        ((value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "\\$&"));
      if ((el as HTMLElement).id) {
        return `#${cssEscape((el as HTMLElement).id)}`;
      }
      const path: string[] = [];
      let node: Element | null = el;
      while (node && node.tagName.toLowerCase() !== "html") {
        const tag = node.tagName.toLowerCase();
        let selector = tag;
        if (node.classList.length) {
          selector += `.${Array.from(node.classList)
            .slice(0, 2)
            .map((cls) => cssEscape(cls))
            .join(".")}`;
        }
        const parent: Element | null = node.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter(
            (child) => child.tagName === node!.tagName
          );
          if (siblings.length > 1) {
            const index = siblings.indexOf(node) + 1;
            selector += `:nth-of-type(${index})`;
          }
        }
        path.unshift(selector);
        node = parent;
      }
      return path.join(" > ");
    },
    { x, y }
  );
}

export function startTeachServer() {
  if (!PORT) return;
  const server = http.createServer(async (req, res) => {
    if (!req.url) {
      return json(res, 404, { message: "Not found" });
    }
    if (SECRET && req.headers["x-bytebot-secret"] !== SECRET) {
      return json(res, 401, { message: "Unauthorized" });
    }

    const now = Date.now();
    if (currentSession && now - currentSession.createdAt > SESSION_TTL_MS) {
      await closeSession();
    }

    if (req.method === "POST" && req.url.startsWith("/teach/start")) {
      const body = await readBody(req);
      const url = typeof body.url === "string" ? body.url : "";
      if (!url) {
        return json(res, 400, { message: "Missing url" });
      }
      const session = await ensureSession(url);
      const image = await takeScreenshot(session.page);
      return json(res, 200, {
        sessionId: session.id,
        image,
        url: session.page.url(),
        viewport: session.viewport,
      });
    }

    if (req.method === "POST" && req.url.startsWith("/teach/click")) {
      const body = await readBody(req);
      const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
      const x = Number(body.x ?? -1);
      const y = Number(body.y ?? -1);
      if (!currentSession || sessionId !== currentSession.id) {
        return json(res, 404, { message: "Session not found" });
      }
      if (x < 0 || y < 0) {
        return json(res, 400, { message: "Invalid coordinates" });
      }
      const selector = await selectorFromPoint(currentSession.page, x, y);
      await currentSession.page.mouse.click(x, y).catch(() => undefined);
      await currentSession.page.waitForLoadState("networkidle").catch(() => undefined);
      const image = await takeScreenshot(currentSession.page);
      return json(res, 200, {
        sessionId: currentSession.id,
        selector,
        image,
        url: currentSession.page.url(),
        viewport: currentSession.viewport,
      });
    }

    if (req.method === "POST" && req.url.startsWith("/teach/stop")) {
      await closeSession();
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { message: "Not found" });
  });

  server.listen(PORT, () => {
    console.log(`[bytebot-lite] teach server listening on ${PORT}`);
  });
}
