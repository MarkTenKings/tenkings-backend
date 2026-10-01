import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('continuation survives BFCache and releases assets once on a later actual exit',()=>{
  const source=readFileSync(new URL('../../../docs/atlas/design/experience/site/continuation.mjs',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
  const handlers=new Map();let cleanupCount=0;const revoked=[];
  const window={addEventListener:(name,handler,options)=>handlers.set(name,{handler,once:options?.once}),removeEventListener:(name,handler)=>{if(handlers.get(name)?.handler===handler)handlers.delete(name);}};
  const fire=event=>{const saved=handlers.get('pagehide');if(saved?.once)handlers.delete('pagehide');saved?.handler(event);};
  const context={document:{querySelector:()=>null},window,URL:{revokeObjectURL:value=>revoked.push(value)},onCleanup:()=>cleanupCount++};
  vm.runInNewContext(source+'\ncleanups.push(onCleanup);urls.add("blob:retained-evidence");',context);
  fire({persisted:true});
  assert.equal(cleanupCount,0);assert.deepEqual(revoked,[]);
  fire({persisted:false});
  assert.equal(cleanupCount,1);assert.deepEqual(revoked,['blob:retained-evidence']);
  fire({persisted:false});
  assert.equal(cleanupCount,1);assert.equal(handlers.has('pagehide'),false);
});
