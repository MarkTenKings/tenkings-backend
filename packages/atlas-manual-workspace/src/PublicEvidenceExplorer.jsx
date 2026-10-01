import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReportInspectionImage } from './ReportInspectionImage.jsx';
import { ApprovedWholeCard } from './ApprovedWholeCard.jsx';
import { EdgeTourControls, EvidenceEdgeScan } from './ReportEvidenceScan.jsx';
import { createEvidenceMotion } from './evidence-scan-motion.mjs';
import { createEdgeTour, sampleEdgeTour } from './evidence-edge-tour.mjs';
import { createCornerTour } from './evidence-corner-tour.mjs';
import { reportSpatialNavigation, reportCategoryNavigation } from './report-spatial-navigation.mjs';

const SIDES = ['FRONT', 'BACK'];
const CATEGORIES = ['corners', 'edges', 'surface'];
const NO_LAYERS = { physical: false, printed: false, centering: false };
const CENTERING_LAYERS = { physical: true, printed: true, centering: true };
const PRINT_LAYERS = { physical: true, printed: true, centering: false };
const title = value => String(value ?? '').toLowerCase().replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase());
const number = value => Number.isFinite(value)
  ? Math.abs(value) > 0 && Math.abs(value) < .0001 ? value.toExponential(2)
    : value.toLocaleString('en-US', { maximumFractionDigits: 4 }) : 'Unavailable';
const ratio = values => Array.isArray(values) && values.length === 2 && values.every(Number.isFinite)
  ? `${number(values[0])}% / ${number(values[1])}%` : 'Unavailable';
const media = query => typeof window !== 'undefined' && Boolean(window.matchMedia?.(query).matches);
const categoryCopy = { corners: 'Inspect all four corners on both sides.', edges: 'Follow the complete perimeter on both sides.', surface: 'Inspect the whole card face, including its border.' };

/** Public presentation only. Both hash-bound image viewers remain mounted across
 * every mode, responsive change and print. Filtering never renumbers evidence. */
