const check = (ok) => { if (!ok) throw new Error('DEALER_DIRECTORY_INVALID'); };
const plain = value => value && Object.getPrototypeOf(value) === Object.prototype;
const text = (value, max = 160) => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const exact = (value, required, optional = []) => check(plain(value) && required.every(k => Object.hasOwn(value,k)) && Object.keys(value).every(k => [...required,...optional].includes(k)));
export const EMPTY_DEALER_DIRECTORY = Object.freeze({ version:'atlas-dealer-directory-v1', updatedAt:null, dealers:[] });
export function httpsLink(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !/[\x00-\x20\x7f]/.test(value) && url.hostname.includes('.') && !url.port; } catch { return false; }
}
export function parseDealerDirectory(value) {
  exact(value,['version','updatedAt','dealers']);
  check(value.version === 'atlas-dealer-directory-v1' && (value.updatedAt === null || date(value.updatedAt)) && Array.isArray(value.dealers) && value.dealers.length <= 1000);
  const ids = new Set();
  for (const dealer of value.dealers) {
    exact(dealer,['id','name','authorizedAt','authorizationExpiresAt','services','address','position','website','phone','programs'],['contactOnly']);
    check(/^[a-z0-9][a-z0-9-]{0,63}$/.test(dealer.id) && !ids.has(dealer.id)); ids.add(dealer.id);
    check(text(dealer.name) && date(dealer.authorizedAt) && (dealer.authorizationExpiresAt === null || date(dealer.authorizationExpiresAt) && Date.parse(dealer.authorizationExpiresAt) > Date.parse(dealer.authorizedAt)));
    check(!Object.hasOwn(dealer,'contactOnly') || dealer.contactOnly === true);
    check(Array.isArray(dealer.services) && (dealer.contactOnly ? dealer.services.length === 0 : dealer.services.length > 0) && dealer.services.length <= 2 && new Set(dealer.services).size === dealer.services.length && dealer.services.every(v => ['BUY','SUBMIT'].includes(v)));
    exact(dealer.address,['line1','city','region','postalCode','country']);
    check(Object.values(dealer.address).every(v => text(v)) && /^[A-Z]{2}$/.test(dealer.address.country));
    if (dealer.position !== null) { exact(dealer.position,['lat','lng']); check(Number.isFinite(dealer.position.lat) && Math.abs(dealer.position.lat) <= 90 && Number.isFinite(dealer.position.lng) && Math.abs(dealer.position.lng) <= 180); }
    check(dealer.website === null || httpsLink(dealer.website));
    check(dealer.phone === null || /^\+[1-9][0-9]{6,14}$/.test(dealer.phone));
    // Authorization to appear in the directory does not supply buying or
    // submission terms. Contact-only partners cannot assert a service/program.
    check(!dealer.contactOnly || dealer.website !== null || dealer.phone !== null);
    check(Array.isArray(dealer.programs) && dealer.programs.length <= 12 && (!dealer.programs.length || dealer.services.includes('SUBMIT')));
    for (const program of dealer.programs) {
      exact(program,['name','priceMinor','currency','turnaroundBusinessDays','terms','expiresAt']);
      check(text(program.name,100) && Number.isSafeInteger(program.priceMinor) && program.priceMinor >= 0 && /^[A-Z]{3}$/.test(program.currency) && text(program.terms,1200) && date(program.expiresAt));
      exact(program.turnaroundBusinessDays,['min','max']);
      check(Number.isSafeInteger(program.turnaroundBusinessDays.min) && Number.isSafeInteger(program.turnaroundBusinessDays.max) && program.turnaroundBusinessDays.min >= 1 && program.turnaroundBusinessDays.max >= program.turnaroundBusinessDays.min && program.turnaroundBusinessDays.max <= 365);
    }
  }
  check(value.dealers.length === 0 || value.updatedAt !== null);
  return structuredClone(value);
}
export function activeDealers(directory, now = Date.now()) {
  return parseDealerDirectory(directory).dealers.filter(d => Date.parse(d.authorizedAt) <= now && (d.authorizationExpiresAt === null || Date.parse(d.authorizationExpiresAt) > now))
    .map(d => ({...d, programs:d.programs.filter(p => Date.parse(p.expiresAt) > now)}));
}
export function distanceMiles(from,to) {
  if (!from || !to || ![from.lat,from.lng,to.lat,to.lng].every(Number.isFinite) || Math.abs(from.lat)>90 || Math.abs(from.lng)>180 || Math.abs(to.lat)>90 || Math.abs(to.lng)>180) return null;
  const rad = Math.PI/180, dLat = (to.lat-from.lat)*rad, dLng = (to.lng-from.lng)*rad;
  const h = Math.sin(dLat/2)**2 + Math.cos(from.lat*rad)*Math.cos(to.lat*rad)*Math.sin(dLng/2)**2;
  return 3958.7613 * 2 * Math.asin(Math.sqrt(Math.max(0,Math.min(1,h))));
}
export function selectDealers(dealers,{query='',service='ALL',position=null}={}) {
  const search=query.trim().toLocaleLowerCase();
  return dealers.filter(d => (service === 'ALL' || d.services.includes(service) || d.contactOnly === true) && (!search || [d.name,...Object.values(d.address)].join(' ').toLocaleLowerCase().includes(search)))
    .map(d => ({...d,distanceMiles:distanceMiles(position,d.position)}))
    .sort((a,b) => (a.distanceMiles ?? Infinity)-(b.distanceMiles ?? Infinity) || a.name.localeCompare(b.name));
}
export function dealerDirections(dealer) {
  const params = new URLSearchParams({api:'1',destination:[dealer.address.line1,dealer.address.city,dealer.address.region,dealer.address.postalCode,dealer.address.country].join(', ')});
  return `https://www.google.com/maps/dir/?${params}`;
}
