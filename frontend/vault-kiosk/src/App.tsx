import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VaultDoorId } from "@tenkings/vault-contracts/browser";
import { VaultApiClient, VaultApiError, type StateSubscription } from "./api/VaultApiClient";
import { BrandHeader } from "./components/BrandHeader";
import { CartPanel } from "./components/CartPanel";
import { DoorMap } from "./components/DoorMap";
import { IdleWarningDialog } from "./components/IdleWarningDialog";
import { PaidFlow } from "./components/PaidFlow";
import { PinEntry } from "./components/PinEntry";
import { ProductRail } from "./components/ProductRail";
import { StaffPortal } from "./components/StaffPortal";
import { StatusBanner } from "./components/StatusBanner";
import type {
  CertificationStatus,
  KioskCartLine,
  KioskDoor,
  KioskPublicSnapshot,
  MachineHealthDetail,
  RestockSession,
  StaffSession,
  VaultRestockItemState,
} from "./types";
import { calculateCartTotals, mayIdleTimeout, preserveCartConflicts, providerLimitViolation } from "./workflow/kioskWorkflow";
import {
  checkoutFingerprint,
  checkoutIdempotencyKey,
  clearCheckoutIdempotencyKey,
  clearPaymentIdempotencyKey,
  paymentIdempotencyKey,
} from "./workflow/durableIntents";

const SHOPPING_STATES = new Set([
  "ATTRACT", "SHOPPING_EMPTY", "SHOPPING_WITH_CART", "PRODUCT_SOLD_OUT", "ALL_PRODUCTS_SOLD_OUT",
  "RESERVATION_CONFLICT", "PROVIDER_LIMIT_EXCEEDED", "IDLE_WARNING",
]);
const PAID_AND_RECOVERY_STATES = new Set([
  "PAYMENT_STARTING", "PAYMENT_PENDING", "PAYMENT_UNKNOWN", "PAYMENT_APPROVED_DURABLE", "UNLOCK_QUEUED",
  "RETRIEVAL", "GROUP_RETRY_AVAILABLE", "GROUP_RETRY_COMMITTED", "GROUP_RETRY_USED", "SUPPORT_REQUIRED",
  "PAID_RESET_COUNTDOWN",
]);

