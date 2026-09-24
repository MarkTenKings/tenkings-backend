import React, {useEffect, useRef, useState} from 'react';
import ReportMarketPicker from './ReportMarketPicker';
import {createReportResearchClient} from '../lib/report-research-client.mjs';
import styles from './MarketReferencePicker.module.css';
const options={title:'Research the card and its sales.',searchLabel:'Research card',refreshLabel:'Run new research',
  note:'Compare the card photos, identity and variant using the shared research engine. A run may use up to 3 paid sales searches and compare up to 12 listing photos. Review each sale before publishing; original graders and grades remain visible.'};
const matchText=value=>value===true?'matches':value===false?'does not match':'not established';
function ResearchDetails({preview,client,disabled}){
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[submitted,setSubmitted]=useState(null);
  const generation=useRef(0),lock=useRef(false);
  useEffect(()=>{const version=++generation.current;setBusy(false);setMessage('');setError('');setSubmitted(null);lock.current=false;return()=>{if(generation.current===version)generation.current++;};},[client]);
  const research=preview?.state==='READY'?preview.research:null;
  let pending,invalid=false;try{pending=client?.pendingObservation();}catch{invalid=true;}
  async function contribute(){
    if(disabled||lock.current||!client)return;lock.current=true;const version=generation.current;setBusy(true);setError('');
    try{const result=pending?await client.reconcileObservation():await client.contribute(preview.previewId);
      if(version===generation.current){if(result.state==='RECORDED')setSubmitted(pending?.previewId??preview.previewId);setMessage(result.state==='SUPERSEDED'?'The saved observation belonged to a superseded report. Research the current report before submitting another.':'Observation received for authorized review. It is not yet published shared knowledge.');}
    }catch{if(version===generation.current)setError('The observation is not confirmed. Check the saved observation to recover its exact receipt.');}
    finally{if(version===generation.current){lock.current=false;setBusy(false);}}
  }
  if(!research&&!pending&&!invalid&&!message)return null;
  return <section className={styles.panel} aria-label="Shared card research evidence">
    <p className={styles.eyebrow}>RESEARCH · EVIDENCE</p>
    {research&&<><p>{research.identity?.reason??'Review identity and variant evidence before choosing references.'}</p>
      {research.photoIdentity?.reason&&<p>{research.photoIdentity.reason}</p>}
      <p className={styles.note}>Shared catalog: {String(research.catalog?.status??'unavailable').replaceAll('_',' ')}. {research.queries?.length??0} research queries recorded.</p>
      {research.warnings?.length>0&&<ul>{research.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul>}
      {research.candidates?.length>0&&<details><summary>Review sale matching evidence</summary><ul>{research.candidates.map(candidate=><li key={candidate.id}>
        <a href={candidate.listingUrl} target="_blank" rel="noopener noreferrer">{candidate.title}</a>
        <p>Identity: {matchText(candidate.identityMatch)}. Variant: {matchText(candidate.variantMatch)}. Photo: {matchText(candidate.visualMatch)}.</p>
        {candidate.conditionDecision?.reason&&<p className={styles.note}>Inventory condition comparison: {candidate.conditionDecision.reason}</p>}
      </li>)}</ul></details>}
    </>}
    {(pending||research?.knowledge?.canContribute&&submitted!==preview.previewId)&&<><p className={styles.note}>Submit this saved observation to the shared catalog for human review. Private card photos are not included.</p>
      <button type="button" disabled={disabled||busy} onClick={()=>void contribute()}>{busy?'Checking observation…':pending?'Check saved observation':'Submit observation for review'}</button></>}
    {invalid&&<p role="alert">The saved observation reference cannot be read. An administrator needs to recover it before submitting another.</p>}
    {message&&<p role="status">{message}</p>}{error&&<p role="alert" className={styles.error}>{error}</p>}
  </section>;
}
export default function ReportResearchPicker(props){
  return <ReportMarketPicker {...props} createClient={createReportResearchClient} pickerOptions={options}
    renderDetails={(preview,client)=><ResearchDetails key={`${props.staffId}:${props.cardId}:${props.approvalActionId}`} preview={preview} client={client} disabled={props.disabled}/>}/>;
}
