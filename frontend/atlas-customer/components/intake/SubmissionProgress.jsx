export default function SubmissionProgress({ current = 1, intakeMethod='MAIL_IN' }) {
  if (current === 1) return null;
  const labels=intakeMethod==='DEALER_DROP_OFF'?['Your shop & name','Your cards','Review & pay']:['Your service', 'Your cards', 'Your details', 'Review & pay'];
  return <nav className="submission-progress" aria-label="Submission progress"><ol>{labels.map((label, index) => <li key={label} className={index + 1 === current ? 'current' : index + 1 < current ? 'complete' : ''} aria-current={index + 1 === current ? 'step' : undefined}><span>{index + 1 < current ? '✓' : `0${index + 1}`}</span><strong>{label}</strong></li>)}</ol><div className="submission-progress-track" aria-hidden="true"><i style={{ width: `${current / labels.length * 100}%` }}/></div></nav>;
}
