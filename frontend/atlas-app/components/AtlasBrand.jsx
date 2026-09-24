import { STAFF_BASE_PATH } from '../lib/routes.mjs';

export default function AtlasBrand({ label = 'Grading studio', detail = 'Know what you have', compact = false }) {
  return <><img src={`${STAFF_BASE_PATH}/brand/atlas-brand.png`} alt="ATLAS" width="124" height="70"/>{!compact && <span className="atlas-brand-copy">{label}<small>{detail}</small></span>}</>;
}
