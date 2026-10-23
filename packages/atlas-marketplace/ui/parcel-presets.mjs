// Published catalog dimensions are planning inputs, never measured parcel evidence.
const oneRate='https://www.fedex.com/en-us/shipping/one-rate.html';
const boxes='https://www.fedex.com/en-us/shipping/packing/supplies/boxes.html';
const preset=(id,name,lengthInches,widthInches,heightInches,serviceNote,source)=>Object.freeze({
  id,name,dimensions:Object.freeze({lengthInches,widthInches,heightInches}),
  status:'ESTIMATE_ONLY',dimensionBasis:'PUBLISHED_CATALOG_NOT_MEASURED',
  serviceNote,source,reviewedAt:'2026-10-23',measurementRequired:true
});
const brandedNote='FedEx branded packaging: qualify the exact expedited service and packaging code; do not use this as generic UPS or FedEx Ground packaging.';
export const PARCEL_PRESETS=Object.freeze([
  preset('fedex_extra_small','FedEx Extra Small Box',7.25,4.6875,2.5,brandedNote,oneRate),
  preset('fedex_small_flat','FedEx Small Box — flat',12.375,10.875,1.5,brandedNote,oneRate),
  preset('fedex_small_deep','FedEx Small Box — deeper',11.25,8.75,2.625,brandedNote,oneRate),
  preset('fedex_office_brown_8','FedEx Office brown box — 8 inch cube',8,8,8,'Purchased plain brown box; exact carrier, dimensions, packed weight and service eligibility still require verification.',boxes)
]);

// Caller supplies comparison weight. No default weight, card count capacity,
// provider packaging code, quoted price, or measured-evidence reference is inferred.
export function estimateParcelPreset({presetId,weightOunces}={}) {
  const selected=PARCEL_PRESETS.find(item=>item.id===presetId);
  if(!selected)throw new Error('PARCEL_PRESET_UNKNOWN');
  if(typeof weightOunces!=='number'||!Number.isFinite(weightOunces)||weightOunces<=0||weightOunces>2400)throw new Error('PARCEL_COMPARISON_WEIGHT_REQUIRED');
  return Object.freeze({presetId:selected.id,status:'ESTIMATE_ONLY',dimensionBasis:selected.dimensionBasis,
    weightBasis:'USER_COMPARISON_NOT_MEASURED',measurementRequired:true,
    parcel:Object.freeze({...selected.dimensions,weightOunces}),serviceNote:selected.serviceNote,source:selected.source});
}

export const WHATNOT_CARD_PROFILE_BENCHMARK=Object.freeze({
  status:'REFERENCE_ONLY',categories:Object.freeze(['Sports Cards','Trading Card Games']),
  applicableProfile:'0–1 oz',firstItemProfileOunces:1,additionalItemOunces:0.5,
  note:'Whatnot bundling rule only for its 0–1 oz profiles; this is not a measured slab or packed-box weight. Weigh all cards, sleeves, slab protection, padding and the sealed package.',
  source:'https://help.whatnot.com/hc/en-us/articles/16285911553677-How-Smart-Bundling-works'
});
