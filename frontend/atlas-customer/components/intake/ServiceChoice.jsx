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
      <linearGradient id={`${artId}-wind`}><stop stopColor="#d8f2ff" stopOpacity="0"/><stop offset=".3" stopColor="#b8d5e2" stopOpacity=".24"/><stop offset=".78" stopColor="#e8f8ff"/><stop offset="1" stopColor="#c4e4f2" stopOpacity="0"/></linearGradient>
    </defs>
    {kind === 'kiosk' ? <>
      <g className="lightning-strike strike-one"><path className="lightning-channel" pathLength="1" d="M-12 38 28 46 45 34 72 52 91 48 112 64 135 53 153 71 181 67 196 83 225 71 247 84 262 77 290 95 319 79 339 91 358 76 381 90 399 72 426 79 442 65 469 76 496 59 519 69 541 51 566 60 587 40 617 48"/><path className="lightning-branch" pathLength="1" d="M91 48 107 29 122 34 139 15 151 19 174 -6M181 67 197 108 215 100 234 124 248 119 278 155M319 79 338 45 356 51 373 24 397 31 419 5M469 76 484 104 505 97 522 124 547 119 570 147"/></g>
      <g className="lightning-strike strike-two"><path className="lightning-channel" pathLength="1" d="M-18 112 17 96 39 106 63 84 91 95 110 72 132 81 158 58 181 65 202 49 224 57 245 36 268 48 291 31 312 39 338 24 363 38 385 28 409 44 432 35 455 59 474 51 502 75 523 63 547 80 570 73 595 92 621 82"/><path className="lightning-branch" pathLength="1" d="M63 84 87 110 103 105 123 132 148 128 163 155M202 49 217 17 234 21 249 -8M312 39 328 67 351 62 364 89 384 82 404 113M455 59 479 34 492 42 511 12 532 20 550 -7"/></g>
      <g className="lightning-strike strike-three"><path className="lightning-channel" pathLength="1" d="M-10 69 22 80 40 68 64 83 87 66 103 75 129 50 146 61 169 42 194 53 217 32 235 47 263 40 281 64 306 56 328 75 350 61 369 85 392 76 413 101 438 88 454 106 480 98 503 119 530 104 549 121 577 110 603 126"/><path className="lightning-branch" pathLength="1" d="M40 68 56 45 78 49 94 24 115 31 141 2M169 42 183 76 199 68 220 100 237 94 258 126M350 61 365 33 386 40 410 13 431 21 450 -4M480 98 497 66 517 76 535 51 558 57 579 26"/></g>
    </> : <>
      <g className="wind-current wind-one" stroke={`url(#${artId}-wind)`}><path className="wind-soft" d="M-55 48C58 12 135 91 248 60S382 25 465 47 528 63 576 50"/><path d="M-55 43C60 6 135 85 246 54S384 19 466 41 533 56 576 45"/><path d="M-40 54C59 23 139 98 254 67S384 34 470 54 533 68 580 57"/></g>
      <g className="wind-current wind-two" stroke={`url(#${artId}-wind)`}><path className="wind-soft" d="M-75 118C29 68 98 154 219 112S337 60 401 83 453 103 508 78"/><path d="M-75 113C29 62 100 148 217 106S338 53 403 77 454 96 508 72"/><path d="M-65 127C31 82 107 162 225 121S341 70 409 93 461 112 515 86"/></g>
      <g className="wind-current wind-three" stroke={`url(#${artId}-wind)`}><path d="M-35 24C58 47 106 -2 195 20S273 83 336 69 395 31 465 55"/><path d="M-29 31C59 53 107 6 198 28S277 92 343 78 400 39 471 62"/></g>
    </>}
  </svg>;
}
function ServiceJourney({ kind }) {
  const steps = kind === 'kiosk' ? ['Drop off', 'We grade', 'Pick up'] : ['Mail in', 'We grade', 'Ships back'];
  return <div className={`service-timeline service-timeline-${kind}`}>
    <div className="service-timeline-track">
      <i className="service-timeline-fill" aria-hidden="true"/>
      <div className="service-timeline-heading" aria-hidden="true"><strong>{kind === 'kiosk' ? '7' : '14'} days</strong><div className="timeline-delivery"><span className="finish-caption">SERVICE SPEED</span><span className="finish-stamp"><svg viewBox="0 0 36 36" focusable="false"><path d="m7 18 7 7L30 9"/></svg><strong>Delivered</strong></span></div></div>
      <div className="service-parcel-track" aria-hidden="true"><div className="service-parcel">
        <div className="parcel-card"><div className="parcel-card-label"><img src="/account/brand/atlas-grading-logo.png" alt=""/></div><span className="parcel-card-window"/></div>
        <div className="parcel-box"><i/><span/></div><i className="parcel-flap parcel-flap-left"/><i className="parcel-flap parcel-flap-right"/>
      </div></div>
      <ol className="service-journey" aria-label={kind === 'kiosk' ? 'Kiosk service journey' : 'Mail-in service journey'}>{steps.map((step, index) => <li key={step}><span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><strong>{step}</strong></li>)}</ol>
    </div>
  </div>;
}
export default function ServiceChoice({ value, onChange, showStations = true }) {
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
          <p className="service-channel">ATLAS Submission Station<br/><strong>at an Authorized Dealer</strong></p><p>Snap your cards, pay on your phone, and show staff your handoff code. We handle pickup and return.</p>
          <div className="service-details"><p><strong>Drop off. Pick up.</strong> Your cards return to the same dealer.</p><p>The clock starts when ATLAS collects your cards, not when you drop them off.</p></div>
          <button type="button" className={value?.intakeMethod === 'DEALER_DROP_OFF' ? 'primary' : 'secondary'} aria-pressed={value?.intakeMethod === 'DEALER_DROP_OFF'} onClick={() => onChange({ intakeMethod: 'DEALER_DROP_OFF', kioskId: value?.intakeMethod === 'DEALER_DROP_OFF' ? value.kioskId : null })}>{value?.intakeMethod === 'DEALER_DROP_OFF' ? 'Card shop selected ✓' : 'Find an Authorized Dealer →'}</button></div>
      </article>
      <article className={`service-card service-card-mail ${value?.intakeMethod === 'MAIL_IN' ? 'selected' : ''}`}>
        <div className="service-speed-label"><SpeedMark kind="mail"/><h2>Fast</h2><span>Mail-in</span></div>
        <ServiceFilm kind="fedex" label="FedEx mail-in drop-off preview" motionPaused={motionPaused}/>
        <div className="service-card-body"><ServiceJourney kind="mail"/>
          <dl className="service-metrics"><div><dt>Per card</dt><dd><strong>$40</strong><small>Shipping paid separately</small></dd></div><div><dt>Service speed</dt><dd><strong>2 weeks</strong><small>Mail-in service</small></dd></div></dl>
          <p className="service-channel">Mail-in grading<br/><strong>From your door to ATLAS</strong></p><p>Pay for grading now. Choose an available carrier and approve a separate shipping payment later from your saved order.</p>
          <div className="service-details"><p><strong>Shipping at cost.</strong> Review your actual carrier quote and tax before paying for shipping. Keep your cards until your label is ready.</p><p>Your grading turnaround starts when ATLAS physically receives your cards.</p></div>
          <button type="button" className={value?.intakeMethod === 'MAIL_IN' ? 'primary' : 'secondary'} aria-pressed={value?.intakeMethod === 'MAIL_IN'} onClick={() => onChange({ intakeMethod: 'MAIL_IN', kioskId: null })}>{value?.intakeMethod === 'MAIL_IN' ? 'Mail-in selected ✓' : 'Choose mail-in →'}</button></div>
      </article>
    </div><p className="fine">Applicable taxes and the amount due appear before each payment. Mail-in shipping is quoted and paid separately. Grading begins after your cards physically reach ATLAS.</p>
    {showStations && <SubmissionStationFinder value={value} onChange={onChange} visible={value?.intakeMethod === 'DEALER_DROP_OFF'}/>}
  </section>;
}
