import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile,lstat,realpath} from 'node:fs/promises';
import {resolve,relative,join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const CPU_SOURCES=Object.freeze(['manual_preparation_worker.py','manual_measurement_worker.py',
  'manual_measurement.py','card_geometry.py','preparation_pixels.py','preparation_encoding.py','defect_math.py','trace_rle.py']);
export const VENDOR_SOURCES=Object.freeze({
  'libde265-1.1.1.tar.gz':'5b4fac677018e6074196e8f9889f3e4a5310e46afbf22a893f620d4e24d3510e',
  'libheif-1.23.2.tar.gz':'1405ed070421459b569ff49deab109b7f1a30a447e72a9b20a4154f774634a44',
});
// These retained manufacturer inputs are runtime dependencies of the catalog
// reader. Keep the list explicit; acquisition evidence and other data stay out.
export const MANUFACTURER_CATALOG_SOURCES=Object.freeze([
  'packages/card-catalog-evidence/data/manufacturer-checklists.json.gz',
  'packages/card-catalog-evidence/data/manufacturer-parallel-families.json',
  'packages/card-catalog-evidence/data/manufacturer-product-aliases.json',
]);
const required=new Set(['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.base.json',
  ...MANUFACTURER_CATALOG_SOURCES,
  'frontend/atlas-shared/RapidCardCamera.jsx','frontend/atlas-shared/RapidCardCamera.module.css','frontend/atlas-shared/rapid-camera.mjs',
  'frontend/atlas-app/next.config.mjs','frontend/atlas-app/.eslintrc.json','frontend/atlas-app/prisma/schema.prisma',
  'packages/atlas-site-router/routes.mjs','packages/atlas-site-router/proof.mjs','packages/atlas-site-router/server.mjs',
  'frontend/atlas-app/scripts/generate-database.mjs','frontend/atlas-app/scripts/check-boundary.mjs',
  'frontend/atlas-app/scripts/verify-manual-container.mjs',
  'packages/atlas-grading-core/scripts/build.mjs','packages/atlas-grading-core/extraction-manifest.json',
  'packages/atlas-manual-workspace/scripts/build.mjs',
  'packages/atlas-measurement-runtime/engine-source.json',
  'packages/atlas-photo-runtime/native/heif.cc','packages/atlas-photo-runtime/scripts/build-native.mjs',
  ...CPU_SOURCES.map(name=>'backend/ai-grader-speedster-service/'+name),
  ...['serve','serve-variants','private-server','analysis-worker','variant-workers','customer-runtime','customer-database']
    .map(name=>'packages/atlas-connected-manual/scripts/'+name+'.mjs')]);
const excluded=/(?:^|\/)(?:node_modules|dist|\.next|\.generated|\.git|\.vercel|__pycache__|test|tests|test-fixtures|fixtures|sql|migrations|docs|archive|evidence|screenshots)(?:\/|$)|(?:^|\/)\.env(?:\.|$)|\.(?:pyc|pyo|node|log|pem|key|sqlite|dump|bak)$/;

/** Only current source and explicit build/runtime inputs; no old image or generated checkout files. */
export async function collectManualSource(workspace=root){
  const tracked=[...new Set(execFileSync('git',['ls-files','-co','--exclude-standard','-z'],{cwd:workspace,encoding:'utf8'}).split('\0').filter(Boolean))].sort();
  const existing=[];
  for(const file of tracked){
    let stat;try{stat=await lstat(join(workspace,file));}catch(error){if(error.code==='ENOENT')continue;throw error;}
    if(stat.isFile()||stat.isSymbolicLink())existing.push(file);
  }
  const packages=new Map();
  for(const file of existing.filter(file=>/^(packages|frontend)\/[^/]+\/package.json$/.test(file))){
    const value=JSON.parse(await readFile(join(workspace,file),'utf8'));
    packages.set(value.name,{directory:dirname(file),value});
  }
  const allowed=new Set();
  function visit(name){
    const item=packages.get(name);assert(item,`Missing workspace dependency: ${name}`);
    assert(!['@tenkings/database','@atlas/standalone-database','@atlas/operator','@atlas/contracts'].includes(name),`Retired/database deployment package in serving closure: ${name}`);
    if(allowed.has(item.directory))return;allowed.add(item.directory);
    for(const [key,value]of Object.entries({...item.value.dependencies,...item.value.devDependencies}))if(value.startsWith('workspace:'))visit(key);
  }
  visit('@atlas/staff-app');
  const selected=existing.filter(file=>{
    if(excluded.test(file))return false;
    if(required.has(file))return true;
    if(/^frontend\/atlas-app\/(?:pages|components|lib|styles|public)\//.test(file))return !/\/access\/(?:fixture|workspace-fixture|fixture-analysis)\.mjs$/.test(file);
    for(const directory of allowed){
      if(!file.startsWith(directory+'/'))continue;
      const local=file.slice(directory.length+1);
      return local==='package.json'||local==='tsconfig.json'||local==='browser.mjs'||local.startsWith('src/');
    }
    return false;
  });
  const names=new Set(selected);
  for(const file of required)assert(names.has(file),`Required current source is missing: ${file}`);
  const workspaceReal=await realpath(workspace),files=[];
  for(const path of selected){
    const full=join(workspace,path),stat=await lstat(full);
    assert(stat.isFile()&&!stat.isSymbolicLink(),`Source symlink is not allowed: ${path}`);
    const rel=relative(workspaceReal,await realpath(full));assert(rel&&!rel.startsWith('..'),`External source: ${path}`);
    const bytes=await readFile(full);files.push({path,bytes,sha256:sha(bytes),byteCount:bytes.length});
  }
  return {files,packages:[...allowed].sort()};
}

export async function packageManualContainer(outputDirectory,vendorDirectory){
  const output=resolve(outputDirectory),vendor=resolve(vendorDirectory);
  assert(output!==root&&!output.startsWith(root+'/'),'Supply a fresh output directory outside the checkout');
  const vendorFiles=[];
  for(const [name,expected]of Object.entries(VENDOR_SOURCES)){
    const bytes=await readFile(join(vendor,name));assert.equal(sha(bytes),expected,`Native source checksum mismatch: ${name}`);
    vendorFiles.push({path:'vendor/'+name,bytes,sha256:expected,byteCount:bytes.length});
  }
  const collected=await collectManualSource();
  const recipe=await readFile(join(root,'frontend/atlas-app/Dockerfile.manual'));
  assert.equal((recipe.toString().match(/^FROM node:22.23.2-bookworm-slim@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9/gm)||[]).length,2,'Both stages require the pinned official Node base');
  assert(!/^ARG .*IMAGE|^FROM (?!node:22\.23\.2-bookworm-slim@sha256:)/m.test(recipe.toString()),'Runtime-image overrides are forbidden');
  await mkdir(output,{recursive:false});
  for(const file of [...collected.files.map(file=>({...file,path:'source/'+file.path})),...vendorFiles,{path:'Dockerfile',bytes:recipe}]){
    await mkdir(dirname(join(output,file.path)),{recursive:true});await writeFile(join(output,file.path),file.bytes,{flag:'wx'});
  }
  const manifest={version:'atlas-clean-manual-source-v1',officialNodeImage:'node:22.23.2-bookworm-slim@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9',
    packagerSha256:sha(await readFile(fileURLToPath(import.meta.url))),dockerfileSha256:sha(recipe),packages:collected.packages,cpuSources:CPU_SOURCES,
    files:collected.files.map(({bytes,...file})=>file),vendor:vendorFiles.map(({bytes,...file})=>file)};
  await writeFile(join(output,'source-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  await writeFile(join(output,'.dockerignore'),'**/.env\n**/.env.*\n**/.git\n**/node_modules\n**/dist\n**/native/build\n**/.next\n**/.generated\n**/__pycache__\n',{flag:'wx'});
  return {directory:output,files:manifest.files.length,packages:manifest.packages,cpuSources:CPU_SOURCES,sourceManifestSha256:sha(await readFile(join(output,'source-manifest.json')))};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  assert.equal(process.argv.length,4,'Usage: node scripts/package-manual-container.mjs FRESH_EXTERNAL_OUTPUT VERIFIED_VENDOR_DIRECTORY');
  console.log(JSON.stringify(await packageManualContainer(process.argv[2],process.argv[3])));
}
