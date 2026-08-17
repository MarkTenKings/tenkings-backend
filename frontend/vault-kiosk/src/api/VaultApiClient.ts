import type {
  ApiErrorBody,
  ApiSuccess,
  CertificationEvidenceResult,
  CertificationStartResult,
  CertificationStatus,
  KioskPublicSnapshot,
  MachineHealthDetail,
  RestockSession,
  RestockFinalizeResult,
  RestockStartResult,
  StaffAuthenticationResult,
  VaultDoorId,
  VaultMode,
  VaultRestockItemState,
  VaultRole,
} from "../types";
import { preserveCartConflicts } from "../workflow/kioskWorkflow";

const CONTRACT_VERSION = "1";

export class VaultApiError extends Error {
  readonly code: string;
  readonly requestId?: string;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(body: ApiErrorBody, status: number) {
    super(body.error.message || `Vault service request failed (${status})`);
    this.name = "VaultApiError";
    this.code = body.error.code || "REQUEST_FAILED";
    this.requestId = body.requestId;
    this.retryable = body.error.retryable ?? status >= 500;
    this.details = body.error.details;
  }
}

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  stateVersion?: string | number;
  signal?: AbortSignal;
}

export interface StateEvent {
  type: "STATE" | "PUBLIC_STATE" | "HEARTBEAT";
  sequence: number;
  data?: KioskPublicSnapshot;
}

export interface StateSubscription {
  close(): void;
}

type WireSale = NonNullable<KioskPublicSnapshot["activeSale"]> & {
  retrievalSeconds?: number;
  retryExtensionSeconds?: number;
};

type WireRestock = {
  sessionId: string;
  configVersion: number;
  status: string;
  items: Array<{ doorId: VaultDoorId; productId: string | null; productName: string | null; outcome: string; command?: WireCommand | null }>;
};

type WireCommand = {
  commandId: string;
  doorId?: VaultDoorId | null;
  state: string;
  terminal: boolean;
  observationRecorded?: boolean;
  outcome?: string | null;
  observedDoorId?: VaultDoorId | null;
  evidenceCode?: string | null;
};

type WireCertification = {
  sessionId: string;
  status: string;
  passCount: number;
  failCount: number;
  criticalCount: number;
  nextUnderTestedDoorId: VaultDoorId | null;
  currentCommand?: WireCommand | null;
};

type WireSnapshot = Omit<Partial<KioskPublicSnapshot>, "activeSale" | "activeRestock" | "activeCertification" | "buildIdentity" | "reservationConflictDoorIds" | "preservedDoorIds"> & Pick<KioskPublicSnapshot, "stateVersion" | "publicState" | "health" | "products" | "doors" | "cart" | "support" | "serviceLocked" | "configVersion" | "readinessReasons"> & {
  tax?: { city?: string | null; state?: string | null; rateBasisPoints?: number | null };
  timers?: { idleSecondsRemaining?: number | null };
  sale?: WireSale | null;
  activeSale?: WireSale | null;
  activeRestock?: WireRestock | null;
  activeCertification?: WireCertification | null;
  buildIdentity?: { sourceCommit?: string; appVersion?: string } | null;
  mutation?: { conflictedDoorIds?: VaultDoorId[]; preservedDoorIds?: VaultDoorId[] };
};

function normalizeCommand(command: WireCommand | null | undefined) {
  if (!command) return null;
  return {
    commandId: command.commandId,
    doorId: command.doorId ?? null,
    state: command.state,
    terminal: command.terminal === true,
    observationRecorded: command.observationRecorded === true,
    outcome: command.outcome ?? null,
    observedDoorId: command.observedDoorId ?? null,
    evidenceCode: command.evidenceCode ?? null,
  };
}

