import http from "http";
import type { AddressInfo } from "net";
import {
  CaptureHelperCommandError,
  CaptureHelperConfigError,
  createCaptureHelperService,
  buildCaptureHelperReadinessReport,
  parseCaptureHelperManifestMode,
  type CaptureHelperConfigInput,
  type CaptureHelperEnv,
  type CaptureHelperManifestMode,
} from "./index";

export const DEFAULT_CAPTURE_HELPER_TRANSPORT_HOST = "127.0.0.1";
export const DEFAULT_CAPTURE_HELPER_TRANSPORT_PORT = 47650;

export interface CaptureHelperTransportConfigInput {
  host?: string;
  port?: number | string;
  service?: CaptureHelperConfigInput;
}

export interface CaptureHelperTransportConfig {
  host: string;
  port: number;
  localOnly: true;
  service: CaptureHelperConfigInput;
}

export interface StartedCaptureHelperTransport {
  server: http.Server;
  host: string;
  port: number;
  url: string;
  config: CaptureHelperTransportConfig;
}

type JsonBody = Record<string, unknown>;

function firstNonEmpty(...values: Array<string | undefined>) {
  const value = values.find((candidate) => typeof candidate === "string" && candidate.trim().length > 0);
  return value?.trim();
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function normalizeHost(host: string | undefined): string {
  const normalized = (host ?? DEFAULT_CAPTURE_HELPER_TRANSPORT_HOST).trim().toLowerCase();
  if (!isLoopbackHost(normalized)) {
    throw new CaptureHelperConfigError("AI Grader capture helper transport only supports loopback hosts.");
  }
  return normalized;
}

function normalizePort(port: number | string | undefined): number {
  if (port == null || port === "") return DEFAULT_CAPTURE_HELPER_TRANSPORT_PORT;
  const value = typeof port === "number" ? port : Number(port);
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    throw new CaptureHelperConfigError("AI Grader capture helper transport port must be an integer from 0 to 65535.");
  }
  return value;
}

function hostForUrl(host: string): string {
  return host === "::1" ? "[::1]" : host;
}

export function buildCaptureHelperTransportConfig(
  input: CaptureHelperTransportConfigInput = {},
  env: CaptureHelperEnv = process.env
): CaptureHelperTransportConfig {
  return {
    host: normalizeHost(firstNonEmpty(input.host?.toString(), env.AI_GRADER_CAPTURE_HELPER_TRANSPORT_HOST)),
    port: normalizePort(input.port ?? env.AI_GRADER_CAPTURE_HELPER_TRANSPORT_PORT),
    localOnly: true,
    service: input.service ?? {},
  };
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(`${JSON.stringify(body)}\n`);
}

function errorResponse(status: number, code: string, message: string) {
  return {
    ok: false,
    error: {
      code,
      message,
    },
  };
}

async function readJsonBody(req: http.IncomingMessage): Promise<JsonBody> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 1024 * 1024) {
      throw new CaptureHelperCommandError("Request body must be 1MB or smaller.");
    }
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new CaptureHelperCommandError("JSON body must be an object.");
    }
    return parsed as JsonBody;
  } catch (error) {
    if (error instanceof CaptureHelperCommandError) throw error;
    throw new CaptureHelperCommandError("Request body must be valid JSON.");
  }
}

function withTransport<T extends object>(
  payload: T,
  config: CaptureHelperTransportConfig,
  server: http.Server
) {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : config.port;
  return {
    ...payload,
    transport: {
      enabled: true,
      localOnly: true,
      host: config.host,
      port,
    },
  };
}

export function createCaptureHelperHttpServer(
  input: CaptureHelperTransportConfigInput = {},
  env: CaptureHelperEnv = process.env
): http.Server {
  const config = buildCaptureHelperTransportConfig(input, env);
  const service = createCaptureHelperService(config.service, env);

  const server = http.createServer(async (req, res) => {
    try {
      if (!req.url) {
        return sendJson(res, 404, errorResponse(404, "NOT_FOUND", "Route not found."));
      }

      const url = new URL(req.url, `http://${hostForUrl(config.host)}:${config.port}`);

      if (url.pathname === "/health") {
        if (req.method !== "GET") {
          return sendJson(res, 405, errorResponse(405, "METHOD_NOT_ALLOWED", "GET is required for /health."));
        }
        return sendJson(res, 200, withTransport(service.health(), config, server));
      }

      if (url.pathname === "/capabilities") {
        if (req.method !== "GET") {
          return sendJson(res, 405, errorResponse(405, "METHOD_NOT_ALLOWED", "GET is required for /capabilities."));
        }
        return sendJson(res, 200, withTransport(service.capabilities(), config, server));
      }

      if (url.pathname === "/readiness") {
        if (req.method !== "GET") {
          return sendJson(res, 405, errorResponse(405, "METHOD_NOT_ALLOWED", "GET is required for /readiness."));
        }
        return sendJson(res, 200, withTransport(buildCaptureHelperReadinessReport(config.service, env), config, server));
      }

      if (url.pathname === "/manifest") {
        if (req.method !== "POST") {
          return sendJson(res, 405, errorResponse(405, "METHOD_NOT_ALLOWED", "POST is required for /manifest."));
        }
        const body = await readJsonBody(req);
        const mode = parseCaptureHelperManifestMode(body.mode) as CaptureHelperManifestMode;
        return sendJson(res, 200, withTransport(service.manifest(mode), config, server));
      }

      return sendJson(res, 404, errorResponse(404, "NOT_FOUND", "Route not found."));
    } catch (error) {
      const isBadRequest = error instanceof CaptureHelperCommandError || error instanceof CaptureHelperConfigError;
      const message = error instanceof Error ? error.message : "Unexpected capture helper transport error.";
      return sendJson(
        res,
        isBadRequest ? 400 : 500,
        errorResponse(isBadRequest ? 400 : 500, isBadRequest ? "BAD_REQUEST" : "INTERNAL_ERROR", message)
      );
    }
  });

  return server;
}

export async function startCaptureHelperHttpServer(
  input: CaptureHelperTransportConfigInput = {},
  env: CaptureHelperEnv = process.env
): Promise<StartedCaptureHelperTransport> {
  const config = buildCaptureHelperTransportConfig(input, env);
  const server = createCaptureHelperHttpServer(config, env);

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(config.port, config.host);
  });

  const address = server.address() as AddressInfo;
  return {
    server,
    host: config.host,
    port: address.port,
    url: `http://${hostForUrl(config.host)}:${address.port}`,
    config,
  };
}
