import { createReportMarketClient } from './report-market-client.mjs';

/** Research keeps its own browser intent and reuses the saved sales contract. */
export function createReportResearchClient(options) {
  const {storage,request}=options;
  const scoped=key=>key.replace(/^atlas-report-market:/,'atlas-report-research:');
  return createReportMarketClient({...options,autoDiscovery:false,storage:{
    getItem:key=>storage.getItem(scoped(key)),setItem:(key,value)=>storage.setItem(scoped(key),value),removeItem:key=>storage.removeItem(scoped(key))},
    request:(path,input)=>request(path.replace(/\/market\/search$/,'/research/search'),input)});
}
