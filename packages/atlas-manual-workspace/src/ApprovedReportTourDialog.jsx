import React,{useEffect,useId,useRef,useState}from'react';
import {filmSelector}from'../../atlas-report-view/src/approved-film-contract.mjs';
import {createFilmScene}from'./approved-report-tour.mjs';
import {createApprovedFilmRenderer}from'./approved-film-renderer.mjs';
import {loadApprovedFilmManifest,loadApprovedFilmPhotos,filmRecordingFormat,recordApprovedFilm}from'./approved-film-export.mjs';

export function ApprovedReportTour({reportUrl,label='Take a tour',expectedPublicHash=null,initialOpen=false}) {
 const [open,setOpen]=useState(initialOpen),[status,setStatus]=useState(''),[error,setError]=useState(''),[ready,setReady]=useState(false),[playing,setPlaying]=useState(false),[exporting,setExporting]=useState(false),[download,setDownload]=useState(null),[time,setTime]=useState(0);
 const canvas=useRef(null),dialog=useRef(null),trigger=useRef(null),session=useRef(null),frame=useRef(null),playStart=useRef(0),position=useRef(0),exportController=useRef(null),id=useId();
 const stop=()=>{cancelAnimationFrame(frame.current);frame.current=null;setPlaying(false);};
 const close=()=>{stop();exportController.current?.abort();dialog.current?.close();setOpen(false);setDownload(null);setExporting(false);trigger.current?.focus();};
 useEffect(()=>{if(!open)return;const controller=new AbortController();let disposed=false,renderer,photos;
  dialog.current?.showModal();setReady(false);setError('');setDownload(null);setTime(0);position.current=0;setStatus('Verifying the approved photographs…');
  (async()=>{try{const manifest=await loadApprovedFilmManifest(reportUrl,{signal:controller.signal});if(expectedPublicHash&&manifest.publicHash!==expectedPublicHash)throw Error('REPORT_CHANGED');
   photos=await loadApprovedFilmPhotos(manifest,{signal:controller.signal});renderer=await createApprovedFilmRenderer(canvas.current,createFilmScene(manifest),photos,{signal:controller.signal});
   if(disposed){renderer.dispose();Object.values(photos).forEach(image=>image.close());return;}session.current={manifest,renderer,photos};renderer.paint(0);setReady(true);setStatus('16-second tour · original evidence');
  }catch(e){if(!disposed&&e.name!=='AbortError'){setError('This tour could not be prepared. Your approved report remains available.');setStatus('');}}})();
  return()=>{disposed=true;controller.abort();exportController.current?.abort();cancelAnimationFrame(frame.current);renderer?.dispose();Object.values(photos??{}).forEach(image=>image.close());session.current=null;};
 },[open,reportUrl,expectedPublicHash]);
 useEffect(()=>()=>{if(download?.url)URL.revokeObjectURL(download.url);},[download]);
 useEffect(()=>{const hide=()=>{if(document.hidden)stop();};document.addEventListener('visibilitychange',hide);return()=>document.removeEventListener('visibilitychange',hide);},[]);
 const play=()=>{if(!session.current||exporting)return;if(playing){stop();return;}const start=position.current>=16?0:position.current;playStart.current=performance.now()-start*1000;setPlaying(true);
  const tick=now=>{const t=Math.min(16,(now-playStart.current)/1000);try{session.current.renderer.paint(t);position.current=t;setTime(t);if(t<16)frame.current=requestAnimationFrame(tick);else setPlaying(false);}catch{stop();setError('Graphics became unavailable. Open the report to inspect the saved evidence.');}};frame.current=requestAnimationFrame(tick);
 };
 const seek=t=>{stop();position.current=t;setTime(t);session.current?.renderer.paint(t);};
 async function exportFilm(){if(!session.current||exporting)return;stop();setError('');setDownload(null);setExporting(true);setStatus('Preparing your download…');const controller=new AbortController();exportController.current=controller;let output,renderer;
  try{if(!filmRecordingFormat())throw Error('FILM_EXPORT_UNSUPPORTED');output=document.createElement('canvas');output.width=720;output.height=1280;const current=session.current;renderer=await createApprovedFilmRenderer(output,createFilmScene(current.manifest),current.photos,{signal:controller.signal});
   const result=await recordApprovedFilm({canvas:output,renderer,manifest:current.manifest,signal:controller.signal,onProgress:p=>setStatus(`Creating your film · ${Math.round(p*100)}%`)});
   if(controller.signal.aborted)return;setDownload({...result,url:URL.createObjectURL(result.blob)});setStatus('Your film is ready to save.');
  }catch(e){if(e.name!=='AbortError')setError(e.message==='FILM_EXPORT_UNSUPPORTED'?'This browser cannot export video. The tour and report are still available.':e.message==='FILM_EXPORT_INTERRUPTED'?'Export stopped when this page moved to the background. Keep it open and try again.':'The film could not be completed. No download was created.');}
  finally{renderer?.dispose();if(output)output.width=output.height=1;if(!controller.signal.aborted){setExporting(false);exportController.current=null;}}
 }
 if(!filmSelector(reportUrl))return null;
 return <><button ref={trigger}type="button"className="aft-launch"onClick={()=>setOpen(true)}>{label}</button>{open&&<dialog ref={dialog}className="aft-dialog"aria-labelledby={id}onCancel={e=>{e.preventDefault();close();}}onClose={()=>{if(open)close();}}>
  <div className="aft-heading"><div><p>YOUR APPROVED CARD</p><h2 id={id}>The evidence, in motion.</h2></div><button type="button"onClick={close}aria-label="Close card tour">Close ×</button></div>
  <div className="aft-body"><canvas ref={canvas}width="540"height="960"aria-label="Cinematic tour of the approved card and original evidence"/><div className="aft-controls">
   <p role="status">{status}</p>{error&&<p role="alert">{error}</p>}
   <button type="button"disabled={!ready||exporting}onClick={play}>{playing?'Pause tour':time>=16?'Replay tour':'Play tour'}</button>
   <label>Tour position<input type="range"min="0"max="16"step=".1"value={time}disabled={!ready||exporting}onChange={e=>seek(Number(e.target.value))}/></label>
   <div className="aft-chapters"aria-label="Tour chapters">{[['Centering',1],['Findings',5.6],['Original detail',8.7],['Fingerprint',12],['Grade',15]].map(([name,t])=><button type="button"disabled={!ready||exporting}key={name}onClick={()=>seek(t)}>{name}</button>)}</div>
   <p>Saved photographs, exact recorded traces and the awarded grade. The fingerprint is artwork from the evidence.</p>
   {exporting?<button type="button"onClick={()=>{exportController.current?.abort();setExporting(false);setStatus('Export cancelled.');}}>Cancel export</button>:<button type="button"disabled={!ready}onClick={exportFilm}>Create social film</button>}
   <p className="aft-note">Creates a 9:16 video on this device. Keep this page open during export.</p>
   {download&&<a className="aft-download"href={download.url}download={download.filename}>Download {download.mimeType.startsWith('video/mp4')?'MP4':'WebM'} film</a>}
   <a href={reportUrl}>Open complete approved report ↗</a>
  </div></div>
 </dialog>}</>;
}
export default ApprovedReportTour;
