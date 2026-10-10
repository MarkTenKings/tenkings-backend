import { normalizeVariantIdentity, validateCatalogDemandResult, catalogDemandKey, compareVariantCardNumber,
  variantCandidateId, validateVariantCandidate } from '@tenkings/card-catalog-evidence';

/** Literal source rows are unreviewed choices. Set/program-level parallel
 * context cannot establish that a particular physical card has that printing. */
export function variantChoicesFromDemand(input, identity) {
  const result=validateCatalogDemandResult(input), target=normalizeVariantIdentity(identity);
  if(result.demandKey!==catalogDemandKey(target)) throw Object.assign(Error('VARIANT_DEMAND_MISMATCH'),{code:'VARIANT_DEMAND_MISMATCH'});
  if(result.state!=='READY') return [];
  const norm=value=>value.normalize('NFC').trim().toLowerCase().replace(/\s+/g,' ');
  return result.choices.filter(row=>norm(row.identity.name)===norm(target.name)
    && compareVariantCardNumber(row.identity.cardNumber,target.cardNumber)!=='conflict'
    && (!target.language||!row.identity.language||target.language===row.identity.language)).map(row=>{
      const source=result.sources.find(s=>s.sourceId===row.sourceId);
      const value={authority:'provider_candidate',label:row.parallel,identity:normalizeVariantIdentity(row.identity),parallel:row.parallel,
        canonical:null,applicability:'unknown',images:[],
        diagnostics:row.diagnostics.map((description,index)=>({id:`demand:${row.rowId}:${index}`,description})),
        source:{provider:'setops_demand',recordId:row.rowId,url:source.url,sha256:source.sha256,
          references:[{url:source.url,sha256:source.sha256}]},
        warnings:['APPLICABILITY_UNCONFIRMED','REFERENCE_IMAGE_MISSING',...(!row.identity.language?['LANGUAGE_UNCONFIRMED']:[]),
          ...(compareVariantCardNumber(row.identity.cardNumber,target.cardNumber)==='unknown'?['DENOMINATOR_UNVERIFIED']:[])]};
      return validateVariantCandidate({...value,candidateId:variantCandidateId(value)});
    });
}
