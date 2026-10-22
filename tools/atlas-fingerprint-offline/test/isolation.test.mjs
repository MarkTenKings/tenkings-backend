import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

// The child reads only these two standalone source files into a VM. The VM
// cannot resolve any other module, and all I/O/hash/global capabilities throw.
// No repository ATLAS module or ordinary process environment is passed through.
const script = String.raw`
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import vm from 'node:vm';
const root = process.argv[1], mutation = process.argv[2];
const sources = new Map();
for (const name of ['contract.mjs','import-reference.mjs']) sources.set(name, await readFile(join(root,name),'utf8'));
if (mutation) sources.set('import-reference.mjs', sources.get('import-reference.mjs') + '\n' + mutation);
const calls = [], deny = label => (...args) => { calls.push(label); throw new Error('DENIED:' + label); };
const sandbox = {};
for (const name of ['process','navigator','localStorage','sessionStorage','performance'])
  sandbox[name]=new Proxy({},{get:deny('global.'+name)});
for (const name of ['fetch','WebSocket','XMLHttpRequest']) sandbox[name]=deny('global.'+name);
for (const name of ['setTimeout','setInterval','setImmediate','queueMicrotask']) sandbox[name] = deny(name);
const context=vm.createContext(sandbox,{codeGeneration:{strings:false,wasm:false}}), modules=new Map(), imports=new Set();
const definitions={
 'node:crypto': {createHash:deny('crypto.createHash')},
 'node:fs/promises':Object.fromEntries(['open','lstat','realpath','readdir'].map(n=>[n,deny('fs.'+n)])),
 'node:fs':{constants:{O_RDONLY:0,O_NOFOLLOW:1,O_NONBLOCK:2}},
 'node:path':Object.fromEntries(['isAbsolute','resolve','join'].map(n=>[n,deny('path.'+n)])),
};
const moduleFor = name => {
 if (modules.has(name)) return modules.get(name);
 let module;
 if (sources.has(name)) module=new vm.SourceTextModule(sources.get(name),{context,identifier:name,importModuleDynamically:deny('dynamic import')});
 else if (definitions[name]) {const values=definitions[name];module=new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v] of Object.entries(values))this.setExport(k,v);},{context,identifier:name});}
 else throw new Error('MODULE_NOT_ALLOWED:' + name);
 modules.set(name,module);return module;
};
const entry=moduleFor('import-reference.mjs');
try {
 await entry.link((specifier,parent)=>{imports.add(specifier);if(specifier.startsWith('./')){
  if(parent.identifier!=='import-reference.mjs'||specifier!=='./contract.mjs')throw new Error('LOCAL_IMPORT_NOT_ALLOWED');
  return moduleFor('contract.mjs');}return moduleFor(specifier);});
 await entry.evaluate({timeout:1000});
 process.stdout.write(JSON.stringify({pass:true,imports:[...imports].sort(),calls,exports:Object.keys(entry.namespace)}));
}catch(error){process.stdout.write(JSON.stringify({pass:false,error:error.message,calls}));}
`;

async function isolated(mutation = '') {
  const directory = fileURLToPath(new URL('../', import.meta.url));
  const result = await promisify(execFile)(process.execPath, ['--experimental-vm-modules', '--input-type=module', '-e', script, directory, mutation],
    { env: {}, timeout: 5000, maxBuffer: 65536 });
  return JSON.parse(result.stdout);
}

test('actual runtime module graph imports with no filesystem, credentials, network, hash, timer or grading action', async () => {
  const result = await isolated(); assert.equal(result.pass, true, JSON.stringify(result)); assert.deepEqual(result.calls, []);
  assert.deepEqual(result.imports, ['./contract.mjs', 'node:crypto', 'node:fs', 'node:fs/promises', 'node:path']);
  assert.deepEqual(result.exports, ['importReference']);
});

test('isolation harness catches injected environment/network/filesystem work and forbidden module dependencies', async () => {
  for (const mutation of ['process.env.SYNTHETIC_SECRET;', 'fetch("https://example.invalid/");', 'await open("/never-read");',
    'await import("node:http");', 'import "@atlas/grading-core";']) {
    const result = await isolated(mutation); assert.equal(result.pass, false, mutation);
    assert.match(result.error, /DENIED|MODULE_NOT_ALLOWED/);
  }
});
