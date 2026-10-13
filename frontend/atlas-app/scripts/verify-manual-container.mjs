import assert from 'node:assert/strict';
import {readFile,lstat,realpath,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {resolve,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const [manifestPath,mode='source']=process.argv.slice(2);
assert(manifestPath&&['source','native'].includes(mode),'Supply source manifest and source/native mode');
const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
assert.equal(manifest.version,'atlas-clean-manual-source-v1');
assert.equal(new Set(manifest.files.map(file=>file.path)).size,manifest.files.length);
for(const file of manifest.files){
  assert(file.path&&!file.path.startsWith('/')&&!file.path.split('/').some(part=>['','..','.'].includes(part)));
  const path=resolve(root,file.path),stat=await lstat(path);assert(stat.isFile()&&!stat.isSymbolicLink());
  assert(!relative(await realpath(root),await realpath(path)).startsWith('..'));
  const bytes=await readFile(path);assert.equal(bytes.length,file.byteCount,file.path);assert.equal(hash(bytes),file.sha256,file.path);
}
if(mode==='source'){
  const all=[];
  async function walk(directory){for(const entry of await readdir(directory,{withFileTypes:true})){
    const path=resolve(directory,entry.name);assert(!entry.isSymbolicLink(),'Source closure contains a symlink');
    if(entry.isDirectory())await walk(path);else{assert(entry.isFile());all.push(relative(root,path));}
  }}
  await walk(root);assert.deepEqual(all.sort(),manifest.files.map(file=>file.path).sort(),'Source closure has unmanifested or missing files');
}
const result={status:'CLEAN_MANUAL_SOURCE_VERIFIED',sourceFiles:manifest.files.length,sourceManifestSha256:hash(await readFile(manifestPath)),node:process.version};
if(manifest.packages?.includes('packages/card-catalog-evidence')){
  // Exercise the packaged reader and its supplemental data before a release
  // can pass on source hashes alone. This is an offline catalog lookup only.
  const fetch=globalThis.fetch;
  globalThis.fetch=()=>assert.fail('Manufacturer catalog verification must remain offline');
  try{
    const {createManufacturerChecklistVariantProvider}=await import(new URL('../../../packages/card-catalog-evidence/src/manufacturer-checklist.mjs',import.meta.url));
    const identity={category:'SPORTS',name:'Nick Kurtz',manufacturer:'Topps',setName:'Bowman Chrome',cardNumber:'93',year:null,language:null};
    const catalog=await createManufacturerChecklistVariantProvider().prepare(identity);
    assert.deepEqual(catalog.problems,[]);assert.equal(catalog.truncated,false);assert.equal(identity.year,null);
    const checklistSha256='3ee770b295a63bc8482899b50fb651bcc6cdb55796d53e3bf4b1bd1efc5cc55f';
    for(const label of ['BASE CARDS','BASE CARDS CHROME ROOKIE RED RC VARIATION','Refractor']){
      const candidate=catalog.candidates.find(value=>value.label===label);assert(candidate,`Packaged manufacturer choice missing: ${label}`);
      assert.equal(candidate.identity.year,'2025');assert.equal(candidate.identity.cardNumber,'93');
      assert.equal(candidate.source.provider,'manufacturer_checklist');assert.equal(candidate.authority,'provider_candidate');
      assert.equal(candidate.applicability,'unknown');
      assert([candidate.source,...candidate.source.references].some(source=>source.sha256===checklistSha256),'Packaged choice is not bound to the retained official checklist');
    }
    result.manufacturerCatalog={identity,candidates:catalog.candidates.length,checklistSha256,providerCalls:0};
  }finally{globalThis.fetch=fetch;}
}
if(mode==='native'){
  assert.equal(process.versions.node,'22.23.2');assert.equal(process.platform,'linux');
  const require=createRequire(import.meta.url),addon=require(resolve(root,'packages/atlas-photo-runtime/native/build/heif.node'));
  // Invalid bytes reach the pinned version/decoder checks before input rejection.
  assert.throws(()=>addon.probe(Buffer.from([0]),{maxInputBytes:1024,maxPixels:1024,maxRasterBytes:4096}),error=>error.code==='PHOTO_DECODE_INVALID');
  const nativeBuild=JSON.parse(await readFile(resolve(root,'packages/atlas-photo-runtime/native/build/build.json'),'utf8'));
  assert.equal(nativeBuild.binarySha256,hash(await readFile(resolve(root,'packages/atlas-photo-runtime/native/build/heif.node'))));
  assert.equal(nativeBuild.sourceSha256,hash(await readFile(resolve(root,'packages/atlas-photo-runtime/native/heif.cc'))));
  assert.equal(nativeBuild.libheif,'1.23.2');assert.equal(nativeBuild.platform,process.platform);assert.equal(nativeBuild.arch,process.arch);
  const sharp=require('sharp'),png=await sharp({create:{width:16,height:16,channels:4,background:{r:40,g:90,b:150,alpha:.5}}}).png().toBuffer();
  assert.equal((await sharp(png).metadata()).width,16);
  const script=[
    'import sys,json,pathlib,hashlib',
    'sys.path.insert(0,sys.argv[1])',
    'import manual_preparation_worker,manual_measurement_worker,preparation_encoding',
    'import cv2,numpy as np',
    "assert cv2.__version__=='4.10.0' and np.__version__=='1.26.4'",
    'a=np.zeros((16,16,4),dtype=np.uint8);a[:,:,0]=40;a[:,:,1]=90;a[:,:,2]=150;a[:,:,3]=128',
    'b=preparation_encoding.encode_lossless_webp(a);d=cv2.imdecode(np.frombuffer(b,np.uint8),cv2.IMREAD_UNCHANGED);assert np.array_equal(a,d)',
    "root=pathlib.Path(sys.argv[1]);print(json.dumps({'python':sys.version.split()[0],'numpy':np.__version__,'opencv':cv2.__version__,'rgbaLosslessRoundtrip':True,'sources':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(root.glob('*.py'))}}))",
  ].join('\n');
  const python=JSON.parse(execFileSync('/opt/atlas-python/bin/python',['-I','-B','-c',script,resolve(root,'backend/ai-grader-speedster-service')],
    {encoding:'utf8',timeout:30000,env:{PATH:process.env.PATH,OPENBLAS_NUM_THREADS:'1',OMP_NUM_THREADS:'1',PYTHONNOUSERSITE:'1'}}));
  assert.deepEqual(Object.keys(python.sources).sort(),[...manifest.cpuSources].sort());
  for(const [name,digest]of Object.entries(python.sources))assert.equal(digest,manifest.files.find(file=>file.path==='backend/ai-grader-speedster-service/'+name)?.sha256);
  const measurement=JSON.parse(await readFile(resolve(root,'packages/atlas-measurement-runtime/engine-source.json'),'utf8'));
  for(const [name,digest]of Object.entries(measurement.sources))assert.equal(python.sources[name],digest,name);
  Object.assign(result,{status:'CLEAN_MANUAL_NATIVE_VERIFIED',platform:process.platform,arch:process.arch,sharp:sharp.versions,
    nativeBuild,python,
    fixturePhotosIncluded:0,databaseConnections:0,providerCalls:0});
}
console.log(JSON.stringify(result));
