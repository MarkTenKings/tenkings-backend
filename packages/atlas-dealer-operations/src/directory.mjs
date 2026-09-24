/** Public location projections contain no terminal, membership or customer data. */
export function selectLocations(locations, {query = '', lat, lng} = {}) {
  const search = String(query).trim().toLocaleLowerCase().slice(0, 180);
  const latitude = lat === undefined || lat === '' ? NaN : Number(lat);
  const longitude = lng === undefined || lng === '' ? NaN : Number(lng);
  const position = Number.isFinite(latitude) && Math.abs(latitude) <= 90 && Number.isFinite(longitude) && Math.abs(longitude) <= 180 ? {lat:latitude,lng:longitude} : null;
  return locations.filter(location => !search || [location.name, ...Object.values(location.address)].join(' ').toLocaleLowerCase().includes(search))
    .map(location => ({...location, distanceMiles:distance(position,location.position)}))
    .sort((a,b) => (a.distanceMiles ?? Infinity)-(b.distanceMiles ?? Infinity) || a.name.localeCompare(b.name));
}
function distance(a,b) {
  if (!a || !b) return null;
  const rad = Math.PI / 180, dLat = (a.lat-b.lat)*rad, dLng=(a.lng-b.lng)*rad;
  const h = Math.sin(dLat/2)**2 + Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dLng/2)**2;
  return 3958.7613*2*Math.asin(Math.sqrt(Math.max(0,Math.min(1,h))));
}
export function locationTime(value, timeZone) {
  if (!value) return 'Schedule unavailable';
  return new Intl.DateTimeFormat('en-US',{timeZone,weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(value));
}
export function scheduleText(schedule) {
  const weekdays = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  return {pickups:schedule.pickups.map(p=>`${weekdays[p.weekday]} ${p.time} (cutoff ${p.cutoff})`).join('; '),
    returns:schedule.returns.map(p=>`${weekdays[p.weekday]} ${p.time}`).join('; '),timeZone:schedule.timeZone};
}
