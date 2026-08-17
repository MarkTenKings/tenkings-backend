import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { extname, join, normalize, resolve } from "node:path";
import { isLoopbackAddress, VaultDoorIdSchema } from "../../vault-contracts/dist";
import { VaultMachine } from "./machine";
import { VaultOperationsService } from "./operations";
import { RedactedJsonLogger } from "./logger";
import { constantTimeEqual, digest, iso, secureToken } from "./util";
import { VaultError, type Clock } from "./types";

const CONTRACT_HEADER = "1";
const MUTATION_LIMIT = 32 * 1024;
const CALLBACK_LIMIT = 64 * 1024;
const COOKIE_NAME = "tk_vault_kiosk";

export interface HttpServiceOptions {
  origin: string;
  host?: "127.0.0.1" | "::1";
  port?: number;
  staticRoot?: string;
  adapterCallbackToken: string;
  kioskSessionTtlMs?: number;
  logger?: RedactedJsonLogger;
  clock: Clock;
}

export class VaultHttpService {
  readonly server: Server;
  private readonly clients = new Set<Duplex>();
  private readonly logger: RedactedJsonLogger;

  constructor(private readonly machine: VaultMachine, private readonly operations: VaultOperationsService, private readonly options: HttpServiceOptions) {
    if (!(["127.0.0.1", "::1"] as const).includes(options.host ?? "127.0.0.1")) throw new VaultError("LOOPBACK_BIND_REQUIRED", "Vault HTTP service may bind only to loopback", 500);
    this.logger = options.logger ?? new RedactedJsonLogger();
    this.server = createServer((request, response) => void this.route(request, response));
    this.server.on("upgrade", (request, socket) => void this.upgrade(request, socket));
  }

  async listen(): Promise<{ host: string; port: number }> {
    const host = this.options.host ?? "127.0.0.1"; const port = this.options.port ?? 0;
    await new Promise<void>((resolveListen, reject) => { this.server.once("error", reject); this.server.listen(port, host, () => { this.server.off("error", reject); resolveListen(); }); });
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("Unexpected HTTP listen address");
    return { host, port: address.port };
  }

  async close(): Promise<void> {
    for (const client of this.clients) client.destroy();
    await new Promise<void>((resolveClose, reject) => this.server.close((error) => error ? reject(error) : resolveClose()));
  }

  async broadcastState(): Promise<void> {
    if (!this.clients.size) return;
    const payload = wsFrame(JSON.stringify({ type: "PUBLIC_STATE", data: await this.machine.publicState() }));
    for (const socket of this.clients) { if (!socket.destroyed) socket.write(payload); }
  }

