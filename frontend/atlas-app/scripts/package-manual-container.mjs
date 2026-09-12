import {readFile,mkdir,writeFile,copyFile} from 'node:fs/promises';
import {resolve,relative,join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const output=resolve(process.argv[2]??'');const vendor=resolve(process.argv[3]??'');
if(process.argv.length!==4 || output===root || output.startsWith(`${root}/`))throw new Error('Supply external fresh output directory and verified source-archive directory');
await mkdir(output,{recursive:false});await mkdir(join(output,'source'));await mkdir(join(output,'vendor'));
const packages=new Map();
const tracked=execFileSync('git',['ls-files','-co','--exclude-standard'],{cwd:root,encoding:'utf8'}).trim().split('\n');
for(const file of tracked.filter(file=>/^(packages|frontend)\/[^/]+\/package.json$/.test(file))){const value=JSON.parse(await readFile(join(root,file),'utf8'));packages.set(value.name,{directory:dirname(file),value});}
const allowed=new Set();function visit(name){const item=packages.get(name);if(!item||allowed.has(item.directory))return;allowed.add(item.directory);for(const [key,value]of Object.entries({...item.value.dependencies,...item.value.devDependencies}))if(value.startsWith('workspace:'))visit(key);}
visit('@atlas/staff-app');
const cpu=['manual_preparation_worker.py','manual_measurement_worker.py','manual_measurement.py','card_geometry.py','color_geometry.py','preparation_pixels.py','defect_math.py','trace_rle.py'];
const manifest=[];
for(const file of [...new Set(tracked)].filter(file=>['package.json','pnpm-lock.yaml','pnpm-workspace.yaml'].includes(file)||[...allowed].some(directory=>file.startsWith(`${directory}/`))||cpu.some(name=>file===`backend/ai-grader-speedster-service/${name}`))){
  if(/(?:^|\/)(?:node_modules|\.next|\.generated)(?:\/|$)/.test(file))continue;
  const bytes=await readFile(join(root,file));await mkdir(dirname(join(output,'source',file)),{recursive:true});await writeFile(join(output,'source',file),bytes);
  manifest.push({path:file,sha256:createHash('sha256').update(bytes).digest('hex'),byteCount:bytes.length});
}
for(const name of ['libheif-1.23.2.tar.gz','libde265-1.1.1.tar.gz'])await copyFile(join(vendor,name),join(output,'vendor',name));
await copyFile(join(root,'frontend/atlas-app/Dockerfile.manual'),join(output,'Dockerfile'));
await writeFile(join(output,'source-manifest.json'),JSON.stringify({files:manifest},null,2));console.log(JSON.stringify({directory:output,files:manifest.length,packages:[...allowed]}));
