import { clearStationBrowserCredential } from '@atlas/finishing-station/browser';
import { STAFF_SIGN_IN_PATH, STAFF_REAUTHENTICATE_PATH } from '../lib/routes.mjs';
import Link from 'next/link';
import Head from 'next/head';
import { useState } from 'react';
import { useRouter } from 'next/router';
import { api } from '../lib/client';
import { stateNames } from '../lib/workspace-client.mjs';
import styles from './WorkspaceUi.module.css';
import AtlasBrand from './AtlasBrand';
export function Unavailable({ accessFailure } = {}) {
    const kind = accessFailure?.kind;
    const disabled = kind === 'DISABLED', configuration = kind === 'CONFIGURATION', feature = kind === 'FEATURE_DISABLED';
    const reference = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(accessFailure?.reference ?? '') ? accessFailure.reference : null;
    return <main className="unavailable"><Head><title>ATLAS · Access unavailable</title></Head><div className="brand">ATLAS<span>STAFF</span></div>
      <h1>{disabled ? 'Staff access is not enabled here.' : configuration ? 'Staff access needs configuration.' : feature ? 'This workspace is not enabled here.' : kind === 'METHOD_NOT_ALLOWED' ? 'Open this page again to continue.' : 'We couldn’t check your staff access.'}</h1>
      <p>{disabled ? 'Open the active ATLAS staff workspace to sign in.' : configuration || feature ? 'An administrator needs to check this workspace’s configuration.' : 'The access check did not complete. Try opening this page again, or sign in again. If this keeps happening, share the reference below with the workspace administrator.'}</p>
      <p><button type="button" className="primary" onClick={() => window.location.assign(window.location.href)}>Try again</button>{' '}
        <a href={disabled ? `https://atlasgrading.com${STAFF_REAUTHENTICATE_PATH}` : STAFF_REAUTHENTICATE_PATH}>{disabled ? 'Open staff sign-in' : 'Sign in again'}</a></p>
      {reference && <p>Reference: <code>{reference}</code></p>}
    </main>;
}
export function Notice({ children, error = false }) {
    return <div className={`notice ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>{children}</div>;
}
export default function Shell({ children, staff, title = 'Grading workspace', workspace = false, manual = false }) {
    const router = useRouter(), operations = router.pathname === '/operations', intake = router.pathname === '/add-cards';
    const activeQueue = Object.hasOwn(stateNames, router.query.queue) ? router.query.queue : 'WAITING';
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    async function logout() {
        setBusy(true);
        setError('');
        try {
            const session = await api('session');
            await api('auth/logout', { body: {}, csrf: session.csrf });
            clearStationBrowserCredential();
            window.location.replace(STAFF_SIGN_IN_PATH);
        }
        catch (e) {
            setError(e.message);
            setBusy(false);
        }
    }
    if(manual)return <div className="mc-shell"><Head><title>{`${title} · ATLAS`}</title><meta name="robots" content="noindex,nofollow"/></Head><header className="mc-shell-header"><Link href="/manual" className="atlas-brand" aria-label="ATLAS grading studio"><AtlasBrand/></Link><nav aria-label="Staff workspace"><Link href="/manual" className={router.pathname.startsWith('/manual')?'mc-nav-current':undefined}>Your cards</Link><Link href="/batch?tab=INTAKE" className={(router.pathname==='/add-cards'||router.pathname==='/batch'&&(!router.query.tab||router.query.tab==='INTAKE'))?'mc-nav-current':undefined}>+ Add cards</Link><Link href="/batch?tab=REVIEW" className={router.pathname==='/batch'&&router.query.tab==='REVIEW'?'mc-nav-current':undefined}>Review queue</Link><Link href="/station" className={router.pathname==='/station'?'mc-nav-current':undefined}>Station</Link><span className="mc-staff-name"><i aria-hidden="true"/>{staff?.name}</span><button disabled={busy} onClick={logout}>Sign out</button></nav></header>{staff?.mode!=='PRODUCTION'&&<div className="fixture-strip">Local verification environment · ordinary staff authentication · private test storage</div>}{error&&<Notice error>{error}</Notice>}{children}</div>;
    return <div className="app-shell">
    <Head><title>{`${title} · ATLAS`}</title><meta name="robots" content="noindex,nofollow"/></Head>
    <aside className="rail">
      <Link href="/grading" className="atlas-brand" aria-label="ATLAS staff grading workspace"><AtlasBrand compact/></Link>
      <div className="rail-label">GRADING</div>
      {staff?.role !== 'OBSERVER' && <Link className={`nav-item ${styles.addNav}${intake ? ' active' : ''}`} href="/add-cards"><span className="nav-icon">+</span>Add cards</Link>}
      {Object.entries(stateNames).map(([state, label]) => <Link key={state} className={`nav-item${!operations && !intake && !workspace && router.pathname === '/grading' && activeQueue === state ? ' active' : ''}`} href={`/grading?queue=${state}`}><span className="nav-icon">{state === 'WAITING' ? '▦' : state === 'APPROVED' ? '✓' : state === 'NEEDS_ATTENTION' ? '!' : '·'}</span>{label}</Link>)}
      <Link className={`nav-item${operations ? ' active' : ''}`} href="/operations"><span className="nav-icon">◇</span>Operations</Link>
      <div className="rail-footer"><div className="avatar">{staff?.name?.slice(0, 1) ?? 'A'}</div><div><strong>{staff?.name ?? 'Staff'}</strong><small>{staff?.role === 'OBSERVER' ? 'Read-only access' : 'Review staff'}</small></div><button onClick={logout} disabled={busy} title="Sign out" aria-label="Sign out">↗</button></div>
    </aside>
    <div className="app-body">
      <header className="topbar"><div><span className="breadcrumb">Staff</span><span className="crumb-slash">/</span>{workspace ? <Link href="/grading">Grading workspace</Link> : <span>{operations ? 'Operations' : intake ? 'Add cards' : 'Grading workspace'}</span>}{workspace && <><span className="crumb-slash">/</span><span>Card workspace</span></>}</div><div className="topbar-actions">{staff?.mode !== 'PRODUCTION' && <span className="local-badge"><i />{staff?.mode === 'LOCAL_FIXTURE' ? 'Persistent local preview' : 'Local preview'}</span>}<button className="mobile-signout" onClick={logout} disabled={busy} aria-label="Sign out">↗</button></div></header>
      <nav className={`mobile-navigation ${styles.mobileNav}`} aria-label="Staff workspace">{staff?.role !== 'OBSERVER' && <Link href="/add-cards" aria-current={intake ? 'page' : undefined}>Add cards</Link>}{Object.entries(stateNames).map(([state, label]) => <Link key={state} href={`/grading?queue=${state}`} aria-current={!operations && !intake && activeQueue === state ? 'page' : undefined}>{label}</Link>)}<Link href="/operations" aria-current={operations ? 'page' : undefined}>Operations</Link></nav>
      {staff?.mode !== 'PRODUCTION' && <div className="fixture-strip">Synthetic cards &amp; sign-in <span>·</span> {staff?.mode === 'LOCAL_FIXTURE' ? 'Drafts are saved in this local database and survive app restarts.' : 'Drafts stay in this local process and reset when it stops.'}</div>}
      {error && <Notice error>{error}</Notice>}
      {children}
    </div>
  </div>;
}
