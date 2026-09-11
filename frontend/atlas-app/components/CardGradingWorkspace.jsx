import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Notice } from './Shell';
import PhotoIntake from './PhotoIntake';
import WorkspaceActivity from './WorkspaceActivity';
import WorkspaceStages from './WorkspaceStages';
import AstraStageView from './AstraStageView';
import { ImageQuadEditor, fullCardFrame } from './WorkspaceGeometry';
import { OriginalImages, Readiness, RecoveryNotice, ReportLink, StateBadge } from './WorkspaceShared';
import { allowedAction, checkedCardResult, freshWorkspaceAccess, originalImagePath, stageNames, stageOrder, verifiedSide, workspaceCardPath, workspaceMessage, workspaceRequest } from '../lib/workspace-client.mjs';
import { useWorkspaceMutation } from '../lib/useWorkspaceMutation';
import { usePendingNavigation } from '../lib/usePendingNavigation';
import styles from './WorkspaceUi.module.css';

const emptyIdentity = { category: '', playerName: '', cardName: '', year: '', manufacturer: '', productSet: '', parallel: '', insert: '', cardNumber: '', layoutType: '' };
export function identityPayload(values) {
    const fields = values.category === 'POKEMON' ? ['cardName', 'year', 'productSet', 'parallel', 'cardNumber', 'layoutType'] : ['playerName', 'year', 'manufacturer', 'productSet', 'parallel', 'insert', 'cardNumber'];
    return { category: values.category, ...Object.fromEntries(fields.map(key => [key, values[key]?.trim() || null])) };
}
export default function CardGradingWorkspace({ initial, staff, csrf, readiness }) {
    const [card, setCard] = useState(initial), [stage, setStage] = useState(initial.stage), [forms, setForms] = useState({}), [formReady, setFormReady] = useState(false), [localError, setLocalError] = useState(''), [saved, setSaved] = useState(''), [refreshing, setRefreshing] = useState(false);
    const [followLive, setFollowLive] = useState(true);
    const liveStage = card.state === 'HUMAN_REVIEW' ? 'REVIEW' : card.state === 'APPROVED' ? 'FINISHING' : card.timing?.currentStage ?? card.stage;
    useEffect(() => { if (followLive) setStage(liveStage); }, [liveStage, followLive]);
    const formsRef = useRef({}), loadingRef = useRef(false), journalKey = `atlas-workspace-edits-v1:${staff.id}:${initial.id}`;
    const adopt = next => setCard(previous => next?.id === previous.id && next.revision >= previous.revision ? { ...next, timing: next.timing ?? previous.timing } : previous);
    const mutation = useWorkspaceMutation({ staffId: staff.id, cardId: initial.id, csrf, onCard: adopt });
    useEffect(() => {
        try { const value = JSON.parse(sessionStorage.getItem(journalKey) ?? '{}'); formsRef.current = value && typeof value === 'object' && !Array.isArray(value) ? value : {}; setForms(formsRef.current); setFormReady(true); }
        catch { setLocalError('Your saved editor draft could not be opened. Keep this workspace open before making changes.'); }
    }, [journalKey]);
    usePendingNavigation(() => Object.keys(formsRef.current).length > 0, setLocalError);
    function saveForms(next) {
        try { sessionStorage.setItem(journalKey, JSON.stringify(next)); formsRef.current = next; setForms(next); return true; }
        catch { setLocalError('The browser could not save these edits for recovery. Keep this tab open and try again.'); return false; }
    }
    function edit(scope, value) {
        const next = { ...formsRef.current, [scope]: { baseRevision: formsRef.current[scope]?.baseRevision ?? card.revision, value } };
        // Keep the visible edit even if browser persistence is temporarily full.
        if (!saveForms(next)) { formsRef.current = next; setForms(next); }
        setSaved('');
    }
    function discard(scope) { const next = { ...formsRef.current }; delete next[scope]; saveForms(next); }
    const disabled = mutation.busy || Boolean(mutation.pending) || !mutation.ready || !formReady || refreshing;
    async function act(action, payload, scope) {
        if (disabled || !allowedAction(card, action)) return null;
        setLocalError(''); setSaved('');
        const result = await mutation.mutate(`${workspaceCardPath(card.id)}/action`, { expectedRevision: scope && formsRef.current[scope] ? formsRef.current[scope].baseRevision : card.revision, action, payload }, card.id);
        if (result) { if (scope) discard(scope); setSaved('Saved to the card. Earlier evidence and revisions are retained.'); }
        return result;
    }
    async function refresh() {
        if (loadingRef.current || mutation.busy) return;
        loadingRef.current = true; setRefreshing(true); setLocalError('');
        try { const result = await workspaceRequest(workspaceCardPath(card.id)); adopt(result.card); setSaved('Latest saved card loaded. Local edits are kept.'); }
        catch (cause) { setLocalError(workspaceMessage(cause)); }
        finally { loadingRef.current = false; setRefreshing(false); }
    }
    async function recoverSource() {
        const pending = card.workspace?.pending;
        if (!pending || loadingRef.current || mutation.busy || mutation.pending) return;
        loadingRef.current = true; setRefreshing(true); setLocalError('');
        try {
            const access = await freshWorkspaceAccess();
            const result = await workspaceRequest(`${workspaceCardPath(card.id)}/recover`, { body: { requestId: pending.requestId }, csrf: access.csrf });
            const next = checkedCardResult(result, { cardId: card.id, body: { operationId: pending.operationId, expectedRevision: card.revision } });
            adopt(next); setSaved(next.workspace?.pending ? 'The saved operation is still awaiting its recorded result.' : 'The saved operation result is now confirmed.');
        } catch (cause) { setLocalError(workspaceMessage(cause)); }
        finally { loadingRef.current = false; setRefreshing(false); }
    }
    async function claim(operator, mode = 'CONTINUOUS') {
        if (disabled || Object.keys(formsRef.current).length || card.capabilities?.[operator === 'HUMAN' ? 'humanClaim' : 'astraClaim'] !== true) return;
        const next = await mutation.mutate(`${workspaceCardPath(card.id)}/claim`, { expectedRevision: card.revision, operator, ...(operator === 'ASTRA' ? { mode } : {}) }, card.id);
        if (next) { setStage(next.stage); setSaved(operator === 'HUMAN' ? 'You have claimed this card for manual grading.' : 'Astra has claimed this card. Recorded activity appears alongside the workspace.'); }
    }
    async function control(action) {
        if (disabled || Object.keys(formsRef.current).length) return;
        await mutation.mutate(`${workspaceCardPath(card.id)}/control`, { expectedRevision: card.revision, action }, card.id);
    }
    async function reviewSession(action) {
        if (disabled || Object.keys(formsRef.current).length) return;
        await mutation.mutate(`${workspaceCardPath(card.id)}/review-session`, { expectedRevision: card.revision, action }, card.id);
    }
    const common = { card, forms, edit, act, discard, disabled };
    const watchAstra = card.operator?.kind === 'ASTRA' && !['REVIEW', 'FINISHING'].includes(stage);
    const operatorLabel = card.state === 'HUMAN_REVIEW' ? card.workspace?.reviewSession?.state === 'ACTIVE' ? `${card.workspace.reviewSession.reviewerName} is reviewing this card` : 'Ready for human review'
        : card.state === 'APPROVED' ? 'Human review complete'
            : card.operator?.kind === 'ASTRA' ? ({ NEEDS_ATTENTION: 'Astra needs attention', PAUSED: 'Astra is paused', QUEUED: 'Astra is preparing to start' })[card.observedOperator?.state] ?? 'Astra is operating this card'
                : card.operator ? `${card.operator.name || 'A human grader'} is operating this card` : card.state === 'WAITING' ? 'Ready for a grader' : 'No active grader';
    return <>
        <div className={styles.workspaceHeading}><div><Link className="back-link" href={`/grading?queue=${card.state}`}>← Back to {card.state === 'WAITING' ? 'Waiting to grade' : 'grading queues'}</Link><h1>{card.title}</h1><p className="muted">{card.subtitle || 'New-photo grading workspace'}</p></div><div className={styles.workspaceStatus}><StateBadge state={card.state} /><span>Saved revision {card.revision}</span><button type="button" onClick={refresh} disabled={disabled}>{refreshing ? 'Loading…' : 'Refresh saved card'}</button></div></div>
        {card.attention && <Notice error>{typeof card.attention === 'string' ? card.attention : card.attention.message}</Notice>}
        <div className={styles.claimBar}><div><strong>{operatorLabel}</strong><p>{card.operator ? `Recorded stage: ${stageNames[liveStage]}. You may view every stage without taking control.` : card.state === 'WAITING' ? 'One operator can claim this exact photo pair at a time.' : 'Complete and verify the photo pair before claiming it.'}</p></div>{card.state === 'WAITING' && <div className={styles.actions}><button className="primary" type="button" disabled={disabled || card.capabilities?.humanClaim !== true} onClick={() => claim('HUMAN')}>Grade this card</button><button className="primary" type="button" disabled={disabled || card.capabilities?.astraClaim !== true} onClick={() => claim('ASTRA')}>Start Astra <span>→</span></button><button type="button" disabled={disabled || card.capabilities?.astraClaim !== true} onClick={() => claim('ASTRA', 'STEP')}>Step mode</button></div>}</div>
        <RecoveryNotice mutation={mutation} />{localError && <Notice error>{localError}</Notice>}{saved && <Notice>{saved}</Notice>}
        {card.workspace?.pending && <div className={styles.recovery}><strong>{({ PREPARE_SIDE: 'Image preparation', INITIALIZE_REPORT: 'Report initialization', RESOLVE_MAP: 'Card map lookup', REGISTER_MAP: 'Card map registration', CONTINUE_WITHOUT_MAP: 'Your map review decision' })[card.workspace.pending.action] ?? 'Grading'} has a saved operation awaiting confirmation.</strong><p>The current request remains held until its result settles. Checking its saved result does not start another grading attempt.</p><button type="button" disabled={refreshing || mutation.busy || Boolean(mutation.pending)} onClick={recoverSource}>{refreshing ? 'Checking saved result…' : 'Check saved result'}</button></div>}
        <WorkspaceStages card={{ ...card, stage: liveStage }} selectedStage={stage} onSelectStage={value => { setFollowLive(false); setStage(value); }} followLive={followLive} onFollowLiveChange={setFollowLive} />
        <div className={styles.workspaceLayout}><div className={styles.stageContent}>
            {watchAstra ? <AstraStageView card={card} stage={stage} /> : <>
            {stage === 'PHOTOS' && (['DRAFT', 'NEEDS_ATTENTION'].includes(card.state) && staff.role !== 'OBSERVER' ? <PhotoIntake staff={staff} focusCard={card} onCardUpdated={adopt} /> : <><OriginalImages card={card} /><p className={styles.help}>The original Front and Back are retained unchanged. A replacement evidence request must settle active grading first.</p></>)}
            {stage === 'IDENTITY' && <IdentityStage {...common} />}
            {stage === 'PREPARATION' && <PreparationStage {...common} />}
            {stage === 'CENTERING' && <CenteringStage {...common} />}
            {stage === 'INSPECTION' && <section className={styles.panel}><p className="eyebrow">MANUAL INSPECTION</p><h2>Inspect corners, edges and surface</h2><p className={styles.help}>The grading report provides the saved findings, original pixel traces, defect-type corrections and deterministic remeasurement tools.</p><OriginalImages card={card} />{card.specimenId ? <ReportLink card={card} label="Open finding and trace tools" /> : <><MapReview {...common} /><p className={styles.help}>Finish image preparation, centering and the card map check, then initialize the report to inspect and correct findings. Astra is optional.</p><button className="primary" type="button" disabled={disabled || Object.keys(forms).length > 0 || !allowedAction(card, 'INITIALIZE_REPORT')} onClick={() => act('INITIALIZE_REPORT', {})}>Initialize grading report <span>→</span></button></>}</section>}
            {stage === 'REPORT' && <section className={styles.panel}><p className="eyebrow">GRADING DRAFT</p><h2>Prepare the report for human review</h2><p className={styles.help}>Open the current report to inspect the computed grades, correct findings and complete the review checklist. Saving it as ready moves the same card into Human review.</p><ReportLink card={card} />{!card.specimenId && <MapReview {...common} />}{!card.specimenId && <button className="primary" type="button" disabled={disabled || Object.keys(forms).length > 0 || !allowedAction(card, 'INITIALIZE_REPORT')} onClick={() => act('INITIALIZE_REPORT', {})}>Initialize grading report <span>→</span></button>}<p className={styles.help}>Scores come from the existing grading engine. Original machine proposals and each saved human correction remain available for comparison.</p><ReportComparison comparison={card.workspace?.comparison} /></section>}
            </>}
            {stage === 'REVIEW' && <section className={styles.panel}><p className="eyebrow">FINAL HUMAN REVIEW</p><h2>Correct and approve the exact report</h2><p className={styles.help}>Review the card identity, both evidence sides, findings and calculated grades. Any correction creates a new saved revision for your approval.</p>{card.state === 'HUMAN_REVIEW' && staff.role === 'REVIEWER' && <div className={styles.actions}>{card.workspace?.reviewSession?.state === 'ACTIVE' ? <><span>Review in progress · {card.workspace.reviewSession.reviewerName}</span>{card.workspace.reviewSession.reviewerId === staff.id && <button type="button" disabled={disabled} onClick={() => reviewSession('PAUSE')}>Pause review timer</button>}</> : <button className="primary" type="button" disabled={disabled} onClick={() => reviewSession('START')}>{card.workspace?.reviewSession ? 'Resume review' : 'Pick up for review'} <span>→</span></button>}</div>}<ReportLink card={card} label="Open exact report review" /><p className={styles.help}>Report publication requires an explicit trained human approval. A finished Astra run does not approve the report or any trusted-learning change.</p></section>}
            {stage === 'FINISHING' && <section className={styles.panel}><p className="eyebrow">AFTER HUMAN APPROVAL</p><h2>Label, NFC and slab finishing</h2><p className={styles.help}>Open the approved report’s finishing workspace to print the associated label and follow the MacBook NFC and physical assembly steps.</p><ReportLink card={card} label="Open report and finishing" /><p className={styles.help}>The recorded approval, tag verification and human assembly confirmations track separate parts of the physical card’s completion.</p></section>}
            <Readiness readiness={readiness ?? card.readiness} />
        </div><WorkspaceActivity card={{ ...card, stage: liveStage }} disabled={disabled || Object.keys(forms).length > 0} onControl={control} onObservedCard={adopt} /></div>
    </>;
}
function LocalDraftNotice({ scope, card, forms, discard }) {
    if (!forms[scope]) return null;
    return <div className={styles.localDraft}><p>{forms[scope].baseRevision === card.revision ? 'Local edits are saved on this browser. Save them to update the card.' : 'The saved card changed after these edits began. Your local edits are kept; compare the saved outline or values before continuing.'}</p><button type="button" onClick={() => discard(scope)}>Use latest saved values</button></div>;
}
export function IdentityStage({ card, forms, edit, act, discard, disabled }) {
    const scope = 'identity', values = { ...emptyIdentity, cornerShape: card.workspace?.cornerShape ?? 'ROUNDED_3_18_MM', ...(forms[scope]?.value ?? card.workspace?.identity ?? card.identity) }, canEdit = !disabled && allowedAction(card, 'SAVE_IDENTITY');
    const pokemon = values.category === 'POKEMON', fields = pokemon ? [['cardName', 'Card name'], ['year', 'Year'], ['productSet', 'Product / set'], ['parallel', 'Parallel / variant'], ['cardNumber', 'Card number']] : [['playerName', 'Player name'], ['year', 'Year'], ['manufacturer', 'Manufacturer'], ['productSet', 'Product / set'], ['insert', 'Insert / subset'], ['parallel', 'Parallel / variant'], ['cardNumber', 'Card number']];
    const update = (field, value) => edit(scope, { ...values, [field]: value });
    return <section className={styles.panel}><p className="eyebrow">CARD IDENTITY</p><h2>Confirm what is printed on the card</h2><p className={styles.help}>Use the physical card and original photographs. Names are entered by the human grader and remain separate from Astra’s proposals.</p><OriginalImages card={card} /><form onSubmit={event => { event.preventDefault(); if (canEdit && forms[scope]?.baseRevision === card.revision) act('SAVE_IDENTITY', { identity: identityPayload(values), cornerShape: values.cornerShape }, scope); }}><fieldset disabled={!canEdit}><div className={styles.formGrid}><label>Card type<select required value={values.category} onChange={event => update('category', event.target.value)}><option value="">Choose type</option><option value="SPORTS">Sports</option><option value="POKEMON">Pokémon</option></select></label><label>Physical card corners<select required value={values.cornerShape} onChange={event => update('cornerShape', event.target.value)}><option value="ROUNDED_3_18_MM">Rounded · 3.18 mm</option><option value="SQUARE">Square</option></select></label>{fields.map(([field, label]) => <label key={field}>{label}<input value={values[field] ?? ''} maxLength={160} required={['cardName', 'playerName', 'year', 'manufacturer', 'productSet'].includes(field)} onChange={event => update(field, event.target.value)} /></label>)}{pokemon && <label>Printed layout<select required value={values.layoutType ?? ''} onChange={event => update('layoutType', event.target.value)}><option value="">Choose layout</option><option value="POKEMON">Pokémon</option><option value="TRAINER">Trainer</option><option value="ENERGY">Energy</option></select></label>}</div><button className="primary" type="submit" disabled={!forms[scope] || forms[scope].baseRevision !== card.revision}>Save confirmed identity <span>→</span></button></fieldset></form><LocalDraftNotice scope={scope} card={card} forms={forms} discard={discard} />{!canEdit && <p className={styles.help}>Claim the card for manual grading, or take over at a settled boundary, to edit its identity.</p>}</section>;
}
export function PreparationStage({ card, forms, edit, act, discard, disabled }) {
    const [side, setSide] = useState('FRONT'), [imageReady, setImageReady] = useState(false), scope = `boundary:${side}`;
    const saved = card.workspace?.preparation?.[side] ?? {}, boundary = saved.boundary ?? saved, values = forms[scope]?.value ?? { corners: boundary.corners ?? [], matColor: boundary.matColor ?? 'BLACK' }, canEdit = !disabled && allowedAction(card, 'SAVE_BOUNDARY');
    return <section className={styles.panel}><div className={styles.panelHeading}><div><p className="eyebrow">IMAGE PREPARATION</p><h2>Mark the physical card boundary</h2></div><div className={styles.segmented}>{['FRONT', 'BACK'].map(value => <button type="button" key={value} aria-pressed={side === value} onClick={() => setSide(value)}>{value === 'FRONT' ? 'Front' : 'Back'}</button>)}</div></div><p className={styles.help}>Place the four handles at the physical card corners, clockwise from top left. The original remains unchanged; preparation creates a derived grading image.</p><ImageQuadEditor key={side} imageUrl={verifiedSide(card, side) ? originalImagePath(card.id, side) : null} points={values.corners} savedPoints={boundary.corners} disabled={!canEdit} onChange={corners => edit(scope, { ...values, corners })} onReady={setImageReady} label={`${side === 'FRONT' ? 'Front' : 'Back'} physical card boundary`} /><div className={styles.preparationOptions}><label>Background mat<select value={values.matColor} disabled={!canEdit} onChange={event => edit(scope, { ...values, matColor: event.target.value })}><option value="BLACK">Black</option><option value="WHITE">White</option><option value="MAGENTA">Magenta</option></select></label>{saved.orientation && <p>Recorded photo orientation: {saved.orientation}</p>}<p>Preparation: {saved.status ? saved.status.toLowerCase().replaceAll('_', ' ') : 'Not prepared'}</p></div><div className={styles.actions}><button type="button" disabled={!canEdit || !imageReady || values.corners.length !== 4 || !forms[scope] || forms[scope].baseRevision !== card.revision} onClick={() => act('SAVE_BOUNDARY', { side, corners: values.corners, matColor: values.matColor }, scope)}>Save card boundary</button><button className="primary" type="button" disabled={disabled || Boolean(forms[scope]) || !allowedAction(card, 'PREPARE_SIDE')} onClick={() => act('PREPARE_SIDE', { side })}>Prepare {side.toLowerCase()} image <span>→</span></button></div><LocalDraftNotice scope={scope} card={card} forms={forms} discard={discard} />{!allowedAction(card, 'PREPARE_SIDE') && <p className={styles.help}>Preparation will be available when this boundary and the approved image service are ready. Saved photos and manual boundary edits remain recoverable.</p>}</section>;
}
function ReportComparison({ comparison }) {
    const entries = Array.isArray(comparison) ? comparison.filter(entry => entry && typeof entry.label === 'string' && ['string', 'number'].includes(typeof entry.machineValue) && ['string', 'number'].includes(typeof entry.humanValue)) : [];
    if (!entries.length) return null;
    return <section className={styles.reportComparison}><h3>Original machine result and human correction</h3><table><thead><tr><th scope="col">Report item</th><th scope="col">Machine result</th><th scope="col">Human correction</th></tr></thead><tbody>{entries.map(entry => <tr key={entry.id}><th scope="row">{entry.label}</th><td>{entry.machineValue}</td><td>{entry.humanValue}</td></tr>)}</tbody></table><p className={styles.help}>Values shown are saved results. Corrections do not change trusted learning without its separate approval.</p></section>;
}
export function CenteringStage({ card, forms, edit, act, discard, disabled }) {
    const [side, setSide] = useState('FRONT'), [imageReady, setImageReady] = useState(false), scope = `centering:${side}`;
    const preparation = card.workspace?.preparation?.[side] ?? {}, saved = card.workspace?.centering?.[side] ?? {}, values = forms[scope]?.value ?? { inner: saved.inner ?? [], confirmed: false }, canEdit = !disabled && allowedAction(card, 'SAVE_CENTERING');
    const preparedUrl = preparation.status === 'PREPARED' && typeof preparation.imageUrl === 'string' && preparation.imageUrl.startsWith('/admin/api/staff/') ? preparation.imageUrl : null;
    return <section className={styles.panel}><div className={styles.panelHeading}><div><p className="eyebrow">CENTERING</p><h2>Review the printed frame</h2></div><div className={styles.segmented}>{['FRONT', 'BACK'].map(value => <button type="button" key={value} aria-pressed={side === value} onClick={() => setSide(value)}>{value === 'FRONT' ? 'Front' : 'Back'}</button>)}</div></div><p className={styles.help}>Mark the inner printed frame on the rectified card image. The outside edge is fixed to the prepared full card; the existing grading engine measures the confirmed frame.</p><ImageQuadEditor key={side} imageUrl={preparedUrl} points={values.inner} savedPoints={saved.inner} fixedOuter disabled={!canEdit} onChange={inner => edit(scope, { ...values, inner, confirmed: false })} onReady={setImageReady} label={`${side === 'FRONT' ? 'Front' : 'Back'} prepared image and printed frame`} />{saved.ratios && <div className={styles.measurements}><h3>Saved centering measurements</h3>{Object.entries(saved.ratios).filter(([, value]) => typeof value === 'string' || typeof value === 'number').map(([label, value]) => <p key={label}><span>{label.replace(/([a-z])([A-Z])/g, '$1 $2')}</span><strong>{value}</strong></p>)}</div>}{saved.summary && <p className={styles.help}>{saved.summary}</p>}<label className={styles.check}><input type="checkbox" checked={values.confirmed} disabled={!canEdit || !imageReady || values.inner.length !== 4} onChange={event => edit(scope, { ...values, confirmed: event.target.checked })} /><span>I reviewed the printed frame against this prepared image.</span></label><button className="primary" type="button" disabled={!canEdit || !imageReady || !values.confirmed || values.inner.length !== 4 || !forms[scope] || forms[scope].baseRevision !== card.revision} onClick={() => act('SAVE_CENTERING', { side, outer: fullCardFrame, inner: values.inner, confirmed: true }, scope)}>Save and measure centering <span>→</span></button><LocalDraftNotice scope={scope} card={card} forms={forms} discard={discard} /></section>;
}

