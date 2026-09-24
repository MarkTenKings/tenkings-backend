import {randomBytes,createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {selectLocations} from './directory.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const token = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const fail = (status,code) => {throw Object.assign(new Error(code),{status,code});};
const same = (a,b) => typeof a === 'string' && typeof b === 'string' && a.length===b.length && timingSafeEqual(Buffer.from(a),Buffer.from(b));
/** Uses the existing customer gateway; SQL rechecks its own dealer session and
 * membership. A customer login alone cannot read any dealer projection. */
export class DealerOperations {
  constructor({call,sessionKey}) {
    if(typeof call !== 'function' || !(typeof sessionKey === 'string' && sessionKey.length>=32 || Buffer.isBuffer(sessionKey) && sessionKey.length===32)) throw new Error('DEALER_CONFIGURATION_REQUIRED');
    this.call=call;this.sessionKey=sessionKey;
  }
  csrf(value) { return createHmac('sha256',this.sessionKey).update(`atlas-dealer-v1:${value}`).digest('hex'); }
  async enter(customerAuthority,locationId) {
    const sessionToken=randomBytes(32).toString('base64url');
    const result=await this.call('dealer_enter',{...customerAuthority,locationId,dealerSessionHash:hash(sessionToken)});
    return {...result,sessionToken,csrf:this.csrf(sessionToken)};
  }
  authority(sessionToken,browserHash,csrf) {
    if(!token(sessionToken) || !/^[a-f0-9]{64}$/.test(browserHash??'')) fail(401,'DEALER_SIGN_IN_REQUIRED');
    if(csrf!==undefined&&!same(csrf,this.csrf(sessionToken))) fail(403,'CSRF_REQUIRED');
    return {dealerSessionHash:hash(sessionToken),browserHash};
  }
  read(sessionToken,browserHash) {return this.call('dealer_read',this.authority(sessionToken,browserHash));}
  logout(sessionToken,browserHash,csrf) {return this.call('dealer_logout',this.authority(sessionToken,browserHash,csrf));}
  async locations(options={}) {
    const result=await this.call('dealer_locations',{entry:options.entry??null});
    return {...result,locations:selectLocations(result.locations,options)};
  }
}
export const DEALER_COOKIE_NAME='__Secure-atlas-dealer-session';
export const DEALER_COOKIE_ATTRIBUTES={httpOnly:true,secure:true,sameSite:'strict',path:'/account',maxAge:8*60*60};
