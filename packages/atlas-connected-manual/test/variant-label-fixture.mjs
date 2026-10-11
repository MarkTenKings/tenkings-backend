import {createHash} from 'node:crypto';
import {canonicalJson,createVariantReviewSnapshot,variantCandidateId} from '@tenkings/card-catalog-evidence';
import {variantCandidate,variantIdentity} from './variant-fixture.mjs';
export const labelHash=v=>createHash('sha256').update(v).digest('hex');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOv8AAAAASUVORK5CYII=','base64');
export function labelPhoto(index=0,source='source') {
 const bytes=Buffer.concat([png,Buffer.from(String(index))]),sha256=labelHash(bytes),listing={id:String(123456780000+index),title:'Sold graded card',url:`https://www.ebay.com/itm/${123456780000+index}`},sourceResponseSha256=labelHash(source);
 const image={imageId:`listing-image:${labelHash(canonicalJson({listing,sha256,sourceResponseSha256}))}`,relationship:'listing_photo',url:`https://i.ebayimg.com/images/g/label${index}/s-l1600.jpg`,sha256,mimeType:'image/png',width:1,height:1,publication:null,
  provenance:{provider:'ebay_sold_comps_v2',sourceUrl:'https://api.sold-comps.com/v1/scrape?keyword=fixture',sourceSha256:sourceResponseSha256,usage:'provider_reference'},visibleDiagnosticIds:[],sourceResponseSha256,listing};
 return {image,media:{bytes,sha256,mimeType:'image/png',width:1,height:1}};
}
export function labelCatalog({count=1,photos=count*2,capturedAt='2026-10-10T00:00:00.000Z',source='fixture',candidateTransform=c=>c}={}) {
 const candidates=Array.from({length:count},(_,index)=>{
  const raw=structuredClone(variantCandidate);delete raw.candidateId;raw.label=raw.parallel=index?`Variant ${index}`:'Base';raw.images=[];
  raw.canonical.printingId=`setops-printing:v1:${labelHash(String(index))}`;raw.source.sha256=labelHash(source);raw.canonical.publication.manifestSha256=raw.source.sha256;
  candidateTransform(raw,index);return {...raw,candidateId:variantCandidateId(raw)};
 });
 return createVariantReviewSnapshot({identity:variantIdentity,candidates,capturedAt,referencePhotos:Array.from({length:photos},(_,i)=>labelPhoto(i,source).image)});
}
export const labelResponse=(request,readings=request.photos.map(p=>({sha256:p.sha256,candidateKey:request.choices[0].key,gradingCompany:'PSA',labelText:'2020 Pokemon Rebel Clash Magikarp #39',reason:'Exact readable slab identity and printing.'})))=>({model:'gpt-6-astra',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({readings})}]}]});
