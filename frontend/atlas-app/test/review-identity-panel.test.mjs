import {emptyAtlasSportsAttributes,atlasPrintedSerial} from '@atlas/grading-core/identity';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import * as identity from '../lib/review-identity.mjs';

const pokemon={cardName:'Pikachu',year:null,productSet:'Scarlet & Violet Promo',cardNumber:'027',parallel:'English Cosmos Holofoil',layoutType:'POKEMON'};
const sports={playerName:'Jaxson Dart',year:null,manufacturer:'Panini',productSet:'Donruss Optic Football',cardNumber:'DTBH-JDT',parallel:null,insert:'Threads'};

test('identity edit uses canonical supported fields while preserving language and variant as exact parallel text',()=>{
 const action=identity.reviewIdentityEdit(pokemon,{...pokemon,year:' 2023 ',manufacturer:' Pokémon '});
 assert.equal(action.type,'IDENTITY_EDIT');assert.deepEqual(action.identity,{...pokemon,year:'2023',manufacturer:'Pokémon'});
 assert.equal(Object.hasOwn(action.identity,'language'),false);
 assert.deepEqual(identity.reviewIdentityEdit(sports,{...sports,year:'2025'}).identity,{...sports,year:'2025'});
 assert.equal(identity.reviewIdentityFields(pokemon).find(field=>field.key==='parallel').label,'Language / variant');
});

test('optional blanks and whitespace never manufacture no-op revisions or unsupported Pokémon manufacturer null',()=>{
 for(const current of [pokemon,sports])assert.equal(identity.reviewIdentityEdit(current,{...current,year:'  ',parallel:current.parallel??''}),null);
 assert.equal(identity.reviewIdentityEdit(pokemon,{...pokemon,cardName:'  Pikachu '}),null);
 const cleared=identity.reviewIdentityEdit({...pokemon,manufacturer:'Pokémon'},{...pokemon,manufacturer:''});
 assert.equal(Object.hasOwn(cleared.identity,'manufacturer'),false);
 const saved=identity.reviewIdentityEdit(pokemon,{...pokemon,year:'2023',manufacturer:''});
 assert.equal(Object.hasOwn(saved.identity,'manufacturer'),false);
});

test('changed identities preserve unknown fields and validate bounds, supplied kind and unsupported keys',()=>{
 for(const changed of [{year:'2'.repeat(25)},{manufacturer:'a'.repeat(121)},{layoutType:'UNKNOWN'}])assert.throws(()=>identity.reviewIdentityEdit(pokemon,{...pokemon,...changed}));
 for(const field of ['cardName','productSet','layoutType'])assert.equal(identity.reviewIdentityEdit(pokemon,{...pokemon,[field]:''}).identity[field],null);
 assert.throws(()=>identity.reviewIdentityEdit({...pokemon,language:'English'},{...pokemon,year:'2023'}));
 const historical={...pokemon};delete historical.layoutType;
 assert.equal(identity.reviewIdentityEdit(historical,{...historical}),null);
 assert.equal(identity.reviewIdentityEdit(historical,{...historical,year:'2023'}).identity.layoutType,null);
});

