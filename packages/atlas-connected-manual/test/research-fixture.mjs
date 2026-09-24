import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {canonical,digest} from '@atlas/manual-service/contract';
import {prepareObservationProposal} from '@tenkings/card-catalog-evidence';
import {presentationIntegrationFixture} from './presentation-integration-fixture.mjs';
import {createAtlasResearchService} from '../src/research-service.mjs';

export async function researchFixture({catalog=false}={}){
 const f=await presentationIntegrationFixture();f.source.row=f.row;
 const bytes=await Promise.all(['white','blue','red'].map(background=>sharp({create:{width:100,height:140,channels:3,background}}).jpeg().toBuffer()));
 f.intake={verifiedPair:async()=>({sourceHash:'a'.repeat(64),sides:Object.fromEntries(['FRONT','BACK'].map((side,i)=>[side,{photo:f.photos[side]}]))})};
 f.storage={readDecodedFrame:async({frame})=>({bytes:bytes[frame.id.endsWith('FRONT')?0:1]})};
 const events=new Map(),requestEvents=requestId=>{if(!events.has(requestId))events.set(requestId,[]);return events.get(requestId);};
 let loseInit=false,loseFinish=false;
 f.journal={
  async read(staff,cardId,requestId){await f.repository.market(staff,cardId,requestId);return structuredClone(requestEvents(requestId));},
  async initializeInTransaction(tx,cardId,requestId,evidence){if(loseInit){loseInit=false;throw new Error('fixture init failed');}const values=requestEvents(requestId);if(values.length)throw new Error('duplicate init');values.push({sequence:0,event:'INIT',evidence:structuredClone(evidence)});},
  async dispatch(staff,cardId,requestId,requestHash,evidence){await f.repository.market(staff,cardId,requestId);const values=requestEvents(requestId);if(!values.find(r=>r.event==='INIT'))throw new Error('missing init');const previous=values.find(r=>r.event==='DISPATCH'&&r.request_hash===requestHash);if(previous)return {created:false,...previous,rows:structuredClone(values.filter(r=>r.sequence===previous.sequence))};const row={sequence:Math.max(0,...values.map(r=>r.sequence))+1,event:'DISPATCH',request_hash:requestHash,evidence};values.push(row);return {created:true,...row};},
  async receipt(cardId,requestId,sequence,event,requestHash,evidence){const values=requestEvents(requestId);if(!values.find(r=>r.event==='DISPATCH'&&r.sequence===sequence&&r.request_hash===requestHash))throw new Error('unadmitted');const prior=values.find(r=>r.sequence===sequence&&r.event===event);if(prior){if(canonical(prior.evidence)!==canonical(evidence))throw new Error('conflict');return;}values.push({sequence,event,request_hash:requestHash,evidence:structuredClone(evidence)});},
  async complete(staff,cardId,requestId,evidence){await f.repository.market(staff,cardId,requestId);const values=requestEvents(requestId);if(values.some(d=>d.event==='DISPATCH'&&!values.some(r=>r.sequence===d.sequence&&['RESPONSE','FAILURE'].includes(r.event))))throw new Error('unsettled');values.push({sequence:0,event:'COMPLETE',evidence:structuredClone(evidence)});},
 };
 f.calls=[];f.failSource=false;f.failModel=false;f.loseProposal=false;f.proposals=[];
 const provider=async(url,init)=>{
  f.calls.push({url:String(url),method:init.method,body:init.body?JSON.parse(init.body):null,redirect:init.redirect});
  if(String(url).includes('/api/internal/card-catalog/v1/discover'))return Response.json({schemaVersion:'card-catalog-service/v1',publications:[]});
  if(String(url).includes('/api/internal/card-catalog/v1/proposals')){
   const body=JSON.parse(init.body),p=prepareObservationProposal(body.proposal);f.proposals.push(body);
   if(f.loseProposal)throw new Error('unknown provider response');
   if(f.proposalUnavailable)return Response.json({schemaVersion:'card-catalog-service/v1',error:'unavailable'},{status:503});
   return Response.json({schemaVersion:'card-catalog-service/v1',disposition:'requires_authorized_review',receipt:{proposalId:'fixture-proposal',idempotencyKey:p.idempotencyKey,proposalSha256:p.proposalSha256,outcome:'recorded'}},{status:201});
  }
  if(String(url).startsWith('https://api.sold-comps.com/')){
   if(f.failSource)throw new Error('uncertain source');
   return Response.json({keyword:new URL(url).searchParams.get('keyword'),page:1,totalItems:1,hasNextPage:false,items:[{itemId:'111111111110',url:'https://www.ebay.com/itm/111111111110',title:'2026 Fixture Local only Synthetic report PSA 9',soldPrice:'18.75',soldCurrency:'USD',bestOfferAccepted:false,listingType:'sold',endedAt:'2026-09-01',condition:'PSA 9',thumbnailUrl:'https://i.ebayimg.com/images/g/synthetic/s-l400.jpg'}]});
  }
  if(String(url)==='https://api.openai.com/v1/responses'){
   if(f.failModel)throw new Error('uncertain model');
   return Response.json({model:'gpt-6-astra',status:'completed',error:null,incomplete_details:null,usage:{input_tokens:100,output_tokens:50,total_tokens:150},output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({identity:{status:'unresolved',variant_name:null,suggestion:null,reason:'No reviewed catalog is available.',reference_ids:[],photo_features:[]},target_condition:{status:'raw',grader:null,numeric_grade:null,photo_evidence:'Both photos show a card without a grading label.'},selected_candidate_ids:[],comparisons:[{candidate_id:'ebay:111111111110',classification:'rejected',identity_match:true,variant_match:true,visual_match:true,condition_match:false,reason:'The listing shows a PSA 9 label while the target has no label.'}],refinement:null})}]}]});
  }
  if(String(url)==='https://i.ebayimg.com/images/g/synthetic/s-l400.jpg')return new Response(bytes[2],{headers:{'content-type':'image/jpeg'}});
  throw new Error('Unexpected fixture endpoint');
 };
 f.config={openaiApiKey:'fixture-openai-key-long',soldCompsApiKey:'fixture-sold-key-long',catalogToken:catalog?'T'.repeat(43):null,fetchImpl:provider};
 const finish=f.repository.finishMarket;
 f.repo={...f.repository,async reserveMarket(staff,cardId,input,onCreated){const before=structuredClone(f.searches);try{return await f.repository.reserveMarket(staff,cardId,input,onCreated);}catch(error){f.searches=before;throw error;}},async finishMarket(...args){if(loseFinish){loseFinish=false;throw new Error('result acknowledgement failed');}return finish(...args);}};
 f.create=()=>createAtlasResearchService({boundary:f.boundary,repository:f.repo,approved:f.approved,intake:f.intake,storage:f.storage,artifacts:f.artifacts,config:f.config,journal:f.journal});
 f.service=f.create();f.events=events;f.loseInit=()=>{loseInit=true;};f.loseFinish=()=>{loseFinish=true;};
 return f;
}
