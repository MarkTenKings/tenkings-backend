import { canonical,digest,requireThat } from '@atlas/manual-service/contract';
export function researchGrantSQL(role,receiptRole=role){
  for(const value of [role,receiptRole])requireThat(/^[a-z][a-z0-9_]{0,62}$/.test(value),500,'RESEARCH_GRANT_INVALID');
  return `GRANT SELECT,INSERT ON atlas_manual.research_effect TO "${role}";\nGRANT EXECUTE ON FUNCTION atlas_manual.append_research_receipt(uuid,uuid,integer,text,text,text) TO "${receiptRole}";`;
}
const parse=row=>{requireThat(digest(row.evidence)===row.evidence_hash,503,'RESEARCH_RECEIPT_CORRUPT');return {...row,evidence:JSON.parse(row.evidence)};};
export function createResearchJournal({boundary,repository,receiptClient}) {
  requireThat(typeof receiptClient?.$queryRawUnsafe==='function',503,'RESEARCH_RECEIPT_STORE_REQUIRED');
  async function access(staff,cardId,requestId,work){
    await repository.market(staff,cardId,requestId);
    return boundary.transaction(staff,async({tx,principal})=>{
      await tx.$queryRawUnsafe('SELECT id FROM atlas_manual.card WHERE id=$1::uuid FOR UPDATE',cardId);
      const [parent]=await tx.$queryRawUnsafe(`SELECT m.* FROM atlas_manual.presentation_market m JOIN atlas_manual.card c ON c.id=m.card_id
        WHERE m.card_id=$1::uuid AND m.request_id=$2::uuid AND m.actor_id=$3::uuid
        AND (c.owner_id=$3::uuid OR $3::uuid=ANY(c.approvers))
        AND m.approval_action_id=(SELECT CASE WHEN p.state='PUBLISHED' THEN p.action_id ELSE NULL END FROM atlas_manual.publication p WHERE p.card_id=m.card_id ORDER BY p.version DESC LIMIT 1)
        FOR UPDATE OF m`,cardId,requestId,principal.id);
      requireThat(principal.role==='REVIEWER'&&parent,403,'RESEARCH_ACCESS_DENIED');return work(tx,parent);
    });
  }
  async function put(tx,cardId,requestId,sequence,event,requestHash,evidence){
    const text=canonical(evidence),evidenceHash=digest(text);
    await tx.$executeRawUnsafe('INSERT INTO atlas_manual.research_effect(card_id,request_id,sequence,event,request_hash,evidence,evidence_hash) VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7)',cardId,requestId,sequence,event,requestHash,text,evidenceHash);
    return {sequence,event,request_hash:requestHash,evidence};
  }
  return Object.freeze({
    initializeInTransaction:(tx,cardId,requestId,evidence)=>put(tx,cardId,requestId,0,'INIT',digest(canonical(evidence)),evidence),
    read:(staff,cardId,requestId)=>access(staff,cardId,requestId,async tx=>(await tx.$queryRawUnsafe('SELECT * FROM atlas_manual.research_effect WHERE card_id=$1::uuid AND request_id=$2::uuid ORDER BY sequence,event',cardId,requestId)).map(parse)),
    init:(staff,cardId,requestId,evidence)=>access(staff,cardId,requestId,async(tx,parent)=>{
      requireThat(parent.state==='STARTED',409,'RESEARCH_INTENT_SETTLED');
      return put(tx,cardId,requestId,0,'INIT',digest(canonical(evidence)),evidence);
    }),
    dispatch:(staff,cardId,requestId,requestHash,evidence)=>access(staff,cardId,requestId,async(tx,parent)=>{
      requireThat(parent.state==='STARTED',409,'RESEARCH_INTENT_SETTLED');
      const rows=(await tx.$queryRawUnsafe('SELECT * FROM atlas_manual.research_effect WHERE card_id=$1::uuid AND request_id=$2::uuid ORDER BY sequence',cardId,requestId)).map(parse);
      const existing=rows.find(r=>r.event==='DISPATCH'&&r.request_hash===requestHash);
      if(existing)return {created:false,...existing,rows:rows.filter(r=>r.sequence===existing.sequence)};
      const sequence=Math.max(0,...rows.map(r=>r.sequence))+1;
      requireThat(sequence<=128,409,'RESEARCH_EFFECT_LIMIT');
      return {created:true,...await put(tx,cardId,requestId,sequence,'DISPATCH',requestHash,evidence)};
    }),
    async receipt(cardId,requestId,sequence,event,requestHash,evidence){
      const text=canonical(evidence);
      // Retry the same receipt only, never a provider effect.
      for(let attempt=0;attempt<3;attempt++){try{
        await receiptClient.$queryRawUnsafe('SELECT atlas_manual.append_research_receipt($1::uuid,$2::uuid,$3::integer,$4::text,$5::text,$6::text)::text AS receipt',cardId,requestId,sequence,event,requestHash,text);return;
      }catch(error){if(attempt===2)throw error;}}
    },
    complete:(staff,cardId,requestId,evidence)=>access(staff,cardId,requestId,(tx)=>put(tx,cardId,requestId,0,'COMPLETE',digest(canonical(evidence)),evidence)),
  });
}
