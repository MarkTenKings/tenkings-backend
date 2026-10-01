import {createHmac,timingSafeEqual} from 'node:crypto';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const fail=(status,code)=>{throw Object.assign(new Error(code),{status,code});};
const sign=(key,id)=>createHmac('sha256',key).update(`atlas-dealer-handoff-v1:${id}`).digest('base64url');
/** A reference to a paid order. This token never authorizes custody or bypasses dealer login. */
export function handoffToken(key,id){if(!UUID.test(id??''))fail(503,'HANDOFF_UNAVAILABLE');return `v1.${id.toLowerCase()}.${sign(key,id.toLowerCase())}`;}
export function readHandoffToken(key,value){
 if(typeof value!=='string')fail(400,'INVALID_HANDOFF');
 const match=/^v1\.([a-f0-9-]{36})\.([A-Za-z0-9_-]{43})$/.exec(value);
 if(!match||!UUID.test(match[1]))fail(400,'INVALID_HANDOFF');
 const expected=sign(key,match[1]);if(!timingSafeEqual(Buffer.from(expected),Buffer.from(match[2])))fail(404,'HANDOFF_NOT_FOUND');
 return match[1];
}
export function handoffConfirmation(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['requestId','cardIds','confirmedCount'].includes(k))
  ||!UUID.test(input.requestId??'')||!Number.isInteger(input.confirmedCount)||input.confirmedCount<1||input.confirmedCount>100
  ||!Array.isArray(input.cardIds)||input.cardIds.length!==input.confirmedCount||!input.cardIds.every(id=>UUID.test(id??'')))fail(400,'ALL_CARDS_CONFIRMATION_REQUIRED');
 const cardIds=input.cardIds.map(id=>id.toLowerCase()).sort();if(new Set(cardIds).size!==cardIds.length)fail(400,'ALL_CARDS_CONFIRMATION_REQUIRED');
 return {requestId:input.requestId.toLowerCase(),cardIds,confirmedCount:input.confirmedCount};
}