function normalizeSnapshot(raw: WireSnapshot): KioskPublicSnapshot {
  const numericVersion = typeof raw.stateVersion === "number" ? raw.stateVersion : Number.parseInt(raw.stateVersion, 10);
  const wireSale = raw.activeSale ?? raw.sale ?? null;
  const activeSale = wireSale ? {
    ...wireSale,
    retrievalSecondsRemaining: wireSale.retrievalSecondsRemaining ?? wireSale.retrievalSeconds ?? null,
    resetSecondsRemaining: wireSale.resetSecondsRemaining ?? null,
  } : null;
  const conflictDoorIds = raw.mutation?.conflictedDoorIds ?? [];
  const cart = preserveCartConflicts(raw.cart ?? [], conflictDoorIds);
  const selectedDoorIds = new Set(cart.map((line) => line.doorId));
  const conflicts = new Set(conflictDoorIds);
  const activeRestock: RestockSession | null = raw.activeRestock ? {
    id: raw.activeRestock.sessionId,
    configVersion: raw.activeRestock.configVersion,
    status: raw.activeRestock.status === "FINALIZED"
      ? "COMPLETED"
      : raw.activeRestock.items.every((item) => item.outcome !== "UNREVIEWED") ? "READY_TO_FINALIZE" : "ACTIVE",
    items: raw.activeRestock.items.map((item) => ({
      doorId: item.doorId,
      productId: item.productId,
      productName: item.productName ?? item.productId ?? "Unassigned product",
      outcome: item.outcome === "FILLED" || item.outcome === "LEFT_EMPTY" || item.outcome === "EXCEPTION" ? item.outcome : "UNREVIEWED",
      command: normalizeCommand(item.command),
    })),
    updatedAt: new Date().toISOString(),
  } : null;
  const activeCertification: CertificationStatus | null = raw.activeCertification ? {
    activeSessionId: raw.activeCertification.sessionId,
    passEvidenceCount: raw.activeCertification.passCount,
    failEvidenceCount: raw.activeCertification.failCount,
    criticalEvidenceCount: raw.activeCertification.criticalCount,
    nextDoorId: raw.activeCertification.nextUnderTestedDoorId,
    criticalStop: raw.activeCertification.status === "CRITICAL_STOP" || raw.activeCertification.criticalCount > 0,
    currentCommand: normalizeCommand(raw.activeCertification.currentCommand),
  } : null;
  const trustedSourceCommit = raw.buildIdentity?.sourceCommit;
  const buildIdentity = trustedSourceCommit && trustedSourceCommit !== "UNVERIFIED" && /^[A-Za-z0-9._/-]{7,128}$/.test(trustedSourceCommit) && raw.buildIdentity?.appVersion
    ? { sourceCommit: raw.buildIdentity.sourceCommit, appVersion: raw.buildIdentity.appVersion }
    : null;
  return {
    ...raw,
    sequence: raw.sequence ?? (Number.isFinite(numericVersion) ? numericVersion : 0),
    mode: raw.mode ?? "PRODUCTION",
    city: raw.city ?? raw.tax?.city ?? null,
    state: raw.state ?? raw.tax?.state ?? null,
    taxRateBasisPoints: raw.taxRateBasisPoints ?? raw.tax?.rateBasisPoints ?? null,
    providerLimits: raw.providerLimits ?? null,
    cart,
    doors: (raw.doors ?? []).map((door) => ({
      ...door,
      selected: selectedDoorIds.has(door.doorId),
      conflict: conflicts.has(door.doorId),
    })),
    activeSale,
    idleSecondsRemaining: raw.idleSecondsRemaining ?? raw.timers?.idleSecondsRemaining ?? null,
    activeRestock,
    activeCertification,
    buildIdentity,
    reservationConflictDoorIds: conflictDoorIds,
    preservedDoorIds: raw.mutation?.preservedDoorIds ?? [],
  } as KioskPublicSnapshot;
}

function normalizeStateEnvelope(response: ApiSuccess<WireSnapshot>): ApiSuccess<KioskPublicSnapshot> {
  return { ...response, data: normalizeSnapshot(response.data) };
}

export class VaultApiClient {
  private readonly baseUrl: URL;

  constructor(baseUrl: string = window.location.origin) {
    this.baseUrl = new URL(baseUrl);
  }

  bootstrap(signal?: AbortSignal): Promise<ApiSuccess<{ expiresAt: string }>> {
    return this.request("/api/v1/session/bootstrap", { method: "POST", body: {}, signal });
  }

  getState(signal?: AbortSignal): Promise<ApiSuccess<KioskPublicSnapshot>> {
    return this.request<WireSnapshot>("/api/v1/state", { signal }).then(normalizeStateEnvelope);
  }

  recordActivity(stateVersion: string | number): Promise<ApiSuccess<KioskPublicSnapshot>> {
    return this.request<WireSnapshot>("/api/v1/session/activity", {
      method: "POST",
      body: {},
      stateVersion,
    }).then(normalizeStateEnvelope);
  }

