import { object, requireThat } from '@atlas/manual-service/contract';
import { emptyAtlasSportsAttributes, atlasPrintedSerial, parseAtlasSportsAttributes } from '@atlas/grading-core/identity';

export const SPORTS_PROPOSAL_VERSION = 'atlas-sports-attributes-proposal-v1';
const confidenceValues = ['high','medium','low','unknown'];
const enumString = values => ({type:'string',enum:values});
const nullableText = {type:['string','null']};
const shape = properties => ({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const evidence = {type:'array',items:shape({side:enumString(['FRONT','BACK']),observation:{type:'string'}})};
const confidence = enumString(confidenceValues);
export const SPORTS_PROPOSAL_MODEL_SCHEMA = shape({
 serial:shape({printed:nullableText,confidence,evidence}),
 autograph:shape({presence:enumString(['UNKNOWN','PRESENT']),type:enumString(['UNKNOWN','ON_CARD','STICKER','CUT','FACSIMILE']),confidence,evidence}),
 relic:shape({presence:enumString(['UNKNOWN','PRESENT']),confidence,evidence,windows:{type:'array',items:shape({
  position:{type:'string'},material:nullableText,manufacturerStatement:nullableText,
  use:enumString(['UNKNOWN','GAME_USED','PLAYER_WORN','EVENT_WORN','NOT_ASSOCIATED','UNSPECIFIED']),evidence,
 })}}),
});
export const SPORTS_PROPOSAL_INSTRUCTIONS = 'Also return sports_attributes as an unreviewed machine proposal for Sports cards only. Inspect BOTH supplied front and back photographs and their OCR: autograph, copy numbering and manufacturer relic statements can appear on either side. FRONT/BACK evidence must name the supplied photo slot actually inspected, even if card faces were uploaded reversed. Never invent an observation, serial, material, or wording from catalog knowledge. Keep checklist card_number separate from exact printed copy serial such as 007/099; preserve its leading zeros. A serial must have a positive numerator no greater than its denominator. Not detected, unclear, hidden or unreadable means UNKNOWN/null, never absent. Autograph type is ON_CARD, STICKER, CUT, FACSIMILE or UNKNOWN; visible signature presence is not authentication. For relics record each visible window separately with its position and observed material, quote the manufacturerStatement EXACTLY if readable, and distinguish GAME_USED, PLAYER_WORN, EVENT_WORN, NOT_ASSOCIATED, UNSPECIFIED and UNKNOWN. Never infer use or wear from material alone. Every proposed present fact and relic window needs supporting evidence on its actual FRONT or BACK slot (maximum one observation per side, each at most 600 characters); type/use uncertainty stays UNKNOWN. At most 12 windows. Non-Sports cards return serial printed:null/confidence:unknown/evidence:[], autograph presence:UNKNOWN/type:UNKNOWN/confidence:unknown/evidence:[], and relic presence:UNKNOWN/confidence:unknown/evidence:[]/windows:[]. Output the eight descriptive fields, layout_type, and sports_attributes.';
const bad = condition => requireThat(condition,503,'IDENTIFICATION_SPORTS_ATTRIBUTES_INVALID');
export function emptySportsAttributesModelProposal(){return {serial:{printed:null,confidence:'unknown',evidence:[]},autograph:{presence:'UNKNOWN',type:'UNKNOWN',confidence:'unknown',evidence:[]},relic:{presence:'UNKNOWN',confidence:'unknown',evidence:[],windows:[]}};}
function photosFor(input){return {FRONT:input.photos.front.sha256,BACK:input.photos.back.sha256};}
function observations(values,photos){bad(Array.isArray(values)&&values.length<=2);return values.map(value=>{object(value,['side','observation']);bad(['FRONT','BACK'].includes(value.side));return {...value,imageSha256:photos[value.side]};});}
export function sportsAttributesModelProposal(raw,input,{sports=true}={}){
 object(raw,['serial','autograph','relic']);object(raw.serial,['printed','confidence','evidence']);object(raw.autograph,['presence','type','confidence','evidence']);object(raw.relic,['presence','confidence','evidence','windows']);
 const photos=photosFor(input),attributes=emptyAtlasSportsAttributes();
 bad(raw.serial.printed===null||typeof raw.serial.printed==='string');bad(['UNKNOWN','PRESENT'].includes(raw.autograph.presence)&&['UNKNOWN','PRESENT'].includes(raw.relic.presence));
 const confidences=Object.fromEntries(['serial','autograph','relic'].map(key=>{bad(confidenceValues.includes(raw[key].confidence));return [key,raw[key].confidence];}));
 attributes.serial={...attributes.serial,...(raw.serial.printed===null?{}:{presence:'PRESENT',...atlasPrintedSerial(raw.serial.printed)}),evidence:observations(raw.serial.evidence,photos)};
 attributes.autograph={presence:raw.autograph.presence,type:raw.autograph.type,evidence:observations(raw.autograph.evidence,photos)};
 bad(Array.isArray(raw.relic.windows)&&raw.relic.windows.length<=12);
 attributes.relic={presence:raw.relic.presence,evidence:observations(raw.relic.evidence,photos),windows:raw.relic.windows.map(window=>{object(window,['position','material','manufacturerStatement','use','evidence']);return {...window,evidence:observations(window.evidence,photos)};})};
 const parsed=parseAtlasSportsAttributes(attributes);
 for(const key of ['serial','autograph','relic'])bad(parsed[key].presence==='UNKNOWN'?confidences[key]==='unknown':confidences[key]!=='unknown');
 if(!sports){bad(JSON.stringify(raw)===JSON.stringify(emptySportsAttributesModelProposal())||['serial','autograph','relic'].every(key=>parsed[key].presence==='UNKNOWN'&&parsed[key].evidence.length===0));return null;}
 return {version:SPORTS_PROPOSAL_VERSION,authority:'MACHINE_PROPOSAL',sourceHash:input.subject.revision,photos,attributes:parsed,confidence:confidences};
}
export function parseSportsAttributesProposal(value,input,{sports=true}={}){
 if(value===null){bad(!sports);return null;}
 object(value,['version','authority','sourceHash','photos','attributes','confidence']);object(value.photos,['FRONT','BACK']);object(value.confidence,['serial','autograph','relic']);
 bad(sports&&value.version===SPORTS_PROPOSAL_VERSION&&value.authority==='MACHINE_PROPOSAL'&&value.sourceHash===input.subject.revision);
 const photos=photosFor(input);bad(value.photos.FRONT===photos.FRONT&&value.photos.BACK===photos.BACK);
 const attributes=parseAtlasSportsAttributes(value.attributes);
 for(const key of ['serial','autograph','relic']){
  bad(attributes[key].presence!=='ABSENT'&&confidenceValues.includes(value.confidence[key]));
  bad(attributes[key].presence==='UNKNOWN'?value.confidence[key]==='unknown':value.confidence[key]!=='unknown');
 }
 const observations=[...attributes.serial.evidence,...attributes.autograph.evidence,...attributes.relic.evidence,...attributes.relic.windows.flatMap(window=>window.evidence)];
 bad(observations.every(item=>item.imageSha256===photos[item.side]));
 return structuredClone(value);
}
