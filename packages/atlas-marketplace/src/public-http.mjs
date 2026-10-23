import { requireValue } from './contract.mjs';
import { parseCatalogFilters } from './http.mjs';
import { publicApprovedCard } from './card-projection.mjs';
import { createMarketplaceHostCheck } from './host-boundary.mjs';

const headers=Object.freeze({'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
const reply=(status,body)=>({status,headers:{...headers},body});
const pathShape=value=>typeof value==='string'&&/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(value);
const idShape=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);

function publicPage(value) {
  requireValue(['SYNTHETIC_LOCAL','PROVIDER_SANDBOX','PRODUCTION'].includes(value?.environment)&&Array.isArray(value.items)&&value.items.length<=100,'CATALOG_UNAVAILABLE');
  requireValue(Number.isSafeInteger(value.total)&&value.total>=0&&Number.isSafeInteger(value.offset)&&value.offset>=0&&(value.nextOffset===null||Number.isSafeInteger(value.nextOffset)&&value.nextOffset>value.offset&&value.nextOffset<value.total),'CATALOG_UNAVAILABLE');
  const items=value.items.map(row=>{
    const approvedCard=publicApprovedCard(row.approvedCard);
    requireValue(approvedCard&&idShape(row.id)&&row.status==='ACTIVE'&&row.environment===value.environment&&row.cardId===approvedCard.cardId&&Number.isSafeInteger(row.version)&&row.version>0&&/^[a-f0-9]{64}$/.test(row.bindingHash??'')&&Number.isSafeInteger(row.askingPriceCents)&&row.askingPriceCents>0&&row.currency==='USD'&&row.fulfillmentRoute==='ATLAS_HELD','CATALOG_UNAVAILABLE');
    return {id:row.id,version:row.version,bindingHash:row.bindingHash,status:'ACTIVE',environment:value.environment,cardId:row.cardId,askingPriceCents:row.askingPriceCents,currency:'USD',fulfillmentRoute:'ATLAS_HELD',approvedCard};
  });
  return {environment:value.environment,items,total:value.total,offset:value.offset,nextOffset:value.nextOffset};
}

/** Public GET-only composition. No session, actor, mutation, credentials or
 * route registration. The service port must perform only its scoped public read.
 */
export function createPublicCatalogHandler({enabled=false,origin,acceptedHosts,catalogPath='/marketplace/catalog',service,admitPublicRequest,maxQueryLength=2000}={}) {
  const acceptsHost=enabled===true?createMarketplaceHostCheck({origin,acceptedHosts}):()=>false;
  let closed=false;
  return Object.freeze({close(){closed=true;},async handle(request){
    if(closed||enabled!==true)return reply(503,{error:'CATALOG_DISABLED'});
    try {
      requireValue(typeof service?.publicCatalog==='function'&&typeof admitPublicRequest==='function'&&pathShape(catalogPath)&&Number.isSafeInteger(maxQueryLength)&&maxQueryLength>0&&maxQueryLength<=8192,'CATALOG_UNAVAILABLE');
      const expected=new URL(origin),raw=request.url,method=request.method,source=request.headers??{};
      requireValue(expected.origin===origin&&(expected.protocol==='https:'||expected.protocol==='http:'&&['127.0.0.1','localhost'].includes(expected.hostname)),'CATALOG_UNAVAILABLE');
      requireValue(acceptsHost(source.host),'HOST_REFUSED');
      requireValue(source.origin===undefined||source.origin===origin,'ORIGIN_REFUSED');
      requireValue(typeof raw==='string'&&raw.startsWith('/')&&!/[\\#\s]/.test(raw)&&raw.split('?')[0]===catalogPath,'NOT_FOUND');
      requireValue(method==='GET','METHOD_NOT_ALLOWED');
      requireValue(raw.length<=catalogPath.length+maxQueryLength+1&&raw.split('?').length<=2,'FILTER_INVALID');
      requireValue(source['transfer-encoding']===undefined&&source['content-encoding']===undefined&&[undefined,'0'].includes(source['content-length'])&&(request.rawBody===undefined||Buffer.isBuffer(request.rawBody)&&request.rawBody.length===0)&&request.body===undefined,'INVALID_REQUEST');
      const url=new URL(raw,origin),filters=parseCatalogFilters(url.searchParams);
      requireValue(await admitPublicRequest({method,path:catalogPath,queryLength:url.search.length,remoteAddress:request.socket?.remoteAddress??null})===true,'RATE_LIMITED');
      return reply(200,publicPage(await service.publicCatalog(filters)));
    } catch(error) {
      const code=error?.code,status=code==='NOT_FOUND'?404:code==='METHOD_NOT_ALLOWED'?405:code==='RATE_LIMITED'?429:/REFUSED/.test(code??'')?403:['FILTER_INVALID','INVALID_REQUEST'].includes(code)?400:503;
      return reply(status,{error:status===503?'CATALOG_UNAVAILABLE':code});
    }
  }});
}
