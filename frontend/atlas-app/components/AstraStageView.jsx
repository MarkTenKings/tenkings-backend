import { useState } from 'react';
import { PhotoPreview, ReportLink } from './WorkspaceShared';
import WorkspaceIcon from './WorkspaceIcon';
import { cardSide, stageNames, stageOrder, verifiedSide } from '../lib/workspace-client.mjs';
import styles from './WorkspaceUi.module.css';

const stageCopy = {
    PHOTOS: ['The original evidence.', 'The verified Front and Back photographs are the starting point for this card.'],
    IDENTITY: ['A name for every detail.', 'Astra can propose the printed card details from these photographs. Saved proposals appear in the activity feed.'],
    PREPARATION: ['A clear view of the card.', 'The physical boundary guides image preparation. Derived grading images remain linked to these originals.'],
    CENTERING: ['Precision, edge to edge.', 'The grading engine measures the saved printed frame against the physical card boundary.'],
    INSPECTION: ['Every corner. Every edge.', 'Recorded inspections bring the card’s corners, edges and surface into focus.'],
    REPORT: ['The details come together.', 'The grading engine calculates the report. Astra’s completed draft then moves to a human reviewer.'],
};
const safeQuad = value => Array.isArray(value) && value.length === 4 && value.every(point => point && Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1);

