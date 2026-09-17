import Head from 'next/head';
import Image from 'next/image';
import Link from 'next/link';
import type { GetServerSideProps } from 'next';
import MainSiteShell from '../../components/MainSiteShell';
import styles from '../../components/MainSiteShell.module.css';
import { COLLECT_SITE_ORIGIN, MAIN_SITE_ORIGIN, isMainSiteHost, siteRouteConfig } from '../../lib/siteRoutes';

export default function MainHome() {
  return <MainSiteShell><Head><title>Ten Kings · Cards and inventory</title><meta name="description" content="Open your Ten Kings inventory workspace, revisit your collection and find Ten Kings locations." /><link rel="canonical" href={`${MAIN_SITE_ORIGIN}/`} /><meta property="og:title" content="Ten Kings Collectibles" /><meta property="og:description" content="Your cards. All in one place." /><meta property="og:url" content={`${MAIN_SITE_ORIGIN}/`} /><meta property="og:type" content="website" /></Head>
    <section className={styles.hero}><div><p className={styles.eyebrow}>Your Ten Kings workspace</p><h1>Your cards.<br /><em>All in one place.</em></h1><p className={styles.intro}>Add inventory, manage your cards and open the Ten Kings tools you use.</p><div className={styles.actions}><Link className={styles.primary} href="/staff">Open staff workspace <span aria-hidden="true">↗</span></Link><a className={styles.secondary} href={`${COLLECT_SITE_ORIGIN}/collection`}>My collection</a></div><p className={styles.heroNote}>SPORTS CARDS &nbsp; / &nbsp; POKÉMON</p></div>
      <div className={styles.packStage}><Image src="/images/100-sports-pack-tier.png" width={1512} height={2016} alt="Ten Kings sports card mystery pack" sizes="(max-width: 680px) 55vw, 28vw" priority className={`${styles.pack} ${styles.packBack}`} /><Image src="/images/50-pokemon-pack-tier.png" width={1512} height={2016} alt="Ten Kings Pokémon mystery pack" sizes="(max-width: 680px) 55vw, 28vw" priority className={`${styles.pack} ${styles.packFront}`} /><span className={styles.stageLabel}>Ten Kings collectibles</span></div>
    </section>
    <section className={styles.destinations} aria-labelledby="discover-title"><div className={styles.sectionTitle}><h2 id="discover-title">Go straight to your tools.</h2><p>Choose where to start.</p></div><div className={styles.cardGrid}>
      <Link className={styles.destination} href="/staff/inventory"><span>01 / STAFF</span><h3>Add inventory.</h3><p>Photograph cards, record costs and track your stock.</p><span className={styles.arrow} aria-hidden="true">↗</span></Link>
      <a className={styles.destination} href={`${COLLECT_SITE_ORIGIN}/locations`}><span>02 / LOCATIONS</span><h3>Find a machine.</h3><p>Explore Ten Kings locations near you.</p><span className={styles.arrow} aria-hidden="true">↗</span></a>
      <a className={styles.destination} href={`${COLLECT_SITE_ORIGIN}/collection`}><span>03 / YOUR COLLECTION</span><h3>Open your collection.</h3><p>Sign in to revisit the cards in your Ten Kings collection.</p><span className={styles.arrow} aria-hidden="true">↗</span></a>
    </div></section>
  </MainSiteShell>;
}
MainHome.mainSite = true;
export const getServerSideProps: GetServerSideProps = async ({ req, res }) => {
  if (!isMainSiteHost(req.headers.host, siteRouteConfig(process.env))) return { notFound: true };
  res.setHeader('Cache-Control', 'private, no-store');
  return { props: {} };
};
