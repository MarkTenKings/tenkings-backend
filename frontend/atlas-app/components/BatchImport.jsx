import React, { useEffect, useRef, useState } from 'react';
import { createBrowserIntakeJournal, createIntakeClient } from '@atlas/manual-intake/client';
import { createBatchImporter, createBrowserBatchImportJournal } from '../lib/batch-import.mjs';
import { manualRequest, manualMessage } from '../lib/manual-client.mjs';
import styles from './BatchGrading.module.css';
const copy={BATCH_IMPORT_COUNT:'Choose Front and Back photos for up to 100 cards at a time.',BATCH_IMPORT_PAIR_NAMES:'For bulk import, name each pair card-name_front.jpg and card-name_back.jpg. Use the two photo slots for any filenames.',BATCH_IMPORT_MISSING_SIDE:'Each bulk card needs a matching Front and Back file.',BATCH_IMPORT_DUPLICATE_SIDE:'Two files claim the same side. Give every physical card its own name.',BATCH_IMPORT_PENDING:'Resume the saved upload first.',BATCH_IMPORT_BUSY:'Batch intake is open in another tab. Use that tab or close it and reload this page.',BATCH_IMPORT_STORAGE:'The browser could not save these originals. Try a smaller batch.'};
const emptyPair=()=>({FRONT:null,BACK:null});
export default function BatchImport({staff,onImported,enabled}){
  const importer=useRef(null),notify=useRef(onImported),lifetime=useRef(null),selection=useRef(emptyPair()),staging=useRef(false),recovered=useRef(false);
  notify.current=onImported;
  const [batch,setBatch]=useState(null),[error,setError]=useState(''),[ready,setReady]=useState(false),[saving,setSaving]=useState(false),[resuming,setResuming]=useState(false);
  const [pair,setPair]=useState(emptyPair),[message,setMessage]=useState('');
  useEffect(()=>{
    const token={};lifetime.current=token;let stopped=false,batchJournal,intakeJournal,owner,release;
    setReady(false);setBatch(null);setError('');setSaving(false);setResuming(false);setMessage('');selection.current=emptyPair();setPair(selection.current);staging.current=false;recovered.current=false;
    const current=()=>!stopped&&lifetime.current===token;
    (async()=>{
      const session=await manualRequest('/api/staff/session');if(!current())return;
      if(session.staff?.id!==staff.id)throw {code:'MANUAL_STAFF_CHANGED'};
      if(!navigator.locks)throw {code:'BATCH_IMPORT_BUSY'};
      // One tab owns this journal while new pairs join its background runner.
      await navigator.locks.request(`atlas-batch-import:${staff.id}`,{ifAvailable:true},async lock=>{
        if(!current())return;if(!lock)throw {code:'BATCH_IMPORT_BUSY'};
        const held=new Promise(resolve=>{release=resolve;});
        const request=(path,options={})=>manualRequest(path,{...options,csrf:session.csrf});
        batchJournal=createBrowserBatchImportJournal({staffId:staff.id});intakeJournal=createBrowserIntakeJournal({staffId:staff.id});
        owner=createBatchImporter({request,intake:createIntakeClient({request,journal:intakeJournal}),journal:batchJournal,
          onProgress:value=>{if(current())setBatch(value);},onQueued:()=>{if(current())void Promise.resolve(notify.current?.()).catch(()=>{});}});
        importer.current=owner;const saved=await owner.read();if(!current())return;
        setBatch(saved);setReady(true);
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
  async function append(work,selected=null){
    if(staging.current||!ready||!enabled||staff.role!=='REVIEWER'||!importer.current)return;
    staging.current=true;setSaving(true);setError('');const token=lifetime.current,owner=importer.current;
    try{
      await work(owner);
      void owner.whenIdle().catch(failure=>{if(lifetime.current===token)setError(copy[failure.code]??manualMessage(failure));});
      if(lifetime.current!==token)return;
      if(selected&&selection.current===selected){selection.current=emptyPair();setPair(selection.current);}
      setMessage('Photos saved for upload. Add the next card; Astra starts automatically when both originals are ready.');
    }catch(failure){if(lifetime.current===token)setError(copy[failure.code]??manualMessage(failure));}
    finally{if(lifetime.current===token){staging.current=false;setSaving(false);}}
  }
  function choose(side,file){
    if(!file||staging.current||!ready||!enabled||staff.role!=='REVIEWER')return;
    const next={...selection.current,[side]:file};selection.current=next;setPair(next);setError('');
    if(next.FRONT&&next.BACK)void append(owner=>owner.appendPair(next.FRONT,next.BACK),next);
  }
  async function resume(){
    if(resuming||!ready||!enabled||staff.role!=='REVIEWER'||!importer.current)return;setResuming(true);setError('');const token=lifetime.current,owner=importer.current;
    try{await owner.whenIdle();await owner.run();await notify.current?.();}catch(failure){if(lifetime.current===token)setError(copy[failure.code]??manualMessage(failure));}
    finally{if(lifetime.current===token)setResuming(false);}
  }
  const done=batch?.items.filter(item=>item.done).length??0,total=batch?.items.length??0;
  const disabled=!ready||!enabled||saving||staff.role!=='REVIEWER',attention=batch?.items.some(item=>!item.done&&item.code);
  return <section className={styles.importer} aria-label="Automatic batch photo intake">
    <div className={styles.importHeading}><div><h2>Add photos. Keep moving.</h2><p>Front + Back automatically starts grading. The next card is ready as soon as its photos are saved here.</p></div></div>
    <div className={styles.pairIntake}>{['FRONT','BACK'].map(side=><label key={side} className={styles.pairDrop} data-selected={Boolean(pair[side])}
      onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();if(!disabled&&event.dataTransfer.files.length===1)choose(side,event.dataTransfer.files[0]);}}>
      <strong>{side==='FRONT'?'Front photo':'Back photo'}</strong><span>{pair[side]?.name??'Drop a photo or click to choose'}</span>
      <input aria-label={`Batch ${side==='FRONT'?'Front':'Back'} photo`} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" disabled={disabled}
        onChange={event=>{const file=event.target.files?.[0];event.target.value='';choose(side,file);}}/>
    </label>)}</div>
    {saving&&<p role="status">Saving originals on this device…</p>}{message&&<p role="status">{message}</p>}
    <div className={styles.bulkIntake}><div><strong>Already have a folder of photos?</strong><p>Choose up to 100 pairs at once: <code>card-01_front</code> + <code>card-01_back</code>. Uploading starts automatically.</p></div>
      <label className={styles.fileButton}>Choose bulk photos<input type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" disabled={disabled}
        onChange={event=>{const files=[...event.target.files];event.target.value='';if(files.length)void append(owner=>owner.append(files));}}/></label></div>
    {error&&<p className={styles.error} role="alert">{error}</p>}
    {batch&&<><div className={styles.intakeBar}><span aria-live="polite">{done} queued · {total-done} saved for upload</span>
      {attention&&<button type="button" disabled={resuming||!ready||!enabled||staff.role!=='REVIEWER'} onClick={()=>void resume()}>{resuming?'Checking saved uploads…':'Resume saved uploads'}</button>}</div>
      <div className={styles.pairRoster}>{batch.items.slice(-100).map(item=><div key={item.createId}><span>{item.done?'✓':item.code?'!':'·'}</span><strong>{item.label}</strong><small>{item.done?'Queued for Astra':item.code?'Upload needs attention':item.started?'Uploading originals…':'Saved for upload'}</small></div>)}</div></>}
  </section>;
}
