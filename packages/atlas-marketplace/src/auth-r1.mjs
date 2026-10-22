import { timingSafeEqual } from 'node:crypto';
import { hash, requireValue } from './contract.mjs';

export const R1_SESSION_ACCESS_ACTION = 'marketplace_session_access';
export const R1_SESSION_ACCESS_SCHEMA = 'atlas-marketplace-session-access-v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const plain = value => value && Object.getPrototypeOf(value) === Object.prototype;
const closed = (value, keys) => plain(value) && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(value,key)??{},'value'));
const unavailable = value => requireValue(value, 'AUTH_BOUNDARY_UNAVAILABLE');
const signedIn = value => requireValue(value, 'SIGN_IN_REQUIRED');
const time = value => value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
const configPin = config => JSON.stringify([config.mode,config.origin,config.deploymentId,config.releaseSha,config.configHash,config.binding??null,config.cookies,config.basePath??null,config.deploymentHost??null]);
const requestPin = req => JSON.stringify([req.method,req.url,Object.entries(req.headers??{}).sort(([a],[b])=>a.localeCompare(b)),req.body??null,req.rawBody??null,req.socket?.remoteAddress??null]);
const sameToken = (a,b) => typeof a==='string' && typeof b==='string' && HASH.test(a) && HASH.test(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));

/** Inert R1 composition only. Canonical classes/instances come from trusted R1
 * imports, never request input. This module imports no R1 runtime or credentials.
 * The proposed customer gateway action does not exist in current R1: unavailable
 * remains the correct result until its SQL and deployment binding are approved.
 */
