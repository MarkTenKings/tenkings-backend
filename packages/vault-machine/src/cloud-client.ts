import { SignedVaultConfigSchema, VaultEventBatchSchema, VaultHeartbeatSchema, VaultStaffGrantSchema, type SignedVaultConfig } from "../../vault-contracts/dist";
import { digest } from "./util";
import type { CloudEventSink } from "./events";
import type { OutboxBatchResult, OutboxEnvelope } from "./types";

export class VaultCloudError extends Error {
  constructor(public readonly code: string, public readonly status: number | null = null) {
    super(code); this.name = "VaultCloudError";
  }
}

export interface VaultCloudClientOptions {
  origin: string;
  machineId: string;
  credential: () => string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  /** Only a locally constructed deterministic test harness may use plain HTTP. */
  allowInsecureLoopback?: boolean;
}

/** One bounded authenticated transport; no redirects, fallback hosts or automatic POST replay. */
export class VaultCloudClient implements CloudEventSink {
  readonly machineId: string;
  private readonly origin: string;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: VaultCloudClientOptions) {
    const url = new URL(options.origin);
    const loopback = ["127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(options.allowInsecureLoopback && loopback && url.protocol === "http:")) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new VaultCloudError("CLOUD_ORIGIN_INVALID");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(options.machineId)) throw new VaultCloudError("CLOUD_MACHINE_ID_INVALID");
    this.machineId = options.machineId; this.origin = url.origin;
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 30_000) throw new VaultCloudError("CLOUD_TIMEOUT_INVALID");
  }

  private path(action: string): string { return `/api/vault/v1/machines/${this.machineId}/${action}`; }

  async config(knownDigest?: string): Promise<{ config: SignedVaultConfig | null; unchanged: boolean }> {
    const result = await this.request(this.path("config"), "GET", undefined, knownDigest ? { "If-None-Match": `"${knownDigest}"` } : {}, [304, 404]);
    if (result.status === 404) return { config: null, unchanged: false };
    if (result.status === 304) {
      if (!knownDigest) throw new VaultCloudError("CLOUD_CONFIG_CACHE_INVALID");
      return { config: null, unchanged: true };
    }
    const config = SignedVaultConfigSchema.parse(result.body.config);
    if (config.payload.machineId !== this.machineId) throw new VaultCloudError("CLOUD_CONFIG_MACHINE_MISMATCH");
    return { config, unchanged: false };
  }

  async staffGrants(afterGrantVersion: number) {
    const { body } = await this.request(this.path(`staff-grants:pull?afterGrantVersion=${afterGrantVersion}`), "GET");
    if (!Array.isArray(body.grants) || body.grants.length > 500 || !Number.isSafeInteger(body.latestGrantVersion) || typeof body.hasMore !== "boolean") throw new VaultCloudError("CLOUD_GRANTS_INVALID");
    const grants = body.grants.map((input: unknown) => VaultStaffGrantSchema.parse(input));
    let previous = afterGrantVersion;
    for (const grant of grants) {
      if (grant.machineId !== this.machineId || !grant.grantVersion || grant.grantVersion <= previous) throw new VaultCloudError("CLOUD_GRANT_ORDER_INVALID");
      previous = grant.grantVersion;
    }
    if (body.latestGrantVersion !== previous || (body.hasMore && grants.length === 0)) throw new VaultCloudError("CLOUD_GRANT_CURSOR_INVALID");
    return { grants, latestGrantVersion: previous, hasMore: body.hasMore as boolean };
  }

  async heartbeat(input: unknown): Promise<Date> {
    const { body } = await this.request(this.path("heartbeat"), "POST", VaultHeartbeatSchema.parse(input));
    if (body.accepted !== true || body.machine?.id !== this.machineId || typeof body.serverObservedAt !== "string" || !Number.isFinite(Date.parse(body.serverObservedAt))) throw new VaultCloudError("CLOUD_HEARTBEAT_INVALID");
    return new Date(body.serverObservedAt);
  }

  async send(events: OutboxEnvelope[]): Promise<OutboxBatchResult> {
    for (const event of events) if (event.payload.machineId !== this.machineId || digest(event.payload) !== event.digest) throw new VaultCloudError("LOCAL_EVENT_DIGEST_INVALID");
    const input = VaultEventBatchSchema.parse({ contractVersion: 1, events: events.map((event) => event.payload) });
    const { body } = await this.request(this.path("events:batch"), "POST", input);
    if (!Array.isArray(body.acknowledgedEventIds) || body.acknowledgedEventIds.some((id: unknown) => typeof id !== "string") || !Array.isArray(body.rejected) || body.rejected.some((item: any) => typeof item?.eventId !== "string" || typeof item?.code !== "string" || !/^[A-Z0-9_]{1,120}$/.test(item.code))) throw new VaultCloudError("CLOUD_EVENT_ACK_INVALID");
    return { acknowledgedEventIds: body.acknowledgedEventIds, rejected: body.rejected.map((item: {eventId: string; code: string}) => ({ eventId: item.eventId, code: item.code })) };
  }

  /** Explicit one-time installation exchange. Caller owns protected credential storage.
   * An uncertain response must go to Admin recovery; never repeat automatically. */
  async completeEnrollment(enrollmentToken: string): Promise<{ credential: string; version: number; credentialId: string }> {
    if (enrollmentToken.length < 32 || enrollmentToken.length > 512) throw new VaultCloudError("ENROLLMENT_TOKEN_INVALID");
    const { body } = await this.request("/api/vault/v1/machines/enroll/complete", "POST", { contractVersion: 1, machineId: this.machineId, enrollmentToken }, {}, [], false);
    if (body.machineId !== this.machineId || typeof body.credential !== "string" || !/^vault_[A-Za-z0-9_-]{43}$/.test(body.credential) || !Number.isSafeInteger(body.version) || body.version < 1 || typeof body.credentialId !== "string" || body.credentialReturnedOnce !== true) throw new VaultCloudError("ENROLLMENT_RESPONSE_INVALID");
    return { credential: body.credential, version: body.version, credentialId: body.credentialId };
  }

  private async request(path: string, method: "GET" | "POST", body?: unknown, extraHeaders: Record<string, string> = {}, allowed: number[] = [], authenticate = true): Promise<{status: number; body: any}> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const credential = authenticate ? this.options.credential() : "";
      if (authenticate && (!credential || /\s/.test(credential))) throw new VaultCloudError("MACHINE_CREDENTIAL_UNAVAILABLE");
      const response = await this.fetcher(`${this.origin}${path}`, {
        method, redirect: "error", signal: controller.signal,
        headers: { "X-Vault-Contract-Version": "1", "Accept": "application/json", ...(authenticate ? { Authorization: `VaultMachine ${credential}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...extraHeaders },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (allowed.includes(response.status)) { await response.body?.cancel(); return { status: response.status, body: null }; }
      if (!response.ok) { await response.body?.cancel(); throw new VaultCloudError(response.status === 401 || response.status === 403 ? "CLOUD_AUTH_REJECTED" : response.status === 426 ? "CLOUD_CONTRACT_REJECTED" : "CLOUD_REQUEST_REJECTED", response.status); }
      if (response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") throw new VaultCloudError("CLOUD_CONTENT_TYPE_INVALID");
      const maximum = 8 * 1024 * 1024;
      if (Number(response.headers.get("content-length")) > maximum) { await response.body?.cancel(); throw new VaultCloudError("CLOUD_RESPONSE_TOO_LARGE"); }
      const reader = response.body?.getReader(); if (!reader) throw new VaultCloudError("CLOUD_RESPONSE_EMPTY");
      const chunks: Uint8Array[] = []; let size = 0;
      for (;;) {
        const part = await reader.read(); if (part.done) break;
        size += part.value.byteLength;
        if (size > maximum) { await reader.cancel(); throw new VaultCloudError("CLOUD_RESPONSE_TOO_LARGE"); }
        chunks.push(part.value);
      }
      const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new VaultCloudError("CLOUD_RESPONSE_INVALID");
      return { status: response.status, body: parsed };
    } catch (error) {
      if (error instanceof VaultCloudError) throw error;
      // Network/provider exceptions can contain URLs, headers and credentials.
      throw new VaultCloudError(controller.signal.aborted ? "CLOUD_TIMEOUT" : "CLOUD_RESPONSE_INVALID");
    } finally { clearTimeout(timeout); }
  }
}
