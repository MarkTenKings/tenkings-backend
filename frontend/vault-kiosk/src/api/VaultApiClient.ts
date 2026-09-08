import type {
  ApiErrorBody,
  ApiSuccess,
  CertificationEvidenceResult,
  CertificationCycleResult,
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
import { currentDoorLabel } from "../workflow/profileLayout";
import type { VaultMachineProfile } from "@tenkings/vault-contracts/browser";

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
  configSchemaVersion?: 1 | 2;
  machineProfile?: VaultMachineProfile | null;
  status: string;
  items: Array<{ doorId: VaultDoorId; doorLabel?: string; productId: string | null; productName: string | null; outcome: string; command?: WireCommand | null }>;
};

type WireCommand = {
  commandId: string;
  doorId?: VaultDoorId | null;
  doorLabel?: string | null;
  state: string;
  terminal: boolean;
  observationRecorded?: boolean;
  outcome?: string | null;
  observedDoorId?: VaultDoorId | null;
  evidenceCode?: string | null;
  cycleType?: "DIAGNOSTIC" | "PURCHASE" | "RESTOCK";
  saleId?: string | null;
  restockSessionId?: string | null;
};

type WireCertification = {
  sessionId: string;
  status: string;
  configSchemaVersion?: 1 | 2;
  machineProfile?: VaultMachineProfile | null;
  passCount: number;
  failCount: number;
  criticalCount: number;
  nextUnderTestedDoorId: VaultDoorId | null;
  nextUnderTestedDoorLabel?: string | null;
  currentCommand?: WireCommand | null;
  adapterMode?: "MOCK" | "OFFICIAL_TEST" | "LIVE";
  observationEvidenceClass?: "AUTOMATED" | "FULL_MACHINE";
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
    doorLabel: command.doorLabel ?? null,
    state: command.state,
    terminal: command.terminal === true,
    observationRecorded: command.observationRecorded === true,
    outcome: command.outcome ?? null,
    observedDoorId: command.observedDoorId ?? null,
    evidenceCode: command.evidenceCode ?? null,
    cycleType: command.cycleType,
    saleId: command.saleId,
    restockSessionId: command.restockSessionId,
  };
}

