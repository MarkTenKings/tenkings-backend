import React from 'react';
import ReportMarketPicker from './ReportMarketPicker';
import {createReportResearchClient} from '../lib/report-research-client.mjs';
import styles from './MarketReferencePicker.module.css';
const options={title:'Research the card and its sales.',searchLabel:'Research card',refreshLabel:'Run new research',
  note:'Compare the card photos, identity and variant using the research engine. A run may use up to 3 paid sales searches and compare up to 12 listing photos. Review each sale before publishing; original graders and grades remain visible.'};
const matchText=value=>value===true?'matches':value===false?'does not match':'not established';
function ResearchDetails({preview}){
  const research=preview?.state==='READY'?preview.research:null;
  if(!research)return null;
  return <section className={styles.panel} aria-label="Card research evidence">
    <p className={styles.eyebrow}>RESEARCH · EVIDENCE</p>
    {research&&<><p>{research.identity?.reason??'Review identity and variant evidence before choosing references.'}</p>
      {research.photoIdentity?.reason&&<p>{research.photoIdentity.reason}</p>}
      <p className={styles.note}>{research.queries?.length??0} research queries recorded.</p>
      {research.warnings?.length>0&&<ul>{research.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul>}
      {research.candidates?.length>0&&<details><summary>Review sale matching evidence</summary><ul>{research.candidates.map(candidate=><li key={candidate.id}>
        <a href={candidate.listingUrl} target="_blank" rel="noopener noreferrer">{candidate.title}</a>
        <p>Identity: {matchText(candidate.identityMatch)}. Variant: {matchText(candidate.variantMatch)}. Photo: {matchText(candidate.visualMatch)}.</p>
        {candidate.conditionDecision?.reason&&<p className={styles.note}>Inventory condition comparison: {candidate.conditionDecision.reason}</p>}
      </li>)}</ul></details>}
    </>}
  </section>;
}
export default function ReportResearchPicker(props){
  return <ReportMarketPicker {...props} automatic={false} createClient={createReportResearchClient} pickerOptions={options}
    renderDetails={preview=><ResearchDetails key={`${props.staffId}:${props.cardId}:${props.approvalActionId}`} preview={preview}/>}/>;
}
