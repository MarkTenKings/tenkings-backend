import { FormEvent, useState } from "react";
import {
  CardCvcElement,
  CardExpiryElement,
  CardNumberElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";

interface StripeCheckoutProps {
  clientSecret: string;
  paymentIntentId: string;
  onSuccess: (paymentIntentId: string) => Promise<void> | void;
}

export default function StripeCheckout({ clientSecret, paymentIntentId, onSuccess }: StripeCheckoutProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "processing" | "succeeded">("idle");
  const [info, setInfo] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!stripe || !elements) {
      setError("Stripe is not ready yet. Please try again in a moment.");
      return;
    }
    const card = elements.getElement(CardNumberElement);
    if (!card) {
      setError("Unable to find card element");
      return;
    }

    setSubmitting(true);
    setError(null);
    setInfo(null);
    setStatus("processing");
    try {
      const result = await stripe.confirmCardPayment(clientSecret, {
        payment_method: {
          card,
        },
      });

      if (result.error) {
        setError(result.error.message ?? "Payment failed");
        setStatus("idle");
        setSubmitting(false);
        return;
      }

      const paymentIntent = result.paymentIntent;
      if (!paymentIntent) {
        setInfo("Payment submitted. Awaiting confirmation.");
        setStatus("processing");
        setSubmitting(false);
        return;
      }

      switch (paymentIntent.status) {
        case "succeeded": {
          setStatus("succeeded");
          setInfo("Payment confirmed. Finalizing your pack…");
          await onSuccess(paymentIntentId);
          card.clear();
          elements.getElement(CardExpiryElement)?.clear();
          elements.getElement(CardCvcElement)?.clear();
          break;
        }
        case "processing": {
          setStatus("processing");
          setInfo("Payment is processing. We’ll refresh as soon as Stripe confirms.");
          break;
        }
        case "requires_action": {
          setStatus("processing");
          setInfo("Additional authentication required. Check the popup to finish verifying your card.");
          break;
        }
        default: {
          setStatus("idle");
          setError(`Payment status: ${paymentIntent.status}`);
          break;
        }
      }
      setSubmitting(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected payment error");
      setStatus("idle");
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="grid w-full max-w-[520px] gap-3" style={{ gridAutoRows: "max-content" }}>
      <div className="rounded-2xl border border-white/10 bg-white/95 p-3 shadow-sm">
        <CardNumberElement
          options={{
            placeholder: "Card number",
            style: {
              base: {
                fontSize: "16px",
                color: "#0f172a",
                fontFamily: '"Helvetica Neue", Helvetica, sans-serif',
                letterSpacing: "0.08em",
                lineHeight: "1.6",
                "::placeholder": { color: "#94a3b8" },
              },
              invalid: {
                color: "#b91c1c",
              },
            },
          }}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/95 p-3 shadow-sm">
          <CardExpiryElement
            options={{
              placeholder: "MM / YY",
              style: {
                base: {
                  fontSize: "16px",
                  color: "#0f172a",
                  fontFamily: '"Helvetica Neue", Helvetica, sans-serif',
                  letterSpacing: "0.08em",
                  lineHeight: "1.6",
                  "::placeholder": { color: "#94a3b8" },
                },
                invalid: {
                  color: "#b91c1c",
                },
              },
            }}
          />
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/95 p-3 shadow-sm">
          <CardCvcElement
            options={{
              placeholder: "CVC",
              style: {
                base: {
                  fontSize: "16px",
                  color: "#0f172a",
                  fontFamily: '"Helvetica Neue", Helvetica, sans-serif',
                  letterSpacing: "0.08em",
                  lineHeight: "1.6",
                  "::placeholder": { color: "#94a3b8" },
                },
                invalid: {
                  color: "#b91c1c",
                },
              },
            }}
          />
        </div>
      </div>
      {info && (
        <p style={{ color: status === "succeeded" ? "green" : "#4b5563", margin: 0 }}>{info}</p>
      )}
      {error && <p style={{ color: "#c00", margin: 0 }}>{error}</p>}
      <button
        type="submit"
        disabled={submitting || !stripe || status === "succeeded"}
        className="w-full rounded-full border border-gold-500/60 bg-gold-500 px-6 py-3 text-sm font-semibold uppercase tracking-[0.28em] text-night-900 shadow-glow transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:border-white/15 disabled:bg-white/10 disabled:text-slate-500"
      >
        {submitting ? "Processing…" : status === "succeeded" ? "Payment complete" : "Confirm Payment"}
      </button>
    </form>
  );
}
