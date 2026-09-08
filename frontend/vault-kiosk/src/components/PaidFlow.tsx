import type { KioskPublicSnapshot } from "../types";
import { formatMoney, mayShowOpenDoors, saleDoorLabel } from "../workflow/kioskWorkflow";
import { StatusBanner } from "./StatusBanner";
import { SupportPanel } from "./SupportPanel";

interface PaidFlowProps {
  snapshot: KioskPublicSnapshot;
  retryBusy: boolean;
  paymentBusy: boolean;
  doneBusy: boolean;
  disabled?: boolean;
  onContinuePayment: () => void;
  onOpenDoors: () => void;
  onDone: () => void;
  onCancelPayment?: () => void;
}

export function PaidFlow({ snapshot, retryBusy, paymentBusy, doneBusy, disabled = false, onContinuePayment, onOpenDoors, onDone, onCancelPayment }: PaidFlowProps) {
  const sale = snapshot.activeSale;
  if (!sale) return <StatusBanner state={snapshot.publicState} reasons={snapshot.readinessReasons} />;
  const paymentNotRequested = sale.state === "RESERVED" && sale.paymentState === "NOT_REQUESTED";
  const paymentEndedWithoutCharge = snapshot.publicState === "PAYMENT_DECLINED" || snapshot.publicState === "PAYMENT_CANCELLED";
  const paymentUnresolved = sale.paymentState === "REQUESTED" || sale.paymentState === "UNKNOWN" || sale.paymentState === "RECONCILIATION_REQUIRED";
  const showRetry = mayShowOpenDoors(snapshot.publicState, sale);
  const showSupport = snapshot.publicState === "SUPPORT_REQUIRED" || snapshot.publicState === "GROUP_RETRY_USED" || sale.retryUsed;

  if (paymentNotRequested) {
    return (
      <main className="paid-flow payment-recovery">
        <StatusBanner state="PAYMENT_STARTING" />
        <section className="paid-receipt" aria-labelledby="reserved-order-title">
          <div className="paid-total"><span>Reserved order total</span><strong>{formatMoney(sale.totalCents)}</strong></div>
          <div><p className="eyebrow">Payment has not been requested</p><h2 id="reserved-order-title">Continue this order</h2><p>Your reserved doors are {sale.items.map((item) => item.doorLabel ?? item.doorId).join(" · ")}. Continue this order to start its payment session.</p></div>
        </section>
        <button type="button" className="primary-action payment-continue-action" disabled={disabled || paymentBusy} onClick={onContinuePayment}>
          {paymentBusy ? "Starting terminal…" : "Continue to payment"}
        </button>
        {sale.cancelAvailable && onCancelPayment && <button type="button" className="secondary-action payment-cancel-action" disabled={disabled} onClick={onCancelPayment}>Cancel this unpaid order</button>}
      </main>
    );
  }

  if (paymentEndedWithoutCharge) {
    return (
      <main className="paid-flow payment-ended">
        <StatusBanner state={snapshot.publicState} />
        <section className="done-card">
          <p>The reservation was released by the local service. No door command is available from this order.</p>
          <button type="button" className="primary-action return-shopping-action" disabled={disabled || doneBusy} onClick={onDone}>
            {doneBusy ? "Returning…" : "Return to shopping"}
          </button>
        </section>
      </main>
    );
  }

  if (paymentUnresolved) {
    return (
      <main className="paid-flow payment-unresolved">
        <StatusBanner state={snapshot.publicState} />
        <section className="paid-receipt" aria-labelledby="pending-order-title">
          <div className="paid-total"><span>Order total</span><strong>{formatMoney(sale.totalCents)}</strong></div>
          <div>
            <p className="eyebrow">Reserved doors · not proof of payment</p>
            <h2 id="pending-order-title">{sale.items.map((item) => item.doorLabel ?? item.doorId).join(" · ")}</h2>
            <p>{sale.paymentState === "REQUESTED" ? "Complete the one in-progress terminal session. Do not start another payment." : `Do not pay again. Give support reference ${sale.supportReference} to Ten Kings if reconciliation does not resolve.`}</p>
          </div>
        </section>
        {snapshot.support && sale.paymentState !== "REQUESTED" && <SupportPanel support={snapshot.support} sale={sale} />}
        {sale.cancelAvailable && onCancelPayment && <button type="button" className="secondary-action payment-cancel-action" disabled={disabled} onClick={onCancelPayment}>Request payment cancellation</button>}
      </main>
    );
  }

  return (
    <main className="paid-flow">
      <StatusBanner state={snapshot.publicState} />
      <section className="paid-receipt" aria-labelledby="paid-doors-title">
        <div className="paid-total">
          <span>Paid total</span>
          <strong>{formatMoney(sale.totalCents)}</strong>
        </div>
        <div>
          <p className="eyebrow">Your exact paid doors</p>
          <h2 id="paid-doors-title">{sale.paidDoorIds.map((doorId) => saleDoorLabel(sale, doorId)).join(" · ")}</h2>
          <p>Take only the packs from these labeled doors. An unlock command is not proof of physical retrieval.</p>
        </div>
        {sale.retrievalSecondsRemaining !== null && snapshot.publicState !== "PAID_RESET_COUNTDOWN" && (
          <div className="countdown-orb" aria-live="polite">
            <strong>{sale.retrievalSecondsRemaining}</strong><span>seconds</span>
          </div>
        )}
      </section>

      {showRetry && (
        <section className="retry-card">
          <p>If any paid door needs one more unlock command, use the single group retry below.</p>
          <button type="button" className="primary-action retry-action" onClick={onOpenDoors} disabled={disabled || retryBusy}>
            {retryBusy ? "Recording retry…" : "OPEN DOORS"}
          </button>
          <small>This sends exactly one second command to every original paid door. It never targets another door.</small>
        </section>
      )}

      {showSupport && snapshot.support && <SupportPanel support={snapshot.support} sale={sale} />}

      {snapshot.publicState === "PAID_RESET_COUNTDOWN" && (
        <section className="done-card">
          <div className="countdown-line" aria-live="polite">
            Resetting in <strong>{sale.resetSecondsRemaining ?? 0}</strong> seconds
          </div>
          <button type="button" className="secondary-action" disabled={disabled || doneBusy} onClick={onDone}>
            {doneBusy ? "Finishing…" : "I GOT MY PACKS — DONE"}
          </button>
        </section>
      )}
    </main>
  );
}