  private async route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const requestId = randomUUID(); this.securityHeaders(response);
    try {
      if (!isLoopbackAddress(request.socket.remoteAddress)) throw new VaultError("LOOPBACK_CLIENT_REQUIRED", "Only loopback clients are accepted", 403);
      const url = new URL(request.url ?? "/", this.options.origin);
      if (url.pathname.startsWith("/api/")) {
        if (request.headers["x-vault-contract-version"] !== CONTRACT_HEADER) throw new VaultError("CONTRACT_VERSION_UNSUPPORTED", "X-Vault-Contract-Version must be 1", 426);
        if (request.method === "POST") this.requireOrigin(request);
      }

      if (request.method === "POST" && url.pathname === "/api/v1/session/bootstrap") {
        this.requireOrigin(request); await this.readJson(request, 1024);
        const token = secureToken(); const now = this.options.clock.now(); const expiresAt = new Date(now.getTime() + (this.options.kioskSessionTtlMs ?? 15 * 60_000)); const hash = createHash("sha256").update(token).digest("hex");
        this.machine.store.transaction(() => {
          this.machine.store.run(`DELETE FROM kiosk_session WHERE expires_at<=?`, iso(now));
          this.machine.store.run(`INSERT INTO kiosk_session(session_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?)`, hash, iso(now), iso(expiresAt), iso(now));
        });
        response.setHeader("Set-Cookie", `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor((expiresAt.getTime() - now.getTime()) / 1000)}`);
        return this.success(response, requestId, { expiresAt: iso(expiresAt) });
      }

      if (request.method === "GET" && url.pathname === "/api/v1/health") {
        this.requireKioskSession(request);
        const readiness = await this.machine.readiness(); const controller = await this.machine.controller.identity(); const payment = await this.machine.payment.capabilities(); const integrity = this.machine.store.integrityCheck();
        const buildIdentity = this.machine.store.one(`SELECT source_commit,app_version,schema_version,active_config_version FROM machine_meta WHERE singleton=1`);
        return this.success(response, requestId, { readiness, controller, payment, integrity, pragmas: this.machine.store.pragmaSnapshot(), serviceLock: this.machine.store.one(`SELECT service_locked,automation_halted,recovery_required FROM machine_meta WHERE singleton=1`), buildIdentity: { sourceCommit: buildIdentity.source_commit, appVersion: buildIdentity.app_version }, appVersion: buildIdentity.app_version, localSchemaVersion: buildIdentity.schema_version, configVersion: buildIdentity.active_config_version, outboxPendingCount: Number(this.machine.store.one(`SELECT COUNT(*) AS count FROM outbox WHERE acknowledged_at IS NULL`).count) });
      }
      if (request.method === "GET" && url.pathname === "/api/v1/state") { this.requireKioskSession(request); return this.success(response, requestId, await this.machine.publicState()); }

      if (request.method === "POST" && url.pathname === "/api/v1/internal/provider-callback") {
        const token = String(request.headers["x-vault-adapter-token"] ?? "");
        if (!token || !constantTimeEqual(token, this.options.adapterCallbackToken)) throw new VaultError("ADAPTER_AUTH_FAILED", "Adapter callback authentication failed", 401);
        const result = await this.machine.handleProviderCallback(await this.readJson(request, CALLBACK_LIMIT)); await this.broadcastState(); return this.success(response, requestId, result);
      }

      if (request.method === "POST" && url.pathname === "/api/v1/staff/authenticate") {
        this.requireKioskSession(request); this.requireIfMatch(request); const body = await this.readJson(request, MUTATION_LIMIT) as any;
        const result = this.machine.staff.authenticate(String(body.userId ?? ""), String(body.pin ?? "")); await this.broadcastState(); return this.success(response, requestId, result);
      }

      if (this.options.staticRoot && request.method === "GET" && !url.pathname.startsWith("/api/")) return this.static(response, url.pathname);

      this.requireKioskSession(request);
      if (request.method === "POST") this.requireIfMatch(request);
      if (request.method === "POST" && url.pathname === "/api/v1/session/activity") {
        await this.readJson(request, 1024); this.machine.recordPublicActivity(); await this.broadcastState(); return this.success(response, requestId, await this.machine.publicState());
      }
      if (request.method === "POST" && url.pathname === "/api/v1/cart/select") {
        const body = await this.readJson(request, MUTATION_LIMIT) as any; const result = this.machine.selectCartDoor(VaultDoorIdSchema.parse(body.doorId), String(body.productId), Boolean(body.selected)); await this.broadcastState(); return this.success(response, requestId, { ...(await this.machine.publicState()), mutation: result });
      }
      if (request.method === "POST" && url.pathname === "/api/v1/cart/pick") {
        const body = await this.readJson(request, MUTATION_LIMIT) as any; const result = this.machine.pickForMe(String(body.productId)); await this.broadcastState(); return this.success(response, requestId, { ...(await this.machine.publicState()), mutation: result });
      }
      if (request.method === "POST" && url.pathname === "/api/v1/checkout") {
        const result = await this.machine.checkout(await this.readJson(request, MUTATION_LIMIT)); await this.broadcastState(); return this.success(response, requestId, { ...(await this.machine.publicState()), mutation: result });
      }
      let match = url.pathname.match(/^\/api\/v1\/sales\/([^/]+)\/payment$/);
      if (request.method === "POST" && match) {
        const body = await this.readJson(request, MUTATION_LIMIT) as any; const result = await this.machine.startPayment(match[1]!, String(body.idempotencyKey ?? "")); await this.broadcastState(); return this.success(response, requestId, { ...(await this.machine.publicState()), mutation: result });
      }
      match = url.pathname.match(/^\/api\/v1\/sales\/([^/]+)\/open-doors$/);
      if (request.method === "POST" && match) {
        const body = await this.readJson(request, MUTATION_LIMIT) as any; const result = await this.machine.openPaidDoorsAgain(match[1]!, String(body.idempotencyKey ?? "")); await this.broadcastState(); return this.success(response, requestId, { ...(await this.machine.publicState()), mutation: result });
      }
      match = url.pathname.match(/^\/api\/v1\/sales\/([^/]+)\/done$/);
      if (request.method === "POST" && match) { await this.readJson(request, MUTATION_LIMIT); const result = this.machine.markPresentationDone(match[1]!); await this.broadcastState(); return this.success(response, requestId, { ...(await this.machine.publicState()), mutation: result }); }
      if (request.method === "POST" && url.pathname === "/api/v1/staff/lock") {
        const body = await this.readJson(request, MUTATION_LIMIT) as any; this.machine.staff.lock(String(body.staffSessionId ?? "")); await this.broadcastState(); return this.success(response, requestId, { locked: true });
      }
      if (request.method === "POST" && url.pathname === "/api/v1/staff/safe-exit") {
        const body = await this.readJson(request, MUTATION_LIMIT) as any; this.machine.staff.safeExit(String(body.staffSessionId ?? ""), body.servicedDoorsClosed === true); await this.broadcastState(); return this.success(response, requestId, { exited: true });
      }
      if (request.method === "POST" && url.pathname === "/api/v1/restocks") {
        const body = await this.readJson(request, MUTATION_LIMIT) as any; const result = await this.operations.startOrResumeRestock(String(body.staffSessionId ?? ""), Array.isArray(body.doorIds) ? body.doorIds.map((id: unknown) => VaultDoorIdSchema.parse(id)) : undefined); await this.broadcastState(); return this.success(response, requestId, result);
      }
      match = url.pathname.match(/^\/api\/v1\/restocks\/([^/]+)\/items\/([^/]+)$/);
      if (request.method === "POST" && match) {
        const body = await this.readJson(request, MUTATION_LIMIT) as any; this.operations.recordRestockOutcome(String(body.staffSessionId ?? ""), match[1]!, VaultDoorIdSchema.parse(match[2]!), body.outcome, String(body.notes ?? "")); await this.broadcastState(); return this.success(response, requestId, { recorded: true });
      }
      match = url.pathname.match(/^\/api\/v1\/restocks\/([^/]+)\/finalize$/);
      if (request.method === "POST" && match) {
        const body = await this.readJson(request, MUTATION_LIMIT) as any; const result = this.operations.finalizeRestock(String(body.staffSessionId ?? ""), match[1]!, body.servicedDoorsClosed === true); await this.broadcastState(); return this.success(response, requestId, result);
      }
      if (request.method === "POST" && url.pathname === "/api/v1/certification/sessions") {
        const body = await this.readJson(request, MUTATION_LIMIT) as any; const result = await this.operations.startCertification(String(body.staffSessionId ?? "")); await this.broadcastState(); return this.success(response, requestId, result);
      }
      match = url.pathname.match(/^\/api\/v1\/certification\/sessions\/([^/]+)\/evidence$/);
      if (request.method === "POST" && match) {
        const body = await this.readJson(request, MUTATION_LIMIT) as any; const evidence = { ...body.evidence, sessionId: match[1] }; const result = this.operations.recordCertificationEvidence(String(body.staffSessionId ?? ""), evidence); await this.broadcastState(); return this.success(response, requestId, result);
      }
      match = url.pathname.match(/^\/api\/v1\/certification\/sessions\/([^/]+)\/submit$/);
      if (request.method === "POST" && match) {
        const body = await this.readJson(request, MUTATION_LIMIT) as any; this.operations.submitCertification(String(body.staffSessionId ?? ""), match[1]!, body.servicedDoorsClosed === true); await this.broadcastState(); return this.success(response, requestId, { submitted: true });
      }
      throw new VaultError("ROUTE_NOT_FOUND", "Route was not found", 404);
    } catch (error) {
      const vaultError = error instanceof VaultError ? error : new VaultError("REQUEST_INVALID", error instanceof Error ? error.message : "Request failed", 400);
      this.logger.log(vaultError.status >= 500 ? "ERROR" : "WARN", "HTTP_REQUEST_FAILED", { requestId, method: request.method, path: String(request.url ?? "").split("?", 1)[0], code: vaultError.code });
      response.statusCode = vaultError.status; response.setHeader("Content-Type", "application/json; charset=utf-8"); response.end(JSON.stringify({ requestId, error: { code: vaultError.code, message: vaultError.message } }));
    }
  }

  private async upgrade(request: IncomingMessage, socket: Duplex): Promise<void> {
    try {
      if (!isLoopbackAddress(request.socket.remoteAddress)) throw new Error("loopback");
      const url = new URL(request.url ?? "/", this.options.origin);
      const protocols = String(request.headers["sec-websocket-protocol"] ?? "").split(",").map((value) => value.trim());
      if (url.pathname !== "/api/v1/events" || request.headers.origin !== this.options.origin || !protocols.includes("vault-contract-v1")) throw new Error("boundary");
      this.requireKioskSession(request);
      const key = String(request.headers["sec-websocket-key"] ?? "");
      if (!/^[A-Za-z0-9+/]{22}==$/.test(key)) throw new Error("key");
      const accept = createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nSec-WebSocket-Protocol: vault-contract-v1\r\n\r\n`);
      this.clients.add(socket); socket.on("close", () => this.clients.delete(socket)); socket.on("error", () => this.clients.delete(socket));
      // This channel is intentionally output-only. Any client data closes it before it can become a command surface.
      socket.on("data", () => socket.end(wsCloseFrame(1008, "output-only")));
      socket.write(wsFrame(JSON.stringify({ type: "PUBLIC_STATE", data: await this.machine.publicState() })));
    } catch { socket.destroy(); }
  }

  private requireOrigin(request: IncomingMessage): void {
    if (request.headers.origin !== this.options.origin) throw new VaultError("ORIGIN_REJECTED", "Request Origin is not the assigned kiosk origin", 403);
  }

  private requireKioskSession(request: IncomingMessage): void {
    const cookie = String(request.headers.cookie ?? "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`));
    const token = cookie?.slice(COOKIE_NAME.length + 1); if (!token) throw new VaultError("KIOSK_SESSION_REQUIRED", "Kiosk session is required", 401);
    const hash = createHash("sha256").update(token).digest("hex"); const now = iso(this.options.clock.now());
    const row = this.machine.store.maybeOne(`SELECT expires_at FROM kiosk_session WHERE session_hash=? AND expires_at>?`, hash, now);
    if (!row) throw new VaultError("KIOSK_SESSION_INVALID", "Kiosk session is invalid or expired", 401);
    this.machine.store.run(`UPDATE kiosk_session SET last_seen_at=? WHERE session_hash=?`, now, hash);
  }

  private requireIfMatch(request: IncomingMessage): void {
    const value = String(request.headers["if-match"] ?? ""); if (!/^"?\d+"?$/.test(value)) throw new VaultError("IF_MATCH_REQUIRED", "Mutation requires current state version in If-Match", 428);
    const supplied = Number(value.replaceAll('"', "")); const current = Number(this.machine.store.one(`SELECT public_state_version FROM machine_meta WHERE singleton=1`).public_state_version);
    if (supplied !== current) throw new VaultError("STATE_VERSION_CONFLICT", "State changed; refresh before retrying", 412);
  }

  private async readJson(request: IncomingMessage, limit: number): Promise<unknown> {
    const contentType = String(request.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
    if (contentType !== "application/json") throw new VaultError("CONTENT_TYPE_UNSUPPORTED", "Content-Type must be application/json", 415);
    const declared = Number(request.headers["content-length"] ?? 0); if (declared > limit) throw new VaultError("BODY_TOO_LARGE", "Request body exceeds route limit", 413);
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of request) { const buffer = Buffer.from(chunk); size += buffer.length; if (size > limit) throw new VaultError("BODY_TOO_LARGE", "Request body exceeds route limit", 413); chunks.push(buffer); }
    const text = Buffer.concat(chunks).toString("utf8");
    try { return JSON.parse(text || "{}"); } catch { throw new VaultError("JSON_INVALID", "Request body is not valid JSON", 400); }
  }

  private success(response: ServerResponse, requestId: string, data: unknown): void { response.statusCode = 200; response.setHeader("Content-Type", "application/json; charset=utf-8"); response.end(JSON.stringify({ requestId, data })); }
  private securityHeaders(response: ServerResponse): void {
    response.setHeader("Cache-Control", "no-store"); response.setHeader("X-Content-Type-Options", "nosniff"); response.setHeader("X-Frame-Options", "DENY"); response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  }

  private static(response: ServerResponse, pathname: string): void {
    const root = resolve(this.options.staticRoot!); const requested = pathname === "/" ? "index.html" : normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, ""); const path = resolve(join(root, requested));
    if (!path.startsWith(root + require("node:path").sep) && path !== root) throw new VaultError("STATIC_PATH_REJECTED", "Static path escapes kiosk root", 403);
    const fallback = resolve(join(root, "index.html")); const selected = existsSync(path) && statSync(path).isFile() ? path : fallback;
    if (!existsSync(selected)) throw new VaultError("STATIC_NOT_FOUND", "Kiosk build was not found", 404);
    const mime: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg" };
    response.statusCode = 200; response.setHeader("Content-Type", mime[extname(selected)] ?? "application/octet-stream"); createReadStream(selected).pipe(response);
  }
}

function wsFrame(text: string): Buffer {
  const payload = Buffer.from(text); let header: Buffer;
  if (payload.length < 126) header = Buffer.from([0x81, payload.length]);
  else if (payload.length <= 65_535) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(payload.length, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(payload.length), 2); }
  return Buffer.concat([header, payload]);
}
function wsCloseFrame(code: number, reason: string): Buffer { const payload = Buffer.alloc(2 + Buffer.byteLength(reason)); payload.writeUInt16BE(code); payload.write(reason, 2); return Buffer.concat([Buffer.from([0x88, payload.length]), payload]); }
