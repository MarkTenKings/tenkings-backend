import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { prepareStaffInventoryPhoto, STAFF_INVENTORY_PHOTO_ACCEPT, STAFF_PHOTO_LONG_EDGE } from '../../lib/inventoryPhotoUpload';
import styles from './StaffInventoryCardCapture.module.css';

type Side = 'front' | 'back';
type Source = 'camera' | 'library';
type CameraState = 'idle' | 'starting' | 'ready' | 'paused' | 'error';
type Photo = { file: File; url: string };

export type StaffInventoryCardCaptureProps = {
  open: boolean;
  /** Change only when starting a fresh pair, including after a confirmed inventory save. */
  cycle: number;
  disabled?: boolean;
  initialSource?: Source;
  /** False for an asynchronous next-card open: only an existing stream may resume. */
  autoStartCamera?: boolean;
  /** Local normalized JPEG files only. Upload, identify and save in the parent. */
  onPair: (front: File, back: File) => void;
  onClose: () => void;
  onError?: (message: string) => void;
  locationStatus?: string;
};

function CameraIcon() {
  return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M8 5.5 9.5 3h5L16 5.5h3A2 2 0 0 1 21 7.5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2Z" /><circle cx="12" cy="12.5" r="4" /></svg>;
}

function cameraError(error: unknown) {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera access is off. Allow camera access in your browser settings, then tap Resume camera, or choose photos.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No usable camera was found. Connect a camera or choose photos.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'The camera is unavailable. Close any other app using it, then tap Resume camera, or choose photos.';
  return 'The camera could not start. Tap Resume camera to try again, or choose photos.';
}

function preparedFile(image: string, side: Side) {
  const encoded = image.split(',')[1];
  if (!image.startsWith('data:image/jpeg;base64,') || !encoded) throw new Error('This photo could not be prepared. Choose it again.');
  const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
  return new File([bytes], `card-${side}.jpg`, { type: 'image/jpeg' });
}

