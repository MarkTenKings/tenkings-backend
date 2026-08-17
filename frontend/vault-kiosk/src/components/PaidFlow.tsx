import type { KioskPublicSnapshot } from "../types";
import { formatMoney, mayShowOpenDoors } from "../workflow/kioskWorkflow";
import { StatusBanner } from "./StatusBanner";
import { SupportPanel } from "./SupportPanel";

interface PaidFlowProps {
  snapshot: KioskPublicSnapshot;
  retryBusy: boolean;
  paymentBusy: boolean;
  doneBusy: boolean;
  onContinuePayment: () => void;
  onOpenDoors: () => void;
  onDone: () => void;
}

export function PaidFlow({ snapshot, retryBusy, paymentBusy, doneBusy, onContinuePayment, onOpenDoors, onDone }: PaidFlowProps) {
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
          <div><p className="eyebrow">Payment has not been requested</p><h2 id="reserved-order-title">Continue this order</h2><p>The local service durably reserved doors {sale.items.map((item) => item.doorId).join(" · ")}. Continue once; the same persisted payment intent is reused after a lost response or reload.</p></div>
        </section>
        <button type="button" className="primary-action payment-continue-action" disabled={paymentBusy} onClick={onContinuePayment}>
          {paymentBusy ? "Starting terminal…" : "Continue to payment"}
        </button>
      </main>
    );
  }

  if (paymentEndedWithoutCharge) {
    return (
      <main className="paid-flow payment-ended">
        <StatusBanner state={snapshot.publicState} />
        <section className="done-card">
          <p>The reservation was released by the local service. No door command is available from this order.</p>
          <button type="button" className="primary-action return-shopping-action" disabled={doneBusy} onClick={onDone}>
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
            <h2 id="pending-order-title">{sale.items.map((item) => item.doorId).join(" · ")}</h2>
            <p>{sale.paymentState === "REQUESTED" ? "Complete the one in-progress terminal session. Do not start another payment." : `Do not pay again. Give support reference ${sale.supportReference} to Ten Kings if reconciliation does not resolve.`}</p>
          </div>
        </section>
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
          <h2 id="paid-doors-title">{sale.paidDoorIds.join(" · ")}</h2>
          <p>Take only the packs from these numbered doors. An unlock command is not proof of physical retrieval.</p>
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
          <button type="button" className="primary-action retry-action" onClick={onOpenDoors} disabled={retryBusy}>
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
          <button type="button" className="secondary-action" disabled={doneBusy} onClick={onDone}>
            {doneBusy ? "Finishing…" : "Done"}
          </button>
        </section>
      )}
    </main>
  );
}
