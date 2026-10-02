import { useEffect, useRef, useState } from 'react';

export async function requestEmailVerification(request, accountId, draftId, email, { fresh = false } = {}) {
  const key = `atlas-email-request-v1:${accountId}:${draftId}`;
  // The address comes from authenticated server status, never a stale form.
  if (typeof email !== 'string' || !email) throw Error('Reload your saved submission to check its email address.');
  let retained;
  try { retained = JSON.parse(window.sessionStorage.getItem(key)); } catch { /* Old or interrupted local journal. */ }
  const requestId = !fresh && retained?.email === email && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(retained.requestId ?? '')
    ? retained.requestId : crypto.randomUUID();
  window.sessionStorage.setItem(key, JSON.stringify({ email, requestId }));
  const value = await request('/email/request', { body: { draftId, requestId } });
  window.sessionStorage.removeItem(key);
  return value;
}

export default function EmailVerificationPanel({ accountId, draftId, request, onVerified, onEdit }) {
  const [status, setStatus] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const gate = useRef(false), completed = useRef(onVerified);
  completed.current = onVerified;
  useEffect(() => {
    let alive = true;
    const read = async () => {
      try {
        const value = await request(`/email/status?draftId=${draftId}`);
        if (!alive) return;
        setStatus(value);
        if (value.verified || value.required === false) completed.current();
      } catch (failure) { if (alive) setError(failure.message); }
    };
    read();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') read(); }, 4000);
    const focus = () => read(); window.addEventListener('focus', focus);
    return () => { alive = false; clearInterval(timer); window.removeEventListener('focus', focus); };
  }, [draftId, request]);
  async function send() {
    if (gate.current) return; gate.current = true; setBusy(true); setError('');
    try {
      const value = await requestEmailVerification(request, accountId, draftId, status.email, { fresh: status.state !== 'UNSENT' });
      setStatus(value);
      if (value.verified || value.required === false) completed.current();
    } catch (failure) { setError(failure.message); }
    finally { gate.current = false; setBusy(false); }
  }
  const waiting = status?.canResendAt && Date.parse(status.canResendAt) > Date.now();
  return <section className="panel profile-form">
    <span className="eyebrow">Your receipt and updates</span><h1>Verify your email once.</h1>
    <p>Your photos and card details are saved. We’ll remember this email for future submissions.</p>
    {status?.email && <strong>{status.email}</strong>}
    {error && <p role="alert" className="error">{error}</p>}
    {!status ? <p role="status">Checking your saved email…</p> : status.state === 'UNSENT' ? <p>No verification email has been requested yet.</p>
      : status.state === 'SENT' ? <p role="status">Check your inbox for the Verify email button. This tab will continue when verification is complete.</p>
      : ['SENDING', 'UNKNOWN'].includes(status.state) ? <p role="status">The email send could not yet be confirmed. Check your inbox before requesting a fresh link. We won’t resend automatically.</p>
      : status.state === 'EXPIRED' ? <p>This link expired. Request a fresh link to continue.</p> : null}
    <div className="intake-actions"><button type="button" className="secondary" onClick={onEdit} disabled={busy}>Change email</button>
      <button type="button" className="primary" onClick={send} disabled={busy || !status || waiting}>{busy ? 'Requesting…' : waiting ? 'Please wait before resending' : status?.state === 'UNSENT' ? 'Send verification email' : 'Request a fresh link'}</button></div>
  </section>;
}
