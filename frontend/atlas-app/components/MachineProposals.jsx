import {useState} from 'react';
export default function MachineProposals({proposals=[],disabled,onDecide}) {
    const [notes,setNotes]=useState({});
    if (!proposals.length) return null;
    return <section className="machine-proposals"><div className="panel-heading"><div><h2>Astra proposals</h2>
        <p>Inspect the evidence and save any grading correction, then record your decision. Each decision belongs to the current analysis.</p></div>
        <span className="quiet-label">{proposals.filter(p=>!p.decision).length} TO REVIEW</span></div>
        {proposals.map(p=><article key={p.stepId} className="proposal"><strong>{p.toolName==='propose_identity'?'Card identity':p.proposal.action.replaceAll('_',' ').toLowerCase()}</strong>
            <p>{p.proposal.summary}</p>{p.proposal.findingId&&<p className="mono">Finding {p.proposal.findingId}</p>}
            {p.proposal.defectType&&<p>Proposed type: {p.proposal.defectType.replaceAll('_',' ').toLowerCase()}</p>}
            {p.proposal.fields&&<ul>{p.proposal.fields.map(f=><li key={f.field}>{f.field}: {f.value??'Unknown'}</li>)}</ul>}
            {p.proposal.alternativeExplanation&&<p>Alternative explanation: {p.proposal.alternativeExplanation}</p>}
            <details><summary>Evidence references</summary><ul>{(p.proposal.evidence??p.proposal.fields?.flatMap(f=>f.evidence)??[]).map((e,index)=><li key={index}>{e.side.toLowerCase()} · source SHA-256 {e.sha256.slice(0,16)}…</li>)}</ul>
              {p.proposal.rect&&<p>Source pixels: x {p.proposal.rect.x}, y {p.proposal.rect.y}, width {p.proposal.rect.width}, height {p.proposal.rect.height}.</p>}</details>
            {p.decision?<p role="status"><strong>{p.decision.toLowerCase()}</strong> · {p.reason}</p>:<fieldset disabled={disabled}>
                <label htmlFor={`proposal-${p.stepId}`}>Your reason</label><textarea id={`proposal-${p.stepId}`} rows={2} maxLength={1000} value={notes[p.stepId]??''} onChange={e=>setNotes(n=>({...n,[p.stepId]:e.target.value}))}/>
                <div className="proposal-actions"><button type="button" disabled={!notes[p.stepId]?.trim()} onClick={()=>onDecide(p,p.proposal.action==='INSPECT_MISSED_REGION'?'INSPECTED':'ACCEPTED',notes[p.stepId])}>{p.proposal.action==='INSPECT_MISSED_REGION'?'Region inspected':'Accept saved result'}</button>
                <button type="button" disabled={!notes[p.stepId]?.trim()} onClick={()=>onDecide(p,'REJECTED',notes[p.stepId])}>Reject proposal</button></div>
            </fieldset>}
        </article>)}
    </section>;
}
