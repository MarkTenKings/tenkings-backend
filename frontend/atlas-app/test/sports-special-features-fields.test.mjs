import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import * as identity from '@atlas/grading-core/identity';
const require=createRequire(import.meta.url),babel=require('next/dist/compiled/babel/core'),nextRequire=createRequire(require.resolve('next/package.json'));
const compiled=babel.transformSync(readFileSync(new URL('../components/SportsAttributesFields.jsx',import.meta.url),'utf8'),{filename:'SportsAttributesFields.jsx',presets:[[require.resolve('next/babel'),{'preset-env':{targets:{node:'current'}}}]],babelrc:false,configFile:false}).code;
const all=(node,predicate,out=[])=>{if(Array.isArray(node))node.forEach(child=>all(child,predicate,out));else if(node&&typeof node==='object'){if(predicate(node))out.push(node);all(node.props?.children,predicate,out);}return out;};
const text=node=>Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):node??'';
function render(value,errors={}){
 const callbacks=[],exports={};
 vm.runInNewContext(compiled,{exports,require(name){if(name==='react')return{createElement:(type,props,...children)=>({type,props:{...props,children}})};if(name==='@atlas/grading-core/identity')return identity;if(name.endsWith('.module.css'))return{__esModule:true,default:new Proxy({},{get:(_target,key)=>key})};return nextRequire(name.startsWith('@babel/runtime/')?`next/dist/compiled/${name}`:name);}});
 const tree=exports.default({value,onChange:next=>callbacks.push(next),photos:{FRONT:'a'.repeat(64),BACK:'b'.repeat(64)},errors});
 return{tree,callbacks,find:predicate=>all(tree,predicate)[0],summary:()=>text(exports.SportsAttributesSummary({value}))};
}
const feature={kind:'CASE_HIT',evidence:{type:'REVIEWED_REFERENCE',sourceTitle:'Synthetic reference',sourceUrl:'https://example.com/checklist',matchNote:'The listed card and exact printing match.'}};
test('special feature controls create an incomplete draft and expose the three reference fields in the existing editor',()=>{
 const value=identity.emptyAtlasSportsAttributes(),f=render(value);
 f.find(n=>n.type==='button'&&text(n)==='Add confirmed special feature').props.onClick();
 const draft=f.callbacks[0];assert.equal(draft.specialFeatures[0].kind,'CASE_HIT');assert.throws(()=>identity.parseAtlasSportsAttributes(draft));
 assert.equal(Object.hasOwn(value,'specialFeatures'),false);
 const g=render({...value,specialFeatures:[feature]});
 for(const [suffix,key]of [['reference title','sourceTitle'],['reference URL','sourceUrl'],['match note','matchNote']]){
  const input=g.find(n=>n.props?.['aria-label']===`Special feature 1 ${suffix}`);assert.equal(input.props.value,feature.evidence[key]);
  input.props.onChange({target:{value:feature.evidence[key]+' updated'}});assert.equal(g.callbacks.at(-1).specialFeatures[0].evidence[key],feature.evidence[key]+' updated');
 }
 assert.match(g.summary(),/Case hit/);assert.match(g.summary(),/Synthetic reference/);
});
test('removing the last special feature omits the key and preserves every photographed fact',()=>{
 const value=identity.emptyAtlasSportsAttributes();value.serial={presence:'PRESENT',...identity.atlasPrintedSerial('007/099'),evidence:[{side:'BACK',imageSha256:'b'.repeat(64),observation:'Back serial 007/099.'}]};
 const f=render({...value,specialFeatures:[feature]});f.find(n=>n.type==='button'&&text(n)==='Remove special feature 1').props.onClick();
 assert.deepEqual(JSON.parse(JSON.stringify(f.callbacks[0])),value);assert.equal(Object.hasOwn(f.callbacks[0],'specialFeatures'),false);
 assert.equal(identity.parseAtlasSportsAttributes(f.callbacks[0]).serial.printed,'007/099');
});
test('already-used kinds are disabled and special reference errors remain visible',()=>{
 const value={...identity.emptyAtlasSportsAttributes(),specialFeatures:[feature,{...feature,kind:'SHORT_PRINT'},{...feature,kind:'SUPER_SHORT_PRINT'}]};
 const f=render(value,{'sportsAttributes.specialFeatures.0.evidence.matchNote':'Record the exact match.'});
 assert.equal(f.find(n=>n.type==='button'&&text(n)==='Add confirmed special feature').props.disabled,true);
 const select=f.find(n=>n.props?.['aria-label']==='Special feature 1');
 assert.equal(all(select,n=>n.type==='option'&&n.props.disabled).length,2);
 assert.equal(text(f.find(n=>n.props?.role==='alert')),'Record the exact match.');
});
