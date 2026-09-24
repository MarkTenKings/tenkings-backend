import ManualCards from '../../components/ManualCards';
import { Unavailable } from '../../components/Shell';
import { pageAccess } from '../../lib/server/runtime.mjs';
export function getServerSideProps(ctx){return pageAccess(ctx);}
export default function ManualPage({staff,unavailable,accessFailure,manualEnabled}){return unavailable||!manualEnabled?<Unavailable accessFailure={accessFailure ?? (!unavailable ? { kind: 'FEATURE_DISABLED' } : undefined)}/>:<ManualCards staff={staff}/>;}
