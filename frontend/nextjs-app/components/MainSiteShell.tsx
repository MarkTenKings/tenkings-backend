import Link from 'next/link';
import type { ReactNode } from 'react';
import { TEN_KINGS_COLLECTIBLES_CROWN_PATH } from '../lib/tenKingsBrand';
import { COLLECT_SITE_ORIGIN } from '../lib/siteRoutes';
import styles from './MainSiteShell.module.css';

export function MainSiteBrand() {
  return <Link href="/" className={styles.brand} aria-label="Ten Kings home"><svg viewBox="0 0 64 40" aria-hidden="true"><path d={TEN_KINGS_COLLECTIBLES_CROWN_PATH} fill="currentColor" /></svg><span>TEN KINGS<small>COLLECTIBLES</small></span></Link>;
}
export default function MainSiteShell({ children, staff = false }: { children: ReactNode; staff?: boolean }) {
  return <div className={styles.site}>
    <a href="#main-content" className={styles.skip}>Skip to content</a>
    <header className={styles.header}><MainSiteBrand /><nav aria-label={staff ? 'Staff navigation' : 'Main navigation'}>
      {staff ? <><Link href="/staff">Staff home</Link><Link href="/">Consumer site <span aria-hidden="true">↗</span></Link></> : <><Link href="/staff">Staff workspace</Link><a href={`${COLLECT_SITE_ORIGIN}/locations`}>Find a machine</a><a href={`${COLLECT_SITE_ORIGIN}/live`}>Live rips</a><a className={styles.accountLink} href={`${COLLECT_SITE_ORIGIN}/collection`}>My collection <span aria-hidden="true">↗</span></a></>}
    </nav></header>
    <main id="main-content" className={staff ? styles.staffMain : undefined}>{children}</main>
    <footer className={styles.footer}><span>© {new Date().getFullYear()} Ten Kings</span><div><a href={`${COLLECT_SITE_ORIGIN}/privacy`}>Privacy</a><a href={`${COLLECT_SITE_ORIGIN}/terms`}>Terms</a><Link href="/staff">Staff access <span aria-hidden="true">↗</span></Link></div></footer>
  </div>;
}
