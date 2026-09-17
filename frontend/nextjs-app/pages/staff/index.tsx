import Head from 'next/head';
import Link from 'next/link';
import MainSiteShell from '../../components/MainSiteShell';
import StaffSiteGate from '../../components/StaffSiteGate';
import styles from '../../components/MainSiteShell.module.css';
import { useSession } from '../../hooks/useSession';
import { COLLECT_SITE_ORIGIN } from '../../lib/siteRoutes';
export { mainStaffPageProps as getServerSideProps } from '../../lib/server/mainSitePage';

export default function StaffHome() {
  const { logout } = useSession();
  return <MainSiteShell staff><Head><title>Staff | Ten Kings</title><meta name="robots" content="noindex,nofollow" /></Head><p className={styles.eyebrow}>Ten Kings team workspace</p><h1>Your staff workspace.</h1><StaffSiteGate>{session => <><p className={styles.staffIntro}>Receive cards, keep track of stock and see what is recorded at each location.</p><div className={styles.staffTools}><Link href="/staff/inventory" className={styles.destination}><span>DAILY OPERATIONS</span><h2>Inventory</h2><p>Add individual cards or batches. Review costs, locations and your team&apos;s stock history.</p><span className={styles.arrow}>Open inventory ↗</span></Link><a href={`${COLLECT_SITE_ORIGIN}/admin`} className={styles.destination}><span>SPECIALIST TOOLS</span><h2>Operations</h2><p>Open the existing grading, packing and administration workspace.</p><span className={styles.arrow}>Open operations ↗</span></a></div><div className={styles.identity}><span>Signed in as {session.user.displayName || 'Ten Kings team'}</span><button onClick={logout}>Sign out</button></div><p className={styles.staffNotice}>Continuing work from collect.tenkings.co? Finish any pending save in its original tab before entering the same cards here. Sign-in is separate on each website.</p></>}</StaffSiteGate></MainSiteShell>;
}
StaffHome.mainSite = true;
