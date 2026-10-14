import { useRouter } from 'next/router';
import LabelSheets from '../components/LabelSheets';
import { Unavailable } from '../components/Shell';
import { pageAccess } from '../lib/server/runtime.mjs';
export function getServerSideProps(ctx) { return pageAccess(ctx); }
export default function LabelsPage({ staff, unavailable, accessFailure, manualEnabled }) {
  const router = useRouter();
  return unavailable || !manualEnabled ? <Unavailable accessFailure={accessFailure ?? (!unavailable ? { kind: 'FEATURE_DISABLED' } : undefined)} /> : <LabelSheets staff={staff} initialCardId={typeof router.query.cardId === 'string' ? router.query.cardId : null} />;
}
