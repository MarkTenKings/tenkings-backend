import { STAFF_SIGN_IN_PATH } from '../lib/routes.mjs';
import Link from 'next/link';
import Head from 'next/head';
import { useState } from 'react';
import { useRouter } from 'next/router';
import { api } from '../lib/client';
import { stateNames } from '../lib/workspace-client.mjs';
import styles from './WorkspaceUi.module.css';
export function Unavailable() {
    return <main className="unavailable"><Head><title>ATLAS · Access unavailable</title></Head><div className="brand">ATLAS<span>STAFF</span></div><h1>Staff access is not enabled here.</h1><p>Open the active ATLAS staff workspace to sign in.</p></main>;
}
export function Notice({ children, error = false }) {
    return <div className={`notice ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>{children}</div>;
}
export default function Shell({ children, staff, title = 'Grading workspace', workspace = false }) {
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
            window.location.replace(STAFF_SIGN_IN_PATH);
        }
        catch (e) {
            setError(e.message);
            setBusy(false);
        }
    }
    return <div className="app-shell">
    <Head><title>{`${title} · ATLAS`}</title><meta name="robots" content="noindex,nofollow"/></Head>
    <aside className="rail">
      <Link href="/grading" className="brand" aria-label="ATLAS staff grading workspace">ATLAS<span>STAFF WORKSPACE</span></Link>
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
