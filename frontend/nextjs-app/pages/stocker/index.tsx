import Head from "next/head";
import { useRouter } from "next/router";
import { FormEvent, useEffect, useState } from "react";
import { setAuthToken } from "../../lib/api";
import { TEN_KINGS_COLLECTIBLES_CROWN_PATH } from "../../lib/tenKingsBrand";
import { useSession } from "../../hooks/useSession";

function normalizePhoneInput(input: string) {
  const trimmed = input.trim();
  if (trimmed.startsWith("+")) return `+${trimmed.slice(1).replace(/[^0-9]/g, "")}`;
  const digits = trimmed.replace(/[^0-9]/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits ? `+${digits}` : "";
}

export default function StockerLoginPage() {
  const router = useRouter();
  const { session, loading } = useSession();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && session?.token) {
      fetch("/api/stocker/profile", { headers: { Authorization: `Bearer ${session.token}` } })
        .then((response) => {
          if (response.ok) void router.replace("/stocker/dashboard");
        })
        .catch(() => undefined);
    }
  }, [loading, router, session?.token]);

  const handleSendCode = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const normalizedPhone = normalizePhoneInput(phone);
      const response = await fetch("/api/stocker/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: normalizedPhone }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.message ?? payload?.error?.message ?? "Unable to send code");
      setPhone(normalizedPhone);
      setStep("code");
      setMessage("Code sent.");
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Unable to send code");
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/stocker/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: normalizePhoneInput(phone), code: code.trim() }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.message ?? payload?.error?.message ?? "Verification failed");
      const data = payload.data;
      const sessionPayload = {
        token: data.token,
        expiresAt: data.expiresAt,
        user: data.user,
        wallet: data.wallet ?? { id: "", balance: 0 },
      };
      window.localStorage.setItem("tenkings.session", JSON.stringify(sessionPayload));
      setAuthToken(data.token);
      await router.replace("/stocker/dashboard");
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : "Verification failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Head>
        <title>Stocker Portal | Ten Kings</title>
      </Head>
      <main className="flex min-h-screen items-center justify-center bg-[#0a0a0a] px-5 text-white">
        <section className="w-full max-w-sm text-center">
          <svg viewBox="0 0 64 40" aria-hidden className="mx-auto h-14 w-20 text-[#d4a843]">
            <path d={TEN_KINGS_COLLECTIBLES_CROWN_PATH} fill="currentColor" />
          </svg>
          <h1 className="mt-5 font-heading text-3xl font-semibold text-[#d4a843]">STOCKER PORTAL</h1>
          <p className="mt-2 text-sm uppercase tracking-[0.2em] text-zinc-500">Ten Kings Operations</p>

          <form onSubmit={step === "phone" ? handleSendCode : handleVerify} className="mt-10 space-y-4 text-left">
            <label className="block text-xs uppercase tracking-[0.18em] text-zinc-500">
              Phone Number
              <input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+1 (555) 123-4567"
                inputMode="tel"
                className="mt-2 w-full rounded-md border border-zinc-800 bg-[#111] px-4 py-3 text-base text-white outline-none focus:border-[#d4a843]"
              />
            </label>
            {step === "code" ? (
              <label className="block text-xs uppercase tracking-[0.18em] text-zinc-500">
                Verification Code
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder="000000"
                  inputMode="numeric"
                  className="mt-2 w-full rounded-md border border-zinc-800 bg-[#111] px-4 py-3 text-center text-xl tracking-[0.4em] text-white outline-none focus:border-[#d4a843]"
                />
              </label>
            ) : null}
            {error ? <p className="text-sm text-red-400">{error}</p> : null}
            {message ? <p className="text-sm text-[#d4a843]">{message}</p> : null}
            <button
              type="submit"
              disabled={busy}
              className="h-14 w-full rounded-md bg-[#d4a843] font-heading text-sm font-semibold uppercase tracking-[0.14em] text-black disabled:opacity-60"
            >
              {busy ? "Please wait" : step === "phone" ? "Send Code" : "Verify"}
            </button>
            {step === "code" ? (
              <button type="button" onClick={() => setStep("phone")} className="w-full py-2 text-center text-xs uppercase tracking-[0.18em] text-zinc-500">
                Change Phone
              </button>
            ) : null}
          </form>
        </section>
      </main>
    </>
  );
}
