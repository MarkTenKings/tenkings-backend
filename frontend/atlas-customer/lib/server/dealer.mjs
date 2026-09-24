import {DealerOperations} from '@atlas/dealer-operations';
import {cookies,deny,hash,keys,tokenShape,UUID} from './policy.mjs';

export const dealerRoute = path => /^\/api\/customer\/dealer\/(session|memberships|logout)$/.test(path);
export function createDealerAccess({auth,config}) {
 const operations = new DealerOperations({call:(action,data)=>auth.database.call(action,data),sessionKey:config.sessionKey});
 const name=config.mode==='PRODUCTION'?'__Secure-atlas_dealer_session':'atlas_dealer_local_session';
 const cookie=(value,age)=>`${name}=${value}; HttpOnly;${config.mode==='PRODUCTION'?' Secure;':''} Path=/account; SameSite=Strict; Max-Age=${age}`;
 const credentials=header=>{
  const jar=cookies(header), browser=jar[config.cookies.browser], session=jar[name];
  if(!tokenShape(browser)||!tokenShape(session))deny(401,'DEALER_SIGN_IN_REQUIRED');
  return {session,browserHash:hash(browser)};
 };
 return {
  async handle(req,res){
   const path=(req.url??'').split('?')[0],method=req.method,csrf=req.headers['x-atlas-customer-csrf'];
   if(!dealerRoute(path))deny(404,'NOT_FOUND');
   if(new URL(req.url,config.origin).search)deny(400,'INVALID_REQUEST');
   if(path.endsWith('/memberships')){
    if(method!=='GET')deny(405,'METHOD_NOT_ALLOWED');
    return auth.call(req.headers.cookie,'dealer_memberships',{});
   }
   if(path.endsWith('/session')&&method==='POST'){
    keys(req.body,['locationId']);if(!UUID.test(req.body.locationId??''))deny(400,'INVALID_REQUEST');
    const authority=auth.authority(req.headers.cookie,csrf??'');
    const result=await operations.enter(authority,req.body.locationId);
    res.setHeader('Set-Cookie',cookie(result.sessionToken,28800));
    const {sessionToken,...projection}=result;return projection;
   }
   const {session,browserHash}=credentials(req.headers.cookie);
   if(path.endsWith('/session')&&method==='GET')return {...await operations.read(session,browserHash),csrf:operations.csrf(session)};
   if(path.endsWith('/logout')&&method==='POST'){
    keys(req.body,[]);let result;
    try{result=await operations.logout(session,browserHash,csrf??'');}catch(error){if(error.code)deny(error.status,error.code);throw error;}
    res.setHeader('Set-Cookie',cookie('',0));return result;
   }
   deny(405,'METHOD_NOT_ALLOWED');
  }
 };
}
