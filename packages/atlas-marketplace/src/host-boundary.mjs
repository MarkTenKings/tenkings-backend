import { requireValue } from './contract.mjs';

// Trusted host composition may pin R1's exact deployment Host as well as its
// public host. This never broadens browser Origin, rewrites a signed request,
// accepts a forwarded header, or derives trust from request input.
export function createMarketplaceHostCheck({origin,acceptedHosts}={}) {
  const expected=new URL(origin);
  requireValue(expected.origin===origin&&(expected.protocol==='https:'||expected.protocol==='http:'&&['localhost','127.0.0.1'].includes(expected.hostname)),'HOST_CONFIGURATION_UNAVAILABLE');
  const values=acceptedHosts??[expected.host];
  requireValue(Array.isArray(values)&&values.length>0&&values.length<=4&&new Set(values).size===values.length&&values.includes(expected.host),'HOST_CONFIGURATION_UNAVAILABLE');
  for(const host of values) {
    requireValue(typeof host==='string'&&host.length<=253&&!/[\\/@?#\s*]/.test(host),'HOST_CONFIGURATION_UNAVAILABLE');
    let parsed;try{parsed=new URL('https://'+host);}catch{requireValue(false,'HOST_CONFIGURATION_UNAVAILABLE');}
    requireValue(parsed.host===host&&parsed.pathname==='/'&&!parsed.username&&!parsed.password&&!parsed.search&&!parsed.hash,'HOST_CONFIGURATION_UNAVAILABLE');
  }
  const pinned=new Set(values);
  return host=>typeof host==='string'&&pinned.has(host);
}
