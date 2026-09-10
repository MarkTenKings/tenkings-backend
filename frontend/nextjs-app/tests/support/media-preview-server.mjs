// Local browser/network proof: env -i PATH=<Node 20 path> node tests/support/media-preview-server.mjs
// Uses actual Home/LiveRipPreview components; unrelated app services and remote media providers are synthetic.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(new URL("../../package.json", import.meta.url));
const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild");
const appRoot = fileURLToPath(new URL("../../", import.meta.url));
const fixture = await readFile(new URL("../../public/admin/launch/add-cards.mp4", import.meta.url));
const entry = `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import Home from "./pages/index";
import LiveRipPreview from "./components/LiveRipPreview";
function Gallery() {
 const [muted,setMuted]=useState(true); const [count,setCount]=useState(0); const [hidden,setHidden]=useState(false);
 React.useEffect(()=>{const t=setInterval(()=>setCount(c=>c+1),3000);return ()=>clearInterval(t)},[]);
 return <main className="p-6 text-white"><h1>Local media network proof</h1>
 <button onClick={()=>setCount(c=>c+1)}>Refresh metadata</button> · <button onClick={()=>setHidden(h=>!h)}>Toggle preview visibility</button>
 <p>Metadata refresh: {count}</p><div style={{display:hidden?'none':'grid',gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))',gap:16}}>
 {['First','Second','Mux','YouTube'].map((title,i)=><LiveRipPreview key={title} id={title} title={title} videoUrl={i===3?'https://youtube.com/watch?v=mock': '/media/'+title+'.mp4'} muxPlaybackId={i===2?'mock':null} muted={muted} onToggleMute={()=>setMuted(m=>!m)} viewCount={count} thumbnailUrl="/poster.svg"/>)}
 </div><div style={{height:1600}}>Scroll below previews to test offscreen suspension</div></main>
}
function App(){return location.pathname==='/home'?<Home initialPulls={[]} initialCollectorNames={{}} initialLiveRipTiles={[]}/>:<Gallery/>}
const events=[]; ['playing','ended','error'].forEach(type=>document.addEventListener(type,e=>{if(e.target.tagName==='VIDEO')events.push({type,source:e.target.getAttribute('src'),time:e.target.currentTime,error:e.target.error?.code});},true));
createRoot(document.getElementById('root')).render(<App/>);
setInterval(async()=>{const m=await fetch('/metrics').then(r=>r.json());document.getElementById('metrics').textContent=JSON.stringify({...m,events,players:document.querySelectorAll('video,iframe,mux-player').length,playing:[...document.querySelectorAll('video')].map(v=>({src:v.getAttribute('src'),paused:v.paused,time:Math.round(v.currentTime)}))});},300);
`;
const stubs = {
 "@tenkings/database": 'export const prisma=new Proxy({}, {get(){throw new Error("Database forbidden in local media proof")}})',
 "next/head": 'export default function Head(){return null}',
 "next/router": 'export const useRouter=()=>({push:async()=>{},query:{}})',
 "next/image": 'import React from "react"; export default function Image({fill,priority,...p}){return <img {...p} src="/poster.svg"/>}',
 "next/link": 'import React from "react"; export default function Link({children,...p}){return <a {...p}>{children}</a>}',
 "../components/AppShell": 'import React from "react"; export default function AppShell({children}){return <main>{children}</main>}',
 "../components/CardImage": 'export function CardImage(){return null}',
 "../components/CardDetailModal": 'export default function Modal(){return null}',
 "../lib/api": 'export const fetchCollector=async()=>({})',
 "../lib/server/recentPulls": 'export const loadRecentPulls=async()=>[]',
 "@mux/mux-player-react": 'import React from "react"; export default function Mux({muted}){return <video aria-label="Mock Mux" src="/media/mux.mp4" autoPlay controls muted={muted}/>}',
};
const result = await build({stdin:{contents:entry,resolveDir:appRoot,loader:'tsx'},bundle:true,write:false,platform:'browser',jsx:'automatic',
 define:{'process.env.NODE_ENV':'"development"','process.env.NEXT_PUBLIC_HERO_VIDEO_URL':'"/media/hero.mp4"','process.env.NEXT_PUBLIC_HERO_IMAGE_URL':'"/poster.svg"'},
 plugins:[{name:'synthetic-app-boundaries',setup(b){b.onResolve({filter:/.*/},a=>stubs[a.path]?{path:a.path,namespace:'stub'}:null);b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path],loader:'tsx',resolveDir:appRoot}));}}]});
const css = await require('postcss')([require('tailwindcss')({...require(appRoot+'tailwind.config.js'),content:[appRoot+'pages/index.tsx',appRoot+'components/OnDemandMedia.tsx',appRoot+'components/LiveRipPreview.tsx',{raw:entry,extension:'tsx'}]})]).process('@tailwind base;@tailwind components;@tailwind utilities;', {from:undefined});
const metrics = { requests: [], bytes: 0 };
const server=http.createServer((req,res)=>{
 const path=new URL(req.url,'http://127.0.0.1').pathname;
 res.setHeader('Cache-Control','no-store');
 if(path==='/metrics'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(metrics))}
 if(path.startsWith('/media/')){
  const match=/bytes=(\d+)-(\d*)/.exec(req.headers.range??''); const start=match?Number(match[1]):0;const end=match&&match[2]?Math.min(Number(match[2]),fixture.length-1):fixture.length-1;
  metrics.requests.push({path,start,end}); metrics.bytes+=end-start+1;
  res.writeHead(match?206:200,{'Content-Type':'video/mp4','Accept-Ranges':'bytes','Content-Length':end-start+1,...(match?{'Content-Range':`bytes ${start}-${end}/${fixture.length}`}:{})});return res.end(fixture.subarray(start,end+1));
 }
 if(path==='/bundle.js'){res.setHeader('Content-Type','application/javascript');return res.end(result.outputFiles[0].contents)}
 if(path==='/style.css'){res.setHeader('Content-Type','text/css');return res.end(css.css)}
 if(path==='/poster.svg'){res.setHeader('Content-Type','image/svg+xml');return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><rect width="320" height="320" fill="#20304a"/><text x="160" y="145" text-anchor="middle" fill="white">LOCAL POSTER</text></svg>')}
 if(path.startsWith('/api/')){res.setHeader('Content-Type','application/json');return res.end('{"pulls":[],"liveRips":[]}')}
 if(path==='/favicon.ico'){res.writeHead(204);return res.end()}
 if(path!=='/home'&&path!=='/preview'){res.writeHead(404);return res.end()}
 res.setHeader('Content-Type','text/html');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; media-src 'self'; frame-src 'none'");
 res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><title>Local media proof</title></head><body style="background:#05060a"><div id="root"></div><pre id="metrics" style="position:fixed;bottom:0;left:0;z-index:999;background:black;color:white;white-space:pre-wrap;font-size:11px;max-height:100px;overflow:auto">Loading local metrics</pre><script src="/bundle.js"></script></body></html>');
});
server.listen(3188,'127.0.0.1',()=>console.log('Local media fixture: http://127.0.0.1:3188/home and /preview; bytes use checked-in 1 MB local fixture only.'));
