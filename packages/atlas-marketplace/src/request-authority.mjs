import {AsyncLocalStorage} from 'node:async_hooks';
import {requireValue} from './contract.mjs';

// Trusted server request capability; never accepted from JSON or persisted.
// The canonical bridge supplies expiry/request pins and a fresh gateway read.
const active=new AsyncLocalStorage();
export function withMarketplaceRequestAuthority(actor,authority,work) {
  requireValue(typeof authority?.authorizeCommit==='function'&&typeof work==='function','AUTH_BOUNDARY_UNAVAILABLE');
  const scope=Object.freeze({id:actor.id,role:actor.role,authorizeCommit:authority.authorizeCommit,refreshAuthorization:authority.refreshAuthorization});
  return active.run(scope,work);
}
export function assertMarketplaceRequestAuthority(actor) {
  const scope=active.getStore();if(!scope)return true;
  if(actor)requireValue(actor.id===scope.id&&actor.role===scope.role,'SIGN_IN_REQUIRED');
  const result=scope.authorizeCommit();if(result&&typeof result.then==='function')void Promise.resolve(result).catch(()=>{});
  requireValue(result===true,'SIGN_IN_REQUIRED');return true;
}
export async function refreshMarketplaceRequestAuthority() {
  const scope=active.getStore();if(!scope)return true;
  assertMarketplaceRequestAuthority();
  if(scope.refreshAuthorization)requireValue(await scope.refreshAuthorization()===true,'SIGN_IN_REQUIRED');
  return assertMarketplaceRequestAuthority();
}
