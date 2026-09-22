import { STAFF_GRADING_PATH } from '../lib/routes.mjs';
import Head from 'next/head';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/client';
import { Notice, Unavailable } from '../components/Shell';
import AtlasBrand from '../components/AtlasBrand';
import { pageAccess } from '../lib/server/runtime.mjs';
export async function getServerSideProps(ctx) {
    const result = await pageAccess(ctx, { authenticated: false });
    return result.props ? { ...result, props: { ...result.props, reauthenticate: ctx.query.reauthenticate === '1' } } : result;
}
export default function SignIn({ unavailable, mode, reauthenticate = false }) { return unavailable ? <Unavailable /> : <SignInForm mode={mode} reauthenticate={reauthenticate}/>; }
function SignInForm({ mode, reauthenticate }) {
    const local = mode !== 'PRODUCTION';
    const [phone, setPhone] = useState('');
    const [code, setCode] = useState('');
    const [csrf, setCsrf] = useState('');
    const [challenge, setChallenge] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const request = useRef(null);
    useEffect(() => {
        const controller = new AbortController();
        api(`session${reauthenticate ? '?reauthenticate=1' : ''}`, { signal: controller.signal }).then(s => {
            if (s.staff && !reauthenticate)
                window.location.replace(STAFF_GRADING_PATH);
            else
                setCsrf(s.csrf);
        }).catch(e => { if (!controller.signal.aborted)
            setError(e.message); });
        return () => controller.abort();
    }, [reauthenticate]);
    async function submit(event) {
        event.preventDefault();
        setBusy(true);
        setError('');
        try {
            if (!challenge) {
                request.current ??= { phone: phone.trim(), requestId: crypto.randomUUID() };
                const result = await api('auth/request', { body: request.current, csrf });
                setChallenge(result);
                setCode('');
            }
            else {
                await api('auth/verify', { body: { challengeId: challenge.challengeId, code }, csrf });
                window.location.replace(STAFF_GRADING_PATH);
            }
        }
        catch (e) {
            setError(e.message);
        }
        finally {
            setBusy(false);
        }
    }
    return <main className="login-page">
    <Head><title>Staff sign-in · ATLAS</title></Head>
    <section className="login-story"><div className="atlas-brand"><AtlasBrand/></div><div className="login-orbit" aria-hidden="true"><div /><div /><div /><span>✧</span></div><div><p className="eyebrow">THE ART OF CERTAINTY</p><h1>Every detail.<br /><em>Made clear.</em></h1><p>The photographs. The findings. The full story.<br />Your workspace for considered grading.</p></div><small>ATLAS GRADING · STAFF ACCESS</small></section>
    <section className="login-form-section"><div className="login-form-wrap">{local && <span className="local-badge"><i />{mode === 'LOCAL_FIXTURE' ? 'Persistent local preview' : 'Local preview'}</span>}<h2>{challenge ? 'Enter your code' : 'Welcome to ATLAS'}</h2><p className="muted">{challenge ? 'Use the six-digit code for this sign-in attempt.' : 'Sign in with an owner-approved staff phone number.'}</p>
      {reauthenticate && <p className="field-help">Complete a fresh sign-in, then return to your open workspace and refresh access or retry the saved request.</p>}
      <form onSubmit={submit}>
        {challenge ? <><label htmlFor="code">Verification code</label><input id="code" name="code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoFocus value={code} onChange={e => setCode(e.target.value)} required placeholder="000000" className="code-input"/><p className="field-help">Use the most recent code for this sign-in attempt.</p></> : <><label htmlFor="phone">Phone number</label><input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={48} value={phone} onChange={e => { setPhone(e.target.value); request.current = null; }} required placeholder="(202) 555-0141" aria-describedby="phone-help"/><p className="field-help" id="phone-help">U.S. number? Enter 10 digits—we add +1. For another country, include its country code.</p></>}
        {error && <Notice error>{error}</Notice>}
        <button className="primary full" disabled={busy || !csrf} type="submit">{busy ? 'Please wait…' : challenge ? 'Verify & open workspace' : 'Request sign-in code'}<span>→</span></button>
        {challenge && <button type="button" className="text-button" disabled={busy} onClick={() => { setChallenge(null); request.current = null; setError(''); }}>Use a different number</button>}
      </form>
      {local && <div className="demo-guide"><strong>Try the local review</strong><p>Sample number <button className="inline-code" onClick={() => { setPhone('+12025550141'); request.current = null; }} disabled={Boolean(challenge)}>+12025550141</button><br />Sample code <code>424242</code></p><small>These are fictional credentials. No text message is sent.</small></div>}
      <p className="login-footnote">Staff access and grade certification are separate.{local && <><br />{mode === 'LOCAL_FIXTURE' ? 'Reviews and report approvals use synthetic demonstration cards.' : 'This basic preview saves draft notes only.'}</>}</p>
    </div></section>
  </main>;
}
