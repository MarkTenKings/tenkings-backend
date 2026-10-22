// Actual nested JSX/hook execution, not DOM acceptance. No listener or network.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import * as collection from '../lib/collection-contract.mjs';
import * as display from '../lib/collection-display-contract.mjs';
import * as client from '../lib/collection-client.mjs';
import {createCollectionDisplayReader} from '../lib/collection-display-client.mjs';
const require=createRequire(new URL('../package.json',import.meta.url)),babel=require('next/dist/compiled/babel/core');
const compiled=new Map();
export const nodes=(tree,test)=>tree==null||typeof tree!=='object'?[]:[...(test(tree)?[tree]:[]),...(tree.props?.children??[]).flat(Infinity).flatMap(x=>nodes(x,test))];
export const words=tree=>tree==null||typeof tree==='boolean'?'':typeof tree!=='object'?String(tree):(tree.props?.children??[]).flat(Infinity).map(words).join(' ').replace(/\s+/g,' ');
export function createMountedDisplayFixture(f) {
 const h={made:[],revoked:[],reads:[],visibility:[]};
 const verified=createCollectionDisplayReader({fetcher:f.fetch,urls:{createObjectURL(blob){h.made.push(blob);return 'blob:synthetic-'+h.made.length;},revokeObjectURL(url){h.revoked.push(url);}}});
 h.reader={read(input){h.reads.push(input);return verified.read(input);}};
 h.props={customer:{id:f.accountId},readPage:async()=>structuredClone(f.snapshot),displayReader:h.reader};
 const instances=new Map(),modules=new Map(),listeners=new Map();let owner,dirty=false,tree,seq=0;
 const changed=(a,b)=>!a||a.length!==b.length||a.some((x,i)=>x!==b[i]);
 const react={Fragment:'fragment',createElement:(type,props,...children)=>({type,props:{...props,children}}),
  useState(initial){const o=owner,i=o.cursor++;if(!(i in o.slots))o.slots[i]=typeof initial==='function'?initial():initial;return[o.slots[i],value=>{assert(o.mounted,'No state after unmount');o.slots[i]=typeof value==='function'?value(o.slots[i]):value;dirty=true;}];},
  useRef(initial){const i=owner.cursor++;if(!(i in owner.slots))owner.slots[i]={current:initial};return owner.slots[i];},useId(){return react.useRef('id'+(++seq)).current;},
  useMemo(fn,deps){const i=owner.cursor++;if(changed(owner.slots[i]?.deps,deps))owner.slots[i]={deps,value:fn()};return owner.slots[i].value;},useCallback(fn,deps){return react.useMemo(()=>fn,deps);},
  useEffect(fn,deps){const o=owner,i=o.cursor++;if(changed(o.slots[i]?.deps,deps)){const old=o.slots[i];o.slots[i]={deps,fn,cleanup:old?.cleanup};o.effects.push(()=>{old?.cleanup?.();o.slots[i].cleanup=fn();});}},
 };
 const window={addEventListener:(event,fn)=>{if(!listeners.has(event))listeners.set(event,new Set());listeners.get(event).add(fn);},removeEventListener:(event,fn)=>listeners.get(event)?.delete(fn)};
 class Visibility {constructor(callback){this.callback=callback;this.closed=false;h.visibility.push(this);}observe(){this.callback([{isIntersecting:true}]);}disconnect(){this.closed=true;}}
 function load(file){if(modules.has(file))return modules.get(file);
  if(!compiled.has(file))compiled.set(file,babel.transformSync(readFileSync(file,'utf8'),{filename:file,presets:[[require.resolve('next/babel'),{'preset-env':{targets:{node:'current'}},'transform-runtime':{helpers:false}}]],babelrc:false,configFile:false}).code);
  const exports={};modules.set(file,exports);vm.runInNewContext(compiled.get(file),{exports,window,IntersectionObserver:Visibility,AbortController,Promise,Intl,Error,
   require:name=>name==='react'?react:name.endsWith('.css')?{__esModule:true,default:new Proxy({},{get:(_t,k)=>k})}:name.endsWith('/collection-contract.mjs')?collection
    :name.endsWith('/collection-display-contract.mjs')?display:name.endsWith('/collection-client.mjs')?client:load(resolve(dirname(file),name))});return exports;}
 const Workspace=load(fileURLToPath(new URL('../components/collection/CollectionWorkspace.jsx',import.meta.url))).default;
 function descend(node,path,seen){if(node==null||typeof node!=='object')return node;if(Array.isArray(node))return node.map((n,i)=>descend(n,path+'.'+i,seen));
  if(typeof node.type==='function'){const key=path+':'+node.type.name+':'+(node.props.key??'');seen.add(key);let o=instances.get(key);if(!o){o={slots:[],effects:[],mounted:true};instances.set(key,o);}o.cursor=0;o.name=node.type.name;o.props=node.props;owner=o;return descend(node.type(node.props),key,seen);}
  if(node.props?.ref)node.props.ref.current={fixture:true};
  return{...node,props:{...node.props,children:(node.props?.children??[]).flat(Infinity).map((n,i)=>descend(n,path+'.'+i,seen))}};}
 h.render=(props=h.props,effects=true)=>{h.props=props;let turns=0;do{dirty=false;const seen=new Set();tree=descend(react.createElement(Workspace,props),'root',seen);
   if(effects){for(const[key,o]of instances)if(!seen.has(key)){for(const s of o.slots)s?.cleanup?.();o.mounted=false;instances.delete(key);}for(const o of instances.values())while(o.effects.length)o.effects.shift()();}
   assert(++turns<30,'Nested render must settle');}while(effects&&dirty);return tree;};
 h.until=async predicate=>{const deadline=Date.now()+3000;do{h.render();if(predicate(tree))return tree;await new Promise(r=>setImmediate(r));}while(Date.now()<deadline);assert.fail('Mounted fixture did not reach expected state: '+words(tree));};
 h.component=name=>[...instances.values()].find(o=>o.name===name)?.props;
 h.click=label=>{const b=nodes(tree,n=>n.type==='button'&&words(n)===label)[0];assert(b,label);b.props.onClick();h.render();};
 h.image=()=>nodes(tree,n=>n.type==='img')[0];
 h.loadImage=(width=1350,height=1858)=>{h.image().props.onLoad({currentTarget:{naturalWidth:width,naturalHeight:height}});h.render();};
 h.replay=()=>{const slots=[...instances.values()].flatMap(o=>o.slots).filter(s=>s?.fn);for(const s of slots)s.cleanup?.();for(const s of slots)s.cleanup=s.fn();h.render();};
 h.pagehide=()=>{for(const fn of [...listeners.get('pagehide')??[]])fn();h.render();};
 h.unmount=()=>{for(const o of instances.values()){for(const s of o.slots)s?.cleanup?.();o.mounted=false;}instances.clear();};
 h.tree=()=>tree;return h;
}
