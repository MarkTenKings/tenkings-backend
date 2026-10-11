const test=require('node:test'),assert=require('node:assert/strict');
const {searchAtlasSoldPhotoPool}=require('../dist');
const input={category:'POKEMON',year:'2023',productSet:'Scarlet & Violet 151',cardName:'Pikachu',parallel:'English Cosmos Holofoil',cardNumber:'025/165',queryOverride:'2023 Scarlet & Violet 151 Pikachu Cosmo Holo 25/165 grade 8.5'};
test('new ATLAS photo pool retains every row, duplicate, long/missing title, conflicting ID and unknown price without a timer',async()=>{
 const rows=Array.from({length:80},(_,i)=>({title:i%2?'x'.repeat(900):null,itemId:'conflicting',url:i%3?'https://www.ebay.com/itm/227536166244':'not-a-link',thumbnailUrl:'https://i.ebayimg.com/images/g/photo/s-l1600.jpg',soldPrice:'22.50',soldCurrency:i%2?'GBP':'USD',bestOfferAccepted:i%2===0,endedAt:'2026-10-10'}));rows.push(null);
 const timer=global.setTimeout;let calls=0;global.setTimeout=()=>assert.fail('no application timeout');
 let response;try{response=await searchAtlasSoldPhotoPool(input,{apiKey:'synthetic-key',fetch:async(url,opts)=>{calls++;assert.equal(opts.signal.aborted,false);assert.equal(new URL(url).searchParams.get('keyword'),input.queryOverride);assert.equal(new URL(url).searchParams.get('count'),'240');return {ok:true,status:200,text:async()=>JSON.stringify({keyword:input.queryOverride,page:1,totalItems:rows.length,hasNextPage:false,items:rows})};}});}finally{global.setTimeout=timer;}
 assert.equal(calls,1);assert.equal(response.responsePolicy,'ATLAS_SLAB_V1');assert.equal(response.items.length,81);assert.equal(new Set(response.items.map(r=>r.id)).size,81);assert.equal(response.items[1].title.length,900);
 assert.equal(response.items[0].listingUrl,null);assert.equal(response.items[1].providerItemId,'conflicting');assert.equal(response.items[0].priceBasis,'UPPER_BOUND');assert.equal(response.items[1].currency,'GBP');assert.equal(response.items[1].soldPriceCents,2250);assert.equal(response.items[80].priceBasis,'UNKNOWN');assert.equal(response.items[80].soldPriceCents,null);assert.equal(response.acquisitionDiagnostics.retainedItemCount,81);
 assert.equal('classificationExcluded'in response,false);assert.equal('candidates'in response,false);
});
