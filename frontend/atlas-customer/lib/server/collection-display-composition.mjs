// Optional current-owner display wiring. No I/O on import/construction and no
// URL, credential, SQL, role or generic writer configuration is accepted.
import { CustomerAuth } from './auth.mjs';
import { privateHeaders } from './policy.mjs';
import { displayCheck } from '../collection-display-contract.mjs';
import { createCollectionApprovedReader } from './collection-approved-reader.mjs';
import { createCollectionDisplayService } from './collection-display-service.mjs';
import { createCollectionDisplayHandler, parseCollectionDisplayRequest } from './collection-display-http.mjs';

const UUID='[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
const route=new RegExp(`^/api/customer/collection/cards/${UUID}/display(?:/front)?$`);
export const isCollectionDisplayPath=path=>typeof path==='string'&&route.test(path);
const exactRead=value=>value&&Object.getPrototypeOf(value)===Object.prototype&&Reflect.ownKeys(value).length===1&&typeof value.read==='function';

/** enabled is the exact server flag string '1'. Missing/malformed configuration
 * returns a private unavailable handler with no reads/fetches. The display hint
 * is configuration only; ownership/session/read readiness is checked on reads.
 * The supplied request is a server test seam for the fixed-public reader, never
 * a browser-provided transport. One shared service retains its two-read bound.
 */
export function createCollectionDisplayComposition(options={}) {
  const {customerState:state,enabled,request=fetch}=options;
  const auth=state?.auth,config=state?.config,guard=state?.assertRequest,owner=state?.ownershipRead,read=owner?.read;
  const authority=CustomerAuth.prototype.authority,digest=CustomerAuth.prototype.digest;
  const pins=()=>JSON.stringify([config?.mode,config?.origin,config?.deploymentId,config?.releaseSha,config?.configHash,
    config?.binding,config?.cookies,config?.sessionKey,config?.routerKey,config?.deploymentHost]);
  const encoded=pins();let closed=false,handler=null;
  const current=()=>displayCheck(!closed&&enabled==='1'&&options.enabled===enabled&&options.customerState===state
    &&(options.request??fetch)===request&&state.auth===auth&&state.config===config&&auth.config===config
    &&auth.authority===authority&&auth.digest===digest&&state.assertRequest===guard&&state.ownershipRead===owner
    &&exactRead(owner)&&owner.read===read&&pins()===encoded);
  try {
    displayCheck(enabled==='1'&&typeof request==='function'&&auth instanceof CustomerAuth&&auth.config===config
      &&typeof guard==='function'&&exactRead(owner)&&['PRODUCTION','LOCAL_FIXTURE'].includes(config.mode));
    current();
    const checkedOwner=Object.freeze({async read(...args){current();const value=await Reflect.apply(read,owner,args);current();return value;}});
    const approved=createCollectionApprovedReader({enabled:true,request(...args){current();return Reflect.apply(request,undefined,args);}});
    const service=createCollectionDisplayService({ownershipRead:checkedOwner,approvedReader:approved,mode:config.mode});
    handler=createCollectionDisplayHandler({customerState:state,displayService:service});
  } catch { /* Display only remains unavailable; other customer routes survive. */ }
  return Object.freeze({
    get configuredForDisplay(){try{current();return handler!==null;}catch{return false;}},
    async handler(req,res){
      privateHeaders(res);
      try {parseCollectionDisplayRequest(req);current();displayCheck(handler);}
      catch(error){const status=[400,404,405].includes(error?.status)?error.status:503;
        return res.status(status).json({error:status===503?'COLLECTION_DISPLAY_UNAVAILABLE':error.code});}
      return handler(req,res);
    },
    close(){closed=true;},
  });
}
