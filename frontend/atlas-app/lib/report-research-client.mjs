import { createReportMarketClient } from './report-market-client.mjs';
const fail = code => Object.assign(new Error(code), {code});
const check = (value,code) => {if(!value)throw fail(code);};
const uuid = value => /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value??'');

/** Research and ordinary sales have separate browser intents but use the same
 * server-owned preview and publication contract. No results or photos persist
 * in browser storage. Unknown observations retain their exact observation id. */
export function createReportResearchClient(options) {
  const {storage,request,cardId,staffId,approvalActionId,cryptoImpl=globalThis.crypto}=options;
  const key=`atlas-research-observation:${staffId}:${cardId}`;
  const scoped=key=>key.replace(/^atlas-report-market:/,'atlas-report-research:');
  const base=createReportMarketClient({...options,storage:{getItem:key=>storage.getItem(scoped(key)),setItem:(key,value)=>storage.setItem(scoped(key),value),removeItem:key=>storage.removeItem(scoped(key))},
    request:(path,input)=>request(path.replace(/\/market\/search$/,'/research/search'),input)});
  let running=false;
  function pendingObservation(){
    let saved;try{saved=JSON.parse(storage.getItem(key)??'null');}catch{throw fail('RESEARCH_OBSERVATION_PENDING_INVALID');}
    if(saved)check(saved.version===1&&saved.cardId===cardId&&saved.staffId===staffId&&uuid(saved.approvalActionId)&&uuid(saved.previewId)&&uuid(saved.observationId),'RESEARCH_OBSERVATION_PENDING_INVALID');
    return saved;
  }
  return Object.freeze({...base,pendingObservation,
    async preview(){check(!pendingObservation(),'RESEARCH_OBSERVATION_PENDING');return base.preview();},
    async contribute(previewId){
      check(!running,'RESEARCH_OBSERVATION_BUSY');running=true;
      try{
        let saved=pendingObservation();
        check(!saved||saved.approvalActionId===approvalActionId,'RESEARCH_OBSERVATION_APPROVAL_STALE');
        if(!saved){check(uuid(previewId),'RESEARCH_OBSERVATION_PREVIEW_INVALID');saved={version:1,cardId,staffId,approvalActionId,previewId,observationId:cryptoImpl.randomUUID()};storage.setItem(key,JSON.stringify(saved));}
        else check(!previewId||saved.previewId===previewId,'RESEARCH_OBSERVATION_PENDING');
        const result=await request(`/api/staff/manual-connected/cards/${cardId}/presentation/research/contribute`,{method:'POST',body:{previewId:saved.previewId,observationId:saved.observationId}});
        check(result?.state==='RECORDED'&&result.disposition==='requires_authorized_review'&&typeof result.receipt?.proposalId==='string'&&['recorded','replay'].includes(result.receipt.outcome),'RESEARCH_OBSERVATION_UNCONFIRMED');
        if(pendingObservation()?.observationId===saved.observationId)storage.removeItem(key);
        return result;
      }finally{running=false;}
    },
    async reconcileObservation(){
      const saved=pendingObservation();check(saved,'RESEARCH_OBSERVATION_MISSING');
      if(saved.approvalActionId===approvalActionId)return this.contribute(saved.previewId);
      // A superseded report cannot start work. Only a current authenticated
      // status read permits discarding this browser-only recovery reference.
      await base.read();if(pendingObservation()?.observationId===saved.observationId)storage.removeItem(key);
      return {state:'SUPERSEDED'};
    },
  });
}
