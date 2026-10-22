import { CustomerAuth } from './auth.mjs';
import { privateHeaders } from './policy.mjs';
import { displayCheck, displayError } from '../collection-display-contract.mjs';

const ROOT = '/api/customer/collection/cards/';
const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
const route = new RegExp(`^${ROOT}(${UUID})/display(/front)?$`);
export function parseCollectionDisplayRequest(req) {
  displayCheck(req.method === 'GET','METHOD_NOT_ALLOWED',405);
  const empty = req.body === undefined || req.body === null || req.body === '' || req.body && Object.getPrototypeOf(req.body) === Object.prototype && Object.keys(req.body).length === 0;
  displayCheck(empty && req.headers?.['transfer-encoding'] === undefined && [undefined,'0'].includes(req.headers?.['content-length']),'INVALID_DISPLAY_REQUEST',400);
  displayCheck(typeof req.url === 'string' && req.url.length < 500 && !/[%#\s\\]/.test(req.url),'INVALID_DISPLAY_REQUEST',400);
  const [path,query,extra] = req.url.split('?'), match = route.exec(path);
  displayCheck(match,'NOT_FOUND',404); displayCheck(extra === undefined,'INVALID_DISPLAY_REQUEST',400);
  if (!match[2]) { displayCheck(query === undefined,'INVALID_DISPLAY_REQUEST',400); return {cardId:match[1],front:false}; }
  const q = new URLSearchParams(query);
  displayCheck(query && q.toString() === query && [...q.keys()].join(',') === 'ownershipRevision,approvalActionId,version,publicHash'
    && /^(?:[1-9][0-9]{0,9})$/.test(q.get('ownershipRevision')) && /^(?:[1-9][0-9]{0,9})$/.test(q.get('version'))
    && Number(q.get('ownershipRevision')) < 2147483647 && Number(q.get('version')) < 2147483647
    && new RegExp(`^${UUID}$`).test(q.get('approvalActionId')) && /^[a-f0-9]{64}$/.test(q.get('publicHash')),'INVALID_DISPLAY_REQUEST',400);
  return {cardId:match[1],front:true,expected:{ownershipRevision:Number(q.get('ownershipRevision')),approvalActionId:q.get('approvalActionId'),version:Number(q.get('version')),publicHash:q.get('publicHash')}};
}

/** Unregistered optional GET handler; no bootstrap, generic writer or runtime.
 * The existing signed CustomerAuth ingress must admit the ORIGINAL request.
 * Bytes remain buffered until final trusted boundary/cookie pins revalidate. */
export function createCollectionDisplayHandler({customerState:state,displayService:service}={}) {
  if (!state || !service) return null;
  displayCheck(state.auth instanceof CustomerAuth && state.config === state.auth.config && typeof state.assertRequest === 'function'
    && typeof service.readDisplay === 'function' && typeof service.readFront === 'function' && service.mode === state.config.mode);
  const auth=state.auth,config=state.config,assertRequest=state.assertRequest,authority=CustomerAuth.prototype.authority,digest=CustomerAuth.prototype.digest;
  const readDisplay=service.readDisplay,readFront=service.readFront;
  const pins=()=>JSON.stringify([config.mode,config.origin,config.deploymentId,config.releaseSha,config.configHash,config.binding,config.cookies,config.sessionKey]);
  const pinned=pins();
  const current=()=>displayCheck(state.auth===auth && state.config===config && auth.config===config && auth.authority===authority
    && auth.digest===digest && state.assertRequest===assertRequest && service.readDisplay===readDisplay && service.readFront===readFront && service.mode===config.mode && pins()===pinned);
  current();
  function admit(req) {
    const admitted=assertRequest.call(state,req);
    if(admitted && typeof admitted.then==='function'){void Promise.resolve(admitted).catch(()=>{});throw displayError();}
    displayCheck(admitted===undefined);
    displayCheck(!req.headers?.['sec-fetch-site'] || ['same-origin','none'].includes(req.headers['sec-fetch-site']),'COLLECTION_DISPLAY_ACCESS_ENDED',403);
  }
  const requestPins=req=>JSON.stringify([req.method,req.url,Object.entries(req.headers??{}).sort(([a],[b])=>a.localeCompare(b)),req.socket?.remoteAddress]);
  return async (req,res) => {
    privateHeaders(res);
    try {
      current(); const input=parseCollectionDisplayRequest(req),cookie=req.headers?.cookie,url=req.url;
      admit(req);
      const admittedRequest=requestPins(req);
      authority.call(auth,cookie);
      const value=input.front?await readFront.call(service,cookie,input.cardId,input.expected):await readDisplay.call(service,cookie,input.cardId);
      current(); displayCheck(req.headers?.cookie===cookie && req.url===url && req.method==='GET');
      // Preserve the admitted original request without consuming ingress twice
      // or extending/restarting its route-proof time window after artifact I/O.
      displayCheck(requestPins(req)===admittedRequest,'COLLECTION_DISPLAY_ACCESS_ENDED',403);
      parseCollectionDisplayRequest(req); authority.call(auth,cookie);
      if(input.front){res.setHeader('Content-Type',value.contentType);res.setHeader('Content-Length',value.bytes.length);res.setHeader('X-Atlas-Image-Sha256',value.sha256);res.status(200).end(value.bytes);}
      else res.status(200).json(value);
    } catch(error) {
      const status=['SIGN_IN_REQUIRED'].includes(error?.code)||error?.status===401?401
        : ['COLLECTION_DISPLAY_ACCESS_ENDED','CUSTOMER_ACCESS_NOT_ENABLED','OWNERSHIP_REQUIRED'].includes(error?.code)||error?.status===403?403
          : ['INVALID_DISPLAY_REQUEST','NOT_FOUND','METHOD_NOT_ALLOWED'].includes(error?.code)?error.status:503;
      res.status(status).json({error:status===401||status===403?'COLLECTION_DISPLAY_ACCESS_ENDED':status===503?'COLLECTION_DISPLAY_UNAVAILABLE':error.code});
    }
  };
}
