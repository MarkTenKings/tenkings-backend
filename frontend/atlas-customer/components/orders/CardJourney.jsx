import {cardJourney} from '../../lib/card-journey.mjs';
export default function CardJourney({card,compact=false}) {
  const journey=cardJourney(card);
  return <div className={`card-journey${compact?' compact':''}`}>
    <div className="journey-current"><span className={`journey-beacon${journey.complete?' complete':''}`} aria-hidden="true"/><div><span className="eyebrow">{journey.attention?'UPDATE FOR YOU':'YOUR CARD, RIGHT NOW'}</span><h3>{journey.label}</h3>{!compact&&<p>{journey.detail}</p>}</div></div>
    {journey.attention&&<p className="journey-attention" role="status">{journey.attention}</p>}
    <ol className="journey-track" aria-label="Recorded card progress">{journey.steps.map((step,index)=><li key={step.key} className={`${step.confirmed?'confirmed':''} ${journey.current===step.key?'current':''}`} aria-current={journey.current===step.key?'step':undefined}>
      <span className="journey-node" aria-hidden="true">{step.confirmed?'✓':String(index+1).padStart(2,'0')}</span><strong>{step.label}</strong><span className="journey-state">{step.confirmed?'Recorded':'Not yet recorded'}</span>
    </li>)}</ol>
  </div>;
}
