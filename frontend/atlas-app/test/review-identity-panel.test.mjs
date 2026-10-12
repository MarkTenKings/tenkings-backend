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

test('changed identities validate required fields, bounds, kind and unsupported saved keys before submission',()=>{
 for(const changed of [{cardName:''},{productSet:''},{year:'2'.repeat(25)},{manufacturer:'a'.repeat(121)},{layoutType:'UNKNOWN'}])assert.throws(()=>identity.reviewIdentityEdit(pokemon,{...pokemon,...changed}));
 assert.throws(()=>identity.reviewIdentityEdit({...pokemon,language:'English'},{...pokemon,year:'2023'}));
 const historical={...pokemon};delete historical.layoutType;
 assert.equal(identity.reviewIdentityEdit(historical,{...historical}),null);
 assert.throws(()=>identity.reviewIdentityEdit(historical,{...historical,year:'2023'}));
});

const require=createRequire(import.meta.url),babel=require('next/dist/compiled/babel/core'),nextRequire=createRequire(require.resolve('next/package.json'));
const compiled=babel.transformSync(readFileSync(new URL('../components/ReviewIdentityPanel.jsx',import.meta.url),'utf8'),{filename:'ReviewIdentityPanel.jsx',presets:[[require.resolve('next/babel'),{'preset-env':{targets:{node:'current'}}}]],babelrc:false,configFile:false}).code;
const all=(node,predicate,out=[])=>{if(Array.isArray(node))node.forEach(child=>all(child,predicate,out));else if(node&&typeof node==='object'){if(predicate(node))out.push(node);all(node.props?.children,predicate,out);}return out;};
const text=node=>Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):node??'';
function render(overrides={}){
 const callbacks=[],exports={},props={identity:pokemon,onEdit(){callbacks.push('edit');},onCancel(){callbacks.push('cancel');},onSave(){callbacks.push('save');},onChange(key,value){callbacks.push([key,value]);},...overrides};
 vm.runInNewContext(compiled,{exports,require(name){if(name==='react')return{createElement:(type,props,...children)=>({type,props:{...props,children}}),useEffect(){},useRef:()=>({current:null})};if(name==='../lib/review-identity.mjs')return identity;if(name.endsWith('.module.css'))return{__esModule:true,default:new Proxy({},{get:(_target,key)=>key})};return nextRequire(name.startsWith('@babel/runtime/')?`next/dist/compiled/${name}`:name);}});
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
