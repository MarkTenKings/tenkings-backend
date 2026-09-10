// Installed Mux custom elements + real LiveRipPreview; only media transport is local.
// YouTube is a local iframe fixture, not YouTube's remote player implementation.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(new URL("../../package.json", import.meta.url));
const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild");
const appRoot = fileURLToPath(new URL("../../", import.meta.url));
const actualMux = require.resolve("@mux/mux-player-react").replace(/index\.cjs\.js$/, "index.mjs");
const fixture = await readFile(new URL("../../public/admin/launch/add-cards.mp4", import.meta.url));
const entry = `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import LiveRipPreview from "./components/LiveRipPreview";
const records=[]; const detached=[]; const events=[];
const output=()=>{document.getElementById('results').textContent=JSON.stringify({records,events,detached:detached.map(({kind,element,video,hls})=>({kind,connected:element.isConnected,videoSrc:video?.getAttribute('src'),paused:video?.paused,frameWindow:kind==='YouTube'?!!element.contentWindow:undefined,hlsMediaAttached:hls?!!hls.media:undefined})),players:document.querySelectorAll('mux-player,iframe').length},null,2)};
const mark=(name,pass,details)=>{records.push({name,pass,details});output()};
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const waitFor=async (f)=>{const end=Date.now()+6000;while(Date.now()<end){if(f())return;await sleep(25)}throw Error('timed out')};
const click=(label)=>{const b=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===label||b.textContent===label);if(!b)throw Error('missing '+label);b.click()};
const element=(kind)=>document.querySelector(kind==='Mux'?'mux-player':'iframe');
const remember=(kind)=>{const el=element(kind);const video=kind==='Mux'?el?.media?.nativeEl:el?.contentDocument?.querySelector('video');detached.push({kind,element:el,video,hls:el?._hls});return {el,video}};
const run=async()=>{
 records.length=0;events.length=0;detached.length=0;
 try{
 mark('no media before intent',!document.querySelector('mux-player,iframe'));
 for(const kind of ['Mux','YouTube']){
  click('Play '+kind);await waitFor(()=>element(kind));const {el,video}=remember(kind);
  if(kind==='Mux'){el.addEventListener('ended',e=>{events.push({type:'mux-ended',bubbles:e.bubbles,composed:e.composed});output()});await waitFor(()=>video.currentTime>0);}
  else {await waitFor(()=>el.contentDocument?.querySelector('video')?.currentTime>0);}
  mark(kind+' real local playback advances',true);
  await sleep(4000);
  mark(kind+' natural end returns to poster',!element(kind));
  if(element(kind))click('Close '+kind);
  await waitFor(()=>!element(kind));
  for(const action of ['close','source','offscreen','hidden','switch']){
   click('Play '+kind);await waitFor(()=>element(kind));remember(kind);
   if(action==='close')click('Close '+kind);
   if(action==='source')click('Change source');
   if(action==='offscreen'){window.scrollTo(0,1500)}
   if(action==='hidden'){Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'))}
   if(action==='switch')click('Play '+(kind==='Mux'?'YouTube':'Mux'));
   await waitFor(()=>!element(kind));
   mark(kind+' '+action+' removes player',!element(kind));
   if(action==='offscreen'){window.scrollTo(0,0);await sleep(100)}
   if(action==='hidden'){delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'))}
   if(action==='switch'){click('Close '+(kind==='Mux'?'YouTube':'Mux'));await sleep(100)}
   mark(kind+' '+action+' does not resume',!element(kind));
  }
 }
 for(const action of ['close','source','offscreen','hidden','switch']){
  click('Play Mux HLS');await waitFor(()=>element('Mux')?._hls?.media);
  const {el}=remember('Mux');const hls=el._hls;
  await sleep(100);
  mark('Mux HLS '+action+' starts actual MSE engine',!!hls.media);
  if(action==='close')click('Close Mux HLS');
  if(action==='source')click('Change source');
  if(action==='offscreen')window.scrollTo(0,1500);
  if(action==='hidden'){Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'))}
  if(action==='switch')click('Play YouTube');
  await waitFor(()=>!element('Mux'));await sleep(100);
  mark('Mux HLS '+action+' destroys actual MSE engine',!hls.media&&!el.isConnected);
  if(action==='offscreen'){window.scrollTo(0,0);await sleep(100)}
  if(action==='hidden'){delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'))}
  if(action==='switch'){click('Close YouTube');await sleep(100)}
 }
 const requests=await fetch('/metrics').then(r=>r.json());
 const stalled=requests.filter(r=>r.path==='/media/stalled.m3u8');
 mark('Mux HLS outstanding requests canceled',stalled.length>=5&&stalled.every(r=>r.closed),stalled);
 }catch(e){mark('fixture error',false,String(e))}
 output();
};
function App(){const [muted,setMuted]=useState(true);const [source,setSource]=useState(0);return <main>
 <h1>Installed provider lifecycle proof</h1><p>Mux uses installed custom elements and local MP4. YouTube uses a synthetic local iframe.</p>
 <button onClick={run}>Run lifecycle checks</button> <button onClick={()=>setSource(s=>s+1)}>Change source</button>
 <div style={{display:'grid',gridTemplateColumns:'repeat(3,320px)',gap:20}}>{['Mux','YouTube','Mux HLS'].map(kind=><LiveRipPreview key={kind} id={kind} title={kind} videoUrl={kind==='YouTube'?'https://youtube.com/watch?v=local'+source:'/media/mux.mp4?source='+source} muxPlaybackId={kind==='Mux HLS'?'stalled'+source:kind==='Mux'?'local'+source:undefined} thumbnailUrl='/poster.svg' muted={muted} onToggleMute={()=>setMuted(m=>!m)}/>)}</div>
 <pre id='results'>Not run</pre><div style={{height:2000}}>Offscreen test space</div></main>}
window.addEventListener('message',e=>{if(e.origin===location.origin&&e.data?.event){events.push(e.data);output()}});
createRoot(document.getElementById('root')).render(<App/>);
`;
const bundle=await build({stdin:{contents:entry,resolveDir:appRoot,loader:'tsx'},bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'local-provider-transport',setup(b){
 b.onResolve({filter:/^@mux\/mux-player-react$/},()=>({path:'mux-transport',namespace:'fixture'}));
 b.onResolve({filter:/lib\/youtubeIframeApi$/},()=>({path:'youtube-api',namespace:'youtube-fixture'}));
 b.onLoad({filter:/.*/,namespace:'youtube-fixture'},()=>({contents:`export async function loadYouTubeIframeApi(){return {Player:class {constructor(frame,{events}){this.frame=frame;this.events=events;this.ready=()=>{this.video=frame.contentDocument.querySelector('video');this.ended=()=>events.onStateChange({target:this,data:0});this.video.addEventListener('ended',this.ended);events.onReady({target:this});};if(frame.contentDocument?.querySelector('video'))this.ready();else frame.addEventListener('load',this.ready,{once:true});}mute(){if(this.video)this.video.muted=true}unMute(){if(this.video)this.video.muted=false}getPlayerState(){return this.video?.ended?0:1}destroy(){this.frame.removeEventListener('load',this.ready);this.video?.removeEventListener('ended',this.ended);this.frame.remove();}}}}`,loader:'js',resolveDir:appRoot}));
 b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`import React from 'react';import ActualMux from ${JSON.stringify(actualMux)};export default React.forwardRef(function LocalMux({playbackId,...props},ref){return <ActualMux {...props} ref={ref} src={playbackId.startsWith('stalled')?'/media/stalled.m3u8?source='+playbackId:'/media/mux.mp4?source='+playbackId} preferPlayback={playbackId.startsWith('stalled')?'mse':undefined} disableTracking disableCookies/>})`,loader:'tsx',resolveDir:appRoot}));
 b.onLoad({filter:/components\/LiveRipPreview\.tsx$/},async a=>({contents:(await readFile(a.path,'utf8')).replace('https://www.youtube.com/embed/','http://127.0.0.1:3189/youtube/'),loader:'tsx',resolveDir:appRoot+'components'}));
}}]});
const css=await require('postcss')([require('tailwindcss')({...require(appRoot+'tailwind.config.js'),content:[appRoot+'components/OnDemandMedia.tsx',appRoot+'components/LiveRipPreview.tsx',{raw:entry,extension:'tsx'}]})]).process('@tailwind base;@tailwind components;@tailwind utilities;', {from:undefined});
const requests=[];
const server=http.createServer((req,res)=>{
 const path=new URL(req.url,'http://127.0.0.1:3189').pathname;res.setHeader('Cache-Control','no-store');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:; frame-src 'self'; worker-src 'self' blob:");
 if(path==='/metrics'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(requests))}
 if(path==='/media/stalled.m3u8'){const record={path,closed:false};requests.push(record);res.on('close',()=>{record.closed=true});return}
 if(path.startsWith('/media/')){requests.push({path});res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':fixture.length,'Accept-Ranges':'bytes'});return res.end(fixture)}
 if(path==='/bundle.js'){res.setHeader('Content-Type','application/javascript');return res.end(bundle.outputFiles[0].contents)}
 if(path==='/style.css'){res.setHeader('Content-Type','text/css');return res.end(css.css)}
 if(path==='/poster.svg'){res.setHeader('Content-Type','image/svg+xml');return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#20304a"/></svg>')}
 if(path.startsWith('/youtube/')){res.setHeader('Content-Type','text/html');return res.end(`<video autoplay muted controls src="/media/youtube.mp4"></video><script>const v=document.querySelector('video');v.addEventListener('ended',()=>parent.postMessage({event:'onStateChange',info:0},location.origin));window.addEventListener('message',e=>{parent.postMessage({received:e.data},location.origin)});</script>`)}
 if(path!=='/'){res.writeHead(404);return res.end()}
 res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><title>Local provider lifecycle proof</title><body style="padding:20px;background:#101726;color:white"><div id="root"></div><script src="/bundle.js"></script></body>');
});
server.listen(3189,'127.0.0.1',()=>console.log('Provider fixture on http://127.0.0.1:3189/ — local media only'));
