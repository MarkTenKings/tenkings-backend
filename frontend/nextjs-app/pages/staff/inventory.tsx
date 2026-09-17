import Head from 'next/head';
import dynamic from 'next/dynamic';
import MainSiteShell from '../../components/MainSiteShell';
import StaffSiteGate from '../../components/StaffSiteGate';
import styles from '../../components/MainSiteShell.module.css';
import { COLLECT_SITE_ORIGIN } from '../../lib/siteRoutes';
export { mainStaffPageProps as getServerSideProps } from '../../lib/server/mainSitePage';

const StaffInventoryWorkspace = dynamic(() => import('../../components/admin/StaffInventoryWorkspace'), { ssr: false });

export default function StaffInventory() {
  return <><Head><title>Inventory | Ten Kings</title><meta name="robots" content="noindex,nofollow" /></Head><StaffSiteGate fallback={content => <MainSiteShell staff><p className={styles.eyebrow}>Team inventory</p><h1>Every card. One place.</h1>{content}</MainSiteShell>}>{session => <StaffInventoryWorkspace key={session.user.id} token={session.token} adminId={session.user.id} displayName={session.user.displayName} navigation={{ homeHref: '/staff', homeLabel: 'Staff home' }} onAdvanced={() => window.location.assign(`${COLLECT_SITE_ORIGIN}/admin/physical-inventory`)} />}</StaffSiteGate></>;
}
StaffInventory.mainSite = true;