export function createR1MarketplaceAuthBridge(options={}) {
  const { enabled=false,environment,policy,staff,customer,admitRequest,clock=Date.now,requestTtlMs=30000 }=options;
  const policyPin=policy?hash(policy):null;
  function configured() {
    unavailable(enabled===true && options.enabled===true && options.environment===environment && ['PROVIDER_SANDBOX','PRODUCTION'].includes(environment));
    unavailable(policy?.approved===true && typeof policy.approvalRef==='string' && policy.approvalRef.trim().length>0 && policy.environment===environment && ['LOCAL_FIXTURE','PRODUCTION'].includes(policy.r1Mode));
    unavailable(environment!=='PRODUCTION'||policy.r1Mode==='PRODUCTION');
    unavailable(options.policy===policy && hash(policy)===policyPin && options.staff===staff && options.customer===customer && options.admitRequest===admitRequest && typeof admitRequest==='function');
    unavailable(Number.isSafeInteger(requestTtlMs)&&requestTtlMs>0&&requestTtlMs<=60000);
  }
  return Object.freeze({ open(originalRequest,{audience}={}) {
    configured();
    unavailable(['STAFF','BUYER','SELLER'].includes(audience));
    const isStaff=audience==='STAFF', source=isStaff?staff:customer, state=source?.state, auth=state?.auth, config=auth?.config;
    const AuthClass=isStaff?source?.DurableStaffAuth:source?.CustomerAuth;
    const database=auth?.database, DatabaseClass=source?.CustomerDatabase;
    const authenticate=AuthClass?.prototype?.authenticate, withStaff=AuthClass?.prototype?.withStaff;
    const authority=AuthClass?.prototype?.authority, digest=AuthClass?.prototype?.digest, databaseCall=DatabaseClass?.prototype?.call;
    const guard=state?.assertRequest, boundary=source?.boundary, transaction=boundary?.transaction;
    unavailable(typeof AuthClass==='function' && auth instanceof AuthClass && config && typeof digest==='function' && typeof guard==='function');
    unavailable(config.mode===policy.r1Mode && typeof config.origin==='string' && config.origin===new URL(config.origin).origin);
    unavailable(config.mode!=='PRODUCTION'||config.origin.startsWith('https://'));
    unavailable(isStaff ? auth.actors instanceof WeakMap && typeof authenticate==='function' && typeof withStaff==='function' && typeof transaction==='function'
      : typeof DatabaseClass==='function' && database instanceof DatabaseClass && database.config===config && typeof authority==='function' && typeof databaseCall==='function' && state.config===config);
    const allowedRoles=isStaff?policy.staffRoles:policy.customerRoles;
    // STAFF exposes mutations. An approved allowlist cannot promote OBSERVER
    // into this write-capable surface; a future read-only role is separate.
    unavailable(Array.isArray(allowedRoles)&&allowedRoles.length>0&&new Set(allowedRoles).size===allowedRoles.length&&allowedRoles.every(role=>(isStaff?['REVIEWER']:['BUYER','SELLER']).includes(role)));
    if(!isStaff) unavailable(allowedRoles.includes(audience));
    const start=clock(), deadline=start+requestTtlMs, pinnedConfig=configPin(config), pinnedRequest=requestPin(originalRequest);
    unavailable(Number.isSafeInteger(start)&&Number.isSafeInteger(deadline));
    const req=originalRequest, cookie=req.headers?.cookie??'', method=req.method, target=req.url;
    signedIn(typeof cookie==='string'&&cookie.length>0&&cookie.length<=8192);
    unavailable(['GET','POST'].includes(method)&&typeof target==='string'&&target.startsWith('/')&&!target.startsWith('//')&&!/[\\#\s]/.test(target));
    requireValue(req.headers?.authorization===undefined,'COOKIE_REQUIRED');
    requireValue(!req.headers?.origin||req.headers.origin===config.origin,'ORIGIN_REFUSED');
    requireValue(!req.headers?.['sec-fetch-site']||['same-origin','none'].includes(req.headers['sec-fetch-site']),'CROSS_SITE_REFUSED');
    if(method==='POST') requireValue(req.headers?.origin===config.origin,'ORIGIN_REFUSED');
    let ended=false, principal=null, staffHandle=null, originalAccess=null, csrfVerified=false, admitted=false, dispatched=false, normalizedPath=null;
    function current() {
      configured(); signedIn(!ended&&!req.aborted&&clock()<deadline);
      unavailable(source.state===state && state.auth===auth && auth.config===config && auth.database===database && state.assertRequest===guard && configPin(config)===pinnedConfig && requestPin(req)===pinnedRequest && auth.digest===digest && AuthClass.prototype.digest===digest);
      unavailable(isStaff ? source.DurableStaffAuth===AuthClass && source.boundary===boundary && boundary.transaction===transaction && auth.authenticate===authenticate && auth.withStaff===withStaff && AuthClass.prototype.authenticate===authenticate && AuthClass.prototype.withStaff===withStaff
        : source.CustomerAuth===AuthClass && source.CustomerDatabase===DatabaseClass && auth.authority===authority && AuthClass.prototype.authority===authority && database.call===databaseCall && DatabaseClass.prototype.call===databaseCall && database.config===config && state.config===config);
    }
    current();
    const admission=guard.call(state,req);
    if(admission&&typeof admission.then==='function') { void Promise.resolve(admission).catch(()=>{}); unavailable(false); }
    unavailable(admission===undefined); current();
    function exactPrincipal(value) { current(); signedIn(principal&&value===principal&&principal.expiresAt>clock()); }
    function sameAccess(access) {
      if(originalAccess) signedIn(access.id===originalAccess.id&&access.sessionHash===originalAccess.sessionHash&&access.browserHash===originalAccess.browserHash&&access.sourceRole===originalAccess.sourceRole&&access.accessVersion===originalAccess.accessVersion);
      signedIn(Number.isSafeInteger(access.expiresAt)&&access.expiresAt>clock());
      return access;
    }
    async function readAccess() {
      current();
      let access;
      if(isStaff) {
        if(!staffHandle) staffHandle=await authenticate.call(auth,cookie);
        current(); const handle=auth.actors.get(staffHandle); signedIn(handle&&HASH.test(handle.sessionHash)&&HASH.test(handle.browserHash));
        access=await withStaff.call(auth,staffHandle,async context=>{
          current(); const identity=context.identity, session=context.session;
          signedIn(UUID.test(identity?.id??'')&&allowedRoles.includes(identity.role)&&Number.isSafeInteger(identity.accessVersion)&&identity.accessVersion>0&&session?.tokenHash===handle.sessionHash&&session.browserHash===handle.browserHash&&session.identityId===identity.id&&session.accessVersion===identity.accessVersion);
          return {id:identity.id,sourceRole:identity.role,accessVersion:identity.accessVersion,sessionHash:handle.sessionHash,browserHash:handle.browserHash,expiresAt:time(session.expiresAt)};
        });
      } else {
        const capability=authority.call(auth,cookie);
        unavailable(closed(capability,['sessionHash','browserHash'])&&HASH.test(capability.sessionHash)&&HASH.test(capability.browserHash));
        let result;
        try { result=await databaseCall.call(database,R1_SESSION_ACCESS_ACTION,{sessionHash:capability.sessionHash,browserHash:capability.browserHash}); }
        catch(error) { if(['SIGN_IN_REQUIRED','SIGN_IN_SESSION_EXPIRED'].includes(error?.code)) signedIn(false); unavailable(false); }
        current();
        unavailable(closed(result,['schema','accountId','sessionHash','browserHash','expiresAt','observedAt'])&&result.schema===R1_SESSION_ACCESS_SCHEMA&&UUID.test(result.accountId??'')&&result.sessionHash===capability.sessionHash&&result.browserHash===capability.browserHash&&Number.isSafeInteger(result.expiresAt)&&Number.isSafeInteger(result.observedAt)&&result.observedAt<=clock()&&clock()-result.observedAt<=requestTtlMs&&result.expiresAt>result.observedAt);
        access={id:result.accountId,sourceRole:audience,accessVersion:null,sessionHash:result.sessionHash,browserHash:result.browserHash,expiresAt:result.expiresAt};
      }
      current(); return sameAccess(access);
    }
    async function revalidateStaffBoundary() {
      await transaction.call(boundary,staffHandle,async context=>{
        current(); unavailable(typeof context.refresh==='function');
        const verify=found=>signedIn(found?.principal?.id===originalAccess.id&&found.principal.role===originalAccess.sourceRole&&found.principal.accessVersion===originalAccess.accessVersion&&allowedRoles.includes(found.principal.role));
        verify(context); verify(await context.refresh()); current();
      });
      current();
    }
    const token=()=>digest.call(auth,`atlas-marketplace-csrf-v1:${environment}:${audience}:${policy.approvalRef}:${originalAccess.sessionHash}:${originalAccess.browserHash}`);
    return Object.freeze({
      async resolveSession(input={}) {
        current(); signedIn(input.cookie===cookie&&input.method===method);
        unavailable(typeof input.path==='string'&&input.path.startsWith('/')&&input.path.length<=2000&&(normalizedPath===null||normalizedPath===input.path)); normalizedPath=input.path;
        const access=await readAccess();
        if(!principal) {
          originalAccess=Object.freeze(access);
          const sessionId=digest.call(auth,`atlas-marketplace-session-v1:${audience}:${access.sessionHash}:${access.browserHash}`);
          unavailable(HASH.test(sessionId));
          principal=Object.freeze({authenticated:true,sessionId:`r1_${sessionId}`,expiresAt:Math.min(deadline,access.expiresAt),actor:Object.freeze({id:access.id,role:audience})});
        }
        return principal;
      },
      async issueCsrf(value) { exactPrincipal(value); await readAccess(); const valueToken=token(); unavailable(HASH.test(valueToken)); return valueToken; },
      async verifyCsrf(input) {
        exactPrincipal(input?.principal); signedIn(input.method===method&&input.path===normalizedPath);
        if(method!=='POST'||!sameToken(input.token,token())) return false;
        await readAccess(); csrfVerified=true; return true;
      },
      async admitRequest(input) {
        exactPrincipal(principal); signedIn(input?.sessionId===principal.sessionId&&input.actorId===principal.actor.id&&input.method===method&&input.path===normalizedPath);
        if(admitted) return true;
        const accepted=await admitRequest({sessionId:principal.sessionId,actorId:principal.actor.id,role:audience,method,path:input.path,originalTarget:target});
        current(); admitted=accepted===true; return admitted;
      },
      async withAuthorized(value,work) {
        exactPrincipal(value); requireValue(admitted,'RATE_LIMITED'); requireValue(method!=='POST'||csrfVerified,'CSRF_REFUSED'); requireValue(!dispatched&&typeof work==='function','AUTH_REQUEST_CONSUMED');
        dispatched=true; await readAccess();
        if(isStaff) await revalidateStaffBoundary();
        // Provider/service work must never hold R1's authority row locks or its
        // five-second Prisma transaction. A later denial withholds the response
        // but cannot attest rollback of a separately committed effect.
        const output=await work(principal.actor);
        if(isStaff) await revalidateStaffBoundary();
        await readAccess(); return output;
      },
      close() { ended=true; principal=null; staffHandle=null; originalAccess=null; },
    });
  } });
}
