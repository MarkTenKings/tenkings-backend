// Freeze the complete approved experience and every dependency under one digest.
// This is a marketing demonstration; it never publishes or restores a report.
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.resolve(app,'../../docs/atlas/design/experience');
const names=JSON.parse(await readFile(path.join(source,'files.json'),'utf8'));
if(!Array.isArray(names)||!names.includes('index.html')||new Set(names).size!==names.length||names.some(n=>typeof n!=='string'||n.startsWith('/')||n.split('/').some(p=>['','..','.'].includes(p))))throw Error('Invalid homepage closure');
const files=new Map();const digest=createHash('sha256').update('atlas-experience-v1\n').update(await readFile(fileURLToPath(import.meta.url)));
for(const name of [...names].sort()){const bytes=await readFile(path.join(source,'site',name));files.set(name,bytes);digest.update(name+'\0').update(String(bytes.length)+'\0').update(bytes);}
const version=digest.digest('hex').slice(0,16),prefix='/homepage/'+version,output=path.join(app,'public',prefix);
const textTypes=new Set(['.html','.css','.js','.mjs','.glsl','.json','.svg']);
const replacePaths=text=>{
 let value=text;
 // Root-relative URLs move under the digest. Relative module imports already
 // resolve beside their copied module and must not gain a second directory.
 for(const name of [...names].sort((a,b)=>b.length-a.length)){
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  value=value.replace(new RegExp('(?<![\\w./-])/'+escaped+'(?=$|[?#\"\'`\\s)<>])','g'),prefix+'/'+name);
 }
 return value.replaceAll('https://atlasgrading.com/account/submit','/account/submit');
};
const manifest=JSON.parse(files.get('hero-assets/manifest.json'));
if(manifest.report?.status!=='ARCHIVED_APPROVED_SAMPLE'||manifest.report?.liveUrl!==null||manifest.provenance?.liveRecordRestored!==false)throw Error('Marketing sample must retain archival status');
for(const side of ['FRONT','BACK'])for(const type of ['presentation','original','mask','fingerprint']){
 const asset=manifest.sides[side][type],bytes=files.get(asset.src.slice(1));
 if(!bytes||createHash('sha256').update(bytes).digest('hex')!==asset.sha256||bytes.length!==asset.bytes)throw Error('Evidence asset drift: '+side+' '+type);
}
await mkdir(output,{recursive:true});
for(const [name,bytes] of files){
 const target=path.join(output,name);await mkdir(path.dirname(target),{recursive:true});
 if(textTypes.has(path.extname(name))){let text=bytes.toString('utf8');if(/\/Users\/|\/private\/tmp\//.test(text))throw Error('Local path in public source: '+name);text=replacePaths(text);if(name==='index.html')text=text.replace('<meta name="robots" content="noindex,nofollow">','').replace('Archived approved card · Interactive design preview','Archived approved card · Explore the saved evidence').replace('DESIGN STUDY 10 / EVERY DETAIL LEAVES A SIGNATURE.','EVERY DETAIL LEAVES A SIGNATURE.').replace('</title>','</title><meta name="description" content="See the findings behind the grade. Explore ATLAS card reports, the ATLAS fingerprint, and fast card submissions."><link rel="canonical" href="https://atlasgrading.com/">');await writeFile(target,text);}
 else await copyFile(path.join(source,'site',name),target);
}
await copyFile(path.join(output,'index.html'),path.join(app,'public/homepage/index.html'));
await writeFile(path.join(app,'public/homepage/release.json'),JSON.stringify({version,presentation:'atlas-experience-v1',approvedReportCount:0,archivedSampleCount:1,sourceFileCount:files.size,liveRecordRestored:false})+'\n');
console.log(JSON.stringify({status:'HOMEPAGE_PACKAGED',version,prefix,files:files.size,archivedSampleCount:1}));
