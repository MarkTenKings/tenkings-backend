import {parseCardIdentificationInput,parseCardIdentificationOutput} from '@tenkings/card-identification-core';
import {identifyCardV2,parseCardIdentificationResultV2,cardIdentificationInputHashV2,CARD_IDENTIFICATION_VERSION_V2} from '@tenkings/card-identification-core/v2';
import {digest,object,requireThat} from '@atlas/manual-service/contract';
import {identifyAtlasCardWithExtendedRuntime,ATLAS_IDENTIFICATION_XHIGH_POLICY} from './identification-xhigh.mjs';
export {ATLAS_IDENTIFICATION_XHIGH_POLICY} from './identification-xhigh.mjs';

// ATLAS-only adaptation. Shared Inventory V1/V2 requests and historical receipts
// keep their existing versions and byte interpretation.
export const ATLAS_IDENTIFICATION_LEGACY_LAYOUT_VERSION='atlas-identification-layout-v1';
export const ATLAS_IDENTIFICATION_LAYOUT_VERSION='atlas-identification-layout-v2';
export const ATLAS_IDENTIFICATION_LAYOUT_VERSIONS=Object.freeze([ATLAS_IDENTIFICATION_LEGACY_LAYOUT_VERSION,ATLAS_IDENTIFICATION_LAYOUT_VERSION]);
export const atlasIdentificationRunningWindow=version=>version===ATLAS_IDENTIFICATION_LAYOUT_VERSION?ATLAS_IDENTIFICATION_XHIGH_POLICY.runningWindowMs:120000;
const layouts=['POKEMON','TRAINER','ENERGY'];
const bad=ok=>requireThat(ok,503,'IDENTIFICATION_LAYOUT_INVALID');
const policy='ATLAS also requests one additional field, layout_type, using the same value/confidence/evidence shape. It is an unreviewed machine proposal for the front layout, never a grade or human approval. First establish that the pair depicts the same Pokémon TCG card. For Pokémon creature cards use POKEMON only when the front shows creature-card structure such as a named Pokémon with HP and attacks or evolution/stage information. Use TRAINER only when the front visibly identifies Trainer, Supporter, Item, Stadium or Pokémon Tool structure. Use ENERGY only when the front visibly identifies a Basic or Special Energy card and its energy symbol/rules structure. The Pokémon back, game logo, character artwork, saved card name or generic Pokémon TCG category alone cannot distinguish these layouts. A Trainer with Pokémon artwork is still TRAINER. Quote the distinguishing visible front text/structure with a Front location in evidence (at most 240 characters). Use high confidence only for unambiguous visible layout markers. For other games, conflicting pairs, ambiguous structure or unreadable front evidence return value:null, confidence:unknown, evidence:null. Keep all eight original descriptive fields and their rules unchanged; output exactly those eight fields plus layout_type.';
const layoutSchema={type:'object',additionalProperties:false,required:['value','confidence','evidence'],properties:{
 value:{type:['string','null'],enum:[...layouts,null]},confidence:{type:'string',enum:['high','medium','low','unknown']},evidence:{type:['string','null']}}};
