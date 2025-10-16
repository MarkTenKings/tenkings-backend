import { FormEvent } from "react";

interface AuthModalProps {
  open: boolean;
  step: "phone" | "code";
  phone: string;
  code: string;
  loading: boolean;
  message: string | null;
  error: string | null;
  onPhoneChange: (value: string) => void;
  onCodeChange: (value: string) => void;
  onSendCode: () => Promise<void> | void;
  onVerifyCode: () => Promise<void> | void;
  onClose: () => void;
}

export default function AuthModal({
  open,
  step,
  phone,
  code,
  loading,
  message,
  error,
  onPhoneChange,
  onCodeChange,
  onSendCode,
  onVerifyCode,
  onClose,
}: AuthModalProps) {
  if (!open) {
    return null;
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (step === "phone") {
      onSendCode();
    } else {
      onVerifyCode();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8 backdrop-blur-sm"
    >
      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-md rounded-3xl border border-white/10 bg-night-900/90 p-8 shadow-card"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-5 top-5 rounded-full border border-white/10 p-2 text-slate-400 transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
          aria-label="Close"
        >
          ×
        </button>

        <header className="space-y-2 pb-4">
          <p className="text-xs uppercase tracking-[0.4em] text-slate-500">Secure access</p>
          <h2 className="font-heading text-3xl uppercase tracking-[0.2em] text-white">Sign in to Ten Kings</h2>
          <p className="text-sm text-slate-300">
            Enter your mobile number to continue. We’ll text you a one-time verification code.
          </p>
        </header>

        <div className="space-y-4">
          {message && <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200">{message}</p>}
          {error && <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm text-rose-200">{error}</p>}

          <label className="block text-sm text-slate-200">
            Mobile number
            <input
              value={phone}
              onChange={(event) => onPhoneChange(event.target.value)}
              placeholder="555 555 5555"
              disabled={loading || step === "code"}
              className="mt-2 w-full rounded-2xl border border-white/10 bg-night-900/80 px-4 py-3 text-base tracking-widest text-white placeholder:text-slate-500 focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/40"
              inputMode="tel"
              autoComplete="tel"
              required
            />
          </label>

          {step === "code" && (
            <label className="block text-sm text-slate-200">
              Verification code
              <input
                value={code}
                onChange={(event) => onCodeChange(event.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                placeholder="123456"
                disabled={loading}
                inputMode="numeric"
                autoComplete="one-time-code"
                className="mt-2 w-full rounded-2xl border border-white/10 bg-night-900/80 px-4 py-3 text-center text-lg tracking-[0.4em] text-white placeholder:text-slate-500 focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/40"
              />
              <p className="mt-2 text-xs text-slate-500">Paste works too—we’ll trim it to 6 digits.</p>
            </label>
          )}
        </div>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 px-6 py-3 text-xs uppercase tracking-[0.3em] text-slate-300 transition hover:border-white/20 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
            disabled={loading}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-full border border-gold-500/60 bg-gold-500 px-8 py-3 text-xs font-semibold uppercase tracking-[0.32em] text-night-900 shadow-glow transition hover:bg-gold-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold-500 disabled:cursor-not-allowed disabled:bg-gold-500/50 disabled:text-night-900/60"
            disabled={loading}
          >
            {step === "phone" ? (loading ? "Sending" : "Send Code") : loading ? "Verifying" : "Verify"}
          </button>
        </div>
      </form>
    </div>
  );
}
