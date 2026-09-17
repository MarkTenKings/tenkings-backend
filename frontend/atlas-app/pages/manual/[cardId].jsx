import ManualCards from '../../components/ManualCards';
import { Unavailable } from '../../components/Shell';
import { pageAccess } from '../../lib/server/runtime.mjs';
export async function getServerSideProps(ctx){const result=await pageAccess(ctx);if(result.props)result.props.cardId=ctx.params.cardId;return result;}
export default function ManualCard({staff,unavailable,manualEnabled,cardId}){return unavailable||!manualEnabled?<Unavailable/>:<ManualCards key={`${staff.id}:${cardId}`} staff={staff} cardId={cardId}/>;}
