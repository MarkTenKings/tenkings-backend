import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../../../..');
const publicRoot=path.join(root,'frontend/atlas-public/public');
const serviceRoot=path.join(root,'frontend/atlas-customer/public/atlas');
const files=new Map([['/',path.join(here,'index.html')],['/study.css',path.join(here,'study.css')],['/study.js',path.join(here,'study.js')],['/slab.js',path.join(here,'slab.js')]]);
for(const name of ['atlas-charizard-first-edition.jpg','atlas-kobe-rookie.jpg'])files.set('/marketing/'+name,path.join(publicRoot,'marketing',name));
files.set('/brand/atlas-grading-logo.png',path.join(publicRoot,'brand/atlas-grading-logo.png'));
for(const name of ['original-4.woff2','original-3.woff2'])files.set('/brand/fonts/'+name,path.join(publicRoot,'brand/fonts',name));
for(const name of ['submission-kiosk.jpg','submission-fedex.jpg','submission-kiosk.mp4','submission-fedex.mp4'])files.set('/service/'+name,path.join(serviceRoot,name));
for(const name of ['alakazam-reference.jpg','alakazam-label-sample.svg','vendor/three.core.js','vendor/three.module.js'])files.set('/assets/'+name,path.join(here,'assets',name));
files.set('/submission-source.css',path.join(here,'submission-source.css'));
files.set('/assets/oxanium.ttf',path.join(here,'assets/oxanium.ttf'));
for(const name of ['hero-reports.js','hero-report-model.mjs','report-guidance.js','report-guidance.css'])files.set('/'+name,path.join(here,name));
for(const name of ['approved.json','maye-front.webp','maye-back.webp','abomasnow-front.webp','abomasnow-back.webp','dart-front.webp','dart-back.webp'])files.set('/reports-data/'+name,path.join(here,'reports',name));
const port=Number(process.env.ATLAS_PREVIEW_PORT||8789);
const types={'.json':'application/json','.webp':'image/webp','.mjs':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.jpg':'image/jpeg','.png':'image/png','.mp4':'video/mp4','.woff2':'font/woff2','.ttf':'font/ttf'};
http.createServer(async(req,res)=>{
  const file=files.get(new URL(req.url,'http://localhost').pathname);
  if(!file||!['GET','HEAD'].includes(req.method)){res.writeHead(404);res.end();return;}
  try{const bytes=await readFile(file);res.writeHead(200,{'Content-Type':types[path.extname(file)],'Content-Length':bytes.length,'X-Robots-Tag':'noindex, nofollow','Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:bytes);}catch{res.writeHead(500);res.end('Preview asset unavailable');}
}).listen(port,'127.0.0.1',()=>console.log(`ATLAS design study: http://127.0.0.1:${port}`));
