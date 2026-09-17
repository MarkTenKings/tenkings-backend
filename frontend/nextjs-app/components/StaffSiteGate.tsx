import { useEffect, useState, type ReactNode } from 'react';
import { useSession, type SessionPayload } from '../hooks/useSession';
import styles from './MainSiteShell.module.css';

type Access = { token: string; userId: string; status: 'allowed'; displayName: string | null } | { token: string; userId: string; status: 'expired' | 'denied' | 'unavailable' };

/** Browser allowlists are not authority. Mount private tools only after the server checks this exact session. */
export default function StaffSiteGate({ children, fallback = content => content }: { children: (session: SessionPayload) => ReactNode; fallback?: (content: ReactNode) => ReactNode }) {
  const { session, loading, ensureSession, logout } = useSession();
  const [access, setAccess] = useState<Access | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loginError, setLoginError] = useState('');
  const token = session?.token, userId = session?.user.id;
  useEffect(() => {
    if (!token || !userId) return;
    const controller = new AbortController();
    let current = true;
    setAccess(null);
    void (async () => {
      try {
        const response = await fetch('/api/v2/admin/inventory/access', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal });
        if (!current) return;
        if (!response.ok) { setAccess({ token, userId, status: response.status === 401 ? 'expired' : response.status === 403 ? 'denied' : 'unavailable' }); return; }
        const payload: unknown = await response.json();
        if (!current) return;
        const user = payload && typeof payload === 'object' && 'user' in payload ? payload.user : null;
        if (!user || typeof user !== 'object' || !('id' in user) || user.id !== userId || !('displayName' in user) || (user.displayName !== null && typeof user.displayName !== 'string')) throw new Error('Invalid access response');
        setAccess({ token, userId, status: 'allowed', displayName: user.displayName });
      } catch {
        if (current) setAccess({ token, userId, status: 'unavailable' });
      }
    })();
    return () => { current = false; controller.abort(); };
  }, [token, userId, attempt]);
  const login = async (force = false) => {
    setLoginError('');
    try { await ensureSession({ force, message: 'Sign in with your Ten Kings staff account.' }); }
    catch { setLoginError('Sign-in was not completed. You can try again.'); }
  };
  if (loading) return <>{fallback(<p role="status" className={styles.status}>Loading your session…</p>)}</>;
  if (!session) return <>{fallback(<><p className={styles.staffIntro}>Sign in with your authorized Ten Kings account to open the team workspace.</p><div className={styles.actions}><button className={styles.primary} onClick={() => void login()}>Sign in to staff</button></div>{loginError && <p role="alert" className={styles.error}>{loginError}</p>}</>)}</>;
  const current = access && access.token === token && access.userId === userId ? access : null;
  if (!current) return <>{fallback(<p role="status" className={styles.status}>Checking staff access…</p>)}</>;
  if (current.status === 'allowed') return <>{children({ ...session, user: { ...session.user, displayName: current.displayName } })}</>;
  return <>{fallback(<><p role="alert" className={current.status === 'unavailable' ? styles.error : styles.status}>{current.status === 'expired' ? 'Your session has expired. Sign in again to continue.' : current.status === 'denied' ? 'This account does not have inventory access. Use your authorized Ten Kings account.' : 'Staff access could not be checked. Your saved inventory work is preserved.'}</p><div className={styles.actions}>{current.status === 'unavailable' ? <button className={styles.primary} onClick={() => setAttempt(value => value + 1)}>Try again</button> : <button className={styles.primary} onClick={() => void login(true)}>Sign in again</button>}<button className={styles.secondary} onClick={logout}>Sign out</button></div>{loginError && <p role="alert" className={styles.error}>{loginError}</p>}</>)}</>;
}
