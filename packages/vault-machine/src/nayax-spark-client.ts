import { createCipheriv, createHash, randomInt, timingSafeEqual } from "node:crypto";
import { PaymentNoEffectError, VaultError } from "./types";
export const SPARK_GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type SparkSigningProfile = "MANUAL_BODY_SHA256" | "CURRENT_GUID_SHA256";
export interface NayaxSparkClientOptions {
    apiBase: string;
    integratorId: string;
    tokenId: number;
    tokenSecret: string;
    signKey: string;
    environment: "SANDBOX" | "PRODUCTION";
    sandboxConfirmed: boolean;
    productionConfirmed?: boolean;
    credentialGeneration?: string;
    /** Trusted runtime authority, revalidated immediately before each provider effect. */
    beforeEffect?: () => void;
    preSelectionConfirmed: true;
    signingProfile: SparkSigningProfile;
    wireApiVersion: string | null;
    vendorApprovalReference: string;
    fetchImpl?: typeof fetch;
}
/** Void-typed callbacks may accidentally be async in TypeScript; never race authority. */
export function runSparkEffectGuard(guard: (() => void) | undefined): void {
    const result: unknown = guard?.();
    if (result !== undefined) {
        if (result instanceof Promise) void result.catch(() => {});
        throw new PaymentNoEffectError("SPARK_EFFECT_AUTHORITY_NOT_SYNCHRONOUS", "Spark effect authority must complete synchronously", 503);
    }
}
export interface SparkStatus {
    verdict: "Approved" | "Declined";
    errorCode: number | null;
}
export function sparkTransactionSignature(id: string, key: string): string { return createHash("sha256").update(`${id};${key}`, "utf8").digest("hex"); }
/** Hash the exact serialized UTF-8 text sent on the wire; preserve string spaces. */
export function sparkBodySignature(body: string, key: string): string { return createHash("sha256").update(`${body};${key}`, "utf8").digest("hex"); }
export function sparkAuthenticationCipher(id: string, token: string, random: string, now = new Date()): string {
    const key = Buffer.from(token.slice(-32), "utf8");
    if (!SPARK_GUID.test(id) || !/^[A-Za-z0-9]{17}$/.test(random) || key.length !== 32 || !Number.isFinite(now.getTime()))
        throw protocolError("CIPHER_INPUT_INVALID");
    const timestamp = now.toISOString().slice(2, 16).replace(/[-T:]/g, "");
    const cipher = createCipheriv("aes-256-ecb", key, null);
    return Buffer.concat([cipher.update(`${id}=${random}${timestamp}`, "utf8"), cipher.final()]).toString("base64");
}
/** Provider integer identifiers must never pass through Number. */
export function serializeSpark(value: unknown): string {
    if (typeof value === "bigint") {
        if (value < 1n || value > 9223372036854775807n)
            throw protocolError("PROVIDER_ID_INVALID");
        return value.toString();
    }
    if (Array.isArray(value))
        return `[${value.map(serializeSpark).join(",")}]`;
    if (value && typeof value === "object")
        return `{${Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}:${serializeSpark(v)}`).join(",")}}`;
    const encoded = JSON.stringify(value);
    if (encoded === undefined || typeof value === "number" && !Number.isFinite(value))
        throw protocolError("BODY_INVALID");
    return encoded;
}
export function sparkTriggerBody(id: string, terminalId: string, type: 1 | 2, cents: number, posDisplay: string): string {
    return serializeSpark({ SparkTransactionId: id, TerminalId: terminalId, TerminalIdType: type, Amount: cents / 100, PosDisplay: posDisplay, TransactionTimeout: 60 });
}
export function sparkVoidBody(i: {
    sparkId: string;
    nayaxId: string;
    siteId: number;
    machineAuTime: string;
    terminalId: string;
    terminalIdType: 1 | 2;
    cents: number;
    reason: string;
}): string {
    return serializeSpark({ NayaxTransactionId: BigInt(i.nayaxId), SparkTransactionId: i.sparkId, SiteId: i.siteId, MachineAuTime: i.machineAuTime,
        TerminalId: i.terminalId, TerminalIdType: i.terminalIdType, CancellationType: 2, CancelAmount: i.cents / 100, ReasonText: i.reason });
}
/** The PDF revision is not a wire version. Never select a signing fallback after an error. */
export class NayaxSparkClient {
    readonly apiBase: string;
    private readonly fetcher: typeof fetch;
    constructor(private readonly options: NayaxSparkClientOptions) {
        this.options = Object.freeze({ ...options });
        let url: URL;
        try {
            url = new URL(options.apiBase);
        }
        catch {
            throw protocolError("SANDBOX_CONFIG_INVALID");
        }
        if (!(options.environment === "SANDBOX" && options.sandboxConfirmed === true && options.productionConfirmed !== true && options.credentialGeneration == null
            || options.environment === "PRODUCTION" && options.sandboxConfirmed === false && options.productionConfirmed === true && SPARK_GUID.test(options.credentialGeneration ?? "") && typeof options.beforeEffect === "function") || options.preSelectionConfirmed !== true
            || !["MANUAL_BODY_SHA256", "CURRENT_GUID_SHA256"].includes(options.signingProfile)
            || !(options.wireApiVersion === null || typeof options.wireApiVersion === "string" && /^[A-Za-z0-9._-]{1,40}$/.test(options.wireApiVersion))
            || typeof options.vendorApprovalReference !== "string" || !/^[\x20-\x7e]{8,200}$/.test(options.vendorApprovalReference)
            || url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/api"
            || (!options.fetchImpl && (!url.hostname.endsWith(".nayax.com") || url.port))
            || !/^[1-9][0-9]{0,9}$/.test(options.integratorId) || !Number.isSafeInteger(options.tokenId) || options.tokenId <= 0 || options.tokenId > 2147483647
            || typeof options.tokenSecret !== "string" || options.tokenSecret.length < 32 || options.tokenSecret.length > 512
            || Buffer.byteLength(options.tokenSecret.slice(-32), "utf8") !== 32 || /[\r\n]/.test(options.tokenSecret)
            || typeof options.signKey !== "string" || options.signKey.length < 16 || options.signKey.length > 512 || /[\r\n]/.test(options.signKey))
            throw protocolError("SANDBOX_CONFIG_INVALID");
        this.apiBase = url.href;
        this.fetcher = options.fetchImpl ?? fetch;
    }
    async authenticate(id: string, terminalId: string, type: 1 | 2, now = new Date()): Promise<SparkStatus> {
        const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
        const random = Array.from({ length: 17 }, () => alphabet[randomInt(alphabet.length)]!).join("");
        const body: Record<string, unknown> = { TokenId: this.options.tokenId, TerminalId: terminalId, TerminalIdType: type, Random: random,
            Cipher: sparkAuthenticationCipher(id, this.options.tokenSecret, random, now) };
        if (this.options.signingProfile === "CURRENT_GUID_SHA256")
            body.SparkTransactionId = id;
        const result = await this.post("StartAuthentication", id, serializeSpark(body));
        const status = this.status(result);
        if (status.verdict === "Declined")
            return status;
        const expected = createHash("sha256").update(id, "utf8").digest("hex");
        const received = result.HashedSparkTransactionId;
        if (typeof received !== "string" || !/^[a-f0-9]{64}$/i.test(received) || !timingSafeEqual(Buffer.from(received.toLowerCase()), Buffer.from(expected)))
            throw protocolError("AUTHENTICATION_RESPONSE_INVALID");
        return status;
    }
    async trigger(id: string, body: string): Promise<SparkStatus> { return this.boundStatus(await this.post("TriggerTransaction", id, body), id); }
    async void(id: string, body: string): Promise<SparkStatus> { return this.boundStatus(await this.post("CancelTransaction", id, body), id); }
    private boundStatus(result: Record<string, unknown>, id: string): SparkStatus {
        if (result.SparkTransactionId !== id)
            throw protocolError("RESPONSE_BINDING_INVALID");
        return this.status(result);
    }
    private status(result: Record<string, unknown>): SparkStatus {
        const status = result.Status as {
            Verdict?: unknown;
            ErrorCode?: unknown;
        } | undefined;
        if (!status || !["Approved", "Declined"].includes(String(status.Verdict))
            || status.ErrorCode != null && (!Number.isSafeInteger(status.ErrorCode) || Math.abs(Number(status.ErrorCode)) > 2147483647)
            || status.Verdict === "Approved" && status.ErrorCode != null && status.ErrorCode !== 0)
            throw protocolError("STATUS_INVALID");
        return { verdict: status.Verdict as SparkStatus["verdict"], errorCode: status.ErrorCode == null ? null : Number(status.ErrorCode) };
    }
    private async post(method: "StartAuthentication" | "TriggerTransaction" | "CancelTransaction", id: string, body: string): Promise<Record<string, unknown>> {
        if (!SPARK_GUID.test(id))
            throw protocolError("SESSION_ID_INVALID");
        const signature: Record<string, string> = this.options.signingProfile === "MANUAL_BODY_SHA256"
            ? { Signature: sparkBodySignature(body, this.options.signKey) } : { TransactionSignature: sparkTransactionSignature(id, this.options.signKey) };
        // Outside the transport catch: a denied authority is a known no-effect stop.
        runSparkEffectGuard(this.options.beforeEffect);
        try {
            const response = await this.fetcher(`${this.apiBase}/${method}`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(60000),
                headers: { "Content-Type": "application/json", Accept: "application/json", IntegratorId: this.options.integratorId, ...signature }, body });
            if (!response.ok) {
                await response.body?.cancel();
                throw new Error("unconfirmed");
            }
            const reader = response.body?.getReader();
            if (!reader)
                throw new Error("empty");
            const chunks: Uint8Array[] = [];
            let size = 0;
            for (;;) {
                const part = await reader.read();
                if (part.done)
                    break;
                size += part.value.length;
                if (size > 64 * 1024) {
                    await reader.cancel();
                    throw new Error("oversized");
                }
                chunks.push(part.value);
            }
            const parsed: unknown = parseSparkResponse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
                throw new Error("malformed");
            return parsed as Record<string, unknown>;
        }
        catch {
            throw protocolError("API_OUTCOME_UNKNOWN");
        }
    }
}
function protocolError(code: string): VaultError { return new VaultError(`SPARK_${code}`, "Spark did not confirm the configured operation", 503); }

/** Reject duplicate keys and excessive nesting. Unconsumed large numeric IDs stay exact strings. */
function parseSparkResponse(source: string): unknown {
  let position = 0;
  const fail = (): never => { throw new Error("Invalid Spark JSON"); };
  const whitespace = () => { while (/[\t\n\r ]/.test(source[position] ?? "x")) position++; };
  const string = (): string => {
    const start = position++;
    while (position < source.length) {
      const character = source[position++];
      if (character === "\\") position++;
      else if (character === '"') return JSON.parse(source.slice(start, position));
    }
    return fail();
  };
  const value = (depth: number): unknown => {
    if (depth > 16) return fail();
    whitespace();
    const character = source[position];
    if (character === '"') return string();
    if (character === "{" || character === "[") {
      position++; whitespace();
      const map = Object.create(null) as Record<string, unknown>, list: unknown[] = [];
      const end = character === "{" ? "}" : "]";
      if (source[position] === end) { position++; return character === "{" ? map : list; }
      for (;;) {
        if (character === "{") {
          if (source[position] !== '"') return fail();
          const key = string(); whitespace();
          if (Object.hasOwn(map, key) || source[position++] !== ":") return fail();
          map[key] = value(depth + 1);
        } else list.push(value(depth + 1));
        whitespace();
        const delimiter = source[position++];
        if (delimiter === end) return character === "{" ? map : list;
        if (delimiter !== ",") return fail();
        whitespace();
      }
    }
    for (const [literal, result] of [["true", true], ["false", false], ["null", null]] as const) {
      if (source.startsWith(literal, position)) { position += literal.length; return result; }
    }
    const token = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(source.slice(position))?.[0];
    if (!token) return fail();
    position += token.length;
    return /^-?(0|[1-9][0-9]*)$/.test(token) && Number.isSafeInteger(Number(token)) ? Number(token) : token;
  };
  const result = value(0); whitespace();
  if (position !== source.length) return fail();
  return result;
}

