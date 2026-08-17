import type {
  NayaxAdapter,
  NayaxCapabilities,
  NayaxSessionRequest,
  NayaxSessionResult,
  VaultPaymentState,
} from "../../vault-contracts/dist";
import { digest } from "./util";
import { VaultError } from "./types";

export type NayaxMockOutcome = "AUTHORIZE" | "DECLINE" | "CANCEL" | "TIMEOUT" | "UNKNOWN" | "SETTLE";
export interface NayaxMockStep { outcome: NayaxMockOutcome; providerTransactionId?: string }
interface MockSession { request: NayaxSessionRequest; digest: string; result: NayaxSessionResult; state: VaultPaymentState; transactionId?: string }
interface MockCancellation { providerSessionId: string; digest: string; result: NayaxSessionResult }
interface MockLimits { maxItems: number; maxTotalCents: number; cancellationBeforeAuthorization: boolean }

const REQUEST_KEYS = new Set(["idempotencyKey", "saleId", "mode", "currency", "totalCents", "items"]);
const ITEM_KEYS = new Set(["lineId", "name", "priceCents"]);
const MOCK_OUTCOMES = new Set<NayaxMockOutcome>(["AUTHORIZE", "DECLINE", "CANCEL", "TIMEOUT", "UNKNOWN", "SETTLE"]);
const MOCK_STATES = new Set<VaultPaymentState>(["AUTHORIZED", "DECLINED", "CANCELLED", "UNKNOWN", "SETTLED"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

/** Keep the mock on the normalized boundary and never retain provider/cardholder extensions. */
function normalizeRequest(input: NayaxSessionRequest): NayaxSessionRequest {
  const value = input as unknown;
  if (!isRecord(value) || !hasOnlyKeys(value, REQUEST_KEYS)
    || typeof value.idempotencyKey !== "string" || value.idempotencyKey.length < 1
    || typeof value.saleId !== "string" || value.saleId.length < 1
    || (value.mode !== "PRODUCTION" && value.mode !== "CERTIFICATION")
    || value.currency !== "USD"
    || !Number.isSafeInteger(value.totalCents) || Number(value.totalCents) < 0
    || !Array.isArray(value.items) || value.items.length < 1) {
    throw new VaultError("PAYMENT_REQUEST_INVALID", "Mock payment request did not match the normalized adapter contract", 400);
  }
  const items = value.items.map((item) => {
    if (!isRecord(item) || !hasOnlyKeys(item, ITEM_KEYS)
      || typeof item.lineId !== "string" || item.lineId.length < 1
      || typeof item.name !== "string" || item.name.length < 1
      || !Number.isSafeInteger(item.priceCents) || Number(item.priceCents) < 0) {
      throw new VaultError("PAYMENT_REQUEST_INVALID", "Mock payment request did not match the normalized adapter contract", 400);
    }
    return { lineId: item.lineId, name: item.name, priceCents: Number(item.priceCents) };
  });
  if (new Set(items.map((item) => item.lineId)).size !== items.length) {
    throw new VaultError("PAYMENT_REQUEST_INVALID", "Mock payment request did not match the normalized adapter contract", 400);
  }
  return {
    idempotencyKey: value.idempotencyKey,
    saleId: value.saleId,
    mode: value.mode,
    currency: "USD",
    totalCents: Number(value.totalCents),
    items,
  };
}

function cloneResult(result: NayaxSessionResult): NayaxSessionResult {
  return { ...result };
}

function normalizeStep(input: unknown): NayaxMockStep {
  if (!isRecord(input) || !hasOnlyKeys(input, new Set(["outcome", "providerTransactionId"]))
    || typeof input.outcome !== "string" || !MOCK_OUTCOMES.has(input.outcome as NayaxMockOutcome)
    || (input.providerTransactionId !== undefined && typeof input.providerTransactionId !== "string")) {
    throw new VaultError("MOCK_SCRIPT_INVALID", "Mock payment script step is invalid", 400);
  }
  return {
    outcome: input.outcome as NayaxMockOutcome,
    ...(input.providerTransactionId ? { providerTransactionId: input.providerTransactionId } : {}),
  };
}

function snapshotInvalid(): never {
  throw new VaultError("MOCK_SNAPSHOT_INVALID", "Mock payment snapshot is invalid", 400);
}

/** Deterministic, in-process implementation of the production NayaxAdapter boundary. It has no external effects. */
export class DeterministicNayaxMock implements NayaxAdapter {
  private readonly sessions = new Map<string, MockSession>();
  private readonly byKey = new Map<string, string>();
  private readonly cancellationsByKey = new Map<string, MockCancellation>();
  private startSteps: NayaxMockStep[] = [];
  private reconcileSteps: NayaxMockStep[] = [];
  private readonly limits: Readonly<MockLimits>;

  constructor(limits: MockLimits = { maxItems: 25, maxTotalCents: 500_000, cancellationBeforeAuthorization: true }) {
    if (!Number.isSafeInteger(limits.maxItems) || limits.maxItems < 1
      || !Number.isSafeInteger(limits.maxTotalCents) || limits.maxTotalCents < 1
      || typeof limits.cancellationBeforeAuthorization !== "boolean") {
      throw new VaultError("MOCK_LIMITS_INVALID", "Mock payment limits must be positive integers with an explicit cancellation capability", 400);
    }
    this.limits = Object.freeze({ ...limits });
  }

  scriptStart(...steps: NayaxMockStep[]): this {
    const normalized = steps.map(normalizeStep);
    if (normalized.some((step) => step.outcome === "SETTLE")) {
      throw new VaultError("MOCK_SCRIPT_INVALID", "Settlement cannot be scripted as a session-start result", 400);
    }
    this.startSteps.push(...normalized);
    return this;
  }
  scriptReconcile(...steps: NayaxMockStep[]): this { this.reconcileSteps.push(...steps.map(normalizeStep)); return this; }

  async capabilities(): Promise<NayaxCapabilities> {
    return {
      adapterName: "ten-kings-deterministic-nayax-mock", adapterVersion: "1.0.0", sdkVersion: null, mode: "MOCK",
      maxItems: this.limits.maxItems, maxTotalCents: this.limits.maxTotalCents, cancellationBeforeAuthorization: this.limits.cancellationBeforeAuthorization,
    };
  }

  async startSession(request: NayaxSessionRequest): Promise<NayaxSessionResult> {
    const normalized = normalizeRequest(request);
    if (normalized.items.length > this.limits.maxItems || normalized.totalCents > this.limits.maxTotalCents) throw new VaultError("PROVIDER_LIMIT_EXCEEDED", "Mock provider limits exceeded", 409);
    const requestDigest = digest(normalized);
    const existingId = this.byKey.get(normalized.idempotencyKey);
    if (existingId) {
      const existing = this.sessions.get(existingId)!;
      if (existing.digest !== requestDigest) throw new VaultError("PAYMENT_IDEMPOTENCY_CONFLICT", "Payment idempotency key was reused with different content", 409);
      return cloneResult(existing.result);
    }
    const providerSessionId = `mock_session_${normalized.saleId}`;
    if (this.sessions.has(providerSessionId)) {
      throw new VaultError("PAYMENT_SESSION_CONFLICT", "Mock sale already has a payment session under a different idempotency key", 409);
    }
    const step = this.startSteps.shift() ?? { outcome: "AUTHORIZE" as const };
    const state = outcomeState(step.outcome);
    const result = { providerSessionId, originalRequestDigest: requestDigest, state };
    this.sessions.set(providerSessionId, { request: normalized, digest: requestDigest, result, state, ...(step.providerTransactionId ? { transactionId: step.providerTransactionId } : {}) });
    this.byKey.set(normalized.idempotencyKey, providerSessionId);
    return cloneResult(result);
  }

  async cancelSession(providerSessionId: string, idempotencyKey: string): Promise<NayaxSessionResult> {
    if (!idempotencyKey) throw new VaultError("PAYMENT_REQUEST_INVALID", "Cancellation idempotency key is required", 400);
    const cancellationDigest = digest({ providerSessionId, idempotencyKey });
    const existingCancellation = this.cancellationsByKey.get(idempotencyKey);
    if (existingCancellation) {
      if (existingCancellation.digest !== cancellationDigest || existingCancellation.providerSessionId !== providerSessionId) {
        throw new VaultError("PAYMENT_IDEMPOTENCY_CONFLICT", "Cancellation idempotency key was reused with different content", 409);
      }
      return cloneResult(existingCancellation.result);
    }
    const session = this.sessions.get(providerSessionId);
    if (!session) throw new VaultError("PAYMENT_SESSION_NOT_FOUND", "Mock payment session was not found", 404);
    if (this.limits.cancellationBeforeAuthorization && session.state !== "AUTHORIZED" && session.state !== "SETTLED") {
      session.state = "CANCELLED";
      session.result = { providerSessionId, originalRequestDigest: session.digest, state: "CANCELLED" };
    }
    const result = cloneResult(session.result);
    this.cancellationsByKey.set(idempotencyKey, { providerSessionId, digest: cancellationDigest, result });
    return cloneResult(result);
  }

  async reconcile(providerSessionId: string): Promise<NayaxSessionResult> {
    const session = this.sessions.get(providerSessionId);
    if (!session) throw new VaultError("PAYMENT_SESSION_NOT_FOUND", "Mock payment session was not found", 404);
    const step = this.reconcileSteps.shift();
    if (step) {
      if (step.outcome === "SETTLE" && session.state !== "AUTHORIZED" && session.state !== "SETTLED") {
        throw new VaultError("MOCK_SCRIPT_INVALID", "Settlement requires a prior normalized authorization result", 409);
      }
      session.state = outcomeState(step.outcome);
      session.transactionId = step.providerTransactionId ?? session.transactionId;
      session.result = { providerSessionId, originalRequestDigest: session.digest, state: session.state };
    }
    return cloneResult(session.result);
  }

  session(providerSessionId: string): Readonly<MockSession> | undefined {
    const session = this.sessions.get(providerSessionId);
    return session ? structuredClone(session) : undefined;
  }
  snapshot(): unknown {
    return structuredClone({
      sessions: [...this.sessions.entries()],
      keys: [...this.byKey.entries()],
      cancellationKeys: [...this.cancellationsByKey.entries()],
      startSteps: this.startSteps,
      reconcileSteps: this.reconcileSteps,
    });
  }
  restore(snapshot: unknown): void {
    if (!isRecord(snapshot)) snapshotInvalid();
    const sessionEntries = snapshot.sessions ?? [];
    const keyEntries = snapshot.keys ?? [];
    const cancellationEntries = snapshot.cancellationKeys ?? [];
    const startSteps = snapshot.startSteps ?? [];
    const reconcileSteps = snapshot.reconcileSteps ?? [];
    if (![sessionEntries, keyEntries, cancellationEntries, startSteps, reconcileSteps].every(Array.isArray)) snapshotInvalid();

    const sessions = new Map<string, MockSession>();
    for (const entry of sessionEntries as unknown[]) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || !isRecord(entry[1])) snapshotInvalid();
      const providerSessionId = entry[0];
      const raw = entry[1];
      let request: NayaxSessionRequest;
      try { request = normalizeRequest(raw.request as NayaxSessionRequest); }
      catch { snapshotInvalid(); }
      const requestDigest = digest(request);
      if (raw.digest !== requestDigest || !isRecord(raw.result)
        || raw.result.providerSessionId !== providerSessionId
        || raw.result.originalRequestDigest !== requestDigest
        || typeof raw.result.state !== "string" || !MOCK_STATES.has(raw.result.state as VaultPaymentState)
        || raw.state !== raw.result.state
        || (raw.transactionId !== undefined && typeof raw.transactionId !== "string")) snapshotInvalid();
      sessions.set(providerSessionId, {
        request,
        digest: requestDigest,
        result: { providerSessionId, originalRequestDigest: requestDigest, state: raw.result.state as VaultPaymentState },
        state: raw.result.state as VaultPaymentState,
        ...(raw.transactionId ? { transactionId: raw.transactionId } : {}),
      });
    }

    const byKey = new Map<string, string>();
    for (const entry of keyEntries as unknown[]) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || typeof entry[1] !== "string") snapshotInvalid();
      const session = sessions.get(entry[1]);
      if (!session || session.request.idempotencyKey !== entry[0]) snapshotInvalid();
      byKey.set(entry[0], entry[1]);
    }
    if (byKey.size !== sessions.size) snapshotInvalid();

    const cancellations = new Map<string, MockCancellation>();
    for (const entry of cancellationEntries as unknown[]) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || !isRecord(entry[1])) snapshotInvalid();
      const raw = entry[1];
      if (typeof raw.providerSessionId !== "string" || typeof raw.digest !== "string" || !isRecord(raw.result)) snapshotInvalid();
      const providerSessionId = raw.providerSessionId;
      const cancellationDigest = raw.digest;
      const result = raw.result;
      const session = sessions.get(providerSessionId);
      if (!session
        || cancellationDigest !== digest({ providerSessionId, idempotencyKey: entry[0] })
        || result.providerSessionId !== providerSessionId
        || result.originalRequestDigest !== session.digest
        || typeof result.state !== "string" || !MOCK_STATES.has(result.state as VaultPaymentState)) snapshotInvalid();
      cancellations.set(entry[0], {
        providerSessionId,
        digest: cancellationDigest,
        result: {
          providerSessionId,
          originalRequestDigest: result.originalRequestDigest as string,
          state: result.state as VaultPaymentState,
        },
      });
    }

    this.sessions.clear(); this.byKey.clear(); this.cancellationsByKey.clear();
    for (const entry of sessions) this.sessions.set(...entry);
    for (const entry of byKey) this.byKey.set(...entry);
    for (const entry of cancellations) this.cancellationsByKey.set(...entry);
    this.startSteps = (startSteps as unknown[]).map(normalizeStep);
    this.reconcileSteps = (reconcileSteps as unknown[]).map(normalizeStep);
  }
}

function outcomeState(outcome: NayaxMockOutcome): VaultPaymentState {
  switch (outcome) {
    case "AUTHORIZE": return "AUTHORIZED";
    case "DECLINE": return "DECLINED";
    case "CANCEL": return "CANCELLED";
    case "TIMEOUT": case "UNKNOWN": return "UNKNOWN";
    case "SETTLE": return "SETTLED";
  }
}
