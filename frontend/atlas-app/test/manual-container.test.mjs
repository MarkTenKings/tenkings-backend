import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,writeFile,readFile,mkdir,rm,symlink,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {collectManualSource,packageManualContainer,CPU_SOURCES,VENDOR_SOURCES} from '../scripts/package-manual-container.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test('actual clean serving closure contains current workers and camera but no historical data, schema installers or build outputs',async()=>{
 const {files,packages}=await collectManualSource();const paths=new Set(files.map(file=>file.path));
 assert(packages.includes('packages/atlas-connected-manual'));assert(!packages.includes('packages/database'));
 assert(!packages.includes('packages/atlas-standalone-database'));
 for(const name of CPU_SOURCES)assert(paths.has('backend/ai-grader-speedster-service/'+name),name);
 assert.equal(CPU_SOURCES.length,8);assert(paths.has('frontend/atlas-shared/RapidCardCamera.jsx'));
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
