import {canonical,digest,object,requireThat,uuid} from '@atlas/manual-service/contract';
import {researchCardSubject,StaffInventoryResearchResultSchema,inspectStaffInventoryResearchTitle} from '@tenkings/card-research-core';
import {EBAY_SOLD_COMPS_V2_ENGINE_VERSION,EBAY_SOLD_COMPS_V2_SOURCE} from '@tenkings/ebay-sold-comps-v2';
import {projectResearchMarketPreview} from './presentation-market.mjs';
import {publishedResearchQuery} from './research-market-query.mjs';
import {createResearchJournal} from './research-journal.mjs';
import {createResearchEffects} from './research-effects.mjs';
import {loadResearchPhotos,readResearchPhotos} from './research-photos.mjs';

export const ATLAS_RESEARCH_POLICY=Object.freeze({version:'atlas-independent-research-v2',core:'staff-inventory-research-v6',requestCount:40,hydrateBoa:false,saleDetails:false,fullResolutionImages:true,maxSearches:3,maxCandidateImages:12,maxReferenceImages:4,estimate:'not_adopted'});
const fail=(ok,code)=>requireThat(ok,409,code);
function description(context){const i=context.input;return {name:i.playerName??i.cardName,category:i.category==='SPORTS'?'Sports cards':'Pokémon',year:i.year,manufacturer:i.manufacturer??null,set_name:i.productSet,card_number:i.cardNumber??null,variant:i.parallel??null,card_type:i.insert??null};}
function marketResult(result,context){
  return {source:EBAY_SOLD_COMPS_V2_SOURCE,engineVersion:EBAY_SOLD_COMPS_V2_ENGINE_VERSION,query:context.query,retrievedAt:result.researched_at,
    candidates:result.candidates.map(candidate=>{
      const title=inspectStaffInventoryResearchTitle(description(context),candidate),contradiction=title.reason_codes.some(code=>['release_year_conflict','card_number_conflict','sport_conflict','product_title_conflict','variant_title_conflict'].includes(code));
      return {id:candidate.id,source:EBAY_SOLD_COMPS_V2_SOURCE,title:candidate.title,listingUrl:candidate.listing_url,raw:candidate.raw,grader:candidate.grader,numericGrade:candidate.numeric_grade,
        soldPriceCents:candidate.source_eligible&&candidate.sale_evidence?.status==='sold'&&candidate.best_offer_accepted===false?candidate.sold_price_cents:null,
        soldDate:candidate.sold_date,parallelMatch:contradiction?'CONTRADICTORY':'UNKNOWN',
        matchScore:[title.name_anchored,title.product_anchored,title.number_anchored,title.manufacturer_anchored,title.year.status==='matched'].filter(Boolean).length*20,
        matchReason:contradiction?'Research found conflicting identity evidence.':'Compare the saved identity and photo research before selecting this external-grader sale.'};
    })};
}
export function projectAtlasResearch(result,{effectsUnknown=0}={}){
  const parsed=StaffInventoryResearchResultSchema.parse(result);
  return {version:'atlas-research-preview-v2',engineVersion:parsed.engine_version,model:parsed.model,observedAt:parsed.researched_at,
    identity:parsed.identity,photoIdentity:parsed.photo_identity,
    queries:parsed.research_queries,warnings:parsed.warnings,effectsUnknown,
    candidates:parsed.candidates.map(candidate=>{
      const diagnostic=parsed.diagnostics.candidates.find(d=>d.candidate_id===candidate.id),decision=parsed.comparison_assessments.find(d=>d.candidate_id===candidate.id);
      return {id:candidate.id,title:candidate.title,listingUrl:candidate.listing_url,grader:candidate.grader,grade:candidate.numeric_grade,soldAt:candidate.sold_date,
        priceMinor:candidate.sold_price_cents,currency:candidate.sold_currency,saleEvidence:candidate.sale_evidence,priceEligible:candidate.source_eligible,
        imageCompared:diagnostic?.comparison_status==='assessed',identityMatch:diagnostic?.model_assessment?.identity_match??null,
        variantMatch:diagnostic?.model_assessment?.variant_match??null,visualMatch:diagnostic?.model_assessment?.visual_match??null,
        conditionDecision:decision,decisionCodes:diagnostic?.decision_codes??[],sourceResponseSha256:candidate.source_response_sha256};
    })};
}
export function createAtlasResearchService({boundary,repository,approved,intake,storage,artifacts,receiptClient,config,validateAccess=null,run=work=>work(),journal:injectedJournal=null,loadPhotos=loadResearchPhotos}){
  requireThat(config&&typeof config.openaiApiKey==='string'&&config.openaiApiKey.length>=16&&typeof config.soldCompsApiKey==='string'&&config.soldCompsApiKey.length>=8,503,'RESEARCH_NOT_CONFIGURED');
  const policy={...ATLAS_RESEARCH_POLICY},policyHash=digest(canonical(policy));
  const journal=injectedJournal??createResearchJournal({boundary,repository,receiptClient,validateAccess}),active=new Set();
  const secrets=[config.openaiApiKey,config.soldCompsApiKey].filter(Boolean);
  const asset=(cardId,kind,value,sourceHash)=>artifacts.write(value,{cardId,kind,sourceHash});
  async function readResult(staff,cardId,requestId){
    const row=await repository.market(staff,cardId,requestId),record=row.saved;
    if(row.state!=='READY')return null;
    fail(record?.researchRef&&record.researchHash,'RESEARCH_REQUEST_KIND_CONFLICT');
    const saved=await artifacts.read(record.researchRef,{cardId,kind:'RESEARCH_RESULT',sourceHash:record.researchHash});
    requireThat(digest(JSON.stringify(saved))===record.researchHash&&saved.input.subject.id===cardId&&saved.context.binding.publicHash===saved.input.subject.revision,503,'RESEARCH_RESULT_CORRUPT');
    const preview=await artifacts.read(record.ref,{cardId,kind:'MARKET_PREVIEW',sourceHash:record.artifactHash});
    requireThat(digest(JSON.stringify(preview))===record.artifactHash&&digest(canonical(preview))===record.sourceHash,503,'RESEARCH_RESULT_CORRUPT');
    const source=await approved.loadPacket(staff,cardId,row.input.approvalActionId);fail(source.publicHash===saved.context.binding.publicHash,'RESEARCH_PUBLICATION_CHANGED');
    fail(saved.policy?.version===policy.version,'RESEARCH_POLICY_RETIRED');
    const research=projectAtlasResearch(saved.result,{effectsUnknown:saved.effectsUnknown});
    await repository.market(staff,cardId,requestId);
    return {state:'READY',previewId:requestId,preview,research,saved};
  }
  function publicResult(found){if(!found)return found;const {saved,...value}=found;return value;}
  async function execute(staff,cardId,input,init){
    fail(init.policyHash===policyHash&&init.kind==='RESEARCH'&&init.approvalActionId===input.approvalActionId,'RESEARCH_REQUEST_KIND_CONFLICT');
    const source=await approved.loadPacket(staff,cardId,input.approvalActionId);fail(source.publicHash===init.publicHash,'RESEARCH_PUBLICATION_CHANGED');
    const saved=await artifacts.read(init.inputRef,{cardId,kind:'RESEARCH_INPUT',sourceHash:init.publicHash});
    fail(saved.input.subject.id===cardId&&saved.input.subject.revision===source.publicHash&&saved.context.query===publishedResearchQuery(source,{savedQuery:saved.context.query,savedInput:saved.context.input,queryContext:saved.context.marketQueryContext}).query,'RESEARCH_INPUT_CONFLICT');
    const loaded=await readResearchPhotos({artifacts,cardId,sourceHash:init.publicHash,input:saved.input,lineage:saved.lineage});
    const fetchImpl=createResearchEffects({journal,artifacts,staff,cardId,requestId:input.requestId,sourceHash:init.publicHash,fetchImpl:config.fetchImpl,secrets});
    const deps={env:{OPENAI_API_KEY:config.openaiApiKey,SOLDCOMPS_API_KEY:config.soldCompsApiKey,STAFF_INVENTORY_RESEARCH_FULL_RES_IMAGES:'true'},
      requestCount:40,hydrateBoa:false,initialQuery:saved.context.query,now:()=>new Date(init.observedAt),fetchImpl,loadPhoto:async descriptor=>loaded.get(descriptor.ref)};
    const result=await researchCardSubject(saved.input,deps);
    const market=projectResearchMarketPreview(source,marketResult(result,saved.context));
    fail(market.state==='READY','RESEARCH_PREVIEW_INVALID');
    const events=await journal.read(staff,cardId,input.requestId),effectsUnknown=events.filter(e=>e.event==='DISPATCH'&&!events.some(r=>r.sequence===e.sequence&&r.event==='RESPONSE')).length;
    const researchValue={version:'atlas-research-result-v1',policy,input:saved.input,context:saved.context,result,effectsUnknown};
    const researchHash=digest(JSON.stringify(researchValue)),researchRef=await asset(cardId,'RESEARCH_RESULT',researchValue,researchHash);
    const artifactHash=digest(JSON.stringify(market.preview)),ref=await asset(cardId,'MARKET_PREVIEW',market.preview,artifactHash);
    const record={state:'READY',ref,artifactHash,sourceHash:market.sourceHash,researchRef,researchHash};
    await journal.complete(staff,cardId,input.requestId,record);
    await repository.finishMarket(staff,cardId,input.requestId,record);
    return publicResult(await readResult(staff,cardId,input.requestId));
  }
  return Object.freeze({enabled:true,
    preview:(staff,cardId,input)=>run(async()=>{
      object(input,['requestId','approvalActionId','expectedRevision']);uuid(input.requestId);uuid(input.approvalActionId);
      const key=`${cardId}:${input.requestId}`;
      if(active.has(key)){await repository.market(staff,cardId,input.requestId);return {state:'PENDING',previewId:input.requestId};}
      const source=await approved.loadPacket(staff,cardId,input.approvalActionId),context=publishedResearchQuery(source,{});
      // Read-only lookup before photo processing; a missing exact request has no effects.
      let existing=null;try{existing=await repository.market(staff,cardId,input.requestId);}catch(error){if(error?.code!=='PRESENTATION_MARKET_NOT_FOUND')throw error;}
      if(existing)fail(canonical(existing.input)===canonical(input),'PRESENTATION_REQUEST_CONFLICT');
      if(existing?.state==='READY')return publicResult(await readResult(staff,cardId,input.requestId));
      let init;
      if(existing){
        const events=await journal.read(staff,cardId,input.requestId);init=events.find(e=>e.event==='INIT')?.evidence;
        fail(init?.kind==='RESEARCH'&&init.policyHash===policyHash,'RESEARCH_REQUEST_KIND_CONFLICT');
        const completed=events.find(e=>e.event==='COMPLETE');if(completed){await repository.finishMarket(staff,cardId,input.requestId,completed.evidence);return publicResult(await readResult(staff,cardId,input.requestId));}
      }else{
        const prepared=await loadPhotos({staff,cardId,source,intake,storage,artifacts});
        const engineInput={schema_version:1,subject:{namespace:'atlas',id:cardId,revision:source.publicHash},description:description(context),photos:prepared.photos};
        const inputRef=await asset(cardId,'RESEARCH_INPUT',{input:engineInput,context,lineage:prepared.lineage,pairHash:prepared.pairHash},source.publicHash);
        init={kind:'RESEARCH',version:1,policyHash,publicHash:source.publicHash,approvalActionId:input.approvalActionId,inputRef,observedAt:new Date().toISOString()};
        const reserved=await repository.reserveMarket(staff,cardId,input,tx=>journal.initializeInTransaction(tx,cardId,input.requestId,init));
        if(!reserved.created)return {state:'PENDING',previewId:input.requestId};
      }
      active.add(key);
      try{return await execute(staff,cardId,input,init);}catch(error){
        // Retained effects remain recoverable; no timeout changes a dispatch to
        // safe-to-repeat or overwrites a late acknowledged response.
        if(error?.status===403||error?.status===404)throw error;
        return {state:'UNKNOWN',previewId:input.requestId,reason:'RESEARCH_OUTCOME_UNKNOWN'};
      }finally{active.delete(key);}
    }),
  });
}
