import test from 'node:test';
import assert from 'node:assert/strict';
import {PARCEL_PRESETS,estimateParcelPreset,WHATNOT_CARD_PROFILE_BENCHMARK} from '../ui/parcel-presets.mjs';

test('catalog selection fills published dimensions while explicit weight stays an estimate',()=>{
  const estimate=estimateParcelPreset({presetId:'fedex_extra_small',weightOunces:8});
  assert.deepEqual(estimate.parcel,{lengthInches:7.25,widthInches:4.6875,heightInches:2.5,weightOunces:8});
  assert.equal(estimate.status,'ESTIMATE_ONLY');assert.equal(estimate.measurementRequired,true);
  assert.equal(estimate.weightBasis,'USER_COMPARISON_NOT_MEASURED');
  assert.equal('measurementRef' in estimate,false);assert.equal('priceCents' in estimate,false);
  assert.throws(()=>{estimate.parcel.weightOunces=1;},TypeError);
  assert.ok(PARCEL_PRESETS.every(item=>item.status==='ESTIMATE_ONLY'&&item.measurementRequired));
  assert.equal(WHATNOT_CARD_PROFILE_BENCHMARK.additionalItemOunces,0.5);
  assert.equal(WHATNOT_CARD_PROFILE_BENCHMARK.applicableProfile,'0–1 oz');
});

test('selection cannot silently invent a low default weight or an arbitrary package',()=>{
  for(const weightOunces of [undefined,null,'8',0,-1,Infinity,NaN,2401])assert.throws(()=>estimateParcelPreset({presetId:'fedex_small_flat',weightOunces}),/PARCEL_COMPARISON_WEIGHT_REQUIRED/);
  assert.throws(()=>estimateParcelPreset({presetId:'unverified',weightOunces:4}),/PARCEL_PRESET_UNKNOWN/);
  assert.match(PARCEL_PRESETS.find(item=>item.id==='fedex_small_deep').serviceNote,/expedited/);
  assert.match(PARCEL_PRESETS.find(item=>item.id==='fedex_office_brown_8').serviceNote,/plain brown/);
});