export function PublicEvidenceExplorer({ report, explanation, images, geometry, selected, activeSide,
  onSelect, onClear, onChooseSide, onReady, sideReady, findingDetails, gradeCalculation, printing = false, publication }) {
  const navigation = useMemo(() => reportSpatialNavigation(report.findings), [report.findings]);
  const sideFindings = useMemo(() => Object.fromEntries(SIDES.map(side => [side,
    report.findings.filter(finding => finding.side === side)])), [report.findings]);
  const [section, setSection] = useState(selected?.id ? 'finding' : 'whole');
  const [returnSection, setReturnSection] = useState('whole');
  const scanView = ['edges', 'corners'].includes(section);
  const edgePlan = useMemo(() => createEdgeTour(report.findings), [report.findings]);
  const cornerPlan = useMemo(() => createCornerTour(report.findings), [report.findings]);
  const scanPlan = section === 'corners' ? cornerPlan : edgePlan;
  const motionController = useMemo(() => createEvidenceMotion(), []);
  const tourHold = useRef(null);
  const [mobile, setMobile] = useState(() => media('(max-width: 980px)'));
  const [reduced, setReduced] = useState(() => media('(prefers-reduced-motion: reduce)'));
  const [lastFinding, setLastFinding] = useState({ FRONT: null, BACK: null });
  const [overlays, setOverlays] = useState(true);
  const [wholeControls, setWholeControls] = useState({ playing: true, original: false, center: true, sequence: 0 });
  const returnControl = useRef(null);
  const wholeMotionState = useRef({ centering: 0, defects: {} });
  const [verifiedPhotos, setVerifiedPhotos] = useState({});
  const verifiedPhoto = useCallback((side, url, sha256) => setVerifiedPhotos(old => {
    if (!url && old[side]?.sha256 !== sha256) return old;
    return old[side]?.url === url && old[side]?.sha256 === sha256 ? old : { ...old, [side]: { url, sha256 } };
  }), []);
  const currentPhotos = Object.fromEntries(SIDES.map(side => [side, verifiedPhotos[side]?.sha256 === report.inspection?.[side.toLowerCase()]?.imageSha256 ? verifiedPhotos[side].url : null]));
  const wholeReady = section === 'whole' && !printing && SIDES.every(side => currentPhotos[side]);
  const [fingerprintCommand, setFingerprintCommand] = useState(null);
  const [command, setCommand] = useState(null), [zooms, setZooms] = useState({ FRONT: 1, BACK: 1 });
  const [tour, setTour] = useState(null), [arrival, setArrival] = useState(false);
  const tourTimer = useRef(null), arrivalTimer = useRef(null), arrived = useRef(false), interrupted = useRef(false);
  const findingNavigator = useRef(null), explorer = useRef(null);
  const current = navigation.entries.find(entry => entry.id === selected?.id);
  const category = CATEGORIES.includes(section) ? section : section === 'finding' && CATEGORIES.includes(returnSection) ? returnSection : null;
  const scopePlan = category === 'corners' ? cornerPlan : category === 'edges' ? edgePlan : null;
  const scoped = useMemo(() => {
    if (!scopePlan) return reportCategoryNavigation(navigation, category);
    const ids = new Set(scopePlan.hits.map(hit => hit.finding.id));
    return { entries: navigation.entries.filter(entry => ids.has(entry.id)), neighborhoods: [] };
  }, [navigation, category, scopePlan]);
  const entries = scoped.entries.filter(entry => entry.finding.side === activeSide);
  const otherSide = activeSide === 'FRONT' ? 'BACK' : 'FRONT';
  const otherEntries = scoped.entries.filter(entry => entry.finding.side === otherSide);
  const position = scoped.entries.findIndex(entry => entry.id === selected?.id);
  const ready = sideReady(activeSide), bothReady = SIDES.every(sideReady), zoom = zooms[activeSide];
  const shown = section === 'finding' ? current : null;
  const paired = !mobile && !['finding', 'science'].includes(section) && !printing;
  const visibleSides = paired || printing ? SIDES : [activeSide];
  const stopMotion = useCallback(() => {
    motionController.pause();
    clearTimeout(tourTimer.current); clearTimeout(arrivalTimer.current);
    tourTimer.current = null; arrivalTimer.current = null;
    setTour(null); setArrival(false); interrupted.current = true;
  }, [motionController]);
  useEffect(() => {
    const small = window.matchMedia?.('(max-width: 980px)'), motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const resize = () => { setMobile(Boolean(small?.matches)); stopMotion(); };
    const reduce = () => { setReduced(Boolean(motion?.matches)); stopMotion(); };
    small?.addEventListener?.('change', resize); motion?.addEventListener?.('change', reduce);
    return () => { small?.removeEventListener?.('change', resize); motion?.removeEventListener?.('change', reduce); clearTimeout(tourTimer.current); clearTimeout(arrivalTimer.current); };
  }, [stopMotion]);
  useEffect(() => { if (printing || selected?.id) stopMotion(); }, [printing, selected?.id, stopMotion]);
  useEffect(() => () => motionController.dispose(), [motionController]);
  useEffect(() => {
    motionController.configure({ reduced, progress: 0, durationMs: scanPlan.duration * 1000, linear: true });
    tourHold.current = null;
    if (scanView && bothReady && !reduced && !printing && typeof document !== 'undefined') motionController.play();
    return () => motionController.pause();
  }, [section, reduced, scanPlan, scanView, bothReady, printing, motionController]);
  useEffect(() => {
    if (!scanView) return;
    return motionController.subscribe(state => {
      const sample = (scanPlan.sample ?? sampleEdgeTour)(scanPlan, state.progress);
      if (['focus', 'inspect'].includes(sample.kind) && sample.finding && tourHold.current !== sample.finding.id) {
        tourHold.current = sample.finding.id; if (mobile) onChooseSide(sample.finding.side);
      } else if (!['focus', 'inspect'].includes(sample.kind)) tourHold.current = null;
    });
  }, [scanView, scanPlan, mobile, motionController, onChooseSide]);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const pauseHidden = () => { if (document.hidden) motionController.pause(); };
    document.addEventListener('visibilitychange', pauseHidden);
    return () => document.removeEventListener('visibilitychange', pauseHidden);
  }, [motionController]);
  useEffect(() => {
    if (!bothReady || printing || arrived.current || selected?.id || reduced || interrupted.current) return;
    arrived.current = true; setArrival(true);
    arrivalTimer.current = setTimeout(() => setArrival(false), 1100);
  }, [bothReady, printing, selected?.id, reduced]);
  useEffect(() => {
    if (section === 'finding') {
      findingNavigator.current?.scrollIntoView?.({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
      findingNavigator.current?.querySelector?.('select')?.focus?.({ preventScroll: true });
    }
  }, [section, reduced]);
  const returnFromFingerprint = useCallback(() => setSection('whole'), []);
  const tide = type => { stopMotion(); setFingerprintCommand(old => ({ type, sequence: (old?.sequence ?? 0) + 1 })); };
  const remember = useCallback(entry => {
    const side = entry.finding.side;
    setLastFinding(old => old[side] === entry.id ? old : { ...old, [side]: entry.id });
  }, []);
  useEffect(() => {
    if (!current) return;
    setSection('finding'); remember(current);
  }, [current, selected?.sequence, remember]);
  const sendView = (type, value, side = activeSide) => setCommand(old => ({ type, zoom: value, side, sequence: (old?.sequence ?? 0) + 1 }));
  const fitBoth = () => setCommand(old => ({ type: 'FIT', side: 'BOTH', sequence: (old?.sequence ?? 0) + 1 }));
  const viewChanged = useCallback((side, value) => setZooms(old => old[side] === value ? old : { ...old, [side]: value }), []);
  const selectFinding = finding => {
    const entry = scoped.entries.find(value => value.id === finding?.id);
    if (!entry || !sideReady(entry.finding.side)) return;
    if (section === 'whole' && typeof document !== 'undefined') returnControl.current = { id: entry.id, callout: Boolean(document.activeElement?.closest?.('.fc-label')) };
    stopMotion(); if (section !== 'finding') setReturnSection(section);
    remember(entry); setSection('finding');
    if (entry.finding.side !== activeSide) onChooseSide(entry.finding.side);
    onSelect(entry.finding);
  };
  const chooseSide = side => {
    stopMotion(); if (side === activeSide) return;
    onClear(); onChooseSide(side); setSection(section === 'finding' ? returnSection : section);
    if (section === 'fingerprint') tide('REVEAL');
    sendView('FIT', undefined, side);
  };
  const chooseSection = next => {
    stopMotion();
    if (next === 'finding') {
      const target = entries.find(entry => entry.id === lastFinding[activeSide]) ?? entries[0]
        ?? otherEntries.find(entry => entry.id === lastFinding[otherSide]) ?? otherEntries[0];
      if (target) selectFinding(target.finding);
      return;
    }
    setSection(next); onClear(); fitBoth();
    if (next === 'fingerprint') tide('REVEAL');
  };
  const returnToOverview = () => {
    chooseSection(returnSection);
    const target = returnControl.current;
    setTimeout(() => Array.from(explorer.current?.querySelectorAll?.(target?.callout ? '.fc-label[data-finding-id]' : '[data-finding-id]') ?? []).find(node => node.dataset.findingId === (target?.id ?? selected?.id))?.focus?.({ preventScroll: true }), 0);
  };
  const playTour = () => {
    stopMotion(); onClear(); fitBoth(); setOverlays(true);
    if (reduced) { setSection('centering'); return; }
    const steps = ['centering', 'corners', 'edges', 'surface']; let index = 0;
    const advance = () => {
      if (index === steps.length) { setTour(null); setSection('whole'); return; }
      const next = steps[index++]; setTour(`${index} / ${steps.length} · ${title(next)}`); setSection(next);
      tourTimer.current = setTimeout(advance, 2400);
    };
    advance();
  };
  const replayArrival = () => {
    stopMotion(); onClear(); fitBoth(); setSection('whole');
    if (!reduced) { setArrival(true); arrivalTimer.current = setTimeout(() => setArrival(false), 1100); }
  };
  const previous = position > 0 ? scoped.entries[position - 1] : null;
  const next = scoped.entries[position + 1];
  const hint = section === 'fingerprint' ? 'Your photograph stays in view as gold contours grow from the saved defects.'
    : section === 'centering' ? 'Compare each saved printed border with the physical card edge. Select a measurement to emphasize its ruler.'
    : shown ? 'The marked and unmarked views show the same saved pixels, zoom and position.'
    : category ? `${categoryCopy[category]} Red traces are the recorded findings; guide outlines are inspection regions.`
    : navigation.entries.length ? 'Both sides. Every finding. Select a shape or label to inspect its exact trace.'
    : 'No included damage findings. Explore the photographs or centering.';
  const findingNavigation = scoped.entries.length > 0 && <nav className="rr-public-finding-navigation" ref={findingNavigator} aria-label="Finding navigator">
    {section === 'finding' && <div className="rr-public-return"><button type="button" onClick={returnToOverview}>← {returnSection === 'whole' ? 'Whole card' : title(returnSection)}</button><button type="button" onClick={() => chooseSection('centering')}>View centering</button></div>}
    <label>{category ? `${title(category)} findings` : 'All findings'}<select aria-label="All findings" value={shown?.id ?? ''} onChange={event => selectFinding(scoped.entries.find(entry => entry.id === event.target.value)?.finding)}>
      <option value="">Choose a finding</option>{scoped.entries.map(entry => <option key={entry.id} value={entry.id} disabled={!sideReady(entry.finding.side)}>{entry.label} · {title(entry.finding.defectType)}</option>)}
    </select></label>
    <div className="rr-public-browse"><button type="button" disabled={!previous || !sideReady(previous.finding.side)} onClick={() => selectFinding(previous?.finding)}>← Previous</button>
      <span>{shown ? `${position + 1} of ${scoped.entries.length}` : `${scoped.entries.length} findings`}</span>
      <button type="button" disabled={!next || !sideReady(next.finding.side)} onClick={() => selectFinding(next?.finding)}>Next →</button></div>
  </nav>;

  return <section className={`rr-public-explorer${arrival ? ' rr-public-arrival' : ''}`} ref={explorer} data-section={section} data-paired={paired} data-compact={mobile} data-printing={printing} aria-label="Explore approved report evidence" onKeyDown={event => {
    if (event.altKey || event.ctrlKey || event.metaKey || /INPUT|TEXTAREA|SELECT/.test(event.target?.tagName ?? '') || event.target?.isContentEditable) return;
    if (event.key === '[' || event.key === ']') {
      event.preventDefault(); event.stopPropagation();
      const target = event.key === '[' ? previous : next;
      if (target) selectFinding(target.finding);
    }
  }}>
    <header className="rr-public-navigation">
      <div className="rr-public-sections" role="group" aria-label="Evidence view">
        <button type="button" aria-pressed={section === 'whole'} onClick={() => chooseSection('whole')}>Whole card</button>
        <button type="button" aria-pressed={section === 'finding'} onClick={() => chooseSection('finding')}>Findings <span>{navigation.entries.length}</span></button>
        <button type="button" aria-pressed={section === 'centering'} onClick={() => chooseSection('centering')}>Centering</button>
        {CATEGORIES.map(value => <button type="button" key={value} aria-pressed={section === value} onClick={() => chooseSection(value)}>{title(value)}</button>)}
        <button type="button" className="rr-fingerprint-button" disabled={mobile ? !ready : !SIDES.some(sideReady)} aria-label="ATLAS Card fingerprint" aria-pressed={section === 'fingerprint'} onClick={() => chooseSection('fingerprint')}><strong aria-hidden="true">ATLAS</strong>Card fingerprint</button>
        {gradeCalculation && <button type="button" aria-pressed={section === 'science'} onClick={() => chooseSection('science')}>Grade science</button>}
      </div>
      <div className="rr-public-motion" hidden={wholeReady || scanView}><button type="button" onClick={playTour} disabled={!bothReady}>Tour saved evidence</button><button type="button" onClick={replayArrival} disabled={!bothReady}>Replay arrival</button>{(tour || arrival) && <button type="button" onClick={stopMotion}>Stop motion</button>}</div>
      <div className="rr-public-sides" hidden={section === 'science' || wholeReady} role="group" aria-label="Card side">{SIDES.map(side =>
        <button type="button" key={side} aria-pressed={activeSide === side} onClick={() => chooseSide(side)}>{title(side)} <span>{navigation.entries.filter(entry => entry.finding.side === side).length}</span></button>)}</div>
    </header>
    {scanView && !printing && <EdgeTourControls controller={motionController} plan={scanPlan}/>}
    {tour && <p className="rr-public-tour" role="status">{tour}</p>}
    <div className="rr-public-context" hidden={section === 'science' || wholeReady || scanView}>
      <div><p className="rr-public-kicker">{shown ? `${shown.label} · Saved finding` : `${paired ? 'Front & Back' : title(activeSide)} · ${section === 'fingerprint' ? 'Card fingerprint' : section === 'centering' ? 'Saved centering' : category ? title(category) : 'Saved photograph'}`}</p>
        <h2>{shown ? title(shown.finding.defectType) : section === 'fingerprint' ? 'A pattern from the details.' : section === 'centering' ? 'The border balance.' : category ? `${title(category)}, in detail.` : 'Every detail, in context.'}</h2></div>
      <p className="rr-public-ready" role="status">{paired ? bothReady ? 'Both photographs verified' : 'Verifying photographs…' : ready ? 'Photograph verified' : 'Verifying photograph…'}</p>
    </div>
    <p className="rr-public-hint" hidden={section === 'science' || wholeReady || scanView}>{hint}</p>
    {category && section !== 'finding' && <div className="rr-public-category-summary"><span>{scoped.entries.length} {scopePlan ? 'findings in the inspection field · original grading categories retained' : 'recorded findings · findings may belong to more than one category'}</span><strong>{number(explanation?.categories?.[category]?.subgrade ?? report.grade?.subgrades?.[category])}<small> / 10 · saved {category} score</small></strong></div>}
    {section === 'finding' && findingNavigation}
    {wholeReady && <ApprovedWholeCard report={report} explanation={explanation} images={images} geometry={geometry} photos={currentPhotos} publication={publication} activeSide={activeSide} onChooseSide={chooseSide} onSelect={selectFinding} reduced={reduced} lastFinding={lastFinding} controls={wholeControls} onControlsChange={setWholeControls} motionState={wholeMotionState}/>}
    <div className="rr-public-viewers" hidden={wholeReady || section === 'science' && !printing}>{SIDES.map(side => <ReportInspectionImage
      key={`${side}:${report.inspection?.[side.toLowerCase()]?.imageSha256}`}
      side={side} descriptor={images?.[side]?.inspection} expectedHash={report.inspection?.[side.toLowerCase()]?.imageSha256}
      findings={sideFindings[side]} visibleFindingIds={category && !printing ? scoped.entries.map(entry => entry.id) : undefined}
      selected={!printing && section === 'finding' && current?.finding.side === side ? selected : null}
      onSelect={selectFinding} expanded={!printing && section === 'finding' && side === activeSide} hidden={!printing && (wholeReady || section === 'science' || !visibleSides.includes(side))}
      onExpand={() => chooseSection(returnSection)} onReady={onReady} onVerifiedPhoto={verifiedPhoto} geometry={geometry?.[side]}
      evidenceMotion={scanView && !printing ? { Component: EvidenceEdgeScan, controller: motionController, plan: scanPlan, explanation } : null}
      publicMode={!printing} printMode={printing} inspectionSection={section} spatialNavigation={scoped}
      pairedOverview={paired} overviewRail={paired && section !== 'centering' ? side === 'FRONT' ? 'left' : 'right' : undefined}
      density="all" lastFindingId={lastFinding[side]} onUserInteract={stopMotion} onActivate={onChooseSide}
      fingerprintCommand={fingerprintCommand} onFingerprintReturn={returnFromFingerprint}
      blueprint={false} cleanComparison={!printing && section === 'finding'} compact showFindingButtons={false} fitViewport
      layerOptions={printing ? PRINT_LAYERS : section === 'centering' ? CENTERING_LAYERS : NO_LAYERS}
      findingsVisible={!wholeReady && (printing || overlays && section !== 'centering')} command={command} onViewChange={viewChanged}
      explanation={current?.finding.side === side ? explanation?.findings?.find(entry => entry.id === current.id) : null}
      centering={explanation?.sides?.[side]?.centering} policy={explanation?.policy}/>)}</div>
    {section !== 'science' && !scanView && !wholeReady && <div className="rr-public-view-controls">
      {section === 'fingerprint' ? <div className="rr-fingerprint-actions"><button type="button" onClick={() => tide('RETURN')}>← Return to photograph</button>
        <button type="button" disabled={!(mobile ? ready && entries.length : SIDES.some(side => sideReady(side) && navigation.entries.some(entry => entry.finding.side === side)))} onClick={() => tide('PLAY')}>Play tide</button></div> : <>
      <div className="rr-public-overlay-controls">
        {section !== 'centering' && <button type="button" disabled={!ready && !bothReady} aria-pressed={overlays} onClick={() => { stopMotion(); setOverlays(value => !value); }}>{overlays ? 'Hide markings' : 'Show markings'}</button>}
        {section !== 'finding' && section !== 'centering' && <small>Overview shapes enlarged for visibility. Detail shows the exact saved trace.</small>}
      </div>
      <div className="rr-public-zoom" role="group" aria-label="Photograph view">
        {paired && <label>Zoom <select aria-label="Photograph to zoom" value={activeSide} onChange={event => { stopMotion(); onChooseSide(event.target.value); }}>{SIDES.map(side => <option key={side} value={side}>{title(side)}</option>)}</select></label>}
        <button type="button" disabled={!ready} onClick={() => { stopMotion(); sendView('FIT'); }}>Fit</button>
        <button type="button" aria-label="Zoom out" disabled={!ready || zoom <= 1} onClick={() => { stopMotion(); sendView('ZOOM', Math.max(1, zoom / 1.5)); }}>−</button>
        <output aria-label="Current zoom">{number(Math.round(zoom * 10) / 10)}×</output>
        <button type="button" aria-label="Zoom in" disabled={!ready || zoom >= 16} onClick={() => { stopMotion(); sendView('ZOOM', Math.min(16, zoom * 1.5)); }}>+</button>
      </div></>}
    </div>}
    {section === 'fingerprint' && <p className="rr-fingerprint-note">Contour artwork from each side’s recorded defects. Identical recorded traces produce identical artwork. This visualization does not authenticate or identify a physical card.</p>}
    {section === 'centering' && <div className="rr-public-centering-pair">{visibleSides.map(side => { const centering = explanation?.sides?.[side]?.centering; return <dl key={side} className="rr-public-centering" aria-label={`${title(side)} saved centering ratios`}>
      <div><dt>{title(side)} · Left / right</dt><dd>{ratio(centering?.leftRightBalance)}</dd></div>
      <div><dt>Top / bottom</dt><dd>{ratio(centering?.topBottomBalance)}</dd></div>
      <div><dt>Recorded centering score</dt><dd>{Number.isFinite(centering?.score) ? `${number(centering.score)} / 10` : 'Unavailable'}</dd></div>
    </dl>; })}</div>}
    {entries.length === 0 && !['finding', 'centering', 'fingerprint', 'science'].includes(section) && !paired && <div className="rr-public-empty"><p>No included damage findings on {title(activeSide)}.</p>
      {otherEntries.length > 0 ? <button type="button" disabled={!sideReady(otherSide)} onClick={() => selectFinding(otherEntries[0].finding)}>Explore {otherEntries.length} {title(otherSide)} {otherEntries.length === 1 ? 'finding' : 'findings'} →</button>
        : <button type="button" onClick={() => chooseSection('centering')}>Explore centering →</button>}</div>}
    {section !== 'finding' && section !== 'science' && findingNavigation}
    {shown && <section className="rr-public-finding-readout" aria-label={`${shown.label} saved measurements`}>{findingDetails}</section>}
    {gradeCalculation && <div className="rr-public-grade-story" hidden={section === 'finding' || printing}>{typeof gradeCalculation === 'function' ? gradeCalculation({ onCategory: next => { chooseSection(next); explorer.current?.scrollIntoView?.({ block: 'start', behavior: reduced ? 'auto' : 'smooth' }); } }) : gradeCalculation}</div>}
  </section>;
}
