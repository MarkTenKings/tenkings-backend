/* eslint-disable @next/next/no-html-link-for-pages -- Public home/report links intentionally leave the /account application. */
import Head from 'next/head';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { request } from '../lib/client.mjs';
import { STAGES, milestones, summary } from '../lib/progress.mjs';
import { retainSubmission, readRetainedSubmission, clearRetainedSubmission } from '../lib/pending-submission.mjs';

const emptyProfile = { name: '', address1: '', address2: '', city: '', region: '', postalCode: '', country: 'US' };
const stageLabel = value => STAGES.find(([key]) => key === value)?.[1] ?? 'Progress unavailable';
const when = value => new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
function ReturnFields({ value, onChange, disabled }) {
    const fields = [ ['name', 'Full name', 'name', 120], ['address1', 'Street address', 'address-line1', 200],
        ['address2', 'Apartment, suite, etc. (optional)', 'address-line2', 200], ['city', 'City', 'address-level2', 100],
        ['region', 'State / province / region', 'address-level1', 100], ['postalCode', 'Postal code', 'postal-code', 30],
        ['country', 'Country code', 'country', 2] ];
    return <div className="fields">{fields.map(([key, label, autocomplete, max]) => <label key={key} className={['name', 'address1', 'address2'].includes(key) ? 'wide' : ''}>
        <span>{label}</span><input value={value[key]} autoComplete={`shipping ${autocomplete}`} maxLength={max}
            required={!['address2', 'region'].includes(key)} disabled={disabled} onChange={event => onChange({ ...value, [key]: event.target.value })}
            {...(key === 'country' ? { placeholder: 'US', pattern: '[A-Za-z]{2}', style: { textTransform: 'uppercase' } } : {})}/>
    </label>)}</div>;
}
function Address({ profile }) {
    return <address>{profile.name}<br/>{profile.address1}<br/>{profile.address2 && <>{profile.address2}<br/></>}
        {profile.city}, {profile.region} {profile.postalCode}<br/>{profile.country}</address>;
}
function CardProgress({ card }) {
    return <article className="card-progress">
        <div className="card-heading"><div><span className="eyebrow">{card.category === 'POKEMON' ? 'Pokémon' : 'Sports card'}</span><h3>{card.title}</h3></div>
            <span className="status">{stageLabel(card.stage)}</span></div>
        {card.actionNeeded && <div className="action-needed" role="status"><strong>Your attention is needed</strong><p>{card.actionNeeded.message}</p></div>}
        <ol className="tracker" aria-label={`Recorded progress for ${card.title}`}>{milestones(card).map(step => <li key={step.kind} className={step.recordedAt ? 'recorded' : ''}>
            <span className="tracker-dot" aria-hidden="true">{step.recordedAt ? '✓' : ''}</span><strong>{step.label}</strong>
            <small>{step.recordedAt ? when(step.recordedAt) : 'Not recorded'}</small></li>)}</ol>
        {card.reportUrl && <a className="text-link" href={card.reportUrl}>View approved report <span aria-hidden="true">↗</span></a>}
        {card.shipment && <p className="shipment">Shipped with {card.shipment.carrier}. Tracking: <strong>{card.shipment.trackingNumber}</strong></p>}
    </article>;
}
function SubmissionDetail({ submission }) {
    return <><div className="section-heading"><div><span className="eyebrow">Your submission</span><h1>{submission.reference}</h1><p>Created {when(submission.createdAt)} · {submission.cards.length} {submission.cards.length === 1 ? 'card' : 'cards'}</p></div><Link href="/" className="secondary">All submissions</Link></div>
        <div className="notice"><strong>{submission.intakeMethod === 'MAIL_IN' ? 'Mail-in submission' : 'Dealer drop-off submission'}</strong><p>Your submission is recorded. Follow ATLAS intake instructions before handing over or sending your cards. {submission.cards.every(card => card.stage === 'SUBMITTED') ? 'Receipt has not yet been confirmed.' : ''}</p></div>
        <div className="section-heading compact"><h2>Every card, every step</h2><p>Progress reflects recorded events. Dates are not delivery estimates.</p></div>
        {submission.cards.map(card => <CardProgress key={card.id} card={card}/>)}
        <section className="panel return-snapshot"><div><h2>Confirmed shipping / return details</h2><p>Saved for this submission. Future profile edits apply to future submissions.</p></div><Address profile={submission.profileSnapshot}/></section>
    </>;
}
export default function AccountWorkspace({ initialView = 'dashboard', submissionId = null, unavailable = false }) {
    const [customer, setCustomer] = useState(null), [csrf, setCsrf] = useState(''), [ready, setReady] = useState(false), [mode, setMode] = useState('');
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
    const [phone, setPhone] = useState(''), [code, setCode] = useState(''), [challenge, setChallenge] = useState(null);
    const [submissions, setSubmissions] = useState([]), [nextCursor, setNextCursor] = useState(null), [detail, setDetail] = useState(null);
    const [profile, setProfile] = useState(emptyProfile), [cards, setCards] = useState([{ title: '', category: 'SPORTS' }]);
    const [intakeMethod, setIntakeMethod] = useState('DEALER_DROP_OFF'), [confirmed, setConfirmed] = useState(false), [retained, setRetained] = useState(false);
    const started = useRef(false), active = useRef(false), sendRequest = useRef(null), submitRequest = useRef(null), submitUncertain = useRef(false);
    const load = useCallback(async value => {
        setCustomer(value); setProfile(value.profile ?? emptyProfile);
        if (submissionId) setDetail((await request(`/submissions/${submissionId}`)).submission);
        else { const list = await request('/submissions'); setSubmissions(list.submissions); setNextCursor(list.nextCursor); }
        const pending = readRetainedSubmission(window.sessionStorage, value.id);
        if (pending) {
            submitRequest.current = pending.submission; submitUncertain.current = true; setRetained(true);
            if (initialView === 'submit') {
                setProfile(pending.submission.profile); setCards(pending.submission.cards);
                setIntakeMethod(pending.submission.intakeMethod); setConfirmed(pending.submission.confirmed);
            }
            try {
                const saved = await request(`/submission-requests/${pending.submission.requestId}`);
                clearRetainedSubmission(window.sessionStorage); submitRequest.current = null; submitUncertain.current = false; setRetained(false);
                if (initialView === 'submit') window.location.replace(`/account/submissions/${saved.submission.id}`);
            } catch (failure) {
                if (failure.code !== 'NOT_FOUND') throw failure;
                setNotice('A previous submission is waiting for confirmation. Open Submit cards to retry the same saved request.');
            }
        }
    }, [submissionId, initialView]);
    const run = useCallback(async work => {
        if (active.current) return;
        active.current = true; setBusy(true); setError(''); setNotice('');
        try { await work(); } catch (failure) { setError(failure.message); }
        finally { active.current = false; setBusy(false); }
    }, []);
    useEffect(() => {
        if (unavailable) { setReady(true); return; }
        if (started.current) return; started.current = true;
        run(async () => { try {
            const boot = await request('/session'); setCsrf(boot.csrf); setMode(boot.mode);
            if (boot.customer) await load(boot.customer);
        } finally { setReady(true); } });
    }, [load, run, unavailable]);
    useEffect(() => {
        const hide = () => { document.body.style.visibility = 'hidden'; };
        const show = event => { if (event.persisted) window.location.reload(); };
        // A history snapshot must not resurrect private account content after
        // logout in another page. A restored document obtains a fresh session.
        window.addEventListener('pagehide', hide); window.addEventListener('pageshow', show);
        return () => { window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', show); };
    }, []);
    function send(event) {
        event.preventDefault();
        run(async () => {
            if (!sendRequest.current || sendRequest.current.phone !== phone) sendRequest.current = { phone, requestId: crypto.randomUUID() };
            const result = await request('/auth/request', { body: sendRequest.current, csrf }); setChallenge(result); setCode('');
        });
    }
    function verify(event) {
        event.preventDefault();
        run(async () => {
            const result = await request('/auth/verify', { body: { challengeId: challenge.challengeId, code }, csrf });
            setCsrf(result.csrf); setChallenge(null); setCode(''); await load(result.customer);
        });
    }
    async function resend() {
        sendRequest.current = { phone, requestId: crypto.randomUUID() };
        const result = await request('/auth/request', { body: sendRequest.current, csrf }); setChallenge(result); setCode('');
    }
    function submit(event) {
        event.preventDefault();
        run(async () => {
            if (!submitRequest.current) submitRequest.current = { requestId: crypto.randomUUID(), profile, cards, intakeMethod, confirmed };
            retainSubmission(window.sessionStorage, customer.id, submitRequest.current, submitUncertain.current);
            setRetained(true);
            try {
                const result = await request('/submissions', { body: submitRequest.current, csrf });
                clearRetainedSubmission(window.sessionStorage);
                window.location.assign(`/account/submissions/${result.submission.id}`);
            } catch (failure) {
                if (!submitUncertain.current && ['INVALID_SUBMISSION', 'RETURN_DETAILS_REQUIRED', 'INVALID_REQUEST'].includes(failure.code)) {
                    clearRetainedSubmission(window.sessionStorage); submitRequest.current = null; setRetained(false);
                } else {
                    submitUncertain.current = true;
                    retainSubmission(window.sessionStorage, customer.id, submitRequest.current, true);
                }
                throw failure;
            }
        });
    }
    const signedIn = Boolean(customer);
    if (unavailable) return <><Head><title>Account unavailable · ATLAS Grading</title><meta name="robots" content="noindex,nofollow"/></Head>
        <main className="workspace"><span className="eyebrow">ATLAS Grading</span><h1>Account access is unavailable.</h1><p>Please return to ATLAS and try again later.</p><a href="https://atlasgrading.com/" className="secondary">Return to ATLAS</a></main></>;
    return <><Head><title>{signedIn ? 'Your account' : 'Sign in'} · ATLAS Grading</title><meta name="robots" content="noindex,nofollow"/></Head>
        <header className="site-header"><a href="/" className="brand" aria-label="ATLAS Grading home"><span className="brand-mark" aria-hidden="true">A</span><span>ATLAS<small>GRADING</small></span></a>
            {signedIn ? <nav aria-label="Account"><Link href="/">Your cards</Link><Link href="/profile">Return details</Link><button disabled={busy} onClick={() => run(async () => { await request('/auth/logout', { body: {}, csrf }); clearRetainedSubmission(window.sessionStorage); window.location.assign('/account'); })}>Sign out</button></nav> : <a href="/" className="home-link">Back to ATLAS</a>}</header>
        <main className={signedIn ? 'workspace' : 'entry'}>
            {mode === 'LOCAL_FIXTURE' && <div className="fixture-banner">Local demonstration · Synthetic SMS code: 424242 · No real submission or SMS delivery</div>}
            {error && <div className="error" role="alert">{error}</div>}{notice && <div className="notice" role="status">{notice}</div>}
            {!ready ? <p role="status" className="loading">Opening your account…</p> : !signedIn ? <div className="sign-in-layout">
                <section className="entry-copy"><span className="eyebrow">Your collection deserves clarity</span><h1>A clear view.<br/>At every step.</h1><p>Submit your cards, follow their progress, and keep every approved ATLAS report in reach.</p><div className="entry-note">One phone number.<br/>One place for your cards.</div></section>
                <section className="panel sign-in"><span className="eyebrow">Your ATLAS account</span><h2>{challenge ? 'Check your phone' : 'Let’s get you in'}</h2>
                    {challenge ? <><p>Enter the six-digit code sent to <strong>{phone}</strong>.</p><form onSubmit={verify}><label><span>Verification code</span><input autoFocus inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} required disabled={busy}/></label>
                        <button className="primary" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Continue'}</button></form><div className="sign-in-actions"><button disabled={busy} onClick={() => run(resend)}>Send a new code</button><button disabled={busy} onClick={() => { setChallenge(null); sendRequest.current = null; setError(''); }}>Change number</button></div><p className="fine">Codes expire after five minutes. Resends are limited to one per minute.</p></> : <><p>New here or returning? Use the same simple phone sign-in.</p><form onSubmit={send}><label><span>Mobile number</span><input type="tel" autoComplete="tel" inputMode="tel" placeholder="(202) 555-0141" value={phone} onChange={event => setPhone(event.target.value)} maxLength={48} aria-describedby="phone-help" required disabled={busy}/></label><p className="fine" id="phone-help">U.S. number? Enter 10 digits—we add +1. For another country, include its country code.</p>
                        <button className="primary" disabled={busy || !phone || !csrf}>{busy ? 'Sending…' : 'Send verification code'}</button></form><p className="fine">We’ll text a verification code. A verified number creates your account automatically the first time. Message and data rates may apply.</p></>}
                </section></div> : submissionId ? detail ? <SubmissionDetail submission={detail}/> : <p role="status">Opening submission…</p> : initialView === 'submit' ? <>
                <div className="section-heading"><div><span className="eyebrow">Start a submission</span><h1>Bring your cards to ATLAS.</h1><p>Tell us what you’re submitting and confirm where your cards should return.</p></div><Link href="/" className="secondary">Your dashboard</Link></div>
                <form onSubmit={submit} className="submission-form"><section className="panel"><h2>1. Choose how to submit</h2><div className="intake-options">{[['DEALER_DROP_OFF', 'Dealer drop-off', 'Hand over your cards at an authorized ATLAS location.'], ['MAIL_IN', 'Mail-in', 'Send your cards using the confirmed ATLAS intake instructions.']].map(([value, label, description]) => <label className={intakeMethod === value ? 'intake-option selected' : 'intake-option'} key={value}><input type="radio" name="intake" value={value} checked={intakeMethod === value} disabled={busy || retained} onChange={() => setIntakeMethod(value)}/><span><strong>{label}</strong><small>{description}</small></span></label>)}</div><p className="fine">Confirm intake instructions before sending or handing over cards. This form does not book a dealer appointment or purchase postage.</p></section>
                    <section className="panel"><h2>2. Add your cards</h2><p>Enter one card per row. The ATLAS team will confirm each card’s identity at intake.</p><div className="card-fields">{cards.map((card, index) => <div className="card-row" key={index}><label><span>Card {index + 1}</span><input placeholder="Year, set, player or Pokémon, card number" value={card.title} maxLength={180} required disabled={busy || retained} onChange={event => setCards(cards.map((old, i) => i === index ? { ...old, title: event.target.value } : old))}/></label><label><span>Category</span><select value={card.category} disabled={busy || retained} onChange={event => setCards(cards.map((old, i) => i === index ? { ...old, category: event.target.value } : old))}><option value="SPORTS">Sports</option><option value="POKEMON">Pokémon</option></select></label>{cards.length > 1 && <button type="button" className="remove" disabled={busy || retained} aria-label={`Remove card ${index + 1}`} onClick={() => setCards(cards.filter((_, i) => i !== index))}>Remove</button>}</div>)}</div><button type="button" className="secondary" disabled={busy || retained || cards.length >= 25} onClick={() => setCards([...cards, { title: '', category: 'SPORTS' }])}>+ Add another card</button></section>
                    <section className="panel"><h2>3. Confirm shipping / return details</h2><p>We’ll save these details for your next submission. This submission keeps its own confirmed copy.</p><ReturnFields value={profile} onChange={setProfile} disabled={busy || retained}/></section>
                    <section className="submit-confirm"><label className="checkbox"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} required disabled={busy || retained}/><span>I confirm these card details and this shipping / return address.</span></label>
                        {retained && <p className="fine">Your exact submission request is retained. Retry uses the same request; refresh your dashboard to check whether it was recorded.</p>}
                        <button className="primary" disabled={busy || !confirmed}>{busy ? 'Recording submission…' : retained ? 'Retry this submission' : `Submit ${cards.length} ${cards.length === 1 ? 'card' : 'cards'}`}</button></section>
                </form></> : initialView === 'profile' ? <>
                <div className="section-heading"><div><span className="eyebrow">Your profile</span><h1>Shipping / return details</h1><p>Your phone is verified. Add or update these details whenever you’re ready to submit.</p></div></div>
                <form className="panel profile-form" onSubmit={event => { event.preventDefault(); run(async () => { const result = await request('/profile', { body: { profile }, csrf }); setCustomer(result.customer); setProfile(result.customer.profile); setNotice('Return details saved. Existing submission addresses are unchanged.'); }); }}><ReturnFields value={profile} onChange={setProfile} disabled={busy}/><button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save return details'}</button><p className="fine">To change the return address of an existing submission, contact the ATLAS team before shipment.</p></form></> : <>
                <div className="section-heading"><div><span className="eyebrow">Your ATLAS account</span><h1>Your cards, every step.</h1><p>Signed in with {customer.phone}</p></div><Link href="/submit" className="primary">Submit cards <span aria-hidden="true">↗</span></Link></div>
                {submissions.length === 0 ? <section className="panel empty-state"><span className="empty-mark" aria-hidden="true">◇</span><h2>Your next chapter starts here.</h2><p>Once you submit cards, their individual progress will appear in your account.</p><Link href="/submit" className="primary">Start your first submission</Link><p className="fine">We’ll ask for your name and shipping / return address when you submit.</p></section> : <><div className="section-heading compact"><h2>Your submissions</h2><button className="text-link" disabled={busy} onClick={() => run(() => load(customer))}>Refresh progress</button></div><div className="submission-list">{submissions.map(item => <Link href={`/submissions/${item.id}`} className="panel submission-item" key={item.id}><div><span className="eyebrow">{when(item.createdAt)} · {item.intakeMethod === 'MAIL_IN' ? 'Mail-in' : 'Dealer drop-off'}</span><h2>{item.reference}</h2><p>{item.cards.length} {item.cards.length === 1 ? 'card' : 'cards'}{item.cards.some(card => card.actionNeeded) && <strong className="attention-label"> · Your attention is needed</strong>}</p></div><div className="progress-summary">{summary(item.cards).map(group => <span key={group.stage}>{group.count} {group.label.toLowerCase()}</span>)}<strong aria-hidden="true">→</strong></div></Link>)}</div>{nextCursor && <button className="secondary load-more" disabled={busy} onClick={() => run(async () => { const page = await request(`/submissions?cursor=${nextCursor}`); setSubmissions(old => [...old, ...page.submissions]); setNextCursor(page.nextCursor); })}>Load more submissions</button>}</>}
            </>}
        </main><footer className="site-footer"><span>ATLAS GRADING</span><p>Progress you can follow. Reports you can inspect.</p><a href="/">Explore ATLAS</a></footer>
    </>;
}
