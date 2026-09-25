import React, { useEffect, useRef, useState } from 'react';
import { createBrowserIntakeJournal, createIntakeClient } from '@atlas/manual-intake/client';
import RapidCardCamera from '../../atlas-shared/RapidCardCamera.jsx';
import { batchImportDiagnostics, batchImportFailureDetails, createBatchImporter, createBrowserBatchImportJournal, previewOrderedBatchPhotos } from '../lib/batch-import.mjs';
import { manualRequest, manualMessage } from '../lib/manual-client.mjs';
import styles from './BatchGrading.module.css';
const copy={BATCH_IMPORT_COUNT:'Choose Front and Back photos for up to 100 cards at a time.',BATCH_IMPORT_PAIR_NAMES:'For bulk import, name each pair card-name_front.jpg and card-name_back.jpg. Use the two photo slots for any filenames.',BATCH_IMPORT_MISSING_SIDE:'Each bulk card needs a matching Front and Back file.',BATCH_IMPORT_DUPLICATE_SIDE:'Two files claim the same side. Give every physical card its own name.',BATCH_IMPORT_PENDING:'Resume the saved upload first.',BATCH_IMPORT_BUSY:'Batch intake is open in another tab. Use that tab or close it and reload this page.',BATCH_IMPORT_STORAGE:'This browser could not finish saving the photo. Keep this tab and its saved uploads, then resume.',PHOTO_STORAGE_QUOTA:'This device reported full storage. Free device space without clearing this site’s saved data, then resume.',PHOTO_BYTES_UNREADABLE:'This browser could not read a saved original. Keep the saved uploads here and try Resume saved uploads.',PHOTO_BYTES_INVALID:'The original photo bytes could not be verified. Your saved record is kept.',PHOTO_STORAGE_CORRUPT:'This browser could not verify a saved photo record. Keep your saved uploads here.',BATCH_IMPORT_SIDE_SAVED:'This side is already saved. Capture the other side of the same card.',BATCH_IMPORT_PAIR_FILES:'Choose an original photo under 64 MiB.',BATCH_IMPORT_ORDER_COUNT:'Choose an even number of photos, up to 100 Front/Back pairs. Review their order before adding them.'};
const emptyPair=()=>({FRONT:null,BACK:null});
const uploadMessage=item=>copy[item.code]??({BATCH_IMPORT_INTERRUPTED:'This saved photo could not continue. Resume saved uploads to retry the same card.',INTAKE_JOURNAL_UNAVAILABLE:'This browser could not open its saved upload records. Keep your photos here and resume the saved uploads.',BATCH_IMPORT_CREATE_UNCERTAIN:'The card creation reply was interrupted. Resume saved uploads to recover the same card.'})[item.code]??manualMessage({code:item.code});
export function batchUploadPresentation(item,jobs=[]){
  if(!item.done)return {label:item.code?uploadMessage(item):item.started?'Uploading originals…':'Saved for upload',attention:Boolean(item.code)};
  const job=jobs.find(value=>value.cardId===item.cardId&&value.state!=='SUPERSEDED')??jobs.find(value=>value.cardId===item.cardId);
  if(!job)return {label:'Uploaded to ATLAS · Checking grading status',attention:false};
  if(job.state==='NEEDS_ATTENTION')return {label:({BATCH_GEOMETRY_NEEDS_REVIEW:'Check edges before grading',BATCH_IDENTITY_NEEDS_REVIEW:'Check card details before grading',BATCH_HUMAN_WORK_PRESENT:'Continue your review'})[job.code]??'Needs attention · Open card',attention:true};
  return {label:job.state==='RUNNING'?({PREPARE:'ATLAS preparing',ANALYZE:'ATLAS grading',REPORT:'ATLAS preparing report'})[job.stage]??'ATLAS processing':({QUEUED:'Queued up for ATLAS',REVIEW:'Ready for human review',APPROVED:'Approved',SUPERSEDED:'Photos changed · Review card'})[job.state]??'Uploaded to ATLAS',attention:false};
}
export default function BatchImport({staff,onImported,enabled,jobs=[],onOpenCard}){
  const importer=useRef(null),notify=useRef(onImported),lifetime=useRef(null),selection=useRef(emptyPair()),staging=useRef(false),recovered=useRef(false);
  notify.current=onImported;
  const [batch,setBatch]=useState(null),[error,setError]=useState(''),[ready,setReady]=useState(false),[saving,setSaving]=useState(false),[resuming,setResuming]=useState(false);
  const [pair,setPair]=useState(emptyPair),[message,setMessage]=useState(''),[camera,setCamera]=useState(false),[ordered,setOrdered]=useState(null);
  const refreshSession=useRef(null);
  useEffect(()=>{
    const token={};lifetime.current=token;let stopped=false,batchJournal,intakeJournal,owner,release;
    setReady(false);setBatch(null);setError('');setSaving(false);setResuming(false);setMessage('');selection.current=emptyPair();setPair(selection.current);staging.current=false;recovered.current=false;
    const current=()=>!stopped&&lifetime.current===token;
    (async()=>{
      // Local admission is bound to the authenticated page's staff ID. A slow
      // session refresh belongs to the network worker, never the shutter.
      let sessionPromise=null;refreshSession.current=()=>{sessionPromise=null;};
      const session=()=>sessionPromise??(sessionPromise=manualRequest('/api/staff/session').then(value=>{
        if(value.staff?.id!==staff.id)throw {code:'MANUAL_STAFF_CHANGED',status:403};return value;
      }).catch(error=>{sessionPromise=null;throw error;}));
      if(!navigator.locks)throw {code:'BATCH_IMPORT_BUSY'};
      // One tab owns this journal while new pairs join its background runner.
      await navigator.locks.request(`atlas-batch-import:${staff.id}`,{ifAvailable:true},async lock=>{
        if(!current())return;if(!lock)throw {code:'BATCH_IMPORT_BUSY'};
        const held=new Promise(resolve=>{release=resolve;});
        const request=async(path,options={})=>{const access=await session();return manualRequest(path,{...options,csrf:access.csrf});};
        batchJournal=createBrowserBatchImportJournal({staffId:staff.id});intakeJournal=createBrowserIntakeJournal({staffId:staff.id});
        owner=createBatchImporter({request,intake:createIntakeClient({request,journal:intakeJournal}),journal:batchJournal,
          onProgress:value=>{if(current()){setBatch(value);selection.current={...emptyPair(),...value?.draft?.files};setPair(selection.current);}},onQueued:()=>{if(current())void Promise.resolve(notify.current?.()).catch(()=>{});}});
        importer.current=owner;const saved=await owner.read();if(!current())return;
        setBatch(saved);selection.current={...emptyPair(),...saved?.draft?.files};setPair(selection.current);setReady(true);
        await held;
      });
    })().catch(failure=>{if(current())setError(copy[failure.code]??manualMessage(failure));});
    return()=>{stopped=true;if(lifetime.current===token)lifetime.current=null;if(importer.current===owner)importer.current=null;
      void Promise.resolve(owner?.dispose()).then(()=>Promise.all([batchJournal?.close(),intakeJournal?.close()])).catch(()=>{}).finally(()=>release?.());};
  },[staff.id]);
  useEffect(()=>{
    if(!ready||!enabled||staff.role!=='REVIEWER'||recovered.current||!importer.current)return;
    recovered.current=true;const token=lifetime.current,owner=importer.current;
    void owner.read().then(saved=>{if(lifetime.current===token&&saved?.items.some(item=>!item.done))return owner.run();})
      .catch(failure=>{if(lifetime.current===token)setError(copy[failure.code]??manualMessage(failure));});
  },[ready,enabled,staff.role]);
  async function append(work){
    if(staging.current||!ready||!enabled||staff.role!=='REVIEWER'||!importer.current)return;
    staging.current=true;setSaving(true);setError('');const token=lifetime.current,owner=importer.current;
    try{
      await work(owner);
      void owner.whenIdle().catch(failure=>{if(lifetime.current===token)setError(copy[failure.code]??manualMessage(failure));});
      if(lifetime.current!==token)return;
      setMessage('Photos saved for upload. Add the next card. ATLAS prepares verified pairs automatically; the grading queue shows progress and any review needed.');
    }catch(failure){if(lifetime.current===token)setError(copy[failure.code]??manualMessage(failure));}
    finally{if(lifetime.current===token){staging.current=false;setSaving(false);}}
  }
  async function choose(side,file,acquisition=null){
    if(!file||staging.current||!ready||!enabled||staff.role!=='REVIEWER'||!importer.current)throw new Error('Wait for this device to finish saving your previous photo.');
    staging.current=true;setSaving(true);setError('');const token=lifetime.current,owner=importer.current;
    try{
      const value=await owner.saveSide(side,file,acquisition);
      if(lifetime.current!==token)return;
      selection.current={...emptyPair(),...value.draft?.files};setPair(selection.current);setBatch(value);
      setMessage(value.draft?'Photo saved on this device. Add the other side of the same card.':'Pair saved. You can capture the next card now.');
      void owner.whenIdle().catch(failure=>{if(lifetime.current===token)setError(copy[failure.code]??manualMessage(failure));});
    }catch(failure){if(lifetime.current===token)setError(copy[failure.code]??manualMessage(failure));throw new Error(copy[failure.code]??manualMessage(failure));}
    finally{if(lifetime.current===token){staging.current=false;setSaving(false);}}
  }
  function reviewOrder(files){try{previewOrderedBatchPhotos(files);setOrdered(files);setError('');}catch(failure){setError(copy[failure.code]??manualMessage(failure));}}
  function movePhoto(index,offset){setOrdered(files=>{const next=[...files],target=index+offset;if(target<0||target>=next.length)return files;[next[index],next[target]]=[next[target],next[index]];return next;});}
  useEffect(()=>{const reconnect=()=>{if(ready&&enabled&&staff.role==='REVIEWER'){refreshSession.current?.();void importer.current?.run().catch(failure=>setError(copy[failure.code]??manualMessage(failure)));}};window.addEventListener('online',reconnect);return()=>window.removeEventListener('online',reconnect);},[ready,enabled,staff.role]);
  async function resume(){
    if(resuming||!ready||!enabled||staff.role!=='REVIEWER'||!importer.current)return;setResuming(true);setError('');const token=lifetime.current,owner=importer.current;
    try{refreshSession.current?.();await owner.whenIdle();await owner.run();await notify.current?.();}catch(failure){if(lifetime.current===token)setError(copy[failure.code]??manualMessage(failure));}
    finally{if(lifetime.current===token)setResuming(false);}
  }
  async function downloadDiagnostics(){
    try{
      const saved=await importer.current?.read();if(!saved)return;
      const url=URL.createObjectURL(new Blob([JSON.stringify(batchImportDiagnostics(saved),null,2)+'\n'],{type:'application/json'}));
      const link=document.createElement('a');link.href=url;link.download='atlas-upload-diagnostics.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(failure){setError(copy[failure.code]??manualMessage(failure));}
  }
  const done=batch?.items.filter(item=>item.done).length??0,total=batch?.items.length??0;
  const disabled=!ready||!enabled||saving||staff.role!=='REVIEWER',attention=batch?.items.some(item=>!item.done&&item.code);
  return <section className={styles.importer} aria-label="Automatic batch photo intake">
    <div className={styles.importHeading}><div><p className={styles.captureEyebrow}>CAPTURE. FLIP. NEXT.</p><h2>Your cards. On repeat.</h2><p>Front, back, next card. Uploading and identification keep working while you capture.</p></div></div>
    <div className={styles.rapidLaunch}><div className={styles.captureIcon} aria-hidden="true"><span>＋</span></div><div><h3>Rapid capture</h3><p>One camera. Every card. No filenames to change.</p><small>Both sides save on this device before the next card opens.</small></div><button type="button" className={styles.primary} disabled={disabled} onClick={()=>{void navigator.storage?.persist?.().catch(()=>{});setCamera(true);}}>Open camera <span aria-hidden="true">↗</span></button></div>
    {camera&&<RapidCardCamera completedPairs={total} side={pair.FRONT?'BACK':'FRONT'} cardLabel={`Card ${total+1}`} disabled={disabled} onClose={()=>setCamera(false)} onCapture={(file,acquisition)=>choose(pair.FRONT?'BACK':'FRONT',file,acquisition)} status={`${total-done} pairs saved for upload · ${done} uploaded to ATLAS`}/>}
    <p className={styles.libraryHeading}>Or add original photos from your library</p>
    <div className={styles.pairIntake}>{['FRONT','BACK'].map(side=><label key={side} className={styles.pairDrop} data-selected={Boolean(pair[side])}
      onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();if(!disabled&&event.dataTransfer.files.length===1)void choose(side,event.dataTransfer.files[0]).catch(()=>{});}}>
      <strong>{side==='FRONT'?'Front photo':'Back photo'}</strong><span>{pair[side]?.name??'Drop a photo or click to choose'}</span>
      <input aria-label={`Batch ${side==='FRONT'?'Front':'Back'} photo`} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" disabled={disabled||Boolean(pair[side])}
        onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void choose(side,file).catch(()=>{});}}/>
    </label>)}</div>
    {saving&&<p role="status">Saving originals on this device…</p>}{message&&<p role="status">{message}</p>}
    <div className={styles.bulkIntake}><div><strong>Already have several cards photographed?</strong><p>Choose your photos, then review Front / Back pairs. Any filenames work.</p></div>
      <label className={styles.fileButton}>Choose multiple photos<input aria-label="Choose ordered bulk photos" type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" disabled={disabled}
        onChange={event=>{const files=[...event.target.files];event.target.value='';if(files.length)reviewOrder(files);}}/></label></div>
    {ordered&&<section className={styles.orderReview} aria-label="Review photo pair order"><h3>Match each Front with its Back</h3><p>Photos can arrive from your library in a different order. Move them until every row shows one physical card, then confirm.</p>
      {previewOrderedBatchPhotos(ordered).map((item,index)=><div className={styles.orderPair} key={index}><strong>Card {index+1}</strong>{['FRONT','BACK'].map((side,sideIndex)=>{const position=index*2+sideIndex;return <div key={side}><PhotoThumbnail file={item.files[side]}/><b>{side}</b><span>{item.files[side].name}</span><div><button type="button" disabled={saving||position===0} onClick={()=>movePhoto(position,-1)} aria-label={`Move photo ${position+1} earlier`}>← Earlier</button><button type="button" disabled={saving||position===ordered.length-1} onClick={()=>movePhoto(position,1)} aria-label={`Move photo ${position+1} later`}>Later →</button></div></div>;})}</div>)}
      <div className={styles.orderActions}><button type="button" disabled={disabled} className={styles.primary} onClick={()=>void append(async owner=>{await owner.appendReviewedPairs(previewOrderedBatchPhotos(ordered));setOrdered(null);})}>Confirm {ordered.length/2} card pairs</button><button type="button" disabled={saving} onClick={()=>setOrdered(null)}>Cancel selection</button></div></section>}
    <details className={styles.namedImport}><summary>Have files already named Front and Back?</summary><p>Optional: match <code>card-01_front</code> with <code>card-01_back</code> automatically, up to 100 cards.</p><label className={styles.fileButton}>Choose named pairs<input aria-label="Choose named bulk photos" type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" disabled={disabled} onChange={event=>{const files=[...event.target.files];event.target.value='';if(files.length)void append(owner=>owner.append(files));}}/></label></details>
    {error&&<p className={styles.error} role="alert">{error}</p>}
    {batch&&<><div className={styles.intakeBar}><span aria-live="polite">{done} uploaded to ATLAS · {total-done} saved for upload</span>
      {attention&&<button type="button" disabled={resuming||!ready||!enabled||staff.role!=='REVIEWER'} onClick={()=>void resume()}>{resuming?'Checking saved uploads…':'Resume saved uploads'}</button>}</div>
      <div className={styles.pairRoster}>{batch.items.slice(-100).map(item=>{const failure=batchImportFailureDetails(item),progress=batchUploadPresentation(item,jobs);return <div key={item.createId}><span>{progress.attention?'!':item.done?'✓':'·'}</span><strong>{item.label}</strong><small className={failure||progress.attention?styles.pairFailure:undefined}>{progress.label}{failure&&<code>{failure.code}{failure.phase!=='UNKNOWN'?` · ${failure.phase}`:''}{failure.exceptionName!=='Error'?` · ${failure.exceptionName}`:''}</code>}</small>{item.done&&item.cardId&&onOpenCard&&<button type="button" className={styles.pairOpen} onClick={()=>onOpenCard(item.cardId)}>{progress.attention?'Review card':'View card'} ↗</button>}</div>;})}</div>
      <details className={styles.uploadDiagnostics}><summary>Upload diagnostics</summary><p>Download saved progress and error details for troubleshooting. No photos, filenames, or sign-in credentials are included.</p><button type="button" disabled={!ready} onClick={()=>void downloadDiagnostics()}>Download upload diagnostics</button></details></>}
  </section>;
}

function PhotoThumbnail({file}){
  const [url,setUrl]=useState(null),[failed,setFailed]=useState(false);
  useEffect(()=>{const next=URL.createObjectURL(file);setUrl(next);setFailed(false);return()=>URL.revokeObjectURL(next);},[file]);
  return url&&!failed?<img src={url} alt="Selected card photo" onError={()=>setFailed(true)}/>:<span className={styles.thumbnailFallback}>Preview unavailable{url&&<a href={url} target="_blank" rel="noreferrer">Open original to verify</a>}</span>;
}
