export {EMPTY_DEALER_DIRECTORY,activeDealers,parseDealerDirectory,distanceMiles,dealerDirections,httpsLink} from '@atlas/report-view/dealer-directory';
import {selectDealers as selectContacts} from '@atlas/report-view/dealer-directory';
/** A contact listing is never proof of an enabled submission kiosk. */
export function selectDealers(dealers, options={}) {
 const service=options.service??'ALL';
 const eligible=dealers.filter(d=>service==='SUBMIT'?d.kiosk===true:service==='BUY'?d.services.includes('BUY'):true);
 return selectContacts(eligible,{...options,service:'ALL'});
}
export function withKiosks(directory, payload) {
 const locations=payload?.locations;
 if(!Array.isArray(locations)) throw new Error('KIOSK_DIRECTORY_UNAVAILABLE');
 return {...directory, dealers:[...locations.map(location=>({...location,kiosk:true,services:['SUBMIT'],programs:[],phone:null,website:null,contactOnly:false})),
 ...directory.dealers.map(dealer=>({...dealer,services:dealer.services.filter(s=>s!=='SUBMIT'),programs:[]}))]};
}
export function formatLocationTime(value,timeZone) {
 return value?new Intl.DateTimeFormat('en-US',{timeZone,weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(value)):'Schedule unavailable';
}
export function routeTimes(slots=[]) {
 const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
 return slots.map(slot=>`${days[slot.weekday]} ${slot.time}${slot.cutoff?` (cutoff ${slot.cutoff})`:''}`).join('; ');
}
