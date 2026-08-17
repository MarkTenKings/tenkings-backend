import { useEffect, useId, useState, type FormEvent } from "react";

interface PinEntryProps {
  busy: boolean;
  error: string | null;
  onAuthenticate: (userId: string, pin: string) => Promise<void>;
  onCancel: () => void;
  resumeUserId?: string | null;
  recoveryRequired?: boolean;
}

export function PinEntry({ busy, error, onAuthenticate, onCancel, resumeUserId = null, recoveryRequired = false }: PinEntryProps) {
  const userIdId = useId();
  const pinId = useId();
  const [userId, setUserId] = useState(resumeUserId ?? "");
  const [pin, setPin] = useState("");

  useEffect(() => {
    setUserId(resumeUserId ?? "");
    setPin("");
  }, [resumeUserId]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!busy && userId.trim() && /^\d{6}$/.test(pin)) void onAuthenticate(userId.trim(), pin);
  };

  return (
    <main className="service-entry-page">
      <section className="service-entry-card" aria-labelledby="service-login-title">
        <p className="eyebrow">Ten Kings staff</p>
        <h1 id="service-login-title">{recoveryRequired ? "Resume locked service" : "Service access"}</h1>
        <p>{recoveryRequired
          ? `The durable service session for ${resumeUserId ?? "this machine"} is locked. Re-enter an individual PIN to create a fresh authorized session and resume persisted work.`
          : "Use your individual machine grant. Access attempts and service actions are audited."}</p>
        <form onSubmit={submit}>
          <label htmlFor={userIdId}>Staff ID</label>
          <input
            id={userIdId}
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            autoComplete="username"
            maxLength={128}
            disabled={busy}
            readOnly={Boolean(resumeUserId)}
          />
          <label htmlFor={pinId}>Six-digit PIN</label>
          <input
            id={pinId}
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
            type="password"
            inputMode="numeric"
            pattern="\d{6}"
            autoComplete="current-password"
            maxLength={6}
            disabled={busy}
          />
          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="submit" className="primary-action" disabled={busy || !userId.trim() || pin.length !== 6}>
            {busy ? "Verifying…" : recoveryRequired ? "Reauthenticate and resume" : "Enter service mode"}
          </button>
          {!recoveryRequired && <button type="button" className="text-action" onClick={onCancel} disabled={busy}>Return to customer screen</button>}
        </form>
      </section>
    </main>
  );
}
