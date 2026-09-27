import { useEffect, useRef, useState } from 'react';
import { captureRapidCameraPhoto, fitRapidCameraPreview, RAPID_CAMERA_CONSTRAINTS, rapidCameraError } from './rapid-camera.mjs';
import styles from './RapidCardCamera.module.css';

/** Keep mounted across Front → Back → next Front. onCapture must acknowledge
 * local durable storage only; no upload or identification promise belongs here.
 * completedPairs comes from durable paired originals, independent of uploads. */
export default function RapidCardCamera({ side = 'FRONT', cardLabel = 'Your card', completedPairs = 0, disabled = false, onCapture, onClose, autoStart = true, status = '' }) {
  const video = useRef(null), previewArea = useRef(null), stream = useRef(null), root = useRef(null), generation = useRef(0), alive = useRef(false), busyRef = useRef(false), starting = useRef(false);
  const latest = useRef({ side, cardLabel, disabled, onCapture, onClose }); latest.current = { side, cardLabel, disabled, onCapture, onClose };
  const [state, setState] = useState('idle'), [error, setError] = useState(''), [busy, setBusy] = useState(false), [flash, setFlash] = useState(false);
  const [frame, setFrame] = useState(null);
  function measurePreview() {
    const bounds = previewArea.current?.getBoundingClientRect(), picture = video.current;
    const next = bounds && fitRapidCameraPreview(picture?.videoWidth, picture?.videoHeight, bounds.width, bounds.height);
    setFrame(previous => previous?.width === next?.width && previous?.height === next?.height ? previous : next);
  }
  function stop() {
    generation.current++; starting.current = false;
    const old = stream.current; stream.current = null; old?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    if (video.current) { video.current.pause(); video.current.srcObject = null; }
  }
  async function start() {
    if (starting.current) return;
    starting.current = true; setError(''); setState('starting'); const attempt = ++generation.current;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Open ATLAS in Safari or Chrome to use the camera. You can also choose photos from your library.');
      const active = stream.current?.getVideoTracks().some(track => track.readyState === 'live') ? stream.current : await navigator.mediaDevices.getUserMedia(RAPID_CAMERA_CONSTRAINTS);
      if (!alive.current || generation.current !== attempt) { active.getTracks().forEach(track => track.stop()); return; }
      stream.current = active;
      active.getVideoTracks().forEach(track => { track.enabled = true; track.onended = () => { if (stream.current !== active) return; stop(); if (alive.current) { setState('paused'); setError('Your camera paused. Resume when you are ready.'); } }; });
      video.current.srcObject = active; await video.current.play();
      if (alive.current && generation.current === attempt) { measurePreview(); setState(video.current.videoWidth ? 'ready' : 'starting'); }
    } catch (failure) { if (alive.current && generation.current === attempt) { stop(); setState('paused'); setError(rapidCameraError(failure)); } }
    finally { if (generation.current === attempt) starting.current = false; }
  }
  useEffect(() => {
    alive.current = true; const previousFocus = document.activeElement, previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; root.current?.focus();
    const observer = new ResizeObserver(measurePreview); observer.observe(previewArea.current);
    const pause = () => { stop(); if (alive.current) setState('paused'); };
    const visibility = () => { if (document.visibilityState === 'hidden') pause(); };
    const keys = event => {
      if (event.key === 'Escape' && !busyRef.current) latest.current.onClose?.();
      if (event.key === 'Tab') {
        const targets = [...(root.current?.querySelectorAll('button:not(:disabled), a[href], [tabindex="0"]') ?? [])];
        const first = targets[0], last = targets.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', pause); document.addEventListener('keydown', keys);
    if (autoStart) void start();
    return () => { alive.current = false; observer.disconnect(); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', pause); document.removeEventListener('keydown', keys); stop(); document.body.style.overflow = previousOverflow; previousFocus?.focus?.(); };
  }, []);
  async function capture() {
    const current = latest.current;
    if (busyRef.current || current.disabled || state !== 'ready') return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      // Once acquired, always hand these bytes to durable storage even if the
      // camera is suspended while native still acquisition finishes.
      const photo = await captureRapidCameraPhoto(video.current, stream.current?.getVideoTracks()[0], current.side, { matchPreview: true });
      await current.onCapture(photo.file, { source: 'camera', capture: photo.capture });
      if (alive.current) { setFlash(true); setTimeout(() => { if (alive.current) setFlash(false); }, 180); }
    } catch (failure) { if (alive.current) setError(rapidCameraError(failure)); }
    finally { busyRef.current = false; if (alive.current) setBusy(false); }
  }
  return <section ref={root} tabIndex={-1} className={styles.camera} role="dialog" aria-modal="true" aria-label="Rapid card capture">
    <header className={styles.header}>
      <div><span className={styles.brand}>ATLAS <b>CAPTURE</b></span><p>{cardLabel}</p></div>
      <span className={styles.pairCount} role="status" aria-label="Completed card pairs" aria-live="polite" aria-atomic="true">
        <svg viewBox="0 0 22 24" fill="none" aria-hidden="true"><path d="M5 4 2 5.5l3 16 12-2"/><rect x="7" y="2" width="12" height="17" rx="2"/><path d="M10 6h6M10 9h6"/></svg>
        <span><b>{completedPairs}</b><span> saved</span></span>
      </span>
      <button type="button" className={styles.close} onClick={onClose} disabled={busy} aria-label="Close camera">✕</button>
    </header>
    <div className={styles.viewfinder} data-flash={flash}>
      <span className={styles.sideCue} aria-hidden="true"><span className={styles.sideCoin} data-side={side}><span>FRONT</span><span>BACK</span></span></span>
      <div ref={previewArea} className={styles.previewArea}>
        <div className={styles.previewFrame} style={frame ?? { width: '100%', height: '100%' }}>
          <video ref={video} autoPlay muted playsInline aria-label="Live rear camera — full saved frame" onResize={measurePreview} onLoadedData={() => { if (stream.current && video.current?.videoWidth && !video.current?.paused) { measurePreview(); starting.current = false; setState('ready'); } }} />
          {frame && <div className={styles.guide} style={fitRapidCameraPreview(63.5, 88.9, frame.width * .9, frame.height * .9)} aria-hidden="true"><i/><i/><i/><i/></div>}
        </div>
      </div>
      <div className={styles.instruction} aria-live="polite"><strong>{side === 'FRONT' ? 'Front. Frame it. Capture.' : 'Flip it. Capture the back.'}</strong><span>Full photo shown. Move closer to fill the guide.</span></div>
      {state !== 'ready' && <div className={styles.paused}>{state === 'starting' ? 'Opening your camera…' : 'Your next card is waiting.'}</div>}
    </div>
    <footer className={styles.controls}>
      <div className={styles.sequence}><span data-current={side === 'FRONT'}>01 FRONT</span><i>→</i><span data-current={side === 'BACK'}>02 BACK</span><i>→</i><span>NEXT CARD</span></div>
      {state === 'ready' ? <button type="button" className={styles.shutter} aria-label={`Capture ${side === 'FRONT' ? 'Front' : 'Back'}`} disabled={busy || disabled} onClick={() => void capture()}><span/></button> : <button type="button" className={styles.resume} disabled={state === 'starting'} onClick={() => void start()}>{state === 'starting' ? 'One moment…' : 'Resume camera'}</button>}
      <p role="status">{busy ? 'Saving on this device…' : status || 'Capture keeps moving. Uploads happen in the background.'}</p>
      {error && <p className={styles.error} role="alert">{error}</p>}
    </footer>
  </section>;
}
