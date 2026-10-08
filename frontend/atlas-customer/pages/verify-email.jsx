import Head from 'next/head';
import { useEffect, useRef, useState } from 'react';
import { request } from '../lib/client.mjs';
import { customerPage } from '../lib/server/page.mjs';

export default function VerifyEmail({ unavailable = false }) {
  const token = useRef(null), boot = useRef(null), running = useRef(false);
  const [state, setState] = useState('LOADING'), [error, setError] = useState(''), [resume, setResume] = useState(null);
  async function confirm(mode) {
    if (running.current || !token.current || !boot.current) return;
    running.current = true; setError('');
    try {
      const result = await request('/email/confirm', { csrf: boot.current.csrf, body: { token: token.current, mode } });
      if (!result.verified) { setState('CONFIRM'); return; }
      token.current = null; setState('VERIFIED');
      if (result.resumeDraftId) {
        const path = `/account/submit?draft=${encodeURIComponent(result.resumeDraftId)}`;
        setResume(path);
        // Reviewed server drafts do not need the camera journal. The original
        // tab may keep its upload lock without blocking this exact saved cart.
        window.location.replace(path);
      }
    } catch (failure) { setError(failure.message); setState('CONFIRM'); }
    finally { running.current = false; }
  }
  useEffect(() => {
    if (unavailable) { setState('UNAVAILABLE'); return; }
    // Tokens never enter GET requests, server logs, referrers or persistent
    // browser storage. A plain scanner GET has no verification side effect.
    if (!token.current) {
      const match = /^#token=([A-Za-z0-9_-]{43})$/.exec(window.location.hash);
      if (!match) { setState('INVALID'); return; }
      token.current = match[1]; window.history.replaceState(null, '', '/account/verify-email');
    }
    let alive = true;
    request('/session').then(value => {
      if (!alive) return; boot.current = value;
      if (value.customer) confirm('AUTO'); else setState('CONFIRM');
    }).catch(failure => { if (alive) { setError(failure.message); setState('UNAVAILABLE'); } });
    return () => { alive = false; };
  }, [unavailable]); // eslint-disable-line react-hooks/exhaustive-deps
  return <><Head><title>Verify your email · ATLAS</title><meta name="robots" content="noindex,nofollow"/></Head>
    <main className="entry"><section className="panel profile-form"><span className="eyebrow">ATLAS</span>
      <h1>{state === 'VERIFIED' ? 'Email verified.' : 'Verify your email'}</h1>
      {error && <p role="alert" className="error">{error}</p>}
      {state === 'LOADING' ? <p role="status">Opening your verification link…</p> : state === 'CONFIRM' ? <>
        <p>Confirm this email for your saved ATLAS submission. This does not sign you in.</p>
        <button type="button" className="primary" onClick={() => confirm('CONFIRM')}>Verify email</button></>
        : state === 'VERIFIED' ? <><p>{resume ? 'Opening your saved submission…' : 'Your email is verified. Return to the ATLAS submission you started to continue.'}</p>
          {resume && <a className="primary" href={resume}>Return to my saved submission</a>}</>
          : <p>This link could not be opened. Return to your original ATLAS submission to request another link.</p>}
    </section></main></>;
}
export const getServerSideProps = context => customerPage(context);
