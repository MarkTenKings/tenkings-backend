// Package the card-free marketing homepage until an actual card is approved.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.join(app,'homepage-empty');
const [html,css]=await Promise.all(['index.html','site.css'].map(name=>readFile(path.join(source,name),'utf8')));
const version=createHash('sha256').update(html).update(css).digest('hex').slice(0,16);
const publicDir=path.join(app,'public/homepage');
const output=path.join(publicDir,version);
await mkdir(output,{recursive:true});
await writeFile(path.join(output,'site.css'),css);
await writeFile(path.join(publicDir,'index.html'),html.replaceAll('__VERSION__',version));
await writeFile(path.join(publicDir,'release.json'),JSON.stringify({version,presentation:'ungraded-empty-state',illustrativeReport:false,approvedReportCount:0})+'\n');
console.log(JSON.stringify({status:'HOMEPAGE_PACKAGED',version,prefix:`/homepage/${version}`}));
