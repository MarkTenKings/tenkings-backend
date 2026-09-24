import ManualCards from '../../components/ManualCards';
import { Unavailable } from '../../components/Shell';
import { pageAccess } from '../../lib/server/runtime.mjs';
export async function getServerSideProps(ctx){const result=await pageAccess(ctx);if(result.props)result.props.cardId=ctx.params.cardId;return result;}
export default function ManualCard({staff,unavailable,accessFailure,manualEnabled,cardId}){return unavailable||!manualEnabled?<Unavailable accessFailure={accessFailure ?? (!unavailable ? { kind: 'FEATURE_DISABLED' } : undefined)}/>:<ManualCards key={`${staff.id}:${cardId}`} staff={staff} cardId={cardId}/>;}
