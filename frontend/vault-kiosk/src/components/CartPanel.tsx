import type { KioskCartLine } from "../types";
import { formatMoney, type ProviderLimitViolation } from "../workflow/kioskWorkflow";

interface CartPanelProps {
  cart: readonly KioskCartLine[];
  subtotalCents: number;
  taxCents: number | null;
  totalCents: number | null;
  taxLabel: string;
  providerViolation: ProviderLimitViolation;
  disabled: boolean;
  busy: boolean;
  onRemove: (line: KioskCartLine) => void;
  onCheckout: () => void;
}

export function CartPanel({
  cart, subtotalCents, taxCents, totalCents, taxLabel, providerViolation, disabled, busy, onRemove, onCheckout,
}: CartPanelProps) {
  return (
    <aside className="cart-panel" aria-labelledby="cart-title">
      <div className="cart-heading">
        <div>
          <p className="eyebrow">Step 3</p>
          <h2 id="cart-title">Your cart</h2>
        </div>
        <span className="cart-count" aria-label={`${cart.length} items`}>{cart.length}</span>
      </div>
      {cart.length === 0 ? (
        <div className="empty-cart">
          <span aria-hidden="true">♔</span>
          <p>Your selected doors will appear here.</p>
        </div>
      ) : (
        <ul className="cart-lines">
          {cart.map((line) => (
            <li className={line.conflict ? "cart-line conflict" : "cart-line"} key={line.doorId}>
              <span className="cart-door">{line.doorId}</span>
              <span><strong>{line.productName}</strong><small>{line.conflict ? "Replace this door" : formatMoney(line.priceCents)}</small></span>
              <button type="button" onClick={() => onRemove(line)} disabled={disabled} aria-label={`Remove door ${line.doorId}`}>×</button>
            </li>
          ))}
        </ul>
      )}
      <dl className="totals">
        <div><dt>Subtotal</dt><dd>{formatMoney(subtotalCents)}</dd></div>
        <div><dt>{taxLabel}</dt><dd>{taxCents === null ? "Rechecking" : formatMoney(taxCents)}</dd></div>
        <div className="grand-total"><dt>Total</dt><dd>{totalCents === null ? "—" : formatMoney(totalCents)}</dd></div>
      </dl>
      {providerViolation && (
        <p className="inline-alert" role="alert">
          {providerViolation === "ITEM_LIMIT" ? "This cart has more items than the payment terminal allows." : "This cart total exceeds the payment terminal limit."}
        </p>
      )}
      <button
        type="button"
        className="primary-action checkout-action"
        disabled={disabled || busy || cart.length === 0 || cart.some((line) => line.conflict) || providerViolation !== null || totalCents === null}
        onClick={onCheckout}
      >
        {busy ? "Securing order…" : totalCents === null ? "Checking tax…" : `Checkout · ${formatMoney(totalCents)}`}
      </button>
      <p className="checkout-note">One Nayax payment · exact doors rechecked before payment</p>
    </aside>
  );
}