function layout(value){
 object(value,['value','confidence','evidence']);
 bad((value.value===null||layouts.includes(value.value))&&['high','medium','low','unknown'].includes(value.confidence));
 if(value.value===null)bad(value.confidence==='unknown'&&value.evidence===null);
 else bad(value.confidence!=='unknown'&&typeof value.evidence==='string'&&value.evidence.length<=240&&/^Front\b/i.test(value.evidence)
  &&value.evidence===value.evidence.trim()&&!/[\u0000-\u001f\u007f]|https?:\/\/|data:|<\/?[a-z]|\b(?:sk|sess|proj)-[A-Za-z0-9_-]{8,}/i.test(value.evidence));
 return structuredClone(value);
}
export function atlasIdentificationInputHash(input,engineVersion=ATLAS_IDENTIFICATION_LAYOUT_VERSION){bad(ATLAS_IDENTIFICATION_LAYOUT_VERSIONS.includes(engineVersion));return digest(JSON.stringify({engine_version:engineVersion,input_sha256:cardIdentificationInputHashV2(input)}));}
export function parseAtlasIdentificationResult(value,expectedInput,engineVersion=value?.provenance?.engine_version){
 const input=parseCardIdentificationInput(expectedInput);object(value,['suggestions','warnings','provenance','layout']);
 bad(ATLAS_IDENTIFICATION_LAYOUT_VERSIONS.includes(engineVersion)&&value.provenance?.engine_version===engineVersion&&value.provenance.input_sha256===atlasIdentificationInputHash(input,engineVersion));
 const xhigh=engineVersion===ATLAS_IDENTIFICATION_LAYOUT_VERSION;
 bad(value.provenance.reasoning_effort===(xhigh?'xhigh':'low'));
 object(value.layout,['authority','value','confidence','evidence','front_sha256']);
 bad(value.layout.authority==='MACHINE_PROPOSAL'&&value.layout.front_sha256===input.photos.front.sha256);
 const proposal=layout({value:value.layout.value,confidence:value.layout.confidence,evidence:value.layout.evidence});
 const timing=xhigh?{elapsed_ms:value.provenance.elapsed_ms,stage_timings_ms:value.provenance.stage_timings_ms}:null;
 if(timing){
  object(timing.stage_timings_ms,['photo_read','ocr','model']);
  bad(Number.isSafeInteger(timing.elapsed_ms)&&timing.elapsed_ms>=0&&timing.elapsed_ms<=ATLAS_IDENTIFICATION_XHIGH_POLICY.maximumDurationMs);
  bad(Object.values(timing.stage_timings_ms).every(ms=>Number.isSafeInteger(ms)&&ms>=0&&ms<=timing.elapsed_ms));
 }
 // Validate v2's actual timings above, independently from the frozen shared
 // 45-second schema. Only the compatibility projection uses zero durations;
 // returned and persisted evidence always retains the actual measured values.
 const parsed=parseCardIdentificationResultV2({suggestions:value.suggestions,warnings:value.warnings,provenance:{...value.provenance,
  engine_version:CARD_IDENTIFICATION_VERSION_V2,input_sha256:cardIdentificationInputHashV2(input),reasoning_effort:'low',
  ...(timing?{elapsed_ms:0,stage_timings_ms:{photo_read:0,ocr:0,model:0}}:{})}},input);
 bad(proposal.value===null||parsed.suggestions.category.value==='Pokémon');
 return {...parsed,layout:{authority:'MACHINE_PROPOSAL',...proposal,front_sha256:input.photos.front.sha256},provenance:{...parsed.provenance,...timing,engine_version:engineVersion,input_sha256:atlasIdentificationInputHash(input,engineVersion),reasoning_effort:xhigh?'xhigh':'low'}};
}
export async function identifyAtlasCard(input,effects,options={}){
 const {engineVersion=ATLAS_IDENTIFICATION_LAYOUT_VERSION,...runtimeOptions}=options;
 bad(ATLAS_IDENTIFICATION_LAYOUT_VERSIONS.includes(engineVersion));
 const xhigh=engineVersion===ATLAS_IDENTIFICATION_LAYOUT_VERSION;
 // Historical retries rebuild their exact original request; only new v2
 // attempts opt into the longer execution and truthful xhigh provenance.
 const executionOptions={...runtimeOptions,...(xhigh?{deadlines:ATLAS_IDENTIFICATION_XHIGH_POLICY.deadlines}:{})};
 const data=parseCardIdentificationInput(input),inputHash=atlasIdentificationInputHash(data,engineVersion);let proposal,requestHash,responseHash;
 const identify=xhigh?identifyAtlasCardWithExtendedRuntime:identifyCardV2;
 const result=await identify(data,{...effects,
  readPhoto:(photo,context)=>effects.readPhoto(photo,{...context,inputHash}),
  ocr:(request,context)=>effects.ocr(request,{...context,inputHash}),
  async model(base,context){
   const request=structuredClone(base);request.instructions=request.instructions.replace('Output only the eight requested fields.','Output the eight descriptive fields and layout_type.')+' '+policy;
   request.text.format.name='atlas_card_details_layout_v1';request.text.format.schema.required.push('layout_type');request.text.format.schema.properties.layout_type=layoutSchema;
   if(xhigh){request.reasoning={effort:ATLAS_IDENTIFICATION_XHIGH_POLICY.reasoningEffort};request.max_output_tokens=ATLAS_IDENTIFICATION_XHIGH_POLICY.maxOutputTokens;request.text.format.name='atlas_card_details_layout_v2';}
   requestHash=digest(JSON.stringify(request));
   // The durable adapter sees/acknowledges the actual augmented request and
   // complete raw response before this local compatibility projection occurs.
   const actual=await effects.model(request,{...context,inputHash,requestHash});responseHash=digest(actual);
   const payload=JSON.parse(Buffer.from(actual).toString('utf8'));
   bad(Array.isArray(payload.output));const parts=payload.output.flatMap(item=>Array.isArray(item?.content)?item.content:[]).filter(part=>part?.type==='output_text');
   bad(parts.length===1&&typeof parts[0].text==='string'&&parts[0].text.length<=16000);
   const output=JSON.parse(parts[0].text);proposal=layout(output.layout_type);delete output.layout_type;parts[0].text=JSON.stringify(output);
   parseCardIdentificationOutput(payload);return Buffer.from(JSON.stringify(payload));
  },
 },executionOptions);
 return parseAtlasIdentificationResult({...result,layout:{authority:'MACHINE_PROPOSAL',...proposal,front_sha256:data.photos.front.sha256},
  provenance:{...result.provenance,engine_version:engineVersion,input_sha256:inputHash,request_sha256:requestHash,response_sha256:responseHash,reasoning_effort:xhigh?'xhigh':'low'}},data,engineVersion);
}
