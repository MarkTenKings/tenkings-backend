import {variantCandidateId,createVariantReviewSnapshot} from '@tenkings/card-catalog-evidence';
export const hash='a'.repeat(64);
export const variantIdentity={category:'POKEMON',name:'Magikarp',year:'2020',setName:'Rebel Clash',cardNumber:'039/192',manufacturer:null,language:null};
export const pin={publicationId:'fixture-publication',setId:'fixture-set',revision:1,manifestSha256:hash};
const raw={authority:'reviewed_catalog',label:'Reverse Holo',parallel:'Reverse Holo',identity:variantIdentity,canonical:{publication:pin,cardId:'fixture-card',printingId:`setops-printing:v1:${hash}`},applicability:'supported',diagnostics:[{id:'foil',description:'Reflective reverse pattern'}],images:[{imageId:'reference',relationship:'exact',url:null,sha256:hash,mimeType:'image/jpeg',width:10,height:10,publication:pin,provenance:{provider:'setops',sourceUrl:null,sourceSha256:hash,usage:'reviewed_catalog'},visibleDiagnosticIds:['foil']}],source:{provider:'setops',recordId:'fixture-card',url:null,sha256:hash,references:[]},warnings:[]};
export const variantCandidate={candidateId:variantCandidateId(raw),...raw};
export const variantCatalog=createVariantReviewSnapshot({identity:variantIdentity,candidates:[variantCandidate],capturedAt:new Date().toISOString()});
