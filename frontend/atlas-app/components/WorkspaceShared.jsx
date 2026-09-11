import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Notice } from './Shell';
import { STAFF_REAUTHENTICATE_PATH } from '../lib/routes.mjs';
import { cardSide, originalImagePath, stateNames, verifiedSide } from '../lib/workspace-client.mjs';
import styles from './WorkspaceUi.module.css';

export function StateBadge({ state }) { return <span className={`${styles.badge} ${styles[`state${state}`] ?? ''}`}>{stateNames[state] ?? state}</span>; }
export function Readiness({ readiness }) {
    if (!readiness) return null;
    const capabilities = [['photoStorage', 'Photo storage'], ['preparation', 'Image preparation'], ['manualGrading', 'Manual grading'], ['astra', 'Astra']];
    return <details className={styles.readiness}><summary>Workspace availability</summary><div>{capabilities.map(([key, title]) => {
        const value = readiness[key], available = value === true || value?.available === true || value?.ready === true;
        return <p key={key}><strong>{title}</strong><span>{available ? 'Available' : 'Awaiting connection'}</span>{value?.message && <small>{value.message}</small>}</p>;
    })}</div></details>;
}
export function RecoveryNotice({ mutation }) {
    return <>{mutation.error && <Notice error>{mutation.error}{mutation.errorCode === 'SIGN_IN_REQUIRED' && <p><a href={STAFF_REAUTHENTICATE_PATH}>Sign in again</a></p>}</Notice>}{mutation.busy && mutation.pending && <p className={styles.help} role="status">{mutation.reconciling ? 'Checking this action’s recorded result…' : 'Saving this action…'}</p>}</>;
}
export function PhotoPreview({ file, card, side, className = '', onLoaded }) {
    const [localUrl, setLocalUrl] = useState(''), [failed, setFailed] = useState(false);
    useEffect(() => { setFailed(false); if (!file) { setLocalUrl(''); return; } const url = URL.createObjectURL(file); setLocalUrl(url); return () => URL.revokeObjectURL(url); }, [file]);
    const url = localUrl || (verifiedSide(card, side) ? originalImagePath(card.id, side) : '');
    return url && !failed ? <img className={className} src={url} alt={`${side === 'FRONT' ? 'Front' : 'Back'} original photograph`} onLoad={onLoaded} onError={() => setFailed(true)} /> : <div className={`${styles.photoEmpty} ${className}`}><span>{side === 'FRONT' ? 'Front' : 'Back'}</span><small>{failed ? 'Preview unavailable. Original upload remains saved.' : cardSide(card, side)?.status === 'PLANNED' ? 'Upload awaiting verification' : 'Add original photograph'}</small></div>;
}
export function OriginalHeicDownload({ file }) {
    const [url, setUrl] = useState('');
    useEffect(() => {
        if (!file) { setUrl(''); return; }
        const value = URL.createObjectURL(file); setUrl(value);
        return () => URL.revokeObjectURL(value);
    }, [file]);
    return url ? <a href={url} download={file.name}>Download original HEIC</a> : null;
}
export function OriginalImages({ card }) {
    const [side, setSide] = useState('FRONT'), [zoom, setZoom] = useState(false);
    return <section className={styles.originals}><div className={styles.panelHeading}><h2>Source photographs</h2><div className={styles.segmented}>{['FRONT', 'BACK'].map(value => <button type="button" key={value} aria-pressed={side === value} onClick={() => { setSide(value); setZoom(false); }}>{value === 'FRONT' ? 'Front' : 'Back'}</button>)}</div></div><div className={`${styles.imageStage} ${zoom ? styles.zoomed : ''}`}><PhotoPreview key={side} card={card} side={side} /></div><div className={styles.panelFooter}><span>{verifiedSide(card, side) ? 'Verified upload · retained unchanged' : 'Source awaiting verification'}</span><button type="button" disabled={!verifiedSide(card, side)} onClick={() => setZoom(value => !value)}>{zoom ? 'Fit image' : 'Zoom image'}</button></div></section>;
}
export function ReportLink({ card, label = 'Open report corrections and approval' }) {
    if (card?.workspace?.reportAccess === false) return <p className={styles.help}>Report review access is not assigned to this staff account.</p>;
    return card?.specimenId ? <Link className="primary" href={`/cards/${card.specimenId}`}>{label}<span aria-hidden="true">↗</span></Link> : <p className={styles.help}>The report will appear here after image preparation and grading are complete.</p>;
}
