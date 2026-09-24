import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {activeDealers,parseDealerDirectory,selectDealers,distanceMiles,dealerDirections} from '../lib/dealers.mjs';
import {dealerDirectory} from '../lib/server/dealers.mjs';
const now=Date.parse('2026-09-22T12:00:00.000Z');
const entry=(id,lat)=>({id,name:`Fixture ${id}`,authorizedAt:'2026-09-01T00:00:00.000Z',authorizationExpiresAt:null,services:['BUY','SUBMIT'],address:{line1:'100 Test Street',city:'Fixture City',region:'CA',postalCode:'90000',country:'US'},position:{lat,lng:-118},website:'https://example.com/',phone:null,programs:[]});
const directory=()=>({version:'atlas-dealer-directory-v1',updatedAt:'2026-09-22T00:00:00.000Z',dealers:[entry('a',34),entry('b',35)]});
test('an unconfigured directory contains no invented dealer or map credentials',()=>assert.deepEqual(dealerDirectory({},now),{dealers:[],updatedAt:null,map:null}));
test('expired authorization/programs and future dealers cannot reach the public list',()=>{
 const d=directory();d.dealers[0].authorizationExpiresAt='2026-09-21T00:00:00.000Z';d.dealers[1].programs=[{name:'Expired',priceMinor:1000,currency:'USD',turnaroundBusinessDays:{min:2,max:5},terms:'Fixture only',expiresAt:'2026-09-21T00:00:00.000Z'}];
 assert.deepEqual(activeDealers(d,now).map(x=>[x.id,x.programs]),[['b',[]]]);
 d.dealers[1].authorizedAt='2026-09-23T00:00:00.000Z';assert.equal(activeDealers(d,now).length,0);
});
test('nearest ordering uses actual coordinates, keeps unlocated dealers, and filters service and address',()=>{
 const d=directory();d.dealers.push({...entry('c',0),position:null,services:['SUBMIT']});
 assert.deepEqual(selectDealers(d.dealers,{position:{lat:35.1,lng:-118}}).map(x=>x.id),['b','a','c']);
 assert.equal(selectDealers(d.dealers,{query:'90000',service:'BUY'}).length,2);
 assert.equal(selectDealers(d.dealers,{query:'nothing'}).length,0);
 assert.equal(distanceMiles({lat:35,lng:-118},{lat:35,lng:-118}),0);assert.equal(distanceMiles(null,{lat:35,lng:-118}),null);
});
test('directory refuses duplicate IDs, code links, malformed coordinates and invented negative prices',()=>{
 for(const mutate of [d=>d.dealers[1].id='a',d=>d.dealers[0].website='javascript:alert(1)',d=>d.dealers[0].position.lat=91,d=>d.dealers[0].secret='internal',d=>d.dealers[0].programs=[{name:'No',priceMinor:-1,currency:'USD',turnaroundBusinessDays:{min:2,max:1},terms:'No',expiresAt:'2027-01-01T00:00:00.000Z'}]]){const d=directory();mutate(d);assert.throws(()=>parseDealerDirectory(d));}
});
test('directions preserves supplied address as URL data only',()=>{
 const d=entry('a',34);d.address.line1='1 A & B Street';const url=new URL(dealerDirections(d));assert.equal(url.origin,'https://www.google.com');assert.equal(url.searchParams.get('api'),'1');assert.match(url.searchParams.get('destination'),/^1 A & B Street,/);
});
test('only full valid optional map configuration is exposed',()=>{
 const source=JSON.stringify(directory());assert.equal(dealerDirectory({ATLAS_PUBLIC_DEALER_DIRECTORY_JSON:source,ATLAS_PUBLIC_GOOGLE_MAPS_BROWSER_KEY:'x'.repeat(30)},now).map,null);
 const result=dealerDirectory({ATLAS_PUBLIC_DEALER_DIRECTORY_JSON:source,ATLAS_PUBLIC_GOOGLE_MAPS_BROWSER_KEY:'x'.repeat(30),ATLAS_PUBLIC_GOOGLE_MAP_ID:'f'.repeat(16)},now);assert.equal(result.dealers.length,2);assert.equal(result.map.mapId,'f'.repeat(16));
});
test('owner-authorized contact-only shop is discoverable without inferred services, terms, pins or phone',()=>{
 const source=readFileSync(new URL('../config/authorized-dealers-20260923.json',import.meta.url),'utf8');
 const result=dealerDirectory({ATLAS_PUBLIC_DEALER_DIRECTORY_JSON:source},Date.parse('2026-09-24T00:00:00.000Z'));
 assert.equal(result.dealers.length,1);assert.equal(result.map,null);
 const [dealer]=result.dealers;assert.equal(dealer.id,'centercourt-cards-roseville');
 assert.equal(dealer.contactOnly,true);assert.deepEqual(dealer.services,[]);assert.deepEqual(dealer.programs,[]);
 assert.equal(dealer.phone,null);assert.equal(dealer.position,null);assert.equal(dealer.website,'https://www.centercourtcardsroseville.com/');
 for(const service of ['ALL','BUY','SUBMIT'])assert.equal(selectDealers(result.dealers,{query:'Roseville',service}).length,1);
 const destination=new URL(dealerDirections(dealer)).searchParams.get('destination');
 assert.equal(destination,'307 Lincoln St, Roseville, CA, 95678, US');
 assert.equal(selectDealers(result.dealers,{query:'95678'})[0].distanceMiles,null);
});
test('contact-only authorization cannot publish a service, program or unusable contact',()=>{
 const valid=()=>{const d=directory();d.dealers[0]={...d.dealers[0],contactOnly:true,services:[]};return d;};
 assert.equal(parseDealerDirectory(valid()).dealers[0].contactOnly,true);
 for(const mutate of [d=>d.dealers[0].contactOnly=false,d=>d.dealers[0].services=['BUY'],d=>d.dealers[0].website=null,d=>d.dealers[0].programs=[{name:'Invented',priceMinor:1000,currency:'USD',turnaroundBusinessDays:{min:2,max:5},terms:'Unsupported',expiresAt:'2027-01-01T00:00:00.000Z'}],d=>delete d.dealers[0].contactOnly]){
   const d=valid();mutate(d);assert.throws(()=>parseDealerDirectory(d));
 }
});
