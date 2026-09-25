import { STAFF_BASE_PATH } from '../lib/routes.mjs';

export default function AtlasBrand({ label = 'Grading studio', detail = 'Know what you have', compact = false }) {
  return <><img src={`${STAFF_BASE_PATH}/brand/atlas-grading-logo.png`} alt="ATLAS" width="1098" height="984"/>{!compact && <span className="atlas-brand-copy">{label}<small>{detail}</small></span>}</>;
}
