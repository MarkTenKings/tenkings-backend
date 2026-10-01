import React,{useEffect,useId,useRef,useState}from'react';
import {filmSelector}from'../../atlas-report-view/src/approved-film-contract.mjs';
import {createFilmScene}from'./approved-report-tour.mjs';
import {createApprovedFilmRenderer}from'./approved-film-renderer.mjs';
import {loadApprovedFilmManifest,loadApprovedFilmPhotos,filmRecordingFormat,recordApprovedFilm}from'./approved-film-export.mjs';
const chapters=[['Centering',0,3.4],['Findings',5.6,7],['Original detail',8.7,10.7],['Fingerprint',12,13.4],['Grade',15,16.1]];
const clock=t=>`0:${String(Math.floor(t)).padStart(2,'0')}`;

export function ApprovedReportTour({reportUrl,label='Take a tour',expectedPublicHash=null,initialOpen=false}) {
 const [open,setOpen]=useState(initialOpen),[status,setStatus]=useState(''),[error,setError]=useState(''),[ready,setReady]=useState(false),[playing,setPlaying]=useState(false),[exporting,setExporting]=useState(false),[download,setDownload]=useState(null),[time,setTime]=useState(0);
 const [signature,setSignature]=useState(''),[cardName,setCardName]=useState('Your approved card'),[sharing,setSharing]=useState(false);
 const canvas=useRef(null),dialog=useRef(null),trigger=useRef(null),session=useRef(null),frame=useRef(null),playStart=useRef(0),position=useRef(0),exportController=useRef(null),nameRef=useRef(''),id=useId();
 const stop=()=>{cancelAnimationFrame(frame.current);frame.current=null;setPlaying(false);};
 const close=()=>{stop();exportController.current?.abort();dialog.current?.close();setOpen(false);setDownload(null);setExporting(false);trigger.current?.focus();};
 useEffect(()=>{if(!open)return;const controller=new AbortController();let disposed=false,renderer,photos;
  dialog.current?.showModal();setReady(false);setPlaying(false);setError('');setDownload(null);setTime(0);position.current=0;setStatus('Verifying the approved photographs…');
  (async()=>{try{const manifest=await loadApprovedFilmManifest(reportUrl,{signal:controller.signal});if(expectedPublicHash&&manifest.publicHash!==expectedPublicHash)throw Error('REPORT_CHANGED');
   photos=await loadApprovedFilmPhotos(manifest,{signal:controller.signal});const scene=createFilmScene(manifest);renderer=await createApprovedFilmRenderer(canvas.current,scene,photos,{signal:controller.signal,personalization:nameRef.current});
   if(disposed){renderer.dispose();Object.values(photos).forEach(image=>image.close());return;}session.current={manifest,renderer,photos};renderer.paint(0);setCardName(scene.name);setReady(true);setStatus('16 seconds · your saved grade and evidence');
   if(!matchMedia('(prefers-reduced-motion: reduce)').matches&&!document.hidden)startPlayback(0);
  }catch(e){if(!disposed&&e.name!=='AbortError'){setError('This tour could not be prepared. Your approved report remains available.');setStatus('');}}})();
  return()=>{disposed=true;controller.abort();exportController.current?.abort();cancelAnimationFrame(frame.current);renderer?.dispose();Object.values(photos??{}).forEach(image=>image.close());session.current=null;};
 },[open,reportUrl,expectedPublicHash]);
 useEffect(()=>()=>{if(download?.url)URL.revokeObjectURL(download.url);},[download]);
 useEffect(()=>{const reduce=matchMedia('(prefers-reduced-motion: reduce)'),hide=()=>{if(document.hidden)stop();},preference=()=>{if(reduce.matches)stop();};document.addEventListener('visibilitychange',hide);reduce.addEventListener('change',preference);return()=>{document.removeEventListener('visibilitychange',hide);reduce.removeEventListener('change',preference);};},[]);
 const startPlayback=start=>{if(!session.current)return;playStart.current=performance.now()-start*1000;setPlaying(true);
  const tick=now=>{const t=Math.min(16,(now-playStart.current)/1000);try{session.current.renderer.paint(t);position.current=t;setTime(t);if(t<16)frame.current=requestAnimationFrame(tick);else setPlaying(false);}catch{stop();setError('Graphics became unavailable. Open the report to inspect the saved evidence.');}};frame.current=requestAnimationFrame(tick);
 };
 const play=()=>{if(!session.current||exporting)return;if(playing)stop();else startPlayback(position.current>=16?0:position.current);};
 const seek=t=>{stop();position.current=t;setTime(t);try{session.current?.renderer.paint(t);}catch{setError('Graphics became unavailable. Open the report to inspect the saved evidence.');}};
 const personalize=value=>{setSignature(value);nameRef.current=value;setDownload(null);setStatus('Name updated. Create a film to save this version.');session.current?.renderer.setPersonalization(value);seek(position.current);};
 async function exportFilm(){if(!session.current||exporting)return;stop();setError('');setDownload(null);setExporting(true);setStatus('Preparing your download…');const controller=new AbortController();exportController.current=controller;let output,renderer;
  try{if(!filmRecordingFormat())throw Error('FILM_EXPORT_UNSUPPORTED');output=document.createElement('canvas');output.width=720;output.height=1280;const current=session.current;renderer=await createApprovedFilmRenderer(output,createFilmScene(current.manifest),current.photos,{signal:controller.signal,personalization:nameRef.current});
   const result=await recordApprovedFilm({canvas:output,renderer,manifest:current.manifest,signal:controller.signal,onProgress:p=>setStatus(`Creating your film · ${Math.round(p*100)}%`)});
   if(controller.signal.aborted)return;setDownload({...result,url:URL.createObjectURL(result.blob)});setStatus('Your film is ready. Save it or share the video.');
  }catch(e){if(e.name!=='AbortError')setError(e.message==='FILM_EXPORT_UNSUPPORTED'?'This browser cannot export video. The tour and report are still available.':e.message==='FILM_EXPORT_INTERRUPTED'?'Export stopped when this page moved to the background. Keep it open and try again.':'The film could not be completed. No download was created.');}
  finally{renderer?.dispose();if(output)output.width=output.height=1;if(!controller.signal.aborted){setExporting(false);exportController.current=null;}}
 }
 const file=download&&typeof File==='function'?new File([download.blob],download.filename,{type:download.mimeType}):null;
 const canShare=file&&typeof navigator!=='undefined'&&typeof navigator.share==='function'&&navigator.canShare?.({files:[file]});
 async function shareFilm(){if(!canShare||sharing)return;setSharing(true);setError('');try{await navigator.share({files:[file],title:`${cardName} · ATLAS`});}catch(e){if(e.name!=='AbortError')setError('Sharing was unavailable. Use Save film to keep the video.');}finally{setSharing(false);}}
 if(!filmSelector(reportUrl))return null;
 const chapter=chapters.findIndex(([, ,end])=>time<end);
 return <><button ref={trigger}type="button"className="aft-launch"onClick={()=>setOpen(true)}>{label}</button>{open&&<dialog ref={dialog}className="aft-dialog"aria-labelledby={id}onCancel={e=>{e.preventDefault();close();}}onClose={()=>{if(open)close();}}>
  <div className="aft-heading"><div><p>YOUR CARD. EVERY DETAIL.</p><h2 id={id}>The evidence, in motion.</h2></div><button type="button"onClick={close}aria-label="Close card tour">Close ×</button></div>
  <div className="aft-body"><div className="aft-stage"><canvas ref={canvas}width="540"height="960"aria-label={`Cinematic tour of ${cardName} and its original evidence`}/></div><div className="aft-controls">
   <div className="aft-playback"><button className="aft-play"type="button"disabled={!ready||exporting}onClick={play}>{playing?'Pause tour':time>=16?'Replay tour':'Play tour'}</button><span className="aft-time"aria-hidden="true">{clock(time)} <i>/ 0:16</i></span></div>
   <label className="aft-position"><span>Tour position</span><input aria-label="Tour position"aria-valuetext={`${clock(time)} of 0:16`}type="range"min="0"max="16"step=".1"value={time}disabled={!ready||exporting}onChange={e=>seek(Number(e.target.value))}/></label>
   <div className="aft-chapters"role="group"aria-label="Tour chapters">{chapters.map(([name,t],i)=><button type="button"disabled={!ready||exporting}key={name}aria-pressed={chapter===i}onClick={()=>seek(t)}><span aria-hidden="true">0{i+1}</span>{name}</button>)}</div>
   <p className="aft-status"role="status">{status}</p>{error&&<p role="alert">{error}</p>}
   <div className="aft-make"><p className="aft-section-label">MAKE IT YOURS</p><details className="aft-personalize"><summary>Add your first name <span>Optional +</span></summary><label htmlFor={`${id}-name`}>Made for<input id={`${id}-name`}type="text"maxLength="32"autoComplete="off"placeholder="Your first name"value={signature}disabled={!ready||exporting}onChange={e=>personalize(e.target.value)}/></label><p>Not saved to your report. Included in the video you save or share.</p></details>
    {exporting?<button className="aft-create"type="button"onClick={()=>{exportController.current?.abort();setExporting(false);setStatus('Export cancelled.');}}>Cancel export</button>:<button className="aft-create"type="button"disabled={!ready}onClick={exportFilm}>{download?'Create film again':'Create your card film'} <span aria-hidden="true">↗</span></button>}
    <p className="aft-note">16-second vertical video · no audio.<br/>Keep this page open while your film is created.</p>
    {download&&<div className="aft-save"><a className="aft-download"href={download.url}download={download.filename}>Save {download.mimeType.startsWith('video/mp4')?'MP4':'WebM'} film ↓</a>{canShare&&<button type="button"disabled={sharing}onClick={shareFilm}>{sharing?'Opening share…':'Share film ↗'}</button>}</div>}
   </div>
   <a className="aft-report-link"href={reportUrl}>Explore the complete report <span aria-hidden="true">↗</span></a>
   <p className="aft-provenance">Original photographs. Recorded traces. Awarded grade.<br/>The fingerprint is artwork from the saved evidence.</p>
  </div></div>
 </dialog>}</>;
}
export default ApprovedReportTour;