const require=createRequire(import.meta.url),babel=require('next/dist/compiled/babel/core'),nextRequire=createRequire(require.resolve('next/package.json'));
const compiled=babel.transformSync(readFileSync(new URL('../components/ReviewIdentityPanel.jsx',import.meta.url),'utf8'),{filename:'ReviewIdentityPanel.jsx',presets:[[require.resolve('next/babel'),{'preset-env':{targets:{node:'current'}}}]],babelrc:false,configFile:false}).code;
const all=(node,predicate,out=[])=>{if(Array.isArray(node))node.forEach(child=>all(child,predicate,out));else if(node&&typeof node==='object'){if(predicate(node))out.push(node);all(node.props?.children,predicate,out);}return out;};
const text=node=>Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):node??'';
function render(overrides={}){
 const callbacks=[],exports={},props={identity:pokemon,onEdit(){callbacks.push('edit');},onCancel(){callbacks.push('cancel');},onSave(){callbacks.push('save');},onChange(key,value){callbacks.push([key,value]);},...overrides};
 vm.runInNewContext(compiled,{exports,require(name){if(name==='react')return{createElement:(type,props,...children)=>({type,props:{...props,children}}),useEffect(){},useRef:()=>({current:null})};if(name==='../lib/review-identity.mjs')return identity;if(name==='./SportsAttributesFields')return{__esModule:true,default:()=>null,SportsAttributesSummary:()=>null};if(name.endsWith('.module.css'))return{__esModule:true,default:new Proxy({},{get:(_target,key)=>key})};return nextRequire(name.startsWith('@babel/runtime/')?`next/dist/compiled/${name}`:name);}});
 const tree=exports.default(props);return{tree,callbacks,find:predicate=>all(tree,predicate)[0],text:()=>text(tree)};
}
test('compact saved summary shows every supported field, with gentle missing values and no mandatory review',()=>{
 const f=render();assert.equal(f.tree.props['aria-label'],'Card identity');assert.match(f.text(),/YearNot setManufacturerNot set/);assert.match(f.text(),/Language \/ variantEnglish Cosmos Holofoil/);assert.match(f.text(),/Card kindPokémon/);
 assert.equal(all(f.tree,node=>node.type==='input'||node.type==='select').length,0);assert.equal(all(f.tree,node=>node.props?.role==='alert').length,0);
 f.find(node=>node.type==='button').props.onClick();assert.deepEqual(f.callbacks,['edit']);
 assert.equal(render({readOnly:true}).find(node=>node.type==='button'),undefined);
});

test('editor has prefilled accessible controls, optional missing fields and one save gesture',()=>{
 const f=render({draft:{...pokemon,year:'2023'},errors:{cardName:'Card name is required.'}});
 assert.equal(all(f.tree,node=>node.type==='input'||node.type==='select').length,7);
 const name=f.find(node=>node.type==='input'&&node.props['aria-label']==='Card name');assert.equal(name.props.value,'Pikachu');assert.equal(name.props['aria-invalid'],true);
 const year=f.find(node=>node.props['aria-label']==='Year');assert.equal(year.props.value,'2023');assert.equal(year.props.required,undefined);assert.equal(year.props.maxLength,24);year.props.onChange({target:{value:'2024'}});
 const form=f.find(node=>node.type==='form');form.props.onSubmit({preventDefault(){}});form.props.onKeyDown({key:'Escape',preventDefault(){},stopPropagation(){}});
 assert.deepEqual(f.callbacks,[['year','2024'],'save','cancel']);assert.match(f.text(),/Save details/);assert.doesNotMatch(f.text(),/Confirm each|Notes/);
 assert.match(render({draft:{...pokemon}}).text(),/Done/);
});

test('in-flight identity save disables all changes and Escape cannot discard it',()=>{
 const f=render({draft:{...pokemon,year:'2023'},saving:true});assert.equal(f.find(node=>node.type==='fieldset').props.disabled,true);
 assert.ok(all(f.tree,node=>node.type==='button').every(node=>node.props.disabled));const form=f.find(node=>node.type==='form');form.props.onSubmit({preventDefault(){}});form.props.onKeyDown({key:'Escape'});assert.deepEqual(f.callbacks,[]);
});