/** One component instance is one add-modal camera session. Keep it mounted while pricing. */
export default function StaffInventoryCardCapture({ open, cycle, disabled = false, initialSource = 'camera', autoStartCamera = true, onPair, onClose, onError, locationStatus }: StaffInventoryCardCaptureProps) {
  const headingId = useId();
  const [source, setSource] = useState<Source>(initialSource);
  const [side, setSide] = useState<Side>('front');
  const [photos, setPhotos] = useState<Partial<Record<Side, Photo>>>({});
  const [camera, setCamera] = useState<CameraState>('idle');
  const [busy, setBusy] = useState(false);
  const [delivered, setDelivered] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const frontInput = useRef<HTMLInputElement>(null);
  const backInput = useRef<HTMLInputElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const removeTrackListeners = useRef<() => void>(() => {});
  const mediaAttempt = useRef(0);
  const playbackAttempt = useRef(0);
  const photoAttempt = useRef(0);
  const preparation = useRef<AbortController | null>(null);
  const frameRequest = useRef<number | null>(null);
  const hasRequestedCamera = useRef(false);
  const requestingCamera = useRef(false);
  const isMounted = useRef(true);
  const isOpen = useRef(open);
  const isDisabled = useRef(disabled);
  const currentSource = useRef(source);
  const currentPhotos = useRef(photos);
  const currentCycle = useRef(cycle);
  const isBusy = useRef(false);
  const isDelivered = useRef(false);
  const callbacks = useRef({ onPair, onClose, onError });
  isOpen.current = open;
  isDisabled.current = disabled;
  currentSource.current = source;
  callbacks.current = { onPair, onClose, onError };

  const pauseCamera = useCallback(() => {
    playbackAttempt.current++;
    if (frameRequest.current !== null) video.current?.cancelVideoFrameCallback?.(frameRequest.current);
    frameRequest.current = null;
    video.current?.pause();
    stream.current?.getTracks().forEach(track => { track.enabled = false; });
  }, []);

  const stopCamera = useCallback(() => {
    mediaAttempt.current++;
    requestingCamera.current = false;
    pauseCamera();
    removeTrackListeners.current();
    removeTrackListeners.current = () => {};
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  }, [pauseCamera]);

  const cancelPhoto = useCallback(() => {
    photoAttempt.current++;
    preparation.current?.abort();
    preparation.current = null;
    isBusy.current = false;
    setBusy(false);
  }, []);

  const reportError = useCallback((message: string) => {
    setError(message);
    callbacks.current.onError?.(message);
  }, []);

  const playCamera = useCallback(async (active: MediaStream) => {
    const element = video.current;
    if (!element || !isMounted.current || !isOpen.current || isDisabled.current || currentSource.current !== 'camera' || isDelivered.current) return;
    const attempt = ++playbackAttempt.current;
    const current = () => isMounted.current && attempt === playbackAttempt.current && stream.current === active && isOpen.current && !isDisabled.current && currentSource.current === 'camera' && !isDelivered.current;
    active.getTracks().forEach(track => { track.enabled = true; });
    element.srcObject = active;
    setCamera('starting');
    try {
      await element.play();
      if (!current()) return;
      const ready = () => {
        frameRequest.current = null;
        if (current() && element.videoWidth > 0 && element.videoHeight > 0) setCamera('ready');
      };
      if (element.requestVideoFrameCallback) frameRequest.current = element.requestVideoFrameCallback(ready);
      else ready();
    } catch {
      if (!current()) return;
      pauseCamera();
      setCamera('paused');
      setError('The camera is paused. Tap Resume camera when you are ready.');
    }
  }, [pauseCamera]);

  const startCamera = useCallback(async () => {
    if (!isOpen.current || isDisabled.current || isDelivered.current) return;
    currentSource.current = 'camera';
    setSource('camera');
    setError('');
    const active = stream.current;
    if (active?.getVideoTracks().some(track => track.readyState === 'live')) {
      await playCamera(active);
      return;
    }
    stopCamera();
    hasRequestedCamera.current = true;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera('error');
      reportError('This browser cannot open the camera here. Open the secure Ten Kings site in Safari or Chrome, or choose photos.');
      return;
    }
    const attempt = ++mediaAttempt.current;
    requestingCamera.current = true;
    setCamera('starting');
    try {
      const activeStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } } });
      if (!isMounted.current || attempt !== mediaAttempt.current || !isOpen.current || isDisabled.current || currentSource.current !== 'camera') {
        activeStream.getTracks().forEach(track => track.stop());
        return;
      }
      if (!activeStream.getVideoTracks().some(track => track.readyState === 'live')) {
        activeStream.getTracks().forEach(track => track.stop());
        throw new Error('No live camera track.');
      }
      stream.current = activeStream;
      const ended = () => {
        if (stream.current !== activeStream) return;
        stopCamera();
        setCamera('paused');
        setError('The camera stopped. Tap Resume camera to continue.');
      };
      activeStream.getVideoTracks().forEach(track => track.addEventListener('ended', ended));
      removeTrackListeners.current = () => activeStream.getVideoTracks().forEach(track => track.removeEventListener('ended', ended));
      await playCamera(activeStream);
    } catch (failure) {
      if (!isMounted.current || attempt !== mediaAttempt.current || !isOpen.current || currentSource.current !== 'camera') return;
      setCamera('error');
      reportError(cameraError(failure));
    } finally {
      if (attempt === mediaAttempt.current) requestingCamera.current = false;
    }
  }, [playCamera, reportError, stopCamera]);

  useEffect(() => {
    if (currentCycle.current === cycle) return;
    currentCycle.current = cycle;
    cancelPhoto();
    for (const photo of Object.values(currentPhotos.current)) if (photo) URL.revokeObjectURL(photo.url);
    currentPhotos.current = {};
    setPhotos({});
    isDelivered.current = false;
    setDelivered(false);
    setSide('front');
    setSource(initialSource);
    currentSource.current = initialSource;
    setError('');
  }, [cycle, initialSource, cancelPhoto]);

  useEffect(() => {
    if (!open || disabled || currentSource.current !== 'camera' || delivered) {
      mediaAttempt.current++;
      requestingCamera.current = false;
      pauseCamera();
      if (!open || disabled) cancelPhoto();
      return;
    }
    if (stream.current?.getVideoTracks().some(track => track.readyState === 'live')) void playCamera(stream.current);
    else if (!hasRequestedCamera.current && autoStartCamera) void startCamera();
    else if (!requestingCamera.current) setCamera('paused');
    // A saved next-card cycle only resumes an existing stream. A stopped camera needs a tap.
  }, [open, disabled, source, delivered, cycle, autoStartCamera, pauseCamera, cancelPhoto, playCamera, startCamera]);

  useEffect(() => {
    isMounted.current = true;
    const suspend = () => {
      stopCamera();
      cancelPhoto();
      setCamera('paused');
    };
    const visibility = () => { if (document.visibilityState === 'hidden') suspend(); };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', suspend);
    return () => {
      isMounted.current = false;
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', suspend);
      preparation.current?.abort();
      stopCamera();
      for (const photo of Object.values(currentPhotos.current)) if (photo) URL.revokeObjectURL(photo.url);
      currentPhotos.current = {};
    };
  }, [cancelPhoto, stopCamera]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [open]);

  const acceptPhoto = (capturedSide: Side, file: File) => {
    const photo = { file, url: URL.createObjectURL(file) };
    const previous = currentPhotos.current[capturedSide];
    if (previous) URL.revokeObjectURL(previous.url);
    const next = { ...currentPhotos.current, [capturedSide]: photo };
    currentPhotos.current = next;
    setPhotos(next);
    setError('');
    if (!next.front || !next.back) {
      setSide(next.front ? 'back' : 'front');
      return;
    }
    if (isDelivered.current) return;
    isDelivered.current = true;
    setDelivered(true);
    pauseCamera();
    callbacks.current.onPair(next.front.file, next.back.file);
  };

  const capture = async () => {
    const element = video.current;
    if (isBusy.current || isDelivered.current || disabled || camera !== 'ready' || !element || !element.videoWidth || !element.videoHeight) return;
    isBusy.current = true;
    setBusy(true);
    setError('');
    const attempt = ++photoAttempt.current;
    const capturedSide = side;
    const canvas = document.createElement('canvas');
    try {
      const scale = Math.min(1, STAFF_PHOTO_LONG_EDGE / Math.max(element.videoWidth, element.videoHeight));
      canvas.width = Math.max(1, Math.round(element.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(element.videoHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('The photo could not be captured. Try again or choose a photo.');
      context.drawImage(element, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value?.size ? resolve(value) : reject(new Error('The photo could not be captured. Try again.')), 'image/jpeg', 0.9));
      if (!isMounted.current || attempt !== photoAttempt.current || !isOpen.current) return;
      acceptPhoto(capturedSide, new File([blob], `card-${capturedSide}.jpg`, { type: 'image/jpeg' }));
    } catch (failure) {
      if (isMounted.current && attempt === photoAttempt.current) reportError(failure instanceof Error ? failure.message : 'The photo could not be captured. Try again.');
    } finally {
      canvas.width = canvas.height = 1;
      if (isMounted.current && attempt === photoAttempt.current) { isBusy.current = false; setBusy(false); }
    }
  };

  const choosePhoto = async (capturedSide: Side, file?: File) => {
    if (!file || isBusy.current || isDelivered.current || disabled) return;
    isBusy.current = true;
    setBusy(true);
    setError('');
    const attempt = ++photoAttempt.current;
    const controller = new AbortController();
    preparation.current = controller;
    try {
      const prepared = await prepareStaffInventoryPhoto(file, { signal: controller.signal });
      if (!isMounted.current || attempt !== photoAttempt.current || !isOpen.current || controller.signal.aborted) return;
      acceptPhoto(capturedSide, preparedFile(prepared.image, capturedSide));
    } catch (failure) {
      if (isMounted.current && attempt === photoAttempt.current && !controller.signal.aborted) reportError(failure instanceof Error ? failure.message : 'This photo could not be opened. Choose it again.');
    } finally {
      if (isMounted.current && attempt === photoAttempt.current) { preparation.current = null; isBusy.current = false; setBusy(false); }
    }
  };

  const retake = (capturedSide: Side) => {
    if (isBusy.current || isDelivered.current || disabled) return;
    const previous = currentPhotos.current[capturedSide];
    if (previous) URL.revokeObjectURL(previous.url);
    const next = { ...currentPhotos.current };
    delete next[capturedSide];
    currentPhotos.current = next;
    setPhotos(next);
    setSide(capturedSide);
    setError('');
    primary.current?.focus();
  };

  const close = () => { cancelPhoto(); if (isDelivered.current) pauseCamera(); else stopCamera(); callbacks.current.onClose(); };
  const keyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key !== 'Tab') return;
    const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]') ?? []).filter(element => !element.closest('[hidden]'));
    const first = controls[0]; const last = controls[controls.length - 1];
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus(); }
  };

  return <section ref={dialog} data-inventory-camera className={styles.overlay} hidden={!open} role="dialog" aria-modal="true" aria-labelledby={headingId} tabIndex={-1} onKeyDown={keyboard}>
    <div className={styles.panel}>
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>ADD A CARD</p><h2 id={headingId}>{delivered ? 'Photos ready' : side === 'front' ? 'Capture the front' : 'Now flip to the back'}</h2></div>
        <button type="button" className={styles.close} aria-label="Close card camera" onClick={close}><span aria-hidden="true">×</span></button>
      </header>
      <div className={styles.body}>
        <div className={styles.steps} aria-label="Photo progress">
          <span data-current={!delivered && side === 'front'} data-complete={Boolean(photos.front)}><b>{photos.front ? '✓' : '1'}</b> Front</span>
          <i aria-hidden="true" />
          <span data-current={!delivered && side === 'back'} data-complete={Boolean(photos.back)}><b>{photos.back ? '✓' : '2'}</b> Back</span>
        </div>
        <div className={styles.viewfinder} hidden={source !== 'camera' || delivered}>
          <video ref={video} muted playsInline autoPlay className={styles.video} aria-label={`${side === 'front' ? 'Front' : 'Back'} camera preview`} onPause={() => {
            if (camera !== 'ready' || !isOpen.current || isDelivered.current || !stream.current?.getVideoTracks().some(track => track.enabled)) return;
            pauseCamera(); setCamera('paused'); setError('The camera is paused. Tap Resume camera when you are ready.');
          }} onLoadedData={() => {
            if (!video.current?.requestVideoFrameCallback && video.current?.videoWidth && !video.current.paused && stream.current && isOpen.current && !isDisabled.current && currentSource.current === 'camera' && !isDelivered.current) setCamera('ready');
          }} />
          <div className={styles.guide} aria-hidden="true"><span>{side === 'front' ? 'FRONT' : 'BACK'}</span></div>
          {camera !== 'ready' && <div className={styles.cameraMessage}><CameraIcon /><p>{camera === 'starting' ? 'Opening camera…' : camera === 'error' ? 'Camera unavailable' : 'Camera paused'}</p>{camera !== 'starting' && <button type="button" className={styles.lightButton} disabled={disabled} onClick={() => void startCamera()}>Resume camera</button>}</div>}
          {camera === 'ready' && <p className={styles.guideHint}>Keep all four corners in view. Avoid glare.</p>}
        </div>
        {source === 'library' && !delivered && <div className={styles.library}><CameraIcon /><h3>{side === 'front' ? 'Choose the front photo' : 'Choose the back photo'}</h3><p>JPG, PNG, WebP and iPhone HEIC photos.</p></div>}
        {(photos.front || photos.back) && <div className={styles.previews}>
          {(['front', 'back'] as const).map(photoSide => photos[photoSide] && <div key={photoSide} className={styles.preview}>
            {/* Local, short-lived blob URLs cannot use the Next image optimizer. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photos[photoSide]!.url} alt={`Captured card ${photoSide}`} />
            <span>{photoSide === 'front' ? 'Front' : 'Back'} <small>Ready</small></span>
            {!delivered && <button type="button" className={styles.textButton} disabled={busy || disabled} onClick={() => retake(photoSide)}>Retake {photoSide}</button>}
          </div>)}
        </div>}
        <div aria-live="polite" role="status" className={styles.status}>{busy ? source === 'library' ? 'Preparing photo…' : 'Capturing photo…' : delivered ? 'Both sides are ready. Continue with the card details.' : side === 'back' ? 'Front captured. One more photo and your card details will fill in.' : 'Two quick photos. Then review the details and add your prices.'}</div>
        {locationStatus && <p className={styles.locationStatus} role="status">{locationStatus}</p>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
      </div>
      <footer className={styles.footer}>
        {delivered ? <button type="button" className={styles.primary} onClick={close}>Continue to card details</button> : <>
          {source === 'camera' ? <button ref={primary} type="button" className={styles.primary} disabled={busy || disabled || camera !== 'ready'} onClick={() => void capture()}><span className={styles.shutter} aria-hidden="true" />{busy ? 'Capturing…' : `Capture ${side}`}</button> : <button ref={primary} type="button" className={styles.primary} disabled={busy || disabled} onClick={() => (side === 'front' ? frontInput : backInput).current?.click()}>{busy ? 'Preparing…' : `Choose ${side} photo`}</button>}
          <div className={styles.secondaryActions}>
            <button type="button" className={styles.textButton} disabled={busy || disabled} onClick={() => { setError(''); if (source === 'camera') { currentSource.current = 'library'; setSource('library'); } else void startCamera(); }}>{source === 'camera' ? 'Choose photos instead' : 'Use camera instead'}</button>
            {busy && <button type="button" className={styles.textButton} onClick={cancelPhoto}>Cancel photo</button>}
          </div>
        </>}
      </footer>
      {(['front', 'back'] as const).map(photoSide => <input key={photoSide} ref={photoSide === 'front' ? frontInput : backInput} type="file" accept={STAFF_INVENTORY_PHOTO_ACCEPT} hidden tabIndex={-1} aria-label={`Choose card ${photoSide} photo`} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void choosePhoto(photoSide, file); }} />)}
    </div>
  </section>;
}