  selectDoor(doorId: VaultDoorId, productId: string, selected: boolean, stateVersion: string | number): Promise<ApiSuccess<KioskPublicSnapshot>> {
    return this.request<WireSnapshot>("/api/v1/cart/select", { method: "POST", body: { doorId, productId, selected }, stateVersion }).then(normalizeStateEnvelope);
  }

  pickForMe(productId: string, stateVersion: string | number): Promise<ApiSuccess<KioskPublicSnapshot>> {
    return this.request<WireSnapshot>("/api/v1/cart/pick", { method: "POST", body: { productId }, stateVersion }).then(normalizeStateEnvelope);
  }

  checkout(
    request: { configVersion: number; idempotencyKey: string; mode: VaultMode; doorIds: VaultDoorId[] },
    stateVersion: string | number,
  ): Promise<ApiSuccess<KioskPublicSnapshot>> {
    return this.request<WireSnapshot>("/api/v1/checkout", {
      method: "POST",
      body: request,
      stateVersion,
    }).then(normalizeStateEnvelope);
  }

  startPayment(saleId: string, stateVersion: string | number, idempotencyKey: string): Promise<ApiSuccess<KioskPublicSnapshot>> {
    return this.request<WireSnapshot>(`/api/v1/sales/${encodeURIComponent(saleId)}/payment`, {
      method: "POST",
      body: { saleId, idempotencyKey },
      stateVersion,
    }).then(normalizeStateEnvelope);
  }

  openPaidDoors(saleId: string, stateVersion: string | number, idempotencyKey: string): Promise<ApiSuccess<KioskPublicSnapshot>> {
    return this.request<WireSnapshot>(`/api/v1/sales/${encodeURIComponent(saleId)}/open-doors`, {
      method: "POST",
      body: { idempotencyKey },
      stateVersion,
    }).then(normalizeStateEnvelope);
  }

  finishPaidPresentation(saleId: string, stateVersion: string | number): Promise<ApiSuccess<KioskPublicSnapshot>> {
    return this.request<WireSnapshot>(`/api/v1/sales/${encodeURIComponent(saleId)}/done`, {
      method: "POST",
      body: {},
      stateVersion,
    }).then(normalizeStateEnvelope);
  }

  authenticateStaff(userId: string, pin: string, stateVersion: string | number): Promise<ApiSuccess<StaffAuthenticationResult>> {
    return this.request<{ sessionId: string; userId: string; role: VaultRole; expiresAt: string }>("/api/v1/staff/authenticate", {
      method: "POST",
      body: { userId, pin },
      stateVersion,
    }).then((response) => ({
      ...response,
      data: {
        session: { ...response.data, displayName: response.data.userId },
        restock: null,
        certification: null,
      },
    }));
  }

  async lockService(staffSessionId: string, stateVersion: string | number): Promise<ApiSuccess<KioskPublicSnapshot>> {
    await this.request("/api/v1/staff/lock", { method: "POST", body: { staffSessionId }, stateVersion });
    return this.getState();
  }

  async safeExit(staffSessionId: string, stateVersion: string | number, servicedDoorsClosed: boolean): Promise<ApiSuccess<KioskPublicSnapshot>> {
    await this.request("/api/v1/staff/safe-exit", {
      method: "POST",
      body: { staffSessionId, servicedDoorsClosed },
      stateVersion,
    });
    return this.getState();
  }

  startOrResumeRestock(staffSessionId: string, stateVersion: string | number): Promise<ApiSuccess<RestockStartResult>> {
    return this.request("/api/v1/restocks", { method: "POST", body: { staffSessionId }, stateVersion });
  }

  recordRestockOutcome(
    restockId: string,
    staffSessionId: string,
    doorId: VaultDoorId,
    outcome: Exclude<VaultRestockItemState, "UNREVIEWED">,
    stateVersion: string | number,
  ): Promise<ApiSuccess<{ recorded: true }>> {
    return this.request(`/api/v1/restocks/${encodeURIComponent(restockId)}/items/${encodeURIComponent(doorId)}`, {
      method: "POST",
      body: { staffSessionId, outcome },
      stateVersion,
    });
  }

  finalizeRestock(restockId: string, staffSessionId: string, servicedDoorsClosed: boolean, stateVersion: string | number): Promise<ApiSuccess<RestockFinalizeResult>> {
    return this.request(`/api/v1/restocks/${encodeURIComponent(restockId)}/finalize`, {
      method: "POST",
      body: { staffSessionId, servicedDoorsClosed },
      stateVersion,
    });
  }

