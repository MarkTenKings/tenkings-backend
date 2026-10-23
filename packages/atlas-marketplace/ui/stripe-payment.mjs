// Official Stripe.js is loaded directly from its fixed provider origin. This
// module never handles card fields, logs capabilities or writes browser storage.
const STRIPE_JS = 'https://js.stripe.com/v3/';
let scriptPromise;
const stripeInstances = new Map();
function check(value, message) { if (!value) throw new Error(message); }

export function loadStripeJs() {
  if (!scriptPromise) scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = STRIPE_JS; script.async = true; script.referrerPolicy = 'no-referrer';
    const timer = setTimeout(() => finish(new Error('Stripe payment form did not load. Reconcile the original payment before retrying.')), 20000);
    function finish(error) {
      clearTimeout(timer); script.onload = null; script.onerror = null;
      if (error) { script.remove(); scriptPromise = undefined; reject(error); }
      else resolve(globalThis.Stripe);
    }
    script.onload = () => typeof globalThis.Stripe === 'function' ? finish() : finish(new Error('Stripe payment form is unavailable.'));
    script.onerror = () => finish(new Error('Stripe payment form is unavailable.'));
    document.head.append(script);
  });
  return scriptPromise;
}

export function assertPaymentCollection(collection, expected) {
  check(collection?.strategy === 'stripe-payment-element', 'Payment collection strategy is unavailable.');
  check(collection.reservationId === expected.reservationId && collection.intentId === expected.intentId, 'Payment collection does not match the retained reservation.');
  check(Number.isSafeInteger(expected.amountCents) && expected.amountCents > 0 && collection.amountCents === expected.amountCents && collection.currency === 'USD' && expected.currency === 'USD', 'Payment collection total changed. Refresh the original order.');
  check(/^pi_[A-Za-z0-9]+$/.test(collection.paymentIntentId ?? '') && typeof collection.clientSecret === 'string' && collection.clientSecret.startsWith(`${collection.paymentIntentId}_secret_`) && collection.clientSecret.length < 500, 'Payment collection binding is unavailable.');
  const keyPattern = expected.environment === 'PRODUCTION' ? /^pk_live_[A-Za-z0-9]+$/ : /^pk_test_[A-Za-z0-9]+$/;
  check(['PRODUCTION','PROVIDER_SANDBOX','SYNTHETIC_LOCAL'].includes(expected.environment) && keyPattern.test(collection.publishableKey ?? ''), 'Payment collection environment is unavailable.');
  return { reservationId: expected.reservationId, intentId: expected.intentId, amountCents: expected.amountCents, currency: 'USD' };
}

export function createStripePaymentSession({ collection, expected, mountNode, submitButton, noticeNode, origin, returnPath='/marketplace/', onConfirmStart = () => {}, onReconcile, load = loadStripeJs, timers = globalThis }) {
  const binding = assertPaymentCollection(collection, expected);
  check(/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/$/.test(returnPath), 'Payment return path is unavailable.');
  const returnURL = new URL(returnPath, origin);
  check(returnURL.origin === origin && ['https:', 'http:'].includes(returnURL.protocol) && (returnURL.protocol === 'https:' || ['localhost','127.0.0.1'].includes(returnURL.hostname)), 'Payment return location is unavailable.');
  let clientSecret = collection.clientSecret, publishableKey = collection.publishableKey;
  collection = null;
  let disposed = false, submitting = false, ready = false, stripe, elements, paymentElement, readyTimer;
  const clearReadyTimer = () => { if (readyTimer !== undefined) { timers.clearTimeout(readyTimer); readyTimer = undefined; } };
  const notice = text => { if (!disposed) noticeNode.textContent = text; };
  const destroy = () => {
    disposed = true; ready = false; clientSecret = null; publishableKey = null;
    clearReadyTimer();
    submitButton.disabled = true;
    paymentElement?.destroy(); paymentElement = null; elements = null; stripe = null;
  };
  const initialized = (async () => {
    try {
      const factory = await load();
      if (disposed) return;
      if (!stripeInstances.has(publishableKey)) stripeInstances.set(publishableKey, factory(publishableKey));
      stripe = stripeInstances.get(publishableKey);
      elements = stripe.elements({ clientSecret, appearance: { theme: 'stripe', variables: { colorPrimary: '#047857', colorBackground: '#ffffff', colorText: '#17221e', borderRadius: '3px' } } });
      clientSecret = null;
      paymentElement = elements.create('payment', { layout: 'tabs', wallets: { link: 'never' } });
      paymentElement.on('ready', () => { if (!disposed) { clearReadyTimer(); ready = true; submitButton.disabled = false; notice('Enter your payment details securely with Stripe. Your order is confirmed only after server reconciliation.'); } });
      paymentElement.on('loaderror', () => { notice('The Stripe form could not load. Close it and reconcile the original payment.'); destroy(); });
      readyTimer = timers.setTimeout(() => {
        if (disposed || ready) return;
        notice('The Stripe form did not become ready. Close it and reconcile the original payment before reopening payment details. No payment was submitted by this form.');
        destroy();
      }, 20000);
      paymentElement.mount(mountNode);
    } catch {
      notice('Payment collection is unavailable. Close this form and reconcile the original payment.'); destroy();
    }
  })();
  async function confirm(event) {
    event?.preventDefault();
    if (disposed || submitting || !ready) return;
    submitting = true; submitButton.disabled = true;
    notice('Validating payment details…');
    let attempted = false;
    try {
      const submitted = await elements.submit();
      if (disposed) return;
      if (submitted.error) { notice('Check the highlighted payment fields before continuing.'); return; }
      onConfirmStart(binding);
      attempted = true;
      notice('Confirming the original payment. Complete any bank authentication and wait for reconciliation.');
      // Keep the mounted Element alive during 3DS. Browser/provider status is
      // never used to mark an order paid, including redirect return parameters.
      const outcome = await stripe.confirmPayment({ elements, confirmParams: { return_url: returnURL.href }, redirect: 'if_required' });
      if (disposed) return;
      notice(outcome.error ? 'Payment needs attention. Reconciling the original intent before another attempt.' : 'Confirmation returned. Reconciling the original payment with the server…');
    } catch {
      notice('The payment response is unknown. Reconcile the original payment before another attempt.');
    } finally {
      submitting = false;
      if (attempted && !disposed) {
        try { await onReconcile(binding); } catch { notice('Server reconciliation is unavailable. Return to saved state and reconcile the original payment.'); } finally { destroy(); }
      } else if (!disposed) submitButton.disabled = false;
    }
  }
  submitButton.disabled = true;
  return Object.freeze({ ready: initialized, confirm, destroy });
}
