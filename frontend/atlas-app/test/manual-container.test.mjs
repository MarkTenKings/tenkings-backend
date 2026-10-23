import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,writeFile,readFile,mkdir,rm,symlink,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {collectManualSource,packageManualContainer,CPU_SOURCES,VENDOR_SOURCES,LABEL_V4_SOURCES,LABEL_APPROVED_B_SOURCES} from '../scripts/package-manual-container.mjs';
import {manufacturerRuntimeFiles} from '../../../packages/card-catalog-evidence/src/manufacturer-runtime-files.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test('actual clean serving closure contains current workers and camera but no historical data, schema installers or build outputs',async()=>{
 const {files,packages}=await collectManualSource();const paths=new Set(files.map(file=>file.path));
 assert(packages.includes('packages/atlas-connected-manual'));assert(!packages.includes('packages/database'));
 assert(!packages.includes('packages/atlas-standalone-database'));
 for(const name of CPU_SOURCES)assert(paths.has('backend/ai-grader-speedster-service/'+name),name);
 for(const path of [...LABEL_V4_SOURCES,...LABEL_APPROVED_B_SOURCES])assert(paths.has(path),path);
 const fontRoot='packages/atlas-finishing/assets/approved-b/fonts/';
 for(const name of ['BebasNeue-Regular.ttf','OFL-BebasNeue.txt','README.md','Knewave-Regular.ttf','Lacquer-Regular.ttf',
  'OFL-Knewave.txt','OFL-Lacquer.txt','label-style-provenance.json'])assert(paths.has(fontRoot+name),`Missing variant font runtime/provenance input: ${name}`);
 assert.equal(files.find(file=>file.path===fontRoot+'BebasNeue-Regular.ttf').sha256,'830ea186acffc2316ed1a4e42319246ba3b46b04e33a211079249bf901193f04');
 assert.match(files.find(file=>file.path===fontRoot+'OFL-BebasNeue.txt').bytes.toString(),/SIL Open Font License, Version 1\.1/);
 for(const module of ['label-approved-b.mjs','label-approved-b-artwork.mjs'])assert(paths.has('packages/atlas-finishing/src/'+module),module);
 assert.equal(CPU_SOURCES.length,8);assert(paths.has('frontend/atlas-shared/RapidCardCamera.jsx'));
 assert.deepEqual([...paths].filter(path=>path.startsWith('packages/card-catalog-evidence/data/')).sort(),await manufacturerRuntimeFiles(root));
 for(const path of paths)assert(!/(?:^|\/)(?:tests?|fixtures|test-fixtures|sql|migrations|node_modules|dist|\.generated|\.next)(?:\/|$)|\.env|atlas_photo_geometry\.py|preparation_core\.py/.test(path),path);
 const modules=new Set(CPU_SOURCES.map(name=>name.slice(0,-3)));
 const output=spawnSync('python3',['-c',[
  'import ast,json,sys,pathlib',
  'root=pathlib.Path(sys.argv[1]);names=json.loads(sys.argv[2]);found=set()',
  'for name in names:',
  ' for n in ast.walk(ast.parse((root/name).read_text())):',
  '  if isinstance(n,ast.Import): found.update(x.name.split(".")[0] for x in n.names)',
  '  elif isinstance(n,ast.ImportFrom) and n.module: found.add(n.module.split(".")[0])',
  'print(json.dumps(sorted(n for n in found if (root/(n+".py")).exists())))',
 ].join('\n'),resolve(root,'backend/ai-grader-speedster-service'),JSON.stringify(CPU_SOURCES)],{encoding:'utf8'});
 assert.equal(output.status,0,output.stderr);for(const name of JSON.parse(output.stdout))assert(modules.has(name),`Missing Python dependency: ${name}`);
});
test('isolated packaged catalog resolves Jordan, Nick Kurtz and LaMelo offline and rejects each missing runtime input',async()=>{
 const temporary=await mkdtemp(join(tmpdir(),'atlas-packaged-catalog-'));
 try{
  const {files}=await collectManualSource();
  const catalogFiles=files.filter(file=>file.path.startsWith('packages/card-catalog-evidence/'));
  for(const file of catalogFiles){const path=join(temporary,file.path);await mkdir(dirname(path),{recursive:true});await writeFile(path,file.bytes);}
  const verifier=files.find(file=>file.path==='frontend/atlas-app/scripts/verify-manual-container.mjs'),script=join(temporary,verifier.path);
  await mkdir(dirname(script),{recursive:true});await writeFile(script,verifier.bytes);
  const included=[...catalogFiles,verifier];
  // The verifier's source tree must contain exactly its manifested files, so
  // keep the manifest outside the tree just as the container build does.
  const manifestPath=temporary+'.manifest.json';
  const save=omitted=>writeFile(manifestPath,JSON.stringify({version:'atlas-clean-manual-source-v1',packages:['packages/card-catalog-evidence'],files:included.filter(file=>file.path!==omitted).map(({bytes,...file})=>file)}));
  const run=()=>spawnSync(process.execPath,[script,manifestPath],{encoding:'utf8',timeout:15000});
  await save();const complete=run();assert.equal(complete.status,0,complete.stderr);
  const catalog=JSON.parse(complete.stdout).manufacturerCatalog;assert.ok(catalog.candidates>=3);assert.equal(catalog.providerCalls,0);assert.equal(catalog.identity.year,null);
  assert.equal(catalog.jordan.secondaryDisclosure,true);assert.ok(catalog.jordan.candidates>=1);assert.ok(catalog.lamelo.candidates>=16);
  // Common dependencies and the active catalog entry point are mandatory.
  // Each individual shard is covered by the closure verifier and focused adversarial tests.
  for(const path of (await manufacturerRuntimeFiles(root)).filter(path=>!path.includes('/data/manufacturer-checklists/'))){
   const file=catalogFiles.find(value=>value.path===path);assert.ok(file,path);await rm(join(temporary,path));await save(path);
   const missing=run();assert.notEqual(missing.status,0,path);assert.match(missing.stderr,/ENOENT/);
   assert.ok(missing.stderr.includes(path.split('/').at(-1)),missing.stderr);await writeFile(join(temporary,path),file.bytes);
  }
 }finally{await rm(temporary,{recursive:true,force:true});await rm(temporary+'.manifest.json',{force:true});}
});
test('isolated approved B package verifies exact assets and rejects changed artwork, variant font or provenance bytes',async()=>{
 const temporary=await mkdtemp(join(tmpdir(),'atlas-packaged-label-')),manifestPath=temporary+'.manifest.json';
 try{
  const {files}=await collectManualSource(),included=files.filter(file=>LABEL_APPROVED_B_SOURCES.includes(file.path)
   ||file.path.startsWith('frontend/atlas-app/assets/label-templates/')
   ||['label-approved-b-artwork.mjs','label-style-artwork.mjs','label-style-png.mjs','label-sheet.mjs','label-sheet-geometry.mjs','label-sheet-25.mjs'].some(name=>file.path===`packages/atlas-finishing/src/${name}`)
   ||file.path==='frontend/atlas-app/scripts/verify-manual-container.mjs');
  for(const file of included){const path=join(temporary,file.path);await mkdir(dirname(path),{recursive:true});await writeFile(path,file.bytes);}
  await writeFile(manifestPath,JSON.stringify({version:'atlas-clean-manual-source-v1',packages:['packages/atlas-finishing'],files:included.map(({bytes,...file})=>file)}));
  const script=join(temporary,'frontend/atlas-app/scripts/verify-manual-container.mjs'),run=()=>spawnSync(process.execPath,[script,manifestPath],{encoding:'utf8',timeout:15000});
  const complete=run();assert.equal(complete.status,0,complete.stderr);const result=JSON.parse(complete.stdout);
  assert.equal(result.approvedLabelAssets.version,'atlas-approved-b-static-assets-v1');assert.equal(result.approvedLabelAssets.files,5);
  assert.equal(result.labelJig25.positions,25);assert.equal(result.labelJig25.backFiles,3);
  for(const name of ['back-black.png','fonts/BebasNeue-Regular.ttf','fonts/OFL-BebasNeue.txt','fonts/README.md',
    'style-front-black.png','style-front-inverted.png','style-artwork-manifest.json','fonts/Knewave-Regular.ttf','fonts/Lacquer-Regular.ttf']){
   const asset=join(temporary,'packages/atlas-finishing/assets/approved-b',name),original=await readFile(asset),bytes=Buffer.from(original);
   bytes[bytes.length-1]^=1;await writeFile(asset,bytes);
   const changed=run();assert.notEqual(changed.status,0,name);assert(changed.stderr.includes(name),changed.stderr);
   await writeFile(asset,original);
  }
 }finally{await rm(temporary,{recursive:true,force:true});await rm(manifestPath,{force:true});}
});
test('isolated serving router closure resolves every exported entry including detail report return',async()=>{
 const temporary=await mkdtemp(join(tmpdir(),'atlas-packaged-router-'));
 try{
  const {files}=await collectManualSource();
  for(const file of files.filter(file=>file.path.startsWith('packages/atlas-site-router/'))){
   const path=join(temporary,file.path);await mkdir(dirname(path),{recursive:true});await writeFile(path,file.bytes);
  }
  const router=join(temporary,'packages/atlas-site-router');
  const manifest=JSON.parse(await readFile(join(router,'package.json'),'utf8'));
  for(const entry of Object.values(manifest.exports)){
   const result=spawnSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(join(router,entry))})`],{encoding:'utf8'});
   assert.equal(result.status,0,`${entry}: ${result.stderr}`);
  }
 }finally{await rm(temporary,{recursive:true,force:true});}
});
test('unverified native archives fail before creating a source output',async()=>{
 const temporary=await mkdtemp(join(tmpdir(),'atlas-package-rejection-'));
 try{
  const vendor=join(temporary,'vendor'),output=join(temporary,'output');await mkdir(vendor);
  for(const name of Object.keys(VENDOR_SOURCES))await writeFile(join(vendor,name),'unverified upstream bytes');
  await assert.rejects(packageManualContainer(output,vendor),/Native source checksum mismatch/);
  await assert.rejects(access(output));
 }finally{await rm(temporary,{recursive:true,force:true});}
});
test('source verification rejects changed bytes, path escape and external symlink',async()=>{
 const temporary=await mkdtemp(join(tmpdir(),'atlas-package-verification-'));
 try{
  const workspace=join(temporary,'source'),script=join(workspace,'frontend/atlas-app/scripts/verify-manual-container.mjs');await mkdir(dirname(script),{recursive:true});
  await writeFile(script,await readFile(resolve(root,'frontend/atlas-app/scripts/verify-manual-container.mjs')));
  const bytes=Buffer.from('authored source only\n'),source=join(workspace,'current.txt'),manifest=join(temporary,'manifest.json');await writeFile(source,bytes);
  const data={version:'atlas-clean-manual-source-v1',files:[{path:'current.txt',byteCount:bytes.length,sha256:sha(bytes)},{path:'frontend/atlas-app/scripts/verify-manual-container.mjs',byteCount:(await readFile(script)).length,sha256:sha(await readFile(script))}]};
  const save=()=>writeFile(manifest,JSON.stringify(data));await save();
  const run=()=>spawnSync(process.execPath,[script,manifest],{encoding:'utf8'});
  assert.equal(run().status,0);
  const unexpected=join(workspace,'unmanifested-card.jpg');await writeFile(unexpected,'authored test bytes');assert.notEqual(run().status,0);await rm(unexpected);
  await writeFile(source,'changed');assert.notEqual(run().status,0);await writeFile(source,bytes);
  data.files[0].path='../escape.txt';await save();assert.notEqual(run().status,0);data.files[0].path='current.txt';await save();
  const external=join(temporary,'other.txt');await writeFile(external,bytes);await rm(source);await symlink(external,source);assert.notEqual(run().status,0);
 }finally{await rm(temporary,{recursive:true,force:true});}
});