test('adopting a machine suggestion creates only editable facts and requires fresh human photograph evidence',()=>{
 const attributes=emptyAtlasSportsAttributes();attributes.serial={presence:'PRESENT',...atlasPrintedSerial('007/099'),evidence:[{side:'BACK',imageSha256:'a'.repeat(64),observation:'Synthetic derivative: 007/099.'}]};
 const proposal={version:'atlas-sports-attributes-proposal-v1',authority:'MACHINE_PROPOSAL',sourceHash:'b'.repeat(64),attributes,confidence:{serial:'high',autograph:'unknown',relic:'unknown'}};
 assert.equal(identity.draftSportsAttributesProposal(proposal,'c'.repeat(64)),null);
 const draft=identity.draftSportsAttributesProposal(proposal,proposal.sourceHash);assert.equal(draft.serial.printed,'007/099');assert.deepEqual(draft.serial.evidence,[]);
 assert.throws(()=>identity.reviewIdentityEdit(sports,{...sports,sportsAttributes:draft}));
 draft.serial.evidence.push({side:'BACK',imageSha256:'d'.repeat(64),observation:'Reviewer: back lower edge reads 007/099.'});
 const saved=identity.reviewIdentityEdit(sports,{...sports,sportsAttributes:draft});assert.equal(saved.identity.sportsAttributes.serial.denominator,99);
 assert.equal(proposal.attributes.serial.evidence[0].imageSha256,'a'.repeat(64));
 assert.equal(identity.reviewIdentityEdit(saved.identity,structuredClone(saved.identity)),null);
});

test('present special suggestions are visible before editing and use the existing review action without saving facts',()=>{
 const attributes=emptyAtlasSportsAttributes();attributes.serial={presence:'PRESENT',...atlasPrintedSerial('007/500'),evidence:[{side:'BACK',imageSha256:'a'.repeat(64),observation:'Synthetic derivative: 007/500.'}]};
 const proposal={version:'atlas-sports-attributes-proposal-v1',authority:'MACHINE_PROPOSAL',sourceHash:'b'.repeat(64),attributes,confidence:{serial:'high',autograph:'unknown',relic:'unknown'}};
 const props={identity:sports,identificationProposal:proposal,sourceHash:proposal.sourceHash},f=render(props);
 assert.match(f.text(),/Review and save these details before approving the card to include them on its label/);
 f.find(node=>node.type==='button'&&text(node)==='Review suggested special details').props.onClick();
 assert.deepEqual(f.callbacks,['edit']);assert.equal(sports.sportsAttributes,undefined);
 for(const overrides of [{readOnly:true},{sourceHash:'c'.repeat(64)},{identity:{...sports,sportsAttributes:attributes}},
   {identificationProposal:{...proposal,attributes:emptyAtlasSportsAttributes()}}])
   assert.equal(render({...props,...overrides}).find(node=>node.props?.['aria-label']==='Suggested special details'),undefined);
});

test('reviewed special features survive ordinary identity edits and require complete human reference fields',()=>{
 const feature={kind:'CASE_HIT',evidence:{type:'REVIEWED_REFERENCE',sourceTitle:'Synthetic checklist',sourceUrl:'https://example.com/checklist',matchNote:'Card DTBH-JDT matches the named printing and case-hit entry.'}};
 const current={...sports,sportsAttributes:{...emptyAtlasSportsAttributes(),specialFeatures:[feature]}};
 const {sportsAttributes:_omitted,...ordinaryFields}=current;
 assert.equal(identity.reviewIdentityEdit(current,ordinaryFields),null);
 const edited=identity.reviewIdentityEdit(current,{...ordinaryFields,manufacturer:'Reviewed maker'});
 assert.deepEqual(edited.identity.sportsAttributes,current.sportsAttributes);
 assert.equal(identity.reviewIdentityEdit(current,structuredClone(current)),null);
 const invalid=structuredClone(current);invalid.sportsAttributes.specialFeatures[0].evidence.matchNote='';
 assert.throws(()=>identity.reviewIdentityEdit(sports,invalid));
 const proposal={version:'atlas-sports-attributes-proposal-v1',authority:'MACHINE_PROPOSAL',sourceHash:'b'.repeat(64),attributes:current.sportsAttributes};
 assert.equal(identity.reviewSportsAttributesProposal(proposal,proposal.sourceHash),null);
 assert.equal(identity.draftSportsAttributesProposal(proposal,proposal.sourceHash),null);
});