function normalizeSnapshot(raw: WireSnapshot): KioskPublicSnapshot {
  const configSchemaVersion = raw.configSchemaVersion === 1 || raw.configSchemaVersion === 2 ? raw.configSchemaVersion : null;
  const machineProfile = configSchemaVersion === 2 ? raw.machineProfile ?? null : null;
  const numericVersion = typeof raw.stateVersion === "number" ? raw.stateVersion : Number.parseInt(raw.stateVersion, 10);
  const wireSale = raw.activeSale ?? raw.sale ?? null;
  const activeSale = wireSale ? {
    ...wireSale,
    retrievalSecondsRemaining: wireSale.retrievalSecondsRemaining ?? wireSale.retrievalSeconds ?? null,
    resetSecondsRemaining: wireSale.resetSecondsRemaining ?? null,
  } : null;
  const conflictDoorIds = raw.mutation?.conflictedDoorIds ?? [];
  const cart = preserveCartConflicts(raw.cart ?? [], conflictDoorIds).map((line) => ({ ...line, doorLabel: line.doorLabel ?? currentDoorLabel(line.doorId, configSchemaVersion, machineProfile) }));
  const selectedDoorIds = new Set(cart.map((line) => line.doorId));
  const conflicts = new Set(conflictDoorIds);
  const activeRestock: RestockSession | null = raw.activeRestock ? {
    id: raw.activeRestock.sessionId,
    configVersion: raw.activeRestock.configVersion,
    configSchemaVersion: raw.activeRestock.configSchemaVersion ?? null,
    machineProfile: raw.activeRestock.machineProfile ?? null,
    status: raw.activeRestock.status === "FINALIZED"
      ? "COMPLETED"
      : raw.activeRestock.items.every((item) => item.outcome !== "UNREVIEWED") ? "READY_TO_FINALIZE" : "ACTIVE",
    items: raw.activeRestock.items.map((item) => ({
      doorId: item.doorId,
      doorLabel: item.doorLabel ?? item.doorId,
      productId: item.productId,
      productName: item.productName ?? item.productId ?? "Unassigned product",
      outcome: item.outcome === "FILLED" || item.outcome === "LEFT_EMPTY" || item.outcome === "EXCEPTION" ? item.outcome : "UNREVIEWED",
      command: normalizeCommand(item.command),
    })),
    updatedAt: new Date().toISOString(),
  } : null;
  const activeCertification: CertificationStatus | null = raw.activeCertification ? {
    configSchemaVersion: raw.activeCertification.configSchemaVersion ?? null,
    machineProfile: raw.activeCertification.machineProfile ?? null,
    adapterMode: raw.activeCertification.adapterMode,
    observationEvidenceClass: raw.activeCertification.observationEvidenceClass,
    activeSessionId: raw.activeCertification.sessionId,
    passEvidenceCount: raw.activeCertification.passCount,
    failEvidenceCount: raw.activeCertification.failCount,
    criticalEvidenceCount: raw.activeCertification.criticalCount,
    nextDoorId: raw.activeCertification.nextUnderTestedDoorId,
    nextDoorLabel: raw.activeCertification.nextUnderTestedDoorLabel ?? raw.activeCertification.nextUnderTestedDoorId,
    criticalStop: raw.activeCertification.status === "CRITICAL_STOP" || raw.activeCertification.criticalCount > 0,
    currentCommand: normalizeCommand(raw.activeCertification.currentCommand),
  } : null;
  const trustedSourceCommit = raw.buildIdentity?.sourceCommit;
  const buildIdentity = trustedSourceCommit && /^[a-f0-9]{40}$/i.test(trustedSourceCommit) && raw.buildIdentity?.appVersion
    ? { sourceCommit: raw.buildIdentity.sourceCommit, appVersion: raw.buildIdentity.appVersion }
    : null;
  return {
    ...raw,
    configSchemaVersion,
    machineProfile,
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
  private renewal: Promise<ApiSuccess<{ expiresAt: string }>> | null = null;

  constructor(baseUrl: string = window.location.origin) {
    this.baseUrl = new URL(baseUrl);
  }

  bootstrap(signal?: AbortSignal): Promise<ApiSuccess<{ expiresAt: string }>> {
    if (!this.renewal) {
      this.renewal = this.request<{ expiresAt: string }>("/api/v1/session/bootstrap", { method: "POST", body: {}, signal }, false)
        .finally(() => { this.renewal = null; });
    }
    return this.renewal;
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

  cancelPayment(saleId: string, stateVersion: string | number, idempotencyKey: string): Promise<ApiSuccess<KioskPublicSnapshot>> {
    return this.request<WireSnapshot>(`/api/v1/sales/${encodeURIComponent(saleId)}/cancel`, {
      method: "POST", body: { idempotencyKey }, stateVersion,
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

  async activateEmptyMachineProfile(staffSessionId: string, stateVersion: string | number, expectedConfigVersion: number, expectedConfigDigest: string): Promise<ApiSuccess<KioskPublicSnapshot>> {
    await this.request("/api/v1/staff/profile-activation", {
      method: "POST", stateVersion,
      body: { staffSessionId, expectedConfigVersion, expectedConfigDigest, compartmentsEmpty: true, servicedDoorsClosed: true },
    });
    return this.getState();
  }

  recordStaffActivity(staffSessionId: string, stateVersion: string | number): Promise<ApiSuccess<{ recorded: true }>> {
    return this.request("/api/v1/staff/activity", { method: "POST", body: { staffSessionId }, stateVersion });
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
    notes = "",
    productFitConfirmed = false,
  ): Promise<ApiSuccess<{ recorded: true }>> {
    return this.request(`/api/v1/restocks/${encodeURIComponent(restockId)}/items/${encodeURIComponent(doorId)}`, {
      method: "POST",
      body: { staffSessionId, outcome, notes, productFitConfirmed },
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

  runCertificationCycle(sessionId: string, staffSessionId: string, cycleType: "PURCHASE" | "RESTOCK", stateVersion: string | number): Promise<ApiSuccess<CertificationCycleResult>> {
    return this.request(`/api/v1/certification/sessions/${encodeURIComponent(sessionId)}/cycles`, {
      method: "POST", body: { staffSessionId, cycleType }, stateVersion,
    });
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
      localSchemaVersion?: number;
      configVersion?: number | null;
    }>("/api/v1/health", { signal }).then((response) => ({
      ...response,
      data: {
        health: response.data.readiness.ready ? "READY" : "RECOVERY_REQUIRED",
        readinessReasons: response.data.readiness.reasons,
        appVersion: response.data.appVersion ?? "Unavailable",
        localSchemaVersion: response.data.localSchemaVersion ?? response.data.pragmas?.user_version ?? null,
        configVersion: response.data.configVersion ?? null,
        databaseIntegrity: typeof response.data.integrity === "object" ? response.data.integrity.ok === true ? "OK" : response.data.integrity.ok === false ? "FAILED" : "CHECKING" : response.data.integrity === "ok" ? "OK" : "CHECKING",
        clockSafe: !response.data.readiness.reasons.some((reason) => /CLOCK/.test(reason)),
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

  private async request<T>(path: string, options: RequestOptions = {}, renewSession = true): Promise<ApiSuccess<T>> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-Vault-Contract-Version": CONTRACT_VERSION,
    };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (options.stateVersion !== undefined) headers["If-Match"] = String(options.stateVersion);

    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    let response: Response;
    let body: unknown;
    try {
      response = await fetch(new URL(path, this.baseUrl), {
      method: options.method ?? "GET",
      credentials: "include",
      cache: "no-store",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
      });
      body = await response.json().catch(() => ({ error: { code: "INVALID_RESPONSE", message: "The local service returned an unreadable response." } }));
    } finally {
      window.clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
    }
    if (!response.ok) {
      const error = new VaultApiError(body as ApiErrorBody, response.status);
      if (renewSession && response.status === 401 && ["KIOSK_SESSION_REQUIRED", "KIOSK_SESSION_INVALID"].includes(error.code)) {
        await this.bootstrap(options.signal);
        if ((options.method ?? "GET") === "GET") return this.request<T>(path, options, false);
        // Mutations are never replayed after a transport/session failure. Reload durable
        // state and let the customer explicitly retry the same business intent.
        throw new VaultApiError({ error: { code: "KIOSK_SESSION_RENEWED", message: "The screen connection was renewed. Review the current order, then try the action again." } }, 409);
      }
      throw error;
    }
    return body as ApiSuccess<T>;
  }
}
