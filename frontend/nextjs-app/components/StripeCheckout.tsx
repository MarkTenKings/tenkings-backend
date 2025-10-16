import { FormEvent, useState } from "react";
import { CardElement, useElements, useStripe } from "@stripe/react-stripe-js";

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
    const card = elements.getElement(CardElement);
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
          const cardElement = elements.getElement(CardElement);
          cardElement?.clear();
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
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: "0.75rem", maxWidth: 420 }}>
      <div style={{
        padding: "0.75rem",
        border: "1px solid #ccc",
        borderRadius: "0.5rem",
        backgroundColor: "#fff",
      }}>
        <CardElement
          options={{
            style: {
              base: {
                fontSize: "16px",
                color: "#32325d",
                fontFamily: '"Helvetica Neue", Helvetica, sans-serif',
                "::placeholder": { color: "#a0aec0" },
              },
              invalid: {
                color: "#e53e3e",
              },
            },
          }}
        />
      </div>
      {info && (
        <p style={{ color: status === "succeeded" ? "green" : "#4b5563", margin: 0 }}>{info}</p>
      )}
      {error && <p style={{ color: "#c00", margin: 0 }}>{error}</p>}
      <button type="submit" disabled={submitting || !stripe || status === "succeeded"}>
        {submitting ? "Processing…" : status === "succeeded" ? "Payment complete" : "Confirm Payment"}
      </button>
    </form>
  );
}
