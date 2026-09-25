import { useEffect, useId, useRef, useState } from 'react';
import SubmissionStationFinder from './SubmissionStationFinder.jsx';

function ServiceFilm({ kind, label, motionPaused }) {
  const video = useRef(null), [playing, setPlaying] = useState(false), [available, setAvailable] = useState(false), [filmPaused, setFilmPaused] = useState(false);
  useEffect(() => {
    const element = video.current; let active = true;
    if (!element) return;
    if (motionPaused || filmPaused || !available) element.pause();
    else element.play().catch(() => { if (active) setPlaying(false); });
    return () => { active = false; element.pause(); };
  }, [motionPaused, filmPaused, available]);
  return <div className={`service-film service-film-${kind}`}><video ref={video} muted loop playsInline preload="metadata" poster={`/account/atlas/submission-${kind}.jpg`} onCanPlay={() => setAvailable(true)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} aria-label={label}><source src={`/account/atlas/submission-${kind}.mp4`} type="video/mp4"/></video>{available && <button type="button" className="film-control" disabled={motionPaused} aria-label={motionPaused ? `${label} paused with motion` : playing ? `Pause ${label}` : `Play ${label}`} onClick={event => { event.stopPropagation(); setFilmPaused(playing); if (playing) video.current.pause(); else video.current.play().catch(() => setPlaying(false)); }}>{playing ? 'Ⅱ' : '▶'}</button>}</div>;
}
function SpeedMark({ kind }) {
  const artId = useId();
  return <svg className={`service-speed-art speed-art-${kind}`} viewBox="0 0 600 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id={`${artId}-gold`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#fff5c9"/><stop offset=".4" stopColor="#f2c668"/><stop offset=".65" stopColor="#ba8536"/><stop offset="1" stopColor="#ffe5a0"/></linearGradient>
      <linearGradient id={`${artId}-wind`}><stop stopColor="#d8f2ff" stopOpacity="0"/><stop offset=".28" stopColor="#b8d5e2" stopOpacity=".3"/><stop offset=".65" stopColor="#e8f8ff"/><stop offset="1" stopColor="#c4e4f2" stopOpacity="0"/></linearGradient>
    </defs>
    {kind === 'kiosk' ? <>
      <g className="speed-bolt bolt-main"><path fill={`url(#${artId}-gold)`} d="M449 -27 332 65 396 61 313 163 526 44 443 48 537 -27Z"/><path className="bolt-facet" d="M449 -27 332 65 416 47 313 163 441 57 443 48 537 -27"/></g>
      <g className="lightning-arc arc-one"><path pathLength="1" d="M403 52 377 45 365 48 349 37 340 40 319 23 300 29 288 22 273 24 252 12 239 20 221 17 204 30 182 23 173 28 157 12 144 19 119 14 102 26 92 23 77 34 59 28 43 36 27 29 -20 44"/><path className="lightning-branch" pathLength="1" d="M319 23 311 10 317 4 307 -9M252 12 249 38 234 44 238 52 216 60 204 55 182 77M157 12 150 36 136 43 143 51 129 68 111 72M239 20 229 1 215 -3"/></g>
      <g className="lightning-arc arc-two"><path pathLength="1" d="M421 62 442 69 449 64 463 80 477 76 486 92 506 89 519 107 536 103 543 115 561 109 576 122 590 116 605 131 627 124"/><path className="lightning-branch" pathLength="1" d="M486 92 481 107 490 113 487 128 500 133 495 154M536 103 548 81 542 75 560 62 558 50M449 64 456 47 450 38 461 24"/></g>
      <g className="lightning-arc arc-three"><path pathLength="1" d="M391 89 366 99 350 92 338 108 326 106 309 121 292 112 280 116 263 105 249 120 236 116 218 132 197 125 183 138 171 133 157 145 135 138 124 152 102 144 80 161"/><path className="lightning-branch" pathLength="1" d="M350 92 335 77 321 81 309 67 295 70 284 57M263 105 257 135 244 142 249 156M197 125 188 105 176 111 160 95 149 97 137 84M124 152 112 130 102 135 91 119"/></g>
    </> : <>
      <g className="wind-current wind-one" stroke={`url(#${artId}-wind)`}><path className="wind-soft" d="M-100 56C38 3 127 115 274 57S449 13 506 48 608 91 712 35"/><path d="M-100 50C41 -5 132 109 278 52S449 9 510 43 609 88 712 29"/><path d="M-95 63C50 12 129 120 278 63S451 21 508 55 610 99 717 42"/></g>
      <g className="wind-current wind-two" stroke={`url(#${artId}-wind)`}><path className="wind-soft" d="M-110 126C27 68 121 163 298 112S426 23 392 45 407 104 484 97 592 36 710 61"/><path d="M-110 120C25 63 124 157 296 105S424 19 389 40 404 100 481 91 591 30 709 55"/><path d="M-105 133C35 80 125 170 303 118S435 30 401 51 413 111 490 104 598 43 714 67"/></g>
      <g className="wind-current wind-three" stroke={`url(#${artId}-wind)`}><path d="M-80 18C98 71 187 -19 342 17S443 77 477 68 493 31 466 36 436 93 511 128 625 122 704 98"/><path d="M-75 24C99 79 190 -10 341 25S439 85 478 77 505 23 465 28 424 101 511 135 627 129 709 105"/></g>
    </>}
  </svg>;
}
function ServiceJourney({ kind }) {
  const steps = kind === 'kiosk' ? ['Drop off at dealer', 'ATLAS collects & grades', 'Back at your dealer'] : ['Send via FedEx', 'ATLAS grades', 'Return shipment'];
  return <div className={`service-timeline service-timeline-${kind}`}>
    <div className="service-timeline-track">
      <i className="service-timeline-fill" aria-hidden="true"/>
      <div className="service-timeline-heading" aria-hidden="true"><strong>{kind === 'kiosk' ? '7' : '14'} days</strong><div className="timeline-delivery"><span className="finish-caption">SERVICE SPEED</span><span className="finish-stamp"><svg viewBox="0 0 36 36" focusable="false"><path d="m7 18 7 7L30 9"/></svg><strong>Delivered</strong></span></div></div>
      <ol className="service-journey" aria-label={kind === 'kiosk' ? 'Kiosk service journey' : 'Mail-in service journey'}>{steps.map((step, index) => <li key={step}><span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><strong>{step}</strong></li>)}</ol>
    </div>
  </div>;
}
export default function ServiceChoice({ value, onChange }) {
  const [paused, setPaused] = useState(false), [reducedMotion, setReducedMotion] = useState(true), [hidden, setHidden] = useState(false);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotion = () => setReducedMotion(preference.matches), updateVisibility = () => setHidden(document.hidden);
    updateMotion(); updateVisibility(); preference.addEventListener('change', updateMotion); document.addEventListener('visibilitychange', updateVisibility);
    return () => { preference.removeEventListener('change', updateMotion); document.removeEventListener('visibilitychange', updateVisibility); };
  }, []);
  const motionPaused = paused || reducedMotion || hidden;
  return <section className="service-choice" data-motion={motionPaused ? 'paused' : 'running'} data-reduced-motion={reducedMotion ? 'true' : 'false'}><div className="section-heading service-comparison-heading"><h1 className="service-choice-title"><span>Two Speeds.</span>{' '}<span>Same Finish.</span></h1><button type="button" className="service-motion-toggle" disabled={reducedMotion} aria-label={reducedMotion ? 'Reduced motion enabled' : paused ? 'Play motion' : 'Pause motion'} title={reducedMotion ? 'Reduced motion enabled' : paused ? 'Play motion' : 'Pause motion'} aria-pressed={motionPaused} onClick={() => setPaused(!paused)}><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">{paused || reducedMotion ? <path d="m9 5 11 7-11 7Z"/> : <path d="M7 5h3v14H7zm7 0h3v14h-3z"/>}</svg></button></div>
    <div className="intake-options service-comparison">
      <article className={`service-card service-card-kiosk ${value?.intakeMethod === 'DEALER_DROP_OFF' ? 'selected' : ''}`}>
        <div className="service-speed-label"><SpeedMark kind="kiosk"/><h2>Super Fast</h2><span>Authorized Dealer</span></div>
        <ServiceFilm kind="kiosk" label="ATLAS kiosk drop-off preview" motionPaused={motionPaused}/>
        <div className="service-card-body"><ServiceJourney kind="kiosk"/>
          <dl className="service-metrics"><div><dt>Per card</dt><dd><strong>$50</strong><small>Transport included</small></dd></div><div><dt>Turnaround</dt><dd><strong>1 week</strong><small>From ATLAS collection</small></dd></div></dl>
          <p className="service-channel">ATLAS Submission Station<br/><strong>at an Authorized Dealer</strong></p><p>Drop your cards in the ATLAS kiosk at your local dealer. We handle pickup and return.</p>
          <div className="service-details"><p><strong>Drop off. Pick up.</strong> Your cards return to the same dealer.</p><p>The clock starts when ATLAS collects your cards, not when you drop them off.</p></div>
          <button type="button" className={value?.intakeMethod === 'DEALER_DROP_OFF' ? 'primary' : 'secondary'} aria-pressed={value?.intakeMethod === 'DEALER_DROP_OFF'} onClick={() => onChange({ intakeMethod: 'DEALER_DROP_OFF', kioskId: value?.intakeMethod === 'DEALER_DROP_OFF' ? value.kioskId : null })}>{value?.intakeMethod === 'DEALER_DROP_OFF' ? 'Kiosk selected ✓' : 'Find an Authorized Dealer →'}</button></div>
      </article>
      <article className={`service-card service-card-mail ${value?.intakeMethod === 'MAIL_IN' ? 'selected' : ''}`}>
        <div className="service-speed-label"><SpeedMark kind="mail"/><h2>Fast</h2><span>Mail-in</span></div>
        <ServiceFilm kind="fedex" label="FedEx mail-in drop-off preview" motionPaused={motionPaused}/>
        <div className="service-card-body"><ServiceJourney kind="mail"/>
          <dl className="service-metrics"><div><dt>Per card</dt><dd><strong>$40</strong><small>Plus FedEx shipping</small></dd></div><div><dt>Service speed</dt><dd><strong>2 weeks</strong><small>Mail-in service</small></dd></div></dl>
          <p className="service-channel">Mail-in with FedEx<br/><strong>From your door to ATLAS</strong></p><p>Pack your cards and send them with FedEx. Your graded cards ship back to you.</p>
          <div className="service-details"><p><strong>Shipping at cost.</strong> See your actual FedEx quote before payment.</p><p>Final shipping and turnaround terms appear with your confirmed quote.</p></div>
          <button type="button" className={value?.intakeMethod === 'MAIL_IN' ? 'primary' : 'secondary'} aria-pressed={value?.intakeMethod === 'MAIL_IN'} onClick={() => onChange({ intakeMethod: 'MAIL_IN', kioskId: null })}>{value?.intakeMethod === 'MAIL_IN' ? 'Mail-in selected ✓' : 'Choose mail-in →'}</button></div>
      </article>
    </div><p className="fine">Applicable taxes and the full total appear before payment. Grading begins after your cards physically reach ATLAS.</p>
    <SubmissionStationFinder value={value} onChange={onChange} visible={value?.intakeMethod === 'DEALER_DROP_OFF'}/>
  </section>;
}