export default function AstraStageView({ card, stage = card.stage }) {
    const [side, setSide] = useState('FRONT'), [zoom, setZoom] = useState(false);
    const copy = stageCopy[stage] ?? stageCopy.PHOTOS, source = cardSide(card, side), preparation = card.workspace?.preparation?.[side];
    const identity = card.workspace?.identity ?? card.identity ?? {}, ratios = card.workspace?.centering?.[side]?.ratios;
    const corners = preparation?.sourceCorners ?? preparation?.boundary?.corners ?? preparation?.corners;
    const showBoundary = ['PREPARATION', 'CENTERING', 'INSPECTION'].includes(stage) && safeQuad(corners);
    const sourceSize = Number.isFinite(source?.width) && source.width > 0 && Number.isFinite(source?.height) && source.height > 0 ? { width: source.width, height: source.height } : null;
    const currentStage = card.timing?.currentStage ?? card.stage, isCurrent = stage === currentStage;
    const state = card.observedOperator?.state;
    const status = state === 'NEEDS_ATTENTION' ? 'Needs attention' : !isCurrent ? 'Saved stage view' : state === 'RUNNING' ? 'Astra at work' : state === 'PAUSED' ? 'Astra paused' : state === 'QUEUED' ? 'Astra queued' : 'Recorded workspace';
    const identityFields = [['cardName', 'Card'], ['playerName', 'Player'], ['year', 'Year'], ['manufacturer', 'Manufacturer'], ['productSet', 'Set'], ['parallel', 'Parallel'], ['cardNumber', 'Number']].filter(([key]) => typeof identity[key] === 'string' && identity[key].trim());
    const grades = (card.workspace?.comparison ?? []).filter(entry => ['overall', 'centering', 'corners', 'edges', 'surface'].includes(entry.id)
        && ['string', 'number'].includes(typeof entry.humanValue));
    return <section className={styles.workbench} aria-label={`${stageNames[stage]} evidence workbench`}>
        <div className={styles.workbenchHeading}><div><p>EVIDENCE WORKBENCH <span>{String(stageOrder.indexOf(stage) + 1).padStart(2, '0')} / {stageNames[stage]}</span></p><h2>{copy[0]}</h2></div><span className={`${styles.workbenchStatus} ${state === 'NEEDS_ATTENTION' ? styles.workbenchAttention : ''}`}><i aria-hidden="true" />{status}</span></div>
        <p className={styles.workbenchDescription}>{copy[1]}</p>
        <div className={styles.workbenchViewer}>
            <div className={styles.workbenchToolbar}><span><WorkspaceIcon name="PHOTOS" />Original photograph</span><div className={styles.workbenchSides}>{['FRONT', 'BACK'].map(value => <button type="button" key={value} aria-pressed={side === value} onClick={() => { setSide(value); setZoom(false); }}>{value === 'FRONT' ? 'Front' : 'Back'}</button>)}</div></div>
            <div className={`${styles.workbenchMat} ${zoom ? styles.workbenchZoomed : ''}`}><div className={styles.workbenchMatGrid} aria-hidden="true" /><div className={styles.workbenchImageHolder} style={sourceSize ? { aspectRatio: `${sourceSize.width} / ${sourceSize.height}` } : undefined}>
                <PhotoPreview card={card} side={side} />
                {showBoundary && sourceSize && <svg className={styles.workbenchBoundary} viewBox={`0 0 ${sourceSize.width} ${sourceSize.height}`} aria-label="Saved physical card boundary" role="img"><polygon points={corners.map(point => `${point.x * sourceSize.width},${point.y * sourceSize.height}`).join(' ')} /></svg>}
            </div><span className={styles.workbenchMatLabel}>{side} / ORIGINAL</span></div>
            <div className={styles.workbenchViewerFooter}><span><i aria-hidden="true" />{verifiedSide(card, side) ? 'Verified source · original retained' : 'Awaiting a verified photograph'}</span><div>{sourceSize && <span>{sourceSize.width.toLocaleString()} × {sourceSize.height.toLocaleString()} px</span>}<button type="button" disabled={!verifiedSide(card, side)} onClick={() => setZoom(value => !value)}>{zoom ? 'Fit image' : 'Zoom image'}<WorkspaceIcon name="INSPECTION" /></button></div></div>
        </div>
        <div className={styles.workbenchFacts}>{['FRONT', 'BACK'].map(value => <div key={value}><WorkspaceIcon name={verifiedSide(card, value) ? 'CHECK' : 'PHOTOS'} /><span>{value === 'FRONT' ? 'Front photograph' : 'Back photograph'}<strong>{verifiedSide(card, value) ? 'Verified + saved' : 'Awaiting verification'}</strong></span></div>)}<div><WorkspaceIcon name="REVIEW" /><span>Final authority<strong>Human reviewer</strong></span></div></div>
        {stage === 'IDENTITY' && <div className={styles.workbenchSaved}><div><WorkspaceIcon name="IDENTITY" /><h3>Saved card identity</h3></div>{identityFields.length ? <dl className={styles.workbenchIdentity}>{identityFields.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{identity[key]}</dd></div>)}</dl> : <p>Card details will appear here once they are saved. You can see Astra’s original proposals in the activity feed.</p>}</div>}
        {stage === 'PREPARATION' && <div className={styles.workbenchSaved}><div><WorkspaceIcon name="PREPARATION" /><h3>Image preparation</h3></div><div className={styles.workbenchPreparation}>{['FRONT', 'BACK'].map(value => <p key={value}><span>{value === 'FRONT' ? 'Front' : 'Back'}</span><strong>{({ PREPARED: 'Prepared image saved', PENDING: 'Preparation requested', REQUESTED: 'Preparation requested', FAILED: 'Needs attention', UNKNOWN: 'Awaiting confirmed result' })[card.workspace?.preparation?.[value]?.status] ?? (safeQuad(card.workspace?.preparation?.[value]?.corners) ? 'Boundary saved' : 'No preparation recorded yet')}</strong></p>)}</div></div>}
        {stage === 'CENTERING' && ratios && <div className={styles.workbenchSaved}><div><WorkspaceIcon name="CENTERING" /><h3>Saved centering · {side === 'FRONT' ? 'Front' : 'Back'}</h3></div><dl className={styles.workbenchIdentity}>{Object.entries(ratios).filter(([, value]) => ['string', 'number'].includes(typeof value)).map(([label, value]) => <div key={label}><dt>{label.replace(/([a-z])([A-Z])/g, '$1 $2')}</dt><dd>{value}</dd></div>)}</dl></div>}
        {['INSPECTION', 'REPORT'].includes(stage) && grades.length > 0 && <div className={styles.workbenchSaved}><div><WorkspaceIcon name="REPORT" /><h3>Latest saved grades</h3></div><dl className={styles.workbenchGrades}>{grades.map(entry => <div key={entry.id}><dt>{entry.label}</dt><dd>{entry.humanValue}</dd></div>)}</dl></div>}
        {card.specimenId && <div className={styles.workbenchReport}><p>Explore the saved findings, measurements and original proposals in the report.</p><ReportLink card={card} label="View saved report" /></div>}
    </section>;
}