  startCertification(staffSessionId: string, stateVersion: string | number): Promise<ApiSuccess<CertificationStartResult>> {
    return this.request("/api/v1/certification/sessions", { method: "POST", body: { staffSessionId }, stateVersion });
  }

  recordCertificationEvidence(
    sessionId: string,
    staffSessionId: string,
    evidence: Record<string, unknown>,
    stateVersion: string | number,
  ): Promise<ApiSuccess<CertificationEvidenceResult>> {
    return this.request(`/api/v1/certification/sessions/${encodeURIComponent(sessionId)}/evidence`, {
      method: "POST",
      body: { staffSessionId, evidence },
      stateVersion,
    });
  }

  submitCertification(
    sessionId: string,
    staffSessionId: string,
    servicedDoorsClosed: boolean,
    stateVersion: string | number,
  ): Promise<ApiSuccess<{ submitted: true }>> {
    return this.request(`/api/v1/certification/sessions/${encodeURIComponent(sessionId)}/submit`, {
      method: "POST",
      body: { staffSessionId, servicedDoorsClosed },
      stateVersion,
    });
  }

  getHealth(signal?: AbortSignal): Promise<ApiSuccess<MachineHealthDetail>> {
    return this.request<{
      readiness: { ready: boolean; reasons: string[] };
      controller: { adapter: string; ready: boolean };
      payment: { adapterName: string };
      integrity: { ok?: boolean; rows?: string[] } | string;
      pragmas?: { user_version?: number };
      outboxPendingCount?: number;
      appVersion?: string;
    }>("/api/v1/health", { signal }).then((response) => ({
      ...response,
      data: {
        health: response.data.readiness.ready ? "READY" : "RECOVERY_REQUIRED",
        readinessReasons: response.data.readiness.reasons,
        appVersion: response.data.appVersion ?? "Unavailable",
        localSchemaVersion: response.data.pragmas?.user_version ?? null,
        configVersion: null,
        databaseIntegrity: typeof response.data.integrity === "object" && response.data.integrity.ok === false ? "FAILED" : "OK",
        clockSafe: !response.data.readiness.reasons.includes("BLOCKED_CLOCK"),
        storageSafe: !response.data.readiness.reasons.some((reason) => /STORAGE|DISK|DATABASE/i.test(reason)),
        cloudFresh: !response.data.readiness.reasons.includes("CLOUD_NOT_FRESH"),
        outboxPendingCount: response.data.outboxPendingCount ?? null,
        paymentAdapter: response.data.payment.adapterName,
        controllerAdapter: response.data.controller.adapter,
      },
    }));
  }

  subscribe(onEvent: (event: StateEvent) => void, onDisconnect: () => void): StateSubscription {
    const url = new URL("/api/v1/events", this.baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url, "vault-contract-v1");
    let intentionallyClosed = false;

    socket.addEventListener("message", (message) => {
      try {
        const event = JSON.parse(String(message.data)) as Omit<StateEvent, "sequence" | "data"> & { sequence?: number; data?: WireSnapshot };
        if ((event.type === "STATE" || event.type === "PUBLIC_STATE") && event.data) {
          const data = normalizeSnapshot(event.data);
          const sequence = event.sequence ?? data.sequence;
          if (Number.isInteger(sequence)) onEvent({ type: event.type, sequence, data });
        } else if (event.type === "HEARTBEAT" && Number.isInteger(event.sequence)) {
          onEvent({ type: "HEARTBEAT", sequence: event.sequence! });
        }
      } catch {
        // Ignore malformed notifications. The next durable state poll remains authoritative.
      }
    });
    socket.addEventListener("close", () => {
      if (!intentionallyClosed) onDisconnect();
    });
    socket.addEventListener("error", () => socket.close());

    return {
      close: () => {
        intentionallyClosed = true;
        socket.close();
      },
    };
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<ApiSuccess<T>> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-Vault-Contract-Version": CONTRACT_VERSION,
    };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (options.stateVersion !== undefined) headers["If-Match"] = String(options.stateVersion);

    const response = await fetch(new URL(path, this.baseUrl), {
      method: options.method ?? "GET",
      credentials: "include",
      cache: "no-store",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });

    const body = await response.json().catch(() => ({ error: { code: "INVALID_RESPONSE", message: "The local service returned an unreadable response." } }));
    if (!response.ok) throw new VaultApiError(body as ApiErrorBody, response.status);
    return body as ApiSuccess<T>;
  }
}
