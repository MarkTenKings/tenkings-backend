import CardHistory from '../../components/CardHistory';
import Shell, { Unavailable } from '../../components/Shell';
import styles from '../../components/GradedCards.module.css';
import { historyCardId } from '../../lib/card-history-client.mjs';
import { pageAccess } from '../../lib/server/runtime.mjs';

export async function getServerSideProps(ctx) {
  const access = await pageAccess(ctx);
  if (!access.props?.staff || access.props.unavailable || !access.props.manualEnabled) return access;
  const cardId = historyCardId(ctx.params?.cardId);
  return cardId ? { props: { ...access.props, cardId } } : { notFound: true };
}
export default function CardHistoryPage({ staff, unavailable, accessFailure, manualEnabled, cardId }) {
  if (unavailable || !manualEnabled) return <Unavailable accessFailure={accessFailure ?? (!unavailable ? { kind: 'FEATURE_DISABLED' } : undefined)}/>;
  if (staff?.role !== 'REVIEWER') return <Shell staff={staff} title="Card history" manual className={styles.shell}>
    <main className={styles.page}><h1>Reviewer access required</h1><p>A reviewer staff account is required to open this card’s history.</p></main>
  </Shell>;
  return <CardHistory key={`${staff.id}:${cardId}`} staff={staff} cardId={cardId}/>;
}