export function MapReview({ card, forms, act, disabled }) {
    const map = card.workspace?.map, pending = Boolean(card.workspace?.pending), automatic = useRef('');
    const [choice, setChoice] = useState({ revision: card.revision, confirmed: false });
    const held = disabled || pending || Object.keys(forms).length > 0;
    useEffect(() => {
        const action = !map && allowedAction(card, 'RESOLVE_MAP') ? 'RESOLVE_MAP'
            : map?.status === 'LOADED' && map.canRegister && ['FRONT', 'BACK'].every(side => map.registration?.[side] === 'MISSING')
                && allowedAction(card, 'REGISTER_MAP') ? 'REGISTER_MAP' : null;
        const key = `${card.id}:${card.revision}:${action}`;
        if (!held && action && automatic.current !== key) { automatic.current = key; act(action, {}); }
    }, [card, held, map, act]);
    const messages = {
        NO_MAP: 'No eligible Exact or Family card map exists for this identity. You can continue with the original grading workflow.',
        LOADED: map?.bindingReady ? 'Both photographs are registered to the saved card map.' : 'The saved card map must register to the Front and Back photographs before grading.',
        APPLIED: 'The saved card map is bound to this capture.',
        LOOKUP_FAILED: 'The card map lookup failed and the failure was recorded. Retry the lookup, or explicitly choose human review without the map.',
        REGISTRATION_BLOCKED: 'Card map registration failed and the failure was recorded. Retry registration, or explicitly choose human review without applying the map.',
        INTEGRITY_ERROR: 'The saved card map could not be verified. Correct the map authority issue before continuing.',
        HUMAN_REVIEW_WITHOUT_MAP: 'Your explicit human review decision is recorded. Grading will continue without applying a card map; the original failure remains in its history.',
    };
    const consent = card.operator?.kind === 'HUMAN' && allowedAction(card, 'CONTINUE_WITHOUT_MAP');
    const canResolve = allowedAction(card, 'RESOLVE_MAP'), canRegister = allowedAction(card, 'REGISTER_MAP');
    return <section className={styles.mapReview} aria-label="Card map check"><h3>Card map check</h3>
        <p className={styles.help}>{map ? messages[map.status] ?? 'The saved map result needs review.'
            : canResolve ? 'Checking the original card map for the confirmed identity…' : 'The original card map is checked after both prepared images and centering measurements are saved.'}</p>
        {map?.status === 'LOADED' && !map.bindingReady && !map.canRegister && <p className={styles.help}>Card map registration is awaiting its approved image service.</p>}
        {map?.name && <p><strong>{map.name}</strong>{map.scope === 'EXACT' ? ' · Exact map' : map.scope === 'FAMILY' ? ' · Family map' : ''}{map.version ? ` · Version ${map.version}` : ''}</p>}
        {map && ['LOADED', 'REGISTRATION_BLOCKED', 'APPLIED'].includes(map.status) && <p className={styles.help}>{['FRONT', 'BACK'].map(side => `${side === 'FRONT' ? 'Front' : 'Back'}: ${({ MISSING: 'awaiting registration', REGISTERED: 'registered', FAILED: 'registration failed', UNKNOWN: 'awaiting saved result' })[map.registration?.[side]] ?? 'awaiting registration'}`).join(' · ')}</p>}
        <div className={styles.actions}>{map && canResolve && <button type="button" disabled={held} onClick={() => act('RESOLVE_MAP', {})}>{map.status === 'LOOKUP_FAILED' ? 'Retry card map lookup' : 'Check card map again'}</button>}
            {canRegister && <button type="button" disabled={held} onClick={() => act('REGISTER_MAP', {})}>{map?.status === 'REGISTRATION_BLOCKED' ? 'Retry card map registration' : 'Register card map'}</button>}</div>
        {consent && <div className={styles.recovery}><label className={styles.check}><input type="checkbox" checked={choice.revision === card.revision && choice.confirmed} disabled={held}
            onChange={event => setChoice({ revision: card.revision, confirmed: event.target.checked })} /><span>I reviewed the recorded map failure and choose human review without applying a card map.</span></label>
            <button type="button" disabled={held || choice.revision !== card.revision || !choice.confirmed}
                onClick={() => { if (!held && choice.revision === card.revision && choice.confirmed) act('CONTINUE_WITHOUT_MAP', { confirmed: true }); }}>Save decision and continue without map</button></div>}
    </section>;
}
