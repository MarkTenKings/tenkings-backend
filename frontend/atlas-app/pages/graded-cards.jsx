import GradedCards from '../components/GradedCards';
import Shell, { Unavailable } from '../components/Shell';
import styles from '../components/GradedCards.module.css';
import { pageAccess } from '../lib/server/runtime.mjs';
export function getServerSideProps(ctx) { return pageAccess(ctx); }
export default function GradedCardsPage({ staff, unavailable, accessFailure, manualEnabled }) {
  if (unavailable || !manualEnabled) return <Unavailable accessFailure={accessFailure ?? (!unavailable ? { kind: 'FEATURE_DISABLED' } : undefined)}/>;
  if (staff?.role !== 'REVIEWER') return <Shell staff={staff} title="Graded cards" manual className={styles.shell}>
    <main className={styles.page}><h1>Reviewer access required</h1><p>A reviewer staff account is required to open the graded-card archive.</p></main>
  </Shell>;
  return <GradedCards staff={staff}/>;
}
