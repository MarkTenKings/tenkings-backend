import { createHash } from 'node:crypto';
import { requireThat, canonical } from '@atlas/manual-service/contract';

export const ORDER_DESK_STAGES = Object.freeze(['WAITING_FOR_ARRIVAL','RECEIVED','GRADING','HUMAN_REVIEW','FINISHING','READY_FOR_RETURN','RETURNING','COMPLETE','ATTENTION']);
export const ORDER_DESK_GROUPS = Object.freeze({ ARRIVAL:['WAITING_FOR_ARRIVAL'], RECEIVED:['RECEIVED'], GRADING_REVIEW:['GRADING','HUMAN_REVIEW'], FINISHING_PACKING:['FINISHING','READY_FOR_RETURN'], RETURNING:['RETURNING'], COMPLETE:['COMPLETE'] });
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const check = value => requireThat(value,400,'INVALID_ORDER_DESK_REQUEST');
const id = value => { check(typeof value === 'string' && UUID.test(value)); return value; };
function inputObject(value, fields) { check(value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).every(key => fields.includes(key))); }

export function orderDeskListInput(input = {}) {
  inputObject(input,['q','stage','view','cursor','limit']);
  const q=input.q??'', stage=input.stage??'', view=input.view??'all', cursor=input.cursor??null;
  check(typeof q==='string' && q.length<=120 && !/[\x00-\x1f\x7f]/.test(q));
  check(stage==='' || ORDER_DESK_STAGES.includes(stage) || Object.hasOwn(ORDER_DESK_GROUPS,stage));
  check(['all','new'].includes(view)); if(cursor!==null)id(cursor);
  const limit=typeof input.limit==='string' && /^[1-9][0-9]?$/.test(input.limit)?Number(input.limit):input.limit??25;
  check(Number.isInteger(limit)&&limit>=1&&limit<=50);
  return {q:q.trim(),stage,view,cursor,limit};
}
export function orderDeskPhotoInput(input) {
  inputObject(input,['orderId','cardId','side','size']); id(input.orderId); id(input.cardId);
  check(['FRONT','BACK'].includes(input.side)); const size=input.size??'thumbnail';check(['thumbnail','detail'].includes(size));
  return {orderId:input.orderId,cardId:input.cardId,side:input.side,size};
}
export function orderDeskGrantSQL(role) {
  check(/^[a-z][a-z0-9_]{0,62}$/.test(role));
  return `GRANT USAGE ON SCHEMA atlas_dealer TO "${role}";\nGRANT EXECUTE ON FUNCTION atlas_dealer.order_desk_call(text,text,text,jsonb,text[],jsonb) TO "${role}";`;
}
function labelBytes(result, input) {
  requireThat(result?.orderId===input.orderId && result.leg===input.leg && result.mimeType==='application/pdf'
    && typeof result.labelBase64==='string' && result.labelBase64.length<=5592408 && /^[A-Za-z0-9+/]+={0,2}$/.test(result.labelBase64),409,'LABEL_NOT_READY');
  const bytes=Buffer.from(result.labelBase64,'base64');
  requireThat(bytes.length<=4194304 && bytes.subarray(0,5).toString('ascii')==='%PDF-' && bytes.toString('base64')===result.labelBase64
    && createHash('sha256').update(bytes).digest('hex')===result.labelSha256,409,'LABEL_NOT_READY');
  return {bytes,contentType:'application/pdf',sha256:result.labelSha256};
}

/** Read-only desk service. Original WeakMap authority and current SQL runtime
 * binding are checked on every request, including cached photo reads. */
export function createOrderDeskService({auth,boundary,photos=null}) {
  const binding=Object.fromEntries(['mode','origin','deploymentId','releaseSha','configHash'].map(key=>[key,auth.config[key]]));
  async function read(staff,action,input) {
    const handle=auth.actors.get(staff);requireThat(handle,401,'SIGN_IN_REQUIRED');
    return boundary.transaction(staff,async({tx,principal})=>{
      requireThat(principal.role==='REVIEWER',403,'STAFF_REQUIRED');
      const [row]=await tx.$queryRawUnsafe('SELECT atlas_dealer.order_desk_call($1,$2,$3,$4::jsonb,$5::text[],$6::jsonb) AS result',
        action,handle.sessionHash,handle.browserHash,JSON.stringify(binding),[...auth.config.phoneByHash.keys()],JSON.stringify(input));
      requireThat(row?.result,503,'ORDER_DESK_UNAVAILABLE');
      if(row.result.error)requireThat(false,row.result.error.status,row.result.error.code);
      return row.result;
    });
  }
  return Object.freeze({
    list(staff,input={}) { return read(staff,'list',orderDeskListInput(input)); },
    detail(staff,input) { inputObject(input,['orderId']);id(input.orderId);return read(staff,'detail',{orderId:input.orderId}); },
    async photo(staff,input) {
      const request=orderDeskPhotoInput(input),sourceInput={orderId:request.orderId,cardId:request.cardId,side:request.side};
      const source=await read(staff,'photo_source',sourceInput);
      requireThat(photos?.read,503,'ORDER_PHOTO_UNAVAILABLE');
      requireThat(source.orderId===request.orderId && source.upload?.cardId===request.cardId && source.upload?.side===request.side,409,'ORDER_PHOTO_BINDING_CHANGED');
      const result=await photos.read(source,request.size);
      // Storage/native processing never holds the authority transaction open.
      const after=await read(staff,'photo_source',sourceInput);
      requireThat(canonical(after)===canonical(source),409,'ORDER_PHOTO_BINDING_CHANGED');
      return result;
    },
    async label(staff,input) {
      inputObject(input,['orderId','leg']);id(input.orderId);check(['INBOUND','RETURN'].includes(input.leg));
      return labelBytes(await read(staff,'label',input),input);
    },
  });
}
