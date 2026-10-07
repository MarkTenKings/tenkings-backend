import { useEffect, useRef, useState } from 'react';
import { captureRapidCameraPhoto, RAPID_CAMERA_CONSTRAINTS, rapidCameraError } from '../lib/rapid-camera.mjs';
import styles from './PhotoIntake.module.css';

/** Keep this instance mounted across card changes: Front, Back and the next
 * Front share one camera stream. Local persistence belongs to PhotoIntake. */
export default function RapidCardCamera({ entry, disabled, onCapture }) {
    const video = useRef(null), stream = useRef(null), generation = useRef(0), mounted = useRef(false), capturing = useRef(false);
    const latest = useRef({ entry, disabled, onCapture }); latest.current = { entry, disabled, onCapture };
    const [state, setState] = useState('idle'), [error, setError] = useState(''), [busy, setBusy] = useState(false), [dimensions, setDimensions] = useState('');
    const hasFront = Boolean(entry?.files?.FRONT || entry?.selections?.FRONT || entry?.card?.sides?.find(side => side.side === 'FRONT' && side.status === 'VERIFIED'));
    const side = hasFront ? 'BACK' : 'FRONT';
    function stop() {
        generation.current++;
        stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
        if (video.current) { video.current.pause(); video.current.srcObject = null; }
    }
    async function start() {
        if (latest.current.disabled || !latest.current.entry || state === 'starting') return;
        setError(''); setState('starting');
        const attempt = ++generation.current;
        try {
            if (!navigator.mediaDevices?.getUserMedia) throw new Error('Open the secure ATLAS site in Safari or Chrome to use the camera, or choose photos below.');
            let active = stream.current;
            if (!active?.getVideoTracks().some(track => track.readyState === 'live')) active = await navigator.mediaDevices.getUserMedia(RAPID_CAMERA_CONSTRAINTS);
            if (!mounted.current || generation.current !== attempt) { active.getTracks().forEach(track => track.stop()); return; }
            stream.current = active;
            active.getVideoTracks().forEach(track => {
                track.enabled = true;
                track.onended = () => { if (stream.current !== active) return; stop(); setState('paused'); setError('The camera stopped. Tap Resume camera to continue.'); };
            });
            video.current.srcObject = active; await video.current.play();
            if (mounted.current && generation.current === attempt && video.current.videoWidth) {
                setDimensions(`${video.current.videoWidth.toLocaleString()} × ${video.current.videoHeight.toLocaleString()}`); setState('ready');
            }
        } catch (failure) { if (mounted.current && generation.current === attempt) { setState('paused'); setError(rapidCameraError(failure)); } }
    }
    useEffect(() => {
        mounted.current = true;
        const suspend = () => { stop(); if (mounted.current) setState('paused'); };
        const visibility = () => { if (document.visibilityState === 'hidden') suspend(); };
        document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', suspend);
        return () => { mounted.current = false; document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', suspend); stop(); };
    }, []);
    async function capture() {
        const current = latest.current;
        if (!current.entry || current.disabled || capturing.current || state !== 'ready') return;
        capturing.current = true; setBusy(true); setError('');
        const entryId = current.entry.id, attempt = generation.current, capturedSide = side;
        try {
            const photo = await captureRapidCameraPhoto(video.current, stream.current?.getVideoTracks()[0], capturedSide);
            if (!mounted.current || attempt !== generation.current || latest.current.entry?.id !== entryId) return;
            await current.onCapture(entryId, capturedSide, photo.file, { source: 'camera', capture: photo.capture });
        } catch (failure) { if (mounted.current && attempt === generation.current) setError(rapidCameraError(failure)); }
        finally { capturing.current = false; if (mounted.current) setBusy(false); }
    }
    return <section className={styles.camera} aria-label="Rapid card camera">
        <div className={styles.cameraHeading}><div><p className="eyebrow">RAPID CAPTURE</p><h2>{!entry ? 'All card slots are in use' : side === 'FRONT' ? 'Start with the Front' : 'Flip the same card to the Back'}</h2><p>{entry ? `${entry.title} · Both sides stay together. Back completes this pair.` : 'Your captured cards are saved below.'}</p></div><span className={styles.cameraSteps}><b data-current={side === 'FRONT'}>1 Front</b><i>→</i><b data-current={side === 'BACK'}>2 Back</b></span></div>
        <div className={styles.cameraFrame} hidden={state === 'idle'}>
            <video ref={video} autoPlay muted playsInline aria-label="Live card camera" onLoadedData={() => {
                if (stream.current && !video.current?.paused && video.current?.videoWidth) { setDimensions(`${video.current.videoWidth.toLocaleString()} × ${video.current.videoHeight.toLocaleString()}`); setState('ready'); }
            }} onPause={() => { if (stream.current && state === 'ready') setState('paused'); }} />
            <div className={styles.cameraGuide} aria-hidden="true"><span>{side}</span></div>
            <p className={styles.cameraHint}>Keep all four corners visible. Avoid glare.</p>
        </div>
        <div className={styles.cameraActions}>
            {state === 'ready' ? <button type="button" className="primary" disabled={busy || disabled || !entry} onClick={capture}>{busy ? 'Saving photograph…' : `Capture ${side === 'FRONT' ? 'Front' : 'Back'}`} <span aria-hidden="true">●</span></button>
                : <button type="button" className="primary" disabled={disabled || !entry || state === 'starting'} onClick={start}>{state === 'starting' ? 'Opening camera…' : state === 'idle' ? 'Open rear camera' : 'Resume camera'}</button>}
            {state !== 'idle' && <button type="button" className={styles.quietButton} onClick={() => { stop(); setState('idle'); }}>Close camera</button>}
            <p>{dimensions ? `Preview ${dimensions} · captured pixels are kept` : 'Or choose Front and Back photos below.'}</p>
        </div>
        {error && <p className={styles.captureError} role="alert">{error}</p>}
    </section>;
}