function errorMessage(error: unknown): string {
  if (error instanceof VaultApiError) return error.message;
  if (error instanceof Error && error.name !== "AbortError") return "The local service did not respond. Your durable selections are being reloaded.";
  return "Unable to complete that action.";
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface AppProps {
  api?: VaultApiClient;
}

export function App({ api: providedApi }: AppProps) {
  const api = useMemo(() => providedApi ?? new VaultApiClient(), [providedApi]);
  const [snapshot, setSnapshot] = useState<KioskPublicSnapshot | null>(null);
  const snapshotRef = useRef<KioskPublicSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [animatedDoorId, setAnimatedDoorId] = useState<VaultDoorId | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [serviceEntry, setServiceEntry] = useState(false);
  const [staff, setStaff] = useState<StaffSession | null>(null);
  const [restock, setRestock] = useState<RestockSession | null>(null);
  const [certification, setCertification] = useState<CertificationStatus | null>(null);
  const [health, setHealth] = useState<MachineHealthDetail | null>(null);
  const [conflictCart, setConflictCart] = useState<KioskCartLine[] | null>(null);
  const [doorSafetyEpoch, setDoorSafetyEpoch] = useState(0);
  const [workflowResumeRequired, setWorkflowResumeRequired] = useState(false);
  const serviceGestureRef = useRef<number[]>([]);

  const customerCart = conflictCart ?? snapshot?.cart ?? [];

  const applySnapshot = useCallback((next: KioskPublicSnapshot) => {
    if (!snapshotRef.current || next.sequence >= snapshotRef.current.sequence) {
      snapshotRef.current = next;
      setSnapshot(next);
      if (next.activeSale) clearCheckoutIdempotencyKey();
      setSelectedProductId((current) => current ?? next.products.find((product) => product.active)?.id ?? null);
    }
  }, []);

  const refresh = useCallback(async () => {
    const response = await api.getState();
    applySnapshot(response.data);
    return response.data;
  }, [api, applySnapshot]);

  useEffect(() => {
    const resetOnOutsideTap = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest(".service-hot-corner")) {
        serviceGestureRef.current = [];
      }
    };
    document.addEventListener("pointerdown", resetOnOutsideTap, true);
    return () => document.removeEventListener("pointerdown", resetOnOutsideTap, true);
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    let subscription: StateSubscription | null = null;
    let reconnectTimer: number | null = null;
    let disposed = false;

    const connect = async () => {
      try {
        await api.bootstrap(abort.signal);
        const response = await api.getState(abort.signal);
        if (disposed) return;
        applySnapshot(response.data);
        setConnected(true);
        subscription = api.subscribe((event) => {
          if ((event.type === "STATE" || event.type === "PUBLIC_STATE") && event.data) applySnapshot(event.data);
        }, () => {
          setConnected(false);
          if (!disposed) reconnectTimer = window.setTimeout(() => void connect(), 2000);
        });
      } catch (error) {
        if (!disposed && !(error instanceof DOMException && error.name === "AbortError")) {
          setConnected(false);
          reconnectTimer = window.setTimeout(() => void connect(), 2000);
        }
      }
    };
    void connect();
    return () => {
      disposed = true;
      abort.abort();
      subscription?.close();
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
    };
  }, [api, applySnapshot]);

  useEffect(() => {
    if (!snapshot?.activeSale || snapshot.activeSale.retrievalSecondsRemaining === null) return;
    const timer = window.setInterval(() => {
      void refresh().catch(() => {
        // The websocket reconnect loop owns availability; the durable machine clock remains authoritative.
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [refresh, snapshot?.activeSale?.saleId, snapshot?.activeSale?.retrievalSecondsRemaining]);

  const run = useCallback(async <T,>(name: string, action: () => Promise<T>, onSuccess?: (value: T) => void | Promise<void>) => {
    setBusyAction(name);
    setNotice(null);
    try {
      const value = await action();
      await onSuccess?.(value);
      return value;
    } catch (error) {
      setNotice(errorMessage(error));
      try { await refresh(); } catch { /* reconnect loop owns availability */ }
      return undefined;
    } finally {
      setBusyAction(null);
    }
  }, [refresh]);

  const toggleDoor = useCallback((door: KioskDoor) => {
    if (!snapshot) return;
    if (door.conflict) {
      setConflictCart((current) => {
        const next = current?.filter((line) => line.doorId !== door.doorId) ?? null;
        return next?.some((line) => line.conflict) ? next : null;
      });
      setNotice(`Removed unavailable door ${door.doorId}. Choose another gold door to replace it.`);
      return;
    }
    if (!door.productId) return;
    void run("door", () => api.selectDoor(door.doorId, door.productId!, !door.selected, snapshot.stateVersion), (response) => {
      setConflictCart(null);
      applySnapshot(response.data);
    });
  }, [api, applySnapshot, run, snapshot]);

  const pickForMe = useCallback((productId: string) => {
    if (!snapshot) return;
    const before = new Set(snapshot.cart.map((line) => line.doorId));
    setSelectedProductId(productId);
    void run("pick", () => api.pickForMe(productId, snapshot.stateVersion), (response) => {
      applySnapshot(response.data);
      const picked = response.data.cart.find((line) => !before.has(line.doorId))?.doorId ?? null;
      setAnimatedDoorId(picked);
      if (picked) window.setTimeout(() => setAnimatedDoorId(null), 900);
    });
  }, [api, applySnapshot, run, snapshot]);

  const continuePayment = useCallback(() => {
    if (!snapshot?.activeSale || snapshot.activeSale.paymentState !== "NOT_REQUESTED") return;
    const saleId = snapshot.activeSale.saleId;
    const paymentKey = paymentIdempotencyKey(saleId);
    void run("payment", () => api.startPayment(saleId, snapshot.stateVersion, paymentKey), (response) => applySnapshot(response.data));
  }, [api, applySnapshot, run, snapshot]);

  const checkout = useCallback(() => {
    if (!snapshot?.configVersion) return;
    const doorIds = customerCart.map((line) => line.doorId);
    const fingerprint = checkoutFingerprint(snapshot.configVersion, snapshot.mode, doorIds);
    const checkoutKey = checkoutIdempotencyKey(fingerprint);
    void run("checkout", () => api.checkout({
      configVersion: snapshot.configVersion!,
      idempotencyKey: checkoutKey,
      mode: snapshot.mode,
      doorIds,
    }, snapshot.stateVersion), async (checkoutResponse) => {
      applySnapshot(checkoutResponse.data);
      if (checkoutResponse.data.reservationConflictDoorIds.length) {
        setConflictCart(preserveCartConflicts(customerCart, checkoutResponse.data.reservationConflictDoorIds));
        setNotice("One or more selected doors changed before payment. The exact conflicts are marked; all other selections remain.");
        return;
      }
      const saleId = checkoutResponse.data.activeSale?.saleId;
      if (!saleId) return;
      clearCheckoutIdempotencyKey();
      const paymentKey = paymentIdempotencyKey(saleId);
      const paymentResponse = await api.startPayment(saleId, checkoutResponse.data.stateVersion, paymentKey);
      applySnapshot(paymentResponse.data);
    });
  }, [api, applySnapshot, customerCart, run, snapshot]);

  const openDoors = useCallback(() => {
    if (!snapshot?.activeSale) return;
    const saleId = snapshot.activeSale.saleId;
    const key = paymentIdempotencyKey(`retry-${saleId}`);
    void run("retry", () => api.openPaidDoors(saleId, snapshot.stateVersion, key), (response) => applySnapshot(response.data));
  }, [api, applySnapshot, run, snapshot]);

  const done = useCallback(() => {
    if (!snapshot?.activeSale) return;
    const saleId = snapshot.activeSale.saleId;
    void run("done", () => api.finishPaidPresentation(saleId, snapshot.stateVersion), (response) => {
      clearPaymentIdempotencyKey(saleId);
      clearPaymentIdempotencyKey(`retry-${saleId}`);
      setConflictCart(null);
      applySnapshot(response.data);
    });
  }, [api, applySnapshot, run, snapshot]);

  const keepShopping = useCallback(() => {
    if (!snapshot || snapshot.publicState !== "IDLE_WARNING") return;
    void run("activity", () => api.recordActivity(snapshot.stateVersion), (response) => applySnapshot(response.data));
  }, [api, applySnapshot, run, snapshot]);

  const serviceGesture = useCallback(() => {
    if (!snapshot || !mayIdleTimeout(snapshot.publicState) || snapshot.activeSale) return;
    const now = Date.now();
    serviceGestureRef.current = [...serviceGestureRef.current.filter((time) => now - time < 6000), now];
    if (serviceGestureRef.current.length >= 10) {
      serviceGestureRef.current = [];
      setServiceEntry(true);
    }
  }, [snapshot]);

  const authenticateStaff = useCallback(async (userId: string, pin: string) => {
    if (!snapshot) return;
    await run("staff-auth", () => api.authenticateStaff(userId, pin, snapshot.stateVersion), async (response) => {
      const durable = await refresh();
      setStaff(response.data.session);
      setRestock(durable.activeRestock ?? response.data.restock);
      setCertification(durable.activeCertification ?? response.data.certification);
      setWorkflowResumeRequired(Boolean(
        durable.activeRestock || (durable.activeCertification && !durable.activeCertification.currentCommand?.observationRecorded),
      ));
    });
  }, [api, refresh, run, snapshot]);

  useEffect(() => {
    if (!snapshot) return;
    if (staff && (!snapshot.activeStaff || snapshot.activeStaff.locked || snapshot.activeStaff.sessionId !== staff.sessionId)) {
      setStaff(null);
      setHealth(null);
      return;
    }
    if (!staff) return;
    setRestock(snapshot.activeRestock ?? null);
    setCertification(snapshot.activeCertification ?? null);
  }, [snapshot, staff]);

  const loadHealth = useCallback(async () => {
    await run("health", () => api.getHealth(), (response) => setHealth(response.data));
  }, [api, run]);
  const startRestock = useCallback(async () => {
    if (!snapshot || !staff) return;
    setDoorSafetyEpoch((value) => value + 1);
    await run("restock", () => api.startOrResumeRestock(staff.sessionId, snapshot.stateVersion), async (response) => {
      void response;
      await refresh();
      setWorkflowResumeRequired(false);
    });
  }, [api, refresh, run, snapshot, staff]);
  const restockOutcome = useCallback(async (doorId: VaultDoorId, outcome: Exclude<VaultRestockItemState, "UNREVIEWED">) => {
    if (!snapshot || !restock || !staff) return;
    setDoorSafetyEpoch((value) => value + 1);
    await run("restock", () => api.recordRestockOutcome(restock.id, staff.sessionId, doorId, outcome, snapshot.stateVersion), async () => {
      setRestock((current) => current ? {
        ...current,
        status: current.items.every((item) => item.doorId === doorId || item.outcome !== "UNREVIEWED") ? "READY_TO_FINALIZE" : current.status,
        items: current.items.map((item) => item.doorId === doorId ? { ...item, outcome, command: item.command ? { ...item.command, observationRecorded: true } : null } : item),
        updatedAt: new Date().toISOString(),
      } : current);
      await refresh();
    });
  }, [api, refresh, restock, run, snapshot, staff]);
  const finalizeRestock = useCallback(async (closed: boolean) => {
    if (!snapshot || !restock || !staff) return;
    setDoorSafetyEpoch((value) => value + 1);
    await run("restock", () => api.finalizeRestock(restock.id, staff.sessionId, closed, snapshot.stateVersion), async () => {
      setRestock((current) => current ? { ...current, status: "COMPLETED", updatedAt: new Date().toISOString() } : current);
      await refresh();
    });
  }, [api, refresh, restock, run, snapshot, staff]);
  const startCertification = useCallback(async () => {
    if (!snapshot || !staff || !snapshot.buildIdentity) return;
    setDoorSafetyEpoch((value) => value + 1);
    await run("certification", () => api.startCertification(staff.sessionId, snapshot.stateVersion), async (response) => {
      void response;
      await refresh();
      setWorkflowResumeRequired(false);
    });
  }, [api, refresh, run, snapshot, staff]);
  const certificationEvidence = useCallback(async (outcome: "PASS" | "FAIL" | "CRITICAL", doorId: VaultDoorId | null) => {
    if (!snapshot || !staff || !certification?.activeSessionId) return;
    setDoorSafetyEpoch((value) => value + 1);
    const observedAt = new Date().toISOString();
    const notes = outcome === "CRITICAL" ? "Unexpected or unpaid door reported by supervised operator" : "Supervised kiosk evidence";
    const controllerObservedDoorId = certification.currentCommand?.observedDoorId ?? null;
    const evidenceId = crypto.randomUUID();
    const expectedDoorIds = doorId ? [doorId] : [];
    const observedDoorIds = outcome === "PASS" && doorId ? [doorId] : outcome === "CRITICAL" && controllerObservedDoorId ? [controllerObservedDoorId] : [];
    const evidenceClass = "FULL_MACHINE";
    const evidenceDigest = await sha256Hex(JSON.stringify({
      evidenceId,
      sessionId: certification.activeSessionId,
      commandId: certification.currentCommand?.commandId ?? null,
      doorId,
      evidenceClass,
      outcome,
      expectedDoorIds,
      observedDoorIds,
      notes,
      observedAt,
      buildIdentity: snapshot.buildIdentity,
    }));
    await run("certification", () => api.recordCertificationEvidence(certification.activeSessionId!, staff.sessionId, {
      evidenceId, doorId: doorId ?? undefined, evidenceClass,
      outcome,
      expectedDoorIds,
      observedDoorIds,
      notes, artifactDigest: evidenceDigest, observedAt,
    }, snapshot.stateVersion), async (response) => {
      setCertification((current) => current ? {
        ...current,
        criticalStop: response.data.critical || current.criticalStop,
        currentCommand: current.currentCommand ? { ...current.currentCommand, observationRecorded: true } : null,
      } : current);
      await refresh();
    });
  }, [api, certification, refresh, run, snapshot, staff]);
  const submitCertification = useCallback(async (servicedDoorsClosed: boolean) => {
    if (!snapshot || !staff || !certification?.activeSessionId) return;
    setDoorSafetyEpoch((value) => value + 1);
    await run("certification-submit", () => api.submitCertification(
      certification.activeSessionId!, staff.sessionId, servicedDoorsClosed, snapshot.stateVersion,
    ), async () => {
      await refresh();
      setCertification(null);
      setWorkflowResumeRequired(false);
    });
  }, [api, certification, refresh, run, snapshot, staff]);
  const safeExit = useCallback(async (closed: boolean) => {
    if (!snapshot || !staff) return;
    await run("safe-exit", () => api.safeExit(staff.sessionId, snapshot.stateVersion, closed), (response) => {
      applySnapshot(response.data);
      setStaff(null); setRestock(null); setCertification(null); setHealth(null); setServiceEntry(false); setWorkflowResumeRequired(false);
    });
  }, [api, applySnapshot, run, snapshot, staff]);

  const resumeServiceWorkflow = useCallback(async () => {
    if (restock) return startRestock();
    if (certification) return startCertification();
    setWorkflowResumeRequired(false);
  }, [certification, restock, startCertification, startRestock]);

  if (!snapshot) {
    return (
      <div className="kiosk-app boot-screen">
        <BrandHeader mode="PRODUCTION" location="Starting local service" online={false} onServiceGesture={() => undefined} />
        <StatusBanner state="BOOTING" />
      </div>
    );
  }

  const totals = calculateCartTotals(customerCart, snapshot.taxRateBasisPoints);
  const violation = providerLimitViolation(customerCart, totals.totalCents, snapshot.providerLimits);
  const interactionDisabled = busyAction !== null || !connected || snapshot.serviceLocked;
  const location = snapshot.city && snapshot.state ? `${snapshot.city}, ${snapshot.state}` : "Ten Kings Vault";
  const durableStaff = snapshot.activeStaff ?? null;
  const authorizedStaff = staff && durableStaff && !durableStaff.locked && durableStaff.sessionId === staff.sessionId ? staff : null;
  const serviceRecoveryRequired = snapshot.serviceLocked && !authorizedStaff;
  const showServiceEntry = (serviceEntry || serviceRecoveryRequired) && !authorizedStaff;
  const showCustomerSale = Boolean(snapshot.activeSale) && (
    snapshot.activeSale?.paymentState === "NOT_REQUESTED" || PAID_AND_RECOVERY_STATES.has(snapshot.publicState)
    || snapshot.publicState === "PAYMENT_DECLINED" || snapshot.publicState === "PAYMENT_CANCELLED"
  );
  const conflictIds = new Set(customerCart.filter((line) => line.conflict).map((line) => line.doorId));
  const selectedIds = new Set(customerCart.map((line) => line.doorId));
  const displayDoors = snapshot.doors.map((door) => ({ ...door, selected: selectedIds.has(door.doorId), conflict: conflictIds.has(door.doorId) }));

  return (
    <div className="kiosk-app" data-mode={snapshot.mode}>
      <BrandHeader mode={snapshot.mode} location={location} online={connected} onServiceGesture={serviceGesture} />
      {snapshot.mode === "CERTIFICATION" && <div className="persistent-test-strip">TEST MODE · NO PRODUCTION PAYMENT OR REVENUE</div>}
      {showServiceEntry && <PinEntry
        busy={busyAction === "staff-auth"} error={notice} onAuthenticate={authenticateStaff}
        resumeUserId={durableStaff?.userId ?? null} recoveryRequired={serviceRecoveryRequired}
        onCancel={() => { setServiceEntry(false); setNotice(null); }}
      />}
      {authorizedStaff && (
        <StaffPortal
          staff={authorizedStaff} restock={restock} certification={certification} health={health} buildIdentity={snapshot.buildIdentity}
          busy={busyAction !== null} error={notice} doorSafetyEpoch={doorSafetyEpoch} workflowResumeRequired={workflowResumeRequired}
          onLoadHealth={loadHealth} onStartRestock={startRestock} onRestockOutcome={restockOutcome}
          onFinalizeRestock={finalizeRestock} onStartCertification={startCertification}
          onCertificationEvidence={certificationEvidence} onSubmitCertification={submitCertification}
          onResumeWorkflow={resumeServiceWorkflow} onSafeExit={safeExit}
        />
      )}
      {!showServiceEntry && !authorizedStaff && !snapshot.serviceLocked && showCustomerSale && (
        <PaidFlow
          snapshot={snapshot} retryBusy={busyAction === "retry"} paymentBusy={busyAction === "payment"}
          doneBusy={busyAction === "done"} onContinuePayment={continuePayment} onOpenDoors={openDoors} onDone={done}
        />
      )}
      {!showServiceEntry && !authorizedStaff && !snapshot.serviceLocked && !showCustomerSale && SHOPPING_STATES.has(snapshot.publicState) && (
        <main className="customer-shopping">
          <StatusBanner state={snapshot.publicState} reasons={snapshot.readinessReasons} />
          {notice && <p className="global-notice" role="alert">{notice}</p>}
          <ProductRail
            products={snapshot.products} doors={displayDoors} selectedProductId={selectedProductId}
            disabled={interactionDisabled} onSelect={setSelectedProductId} onPick={pickForMe} pickBusy={busyAction === "pick"}
          />
          <div className="shopping-workspace">
            <DoorMap
              doors={displayDoors} selectedProductId={selectedProductId} disabled={interactionDisabled}
              animatedDoorId={animatedDoorId} onToggle={toggleDoor}
            />
            <CartPanel
              cart={customerCart} subtotalCents={totals.subtotalCents} taxCents={totals.taxCents} totalCents={totals.totalCents}
              taxLabel={snapshot.city && snapshot.state ? `Tax · ${snapshot.city}, ${snapshot.state}` : "Tax"}
              providerViolation={violation} disabled={interactionDisabled} busy={busyAction === "checkout"}
              onRemove={(line) => { const door = displayDoors.find((candidate) => candidate.doorId === line.doorId); if (door) toggleDoor(door); }}
              onCheckout={checkout}
            />
          </div>
          {snapshot.publicState === "IDLE_WARNING" && (
            <IdleWarningDialog secondsRemaining={snapshot.idleSecondsRemaining ?? 0} busy={busyAction === "activity"} onKeepShopping={keepShopping} />
          )}
        </main>
      )}
      {!showServiceEntry && !authorizedStaff && !snapshot.serviceLocked && !showCustomerSale && !SHOPPING_STATES.has(snapshot.publicState) && !PAID_AND_RECOVERY_STATES.has(snapshot.publicState) && (
        <main className="state-only-page"><StatusBanner state={snapshot.publicState} reasons={snapshot.readinessReasons} />{notice && <p className="global-notice" role="alert">{notice}</p>}</main>
      )}
    </div>
  );
}
