export default function SubmissionProgress({ current = 1 }) {
  if (current === 1) return null;
  return <nav className="submission-progress" aria-label="Submission progress"><ol>{['Your service', 'Your cards', 'Your details', 'Review & pay'].map((label, index) => <li key={label} className={index + 1 === current ? 'current' : index + 1 < current ? 'complete' : ''} aria-current={index + 1 === current ? 'step' : undefined}><span>{index + 1 < current ? '✓' : `0${index + 1}`}</span><strong>{label}</strong></li>)}</ol><div className="submission-progress-track" aria-hidden="true"><i style={{ width: `${current * 25}%` }}/></div></nav>;
}
