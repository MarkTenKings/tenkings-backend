import { canonical, digest, object, requireThat, uuid } from '@atlas/manual-service/contract';
import { canonicalizeNewSpeedsterSessionIdentity } from '@atlas/grading-core/identity';

export const FIELDS = ['name','category','manufacturer','card_number','year','set_name','variant','card_type'];
const SETTINGS = ['profile','layoutType','cornerShape','matColor','parallel','insert'];
const EMPTY = { fields: Object.fromEntries(FIELDS.map(key => [key, ''])), profile: null, layoutType: null,
  cornerShape: 'ROUNDED_3_18_MM', matColor: 'BLACK', parallel: '', insert: '', touched: [], sourceHash: null };
function checkDetails(value) {
  object(value, ['fields', ...SETTINGS, 'touched', 'sourceHash']); object(value.fields, FIELDS);
  for (const key of FIELDS) requireThat(typeof value.fields[key] === 'string' && value.fields[key].length <= (key === 'year' ? 24 : 160));
  requireThat([null,'SPORTS','POKEMON'].includes(value.profile) && [null,'POKEMON','TRAINER','ENERGY'].includes(value.layoutType)
    && ['SQUARE','ROUNDED_3_18_MM'].includes(value.cornerShape) && ['BLACK','WHITE','MAGENTA'].includes(value.matColor));
  for (const key of ['parallel','insert']) requireThat(typeof value[key] === 'string' && value[key].length <= 120);
  requireThat(Array.isArray(value.touched) && value.touched.length <= FIELDS.length + SETTINGS.length
    && new Set(value.touched).size === value.touched.length && value.touched.every(key => [...FIELDS,...SETTINGS].includes(key)));
  requireThat(value.sourceHash === null || /^[a-f0-9]{64}$/.test(value.sourceHash)); return value;
}
export function gradingIdentity(details) {
  checkDetails(details); requireThat(['SPORTS','POKEMON'].includes(details.profile), 400, 'MANUAL_CARD_PROFILE_REQUIRED');
  const f = details.fields;
  return canonicalizeNewSpeedsterSessionIdentity(details.profile, details.profile === 'SPORTS'
    ? { playerName:f.name,year:f.year,manufacturer:f.manufacturer,productSet:f.set_name,parallel:details.parallel,insert:details.insert,cardNumber:f.card_number }
    : { cardName:f.name,year:f.year,productSet:f.set_name,parallel:details.parallel,cardNumber:f.card_number,layoutType:details.layoutType });
}
export function mergeSuggestions(current, result, sourceHash) {
  const next = structuredClone(checkDetails(current));
  for (const field of FIELDS) if (!next.touched.includes(field)) {
    const value = result.suggestions[field]?.value;
    // The shared contract is deliberately wider than the grading identity.
    // Keep the full suggested text for review; never silently truncate it.
    next.fields[field] = typeof value === 'string' ? value : '';
  }
  if (!next.touched.includes('profile')) next.profile = ({ 'Sports cards':'SPORTS','Pokémon':'POKEMON' })[next.fields.category] ?? null;
  next.sourceHash = sourceHash; return checkDetails(next);
}
export function createDetailsStore({ boundary, intakeRepository }) {
  async function row(tx, cardId, lock=false) {
    const initial = canonical(EMPTY);
    await tx.$executeRawUnsafe('INSERT INTO atlas_manual_connected.details(card_id,content,content_hash) VALUES($1::uuid,$2,$3) ON CONFLICT DO NOTHING',cardId,initial,digest(initial));
    const [found] = await tx.$queryRawUnsafe(`SELECT * FROM atlas_manual_connected.details WHERE card_id=$1::uuid${lock?' FOR UPDATE':''}`,cardId);
    requireThat(found && digest(found.content)===found.content_hash,503,'MANUAL_DETAILS_INVALID');
    return { revision:found.revision,details:checkDetails(JSON.parse(found.content)) };
  }
  async function write(tx,cardId,current,next) {
    const content=canonical(checkDetails(next));
    await tx.$executeRawUnsafe('UPDATE atlas_manual_connected.details SET revision=revision+1,content=$1,content_hash=$2 WHERE card_id=$3::uuid AND revision=$4',content,digest(content),cardId,current.revision);
    return { revision:current.revision+1,details:next };
  }
  return Object.freeze({
    async read(staff,cardId) { uuid(cardId); return boundary.transaction(staff,async ({tx,principal})=>{
      await intakeRepository.authorizeInTransaction(tx,principal,cardId); return row(tx,cardId);
    }); },
    async save(staff,cardId,input) {
      object(input,['actionId','expectedRevision','changes']); uuid(input.actionId); uuid(cardId);
      requireThat(Number.isSafeInteger(input.expectedRevision) && input.expectedRevision>0);
      requireThat(input.changes && Object.getPrototypeOf(input.changes)===Object.prototype && Object.keys(input.changes).length>0);
      requireThat(Object.keys(input.changes).every(key=>[...FIELDS,...SETTINGS].includes(key)));
      const requestHash=digest(canonical(input));
      return boundary.transaction(staff,async ({tx,principal})=>{
        await intakeRepository.authorizeInTransaction(tx,principal,cardId,{edit:true,lock:'UPDATE'});
        const current=await row(tx,cardId,true);
        const [previous]=await tx.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.details_action WHERE card_id=$1::uuid AND action_id=$2::uuid',cardId,input.actionId);
        if(previous){requireThat(previous.actor_id===principal.id && previous.request_hash===requestHash,409,'MANUAL_ACTION_ID_CONFLICT');return JSON.parse(previous.result);}
        const [manual]=await tx.$queryRawUnsafe('SELECT id FROM atlas_manual.card WHERE id=$1::uuid',cardId);
        requireThat(!manual,409,'MANUAL_USE_WORKSPACE_IDENTITY');
        requireThat(current.revision===input.expectedRevision,409,'MANUAL_DETAILS_STALE');
        const next=structuredClone(current.details);
        for(const [key,value] of Object.entries(input.changes)){ if(FIELDS.includes(key))next.fields[key]=value;else next[key]=value;if(!next.touched.includes(key))next.touched.push(key); }
        const result=await write(tx,cardId,current,next);
        await tx.$executeRawUnsafe('INSERT INTO atlas_manual_connected.details_action(card_id,action_id,actor_id,request_hash,result) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5)',cardId,input.actionId,principal.id,requestHash,canonical(result));
        return result;
      });
    },
    async adopt(staff,cardId,sourceHash,result) { return boundary.transaction(staff,async ({tx,principal})=>{
      await intakeRepository.assertCurrentPair(tx,principal,{cardId,sourceHash});
      const current=await row(tx,cardId,true);
      if(current.details.sourceHash===sourceHash)return current;
      return write(tx,cardId,current,mergeSuggestions(current.details,result,sourceHash));
    }); },
  });
}

export function connectedGrantSQL(role) {
  requireThat(/^[a-z][a-z0-9_]{0,62}$/.test(role));
  return `GRANT USAGE ON SCHEMA atlas_manual_connected TO "${role}";
GRANT SELECT,INSERT ON ALL TABLES IN SCHEMA atlas_manual_connected TO "${role}";
GRANT UPDATE(revision,content,content_hash) ON atlas_manual_connected.details TO "${role}";
GRANT UPDATE(state,result,error,finished_at) ON atlas_manual_connected.identification TO "${role}";
GRANT EXECUTE ON FUNCTION atlas_manual_connected.append_receipt(uuid,text,text,text,text) TO "${role}";`;
}
